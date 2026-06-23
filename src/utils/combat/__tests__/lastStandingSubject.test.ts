/**
 * D-PR16 — `last-standing` condition subject ENGINE-LEVEL wiring test (INFRASTRUCTURE).
 *
 * `last-standing` is true iff the owner is the SOLE living actor on its own side. No production
 * implant uses it yet (Task 6 wires Last Stand); this test proves the THREADING: the engine
 * computes a per-side sole-survivor id fresh each drain (soleSurvivorOf), the drain context maps
 * `lastStandingId === ownerId` → the `lastStanding` round-context flag → the `last-standing`
 * condition gate.
 *
 * Harness: a player focus 'attacker' carries a SINGLE benign self buff-grant ('Defense Up I')
 * gated on `last-standing`, triggered by `on-ally-destroyed`. An enemy kills a low-HP ally.
 *  - SOLE-SURVIVOR case: focus + ONE ally; the ally dies → focus is the only living player →
 *    gate true → buff granted (buff-applied emitted with actorId = focus).
 *  - CONTROL: focus + TWO allies; ONE ally dies → another ally still lives → focus is NOT the
 *    sole survivor → gate false → no buff granted. (The on-ally-destroyed listener still fires —
 *    a death occurs — so this proves the GATE, not vacuity of the trigger.)
 *
 * Buff grants are deterministic (no procChance on the grant). The 'Defense Up I' name is a benign
 * placeholder — Last Stand's real buffs are Task 6.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput, TeamActorEngineInput } from '../engine';
import { createEventBus } from '../events';
import { Ability, ShipSkills } from '../../../types/abilities';
import type { Position } from '../../../types/encounters';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

// ---------------------------------------------------------------------------
// Ability shapes
// ---------------------------------------------------------------------------

/** On an ally's death, IF the owner is the sole living actor on its side, grant itself a benign
 *  'Defense Up I' (1 turn). No procChance → the grant fires deterministically when the gate passes. */
const lastStandingGrant: Ability = {
    id: 'test-last-standing-grant',
    type: 'buff',
    target: 'self',
    trigger: 'on-ally-destroyed',
    conditions: [{ subject: 'last-standing', derivable: true }],
    config: {
        type: 'buff',
        buffName: 'Defense Up I',
        parsedEffects: {},
        stacks: 1,
        isStackable: false,
        duration: 1,
    },
    autoFilled: true,
};

/** No-op active so the focus takes a turn without ending combat early / killing anything. */
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

/** A 100% / 1-hit basic attack active slot (for the killing enemy). */
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

/** A non-positional enemy attacker that hits the heal target each round with real damage. */
const enemyHitter = (id: string, attack: number, speed = 1000): EnemyAttacker =>
    ({
        id,
        stats: { attack, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000_000, speed },
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
    shipSkills: { slots: [noopActive, { slot: 'passive', abilities: [lastStandingGrant] }] },
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

/** Run combat, returning [ # of buff-applied for buffName on actorId, # of ship-destroyed ]. */
function run(input: CombatEngineInput): { buffs: number; deaths: string[] } {
    const bus = createEventBus();
    let buffs = 0;
    const deaths: string[] = [];
    bus.on('buff-applied', (e) => {
        if (e.buffName === 'Defense Up I' && e.actorId === 'attacker') buffs++;
    });
    bus.on('ship-destroyed', (e) => deaths.push(e.actorId));
    runCombat({ ...input, bus });
    return { buffs, deaths };
}

describe('D-PR16 last-standing condition subject (engine wiring)', () => {
    it('grants the self buff when the owner becomes the sole living actor on its side', () => {
        // focus + ONE ally (T2). The enemy hits the heal target (the ally) for lethal damage →
        // the ally dies → on-ally-destroyed fires on the surviving focus → at drain the focus is
        // the only living player → last-standing gate true → Defense Up I granted to the focus.
        const { buffs, deaths } = run(
            BASE({
                teamActors: [ally('ally-T2', 'T2', 3_000)],
                healTargetId: 'ally-T2',
                enemyAttackers: [enemyHitter('enemy-atk', 5_000)],
            })
        );

        expect(deaths).toContain('ally-T2'); // the death actually happened (trigger fired)
        expect(buffs).toBeGreaterThan(0); // sole survivor → gate true → buff granted
    });

    it('control: does NOT grant when the owner is not the sole survivor (gate false)', () => {
        // focus + TWO allies (T2 dies, M3 survives). One ally dies → on-ally-destroyed still fires
        // on the focus, but TWO players remain alive (focus + M3) → focus is NOT the sole survivor
        // → last-standing gate false → no buff. Proves the gate, not trigger vacuity.
        const { buffs, deaths } = run(
            BASE({
                teamActors: [ally('ally-T2', 'T2', 3_000), ally('ally-M3', 'M3', 1_000_000_000)],
                healTargetId: 'ally-T2',
                enemyAttackers: [enemyHitter('enemy-atk', 5_000)],
            })
        );

        expect(deaths).toContain('ally-T2'); // the death still happened (trigger fired)
        expect(buffs).toBe(0); // not sole survivor → gate false → no buff
    });
});
