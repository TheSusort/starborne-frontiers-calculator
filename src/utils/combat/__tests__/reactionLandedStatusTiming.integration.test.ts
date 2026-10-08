/**
 * Owner ruling R123: a buff or debuff that lands DURING A REACTION does not tick down on the turn
 * it landed. A status ticks at its holder's own Post-Turn, so the only reaction-landed status that
 * an end-of-turn tick could cut short is one landing on the ship whose turn is executing — the
 * attacker that just set the reaction off. That status now survives this turn's Post-Turn and runs
 * its full window from the holder's next turn.
 *
 *  - Iridium: "When directly damaged, this Unit ... inflicts Speed Down II for 1 turn." The enemy
 *    that hits him on its own turn is still slowed on its NEXT turn.
 *  - Flamel: "When directly damaged this Unit inflicts Speed Down I and Stasis for 2 turns." The
 *    enemy that hits him skips its next TWO turns when nothing hits it in between.
 *  - Guardian: "When an ally is critically hit, this Unit applies Provoke for 1 turn to that
 *    enemy." The critting enemy's next attack goes to Guardian.
 *  - Control (the buff half): Guardian's "When this Unit is critically hit, it gains Binderburg
 *    Resilience I for 1 turn" lands on the enemy's turn and lasts through Guardian's next turn —
 *    a reaction-granted buff to its owner on someone else's turn was never cut short.
 *
 * Real parsed passives (buildTraceShip, refit 4). Every scenario runs with the carrier on the
 * player side and mirrored onto the enemy side.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus, type CombatEvent } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import {
    boardInput,
    hitKit,
    NO_KIT,
    type BoardUnit,
    type Placement,
} from '../__testutils__/realKitBoard';
import type { Ability, ShipSkills } from '../../../types/abilities';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable())
        throw new Error('docs/ship-skills.csv and docs/ship-data.json are required');
});
beforeEach(() => setupKeyedRng(5));

/** The real passive of `ship` behind an empty active, so the carrier never attacks. */
const passiveOnly = (ship: string): ShipSkills => {
    const built = buildTraceShip(ship, { refitLevel: 4 });
    if (!built) throw new Error(`${ship} missing from reference data`);
    const passive = buildShipAbilities(built).slots.find((s) => s.slot === 'passive');
    if (!passive) throw new Error(`${ship} has no passive slot`);
    return { slots: [{ slot: 'active', abilities: [] }, passive] };
};

/** "When an ally is directly damaged, deals 10% damage to the attacker." */
const ping: Ability = {
    id: 'ping',
    type: 'damage',
    target: 'enemy',
    trigger: 'on-ally-attacked',
    conditions: [],
    config: { type: 'damage', multiplier: 10 },
};
/** "When this Unit is directly damaged, it gains Attack Up I for 1 turn." */
const gainWhenAttacked: Ability = {
    id: 'gain-when-attacked',
    type: 'buff',
    target: 'self',
    trigger: 'on-attacked',
    conditions: [],
    config: {
        type: 'buff',
        buffName: 'Attack Up I',
        parsedEffects: {},
        stacks: 1,
        isStackable: false,
        duration: 1,
    },
};

interface Trace {
    /** Rounds in which `actorId` gained Attack Up I. */
    gainsBy: (actorId: string) => number[];
    /** Rounds in which `actorId` fired a skill. */
    firedRounds: (actorId: string) => number[];
    /** `actorId`'s speed at the start of each of its turns, by round. */
    speedAt: (actorId: string) => Map<number, number>;
    /** `actorId`'s defence at the start of each of its turns, by round. */
    defenceAt: (actorId: string) => Map<number, number>;
    /** The statuses `actorId` still carries at each round's tail, by round. */
    statusesAt: (actorId: string) => Map<number, string[]>;
    /** Who `attackerId` hit, in order, as `round:targetId`. */
    hitsBy: (attackerId: string) => string[];
}

