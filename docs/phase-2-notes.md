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

## Text to speech

- Providers: `browser` returns null and the client speaks with speechSynthesis; `fake` returns a deterministic sine WAV (length from word count, pitch from voice id); `local` is Kokoro-82M. `createTTSProvider(env)` in `server/src/providers/index.ts` builds one from `TTS_PROVIDER`. The local one reads `LOCAL_TTS_URL` and an optional `TTS_CACHE_DIR` (default `media/tts-cache`).
- Kokoro server: `scripts/kokoro-server.sh` runs `scripts/kokoro_server.py` through `uv run --python 3.12 --with kokoro-onnx --with soundfile` on port 8943 (`POST /tts {text, voice}` returns WAV, `GET /health`). Models are read from `~/models/kokoro`. All synthesis runs on one worker thread, warmed at start. Nothing is installed globally.
- Voices: the profile ids in `profiles.ts` were already real Kokoro names, so nothing changed there: warm `af_heart`, neutral `am_michael`, probing `bf_emma` (British, so the server picks `en-gb` for voices that start with `b`).
- Licence: Kokoro-82M is Apache 2.0 (model card, as I know it; not re-checked online) and the `kokoro-onnx` package ships an MIT-style licence file. Its phonemizer comes from `espeakng-loader` (espeak-ng, GPL): fine for a local tool, but check it before any redistribution.
- Fixed-line cache: `media/tts-cache/<voice>/<sha256 of text>.wav`, filled by `npx tsx scripts/prerender-fixed-lines.ts` for every profile (12 lines). The local provider reads the cache first for any text and only writes through the script.
- Quality: not judged by ear (no speakers in this session). The WAVs are sane: durations 1.6 to 4.4 s for lines of 4 to 15 words (ffprobe).
- Timings (Mac under load average 9 to 18, so pessimistic). One 9-word sentence ("Tell me about a time you changed your mind", af_heart, 2.2 s of audio), through the local provider, warm server: 731, 611, 543 ms. First request on a cold server also loads the phonemizer, which the warm-up call absorbs. Fixed lines took 0.4 to 0.9 s each to render. A cache hit takes 2 ms. Kokoro renders a whole sentence before any audio comes back, so time to first audio equals render time for the first sentence. That is under the one-second bar, and the loop sends sentences one by one.
- Playback (`app/src/audio/playback.ts`): sentences with a url are fetched and decoded when queued and played back to back through one GainNode. Sentences without a url are spoken with speechSynthesis: the voice list is awaited for up to 1.5 s (Safari fills it late), an English voice is chosen by name, and text over 160 characters is spoken in chunks (Chrome cuts long utterances). If a url fails to load, the sentence is spoken instead. `stop()` is synchronous. The voice level for speechSynthesis is a fake pulse because that output cannot be tapped.
- Deferred to 2.6: the browser check that a 3-sentence reply starts playing before generation ends. Not tested in a real browser at all: the playback queue is tested only with fakes for AudioContext and speechSynthesis, so real Chrome and Safari behaviour (decodeAudioData, voices, autoplay unlock) is unverified.

## Turn loop, server side

Code: `server/src/session.ts` (store and turn pipeline), `server/src/routes/session.ts`, `server/src/routes/rooms.ts`, `server/src/network.ts`. Scripts: `scripts/latency-table.ts`, `scripts/scripted-session.ts`.

