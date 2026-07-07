/**
 * SP-F F5 — Meatshield defense-substitution (approximation).
 *
 * Meatshield's R4 refit-active passive: "Any direct damage dealt to a non-defender ally that
 * is not transferred by Protection is dealt as if that ally had this Unit's defense."
 * Protection-as-damage-transfer (a Defender intercepting ally damage) is a DEFERRED mechanic
 * (design doc §1) — nothing is ever "transferred by Protection" in this model, so the "not
 * transferred" gate is vacuously satisfied: ALL direct damage to a living non-defender ally is
 * mitigated using the CARRIER's effective defence instead of the ally's own.
 *
 * The ability is injected directly (not parsed from CSV text) to isolate the engine plumbing
 * under test from the parser wiring, which is covered separately by the SP-F triage probe in
 * modelCompletenessTriage.test.ts ("Meatshield: ... builds an ally-scoped defense-substitution
 * ability").
 *
 * Uses the NON-positional (legacy `healTargetId`) path deliberately, so the enemy's hit routes
 * through `victimDefenceFor` (engine.ts) — one of the four defence-read sites this task patches
 * — without needing any board-position plumbing.
 *
 * Team-symmetry (mandatory per feedback_engine_team_symmetry): a second describe block below
 * exercises an ENEMY-side Meatshield substituting for an ENEMY non-defender ally, via the
 * POSITIONAL path (`defenseProfileOf`) — the sibling site the non-positional scenario above
 * does not reach.
 *
 * Critical-review fix (post be86b1f6): the unknown-role default was flipped. Substitution now
 * requires PROVING the victim's role is a known non-defender — an absent role stays dormant (no
 * substitution), matching `matchesRoleCategory(undefined, ...) === false`'s established
 * convention elsewhere in this file (Graphite's role filter). The two "substitution fires"
 * tests below now set an explicit `role: 'ATTACKER'` on the victim; the new
 * "unknown role — dormant" tests cover the previously-silent-failure case (a role-less victim
 * used to be substituted; it must NOT be, on either side).
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput, TeamActorEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { calculateDamageReduction } from '../../autogear/priorityScore';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

// Meatshield's R4 clause, injected directly (see file header).
const defenseSubstitutionAbility: Ability = {
    id: 'meatshield-defense-sub',
    type: 'defense-substitution',
    target: 'all-allies',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'defense-substitution' },
};
const meatshieldPassive: ShipSkills['slots'][number] = {
    slot: 'passive',
    abilities: [defenseSubstitutionAbility],
};

/** A manual flat enemy attacker: no shipSkills → the engine synthesizes a single basic attack
 *  (100% multiplier, 1 hit, crit-eligible). */
const manualEnemy = (id: string, attack: number, speed = 50): EnemyAttacker => ({
    id,
    stats: { attack, crit: 0, critDamage: 0, speed },
    chargeCount: 0,
    startCharged: false,
});

/** A walked player team actor carrying no shipSkills of its own (a pure victim/carrier stat
 *  block) — `role` optionally sets the ShipTypeName for role-filtered classification. */
