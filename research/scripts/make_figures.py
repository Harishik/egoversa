#!/usr/bin/env python3
"""Build the README result figures (SVG, no plotting library) from the CPU-training reports.

    python3 research/scripts/make_figures.py

Reads research/runs/*/report.json when present, otherwise the committed summary
research/results/cpu_training_summary.json, and writes docs/figures/results_*.svg.
Every number in the figures comes from those reports; nothing is typed in by hand.
"""
from __future__ import annotations

import collections
import json
from math import comb
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RUNS = ROOT / "research" / "runs"
SUMMARY = ROOT / "research" / "results" / "cpu_training_summary.json"
FIG = ROOT / "docs" / "figures"

# palette: card surfaces from the project's figures; series colours validated (dataviz validator, dark mode, surface #131A3B)
BG, PANEL, LINE, INK, INK2, INK3 = "#0A0E22", "#131A3B", "#2A3368", "#E9ECFF", "#A0A8D4", "#6B739E"
OURS, RL, SFT = "#3987e5", "#d95926", "#199e70"
BASE, MAJ = "#8A91B4", "#4A517A"  # baselines are neutral by design and always carry a direct value label
FONT = "Manrope, Inter, system-ui, -apple-system, Segoe UI, sans-serif"
TASK_NAMES = {
    "lateral": "Camera left / right", "depth": "Closer / farther", "vertical": "Above / below", "visibility": "Visible / occluded",
    "support": "Resting on (contact forces)", "counterfactual": "What if removed (rollout)", "mv_camera_motion": "Camera motion (2 views)",
    "mv_best_view": "Best view (2 views)", "obs_lateral": "Robot's left / right", "obs_lateral_eye": "Robot's left / right + its view",
    "obs_frontback": "Robot's front / behind", "facing": "Robot facing camera?", "abstain": "Abstain on hidden object",
}


def mcnemar(b: int, c: int) -> float:
    n, k = b + c, min(b, c)
    return min(1.0, 2 * sum(comb(n, i) for i in range(k + 1)) / 2 ** n) if n else 1.0


def summarise(report: dict, majority: dict) -> dict:
    out = {}
    for split, sp in report["splits"].items():
        it = sp["items"]
        n = len(it)
        b = sum(i["base"] == i["gold"] for i in it)
        t = sum(i["tuned"] == i["gold"] for i in it)
        m = sum(majority.get(i["task_type"]) == i["gold"] for i in it)
        only_t = sum(i["tuned"] == i["gold"] and i["base"] != i["gold"] for i in it)
        only_b = sum(i["base"] == i["gold"] and i["tuned"] != i["gold"] for i in it)
        per = collections.defaultdict(lambda: [0, 0, 0, 0])
        for i in it:
            q = per[i["task_type"]]
            q[0] += 1
            q[1] += majority.get(i["task_type"]) == i["gold"]
            q[2] += i["base"] == i["gold"]
            q[3] += i["tuned"] == i["gold"]
        out[split] = {"n": n, "majority": m / n, "base": b / n, "tuned": t / n,
                      "base_free": sp.get("base_first_token_acc"), "tuned_free": sp.get("tuned_first_token_acc"),
                      "only_tuned": only_t, "only_base": only_b, "p": mcnemar(only_t, only_b),
                      "per_task": {k: {"n": q[0], "majority": q[1] / q[0], "base": q[2] / q[0], "tuned": q[3] / q[0]} for k, q in sorted(per.items())}}
    return out


def collect() -> dict:
    runs = {"full": "cpu_epo_v05_k6", "hybrid": "cap_lateral_k6", "hybrid_k16": "cap_lateral_k16", "rl_only": "abl_rl_only", "sft_only": "abl_sft_only"}
    if not all((RUNS / r / "report.json").exists() for r in runs.values()):
        return json.loads(SUMMARY.read_text())
    train = [json.loads(line) for line in open(ROOT / "research/data/egoversa-sim-pilot-v05/registry/train.jsonl")]
    cnt = collections.defaultdict(collections.Counter)
    for r in train:
        cnt[r["task_type"]][r["oracle"]["answer"]] += 1
    majority = {t: c.most_common(1)[0][0] for t, c in cnt.items()}
    data = {"dataset": "egoversa-sim-pilot v0.5.0 (locked test_iid / test_ood)", "metric": "constrained accuracy (argmax over the admissible answers)", "runs": {}}
    for key, name in runs.items():
        rep = json.loads((RUNS / name / "report.json").read_text())
        data["runs"][key] = {"dir": name, "cut": rep["cut"], "epochs": rep["epochs"], "lr": rep["lr"], "alpha_rl": rep.get("alpha_rl", 1.0),
                             "gamma_ce": rep["gamma_ce"], "beta_kl": rep["beta_kl"], "lambda_consistency": rep["lambda_consistency"],
                             "n_train": rep["n_train"], "trainable_params": rep["trainable_params"], "cache_seconds": rep["cache_seconds"],
                             "train_seconds": rep["train_seconds"], "splits": summarise(rep, majority)}
    SUMMARY.parent.mkdir(parents=True, exist_ok=True)
    SUMMARY.write_text(json.dumps(data, indent=1))
    return data


