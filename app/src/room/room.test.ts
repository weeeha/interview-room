import { describe, expect, it } from "vitest";
import { createFpsMeter, createSeatCamera } from "./seatCamera";
import { anchorDirection, forwardVector, yawFacing } from "./spatialMath";
import { splatTransform } from "./sceneTransform";
import { fetchSplatBytes, SceneLoadError, withLoadTimeout } from "./fetchSplat";

const seat = { position: [0, 1.2, 0] as [number, number, number], yawDeg: 10, lookLimitDeg: 60 };

describe("seat camera", () => {
  it("test_seat_starts_at_seat_yaw", () => {
    const c = createSeatCamera(seat);
    expect(c.yawDeg()).toBe(10);
    expect(c.pitchDeg()).toBe(0);
  });
  it("test_seat_drag_stops_at_limits", () => {
    const c = createSeatCamera(seat);
    c.drag(-100000, 100000);
    expect(c.yawDeg()).toBeCloseTo(70);
    expect(c.pitchDeg()).toBeCloseTo(-30);
    c.drag(100000, -100000);
    expect(c.yawDeg()).toBeCloseTo(-50);
    expect(c.pitchDeg()).toBeCloseTo(30);
  });
  it("test_seat_position_never_changes", () => {
    const c = createSeatCamera(seat);
    c.drag(300, -40);
    c.key("left");
    c.step(500);
    expect(c.position).toEqual([0, 1.2, 0]);
  });
  it("test_drag_right_turns_view_right", () => {
    const c = createSeatCamera(seat);
    c.drag(50, 0);
    expect(c.yawDeg()).toBeLessThan(10);
  });
  it("test_keyboard_eases_and_respects_limit", () => {
    const c = createSeatCamera(seat);
    c.key("left");
    expect(c.yawDeg()).toBe(10);
    c.step(100);
    expect(c.yawDeg()).toBeGreaterThan(10);
    for (let i = 0; i < 20; i++) c.key("left");
    for (let i = 0; i < 100; i++) c.step(100);
    expect(c.yawDeg()).toBeCloseTo(70);
  });
  it("test_reduced_motion_has_no_easing", () => {
    const c = createSeatCamera(seat, { reducedMotion: true });
    c.key("right");
    expect(c.yawDeg()).toBe(0);
    c.step(16);
    expect(c.yawDeg()).toBe(0);
  });
});

describe("fps meter", () => {
  it("test_fps_rolling_average", () => {
    const m = createFpsMeter();
    for (let i = 0; i <= 600; i++) m.frame(i * 20); // 50 fps for 12 s
    expect(m.fps()).toBeCloseTo(50, 0);
  });
});

describe("spatial direction", () => {
  const s: [number, number, number] = [0, 1.2, 0];
  it("test_anchor_right_of_view_is_positive_pan", () => {
    const d = anchorDirection(s, [1.5, 1.2, -2], 0);
    expect(d.panSide).toBeGreaterThan(0.5);
    expect(d.azimuthDeg).toBeGreaterThan(0);
  });
  it("test_anchor_left_of_view_is_negative_pan", () => {
    expect(anchorDirection(s, [-1.5, 1.2, -2], 0).panSide).toBeLessThan(-0.5);
  });
  it("test_turning_to_face_anchor_centres_it", () => {
    const a: [number, number, number] = [1.5, 1.2, -2];
    const yaw = yawFacing(s, a);
    expect(yaw).toBeLessThan(0); // turning right is a negative yaw
    const d = anchorDirection(s, a, yaw);
    expect(d.panSide).toBeCloseTo(0, 5);
    expect(d.azimuthDeg).toBeCloseTo(0, 5);
  });
  it("test_turning_past_anchor_flips_side", () => {
    const a: [number, number, number] = [1.5, 1.2, -2];
    expect(anchorDirection(s, a, -80).panSide).toBeLessThan(0);
  });
  it("test_forward_vector", () => {
    const f = forwardVector(0, 0);
    expect(f[2]).toBeCloseTo(-1);
    const l = forwardVector(90, 0);
    expect(l[0]).toBeCloseTo(-1); // positive yaw faces -X, the left
  });
});

describe("scene transform", () => {
  it("test_marble_convention_flips_180_about_x", () => {
    const t = splatTransform({ coordinateConvention: "marble_raw_opencv" });
    expect(t.rotateXRad).toBeCloseTo(Math.PI);
    expect(t.scale).toBe(1);
    expect(t.positionY).toBeCloseTo(0);
  });
  it("test_scale_and_ground_offset_applied", () => {
    const t = splatTransform({ coordinateConvention: "marble_raw_opencv", metricScaleFactor: 2.5, groundPlaneOffset: 0.3 });
    expect(t.scale).toBe(2.5);
    expect(t.positionY).toBeCloseTo(-0.3);
  });
  it("test_override_skips_flip", () => {
    expect(splatTransform({ coordinateConvention: "marble_raw_opencv" }, { flip: false }).rotateXRad).toBe(0);
  });
});

describe("fetch splat", () => {
  const stream = (chunks: Uint8Array[]) =>
    new ReadableStream<Uint8Array>({
      start(c) {
        chunks.forEach((x) => c.enqueue(x));
        c.close();
      },
    });
  it("test_missing_file_is_clean_error", async () => {
    const f = (async () => new Response("nope", { status: 404 })) as typeof fetch;
    await expect(fetchSplatBytes("/x.spz", { fetchImpl: f })).rejects.toMatchObject({ kind: "missing" });
  });
  it("test_html_fallback_is_missing", async () => {
    const f = (async () => new Response("<html>", { status: 200, headers: { "content-type": "text/html" } })) as typeof fetch;
    await expect(fetchSplatBytes("/x.spz", { fetchImpl: f })).rejects.toBeInstanceOf(SceneLoadError);
  });
  it("test_progress_reports_fraction_and_bytes", async () => {
    const seen: Array<number | null> = [];
    const f = (async () =>
      new Response(stream([new Uint8Array(40), new Uint8Array(60)]), { headers: { "content-length": "100" } })) as typeof fetch;
    const out = await fetchSplatBytes("/x.spz", { fetchImpl: f, onProgress: (p) => seen.push(p) });
    expect(out.byteLength).toBe(100);
    expect(seen).toEqual([0, 0.4, 1, 1]);
  });
  it("test_progress_null_when_size_unknown", async () => {
    const seen: Array<number | null> = [];
    const f = (async () => new Response(stream([new Uint8Array(5)]))) as typeof fetch;
    await fetchSplatBytes("/x.spz", { fetchImpl: f, onProgress: (p) => seen.push(p) });
    expect(seen[0]).toBeNull();
  });
  it("test_timeout_rejects", async () => {
    await expect(withLoadTimeout(() => new Promise(() => {}), { timeoutMs: 20 })).rejects.toMatchObject({ kind: "timeout" });
  });
  it("test_abort_rejects", async () => {
    const ctl = new AbortController();
    const p = withLoadTimeout(() => new Promise(() => {}), { signal: ctl.signal, timeoutMs: 5000 });
    ctl.abort();
    await expect(p).rejects.toMatchObject({ kind: "aborted" });
  });
});
