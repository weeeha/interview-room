# Quest 3 and WebXR notes

Task 5.1. Read on 2026-11-21. Every answer below is from documentation, not tested on the headset. Nobody has run this project on a Quest 3. Project pins: three.js 0.180.0, Spark 2.4.0 (see `spike/README.md`).

## Question 1: Does Marble's own VR link work in the Quest browser?

From documentation, not tested on the headset.

- The World Labs FAQ says to open the world card and use the "Copy VR link" button to get a VR-compatible link, or click the VR icon to open the world directly in a VR headset. Source: https://docs.worldlabs.ai/marble/support/faq.md (read 2026-11-21).
- The FAQ does not name Quest, Vision Pro or any other headset. It gives no splat count or resolution limits.
- Press coverage says Marble worlds work on Quest 3 and Vision Pro. An UploadVR reviewer judged the quality below Meta's Hyperscape. Source: https://uploadvr.com/marble-turns-an-image-into-a-webxr-volumetric-scene-in-minutes (seen only as a search result summary on 2026-11-21, launch-period article, may be out of date).
- Gap: the FAQ does not say whether the link works for a world that was exported and edited locally. The link is for a world on the Marble site, not for our own copy of the room.
- Next step on a headset: open the VR link in the Quest browser and look at the room. This costs no code.

## Question 2: Does Spark support WebXR? What do the docs and issue tracker say?

From documentation, not tested on the headset.

- The Spark docs home page has a Quick Start with a plain `WebGLRenderer` and no XR setup. Source: https://sparkjs.dev/docs/ (read 2026-11-21).
- The Spark examples page lists an example named "WebXR". Its description and splat count did not load. Source: https://sparkjs.dev/examples/ (read 2026-11-21).
- Performance page: for Quest 3 use "1 million splats or less, not too many splats concentrated in a small area". For VR, `maxStdDev` of `Math.sqrt(5)` is a good value. Keep `antialias` off (default false), because it adds a lot of overhead with millions of splats. Source: https://sparkjs.dev/docs/performance/ (read 2026-11-21).
- Issue 263 (closed 2026-03-07): a 500K splat warehouse lagged on Quest 3 and Vision Pro when the user looked at one dense area (about 200K splats there). A contributor said the official Spark WebXR demo uses 500K splats and ran well. Splat distribution matters as well as count. Source: https://github.com/sparkjsdev/spark/issues/263 (read 2026-11-21).
- Issue 400 (open, opened 2026-07-26): on Quest 3 the immersive session hangs within about 2 seconds when MSAA, a per-frame shadow map pass and a `SplatMesh` are all active. Disabling any one avoids it. A contributor said MSAA is not recommended for splats and suggested rendering at about 0.5x resolution, fewer splats, or `SparkRenderer.autoUpdate = false` with manual `update()`. Source: https://github.com/sparkjsdev/spark/issues/400 (read 2026-11-21). A matching Meta feedback report lists it as under investigation, with Spark 2.1.0 and three.js 0.185.1: https://developers.meta.com/horizon/feedback/vr/investigations/1032432445810622/ (read 2026-11-21).
- Issue 395 (open): black screen on entering VR with a PICO headset. Issue 481 (open): iOS WebXR freeze with RAD streaming. Neither is about Quest. Source: https://github.com/sparkjsdev/spark/issues?q=is%3Aissue+xr+OR+vr+OR+quest (read 2026-11-21, titles only).
- Gap: no page I could read states a supported-headset list for Spark. The evidence is a WebXR example, user reports on Quest 3, and the performance page. The issue list above was a search for xr, vr and quest, so it may miss issues that use other words.
- Gap: the reports use Spark 2.1.0 and other versions. Nothing I read covers Spark 2.4.0 on Quest 3 specifically.

## Question 3: Secure context on the local network, and microphone permission

From documentation, not tested on the headset.

Secure context:

- MDN lists as potentially trustworthy: `localhost`, `127.0.0.0/8`, `::1`, `*.localhost`, and the `https`, `wss` and `file` schemes. `http://192.168.x.x` is not listed, so a plain LAN address is not a secure context. Source: https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts (read 2026-11-21).
- Meta's debugging page shows `adb reverse tcp:8080 tcp:8080`, then opening `localhost:8080` in the Quest browser. Source: https://developers.meta.com/horizon/documentation/web/browser-remote-debugging/ (read 2026-11-21). This makes the page load from `localhost` on the headset, which is a secure context.
- That page does not mention HTTPS, secure contexts or the insecure-origin flag.
- Gap: I found no primary source that says WebXR itself requires a secure context. MDN's WebXR fundamentals page I read did not cover it. "WebXR needs HTTPS or localhost" is unverified, from memory. A secondary source (Babylon.js forum, via search summary) says the same.
- Unverified, from a search summary of a third-party guide: the flag `chrome://flags/#unsafely-treat-insecure-origin-as-secure` in the Quest browser can allow a LAN HTTP origin. Not confirmed by Meta documentation.
- Options in order: `adb reverse` (needs USB and adb), HTTPS on the LAN (needs a certificate the headset trusts), or the flag.

