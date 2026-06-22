/**
 * D-PR14 — Bulwark (Provoke) + Doomsayer (Concentrate Fire) ENGINE-LEVEL integration tests.
 *
 * These prove the full reactive/end-of-round debuff-applier chain works END TO END through
 * `runCombat` with REAL board positions and turn order — the threading hops the per-task unit
 * tests cannot catch: listener registration → adjacency / first-activator gate → proc gate →
 * once-per-round gate → target resolution (counterTargetId / enemy-highest-attack) → debuff
 * landing → `debuff-applied` emit.
 *
 * Read mechanism: the engine emits a `debuff-applied` event the moment a reactive/end-of-round
 * debuff LANDS, carrying `sourceId` (the applier/owner) and `targetId` (the victim). This is the
 * codebase-exposed observable for the whole chain — strictly stronger than `provokerOf`, which
 * reads the status engine directly (runCombat does not expose its statusEngine). `provokerOf`'s
 * read path is covered by forcedTargetingStatus.test.ts; here we assert the same fact the engine
 * persists (Provoke on the attacker, applied by the Bulwark owner) via the public event stream.
 *
 * Forcing procs deterministically: `passesProcChanceGate` (triggers.ts) PASSES UNCONDITIONALLY
 * when `procChance >= 1`. So the abilities are injected directly into the owner's passive slot
 * with `procChance: 1` — every other field (trigger, target, oncePerRound, requireDamagedAllyAdjacent,
 * the `first-activator` condition, the 'Provoke'/'Concentrate Fire' buff names, 1-turn duration)
 * matches the registry exactly (buildEquipmentAbilities.ts BULWARK/DOOMSAYER). This is the same
 * determinism device the sibling integration suites use (Fortifying Shroud drops procChance;
 * Second Wind / Insidiousness inject a known procChance). The registry's exact per-rarity proc
 * tables + ability shape are covered by cfProvokeRegistry.test.ts.
 *
 * Board geometry (matches board.ts: M2 ↔ T1,T2,M1,M3,B1,B2):
 *   Bulwark owner at M2 → adjacent = T2, M3; NON-adjacent = B4.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput, TeamActorEngineInput } from '../engine';
import { createEventBus } from '../events';
import { Ability, ShipSkills } from '../../../types/abilities';
import type { Position } from '../../../types/encounters';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

// ---------------------------------------------------------------------------
// Shared ability shapes (match the registry, procChance forced to 1)
// ---------------------------------------------------------------------------

/** Bulwark: on-ally-attacked Provoke (1 turn), once-per-round, adjacency-required. proc forced. */
const bulwarkAbility: Ability = {
    id: 'equip-implant-BULWARK',
    type: 'debuff',
    target: 'enemy',
    trigger: 'on-ally-attacked',
    conditions: [],
    procChance: 1, // >= 1 → passesProcChanceGate is unconditional (deterministic)
    oncePerRound: true,
    requireDamagedAllyAdjacent: true,
    config: {
        type: 'debuff',
        buffName: 'Provoke',
        parsedEffects: {},
        stacks: 1,
        isStackable: false,
        application: 'inflict',
        duration: 1,
    } as Ability['config'],
    autoFilled: true,
};

/** Doomsayer: end-of-round Concentrate Fire (1 turn) on the highest-attack enemy, gated by
 *  first-activator. proc forced. */
const doomsayerAbility: Ability = {
    id: 'equip-implant-DOOMSAYER',
    type: 'debuff',
    target: 'enemy-highest-attack',
    trigger: 'end-of-round',
    conditions: [{ subject: 'first-activator', derivable: true }],
    procChance: 1,
    config: {
        type: 'debuff',
        buffName: 'Concentrate Fire',
        parsedEffects: {},
        stacks: 1,
        isStackable: false,
        application: 'inflict',
        duration: 1,
    } as Ability['config'],
    autoFilled: true,
};

/** A 100% / 1-hit basic attack active slot. */
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

