/**
 * SP-4b-1 §4B — a cast's damage must land in EXACTLY ONE accounting channel.
 *
 * The engine has two damage-accounting channels and they are mutually exclusive by design:
 *   • the per-victim POSITIONAL channel — `RoundData.perTargetDealt` (source → victim → dealt),
 *     written by `drivePositionalApply` → `creditDealt`;
 *   • the LEGACY scalar sink — `rawTotals` / `cumulativeDamage`, written by `creditDamage`
 *     against the dummy `enemy` actor.
 *
 * Which one a cast uses is decided TWICE, and until this file existed the two decisions could
 * disagree:
 *   • VICTIM SELECTION (`selectTurnTarget` → `resolvePositionalTarget`) is liveness-aware: it
 *     only ever returns an opposing actor with `currentHp > 0`, else it hands back the legacy
 *     victim (and bumps `legacyVictimFallbackCount`);
 *   • the APPLY GATE (`isPositional(...) && target && pattern && turn.positionalScalars`) was
 *     purely STRUCTURAL — "does any opposing actor carry a board position?" — and a position
 *     survives its owner's death.
 *
 * Before the SP-4b-1 normalization boundary, "no positions anywhere" was the de-facto proxy for
 * "this roster is a pressure source, not a target roster", so the two decisions happened to agree.
 * Normalization auto-places every actor, which destroyed that proxy: a roster of 0-max-HP pressure
 * sources now reads as positional, the gate goes positional, selection finds nobody, the
 * per-victim apply books nothing, and the legacy credit is suppressed because "the positional
 * branch was taken". The cast's damage was credited to NEITHER channel and simply vanished.
 *
 * The fix makes the gate ask the same question selection asks: a positioned opposing actor counts
 * as a positional ROSTER only if it is a viable target at all (`stats.hp > 0`). That leaves
 * exactly one legitimate "neither channel" state — a roster that WAS targetable and has since
 * been killed, where the cast is a deliberate whiff against a corpse (pinned by
 * `deathFallback.integration.test.ts` and re-pinned here as the ONLY such state).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
    runCombat,
    __getLegacyVictimFallbackCount,
    __resetLegacyVictimFallbackCount,
} from '../engine';
import type { CombatEngineInput } from '../engine';
import { setupKeyedTestRng } from '../../calculators/rateAccumulator';
import { bareInput, bareEnemy } from '../__testutils__/bareRosterFixture';
import type { RoundData } from '../../calculators/dpsSimulator';

const ROUNDS = 4;
/** `bareInput` fires one 100%-multiplier damage ability off a 10 000 attack, zero crit. */
const PER_CAST = 10_000;

/** The shared bare roster with the sole enemy attacker's MAX HP dialled to `hp`. */
const rosterWithEnemyHp = (hp: number): CombatEngineInput => {
    const enemies = bareEnemy();
    enemies[0].stats.hp = hp;
    return { ...bareInput(), numRounds: ROUNDS, enemyAttackers: enemies };
};

const noRoster = (): CombatEngineInput => ({
    ...bareInput(),
    numRounds: ROUNDS,
    enemyAttackers: [],
});

/** Total booked into the PER-VICTIM channel for one round. */
const positionalIn = (round: RoundData): number =>
    Object.values(round.perTargetDealt ?? {})
        .flatMap((byVictim) => Object.values(byVictim))
        .reduce((sum, amount) => sum + amount, 0);

/** Total booked into the LEGACY scalar channel for one round. */
const legacyIn = (round: RoundData): number => round.directDamage;

