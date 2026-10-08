/**
 * Owner ruling R149: Firewall's Block Debuff takes effect at once. Proccing on a skill's first
 * debuff, it blocks that same skill's later debuffs. R122 stands: one Firewall roll per debuff that
 * lands, so a blocked debuff rolls nothing.
 *
 * Curator's active: "deals 60% damage to all enemies, then inflicts Attack Down III and Crit Power
 * Down III for 2 turns." On a Firewall wearer whose Firewall procs on Attack Down III, Crit Power
 * Down III is resisted by the Block Debuff, and Firewall grants Block Debuff once.
 *
 * Firewall is the real implant (legendary, via the equipment registry) with its proc chance pinned:
 * 1 for "always procs", 1e-9 for the control that never does. Curator is the real parsed active
 * (refit 4). Every board runs with the wearer on the player side and on the enemy side, and also
 * on a board whose ships carry no positions (the engine still resolves each victim there).
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat, type CombatEngineInput } from '../engine';
import { createEventBus } from '../events';
import { makeKeyedRng, setKeyedRng, setupKeyedRng } from '../../calculators/rateAccumulator';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { buildShipAbilitiesWithEquipment } from '../../abilities/buildShipAbilitiesWithEquipment';
import { boardInput, type BoardUnit, type Placement } from '../__testutils__/realKitBoard';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { Ship } from '../../../types/ship';
import type { GearPiece } from '../../../types/gear';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable())
        throw new Error('docs/ship-skills.csv and docs/ship-data.json are required');
});
beforeEach(() => setupKeyedRng(9));

/** The real legendary Firewall implant's reactive grant, its proc chance pinned to `procChance`. */
const firewall = (procChance: number): Ability => {
    const ship = {
        id: 'wearer',
        name: 'Wearer',
        rarity: 'legendary',
        faction: 'AURELIAN_SOVEREIGNTY',
        type: 'DEFENDER',
        baseStats: {},
        equipment: {},
        implants: { implant_major: 'fw' },
        refits: [],
    } as unknown as Ship;
    const piece = {
        id: 'fw',
        slot: 'implant_major',
        level: 16,
        stars: 6,
        rarity: 'legendary',
        mainStat: null,
        subStats: [],
        setBonus: 'FIREWALL',
    } as unknown as GearPiece;
    const passive = buildShipAbilitiesWithEquipment(ship, (id) =>
        id === 'fw' ? piece : undefined
    ).slots.find((s) => s.slot === 'passive');
    const fw = passive?.abilities.find((a) => a.id.startsWith('equip-implant-FIREWALL'));
    if (!fw) throw new Error('the Firewall implant built no reactive grant');
    return { ...fw, procChance };
};

const wearerKit = (procChance: number): ShipSkills => ({
    slots: [
        { slot: 'active', abilities: [] },
        { slot: 'passive', abilities: [firewall(procChance)] },
    ],
});

const curatorActive = (): ShipSkills => {
    const built = buildTraceShip('Curator', { refitLevel: 4 });
    if (!built) throw new Error('Curator missing from reference data');
    const active = buildShipAbilities(built).slots.find((s) => s.slot === 'active');
    if (!active) throw new Error('Curator has no active slot');
    return { slots: [active] };
};

interface Outcome {
    blockDebuffGrants: number;
    landed: string[];
    resisted: { name: string; viaLandingRoll: boolean }[];
}

const observe = (input: CombatEngineInput, wearerId: string): Outcome => {
    const bus = createEventBus();
    const out: Outcome = { blockDebuffGrants: 0, landed: [], resisted: [] };
    bus.on('buff-applied', (e) => {
        if (e.actorId === wearerId && e.buffName === 'Block Debuff') out.blockDebuffGrants++;
    });
    bus.on('debuff-applied', (e) => {
        if (e.targetId === wearerId) out.landed.push(e.buffName);
    });
    bus.on('debuff-resisted', (e) => {
        if (e.targetId === wearerId)
            out.resisted.push({ name: e.buffName, viaLandingRoll: e.viaLandingRoll === true });
    });
    runCombat({ ...input, bus });
    return out;
};

