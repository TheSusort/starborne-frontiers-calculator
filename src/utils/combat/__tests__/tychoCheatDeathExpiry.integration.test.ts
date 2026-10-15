/**
 * Tycho's start-of-combat Cheat Death carries the turn counter its text states ("for 9 turns" at
 * refit 4) and expires like any timed buff; a Cheat Death with no stated window (Yazid's, Hermes',
 * Hayyan's) lasts until a lethal hit consumes it.
 *
 * Board: a lone heavy hitter whose charged skill (the only damaging one) fires on a chosen round,
 * against one fragile carrier. The carrier survives the lethal charged hit only while its Cheat
 * Death is still up.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus, type CombatEvent } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { boardInput, realKit, type BoardUnit, type Placement } from '../__testutils__/realKitBoard';
import { textKit } from '../__testutils__/textKit';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable())
        throw new Error('docs/ship-skills.csv and docs/ship-data.json are required');
});
beforeEach(() => setupKeyedRng(1));

const NUKE_TEXT = 'This Unit deals <unit-damage>100000% damage</unit-damage>.';

/** Rounds in which the carrier's Cheat Death activated, for a hitter whose charged nuke lands once
 *  it has `charges` charges. */
const cheatDeathRounds = (placement: Placement, ship: string, charges: number): number[] => {
    const carrier: BoardUnit = {
        id: 'carrier',
        kit: realKit(ship),
        position: 'M4',
        speed: 1,
        hp: 1000,
    };
    const hitter: BoardUnit = {
        id: 'hitter',
        kit: textKit('Hitter', { charged: NUKE_TEXT, chargeCount: charges }),
        position: 'M4',
        speed: 300,
        attack: 1000,
        chargeCount: charges,
    };
    const { input, id } = boardInput(placement, carrier, [], [hitter], 12);
    const bus = createEventBus();
    const rounds: number[] = [];
    bus.on(
        'cheat-death-activated',
        (e: Extract<CombatEvent, { type: 'cheat-death-activated' }>) => {
            if (e.actorId === id(carrier)) rounds.push(e.round);
        }
    );
    runCombat({ ...input, bus });
    return rounds;
};

describe.each<Placement>(['player', 'enemy'])('Cheat Death expiry, carrier on %s', (placement) => {
    // `charges` = the hitter's charge count, so its nuke lands in round `charges + 1`.
    it("Tycho's Cheat Death is up through its 9th turn and gone after", () => {
        expect(cheatDeathRounds(placement, 'Tycho', 8)).toEqual([9]);
        expect(cheatDeathRounds(placement, 'Tycho', 9)).toEqual([]);
    });

    it('a Cheat Death with no stated window never expires on its own', () => {
        expect(cheatDeathRounds(placement, 'Yazid', 11)).toEqual([12]);
    });
});
