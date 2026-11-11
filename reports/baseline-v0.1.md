# EGOVERSA baseline benchmark report

Engine `egoversa-0.1.0`. Generated 2026-11-11T08:06:02.911Z. 840 views, 28813 scored questions, computed in 6844 ms.

> Every number below is measured by running the built-in reasoners on procedurally generated scenes.
> The reasoners are a geometric reference oracle, two hand-written heuristics and a seeded coin flip.
> **No vision-language model was evaluated**; nothing here is a claim about any learned model.

## Configuration

```json
{
  "baseSeed": "egoversa-baseline",
  "envs": [
    "tabletop",
    "room",
    "workbench"
  ],
  "scenariosPerEnv": 40,
  "shiftsDeg": [
    0,
    30,
    60,
    90,
    120,
    150,
    180
  ],
  "objectCount": 8,
  "occlusion": 0.5,
  "distractors": 1,
  "jitter": 0.5,
  "agents": 1,
  "toleranceScale": 1,
  "perRelation": 6,
  "poseJitter": 0.15
}
```

Environments: Tabletop, Compact room, Shelf & workbench. Scenario seeds follow `egoversa-baseline/<env>/<index>` for index 0..39.

## Dataset composition

| Relation | Candidates | Scored | Ambiguous (tie) | Unaskable | Evaluated | Gold label balance |
|---|---:|---:|---:|---:|---:|---|
| Left / right | 30240 | 16750 (55.4%) | 3248 (10.7%) | 10242 (33.9%) | 5001 | left 2471 / right 2530 |
| Closer / farther | 30240 | 16352 (54.1%) | 3646 (12.1%) | 10242 (33.9%) | 5010 | farther 2510 / closer 2500 |
| Above / below | 30240 | 12555 (41.5%) | 7443 (24.6%) | 10242 (33.9%) | 4945 | above 2607 / below 2338 |
| Visible / occluded | 7560 | 6348 (84.0%) | 1203 (15.9%) | 9 (0.1%) | 4997 | visible 3957 / occluded 1040 |
| Observer left / right | 9744 | 5421 (55.6%) | 794 (8.1%) | 3529 (36.2%) | 4079 | right 2061 / left 2018 |
| Observer front / behind | 9744 | 5420 (55.6%) | 795 (8.2%) | 3529 (36.2%) | 4109 | front 2383 / behind 1726 |
| Facing toward / away | 1218 | 672 (55.2%) | 312 (25.6%) | 234 (19.2%) | 672 | toward 330 / away 342 |

"Evaluated" is at most 6 scored questions per relation and view, chosen by a seeded, viewpoint-independent priority.

## Accuracy by relation (95% Wilson interval)

| Reasoner | Kind | Overall | Left / right | Closer / farther | Above / below | Visible / occluded | Observer left / right | Observer front / behind | Facing toward / away |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Geometry oracle | reference | 100.0% [100.0, 100.0] | 100.0% [99.9, 100.0] | 100.0% [99.9, 100.0] | 100.0% [99.9, 100.0] | 100.0% [99.9, 100.0] | 100.0% [99.9, 100.0] | 100.0% [99.9, 100.0] | 100.0% [99.4, 100.0] |
| World-axis heuristic | heuristic | 60.8% [60.2, 61.4] | 49.5% [48.1, 50.8] | 49.7% [48.4, 51.1] | 100.0% [99.9, 100.0] | 79.2% [78.0, 80.3] | 40.0% [38.5, 41.5] | 41.2% [39.7, 42.7] | 49.1% [45.3, 52.9] |
| Image-plane heuristic | heuristic | 80.0% [79.6, 80.5] | 100.0% [99.9, 100.0] | 90.0% [89.1, 90.8] | 87.9% [87.0, 88.8] | 93.3% [92.6, 94.0] | 51.3% [49.8, 52.9] | 51.4% [49.8, 52.9] | 49.1% [45.3, 52.9] |
| Seeded coin flip | chance | 49.8% [49.2, 50.4] | 49.2% [47.8, 50.6] | 49.1% [47.8, 50.5] | 49.4% [48.1, 50.8] | 49.6% [48.2, 51.0] | 49.4% [47.9, 51.0] | 52.0% [50.5, 53.5] | 51.5% [47.7, 55.2] |

## Accuracy by viewpoint shift — all relations

