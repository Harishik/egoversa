/**
 * Viewer camera model and reference frames.  See docs/CONVENTIONS.md.
 *
 * WORLD frame  W : right-handed, metres, +Y up (gravity is -Y). Fixed to the scene.
 * CAMERA frame C : origin at the optical centre, +x_c right, +y_c up, the camera
 *                  looks along -z_c (OpenGL / three.js convention).
 *
 * The viewer is an upright observer (roll = 0) orbiting a scene focus point:
 *   position = focus + (d sin(az), ., d cos(az)),  y = eye height.
 * At azimuth 0 the camera sits on the +Z_w side looking toward -Z_w, and its
 * x_c axis coincides with the world X_w axis. That is the "canonical" view in
 * which a world-axis shortcut happens to agree with the viewer.
 */
import type { Vec3 } from './types';

export interface ViewerPose {
  /** Orbit angle about the world up axis, degrees. 0 = canonical front view. */
  azimuthDeg: number;
  /** Eye height above the floor (world y), metres. */
  height: number;
  /** Horizontal distance from the scene focus, metres. */
  distance: number;
}

export const VIEWER_FOV_DEG = 50; // vertical field of view
export const VIEWER_ASPECT = 4 / 3;
export const VIEWER_NEAR = 0.05;

export interface CameraFrame {
  position: Vec3;
  right: Vec3; // +x_c in world coordinates
  up: Vec3; // +y_c in world coordinates
  forward: Vec3; // -z_c in world coordinates
  tanHalfFov: number;
  aspect: number;
}

export function viewerPosition(pose: ViewerPose, focus: Vec3): Vec3 {
  const az = (pose.azimuthDeg * Math.PI) / 180;
  return [focus[0] + pose.distance * Math.sin(az), pose.height, focus[2] + pose.distance * Math.cos(az)];
}

function norm(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export function cameraFrame(pose: ViewerPose, focus: Vec3, fovDeg = VIEWER_FOV_DEG, aspect = VIEWER_ASPECT): CameraFrame {
  const position = viewerPosition(pose, focus);
  const forward = norm([focus[0] - position[0], focus[1] - position[1], focus[2] - position[2]]);
  const right = norm(cross(forward, [0, 1, 0]));
  const up = cross(right, forward);
  return { position, right, up, forward, tanHalfFov: Math.tan((fovDeg * Math.PI) / 360), aspect };
}

export interface CameraMetrics {
  /** Camera-space coordinates, metres. z_c is negative in front of the camera. */
  xc: number;
  yc: number;
  zc: number;
  /** Optical depth = -z_c. */
  depth: number;
  /** Euclidean distance from the optical centre. */
  range: number;
  /** Bearing about the camera's up axis: atan2(x_c, -z_c), degrees. Negative = left. */
  azimuthDeg: number;
  /** Normalised device coordinates in [-1, 1] when inside the frame. */
  ndcX: number;
  ndcY: number;
  inFrustum: boolean;
}

export function toCamera(frame: CameraFrame, p: Vec3): Vec3 {
  const dx = p[0] - frame.position[0];
  const dy = p[1] - frame.position[1];
  const dz = p[2] - frame.position[2];
  return [
    frame.right[0] * dx + frame.right[1] * dy + frame.right[2] * dz,
    frame.up[0] * dx + frame.up[1] * dy + frame.up[2] * dz,
    -(frame.forward[0] * dx + frame.forward[1] * dy + frame.forward[2] * dz),
  ];
}

export function cameraMetrics(frame: CameraFrame, p: Vec3): CameraMetrics {
  const [xc, yc, zc] = toCamera(frame, p);
  const depth = -zc;
  const range = Math.hypot(xc, yc, zc);
  const azimuthDeg = (Math.atan2(xc, depth) * 180) / Math.PI;
  const ndcX = depth > 0 ? xc / (depth * frame.tanHalfFov * frame.aspect) : NaN;
  const ndcY = depth > 0 ? yc / (depth * frame.tanHalfFov) : NaN;
  const inFrustum = depth > VIEWER_NEAR && Math.abs(ndcX) <= 1 && Math.abs(ndcY) <= 1;
  return { xc, yc, zc, depth, range, azimuthDeg, ndcX, ndcY, inFrustum };
}

/** Wrap an angle to (-180, 180]. */
export function wrapDeg(a: number): number {
  let x = ((a + 180) % 360 + 360) % 360 - 180;
  if (x === -180) x = 180;
  return x;
}
