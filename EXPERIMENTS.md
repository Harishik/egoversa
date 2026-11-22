# Experiments

Every number here was produced on this machine (Intel i9-9880H, 16 GB, no CUDA) by the code in this
repository, with the command shown. There are two kinds of result:

- **E1–E3** score hand-written heuristics against the geometry oracle. No learned model is involved.
- **E4** runs a real vision-language model (Qwen3.5-0.8B) on rendered images.

No model has been fine-tuned yet, and the SpatialAxiom-9B teacher has not been run. See "Not yet run".

---

## E1. Geometry benchmark: built-in reasoners

```bash
npm run benchmark
```

Config: 3 environments × 40 scenes × 7 camera shifts (0°–180°) = 840 views. 8 objects and 1 robot per
scene. **28,813 scored questions.** Full tables: [`reports/baseline-v0.1.md`](reports/baseline-v0.1.md).

| Reasoner | Overall | L/R | Closer/farther | Above/below | Visible | Obs. L/R | Obs. front/behind | Facing |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Geometry oracle (reference) | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| World-axis heuristic | 60.8% | 49.5% | 49.7% | 100.0% | 79.2% | 40.0% | 41.2% | 49.1% |
| Image-plane heuristic | 80.0% | 100.0% | 90.0% | 87.9% | 93.3% | 51.3% | 51.4% | 49.1% |
| Seeded coin flip | 49.8% | 49.2% | 49.1% | 49.4% | 49.6% | 49.4% | 52.0% | 51.5% |

The oracle is 100% by construction. It is a pipeline check, not a result.

**Accuracy against camera shift (0°, 30°, …, 180°):**

| | 0° | 30° | 60° | 90° | 120° | 150° | 180° |
|---|---:|---:|---:|---:|---:|---:|---:|
| World-axis, left/right | 99.9% | 94.3% | 78.7% | 45.6% | 22.0% | 5.4% | 0.3% |
| World-axis, closer/farther | 99.6% | 78.4% | 59.7% | 49.8% | 39.7% | 20.6% | 0.7% |
| Image-plane, closer/farther | 97.8% | 96.5% | 93.7% | 91.0% | 89.2% | 84.4% | 77.4% |

**Perspective taking: image-plane heuristic by observer heading offset θ.** This heuristic answers
"from the robot's viewpoint" questions as if they were asked from the camera, which is the egocentric
bias reported for VLMs.

| θ | 0° | 30° | 60° | 90° | 120° | 150° | 180° |
|---|---:|---:|---:|---:|---:|---:|---:|
| Observer left/right | 99% | 90% | 70% | 54% | 28% | 12% | 0% |
| Observer front/behind | 92% | 78% | 62% | 48% | 40% | 22% | 12% |
| n (left/right) | 342 | 717 | 676 | 667 | 705 | 623 | 349 |

Its 51% average on observer left/right is not chance: it is right when the observer looks the way the
camera looks and exactly wrong when the observer faces the camera. This is the curve shape the APC
paper (ICCV 2025) reports for real VLMs, reproduced here with a known mechanism.

**Findings.**
1. A fixed world frame is right only where it coincides with the camera. On left/right it goes from
   99.9% at 0° to 0.3% at 180°.
2. Above/below is gravity-aligned for an upright viewer, so the world-axis heuristic is 100% there at
   every shift. This control shows the collapse comes from the frame, not from a weak heuristic.
3. Image rows are not depth or height. "Lower is nearer" gets 90.0% and "higher is above" 87.9%, with
   near-symmetric errors (246 vs 255 and 322 vs 275).
4. Box overlap over-calls occlusion: 292 false alarms against 41 misses.
5. Unexplained: the world-axis heuristic scores 36–46% on observer questions at every θ, consistently
   below chance. Not investigated.

**Dataset composition.**

