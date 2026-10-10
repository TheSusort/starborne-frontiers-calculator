/**
 * A role-conditioned damage bonus reads each struck enemy's OWN role (owner ruling 4,
 * 2026-10-03): Gallant's charged skill on a cone that strikes A (defender), B (attacker) and
 * C (defender) deals 205% to A and C and 175% to B. Same for IonScorp's charged ("when attacking a
 * defender … 220%"), Meiying's "an additional 125% damage" against supporters, and Zeolite's
 * "30% more damage when hitting a defender", and Lodolite's "10% more critical damage to
 * defenders". A caster-side gain gated on "the target" (Thresh's charged Crit Power Up II, his
 * active's charge trade) reads the targeted enemy's role. The fight-wide enemy class still
 * answers where no actor carries a role — the DPS calculator — so its numbers do not move.
 *
 * Damage arms: runCombat with role-carrying actors, real parsed kits, the caster's pattern set to
 * Pattern-Cone-Range-1 anchored on M4 (covers M4, M3, T3, B3; M2 is outside it). Crit 0, defence
 * 0, equal huge HP, so every victim's damage is exactly attack × its multiplier.
 */
import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { simulateDPS } from '../../calculators/dpsSimulator';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { parsePattern, parseTarget } from '../../targetingParser';
import type { ShipSkills } from '../../../types/abilities';
import type { EnemyBaseClass } from '../../../types/calculator';
import type { Position } from '../../../types/encounters';
import type { ShipTypeName } from '../../../constants/shipTypes';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable()) {
        throw new Error(
            'This suite requires docs/ship-skills.csv and docs/ship-data.json (gitignored reference data) — copy them in before running'
        );
    }
});

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
type TeamActor = NonNullable<CombatEngineInput['teamActors']>[number];
type Slot = 'active' | 'charged';

/** One firing slot of a real kit, plus its passive slot when `withPassive` (Zeolite's "+30% when
 *  hitting a defender" lives there; IonScorp's passive buffs its own damage, so it stays out). */
const realKit = (ship: string, slot: Slot, withPassive = false): ShipSkills => {
    const built = buildTraceShip(ship);
    if (!built) throw new Error(`${ship} missing from reference data`);
    const kit = buildShipAbilities(built);
    const found = kit.slots.find((s) => s.slot === slot);
    if (!found) throw new Error(`${ship} has no ${slot} slot`);
    const passive = withPassive ? kit.slots.find((s) => s.slot === 'passive') : undefined;
    return { slots: [{ slot, abilities: found.abilities }, ...(passive ? [passive] : [])] };
};

const cone = () => parsePattern('Pattern-Cone-Range-1');
const ATTACK = 1000;

/** A durable, inert enemy. */
const enemy = (id: string, position: Position, role?: ShipTypeName): EnemyAttacker => ({
    id,
    stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 1e9, speed: 150, security: 0 },
    chargeCount: 0,
    startCharged: false,
    position,
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
    shipSkills: { slots: [{ slot: 'active', abilities: [] }] },
    ...(role ? { role } : {}),
});

const base = (over: Partial<CombatEngineInput>): CombatEngineInput => ({
    enemyAttackers: [],
    attack: ATTACK,
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
    hp: 1e9,
    hacking: 0,
    security: 0,
    mode: 'battle',
    position: 'M4',
    target: parseTarget('front'),
    pattern: cone(),
    speed: 100,
    ...over,
});

const slotInput = (ship: string, slot: Slot, withPassive = false): Partial<CombatEngineInput> => ({
    shipSkills: realKit(ship, slot, withPassive),
    ...(slot === 'charged' ? { chargeCount: 1, hasChargedSkill: true, startCharged: true } : {}),
});

/** `casterId`'s round-1 direct damage per struck victim, as a % of `ATTACK`. A covered cell takes
 *  half of an origin cell's hit (`roleScaleFor` in positionalApply.ts), so it is doubled back here
 *  to read as the skill's own multiplier. */
const percentByVictim = (input: CombatEngineInput, casterId: string): Record<string, number> => {
    const bus = createEventBus();
    const out: Record<string, number> = {};
    bus.on('attacked', (e: Extract<CombatEvent, { type: 'attacked' }>) => {
        if (e.attackerId !== casterId || e.round !== 1 || e.damage === undefined) return;
        const unsplashed = e.isPrimaryTarget ? e.damage : 2 * e.damage;
        out[e.targetId] = (out[e.targetId] ?? 0) + unsplashed;
    });
    runCombat({ ...input, bus });
    for (const k of Object.keys(out)) out[k] = Math.round((100 * out[k]) / ATTACK);
    return out;
};

