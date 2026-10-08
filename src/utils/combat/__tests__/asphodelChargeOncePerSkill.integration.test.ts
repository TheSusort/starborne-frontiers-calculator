/**
 * Asphodel's passive: "This Unit adds 1 charge to its charged skill after critically damaging an
 * enemy." (R128) The charge is earned ONCE per skill that crits, however many enemies the skill
 * crits, and on her normal AND charged skills alike. On the charged skill the cadence reset comes
 * first, then the +1 (so a charged cast that crits leaves her at 1 charge).
 *
 * Real parsed kit (refit 4: her attacks always crit). Charged skill costs 2 charges. Board: a
 * circle pattern striking three enemies. The control swaps in her passive text on a plain kit
 * that never crits. Run with Asphodel on both sides.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus, type CombatEvent } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { parsePattern } from '../../targetingParser';
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
beforeEach(() => setupKeyedRng(6));

interface Trace {
    /** The slot Asphodel fired in each round. */
    slots: string[];
    /** Her charge-changed events per round, as `reason:old->new`. */
    charges: string[][];
}

const trace = (
    placement: Placement,
    rounds: number,
    kit: ShipSkills,
    crit: number,
    chargeCount = 2
): Trace => {
    const asphodel: BoardUnit = {
        id: 'asphodel',
        kit,
        position: 'M4',
        speed: 300,
        attack: 1000,
        crit,
        critDamage: 50,
        hacking: 1e6,
        chargeCount,
        pattern: parsePattern('Pattern-Circle-Range-1'),
    };
    const enemies: BoardUnit[] = [
        { id: 'e-a', kit: NO_KIT, position: 'M4', speed: 1, hp: 1e10 },
        { id: 'e-b', kit: NO_KIT, position: 'M3', speed: 1, hp: 1e10 },
        { id: 'e-c', kit: NO_KIT, position: 'T4', speed: 1, hp: 1e10 },
    ];
    const { input, id } = boardInput(placement, asphodel, [], enemies, rounds);
    const me = id(asphodel);
    const bus = createEventBus();
    const out: Trace = { slots: [], charges: [] };
    bus.on('turn-started', (e: Extract<CombatEvent, { type: 'turn-started' }>) => {
        if (e.actorId === me) out.charges.push([]);
    });
    bus.on('skill-fired', (e: Extract<CombatEvent, { type: 'skill-fired' }>) => {
        if (e.actorId === me) out.slots.push(e.slot);
    });
    bus.on('charge-changed', (e: Extract<CombatEvent, { type: 'charge-changed' }>) => {
        if (e.actorId !== me || out.charges.length === 0) return;
        out.charges[out.charges.length - 1].push(`${e.reason}:${e.oldCharge}->${e.newCharge}`);
    });
    runCombat({ ...input, bus });
    return out;
};

const CHARGE_ON_CRIT =
    'This Unit <unit-skill>adds 1 charge</unit-skill> to its charged skill after critically damaging an enemy.';
/** The same passive on a kit that never crits (crit rate 0, no "always crits" clause). */
const neverCritsKit = (): ShipSkills =>
    textKit('PlainAsphodel', {
        active: 'This Unit deals <unit-damage>100% damage</unit-damage>.',
        charged: 'This Unit deals <unit-damage>200% damage</unit-damage>.',
        chargeCount: 2,
        passives: [CHARGE_ON_CRIT],
    });

describe.each<Placement>(['player', 'enemy'])('Asphodel on the %s side', (placement) => {
    it('an AoE active that crits all three enemies adds ONE charge, not three', () => {
        // A deep charge pool, so a per-enemy gain would show instead of hitting the cap.
        const t = trace(placement, 1, realKit('Asphodel'), 100, 6);
        expect(t.slots).toEqual(['active']);
        // cadence +1 ('gen'), then exactly one crit gain ('manip') of +1.
        expect(t.charges[0]).toEqual(['gen:0->1', 'manip:1->2']);
    });

    it('her charged skill resets first, then earns +1 for critting', () => {
        const t = trace(placement, 2, realKit('Asphodel'), 100);
        expect(t.slots).toEqual(['active', 'charged']);
        expect(t.charges[1]).toEqual(['cast-reset:2->0', 'manip:0->1']);
    });

    it('control: a charged skill that does not crit earns nothing', () => {
        const t = trace(placement, 2, neverCritsKit(), 0);
        // Round 1 earns nothing either, so the charged skill is reached by the cadence alone.
        expect(t.slots).toEqual(['active', 'active']);
        const t3 = trace(placement, 3, neverCritsKit(), 0);
        expect(t3.slots).toEqual(['active', 'active', 'charged']);
        expect(t3.charges[2]).toEqual(['cast-reset:2->0']);
    });
});
