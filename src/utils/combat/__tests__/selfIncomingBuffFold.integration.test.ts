/**
 * D-PR12 Task 3 — integration test for friendly-side incoming-damage buff fold.
 *
 * Before the engine change the buff is "emit-only": it is applied to the victim's own self
 * store but victimEnemyModifiers only reads the enemy-debuff store, so the incoming-damage
 * reduction is ignored and the victim takes the full hit.
 *
 * After the engine change victimIncomingModifiers reads BOTH stores (enemy-debuff + victim's
 * own self buffs), so an Inc. Damage Down self-buff reduces the landed hit.
 *
 * Harness mirrors incomingReductionEngine.test.ts (D-PR3 Task 6):
 *   - healingMode (healTargetId = 'attacker') → positioned enemy roster is built.
 *   - playerVictim: speed 1000 → acts BEFORE the enemy, so the self-buff is up when the enemy hits.
 *   - offensiveEnemy: attack 5000, speed 1, 100% multiplier → 5000 direct damage.
 *   - Inc. Damage Down II: incomingDamage = -30 → landed = 5000 × (1 − 0.30) = 3500.
 *   - HP bracket: victim hp = 4000 → DIES without buff (5000 > 4000), SURVIVES with buff (3500 < 4000).
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus } from '../events';
import { ShipSkills, Ability } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';

type TeamActor = NonNullable<CombatEngineInput['teamActors']>[number];
type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

// ── Targeting helpers ─────────────────────────────────────────────────────────
const parsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });

// ── Buff ability helpers ───────────────────────────────────────────────────────

/**
 * Self-buff ability that grants Inc. Damage Down II on the victim's own active turn.
 * parsedEffects.incomingDamage = -30 → the status payload carries incomingDamage: -30.
 * duration 2: the engine decrements on the SAME turn the buff is applied (post-victim-turn),
 * so duration 1 would expire before the enemy acts. duration 2 → 1 remaining when the enemy
 * fires → buff is active. (Mirrors how stealthSelfBuff uses duration 99 in the reference harness.)
 */
const incDamageDownSelfBuff = (id: string): Ability => ({
    id,
    type: 'buff',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'buff',
        buffName: 'Inc. Damage Down II',
        parsedEffects: { incomingDamage: -30 },
        stacks: 1,
        isStackable: false,
        duration: 2,
    },
});

// No-op damage: actor "casts" but deals 0 damage.
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

// ── Actor constructors ─────────────────────────────────────────────────────────

/**
 * A positioned PLAYER victim that optionally grants itself Inc. Damage Down II before being hit.
 * speed 1000 → acts before the enemy (speed 1) so the buff is active when the hit lands.
 */
const playerVictim = (
    id: string,
    position: Position,
    hp: number,
    opts: { incDamageDown?: boolean } = {}
): TeamActor => {
    const active: ShipSkills['slots'][number] = opts.incDamageDown
        ? {
              slot: 'active',
              abilities: [incDamageDownSelfBuff(`${id}-inc-dmg-down`)],
          }
        : noopActive;
    return {
        id,
        speed: 1000,
        chargeCount: 0,
        startCharged: false,
        selfBuffs: [],
        enemyDebuffs: [],
        position,
        walk: {
            shipSkills: { slots: [active] },
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
    };
};

/**
 * A positioned ENEMY attacker: attack 5000 × 100% × 1 hit vs defence 0 → 5000 damage.
 * speed 1 → acts AFTER the player victim so the victim's self-buff is up when the hit fires.
 */
const offensiveEnemy = (
    id: string,
    position: Position,
    selection: ParsedTarget['selection']
): EnemyAttacker =>
    ({
        id,
        stats: {
            attack: 5000,
            crit: 0,
            critDamage: 0,
            defence: 0,
            hp: 1_000_000_000,
            speed: 1,
        },
        chargeCount: 0,
        startCharged: false,
        position,
        target: parsedTarget(selection),
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
        } as ShipSkills,
    }) as EnemyAttacker;

// ── Engine input factory ───────────────────────────────────────────────────────
const BASE = (overrides: Partial<CombatEngineInput>): CombatEngineInput => ({
    attack: 0,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [noopActive] },
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
    healTargetId: 'attacker', // healing mode → positioned enemy roster is built
    ...overrides,
});

// ── Assertion helpers ──────────────────────────────────────────────────────────

/** Set of actor ids that emitted ship-destroyed in this run. */
const destroyedIds = (input: CombatEngineInput): Set<string> => {
    const bus = createEventBus();
    const ids = new Set<string>();
    bus.on('ship-destroyed', (e) => ids.add(e.actorId));
    runCombat({ ...input, bus });
    return ids;
};

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('D-PR12 Task 3 — friendly-side Inc. Damage Down folds into per-victim incoming modifier', () => {
    /**
     * Build a run where the player victim is hit by a 5000-attack enemy.
     * incDamageDown = true  → victim grants itself Inc. Damage Down II (-30%) on its own turn.
     * incDamageDown = false → victim casts a no-op, takes the full 5000.
     */
    const run = (hp: number, incDamageDown: boolean): CombatEngineInput =>
        BASE({
            teamActors: [playerVictim('victim', 'M4', hp, { incDamageDown })],
            enemyAttackers: [offensiveEnemy('enemy-1', 'M1', 'front')],
        });

    it('baseline: WITHOUT Inc. Damage Down the victim takes the full 5000 and dies at hp=4000', () => {
        // Full 5000 > 4000 → dies.
        expect(destroyedIds(run(4000, false)).has('victim')).toBe(true);
        // Full 5000 > 5000? No, 5000 = 5000 → exactly kills.
        expect(destroyedIds(run(5000, false)).has('victim')).toBe(true);
        // Full 5000 < 5001 → survives.
        expect(destroyedIds(run(5001, false)).has('victim')).toBe(false);
    });

    it('WITH Inc. Damage Down II (-30%) the victim takes 3500 and survives at hp=4000', () => {
        // Reduced 3500 < 4000 → victim SURVIVES.
        // (Before the engine change this FAILS: victim still dies because the buff is emit-only.)
        expect(destroyedIds(run(4000, true)).has('victim')).toBe(false);
    });

    it('WITH Inc. Damage Down II the victim dies at hp=3500 (pinned to 3500 taken)', () => {
        // Reduced 3500 = 3500 → exactly kills at hp=3500.
        expect(destroyedIds(run(3500, true)).has('victim')).toBe(true);
        // Survives at hp=3501.
        expect(destroyedIds(run(3501, true)).has('victim')).toBe(false);
    });
});
