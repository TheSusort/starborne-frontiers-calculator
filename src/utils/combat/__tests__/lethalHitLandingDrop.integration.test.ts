/**
 * Owner ruling 2026-10-22: a cast's damage resolves first, in written order. A Bomb, DoT or named
 * debuff written after the damage clause does not land on a ship that damage destroyed: no state,
 * no splash from it, and no "when this Unit inflicts a debuff" reaction. The engine records the
 * dropped landing (`landing-dropped`, log-only) on the attack row that struck the ship.
 *
 * Real parsed kits (buildTraceShip, refit 4); every scenario runs with the caster on the player
 * side and mirrored onto the enemy side, each with a control in which the struck ship survives.
 *  - Panguan: "deals 145% damage … and inflicts Bomb II for 2 turns" (here over Pattern-All).
 *  - Huanying: "deals 120% damage and inflicts Bomb I"; passive "When this Unit inflicts a debuff
 *    it gains Stealth and Tianchen Precision II".
 *  - Lodolite: "deals 240% damage … When this attack targets non-defenders, it also applies
 *    Concentrate Fire for 2 turns".
 *  - Oleander: "When an ally inflicts a debuff, this Unit adds 1 charge to its own charged skill",
 *    beside Curator ("deals 60% damage to all enemies, then inflicts Attack Down III and Crit
 *    Power Down III").
 *  - Bayah: active "deals 120% damage … and inflicts Crit Power Down II and Attack Down II";
 *    passive (refit 4) "When this Unit deals damage to an enemy that has 2 or more debuffs, it
 *    inflicts Speed Down II … and Out. Damage Down II". The passive reacts to the hit, so — like Enforcer's crit Shred (R141) — it
 *    still lands on the ship the hit destroys; the active's own clauses do not.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus, type CombatEvent } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import {
    boardInput,
    NO_KIT,
    realKit,
    type BoardUnit,
    type Placement,
} from '../__testutils__/realKitBoard';
import { parsePattern, parseTarget } from '../../targetingParser';
import type { ShipSkills } from '../../../types/abilities';
import type { ShipTypeName } from '../../../constants/shipTypes';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable())
        throw new Error('docs/ship-skills.csv and docs/ship-data.json are required');
});
beforeEach(() => setupKeyedRng(7));

const PLACEMENTS: Placement[] = ['player', 'enemy'];

/** The kit's active and passive: every cast is the real active. */
const activeKit = (ship: string): ShipSkills => ({
    ...realKit(ship),
    slots: realKit(ship).slots.filter((s) => s.slot !== 'charged'),
});

const run = (
    placement: Placement,
    caster: BoardUnit,
    allies: BoardUnit[],
    opponents: BoardUnit[],
    rounds = 1,
    /** Gives `opponents[0]` this role (what a "targets non-defenders" gate reads). */
    firstOpponentRole?: ShipTypeName
): { events: CombatEvent[]; id: (u: BoardUnit) => string } => {
    const { input, id } = boardInput(placement, caster, allies, opponents, rounds);
    if (firstOpponentRole !== undefined) {
        if (placement === 'enemy') input.role = firstOpponentRole;
        else input.enemyAttackers.find((a) => a.id === opponents[0].id)!.role = firstOpponentRole;
    }
    const bus = createEventBus();
    const events: CombatEvent[] = [];
    const emit = bus.emit;
    bus.emit = (e) => {
        events.push(e);
        emit(e);
    };
    runCombat({ ...input, bus });
    return { events, id };
};

const destroyed = (events: CombatEvent[], id: string): boolean =>
    events.some((e) => e.type === 'ship-destroyed' && e.actorId === id);
const dotsOn = (events: CombatEvent[], sourceId: string, targetId: string): string[] =>
    events.flatMap((e) =>
        e.type === 'dot-applied' && e.sourceId === sourceId && e.targetId === targetId
            ? [e.dotType]
            : []
    );
const debuffsOn = (events: CombatEvent[], sourceId: string, targetId: string): string[] =>
    events.flatMap((e) =>
        e.type === 'debuff-applied' && e.sourceId === sourceId && e.targetId === targetId
            ? [e.buffName]
            : []
    );