| Relation | Scored | Ambiguous (tie) | Unaskable |
|---|---:|---:|---:|
| Camera left/right | 55.4% | 10.7% | 33.9% |
| Closer/farther | 54.1% | 12.1% | 33.9% |
| Above/below | 41.5% | 24.6% | 33.9% |
| Visible/occluded | 84.0% | 15.9% | 0.1% |
| Observer left/right | 55.6% | 8.1% | 36.2% |
| Observer front/behind | 55.6% | 8.2% | 36.2% |
| Facing | 55.2% | 25.6% | 19.2% |

## E2. Occlusion control

```bash
npx tsx scripts/run-benchmark.ts --no-csv --name occlusion-0 --occlusion 0
```

```bash
npx tsx scripts/run-benchmark.ts --no-csv --name occlusion-100 --occlusion 1
```

| Setting | Occluded share of visibility items | Pair candidates unaskable | World-axis visibility | Image-plane visibility |
|---|---:|---:|---:|---:|
| 0.0 | 10.6% (529 / 5,012) | 18.2% | 89.4% | 90.4% |
| 0.5 | 20.8% (1,040 / 4,997) | 33.9% | 79.2% | 93.3% |
| 1.0 | 22.8% (1,137 / 4,982) | 36.2% | 77.2% | 94.5% |

"Always visible" (the world-axis rule) tracks the base rate exactly.

## E3. Ambiguity tolerance

```bash
npx tsx scripts/run-benchmark.ts --no-csv --name tolerance-x2 --tolerance 2
```

Doubling every tie band raises the ambiguous share of left/right from 10.7% to 24.6% and of facing
from 25.6% to 52.1%. The image-plane heuristic improves where its errors are near the boundary
(above/below 87.9% → 94.2%, visibility 93.3% → 97.0%). The world-axis heuristic does not move
(60.8% → 60.9%): its errors come from the wrong frame, not from close calls.

---

## E4. Real model: base Qwen3.5-0.8B on the locked pilot test set

```bash
npm run eval:models -- --dataset research/data/egoversa-pilot --split test_iid,test_ood --model qwen3.5-0.8b-base
```

```bash
npm run eval:models -- --dataset research/data/egoversa-pilot --split test_iid,test_ood --model qwen3.5-0.8b-base-q4
```

Setup:
- 1,163 items (595 test_iid + 568 test_ood) from 72 held-out scenes, locked before any model ran.
- 512×384 renders; the model sees the image(s) and the prompt only.
- Ollama on CPU, temperature 0, thinking off, max 12 new tokens.
- Results: `research/results/egoversa-pilot__qwen3.5-0.8b-base*__test_iid+test_ood.json`, every raw
  reply included.

| Task | n | Majority answer | Q8_0 | Q8_0 most common reply | Q4_K_M |
|---|---:|---:|---:|---|---:|
| Camera left/right | 144 | 50.0% | **70.8%** [62.9, 77.6] | left 100 / right 44 | 58.3% |
| Closer/farther | 144 | 50.0% | 55.6% [47.4, 63.4] | closer 110 / 34 | 50.0% |
| Above/below | 144 | 50.0% | **62.5%** [54.4, 70.0] | above 124 / 20 | 52.1% |
| Visible/occluded | 144 | 52.1% | 51.4% | visible 119 / 25 | 54.9% |
| Observer left/right | 135 | 50.4% | 48.1% | left 127 / 8 | 50.4% |
| Observer front/behind | 135 | 51.1% | 51.1% | **front 135 / 0** | 51.1% |
| Facing | 109 | 50.5% | 48.6% | toward 96 / 13 | 42.2% |
| Abstain (hidden object) | 68 | 100% ("unknown") | **0.0%** | never says "unknown" | 0.0% |
| Two views: better view | 68 | 51.5% | 58.8% | first 43 / 25 | 50.0% |
| Two views: camera motion | 72 | 52.8% | 47.2% | **right 72 / 0** | 56.9% |
| **All** | 1,163 | | **52.2%** [49.3, 55.1] | | **48.8%** [46.0, 51.7] |

| Cost (measured) | Q8_0 | Q4_K_M |
|---|---:|---:|
| Weights on disk (incl. vision projector) | 1.32 GB | 0.74 GB |
| Warm latency, mean / p95 | 3.29 s / 4.98 s | 2.25 s / 3.60 s |
| Prompt tokens per item | ~275 | ~275 |