const teamActor = (
    id: string,
    defence: number,
    opts: { passive?: ShipSkills['slots']; role?: TeamActorEngineInput['role'] } = {}
): TeamActorEngineInput => ({
    id,
    speed: 100,
    chargeCount: 0,
    startCharged: false,
    selfBuffs: [],
    enemyDebuffs: [],
    role: opts.role,
    walk: {
        shipSkills: { slots: opts.passive ?? [] },
        stats: {
            attack: 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            hacking: 0,
            defence,
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

const ENEMY_ATTACK = 1000;
const MEATSHIELD_DEFENCE = 500;
// Expected substituted damage: calculateDamageReduction(500) applied to a 1000-attack,
// 100%-multiplier, no-crit, no-pen, neutral-affinity single hit (mirrors
// perVictimDefenseDebuff.test.ts's precedent for locking an exact defence-formula value).
const EXPECTED_SUBSTITUTED_DAMAGE =
    ENEMY_ATTACK * (1 - calculateDamageReduction(MEATSHIELD_DEFENCE) / 100);

const BASE_INPUT = (overrides: Partial<CombatEngineInput>): CombatEngineInput => ({
    attack: 0,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [] }, // DPS-mode focus is an inert bystander here.
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
    healTargetId: 'ally-1',
    ...overrides,
});

describe('Meatshield defense-substitution — PLAYER side (non-positional victimDefenceFor path)', () => {
    it("a living KNOWN non-defender ally takes LESS damage — mitigated by MEATSHIELD's defence, not its own (defence 0)", () => {
        const withMeatshield = landedDamagesFor(
            BASE_INPUT({
                teamActors: [
                    teamActor('meatshield', MEATSHIELD_DEFENCE, { passive: [meatshieldPassive] }),
                    teamActor('ally-1', 0, { role: 'ATTACKER' }),
                ],
                enemyAttackers: [manualEnemy('enemy-1', ENEMY_ATTACK)],
            }),
            'ally-1'
        );
        expect(withMeatshield).toHaveLength(1);
        // Exact substituted value (Meatshield's defence, not the ally's own 0 → 0% reduction).
        expect(withMeatshield[0]).toBeCloseTo(EXPECTED_SUBSTITUTED_DAMAGE, 5);
        // Strictly less than the ally's own (0-defence, unmitigated) damage.
        expect(withMeatshield[0]).toBeLessThan(ENEMY_ATTACK);
    });

    it('negative case (Critical fix): an ally with an UNKNOWN role is NOT substituted — the gate now requires proving a known non-defender role, not just "not proven DEFENDER"', () => {
        const unknownRoleAlly = landedDamagesFor(
            BASE_INPUT({
                teamActors: [
                    teamActor('meatshield', MEATSHIELD_DEFENCE, { passive: [meatshieldPassive] }),
                    teamActor('ally-1', 0), // no role set
                ],
                enemyAttackers: [manualEnemy('enemy-1', ENEMY_ATTACK)],
            }),
            'ally-1'
        );
        expect(unknownRoleAlly).toEqual([ENEMY_ATTACK]);
    });

    it('control: WITHOUT Meatshield present, the ally takes the FULL unmitigated hit (its own 0 defence)', () => {
        const withoutMeatshield = landedDamagesFor(
            BASE_INPUT({
                teamActors: [teamActor('ally-1', 0)],
                enemyAttackers: [manualEnemy('enemy-1', ENEMY_ATTACK)],
            }),
            'ally-1'
        );
        expect(withoutMeatshield).toEqual([ENEMY_ATTACK]);
    });

    it('negative case: a DEFENDER ally is NOT substituted — takes the same FULL hit as the control, despite Meatshield being present', () => {
        const defenderAlly = landedDamagesFor(
            BASE_INPUT({
                teamActors: [
                    teamActor('meatshield', MEATSHIELD_DEFENCE, { passive: [meatshieldPassive] }),
                    teamActor('ally-1', 0, { role: 'DEFENDER' }),
                ],
                enemyAttackers: [manualEnemy('enemy-1', ENEMY_ATTACK)],
            }),
            'ally-1'
        );
        expect(defenderAlly).toEqual([ENEMY_ATTACK]);
    });
});

// ───────────────────────────────────────────────────────────────────────────────────────
// ENEMY-side symmetry: an enemy Meatshield substitutes for an enemy non-defender ally, via
// the POSITIONAL path (`defenseProfileOf`) — mirrors malvexShieldedReduction.integration.test.ts's
// ENEMY-side positional template. The PLAYER focus attacker targets the enemy ally's position
// directly; the enemy Meatshield sits at a different position, never targeted, existing only as
// a living carrier.
// ───────────────────────────────────────────────────────────────────────────────────────

const parsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });

// A plain single-hit basic attack for the PLAYER focus in the enemy-side describe block below
// (multiplier 100% = 1x attack — the focus must actually deal damage here, unlike the
// player-side block above where the focus is a deliberately inert bystander).
const basicAttack: ShipSkills = {
    slots: [
        {
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
        },
    ],
};

/** A positioned ENEMY carrier of the defense-substitution passive — high defence, never
 *  targeted (no `target`/`pattern` of its own needed: it does 0 damage and is never hit). */
const enemyMeatshield = (id: string, position: Position, defence: number): EnemyAttacker =>
    ({
        id,
        stats: { attack: 0, crit: 0, critDamage: 0, defence, hp: 1_000_000_000, speed: 1 },
        chargeCount: 0,
        startCharged: false,
        position,
        shipSkills: { slots: [meatshieldPassive] },
    }) as EnemyAttacker;

/** A positioned ENEMY ally victim — low (0) defence of its own. `role` optionally sets the
 *  ShipTypeName for role-filtered classification (mirrors the player-side `teamActor` helper). */
const enemyAlly = (
    id: string,
    position: Position,
    defence: number,
    role?: EnemyAttacker['role']
): EnemyAttacker =>
    ({
        id,
        stats: { attack: 0, crit: 0, critDamage: 0, defence, hp: 1_000_000_000, speed: 1 },
        chargeCount: 0,
        startCharged: false,
        position,
        shipSkills: { slots: [] },
        role,
    }) as EnemyAttacker;

const ENEMY_SIDE_BASE = (overrides: Partial<CombatEngineInput>): CombatEngineInput => ({
    attack: ENEMY_ATTACK, // player focus attack → the hit landing on the enemy ally.
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: basicAttack,
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
    healTargetId: 'attacker', // required to unlock the positioned enemy roster.
    position: 'M4',
    target: parsedTarget('front'),
    pattern: basePattern(),
    ...overrides,
});

describe('Meatshield defense-substitution — ENEMY side (positional defenseProfileOf path)', () => {
    it("an enemy Meatshield substitutes for its living enemy KNOWN non-defender ally: less damage than the ally's own (0) defence", () => {
        const landed = landedDamagesFor(
            ENEMY_SIDE_BASE({
                enemyAttackers: [
                    enemyMeatshield('enemy-meatshield', 'M1', MEATSHIELD_DEFENCE),
                    enemyAlly('enemy-ally', 'M4', 0, 'ATTACKER'),
                ],
            }),
            'enemy-ally'
        );
        expect(landed).toHaveLength(1);
        expect(landed[0]).toBeCloseTo(EXPECTED_SUBSTITUTED_DAMAGE, 5);
        expect(landed[0]).toBeLessThan(ENEMY_ATTACK);
    });

    it('control: WITHOUT the enemy Meatshield, the enemy ally takes the FULL unmitigated hit', () => {
        const landed = landedDamagesFor(
            ENEMY_SIDE_BASE({
                enemyAttackers: [enemyAlly('enemy-ally', 'M4', 0, 'ATTACKER')],
            }),
            'enemy-ally'
        );
        expect(landed).toEqual([ENEMY_ATTACK]);
    });

    it('negative case (Critical fix): an enemy ally with an UNKNOWN role is NOT substituted despite the enemy Meatshield being present', () => {
        const landed = landedDamagesFor(
            ENEMY_SIDE_BASE({
                enemyAttackers: [
                    enemyMeatshield('enemy-meatshield', 'M1', MEATSHIELD_DEFENCE),
                    enemyAlly('enemy-ally', 'M4', 0), // no role set
                ],
            }),
            'enemy-ally'
        );
        expect(landed).toEqual([ENEMY_ATTACK]);
    });
});
