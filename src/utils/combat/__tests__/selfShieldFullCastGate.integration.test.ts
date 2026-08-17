/**
 * `self-shield-full` on the CAST path — proves `postDebuffGateCtx` (playerTurn.ts) actually
 * populates `selfShieldFull` for the per-slot timed-SELF-buff loop (`timedSelfBySlot`, gated via
 * `conditionsMet(status.conditions, postDebuffGateCtx)`). Before this fix, `postDebuffGateCtx` was
 * the one round context (of the four `buildRoundContext` call sites in playerTurn.ts) missing the
 * field: an ON-CAST ability gated on `self-shield-full` would read the DPS-safe `false` default
 * and never fire, silently, regardless of the caster's real shield.
 *
 * No corpus ship gates an ON-CAST ability on this subject (Quixilver R2, the only shipped
 * `self-shield-full` consumer, drains reactively at end-of-turn via a different context —
 * engine.ts's `isSelfShieldFull`/`buildDrainContext`, unaffected by this gap). So this ability is
 * SYNTHETIC: a duration-based (not hit-counted) named self-buff on an active slot. Using
 * `duration` rather than `hits` still lands it in `timedSelfBySlot` (engine.ts's `isAura` check
 * requires a non-numeric duration; `hits` is not needed to avoid the aura branch) without pulling
 * in the hit-consumption machinery a real Barrier would need.
 *
 * Fixtures are POSITIONAL (position + parsed target + a real enemy), modelled on
 * malvexTargetShieldGate.integration.test.ts (the sibling suite for `enemy-shield`, the OTHER
 * subject this branch added) — the legacy non-positional path folds multi-hit into a damage
 * multiplier and never resolves a positioned actor, so it's not useful here either, even though
 * this test's own gate reads a scalar shieldPool rather than a per-hit amount.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, type CombatEngineInput } from '../engine';
import { createEventBus } from '../events';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';
import type { CombatActor } from '../state';

const HP = 10_000_000; // the gate's max-HP side; also large enough nothing ever dies.

/** Synthetic on-cast self-buff gated on the caster's OWN shield being at (or above) max HP.
 *  `duration: 1` (not `hits`) keeps it out of the aura branch (engine.ts's `isAura` requires a
 *  non-numeric duration) while skipping hit-consumption semantics real Barrier abilities need —
 *  this test only cares whether the grant fires, not how it decays. */
const gatedFullShieldBuff = (): Ability => ({
    id: 'full-shield-grant',
    type: 'buff',
    target: 'self',
    trigger: 'on-cast',
    conditions: [{ subject: 'self-shield-full', derivable: true }],
    config: {
        type: 'buff',
        buffName: 'FullShieldGrant',
        parsedEffects: {},
        stacks: 1,
        isStackable: false,
        duration: 1,
    },
});

const noopDamage = (): Ability => ({
    id: 'noop-dmg',
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 0 },
});

const parsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

/** A passive (0-attack) enemy — present only because the engine needs a target to resolve the
 *  turn against; this test never inspects damage. */
const passiveEnemy = (id: string, position: Position, speed: number): EnemyAttacker =>
    ({
        id,
        stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: HP, speed },
        chargeCount: 0,
        startCharged: false,
        position,
        target: parsedTarget('front'),
        pattern: basePattern(),
        shipSkills: { slots: [{ slot: 'active', abilities: [noopDamage()] }] } as ShipSkills,
    }) as EnemyAttacker;

const BASE_PLAYER_SIDE = (overrides: Partial<CombatEngineInput>): CombatEngineInput => ({
    enemyAttackers: [],
    attack: 0,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    speed: 1000,
    position: 'M4',
    target: parsedTarget('front'),
    pattern: basePattern(),
    shipSkills: { slots: [{ slot: 'active', abilities: [gatedFullShieldBuff(), noopDamage()] }] },
    enemyDefense: 0,
    enemyHp: HP,
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
    hp: HP,
    healTargetId: 'attacker',
    mode: 'healing',
    ...overrides,
});

function collectFor(input: CombatEngineInput) {
    const bus = createEventBus();
    const applied: { actorId: string; buffName: string }[] = [];
    bus.on('buff-applied', (e) => applied.push({ actorId: e.actorId, buffName: e.buffName }));
    const result = runCombat({ ...input, bus });
    return { applied, result };
}

/** Seeds a shield pool on one actor before round 1 — the gate's sole input. */
const seedShield = (actorId: string, pool: number) => (actors: CombatActor[]) => {
    const a = actors.find((x) => x.id === actorId);
    if (a) a.shieldPool = pool;
};

describe('self-shield-full gate (cast path) — player-side caster', () => {
    it('does NOT grant the buff when the caster has no shield', () => {
        // The mutation canary: with `selfShieldFull` missing from `postDebuffGateCtx`, this case
        // is unaffected (it's already false-by-default) but the sibling positive case below flips.
        const input = BASE_PLAYER_SIDE({
            enemyAttackers: [passiveEnemy('enemy-1', 'M1', 1)],
        });
        const { applied } = collectFor(input);

        expect(applied).not.toContainEqual({ actorId: 'attacker', buffName: 'FullShieldGrant' });
    });

    it('DOES grant the buff when the caster carries a shield at 100% of its max HP', () => {
        // Same fixture, one difference — the CASTER's own shield pool is at max HP, which is
        // exactly what playerTurn.ts's postDebuffGateCtx.selfShieldFull now reads.
        const input = BASE_PLAYER_SIDE({
            enemyAttackers: [passiveEnemy('enemy-1', 'M1', 1)],
            __testTapActors: seedShield('attacker', HP),
        });
        const { applied } = collectFor(input);

        expect(applied).toContainEqual({ actorId: 'attacker', buffName: 'FullShieldGrant' });
    });
});

describe('self-shield-full gate (cast path) — team symmetry (enemy-side caster)', () => {
    // The gate lives in runPlayerTurn, which both sides walk, and reads the ACTING actor's own
    // shieldPool — so an enemy-side caster must gate identically. Roles are swapped: the enemy
    // holds the gated buff, the player focus is just a passive target.
    const enemySideInput = (overrides: Partial<CombatEngineInput>): CombatEngineInput =>
        BASE_PLAYER_SIDE({
            shipSkills: { slots: [{ slot: 'active', abilities: [noopDamage()] }] },
            enemyAttackers: [
                {
                    id: 'holder',
                    stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: HP, speed: 1000 },
                    chargeCount: 0,
                    startCharged: false,
                    position: 'M1',
                    target: parsedTarget('front'),
                    pattern: basePattern(),
                    shipSkills: {
                        slots: [
                            { slot: 'active', abilities: [gatedFullShieldBuff(), noopDamage()] },
                        ],
                    } as ShipSkills,
                } as EnemyAttacker,
            ],
            ...overrides,
        });

    it('does NOT grant the buff when the enemy holder has no shield', () => {
        const { applied } = collectFor(enemySideInput({}));

        expect(applied).not.toContainEqual({ actorId: 'holder', buffName: 'FullShieldGrant' });
    });

    it('DOES grant the buff when the enemy holder carries a shield at 100% of its max HP', () => {
        const { applied } = collectFor(
            enemySideInput({ __testTapActors: seedShield('holder', HP) })
        );

        expect(applied).toContainEqual({ actorId: 'holder', buffName: 'FullShieldGrant' });
    });
});
