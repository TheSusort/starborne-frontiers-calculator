/**
 * Lifeline (`incoming-shield-grant`) must not grant an INVISIBLE shield.
 *
 * Lifeline is the one shield source that is applied inside `applyVictimDamage` rather than by a
 * cast (playerTurn.ts) or the reactive executor (triggers.ts) — the two sites that own the
 * `shield-applied` emission. It therefore grew `victim.shieldPool` (and the `shieldGranted`
 * StatCard accumulator) with NO combat-log line at all, while its `shield-destroyed` twin IS
 * emitted a few lines below — the exact "a shield is destroyed that the log never
 * showed being granted" shape reported for AEGIS. Being collected side-agnostically
 * (`incomingAbilitiesById` is built from BOTH runtime maps), it reaches ENEMY actors too.
 *
 * The fix is a LOG-ONLY twin (`shield-applied-log`), not the real `shield-applied`: the real event
 * carries `on-shield-applied` combat listeners (Resonating Fury), and firing those from a mid-hit
 * threshold grant would change combat behaviour, not just the log. Same contract as
 * `shield-destroyed-log` / `cheat-death-log`.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { Ability } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { CombatEvent } from '../events';
import { createEventBus } from '../events';
import { buildCombatLog } from '../log/buildCombatLog';
import { LOG_EVENT_TYPES } from '../../calculators/battleSimulator';

const lifeline = (flatAmount: number): Ability => ({
    id: 'lifeline-implant',
    type: 'incoming-shield-grant',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'incoming-shield-grant',
        hpThresholdPct: 30,
        flatAmount,
        attackPct: 0, // flat-only keeps the granted amount an exact, assertable integer
        oncePerCombat: true,
    },
});

const basicAttack = (): Ability => ({
    id: 'basic',
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 100 },
});

const parsedTarget = (): ParsedTarget => ({ raw: 'front', side: 'enemy', selection: 'front' });
const lineRange1Pattern = (): ParsedPattern => ({
    raw: 'line-range-1',
    shape: 'line',
    range: 1,
    modifiers: {},
});

/** Enemy at M4 whose PASSIVE slot carries the Lifeline implant ability. At the default HP 10_000
 *  the focus's 8_000-damage hit takes it to 2_000 (20% < 30%) — a downward threshold crossing on
 *  hit #1. The ordering test raises `hp` so the main hit does NOT cross and only the reactive proc
 *  does. */
const lifelineEnemy = (hp = 10_000) =>
    ({
        id: 'enemy-front',
        stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp, speed: 1 },
        chargeCount: 0,
        startCharged: false,
        position: 'M4',
        shipSkills: {
            slots: [{ slot: 'passive', abilities: [lifeline(5_000)] }],
        },
    }) as NonNullable<CombatEngineInput['enemyAttackers']>[number];

const INPUT = (): CombatEngineInput => ({
    attack: 8_000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [{ slot: 'active', abilities: [basicAttack()] }] },
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
    healModifier: 0,
    healTargetId: 'attacker',
    mode: 'healing',
    position: 'M4',
    target: parsedTarget(),
    pattern: lineRange1Pattern(),
    enemyAttackers: [lifelineEnemy()],
});

/** An Insidiousness-shaped reactive: the cast inflicts a debuff, which triggers a follow-up
 *  damage proc. 300% of an 8_000 attack = 24_000, so the PROC (not the 8_000 main hit) is what
 *  drives the 40_000-HP carrier below its 30% threshold. */
const insidiousness = (): Ability => ({
    id: 'insid',
    type: 'damage',
    target: 'enemy',
    trigger: 'on-debuff-inflicted',
    conditions: [],
    config: { type: 'damage', multiplier: 300 },
});

const inflictDebuff = (): Ability => ({
    id: 'atk-down',
    type: 'debuff',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'debuff',
        buffName: 'Attack Down III',
        parsedEffects: { attack: -30 },
        stacks: 1,
        isStackable: false,
        application: 'inflict',
        duration: 2,
    },
});

/** Same board as INPUT(), but the focus carries the reactive proc and its cast inflicts the
 *  debuff that triggers it. A reactive proc only reduces the victim's real HP against a POSITIONED
 *  enemy roster (the engine's own gate in applyReactiveDamage) rather than being credit-only; this
 *  board is positioned, and `mode: 'battle'` additionally makes it a two-team run. */
const REACTIVE_INPUT = (): CombatEngineInput => ({
    ...INPUT(),
    mode: 'battle',
    hacking: 10_000, // the debuff must land for the proc to trigger
    // 40_000 HP: the main 8_000 hit leaves it at 80% (no crossing), so the ONLY thing that can
    // arm Lifeline is the 24_000 proc — which is what makes the ordering assertion meaningful.
    enemyAttackers: [lifelineEnemy(40_000)],
    shipSkills: {
        slots: [
            { slot: 'active', abilities: [basicAttack(), inflictDebuff()] },
            { slot: 'passive', abilities: [insidiousness()] },
        ],
    },
});

/** Counterattack variant: the LIFELINE CARRIER counters, and its counter is what drives the FOCUS
 *  below 30% — so the deferral has to work on the `applyCounterAttack` path too, not just
 *  `applyReactiveDamage`. Both paths emit their attack row after the application returns, so both
 *  need the same buffering (CodeRabbit #277). */
const counter = (multiplier: number): Ability => ({
    id: 'stalwart-counter',
    type: 'counter',
    target: 'enemy',
    trigger: 'on-attacked',
    conditions: [],
    config: { type: 'counter', multiplier },
});

