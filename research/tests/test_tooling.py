"""Tests for the Python research tooling. No model, no torch: `pytest research/tests` runs anywhere."""
import copy
import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "research"))
from egoversa_research.dataset import (IntegrityError, HoldoutLock, assert_not_holdout, assert_track, read_jsonl, validate_dataset, write_jsonl)  # noqa: E402
from egoversa_research.parsing import normalize_answer  # noqa: E402

SMOKE = ROOT / "research" / "data" / "egoversa-smoke"
pytestmark = pytest.mark.skipif(not SMOKE.exists(), reason="build the smoke dataset first: npm run dataset -- --config research/configs/dataset.smoke.json")


@pytest.mark.parametrize("case", json.loads((ROOT / "tests" / "fixtures" / "parse_cases.json").read_text()))
def test_parser_matches_shared_vectors(case):
    assert normalize_answer(case["raw"], case["options"]) == case["expected"]


def test_smoke_dataset_is_valid():
    rep = validate_dataset(SMOKE)
    assert rep.ok, rep.errors
    assert sum(s["samples"] for s in rep.stats.values()) >= 50
    assert set(rep.stats) == {"test_iid", "test_ood", "train", "val"}


@pytest.fixture()
def copy_ds(tmp_path):
    d = tmp_path / "ds"
    shutil.copytree(SMOKE, d)
    return d


def _rewrite(d: Path, split: str, fn):
    rows = read_jsonl(d / "registry" / f"{split}.jsonl")
    fn(rows)
    write_jsonl(d / "registry" / f"{split}.jsonl", rows)


def test_detects_leak_in_model_inputs(copy_ds):
    rows = read_jsonl(copy_ds / "model_inputs" / "train.jsonl")
    rows[0]["answer"] = "left"  # an extra, answer-bearing key
    write_jsonl(copy_ds / "model_inputs" / "train.jsonl", rows)
    assert any("only" in e and "allowed" in e for e in validate_dataset(copy_ds, check_images=False).errors)


def test_detects_coordinates_in_prompt(copy_ds):
    def f(rows):
        rows[0]["prompt"] = rows[0]["prompt"].replace("?", " (x=0.42)?", 1)
    _rewrite(copy_ds, "train", f)
    assert any("digits or oracle vocabulary" in e for e in validate_dataset(copy_ds, check_images=False).errors)


def test_detects_modified_holdout(copy_ds):
    def f(rows):
        rows[0]["oracle"] = {**rows[0]["oracle"]}
        rows[0]["metadata"]["difficulty"] = "tampered"
    _rewrite(copy_ds, "test_iid", f)
    assert any("frozen test set was modified" in e for e in validate_dataset(copy_ds, check_images=False).errors)


def test_detects_cross_split_scene_overlap(copy_ds):
    test_rows = read_jsonl(copy_ds / "registry" / "test_iid.jsonl")
    def f(rows):
        rows[0]["metadata"]["scene_fingerprint"] = test_rows[0]["metadata"]["scene_fingerprint"]
    _rewrite(copy_ds, "train", f)
    errs = validate_dataset(copy_ds, check_images=False).errors
    assert any("shared between" in e or "overlaps the locked holdout" in e for e in errs)


def test_detects_corrupted_image(copy_ds):
    img = next((copy_ds / "images" / "val").glob("*.png"))
    img.write_bytes(img.read_bytes() + b"x")
    assert any("does not match its recorded sha256" in e for e in validate_dataset(copy_ds).errors)


def test_holdout_cannot_be_used_for_training_or_teacher_targets():
    lock = HoldoutLock.load(SMOKE)
    test_rows = read_jsonl(SMOKE / "registry" / "test_ood.jsonl")
    train_rows = read_jsonl(SMOKE / "registry" / "train.jsonl")
    assert lock and test_rows[0]["sample_id"] in lock.sample_ids
    assert_not_holdout(SMOKE, [r["sample_id"] for r in train_rows], [p for r in train_rows for p in r["image_paths"]])
    with pytest.raises(IntegrityError):
        assert_not_holdout(SMOKE, [train_rows[0]["sample_id"], test_rows[0]["sample_id"]])
    with pytest.raises(IntegrityError):  # a test image smuggled in under a training id
        assert_not_holdout(SMOKE, ["train_x"], [test_rows[0]["image_paths"][0]])


def test_licence_tracks_cannot_be_mixed():
    sft = read_jsonl(SMOKE / "sft" / "train.jsonl")
    assert_track(sft, "permissive")
    tainted = copy.deepcopy(sft[:2])
    tainted[1].update(license_track="research-nc", supervision="teacher-imitation")
    with pytest.raises(IntegrityError):
        assert_track(tainted, "permissive")
    assert_track(tainted, "research-nc")  # the research track may contain both


def test_sft_records_have_image_and_one_word_target():
    reg = {r["sample_id"]: r for r in read_jsonl(SMOKE / "registry" / "train.jsonl")}
    for r in read_jsonl(SMOKE / "sft" / "train.jsonl"):
        user, assistant = r["messages"]
        kinds = [c["type"] for c in user["content"]]
        assert kinds.count("image") in (1, 2) and kinds[-1] == "text"
        target = assistant["content"][0]["text"]
        assert target == reg[r["sample_id"]]["oracle"]["answer"] and " " not in target
        # the user turn carries the prompt and nothing from the oracle side
        assert user["content"][-1]["text"] == reg[r["sample_id"]]["prompt"]
        assert set(r) == {"sample_id", "supervision", "license_track", "messages"}


def _cli(*args):
    return subprocess.run([sys.executable, *map(str, args)], capture_output=True, text=True, cwd=ROOT)


def test_teacher_script_refuses_test_split_and_dry_runs_on_train():
    r = _cli("research/scripts/run_teacher.py", "--dataset", SMOKE, "--split", "test_iid", "--dry-run")
    assert r.returncode != 0 and "invalid choice" in r.stderr
    r = _cli("research/scripts/run_teacher.py", "--dataset", SMOKE, "--split", "train", "--dry-run")
    assert r.returncode == 0 and "research-nc" in r.stdout


def test_mining_refuses_results_computed_on_the_holdout(tmp_path):
    t = read_jsonl(SMOKE / "registry" / "test_iid.jsonl")[0]
    res = tmp_path / "r.json"
    res.write_text(json.dumps({"items": [{"sample_id": t["sample_id"], "image_paths": t["image_paths"], "correct": False, "task_type": t["task_type"], "split": "test_iid"}]}))
    r = _cli("research/scripts/mine_hard_examples.py", "--results", res, "--dataset", SMOKE, "--dry-run")
    assert r.returncode == 2 and "locked holdout" in r.stderr


def test_every_script_has_help():
    for s in sorted((ROOT / "research" / "scripts").glob("*.py")):
        r = _cli(s, "--help")
        assert r.returncode == 0 and "usage" in r.stdout.lower(), s.name


def test_registry_declares_tracks_and_honest_sizes():
    models = {m["id"]: m for m in json.loads((ROOT / "research" / "configs" / "models.json").read_text())["models"]}
    assert models["qwen3.5-0.8b-base"]["params_millions"] < 1000 and models["qwen3.5-0.8b-base"]["license"] == "apache-2.0"
    assert models["spatialaxiom-9b"]["track"] == "research-nc" and models["spatialaxiom-9b"]["license"] == "cc-by-nc-4.0"
    assert models["minicpm-v-4.7-1b"]["params_millions"] > 1500  # 1.55B total, not "1B"
    assert all(m["track"] in ("permissive", "research-nc") for m in models.values())
