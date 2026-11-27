# Decisions taken on 2026-11-21

The owner said to take the recommended decision at each open choice and record it. One line per decision, with the reason.

## Taken by the controller

1. Built past the plan's owner gates (draft review, phase gates) so the whole plan could be executed in one run. The owner reviews the draft and the running app afterwards.
2. The parser reads unquoted and decimal question headings. The real banks use them, and a parser that skips a third of the headings would lose questions silently.
3. The offer to move on waits for a reply. The spec says the interviewer offers, and an offer that does not wait is not one.
4. The turn-taking gap and report time get a speed pass before any target is relaxed. Result: see docs/acceptance-results.md.
5. Marble generation and export stay with the owner. They need his account and may need a paid plan. Prompts and a checklist are ready (`spike/prompts/`, `spike/README.md`).
6. Extra rooms (task 3.5, optional): prompts are written. The two-voice panel code waits until one real room exists, because it cannot be judged without one.
7. The real-input session is replaced for now by a scripted stand-in with a real bank and synthesized answers. The owner's own session is still required for the sign-off.
8. The interviewer model is the local Gemma 4 E4B on the Mac. The paid Claude provider stays switched off behind `ALLOW_PAID`.
9. Enter VR is written and untested. Nothing more is built for the headset until it is tried on one.

## Taken while carrying out the items

10. A question heading is any level-3 heading that starts with a number (N or N.N, with or without a trailing dot). Level-3 headings that do not start with a number are not questions. Decimal numbers give ids like `<bank>-q2-1`; ids of the quoted form do not change.
11. A level-3 heading that starts with a number is always a question, even if it is a year or a count. Reason: a rule that looks only at the shape of the heading is predictable, and the real-bank check found no counter example.
12. While the offer waits, a reply that is only an agreement (a small fixed word list: yes, sure, okay, next, skip, move on and similar, at most six words) moves to the next question. Any other speech, including "no", is treated as the answer to the current question. Reason: a wrong guess toward moving on throws away an answer, a wrong guess toward answering costs one extra follow-up.
13. After the offer, either silence event (prompt or offer) with no speech moves to the next question without asking again. Reason: the browser loop sends `silence_prompt` after an offer turn, so accepting both makes the spec rule work with no change to the loop.
14. If time is already up when the offer would be made, the interviewer closes instead of offering. Reason: asking to move on at the end of the session has nothing to move to.
15. The older server test for silence turns was updated to the new two-step offer (`server/src/session.test.ts`, one test only). Reason: the behaviour change broke it, and the speed work does not touch that test.
16. The scripted stand-in with a real bank reads the bank through a temporary symlink on a second server (port 8961) that is stopped afterwards. Reason: the bank is never copied and nothing from it is committed. Counts only are recorded.
17. A quoted heading that lists alternate wordings as "A" / "B" keeps the first wording as the question. Reason: the scripted run with a real bank spoke two wordings run together with a stray quote mark, and 89 headings use that form. Headings with other stray quote marks (245 parsed texts) are left for the owner to confirm.

## Fixed 2026-11-21, second pass

- Capture clock offset (commit `6d470b0`): the pipeline reads the clock at the first audio chunk (clock minus chunk length minus session start) instead of before the worklet loads. Test: `test_capture_offset_taken_at_first_chunk`. Small remaining bias: the delay of the first worklet message (a few ms to tens of ms), not corrected.
- Model first token (commit `ed3bfe7`): `prompt.md` now runs persona, rules, setup notes, then the question, then the do-not-say lines, so everything before the question is the same for every question of a session. Test: `test_prompt_keeps_stable_text_first_and_question_last`. Interviewer wording and leak checks unchanged (249 tests pass).
- Clock mismatch between interviewer and candidate turn times: nothing to change. The browser already maps its clock onto the server's `startedAt` (`sessionStartOnPerfClock`, tested), so both sides count from one origin. Only real clock skew between two machines would remain, and the app is localhost.
- Faster first speech unit: not done. Follow-ups are one or two short sentences, so a clause cut saves little and puts a seam into each one. Bank questions and fixed lines are single units already, and fixed lines are cached.

Measurement after the fixes (scripted fake-microphone session `0mwrd0f8racc5`, 8 answers, 16 s gaps, `scripts/e2e-fake-mic.mjs`; machine load average 11 to 15 over the run, under the 20 bar):

| Measure | Before | After | Target |
|---|---|---|---|
| Turn-taking gap, median | 3.4 s | 2.70 s (n=7, p95 3.37 s) | 2.5 s, not met |
| Report time | 37 s | 28.6 s (3 questions, 4 calls, concurrency 3) | 60 s, met |
| Model first token, median | about 0.55 s | 0.30 s (n=11) | none |
| First audio from the speech engine, median | 0.7 to 1.2 s | 0.66 s | none |

