#!/usr/bin/env python3
"""Export recorded MuJoCo scenes for the web app's Physics Lab (public/sim/*.json).

    research/.conda/bin/python research/scripts/export_sim_scenes.py --count 6

Each file holds the geometry of every geom, the settle trajectory of every object (as recorded during the
simulation), one removal rollout per supporting object, the contact-force support graph, the robots' poses and a
handful of oracle-labelled questions. The browser only replays these recordings; it never simulates or labels.
Seeds come from their own namespace (egv-sim-showcase/...), disjoint from every dataset split.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
from pathlib import Path

os.environ.setdefault("MUJOCO_GL", "cgl")
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "research"))

import mujoco  # noqa: E402
import numpy as np  # noqa: E402

from egoversa_sim import __version__ as SIM_VERSION  # noqa: E402
from egoversa_sim import oracle as O  # noqa: E402
from egoversa_sim.questions import model_prompt, view_items  # noqa: E402
from egoversa_sim.scene import EYE_FOVY, HELD_OUT_ASSETS, TABLE_TOP_Z, SimSceneSpec, build_scene, spec_dict  # noqa: E402

GEOM_TYPES = {int(mujoco.mjtGeom.mjGEOM_MESH): "mesh", int(mujoco.mjtGeom.mjGEOM_PLANE): "plane", int(mujoco.mjtGeom.mjGEOM_BOX): "box", int(mujoco.mjtGeom.mjGEOM_SPHERE): "sphere",
              int(mujoco.mjtGeom.mjGEOM_CYLINDER): "cylinder", int(mujoco.mjtGeom.mjGEOM_CAPSULE): "capsule", int(mujoco.mjtGeom.mjGEOM_ELLIPSOID): "ellipsoid"}
R = lambda v, n=4: [round(float(x), n) for x in v]  # noqa: E731


def body_label(scene, b: int) -> str:
    for n, i in scene.body_ids.items():
        if i == b:
            return n
    return "static"


class MeshStore:
    """Writes each visual mesh once to public/sim/assets/<key>.bin (+ <key>.jpg texture) and returns its reference.

    Binary layout, little endian: float32 positions [nv*3], float32 uvs [nv*2] (if textured), uint16/uint32 indices
    [nf*3]. Scanned objects keep their full mesh and texture; robot meshes (untextured CAD, up to 70k faces per part)
    are simplified by vertex clustering on a `robot_cell` grid, which keeps the silhouette at the Physics Lab's scale."""

    def __init__(self, out: Path, robot_cell: float = 0.006, tex_px: int = 512):
        self.dir = out / "assets"
        self.dir.mkdir(parents=True, exist_ok=True)
        self.robot_cell, self.tex_px = robot_cell, tex_px
        self.done: dict[str, dict] = {}
        self.bytes = 0

    def ref(self, m, g: int, key: str, simplify: bool) -> dict:
        if key in self.done:
            return self.done[key]
        mid = int(m.geom_dataid[g])
        va, nv = int(m.mesh_vertadr[mid]), int(m.mesh_vertnum[mid])
        fa, nf = int(m.mesh_faceadr[mid]), int(m.mesh_facenum[mid])
        verts = np.asarray(m.mesh_vert[va:va + nv], dtype=np.float32)
        faces = np.asarray(m.mesh_face[fa:fa + nf], dtype=np.int64)
        mat = int(m.geom_matid[g])
        tex = int(m.mat_texid[mat][1]) if mat >= 0 else -1
        uv = None
        if tex >= 0 and m.mesh_texcoordnum[mid] > 0 and not simplify:
            ta = int(m.mesh_texcoordadr[mid])
            tc = np.asarray(m.mesh_texcoord[ta:ta + int(m.mesh_texcoordnum[mid])], dtype=np.float32)
            ft = np.asarray(m.mesh_facetexcoord[fa:fa + nf], dtype=np.int64)
            pairs, inv = np.unique(np.stack([faces.ravel(), ft.ravel()], 1), axis=0, return_inverse=True)
            verts, uv, faces = verts[pairs[:, 0]], tc[pairs[:, 1]], inv.reshape(-1, 3)
        elif simplify:
            verts, faces = _cluster(verts, faces, self.robot_cell)
        idx = faces.astype(np.uint16 if len(verts) < 65536 else np.uint32)
        blob = verts.astype("<f4").tobytes() + (uv.astype("<f4").tobytes() if uv is not None else b"") + idx.tobytes()
        safe = key.replace("/", "_").replace(":", "_")
        (self.dir / f"{safe}.bin").write_bytes(blob)
        entry = {"file": f"assets/{safe}.bin", "nv": int(len(verts)), "nf": int(len(faces)), "uv": uv is not None, "index32": idx.dtype == np.uint32}
        if uv is not None:
            from PIL import Image
            w, h, c = int(m.tex_width[tex]), int(m.tex_height[tex]), int(m.tex_nchannel[tex])
            px = np.asarray(m.tex_data[m.tex_adr[tex]:m.tex_adr[tex] + w * h * c], dtype=np.uint8).reshape(h, w, c)
            im = Image.fromarray(px[..., :3])
            im.thumbnail((self.tex_px, self.tex_px))
            im.save(self.dir / f"{safe}.jpg", quality=85)
            entry["texture"] = f"assets/{safe}.jpg"
            self.bytes += (self.dir / f"{safe}.jpg").stat().st_size
        self.bytes += len(blob)
        self.done[key] = entry
        return entry


