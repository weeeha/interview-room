# Interview room - Design Spec

- **Date:** 2026-10-27
- **Status:** draft, pending phase 0 results. Not yet approved for implementation.
- **Surface:** three screens (setup, room, report) and a local voice server. Out of scope: hosting, accounts, avatars, live world models, phone layouts for the room screen, coaching during the interview.

## 1. Summary

Interview room lets one person rehearse a job interview by voice inside a generated 3D room. A World Labs Marble scene, generated once and exported as Gaussian splats, is viewed in the browser with three.js and Spark. A voice loop (speech to text, an LLM interviewer, text to speech) asks questions from the user's own question bank, follows up on what the user said, and produces a written report after the session. The voice loop is built and judged without the room first. The room is added second and the voice loop keeps working when the room fails to load.

## 2. Goals / non-goals

**Goals**
- A 10-minute spoken interview where each follow-up responds to what the candidate actually said.
- Turn-taking that feels like a conversation: a short gap before the interviewer speaks, and the ability to interrupt it.
- A post-session report whose every claim points to a quoted line in the transcript.
- A room that adds the pressure of a place: a fixed seat, a believable space, sound that comes from the interviewer's position.
- Reuse of the owner's existing question banks and text-to-speech code without copying them into this repository.
- $0 spend until the owner approves each paid step.

**Non-goals**
- Generating rooms live or during a session. Marble scenes are static and are made ahead of time.
- Interviewer avatars, lip sync, gestures. One marker object in the scene shows where the voice comes from.
- Multiple human participants, accounts, sharing, hosting a public site.
- Grading against a hiring decision. The report gives practice feedback and makes no prediction about outcomes.
- Storing rooms, recordings, transcripts or real question banks in git.
- Any claim about a specific company. The tool is generic and ships with invented sample banks only.

## 3. Information architecture

Three screens. The phase 1 draft is static HTML (`draft/setup.html`, `draft/room.html`, `draft/report.html`). The real app uses the same three routes.

| Route | Screen | Purpose |
|---|---|---|
| `/` | Setup | Choose room, question bank, interviewer style and length. Paste optional role context. List past sessions. |
| `/session/:id` | Room | Live session: room view or flat backdrop, captions, timer, mic state, end button. |
| `/report/:id` | Report | Feedback after a session: summary, per-question notes, delivery numbers, a rewrite, audio playback by turn. |

Local server endpoints, all on localhost:

| Endpoint | Purpose |
|---|---|
| `POST /api/session` | Create a session from the setup choices. |
| `POST /api/session/:id/turn` | Send a candidate audio chunk. Returns a stream of interviewer text sentences, then audio. |
| `POST /api/session/:id/end` | Close the session and start the feedback pass. |
| `GET /api/session/:id` | Return the session log and, when ready, the report. |
| `GET /api/banks` | List question banks found in the configured bank folder. |

Landing behavior: `/` opens on the setup screen with the last-used choices filled in. A session in progress reopens at `/session/:id` after a page refresh with a "resume or end" prompt.

## 4. Data model

```ts
type Room = {
  id: string;
  label: string;                       // "Interview office"
  kind: "office" | "panel" | "call";
  splatPath: string;                   // local file, SPZ or PLY
  colliderPath?: string;               // optional GLB
  sourcePrompt: string;                // text given to Marble
  marbleWorldId?: string;              // if made through the API
  coordinateConvention: "marble_raw_opencv";
  metricScaleFactor?: number;          // from Marble metadata, if present
  groundPlaneOffset?: number;
  seat: { position: [number, number, number]; yawDeg: number; lookLimitDeg: number };
  interviewerAnchors: Array<{ position: [number, number, number]; label: string }>;
};

type QuestionBank = {
  id: string;
  title: string;
  sourcePath: string;                  // local path, never copied into the repo
  questions: Question[];
};

type Question = {
  id: string;
  text: string;
  referenceAnswer?: string;            // used only by the feedback pass
  followUpHints: string[];
  doNotSay: string[];                  // guard lines from the bank
  tags: string[];
  hasReferenceAnswer: boolean;         // false when the bank marks the answer as missing
};

type InterviewerProfile = {
  id: string;
  label: string;                       // "Warm", "Neutral", "Probing"
  persona: string;                     // prompt text
  maxFollowUpsPerQuestion: number;     // default 2
  voiceId: string;
};

type Session = {
  id: string;
  startedAt: string;                   // ISO
  endedAt?: string;
  roomId: string;
  bankId: string;
  profileId: string;
  targetDurationSec: number;           // default 600
  roleContext?: string;                // pasted by the user, kept local
  providers: { stt: string; llm: string; tts: string };
  status: "created" | "running" | "ended" | "reported" | "failed";
  turns: Turn[];
};

type Turn = {
  index: number;
  role: "interviewer" | "candidate";
  kind: "opening" | "question" | "followup" | "prompt" | "closing" | "answer";
  questionId?: string;
  text: string;
  audioPath?: string;
  startMs: number;                     // since session start
  endMs: number;
  latency?: { sttMs: number; llmFirstTokenMs: number; ttsFirstAudioMs: number; gapMs: number };
  interrupted?: boolean;
};

type FeedbackReport = {
  sessionId: string;
  summary: string;
  perQuestion: Array<{
    questionId: string;
    strengths: Array<{ note: string; turnIndex: number; quote: string }>;
    gaps: Array<{ note: string; turnIndex: number; quote: string }>;
    rewrite?: string;
    rubric: { structure: 1 | 2 | 3 | 4; specificity: 1 | 2 | 3 | 4; relevance: 1 | 2 | 3 | 4; concision: 1 | 2 | 3 | 4 };
  }>;
  delivery: {
    wordsPerMinute: number;
    fillerCount: number;
    medianAnswerSec: number;
    longestPauseMs: number;
    interruptedCount: number;
  };
  nextDrill: string[];
};
```

