"""Physically realistic MuJoCo scenes: seed -> composed model -> settled state.

World frame (MuJoCo convention): right-handed, metres, +Z up, gravity -Z.

A scene is a wooden table (photo texture, CC0) on a laminate floor with 6-9 real household objects from
Google Scanned Objects (textured scans with convex-decomposed collision meshes, realistic masses), dropped
onto the table and onto each other, plus 1-2 real robot models from MuJoCo Menagerie standing beside the
table: a Unitree G1 humanoid ("humanoid robot") and/or a Hello Robot Stretch 3 ("Stretch robot"). Robots are
frozen in their default posture (joints removed): they are embodied observers, not actuated agents. Each robot
gets an eye camera at its real head-sensor location, looking where the robot faces, pitched down at the table.

Primitive objects (box/sphere) and simple toy observers remain available for controlled unit tests.

Assets are downloaded by research/scripts/fetch_assets.py into research/assets/.
Determinism: all randomness comes from numpy.random.default_rng(seed-derived integer); MuJoCo stepping is
deterministic for a given build, so one spec gives one settled state on one machine.
"""
from __future__ import annotations

import functools
import hashlib
import warnings
import json
import math
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Optional

import mujoco
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / "research" / "assets"

TABLE_TOP_Z = 0.75
TABLE_HALF = (0.55, 0.40)
FOCUS = np.array([0.0, 0.0, TABLE_TOP_Z + 0.12])

# asset folder -> (display name, noun, realistic mass in kg, can carry other objects)
ASSET_TABLE: dict[str, tuple[str, str, float, bool]] = {
    "Cole_Hardware_Mug_Classic_Blue": ("blue mug", "mug", 0.35, False),
    "Room_Essentials_Mug_White_Yellow": ("yellow mug", "mug", 0.33, False),
    "Threshold_Porcelain_Coffee_Mug_All_Over_Bead_White": ("white mug", "mug", 0.34, False),
    "Threshold_Porcelain_Teapot_White": ("white teapot", "teapot", 0.80, False),
    "Room_Essentials_Bowl_Turquiose": ("turquoise bowl", "bowl", 0.30, True),
    "Threshold_Bead_Cereal_Bowl_White": ("white bowl", "bowl", 0.35, True),
    "Top_Paw_Dog_Bowl_Blue_Paw_Bone_Ceramic_25_fl_oz_total": ("blue dog bowl", "dog bowl", 0.55, True),
    "Room_Essentials_Salad_Plate_Turquoise": ("turquoise plate", "plate", 0.40, True),
    "Threshold_Bistro_Ceramic_Dinner_Plate_Ruby_Ring": ("white plate", "plate", 0.55, True),
    "JBL_Charge_Speaker_portable_wireless_wired_Green": ("green speaker", "speaker", 0.80, True),
    "Logitech_Ultimate_Ears_Boom_Wireless_Speaker_Night_Black": ("black speaker", "speaker", 0.55, False),
    "Crosley_Alarm_Clock_Vintage_Metal": ("alarm clock", "clock", 0.35, False),
    "Mens_Striper_Sneaker_in_White_rnp8HUli59Y": ("white sneaker", "sneaker", 0.40, False),
    "Timberland_Mens_Classic_2Eye_Boat_Shoe": ("brown shoe", "shoe", 0.45, False),
    "Sapota_Threshold_4_Ceramic_Round_Planter_Red": ("red planter", "planter", 0.60, False),
    "Ecoforms_Plant_Pot_GP9AAvocado": ("green flowerpot", "flowerpot", 0.30, False),
    "Great_Dinos_Triceratops_Toy": ("toy dinosaur", "toy dinosaur", 0.15, False),
    "Schleich_Lion_Action_Figure": ("toy lion", "toy lion", 0.08, False),
    "Schleich_African_Black_Rhino": ("toy rhino", "toy rhino", 0.10, False),
    "Shurtape_Tape_Purple_CP28": ("purple tape roll", "tape roll", 0.25, False),
    "3M_Vinyl_Tape_Green_1_x_36_yd": ("green tape roll", "tape roll", 0.12, False),
    "Vans_Cereal_Honey_Nut_Crunch_11_oz_box": ("cereal box", "box", 0.40, True),
    "Olive_Kids_Dinosaur_Land_Lunch_Box": ("lunch box", "lunch box", 0.45, True),
    "Victor_Reversible_Bookend": ("bookend", "bookend", 0.50, False),
    "Android_Figure_Panda": ("panda figure", "figure", 0.12, False),
    "Spritz_Easter_Basket_Plastic_Teal": ("teal basket", "basket", 0.20, True),
    "Ecoforms_Plant_Bowl_Turquoise_7": ("turquoise plant bowl", "plant bowl", 0.40, True),
}
# Asset families reserved for out-of-distribution test splits (never in train / val / test_iid).
HELD_OUT_ASSETS = ["Threshold_Porcelain_Teapot_White", "Schleich_African_Black_Rhino", "Olive_Kids_Dinosaur_Land_Lunch_Box", "Spritz_Easter_Basket_Plastic_Teal"]
HELD_OUT_NOUNS = sorted({ASSET_TABLE[a][1] for a in HELD_OUT_ASSETS})

