# Phase 0 spike: splat room viewer

Goal: prove that a Gaussian splat room can be viewed in the browser from a fixed seat, and measure load time and frame rate. Throwaway quality.

## Serve and open

From the worktree root:

    python3 -m http.server 8931

Open `http://127.0.0.1:8931/spike/viewer/index.html`.

Query values:

- `?splat=<url or path>` splat file. Default `/media/rooms/interview-office/room.spz`.
- `?flip=0|1` rotate 180 degrees about X. Default 1 (Marble exports use the OpenCV axis convention).
- `?scale=<number>` optional metric scale factor, default 1.
- `?ground=<number>` optional ground plane offset, subtracted from Y after the flip, default 0.

- `?offset=x,y,z` test only, shifts the splat (for small sample objects that are not rooms).

If the splat file is missing the page shows "No room file at <path>".

Sample splat for testing without a Marble file (loaded by URL, not stored here):
`?splat=https://sparkjs.dev/assets/splats/butterfly.spz&flip=0&offset=0,1.2,-2`

## Where exported files go

Marble exports go in `media/rooms/<room-name>/` (for example `media/rooms/interview-office/room.spz`). The `media/` folder is ignored by git.

## Versions and docs

- three.js 0.180.0 (jsDelivr)
- Spark (`@sparkjsdev/spark`) 2.4.0, published 2026-10-20 (jsDelivr)
- Docs used: https://sparkjs.dev/docs/ (quick start gave these exact pairings)

## Controls

Drag with the pointer to look around. Yaw is limited to plus or minus 60 degrees, pitch to plus or minus 30. The camera never moves from eye height 1.2 m.

## When you have a Marble export

Prompts are ready in `spike/prompts/` (`interview-office.md`, `panel-room.md`, `video-call-corner.md`). Generating and exporting needs your Marble account, so these steps are yours.

1. Task 0.2, generate: paste the starting prompt from `spike/prompts/interview-office.md` into Marble. Note the generation time. If the result has people, readable text or a warped table, use variant A or B (the Free plan allows 4 generations). In `spike/results.md` under "Seat view" write the generation time, the number of generations used, and two lines: what looks right, what looks wrong.
2. Task 0.3, export and files: try the export in the web app and write down exactly which export options the Free plan shows (this settles the paid question). If the Free plan cannot export, choose between the Standard plan ($20 per month) and API credits (minimum $5.00, PLY splat export free of credits). Export every splat variant available (SPZ about 2M and about 500k, PLY if offered) and the collider GLB. Put the files here, which is git-ignored:
   - `media/rooms/interview-office/room.spz` (the variant used for sessions)
   - other variants beside it, for example `room-500k.spz`, `room.ply`, `collider.glb`
   - viewer metadata (`metric_scale_factor`, `ground_plane_offset`) if the export has it

   Record each file's size in MB (`ls -l`) in the export table in `spike/results.md`. Every cell comes from a real file.
3. Task 0.4 step 6, measure: serve the repo root with `python3 -m http.server 8931` and open `http://127.0.0.1:8931/spike/viewer/index.html` (add `?splat=/media/rooms/interview-office/room-500k.spz` for another variant, and `?flip=0` if the room is upside down). Run it in Chrome and Safari, each in a visible window at 1440 by 900. Record load seconds and the 10 second average fps for each file and browser in the measurements table. Take one screenshot per browser into `media/screens/`. List any floaters near the camera, missing floor, upside-down room or warped table edges under "Artifacts". Then, with the dev server running (`npm run dev`), open `http://localhost:8940/room-demo.html?debug=1` and check the console shows the load time and fps lines.
4. Task 0.5, go or no-go: compare the measurements with the gates below. Write "go", "go with changes" or "no-go" at the top of `spike/results.md` with one paragraph of reasons. Replace the initial targets in AC-1 and AC-2 of `docs/spec.md` with the measured values. Then look at the screenshots and decide.

| Gate | Initial go threshold |
|---|---|
| Seat view reads as a plausible room at eye height | Owner agrees after looking at the screenshot |
| Load time on local server, best variant | 15 seconds or less |
| File size of the variant used for sessions | 60 MB or less |
| Average fps, 10 seconds, Chrome and Safari | 30 or higher in both |
| No floaters or holes within 1 m of the camera | None visible in the seat view |

If a gate fails, try the 500k variant, then a different prompt. If the 500k variant also fails on fps, the fallback is the 360 panorama PNG as a background on a sphere (a flat but fast room), and the plan continues with that.