const dropped = (events: CombatEvent[], sourceId: string, targetId: string): string[] =>
    events.flatMap((e) =>
        e.type === 'landing-dropped' && e.sourceId === sourceId && e.targetId === targetId
            ? [e.label]
            : []
    );

/** A victim that survives one lethal hit through an always-on Cheat Death. */
const cheatDeathKit = (): ShipSkills => ({
    slots: [
        { slot: 'active', abilities: [] },
        {
            slot: 'passive',
            abilities: [
                {
                    id: 'test-cheat-death',
                    type: 'buff',
                    target: 'self',
                    trigger: 'on-cast',
                    conditions: [],
                    config: {
                        type: 'buff',
                        buffName: 'Cheat Death',
                        parsedEffects: {},
                        stacks: 1,
                        isStackable: false,
                        duration: 'recurring',
                    },
                },
            ],
        },
    ],
});

describe.each(PLACEMENTS)("Panguan's Bomb on the %s side", (placement) => {
    const panguan = (): BoardUnit => ({
        id: 'panguan',
        kit: activeKit('Panguan'),
        position: 'M4',
        speed: 100,
        attack: 1000,
        hacking: 1e6,
        pattern: parsePattern('Pattern-All'),
        target: parseTarget('all'),
    });
    const setup = (aHp: number, aKit: ShipSkills = NO_KIT) => {
        const p = panguan();
        // A at the front with its neighbour B: a Bomb on A would splash B when A dies.
        const a: BoardUnit = { id: 'shipA', kit: aKit, position: 'M4', speed: 1, hp: aHp };
        const b: BoardUnit = { id: 'shipB', kit: NO_KIT, position: 'M3', speed: 2, hp: 1e9 };
        const { events, id } = run(placement, p, [], [a, b]);
        return { events, id, p, a, b };
    };

    it('the ship the AoE kills takes no Bomb and splashes nothing; the survivor takes its Bomb', () => {
        const s = setup(500);
        expect(destroyed(s.events, s.id(s.a))).toBe(true);
        expect(dotsOn(s.events, s.id(s.p), s.id(s.a))).toEqual([]);
        expect(dropped(s.events, s.id(s.p), s.id(s.a))).toEqual(['Bomb']);
        expect(s.events.filter((e) => e.type === 'bomb-splash-log')).toEqual([]);
        expect(dotsOn(s.events, s.id(s.p), s.id(s.b))).toEqual(['bomb']);
        expect(dropped(s.events, s.id(s.p), s.id(s.b))).toEqual([]);
    });

    it('control: a ship the AoE leaves standing takes its Bomb', () => {
        const s = setup(1e9);
        expect(destroyed(s.events, s.id(s.a))).toBe(false);
        expect(dotsOn(s.events, s.id(s.p), s.id(s.a))).toEqual(['bomb']);
        expect(dropped(s.events, s.id(s.p), s.id(s.a))).toEqual([]);
    });

    it('a ship saved from the lethal hit by Cheat Death is standing, so its Bomb lands', () => {
        const s = setup(500, cheatDeathKit());
        expect(destroyed(s.events, s.id(s.a))).toBe(false);
        expect(
            s.events.some((e) => e.type === 'cheat-death-activated' && e.actorId === s.id(s.a))
        ).toBe(true);
        expect(dotsOn(s.events, s.id(s.p), s.id(s.a))).toEqual(['bomb']);
    });
});

