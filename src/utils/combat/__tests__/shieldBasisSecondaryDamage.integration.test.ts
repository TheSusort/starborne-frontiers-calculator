/**
 * shieldBasisSecondaryDamage.integration.test.ts — PR9(a).
 *
 * "additional damage equal to X% of its/their current Shield" (Malvex, Quixilver, FrontLine —
 * see skillTextParser.test.ts's "shield-basis secondary damage (PR9a)" for the text-parsing
 * coverage and buildShipAbilities.test.ts's "PR9a shield-basis additional-damage" for the
 * ability-build coverage). Modeled as `{ type:'additional-damage', stat:'shield', pct }`,
 * consumed in playerTurn.ts (~line 1680) by reading the CASTER's own LIVE `actor.shieldPool`
 * at cast time — the same field the existing I6 shield-strip mechanic reads/writes
 * (lodolitePurgeShieldStrip.integration.test.ts), no new state.
 *
 * Two engine-level facts this file proves that the parser/build-level tests cannot:
 *   1. The basis is read LIVE, cast-by-cast — not a static snapshot. A caster whose
 *      shieldPool grows round-over-round (via its own self-shield-grant ability) sees its
 *      OWN additional-damage contribution grow in lockstep, one round later (the secondary
 *      damage for round N uses the shieldPool as it stood BEFORE round N's own grant —
 *      "current Shield" is a pre-cast snapshot, not a same-round moving target).
 *   2. Team symmetry: an ENEMY-sourced shield-basis additional-damage ability contributes
 *      real extra damage against a player victim, identically to the player-side mechanism.
 *
 * Harness mirrors lodolitePurgeShieldStrip.integration.test.ts (positional two-team
 * battle-sim, ability injected directly, healTargetId:'attacker' to activate the
 * healing-gated self-shield-grant block so the caster's OWN shieldPool actually grows —
 * see that file's header for why `healTargetId` is the switch, and cobaltStartOfTurnCharge
 * .integration.test.ts for the same "self as heal target for live-state threading" idiom).
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';
import type { CombatActor } from '../state';
import { bareEnemy, BARE_ENEMY_ID } from '../__testutils__/bareRosterFixture';

let idc = 0;
const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `sbd${++idc}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...p,
});

const parsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });

const damageAbility = (multiplier: number): Ability =>
    ab({ type: 'damage', target: 'enemy', config: { type: 'damage', multiplier } });

const shieldBasisAdditionalDamage = (pct: number): Ability =>
    ab({
        type: 'additional-damage',
        target: 'enemy',
        config: { type: 'additional-damage', stat: 'shield', pct },
    });

// Self-shield (50% of max HP), same shape as enemyOnCastShield.integration.test.ts /
// lodolitePurgeShieldStrip.integration.test.ts's selfShield fixture.
const selfShield = (pct: number): Ability =>
    ab({
        type: 'shield',
        target: 'self',
        config: { type: 'shield', pct, basis: 'hp' },
    });

// Attack 10000, crit 0 (no crit variance), the enemy's own `stats.defence` 0, defensePenetration 0,
// no buffs — postDefenseFactor collapses to 1, so the credited damage is
// effectiveAttack*(mult/100) + secondaryStatValue exactly (no cross-term arithmetic to untangle).
//
// SP-4b-2b: `satisfies` replaces the old `: Partial<CombatEngineInput>` annotation, and every
// `runCombat` call below drops its `as CombatEngineInput` cast. That cast is why this file was in
// the missing-roster population at all: `enemyAttackers` is a REQUIRED field on
// `CombatEngineInput`, and an `as` cast over a spread of a `Partial` told the compiler to stop
// looking. `satisfies` keeps the assignability check on this literal while leaving its keys
// REQUIRED in the spread, so each call site now has to name `enemyAttackers` itself — and the
// compiler, not a runtime guard, is what enforces it.
const CLEAN_MATH = {
    attack: 10000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    enemyDefense: 0,
    enemyHp: 1_000_000_000,
    selfBuffs: [],
    enemyDebuffs: [],
    selfDotModifier: 0,
    defensePenetrationBuff: 0,
    hasChargedSkill: false,
    startCharged: false,
    affinityDamageModifier: 0,
    affinityCritCap: 100,
    affinityCritPenalty: 0,
    defence: 0,
    hp: 100_000,
    position: 'M4',
    target: parsedTarget('front'),
    pattern: basePattern(),
} satisfies Partial<CombatEngineInput>;

describe('PR9a: shield-basis additional damage reads the LIVE caster shieldPool at cast time', () => {
    it('round 1 (shieldPool starts at 0): additional-damage contributes ZERO; round 2 (after the round-1 self-grant): it reflects the grown pool', () => {
        const shipSkills: ShipSkills = {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        selfShield(50), // grants 50% of 100,000 max HP = 50,000 shield per cast
                        shieldBasisAdditionalDamage(20), // 20% of current shield
                        damageAbility(100), // 100% of attack = 10,000 base
                    ],
                },
            ],
        };
        const result = runCombat({
            ...CLEAN_MATH,
            // SP-4b-2b: a real opponent. 10 000 + 20 000 = 30 000 total against 10 000 000 HP, so it
            // survives both rounds and the run's shape is constant (a mid-run kill would drop the
            // round-2 cast entirely, which is exactly what this test measures).
            enemyAttackers: bareEnemy({ stats: { hp: 10_000_000 } }),
            shipSkills,
            numRounds: 2,
            healTargetId: 'attacker', // self-heal-target: activates the self-shield-grant block
            mode: 'healing',
        });
        // M3 (SP-4b-2b): the focus's credit now lands in the per-victim channel, so these read
        // `perTargetDealt` instead of the scalar `directDamage` — which is 0 on every positional
        // direct `runCombat` and would have made both assertions vacuous. The MAGNITUDES are
        // unchanged from the pre-branch `directDamage` readings (10 000 / 20 000), which is the point:
        // `stats.defence: 0` on the roster entry carries the old `enemyDefense: 0` scalar, so
        // postDefenseFactor still collapses to 1.
        const dealt = (round: number) =>
            result.rounds[round].perTargetDealt?.attacker?.[BARE_ENEMY_ID];
        // Round 1: shieldPool is 0 before any grant → base only.
        expect(dealt(0)).toBe(10000);
        // Round 2: shieldPool is 50,000 (from round 1's grant, applied AFTER round 1's own
        // secondary-damage read) → 10,000 base + 20% of 50,000 = 10,000 + 10,000 = 20,000.
        expect(dealt(1)).toBe(20000);
    });

    it('CONTROL: without the self-shield ability, shieldPool never grows — additional-damage stays ZERO every round', () => {
        const shipSkills: ShipSkills = {
            slots: [
                {
                    slot: 'active',
                    abilities: [shieldBasisAdditionalDamage(20), damageAbility(100)],
                },
            ],
        };
        const result = runCombat({
            ...CLEAN_MATH,
            enemyAttackers: bareEnemy({ stats: { hp: 10_000_000 } }),
            shipSkills,
            numRounds: 3,
            healTargetId: 'attacker',
            mode: 'healing',
        });
        // M3, same as above: same three 10 000s, read out of the per-victim channel.
        expect(result.rounds.map((r) => r.perTargetDealt?.attacker?.[BARE_ENEMY_ID])).toEqual([
            10000, 10000, 10000,
        ]);
    });
});

describe('PR9a: team symmetry — an ENEMY-sourced shield-basis additional-damage ability deals real extra damage to a player victim', () => {
    // The focus ("attacker") is a pure punching bag: high HP, no offense-relevant kit, and is
    // its own heal target (healTargetId) so its live HP is threaded — irrelevant here but keeps
    // the harness aligned with the player-side describe block's healing-mode activation, which
    // is what lets the ENEMY's self-shield ability actually grow the enemy's OWN shieldPool.
    const punchingBagSkills: ShipSkills = {
        slots: [{ slot: 'active', abilities: [damageAbility(0)] }],
    };

    const makeEnemy = (includeSelfShield: boolean) => ({
        id: 'enemy-front',
        stats: { attack: 10000, crit: 0, critDamage: 0, defence: 0, hp: 100_000, speed: 50 },
        chargeCount: 0,
        startCharged: false,
        position: 'M4' as Position,
        target: parsedTarget('front'),
        pattern: basePattern(),
        shipSkills: {
            slots: [
                {
                    slot: 'active' as const,
                    abilities: [
                        ...(includeSelfShield ? [selfShield(50)] : []),
                        shieldBasisAdditionalDamage(20),
                        damageAbility(100),
                    ],
                },
            ],
        },
    });

    const runScenario = (includeSelfShield: boolean) => {
        let captured: CombatActor[] = [];
        runCombat({
            ...CLEAN_MATH,
            attack: 0, // the focus deals no damage itself — isolates the enemy's contribution
            hp: 1_000_000_000, // the focus survives both rounds regardless
            shipSkills: punchingBagSkills,
            numRounds: 2,
            healTargetId: 'attacker',
            mode: 'healing',
            enemyAttackers: [makeEnemy(includeSelfShield)],
            __testTapActors: (actors) => {
                captured = actors;
            },
        });
        const focus = captured.find((a) => a.id === 'attacker')!;
        return focus.currentHp;
    };

    it("the enemy caster's OWN shieldPool grows via its self-shield ability (same field the I6 strip mechanic reads/writes)", () => {
        let captured: CombatActor[] = [];
        runCombat({
            ...CLEAN_MATH,
            attack: 0,
            hp: 1_000_000_000,
            shipSkills: punchingBagSkills,
            numRounds: 2,
            healTargetId: 'attacker',
            mode: 'healing',
            enemyAttackers: [makeEnemy(true)],
            __testTapActors: (actors) => {
                captured = actors;
            },
        });
        const enemy = captured.find((a) => a.id === 'enemy-front')!;
        expect(enemy.shieldPool).toBeGreaterThan(0);
    });

    it('the focus takes STRICTLY MORE cumulative damage when the enemy caster has the self-shield ability (its round-2 additional-damage is nonzero) than the control (no self-shield, additional-damage stays 0)', () => {
        const withShieldGrant = runScenario(true);
        const withoutShieldGrant = runScenario(false);
        expect(withShieldGrant).toBeLessThan(withoutShieldGrant);
        // Exact delta: round 2's extra 20% of 50,000 = 10,000 (round 1 contributes 0 either way).
        expect(withoutShieldGrant - withShieldGrant).toBe(10000);
    });
});
