/**
 * Nosorog reflects a counter-attack (owner ruling R36 follow-up, 2026-10-05: every hit is direct,
 * and Nosorog reacts to counters and passive hits).
 *
 * Nosorog's passive: "This Unit reflects 40% of the damage taken back to the enemy when directly
 * damaged as a primary target." Stalwart's passive: "When this Unit is directly damaged as a
 * primary target, it deals 30% damage to the enemy …".
 *
 * Board: Nosorog (real active + passives) attacks a passive-only Stalwart, which has no active of
 * its own. The only damage Nosorog takes is Stalwart's counter, so any thorns Stalwart receives are
 * Nosorog reflecting that counter. Run with Nosorog on the player side and on the enemy side.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { boardInput, realKit, type BoardUnit, type Placement } from '../__testutils__/realKitBoard';
import type { ShipSkills } from '../../../types/abilities';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable())
        throw new Error('docs/ship-skills.csv and docs/ship-data.json are required');
});
beforeEach(() => setupKeyedRng(36));

const slots = (ship: string, keep: (slot: string) => boolean): ShipSkills => ({
    slots: realKit(ship).slots.filter((s) => keep(s.slot)),
});

const reflectedOntoStalwart = (placement: Placement, withReflect: boolean): number => {
    const nosorog: BoardUnit = {
        id: 'nosorog',
        kit: slots('Nosorog', (s) => s === 'active' || (withReflect && s === 'passive')),
        position: 'M4',
        speed: 300,
        attack: 10_000,
    };
    const stalwart: BoardUnit = {
        id: 'stalwart',
        kit: slots('Stalwart', (s) => s === 'passive'),
        position: 'M4',
        speed: 1,
        attack: 10_000,
    };
    const { input, id } = boardInput(placement, nosorog, [], [stalwart], 3);
    const { rounds } = runCombat(input);
    return rounds.reduce((sum, r) => sum + (r.perActorReflected?.[id(stalwart)] ?? 0), 0);
};

describe.each<Placement>(['player', 'enemy'])('Nosorog on the %s side', (placement) => {
    it("Stalwart's counter strikes Nosorog, and Nosorog reflects it back", () => {
        expect(reflectedOntoStalwart(placement, true)).toBeGreaterThan(0);
    });

    it('negative: without his reflect passive nothing comes back', () => {
        expect(reflectedOntoStalwart(placement, false)).toBe(0);
    });
});
