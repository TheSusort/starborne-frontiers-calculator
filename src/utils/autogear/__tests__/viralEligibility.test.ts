import { describe, it, expect } from 'vitest';
import { Ship } from '../../../types/ship';
import { GearPiece } from '../../../types/gear';
import { EquipmentSlotName } from '../../../constants';
import { GEAR_SLOT_ORDER } from '../../../constants/gearTypes';
import { viralExtendsShipDoTs } from '../viralEligibility';
import { calculateTotalScore } from '../scoring';
import { buildFastScoringContext } from '../fastScoring/context';
import { fastScore } from '../fastScoring/fastScore';
import { makeTestShip } from '../fastScoring/__tests__/fixtures/testInventory';

// Skill text from docs/ship-skills.csv.
const WARDEN: Partial<Ship> = {
    name: 'Warden',
    activeSkillText:
        'This Unit deals <unit-damage>165% damage</unit-damage> and applies <unit-skill>Provoke</unit-skill> for 1 turn.',
    chargeSkillText:
        'This Unit deals <unit-damage>200% damage</unit-damage> and inflicts <unit-skill>Corrosion II</unit-skill> for 3 turns.',
    chargeSkillCharge: 2,
    firstPassiveSkillText:
        'When directly damaged, this Unit inflicts <unit-skill>Corrosion I</unit-skill> for 2 turns to the enemy and this Unit <unit-damage>repairs 3%</unit-damage> of its max HP.',
};

const SHEPHERD: Partial<Ship> = {
    name: 'Shepherd',
    activeSkillText:
        'This Unit <unit-damage>repairs 6%</unit-damage> of its max HP and deals <unit-damage>125% damage</unit-damage>.',
    chargeSkillText:
        'This Unit <unit-damage>repairs 9%</unit-damage> of its max HP and deals <unit-damage>160% damage</unit-damage>.',
    chargeSkillCharge: 2,
    firstPassiveSkillText:
        'When directly damaged, this Unit inflicts <unit-skill>Corrosion I</unit-skill> and <unit-skill>Attack Down I</unit-skill> on the enemy for 1 turn.',
};

const HUANYING_BOMBS_ONLY: Partial<Ship> = {
    name: 'Huanying',
    activeSkillText:
        'This Unit deals <unit-damage>120% damage</unit-damage> and inflicts <unit-skill>Bomb I</unit-skill> for 2 turns.',
    chargeSkillText:
        'This Unit deals <unit-damage>150% damage</unit-damage> and inflicts <unit-skill>Bomb II</unit-skill> for 2 turns.',
    chargeSkillCharge: 3,
};

describe('viralExtendsShipDoTs', () => {
    it('a charged-skill Corrosion is extended (Warden)', () => {
        expect(viralExtendsShipDoTs(makeTestShip(WARDEN))).toBe(true);
    });

    it('a passive-only Corrosion is not (Shepherd)', () => {
        expect(viralExtendsShipDoTs(makeTestShip(SHEPHERD))).toBe(false);
    });

    it('bombs are never extended', () => {
        expect(viralExtendsShipDoTs(makeTestShip(HUANYING_BOMBS_ONLY))).toBe(false);
    });
});

describe('Viral autogear bonus follows the kit on both scoring paths', () => {
    const viralPieces: GearPiece[] = GEAR_SLOT_ORDER.slice(0, 4).map(
        (slot, i) =>
            ({
                id: `viral-${i}`,
                slot,
                setBonus: 'VIRAL',
                rarity: 'legendary',
                level: 16,
                stars: 6,
                mainStat: { name: 'hacking', value: 100, type: 'flat' },
                subStats: [],
            }) as unknown as GearPiece
    );
    const lookup = (id: string) => viralPieces.find((p) => p.id === id);
    const equipment: Partial<Record<EquipmentSlotName, string>> = {};
    for (const p of viralPieces) equipment[p.slot as EquipmentSlotName] = p.id;

    const score = (overrides: Partial<Ship>) => {
        const ship = makeTestShip({ ...overrides, id: `ship-${overrides.name}` });
        const slow = calculateTotalScore(
            ship,
            equipment,
            [],
            lookup,
            () => undefined,
            'DEBUFFER_CORROSION'
        );
        const ctx = buildFastScoringContext({
            ship,
            availableInventory: viralPieces,
            priorities: [],
            shipRole: 'DEBUFFER_CORROSION',
            engineeringStats: undefined,
            arenaModifiers: undefined,
            resolveGearPiece: lookup,
        });
        const gearIds = ctx.gearSlotOrder.map((slot) => {
            const id = equipment[slot];
            return id ? ctx.gearRegistry.idOf.get(id)! : -1;
        });
        const fast = fastScore(ctx, gearIds, []).fitness;
        return { slow, fast };
    };

    it('Warden scores 1.5x Shepherd with identical stats, and the paths agree', () => {
        const warden = score(WARDEN);
        const shepherd = score(SHEPHERD);
        expect(warden.fast).toBeCloseTo(warden.slow, 6);
        expect(shepherd.fast).toBeCloseTo(shepherd.slow, 6);
        expect(warden.slow).toBeCloseTo(shepherd.slow * 1.5, 6);
    });
});
