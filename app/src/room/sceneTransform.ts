// How a Room record maps its splat into the scene. Pure, no three.js.
import type { Room } from "../../../shared/types";

export type SplatTransform = {
  /** Rotation about the X axis in radians. Pi for the Marble OpenCV convention. */
  rotateXRad: number;
  scale: number;
  /** Added to the splat position Y. */
  positionY: number;
};

export type SceneOverrides = {
  /** Test only: skip the axis fix (small sample splats are not in the Marble convention). */
  flip?: boolean;
  /** Test only: shift the splat, for sample objects that are not rooms. */
  offset?: [number, number, number];
};

export function splatTransform(
  room: Pick<Room, "coordinateConvention" | "metricScaleFactor" | "groundPlaneOffset">,
  overrides: SceneOverrides = {},
): SplatTransform & { offset: [number, number, number] } {
  const flip = overrides.flip ?? room.coordinateConvention === "marble_raw_opencv";
  return {
    rotateXRad: flip ? Math.PI : 0,
    scale: room.metricScaleFactor ?? 1,
    positionY: -(room.groundPlaneOffset ?? 0),
    offset: overrides.offset ?? [0, 0, 0],
  };
}
