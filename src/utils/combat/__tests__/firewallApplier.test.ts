/**
 * D-PR16 — Firewall (Block Debuff) ENGINE-LEVEL integration test.
 *
 * Firewall: "When debuffed, there is an X% chance to gain Block Debuff for 1 turn."
 * It rides the new `on-debuffed` reactive trigger — self-scoped on the `debuff-applied`
 * event (targetId === ownerId) — and grants the owner a `Block Debuff` self-buff.
 *
 * This exercises the FULL registry path (NOT direct ability injection): a player carrier
 * equips a legendary Firewall implant via a stubbed `getGearPiece` + `setBonus='FIREWALL'`,
 * `buildShipAbilitiesWithEquipment` merges the reactive buff-grant into the passive slot,
 * and the engine wires up the `on-debuffed` listener. An enemy attacker lands a timed
 * (non-DoT) debuff on the carrier every round, emitting `debuff-applied` with
 * targetId = the carrier → the listener fires → the proc gate (legendary 0.15) accumulates.
 *
 * Forcing the proc deterministically: the rate-accumulator gate at rate 0.15 fires on the
 * ceil(1/0.15)=7th qualifying event. Driving 10 qualifying debuff events guarantees at
 * least one fire, so the carrier MUST end up carrying `Block Debuff` (buff-applied emitted
 * with actorId = the carrier). The control (same setup, NO Firewall) proves non-vacuity:
 * with no Firewall there are ZERO `Block Debuff` self-buffs.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus } from '../events';
import { ShipSkills } from '../../../types/abilities';
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
    } as Ship;
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
    } as GearPiece;
}

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

/** An enemy attacker that lands a timed Def Down debuff on the player focus every round.
 *  application:'apply' always lands (no affinity disadvantage here) → emits debuff-applied
 *  with targetId = the carrier ('attacker') every round. */
const debuffEnemy = (id: string): EnemyAttacker =>
    ({
        id,
        stats: { attack: 1, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000_000, speed: 1000 },
        chargeCount: 0,
        startCharged: false,
        shipSkills: {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        {
                            id: 'enemy-debuff',
                            type: 'debuff',
                            target: 'enemy', // enemy's "enemy" = the player carrier
                            trigger: 'on-cast',
                            conditions: [],
                            config: {
                                type: 'debuff',
                                buffName: 'Def Down',
                                parsedEffects: {},
                                stacks: 1,
                                isStackable: false,
                                application: 'apply',
                                duration: 1,
                            },
                        },
                    ],
                },
            ],
        },
    }) as EnemyAttacker;

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
    enemyDefense: 0,
    enemyHp: 1_000_000_000,
    numRounds: 10,
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
    speed: 1, // slower than the enemy → enemy debuffs the carrier each round before it acts
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

// Build the carrier's skills via the REAL registry path: a legendary Firewall implant.
function buildFirewallSkills(): ShipSkills {
    const ship = makeShip({ implants: { implant_major: 'firewall-legendary' } });
    const getGearPiece = (id: string): GearPiece | undefined =>
        id === 'firewall-legendary'
            ? makePiece({ id, slot: 'implant_major', rarity: 'legendary', setBonus: 'FIREWALL' })
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

describe('D-PR16 Firewall (on-debuffed → self Block Debuff)', () => {
    it('grants the carrier Block Debuff when an enemy repeatedly debuffs it (registry path)', () => {
        const firewallSkills = buildFirewallSkills();

        // Pre-condition: the Firewall reactive buff-grant landed in the passive slot.
        const passive = firewallSkills.slots.find((s) => s.slot === 'passive');
        expect(passive).toBeDefined();
        const fw = passive!.abilities.find((a) => a.id.startsWith('equip-implant-FIREWALL'));
        expect(fw).toBeDefined();

        // 10 qualifying debuff events; legendary rate 0.15 fires on the 7th → at least one
        // Block Debuff self-buff applied to the carrier.
        const count = buffAppliedOn(
            BASE(firewallSkills, { enemyAttackers: [debuffEnemy('enemy-deb')] }),
            'Block Debuff',
            'attacker'
        );
        expect(count).toBeGreaterThan(0);
    });

    it('control: WITHOUT Firewall the carrier never gains Block Debuff (non-vacuity)', () => {
        const bareSkills: ShipSkills = { slots: [noopActive] };
        const count = buffAppliedOn(
            BASE(bareSkills, { enemyAttackers: [debuffEnemy('enemy-deb')] }),
            'Block Debuff',
            'attacker'
        );
        expect(count).toBe(0);
    });
});
