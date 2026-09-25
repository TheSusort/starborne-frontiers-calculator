import { describe, it, expect, beforeEach } from 'vitest';
import { GeneticStrategy } from '../GeneticStrategy';
import { Ship } from '../../../../types/ship';
import { GearPiece } from '../../../../types/gear';
import { StatPriority } from '../../../../types/autogear';
import type { EquipmentSlotName } from '../../../../constants/gearTypes';
import { clearScoreCache } from '../../scoring';
import { BaseStats, EngineeringStat } from '../../../../types/stats';
import { ShipTypeName } from '../../../../constants/shipTypes';
import type { ScoringInputs } from '../../AutogearStrategy';

// No scoring inputs this suite cares about — every field is named explicitly (required key,
// see `ScoringInputs`' own doc) so a real run's fields never get silently dropped here either.
const NO_SCORING_INPUTS: ScoringInputs = {
    shipRole: undefined,
    setPriorities: undefined,
    statBonuses: undefined,
    tryToCompleteSets: undefined,
    arenaModifiers: undefined,
    fleetBuffs: undefined,
    customFormula: undefined,
    roleBasis: undefined,
};

const BASE: BaseStats = {
    hp: 100000,
    attack: 5000,
    defence: 4000,
    speed: 100,
    hacking: 0,
    security: 0,
    crit: 30,
    critDamage: 150,
    healModifier: 0,
    hpRegen: 0,
    shield: 0,
    damageReduction: 0,
    defensePenetration: 0,
};

function makeGear(
    id: string,
    slot: EquipmentSlotName,
    stat: keyof BaseStats,
    amount: number
): GearPiece {
    return {
        id,
        slot: slot,
        level: 16,
        stars: 6,
        rarity: 'legendary',
        setBonus: null,
        mainStat: { name: stat, value: amount, type: 'flat' } as GearPiece['mainStat'],
        subStats: [],
    };
}

function makeShip(): Ship {
    return {
        id: 'ship1',
        name: 'Test Ship',
        type: 'ATTACKER',
        rarity: 'legendary',
        faction: 'TERRAN',
        level: 60,
        rank: 5,
        baseStats: { ...BASE },
        equipment: {},
        implants: {},
        refits: [],
    };
}

describe('GeneticStrategy.findOptimalGear', () => {
    beforeEach(() => {
        clearScoreCache();
    });

    it('returns AutogearResult shape', async () => {
        const strategy = new GeneticStrategy();
        const ship = makeShip();
        const inventory = [
            makeGear('g1', 'weapon', 'attack', 1000),
            makeGear('g2', 'hull', 'hp', 10000),
        ];
        const getGearPiece = (id: string) => inventory.find((g) => g.id === id);
        const getEng = (_t: ShipTypeName): EngineeringStat | undefined => undefined;
        const priorities: StatPriority[] = [{ stat: 'attack', weight: 1 }];

        const result = await strategy.findOptimalGear(
            ship,
            priorities,
            inventory,
            getGearPiece,
            getEng,
            NO_SCORING_INPUTS
        );

        expect(result).toHaveProperty('suggestions');
        expect(result).toHaveProperty('hardRequirementsMet');
        expect(result).toHaveProperty('attempts');
        expect(result.attempts).toBeGreaterThanOrEqual(1);
        expect(Array.isArray(result.suggestions)).toBe(true);
    });

    it('reports hardRequirementsMet === true and attempts === 1 when no hard priorities', async () => {
        const strategy = new GeneticStrategy();
        const ship = makeShip();
        const inventory = [makeGear('g1', 'weapon', 'attack', 1000)];
        const getGearPiece = (id: string) => inventory.find((g) => g.id === id);
        const getEng = (_t: ShipTypeName): EngineeringStat | undefined => undefined;

        const result = await strategy.findOptimalGear(
            ship,
            [{ stat: 'attack', weight: 1, minLimit: 1000 }],
            inventory,
            getGearPiece,
            getEng,
            NO_SCORING_INPUTS
        );

        expect(result.hardRequirementsMet).toBe(true);
        expect(result.attempts).toBe(1);
        expect(result.violations).toBeUndefined();
    });

    it('reports hardRequirementsMet === false and returns violations when impossible', async () => {
        const strategy = new GeneticStrategy();
        const ship = makeShip();
        const inventory = [
            makeGear('g1', 'weapon', 'attack', 100),
            makeGear('g2', 'hull', 'hp', 100),
        ];
        const getGearPiece = (id: string) => inventory.find((g) => g.id === id);
        const getEng = (_t: ShipTypeName): EngineeringStat | undefined => undefined;

        const priorities: StatPriority[] = [
            { stat: 'attack', minLimit: 100000, hardRequirement: true },
        ];

        const result = await strategy.findOptimalGear(
            ship,
            priorities,
            inventory,
            getGearPiece,
            getEng,
            NO_SCORING_INPUTS
        );

        expect(result.hardRequirementsMet).toBe(false);
        expect(result.attempts).toBe(5);
        expect(result.violations).toBeDefined();
        expect(result.violations?.length).toBeGreaterThan(0);
        expect(result.violations?.[0]).toMatchObject({
            stat: 'attack',
            kind: 'min',
            limit: 100000,
        });
        expect(result.violations?.[0].actual).toBeLessThan(100000);
    });
});
