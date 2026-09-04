import { describe, it, expect, afterEach, vi } from 'vitest';
import {
    scorePieceForRole,
    computePriority,
    competitionRank,
    buildCoverageMatrix,
    mainStatType,
    getIdealMarginal,
    COVERAGE_MIN_LEVEL,
    COVERAGE_SAMPLE_SIZE,
} from '../roleSlotCoverage';
import { GearPiece } from '../../../types/gear';
import { calculateRoleScore } from '../../autogear/priorityScore';
import { ROLE_BASE_STATS } from '../../../constants/roleBaseStats';
import { SHIP_TYPES, ShipTypeName } from '../../../constants/shipTypes';
import { GEAR_SLOT_ORDER, GEAR_SLOTS, GearSlotName } from '../../../constants/gearTypes';
import { SUBSTAT_RANGES } from '../../../constants/statValues';
import { calculateMainStatValue } from '../mainStatValueFetcher';
import type { Stat, StatName, StatType } from '../../../types/stats';

/** Minimal level-16 legendary piece. Override what a test cares about. */
function makeGear(overrides: Partial<GearPiece> = {}): GearPiece {
    return {
        id: 'gear-1',
        slot: 'weapon',
        level: COVERAGE_MIN_LEVEL,
        stars: 6,
        rarity: 'legendary',
        mainStat: { name: 'attack', value: 1000, type: 'flat' },
        subStats: [],
        setBonus: null,
        ...overrides,
    };
}

describe('constants', () => {
    it('samples the top 20 level-16 pieces', () => {
        expect(COVERAGE_SAMPLE_SIZE).toBe(20);
        expect(COVERAGE_MIN_LEVEL).toBe(16);
    });
});

describe('mainStatType', () => {
    it('is always flat for hacking, security and speed, even on percentage slots', () => {
        // Real imported game data rolls these three flat on every slot that
        // can carry them, including the percentage slots (sensor, software,
        // thrusters) — `calculateMainStatValue` routes them through their own
        // flat-magnitude tables, not the percentage table.
        for (const slot of ['sensor', 'software', 'thrusters'] as const) {
            expect(mainStatType(slot, 'hacking')).toBe('flat');
            expect(mainStatType(slot, 'security')).toBe('flat');
            expect(mainStatType(slot, 'speed')).toBe('flat');
        }
        for (const slot of ['weapon', 'hull', 'generator'] as const) {
            expect(mainStatType(slot, 'hacking')).toBe('flat');
            expect(mainStatType(slot, 'security')).toBe('flat');
            expect(mainStatType(slot, 'speed')).toBe('flat');
        }
    });

    it('is percentage-only for crit/critDamage regardless of slot', () => {
        expect(mainStatType('weapon', 'crit')).toBe('percentage');
        expect(mainStatType('software', 'critDamage')).toBe('percentage');
    });

    it('follows the slot rule for hp, attack and defence', () => {
        for (const slot of ['weapon', 'hull', 'generator'] as const) {
            expect(mainStatType(slot, 'hp')).toBe('flat');
            expect(mainStatType(slot, 'attack')).toBe('flat');
            expect(mainStatType(slot, 'defence')).toBe('flat');
        }
        for (const slot of ['sensor', 'software', 'thrusters'] as const) {
            expect(mainStatType(slot, 'hp')).toBe('percentage');
            expect(mainStatType(slot, 'attack')).toBe('percentage');
            expect(mainStatType(slot, 'defence')).toBe('percentage');
        }
    });
});

