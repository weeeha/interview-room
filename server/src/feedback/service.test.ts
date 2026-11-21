import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { FeedbackReport, Session } from "../../../shared/types.ts";
import { createApp } from "../index.ts";
import { createFakeLLM } from "../providers/llm/fake.ts";
import { createFakeSTT } from "../providers/stt/fake.ts";
import { createFakeTTS } from "../providers/tts/fake.ts";
import { createFakeFeedbackLLM, createFeedbackService, feedbackConcurrency, withQuestionIds } from "./service.ts";
import { verifyQuotes } from "./verifyQuotes.ts";

const fixture = JSON.parse(readFileSync(new URL("../../../fixtures/transcripts/two-minute.json", import.meta.url), "utf8")) as Session;
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function setup(session: Session) {
  const dir = mkdtempSync(join(tmpdir(), "ir-feedback-"));
  dirs.push(dir);
  mkdirSync(join(dir, session.id), { recursive: true });
  writeFileSync(join(dir, session.id, "session.json"), JSON.stringify(session));
  return dir;
}
const ended = (over: Partial<Session> = {}): Session => ({ ...structuredClone(fixture), id: "abc123def", status: "ended", ...over });

describe("feedback concurrency setting", () => {
  it("test_feedback_concurrency_setting", () => {
    expect(feedbackConcurrency({})).toBeGreaterThanOrEqual(1);
    expect(feedbackConcurrency({ FEEDBACK_CONCURRENCY: "3" })).toBe(3);
    expect(feedbackConcurrency({ FEEDBACK_CONCURRENCY: "1" })).toBe(1);
    expect(feedbackConcurrency({ FEEDBACK_CONCURRENCY: "99" })).toBe(8);
    expect(feedbackConcurrency({ FEEDBACK_CONCURRENCY: "0" })).toBe(feedbackConcurrency({}));
    expect(feedbackConcurrency({ FEEDBACK_CONCURRENCY: "abc" })).toBe(feedbackConcurrency({}));
  });
});

