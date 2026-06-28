/**
 * perVictimAttacked.integration.test.ts — PR7 Task 2: per-victim `attacked` emission at the
 * FOCUS player→enemy positional site.
 *
 * BEFORE this task the player→enemy positional firing emitted ONE `attacked` event for the
 * PRIMARY anchor victim only (focusEnemyHit / tgt.id). Covered footprint victims took damage
 * silently — their on-attacked reactives never woke, and no `attacked` event ever named them.
 *
 * This task replaces the focus-only accumulation with a per-EVERY-victim signal map and emits one
 * `attacked` per victim via `emitPerVictimAttacked` (isPrimaryTarget only on the anchor). So a
 * COVERED enemy now receives an `attacked` event (it did not before).
 *
 * Harness mirrors enemySideAttacked.integration.test.ts / perVictimLeech.test.ts: a player FOCUS
 * attacker positioned at M4 firing `front` with an AoE Line-Range-1 pattern (so the footprint
 * expands), anchoring the front enemy (M4) and covering the enemy behind it (M3). We capture the
 * `attacked` events off the bus and assert the covered enemy id appears (it did NOT before), the
 * anchor carries isPrimaryTarget:true, and the covered one does not. A single-target (base)
 * pattern is the non-vacuous control: the covered enemy then gets NO `attacked` event.
 *
 * Crit 0 keeps everything deterministic.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

const parsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});

// AoE pattern: origin + one covered cell one step toward back (Pattern-Line-Range-1). Anchored at
// the FRONT enemy (M4) it covers the cell behind (M3) — both are HIT by the firing damage.
const lineRange1Pattern = (): ParsedPattern => ({
    raw: 'line-range-1',
    shape: 'line',
    range: 1,
    modifiers: {},
});

// Origin-only (single-target) footprint — the non-vacuous control: only the anchor is hit.
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });

// A no-passive single-hit basic-attack active slot (multiplier 100% = 1x, 1 hit).
const basicAttack = (): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities: [
        {
            id: 'pva-basic',
            type: 'damage',
            target: 'enemy',
            trigger: 'on-cast',
            conditions: [],
            config: { type: 'damage', multiplier: 100 },
        },
    ],
});

// A positioned, finite-HP enemy with zero offense (a stationary, damageable target). Huge HP so
// the firing hit never kills it (kept alive → it can be resolved as a victim).
const enemyAt = (id: string, position: Position): EnemyAttacker =>
    ({
        id,
        stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000_000, speed: 1 },
        chargeCount: 0,
        startCharged: false,
        position,
        shipSkills: { slots: [] } as ShipSkills,
    }) as EnemyAttacker;

/**
 * A positional battle where the PLAYER FOCUS ('attacker') fires at the enemy roster. Focus at M4,
 * fires `front` with the supplied pattern + a 100% damage active. Two enemies: the anchor at M4
 * (front) and a covered enemy at M3 (one step behind — inside the Line-Range-1 footprint).
 */
const BASE = (pattern: ParsedPattern): CombatEngineInput => ({
    attack: 5_000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [basicAttack()] },
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
    pattern,
    enemyAttackers: [enemyAt('enemy-anchor', 'M4'), enemyAt('enemy-covered', 'M3')],
});

/** Run a battle capturing every `attacked` event off the bus. */
const collectAttacked = (input: CombatEngineInput) => {
    const bus = createEventBus();
    const attacked: Extract<CombatEvent, { type: 'attacked' }>[] = [];
    bus.on('attacked', (e) => attacked.push(e));
    const result = runCombat({ ...input, bus });
    return { result, attacked };
};

describe('PR7 Task 2 — per-victim attacked at the focus player→enemy site', () => {
    it('a COVERED enemy now receives an attacked event (it did not before)', () => {
        const { attacked } = collectAttacked(BASE(lineRange1Pattern()));
        const anchorEvents = attacked.filter((e) => e.targetId === 'enemy-anchor');
        const coveredEvents = attacked.filter((e) => e.targetId === 'enemy-covered');
        // The fix: the covered footprint victim now appears as an attacked target.
        expect(coveredEvents.length).toBeGreaterThan(0);
        // The anchor still gets its event too.
        expect(anchorEvents.length).toBeGreaterThan(0);
    });

    it('only the ANCHOR carries isPrimaryTarget; the covered victim does not', () => {
        const { attacked } = collectAttacked(BASE(lineRange1Pattern()));
        const anchorEvents = attacked.filter((e) => e.targetId === 'enemy-anchor');
        const coveredEvents = attacked.filter((e) => e.targetId === 'enemy-covered');
        expect(anchorEvents.length).toBeGreaterThan(0);
        expect(coveredEvents.length).toBeGreaterThan(0);
        for (const e of anchorEvents) expect(e.isPrimaryTarget).toBe(true);
        for (const e of coveredEvents) expect(e.isPrimaryTarget).not.toBe(true);
    });

    it('NON-VACUOUS control: a single-target (base) pattern emits NO attacked for the covered enemy', () => {
        const { attacked } = collectAttacked(BASE(basePattern()));
        // The anchor (primary target) still gets its event.
        expect(attacked.filter((e) => e.targetId === 'enemy-anchor').length).toBeGreaterThan(0);
        // The covered enemy is outside a single-target footprint → never attacked.
        expect(attacked.filter((e) => e.targetId === 'enemy-covered').length).toBe(0);
    });
});
