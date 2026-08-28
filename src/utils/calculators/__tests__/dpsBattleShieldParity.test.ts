/**
 * #415: the start-of-turn shield grant that
 * `xcellenceOnResistShieldDamage.integration.test.ts` pins in BATTLE mode must now also land in
 * DPS mode. Before #415 the DPS arm reported `perActorShield: null` on every round while that
 * shipped battle test asserted exact compounding — the shipped test was the positive control that
 * proved the DPS side was dead rather than merely quiet.
 *
 * The battle arm is NOT re-driven here: `simulateBattle` builds its own event bus and ignores an
 * injected one, so a hand-rolled battle arm reads as agreement no matter what. The shipped
 * integration test is the battle arm; this file is the DPS half of the same claim.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { simulateDPS } from '../dpsSimulator';
import { setupKeyedTestRng } from '../rateAccumulator';
import { baseInput, damageKit } from '../__testutils__/dpsRealEnemyFixture';
import type { ShipSkills } from '../../../types/abilities';

/** Same max HP the battle-arm integration test uses, so the 20% grants are comparable. */
const CARRIER_HP = 1_000_000;

/** A passive-slot start-of-turn shield grant of 20% max HP — the mechanic the battle arm pins. */
const startOfTurnShieldKit = (): ShipSkills => ({
    slots: [
        { slot: 'active', abilities: damageKit().slots[0].abilities },
        {
            slot: 'passive',
            abilities: [
                {
                    id: 'sot1',
                    type: 'shield',
                    target: 'self',
                    trigger: 'start-of-turn',
                    conditions: [],
                    config: { type: 'shield', pct: 20, basis: 'hp' },
                },
            ],
        },
    ],
});

describe('#415 the battle arm’s shield grant now lands in DPS mode too', () => {
    beforeEach(() => setupKeyedTestRng(12345));

    it('grants 20% of max HP per round and compounds the pool', () => {
        const { rounds } = simulateDPS(
            baseInput({ shipSkills: startOfTurnShieldKit(), hp: CARRIER_HP, rounds: 3 })
        );
        const step = CARRIER_HP * 0.2;
        expect(rounds.map((r) => r.perActorShield?.attacker?.granted ?? 0)).toEqual([
            step,
            step,
            step,
        ]);
        // Nothing drains the pool at the 0-attack default, so it ratchets — the same compounding
        // the battle-arm test asserts.
        expect(rounds.map((r) => r.perActorShield?.attacker?.pool ?? 0)).toEqual([
            step,
            step * 2,
            step * 3,
        ]);
    });
});
