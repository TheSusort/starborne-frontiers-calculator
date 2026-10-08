/**
 * A standing "+N% defense" passive reduces the damage its carrier TAKES, not only what it deals:
 *  - Grif's refit-active passive: "This Unit increases its defense by 20%."
 *  - Hermes's refit-active passive: "This Unit's defense is increased by 20% and ..."
 *
 * Real parsed kits (refit 4, passive slots only). A hitter strikes the carrier once; the damage it
 * TAKES must equal what a plain dummy with 1.2x the carrier's defence takes, and be less than a
 * dummy at the carrier's printed defence. Run with the carrier on both sides.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus, type CombatEvent } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import {
    boardInput,
    hitKit,
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
beforeEach(() => setupKeyedRng(3));

const DEFENCE = 2_321;

const passiveOnly = (ship: string): ShipSkills => ({
    slots: realKit(ship).slots.filter((s) => s.slot === 'passive'),
});

/** What the carrier takes from one 100% hit by a 6,000-attack hitter that never crits. */
const takenFromOneHit = (placement: Placement, kit: ShipSkills, defence: number): number => {
    const carrier: BoardUnit = {
        id: 'carrier',
        kit,
        position: 'M4',
        speed: 1,
        defence,
        hp: 1e9,
    };
    const hitter: BoardUnit = {
        id: 'hitter',
        kit: hitKit(100),
        position: 'M4',
        speed: 300,
        attack: 6_000,
        hacking: 1e6,
    };
    const { input, id } = boardInput(placement, carrier, [], [hitter], 1);
    const bus = createEventBus();
    let taken = 0;
    bus.on('attacked', (e: Extract<CombatEvent, { type: 'attacked' }>) => {
        if (e.targetId === id(carrier)) taken += e.takenDamage ?? e.damage ?? 0;
    });
    runCombat({ ...input, bus });
    return taken;
};

describe.each<Placement>(['player', 'enemy'])(
    'standing +20% defence on the %s side',
    (placement) => {
        it.each(['Grif', 'Hermes'])('%s takes what a dummy at 1.2x his defence takes', (ship) => {
            const printed = takenFromOneHit(placement, NO_KIT, DEFENCE);
            const raised = takenFromOneHit(placement, NO_KIT, DEFENCE * 1.2);
            const carrier = takenFromOneHit(placement, passiveOnly(ship), DEFENCE);
            // The control arms differ, so the equality below is not vacuous.
            expect(raised).toBeLessThan(printed);
            expect(carrier).toBeCloseTo(raised, 6);
        });
    }
);
