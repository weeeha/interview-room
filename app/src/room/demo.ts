// Standalone demo for the room module: http://localhost:8940/room-demo.html
// Query: ?splat=<url> (default: the room file path), ?sample=1 (public sample splat, no axis fix),
// ?debug=1 (log fps). The default room here is built in code, it is not the Marble room.
import type { Room } from "../../../shared/types";
import { createRoomView, type RoomView } from "./RoomView";
import { createSpatialVoice, type SpatialVoice } from "./spatialAudio";
import type { SceneOverrides } from "./sceneTransform";

const SAMPLE_URL = "https://sparkjs.dev/assets/splats/butterfly.spz";
const q = new URLSearchParams(location.search);
const sample = q.get("sample") === "1";
const splatUrl = q.get("splat") ?? (sample ? SAMPLE_URL : "/media/rooms/interview-office/room.spz");
const isSample = sample || q.has("splat");

// Interviewer anchor to the right of straight ahead, so turning right centres the voice.
const room: Room = {
  id: "demo",
  label: "Room demo",
  kind: "office",
  splatPath: "media/rooms/interview-office/room.spz",
  sourcePrompt: "demo",
  coordinateConvention: "marble_raw_opencv",
  seat: { position: [0, 1.2, 0], yawDeg: 0, lookLimitDeg: 60 },
  interviewerAnchors: [{ position: [1.5, 1.2, -2], label: "Interviewer" }],
};
const overrides: SceneOverrides | undefined = isSample ? { flip: false, offset: [0, 1.2, -2] } : undefined;
const anchor = room.interviewerAnchors[0]!.position;

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const status = $("status");
const bar = $("bar").firstElementChild as HTMLElement;
const numbers = $("numbers");
const audioInfo = $("audio");
const errPanel = $("err");

let view: RoomView | null = null;
let voice: SpatialVoice | null = null;
let ctx: AudioContext | null = null;
let voiceOut: GainNode | null = null;
let loadMs: number | null = null;

function ensureAudio() {
  if (ctx && voice && voiceOut) return;
  ctx = new AudioContext();
  voiceOut = ctx.createGain();
  voiceOut.connect(ctx.destination);
  voice = createSpatialVoice({ audioContext: ctx, source: voiceOut, anchor, seat: room.seat });
}

view = createRoomView({
  container: $("stage"),
  room,
  splatUrl,
  sceneOverrides: overrides,
  onCamera: (yaw, pitch) => voice?.update(yaw, pitch),
  onProgress: (f) => {
    status.textContent = f === null ? "loading (size unknown)..." : `loading ${(f * 100).toFixed(0)} %`;
    bar.style.width = f === null ? "50%" : `${f * 100}%`;
  },
  onReady: ({ loadMs: ms }) => {
    loadMs = ms;
    status.textContent = `ready, load ${(ms / 1000).toFixed(2)} s`;
    bar.style.width = "100%";
  },
  onError: (err) => {
    status.textContent = "no room";
    errPanel.textContent = `Room unavailable: ${err.message}. Using a plain backdrop.`;
    errPanel.dataset.show = "1";
    console.error(err);
  },
});

$("tone").addEventListener("click", () => {
  ensureAudio();
  voice!.playTestTone(1200);
});
$("skip").addEventListener("click", () => view?.skip());
$("speak").addEventListener("click", async () => {
  ensureAudio();
  const c = ctx!;
  if (c.state === "suspended") await c.resume();
  try {
    const res = await fetch("http://127.0.0.1:8943/tts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "Thanks for coming in. Tell me about a project you are proud of.", voice: "af_heart" }),
    });
    if (!res.ok) throw new Error(`TTS server answered ${res.status}`);
    const buf = await c.decodeAudioData(await res.arrayBuffer());
    const src = c.createBufferSource();
    src.buffer = buf;
    src.connect(voiceOut!);
    src.onended = () => view?.setMarkerLevel(0);
    view?.setMarkerLevel(0.8);
    src.start();
  } catch (e) {
    audioInfo.textContent = `Spoken line unavailable (${(e as Error).message}). Use the test tone.`;
  }
});

setInterval(() => {
  if (!view) return;
  const yaw = view.getCameraYawDeg();
  const d = voice?.debug();
  numbers.textContent =
    `yaw ${yaw.toFixed(1)} deg  pitch ${view.getCameraPitchDeg().toFixed(1)} deg  fps ${view.getFps().toFixed(1)}`;
  if (d) {
    audioInfo.textContent =
      `voice azimuth ${d.azimuthDeg.toFixed(1)} deg  pan side ${d.panSide.toFixed(2)}  ` +
      `listener fwd ${d.listenerForward.map((n) => n.toFixed(2)).join(",")}`;
  }
  (window as unknown as { __room: unknown }).__room = {
    yaw, pitch: view.getCameraPitchDeg(), fps: view.getFps(), loadMs, voice: d ?? null,
  };
}, 250);
