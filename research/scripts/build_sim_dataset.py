#!/usr/bin/env python3
"""Build an EgoVersa-Sim dataset from MuJoCo scenes (same on-disk format as scripts/build-dataset.ts).

    MUJOCO_GL=cgl research/.conda/bin/python research/scripts/build_sim_dataset.py --config research/configs/sim.smoke.json
    ... --splits train,val      build only some splits (test splits are always verified against the lock)
    ... --relock                deliberately rebuild the locked test splits
    ... --dry-run               generate and count, write nothing

Layout under research/data/<name>/ : images/<split>/<sha[:20]>.png, registry/, model_inputs/, sft/, manifest.json,
holdout.lock.json. Test splits are built first and locked by digest; train/val may not reuse any locked scene
fingerprint or image hash. Validate with research/scripts/validate_dataset.py.

Rendering needs an OpenGL context (macOS: MUJOCO_GL=cgl with access to the window server; Linux: MUJOCO_GL=egl).
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import math
import os
import sys
import time
from pathlib import Path

os.environ.setdefault("MUJOCO_GL", "cgl")
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "research"))

import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402

from egoversa_research.dataset import write_jsonl, sha256_file  # noqa: E402
from egoversa_sim import __version__ as SIM_VERSION  # noqa: E402
from egoversa_sim import oracle as O  # noqa: E402
from egoversa_sim.questions import Item, model_prompt, pair_items, view_items  # noqa: E402
from egoversa_sim.scene import HELD_OUT_ASSETS, HELD_OUT_NOUNS, SimSceneSpec, build_scene, spec_dict  # noqa: E402

SPLITS = ["test_iid", "test_ood", "val", "train"]
TEST = {"test_iid", "test_ood"}
ENGINE = f"egoversa-sim-{SIM_VERSION}"


def sha(b: bytes | str) -> str:
    return hashlib.sha256(b if isinstance(b, bytes) else b.encode()).hexdigest()


def policy(split: str) -> dict:
    ood = split == "test_ood"
    return {
        "exclude": [] if ood else HELD_OUT_ASSETS,
        "lightings": ["backlit"] if ood else ["key", "warm", "dim"],
        "templates": [2] if ood else [0, 1],
        "height": (1.2, 2.1) if ood else (1.35, 1.9),
        "distance": (1.45, 2.6) if ood else (1.6, 2.3),
    }


def apply_lighting(scene, lighting: str) -> None:
    m = scene.model
    key = 0  # first light in the MJCF is the key light
    if lighting == "warm":
        m.light_diffuse[key] = [1.0, 0.82, 0.6]
    elif lighting == "dim":
        m.light_diffuse[key] *= 0.45
        m.vis.headlight.diffuse[:] = [0.3, 0.3, 0.3]
        m.vis.headlight.ambient[:] = [0.22, 0.22, 0.25]
    elif lighting == "backlit":
        m.light_pos[key] = [-1.4, 1.2, 2.6]
        m.light_dir[key] = [0.45, -0.4, -1.0]
        m.light_diffuse[key] = [1.0, 0.95, 0.9]
        m.vis.headlight.diffuse[:] = [0.35, 0.35, 0.38]
    import mujoco

    mujoco.mj_forward(m, scene.data)


def scene_spec(cfg: dict, split: str, i: int) -> SimSceneSpec:
    seed = f"{cfg['baseSeed']}/{split}/mujoco/{i}"
    r = np.random.default_rng(int(sha(seed + "|params")[:12], 16))
    return SimSceneSpec(seed=seed, n_objects=int(r.integers(6, 10)), n_agents=int(r.integers(1, 3)), stack_prob=float(round(r.uniform(0.3, 0.6), 2)), exclude=policy(split)["exclude"])


def with_pairs(chosen: list[Item], cands: list[Item]) -> list[Item]:
    """Imagery ablation: every selected observer item and its imagery twin are kept together."""
    keys = {c.key for c in chosen}
    by_key = {c.key: c for c in cands}
    out = list(chosen)
    for c in chosen:
        p = c.extra.get("pair")
        if p and p not in keys and p in by_key:
            out.append(by_key[p])
            keys.add(p)
    return out


def balanced(cands: list[Item], k: int, counts: dict, rng: np.random.Generator, per_task: dict | None = None) -> list[Item]:
    """Up to k items per task type (per_task overrides k), preferring the least-represented answer label."""
    by: dict[str, list[Item]] = {}
    for c in [cands[i] for i in rng.permutation(len(cands))]:
        by.setdefault(c.task_type, []).append(c)
    out = []
    for task, lst in by.items():
        tc = counts.setdefault(task, {})
        for _ in range(min((per_task or {}).get(task, k), len(lst))):
            lst.sort(key=lambda it: tc.get(it.answer, 0))
            it = lst.pop(0)
            tc[it.answer] = tc.get(it.answer, 0) + 1
            out.append(it)
    return out


def build_split(cfg: dict, split: str, out: Path, forbid: dict, dry: bool) -> dict:
    pol = policy(split)
    records, counts, fps, img_hashes = [], {}, set(), set()
    img_dir = out / "images" / split
    if not dry:
        img_dir.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    for i in range(cfg["scenes"][split]):
        spec = scene_spec(cfg, split, i)
        scene = build_scene(spec)
        if scene.fingerprint in forbid["fingerprints"]:
            raise SystemExit(f"split integrity: scene {scene.fingerprint} of {split} is in the locked holdout")
        if scene.fingerprint in fps:
            continue
        fps.add(scene.fingerprint)
        r = np.random.default_rng(int(sha(spec.seed + "|camera")[:12], 16))
        lighting = pol["lightings"][int(r.integers(len(pol["lightings"])))]
        apply_lighting(scene, lighting)
        support = O.support_graph(scene)
        # Remove every object that carries another object, plus one random object: these drive the counterfactuals.
        carriers = sorted({s for sups in support.values() for s in sups if s in scene.object_names()})  # robots and the table are not removable
        names = scene.object_names()
        extra = names[int(r.integers(len(names)))]
        rollouts = {b: O.remove_and_rollout(scene, b) for b in (carriers + [extra])[:4]}
        az = float(r.uniform(-180, 180))
        pa = O.ViewerPose(az, float(r.uniform(*pol["height"])), float(r.uniform(*pol["distance"])))
        dz = float(r.uniform(30, 100)) * (1 if r.random() < 0.5 else -1)
        pb = O.ViewerPose((az + dz + 180) % 360 - 180, float(r.uniform(*pol["height"])), float(r.uniform(*pol["distance"])))
        rend = O.SceneRenderer(scene)
        try:
            ia, info_a = view_items(scene, rend, pa, pol["templates"], split, support, rollouts)
            O.place_viewer(scene, pa)
            img_a = rend.rgb("viewer")
            eyes = {a.name: rend.rgb(f"eye:{a.name}") for a in scene.agents}
            ib, info_b = view_items(scene, rend, pb, pol["templates"], split, support, rollouts)
            O.place_viewer(scene, pb)
            img_b = rend.rgb("viewer")
        finally:
            rend.close()
        ip = pair_items(scene, pa, pb, info_a["vis"], info_b["vis"], pol["templates"], split)
        rq = np.random.default_rng(int(sha(spec.seed + "|questions")[:12], 16))
        pt = cfg.get("perTask")
        chosen = [(it, "a") for it in with_pairs(balanced(ia, cfg["perViewPerTask"], counts, rq, pt), ia)]
        chosen += [(it, "b") for it in with_pairs(balanced(ib, cfg["perViewPerTask"], counts, rq, pt), ib)]
        chosen += [(it, "ab") for it in balanced(ip, cfg["perViewPerTask"], counts, rq, pt)]
        if not chosen:
            continue
        # Encode every image once; names are opaque content hashes.
        files: dict[str, tuple[str, str]] = {}

        def put(key: str, arr) -> tuple[str, str]:
            if key in files:
                return files[key]
            buf = io.BytesIO()
            Image.fromarray(arr).save(buf, format="PNG", optimize=False)
            b = buf.getvalue()
            h = sha(b)
            if h in forbid["images"]:
                raise SystemExit(f"split integrity: an image of {split} duplicates a locked holdout image")
            rel = f"images/{split}/{h[:20]}.png"
            if not dry:
                (out / rel).write_bytes(b)
            img_hashes.add(h)
            files[key] = (rel, h)
            return files[key]

        for it, which in chosen:
            pose_of = {"viewer": pa if which == "a" else pb, "viewer_a": pa, "viewer_b": pb}
            imgs, cams = [], []
            for c in it.cameras:
                if c == "viewer":
                    imgs.append(put(f"viewer_{which}", img_a if which == "a" else img_b))
                    cams.append({"camera": "viewer", **pose_of["viewer"].as_dict()})
                elif c in ("viewer_a", "viewer_b"):
                    imgs.append(put(c, img_a if c == "viewer_a" else img_b))
                    cams.append({"camera": "viewer", **pose_of[c].as_dict()})
                else:
                    ag = c.split(":", 1)[1]
                    imgs.append(put(c, eyes[ag]))
                    cams.append({"camera": c, "agent": ag})
            prompt = model_prompt(it.question, it.options)
            sid = f"{split}_{sha(scene.fingerprint + '|' + json.dumps(cams) + '|' + it.key)[:16]}"
            held = [n for n in it.object_names if any(n == o.name and o.asset in HELD_OUT_ASSETS for o in scene.objects)]
            ood = (["template", "lighting", "camera_range"] + (["heldout_noun_in_question"] if held else [])) if split == "test_ood" else []
            records.append({
                "sample_id": sid, "split": split, "image_paths": [p for p, _ in imgs], "prompt": prompt, "task_type": it.task_type,
                "oracle": {"answer": it.answer, "answerable": it.answerable, "reference_frame": it.reference_frame, "options": it.options, "explanation": it.explanation, "relation": it.relation},
                "teacher": {"status": "not_queried", "answer": None, "verified": None},
                "metadata": {"env": "mujoco-tabletop", "scene_seed": spec.seed, "scene_fingerprint": scene.fingerprint, "scene_spec": spec_dict(spec), "lighting_id": lighting,
                             "cameras": cams, "difficulty": it.difficulty, "template_id": it.template_id, "object_ids": it.object_names, "object_names": it.object_names,
                             "n_objects": len(scene.objects), "theta_deg": None if it.theta_deg is None else round(it.theta_deg, 1), "ood_factors": ood,
                             "image_sha256": [h for _, h in imgs], "support_graph": support},
                "provenance": {"source": "egoversa-mujoco", "engine": ENGINE, "simulator": "MuJoCo 3.16", "license_track": "permissive",
                               "license": "MIT for labels and composition; rendered objects from Google Scanned Objects (CC BY 4.0), robots from MuJoCo Menagerie (BSD-3 / Apache-2.0), textures Poly Haven (CC0). See research/assets/ATTRIBUTION.md"},
            })
        if (i + 1) % 10 == 0:
            print(f"  {split}: {i + 1}/{cfg['scenes'][split]} scenes, {len(records)} samples, {time.time() - t0:.0f}s", flush=True)
    return {"records": records, "counts": counts, "fingerprints": fps, "images": img_hashes}


def write_split(out: Path, split: str, recs: list[dict]) -> None:
    write_jsonl(out / "registry" / f"{split}.jsonl", recs)
    write_jsonl(out / "model_inputs" / f"{split}.jsonl", [{"sample_id": r["sample_id"], "image_paths": r["image_paths"], "prompt": r["prompt"]} for r in recs])
    if split not in TEST:
        write_jsonl(out / "sft" / f"{split}.jsonl", [{
            "sample_id": r["sample_id"], "supervision": "oracle", "license_track": "permissive",
            "messages": [{"role": "user", "content": [*({"type": "image", "path": p} for p in r["image_paths"]), {"type": "text", "text": r["prompt"]}]},
                         {"role": "assistant", "content": [{"type": "text", "text": r["oracle"]["answer"]}]}],
        } for r in recs])


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--config", type=Path, required=True)
    ap.add_argument("--out", type=Path)
    ap.add_argument("--splits", default=",".join(SPLITS))
    ap.add_argument("--relock", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    cfg = json.loads(a.config.read_text())
    out = (a.out or ROOT / "research" / "data" / cfg["name"]).resolve()
    want = a.splits.split(",")
    lock_path = out / "holdout.lock.json"
    test_digest = sha(json.dumps({**cfg, "scenes": {k: cfg["scenes"][k] for k in TEST}}, sort_keys=True))
    out.mkdir(parents=True, exist_ok=True)
    lock = json.loads(lock_path.read_text()) if lock_path.exists() else None
    if lock and a.relock:
        print("--relock: discarding the locked test splits; results on them are no longer comparable")
        lock = None
    if lock and lock["test_config_sha256"] != test_digest:
        raise SystemExit("config no longer matches the locked holdout; use a new dataset name or --relock")
    forbid = {"fingerprints": set(lock["scene_fingerprints"]) if lock else set(), "images": set(lock["image_sha256"]) if lock else set()}
    summary, new_lock = {}, {"sample_ids": [], "scene_fingerprints": [], "image_sha256": [], "registry_sha256": {}, "counts": {}}
    for split in SPLITS:
        if split not in want:
            continue
        if split in TEST and lock:
            f = out / "registry" / f"{split}.jsonl"
            if not f.exists() or sha256_file(f) != lock["registry_sha256"][split]:
                raise SystemExit(f"locked split {split} is missing or modified on disk")
            print(f"{split}: locked, verified, untouched ({lock['counts'][split]} samples)")
            continue
        print(f"{split}: building")
        b = build_split(cfg, split, out, forbid if split not in TEST else {"fingerprints": set(), "images": set()}, a.dry_run)
        summary[split] = {"samples": len(b["records"]), "scenes": len(b["fingerprints"]), "images": len(b["images"]), "by_task": b["counts"]}
        if a.dry_run:
            continue
        write_split(out, split, b["records"])
        if split in TEST:
            new_lock["sample_ids"] += [r["sample_id"] for r in b["records"]]
            new_lock["scene_fingerprints"] += sorted(b["fingerprints"])
            new_lock["image_sha256"] += sorted(b["images"])
            new_lock["registry_sha256"][split] = sha256_file(out / "registry" / f"{split}.jsonl")
            new_lock["counts"][split] = len(b["records"])
            forbid["fingerprints"] |= b["fingerprints"]
            forbid["images"] |= b["images"]
    if not a.dry_run and not lock and all(s in new_lock["registry_sha256"] for s in TEST):
        lock_path.write_text(json.dumps({"format": "egoversa.holdout-lock", "version": 1, "dataset": cfg["name"], "dataset_version": cfg["version"],
                                         "locked_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "test_config_sha256": test_digest, "splits": sorted(TEST), **new_lock}, indent=2))
        print(f"holdout locked: {len(new_lock['sample_ids'])} test samples, {len(new_lock['scene_fingerprints'])} scenes")
    if not a.dry_run:
        mp = out / "manifest.json"
        prev = json.loads(mp.read_text()) if mp.exists() else {"splits": {}}
        mp.write_text(json.dumps({"format": "egoversa.dataset", "version": 1, "name": cfg["name"], "dataset_version": cfg["version"], "engine": ENGINE, "simulator": "MuJoCo 3.16",
                                  "license_track": "permissive", "config": cfg, "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                                  "splits": {**prev["splits"], **summary}}, indent=2))
    for s, v in summary.items():
        print(f"{s}: {v['samples']} samples, {v['scenes']} scenes, {v['images']} images")
        for t, c in sorted(v["by_task"].items()):
            print(f"   {t:18s} " + " ".join(f"{k}={n}" for k, n in sorted(c.items())))
    print("dry run: nothing written" if a.dry_run else f"written to {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
