/**
 * "Buffs on the enemy" counts the buffs on the cast's bound target (owner rulings 2026-10-03),
 * one per stack (R37, 2026-10-05):
 *
 *   - Rhodium active — "adds charges … equal to the number of buffs on the enemy": 4 buffs → +4,
 *     0 buffs → +0.
 *   - Nuqtu active — "If the target has 3 or more buffs, this Unit adds 2 charges": the +2 fires
 *     only when the target holds 3+ buffs, and it is +2, never +2 per buff.
 *   - Nuqtu charged — "If the target has 3 or more buffs, this Unit gains 1 extra end of round
 *     action": the TARGET's own buffs, never a union across the enemy side.
 *   - "for each buff on the enemy" damage bonuses (Butcher charged +35% per buff) scale with the
 *     same count.
 *   - A buff with several stacks counts once per stack.
 *
 * Real parsed abilities (buildTraceShip on docs/ship-skills.csv). The buffs are neutral names with
 * no stat effects, granted by the holder's own active; every holder is faster than the caster, so
 * the buffs are on the board before the caster's round-1 turn. Charge gains are read off the
 * caster's `charge-changed` events with reason `'manip'` (an ability-driven grant), damage off its
 * own `ability-performed` event, extra actions off its `turn-started` count.
 */
import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import type { Ability, ShipSkills } from '../../../types/abilities';
import { parsePattern } from '../../targetingParser';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';

const hasReferenceData = (): boolean => csvAvailable() && shipDataAvailable();

beforeAll(() => {
    if (!hasReferenceData()) {
        throw new Error(
            'This suite requires docs/ship-skills.csv and docs/ship-data.json (gitignored reference data) — copy them in before running'
        );
    }
});

const parsedFrontTarget = (): ParsedTarget => ({ raw: 'front', side: 'enemy', selection: 'front' });
const singleTargetPattern = (): ParsedPattern => ({
    raw: 'base',
    shape: 'base',
    range: 0,
    modifiers: {},
});

const realSlot = (ship: string, slot: 'active' | 'charged'): Ability[] => {
    const built = buildTraceShip(ship);
    if (!built) throw new Error(`${ship} missing from reference data`);
    const found = buildShipAbilities(built).slots.find((s) => s.slot === slot);
    if (!found) throw new Error(`${ship} has no ${slot} slot`);
    return found.abilities;
};

let idc = 0;
/** A self buff with no stat effects. */
const selfBuff = (name: string): Ability => ({
    id: `self-buff-${++idc}`,
    type: 'buff',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'buff',
        buffName: name,
        parsedEffects: {},
        stacks: 1,
        isStackable: false,
        duration: 3,
    },
});

/** ONE stackable buff held at `stacks` stacks for the rest of the fight (the shape Meatshield's
 *  "Protection x3" grant takes). */
const stackedBuff = (name: string, stacks: number): Ability => ({
    ...selfBuff(name),
    config: {
        type: 'buff',
        buffName: name,
        parsedEffects: {},
        stacks,
        isStackable: true,
        maxStacks: stacks,
        duration: 'recurring',
    },
});

const buffKit = (buffs: Ability[]): ShipSkills => ({
    slots: [{ slot: 'active', abilities: buffs }],
});

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

/** A durable enemy that, faster than the caster, grants ITSELF the given buffs every turn. */
const buffedEnemy = (id: string, position: Position, buffs: Ability[]): EnemyAttacker => ({
    id,
    stats: {
        attack: 0,
        crit: 0,
        critDamage: 0,
        defence: 0,
        hp: 1_000_000_000,
        speed: 150,
        security: 0,
    },
    chargeCount: 0,
    startCharged: false,
    position,
    target: parsedFrontTarget(),
    pattern: singleTargetPattern(),
    shipSkills: buffKit(buffs),
});

const distinct = (n: number): Ability[] =>
    Array.from({ length: n }, (_, i) => selfBuff(`Neutral Buff ${i + 1}`));

