# Research plan: EgoVersa-Spatial-1B

**Question.** Can a ~0.8B multimodal Qwen3.5 student, trained on geometry-verified examples and
optionally on verified SpatialAxiom-9B signals, approach or beat the 9B specialist on selected unseen
EgoVersa tasks, while keeping general visual utility at much lower inference cost?

This is a falsifiable hypothesis, not a promised outcome. A good result is a reproducible gain with a
clear accuracy / cost trade-off, whether or not the student passes the teacher.

## Starting point (measured, see EXPERIMENTS.md E4)

The untuned student scores **52.2%** [49.3, 55.1] on the 1,163-item locked test set. On most tasks it
repeats one answer:
- "front" on 135/135 front-behind questions;
- "right" on 72/72 camera-motion questions;
- it never says "unknown", so abstention recall is 0/68.

Only camera left/right (70.8%) and above/below (62.5%) are clearly above the majority-answer rate. So
there is a lot of room, and the first thing to check after training is whether the gains are real
reasoning or just a better-balanced guess. That check is the majority-answer column and the
"one-answer" flag in the Models workspace.

## Hypotheses

| | Hypothesis | Test | Supported if |
|---|---|---|---|
| H1 | Geometry-only SFT improves the base student | `A_geometry` vs `baseline_0` on test_iid | Overall gain with non-overlapping 95% CIs, and a gain on ≥ 6 of 10 tasks |
| H2 | Gains transfer beyond the training distribution | `A_geometry` on test_ood (new template family, lighting, camera range, held-out object types) | test_ood gain ≥ half of the test_iid gain |
| H3 | Observer-frame accuracy stops depending on θ | accuracy-by-θ curve, `A_geometry` vs `baseline_0` | Gap between θ ≤ 30° and θ ≥ 150° shrinks below 10 points |
| H4 | The student learns to abstain without over-abstaining | abstention recall vs over-abstention | Recall ≥ 0.6 with over-abstention ≤ 0.1 |
| H5 | Teacher supervision adds value beyond more data | `C_hybrid` vs `D_data_matched` (same number of extra examples) | C > D with McNemar p < 0.05 on paired items |
| H6 | Plain imitation propagates teacher errors | `B_teacher` vs `A_geometry`, split by teacher-verified vs teacher-wrong items | B is worse on items the teacher got wrong |
| H7 | Adapting the vision tower helps occlusion and observer tasks | `A_geometry_vision` vs `A_geometry` | Gain on visibility / obs_* tasks |
| H8 | 4-bit costs little | `E_quantized` Q4_K_M vs F16 of the same adapter | Δ accuracy within 2 points (paired McNemar) |
| H9 | Specialisation keeps general visual skill | general VQA retention set (to add: a licensed public VQA subset) | Drop ≤ 3 points |
| H10 | The student can beat the teacher on some EgoVersa subsets | per-task comparison with `baseline_1` | Report wherever CIs separate, in both directions; no cherry-picking |

## Runs (configs in `research/configs/experiments/`)

| Run | Model | Supervision | Track | Purpose |
|---|---|---|---|---|
| `baseline_0` | Qwen3.5-0.8B, untuned | none | permissive | baseline (**done**) |
| `baseline_1` | SpatialAxiom-9B, frozen | none | research-nc | teacher reference |
| `A_geometry` | 0.8B + LoRA (language side) | oracle labels | permissive | direct specialisation |
| `A_geometry_vision` | 0.8B + LoRA (language + vision) | oracle labels | permissive | ablation |
| `B_teacher` | 0.8B + LoRA | teacher answers on the same images | research-nc | imitation |
| `C_hybrid` | 0.8B + LoRA | oracle labels + verified teacher rationales | research-nc | full treatment |
| `D_data_matched` | 0.8B + LoRA | oracle labels + same number of extra oracle examples | permissive | control for C |
| `E_quantized` | best permissive student | post-training F16 / Q8_0 / Q4_K_M | permissive | compression |
| `F_optional_student` | MiniCPM-V 4.7 1B (1.55B) | oracle labels | permissive | alternative architecture |

**Controls.** Same locked test set, same prompts, same image resolution (512×384), greedy decoding with
thinking off, the same optimiser budget per run (documented when it differs), and seeds recorded.
Stochastic runs are repeated with 3 seeds when compute allows. Single-seed results are labelled as
such.

## Data and splits

See DATASET_CARD.md. The test splits were generated first and locked by digest before any model saw
the data. Train, val, test_iid and test_ood use disjoint scene seeds. test_ood adds four shifts:
- an unseen question template family;
- an unseen lighting setup;
- a wider camera range;
- object types withheld from every other split.

Scale plan: smoke (388 samples) → pilot (5,379 train / 390 val, done) → 20–50 K train only if the pilot
shows a benefit.

## Metrics

Every number is reported with n and a 95% Wilson interval. Run-to-run differences on paired items use
McNemar's test.

- Accuracy: overall, per task, per split, per reference frame, per difficulty.
- Accuracy by observer heading offset θ (30° bins).
- Left/right inversion rate.
- Abstention recall, hidden-object hallucination rate, over-abstention.
- Unparseable reply rate (scored as wrong).
- Majority-answer rate and top-reply share per task, to detect answer collapse.
- Latency (warm mean, p95, first call), prompt tokens, weights on disk, runtime memory.

## Confounders and how they are handled

| Confounder | Handling |
|---|---|
| Answer collapse looks like skill on balanced tasks | majority-answer column, top-reply share, per-label confusion |
| Template memorisation | test_ood uses a template family never used in training |
| Scene-style overfitting | three environments, held-out object types, held-out lighting in test_ood |
| Holdout leakage via mining or teacher selection | `assert_not_holdout` blocks training, teacher collection and hard-example mining on locked ids or images |
| Teacher errors treated as truth | teacher replies are labelled verified / wrong / non-answer / hallucinated against the oracle; only C filters by verification, B keeps errors on purpose |
| Unfair comparison with the oracle | the oracle sees privileged geometry; it is a reference, never ranked against models |
| Synthetic-to-real gap | stated; independent real-image benchmarks are evaluation-only and listed as future work |

## Compute estimates

| Job | Where | Estimate |
|---|---|---|
| Full `A_geometry` (5.4 K examples × 2 epochs) | this Intel CPU | ~2–3 days, extrapolated from the 4-step smoke run (not measured) |
| Same | one CUDA GPU with ≥ 8 GB | expected to fit (Unsloth quotes ~3 GB for 0.8B BF16 LoRA); time not measured |
| Teacher collection on 5.4 K train items | GPU with ~24 GB | not measured |
| Evaluation of one model on the 1,163 test items | this CPU via Ollama | ~65 min (Q8_0), ~45 min (Q4_K_M), measured |

## Success criteria

- **Primary.** H1 and H2 hold with non-overlapping intervals and no task-level collapse.
- **Secondary.** H3 or H4 hold. H8 holds, giving a 4-bit student under 1 GB with accuracy within 2
  points of F16.
- **Not a success criterion.** Beating the 9B teacher overall. Where it happens on a subset, it is
  reported with its interval, its n and the subsets where the teacher wins.
