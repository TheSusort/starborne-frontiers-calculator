/**
 * transformIncomingToDot.test.ts — SP-E Task E3: Voron/Orel damage→generic-DoT transform.
 *
 * Voron ("When directly damaged, this Unit transforms the damage into a Damage over Time
 * effect lasting for 3 turns") and Orel (same, gated on the ATTACKER holding Taunt or Provoke)
 * both build a `{ type: 'transform-incoming-to-dot', turns, condition }` reactive self-ability
 * (trigger:'on-attacked', target:'self'; see modelCompletenessTriage.test.ts for the parser
 * coverage). This file exercises the RUNTIME consumption in engine.ts's `applyVictimDamage`
 * funnel: on a matching direct hit, the FULL post-block damage is replaced — 0 immediate HP/
 * shield impact — by a generic self-DoT of `damage / turns` per round for `turns` rounds.
 *
 * Harness mirrors malvexShieldedReduction.integration.test.ts (positional runCombat, abilities
 * injected directly rather than parsed from CSV text — the parser wiring itself is covered by
 * the triage probes). Team symmetry: the SAME ability config must behave identically whether the
 * transform carrier is a PLAYER team victim (enemy→player positional path) or an ENEMY victim
 * (player→enemy positional path).
 *
 * MEASUREMENT: `hp-changed` events (oldPct/newPct) give the actual net HP delta AFTER the
 * transform hook runs — unlike `attacked`'s `damage` field (computed BEFORE applyVictimDamage is
 * even called, so it always reports the raw intended hit regardless of the transform) or
 * `perTargetDamage` (fed by the same pre-call value for the direct-hit path). `dot-ticked` events
 * (dotType 'generic') give the exact reduced tick amount.
 *
 * TURN ORDER: the victim is given a much HIGHER speed than the attacker so the victim's own
 * turn-start DoT-tick step for a round runs BEFORE that round's incoming hit is applied — no
 * same-round tick can occur from an entry the hit itself just created. This keeps "0 immediate
 * damage this hit" and "the tick lands on the entry's NEXT turn" cleanly separated per round.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput, TeamActorEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
type TeamActor = NonNullable<CombatEngineInput['teamActors']>[number];

const DIRECT_HIT = 5000; // attack 5000 × 100% × 1 hit vs defence 0.
const TURNS = 3;
const RAW_TICK = DIRECT_HIT / TURNS; // 1666.666...
const SPA_REDUCED_TICK = RAW_TICK * 0.8; // Voron's own 20%-less-from-DoT reduction (SP-A).

// Voron's transform: unconditional.
const voronTransform: Ability = {
    id: 'voron-transform',
    type: 'transform-incoming-to-dot',
    target: 'self',
    trigger: 'on-attacked',
    conditions: [],
    config: { type: 'transform-incoming-to-dot', turns: TURNS, condition: 'always' },
};
// SP-A: Voron's OWN "takes 20% less damage from Damage over Time effects" — the transform's
// generic ticks must still respect this existing, already-shipped reduction (coupling check).
const voronDotReduction: Ability = {
    id: 'voron-dot-reduction',
    type: 'incoming-reduction',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'incoming-reduction',
        scope: 'dot',
        condition: 'always',
        pct: 20,
        critFamily: false,
    },
};
const voronPassive: ShipSkills['slots'][number] = {
    slot: 'passive',
    abilities: [voronTransform, voronDotReduction],
};

// Orel's transform: gated on the ATTACKER holding Taunt or Provoke.
const orelTransform: Ability = {
    id: 'orel-transform',
    type: 'transform-incoming-to-dot',
    target: 'self',
    trigger: 'on-attacked',
    conditions: [],
    config: {
        type: 'transform-incoming-to-dot',
        turns: TURNS,
        condition: 'attacker-taunted-or-provoke',
    },
};
const orelPassive: ShipSkills['slots'][number] = {
    slot: 'passive',
    abilities: [orelTransform],
};

// A self-buff granting Taunt (99-turn duration — effectively "for the whole test run").
const tauntSelfBuff: Ability = {
    id: 'attacker-taunt',
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
};

let basicAttackCounter = 0;
const basicAttack = (): Ability => ({
    id: `basic-${++basicAttackCounter}`,
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 100 },
});

const parsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });

/** Collects `hp-changed` and `dot-ticked` events for one targetId. */
function collectFor(
    input: CombatEngineInput,
    targetId: string
): {
    hpChanges: { round: number; oldPct: number; newPct: number }[];
    genericTicks: { round: number; damage: number }[];
} {
    const bus = createEventBus();
    const hpChanges: { round: number; oldPct: number; newPct: number }[] = [];
    const genericTicks: { round: number; damage: number }[] = [];
    bus.on('hp-changed', (e: Extract<CombatEvent, { type: 'hp-changed' }>) => {
        if (e.targetId === targetId)
            hpChanges.push({ round: e.round, oldPct: e.oldPct, newPct: e.newPct });
    });
    bus.on('dot-ticked', (e: Extract<CombatEvent, { type: 'dot-ticked' }>) => {
        if (e.targetId === targetId && e.dotType === 'generic') {
            genericTicks.push({ round: e.round, damage: e.damage });
        }
    });
    runCombat({ ...input, bus });
    return { hpChanges, genericTicks };
}

