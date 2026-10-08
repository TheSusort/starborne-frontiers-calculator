/**
 * Owner ruling R126 (tested in game): a Bomb's detonation, splash included, resolves BEFORE any
 * reaction to the hit that set it off — on both sides.
 *
 * Demolisher's charged skill: "deals 240% damage, detonates Bomb effects with 150% of their power,
 * and inflicts Bomb II". Her passive: "When a Bomb explodes on an enemy, this Unit removes 2
 * charges from the enemy's charged skill and deals 100% of the Bomb damage to all adjacent
 * enemies." That splash is itself a reaction (to the detonation), and it resolves before:
 *  - the struck Warden's "When directly damaged, inflicts Corrosion I ... and repairs 3%";
 *  - an ally Sentinel's "When another ally critically hits an enemy, deals 60% damage to that
 *    enemy", which answers the attack itself (emitted before the detonation).
 *
 * The emission order is also the same on both sides: the attack, the detonation, then the
 * `attacked` that wakes the victim's reactions.
 *
 * Real parsed kits (buildTraceShip, refit 4); the Bomb is seeded on the struck ship before the
 * fight. Every scenario runs with Demolisher on the player side and mirrored onto the enemy side.
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

const demolisher = (crit = 0): BoardUnit => ({
    id: 'demolisher',
    kit: realKit('Demolisher'),
    position: 'M4',
    speed: 100,
    attack: 1000,
    crit,
    chargeCount: 3,
    startCharged: true,
    hacking: 1e6,
});
const warden = (): BoardUnit => ({
    id: 'warden',
    kit: passiveOnly('Warden'),
    position: 'M4',
    speed: 1,
    hacking: 1e6,
});
/** Adjacent to M4, so the splash reaches it. */
const neighbour = (): BoardUnit => ({ id: 'neighbour', kit: NO_KIT, position: 'M3', speed: 2 });

/** Every event of a one-round fight, with a Bomb seeded on `holder` (from `demo`). */
const run = (
    placement: Placement,
    demo: BoardUnit,
    allies: BoardUnit[],
    holder: BoardUnit,
    others: BoardUnit[]
): { events: CombatEvent[]; id: (u: BoardUnit) => string } => {
    const { input, id } = boardInput(placement, demo, allies, [holder, ...others], 1);
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
            const h = all.find((a) => a.id === id(holder));
            if (!h) throw new Error('holder missing');
            h.pendingBombs.push({
                countdown: 5,
                damagePerStack: 5000,
                stacks: 1,
                tier: 300,
                sourceId: id(demo),
                affinityMult: 1,
                detonationDamageModifier: 0,
                splashModifier: 0,
                appliedSeq: 1,
            });
        },
    });
    return { events, id };
};

const indexOf = (events: CombatEvent[], pred: (e: CombatEvent) => boolean): number => {
    const i = events.findIndex(pred);
    expect(i, 'event not found').toBeGreaterThanOrEqual(0);
    return i;
};

describe.each<Placement>(['player', 'enemy'])(
    'R126 with Demolisher on the %s side',
    (placement) => {
        it("the splash resolves before the struck Warden's reaction", () => {
            const demo = demolisher();
            const w = warden();
            const n = neighbour();
            const { events, id } = run(placement, demo, [], w, [n]);
            const splash = indexOf(
                events,
                (e) =>
                    e.type === 'reactive-damage-performed' &&
                    e.sourceId === id(demo) &&
                    e.targetId === id(n)
            );
            const corrosion = indexOf(
                events,
                (e) => e.type === 'dot-applied' && e.sourceId === id(w) && e.dotType === 'corrosion'
            );
            expect(splash).toBeLessThan(corrosion);
            // The emission order: the attack, then the detonation, then the `attacked` it wakes.
            const performed = indexOf(
                events,
                (e) => e.type === 'ability-performed' && e.actorId === id(demo)
            );
            const detonated = indexOf(events, (e) => e.type === 'bomb-detonated');
            const attacked = indexOf(
                events,
                (e) => e.type === 'attacked' && e.attackerId === id(demo) && e.targetId === id(w)
            );
            expect(performed).toBeLessThan(detonated);
            expect(detonated).toBeLessThan(attacked);
        });

        it("the splash resolves before an ally Sentinel's on-crit hit answering the same attack", () => {
            const demo = demolisher(100);
            const sentinel: BoardUnit = {
                id: 'sentinel',
                kit: passiveOnly('Sentinel'),
                position: 'M3',
                speed: 50,
                attack: 10,
            };
            const holder: BoardUnit = { ...warden(), kit: NO_KIT };
            const n = neighbour();
            const { events, id } = run(placement, demo, [sentinel], holder, [n]);
            const splash = indexOf(
                events,
                (e) =>
                    e.type === 'reactive-damage-performed' &&
                    e.sourceId === id(demo) &&
                    e.targetId === id(n)
            );
            const tap = indexOf(
                events,
                (e) => e.type === 'reactive-damage-performed' && e.sourceId === id(sentinel)
            );
            expect(splash).toBeLessThan(tap);
        });
    }
);