describe('scorePieceForRole', () => {
    it('returns a positive marginal for a piece that helps the role', () => {
        expect(scorePieceForRole(makeGear(), 'ATTACKER')).toBeGreaterThan(0);
    });

    it('gives an attacker nothing for a stat the attacker score never reads', () => {
        // calculateAttackerScore is calculateDPS plus stat bonuses, and
        // calculateDPS reads only attack, crit, critDamage and
        // defensePenetration (priorityScore.ts:53, :127). healModifier is
        // therefore provably inert for this role, so the marginal is exactly 0.
        const healPiece = makeGear({
            id: 'heal',
            slot: 'sensor',
            mainStat: { name: 'healModifier', value: 30, type: 'percentage' },
        });
        expect(scorePieceForRole(healPiece, 'ATTACKER')).toBe(0);
    });

    it('scores a role-relevant piece above an inert one', () => {
        const critPiece = makeGear({
            id: 'crit',
            slot: 'sensor',
            mainStat: { name: 'crit', value: 30, type: 'percentage' },
        });
        const healPiece = makeGear({
            id: 'heal',
            slot: 'sensor',
            mainStat: { name: 'healModifier', value: 30, type: 'percentage' },
        });
        expect(scorePieceForRole(critPiece, 'ATTACKER')).toBeGreaterThan(
            scorePieceForRole(healPiece, 'ATTACKER')
        );
    });

    it('treats a percentage flexible stat as a share of the role baseline', () => {
        // ATTACKER baseline attack is 6250, so +10% attack must beat a flat +100.
        const percentPiece = makeGear({
            id: 'pct',
            mainStat: { name: 'attack', value: 10, type: 'percentage' },
        });
        const flatPiece = makeGear({
            id: 'flat',
            mainStat: { name: 'attack', value: 100, type: 'flat' },
        });
        expect(scorePieceForRole(percentPiece, 'ATTACKER')).toBeGreaterThan(
            scorePieceForRole(flatPiece, 'ATTACKER')
        );
    });

    it('adds a percentage-only stat directly, not as a share of the baseline', () => {
        // ATTACKER's baseline crit is 20 and crit is stored as an integer
        // percentage, so a +20 crit piece must land the block at crit 40.
        // Scaling it as a share of the baseline instead would land it at 24 —
        // the second assertion is what makes this test able to fail.
        const piece = makeGear({ mainStat: { name: 'crit', value: 20, type: 'percentage' } });
        const baselineScore = calculateRoleScore('ATTACKER', ROLE_BASE_STATS.ATTACKER);
        const direct =
            calculateRoleScore('ATTACKER', { ...ROLE_BASE_STATS.ATTACKER, crit: 40 }) -
            baselineScore;
        const scaledShare =
            calculateRoleScore('ATTACKER', { ...ROLE_BASE_STATS.ATTACKER, crit: 24 }) -
            baselineScore;

        expect(scorePieceForRole(piece, 'ATTACKER')).toBeCloseTo(direct, 10);
        expect(scorePieceForRole(piece, 'ATTACKER')).not.toBeCloseTo(scaledShare, 10);
    });

    it('counts substats as well as the main stat', () => {
        const bare = makeGear({ id: 'bare' });
        const loaded = makeGear({
            id: 'loaded',
            subStats: [
                { name: 'crit', value: 15, type: 'percentage' },
                { name: 'critDamage', value: 20, type: 'percentage' },
            ],
        });
        expect(scorePieceForRole(loaded, 'ATTACKER')).toBeGreaterThan(
            scorePieceForRole(bare, 'ATTACKER')
        );
    });

    it('ignores the set bonus', () => {
        const plain = makeGear({ id: 'plain', setBonus: null });
        const withSet = makeGear({ id: 'set', setBonus: 'CRITICAL' });
        expect(scorePieceForRole(withSet, 'ATTACKER')).toBe(scorePieceForRole(plain, 'ATTACKER'));
    });

    it('ignores calibration, which is bound to one ship', () => {
        const plain = makeGear({ id: 'plain' });
        const calibrated = makeGear({ id: 'cal', calibration: { shipId: 'ship-1' } });
        expect(scorePieceForRole(calibrated, 'ATTACKER')).toBe(
            scorePieceForRole(plain, 'ATTACKER')
        );
    });

    it('scores the same piece differently for different roles', () => {
        const hacking = makeGear({
            id: 'hack',
            slot: 'software',
            mainStat: { name: 'hacking', value: 300, type: 'flat' },
        });
        expect(scorePieceForRole(hacking, 'DEBUFFER')).toBeGreaterThan(
            scorePieceForRole(hacking, 'DEFENDER')
        );
    });

    it('tolerates a piece with no main stat', () => {
        expect(() => scorePieceForRole(makeGear({ mainStat: null }), 'ATTACKER')).not.toThrow();
    });
});

