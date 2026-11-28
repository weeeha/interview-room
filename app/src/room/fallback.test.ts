import { describe, expect, it } from "vitest";
import type { Room } from "../../../shared/types";
import type { TurnLine, TurnRequest } from "../api.ts";
import { createLoop } from "../session/loop.ts";
import { createBackdrop, decideBackdrop, NARROW_PX, SKIPPED_NOTICE, UNAVAILABLE_NOTICE, type BackdropState } from "./fallback.ts";
import type { RoomView, RoomViewOptions } from "./RoomView.ts";

const room: Room = {
  id: "r",
  label: "Room",
  kind: "office",
  splatPath: "media/rooms/r/room.spz",
  sourcePrompt: "x",
  coordinateConvention: "marble_raw_opencv",
  seat: { position: [0, 1.2, 0], yawDeg: 0, lookLimitDeg: 60 },
  interviewerAnchors: [{ position: [0, 1.2, -1.6], label: "A" }],
} as Room;

const base = { viewportWidth: 1440, skipped: false, hasRoomFile: true, webgl: true };

describe("decideBackdrop", () => {
  it("shows the room on a wide screen with a file and WebGL", () => {
    expect(decideBackdrop(base)).toEqual({ mode: "room" });
  });
  it("is flat without a notice below 700 px", () => {
    expect(decideBackdrop({ ...base, viewportWidth: NARROW_PX - 1 })).toEqual({ mode: "flat" });
    expect(decideBackdrop({ ...base, viewportWidth: NARROW_PX }).mode).toBe("room");
  });
  it("is flat with the notice for each failure", () => {
    for (const patch of [{ hasRoomFile: false }, { webgl: false }, { loadError: "No room file" }, { timedOut: true }]) {
      expect(decideBackdrop({ ...base, ...patch })).toEqual({ mode: "flat", notice: UNAVAILABLE_NOTICE });
    }
  });
  it("says the room was skipped when the user skips it", () => {
    expect(decideBackdrop({ ...base, skipped: true })).toEqual({ mode: "flat", notice: SKIPPED_NOTICE });
  });
});

// A fake room view the test can fail or ready at will. The ctor may also throw.
function fakeViews(opts: { throwOnCreate?: boolean } = {}) {
  const created: Array<{ o: RoomViewOptions; disposed: boolean; skipped: boolean }> = [];
  const createView = (o: RoomViewOptions): RoomView => {
    if (opts.throwOnCreate) throw new Error("boom");
    const rec = { o, disposed: false, skipped: false };
    created.push(rec);
    return {
      dispose: () => void (rec.disposed = true),
      getFps: () => 0,
      getCameraYawDeg: () => 0,
      getCameraPitchDeg: () => 0,
      setMarkerLevel() {},
      skip: () => void (rec.skipped = true),
    };
  };
  return { created, createView };
}

function backdrop(v: ReturnType<typeof fakeViews>, width = 1440) {
  const states: BackdropState[] = [];
  const b = createBackdrop({
    room,
    splatUrl: "/media/rooms/r/room.spz",
    container: () => ({}) as HTMLElement,
    createView: v.createView,
    viewportWidth: () => width,
    webgl: () => true,
    onChange: (s) => states.push(s),
  });
  return { b, states };
}

