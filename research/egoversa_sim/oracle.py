"""MuJoCo as an exact verifier.

Everything here reads the simulator's own state. No learned component and no 3D reconstruction is involved,
so every label is exact up to the stated tolerances (see docs/CONVENTIONS.md, section 8).

  cameras      viewer camera placed on an orbit; agents' head cameras come from the MJCF
  visibility   modal / amodal pixel ratio from segmentation renders (amodal = only that body drawn)
  relations    camera-frame bearing, range, height; observer-frame phi / psi; facing alpha
  support      "A rests on B" from normal contact forces relative to A's weight
  counterfact. "if B were removed, would A move?" from a forward rollout with B taken out of the world
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Optional

import mujoco
import numpy as np

from .scene import FOCUS, SimScene

GEOM = int(mujoco.mjtObj.mjOBJ_GEOM)
DEG = 180.0 / math.pi
IMG_W, IMG_H = 512, 384  # 4:3 viewer images
VIEW_FOVY = 50.0


@dataclass
class ViewerPose:
    azimuth_deg: float  # 0 = camera on the -Y side of the table, looking toward +Y
    height: float  # world z of the camera, metres
    distance: float  # horizontal distance to the focus point

    def as_dict(self) -> dict:
        return {"azimuth_deg": round(self.azimuth_deg, 2), "height": round(self.height, 3), "distance": round(self.distance, 3)}


@dataclass
class CamFrame:
    pos: np.ndarray
    right: np.ndarray
    up: np.ndarray
    forward: np.ndarray
    fovy_deg: float
    aspect: float = IMG_W / IMG_H

    def to_cam(self, p: np.ndarray) -> np.ndarray:
        d = np.asarray(p) - self.pos
        return np.array([self.right @ d, self.up @ d, -(self.forward @ d)])


def viewer_frame(pose: ViewerPose, focus: np.ndarray = FOCUS) -> CamFrame:
    az = math.radians(pose.azimuth_deg)
    pos = np.array([focus[0] + pose.distance * math.sin(az), focus[1] - pose.distance * math.cos(az), pose.height])
    fwd = focus - pos
    fwd /= np.linalg.norm(fwd)
    right = np.cross(fwd, [0, 0, 1.0])
    right /= np.linalg.norm(right)
    up = np.cross(right, fwd)
    return CamFrame(pos, right, up, fwd, VIEW_FOVY)


def place_viewer(scene: SimScene, pose: ViewerPose) -> CamFrame:
    """Move the MJCF 'viewer' camera to `pose` and update kinematics."""
    fr = viewer_frame(pose)
    cid = mujoco.mj_name2id(scene.model, mujoco.mjtObj.mjOBJ_CAMERA, "viewer")
    mat = np.stack([fr.right, fr.up, -fr.forward], axis=1)  # camera axes as columns
    quat = np.zeros(4)
    mujoco.mju_mat2Quat(quat, mat.flatten())
    scene.model.cam_pos[cid] = fr.pos
    scene.model.cam_quat[cid] = quat
    scene.model.cam_fovy[cid] = VIEW_FOVY
    mujoco.mj_forward(scene.model, scene.data)
    return fr


def eye_frame(scene: SimScene, agent_name: str) -> CamFrame:
    cid = mujoco.mj_name2id(scene.model, mujoco.mjtObj.mjOBJ_CAMERA, f"eye:{agent_name}")
    R = scene.data.cam_xmat[cid].reshape(3, 3)
    return CamFrame(scene.data.cam_xpos[cid].copy(), R[:, 0].copy(), R[:, 1].copy(), -R[:, 2].copy(), float(scene.model.cam_fovy[cid]))


class SceneRenderer:
    """One offscreen renderer per scene (MuJoCo renderers are bound to a model)."""

    def __init__(self, scene: SimScene, width: int = IMG_W, height: int = IMG_H):
        self.scene = scene
        self.r = mujoco.Renderer(scene.model, height, width)
        self.opt = mujoco.MjvOption()

    def rgb(self, camera: str) -> np.ndarray:
        self.r.update_scene(self.scene.data, camera=camera)
        return self.r.render().copy()

    def body_seg(self, camera: str, opt: Optional[mujoco.MjvOption] = None) -> np.ndarray:
        """Per-pixel body id (-1 = background)."""
        self.r.enable_segmentation_rendering()
        self.r.update_scene(self.scene.data, camera=camera, scene_option=opt or self.opt)
        seg = self.r.render().copy()
        self.r.disable_segmentation_rendering()
        ids, types = seg[..., 0], seg[..., 1]
        out = np.full(ids.shape, -1, dtype=np.int32)
        m = (types == GEOM) & (ids >= 0)
        # A robot is many bodies (links); report the entity, i.e. the root body each geom hangs from.
        model = self.scene.model
        out[m] = model.body_rootid[model.geom_bodyid[ids[m]]]
        return out

    def amodal_mask(self, camera: str, body: int) -> np.ndarray:
        """Silhouette of one entity (root body) with every other geom hidden (via geom groups).

        Only geoms that are drawn in the normal render (groups 0-2) count; hidden collision meshes (group 3)
        stay hidden, so modal and amodal masks are measured on the same visible surface."""
        model = self.scene.model
        saved = model.geom_group.copy()
        try:
            own_visible = (model.body_rootid[model.geom_bodyid] == body) & (saved <= 2)
            model.geom_group[:] = 5
            model.geom_group[own_visible] = 0
            opt = mujoco.MjvOption()
            opt.geomgroup[:] = 0
            opt.geomgroup[0] = 1
            return self.body_seg(camera, opt) == body
        finally:
            model.geom_group[:] = saved

    def close(self) -> None:
        self.r.close()


@dataclass
class Visibility:
    body: int
    modal_px: int
    amodal_px: int
    in_frame: float  # fraction of the projected bounding box inside the image
    visible: float  # modal / amodal over in-frame pixels
    determinable: bool


MIN_AMODAL_PX = 150


def body_aabb_corners(scene: SimScene, body: int) -> np.ndarray:
    m, d = scene.model, scene.data
    pts = []
    for g in np.where((m.body_rootid[m.geom_bodyid] == body) & (m.geom_group <= 2))[0]:
        c, r = d.geom_xpos[g], m.geom_rbound[g]
        for sx in (-1, 1):
            for sy in (-1, 1):
                for sz in (-1, 1):
                    pts.append(c + r * np.array([sx, sy, sz]) / math.sqrt(3) * 1.0)
    return np.array(pts)


def in_frame_fraction(fr: CamFrame, corners: np.ndarray) -> float:
    t = math.tan(math.radians(fr.fovy_deg) / 2)
    uv = []
    for p in corners:
        x, y, z = fr.to_cam(p)
        if -z <= 0.02:
            return 0.0
        uv.append((x / (-z * t * fr.aspect), y / (-z * t)))
    uv = np.array(uv)
    x0, y0 = uv.min(0)
    x1, y1 = uv.max(0)
    area = max(1e-9, (x1 - x0) * (y1 - y0))
    cx = max(0.0, min(x1, 1) - max(x0, -1))
    cy = max(0.0, min(y1, 1) - max(y0, -1))
    return float(min(1.0, cx * cy / area))


def visibility(scene: SimScene, rend: SceneRenderer, camera: str, fr: CamFrame, bodies: list[int]) -> dict[int, Visibility]:
    seg = rend.body_seg(camera)
    out = {}
    for b in bodies:
        amodal = rend.amodal_mask(camera, b)
        a = int(amodal.sum())
        mo = int(((seg == b) & amodal).sum())
        inf = in_frame_fraction(fr, body_aabb_corners(scene, b))
        out[b] = Visibility(b, mo, a, inf, mo / a if a else 0.0, a >= MIN_AMODAL_PX)
    return out


# --------------------------------------------------------------------------------------- support


def support_graph(scene: SimScene, min_weight_frac: float = 0.2) -> dict[str, list[str]]:
    """supported name -> list of supporter names ('table', 'floor', or object names).

    A rests on B when the summed vertical component of the normal contact force exerted by B on A is at least
    `min_weight_frac` of A's weight. Uses mj_contactForce on the settled state.
    """
    m, d = scene.model, scene.data
    mujoco.mj_forward(m, d)
    name_of = {b: n.split(":", 1)[1] for n, b in scene.body_ids.items()}
    table = mujoco.mj_name2id(m, mujoco.mjtObj.mjOBJ_BODY, "table")
    name_of[table] = "table"
    name_of[0] = "floor"
    force = np.zeros(6)
    acc: dict[tuple[int, int], float] = {}
    for i in range(d.ncon):
        c = d.contact[i]
        b1, b2 = int(m.body_rootid[m.geom_bodyid[c.geom1]]), int(m.body_rootid[m.geom_bodyid[c.geom2]])
        mujoco.mj_contactForce(m, d, i, force)
        n = np.array(c.frame[:3])  # normal, pointing from geom1 to geom2
        fz = force[0] * n[2]  # vertical part of the force geom1 exerts on geom2
        if fz > 0:
            acc[(b1, b2)] = acc.get((b1, b2), 0.0) + fz  # b1 pushes b2 up: b2 rests on b1
        elif fz < 0:
            acc[(b2, b1)] = acc.get((b2, b1), 0.0) - fz
    g = -m.opt.gravity[2]
    out: dict[str, list[str]] = {}
    for (sup, top), f in acc.items():
        if top not in name_of or not scene.body_ids.get(f"obj:{name_of[top]}") == top:
            continue
        weight = m.body_mass[top] * g
        if f >= min_weight_frac * weight and sup in name_of:
            out.setdefault(name_of[top], []).append(name_of[sup])
    return {k: sorted(v) for k, v in out.items()}


# ---------------------------------------------------------------------------------- counterfactual


@dataclass
class Rollout:
    removed: str
    displacement: dict[str, float]  # object name -> metres moved after removal
    trajectory: list[dict] = field(default_factory=list)


def remove_and_rollout(scene: SimScene, removed: str, seconds: float = 1.2, record_every: int = 20) -> Rollout:
    """Take object `removed` out of the world and simulate. The scene's own state is left untouched."""
    m = scene.model
    d = mujoco.MjData(m)
    mujoco.mj_copyData(d, m, scene.data)
    bid = scene.body_ids[f"obj:{removed}"]
    adr = m.jnt_qposadr[m.body_jntadr[bid]]
    vadr = m.jnt_dofadr[m.body_jntadr[bid]]
    d.qpos[adr:adr + 3] = [20.0, 20.0, 5.0]  # far away, falling onto empty floor
    d.qvel[:] = 0
    mujoco.mj_forward(m, d)
    before = {n: scene.data.xpos[b].copy() for n, b in scene.body_ids.items() if n.startswith("obj:")}
    traj = []
    for i in range(int(seconds / m.opt.timestep)):
        mujoco.mj_step(m, d)
        d.qpos[adr:adr + 3] = [20.0, 20.0, 5.0]
        d.qvel[vadr:vadr + 6] = 0
        if i % record_every == 0:
            traj.append({"t": round(i * m.opt.timestep, 4), "poses": {n: [*map(float, d.xpos[b]), *map(float, d.xquat[b])] for n, b in scene.body_ids.items() if n.startswith("obj:") and n != f"obj:{removed}"}})
    disp = {n.split(":", 1)[1]: float(np.linalg.norm(d.xpos[b] - before[n])) for n, b in scene.body_ids.items() if n.startswith("obj:") and n != f"obj:{removed}"}
    return Rollout(removed, disp, traj)


