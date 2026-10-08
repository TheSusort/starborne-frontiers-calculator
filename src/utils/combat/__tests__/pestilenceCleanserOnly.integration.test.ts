/**
 * Pestilence's refit-active passive: "When an enemy cleanses a debuff, this Unit inflicts
 * Corrosion II for 2 turns." The Corrosion lands on the enemy that CLEANSED (R134), and on nobody
 * else: not on a bystander enemy, and not on the ally whose debuff a supporter cleansed.
 *
 * Real Pestilence passive (refit 4). Her side's seeder debuffs the front enemy; the enemy behind it
 * cleanses. Either the debuffed front enemy IS the cleanser (a self-cleanse), or the cleanser
 * stands behind it and cleanses its ally's debuff. Run with Pestilence on both sides.
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
import { textKit } from '../__testutils__/textKit';
import type { ShipSkills } from '../../../types/abilities';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable())
        throw new Error('docs/ship-skills.csv and docs/ship-data.json are required');
});
beforeEach(() => setupKeyedRng(4));

const passiveOnly = (): ShipSkills => ({
    slots: realKit('Pestilence').slots.filter((s) => s.slot === 'passive'),
});

const DEBUFF_TEXT = 'This Unit inflicts <unit-skill>Attack Down II</unit-skill> for 3 turns.';
const CLEANSE_TEXT = 'This Unit <unit-skill>cleanses 1 debuff</unit-skill>.';

/** The enemies Pestilence's Corrosion landed on in round 1. */
const corrodedEnemies = (placement: Placement, debuffedIsCleanser: boolean): string[] => {
    const pestilence: BoardUnit = {
        id: 'pestilence',
        kit: passiveOnly(),
        position: 'M4',
        speed: 100,
        hacking: 1e6,
    };
    const seeder: BoardUnit = {
        id: 'seeder',
        kit: textKit('Seeder', { active: DEBUFF_TEXT }),
        position: 'M3',
        speed: 500,
        hacking: 1e6,
    };
    const cleanser: BoardUnit = {
        id: 'cleanser',
        kit: textKit('Cleanser', { active: CLEANSE_TEXT }),
        position: debuffedIsCleanser ? 'M4' : 'M3',
        speed: 200,
        hp: 1e9,
    };
    const bystander: BoardUnit = {
        id: 'bystander',
        kit: NO_KIT,
        position: debuffedIsCleanser ? 'M3' : 'M4',
        speed: 1,
        hp: 1e9,
    };
    const { input, id } = boardInput(placement, pestilence, [seeder], [cleanser, bystander], 1);
    const names = new Map([
        [id(cleanser), 'cleanser'],
        [id(bystander), 'bystander'],
    ]);
    const bus = createEventBus();
    const hit: string[] = [];
    bus.on('dot-applied', (e: Extract<CombatEvent, { type: 'dot-applied' }>) => {
        const name = names.get(e.targetId);
        if (name && e.sourceId === id(pestilence)) hit.push(name);
    });
    runCombat({ ...input, bus });
    return hit.sort();
};

describe.each<Placement>(['player', 'enemy'])('Pestilence on the %s side', (placement) => {
    it('an enemy that cleanses its own debuff takes the Corrosion, its neighbour does not', () => {
        expect(corrodedEnemies(placement, true)).toEqual(['cleanser']);
    });

    it('an enemy that cleanses an ally takes the Corrosion, not the ally it cleansed', () => {
        expect(corrodedEnemies(placement, false)).toEqual(['cleanser']);
    });
});
