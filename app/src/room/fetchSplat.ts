// Download a splat file with progress, a clean error on a missing file, a timeout and abort.
// The status is checked before the bytes go to the splat parser, so a 404 is an error and not a hang.

export const LOAD_TIMEOUT_MS = 30_000;

export type FetchSplatOptions = {
  signal?: AbortSignal;
  /** Fraction 0..1, or null when the total size is unknown. */
  onProgress?: (fraction: number | null) => void;
  fetchImpl?: typeof fetch;
};

export class SceneLoadError extends Error {
  constructor(
    message: string,
    readonly kind: "missing" | "network" | "timeout" | "aborted" | "parse",
  ) {
    super(message);
    this.name = "SceneLoadError";
  }
}

export async function fetchSplatBytes(url: string, opts: FetchSplatOptions = {}): Promise<Uint8Array> {
  const doFetch = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(url, { signal: opts.signal });
  } catch (e) {
    if (opts.signal?.aborted) throw new SceneLoadError("Loading was stopped", "aborted");
    throw new SceneLoadError(`Could not reach ${url}: ${(e as Error).message}`, "network");
  }
  if (!res.ok) throw new SceneLoadError(`No room file at ${url} (HTTP ${res.status})`, "missing");
  // A dev server may answer a missing file with its HTML page and status 200.
  const type = res.headers.get("content-type") ?? "";
  if (type.includes("text/html")) throw new SceneLoadError(`No room file at ${url} (got a web page)`, "missing");

  const total = Number(res.headers.get("content-length")) || 0;
  opts.onProgress?.(total > 0 ? 0 : null);
  if (!res.body) {
    const buf = new Uint8Array(await res.arrayBuffer());
    opts.onProgress?.(1);
    return buf;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.byteLength;
      opts.onProgress?.(total > 0 ? Math.min(1, received / total) : null);
    }
  } catch (e) {
    if (opts.signal?.aborted) throw new SceneLoadError("Loading was stopped", "aborted");
    throw new SceneLoadError(`Download failed: ${(e as Error).message}`, "network");
  }
  const out = new Uint8Array(received);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  opts.onProgress?.(1);
  return out;
}

/** Run `work` with an AbortSignal that fires on the caller's abort or after timeoutMs. */
export async function withLoadTimeout<T>(
  work: (signal: AbortSignal) => Promise<T>,
  opts: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<T> {
  const ctl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctl.abort();
  }, opts.timeoutMs ?? LOAD_TIMEOUT_MS);
  const onAbort = () => ctl.abort();
  if (opts.signal?.aborted) ctl.abort();
  opts.signal?.addEventListener("abort", onAbort);
  try {
    return await Promise.race([
      work(ctl.signal),
      new Promise<never>((_, reject) => {
        ctl.signal.addEventListener("abort", () =>
          reject(
            timedOut
              ? new SceneLoadError(`Loading the room took longer than ${(opts.timeoutMs ?? LOAD_TIMEOUT_MS) / 1000} s`, "timeout")
              : new SceneLoadError("Loading was stopped", "aborted"),
          ),
        );
      }),
    ]);
  } catch (e) {
    if (timedOut && !(e instanceof SceneLoadError && e.kind === "timeout")) {
      throw new SceneLoadError(`Loading the room took longer than ${(opts.timeoutMs ?? LOAD_TIMEOUT_MS) / 1000} s`, "timeout");
    }
    throw e;
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onAbort);
  }
}
