import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    analyzePotentialUpgrades,
    baselineBreakdownCache,
    baselineStatsCache,
} from '../../potentialCalculator';
import { fastAnalyzePotentialUpgrades } from '../fastAnalyze';
import type { ShipTypeName, GearSlotName } from '../../../../constants';
import type { StatName } from '../../../../types/stats';
import {
    generateEligibleInventory,
    seededRandom,
    makeTestShip,
    assertFloatsClose,
} from './fixtures/testInventory';

describe('fixture sanity', () => {
    it('generates deterministic inventory for the same seed', () => {
        const a = generateEligibleInventory(42, 12);
        const b = generateEligibleInventory(42, 12);
        expect(a.map((p) => p.id)).toEqual(b.map((p) => p.id));
        expect(a[0].mainStat?.value).toBe(b[0].mainStat?.value);
    });

    it('seededRandom is reproducible', () => {
        const r1 = seededRandom(1);
        const r2 = seededRandom(1);
        for (let i = 0; i < 5; i++) expect(r1()).toBe(r2());
    });

    it('every generated piece has level < 16', () => {
        const pieces = generateEligibleInventory(7, 30);
        for (const p of pieces) expect(p.level).toBeLessThan(16);
    });
});

const ALL_ROLES: ShipTypeName[] = [
    'ATTACKER',
    'DEFENDER',
    'DEFENDER_SECURITY',
    'DEBUFFER',
    'DEBUFFER_DEFENSIVE',
    'DEBUFFER_DEFENSIVE_SECURITY',
    'DEBUFFER_BOMBER',
    'DEBUFFER_CORROSION',
    'SUPPORTER',
    'SUPPORTER_BUFFER',
    'SUPPORTER_OFFENSIVE',
    'SUPPORTER_SHIELD',
];
const RARITIES = ['rare', 'epic', 'legendary'] as const;
const SIM_COUNT_BY_RARITY: Record<(typeof RARITIES)[number], number> = {
    rare: 10,
    epic: 20,
    legendary: 40,
};
const SLOT_OPTIONS: (GearSlotName | undefined)[] = [undefined, 'weapon', 'hull'];
const STAT_OPTIONS: StatName[][] = [[], ['attack'], ['hp', 'crit']];
const FILTER_MODES = ['AND', 'OR'] as const;
const SET_FILTER_OPTIONS = [[], ['DECIMATION'], ['SHIELD', 'BOOST']];

interface Scenario {
    role: ShipTypeName;
    slot: GearSlotName | undefined;
    rarity: (typeof RARITIES)[number];
    selectedStats: StatName[];
    statFilterMode: (typeof FILTER_MODES)[number];
    selectedGearSets: string[];
    withShip: boolean;
    seed: number;
}

function generateScenarios(count: number, seed = 123): Scenario[] {
    const rnd = seededRandom(seed);
    const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length)];
    const out: Scenario[] = [];
    for (let i = 0; i < count; i++) {
        out.push({
            role: pick(ALL_ROLES),
            slot: pick(SLOT_OPTIONS),
            rarity: pick(RARITIES),
            selectedStats: pick(STAT_OPTIONS),
            statFilterMode: pick(FILTER_MODES),
            selectedGearSets: pick(SET_FILTER_OPTIONS),
            withShip: rnd() < 0.6, // bias toward with-ship, the 20× path
            seed: i + 1,
        });
    }
    return out;
}

beforeEach(() => {
    baselineBreakdownCache.clear();
    baselineStatsCache.clear();
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('equivalence: fast vs slow analyzePotentialUpgrades', () => {
    const scenarios = generateScenarios(30);
    it.each(scenarios)(
        'scenario #$seed role=$role slot=$slot rarity=$rarity withShip=$withShip',
        (sc) => {
            // Deterministic PRNG for simulateUpgrade — both paths must see
            // identical random sequences. Reset the sequence between slow and
            // fast by re-mocking with the same seed.
            const inventory = generateEligibleInventory(sc.seed, 30);
            const ship = sc.withShip ? makeTestShip({ type: sc.role }) : undefined;
            const gearById = new Map(inventory.map((p) => [p.id, p]));
            const getGearPiece = ship ? (id: string) => gearById.get(id) : undefined;
            const getEngineeringStats = ship ? () => undefined : undefined;

            const simCount = SIM_COUNT_BY_RARITY[sc.rarity];
            const args = [
                inventory,
                sc.role,
                6,
                sc.slot,
                sc.rarity,
                simCount,
                sc.selectedStats,
                sc.statFilterMode,
                sc.selectedGearSets,
                ship,
                getGearPiece,
                getEngineeringStats,
            ] as const;

            // Slow run with fresh PRNG
            let rng = seededRandom(sc.seed + 1000);
            vi.spyOn(Math, 'random').mockImplementation(() => rng());
            const slowResults = analyzePotentialUpgrades(...args);

            // Fast run with fresh PRNG — SAME seed, so identical sequence
            rng = seededRandom(sc.seed + 1000);
            vi.spyOn(Math, 'random').mockImplementation(() => rng());
            baselineBreakdownCache.clear();
            baselineStatsCache.clear();
            const fastResults = fastAnalyzePotentialUpgrades(...args);

            expect(fastResults.length).toBe(slowResults.length);
            for (let i = 0; i < slowResults.length; i++) {
                expect(fastResults[i].piece.id).toBe(slowResults[i].piece.id);
                assertFloatsClose(fastResults[i].currentScore, slowResults[i].currentScore, {
                    relative: true,
                });
                assertFloatsClose(fastResults[i].potentialScore, slowResults[i].potentialScore, {
                    relative: true,
                });
                assertFloatsClose(fastResults[i].improvement, slowResults[i].improvement, {
                    relative: true,
                });
            }
        }
    );
});
