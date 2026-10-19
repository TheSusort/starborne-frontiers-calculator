import { ARCADE_ACCENT } from './arcadeAccent';
import { officialViewerCamera } from './spritePoses';

/**
 * The lighting of the official unit viewer (starborne.com/ship-viewer.html), as plain numbers so
 * it is testable without three.js; `shipLighting` builds the scene from it.
 */

/** Colour of the accent lights (the viewer's `accent` query parameter): the neon fighter's pink. */
export const ARCADE_LIGHT_ACCENT = ARCADE_ACCENT;

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

/** How much brighter the accent-coloured lights are on the player's chase-camera frames, so the
 *  rim and underglow read on the ship at the run's distance. Everything else the arcade renders
 *  (gates, duel renders, the select screen) keeps the viewer's rig as it is. */
export const PILOT_ACCENT_BOOST = 2.5;

export interface LightRigOptions {
    /** Multiplies the intensity of the accent-coloured lights only; 1 is the viewer's rig. */
    accentBoost?: number;
    /** Raises the accent-coloured lights to this height (model frame, before the turn); unset
     *  keeps the viewer's, which sit below the hull. */
    accentHeight?: number;
}

/**
 * The viewer's lights for a camera at `camera` (model frame, looking at the origin). The viewer
 * keeps its camera and lights still and spins the ship, so its look is fixed relative to the
 * camera: the rig turns about the vertical axis by the camera's azimuth away from the viewer's
 * camera, and every camera sees the key from its upper right and the accent rim behind the hull.
 */
export function lightRig(
    camera: Vec3,
    accent: number = ARCADE_LIGHT_ACCENT,
    { accentBoost = 1, accentHeight }: LightRigOptions = {}
): LightRig {
    const turn = azimuth(camera) - VIEWER_AZIMUTH;
    const cos = Math.cos(turn);
    const sin = Math.sin(turn);
    return {
        directional: VIEWER_LIGHTS.map(({ role, color, intensity, position: [x, y, z] }) => ({
            role,
            color: color === 'accent' ? accent : color,
            intensity: color === 'accent' ? intensity * accentBoost : intensity,
            position: [
                x * cos + z * sin,
                color === 'accent' && accentHeight !== undefined ? accentHeight : y,
                z * cos - x * sin,
            ] as Vec3,
        })),
        ambient: { ...VIEWER_AMBIENT },
    };
}

/** The player's chase-camera lighting: the boosted accent lights, raised from below the hull to
 *  its own height so they graze the side edges the chase camera sees. */
export const PILOT_LIGHTING: LightRigOptions = { accentBoost: PILOT_ACCENT_BOOST, accentHeight: 0 };