ROBOTS = {
    "humanoid": {"name": "humanoid robot", "file": "robots/unitree_g1/g1.xml", "root": "pelvis", "head_mesh": "head_link", "eye_forward": 0.09, "has_face": True},
    "stretch": {"name": "Stretch robot", "file": "robots/hello_robot_stretch_3/stretch.xml", "root": "base_link", "head_camera": "d435i_camera_rgb", "eye_forward": 0.02, "has_face": False},
}
EYE_PITCH_DEG = 32.0
AWAY_FRACTION = 0.4  # robots with their back to the table: balances front/behind and toward/away labels
EYE_FOVY = 60.0

COLORS = {
    "red": (0.90, 0.28, 0.30), "blue": (0.29, 0.49, 1.00), "green": (0.30, 0.70, 0.48), "yellow": (0.95, 0.79, 0.30),
    "white": (0.91, 0.92, 0.95), "black": (0.16, 0.17, 0.20), "orange": (0.95, 0.46, 0.16), "purple": (0.61, 0.43, 1.00),
    "teal": (0.12, 0.72, 0.65), "pink": (0.94, 0.44, 0.66), "brown": (0.66, 0.45, 0.29),
}


def _hash_int(s: str) -> int:
    return int.from_bytes(hashlib.sha256(s.encode()).digest()[:8], "little")


@dataclass
class ObjSpec:
    name: str
    noun: str
    color: str
    geom: str  # "mesh" for scanned assets, else a primitive type (tests)
    size: list[float]  # mesh: bounding-box extents; primitive: MuJoCo half-sizes
    pos: list[float]
    euler: list[float]
    mass: float
    base: bool = False
    asset: Optional[str] = None


@dataclass
class AgentSpec:
    name: str
    color: str
    pos: list[float]
    yaw: float  # facing direction = (cos yaw, sin yaw, 0)
    height: float
    kind: str = "toy"  # "humanoid" | "stretch" | "toy"


@dataclass
class SimSceneSpec:
    seed: str
    n_objects: int = 7
    n_agents: int = 1
    stack_prob: float = 0.45
    exclude: list[str] = field(default_factory=list)  # asset folders or nouns that must not appear


@dataclass
class SimScene:
    spec: SimSceneSpec
    objects: list[ObjSpec]
    agents: list[AgentSpec]
    xml: str
    model: mujoco.MjModel
    data: mujoco.MjData
    body_ids: dict[str, int]  # "obj:<name>" / "agent:<name>" -> root body id
    settle_trajectory: list[dict]
    fingerprint: str = ""

    def object_names(self) -> list[str]:
        return [o.name for o in self.objects]


# --------------------------------------------------------------------------------------------- assets


def assets_available() -> bool:
    d = ASSETS / "objects"
    return d.exists() and all((d / a / "model.xml").exists() for a in ASSET_TABLE)


