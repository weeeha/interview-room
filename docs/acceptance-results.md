# Acceptance results from real local runs

Date of all runs: 2026-11-21. Mac: the owner's development Mac, headless Chrome 158 with a fake microphone, local services (Gemma 4 E4B Q8 on 8944, whisper large-v3-turbo on 8942, Kokoro on 8943), sample bank, neutral interviewer. Targets in `docs/spec.md` are untouched. Nothing here was tuned to pass.

TL;DR: AC-6 fails its initial median target (3.2 s and 3.6 s against 2.5 s); the 95th percentile passed in one run (3.7 s) and missed by 35 ms in the other (4.035 s against 4.0 s). AC-13 fails (68.8 s against 60 s). AC-7, AC-8, AC-9, AC-14, AC-16 and AC-17 pass in the headless setup. AC-1, AC-2, AC-5, AC-18 and the real-input session need the owner.

## Results

| Criterion | Result | Number | How measured | Date |
|---|---|---|---|---|
| AC-1 Seat view within 15 s, splat under 60 MB | NOT MEASURED | none | No Marble room file exists. `spike/results.md` has no real row, only a sample splat with no recorded time. | 2026-11-21 |
| AC-2 Room at 30 fps or more over 10 s | NOT MEASURED | none | Needs a visible browser with a real room. `docs/phase-3-notes.md`: hidden pane gave 1.4 fps, headless prints 60 with no room, neither counts. | 2026-11-21 |
| AC-3 Drag limited to `lookLimitDeg`, camera fixed | PASS | yaw stopped at +60 and -60, pitch at -30, position unchanged | Existing notes, `docs/phase-3-notes.md` (sample splat and unit tests). Not re-run here. | 2026-11-20 (notes) |
| AC-4 Missing splat: notice and full voice loop | PASS | notice shown, backdrop `flat`, 22 candidate turns completed, session ended | Re-seen in run 1 below (page notice text read over DevTools) and in `docs/phase-3-notes.md`. | 2026-11-21 |
| AC-5 Voice positioned toward the anchor | NOT MEASURED | none | Panner azimuth numbers exist in `docs/phase-3-notes.md`, but nobody listened with headphones. Needs the owner. | 2026-11-21 |
| AC-6 Gap median 2.5 s or less, p95 4 s or less, 20 or more turns | FAIL against initial target | run 1: median 3230 ms, p95 3700 ms (n=21). run 4: median 3600 ms, p95 4035 ms (n=21) | Browser `gapMs` in `session.json`: first audible interviewer sample minus the candidate's detected end of speech, so it includes the 1200 ms end-of-speech window. See the split below. Headless, no real speaker. | 2026-11-21 |
| AC-7 Interviewer audio stops within 500 ms of speech | PASS (headless) | 14 barge-ins, 213 to 399 ms, median about 383 ms | `endMs` of the interrupted turn minus the next candidate `startMs`, from the logs. Detail below. | 2026-11-21 |
| AC-8 Prompt after 8 s, offer after 12 s more | PASS | prompt 8.74 s after the opening ended, offer 12.74 s after the prompt ended, repeated 3 times | Dedicated silent run (fake microphone with only silence), logged turn times. Detail below. | 2026-11-21 |
| AC-9 10 min: 4 or more distinct questions, no repeat, 2 follow-ups at most, closing 9:00 to 11:00 | PASS | 7 distinct questions, 0 repeats, max 2 follow-ups per question, closing line at 9:08 (548.1 s) | Full session 0mwqucs2s22cd, 600 s target, sample bank. | 2026-11-21 |
| AC-10 Follow-up refers to the claim in the answer | PASS (my reading) | 14 of 14 follow-ups refer to what was said; 13 of 14 pick a main claim, 1 picks a neighbouring detail | Read by me from session 0mwqucs2s22cd, table below. Earlier check in `docs/phase-2-notes.md`: 5 of 5 responsive, 2 of 5 on the exact planted claim. | 2026-11-21 |
| AC-11 No invented fact about the candidate | NOT MEASURED against the real-input session | scripted session: 0 invented facts, 1 loose paraphrase | The spec asks for the owner's real-input session. I read all 14 follow-ups of the scripted session only. | 2026-11-21 |
| AC-12 Bank parser reads the owner's format | PASS (unit tests) | `server/src/banks/parse.test.ts`, part of 208 passing tests | `npm test`. The real bank has not been loaded (it is the owner's local folder). | 2026-11-21 |
| AC-13 Report ready within 60 s of ending a 10-min session | FAIL against initial target | 68.8 s | `report.json` modification time minus `endedAt` in `session.json`, session 0mwqucs2s22cd (same method as `docs/phase-4-notes.md`). Load 4.6 to 13.4. | 2026-11-21 |
| AC-14 Every quote appears word for word in its turn | PASS | 27 of 27 verified, 0 marked unverified | `npx tsx scripts/verify-report.ts 0mwqucs2s22cd`. Earlier 14 of 14 in `docs/phase-4-notes.md`. The check proves the quote is real, not that the note is fair. | 2026-11-21 |
| AC-15 Delivery numbers match a hand count | PASS (unit test) | `test_metrics_match_hand_count` in `server/src/feedback/metrics.test.ts` | `npm test`: 26 files, 208 tests, all passed. | 2026-11-21 |
| AC-16 No request leaves localhost with local providers | PASS for server and page; Chrome's own background traffic seen, see below | server sockets: only 127.0.0.1 ports 8942, 8943, 8944; page requests: only `localhost:8940` and `blob:` | `lsof` every second for the full 10-minute session, plus DevTools Network events. Detail below. Claude API clause not measured (paid, never enabled). | 2026-11-21 |
| AC-17 Nothing under `media/` or `sessions/`, no `.env`, no real bank in git | PASS | the `git ls-files` command printed nothing | Also: no tracked file contains `InterviewPreparationsBot` or `/Users/nickv`. `runway` appears twice, both product mentions (`README.md:67`, `docs/spec.md:148`: "Runway GWM Worlds 2 ... no public API"), not bank text. | 2026-11-21 |
| AC-18 Chrome and Safari complete a full session | NOT MEASURED | Chrome only (headless 158) | Safari needs the owner at a visible Safari. | 2026-11-21 |
| AC-19 `unslop` audit at four points | PARTIAL: all four audits are recorded, with two limits | phase 1 constraints before building (`draft/unslop-notes.md`, "Constraints taken from the skill" and "Project constraints"); phase 1 audit (`draft/unslop-notes.md`, "Audit, 2026-11-20": 9 findings, 8 fixed, 1 kept with a reason); room screen audit (`docs/phase-3-notes.md`, "Room screen audit (unslop)"); report screen audit (`docs/phase-4-notes.md`, "Report screen audit (unslop)") | Each audit names its tools (`rules.mjs check`, the render tier at 375 and 1280 or 390 and 1440, Impeccable `detect` for the room) and the result: 0 FAIL in the render tier. Limits: no separate fresh-eyes reviewer agent ran at any point (each notes the pass was done by the builder or auditor), and Safari was not checked in any of them. The notes also list real microphone, screen reader and a real Marble room as unchecked. | 2026-11-21 |

