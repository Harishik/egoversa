# Model card (draft): EgoVersa-Spatial-1B

> **Status: one trained adapter exists** (`research/runs/cpu_epo_v05_k6/adapter`, 29 MB, not committed; rebuild
> it with the command in README). It was trained on CPU on the MuJoCo pilot. The results below are measured.

| | |
|---|---|
| Name | EgoVersa-Spatial-1B (`egoversa-spatial-1b-<run>-<version>`) |
| Underlying checkpoint | `Qwen/Qwen3.5-0.8B` @ `2fc06364715b967f1860aea9cf38778875588b17`, 873.4 M parameters (a 1B-class model, not 1.0 B) |
| Method | LoRA (r 16, α 16) on the language-model linear layers. Vision tower frozen by default, adapted in the `A_geometry_vision` ablation. Trained through the model's own processor with image input, loss on answer tokens only |
| Training data | EgoVersa procedural spatial VQA (docs/DATASET_CARD.md). Track P: oracle labels only |
| Licence | base Apache 2.0. A track-P adapter can follow it. Track-R variants are non-commercial (docs/LICENSE_AND_PROVENANCE.md) |
| Intended use | Research on viewpoint and perspective reasoning in small VLMs; a compact diagnostic model for synthetic scenes |
| Out of scope | Safety-relevant spatial decisions (robots, driving, accessibility); claims about real-world spatial ability |

## Base model on the EgoVersa locked test set (measured)

1,163 items (test_iid + test_ood), greedy decoding, thinking off. Ollama on an Intel i9-9880H CPU.

| Variant | Accuracy [95% CI] | Weights | Warm latency (mean / p95) |
|---|---|---|---|
| Qwen3.5-0.8B Q8_0 | 52.2% [49.3, 55.1] | 1.32 GB | 3.29 s / 4.98 s |
| Qwen3.5-0.8B Q4_K_M | 48.8% [46.0, 51.7] | 0.74 GB | 2.25 s / 3.60 s |

Per-task results and the answer-collapse analysis are in EXPERIMENTS.md E4.

## Fine-tuned student (measured)

Run `cpu_epo_v05_k6`: LoRA r = 16 (α 32) on decoder layers 6–23, 7.65 M trainable parameters. Trained on CPU from
frozen-trunk caches with the hybrid objective (supervised ×0.3, exact expected reward ×1, KL ×0.02,
consistency ×0.2). 1,941 task-balanced items from egoversa-sim-pilot v0.5.0, 2 epochs, lr 1e-4,
images ≤ 384 px. Summary: `research/results/cpu_training_summary.json`.

| Split | n | majority | base | EgoVersa-Spatial | McNemar p |
|---|---|---|---|---|---|
| test_iid | 724 | 55.0% | 57.7% | **66.3%** | 0.0004 |
| test_ood (4 held-out objects) | 573 | 53.2% | 53.1% | **63.9%** | 0.00002 |

The ablation shows the gain comes from the supervised term; the RL term on its own collapses (EXPERIMENTS.md
E6). Robot-frame relations without the robot's view, and abstention, did not improve.

## Known risks

- **Capacity.** 0.8B may be too small for two-view reasoning; the base model is at chance there.
- **Synthetic-to-real shift.** Training on primitive scenes may not transfer to photographs.
- **Teacher error propagation** (track R). Mitigated by oracle verification, measured by run B.
- **Shortcut learning.** Template, lighting or object-style cues; measured on test_ood.
- **Quantisation loss.** On the base model, 4-bit changed 33% of individual answers and cost 3.4
  points (McNemar χ² = 3.93), so post-quantisation evaluation is mandatory.