@functools.lru_cache(maxsize=None)
def asset_extent(folder: str) -> dict:
    """Bounding box of the visual mesh in the asset's own frame, and its mass at density 1000."""
    s = mujoco.MjSpec.from_file(str(ASSETS / "objects" / folder / "model.xml"))
    s.body("model").add_freejoint()
    m = s.compile()
    d = mujoco.MjData(m)
    mujoco.mj_forward(m, d)
    lo, hi = np.full(3, np.inf), np.full(3, -np.inf)
    for g in range(m.ngeom):
        if m.geom_type[g] != mujoco.mjtGeom.mjGEOM_MESH or m.geom_group[g] != 2:
            continue
        mid = m.geom_dataid[g]
        v0, nv = m.mesh_vertadr[mid], m.mesh_vertnum[mid]
        R = d.geom_xmat[g].reshape(3, 3)
        verts = m.mesh_vert[v0:v0 + nv] @ R.T + d.geom_xpos[g] - d.xpos[1]
        lo, hi = np.minimum(lo, verts.min(0)), np.maximum(hi, verts.max(0))
    return {"lo": lo.tolist(), "hi": hi.tolist(), "mass1000": float(m.body_mass[1])}


def _texture(name: str) -> str:
    p = ASSETS / "textures" / f"{name}.png"
    return str(p) if p.exists() else ""


def base_mjcf(img_w: int = 512, img_h: int = 384, extra_bodies: str = "") -> str:
    tx, ty = TABLE_HALF
    floor_tex, wood_tex = _texture("floor"), _texture("table")
    floor_asset = (f'<texture name="floor" type="2d" file="{floor_tex}"/><material name="floormat" texture="floor" texrepeat="4 4" reflectance="0.04"/>' if floor_tex else
                   '<texture name="floor" type="2d" builtin="checker" rgb1=".55 .45 .35" rgb2=".5 .4 .3" width="512" height="512"/><material name="floormat" texture="floor" texrepeat="6 6"/>')
    wood_asset = (f'<texture name="wood" type="2d" file="{wood_tex}"/><material name="tablemat" texture="wood" specular="0.3" shininess="0.4"/>' if wood_tex else
                  '<material name="tablemat" rgba=".55 .40 .28 1"/>')
    legs = "".join(
        f'<geom type="box" size=".025 .025 {TABLE_TOP_Z/2-.02:.4f}" pos="{sx*(tx-.05):.3f} {sy*(ty-.05):.3f} {TABLE_TOP_Z/2-.02:.4f}" rgba=".18 .18 .2 1"/>'
        for sx in (-1, 1) for sy in (-1, 1))
    return f"""<mujoco model="egoversa-sim">
  <compiler angle="radian"/>
  <option timestep="0.002" gravity="0 0 -9.81" integrator="implicitfast"/>
  <visual>
    <global offwidth="{max(img_w, 1280)}" offheight="{max(img_h, 960)}" fovy="50"/>
    <quality shadowsize="4096" offsamples="8"/>
    <headlight ambient=".32 .32 .34" diffuse=".45 .45 .45" specular=".08 .08 .08"/>
    <map znear="0.01" zfar="50"/>
  </visual>
  <asset>
    <texture name="sky" type="skybox" builtin="gradient" rgb1=".62 .66 .74" rgb2=".20 .22 .28" width="256" height="256"/>
    {floor_asset}{wood_asset}
    <material name="objmat" specular="0.35" shininess="0.5"/>
    <material name="visor" emission="0.8"/>
  </asset>
  <worldbody>
    <light name="key" pos="1.5 -1.3 3.0" dir="-0.42 0.38 -1" diffuse=".85 .85 .8" specular=".25 .25 .25" castshadow="true"/>
    <light name="fill" pos="-1.6 1.4 2.6" dir="0.45 -0.4 -1" diffuse=".28 .3 .36" castshadow="false"/>
    <geom name="floor" type="plane" size="5 5 .1" material="floormat"/>
    <body name="table">
      <geom name="tabletop" type="box" size="{tx} {ty} .02" pos="0 0 {TABLE_TOP_Z-.02:.4f}" material="tablemat" friction="0.9 0.01 0.001"/>
      {legs}
    </body>
    <camera name="viewer" pos="0 -2 1.6" xyaxes="1 0 0 0 .6 .8" fovy="50"/>
    {extra_bodies}
  </worldbody>
</mujoco>"""


