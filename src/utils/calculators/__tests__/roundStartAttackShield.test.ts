/**
 * A `start-of-round` self shield sized off ATTACK is honoured end-to-end by the engine.
 *
 * Both halves of that sentence are unexercised by the rest of the corpus: every other reactive
 * shield rides `start-of-turn` / `pre-combat` / a damage reaction, and every one of them is
 * hp- or damage-basis. This file is the positive control for the pair — the `basis: 'attack'`
 * arm of the reactive heal/shield executor (`triggers.ts`) and the `round-started` listener
 * (`start-of-round` in LIVE_TRIGGERS) meeting on one ability.
 *
 * Mirrors `dpsBattleShieldParity.test.ts`'s passive-slot shape, which routes through
 * `partitionReactiveAbilities` → bus registration → the reactive executor, NOT the inline cast
 * path.
 *
 * THE FOCUS TAKES TWO TURNS A ROUND (a once-per-round extra action), and that is what makes the
 * TRIGGER axis non-vacuous. With one turn a round, `start-of-round` and `on-cast` grant the same
 * amount on the same rounds and the assertions below hold for either — measured. At two turns a
 * round the cast-path grant doubles and the round-boundary grant does not.
 *
 * The attack sweep is the second axis: an hp-basis regression would hold the grant flat at
 * 50% of 1,000,000 across both runs instead of tracking attack.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { simulateDPS } from '../dpsSimulator';
import { setupKeyedRng } from '../rateAccumulator';
import { baseInput, damageKit } from '../__testutils__/dpsRealEnemyFixture';
import type { ShipSkills } from '../../../types/abilities';

/** Zenith R4's refit-active passive clause: "At the start of each round this Unit gains a shield
 *  equal to 50% of its attack" — the shape `buildShipAbilities` builds from the CSV row. The
 *  extra action belongs to the harness, not to Zenith. */
const roundStartAttackShieldKit = (): ShipSkills => ({
    slots: [
        { slot: 'active', abilities: damageKit().slots[0].abilities },
        {
            slot: 'passive',
            abilities: [
                {
                    id: 'sor1',
                    type: 'shield',
                    target: 'self',
                    trigger: 'start-of-round',
                    conditions: [],
                    config: { type: 'shield', pct: 50, basis: 'attack' },
                },
                {
                    id: 'sor2',
                    type: 'extra-action',
                    target: 'self',
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'extra-action', oncePerRound: true },
                },
            ],
        },
    ],
});

describe('start-of-round self shield, attack basis', () => {
    beforeEach(() => setupKeyedRng(12345));

    it('grants 50% of attack ONCE per round even though the focus acts twice', () => {
        const { rounds } = simulateDPS(
            baseInput({ shipSkills: roundStartAttackShieldKit(), attack: 10_000, rounds: 3 })
        );
        expect(rounds.map((r) => r.perActorShield?.attacker?.granted ?? 0)).toEqual([
            5_000, 5_000, 5_000,
        ]);
        // Nothing drains a DPS-mode focus's own pool, so it ratchets by exactly one grant a round.
        expect(rounds.map((r) => r.perActorShield?.attacker?.pool ?? 0)).toEqual([
            5_000, 10_000, 15_000,
        ]);
    });

    it('the grant tracks ATTACK, not max HP', () => {
        const { rounds } = simulateDPS(
            baseInput({ shipSkills: roundStartAttackShieldKit(), attack: 20_000, rounds: 3 })
        );
        expect(rounds.map((r) => r.perActorShield?.attacker?.granted ?? 0)).toEqual([
            10_000, 10_000, 10_000,
        ]);
    });
});

/**
 * `ally-shield-count` in DPS mode. Selenite's sibling subject (`enemy-stealth-count`) reads 0 in a
 * DPS run and that is faithful for her — nothing there carries Stealth. It is NOT faithful here:
 * Zenith counts itself and shields itself at the start of every round, so a 0 would report it a
 * full step weaker in the DPS calculator than a solo fight actually plays. The engine therefore
 * supplies the live count in every mode, and this is the measurement that says so.
 */
describe('ally-shield-count in DPS mode', () => {
    beforeEach(() => setupKeyedRng(12345));

    const shieldPlusCountKit = (selfShield: boolean): ShipSkills => ({
        slots: [
            {
                slot: 'active',
                abilities: [
                    ...damageKit().slots[0].abilities,
                    {
                        id: 'mod1',
                        type: 'modifier',
                        target: 'self',
                        trigger: 'on-cast',
                        conditions: [{ subject: 'ally-shield-count', derivable: true }],
                        scaling: { conditionIndex: 0, perUnit: 8 },
                        config: {
                            type: 'modifier',
                            channel: 'outgoingDamage',
                            value: 0,
                            isMultiplicative: true,
                        },
                    },
                ],
            },
            {
                slot: 'passive',
                abilities: selfShield
                    ? [
                          {
                              id: 'sor1',
                              type: 'shield',
                              target: 'self',
                              trigger: 'start-of-round',
                              conditions: [],
                              config: { type: 'shield', pct: 50, basis: 'attack' },
                          },
                      ]
                    : [],
            },
        ],
    });

    const roundOneDirect = (selfShield: boolean): number =>
        simulateDPS(baseInput({ shipSkills: shieldPlusCountKit(selfShield), rounds: 1 })).rounds[0]
            .directDamage;

    it('the focus counts its OWN round-start shield from round 1 — the grant precedes the turn', () => {
        // Same kit, same seed; the only difference is whether the passive grants the shield.
        // Compared as a RATIO: `RoundData.directDamage` is rounded to whole points, so the two
        // absolute figures cannot agree to more than a point.
        expect(roundOneDirect(true) / roundOneDirect(false)).toBeCloseTo(1.08, 3);
    });
});
