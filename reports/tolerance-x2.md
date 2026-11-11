# EGOVERSA baseline benchmark report

Engine `egoversa-0.1.0`. Generated 2026-11-11T08:09:19.895Z. 840 views, 26571 scored questions, computed in 6708 ms.

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
  "toleranceScale": 2,
  "perRelation": 6,
  "poseJitter": 0.15
}
```

Environments: Tabletop, Compact room, Shelf & workbench. Scenario seeds follow `egoversa-baseline/<env>/<index>` for index 0..39.

## Dataset composition

| Relation | Candidates | Scored | Ambiguous (tie) | Unaskable | Evaluated | Gold label balance |
|---|---:|---:|---:|---:|---:|---|
| Left / right | 30240 | 12563 (41.5%) | 7435 (24.6%) | 10242 (33.9%) | 4955 | left 2455 / right 2500 |
| Closer / farther | 30240 | 13264 (43.9%) | 6734 (22.3%) | 10242 (33.9%) | 4986 | farther 2512 / closer 2474 |
| Above / below | 30240 | 8321 (27.5%) | 11677 (38.6%) | 10242 (33.9%) | 4507 | above 2448 / below 2059 |
| Visible / occluded | 7560 | 4835 (64.0%) | 2716 (35.9%) | 9 (0.1%) | 4482 | visible 3717 / occluded 765 |
| Observer left / right | 9744 | 4558 (46.8%) | 1657 (17.0%) | 3529 (36.2%) | 3617 | right 1836 / left 1781 |
| Observer front / behind | 9744 | 4507 (46.3%) | 1708 (17.5%) | 3529 (36.2%) | 3674 | front 2117 / behind 1557 |
| Facing toward / away | 1218 | 350 (28.7%) | 634 (52.1%) | 234 (19.2%) | 350 | toward 165 / away 185 |

"Evaluated" is at most 6 scored questions per relation and view, chosen by a seeded, viewpoint-independent priority.

## Accuracy by relation (95% Wilson interval)

| Reasoner | Kind | Overall | Left / right | Closer / farther | Above / below | Visible / occluded | Observer left / right | Observer front / behind | Facing toward / away |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Geometry oracle | reference | 100.0% [100.0, 100.0] | 100.0% [99.9, 100.0] | 100.0% [99.9, 100.0] | 100.0% [99.9, 100.0] | 100.0% [99.9, 100.0] | 100.0% [99.9, 100.0] | 100.0% [99.9, 100.0] | 100.0% [98.9, 100.0] |
| World-axis heuristic | heuristic | 60.9% [60.3, 61.5] | 49.3% [48.0, 50.7] | 49.8% [48.4, 51.1] | 100.0% [99.9, 100.0] | 82.9% [81.8, 84.0] | 39.3% [37.7, 40.9] | 39.3% [37.8, 40.9] | 47.1% [42.0, 52.4] |
| Image-plane heuristic | heuristic | 82.6% [82.2, 83.1] | 100.0% [99.9, 100.0] | 90.5% [89.7, 91.3] | 94.2% [93.4, 94.8] | 97.0% [96.4, 97.4] | 51.3% [49.7, 52.9] | 51.2% [49.6, 52.8] | 47.1% [42.0, 52.4] |
| Seeded coin flip | chance | 50.0% [49.4, 50.6] | 50.0% [48.6, 51.4] | 49.9% [48.6, 51.3] | 49.7% [48.3, 51.2] | 49.2% [47.7, 50.6] | 49.2% [47.6, 50.8] | 52.2% [50.6, 53.8] | 52.0% [46.8, 57.2] |

## Accuracy by viewpoint shift — all relations

| Reasoner | 0° | 30° | 60° | 90° | 120° | 150° | 180° |
|---|---:|---:|---:|---:|---:|---:|---:|
| Geometry oracle | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| World-axis heuristic | 80.7% | 77.5% | 69.8% | 57.9% | 51.3% | 45.9% | 43.2% |
| Image-plane heuristic | 82.1% | 82.5% | 81.3% | 83.4% | 83.7% | 82.7% | 82.9% |
| Seeded coin flip | 51.2% | 49.9% | 49.3% | 50.3% | 50.1% | 50.4% | 48.9% |
| n | 3887 | 3844 | 3757 | 3476 | 3777 | 3931 | 3899 |

## Accuracy by viewpoint shift — Left / right

| Reasoner | 0° | 30° | 60° | 90° | 120° | 150° | 180° |
|---|---:|---:|---:|---:|---:|---:|---:|
| Geometry oracle | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| World-axis heuristic | 100.0% | 97.8% | 86.1% | 44.9% | 14.7% | 2.8% | 0.0% |
| Image-plane heuristic | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| Seeded coin flip | 50.7% | 50.7% | 48.2% | 51.3% | 48.5% | 50.8% | 50.1% |
| n | 718 | 712 | 703 | 670 | 714 | 719 | 719 |

## Accuracy by viewpoint shift — Closer / farther

| Reasoner | 0° | 30° | 60° | 90° | 120° | 150° | 180° |
|---|---:|---:|---:|---:|---:|---:|---:|
| Geometry oracle | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| World-axis heuristic | 99.9% | 83.6% | 62.6% | 48.6% | 38.4% | 15.5% | 0.0% |
| Image-plane heuristic | 99.6% | 98.3% | 94.9% | 91.7% | 90.0% | 82.4% | 76.8% |
| Seeded coin flip | 50.0% | 49.2% | 49.7% | 49.2% | 49.1% | 53.8% | 48.5% |
| n | 714 | 715 | 719 | 687 | 717 | 717 | 717 |

## Accuracy by viewpoint shift — Above / below

| Reasoner | 0° | 30° | 60° | 90° | 120° | 150° | 180° |
|---|---:|---:|---:|---:|---:|---:|---:|
| Geometry oracle | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| World-axis heuristic | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| Image-plane heuristic | 95.3% | 92.8% | 94.1% | 93.1% | 93.4% | 94.4% | 95.9% |
| Seeded coin flip | 51.8% | 53.7% | 48.9% | 49.7% | 47.5% | 46.5% | 50.2% |
| n | 641 | 656 | 642 | 592 | 653 | 660 | 663 |

## Accuracy by viewpoint shift — Visible / occluded

| Reasoner | 0° | 30° | 60° | 90° | 120° | 150° | 180° |
|---|---:|---:|---:|---:|---:|---:|---:|
| Geometry oracle | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| World-axis heuristic | 86.5% | 85.0% | 80.6% | 69.7% | 81.8% | 88.3% | 87.8% |
| Image-plane heuristic | 97.3% | 98.8% | 96.8% | 95.9% | 96.1% | 96.9% | 96.7% |
| Seeded coin flip | 49.4% | 45.4% | 48.8% | 51.3% | 51.8% | 49.9% | 47.9% |
| n | 676 | 661 | 629 | 633 | 570 | 639 | 674 |

## Accuracy by viewpoint shift — Observer left / right

| Reasoner | 0° | 30° | 60° | 90° | 120° | 150° | 180° |
|---|---:|---:|---:|---:|---:|---:|---:|
| Geometry oracle | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| World-axis heuristic | 42.7% | 42.5% | 37.6% | 37.4% | 38.3% | 38.2% | 37.8% |
| Image-plane heuristic | 42.7% | 43.7% | 39.6% | 49.9% | 59.7% | 60.8% | 60.9% |
| Seeded coin flip | 50.4% | 48.3% | 51.2% | 46.6% | 52.2% | 50.0% | 45.2% |
| n | 536 | 515 | 502 | 425 | 533 | 566 | 540 |

## Accuracy by viewpoint shift — Observer front / behind

| Reasoner | 0° | 30° | 60° | 90° | 120° | 150° | 180° |
|---|---:|---:|---:|---:|---:|---:|---:|
| Geometry oracle | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| World-axis heuristic | 39.1% | 39.4% | 38.4% | 39.5% | 40.7% | 38.8% | 39.3% |
| Image-plane heuristic | 41.3% | 43.4% | 43.8% | 49.6% | 57.8% | 59.6% | 61.4% |
| Seeded coin flip | 54.5% | 53.1% | 50.1% | 53.2% | 52.5% | 50.7% | 51.5% |
| n | 552 | 535 | 505 | 423 | 543 | 572 | 544 |

## Accuracy by viewpoint shift — Facing toward / away

| Reasoner | 0° | 30° | 60° | 90° | 120° | 150° | 180° |
|---|---:|---:|---:|---:|---:|---:|---:|
| Geometry oracle | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| World-axis heuristic | 70.0% | 74.0% | 64.9% | 43.5% | 29.8% | 20.7% | 23.8% |
| Image-plane heuristic | 70.0% | 74.0% | 64.9% | 43.5% | 29.8% | 20.7% | 23.8% |
| Seeded coin flip | 64.0% | 42.0% | 45.6% | 54.3% | 57.4% | 55.2% | 45.2% |
| n | 50 | 50 | 57 | 46 | 47 | 58 | 42 |

## Accuracy by environment

| Reasoner | Tabletop | Compact room | Shelf & workbench |
|---|---:|---:|---:|
| Geometry oracle | 100.0% | 100.0% | 100.0% |
| World-axis heuristic | 62.1% | 56.5% | 64.3% |
| Image-plane heuristic | 84.6% | 82.4% | 81.0% |
| Seeded coin flip | 49.5% | 50.4% | 50.1% |

## Confusion matrices (rows = geometric ground truth, columns = prediction)

### World-axis heuristic

Left / right

| gold \ pred | left | right |
|---|---:|---:|
| left | 1195 | 1260 |
| right | 1250 | 1250 |

Closer / farther

| gold \ pred | closer | farther |
|---|---:|---:|
| closer | 1250 | 1224 |
| farther | 1281 | 1231 |

Above / below

| gold \ pred | above | below |
|---|---:|---:|
| above | 2448 | 0 |
| below | 0 | 2059 |

Visible / occluded

| gold \ pred | visible | occluded |
|---|---:|---:|
| visible | 3717 | 0 |
| occluded | 765 | 0 |

Observer left / right

| gold \ pred | left | right |
|---|---:|---:|
| left | 672 | 1109 |
| right | 1088 | 748 |

Observer front / behind

| gold \ pred | front | behind |
|---|---:|---:|
| front | 742 | 1375 |
| behind | 854 | 703 |

Facing toward / away

| gold \ pred | toward | away |
|---|---:|---:|
| toward | 165 | 0 |
| away | 185 | 0 |

### Image-plane heuristic

Left / right

| gold \ pred | left | right |
|---|---:|---:|
| left | 2455 | 0 |
| right | 0 | 2500 |

Closer / farther

| gold \ pred | closer | farther |
|---|---:|---:|
| closer | 2237 | 237 |
| farther | 236 | 2276 |

Above / below

| gold \ pred | above | below |
|---|---:|---:|
| above | 2302 | 146 |
| below | 117 | 1942 |

Visible / occluded

| gold \ pred | visible | occluded |
|---|---:|---:|
| visible | 3596 | 121 |
| occluded | 15 | 750 |

Observer left / right

| gold \ pred | left | right |
|---|---:|---:|
| left | 911 | 870 |
| right | 891 | 945 |

Observer front / behind

| gold \ pred | front | behind |
|---|---:|---:|
| front | 938 | 1179 |
| behind | 615 | 942 |

Facing toward / away

| gold \ pred | toward | away |
|---|---:|---:|
| toward | 165 | 0 |
| away | 185 | 0 |

## Reasoner inputs

- **Geometry oracle** (reference). Sees: Full scene geometry and the camera pose. Analytic ground truth: camera-space transforms and ray casts. A reference, not a model — it is correct by construction.
- **World-axis heuristic** (heuristic). Sees: World coordinates of object centres. No camera pose. Answers every question in the fixed world frame, as if the camera never left the canonical front view.
- **Image-plane heuristic** (heuristic). Sees: Amodal 2D bounding boxes in the image. No depth, no 3D. Reads relations straight off pixel positions: lower box = nearer, higher box = above, box overlap = occlusion. Answers observer-frame questions from the camera’s own view (egocentric bias).
- **Seeded coin flip** (chance). Sees: Nothing. Deterministic pseudo-random guess. The floor any reasoner must beat.
