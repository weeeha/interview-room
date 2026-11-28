import { describe, expect, it, vi } from "vitest";
import { enterVr, enterVrVisible, exitVr, isXrSupported, rigPlacement, xrActive, yawPitchFromForward, type XrHost } from "./xr";
import { forwardVector } from "./spatialMath";

describe("isXrSupported", () => {
  it("test_false_when_xr_missing", async () => {
    expect(await isXrSupported({})).toBe(false);
    expect(await isXrSupported(undefined)).toBe(false);
  });
  it("test_false_when_xr_throws_or_rejects", async () => {
    const thrower = { xr: { isSessionSupported: () => { throw new Error("no"); } } };
    const rejecter = { xr: { isSessionSupported: () => Promise.reject(new Error("no")) } };
    expect(await isXrSupported(thrower)).toBe(false);
    expect(await isXrSupported(rejecter)).toBe(false);
  });
  it("test_true_only_for_immersive_vr_support", async () => {
    const fn = vi.fn(async (m: string) => m === "immersive-vr");
    expect(await isXrSupported({ xr: { isSessionSupported: fn } })).toBe(true);
    expect(fn).toHaveBeenCalledWith("immersive-vr");
    expect(await isXrSupported({ xr: { isSessionSupported: async () => false } })).toBe(false);
  });
});

describe("button condition", () => {
  const ok = { supported: true, mode: "room" as const, roomReady: true, micOk: true };
  it("test_visible_only_when_all_hold", () => {
    expect(enterVrVisible(ok)).toBe(true);
    expect(enterVrVisible({ ...ok, supported: false })).toBe(false);
    expect(enterVrVisible({ ...ok, mode: "flat" })).toBe(false);
    expect(enterVrVisible({ ...ok, roomReady: false })).toBe(false);
    expect(enterVrVisible({ ...ok, micOk: false })).toBe(false);
  });
});

describe("rig math", () => {
  const seat = { position: [1, 1.2, -2] as [number, number, number], yawDeg: 90 };
  it("test_local_puts_head_at_seat", () => {
    const p = rigPlacement(seat, "local");
    expect(p.position).toEqual([1, 1.2, -2]);
    expect(p.yawRad).toBeCloseTo(Math.PI / 2);
  });
  it("test_local_floor_drops_by_eye_height", () => {
    expect(rigPlacement(seat, "local-floor", 1.1).position[1]).toBeCloseTo(0.1);
  });
  it("test_yaw_pitch_round_trips_forward_vector", () => {
    for (const [y, p] of [[0, 0], [30, 10], [-45, -20], [170, 5]] as const) {
      const r = yawPitchFromForward(forwardVector(y, p));
      expect(r.yawDeg).toBeCloseTo(y);
      expect(r.pitchDeg).toBeCloseTo(p);
    }
  });
});

function fakes() {
  const log: string[] = [];
  let endCb: (() => void) | null = null;
  const session = {
    end: vi.fn(async () => {
      log.push("session.end");
      endCb?.();
    }),
    addEventListener: (_t: "end", cb: () => void) => {
      log.push("listen");
      endCb = cb;
    },
  };
  const host: XrHost = {
    renderer: {
      xr: {
        enabled: false,
        setReferenceSpaceType: (t) => log.push(`refspace:${t}`),
        setSession: async () => {
          log.push("setSession");
        },
      },
    },
    seat: { position: [0, 1.2, 0], yawDeg: 0 },
    setRig: (p) => log.push(p ? "rig:on" : "rig:off"),
  };
  const nav = {
    xr: {
      requestSession: async (mode: string) => {
        log.push(`request:${mode}`);
        return session;
      },
    },
  };
  return { log, host, nav, session };
}

describe("enter and exit order", () => {
  it("test_enter_then_exit_calls_in_order", async () => {
    const { log, host, nav } = fakes();
    const onEnd = vi.fn();
    await enterVr(host, { nav, onEnd });
    expect(xrActive()).toBe(true);
    expect(host.renderer.xr.enabled).toBe(true);
    expect(log).toEqual(["refspace:local", "request:immersive-vr", "rig:on", "listen", "setSession"]);
    await exitVr();
    expect(log.slice(5)).toEqual(["session.end", "rig:off"]);
    expect(host.renderer.xr.enabled).toBe(false);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(xrActive()).toBe(false);
  });
  it("test_failed_request_leaves_xr_off", async () => {
    const { host, log } = fakes();
    const nav = { xr: { requestSession: async () => { throw new Error("denied"); } } };
    await expect(enterVr(host, { nav })).rejects.toThrow("denied");
    expect(host.renderer.xr.enabled).toBe(false);
    expect(log).not.toContain("rig:on");
    expect(xrActive()).toBe(false);
  });
  it("test_headset_end_event_restores_view", async () => {
    const { host, log, nav, session } = fakes();
    await enterVr(host, { nav });
    await session.end();
    expect(log.at(-1)).toBe("rig:off");
    expect(xrActive()).toBe(false);
  });
});
