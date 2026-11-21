"""Question items for MuJoCo scenes.

Produces the same item structure as src/tasks/dataset.ts so that the dataset registry, validator, evaluator
and trainers are shared between the Three.js and the MuJoCo pipelines. Every gold label comes from
egoversa_sim.oracle; nothing is estimated.

Task families
  camera      lateral, depth, vertical, visibility            (frame: viewer camera)
  observer    obs_lateral, obs_frontback, facing              (frame: a robot standing in the scene)
  imagery     obs_lateral_eye                                 (observer left/right, plus the robot's own rendered view)
  physics     support, counterfactual                         (contact forces, forward simulation)
  abstain     relation about an object that is hidden in the image -> "unknown"
  multi-view  mv_camera_motion, mv_best_view                  (two viewer images)
"""
from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass, field
from typing import Optional

import numpy as np

from . import oracle as O
from .scene import SimScene

UNKNOWN = "unknown"
TAU_AZ, TAU_RANGE, TAU_Z, TAU_OBS, FACING_BAND = 4.0, 0.05, 0.03, 12.0, 30.0
VIS_MIN, VIS_OCC, PAIR_VIS, INFRAME_MIN, HIDDEN_MAX = 0.7, 0.3, 0.35, 0.8, 0.03
EYE_MIN_PX = 400  # an object counts as seen by the robot if it covers at least this many pixels of its view
NEAR = 0.25  # metres: physics negatives are drawn from nearby objects only, so they are not trivial

TASK_TYPES = [
    "lateral", "depth", "vertical", "visibility", "obs_lateral", "obs_frontback", "facing",
    "obs_lateral_eye", "support", "counterfactual", "abstain", "mv_camera_motion", "mv_best_view",
]


@dataclass
class Item:
    key: str
    task_type: str
    relation: Optional[str]
    question: str
    options: list[str]
    answer: str
    answerable: bool
    reference_frame: str
    cameras: list[str]  # renderer camera names, one per image, in order
    object_names: list[str]
    template_id: int
    difficulty: str
    explanation: str
    theta_deg: Optional[float] = None
    extra: dict = field(default_factory=dict)


def model_prompt(question: str, options: list[str]) -> str:
    o = options
    lst = f"{o[0]} or {o[1]}" if len(o) == 2 else f"{', '.join(o[:-1])}, or {o[-1]}"
    hint = " If it cannot be determined from what is shown, answer unknown." if UNKNOWN in o else ""
    return f"{question}\nAnswer with exactly one word: {lst}.{hint}"


def _pick(salt: str, key: str, templates: list[int]) -> int:
    return templates[int.from_bytes(hashlib.sha256(f"{salt}|{key}".encode()).digest()[:4], "little") % len(templates)]


def _diff(margin: float) -> str:
    return "hard" if margin < 2 else "medium" if margin < 4 else "easy"


