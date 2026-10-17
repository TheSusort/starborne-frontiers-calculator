/**
 * The direct-hit factors outside the Out. Damage buff sum — the squad-leader outgoing bonus (R199)
 * and Arcane Siege (R201) — reach every hit thrown outside the turn loop, as they reach a cast:
 * a counter-attack, a reactive proc, and both reflect shares (a ship's bounce and the Reflect gear
 * set's). The owner side is read in ONE place, `effectiveOutgoingStatsOf`'s
 * `outgoingSeparateFactor`; each arm here reverts red when its own site drops the field.
 *
 * Arcane Siege gates on the owner's LIVE shield pool at the moment the reactive hit is thrown.
 *
 * Only the Nosorog arms read the gitignored reference data; `realKit` throws when it is absent.
 *
 * No RNG draws: every owner has `crit: 0` (or the hit cannot crit).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { emptyPreFightModifiers } from '../preFight';
import type { PreFightCombatModifiers } from '../preFight';
import { dealtBy } from '../__testutils__/perTargetDealt';
import {
    boardInput,
    hitKit,
    realKit,
    type BoardUnit,
    type Placement,
} from '../__testutils__/realKitBoard';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { Ship } from '../../../types/ship';
import type { GearPiece } from '../../../types/gear';
import { buildEquipmentAbilities } from '../../abilities/buildEquipmentAbilities';
import { buildShipAbilitiesWithEquipment } from '../../abilities/buildShipAbilitiesWithEquipment';
import { getGearSet } from '../../../constants/gearSets';
import IMPLANTS from '../../../constants/implants';

beforeEach(() => setupKeyedRng(703));

const OWNER_ID = 'attacker';
const FOE_ID = 'foe';

const preFight = (overrides: Partial<PreFightCombatModifiers>): PreFightCombatModifiers => ({
    ...emptyPreFightModifiers(),
    ...overrides,
});
const LEADER = preFight({ outgoingDamage: 10 });
const SHIELDED = preFight({ startingShieldPctOfHp: 50 });
const SHIELDED_LEADER = preFight({ startingShieldPctOfHp: 50, outgoingDamage: 10 });

/** Every ability an implant builds at `rarity`, through the production builder. */
const implantAbilities = (implant: string, rarity: string): Ability[] => {
    const piece = {
        id: `${implant}-${rarity}`,
        slot: 'implant_minor_alpha',
        level: 16,
        stars: 6,
        rarity,
        mainStat: null,
        subStats: [],
        setBonus: implant,
    } as unknown as GearPiece;
    const ship = {
        id: 'implant-ship',
        name: 'Implant Ship',
        rarity: 'legendary',
        faction: 'AURELIAN_SOVEREIGNTY',
        type: 'ATTACKER',
        baseStats: {} as Ship['baseStats'],
        equipment: {},
        implants: { implant_minor_alpha: piece.id },
        refits: [],
    } as Ship;
    return buildEquipmentAbilities(ship, (id) => (id === piece.id ? piece : undefined));
};

/** Legendary Arcane Siege: +20% outgoing direct damage while shielded. */
const arcaneSiege = (): Ability => {
    const ability = implantAbilities('ARCANE_SIEGE', 'legendary').find(
        (a) => a.config.type === 'modifier' && a.config.channel === 'outgoingDamageSeparate'
    );
    if (!ability) throw new Error('Arcane Siege ability not built');
    return ability;
};

describe('the out-of-loop gate ctx carries only the shield subjects', () => {
    it('every implant outgoingDamageSeparate modifier gates on self-shield alone', () => {
        const separate = Object.entries(IMPLANTS).flatMap(([name, data]) =>
            data.variants.flatMap((v) =>
                implantAbilities(name, v.rarity).filter(
                    (a) =>
                        a.config.type === 'modifier' &&
                        a.config.channel === 'outgoingDamageSeparate'
                )
            )
        );
        // Non-vacuous: Arcane Siege builds at every rarity.
        expect(separate.length).toBeGreaterThanOrEqual(5);
        for (const a of separate) {
            expect(a.conditions.map((c) => c.subject)).toEqual(['self-shield']);
        }
    });
});

// ── Counter-attack ────────────────────────────────────────────────────────────────────────────

const counterAbility: Ability = {
    id: 'own-counter',
    type: 'counter',
    target: 'self',
    trigger: 'on-attacked',
    conditions: [],
    config: { type: 'counter', multiplier: 100 },
};

/** The focus carries the retaliation and is hit by one foe each round (healing mode, so every
 *  owner→foe reactive row is a counter). Returns the first counter's amount. */
