"""Supervised fine-tuning data for a Qwen3.5 vision-language student.

Design points (see docs/RESEARCH_PLAN.md):
  * Every example goes through the model's own processor and chat template with the IMAGE attached, so the
    vision tower and projector take part in the forward pass. There is no text-only shortcut.
  * Loss masking: only the assistant's answer tokens (and the end-of-turn token) carry labels. The system /
    user turn, the image placeholder tokens and padding are set to -100.
  * `enable_thinking=False` is passed to the chat template for both the prefix and the full sequence, so the
    prompt the student is trained on is byte-identical to the prompt it sees at inference.

This module imports torch / PIL lazily so that dataset tooling works without them.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

IGNORE = -100


def to_chat(messages: list[dict], dataset_dir: Path, with_answer: bool) -> list[dict]:
    """Convert a stored SFT record into processor messages with PIL images."""
    from PIL import Image

    out = []
    for m in messages:
        if m["role"] == "assistant" and not with_answer:
            continue
        content = []
        for c in m["content"]:
            if c["type"] == "image":
                content.append({"type": "image", "image": Image.open(dataset_dir / c["path"]).convert("RGB")})
            else:
                content.append({"type": "text", "text": c["text"]})
        out.append({"role": m["role"], "content": content})
    return out


def encode_example(processor: Any, record: dict, dataset_dir: Path) -> dict:
    """Tokenise one example and build its label mask. Returns tensors with a leading batch dim of 1."""
    kw = dict(tokenize=True, return_dict=True, return_tensors="pt", enable_thinking=False)
    prefix = processor.apply_chat_template(to_chat(record["messages"], dataset_dir, False), add_generation_prompt=True, **kw)
    full = processor.apply_chat_template(to_chat(record["messages"], dataset_dir, True), add_generation_prompt=False, **kw)
    ids = full["input_ids"][0]
    n = prefix["input_ids"].shape[1]
    if n >= ids.shape[0] or not bool((ids[:n] == prefix["input_ids"][0]).all()):
        raise ValueError(
            f"{record.get('sample_id')}: the prompt-only encoding is not a prefix of the full encoding; "
            "the chat template changed between training and inference formats."
        )
    labels = ids.clone()
    labels[:n] = IGNORE
    full["labels"] = labels.unsqueeze(0)
    full["n_prefix"] = n
    full["n_image_tokens"] = int((ids == _image_token_id(processor)).sum()) if _image_token_id(processor) is not None else -1
    return full


def _image_token_id(processor: Any):
    tok = processor.tokenizer
    for name in ("<|image_pad|>", "<image>", "<|vision_pad|>"):
        i = tok.convert_tokens_to_ids(name)
        if isinstance(i, int) and i >= 0 and i != tok.unk_token_id:
            return i
    return getattr(processor, "image_token_id", None)


def collate(examples: list[dict], pad_token_id: int) -> dict:
    """Right-pad text tensors; concatenate vision tensors along dim 0 (Qwen-VL processors emit flat patch lists)."""
    import torch

    text_keys = ("input_ids", "attention_mask", "labels")
    L = max(e["input_ids"].shape[1] for e in examples)
    batch: dict[str, Any] = {}
    for k in text_keys:
        fill = pad_token_id if k == "input_ids" else (0 if k == "attention_mask" else IGNORE)
        rows = []
        for e in examples:
            t = e[k][0]
            rows.append(torch.cat([t, torch.full((L - t.shape[0],), fill, dtype=t.dtype)]))
        batch[k] = torch.stack(rows)
    for k, v in examples[0].items():
        if k in text_keys or not hasattr(v, "shape"):
            continue
        batch[k] = torch.cat([e[k] for e in examples], dim=0)
    return batch


def lora_targets(model: Any, finetune_vision: bool, finetune_language: bool = True) -> tuple[list[str], dict]:
    """Pick LoRA target modules by inspecting the loaded model rather than assuming layer names.

    Returns fully-qualified names of nn.Linear layers in attention / MLP blocks of the language model and,
    optionally, of the vision tower. The multimodal projector is left frozen unless vision is enabled.
    """
    import torch.nn as nn

    vision_markers = ("visual", "vision", "vit", "image_encoder", "merger", "projector", "mm_proj")
    lang, vis = [], []
    for name, mod in model.named_modules():
        if not isinstance(mod, nn.Linear):
            continue
        if name.endswith("lm_head") or ".lm_head" in name or "embed" in name.split(".")[-1]:
            continue
        (vis if any(m in name.lower() for m in vision_markers) else lang).append(name)
    chosen = (lang if finetune_language else []) + (vis if finetune_vision else [])
    return chosen, {"language_linear": len(lang), "vision_linear": len(vis), "targeted": len(chosen)}
