# Phase 3 notes: room module and spatial voice

All numbers below come from the public sample splat (a butterfly), not the Marble room. The Marble room file was not present.

## What exists
- `app/src/room/RoomView.ts`: `createRoomView(opts)` mounts a three.js canvas with Spark, a fixed seat camera and the marker.
- `loadScene.ts`, `fetchSplat.ts`, `sceneTransform.ts`: download with progress, status check before parsing (a 404 or an HTML fallback page is a clean error), 30 s timeout, abort, then the 180 degree X rotation, `metricScaleFactor` and `groundPlaneOffset`.
- `seatCamera.ts`: pure seat math and the 10 s fps meter. Yaw 0 looks down -Z and a positive yaw turns left. Pitch limit 30 degrees. Arrow keys turn the view, eased unless `prefers-reduced-motion`.
- `spatialMath.ts`, `spatialAudio.ts`: HRTF panner at the anchor, listener at the seat facing the camera. `createSpatialVoice` disconnects `source` from the context destination and routes it through the panner. `dispose` reconnects it.
- `marker.ts`: soft additive light sprite at the anchor, size and brightness follow `setMarkerLevel(0..1)` with fast attack and slow release.
- Demo: `app/room-demo.html` at `http://localhost:8940/room-demo.html` (`?sample=1` for the public sample, `?splat=<url>`, `?debug=1` logs fps). Without those it loads the room file path. The demo room is built in code.
- Versions pinned as in the spike: three 0.180.0, `@sparkjsdev/spark` 2.4.0, `@types/three` 0.180.0.

## Checks (sample splat, not the Marble room)
- Unit tests: 23 pass (limits, position fixed, reduced motion, fps window, direction math including anchor right is positive and facing it centres it, transform, fetch errors, progress, timeout, abort, marker).
- Sample splat renders upright (`?sample=1`, no axis fix). Load to first frame 0.36 s (the file was already in the browser cache, so this is not a cold number).
- Drag: a 200 px drag moved yaw to 45.8 degrees. Larger drags stopped at +60 and -60. Pitch stopped at -30. An arrow key moved yaw by one 10 degree step.
- Missing file: the Vite dev server answered 502 (the API server was not running), the demo showed "Room unavailable: No room file at /media/rooms/interview-office/room.spz (HTTP 502). Using a plain backdrop." and one canvas stayed mounted.
- AC-5 by numbers: panner stayed at [1.5, 1.2, -2], listener at [0, 1.2, 0]. With yaw -50 the anchor was at azimuth -13.1 degrees (left of view). With yaw 31.7 it was at +68.5 (right of view). Listener forward vector followed the camera. Facing the anchor exactly (yaw -36.9) gives azimuth 0, covered by a unit test.

## Not verified
- Heard with headphones: not done, needs the owner.
- Frame rate (AC-2): the Browser pane was hidden, so the page's animation loop ran at about 1.4 fps (a plain requestAnimationFrame loop measured the same). No valid fps number. Measure with the pane in view.
- Cold load time against the phase 0 number: needs the real room file.
- Safari: not run.
- Axis fix on a real Marble export: the sample is not in that convention, so the 180 degree flip was only unit tested.
- "Speak a line": the Kokoro server on 8943 answers, but sends no CORS header, so a browser page on 8940 cannot read it. The button shows a message. The test tone is the check until the server adds CORS or the app proxies `/tts`.
- `rooms/interview-office.json` did not exist, so the module was not run against it.

## Room screen (Tasks 3.3 and 3.4)

