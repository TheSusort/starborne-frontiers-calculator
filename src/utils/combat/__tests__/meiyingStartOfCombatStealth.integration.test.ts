/**
 * Meiying's refit-active passive: "At the start of combat and every turn, this Unit gains Stealth
 * for 2 turns." She is Stealthed from the first moment of round 1, so a faster single-target
 * hitter's round-1 strike goes to her ally, not to her. (Without the start-of-combat half she was
 * hit until her own first turn.)
 *
 * Real parsed kit (refit 4, passive slots only). Meiying stands in front (M4) with a tank behind
 * (M3); a speed-300 hitter strikes the front-most visible target. Run on both sides.
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
beforeEach(() => setupKeyedRng(7));

const passiveOnly = (): ShipSkills => ({
    slots: realKit('Meiying').slots.filter((s) => s.slot === 'passive'),
});

/** Who the hitter struck in each round, in order of the strikes. */
const victimsByRound = (placement: Placement, kit: ShipSkills): Map<number, string[]> => {
    const meiying: BoardUnit = {
        id: 'meiying',
        kit,
        position: 'M4',
        speed: 100,
        hp: 1e9,
    };
    const tank: BoardUnit = { id: 'tank', kit: NO_KIT, position: 'M3', speed: 1, hp: 1e9 };
    const hitter: BoardUnit = {
        id: 'hitter',
        kit: hitKit(100),
        position: 'M4',
        speed: 300,
        attack: 1000,
        hacking: 1e6,
    };
    const { input, id } = boardInput(placement, meiying, [tank], [hitter], 2);
    const names = new Map([
        [id(meiying), 'meiying'],
        [id(tank), 'tank'],
    ]);
    const bus = createEventBus();
    const byRound = new Map<number, string[]>();
    bus.on('attacked', (e: Extract<CombatEvent, { type: 'attacked' }>) => {
        const name = names.get(e.targetId);
        if (name) byRound.set(e.round, [...(byRound.get(e.round) ?? []), name]);
    });
    runCombat({ ...input, bus });
    return byRound;
};

describe.each<Placement>(['player', 'enemy'])('Meiying on the %s side', (placement) => {
    it('is Stealthed from round 1, so the faster hitter strikes her ally first', () => {
        const hits = victimsByRound(placement, passiveOnly());
        expect(hits.get(1)).toEqual(['tank']);
        expect(hits.get(2)).toEqual(['tank']);
    });

    it('control: without the passive the hitter strikes her in round 1', () => {
        const hits = victimsByRound(placement, NO_KIT);
        expect(hits.get(1)).toEqual(['meiying']);
    });
});
