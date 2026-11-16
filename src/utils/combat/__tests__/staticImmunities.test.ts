/**
 * Static immunities parsed from skill text and honoured by the engine:
 *  - "This Unit is immune to damage, debuffs, and purge." -> damageImmune, debuffImmune, purgeImmune;
 *  - "bypasses enemy Defense" -> ignoresDefense; "ignores all targeting changing effects" ->
 *    the targeting bypass flags on that ability;
 *  - a unit with an empty active and charged takes do-nothing turns.
 *
 * Engine cases run with the immune unit on the player side and on the enemy side.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus, type CombatEvent, type CombatEventType } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import {
    parseIgnoresAllTargetingEffects,
    parseIgnoresDefense,
    parseStaticImmunities,
} from '../../skillTextParser';
import { bossShip, npcShip } from '../../../constants/bountyBosses';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { parsePattern } from '../../targetingParser';
import { createActor, type CombatActor } from '../state';
import { reduceBombsOnVictim } from '../bombCountdown';
import { boardInput, hitKit, type BoardUnit, type Placement } from '../__testutils__/realKitBoard';
import type { Ability, ShipSkills } from '../../../types/abilities';

const TORPEDO_PASSIVE = 'This Unit is immune to damage, debuffs, and purge.';
const BLAST_TEXT =
    'At the end of a round, if this Unit is the first in the row, it destroys itself to deal 150% damage that cannot critically hit, bypasses enemy Defense, and ignores all targeting changing effects.';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable())
        throw new Error('docs/ship-skills.csv and docs/ship-data.json are required');
});
beforeEach(() => setupKeyedRng(7));

const SIDES: Placement[] = ['player', 'enemy'];

describe('static immunity parse', () => {
    it('reads the three flags from the Torpedo list', () => {
        expect(parseStaticImmunities(TORPEDO_PASSIVE)).toEqual({
            damage: true,
            debuffs: true,
            purge: true,
        });
    });

    it('sets none of them for "immune to Control debuffs"', () => {
        expect(parseStaticImmunities('This Unit is immune to Control debuffs.')).toEqual({
            damage: false,
            debuffs: false,
            purge: false,
        });
    });

    it("keeps Fenri Lv33's debuffImmune false and controlImmune true", () => {
        const kit = buildShipAbilities(bossShip('fenri', 33)!);
        expect(kit.controlImmune).toBe(true);
        expect(kit.debuffImmune).toBeUndefined();
        expect(kit.damageImmune).toBeUndefined();
        expect(kit.purgeImmune).toBeUndefined();
    });

    it('puts the three flags on the Torpedo kit', () => {
        const kit = buildShipAbilities(npcShip('torpedo', 135)!);
        expect(kit.damageImmune).toBe(true);
        expect(kit.debuffImmune).toBe(true);
        expect(kit.purgeImmune).toBe(true);
    });
});

describe('defence and targeting bypass parse', () => {
    it('reads "bypasses enemy Defense" and the older "ignores Defense"', () => {
        expect(parseIgnoresDefense(BLAST_TEXT)).toBe(true);
        expect(parseIgnoresDefense('This damage ignores Defense.')).toBe(true);
        expect(parseIgnoresDefense('Deals 100% damage.')).toBe(false);
    });

    it('reads "ignores all targeting changing effects"', () => {
        expect(parseIgnoresAllTargetingEffects(BLAST_TEXT)).toBe(true);
        expect(parseIgnoresAllTargetingEffects('This Unit ignores Stealth effects.')).toBe(false);
    });

    it('puts the bypass flags on the blast damage ability only', () => {
        const kit = buildShipAbilities(npcShip('torpedo', 135)!);
        const damage = kit.slots
            .flatMap((s) => s.abilities)
            .find((a) => a.config.type === 'damage' && a.config.ignoresDefense);
        expect(damage?.config).toMatchObject({
            ignoresDefense: true,
            ignoresStealth: true,
            ignoresForcedTargeting: true,
            ignoresConcentrateFire: true,
        });
        expect(kit.ignoresForcedTargeting).toBeUndefined();
        expect(kit.ignoresStealth).toBeUndefined();
    });
});

// ── engine ──────────────────────────────────────────────────────────────────────────────────

const IMMUNE: Partial<ShipSkills> = { damageImmune: true, debuffImmune: true, purgeImmune: true };

const reactiveBuff = (): Ability => ({
    id: 'when-damaged',
    type: 'buff',
    target: 'self',
    trigger: 'on-attacked',
    conditions: [],
    config: {
        type: 'buff',
        buffName: 'Reactive Up',
        parsedEffects: { attack: 25 },
        stacks: 1,
        isStackable: false,
        duration: 3,
    },
});

const heldBuff = (buffName: string): Ability => ({
    id: `held-${buffName}`,
    type: 'buff',
    target: 'self',
    trigger: 'pre-combat',
    conditions: [],
    config: {
        type: 'buff',
        buffName,
        parsedEffects: { defense: 50 },
        stacks: 1,
        isStackable: false,
        duration: 9,
    },
});

const carrierKit = (immune: boolean, extra: Ability[] = []): ShipSkills => ({
    slots: [
        { slot: 'active', abilities: [] },
        { slot: 'passive', abilities: [reactiveBuff(), ...extra] },
    ],
    ...(immune ? IMMUNE : {}),
});

const RECORDED: CombatEventType[] = [
    'attacked',
    'buff-applied',
    'buff-expired',
    'debuff-applied',
    'debuff-resisted',
    'dot-applied',
    'purge-performed',
    'turn-started',
    'skill-fired',
    'ability-performed',
];

interface Result {
    events: CombatEvent[];
    hp: Record<string, number>;
}

const run = (
    placement: Placement,
    carrier: BoardUnit,
    allies: BoardUnit[],
    opponents: BoardUnit[],
    rounds = 1
): Result => {
    const { input } = boardInput(placement, carrier, allies, opponents, rounds);
    const bus = createEventBus();
    const events: CombatEvent[] = [];
    for (const type of RECORDED) bus.on(type, (e) => events.push(e));
    const hp: Record<string, number> = {};
    runCombat({
        ...input,
        bus,
        __testTapActors: (all: CombatActor[]) => {
            bus.on('round-ended', () => {
                for (const a of all) hp[a.id] = a.currentHp;
            });
        },
    });
    return { events, hp };
};

const unit = (
    id: string,
    position: BoardUnit['position'],
    over: Partial<BoardUnit>
): BoardUnit => ({
    id,
    kit: carrierKit(false),
    position,
    speed: 100,
    hp: 1e6,
    ...over,
});

const aoeAttacker = (over: Partial<BoardUnit> = {}): BoardUnit => ({
    id: 'aoe',
    kit: hitKit(100),
    position: 'M4',
    speed: 500,
    attack: 1000,
    hacking: 1e6,
    hp: 1e9,
    pattern: parsePattern('Pattern-All'),
    ...over,
});

const buffsAppliedTo = (events: CombatEvent[], id: string, name: string): number =>
    events.filter((e) => e.type === 'buff-applied' && e.actorId === id && e.buffName === name)
        .length;

describe.each(SIDES)('damage immunity, carrier on the %s side', (placement) => {
    const setup = (immune: boolean) => {
        const carrier = unit('carrier', 'M4', { kit: carrierKit(immune) });
        const bystander = unit('bystander', 'M3', { kit: carrierKit(false) });
        const { id } = boardInput(placement, carrier, [bystander], [aoeAttacker()], 1);
        const r = run(placement, carrier, [bystander], [aoeAttacker()]);
        return { r, c: id(carrier), b: id(bystander) };
    };

    it('an AoE deals the immune unit 0 and hits the other victim normally', () => {
        const { r, c, b } = setup(true);
        expect(r.hp[c]).toBe(1e6);
        expect(r.hp[b]).toBeLessThan(1e6);
    });

    it('control: the same unit without the flag takes the hit', () => {
        const { r, c } = setup(false);
        expect(r.hp[c]).toBeLessThan(1e6);
    });

    it('fires no "when directly damaged" reaction on the immune unit, but does on the other victim', () => {
        const { r, c, b } = setup(true);
        expect(buffsAppliedTo(r.events, c, 'Reactive Up')).toBe(0);
        expect(buffsAppliedTo(r.events, b, 'Reactive Up')).toBeGreaterThan(0);
    });

    it('control: the reaction fires on the same unit without the flag', () => {
        const { r, c } = setup(false);
        expect(buffsAppliedTo(r.events, c, 'Reactive Up')).toBeGreaterThan(0);
    });

    it('a DoT tick and a Bomb burst deal it nothing', () => {
        const dotKit = (): ShipSkills => ({
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        ...hitKit(1).slots[0].abilities,
                        ...(['inferno', 'bomb'] as const).map((dotType): Ability => ({
                            id: `dot-${dotType}`,
                            type: 'dot',
                            target: 'enemy',
                            trigger: 'on-cast',
                            conditions: [],
                            config: {
                                type: 'dot',
                                dotType,
                                tier: dotType === 'bomb' ? 100 : 45,
                                stacks: 1,
                                duration: 1,
                            },
                        })),
                    ],
                },
            ],
        });
        // The carrier carries the debuffs' damage only if the flags failed: strip debuffImmune so
        // the DoT and Bomb land and the damage gate is what protects it.
        const carrier = unit('carrier', 'M4', {
            kit: { ...carrierKit(true), debuffImmune: undefined },
        });
        const attacker = aoeAttacker({ kit: dotKit(), pattern: undefined, attack: 1e5 });
        const r = run(placement, carrier, [], [attacker], 4);
        const { id } = boardInput(placement, carrier, [], [attacker], 4);
        expect(r.events.some((e) => e.type === 'dot-applied' && e.targetId === id(carrier))).toBe(
            true
        );
        expect(r.hp[id(carrier)]).toBe(1e6);
    });
});

describe.each(SIDES)('debuff immunity, carrier on the %s side', (placement) => {
    const debuffKit = (): ShipSkills => ({
        slots: [
            {
                slot: 'active',
                abilities: [
                    {
                        id: 'named',
                        type: 'debuff',
                        target: 'enemy',
                        trigger: 'on-cast',
                        conditions: [],
                        config: {
                            type: 'debuff',
                            buffName: 'Probe A',
                            parsedEffects: {},
                            stacks: 1,
                            isStackable: false,
                            application: 'inflict',
                            duration: 5,
                        },
                    },
                    {
                        id: 'dot',
                        type: 'dot',
                        target: 'enemy',
                        trigger: 'on-cast',
                        conditions: [],
                        config: {
                            type: 'dot',
                            dotType: 'corrosion',
                            tier: 9,
                            stacks: 1,
                            duration: 5,
                        },
                    },
                    {
                        id: 'bomb',
                        type: 'dot',
                        target: 'enemy',
                        trigger: 'on-cast',
                        conditions: [],
                        config: { type: 'dot', dotType: 'bomb', tier: 100, stacks: 1, duration: 5 },
                    },
                    {
                        id: 'burst',
                        type: 'accumulate-detonate',
                        target: 'enemy',
                        trigger: 'on-cast',
                        conditions: [],
                        config: { type: 'accumulate-detonate', turns: 3, pct: 50 },
                    },
                ],
            },
        ],
    });

    const landings = (immune: boolean) => {
        const carrier = unit('carrier', 'M4', {
            kit: { ...carrierKit(false), ...(immune ? { debuffImmune: true } : {}) },
        });
        const attacker = unit('inflicter', 'M4', {
            kit: debuffKit(),
            speed: 500,
            hacking: 1e6,
            attack: 1,
        });
        const { id } = boardInput(placement, carrier, [], [attacker], 2);
        const r = run(placement, carrier, [], [attacker], 2);
        const cid = id(carrier);
        const on = (e: CombatEvent) => 'targetId' in e && e.targetId === cid;
        return {
            debuffs: r.events.filter((e) => e.type === 'debuff-applied' && on(e)).length,
            dots: r.events.filter((e) => e.type === 'dot-applied' && on(e)).length,
            resists: r.events.filter((e) => e.type === 'debuff-resisted' && on(e)).length,
        };
    };

    it('control: a carrier without the flag receives the debuff, DoT, Bomb and burst', () => {
        const x = landings(false);
        expect(x.debuffs).toBeGreaterThan(0);
        expect(x.dots).toBeGreaterThan(0);
    });

    it('lands no debuff, DoT, Bomb or burst on the immune unit, and reports no resist', () => {
        const x = landings(true);
        expect(x).toEqual({ debuffs: 0, dots: 0, resists: 0 });
    });
});

describe.each(SIDES)('purge immunity, carrier on the %s side', (placement) => {
    const purgeAbility = (trigger: Ability['trigger']): Ability => ({
        id: 'purge',
        type: 'purge',
        target: trigger === 'on-cast' ? 'enemy' : 'enemy-most-buffs',
        trigger,
        conditions: [],
        config: { type: 'purge', count: 'all' },
    });
    /** `cast`: the purge rides the active; `reaction`: it rides the passive at end of round. */
    const purger = (via: 'cast' | 'reaction'): BoardUnit => ({
        id: 'purger',
        kit: {
            slots:
                via === 'cast'
                    ? [{ slot: 'active', abilities: [purgeAbility('on-cast')] }]
                    : [
                          { slot: 'active', abilities: [] },
                          { slot: 'passive', abilities: [purgeAbility('end-of-round')] },
                      ],
        },
        position: 'M4',
        speed: 500,
        hacking: 1e6,
        hp: 1e9,
    });
    const purged = (immune: boolean, via: 'cast' | 'reaction'): number => {
        const carrier = unit('carrier', 'M4', {
            kit: {
                slots: [
                    { slot: 'active', abilities: [] },
                    { slot: 'passive', abilities: [heldBuff('Defense Up III')] },
                ],
                ...(immune ? { purgeImmune: true } : {}),
            },
        });
        const p = purger(via);
        const { id } = boardInput(placement, carrier, [], [p], 1);
        const r = run(placement, carrier, [], [p], 1);
        const cid = id(carrier);
        return r.events.filter((e) => e.type === 'purge-performed' && e.targetId === cid).length;
    };

    it.each(['cast', 'reaction'] as const)(
        'control: a %s purge removes the carrier buff without the flag',
        (via) => {
            expect(purged(false, via)).toBeGreaterThan(0);
        }
    );

    it.each(['cast', 'reaction'] as const)(
        'a %s purge removes none of the immune unit buffs and reports nothing',
        (via) => {
            expect(purged(true, via)).toBe(0);
        }
    );
});

