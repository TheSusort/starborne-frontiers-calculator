/**
 * A reactive purge at an affinity disadvantage removes nothing (a purge lands like an 'apply'
 * debuff). When its target held a buff it could have taken, the attempt is recorded by the
 * log-only `purge-blocked-log`, a `purge` row of 0 — so the interaction oracle sees the attempt
 * in both arms of a comparison.
 *
 * Real parsed kits (refit 4): Rhodium's passive "At the end of the round, this Unit purges 2
 * buffs from the enemy with the most buffs"; the target runs Meatshield's active alone ("gains
 * Inc. Repair Up III for 2 turns"). Rhodium is thermal; an electric target has the advantage over
 * her. Every scenario runs with Rhodium on the player side and mirrored onto the enemy side.
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
import type { AffinityName } from '../../../types/ship';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable())
        throw new Error('docs/ship-skills.csv and docs/ship-data.json are required');
});
beforeEach(() => setupKeyedRng(7));

const PLACEMENTS: Placement[] = ['player', 'enemy'];

const rhodium = (): BoardUnit => ({
    id: 'rhodium',
    kit: { slots: realKit('Rhodium').slots.filter((s) => s.slot === 'passive') },
    position: 'M4',
    speed: 1,
    affinity: 'thermal',
});

const target = (affinity: AffinityName, buffed: boolean): BoardUnit => ({
    id: 'target',
    kit: buffed
        ? { slots: realKit('Meatshield').slots.filter((s) => s.slot === 'active') }
        : NO_KIT,
    position: 'M4',
    speed: 2,
    affinity,
});

const run = (
    placement: Placement,
    t: BoardUnit,
    /** Withholds `purge-blocked-log` from every listener. */
    swallowBlocked = false
) => {
    const r = rhodium();
    const { input, id } = boardInput(placement, r, [], [t], 2);
    const bus = createEventBus();
    const events: CombatEvent[] = [];
    const emit = bus.emit;
    bus.emit = (e) => {
        events.push(e);
        if (swallowBlocked && e.type === 'purge-blocked-log') return;
        emit(e);
    };
    const result = runCombat({ ...input, bus });
    const blocked = events.filter(
        (e) => e.type === 'purge-blocked-log' && e.casterId === id(r) && e.targetId === id(t)
    );
    const purged = events.filter(
        (e) => e.type === 'purge-performed' && e.casterId === id(r) && e.targetId === id(t)
    );
    return { result, blocked, purged };
};

describe.each(PLACEMENTS)("Rhodium's end-of-round purge on the %s side", (placement) => {
    it('at a disadvantage against a buffed enemy: nothing purged, one attempt row per round', () => {
        const s = run(placement, target('electric', true));
        expect(s.purged).toEqual([]);
        expect(s.blocked).toHaveLength(2);
        expect(s.blocked[0]).toMatchObject({ reason: 'affinity', round: 1 });
    });

    it('control: at neutral affinity the same purge removes the buff, with no attempt row', () => {
        const s = run(placement, target('antimatter', true));
        expect(s.purged.length).toBeGreaterThan(0);
        expect(s.blocked).toEqual([]);
    });

    it('negative: an enemy holding only unremovable buffs gets no attempt row', () => {
        // Meatshield's passive alone: 3 stacks of Protection at the start of combat, which make
        // him the enemy with the most buffs, and which no purge can remove.
        const protectedOnly: BoardUnit = {
            id: 'target',
            kit: { slots: realKit('Meatshield').slots.filter((s) => s.slot === 'passive') },
            position: 'M4',
            speed: 2,
            affinity: 'electric',
        };
        const s = run(placement, protectedOnly);
        expect(s.purged).toEqual([]);
        expect(s.blocked).toEqual([]);
    });

    it('the attempt row is log-only: withholding it from every listener changes nothing', () => {
        const shown = run(placement, target('electric', true));
        const withheld = run(placement, target('electric', true), true);
        expect(shown.blocked).toHaveLength(2);
        expect(JSON.stringify(withheld.result.rounds)).toBe(JSON.stringify(shown.result.rounds));
    });
});