Note on the TL;DR: AC-6 p95 was 3700 ms in run 1 (pass) and 4035 ms in run 4 (misses 4000 ms by 35 ms). The median fails in both.

## How AC-6 was measured and what it cannot show

Setup: `scripts/e2e-fake-mic.mjs --answers 22 --turns 22 --gap-sec 16 --minutes 20` (new options). The fake microphone plays 22 invented answers (10 to 20 s each, macOS `say`) with 16 s of silence after each, so the interviewer finishes before the next answer. Session 0mwqtgg6d2538, 22 candidate turns, 21 interviewer replies with a gap value (silence prompts have none). `scripts/latency-table.ts` and the new `scripts/acceptance-stats.ts` print the numbers.

Definitions: gap is measured in the browser, from the candidate's detected end of speech to the first audible interviewer sample (`playback.onStart`). `sttMs`, `llmFirstTokenMs` and `ttsFirstAudioMs` are measured on the server. `llmFirstTokenMs` is 0 for bank questions because no model call is made (7 of 21 replies). The gap contains the end-of-speech wait, then upload, whisper, the model, the first sentence being complete, Kokoro render, decode and start of playback. The server numbers overlap, so they are not additive. "rest" is what is left after subtracting the wait, STT and TTS from the gap.

| Run | EOS wait | n | gap median / p95 / max | gap minus EOS median | sttMs median | LLM first token median (model turns) | TTS first audio median / p95 | rest median | Load (1-min, sampled every 30 s; before and after) |
|---|---|---|---|---|---|---|---|---|---|
| 1 default | 1200 | 21 | 3230 / 3700 / 4636 | 2030 | 450 | 441 (n=14) | 660 / 1102 | 902 | 3.7 to 12.0; 5.71 and 7.94 |
| 4 default (the 10 min session) | 1200 | 21 | 3600 / 4035 / 4668 | 2400 | 488 | 498 (n=14) | 939 / 1363 | 872 | 4.6 to 13.4; 13.40 and 8.55 |
| 3 variant (lead 15 s) | 800 | 21 | 3833 / 5079 / 5910 | 3033 | 495 | 500 (n=14) | 1388 / 2252 | 1089 | under load 7.4 to 25.9; 13.11 and 20.14 |
| 6 variant (lead 6 s) | 800 | 21 | 4008 / 5716 / 5874 | 3208 | 572 | 670 (n=14) | 1323 / 2171 | 1104 | under load 7.5 to 16.3; 7.50 and 11.65 |