describe.each<Placement>(['player', 'enemy'])(
    'R149 with the Firewall wearer on the %s side',
    (placement) => {
        const run = (procChance: number) => {
            const wearer: BoardUnit = {
                id: 'wearer',
                kit: wearerKit(procChance),
                position: 'M4',
                speed: 1,
            };
            const curator: BoardUnit = {
                id: 'curator',
                kit: curatorActive(),
                position: 'M4',
                speed: 100,
                attack: 1,
                hacking: 1e6,
            };
            const { input, id } = boardInput(placement, wearer, [], [curator], 1);
            return observe(input, id(wearer));
        };

        it("a Firewall proc on Attack Down III blocks the same skill's Crit Power Down III", () => {
            const out = run(1);
            expect(out.landed).toEqual(['Attack Down III']);
            expect(out.resisted).toEqual([{ name: 'Crit Power Down III', viaLandingRoll: false }]);
            expect(out.blockDebuffGrants).toBe(1);
        });

        it('control: a Firewall that never procs lets both debuffs land', () => {
            const out = run(1e-9);
            expect(out.landed).toEqual(['Attack Down III', 'Crit Power Down III']);
            expect(out.resisted).toEqual([]);
            expect(out.blockDebuffGrants).toBe(0);
        });

        it('R122 holds: exactly one Firewall roll per debuff that lands, none for a blocked one', () => {
            // A real 50% Firewall over many seeds, counting draws on the wearer's proc stream: a proc
            // on the first debuff blocks the second (one landing, one draw); a miss lets the second
            // land and roll too (two landings, two draws).
            const shapes = new Set<number>();
            for (let seed = 1; seed <= 24; seed++) {
                const base = makeKeyedRng(seed);
                let draws = 0;
                setupKeyedRng(seed);
                setKeyedRng((key) => {
                    if (key.endsWith(':proc')) draws++;
                    return base(key);
                });
                const out = run(0.5);
                expect(draws).toBe(out.landed.length);
                if (out.landed.length === 1) expect(out.blockDebuffGrants).toBe(1);
                else expect(out.blockDebuffGrants).toBeLessThanOrEqual(1);
                shapes.add(out.landed.length);
            }
            // Both outcomes occurred, so the count was tested both ways.
            expect([...shapes].sort()).toEqual([1, 2]);
        });
    }
);

/** Flamel's real passive behind an empty active: "When directly damaged this Unit inflicts Speed
 *  Down I and Stasis for 2 turns." */
const flamelPassive = (): ShipSkills => {
    const built = buildTraceShip('Flamel', { refitLevel: 4 });
    if (!built) throw new Error('Flamel missing from reference data');
    const passive = buildShipAbilities(built).slots.find((s) => s.slot === 'passive');
    if (!passive) throw new Error('Flamel has no passive slot');
    return { slots: [{ slot: 'active', abilities: [] }, passive] };
};

/** "When directly damaged, inflicts 2 stacks of Attack Down I on the attacker", each stack its own
 *  landing (R48). */
const twoStackReactor = (): ShipSkills => ({
    slots: [
        { slot: 'active', abilities: [] },
        {
            slot: 'passive',
            abilities: [
                {
                    id: 'two-stack-reaction',
                    type: 'debuff',
                    target: 'enemy',
                    trigger: 'on-attacked',
                    conditions: [],
                    config: {
                        type: 'debuff',
                        buffName: 'Attack Down I',
                        parsedEffects: {},
                        stacks: 2,
                        isStackable: true,
                        application: 'inflict',
                        duration: 2,
                    },
                },
            ],
        },
    ],
});

