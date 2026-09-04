import { describe, it, expect } from 'vitest';
import {
    scorePieceForRole,
    computeHeadroom,
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

    it('reports an empty inventory as no gear, in the static role order', () => {
        const matrix = buildCoverageMatrix([]);
        expect(matrix.hasAnyGear).toBe(false);
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
        expect(matrix.hasAnyGear).toBe(true);
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

    it('ranks 1 to 12 within each slot column, with no gaps', () => {
        const matrix = buildCoverageMatrix([makeGear({ id: 'a' }), makeGear({ id: 'b' })]);
        for (const slot of GEAR_SLOT_ORDER) {
            const ranks = Object.keys(SHIP_TYPES)
                .map((role) => matrix.cells[role][slot].rank)
                .sort((x, y) => x - y);
            expect(ranks).toEqual(Object.keys(SHIP_TYPES).map((_, i) => i + 1));
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

    it('breaks ties with the static SHIP_TYPES order', () => {
        // No gear at all: every cell is headroom 1, so every column is a full tie.
        const matrix = buildCoverageMatrix([]);
        const roles = Object.keys(SHIP_TYPES);
        roles.forEach((role, index) => {
            expect(matrix.cells[role].weapon.rank).toBe(index + 1);
        });
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
        // A role's score only moves with these pieces when its formula reads
        // crit/critDamage: directly for ATTACKER's DPS, through DEBUFFER's
        // hacking*dps term (DEBUFFER's baseline hacking is 200, not 0), and
        // through SUPPORTER's heal crit multiplier. Every other role's
        // formula never reads crit/critDamage, so the pieces are exactly
        // inert there: marginal 0, which is computeHeadroom's best<=0 branch
        // -> headroom 1. For the three "live" roles the pieces are
        // identical, so their tied marginals give headroom 0 too (gap 0),
        // same as full saturation.
        //
        // So the sensor column has 9 roles tied at headroom 1 (ranked 1-9,
        // in static SHIP_TYPES order) and ATTACKER/DEBUFFER/SUPPORTER tied
        // at headroom 0 (ranked 10-12, also in static order: index 0, 3, 8
        // -> ATTACKER rank 10, DEBUFFER rank 11, SUPPORTER rank 12).
        //
        // The five empty columns are a full tie, so every role's rank there
        // is just its SHIP_TYPES index + 1.
        //
        // Mean rank = (sensorRank + 5*(index+1)) / 6. DEFENDER (index 1,
        // sensor rank 1) works out to 11/6 and leads. ATTACKER (index 0,
        // sensor rank 10) works out to 15/6, beating DEFENDER_SECURITY
        // (index 2, sensor rank 2, 17/6) even though its sensor rank is far
        // worse, because its empty-column rank (1) is the best of anyone's.
        // Static order would have put ATTACKER first.
        const stack = Array.from({ length: 20 }, (_, i) =>
            makeGear({
                id: `sensor-${i}`,
                slot: 'sensor',
                mainStat: { name: 'crit', value: 25, type: 'percentage' },
                subStats: [{ name: 'critDamage', value: 30, type: 'percentage' }],
            })
        );
        const matrix = buildCoverageMatrix(stack);

        expect(matrix.roleOrder[0]).toBe('DEFENDER');
        expect(matrix.roleOrder[1]).toBe('ATTACKER');
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
