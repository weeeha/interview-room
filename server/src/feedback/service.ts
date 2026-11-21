// Runs the feedback pass in the background after a session ends and keeps its status.
// Status lives in memory per session. report.json on disk is the durable answer: a session that is
// "ended" with no report.json reports "none" after a restart, and retry starts the run again.
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Hono } from "hono";
import type { FeedbackReport, QuestionBank, Session } from "../../../shared/types.ts";
import { loadBanks } from "../banks/load.ts";
import { createLogger } from "../log.ts";
import { createFakeLLM } from "../providers/llm/fake.ts";
import type { ChatMessage, LLMProvider } from "../providers/llm/types.ts";
import { createFeedbackLLM, runFeedback, type FeedbackStage } from "./run.ts";

const log = createLogger("feedback");

export type ReportStatus = "none" | "generating" | "ready" | "failed";
export type ReportInfo = { report?: FeedbackReport; reportStatus: ReportStatus; reportStage?: FeedbackStage; reportError?: string; reportWarnings?: string[] };

type State = { status: ReportStatus; stage?: FeedbackStage; error?: string; warnings?: string[] };

export type FeedbackServiceOptions = {
  sessionsDir: string;
  banksDir: string;
  /** Builds the model for one run. Default: createFeedbackLLM(env). */
  getLLM?: () => LLMProvider;
  env?: Record<string, string | undefined>;
};

const ID_RE = /^[a-z0-9]{6,32}$/;

/**
 * Deterministic stand-in for the feedback model, used only when LLM_PROVIDER=fake.
 * It quotes the opening words of the first candidate turn of each question, so the real
 * parser and the quote check run on valid input.
 */
export function createFakeFeedbackLLM(): LLMProvider {
  return createFakeLLM([], (messages: ChatMessage[]) => {
    const system = messages[0]?.content ?? "";
    if (system.includes("overall summary")) {
      return JSON.stringify({ summary: "This is a placeholder summary from the fake model. Read the notes under each question.", nextDrill: ["Answer one question again in 90 seconds.", "Say one number in every answer."] });
    }
    const user = messages.map((m) => m.content).join("\n");
    const turns = [...user.matchAll(/^\[turn (\d+)\] Candidate: (.+)$/gm)];
    const first = turns[0];
    const words = (first?.[2] ?? "").split(/\s+/).filter(Boolean);
    const quote = words.slice(0, 6).join(" ");
    const gapQuote = (words.length > 12 ? words.slice(6, 12) : words.slice(0, 6)).join(" ");
    const turnIndex = Number(first?.[1] ?? 0);
    return JSON.stringify({
      strengths: [{ note: "Fake model note: this answer opened clearly.", turnIndex, quote }],
      gaps: [{ note: "Fake model note: add a result with a number.", turnIndex, quote: gapQuote }],
      rubric: { structure: 3, specificity: 2, relevance: 3, concision: 3 },
      reasons: { structure: "Fake reason.", specificity: "Fake reason.", relevance: "Fake reason.", concision: "Fake reason." },
      ...(system.includes('"rewrite"') ? { rewrite: "Fake rewrite: " + words.join(" ") } : {}),
    });
  });
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2));
  await rename(tmp, path);
}

export function createFeedbackService(opts: FeedbackServiceOptions) {
  const env = opts.env ?? process.env;
  const states = new Map<string, State>();
  const running = new Map<string, Promise<void>>();
  const dirOf = (id: string) => join(opts.sessionsDir, id);

  const makeLLM = (): LLMProvider => opts.getLLM?.() ?? ((env.LLM_PROVIDER || "local") === "fake" ? createFakeFeedbackLLM() : createFeedbackLLM(env));

  async function readReport(id: string): Promise<FeedbackReport | undefined> {
    try {
      return JSON.parse(await readFile(join(dirOf(id), "report.json"), "utf8")) as FeedbackReport;
    } catch {
      return undefined;
    }
  }

  async function readSession(id: string): Promise<Session | undefined> {
    try {
      return JSON.parse(await readFile(join(dirOf(id), "session.json"), "utf8")) as Session;
    } catch {
      return undefined;
    }
  }

  /** Starts a run. Returns a promise that settles when the run is over; it never rejects. */
  function start(session: Session): Promise<void> {
    const id = session.id;
    const existing = running.get(id);
    if (existing) return existing;
    states.set(id, { status: "generating", stage: "metrics" });
    const job = (async () => {
      try {
        const bank: QuestionBank = loadBanks(opts.banksDir).find((b) => b.id === session.bankId) ?? { id: session.bankId, title: session.bankId, sourcePath: "none", questions: [] };
        const { report, warnings } = await runFeedback({
          session,
          bank,
          llm: makeLLM(),
          onStage: (stage) => states.set(id, { ...(states.get(id) as State), status: "generating", stage }),
        });
        await mkdir(dirOf(id), { recursive: true });
        await writeJsonAtomic(join(dirOf(id), "report.json"), report);
        states.set(id, { status: "ready", ...(warnings.length ? { warnings } : {}) });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        log.error(`feedback for ${id} failed: ${message}`);
        states.set(id, { status: "failed", error: message });
      } finally {
        running.delete(id);
      }
    })();
    running.set(id, job);
    return job;
  }

  /** The hook handed to the session service. */
  function onSessionEnded(session: Session): void {
    void start(session);
  }

  async function info(id: string): Promise<ReportInfo> {
    const report = await readReport(id);
    const state = states.get(id);
    if (state?.status === "generating") return { reportStatus: "generating", ...(state.stage ? { reportStage: state.stage } : {}) };
    if (report) return { report, reportStatus: "ready", ...(state?.warnings ? { reportWarnings: state.warnings } : {}) };
    if (state?.status === "failed") return { reportStatus: "failed", reportError: state.error ?? "The report could not be written." };
    return { reportStatus: "none" };
  }

  /** Runs the pass again for an ended session that has no report. Returns false when it cannot. */
  async function retry(id: string): Promise<"started" | "running" | "no_session" | "not_ended" | "has_report"> {
    if (!ID_RE.test(id)) return "no_session";
    const session = await readSession(id);
    if (!session) return "no_session";
    if (session.status !== "ended" && session.status !== "reported") return "not_ended";
    if (running.has(id)) return "running";
    if (existsSync(join(dirOf(id), "report.json"))) return "has_report";
    void start(session);
    return "started";
  }

  /** Resolves when no run is active. For tests. */
  async function idle(): Promise<void> {
    while (running.size > 0) await Promise.all([...running.values()]);
  }

  return { start, onSessionEnded, info, retry, idle };
}

export type FeedbackService = ReturnType<typeof createFeedbackService>;

export function feedbackRoutes(service: FeedbackService): Hono {
  const app = new Hono();
  app.post("/api/session/:id/report/retry", async (c) => {
    const result = await service.retry(c.req.param("id"));
    if (result === "no_session") return c.json({ error: "Session not found" }, 404);
    if (result === "not_ended") return c.json({ error: "This session has not ended" }, 409);
    if (result === "has_report") return c.json({ error: "The report is already written" }, 409);
    return c.json({ ok: true }, 202);
  });
  return app;
}