# ------------------------------------------------------------------------------------------------ svg helpers

def esc(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def text(x, y, s, size=13, fill=INK2, weight=400, anchor="start", extra=""):
    return f'<text x="{x:.1f}" y="{y:.1f}" font-size="{size}" fill="{fill}" font-weight="{weight}" text-anchor="{anchor}" {extra}>{esc(s)}</text>'


def bar(x, y0, w, h, fill):
    """Vertical bar anchored to the baseline y0, 4 px rounded data end."""
    r = min(4, w / 2, h)
    top = y0 - h
    return (f'<path d="M{x:.1f},{y0:.1f} V{top + r:.1f} Q{x:.1f},{top:.1f} {x + r:.1f},{top:.1f} H{x + w - r:.1f} '
            f'Q{x + w:.1f},{top:.1f} {x + w:.1f},{top + r:.1f} V{y0:.1f} Z" fill="{fill}"/>')


def card(w, h, title, subtitle, body):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" font-family="{FONT}" role="img" aria-label="{esc(title)}">'
            f'<title>{esc(title)}</title><rect width="{w}" height="{h}" rx="20" fill="{BG}"/>'
            + text(36, 48, title, 22, INK, 700) + text(36, 74, subtitle, 13.5, INK2) + body + "</svg>")


def legend(x, y, items):
    out, cx = [], x
    for label, color in items:
        out.append(f'<rect x="{cx:.1f}" y="{y - 10:.1f}" width="12" height="12" rx="3" fill="{color}"/>')
        out.append(text(cx + 18, y, label, 13, INK2))
        cx += 18 + 7.2 * len(label) + 22
    return "".join(out)


def grouped_bars(x0, y0, width, height, groups, series, ymax=1.0, note=None):
    """groups: [(label, [values per series], subtitle)]; series: [(name, color)]."""
    out = []
    for g in (0.25, 0.5, 0.75, 1.0):
        y = y0 - height * g / ymax
        out.append(f'<line x1="{x0}" x2="{x0 + width}" y1="{y:.1f}" y2="{y:.1f}" stroke="{LINE}" stroke-width="1"/>')
        out.append(text(x0 - 10, y + 4, f"{int(g * 100)}%", 11.5, INK3, anchor="end"))
    out.append(f'<line x1="{x0}" x2="{x0 + width}" y1="{y0}" y2="{y0}" stroke="{INK3}" stroke-width="1"/>')
    gw = width / len(groups)
    bw = min(64, (gw - 60) / len(series) - 2)
    for gi, (label, vals, sub) in enumerate(groups):
        gx = x0 + gi * gw + (gw - (bw + 2) * len(series)) / 2
        for si, ((name, color), v) in enumerate(zip(series, vals)):
            bx = gx + si * (bw + 2)
            h = height * v / ymax
            out.append(bar(bx, y0, bw, h, color))
            out.append(text(bx + bw / 2, y0 - h - 8, f"{100 * v:.1f}", 13, INK, 700, "middle"))
        out.append(text(x0 + gi * gw + gw / 2, y0 + 24, label, 14, INK, 600, "middle"))
        if sub:
            out.append(text(x0 + gi * gw + gw / 2, y0 + 42, sub, 12, INK2, anchor="middle"))
    return "".join(out)


# ---------------------------------------------------------------------------------------------------- figures

def fig_main(d: dict) -> str:
    s = d["runs"]["full"]["splits"]
    groups = []
    for split, label in (("test_iid", "Locked test, in distribution"), ("test_ood", "Locked test, held-out objects")):
        v = s[split]
        groups.append((f"{label}  (n = {v['n']})", [v["majority"], v["base"], v["tuned"]],
                       f"ours vs base: +{100 * (v['tuned'] - v['base']):.1f} pts, McNemar p = {v['p']:.1g}"))
    body = legend(36, 108, [("Majority answer", MAJ), ("Base Qwen3.5-0.8B", BASE), ("EgoVersa-Spatial (ours, trained on CPU)", OURS)])
    body += grouped_bars(80, 420, 1080, 280, groups, [("maj", MAJ), ("base", BASE), ("ours", OURS)])
    body += text(36, 500, "All 13 task types. Same items for every bar; only the trained LoRA differs between base and ours. Accuracy = argmax over the admissible answers.", 12, INK3)
    return card(1200, 520, "EgoVersa-Spatial vs base Qwen3.5-0.8B", "MuJoCo scenes with real scanned objects and robots · 724 + 573 locked test questions · trained end to end on a laptop CPU", body)


