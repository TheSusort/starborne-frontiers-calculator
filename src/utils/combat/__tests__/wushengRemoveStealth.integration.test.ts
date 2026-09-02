/**
 * Ship-kit Wave 8 Task 11 — Wusheng "if directly damaged while Stealth is active, remove
 * Stealth" engine dispatch coverage.
 *
 * wave8Wusheng.test.ts (abilities/__tests__) only asserts the parsed ability SHAPE — a
 * `remove-self-buff` ability for Stealth on the `on-attacked` trigger, gated on `self-buff`
 * Stealth being active. Nothing there exercises the reactive ENGINE path proving the trigger
 * actually DISPATCHES and the removal actually fires at runtime. This file mirrors
 * wisteriaSelfCritDot.integration.test.ts's structure: a direct registerReactiveListeners unit
 * test, plus a full runCombat integration test.
 *
 * The `on-attacked` trigger is a pre-existing LIVE trigger (triggers.ts's `case 'on-attacked':`,
 * registered generically for ANY ability type on that trigger — see e.g. the Task 8
 * "on-attacked engine integration" suite in triggers.test.ts). This file's job is to prove the
 * NEW `remove-self-buff` + `on-attacked` combination specifically dispatches and actually removes
 * the buff, not just that the ability shape parses correctly.
 */
import { describe, expect, it } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { Ability } from '../../../types/abilities';
import { registerReactiveListeners, Intent, ReactiveAbility } from '../triggers';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
type TeamActor = NonNullable<CombatEngineInput['teamActors']>[number];

// ── Direct unit test of registerReactiveListeners ──────────────────────────────────────────
describe('Wusheng remove-Stealth-on-attacked — reactive listener (unit)', () => {
    it('enqueues only for the OWNER’s own "attacked" event (target-scoped, mirrors on-attacked’s standard contract)', () => {
        const listeners = new Map<string, ((e: CombatEvent) => void)[]>();
        const handBus = {
            on<T extends CombatEvent['type']>(
                type: T,
                listener: (event: Extract<CombatEvent, { type: T }>) => void
            ) {
                const existing = listeners.get(type) ?? [];
                listeners.set(type, [...existing, listener as unknown as (e: CombatEvent) => void]);
            },
            emit(event: CombatEvent) {
                for (const l of listeners.get(event.type) ?? []) l(event);
            },
        };

        const enqueued: Intent[] = [];

        const removeStealthAbility: Ability = {
            id: 'wusheng-remove-stealth',
            type: 'remove-self-buff',
            target: 'self',
            trigger: 'on-attacked',
            conditions: [{ subject: 'self-buff', buffName: 'Stealth', derivable: true }],
            config: { type: 'remove-self-buff', buffName: 'Stealth', scope: 'all' },
        };
        const ra: ReactiveAbility = { ability: removeStealthAbility, sourceSlot: 'passive' };

        registerReactiveListeners({
            bus: handBus,
            perOwner: [{ ownerId: 'victim', reactiveAbilities: [ra] }],
            enqueue: (intent) => enqueued.push(intent),
            isOpposing: (id) => id === 'attacker-enemy',
        });

        // Scenario A: the OWNER is directly hit → enqueues.
        handBus.emit({
            type: 'attacked',
            targetId: 'victim',
            attackerId: 'attacker-enemy',
            round: 1,
            damage: 100,
        });
        expect(enqueued).toHaveLength(1);

        // Scenario B: a DIFFERENT actor is hit → not the owner → excluded.
        handBus.emit({
            type: 'attacked',
            targetId: 'someone-else',
            attackerId: 'attacker-enemy',
            round: 1,
            damage: 100,
        });
        expect(enqueued).toHaveLength(1);
    });
});

// ── Integration test (engine-level, via runCombat) ─────────────────────────────────────────
//
// Positional setup mirroring incomingReductionEngine.test.ts: a single positioned
// PLAYER victim (fastest, casts a self-Stealth buff on its own turn) faces TWO positioned enemy
// attackers targeting the same 'front' slot, at DIFFERENT speeds so both hits land within round 1
// in a fixed order: victim casts Stealth first, enemy-1 hits second (Stealth active → the 25%
// incoming-reduction ability applies AND the new remove-self-buff reactive fires, dropping
// Stealth), enemy-2 hits third (Stealth now gone → full damage, no reduction).
//
// Each enemy hits for a firing 5000 (attack 5000, defence 0). WITH the removal ability: hit 1 is
// reduced to 3750 (25% off), hit 2 lands the full 5000 → cumulative 8750. WITHOUT the removal
// ability (only the grant + incoming-reduction, i.e. the pre-Task-11 behaviour): Stealth is NEVER
// removed, so BOTH hits are reduced → cumulative 7500. The 1250 gap between these two totals is
// the load-bearing proof that the on-attacked removal genuinely fires mid-round and changes the
// SECOND hit's damage — not just that the ability shape parses.
const parsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });

// Grants the caster Stealth (duration 99) on its own cast. Single round → no re-cast concerns.
const stealthSelfBuff = (id: string): Ability => ({
    id,
    type: 'buff',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'buff',
        buffName: 'Stealth',
        parsedEffects: {},
        stacks: 1,
        isStackable: false,
        duration: 99,
    },
});

// Wusheng's existing 25% direct-scope incoming reduction gated on self-stealth (D-PR3's
// self-stealth IncomingCondition — unaffected by this task, included so the reduction's
// interaction with the NEW removal is exercised end-to-end).
const incomingReductionAbility: Ability = {
    id: 'wusheng-incoming-reduction',
    type: 'incoming-reduction',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'incoming-reduction',
        scope: 'direct',
        condition: 'self-stealth',
        pct: 25,
        critFamily: false,
    },
};

