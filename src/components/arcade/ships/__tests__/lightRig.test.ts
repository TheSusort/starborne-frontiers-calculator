import { describe, expect, it } from 'vitest';
import {
    ARCADE_LIGHT_ACCENT,
    lightRig,
    PILOT_ACCENT_BOOST,
    PILOT_LIGHTING,
    VIEWER_RENDERER,
} from '../lightRig';
import { CHASE_CAMERA, officialViewerCamera } from '../spritePoses';

const OFFICIAL = officialViewerCamera('left').position;

/** Unit direction of a light as the camera sees it: (right, up, toward-camera) components. */
function inCameraFrame(
    light: readonly [number, number, number],
    camera: readonly [number, number, number]
) {
    const [cx, cy, cz] = camera;
    const n = Math.hypot(cx, cy, cz);
    const back = [cx / n, cy / n, cz / n];
    // right = up × back, normalised; up' = back × right.
    const r0 = [back[2], 0, -back[0]];
    const rn = Math.hypot(...r0);
    const right = r0.map((v) => v / rn);
    const up = [
        back[1] * right[2] - back[2] * right[1],
        back[2] * right[0] - back[0] * right[2],
        back[0] * right[1] - back[1] * right[0],
    ];
    const ln = Math.hypot(...light);
    const l = light.map((v) => v / ln);
    const dot = (a: number[]) => a[0] * l[0] + a[1] * l[1] + a[2] * l[2];
    return { right: dot(right), up: dot(up), toward: dot(back) };
}

describe('lightRig', () => {
    it("is the official viewer's rig verbatim under the official camera", () => {
        const rig = lightRig(OFFICIAL);
        expect(rig.directional).toEqual([
            { role: 'key', color: 0xffeedd, intensity: 4.2, position: [5, 7, 2] },
            { role: 'rim', color: ARCADE_LIGHT_ACCENT, intensity: 0.9, position: [-5, -2, -4] },
            { role: 'fill', color: 0xaebbcc, intensity: 0.3, position: [-2, 3, 5] },
            { role: 'accent', color: ARCADE_LIGHT_ACCENT, intensity: 0.5, position: [3, -3, -2] },
        ]);
        expect(rig.ambient).toEqual({ color: 0xdde6f0, intensity: 0.1 });
        expect(VIEWER_RENDERER).toEqual({
            toneMappingExposure: 1.1,
            environmentSigma: 0.06,
            environmentIntensity: 0.18,
            shadowExtent: 2,
            shadowNear: 0.1,
            shadowFar: 16,
            shadowBias: -0.0015,
            shadowNormalBias: 0.02,
        });
    });

    it('defaults the accent to the neon fighter pink and takes any other', () => {
        expect(ARCADE_LIGHT_ACCENT).toBe(0xff4fd8);
        const rig = lightRig(OFFICIAL, 0x4fa8ff);
        const accented = rig.directional.filter((l) => l.color === 0x4fa8ff).map((l) => l.role);
        expect(accented).toEqual(['rim', 'accent']);
    });

    it('turns the rig with the camera so every camera sees the same light directions', () => {
        const cameras: [number, number, number][] = [
            [...CHASE_CAMERA.position],
            [...officialViewerCamera('right').position],
            [0, 0.8, 2.7],
        ];
        const official = lightRig(OFFICIAL).directional;
        for (const camera of cameras) {
            const turned = lightRig(camera).directional;
            turned.forEach((light, i) => {
                const want = inCameraFrame(official[i].position, OFFICIAL);
                const got = inCameraFrame(light.position, camera);
                // Elevations differ between the cameras, so the match is by azimuth: the
                // left-right and up components agree closely, toward/away keeps its sign.
                expect(got.right).toBeCloseTo(want.right, 1);
                expect(Math.sign(got.toward)).toBe(Math.sign(want.toward));
                expect(Math.hypot(...light.position)).toBeCloseTo(
                    Math.hypot(...official[i].position)
                );
                expect(light.position[1]).toBe(official[i].position[1]);
            });
        }
    });

    it('lights the chase camera from the front, not the hull side it never sees', () => {
        const key = lightRig([...CHASE_CAMERA.position]).directional[0];
        // The chase camera sits behind the ship (-z), so the key must come from -z too.
        expect(key.position[2]).toBeLessThan(0);
        expect(lightRig(OFFICIAL).directional[0].position[2]).toBeGreaterThan(0);
    });
});

describe('lightRig accent boost', () => {
    const camera = OFFICIAL;
    it('leaves the rig unchanged by default', () => {
        expect(lightRig(camera, ARCADE_LIGHT_ACCENT, {})).toEqual(lightRig(camera));
        expect(lightRig(camera, ARCADE_LIGHT_ACCENT, { accentBoost: 1 })).toEqual(lightRig(camera));
    });

    it('multiplies only the accent-coloured lights', () => {
        const base = lightRig(camera, 0x123456);
        const boosted = lightRig(camera, 0x123456, { accentBoost: PILOT_ACCENT_BOOST });
        boosted.directional.forEach((light, i) => {
            const was = base.directional[i];
            expect(light.position).toEqual(was.position);
            expect(light.color).toBe(was.color);
            expect(light.intensity).toBeCloseTo(
                was.color === 0x123456 ? was.intensity * PILOT_ACCENT_BOOST : was.intensity
            );
        });
        const accentRoles = boosted.directional.filter((l) => l.color === 0x123456);
        expect(accentRoles.map((l) => l.role)).toEqual(['rim', 'accent']);
        expect(boosted.ambient).toEqual(base.ambient);
    });

    it('raises only the accent-coloured lights to accentHeight', () => {
        const base = lightRig(camera, 0x123456);
        const raised = lightRig(camera, 0x123456, { accentHeight: 0 });
        raised.directional.forEach((light, i) => {
            const [x, y, z] = base.directional[i].position;
            expect(light.intensity).toBe(base.directional[i].intensity);
            expect(light.position).toEqual(light.color === 0x123456 ? [x, 0, z] : [x, y, z]);
        });
    });

    it('lights the pilot with a visible boost', () => {
        expect(PILOT_ACCENT_BOOST).toBeGreaterThanOrEqual(2);
        expect(PILOT_LIGHTING.accentBoost).toBe(PILOT_ACCENT_BOOST);
    });
});
