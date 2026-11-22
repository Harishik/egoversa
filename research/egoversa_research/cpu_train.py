"""CPU-first training for the EgoVersa-Spatial-1B student.

Two ideas make post-training of a 0.8B vision-language model practical on a laptop CPU, with no loss of
function:

1. Frozen-trunk activation caching.
   With LoRA on the top layers only, the vision tower and the bottom K decoder layers are frozen. Their output
   for a given (image, prompt) never changes during training, so it is computed ONCE (one no-grad forward) and
   stored: the hidden state entering layer K plus the rotary position embeddings and masks that layer receives.
   Every training step then runs only layers K..L-1, the final norm and the output head, at a fraction of the
   cost, and never touches the vision tower again. `verify_trunk_cut` checks that resuming from the cache
   reproduces the full model's logits.

2. Exact-expectation policy optimisation (EPO) over finite answer sets.
   Answers are one word from a small admissible set A (e.g. left / right / unknown). The first generated token
   decides the answer, so the policy over answers is exactly p(a) = softmax(logits)[token(a)] at the answer
   position, plus an "other" bucket for anything outside A. The expected reward
        J = sum_a p(a) r(a) + p_other r_other
   and its gradient are computed in closed form from ONE forward pass: no sampling, no group of rollouts, zero
   gradient variance. This is the quantity GRPO estimates by sampling G completions; here it is exact.
   The KL penalty to the frozen reference policy is also exact over A (reference probabilities are cached), and
   the label-free cross-view consistency term becomes the agreement probability sum_a p_view1(a) p_view2(a).

Rewards come from the MuJoCo verifier's labels (see train_grpo.reward for the same reward definitions).
"""
from __future__ import annotations

import json
import math
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

import torch

ANSWER_WORDS = ["left", "right", "unknown", "yes", "no", "front", "behind", "toward", "away", "visible", "occluded",
                "closer", "farther", "above", "below", "first", "second"]


def text_model(model: Any):
    """The Qwen3.5 text decoder inside a (possibly PEFT-wrapped) multimodal model."""
    m = model
    for attr in ("base_model", "model"):
        while hasattr(m, attr) and not hasattr(m, "language_model"):
            m = getattr(m, attr)
    return m.language_model


def lm_head(model: Any):
    m = model
    while not hasattr(m, "lm_head"):
        m = m.base_model if hasattr(m, "base_model") else m.model
    return m.lm_head


def answer_token_ids(tokenizer, words=ANSWER_WORDS) -> dict[str, list[int]]:
    """First token(s) of each answer word as the assistant may begin its reply: "left", "Left", " left".

    The reply's first token decides the answer whenever the first tokens of the admissible options differ, which
    `check_options_separable` verifies per option set."""
    ids = {}
    for w in words:
        variants = {w, w.capitalize(), " " + w, " " + w.capitalize()}
        ids[w] = sorted({tokenizer.encode(v, add_special_tokens=False)[0] for v in variants})
    return ids


def check_options_separable(options: list[str], tok: dict[str, list[int]]) -> bool:
    seen: set[int] = set()
    for o in options:
        if seen & set(tok[o]):
            return False
        seen |= set(tok[o])
    return True


@dataclass
class TrunkCache:
    hidden: torch.Tensor  # [1, T, H] input to layer K (float16 on disk)
    cos: torch.Tensor
    sin: torch.Tensor
    position_ids: Optional[torch.Tensor]
    masks: dict  # layer type -> mask or None
    ref_logp: torch.Tensor  # reference log-probs of the answer tokens at the answer position (frozen base)
    ref_other: float


def capture_trunk(model, inputs: dict, k: int) -> TrunkCache:
    """One frozen forward; record exactly what decoder layer k receives, plus the reference answer distribution."""
    tm = text_model(model)
    captured: dict = {}

    def pre_hook(_mod, args, kwargs):
        captured["hidden"] = (args[0] if args else kwargs["hidden_states"]).detach()
        pe = kwargs["position_embeddings"]
        captured["cos"], captured["sin"] = pe[0].detach(), pe[1].detach()
        captured["position_ids"] = kwargs.get("position_ids")
        captured["mask"] = kwargs.get("attention_mask")

    handles = [tm.layers[k].register_forward_pre_hook(pre_hook, with_kwargs=True)]
    masks: dict = {}
    for i, layer in enumerate(tm.layers):
        if i >= k:
            handles.append(layer.register_forward_pre_hook(
                (lambda idx: (lambda _m, a, kw: masks.setdefault(tm.config.layer_types[idx], kw.get("attention_mask"))))(i), with_kwargs=True))
    try:
        with torch.no_grad():
            out = model(**inputs)
    finally:
        for h in handles:
            h.remove()
    logits = out.logits[0, -1].float()
    return TrunkCache(captured["hidden"], captured["cos"], captured["sin"], captured["position_ids"], masks,
                      torch.log_softmax(logits, -1), 0.0)