def _toy_agent_xml(a: AgentSpec) -> str:
    h = a.height
    q = f"{math.cos(a.yaw/2):.5f} 0 0 {math.sin(a.yaw/2):.5f}"
    return (f'<body name="agent:{a.name}" pos="{a.pos[0]:.4f} {a.pos[1]:.4f} {a.pos[2]:.4f}" quat="{q}">'
            f'<geom type="box" size="{.12*h:.4f} {.19*h:.4f} {.4*h:.4f}" pos="0 0 {.45*h:.4f}" rgba=".5 .55 .65 1"/>'
            f'<geom type="box" size="{.01*h:.4f} {.12*h:.4f} {.04*h:.4f}" pos="{.125*h:.4f} 0 {.8*h:.4f}" rgba=".36 .88 .9 1" material="visor"/></body>')


def _prim_obj_xml(o: ObjSpec) -> str:
    rgba = " ".join(f"{c:.3f}" for c in (*COLORS.get(o.color, (0.6, 0.6, 0.6)), 1.0))
    return (f'<body name="obj:{o.name}" pos="{o.pos[0]:.5f} {o.pos[1]:.5f} {o.pos[2]:.5f}" euler="{o.euler[0]:.5f} {o.euler[1]:.5f} {o.euler[2]:.5f}">'
            f'<freejoint/><geom type="{o.geom}" size="{" ".join(f"{s:.5f}" for s in o.size)}" rgba="{rgba}" mass="{o.mass:.4f}" '
            f'material="objmat" friction="0.9 0.01 0.001" condim="4"/></body>')


# -------------------------------------------------------------------------------------------- sampling


def sample_scene(spec: SimSceneSpec) -> tuple[list[ObjSpec], list[AgentSpec]]:
    rng = np.random.default_rng(_hash_int(f"egoversa-sim/v3|{spec.seed}|{spec.n_objects}|{spec.n_agents}|{spec.stack_prob}"))
    pool = [a for a in ASSET_TABLE if a not in spec.exclude and ASSET_TABLE[a][1] not in spec.exclude]
    picks = [pool[i] for i in rng.permutation(len(pool))[: spec.n_objects]]
    tx, ty = TABLE_HALF
    objects: list[ObjSpec] = []
    footprints: list[tuple[float, float, float]] = []
    for folder in picks:
        name, noun, mass, base = ASSET_TABLE[folder]
        ext = asset_extent(folder)
        lo, hi = np.array(ext["lo"]), np.array(ext["hi"])
        r = float(np.linalg.norm((hi - lo)[:2]) / 2) + 0.01
        yaw = float(rng.uniform(-math.pi, math.pi))
        bases = [o for o in objects if o.base and o.pos[2] < TABLE_TOP_Z + 0.3]
        if bases and rng.random() < spec.stack_prob:
            b = bases[int(rng.integers(len(bases)))]
            bh = asset_extent(b.asset)["hi"][2]
            off = rng.normal(0, 0.015, 2)
            pos = [b.pos[0] + off[0], b.pos[1] + off[1], b.pos[2] + bh - lo[2] + 0.06]
        else:
            x = y = 0.0
            for _ in range(80):
                x = rng.uniform(-tx + r + 0.02, tx - r - 0.02)
                y = rng.uniform(-ty + r + 0.02, ty - r - 0.02)
                if all(math.hypot(x - fx, y - fy) > (r + fr) * 0.9 for fx, fy, fr in footprints):
                    break
            footprints.append((x, y, r))
            pos = [float(x), float(y), TABLE_TOP_Z - lo[2] + 0.01]
        objects.append(ObjSpec(name, noun, "", "mesh", [float(v) for v in (hi - lo)], [float(v) for v in pos], [0.0, 0.0, yaw], mass, base, folder))
    agents: list[AgentSpec] = []
    kinds = [str(k) for k in rng.permutation(list(ROBOTS))][: spec.n_agents]
    a0 = rng.uniform(-math.pi, math.pi)
    gap = math.pi * rng.uniform(0.55, 1.1)
    for i, kind in enumerate(kinds):
        ang = a0 + i * gap
        x, y = 1.0 * math.cos(ang), 0.88 * math.sin(ang)
        yaw = math.atan2(-y, -x) + float(rng.uniform(-0.6, 0.6))  # face the table within +-35 degrees ...
        if rng.random() < AWAY_FRACTION:  # ... or turned away from it, so "behind" and "facing away" occur
            yaw += math.pi
        agents.append(AgentSpec(ROBOTS[kind]["name"], "", [float(x), float(y), 0.0], float(yaw), 1.3, kind))
    return objects, agents