**Findings.**
1. **The base 0.8B student mostly does not reason about space; it repeats an answer.**
   - Front/behind: "front" on 135/135. Camera motion: "right" on 72/72. Observer left/right: "left" on
     127/135. These score at the majority-answer rate without using the image.
   - Only camera left/right (70.8%, about 21 points above majority) and above/below (62.5%) show real
     signal.
2. **No perspective taking.** Observer left/right is 48–53% in every θ bin; there is no structure for
   training to remove yet. The image-plane heuristic's θ curve in E1 is the pattern to look for once
   the student starts answering from the image.
3. **No abstention.** 0/68 "unknown" on fully hidden objects, and 0 over-abstention. The model always
   commits to a relation.
4. **4-bit costs accuracy on this task even before fine-tuning.**
   - Q4_K_M changes 389 of 1,163 answers (33%) and loses 3.4 points overall (McNemar χ² = 3.93,
     p ≈ 0.05: borderline).
   - Camera left/right falls from 70.8% to 58.3%.
   - It is 32% faster per item and 44% smaller on disk.
   - So hypothesis H8 must be tested on the fine-tuned student, not assumed.
5. **test_iid 51.8% vs test_ood 52.6%.** There is no OOD gap, as expected for a model that has not been
   fit to the training templates.
6. **Context, not a comparison.** Qwen reports 54.6% (non-thinking) on EmbSpatialBench for this
   model. Our numbers are on a different, synthetic test and are not comparable.

These results set the bar for `A_geometry`. A gain counts only if it clears the majority-answer column
and does not come from a new single-answer collapse. The Models workspace flags cells where 90% or
more of replies are one word.

## E5. Training pipeline smoke test (not a result)

```bash
research/.conda/bin/python research/scripts/train_student.py --config research/configs/experiments/smoke.yaml --smoke
```

A real LoRA update of Qwen3.5-0.8B on CPU (FP32):
- 853.0 M parameters, 5.41 M trainable (r = 8, 186 language-side linear layers).
- 260 tokens per example, of which 192 are image tokens. 3 supervised tokens (`right<|im_end|>\n`).
- Image-dependence check: loss 0.523 with the image vs 0.313 with blanked pixels. The values differ,
  so visual features reach the loss. Only the difference matters, not its sign.
- 4 optimiser steps on 8 examples: train loss 0.34 → 0.05, val loss 0.42 → 0.41 (n = 4).
- 318 s, peak RSS 7.3 GB.

This proves the code path, not learning: 8 examples cannot teach anything measurable. The adapter in
`research/runs/smoke-smoke` must not be evaluated or exported; `quantize_model.py` refuses smoke runs.

## E6. CPU post-training on realistic MuJoCo scenes (trunk caching + exact-expectation policy optimisation)

Data: `egoversa-sim-pilot` (v0.4.0, realistic). 27 Google Scanned Objects, Unitree G1 and Stretch 3 robots.
5,752 train / 364 val / 734 test_iid / 576 test_ood items. Four held-out assets appear only in test_ood (435 items).
Method: `research/scripts/train_cpu.py`. All runs are CPU only on an 8-thread Intel Mac.

**Exactness of the trunk cut.** Resuming at decoder layer 16 from the cached activations reproduces the full
model's next-token logits to max |Δ| = 5.7e-6, with the same argmax at three image sizes. A top-only forward
takes 0.3–0.7 s against 1.8–7.9 s for the full model.

**Cost.** Stage 1 cached 3,173 items in 6,476 s (2.04 s/item, once). Stage 2 trains 3.41 M LoRA parameters
on layers 16–23 at 1.5 s/item including backward, with no vision tower and no sampling. Base and tuned are
evaluated from the same caches, so every comparison is paired.

**Run 1 (random batches, lr 2e-4, 2 epochs, 1,743 task-stratified items): no real gain.** Constrained
accuracy (argmax over the admissible answers):

