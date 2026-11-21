import { useEffect, useState } from "react";

type Health = { ok: boolean; providers: { stt: string; llm: string; tts: string } };

export function Setup() {
  const [status, setStatus] = useState("checking server");

  useEffect(() => {
    const ctrl = new AbortController();
    fetch("/api/health", { signal: ctrl.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`server answered ${r.status}`);
        return r.json() as Promise<Health>;
      })
      .then((h) => setStatus(h.ok ? "server ok" : "server reported a problem"))
      .catch((e: unknown) => {
        if (ctrl.signal.aborted) return;
        setStatus(`server not reachable: ${e instanceof Error ? e.message : String(e)}`);
      });
    return () => ctrl.abort();
  }, []);

  return (
    <main>
      <h1>Setup</h1>
      <p>{status}</p>
    </main>
  );
}
