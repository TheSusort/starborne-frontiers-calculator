/**
 * D-PR16 — Lockdown (Buff Protection) ENGINE-LEVEL integration test.
 *
 * Lockdown: "When this unit RESISTS an incoming debuff, there is an X% chance to grant
 * Buff Protection to ALL allies for 1 turn." It rides the new `on-debuff-resisted`
 * reactive trigger — self-scoped on the `debuff-resisted` event (targetId === ownerId,
 * the RESISTER) — and grants the whole same side a `Buff Protection` buff
 * (target = 'all-allies' → the reactive buff executor routes to ctx.playerIds).
 *
 * The `debuff-resisted` event is emitted on multiple paths, and Lockdown chains off ALL
 * of them. Two cases cover the two routes that matter:
 *
 *   1. DIRECT (normal hacking/affinity resist): an enemy attacker with hacking 0 casts a
 *      TIMED debuff at the carrier every round. The live landing roll fails → the cast-side
 *      `emitDebuffResisted` fires with targetId = the carrier. Over enough rounds the proc
 *      gate (legendary 0.16) accumulates and fires → the team carries Buff Protection.
 *
 *   2. SYNERGY (headline — chains off D-PR15's Block-Debuff auto-resist): the carrier holds
 *      a recurring `Block Debuff` self-buff (D-PR15). A high-hacking enemy WOULD land its
 *      timed debuff, but the Block-Debuff immunity fold auto-resists it and emits
 *      `debuff-resisted` from `debuffImmunity.ts`. That same event drives Lockdown → the
 *      team gains Buff Protection. Proves the full Block-Debuff → resist → Lockdown chain.
 *
 * Both exercise the FULL registry path (NOT direct ability injection): a Lockdown implant
 * is equipped via a stubbed `getGearPiece` + `setBonus='LOCKDOWN'`,
 * `buildShipAbilitiesWithEquipment` merges the reactive buff-grant into the passive slot,
 * and the engine wires up the `on-debuff-resisted` listener. The control (same setup, NO
 * Lockdown) proves non-vacuity: with no Lockdown there are ZERO Buff Protection self-buffs.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setRateGateRng, resetRateGateRng } from '../../calculators/rateAccumulator';
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

/**
 * An enemy attacker that casts a timed Def Down debuff at the player carrier each round.
 * `hacking` drives the live landing roll vs the carrier's default security 100:
 *   - 0   → landing 0 → the debuff is RESISTED every round (cast-side `debuff-resisted`).
 *   - 200 → landing 1 → the debuff would LAND (used in the synergy case where the carrier's
 *           Block Debuff auto-resists it instead).
 * speed 10 → acts AFTER the speed-100 carrier so the carrier's recurring self-buffs (Block
 * Debuff in the synergy case) are already live when this enemy casts.
 */
