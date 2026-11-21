# Phase 2 notes: interviewer engine and LLM providers

## Engine decisions

- Follow-ups come from the LLM. The model may answer `[NEXT]` when the answer was already complete, and the engine then moves on.
- If the LLM fails or says nothing, the engine speaks the question's next `followUpHints` entry, and if there is none it moves on.
- Pacing: follow-ups stop once the current question has run longer than (target minus 60 s) divided by 4, so at least four bank questions fit a session (AC-9).
- The closing line is spoken at the first turn boundary at or after (target minus 60 s). With 45 s answers and a 600 s target it lands at about 9:45.
- The engine sends the transcript to the LLM as one user message ("Interviewer: ... / Candidate: ..."), not as alternating chat roles. Gemma chat templates reject some role orders and this works on every provider.
- `commit(spokenText, interrupted)` replaces what the engine generated in its last turn with what was really spoken.
- The reference answer is never put in any prompt. `doNotSay` lines go into the system prompt.

## Local model check (AC-10)

- GPU box `http://192.168.100.2:8080/v1`: not reachable on 2026-11-20 (connection refused, probed with a 20 s limit). Nothing was started or stopped there.
- Fallback used: `~/models/gemma-4-E4B/gemma-4-E4B-it-Q8_0.gguf` served by the Homebrew `llama-server` on `127.0.0.1:8944` (started for the check, then stopped). No download.
- The model thinks by default and spent the whole token budget on its reasoning, so the first run returned empty text. `local.ts` now sends `chat_template_kwargs: { enable_thinking: false }`.
- Run with `LLM_PROVIDER=local LOCAL_LLM_URL=http://127.0.0.1:8944/v1 LOCAL_LLM_MODEL=gemma-4-E4B-it-Q8_0.gguf npx tsx scripts/followup-check.ts`. Each answer goes through the real engine with a one-question bank (neutral profile).
- Mac load average was about 7.4 during the run. Timings are for a single run each.

| # | Distinctive claim in the answer | Local follow-up (Gemma 4 E4B) | My mark | First token | Total | Claude |
|---|---|---|---|---|---|---|
| 1 | moved the launch date from March to June | You mentioned the offline sync lost data on the tug boats. What specific data was lost during that sync issue? | responsive (a specific detail of the answer, but not the date change) | 478 ms | 927 ms | not run, paid |
| 2 | a seventeen-person night shift | You mentioned rewriting the checklist in two days. What was the biggest challenge in that two-day turnaround? | responsive (specific detail, not the shift size) | 184 ms | 648 ms | not run, paid |
| 3 | paper maps taped to the dashboard | You mentioned adding a printed route sheet as a backup. How did that change impact the original project timeline? | responsive (the consequence of the paper maps, not the maps) | 171 ms | 601 ms | not run, paid |
| 4 | cut the report from forty pages to six | You mentioned dropping charts nobody had opened. Can you describe how you determined which charts were not being opened? | responsive (the planted claim) | 171 ms | 619 ms | not run, paid |
| 5 | an apprentice named Tomas who found the bug | You mentioned pairing with Tomas for a day. What did that collaboration look like? | responsive (the planted claim) | 174 ms | 508 ms | not run, paid |

Reading: 5 of 5 quote something the candidate said and none is generic. Two hit the planted claim exactly and three pick a neighbouring detail from the same answer. Under a strict reading of AC-10 ("refers to that claim") three are weaker. The first token of #1 was slower because the prompt was not yet cached.

Claude column: `claude.ts` is written and tested against a stubbed fetch only. It was never run against the API.

## Speech to text

- Server: `scripts/whisper-server.sh` starts the Homebrew `whisper-server` on 127.0.0.1:8942 with `--inference-path /v1/audio/transcriptions`, `--language en` and `--no-timestamps`. The model comes from `WHISPER_MODEL`, else the first `ggml-large-v3-turbo*.bin` under `~/whisper.cpp/models`, `~/models`, `~/.cache`, `/opt/homebrew/share`. On this Mac it is `~/whisper.cpp/models/ggml-large-v3-turbo.bin`. Nothing was downloaded.
- Provider: `server/src/providers/stt/whisper.ts` posts the WAV as multipart (`file`, `response_format=json`, `temperature=0`) and returns `{ text, ms }`. It strips bracketed tags such as `[BLANK_AUDIO]` and says how to start the server when it is not reachable.
- Browser: `app/src/audio/capture.ts` opens the mic with echo cancellation and noise suppression, reads PCM through an AudioWorklet (loaded from a Blob URL, so no bundler setting is needed; ScriptProcessor is the fallback), runs the energy VAD in `vad.ts`, keeps 300 ms before speech start and 300 ms after the last loud frame, and hands back a 16 kHz mono 16-bit WAV. The sample rate of the audio context is whatever the device gives (44.1 or 48 kHz) and is resampled by averaging.
- VAD: noise floor is the median RMS of the first 500 ms (no events then, so the page should ask for quiet at the start). Threshold is the larger of 0.015 and 3 times the floor. While the interviewer speaks it is 2.5 times higher, at least 0.04, and the floor stops adapting. These numbers are first guesses from synthetic signals and need tuning with a real mic.
- The reported `speechEndMs` is when the speaker went quiet, not when the 1.2 s window closed. The utterance callback therefore fires 1.2 s after `speechEndMs`.

### Real check with synthesized speech (2026-11-20)

- Input: macOS `say -v Samantha`, an invented 23.1 s answer about moving a delivery app from paper route sheets to a phone checklist, converted with ffmpeg to 16 kHz mono 16-bit WAV.
- Through `createWhisperSTT` against the live server: 761 ms (first call), then 630 ms and 619 ms. Mac load average was about 14, so these are not clean timings.
- Transcript by eye: all sentences correct. Differences: "route" heard as "root", "phone based" written "phone-based", "forty" and "twelve" written as digits. Nothing missing or invented.

### Not done, needs the owner at a microphone

- The 3 fixture clips of the owner's voice in `media/fixtures/`.
- Speaking a 20 second answer in Chrome and in Safari and seeing the transcript within the gap target. Safari microphone capture is untested, so no cause to record yet.
- VAD threshold tuning on a real mic and room, and the echo threshold with speakers on.
