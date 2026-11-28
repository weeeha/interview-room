// Decides whether the room or the flat backdrop shows, and owns the room view's life cycle.
// Spec D5: the room is optional. Nothing in here is awaited by the voice loop, and nothing in here throws.
import type { Room } from "../../../shared/types";
import type { RoomView, RoomViewOptions } from "./RoomView";

export const NARROW_PX = 700;
export const UNAVAILABLE_NOTICE = "Room unavailable, using plain backdrop";
export const SKIPPED_NOTICE = "Room skipped, using plain backdrop";

export type BackdropInput = {
  viewportWidth: number;
  /** The user pressed "Skip room". */
  skipped: boolean;
  /** The room record names a splat file (or a test override gives one). */
  hasRoomFile: boolean;
  webgl: boolean;
  loadError?: string | null;
  timedOut?: boolean;
};

export type BackdropDecision = { mode: "room" | "flat"; notice?: string };

/** Pure. Narrow screens get the flat backdrop without a notice, because that is the default there. */
export function decideBackdrop(i: BackdropInput): BackdropDecision {
  if (i.skipped) return { mode: "flat", notice: SKIPPED_NOTICE };
  if (!i.hasRoomFile || !i.webgl || i.timedOut || i.loadError) return { mode: "flat", notice: UNAVAILABLE_NOTICE };
  if (i.viewportWidth < NARROW_PX) return { mode: "flat" };
  return { mode: "room" };
}

export function webglAvailable(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

export type BackdropState = {
  mode: "room" | "flat";
  /** True while the room is being fetched and parsed. */
  loading: boolean;
  /** True once the first frame of the room is drawn. */
  ready: boolean;
  progress: number | null;
  loadMs: number | null;
  notice?: string;
  error?: string;
};

export type BackdropOptions = {
  room: Room | null;
  splatUrl: string | null;
  container: () => HTMLElement | null;
  createView: (o: RoomViewOptions) => RoomView;
  viewportWidth: () => number;
  webgl: () => boolean;
  onChange: (s: BackdropState) => void;
  onCamera?: (yawDeg: number, pitchDeg: number) => void;
  sceneOverrides?: RoomViewOptions["sceneOverrides"];
};

export type Backdrop = {
  /** Synchronous. Returns at once whatever happens to the room. */
  start(): void;
  skip(): void;
  /** Call on window resize. Switches mode when the width crosses the narrow limit. */
  resize(): void;
  /** A failure from outside the view (a lost WebGL context, say), at any moment. */
  fail(message: string, timedOut?: boolean): void;
  view(): RoomView | null;
  state(): BackdropState;
  dispose(): void;
};

export function createBackdrop(o: BackdropOptions): Backdrop {
  let view: RoomView | null = null;
  let skipped = false;
  let failure: { message: string; timedOut: boolean } | null = null;
  let disposed = false;
  let started = false;
  let st: BackdropState = { mode: "flat", loading: false, ready: false, progress: null, loadMs: null };

  const set = (next: BackdropState) => {
    st = next;
    if (disposed) return;
    try {
      o.onChange(st);
    } catch {
      /* a broken listener must not touch the room or the voice */
    }
  };

  const destroyView = () => {
    const v = view;
    view = null;
    try {
      v?.dispose();
    } catch {
      /* ignore */
    }
  };

  const decide = () =>
    decideBackdrop({
      viewportWidth: o.viewportWidth(),
      skipped,
      hasRoomFile: !!o.room && !!o.splatUrl,
      webgl: failure?.message.startsWith("WebGL") ? false : o.webgl(),
      loadError: failure?.timedOut ? null : (failure?.message ?? null),
      timedOut: failure?.timedOut ?? false,
    });

  const mount = () => {
    const container = o.container();
    if (!container || !o.room || !o.splatUrl) {
      failure = { message: "No place to show the room.", timedOut: false };
      apply();
      return;
    }
    set({ ...st, mode: "room", loading: true, ready: false, progress: null, loadMs: null });
    try {
      view = o.createView({
        container,
        room: o.room,
        splatUrl: o.splatUrl,
        sceneOverrides: o.sceneOverrides,
        onCamera: o.onCamera,
        onProgress: (f) => {
          if (!disposed && view) set({ ...st, progress: f });
        },
        onReady: ({ loadMs }) => {
          if (!disposed && view) set({ ...st, mode: "room", loading: false, ready: true, loadMs, progress: 1 });
        },
        onError: (e) => {
          if (disposed || skipped) return;
          const timedOut = (e as { kind?: string }).kind === "timeout";
          api.fail(e.message, timedOut);
        },
      });
    } catch (e) {
      failure = { message: e instanceof Error ? e.message : String(e), timedOut: false };
      destroyView();
      apply();
    }
  };

  // Reconcile the decision with what is mounted.
  const apply = () => {
    if (disposed || !started) return;
    const d = decide();
    if (d.mode === "room") {
      if (!view) mount();
      return;
    }
    destroyView();
    set({
      mode: "flat",
      loading: false,
      ready: false,
      progress: null,
      loadMs: st.loadMs,
      notice: d.notice,
      error: failure?.message,
    });
  };

  const api: Backdrop = {
    start() {
      if (started || disposed) return;
      started = true;
      apply();
    },
    skip() {
      if (skipped) return;
      skipped = true;
      view?.skip();
      apply();
    },
    resize() {
      apply();
    },
    fail(message, timedOut = false) {
      if (failure || disposed) return;
      failure = { message, timedOut };
      apply();
    },
    view: () => view,
    state: () => st,
    dispose() {
      disposed = true;
      destroyView();
    },
  };
  return api;
}