def _cluster(verts: np.ndarray, faces: np.ndarray, cell: float) -> tuple[np.ndarray, np.ndarray]:
    """Vertex-clustering simplification: merge vertices that share a grid cell, drop collapsed and duplicate faces."""
    keys = np.floor(verts / cell).astype(np.int64)
    _, inv, counts = np.unique(keys, axis=0, return_inverse=True, return_counts=True)
    inv = inv.ravel()
    pos = np.zeros((len(counts), 3))
    np.add.at(pos, inv, verts)
    pos /= counts[:, None]
    f = inv[faces]
    f = f[(f[:, 0] != f[:, 1]) & (f[:, 1] != f[:, 2]) & (f[:, 0] != f[:, 2])]
    if len(f) == 0:
        return verts, faces
    _, keep = np.unique(np.sort(f, 1), axis=0, return_index=True)
    return pos.astype(np.float32), f[np.sort(keep)]


def export(scene, store: "MeshStore") -> dict:
    m, d = scene.model, scene.data
    geoms = []
    obj_asset = {f"obj:{o.name}": o.asset for o in scene.objects}
    agent_kind = {f"agent:{a.name}": a.kind for a in scene.agents}
    for g in range(m.ngeom):
        t = GEOM_TYPES.get(int(m.geom_type[g]))
        name = mujoco.mj_id2name(m, mujoco.mjtObj.mjOBJ_GEOM, g) or ""
        if t is None or t == "plane" or m.geom_group[g] > 2 or (m.geom_rgba[g][3] == 0 and t != "mesh"):
            continue  # the floor is drawn by the app; collision-only geoms (group 3) are not drawn
        b = int(m.geom_bodyid[g])
        label = body_label(scene, int(m.body_rootid[b]))
        if t == "mesh":
            if m.geom_contype[g] != 0 and label.startswith("obj:"):
                continue  # convex collision pieces of scanned objects
            mesh_name = mujoco.mj_id2name(m, mujoco.mjtObj.mjOBJ_MESH, int(m.geom_dataid[g])) or str(g)
            if label.startswith("obj:"):
                key = f"gso:{obj_asset[label]}:{mesh_name.split('/', 1)[-1]}"
            else:
                key = f"robot:{agent_kind.get(label, 'static')}:{mesh_name.split('/', 1)[-1]}"
            mesh_ref = store.ref(m, g, key, simplify=not label.startswith("obj:"))
        else:
            mesh_ref = None
        rgba = m.geom_rgba[g]
        if name == "tabletop":
            rgba = [0.55, 0.40, 0.28, 1]
        elif m.geom_matid[g] >= 0 and label == "static":
            rgba = m.mat_rgba[m.geom_matid[g]]
        if m.geom_matid[g] >= 0 and label.startswith("agent:"):
            rgba = m.mat_rgba[m.geom_matid[g]]
        entry = {"type": t, "size": R(m.geom_size[g]), "rgba": R(rgba, 3), "body": label, "pos": R(m.geom_pos[g]), "quat": R(m.geom_quat[g])}
        if mesh_ref:
            entry["mesh"] = mesh_ref
        if not label.startswith("obj:"):  # static scenery and robots (frozen in place): world pose
            entry.update(pos=R(d.geom_xpos[g]), quat=R(_mat2quat(d.geom_xmat[g])))
        elif b != int(m.body_rootid[b]):
            raise ValueError("scanned objects are single bodies")
        if name.startswith("") and m.geom_matid[g] >= 0 and mujoco.mj_id2name(m, mujoco.mjtObj.mjOBJ_MATERIAL, int(m.geom_matid[g])) == "visor":
            entry["emissive"] = True
        geoms.append(entry)
    support = O.support_graph(scene)
    carriers = sorted({s for v in support.values() for s in v if s in scene.object_names()})  # only objects can be removed
    rollouts = []
    for b in carriers[:4]:
        ro = O.remove_and_rollout(scene, b, seconds=1.5, record_every=12)
        rollouts.append({"removed": b, "displacement_cm": {k: round(100 * v, 1) for k, v in ro.displacement.items()},
                         "frames": [{"t": f["t"], "poses": {k.split(":", 1)[1]: R(v) for k, v in f["poses"].items()}} for f in ro.trajectory]})
    agents = []
    for a in scene.agents:
        bid = scene.body_ids[f"agent:{a.name}"]
        f = O.agent_heading(scene, a.name)
        agents.append({"name": a.name, "kind": a.kind, "pos": R(d.xpos[bid]), "quat": R(d.xquat[bid]), "heading": R(f), "height": a.height,
                       "eye": {"pos": R(d.cam_xpos[mujoco.mj_name2id(m, mujoco.mjtObj.mjOBJ_CAMERA, f"eye:{a.name}")]),
                               "mat": R(d.cam_xmat[mujoco.mj_name2id(m, mujoco.mjtObj.mjOBJ_CAMERA, f"eye:{a.name}")]), "fovy": EYE_FOVY}})
    # oracle-labelled questions from one viewer pose, a few per task family
    rend = O.SceneRenderer(scene, 256, 192)
    pose = O.ViewerPose(25.0, 1.45, 1.35)
    ro_all = {b: O.remove_and_rollout(scene, b) for b in carriers[:4]}
    items, _ = view_items(scene, rend, pose, [0], "showcase", support, ro_all)
    rend.close()
    picked, seen = [], {}
    for it in items:
        if it.task_type in ("obs_lateral_eye", "abstain"):
            continue
        if seen.get(it.task_type, 0) >= 2:
            continue
        seen[it.task_type] = seen.get(it.task_type, 0) + 1
        picked.append({"task": it.task_type, "question": it.question, "options": it.options, "answer": it.answer, "explanation": it.explanation, "objects": it.object_names})
    traj = [{"t": f["t"], "poses": {k.split(":", 1)[1]: R(v) for k, v in f["poses"].items()}} for f in scene.settle_trajectory]
    return {
        "format": "egoversa.sim-scene", "version": 1, "engine": f"egoversa-sim-{SIM_VERSION}", "simulator": f"MuJoCo {mujoco.__version__}",
        "spec": spec_dict(scene.spec), "fingerprint": scene.fingerprint, "table_top_z": TABLE_TOP_Z, "focus": R(O.FOCUS),
        "objects": [{"name": o.name, "noun": o.noun, "color": o.color, "geom": o.geom, "mass": round(o.mass, 3), "asset": o.asset} for o in scene.objects],
        "geoms": geoms, "settle": traj, "support": support, "rollouts": rollouts, "agents": agents, "viewer": pose.as_dict(), "questions": picked,
    }


