/**
 * Wildfire's refit-active passive: "When an enemy has Scorching Radiation, all allies deal 2%
 * additional Inferno damage to that Unit for every 10% crit power this Unit has." The bonus is
 * INFERNO only: a Corrosion tick on the Scorching Radiation enemy is untouched, an Inferno tick is
 * raised.
 *
 * Board: real Wildfire (refit 4, starts charged, so her charged lands Scorching Radiation in round
 * 1) beside two ally appliers (one Corrosion I, one Inferno I) against one durable body. The arm
 * with Wildfire's passive slots removed is the baseline. Run with Wildfire on both sides.
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
beforeEach(() => setupKeyedRng(1));

const CORROSION_TEXT = 'This Unit inflicts <unit-skill>Corrosion I</unit-skill> for 3 turns.';
const INFERNO_TEXT = 'This Unit inflicts <unit-skill>Inferno I</unit-skill> for 3 turns.';

const wildfireKit = (withPassive: boolean): ShipSkills => ({
    slots: realKit('Wildfire').slots.filter((s) => withPassive || s.slot !== 'passive'),
});

/** Total DoT tick damage on the body per DoT type over four rounds. */
const ticksByType = (placement: Placement, withPassive: boolean): Record<string, number> => {
    const wildfire: BoardUnit = {
        id: 'wildfire',
        kit: wildfireKit(withPassive),
        position: 'M4',
        speed: 300,
        attack: 1000,
        critDamage: 150,
        hacking: 1e6,
        chargeCount: 1,
        startCharged: true,
    };
    const corroder: BoardUnit = {
        id: 'corroder',
        kit: textKit('Corroder', { active: CORROSION_TEXT }),
        position: 'M3',
        speed: 200,
        attack: 1000,
        hacking: 1e6,
    };
    const burner: BoardUnit = {
        id: 'burner',
        kit: textKit('Burner', { active: INFERNO_TEXT }),
        position: 'M2',
        speed: 190,
        attack: 1000,
        hacking: 1e6,
    };
    const body: BoardUnit = { id: 'body', kit: NO_KIT, position: 'M4', speed: 1, hp: 5e9 };
    const { input, id } = boardInput(placement, wildfire, [corroder, burner], [body], 4);
    const bus = createEventBus();
    const totals: Record<string, number> = {};
    bus.on('dot-ticked', (e: Extract<CombatEvent, { type: 'dot-ticked' }>) => {
        if (e.targetId === id(body)) totals[e.dotType] = (totals[e.dotType] ?? 0) + e.damage;
    });
    runCombat({ ...input, bus });
    return totals;
};

describe.each<Placement>(['player', 'enemy'])('Wildfire on the %s side', (placement) => {
    it('Scorching Radiation raises Inferno ticks and leaves Corrosion ticks alone', () => {
        const withPassive = ticksByType(placement, true);
        const baseline = ticksByType(placement, false);
        // Both DoT families ticked in both arms, so the comparisons below are not vacuous.
        expect(baseline.inferno).toBeGreaterThan(0);
        expect(baseline.corrosion).toBeGreaterThan(0);
        expect(withPassive.inferno).toBeGreaterThan(baseline.inferno);
        expect(withPassive.corrosion).toBeCloseTo(baseline.corrosion, 6);
    });
});
