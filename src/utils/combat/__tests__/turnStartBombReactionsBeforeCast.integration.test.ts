/**
 * Owner ruling R127: a Bomb that explodes at its holder's turn start resolves in this order —
 * the detonation, then the reactions to it, then the holder's skill.
 *
 * Demolisher's passive: "When a Bomb explodes on an enemy, this Unit removes 2 charges from the
 * enemy's charged skill ...". Akula starts combat fully charged (refit 4 passive), so her round-1
 * turn would fire her charged skill; with a Bomb exploding at that turn's start, Demolisher takes
 * the 2 charges first and Akula uses her normal skill.
 *
 * Real parsed kits (buildTraceShip, refit 4); the Bomb is seeded on Akula before the fight. Every
 * scenario runs with Demolisher on the player side and mirrored onto the enemy side.
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
import type { ShipSkills } from '../../../types/abilities';
import type { CombatActor } from '../state';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable())
        throw new Error('docs/ship-skills.csv and docs/ship-data.json are required');
});
beforeEach(() => setupKeyedRng(7));

const passiveOnly = (ship: string): ShipSkills => ({
    slots: [
        { slot: 'active', abilities: [] },
        ...realKit(ship).slots.filter((s) => s.slot === 'passive'),
    ],
});

interface Measured {
    /** The slot of each skill Akula fired, in order. */
    akulaSlots: string[];
    /** The events of Akula's round-1 turn, in order, as short tags. */
    order: string[];
}

const run = (placement: Placement, demolisherKit: ShipSkills): Measured => {
    const demolisher: BoardUnit = {
        id: 'demolisher',
        kit: demolisherKit,
        position: 'M4',
        speed: 1,
    };
    const akula: BoardUnit = {
        id: 'akula',
        kit: realKit('Akula'),
        position: 'M4',
        speed: 100,
        attack: 1000,
        chargeCount: 2,
        startCharged: true,
    };
    const { input, id } = boardInput(placement, demolisher, [], [akula], 1);
    const bus = createEventBus();
    const events: CombatEvent[] = [];
    const emit = bus.emit;
    bus.emit = (e) => {
        events.push(e);
        emit(e);
    };
    runCombat({
        ...input,
        bus,
        __testTapActors: (all: CombatActor[]) => {
            const a = all.find((x) => x.id === id(akula));
            if (!a) throw new Error('akula missing');
            a.pendingBombs.push({
                countdown: 1,
                damagePerStack: 1000,
                stacks: 1,
                tier: 300,
                sourceId: id(demolisher),
                affinityMult: 1,
                detonationDamageModifier: 0,
                splashModifier: 0,
                appliedSeq: 1,
            });
        },
    });
    const a = id(akula);
    const order: string[] = [];
    for (const e of events) {
        if (e.type === 'bomb-detonated' && e.victimId === a) order.push('detonated');
        if (e.type === 'charge-changed' && e.actorId === a && e.reason === 'manip')
            order.push('charges-removed');
        if (e.type === 'skill-fired' && e.actorId === a) order.push(`fired-${e.slot}`);
    }
    return {
        akulaSlots: events
            .filter(
                (e): e is Extract<CombatEvent, { type: 'skill-fired' }> =>
                    e.type === 'skill-fired' && e.actorId === a
            )
            .map((e) => e.slot),
        order,
    };
};

describe.each<Placement>(['player', 'enemy'])(
    'R127 with Demolisher on the %s side',
    (placement) => {
        it('the Bomb explodes, Demolisher removes 2 charges, then Akula uses her normal skill', () => {
            const m = run(placement, passiveOnly('Demolisher'));
            expect(m.order).toEqual(['detonated', 'charges-removed', 'fired-active']);
            expect(m.akulaSlots).toEqual(['active']);
        });

        it('control: without Demolisher the same Bomb leaves Akula her charged skill', () => {
            const m = run(placement, NO_KIT);
            expect(m.order).toEqual(['detonated', 'fired-charged']);
        });
    }
);
