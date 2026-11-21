# Licences and provenance: two tracks

This is not legal advice. Whether a model trained on another model's outputs is a derivative work
depends on facts and jurisdiction. Anything below marked "needs review" requires legal review or
explicit permission from the upstream authors before commercial use.

## Track P: permissive (default)

| Component | Licence |
|---|---|
| Qwen/Qwen3.5-0.8B | Apache 2.0 |
| EgoVersa scenes, images, labels, code (procedural and MuJoCo) | MIT (this repository) |
| MuJoCo simulator (used to generate and label EgoVersa-Sim data; not redistributed) | Apache 2.0 |
| Fonts, npm and Python dependencies | their own licences |

Runs `baseline_0`, `A_geometry`, `A_geometry_vision`, `D_data_matched`, `E_quantized` and
`F_optional_student` are track P. A track-P adapter can be released together with the Apache-2.0
base, subject to the Qwen licence's attribution terms.

## Track R: research, non-commercial

| Component | Licence |
|---|---|
| SpatialAxiom-9B weights | CC BY-NC 4.0 (attribution: SpatialAxiom / D2I, Alibaba) |
| Teacher outputs and anything trained on them (`B_teacher`, `C_hybrid`) | **needs review**; treated as non-commercial |
| SpatialMosaic annotations (if ever used for evaluation) | CC BY-NC 4.0; images need ScanNet++ / Waymo licences |

**Default.** Track R weights are not distributed, and nothing in this repository markets them.
Apache 2.0 on the student base does **not** override restrictions that may attach to teacher-derived
training data.

## How mixing is prevented

- Every dataset record carries `provenance.license_track`. Every SFT record carries `license_track`
  and `supervision`.
- `run_teacher.py` writes only to `teacher/` and `sft_teacher/`, always tagged `research-nc`, never to
  `sft/`.
- `train_student.py` calls `assert_track`. A run declared `permissive` refuses any example that is not
  `license_track: permissive, supervision: oracle`. Tested in `research/tests/test_tooling.py`.
- `run_summary.json` and `export_manifest.json` record the track. `quantize_model.py` prints a
  non-commercial notice for track R.
- In the app, the teacher shows "research only, non-commercial" in the registry and model picker, and
  a licence notice comes back with every response from a research-track model.

## Provenance recorded per artifact

| Artifact | Recorded |
|---|---|
| Dataset | engine version, config and its digest, per-split counts, holdout digests, image SHA-256 per sample |
| Teacher query | prompt, image paths, raw output, parsed answer, verification label, checkpoint revision, decoding settings, wall time |
| Training run | config, dataset path, holdout digest, base revision, library versions, seed, device, curve, peak memory, LoRA targets, image-dependence check |
| Evaluation run | model id, runtime tag, digest, quantisation, dataset and splits, decoding settings, hardware, every raw reply |
