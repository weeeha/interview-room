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
