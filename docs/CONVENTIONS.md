# EGOVERSA conventions

Every scored answer in EGOVERSA follows from the definitions on this page. The code that implements each
definition is named next to it.

## 1. Frames

**World frame W** (`src/scenes`). Right-handed, metres, `+Y_w` up, gravity along `−Y_w`. Fixed to the scene.
Object transforms are stored in W and never depend on the camera.

**Camera frame C** (`src/geometry/camera.ts`). Origin at the optical centre. `+x_c` right, `+y_c` up, the
camera looks along `−z_c` (the OpenGL / three.js convention). For a world point `p`:

```
p_c = ( r · (p − o),  u · (p − o),  −f · (p − o) )
```

where `o` is the camera position and `r`, `u`, `f` are the right, up and forward unit vectors in W:

```
f = normalize(focus − o)      r = normalize(f × Y_w)      u = r × f
```

**Viewer pose.** The viewer is an upright observer (roll = 0) orbiting the scene focus:

```
o = ( focus.x + d·sin(az),  h,  focus.z + d·cos(az) )
```

with azimuth `az`, eye height `h` and horizontal distance `d`. The vertical field of view is 50° and the
scored image is 4:3. At `az = 0` the camera sits on the `+Z_w` side and `x_c` coincides with `X_w`; this is
the *canonical* view. At `az = 180°`, `x_c = −X_w`. The camera x axis and the world x axis are therefore
different things everywhere except at one viewpoint, and the code never substitutes one for the other.

**Reference point.** Each object is represented by the centre of its world-space axis-aligned bounding box
(`SceneObject.center`).

## 2. Relations

Let `A` be the subject and `B` the reference, with camera-space reference points `(x, y, z)_A`, `(x, y, z)_B`.

| Relation | Quantity | Rule | Default tolerance |
|---|---|---|---|
| left / right | bearing `θ = atan2(x_c, −z_c)` | `A` left of `B` iff `θ_A < θ_B − τ_θ`; right iff `θ_A > θ_B + τ_θ` | `τ_θ = 4°` |
| closer / farther | range `ρ = ‖p_c‖` | closer iff `ρ_A < ρ_B − τ_ρ`; farther iff `ρ_A > ρ_B + τ_ρ` | `τ_ρ = 0.05 · mean(ρ_A, ρ_B)` |
| above / below | height in the upright viewer frame `y_v = Y_w − h` | above iff `y_A > y_B + τ_y`; below iff `y_A < y_B − τ_y` | `τ_y = 0.03 · mean(ρ_A, ρ_B)` |
| visible / occluded | unoccluded fraction `f` (section 3) | visible iff `f ≥ f_vis`; occluded iff `f ≤ f_occ` | `f_vis = 0.7`, `f_occ = 0.3` |

Notes on the choices:

- **Left/right uses bearing, not raw `x_c`.** Bearing order is exactly the left-to-right order of the points
  in the image and matches what a person means by "to the left of, from here". Raw `x_c` in metres can
  disagree with the picture when the two objects are at very different depths.
- **Closer/farther uses Euclidean range** from the optical centre, not optical depth `−z_c`.
- **Above/below is gravity-aligned.** For an upright viewer the "up" of the body is world up, so this
  relation does not change with azimuth. It is kept on purpose as a control: a reasoner that reads height
  from image rows will fail it under perspective, and a reasoner that ignores the camera will not.
- Implementation: `src/tasks/generator.ts`.

## 3. Visibility by ray casting

Implementation: `src/geometry/visibility.ts`, `src/geometry/raycast.ts`, `src/geometry/primitives.ts`.

For each object `O`:

1. Project the corners of every part's bounding box to normalised device coordinates and take the enclosing
   rectangle. If any corner is behind the near plane the object is not measurable from this view.
2. Lay a `20 × 20` grid of rays over that rectangle (cell centres). Each ray starts at the optical centre.
3. A ray that hits `O` when all other geometry is ignored belongs to the **amodal** silhouette.
4. An amodal ray inside the image frame is **visible** iff no other opaque primitive is hit before `O`
   (with a `1e-4` m margin).
5. `inFrame = inFrameRays / amodalRays`, `f = visibleRays / inFrameRays`.

Intersections are analytic and exact for the unit box, sphere (ellipsoid after scaling), capped cylinder and
capped cone under an arbitrary affine transform; the ray is mapped into the primitive's local frame without
re-normalising its direction, so the hit parameter is the world distance. The renderer tessellates the same
primitives with 40 segments.

