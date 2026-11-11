"""Answer normalisation. A 1:1 mirror of src/evaluation/parse.ts.

Both implementations are tested against tests/fixtures/parse_cases.json; change them together.
A reply counts only if it names exactly one admissible option; anything else is None (scored wrong).
"""
from __future__ import annotations

import re
from typing import Optional, Sequence

UNKNOWN = "unknown"

_UNKNOWN_PATTERNS = [
    re.compile(r"\bunknown\b"),
    re.compile(r"\bcan(?:not|'t|’t| not) (?:be )?(?:tell|determined?|say|see|know)\b"),
    re.compile(r"\bnot (?:enough|sufficient) information\b"),
    re.compile(r"\bimpossible to (?:tell|say|determine|know)\b"),
    re.compile(r"\bunclear\b"),
    re.compile(r"\bnot visible\b"),
]

_SYNONYMS = {
    "front": [re.compile(r"\bin front\b"), re.compile(r"\bfront\b")],
    "behind": [re.compile(r"\bbehind\b"), re.compile(r"\bback\b")],
    "toward": [re.compile(r"\btowards?\b")],
    "away": [re.compile(r"\baway\b")],
    "first": [re.compile(r"\bfirst\b"), re.compile(r"\bimage 1\b"), re.compile(r"\b1st\b")],
    "second": [re.compile(r"\bsecond\b"), re.compile(r"\bimage 2\b"), re.compile(r"\b2nd\b")],
    "closer": [re.compile(r"\bcloser\b"), re.compile(r"\bnearer\b")],
    "farther": [re.compile(r"\bfarther\b"), re.compile(r"\bfurther\b")],
}


def strip_reasoning(raw: str) -> str:
    raw = re.sub(r"<think>[\s\S]*?</think>", " ", raw, flags=re.IGNORECASE)
    raw = re.sub(r"<\|[^|>]*\|>", " ", raw)
    return raw.strip()


def normalize_answer(raw: str, options: Sequence[str]) -> Optional[str]:
    text = strip_reasoning(raw).lower()
    if not text:
        return None
    hits = set()
    for opt in options:
        if opt == UNKNOWN:
            if any(p.search(text) for p in _UNKNOWN_PATTERNS):
                hits.add(opt)
            continue
        pats = _SYNONYMS.get(opt) or [re.compile(r"(?<!not )\b" + re.escape(opt) + r"\b")]
        if any(p.search(text) for p in pats):
            hits.add(opt)
    if UNKNOWN in hits:
        return UNKNOWN
    return next(iter(hits)) if len(hits) == 1 else None
