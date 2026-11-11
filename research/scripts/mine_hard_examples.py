#!/usr/bin/env python3
"""Hard-example mining from TRAIN / VAL mistakes only.

    python research/scripts/mine_hard_examples.py --results research/results/<run on train or val>.json --dataset research/data/egoversa-pilot --repeat 2

Reads an evaluation result file, keeps the items the model got wrong, and writes
sft/<split>.hard.jsonl containing those examples `--repeat` times (oracle targets, permissive track).
A result file that contains any frozen-test item is refused: mining on the holdout would turn the test
set into a training signal.
"""
import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "research"))
from egoversa_research.dataset import IntegrityError, assert_not_holdout, read_jsonl, write_jsonl  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--results", type=Path, required=True)
    ap.add_argument("--dataset", type=Path, required=True)
    ap.add_argument("--repeat", type=int, default=2)
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    res = json.loads(a.results.read_text())
    ds = a.dataset.resolve()
    items = res["items"]
    assert_not_holdout(ds, (i["sample_id"] for i in items), (p for i in items for p in i["image_paths"]), purpose="hard-example mining")
    wrong = {i["sample_id"] for i in items if not i["correct"]}
    by_task: dict[str, int] = {}
    for i in items:
        if not i["correct"]:
            by_task[i["task_type"]] = by_task.get(i["task_type"], 0) + 1
    print(f"{len(wrong)} of {len(items)} items wrong: {by_task}")
    out_rows = []
    for split in sorted({i["split"] for i in items}):
        sft = {r["sample_id"]: r for r in read_jsonl(ds / "sft" / f"{split}.jsonl")}
        hard = [sft[s] for s in sorted(wrong) if s in sft]
        out_rows += [(split, hard)]
        if not a.dry_run:
            write_jsonl(ds / "sft" / f"{split}.hard.jsonl", [r for _ in range(a.repeat) for r in hard])
            print(f"wrote sft/{split}.hard.jsonl with {len(hard)} x {a.repeat} examples")
    if a.dry_run:
        print("dry run: nothing written")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except IntegrityError as e:
        print(f"INTEGRITY ERROR: {e}", file=sys.stderr)
        sys.exit(2)
