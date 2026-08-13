/**
 * malvexShieldedReduction.integration.test.ts — Malvex `self-shielded` incoming-reduction
 * (model-completeness epic, SP-A / Task 4-PR-A).
 *
 * Malvex ("When Shielded, this Ship takes 10% less damage") is the first ship to exercise the
 * NEW context-driven `self-shielded` IncomingCondition: the reduction is gated on the VICTIM's
 * own live shield pool (CombatActor.shieldPool > 0), evaluated per-hit by `conditionMet`
 * (incomingEffects.ts) — NOT on which side the ship sits on. Team-symmetry: the SAME ability
 * config must produce the SAME reduction whether Malvex is a PLAYER team victim (enemy→player
 * positional path) or an ENEMY victim (player→enemy positional path).
 *
 * The ability is injected directly (not parsed from CSV text) to isolate the engine-plumbing
 * fix under test from Malvex's OTHER passive clause (a reactive "gains Shield equal to 15% of
 * the Damage dealt to them" ability, unrelated to this task). The parser wiring itself (that the
 * real Malvex skill text builds an `incoming-reduction` ability with `condition: 'self-shielded'`)
 * is covered by the SP-A triage probe in modelCompletenessTriage.test.ts.
 *
 * MEASUREMENT: reads the `attacked` event's `damage` field (the per-attack landed hit AFTER any
 * incoming-reduction fold but BEFORE the shield-first drain split) rather than a death-bracket —
 * Malvex's shield pool is a REAL absorption pool (state.ts's `shieldPool`), so any non-zero
 * starting shield also absorbs part of the landed hit before it reaches HP. Reading `damage`
 * directly observes the reduction in isolation from that (legitimate, separate) absorption math.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';
import { emptyPreFightModifiers } from '../preFight/types';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
type TeamActor = NonNullable<CombatEngineInput['teamActors']>[number];

// Malvex's "When Shielded, this Ship takes 10% less damage" clause, injected directly (see
// file header for why this isn't parsed from the verbatim CSV text here).
const malvexReduction: Ability = {
    id: 'malvex-self-shielded',
    type: 'incoming-reduction',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'incoming-reduction',
        scope: 'direct',
        condition: 'self-shielded',
        pct: 10,
        critFamily: false,
    },
};
const malvexPassive: ShipSkills['slots'][number] = {
    slot: 'passive',
    abilities: [malvexReduction],
};

const parsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });

// A no-op damage active (multiplier 0) so a bystander actor still "casts" each round.
const noopActive: ShipSkills['slots'][number] = {
    slot: 'active',
    abilities: [
        {
            id: 'noop-dmg',
            type: 'damage',
            target: 'enemy',
            trigger: 'on-cast',
            conditions: [],
            config: { type: 'damage', multiplier: 0 },
        },
    ],
};

// A plain single-hit basic attack (multiplier 100% = 1x attack, defence 0 → flat landed damage).
const basicAttack: ShipSkills['slots'][number] = {
    slot: 'active',
    abilities: [
        {
            id: 'basic',
            type: 'damage',
            target: 'enemy',
            trigger: 'on-cast',
            conditions: [],
            config: { type: 'damage', multiplier: 100 },
        },
    ],
};

/** Landed `attacked.damage` values credited to `victimId` across the run. */
const landedDamagesFor = (input: CombatEngineInput, victimId: string): number[] => {
    const bus = createEventBus();
    const landed: number[] = [];
    bus.on('attacked', (e: Extract<CombatEvent, { type: 'attacked' }>) => {
        if (e.targetId === victimId && e.damage !== undefined) landed.push(e.damage);
    });
    runCombat({ ...input, bus });
    return landed;
};

// ───────────────────────────────────────────────────────────────────────────
// PLAYER-side Malvex: a positioned player TEAM victim hit by a positioned ENEMY attacker
// (enemy→player positional path, mirroring incomingReductionEngine.test.ts).
// ───────────────────────────────────────────────────────────────────────────

/** A positioned PLAYER Malvex carrying the injected incoming-reduction passive, with a starting
 *  shield pool of `shieldPctOfHp`% of its max HP (0 = no shield). HP is huge so it never dies —
 *  this test reads the landed-hit signal directly, not a death bracket. */