describe('computePriority', () => {
    it('is 1 when you own nothing in the slot', () => {
        expect(computePriority([], 100)).toBe(1);
    });

    it('is 0 when idealMarginal is exactly 0 — nothing this slot can carry helps the role', () => {
        // Distinguishes this from the empty-inventory case above: an empty
        // sample alone must NOT be enough to return 1.
        expect(computePriority([], 0)).toBe(0);
        expect(computePriority([50, 60], 0)).toBe(0);
    });

    it('is 0 when idealMarginal is negative', () => {
        expect(computePriority([], -5)).toBe(0);
    });

    it('is 0 when 20 or more owned pieces already match the ideal', () => {
        const ideal = 100;
        expect(computePriority(Array<number>(20).fill(ideal), ideal)).toBe(0);
        expect(computePriority(Array<number>(25).fill(ideal), ideal)).toBe(0);
    });

    describe('a real marginal above idealMarginal', () => {
        // idealMarginal is supposed to be the ceiling; a real marginal above
        // it (whether from an ideal-model shortfall or from imported data
        // simply not being bound by the roll tables) means that ceiling is
        // wrong, not that the slot is saturated. Non-production throws so the
        // defect is loud; production only logs and clamps, matching
        // `scorePieceUpgrade.ts`'s missing-baseline pattern.
        afterEach(() => {
            vi.unstubAllEnvs();
        });

        it('throws outside production', () => {
            expect(() => computePriority(Array<number>(20).fill(150), 100)).toThrow(
                /exceeds idealMarginal/
            );
        });

        it('names the offending role and slot when a context is given', () => {
            expect(() =>
                computePriority(Array<number>(20).fill(150), 100, COVERAGE_SAMPLE_SIZE, {
                    role: 'ATTACKER',
                    slot: 'weapon',
                })
            ).toThrow(/ATTACKER\/weapon/);
        });

        it('clamps to 0 in production instead of throwing', () => {
            vi.stubEnv('NODE_ENV', 'production');
            expect(computePriority(Array<number>(20).fill(150), 100)).toBe(0);
        });
    });

    it('never exceeds 1, even with marginals worse than the role baseline', () => {
        // A negative marginal pulls the mean below 0, which would push
        // coverage negative and 1 - coverage above 1 without the clamp.
        expect(computePriority([-1000], 100)).toBe(1);
    });

    it('zero-pads up to COVERAGE_SAMPLE_SIZE rather than dividing by the sample length', () => {
        // One ideal piece: mean = idealMarginal / 20, so coverage is a bare
        // 5% and priority is correspondingly still very high. Twenty ideal
        // pieces: mean = idealMarginal, fully covered, priority 0. Dividing
        // by `sample.length` instead of the fixed 20 would report both as
        // fully covered (mean == idealMarginal either way).
        const ideal = 100;
        const onePiece = computePriority([ideal], ideal);
        const twentyPieces = computePriority(Array<number>(20).fill(ideal), ideal);
        expect(onePiece).toBeCloseTo(0.95, 10);
        expect(twentyPieces).toBe(0);
        expect(onePiece).toBeGreaterThan(twentyPieces);
    });

    it('does not let a sample past COVERAGE_SAMPLE_SIZE affect the mean', () => {
        const ideal = 100;
        const withoutTail = computePriority(Array<number>(20).fill(ideal), ideal);
        const withTail = computePriority(
            [...Array<number>(20).fill(ideal), ...Array<number>(50).fill(0)],
            ideal
        );
        expect(withTail).toBe(withoutTail);
    });

    it('samples the top entries, not the first ones it is given', () => {
        const ideal = 100;
        const marginals = [...Array<number>(20).fill(1), ...Array<number>(5).fill(ideal)];
        // Sorting before truncating keeps the five ideal-scoring pieces;
        // truncating first would keep only the 1s.
        const sortedFirst = computePriority(marginals, ideal);
        const truncatedFirst = computePriority(marginals.slice(0, 20), ideal);
        expect(sortedFirst).not.toBe(truncatedFirst);
    });

    it('does not need sorted input', () => {
        expect(computePriority([1, 100, 1], 100)).toBe(computePriority([100, 1, 1], 100));
    });

    it('does not mutate its argument', () => {
        const marginals = [10, 50, 20];
        computePriority(marginals, 100);
        expect(marginals).toEqual([10, 50, 20]);
    });

    it('normalises by the given idealMarginal, not a fixed constant', () => {
        // Same marginals (40), two different ideals: coverage must track
        // whichever idealMarginal is passed in, not a hardcoded reference.
        expect(computePriority(Array<number>(20).fill(40), 200)).toBeCloseTo(0.8, 10);
        expect(computePriority(Array<number>(20).fill(40), 40)).toBe(0);
    });

    it('scores 20 uniformly mediocre pieces at a higher priority than 20 max-roll pieces', () => {
        // Priority is relative to idealMarginal, not to the spread within the
        // owned sample, so uniformly mediocre supply reads as needing MORE
        // farming than uniformly max-roll supply, never the same.
        const ideal = 100;
        const mediocre = computePriority(Array<number>(20).fill(20), ideal);
        const maxRoll = computePriority(Array<number>(20).fill(ideal), ideal);
        expect(mediocre).toBeGreaterThan(maxRoll);
        expect(maxRoll).toBe(0);
    });

    describe('configurable sample size', () => {
        // 30 mixed-quality marginals: 20 at the ideal ceiling, 10 at half of
        // it. A slot holding more than 20 pieces but fewer than a larger N
        // must read a HIGHER priority at that larger N — the top-20 window
        // alone is fully covered (mean == ideal, priority 0), but widening
        // the window to 50 (zero-padded) pulls in the weaker 10 and 20 more
        // unfarmed zero-pad slots, dragging the mean down and priority up.
        const ideal = 100;
        const mixedQuality = [...Array<number>(20).fill(ideal), ...Array<number>(10).fill(50)];

        it('reaches the sampleSize argument: N=50 reads a higher priority than the default N=20', () => {
            const atDefault = computePriority(mixedQuality, ideal);
            const atFifty = computePriority(mixedQuality, ideal, 50);
            expect(atDefault).toBe(0);
            expect(atFifty).toBeGreaterThan(atDefault);
            // mean over 50 = (20*100 + 10*50 + 20*0) / 50 = 50, coverage 0.5, priority 0.5
            expect(atFifty).toBeCloseTo(0.5, 10);
        });

        it('zero-pads to the passed sampleSize, not the default', () => {
            // One ideal piece: at N=10, mean = ideal/10 (priority 0.9); at
            // N=200, mean = ideal/200 (priority 0.995). Both must read as
            // near-total priority, and the larger N must read closer to 1.
            const onePiece = [ideal];
            const atTen = computePriority(onePiece, ideal, 10);
            const atTwoHundred = computePriority(onePiece, ideal, 200);
            expect(atTen).toBeCloseTo(0.9, 10);
            expect(atTwoHundred).toBeCloseTo(0.995, 10);
            expect(atTwoHundred).toBeGreaterThan(atTen);
        });

        it('defaults to COVERAGE_SAMPLE_SIZE when no sampleSize argument is given', () => {
            expect(computePriority(mixedQuality, ideal)).toBe(
                computePriority(mixedQuality, ideal, COVERAGE_SAMPLE_SIZE)
            );
        });
    });
});

