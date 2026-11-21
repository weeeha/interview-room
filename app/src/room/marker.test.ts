import { describe, expect, it } from "vitest";
import { markerLook, MARKER_BASE_OPACITY, MARKER_BASE_SCALE, MARKER_PEAK_SCALE } from "./marker";

describe("marker look", () => {
  it("test_marker_follows_level", () => {
    expect(markerLook(0)).toEqual({ scale: MARKER_BASE_SCALE, opacity: MARKER_BASE_OPACITY });
    expect(markerLook(1)).toEqual({ scale: MARKER_PEAK_SCALE, opacity: 1 });
    expect(markerLook(0.5).scale).toBeGreaterThan(markerLook(0.2).scale);
  });
  it("test_marker_clamps_bad_levels", () => {
    expect(markerLook(5)).toEqual(markerLook(1));
    expect(markerLook(-1)).toEqual(markerLook(0));
    expect(markerLook(NaN)).toEqual(markerLook(0));
  });
});
