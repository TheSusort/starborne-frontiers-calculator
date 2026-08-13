/**
 * Sub-project I, PR I1 — name-specific `enemy-debuff` gating, combat-engine integration.
 *
 * Locks that the LIVE engine now resolves an `enemy-debuff` condition carrying a `buffName`
 * by NAME (via `enemyDebuffNamesForTarget` sourced in `engine.ts:buildTurnArgs`), not by the
 * legacy name-agnostic count. Two ship shapes from the design spec (§3 Pattern A):
 *
 *   - Tygr-shape: "+30% damage to enemies with Stasis or Disable" — a CONTROL/marker debuff,
 *     named via `ownerDebuffNamesFor` (the status-engine's named store).
 *   - Incinerator-shape: "+30% direct damage to enemies afflicted with Inferno" — a DoT,
 *     synthesized as the base-type name 'Inferno' from `infernoEntries.length > 0` (DoTs carry
 *     no name of their own in the named store — see roundContext.ts's landedEnemyDebuffCount
 *     fold and the ConditionContext.enemyDebuffNames doc).
 *
 * Both fixtures fire the SAME active skill every round (damage + the named-debuff inflict +
 * the gated modifier), across 2 rounds:
 *   Round 1 — nothing pre-exists on the target BEFORE this turn → gate reads false → base damage.
 *   Round 2 — the round-1 infliction is still active (long duration) and is read fresh at the
 *             START of round 2 (buildTurnArgs runs BEFORE runPlayerTurn) → gate reads true →
 *             damage is exactly base × 1.30.
 *
 * This also locks the INTENDED causality: a skill's OWN same-turn infliction does not
 * retroactively satisfy its own bonus that turn — only a status that predates the turn does
 * (mirrors how the pre-existing `enemyBuffNames` union is sourced once per turn, before the
 * turn's own effects land).
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';

let idc = 0;
const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `edng${++idc}`,
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

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

// A single positioned, passive (attack:0) enemy — the sole recipient of the focus attacker's
// positional cast. security:0 so any inflict-type debuff always lands (mirrors isStasised.test.ts).
const passiveEnemyAt = (position: Position): EnemyAttacker =>
    ({
        id: 'enemy-front',
        stats: {
            attack: 0,
            crit: 0,
            critDamage: 0,
            defence: 0,
            hp: 1_000_000_000,
            speed: 1,
            security: 0,
        },
        chargeCount: 0,
        startCharged: false,
        position,
        target: parsedTarget('front'),
        pattern: basePattern(),
        shipSkills: { slots: [{ slot: 'active', abilities: [] }] },
    }) as EnemyAttacker;

const engineBase = (shipSkills: ShipSkills): CombatEngineInput => ({
    attack: 10_000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills,
    enemyDefense: 0,
    enemyHp: 1_000_000_000,
    numRounds: 2,
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
    hp: 1_000_000_000,
    // hacking 200 vs enemy security 0 → inflict landing chance clamp((200-0)/100) = 1.0.
    hacking: 200,
    healTargetId: 'attacker',
    mode: 'healing',
    position: 'M4',
    target: parsedTarget('front'),
    pattern: basePattern(),
    enemyAttackers: [passiveEnemyAt('M4')],
});

describe('enemy-debuff name-specific gating (sub-project I, PR I1) — engine integration', () => {
    it('Tygr-shape: "+30% to enemies with Stasis or Disable" gates on the NAMED control debuff', () => {
        idc = 0;
        const skills: ShipSkills = {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        ab({
                            type: 'damage',
                            config: { type: 'damage', multiplier: 180 },
                        }),
                        ab({
                            type: 'debuff',
                            config: {
                                type: 'debuff',
                                buffName: 'Stasis',
                                application: 'inflict',
                                duration: 5,
                                stacks: 1,
                                isStackable: false,
                                parsedEffects: {},
                            },
                        }),
                        ab({
                            target: 'self',
                            type: 'modifier',
                            conditions: [
                                {
                                    subject: 'enemy-debuff',
                                    derivable: true,
                                    buffName: 'Stasis',
                                    anyOf: true,
                                },
                                {
                                    subject: 'enemy-debuff',
                                    derivable: true,
                                    buffName: 'Disable',
                                    anyOf: true,
                                },
                            ],
                            config: {
                                type: 'modifier',
                                channel: 'outgoingDamage',
                                value: 30,
                                isMultiplicative: true,
                            },
                        }),
                    ],
                },
            ],
        };

        const result = runCombat(engineBase(skills));

        expect(result.rounds).toHaveLength(2);
        // Round 1: nothing pre-exists on the target before this turn → gate false → base damage.
        expect(result.rounds[0].perTargetDamage?.['enemy-front']).toBe(18_000); // 10000 * 1.80
        // Round 2: round 1's own Stasis infliction is now pre-existing → gate true → +30%.
        expect(result.rounds[1].perTargetDamage?.['enemy-front']).toBe(23_400); // 18000 * 1.30
    });

    it('name-specificity: an UNRELATED debuff on the target does NOT satisfy a Stasis/Disable gate (the behavior change vs the old count path)', () => {
        idc = 0;
        // Same modifier gate (Stasis OR Disable), but the skill inflicts an unrelated named
        // debuff ('Security Down') instead. Under the OLD name-agnostic count path this landed
        // debuff would satisfy the gate from round 2 on (enemyDebuffCount > 0); under I1's
        // name-specific path it must NOT — the target never carries Stasis or Disable.
        const skills: ShipSkills = {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        ab({ type: 'damage', config: { type: 'damage', multiplier: 180 } }),
                        ab({
                            type: 'debuff',
                            config: {
                                type: 'debuff',
                                buffName: 'Security Down',
                                application: 'inflict',
                                duration: 5,
                                stacks: 1,
                                isStackable: false,
                                parsedEffects: {},
                            },
                        }),
                        ab({
                            target: 'self',
                            type: 'modifier',
                            conditions: [
                                {
                                    subject: 'enemy-debuff',
                                    derivable: true,
                                    buffName: 'Stasis',
                                    anyOf: true,
                                },
                                {
                                    subject: 'enemy-debuff',
                                    derivable: true,
                                    buffName: 'Disable',
                                    anyOf: true,
                                },
                            ],
                            config: {
                                type: 'modifier',
                                channel: 'outgoingDamage',
                                value: 30,
                                isMultiplicative: true,
                            },
                        }),
                    ],
                },
            ],
        };

        const result = runCombat(engineBase(skills));

        expect(result.rounds).toHaveLength(2);
        // Both rounds stay at base damage — the (unrelated) Security Down debuff never satisfies
        // the Stasis/Disable-named gate, even in round 2 when it is live on the target.
        expect(result.rounds[0].perTargetDamage?.['enemy-front']).toBe(18_000);
        expect(result.rounds[1].perTargetDamage?.['enemy-front']).toBe(18_000);
    });

    it('Incinerator-shape: "+30% direct damage to enemies afflicted with Inferno" gates on the synthesized DoT name', () => {
        idc = 0;
        const skills: ShipSkills = {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        ab({
                            type: 'damage',
                            config: { type: 'damage', multiplier: 185 },
                        }),
                        ab({
                            type: 'dot',
                            config: {
                                type: 'dot',
                                dotType: 'inferno',
                                tier: 10,
                                stacks: 1,
                                duration: 5,
                            },
                        }),
                        ab({
                            target: 'self',
                            type: 'modifier',
                            conditions: [
                                { subject: 'enemy-debuff', derivable: true, buffName: 'Inferno' },
                            ],
                            config: {
                                type: 'modifier',
                                channel: 'outgoingDamage',
                                value: 30,
                                isMultiplicative: true,
                            },
                        }),
                    ],
                },
            ],
        };

        const result = runCombat(engineBase(skills));

        expect(result.rounds).toHaveLength(2);
        // perTargetDamage folds the same-round Inferno TICK into the victim total, so isolate
        // the DIRECT hit by subtracting the round's inferno damage.
        const directR1 =
            result.rounds[0].perTargetDamage!['enemy-front'] - result.rounds[0].infernoDamage;
        const directR2 =
            result.rounds[1].perTargetDamage!['enemy-front'] - result.rounds[1].infernoDamage;
        // Round 1: no pre-existing Inferno → gate false → base damage.
        expect(directR1).toBe(18_500); // 10000 * 1.85
        // Round 2: round 1's own Inferno application is now pre-existing → gate true → +30%.
        expect(directR2).toBe(24_050); // 18500 * 1.30
    });
});
