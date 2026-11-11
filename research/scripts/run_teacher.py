#!/usr/bin/env python3
"""Collect and VERIFY teacher outputs from SpatialAxiom-9B for distillation (non-commercial research track).

    python research/scripts/run_teacher.py --dataset research/data/egoversa-pilot --split train --rationales
    python research/scripts/run_teacher.py --dataset ... --split train --limit 200 --dry-run

For every training sample the teacher sees exactly what a student sees: the image(s) and the prompt.
Its reply is then compared with the geometry oracle and labelled:

    verified        normalised answer == oracle answer
    wrong           a different admissible option
    nonanswer       no single admissible option could be parsed
    hallucinated    asserted a relation although the oracle says the answer is unknowable (hidden object)

Outputs (all tagged license_track = research-nc, never mixed into sft/):
    teacher/<split>.jsonl                          every query: prompt, raw output, label, checkpoint revision, settings, wall time
    sft_teacher/<split>.imitation.jsonl            run B: the teacher's own one-word answers as targets (errors included, by design)
    sft_teacher/<split>.verified_rationales.jsonl  run C: "explain" examples, only where answer AND rationale agree with the oracle

Safeguards: refuses the frozen test splits; never uses oracle labels to choose which samples to query;
natural-language confidence is recorded as text only and never treated as a probability.

Requires a GPU that fits a 9.4B-parameter model in BF16 (the checkpoint is 18.8 GB on disk).
"""
import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "research"))
from egoversa_research.dataset import IntegrityError, assert_not_holdout, read_jsonl, write_jsonl  # noqa: E402
from egoversa_research.parsing import normalize_answer  # noqa: E402

TEACHER_ID = "spatialaxiom-9b"
RATIONALE_SUFFIX = "\nAnswer in one short sentence that states the answer and the visible evidence for it."


