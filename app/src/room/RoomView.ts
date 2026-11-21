// Mounts the room in a container: a three.js canvas with a Spark splat, a fixed seat camera, and the
// interviewer marker. The voice loop never depends on this; any failure goes to onError (spec D5).
import * as THREE from "three";
import { SparkRenderer, type SplatMesh } from "@sparkjsdev/spark";
import type { Room } from "../../../shared/types";
import { loadScene } from "./loadScene";
import { createMarker, type Marker } from "./marker";
import { SceneLoadError } from "./fetchSplat";
import type { SceneOverrides } from "./sceneTransform";
import { createFpsMeter, createSeatCamera, degToRad } from "./seatCamera";
import { yawPitchFromForward, type RigPlacement, type XrHost } from "./xr";

export type RoomViewOptions = {
  container: HTMLElement;
  room: Room;
  splatUrl: string;
  onProgress?: (fraction: number | null) => void;
  onReady?: (info: { loadMs: number }) => void;
  onError?: (err: Error) => void;
  /** Test only: sample splats are not in the Marble axis convention. */
  sceneOverrides?: SceneOverrides;
  /** Called once per frame with the camera angles, so audio can follow the view. */
  onCamera?: (yawDeg: number, pitchDeg: number) => void;
};

export type RoomView = {
  dispose(): void;
  getFps(): number;
  getCameraYawDeg(): number;
  getCameraPitchDeg(): number;
  setMarkerLevel(level: number): void;
  /** Abort loading. The error callback receives a "stopped" error. */
  skip(): void;
  /** What Enter VR needs (task 5.2). Null when the view did not start. */
  xrHost?(): XrHost | null;
};

