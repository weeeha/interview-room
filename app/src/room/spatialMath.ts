// Direction math for the interviewer voice. Pure. Same axes as seatCamera: yaw 0 looks down -Z,
// positive yaw turns left, Y is up.
import { degToRad } from "./seatCamera";

type V3 = [number, number, number];

/** Unit vector the camera faces. */
export function forwardVector(yawDeg: number, pitchDeg: number): V3 {
  const y = degToRad(yawDeg);
  const p = degToRad(pitchDeg);
  return [-Math.sin(y) * Math.cos(p), Math.sin(p), -Math.cos(y) * Math.cos(p)];
}

/** Unit vector to the camera's right (horizontal). */
export function rightVector(yawDeg: number): V3 {
  const y = degToRad(yawDeg);
  return [Math.cos(y), 0, -Math.sin(y)];
}

/**
 * Where the anchor sits relative to the view, horizontally.
 * azimuthDeg: 0 straight ahead, positive to the right, negative to the left, +-180 behind.
 * panSide: sin(azimuth), -1 hard left to +1 hard right. Positive means the voice is on the right.
 */
export function anchorDirection(
  seatPos: V3,
  anchor: V3,
  cameraYawDeg: number,
): { azimuthDeg: number; panSide: number; distance: number } {
  const dx = anchor[0] - seatPos[0];
  const dy = anchor[1] - seatPos[1];
  const dz = anchor[2] - seatPos[2];
  const r = rightVector(cameraYawDeg);
  const f = forwardVector(cameraYawDeg, 0);
  const right = dx * r[0] + dz * r[2];
  const ahead = dx * f[0] + dz * f[2];
  const azimuth = (Math.atan2(right, ahead) * 180) / Math.PI;
  const flat = Math.hypot(right, ahead);
  return { azimuthDeg: azimuth, panSide: flat > 0 ? right / flat : 0, distance: Math.hypot(dx, dy, dz) };
}

/** Yaw (degrees) that faces the anchor, so a test can turn the view to centre the voice. */
export function yawFacing(seatPos: V3, anchor: V3): number {
  const dx = anchor[0] - seatPos[0];
  const dz = anchor[2] - seatPos[2];
  return (Math.atan2(-dx, -dz) * 180) / Math.PI;
}
