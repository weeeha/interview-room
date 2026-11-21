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
