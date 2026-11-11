# EGOVERSA baseline benchmark report

Engine `egoversa-0.1.0`. Generated 2026-11-11T08:09:02.995Z. 840 views, 30309 scored questions, computed in 6555 ms.

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
  "occlusion": 0,
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
| Left / right | 30240 | 20250 (67.0%) | 4499 (14.9%) | 5491 (18.2%) | 5023 | left 2493 / right 2530 |
| Closer / farther | 30240 | 20383 (67.4%) | 4366 (14.4%) | 5491 (18.2%) | 5032 | closer 2499 / farther 2533 |
| Above / below | 30240 | 15323 (50.7%) | 9426 (31.2%) | 5491 (18.2%) | 5003 | above 2481 / below 2522 |
| Visible / occluded | 7560 | 6534 (86.4%) | 1021 (13.5%) | 5 (0.1%) | 5012 | visible 4483 / occluded 529 |
| Observer left / right | 11032 | 7790 (70.6%) | 1336 (12.1%) | 1906 (17.3%) | 4660 | right 2409 / left 2251 |
| Observer front / behind | 11032 | 7937 (71.9%) | 1189 (10.8%) | 1906 (17.3%) | 4706 | front 2274 / behind 2432 |
| Facing toward / away | 1379 | 873 (63.3%) | 418 (30.3%) | 88 (6.4%) | 873 | away 438 / toward 435 |

"Evaluated" is at most 6 scored questions per relation and view, chosen by a seeded, viewpoint-independent priority.

## Accuracy by relation (95% Wilson interval)

| Reasoner | Kind | Overall | Left / right | Closer / farther | Above / below | Visible / occluded | Observer left / right | Observer front / behind | Facing toward / away |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Geometry oracle | reference | 100.0% [100.0, 100.0] | 100.0% [99.9, 100.0] | 100.0% [99.9, 100.0] | 100.0% [99.9, 100.0] | 100.0% [99.9, 100.0] | 100.0% [99.9, 100.0] | 100.0% [99.9, 100.0] | 100.0% [99.6, 100.0] |
| World-axis heuristic | heuristic | 62.3% [61.8, 62.9] | 50.3% [48.9, 51.7] | 49.5% [48.1, 50.9] | 100.0% [99.9, 100.0] | 89.4% [88.6, 90.3] | 41.2% [39.8, 42.6] | 43.2% [41.8, 44.7] | 49.8% [46.5, 53.1] |
| Image-plane heuristic | heuristic | 76.8% [76.3, 77.3] | 100.0% [99.9, 100.0] | 87.9% [87.0, 88.8] | 84.2% [83.2, 85.2] | 90.4% [89.5, 91.1] | 49.4% [48.0, 50.9] | 50.0% [48.6, 51.4] | 49.8% [46.5, 53.1] |
| Seeded coin flip | chance | 50.1% [49.6, 50.7] | 49.8% [48.4, 51.2] | 50.0% [48.6, 51.4] | 50.2% [48.9, 51.6] | 49.7% [48.3, 51.1] | 49.4% [48.0, 50.8] | 51.6% [50.2, 53.0] | 51.1% [47.8, 54.4] |

## Accuracy by viewpoint shift — all relations

| Reasoner | 0° | 30° | 60° | 90° | 120° | 150° | 180° |
|---|---:|---:|---:|---:|---:|---:|---:|
| Geometry oracle | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| World-axis heuristic | 79.4% | 75.4% | 69.3% | 62.2% | 54.7% | 49.8% | 45.8% |
| Image-plane heuristic | 77.6% | 76.6% | 75.4% | 76.1% | 77.4% | 77.4% | 77.1% |
| Seeded coin flip | 51.4% | 49.6% | 50.7% | 50.4% | 49.3% | 49.3% | 50.3% |
| n | 4386 | 4315 | 4373 | 4108 | 4344 | 4403 | 4380 |

## Accuracy by viewpoint shift — Left / right