const base = (over: Partial<CombatEngineInput>): CombatEngineInput => ({
    enemyAttackers: [],
    attack: 10_000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [{ slot: 'active', abilities: [] }] },
    numRounds: 1,
    selfBuffs: [],
    enemyDebuffs: [],
    hasChargedSkill: false,
    startCharged: false,
    affinityDamageModifier: 0,
    affinityCritCap: 100,
    affinityCritPenalty: 0,
    defence: 0,
    hp: 1_000_000_000,
    hacking: 0,
    healTargetId: 'attacker',
    mode: 'healing',
    position: 'M4',
    target: parsedFrontTarget(),
    pattern: singleTargetPattern(),
    speed: 100,
    ...over,
});

interface Measured {
    /** Ability-driven charge gained by `actorId` in round 1. */
    chargeGain: number;
    /** `actorId`'s turns in round 1 (2 = one extra action). */
    turns: number;
    /** `actorId`'s first damage ability's emitted damage. */
    damage: number;
}

const measure = (input: CombatEngineInput, actorId: string): Measured => {
    const bus = createEventBus();
    let chargeGain = 0;
    let turns = 0;
    const damages: number[] = [];
    bus.on('charge-changed', (e) => {
        if (e.actorId === actorId && e.round === 1 && e.reason === 'manip')
            chargeGain += e.newCharge - e.oldCharge;
    });
    bus.on('turn-started', (e) => {
        if (e.actorId === actorId && e.round === 1) turns += 1;
    });
    bus.on('ability-performed', (e) => {
        if (e.actorId === actorId && e.abilityType === 'damage') damages.push(e.damage ?? 0);
    });
    runCombat({ ...input, bus });
    return { chargeGain, turns, damage: damages[0] ?? NaN };
};

/** A player-side caster with the given ship's real active (+ charged) skill vs `enemies`. */
const playerCaster = (
    ship: string,
    enemies: EnemyAttacker[],
    over: Partial<CombatEngineInput> = {}
): Measured =>
    measure(
        base({
            shipSkills: {
                slots: [
                    { slot: 'active', abilities: realSlot(ship, 'active') },
                    { slot: 'charged', abilities: realSlot(ship, 'charged') },
                ],
            },
            hasChargedSkill: true,
            chargeCount: 10,
            enemyAttackers: enemies,
            ...over,
        }),
        'attacker'
    );

beforeEach(() => {
    idc = 0;
    setupKeyedRng(5);
});

describe("Rhodium active — charges equal the target's buffs", () => {
    it('target with no buffs → no charge', () => {
        expect(playerCaster('Rhodium', [buffedEnemy('target', 'M4', [])]).chargeGain).toBe(0);
    });

    it('target with four distinct buffs → four charges', () => {
        expect(playerCaster('Rhodium', [buffedEnemy('target', 'M4', distinct(4))]).chargeGain).toBe(
            4
        );
    });

    it('each stack is a buff (R37) → a 3-stack buff + a plain one = four charges', () => {
        const target = buffedEnemy('target', 'M4', [
            stackedBuff('Stacked Buff', 3),
            selfBuff('Plain Buff'),
        ]);
        expect(playerCaster('Rhodium', [target]).chargeGain).toBe(4);
    });

    it("another enemy's buffs do not count", () => {
        const front = buffedEnemy('target', 'M4', distinct(2));
        const back = buffedEnemy('other', 'M3', [
            selfBuff('Other A'),
            selfBuff('Other B'),
            selfBuff('Other C'),
        ]);
        expect(playerCaster('Rhodium', [front, back]).chargeGain).toBe(2);
    });
});

describe('Nuqtu active — +2 charges only on a 3+ buff target', () => {
    it('target with one buff → no charge', () => {
        expect(playerCaster('Nuqtu', [buffedEnemy('target', 'M4', distinct(1))]).chargeGain).toBe(
            0
        );
    });

    it('target with three buffs → +2, not +2 per buff', () => {
        expect(playerCaster('Nuqtu', [buffedEnemy('target', 'M4', distinct(3))]).chargeGain).toBe(
            2
        );
    });

    it('target with four buffs → still +2', () => {
        expect(playerCaster('Nuqtu', [buffedEnemy('target', 'M4', distinct(4))]).chargeGain).toBe(
            2
        );
    });
});

