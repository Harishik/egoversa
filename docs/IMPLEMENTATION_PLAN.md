# Implementation plan and status (v0.2)

v0.1 was kept intact: scene lab, arena, geometry benchmark, exports and tests. v0.2 extends it.

| Milestone | Status | Where |
|---|---|---|
| 1. Source audit, model registry, licence tracks, schemas | done | docs/RESEARCH_AND_SOURCES.md, research/configs/models.json |
| 2. Observer-frame and facing relations, oriented agents, held-out object types | done | src/tasks/generator.ts, src/scenes/catalog.ts, generate.ts |
| 2b. Two-view tasks, abstention, paraphrase families | done | src/tasks/dataset.ts |
| 3. Dataset builder with real renders, locked holdout, validator | done | scripts/build-dataset.ts, research/scripts/validate_dataset.py |
| 3b. Model server with real inference and availability probing | done | server/model-server.mjs |
| 3c. Batch evaluation (Ollama / GGUF and Transformers / adapters) | done, base model evaluated | scripts/eval-models.ts, research/scripts/evaluate_models.py |
| 3d. UI: model picker in the arena, Models workspace, perspective chart | done | src/components/workspaces/{QuestionArena,Models,Benchmark}.tsx |
| 4. LoRA training with image-aware collator, loss masking, guards, resume | done; CPU smoke run verified | research/scripts/train_student.py, research/egoversa_research/sft.py |
| 4b. Teacher collection and verification, hard-example mining | implemented, dry-run tested; teacher not run (no GPU) | research/scripts/run_teacher.py, mine_hard_examples.py |
| 5. Quantisation: base model Q8_0 vs Q4_K_M | measured | EXPERIMENTS.md E4 |
| 5b. Export of a fine-tuned student to GGUF | implemented, not executed (no trained adapter yet) | research/scripts/quantize_model.py |
| 6. Tests, build, browser smoke test, screenshots, docs | done | see README "Verification" |

## Decisions

- **Two runtimes.** Ollama (GGUF, llama.cpp) for fast CPU inference and quantisation, and Transformers
  + PEFT for training and adapter evaluation. Both write the same result format, so they appear side by
  side in the dashboard.
- **Rendering for datasets goes through the app.** Training images are pixel-identical in kind to what
  the user sees, with no second renderer to keep in sync.
- **The UI never computes model answers.** It only displays real result files or live server replies.
- **Plain PyTorch training loop instead of Unsloth.** It runs on CPU for verification here and on CUDA
  for real runs.

## v0.3: EgoVersa-Sim (MuJoCo)

| Milestone | Status | Where |
|---|---|---|
| MuJoCo on Intel macOS (conda-forge 3.16) with offscreen CGL rendering | done | research/environment.yml |
| Seeded physical scenes with stacking, settling, robots and head cameras | done | research/egoversa_sim/scene.py |
| Exact verifier: segmentation visibility, frames, contact-force support, removal rollouts | done, tested | research/egoversa_sim/oracle.py, research/tests/test_sim.py |
| 14 task types including support, counterfactual and the paired imagery condition | done | research/egoversa_sim/questions.py |
| Dataset builder in the shared format with a locked holdout | done | research/scripts/build_sim_dataset.py |
| SV-GRPO trainer (answer, abstention, process, consistency rewards) | done; CPU smoke run | research/scripts/train_grpo.py |
| Physics Lab playback workspace with recorded trajectories | done | src/components/workspaces/PhysicsLab.tsx, public/sim |
| Paired imagery analysis (exact McNemar) | done | research/scripts/analyze_results.py |
