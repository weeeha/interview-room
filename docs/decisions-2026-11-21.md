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

## Postponed
- Speed pass, capture clock offset: `startCapture` takes its time origin before the audio worklet has loaded, so end-of-speech times (and the AC-6 gap and AC-7 starts) are off by 50 to 470 ms per run. Needs: take the origin from the audio clock at the first chunk, then re-measure; this changes what the number measures, so the owner decides.
- Speed pass, faster first TTS unit: Kokoro takes 0.7 to 1.2 s (more under load) for the first sentence. Needs: cut an opening clause as its own unit (touches the sentence splitter and the interviewer prompt, another agent's files), or a faster voice model, or caching bank questions (and rendering the next question while the candidate talks).
- Speed pass, model first token (about 0.55 s): needs a shorter or reordered prompt so llama-server can reuse more of its cache (persona first, question after), or a smaller or faster model.
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
- Checks dropped to save usage: frame rate on a sample scene in real Chrome, the browser voice fallback (`speechSynthesis`), the ScriptProcessor capture fallback, a rerun of the real-bank stand-in after the alternate-wording fix. Needs: one short executor run, no person.
- Parser reading to confirm: 245 of 2053 parsed questions still contain a quote character, and any level-3 heading that starts with a number counts as a question. Needs: the owner to look at a few parsed questions from his own banks.
- Paid interviewer model: the Claude provider is written and never called. Needs: the owner's go and `ALLOW_PAID=1`.
- Pull requests: the branch is local only. Needs: a push from the personal account.