describe("Nuqtu charged — the extra action reads the target's own buffs", () => {
    const charged = { startCharged: true, chargeCount: 4 };

    it('two enemies under 3 buffs each but 3 distinct names between them → no extra action', () => {
        const front = buffedEnemy('target', 'M4', [selfBuff('Buff A'), selfBuff('Buff B')]);
        const back = buffedEnemy('other', 'M3', [selfBuff('Buff C')]);
        expect(playerCaster('Nuqtu', [front, back], charged).turns).toBe(1);
    });

    it('the target itself holds 3 buffs → one extra action', () => {
        const front = buffedEnemy('target', 'M4', [
            selfBuff('Buff A'),
            selfBuff('Buff B'),
            selfBuff('Buff C'),
        ]);
        const back = buffedEnemy('other', 'M3', []);
        expect(playerCaster('Nuqtu', [front, back], charged).turns).toBe(2);
    });
});

describe('Butcher charged — +35% per buff on the target', () => {
    const butcherCharged = (buffs: Ability[]): number =>
        measure(
            base({
                shipSkills: {
                    slots: [
                        { slot: 'active', abilities: [] },
                        {
                            slot: 'charged',
                            abilities: realSlot('Butcher', 'charged').filter(
                                (a) => a.type === 'damage'
                            ),
                        },
                    ],
                },
                hasChargedSkill: true,
                chargeCount: 3,
                startCharged: true,
                enemyAttackers: [buffedEnemy('target', 'M4', buffs)],
            }),
            'attacker'
        ).damage;

    it('no buffs → the base 150%', () => {
        expect(butcherCharged([])).toBe(15_000);
    });

    it('three distinct buffs → 150% + 3 × 35%', () => {
        expect(butcherCharged(distinct(3))).toBe(25_500);
    });
});

describe("enemy-side Rhodium counts the player target's buffs", () => {
    const enemyRhodium = (playerBuffs: Ability[]): number =>
        measure(
            base({
                // The player focus is Rhodium's front target and buffs itself first.
                shipSkills: buffKit(playerBuffs),
                speed: 150,
                security: 0,
                enemyAttackers: [
                    {
                        id: 'rhodium-enemy',
                        stats: {
                            attack: 100,
                            crit: 0,
                            critDamage: 0,
                            defence: 0,
                            hp: 1_000_000_000,
                            speed: 100,
                        },
                        chargeCount: 10,
                        startCharged: false,
                        position: 'M4',
                        target: parsedFrontTarget(),
                        pattern: singleTargetPattern(),
                        shipSkills: {
                            slots: [
                                { slot: 'active', abilities: realSlot('Rhodium', 'active') },
                                { slot: 'charged', abilities: realSlot('Rhodium', 'charged') },
                            ],
                        },
                    },
                ],
            }),
            'rhodium-enemy'
        ).chargeGain;

    it('player target with no buffs → no charge', () => {
        expect(enemyRhodium([])).toBe(0);
    });

    it('player target with four distinct buffs → four charges', () => {
        expect(enemyRhodium(distinct(4))).toBe(4);
    });
});

describe('single-ship DPS mode keeps the manual count', () => {
    /** Rhodium's real active with the user's manual count set on its charge condition. */
    const rhodiumWithManual = (manualCount: number): ShipSkills => ({
        slots: [
            {
                slot: 'active',
                abilities: realSlot('Rhodium', 'active').map((a) =>
                    a.type === 'charge'
                        ? { ...a, conditions: a.conditions.map((c) => ({ ...c, manualCount })) }
                        : a
                ),
            },
            { slot: 'charged', abilities: realSlot('Rhodium', 'charged') },
        ],
    });

    const run = (mode: 'dps' | 'healing'): number => {
        const input = base({
            shipSkills: rhodiumWithManual(2),
            hasChargedSkill: true,
            chargeCount: 10,
            enemyAttackers: [buffedEnemy('target', 'M4', distinct(4))],
        });
        if (mode === 'healing') return measure(input, 'attacker').chargeGain;
        // `mode: 'dps'` forbids healTargetId (runCombat throws), so it is dropped.
        const { healTargetId: _drop, ...rest } = input;
        return measure({ ...rest, mode: 'dps' }, 'attacker').chargeGain;
    };

    it('DPS mode → the manual count (2), not the board', () => {
        expect(run('dps')).toBe(2);
    });

    it('the same fixture in a real fight → the live count (4)', () => {
        expect(run('healing')).toBe(4);
    });
});

