#!/usr/bin/env python3
"""Validate an EgoVersa dataset: schema, answer/option consistency, image hashes, prompt leakage,
split disjointness, template leakage, licence-track purity and the frozen-holdout lock.

    python research/scripts/validate_dataset.py research/data/egoversa-smoke
    python research/scripts/validate_dataset.py research/data/egoversa-pilot --no-images   # skip re-hashing

Exit code 0 only if there are no errors. Uses the Python standard library only.
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from egoversa_research.dataset import validate_dataset  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("dataset", type=Path, help="dataset directory (contains manifest.json)")
    ap.add_argument("--no-images", action="store_true", help="do not re-hash image files")
    ap.add_argument("--json", action="store_true", help="print the full report as JSON")
    a = ap.parse_args()
    rep = validate_dataset(a.dataset, check_images=not a.no_images)
    if a.json:
        print(json.dumps({"ok": rep.ok, "errors": rep.errors, "warnings": rep.warnings, "stats": rep.stats}, indent=2))
    else:
        for s, st in rep.stats.items():
            print(f"{s:9s} {st['samples']:5d} samples  {st['scenes']:4d} scenes  {st['images']:4d} images  templates {st['templates']}")
        for w in rep.warnings:
            print("WARN ", w)
        for e in rep.errors[:40]:
            print("ERROR", e)
        print("OK: dataset is valid" if rep.ok else f"FAILED: {len(rep.errors)} error(s)")
    return 0 if rep.ok else 1


if __name__ == "__main__":
    sys.exit(main())