/** A positioned, inert team ally (no skills, big HP, no real damage). */
function ally(id: string, position: Position): TeamActorEngineInput {
    return {
        id,
        speed: 10, // slower than the focus / enemy so it never acts first
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
                hp: 1_000_000_000,
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
const enemyHitter = (id: string, speed = 5): EnemyAttacker =>
    ({
        id,
        stats: { attack: 5_000, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000_000, speed },
        chargeCount: 0,
        startCharged: false,
        shipSkills: { slots: [basicAttack()] },
    }) as EnemyAttacker;

/** Collect every `debuff-applied` event matching the given buffName. */
function debuffApplied(
    input: CombatEngineInput,
    buffName: string
): Array<{ sourceId: string; targetId: string; round: number }> {
    const bus = createEventBus();
    const out: Array<{ sourceId: string; targetId: string; round: number }> = [];
    bus.on('debuff-applied', (e) => {
        if (e.buffName === buffName) out.push({ sourceId: e.sourceId, targetId: e.targetId, round: e.round });
    });
    runCombat({ ...input, bus });
    return out;
}

// ---------------------------------------------------------------------------
// D-PR14 Bulwark — Provoke on adjacent-ally damage
// ---------------------------------------------------------------------------

describe('D-PR14 Bulwark (Provoke on adjacent-ally damage)', () => {
    /** Base input: focus 'attacker' (Bulwark owner) at M2; healing mode; the heal target is the
     *  ally that the enemy hits, so the `attacked` event names that ally as the damaged target. */
    const BASE = (overrides: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
        attack: 1,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: 0,
        shipSkills: { slots: [noopActive, { slot: 'passive', abilities: [bulwarkAbility] }] },
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
        speed: 100, // owner acts first; its passive listens for the ally hit
        position: 'M2',
        ...overrides,
    });

    const FOCUS = 'attacker';

    it('applies Provoke to the attacker when an adjacent ally is directly damaged', () => {
        // Adjacent ally 'ally-T2' at T2 is the heal target → the enemy hits it → owner at M2 is
        // adjacent → Bulwark fires → Provoke lands on the attacking enemy.
        const events = debuffApplied(
            BASE({
                teamActors: [ally('ally-T2', 'T2'), ally('ally-B4', 'B4')],
                healTargetId: 'ally-T2',
                enemyAttackers: [enemyHitter('enemy-atk')],
            }),
            'Provoke'
        );

        expect(events.length).toBeGreaterThan(0);
        // Applied BY the Bulwark owner (focus), ONTO the attacking enemy.
        expect(events.every((e) => e.sourceId === FOCUS)).toBe(true);
        expect(events.every((e) => e.targetId === 'enemy-atk')).toBe(true);
    });

    it('does NOT fire when the damaged ally is not adjacent (positional)', () => {
        // The heal target is 'ally-B4' at B4 (NON-adjacent to the M2 owner). The enemy hits B4;
        // the owner's on-ally-attacked listener runs but the requireDamagedAllyAdjacent gate
        // rejects it → no Bulwark Provoke. (Adjacent ally-T2 still present so the geometry is
        // positional, not the all-allies fallback — proving the adjacency gate, not vacuity.)
        const events = debuffApplied(
            BASE({
                teamActors: [ally('ally-T2', 'T2'), ally('ally-B4', 'B4')],
                healTargetId: 'ally-B4',
                enemyAttackers: [enemyHitter('enemy-atk')],
            }),
            'Provoke'
        );

        expect(events.length).toBe(0);
    });

    it('applies at most once per round', () => {
        // Two adjacent allies (T2, M3) are BOTH hit in one round (two enemy attackers, each
        // hitting a different adjacent ally). The owner's on-ally-attacked listener fires twice,
        // but oncePerRound consumes after the first successful proc → exactly one Provoke applied.
        // healTargetId is T2; a second enemy is positioned to hit M3 via positional targeting.
        const events = debuffApplied(
            BASE({
                numRounds: 1,
                position: 'M2',
                teamActors: [ally('ally-T2', 'T2'), ally('ally-M3', 'M3')],
                healTargetId: 'ally-T2',
                // Two positioned enemies in row M each select a player → both adjacent allies get
                // hit in the same round, producing two `attacked` events on adjacent allies.
                enemyAttackers: [
                    enemyHitter('enemy-1'),
                    enemyHitter('enemy-2'),
                ],
            }),
            'Provoke'
        );

        // oncePerRound: at most one Provoke per round regardless of how many adjacent allies
        // were hit. (Both enemies hit the heal target T2 — both adjacent — so the listener
        // enqueues at least twice; the gate still yields exactly one application.)
        expect(events.filter((e) => e.round === 1).length).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// D-PR14 Doomsayer — Concentrate Fire on the highest-attack enemy at end of round
// ---------------------------------------------------------------------------

describe('D-PR14 Doomsayer (Concentrate Fire on highest-attack enemy at end of round)', () => {
    const CF = 'Concentrate Fire';

    /** Base input: focus 'attacker' (Doomsayer owner); healing mode; two enemies with DIFFERENT
     *  attack so the highest-attack selection is unambiguous. */
    const BASE = (overrides: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
        attack: 1,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: 0,
        shipSkills: { slots: [noopActive, { slot: 'passive', abilities: [doomsayerAbility] }] },
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
        healTargetId: 'attacker',
        ...overrides,
    });

    /** A pure-target enemy with a fixed attack (no skills → never acts as first activator). */
    const enemyWithAttack = (id: string, attack: number, speed = 5): EnemyAttacker =>
        ({
            id,
            stats: { attack, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000_000, speed },
            chargeCount: 0,
            startCharged: false,
            shipSkills: { slots: [] },
        }) as EnemyAttacker;

    it('applies Concentrate Fire to the highest-attack enemy when the owner is first activator', () => {
        // Owner speed 1000 → it is the FIRST real activator of the round → first-activator gate
        // passes. Two enemies: low (3000 attack) and high (9000 attack). At end of round the
        // enemy-highest-attack selector picks the 9000-attack enemy → CF lands there.
        const events = debuffApplied(
            BASE({
                speed: 1000,
                enemyAttackers: [
                    enemyWithAttack('enemy-low', 3_000),
                    enemyWithAttack('enemy-high', 9_000),
                ],
            }),
            CF
        );

        expect(events.length).toBeGreaterThan(0);
        // Applied BY the Doomsayer owner, ONTO the highest-attack enemy.
        expect(events.every((e) => e.sourceId === 'attacker')).toBe(true);
        expect(events.every((e) => e.targetId === 'enemy-high')).toBe(true);
    });

    it('does NOT apply when the owner is not the first activator', () => {
        // A faster TEAM ally activates first → firstActivatorId is the ally, NOT the Doomsayer
        // owner → the first-activator condition fails at drain time → no CF applied.
        const fastAlly: TeamActorEngineInput = {
            id: 'fast-ally',
            speed: 5000, // strictly faster than the owner (1000) → activates first
            chargeCount: 0,
            startCharged: false,
            selfBuffs: [],
            enemyDebuffs: [],
            walk: {
                shipSkills: { slots: [basicAttack()] }, // a real action so it counts as an activator
                stats: {
                    attack: 1,
                    crit: 0,
                    critDamage: 0,
                    defensePenetration: 0,
                    hacking: 0,
                    defence: 0,
                    hp: 1_000_000_000,
                },
                selfDotModifier: 0,
                defensePenetrationBuff: 0,
                affinityDamageModifier: 0,
                affinityCritCap: 100,
                affinityCritPenalty: 0,
                hasChargedSkill: false,
            },
        };

        const events = debuffApplied(
            BASE({
                speed: 1000,
                teamActors: [fastAlly],
                enemyAttackers: [
                    enemyWithAttack('enemy-low', 3_000),
                    enemyWithAttack('enemy-high', 9_000),
                ],
            }),
            CF
        );

        expect(events.length).toBe(0);
    });

    it('enemy-side mirror: an enemy Doomsayer first-activator applies CF to the highest-attack PLAYER', () => {
        // Team-agnosticism: the Doomsayer owner is an ENEMY attacker that activates first (speed
        // 5000 > the focus 100). firstActivatorId is shared across the player/enemy drains, and
        // the enemy-side enemyWithHighestAttack resolves against the PLAYER roster. The player
        // team has two actors with different attack → CF lands on the higher one.
        // Exercises the real enemy set-site + drainEnemyIntents seam.
        const highAttackAlly: TeamActorEngineInput = {
            id: 'player-high',
            speed: 10,
            chargeCount: 0,
            startCharged: false,
            selfBuffs: [],
            enemyDebuffs: [],
            walk: {
                shipSkills: { slots: [] },
                stats: {
                    attack: 9_000, // highest-attack player → CF target
                    crit: 0,
                    critDamage: 0,
                    defensePenetration: 0,
                    hacking: 0,
                    defence: 0,
                    hp: 1_000_000_000,
                },
                selfDotModifier: 0,
                defensePenetrationBuff: 0,
                affinityDamageModifier: 0,
                affinityCritCap: 100,
                affinityCritPenalty: 0,
                hasChargedSkill: false,
            },
        };

        const doomEnemy: EnemyAttacker = {
            id: 'enemy-doom',
            stats: { attack: 1, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000_000, speed: 5000 },
            chargeCount: 0,
            startCharged: false,
            shipSkills: { slots: [noopActive, { slot: 'passive', abilities: [doomsayerAbility] }] },
        } as EnemyAttacker;

        const events = debuffApplied(
            BASE({
                // Focus 'attacker' = low-attack player (3000); team ally = high-attack (9000).
                attack: 3_000,
                speed: 100, // slower than the enemy Doomsayer (5000) → enemy is first activator
                teamActors: [highAttackAlly],
                healTargetId: 'attacker',
                enemyAttackers: [doomEnemy],
            }),
            CF
        );

        expect(events.length).toBeGreaterThan(0);
        // Applied BY the enemy Doomsayer, ONTO the highest-attack PLAYER actor.
        expect(events.every((e) => e.sourceId === 'enemy-doom')).toBe(true);
        expect(events.every((e) => e.targetId === 'player-high')).toBe(true);
    });
});
