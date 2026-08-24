/**
 * D-PR4 — engine-level POSITIONAL integration for attacker-side outgoing amplification
 * (Menace / Giant Slayer).
 *
 * Sibling to outgoingAmplificationEngine.test.ts (which drives the AGGREGATE/DPS-sink path via
 * buildTurnArgs) and to incomingReductionEngine.test.ts (the D-PR3 victim-side positional sibling).
 * Where the aggregate test uses a stub-free buildTurnArgs path, THIS test exercises the two pieces
 * the AGGREGATE test and the applyPositionalDamage unit stub cannot:
 *
 *   1. `outgoingAbilitiesById` — does the engine resolve the FOCUS attacker's outgoing-amplification
 *      ability from its PASSIVE slot (`input.shipSkills`) and key it under actor id 'attacker'?
 *   2. `effectiveStatsOf` higher-attack comparison — is the Giant Slayer direction correct
 *      (amplify only when the victim's effective attack > the attacker's)?
 *
 * The amplification folds into the POSITIONAL per-sub-hit damage path (victimHitDamage's outgoing
 * term, via drivePositionalApply → applyPositionalDamage → outgoingAmplificationFor). So this test
 * drives the player→enemy positional apply: the FOCUS attacker (positioned at M4 with a parsed
 * target + base pattern) carries a Menace / Giant Slayer outgoing-amplification ability in its
 * PASSIVE slot and fires at a positioned enemy victim.
 *
 * OBSERVABLE: `RoundData.perTargetDamage[victimId]` records the actual per-victim landed damage
 * (an emitHit accumulator wired inside drivePositionalApply), and — with huge victim HP — it is
 * NOT clamped at death, so the amplified damage is directly readable. We assert the amplified run
 * credits STRICTLY MORE per-victim damage than the identical run WITHOUT the ability.
 *
 * REACHABILITY: the positioned enemy roster (`enemyAttackers`) is only built in HEALING mode, so
 * every run sets `healTargetId`. procChance is 1.0 so the deterministic rate gate fires on EVERY
 * eligible hit (no proc-spacing flake).
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

// ── Ability helpers ─────────────────────────────────────────────────────────────────
let idc = 0;
const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `oa${++idc}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...p,
});

// A single-hit basic attack (1x, 1 hit). No passive payload damage, so the firing-hit damage is
// the clean per-victim landed amount the amplification scales.
const basicAttack = (): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities: [
        ab({ type: 'damage', target: 'enemy', config: { type: 'damage', multiplier: 100 } }),
    ],
});

// Menace-shape: amplify on crit, +45% per firing hit, procChance 1.0 (fires every eligible hit).
const menacePassive = (): ShipSkills['slots'][number] => ({
    slot: 'passive',
    abilities: [
        ab({
            type: 'outgoing-amplification',
            target: 'self',
            config: {
                type: 'outgoing-amplification',
                condition: 'amplify-on-crit',
                ampPct: 45,
                procChance: 1.0,
            },
        }),
    ],
});

// Giant Slayer-shape: amplify vs higher-attack target, +60% per firing hit, procChance 1.0.
const giantSlayerPassive = (): ShipSkills['slots'][number] => ({
    slot: 'passive',
    abilities: [
        ab({
            type: 'outgoing-amplification',
            target: 'self',
            config: {
                type: 'outgoing-amplification',
                condition: 'amplify-vs-higher-attack',
                ampPct: 60,
                procChance: 1.0,
            },
        }),
    ],
});

// ── Targeting / pattern helpers ──────────────────────────────────────────────────────
const parsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });

// A positioned enemy victim with configurable attack (drives the Giant Slayer higher-attack gate)
// and HUGE HP so it never dies → perTargetDamage records the actual landed damage unclamped.
const enemyVictim = (id: string, position: Position, attack = 0): EnemyAttacker => ({
    id,
    stats: { attack, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000_000, speed: 1 },
    chargeCount: 0,
    startCharged: false,
    position,
    shipSkills: { slots: [] },
});

// Focus attacker at M4 with a basic attack + optional outgoing-amplification passive, targeting
// `front` (origin-only) → anchors the front-most enemy at M4. Healing mode builds the enemy roster.
const BASE = (overrides: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
    enemyAttackers: [],
    attack: 5000,
    crit: 0,
    critDamage: 50,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [basicAttack()] },
    numRounds: 6, // enough rounds for the proc gate to fire repeatedly
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
    healTargetId: 'attacker', // healing mode → positioned enemy roster is built
    mode: 'healing',
    position: 'M4',
    target: parsedTarget('front'),
    pattern: basePattern(),
    ...overrides,
});

/** Total damage the focus attacker credited to `victimId` across all rounds (positional path). */
const totalPerVictim = (input: CombatEngineInput, victimId: string): number => {
    idc = 0;
    const result = runCombat(input);
    return result.rounds.reduce((sum, r) => sum + (r.perTargetDamage?.[victimId] ?? 0), 0);
};