describe('competitionRank', () => {
    it('gives every item rank 1 when all values tie', () => {
        const ranks = competitionRank(['a', 'b', 'c'], () => 5, ['a', 'b', 'c']);
        expect(ranks.get('a')).toBe(1);
        expect(ranks.get('b')).toBe(1);
        expect(ranks.get('c')).toBe(1);
    });

    it('gives equal rank to equal values, and skips the next rank by the tie count', () => {
        // a, b, c tie for first (rank 1); d is strictly lower and, with 3
        // entries tied ahead of it, lands on rank 4 -- not rank 2, the way
        // an unconditional index+1 ranking would place it.
        const values: Record<string, number> = { a: 10, b: 10, c: 10, d: 1 };
        const ranks = competitionRank(Object.keys(values), (item) => values[item], [
            'a',
            'b',
            'c',
            'd',
        ]);
        expect(ranks.get('a')).toBe(1);
        expect(ranks.get('b')).toBe(1);
        expect(ranks.get('c')).toBe(1);
        expect(ranks.get('d')).toBe(4);
    });

    it('gives the highest value rank 1, descending', () => {
        const values: Record<string, number> = { low: 1, mid: 5, high: 9 };
        const ranks = competitionRank(Object.keys(values), (item) => values[item], [
            'low',
            'mid',
            'high',
        ]);
        expect(ranks.get('high')).toBe(1);
        expect(ranks.get('mid')).toBe(2);
        expect(ranks.get('low')).toBe(3);
    });

    it('breaks ties among equally-ranked items using `order`, without changing the rank number', () => {
        const ranks = competitionRank(['b', 'a'], () => 1, ['a', 'b']);
        // Both tie for rank 1 regardless of which one `order` treats as first.
        expect(ranks.get('a')).toBe(1);
        expect(ranks.get('b')).toBe(1);
    });

    it('treats values within floating-point noise of each other as tied', () => {
        // Different role scoring formulas run different arithmetic paths
        // over bit-identical input, so a conceptual tie can come back as
        // e.g. 5 and 5 + 2.9e-16 instead of two exact 5s.
        const values: Record<string, number> = { a: 5, b: 5 + 1e-13 };
        const ranks = competitionRank(Object.keys(values), (item) => values[item], ['a', 'b']);
        expect(ranks.get('a')).toBe(1);
        expect(ranks.get('b')).toBe(1);
    });

    it('does not treat a real gap as a tie just because it is small', () => {
        const values: Record<string, number> = { a: 5, b: 5.001 };
        const ranks = competitionRank(Object.keys(values), (item) => values[item], ['a', 'b']);
        expect(ranks.get('b')).toBe(1);
        expect(ranks.get('a')).toBe(2);
    });
});

