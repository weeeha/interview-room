// Load a room's splat into a Spark SplatMesh with the room's axis fix, scale and ground offset.
import * as THREE from "three";
import { SplatMesh } from "@sparkjsdev/spark";
import type { Room } from "../../../shared/types";
import { fetchSplatBytes, SceneLoadError, withLoadTimeout } from "./fetchSplat";
import { splatTransform, type SceneOverrides } from "./sceneTransform";

export type LoadSceneOptions = {
  room: Room;
  splatUrl: string;
  onProgress?: (fraction: number | null) => void;
  signal?: AbortSignal;
  timeoutMs?: number;
  overrides?: SceneOverrides;
};

export async function loadScene(opts: LoadSceneOptions): Promise<{ splat: SplatMesh; loadMs: number }> {
  const t0 = performance.now();
  let mesh: SplatMesh | null = null;
  try {
    const splat = await withLoadTimeout(
      async (signal) => {
        const bytes = await fetchSplatBytes(opts.splatUrl, { signal, onProgress: opts.onProgress });
        const fileName = opts.splatUrl.split("?")[0]?.split("/").pop() ?? "room.spz";
        mesh = new SplatMesh({ fileBytes: bytes, fileName });
        try {
          await mesh.initialized;
        } catch (e) {
          throw new SceneLoadError(`Could not read the room file: ${(e as Error).message}`, "parse");
        }
        return mesh;
      },
      { signal: opts.signal, timeoutMs: opts.timeoutMs },
    );
    const t = splatTransform(opts.room, opts.overrides);
    splat.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), t.rotateXRad);
    splat.scale.setScalar(t.scale);
    splat.position.set(t.offset[0], t.offset[1] + t.positionY, t.offset[2]);
    return { splat, loadMs: performance.now() - t0 };
  } catch (e) {
    (mesh as SplatMesh | null)?.dispose();
    throw e;
  }
}
