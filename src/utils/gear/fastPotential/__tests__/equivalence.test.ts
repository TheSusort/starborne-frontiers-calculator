import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
// USE_FAST_POTENTIAL is true, which makes analyzePotentialUpgrades() ITSELF
// resolve to fastAnalyzePotentialUpgrades
// — so without this mock, every "slow vs fast" comparison below silently
// compares the fast path to itself and can never fail. Forcing it false here
// routes analyzePotentialUpgrades through the real slow path so this file
// tests what its name says.
vi.mock('../featureFlag', () => ({ USE_FAST_POTENTIAL: false, VERIFY_FAST_POTENTIAL: false }));
import {
    analyzePotentialUpgrades,
    baselineBreakdownCache,
    baselineStatsCache,
} from '../../potentialCalculator';
import { fastAnalyzePotentialUpgrades } from '../fastAnalyze';
import type { ShipTypeName, GearSlotName } from '../../../../constants';
import type { StatName } from '../../../../types/stats';
import type { GearPiece } from '../../../../types/gear';
import { getScoringBaselineStats } from '../../../../constants/roleBaseStats';
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
            i === 0 ? { ...p, slot: 'weapon' as const, setBonus: 'DECIMATION' } : p
        );
        const gearById = new Map<string, GearPiece>([
            ['eq-hull', equippedHull],
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
            i === 0 ? { ...p, setBonus: 'DECIMATION' } : p
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

describe('dummy mode: the geared crit/critDamage scoring reference (#475)', () => {
    // Dummy mode (no ship) always includes the analysed piece in its OWN
    // "current" stats (potentialCalculator's dummy branch builds equipment
    // from `{ [piece.slot]: piece.id }` regardless of the includePiece flag),
    // so `currentScore` is a deterministic function of the piece alone — no
    // RNG pinning needed for these assertions.
    const plainSensor: GearPiece = {
        id: 'plain-sensor',
        slot: 'sensor',
        level: 12,
        stars: 6,
        rarity: 'legendary',
        mainStat: { name: 'attack', value: 50, type: 'percentage' },
        subStats: [],
        setBonus: null,
    };
    const sensorWithCritSubstat: GearPiece = {
        ...plainSensor,
        id: 'sensor-with-crit-substat',
        subStats: [{ name: 'crit', value: 8, type: 'percentage' }],
    };

    // Derived from the accessor, never hardcoded: the probes below only mean
    // anything relative to wherever the scoring reference currently sits, and
    // a literal here silently stops straddling the cap the moment that moves.
    const CRIT_HEADROOM = 100 - getScoringBaselineStats('ATTACKER').crit;
    const CRIT_UNDER_CAP = CRIT_HEADROOM * 0.75;
    const CRIT_AT_CAP = CRIT_HEADROOM + 0.01;

    function makeCritMainSensor(critValue: number): GearPiece {
        return {
            id: `crit-main-${critValue}`,
            slot: 'sensor',
            level: 12,
            stars: 6,
            rarity: 'legendary',
            mainStat: { name: 'crit', value: critValue, type: 'percentage' },
            subStats: [],
            setBonus: null,
        };
    }

    const critDamageHeavyWeapon: GearPiece = {
        id: 'critdamage-heavy-weapon',
        slot: 'weapon',
        level: 12,
        stars: 6,
        rarity: 'legendary',
        mainStat: { name: 'attack', value: 1000, type: 'flat' },
        subStats: [
            { name: 'critDamage', value: 40, type: 'percentage' },
            { name: 'crit', value: 8, type: 'percentage' },
            { name: 'attack', value: 7, type: 'percentage' },
        ],
        setBonus: null,
    };
    const critRateStackedWeapon: GearPiece = {
        ...critDamageHeavyWeapon,
        id: 'critrate-stacked-weapon',
        subStats: [
            { name: 'crit', value: 40, type: 'percentage' },
            { name: 'critDamage', value: 8, type: 'percentage' },
            { name: 'attack', value: 7, type: 'percentage' },
        ],
    };

    it("scores an otherwise-identical piece differently once a +8 crit substat is added — the old baseline cancelled every piece's own crit to a fixed ~100 total", () => {
        const [plain] = analyzePotentialUpgrades(
            [plainSensor],
            'ATTACKER',
            1,
            'sensor',
            'legendary',
            1
        );
        const [withCrit] = analyzePotentialUpgrades(
            [sensorWithCritSubstat],
            'ATTACKER',
            1,
            'sensor',
            'legendary',
            1
        );
        expect(withCrit.currentScore).not.toBeCloseTo(plain.currentScore, 6);
    });

    it('a +30 crit main-stat sensor gains only the points that fit under the 100 cap, not the full 30', () => {
        // ATTACKER's geared scoring reference leaves a few points of crit
        // headroom below calculateCritMultiplier's cap (stats.crit >= 100);
        // `getScoringBaselineStats` owns the exact figure. A piece whose own
        // crit stays under that headroom scores measurably lower than one
        // that reaches the cap, and everything past the cap buys nothing, so
        // two pieces that both cross it score IDENTICALLY.
        const [under] = analyzePotentialUpgrades(
            [makeCritMainSensor(CRIT_UNDER_CAP)],
            'ATTACKER',
            1,
            'sensor',
            'legendary',
            1
        );
        const [atCap] = analyzePotentialUpgrades(
            [makeCritMainSensor(CRIT_AT_CAP)],
            'ATTACKER',
            1,
            'sensor',
            'legendary',
            1
        );
        const [wayOverCap] = analyzePotentialUpgrades(
            [makeCritMainSensor(30)],
            'ATTACKER',
            1,
            'sensor',
            'legendary',
            1
        );
        expect(under.currentScore).toBeLessThan(atCap.currentScore);
        expect(wayOverCap.currentScore).toBeCloseTo(atCap.currentScore, 6);
    });

    describe('fast/slow parity on the same fixtures', () => {
        const fixtures: GearPiece[] = [
            plainSensor,
            sensorWithCritSubstat,
            makeCritMainSensor(CRIT_UNDER_CAP),
            makeCritMainSensor(CRIT_AT_CAP),
            makeCritMainSensor(30),
            critDamageHeavyWeapon,
            critRateStackedWeapon,
        ];

        it.each(fixtures)('slow and fast agree on currentScore for piece $id', (piece) => {
            const [slow] = analyzePotentialUpgrades(
                [piece],
                'ATTACKER',
                1,
                piece.slot,
                'legendary',
                1
            );
            const [fast] = fastAnalyzePotentialUpgrades(
                [piece],
                'ATTACKER',
                1,
                piece.slot,
                'legendary',
                1
            );
            assertFloatsClose(fast.currentScore, slow.currentScore, { relative: true });
        });

        // One case per role whose scoring baseline moved. SUPPORTER reaches
        // crit through a different formula than ATTACKER/DEBUFFER (heal crit,
        // not DPS), so agreement on an attacker proves nothing about it.
        it.each(['ATTACKER', 'DEBUFFER', 'SUPPORTER'] as const)(
            'slow and fast agree on currentScore in dummy mode for role %s',
            (role) => {
                const [slow] = analyzePotentialUpgrades(
                    [sensorWithCritSubstat],
                    role,
                    1,
                    'sensor',
                    'legendary',
                    1
                );
                const [fast] = fastAnalyzePotentialUpgrades(
                    [sensorWithCritSubstat],
                    role,
                    1,
                    'sensor',
                    'legendary',
                    1
                );
                assertFloatsClose(fast.currentScore, slow.currentScore, { relative: true });
            }
        );
    });
});