Scope and limits:

- **Opaque geometry only.** There is no transparency, refraction or partial coverage.
- `f` is quantised by the grid: at most 400 rays per object, typically 150 to 300 on the silhouette.
- An object needs at least 12 amodal rays to be measured at all.
- Room walls are single-sided, inward-facing planes. They are back-face culled in the image and ignored by
  the oracle, consistently.

## 4. When a question is scored

Every unordered object pair yields one candidate per pair relation, and every object yields one visibility
candidate. A candidate gets exactly one status:

- **unaskable** (pair relations): either object is less than `80%` inside the frame, or less than `35%`
  unoccluded, or not measurable. The question could not be answered from the image alone, so asking it would
  test guessing.
- **unaskable** (visibility): the object is less than `80%` inside the frame (out of frame is not occlusion)
  or not measurable.
- **ambiguous**: the compared quantity differs by less than its tolerance, or `f_occ < f < f_vis`.
- **scored**: everything else. Only scored candidates have a gold label.

Subject/reference order is a seeded coin flip that depends on the scene fingerprint and never on the
viewpoint, so the same pair asks the same question from every camera. Up to `perRelation` scored questions
per relation and view are kept, by a seeded priority that is also viewpoint-independent.

The single "ambiguity tolerance" control multiplies `τ_θ`, `τ_ρ`, `τ_y` and the half-width of the visibility
band (`f_vis = 0.5 + 0.2·s`, `f_occ = 0.5 − 0.2·s`). The resulting share of ambiguous candidates is measured
and reported; it is not a target that is forced.

## 5. Determinism

- All randomness comes from `xmur3 → mulberry32` seeded with strings (`src/geometry/rng.ts`).
- A scene is a pure function of `SceneSpec = {env, seed, objectCount, occlusion, distractors, jitter}`.
- The scene **fingerprint** is an 8-hex digest of every object's name, position and yaw. Equal fingerprints
  mean identical worlds. Scenario import regenerates the scene and compares fingerprints.
- A batch is a pure function of `BatchConfig`. Scenario seeds are `<baseSeed>/<env>/<index>`; per-view camera
  jitter is seeded with `<scenarioSeed>|view|<shift>`.
- `Math.random` and the clock are used only to propose a new seed name when the user asks for one.

## 6. What a model may see

`src/evaluation/vlmAdapter.ts` defines the only path to an external model:

```ts
interface VlmRequest { image: string; question: string; options: [string, string] }
```

The image is the clean 4:3 viewer render (no axes, labels, outlines or gizmos). There is no field for
coordinates, seeds, poses, visibility fractions or gold labels, and the bundled proxy re-validates the
payload and drops anything else. The built-in heuristics are also restricted by type: the world-axis
heuristic receives only world centres (`WorldView`), the image-plane heuristic only amodal 2D boxes
(`ImageView`).

## 7. Observer frames, facing and two-view tasks (v0.2)

Implementation: `src/tasks/generator.ts` (oracle), `src/tasks/dataset.ts` (dataset items).

**Oriented objects.** An object with a defined front has a horizontal unit vector `f_O` in W: robots
(face, chest panel and feet point along local +Z) and seats. Their right vector is
`r_O = f_O × Y_w = (−f_z, 0, f_x)`.

**Observer left/right and front/behind.** For a subject A and observer O, let `d` be the horizontal
offset from O's centre to A's centre. Then:
```
φ = asin( r_O · d / ‖d‖ )     left iff φ < −τ_φ,   right iff φ > τ_φ
ψ = asin( f_O · d / ‖d‖ )     front iff ψ > τ_φ,   behind iff ψ < −τ_φ
```
with `τ_φ = 12°`. These are independent of the camera except through askability: both objects must be
visible enough in the image.

**Heading offset θ.** The angle in [0°, 180°] between the camera's horizontal heading and `f_O`. At
θ = 0° the observer looks the same way as the camera, so its left is the image's left. At θ = 180° it
faces the camera and left/right are mirrored. This is the axis on which perspective taking is analysed.

**Facing.** `α` is the angle between `f_O` and the horizontal direction from O to the camera:
- toward iff `α ≤ 90° − β`;
- away iff `α ≥ 90° + β`, with `β = 30°`;
- sideways in between, which is ambiguous.