const HP = 10_000_000; // large enough nothing ever dies; small enough pct math stays precise.

// ─────────────────────────────────────────────────────────────────────────────
// PLAYER-side Voron: a fast, positioned player TEAM victim hit by a slow ENEMY attacker.
// ─────────────────────────────────────────────────────────────────────────────

const playerVoron = (id: string, position: Position): TeamActor =>
    ({
        id,
        speed: 1000, // acts (and ticks) BEFORE the attacker every round.
        chargeCount: 0,
        startCharged: false,
        selfBuffs: [],
        enemyDebuffs: [],
        position,
        walk: {
            shipSkills: { slots: [voronPassive] }, // no active ability needed — it never attacks.
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
    }) as TeamActorEngineInput;

const offensiveEnemy = (
    id: string,
    position: Position,
    selection: ParsedTarget['selection']
): EnemyAttacker =>
    ({
        id,
        stats: { attack: DIRECT_HIT, crit: 0, critDamage: 0, defence: 0, hp: HP, speed: 1 },
        chargeCount: 0,
        startCharged: false,
        position,
        target: parsedTarget(selection),
        pattern: basePattern(),
        shipSkills: { slots: [{ slot: 'active', abilities: [basicAttack()] }] },
    }) as EnemyAttacker;

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

const BASE_PLAYER_SIDE = (overrides: Partial<CombatEngineInput>): CombatEngineInput => ({
    attack: 0,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [noopActive] },
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
    ...overrides,
});