T = {
    "lateral": [
        "From the camera's viewpoint, is the {a} to the left or to the right of the {b}?",
        "Looking at the image, does the {a} appear on the left side or the right side of the {b}?",
        "In this picture, which side of the {b} is the {a} on: left or right?",
    ],
    "depth": [
        "From the camera's viewpoint, is the {a} closer to or farther from the camera than the {b}?",
        "Compared with the {b}, is the {a} closer to the camera or farther from it?",
        "Is the distance from the camera to the {a} smaller (closer) or larger (farther) than the distance to the {b}?",
    ],
    "vertical": [
        "Is the {a} higher (above) or lower (below) than the {b}?",
        "Is the {a} located above or below the {b} in the scene?",
        "Compared with the {b}, is the {a} higher up (above) or lower down (below)?",
    ],
    "visibility": [
        "From the camera's viewpoint, is the {a} mostly visible or mostly occluded?",
        "Can most of the {a} be seen from here (visible), or is most of it hidden behind something (occluded)?",
        "Is the {a} largely in view (visible) or largely blocked from view (occluded)?",
    ],
    "obs_lateral": [
        "Imagine you are the {b}, facing the same way it faces. Is the {a} to your left or to your right?",
        "Put yourself in the place of the {b}, looking where it looks. Is the {a} on your left or on your right?",
        "From the {b}'s own point of view, is the {a} on its left or on its right?",
    ],
    "obs_frontback": [
        "Imagine you are the {b}, facing the same way it faces. Is the {a} in front of you or behind you?",
        "Put yourself in the place of the {b}, looking where it looks. Is the {a} in front of you or behind you?",
        "From the {b}'s own point of view, is the {a} in front of it or behind it?",
    ],
    "facing": [
        "Is the {a} facing toward the camera or away from the camera?",
        "Is the front of the {a} turned toward the camera or away from it?",
        "Does the {a} face the viewer (toward) or face the opposite way (away)?",
    ],
    "support": [
        "Is the {a} resting directly on the {b}?",
        "Is the {b} directly holding up the {a}?",
        "Does the {a} sit right on top of the {b}, touching it and carried by it?",
    ],
    "counterfactual": [
        "If the {b} were taken away, would the {a} move?",
        "Suppose someone removed the {b}. Would the {a} shift or fall?",
        "Would the {a} stay exactly where it is if the {b} disappeared? Answer yes if it would move.",
    ],
}
EYE_PREFIX = [
    "The first image shows the scene. The second image shows exactly what the {b} sees from where it stands. ",
    "Image one is the scene; image two is the view through the {b}'s own eyes. ",
    "You get two pictures: the scene, then the {b}'s own first-person view. ",
]
MOTION_Q = [
    "The two images show the same scene. Between the first image and the second image, did the camera move to its left or to its right around the scene?",
    "Both pictures show one scene from two viewpoints. To get from the first viewpoint to the second, did the camera travel to the left or to the right?",
    "Same scene, two camera positions. Relative to where it started, is the second camera position to the left or to the right of the first?",
]
BEST_Q = [
    "The two images show the same scene from different viewpoints. In which image is more of the {a} visible: the first or the second?",
    "Two views of one scene. Which image gives the clearer, less blocked view of the {a}: the first or the second?",
    "Comparing the two pictures of this scene, the {a} is less hidden in which one, the first or the second?",
]


