"""Exact-expectation policy optimisation: the closed-form objective must equal the sampled one in expectation."""
import sys
from pathlib import Path

import pytest

torch = pytest.importorskip("torch")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from egoversa_research.cpu_train import answer_distribution, check_options_separable, consistency_loss, epo_loss, rewards_for  # noqa: E402

TOK = {"left": [3], "right": [5], "unknown": [7, 8]}
OPTS = ["left", "right", "unknown"]


def test_expected_reward_matches_monte_carlo():
    g = torch.Generator().manual_seed(0)
    logits = torch.randn(12, generator=g)
    loss, st = epo_loss(logits, OPTS, "right", True, TOK, torch.log_softmax(logits, -1), kl_coef=0.0, ce_coef=0.0)
    p = torch.softmax(logits, -1)
    draws = torch.multinomial(p, 200_000, replacement=True, generator=g)
    r = {3: rewards_for(OPTS, "right", True)[0], 5: rewards_for(OPTS, "right", True)[1], 7: rewards_for(OPTS, "right", True)[2], 8: rewards_for(OPTS, "right", True)[2]}
    mc = sum(r.get(int(t), -0.1) for t in draws) / len(draws)
    assert abs(st["expected_reward"] - mc) < 0.01
    assert abs(-float(loss) - st["expected_reward"]) < 1e-6


def test_gradient_raises_gold_probability():
    logits = torch.zeros(12, requires_grad=True)
    loss, _ = epo_loss(logits, OPTS, "left", True, TOK, torch.log_softmax(torch.zeros(12), -1), kl_coef=0.02, ce_coef=0.3)
    loss.backward()
    with torch.no_grad():
        new = logits - 1.0 * logits.grad
    pa_old, _ = answer_distribution(torch.zeros(12), OPTS, TOK)
    pa_new, _ = answer_distribution(new, OPTS, TOK)
    assert pa_new[0] > pa_old[0]


def test_kl_zero_at_reference_and_variants_summed():
    logits = torch.randn(12)
    _, st = epo_loss(logits, OPTS, "left", True, TOK, torch.log_softmax(logits, -1), kl_coef=1.0, ce_coef=0.0)
    assert abs(st["kl"]) < 1e-5
    p = torch.softmax(logits, -1)
    pa, _ = answer_distribution(logits, OPTS, TOK)
    assert torch.isclose(pa[2], p[7] + p[8])


def test_abstention_rewards_and_consistency():
    assert rewards_for(OPTS, "unknown", False) == [pytest.approx(-0.4), pytest.approx(-0.4), pytest.approx(1.1)]
    assert rewards_for(OPTS, "left", True)[2] == pytest.approx(-0.15)
    a = torch.tensor([0.0, 0, 0, 10, 0, 0, 0, 0, 0, 0, 0, 0])
    assert float(consistency_loss(a, a, OPTS, TOK)) < -0.99  # both certain of "left": agreement 1
    assert check_options_separable(OPTS, TOK) and not check_options_separable(["a", "b"], {"a": [1], "b": [1, 2]})


def test_option_parser_reads_instruction_line():
    from train_cpu import parse_options
    assert parse_options("Is it left?\nAnswer with exactly one word: left, right, or unknown. If ...") == OPTS
    assert parse_options("Which view?\nAnswer with exactly one word: first or second.") == ["first", "second"]


def test_balanced_batches_hold_one_task_with_equal_labels():
    import collections
    import random
    from train_cpu import balanced_batches
    rows = [{"task_type": "lat", "oracle": {"answer": a}} for a in ["left"] * 20 + ["right"] * 12] + [{"task_type": "fb", "oracle": {"answer": "front"}}] * 5
    for b in balanced_batches(rows, 8, random.Random(0)):
        assert len({r["task_type"] for r in b}) == 1
        c = collections.Counter(r["oracle"]["answer"] for r in b)
        assert len(c) == 1 or len(set(c.values())) == 1
