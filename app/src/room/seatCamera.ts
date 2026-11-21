// Seat camera math. Pure, no three.js. The camera sits at the seat and only turns.
// Angles are degrees. Yaw 0 looks down -Z (the three.js default). A positive yaw turns the view
// to the left (counterclockwise seen from above), the same sign as three.js rotation.y.

export type Seat = { position: [number, number, number]; yawDeg: number; lookLimitDeg: number };

export const PITCH_LIMIT_DEG = 30;
/** Radians of turn per pixel of pointer drag. */
export const DRAG_RAD_PER_PX = 0.004;
/** Degrees per arrow key press. */
export const KEY_STEP_DEG = 10;
/** Eased keyboard turn speed in degrees per second (not used with reduced motion). */
export const KEY_EASE_PER_SEC = 8;

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
export const degToRad = (d: number) => (d * Math.PI) / 180;
export const radToDeg = (r: number) => (r * 180) / Math.PI;

export type SeatCamera = {
  /** Never changes. */
  readonly position: [number, number, number];
  yawDeg(): number;
  pitchDeg(): number;
  /** Pointer drag in pixels. Dragging right turns the view right, dragging down looks up. */
  drag(dxPx: number, dyPx: number): void;
  /** Arrow key turn. Eased unless reduced motion is on. */
  key(dir: "left" | "right" | "up" | "down"): void;
  /** Advance eased motion by dtMs. */
  step(dtMs: number): void;
};

export function createSeatCamera(seat: Seat, opts: { reducedMotion?: boolean } = {}): SeatCamera {
  const position: [number, number, number] = [seat.position[0], seat.position[1], seat.position[2]];
  const yawMin = seat.yawDeg - seat.lookLimitDeg;
  const yawMax = seat.yawDeg + seat.lookLimitDeg;
  let yaw = seat.yawDeg;
  let pitch = 0;
  let targetYaw = yaw;
  let targetPitch = pitch;
  const reduced = !!opts.reducedMotion;
  const clampYaw = (v: number) => clamp(v, yawMin, yawMax);
  const clampPitch = (v: number) => clamp(v, -PITCH_LIMIT_DEG, PITCH_LIMIT_DEG);

  return {
    position,
    yawDeg: () => yaw,
    pitchDeg: () => pitch,
    drag(dx, dy) {
      yaw = clampYaw(yaw - radToDeg(dx * DRAG_RAD_PER_PX));
      pitch = clampPitch(pitch - radToDeg(dy * DRAG_RAD_PER_PX));
      targetYaw = yaw;
      targetPitch = pitch;
    },
    key(dir) {
      // Left arrow turns the view left, which is a positive yaw.
      if (dir === "left") targetYaw = clampYaw(targetYaw + KEY_STEP_DEG);
      if (dir === "right") targetYaw = clampYaw(targetYaw - KEY_STEP_DEG);
      if (dir === "up") targetPitch = clampPitch(targetPitch + KEY_STEP_DEG);
      if (dir === "down") targetPitch = clampPitch(targetPitch - KEY_STEP_DEG);
      if (reduced) {
        yaw = targetYaw;
        pitch = targetPitch;
      }
    },
    step(dtMs) {
      if (reduced) return;
      // Exponential ease toward the target.
      const k = 1 - Math.exp(-KEY_EASE_PER_SEC * (dtMs / 1000));
      yaw += (targetYaw - yaw) * k;
      pitch += (targetPitch - pitch) * k;
      if (Math.abs(targetYaw - yaw) < 0.01) yaw = targetYaw;
      if (Math.abs(targetPitch - pitch) < 0.01) pitch = targetPitch;
    },
  };
}

/** 10 second rolling frame rate. Feed it one timestamp (ms) per rendered frame. */
export function createFpsMeter(windowMs = 10_000) {
  const stamps: number[] = [];
  return {
    frame(nowMs: number) {
      stamps.push(nowMs);
      while (stamps.length > 1 && nowMs - (stamps[0] as number) > windowMs) stamps.shift();
    },
    fps(): number {
      if (stamps.length < 2) return 0;
      const span = ((stamps[stamps.length - 1] as number) - (stamps[0] as number)) / 1000;
      return span > 0 ? (stamps.length - 1) / span : 0;
    },
    reset() {
      stamps.length = 0;
    },
  };
}