describe("feedback service", () => {
  it("test_report_ready_after_session_ends", async () => {
    const session = ended();
    const dir = setup(session);
    const svc = createFeedbackService({ sessionsDir: dir, banksDir: "./banks", getLLM: createFakeFeedbackLLM });
    expect((await svc.info(session.id)).reportStatus).toBe("none");
    const done = svc.start(session);
    expect((await svc.info(session.id)).reportStatus).toBe("generating");
    await done;
    const info = await svc.info(session.id);
    expect(info.reportStatus).toBe("ready");
    expect(info.report?.perQuestion.length).toBeGreaterThan(0);
    expect(existsSync(join(dir, session.id, "report.json"))).toBe(true);
    expect(verifyQuotes(info.report as FeedbackReport, session).ok).toBe(true);
  });

  it("test_report_failed_then_retry", async () => {
    const session = ended();
    const dir = setup(session);
    let attempt = 0;
    const svc = createFeedbackService({
      sessionsDir: dir,
      banksDir: "./banks",
      getLLM: () => (++attempt === 1 ? createFakeLLM([new Error("model is down")]) : createFakeFeedbackLLM()),
    });
    await svc.start(session);
    const failed = await svc.info(session.id);
    expect(failed.reportStatus).toBe("failed");
    expect(failed.reportError).toContain("model is down");
    expect(existsSync(join(dir, session.id, "report.json"))).toBe(false);
    expect(await svc.retry(session.id)).toBe("started");
    await svc.idle();
    expect((await svc.info(session.id)).reportStatus).toBe("ready");
    expect(await svc.retry(session.id)).toBe("has_report");
  });

  it("test_report_empty_session_makes_no_model_call", async () => {
    const session = ended({ turns: fixture.turns.filter((t) => t.role === "interviewer").slice(0, 1) });
    const dir = setup(session);
    const llm = createFakeLLM();
    const svc = createFeedbackService({ sessionsDir: dir, banksDir: "./banks", getLLM: () => llm });
    await svc.start(session);
    const info = await svc.info(session.id);
    expect(llm.calls).toHaveLength(0);
    expect(info.reportStatus).toBe("ready");
    expect(info.report?.perQuestion).toEqual([]);
    expect(info.report?.summary).toContain("nothing to review");
  });

  it("test_restart_ended_without_report_is_none_and_retry_works", async () => {
    const session = ended();
    const dir = setup(session);
    const svc = createFeedbackService({ sessionsDir: dir, banksDir: "./banks", getLLM: createFakeFeedbackLLM });
    expect((await svc.info(session.id)).reportStatus).toBe("none");
    expect(await svc.retry(session.id)).toBe("started");
    await svc.idle();
    expect((await svc.info(session.id)).reportStatus).toBe("ready");
    const fresh = createFeedbackService({ sessionsDir: dir, banksDir: "./banks", getLLM: createFakeFeedbackLLM });
    expect((await fresh.info(session.id)).reportStatus).toBe("ready");
  });

  it("test_candidate_turns_without_question_id_are_reviewed", async () => {
    const stripped = ended({ turns: fixture.turns.map((t) => (t.role === "candidate" ? { ...t, questionId: undefined } : t)) });
    expect(withQuestionIds(stripped).turns.filter((t) => t.role === "candidate").map((t) => t.questionId)).toEqual(["q-migration", "q-migration", "q-strength", "q-growth"]);
    const dir = setup(stripped);
    const svc = createFeedbackService({ sessionsDir: dir, banksDir: "./banks", getLLM: createFakeFeedbackLLM });
    await svc.start(stripped);
    const info = await svc.info(stripped.id);
    expect(info.report?.perQuestion).toHaveLength(3);
    expect(verifyQuotes(info.report as FeedbackReport, stripped).ok).toBe(true);
  });

  it("test_retry_refuses_running_session_and_unknown_ids", async () => {
    const session = ended({ status: "running" });
    const dir = setup(session);
    const svc = createFeedbackService({ sessionsDir: dir, banksDir: "./banks", getLLM: createFakeFeedbackLLM });
    expect(await svc.retry(session.id)).toBe("not_ended");
    expect(await svc.retry("nosuchsession")).toBe("no_session");
    expect(await svc.retry("../x")).toBe("no_session");
  });
});

describe("report routes", () => {
  it("test_end_session_with_fake_providers_produces_report", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ir-feedback-app-"));
    dirs.push(dir);
    const env = { QUESTION_BANK_DIR: "./banks", STT_PROVIDER: "fake", LLM_PROVIDER: "fake", TTS_PROVIDER: "fake" };
    const app = createApp(env, { sessionsDir: dir, providers: { llm: createFakeLLM(), stt: createFakeSTT(), tts: createFakeTTS() } });
    const banks = (await (await app.request("/api/banks")).json()) as { banks: Array<{ id: string }> };
    const created = (await (await app.request("/api/session", { method: "POST", body: JSON.stringify({ bankId: banks.banks[0]!.id, profileId: "neutral" }) })).json()) as { session: Session };
    const id = created.session.id;
    expect(((await (await app.request(`/api/session/${id}`)).json()) as { reportStatus: string }).reportStatus).toBe("none");
    expect((await app.request(`/api/session/${id}/report/retry`, { method: "POST" })).status).toBe(409);
    await app.request(`/api/session/${id}/end`, { method: "POST", body: "{}" });
    let body: { reportStatus: string; report?: FeedbackReport } = { reportStatus: "none" };
    for (let i = 0; i < 50 && body.reportStatus !== "ready"; i++) {
      body = (await (await app.request(`/api/session/${id}`)).json()) as typeof body;
      if (body.reportStatus !== "ready") await new Promise((r) => setTimeout(r, 20));
    }
    expect(body.reportStatus).toBe("ready");
    expect(body.report?.summary).toContain("nothing to review");
    expect((await app.request(`/api/session/${id}/report/retry`, { method: "POST" })).status).toBe(409);
    expect((await app.request(`/api/session/nosuchid1/report/retry`, { method: "POST" })).status).toBe(404);
  });
});
