import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    analyzePotentialUpgrades,
    baselineBreakdownCache,
    baselineStatsCache,
} from '../../potentialCalculator';
import { fastAnalyzePotentialUpgrades } from '../fastAnalyze';
import type { ShipTypeName, GearSlotName } from '../../../../constants';
import type { StatName } from '../../../../types/stats';
import type { GearPiece } from '../../../../types/gear';
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

describe('equivalence: explicit edge cases', () => {
    // Helper that runs both paths under the same PRNG and returns results
    // for assertion. Keeps individual tests short.
    function runBothPaths(args: Parameters<typeof analyzePotentialUpgrades>, seed = 0) {
        let rng = seededRandom(seed);
        vi.spyOn(Math, 'random').mockImplementation(() => rng());
        const slow = analyzePotentialUpgrades(...args);
        rng = seededRandom(seed);
        vi.spyOn(Math, 'random').mockImplementation(() => rng());
        baselineBreakdownCache.clear();
        baselineStatsCache.clear();
        const fast = fastAnalyzePotentialUpgrades(...args);
        return { slow, fast };
    }

    it('empty eligible pieces returns empty arrays from both paths', () => {
        const { slow, fast } = runBothPaths([
            [],
            'ATTACKER',
            6,
            undefined,
            'rare',
            10,
            [],
            'AND',
            [],
            undefined,
            undefined,
            undefined,
        ]);
        expect(slow).toEqual([]);
        expect(fast).toEqual([]);
    });

    it('single eligible piece produces matching single result (dummy)', () => {
        const inv = generateEligibleInventory(100, 1);
        const { slow, fast } = runBothPaths([
            inv,
            'ATTACKER',
            6,
            undefined,
            'rare',
            5,
            [],
            'AND',
            [],
            undefined,
            undefined,
            undefined,
        ]);
        expect(fast).toHaveLength(1);
        assertFloatsClose(fast[0].potentialScore, slow[0].potentialScore, { relative: true });
    });

    it('simulated-upgrade of calibrated piece applies calibration in both paths', () => {
        // analyzePotentialUpgrades filters for piece.level < 16, but
        // isCalibrationEligible requires piece.level === 16. So the
        // CURRENT-path calibration branch is unreachable — the only place
        // calibration actually runs is inside the simulation loop, where
        // simulateUpgrade() returns a piece at level 16. That upgraded
        // piece inherits the original's calibration metadata (via spread)
        // and therefore hits getCalibratedMainStat.
        //
        // This test exercises exactly that path: an analyze-eligible
        // piece (level 15, stars >= 5) with calibration metadata pointing
        // at the target ship. Fast and slow must produce identical
        // potentialScore (calibration applied to simulated upgrade).
        const ship = makeTestShip();
        const inv = generateEligibleInventory(55, 8);
        inv[0] = {
            ...inv[0],
            level: 15,
            stars: 5, // analyze-eligible; upgrade → 16 → calibration-eligible
            calibration: { shipId: ship.id },
        };
        const gearById = new Map(inv.map((p) => [p.id, p]));
        const { slow, fast } = runBothPaths(
            [
                inv,
                'ATTACKER',
                6,
                undefined,
                'rare',
                10,
                [],
                'AND',
                [],
                ship,
                (id) => gearById.get(id),
                () => undefined,
            ],
            77
        );
        expect(fast.map((r) => r.piece.id)).toEqual(slow.map((r) => r.piece.id));
        for (let i = 0; i < slow.length; i++) {
            assertFloatsClose(fast[i].potentialScore, slow[i].potentialScore, { relative: true });
        }
        // Sanity: the calibrated piece's potentialScore must differ from what
        // it would be without calibration metadata — proves calibration
        // actually ran on the upgraded piece. (Drop this assertion if flaky;
        // the equivalence assertions above are the primary gate.)
        const invNoCal = inv.map((p, i) => (i === 0 ? { ...p, calibration: undefined } : p));
        const gearByIdNoCal = new Map(invNoCal.map((p) => [p.id, p]));
        const { fast: fastNoCal } = runBothPaths(
            [
                invNoCal,
                'ATTACKER',
                6,
                undefined,
                'rare',
                10,
                [],
                'AND',
                [],
                ship,
                (id) => gearByIdNoCal.get(id),
                () => undefined,
            ],
            77
        );
        const calIdx = fast.findIndex((r) => r.piece.id === inv[0].id);
        const noCalIdx = fastNoCal.findIndex((r) => r.piece.id === inv[0].id);
        if (calIdx >= 0 && noCalIdx >= 0) {
            expect(fast[calIdx].potentialScore).not.toBe(fastNoCal[noCalIdx].potentialScore);
        }
    });

    it('2-piece set threshold: with-ship equipping to cross 2-piece boundary', () => {
        // The ship already has 1 DECIMATION piece; the candidate piece is
        // DECIMATION → adding it flips setCount from 1 to 2, crossing the
        // 2-piece boundary. Slow path applies bonus; fast must too.
        const ship = makeTestShip({ equipment: { hull: 'eq-hull' } });
        const equippedHull = {
            id: 'eq-hull',
            slot: 'hull' as const,
            setBonus: 'DECIMATION' as GearPiece['setBonus'],
            rarity: 'legendary' as const,
            level: 16,
            stars: 6,
            mainStat: { name: 'hp' as const, value: 100, type: 'flat' as const },
            subStats: [],
        };
        const inv = generateEligibleInventory(99, 4).map((p, i) =>
            i === 0
                ? { ...p, slot: 'weapon' as const, setBonus: 'DECIMATION' as GearPiece['setBonus'] }
                : p
        );
        const gearById = new Map<string, GearPiece>([
            ['eq-hull', equippedHull as GearPiece],
            ...inv.map((p) => [p.id, p] as [string, GearPiece]),
        ]);
        const { slow, fast } = runBothPaths(
            [
                inv,
                'ATTACKER',
                6,
                'weapon',
                'rare',
                10,
                [],
                'AND',
                [],
                ship,
                (id) => gearById.get(id),
                () => undefined,
            ],
            11
        );
        expect(fast.map((r) => r.piece.id)).toEqual(slow.map((r) => r.piece.id));
        for (let i = 0; i < slow.length; i++) {
            assertFloatsClose(fast[i].potentialScore, slow[i].potentialScore, { relative: true });
        }
    });

    it('DEBUFFER_CORROSION with DECIMATION set piece (role-specific bonus)', () => {
        const ship = makeTestShip({ type: 'DEBUFFER_CORROSION' });
        const inv = generateEligibleInventory(21, 6).map((p, i) =>
            i === 0 ? { ...p, setBonus: 'DECIMATION' as GearPiece['setBonus'] } : p
        );
        const gearById = new Map(inv.map((p) => [p.id, p]));
        const { slow, fast } = runBothPaths(
            [
                inv,
                'DEBUFFER_CORROSION',
                6,
                undefined,
                'rare',
                10,
                [],
                'AND',
                [],
                ship,
                (id) => gearById.get(id),
                () => undefined,
            ],
            33
        );
        expect(fast.map((r) => r.piece.id)).toEqual(slow.map((r) => r.piece.id));
    });
});