describe('D-PR4 engine wiring — POSITIONAL outgoing amplification (player→enemy)', () => {
    it('Menace (amplify-on-crit): forced crits amplify per-victim damage above the no-amp control', () => {
        // crit 100 → every firing hit crits → amplify-on-crit eligible every round; procChance 1.0
        // → the rate gate fires every hit → +45% on every hit. Without the passive the outgoing
        // term is 0 → the firing hits land their unamplified per-victim damage.
        const withMenace = totalPerVictim(
            BASE({
                crit: 100,
                shipSkills: { slots: [basicAttack(), menacePassive()] },
                enemyAttackers: [enemyVictim('enemy-front', 'M4')],
            }),
            'enemy-front'
        );
        const control = totalPerVictim(
            BASE({
                crit: 100,
                shipSkills: { slots: [basicAttack()] },
                enemyAttackers: [enemyVictim('enemy-front', 'M4')],
            }),
            'enemy-front'
        );

        expect(control).toBeGreaterThan(0); // sanity: the positional path actually landed damage
        // Amplified run credits STRICTLY MORE per-victim damage than the no-amp control.
        // (Would be EQUAL if outgoingAbilitiesById failed to resolve the focus attacker's passive.)
        expect(withMenace).toBeGreaterThan(control);
    });

    it('Giant Slayer (amplify-vs-higher-attack): amplifies ONLY when the victim out-attacks the attacker', () => {
        // The focus attacker's effective attack = 5000. This exercises the effectiveStatsOf
        // higher-attack comparison in BOTH directions, proving it is not inverted.

        // Victim attack 9000 (> attacker 5000) → targetHigherAttack true → amplifies.
        const vsHigher = totalPerVictim(
            BASE({
                crit: 0,
                shipSkills: { slots: [basicAttack(), giantSlayerPassive()] },
                enemyAttackers: [enemyVictim('enemy-front', 'M4', 9000)],
            }),
            'enemy-front'
        );
        // Same setup, NO passive → unamplified baseline (victim attack does not matter here).
        const baseline = totalPerVictim(
            BASE({
                crit: 0,
                shipSkills: { slots: [basicAttack()] },
                enemyAttackers: [enemyVictim('enemy-front', 'M4', 9000)],
            }),
            'enemy-front'
        );
        // Same passive but victim attack 1000 (< attacker 5000) → targetHigherAttack false → inert.
        const vsLower = totalPerVictim(
            BASE({
                crit: 0,
                shipSkills: { slots: [basicAttack(), giantSlayerPassive()] },
                enemyAttackers: [enemyVictim('enemy-front', 'M4', 1000)],
            }),
            'enemy-front'
        );

        expect(baseline).toBeGreaterThan(0); // sanity: positional damage landed
        // Higher-attack victim → amplified above baseline (effectiveStatsOf direction correct).
        expect(vsHigher).toBeGreaterThan(baseline);
        // Lower-attack victim → NOT amplified: byte-identical to the no-passive baseline.
        expect(vsLower).toBe(baseline);
    });
});
