#!/usr/bin/env python3
"""Paired analyses on evaluation result files (research/results/*.json).

    python research/scripts/analyze_results.py research/results/<file>.json [--dataset research/data/<name>]

Reports, using only the stored replies and the registry:
  * accuracy per task with Wilson intervals, against the majority-answer rate and the top-reply share
  * the imagery ablation: each obs_lateral_eye item is paired with its plain obs_lateral twin (same scene image,
    same objects); accuracy on the paired subset, the discordant counts and an exact two-sided McNemar test
  * accuracy by observer heading offset (0-60, 60-120, 120-180 degrees) with and without the robot's view
Standard library only.
"""
import argparse
import json
import math
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "research"))
from egoversa_research.dataset import read_jsonl  # noqa: E402


def wilson(c: int, n: int, z: float = 1.959964):
    if not n:
        return float("nan"), float("nan"), float("nan")
    p = c / n
    d = 1 + z * z / n
    m = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return p, max(0.0, m - h), min(1.0, m + h)


def mcnemar_exact(b: int, c: int) -> float:
    """Two-sided exact binomial test on the discordant pairs."""
    n = b + c
    if n == 0:
        return 1.0
    k = min(b, c)
    tail = sum(math.comb(n, i) for i in range(k + 1)) / 2 ** n
    return min(1.0, 2 * tail)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("result", type=Path)
    ap.add_argument("--dataset", type=Path)
    ap.add_argument("--json", type=Path, help="also write the analysis as JSON")
    a = ap.parse_args()
    res = json.loads(a.result.read_text())
    ds = a.dataset or ROOT / "research" / "data" / res["dataset"]["name"]
    reg = {}
    for s in res["dataset"]["splits"]:
        reg.update({r["sample_id"]: r for r in read_jsonl(ds / "registry" / f"{s}.jsonl")})
    items = res["items"]
    out = {"model": res["model"]["label"], "n": len(items), "tasks": {}}
    print(f"{res['model']['label']} [{res['model'].get('quantization')}] on {res['dataset']['name']} {res['dataset']['splits']}: n={len(items)}")
    by = defaultdict(list)
    for it in items:
        by[it["task_type"]].append(it)
    print(f"{'task':20s} {'n':>4s} {'acc':>7s} {'95% CI':>15s} {'majority':>9s} {'top reply':>10s}")
    for t, L in sorted(by.items()):
        c = sum(i["correct"] for i in L)
        p, lo, hi = wilson(c, len(L))
        maj = max(Counter(i["gold"] for i in L).values()) / len(L)
        top = max(Counter(i["pred"] for i in L).values()) / len(L)
        out["tasks"][t] = {"n": len(L), "acc": p, "lo": lo, "hi": hi, "majority": maj, "top_reply_share": top}
        print(f"{t:20s} {len(L):4d} {100*p:6.1f}% [{100*lo:5.1f},{100*hi:5.1f}] {100*maj:8.1f}% {100*top:9.1f}%")
    # ---- imagery ablation (paired) ----
    def pair_key(it):
        r = reg[it["sample_id"]]
        return (r["image_paths"][0], tuple(r["metadata"]["object_names"]), r["metadata"]["template_id"])
    plain = {pair_key(i): i for i in by.get("obs_lateral", [])}
    pairs = [(plain[pair_key(e)], e) for e in by.get("obs_lateral_eye", []) if pair_key(e) in plain]
    if pairs:
        n = len(pairs)
        a_ok = sum(p["correct"] for p, _ in pairs)
        e_ok = sum(e["correct"] for _, e in pairs)
        b = sum(p["correct"] and not e["correct"] for p, e in pairs)  # plain right, imagery wrong
        c = sum(e["correct"] and not p["correct"] for p, e in pairs)  # imagery right, plain wrong
        pv = mcnemar_exact(b, c)
        same_reply = sum(p["pred"] == e["pred"] for p, e in pairs)
        print(f"\nimagery ablation on {n} paired observer left/right questions:")
        print(f"  scene image only      {100*a_ok/n:5.1f}%  ({a_ok}/{n})")
        print(f"  + robot's own view    {100*e_ok/n:5.1f}%  ({e_ok}/{n})")
        print(f"  discordant: plain-only correct {b}, imagery-only correct {c}; exact McNemar p = {pv:.3g}; identical replies {same_reply}/{n}")
        bins = defaultdict(lambda: [0, 0, 0])
        for p, e in pairs:
            th = reg[p["sample_id"]]["metadata"]["theta_deg"] or 0
            k = "0-60" if th < 60 else "60-120" if th <= 120 else "120-180"
            bins[k][0] += 1
            bins[k][1] += p["correct"]
            bins[k][2] += e["correct"]
        for k in ("0-60", "60-120", "120-180"):
            if bins[k][0]:
                n_, x, y = bins[k]
                print(f"  heading offset {k:>8s} deg: n={n_:3d}  plain {100*x/n_:5.1f}%  imagery {100*y/n_:5.1f}%")
        out["imagery"] = {"pairs": n, "plain_acc": a_ok / n, "imagery_acc": e_ok / n, "plain_only": b, "imagery_only": c, "mcnemar_p": pv, "identical_replies": same_reply,
                          "by_theta": {k: {"n": v[0], "plain": v[1] / v[0], "imagery": v[2] / v[0]} for k, v in bins.items() if v[0]}}
    if a.json:
        a.json.write_text(json.dumps(out, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
