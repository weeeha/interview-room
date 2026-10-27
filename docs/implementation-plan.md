# Interview Room Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A voice interview rehearsal tool that runs inside a Marble-generated room, built voice loop first and room second, at $0 until the owner approves paid steps.

**Architecture:** A one-time Marble export gives a splat file for each room. A Vite and TypeScript browser app shows the room with three.js and Spark, captures the microphone, and plays interviewer audio from a position in the scene. A small Node and TypeScript server runs the voice loop (speech to text, interviewer LLM, text to speech) behind provider interfaces, writes a session log, and runs a feedback pass after the session. The room is optional at runtime, so the voice loop works without it.

**Tech stack:** World Labs Marble (web app first, API later if wanted), three.js, Spark, Vite, TypeScript, Node, vitest, whisper.cpp (local), llama.cpp (local, home GPU box), Claude API (after approval), a local open-weight voice or browser `speechSynthesis`. Exact versions are pinned when each tool is first installed. Script tags from a CDN use a version at least two weeks old.

**Spec:** [docs/spec.md](spec.md)

**Scope note:** Phases 0 and 1 are written step by step. Phases 2 to 5 are outlines with files, steps and checks per task. Expand each phase into full steps after the phase 0 results, because room load time, file size and frame rate decide how the room phases look. Phase 2 is the most valuable work in the project and is the first to expand.

## Global Constraints

- **Branch per task, pull request per change.** Work happens on a branch named for the task. Nothing is committed to `main` directly.
- **Target line first.** The first line of every build or deploy message names repo, account and surface (local, Vercel preview).
- **Budget is $0.** Any step that can cost money is marked `[PAID]` and waits for the owner's go. The cost register below lists every one.
- **Media stays out of git.** Generated rooms, exported splats and meshes, panoramas, recordings, transcripts and screenshots of Marble output live in `media/` and `sessions/`, which `.gitignore` covers. Whether Marble's terms allow public redistribution of exported worlds is unverified, which is one more reason to keep them local.
- **No client material, no real interview content, no company names** in the repository. Sample banks and fixtures are invented. Real banks are read from a local folder named in `.env`.
- **Draft before build.** Phase 1 is a static HTML draft that the owner reviews before any real code.
- **`unslop` runs before building UI and again before calling it done.** The audit applies to the phase 1 draft, the phase 3 room screen and the phase 4 report screen.
- **Verify in two browsers.** Chrome and Safari both run a check before a UI task is called done. A claim without evidence from a run is labelled unverified.
- **Measured numbers replace targets.** A number that was not measured is labelled "initial target" or "unverified".
- **Writing rules for public prose:** no em dashes, no exclamation marks, plain short sentences.
- **The Browser pane needs fronting and sizing** before any layout measurement: select the tab, then set an explicit viewport.
- **No deployment** of the real app. A Vercel preview of the static draft needs the owner to confirm the team first. A new project's first deploy lands as production, so run `vercel inspect <url>` and confirm `target preview`, then confirm the short `.vercel.app` name returns 302 or 404 without cookies, before sharing a link.

## Cost Register

| Step | What costs | Amount | Status |
|---|---|---|---|
| Marble web app, 4 free generations | Nothing | $0 | Allowed. Free plan covers text, single image and panorama inputs (World Labs billing page). |
| Marble export of splats on the Free plan | Unverified. The billing page lists "exporting" under Standard and the FAQ is silent | Standard plan listed at $20/month | `[PAID]` if Free cannot export. Phase 0 task 0.3 settles it. |
| Marble API credits | Minimum purchase 6,250 credits ($5.00), at 1,250 credits per $1.00 | A draft-tier world: 230 credits, about $0.18 (derived). A standard-tier text or image world: 1,580 credits, about $1.26 (derived). PLY splat export is free. High-quality mesh export: 3,500 credits ($2.80) | `[PAID]`, optional. API credits are separate from web app credits. |
| Claude API for the interviewer and feedback pass | Per-token pricing | Check the live pricing page at approval time (unverified here) | `[PAID]`, needs the owner's go. Local model covers $0 work until then. |
| Hosted STT or hosted TTS | Per-minute or per-character pricing | Unverified | `[PAID]`, optional. Not planned. |
| Existing Gemini-based TTS function from the prep tooling | Cost status unverified | Unverified | Check before use. Only for pre-rendered fixed lines. |
| Vercel preview of the static draft | Unverified for the owner's plan | Unverified | Needs the owner's go and team confirmation. |
| Quest 3 testing | Headset hardware | No software cost | Owner confirms headset access before phase 5. |

