import { describe, it, expect } from 'vitest';
import { calculateTotalStats } from '../../../ship/statsCalculator';
import { buildGearRegistry } from '../gearRegistry';
import { STAT_INDEX, STAT_COUNT } from '../../../fastScoring/statVector';
import {
    withAssumedCalibration,
    makeAssumedCalibrationGetter,
} from '../../../gear/assumedCalibration';
import { GearPiece } from '../../../../types/gear';
import { TEST_BASE_STATS, makeTestShip } from './fixtures/testInventory';

function makeWeapon(overrides: Partial<GearPiece> = {}): GearPiece {
    return {
        id: 'w-1',
        slot: 'weapon',
        level: 16,
        stars: 6,
        rarity: 'legendary',
        mainStat: { name: 'attack', value: 1000, type: 'flat' },
        subStats: [],
        setBonus: null,
        ...overrides,
    };
}

const SHIP_ID = 'ship-1';
const ship = makeTestShip({ id: SHIP_ID, equipment: { weapon: 'w-1' } });

/** Attack contributed by gear alone, via the slow path. */
function slowPathAttack(piece: GearPiece): number {
    const stats = calculateTotalStats(
        ship.baseStats,
        { weapon: 'w-1' },
        () => piece,
        [],
        {},
        undefined,
        SHIP_ID
    );
    return stats.afterGear.attack - stats.afterEngineering.attack;
}

/** Attack contributed by gear alone, via the fast path's precomputed registry. */
function fastPathAttack(piece: GearPiece): number {
    const reg = buildGearRegistry([piece], TEST_BASE_STATS, SHIP_ID);
    return reg.statBuffer[reg.idOf.get(piece.id)! * STAT_COUNT + STAT_INDEX.attack];
}

describe('assumed calibration: fast/slow parity', () => {
    it('agree on an uncalibrated piece with the mode OFF', () => {
        const piece = makeWeapon();
        expect(fastPathAttack(piece)).toBe(slowPathAttack(piece));
        expect(slowPathAttack(piece)).toBe(1000);
    });

    it('agree on an uncalibrated piece with the mode ON', () => {
        const piece = withAssumedCalibration(makeWeapon(), false);
        expect(fastPathAttack(piece)).toBe(slowPathAttack(piece));
        expect(slowPathAttack(piece)).toBe(2000);
    });

    it('agree on a piece calibrated to THIS ship with the mode ON — no double bonus', () => {
        const piece = withAssumedCalibration(
            makeWeapon({ calibration: { shipId: SHIP_ID } }),
            false
        );
        expect(fastPathAttack(piece)).toBe(slowPathAttack(piece));
        // 2000, not 4000: the transform stripped the metadata so neither
        // consumer re-applies the bonus on top.
        expect(slowPathAttack(piece)).toBe(2000);
    });

    it('agree on a piece calibrated ELSEWHERE with the mode ON', () => {
        const piece = withAssumedCalibration(
            makeWeapon({ calibration: { shipId: 'some-other-ship' } }),
            false
        );
        expect(fastPathAttack(piece)).toBe(slowPathAttack(piece));
        expect(slowPathAttack(piece)).toBe(2000);
    });
});

describe('assumed calibration: mode OFF is a no-op', () => {
    it('leaves an uncalibrated piece at its base value', () => {
        expect(slowPathAttack(makeWeapon())).toBe(1000);
    });

    it('still applies the REAL bonus to a piece calibrated to this ship', () => {
        // The mode being off must not disturb existing calibration handling.
        expect(slowPathAttack(makeWeapon({ calibration: { shipId: SHIP_ID } }))).toBe(2000);
    });

    it('still ignores a piece calibrated to another ship', () => {
        expect(slowPathAttack(makeWeapon({ calibration: { shipId: 'other' } }))).toBe(1000);
    });
});

describe('assumed calibration: composition with upgraded stats', () => {
    it('calibrates the simulated level-16 value, not the level-0 one', () => {
        const raw = makeWeapon({
            id: 'w-2',
            level: 0,
            mainStat: { name: 'attack', value: 300, type: 'flat' },
        });
        const upgradedGetter = (_id: string): GearPiece => ({
            ...raw,
            mainStat: { name: 'attack', value: 1200, type: 'flat' },
        });
        const getter = makeAssumedCalibrationGetter(upgradedGetter, true);
        expect(getter('w-2')?.mainStat?.value).toBe(2400);
    });
});
