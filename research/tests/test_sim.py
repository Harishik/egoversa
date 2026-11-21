"""Tests for the MuJoCo verifier (research/egoversa_sim). Physics tests need only MuJoCo; rendering tests need an
OpenGL context and are skipped where none is available (e.g. inside a restricted sandbox)."""
import json
import math
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "research"))
mujoco = pytest.importorskip("mujoco")

from egoversa_sim import oracle as O  # noqa: E402
from egoversa_sim.scene import TABLE_TOP_Z, AgentSpec, ObjSpec, SimSceneSpec, build_scene  # noqa: E402


def _gl_ok() -> bool:
    try:
        s = build_scene(SimSceneSpec("gl-probe", 5, 1))
        r = O.SceneRenderer(s, 64, 48)
        r.rgb("viewer")
        r.close()
        return True
    except Exception:
        return False


GL = _gl_ok()
needs_gl = pytest.mark.skipif(not GL, reason="no OpenGL context (MUJOCO_GL=cgl needs the window server; egl on Linux)")


def box(name, x, y, z, half=0.04, mass=0.3):
    return ObjSpec(name, name.split()[-1], name.split()[0], "box", [half, half, half], [x, y, z], [0, 0, 0], mass, True)


def test_scene_is_deterministic_and_named_cleanly():
    a = build_scene(SimSceneSpec("det-1", 8, 2))
    b = build_scene(SimSceneSpec("det-1", 8, 2))
    c = build_scene(SimSceneSpec("det-2", 8, 2))
    assert a.fingerprint == b.fingerprint and a.fingerprint != c.fingerprint
    names = a.object_names() + [g.name for g in a.agents]
    assert len(set(names)) == len(names)
    assert not any(ch.isdigit() for n in names for ch in n)  # prompts must stay digit-free


def test_objects_settle_at_rest_on_the_table():
    s = build_scene(SimSceneSpec("rest-1", 7, 1))
    assert float(abs(s.data.qvel).max()) == 0.0
    zs = [s.data.xpos[s.body_ids["obj:" + n]][2] for n in s.object_names()]
    assert sum(z > TABLE_TOP_Z - 0.01 for z in zs) >= len(zs) - 1  # at most one object may roll off


def test_viewer_frame_is_orthonormal_and_follows_the_convention():
    fr = O.viewer_frame(O.ViewerPose(0, 1.4, 1.3))
    assert fr.pos[1] < 0  # azimuth 0 = camera on the -Y side
    for u, v in [(fr.right, fr.up), (fr.right, fr.forward), (fr.up, fr.forward)]:
        assert abs(float(u @ v)) < 1e-9
    assert abs(fr.right[2]) < 1e-9 and fr.up[2] > 0  # upright camera, no roll
    # a point to the +X side is to the camera's right at azimuth 0 and to its left at azimuth 180
    p = O.FOCUS + [0.3, 0, 0]
    assert O.bearing_range(O.viewer_frame(O.ViewerPose(0, 1.4, 1.3)), p)[0] > 0
    assert O.bearing_range(O.viewer_frame(O.ViewerPose(180, 1.4, 1.3)), p)[0] < 0


def test_observer_angles_use_the_robots_heading():
    objs = [box("red block", 0.0, 0.25, TABLE_TOP_Z + 0.05), box("blue block", 0.25, 0.0, TABLE_TOP_Z + 0.05)]
    # robot at the origin facing +X: +X is in front, +Y is on its LEFT (z-up, right-handed)
    s = build_scene(SimSceneSpec("obs"), objects=objs, agents=[AgentSpec("green robot", "green", [-0.2, 0, TABLE_TOP_Z], 0.0, 0.26)])
    phi_r, psi_r = O.observer_angles(s, "green robot", s.data.xpos[s.body_ids["obj:red block"]])
    phi_b, psi_b = O.observer_angles(s, "green robot", s.data.xpos[s.body_ids["obj:blue block"]])
    assert psi_b > 60 and abs(phi_b) < 20  # blue is straight ahead
    assert phi_r < -20  # red (+Y side) is on the robot's left
    s2 = build_scene(SimSceneSpec("obs"), objects=objs, agents=[AgentSpec("green robot", "green", [-0.2, 0, TABLE_TOP_Z], math.pi, 0.26)])
    assert O.observer_angles(s2, "green robot", s2.data.xpos[s2.body_ids["obj:red block"]])[0] > 20  # turn around: now on its right


