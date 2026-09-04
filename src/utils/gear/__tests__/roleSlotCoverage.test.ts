import { describe, it, expect } from 'vitest';
import {
    scorePieceForRole,
    computePriority,
    competitionRank,
    buildCoverageMatrix,
    mainStatType,
    COVERAGE_MIN_LEVEL,
    COVERAGE_SAMPLE_SIZE,
} from '../roleSlotCoverage';
import { GearPiece } from '../../../types/gear';
import { calculateRoleScore } from '../../autogear/priorityScore';
import { ROLE_BASE_STATS } from '../../../constants/roleBaseStats';
import { SHIP_TYPES } from '../../../constants/shipTypes';
import { GEAR_SLOT_ORDER } from '../../../constants/gearTypes';

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

    it('clamps to 0 when the sampled mean exceeds idealMarginal', () => {
        // idealMarginal bounds a piece built from the roll tables at legendary
        // max; imported data is not bound by those tables (a stat can come in
        // above its table's legendary max), so owned marginals can still land
        // above it. This guards that case, not the ideal piece's own
        // composition — the negative-marginal clamp below covers the other
        // out-of-range direction.
        expect(computePriority(Array<number>(20).fill(150), 100)).toBe(0);
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

    it('gives an untouched role a strictly better software rank than a saturated one', () => {
        // calculateDebufferScore reads hacking multiplicatively
        // (priorityScore.ts) and calculateDefenderScore never reads it.
        // Twenty absurdly-strong hacking pieces push DEBUFFER's mean far
        // past any real ideal-piece marginal (clamped to fully covered),
        // while DEFENDER's marginal for every one of them stays exactly 0,
        // leaving it at the untouched priority of 1.
        const stack = Array.from({ length: 20 }, (_, i) =>
            makeGear({
                id: `sw-${i}`,
                slot: 'software',
                mainStat: { name: 'hacking', value: 1_000_000, type: 'flat' },
            })
        );
        const matrix = buildCoverageMatrix(stack);
        expect(matrix.cells.DEFENDER.software.priority).toBe(1);
        expect(matrix.cells.DEFENDER.software.rank).toBe(1);
        expect(matrix.cells.DEBUFFER.software.priority).toBe(0);
        expect(matrix.cells.DEBUFFER.software.rank).toBeGreaterThan(
            matrix.cells.DEFENDER.software.rank
        );
    });

    it("puts a role's saturated slot last in its own slot order", () => {
        // Same absurd-hacking-software stack: DEBUFFER's software column is
        // fully covered (priority 0) while its other five slot columns are
        // untouched (priority 1, tied with every other role), so software
        // must sort to the back of DEBUFFER's own slot order.
        const stack = Array.from({ length: 20 }, (_, i) =>
            makeGear({
                id: `sw-${i}`,
                slot: 'software',
                mainStat: { name: 'hacking', value: 1_000_000, type: 'flat' },
            })
        );
        const matrix = buildCoverageMatrix(stack);
        expect(matrix.cells.DEBUFFER.software.priority).toBe(0);
        expect(matrix.slotOrderByRole.DEBUFFER[matrix.slotOrderByRole.DEBUFFER.length - 1]).toBe(
            'software'
        );
    });

    it('orders roles by mean column rank, not by the static order', () => {
        // Same absurd-hacking-software stack. DEBUFFER's mean rank across
        // the 6 slot columns is worse than an untouched role's (one column
        // at a high rank number, five at rank 1, versus rank 1 everywhere),
        // so DEBUFFER must sort behind an untouched role regardless of
        // SHIP_TYPES's static index order.
        const stack = Array.from({ length: 20 }, (_, i) =>
            makeGear({
                id: `sw-${i}`,
                slot: 'software',
                mainStat: { name: 'hacking', value: 1_000_000, type: 'flat' },
            })
        );
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
        // pickIdealMainStat/pickIdealSubstats/getIdealMarginal are not
        // exported, so these pin their output indirectly: a hand-built
        // replica of the level-16, 6-star legendary ideal piece is fed
        // through buildCoverageMatrix as the only owned piece. If the
        // replica's stats truly are what the ideal-piece selection computes,
        // its own marginal (scored by the same scorePieceForRole the ideal
        // piece is scored by) IS idealMarginal, so one owned copy must read
        // priority 1 - 1/COVERAGE_SAMPLE_SIZE exactly, and COVERAGE_SAMPLE_SIZE
        // owned copies must fully saturate. A wrong main stat, a wrong
        // substat, or a wrong flat/percentage variant changes the real
        // idealMarginal without changing the replica's marginal, so the
        // ratio — and the assertion — stops landing on that exact value.

        // The weapon slot only ever offers `attack` as a main stat, so this
        // main stat is not what distinguishes the two replicas below; the
        // substat composition is.
        it('reads the ATTACKER weapon ideal as attack/crit/critDamage/hp/defence', () => {
            const attackerIdeal = makeGear({
                id: 'attacker-ideal-replica',
                mainStat: { name: 'attack', value: 1000, type: 'flat' },
                subStats: [
                    { name: 'crit', value: 8, type: 'percentage' },
                    { name: 'critDamage', value: 8, type: 'percentage' },
                    { name: 'hp', value: 600, type: 'flat' },
                    { name: 'defence', value: 140, type: 'flat' },
                ],
            });

            const one = buildCoverageMatrix([attackerIdeal]);
            expect(one.cells.ATTACKER.weapon.priority).toBeCloseTo(
                1 - 1 / COVERAGE_SAMPLE_SIZE,
                10
            );

            const twenty = buildCoverageMatrix(
                Array.from({ length: COVERAGE_SAMPLE_SIZE }, (_, i) =>
                    makeGear({
                        id: `attacker-ideal-replica-${i}`,
                        mainStat: { name: 'attack', value: 1000, type: 'flat' },
                        subStats: [
                            { name: 'crit', value: 8, type: 'percentage' },
                            { name: 'critDamage', value: 8, type: 'percentage' },
                            { name: 'hp', value: 600, type: 'flat' },
                            { name: 'defence', value: 140, type: 'flat' },
                        ],
                    })
                )
            );
            // Not toBe(0): the same marginal is recomputed on two different
            // paths (the owned piece vs. the cached ideal piece), and float
            // arithmetic over bit-identical stats is not guaranteed bit-exact.
            expect(twenty.cells.ATTACKER.weapon.priority).toBeLessThan(1e-9);
        });

        it('reads the DEFENDER_SECURITY weapon ideal as attack/security/hp%/defence%/hacking', () => {
            // calculateDefenderSecurityScore multiplies effective-HP survival
            // by security, so — unlike ATTACKER — hp and defence are NOT
            // inert here, and they resolve to their percentage roll (a share
            // of the DEFENDER baseline) rather than their flat roll, since
            // percentage scores higher against that baseline. This pins that
            // selection together with the security substat itself.
            const securityIdeal = makeGear({
                id: 'security-ideal-replica',
                mainStat: { name: 'attack', value: 1000, type: 'flat' },
                subStats: [
                    { name: 'security', value: 8, type: 'flat' },
                    { name: 'hp', value: 7, type: 'percentage' },
                    { name: 'defence', value: 7, type: 'percentage' },
                    { name: 'hacking', value: 8, type: 'flat' },
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
