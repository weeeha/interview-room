# Phase 0 results

Decision: pending real Marble room

## Seat view

Not captured for the Marble room yet. Camera is at eye height 1.2 m, yaw limit plus or minus 60 degrees, pitch limit plus or minus 30 degrees.

## Export table

| variant | format | file size | notes |
|---|---|---|---|
| Marble room, full resolution | not exported | not measured | waits on the Marble account |
| Marble room, 500k | not exported | not measured | waits on the Marble account |

## Measurements

Viewport 1440 by 900 in the built-in Browser pane. Sample rows are not the Marble room.

| file | browser | load seconds | average fps |
|---|---|---|---|
| sample splat (butterfly.spz from the Spark site), not the Marble room | Browser pane (Chromium) | not recorded, see note | not recorded, see note |
| Marble room, full resolution | Chrome | not measured | not measured |
| Marble room, full resolution | Safari | not measured | not measured |
| Marble room, 500k | Chrome | not measured | not measured |
| Marble room, 500k | Safari | not measured | not measured |

Note: the sample splat rendered upright in the Browser pane with `flip=0`, and the overlay ran. A clean 10 second average was not captured because the Browser pane was shared with another session and then hidden, which stops animation frames. No number is recorded rather than a guess. Repeat on a visible window.

## Artifacts

- Missing file: the default path shows the message "No room file at /media/rooms/interview-office/room.spz" (checked).
- Marble room: floaters near the camera, missing floor, upside-down room, warped table edges: not checked, no file yet.
- Axis fix (flip=1) is untested on a real Marble file.
