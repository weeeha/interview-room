import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { Hono } from "hono";
import type { Room } from "../../../shared/types.ts";
import { createLogger } from "../log.ts";

const log = createLogger("rooms");

const TYPES: Record<string, string> = {
  ".spz": "application/octet-stream",
  ".ply": "application/octet-stream",
  ".splat": "application/octet-stream",
  ".glb": "model/gltf-binary",
  ".json": "application/json",
  ".jpg": "image/jpeg",
  ".png": "image/png",
};

export function listRooms(dir: string): Room[] {
  let names: string[];
  try {
    names = readdirSync(dir).filter((n) => n.endsWith(".json")).sort();
  } catch {
    return [];
  }
  const rooms: Room[] = [];
  for (const n of names) {
    try {
      rooms.push(JSON.parse(readFileSync(join(dir, n), "utf8")) as Room);
    } catch {
      log.warn(`Skipped unreadable room file ${n}`);
    }
  }
  return rooms;
}

/** Rooms list plus a static route for room files under <media>/rooms. 404 when a file is missing. */
export function roomsRoutes(env: NodeJS.ProcessEnv, dirs?: { roomsDir?: string; mediaDir?: string }): Hono {
  const app = new Hono();
  const roomsDir = resolve(dirs?.roomsDir ?? env.ROOMS_DIR ?? "./rooms");
  const root = resolve(dirs?.mediaDir ?? env.MEDIA_DIR ?? "./media", "rooms");

  app.get("/api/rooms", (c) => c.json({ rooms: listRooms(roomsDir) }));

  app.get("/media/rooms/*", (c) => {
    let rel: string;
    try {
      rel = decodeURIComponent(c.req.path.slice("/media/rooms/".length));
    } catch {
      return c.json({ error: "Not found" }, 404);
    }
    const file = resolve(root, rel);
    if (!rel || rel.includes("\0") || !file.startsWith(root + sep) || !existsSync(file) || !statSync(file).isFile()) {
      return c.json({ error: "Not found" }, 404);
    }
    const body = Readable.toWeb(createReadStream(file)) as unknown as ReadableStream;
    return new Response(body, {
      headers: {
        "content-type": TYPES[extname(file).toLowerCase()] ?? "application/octet-stream",
        "content-length": String(statSync(file).size),
      },
    });
  });
  return app;
}