describe.each<Placement>(['player', 'enemy'])(
    'R149 on a passive reaction, the Firewall wearer on the %s side',
    (placement) => {
        const run = (procChance: number, reactorKit: ShipSkills = flamelPassive()) => {
            const wearer: BoardUnit = {
                id: 'wearer',
                kit: {
                    slots: [
                        {
                            slot: 'active',
                            abilities: [
                                {
                                    id: 'hit',
                                    type: 'damage',
                                    target: 'enemy',
                                    trigger: 'on-cast',
                                    conditions: [],
                                    config: { type: 'damage', multiplier: 100 },
                                },
                            ],
                        },
                        { slot: 'passive', abilities: [firewall(procChance)] },
                    ],
                },
                position: 'M4',
                speed: 100,
                attack: 1,
            };
            const flamel: BoardUnit = {
                id: 'flamel',
                kit: reactorKit,
                position: 'M4',
                speed: 1,
                hacking: 1e6,
            };
            const { input, id } = boardInput(placement, wearer, [], [flamel], 1);
            return observe(input, id(wearer));
        };

        it("hitting Flamel: a proc on her Speed Down I blocks the same passive's Stasis", () => {
            const out = run(1);
            expect(out.landed).toEqual(['Speed Down I']);
            expect(out.resisted).toEqual([{ name: 'Stasis', viaLandingRoll: false }]);
            expect(out.blockDebuffGrants).toBe(1);
        });

        it('control: a Firewall that never procs lets both land', () => {
            const out = run(1e-9);
            expect(out.landed).toEqual(['Speed Down I', 'Stasis']);
            expect(out.blockDebuffGrants).toBe(0);
        });

        it('a proc on the first stack of a 2-stack reaction blocks the second stack', () => {
            const out = run(1, twoStackReactor());
            expect(out.landed).toEqual(['Attack Down I']);
            expect(out.resisted).toEqual([{ name: 'Attack Down I', viaLandingRoll: false }]);
            expect(out.blockDebuffGrants).toBe(1);
            // Control: both stacks land when Firewall never procs.
            const control = run(1e-9, twoStackReactor());
            expect(control.landed).toEqual(['Attack Down I', 'Attack Down I']);
            expect(control.blockDebuffGrants).toBe(0);
        });
    }
);

/** A plain cast that inflicts Attack Down II and then Crit Power Down II, no positions. */
const twoDebuffKit = (): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: (['Attack Down II', 'Crit Power Down II'] as const).map(
                (buffName, i): Ability => ({
                    id: `two-debuff-${i}`,
                    type: 'debuff',
                    target: 'enemy',
                    trigger: 'on-cast',
                    conditions: [],
                    config: {
                        type: 'debuff',
                        buffName,
                        parsedEffects: {},
                        stacks: 1,
                        isStackable: false,
                        application: 'inflict',
                        duration: 2,
                    },
                })
            ),
        },
    ],
});

const nonPositional = (
    focusKit: ShipSkills,
    enemyKit: ShipSkills,
    focusFaster: boolean
): CombatEngineInput => ({
    attack: 1,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: focusKit,
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
    hp: 1e9,
    hacking: 1e6,
    security: 0,
    speed: focusFaster ? 100 : 1,
    mode: 'battle',
    enemyAttackers: [
        {
            id: 'foe',
            stats: {
                attack: 1,
                crit: 0,
                critDamage: 0,
                defence: 0,
                hp: 1e9,
                speed: focusFaster ? 1 : 100,
                hacking: 1e6,
                security: 0,
            },
            chargeCount: 0,
            startCharged: false,
            shipSkills: enemyKit,
        },
    ],
});

