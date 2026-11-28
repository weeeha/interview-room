// Enter VR for the room view. Small, behind feature detection, and never imported by the normal
// screen path except through a dynamic import. Not tested on a headset (see docs/quest-notes.md).
//
// Reference space: "local". The spike and the room records give the seat as an eye position, so the
// head should start at the seat. With "local" the origin is the headset position when the session
// starts, so a seated user is already at seat height and no floor offset is needed. "local-floor"
// (the three.js default) would put the origin at the real floor, and the user's real eye height and
// the room's seat height would then have to be reconciled. A seated session also never needs the floor.
// If a Quest does not honour "local" the session request fails and we report that instead of falling back.
import { degToRad, radToDeg } from "./seatCamera";

type V3 = [number, number, number];

export type XrRefSpace = "local" | "local-floor";

/** Where the rig (the group the camera lives in) goes so the head sits at the seat. */
export type RigPlacement = { position: V3; yawRad: number };

/**
 * Rig math. With "local" the head starts at the origin, so the rig sits at the seat. With "local-floor"
 * the head starts at eyeHeightM above the origin, so the rig drops by that much. Yaw turns the rig so the
 * starting gaze faces the seat direction.
 */
export function rigPlacement(
  seat: { position: V3; yawDeg: number },
  refSpace: XrRefSpace = "local",
  eyeHeightM = 0,
): RigPlacement {
  const drop = refSpace === "local-floor" ? eyeHeightM : 0;
  return {
    position: [seat.position[0], seat.position[1] - drop, seat.position[2]],
    yawRad: degToRad(seat.yawDeg),
  };
}

/** Yaw and pitch in degrees (seatCamera convention) from a world forward vector. */
export function yawPitchFromForward(f: V3): { yawDeg: number; pitchDeg: number } {
  const len = Math.hypot(f[0], f[1], f[2]) || 1;
  return {
    yawDeg: radToDeg(Math.atan2(-f[0], -f[2])),
    pitchDeg: radToDeg(Math.asin(Math.max(-1, Math.min(1, f[1] / len)))),
  };
}

/** The button shows only when the browser can do immersive VR, the room is the backdrop, and the mic is already on. */
export function enterVrVisible(s: { supported: boolean; mode: "room" | "flat"; roomReady: boolean; micOk: boolean }): boolean {
  return s.supported && s.mode === "room" && s.roomReady && s.micOk;
}

type XrNavigator = {
  xr?: {
    isSessionSupported?: (mode: string) => Promise<boolean>;
    requestSession?: (mode: string, init?: object) => Promise<XrSessionLike>;
  };
};

export type XrSessionLike = {
  end(): Promise<void>;
  addEventListener(type: "end", cb: () => void): void;
};

export async function isXrSupported(nav: XrNavigator | undefined = typeof navigator === "undefined" ? undefined : (navigator as XrNavigator)): Promise<boolean> {
  try {
    const xr = nav?.xr;
    if (!xr || typeof xr.isSessionSupported !== "function") return false;
    return (await xr.isSessionSupported("immersive-vr")) === true;
  } catch {
    return false;
  }
}

/** What RoomView hands out. Everything XR needs, nothing else. */
export type XrHost = {
  renderer: {
    xr: {
      enabled: boolean;
      setReferenceSpaceType(t: XrRefSpace): void;
      setSession(s: XrSessionLike): Promise<void>;
    };
  };
  seat: { position: V3; yawDeg: number };
  /** Move the camera into a rig at the placement (true) or back to the seat (false). Also stops pointer and key look. */
  setRig(p: RigPlacement | null): void;
};

export type EnterVrOptions = { nav?: XrNavigator; onEnd?: () => void };

let active: { session: XrSessionLike; finish: () => void } | null = null;

export function xrActive(): boolean {
  return active !== null;
}

export async function enterVr(host: XrHost, opts: EnterVrOptions = {}): Promise<void> {
  if (active) return;
  const nav = opts.nav ?? (navigator as XrNavigator);
  const request = nav.xr?.requestSession;
  if (!nav.xr || typeof request !== "function") throw new Error("WebXR is not available in this browser");
  const xr = host.renderer.xr;
  xr.enabled = true;
  xr.setReferenceSpaceType("local");
  let session: XrSessionLike;
  try {
    // No optional features: no hand tracking, no layers, no DOM overlay. Seated, look only.
    session = await request.call(nav.xr, "immersive-vr", {});
  } catch (e) {
    xr.enabled = false;
    throw e;
  }
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    active = null;
    host.setRig(null);
    xr.enabled = false;
    opts.onEnd?.();
  };
  active = { session, finish };
  host.setRig(rigPlacement(host.seat, "local"));
  session.addEventListener("end", finish);
  try {
    await xr.setSession(session);
  } catch (e) {
    finish();
    try {
      await session.end();
    } catch {
      // already ended
    }
    throw e;
  }
}

export async function exitVr(): Promise<void> {
  const a = active;
  if (!a) return;
  try {
    await a.session.end();
  } finally {
    a.finish();
  }
}
