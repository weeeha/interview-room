import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import type { Session, Turn } from "../../../shared/types.ts";
import { fetchBankTitle, fetchSessionReport, retryReport, type QuestionReport, type Report as ReportData, type SessionReply } from "../reportApi.ts";
import { PlayButton, Quote, ShowMore, type Player } from "./ReportParts.tsx";
import { audioFile, audioUrl, deliveryRows, exportFileName, isLong, metaLine, nextQuestionIndex, questionText, RUBRIC_ORDER, speaker, stageLabel, transcriptMarkdown } from "./reportView.ts";
import "../styles/report.css";

const POLL_MS = 2000;
type Debug = "generating" | "error" | "empty" | "long" | undefined;

/** Dev only: ?state=generating|error|empty|long changes how a real session is shown. */
function applyDebug(reply: SessionReply, debug: Debug): SessionReply {
  if (!import.meta.env.DEV || !debug) return reply;
  if (debug === "generating") return { session: reply.session, reportStatus: "generating", reportStage: "writing" };
  if (debug === "error") return { session: reply.session, reportStatus: "failed", reportError: "The language model on this computer did not answer." };
  if (debug === "empty") return { ...reply, reportStatus: "ready", report: { sessionId: reply.session.id, summary: "There was nothing to review: no candidate answers were recorded in this session.", perQuestion: [], delivery: reply.report?.delivery ?? { wordsPerMinute: 0, fillerCount: 0, medianAnswerSec: 0, longestPauseMs: 0, interruptedCount: 0 }, nextDrill: [] } };
  if (debug === "long" && reply.report) {
    const pad = " Then I worked with the engineers on a plan, and we also had to deal with a provider who changed an interface in the middle of the project, which was a whole other story, because we had planned the release around it and then had to move it twice, and I spent a lot of that month on calls explaining the schedule to people who had not been part of the original plan.";
    const report: ReportData = {
      ...reply.report,
      summary: reply.report.summary + " " + reply.report.summary,
      perQuestion: reply.report.perQuestion.map((q, i) => (i === 0 ? { ...q, strengths: q.strengths.map((n, j) => (j === 0 ? { ...n, quote: n.quote + pad } : n)), rewrite: (q.rewrite ?? "Rewrite sample.") + pad + pad } : q)),
    };
    return { ...reply, report };
  }
  return reply;
}

function useReport(id: string, debug: Debug) {
  const [reply, setReply] = useState<SessionReply>();
  const [loadError, setLoadError] = useState<string>();
  const [bankTitle, setBankTitle] = useState<string>();
  const generating = reply?.reportStatus === "generating";

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const next = applyDebug(await fetchSessionReport(id, signal), debug);
        setReply(next);
        setLoadError(undefined);
        return next;
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return undefined;
        setLoadError(e instanceof Error ? e.message : String(e));
        return undefined;
      }
    },
    [id, debug],
  );

  useEffect(() => {
    const ac = new AbortController();
    void load(ac.signal);
    return () => ac.abort();
  }, [load]);

  useEffect(() => {
    if (!generating) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) void load();
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [generating, load]);

  const bankId = reply?.session.bankId;
  useEffect(() => {
    if (bankId) void fetchBankTitle(bankId).then(setBankTitle);
  }, [bankId]);

  return { reply, loadError, bankTitle, reload: load };
}

function usePlayer(sessionId: string): Player {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<number>();
  const [broken, setBroken] = useState<ReadonlySet<number>>(new Set());

  const stop = useCallback(() => {
    audio.current?.pause();
    audio.current = null;
    setPlaying(undefined);
  }, []);
  useEffect(() => stop, [sessionId, stop]);

  const toggle = useCallback(
    (turnIndex: number, url: string) => {
      if (audio.current && playing === turnIndex) return stop();
      audio.current?.pause();
      const el = new Audio(url);
      audio.current = el;
      setPlaying(turnIndex);
      const markBroken = () => {
        if (audio.current !== el) return;
        audio.current = null;
        setPlaying(undefined);
        setBroken((prev) => new Set(prev).add(turnIndex));
      };
      el.addEventListener("ended", () => {
        if (audio.current === el) stop();
      });
      el.addEventListener("error", markBroken);
      el.play().catch(markBroken);
    },
    [playing, stop],
  );
  return { playing, broken, toggle };
}