def _mat2quat(mat) -> np.ndarray:
    q = np.zeros(4)
    mujoco.mju_mat2Quat(q, np.asarray(mat, dtype=float))
    return q


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--count", type=int, default=6)
    ap.add_argument("--out", type=Path, default=ROOT / "public" / "sim")
    a = ap.parse_args()
    a.out.mkdir(parents=True, exist_ok=True)
    store = MeshStore(a.out)
    index, i = [], 0
    while len(index) < a.count and i < 200:
        spec = SimSceneSpec(seed=f"egv-sim-showcase/{i}", n_objects=8, n_agents=2 if i % 2 else 1, stack_prob=0.6, exclude=list(HELD_OUT_ASSETS))
        i += 1
        scene = build_scene(spec, record_every=10)
        data = export(scene, store)
        if not any(max(r["displacement_cm"].values(), default=0) > 3 for r in data["rollouts"]):
            continue  # showcase only scenes where removing something actually makes something else move
        fname = f"scene-{len(index) + 1}.json"
        (a.out / fname).write_text(json.dumps(data, separators=(",", ":")))
        stacks = sum(1 for v in data["support"].values() if any(s not in ("table", "floor") for s in v))
        index.append({"file": fname, "seed": spec.seed, "fingerprint": scene.fingerprint, "objects": len(data["objects"]), "agents": len(data["agents"]),
                      "stacked": stacks, "rollouts": len(data["rollouts"]), "bytes": (a.out / fname).stat().st_size})
        print(f"{fname}: {spec.seed} {stacks} stacked objects, {len(data['rollouts'])} rollouts, {index[-1]['bytes'] // 1024} KB")
    print(f"mesh assets: {len(store.done)} meshes, {store.bytes / 1e6:.1f} MB")
    (a.out / "index.json").write_text(json.dumps({"format": "egoversa.sim-index", "version": 1, "simulator": f"MuJoCo {mujoco.__version__}", "scenes": index}, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