def view_items(scene: SimScene, rend: O.SceneRenderer, pose: O.ViewerPose, templates: list[int], salt: str,
               support: dict, rollouts: dict[str, O.Rollout]) -> tuple[list[Item], dict]:
    """All items answerable from one viewer image (plus eye images for the imagery condition)."""
    fr = O.place_viewer(scene, pose)
    names = scene.object_names()
    agents = [a.name for a in scene.agents]
    bid = {n: scene.body_ids[f"obj:{n}"] for n in names}
    bid.update({a: scene.body_ids[f"agent:{a}"] for a in agents})
    vis = O.visibility(scene, rend, "viewer", fr, list(bid.values()))
    V = {n: vis[b] for n, b in bid.items()}
    pos = {n: scene.data.xpos[b].copy() for n, b in bid.items()}
    items: list[Item] = []
    tpl = lambda k: _pick(salt, f"{scene.fingerprint}|{k}", templates)  # noqa: E731

    def askable(n: str) -> Optional[str]:
        v = V[n]
        if not v.determinable:
            return f"the {n} projects to too few pixels"
        if v.in_frame < INFRAME_MIN:
            return f"the {n} is partly outside the frame"
        if v.visible < PAIR_VIS:
            return f"the {n} is only {100 * v.visible:.0f}% visible"
        return None

    def hidden(n: str) -> bool:
        v = V[n]
        return v.determinable and v.in_frame >= INFRAME_MIN and v.visible <= HIDDEN_MAX

    def shown(n: str) -> bool:
        v = V[n]
        return v.determinable and v.in_frame >= INFRAME_MIN and v.visible >= 0.5

    def abstain_item(rel: str, a: str, b: str, frame: str, opts: list[str]) -> None:
        h = a if hidden(a) else b
        if not ((hidden(a) and shown(b)) or (hidden(b) and shown(a))):
            return
        k = f"abstain:{rel}:{a}:{b}"
        v = tpl(k)
        items.append(Item(k, "abstain", rel, T[rel][v].format(a=a, b=b), opts + [UNKNOWN], UNKNOWN, False, frame, ["viewer"], [a, b], v, "medium",
                          f"The {h} is {100 * V[h].visible:.0f}% visible from this viewpoint, so the relation cannot be determined from the image."))

    # ---- camera frame pairs ----
    for i, A in enumerate(names):
        for B in names[i + 1:]:
            a, b = (A, B) if int(hashlib.sha256(f"{scene.fingerprint}|{A}|{B}".encode()).hexdigest(), 16) & 1 else (B, A)
            blocked = askable(a) or askable(b)
            ta, ra = O.bearing_range(fr, pos[a])
            tb, rb = O.bearing_range(fr, pos[b])
            mean_r = (ra + rb) / 2
            for rel, va, vb, tau, unit, sym, gold_first, opts in (
                ("lateral", ta, tb, TAU_AZ, "deg", "theta", ta < tb, ["left", "right"]),
                ("depth", ra, rb, TAU_RANGE * mean_r, "m", "rho", ra < rb, ["closer", "farther"]),
                ("vertical", pos[a][2], pos[b][2], TAU_Z * mean_r, "m", "z", pos[a][2] > pos[b][2], ["above", "below"]),
            ):
                if blocked:
                    abstain_item(rel, a, b, "camera" if rel != "vertical" else "gravity", opts)
                    continue
                delta = va - vb
                if abs(delta) < tau:
                    continue
                k = f"{rel}:{a}:{b}"
                v = tpl(k)
                items.append(Item(k, rel, rel, T[rel][v].format(a=a, b=b), opts + [UNKNOWN], opts[0] if gold_first else opts[1], True,
                                  "camera" if rel != "vertical" else "gravity", ["viewer"], [a, b], v, _diff(abs(delta) / tau),
                                  f"{sym}({a}) = {va:.3f} {unit}, {sym}({b}) = {vb:.3f} {unit}; delta = {delta:.3f}, tau = {tau:.3f}"))
    # ---- visibility ----
    for n in names:
        v = V[n]
        if not v.determinable or v.in_frame < INFRAME_MIN or VIS_OCC < v.visible < VIS_MIN:
            continue
        k = f"visibility:{n}"
        t = tpl(k)
        items.append(Item(k, "visibility", "visibility", T["visibility"][t].format(a=n), ["visible", "occluded"], "visible" if v.visible >= VIS_MIN else "occluded", True,
                          "camera", ["viewer"], [n], t, _diff(10 * max(v.visible - VIS_MIN, VIS_OCC - v.visible)),
                          f"f = {v.modal_px}/{v.amodal_px} unoccluded silhouette pixels = {100 * v.visible:.0f}%"))
    # ---- observer frame, facing, imagery ----
    eye_cache: dict[str, np.ndarray] = {}

    def eye_px(ag: str, n: str) -> int:
        if ag not in eye_cache:
            eye_cache[ag] = rend.body_seg(f"eye:{ag}")
        return int((eye_cache[ag] == bid[n]).sum())

    for ag in agents:
        if askable(ag):
            continue
        theta = O.heading_offset(scene, ag, fr)
        alpha = O.facing_alpha(scene, ag, fr)
        kind = next(a.kind for a in scene.agents if a.name == ag)
        # Facing is asked only about robots with a visible face (the humanoid); the Stretch has no front face.
        if kind in ("humanoid", "toy") and abs(alpha - 90) >= FACING_BAND:
            k = f"facing:{ag}"
            t = tpl(k)
            items.append(Item(k, "facing", "facing", T["facing"][t].format(a=ag), ["toward", "away"], "toward" if alpha < 90 else "away", True, "camera", ["viewer"], [ag], t,
                              _diff(abs(alpha - 90) / FACING_BAND), f"alpha({ag}) = {alpha:.1f} deg", theta))
        for n in names:
            phi, psi = O.observer_angles(scene, ag, pos[n])
            for rel, val, opts, first in (("obs_lateral", phi, ["left", "right"], phi < 0), ("obs_frontback", psi, ["front", "behind"], psi > 0)):
                if askable(n):
                    abstain_item(rel, n, ag, "observer", opts)
                    continue
                if abs(val) < TAU_OBS:
                    continue
                k = f"{rel}:{n}:{ag}"
                t = tpl(k)
                q = T[rel][t].format(a=n, b=ag)
                gold = opts[0] if first else opts[1]
                expl = f"{'phi' if rel == 'obs_lateral' else 'psi'}({n} | {ag}) = {val:.1f} deg, tau = {TAU_OBS} deg; heading offset {theta:.0f} deg"
                items.append(Item(k, rel, rel, q, opts + [UNKNOWN], gold, True, "observer", ["viewer"], [n, ag], t, _diff(abs(val) / TAU_OBS), expl, theta))
                # Imagery condition: identical question and gold, plus the robot's own rendered view. Only for left/right,
                # and only when the object is actually visible in the robot's view (so the extra image contains the answer).
                if rel == "obs_lateral" and eye_px(ag, n) >= EYE_MIN_PX:
                    items[-1].extra["pair"] = f"{k}:eye"
                    items.append(Item(f"{k}:eye", "obs_lateral_eye", rel, EYE_PREFIX[t].format(b=ag) + q, opts + [UNKNOWN], gold, True, "observer",
                                      ["viewer", f"eye:{ag}"], [n, ag], t, _diff(abs(val) / TAU_OBS), expl + "; second image rendered from the robot's head camera", theta,
                                      {"pair": k}))
    # ---- physics: support ----
    for a in names:
        if askable(a):
            continue
        sup = support.get(a, [])
        cands = [(b, b in sup) for b in names if b != a and not askable(b) and (b in sup or np.linalg.norm(pos[a][:2] - pos[b][:2]) < NEAR)]
        cands.append(("table", "table" in sup))
        for b, yes in cands:
            k = f"support:{a}:{b}"
            t = tpl(k)
            items.append(Item(k, "support", "support", T["support"][t].format(a=a, b=b), ["yes", "no"], "yes" if yes else "no", True, "physical", ["viewer"], [a, b], t,
                              "medium", f"supporters of the {a} (normal force >= 20% of its weight): {', '.join(sup) or 'none'}"))
    # ---- physics: counterfactual removal ----
    for b, ro in rollouts.items():
        if askable(b):
            continue
        for a, disp in ro.displacement.items():
            if a == b or askable(a):
                continue
            near = np.linalg.norm(pos[a][:2] - pos[b][:2]) < NEAR
            if not near and disp < O.MOVE_YES:
                continue  # far-away "no" questions are trivial
            if O.MOVE_NO <= disp <= O.MOVE_YES:
                continue  # ambiguous
            k = f"counterfactual:{a}:{b}"
            t = tpl(k)
            items.append(Item(k, "counterfactual", "counterfactual", T["counterfactual"][t].format(a=a, b=b), ["yes", "no"], "yes" if disp > O.MOVE_YES else "no", True,
                              "physical", ["viewer"], [a, b], t, "easy" if disp > 0.08 or disp < 0.003 else "hard",
                              f"simulated {ro_seconds(ro)} s after removing the {b}: the {a} moved {100 * disp:.1f} cm (yes if > {100 * O.MOVE_YES:.0f} cm, no if < {100 * O.MOVE_NO:.0f} cm)"))
    return items, {"vis": V, "frame": fr}


