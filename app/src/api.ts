// Browser client for the local server. The shapes follow the HTTP API in the build contract.

export type ProviderNames = { stt: string; llm: string; tts: string };
export type Health = {
  ok: boolean;
  providers: ProviderNames;
  /** Optional: the server may expose the silence settings. */
  silencePromptSec?: number;
  silenceOfferSec?: number;
  endOfSpeechMs?: number;
};
export type BankInfo = { id: string; title: string; questionCount: number };
export type RoomInfo = { id: string; label: string; description?: string };
export type SessionSummary = {
  id: string;
  startedAt: string;
  bankTitle?: string;
  durationSec?: number;
  status: string;
};

export type PrevInfo = {
  turnIndex: number;
  gapMs?: number;
  ttsFirstAudioMs?: number;
  playbackEndMs?: number;
  interrupted?: boolean;
  /** Timestamp in ms since the session start at which the interviewer went silent (not a duration). */
  interruptStopMs?: number;
  /** Extra field: the part of the interviewer's text that was heard before an interruption. */
  spokenText?: string;
};

export type TurnKind = "start" | "answer" | "silence_prompt" | "silence_offer_next";

export type TurnMeta = {
  kind: TurnKind;
  speechStartMs?: number;
  speechEndMs?: number;
  prev?: PrevInfo;
};

export type TurnLine =
  | { type: "transcript"; turnIndex: number; text: string; sttMs?: number }
  | { type: "sentence"; turnIndex: number; sentenceIndex: number; text: string; kind?: string }
  | { type: "audio"; turnIndex: number; sentenceIndex: number; url: string }
  | { type: "done"; turnIndex: number; kind?: string; closing: boolean; latency?: { sttMs?: number; llmFirstTokenMs?: number } }
  | { type: "error"; stage: "stt" | "llm" | "tts"; message: string };

export type SessionDetail = {
  id: string;
  startedAt: string;
  status: string;
  targetDurationSec: number;
  bankId?: string;
  turns: Array<{ index: number; role: string; text: string }>;
};

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request(url: string, init?: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError(0, "The local server is not reachable.");
  }
  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.text()).slice(0, 200);
    } catch {
      /* no body */
    }
    throw new ApiError(res.status, `The server answered ${res.status}${detail ? `: ${detail}` : ""}`);
  }
  return res;
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await request(url, { signal });
  return (await res.json()) as T;
}

export type ClientConfig = { silencePromptSec: number; silenceOfferSec: number; endOfSpeechMs: number };

/** Health plus the silence and end-of-speech settings from /api/config, when the server has them. */
export async function getHealth(signal?: AbortSignal): Promise<Health> {
  const [health, config] = await Promise.all([
    getJson<Health>("/api/health", signal),
    getJson<Partial<ClientConfig>>("/api/config", signal).catch((err) => {
      if (signal?.aborted) throw err;
      return {} as Partial<ClientConfig>;
    }),
  ]);
  return { ...health, ...config };
}

export async function listBanks(signal?: AbortSignal): Promise<BankInfo[]> {
  const body = await getJson<{ banks: BankInfo[] }>("/api/banks", signal);
  return body.banks ?? [];
}

export async function listRooms(signal?: AbortSignal): Promise<RoomInfo[]> {
  const body = await getJson<{ rooms?: RoomInfo[] } | RoomInfo[]>("/api/rooms", signal);
  const rooms = Array.isArray(body) ? body : (body.rooms ?? []);
  return rooms.map((r) => ({ id: r.id, label: r.label, description: r.description }));
}

export async function listSessions(signal?: AbortSignal): Promise<SessionSummary[]> {
  const body = await getJson<{ sessions?: Array<Record<string, unknown>> }>("/api/sessions", signal);
  return (body.sessions ?? []).map((s) => ({
    id: String(s.id),
    startedAt: String(s.startedAt ?? ""),
    bankTitle: typeof s.bankTitle === "string" ? s.bankTitle : typeof s.bank === "string" ? s.bank : undefined,
    durationSec:
      typeof s.targetDurationSec === "number" ? s.targetDurationSec : typeof s.durationSec === "number" ? s.durationSec : undefined,
    status: String(s.status ?? ""),
  }));
}

export type CreateSessionBody = {
  roomId: string;
  bankId: string;
  profileId: string;
  targetDurationSec: number;
  roleContext?: string;
};

export async function createSession(body: CreateSessionBody): Promise<{ id: string }> {
  const res = await request("/api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as { session: { id: string } };
  return { id: json.session.id };
}

export async function getSession(id: string, signal?: AbortSignal): Promise<SessionDetail> {
  const body = await getJson<{ session: SessionDetail }>(`/api/session/${encodeURIComponent(id)}`, signal);
  return body.session;
}

export async function endSession(id: string, prev?: PrevInfo): Promise<void> {
  await request(`/api/session/${encodeURIComponent(id)}/end`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(prev ? { prev } : {}),
  });
}

/** Split a byte stream into NDJSON objects. Exported for tests. */
export async function* parseNdjson(body: ReadableStream<Uint8Array>): AsyncGenerator<unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl = buffer.indexOf("\n");
      while (nl >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line) yield JSON.parse(line);
        nl = buffer.indexOf("\n");
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) yield JSON.parse(buffer.trim());
  } finally {
    reader.cancel().catch(() => {});
  }
}

export type TurnRequest = { meta: TurnMeta; audio?: Blob; signal: AbortSignal };

/** Post one turn and yield the NDJSON lines of the reply as they arrive. */
export async function* streamTurn(sessionId: string, req: TurnRequest): AsyncGenerator<TurnLine> {
  const form = new FormData();
  if (req.audio) form.append("audio", req.audio, "answer.wav");
  form.append("meta", JSON.stringify(req.meta));
  const res = await request(`/api/session/${encodeURIComponent(sessionId)}/turn`, {
    method: "POST",
    body: form,
    signal: req.signal,
  });
  if (!res.body) throw new ApiError(res.status, "The server sent no stream.");
  for await (const line of parseNdjson(res.body)) yield line as TurnLine;
}
