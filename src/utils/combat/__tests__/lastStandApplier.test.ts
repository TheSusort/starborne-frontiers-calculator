/**
 * D-PR16 — Last Stand (last-standing → self Barrier + Block Debuff co-grant) ENGINE-LEVEL test.
 *
 * Last Stand: "When this unit becomes the last one standing, X% chance to gain Barrier AND
 * Block Debuff (self) for 1 turn." It rides the `on-ally-destroyed` trigger (which fires for each
 * surviving same-side ally when an ally dies) gated on the `last-standing` condition subject
 * (true iff the owner is the SOLE living actor on its own side). The gate narrows the trigger to
 * precisely the ally-death that leaves the owner alone. One proc roll co-grants BOTH buffs via the
 * Task-5 `alsoGrantBuffNames` → `additionalBuffs` co-grant.
 *
 * Forcing the proc deterministically: `passesProcChanceGate` (triggers.ts) PASSES UNCONDITIONALLY
 * when `procChance >= 1`, AND the engine's drain orders the `last-standing` condition gate BEFORE
 * the proc gate — so the proc accumulator only advances on the single qualifying (sole-survivor)
 * event. A fresh rate accumulator at the registry's 0.32 rate does NOT fire on its first event, so
 * the single last-standing event cannot drive a real-rate proc deterministically. We therefore
 * inject the ability with `procChance: 1` (every other field — trigger, target, the `last-standing`
 * condition, the 'Barrier' buff name + `alsoGrantBuffNames: ['Block Debuff']`, 1-turn duration —
 * matches the registry exactly, buildEquipmentAbilities.ts LAST_STAND). This is the same determinism
 * device the sibling integration suites use (cfProvokeAppliers forces procChance: 1). The registry's
 * exact per-rarity proc table + ability shape are covered by equipmentCoverage.test.ts.
 *
 * Cases:
 *  - GRANT (headline): a 2-actor player team; the carrier becomes sole survivor when the OTHER ally
 *    dies → the carrier carries BOTH Barrier AND Block Debuff (proves the one-roll co-grant).
 *  - NO-FIRE control: with ≥2 allies still alive, an ally death that does NOT leave the carrier
 *    alone grants NEITHER buff (proves the last-standing gate, not trigger vacuity).
 *  - ENEMY-side mirror: an enemy carrier becomes last-standing among the enemy roster → gains both
 *    buffs (proves team-agnosticism through the real enemy set-site + drain seam).
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput, TeamActorEngineInput } from '../engine';
import { createEventBus } from '../events';
import { Ability, ShipSkills } from '../../../types/abilities';
import type { Position } from '../../../types/encounters';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

// ---------------------------------------------------------------------------
// Shared ability shapes (match the registry, procChance forced to 1)
// ---------------------------------------------------------------------------

/** Last Stand: on-ally-destroyed self Barrier (1 turn) + co-granted Block Debuff (1 turn), gated on
 *  `last-standing`. proc forced to 1 → the single sole-survivor event reliably grants both buffs. */
const lastStandAbility: Ability = {
    id: 'equip-implant-LAST_STAND',
    type: 'buff',
    target: 'self',
    trigger: 'on-ally-destroyed',
    conditions: [{ subject: 'last-standing', derivable: true }],
    procChance: 1, // >= 1 → passesProcChanceGate is unconditional (deterministic)
    config: {
        type: 'buff',
        buffName: 'Barrier',
        parsedEffects: {},
        stacks: 1,
        isStackable: false,
        duration: 1,
        additionalBuffs: [
            {
                buffName: 'Block Debuff',
                parsedEffects: {},
                stacks: 1,
                isStackable: false,
                duration: 1,
            },
        ],
    } as Ability['config'],
    autoFilled: true,
};

/** A 100% / 1-hit basic attack active slot (for a killing actor). */
const basicAttack = (): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities: [
        {
            id: 'basic-atk',
            type: 'damage',
            target: 'enemy',
            trigger: 'on-cast',
            conditions: [],
            config: { type: 'damage', multiplier: 100, hits: 1 },
        },
    ],
});

/** A no-op (0-damage) active so the owner takes a turn without killing anything. */
const noopActive: ShipSkills['slots'][number] = {
    slot: 'active',
    abilities: [
        {
            id: 'noop-atk',
            type: 'damage',
            target: 'enemy',
            trigger: 'on-cast',
            conditions: [],
            config: { type: 'damage', multiplier: 0 },
        },
    ],
};

// ---------------------------------------------------------------------------
// Harness builders
// ---------------------------------------------------------------------------

/** A positioned, inert team ally with a fixed HP (so an enemy hit can kill it). */
function ally(id: string, position: Position, hp: number): TeamActorEngineInput {
    return {
        id,
        speed: 10, // slower than the enemy so the enemy hits (and kills) it before it acts
        chargeCount: 0,
        startCharged: false,
        selfBuffs: [],
        enemyDebuffs: [],
        position,
        walk: {
            shipSkills: { slots: [] },
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
}

/** A non-positional enemy attacker that hits the heal target each round (real damage). */
const enemyHitter = (id: string, attack: number, hp = 1_000_000_000, speed = 1000): EnemyAttacker =>
    ({
        id,
        stats: { attack, crit: 0, critDamage: 0, defence: 0, hp, speed },
        chargeCount: 0,
        startCharged: false,
        shipSkills: { slots: [basicAttack()] },
    }) as EnemyAttacker;

const BASE = (overrides: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
    attack: 1,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [noopActive, { slot: 'passive', abilities: [lastStandAbility] }] },
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
    hp: 1_000_000_000, // focus survives
    speed: 1, // slowest → the enemy kills the ally before the focus acts
    position: 'M2',
    ...overrides,
});

