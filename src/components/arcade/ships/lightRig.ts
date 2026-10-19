import { officialViewerCamera } from './spritePoses';

/**
 * The lighting of the official unit viewer (starborne.com/ship-viewer.html), as plain numbers so
 * it is testable without three.js; `shipLighting` builds the scene from it.
 */

/** Colour of the accent lights (the viewer's `accent` query parameter): the neon fighter's pink. */
export const ARCADE_LIGHT_ACCENT = 0xff4fd8;

/** Renderer, environment and shadow settings, verbatim from the viewer. */
export const VIEWER_RENDERER = {
    toneMappingExposure: 1.1,
    /** `PMREMGenerator.fromScene(new RoomEnvironment(), sigma)`. */
    environmentSigma: 0.06,
    environmentIntensity: 0.18,
    shadowExtent: 2,
    shadowNear: 0.1,
    shadowFar: 16,
    shadowBias: -0.0015,
    shadowNormalBias: 0.02,
} as const;

export type Vec3 = readonly [number, number, number];

export interface RigLight {
    /** The key and rim lights cast shadows. */
    role: 'key' | 'rim' | 'fill' | 'accent';
    color: number;
    intensity: number;
    /** Position in the model frame; every light aims at the origin. */
    position: Vec3;
}

export interface LightRig {
    directional: RigLight[];
    ambient: { color: number; intensity: number };
}

/** The viewer's lights, placed for its own camera. */
const VIEWER_LIGHTS: readonly {
    role: RigLight['role'];
    color: number | 'accent';
    intensity: number;
    position: Vec3;
}[] = [
    { role: 'key', color: 0xffeedd, intensity: 4.2, position: [5, 7, 2] },
    { role: 'rim', color: 'accent', intensity: 0.9, position: [-5, -2, -4] },
    { role: 'fill', color: 0xaebbcc, intensity: 0.3, position: [-2, 3, 5] },
    { role: 'accent', color: 'accent', intensity: 0.5, position: [3, -3, -2] },
];
const VIEWER_AMBIENT = { color: 0xdde6f0, intensity: 0.1 };

const azimuth = ([x, , z]: Vec3) => Math.atan2(x, z);
const VIEWER_AZIMUTH = azimuth(officialViewerCamera('left').position);

/**
 * The viewer's lights for a camera at `camera` (model frame, looking at the origin). The viewer
 * keeps its camera and lights still and spins the ship, so its look is fixed relative to the
 * camera: the rig turns about the vertical axis by the camera's azimuth away from the viewer's
 * camera, and every camera sees the key from its upper right and the accent rim behind the hull.
 */
export function lightRig(camera: Vec3, accent: number = ARCADE_LIGHT_ACCENT): LightRig {
    const turn = azimuth(camera) - VIEWER_AZIMUTH;
    const cos = Math.cos(turn);
    const sin = Math.sin(turn);
    return {
        directional: VIEWER_LIGHTS.map(({ role, color, intensity, position: [x, y, z] }) => ({
            role,
            color: color === 'accent' ? accent : color,
            intensity,
            position: [x * cos + z * sin, y, z * cos - x * sin] as Vec3,
        })),
        ambient: { ...VIEWER_AMBIENT },
    };
}
