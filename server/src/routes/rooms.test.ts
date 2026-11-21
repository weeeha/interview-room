import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../index.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("rooms", () => {
  it("lists the room metadata in rooms/", async () => {
    const res = await createApp({}).request("/api/rooms");
    const body = (await res.json()) as { rooms: Array<{ id: string; splatPath: string; note?: string }> };
    const room = body.rooms.find((r) => r.id === "interview-office");
    expect(room?.splatPath).toBe("media/rooms/interview-office/room.spz");
    expect(room?.note).toMatch(/unmeasured/i);
  });

  it("serves room files from the media folder and 404s when missing or outside", async () => {
    const media = mkdtempSync(join(tmpdir(), "ir-media-"));
    dirs.push(media);
    mkdirSync(join(media, "rooms", "r1"), { recursive: true });
    writeFileSync(join(media, "rooms", "r1", "room.spz"), "splat-bytes");
    writeFileSync(join(media, "secret.txt"), "no");
    const app = createApp({}, { mediaDir: media });
    const ok = await app.request("/media/rooms/r1/room.spz");
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("splat-bytes");
    expect((await app.request("/media/rooms/r1/missing.spz")).status).toBe(404);
    expect((await app.request("/media/rooms/..%2Fsecret.txt")).status).toBe(404);
    expect((await app.request("/media/rooms/")).status).toBe(404);
  });
});