def label_reply(pred, oracle: dict) -> str:
    if pred is None:
        return "nonanswer"
    if pred == oracle["answer"]:
        return "verified"
    if not oracle["answerable"] and pred != "unknown":
        return "hallucinated"
    return "wrong"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dataset", type=Path, required=True)
    ap.add_argument("--split", default="train", choices=["train", "val"], help="test splits are refused")
    ap.add_argument("--limit", type=int)
    ap.add_argument("--rationales", action="store_true", help="also ask for a one-sentence justification (needed for run C)")
    ap.add_argument("--device")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--from-cache", type=Path, help="re-label an existing teacher/<split>.jsonl without querying the model")
    a = ap.parse_args()

    from egoversa_research.hf_runtime import registry_entry

    reg = registry_entry(TEACHER_ID)
    ds = a.dataset.resolve()
    inputs = read_jsonl(ds / "model_inputs" / f"{a.split}.jsonl")
    if a.limit:
        inputs = inputs[: a.limit]  # positional subset: never chosen by looking at labels
    assert_not_holdout(ds, (r["sample_id"] for r in inputs), (p for r in inputs for p in r["image_paths"]), purpose="teacher-target generation")
    print(f"teacher {reg['hf_id']} [{reg['license']}] on {len(inputs)} {a.split} samples{' with rationales' if a.rationales else ''}")
    print("NOTICE: outputs are written to the research-nc track only. Do not use them to train a model intended for commercial release without permission from the teacher's authors.")
    if a.dry_run:
        print("dry run OK: holdout guard passed; no model loaded, nothing written.")
        return 0

    if a.from_cache:
        cached = {r["sample_id"]: r for r in read_jsonl(a.from_cache)}
        ask = lambda sid, images, prompt, n: {"raw": cached[sid]["raw_rationale" if n > 12 else "raw"], "latency_ms": 0}  # noqa: E731
        revision = next(iter(cached.values()))["teacher_revision"]
    else:
        from PIL import Image
        from egoversa_research.hf_runtime import HFVisionModel

        model = HFVisionModel(reg["hf_id"], device=a.device)
        revision = model.revision
        ask = lambda sid, images, prompt, n: model.ask([Image.open(ds / p).convert("RGB") for p in images], prompt, max_new_tokens=n)  # noqa: E731

    # Phase 1: query. Only model-visible fields are in scope.
    raw = {}
    for i, r in enumerate(inputs):
        rep = ask(r["sample_id"], r["image_paths"], r["prompt"], 12)
        rat = ask(r["sample_id"], r["image_paths"], r["prompt"].split("\n")[0] + RATIONALE_SUFFIX, 64) if a.rationales else None
        raw[r["sample_id"]] = (rep, rat)
        if (i + 1) % 25 == 0:
            print(f"  {i + 1}/{len(inputs)}", flush=True)

    # Phase 2: verify against the oracle.
    registry = {r["sample_id"]: r for r in read_jsonl(ds / "registry" / f"{a.split}.jsonl")}
    log, imitation, rationales = [], [], []
    counts: dict[str, int] = {}
    for r in inputs:
        reg_row = registry[r["sample_id"]]
        o = reg_row["oracle"]
        rep, rat = raw[r["sample_id"]]
        pred = normalize_answer(rep["raw"], o["options"])
        status = label_reply(pred, o)
        counts[status] = counts.get(status, 0) + 1
        rat_pred = normalize_answer(rat["raw"], o["options"]) if rat else None
        rat_ok = bool(rat) and status == "verified" and rat_pred == o["answer"]
        log.append({
            "sample_id": r["sample_id"], "prompt": r["prompt"], "image_paths": r["image_paths"], "raw": rep["raw"], "answer": pred, "status": status, "verified": status == "verified",
            "raw_rationale": rat["raw"] if rat else None, "rationale_verified": rat_ok if rat else None, "wall_ms": rep["latency_ms"] + (rat["latency_ms"] if rat else 0),
            "teacher_id": reg["id"], "teacher_hf_id": reg["hf_id"], "teacher_revision": revision, "generation": {"do_sample": False, "enable_thinking": False, "max_new_tokens": 12},
            "license": reg["license"], "license_track": "research-nc",
        })
        user = [*({"type": "image", "path": p} for p in r["image_paths"])]
        if pred is not None:  # a non-answer cannot be imitated
            imitation.append({"sample_id": r["sample_id"], "supervision": "teacher-imitation", "license_track": "research-nc", "teacher_status": status,
                              "messages": [{"role": "user", "content": [*user, {"type": "text", "text": r["prompt"]}]}, {"role": "assistant", "content": [{"type": "text", "text": pred}]}]})
        if rat_ok:
            rationales.append({"sample_id": r["sample_id"] + "#why", "supervision": "teacher-rationale-verified", "license_track": "research-nc",
                               "messages": [{"role": "user", "content": [*user, {"type": "text", "text": r["prompt"].split("\n")[0] + RATIONALE_SUFFIX}]}, {"role": "assistant", "content": [{"type": "text", "text": rat["raw"].strip()}]}]})
    write_jsonl(ds / "teacher" / f"{a.split}.jsonl", log)
    write_jsonl(ds / "sft_teacher" / f"{a.split}.imitation.jsonl", imitation)
    if a.rationales:
        write_jsonl(ds / "sft_teacher" / f"{a.split}.verified_rationales.jsonl", rationales)
    (ds / "teacher" / f"{a.split}.summary.json").write_text(json.dumps({"teacher": reg["hf_id"], "revision": revision, "license": reg["license"], "n": len(inputs), "status_counts": counts,
                                                                           "agreement_with_oracle": counts.get("verified", 0) / max(1, len(inputs)), "verified_rationales": len(rationales)}, indent=2))
    print(f"status: {counts}; {len(imitation)} imitation targets, {len(rationales)} verified rationales")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except IntegrityError as e:
        print(f"INTEGRITY ERROR: {e}", file=sys.stderr)
        sys.exit(2)
