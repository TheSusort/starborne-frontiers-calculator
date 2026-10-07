/**
 * Crocus's passive (refit 2+): "When another ally inflicts a damage over time effect with a
 * critical hit, this Unit repairs itself for 3% of its max HP and inflicts Corrosion II for 2
 * turns on that enemy." Owner ruling: a Bomb is not a damage-over-time effect (it deals
 * detonation damage), so an ally's critical Bomb never fires this passive; a critical Corrosion
 * or Inferno does.
 *
 * Board: Crocus (passive only, never casts) and one seeder ally that crits every cast and lands
 * one stack of the chosen DoT on the front enemy A. Crocus's reactions are read off his
 * `reactive-heal-performed` events and his own `dot-applied` landings.
 *
 * Run with Crocus on the player side and on the enemy side.
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
import type { DoTType } from '../../../types/calculator';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable())
        throw new Error('docs/ship-skills.csv and docs/ship-data.json are required');
});
beforeEach(() => setupKeyedRng(43));

/** The seeder's active: one stack of `dotType` for 2 turns on its target. */
const seederKit = (dotType: DoTType): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                {
                    id: 'seed-hit',
                    type: 'damage',
                    target: 'enemy',
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'damage', multiplier: 100 },
                },
                {
                    id: 'seed-dot',
                    type: 'dot',
                    target: 'enemy',
                    trigger: 'on-cast',
                    conditions: [],
                    config: {
                        type: 'dot',
                        dotType,
                        tier: dotType === 'bomb' ? 100 : 3,
                        stacks: 1,
                        duration: 2,
                    },
                },
            ],
        },
    ],
});

/** Crocus's real passive with an empty active, so he never casts. */
const crocusPassiveOnly = (): ShipSkills => {
    const kit = realKit('Crocus');
    return {
        ...kit,
        slots: [
            { slot: 'active', abilities: [] },
            ...kit.slots.filter((s) => s.slot === 'passive'),
        ],
    };
};

const run = (
    placement: Placement,
    dotType: DoTType,
    seederCrit = 100
): { repairs: number; corrosionsOnA: number; seederLandings: number } => {
    const crocus: BoardUnit = {
        id: 'crocus',
        kit: crocusPassiveOnly(),
        position: 'M3',
        speed: 10,
        attack: 1000,
        hacking: 1e6,
        hp: 100_000,
        chargeCount: 99,
    };
    const seeder: BoardUnit = {
        id: 'seeder',
        kit: seederKit(dotType),
        position: 'M4',
        speed: 300,
        attack: 1000,
        hacking: 1e6,
        crit: seederCrit,
        critDamage: 100,
    };
    const a: BoardUnit = { id: 'a', kit: NO_KIT, position: 'M4', speed: 1 };
    const { input, id } = boardInput(placement, crocus, [seeder], [a], 1);
    const bus = createEventBus();
    let repairs = 0;
    let corrosionsOnA = 0;
    let seederLandings = 0;
    bus.on(
        'reactive-heal-performed',
        (e: Extract<CombatEvent, { type: 'reactive-heal-performed' }>) => {
            if (e.casterId === id(crocus)) repairs++;
        }
    );
    bus.on('dot-applied', (e: Extract<CombatEvent, { type: 'dot-applied' }>) => {
        if (e.targetId !== id(a)) return;
        if (e.sourceId === id(crocus) && e.dotType === 'corrosion') corrosionsOnA++;
        if (e.sourceId === id(seeder) && e.dotType === dotType && e.viaCrit) seederLandings++;
    });
    runCombat({ ...input, bus });
    return { repairs, corrosionsOnA, seederLandings };
};

describe.each<Placement>(['player', 'enemy'])('Crocus on the %s side', (placement) => {
    it("an ally's critical Corrosion fires the repair and Corrosion II on that enemy", () => {
        const r = run(placement, 'corrosion');
        expect(r.seederLandings).toBe(1);
        expect(r.repairs).toBe(1);
        expect(r.corrosionsOnA).toBe(1);
    });

    it("an ally's critical Inferno fires it too", () => {
        const r = run(placement, 'inferno');
        expect(r.seederLandings).toBe(1);
        expect(r.repairs).toBe(1);
        expect(r.corrosionsOnA).toBe(1);
    });

    it("an ally's critical Bomb is not a damage-over-time effect: no repair, no Corrosion", () => {
        const r = run(placement, 'bomb');
        // The Bomb landed with a crit, so only the Bomb-is-not-a-DoT rule keeps Crocus quiet.
        expect(r.seederLandings).toBe(1);
        expect(r.repairs).toBe(0);
        expect(r.corrosionsOnA).toBe(0);
    });

    it("an ally's non-critical Corrosion does not fire it", () => {
        const r = run(placement, 'corrosion', 0);
        expect(r.repairs).toBe(0);
        expect(r.corrosionsOnA).toBe(0);
    });
});