describe('R149 on a board with no positions set', () => {
    it('the focus wearing Firewall: the enemy cast lands its first debuff only', () => {
        const out = observe(nonPositional(wearerKit(1), twoDebuffKit(), false), 'attacker');
        expect(out.landed).toEqual(['Attack Down II']);
        expect(out.resisted).toEqual([{ name: 'Crit Power Down II', viaLandingRoll: false }]);
        expect(out.blockDebuffGrants).toBe(1);
    });

    it('the enemy wearing Firewall: the focus cast lands its first debuff only', () => {
        const out = observe(nonPositional(twoDebuffKit(), wearerKit(1), true), 'foe');
        expect(out.landed).toEqual(['Attack Down II']);
        expect(out.resisted).toEqual([{ name: 'Crit Power Down II', viaLandingRoll: false }]);
        expect(out.blockDebuffGrants).toBe(1);
    });

    it('control: a Firewall that never procs lets both land', () => {
        const out = observe(nonPositional(wearerKit(1e-9), twoDebuffKit(), false), 'attacker');
        expect(out.landed).toEqual(['Attack Down II', 'Crit Power Down II']);
        expect(out.blockDebuffGrants).toBe(0);
    });
});

/**
 * Owner ruling R161: Firewall's Block Debuff also blocks the SAME skill's later DoT stacks.
 * Snakeroot's active "deals 170% damage and inflicts 2 stacks of Corrosion I for 2 turns": a
 * Firewall proc on the first stack blocks the second, which rolls nothing (R122: one Firewall roll
 * per stack that lands).
 */
interface DotOutcome {
    blockDebuffGrants: number;
    stacksLanded: number;
    resisted: { name: string; viaLandingRoll: boolean }[];
    procDraws: number;
}

const observeDots = (input: CombatEngineInput, wearerId: string, seed = 9): DotOutcome => {
    const base = makeKeyedRng(seed);
    const out: DotOutcome = { blockDebuffGrants: 0, stacksLanded: 0, resisted: [], procDraws: 0 };
    setupKeyedRng(seed);
    setKeyedRng((key) => {
        if (key === `${wearerId}:proc`) out.procDraws++;
        return base(key);
    });
    const bus = createEventBus();
    bus.on('buff-applied', (e) => {
        if (e.actorId === wearerId && e.buffName === 'Block Debuff') out.blockDebuffGrants++;
    });
    bus.on('dot-applied', (e) => {
        if (e.targetId === wearerId) out.stacksLanded += e.stacks;
    });
    bus.on('debuff-resisted', (e) => {
        if (e.targetId === wearerId)
            out.resisted.push({ name: e.buffName, viaLandingRoll: e.viaLandingRoll === true });
    });
    runCombat({ ...input, bus });
    return out;
};

const realSlot = (ship: string, slot: 'active' | 'charged'): ShipSkills => {
    const built = buildTraceShip(ship, { refitLevel: 4 });
    if (!built) throw new Error(`${ship} missing from reference data`);
    const found = buildShipAbilities(built).slots.find((s) => s.slot === slot);
    if (!found) throw new Error(`${ship} has no ${slot} slot`);
    return { slots: [{ ...found, slot: 'active' }] };
};

describe.each<Placement>(['player', 'enemy'])(
    'R161 with the Firewall wearer on the %s side',
    (placement) => {
        const run = (procChance: number, seed?: number) => {
            const wearer: BoardUnit = {
                id: 'wearer',
                kit: wearerKit(procChance),
                position: 'M4',
                speed: 1,
            };
            const snakeroot: BoardUnit = {
                id: 'snakeroot',
                kit: realSlot('Snakeroot', 'active'),
                position: 'M4',
                speed: 100,
                attack: 1,
                hacking: 1e6,
            };
            const { input, id } = boardInput(placement, wearer, [], [snakeroot], 1);
            return observeDots(input, id(wearer), seed);
        };

        it("a Firewall proc on Snakeroot's first Corrosion I stack blocks the second", () => {
            const out = run(1);
            expect(out.stacksLanded).toBe(1);
            expect(out.resisted).toHaveLength(1);
            expect(out.resisted[0].viaLandingRoll).toBe(false);
            expect(out.blockDebuffGrants).toBe(1);
        });

        it('control: a Firewall that never procs lets both stacks land', () => {
            const out = run(1e-9);
            expect(out.stacksLanded).toBe(2);
            expect(out.resisted).toEqual([]);
            expect(out.blockDebuffGrants).toBe(0);
        });

        it('R122 holds for stacks: one Firewall roll per stack that lands', () => {
            const shapes = new Set<number>();
            for (let seed = 1; seed <= 24; seed++) {
                const out = run(0.5, seed);
                expect(out.procDraws).toBe(out.stacksLanded);
                if (out.stacksLanded === 1) expect(out.blockDebuffGrants).toBe(1);
                shapes.add(out.stacksLanded);
            }
            expect([...shapes].sort()).toEqual([1, 2]);
        });
    }
);

