import { describe, it, expect } from 'vitest';
import { analyzeStatDistribution } from '../statDistribution';
import { makeTestShip } from '../../autogear/fastScoring/__tests__/fixtures/testInventory';
import { GearPiece } from '../../../types/gear';

describe('analyzeStatDistribution', () => {
    it('scores a gear piece edited in place (same id, new stats) by its new stats', () => {
        const weapon: GearPiece = {
            id: 'w-edited',
            slot: 'weapon',
            level: 16,
            stars: 6,
            rarity: 'legendary',
            mainStat: { name: 'attack', value: 1000, type: 'flat' },
            subStats: [],
            setBonus: null,
        };
        const ship = makeTestShip({ id: 'dist-edited', type: 'ATTACKER' });
        const equipment = { weapon: weapon.id };
        const lookup = (id: string) => (id === weapon.id ? weapon : undefined);
        const analyze = () =>
            analyzeStatDistribution(equipment, lookup, ship, () => undefined)[0].absoluteScore;

        const before = analyze();
        weapon.mainStat!.value = 9000;
        expect(analyze()).toBeGreaterThan(before);
    });
});
