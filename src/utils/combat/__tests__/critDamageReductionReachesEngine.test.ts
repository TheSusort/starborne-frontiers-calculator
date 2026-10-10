/**
 * Crit damage reduction (the tool's `damageReduction` stat) reaches combat damage on both sides
 * through the REAL ability builders, and sits inside the 70% non-defence cap.
 *
 * The stat is not read by the engine: it arrives as `incoming-reduction` abilities with
 * `condition: 'incoming-crit'` and `critFamily: true` — the Hardened set from
 * `buildShipAbilitiesWithEquipment` (equipment) and the parsed "N% damage reduction from critical
 * hits" innate. Reading `ActorStats.damageReduction` in the engine as well would double-count the
 * innate source, which `incomingReductionForHit` already resolves by max-of-crit-family. This
 * suite is the tripwire for the reaching; the cap rule lives at `capIncomingPct`.
 *
 * Observation: death brackets on a victim hit by a 5000-attack, 100%-multiplier, 100%-crit-damage
 * attacker at defence 0 (non-crit 5000, crit 10000). Six Hardened pieces are three complete sets:
 * 15% off a crit.
 */
import { describe, expect, it } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus } from '../events';
import { buildShipAbilitiesWithEquipment } from '../../abilities/buildShipAbilitiesWithEquipment';
import { Ship } from '../../../types/ship';
import { GearPiece } from '../../../types/gear';
import { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';

type TeamActor = NonNullable<CombatEngineInput['teamActors']>[number];
type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

const SLOTS = ['weapon', 'hull', 'generator', 'sensor', 'software', 'thrusters'] as const;

function hardenedShip(wearing: boolean): {
    ship: Ship;
    getGearPiece: (id: string) => GearPiece | undefined;
} {
    const pieces: Record<string, GearPiece> = {};
    const equipment: Ship['equipment'] = {};
    if (wearing) {
        SLOTS.forEach((slot, i) => {
            const id = `hardened-${i}`;
            pieces[id] = {
                id,
                slot,
                level: 16,
                stars: 6,
                rarity: 'legendary',
                mainStat: null,
                subStats: [],
                setBonus: 'HARDENED',
            };
            equipment[slot] = id;
        });
    }
    const ship: Ship = {
        id: 'hardened-ship',
        name: 'Hardened Ship',
        rarity: 'legendary',
        faction: 'AURELIAN_SOVEREIGNTY',
        type: 'DEFENDER',
        baseStats: {} as Ship['baseStats'],
        equipment,
        implants: {},
        refits: [],
    };
    return { ship, getGearPiece: (id) => pieces[id] };
}

/** The victim's kit: a no-op active plus whatever passive the real builder produced, plus any
 *  extra synthetic incoming-reduction entries. */
function victimSkills(wearing: boolean, extraNonCritPct = 0): ShipSkills {
    const { ship, getGearPiece } = hardenedShip(wearing);
    const built = buildShipAbilitiesWithEquipment(ship, getGearPiece);
    const passive: Ability[] = built.slots
        .filter((s) => s.slot === 'passive')
        .flatMap((s) => s.abilities);
    if (extraNonCritPct > 0) {
        passive.push({
            id: 'synthetic-always-reduction',
            type: 'incoming-reduction',
            target: 'self',
            trigger: 'on-cast',
            conditions: [],
            config: {
                type: 'incoming-reduction',
                scope: 'direct',
                condition: 'always',
                pct: extraNonCritPct,
                critFamily: false,
            },
        });
    }
    return {
        slots: [
            {
                slot: 'active',
                abilities: [
                    {
                        id: 'noop',
                        type: 'damage',
                        target: 'enemy',
                        trigger: 'on-cast',
                        conditions: [],
                        config: { type: 'damage', multiplier: 0 },
                    },
                ],
            },
            { slot: 'passive', abilities: passive },
        ],
    };
}

const target = (): ParsedTarget => ({ raw: 'front', side: 'enemy', selection: 'front' });
const pattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });
const hit = (id: string): Ability => ({
    id,
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 100 },
});

const BASE = (over: Partial<CombatEngineInput>): CombatEngineInput => ({
    enemyAttackers: [],
    attack: 0,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [] },
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
    mode: 'healing',
    ...over,
});

