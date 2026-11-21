# Phase 4 notes: feedback

## Design of the feedback run (task 4.2)
- One model call per question that has candidate answers, then one call for the summary and drills. Chosen over a single giant call because a small local model copies quotes much better from a short transcript, and a retry then costs one question, not the whole report. A first attempt with the default local provider (120 token cap) cut the JSON off mid-way for every question; `createFeedbackLLM` in run.ts raises the budget to 1500 tokens and sets temperature 0.2 for the local model (2000 tokens for Claude).
- Delivery numbers come only from `computeDelivery`. The model is told not to write them, and a test feeds a made-up number to confirm it is ignored.
- Candidate turns are numbered "[turn N]" in the prompt. Quotes must be copied from one turn, 5 to 20 words.
- Failure handling per question: invalid JSON, schema failure or a failed quote gets exactly one regeneration with the failures listed. If quotes still fail, the report is kept, those notes get `unverified: true` (added to shared/types.ts) and a warning is returned. If JSON stays unusable the question is left empty with a warning.
- Rewrite is asked for only when the bank entry has `hasReferenceAnswer: true`. The reference answer goes to the model marked as "for your judgement only, never quote it". The rewrite rule allows only facts the candidate stated.
- Rubric reasons (one line per score) are kept on each per-question object as `rubricReasons`, beside the typed fields. They are not in `FeedbackReport`.
- A stage callback reports metrics, writing, verifying, retrying, done for the loading label.

## Real check: local model (Gemma 4 E4B Q8, llama-server at 127.0.0.1:8944)
Command: `LLM_PROVIDER=local LOCAL_LLM_URL=http://127.0.0.1:8944/v1 LOCAL_LLM_MODEL=gemma-4-E4B-it-Q8_0.gguf npx tsx scripts/feedback-check.ts`
Fixture: two-minute.json, 3 questions, 4 model calls per run. Not a hiring or quality benchmark, one invented transcript.

| Run | Seconds | JSON valid first try | Quotes verified first try | After retry | Retries |
|---|---|---|---|---|---|
| 1 | 28.4 | yes (all 4 calls) | 12 of 12 | 12 of 12 | 0 |
| 2 | 25.1 | yes | 10 of 10 | 10 of 10 | 0 |
| 3 | 26.8 | yes | 11 of 11 | 11 of 11 | 0 |

Before the token fix: 21 s, every question failed JSON twice (truncated reply), report came back empty with warnings. That path works as designed, but it shows the provider budget matters.

My read of whether the notes are true to the transcript (strict quote check passes, so the question is only whether the note fits the quote):
- Mostly true: hesitant opening ("Er, I would say..."), a stated outcome ("finished a week early"), a specific action (script plus hand-checked sample), growth answer is general ("I would start by asking questions").
- Weak fits: run 2 says the answer lacked a numeric result, but quotes the line that does state "a week early"; run 2 calls the strength answer "very brief and lacks depth on weakness" although turn 6 states the weakness; run 3 says the role was unclear and quotes a line that is only loosely related. Small model, so about 1 note in 10 argues a point the quote does not support. The quote check proves the quote is real, not that the note is fair.
- Rewrites used only facts from the candidate's turns (ten percent, forty bad rows, a week early). None added a fact. q-strength had no reference answer in the script bank and correctly got no rewrite.
- No hiring prediction appeared in any run.

Claude column: not run, paid.

