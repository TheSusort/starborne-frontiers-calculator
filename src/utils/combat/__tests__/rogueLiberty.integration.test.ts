/**
 * `Rogue's Liberty` ("Ignores Taunt and Provoke.") — Chimei grants it to all allies for 2 turns.
 * It built as a name-only buff (empty `parsedEffects`) and nothing read it, so it did nothing.
 *
 * `ignoresForcedTargeting` already existed and was production-wired, but only as a STATIC
 * construction-time actor flag derived from a ship's OWN skill text (nine ships). This makes it
 * dynamic: a timed, ally-granted buff now sets it for its duration.
 *
 * Positional mode only — forced targeting is a positional concept; aggregate mode has no
 * per-target selection to override. Semantics match the static flag exactly, including that it
 * does NOT bypass Concentrate Fire (state.ts's flag docs; positionalBinding keeps CF above Taunt).
 *
 * Drives production targeting through `runCombat`. A `resolvePositionalTarget` unit test would
 * pass without the engine ever reading the buff — positionalBinding.test.ts already covers the
 * resolver itself.
 *
 * BOARD GEOMETRY (board.ts: column 4 = front, nearest the enemy; `front` selection anchors on the
 * highest occupied column of the first row in scan order). So the natural `front` anchor sits at
 * M4 and the forcing actor sits at M1 (back) — Taunt/CF is then what drags the hit backwards.
 *
 * TURN ORDER / ROUND CHOICE. Every assertion reads ROUND 2, because both of the engine's
 * forced-targeting read sites run at cast time:
 *   - `selectTurnTarget` resolves the anchor BEFORE `runPlayerTurn` executes the cast, so a
 *     self-buff granted on-cast within that same cast cannot be up yet for its own selection.
 *   - the buff models an ALLY grant (Chimei buffs the team; the ally attacks on a later turn),
 *     so "up before the holder's turn" is the faithful shape anyway.
 * Round 1 therefore establishes the buff (and lets the opposing side raise its Taunt / lets the
 * end-of-round Concentrate Fire applier land); round 2 is the round under test.
 *
 * TWO READ SITES, TWO OBSERVABLES. `perTargetDamage` is fed by the per-victim positional apply
 * loop (`drivePositionalApply`, which re-resolves the anchor per hit) — it observes the apply-side
 * read. The on-cast marker debuff's `debuff-applied` targetId is routed from `selectTurnTarget`'s
 * `tgt` — it observes the selection-side read. Both are asserted so neither edit can be dropped.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, type CombatEngineInput } from '../engine';
import { createEventBus, type CombatEvent } from '../events';
import { createStatusEngine } from '../statusEngine';
import { holdsRoguesLiberty } from '../rogueLiberty';
import type { Ability } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';
import type { SelectedGameBuff } from '../../../types/calculator';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
type TeamActor = NonNullable<CombatEngineInput['teamActors']>[number];

// ---------------------------------------------------------------------------
// Local harness (per-file scaffold, copied from transformIncomingToDot.test.ts)
// ---------------------------------------------------------------------------

const HP = 10_000_000; // large enough nothing ever dies.
const DIRECT_HIT = 5000; // attack 5000 x 100% x 1 hit vs defence 0.

const parsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });

/** A 0-damage active so an actor takes a real turn (and fires its on-cast clauses) without
 *  disturbing anyone's HP. */
const noopDamage = (): Ability => ({
    id: 'noop-dmg',
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 0 },
});

/** A real damaging active. Fixed id is safe here: every engine map keyed by ability id is
 *  namespaced `${ownerId}:${abilityId}` (see triggers.ts's proc/once-per-attack gates), so a
 *  literal id shared across different actors never collides — and no test in this file ever
 *  puts two of these on the SAME actor's ability list. Ids are never asserted in this file. */
const basicAttack = (): Ability => ({
    id: 'basic-atk',
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 100, hits: 1 },
});

const BASE_PLAYER_SIDE = (overrides: Partial<CombatEngineInput>): CombatEngineInput => ({
    attack: 0,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [{ slot: 'active', abilities: [noopDamage()] }] },
    enemyDefense: 0,
    enemyHp: HP,
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
    hp: HP,
    healTargetId: 'attacker',
    mode: 'healing',
    ...overrides,
});

// ---------------------------------------------------------------------------
// Ability shapes
// ---------------------------------------------------------------------------

/** The buff under test, granted as an active-slot on-cast self-buff (the verified-working grant
 *  shape in this harness). 99 turns == "up for the whole run". */
const roguesLibertyBuff = (): Ability => ({
    id: 'rogues-liberty',
    type: 'buff',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'buff',
        buffName: "Rogue's Liberty",
        parsedEffects: {},
        stacks: 1,
        isStackable: false,
        duration: 99,
    },
});

const tauntSelfBuff = (): Ability => ({
    id: 'taunt',
    type: 'buff',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'buff',
        buffName: 'Taunt',
        parsedEffects: {},
        stacks: 1,
        isStackable: false,
        duration: 99,
    },
});

