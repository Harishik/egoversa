#!/usr/bin/env python3
"""Multimodal LoRA fine-tuning of the EgoVersa-Spatial-1B student (Qwen/Qwen3.5-0.8B by default).

    python research/scripts/train_student.py --config research/configs/experiments/A_geometry.yaml
    python research/scripts/train_student.py --config ... --dry-run      # validate config, data and guards; load nothing
    python research/scripts/train_student.py --config ... --smoke        # 4 optimisation steps on 8 examples (CPU-feasible)
    python research/scripts/train_student.py --config ... --resume

What it guarantees
  * images go through the real processor and vision tower (see egoversa_research/sft.py); a blank-image
    ablation at start-up fails the run if the loss does not depend on the image;
  * loss only on assistant answer tokens;
  * the frozen holdout can never be loaded (assert_not_holdout) and licence tracks cannot be mixed (assert_track);
  * every run directory records config, dataset digest, model revision, library versions, seed and the
    training curve, so a number can be traced back to what produced it.

Hardware: full-precision LoRA (BF16 on CUDA, float32 on CPU). 4-bit QLoRA is NOT used: the Qwen3.5 family
is reported to suffer from larger-than-usual quantisation differences during training (Unsloth guide).
Unsloth quotes ~3 GB of VRAM for 0.8B BF16 LoRA; that figure is theirs, not measured here.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import platform
import random
import resource
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "research"))
from egoversa_research.dataset import IntegrityError, assert_not_holdout, assert_track, read_jsonl, sha256_file  # noqa: E402
from egoversa_research.parsing import normalize_answer  # noqa: E402

DEFAULTS = {
    "model": {"hf_id": "Qwen/Qwen3.5-0.8B", "revision": None},
    "lora": {"r": 16, "alpha": 16, "dropout": 0.0, "finetune_vision": False, "finetune_language": True},
    "train": {
        "epochs": 1, "max_steps": None, "lr": 2e-4, "weight_decay": 0.0, "warmup_ratio": 0.05, "batch_size": 4, "grad_accum": 2,
        "max_grad_norm": 1.0, "seed": 3407, "eval_every": 100, "eval_examples": 96, "early_stopping_patience": 4, "save_every": 200,
        "max_train_examples": None,
    },
}


def load_config(path: Path) -> dict:
    import yaml

    cfg = yaml.safe_load(path.read_text())
    for k, v in DEFAULTS.items():
        cfg[k] = {**v, **(cfg.get(k) or {})}
    for req in ("name", "track", "dataset", "train_files"):
        if req not in cfg:
            raise SystemExit(f"config {path} is missing required key '{req}'")
    return cfg


def rss_mb() -> float:
    r = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return r / (1 << 20) if platform.system() == "Darwin" else r / 1024


def load_training_rows(cfg: dict) -> tuple[list[dict], list[dict], Path]:
    ds = (ROOT / cfg["dataset"]).resolve()
    rows: list[dict] = []
    how = {
        "sft_teacher/": "run research/scripts/run_teacher.py on the train split first (needs a GPU for SpatialAxiom-9B)",
        "train_extra": "build it with: npm run dataset -- --config research/configs/dataset.pilot.json --extra-train <scenes per env>",
    }
    for f in cfg["train_files"]:
        if not (ds / f).exists():
            hint = next((v for k, v in how.items() if k in f), "build the dataset first (npm run dataset)")
            raise SystemExit(f"training file {ds / f} does not exist yet: {hint}")
        rows += read_jsonl(ds / f)
    val = read_jsonl(ds / cfg.get("val_file", "sft/val.jsonl"))
    for name, part in (("training", rows), ("validation", val)):
        paths = [c["path"] for r in part for m in r["messages"] for c in m["content"] if c["type"] == "image"]
        assert_not_holdout(ds, (r["sample_id"] for r in part), paths, purpose=name)
        assert_track(part, cfg["track"])
        for p in set(paths):
            if not (ds / p).exists():
                raise IntegrityError(f"image {p} referenced by the {name} set does not exist")
    return rows, val, ds


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--config", type=Path, required=True)
    ap.add_argument("--dry-run", action="store_true", help="validate everything that does not need the model, then exit")
    ap.add_argument("--smoke", action="store_true", help="tiny end-to-end run: 8 train / 4 val examples, 4 steps")
    ap.add_argument("--resume", action="store_true", help="continue from the last checkpoint in the run directory")
    ap.add_argument("--device", default=None, help="cuda | mps | cpu (default: best available)")
    ap.add_argument("--out", type=Path, default=None, help="run directory (default: research/runs/<name>)")
    a = ap.parse_args()

    cfg = load_config(a.config)
    rows, val, ds = load_training_rows(cfg)
    t = cfg["train"]
    random.Random(t["seed"]).shuffle(rows)
    if t["max_train_examples"]:
        rows = rows[: t["max_train_examples"]]
    if a.smoke:
        rows, val = rows[:8], val[:4]
        t.update(max_steps=4, batch_size=1, grad_accum=2, eval_every=2, eval_examples=4, save_every=4, epochs=1)
    steps_per_epoch = math.ceil(len(rows) / (t["batch_size"] * t["grad_accum"]))
    total_steps = t["max_steps"] or steps_per_epoch * t["epochs"]
    run_dir = (a.out or ROOT / "research" / "runs" / (cfg["name"] + ("-smoke" if a.smoke else ""))).resolve()
    lock = ds / "holdout.lock.json"
    plan = {
        "run": cfg["name"], "track": cfg["track"], "model": cfg["model"]["hf_id"], "dataset": str(ds.relative_to(ROOT)),
        "train_examples": len(rows), "val_examples": len(val), "optimizer_steps": total_steps,
        "effective_batch": t["batch_size"] * t["grad_accum"], "lora": cfg["lora"], "holdout_lock_sha256": sha256_file(lock) if lock.exists() else None,
        "supervision": sorted({r.get("supervision", "oracle") for r in rows}), "run_dir": str(run_dir.relative_to(ROOT)),
    }
    print(json.dumps(plan, indent=2))
    if a.dry_run:
        print("dry run OK: config, data files, images, holdout guard and licence track all check out. No model was loaded.")
        return 0

    # ------------------------------------------------------------------ model ------------------------------------------------------------------
    import torch
    import transformers
    import peft
    from peft import LoraConfig, get_peft_model
    from transformers import AutoModelForMultimodalLM, AutoProcessor

    from egoversa_research.sft import collate, encode_example, lora_targets, to_chat

    random.seed(t["seed"])
    torch.manual_seed(t["seed"])
    device = a.device or ("cuda" if torch.cuda.is_available() else "cpu")
    dtype = torch.bfloat16 if device == "cuda" else torch.float32
    print(f"device={device} dtype={dtype} torch={torch.__version__} transformers={transformers.__version__} peft={peft.__version__}")

    processor = AutoProcessor.from_pretrained(cfg["model"]["hf_id"], revision=cfg["model"]["revision"])
    model = AutoModelForMultimodalLM.from_pretrained(cfg["model"]["hf_id"], revision=cfg["model"]["revision"], dtype=dtype).to(device)
    n_params = sum(p.numel() for p in model.parameters())
    targets, tinfo = lora_targets(model, cfg["lora"]["finetune_vision"], cfg["lora"]["finetune_language"])
    if not targets:
        raise SystemExit("no LoRA target modules were found; inspect model.named_modules()")
    model = get_peft_model(model, LoraConfig(r=cfg["lora"]["r"], lora_alpha=cfg["lora"]["alpha"], lora_dropout=cfg["lora"]["dropout"], bias="none", target_modules=targets))
    trainable = sum(p.numel() for p in model.parameters() if p.requires_grad)
    print(f"parameters: {n_params / 1e6:.1f}M total, {trainable / 1e6:.2f}M trainable LoRA ({100 * trainable / n_params:.2f}%), targets {tinfo}")
    pad_id = processor.tokenizer.pad_token_id if processor.tokenizer.pad_token_id is not None else processor.tokenizer.eos_token_id

    def batch_of(recs: list[dict]) -> dict:
        b = collate([encode_example(processor, r, ds) for r in recs], pad_id)
        return {k: (v.to(device) if hasattr(v, "to") else v) for k, v in b.items() if k not in ("n_prefix", "n_image_tokens")}

    # ---- start-up checks: label mask and real use of the image ----
    ex = encode_example(processor, rows[0], ds)
    n_lab = int((ex["labels"] != -100).sum())
    answer = rows[0]["messages"][-1]["content"][0]["text"]
    decoded = processor.tokenizer.decode(ex["labels"][0][ex["labels"][0] != -100])
    print(f"example: {ex['input_ids'].shape[1]} tokens ({ex['n_image_tokens']} image tokens), {n_lab} supervised tokens -> {decoded!r} (target {answer!r})")
    if answer not in decoded:
        raise SystemExit("label mask is wrong: the supervised tokens do not decode to the target answer")
    if ex["n_image_tokens"] == 0:
        raise SystemExit("the encoded example contains no image tokens: this would be text-only training")
    model.eval()
    with torch.no_grad():
        real = batch_of(rows[:1])
        loss_real = float(model(**real).loss)
        blank = dict(real)
        pix_key = next(k for k in real if "pixel" in k)
        blank[pix_key] = torch.zeros_like(real[pix_key])
        loss_blank = float(model(**blank).loss)
    print(f"image-dependence check: loss with image {loss_real:.4f}, with blanked pixels {loss_blank:.4f}")
    if abs(loss_real - loss_blank) < 1e-6:
        raise SystemExit("loss does not change when the image is blanked: visual features are not reaching the language model")

    def generate(recs: list[dict]) -> list[str]:
        outs = []
        for r in recs:
            inp = processor.apply_chat_template(to_chat(r["messages"], ds, False), add_generation_prompt=True, tokenize=True, return_dict=True, return_tensors="pt", enable_thinking=False).to(device)
            with torch.no_grad():
                o = model.generate(**inp, max_new_tokens=8, do_sample=False)
            outs.append(processor.tokenizer.decode(o[0][inp["input_ids"].shape[1]:], skip_special_tokens=True))
        return outs

    def evaluate(recs: list[dict]) -> dict:
        model.eval()
        losses = []
        with torch.no_grad():
            for i in range(0, len(recs), t["batch_size"]):
                losses.append(float(model(**batch_of(recs[i : i + t["batch_size"]])).loss))
        gens = generate(recs)
        golds = [r["messages"][-1]["content"][0]["text"] for r in recs]
        opts = [g for g in sorted(set(golds) | {"left", "right", "closer", "farther", "above", "below", "visible", "occluded", "front", "behind", "toward", "away", "first", "second", "unknown"})]
        correct = sum(normalize_answer(g, opts) == gold for g, gold in zip(gens, golds))
        model.train()
        return {"val_loss": sum(losses) / len(losses), "val_exact_match": correct / len(recs), "n": len(recs)}

    # ---------------------------------------------------------------- training ----------------------------------------------------------------
    run_dir.mkdir(parents=True, exist_ok=True)
    (run_dir / "config.resolved.json").write_text(json.dumps({**cfg, "plan": plan}, indent=2, default=str))
    opt = torch.optim.AdamW([p for p in model.parameters() if p.requires_grad], lr=t["lr"], weight_decay=t["weight_decay"])
    warm = max(1, int(t["warmup_ratio"] * total_steps))
    sched = torch.optim.lr_scheduler.LambdaLR(opt, lambda s: (s + 1) / warm if s < warm else 0.5 * (1 + math.cos(math.pi * (s - warm) / max(1, total_steps - warm))))
    step, best, bad, curve = 0, float("inf"), 0, []
    state_path = run_dir / "checkpoint" / "state.pt"
    if a.resume and state_path.exists():
        st = torch.load(state_path, map_location=device)
        model.load_state_dict(st["lora"], strict=False)
        opt.load_state_dict(st["opt"])
        sched.load_state_dict(st["sched"])
        step, best, bad, curve = st["step"], st["best"], st["bad"], st["curve"]
        print(f"resumed from step {step}")

    def save(tag: str) -> None:
        model.save_pretrained(run_dir / tag)
        (run_dir / "checkpoint").mkdir(exist_ok=True)
        torch.save({"lora": {k: v for k, v in model.state_dict().items() if "lora_" in k}, "opt": opt.state_dict(), "sched": sched.state_dict(), "step": step, "best": best, "bad": bad, "curve": curve}, state_path)

    model.train()
    t0 = time.time()
    order = list(range(len(rows)))
    micro = 0
    stop = False
    while step < total_steps and not stop:
        random.shuffle(order)
        for i in range(0, len(order), t["batch_size"]):
            recs = [rows[j] for j in order[i : i + t["batch_size"]]]
            loss = model(**batch_of(recs)).loss / t["grad_accum"]
            loss.backward()
            micro += 1
            if micro % t["grad_accum"]:
                continue
            torch.nn.utils.clip_grad_norm_(model.parameters(), t["max_grad_norm"])
            opt.step()
            sched.step()
            opt.zero_grad(set_to_none=True)
            step += 1
            rec = {"step": step, "train_loss": float(loss) * t["grad_accum"], "lr": sched.get_last_lr()[0], "elapsed_s": round(time.time() - t0, 1), "rss_mb": round(rss_mb()),
                   "cuda_mb": round(torch.cuda.max_memory_allocated() / 2**20) if device == "cuda" else None}
            if step % t["eval_every"] == 0 or step == total_steps:
                rec.update(evaluate(val[: t["eval_examples"]]))
                if rec["val_loss"] < best - 1e-4:
                    best, bad = rec["val_loss"], 0
                    save("adapter-best")
                else:
                    bad += 1
                    stop = bad >= t["early_stopping_patience"]
            curve.append(rec)
            print(json.dumps(rec))
            with open(run_dir / "training_curve.jsonl", "a") as f:
                f.write(json.dumps(rec) + "\n")
            if step % t["save_every"] == 0:
                save("adapter-last")
            if step >= total_steps or stop:
                break
    save("adapter-last")
    summary = {
        "format": "egoversa.training-run", "name": cfg["name"], "smoke": a.smoke, "track": cfg["track"],
        "license_note": "permissive track: Apache-2.0 base + procedurally generated data" if cfg["track"] == "permissive" else "research-nc track: includes CC BY-NC 4.0 teacher-derived supervision; non-commercial research only",
        "base_model": cfg["model"]["hf_id"], "base_revision": getattr(model.config, "_commit_hash", None) or cfg["model"]["revision"],
        "dataset": plan["dataset"], "holdout_lock_sha256": plan["holdout_lock_sha256"], "train_examples": len(rows), "val_examples": len(val),
        "steps": step, "stopped_early": stop, "best_val_loss": None if best == float("inf") else best, "final": curve[-1] if curve else None,
        "seed": t["seed"], "device": device, "dtype": str(dtype), "wall_s": round(time.time() - t0, 1), "peak_rss_mb": round(rss_mb()),
        "versions": {"torch": torch.__version__, "transformers": transformers.__version__, "peft": peft.__version__, "python": platform.python_version()},
        "params_total_m": round(n_params / 1e6, 1), "params_trainable_m": round(trainable / 1e6, 3), "lora_targets": tinfo,
        "image_dependence_check": {"loss_with_image": loss_real, "loss_blank_image": loss_blank},
    }
    (run_dir / "run_summary.json").write_text(json.dumps(summary, indent=2))
    print(f"done: {step} steps in {summary['wall_s']} s, peak RSS {summary['peak_rss_mb']} MB -> {run_dir.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except IntegrityError as e:
        print(f"INTEGRITY ERROR: {e}", file=sys.stderr)
        sys.exit(2)
