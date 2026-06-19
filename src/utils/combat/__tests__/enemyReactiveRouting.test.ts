/**
 * Unit tests for the per-call isOpposing predicate in registerReactiveListeners.
 *
 * Purpose: verify that enemy owners' on-enemy-destroyed / on-ally-destroyed triggers route
 * against the CORRECT side (the player team is opposing for an enemy owner, not the enemy
 * side). This is the bySide PR2 fix. Other reactive triggers (on-ally-crit, etc.) are
 * covered by triggers.test.ts.
 *
 * These tests drive registerReactiveListeners directly with a fake bus and spy enqueue,
 * so they are fast, isolated, and free of golden-snapshot concerns.
 */

import { describe, it, expect } from 'vitest';
import { createEventBus, CombatEvent } from '../events';
import { registerReactiveListeners, ReactiveAbility, Intent } from '../triggers';
import type { Ability, ShipSkills } from '../../../types/abilities';
import { runCombat, CombatEngineInput } from '../engine';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';

// ---------------------------------------------------------------------------
// Minimal ability builder (mirrors the ab() helper in triggers.test.ts)
// ---------------------------------------------------------------------------
let idCounter = 0;
const ab = (partial: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `g${++idCounter}`,
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    ...partial,
});

// A simple buff ability config used in reactive slots (no extra-action complexity).
const buffAbility = (trigger: Ability['trigger']): Ability =>
    ab({
        type: 'buff',
        target: 'self',
        trigger,
        config: {
            type: 'buff',
            buffName: 'Attack Up',
            parsedEffects: { attack: 20 },
            stacks: 1,
            isStackable: false,
        },
    });

const makeRA = (trigger: Ability['trigger']): ReactiveAbility => ({
    ability: buffAbility(trigger),
    sourceSlot: 'passive',
});

// ---------------------------------------------------------------------------
// Scenario 1 — enemy owner E1 with on-enemy-destroyed
//   isOpposing = (id) => id === 'P1' || id === 'P2'  (player team is opposing)
//   Emitting ship-destroyed for P1 (opposing) → should enqueue once
//   Emitting ship-destroyed for E2 (same-side) → should NOT enqueue
// ---------------------------------------------------------------------------
describe('enemy owner on-enemy-destroyed', () => {
    it('fires for an opposing (player) actor death and NOT for a same-side actor death', () => {
        const bus = createEventBus();
        const enqueued: Intent[] = [];

        const isOpposing = (id: string) => id === 'P1' || id === 'P2';

        registerReactiveListeners({
            bus,
            perOwner: [
                {
                    ownerId: 'E1',
                    reactiveAbilities: [makeRA('on-enemy-destroyed')],
                },
            ],
            enqueue: (intent) => enqueued.push(intent),
            isOpposing,
        });

        // Opposing actor dies → should fire
        bus.emit({ type: 'ship-destroyed', actorId: 'P1', round: 1 });

        // Same-side actor dies → should NOT fire
        bus.emit({ type: 'ship-destroyed', actorId: 'E2', round: 1 });

        expect(enqueued.length).toBe(1);
        expect(enqueued[0].ownerId).toBe('E1');
    });
});

// ---------------------------------------------------------------------------
// Scenario 2 — enemy owner E1 with on-ally-destroyed
//   isOpposing = (id) => id === 'P1'
//   E2 (same-side non-self) → should fire
//   E1 (self) → should NOT fire (self-death goes to on-destroyed)
//   P1 (opposing) → should NOT fire (opposing is never an ally)
// ---------------------------------------------------------------------------
describe('enemy owner on-ally-destroyed', () => {
    it('fires for same-side non-self and NOT for self or opposing actors', () => {
        const bus = createEventBus();
        const enqueued: Intent[] = [];

        const isOpposing = (id: string) => id === 'P1';

        registerReactiveListeners({
            bus,
            perOwner: [
                {
                    ownerId: 'E1',
                    reactiveAbilities: [makeRA('on-ally-destroyed')],
                },
            ],
            enqueue: (intent) => enqueued.push(intent),
            isOpposing,
        });

        // E2: same-side, non-self → fires
        bus.emit({ type: 'ship-destroyed', actorId: 'E2', round: 1 });

        // E1: self → does NOT fire (own death is on-destroyed's job)
        bus.emit({ type: 'ship-destroyed', actorId: 'E1', round: 1 });

        // P1: opposing → does NOT fire (opposing is never an ally)
        bus.emit({ type: 'ship-destroyed', actorId: 'P1', round: 1 });

        expect(enqueued.length).toBe(1);
        expect(enqueued[0].ownerId).toBe('E1');
    });
});

