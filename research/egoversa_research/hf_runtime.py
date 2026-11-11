"""Thin Hugging Face Transformers runtime shared by the teacher, the evaluator and the HTTP server.

A model here receives a list of PIL images and one prompt string. Nothing else can be passed in.
"""
from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any, Optional

ROOT = Path(__file__).resolve().parents[2]


def registry_entry(model_id: str) -> dict:
    models = json.loads((ROOT / "research" / "configs" / "models.json").read_text())["models"]
    for m in models:
        if m["id"] == model_id:
            return m
    raise SystemExit(f"unknown model id {model_id!r}; see research/configs/models.json")


class HFVisionModel:
    def __init__(self, hf_id: str, adapter: Optional[Path] = None, device: Optional[str] = None, revision: Optional[str] = None):
        import torch
        from transformers import AutoModelForMultimodalLM, AutoProcessor

        self.torch = torch
        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        self.dtype = torch.bfloat16 if self.device == "cuda" else torch.float32
        self.processor = AutoProcessor.from_pretrained(hf_id, revision=revision)
        self.model = AutoModelForMultimodalLM.from_pretrained(hf_id, revision=revision, dtype=self.dtype).to(self.device)
        self.revision = getattr(self.model.config, "_commit_hash", None) or revision
        self.adapter = str(adapter) if adapter else None
        if adapter:
            from peft import PeftModel

            self.model = PeftModel.from_pretrained(self.model, str(adapter))
        self.model.eval()
        self.hf_id = hf_id

    def ask(self, images: list[Any], prompt: str, max_new_tokens: int = 12) -> dict:
        """Greedy decoding with thinking disabled, as both model cards recommend for direct answers."""
        messages = [{"role": "user", "content": [*({"type": "image", "image": im} for im in images), {"type": "text", "text": prompt}]}]
        inp = self.processor.apply_chat_template(messages, add_generation_prompt=True, tokenize=True, return_dict=True, return_tensors="pt", enable_thinking=False).to(self.device)
        t0 = time.perf_counter()
        with self.torch.no_grad():
            out = self.model.generate(**inp, max_new_tokens=max_new_tokens, do_sample=False)
        n_in = inp["input_ids"].shape[1]
        return {
            "raw": self.processor.tokenizer.decode(out[0][n_in:], skip_special_tokens=True),
            "latency_ms": round(1000 * (time.perf_counter() - t0)),
            "prompt_tokens": int(n_in),
            "output_tokens": int(out.shape[1] - n_in),
        }