**Abstention.** A camera or observer pair question whose subject or reference is in frame, measurable
and at most 3% unoccluded, while the other object is at least 50% visible. The answer is `unknown`.
Physical visibility (f) and knowability are kept separate: a partly hidden object is excluded, not
turned into an abstention.

**Camera motion (two views).** The second view's azimuth minus the first's, wrapped. Asked only for
25°–110°. Azimuth increases toward the camera's own +x, so a positive change is "right".

**Best view (two views).** Asked only when the object's unoccluded fraction differs by at least 0.4
between the views, and the object is at least 80% in frame in both.

## 8. EgoVersa-Sim (MuJoCo) conventions (v0.3)

Implementation: `research/egoversa_sim/` (`scene.py`, `oracle.py`, `questions.py`).

**World frame.** MuJoCo's: right-handed, metres, **+Z up**, gravity −Z. (The Three.js pipeline uses +Y up;
each pipeline's labels are computed in its own frame and never mixed.)

**Scenes.**
- A table (top at z = 0.75 m) with 6–9 free bodies, dropped from small heights; a share of them is
  spawned on top of others.
- They settle for 2.5 s at a 2 ms timestep (implicit-fast integrator), then all velocities are zeroed.
- Robots are static bodies standing on the table. Their face points along local +X, with a head camera
  pitched 25° down (vertical FOV 75°). They face the table centre within ±110°.
- Two objects can share a noun but never a full name. Object types `egg` and `plate` appear only in
  `test_ood`.

**Viewer camera.**
- Orbits the focus point (0, 0, 0.85) by azimuth: 0° puts the camera on the −Y side looking toward +Y.
- Upright (no roll); vertical FOV 50°; images are 512×384.
- Camera axes: +x right, +y up, the camera looks along −z (MuJoCo / OpenGL).

**Visibility.**
- f = modal / amodal pixel count.
- *Modal*: pixels of the object in a segmentation render of the full scene.
- *Amodal*: pixels of the object in a segmentation render where every other geom is hidden, using geom
  groups.
- Both renders use the same camera, so only in-frame pixels are counted.
- In-frame fraction comes from the projected bounding box of each geom's bounding sphere.
- An object needs at least 150 amodal pixels to be measurable. Opaque geometry only.

**Camera-frame relations.** Same rules and tolerances as section 2: bearing θ = atan2(x_c, −z_c) with
τ = 4°; range with τ = 5% of the mean range; height (world z) with τ = 3% of the mean range.

**Observer frame.**
- The robot's heading f is its body x axis projected on the floor; its right is r = f × ẑ.
- For the horizontal offset d from the robot to an object: φ = asin(r·d/‖d‖) (left < −12° < tie < 12° < right)
  and ψ = asin(f·d/‖d‖) (front/behind, same band).
- The heading offset θ ∈ [0°, 180°] is between f and the camera's horizontal forward direction.

**Facing.** α = angle between f and the horizontal direction from the robot to the camera: toward if
α ≤ 60°, away if α ≥ 120°, ambiguous between.

**Support.**
- The settled state's contacts are read with `mj_contactForce`.
- For each contact, the vertical component of the normal force says which body pushes which body up.
- "A rests on B" when the summed upward force from B on A is at least 20% of A's weight.
- The supporters can be the table, another object, or (it happens) a robot.

**Counterfactual removal.**
- Object B is moved 20 m away and held there; the scene is simulated for 1.2 s from rest.
- Each other object's displacement gives the label: **yes, it moves** if > 3 cm; **no** if < 1 cm;
  ambiguous in between (excluded).
- "No" questions are asked only about objects within 25 cm of B, so they are not trivially far away.
- Only objects are removable, never robots or the table.

**Imagery condition.**
- `obs_lateral_eye` repeats an `obs_lateral` question verbatim with a second image: the robot's own
  head-camera render.
- It is generated only when the object covers at least 400 pixels of that view, so the extra image
  really contains the answer.
- Every imagery item is selected together with its plain twin for a paired comparison.

**Determinism.**
- Seeds feed `numpy.random.default_rng`, and MuJoCo stepping is deterministic for a given build.
- Scene fingerprints hash every body's position and orientation after settling.
- Different MuJoCo versions or CPUs may settle differently, so fingerprints are recorded and the lock
  refuses mismatches.
