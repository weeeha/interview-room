import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { Room as RoomRecord } from "../../../shared/types";
import { endSession, getHealth, getRooms, getSession, streamTurn, type Health, type SessionDetail } from "../api.ts";
import { MicError, startCapture, type CaptureHandle } from "../audio/capture.ts";
import { createPlayback, type Playback } from "../audio/playback.ts";
import { createLoop, type Loop, type LoopSnapshot } from "../session/loop.ts";
import {
  createBackdrop,
  UNAVAILABLE_NOTICE,
  webglAvailable,
  type Backdrop,
  type BackdropState,
} from "../room/fallback.ts";
import { createSpatialVoice, type SpatialVoice } from "../room/spatialAudio.ts";

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

const BACKDROP_START: BackdropState = { mode: "flat", loading: false, ready: false, progress: null, loadMs: null };

// Dev only. Public sample splat named in spike/README.md, loaded by URL. It is not in the Marble axis convention.
const SAMPLE_OVERRIDES = { flip: false, offset: [0, 1.2, -2] as [number, number, number] };

const FORCED_STATES = [
  "default",
  "interviewer-speaking",
  "candidate-speaking",
  "silence-prompt",
  "room-loading",
  "room-unavailable",
  "mic-denied",
  "provider-error",
  "ending",
] as const;
type ForcedState = (typeof FORCED_STATES)[number];