// The Task 11 ability under test.
const removeStealthAbility: Ability = {
    id: 'wusheng-remove-stealth',
    type: 'remove-self-buff',
    target: 'self',
    trigger: 'on-attacked',
    conditions: [{ subject: 'self-buff', buffName: 'Stealth', derivable: true }],
    config: { type: 'remove-self-buff', buffName: 'Stealth', scope: 'all' },
};

const playerVictim = (includeRemoval: boolean, hp: number): TeamActor => ({
    id: 'victim',
    speed: 1000, // acts before both enemies so Stealth is up when they attack
    chargeCount: 0,
    startCharged: false,
    selfBuffs: [],
    enemyDebuffs: [],
    position: 'M4',
    walk: {
        shipSkills: {
            slots: [
                { slot: 'active', abilities: [stealthSelfBuff('victim-stealth')] },
                {
                    slot: 'passive',
                    abilities: includeRemoval
                        ? [incomingReductionAbility, removeStealthAbility]
                        : [incomingReductionAbility],
                },
            ],
        },
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

// A positioned enemy attacker: attack 5000 x 100% x 1 hit vs defence 0 -> 5000 firing-hit.
const flatOffensiveEnemy = (id: string, position: Position, speed: number): EnemyAttacker => ({
    id,
    stats: { attack: 5000, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000_000, speed },
    chargeCount: 0,
    startCharged: false,
    position,
    target: parsedTarget('front'),
    pattern: basePattern(),
    shipSkills: {
        slots: [
            {
                slot: 'active',
                abilities: [
                    {
                        id: `${id}-hit`,
                        type: 'damage',
                        target: 'enemy',
                        trigger: 'on-cast',
                        conditions: [],
                        config: { type: 'damage', multiplier: 100 },
                    },
                ],
            },
        ],
    },
});

const BASE = (overrides: Partial<CombatEngineInput>): CombatEngineInput => ({
    enemyAttackers: [],
    attack: 0,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [{ slot: 'active', abilities: [stealthSelfBuff('focus-stealth')] }] },
    // The focus is pinned to the back of the middle row AND cloaked.
    //
    // It used to be off the board entirely, and that is what kept both enemies' targeting on the
    // stealthed victim: `resolvePositionalTarget` drops stealthed cells UNLESS every candidate is
    // stealthed, and with the victim the only placed player actor that "restore all" branch always
    // fired. The normalization boundary places the focus too, so an un-stealthed focus becomes the
    // one visible cell and soaks both hits. Cloaking it restores the restore-all branch for hit 1
    // (both cloaked → front->back scan in the enemies' own row M resolves onto the victim at M4),
    // and once the victim's Stealth is STRIPPED it is the only visible cell, so hit 2 lands on it
    // too — which is precisely the sequence under test.
    position: 'M1',
    speed: 2000, // ahead of every victim/enemy, so the focus's Stealth is up before anyone fires
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
    healTargetId: 'attacker', // healing mode → positioned enemy roster is built
    mode: 'healing',
    ...overrides,
});

const destroyedIds = (input: CombatEngineInput): Set<string> => {
    const bus = createEventBus();
    const ids = new Set<string>();
    bus.on('ship-destroyed', (e) => ids.add(e.actorId));
    runCombat({ ...input, bus });
    return ids;
};

const diesAt = (build: (hp: number) => CombatEngineInput, hp: number, victimId: string): boolean =>
    destroyedIds(build(hp)).has(victimId);

describe('Wusheng remove-Stealth-on-attacked — engine integration (runCombat)', () => {
    // enemy-1 (speed 5) acts before enemy-2 (speed 1); both act after the victim (speed 1000).
    // The victim's HP is set per-call on the TeamActor's walk.stats.hp so diesAt's death-bracket
    // idiom (survives at hp+1, dies at hp) pins the exact cumulative damage landed.
    const buildFor = (includeRemoval: boolean, hp: number): CombatEngineInput => {
        const victim = playerVictim(includeRemoval, hp);
        return BASE({
            teamActors: [victim],
            enemyAttackers: [
                flatOffensiveEnemy('enemy-1', 'M1', 5),
                flatOffensiveEnemy('enemy-2', 'M2', 1),
            ],
        });
    };

    it('WITH the removal ability: hit 2 loses the reduction after Stealth is stripped (dies at cumulative 8750, not 7500)', () => {
        const build = (hp: number) => buildFor(true, hp);
        // Cumulative with the fix: 3750 (reduced hit 1) + 5000 (full hit 2) = 8750 — strictly
        // MORE than the 7500 the control scenario (below) totals, proving hit 2 was NOT reduced.
        expect(diesAt(build, 8750, 'victim')).toBe(true);
        expect(diesAt(build, 8751, 'victim')).toBe(false);
    });

    it('control WITHOUT the removal ability: Stealth is never stripped, BOTH hits stay reduced (dies at cumulative 7500)', () => {
        const build = (hp: number) => buildFor(false, hp);
        // Cumulative without removal: 3750 + 3750 = 7500 (both hits reduced).
        expect(diesAt(build, 7500, 'victim')).toBe(true);
        expect(diesAt(build, 7501, 'victim')).toBe(false);
        // Never reaches the WITH-removal total of 8750.
        expect(diesAt(build, 8750, 'victim')).toBe(false);
    });
});
