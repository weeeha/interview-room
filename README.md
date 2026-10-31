# interview-room

**Problem.** Rehearsing an interview alone has no one to follow up on what you actually said and no sense of being in a room.

**Idea.** A voice interviewer asks questions from your own bank inside a room generated once with World Labs Marble, follows up on what you said, and writes feedback after the session. The voice loop comes first and the room second, because the questions and the feedback carry the value.

**Built.** Spec only so far: a design spec and an implementation plan for phases 0 to 5, and no code. 3 commits on 2 days, Oct 27 to Oct 30, 2026.

**Decision.** Feedback arrives after the session, with no coaching during the interview. The interviewer never grades live, which keeps the conversation natural and lets the feedback pass read the whole transcript.

Status: exploration. Live URL: none. Started 2026-10-27.

**TL;DR.** Rehearse a job interview inside a generated room. A voice interviewer asks questions from your own question bank, follows up on what you said, and writes feedback after the session. The room is a 3D scene made once with World Labs Marble and viewed in the browser. The voice loop is built first and the room second, because the questions and the feedback carry the value.

## What it is

A practice tool for one person. You pick a room (interview office, panel room, video-call corner), a question bank and an interviewer style. You sit in the scene and talk. The interviewer speaks through your speakers, listens, asks a follow-up that quotes your own words, and moves on. When the session ends you get a report: what held up, what was vague, and a rewrite of your weakest answer.

The room supplies the pressure of a place. It does not need to move. Marble makes a static scene, so the room is generated once, exported, and reused for every session.

## How a session works

1. Open the setup screen. Pick a room, a question bank, an interviewer style and a length (10 minutes by default).
2. Paste the role description if you have one. It stays on your machine and goes to the interviewer as context.
3. Press start. The room loads and you sit at your seat. Allow the microphone.
4. The interviewer greets you and asks the first question. Answer out loud.
5. When you stop talking, the interviewer replies, usually with a follow-up on something you said. You can interrupt it by speaking.
6. After the closing line, the session ends and the report opens. Audio and transcript are saved locally.

## How it works technically

```
  one-time, offline                       every session, in the browser + a small local server

  prompt or image                         +----------------------------------------------+
        |                                 |  Browser app (Vite + TypeScript)             |
        v                                 |                                              |
  World Labs Marble  --export-->  room.spz|  three.js + Spark: room viewer (seat camera) |
  (web app or API)              collider.glb  |  mic capture + end-of-speech detection     |
                                          |  captions, timer, spatial audio              |
                                          +----------+-----------------------^-----------+
                                                     | audio chunk           | interviewer audio
                                                     v                       | + text
                                          +----------+-----------------------+-----------+
                                          |  Voice server (Node + TypeScript)            |
                                          |                                              |
                                          |  STT --> interviewer LLM --> TTS             |
                                          |            ^                                 |
                                          |   question bank + role context + transcript  |
                                          |                                              |
                                          |  session log (JSON + audio) --> feedback pass|
                                          +----------------------------------------------+
```

The voice server does not depend on the room. If the scene fails to load, the session runs on a flat backdrop with the same voice loop.

## Stack

- Room: World Labs Marble, exported as Gaussian splats (SPZ or PLY) plus an optional GLB collider mesh.
- Viewer: three.js and the Spark splat renderer (made by World Labs). Optional WebXR for a Quest 3 in phase 5.
- App: Vite and TypeScript. Server: Node and TypeScript.
- Speech to text: local whisper.cpp first. Alternatives are listed in the spec.
- Interviewer: Claude API by default once the owner approves paid use. A local model on a home GPU box (llama.cpp) is the $0 fallback and runs until then.
- Text to speech: a local open-weight voice first, with the browser voice as the baseline. Alternatives are listed in the spec.
- Tests: vitest.

Genie 3 and Runway GWM Worlds 2 produce more dynamic worlds, but neither has a public API today (as of October 2026), so they are not used.

## Budget

$0 until the owner approves paid tools. Every step that can cost money is marked `[PAID]` in the plan, with a cost register at the top of [docs/implementation-plan.md](docs/implementation-plan.md). Marble's free plan allows 4 world generations; whether it allows exporting a world is unverified, and phase 0 settles it.

## Out of scope

- Live, streaming world models. Rooms are generated once.
- Animated interviewer avatars or lip sync. The interviewer is a voice with a marker in the room.
- Accounts, multi-user sessions, a hosted service, payments.
- Phone layouts for the room screen.
- Coaching during the interview. Feedback arrives after the session.
- Storing question banks, recordings or generated room files in this repository.

## Docs

- [docs/spec.md](docs/spec.md): what the tool does, the data model, decisions, acceptance criteria.
- [docs/implementation-plan.md](docs/implementation-plan.md): phases 0 to 5. Phases 0 and 1 are written step by step. Phases 2 to 5 are outlines to expand after the phase 0 results.

## Repository rules

- One branch per task and one pull request per change. Nothing goes to `main` directly.
- Media stays local and out of git: generated rooms, exported splats, meshes, recordings, transcripts. The `.gitignore` covers `media/` and `sessions/`.
- No client material and no real interview content in the repository. Sample question banks in `banks/` are invented.
- Secrets live in a local `.env` file that is ignored by git.
- Public repository prose avoids em dashes and exclamation marks.