# --------------------------------------------------------------------------------------------- building


def _root_of(body, robot_roots: set[str]) -> Optional[str]:
    p = body
    while p is not None and p.name != "world":
        if p.name in robot_roots or p.name.startswith(("agent:", "obj:")):
            return p.name
        p = p.parent
    return None


def robot_root_name(k: int, kind: str) -> str:
    """Robots keep their own (prefixed) root body name: their MJCF refers to it, e.g. in contact excludes."""
    return f"r{k}/{ROBOTS[kind]['root']}"


def _compose(objects: list[ObjSpec], agents: list[AgentSpec], img_w: int, img_h: int) -> tuple[mujoco.MjSpec, str]:
    extra = "".join(_prim_obj_xml(o) for o in objects if o.asset is None) + "".join(_toy_agent_xml(a) for a in agents if a.kind == "toy")
    xml = base_mjcf(img_w, img_h, extra)
    spec = mujoco.MjSpec.from_string(xml)
    for i, o in enumerate(objects):
        if o.asset is None:
            continue
        child = mujoco.MjSpec.from_file(str(ASSETS / "objects" / o.asset / "model.xml"))
        scale = o.mass / max(asset_extent(o.asset)["mass1000"], 1e-6)
        for g in child.geoms:
            g.density = 1000.0 * scale  # realistic total mass, keeping the scan's own mass distribution
            g.friction = [0.9, 0.01, 0.001]
            g.condim = 4
        fr = spec.worldbody.add_frame(pos=o.pos, quat=[math.cos(o.euler[2] / 2), 0.0, 0.0, math.sin(o.euler[2] / 2)])
        b = fr.attach_body(child.body("model"), f"o{i}/", "")
        b.name = f"obj:{o.name}"
        b.add_freejoint()
    for k, a in enumerate(agents):
        spec.worldbody.add_camera(name=f"eye:{a.name}", pos=[0, 0, 1], fovy=EYE_FOVY)
        if a.kind == "toy":
            continue
        info = ROBOTS[a.kind]
        child = mujoco.MjSpec.from_file(str(ASSETS / info["file"]))
        fr = spec.worldbody.add_frame(pos=a.pos, quat=[math.cos(a.yaw / 2), 0.0, 0.0, math.sin(a.yaw / 2)])
        fr.attach_body(child.body(info["root"]), f"r{k}/", "")
    robot_roots = {robot_root_name(k, a.kind) for k, a in enumerate(agents) if a.kind != "toy"}
    # Freeze robots: drop every joint inside a robot, plus actuators, tendons, equalities, keyframes, sensors.
    for j in list(spec.joints):
        root = _root_of(j.parent, robot_roots)
        if root and (root in robot_roots or root.startswith("agent:")):
            spec.delete(j)
    for coll in (spec.actuators, spec.tendons, spec.equalities, spec.keys, spec.sensors):
        for e in list(coll):
            spec.delete(e)
    return spec, xml