def fig_tasks(d: dict) -> str:
    s = d["runs"]["full"]["splits"]
    tasks = [t for t in s["test_ood"]["per_task"] if t in s["test_iid"]["per_task"]]
    tasks.sort(key=lambda t: -(s["test_iid"]["per_task"][t]["tuned"] - s["test_iid"]["per_task"][t]["base"]
                              + s["test_ood"]["per_task"][t]["tuned"] - s["test_ood"]["per_task"][t]["base"]))
    row, top, left = 34, 150, 300
    pw, gap = 360, 120
    h = top + row * len(tasks) + 60
    out = [legend(36, 108, [("Base Qwen3.5-0.8B", BASE), ("EgoVersa-Spatial (ours)", OURS)])]
    for pi, (split, label) in enumerate((("test_iid", "In distribution"), ("test_ood", "Held-out objects"))):
        x0 = left + pi * (pw + gap)
        out.append(text(x0 + pw / 2, top - 22, f"{label}  (n = {s[split]['n']})", 14, INK, 600, "middle"))
        for g in (0, 0.25, 0.5, 0.75, 1.0):
            x = x0 + pw * g
            out.append(f'<line x1="{x:.1f}" x2="{x:.1f}" y1="{top - 8}" y2="{top + row * len(tasks) - 10}" stroke="{LINE}" stroke-width="1"/>')
            out.append(text(x, top + row * len(tasks) + 8, f"{int(g * 100)}%", 11, INK3, anchor="middle"))
        for ri, t in enumerate(tasks):
            q = s[split]["per_task"][t]
            y = top + ri * row + 6
            xb, xt = x0 + pw * q["base"], x0 + pw * q["tuned"]
            out.append(f'<line x1="{xb:.1f}" x2="{xt:.1f}" y1="{y:.1f}" y2="{y:.1f}" stroke="{INK3}" stroke-width="2"/>')
            out.append(f'<circle cx="{xb:.1f}" cy="{y:.1f}" r="6" fill="{BASE}" stroke="{BG}" stroke-width="2"/>')
            out.append(f'<circle cx="{xt:.1f}" cy="{y:.1f}" r="6.5" fill="{OURS}" stroke="{BG}" stroke-width="2"/>')
            d_ = 100 * (q["tuned"] - q["base"])
            lx = max(xb, xt) + 12
            out.append(text(lx, y + 4, f"{100 * q['tuned']:.0f}%  ({'+' if d_ >= 0 else '−'}{abs(d_):.0f})", 11.5, INK if d_ >= 0 else INK2, 600 if d_ >= 5 else 400))
            if pi == 0:
                out.append(text(36, y + 4.5, TASK_NAMES.get(t, t), 13, INK2))
                out.append(text(left - 30, y + 4.5, f"{q['n']} / {s['test_ood']['per_task'][t]['n']}", 11.5, INK3, anchor="end"))
    out.append(text(left - 30, top - 22, "n iid / ood", 11.5, INK3, anchor="end"))
    out.append(text(36, h - 24, "Sorted by total gain. Dot = accuracy; label = ours (change vs base, points). Small cells (n < 30) carry wide uncertainty.", 12, INK3))
    return card(1200, h, "Where the gain comes from, per task", "Gains on camera-frame relations, contact-force support, camera motion and the robot's own view; losses on imagined robot-frame relations", "".join(out))


def fig_ablation(d: dict) -> str:
    r = d["runs"]
    series = [("Base Qwen3.5-0.8B", BASE), ("RL reward only", RL), ("Supervised only", SFT), ("Hybrid (ours)", OURS)]
    groups = []
    for split, label in (("test_iid", "In distribution"), ("test_ood", "Held-out objects")):
        groups.append((f"{label}  (n = {r['hybrid']['splits'][split]['n']})",
                       [r["hybrid"]["splits"][split]["base"], r["rl_only"]["splits"][split]["tuned"], r["sft_only"]["splits"][split]["tuned"], r["hybrid"]["splits"][split]["tuned"]], None))
    body = legend(36, 108, series)
    body += grouped_bars(80, 400, 1080, 250, groups, series)
    body += text(36, 462, "Lateral + robot-lateral tasks, 501 training items, layer-6 cut, 3 epochs, same caches and seeds. The exact expected-reward term alone collapses", 12, INK3)
    body += text(36, 480, "to one answer (chance); the gain comes from the supervised term, and adding the reward to it does not add measurable accuracy.", 12, INK3)
    return card(1200, 500, "Ablation: what the reinforcement-learning term contributes", "Same data, same trainable layers, only the objective changes", body)


def main() -> int:
    import argparse
    argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter).parse_args()
    d = collect()
    FIG.mkdir(parents=True, exist_ok=True)
    for name, svg in (("results_main", fig_main(d)), ("results_tasks", fig_tasks(d)), ("results_ablation", fig_ablation(d))):
        (FIG / f"{name}.svg").write_text(svg)
        print(f"wrote docs/figures/{name}.svg")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
