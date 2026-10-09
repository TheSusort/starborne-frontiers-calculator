/**
 * Owner ruling R125: a multi-hit attack resolves its reactions BETWEEN hits. Enforcer is the only
 * multi-hit ship ("This Unit attacks three times with each attack dealing 50% damage").
 *
 *  - Hit 1's crit Defense Shred (his passive: "When this Unit critically hits an enemy it inflicts
 *    Defense Shred for 3 turns") is on the target before hit 2, so hits 2 and 3 strike through it.
 *  - Stalwart's counter to hit 1 ("When this Unit is directly damaged as a primary target, it deals
 *    70% damage to the enemy") lands before hit 2.
 *  - A counter can destroy Enforcer mid-skill; his remaining hits then never happen.
 *
 * Real parsed kits (buildTraceShip, refit 4). Every scenario runs with Enforcer on the player side
 * and mirrored onto the enemy side.
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

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable())
        throw new Error('docs/ship-skills.csv and docs/ship-data.json are required');
});
beforeEach(() => setupKeyedRng(7));

/** Enforcer's active and passive (no charged slot, so every turn is the 3-hit active). */
const enforcerKit = (): ShipSkills => {
    const kit = realKit('Enforcer');
    return { slots: kit.slots.filter((s) => s.slot !== 'charged') };
};
/** Stalwart's passive behind an empty active, so he only counters. */
const stalwartPassive = (): ShipSkills => {
    const kit = realKit('Stalwart');
    return {
        slots: [
            { slot: 'active', abilities: [] },
            ...kit.slots.filter((s) => s.slot === 'passive'),
        ],
    };
};

const run = (
    placement: Placement,
    enforcer: BoardUnit,
    opponents: BoardUnit[],
    rounds = 1
): { events: CombatEvent[]; id: (u: BoardUnit) => string } => {
    const { input, id } = boardInput(placement, enforcer, [], opponents, rounds);
    const bus = createEventBus();
    const events: CombatEvent[] = [];
    for (const type of ['attacked', 'debuff-applied', 'ship-destroyed'] as const)
        bus.on(type, (e: CombatEvent) => events.push(e));
    runCombat({ ...input, bus });
    return { events, id };
};

type Attacked = Extract<CombatEvent, { type: 'attacked' }>;
const attacks = (events: CombatEvent[]): Attacked[] =>
    events.filter((e): e is Attacked => e.type === 'attacked');

describe.each<Placement>(['player', 'enemy'])('R125 with Enforcer on the %s side', (placement) => {
    const enforcer = (crit: number, hp = 1e9): BoardUnit => ({
        id: 'enforcer',
        kit: enforcerKit(),
        position: 'M4',
        speed: 100,
        attack: 1000,
        crit,
        critDamage: 0,
        hacking: 1e6,
        hp,
    });
    const wall: BoardUnit = {
        id: 'wall',
        kit: NO_KIT,
        position: 'M4',
        speed: 1,
        defence: 3000,
    };

    it("hit 1's crit Defense Shred is on the target before hit 2", () => {
        const critter = enforcer(100);
        const { events, id } = run(placement, critter, [wall]);
        const hits = attacks(events)
            .filter((e) => e.attackerId === id(critter))
            .map((e) => Math.round(e.takenDamage ?? 0));
        expect(hits).toHaveLength(3);
        // Control: without crits there is no Shred, and all three hits are equal.
        const plainEnforcer = enforcer(0);
        const control = run(placement, plainEnforcer, [wall]);
        const plain = attacks(control.events)
            .filter((e) => e.attackerId === control.id(plainEnforcer))
            .map((e) => Math.round(e.takenDamage ?? 0));
        expect(plain).toHaveLength(3);
        expect(new Set(plain).size).toBe(1);
        // Hit 1 lands before any Shred; hits 2 and 3 strike through one and two stacks.
        expect(hits[0]).toBe(plain[0]);
        expect(hits[1]).toBeGreaterThan(hits[0]);
        expect(hits[2]).toBeGreaterThan(hits[1]);
    });

    it("Stalwart's counter to each hit lands before the next hit", () => {
        const stalwart: BoardUnit = {
            id: 'stalwart',
            kit: stalwartPassive(),
            position: 'M4',
            speed: 1,
            attack: 10,
        };
        const subject = enforcer(0);
        const { events, id } = run(placement, subject, [stalwart]);
        const order = attacks(events).map((e) =>
            e.attackerId === id(stalwart) ? 'counter' : `hit${e.subAttackIndex ?? 0}`
        );
        expect(order).toEqual(['hit0', 'counter', 'hit1', 'counter', 'hit2', 'counter']);
    });

    it('a counter that destroys Enforcer mid-skill stops his remaining hits', () => {
        const stalwart: BoardUnit = {
            id: 'stalwart',
            kit: stalwartPassive(),
            position: 'M4',
            speed: 1,
            attack: 1e6,
        };
        const fragile = enforcer(0, 1000);
        const { events, id } = run(placement, fragile, [stalwart]);
        const e = id(fragile);
        expect(attacks(events).filter((a) => a.attackerId === e)).toHaveLength(1);
        expect(events.some((x) => x.type === 'ship-destroyed' && x.actorId === e)).toBe(true);
        // Control: a counter too weak to kill him lets all three hits through.
        const weak = run(placement, fragile, [{ ...stalwart, attack: 1 }]);
        expect(attacks(weak.events).filter((a) => a.attackerId === weak.id(fragile))).toHaveLength(
            3
        );
    });
});