describe('buildCoverageMatrix', () => {
    it('covers every role and every gear slot', () => {
        const matrix = buildCoverageMatrix([]);
        const roles = Object.keys(SHIP_TYPES);
        expect(matrix.roleOrder).toHaveLength(roles.length);
        expect(Object.keys(matrix.cells)).toHaveLength(roles.length);
        for (const role of roles) {
            expect(Object.keys(matrix.cells[role])).toEqual(GEAR_SLOT_ORDER);
            expect(matrix.slotOrderByRole[role]).toHaveLength(GEAR_SLOT_ORDER.length);
        }
    });

    it('reports an empty inventory in the static role order, priority 1 everywhere', () => {
        const matrix = buildCoverageMatrix([]);
        expect(matrix.roleOrder).toEqual(Object.keys(SHIP_TYPES));
        expect(matrix.cells.ATTACKER.weapon.count).toBe(0);
        expect(matrix.cells.ATTACKER.weapon.priority).toBe(1);
    });

    it('counts only level-16 pieces', () => {
        const inventory = [
            makeGear({ id: 'a', level: 16 }),
            makeGear({ id: 'b', level: 15 }),
            makeGear({ id: 'c', level: 1 }),
        ];
        const matrix = buildCoverageMatrix(inventory);
        expect(matrix.cells.ATTACKER.weapon.count).toBe(1);
    });

    it('counts equipped pieces, which are still supply', () => {
        const matrix = buildCoverageMatrix([makeGear({ id: 'a', shipId: 'ship-1' })]);
        expect(matrix.cells.ATTACKER.weapon.count).toBe(1);
    });

    it('files each piece under its own slot only', () => {
        const matrix = buildCoverageMatrix([makeGear({ id: 'a', slot: 'hull' })]);
        expect(matrix.cells.ATTACKER.hull.count).toBe(1);
        expect(matrix.cells.ATTACKER.weapon.count).toBe(0);
    });

    it('ignores implant slots', () => {
        const matrix = buildCoverageMatrix([makeGear({ id: 'a', slot: 'implant_major' })]);
        for (const slot of GEAR_SLOT_ORDER) {
            expect(matrix.cells.ATTACKER[slot].count).toBe(0);
        }
    });

    it('gives every cell rank 1 when the whole slot column ties', () => {
        // No gear at all: every cell in every column is priority 1, a full
        // tie. Competition ranking gives every tied entry the SAME rank, so
        // this must not reproduce 1..12 the way an unconditional index+1
        // ranking would.
        const matrix = buildCoverageMatrix([]);
        for (const slot of GEAR_SLOT_ORDER) {
            for (const role of Object.keys(SHIP_TYPES)) {
                expect(matrix.cells[role][slot].rank).toBe(1);
            }
        }
    });

    /**
     * A real level-16, 6-star legendary software piece whose marginal for
     * DEBUFFER exactly equals `getIdealMarginal('DEBUFFER', 'software')` —
     * confirmed against the exhaustive search, not guessed: main stat
     * `hacking` (flat, the only legal type), subs `attack` flat once,
     * `attack` percentage stacked through all 4 upgrade rolls, `crit` and
     * `critDamage` once each. `calculateDebufferScore` reads hacking
     * multiplicatively against dps (priorityScore.ts) and
     * `calculateDefenderScore` never reads hacking or attack, so this same
     * piece scores 0 for DEFENDER — a real, legal saturating stack for one
     * role and an inert one for the other, without an illegal stat value.
     */
    const debufferIdealSoftwarePiece = () =>
        makeGear({
            slot: 'software',
            mainStat: { name: 'hacking', value: 100, type: 'flat' },
            subStats: [
                { name: 'attack', value: 140, type: 'flat' },
                { name: 'attack', value: 35, type: 'percentage' },
                { name: 'crit', value: 8, type: 'percentage' },
                { name: 'critDamage', value: 8, type: 'percentage' },
            ],
        });

    it('gives an untouched role a strictly better software rank than a saturated one', () => {
        const stack = Array.from({ length: 20 }, (_, i) => ({
            ...debufferIdealSoftwarePiece(),
            id: `sw-${i}`,
        }));
        const matrix = buildCoverageMatrix(stack);
        expect(matrix.cells.DEFENDER.software.priority).toBe(1);
        expect(matrix.cells.DEFENDER.software.rank).toBe(1);
        expect(matrix.cells.DEBUFFER.software.priority).toBe(0);
        expect(matrix.cells.DEBUFFER.software.rank).toBeGreaterThan(
            matrix.cells.DEFENDER.software.rank
        );
    });

    it("puts a role's saturated slot last in its own slot order", () => {
        // Same ideal-matching software stack: DEBUFFER's software column is
        // fully covered (priority 0) while its other five slot columns are
        // untouched (priority 1, tied with every other role), so software
        // must sort to the back of DEBUFFER's own slot order.
        const stack = Array.from({ length: 20 }, (_, i) => ({
            ...debufferIdealSoftwarePiece(),
            id: `sw-${i}`,
        }));
        const matrix = buildCoverageMatrix(stack);
        expect(matrix.cells.DEBUFFER.software.priority).toBe(0);
        expect(matrix.slotOrderByRole.DEBUFFER[matrix.slotOrderByRole.DEBUFFER.length - 1]).toBe(
            'software'
        );
    });

    it('orders roles by mean column rank, not by the static order', () => {
        // Same ideal-matching software stack. DEBUFFER's mean rank across
        // the 6 slot columns is worse than an untouched role's (one column
        // at a high rank number, five at rank 1, versus rank 1 everywhere),
        // so DEBUFFER must sort behind an untouched role regardless of
        // SHIP_TYPES's static index order.
        const stack = Array.from({ length: 20 }, (_, i) => ({
            ...debufferIdealSoftwarePiece(),
            id: `sw-${i}`,
        }));
        const matrix = buildCoverageMatrix(stack);
        const debufferIndex = matrix.roleOrder.indexOf('DEBUFFER');
        const defenderIndex = matrix.roleOrder.indexOf('DEFENDER');
        expect(defenderIndex).toBeLessThan(debufferIndex);
        expect(matrix.roleOrder).not.toEqual(Object.keys(SHIP_TYPES));
    });

    it("falls back to GEAR_SLOT_ORDER when a role's slots all tie", () => {
        const matrix = buildCoverageMatrix([]);
        for (const role of Object.keys(SHIP_TYPES)) {
            expect(matrix.slotOrderByRole[role]).toEqual(GEAR_SLOT_ORDER);
        }
    });

    it("orders a role's slots by that role's column ranks", () => {
        const matrix = buildCoverageMatrix([makeGear({ id: 'a' })]);
        const order = matrix.slotOrderByRole.ATTACKER;
        for (let i = 1; i < order.length; i++) {
            expect(matrix.cells.ATTACKER[order[i - 1]].rank).toBeLessThanOrEqual(
                matrix.cells.ATTACKER[order[i]].rank
            );
        }
    });

    it('a stronger single piece for a role never yields a higher priority than a weaker one', () => {
        // Monotonicity check against the real, code-computed ideal piece
        // (not a synthetic idealMarginal): a piece with better substats must
        // not leave the slot reading as MORE in need of farming.
        const strong = buildCoverageMatrix([
            makeGear({
                id: 'strong',
                mainStat: { name: 'attack', value: 140, type: 'flat' },
                subStats: [
                    { name: 'attack', value: 100, type: 'flat' },
                    { name: 'crit', value: 8, type: 'percentage' },
                    { name: 'critDamage', value: 8, type: 'percentage' },
                    { name: 'hp', value: 600, type: 'flat' },
                ],
            }),
        ]);
        const weak = buildCoverageMatrix([
            makeGear({
                id: 'weak',
                mainStat: { name: 'attack', value: 70, type: 'flat' },
                subStats: [],
            }),
        ]);
        // A single piece, however strong, cannot saturate a 20-slot sample,
        // so a strictly better piece must read a strictly lower priority.
        expect(strong.cells.ATTACKER.weapon.priority).toBeLessThan(
            weak.cells.ATTACKER.weapon.priority
        );
    });

    describe('the internal ideal piece', () => {
        // pickIdealPiece/pickIdealSubstats/getIdealMarginal are not exported
        // (getIdealMarginal alone is — see the "ideal is a true ceiling"
        // tests below), so these pin the FULL composition indirectly: a
        // hand-built replica of the level-16, 6-star legendary ideal piece is
        // fed through buildCoverageMatrix as the only owned piece. If the
        // replica's stats truly are what the ideal-piece search finds, its
        // own marginal (scored by the same scorePieceForRole the ideal piece
        // is scored by) IS idealMarginal, so one owned copy must read
        // priority 1 - 1/COVERAGE_SAMPLE_SIZE exactly, and COVERAGE_SAMPLE_SIZE
        // owned copies must fully saturate. A wrong main stat, a wrong
        // substat, a wrong flat/percentage variant, or a wrong upgrade-roll
        // split changes the real idealMarginal without changing the
        // replica's marginal, so the ratio — and the assertion — stops
        // landing on that exact value.

        // The weapon slot only ever offers `attack` as a main stat, so this
        // main stat is not what distinguishes the two replicas below; the
        // substat composition is. Substat slots now carry the 4 upgrade
        // rolls a level-16 legendary piece actually gets (increases, not new
        // substats — see LEGENDARY_SUBSTAT_INCREASES's doc), so a slot can
        // sit above its own single-roll legendary max.
        it('reads the ATTACKER weapon ideal as attack main, hp/attack%/crit%/critDamage% subs', () => {
            const attackerIdeal = makeGear({
                id: 'attacker-ideal-replica',
                mainStat: { name: 'attack', value: 1000, type: 'flat' },
                subStats: [
                    { name: 'hp', value: 600, type: 'flat' }, // 1 roll (no increases landed here)
                    { name: 'attack', value: 21, type: 'percentage' }, // 3 rolls (+2 increases)
                    { name: 'crit', value: 24, type: 'percentage' }, // 3 rolls (+2 increases)
                    { name: 'critDamage', value: 8, type: 'percentage' }, // 1 roll
                ],
            });

            const one = buildCoverageMatrix([attackerIdeal]);
            expect(one.cells.ATTACKER.weapon.priority).toBeCloseTo(
                1 - 1 / COVERAGE_SAMPLE_SIZE,
                10
            );

            // Threading a non-default sampleSize through buildCoverageMatrix
            // itself (not just computePriority) — a hardcoded 20 at this call
            // site would fail this assertion even with computePriority fixed.
            const oneAtFifty = buildCoverageMatrix([attackerIdeal], 50);
            expect(oneAtFifty.cells.ATTACKER.weapon.priority).toBeCloseTo(1 - 1 / 50, 10);

            const twenty = buildCoverageMatrix(
                Array.from({ length: COVERAGE_SAMPLE_SIZE }, (_, i) =>
                    makeGear({
                        id: `attacker-ideal-replica-${i}`,
                        mainStat: { name: 'attack', value: 1000, type: 'flat' },
                        subStats: [
                            { name: 'hp', value: 600, type: 'flat' },
                            { name: 'attack', value: 21, type: 'percentage' },
                            { name: 'crit', value: 24, type: 'percentage' },
                            { name: 'critDamage', value: 8, type: 'percentage' },
                        ],
                    })
                )
            );
            // Not toBe(0): the same marginal is recomputed on two different
            // paths (the owned piece vs. the cached ideal piece), and float
            // arithmetic over bit-identical stats is not guaranteed bit-exact.
            expect(twenty.cells.ATTACKER.weapon.priority).toBeLessThan(1e-9);
        });

        it('reads the DEFENDER_SECURITY weapon ideal as attack main, hp/hp%/defence%/security(x5) subs', () => {
            // calculateDefenderSecurityScore multiplies effective-HP survival
            // by security, so security is worth stacking every upgrade roll
            // it can get: all 4 increases land on the same security slot,
            // reaching 5x its own 8-flat single-roll legendary max (40).
            const securityIdeal = makeGear({
                id: 'security-ideal-replica',
                mainStat: { name: 'attack', value: 1000, type: 'flat' },
                subStats: [
                    { name: 'hp', value: 600, type: 'flat' }, // 1 roll
                    { name: 'hp', value: 7, type: 'percentage' }, // 1 roll
                    { name: 'defence', value: 7, type: 'percentage' }, // 1 roll
                    { name: 'security', value: 40, type: 'flat' }, // 5 rolls (+4 increases)
                ],
            });

            const one = buildCoverageMatrix([securityIdeal]);
            expect(one.cells.DEFENDER_SECURITY.weapon.priority).toBeCloseTo(
                1 - 1 / COVERAGE_SAMPLE_SIZE,
                10
            );
        });
    });
});