beforeEach(() => {
    setupKeyedRng(13);
});

describe('a role damage bonus reads each struck enemy on a cone', () => {
    const board = (a: ShipTypeName, b: ShipTypeName, c: ShipTypeName): EnemyAttacker[] => [
        enemy('enemy-a', 'M4', a),
        enemy('enemy-b', 'M3', b),
        enemy('enemy-c', 'T3', c),
        enemy('enemy-out', 'M2', 'DEFENDER'),
    ];

    it('Gallant charged: defender anchor A, attacker B, defender C → 205 / 175 / 205', () => {
        expect(
            percentByVictim(
                base({
                    ...slotInput('Gallant', 'charged'),
                    enemyAttackers: board('DEFENDER', 'ATTACKER', 'DEFENDER_SECURITY'),
                }),
                'attacker'
            )
        ).toEqual({ 'enemy-a': 205, 'enemy-b': 175, 'enemy-c': 205 });
    });

    it('Gallant charged: attacker anchor A, defenders B and C → 175 / 205 / 205', () => {
        expect(
            percentByVictim(
                base({
                    ...slotInput('Gallant', 'charged'),
                    enemyAttackers: board('ATTACKER', 'DEFENDER', 'DEFENDER'),
                }),
                'attacker'
            )
        ).toEqual({ 'enemy-a': 175, 'enemy-b': 205, 'enemy-c': 205 });
    });

    it('Gallant active: defender anchor, attacker B, supporter C → 155 / 115 / 115', () => {
        expect(
            percentByVictim(
                base({
                    ...slotInput('Gallant', 'active'),
                    enemyAttackers: board('DEFENDER', 'ATTACKER', 'SUPPORTER'),
                }),
                'attacker'
            )
        ).toEqual({ 'enemy-a': 155, 'enemy-b': 115, 'enemy-c': 115 });
    });

    it('IonScorp charged: defender anchor, attacker B, defender C → 220 / 190 / 220', () => {
        expect(
            percentByVictim(
                base({
                    ...slotInput('IonScorp', 'charged'),
                    enemyAttackers: board('DEFENDER', 'ATTACKER', 'DEFENDER'),
                }),
                'attacker'
            )
        ).toEqual({ 'enemy-a': 220, 'enemy-b': 190, 'enemy-c': 220 });
    });

    it('IonScorp charged: attacker anchor, defender B, attacker C → 190 / 220 / 190', () => {
        expect(
            percentByVictim(
                base({
                    ...slotInput('IonScorp', 'charged'),
                    enemyAttackers: board('ATTACKER', 'DEFENDER', 'ATTACKER'),
                }),
                'attacker'
            )
        ).toEqual({ 'enemy-a': 190, 'enemy-b': 220, 'enemy-c': 190 });
    });

    it('Meiying charged: supporter anchor, attacker B, supporter C → 375 / 250 / 375', () => {
        expect(
            percentByVictim(
                base({
                    ...slotInput('Meiying', 'charged'),
                    enemyAttackers: board('SUPPORTER', 'ATTACKER', 'SUPPORTER_BUFFER'),
                }),
                'attacker'
            )
        ).toEqual({ 'enemy-a': 375, 'enemy-b': 250, 'enemy-c': 375 });
    });

    it('Meiying active: defender anchor, supporter B, attacker C → 200 / 300 / 200', () => {
        expect(
            percentByVictim(
                base({
                    ...slotInput('Meiying', 'active'),
                    enemyAttackers: board('DEFENDER', 'SUPPORTER', 'ATTACKER'),
                }),
                'attacker'
            )
        ).toEqual({ 'enemy-a': 200, 'enemy-b': 300, 'enemy-c': 200 });
    });

    it('Zeolite charged (+30% vs defenders): attacker anchor, defender B, attacker C → 190 / 247 / 190', () => {
        expect(
            percentByVictim(
                base({
                    ...slotInput('Zeolite', 'charged', true),
                    enemyAttackers: board('ATTACKER', 'DEFENDER', 'ATTACKER'),
                }),
                'attacker'
            )
        ).toEqual({ 'enemy-a': 190, 'enemy-b': 247, 'enemy-c': 190 });
    });

    it('a single defender, with no fight-wide class set → Gallant charged deals 205', () => {
        expect(
            percentByVictim(
                base({
                    ...slotInput('Gallant', 'charged'),
                    pattern: parsePattern('Pattern-Base'),
                    enemyAttackers: [enemy('enemy-a', 'M4', 'DEFENDER')],
                }),
                'attacker'
            )
        ).toEqual({ 'enemy-a': 205 });
    });

    it('a single attacker, though the fight-wide class says Defender → 175', () => {
        expect(
            percentByVictim(
                base({
                    ...slotInput('Gallant', 'charged'),
                    pattern: parsePattern('Pattern-Base'),
                    enemyType: 'Defender',
                    enemyAttackers: [enemy('enemy-a', 'M4', 'ATTACKER')],
                }),
                'attacker'
            )
        ).toEqual({ 'enemy-a': 175 });
    });
});

