# Research and sources

Verified on 11 November 2026 against the primary sources linked below. "Verified" means read on the
model card, repository or project page on that date, or measured on this machine. Anything marked
*author-reported* is quoted from the source and was not reproduced here.

## Checkpoints

| | Qwen3.5-0.8B (student) | SpatialAxiom-9B (teacher) | MiniCPM-V 4.7 1B (optional) |
|---|---|---|---|
| Hub id | `Qwen/Qwen3.5-0.8B` | `SpatialAxiom/SpatialAxiom-9B` | `openbmb/MiniCPM-V-4.7-1B` |
| Revision used | `2fc06364715b967f1860aea9cf38778875588b17` | not downloaded | not downloaded |
| Parameters (total, Hub metadata) | 873.4 M | 9,409.8 M | 1,554.5 M |
| Licence | Apache 2.0 | **CC BY-NC 4.0** | Apache 2.0 |
| Architecture | `qwen3_5`: 24 layers, hidden 1024, hybrid Gated DeltaNet + gated attention, vision encoder | `qwen3_5` (fine-tuned from Qwen3.5-9B, architecture unchanged) | `minicpmv4_7`, Qwen3.5-family text backbone, separate vision subsystem |
| Weights on disk | 1.75 GB (BF16 safetensors) | 18.8 GB (4 shards) | n/a |
| Thinking mode | off by default | must be off (`enable_thinking=False`) | n/a |
| Class | `AutoModelForMultimodalLM` | `AutoModelForMultimodalLM` | `AutoModelForMultimodalLM` |

**Naming.** The student is "EgoVersa-Spatial-1B" for the project, but the checkpoint has 0.87 B
parameters. It is described everywhere as *1B-class*, never as a 1.0 B model. MiniCPM-V 4.7 "1B" has
1.55 B parameters in total and is labelled that way; it is never swapped in as the default student.

**Local runtimes, measured.**
- `ollama pull qwen3.5:0.8b` gives a Q8_0 GGUF of 1.32 GB: 752 M language-model parameters plus a
  100.6 M-parameter CLIP-style vision projector. Image input works.
- `ollama pull hf.co/unsloth/Qwen3.5-0.8B-GGUF:Q4_K_M` gives a 0.74 GB Q4_K_M GGUF of the same base
  model, also with the projector.
- PyTorch wheels for Intel macOS on PyPI stop at 2.2.2, and Transformers 5 requires PyTorch ≥ 2.6.
  conda-forge publishes `pytorch 2.14.1` for `osx-64` (MKL build). The research environment uses it.
  `research/environment.yml` reproduces it.

## SpatialAxiom: what is and is not public

| Item | Status |
|---|---|
| 9B and 35B-A3B weights | public on Hugging Face, CC BY-NC 4.0 |
| GitHub `D2I-ai/SpatialAxiom` | README and docs assets only; no training, data-generation or evaluation code |
| Hugging Face datasets under `SpatialAxiom` | none |
| Training data | described only as "indoor scenes, egocentric views, multi-camera settings" with data synthesis; no names, sizes or sources |
| Training method | full-parameter SFT on Qwen3.5-9B (model card) |
| Benchmark table | author-reported (below) |

Author-reported results for SpatialAxiom-9B: average 70.6; VSI-Bench 70.2, MMSI-Bench 51.8,
MindCube 92.5, ViewSpatial 70.6, SITE 53.3, BLINK 76.9, 3DSRBench 64.2, EmbSpatial 85.1. For context
the same table lists Qwen3.5-9B at 55.9 average. None of these numbers were reproduced here.

The SpatialAxiom recipe cannot be reproduced from its release. EgoVersa therefore follows the
user-approved route: generate its own geometrically labelled data and treat the teacher only as an
optional, verified source of extra supervision.

## SpatialMosaic (Lee et al., arXiv 2512.23365)

Read: project page, `Kanghee-Lee/SpatialMosaic-project`, `jmkey/spatial_mosaic_vqa`.

- **Problem.** Multi-view spatial reasoning under partial visibility, occlusion and low view overlap.
- **Claimed scale.** About 2 M training QA pairs and a 1 M-QA benchmark over 11 tasks, built from
  ScanNet++ (indoor) and Waymo (outdoor).
- **Construction.** Per-instance and full-scene depth renders give an object occlusion ratio (hidden
  by other objects) and a field-of-view occlusion ratio (truncated by the image border). Sparse views
  are then sampled under visibility constraints and QA pairs are filled from templates.
- **Baseline model.** LLaVA-NeXT-Video-7B (Qwen2) with a VGGT geometry encoder, trained on 2 GPUs
  with the repository's scripts.
- **Public data.** Only a "tiny" annotation release of 2.2 K test rows (1.1 K indoor, 1.1 K
  outdoor), CC BY-NC 4.0. It contains no images; frames must be obtained from ScanNet++ and Waymo
  under their own licence agreements.