const counter = (pf: PreFightCombatModifiers | undefined, withSiege: boolean): number => {
    const bus = createEventBus();
    const rows: number[] = [];
    bus.on(
        'reactive-damage-performed',
        (e: Extract<CombatEvent, { type: 'reactive-damage-performed' }>) => {
            if (e.targetId === FOE_ID && e.sourceId === OWNER_ID) rows.push(e.amount);
        }
    );
    const input: CombatEngineInput = {
        attack: 10_000,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: 0,
        shipSkills: {
            slots: [
                {
                    slot: 'passive',
                    abilities: [counterAbility, ...(withSiege ? [arcaneSiege()] : [])],
                },
            ],
        },
        numRounds: 1,
        selfBuffs: [],
        enemyDebuffs: [],
        hasChargedSkill: false,
        startCharged: false,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        defence: 0,
        hp: 1_000_000,
        healTargetId: OWNER_ID,
        mode: 'healing',
        ...(pf ? { preFight: pf } : {}),
        enemyAttackers: [
            {
                id: FOE_ID,
                stats: { attack: 3_000, crit: 0, critDamage: 0, defence: 0, hp: 1e9, speed: 50 },
                chargeCount: 0,
                startCharged: false,
                shipSkills: hitKit(100),
            },
        ],
        bus,
    };
    runCombat(input);
    expect(rows.length).toBeGreaterThan(0);
    return rows[0];
};

describe('a counter-attack carries the separate outgoing factors', () => {
    it('baseline: 100% of 10,000 attack', () => {
        expect(counter(undefined, false)).toBeCloseTo(10_000, 6);
    });
    it('a +10% squad-leader outgoing bonus scales it by 1.10', () => {
        expect(counter(LEADER, false)).toBeCloseTo(11_000, 6);
    });
    it('shielded Arcane Siege scales it by 1.20', () => {
        expect(counter(SHIELDED, true)).toBeCloseTo(12_000, 6);
    });
    it('both multiply: 1.10 × 1.20', () => {
        expect(counter(SHIELDED_LEADER, true)).toBeCloseTo(13_200, 6);
    });
    it('unshielded, Arcane Siege stays dormant', () => {
        expect(counter(undefined, true)).toBeCloseTo(10_000, 6);
    });
});

// ── Reactive proc ─────────────────────────────────────────────────────────────────────────────

const procAbility: Ability = {
    id: 'own-proc',
    type: 'damage',
    target: 'enemy',
    trigger: 'on-enemy-charged-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 80, hits: 1, noCrit: true },
};

/** The owner's 80% proc reacts to the foe's charged cast (FrontLine's shape). */
const proc = (pf: PreFightCombatModifiers | undefined, withSiege: boolean): number => {
    const chargedHit = hitKit(150).slots[0];
    const result = runCombat({
        attack: 10_000,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: 0,
        shipSkills: {
            slots: [
                { slot: 'active', abilities: [] },
                {
                    slot: 'passive',
                    abilities: [procAbility, ...(withSiege ? [arcaneSiege()] : [])],
                },
            ],
        },
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
        speed: 200,
        healTargetId: OWNER_ID,
        mode: 'healing',
        ...(pf ? { preFight: pf } : {}),
        enemyAttackers: [
            {
                id: FOE_ID,
                stats: { attack: 100, crit: 0, critDamage: 0, defence: 0, hp: 1e9, speed: 40 },
                chargeCount: 1,
                startCharged: true,
                shipSkills: {
                    slots: [
                        hitKit(50).slots[0],
                        { slot: 'charged', abilities: chargedHit.abilities },
                    ],
                },
            },
        ],
    });
    return dealtBy(result.rounds, OWNER_ID);
};

describe('a reactive proc carries the separate outgoing factors', () => {
    it('baseline: 80% of 10,000 attack', () => {
        expect(proc(undefined, false)).toBeCloseTo(8_000, 6);
    });
    it('a +10% squad-leader outgoing bonus scales it by 1.10', () => {
        expect(proc(LEADER, false)).toBeCloseTo(8_800, 6);
    });
    it('shielded Arcane Siege scales it by 1.20', () => {
        expect(proc(SHIELDED, true)).toBeCloseTo(9_600, 6);
    });
    it('unshielded, Arcane Siege stays dormant', () => {
        expect(proc(undefined, true)).toBeCloseTo(8_000, 6);
    });
});

// ── Reflects: the ship's bounce and the Reflect gear set's share ──────────────────────────────

const SIDES: Placement[] = ['player', 'enemy'];

const reflectSetPassives = (): ShipSkills['slots'] => {
    const slots = ['weapon', 'hull', 'generator', 'sensor'] as const;
    const pieces: GearPiece[] = slots
        .slice(0, getGearSet('REFLECT')?.minPieces ?? 2)
        .map((slot, i) => ({
            id: `reflect-${i}`,
            slot,
            level: 16,
            stars: 6,
            rarity: 'legendary',
            mainStat: null,
            subStats: [],
            setBonus: 'REFLECT',
        }));
    const built = buildShipAbilitiesWithEquipment(
        {
            id: 'wearer-ship',
            name: 'Wearer',
            rarity: 'legendary',
            faction: 'AURELIAN_SOVEREIGNTY',
            type: 'DEFENDER',
            baseStats: {} as Ship['baseStats'],
            equipment: Object.fromEntries(pieces.map((p) => [p.slot, p.id])),
            implants: {},
            refits: [],
        } as Partial<Ship> as Ship,
        (id) => pieces.find((p) => p.id === id)
    );
    return built.slots.filter((s) => s.slot === 'passive');
};

