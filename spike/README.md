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