// The voice loop with fakes, as in loop.test.ts, reduced to what this test needs.
function voiceLoop() {
  const requests: TurnRequest[] = [];
  let playing = false;
  const loop = createLoop({
    api: {
      async *streamTurn(req: TurnRequest): AsyncGenerator<TurnLine> {
        requests.push(req);
        yield { type: "sentence", turnIndex: 0, sentenceIndex: 0, text: "Hello." } as TurnLine;
        yield { type: "done", turnIndex: 0, closing: false } as TurnLine;
      },
      async endSession() {},
    },
    playback: {
      enqueue: () => void (playing = true),
      stop: () => ({ playedMs: 0, spokenText: "", sentences: [] }),
      onStart: () => () => {},
      onSentenceStart: () => () => {},
      onIdle: () => () => {},
      isPlaying: () => playing,
    },
    capture: { setInterviewerSpeaking() {} },
    tts: "audio",
    now: () => 1000,
    sessionStartMs: 1000,
    silencePromptSec: 8,
    silenceOfferSec: 12,
    setTimer: () => 0,
    clearTimer: () => {},
  });
  return { loop, requests };
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe("room failure and the voice loop", () => {
  it("test_room_failure_does_not_block_session", async () => {
    // 1. Before start: the room constructor throws. The backdrop is flat with the notice and the loop starts at once.
    {
      const v = fakeViews({ throwOnCreate: true });
      const { b } = backdrop(v);
      const { loop, requests } = voiceLoop();
      b.start();
      expect(b.state()).toMatchObject({ mode: "flat", notice: UNAVAILABLE_NOTICE });
      loop.start();
      await tick();
      expect(requests).toHaveLength(1);
      expect(loop.snapshot().phase).not.toBe("idle");
    }
    // 2. While loading: the room is pending forever, the loop still sends its first request in the same tick;
    //    the load then fails and the loop is unaffected.
    {
      const v = fakeViews();
      const { b, states } = backdrop(v);
      const { loop, requests } = voiceLoop();
      b.start();
      expect(b.state()).toMatchObject({ mode: "room", loading: true });
      loop.start();
      await tick();
      expect(requests).toHaveLength(1);
      v.created[0]!.o.onError!(new Error("No room file at /x (HTTP 404)"));
      expect(states.at(-1)).toMatchObject({ mode: "flat", loading: false, notice: UNAVAILABLE_NOTICE });
      expect(v.created[0]!.disposed).toBe(true);
      expect(requests).toHaveLength(1);
      expect(loop.snapshot().phase).not.toBe("error");
    }
    // 3. Mid-session: the room is ready, the loop is mid-turn, the room view then fails.
    {
      const v = fakeViews();
      const { b } = backdrop(v);
      const { loop, requests } = voiceLoop();
      b.start();
      v.created[0]!.o.onReady!({ loadMs: 900 });
      expect(b.state()).toMatchObject({ mode: "room", ready: true });
      loop.start();
      await tick();
      b.fail("WebGL context lost");
      expect(b.state()).toMatchObject({ mode: "flat", ready: false, notice: UNAVAILABLE_NOTICE });
      expect(requests).toHaveLength(1);
      expect(loop.snapshot().phase).not.toBe("error");
      await loop.end();
      expect(loop.snapshot().phase).toBe("ended");
    }
  });

  it("a throwing change listener does not reach the room or the loop", () => {
    const v = fakeViews();
    const b = createBackdrop({
      room,
      splatUrl: "/x",
      container: () => ({}) as HTMLElement,
      createView: v.createView,
      viewportWidth: () => 1440,
      webgl: () => true,
      onChange: () => {
        throw new Error("listener");
      },
    });
    expect(() => b.start()).not.toThrow();
  });

  it("skip stops loading and switches to the flat backdrop with the skipped notice", () => {
    const v = fakeViews();
    const { b } = backdrop(v);
    b.start();
    b.skip();
    expect(v.created[0]!.skipped).toBe(true);
    expect(v.created[0]!.disposed).toBe(true);
    expect(b.state()).toMatchObject({ mode: "flat", notice: SKIPPED_NOTICE });
    // The view then reports its "stopped" error; that must not change the notice.
    v.created[0]!.o.onError!(new Error("stopped"));
    expect(b.state().notice).toBe(SKIPPED_NOTICE);
  });

  it("a narrow screen starts flat and mounts the room when it becomes wide", () => {
    const v = fakeViews();
    let width = 390;
    const states: BackdropState[] = [];
    const b = createBackdrop({
      room,
      splatUrl: "/x",
      container: () => ({}) as HTMLElement,
      createView: v.createView,
      viewportWidth: () => width,
      webgl: () => true,
      onChange: (s) => states.push(s),
    });
    b.start();
    expect(v.created).toHaveLength(0);
    expect(b.state()).toMatchObject({ mode: "flat", loading: false });
    expect(b.state().notice).toBeUndefined();
    width = 1200;
    b.resize();
    expect(v.created).toHaveLength(1);
    expect(b.state().mode).toBe("room");
    width = 500;
    b.resize();
    expect(v.created[0]!.disposed).toBe(true);
    expect(b.state().mode).toBe("flat");
  });
});
