#!/usr/bin/env python3
"""Simulator-verified GRPO for the EgoVersa-Spatial-1B student (Qwen/Qwen3.5-0.8B + LoRA).

    research/.conda/bin/python research/scripts/train_grpo.py --dataset research/data/egoversa-sim-pilot --dry-run
    research/.conda/bin/python research/scripts/train_grpo.py --dataset research/data/egoversa-sim-smoke --smoke     # 2 steps on CPU
    python research/scripts/train_grpo.py --dataset research/data/egoversa-sim-pilot --init research/runs/A_sim/adapter-best   # GPU

Rewards (all computed by code from the simulator's labels; no reward model):
  r_answer       1 if the parsed answer equals the oracle answer
  r_format       +0.1 if the reply names exactly one admissible option
  r_abstain      -0.5 for asserting a relation about a hidden object (gold "unknown"), -0.25 for "unknown" when answerable
  r_frame        (--frame-reasoning) the prompt asks the model to first state whether the robot faces toward or away
                 from the camera; +0.3 if that intermediate claim matches the simulator (process reward), skipped
                 when the robot is side-on
  r_consistency  (--consistency) label-free: an observer-frame or physics question asked from two camera positions
                 of the same settled scene has one answer; reward = agreement with the other view's samples

Objective: GRPO (group-normalised advantages, no value network), token-level policy gradient on the LoRA
parameters, KL penalty to the frozen base policy computed by disabling the adapter.

Guards: frozen test splits are refused (assert_not_holdout); gold labels are read only inside the reward function;
the policy sees the same images and prompt text as at evaluation time.

STATUS: the --smoke path runs end to end on CPU (see EXPERIMENTS.md E8). Real runs need a CUDA GPU.
"""
from __future__ import annotations

import argparse
import json
import math
import random
import sys
import time
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "research"))
from egoversa_research.dataset import assert_not_holdout, read_jsonl  # noqa: E402
from egoversa_research.parsing import normalize_answer  # noqa: E402

FRAME_SUFFIX = ("\nFirst say whether the robot is facing toward or away from the camera, then give the answer, "
                "in the form: facing: <toward or away>; answer: <one word>.")
CONSISTENT_TASKS = {"obs_lateral", "obs_frontback", "support", "counterfactual", "facing"}  # answer independent of the camera?
# facing is NOT camera-independent; it is excluded below. Listed here only to document the decision.
CONSISTENT_TASKS.discard("facing")


def consistency_key(r: dict) -> str | None:
    """Same settled scene + same relation + same objects = same answer from any camera, for frame-invariant tasks."""
    if r["task_type"] not in CONSISTENT_TASKS:
        return None
    m = r["metadata"]
    return f"{m['scene_fingerprint']}|{r['task_type']}|{'|'.join(m['object_names'])}"


def frame_label(r: dict) -> str | None:
    th = r["metadata"].get("theta_deg")
    if th is None or abs(th - 90) < 30:
        return None
    return "toward" if th > 90 else "away"  # heading offset > 90 deg: the robot looks back at the camera