describe('SP-4b-1 §4B — damage is never credited to neither channel', () => {
    beforeEach(() => {
        setupKeyedTestRng(12345);
        __resetLegacyVictimFallbackCount();
    });

    it('a roster of 0-max-HP pressure sources credits every cast to the LEGACY sink', () => {
        // The 12 bucket-4B fixtures all look like this: an enemy attacker declared purely as a
        // SOURCE of pressure (`hp: 0`), never as something to hit. It can never be a victim, so
        // the run is not positional and the dummy sink owns the offense — exactly what these
        // callers got before normalization started auto-placing the roster.
        const result = runCombat(rosterWithEnemyHp(0));

        expect(result.rawTotals.cumulative).toBe(ROUNDS * PER_CAST);
        expect(result.rawTotals.direct).toBe(ROUNDS * PER_CAST);
        // ...and NOT also into the per-victim channel (never two channels).
        expect(result.rounds.map(positionalIn)).toEqual([0, 0, 0, 0]);
    });

    it('an EMPTY opposing roster credits every cast to the LEGACY sink', () => {
        const result = runCombat(noRoster());

        expect(result.rawTotals.cumulative).toBe(ROUNDS * PER_CAST);
        expect(result.rounds.map(positionalIn)).toEqual([0, 0, 0, 0]);
    });

    it('a LIVING positioned roster credits every cast to the PER-VICTIM channel', () => {
        const result = runCombat(rosterWithEnemyHp(500_000));

        expect(result.rounds.map(positionalIn)).toEqual([PER_CAST, PER_CAST, PER_CAST, PER_CAST]);
        // ...and NOT also into the legacy sink.
        expect(result.rawTotals.cumulative).toBe(0);
        expect(__getLegacyVictimFallbackCount()).toBe(0);
    });

    it('killing a targetable roster mid-run whiffs — the ONE legitimate neither-channel state', () => {
        // 5 000 HP dies to the round-1 cast. Rounds 2-4 have nothing living to hit, so they are a
        // deliberate no-op against a corpse (see deathFallback.integration.test.ts). This is the
        // ONLY shape allowed to book into neither channel, and it books because the cast DEALT
        // nothing — not because an accounted-for number was dropped between the two.
        const result = runCombat(rosterWithEnemyHp(5_000));

        expect(result.rounds.map(positionalIn)).toEqual([PER_CAST, 0, 0, 0]);
        expect(result.rawTotals.cumulative).toBe(0);
    });

    it('INVARIANT: across every roster shape, no round books into both channels, and a round with a living victim books into one', () => {
        // The third state — "neither channel while a living victim existed" — is the SP-4b-1 §4B
        // defect. Pinned here directly so a future gate/selection divergence cannot reintroduce it.
        const shapes: ReadonlyArray<{ name: string; input: () => CombatEngineInput }> = [
            { name: 'no roster', input: noRoster },
            { name: '0-max-HP pressure source', input: () => rosterWithEnemyHp(0) },
            { name: 'dies in round 1', input: () => rosterWithEnemyHp(5_000) },
            { name: 'survives every round', input: () => rosterWithEnemyHp(500_000) },
        ];

        for (const shape of shapes) {
            setupKeyedTestRng(12345);
            __resetLegacyVictimFallbackCount();
            const result = runCombat(shape.input());

            // A living victim exists for a round iff the enemy has not yet been destroyed.
            let livingVictimRounds = 0;
            result.rounds.forEach((round, index) => {
                const positional = positionalIn(round);
                const legacy = legacyIn(round);

                // NEVER TWO.
                expect(
                    positional > 0 && legacy > 0,
                    `${shape.name} round ${index + 1} booked into BOTH channels (positional ${positional}, legacy ${legacy})`
                ).toBe(false);

                if (positional > 0 || legacy > 0) livingVictimRounds++;
            });

            // NEVER ZERO while something was there to hit. Every shape but the mid-run kill has a
            // channel in all four rounds; the mid-run kill has exactly one (its kill round).
            const expectedBookedRounds = shape.name === 'dies in round 1' ? 1 : ROUNDS;
            expect(livingVictimRounds, `${shape.name}: rounds that booked into a channel`).toBe(
                expectedBookedRounds
            );

            // The whole cast output is accounted for: nothing between the channels.
            const total =
                result.rounds.reduce((sum, round) => sum + positionalIn(round), 0) +
                result.rawTotals.cumulative;
            expect(total, `${shape.name}: total accounted damage`).toBe(
                expectedBookedRounds * PER_CAST
            );
        }
    });
});