describe.each(PLACEMENTS)("Huanying's on-inflict Stealth on the %s side", (placement) => {
    const setup = (victimHp: number) => {
        const h: BoardUnit = {
            id: 'huanying',
            kit: activeKit('Huanying'),
            position: 'M4',
            speed: 100,
            attack: 1000,
            hacking: 1e6,
        };
        const v: BoardUnit = { id: 'victim', kit: NO_KIT, position: 'M4', speed: 1, hp: victimHp };
        const back: BoardUnit = { id: 'back', kit: NO_KIT, position: 'M2', speed: 2, hp: 1e9 };
        const { events, id } = run(placement, h, [], [v, back]);
        const gained = events.flatMap((e) =>
            e.type === 'buff-applied' && e.actorId === id(h) ? [e.buffName] : []
        );
        return { events, id, h, v, gained };
    };

    it('a lethal hit inflicts no Bomb, so she gains nothing', () => {
        const s = setup(500);
        expect(destroyed(s.events, s.id(s.v))).toBe(true);
        expect(dotsOn(s.events, s.id(s.h), s.id(s.v))).toEqual([]);
        expect(dropped(s.events, s.id(s.h), s.id(s.v))).toEqual(['Bomb']);
        expect(s.gained).toEqual([]);
    });

    it('control: a hit the victim survives inflicts the Bomb and she gains Stealth', () => {
        const s = setup(1e9);
        expect(dotsOn(s.events, s.id(s.h), s.id(s.v))).toEqual(['bomb']);
        expect(s.gained).toContain('Stealth');
    });
});

describe.each(PLACEMENTS)("Lodolite's Concentrate Fire on the %s side", (placement) => {
    const setup = (victimHp: number) => {
        const l: BoardUnit = {
            id: 'lodolite',
            kit: activeKit('Lodolite'),
            position: 'M4',
            speed: 100,
            attack: 1000,
            hacking: 1e6,
        };
        const v: BoardUnit = { id: 'victim', kit: NO_KIT, position: 'M4', speed: 1, hp: victimHp };
        const back: BoardUnit = { id: 'back', kit: NO_KIT, position: 'M2', speed: 2, hp: 1e9 };
        const { events, id } = run(placement, l, [], [v, back], 1, 'DEBUFFER');
        const controls = events.filter(
            (e) => e.type === 'control-applied' && e.casterId === id(l) && e.targetId === id(v)
        );
        return { events, id, l, v, controls };
    };

    it('a lethal hit applies no Concentrate Fire and announces no control', () => {
        const s = setup(500);
        expect(destroyed(s.events, s.id(s.v))).toBe(true);
        expect(debuffsOn(s.events, s.id(s.l), s.id(s.v))).toEqual([]);
        expect(s.controls).toEqual([]);
        expect(dropped(s.events, s.id(s.l), s.id(s.v))).toEqual(['Concentrate Fire']);
    });

    it('control: a hit the victim survives applies it and announces the control', () => {
        const s = setup(1e9);
        expect(debuffsOn(s.events, s.id(s.l), s.id(s.v))).toEqual(['Concentrate Fire']);
        expect(s.controls).toHaveLength(1);
    });
});

describe.each(PLACEMENTS)("Oleander's ally-inflict charge on the %s side", (placement) => {
    const setup = (victimHp: number) => {
        const o: BoardUnit = {
            id: 'oleander',
            kit: activeKit('Oleander'),
            position: 'M2',
            speed: 1,
            chargeCount: 6,
        };
        const c: BoardUnit = {
            id: 'curator',
            kit: { slots: realKit('Curator').slots.filter((s) => s.slot === 'active') },
            position: 'M4',
            speed: 100,
            attack: 1000,
            hacking: 1e6,
            pattern: parsePattern('Pattern-All'),
            target: parseTarget('all'),
        };
        const v: BoardUnit = { id: 'victim', kit: NO_KIT, position: 'M4', speed: 2, hp: victimHp };
        const { events, id } = run(placement, o, [c], [v]);
        const charges = events.filter(
            (e) => e.type === 'charge-changed' && e.actorId === id(o) && e.newCharge > e.oldCharge
        );
        return { events, id, o, c, v, charges };
    };

    it("Curator's lethal hit inflicts nothing, so Oleander gains no charge", () => {
        const s = setup(500);
        expect(destroyed(s.events, s.id(s.v))).toBe(true);
        expect(debuffsOn(s.events, s.id(s.c), s.id(s.v))).toEqual([]);
        expect(dropped(s.events, s.id(s.c), s.id(s.v))).toEqual([
            'Attack Down III',
            'Crit Power Down III',
        ]);
        expect(s.charges).toEqual([]);
    });

    it('control: a hit the victim survives inflicts both debuffs and charges her', () => {
        const s = setup(1e9);
        expect(debuffsOn(s.events, s.id(s.c), s.id(s.v))).toEqual([
            'Attack Down III',
            'Crit Power Down III',
        ]);
        expect(s.charges.length).toBeGreaterThan(0);
    });
});