The rubric scale is 1 (weak) to 4 (strong). Each score needs a one-line reason in the report text. Rubric wording lives in `server/src/feedback/rubric.md` so it can change without code changes.

Storage: one folder per session under `sessions/<id>/` holding `session.json`, `report.json` and `audio/turn-NN.wav`. The folder is ignored by git.

## 5. Decisions

**D1. The room is generated once.** Marble produces a persistent scene from text, an image or video. Genie 3 and Runway GWM Worlds 2 have no public API (as of October 2026), and live frame generation costs roughly a GPU per user. A static room is enough: the candidate sits in one seat.

**D2. Marble has an API; the web app is enough to start.** The World Labs documentation lists a public API with a world generation endpoint, an export endpoint (`asset_type` of `splats` or `mesh`, `format` of `ply` or `glb`) and a credits endpoint. API credits are separate from Marble web app credits. Phase 0 uses the web app. The API is used only if the owner wants rooms generated from a script.

**D3. Export formats.** Per the World Labs export documentation: splats as SPZ or PLY at about 2M or about 500k splats, collider mesh as GLB (100k to 200k triangles), high-quality mesh as GLB (about 600k triangles textured, about 1M with vertex colors), and a 2560 by 1280 equirectangular panorama as PNG. Default worlds use the OpenCV axis convention (+x left, +y down, +z forward), so the viewer applies a 180-degree rotation about X, as the Marble web viewer does. File sizes in megabytes are not documented; phase 0 measures them.

**D4. The viewer is three.js with Spark.** Spark is a splat renderer for three.js made by World Labs. Its site lists support for PLY, SPZ, SOGS, SPLAT and KSPLAT. Spark's WebXR support is unverified; phase 5 checks it first.

**D5. The room is optional at runtime.** Any failure to load the scene falls back to a flat backdrop. The voice loop never waits on the room.

**D6. The interviewer is a voice and a marker.** It speaks from a position in the scene using Web Audio spatial panning. A simple marker object (a desk name card or a soft light) shows where the voice comes from. No avatar.

**D7. Feedback comes after the session only.** The interviewer never grades during the interview. This keeps the conversation natural and keeps the feedback pass free to read the whole transcript.

**D8. Local first for audio.** Candidate audio is stored and transcribed locally. If a hosted LLM is selected, only text goes to it, never audio.

**D9. Provider options.** Each layer has a provider interface. The first option in each list is the recommendation. `[PAID]` marks a cost.

Speech to text:
1. whisper.cpp running locally (on the Mac or the home GPU box). $0. Accuracy is good for clear speech; latency depends on model size and hardware (unverified until measured in phase 2).
2. Browser Web Speech API. $0 and no setup, but behavior differs between Chrome and Safari and audio may leave the machine (unverified, check before use).
3. Hosted streaming STT. `[PAID]`. Lowest latency, audio goes to a third party.

Interviewer LLM:
1. Claude API. `[PAID]`, needs the owner's approval. Default once approved. Expected to give the best follow-ups; phase 2 compares it with option 2 on the same fixtures. The API key stays in the server `.env`.
2. Local model through llama.cpp on a home GPU box. $0. Follow-up quality and latency are unverified. Runs until option 1 is approved.