def reward(reply: str, r: dict, frame_mode: bool) -> dict:
    o = r["oracle"]
    ans_text = reply.split("answer:", 1)[1] if frame_mode and "answer:" in reply.lower() else reply
    pred = normalize_answer(ans_text, o["options"])
    out = {"answer": float(pred == o["answer"]), "format": 0.1 if pred is not None else 0.0, "abstain": 0.0, "frame": 0.0}
    if o["answer"] == "unknown" and pred not in (None, "unknown"):
        out["abstain"] = -0.5
    elif o["answer"] != "unknown" and pred == "unknown":
        out["abstain"] = -0.25
    if frame_mode:
        want = frame_label(r)
        if want and "facing:" in reply.lower():
            said = normalize_answer(reply.lower().split("facing:", 1)[1].split(";")[0], ["toward", "away"])
            out["frame"] = 0.3 if said == want else 0.0
    out["pred"] = pred
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dataset", type=Path, required=True)
    ap.add_argument("--split", default="train", choices=["train", "val"])
    ap.add_argument("--init", type=Path, help="start from an SFT LoRA adapter (recommended)")
    ap.add_argument("--group", type=int, default=6, help="samples per prompt (G)")
    ap.add_argument("--prompts-per-step", type=int, default=4)
    ap.add_argument("--steps", type=int, default=400)
    ap.add_argument("--lr", type=float, default=1e-5)
    ap.add_argument("--kl", type=float, default=0.02)
    ap.add_argument("--temperature", type=float, default=1.0)
    ap.add_argument("--frame-reasoning", action="store_true")
    ap.add_argument("--consistency", action="store_true")
    ap.add_argument("--tasks", default="", help="comma list of task types to train on (default: all)")
    ap.add_argument("--seed", type=int, default=3407)
    ap.add_argument("--out", type=Path)
    ap.add_argument("--smoke", action="store_true", help="2 steps, 2 prompts, G=2 on CPU")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    ds = a.dataset.resolve()
    rows = read_jsonl(ds / "registry" / f"{a.split}.jsonl")
    assert_not_holdout(ds, (r["sample_id"] for r in rows), (p for r in rows for p in r["image_paths"]), purpose="RL training")
    if a.tasks:
        keep = set(a.tasks.split(","))
        rows = [r for r in rows if r["task_type"] in keep]
    if a.frame_reasoning:
        rows = [r for r in rows if r["task_type"] in ("obs_lateral", "obs_frontback", "obs_lateral_eye")]
    groups = defaultdict(list)
    for r in rows:
        k = consistency_key(r)
        if k:
            groups[k].append(r)
    pairs = [v for v in groups.values() if len({x["image_paths"][0] for x in v}) > 1]
    if a.smoke:
        a.steps, a.prompts_per_step, a.group = 2, 2, 2
    print(json.dumps({"dataset": str(ds.relative_to(ROOT)), "prompts": len(rows), "consistency_groups": len(pairs), "group": a.group, "steps": a.steps,
                      "rewards": ["answer", "format", "abstain"] + (["frame"] if a.frame_reasoning else []) + (["consistency"] if a.consistency else [])}, indent=2))
    if a.dry_run:
        print("dry run OK: holdout guard passed; nothing loaded.")
        return 0

    import torch
    from peft import LoraConfig, PeftModel, get_peft_model
    from transformers import AutoModelForMultimodalLM, AutoProcessor

    from egoversa_research.sft import lora_targets

    random.seed(a.seed)
    torch.manual_seed(a.seed)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    dtype = torch.bfloat16 if device == "cuda" else torch.float32
    proc = AutoProcessor.from_pretrained("Qwen/Qwen3.5-0.8B")
    base = AutoModelForMultimodalLM.from_pretrained("Qwen/Qwen3.5-0.8B", dtype=dtype).to(device)
    if a.init:
        model = PeftModel.from_pretrained(base, str(a.init), is_trainable=True)
    else:
        targets, _ = lora_targets(base, finetune_vision=False)
        model = get_peft_model(base, LoraConfig(r=16, lora_alpha=16, lora_dropout=0.0, target_modules=targets))
    opt = torch.optim.AdamW([p for p in model.parameters() if p.requires_grad], lr=a.lr)
    from PIL import Image

    def encode(r: dict, completion: str | None):
        text = r["prompt"] + (FRAME_SUFFIX if a.frame_reasoning else "")
        msgs = [{"role": "user", "content": [*({"type": "image", "image": Image.open(ds / p).convert("RGB")} for p in r["image_paths"]), {"type": "text", "text": text}]}]
        if completion is not None:
            msgs.append({"role": "assistant", "content": [{"type": "text", "text": completion}]})
        return proc.apply_chat_template(msgs, add_generation_prompt=completion is None, tokenize=True, return_dict=True, return_tensors="pt", enable_thinking=False).to(device)

    def seq_logprob(r: dict, completion: str, n_prompt: int) -> torch.Tensor:
        enc = encode(r, completion)
        logits = model(**enc).logits[0, :-1]
        ids = enc["input_ids"][0, 1:]
        lp = torch.log_softmax(logits.float(), -1).gather(1, ids[:, None])[:, 0]
        return lp[n_prompt - 1:]  # completion tokens only

    run_dir = (a.out or ROOT / "research" / "runs" / ("grpo-smoke" if a.smoke else "grpo")).resolve()
    run_dir.mkdir(parents=True, exist_ok=True)
    log = open(run_dir / "grpo_log.jsonl", "w")
    max_new = 24 if a.frame_reasoning else 8
    t0 = time.time()
    for step in range(1, a.steps + 1):
        if a.consistency and pairs:
            batch = [x for g in random.sample(pairs, max(1, a.prompts_per_step // 2)) for x in g[:2]]
        else:
            batch = random.sample(rows, a.prompts_per_step)
        model.eval()
        samples = []  # (record, completion, reward dict, n_prompt)
        for r in batch:
            enc = encode(r, None)
            n_prompt = enc["input_ids"].shape[1]
            with torch.no_grad():
                out = model.generate(**enc, max_new_tokens=max_new, do_sample=True, temperature=a.temperature, top_p=1.0, num_return_sequences=a.group)
            for seq in out:
                comp = proc.tokenizer.decode(seq[n_prompt:], skip_special_tokens=True)
                samples.append([r, comp, reward(comp, r, a.frame_reasoning), n_prompt])
        if a.consistency:  # agreement with the other camera view of the same question (label-free)
            by_key = defaultdict(list)
            for s in samples:
                by_key[consistency_key(s[0])].append(s)
            for k, ss in by_key.items():
                if k is None:
                    continue
                for s in ss:
                    others = [o for o in ss if o[0]["sample_id"] != s[0]["sample_id"] and o[2]["pred"] is not None]
                    s[2]["consistency"] = 0.2 * (sum(o[2]["pred"] == s[2]["pred"] for o in others) / len(others)) if others and s[2]["pred"] else 0.0
        totals = [sum(v for k, v in s[2].items() if k != "pred") for s in samples]
        model.train()
        loss_sum, n_tok = 0.0, 0
        opt.zero_grad(set_to_none=True)
        for gi in range(0, len(samples), a.group):
            g = totals[gi:gi + a.group]
            mu = sum(g) / len(g)
            sd = (sum((x - mu) ** 2 for x in g) / len(g)) ** 0.5
            for j, s in enumerate(samples[gi:gi + a.group]):
                adv = (g[j] - mu) / (sd + 1e-4)
                if abs(adv) < 1e-6:
                    continue  # identical rewards in the group carry no signal
                lp = seq_logprob(s[0], s[1], s[3])
                with torch.no_grad(), model.disable_adapter():
                    ref = seq_logprob(s[0], s[1], s[3])
                kl = (torch.exp(ref - lp) - (ref - lp) - 1).mean()  # k3 estimator
                loss = -(adv * lp.mean()) + a.kl * kl
                loss.backward()
                loss_sum += float(loss)
                n_tok += lp.numel()
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        opt.step()
        rec = {"step": step, "mean_reward": round(sum(totals) / len(totals), 4), "answer_acc": round(sum(s[2]["answer"] for s in samples) / len(samples), 4),
               "loss": round(loss_sum, 5), "tokens": n_tok, "elapsed_s": round(time.time() - t0, 1),
               "examples": [{"task": s[0]["task_type"], "reply": s[1][:60], "reward": round(t, 3)} for s, t in zip(samples[:4], totals[:4])]}
        print(json.dumps(rec), flush=True)
        log.write(json.dumps(rec) + "\n")
    model.save_pretrained(run_dir / "adapter-last")
    (run_dir / "run_summary.json").write_text(json.dumps({"format": "egoversa.grpo-run", "smoke": a.smoke, "dataset": str(ds.relative_to(ROOT)), "steps": a.steps,
                                                          "group": a.group, "frame_reasoning": a.frame_reasoning, "consistency": a.consistency, "device": device,
                                                          "wall_s": round(time.time() - t0, 1), "track": "permissive"}, indent=2))
    print(f"done in {time.time() - t0:.0f}s -> {run_dir.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
