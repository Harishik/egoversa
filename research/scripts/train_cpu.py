#!/usr/bin/env python3
"""CPU training for the EgoVersa-Spatial-1B student: frozen-trunk caching + exact-expectation policy optimisation.

    research/.conda/bin/python research/scripts/train_cpu.py --dataset research/data/egoversa-sim-pilot --out research/runs/cpu_epo
    research/.conda/bin/python research/scripts/train_cpu.py --dataset research/data/egoversa-sim-smoke --out research/runs/cpu_smoke --epochs 1

Stage 1 (cache)  one frozen forward per training/validation/test item; stores what decoder layer K receives
                 (hidden states, rotary embeddings, masks) plus the base model's answer distribution. Paid once.
Stage 2 (train)  LoRA on layers K..L-1 only. Each step runs those layers from the cache: no vision tower, no
                 bottom layers, no sampling. Loss = -E_pi[reward] (exact, over the admissible answers)
                 + beta * KL(pi || pi_base) (exact) + gamma * CE(gold) + lambda * cross-view disagreement.
Stage 3 (eval)   val/test accuracy for the base model (adapter disabled) and the trained adapter, from the same caches,
                 so the comparison is paired and exact. Test answers are read only at scoring, as in evaluate_models.py.
                 The adapter is saved in PEFT format, so evaluate_models.py --adapter re-checks it with free generation.

See egoversa_research/cpu_train.py for the derivation and `verify_trunk_cut` for the exactness check.
"""
from __future__ import annotations

import argparse
import contextlib
import json
import random
import sys
import time
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "research"))
sys.path.insert(0, str(ROOT / "research" / "scripts"))
from egoversa_research.dataset import read_jsonl  # noqa: E402

TRAIN_SPLITS = ("train", "train_extra")


