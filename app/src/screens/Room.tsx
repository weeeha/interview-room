import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { endSession, getHealth, getSession, streamTurn, type Health, type SessionDetail } from "../api.ts";
import { MicError, startCapture, type CaptureHandle } from "../audio/capture.ts";
import { createPlayback, type Playback } from "../audio/playback.ts";
import { createLoop, type Loop, type LoopSnapshot } from "../session/loop.ts";

const DEFAULT_SILENCE_PROMPT_SEC = 8;
const DEFAULT_SILENCE_OFFER_SEC = 12;

type Gate =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; session: SessionDetail; resume: boolean }
  | { kind: "live" };

const EMPTY: LoopSnapshot = {
  phase: "idle",
  silenceStage: 0,
  interviewerCaption: "",
  candidateCaption: "",
  candidateTurns: 0,
  error: null,
  lastGapMs: null,
  lastInterruptStopMs: null,
};

const clock = (sec: number) => {
  const s = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

const ERROR_TITLE: Record<string, string> = {
  stt: "Speech to text failed.",
  llm: "The interviewer did not respond.",
  tts: "The interviewer voice did not respond.",
  request: "The request to the local server failed.",
  end: "The session could not be ended.",
};

export function Room() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const debug = params.get("debug") === "1";

  const [gate, setGate] = useState<Gate>({ kind: "loading" });
  const [health, setHealth] = useState<Health | null>(null);
  const [snap, setSnap] = useState<LoopSnapshot>(EMPTY);
  const [micError, setMicError] = useState<MicError | null>(null);
  const [micBusy, setMicBusy] = useState(false);
  const [muted, setMuted] = useState(false);
  const [level, setLevel] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [attempt, setAttempt] = useState(0);

  const loopRef = useRef<Loop | null>(null);
  const captureRef = useRef<CaptureHandle | null>(null);
  const playbackRef = useRef<Playback | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const startMsRef = useRef(0);
  const kindRef = useRef<"start" | "silence_prompt">("start");
  const startedRef = useRef(false);

  // Load the session and the server settings.
  useEffect(() => {
    const ctrl = new AbortController();
    setGate({ kind: "loading" });
    void (async () => {
      try {
        const [session, h] = await Promise.all([getSession(id, ctrl.signal), getHealth(ctrl.signal).catch(() => null)]);
        if (ctrl.signal.aborted) return;
        setHealth(h);
        if (session.status === "ended" || session.status === "reported") {
          navigate(`/report/${id}`, { replace: true });
          return;
        }
        const resume = session.status === "running" || session.turns.length > 0;
        setGate({ kind: "ready", session, resume });
      } catch (err) {
        if (ctrl.signal.aborted) return;
        setGate({ kind: "error", message: err instanceof Error ? err.message : String(err) });
      }
    })();
    return () => ctrl.abort();
  }, [id, navigate, attempt]);

  const teardown = useCallback(() => {
    loopRef.current?.dispose();
    loopRef.current = null;
    captureRef.current?.stop();
    captureRef.current = null;
    playbackRef.current?.stop();
    playbackRef.current = null;
    void ctxRef.current?.close().catch(() => {});
    ctxRef.current = null;
    startedRef.current = false;
  }, []);

  useEffect(() => teardown, [teardown]);

  // The body carries the state the draft stylesheet keys on.
  const phaseState = (() => {
    if (micError) return "mic-denied";
    switch (snap.phase) {
      case "interviewer":
        return "interviewer-speaking";
      case "candidate":
        return "candidate-speaking";
      case "listening":
        return snap.silenceStage === 1 ? "silence-prompt" : "default";
      case "error":
        return "provider-error";
      case "ending":
      case "ended":
        return "ending";
      default:
        return "default";
    }
  })();
  useEffect(() => {
    const b = document.body;
    b.classList.add("force-dark", "room-page");
    b.dataset.bg = "dark";
    return () => {
      b.classList.remove("force-dark", "room-page");
      delete b.dataset.bg;
      delete b.dataset.state;
    };
  }, []);
  useEffect(() => {
    document.body.dataset.state = phaseState;
  }, [phaseState]);

  // Live timer.
  useEffect(() => {
    if (gate.kind !== "live" || snap.phase === "ended") return;
    const t = setInterval(() => setElapsed((performance.now() - startMsRef.current) / 1000), 500);
    return () => clearInterval(t);
  }, [gate.kind, snap.phase]);

  const connectMic = useCallback(async () => {
    const loop = loopRef.current;
    if (!loop) return;
    setMicBusy(true);
    try {
      const cap = await startCapture({
        sessionStartMs: startMsRef.current,
        endOfSpeechMs: health?.endOfSpeechMs,
        onSpeechStart: (atMs) => loopRef.current?.onSpeechStart(atMs),
        onUtterance: (u) => loopRef.current?.onUtterance(u),
        onLevel: (l) => setLevel(Math.round(l * 5)),
      });
      captureRef.current = cap;
      setMicError(null);
      setMuted(false);
      if (!startedRef.current) {
        startedRef.current = true;
        // The first 500 ms of capture calibrate the noise floor; the opening line takes longer than that to arrive.
        loop.start(kindRef.current);
      }
    } catch (err) {
      setMicError(err instanceof MicError ? err : new MicError("failed", err instanceof Error ? err.message : String(err)));
    } finally {
      setMicBusy(false);
    }
  }, [health]);

  // Called from the Start or Resume click: audio needs a user gesture.
  const begin = useCallback(
    (session: SessionDetail, resume: boolean) => {
      const Ctor: typeof AudioContext | undefined =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) {
        setMicError(new MicError("unsupported", "This browser has no Web Audio support."));
        return;
      }
      teardown();
      const ctx = new Ctor();
      void ctx.resume().catch(() => {});
      ctxRef.current = ctx;
      const playback = createPlayback({ audioContext: ctx });
      playbackRef.current = playback;
      // Resumed sessions keep the clock of the server log, so ms values stay comparable.
      const startMs = resume ? performance.now() - (Date.now() - Date.parse(session.startedAt)) : performance.now();
      startMsRef.current = startMs;
      kindRef.current = resume ? "silence_prompt" : "start";
      const loop = createLoop({
        api: { streamTurn: (req) => streamTurn(id, req), endSession: (prev) => endSession(id, prev) },
        playback,
        capture: { setInterviewerSpeaking: (on) => captureRef.current?.setInterviewerSpeaking(on) },
        tts: health?.providers.tts === "browser" ? "speech" : "audio",
        now: () => performance.now(),
        sessionStartMs: startMs,
        silencePromptSec: health?.silencePromptSec ?? DEFAULT_SILENCE_PROMPT_SEC,
        silenceOfferSec: health?.silenceOfferSec ?? DEFAULT_SILENCE_OFFER_SEC,
        setTimer: (fn, ms) => setTimeout(fn, ms),
        clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
        onChange: setSnap,
        onEnded: () => navigate(`/report/${id}`),
      });
      loopRef.current = loop;
      if (debug) (window as unknown as { __room?: unknown }).__room = { loop, playback };
      setSnap(loop.snapshot());
      setElapsed((performance.now() - startMs) / 1000);
      setGate({ kind: "live" });
      void connectMic();
    },
    [connectMic, debug, health, id, navigate, teardown],
  );

  const toggleMute = useCallback(() => {
    const cap = captureRef.current;
    if (!cap) return;
    const next = !cap.muted;
    cap.mute(next);
    loopRef.current?.setMuted(next);
    setMuted(next);
    if (next) setLevel(0);
  }, []);

  const endNow = useCallback(async () => {
    if (loopRef.current) {
      await loopRef.current.end();
      return;
    }
    try {
      await endSession(id);
      navigate(`/report/${id}`);
    } catch (err) {
      setGate({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }, [id, navigate]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "m" || e.key === "M") toggleMute();
      else if (e.key === "e" || e.key === "E") void endNow();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [endNow, toggleMute]);

  const [target, setTarget] = useState(600);
  useEffect(() => {
    if (gate.kind === "ready") setTarget(gate.session.targetDurationSec || 600);
  }, [gate]);

  const live = gate.kind === "live";
  const status = (() => {
    if (micError) return micError.code === "denied" ? "Microphone blocked" : "Microphone unavailable";
    if (!live) return gate.kind === "loading" ? "Loading the session" : gate.kind === "error" ? "Session unavailable" : "Ready to start";
    switch (snap.phase) {
      case "thinking":
        return "Interviewer is thinking";
      case "interviewer":
        return "Interviewer is speaking";
      case "candidate":
        return "You are speaking";
      case "listening":
        return snap.silenceStage === 1 ? "Waiting for your answer" : "Your turn";
      case "error":
        return "Something went wrong";
      case "ending":
      case "ended":
        return "Ending the session";
      default:
        return "Starting";
    }
  })();

  const ending = snap.phase === "ending" || snap.phase === "ended";
  const showCaptions = live && !micError;

  return (
    <main className="room">
      <div className="room-backdrop">
        <div className="room-view-slot" data-room-view />
        <span className="bd-room">Voice session. The room view is off.</span>
        <span className="bd-flat">Plain backdrop. Captions carry the session.</span>
        {live && !micError && (
          <span className="marker">
            Interviewer<span>{snap.phase === "interviewer" ? " is speaking" : ""}</span>
          </span>
        )}
      </div>

      <div className="room-top">
        <p className="status" role="status">
          {status}
        </p>
        <p className="timer">
          <time>{clock(live ? elapsed : 0)}</time> of {clock(target)}
          {live ? "" : ", not started"}
        </p>
      </div>

      <div className="room-notice">
        {gate.kind === "loading" && (
          <div className="banner" role="status">
            <p className="banner-title">Loading the session.</p>
          </div>
        )}
        {gate.kind === "error" && (
          <div className="banner error" role="alert">
            <p className="banner-title">The session cannot be opened.</p>
            <p>{gate.message}</p>
            <div className="actions-row">
              <button type="button" className="btn btn-primary" onClick={() => setAttempt((n) => n + 1)}>
                Retry
              </button>
              <Link className="btn" to="/">
                Back to setup
              </Link>
            </div>
          </div>
        )}
        {gate.kind === "ready" && !gate.resume && (
          <div className="banner">
            <p className="banner-title">Ready when you are.</p>
            <p>The browser asks to use the microphone when you press Start. The interviewer speaks first. You can talk over them at any time.</p>
            <div className="actions-row">
              <button type="button" className="btn btn-primary" onClick={() => begin(gate.session, false)}>
                Start
              </button>
              <button type="button" className="btn" onClick={() => void endNow()}>
                End session
              </button>
            </div>
          </div>
        )}
        {gate.kind === "ready" && gate.resume && (
          <div className="banner">
            <p className="banner-title">This session is already running.</p>
            <p>The page was reloaded in the middle of it. Resume to carry on with the interviewer, or end it and read the report.</p>
            <div className="actions-row">
              <button type="button" className="btn btn-primary" onClick={() => begin(gate.session, true)}>
                Resume
              </button>
              <button type="button" className="btn" onClick={() => void endNow()}>
                End session
              </button>
            </div>
          </div>
        )}
        {micError && (
          <div className="banner error" role="alert">
            <p className="banner-title">{micError.code === "denied" ? "The browser blocked the microphone." : "The microphone could not start."}</p>
            <p>
              {micError.code === "denied"
                ? "Allow the microphone in the address bar, then try again. The interview cannot hear you until you do."
                : micError.message}
            </p>
            <button type="button" className="btn btn-primary" onClick={() => void connectMic()} disabled={micBusy}>
              Retry microphone
            </button>
          </div>
        )}
        {live && !micError && snap.phase === "error" && snap.error && (
          <div className="banner error" role="alert">
            <p className="banner-title">{ERROR_TITLE[snap.error.stage] ?? "Something went wrong."}</p>
            <p>{snap.error.message} Your answers so far are kept.</p>
            <button type="button" className="btn btn-primary" onClick={() => loopRef.current?.retry()}>
              Retry
            </button>
          </div>
        )}
        {ending && !micError && (
          <div className="banner" role="status">
            <p className="banner-title">Saving audio and transcript.</p>
            <p>The report opens when the session is saved.</p>
            <p>
              <progress aria-label="Saving progress" />
            </p>
            <Link className="btn btn-primary" to={`/report/${id}`}>
              Open report
            </Link>
          </div>
        )}
      </div>

      <div className="room-bottom">
        {showCaptions && (
          <div className="captions" aria-live="polite">
            <p className="cap-who">Interviewer</p>
            <p className="cap-text">{snap.interviewerCaption || (snap.phase === "thinking" ? "..." : "")}</p>
            {snap.candidateCaption && (
              <p className="cap-you">
                <b>You:</b> {snap.candidateCaption}
              </p>
            )}
            {snap.candidateTurns === 0 && snap.phase === "listening" && <p className="cap-hint">Say something when you are ready.</p>}
          </div>
        )}

        <div className="controls">
          <div className="mic">
            <span className="meter" role="meter" aria-label="Microphone level" aria-valuemin={0} aria-valuemax={5} aria-valuenow={level} data-level={level}>
              <i />
              <i />
              <i />
              <i />
              <i />
            </span>
            <span id="mic-text">{!live || micError ? "Mic off" : muted ? "Mic muted" : "Mic on"}</span>
          </div>
          <div className="buttons">
            <button type="button" className="btn" aria-pressed={muted} onClick={toggleMute} disabled={!captureRef.current && !live}>
              <span>{muted ? "Unmute" : "Mute"}</span>
              <kbd aria-hidden="true">M</kbd>
            </button>
            <button type="button" className="btn" onClick={() => void endNow()} disabled={ending || gate.kind === "loading"}>
              End session<kbd aria-hidden="true">E</kbd>
            </button>
          </div>
        </div>
        <p className="note shortcuts">Keyboard: press M to mute or unmute, E to end the session. No feedback is shown during the interview.</p>
        {debug && (
          <p className="debug-line" data-debug>
            gap {snap.lastGapMs ?? "none"} ms, last interrupt stop {snap.lastInterruptStopMs ?? "none"} ms, phase {snap.phase}, turns {snap.candidateTurns}
          </p>
        )}
      </div>
    </main>
  );
}