const debuffEnemy = (id: string, hacking: number): EnemyAttacker =>
    ({
        id,
        stats: {
            attack: 1,
            crit: 0,
            critDamage: 0,
            defence: 0,
            hp: 1_000_000_000,
            speed: 10,
            hacking,
        },
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
                                application: 'inflict',
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

/** A recurring `Block Debuff` self-buff on the focus actor (D-PR15) — drives the synergy path. */
const blockDebuffPassive: ShipSkills['slots'][number] = {
    slot: 'passive',
    abilities: [
        {
            id: 'block-debuff-self',
            type: 'buff',
            target: 'self',
            trigger: 'on-cast',
            conditions: [],
            config: {
                type: 'buff',
                buffName: 'Block Debuff',
                stacks: 1,
                isStackable: false,
                duration: 'recurring',
                parsedEffects: {},
            },
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
    numRounds: 12,
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
    speed: 100, // faster than the enemy (speed 10) → its recurring self-buffs are live first
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

// Build the carrier's skills via the REAL registry path: a legendary Lockdown implant,
// optionally fused with a recurring Block Debuff self-buff (synergy path).
function buildLockdownSkills(opts: { withBlockDebuff?: boolean } = {}): ShipSkills {
    const ship = makeShip({ implants: { implant_major: 'lockdown-legendary' } });
    const getGearPiece = (id: string): GearPiece | undefined =>
        id === 'lockdown-legendary'
            ? makePiece({ id, slot: 'implant_major', rarity: 'legendary', setBonus: 'LOCKDOWN' })
            : undefined;
    const baseSkills = buildShipAbilitiesWithEquipment(ship, getGearPiece);
    const passive = baseSkills.slots.find((s) => s.slot === 'passive');
    // Merge the Lockdown reactive grant with the optional Block Debuff self-buff into one
    // passive slot (the engine reads all passive abilities from a single passive slot).
    const passiveAbilities = [
        ...(opts.withBlockDebuff ? blockDebuffPassive.abilities : []),
        ...(passive ? passive.abilities : []),
    ];
    return {
        slots: [
            noopActive,
            ...(passiveAbilities.length
                ? [{ slot: 'passive' as const, abilities: passiveAbilities }]
                : []),
        ],
    };
}

describe('D-PR16 Lockdown (on-debuff-resisted → all-ally Buff Protection)', () => {
    // Lockdown's all-ally grant is procChance-gated (legendary 0.16). Force always-fire so a
    // qualifying debuff-resisted event grants Buff Protection — recovers the deterministic
    // "fires ≥ once over the run" intent. Debuff-landing gates are unaffected: a hacking-0
    // attacker resists at rate 0 (0 < 0 is false), and Block Debuff auto-resists outside the gate.
    beforeEach(() => setRateGateRng(() => 0));
    afterEach(() => resetRateGateRng());

    it('DIRECT: grants the team Buff Protection when the carrier resists incoming debuffs (registry path)', () => {
        const lockdownSkills = buildLockdownSkills();

        // Pre-condition: the Lockdown reactive buff-grant landed in the passive slot.
        const passive = lockdownSkills.slots.find((s) => s.slot === 'passive');
        expect(passive).toBeDefined();
        const ld = passive!.abilities.find((a) => a.id.startsWith('equip-implant-LOCKDOWN'));
        expect(ld).toBeDefined();

        // Enemy hacking 0 → every cast is RESISTED → cast-side `debuff-resisted` fires with
        // targetId = the carrier every round. 12 rounds; legendary rate 0.16 fires on the
        // ceil(1/0.16)=7th qualifying event → at least one Buff Protection granted to the team.
        const count = buffAppliedOn(
            BASE(lockdownSkills, { enemyAttackers: [debuffEnemy('enemy-deb', 0)] }),
            'Buff Protection',
            'attacker'
        );
        expect(count).toBeGreaterThan(0);
    });

    it('SYNERGY: a Block Debuff auto-resist drives Lockdown → team gains Buff Protection (chains off D-PR15)', () => {
        // Carrier holds a recurring Block Debuff self-buff AND a legendary Lockdown implant.
        // The enemy (hacking 200) WOULD land its timed debuff, but Block Debuff auto-resists
        // it and emits `debuff-resisted` (debuffImmunity.ts) with targetId = the carrier →
        // Lockdown's on-debuff-resisted listener fires → all-allies Buff Protection.
        const synergySkills = buildLockdownSkills({ withBlockDebuff: true });

        const count = buffAppliedOn(
            BASE(synergySkills, { enemyAttackers: [debuffEnemy('enemy-deb', 200)] }),
            'Buff Protection',
            'attacker'
        );
        expect(count).toBeGreaterThan(0);
    });

    it('control: WITHOUT Lockdown the team never gains Buff Protection (non-vacuity)', () => {
        // Same Block-Debuff carrier + high-hacking enemy (resists fire), but NO Lockdown implant.
        const bareSkills: ShipSkills = { slots: [noopActive, blockDebuffPassive] };
        const count = buffAppliedOn(
            BASE(bareSkills, { enemyAttackers: [debuffEnemy('enemy-deb', 200)] }),
            'Buff Protection',
            'attacker'
        );
        expect(count).toBe(0);
    });
});