describe('Voron replaces a direct hit with a generic DoT (D/turns per tick, SP-A reduction intact) — PLAYER side', () => {
    it('the direct hit itself never drains HP — total HP lost across the run equals ONLY the generic-tick damage, never the raw 5000/hit', () => {
        const input = BASE_PLAYER_SIDE({
            numRounds: 2,
            teamActors: [playerVoron('voron', 'M4')],
            enemyAttackers: [offensiveEnemy('enemy-1', 'M1', 'front')],
        });
        const { hpChanges, genericTicks } = collectFor(input, 'voron');
        // Both rounds' direct hit resolved (some hp-changed events fire — either a zero-delta
        // emit from a pure transform, or a real drop from a same-round generic tick).
        expect(hpChanges.length).toBeGreaterThanOrEqual(2);
        const totalHpLost = hpChanges.reduce(
            (sum, c) => sum + ((c.oldPct - c.newPct) / 100) * HP,
            0
        );
        const totalTickDamage = genericTicks.reduce((sum, t) => sum + t.damage, 0);
        // If either direct hit had landed for real (unreduced 5000, or even reduced by some
        // OTHER unrelated channel), totalHpLost would exceed totalTickDamage by a large margin
        // (5000 vs ~1333/tick). Equality proves EVERY HP-affecting event traces back to a
        // generic-DoT tick, never the raw direct hit.
        expect(totalHpLost).toBeCloseTo(totalTickDamage, 6);
    });

    it('the created generic DoT ticks at exactly D/turns × 0.8 (SP-A’s 20%-less-from-DoT reduction applies)', () => {
        const input = BASE_PLAYER_SIDE({
            numRounds: 2,
            teamActors: [playerVoron('voron', 'M4')],
            enemyAttackers: [offensiveEnemy('enemy-1', 'M1', 'front')],
        });
        const { genericTicks } = collectFor(input, 'voron');
        // Round 1 creates the first stack (untouched this round — the victim's own turn-start
        // tick step already ran before the hit landed). Round 2's tick step ticks that stack
        // ONCE, before round 2's hit creates a second stack — so exactly one tick is observed,
        // and it is the FIRST stack's first (and only fully isolated) tick.
        expect(genericTicks.length).toBeGreaterThanOrEqual(1);
        expect(genericTicks[0].damage).toBeCloseTo(SPA_REDUCED_TICK, 6);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// ENEMY-side Voron: team symmetry — a positioned ENEMY victim hit by the PLAYER focus attacker.
// ─────────────────────────────────────────────────────────────────────────────

const enemyVoron = (id: string): EnemyAttacker =>
    ({
        id,
        stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: HP, speed: 1000 },
        chargeCount: 0,
        startCharged: false,
        position: 'M4',
        target: parsedTarget('front'),
        pattern: basePattern(),
        shipSkills: { slots: [voronPassive] },
    }) as EnemyAttacker;

const BASE_ENEMY_SIDE = (overrides: Partial<CombatEngineInput>): CombatEngineInput => ({
    attack: DIRECT_HIT, // the player focus attack → the hit landing on the enemy Voron.
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [{ slot: 'active', abilities: [basicAttack()] }] },
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
    speed: 1, // focus attacker acts LAST — mirrors the player-side setup's turn order.
    healTargetId: 'attacker',
    position: 'M4',
    target: parsedTarget('front'),
    pattern: basePattern(),
    ...overrides,
});

describe('Voron replaces a direct hit — ENEMY side (team symmetry)', () => {
    it('the direct hit itself never drains HP — identical invariant to the player-side case', () => {
        const input = BASE_ENEMY_SIDE({ enemyAttackers: [enemyVoron('voron')] });
        const { hpChanges, genericTicks } = collectFor(input, 'voron');
        expect(hpChanges.length).toBeGreaterThanOrEqual(2);
        const totalHpLost = hpChanges.reduce(
            (sum, c) => sum + ((c.oldPct - c.newPct) / 100) * HP,
            0
        );
        const totalTickDamage = genericTicks.reduce((sum, t) => sum + t.damage, 0);
        expect(totalHpLost).toBeCloseTo(totalTickDamage, 6);
    });

    it('the created generic DoT ticks at exactly D/turns × 0.8, identical to the player-side value', () => {
        const input = BASE_ENEMY_SIDE({ enemyAttackers: [enemyVoron('voron')] });
        const { genericTicks } = collectFor(input, 'voron');
        expect(genericTicks.length).toBeGreaterThanOrEqual(1);
        expect(genericTicks[0].damage).toBeCloseTo(SPA_REDUCED_TICK, 6);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Orel: the transform is gated on the ATTACKER holding Taunt or Provoke.
// ─────────────────────────────────────────────────────────────────────────────

const playerOrel = (id: string, position: Position): TeamActor =>
    ({
        id,
        speed: 1000,
        chargeCount: 0,
        startCharged: false,
        selfBuffs: [],
        enemyDebuffs: [],
        position,
        walk: {
            shipSkills: { slots: [orelPassive] },
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
    }) as TeamActorEngineInput;

/** An enemy attacker with NO Taunt/Provoke — plain basic attack only. */
const plainEnemy = (id: string, position: Position, selection: ParsedTarget['selection']) =>
    offensiveEnemy(id, position, selection);

/** An enemy attacker that ALSO self-casts Taunt (99-turn duration) alongside its basic attack. */
const tauntedEnemy = (
    id: string,
    position: Position,
    selection: ParsedTarget['selection']
): EnemyAttacker =>
    ({
        id,
        stats: { attack: DIRECT_HIT, crit: 0, critDamage: 0, defence: 0, hp: HP, speed: 1 },
        chargeCount: 0,
        startCharged: false,
        position,
        target: parsedTarget(selection),
        pattern: basePattern(),
        shipSkills: { slots: [{ slot: 'active', abilities: [tauntSelfBuff, basicAttack()] }] },
    }) as EnemyAttacker;

describe('Orel: transform gated on the attacker being Taunted or Provoked', () => {
    it('does NOT transform when the attacker carries neither Taunt nor Provoke — the hit lands normally', () => {
        const input = BASE_PLAYER_SIDE({
            numRounds: 1,
            teamActors: [playerOrel('orel', 'M4')],
            enemyAttackers: [plainEnemy('enemy-1', 'M1', 'front')],
        });
        const { hpChanges, genericTicks } = collectFor(input, 'orel');
        // The hit landed for real: a genuine HP drop (oldPct - newPct corresponds to DIRECT_HIT
        // over the victim's HP pool), not a zero-delta transform emission.
        expect(hpChanges.length).toBeGreaterThanOrEqual(1);
        const drop = hpChanges.reduce((sum, c) => sum + (c.oldPct - c.newPct), 0);
        expect(drop).toBeGreaterThan(0);
        expect((drop / 100) * HP).toBeCloseTo(DIRECT_HIT, 6);
        // No generic DoT was ever created.
        expect(genericTicks.length).toBe(0);
    });

    it('DOES transform once the attacker holds Taunt — every hit is fully replaced, and the generic DoT ticks at the raw D/turns amount (no SP-A-style reduction on Orel)', () => {
        // 3 rounds: the attacker self-casts Taunt every round (idempotent, non-stacking) alongside
        // its basic attack — live from round 1 onward. Every one of the 3 hits is transformed, so
        // (mirroring the Voron invariant above) the ONLY HP loss across the whole run traces back
        // to generic-DoT ticks, never a raw 5000 direct hit.
        const input = BASE_PLAYER_SIDE({
            numRounds: 3,
            teamActors: [playerOrel('orel', 'M4')],
            enemyAttackers: [tauntedEnemy('enemy-1', 'M1', 'front')],
        });
        const { hpChanges, genericTicks } = collectFor(input, 'orel');
        expect(hpChanges.length).toBeGreaterThanOrEqual(1);
        const totalHpLost = hpChanges.reduce(
            (sum, c) => sum + ((c.oldPct - c.newPct) / 100) * HP,
            0
        );
        const totalTickDamage = genericTicks.reduce((sum, t) => sum + t.damage, 0);
        expect(totalHpLost).toBeCloseTo(totalTickDamage, 6);
        // A generic DoT (no SP-A-style reduction on Orel) ticks at the raw D/turns amount.
        expect(genericTicks.length).toBeGreaterThanOrEqual(1);
        expect(genericTicks[0].damage).toBeCloseTo(RAW_TICK, 6);
    });
});
