/**
 * Meatshield's active: "This Unit gains Inc. Repair Up III for 2 turns. If this Unit has been
 * directly damaged this round, it repairs 5% of its max HP." The repair needs a direct hit on him
 * earlier in the SAME round. A Protection share he takes for an ally is not direct damage to him
 * (R139), and a hit that lands in a previous round does not count.
 *
 * Real parsed kit (refit 0) with his real self-targeting. He starts tapped to 50% HP. A faster
 * hitter strikes either him or the ally in front of him (whose damage Meatshield's Protection
 * redirects to him). Run with Meatshield on both sides.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus, type CombatEvent } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { parseShipTargeting } from '../../targetingParser';
import {
    boardInput,
    hitKit,
    NO_KIT,
    type BoardUnit,
    type Placement,
} from '../__testutils__/realKitBoard';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable())
        throw new Error('docs/ship-skills.csv and docs/ship-data.json are required');
});
beforeEach(() => setupKeyedRng(2));

const MAX_HP = 1_000_000;

const meatshield = (): BoardUnit => {
    const ship = buildTraceShip('Meatshield', { refitLevel: 0 });
    if (!ship) throw new Error('Meatshield missing from reference data');
    const { active } = parseShipTargeting(ship);
    if (!active) throw new Error('Meatshield has no parsed active targeting');
    return {
        id: 'meatshield',
        kit: buildShipAbilities(ship),
        position: 'M3',
        speed: 100,
        hp: MAX_HP,
        defence: 1_000,
        chargeCount: 3,
        target: active.target,
        pattern: active.pattern,
    };
};

type Strike = 'none' | 'meatshield' | 'ally-behind-protection';

/** Meatshield's round-1 self-repairs as raw amounts, and whether he took any damage at all. */
const round1 = (
    placement: Placement,
    strike: Strike
): { repairs: number[]; tookDamage: boolean } => {
    const tank = meatshield();
    const ally: BoardUnit = { id: 'ally', kit: NO_KIT, position: 'M4', speed: 1, hp: 1e9 };
    const hitter: BoardUnit = {
        id: 'hitter',
        kit: strike === 'none' ? NO_KIT : hitKit(100),
        position: 'M4',
        speed: 300,
        attack: 5_000,
        hacking: 1e6,
    };
    // The hitter strikes the front-most unit: without the ally that is Meatshield himself.
    const allies = strike === 'meatshield' ? [] : [ally];
    const { input, id } = boardInput(placement, tank, allies, [hitter], 1);
    const tankId = id(tank);
    const bus = createEventBus();
    const repairs: number[] = [];
    let tookDamage = false;
    bus.on('hp-changed', (e: Extract<CombatEvent, { type: 'hp-changed' }>) => {
        if (e.targetId === tankId && e.newPct < e.oldPct) tookDamage = true;
    });
    bus.on('heal-performed', (e: Extract<CombatEvent, { type: 'heal-performed' }>) => {
        if (e.casterId !== tankId) return;
        const own = e.perTarget?.find((t) => t.targetId === tankId);
        if (own && own.amount > 0) repairs.push(own.amount);
    });
    runCombat({
        ...input,
        bus,
        __testTapActors: (actors) => {
            const t = actors.find((a) => a.id === tankId);
            if (t) t.currentHp = MAX_HP / 2;
        },
    });
    return { repairs, tookDamage };
};

const selfRepairs = (placement: Placement, strike: Strike): number[] =>
    round1(placement, strike).repairs;

describe.each<Placement>(['player', 'enemy'])('Meatshield on the %s side', (placement) => {
    it('repairs 5% after a direct hit on him earlier in the round', () => {
        const repairs = selfRepairs(placement, 'meatshield');
        expect(repairs.length).toBeGreaterThan(0);
        // 5% of max HP, scaled only by his own repair modifiers (Inc. Repair Up III).
        expect(Math.max(...repairs)).toBeGreaterThanOrEqual(MAX_HP * 0.05);
    });

    it('control: does not repair when nothing hit him', () => {
        expect(selfRepairs(placement, 'none')).toEqual([]);
    });

    it('does not repair for a Protection share taken for an ally (not direct damage to him)', () => {
        const { repairs, tookDamage } = round1(placement, 'ally-behind-protection');
        // He did take the redirected share, so the empty repair list is not an untouched board.
        expect(tookDamage).toBe(true);
        expect(repairs).toEqual([]);
    });
});