function Notes({ title, notes, session, player }: { title: string; notes: QuestionReport["strengths"]; session: Session; player: Player }) {
  if (notes.length === 0) return null;
  return (
    <div>
      <h4>{title}</h4>
      <ul className="findings">
        {notes.map((n, i) => {
          const turn = session.turns.find((t) => t.index === n.turnIndex);
          const file = audioFile(turn);
          return (
            <li className="finding" key={i}>
              <p>{n.note}</p>
              <Quote text={n.quote} />
              {n.unverified ? (
                <p className="warn">
                  <strong>Not verified.</strong> This quote could not be matched to the transcript.
                </p>
              ) : null}
              <div className="finding-foot">
                <span>
                  Turn {n.turnIndex}
                  {turn ? `, ${speaker(turn)}` : ""}
                </span>
                <PlayButton turn={turn} url={file ? audioUrl(session.id, file) : undefined} player={player} />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Rewrite({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = isLong(text);
  return (
    <div>
      <h4>Suggested rewrite</h4>
      <div className="quote-wrap spaced-top">
        <blockquote className={`quote${long && !open ? " clamped" : ""}`}>
          <p>{text}</p>
        </blockquote>
        {long ? <ShowMore open={open} onToggle={() => setOpen(!open)} /> : null}
      </div>
    </div>
  );
}

function QuestionBlock({ q, n, session, player, articleRef }: { q: QuestionReport; n: number; session: Session; player: Player; articleRef: (el: HTMLElement | null) => void }) {
  const hasNotes = q.strengths.length + q.gaps.length > 0;
  return (
    <article className="question" aria-labelledby={`q${n}`} id={`question-${n}`} tabIndex={-1} ref={articleRef}>
      <h3 id={`q${n}`}>{questionText(session, q.questionId, q.questionText)}</h3>
      {hasNotes ? null : <p className="note">No notes were written for this question.</p>}
      <Notes title="What held up" notes={q.strengths} session={session} player={player} />
      <Notes title="What was vague" notes={q.gaps} session={session} player={player} />
      {hasNotes ? (
        <div>
          <h4>Scores</h4>
          <ul className="rubric">
            {RUBRIC_ORDER.map((r) => (
              <li key={r.key}>
                <span className="r-name">{r.label}</span>
                <span className="r-score">{q.rubric[r.key]} of 4</span>
                {q.rubricReasons?.[r.key] ? <span className="r-reason">{q.rubricReasons[r.key]}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {q.rewrite ? <Rewrite text={q.rewrite} /> : null}
    </article>
  );
}

function TranscriptList({ session, player }: { session: Session; player: Player }) {
  if (session.turns.length === 0) return <p className="note">No turns were recorded.</p>;
  return (
    <ol className="transcript">
      {session.turns.map((t: Turn) => {
        const file = audioFile(t);
        return (
          <li key={t.index}>
            <span className="who">
              {speaker(t)}, turn {t.index}
            </span>
            <p>{t.text.trim() || "No speech was recognised in this turn."}</p>
            <div className="finding-foot">
              <PlayButton turn={t} url={file ? audioUrl(session.id, file) : undefined} player={player} />
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function Report() {
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const raw = params.get("state");
  const debug: Debug = raw === "generating" || raw === "error" || raw === "empty" || raw === "long" ? raw : undefined;
  const { reply, loadError, bankTitle, reload } = useReport(id, debug);
  const player = usePlayer(id);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string>();
  const refs = useRef<Array<HTMLElement | null>>([]);

  const onKey = useCallback((e: React.KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const target = e.target as HTMLElement;
    if (target.closest("input, textarea, select")) return;
    const here = refs.current.findIndex((el) => el && el.contains(target));
    const next = nextQuestionIndex(here < 0 ? -1 : here, refs.current.length, e.key);
    if (next === undefined) return;
    e.preventDefault();
    refs.current[next]?.focus();
    refs.current[next]?.scrollIntoView({ block: "start" });
  }, []);

  const meta = useMemo(() => (reply ? metaLine(reply.session, bankTitle, reply.session.profileId.charAt(0).toUpperCase() + reply.session.profileId.slice(1)) : ""), [reply, bankTitle]);

  async function onRetry() {
    setRetrying(true);
    setRetryError(undefined);
    try {
      await retryReport(id);
      await reload();
    } catch (e) {
      setRetryError(e instanceof Error ? e.message : String(e));
    } finally {
      setRetrying(false);
    }
  }

  if (loadError && !reply) {
    return (
      <div className="page">
        <Header />
        <main>
          <h1>Session report</h1>
          <div className="banner error spaced" role="alert">
            <p className="banner-title">The report could not be loaded.</p>
            <p>{loadError}</p>
            <button type="button" className="btn btn-primary" onClick={() => void reload()}>
              Try again
            </button>
          </div>
        </main>
      </div>
    );
  }
  if (!reply) {
    return (
      <div className="page">
        <Header />
        <main aria-busy="true">
          <h1>Session report</h1>
          <p className="note spaced-top" role="status">
            Loading the session.
          </p>
        </main>
      </div>
    );
  }

  const { session, report, reportStatus } = reply;
  const stage = stageLabel(reply.reportStage);
  const notEnded = session.status === "created" || session.status === "running";
  const failedLike = reportStatus === "failed" || (reportStatus === "none" && !notEnded);
  const nothing = reportStatus === "ready" && report !== undefined && report.perQuestion.length === 0;
  refs.current = [];

  return (
    <div className="page" onKeyDown={onKey}>
      <Header />
      <main>
        <h1>Session report</h1>
        <p className="meta">{meta}</p>

        {reportStatus === "generating" ? (
          <div className="banner spaced" role="status">
            <p className="banner-title">
              Writing your report. Stage {stage.step} of {stage.of}: {stage.text}.
            </p>
            <p>This usually takes under a minute. You can leave this page open.</p>
            <p>
              <progress value={stage.step} max={stage.of} aria-label={`Report progress, stage ${stage.step} of ${stage.of}`}>
                {stage.step} of {stage.of}
              </progress>
            </p>
          </div>
        ) : null}

        {notEnded ? (
          <div className="banner spaced" role="status">
            <p className="banner-title">This session has not ended.</p>
            <p>The report is written after the session ends.</p>
            <p className="gap-top">
              <Link className="btn" to={`/session/${session.id}`}>
                Back to the room
              </Link>
            </p>
          </div>
        ) : null}

        {failedLike ? (
          <div className="banner error spaced" role="alert">
            <p className="banner-title">{reportStatus === "failed" ? "The feedback could not be written." : "No report has been written for this session yet."}</p>
            <p>
              {reportStatus === "failed" ? (reply.reportError ?? "The language model did not answer.") : "The server restarted before the report was saved."} Your transcript is saved and readable below. Retry to write the report again.
            </p>
            {retryError ? <p>{retryError}</p> : null}
            <button type="button" className="btn btn-primary" disabled={retrying} onClick={() => void onRetry()}>
              {retrying ? "Starting" : "Retry report"}
            </button>
          </div>
        ) : null}

        {reply.reportWarnings && reply.reportWarnings.length > 0 ? (
          <div className="banner spaced" role="status">
            <p className="banner-title">Some notes are incomplete.</p>
            <ul className="plain-list">
              {reply.reportWarnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {nothing && report ? (
          <section className="spaced-block" aria-labelledby="nothing">
            <h2 id="nothing">Nothing to review</h2>
            <p>The session ended before you answered a question, so there is no feedback to write. The transcript below shows what was recorded.</p>
            <p className="gap-top">
              <Link className="btn btn-primary" to="/">
                Set up a new session
              </Link>
            </p>
          </section>
        ) : null}

        {reportStatus === "ready" && report && !nothing ? (
          <>
            <section aria-labelledby="summary">
              <h2 id="summary">Summary</h2>
              <p>{report.summary}</p>
              <p className="note gap-top">This is practice feedback on one session. It does not predict a hiring decision.</p>
            </section>

            <section aria-labelledby="delivery">
              <h2 id="delivery">Delivery</h2>
              <dl className="facts">
                {deliveryRows(report.delivery).map((r) => (
                  <div key={r.label}>
                    <dt>{r.label}</dt>
                    <dd>{r.value}</dd>
                  </div>
                ))}
              </dl>
            </section>

            <section aria-labelledby="questions">
              <h2 id="questions">Questions</h2>
              {report.perQuestion.length > 1 ? <p className="note">Press J or K to step between questions.</p> : null}
              {report.perQuestion.map((q, i) => (
                <QuestionBlock key={q.questionId} q={q} n={i + 1} session={session} player={player} articleRef={(el) => void (refs.current[i] = el)} />
              ))}
            </section>

            {report.nextDrill.length > 0 ? (
              <section aria-labelledby="drill">
                <h2 id="drill">Next drill</h2>
                <ol className="drill">
                  {report.nextDrill.map((d, i) => (
                    <li key={i}>{d}</li>
                  ))}
                </ol>
              </section>
            ) : null}
          </>
        ) : null}

        <section aria-labelledby="transcript">
          <h2 id="transcript">Transcript</h2>
          <p className="gap-top-sm">
            <button type="button" className="btn" onClick={() => download(exportFileName(session), transcriptMarkdown(session, report, meta))}>
              Export transcript as markdown
            </button>
          </p>
          <TranscriptList session={session} player={player} />
        </section>
      </main>
    </div>
  );
}

function Header() {
  return (
    <header className="site-header">
      <span className="wordmark">Interview room</span>
      <nav aria-label="Screens">
        <Link to="/">Setup</Link>
      </nav>
    </header>
  );
}