// ---------------------------------------------------------------------------
// Scenario 3 — player-call parity
//   owner 'attacker', isOpposing = isEnemySide = (id) => id === 'enemy'
//   on-ally-destroyed:
//     T1 (ally player) → fires
//     'enemy' → does NOT fire (opposing)
//     'attacker' (self) → does NOT fire
// ---------------------------------------------------------------------------
describe('player owner on-ally-destroyed (parity check)', () => {
    it('fires for team ally death and NOT for enemy or self', () => {
        const bus = createEventBus();
        const enqueued: Intent[] = [];

        // Classic player-call predicate: isEnemySide
        const isOpposing = (id: string) => id === 'enemy';

        registerReactiveListeners({
            bus,
            perOwner: [
                {
                    ownerId: 'attacker',
                    reactiveAbilities: [makeRA('on-ally-destroyed')],
                },
            ],
            enqueue: (intent) => enqueued.push(intent),
            isOpposing,
        });

        // T1: ally player actor → fires
        bus.emit({ type: 'ship-destroyed', actorId: 'T1', round: 1 });

        // 'enemy': opposing actor → does NOT fire
        bus.emit({ type: 'ship-destroyed', actorId: 'enemy', round: 1 });

        // 'attacker': self → does NOT fire
        bus.emit({ type: 'ship-destroyed', actorId: 'attacker', round: 1 });

        expect(enqueued.length).toBe(1);
        expect(enqueued[0].ownerId).toBe('attacker');
    });
});

// ===========================================================================
// END-TO-END repro (bySide PR2 task 2): an ENEMY granter's on-enemy-destroyed
// extra-action must actually LAND, not just fire the listener.
//
// Task 1 fixed the listener PREDICATE so an enemy owner's on-enemy-destroyed FIRES
// when a player ship dies. But the grant was still dropped: grantExtraAction
// resolved the granter from allPlayerActorsById (attacker + team only, NO enemy ids),
// so an enemy granter hit `if (!granter) return;` and the extra action was silently
// lost. Task 2 switches the granter lookup to the combined allActorsById roster.
//
// This is a full runCombat team-vs-team battle (harness copied from
// twoTeamBattle.test.ts): a positioned enemy attacker carries a one-shot damage active
// PLUS a Liberator-style on-enemy-destroyed extra-action passive (shape from
// reactiveExtraAction.test.ts). Two player ships are on the board — a fragile victim it
// kills + a tankier survivor set as healTargetId (so the player team isn't wiped and the
// enemy keeps walking). The passive is non-damaging, so the kill is identical with or
// without it — a NON-VACUOUS control: the same battle runs twice, and we assert the
// enemy's turn count is exactly +1 with the passive.
//
// OBSERVED extra-turn landing: the player victim is a real positioned actor reconciled
// post-round, so the kill is registered post-round → Path B → the buffered grant lands
// in the NEXT round (R+1). The asserted PROPERTY is the timing-independent +1 delta.
// ===========================================================================

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
type TeamActor = NonNullable<CombatEngineInput['teamActors']>[number];