| Reasoner | 0° | 30° | 60° | 90° | 120° | 150° | 180° |
|---|---:|---:|---:|---:|---:|---:|---:|
| Geometry oracle | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| World-axis heuristic | 99.6% | 94.6% | 80.5% | 49.4% | 20.6% | 6.7% | 0.6% |
| Image-plane heuristic | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| Seeded coin flip | 51.7% | 51.4% | 52.4% | 48.2% | 50.6% | 45.8% | 48.5% |
| n | 720 | 720 | 719 | 704 | 720 | 720 | 720 |

## Accuracy by viewpoint shift — Closer / farther

| Reasoner | 0° | 30° | 60° | 90° | 120° | 150° | 180° |
|---|---:|---:|---:|---:|---:|---:|---:|
| Geometry oracle | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| World-axis heuristic | 99.7% | 80.4% | 58.8% | 52.2% | 35.7% | 19.3% | 0.6% |
| Image-plane heuristic | 98.5% | 93.7% | 90.3% | 89.3% | 84.6% | 82.1% | 76.9% |
| Seeded coin flip | 51.8% | 50.2% | 51.4% | 49.9% | 48.3% | 49.6% | 48.8% |
| n | 720 | 719 | 720 | 713 | 720 | 720 | 720 |

## Accuracy by viewpoint shift — Above / below

| Reasoner | 0° | 30° | 60° | 90° | 120° | 150° | 180° |
|---|---:|---:|---:|---:|---:|---:|---:|
| Geometry oracle | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| World-axis heuristic | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| Image-plane heuristic | 87.1% | 84.8% | 85.8% | 79.0% | 84.1% | 82.6% | 86.2% |
| Seeded coin flip | 49.2% | 49.9% | 48.7% | 53.2% | 48.9% | 50.3% | 51.6% |
| n | 720 | 717 | 718 | 696 | 716 | 719 | 717 |

## Accuracy by viewpoint shift — Visible / occluded

| Reasoner | 0° | 30° | 60° | 90° | 120° | 150° | 180° |
|---|---:|---:|---:|---:|---:|---:|---:|
| Geometry oracle | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| World-axis heuristic | 90.7% | 90.7% | 89.7% | 82.0% | 88.2% | 92.2% | 92.6% |
| Image-plane heuristic | 94.3% | 92.8% | 90.0% | 84.7% | 85.2% | 92.0% | 93.4% |
| Seeded coin flip | 50.9% | 47.1% | 52.1% | 49.2% | 48.5% | 49.0% | 50.9% |
| n | 717 | 720 | 718 | 713 | 711 | 716 | 717 |

## Accuracy by viewpoint shift — Observer left / right

| Reasoner | 0° | 30° | 60° | 90° | 120° | 150° | 180° |
|---|---:|---:|---:|---:|---:|---:|---:|
| Geometry oracle | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| World-axis heuristic | 40.9% | 39.4% | 41.5% | 42.2% | 43.1% | 40.6% | 41.0% |
| Image-plane heuristic | 41.0% | 38.4% | 42.8% | 46.5% | 58.7% | 59.5% | 58.2% |
| Seeded coin flip | 51.0% | 48.6% | 47.4% | 48.5% | 49.6% | 50.0% | 50.4% |
| n | 690 | 658 | 680 | 585 | 663 | 692 | 692 |

## Accuracy by viewpoint shift — Observer front / behind

| Reasoner | 0° | 30° | 60° | 90° | 120° | 150° | 180° |
|---|---:|---:|---:|---:|---:|---:|---:|
| Geometry oracle | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| World-axis heuristic | 43.7% | 42.3% | 43.4% | 42.6% | 43.6% | 43.3% | 43.6% |
| Image-plane heuristic | 42.7% | 45.0% | 42.5% | 51.7% | 57.7% | 56.0% | 54.5% |
| Seeded coin flip | 52.8% | 50.6% | 51.1% | 55.2% | 48.8% | 51.4% | 51.8% |
| n | 695 | 666 | 685 | 582 | 681 | 702 | 695 |

## Accuracy by viewpoint shift — Facing toward / away