describe("single-ship DPS mode gates Nuqtu's +2 on the manual count", () => {
    /** Nuqtu's real active with the user's manual count set on its charge condition (unset =
     *  the calculator's default of 1). */
    const nuqtuDpsChargeGain = (manualCount?: number): number => {
        const shipSkills: ShipSkills = {
            slots: [
                {
                    slot: 'active',
                    abilities: realSlot('Nuqtu', 'active').map((a) =>
                        a.type === 'charge' && manualCount !== undefined
                            ? {
                                  ...a,
                                  conditions: a.conditions.map((c) => ({ ...c, manualCount })),
                              }
                            : a
                    ),
                },
                { slot: 'charged', abilities: realSlot('Nuqtu', 'charged') },
            ],
        };
        // `mode: 'dps'` forbids healTargetId (runCombat throws), so it is dropped.
        const { healTargetId: _drop, ...rest } = base({
            shipSkills,
            hasChargedSkill: true,
            chargeCount: 10,
            // Four live buffs: a live read would satisfy the 3+ gate, so only the manual count
            // can explain a 0.
            enemyAttackers: [buffedEnemy('target', 'M4', distinct(4))],
        });
        return measure({ ...rest, mode: 'dps' }, 'attacker').chargeGain;
    };

    it('default manual count (1) → no bonus charges', () => {
        expect(nuqtuDpsChargeGain()).toBe(0);
    });

    it('manual count of 3 → +2 charges', () => {
        expect(nuqtuDpsChargeGain(3)).toBe(2);
    });
});

describe('an AoE per-buff outgoing modifier reads each victim its own count', () => {
    /** A self outgoing-damage modifier worth +10% per buff on the enemy, beside a 100% AoE hit. */
    const perBuffAoeKit = (): ShipSkills => ({
        slots: [
            {
                slot: 'active',
                abilities: [
                    {
                        id: 'aoe-hit',
                        type: 'damage',
                        target: 'enemy',
                        trigger: 'on-cast',
                        conditions: [],
                        config: { type: 'damage', multiplier: 100 },
                    },
                    {
                        id: 'per-buff-mod',
                        type: 'modifier',
                        target: 'self',
                        trigger: 'on-cast',
                        conditions: [{ subject: 'enemy-buff', derivable: false }],
                        config: {
                            type: 'modifier',
                            channel: 'outgoingDamage',
                            value: 0,
                            isMultiplicative: true,
                        },
                        scaling: { conditionIndex: 0, perUnit: 10 },
                    },
                ],
            },
        ],
    });

    it('front with 1 buff → +10%, covered victim with 3 buffs → +30%', () => {
        const result = runCombat(
            base({
                shipSkills: perBuffAoeKit(),
                // shape 'all' gives every occupied cell full damage, so only the per-victim
                // modifier can make the two victims' damage differ.
                pattern: { raw: 'all', shape: 'all', range: 'all', modifiers: {} },
                enemyAttackers: [
                    buffedEnemy('front', 'M4', distinct(1)),
                    buffedEnemy('covered', 'M3', [
                        selfBuff('Other A'),
                        selfBuff('Other B'),
                        selfBuff('Other C'),
                    ]),
                ],
            })
        );
        expect(result.rounds[0].perTargetDamage?.['front']).toBe(11_000);
        expect(result.rounds[0].perTargetDamage?.['covered']).toBe(13_000);
    });
});