describe.each(SIDES)('a unit with empty active and charged, on the %s side', (placement) => {
    it('takes every turn and casts nothing, and its Stealth ticks down on its own turns', () => {
        const kit = buildShipAbilities(npcShip('torpedo', 135)!);
        // The blast clause rides its own trigger; the turn itself must cast nothing.
        const idle: ShipSkills = {
            ...kit,
            slots: kit.slots.map((s) => ({
                ...s,
                abilities: s.abilities.filter((a) => a.type !== 'damage'),
            })),
        };
        const torpedo: BoardUnit = {
            id: 'torpedo',
            kit: idle,
            position: 'T4',
            speed: 93,
            hp: 38160,
            attack: 1000,
        };
        const rounds = 12;
        const foe = aoeAttacker({ attack: 0 });
        const { id } = boardInput(placement, torpedo, [], [foe], rounds);
        const tid = id(torpedo);
        const { events, hp } = run(placement, torpedo, [], [foe], rounds);
        const turns = events.filter((e) => e.type === 'turn-started' && e.actorId === tid);
        expect(turns).toHaveLength(rounds);
        // The turn lands no hit: no `attacked`, and the opponent keeps all its HP.
        expect(events.filter((e) => e.type === 'attacked' && e.attackerId === tid)).toEqual([]);
        expect(hp[id(foe)]).toBe(1e9);
        const expired = events.find(
            (e) => e.type === 'buff-expired' && e.actorId === tid && e.buffName === 'Stealth'
        );
        expect(expired && 'round' in expired ? expired.round : undefined).toBe(10);
    });
});

