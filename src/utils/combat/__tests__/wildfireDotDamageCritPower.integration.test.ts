/**
 * Sub-project I, PR I4a — Wildfire's `dotDamage`-channel crit-power scaling, combat-engine
 * integration.
 *
 * Locks the FOUNDATION shape: "when an enemy has Scorching Radiation, this Unit deals N%
 * additional Inferno damage to that unit for every 10% crit power" — a `dotDamage` modifier
 * gated on the NAMED enemy debuff (reusing I1's name-specific `enemy-debuff` gating, same as
 * Incinerator/Tygr) and SCALED by the caster's own live crit power (the new 'self-crit-power'
 * condition subject, evaluateConditions.ts).
 *
 * I4a SCOPE (single-target / cast-time approximation, per the sub-project I design doc §9):
 *   - The gate is evaluated ONCE per cast against the primary target's modifierCtx (mirrors
 *     the Incinerator/Tygr I1 integration test: round 1 has nothing pre-existing on the
 *     target BEFORE this turn → gate false; round 2 reads round 1's own infliction as
 *     pre-existing → gate true).
 *   - Per-tick / per-victim(AoE) re-evaluation is I4b; distributing the bonus to OTHER
 *     allies (the refit-3 "all allies deal…" team-aura text) is I4c. NEITHER is exercised
 *     here — this test only proves the single-target, single-caster foundation.
 *
 * Comparison strategy: two runs with IDENTICAL DoT application/stacking dynamics (same
 * active skill firing the same debuff + dot abilities every round) — one WITH the new
 * dotDamage-scaling modifier ability, one WITHOUT. Because both runs apply the exact same
 * DoT entries each round, any difference in `infernoDamage` is attributable ONLY to the
 * modifier's dotMult delta — sidestepping cross-round DoT-stacking arithmetic entirely.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';

let idc = 0;
const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `wfdp${++idc}`,
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
// positional cast. security:0 so the Scorching Radiation debuff-inflict always lands.
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

// critDamage: 150 — the caster's own crit power. With perUnit 0.1 (Wildfire's base passive,
// "1% additional … for every 10% crit power") the scaling contributes 150 * 0.1 = +15%.
const engineBase = (shipSkills: ShipSkills): CombatEngineInput => ({
    attack: 10_000,
    crit: 0,
    critDamage: 150,
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
    position: 'M4',
    target: parsedTarget('front'),
    pattern: basePattern(),
    enemyAttackers: [passiveEnemyAt('M4')],
});

/** Shared payload abilities: a plain hit + a Scorching Radiation inflict + an Inferno DoT,
 *  fired every round (identical in both the "with modifier" and "control" skill lists). */
function payloadAbilities(): Ability[] {
    return [
        ab({ type: 'damage', config: { type: 'damage', multiplier: 100 } }),
        ab({
            type: 'debuff',
            config: {
                type: 'debuff',
                buffName: 'Scorching Radiation',
                application: 'inflict',
                duration: 5,
                stacks: 1,
                isStackable: false,
                parsedEffects: {},
            },
        }),
        ab({
            type: 'dot',
            config: { type: 'dot', dotType: 'inferno', tier: 10, stacks: 1, duration: 5 },
        }),
    ];
}

/** The Wildfire-shape modifier: dotDamage, gated on the named enemy debuff + scaled by the
 *  caster's own live crit power (perUnit 0.1 = the base passive's "1% … per 10% crit power"). */
function wildfireModifier(): Ability {
    return ab({
        target: 'self',
        type: 'modifier',
        conditions: [
            { subject: 'enemy-debuff', derivable: true, buffName: 'Scorching Radiation' },
            { subject: 'self-crit-power', derivable: true },
        ],
        scaling: { conditionIndex: 1, perUnit: 0.1 },
        config: { type: 'modifier', channel: 'dotDamage', value: 0, isMultiplicative: false },
    });
}

describe('Wildfire dotDamage crit-power scaling (sub-project I, PR I4a) — engine integration', () => {
    it('round 1 (no pre-existing Scorching Radiation): the modifier contributes NO boost', () => {
        idc = 0;
        const withMod: ShipSkills = {
            slots: [{ slot: 'active', abilities: [...payloadAbilities(), wildfireModifier()] }],
        };
        const control: ShipSkills = { slots: [{ slot: 'active', abilities: payloadAbilities() }] };

        const withModResult = runCombat(engineBase(withMod));
        const controlResult = runCombat(engineBase(control));

        // Nothing pre-exists on the target before round 1's own infliction → the gate reads
        // false this round (mirrors the I1 Incinerator/Tygr integration test) → byte-identical
        // to the control (no modifier at all).
        expect(withModResult.rounds[0].infernoDamage).toBe(controlResult.rounds[0].infernoDamage);
        expect(withModResult.rounds[0].infernoDamage).toBeGreaterThan(0);
    });

    it('round 2 (Scorching Radiation now pre-existing): Inferno ticks are boosted by critPower × perUnit%', () => {
        idc = 0;
        const withMod: ShipSkills = {
            slots: [{ slot: 'active', abilities: [...payloadAbilities(), wildfireModifier()] }],
        };
        const control: ShipSkills = { slots: [{ slot: 'active', abilities: payloadAbilities() }] };

        const withModResult = runCombat(engineBase(withMod));
        const controlResult = runCombat(engineBase(control));

        // Round 1's own Scorching Radiation infliction is now pre-existing at the start of
        // round 2 → the gate reads true → dotMult gains +15pp (critDamage 150 * perUnit 0.1).
        // Both runs apply IDENTICAL DoT entries/stacking each round, so the ratio isolates the
        // modifier's delta cleanly regardless of how many entries are actively ticking.
        expect(controlResult.rounds[1].infernoDamage).toBeGreaterThan(0);
        expect(withModResult.rounds[1].infernoDamage).toBeCloseTo(
            controlResult.rounds[1].infernoDamage * 1.15,
            0
        );
    });

    it('an enemy WITHOUT Scorching Radiation never gets the boost, even across many rounds', () => {
        // Same modifier + crit power, but the skill never inflicts the named debuff at all
        // (only the plain hit + Inferno DoT) — the enemy-debuff gate never lands.
        idc = 0;
        const noStatusPayload = (): Ability[] => [
            ab({ type: 'damage', config: { type: 'damage', multiplier: 100 } }),
            ab({
                type: 'dot',
                config: { type: 'dot', dotType: 'inferno', tier: 10, stacks: 1, duration: 5 },
            }),
        ];
        const withMod: ShipSkills = {
            slots: [{ slot: 'active', abilities: [...noStatusPayload(), wildfireModifier()] }],
        };
        const control: ShipSkills = {
            slots: [{ slot: 'active', abilities: noStatusPayload() }],
        };

        const withModResult = runCombat({ ...engineBase(withMod), numRounds: 3 });
        const controlResult = runCombat({ ...engineBase(control), numRounds: 3 });

        for (let r = 0; r < 3; r++) {
            expect(withModResult.rounds[r].infernoDamage).toBe(
                controlResult.rounds[r].infernoDamage
            );
        }
    });
});
