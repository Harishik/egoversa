# Related work and positioning (surveyed 21 November 2026)

This survey is based on abstracts and model cards retrieved from arXiv and project pages during this project.
Venues are given only where the source states them. Numbers are quoted from the papers (*author-reported*) and
were not reproduced here.

## 1. Benchmarks for perspective taking and viewpoint reasoning

| Work | What it measures | Finding relevant to EgoVersa |
|---|---|---|
| APC, *Perspective-Aware Reasoning in VLMs via Mental Imagery Simulation* (Lee et al., ICCV 2025, arXiv 2504.17207) | Left/right, closer, visibility and facing from another agent's viewpoint; COMFORT++ and 3DSRBench | Accuracy collapses as the camera-to-observer angle grows. Re-rendering an abstract scene from the observer's viewpoint helps (Qwen2.5-VL left/right 43.3% → 89.7%) |
| ViewSpatial-Bench (Li et al., arXiv 2505.21500) | Five multi-viewpoint localisation tasks with an automatic 3D annotation pipeline | Models do well from the camera view and poorly from a human's view; fine-tuning on multi-perspective data gives +46.2% |
| MindCube (Wang et al., arXiv 2506.21458) | 21,154 questions on spatial mental models from limited views | Near-chance VLMs; "map-then-reason" takes them from 37.8% to 57.8%, and RL to 61.3% |
| SpinBench (Zhang et al., arXiv 2509.25390) | Perspective and rotation diagnostics over 43 VLMs | Strong egocentric bias; humans reach 91.2% |
| FlipSet, *Egocentric Bias in VLMs* (Wang et al., arXiv 2602.15892) | Level-2 visual perspective taking with 180° rotations over 103 VLMs | Most models score below chance; about three-quarters of errors reproduce the camera viewpoint |
| SpatialMosaic (Lee et al., arXiv 2512.23365) | Multi-view QA under partial visibility, occlusion and low overlap (ScanNet++, Waymo) | Accuracy drops with occlusion and rises with view overlap |
| PhysBench (ICLR 2025, OpenReview) | Physical-world understanding of VLMs | VLMs are weak; physics-grounded fine-tuning data helps |
| IntPhys 2 (arXiv 2506.09849) | Intuitive physics in video | Deep models are far from humans |

## 2. Methods

| Family | Representative work | Signal used |
|---|---|---|
| Training-free re-anchoring of the reference frame | APC; Allocentric Perceiver (arXiv 2602.05789); SymPL (arXiv 2602.19117); AlloSpatial (arXiv 2606.08952) | Geometry reconstructed by foundation models (detection, depth, orientation) and then re-expressed in the target frame |
| Supervised fine-tuning on perspective data | ViewSpatial; AlloEgo-VLM (arXiv 2608.15605; validated in Isaac Sim); perspective tokens (Leonard & Murray, arXiv 2601.16378) | Labels from 3D annotation pipelines or simulation |
| RL with verifiable rewards (GRPO) | SVQA-R1 (arXiv 2506.01371, view-consistent rewards from mirror-flip perturbations); LeRF (arXiv 2609.36219, SFT then RL with rendered reference frames); DR-MV3D (arXiv 2606.23557, dense map and trajectory rewards from VGGT + SAM pseudo-targets); FactoSR (arXiv 2609.03729); Active Exploring like a Pigeon (arXiv 2606.02459, executable spatial-assertion code as dense reward); CoRL / Ego-to-World (arXiv 2603.14811); Embodied-R (arXiv 2504.12680) | Answer correctness plus process or consistency rewards. Most process rewards come from pseudo-labels produced by frozen 3D foundation models |
| World simulators in the loop | Astra (arXiv 2606.06476, a learned world model renders novel views during RL); WorldMind (arXiv 2611.10151, latent world simulation with process-verifiable RL) | Imagined evidence from generative world models |

## 3. The gap EgoVersa targets

1. **Rewards and labels are approximate almost everywhere.**
   - Real-image work gets labels from 3D reconstruction (VGGT, SAM, depth estimators).
   - "Imagined" views come from generative models that can be inconsistent.
   - Errors in the supervision are hard to separate from errors in the model.
2. **Perception and reasoning are confounded.**
   - When a model fails a perspective question, nobody can say whether it failed to perceive the scene or
     failed to transform it.
   - APC's abstract re-rendering is the closest test, but it inherits detector and orientation-estimator
     noise.
3. **Physical structure is mostly absent from perspective work.**
   - Support ("resting on") and counterfactual stability ("would it fall if…") need dynamics, which
     static benchmarks cannot label.
4. **Small models are under-studied.**
   - Most systems are 3B–8B and above.
   - The behaviour of 1B-class students, which matter for edge robots, is rarely reported.

## 4. What EgoVersa contributes (status in brackets)

- **An exact verifier.** MuJoCo computes every label from simulator state (contact forces, forward
  rollouts, segmentation masks, body poses), with no learned perception in the labelling loop. *(Implemented; tested.)*
- **Perfect mental imagery as an experimental control.** The simulator renders the true view from the
  observer's head camera. Giving it to the model alongside the scene image measures how much of the
  perspective-taking failure is perceptual: APC's idea with the perception noise removed. *(Implemented;
  measured on the base 0.8B model, EXPERIMENTS.md E7.)*
- **Physics-grounded spatial relations.** Contact-force support and simulated counterfactual removal,
  asked from the same images as the frame questions. *(Implemented; measured on the base model, E6.)*
- **Simulator-verified GRPO (SV-GRPO) for a 1B student.** Four reward terms: answer, abstention
  calibration, an exact *process* reward on the stated reference frame (the robot's facing, checked
  against simulator state), and a *label-free* cross-view consistency reward (the same robot-frame or
  physics question rendered from two camera poses of one settled scene must get the same answer).
  *(Implemented; 2-step CPU smoke run only. Real runs need a GPU.)*
- **A paired, locked, provenance-tracked protocol** shared between the procedural (Three.js) and the
  physics (MuJoCo) pipelines. *(Implemented.)*

## 5. Claims we do not make

- No claim that SV-GRPO beats any published method: it has not been trained at scale.
- No claim of transfer from MuJoCo scenes to photographs; real-image benchmarks are evaluation-only future work.
- Published numbers above are context, not comparisons: different models, data and protocols.