| split | n | base | tuned | only tuned right / only base right |
|---|---|---|---|---|
| val (subsample) | 120 | 66.7% | 55.0% | 19 / 33 |
| test_iid | 734 | 54.0% | 57.4% | 162 / 137 |
| test_ood | 576 | 58.5% | 58.5% | 88 / 88 |

The test_iid difference is not significant: exact McNemar on 162/137 gives p ≈ 0.17. The per-task table
shows why. The base model answers "left" to 222 of 734 items; the tuned model answers "right" to 254. It
swapped one answer prior for another instead of learning to read the scene.

**Diagnosis.** It is not a bug. With both labels in one batch at lr 1e-4, two items separate to p > 0.99
within 10 steps. With balanced batches, 32 lateral items are memorised (train 53% → 97%) while held-out
lateral accuracy falls (73% → 50%). Two lessons follow:
1. Random batches let a small model lower the loss by tracking each batch's label mix. Batches with one task
   and balanced labels remove that shortcut (`balanced_batches`, now the default).
2. Tens of items per task cannot teach the skill. Generalisation needs hundreds per task.

**Run 2 (balanced batches, lr 1e-4, 3 epochs, same 1,743 items and caches): worse than base.**

| split | n | base | tuned | only tuned right / only base right | exact McNemar p |
|---|---|---|---|---|---|
| val (subsample) | 120 | 66.7% | 45.0% | 20 / 46 | |
| test_iid | 734 | 54.0% | 50.8% | 180 / 203 | 0.26 |
| test_ood | 576 | 58.5% | 51.9% | 83 / 121 | 0.009 |

Training p(gold) stayed at about 0.55 through all three epochs, so the adapter did not even fit the training set.
Removing the label-prior shortcut left nothing else for it to learn. Read with the 32-item test above, the
conclusion is that **LoRA on decoder layers 16–23 alone does not have the capacity to learn these spatial
relations from the layer-16 state.** It can memorise a few items, but it can neither generalise nor fit 1.7k.
This is a negative result and is kept as one. The next experiment moves the cut down (layer 6) on the
rebalanced v0.5 data.

**Run 3: our full system on all 13 tasks (v0.5 data, layer-6 cut, 1,941 train items, 2 epochs, balanced batches).**
EgoVersa-Spatial is Qwen3.5-0.8B plus LoRA on layers 6–23 (7.65 M parameters), trained on CPU with the hybrid
objective: exact expected simulator reward, 0.3 × supervised term, 0.02 × KL to base, and 0.2 × cross-view
consistency. Constrained accuracy on the locked sets:

| | model | test_iid (n = 724) | test_ood (n = 573) |
|---|---|---|---|
| baseline | majority answer per task (from train) | 55.0% | 53.2% |
| baseline | base Qwen3.5-0.8B | 57.7% | 53.1% |
| **ours** | **EgoVersa-Spatial (CPU, RL hybrid)** | **66.3%** | **63.9%** |
| | only ours right / only base right | 181 / 119, p = 0.0004 | 136 / 74, p = 0.00002 |