- Storage: `sessions/<id>/session.json` is rewritten atomically (temp file, then rename) after every turn, with `engine.json` beside it (the engine's `state()`). After a restart the session and its engine are rebuilt from those two files. The engine clock keeps counting through the downtime, because it is wall time since `startedAt`. Candidate audio is `audio/turn-NN.wav`, interviewer sentences `audio/turn-NN-sK.wav`. `Turn.audioPath` is relative to the session folder.
- One interviewer reply is one `Turn`. Its `kind` is the kind of the last sentence (an opening plus the first question is a `question` turn; a silence offer plus the next question is a `question` turn), and the sentence lines keep their own kinds. The candidate turn gets the index before it. So a start is turn 0, the first answer is turn 1, the reply is turn 2.
- Latency lives on the interviewer turn: `sttMs` (of the answer just transcribed), `llmFirstTokenMs` (first token seen by a wrapper around the LLM provider; 0 for fixed lines and bank questions, which need no model), `ttsFirstAudioMs` (first sentence line written to first audio line written, replaced by the browser value when `prev.ttsFirstAudioMs` arrives) and `gapMs` (from `prev` of the next request, or of `/end`). Fields that were never measured are absent, not zero, so a browser TTS run shows "no gap data" instead of fake numbers.
- Streaming: a `sentence` line is written the moment the engine yields it. Synthesis runs in the background, one sentence at a time and in order, and writes the `audio` line when ready. The first sentence's audio goes out before the LLM has finished (a test holds the LLM open and checks this).
- Interruption: `prev.interrupted` marks that turn `interrupted`, sets its `endMs` to `prev.interruptStopMs` (read as ms since session start, the same clock as `speechStartMs`), replaces its text with `prev.spokenText` when given, and calls `engine.commit` so the model only sees what was spoken. The stop time for AC-7 is then the interrupted turn's `endMs` minus the next candidate turn's `startMs`; `latency-table.ts` prints it as `stopMs`.
- Abort: if the client drops the request, the LLM stream is stopped through the AbortSignal and the sentences produced so far are saved as the interviewer turn and committed as interrupted. It is not an error.
- Errors: any failure writes an `error` line (`stt`, `llm` or `tts`) and the request leaves no trace (turns and engine state are rolled back), so the client can send the same turn again. An STT failure happens before anything changes. The engine itself falls back to a bank hint or the next question when the LLM fails, so an `llm` error line only appears for unexpected faults.
- Empty transcript: one `transcript` line with empty text and the stream ends. There is no `done` line and no interviewer turn.
- Not in the contract, added: `GET /api/sessions`, `GET /api/config` (silence and end-of-speech settings for the browser), `GET /api/rooms`, `GET /media/rooms/*` (404 when the file is missing), `GET /api/session/:id/audio/:file`. Env: `SESSIONS_DIR`, `ROOMS_DIR`, `MEDIA_DIR`.
- `rooms/interview-office.json` holds placeholder seat and anchor positions. They are unmeasured: no splat exists yet.
- AC-16: `server/src/network.ts` lists the hosts the configured providers talk to, `main.ts` logs each once at startup, and a test checks that the default URLs are on 127.0.0.1.
- Hook: `createApp(env, { onSessionEnded })` is called once when `/end` first ends a session. Default: nothing. `GET /api/session/:id` reports `reportStatus: "ready"` only when `report.json` exists, otherwise `"none"`.

### Real scripted session (2026-11-21)

`SERVER_URL=http://127.0.0.1:8951 TARGET_SEC=180 PACE_SEC=10 npx tsx scripts/scripted-session.ts` against the real services (Gemma 4 E4B on 8944, whisper large-v3-turbo on 8942, Kokoro on 8943), no microphone. Candidate answers are invented and spoken with `say`. The script waits 10 s before each answer so the engine clock reaches the closing time. Mac load average 6 to 9. The interrupted turn and its 180 ms stop time are simulated, because the script has no speaker. The silence prompt row is a fixed line from the cache.

```
turn kind        sttMs  llm1st  tts1st   gapMs  stopMs interrupted
   0 question        -       0     917     917       -
   2 followup      590     209    1836    1836       -
   4 followup      470     382    1874    1874       -
   5 prompt          -       0       8       8       -
   7 question      407       0    1054    1054     180 yes
   9 followup      415     411    1743    1743       -
  11 followup      451     433    1971    1971       -
  13 question      465       0    1049    1049       -
  15 followup      404     613    2159    2159       -
  17 followup      408     445    1805    1805       -
  19 closing       385       0     838     838       -

gapMs: n=11 median=1743 p95=2159
sttMs: n=9 median=415
llmFirstTokenMs: n=11 median=209
ttsFirstAudioMs: n=11 median=1743
```

The gap here is time from sending the answer to the first audio line, so it leaves out network to a browser, decoding and the 1.2 s end-of-speech window. The first run (before the load dropped) had a median of 1996 ms and a p95 of 4220 ms.

Reading the interviewer lines of both runs:
- No question repeated. No question had more than 2 follow-ups. The closing line came after about 150 s on a 180 s target (the engine closes at the first turn boundary after target minus 60 s, which for a short target is well under 90 percent).
- Every follow-up quoted something the scripted answer did say (seven customers, the heat map, the time picker, both orders on one page, the skeleton screen, the three biggest problems, skipping people who work with the team). No stated fact was missing from the transcript. One follow-up ("What was the process for selecting those seven customers?") assumes a selection process, which is a question and not a claim.
- The scripted answers are in a fixed order and do not always match the question asked, which the interviewer does not notice. That is a limit of the script, not of the loop.
- Whisper wrote digits for number words ("20 minutes"), harmless here.
- Not checked: any real browser, real voice, Safari, and the stop time of real playback (AC-7).