export function createRoomView(opts: RoomViewOptions): RoomView {
  const { container, room } = opts;
  const t0 = performance.now();
  const debug = new URLSearchParams(location.search).get("debug") === "1";
  const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

  const noop: RoomView = {
    dispose() {},
    getFps: () => 0,
    getCameraYawDeg: () => room.seat.yawDeg,
    getCameraPitchDeg: () => 0,
    setMarkerLevel() {},
    skip() {},
    xrHost: () => null,
  };

  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: false });
  } catch (e) {
    queueMicrotask(() => opts.onError?.(new Error(`WebGL is not available: ${(e as Error).message}`)));
    return noop;
  }

  let disposed = false;
  const el = renderer.domElement;
  el.style.display = "block";
  el.style.width = "100%";
  el.style.height = "100%";
  el.style.touchAction = "none";
  el.style.cursor = "grab";
  container.appendChild(el);

  const size = () => {
    const w = Math.max(1, container.clientWidth);
    const h = Math.max(1, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 200);
  camera.rotation.order = "YXZ";
  const seatCam = createSeatCamera(room.seat, { reducedMotion: reduced });
  camera.position.set(...seatCam.position);
  const spark = new SparkRenderer({ renderer });
  scene.add(spark);
  size();

  const anchor = room.interviewerAnchors[0]?.position;
  let marker: Marker | null = null;
  let markerLevel = 0;
  let splat: SplatMesh | null = null;
  let ready = false;
  let firstFrameDone = false;
  const fps = createFpsMeter();
  // While a headset session runs, the head pose drives the camera and drag and keys do nothing.
  let rig: THREE.Group | null = null;
  const xrOn = () => rig !== null;

  // Input: pointer drag and arrow keys. The camera only turns.
  let drag: { x: number; y: number } | null = null;
  const onDown = (e: PointerEvent) => {
    if (xrOn()) return;
    drag = { x: e.clientX, y: e.clientY };
    el.setPointerCapture(e.pointerId);
    el.style.cursor = "grabbing";
  };
  const onUp = () => {
    drag = null;
    el.style.cursor = "grab";
  };
  const onMove = (e: PointerEvent) => {
    if (!drag || xrOn()) return;
    seatCam.drag(e.clientX - drag.x, e.clientY - drag.y);
    drag = { x: e.clientX, y: e.clientY };
  };
  const onKey = (e: KeyboardEvent) => {
    if (xrOn()) return;
    const t = e.target as HTMLElement | null;
    if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    const dir = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" }[e.key] as
      | "left"
      | "right"
      | "up"
      | "down"
      | undefined;
    if (!dir) return;
    e.preventDefault();
    seatCam.key(dir);
  };
  el.addEventListener("pointerdown", onDown);
  el.addEventListener("pointerup", onUp);
  el.addEventListener("pointercancel", onUp);
  el.addEventListener("pointermove", onMove);
  window.addEventListener("keydown", onKey);
  const ro = typeof ResizeObserver === "function" ? new ResizeObserver(size) : null;
  ro?.observe(container);

  // Render loop.
  let lastTs = performance.now();
  let lastLog = lastTs;
  const frame = () => {
    const now = performance.now();
    const dt = now - lastTs;
    lastTs = now;
    marker?.setLevel(markerLevel);
    marker?.tick(dt);
    if (xrOn()) {
      // three.js sets the camera from the headset inside render. The listener follows last frame's pose.
      renderer.render(scene, camera);
      const d = camera.getWorldDirection(new THREE.Vector3());
      const a = yawPitchFromForward([d.x, d.y, d.z]);
      opts.onCamera?.(a.yawDeg, a.pitchDeg);
    } else {
      seatCam.step(dt);
      camera.rotation.set(degToRad(seatCam.pitchDeg()), degToRad(seatCam.yawDeg()), 0);
      renderer.render(scene, camera);
      opts.onCamera?.(seatCam.yawDeg(), seatCam.pitchDeg());
    }
    if (ready) {
      if (!firstFrameDone) {
        firstFrameDone = true;
        const loadMs = performance.now() - t0;
        if (debug) console.log(`[room] load to first frame ${(loadMs / 1000).toFixed(2)} s`);
        opts.onReady?.({ loadMs });
      }
      fps.frame(now);
      if (debug && now - lastLog >= 5000) {
        lastLog = now;
        console.log(`[room] fps ${fps.fps().toFixed(1)} (rolling 10 s)`);
      }
    }
  };
  const startLoop = () => {
    lastTs = performance.now();
    fps.reset();
    renderer.setAnimationLoop(frame);
  };
  const onVisibility = () => {
    if (disposed || xrOn()) return;
    if (document.hidden) renderer.setAnimationLoop(null);
    else startLoop();
  };
  document.addEventListener("visibilitychange", onVisibility);
  if (!document.hidden) startLoop();

  // Load.
  const abort = new AbortController();
  loadScene({
    room,
    splatUrl: opts.splatUrl,
    onProgress: opts.onProgress,
    signal: abort.signal,
    overrides: opts.sceneOverrides,
  }).then(
    ({ splat: s }) => {
      if (disposed) {
        s.dispose();
        return;
      }
      splat = s;
      scene.add(s);
      if (anchor) {
        marker = createMarker(anchor);
        scene.add(marker.object);
      }
      ready = true;
      fps.reset();
    },
    (e: unknown) => {
      if (disposed) return;
      opts.onError?.(e instanceof Error ? e : new SceneLoadError(String(e), "parse"));
    },
  );

  return {
    getFps: () => fps.fps(),
    getCameraYawDeg: () => seatCam.yawDeg(),
    getCameraPitchDeg: () => seatCam.pitchDeg(),
    setMarkerLevel(level) {
      markerLevel = level;
    },
    skip() {
      abort.abort();
    },
    xrHost: () => ({
      renderer: renderer as unknown as XrHost["renderer"],
      seat: { position: seatCam.position, yawDeg: room.seat.yawDeg },
      setRig(p: RigPlacement | null) {
        if (p) {
          rig = new THREE.Group();
          rig.position.set(...p.position);
          rig.rotation.y = p.yawRad;
          rig.add(camera);
          camera.position.set(0, 0, 0);
          camera.rotation.set(0, 0, 0);
          scene.add(rig);
        } else if (rig) {
          scene.remove(rig);
          rig.remove(camera);
          rig = null;
          camera.position.set(...seatCam.position);
          size();
          startLoop();
        }
      },
    }),
    dispose() {
      if (disposed) return;
      disposed = true;
      abort.abort();
      renderer.setAnimationLoop(null);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("keydown", onKey);
      ro?.disconnect();
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      el.removeEventListener("pointermove", onMove);
      if (marker) {
        scene.remove(marker.object);
        marker.dispose();
      }
      if (splat) {
        scene.remove(splat);
        splat.dispose();
      }
      scene.remove(spark);
      (spark as unknown as { dispose?: () => void }).dispose?.();
      renderer.dispose();
      renderer.forceContextLoss();
      el.remove();
    },
  };
}
