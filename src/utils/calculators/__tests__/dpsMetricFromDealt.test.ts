import { describe, it, expect } from 'vitest';
import { actorsDamagePerRound, focusDamagePerRound, focusDamageTotal } from '../dpsMetricFromDealt';
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

    describe('actorsDamagePerRound (the group form, backing teamDamage)', () => {
        it('sums several attackers into one per-round series', () => {
            const rounds = [
                row(1, { 'team-1': { 'enemy-1': 100 }, 'team-2': { 'enemy-1': 25 } }),
                row(2, { 'team-1': { 'enemy-1': 40, 'enemy-2': 10 } }),
            ];
            expect(actorsDamagePerRound(rounds, ['team-1', 'team-2'])).toEqual([125, 50]);
        });

        it('counts ONLY the listed ids — never "everything that is not the focus"', () => {
            // The whole reason this takes an explicit list: perTargetDealt is keyed by attacker
            // across BOTH sides, so inverting a single focus id (which is safe on the engine's
            // player-credit-only scalar map) would fold the enemy's own output into the player's
            // team aggregate.
            const rounds = [
                row(1, {
                    attacker: { 'enemy-1': 1000 },
                    'team-1': { 'enemy-1': 100 },
                    'enemy-1': { attacker: 7000 },
                }),
            ];
            expect(actorsDamagePerRound(rounds, ['team-1'])).toEqual([100]);
        });

        it('keeps every round slot and tolerates an empty id list', () => {
            const rounds = [row(1, { 'team-1': { 'enemy-1': 100 } }), row(2), row(3, {})];
            expect(actorsDamagePerRound(rounds, ['team-1'])).toEqual([100, 0, 0]);
            expect(actorsDamagePerRound(rounds, [])).toEqual([0, 0, 0]);
        });
    });
});