/** Dev only: ?state=<name> shows a state that is hard to reach, with sample text, on a real session page. */
function forcedSnapshot(state: ForcedState, real: LoopSnapshot): LoopSnapshot {
  const listening: LoopSnapshot = { ...real, phase: "listening", silenceStage: 0, error: null, candidateTurns: 0 };
  const question = "First question: tell me about a project you led from start to finish.";
  switch (state) {
    case "interviewer-speaking":
      return { ...listening, phase: "interviewer", interviewerCaption: question };
    case "candidate-speaking":
      return { ...listening, phase: "candidate", interviewerCaption: question, candidateCaption: "I started by asking the counter staff what went wrong", candidateTurns: 1 };
    case "silence-prompt":
      return { ...listening, silenceStage: 1, interviewerCaption: question };
    case "provider-error":
      return { ...listening, phase: "error", interviewerCaption: question, error: { stage: "tts", message: "Text to speech failed on the local server." } };
    case "ending":
      return { ...listening, phase: "ending", interviewerCaption: "Thank you. That is the end of the interview." };
    default:
      return { ...listening, interviewerCaption: question };
  }
}

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
  const debugParam = params.get("debug") === "1";
  const forced = import.meta.env.DEV ? (FORCED_STATES.find((f) => f === params.get("state")) ?? null) : null;
  const splatOverride = import.meta.env.DEV ? params.get("splat") : null;

  const [gate, setGate] = useState<Gate>({ kind: "loading" });
  const [health, setHealth] = useState<Health | null>(null);
  const [realSnap, setSnap] = useState<LoopSnapshot>(EMPTY);
  const [realMicError, setMicError] = useState<MicError | null>(null);
  const [micBusy, setMicBusy] = useState(false);
  const [muted, setMuted] = useState(false);
  const [level, setLevel] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [bd, setBd] = useState<BackdropState>(BACKDROP_START);
  const [roomRec, setRoomRec] = useState<RoomRecord | null | undefined>(undefined);
  const [debugOn, setDebugOn] = useState(debugParam);
  const [dbg, setDbg] = useState<{ fps: number; yaw: number } | null>(null);

  // What the screen shows. In dev, ?state= replaces the real values with a sample of that state.
  const snap = forced ? forcedSnapshot(forced, realSnap) : realSnap;
  const micError = forced === "mic-denied" ? new MicError("denied", "The browser blocked the microphone.") : forced ? null : realMicError;
  const shown: BackdropState =
    forced === "room-loading"
      ? { ...bd, mode: "room", loading: true, ready: false, progress: 0.62, notice: undefined }
      : forced === "room-unavailable"
        ? { ...bd, mode: "flat", loading: false, ready: false, notice: UNAVAILABLE_NOTICE }
        : bd;

  const loopRef = useRef<Loop | null>(null);
  const captureRef = useRef<CaptureHandle | null>(null);
  const playbackRef = useRef<Playback | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const startMsRef = useRef(0);
  const kindRef = useRef<"start" | "silence_prompt">("start");
  const startedRef = useRef(false);
  const slotRef = useRef<HTMLDivElement | null>(null);
  const backdropRef = useRef<Backdrop | null>(null);
  const voiceRef = useRef<SpatialVoice | null>(null);
  const debug = debugOn;

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
        // The room records load beside the session; a failure here only means the flat backdrop.
        void getRooms(ctrl.signal).then(
          (rooms) => {
            if (!ctrl.signal.aborted) setRoomRec(rooms.find((r) => r.id === session.roomId) ?? rooms[0] ?? null);
          },
          () => {
            if (!ctrl.signal.aborted) setRoomRec(null);
          },
        );
        const resume = session.status === "running" || session.turns.length > 0;
        setGate(forced ? { kind: "live" } : { kind: "ready", session, resume });
      } catch (err) {
        if (ctrl.signal.aborted) return;
        setGate({ kind: "error", message: err instanceof Error ? err.message : String(err) });
      }
    })();
    return () => ctrl.abort();
  }, [id, navigate, attempt, forced]);

  const teardown = useCallback(() => {
    voiceRef.current?.dispose();
    voiceRef.current = null;
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

  // The room view. It starts as soon as the room record is known, before the Start press, and nothing
  // below waits for it (spec D5). Any failure ends in the flat backdrop and a visible notice.
  useEffect(() => {
    if (roomRec === undefined) return;
    let cancelled = false;
    let backdrop: Backdrop | null = null;
    const room = roomRec;
    const splatUrl = splatOverride || (room?.splatPath ? `/${room.splatPath.replace(/^\/+/, "")}` : null);
    const make = (createView: Parameters<typeof createBackdrop>[0]["createView"]) => {
      backdrop = createBackdrop({
        room,
        splatUrl,
        container: () => slotRef.current,
        createView,
        viewportWidth: () => window.innerWidth,
        webgl: webglAvailable,
        onChange: setBd,
        onCamera: (yaw, pitch) => voiceRef.current?.update(yaw, pitch),
        sceneOverrides: splatOverride ? SAMPLE_OVERRIDES : undefined,
      });
      backdropRef.current = backdrop;
      backdrop.start();
    };
    import("../room/RoomView.ts").then(
      (m) => {
        if (!cancelled) make(m.createRoomView);
      },
      (err: unknown) => {
        // The room code itself did not load.
        if (cancelled) return;
        make(() => {
          throw err instanceof Error ? err : new Error(String(err));
        });
      },
    );
    const onResize = () => backdrop?.resize();
    window.addEventListener("resize", onResize);
    return () => {
      cancelled = true;
      window.removeEventListener("resize", onResize);
      backdrop?.dispose();
      backdropRef.current = null;
    };
  }, [roomRec, splatOverride]);

  // The interviewer voice comes from the anchor while the room shows, and straight from the speakers otherwise.
  // Switching is a reconnect of one node, so queued audio keeps playing.
  const spatial = gate.kind === "live" && bd.mode === "room" && bd.ready;
  useEffect(() => {
    const playback = playbackRef.current;
    const ctx = ctxRef.current;
    const anchor = roomRec?.interviewerAnchors[0]?.position;
    if (spatial && playback && ctx && roomRec && anchor && !voiceRef.current) {
      try {
        const v = createSpatialVoice({ audioContext: ctx, source: playback.output, anchor, seat: roomRec.seat });
        const view = backdropRef.current?.view();
        if (view) v.update(view.getCameraYawDeg(), view.getCameraPitchDeg());
        voiceRef.current = v;
      } catch {
        voiceRef.current = null;
      }
    } else if (!spatial && voiceRef.current) {
      voiceRef.current.dispose();
      voiceRef.current = null;
    }
  }, [spatial, roomRec]);

  // Marker level and debug numbers. Runs only while the tab is visible and there is something to feed.
  useEffect(() => {
    if (!(bd.ready || debugOn)) return;
    const t = setInterval(() => {
      if (document.hidden) return;
      const view = backdropRef.current?.view();
      if (bd.ready) view?.setMarkerLevel(playbackRef.current?.level() ?? 0);
      if (debugOn) setDbg({ fps: view?.getFps() ?? 0, yaw: view?.getCameraYawDeg() ?? 0 });
    }, 100);
    return () => clearInterval(t);
  }, [bd.ready, debugOn]);

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
      delete b.dataset.backdrop;
    };
  }, []);
  useEffect(() => {
    document.body.dataset.state = phaseState;
  }, [phaseState]);
  useEffect(() => {
    document.body.dataset.backdrop = bd.mode === "room" && bd.ready ? "room" : "flat";
  }, [bd.mode, bd.ready]);

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
      if (debug) (window as unknown as { __room?: unknown }).__room = { loop, playback, voice: () => voiceRef.current?.debug() ?? null };
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
      else if (e.key === "d" || e.key === "D") setDebugOn((v) => !v);
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
    if (forced === "room-loading") return "Loading the room";
    if (forced === "room-unavailable") return "Room unavailable";
    if (!live) {
      if (gate.kind === "ready" && shown.loading) return "Loading the room";
      return gate.kind === "loading" ? "Loading the session" : gate.kind === "error" ? "Session unavailable" : "Ready to start";
    }
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
        <div className="room-view-slot" data-room-view ref={slotRef} />
        <span className="bd-flat">Plain backdrop. Captions carry the session.</span>
        {live && !micError && !(shown.mode === "room" && shown.ready) && (
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
        {shown.notice && (
          <div className="banner" role="status" data-room-notice>
            <p className="banner-title">{shown.notice}.</p>
            <p>
              {shown.notice === UNAVAILABLE_NOTICE
                ? "The room file did not load. The interview works the same without it."
                : "The interview works the same without the room."}
            </p>
          </div>
        )}
        {shown.loading && !micError && (
          <div className="banner" role="status">
            <p className="banner-title">
              Loading the room{shown.progress !== null ? `, ${Math.round(shown.progress * 100)} percent` : ""}.
            </p>
            <p>The room is a large file. The voice interview does not wait for it, and you can use a plain backdrop instead.</p>
            <p>
              {shown.progress !== null ? (
                <progress value={Math.round(shown.progress * 100)} max={100} aria-label="Room loading progress" />
              ) : (
                <progress aria-label="Room loading progress" />
              )}
            </p>
            <button type="button" className="btn" onClick={() => backdropRef.current?.skip()}>
              Skip room
            </button>
          </div>
        )}
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
        <p className="note shortcuts">
          Keyboard: press M to mute or unmute, E to end the session, D for the debug panel
          {shown.mode === "room" && shown.ready ? ", the arrow keys to turn the view" : ""}. No feedback is shown during the interview.
        </p>
        {debug && (
          <dl className="debug-panel" data-debug aria-label="Debug numbers">
            <div>
              <dt>fps (10 s average)</dt>
              <dd>{shown.ready && dbg ? dbg.fps.toFixed(1) : "none"}</dd>
            </div>
            <div>
              <dt>room load</dt>
              <dd>{shown.loadMs === null ? "none" : `${Math.round(shown.loadMs)} ms`}</dd>
            </div>
            <div>
              <dt>last gap</dt>
              <dd>{snap.lastGapMs === null ? "none" : `${snap.lastGapMs} ms`}</dd>
            </div>
            <div>
              <dt>backdrop</dt>
              <dd>{shown.mode === "room" ? (shown.ready ? "room" : "room, loading") : "flat"}</dd>
            </div>
            <div>
              <dt>yaw</dt>
              <dd>{shown.ready && dbg ? `${dbg.yaw.toFixed(1)} deg` : "none"}</dd>
            </div>
            <div>
              <dt>last interrupt stop</dt>
              <dd>{snap.lastInterruptStopMs === null ? "none" : `${snap.lastInterruptStopMs} ms`}</dd>
            </div>
            <div>
              <dt>phase, turns</dt>
              <dd>
                {snap.phase}, {snap.candidateTurns}
              </dd>
            </div>
          </dl>
        )}
      </div>
    </main>
  );
}
