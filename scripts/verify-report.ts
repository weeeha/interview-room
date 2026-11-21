// Quote check (AC-14) on a saved report.
// Usage: npx tsx scripts/verify-report.ts <sessionId>   (reads sessions/<id>/session.json and report.json; SESSIONS_DIR overrides the folder)
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { FeedbackReport, Session } from "../shared/types.ts";
import { verifyQuotes } from "../server/src/feedback/verifyQuotes.ts";

const id = process.argv[2];
if (!id) {
  console.error("Usage: npx tsx scripts/verify-report.ts <sessionId>");
  process.exit(2);
}
const dir = join(process.env.SESSIONS_DIR || "./sessions", id);
const session = JSON.parse(readFileSync(join(dir, "session.json"), "utf8")) as Session;
const report = JSON.parse(readFileSync(join(dir, "report.json"), "utf8")) as FeedbackReport;
const notes = report.perQuestion.flatMap((p) => [...p.strengths, ...p.gaps]);
const result = verifyQuotes(report, session);
const marked = notes.filter((n) => n.unverified).length;
console.log(`quotes verified ${notes.length - result.failures.length} of ${notes.length} (${marked} marked unverified by the report)`);
for (const f of result.failures) console.log(`  FAIL ${f.questionId} ${f.list}[${f.index}] turn ${f.turnIndex} ${f.reason}: "${f.quote}"`);
process.exit(result.ok ? 0 : 1);
