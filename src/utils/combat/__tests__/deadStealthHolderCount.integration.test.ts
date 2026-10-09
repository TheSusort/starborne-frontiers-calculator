/**
 * A dead Stealth holder is nobody's "enemy with Stealth": Selenite's per-stealthed-enemy damage
 * and Graphite's "an enemy Unit has Stealth" start-of-round gate read the LIVING opposing side,
 * whichever side the reader stands on.
 *
 * Board: a fast holder at the front gains Stealth on its first turn; An ally's Inferno kills it at
 * the start of its second turn, so the holder dies still carrying the status. The
 * control holder never gains Stealth and dies the same way.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus, type CombatEvent } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import {
    boardInput,
    NO_KIT,
    realKit,
    type BoardUnit,
    type Placement,
} from '../__testutils__/realKitBoard';
import type { Ability, ShipSkills } from '../../../types/abilities';

beforeEach(() => setupKeyedRng(7));

const stealthSelf: Ability = {
    id: 'stealth-self',
    type: 'buff',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'buff',
        buffName: 'Stealth',
        parsedEffects: {},
        stacks: 1,
        isStackable: false,
        duration: 99,
    },
};
/** Lays Inferno on the front enemy. One tick is 1.35M, so a 2M HP holder survives the tick at the
 *  start of its first turn (and gains Stealth) and dies to the next one. */
const infernoKit: ShipSkills = {
    slots: [
        {
            slot: 'active',
            abilities: [
                {
                    id: 'inferno',
                    type: 'dot',
                    target: 'enemy',
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'dot', dotType: 'inferno', tier: 45, stacks: 3, duration: 5 },
                },
            ],
        },
    ],
};
const holderKit = (stealthy: boolean): ShipSkills => ({
    slots: [{ slot: 'active', abilities: stealthy ? [stealthSelf] : [] }],
});

const record = (input: Parameters<typeof runCombat>[0]): CombatEvent[] => {
    const bus = createEventBus();
    const events: CombatEvent[] = [];
    bus.on('ability-performed', (e) => events.push(e as CombatEvent));
    bus.on('ship-destroyed', (e) => events.push(e as CombatEvent));
    bus.on('round-started', (e) => events.push(e as CombatEvent));
    bus.on('charge-changed', (e) => events.push(e as CombatEvent));
    runCombat({ ...input, bus });
    return events;
};

describe('dead Stealth holders are not counted (Selenite)', () => {
    const seleniteRound2 = (placement: Placement, stealthy: boolean): number => {
        const selenite: BoardUnit = {
            id: 'selenite',
            kit: realKit('Selenite'),
            position: 'M4',
            speed: 100,
            attack: 100_000,
            hp: 1_000_000,
        };
        const holder: BoardUnit = {
            id: 'holder',
            kit: holderKit(stealthy),
            position: 'M4',
            speed: 500,
            hp: 2_000_000,
        };
        const body: BoardUnit = {
            id: 'body',
            kit: NO_KIT,
            position: 'T4',
            speed: 1,
            hp: 1e12,
        };
        const igniter: BoardUnit = {
            id: 'igniter',
            kit: infernoKit,
            position: 'B4',
            speed: 1000,
            attack: 1_000_000,
            hacking: 1_000_000,
            hp: 1e9,
        };
        const { input, id } = boardInput(placement, selenite, [igniter], [holder, body], 3);
        const seleniteId = id(selenite);
        const hits = record(input).filter(
            (e) => e.type === 'ability-performed' && e.actorId === seleniteId
        );
        // Selenite's casts, in order: R1 sees the holder alive, R2 is the first with it dead.
        const second = hits[1];
        if (!second || second.type !== 'ability-performed') throw new Error('no round-2 cast');
        return second.damage ?? NaN;
    };

    for (const placement of ['player', 'enemy'] as const) {
        it(`Selenite on the ${placement} side: a dead Stealth holder adds no bonus`, () => {
            const withDeadStealth = seleniteRound2(placement, true);
            const control = seleniteRound2(placement, false);
            expect(control).toBeGreaterThan(0);
            expect(withDeadStealth).toBe(control);
        });
    }
});

describe('a dead Stealth holder does not open the Graphite start-of-round Stealth gate', () => {
    const chargeKit: ShipSkills = {
        slots: [
            { slot: 'active', abilities: [] },
            { slot: 'charged', abilities: [] },
        ],
    };
    /** Charge changes on Graphite's ally, tagged by the round they land in. */
    const allyChargeRounds = (
        placement: Placement,
        holderKind: 'dead-stealth' | 'live-stealth' | 'dead-plain'
    ): number[] => {
        const graphite: BoardUnit = {
            id: 'graphite',
            kit: realKit('Graphite'),
            position: 'M4',
            speed: 100,
            hp: 1e9,
        };
        const ally: BoardUnit = {
            id: 'ally',
            kit: chargeKit,
            position: 'B3',
            speed: 50,
            chargeCount: 9,
            hp: 1e9,
        };
        const holder: BoardUnit = {
            id: 'holder',
            kit: holderKit(holderKind !== 'dead-plain'),
            position: 'T4',
            speed: 500,
            hp: 2_000_000,
        };
        const body: BoardUnit = { id: 'body', kit: NO_KIT, position: 'M4', speed: 1, hp: 1e12 };
        const igniter: BoardUnit = {
            id: 'igniter',
            kit: infernoKit,
            position: 'B4',
            speed: 1000,
            attack: 1_000_000,
            hacking: 1_000_000,
            hp: 1e9,
        };
        const withIgniter = holderKind !== 'live-stealth';
        const { input, id } = boardInput(
            placement,
            graphite,
            withIgniter ? [igniter, ally] : [ally],
            [holder, body],
            4
        );
        let round = 0;
        const rounds: number[] = [];
        for (const e of record(input)) {
            if (e.type === 'round-started') round = e.round;
            if (e.type === 'charge-changed' && e.actorId === id(ally) && e.reason === 'manip')
                rounds.push(round);
        }
        return rounds;
    };

    for (const placement of ['player', 'enemy'] as const) {
        it(`Graphite on the ${placement} side: a LIVE Stealth holder charges the ally every round`, () => {
            expect(allyChargeRounds(placement, 'live-stealth')).toContain(4);
        });
        it(`Graphite on the ${placement} side: a DEAD Stealth holder grants no charge once it is gone`, () => {
            const rounds = allyChargeRounds(placement, 'dead-stealth');
            expect(rounds).not.toContain(4);
        });
    }
});
