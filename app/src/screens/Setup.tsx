import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  createSession,
  getHealth,
  listBanks,
  listRooms,
  listSessions,
  type BankInfo,
  type Health,
  type RoomInfo,
  type SessionSummary,
} from "../api.ts";

type Style = "warm" | "neutral" | "probing";
type Choices = { roomId: string; bankId: string; style: Style; length: 5 | 10 | 20; roleContext: string };

const STORE_KEY = "interview-room.setup";
const DEFAULTS: Choices = { roomId: "", bankId: "", style: "neutral", length: 10, roleContext: "" };

// Used when the server has no room list: the three rooms of the draft.
const FALLBACK_ROOMS: RoomInfo[] = [
  { id: "office", label: "Interview office", description: "One interviewer across a desk." },
  { id: "panel", label: "Panel room", description: "A long table, one voice." },
  { id: "call", label: "Video-call corner", description: "A desk and a screen at home." },
];

function loadChoices(): Choices {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Choices>) };
  } catch {
    return DEFAULTS;
  }
}

function saveChoices(c: Choices) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(c));
  } catch {
    /* storage blocked: the choices are just not remembered */
  }
}

type Data = {
  banks: BankInfo[];
  rooms: RoomInfo[];
  sessions: SessionSummary[] | null; // null: could not load
  health: Health | null;
};

type Load = { state: "loading" } | { state: "error"; message: string } | { state: "ready"; data: Data };

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function providerNote(h: Health | null): string {
  if (!h) return "Provider details are not available.";
  const { stt, llm, tts } = h.providers;
  const paid = llm === "claude";
  const parts = `speech to text ${stt}, interviewer ${llm}, voice ${tts}`;
  return paid
    ? `${parts}. The interviewer uses the Claude API and that costs money.`
    : `${parts}. Everything runs on this computer. No cost.`;
}