| Reasoner | 0° | 30° | 60° | 90° | 120° | 150° | 180° |
|---|---:|---:|---:|---:|---:|---:|---:|
| Geometry oracle | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| World-axis heuristic | 73.4% | 71.3% | 64.7% | 50.4% | 33.8% | 30.6% | 26.9% |
| Image-plane heuristic | 73.4% | 71.3% | 64.7% | 50.4% | 33.8% | 30.6% | 26.9% |
| Seeded coin flip | 57.3% | 48.7% | 54.1% | 43.5% | 54.9% | 48.5% | 49.6% |
| n | 124 | 115 | 133 | 115 | 133 | 134 | 119 |

## Accuracy by environment

| Reasoner | Tabletop | Compact room | Shelf & workbench |
|---|---:|---:|---:|
| Geometry oracle | 100.0% | 100.0% | 100.0% |
| World-axis heuristic | 66.6% | 57.9% | 62.7% |
| Image-plane heuristic | 77.4% | 76.5% | 76.5% |
| Seeded coin flip | 49.5% | 50.7% | 50.2% |

## Confusion matrices (rows = geometric ground truth, columns = prediction)

### World-axis heuristic

Left / right

| gold \ pred | left | right |
|---|---:|---:|
| left | 1247 | 1246 |
| right | 1252 | 1278 |

Closer / farther

| gold \ pred | closer | farther |
|---|---:|---:|
| closer | 1242 | 1257 |
| farther | 1284 | 1249 |

Above / below

| gold \ pred | above | below |
|---|---:|---:|
| above | 2481 | 0 |
| below | 0 | 2522 |

Visible / occluded

| gold \ pred | visible | occluded |
|---|---:|---:|
| visible | 4483 | 0 |
| occluded | 529 | 0 |

Observer left / right

| gold \ pred | left | right |
|---|---:|---:|
| left | 923 | 1328 |
| right | 1411 | 998 |

Observer front / behind

| gold \ pred | front | behind |
|---|---:|---:|
| front | 844 | 1430 |
| behind | 1241 | 1191 |

Facing toward / away

| gold \ pred | toward | away |
|---|---:|---:|
| toward | 435 | 0 |
| away | 438 | 0 |

### Image-plane heuristic

Left / right

| gold \ pred | left | right |
|---|---:|---:|
| left | 2493 | 0 |
| right | 0 | 2530 |

Closer / farther

| gold \ pred | closer | farther |
|---|---:|---:|
| closer | 2219 | 280 |
| farther | 328 | 2205 |

Above / below

| gold \ pred | above | below |
|---|---:|---:|
| above | 2099 | 382 |
| below | 406 | 2116 |

Visible / occluded

| gold \ pred | visible | occluded |
|---|---:|---:|
| visible | 4047 | 436 |
| occluded | 47 | 482 |

Observer left / right

| gold \ pred | left | right |
|---|---:|---:|
| left | 1130 | 1121 |
| right | 1236 | 1173 |

Observer front / behind

| gold \ pred | front | behind |
|---|---:|---:|
| front | 1010 | 1264 |
| behind | 1088 | 1344 |

Facing toward / away

| gold \ pred | toward | away |
|---|---:|---:|
| toward | 435 | 0 |
| away | 438 | 0 |

## Reasoner inputs

- **Geometry oracle** (reference). Sees: Full scene geometry and the camera pose. Analytic ground truth: camera-space transforms and ray casts. A reference, not a model — it is correct by construction.
- **World-axis heuristic** (heuristic). Sees: World coordinates of object centres. No camera pose. Answers every question in the fixed world frame, as if the camera never left the canonical front view.
- **Image-plane heuristic** (heuristic). Sees: Amodal 2D bounding boxes in the image. No depth, no 3D. Reads relations straight off pixel positions: lower box = nearer, higher box = above, box overlap = occlusion. Answers observer-frame questions from the camera’s own view (egocentric bias).
- **Seeded coin flip** (chance). Sees: Nothing. Deterministic pseudo-random guess. The floor any reasoner must beat.
