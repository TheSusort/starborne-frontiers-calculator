/**
 * A crit needs damage (owner ruling 2026-10-22): a cast that deals no damage — a skill that only
 * inflicts Attack Down — never crits, so it wakes no on-crit reaction.
 *
 * Real reactor: Hermes ("When an ally critically hits an enemy, this Unit adds 1 charge to its own
 * charged skill"), docs/ship-skills.csv through the production parser. His ally has 100% crit and
 * casts either a debuff-only skill or a plain hit. Both sides.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { setupKeyedRng, resetRateGateRng } from '../../calculators/rateAccumulator';
import { boardInput, hitKit, NO_KIT, realKit, type BoardUnit } from '../__testutils__/realKitBoard';
import type { Ability, ShipSkills } from '../../../types/abilities';

beforeEach(() => {
    setupKeyedRng(1022);
});
afterEach(() => {
    resetRateGateRng();
});

const attackDownOnly: ShipSkills = {
    slots: [
        {
            slot: 'active',
            abilities: [
                {
                    id: 'attack-down',
                    type: 'debuff',
                    target: 'enemy',
                    trigger: 'on-cast',
                    conditions: [],
                    config: {
                        type: 'debuff',
                        buffName: 'Attack Down I',
                        application: 'inflict',
                        duration: 2,
                        stacks: 1,
                        isStackable: false,
                        parsedEffects: {},
                    },
                } satisfies Ability,
            ],
        },
    ],
};

interface Seen {
    /** Charge Hermes's reactions gave him in round 1. */
    hermesReactiveCharge: number;
    /** The ally's round-1 cast as the log records it. */
    allyCastCrit: boolean;
    allyDebuffLanded: boolean;
}

const run = (placement: 'player' | 'enemy', allyKit: ShipSkills): Seen => {
    const hermes: BoardUnit = {
        id: 'hermes',
        position: 'M1',
        speed: 10,
        chargeCount: 9,
        kit: realKit('Hermes'),
    };
    const ally: BoardUnit = {
        id: 'ally',
        position: 'M4',
        speed: 100,
        attack: 1000,
        crit: 100,
        critDamage: 50,
        hacking: 1e6,
        kit: allyKit,
    };
    const enemy: BoardUnit = { id: 'target', position: 'M4', speed: 5, kit: NO_KIT };
    const { input, id } = boardInput(placement, hermes, [ally], [enemy], 1);
    const bus = createEventBus();
    const seen: Seen = { hermesReactiveCharge: 0, allyCastCrit: false, allyDebuffLanded: false };
    bus.on('charge-changed', (e: Extract<CombatEvent, { type: 'charge-changed' }>) => {
        if (e.actorId === id(hermes) && e.reason === 'manip')
            seen.hermesReactiveCharge += e.newCharge - e.oldCharge;
    });
    bus.on('ability-performed', (e: Extract<CombatEvent, { type: 'ability-performed' }>) => {
        if (e.actorId === id(ally) && e.didCrit) seen.allyCastCrit = true;
    });
    bus.on('debuff-applied', (e: Extract<CombatEvent, { type: 'debuff-applied' }>) => {
        if (e.sourceId === id(ally)) seen.allyDebuffLanded = true;
    });
    runCombat({ ...input, bus });
    return seen;
};

for (const placement of ['player', 'enemy'] as const) {
    describe(`a damage-free cast never crits (Hermes and his ally on the ${placement} side)`, () => {
        it('control: a 100%-crit hit from his ally gives Hermes his charge', () => {
            const s = run(placement, hitKit());
            expect(s.allyCastCrit).toBe(true);
            expect(s.hermesReactiveCharge).toBe(1);
        });

        it('a 100%-crit Attack Down with no damage is no critical hit: Hermes gains nothing', () => {
            const s = run(placement, attackDownOnly);
            expect(s.allyDebuffLanded).toBe(true);
            expect(s.allyCastCrit).toBe(false);
            expect(s.hermesReactiveCharge).toBe(0);
        });
    });
}