describe('Butcher charged lands ONE stack of Inferno III (tier = magnitude)', () => {
    it.each<Placement>(['player', 'enemy'])('Butcher on the %s side', (placement) => {
        const target: BoardUnit = { id: 'target', kit: wearerKit(1e-9), position: 'M4', speed: 1 };
        const butcher: BoardUnit = {
            id: 'butcher',
            kit: realSlot('Butcher', 'charged'),
            position: 'M4',
            speed: 100,
            attack: 1,
            hacking: 1e6,
        };
        const { input, id } = boardInput(
            placement === 'player' ? 'enemy' : 'player',
            target,
            [],
            [butcher],
            1
        );
        const bus = createEventBus();
        const inferno: { stacks: number; tier?: number }[] = [];
        bus.on('dot-applied', (e) => {
            if (e.targetId === id(target) && e.dotType === 'inferno')
                inferno.push({ stacks: e.stacks, tier: e.tier });
        });
        runCombat({ ...input, bus });
        expect(inferno).toEqual([{ stacks: 1, tier: 45 }]);
    });
});

/** "When directly damaged, inflicts 2 stacks of Corrosion I on the attacker" (R161 on a reaction). */
const twoStackDotReactor = (): ShipSkills => ({
    slots: [
        { slot: 'active', abilities: [] },
        {
            slot: 'passive',
            abilities: [
                {
                    id: 'two-stack-dot-reaction',
                    type: 'dot',
                    target: 'enemy',
                    trigger: 'on-attacked',
                    conditions: [],
                    config: { type: 'dot', dotType: 'corrosion', tier: 3, stacks: 2, duration: 2 },
                },
            ],
        },
    ],
});

describe.each<Placement>(['player', 'enemy'])(
    'R161 on a passive DoT reaction, the Firewall wearer on the %s side',
    (placement) => {
        const run = (procChance: number) => {
            const wearer: BoardUnit = {
                id: 'wearer',
                kit: {
                    slots: [
                        {
                            slot: 'active',
                            abilities: [
                                {
                                    id: 'hit',
                                    type: 'damage',
                                    target: 'enemy',
                                    trigger: 'on-cast',
                                    conditions: [],
                                    config: { type: 'damage', multiplier: 100 },
                                },
                            ],
                        },
                        { slot: 'passive', abilities: [firewall(procChance)] },
                    ],
                },
                position: 'M4',
                speed: 100,
                attack: 1,
            };
            const reactor: BoardUnit = {
                id: 'reactor',
                kit: twoStackDotReactor(),
                position: 'M4',
                speed: 1,
                hacking: 1e6,
            };
            const { input, id } = boardInput(placement, wearer, [], [reactor], 1);
            return observeDots(input, id(wearer));
        };

        it('a proc on the first Corrosion stack blocks the second', () => {
            const out = run(1);
            expect(out.stacksLanded).toBe(1);
            expect(out.resisted).toHaveLength(1);
            expect(out.resisted[0].viaLandingRoll).toBe(false);
            expect(out.blockDebuffGrants).toBe(1);
        });

        it('control: a Firewall that never procs lets both stacks land', () => {
            const out = run(1e-9);
            expect(out.stacksLanded).toBe(2);
            expect(out.blockDebuffGrants).toBe(0);
        });
    }
);
