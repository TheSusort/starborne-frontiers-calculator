import { describe, it, expect } from 'vitest';
import { analyzeGearQuality } from '../gearSuggestions';
import type { GearPiece } from '../../../types/gear';
import type { Ship } from '../../../types/ship';
import type { SlotContribution } from '../statDistribution';
import type { BaseStats } from '../../../types/stats';

const gear = (overrides: Partial<GearPiece> = {}): GearPiece =>
    ({
        id: 'gear-1',
        slot: 'weapon',
        level: 16,
        stars: 6,
        rarity: 'legendary',
        mainStat: { name: 'attack', value: 100, type: 'flat' },
        subStats: [
            { name: 'crit', value: 5, type: 'percentage' },
            { name: 'critDamage', value: 10, type: 'percentage' },
            { name: 'attack', value: 20, type: 'percentage' },
        ],
        setBonus: null,
        ...overrides,
    }) as unknown as GearPiece;

const ship = (type: Ship['type'], equipment: Ship['equipment'] = {}): Ship =>
    ({ type, equipment, rarity: 'legendary' }) as unknown as Ship;

const totalStats = { crit: 100 } as unknown as BaseStats;

const slotContribution = (relativeScore: number): SlotContribution =>
    ({
        slotName: 'weapon',
        absoluteScore: 0,
        relativeScore,
        primaryStats: [],
    }) as unknown as SlotContribution;

describe('analyzeGearQuality role-specific set checks', () => {
    // #557's narrowing of GearSetName turned these comparisons into tsc errors: the code
    // compared `gear.setBonus` against the lowercase set-bonus DISPLAY names ('repair', 'boost')
    // instead of `GEAR_SETS`' real uppercase keys ('REPAIR', 'BOOST'), so neither check had ever
    // fired for any real gear piece.
    it('flags a SUPPORTER piece with no Repair set bonus', () => {
        const result = analyzeGearQuality(
            gear({ setBonus: null }),
            ship('SUPPORTER'),
            totalStats,
            () => undefined,
            slotContribution(0)
        );
        expect(result.reasons.map((r) => r.title)).toContain('Not a repair piece');
    });

    it('does not flag a SUPPORTER piece that already carries the Repair set bonus', () => {
        const result = analyzeGearQuality(
            gear({ setBonus: 'REPAIR' }),
            ship('SUPPORTER'),
            totalStats,
            () => undefined,
            slotContribution(0)
        );
        expect(result.reasons.map((r) => r.title)).not.toContain('Not a repair piece');
    });

    it('flags a SUPPORTER_BUFFER piece with fewer than 4 Boost pieces equipped and a low relative score', () => {
        const result = analyzeGearQuality(
            gear({ setBonus: null }),
            ship('SUPPORTER_BUFFER'),
            totalStats,
            () => undefined,
            slotContribution(0)
        );
        expect(result.reasons.map((r) => r.title)).toContain('Boost set bonus not found');
    });

    it('does not flag a SUPPORTER_BUFFER piece that already carries the Boost set bonus', () => {
        const result = analyzeGearQuality(
            gear({ setBonus: 'BOOST' }),
            ship('SUPPORTER_BUFFER'),
            totalStats,
            () => undefined,
            slotContribution(0)
        );
        expect(result.reasons.map((r) => r.title)).not.toContain('Boost set bonus not found');
    });
});
