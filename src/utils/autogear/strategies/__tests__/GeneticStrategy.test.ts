import { describe, it, expect, beforeEach } from 'vitest';
import { GeneticStrategy } from '../GeneticStrategy';
import { Ship } from '../../../../types/ship';
import { GearPiece } from '../../../../types/gear';
import { StatPriority } from '../../../../types/autogear';
import type { EquipmentSlotName } from '../../../../constants/gearTypes';
import { calculateTotalScore, clearScoreCache } from '../../scoring';
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

    it('runs three passes and reports hardRequirementsMet === true when no hard priorities', async () => {
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
        expect(result.attempts).toBe(3);
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

    it('stops after three passes once a hard requirement is met', async () => {
        const strategy = new GeneticStrategy();
        const ship = makeShip();
        const inventory = [makeGear('g1', 'weapon', 'attack', 1000)];
        const getGearPiece = (id: string) => inventory.find((g) => g.id === id);
        const getEng = (_t: ShipTypeName): EngineeringStat | undefined => undefined;

        const result = await strategy.findOptimalGear(
            ship,
            [{ stat: 'attack', minLimit: 1000, hardRequirement: true }],
            inventory,
            getGearPiece,
            getEng,
            NO_SCORING_INPUTS
        );

        expect(result.hardRequirementsMet).toBe(true);
        expect(result.attempts).toBe(3);
    });

    it('reports each pass as an attempt out of the planned maximum', async () => {
        const strategy = new GeneticStrategy();
        const seen: Array<[number, number | undefined]> = [];
        strategy.setProgressCallback((p) => {
            if (p.attempt === undefined) return;
            const last = seen[seen.length - 1];
            if (!last || last[0] !== p.attempt) seen.push([p.attempt, p.maxAttempts]);
        });
        const inventory = [makeGear('g1', 'weapon', 'attack', 1000)];
        await strategy.findOptimalGear(
            makeShip(),
            [{ stat: 'attack', weight: 1 }],
            inventory,
            (id) => inventory.find((g) => g.id === id),
            () => undefined,
            NO_SCORING_INPUTS
        );
        expect(seen).toEqual([
            [1, 3],
            [2, 3],
            [3, 3],
        ]);
    });
});

/**
 * A cliff: the ship already wears a 4-piece Boost set whose pieces are individually the weakest
 * in their slots. Every slot also holds DECOYS non-Boost pieces with more speed, so any build
 * short of all four Boost pieces scores no Boost bonus and is pulled AWAY from them by the speed
 * gradient. Only a build containing all four Boost pieces (the current loadout, or the same
 * pieces with different fillers) can match the current score.
 */
describe('GeneticStrategy.findOptimalGear — never below the current loadout', () => {
    const DECOYS = 25;
    const BOOST_SLOTS = ['weapon', 'hull', 'generator', 'sensor'] as const;
    const FILLER_SLOTS = ['software', 'thrusters'] as const;

    function cliffFixture() {
        const inventory: GearPiece[] = [];
        const equipment: Ship['equipment'] = {};
        for (const slot of BOOST_SLOTS) {
            const boost = { ...makeGear(`boost-${slot}`, slot, 'speed', 1), setBonus: 'BOOST' };
            inventory.push(boost);
            equipment[slot] = boost.id;
        }
        for (const slot of FILLER_SLOTS) {
            const filler = makeGear(`filler-${slot}`, slot, 'speed', 60);
            inventory.push(filler);
            equipment[slot] = filler.id;
        }
        for (const slot of [...BOOST_SLOTS, ...FILLER_SLOTS]) {
            for (let i = 0; i < DECOYS; i++) {
                inventory.push(makeGear(`decoy-${slot}-${i}`, slot, 'speed', 20 + i));
            }
        }
        const ship: Ship = { ...makeShip(), equipment };
        return { ship, inventory };
    }

    it('keeps a current Boost set that random search would not reassemble', async () => {
        const { ship, inventory } = cliffFixture();
        const byId = new Map(inventory.map((g) => [g.id, g]));
        const getGearPiece = (id: string) => byId.get(id);
        const getEng = (_t: ShipTypeName): EngineeringStat | undefined => undefined;
        const scoringInputs: ScoringInputs = {
            ...NO_SCORING_INPUTS,
            shipRole: 'SUPPORTER_BUFFER',
        };
        const currentScore = calculateTotalScore(
            ship,
            ship.equipment,
            [],
            getGearPiece,
            getEng,
            'SUPPORTER_BUFFER'
        );

        const result = await new GeneticStrategy().findOptimalGear(
            ship,
            [],
            inventory,
            getGearPiece,
            getEng,
            scoringInputs
        );

        const suggested = new Set(result.suggestions.map((s) => s.gearId));
        for (const slot of BOOST_SLOTS) expect(suggested).toContain(`boost-${slot}`);
        expect(result.suggestions[0].score).toBeGreaterThanOrEqual(currentScore);
    });
});