describe('a role-gated crit-power bonus reads each struck enemy', () => {
    // Lodolite's passive: "This Unit deals 10% more critical damage to defenders". Every hit
    // crits at 50% crit power, so a defender's hit is 1.6x and an attacker's 1.5x the same
    // pre-crit damage, whichever one is the anchor.
    const ratio = (d: Record<string, number>, num: string, den: string): number => d[num] / d[den];

    it('player Lodolite: attacker anchor A, defender B, attacker C → B takes 1.6/1.5 of A', () => {
        const d = percentByVictim(
            base({
                ...slotInput('Lodolite', 'charged', true),
                crit: 100,
                critDamage: 50,
                hp: 1000,
                enemyAttackers: [
                    enemy('enemy-a', 'M4', 'ATTACKER'),
                    enemy('enemy-b', 'M3', 'DEFENDER'),
                    enemy('enemy-c', 'T3', 'ATTACKER'),
                ],
            }),
            'attacker'
        );
        expect(ratio(d, 'enemy-b', 'enemy-a')).toBeCloseTo(1.6 / 1.5, 2);
        expect(ratio(d, 'enemy-c', 'enemy-a')).toBeCloseTo(1, 2);
    });

    it('enemy Lodolite: defender focus, attacker B → B takes 1.5/1.6 of the focus', () => {
        const d = percentByVictim(
            base({
                attack: 0,
                speed: 150,
                role: 'DEFENDER',
                teamActors: [
                    {
                        id: 'ally-b',
                        role: 'ATTACKER',
                        speed: 150,
                        chargeCount: 0,
                        startCharged: false,
                        selfBuffs: [],
                        enemyDebuffs: [],
                        position: 'M3',
                        target: parseTarget('front'),
                        pattern: parsePattern('Pattern-Base'),
                        walk: {
                            shipSkills: { slots: [{ slot: 'active', abilities: [] }] },
                            stats: {
                                attack: 0,
                                crit: 0,
                                critDamage: 0,
                                defensePenetration: 0,
                                hacking: 0,
                                defence: 0,
                                hp: 1e9,
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
                        id: 'enemy-lodolite',
                        stats: {
                            attack: ATTACK,
                            crit: 100,
                            critDamage: 50,
                            defence: 0,
                            hp: 1000,
                            speed: 10,
                            security: 0,
                        },
                        chargeCount: 1,
                        startCharged: true,
                        position: 'M4',
                        target: parseTarget('front'),
                        pattern: cone(),
                        shipSkills: realKit('Lodolite', 'charged', true),
                    },
                ],
            }),
            'enemy-lodolite'
        );
        expect(ratio(d, 'ally-b', 'attacker')).toBeCloseTo(1.5 / 1.6, 2);
    });
});

describe("a self-gain gated on the target's role reads the targeted enemy", () => {
    // Thresh's charged: "After targeting a defender, this Unit gains Crit Power Up II for 1 turn."
    const threshBuffs = (role: ShipTypeName): string[] => {
        const bus = createEventBus();
        const out: string[] = [];
        bus.on('buff-applied', (e: Extract<CombatEvent, { type: 'buff-applied' }>) => {
            if (e.actorId === 'attacker' && e.round === 1) out.push(e.buffName);
        });
        runCombat({
            ...base({
                ...slotInput('Thresh', 'charged'),
                pattern: parsePattern('Pattern-Base'),
                enemyAttackers: [enemy('enemy-a', 'M4', role)],
            }),
            bus,
        });
        return out;
    };

    it('a defender target → Thresh gains Crit Power Up II', () => {
        expect(threshBuffs('DEFENDER')).toContain('Crit Power Up II');
    });

    it('an attacker target → it does not', () => {
        expect(threshBuffs('ATTACKER')).not.toContain('Crit Power Up II');
    });

    it('enemy Thresh targeting a defender focus → gains Crit Power Up II', () => {
        const bus = createEventBus();
        const out: string[] = [];
        bus.on('buff-applied', (e: Extract<CombatEvent, { type: 'buff-applied' }>) => {
            if (e.actorId === 'enemy-thresh' && e.round === 1) out.push(e.buffName);
        });
        runCombat({
            ...base({
                attack: 0,
                speed: 150,
                role: 'DEFENDER',
                enemyAttackers: [
                    {
                        id: 'enemy-thresh',
                        stats: {
                            attack: ATTACK,
                            crit: 0,
                            critDamage: 0,
                            defence: 0,
                            hp: 1e9,
                            speed: 10,
                            security: 0,
                        },
                        chargeCount: 1,
                        startCharged: true,
                        position: 'M4',
                        target: parseTarget('front'),
                        pattern: parsePattern('Pattern-Base'),
                        shipSkills: realKit('Thresh', 'charged'),
                    },
                ],
            }),
            bus,
        });
        expect(out).toContain('Crit Power Up II');
    });
});

describe("Thresh's active charge trade reads the targeted enemy's role", () => {
    // "If the target is a defender, this Unit removes 1 charge from the enemy's charged skill and
    // adds 1 charge to this Unit's charged skill."
    const manipCharges = (role: ShipTypeName): Record<string, number> => {
        const bus = createEventBus();
        const out: Record<string, number> = {};
        bus.on('charge-changed', (e: Extract<CombatEvent, { type: 'charge-changed' }>) => {
            if (e.round !== 1 || e.reason !== 'manip') return;
            out[e.actorId] = (out[e.actorId] ?? 0) + (e.newCharge - e.oldCharge);
        });
        runCombat({
            ...base({
                shipSkills: {
                    slots: [
                        ...realKit('Thresh', 'active').slots,
                        ...realKit('Thresh', 'charged').slots,
                    ],
                },
                chargeCount: 2,
                hasChargedSkill: true,
                pattern: parsePattern('Pattern-Base'),
                enemyAttackers: [
                    {
                        ...enemy('enemy-a', 'M4', role),
                        chargeCount: 3,
                        startCharged: true,
                        shipSkills: {
                            slots: [
                                { slot: 'active', abilities: [] },
                                { slot: 'charged', abilities: [] },
                            ],
                        },
                    },
                ],
            }),
            bus,
        });
        return out;
    };

    it('a defender target → Thresh gains a charge and the defender loses one', () => {
        expect(manipCharges('DEFENDER')).toEqual({ attacker: 1, 'enemy-a': -1 });
    });

    it('an attacker target → no charge moves', () => {
        expect(manipCharges('ATTACKER')).toEqual({});
    });
});

describe('an enemy caster reads each struck player ship the same way', () => {
    const ally = (id: string, position: Position, role: ShipTypeName): TeamActor => ({
        id,
        role,
        speed: 150,
        chargeCount: 0,
        startCharged: false,
        selfBuffs: [],
        enemyDebuffs: [],
        position,
        target: parseTarget('front'),
        pattern: parsePattern('Pattern-Base'),
        walk: {
            shipSkills: { slots: [{ slot: 'active' as const, abilities: [] }] },
            stats: {
                attack: 0,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                hacking: 0,
                defence: 0,
                hp: 1e9,
            },
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            hasChargedSkill: false,
        },
    });
    const enemyCaster = (ship: string, slot: Slot, withPassive = false): EnemyAttacker => ({
        id: 'enemy-caster',
        stats: {
            attack: ATTACK,
            crit: 0,
            critDamage: 0,
            defence: 0,
            hp: 1e9,
            speed: 10,
            security: 0,
            // No debuff lands ahead of the hit (Zeolite's charged Inc. Damage Up III), like the
            // player-side caster's.
            hacking: 0,
        },
        chargeCount: slot === 'charged' ? 1 : 0,
        startCharged: slot === 'charged',
        position: 'M4',
        target: parseTarget('front'),
        pattern: cone(),
        shipSkills: realKit(ship, slot, withPassive),
    });
    const run = (
        ship: string,
        slot: Slot,
        focusRole: ShipTypeName,
        bRole: ShipTypeName,
        cRole: ShipTypeName,
        withPassive = false
    ): Record<string, number> =>
        percentByVictim(
            base({
                attack: 0,
                speed: 150,
                role: focusRole,
                teamActors: [ally('ally-b', 'M3', bRole), ally('ally-c', 'T3', cRole)],
                enemyAttackers: [enemyCaster(ship, slot, withPassive)],
            }),
            'enemy-caster'
        );

    it('Gallant charged: defender focus, attacker B, defender C → 205 / 175 / 205', () => {
        expect(run('Gallant', 'charged', 'DEFENDER', 'ATTACKER', 'DEFENDER')).toEqual({
            attacker: 205,
            'ally-b': 175,
            'ally-c': 205,
        });
    });

    it('IonScorp charged: attacker focus, defenders B and C → 190 / 220 / 220', () => {
        expect(run('IonScorp', 'charged', 'ATTACKER', 'DEFENDER', 'DEFENDER_SECURITY')).toEqual({
            attacker: 190,
            'ally-b': 220,
            'ally-c': 220,
        });
    });

    it('Meiying charged: attacker focus, supporter B, attacker C → 250 / 375 / 250', () => {
        expect(run('Meiying', 'charged', 'ATTACKER', 'SUPPORTER', 'ATTACKER')).toEqual({
            attacker: 250,
            'ally-b': 375,
            'ally-c': 250,
        });
    });

    it('Zeolite charged (+30% vs defenders): attacker focus, defender B, attacker C → 190 / 247 / 190', () => {
        expect(run('Zeolite', 'charged', 'ATTACKER', 'DEFENDER', 'ATTACKER', true)).toEqual({
            attacker: 190,
            'ally-b': 247,
            'ally-c': 190,
        });
    });

    it('Thresh active: a defender focus loses a charge to enemy Thresh', () => {
        const bus = createEventBus();
        const out: Record<string, number> = {};
        bus.on('charge-changed', (e: Extract<CombatEvent, { type: 'charge-changed' }>) => {
            if (e.round !== 1 || e.reason !== 'manip') return;
            out[e.actorId] = (out[e.actorId] ?? 0) + (e.newCharge - e.oldCharge);
        });
        runCombat({
            ...base({
                attack: 0,
                // Slower than enemy Thresh, so its full charge bar is still there when he acts.
                speed: 5,
                role: 'DEFENDER',
                chargeCount: 3,
                hasChargedSkill: true,
                startCharged: true,
                shipSkills: {
                    slots: [
                        { slot: 'active', abilities: [] },
                        { slot: 'charged', abilities: [] },
                    ],
                },
                enemyAttackers: [
                    {
                        id: 'enemy-thresh',
                        stats: {
                            attack: ATTACK,
                            crit: 0,
                            critDamage: 0,
                            defence: 0,
                            hp: 1e9,
                            speed: 10,
                            security: 0,
                        },
                        chargeCount: 2,
                        startCharged: false,
                        position: 'M4',
                        target: parseTarget('front'),
                        pattern: parsePattern('Pattern-Base'),
                        shipSkills: {
                            slots: [
                                ...realKit('Thresh', 'active').slots,
                                ...realKit('Thresh', 'charged').slots,
                            ],
                        },
                    },
                ],
            }),
            bus,
        });
        expect(out).toEqual({ 'enemy-thresh': 1, attacker: -1 });
    });
});

describe('DPS calculator: no actor role, the configured enemy class decides', () => {
    const dps = (ship: string, slot: Slot, enemyType?: EnemyBaseClass): number => {
        const result = simulateDPS({
            attack: ATTACK,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            chargeCount: slot === 'charged' ? 1 : 0,
            startCharged: slot === 'charged',
            enemyDefense: 0,
            enemyHp: 1e9,
            rounds: 1,
            selfBuffs: [],
            enemyDebuffs: [],
            hacking: 0,
            enemySecurity: 0,
            ...(enemyType ? { enemyType } : {}),
            shipSkills: realKit(ship, slot),
        });
        return result.rounds[0].directDamage;
    };

    it('Gallant charged: Defender 2050, Attacker 1750, unset 1750', () => {
        expect(dps('Gallant', 'charged', 'Defender')).toBe(2050);
        expect(dps('Gallant', 'charged', 'Attacker')).toBe(1750);
        expect(dps('Gallant', 'charged')).toBe(1750);
    });

    it('Meiying charged: Supporter 3750, Attacker 2500, unset 2500', () => {
        expect(dps('Meiying', 'charged', 'Supporter')).toBe(3750);
        expect(dps('Meiying', 'charged', 'Attacker')).toBe(2500);
        expect(dps('Meiying', 'charged')).toBe(2500);
    });
});