## Review Focus

1. **The room fails to load.** The session starts on a flat backdrop with a visible notice, and the voice loop runs. Test: AC-4 with the splat renamed (task 3.4).
2. **A candidate interrupts the interviewer.** Audio stops within 500 ms and the partial interviewer sentence is logged as interrupted. Test: `test_barge_in_stops_playback` (task 2.6).
3. **The interviewer invents a fact.** The prompt forbids it and the real-input review checks it (task 2.7). A missing role context produces questions only from the bank.
4. **A bank entry has no answer on file** (marked with a warning emoji in the owner's banks). `hasReferenceAnswer` is false and the feedback pass skips the rewrite for that question. Test: `test_missing_answer_flag` (task 2.2).
5. **A feedback quote does not appear in the transcript.** The report fails verification and is regenerated once, then shown with a warning. Test: `test_verify_quotes_rejects_fabricated_quote` (task 4.3).
6. **A paid provider is selected by accident.** The server refuses to start the Claude provider unless `ALLOW_PAID=1` is set in `.env`. Test: `test_paid_provider_requires_flag` (task 2.3).

---

# Phase 0: Spike - one room, in the browser, measured

Goal: prove that a Marble room can be generated, exported and viewed from a seat in Chrome and Safari, and measure load time, file size and frame rate. Nothing else is built until this passes.

### Task 0.1: Repository scaffolding

**Files:**
- Create: `.gitignore`
- Create: `spike/README.md`
- Local only: `media/` (ignored by git, made by hand)

- [ ] **Step 1:** On branch `spike/phase-0`, create `.gitignore` with these lines: `media/`, `sessions/`, `.env`, `node_modules/`, `dist/`, `.DS_Store`.
- [ ] **Step 2:** Write `spike/README.md` with the goal, the commands to serve the viewer, and where the exported files go (`media/rooms/`).
- [ ] **Step 3:** Run `mkdir -p media/rooms` locally.

**Check:** `git status --short` lists `.gitignore` and `spike/README.md` only. Create `media/rooms/test.txt`, run `git status --short` again, and confirm the file does not appear. Delete the test file.

### Task 0.2: Generate one room in Marble

**Files:**
- Create: `spike/prompts/interview-office.md`
- Local only: `media/rooms/interview-office/` (exports)

- [ ] **Step 1:** Write the prompt in `spike/prompts/interview-office.md`. Starting text: "A quiet mid-size meeting room seen from a seat at a round table. Two empty chairs across the table, a large window with soft daylight on the left, a plain whiteboard on the wall, a closed door behind the chairs, neutral carpet, no people, no readable text." The prompt describes no real building and names no company.
- [ ] **Step 2:** In the Marble web app on the Free plan, generate a world from the prompt. Do not enter payment details. Note the generation time on a clock (the docs estimate about 5 minutes).
- [ ] **Step 3:** If the first result has people, readable text or a warped table, regenerate once with the prompt adjusted. Free plan allows 4 generations in total. Record how many were used.
- [ ] **Step 4:** Look at the room from where a seated person would be. Write two lines in `spike/results.md` under "Seat view": what looks right, what looks wrong.

**Check:** `spike/results.md` shows the generation time and the number of generations used. The generated world opens in the Marble viewer.

### Task 0.3: Export and measure files

**Files:**
- Modify: `spike/results.md`
- Local only: `media/rooms/interview-office/*.spz`, `*.ply`, `*.glb`

- [ ] **Step 1:** Try to export the splats from the web app. Record exactly which export options the Free plan shows. This settles the `[PAID]` question in the cost register.
- [ ] **Step 2:** If the Free plan cannot export, stop and ask the owner: (1) the Standard plan, listed at $20/month, or (2) API credits, minimum $5.00, with PLY splat export free of credits. Do not buy either without the owner's go.
- [ ] **Step 3:** Export every splat variant available (SPZ about 2M and about 500k, PLY if offered) and the collider GLB.
- [ ] **Step 4:** Record each file's size in megabytes with `ls -l` in a table in `spike/results.md`. The World Labs docs give splat counts only, so these are the first size numbers.
- [ ] **Step 5:** Also save the viewer metadata if the export includes `metric_scale_factor` and `ground_plane_offset`.

**Check:** `spike/results.md` contains a table with file name, format, splat count (as documented) and size in MB for each file. Every cell is filled from a real file.

### Task 0.4: Browser viewer with load and fps measurement

**Files:**
- Create: `spike/viewer/index.html`
- Modify: `spike/results.md`

- [ ] **Step 1:** Write `spike/viewer/index.html` with an import map for three.js and Spark from a CDN, each at an exact pinned version at least two weeks old. Check the Spark documentation for the current loading API (unverified here) and use it.
- [ ] **Step 2:** Load the chosen splat file from a local static server (`python3 -m http.server` in the repo root, file read from `media/rooms/...`).
- [ ] **Step 3:** Apply the axis fix: rotate the splat object 180 degrees about X (Marble's raw OpenCV frame to three.js). If `metric_scale_factor` is present, apply it, then subtract `ground_plane_offset` from the centers' Y value.
- [ ] **Step 4:** Place the camera at an eye height of 1.2 m inside the room, looking at the far chairs. Add pointer drag for yaw and pitch, limited to 60 degrees of yaw.
- [ ] **Step 5:** Add an overlay showing page-load-to-first-frame time in seconds (from `performance.now()` to the first rendered frame of the splat) and a 10-second average fps.
- [ ] **Step 6:** Run the viewer in Chrome and Safari, each with the browser pane fronted and an explicit 1440 by 900 viewport. Record the load time and average fps for each file variant in `spike/results.md`. Take one screenshot per browser into `media/screens/` (local only).
- [ ] **Step 7:** Check for artifacts: floaters near the camera, missing floor, an upside-down room, warped table edges. List each in `spike/results.md`.

**Check:** `spike/results.md` has rows for each file and browser with load seconds and average fps. Both screenshots show the room right side up, from the seat. If the room appears upside down or mirrored, the axis fix is wrong and this task is not done.

### Task 0.5: Go or no-go

**Files:**
- Modify: `spike/results.md`
- Modify: `docs/spec.md` (replace AC-1 and AC-2 initial targets with measured values or revised targets)

- [ ] **Step 1:** Compare the results with the gates below. Write "go", "go with changes" or "no-go" at the top of `spike/results.md`, with one paragraph of reasons.
- [ ] **Step 2:** Update AC-1 and AC-2 in the spec with the measured numbers.
- [ ] **Step 3:** Show the owner the screenshots and the table and ask for a decision.

| Gate | Initial go threshold |
|---|---|
| Seat view reads as a plausible room at eye height | Owner agrees after looking at the screenshot |
| Load time on local server, best variant | 15 seconds or less |
| File size of the variant used for sessions | 60 MB or less |
| Average fps, 10 seconds, Chrome and Safari | 30 or higher in both |
| No floaters or holes within 1 m of the camera | None visible in the seat view |

If a gate fails, try the 500k variant, then a different prompt. If the 500k variant also fails on fps, the fallback is the 360 panorama PNG as a background on a sphere (a flat but fast room), and the plan continues with that.

**Check:** the top of `spike/results.md` states the decision, and the spec's AC-1 and AC-2 show measured values.

Pull request for phase 0: `spike/` files, `.gitignore`, and the spec edit. No media files.

---

# Phase 1: HTML draft of the flow

Goal: three static screens and their states, to look at before any real code. The owner reviews them and the plan changes if the flow is wrong. No server, no framework, no real audio.

### Task 1.1: Constraints before building (unslop, round one)

**Files:**
- Create: `draft/unslop-notes.md`

- [ ] **Step 1:** Run the `unslop` anti-slop skill in constraint mode before drawing anything. Copy its constraints into `draft/unslop-notes.md`.
- [ ] **Step 2:** Add project-specific constraints: the room view is the hero of the room screen, captions are legible over a splat background, the report is text first, no stock gradients, no decorative icons without a job.
- [ ] **Step 3:** Choose a type scale, two colors plus neutrals and a spacing unit. Write them at the top of `draft/draft.css` as CSS variables, with dark mode values under `prefers-color-scheme`.

**Check:** `draft/unslop-notes.md` exists with the skill's constraints and the project list. `draft/draft.css` has `:root` variables with a dark-mode block.

### Task 1.2: Setup screen

**Files:**
- Create: `draft/setup.html`
- Create: `draft/draft.css`, `draft/draft.js`

- [ ] **Step 1:** Build the setup screen: room picker (three cards: interview office, panel room, video-call corner, each with a placeholder image block labelled "room view"), question bank select, interviewer style (warm, neutral, probing), length (5, 10, 20 minutes), optional role context textarea, start button.
- [ ] **Step 2:** Add the past-sessions list with two invented rows (date, bank name, length, link to the report).
- [ ] **Step 3:** Add states reachable through a `?state=` query value: `empty` (no banks, no sessions), `loading`, `error` (server unreachable), `long` (long role context).
- [ ] **Step 4:** Add a note under the start button listing which providers will be used and whether any costs money. In the draft this reads "All local. No cost."

**Check:** open `draft/setup.html` with each of the five `?state=` values (default plus four) and see a distinct, complete layout. Tab through the page with the keyboard and see a focus ring on every control.

### Task 1.3: Room screen

**Files:**
- Create: `draft/room.html`
- Modify: `draft/draft.css`, `draft/draft.js`

- [ ] **Step 1:** Build the room screen: a full-bleed placeholder block for the room view, a marker for the interviewer position, a caption strip, a timer, a mic meter, mute and end buttons.
- [ ] **Step 2:** Add states by `?state=`: `default`, `interviewer-speaking`, `candidate-speaking`, `silence-prompt`, `room-loading` (with a "skip room" button), `room-unavailable` (flat backdrop with notice), `mic-denied`, `provider-error` (with retry), `ending`.
- [ ] **Step 3:** Add a tiny script that cycles the caption text through a scripted exchange so the owner can feel the pacing. The text is invented.
- [ ] **Step 4:** Check legibility: captions stay readable over a light and a dark placeholder background.

**Check:** each of the nine states renders and is reachable by URL. The caption strip passes a manual contrast check against both placeholder backgrounds.

### Task 1.4: Report screen

**Files:**
- Create: `draft/report.html`, `draft/index.html`
- Modify: `draft/draft.css`, `draft/draft.js`

- [ ] **Step 1:** Build the report: summary paragraph, delivery numbers row (words per minute, fillers, median answer length, longest pause), then one block per question with strengths, gaps, rubric scores with one-line reasons, a rewrite, and a play button per quoted line.
- [ ] **Step 2:** Add states: `default`, `generating`, `error` (transcript still readable, retry button), `empty` (no answers), `long`.
- [ ] **Step 3:** Build `draft/index.html` as a flow map linking to every screen and state, so the owner can click through.

**Check:** every state of the report renders. The flow map links to all 19 screen states and no link is dead (open each once).

### Task 1.5: Unslop audit and owner review

**Files:**
- Modify: `draft/unslop-notes.md`, any draft file with findings

- [ ] **Step 1:** Run the `unslop` audit on the finished draft in Chrome and Safari, at 1440 by 900 and 390 by 844. Write findings and fixes in `draft/unslop-notes.md`.
- [ ] **Step 2:** Fix every finding, or list the reason it stays.
- [ ] **Step 3:** Serve the draft locally and send the owner the localhost link plus screenshots. If the owner wants a hosted preview, confirm the Vercel team first and apply the first-deploy checks in Global Constraints.
- [ ] **Step 4:** Record the owner's changes. If the flow changes, update section 3 of the spec in the same pull request.

**Check:** `draft/unslop-notes.md` shows the audit with findings resolved. The owner has seen the draft and replied. Phase 2 does not start until they do.

Pull request for phase 1: `draft/` plus any spec edit.

---

# Phase 2: Voice loop without the room (outline)

Goal: a spoken 10-minute interview that is worth repeating, running in a plain browser page with no room. Expand into steps after phase 0. This phase decides whether the project is good, so the room phases wait for it.

### Task 2.1: App and server scaffold

**Files:** `package.json`, `tsconfig.json`, `vite.config.ts`, `.env.example`, `server/src/index.ts`, `server/src/log.ts`, `app/src/main.tsx`

- [ ] Set up Vite and TypeScript for `app/`, Node and TypeScript for `server/`, vitest for both. Pin versions at install.
- [ ] `.env.example` lists `QUESTION_BANK_DIR`, `ALLOW_PAID`, provider names and the local endpoint URLs. No secrets.
- [ ] Add `GET /api/health` and a page that calls it.

**Check:** `npm run typecheck && npm test` pass, and the page shows "server ok" in Chrome and Safari.

### Task 2.2: Question bank parser

**Files:** `server/src/banks/parse.ts`, `server/src/banks/parse.test.ts`, `banks/sample-bank.md`

- [ ] Parse headings of the form `### N. "Question text"` into questions. Read `Say`, `Follow-up` and `Guard` lines into `referenceAnswer`, `followUpHints` and `doNotSay`. Strip include directives, bold markers and emoji. Mark entries whose answer line carries the warning emoji as `hasReferenceAnswer: false`.
- [ ] Write `banks/sample-bank.md` with 12 invented questions in the same shape, including one entry with a missing answer.
- [ ] Tests: `test_parses_sample_bank`, `test_missing_answer_flag`, `test_strips_include_directives`.
- [ ] The parser reads from `QUESTION_BANK_DIR` and never copies files.

**Check:** tests pass. The real-input check: point `QUESTION_BANK_DIR` at the owner's local prep folder, run the parser on the question-bank files there, and print counts per file. Open two files and compare their question counts by eye. This check uses files outside the repo and prints counts only.

### Task 2.3: Provider interfaces and interviewer engine

**Files:** `server/src/interviewer/engine.ts`, `engine.test.ts`, `prompt.md`, `server/src/providers/llm/{claude,local,fake}.ts`

- [ ] Define `LLMProvider.stream(messages): AsyncIterable<string>`. Implement `fake` (scripted), `local` (llama.cpp OpenAI-compatible endpoint on the home GPU box) and `claude` (API key from `.env`).
- [ ] `claude` refuses to start unless `ALLOW_PAID=1`. Test: `test_paid_provider_requires_flag`.
- [ ] Engine state machine: opening, question, follow-up (max 2), next question, closing at the time target. Question order from the bank, no repeats, tag balance if the bank has tags.
- [ ] `prompt.md` encodes decision D13: one question at a time, follow-ups that quote the candidate, no invented facts, no reveal of reference answers, short spoken sentences, no lists.
- [ ] Tests with the fake provider: `test_no_repeat_questions`, `test_max_two_followups`, `test_closes_near_target_time`.
- [ ] Compare `local` and `claude` (once approved) on the same 5 scripted answers and record the follow-ups side by side in `docs/phase-2-notes.md`. `[PAID]` for the `claude` runs.

**Check:** unit tests pass. For the 5 scripted answers, read the follow-ups and mark each responsive or generic (AC-10).

### Task 2.4: Speech to text with end-of-speech detection

**Files:** `app/src/audio/capture.ts`, `app/src/audio/vad.ts`, `server/src/providers/stt/{whisper,fake}.ts`

- [ ] Capture microphone audio, detect end of speech with a silence window (1.2 s default, setting), and send the chunk to the server.
- [ ] Run whisper.cpp as a local server (install path to be checked; unverified) and call it from the `whisper` provider. Record time per chunk.
- [ ] Record 3 fixture clips of the owner reading invented answers, kept in `media/fixtures/` (local) and compare the transcripts by eye.

**Check:** speak a 20-second answer in Chrome and in Safari and see the transcript in the page within the target gap. If Safari microphone capture fails, record the cause in `docs/phase-2-notes.md`.

### Task 2.5: Text to speech

**Files:** `server/src/providers/tts/{local,browser,fake}.ts`, `app/src/audio/playback.ts`

- [ ] Implement the browser `speechSynthesis` baseline first so the loop works end to end.
- [ ] Check one local open-weight voice (Kokoro or Piper): licence, install path, quality, time to first audio for one sentence. Record the results in `docs/phase-2-notes.md`. If it clears the bar, add it as the default provider.
- [ ] Stream sentence by sentence: the LLM output is cut at sentence ends and each sentence is synthesized as it arrives.
- [ ] Pre-render the fixed lines (opening, closing, silence prompts) once per voice into `media/tts-cache/`, keyed by a hash of the text. This reuses the idea from the owner's prep tooling, which caches audio segments by content hash. If the owner wants its Gemini-based function used here, check its cost first.

**Check:** `npm test` passes for the sentence splitter. In the browser, a 3-sentence interviewer reply starts playing before the whole reply has finished generating (watch the log timestamps).

### Task 2.6: Turn-taking, barge-in, silence handling and the session log

**Files:** `server/src/session.ts`, `app/src/screens/Room.tsx` (voice-only version), `server/src/log.ts`

- [ ] Wire capture, STT, engine, TTS and playback into one loop.
- [ ] Barge-in: detect candidate speech during playback, stop playback, mark the turn `interrupted`. Test: `test_barge_in_stops_playback`.
- [ ] Silence: prompt after 8 s, offer to move on after 12 s more (settings). Test: `test_silence_prompts`.
- [ ] Write `sessions/<id>/session.json` and per-turn audio with the latency fields from the spec's `Turn` type.
- [ ] Add a small script `scripts/latency-table.ts` that reads a session log and prints median and p95 for the gap.

**Check:** run a 3-minute session in Chrome and Safari. The latency script prints a table. Interrupt the interviewer once on purpose and see `interrupted: true` in the log with the stop time under 500 ms.

### Task 2.7: Real-input session and gate

**Files:** `docs/phase-2-notes.md`

- [ ] Run the spec's one real-input test in voice-only mode: 10 minutes, the owner's real bank, recorded and kept local.
- [ ] Fill the latency table, the follow-up review, and the invented-fact review (AC-6 to AC-11).
- [ ] Replace the initial targets in the spec with measured values.
- [ ] Ask the owner: is this worth doing again without a room? If the answer is no, fix the loop before phase 3.

**Check:** `docs/phase-2-notes.md` holds the table, the review marks and the owner's answer. Phase 3 starts only after this gate.

---

# Phase 3: Put the voice loop in the room (outline)

Goal: the same session, now in the scene, with the interviewer's voice coming from a position in it. Expand after phases 0 and 2.

### Task 3.1: Room module from the spike

**Files:** `app/src/room/loadScene.ts`, `app/src/room/seatCamera.ts`, `app/src/room/RoomView.ts`, `rooms/interview-office.json`

- [ ] Move the phase 0 viewer into a module that takes a `Room` record and a canvas.
- [ ] `rooms/interview-office.json` holds metadata and the seat position, with `splatPath` pointing at `media/rooms/...`.
- [ ] Load progress reporting for the loading state.

**Check:** the room appears inside the Room screen in Chrome and Safari at the measured load time from phase 0, within 20 percent.

### Task 3.2: Spatial interviewer voice and marker

**Files:** `app/src/room/spatialAudio.ts`, `app/src/room/marker.ts`

- [ ] Route interviewer audio through a Web Audio panner at the interviewer anchor.
- [ ] Add the marker (a name card or soft light) that pulses with the voice level.

**Check:** with headphones, a spoken line comes from the anchor's side, and turning the view changes the apparent direction (AC-5).

### Task 3.3: Fallback and flat backdrop

**Files:** `app/src/room/fallback.ts`, `app/src/screens/Room.tsx`

- [ ] On any scene load failure, or a "skip room" press, show the flat backdrop and a notice.
- [ ] Below 700 px width, use the flat backdrop by default.

**Check:** rename the splat file, start a session, see the notice, and finish a 2-minute session (AC-4). Test: `test_room_failure_does_not_block_session`.

### Task 3.4: Room screen states and polish

**Files:** `app/src/screens/Room.tsx`, `app/src/styles/room.css`

- [ ] Implement every Room state from the spec's checklist, using the phase 1 draft as the reference.
- [ ] Run the `unslop` audit before and after.
- [ ] Debug overlay for fps and gap times behind a keyboard shortcut.

**Check:** screenshots of each state in Chrome and Safari at 1440 by 900 and 390 by 844, compared with the draft screenshots. The audit notes are attached to the pull request.

### Task 3.5: Second and third rooms (optional)

**Files:** `rooms/panel-room.json`, `rooms/video-call.json`, `spike/prompts/*.md`

- [ ] Generate a panel room and a video-call corner in Marble. `[PAID]` if the free generations are used up.
- [ ] Panel room: two interviewer voices alternate, each with its own anchor and voice id.
- [ ] Video-call corner: a screen-shaped plane faces the seat and carries the interviewer marker.

**Check:** each room loads and the voice comes from its anchor. A panel session shows both voices in one 5-minute run.

### Task 3.6: Real-input session in the room

**Files:** `docs/phase-3-notes.md`

- [ ] Repeat the spec's real-input test inside the room.
- [ ] Compare the gap numbers with phase 2. If the room costs more than 20 percent of frame rate headroom or slows audio, note it and decide what to cut.
- [ ] Ask the owner whether the room changes how the practice feels.

**Check:** `docs/phase-3-notes.md` has the comparison and the owner's answer.

---

# Phase 4: Feedback report (outline)

Goal: a report whose every claim points to a quoted line. Expand after phase 2, since the session log shape is settled there.

### Task 4.1: Delivery metrics

**Files:** `server/src/feedback/metrics.ts`, `metrics.test.ts`, `fixtures/transcripts/two-minute.json`

- [ ] Pure functions for words per minute, filler count (a configurable list), median answer length, longest pause, interrupted count.
- [ ] Hand-count the 2-minute invented fixture and store the expected values in the test.

**Check:** `test_metrics_match_hand_count` passes (AC-15).

### Task 4.2: Feedback prompt and rubric

**Files:** `server/src/feedback/prompt.md`, `rubric.md`, `server/src/feedback/run.ts`

- [ ] Write the rubric (structure, specificity, relevance, concision, each 1 to 4 with one sentence per level).
- [ ] The prompt asks for JSON in the `FeedbackReport` shape and requires a turn index and an exact quote for every note.
- [ ] Skip the rewrite for questions with `hasReferenceAnswer: false`; the rewrite uses the candidate's own facts only.
- [ ] Run with the local model first, then the Claude provider once approved. `[PAID]`

**Check:** run on the fixture transcript and get valid JSON that passes schema validation.

### Task 4.3: Quote verification

**Files:** `server/src/feedback/verifyQuotes.ts`, `verifyQuotes.test.ts`

- [ ] Check that each quote appears in the text of the cited turn after whitespace normalization.
- [ ] On failure, regenerate once, then show the report with a warning on the failing notes.
- [ ] Tests: `test_verify_quotes_accepts_real_quote`, `test_verify_quotes_rejects_fabricated_quote`.

**Check:** tests pass. Hand-edit one quote in a fixture report and see the verifier flag it.

### Task 4.4: Report screen

**Files:** `app/src/screens/Report.tsx`, `app/src/styles/report.css`

- [ ] Build the report from the phase 1 draft: summary, delivery row, per-question blocks, rewrite, per-quote audio playback.
- [ ] Implement every state in the spec's checklist.
- [ ] Run the `unslop` audit before and after.

**Check:** screenshots of each state in Chrome and Safari match the draft's layout. Clicking a quote's play button plays that turn's audio.

### Task 4.5: Real-input report review

**Files:** `docs/phase-4-notes.md`

- [ ] Generate the report for the real-input session.
- [ ] The owner reads it and marks each note as accurate, inaccurate, or true but unhelpful.
- [ ] Record the counts and the owner's answer to: did the report say something true that you had not noticed?

**Check:** `docs/phase-4-notes.md` has the counts. A rate of 8 in 10 accurate notes is the initial target. Below it, revise the prompt and rubric and rerun.

---

# Phase 5: Quest 3 in WebXR (optional outline)

Goal: sit in the room in a headset. Start only after phases 3 and 4 and only if the owner has a Quest 3 available. Expand after phase 3.

### Task 5.1: Check what already works

**Files:** `docs/quest-notes.md`

- [ ] Try Marble's own VR link for the exported world in the Quest browser. The World Labs FAQ describes a "Copy VR link" button and a VR icon. This gives a zero-code look at the room in the headset.
- [ ] Read the Spark documentation and issue tracker for WebXR support (unverified).
- [ ] Note whether WebXR needs a secure context on the local network (HTTPS or `adb reverse` to localhost) and how the Quest browser handles microphone permission (both unverified).

**Check:** `docs/quest-notes.md` answers each of the three questions with a source or "tested on the headset".

### Task 5.2: Enter-VR mode

**Files:** `app/src/room/xr.ts`, `app/src/screens/Room.tsx`

- [ ] Add an "Enter VR" button using three.js WebXR support, seated reference space, no locomotion.
- [ ] Keep the interviewer panner at its anchor and the seat at head height.

**Check:** on the headset, the room appears at human scale from the seat and the interviewer voice comes from the anchor.

### Task 5.3: Voice loop in the headset

**Files:** `docs/quest-notes.md`

- [ ] Run a 5-minute session in the headset. Record frame rate feel, comfort, microphone behavior, captions legibility.
- [ ] Decide on caption placement in XR (a panel anchored below the interviewer).

**Check:** `docs/quest-notes.md` has the session results and a go or no-go for further XR work.

---

## Integration with the owner's existing prep tooling

The owner keeps interview prep material in two places: a knowledge base folder with question banks, call cards and a text-to-speech pipeline, and a web app project. Only the first connects to this project. Interview room reads from it and never writes into it or copies from it.

| Their asset | How interview room uses it | Boundary |
|---|---|---|
| Question bank markdown (headings `### N. "Question"`, then `Say`, `Follow-up`, `Guard` lines) | Parsed into `Question[]` by task 2.2. `Say` becomes the reference answer for the feedback pass only. `Guard` lines become `doNotSay` for the interviewer prompt. Warning-emoji entries have no reference answer. | Read from `QUESTION_BANK_DIR`. No file is copied into the repo. |
| Content-hash audio cache pattern in the TTS scripts | Same idea for pre-rendered fixed interviewer lines (task 2.5). | Written new in this repo. The Gemini-based function is reused only if the owner confirms its cost. |
| Prep templates for banks and curveball lists | Shape the sample bank in `banks/sample-bank.md`, with invented questions. | Template structure only. |
| Session output | A session can export a transcript as markdown for the owner to paste into prep notes. | Export is a manual step. Nothing is written into the prep folder automatically. |