def build_inputs(proc, ds: Path, row: dict, max_side: int | None):
    from PIL import Image
    imgs = []
    for p in row["image_paths"]:
        im = Image.open(ds / p).convert("RGB")
        if max_side and max(im.size) > max_side:
            s = max_side / max(im.size)
            im = im.resize((round(im.width * s), round(im.height * s)))
        imgs.append(im)
    content = [{"type": "image", "image": im} for im in imgs] + [{"type": "text", "text": row["prompt"]}]
    return proc.apply_chat_template([{"role": "user", "content": content}], add_generation_prompt=True, tokenize=True,
                                    return_dict=True, return_tensors="pt", enable_thinking=False)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dataset", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--base", default="Qwen/Qwen3.5-0.8B")
    ap.add_argument("--cut", type=int, default=16, help="first trainable decoder layer K (layers K..23 get LoRA)")
    ap.add_argument("--rank", type=int, default=16)
    ap.add_argument("--lr", type=float, default=2e-4)
    ap.add_argument("--epochs", type=int, default=3)
    ap.add_argument("--accum", type=int, default=8)
    ap.add_argument("--beta-kl", type=float, default=0.02)
    ap.add_argument("--gamma-ce", type=float, default=0.3)
    ap.add_argument("--lambda-consistency", type=float, default=0.2)
    ap.add_argument("--max-side", type=int, help="downscale images so the longer side is at most this (applies to every split)")
    ap.add_argument("--threads", type=int, default=8)
    ap.add_argument("--eval-splits", nargs="*", default=["val", "test_iid", "test_ood"])
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--train-limit", type=int, help="task-stratified subsample of the training items (consistency partners kept together)")
    ap.add_argument("--val-limit", type=int, default=120)
    ap.add_argument("--tasks", nargs="*", help="restrict training and evaluation to these task types (ablations)")
    ap.add_argument("--no-balanced", dest="balanced", action="store_false",
                    help="draw optimiser batches at random instead of one task per batch with labels in equal shares")
    a = ap.parse_args()

    import torch
    from transformers import AutoModelForMultimodalLM, AutoProcessor
    from peft import LoraConfig, get_peft_model
    from egoversa_research.cpu_train import (answer_distribution, answer_token_ids, capture_trunk, check_options_separable,
                                             consistency_loss, epo_loss, lm_head, load_cache, save_cache, text_model, top_forward)
    from train_grpo import consistency_key

    torch.manual_seed(a.seed)
    random.seed(a.seed)
    torch.set_num_threads(a.threads)
    ds = a.dataset.resolve()
    out = a.out.resolve()
    cache_dir = out / "cache"
    cache_dir.mkdir(parents=True, exist_ok=True)

    # ---- data: training rows from the registry (labels are training targets); eval rows from model_inputs only ----
    train = [r for s in TRAIN_SPLITS if (ds / "registry" / f"{s}.jsonl").exists() for r in read_jsonl(ds / "registry" / f"{s}.jsonl")]
    if a.tasks:
        train = [r for r in train if r["task_type"] in a.tasks]
    if a.train_limit and len(train) > a.train_limit:
        train = stratified(train, a.train_limit, a.seed)
    evals = {s: read_jsonl(ds / "model_inputs" / f"{s}.jsonl") for s in a.eval_splits if (ds / "model_inputs" / f"{s}.jsonl").exists()}
    if a.tasks:  # task type is not the answer; the registry is read here only for it
        for s_ in list(evals):
            keep = {r["sample_id"] for r in read_jsonl(ds / "registry" / f"{s_}.jsonl") if r["task_type"] in a.tasks}
            evals[s_] = [r for r in evals[s_] if r["sample_id"] in keep]
    if "val" in evals and a.val_limit and len(evals["val"]) > a.val_limit:
        evals["val"] = random.Random(a.seed).sample(evals["val"], a.val_limit)
    print(f"train {len(train)} items; eval " + ", ".join(f"{s} {len(v)}" for s, v in evals.items()))

    proc = AutoProcessor.from_pretrained(a.base)
    model = AutoModelForMultimodalLM.from_pretrained(a.base, dtype=torch.float32).eval()
    tm, head = text_model(model), lm_head(model)
    L = len(tm.layers)
    tok = answer_token_ids(proc.tokenizer)

    # ---- stage 1: frozen trunk cache ----
    t0 = time.time()
    todo = [(r["sample_id"], r) for r in train] + [(r["sample_id"], r) for rows in evals.values() for r in rows]
    n_new = 0
    for i, (sid, r) in enumerate(todo):
        p = cache_dir / f"{sid}.k{a.cut}.pt"
        if p.exists():
            continue
        save_cache(p, capture_trunk(model, build_inputs(proc, ds, r, a.max_side), a.cut))
        n_new += 1
        if n_new % 25 == 0:
            print(f"  cached {i + 1}/{len(todo)}  ({(time.time() - t0) / n_new:.2f}s/item)", flush=True)
    cache_s = time.time() - t0
    print(f"stage 1: {n_new} new caches in {cache_s:.0f}s ({cache_s / max(1, n_new):.2f}s/item); {len(todo) - n_new} reused")

    # ---- stage 2: LoRA on the top layers, trained from the cache ----
    if hasattr(model.model, "visual"):
        del model.model.visual  # never needed again: the cache already holds everything the vision tower contributed
    for i in range(a.cut):
        tm.layers[i] = torch.nn.Identity()
    layer_re = "|".join(str(i) for i in range(a.cut, L))
    cfg = LoraConfig(r=a.rank, lora_alpha=2 * a.rank, lora_dropout=0.05, bias="none",
                     target_modules=rf".*language_model\.layers\.({layer_re})\.(self_attn\.(q_proj|k_proj|v_proj|o_proj)|linear_attn\.(in_proj_qkv|in_proj_z|out_proj)|mlp\.(gate_proj|up_proj|down_proj))")
    peft_model = get_peft_model(model, cfg)
    n_train = sum(p.numel() for p in peft_model.parameters() if p.requires_grad)
    print(f"stage 2: LoRA r={a.rank} on layers {a.cut}..{L - 1}: {n_train / 1e6:.2f}M trainable parameters")
    opt = torch.optim.AdamW([p for p in peft_model.parameters() if p.requires_grad], lr=a.lr, weight_decay=0.0)

    caches = {}

    def cache(sid):
        if sid not in caches:
            caches[sid] = load_cache(cache_dir / f"{sid}.k{a.cut}.pt")
        return caches[sid]

    partners = defaultdict(list)
    for r in train:
        k = consistency_key(r)
        if k:
            partners[k].append(r)
    usable = [r for r in train if check_options_separable(r["oracle"]["options"], tok)]
    if len(usable) < len(train):
        print(f"  skipped {len(train) - len(usable)} items whose options share a first token")

    def evaluate(split_rows: dict[str, list[dict]], adapter: bool) -> dict:
        res = {}
        ctx = peft_model.disable_adapter() if not adapter else contextlib.nullcontext()
        with torch.no_grad(), ctx:
            peft_model.eval()
            for s, rows in split_rows.items():
                preds = {}
                for r in rows:
                    lg = top_forward(tm, head, cache(r["sample_id"]), a.cut)
                    # model-visible view has no options; options are parsed from the prompt's answer instruction
                    opts = parse_options(r["prompt"])
                    pa, p_other = answer_distribution(lg, opts, tok)
                    free = proc.tokenizer.decode([int(lg.argmax())]).strip().lower()
                    preds[r["sample_id"]] = {"constrained": opts[int(pa.argmax())], "first_token": free, "p_other": float(p_other)}
                res[s] = preds
        return res

    total_steps = a.epochs * len(usable)  # items; optimiser steps ~= total_steps / accum
    step, log = 0, []
    t_train = time.time()
    for ep in range(a.epochs):
        if a.balanced:
            batches = balanced_batches(usable, a.accum, random)
        else:
            shuf = random.sample(usable, len(usable))
            batches = [shuf[i:i + a.accum] for i in range(0, len(shuf), a.accum)]
        ends = set()
        order = []
        for b in batches:
            order += b
            ends.add(len(order) - 1)
        peft_model.train()
        agg = defaultdict(float)
        for j, r in enumerate(order):
            o = r["oracle"]
            lg = top_forward(tm, head, cache(r["sample_id"]), a.cut)
            loss, st = epo_loss(lg, o["options"], o["answer"], o["answerable"], tok, cache(r["sample_id"]).ref_logp, a.beta_kl, a.gamma_ce)
            k = consistency_key(r)
            mates = [m for m in partners.get(k, []) if m["sample_id"] != r["sample_id"]] if k else []
            if mates and a.lambda_consistency > 0:
                m = random.choice(mates)
                lg2 = top_forward(tm, head, cache(m["sample_id"]), a.cut)
                c = consistency_loss(lg, lg2, o["options"], tok)
                loss = loss + a.lambda_consistency * c
                st["agree"] = -c.item()
            (loss / a.accum).backward()
            for kk, v in st.items():
                agg[kk] += v
            agg["n"] += 1
            if j in ends:
                torch.nn.utils.clip_grad_norm_([p for p in peft_model.parameters() if p.requires_grad], 1.0)
                for g in opt.param_groups:
                    g["lr"] = a.lr * min(1.0, (step + 1) / 10) * max(0.05, 1 - step / max(1, total_steps / a.accum))
                opt.step()
                opt.zero_grad()
                step += 1
                if step % 5 == 0:
                    n = agg["n"]
                    print(f"  ep {ep} step {step}: E[r]={agg['expected_reward'] / n:.3f} p_gold={agg['p_gold'] / n:.3f} kl={agg['kl'] / n:.4f} "
                          f"p_other={agg['p_other'] / n:.3f}  ({(time.time() - t_train) / (ep * len(usable) + j + 1):.2f}s/item)", flush=True)
                    log.append({"epoch": ep, "step": step, **{kk: v / n for kk, v in agg.items() if kk != "n"}})
                    agg = defaultdict(float)
        if "val" in evals:
            v = evaluate({"val": evals["val"]}, adapter=True)["val"]
            reg = {r["sample_id"]: r for r in read_jsonl(ds / "registry" / "val.jsonl")}
            acc = sum(v[s]["constrained"] == reg[s]["oracle"]["answer"] for s in v) / len(v)
            print(f"epoch {ep}: val constrained accuracy {100 * acc:.1f}%")
            log.append({"epoch": ep, "val_acc": acc})
    train_s = time.time() - t_train
    peft_model.save_pretrained(out / "adapter")
    print(f"stage 2 done: {train_s:.0f}s, adapter -> {out / 'adapter'}")

    # ---- stage 3: paired evaluation (answers are read only now) ----
    base_preds = evaluate(evals, adapter=False)
    tuned_preds = evaluate(evals, adapter=True)
    report = {"format": "egoversa.cpu-train", "base": a.base, "cut": a.cut, "rank": a.rank, "epochs": a.epochs, "lr": a.lr,
              "beta_kl": a.beta_kl, "gamma_ce": a.gamma_ce, "lambda_consistency": a.lambda_consistency, "max_side": a.max_side,
              "n_train": len(usable), "trainable_params": n_train, "cache_seconds": cache_s, "train_seconds": train_s,
              "threads": a.threads, "log": log, "splits": {}}
    for s in evals:
        reg = {r["sample_id"]: r for r in read_jsonl(ds / "registry" / f"{s}.jsonl")}
        items = []
        for sid, bp in base_preds[s].items():
            r, tp = reg[sid], tuned_preds[s][sid]
            gold = r["oracle"]["answer"]
            items.append({"sample_id": sid, "task_type": r["task_type"], "gold": gold, "base": bp["constrained"], "tuned": tp["constrained"],
                          "base_first": bp["first_token"], "tuned_first": tp["first_token"]})
        n = len(items)
        b = sum(i["base"] == i["gold"] for i in items)
        t = sum(i["tuned"] == i["gold"] for i in items)
        bf = sum(i["base_first"] == i["gold"] for i in items)
        tf = sum(i["tuned_first"] == i["gold"] for i in items)
        only_t = sum(i["tuned"] == i["gold"] and i["base"] != i["gold"] for i in items)
        only_b = sum(i["base"] == i["gold"] and i["tuned"] != i["gold"] for i in items)
        per = defaultdict(lambda: [0, 0, 0])
        for i in items:
            per[i["task_type"]][0] += 1
            per[i["task_type"]][1] += i["base"] == i["gold"]
            per[i["task_type"]][2] += i["tuned"] == i["gold"]
        report["splits"][s] = {"n": n, "base_acc": b / n, "tuned_acc": t / n, "base_first_token_acc": bf / n, "tuned_first_token_acc": tf / n,
                               "only_tuned_correct": only_t, "only_base_correct": only_b, "per_task": {k: {"n": v[0], "base": v[1] / v[0], "tuned": v[2] / v[0]} for k, v in sorted(per.items())},
                               "items": items}
        print(f"{s:9s} n={n:4d}  base {100 * b / n:5.1f}%  tuned {100 * t / n:5.1f}%   (free first token: base {100 * bf / n:.1f}%, tuned {100 * tf / n:.1f}%)  discordant {only_t}/{only_b}")
    (out / "report.json").write_text(json.dumps(report, indent=1))
    print(f"report -> {out / 'report.json'}")
    return 0