let e2eIdc = 0;
const e2eAb = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `e2e${++e2eIdc}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...p,
});

// Single-hit 100% basic attack (attack × 1 vs defence 0 = known per-hit damage).
const e2eBasicAttack = (): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities: [
        e2eAb({ type: 'damage', target: 'enemy', config: { type: 'damage', multiplier: 100 } }),
    ],
});

// Liberator-style on-enemy-destroyed extra-action passive (non-damaging).
const liberatorPassive = (): ShipSkills['slots'][number] => ({
    slot: 'passive',
    abilities: [
        e2eAb({
            type: 'extra-action',
            target: 'self',
            trigger: 'on-enemy-destroyed',
            config: { type: 'extra-action', oncePerRound: true },
        }),
    ],
});

const e2eParsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});
const e2eBasePattern = (): ParsedPattern => ({
    raw: 'base',
    shape: 'base',
    range: 0,
    modifiers: {},
});

// A walked team actor that FIRES on the enemy roster.
const teamAttackerAt = (
    id: string,
    position: Position,
    selection: ParsedTarget['selection'],
    attack: number,
    hp: number
): TeamActor => ({
    id,
    speed: 150,
    chargeCount: 0,
    startCharged: false,
    selfBuffs: [],
    enemyDebuffs: [],
    position,
    target: e2eParsedTarget(selection),
    pattern: e2eBasePattern(),
    walk: {
        shipSkills: { slots: [e2eBasicAttack()] },
        stats: {
            attack,
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

// A positioned enemy attacker firing on the player roster. `slots` lets the Liberator
// case add the on-enemy-destroyed passive alongside the damage active.
const offensiveEnemyAt = (
    id: string,
    position: Position,
    selection: ParsedTarget['selection'],
    attack: number,
    hp: number,
    speed: number,
    slots: ShipSkills['slots']
): EnemyAttacker =>
    ({
        id,
        stats: { attack, crit: 0, critDamage: 0, defence: 0, hp, speed },
        chargeCount: 0,
        startCharged: false,
        position,
        target: e2eParsedTarget(selection),
        pattern: e2eBasePattern(),
        shipSkills: { slots },
    }) as EnemyAttacker;

// Build the battle. `withPassive` toggles the enemy Liberator's on-enemy-destroyed
// extra-action passive (the control: identical otherwise).
const liberatorBattle = (withPassive: boolean): CombatEngineInput => {
    e2eIdc = 0;
    const enemySlots: ShipSkills['slots'] = withPassive
        ? [e2eBasicAttack(), liberatorPassive()]
        : [e2eBasicAttack()];
    return {
        // Focus actor = the tanky SURVIVOR (heal target), positioned at the BACK (M3).
        // Huge HP so it never dies → the player team is never wiped → combat continues.
        attack: 1, // focus barely scratches the enemy so the enemy survives to keep acting
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: 0,
        shipSkills: { slots: [e2eBasicAttack()] },
        enemyDefense: 0,
        enemyHp: 1_000_000_000,
        numRounds: 4,
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
        position: 'M3',
        target: e2eParsedTarget('back'),
        pattern: e2eBasePattern(),
        // Fragile VICTIM player at the FRONT (M4): 1 HP so the enemy front attack one-shots it.
        teamActors: [teamAttackerAt('player-victim', 'M4', 'back', 1, 1)],
        // Single enemy Liberator at the front, fires `front` → anchors the front-most player
        // (the fragile victim at M4), one-shots it (attack 5000 vs hp 1). speed 200 so it acts
        // at the TOP of the round, before the players.
        enemyAttackers: [
            offensiveEnemyAt(
                'enemy-liberator',
                'M4',
                'front',
                5000,
                1_000_000_000,
                200,
                enemySlots
            ),
        ],
    };
};

const runE2E = (input: CombatEngineInput) => {
    const bus = createEventBus();
    const events: CombatEvent[] = [];
    const TYPES: CombatEvent['type'][] = ['turn-started', 'ship-destroyed'];
    for (const t of TYPES) bus.on(t, (e) => events.push(e as CombatEvent));
    runCombat({ ...input, bus });
    return events;
};

const countEnemyTurns = (events: CombatEvent[]) =>
    events.filter((e) => e.type === 'turn-started' && e.actorId === 'enemy-liberator').length;

describe('enemy on-enemy-destroyed extra-action lands end-to-end (bySide PR2 task 2)', () => {
    it('grants the enemy Liberator exactly ONE extra action when it kills a player ship', () => {
        const withEvents = runE2E(liberatorBattle(true));
        const withoutEvents = runE2E(liberatorBattle(false));

        // NON-VACUOUS baseline: a player ship is actually destroyed in the control run.
        const victimDestroyed = withoutEvents.some(
            (e) => e.type === 'ship-destroyed' && e.actorId === 'player-victim'
        );
        expect(victimDestroyed).toBe(true);

        const turnsWith = countEnemyTurns(withEvents);
        const turnsWithout = countEnemyTurns(withoutEvents);

        // Once-per-round, single kill → exactly one extra action for the enemy granter.
        // Before the fix the grant is dropped (player-only lookup) → turnsWith === turnsWithout.
        expect(turnsWith).toBe(turnsWithout + 1);
    });
});