def test_support_graph_and_counterfactual_removal():
    objs = [box("red block", 0.1, 0.1, TABLE_TOP_Z + 0.045), box("blue block", 0.1, 0.1, TABLE_TOP_Z + 0.16, mass=0.2),
            box("green block", -0.25, -0.1, TABLE_TOP_Z + 0.045)]
    s = build_scene(SimSceneSpec("stack"), objects=objs, agents=[])
    sup = O.support_graph(s)
    assert sup["blue block"] == ["red block"]
    assert sup["red block"] == ["table"] and sup["green block"] == ["table"]
    under = O.remove_and_rollout(s, "red block")
    assert under.displacement["blue block"] > O.MOVE_YES  # the top block falls when its support is removed
    assert under.displacement["green block"] < O.MOVE_NO
    top = O.remove_and_rollout(s, "blue block")
    assert top.displacement["red block"] < O.MOVE_NO  # removing the top block does not move the bottom one
    assert s.data.xpos[s.body_ids["obj:blue block"]][2] > TABLE_TOP_Z + 0.1  # the scene itself is untouched


@needs_gl
def test_visibility_from_segmentation_detects_occlusion():
    # small block hidden right behind a large crate as seen from azimuth 0 (camera on -Y)
    objs = [ObjSpec("green crate", "crate", "green", "box", [0.12, 0.03, 0.1], [0, -0.05, TABLE_TOP_Z + 0.1], [0, 0, 0], 1.0, True),
            box("red block", 0, 0.12, TABLE_TOP_Z + 0.03, half=0.03)]
    s = build_scene(SimSceneSpec("occ"), objects=objs, agents=[])
    r = O.SceneRenderer(s)
    pose = O.ViewerPose(0, TABLE_TOP_Z + 0.25, 1.2)
    fr = O.place_viewer(s, pose)
    ids = [s.body_ids["obj:red block"], s.body_ids["obj:green crate"]]
    front = O.visibility(s, r, "viewer", fr, ids)
    assert front[ids[0]].visible < 0.1 and front[ids[0]].amodal_px > 150
    assert front[ids[1]].visible > 0.95
    fr2 = O.place_viewer(s, O.ViewerPose(180, TABLE_TOP_Z + 0.25, 1.2))
    back = O.visibility(s, r, "viewer", fr2, ids)
    assert back[ids[0]].visible > 0.9  # seen from the other side the block is in plain view
    r.close()


def test_grpo_rewards():
    sys.path.insert(0, str(ROOT / "research" / "scripts"))
    from train_grpo import reward

    rec = {"oracle": {"answer": "left", "options": ["left", "right", "unknown"]}, "metadata": {"theta_deg": 160.0}}
    assert reward("Left.", rec, False)["answer"] == 1.0
    assert reward("right", rec, False)["answer"] == 0.0
    assert reward("unknown", rec, False)["abstain"] == -0.25
    hidden = {"oracle": {"answer": "unknown", "options": ["left", "right", "unknown"]}, "metadata": {"theta_deg": None}}
    assert reward("left", hidden, False)["abstain"] == -0.5
    r = reward("facing: toward; answer: left", rec, True)
    assert r["answer"] == 1.0 and r["frame"] == 0.3
    assert reward("facing: away; answer: left", rec, True)["frame"] == 0.0


@pytest.mark.skipif(not (ROOT / "research/data/egoversa-sim-smoke").exists(), reason="build the MuJoCo smoke dataset first")
def test_sim_smoke_dataset_passes_the_shared_validator():
    from egoversa_research.dataset import read_jsonl, validate_dataset

    d = ROOT / "research/data/egoversa-sim-smoke"
    rep = validate_dataset(d)
    assert rep.ok, rep.errors
    rows = read_jsonl(d / "registry/train.jsonl")
    tasks = {r["task_type"] for r in rows}
    assert {"support", "counterfactual", "obs_lateral", "obs_lateral_eye"} <= tasks
    # every imagery item has its plain twin in the same split (paired ablation)
    plain = {(r["image_paths"][0], r["prompt"].split("Put yourself")[-1].split("Imagine you are")[-1][-60:]) for r in rows if r["task_type"] == "obs_lateral"}
    for r in rows:
        if r["task_type"] == "obs_lateral_eye":
            assert len(r["image_paths"]) == 2 and r["metadata"]["cameras"][1]["camera"].startswith("eye:")


