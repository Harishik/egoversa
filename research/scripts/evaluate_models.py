#!/usr/bin/env python3
"""Evaluate a Hugging Face checkpoint (optionally with a LoRA adapter) on an EgoVersa split.

    python research/scripts/evaluate_models.py --model-id qwen3.5-0.8b-base --dataset research/data/egoversa-pilot --split test_iid test_ood
    python research/scripts/evaluate_models.py --model-id egoversa-spatial-1b --adapter research/runs/A_geometry/adapter-best --dataset ... --tag A_geometry
    python research/scripts/evaluate_models.py ... --limit 40 --dry-run

Writes the same result format as `npm run eval:models` (research/results/*.json), so both backends show up
side by side in the Models workspace. Use this backend for full-precision weights and LoRA adapters;
use the Node / Ollama backend for GGUF quantisations.

The model is given images and the prompt only. The registry with the answers is opened after all replies
have been collected.
"""
import argparse
import datetime as dt
import json
import os
import platform
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "research"))
from egoversa_research.dataset import read_jsonl  # noqa: E402
from egoversa_research.parsing import normalize_answer  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--model-id", required=True, help="id in research/configs/models.json")
    ap.add_argument("--adapter", type=Path, help="LoRA adapter directory to apply on top of the base checkpoint")
    ap.add_argument("--dataset", type=Path, required=True)
    ap.add_argument("--split", nargs="+", default=["test_iid", "test_ood"])
    ap.add_argument("--limit", type=int)
    ap.add_argument("--tag", default="")
    ap.add_argument("--device")
    ap.add_argument("--dry-run", action="store_true", help="check inputs and print the plan without loading a model")
    a = ap.parse_args()

    from egoversa_research.hf_runtime import registry_entry

    reg = registry_entry(a.model_id)
    ds = a.dataset.resolve()
    manifest = json.loads((ds / "manifest.json").read_text())
    inputs = []
    for s in a.split:
        rows = read_jsonl(ds / "model_inputs" / f"{s}.jsonl")
        if a.limit:
            per = -(-a.limit // len(a.split))
            rows = rows[:: max(1, len(rows) // per)][:per]
        inputs += [(s, {"sample_id": r["sample_id"], "image_paths": r["image_paths"], "prompt": r["prompt"]}) for r in rows]
    run_id = f"{manifest['name']}__{reg['id']}{'__' + a.tag if a.tag else ''}__hf__{'+'.join(a.split)}{'__n' + str(a.limit) if a.limit else ''}"
    out = ROOT / "research" / "results" / f"{run_id}.json"
    print(f"{reg['label']} ({reg['hf_id']}, {reg['license']}, track {reg['track']}) on {len(inputs)} items -> {out.relative_to(ROOT)}")
    if reg["track"] == "research-nc":
        print("NOTICE: this model is licensed CC BY-NC 4.0. Results and outputs are for non-commercial research only.")
    if a.dry_run:
        print("dry run OK: nothing was loaded and nothing was written.")
        return 0

    from PIL import Image
    from egoversa_research.hf_runtime import HFVisionModel

    model = HFVisionModel(reg["hf_id"], adapter=a.adapter, device=a.device)
    started = dt.datetime.utcnow().isoformat() + "Z"
    replies = {}
    for i, (_, inp) in enumerate(inputs):
        replies[inp["sample_id"]] = model.ask([Image.open(ds / p).convert("RGB") for p in inp["image_paths"]], inp["prompt"])
        if (i + 1) % 20 == 0:
            print(f"  {i + 1}/{len(inputs)}", flush=True)

    items = []
    for s in a.split:  # scoring phase: answers are read only now
        registry = {r["sample_id"]: r for r in read_jsonl(ds / "registry" / f"{s}.jsonl")}
        for split, inp in inputs:
            if split != s:
                continue
            r, rep = registry[inp["sample_id"]], replies[inp["sample_id"]]
            pred = normalize_answer(rep["raw"], r["oracle"]["options"])
            items.append({
                "sample_id": r["sample_id"], "split": s, "task_type": r["task_type"], "relation": r["oracle"]["relation"], "reference_frame": r["oracle"]["reference_frame"],
                "env": r["metadata"]["env"], "difficulty": r["metadata"]["difficulty"], "theta_deg": r["metadata"]["theta_deg"], "ood_factors": r["metadata"]["ood_factors"],
                "image_paths": r["image_paths"], "prompt": r["prompt"], "options": r["oracle"]["options"], "gold": r["oracle"]["answer"], "answerable": r["oracle"]["answerable"],
                "raw": rep["raw"], "pred": pred, "correct": pred == r["oracle"]["answer"], "latency_ms": rep["latency_ms"], "prompt_tokens": rep["prompt_tokens"], "output_tokens": rep["output_tokens"],
            })
    lock = ds / "holdout.lock.json"
    result = {
        "format": "egoversa.model-eval", "version": 1, "run_id": run_id,
        "model": {"id": reg["id"], "label": reg["label"] + (f" + adapter {a.adapter.name}" if a.adapter else ""), "role": reg["role"], "hf_id": reg["hf_id"], "runtime": "transformers", "tag": str(a.adapter or reg["hf_id"]),
                  "revision": model.revision, "quantization": str(model.dtype).replace("torch.", ""), "params_millions": reg["params_millions"], "license": reg["license"], "track": reg["track"], "size_bytes": None},
        "dataset": {"name": manifest["name"], "version": manifest["dataset_version"], "splits": a.split, "lock_sha256": ":".join(json.loads(lock.read_text())["registry_sha256"].values())[:64] if lock.exists() else None, "limit": a.limit},
        "generation": {"temperature": 0, "max_new_tokens": 12, "seed": 0, "thinking": False},
        "hardware": {"cpu": platform.processor() or platform.machine(), "cores": os.cpu_count(), "ram_gb": None, "platform": f"{platform.system()} {platform.machine()}", "accelerator": model.device},
        "started_at": started, "finished_at": dt.datetime.utcnow().isoformat() + "Z", "runtime_model_bytes": None, "items": items,
    }
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, indent=1))
    acc = sum(i["correct"] for i in items) / max(1, len(items))
    print(f"accuracy {100 * acc:.1f}% on {len(items)} items; open the Models workspace or run `npm run eval:report` for the breakdown")
    return 0


if __name__ == "__main__":
    sys.exit(main())