const run = (
    placement: Placement,
    carrier: BoardUnit,
    allies: BoardUnit[],
    opponents: BoardUnit[],
    rounds: number
): { trace: Trace; id: (u: BoardUnit) => string } => {
    const { input, id } = boardInput(placement, carrier, allies, opponents, rounds);
    const bus = createEventBus();
    const events: CombatEvent[] = [];
    for (const type of [
        'skill-fired',
        'stats-snapshot',
        'status-snapshot',
        'attacked',
        'buff-applied',
    ] as const)
        bus.on(type, (e: CombatEvent) => events.push(e));
    runCombat({ ...input, bus });
    const of = <T extends CombatEvent['type']>(t: T) =>
        events.filter((e): e is Extract<CombatEvent, { type: T }> => e.type === t);
    return {
        id,
        trace: {
            gainsBy: (a) =>
                of('buff-applied')
                    .filter((e) => e.actorId === a && e.buffName === 'Attack Up I')
                    .map((e) => e.round),
            firedRounds: (a) =>
                of('skill-fired')
                    .filter((e) => e.actorId === a)
                    .map((e) => e.round),
            speedAt: (a) =>
                new Map(
                    of('stats-snapshot')
                        .filter((e) => e.actorId === a)
                        .map((e) => [e.round, e.stats.speed])
                ),
            defenceAt: (a) =>
                new Map(
                    of('stats-snapshot')
                        .filter((e) => e.actorId === a)
                        .map((e) => [e.round, e.stats.defence])
                ),
            statusesAt: (a) =>
                new Map(
                    of('status-snapshot')
                        .filter((e) => e.actorId === a)
                        .map((e) => [e.round, [...e.buffNames, ...e.debuffNames]])
                ),
            hitsBy: (a) =>
                of('attacked')
                    .filter((e) => e.attackerId === a)
                    .map((e) => `${e.round}:${e.targetId}`),
        },
    };
};