## Feedback service and report screen (task 4.4)
Real run, 2026-11-21, local models (Gemma 4 E4B Q8 at 8944, whisper 8942, Kokoro 8943), my own server on 8951 and Vite on 8950 so the other agent's ports stayed free.
- Session 0mwqs3zw884a9, made by `scripts/scripted-session.ts` (22 turns, 3 minute target, ended by the script). The end hook started the feedback run. Seconds from `endedAt` to `report.json` written: 39.9 (AC-13 asks for 60 s on a 10-minute session; this one is shorter, and the pass makes one call per question that has answers, so a 10-minute session with more questions will take longer. Not measured at 10 minutes.)
- `npx tsx scripts/verify-report.ts 0mwqs3zw884a9`: quotes verified 14 of 14 after a second run of the same session through the retry route (first run: 15 of 15). AC-14 holds for these two runs. 0 notes marked unverified.
- Retry route proven live: removed report.json, POST /api/session/:id/report/retry, status went generating (writing, verifying) to ready in about 40 s.
- Finding 1 (fixed in the service): candidate turns in the session log have no `questionId`, and `runFeedback` groups turns by it, so the first real run wrote "nothing to review" with 0 questions. `withQuestionIds` in service.ts gives each candidate turn the id of the nearest earlier turn that has one. The better fix is to set questionId on candidate turns in session.ts; I left the turn pipeline alone as instructed.
- Finding 2: the first interviewer turn joins the opening and the first question, so reading the question from the log showed the greeting as the heading. The service now stores the bank wording as `questionText` beside each question in report.json (same pattern as `rubricReasons`).
- Finding 3: a scripted session sends no speech timings, so candidate turns have zero length and the delivery pace came out as 48321 words per minute. The screen shows "Not measured" for pace and answer length when the median answer length is 0. Real browser sessions send timings.
- With all fake providers the service uses `createFakeFeedbackLLM` (quotes the first words of each candidate turn), so a fake session ends with a valid report; only used when LLM_PROVIDER=fake or providers are injected.
- Checked in the Browser pane (Chrome engine) at 1440x900 and 390x844, light and dark: default report, empty (real: session ended with no turns), error and generating (dev-only `?state=` override), long content with "Show more", key J stepping between questions with a visible focus outline, no horizontal overflow at 390, no control under 24 px. Play button on the quote for turn 1: network log shows GET /api/session/0mwqs3zw884a9/audio/turn-01.wav 200, button changed to "Stop turn 1" with the tint background. Real error state (model down) not forced in the browser; the failed-then-retry path is covered by a service test. Safari: not checked.
- vite.config.ts now reads `API_TARGET` and `APP_PORT` (defaults unchanged) so a second dev server can run beside the first.

## Report screen audit (unslop)
Constraints read before building, audit run after. Tools: `rules.mjs check` on Report.tsx, ReportParts.tsx, report.css; `render.mjs` at 375 and 1280, light and dark, on the default, empty and error pages; `render.mjs --selftest` passed first.
- MOT-7 WARN: the 2 s poll ran while the tab was hidden. Fixed: the interval skips when `document.hidden`, and it only exists while the status is generating.
- EDGE WARN (render tier, 375 px): `span.visually-hidden` "audio" text at -1px from the edge. False positive: that span is the clipped screen-reader suffix of the play buttons (1 px, clipped, no visible text). Kept.
- CMP-7 (one filled control): the playing state first used the filled accent; changed to the accent tint with a stronger border so only Retry report or Set up a new session is filled in a state.
- STA-6 (never colour alone): unverified quotes carry the words "Not verified" and the warning sentence, the error banner carries the title text, play state changes the label to "Stop turn N".
- TYP-5/6/8: no eyebrows or tracked caps; headings run h1, h2, h3, h4 with a size or weight step (h4 is the draft's small subheading).
- RSP-1/2: 0 overflow at 375, 0 targets under 24 px (measured in page at 390).
- STA-1: loading, generating, error, empty, long and ready all designed and seen. STA-2: a failed fetch shows its own banner, never stale data.
- CPY: no exclamation marks, no em dashes, copy taken from the draft. Retry and export buttons are real (CMP-6); the Setup link goes to a real route.
- Not covered: Safari, forced-colors, 200 percent zoom, a right-to-left run.
Result: 0 FAIL, 1 false-positive family (EDGE), the rest fixed.
