import { describe, it, expect } from 'vitest';
import { focusDamagePerRound, focusDamageTotal } from '../dpsMetricFromDealt';
import type { RoundData } from '../dpsSimulator';

const row = (round: number, dealt?: Record<string, Record<string, number>>): RoundData =>
    ({ round, perTargetDealt: dealt }) as unknown as RoundData;

describe('dpsMetricFromDealt', () => {
    it('sums every victim this attacker hit in a round', () => {
        const rounds = [row(1, { attacker: { 'enemy-1': 100, 'enemy-2': 50 } })];
        expect(focusDamagePerRound(rounds, 'attacker')).toEqual([150]);
    });

    it('ignores damage dealt by other attackers', () => {
        const rounds = [row(1, { attacker: { 'enemy-1': 100 }, ally: { 'enemy-1': 999 } })];
        expect(focusDamagePerRound(rounds, 'attacker')).toEqual([100]);
    });

    it('treats a round with no entry as zero rather than dropping the round', () => {
        // Index alignment with `rounds` is load-bearing: the caller zips these back onto the rows.
        const rounds = [row(1, { attacker: { 'enemy-1': 100 } }), row(2), row(3, {})];
        expect(focusDamagePerRound(rounds, 'attacker')).toEqual([100, 0, 0]);
    });

    it('totals across rounds', () => {
        const rounds = [
            row(1, { attacker: { 'enemy-1': 100 } }),
            row(2, { attacker: { 'enemy-1': 250 } }),
        ];
        expect(focusDamageTotal(rounds, 'attacker')).toBe(350);
    });

    it('returns an empty list and a zero total for no rounds', () => {
        expect(focusDamagePerRound([], 'attacker')).toEqual([]);
        expect(focusDamageTotal([], 'attacker')).toBe(0);
    });
});