const playerMalvex = (id: string, position: Position, shieldPctOfHp: number): TeamActor => ({
    id,
    speed: 1000, // acts before the enemy — irrelevant here (the shield exists from creation).
    chargeCount: 0,
    startCharged: false,
    selfBuffs: [],
    enemyDebuffs: [],
    position,
    preFight: { ...emptyPreFightModifiers(), startingShieldPctOfHp: shieldPctOfHp },
    walk: {
        shipSkills: { slots: [noopActive, malvexPassive] },
        stats: {
            attack: 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            hacking: 0,
            defence: 0,
            hp: 1_000_000_000,
        },
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        hasChargedSkill: false,
    },
});

/** A positioned ENEMY attacker: attack 5000 × 100% × 1 hit vs defence 0 → 5000 firing-hit. */
const offensiveEnemy = (
    id: string,
    position: Position,
    selection: ParsedTarget['selection']
): EnemyAttacker =>
    ({
        id,
        stats: { attack: 5000, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000_000, speed: 1 },
        chargeCount: 0,
        startCharged: false,
        position,
        target: parsedTarget(selection),
        pattern: basePattern(),
        shipSkills: { slots: [{ slot: 'active', abilities: basicAttack.abilities }] },
    }) as EnemyAttacker;

const BASE_PLAYER_SIDE = (overrides: Partial<CombatEngineInput>): CombatEngineInput => ({
    attack: 0,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [noopActive] }, // DPS-mode focus is an inert bystander here.
    enemyDefense: 0,
    enemyHp: 1_000_000_000,
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
    defence: 0,
    hp: 1_000_000_000,
    healTargetId: 'attacker',
    mode: 'healing',
    ...overrides,
});

describe('Malvex self-shielded incoming-reduction — PLAYER side (enemy→player positional path)', () => {
    const run = (shieldPctOfHp: number): CombatEngineInput =>
        BASE_PLAYER_SIDE({
            teamActors: [playerMalvex('malvex', 'M4', shieldPctOfHp)],
            enemyAttackers: [offensiveEnemy('enemy-1', 'M1', 'front')],
        });

    it('WHILE shielded — the landed hit is reduced by 10% (5000 → 4500)', () => {
        const landed = landedDamagesFor(run(50), 'malvex');
        expect(landed).toEqual([4500]);
    });

    it('control: with NO shield — the landed hit is the FULL, unreduced 5000', () => {
        const landed = landedDamagesFor(run(0), 'malvex');
        expect(landed).toEqual([5000]);
    });
});

// ───────────────────────────────────────────────────────────────────────────
// ENEMY-side Malvex: a positioned ENEMY victim hit by the PLAYER focus attacker
// (player→enemy positional path, mirroring enemySideAttacked.integration.test.ts).
// ───────────────────────────────────────────────────────────────────────────

/** A positioned ENEMY Malvex carrying the injected incoming-reduction passive, with a starting
 *  shield pool of `shieldPctOfHp`% of its max HP (0 = no shield). Attack 0 — pure victim, huge
 *  HP so it never dies. */
const enemyMalvex = (id: string, shieldPctOfHp: number): EnemyAttacker =>
    ({
        id,
        stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000_000, speed: 1 },
        chargeCount: 0,
        startCharged: false,
        position: 'M4',
        target: parsedTarget('front'),
        pattern: basePattern(),
        shipSkills: { slots: [malvexPassive] },
        preFight: { ...emptyPreFightModifiers(), startingShieldPctOfHp: shieldPctOfHp },
    }) as EnemyAttacker;

const BASE_ENEMY_SIDE = (overrides: Partial<CombatEngineInput>): CombatEngineInput => ({
    attack: 5_000, // player focus attack → the hit landing on the enemy Malvex.
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [basicAttack] },
    enemyDefense: 0,
    enemyHp: 1_000_000_000,
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
    defence: 0,
    hp: 1_000_000_000, // immortal player attacker — never dies, irrelevant to this test.
    speed: 200,
    healTargetId: 'attacker',
    mode: 'healing',
    position: 'M4',
    target: parsedTarget('front'),
    pattern: basePattern(),
    ...overrides,
});

describe('Malvex self-shielded incoming-reduction — ENEMY side (player→enemy positional path)', () => {
    const run = (shieldPctOfHp: number): CombatEngineInput =>
        BASE_ENEMY_SIDE({ enemyAttackers: [enemyMalvex('malvex', shieldPctOfHp)] });

    it('WHILE shielded — the landed hit is reduced by 10% (5000 → 4500)', () => {
        const landed = landedDamagesFor(run(50), 'malvex');
        expect(landed).toEqual([4500]);
    });

    it('control: with NO shield — the landed hit is the FULL, unreduced 5000', () => {
        const landed = landedDamagesFor(run(0), 'malvex');
        expect(landed).toEqual([5000]);
    });
});