What EgoVersa takes from it:
1. The distinction between being hidden by another object and being cut off by the frame. EgoVersa's
   oracle already separates `inFrameFraction` from `visibleFraction`; out-of-frame is never labelled
   "occluded".
2. Best-view selection: the `mv_best_view` task asks which of two views shows more of an object.
3. Multi-view evidence: the `mv_camera_motion` task asks which way the camera moved between two views.
4. Accuracy broken down by occlusion level, used in the dashboards.

What is not used:
- **Their data for training.** The public part is test-only and non-commercial, the full training set
  is not released, and the source images need separate licences.
- **Their VGGT/LLaVA training code.** It targets a 7B model on multiple GPUs. This work fine-tunes a
  0.8B Qwen3.5 student through its own processor.

## Perspective taking: the KAIST Visual AI Group work this targets

- **Lee et al., *Perspective-Aware Reasoning in VLMs via Mental Imagery Simulation*, ICCV 2025.**
  Questions are asked from the viewpoint of an object or person in the scene. Accuracy is analysed
  against the angular offset θ between the camera and that reference viewer, and baselines collapse
  as θ grows (author-reported: Qwen2.5-VL at 43.3% on COMFORT++ left/right). EgoVersa implements
  observer-frame questions with oriented agents and reports accuracy by θ in 30° bins, in the
  Benchmark and Models workspaces. It does not implement their APC method.
- **Lee, Park et al., *Token Warping Helps MLLMs Look from Nearby Viewpoints*, CVPR 2026.** Motivates
  the two-view tasks. Not implemented.

## Fine-tuning library

The training loop is plain PyTorch + Transformers 5 + PEFT, not Unsloth:
- Unsloth needs CUDA. This machine has an AMD Radeon Pro 5500M and an Intel CPU.
- A plain loop lets the same script run its smoke test on CPU here and its real run on any CUDA box.

Unsloth's guide still shaped the decisions:
- Qwen3.5 vision LoRA is supported down to 0.8B. Their figure is about 3 GB of VRAM for 0.8B BF16
  LoRA; that is not measured here.
- **4-bit QLoRA training is not recommended for Qwen3.5** because of larger-than-usual quantisation
  differences. EgoVersa trains in BF16 (CUDA) or FP32 (CPU) and quantises only after training.
- Transformers v5 is required.
- Inference must use the chat template the model was trained with. The trainer verifies that the
  prompt encoding is a byte prefix of the training encoding.

## Hardware and measured costs on this machine

Machine: Intel Core i9-9880H (8 cores, 16 threads), 16 GB RAM, macOS 26, no CUDA.

| Operation | Measured |
|---|---|
| Ollama inference, Q8_0, one 512×384 image + question | warm mean 3.29 s, p95 4.98 s, ~275 prompt tokens |
| Same, Q4_K_M | warm mean 2.25 s, p95 3.60 s |
| Rendering + labelling the pilot dataset (7,000 samples, 852 images) | 63 s |
| LoRA smoke training, FP32 CPU, 4 optimiser steps (8 examples) | 318 s wall, peak RSS 7.3 GB |
| Image tokens per 512×384 image (Qwen3.5 processor) | 192 |

Extrapolating the smoke run (not measured): a full `A_geometry` run (about 10,800 example passes) is
on the order of 2–3 days on this CPU. It is meant for a CUDA GPU.

## Related benchmarks and allowed use

Never train on any of these; evaluate only where their terms allow.

| Benchmark | Note |
|---|---|
| SpatialMosaic-Bench tiny | CC BY-NC 4.0, images from ScanNet++ / Waymo under their own licences |
| MindCube, ViewSpatial, VSI-Bench, MMSI-Bench, SITE, BLINK, 3DSRBench, EmbSpatial | used in SpatialAxiom's table; licences differ per benchmark and were not reviewed one by one; none was run here |
| COMFORT++ (APC paper) | synthetic perspective-taking protocol; not run here |

## Reproducible today vs. needs more

| Works on this machine now | Needs a GPU, other assets or permission |
|---|---|
| Scenes, oracle, 10 task types, dataset rendering and locking | Full LoRA runs A, D, A_vision (CUDA GPU) |
| Real inference of base Qwen3.5-0.8B (Q8_0, Q4_K_M) in the app and in batch | SpatialAxiom-9B inference and teacher collection (~19 GB of weights, a large GPU) |
| Evaluation, dashboards, sample explorer | Runs B and C (need teacher outputs; non-commercial only) |
| LoRA smoke training on CPU (verified end to end) | GGUF export of a trained student (llama.cpp with `qwen35` support) |
| Validation, leakage and track tests | Independent benchmarks (download and licence review per benchmark) |
