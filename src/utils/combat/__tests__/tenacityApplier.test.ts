/**
 * D-PR16 — Tenacity (Buff Protection) ENGINE-LEVEL integration test.
 *
 * Tenacity: "Upon directly receiving damage exceeding 25% of max HP, there is an X%
 * chance to grant Buff Protection to ALL allies for 2 turns." It rides the `on-attacked`
 * reactive trigger — target-scoped on the per-hit `attacked` event (targetId === ownerId)
 * — but adds a NEW damage-fraction gate (`requireIncomingDamageFracOfMaxHp: 0.25`): the
 * per-ATTACK aggregate damage carried on the event must exceed 25% of the carrier's
 * effective max HP. On a passing hit the proc gate (legendary 0.16) rolls; when it fires
 * the whole same side gains a `Buff Protection` buff (target = 'all-allies' → routes to
 * ctx.playerIds).
 *
 * Because the `attacked` event is emitted ONLY for direct weapon hits (DoT ticks, bomb
 * detonations, and accumulators never emit it), filtering on this event naturally means
 * "directly receiving damage". The DoT negative case below proves it.
 *
 * SURVIVAL TRICK (mirrors barrier.test.ts): the carrier also holds an always-active
 * `Barrier` self-buff so every incoming hit is fully nullified for HP purposes — the
 * carrier survives all rounds — yet the pre-barrier aggregate `damage` is still computed
 * and carried on the `attacked` event, so the >25% filter sees the real hit size. This
 * lets us drive enough qualifying hits to force the 0.16 rate-gate to fire.
 *
 * All cases exercise the FULL registry path (NOT direct ability injection): a Tenacity
 * implant is equipped via a stubbed `getGearPiece` + `setBonus='TENACITY'`,
 * `buildShipAbilitiesWithEquipment` merges the reactive buff-grant into the passive slot,
 * and the engine wires up the `on-attacked` listener. The controls (≤25% hit; DoT batch)
 * prove the new damage-fraction gate and the direct-only scoping respectively.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus } from '../events';
import { Ability, ShipSkills } from '../../../types/abilities';
import { Ship } from '../../../types/ship';
import { GearPiece } from '../../../types/gear';
import { buildShipAbilitiesWithEquipment } from '../../abilities/buildShipAbilitiesWithEquipment';

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

function makeShip(over: Partial<Ship>): Ship {
    return {
        id: 'test-ship',
        name: 'Test Ship',
        rarity: 'legendary',
        faction: 'AURELIAN_SOVEREIGNTY',
        type: 'DEFENDER',
        baseStats: {} as Ship['baseStats'],
        equipment: {},
        implants: {},
        refits: [],
        ...over,
    };
}

function makePiece(over: Partial<GearPiece>): GearPiece {
    return {
        id: 'piece-1',
        slot: 'implant_major',
        level: 16,
        stars: 6,
        rarity: 'legendary',
        mainStat: null,
        subStats: [],
        setBonus: null,
        ...over,
    };
}

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

let idCounter = 0;
const ab = (partial: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `tn${++idCounter}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...partial,
});

/** A manual flat enemy: one synthesized basic attack of `attack` damage, no skills.
 *  With the carrier's defence 0, the per-attack aggregate `damage` == `attack`. */
const manualEnemy = (
    id: string,
    attack: number,
    speed = 50,
    extra: Partial<EnemyAttacker> = {}
): EnemyAttacker => ({
    id,
    stats: { attack, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000_000, speed },
    chargeCount: 0,
    startCharged: false,
    ...extra,
});

/** An always-active, no-payload Barrier self-buff (same shape as barrier.test.ts) — fully
 *  nullifies incoming HP damage so the carrier survives every round while the pre-barrier
 *  aggregate `damage` is still carried on the `attacked` event. */
const barrierBuff = () => ({
    id: 'barrier',
    buffName: 'Barrier',
    stacks: 1,
    isStackable: false,
    parsedEffects: {},
});

const BASE = (
    shipSkills: ShipSkills,
    overrides: Partial<CombatEngineInput> = {}
): CombatEngineInput => ({
    enemyAttackers: [],
    attack: 1,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills,
    numRounds: 14,
    selfBuffs: [barrierBuff()],
    enemyDebuffs: [],
    selfDotModifier: 0,
    defensePenetrationBuff: 0,
    hasChargedSkill: false,
    startCharged: false,
    affinityDamageModifier: 0,
    affinityCritCap: 100,
    affinityCritPenalty: 0,
    defence: 0,
    hp: 10_000, // max HP → 25% threshold = 2500
    speed: 1, // slower than the enemy → the enemy attacks the carrier each round before it acts
    healTargetId: 'attacker',
    mode: 'healing',
    ...overrides,
});