describe('the ideal is a true ceiling', () => {
    // Fix 1's bug (excluding a substat by NAME instead of (name, type)) made
    // the ideal under-count a legal roll; this section proves the ceiling
    // property directly, independent of `roleSlotCoverage.ts`'s own search —
    // these helpers are a SEPARATE implementation, not a call into
    // `pickIdealSubstats`, so a bug shared between the two would have to be
    // coincidental rather than a single point of failure.

    /** Every k-element subset of `items`. */
    function combinations<T>(items: T[], k: number): T[][] {
        if (k === 0) return [[]];
        if (items.length < k) return [];
        const [first, ...rest] = items;
        return [
            ...combinations(rest, k - 1).map((combo) => [first, ...combo]),
            ...combinations(rest, k),
        ];
    }

    /** Every way to split `total` indistinguishable upgrade rolls across `slots` buckets. */
    function distributeRolls(total: number, slots: number): number[][] {
        if (slots === 1) return [[total]];
        const result: number[][] = [];
        for (let take = 0; take <= total; take++) {
            for (const rest of distributeRolls(total - take, slots - 1)) {
                result.push([take, ...rest]);
            }
        }
        return result;
    }

    const LEGENDARY_SUBSTAT_SLOTS = 4;
    const LEGENDARY_UPGRADE_INCREASES = 4;

    /**
     * Every realistic legal level-16, 6-star legendary piece `slot` can
     * carry: every legal main stat (with its correct flat/percentage type),
     * crossed with every legal 4-of-N distinct (name, type) substat
     * combination (excluding only the main stat's own exact pair — the
     * `GearPieceForm` rule), crossed with every way the piece's 4 upgrade
     * rolls can land across those 4 slots (a slot can carry up to 5 rolls of
     * its own single-roll legendary max — see `potentialCalculator.ts`'s
     * `UPGRADE_LEVELS.legendary`).
     */
    function realisticPiecesForSlot(slot: GearSlotName): GearPiece[] {
        const pieces: GearPiece[] = [];
        const rollDistributions = distributeRolls(
            LEGENDARY_UPGRADE_INCREASES,
            LEGENDARY_SUBSTAT_SLOTS
        );

        for (const name of GEAR_SLOTS[slot].availableMainStats) {
            const type = mainStatType(slot, name);
            const mainStat: Stat =
                type === 'percentage'
                    ? {
                          name,
                          value: calculateMainStatValue(name, type, 6, COVERAGE_MIN_LEVEL),
                          type,
                      }
                    : ({
                          name,
                          value: calculateMainStatValue(name, type, 6, COVERAGE_MIN_LEVEL),
                          type,
                      } as Stat);

            const pairs: { name: StatName; type: StatType }[] = [];
            for (const subName of Object.keys(SUBSTAT_RANGES) as StatName[]) {
                for (const subType of Object.keys(SUBSTAT_RANGES[subName]) as StatType[]) {
                    if (mainStat.name === subName && mainStat.type === subType) continue;
                    pairs.push({ name: subName, type: subType });
                }
            }

            for (const combo of combinations(pairs, LEGENDARY_SUBSTAT_SLOTS)) {
                for (const rolls of rollDistributions) {
                    const subStats: Stat[] = combo.map((pair, i) => {
                        const max = SUBSTAT_RANGES[pair.name][pair.type].legendary.max;
                        const value = (1 + rolls[i]) * max;
                        return pair.type === 'percentage'
                            ? { name: pair.name, value, type: 'percentage' }
                            : ({ name: pair.name, value, type: 'flat' } as Stat);
                    });
                    pieces.push({
                        id: `realistic-${slot}-${name}-${type}`,
                        slot,
                        level: COVERAGE_MIN_LEVEL,
                        stars: 6,
                        rarity: 'legendary',
                        mainStat,
                        subStats,
                        setBonus: null,
                    });
                }
            }
        }
        return pieces;
    }

    const roles = Object.keys(SHIP_TYPES);
    const piecesBySlot = new Map(
        GEAR_SLOT_ORDER.map((slot) => [slot, realisticPiecesForSlot(slot)] as const)
    );

    it('the user-reported real weapon (40% critDamage, stacked attack%) does not exceed the ATTACKER weapon ideal', () => {
        // The exact piece a player reported: 1000 attack flat main stat;
        // critDamage 40% (5 rolls at its 8% legendary max — every upgrade
        // roll landed here), crit 8%, attack 7%, attack ~150 flat.
        const reportedPiece: GearPiece = {
            id: 'user-reported-attacker-weapon',
            slot: 'weapon',
            level: COVERAGE_MIN_LEVEL,
            stars: 6,
            rarity: 'legendary',
            mainStat: { name: 'attack', value: 1000, type: 'flat' },
            subStats: [
                { name: 'critDamage', value: 40, type: 'percentage' },
                { name: 'crit', value: 8, type: 'percentage' },
                { name: 'attack', value: 7, type: 'percentage' },
                { name: 'attack', value: 150, type: 'flat' },
            ],
            setBonus: null,
        };
        const ideal = getIdealMarginal('ATTACKER', 'weapon');
        const marginal = scorePieceForRole(reportedPiece, 'ATTACKER');
        expect(marginal).toBeLessThanOrEqual(ideal + 1e-6);
    });

    it('no realistic legal piece, in any slot, exceeds its (role, slot) ideal for any role', () => {
        // A single assertion over the worst violation found, not one
        // `expect` per candidate piece x role x slot (well over a
        // million) — vitest's per-assertion bookkeeping dominates the
        // runtime at that count, dwarfing the actual arithmetic.
        let worst: { role: ShipTypeName; slot: GearSlotName; overshoot: number } | null = null;
        for (const role of roles) {
            for (const slot of GEAR_SLOT_ORDER) {
                const ideal = getIdealMarginal(role, slot);
                for (const piece of piecesBySlot.get(slot) ?? []) {
                    const marginal = scorePieceForRole(piece, role);
                    const overshoot = marginal - ideal;
                    if (overshoot > 1e-6 && (!worst || overshoot > worst.overshoot)) {
                        worst = { role, slot, overshoot };
                    }
                }
            }
        }
        expect(worst).toBeNull();
    }, 20000);

    it('feeding the same realistic pieces through buildCoverageMatrix never trips the tripwire', () => {
        // A companion to the direct assertion above: this exercises the
        // PRODUCTION path (buildCoverageMatrix -> computePriority), so a
        // regression shows up as a thrown tripwire here even if the direct
        // ceiling assertion above were somehow bypassed.
        for (const slot of GEAR_SLOT_ORDER) {
            const pieces = (piecesBySlot.get(slot) ?? []).map((piece, i) => ({
                ...piece,
                id: `${piece.id}-${i}`,
            }));
            expect(() => buildCoverageMatrix(pieces)).not.toThrow();
        }
    });
});
