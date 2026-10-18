import { describe, it, expect } from 'vitest';
import { resolveShipVisual } from '../shipVisuals';
import type { Ship } from '../../../../types/ship';

const keys = { Atlas_Supporter_Legendary_1: 'Atlas_4' };
const fleetShip = (imageKey?: string) => ({ id: 'f1', name: 'Aegis', imageKey }) as Ship;
const template = (imageKey?: string) => ({ id: 't1', name: 'Aegis', imageKey }) as Ship;

/** `imageKey` is a Cloudinary public id (e.g. `Terran_16`); the portrait is an absolute URL. */
const cloudinaryPortrait = (publicId: string) =>
    new RegExp(
        `^https://res\\.cloudinary\\.com/[^/]+/image/upload/.*${publicId}_BigPortrait\\.jpg(\\?.*)?$`
    );

describe('resolveShipVisual', () => {
    it('resolves the visual key through the template definition id', () => {
        expect(
            resolveShipVisual(
                fleetShip(),
                template('Terran_16'),
                'Atlas_Supporter_Legendary_1',
                keys
            )
        ).toEqual({
            portraitUrl: expect.stringMatching(cloudinaryPortrait('Terran_16')),
            visualKey: 'Atlas_4',
        });
    });

    it("prefers the fleet ship's own image key", () => {
        expect(
            resolveShipVisual(fleetShip('Own_1'), template('Tpl_2'), null, keys).portraitUrl
        ).toMatch(cloudinaryPortrait('Own_1'));
    });

    it('falls back to nulls on every miss', () => {
        expect(resolveShipVisual(fleetShip(), undefined, null, keys)).toEqual({
            portraitUrl: null,
            visualKey: null,
        });
        expect(
            resolveShipVisual(fleetShip(), template(), 'Unknown_Unit', keys).visualKey
        ).toBeNull();
    });
});