/** Collect every `buff-applied` event for `buffName` on the given actor. */
function buffAppliedOn(input: CombatEngineInput, buffName: string, actorId: string): number {
    const bus = createEventBus();
    let count = 0;
    bus.on('buff-applied', (e) => {
        if (e.buffName === buffName && e.actorId === actorId) count++;
    });
    runCombat({ ...input, bus });
    return count;
}

/** No-op active so the focus takes a turn without ending the combat early. */
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

// Build the carrier's skills via the REAL registry path: a legendary Tenacity implant.
function buildTenacitySkills(): ShipSkills {
    const ship = makeShip({ implants: { implant_major: 'tenacity-legendary' } });
    const getGearPiece = (id: string): GearPiece | undefined =>
        id === 'tenacity-legendary'
            ? makePiece({ id, slot: 'implant_major', rarity: 'legendary', setBonus: 'TENACITY' })
            : undefined;
    const baseSkills = buildShipAbilitiesWithEquipment(ship, getGearPiece);
    const passive = baseSkills.slots.find((s) => s.slot === 'passive');
    return {
        slots: [
            noopActive,
            ...(passive ? [{ slot: passive.slot, abilities: passive.abilities }] : []),
        ],
    };
}

describe('D-PR16 Tenacity (on-attacked >25% max-HP → all-ally Buff Protection)', () => {
    beforeEach(() => {
        idCounter = 0;
    });

    it('grants the team Buff Protection when a direct hit exceeds 25% of max HP (registry path)', () => {
        const tenacitySkills = buildTenacitySkills();

        // Pre-condition: the Tenacity reactive buff-grant landed in the passive slot.
        const passive = tenacitySkills.slots.find((s) => s.slot === 'passive');
        expect(passive).toBeDefined();
        const tn = passive!.abilities.find((a) => a.id.startsWith('equip-implant-TENACITY'));
        expect(tn).toBeDefined();
        // …and it carries the new >25%-max-HP gate.
        expect(tn!.requireIncomingDamageFracOfMaxHp).toBe(0.25);

        // Enemy attack 3000 > 2500 (25% of the 10_000 max HP) → every hit qualifies. 14 rounds
        // of qualifying hits; legendary rate 0.16 fires on the ceil(1/0.16)=7th qualifying event
        // → at least one Buff Protection granted to the team. Barrier keeps the carrier alive.
        const count = buffAppliedOn(
            BASE(tenacitySkills, { enemyAttackers: [manualEnemy('big-hit', 3000)] }),
            'Buff Protection',
            'attacker'
        );
        expect(count).toBeGreaterThan(0);
    });

    it('control: a hit at or below 25% of max HP grants NOTHING (damage-fraction gate)', () => {
        const tenacitySkills = buildTenacitySkills();
        // Enemy attack 2000 < 2500 → never exceeds 25% → the gate blocks every event → no proc.
        const count = buffAppliedOn(
            BASE(tenacitySkills, { enemyAttackers: [manualEnemy('small-hit', 2000)] }),
            'Buff Protection',
            'attacker'
        );
        expect(count).toBe(0);
    });

    it('control: a DoT batch exceeding 25% grants NOTHING (DoT ticks emit no `attacked`)', () => {
        const tenacitySkills = buildTenacitySkills();
        // attack 0 → the ONLY incoming damage is a large corrosion DoT batch (well over 25% of
        // max HP). DoT ticks never emit the `attacked` event, so Tenacity's on-attacked listener
        // never fires → no Buff Protection, proving the trigger is "directly receiving damage".
        const corrosionDot = () =>
            ab({
                type: 'dot',
                target: 'enemy',
                config: { type: 'dot', dotType: 'corrosion', tier: 7, stacks: 10, duration: 14 },
            });
        const dotEnemy = manualEnemy('dot-enemy', 0, 50, {
            shipSkills: { slots: [{ slot: 'active', abilities: [corrosionDot()] }] },
        });
        const count = buffAppliedOn(
            BASE(tenacitySkills, { enemyAttackers: [dotEnemy], selfBuffs: [] }),
            'Buff Protection',
            'attacker'
        );
        expect(count).toBe(0);
    });
});
