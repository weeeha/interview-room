// The interviewer marker: a small soft light at the anchor. No avatar, no face.
// Its brightness and size follow a 0..1 voice level.
import * as THREE from "three";

export const MARKER_BASE_SCALE = 0.22; // metres at silence
export const MARKER_PEAK_SCALE = 0.4;
export const MARKER_BASE_OPACITY = 0.35;

/** Pure mapping from voice level to look. */
export function markerLook(level: number): { scale: number; opacity: number } {
  const l = Math.max(0, Math.min(1, Number.isFinite(level) ? level : 0));
  return {
    scale: MARKER_BASE_SCALE + (MARKER_PEAK_SCALE - MARKER_BASE_SCALE) * l,
    opacity: MARKER_BASE_OPACITY + (1 - MARKER_BASE_OPACITY) * l,
  };
}

export type Marker = {
  object: THREE.Object3D;
  setLevel(level: number): void;
  /** Smooth toward the set level. Call once per frame. */
  tick(dtMs: number): void;
  dispose(): void;
};

export function createMarker(anchor: [number, number, number]): Marker {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const g = canvas.getContext("2d");
  if (g) {
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, "rgba(255,236,200,1)");
    grad.addColorStop(0.35, "rgba(255,214,150,0.55)");
    grad.addColorStop(1, "rgba(255,200,120,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  });
  const sprite = new THREE.Sprite(material);
  sprite.position.set(anchor[0], anchor[1], anchor[2]);
  sprite.renderOrder = 10;
  let target = 0;
  let shown = 0;
  const apply = () => {
    const look = markerLook(shown);
    sprite.scale.setScalar(look.scale);
    material.opacity = look.opacity;
  };
  apply();
  return {
    object: sprite,
    setLevel(level) {
      target = Math.max(0, Math.min(1, Number.isFinite(level) ? level : 0));
    },
    tick(dtMs) {
      // Quick attack, slower release, so a spoken line pulses instead of flickering.
      const rate = target > shown ? 18 : 6;
      shown += (target - shown) * (1 - Math.exp(-rate * (dtMs / 1000)));
      apply();
    },
    dispose() {
      texture.dispose();
      material.dispose();
    },
  };
}
