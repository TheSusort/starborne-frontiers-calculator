import { describe, it, expect } from 'vitest';
import {
    scorePieceForRole,
    computeHeadroom,
    competitionRank,
    buildCoverageMatrix,
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

describe('computeHeadroom', () => {
    it('is 1 when you own nothing', () => {
        expect(computeHeadroom([])).toBe(1);
    });

    it('is 1 when you own a single piece, with nothing to compare against', () => {
        expect(computeHeadroom([50])).toBe(1);
    });

    it('is 1 when the best piece is worthless', () => {
        expect(computeHeadroom([0, 0, 0])).toBe(1);
        expect(computeHeadroom([-5, -10])).toBe(1);
    });

    it('is 0 when every piece is identical', () => {
        expect(computeHeadroom([40, 40, 40, 40])).toBe(0);
    });

    it("is the best piece's lead over the mean of the rest, as a share of the best", () => {
        // best 100, rest mean 50 -> (100 - 50) / 100
        expect(computeHeadroom([100, 50, 50])).toBeCloseTo(0.5, 10);
    });

    it('does not need sorted input', () => {
        expect(computeHeadroom([50, 100, 50])).toBeCloseTo(0.5, 10);
    });

    it('ignores everything past the sample size', () => {
        // 1 best + 19 equals fills the sample; the trailing zeros must not count.
        const sample = [100, ...Array<number>(COVERAGE_SAMPLE_SIZE - 1).fill(100)];
        const withTail = [...sample, ...Array<number>(50).fill(0)];
        expect(computeHeadroom(withTail)).toBe(0);
    });

    it('samples the top entries, not the first ones it is given', () => {
        // Twenty 1s followed by five 100s. Sorting before truncating keeps all
        // five 100s; truncating first would keep only the 1s and report a
        // fully saturated 0.
        const marginals = [...Array<number>(20).fill(1), ...Array<number>(5).fill(100)];
        const rest = [100, 100, 100, 100, ...Array<number>(15).fill(1)];
        const expected = (100 - rest.reduce((sum, v) => sum + v, 0) / rest.length) / 100;

        expect(computeHeadroom(marginals)).toBeCloseTo(expected, 10);
        expect(computeHeadroom(marginals)).not.toBe(0);
    });

    it('does not mutate its argument', () => {
        const marginals = [10, 50, 20];
        computeHeadroom(marginals);
        expect(marginals).toEqual([10, 50, 20]);
    });

    it('reports near-total headroom for one good piece and a weak tail', () => {
        expect(computeHeadroom([100, 1, 1, 1])).toBeGreaterThan(0.98);
    });

    it('never leaves the unit interval', () => {
        // A negative tail must clamp rather than push the gap above 1.
        expect(computeHeadroom([100, -1000])).toBe(1);
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

    it('reports an empty inventory in the static role order', () => {
        const matrix = buildCoverageMatrix([]);
        expect(matrix.roleOrder).toEqual(Object.keys(SHIP_TYPES));
        expect(matrix.cells.ATTACKER.weapon.count).toBe(0);
        expect(matrix.cells.ATTACKER.weapon.headroom).toBe(1);
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
        // No gear at all: every cell in every column is headroom 1, a full
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

    it('gives rank 1 to the role with the most headroom in that column', () => {
        const matrix = buildCoverageMatrix([makeGear({ id: 'a' }), makeGear({ id: 'b' })]);
        const byRank = Object.keys(SHIP_TYPES).sort(
            (x, y) => matrix.cells[x].weapon.rank - matrix.cells[y].weapon.rank
        );
        expect(matrix.cells[byRank[0]].weapon.headroom).toBeGreaterThanOrEqual(
            matrix.cells[byRank[1]].weapon.headroom
        );
    });

    it('gives an untouched role a strictly better sensor rank than a saturated one', () => {
        // 20 identical attacker-flavoured sensors (crit + critDamage). Only
        // ATTACKER, DEBUFFER and SUPPORTER read crit/critDamage in their
        // score formula (directly, via hacking*dps, and via the heal crit
        // multiplier respectively), so every piece scores an identical
        // nonzero marginal for those three -> headroom ~0 (saturated). Every
        // other role never reads crit/critDamage, so every piece scores a
        // marginal of exactly 0 for them -> headroom exactly 1 via
        // computeHeadroom's best<=0 branch, tied with every other untouched
        // role. See the `competitionRank` describe block above for the
        // exact-tie / skip-by-tie-count behaviour on clean values.
        const stack = Array.from({ length: 20 }, (_, i) =>
            makeGear({
                id: `sensor-${i}`,
                slot: 'sensor',
                mainStat: { name: 'crit', value: 25, type: 'percentage' },
                subStats: [{ name: 'critDamage', value: 30, type: 'percentage' }],
            })
        );
        const matrix = buildCoverageMatrix(stack);
        expect(matrix.cells.DEFENDER.sensor.headroom).toBe(1);
        expect(matrix.cells.DEFENDER.sensor.rank).toBe(1);
        expect(matrix.cells.ATTACKER.sensor.headroom).toBeCloseTo(0, 10);
        expect(matrix.cells.ATTACKER.sensor.rank).toBeGreaterThan(
            matrix.cells.DEFENDER.sensor.rank
        );
    });

    it("puts a role's saturated slot last in its own slot order", () => {
        // A deep, uniform stack of attacker-flavoured sensors: ATTACKER's
        // sensor column fills in (headroom collapses to ~0), so sensor must
        // sort to the back of ATTACKER's own slot order.
        const stack = Array.from({ length: 20 }, (_, i) =>
            makeGear({
                id: `sensor-${i}`,
                slot: 'sensor',
                mainStat: { name: 'crit', value: 25, type: 'percentage' },
                subStats: [{ name: 'critDamage', value: 30, type: 'percentage' }],
            })
        );
        const matrix = buildCoverageMatrix(stack);
        expect(matrix.cells.ATTACKER.sensor.headroom).toBeLessThan(0.1);
        expect(matrix.slotOrderByRole.ATTACKER[matrix.slotOrderByRole.ATTACKER.length - 1]).toBe(
            'sensor'
        );
    });

    it('orders roles by mean column rank, not by the static order', () => {
        // Twenty identical attacker-flavoured sensors (crit + critDamage) and
        // nothing else.
        //
        // ATTACKER, DEBUFFER and SUPPORTER are "live" for these pieces
        // (crit/critDamage feeds their score formula), so every identical
        // piece scores an identical nonzero marginal for them -> headroom
        // ~0. Each role's own arithmetic path rounds that to a slightly
        // different float (measured: ATTACKER ~1e-16, DEBUFFER/SUPPORTER
        // exactly 0), so competition ranking does not treat all three as
        // tied — ATTACKER lands on rank 10, DEBUFFER/SUPPORTER tie at rank
        // 11. The other 9 roles never read crit/critDamage, so every piece
        // scores an exact 0 marginal for them -> headroom exactly 1 -> rank
        // 1 (a real tie, backed by computeHeadroom's best<=0 branch, not
        // arithmetic that can round differently per role).
        //
        // The five empty columns are a full 12-way tie, so every role gets
        // rank 1 there too — competition ranking, unlike unconditional
        // index+1 ranking, does not let SHIP_TYPES index leak into a tied
        // column's rank.
        //
        // Mean rank = (sensorRank + 5*1) / 6: 1 for the 9 untouched roles,
        // 2.5 for ATTACKER (sensor rank 10), 16/6 for DEBUFFER/SUPPORTER
        // (sensor rank 11). Every untouched role still beats every live
        // role, so the live roles are pushed to the back regardless of the
        // 10-vs-11 split — a static roleOrder would instead put ATTACKER
        // (SHIP_TYPES index 0) first.
        const stack = Array.from({ length: 20 }, (_, i) =>
            makeGear({
                id: `sensor-${i}`,
                slot: 'sensor',
                mainStat: { name: 'crit', value: 25, type: 'percentage' },
                subStats: [{ name: 'critDamage', value: 30, type: 'percentage' }],
            })
        );
        const matrix = buildCoverageMatrix(stack);
        const untouchedRolesInOrder = Object.keys(SHIP_TYPES).filter(
            (role) => !['ATTACKER', 'DEBUFFER', 'SUPPORTER'].includes(role)
        );
        const liveRolesInOrder = ['ATTACKER', 'DEBUFFER', 'SUPPORTER'];

        expect(matrix.roleOrder).toEqual([...untouchedRolesInOrder, ...liveRolesInOrder]);
        expect(matrix.roleOrder[0]).toBe('DEFENDER');
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
});