Load note: no default run went above 15 (so none is "under load" in Nick's sense); the two variant runs touched 26 and 16, so label them under load.

Variant result (END_OF_SPEECH_MS=800, not a change to the default): both repeats were slower, not faster, by 600 to 800 ms at the median. That cannot be the 800 ms setting, which should save 400 ms. The extra time sits in the server steps after speech (Kokoro first audio 1.3 s against 0.7 to 0.9 s, whisper and the model also a little slower), so the machine was in a slower state during both variant runs and the comparison is confounded. Number of candidate turns stayed 22 in both, so the shorter wait did not split answers in this fake-mic setup (the fake speech has no mid-answer pauses over 800 ms; a real speaker thinking mid-answer would be cut off more often). Verdict: no gain shown, not proven either way. The nominal saving is 400 ms of the 3.2 s.

What the headless setup cannot show: no real speaker and no echo (Chrome is muted and the microphone is a file, so the interviewer's voice never feeds back into the microphone and the echo threshold is untested); no real room acoustics; speech is clean synthetic voice, so whisper times are better than for a noisy microphone; the first answer of run 1 took 4636 ms (cold model, first call); answers are fixed text unrelated to the question asked.

## AC-7: barge-in

Runs: run 2 (`--answers 8 --gap-sec 6`, session 0mwqtudta221f) made the next answer start while the interviewer was still talking. Other barge-ins happened by themselves in runs 1, 4 and 6 (the first answer starts while the opening is still playing, and in run 4 the next answer started as a silence prompt began). Measured as `endMs` of the interrupted turn (the browser's time of `playback.stop()`) minus the start of the candidate speech that caused it (the voice detector's backdated onset).

| Run | Interrupted turns | Stop times (ms) |
|---|---|---|
| 2 | 6 (opening, 5 follow-ups) | 387, 387, 383, 383, 382, 382 |
| 1 | 2 (opening, one prompt) | 386, 399 |
| 4 | 5 (all silence prompts) | 288, 304, 352, 356, 357 |
| 6 | 1 (opening) | 213 |

14 in total, 6 of them on real replies in the dedicated run. Maximum 399 ms, so 500 ms holds here. What it contains: the detector needs 150 ms of loud audio before it reports speech (`startMs` in `vad.ts`), so about 150 ms of every number is the detector, and the rest is audio worklet and main thread delay. `playback.stop()` is synchronous. What it does not contain: the output device's own latency and any speaker echo. Two oddities to look at: in run 1 the interrupted prompt (turn 26) has an `endMs` earlier than its `startMs` (312128 against 312841), and the three clustered values near 383 look like a fixed detector delay more than a measured stop. Sample is small.

## AC-8: silence prompt and offer

Run 5: `--answers 0 --lead-sec 6 --max-sec 80` (microphone is silence only), session 0mwqurgru2f25. Logged times in seconds (`startMs`, and `endMs` which is `startMs` plus the summed length of the sentence WAVs):

| Turn | Kind | Started | Ended | Since the previous interviewer line ended |
|---|---|---|---|---|
| 0 | opening and question | 1.15 | 8.26 | |
| 1 | prompt "Whenever you are ready." | 16.99 | 17.89 | 8.74 s |
| 2 | offer plus next question | 30.62 | 34.97 | 12.74 s |
| 3 | prompt | 43.71 | 44.61 | 8.74 s |
| 4 | offer plus next question | 57.34 | 61.15 | 12.74 s |
| 5 | prompt | 69.88 | 70.77 | 8.74 s |
| 6 | offer plus next question | 83.50 | 84.31 | 12.74 s |

The logged values are about 0.74 s above the 8 s and 12 s settings every time. For the first prompt I can account for it: the opening's logged start is when the turn began, and its audio was audible 0.67 s later (`ttsFirstAudioMs` 673), so the real stop was about 8.9 s and the prompt came about 8.1 s after it. For the offer I cannot account for the 0.7 s from the logs (likely the browser's playback start, not verified). Observation: the "offer" is spoken as "Would you like to move on to the next question?" followed at once by the next question, so it does not wait for an answer. Whether that matches the owner's idea of an offer is a product question.

## AC-9, AC-13, AC-14: the 10-minute session

Session 0mwqucs2s22cd, `--answers 24 --gap-sec 14 --lead-sec 15 --minutes 10`, load 4.6 to 13.4. Candidate answers cycled through invented texts and do not match the question asked, which the interviewer does not notice (limit of the script).

- Distinct bank questions asked: 7 (q1, q5, q8, q11, q2, q6, q9). Repeats: 0. Follow-ups per question: 2 on each of the 7 (maximum 2). Candidate turns: 21.
- Closing line: turn 48 starts at 548.1 s (9:08). The session ended by itself at 551.9 s. This is inside 9:00 to 11:00 but near the early edge because the scripted answers are short (about 12 s). The pacing rule in `docs/phase-2-notes.md` expects about 9:45 with 45 s answers.
- Silence prompts: 6 were spoken (turns 7, 14, 21, 28, 35, 42). 5 were cut off by the next answer; turn 21 finished. They fire because the scripted answer starts about 8 s after the question ends, an artifact of the fixed gap.
- Report: `report.json` written 68.75 s after `endedAt`. The pass makes one model call per question with answers, 7 here. Target 60 s: FAIL against the initial target.
- Quote check: `verify-report.ts` printed `quotes verified 27 of 27 (0 marked unverified by the report)`.

## AC-10 and AC-11: every follow-up of session 0mwqucs2s22cd

Candidate text is quoted from the transcript as Whisper wrote it.

| Turn | Candidate said (fragment) | Interviewer follow-up | Mark |
|---|---|---|---|
| 2 | "I interviewed the counter staff for 2 weeks. Then built a tablet checklist that cut the wrong orders to 1 in 40" | "You mentioned interviewing the counter staff for two weeks. What was the primary goal of those interviews?" | refers to what was said, but picks a neighbouring detail, not the 1 in 40 result |
| 4 | "The short form finished faster, and he agreed to ship it." | "You mentioned the short form finished faster. What metrics did you use to determine that it finished faster?" | refers to what was said |
| 9 | "recreating the checkout screen from an old project" | "You mentioned recreating the checkout screen from an old project. What did you learn from the mistakes you made while doing that?" | refers to what was said |
| 11 | "Completion went from 48 to 66% in a month." | "You mentioned completion went from 48 to 66 percent. What changes did you make to the slot picker to achieve that increase?" | refers to what was said |
| 16 | "I start with the assumption that would hurt most if wrong." | "You mentioned starting with the assumption that would hurt most if wrong. Can you give an example of what that assumption was in a different project?" | refers to what was said |
| 18 | "I showed him recordings of people tapping twice without it" | "You mentioned showing the engineer recordings of people tapping twice without the loading state. What did those recordings specifically show?" | refers to what was said |
| 23 | "I pick the five from the last month of support tickets." | "You mentioned picking the five people from the last month of support tickets. What kind of problems do you look for in those tickets?" | refers to what was said |
| 25 | "I say in the readout that it is a thin sample." | "You mentioned that the readout is a thin sample. How do you address that limitation in your findings?" | refers to what was said |
| 30 | "gloves made the small buttons hard to hit, so I doubled the target size" | "You mentioned doubling the target size because gloves made the small buttons hard to hit. What other issues did you find with the warehouse scanning app?" | refers to what was said |
| 32 | "I asked him to walk me through it. Kept his naming. And we merged the two on Monday." | "You mentioned keeping the new teammate's naming while merging the two components. What was the purpose of keeping his naming convention?" | refers to what was said; "two components" is a loose paraphrase (the candidate said "component library" and "the two") |
| 37 | "I ran a quick test with 10 people on both versions." | "You mentioned running a quick test with 10 people on both versions. What kind of data did you look at to determine the short form finished faster?" | refers to what was said |
| 39 | "We dropped two features and moved a third to the next release." | "You mentioned dropping two features when a deadline slipped. How did you decide which features to drop?" | refers to what was said |
| 44 | "cut the slot picker from 3 screens to 1 and tested it with 7 customers" | "You mentioned cutting the slot picker from 3 screens to 1. What was the process for testing that change with 7 customers?" | refers to what was said |
| 46 | "I showed her a heat map where people tapped past it" | "You mentioned showing the owner a heat map where people tapped past the loyalty banner. What was the owner's reaction to seeing that heat map?" | refers to what was said |

Result: 0 of 14 generic. All 14 quote or restate the candidate's words. Fact check: no interviewer sentence states a fact about the candidate or a company that the transcript lacks. Two loose spots: turn 32 ("two components") and turn 16 ("in a different project" assumes the example would come from another project; it is a question, not a claim). The fixed lines ("Hello, thanks for joining...", "Whenever you are ready.", "That covers my questions. Thank you for your time.") state nothing about the candidate. The bank questions in the log are from the sample bank. The real-input session read (AC-11) is still owed by the owner.

## AC-16: what the sockets showed

During the full 10-minute session (session 0mwqucs2s22cd) I listed `lsof -nP -i` for the Hono server, the Vite server and the headless Chrome processes every second (4282 lines).

- Server (node, port 8941): listening on 127.0.0.1:8941. Outgoing connections only to 127.0.0.1:8944 (LLM, 54 samples), 127.0.0.1:8942 (whisper, 52) and 127.0.0.1:8943 (Kokoro, 23). No other remote address.
- Vite (port 8940): listening on [::1]:8940, connections to 127.0.0.1:8941 and loopback clients. No other remote address.
- Page requests (DevTools Network events, all runs): only `localhost:8940` (138 to 222 requests per run) and `blob:`. The only console errors are the expected 404 for `room.spz`.
- Chrome's own processes also held connections to Google address ranges (port 443 and 80) in the socket listing. These are not the page: the page's request list shows none. To check, I started the same Chrome with a blank page and no app, with its background networking, component updater, sync and pings switched off by flag, for 20 s: its network service still connected to 5 Google addresses. So the traffic comes from Chrome itself, not from the app. A blank Chrome profile cannot be made fully silent by flags in this setup, so "no connection from the Chrome process" is not shown, only "none from the app".
- Limits: one-second sampling can miss a connection shorter than a second; the check covers the local-provider configuration only. The Claude API clause was not run (paid, never enabled).

## Proposed revised targets (for the owner to accept or reject)

These are proposals only. `docs/spec.md` is unchanged.

1. AC-6: median 3.5 s or less and p95 4.5 s or less with local providers on this Mac, measured over at least 20 turns. Measured today: median 3.2 and 3.6 s, p95 3.7 and 4.0 s. Keep 2.5 s as a stretch goal. About 1.2 s of the gap is the end-of-speech wait, so the realistic levers are a shorter or adaptive wait (not shown to help here), starting TTS on a shorter first sentence, and a faster Kokoro path. Ask the owner whether the gap should be counted from the end of speech or from the moment the wait expires.
2. AC-13: 90 s or less for a 10-minute session (measured 68.8 s). Or keep 60 s and cut per-question calls to run in parallel.
3. AC-7: keep 500 ms, but add "measured with speakers on a real device" because this run had no echo and no output device latency.
4. AC-9: keep, but state the closing window relative to the answer length used (the closing came at 9:08 with 12 s answers; 45 s answers give about 9:45).
5. AC-10: say whether "refers to that claim" means the main claim or any detail of the answer. Today's read: 13 of 14 hit a main claim; phase 2 notes had 2 of 5 exact.

## Load averages

Mac load average (1, 5, 15 minute) printed by `uptime` before and after each run. Other sessions share this Mac.

| Run | Before | After |
|---|---|---|
| 1 (22 answers, EOS 1200) | 5.71 16.09 17.33 | 7.94 9.44 12.60 |
| 2 (barge-in) | 9.96 9.87 12.61 | 16.73 10.29 12.18 |
| 3 (variant EOS 800, lead 15) | 13.11 10.01 12.01 | 20.14 14.55 13.56 |
| 4 (10 min session, AC-9, 13, 14, 16) | 13.40 13.53 13.24 | 8.55 7.68 9.77 |
| 5 (AC-8 silent run) | 6.02 7.15 9.46 | 8.13 7.52 9.37 |
| 6 (variant EOS 800, lead 6) | 7.50 7.31 9.14 | 11.65 10.25 10.03 |

Highest 1-minute sample during a run: run 1 12.0, run 2 10.0, run 3 25.9, run 4 13.4, run 5 not sampled, run 6 16.3. None exceeded 50. Runs 3 and 6 are labelled under load because they went above 15.

## Scripts changed or added

- `scripts/e2e-fake-mic.mjs`: new options `--answers N`, `--gap-sec S`, `--lead-sec S` (14 invented answer texts, cycling), and a list of the distinct hosts the page requested.
- `scripts/acceptance-stats.ts`: prints the split of the gap and the stop times for one `session.json`.
