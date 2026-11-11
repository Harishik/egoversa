# EGOVERSA baseline benchmark report

Engine `egoversa-0.1.0`. Generated 2026-11-11T08:09:11.351Z. 840 views, 28056 scored questions, computed in 6747 ms.

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
  "occlusion": 1,
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
| Left / right | 30240 | 16243 (53.7%) | 3039 (10.0%) | 10958 (36.2%) | 4955 | left 2426 / right 2529 |
| Closer / farther | 30240 | 15787 (52.2%) | 3495 (11.6%) | 10958 (36.2%) | 4974 | farther 2515 / closer 2459 |
| Above / below | 30240 | 12211 (40.4%) | 7071 (23.4%) | 10958 (36.2%) | 4899 | below 2464 / above 2435 |
| Visible / occluded | 7560 | 6290 (83.2%) | 1261 (16.7%) | 9 (0.1%) | 4982 | visible 3845 / occluded 1137 |
| Observer left / right | 8960 | 4747 (53.0%) | 732 (8.2%) | 3481 (38.9%) | 3820 | left 1989 / right 1831 |
| Observer front / behind | 8960 | 4810 (53.7%) | 669 (7.5%) | 3481 (38.9%) | 3851 | behind 1954 / front 1897 |
| Facing toward / away | 1120 | 575 (51.3%) | 303 (27.1%) | 242 (21.6%) | 575 | toward 293 / away 282 |

"Evaluated" is at most 6 scored questions per relation and view, chosen by a seeded, viewpoint-independent priority.

## Accuracy by relation (95% Wilson interval)

| Reasoner | Kind | Overall | Left / right | Closer / farther | Above / below | Visible / occluded | Observer left / right | Observer front / behind | Facing toward / away |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Geometry oracle | reference | 100.0% [100.0, 100.0] | 100.0% [99.9, 100.0] | 100.0% [99.9, 100.0] | 100.0% [99.9, 100.0] | 100.0% [99.9, 100.0] | 100.0% [99.9, 100.0] | 100.0% [99.9, 100.0] | 100.0% [99.3, 100.0] |
| World-axis heuristic | heuristic | 61.5% [61.0, 62.1] | 47.9% [46.5, 49.3] | 50.5% [49.1, 51.9] | 100.0% [99.9, 100.0] | 77.2% [76.0, 78.3] | 44.1% [42.6, 45.7] | 43.1% [41.5, 44.6] | 51.0% [46.9, 55.0] |
| Image-plane heuristic | heuristic | 80.2% [79.7, 80.6] | 100.0% [99.9, 100.0] | 90.6% [89.7, 91.4] | 88.2% [87.2, 89.0] | 94.5% [93.8, 95.1] | 49.0% [47.4, 50.5] | 47.8% [46.2, 49.3] | 51.0% [46.9, 55.0] |
| Seeded coin flip | chance | 50.0% [49.5, 50.6] | 50.3% [48.9, 51.7] | 50.1% [48.8, 51.5] | 50.0% [48.6, 51.4] | 49.6% [48.2, 51.0] | 49.8% [48.2, 51.3] | 50.3% [48.7, 51.9] | 51.3% [47.2, 55.4] |

## Accuracy by viewpoint shift — all relations

| Reasoner | 0° | 30° | 60° | 90° | 120° | 150° | 180° |
|---|---:|---:|---:|---:|---:|---:|---:|
| Geometry oracle | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| World-axis heuristic | 79.5% | 75.9% | 68.7% | 58.7% | 53.7% | 49.6% | 44.9% |
| Image-plane heuristic | 80.8% | 80.0% | 80.5% | 81.6% | 79.7% | 79.1% | 79.7% |
| Seeded coin flip | 49.5% | 48.3% | 49.9% | 51.1% | 49.5% | 50.8% | 51.1% |
| n | 4085 | 4052 | 3965 | 3687 | 3999 | 4110 | 4158 |

## Accuracy by viewpoint shift — Left / right