### What was built
- `app/src/room/fallback.ts`: `decideBackdrop` (pure) and `createBackdrop` (owns the room view). The Room screen calls `backdrop.start()` and never awaits it. Every failure path (constructor throws, WebGL missing, load error, timeout, user presses Skip room, failure after the first frame) ends in the flat backdrop with a notice. Below 700 px wide the room is never mounted and there is no notice, because flat is the default there. When the window grows past 700 px the room mounts, and when it shrinks the view is disposed.
- Notice texts: "Room unavailable, using plain backdrop" (any failure) and "Room skipped, using plain backdrop" (Skip room). Both sit in a banner on the page for the rest of the session.
- `Room.tsx` mounts the view into `<div data-room-view>`. The room record comes from `GET /api/rooms` (matched on the session's `roomId`), the splat URL is `/` plus `splatPath`. The room starts loading before the Start press. The marker level follows `playback.level()` through a 100 ms interval that skips hidden tabs.
- Spatial voice: when the room is drawn and the session is live, `createSpatialVoice` routes `playback.output` through the panner at the first interviewer anchor and follows `onCamera`. When the room is not showing, or fails, `dispose()` reconnects the same node to the destination, so queued audio keeps playing. Seen in headless Chrome: panner at [0, 1.2, -1.6], listener at the seat facing -Z.
- Debug panel on `D` or `?debug=1`: fps (the view's 10 s average), room load ms, last gap, backdrop mode, yaw, last interrupt stop, phase and turns.
- Dev only: `?splat=<url>` replaces the room file with a sample splat (flip off, offset as in the demo); `?state=<name>` shows one of the nine states with sample text on a real session page.
- Server: candidate turns now carry `questionId` (the question the interviewer asked last). The feedback service keeps `withQuestionIds` for old logs.
- `app/index.html` has an inline SVG favicon.
- `scripts/e2e-fake-mic.mjs` has `--query` and prints the notice text, the backdrop mode, the voice panner values and the debug fps line.

### Checks
- Unit: `test_room_failure_does_not_block_session` runs the real loop with fakes and fails the room before start, while loading and mid-session; the loop's first request goes out in the same tick every time and the loop never enters its error phase. Also: decision table, skip, narrow screen, throwing listener. 198 tests pass, typecheck and lint clean.
- AC-4 for real (no `media/rooms/interview-office/room.spz` exists): `node scripts/e2e-fake-mic.mjs --turns 3`, headless Chrome 157 with a fake microphone and the local models. Session started, page showed "Room unavailable, using plain backdrop", backdrop mode `flat`, 3 candidate turns completed, the session ended and the report route opened. An earlier 4 turn run (before the notice check existed in the script) also ended. The only console error is the expected 404 for `room.spz`.
- Room showing: same script with `--query 'splat=https://sparkjs.dev/assets/splats/butterfly.spz'`. Headless Chrome has WebGL here. Backdrop mode `room`, no notice, panner created, 3 candidate turns completed, session ended. (A run before it failed on the microphone with an AudioContext device error and 0 turns; the next run on the same setup passed, so I treat it as a device hiccup, not a room effect.)
- Gaps in those runs were 4 to 9 s because the machine load average was about 30 (above 50 is the limit for trusting a suite verdict, but timings are doubtful at 30). Do not read AC-6 from them.
- fps: the number the debug line shows in headless Chrome (60) is not a measurement of the real room. In the Browser pane the animation loop ran at about 2 to 3 fps (software rendering, high load), so fps for AC-2 is not measured.
- Browser pane, 1440x900 and 390x844, real session page, with and without the sample splat. Seen: room unavailable (notice), room loading (62 percent forced, Skip room button), interviewer speaking (flat chip and, with the sample splat, the butterfly drawn with the caption plate legible over a bright subject), provider error with Retry, mic denied banner with Retry (forced), ending, and the 390 px flat layout (no room mounted, no notice). Not reached for real: the pane's microphone request never resolved, so the real mic denied and a real loop run were not seen there (the E key still ended the session and opened the report). Candidate speaking and silence prompt were seen in the e2e output (status line) and forced pages only in code, not as separate screenshots.
- Safari: not checked.

### Room screen audit (unslop)
Constraints read before the work, audit after. Evidence below.
- Mechanical: `rules.mjs selftest` passed first. `rules.mjs check` on `Room.tsx`, `room.css`, `fallback.ts`, `index.html`: one reflex hit, MOT-6 (`visibility: hidden` on the room slot while the backdrop is flat). Waived in a comment with evidence: the selector needs `body[data-backdrop]`, which only script sets, so nothing is hidden when script fails.
- Impeccable 4.8.0 `detect` on `Room.tsx` and `room.css`: no findings (`[]`).
- Render tier, 375 and 1280, light and dark, six states (room unavailable, interviewer speaking with debug, provider error, room loading, ending): 0 FAIL, 0 WARN. That covers overflow, focus, state stability, motion at rest, contrast, tap targets, readable text, script errors.
- Fixed during the audit: the interviewer chip flowed into the controls on wide screens because an earlier app rule set `position: relative` on it (found by looking at the screenshot, not by the tools); debug readout is now a labelled list on a solid plate at 13 px, not a loose line.
- CPY-4 and CPY-7: no exclamation marks, no invented numbers (sample caption text in the dev-only forced states is plain invented interview text). CMP-7: one filled control per view in each state (Start, Retry, Retry microphone or Open report); Skip room and End session are outlined. STA-6: the room state has a word (notice, status line), not just colour. LAY-15: the notice and loading banners appear above the captions without moving them (the bottom block is anchored to the bottom).
- Not checked: Safari; the render tier does not click through states, so hover and focus on the Skip room button were read from the page styles (the shared `:focus-visible` rule), not measured on that button; contrast of captions over a real Marble room (only the butterfly sample); the draft's screenshots were compared by eye, not by pixels.
- Reviewer: the skill asks for a fresh-eyes reviewer agent; I may not spawn agents, so this pass was done by me. A cold review is still open.