MOVE_YES = 0.03  # moved more than 3 cm -> "yes, it moves"
MOVE_NO = 0.01  # moved less than 1 cm -> "no"; in between is ambiguous


# ---------------------------------------------------------------------------------------- frames


def bearing_range(fr: CamFrame, p: np.ndarray) -> tuple[float, float]:
    x, y, z = fr.to_cam(p)
    return math.atan2(x, -z) * DEG, float(math.sqrt(x * x + y * y + z * z))


def agent_heading(scene: SimScene, agent: str) -> np.ndarray:
    R = scene.data.xmat[scene.body_ids[f"agent:{agent}"]].reshape(3, 3)
    f = R[:, 0].copy()
    f[2] = 0
    return f / np.linalg.norm(f)


def observer_angles(scene: SimScene, agent: str, p: np.ndarray) -> tuple[float, float]:
    """(phi, psi) of point p in the agent's frame: phi > 0 = right, psi > 0 = in front."""
    f = agent_heading(scene, agent)
    r = np.array([f[1], -f[0], 0.0])  # f x z (right of the agent, z-up)
    a = scene.data.xpos[scene.body_ids[f"agent:{agent}"]]
    d = np.array([p[0] - a[0], p[1] - a[1], 0.0])
    n = np.linalg.norm(d)
    if n < 1e-9:
        return 0.0, 0.0
    return math.asin(np.clip(r @ d / n, -1, 1)) * DEG, math.asin(np.clip(f @ d / n, -1, 1)) * DEG


def facing_alpha(scene: SimScene, agent: str, fr: CamFrame) -> float:
    f = agent_heading(scene, agent)
    a = scene.data.xpos[scene.body_ids[f"agent:{agent}"]]
    t = np.array([fr.pos[0] - a[0], fr.pos[1] - a[1], 0.0])
    t /= np.linalg.norm(t)
    return math.acos(np.clip(f @ t, -1, 1)) * DEG


def heading_offset(scene: SimScene, agent: str, fr: CamFrame) -> float:
    f = agent_heading(scene, agent)
    c = np.array([fr.forward[0], fr.forward[1], 0.0])
    c /= np.linalg.norm(c)
    return math.acos(np.clip(f @ c, -1, 1)) * DEG