const nosorogPassives = (): ShipSkills['slots'] =>
    realKit('Nosorog').slots.filter((s) => s.slot === 'passive');

const inertActive: Ability = {
    id: 'inert',
    type: 'buff',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'buff',
        buffName: 'Inert Buff',
        parsedEffects: {},
        stacks: 1,
        isStackable: false,
        duration: 5,
    },
};

/** The reflector acts first (an inert self buff), then takes the hitter's 140% hit. */
const reflector = (
    reflect: () => ShipSkills['slots'],
    pf: PreFightCombatModifiers | undefined,
    withSiege: boolean,
    extraPassives: Ability[] = []
): BoardUnit => {
    const added = [...(withSiege ? [arcaneSiege()] : []), ...extraPassives];
    const slots: ShipSkills['slots'] = reflect().map((s) => ({
        ...s,
        abilities: [...s.abilities, ...added],
    }));
    return {
        id: 'reflector',
        kit: { slots: [{ slot: 'active', abilities: [inertActive] }, ...slots] },
        position: 'M4',
        speed: 1_000,
        attack: 10_000,
        defence: 5_000,
        hp: 1_000_000,
        ...(pf ? { preFight: pf } : {}),
    };
};

const hitter: BoardUnit = {
    id: 'hitter',
    kit: hitKit(140),
    position: 'M4',
    speed: 100,
    attack: 4_598,
    defence: 0,
};

/** The hitter Disables the reflector (always lands), then hits it. */
const disablingHitter: BoardUnit = {
    ...hitter,
    id: 'disabler',
    kit: {
        slots: [
            {
                slot: 'active',
                abilities: [
                    {
                        id: 'disable',
                        type: 'debuff',
                        target: 'enemy',
                        trigger: 'on-cast',
                        conditions: [],
                        config: {
                            type: 'debuff',
                            buffName: 'Disable',
                            parsedEffects: {},
                            stacks: 1,
                            isStackable: false,
                            duration: 2,
                            application: 'apply',
                        },
                    },
                    ...hitKit(140).slots[0].abilities,
                ],
            },
        ],
    },
};

const reflected = (placement: Placement, unit: BoardUnit, by: BoardUnit = hitter): number => {
    const { input, id } = boardInput(placement, unit, [], [by], 1);
    const ref = id(unit);
    const hit = id(by);
    const bus = createEventBus();
    const rows: number[] = [];
    bus.on('reactive-damage-performed', (e) => {
        if (e.sourceId === ref && e.targetId === hit) rows.push(e.amount);
    });
    runCombat({ ...input, bus });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toBeGreaterThan(0);
    return rows[0];
};

describe.each(SIDES)('reflects on the %s side carry the separate outgoing factors', (side) => {
    describe.each([
        ['the ship bounce (Nosorog)', nosorogPassives],
        ['the Reflect gear set share', reflectSetPassives],
    ] as const)('%s', (_label, reflect) => {
        const base = () => reflected(side, reflector(reflect, undefined, false));

        it('a +10% squad-leader outgoing bonus scales it by 1.10', () => {
            expect(reflected(side, reflector(reflect, LEADER, false))).toBeCloseTo(base() * 1.1, 6);
        });
        it('shielded Arcane Siege scales it by 1.20', () => {
            expect(reflected(side, reflector(reflect, SHIELDED, true))).toBeCloseTo(
                base() * 1.2,
                6
            );
        });
        it('unshielded, Arcane Siege stays dormant', () => {
            expect(reflected(side, reflector(reflect, undefined, true))).toBeCloseTo(base(), 6);
        });
    });
});

/** A ship's OWN passive on the separate channel (no `source`), ungated: what the ability editor
 *  can author. */
const shipPassiveSeparate: Ability = {
    id: 'ship-separate',
    type: 'modifier',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'modifier',
        channel: 'outgoingDamageSeparate',
        value: 20,
        isMultiplicative: false,
    },
};

describe.each(SIDES)(
    'a turn-blocked reflector on the %s side keeps implants but loses ship passives',
    (side) => {
        it('control: undisabled, a ship-passive separate modifier scales the reflect by 1.20', () => {
            const base = reflected(side, reflector(reflectSetPassives, undefined, false));
            expect(
                reflected(
                    side,
                    reflector(reflectSetPassives, undefined, false, [shipPassiveSeparate])
                )
            ).toBeCloseTo(base * 1.2, 6);
        });
        it('Disabled, the ship-passive modifier is suppressed', () => {
            const base = reflected(
                side,
                reflector(reflectSetPassives, undefined, false),
                disablingHitter
            );
            expect(
                reflected(
                    side,
                    reflector(reflectSetPassives, undefined, false, [shipPassiveSeparate]),
                    disablingHitter
                )
            ).toBeCloseTo(base, 6);
        });
        it('Disabled, shielded Arcane Siege (an implant) still scales it by 1.20', () => {
            const base = reflected(
                side,
                reflector(reflectSetPassives, undefined, false),
                disablingHitter
            );
            expect(
                reflected(side, reflector(reflectSetPassives, SHIELDED, true), disablingHitter)
            ).toBeCloseTo(base * 1.2, 6);
        });
    }
);