export function Setup() {
  const navigate = useNavigate();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [choices, setChoices] = useState<Choices>(loadChoices);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => {
    setLoad({ state: "loading" });
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    const { signal } = ctrl;
    void (async () => {
      const [banks, rooms, sessions, health] = await Promise.allSettled([
        listBanks(signal),
        listRooms(signal),
        listSessions(signal),
        getHealth(signal),
      ]);
      if (signal.aborted) return;
      if (banks.status === "rejected") {
        const m = banks.reason instanceof Error ? banks.reason.message : "The server did not answer.";
        setLoad({ state: "error", message: m });
        return;
      }
      const roomList = rooms.status === "fulfilled" && rooms.value.length > 0 ? rooms.value : FALLBACK_ROOMS;
      setLoad({
        state: "ready",
        data: {
          banks: banks.value,
          rooms: roomList,
          sessions: sessions.status === "fulfilled" ? sessions.value : null,
          health: health.status === "fulfilled" ? health.value : null,
        },
      });
      setChoices((c) => ({
        ...c,
        roomId: roomList.some((r) => r.id === c.roomId) ? c.roomId : (roomList[0]?.id ?? ""),
        bankId: banks.value.some((b) => b.id === c.bankId) ? c.bankId : (banks.value[0]?.id ?? ""),
      }));
    })();
    return () => ctrl.abort();
  }, [attempt]);

  useEffect(() => {
    saveChoices(choices);
  }, [choices]);

  const update = <K extends keyof Choices>(key: K, value: Choices[K]) => setChoices((c) => ({ ...c, [key]: value }));

  const data = load.state === "ready" ? load.data : null;
  const noBanks = data !== null && data.banks.length === 0;
  const canStart = data !== null && !noBanks && choices.bankId !== "" && choices.roomId !== "" && !starting;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canStart) return;
    setStarting(true);
    setStartError(null);
    try {
      const { id } = await createSession({
        roomId: choices.roomId,
        bankId: choices.bankId,
        profileId: choices.style,
        targetDurationSec: choices.length * 60,
        roleContext: choices.roleContext.trim() || undefined,
      });
      navigate(`/session/${id}`);
    } catch (err) {
      setStartError(err instanceof Error ? err.message : String(err));
      setStarting(false);
    }
  }

  return (
    <div className="page">
      <header className="site-header">
        <span className="wordmark">Interview room</span>
      </header>

      <main>
        <h1>Set up a session</h1>
        <p className="lead">
          Pick a room, a question bank and a style. The interviewer asks the questions and follows up on what you say. Feedback comes
          after the session.
        </p>

        {load.state === "error" && (
          <div className="banner error spaced" role="alert">
            <p className="banner-title">Cannot reach the local server.</p>
            <p>The setup screen needs the voice server on this computer. Start it, then try again. Your choices below are kept.</p>
            <p className="note">{load.message}</p>
            <button type="button" className="btn" onClick={retry}>
              Retry connection
            </button>
          </div>
        )}

        <form className="stack" aria-busy={load.state === "loading"} onSubmit={onSubmit}>
          <fieldset>
            <legend>Room</legend>
            <div className="choices cols-3">
              {(data?.rooms ?? FALLBACK_ROOMS).map((r) => (
                <label className="choice" key={r.id}>
                  <input
                    type="radio"
                    name="room"
                    value={r.id}
                    checked={choices.roomId === r.id}
                    disabled={!data}
                    onChange={() => update("roomId", r.id)}
                  />
                  <span className="room-view" aria-hidden="true">
                    room view
                  </span>
                  <span className="choice-body">
                    <span className="choice-title">{r.label}</span>
                    {r.description && <span className="choice-sub">{r.description}</span>}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="field">
            <label className="label" htmlFor="bank">
              Question bank
            </label>
            <select
              id="bank"
              name="bank"
              value={choices.bankId}
              disabled={!data || noBanks}
              onChange={(e) => update("bankId", e.target.value)}
              required
            >
              {load.state === "loading" && <option>Loading banks</option>}
              {load.state === "error" && <option>Banks unavailable</option>}
              {noBanks && <option>No banks found</option>}
              {data?.banks.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.title} ({b.questionCount} questions)
                </option>
              ))}
            </select>
            {load.state === "loading" && <p className="hint">Reading the bank folder.</p>}
            {load.state === "error" && <p className="hint">Banks cannot load while the server is unreachable.</p>}
            {noBanks && (
              <p className="hint">
                Add a markdown file to the bank folder, then reload. Set the folder with QUESTION_BANK_DIR in your .env file. Question
                banks stay on this computer.
              </p>
            )}
          </div>

          <fieldset>
            <legend>Interviewer style</legend>
            <div className="choices inline">
              {(["warm", "neutral", "probing"] as const).map((s) => (
                <label className="choice compact" key={s}>
                  <input type="radio" name="style" value={s} checked={choices.style === s} onChange={() => update("style", s)} />
                  <span className="choice-body">
                    <span className="choice-title">{s[0]!.toUpperCase() + s.slice(1)}</span>
                  </span>
                </label>
              ))}
            </div>
            <p className="hint">Probing asks more follow-ups on each answer.</p>
          </fieldset>

          <fieldset>
            <legend>Length</legend>
            <div className="choices inline">
              {([5, 10, 20] as const).map((n) => (
                <label className="choice compact" key={n}>
                  <input type="radio" name="length" value={n} checked={choices.length === n} onChange={() => update("length", n)} />
                  <span className="choice-body">
                    <span className="choice-title">{n} minutes</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="field">
            <label className="label" htmlFor="role">
              Role context (optional)
            </label>
            <textarea
              id="role"
              name="role"
              rows={5}
              aria-describedby="role-hint"
              placeholder="Paste the job description or a few lines about the role."
              value={choices.roleContext}
              onChange={(e) => update("roleContext", e.target.value)}
            />
            <p className="hint" id="role-hint">
              Stays on this computer. It goes to the interviewer as context. Long text scrolls inside the box.
            </p>
          </div>

          <div className="stack-sm">
            <button type="submit" className="btn btn-primary" disabled={!canStart}>
              {starting ? "Starting" : "Start session"}
            </button>
            {load.state === "loading" && <p className="note">Start is available when the banks have loaded.</p>}
            {load.state === "error" && <p className="note">Start is available when the server is reachable.</p>}
            {noBanks && <p className="note">Add a question bank first. A session needs at least one.</p>}
            {startError && (
              <p className="note" role="alert">
                Could not start the session. {startError}
              </p>
            )}
            <p className="note">
              <strong>Providers:</strong> {data ? providerNote(data.health) : "checking the server."}
            </p>
          </div>
        </form>

        <section aria-labelledby="past">
          <h2 id="past">Past sessions</h2>
          {load.state === "loading" && (
            <ul className="rows" aria-label="Loading past sessions">
              <li>
                <div className="row">
                  <span className="pending" />
                  <span className="pending short" />
                </div>
              </li>
              <li>
                <div className="row">
                  <span className="pending" />
                  <span className="pending short" />
                </div>
              </li>
            </ul>
          )}
          {load.state === "error" && <p>Past sessions cannot load while the server is unreachable.</p>}
          {data && data.sessions === null && <p>Past sessions could not be loaded.</p>}
          {data && data.sessions?.length === 0 && <p>No sessions yet. Your first report appears here after you finish one.</p>}
          {data && data.sessions && data.sessions.length > 0 && (
            <ul className="rows">
              {data.sessions.map((s) => {
                const done = s.status === "ended" || s.status === "reported";
                const date = formatDate(s.startedAt);
                return (
                  <li key={s.id}>
                    <div className="row">
                      <span className="row-main">{s.bankTitle ?? "Session"}</span>
                      <span className="row-meta">
                        {date}
                        {s.durationSec ? (s.durationSec < 60 ? ", under a minute" : `, ${Math.round(s.durationSec / 60)} minutes`) : ""}
                        {done ? "" : `, ${s.status}`}
                      </span>
                      <Link className="row-link" to={done ? `/report/${s.id}` : `/session/${s.id}`}>
                        {done ? "Read report" : "Resume"}
                        <span className="visually-hidden"> for {date}</span>
                      </Link>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
