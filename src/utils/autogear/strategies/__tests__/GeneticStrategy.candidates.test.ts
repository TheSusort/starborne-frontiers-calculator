import { describe, it, expect, beforeEach } from 'vitest';
import { dedupeCandidates, GeneticStrategy, MAX_EXPOSED_CANDIDATES } from '../GeneticStrategy';
import { clearScoreCache } from '../../scoring';
import type { GearSuggestion, StatPriority } from '../../../../types/autogear';
import type { Ship } from '../../../../types/ship';
import type { GearPiece } from '../../../../types/gear';
import type { BaseStats, EngineeringStat } from '../../../../types/stats';
import type { ShipTypeName } from '../../../../constants/shipTypes';

const loadout = (ids: string[]): GearSuggestion[] =>
    ids.map((gearId, i) => ({
        slotName: `slot${i}`,
        gearId,
        score: 1,
    }));

describe('dedupeCandidates', () => {
    it('collapses loadouts wearing the same pieces, whatever the slot order', () => {
        const result = dedupeCandidates([loadout(['a', 'b']), loadout(['b', 'a'])]);
        expect(result).toHaveLength(1);
    });

    it('keeps loadouts that differ by a single piece', () => {
        expect(dedupeCandidates([loadout(['a', 'b']), loadout(['a', 'c'])])).toHaveLength(2);
    });

    it('preserves best-first order', () => {
        const result = dedupeCandidates([loadout(['a']), loadout(['b']), loadout(['a'])]);
        expect(result.map((l) => l[0].gearId)).toEqual(['a', 'b']);
    });

    it('excludes a loadout matching the one to skip regardless of slot order', () => {
        // The skip loadout's pieces are given in the opposite slot order from the pool entry
        // it should match, so this fails if exclusion compares by array shape instead of set.
        const result = dedupeCandidates(
            [loadout(['a', 'b']), loadout(['c', 'd'])],
            loadout(['b', 'a'])
        );
        expect(result.map((l) => l.map((s) => s.gearId).sort())).toEqual([['c', 'd']]);
    });
});

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

const makeGear = (id: string, slot: string, stat: keyof BaseStats, amount: number): GearPiece => ({
    id,
    slot,
    level: 16,
    stars: 6,
    rarity: 'legendary',
    setBonus: null,
    mainStat: { name: stat, value: amount, type: 'flat' } as GearPiece['mainStat'],
    subStats: [],
});

const makeShip = (): Ship => ({
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
});

const key = (loadout: { gearId: string }[]) =>
    loadout
        .map((s) => s.gearId)
        .sort()
        .join('|');