def ro_seconds(ro: O.Rollout) -> str:
    return f"{ro.trajectory[-1]['t'] + 0.04:.1f}" if ro.trajectory else "1.2"


def pair_items(scene: SimScene, pose_a: O.ViewerPose, pose_b: O.ViewerPose, va: dict, vb: dict, templates: list[int], salt: str) -> list[Item]:
    items: list[Item] = []
    d = (pose_b.azimuth_deg - pose_a.azimuth_deg + 180) % 360 - 180
    tpl = lambda k: _pick(salt, f"{scene.fingerprint}|{k}", templates)  # noqa: E731
    if 25 <= abs(d) <= 110:
        t = tpl("motion")
        # Azimuth increases counter-clockwise seen from above (camera on -Y at 0 deg), i.e. toward the camera's own right.
        items.append(Item("mv_camera_motion", "mv_camera_motion", None, MOTION_Q[t], ["left", "right"], "right" if d > 0 else "left", True, "multi-view",
                          ["viewer_a", "viewer_b"], [], t, "hard" if abs(d) < 45 else "medium" if abs(d) < 75 else "easy", f"camera azimuth changed by {d:.0f} deg"))
    for n in scene.object_names():
        a, b = va[n], vb[n]
        if not (a.determinable and b.determinable and a.in_frame >= INFRAME_MIN and b.in_frame >= INFRAME_MIN):
            continue
        delta = a.visible - b.visible
        if abs(delta) < 0.4:
            continue
        t = tpl(f"best:{n}")
        items.append(Item(f"mv_best_view:{n}", "mv_best_view", None, BEST_Q[t].format(a=n), ["first", "second"], "first" if delta > 0 else "second", True, "multi-view",
                          ["viewer_a", "viewer_b"], [n], t, "hard" if abs(delta) < 0.6 else "medium" if abs(delta) < 0.8 else "easy",
                          f"unoccluded fraction of the {n}: {100 * a.visible:.0f}% vs {100 * b.visible:.0f}%"))
    return items
