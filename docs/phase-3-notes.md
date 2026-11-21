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