describe('GeneticStrategy candidates field', () => {
    beforeEach(() => {
        clearScoreCache();
    });

    it('exposes runner-ups, none of them equal to the returned best', async () => {
        const strategy = new GeneticStrategy();
        // Several same-slot pieces, so the population holds genuinely distinct loadouts to
        // expose. With one piece per slot there is only one possible build and `candidates`
        // is legitimately empty — which would make this test vacuous.
        const inventory = [
            makeGear('w1', 'weapon', 'attack', 1000),
            makeGear('w2', 'weapon', 'attack', 900),
            makeGear('w3', 'weapon', 'attack', 800),
            makeGear('h1', 'hull', 'hp', 10000),
            makeGear('h2', 'hull', 'hp', 9000),
        ];
        const getGearPiece = (id: string) => inventory.find((g) => g.id === id);
        const getEng = (_t: ShipTypeName): EngineeringStat | undefined => undefined;
        const priorities: StatPriority[] = [{ stat: 'attack', weight: 1 }];

        const result = await strategy.findOptimalGear(
            makeShip(),
            priorities,
            inventory,
            getGearPiece,
            getEng
        );

        expect(result.candidates).toBeDefined();
        expect(result.candidates!.length).toBeGreaterThan(0);
        // Only 3 weapons x 2 hulls = 6 distinct builds exist, so at most 5 remain once the
        // best is excluded. A dedupe failure would surface as near-copies past this bound.
        expect(result.candidates!.length).toBeLessThanOrEqual(5);

        const best = key(result.suggestions);
        for (const candidate of result.candidates!) {
            expect(key(candidate)).not.toBe(best);
        }
    });

    it('exposes each distinct loadout once', async () => {
        const strategy = new GeneticStrategy();
        const inventory = [
            makeGear('w1', 'weapon', 'attack', 1000),
            makeGear('w2', 'weapon', 'attack', 900),
            makeGear('h1', 'hull', 'hp', 10000),
            makeGear('h2', 'hull', 'hp', 9000),
        ];
        const getGearPiece = (id: string) => inventory.find((g) => g.id === id);
        const getEng = (_t: ShipTypeName): EngineeringStat | undefined => undefined;

        const result = await strategy.findOptimalGear(
            makeShip(),
            [{ stat: 'attack', weight: 1 }],
            inventory,
            getGearPiece,
            getEng
        );

        const keys = result.candidates!.map(key);
        expect(keys.length).toBeGreaterThan(0);
        expect(new Set(keys).size).toBe(keys.length);
    });

    it('excludes candidates that violate a hard requirement', async () => {
        const strategy = new GeneticStrategy();
        // Base attack is 5000; only w1's +1000 clears a 6000 hard minimum. w2/w3 leave the
        // build infeasible, so a correct implementation excludes every build wearing them.
        const inventory = [
            makeGear('w1', 'weapon', 'attack', 1000),
            makeGear('w2', 'weapon', 'attack', 500),
            makeGear('w3', 'weapon', 'attack', 100),
            makeGear('h1', 'hull', 'hp', 10000),
            makeGear('h2', 'hull', 'hp', 9000),
        ];
        const getGearPiece = (id: string) => inventory.find((g) => g.id === id);
        const getEng = (_t: ShipTypeName): EngineeringStat | undefined => undefined;
        const priorities: StatPriority[] = [
            { stat: 'attack', weight: 1, minLimit: 6000, hardRequirement: true },
        ];

        const result = await strategy.findOptimalGear(
            makeShip(),
            priorities,
            inventory,
            getGearPiece,
            getEng
        );

        expect(result.hardRequirementsMet).toBe(true);
        expect(result.candidates).toBeDefined();
        expect(result.candidates!.length).toBeGreaterThan(0);
        for (const candidate of result.candidates!) {
            expect(candidate.some((s) => s.gearId === 'w1')).toBe(true);
        }
    });

    it('caps candidates at MAX_EXPOSED_CANDIDATES when more distinct zero-violation loadouts exist', async () => {
        const strategy = new GeneticStrategy();
        // 5 weapons x 5 hulls = 25 distinct builds. Attack/hp values are spaced by 1 so no
        // build is meaningfully fitter than another under a single 'attack' priority (hull
        // doesn't affect attack at all), leaving the population free to hold many of them at
        // once instead of converging on one.
        const inventory = [
            ...['w1', 'w2', 'w3', 'w4', 'w5'].map((id, i) =>
                makeGear(id, 'weapon', 'attack', 1000 - i)
            ),
            ...['h1', 'h2', 'h3', 'h4', 'h5'].map((id, i) => makeGear(id, 'hull', 'hp', 10000 - i)),
        ];
        const getGearPiece = (id: string) => inventory.find((g) => g.id === id);
        const getEng = (_t: ShipTypeName): EngineeringStat | undefined => undefined;

        const result = await strategy.findOptimalGear(
            makeShip(),
            [{ stat: 'attack', weight: 1 }],
            inventory,
            getGearPiece,
            getEng
        );

        expect(result.candidates).toBeDefined();
        expect(result.candidates!.length).toBe(MAX_EXPOSED_CANDIDATES);
    });
});