/** Run combat and report how many `buff-applied` events for `buffName` landed on `actorId`. */
function buffAppliedOn(input: CombatEngineInput, buffName: string, actorId: string): number {
    const bus = createEventBus();
    let count = 0;
    bus.on('buff-applied', (e) => {
        if (e.buffName === buffName && e.actorId === actorId) count++;
    });
    runCombat({ ...input, bus });
    return count;
}

describe('D-PR16 Last Stand (last-standing → self Barrier + Block Debuff co-grant)', () => {
    it('grants BOTH Barrier and Block Debuff to the carrier when it becomes the sole survivor (one roll)', () => {
        // focus 'attacker' + ONE ally (T2). The enemy hits the heal target (the ally) for lethal
        // damage → the ally dies → on-ally-destroyed fires on the surviving focus → the focus is
        // now the only living player → last-standing gate true → the forced proc grants BOTH the
        // primary Barrier AND the co-granted Block Debuff in the same application.
        const input = BASE({
            teamActors: [ally('ally-T2', 'T2', 3_000)],
            healTargetId: 'ally-T2',
            enemyAttackers: [enemyHitter('enemy-atk', 5_000)],
        });

        const barrier = buffAppliedOn(input, 'Barrier', 'attacker');
        const blockDebuff = buffAppliedOn(input, 'Block Debuff', 'attacker');

        expect(barrier).toBeGreaterThan(0); // primary buff landed
        expect(blockDebuff).toBeGreaterThan(0); // co-granted buff landed on the SAME roll
    });

    it('control: does NOT grant either buff when an ally death does not leave the carrier alone', () => {
        // focus + TWO allies (T2 dies, M3 survives with huge HP). One ally dies → on-ally-destroyed
        // still fires on the focus, but TWO players remain alive (focus + M3) → focus is NOT the
        // sole survivor → last-standing gate false → neither buff granted (proves the gate).
        const input = BASE({
            teamActors: [ally('ally-T2', 'T2', 3_000), ally('ally-M3', 'M3', 1_000_000_000)],
            healTargetId: 'ally-T2',
            enemyAttackers: [enemyHitter('enemy-atk', 5_000)],
        });

        expect(buffAppliedOn(input, 'Barrier', 'attacker')).toBe(0);
        expect(buffAppliedOn(input, 'Block Debuff', 'attacker')).toBe(0);
    });

    it('enemy-side mirror: an enemy carrier becomes last-standing and gains BOTH buffs', () => {
        // Team-agnosticism through the real positional two-team seam (twoTeamBattle harness). The
        // player focus fires `front` against the enemy roster and kills the fragile front enemy;
        // the back enemy carrier (huge HP + Last Stand passive) survives → it is now the sole
        // living enemy → enemy-side on-ally-destroyed fires on the carrier → last-standing gate
        // true → the forced proc co-grants Barrier + Block Debuff onto the enemy carrier.
        const parsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
            raw: selection,
            side: 'enemy',
            selection,
        });
        const basePattern = (): ParsedPattern => ({
            raw: 'base',
            shape: 'base',
            range: 0,
            modifiers: {},
        });

        // Fragile front enemy: the focus's `front` shot kills it (5000 dmg vs 1 HP).
        const frontEnemy: EnemyAttacker = {
            id: 'enemy-front',
            stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 1, speed: 1 },
            chargeCount: 0,
            startCharged: false,
            position: 'M4',
            target: parsedTarget('front'),
            pattern: basePattern(),
            shipSkills: { slots: [noopActive] },
        } as EnemyAttacker;

        // Back enemy carrier: huge HP (survives) + the Last Stand passive. When the front enemy
        // dies it becomes the sole living enemy → its on-ally-destroyed reaction's last-standing
        // gate passes → forced proc co-grants both buffs.
        const enemyCarrier: EnemyAttacker = {
            id: 'enemy-carrier',
            stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000_000, speed: 1 },
            chargeCount: 0,
            startCharged: false,
            position: 'M1',
            target: parsedTarget('back'),
            pattern: basePattern(),
            shipSkills: {
                slots: [noopActive, { slot: 'passive', abilities: [lastStandAbility] }],
            },
        } as EnemyAttacker;

        const input: CombatEngineInput = {
            ...BASE(),
            // Player focus fires `front` with lethal damage and acts first (speed 1000).
            attack: 5000,
            speed: 1000,
            shipSkills: { slots: [basicAttack()] },
            position: 'M4',
            target: parsedTarget('front'),
            pattern: basePattern(),
            healTargetId: 'attacker', // required when enemyAttackers are present
            teamActors: [], // no positional player ally needed
            enemyAttackers: [frontEnemy, enemyCarrier],
            numRounds: 2,
        };

        expect(buffAppliedOn(input, 'Barrier', 'enemy-carrier')).toBeGreaterThan(0);
        expect(buffAppliedOn(input, 'Block Debuff', 'enemy-carrier')).toBeGreaterThan(0);
    });
});