def _place_eye(model: mujoco.MjModel, data: mujoco.MjData, a: AgentSpec, root: int) -> None:
    """Eye camera at the robot's real head sensor, looking along its heading, pitched down toward the table."""
    R0 = data.xmat[root].reshape(3, 3)
    f = R0[:, 0].copy()
    f[2] = 0
    f /= np.linalg.norm(f)
    info = ROBOTS.get(a.kind)
    if info is None:  # toy observer: head at 80% of its height
        head, fwd_off = data.xpos[root] + np.array([0, 0, 0.8 * a.height]), 0.15 * a.height
    elif "head_camera" in info:
        cams = [c for c in range(model.ncam) if (mujoco.mj_id2name(model, mujoco.mjtObj.mjOBJ_CAMERA, c) or "").endswith(info["head_camera"])
                and model.body_rootid[model.cam_bodyid[c]] == root]
        head, fwd_off = data.cam_xpos[cams[0]].copy(), info["eye_forward"]
    else:
        gids = [g for g in range(model.ngeom) if model.body_rootid[model.geom_bodyid[g]] == root and model.geom_type[g] == mujoco.mjtGeom.mjGEOM_MESH
                and (mujoco.mj_id2name(model, mujoco.mjtObj.mjOBJ_MESH, model.geom_dataid[g]) or "").endswith(info["head_mesh"])]
        head, fwd_off = data.geom_xpos[gids[0]].copy(), info["eye_forward"]
    pos = head + f * fwd_off
    p = math.radians(EYE_PITCH_DEG)
    fwd = f * math.cos(p) + np.array([0.0, 0.0, -math.sin(p)])
    right = np.cross(fwd, [0, 0, 1.0])
    right /= np.linalg.norm(right)
    up = np.cross(right, fwd)
    quat = np.zeros(4)
    mujoco.mju_mat2Quat(quat, np.stack([right, up, -fwd], axis=1).flatten())
    cid = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_CAMERA, f"eye:{a.name}")
    model.cam_pos[cid] = pos
    model.cam_quat[cid] = quat


def _record(data, body_ids: dict[str, int]) -> dict:
    return {n: [*map(float, data.xpos[b]), *map(float, data.xquat[b])] for n, b in body_ids.items() if n.startswith("obj:")}


def build_scene(spec: SimSceneSpec, settle_s: float = 2.5, record_every: int = 17, img_w: int = 512, img_h: int = 384,
                objects: Optional[list[ObjSpec]] = None, agents: Optional[list[AgentSpec]] = None) -> SimScene:
    """Sample (or take the given) objects and agents, compose the model and settle it under gravity."""
    if objects is None or agents is None:
        if not assets_available():
            raise SystemExit("Realistic assets are missing. Run: python research/scripts/fetch_assets.py")
        objects, agents = sample_scene(spec)
    with warnings.catch_warnings():
        # Attaching a robot reports that its own solver options (e.g. Stretch's impratio) are not adopted: intended.
        warnings.simplefilter("ignore", UserWarning)
        mspec, xml = _compose(objects, agents, img_w, img_h)
        model = mspec.compile()
    data = mujoco.MjData(model)
    body_ids = {f"obj:{o.name}": mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY, f"obj:{o.name}") for o in objects}
    body_ids.update({f"agent:{a.name}": mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY, f"agent:{a.name}" if a.kind == "toy" else robot_root_name(k, a.kind))
                     for k, a in enumerate(agents)})
    mujoco.mj_forward(model, data)
    traj = [{"t": 0.0, "poses": _record(data, body_ids)}]
    for i in range(1, int(settle_s / model.opt.timestep) + 1):
        mujoco.mj_step(model, data)
        if i % record_every == 0:
            traj.append({"t": round(i * model.opt.timestep, 4), "poses": _record(data, body_ids)})
    data.qvel[:] = 0
    mujoco.mj_forward(model, data)
    for a in agents:
        _place_eye(model, data, a, body_ids[f"agent:{a.name}"])
    mujoco.mj_forward(model, data)
    scene = SimScene(spec, objects, agents, xml, model, data, body_ids, traj)
    scene.fingerprint = hashlib.sha256(
        json.dumps({n: [round(float(v), 4) for v in (*data.xpos[b], *data.xquat[b])] for n, b in sorted(body_ids.items())}).encode()
    ).hexdigest()[:8]
    return scene


def spec_dict(spec: SimSceneSpec) -> dict:
    return asdict(spec)