/** A player victim hit by a positioned enemy attacker. */
const playerSide =
    (opts: { wearing: boolean; crit: boolean; extraPct?: number }) =>
    (hp: number): CombatEngineInput =>
        BASE({
            teamActors: [
                {
                    id: 'victim',
                    speed: 1000,
                    chargeCount: 0,
                    startCharged: false,
                    selfBuffs: [],
                    enemyDebuffs: [],
                    position: 'M4',
                    walk: {
                        shipSkills: victimSkills(opts.wearing, opts.extraPct),
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
                } satisfies TeamActor,
            ],
            enemyAttackers: [
                {
                    id: 'enemy-1',
                    stats: {
                        attack: 5000,
                        crit: opts.crit ? 100 : 0,
                        critDamage: 100,
                        defence: 0,
                        hp: 1_000_000_000,
                        speed: 1,
                    },
                    chargeCount: 0,
                    startCharged: false,
                    position: 'M1',
                    target: target(),
                    pattern: pattern(),
                    shipSkills: { slots: [{ slot: 'active', abilities: [hit('enemy-1-hit')] }] },
                } satisfies EnemyAttacker,
            ],
        });

/** An enemy victim (built the way `useEnemyTeamRoster` builds it) hit by the player focus. */
const enemySide =
    (opts: { wearing: boolean; crit: boolean; extraPct?: number }) =>
    (hp: number): CombatEngineInput =>
        BASE({
            attack: 5000,
            crit: opts.crit ? 100 : 0,
            critDamage: 100,
            shipSkills: { slots: [{ slot: 'active', abilities: [hit('focus-hit')] }] },
            speed: 1000,
            position: 'M4',
            target: target(),
            pattern: pattern(),
            enemyAttackers: [
                {
                    id: 'enemy-victim',
                    stats: { attack: 1, crit: 0, critDamage: 0, defence: 0, hp, speed: 1 },
                    chargeCount: 0,
                    startCharged: false,
                    position: 'M1',
                    target: target(),
                    pattern: pattern(),
                    shipSkills: victimSkills(opts.wearing, opts.extraPct),
                } satisfies EnemyAttacker,
            ],
        });

const destroyed = (input: CombatEngineInput, id: string): boolean => {
    const bus = createEventBus();
    let dead = false;
    bus.on('ship-destroyed', (e) => {
        if (e.actorId === id) dead = true;
    });
    runCombat({ ...input, bus });
    return dead;
};

/** The landed hit is in [expected - 0.1, expected + 0.1). */
const expectLanded = (build: (hp: number) => CombatEngineInput, id: string, expected: number) => {
    expect(destroyed(build(expected - 0.1), id)).toBe(true);
    expect(destroyed(build(expected + 0.1), id)).toBe(false);
};

const SIDES = [
    ['player victim', playerSide, 'victim'],
    ['enemy victim', enemySide, 'enemy-victim'],
] as const;

describe.each(SIDES)('Hardened set crit reduction reaches damage: %s', (_name, side, id) => {
    it('control: a crit on an unprotected victim lands 10000', () => {
        expectLanded(side({ wearing: false, crit: true }), id, 10000);
    });
    it('three Hardened sets cut a crit by 15%: 8500', () => {
        expectLanded(side({ wearing: true, crit: true }), id, 8500);
    });
    it('a non-crit hit is identical with and without Hardened: 5000', () => {
        expectLanded(side({ wearing: false, crit: false }), id, 5000);
        expectLanded(side({ wearing: true, crit: false }), id, 5000);
    });
    it('the crit reduction is inside the cap: a victim already at -70 gains nothing from Hardened', () => {
        // 70% non-crit reduction alone: 10000 * 0.30. Hardened would make the crit net -85.
        expectLanded(side({ wearing: false, crit: true, extraPct: 70 }), id, 3000);
        expectLanded(side({ wearing: true, crit: true, extraPct: 70 }), id, 3000);
    });
    it('below the cap Hardened still counts: -50 non-crit and -15 Hardened is -65 on a crit', () => {
        expectLanded(side({ wearing: true, crit: true, extraPct: 50 }), id, 3500);
    });
});