realistic = pytest.mark.skipif(not __import__("egoversa_sim.scene", fromlist=["x"]).assets_available(), reason="run research/scripts/fetch_assets.py")


@realistic
def test_realistic_scene_uses_scanned_objects_and_frozen_real_robots():
    from egoversa_sim.scene import ASSET_TABLE, HELD_OUT_ASSETS, ROBOTS

    s = build_scene(SimSceneSpec("real-test", 8, 2, 0.4, exclude=HELD_OUT_ASSETS))
    m, d = s.model, s.data
    assert all(o.asset in ASSET_TABLE and o.asset not in HELD_OUT_ASSETS for o in s.objects)
    assert {a.kind for a in s.agents} <= set(ROBOTS)
    for a in s.agents:
        root = s.body_ids[f"agent:{a.name}"]
        robot_bodies = [b for b in range(m.nbody) if m.body_rootid[b] == root]
        assert len(robot_bodies) > 10  # a real articulated model, not a box
        assert not any(m.body_jntnum[b] for b in robot_bodies)  # frozen: no joints left
        cid = mujoco.mj_name2id(m, mujoco.mjtObj.mjOBJ_CAMERA, f"eye:{a.name}")
        eye = d.cam_xpos[cid]
        assert 1.0 < eye[2] < 1.6  # head height of a ~1.3-1.4 m robot
        assert d.cam_xmat[cid].reshape(3, 3)[2, 2] > 0.3  # camera z (backwards) tilts up = looking down
    for o in s.objects:
        b = s.body_ids[f"obj:{o.name}"]
        assert abs(m.body_subtreemass[b] - ASSET_TABLE[o.asset][2]) < 0.02  # realistic mass, not solid water


@realistic
def test_held_out_assets_appear_only_when_allowed():
    from egoversa_sim.scene import HELD_OUT_ASSETS, sample_scene

    seen = set()
    for i in range(40):
        objs, _ = sample_scene(SimSceneSpec(f"ho-{i}", 9, 1, 0.3, exclude=HELD_OUT_ASSETS))
        seen |= {o.asset for o in objs}
    assert not seen & set(HELD_OUT_ASSETS)
    seen_ood = {o.asset for i in range(40) for o in sample_scene(SimSceneSpec(f"ho-{i}", 9, 1, 0.3))[0]}
    assert seen_ood & set(HELD_OUT_ASSETS)


def test_vertex_clustering_simplifies_and_keeps_valid_faces():
    import importlib.util
    import numpy as np
    spec = importlib.util.spec_from_file_location("export_sim_scenes", Path(__file__).resolve().parents[1] / "scripts" / "export_sim_scenes.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    g = np.linspace(0, 0.1, 41)  # a 4 mm-spaced grid of quads in the z=0 plane
    xx, yy = np.meshgrid(g, g)
    verts = np.stack([xx.ravel(), yy.ravel(), np.zeros(xx.size)], 1).astype(np.float32)
    n = len(g)
    faces = np.array([[i * n + j, i * n + j + 1, (i + 1) * n + j] for i in range(n - 1) for j in range(n - 1)]
                     + [[i * n + j + 1, (i + 1) * n + j + 1, (i + 1) * n + j] for i in range(n - 1) for j in range(n - 1)])
    v2, f2 = mod._cluster(verts, faces, 0.012)
    assert len(f2) < len(faces) / 4 and len(f2) > 0
    assert f2.max() < len(v2) and np.all(f2[:, 0] != f2[:, 1])
    assert np.allclose(v2.min(0)[:2], 0, atol=0.01) and np.allclose(v2.max(0)[:2], 0.1, atol=0.01)  # silhouette kept