describe.each(PLACEMENTS)("Bayah's passive rider on the %s side", (placement) => {
    const setup = (victimHp: number) => {
        const b: BoardUnit = {
            id: 'bayah',
            kit: activeKit('Bayah'),
            position: 'M4',
            speed: 100,
            attack: 1000,
            hacking: 1e6,
        };
        const v: BoardUnit = { id: 'victim', kit: NO_KIT, position: 'M4', speed: 1, hp: victimHp };
        const back: BoardUnit = { id: 'back', kit: NO_KIT, position: 'M2', speed: 2, hp: 1e9 };
        const { events, id } = run(placement, b, [], [v, back], 2);
        const hits = events.flatMap((e) =>
            e.type === 'attacked' && e.attackerId === id(b) && e.targetId === id(v)
                ? [e.takenDamage ?? e.damage ?? 0]
                : []
        );
        return { events, id, b, v, hits };
    };

    it('her round-2 lethal hit on a twice-debuffed enemy still lands her passive debuffs, not her active ones', () => {
        // The victim survives her round-1 hit (which leaves Crit Power Down II and Attack Down II)
        // and dies to the round-2 hit: 1.5 hits of HP, measured off the survivor control.
        const control = setup(1e9);
        expect(control.hits).toHaveLength(2);
        const s = setup(Math.round(control.hits[0] * 1.5));
        expect(destroyed(s.events, s.id(s.v))).toBe(true);
        expect(s.hits).toHaveLength(2);
        expect(debuffsOn(s.events, s.id(s.b), s.id(s.v))).toEqual([
            'Crit Power Down II',
            'Attack Down II',
            'Speed Down II',
            'Out. Damage Down II',
        ]);
        expect(dropped(s.events, s.id(s.b), s.id(s.v))).toEqual([
            'Crit Power Down II',
            'Attack Down II',
        ]);
    });

    it('control: an enemy that survives both hits takes both casts and the rider', () => {
        const s = setup(1e9);
        expect(debuffsOn(s.events, s.id(s.b), s.id(s.v))).toEqual([
            'Crit Power Down II',
            'Attack Down II',
            'Crit Power Down II',
            'Attack Down II',
            'Speed Down II',
            'Out. Damage Down II',
        ]);
    });
});

// The cast's after-damage landings resolve in written order among themselves too: Butcher's
// charged "deals 150% damage … inflicts Inferno III for 3 turns, and inflicts Block Buff for 1
// turn" lands the Inferno first; Sha Xing's active "deals 170% damage, inflicts Inc. Repair Down II for 1
// turn, and Bomb I for 2 turns" lands the debuff first.
describe.each(PLACEMENTS)('after-damage landings in written order on the %s side', (placement) => {
    const order = (ship: string, charged: boolean) => {
        const caster: BoardUnit = {
            id: 'caster',
            kit: charged ? realKit(ship) : activeKit(ship),
            position: 'M4',
            speed: 100,
            attack: 1000,
            hacking: 1e6,
            startCharged: charged,
            chargeCount: charged ? 3 : 0,
        };
        const v: BoardUnit = { id: 'victim', kit: NO_KIT, position: 'M4', speed: 1, hp: 1e9 };
        const { events, id } = run(placement, caster, [], [v]);
        const firstTurn = events.slice(
            0,
            events.findIndex((e) => e.type === 'turn-ended' && e.actorId === id(caster))
        );
        return firstTurn.flatMap((e) =>
            (e.type === 'dot-applied' || e.type === 'debuff-applied') &&
            e.sourceId === id(caster) &&
            e.targetId === id(v)
                ? [e.type === 'dot-applied' ? e.dotType : e.buffName]
                : []
        );
    };

    it("Butcher's charged: the Inferno, then Block Buff", () => {
        expect(order('Butcher', true)).toEqual(['inferno', 'Block Buff']);
    });

    it("Sha Xing's active: Inc. Repair Down, then the Bomb", () => {
        expect(order('Sha Xing', false)).toEqual(['Inc. Repair Down II', 'bomb']);
    });
});