describe('HP writes that skip the damage funnel', () => {
    const victim = (damageImmune: boolean): CombatActor => {
        const a = createActor({
            id: 'v',
            side: 'enemy',
            kind: 'attacker',
            stats: {
                attack: 0,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                shieldPenetration: 0,
                defence: 0,
                hp: 1000,
                speed: 1,
            },
            ...(damageImmune ? { damageImmune: true } : {}),
        });
        a.pendingBombs.push({
            countdown: 1,
            damagePerStack: 100,
            stacks: 1,
            tier: 100,
            sourceId: 's',
            detonationDamageModifier: 0,
            splashModifier: 0,
        });
        return a;
    };

    it('the bare bomb burst fallback takes HP from a normal unit', () => {
        const v = victim(false);
        reduceBombsOnVictim(v, 1, 1, createEventBus(), 'd');
        expect(v.currentHp).toBeLessThan(1000);
    });

    it('the bare bomb burst fallback leaves a damage-immune unit untouched', () => {
        const v = victim(true);
        reduceBombsOnVictim(v, 1, 1, createEventBus(), 'd');
        expect(v.currentHp).toBe(1000);
    });
});

describe.each(SIDES)(
    'Reversed Repairs on a damage-immune unit, carrier on the %s side',
    (placement) => {
        const burnedHp = (damageImmune: boolean): number => {
            const carrier = unit('carrier', 'M4', {
                kit: { ...carrierKit(false), ...(damageImmune ? { damageImmune: true } : {}) },
                hp: 100_000,
                speed: 100,
            });
            const medic = unit('medic', 'M3', {
                kit: {
                    slots: [
                        {
                            slot: 'active',
                            abilities: [
                                {
                                    id: 'repair',
                                    type: 'heal',
                                    target: 'lowest-hp-ally',
                                    trigger: 'on-cast',
                                    conditions: [],
                                    config: { type: 'heal', pct: 10, basis: 'hp' },
                                },
                            ],
                        },
                    ],
                },
                hp: 100_000,
                speed: 50,
            });
            const zosimos = unit('zosimos', 'M4', {
                kit: {
                    slots: [
                        {
                            slot: 'active',
                            abilities: [
                                {
                                    id: 'reverse',
                                    type: 'debuff',
                                    target: 'all-enemies',
                                    trigger: 'on-cast',
                                    conditions: [],
                                    config: {
                                        type: 'debuff',
                                        buffName: 'Reversed Repairs',
                                        parsedEffects: {},
                                        stacks: 1,
                                        isStackable: false,
                                        duration: 5,
                                        application: 'apply',
                                    },
                                },
                            ],
                        },
                    ],
                },
                speed: 500,
                pattern: parsePattern('Pattern-All'),
            });
            const { id } = boardInput(placement, carrier, [medic], [zosimos], 1);
            return run(placement, carrier, [medic], [zosimos], 1).hp[id(carrier)];
        };

        it('control: the burn takes HP from a normal unit', () => {
            expect(burnedHp(false)).toBeLessThan(100_000);
        });

        it('the burn takes none from a damage-immune unit', () => {
            expect(burnedHp(true)).toBe(100_000);
        });
    }
);