Text to speech:
1. A local open-weight voice (Kokoro or Piper, to be checked for licence, install path and quality in phase 2). $0. Unverified.
2. Browser `speechSynthesis`. $0, zero setup, lowest voice quality. The baseline that always works.
3. The text-to-speech code in the owner's existing prep tooling (a Gemini-based function with a content-hash audio cache). Cost status unverified, and its own code backs off on rate limits, so it suits pre-rendered fixed lines such as the opening and closing better than live turns.
4. A hosted voice service. `[PAID]`. Best voice quality, adds a network hop to every turn.

**D10. Sessions are single user and local.** No login, no hosting in version 1. A static HTML draft can go to a Vercel preview with the owner's go; the real app runs on localhost.

**D11. Browsers.** Chrome and Safari are both tested before any phase is called done.

**D12. Public repository.** Question banks in `banks/` are invented samples. Real banks are read from a local folder named in `.env` and never copied in.

**D13. Interviewer rules.** The interviewer asks one question at a time. It asks at most two follow-ups per question, and each follow-up quotes or paraphrases something the candidate said. It states no fact about the candidate or about a company unless the setup context or the transcript supplies it. It does not reveal reference answers.

## 6. Acceptance criteria & states

Targets marked "initial" are starting numbers. They get revised once phase 0 (room) and phase 2 (voice) have produced measurements, and the revision is committed to this file.

**Done means:**

Room
- **AC-1** From a cold page load on the development Mac, the seat view is visible within 15 seconds (initial) with a splat file under 60 MB (initial). The measured numbers are recorded in `spike/results.md`.
- **AC-2** The room renders at 30 fps or higher (initial) averaged over 10 seconds while the camera looks left and right. The fps counter is shown in a debug overlay and in the log.
- **AC-3** Dragging rotates the view up to the room's `lookLimitDeg`, and the camera never leaves the seat position.
- **AC-4** With the splat file renamed, a session still starts, shows a visible "room unavailable, using plain backdrop" notice, and completes a full voice loop.
- **AC-5** The interviewer voice is audibly positioned toward the interviewer anchor: with headphones, a test tone and then a spoken line come from the anchor's side of the view.

Voice
- **AC-6** The gap between the end of the candidate's speech and the first interviewer audio is 2.5 seconds or less at the median and 4 seconds or less at the 95th percentile (initial), over at least 20 turns, read from the session log.
- **AC-7** Speaking while the interviewer talks stops the interviewer audio within 500 ms, read from `interrupted` turns and their timestamps.
- **AC-8** After 8 seconds of candidate silence the interviewer gives a short prompt. After a further 12 seconds it offers to move to the next question. Both values are settings.
- **AC-9** In a 10-minute session the interviewer asks at least 4 distinct bank questions, repeats none, uses at most 2 follow-ups per question, and delivers the closing line between 9:00 and 11:00.
- **AC-10** For 5 scripted candidate answers that each contain a distinctive claim, the interviewer's follow-up refers to that claim. Checked by reading the 5 follow-ups.
- **AC-11** The interviewer states no fact about the candidate that the setup context or the transcript does not contain. Checked by reading every interviewer line in the real-input session.

Question banks
- **AC-12** The bank parser reads the owner's existing question-bank markdown (headings of the form `### N. "Question"`, with `Say`, `Follow-up` and `Guard` lines) into `Question[]`. Entries marked as missing an answer get `hasReferenceAnswer: false`. Include directives and emoji markers are stripped from question text.

Report
- **AC-13** The report is ready within 60 seconds (initial) of ending a 10-minute session.
- **AC-14** Every strength and gap in the report carries a turn index and a quote, and a script confirms that each quote appears word for word in that turn's text.
- **AC-15** Delivery numbers (words per minute, filler count, median answer length, longest pause) match a hand count on a 2-minute fixture transcript.

Privacy and repository
- **AC-16** With all providers local, a full session sends no request to a host other than localhost. With the Claude API selected, the only external host is the API host, and the request bodies contain text only.
- **AC-17** `git ls-files` shows nothing under `media/` or `sessions/`, no `.env`, and no real question bank.

Quality
- **AC-18** Chrome and Safari each complete a full session.
- **AC-19** The `unslop` anti-slop audit runs before the phase 1 draft is built, again before phase 1 sign-off, before phase 3 is called done, and before phase 4 is called done. Findings are fixed or listed with a reason.

**States checklist** - every primary surface covers each state:

| State | Setup | Room | Report |
|---|---|---|---|
| default | Last-used choices filled in | Room view, captions, timer, mic meter | Summary on top, questions below |
| hover/focus | Visible focus ring on every control; keyboard-only setup works | Keyboard shortcut for mute and end, with visible focus | Keyboard stepping through questions, play buttons focusable |
| empty | No banks found: explains the bank folder setting. No past sessions: says so | Session with no candidate speech yet: "Say something when you are ready" | Session ended with no answers: report says there was nothing to review |
| loading | Bank list loading | Room loading with progress and a "skip room" button | Report generating with a stage label |
| error | Server unreachable, bank unreadable | Mic denied, STT/LLM/TTS failure with retry, room load failure with fallback | Feedback pass failed: transcript still readable, retry button |
| long content | Long role context scrolls inside its box | Long interviewer sentence wraps in captions | Long answers collapse with "show more" |
| small screen | Usable at 390 px wide | Flat backdrop and captions below 700 px wide | Single column |
| dark mode | Follows system setting | Dark by default | Follows system setting |

**Explicitly not doing:** live-generated worlds, avatars, accounts, hosting the room files, scoring that predicts hiring outcomes, coaching mid-interview, mobile layout for the room screen, any company-specific content.

## 7. File touch list

Phase 0 (spike):
- `.gitignore` (new): `media/`, `sessions/`, `.env`, `node_modules/`, `dist/`
- `spike/README.md` (new)
- `spike/prompts/interview-office.md` (new)
- `spike/viewer/index.html` (new)
- `spike/results.md` (new)

Phase 1 (draft):
- `draft/index.html`, `draft/setup.html`, `draft/room.html`, `draft/report.html` (new)
- `draft/draft.css`, `draft/draft.js` (new)
- `draft/unslop-notes.md` (new)

Phase 2 (voice loop, outline):
- `package.json`, `tsconfig.json`, `vite.config.ts`, `.env.example` (new)
- `server/src/index.ts`, `server/src/session.ts`, `server/src/log.ts` (new)
- `server/src/banks/parse.ts`, `server/src/banks/parse.test.ts` (new)
- `server/src/interviewer/engine.ts`, `engine.test.ts`, `prompt.md` (new)
- `server/src/providers/llm/{claude,local,fake}.ts` (new)
- `server/src/providers/stt/{whisper,fake}.ts` (new)
- `server/src/providers/tts/{local,browser,fake}.ts` (new)
- `app/src/audio/{capture,vad,playback}.ts` (new)
- `app/src/screens/{Setup,Room,Report}.tsx` (new, voice-only at first)
- `banks/sample-bank.md` (new, invented questions)
- `fixtures/transcripts/*.json` (new, invented)

Phase 3 (room, outline):
- `app/src/room/{RoomView,loadScene,seatCamera,spatialAudio}.ts` (new, from the spike)
- `app/src/screens/Room.tsx` (edit)
- `rooms/*.json` (new, room metadata only, no scene files)

Phase 4 (report, outline):
- `server/src/feedback/{metrics,prompt.md,rubric.md,run,verifyQuotes}.ts` (new, with tests)
- `app/src/screens/Report.tsx` (edit)

Phase 5 (Quest, outline):
- `app/src/room/xr.ts` (new)
- `docs/quest-notes.md` (new)

Edited throughout: `README.md` (status line and links), `docs/spec.md` (initial targets replaced by measured values).

The reviewer diffs each pull request against the phase's list above. A file outside the list needs a line in the pull request explaining why.

## 8. Verification plan

- **Static checks:** `npm run typecheck`, `npm run lint`, `npm test` (vitest) pass on every pull request. Parser, interviewer state machine, metrics and quote verification have unit tests with invented fixtures.
- **Visual gate:** screenshots of each screen in each state, in Chrome and Safari, at 1440 by 900 and 390 by 844, stored in the pull request description from local files. The `unslop` audit report is attached to each UI pull request.
- **Measurement gate:** phase 0 fills `spike/results.md` (load time, file size, fps, browser). Phase 2 fills a latency table from the session log. Initial targets in section 6 are replaced by measured values before phase 3 starts.
- **Privacy check:** open the browser Network panel and the server log during a local-provider session and confirm AC-16.
- **One real-input test:** one full 10-minute mock interview, run end to end with the owner's real question bank loaded from the local prep folder (path in `.env`), on both the voice-only app and later in the room. The session is recorded (audio and log, kept local) and reviewed by the owner after the run. Reviewer checklist:
  1. Read the latency percentiles from the log (AC-6) and the interruption timings (AC-7).
  2. Listen to the recording once and mark each follow-up as "responded to what I said" or "generic". Target: at least 8 in 10 marked responsive (initial).
  3. Read every interviewer line for invented facts (AC-11).
  4. Open the report and check three quoted lines against the transcript by eye, after the script check (AC-14).
  5. Say whether the report named something true about the answers that the owner had not noticed.

  Green unit tests and a passing build do not count as this test. The real bank is the point: the parser (AC-12) meets formatting no invented fixture contains.

---
*Format: the spec template from the owner's design practice kit.*