| Reasoner | 0° | 30° | 60° | 90° | 120° | 150° | 180° |
|---|---:|---:|---:|---:|---:|---:|---:|
| Geometry oracle | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| World-axis heuristic | 99.4% | 94.8% | 77.2% | 40.9% | 18.5% | 3.8% | 0.6% |
| Image-plane heuristic | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| Seeded coin flip | 46.9% | 50.3% | 48.8% | 51.5% | 49.7% | 53.5% | 51.5% |
| n | 719 | 715 | 715 | 653 | 715 | 720 | 718 |

## Accuracy by viewpoint shift — Closer / farther

| Reasoner | 0° | 30° | 60° | 90° | 120° | 150° | 180° |
|---|---:|---:|---:|---:|---:|---:|---:|
| Geometry oracle | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| World-axis heuristic | 99.2% | 79.2% | 62.1% | 53.4% | 39.4% | 19.7% | 0.6% |
| Image-plane heuristic | 98.9% | 97.9% | 94.7% | 93.0% | 89.1% | 83.8% | 76.9% |
| Seeded coin flip | 49.2% | 50.3% | 48.5% | 49.7% | 49.4% | 51.2% | 52.6% |
| n | 720 | 716 | 715 | 670 | 714 | 720 | 719 |

## Accuracy by viewpoint shift — Above / below

| Reasoner | 0° | 30° | 60° | 90° | 120° | 150° | 180° |
|---|---:|---:|---:|---:|---:|---:|---:|
| Geometry oracle | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| World-axis heuristic | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| Image-plane heuristic | 92.0% | 87.7% | 86.2% | 85.0% | 88.1% | 87.1% | 90.7% |
| Seeded coin flip | 50.8% | 46.1% | 51.0% | 54.1% | 50.6% | 49.7% | 47.8% |
| n | 714 | 701 | 702 | 658 | 698 | 715 | 711 |

## Accuracy by viewpoint shift — Visible / occluded

| Reasoner | 0° | 30° | 60° | 90° | 120° | 150° | 180° |
|---|---:|---:|---:|---:|---:|---:|---:|
| Geometry oracle | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| World-axis heuristic | 81.7% | 82.7% | 73.8% | 61.4% | 71.6% | 83.0% | 85.9% |
| Image-plane heuristic | 95.7% | 96.0% | 94.5% | 93.7% | 91.5% | 94.2% | 95.8% |
| Seeded coin flip | 49.9% | 47.1% | 52.2% | 50.8% | 47.9% | 49.7% | 49.6% |
| n | 717 | 717 | 711 | 712 | 708 | 706 | 711 |

## Accuracy by viewpoint shift — Observer left / right

| Reasoner | 0° | 30° | 60° | 90° | 120° | 150° | 180° |
|---|---:|---:|---:|---:|---:|---:|---:|
| Geometry oracle | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| World-axis heuristic | 41.1% | 44.3% | 44.2% | 45.4% | 45.6% | 45.3% | 43.4% |
| Image-plane heuristic | 41.6% | 43.7% | 45.7% | 48.9% | 50.9% | 54.0% | 56.8% |
| Seeded coin flip | 49.7% | 48.8% | 51.0% | 47.4% | 50.0% | 49.9% | 51.1% |
| n | 565 | 551 | 516 | 454 | 546 | 589 | 599 |

## Accuracy by viewpoint shift — Observer front / behind

| Reasoner | 0° | 30° | 60° | 90° | 120° | 150° | 180° |
|---|---:|---:|---:|---:|---:|---:|---:|
| Geometry oracle | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| World-axis heuristic | 40.5% | 42.0% | 43.0% | 43.6% | 45.3% | 46.4% | 40.7% |
| Image-plane heuristic | 40.8% | 39.5% | 45.5% | 53.7% | 48.1% | 50.3% | 56.5% |
| Seeded coin flip | 51.8% | 47.2% | 47.2% | 50.2% | 50.3% | 50.7% | 54.2% |
| n | 568 | 564 | 525 | 456 | 543 | 586 | 609 |

## Accuracy by viewpoint shift — Facing toward / away