| Reasoner | 0° | 30° | 60° | 90° | 120° | 150° | 180° |
|---|---:|---:|---:|---:|---:|---:|---:|
| Geometry oracle | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| World-axis heuristic | 79.1% | 75.0% | 67.6% | 58.2% | 53.8% | 48.2% | 44.1% |
| Image-plane heuristic | 79.7% | 80.0% | 79.1% | 80.9% | 80.0% | 80.0% | 80.5% |
| Seeded coin flip | 50.5% | 49.1% | 49.0% | 50.2% | 50.1% | 50.3% | 49.2% |
| n | 4166 | 4116 | 4104 | 3837 | 4180 | 4249 | 4161 |

## Accuracy by viewpoint shift — Left / right

| Reasoner | 0° | 30° | 60° | 90° | 120° | 150° | 180° |
|---|---:|---:|---:|---:|---:|---:|---:|
| Geometry oracle | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| World-axis heuristic | 99.9% | 94.3% | 78.7% | 45.6% | 22.0% | 5.4% | 0.3% |
| Image-plane heuristic | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| Seeded coin flip | 50.0% | 48.9% | 46.6% | 50.6% | 48.7% | 50.8% | 49.1% |
| n | 720 | 716 | 719 | 688 | 719 | 720 | 719 |

## Accuracy by viewpoint shift — Closer / farther

| Reasoner | 0° | 30° | 60° | 90° | 120° | 150° | 180° |
|---|---:|---:|---:|---:|---:|---:|---:|
| Geometry oracle | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| World-axis heuristic | 99.6% | 78.4% | 59.7% | 49.8% | 39.7% | 20.6% | 0.7% |
| Image-plane heuristic | 97.8% | 96.5% | 93.7% | 91.0% | 89.2% | 84.4% | 77.4% |
| Seeded coin flip | 48.8% | 46.4% | 49.4% | 49.5% | 47.4% | 53.9% | 48.6% |
| n | 717 | 717 | 719 | 699 | 720 | 720 | 718 |

## Accuracy by viewpoint shift — Above / below

| Reasoner | 0° | 30° | 60° | 90° | 120° | 150° | 180° |
|---|---:|---:|---:|---:|---:|---:|---:|
| Geometry oracle | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| World-axis heuristic | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| Image-plane heuristic | 90.2% | 86.8% | 86.9% | 86.9% | 85.4% | 87.6% | 91.6% |
| Seeded coin flip | 50.4% | 52.1% | 48.8% | 48.1% | 49.3% | 48.2% | 49.2% |
| n | 706 | 707 | 717 | 673 | 714 | 716 | 712 |

## Accuracy by viewpoint shift — Visible / occluded

| Reasoner | 0° | 30° | 60° | 90° | 120° | 150° | 180° |
|---|---:|---:|---:|---:|---:|---:|---:|
| Geometry oracle | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| World-axis heuristic | 81.7% | 81.2% | 77.5% | 65.3% | 79.3% | 84.8% | 84.6% |
| Image-plane heuristic | 95.4% | 95.1% | 94.4% | 91.1% | 89.8% | 93.7% | 93.9% |
| Seeded coin flip | 49.7% | 47.5% | 47.6% | 52.2% | 51.8% | 49.1% | 49.3% |
| n | 716 | 718 | 712 | 717 | 705 | 709 | 720 |

## Accuracy by viewpoint shift — Observer left / right

| Reasoner | 0° | 30° | 60° | 90° | 120° | 150° | 180° |
|---|---:|---:|---:|---:|---:|---:|---:|
| Geometry oracle | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| World-axis heuristic | 41.6% | 42.5% | 38.7% | 39.7% | 39.3% | 39.7% | 38.5% |
| Image-plane heuristic | 41.9% | 44.1% | 40.9% | 51.6% | 58.9% | 60.0% | 60.5% |
| Seeded coin flip | 50.5% | 48.2% | 50.4% | 48.0% | 51.5% | 49.5% | 47.6% |
| n | 606 | 583 | 558 | 479 | 608 | 640 | 605 |

## Accuracy by viewpoint shift — Observer front / behind

| Reasoner | 0° | 30° | 60° | 90° | 120° | 150° | 180° |
|---|---:|---:|---:|---:|---:|---:|---:|
| Geometry oracle | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| World-axis heuristic | 41.4% | 43.0% | 39.8% | 40.0% | 42.1% | 40.4% | 41.2% |
| Image-plane heuristic | 42.6% | 46.1% | 45.9% | 51.1% | 56.8% | 57.2% | 59.1% |
| Seeded coin flip | 53.8% | 52.4% | 52.3% | 52.2% | 52.4% | 50.0% | 51.1% |
| n | 608 | 588 | 575 | 485 | 618 | 636 | 599 |