Microphone:

- I found no Meta documentation on how the Quest browser prompts for microphone access. Meta's per-site permission page exists (https://www.meta.com/help/quest/1406582186767703/) but the search result gave no microphone detail.
- The microphone needs a secure context too. Unverified, from memory.
- Community reports (anecdotal): a Babylon.js forum post says that if a page has microphone access outside an immersive session it keeps it inside one (https://forum.babylonjs.com/t/using-meta-quest-2-microphone-inside-of-webxr-game/38321). One developer saw no active-mic indicator after allowing the prompt, caused by a disabled mic setting. An old thread reports `getUserMedia` audio failing in an older Oculus Browser build (https://communityforums.atmeta.com/discussions/dev-quest/oculus-browser-getusermedia-audio-no-longer-works/796501). All read as search summaries on 2026-11-21.
- MDN lists confirming microphone access as separate from entering immersive mode: https://developer.mozilla.org/en-US/docs/Web/API/WebXR_Device_API/Permissions_and_security (search summary, 2026-11-21).
- Plan for this project: ask for the microphone on the Setup screen, before the user presses Enter VR, so no prompt has to appear inside the headset. This is a design choice, not a finding.

## Section 4: What an "Enter VR" mode would need in this codebase

From documentation, not tested on the headset.

- three.js: set `renderer.xr.enabled = true`, add a VR button, and drive rendering with `renderer.setAnimationLoop`. The WebXRManager docs say `enabled` "notifies the renderer to be ready for XR rendering" and the default is false. Source: https://threejs.org/docs/pages/WebXRManager.html (read 2026-11-21). The button and loop steps are unverified, from memory (the manual page I fetched was only an index).
- Reference space: `renderer.xr.setReferenceSpaceType(...)` defaults to `local-floor` and cannot be changed during a session. Source: same page. Valid values are listed by MDN: https://developer.mozilla.org/en-US/docs/Web/API/XRReferenceSpace. Unverified, from memory: with `local-floor` the camera sits at real floor height, so the room's floor offset (`?ground=`) and the 1.2 m eye height in the spike must be reconciled. The seat marker would be placed at the XR origin.
- Existing look-around code: the spike clamps yaw and pitch from pointer drag. In VR the head pose drives the camera, so pointer drag must be disabled in an XR session.
- Splat renderer: Spark has a WebXR example and Quest 3 reports (Question 2). Keep `antialias` false, set `maxStdDev` to `Math.sqrt(5)`, and avoid per-frame shadow passes (issue 400).
- Splat budget on Quest 3: Spark says 1 million or less. About 500K splats is the size of the official WebXR demo, which a contributor said ran well (issue 263), so 500K is within documented guidance. 2M is above the documented 1M guidance. No source I read gives frame rates for 2M on Quest 3. Distribution matters: a dense cluster of about 200K splats caused lag in one direction.
- Other levers: `renderer.xr.setFramebufferScaleFactor` and `setFoveation` (0 to 1) exist in three.js (same WebXRManager page); a contributor suggested about 0.5x resolution (issue 400). No source tells which values suit this room.
- Captions: no source I read covers this. Unverified, from memory: a DOM overlay is not available for immersive-vr sessions on the Quest browser, so captions would need to be a three.js object (a canvas texture on a plane) placed in front of the seat. Meta says to use feature detection before offering a session: https://developers.meta.com/horizon/documentation/web/webxr-overview (read 2026-11-21).
- Audio: the interviewer voice is spatial (Task 3.2). Whether Web Audio works unchanged during an immersive session was not covered by any source I read.

## Not found

- A headset support list in the Marble FAQ.
- Whether Marble's VR link works for a locally exported room.
- A primary source stating WebXR requires a secure context.
- Meta documentation on Quest browser microphone prompts.
- Spark 2.4.0 results on Quest 3, and any frame rate for 2M splats.
- Any source on captions or DOM overlay in a Quest immersive-vr session.
