import { describe, it, expect } from 'vitest';
import { resolveShipVisual } from '../shipVisuals';
import type { Ship } from '../../../../types/ship';

const keys = { Atlas_Supporter_Legendary_1: 'Atlas_4' };
const fleetShip = (imageKey?: string) => ({ id: 'f1', name: 'Aegis', imageKey }) as Ship;
const template = (imageKey?: string) => ({ id: 't1', name: 'Aegis', imageKey }) as Ship;

describe('resolveShipVisual', () => {
    it('resolves the visual key through the template definition id', () => {
        expect(
            resolveShipVisual(
                fleetShip(),
                template('https://img/aegis'),
                'Atlas_Supporter_Legendary_1',
                keys
            )
        ).toEqual({ portraitUrl: 'https://img/aegis_BigPortrait.jpg', visualKey: 'Atlas_4' });
    });

    it("prefers the fleet ship's own image key", () => {
        expect(
            resolveShipVisual(fleetShip('https://own'), template('https://tpl'), null, keys)
                .portraitUrl
        ).toBe('https://own_BigPortrait.jpg');
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
