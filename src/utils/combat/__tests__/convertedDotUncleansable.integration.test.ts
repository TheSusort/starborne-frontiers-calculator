/**
 * Owner ruling 2026-10-22: a DoT a ship made out of a hit it took cannot be cleansed — Voron's
 * "When directly damaged, this Unit transforms the damage into a damage over time effect lasting
 * for 3 turns" and Meatshield's "Any damage this Unit takes from Protection is transformed into a
 * Damage over Time effect for 2 turns" alike (`ActiveDoTStack.convertedFromHit`). An applied DoT
 * on the same ship is cleansed as before.
 *
 * Real parsed kits (refit 4): Makoli's active "cleanses 1 debuff, repairs 5% …" is the cleanser;
 * Hemlock's active "deals 130% damage and inflicts Corrosion II for 3 turns" is the applied DoT.
 * Every scenario runs with the converting ship on the player side and mirrored onto the enemy
 * side.
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

const PLACEMENTS: Placement[] = ['player', 'enemy'];

const slotsOf = (ship: string, keep: string[]): ShipSkills => ({
    ...realKit(ship),
    slots: realKit(ship).slots.filter((s) => keep.includes(s.slot)),
});

/** Makoli's active alone: her cleanse, with no passive repair to confound the board. */
const makoli = (): BoardUnit => ({
    id: 'makoli',
    kit: slotsOf('Makoli', ['active']),
    position: 'M2',
    speed: 1,
});

/** One hit at the front ally, before anyone else acts: a plain hit, or Hemlock's active. */
const hitter = (corrosion: boolean): BoardUnit => ({
    id: 'hitter',
    kit: corrosion ? slotsOf('Hemlock', ['active']) : hitKit(100),
    position: 'M4',
    speed: 100,
    attack: 1000,
    hacking: 1e6,
});

const run = (placement: Placement, carrier: BoardUnit, opponent: BoardUnit) => {
    const healer = makoli();
    const { input, id } = boardInput(placement, carrier, [healer], [opponent], 1);
    const bus = createEventBus();
    const events: CombatEvent[] = [];
    const emit = bus.emit;
    bus.emit = (e) => {
        events.push(e);
        emit(e);
    };
    const actors: { id: string; genericDoTEntries: unknown[]; corrosionEntries: unknown[] }[] = [];
    runCombat({ ...input, bus, __testTapActors: (a) => actors.push(...a) });
    const holder = actors.find((a) => a.id === id(carrier))!;
    const cleansed = events
        .filter((e) => e.type === 'cleanse-performed' && e.casterId === id(healer))
        .reduce((n, e) => n + (e.type === 'cleanse-performed' ? e.count : 0), 0);
    return { events, holder, cleansed };
};

describe.each(PLACEMENTS)("Voron's converted hit on the %s side", (placement) => {
    const voron = (): BoardUnit => ({
        id: 'voron',
        kit: slotsOf('Voron', ['passive']),
        position: 'M4',
        speed: 2,
    });

    it("Makoli's cleanse cannot remove the DoT Voron made of the hit", () => {
        const s = run(placement, voron(), hitter(false));
        expect(s.holder.genericDoTEntries).toHaveLength(1);
        expect(s.cleansed).toBe(0);
    });

    it('liveness: the Corrosion that hit inflicted is cleansed, the converted DoT stays', () => {
        const s = run(placement, voron(), hitter(true));
        expect(s.cleansed).toBe(1);
        expect(s.holder.corrosionEntries).toHaveLength(0);
        expect(s.holder.genericDoTEntries).toHaveLength(1);
    });
});

describe.each(PLACEMENTS)("Meatshield's Protection DoT on the %s side", (placement) => {
    // Meatshield (refit 4 passive: 3 Protection stacks at the start of combat, the Protection
    // share transformed into a DoT) stands behind the struck ally, whose hit his Protection takes.
    const meatshield = (): BoardUnit => ({
        id: 'meatshield',
        kit: slotsOf('Meatshield', ['passive']),
        position: 'M3',
        speed: 2,
        hp: 1e6,
    });

    const runMeat = (corrosion: boolean) => {
        const m = meatshield();
        const struck: BoardUnit = { id: 'struck', kit: NO_KIT, position: 'M4', speed: 3 };
        const healer = makoli();
        const { input, id } = boardInput(placement, m, [struck, healer], [hitter(corrosion)], 1);
        const bus = createEventBus();
        const events: CombatEvent[] = [];
        const emit = bus.emit;
        bus.emit = (e) => {
            events.push(e);
            emit(e);
        };
        const actors: { id: string; genericDoTEntries: unknown[] }[] = [];
        runCombat({ ...input, bus, __testTapActors: (a) => actors.push(...a) });
        const cleansedIds = events.flatMap((e) =>
            e.type === 'cleanse-performed' && e.casterId === id(healer) ? (e.targets ?? []) : []
        );
        return { holder: actors.find((a) => a.id === id(m))!, cleansedIds, id, m };
    };

    it("Makoli's cleanse cannot remove the DoT Meatshield made of the Protection share", () => {
        const s = runMeat(false);
        expect(s.holder.genericDoTEntries).toHaveLength(1);
        expect(s.cleansedIds).not.toContain(s.id(s.m));
    });
});