## Accuracy by viewpoint shift — Facing toward / away

| Reasoner | 0° | 30° | 60° | 90° | 120° | 150° | 180° |
|---|---:|---:|---:|---:|---:|---:|---:|
| Geometry oracle | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| World-axis heuristic | 73.1% | 70.1% | 64.4% | 49.0% | 32.3% | 28.7% | 28.4% |
| Image-plane heuristic | 73.1% | 70.1% | 64.4% | 49.0% | 32.3% | 28.7% | 28.4% |
| Seeded coin flip | 52.7% | 47.1% | 50.0% | 53.1% | 52.1% | 52.8% | 52.3% |
| n | 93 | 87 | 104 | 96 | 96 | 108 | 88 |

## Accuracy by environment

| Reasoner | Tabletop | Compact room | Shelf & workbench |
|---|---:|---:|---:|
| Geometry oracle | 100.0% | 100.0% | 100.0% |
| World-axis heuristic | 62.6% | 56.4% | 63.7% |
| Image-plane heuristic | 80.9% | 79.6% | 79.6% |
| Seeded coin flip | 49.2% | 50.7% | 49.5% |

## Confusion matrices (rows = geometric ground truth, columns = prediction)

### World-axis heuristic

Left / right

| gold \ pred | left | right |
|---|---:|---:|
| left | 1224 | 1247 |
| right | 1281 | 1249 |

Closer / farther

| gold \ pred | closer | farther |
|---|---:|---:|
| closer | 1272 | 1228 |
| farther | 1290 | 1220 |

Above / below

| gold \ pred | above | below |
|---|---:|---:|
| above | 2607 | 0 |
| below | 0 | 2338 |

Visible / occluded

| gold \ pred | visible | occluded |
|---|---:|---:|
| visible | 3957 | 0 |
| occluded | 1040 | 0 |

Observer left / right

| gold \ pred | left | right |
|---|---:|---:|
| left | 765 | 1253 |
| right | 1194 | 867 |

Observer front / behind

| gold \ pred | front | behind |
|---|---:|---:|
| front | 864 | 1519 |
| behind | 898 | 828 |

Facing toward / away

| gold \ pred | toward | away |
|---|---:|---:|
| toward | 330 | 0 |
| away | 342 | 0 |

### Image-plane heuristic

Left / right

| gold \ pred | left | right |
|---|---:|---:|
| left | 2471 | 0 |
| right | 0 | 2530 |

Closer / farther

| gold \ pred | closer | farther |
|---|---:|---:|
| closer | 2245 | 255 |
| farther | 246 | 2264 |

Above / below

| gold \ pred | above | below |
|---|---:|---:|
| above | 2285 | 322 |
| below | 275 | 2063 |

Visible / occluded

| gold \ pred | visible | occluded |
|---|---:|---:|
| visible | 3665 | 292 |
| occluded | 41 | 999 |

Observer left / right

| gold \ pred | left | right |
|---|---:|---:|
| left | 1035 | 983 |
| right | 1002 | 1059 |

Observer front / behind

| gold \ pred | front | behind |
|---|---:|---:|
| front | 1061 | 1322 |
| behind | 676 | 1050 |

Facing toward / away

| gold \ pred | toward | away |
|---|---:|---:|
| toward | 330 | 0 |
| away | 342 | 0 |

## Reasoner inputs

- **Geometry oracle** (reference). Sees: Full scene geometry and the camera pose. Analytic ground truth: camera-space transforms and ray casts. A reference, not a model — it is correct by construction.
- **World-axis heuristic** (heuristic). Sees: World coordinates of object centres. No camera pose. Answers every question in the fixed world frame, as if the camera never left the canonical front view.
- **Image-plane heuristic** (heuristic). Sees: Amodal 2D bounding boxes in the image. No depth, no 3D. Reads relations straight off pixel positions: lower box = nearer, higher box = above, box overlap = occlusion. Answers observer-frame questions from the camera’s own view (egocentric bias).
- **Seeded coin flip** (chance). Sees: Nothing. Deterministic pseudo-random guess. The floor any reasoner must beat.