Runs are single and shorter than the earlier ones (7 gap values against 21), and the capture fix changes the origin of the speech end time, so the gap is not strictly the same quantity as before. No tuning was done after this measurement.

## Postponed
- Speed pass, faster first TTS unit (second pass: a comma cut was judged choppy for 12-word follow-ups and left alone; the options below still stand): Kokoro takes 0.7 to 1.2 s (more under load) for the first sentence. Needs: cut an opening clause as its own unit (touches the sentence splitter and the interviewer prompt, another agent's files), or a faster voice model, or caching bank questions (and rendering the next question while the candidate talks).
- Speed pass, streaming STT: would remove the remaining wait for whisper when the speaker pauses for less than 550 ms; needs a streaming whisper build.
- Speed pass, report earlier: start each question's feedback call as soon as that question is done during the session; needs a decision on sharing the model with the live interview.
- Marble room (tasks 0.2, 0.3, 0.5): generate and export one room. Needs: the owner's Marble account, and the Standard plan if the free plan cannot export. Prompts and the checklist are in `spike/`.
- Room load time and frame rate (AC-1, AC-2, task 0.4 step 6): never measured on a real room. Needs: the Marble export, then Chrome and Safari in a visible window.
- Extra rooms and the two-voice panel (task 3.5): prompts written, no code. Needs: one real room first, and Marble generations.
- Real-input session (tasks 2.7, 3.6, 4.5; AC-11): a scripted stand-in with a real bank ran instead. Needs: the owner at a microphone for 10 minutes, then his marks on the follow-ups and the report.
- Voice position by ear (AC-5): the panner values follow the view, nobody has listened. Needs: the owner with headphones.
- Safari (AC-18): not opened once on any screen. Needs: the owner, or Safari remote automation switched on by him.
- Headset (task 5.3, and the check of 5.2): Enter VR is written and untested. Needs: a Quest 3.
- Owner review of the draft (task 1.5 steps 3 and 4): the app was built from the draft without it. Needs: the owner to open `/draft/index.html` and say what changes.
- Frame rate on a sample scene in a visible Chrome window: still not measured (the 2026-11-27 run had only a hidden browser pane, whose numbers do not count). Needs: a visible window. The other three dropped checks ran on 2026-11-27, see below.
- Parser reading to confirm: 245 of 2053 parsed questions still contain a quote character, and any level-3 heading that starts with a number counts as a question. Needs: the owner to look at a few parsed questions from his own banks.
- Paid interviewer model: the Claude provider is written and never called. Needs: the owner's go and `ALLOW_PAID=1`.

## Checks run 2026-11-27

All headless or scripted, on the owner's Mac, load average 10 to 15. 249 tests, typecheck and lint pass on `6bb4540`.

- Core loop, headless Chrome with a fake microphone (`node scripts/e2e-fake-mic.mjs --answers 4 --gap-sec 16 --turns 4`): session `0mwzgb4u47f7a` ended normally, 4 candidate turns, AudioWorklet capture, Kokoro voice, gaps 3561, 3220 and 2330 ms (median 3220, n=3, too few to compare with AC-6). Page requests only to `localhost:8940` and `blob:`. Report written, quotes verified 7 of 7 (`scripts/verify-report.ts`), report screen renders.
- ScriptProcessor capture and browser voice (`--no-worklet`, new option in `scripts/e2e-fake-mic.mjs`, against a second server with `TTS_PROVIDER=browser`): session `0mwzgkbfd44f0` ended normally with 3 candidate turns; capture took the ScriptProcessor path (worklet 0, script processor 1) and `speechSynthesis.speak` ran 10 times. Headless Chrome has 0 voices, so nothing was audible; whether the browser voice sounds acceptable is still unchecked.
- Real-bank stand-in rerun after the alternate-wording fix (same setup as the 2026-11-21 run: second server on 8961, symlink to the bank file with the most questions, removed afterwards, nothing copied): parser over the owner's banks still gives 105 files and 2053 questions, 245 with a quote character. Session `0mwzgef8fc7ab`: 10 answers, 4 questions asked, 0 repeats, at most 2 follow-ups per question (7 in all), 0 of 12 interviewer lines contain a quote mark, bold marker, emoji or the word Guard (the run before the fix had 2 of 4 questions with run-together wordings). The script stopped after its 10 answers, before the closing line. Server-side gap median 2.3 s (n=10), not the browser gap AC-6 uses.