| Reasoner | 0° | 30° | 60° | 90° | 120° | 150° | 180° |
|---|---:|---:|---:|---:|---:|---:|---:|
| Geometry oracle | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| World-axis heuristic | 70.7% | 64.8% | 58.0% | 45.2% | 44.0% | 39.2% | 34.1% |
| Image-plane heuristic | 70.7% | 64.8% | 58.0% | 45.2% | 44.0% | 39.2% | 34.1% |
| Seeded coin flip | 43.9% | 48.9% | 54.3% | 61.9% | 46.7% | 50.0% | 52.7% |
| n | 82 | 88 | 81 | 84 | 75 | 74 | 91 |

## Accuracy by environment

| Reasoner | Tabletop | Compact room | Shelf & workbench |
|---|---:|---:|---:|
| Geometry oracle | 100.0% | 100.0% | 100.0% |
| World-axis heuristic | 63.4% | 58.9% | 62.4% |
| Image-plane heuristic | 79.6% | 82.1% | 78.7% |
| Seeded coin flip | 50.1% | 49.6% | 50.4% |

## Confusion matrices (rows = geometric ground truth, columns = prediction)

### World-axis heuristic

Left / right

| gold \ pred | left | right |
|---|---:|---:|
| left | 1143 | 1283 |
| right | 1297 | 1232 |

Closer / farther

| gold \ pred | closer | farther |
|---|---:|---:|
| closer | 1222 | 1237 |
| farther | 1227 | 1288 |

Above / below

| gold \ pred | above | below |
|---|---:|---:|
| above | 2435 | 0 |
| below | 0 | 2464 |

Visible / occluded

| gold \ pred | visible | occluded |
|---|---:|---:|
| visible | 3845 | 0 |
| occluded | 1137 | 0 |

Observer left / right

| gold \ pred | left | right |
|---|---:|---:|
| left | 880 | 1109 |
| right | 1025 | 806 |

Observer front / behind

| gold \ pred | front | behind |
|---|---:|---:|
| front | 680 | 1217 |
| behind | 976 | 978 |

Facing toward / away

| gold \ pred | toward | away |
|---|---:|---:|
| toward | 293 | 0 |
| away | 282 | 0 |

### Image-plane heuristic

Left / right

| gold \ pred | left | right |
|---|---:|---:|
| left | 2426 | 0 |
| right | 0 | 2529 |

Closer / farther

| gold \ pred | closer | farther |
|---|---:|---:|
| closer | 2203 | 256 |
| farther | 213 | 2302 |

Above / below

| gold \ pred | above | below |
|---|---:|---:|
| above | 2144 | 291 |
| below | 289 | 2175 |

Visible / occluded

| gold \ pred | visible | occluded |
|---|---:|---:|
| visible | 3606 | 239 |
| occluded | 36 | 1101 |

Observer left / right

| gold \ pred | left | right |
|---|---:|---:|
| left | 994 | 995 |
| right | 955 | 876 |

Observer front / behind

| gold \ pred | front | behind |
|---|---:|---:|
| front | 705 | 1192 |
| behind | 820 | 1134 |

Facing toward / away

| gold \ pred | toward | away |
|---|---:|---:|
| toward | 293 | 0 |
| away | 282 | 0 |

## Reasoner inputs

- **Geometry oracle** (reference). Sees: Full scene geometry and the camera pose. Analytic ground truth: camera-space transforms and ray casts. A reference, not a model — it is correct by construction.
- **World-axis heuristic** (heuristic). Sees: World coordinates of object centres. No camera pose. Answers every question in the fixed world frame, as if the camera never left the canonical front view.
- **Image-plane heuristic** (heuristic). Sees: Amodal 2D bounding boxes in the image. No depth, no 3D. Reads relations straight off pixel positions: lower box = nearer, higher box = above, box overlap = occlusion. Answers observer-frame questions from the camera’s own view (egocentric bias).
- **Seeded coin flip** (chance). Sees: Nothing. Deterministic pseudo-random guess. The floor any reasoner must beat.
