/**
 * frontLineWhileShieldedDefence.integration.test.ts — ship-kit Wave 4, Task 8.
 *
 * FrontLine's passive (docs/ship-skills.csv): "While Shielded, it gains 2500 additional Defense."
 * A NEW engine capability — a flat-points DEFENCE bonus folded into the DEFENSIVE stat read,
 * gated on the actor CURRENTLY holding a shield (CombatActor.shieldPool > 0), re-evaluated fresh
 * on every hit via `substitutedDefenceFor` (engine.ts). Modelled with a NEW `conditional-stat`
 * AbilityConfig variant (see AbilityType's doc comment) — distinct from every existing stat-bonus
 * path: `modifier` is percentage-only and folds ONLY into the attacker-side DAMAGE-mode read,
 * never the defensive one; `pre-combat-stat` is a permanent one-shot with no `defence` option.
 *
 * Structurally mirrors malvexShieldedReduction.integration.test.ts (the closest existing
 * shield-gated DEFENSIVE precedent): the ability is injected directly (not parsed from CSV text)
 * to isolate the engine-plumbing fix under test from FrontLine's OTHER passive clauses (Shield
 * Penetration — explicitly out of scope for this task — and the start-of-combat/reactive shield
 * grants); the parser/build wiring itself is covered by buildShipAbilities.test.ts's FrontLine
 * case. Team-symmetry: the SAME ability config must produce the SAME defence bump whether
 * FrontLine is a PLAYER team victim (enemy→player positional path) or an ENEMY victim
 * (player→enemy positional path) — `substitutedDefenceFor` already runs for every victim
 * regardless of side, by construction.
 *
 * MEASUREMENT: reads the `attacked` event's `damage` field (the per-attack landed hit AFTER
 * defence mitigation but BEFORE the shield-first drain split — same convention as the Malvex
 * file), and independently computes the expected mitigated value via the SAME
 * `calculateDamageReduction` curve the engine itself calls (mirrors protectionTransfer
 * .integration.test.ts's `mit()` helper) rather than hand-rounding a non-linear percentage.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { calculateDamageReduction } from '../../autogear/priorityScore';
import { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';
import { emptyPreFightModifiers } from '../preFight/types';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
type TeamActor = NonNullable<CombatEngineInput['teamActors']>[number];

// FrontLine's "While Shielded, it gains 2500 additional Defense" clause, injected directly (see
// file header for why this isn't parsed from the verbatim CSV text here).
const frontLineDefenceBonus: Ability = {
    id: 'frontline-while-shielded-defence',
    type: 'conditional-stat',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'conditional-stat', stat: 'defence', flat: 2500, condition: 'self-shield' },
};
const frontLinePassive: ShipSkills['slots'][number] = {
    slot: 'passive',
    abilities: [frontLineDefenceBonus],
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

// A plain single-hit basic attack (multiplier 100% = 1x attack).
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

/** Landed `attacked.damage` values credited to `victimId` across the run, in round order. */
const landedDamagesFor = (input: CombatEngineInput, victimId: string): number[] => {
    const bus = createEventBus();
    const landed: number[] = [];
    bus.on('attacked', (e: Extract<CombatEvent, { type: 'attacked' }>) => {
        if (e.targetId === victimId && e.damage !== undefined) landed.push(e.damage);
    });
    runCombat({ ...input, bus });
    return landed;
};

// The SAME non-linear defence→reduction curve the engine's victimHitDamage calls, used here only
// to independently derive the EXPECTED mitigated fraction for a given (base + conditional) defence
// value — mirrors protectionTransfer.integration.test.ts's `mit()` helper.
const mit = (defence: number): number =>
    defence > 0 ? 1 - calculateDamageReduction(defence) / 100 : 1;

const ATTACK = 5000;
const FLAT_BONUS = 2500;

// ───────────────────────────────────────────────────────────────────────────
// PLAYER-side FrontLine: a positioned player TEAM victim hit by a positioned ENEMY attacker
// (enemy→player positional path, mirroring malvexShieldedReduction.integration.test.ts).
// ───────────────────────────────────────────────────────────────────────────

/** A positioned PLAYER FrontLine carrying the injected conditional-stat passive, with a starting
 *  shield pool of `shieldPctOfHp`% of its max HP (0 = no shield). `hp` defaults to huge (never
 *  dies) — the revert-across-rounds test below overrides it to a modest value so the shield's
 *  absolute size (`hp * shieldPctOfHp / 100`) stays small enough to be fully consumed in one hit. */
const playerFrontLine = (
    id: string,
    position: Position,
    shieldPctOfHp: number,
    hp = 1_000_000_000
): TeamActor => ({
    id,
    speed: 1000,
    chargeCount: 0,
    startCharged: false,
    selfBuffs: [],
    enemyDebuffs: [],
    position,
    preFight: { ...emptyPreFightModifiers(), startingShieldPctOfHp: shieldPctOfHp },
    walk: {
        shipSkills: { slots: [noopActive, frontLinePassive] },
        stats: {
            attack: 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            hacking: 0,
            defence: 0,
            hp,
        },
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        hasChargedSkill: false,
    },
});

/** A positioned ENEMY attacker: attack 5000 x 100% x 1 hit vs defence 0/2500. */
const offensiveEnemy = (
    id: string,
    position: Position,
    selection: ParsedTarget['selection']
): EnemyAttacker =>
    ({
        id,
        stats: { attack: ATTACK, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000_000, speed: 1 },
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
    ...overrides,
});