def balanced_batches(rows: list[dict], batch: int, rng) -> list[list[dict]]:
    """Order items so every optimiser batch holds one task type with its answers in equal shares.

    With random batches a small model can lower the loss by tracking the label mix of the current batch (it learns a
    prior, not the image). A batch whose labels are balanced gives that shortcut zero gradient, so the only way left
    to lower the loss is to read the scene."""
    by = defaultdict(lambda: defaultdict(list))
    for r in rows:
        by[r["task_type"]][r["oracle"]["answer"]].append(r)
    batches = []
    for task, labels in by.items():
        pools = [rng.sample(v, len(v)) for v in labels.values()]
        per = max(1, batch // len(pools))
        while all(len(p) >= per for p in pools) and len(pools) > 1:
            b = [pools[i].pop() for i in range(len(pools)) for _ in range(per)]
            rng.shuffle(b)
            batches.append(b)
        if len(pools) == 1:  # a task with a single answer in this data (e.g. all "front"): nothing to balance
            rest = pools[0]
            batches += [rest[i:i + batch] for i in range(0, len(rest), batch)]
        # the unbalanced tail of a multi-answer task is skipped this epoch; reshuffling brings it back next epoch
    rng.shuffle(batches)
    return batches


def stratified(rows: list[dict], n: int, seed: int) -> list[dict]:
    """Equal share per task type (capped by availability), whole scenes at a time so cross-view partners stay together."""
    from train_grpo import consistency_key
    rng = random.Random(seed)
    by_task = defaultdict(list)
    for r in rows:
        by_task[r["task_type"]].append(r)
    quota = n // len(by_task)
    picked = []
    for t, rs in sorted(by_task.items()):
        groups = defaultdict(list)
        for r in rs:
            groups[consistency_key(r) or r["sample_id"]].append(r)
        keys = sorted(groups)
        rng.shuffle(keys)
        got = []
        for k in keys:
            if len(got) >= quota:
                break
            got += groups[k]
        picked += got
    return picked


def parse_options(prompt: str) -> list[str]:
    """Options from the prompt's instruction line: 'Answer with exactly one word: a, b, or c.'"""
    line = prompt.split("exactly one word:", 1)[1].split(".", 1)[0]
    return [w.strip() for w in line.replace(" or ", ",").split(",") if w.strip()]


if __name__ == "__main__":
    raise SystemExit(main())
