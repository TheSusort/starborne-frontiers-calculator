/**
 * Asphyxiator's passive: "At the start of the round, if there are any enemies with 3 or more
 * debuffs, this Unit gains 1 stack of Overload and gains Marauder Rage II for 3 turns." The gate
 * reads the live debuff count (named debuffs, DoT stacks and Echoing Burst alike, R88/R109) of the
 * most-debuffed living enemy, so the grant lands from the round AFTER the third debuff arrives.
 *
 * Board: Asphyxiator (her active swapped for a 1% hit so only the passive matters) beside a fast
 * seeder, against one durable victim. Run with Asphyxiator on both sides.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus, type CombatEvent } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { boardInput, hitKit, NO_KIT, realKit, type Placement } from '../__testutils__/realKitBoard';
import { textKit } from '../__testutils__/textKit';
import type { ShipSkills } from '../../../types/abilities';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable())
        throw new Error('docs/ship-skills.csv and docs/ship-data.json are required');
});
beforeEach(() => setupKeyedRng(7));

const passiveOnly = (): ShipSkills => ({
    slots: [
        ...hitKit(1).slots,
        ...realKit('Asphyxiator').slots.filter((s) => s.slot === 'passive'),
    ],
});

const SEEDER_TEXT =
    'This Unit inflicts <unit-skill>Attack Down II</unit-skill>, <unit-skill>Crit Power Down II</unit-skill> and <unit-skill>Out. Damage Down II</unit-skill> for 3 turns.';
const TWO_DEBUFF_TEXT =
    'This Unit inflicts <unit-skill>Attack Down II</unit-skill> and <unit-skill>Crit Power Down II</unit-skill> for 3 turns.';
const TWO_NAMED_PLUS_DOT_TEXT =
    'This Unit inflicts <unit-skill>Attack Down II</unit-skill> and <unit-skill>Crit Power Down II</unit-skill> for 3 turns and inflicts <unit-skill>Corrosion I</unit-skill> for 3 turns.';

/** The rounds in which Asphyxiator gained Marauder Rage II. */
const rageGrants = (placement: Placement, seederText: string, numRounds: number): number[] => {
    const asphyxiator = {
        id: 'asphyxiator',
        kit: passiveOnly(),
        position: 'M4' as const,
        speed: 100,
        attack: 1000,
        hacking: 1e6,
    };
    const seeder = {
        id: 'seeder',
        kit: textKit('Seeder', { active: seederText }),
        position: 'M3' as const,
        speed: 300,
        hacking: 1e6,
    };
    const victim = { id: 'victim', kit: NO_KIT, position: 'M4' as const, speed: 1, hp: 1e9 };
    const { input, id } = boardInput(placement, asphyxiator, [seeder], [victim], numRounds);
    const bus = createEventBus();
    const grants: number[] = [];
    bus.on('buff-applied', (e: Extract<CombatEvent, { type: 'buff-applied' }>) => {
        if (e.actorId === id(asphyxiator) && e.buffName === 'Marauder Rage II')
            grants.push(e.round);
    });
    runCombat({ ...input, bus });
    return grants;
};

describe.each<Placement>(['player', 'enemy'])('Asphyxiator on the %s side', (placement) => {
    it('gains Marauder Rage II at each round start once an enemy holds 3 debuffs', () => {
        expect(rageGrants(placement, SEEDER_TEXT, 3)).toEqual([2, 3]);
    });

    it('a DoT stack is a debuff: two named debuffs plus Corrosion open the gate', () => {
        expect(rageGrants(placement, TWO_NAMED_PLUS_DOT_TEXT, 3)).toEqual([2, 3]);
    });

    it('control: two debuffs never open the gate', () => {
        expect(rageGrants(placement, TWO_DEBUFF_TEXT, 3)).toEqual([]);
    });
});
