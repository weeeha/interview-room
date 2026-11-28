// Fetch helpers for the report screen. Kept apart from api.ts, which another screen owns.
import type { FeedbackReport, Session } from "../../shared/types.ts";

export type ReportStatus = "none" | "generating" | "ready" | "failed";
export type ReportStage = "metrics" | "writing" | "verifying" | "retrying" | "done";

/** The extra fields kept beside each question (not in the shared type). */
export type QuestionReport = FeedbackReport["perQuestion"][number] & { rubricReasons?: Partial<Record<RubricKey, string>>; questionText?: string };
export type RubricKey = "structure" | "specificity" | "relevance" | "concision";
export type Report = Omit<FeedbackReport, "perQuestion"> & { perQuestion: QuestionReport[] };

export type SessionReply = {
  session: Session;
  report?: Report;
  reportStatus: ReportStatus;
  reportStage?: ReportStage;
  reportError?: string;
  reportWarnings?: string[];
};

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    if (body.error) return body.error;
  } catch {
    // not JSON
  }
  return `The server answered ${res.status}.`;
}

export async function fetchSessionReport(id: string, signal?: AbortSignal): Promise<SessionReply> {
  let res: Response;
  try {
    res = await fetch(`/api/session/${encodeURIComponent(id)}`, { signal });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new Error("The server did not answer. Check that it is running on port 8941.", { cause: e });
  }
  if (!res.ok) throw new Error(res.status === 404 ? "This session was not found." : await readError(res));
  return (await res.json()) as SessionReply;
}

export async function retryReport(id: string): Promise<void> {
  const res = await fetch(`/api/session/${encodeURIComponent(id)}/report/retry`, { method: "POST" });
  if (!res.ok) throw new Error(await readError(res));
}

/** Question bank titles, best effort. The meta line works without it. */
export async function fetchBankTitle(bankId: string): Promise<string | undefined> {
  try {
    const res = await fetch("/api/banks");
    if (!res.ok) return undefined;
    const body = (await res.json()) as { banks?: Array<{ id: string; title: string }> };
    return body.banks?.find((b) => b.id === bankId)?.title;
  } catch {
    return undefined;
  }
}
