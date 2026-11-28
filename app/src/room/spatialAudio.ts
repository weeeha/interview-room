// The interviewer's voice in the room: a PannerNode (HRTF) at the anchor, the AudioListener at the
// seat, and the listener facing where the camera faces. Turning the view moves the voice (AC-5).
//
// `source` is the node that carries the voice (playback.output). createSpatialVoice disconnects it
// from the context destination and routes it through the panner; dispose undoes that.
import type { Room } from "../../../shared/types";
import { anchorDirection, forwardVector } from "./spatialMath";

export type SpatialVoice = {
  update(cameraYawDeg: number, cameraPitchDeg: number): void;
  playTestTone(ms?: number): void;
  /** Current values, for checks. */
  debug(): SpatialDebug;
  dispose(): void;
};

export type SpatialDebug = {
  pannerPosition: [number, number, number];
  listenerPosition: [number, number, number];
  listenerForward: [number, number, number];
  azimuthDeg: number;
  panSide: number;
};

type V3 = [number, number, number];

function setListener(l: AudioListener, pos: V3, fwd: V3, t: number) {
  if (l.positionX) {
    l.positionX.setValueAtTime(pos[0], t);
    l.positionY.setValueAtTime(pos[1], t);
    l.positionZ.setValueAtTime(pos[2], t);
    l.forwardX.setValueAtTime(fwd[0], t);
    l.forwardY.setValueAtTime(fwd[1], t);
    l.forwardZ.setValueAtTime(fwd[2], t);
    l.upX.setValueAtTime(0, t);
    l.upY.setValueAtTime(1, t);
    l.upZ.setValueAtTime(0, t);
  } else {
    // Older Safari.
    (l as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(...pos);
    (l as unknown as { setOrientation(...a: number[]): void }).setOrientation(fwd[0], fwd[1], fwd[2], 0, 1, 0);
  }
}

export function createSpatialVoice(opts: {
  audioContext: AudioContext;
  source: AudioNode;
  anchor: [number, number, number];
  seat: Room["seat"];
}): SpatialVoice {
  const ctx = opts.audioContext;
  const panner = ctx.createPanner();
  panner.panningModel = "HRTF";
  panner.distanceModel = "inverse";
  panner.refDistance = 1.5;
  panner.rolloffFactor = 0.6;
  panner.positionX.value = opts.anchor[0];
  panner.positionY.value = opts.anchor[1];
  panner.positionZ.value = opts.anchor[2];

  try {
    opts.source.disconnect(ctx.destination);
  } catch {
    /* it was not connected there */
  }
  opts.source.connect(panner);
  panner.connect(ctx.destination);

  const seatPos = opts.seat.position;
  let last = { yaw: opts.seat.yawDeg, pitch: 0 };
  const apply = () => {
    setListener(ctx.listener, seatPos, forwardVector(last.yaw, last.pitch), ctx.currentTime);
  };
  apply();
  let tone: { osc: OscillatorNode; gain: GainNode } | null = null;
  let disposed = false;

  return {
    update(yaw, pitch) {
      if (disposed) return;
      last = { yaw, pitch };
      apply();
    },
    playTestTone(ms = 1200) {
      if (disposed) return;
      if (ctx.state === "suspended") void ctx.resume();
      tone?.osc.stop();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.value = 440;
      const t = ctx.currentTime;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.25, t + 0.05);
      gain.gain.setValueAtTime(0.25, t + ms / 1000 - 0.08);
      gain.gain.linearRampToValueAtTime(0, t + ms / 1000);
      osc.connect(gain);
      gain.connect(panner);
      osc.start(t);
      osc.stop(t + ms / 1000 + 0.02);
      osc.onended = () => {
        osc.disconnect();
        gain.disconnect();
        if (tone?.osc === osc) tone = null;
      };
      tone = { osc, gain };
    },
    debug() {
      const d = anchorDirection(seatPos, opts.anchor, last.yaw);
      return {
        pannerPosition: [panner.positionX.value, panner.positionY.value, panner.positionZ.value],
        listenerPosition: ctx.listener.positionX
          ? [ctx.listener.positionX.value, ctx.listener.positionY.value, ctx.listener.positionZ.value]
          : [...seatPos],
        listenerForward: ctx.listener.forwardX
          ? [ctx.listener.forwardX.value, ctx.listener.forwardY.value, ctx.listener.forwardZ.value]
          : forwardVector(last.yaw, last.pitch),
        azimuthDeg: d.azimuthDeg,
        panSide: d.panSide,
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      try {
        tone?.osc.stop();
      } catch {
        /* already stopped */
      }
      try {
        opts.source.disconnect(panner);
      } catch {
        /* ignore */
      }
      panner.disconnect();
      try {
        opts.source.connect(ctx.destination);
      } catch {
        /* ignore */
      }
    },
  };
}
