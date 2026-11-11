"""Dataset access, integrity checks and provenance guards (standard library only).

Layout produced by scripts/build-dataset.ts:
    images/<split>/<hash>.png   registry/<split>.jsonl   model_inputs/<split>.jsonl   sft/<split>.jsonl
    manifest.json               holdout.lock.json
"""
from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable, Iterator

TEST_SPLITS = ("test_iid", "test_ood")
TRAIN_SPLITS = ("train", "val", "train_extra")
MODEL_VISIBLE_KEYS = {"sample_id", "image_paths", "prompt"}
TRACKS = ("permissive", "research-nc")
# Words that must never appear in model-visible text.
_FORBIDDEN_PROMPT = re.compile(r"\b(gold|oracle|ground truth|azimuth|seed|fingerprint|theta|sha256)\b", re.IGNORECASE)
_OPAQUE_IMAGE = re.compile(r"^images/(test_iid|test_ood|val|train)/[0-9a-f]{20}\.png$")


class IntegrityError(RuntimeError):
    """Raised when a dataset, split or provenance rule is violated. Never caught silently."""


def read_jsonl(path: Path) -> list[dict]:
    with open(path, "r", encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def write_jsonl(path: Path, rows: Iterable[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


@dataclass
class HoldoutLock:
    sample_ids: set[str]
    scene_fingerprints: set[str]
    image_sha256: set[str]
    registry_sha256: dict[str, str]
    raw: dict = field(repr=False, default_factory=dict)

    @classmethod
    def load(cls, dataset_dir: Path) -> "HoldoutLock | None":
        p = dataset_dir / "holdout.lock.json"
        if not p.exists():
            return None
        d = json.loads(p.read_text())
        return cls(set(d["sample_ids"]), set(d["scene_fingerprints"]), set(d["image_sha256"]), dict(d["registry_sha256"]), d)

    @property
    def image_stems(self) -> set[str]:
        return {h[:20] for h in self.image_sha256}


def assert_not_holdout(dataset_dir: Path, sample_ids: Iterable[str], image_paths: Iterable[str] = (), purpose: str = "training") -> None:
    """Refuse to use frozen test material for training, teacher-target generation or hard-example mining."""
    lock = HoldoutLock.load(dataset_dir)
    ids = list(sample_ids)
    bad = [s for s in ids if s.startswith(("test_iid_", "test_ood_"))]
    if lock:
        bad += [s for s in ids if s in lock.sample_ids]
        stems = lock.image_stems
        bad_img = [p for p in image_paths if Path(p).stem in stems or "/test_" in p]
    else:
        bad_img = [p for p in image_paths if "/test_" in p]
    if bad or bad_img:
        raise IntegrityError(
            f"Refusing to use the locked holdout for {purpose}: {len(set(bad))} sample ids and {len(set(bad_img))} images "
            f"belong to the frozen test splits (e.g. {(bad + bad_img)[0]})."
        )


def assert_track(rows: Iterable[dict], track: str) -> None:
    """Keep the permissive and the non-commercial research tracks apart."""
    if track not in TRACKS:
        raise IntegrityError(f"Unknown licence track {track!r}; expected one of {TRACKS}.")
    if track == "research-nc":
        return  # the research track may contain everything, and the whole run is then non-commercial
    for r in rows:
        t = r.get("license_track") or r.get("provenance", {}).get("license_track")
        sup = r.get("supervision", "oracle")
        if t != "permissive" or sup != "oracle":
            raise IntegrityError(
                f"Sample {r.get('sample_id')} has track={t!r}, supervision={sup!r} and cannot enter a permissive-track run. "
                "Teacher-derived (CC BY-NC) supervision must stay in the research-nc track."
            )


@dataclass
class Report:
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    stats: dict = field(default_factory=dict)

    @property
    def ok(self) -> bool:
        return not self.errors


def validate_dataset(dataset_dir: Path, check_images: bool = True) -> Report:
    """Schema, leakage, split-integrity and provenance checks. Returns a report; raises nothing."""
    rep = Report()
    err, warn = rep.errors.append, rep.warnings.append
    if not (dataset_dir / "manifest.json").exists():
        err("manifest.json is missing")
        return rep
    splits = [s for s in (*TEST_SPLITS, *TRAIN_SPLITS) if (dataset_dir / "registry" / f"{s}.jsonl").exists()]
    lock = HoldoutLock.load(dataset_dir)
    fps: dict[str, set[str]] = {}
    imgs: dict[str, set[str]] = {}
    ids_seen: set[str] = set()
    templates: dict[str, set[int]] = {}
    nouns_in_question: dict[str, set[str]] = {}
    for split in splits:
        reg = read_jsonl(dataset_dir / "registry" / f"{split}.jsonl")
        vis = read_jsonl(dataset_dir / "model_inputs" / f"{split}.jsonl")
        if len(reg) != len(vis):
            err(f"{split}: registry has {len(reg)} rows but model_inputs has {len(vis)}")
        by_task: dict[str, dict[str, int]] = {}
        fps[split], imgs[split], templates[split], nouns_in_question[split] = set(), set(), set(), set()
        seen_q: set[tuple] = set()
        for r, v in zip(reg, vis):
            sid = r["sample_id"]
            if sid in ids_seen:
                err(f"{split}: duplicate sample_id {sid}")
            ids_seen.add(sid)
            if not sid.startswith(split + "_"):
                err(f"{sid}: id does not carry its split prefix")
            if r["split"] != split:
                err(f"{sid}: split field is {r['split']!r}")
            # ---- model-visible view: exactly three keys, identical to the registry's public fields ----
            if set(v.keys()) != MODEL_VISIBLE_KEYS:
                err(f"{sid}: model_inputs exposes keys {sorted(v.keys())}; only {sorted(MODEL_VISIBLE_KEYS)} are allowed")
            if v["sample_id"] != sid or v["prompt"] != r["prompt"] or v["image_paths"] != r["image_paths"]:
                err(f"{sid}: model_inputs row does not match the registry row")
            prompt = r["prompt"]
            if re.search(r"\d", prompt) or _FORBIDDEN_PROMPT.search(prompt):
                err(f"{sid}: prompt contains digits or oracle vocabulary: {prompt[:80]!r}")
            if r["oracle"]["explanation"] in prompt or r["metadata"]["scene_fingerprint"] in prompt:
                err(f"{sid}: prompt leaks oracle explanation or fingerprint")
            # ---- answer and options ----
            o = r["oracle"]
            if o["answer"] not in o["options"]:
                err(f"{sid}: answer {o['answer']!r} is not among options {o['options']}")
            if (o["answer"] == "unknown") != (not o["answerable"]):
                err(f"{sid}: answerable flag and 'unknown' answer disagree")
            if (r["task_type"] == "abstain") != (not o["answerable"]):
                err(f"{sid}: task_type 'abstain' and answerable flag disagree")
            for opt in o["options"]:
                if opt not in prompt:
                    err(f"{sid}: option {opt!r} is not offered in the prompt")
            # ---- images: opaque names, present, hash matches ----
            if len(r["image_paths"]) != len(r["metadata"]["image_sha256"]) or len(r["image_paths"]) != len(r["metadata"]["cameras"]):
                err(f"{sid}: image / hash / camera counts differ")
            for p, h in zip(r["image_paths"], r["metadata"]["image_sha256"]):
                img_split = "train" if split == "train_extra" else split
                if not _OPAQUE_IMAGE.match(p) or f"/{img_split}/" not in p:
                    err(f"{sid}: image path {p!r} is not an opaque content-hash name inside its split")
                if Path(p).stem != h[:20]:
                    err(f"{sid}: image name does not match its recorded hash")
                imgs[split].add(h)
                if any(w in Path(p).stem for w in o["options"]):
                    err(f"{sid}: image file name contains an answer word")
            key = (tuple(r["image_paths"]), prompt)
            if key in seen_q:
                err(f"{split}: identical (images, prompt) pair appears twice ({sid})")
            seen_q.add(key)
            # ---- provenance ----
            if r["provenance"]["license_track"] not in TRACKS:
                err(f"{sid}: unknown license_track")
            if r["teacher"]["status"] == "not_queried" and (r["teacher"]["answer"] is not None or r["teacher"]["verified"] is not None):
                err(f"{sid}: teacher fields are filled although the teacher was not queried")
            fps[split].add(r["metadata"]["scene_fingerprint"])
            templates[split].add(r["metadata"]["template_id"])
            by_task.setdefault(r["task_type"], {}).setdefault(o["answer"], 0)
            by_task[r["task_type"]][o["answer"]] += 1
        if check_images:
            for h in imgs[split]:
                f = dataset_dir / "images" / ("train" if split == "train_extra" else split) / f"{h[:20]}.png"
                if not f.exists():
                    err(f"{split}: image {f.name} is missing")
                elif sha256_file(f) != h:
                    err(f"{split}: image {f.name} does not match its recorded sha256")
        for task, labels in by_task.items():
            tot = sum(labels.values())
            if len(labels) > 1 and max(labels.values()) / tot > 0.7:
                warn(f"{split}/{task}: label imbalance {labels}")
        rep.stats[split] = {"samples": len(reg), "scenes": len(fps[split]), "images": len(imgs[split]), "by_task": by_task, "templates": sorted(templates[split])}
        if split in TEST_SPLITS:
            if (dataset_dir / "sft" / f"{split}.jsonl").exists():
                err(f"{split}: an SFT file exists for a test split")
            if lock and lock.registry_sha256.get(split) != sha256_file(dataset_dir / "registry" / f"{split}.jsonl"):
                err(f"{split}: registry digest differs from holdout.lock.json (the frozen test set was modified)")
    # ---- cross-split disjointness ----
    for i, a in enumerate(splits):
        for b in splits[i + 1:]:
            if fps[a] & fps[b]:
                err(f"scene fingerprints shared between {a} and {b}: {sorted(fps[a] & fps[b])[:3]}")
            if imgs[a] & imgs[b]:
                err(f"identical images shared between {a} and {b}")
    if "test_ood" in templates and "train" in templates and templates["test_ood"] & templates["train"]:
        err("question templates of test_ood overlap with train (template leakage)")
    if lock is None and any(s in splits for s in TEST_SPLITS):
        err("test splits exist but holdout.lock.json is missing")
    if lock:
        for s in TRAIN_SPLITS:
            if s in fps and (fps[s] & lock.scene_fingerprints or imgs[s] & lock.image_sha256):
                err(f"{s} overlaps the locked holdout")
        for s in TRAIN_SPLITS:
            p = dataset_dir / "sft" / f"{s}.jsonl"
            if p.exists():
                try:
                    rows = read_jsonl(p)
                    assert_not_holdout(dataset_dir, (r["sample_id"] for r in rows), (c["path"] for r in rows for m in r["messages"] for c in m["content"] if c["type"] == "image"))
                except IntegrityError as e:
                    err(str(e))
    return rep


def iter_sft(path: Path) -> Iterator[dict]:
    yield from read_jsonl(path)
