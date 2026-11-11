# Reproducibility

Every command below was run on an Intel i9-9880H MacBook (16 GB RAM, macOS 26, no CUDA) unless marked
**GPU**.

## 1. Environments

```bash
npm install
```

```bash
conda env create -p research/.conda -f research/environment.yml
```

- The conda environment provides PyTorch 2.14.1 for Intel macOS from conda-forge. PyPI stops at
  2.2.2, which Transformers 5 cannot use.
- On Linux with CUDA, `pip install torch` plus `research/requirements.txt` works instead.
- Without any model, `python3 research/scripts/validate_dataset.py` and `pytest research/tests` run on
  the standard library plus pytest.

## 2. Models

```bash
ollama pull qwen3.5:0.8b
```

```bash
ollama pull hf.co/unsloth/Qwen3.5-0.8B-GGUF:Q4_K_M
```

```bash
research/.conda/bin/hf download Qwen/Qwen3.5-0.8B --revision 2fc06364715b967f1860aea9cf38778875588b17
```

## 3. Data (deterministic)

```bash
npm run dataset -- --config research/configs/dataset.smoke.json
```

```bash
npm run dataset -- --config research/configs/dataset.pilot.json
```

```bash
python3 research/scripts/validate_dataset.py research/data/egoversa-pilot
```

- The same config produces the same scene fingerprints, sample ids and oracle answers.
- PNG bytes may differ between GPU / driver / Chrome versions, because rendering is not bit-exact
  across machines. Image hashes are therefore recorded per sample, and the lock refuses any mismatch.
- To rebuild the holdout deliberately: `--relock`. Results on the old holdout are then not comparable.

## 4. Evaluation

```bash
npm run eval:models -- --dataset research/data/egoversa-pilot --split test_iid,test_ood --model qwen3.5-0.8b-base
```

```bash
npm run eval:models -- --dataset research/data/egoversa-pilot --split test_iid,test_ood --model qwen3.5-0.8b-base-q4
```

- Decoding: temperature 0, seed 7, max 12 new tokens, thinking off. Same image size and prompts for
  every model.
- Ollama on CPU is deterministic in practice, but this was not verified bit-for-bit across runs.

## 5. Training

```bash
research/.conda/bin/python research/scripts/train_student.py --config research/configs/experiments/smoke.yaml --smoke
```

```bash
research/.conda/bin/python research/scripts/train_student.py --config research/configs/experiments/A_geometry.yaml --dry-run
```

**GPU.** Run without `--dry-run`. Then:

```bash
python research/scripts/evaluate_models.py --model-id egoversa-spatial-1b --adapter research/runs/A_geometry/adapter-best --dataset research/data/egoversa-pilot --tag A_geometry
```

## 6. Teacher (research track, GPU)

```bash
python research/scripts/run_teacher.py --dataset research/data/egoversa-pilot --split train --rationales
```

## 7. Export

**GPU or CPU**, needs llama.cpp:

```bash
LLAMA_CPP_DIR=~/src/llama.cpp python research/scripts/quantize_model.py --run research/runs/A_geometry --precisions f16 q8_0 q4_k_m
```

## Seeds

| Thing | Seed |
|---|---|
| Scene | `xmur3(seed string) → mulberry32`, independent streams for geometry, agents, cameras, lighting and question selection |
| Dataset | `baseSeed` in the config. Per-scene seeds are `<baseSeed>/<split>/<env>/<index>` |
| Training | `train.seed` (default 3407): data order, LoRA init and dropout |
| Ollama decoding | seed 7, temperature 0 |
