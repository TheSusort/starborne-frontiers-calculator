import { describe, it, expect } from 'vitest';
import { GearPiece } from '../../../types/gear';
import { Ship } from '../../../types/ship';
import { analyzeUpgrades } from '../upgradeAnalysis';
import { SlotContribution } from '../statDistribution';

const piece = (id: string, setBonus: string): GearPiece =>
    ({
        id,
        slot: 'weapon',
        setBonus,
        rarity: 'legendary',
        level: 16,
        stars: 6,
        mainStat: { name: 'hacking', value: 100, type: 'flat' },
        subStats: [],
    }) as unknown as GearPiece;

// Shepherd's Corrosion is passive-only (docs/ship-skills.csv), so Viral extends nothing.
const shepherd = {
    id: 'shepherd',
    name: 'Shepherd',
    type: 'DEBUFFER_CORROSION',
    rarity: 'legendary',
    faction: 'FEDERATION',
    baseStats: {},
    refits: [],
    equipment: {},
    implants: {},
    activeSkillText:
        'This Unit <unit-damage>repairs 6%</unit-damage> of its max HP and deals <unit-damage>125% damage</unit-damage>.',
    firstPassiveSkillText:
        'When directly damaged, this Unit inflicts <unit-skill>Corrosion I</unit-skill> and <unit-skill>Attack Down I</unit-skill> on the enemy for 1 turn.',
} as unknown as Ship;

const contribution: SlotContribution = {
    slotName: 'weapon',
    absoluteScore: 100,
    relativeScore: 100,
    primaryStats: [],
};

const setSuggestions = (equipped: GearPiece, orphans: GearPiece[]) => {
    const all = [equipped, ...orphans];
    return analyzeUpgrades(
        [contribution],
        { weapon: equipped.id },
        (id) => all.find((p) => p.id === id),
        shepherd,
        {} as never,
        orphans
    ).flatMap((s) => s.reasons.filter((r) => r.title === 'Not optimal set bonus'));
};

describe('analyzeUpgrades — orphan set suggestions', () => {
    it('never suggests switching to an orphan of an undesired set', () => {
        expect(setSuggestions(piece('equipped', 'VIRAL'), [piece('o1', 'REPAIR')])).toEqual([]);
    });

    it('still suggests an orphan of a desired set', () => {
        const reasons = setSuggestions(piece('equipped', 'VIRAL'), [
            piece('o1', 'REPAIR'),
            piece('o2', 'HACKING'),
        ]);
        expect(reasons).toHaveLength(1);
        expect(reasons[0].reason).toContain('Hacking');
    });
});