const COUNTER_INPUT = (): CombatEngineInput => ({
    ...INPUT(),
    mode: 'battle',
    // The FOCUS is the Lifeline carrier here: 40_000 max HP, 12_000 threshold. It attacks for
    // 8_000; the counter comes back for 300% of the counter-owner's 10_000 attack = 30_000, which
    // crosses the focus below 30% in one blow and arms its Lifeline.
    hp: 40_000,
    shipSkills: {
        slots: [
            { slot: 'active', abilities: [basicAttack()] },
            { slot: 'passive', abilities: [lifeline(5_000)] },
        ],
    },
    enemyAttackers: [
        {
            id: 'enemy-front',
            stats: { attack: 10_000, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000, speed: 1 },
            chargeCount: 0,
            startCharged: false,
            position: 'M4',
            shipSkills: { slots: [{ slot: 'passive', abilities: [counter(300)] }] },
        },
    ],
});

const run = () => {
    const bus = createEventBus();
    const events: CombatEvent[] = [];
    // Subscribe EXACTLY the production log surface (battleSimulator's LOG_EVENT_TYPES) so a shield
    // line that exists only on an unsubscribed event type still counts as invisible.
    for (const t of LOG_EVENT_TYPES) bus.on(t, (e) => events.push(e as CombatEvent));
    const result = runCombat({ ...INPUT(), bus });
    const roster = [
        { actorId: 'attacker', side: 'player' as const, name: 'Focus' },
        { actorId: 'enemy-front', side: 'enemy' as const, name: 'Lifeline Carrier' },
    ];
    return { events, result, log: buildCombatLog(events, roster, new Map()) };
};

describe('Lifeline threshold shield is visible in the combat log', () => {
    it('grants the shield (StatCard accumulator sees it)', () => {
        const { result } = run();
        // flat 5_000, attackPct 0 → exactly 5_000 of pool granted mid-hit.
        expect(result.rounds[0].perActorShield?.['enemy-front']?.granted).toBe(5_000);
    });

    it('emits a LOG-ONLY shield twin for the grant (no silent pool growth)', () => {
        const { events } = run();
        const applied = events.filter(
            (e) => e.type === 'shield-applied' || e.type === 'shield-applied-log'
        );
        expect(applied).toHaveLength(1);
        expect(applied[0]).toMatchObject({ type: 'shield-applied-log', round: 1 });
    });

    it('does NOT emit the listener-bearing `shield-applied` (no Resonating Fury chain)', () => {
        const { events } = run();
        expect(events.filter((e) => e.type === 'shield-applied')).toHaveLength(0);
    });

    /**
     * Ordering: a REACTIVE proc (Insidiousness, counters) applies its hit and only then emits its
     * own `reactive-damage-performed` row, so a Lifeline grant raised during that application used
     * to print ABOVE the attack that caused it (observed in a real 2v2 log: "AEGIS shields 14,356"
     * and "AEGIS's shield destroyed" listed above "Enemy Curator → AEGIS: 19,327"). The engine now
     * buffers the consequence twins for the duration of the reactive apply and the executor
     * releases them right after the attack row.
     */
    it('orders a reactive proc BEFORE the shield grant/destroy it causes', () => {
        const bus = createEventBus();
        const seen: CombatEvent['type'][] = [];
        for (const t of LOG_EVENT_TYPES) bus.on(t, (e) => seen.push((e as CombatEvent).type));
        runCombat({ ...REACTIVE_INPUT(), bus });

        const proc = seen.indexOf('reactive-damage-performed');
        const grant = seen.indexOf('shield-applied-log');
        expect(proc).toBeGreaterThanOrEqual(0); // the reactive proc fired
        expect(grant).toBeGreaterThanOrEqual(0); // and drove Lifeline
        expect(proc).toBeLessThan(grant); // cause before consequence
        const destroyed = seen.indexOf('shield-destroyed-log');
        if (destroyed >= 0) expect(proc).toBeLessThan(destroyed);
    });

    it('orders a COUNTERATTACK before the shield grant/destroy it causes', () => {
        const bus = createEventBus();
        const seen: CombatEvent['type'][] = [];
        for (const t of LOG_EVENT_TYPES) bus.on(t, (e) => seen.push((e as CombatEvent).type));
        runCombat({ ...COUNTER_INPUT(), bus });

        const proc = seen.indexOf('reactive-damage-performed');
        const grant = seen.indexOf('shield-applied-log');
        expect(proc).toBeGreaterThanOrEqual(0); // the counter fired
        expect(grant).toBeGreaterThanOrEqual(0); // and drove Lifeline
        expect(proc).toBeLessThan(grant);
        const destroyed = seen.indexOf('shield-destroyed-log');
        if (destroyed >= 0) expect(proc).toBeLessThan(destroyed);
    });

    it('surfaces a shield entry in the built combat log, keyed on the victim', () => {
        const { log } = run();
        const entries = log.flatMap((r) => [
            ...r.startOfRound,
            ...r.turns.flatMap((t) => [...t.entries, ...t.entries.flatMap((e) => e.reactions)]),
            ...r.endOfRound,
        ]);
        const shieldEntries = entries.filter((e) => e.kind === 'shield');
        expect(shieldEntries).toHaveLength(1);
        expect(shieldEntries[0].actorId).toBe('enemy-front');
        expect(shieldEntries[0].targets).toEqual([{ targetId: 'enemy-front', amount: 5_000 }]);
    });
});