describe.each<Placement>(['player', 'enemy'])(
    'R123 with the carrier on the %s side',
    (placement) => {
        it("Iridium's 1-turn Speed Down II on his attacker lasts through its next turn", () => {
            const iridium: BoardUnit = {
                id: 'iridium',
                kit: passiveOnly('Iridium'),
                position: 'M4',
                speed: 1,
                hacking: 1e6,
            };
            const hitter: BoardUnit = {
                id: 'hitter',
                kit: hitKit(),
                position: 'M4',
                speed: 100,
                attack: 1,
            };
            const { trace, id } = run(placement, iridium, [], [hitter], 2);
            const speed = trace.speedAt(id(hitter));
            // Instrument: the hitter's first turn is unslowed and it really hit Iridium.
            expect(speed.get(1)).toBe(100);
            expect(trace.hitsBy(id(hitter))[0]).toBe(`1:${id(iridium)}`);
            // The debuff landed during the hitter's round-1 turn is still on it at the round's tail…
            expect(trace.statusesAt(id(hitter)).get(1)).toContain('Speed Down II');
            // …and slows its round-2 turn (-30%).
            expect(speed.get(2)).toBe(70);
        });

        it("Flamel's reaction-landed Stasis for 2 turns skips two of the attacker's turns", () => {
            const flamel: BoardUnit = {
                id: 'flamel',
                kit: passiveOnly('Flamel'),
                position: 'M4',
                speed: 1,
                hacking: 1e6,
            };
            const hitter: BoardUnit = {
                id: 'hitter',
                kit: hitKit(),
                position: 'M4',
                speed: 100,
                attack: 1,
            };
            const { trace, id } = run(placement, flamel, [], [hitter], 6);
            // Round 1: hits Flamel and is stasised on its own turn; rounds 2 and 3 are skipped; round
            // 4 it hits again and the cycle repeats.
            expect(trace.firedRounds(id(hitter))).toEqual([1, 4]);
            expect(trace.hitsBy(id(hitter))).toEqual([`1:${id(flamel)}`, `4:${id(flamel)}`]);
        });

        it("Flamel's Stasis is active at once: the attacker's own reactions stop, and a later hit still shortens it", () => {
            // Flamel (speed 50) and a slower ally (speed 10) both react to the hitter striking Flamel,
            // in turn order: Flamel's Stasis lands first, then the ally's 10% ping hits the hitter.
            // The hitter's "when attacked, gain Attack Up I" reaction to that ping is suppressed (it
            // is stasised), and the ping takes the 2-turn Stasis down to 1 (R40/R67), so the hitter
            // skips only round 2.
            const flamel: BoardUnit = {
                id: 'flamel',
                kit: passiveOnly('Flamel'),
                position: 'M4',
                speed: 50,
                hacking: 1e6,
            };
            const pinger: BoardUnit = {
                id: 'pinger',
                kit: {
                    slots: [
                        { slot: 'active', abilities: [] },
                        { slot: 'passive', abilities: [ping] },
                    ],
                },
                position: 'M3',
                speed: 10,
                attack: 1,
            };
            const hitter: BoardUnit = {
                id: 'hitter',
                kit: {
                    slots: [...hitKit().slots, { slot: 'passive', abilities: [gainWhenAttacked] }],
                },
                position: 'M4',
                speed: 100,
                attack: 1,
            };
            const onFlamelBoard = run(placement, flamel, [pinger], [hitter], 3);
            const h = onFlamelBoard.id(hitter);
            expect(onFlamelBoard.trace.hitsBy(onFlamelBoard.id(pinger))[0]).toBe(`1:${h}`);
            expect(onFlamelBoard.trace.firedRounds(h)).toEqual([1, 3]);
            expect(onFlamelBoard.trace.gainsBy(h)).toEqual([]);

            // Control: the same board with an inert ship in Flamel's place — the ping still lands and
            // the hitter's reaction to it fires every round.
            const inert: BoardUnit = { ...flamel, kit: NO_KIT };
            const control = run(placement, inert, [pinger], [hitter], 3);
            expect(control.trace.firedRounds(control.id(hitter))).toEqual([1, 2, 3]);
            expect(control.trace.gainsBy(control.id(hitter))).toEqual([1, 2, 3]);
        });

        it("Guardian's Provoke on a critting enemy forces that enemy's next attack onto Guardian", () => {
            const guardian: BoardUnit = {
                id: 'guardian',
                kit: passiveOnly('Guardian'),
                position: 'M3',
                speed: 1,
            };
            const front: BoardUnit = { id: 'front', kit: NO_KIT, position: 'M4', speed: 2 };
            const critter: BoardUnit = {
                id: 'critter',
                kit: hitKit(),
                position: 'M4',
                speed: 100,
                attack: 1,
                crit: 100,
            };
            const { trace, id } = run(placement, guardian, [front], [critter], 2);
            // Round 1 aims at the front ship (the critter's front-most target) and crits it; Guardian's
            // Provoke lands on the critter during that turn and drags its round-2 attack to Guardian.
            expect(trace.hitsBy(id(critter))).toEqual([`1:${id(front)}`, `2:${id(guardian)}`]);
        });

        it('control: a buff a reaction grants its owner on the enemy turn lasts through the owner next turn', () => {
            const guardian: BoardUnit = {
                id: 'guardian',
                kit: passiveOnly('Guardian'),
                position: 'M4',
                speed: 1,
                defence: 1000,
            };
            const critter: BoardUnit = {
                id: 'critter',
                kit: hitKit(),
                position: 'M4',
                speed: 100,
                attack: 1,
                crit: 100,
            };
            const { trace, id } = run(placement, guardian, [], [critter], 1);
            // Gained when critted on the critter's round-1 turn; Guardian's own round-1 turn follows.
            // It holds through that turn (+5% defence) and that turn's Post-Turn ticks it out.
            expect(trace.defenceAt(id(guardian)).get(1)).toBe(1050);
            expect(trace.statusesAt(id(guardian)).get(1)).not.toContain('Binderburg Resilience I');
        });
    }
);