/** Concentrate Fire is a DEBUFF on the forced target, so it has to come from the opposing side.
 *  Mirrors the Doomsayer applier cfProvokeAppliers.integration.test.ts exercises: end-of-round,
 *  `enemy-highest-attack`, no proc gate. Landing at the end of round 1 makes it live for round 2. */
const cfApplier = (): Ability => ({
    id: 'cf-applier',
    type: 'debuff',
    target: 'enemy-highest-attack',
    trigger: 'end-of-round',
    conditions: [],
    config: {
        type: 'debuff',
        buffName: 'Concentrate Fire',
        parsedEffects: {},
        stacks: 1,
        isStackable: false,
        application: 'apply',
        duration: 99,
    },
});

/** An inert on-cast debuff whose `debuff-applied` event names the actor `selectTurnTarget`
 *  resolved — the observable for the SELECTION-side read of `ignoresForcedTargeting`.
 *  `application: 'apply'` so it never rolls against hacking/resistance. */
const MARKER_DEBUFF = 'Target Marker';

const markerDebuff = (): Ability => ({
    id: 'marker',
    type: 'debuff',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'debuff',
        buffName: MARKER_DEBUFF,
        parsedEffects: {},
        stacks: 1,
        isStackable: false,
        application: 'apply',
        duration: 99,
    },
});

// ---------------------------------------------------------------------------
// Measurement
// ---------------------------------------------------------------------------

/** Damage credited to each victim in the given round. */
function damageByTarget(input: CombatEngineInput, round: number): Record<string, number> {
    const result = runCombat({ ...input, bus: createEventBus() });
    return result.rounds.find((r) => r.round === round)?.perTargetDamage ?? {};
}

/** Victim ids the marker debuff landed on, in the given round. */
function markedIn(input: CombatEngineInput, round: number): string[] {
    const bus = createEventBus();
    const out: string[] = [];
    bus.on('debuff-applied', (e: Extract<CombatEvent, { type: 'debuff-applied' }>) => {
        if (e.buffName === MARKER_DEBUFF && e.round === round) out.push(e.targetId);
    });
    runCombat({ ...input, bus });
    return out;
}

// ---------------------------------------------------------------------------
// Module reader
// ---------------------------------------------------------------------------

const seedBuff = (buffName: string): SelectedGameBuff =>
    ({
        id: buffName,
        buffName,
        stacks: 1,
        parsedEffects: {},
        isStackable: false,
        skillDuration: null,
    }) as SelectedGameBuff;

