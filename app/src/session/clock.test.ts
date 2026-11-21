import { describe, expect, it } from "vitest";
import { sessionStartOnPerfClock } from "./clock.ts";

describe("sessionStartOnPerfClock", () => {
  it("puts time zero at the session's startedAt, so elapsed time counts from it", () => {
    const startedAt = "2026-01-01T10:00:00.000Z";
    const wall = Date.parse(startedAt) + 4200;
    const start = sessionStartOnPerfClock(10_000, wall, startedAt);
    expect(10_000 - start).toBe(4200);
  });
  it("falls back to now when startedAt is unreadable or in the future", () => {
    expect(sessionStartOnPerfClock(500, 1000, "nope")).toBe(500);
    expect(sessionStartOnPerfClock(500, 1000, new Date(5000).toISOString())).toBe(500);
  });
});