describe('a per-buff damage bonus on a line-pattern cast reads each struck enemy its own buffs', () => {
    // Nuqtu's and Butcher's skills strike a line: the front enemy at full damage and the two
    // behind it at half. Attack 10 000, no defence, neutral affinity — so a victim's damage is
    // 10 000 × (base% + per-buff% × that victim's buffs) × its footprint share.
    const linePattern = (): ParsedPattern => parsePattern('Pattern-Line-Range-2');
    const damageOnly = (ship: string, slot: 'active' | 'charged'): Ability[] =>
        realSlot(ship, slot).filter((a) => a.type === 'damage');

    const playerSide = (
        ship: string,
        slot: 'active' | 'charged',
        frontBuffs: number,
        coveredBuffs: number
    ): Record<string, number | undefined> => {
        const charged = slot === 'charged';
        const result = runCombat(
            base({
                shipSkills: {
                    slots: [
                        { slot: 'active', abilities: charged ? [] : damageOnly(ship, slot) },
                        ...(charged
                            ? [{ slot: 'charged' as const, abilities: damageOnly(ship, slot) }]
                            : []),
                    ],
                },
                hasChargedSkill: charged,
                startCharged: charged,
                chargeCount: charged ? 3 : 0,
                pattern: linePattern(),
                enemyAttackers: [
                    buffedEnemy('front', 'M4', distinct(frontBuffs)),
                    buffedEnemy('covered', 'M3', distinct(coveredBuffs)),
                ],
            })
        );
        return result.rounds[0].perTargetDamage ?? {};
    };

    it('Nuqtu active: clean front, covered enemy with 3 buffs → only the covered one gains', () => {
        const dmg = playerSide('Nuqtu', 'active', 0, 3);
        expect(dmg['front']).toBe(14_000);
        expect(dmg['covered']).toBe(11_500);
    });

    it('Nuqtu active: front with 3 buffs, clean covered enemy → only the front gains', () => {
        const dmg = playerSide('Nuqtu', 'active', 3, 0);
        expect(dmg['front']).toBe(23_000);
        expect(dmg['covered']).toBe(7_000);
    });

    it('Butcher charged: clean front, covered enemy with 3 buffs → +35% per buff there only', () => {
        const dmg = playerSide('Butcher', 'charged', 0, 3);
        expect(dmg['front']).toBe(15_000);
        expect(dmg['covered']).toBe(12_750);
    });

    /** Enemy-side Nuqtu's damage to each player ship it strikes in round 1. */
    const enemySide = (frontBuffs: number, coveredBuffs: number): Record<string, number> => {
        const bus = createEventBus();
        const dmg: Record<string, number> = {};
        bus.on('attacked', (e) => {
            if (e.attackerId === 'nuqtu-enemy' && e.round === 1)
                dmg[e.targetId] = (dmg[e.targetId] ?? 0) + (e.damage ?? 0);
        });
        runCombat({
            ...base({
                // The player focus is the front ship and buffs itself before Nuqtu acts.
                shipSkills: buffKit(distinct(frontBuffs)),
                speed: 150,
                security: 0,
                teamActors: [
                    {
                        id: 'covered',
                        speed: 150,
                        chargeCount: 0,
                        startCharged: false,
                        selfBuffs: [],
                        enemyDebuffs: [],
                        position: 'M3',
                        target: parsedFrontTarget(),
                        pattern: singleTargetPattern(),
                        walk: {
                            shipSkills: buffKit(
                                Array.from({ length: coveredBuffs }, (_, i) =>
                                    selfBuff(`Covered Buff ${i + 1}`)
                                )
                            ),
                            stats: {
                                attack: 0,
                                crit: 0,
                                critDamage: 0,
                                defensePenetration: 0,
                                hacking: 0,
                                defence: 0,
                                hp: 1_000_000_000,
                            },
                            affinityDamageModifier: 0,
                            affinityCritCap: 100,
                            affinityCritPenalty: 0,
                            hasChargedSkill: false,
                        },
                    },
                ],
                enemyAttackers: [
                    {
                        id: 'nuqtu-enemy',
                        stats: {
                            attack: 10_000,
                            crit: 0,
                            critDamage: 0,
                            defence: 0,
                            hp: 1_000_000_000,
                            speed: 100,
                        },
                        chargeCount: 0,
                        startCharged: false,
                        position: 'M4',
                        target: parsedFrontTarget(),
                        pattern: linePattern(),
                        shipSkills: {
                            slots: [{ slot: 'active', abilities: damageOnly('Nuqtu', 'active') }],
                        },
                    },
                ],
            }),
            bus,
        });
        return dmg;
    };

    it('enemy-side Nuqtu: clean front, covered player ship with 3 buffs → only it gains', () => {
        expect(enemySide(0, 3)).toEqual({ attacker: 14_000, covered: 11_500 });
    });

    it('enemy-side Nuqtu: front with 3 buffs, clean covered player ship → only the front gains', () => {
        expect(enemySide(3, 0)).toEqual({ attacker: 23_000, covered: 7_000 });
    });
});