describe('holdsRoguesLiberty', () => {
    it('is true when the actor carries the buff', () => {
        const se = createStatusEngine({
            selfBuffs: [seedBuff("Rogue's Liberty")],
            enemyDebuffs: [],
        });
        se.beginRound(1);
        expect(holdsRoguesLiberty(se, 'attacker')).toBe(true);
    });

    it('is false otherwise', () => {
        const se = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        se.beginRound(1);
        expect(holdsRoguesLiberty(se, 'attacker')).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// PLAYER side: the focus attacker holds the buff
// ---------------------------------------------------------------------------

/** An enemy that self-casts the given abilities and never deals damage. `attack` only feeds the
 *  `enemy-highest-attack` selector — the 0-multiplier active means it always deals 0. */
const enemyWith = (
    id: string,
    position: Position,
    abilities: Ability[],
    attack = 0
): EnemyAttacker =>
    ({
        id,
        stats: { attack, crit: 0, critDamage: 0, defence: 0, hp: HP, speed: 1000 },
        chargeCount: 0,
        startCharged: false,
        position,
        target: parsedTarget('front'),
        pattern: basePattern(),
        shipSkills: { slots: [{ slot: 'active', abilities: [...abilities, noopDamage()] }] },
    }) as EnemyAttacker;

/** Focus attacker at M4, `front` selection, slowest on the board so every other actor's on-cast
 *  self-buff is already up when it picks its target. */
const FOCUS = (overrides: Partial<CombatEngineInput>): CombatEngineInput =>
    BASE_PLAYER_SIDE({
        attack: DIRECT_HIT,
        speed: 1,
        position: 'M4',
        target: parsedTarget('front'),
        pattern: basePattern(),
        ...overrides,
    });

const TWO_ENEMIES = (backAbilities: Ability[], backAttack = 0): EnemyAttacker[] => [
    enemyWith('front-enemy', 'M4', []),
    enemyWith('back-enemy', 'M1', backAbilities, backAttack),
];

describe("Rogue's Liberty lets the holder ignore Taunt — player side", () => {
    it('without the buff, the taunting back enemy soaks the hit (baseline)', () => {
        const dmg = damageByTarget(
            FOCUS({
                shipSkills: { slots: [{ slot: 'active', abilities: [basicAttack()] }] },
                enemyAttackers: TWO_ENEMIES([tauntSelfBuff()]),
            }),
            2
        );
        expect(dmg['back-enemy'] ?? 0).toBeGreaterThan(0);
        expect(dmg['front-enemy'] ?? 0).toBe(0);
    });

    it('with the buff, normal selection wins and the taunter is bypassed', () => {
        const dmg = damageByTarget(
            FOCUS({
                shipSkills: {
                    slots: [{ slot: 'active', abilities: [roguesLibertyBuff(), basicAttack()] }],
                },
                enemyAttackers: TWO_ENEMIES([tauntSelfBuff()]),
            }),
            2
        );
        expect(dmg['front-enemy'] ?? 0).toBeGreaterThan(0); // pre-fix: 0
        expect(dmg['back-enemy'] ?? 0).toBe(0); // pre-fix: > 0
    });

    it("also shifts the cast's SELECTED target, not just where the damage lands", () => {
        // The on-cast marker debuff routes to `selectTurnTarget`'s resolved `tgt`, so this pins
        // the selection-side read independently of the per-victim apply loop.
        const input = (abilities: Ability[]) =>
            FOCUS({
                shipSkills: { slots: [{ slot: 'active', abilities }] },
                enemyAttackers: TWO_ENEMIES([tauntSelfBuff()]),
            });
        expect(markedIn(input([markerDebuff(), basicAttack()]), 2)).toEqual(['back-enemy']);
        expect(markedIn(input([roguesLibertyBuff(), markerDebuff(), basicAttack()]), 2)).toEqual([
            'front-enemy',
        ]);
    });

    it('does NOT bypass Concentrate Fire', () => {
        // CF outranks both Taunt and the ignore flag (state.ts's flag docs; positionalBinding
        // keeps CF above Taunt). The focus's own end-of-round applier marks the highest-attack
        // enemy — the back one — so in round 2 that enemy is still forced despite the buff.
        const dmg = damageByTarget(
            FOCUS({
                shipSkills: {
                    slots: [
                        { slot: 'active', abilities: [roguesLibertyBuff(), basicAttack()] },
                        { slot: 'passive', abilities: [cfApplier()] },
                    ],
                },
                enemyAttackers: TWO_ENEMIES([], 10),
            }),
            2
        );
        expect(dmg['back-enemy'] ?? 0).toBeGreaterThan(0);
        expect(dmg['front-enemy'] ?? 0).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// ENEMY side: the SAME buff on an enemy attacker must behave identically
// (team symmetry — never compare damage ACROSS sides; the RNG is keyed by ownerId)
// ---------------------------------------------------------------------------

/** A positioned player team actor that self-casts the given abilities and deals no damage. */
const teamActorWith = (id: string, position: Position, abilities: Ability[]): TeamActor =>
    ({
        id,
        speed: 1000, // acts before the enemy attacker, so its Taunt is up first
        chargeCount: 0,
        startCharged: false,
        selfBuffs: [],
        enemyDebuffs: [],
        position,
        walk: {
            shipSkills: { slots: [{ slot: 'active', abilities: [...abilities, noopDamage()] }] },
            stats: {
                attack: 0,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                hacking: 0,
                defence: 0,
                hp: HP,
            },
            selfDotModifier: 0,
            defensePenetrationBuff: 0,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            hasChargedSkill: false,
        },
    }) as TeamActor;

/** The mirror setup: an ENEMY attacker at M4 with `front` selection against two positioned team
 *  actors; the taunter sits at the back (M1). The focus attacker is left POSITIONLESS so it stays
 *  out of the positional candidate set and cannot soak the hit. */
const MIRROR = (enemyAbilities: Ability[]): CombatEngineInput =>
    BASE_PLAYER_SIDE({
        speed: 1,
        teamActors: [
            teamActorWith('team-front', 'M4', []),
            teamActorWith('team-back', 'M1', [tauntSelfBuff()]),
        ],
        enemyAttackers: [
            {
                id: 'enemy-rogue',
                stats: { attack: DIRECT_HIT, crit: 0, critDamage: 0, defence: 0, hp: HP, speed: 1 },
                chargeCount: 0,
                startCharged: false,
                position: 'M4',
                target: parsedTarget('front'),
                pattern: basePattern(),
                shipSkills: {
                    slots: [{ slot: 'active', abilities: [...enemyAbilities, basicAttack()] }],
                },
            } as EnemyAttacker,
        ],
    });

describe("Rogue's Liberty is team-symmetric — an ENEMY holder ignores the player team's Taunt", () => {
    it('without the buff, the taunting back team actor soaks the hit (baseline)', () => {
        const dmg = damageByTarget(MIRROR([]), 2);
        expect(dmg['team-back'] ?? 0).toBeGreaterThan(0);
        expect(dmg['team-front'] ?? 0).toBe(0);
    });

    it('with the buff, normal selection wins and the taunter is bypassed', () => {
        const dmg = damageByTarget(MIRROR([roguesLibertyBuff()]), 2);
        expect(dmg['team-front'] ?? 0).toBeGreaterThan(0); // pre-fix: 0
        expect(dmg['team-back'] ?? 0).toBe(0); // pre-fix: > 0
    });
});
