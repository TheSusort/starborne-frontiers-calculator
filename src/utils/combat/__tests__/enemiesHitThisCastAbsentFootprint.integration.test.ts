/**
 * Fix wave 1 — pins the DELEGATE half of the `enemies-hit-this-cast` fix, not just the
 * consumer half.
 *
 * Context: the SP-4d rung's job was to make `enemies-hit-this-cast` answer "unknown" instead of
 * a fabricated 1 for an owner with no recorded cast footprint. The consumer
 * (`buildDrainContext`, triggers.ts) was correctly changed to drop its `?? 1` default — but the
 * DELEGATE that feeds it (`engine.ts`'s `enemiesHitThisCastFor`) still returned
 * `enemiesHitThisCastByActor.get(ownerId) ?? 1`, so production never actually stopped fabricating
 * the 1; only a fixture that supplied NO delegate at all could observe `undefined`. Every
 * existing gate test (`enemiesHitGate.integration.test.ts`) exercises a REAL cast (Berserker's
 * splash), so the footprint is always present by the time the gate is read — none of them can
 * distinguish "delegate returns undefined" from "delegate returns a fabricated 1", because the
 * map always has an entry in those scenarios.
 *
 * This test targets the one place an owner's footprint is GUARANTEED absent while still running
 * the real production delegate: a `start-of-round` reactive drain, which fires (`round-started`)
 * BEFORE any turn resolves this combat (engine.ts's "Drain point (a)"). At that instant
 * `enemiesHitThisCastByActor` has no entry for the focus actor at all — not "hit nobody" (which
 * SP-4d Task 8 later made book an honest 0, closing that separate residual — see
 * `noVictimResidualTripwires.test.ts`), but never-set.
 *
 * The gate uses `lte 1`: a phantom 1 SATISFIES it (1 <= 1 → met), but an honest absent answer
 * (`undefined`) does not (`evaluateConditions`'s absent-subject guard returns false before the
 * comparator ever runs). The gated payload is a start-of-round self Attack Up that couples into
 * the SAME round's own damage (mirrors `lowestSpeedAlly.test.ts`'s harness) — a wrongly-granted
 * buff doubles the focus's round-1 payout from 10000 to 20000, an unambiguous, easy-to-read
 * signal that needs no internal engine hooks.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { Ability, ShipSkills } from '../../../types/abilities';
import { bareEnemy } from '../__testutils__/bareRosterFixture';
import { dealtBy } from '../__testutils__/perTargetDealt';

let idc = 0;
const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `efa${++idc}`,
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    ...p,
});

const skill = (): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                ab({
                    type: 'damage',
                    target: 'enemy',
                    config: { type: 'damage', multiplier: 100 },
                }),
                ab({
                    type: 'buff',
                    target: 'self',
                    trigger: 'start-of-round',
                    conditions: [
                        {
                            subject: 'enemies-hit-this-cast',
                            derivable: true,
                            countComparator: 'lte',
                            countThreshold: 1,
                        },
                    ],
                    config: {
                        type: 'buff',
                        buffName: 'Attack Up',
                        parsedEffects: { attack: 100 },
                        stacks: 1,
                        isStackable: false,
                        duration: 99,
                    },
                }),
            ],
        },
    ],
});

const BASE = (o: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
    enemyAttackers: bareEnemy({ stats: { hp: 10_000_000 } }),
    attack: 10000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: skill(),
    numRounds: 1,
    selfBuffs: [],
    enemyDebuffs: [],
    selfDotModifier: 0,
    defensePenetrationBuff: 0,
    hasChargedSkill: false,
    startCharged: false,
    affinityDamageModifier: 0,
    affinityCritCap: 100,
    affinityCritPenalty: 0,
    defence: 2000,
    hp: 1_000_000,
    ...o,
});

describe('SP-4d Fix wave 1: enemies-hit-this-cast reads UNKNOWN (not a phantom 1) before any cast', () => {
    it('round-1 start-of-round drain, before the focus has ever cast — an `lte 1` gate a phantom 1 would satisfy does NOT fire off the absent footprint', () => {
        idc = 0;
        const r = runCombat(BASE());
        // Base 100% hit for 10000 attack = 10000 dealt. If the gate wrongly fired, the start-of-
        // round Attack Up (+100%) would double this to 20000.
        expect(dealtBy(r.rounds, 'attacker')).toBe(10000);
    });
});