describe('FrontLine while-Shielded +2500 Defense — PLAYER side (enemy→player positional path)', () => {
    const run = (shieldPctOfHp: number): CombatEngineInput =>
        BASE_PLAYER_SIDE({
            teamActors: [playerFrontLine('frontline', 'M4', shieldPctOfHp)],
            enemyAttackers: [offensiveEnemy('enemy-1', 'M1', 'front')],
        });

    it('WHILE shielded — the landed hit is mitigated by the +2500 flat Defense bonus', () => {
        const landed = landedDamagesFor(run(50), 'frontline');
        expect(landed).toEqual([ATTACK * mit(FLAT_BONUS)]);
        // Sanity: the bonus must actually reduce the hit vs the unmitigated 5000 — otherwise this
        // assertion would pass vacuously if mit() were ever a no-op.
        expect(landed[0]).toBeLessThan(ATTACK);
    });

    it('control: with NO shield — the landed hit is the FULL, unreduced 5000 (base defence 0)', () => {
        const landed = landedDamagesFor(run(0), 'frontline');
        expect(landed).toEqual([ATTACK]);
    });
});

// ───────────────────────────────────────────────────────────────────────────
// ENEMY-side FrontLine: a positioned ENEMY victim hit by the PLAYER focus attacker
// (player→enemy positional path — team symmetry counterpart).
// ───────────────────────────────────────────────────────────────────────────

/** A positioned ENEMY FrontLine carrying the injected conditional-stat passive, with a starting
 *  shield pool of `shieldPctOfHp`% of its max HP (0 = no shield). Attack 0 — pure victim. */
const enemyFrontLine = (id: string, shieldPctOfHp: number): EnemyAttacker =>
    ({
        id,
        stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000_000, speed: 1 },
        chargeCount: 0,
        startCharged: false,
        position: 'M4',
        target: parsedTarget('front'),
        pattern: basePattern(),
        shipSkills: { slots: [frontLinePassive] },
        preFight: { ...emptyPreFightModifiers(), startingShieldPctOfHp: shieldPctOfHp },
    }) as EnemyAttacker;

const BASE_ENEMY_SIDE = (overrides: Partial<CombatEngineInput>): CombatEngineInput => ({
    attack: ATTACK, // player focus attack → the hit landing on the enemy FrontLine.
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
    hp: 1_000_000_000,
    speed: 200,
    healTargetId: 'attacker',
    position: 'M4',
    target: parsedTarget('front'),
    pattern: basePattern(),
    ...overrides,
});

describe('FrontLine while-Shielded +2500 Defense — ENEMY side (player→enemy positional path, team symmetry)', () => {
    const run = (shieldPctOfHp: number): CombatEngineInput =>
        BASE_ENEMY_SIDE({ enemyAttackers: [enemyFrontLine('frontline', shieldPctOfHp)] });

    it('WHILE shielded — the landed hit is mitigated by the +2500 flat Defense bonus', () => {
        const landed = landedDamagesFor(run(50), 'frontline');
        expect(landed).toEqual([ATTACK * mit(FLAT_BONUS)]);
        expect(landed[0]).toBeLessThan(ATTACK);
    });

    it('control: with NO shield — the landed hit is the FULL, unreduced 5000 (base defence 0)', () => {
        const landed = landedDamagesFor(run(0), 'frontline');
        expect(landed).toEqual([ATTACK]);
    });
});

// ───────────────────────────────────────────────────────────────────────────
// REVERT within a single battle: the shield pool is small enough to be fully consumed by round
// 1's landed hit, so round 2 sees shieldPool === 0 and the bonus must NOT apply — proving the
// per-hit re-evaluation (not a one-time snapshot) required by the task.
// ───────────────────────────────────────────────────────────────────────────

describe('FrontLine while-Shielded +2500 Defense — revert once the shield is consumed', () => {
    // shieldPool = 1% of 50,000 = 500, far below EITHER possible round-1 landed value (whether or
    // not the bonus applies, 5000 * mit(defence) >> 500 for defence in {0, 2500}), so round 1's
    // hit fully drains it regardless — decoupling "does the shield get consumed" from the exact
    // mitigated number under test.
    const HP = 50_000;
    const SHIELD_PCT_OF_HP = 1;

    it('round 1 (shielded): mitigated by the bonus; round 2 (shield consumed): reverts to full damage', () => {
        const input = BASE_PLAYER_SIDE({
            numRounds: 2,
            teamActors: [playerFrontLine('frontline', 'M4', SHIELD_PCT_OF_HP, HP)],
            enemyAttackers: [offensiveEnemy('enemy-1', 'M1', 'front')],
        });
        const landed = landedDamagesFor(input, 'frontline');
        expect(landed).toHaveLength(2);
        const [round1, round2] = landed;
        // Round 1: shielded → mitigated by the +2500 flat bonus.
        expect(round1).toBeCloseTo(ATTACK * mit(FLAT_BONUS), 6);
        expect(round1).toBeLessThan(ATTACK);
        // Round 2: shield fully consumed by round 1's hit (500 << round-1 landed damage) →
        // hasShield(victim) is now false → bonus reverts → full, unmitigated 5000 (base defence 0).
        expect(round2).toBe(ATTACK);
    });
});
