/**
 * R168 (owner-confirmed in game): a passive's round-boundary damage is a REAL direct hit. Judge's
 * "At the start of the round, deals 60% damage to all enemies with less than 50% HP" is answered
 * by the victim's counter and lowers the victim's Stasis exactly like a cast hit.
 *
 * Board (real Judge and Stalwart kits, every scenario run with Judge on both sides): a chip hitter
 * fires a one-shot charged hit in round 1 that takes the victim under 50% HP; Judge, fast-less and
 * passive-only, then hits it at the start of round 2. The victim sits above 50% HP at the start of
 * round 1, so the same fight carries its own negative control: Judge's round-1 pass finds nobody.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import {
    boardInput,
    realKit,
    hitKit,
    type BoardUnit,
    type Placement,
} from '../__testutils__/realKitBoard';
import type { ShipSkills } from '../../../types/abilities';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable())
        throw new Error('docs/ship-skills.csv and docs/ship-data.json are required');
});
beforeEach(() => setupKeyedRng(168));

const SIDES: Placement[] = ['player', 'enemy'];
const VICTIM_HP = 1000;

const passivesOf = (ship: string): ShipSkills['slots'] =>
    realKit(ship).slots.filter((s) => s.slot === 'passive');

/** Judge with only his passives: his round-start hit is the only thing he does. */
const judgeKit = (): ShipSkills => ({
    slots: [{ slot: 'active', abilities: [] }, ...passivesOf('Judge')],
});

/** A one-shot charged hit (the cost is never met again), so it chips round 1 only. */
const chipKit = (): ShipSkills => ({
    slots: [
        { slot: 'active', abilities: [] },
        { slot: 'charged', abilities: hitKit(100).slots[0].abilities },
    ],
});

/** The victim: a plain damaging active (so "acted" is observable) plus the given passives. */
const victimKit = (ship: string | null): ShipSkills => ({
    slots: [...hitKit(1).slots, ...(ship ? passivesOf(ship) : [])],
});

const stasisApplier = (): ShipSkills => {
    const charged = realKit('Medved').slots.filter((s) => s.slot === 'charged');
    return { slots: [{ slot: 'active', abilities: [] }, ...charged] };
};

interface Opts {
    victim: string | null;
    /** Chip attack: 0 leaves the victim above 50% HP, so Judge finds nobody. */
    chipAttack: number;
    stasis?: boolean;
}

interface Reading {
    /** Judge's direct hits on the victim, as rounds. */
    judgeHits: number[];
    /** Victim counters onto Judge, as rounds. */
    counters: number[];
    /** Rounds the victim fired a skill. */
    acted: number[];
}

const run = (placement: Placement, o: Opts): Reading => {
    const chip: BoardUnit = {
        id: 'chip',
        kit: chipKit(),
        position: 'T4',
        speed: 300,
        attack: o.chipAttack,
        chargeCount: 10,
        startCharged: true,
    };
    const judge: BoardUnit = {
        id: 'judge',
        kit: judgeKit(),
        position: 'B4',
        speed: 50,
        attack: 170,
    };
    const victim: BoardUnit = {
        id: 'victim',
        kit: victimKit(o.victim),
        position: 'M4',
        speed: 100,
        attack: 10,
        hp: VICTIM_HP,
    };
    const applier: BoardUnit = {
        id: 'applier',
        kit: o.stasis ? stasisApplier() : { slots: [{ slot: 'active', abilities: [] }] },
        position: 'M3',
        speed: 250,
        hacking: 1e6,
        chargeCount: 10,
        startCharged: true,
    };
    // Player placement: carrier = focus. The carrier is the Stasis applier; Judge and the chip are
    // its allies. Enemy placement: the same units on the enemy side, victim = the focus actor.
    const { input, id } = boardInput(placement, applier, [chip, judge], [victim], 2);
    const nameOf = (actorId: string): string =>
        [applier, chip, judge, victim].find((u) => id(u) === actorId)?.id ?? actorId;
    const bus = createEventBus();
    const out: Reading = { judgeHits: [], counters: [], acted: [] };
    bus.on('attacked', (e) => {
        if (nameOf(e.targetId) === 'victim' && nameOf(e.attackerId) === 'judge' && !e.fromCounter)
            out.judgeHits.push(e.round);
        if (e.fromCounter && nameOf(e.attackerId) === 'victim' && nameOf(e.targetId) === 'judge')
            out.counters.push(e.round);
    });
    bus.on('ability-performed', (e) => {
        if (nameOf(e.actorId) === 'victim') out.acted.push(e.round);
    });
    runCombat({ ...input, bus });
    return out;
};

describe.each(SIDES)(
    "Judge's start-of-round hit is a direct hit (Judge on the %s side)",
    (side) => {
        it('a victim under 50% HP is hit at the start of round 2 and counters Judge', () => {
            const r = run(side, { victim: 'Stalwart', chipAttack: 600 });
            expect(r.judgeHits).toEqual([2]);
            expect(r.counters).toEqual([2]);
        });

        it('negative control: a victim above 50% HP is never hit, so nothing counters', () => {
            const r = run(side, { victim: 'Stalwart', chipAttack: 0 });
            expect(r.judgeHits).toEqual([]);
            expect(r.counters).toEqual([]);
        });

        it("the hit lowers the victim's Stasis: 2 turns, one tick, Judge's hit frees round 2", () => {
            const r = run(side, { victim: null, chipAttack: 600, stasis: true });
            expect(r.judgeHits).toEqual([2]);
            expect(r.acted).toEqual([2]);
        });

        it('negative control: with no Judge hit the 2-turn Stasis costs both rounds', () => {
            const r = run(side, { victim: null, chipAttack: 0, stasis: true });
            expect(r.judgeHits).toEqual([]);
            expect(r.acted).toEqual([]);
        });
    }
);