Free generation (the reply's first token, no answer list given to the model) moves the same way: test_iid
48.5% → 63.3%, test_ood 44.5% → 60.4%.

Per task (test_iid / test_ood, base → ours):
- lateral: 57.7 → 85.9 / 69.5 → 79.7
- depth: 47.4 → 71.8 / 51.7 → 60.0
- support: 67.5 → 78.8 / 50.0 → 85.0
- obs_lateral_eye (robot's own view attached): 63.6 → 87.9 / 57.1 → 83.7
- camera motion: 47.5 → 70.0 / 60.0 → 80.0
- visibility: 63.8 → 66.2 / 55.0 → 76.7
- vertical: 45.2 → 58.1 / 52.8 → 66.7

Where it fails:
- obs_lateral without the robot's view: 50.6 → 38.8 / 49.3 → 39.1. It got worse. The same questions with the
  robot's view attached rose to 84–88%, so the model learns to read a view but not to imagine one.
- obs_frontback: 69.6 → 62.5 / 58.7 → 43.5.
- counterfactual: flat (54.5 → 53.0 / 37.0 → 39.1).
- abstention: 0% before and after. The model never answers "unknown".

**Capacity ablation (v0.5 data, lateral + observer-lateral only, 501 train items, 3 epochs, balanced batches).**
Same items, caches computed at two cut points, constrained accuracy:

| cut | trainable | split | n | base | tuned | only tuned right / only base right | exact McNemar p |
|---|---|---|---|---|---|---|---|
| layer 16 | 3.41 M (layers 16–23) | test_iid | 163 | 54.0% | 62.6% | 46 / 32 | 0.14 |
| layer 16 | | test_ood | 128 | 58.6% | 56.2% | 16 / 19 | 0.74 |
| **layer 6** | 7.65 M (layers 6–23) | test_iid | 163 | 54.0% | **69.3%** | 55 / 30 | **0.009** |
| **layer 6** | | test_ood | 128 | 58.6% | **70.3%** | 26 / 11 | **0.020** |

Per task with the layer-6 cut: camera-frame lateral rose from 58% to 78% (iid) and from 69% to 88% (ood, which
includes the four held-out objects). Robot-frame lateral rose from 51% to 61% (iid) and from 49% to 55% (ood).
The base model answers "left" to 148 of 163 iid items; the tuned model's answers match the balanced gold
split. Training costs 2.9 s/item with the layer-6 cut against 1.3 s with the layer-16 cut, and caching costs
1.7 s/item either way. **Conclusion: the cut point is the capacity knob. Layer 6 learns transferable spatial
relations on CPU; layer 16 does not.**

**Objective ablation (same setup as the layer-6 capacity run: lateral + robot-lateral, 501 items, 3 epochs,
same caches).** Only the loss changes.

| objective | test_iid (n = 163) | test_ood (n = 128) |
|---|---|---|
| base (no training) | 54.0% | 58.6% |
| RL reward only (α = 1, supervised 0, consistency 0.2) | 49.7% | 50.0% |
| supervised only (α = 0, supervised 1, consistency 0) | **70.6%** (p = 0.006 vs base) | **70.3%** (p = 0.017) |
| hybrid (α = 1, supervised 0.3, consistency 0.2) | 69.3% (p = 0.009) | **70.3%** (p = 0.020) |

The reward-only model answers "left" to every one of the 67 + 163 + 128 evaluation items. Its training
p(gold) settles at exactly 0.5 with expected reward 0.6, the value a constant answer earns on balanced
batches. The exact expected reward is linear in p, so the reward-only objective has no incentive to leave
that state when the features do not yet separate the classes. The supervised log-loss has the incentive.
**On this data the measurable gain comes from the supervised term. The RL term neither helps nor hurts once
it is added to the supervised term.**

**Dataset flaws found by this run** (reported, not hidden):
- `obs_frontback` is 100% "front" in every split, because realistic robots are posed facing the table.
- `facing` is 224 "toward" vs 5 "away" in train.
Both tasks are trivially solved by a constant answer and inflate base accuracy. Fixed in egoversa-sim v0.5.0:
40% of robots now stand with their back to the table. In `egoversa-sim-pilot-v05` train, front/behind is 242/183
and toward/away is 133/81.

## Not yet run

| Run | Blocker |
|---|---|
| `A_geometry`, `A_geometry_vision`, `D_data_matched` | CUDA GPU: ~2–3 days per run on this CPU (extrapolated) |
| `baseline_1` (SpatialAxiom-9B) | 18.8 GB of BF16 weights; needs a GPU with ~24 GB. Non-commercial only |
| `B_teacher`, `C_hybrid` | need teacher outputs from the above |
| `E_quantized` | needs a trained adapter, plus llama.cpp with `qwen35` support for GGUF export |
| `F_optional_student` (MiniCPM-V 1.55B) | not downloaded; its processor path is not validated |
| General VQA retention (H9) | choose a licensed public VQA subset |
| Multi-seed repeats | follow the single-seed runs above |
