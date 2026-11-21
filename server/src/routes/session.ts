import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { Hono } from "hono";
import { HttpError, parsePrev, parseTurnMeta, type CreateSessionInput, type SessionService, type TurnLine } from "../session.ts";

export type ClientConfig = { silencePromptSec: number; silenceOfferSec: number; endOfSpeechMs: number };

function num(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return v !== undefined && v !== "" && Number.isFinite(n) && n > 0 ? n : fallback;
}

export function clientConfig(env: NodeJS.ProcessEnv): ClientConfig {
  return {
    silencePromptSec: num(env.SILENCE_PROMPT_SEC, 8),
    silenceOfferSec: num(env.SILENCE_OFFER_SEC, 12),
    endOfSpeechMs: num(env.END_OF_SPEECH_MS, 1200),
  };
}

export function sessionRoutes(service: SessionService, env: NodeJS.ProcessEnv): Hono {
  const app = new Hono();

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.message }, err.status);
    return c.json({ error: err instanceof Error ? err.message : "Server error" }, 500);
  });

  app.get("/api/config", (c) => c.json(clientConfig(env)));

  app.post("/api/session", async (c) => {
    let body: Partial<CreateSessionInput>;
    try {
      body = (await c.req.json()) as Partial<CreateSessionInput>;
    } catch {
      throw new HttpError(400, "Body must be JSON");
    }
    if (!body || typeof body.bankId !== "string" || typeof body.profileId !== "string") {
      throw new HttpError(400, "bankId and profileId are required");
    }
    const session = await service.create({
      roomId: typeof body.roomId === "string" ? body.roomId : "interview-office",
      bankId: body.bankId,
      profileId: body.profileId,
      targetDurationSec: typeof body.targetDurationSec === "number" ? body.targetDurationSec : undefined,
      roleContext: typeof body.roleContext === "string" ? body.roleContext : undefined,
    });
    return c.json({ session });
  });

  app.get("/api/sessions", async (c) => c.json({ sessions: await service.list() }));

  app.get("/api/session/:id", async (c) => c.json(await service.get(c.req.param("id"))));

  app.post("/api/session/:id/end", async (c) => {
    let prev;
    try {
      const body = (await c.req.json()) as { prev?: Record<string, unknown> } | null;
      if (body?.prev && typeof body.prev === "object") prev = parsePrev(body.prev);
    } catch (e) {
      if (e instanceof HttpError) throw e;
    }
    await service.end(c.req.param("id"), prev);
    return c.json({ ok: true });
  });

  app.get("/api/session/:id/audio/:file", (c) => {
    const path = service.audioPath(c.req.param("id"), c.req.param("file"));
    if (!path) return c.json({ error: "Not found" }, 404);
    const body = Readable.toWeb(createReadStream(path)) as unknown as ReadableStream;
    return new Response(body, { headers: { "content-type": "audio/wav", "cache-control": "no-store" } });
  });

  app.post("/api/session/:id/turn", async (c) => {
    const id = c.req.param("id");
    let form: FormData;
    try {
      form = await c.req.formData();
    } catch {
      throw new HttpError(400, "Body must be multipart form data");
    }
    const meta = parseTurnMeta(form.get("meta"));
    const audio = form.get("audio");
    let wav: Buffer | undefined;
    if (audio && typeof audio !== "string") wav = Buffer.from(await (audio as File).arrayBuffer());
    if (meta.kind !== "answer") wav = undefined;
    await service.checkTurn(id, meta, wav);

    const ac = new AbortController();
    const raw = c.req.raw.signal;
    if (raw.aborted) ac.abort();
    else raw.addEventListener("abort", () => ac.abort(), { once: true });

    const enc = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let open = true;
        const emit = (line: TurnLine) => {
          if (!open) return;
          try {
            controller.enqueue(enc.encode(`${JSON.stringify(line)}\n`));
          } catch {
            open = false;
          }
        };
        const close = () => {
          if (!open) return;
          open = false;
          try {
            controller.close();
          } catch {
            // already closed
          }
        };
        service
          .runTurn(id, meta, wav, ac.signal, emit)
          .catch((e) => emit({ type: "error", stage: "llm", message: e instanceof Error ? e.message : String(e) }))
          .finally(close);
      },
      cancel() {
        ac.abort();
      },
    });
    return new Response(stream, {
      headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" },
    });
  });

  return app;
}
