#!/usr/bin/env python3
"""Post-training export of a fine-tuned student: merge LoRA -> GGUF (+ vision projector) -> quantise -> register in Ollama.

    python research/scripts/quantize_model.py --run research/runs/A_geometry --precisions f16 q8_0 q4_k_m --dry-run
    LLAMA_CPP_DIR=~/src/llama.cpp python research/scripts/quantize_model.py --run research/runs/A_geometry --precisions q8_0 q4_k_m

Steps (each prints the exact command it runs):
  1. merge the LoRA adapter into the base weights (peft merge_and_unload) and save a plain HF checkpoint;
  2. llama.cpp `convert_hf_to_gguf.py` twice: the language model, and `--mmproj` for the vision projector
     (a vision model without its projector file cannot see images);
  3. `llama-quantize` to each requested precision;
  4. write an Ollama Modelfile and `ollama create egoversa-spatial-1b:<precision>`;
  5. verification: one real image question through the new tag; the export is rejected if the reply is empty.

After that, measure accuracy / latency / memory with
    npm run eval:models -- --model egoversa-spatial-1b --dataset research/data/egoversa-pilot

Training is done at full precision; quantisation happens only here (4-bit QLoRA training is not used for
Qwen3.5, see docs/RESEARCH_AND_SOURCES.md).

Requirements: a llama.cpp checkout recent enough to know the `qwen35` architecture, built so that
`llama-quantize` exists, pointed to by LLAMA_CPP_DIR; and the Ollama CLI.
STATUS: steps 1-5 are implemented but have NOT been executed end to end in this repository, because no
fine-tuned adapter exists yet. Nothing here fabricates a quantised file.
"""
import argparse
import base64
import json
import os
import shutil
import subprocess
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PRECISIONS = {"f16": "F16", "q8_0": "Q8_0", "q4_k_m": "Q4_K_M"}


def run(cmd: list[str], dry: bool) -> None:
    print("  $ " + " ".join(str(c) for c in cmd))
    if not dry:
        subprocess.run([str(c) for c in cmd], check=True)  # argv list, never a shell string


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--run", type=Path, required=True, help="training run directory containing adapter-best/ and run_summary.json")
    ap.add_argument("--precisions", nargs="+", default=["q8_0", "q4_k_m"], choices=list(PRECISIONS))
    ap.add_argument("--tag", default="egoversa-spatial-1b")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    run_dir = a.run.resolve()
    summary_path = run_dir / "run_summary.json"
    adapter = run_dir / "adapter-best"
    llama = Path(os.environ.get("LLAMA_CPP_DIR", "")).expanduser() if os.environ.get("LLAMA_CPP_DIR") else None
    problems = []
    if not summary_path.exists() or not adapter.exists():
        problems.append(f"{run_dir} has no run_summary.json / adapter-best (train first: research/scripts/train_student.py)")
    if llama is None or not (llama / "convert_hf_to_gguf.py").exists():
        problems.append("LLAMA_CPP_DIR must point to a llama.cpp checkout (git clone https://github.com/ggml-org/llama.cpp && cmake -B build && cmake --build build -j)")
    if shutil.which("ollama") is None:
        problems.append("the `ollama` CLI is not on PATH")
    summary = json.loads(summary_path.read_text()) if summary_path.exists() else {"track": "?", "base_model": "Qwen/Qwen3.5-0.8B"}
    if summary.get("smoke"):
        problems.append("this is a smoke run (a few steps on a handful of examples); exporting it would produce a meaningless model")
    print(f"source run: {run_dir}\ntrack: {summary.get('track')}  base: {summary.get('base_model')}")
    if summary.get("track") == "research-nc":
        print("NOTICE: this adapter was trained with CC BY-NC teacher-derived supervision. The exported model is for non-commercial research only.")
    if problems and not a.dry_run:
        for p in problems:
            print("BLOCKED:", p)
        return 1
    for p in problems:
        print("would be blocked:", p)

    merged = run_dir / "merged"
    gguf = run_dir / "gguf"
    quant_bin = (llama / "build" / "bin" / "llama-quantize") if llama else Path("llama-quantize")
    conv = (llama / "convert_hf_to_gguf.py") if llama else Path("convert_hf_to_gguf.py")
    print("1. merge adapter")
    if not a.dry_run:
        import torch
        from peft import PeftModel
        from transformers import AutoModelForMultimodalLM, AutoProcessor

        base = AutoModelForMultimodalLM.from_pretrained(summary["base_model"], dtype=torch.float16)
        PeftModel.from_pretrained(base, str(adapter)).merge_and_unload().save_pretrained(merged)
        AutoProcessor.from_pretrained(summary["base_model"]).save_pretrained(merged)
    print("2. convert to GGUF (language model + vision projector)")
    run([sys.executable, conv, merged, "--outfile", gguf / "model-f16.gguf", "--outtype", "f16"], a.dry_run)
    run([sys.executable, conv, merged, "--mmproj", "--outfile", gguf / "mmproj-f16.gguf"], a.dry_run)
    print("3. quantise + 4. register")
    exported = []
    for p in a.precisions:
        f = gguf / f"model-{p}.gguf"
        if p != "f16":
            run([quant_bin, gguf / "model-f16.gguf", f, PRECISIONS[p]], a.dry_run)
        modelfile = gguf / f"Modelfile.{p}"
        text = f"FROM ./{f.name}\nFROM ./mmproj-f16.gguf\nPARAMETER temperature 0\n"
        print(f"  write {modelfile.name}")
        if not a.dry_run:
            modelfile.write_text(text)
        tag = f"{a.tag}:{p}"
        run(["ollama", "create", tag, "-f", modelfile], a.dry_run)
        exported.append({"precision": p, "tag": tag, "file": str(f.relative_to(ROOT)) if f.is_relative_to(ROOT) else str(f)})
    print("5. verify each tag with one real image question")
    if not a.dry_run:
        img = next((ROOT / "research" / "data").glob("*/images/val/*.png"))
        for e in exported:
            body = {"model": e["tag"], "stream": False, "think": False, "messages": [{"role": "user", "content": "Name one object in the image.", "images": [base64.b64encode(img.read_bytes()).decode()]}], "options": {"temperature": 0, "num_predict": 12}}
            rep = json.load(urllib.request.urlopen(urllib.request.Request("http://127.0.0.1:11434/api/chat", json.dumps(body).encode(), {"Content-Type": "application/json"}), timeout=300))
            e["verification_reply"] = rep["message"]["content"]
            e["size_bytes"] = (ROOT / e["file"]).stat().st_size if (ROOT / e["file"]).exists() else None
            if not e["verification_reply"].strip():
                raise SystemExit(f"{e['tag']}: empty reply to an image question; the export is not usable")
        (run_dir / "export_manifest.json").write_text(json.dumps({"source_run": summary.get("name"), "track": summary.get("track"), "base_model": summary.get("base_model"), "exports": exported}, indent=2))
        print(f"exported: {[e['tag'] for e in exported]}. To make one the app's fine-tuned student: ollama cp {exported[-1]['tag']} {a.tag}")
    else:
        print("dry run: no file was created.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