def top_forward(tm, head, cache: TrunkCache, k: int) -> torch.Tensor:
    """Run decoder layers k..L-1, the final norm and the output head from a trunk cache; logits at the last position.

    `tm` and `head` are the text decoder and output head (take them with text_model / lm_head before wrapping the
    model with LoRA: injection replaces Linear submodules in place, so the references stay valid)."""
    h = cache.hidden.to(next(tm.parameters()).dtype)
    pe = (cache.cos.to(h.dtype), cache.sin.to(h.dtype))
    for i in range(k, len(tm.layers)):
        h = tm.layers[i](h, position_embeddings=pe, attention_mask=cache.masks.get(tm.config.layer_types[i]), position_ids=cache.position_ids)
    h = tm.norm(h[:, -1:])
    return head(h)[0, -1].float()


def answer_distribution(logits: torch.Tensor, options: list[str], tok: dict[str, int]) -> tuple[torch.Tensor, torch.Tensor]:
    """(p over options, p_other) from full-vocabulary logits at the answer position."""
    p = torch.softmax(logits, -1)
    pa = torch.stack([p[tok[o]].sum() for o in options])
    return pa, (1 - pa.sum()).clamp_min(0)


def rewards_for(options: list[str], gold: str, answerable: bool) -> list[float]:
    """Same reward definition as SV-GRPO: correct answer 1 (+0.1 format), abstention calibration penalties."""
    r = []
    for o in options:
        v = (1.0 if o == gold else 0.0) + 0.1
        if gold == "unknown" and o != "unknown":
            v -= 0.5
        elif gold != "unknown" and o == "unknown":
            v -= 0.25
        r.append(v)
    return r


def epo_loss(logits, options, gold, answerable, tok, ref_logp, kl_coef: float, ce_coef: float, r_other: float = -0.1, rl_coef: float = 1.0):
    pa, p_other = answer_distribution(logits, options, tok)
    r = torch.tensor(rewards_for(options, gold, answerable), dtype=pa.dtype)
    expected = (pa * r).sum() + p_other * r_other
    # exact KL(pi || pi_ref) over the answer simplex (options + other)
    pr = torch.softmax(ref_logp.to(logits.dtype), -1)
    qr = torch.stack([pr[tok[o]].sum() for o in options])
    q = torch.cat([pa, p_other.view(1)]) + 1e-8
    qr = torch.cat([qr, (1 - qr.sum()).clamp_min(0).view(1)]) + 1e-8
    kl = (q * (q.log() - qr.log())).sum()
    ce = -torch.log(pa[options.index(gold)] + 1e-8)
    loss = -rl_coef * expected + kl_coef * kl + ce_coef * ce
    return loss, {"expected_reward": expected.item(), "p_gold": pa[options.index(gold)].item(), "p_other": p_other.item(), "kl": kl.item()}


def consistency_loss(logits_a, logits_b, options, tok) -> torch.Tensor:
    """Label-free: maximise the probability that two views of the same question get the same answer."""
    pa, _ = answer_distribution(logits_a, options, tok)
    pb, _ = answer_distribution(logits_b, options, tok)
    return -(pa * pb).sum()


def save_cache(path: Path, c: TrunkCache) -> None:
    torch.save({"hidden": c.hidden.half(), "cos": c.cos.half(), "sin": c.sin.half(), "position_ids": c.position_ids,
                "masks": c.masks, "ref_logp": c.ref_logp.half()}, path)


def load_cache(path: Path) -> TrunkCache:
    d = torch.load(path, weights_only=False)
    return TrunkCache(d["hidden"].float(), d["cos"].float(), d["sin"].float(), d["position_ids"], d["masks"], d["ref_logp"].float(), 0.0)
