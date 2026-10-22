/**
 * Stealth hides a ship from being picked as an attack's TARGET, nothing more (owner rulings
 * 2026-10-22):
 *  - an area pattern anchored on a visible enemy still splashes a stealthed neighbour and lands
 *    every effect on it (flowchart ledger row 7.5);
 *  - Curator's "deals 60% damage to all enemies, then inflicts Attack Down III and Crit Power Down
 *    III" reaches a stealthed enemy;
 *  - Amartya's "deals 150% damage, then inflicts Defense Down II and Inc. Repair Down II on all
 *    enemies" reaches a stealthed enemy.
 *
 * Board: the caster at M4 against VISIBLE (M4, front) and GHOST (M3, right behind it). GHOST is
 * the fastest ship and casts Stealth on itself before anyone else acts. Every case runs with the
 * caster on both sides. The LIVENESS arm proves GHOST really is stealthed when the caster acts: a
 * single-target cast aimed at the back-most enemy (GHOST) is turned away onto VISIBLE.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { setupKeyedRng, resetRateGateRng } from '../../calculators/rateAccumulator';
import { parseShipTargeting, parseTarget, type ParsedPattern } from '../../targetingParser';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import {
    boardInput,
    hitKit,
    NO_KIT,
    realKit,
    type BoardUnit,
    type Placement,
} from '../__testutils__/realKitBoard';
import type { Ability, ShipSkills } from '../../../types/abilities';

beforeEach(() => {
    setupKeyedRng(1022);
});
afterEach(() => {
    resetRateGateRng();
});

const stealthSelf: Ability = {
    id: 'stealth-self',
    type: 'buff',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'buff',
        buffName: 'Stealth',
        parsedEffects: {},
        stacks: 1,
        isStackable: false,
        duration: 99,
    },
};
const ghostKit = (stealthy: boolean): ShipSkills => ({
    slots: [{ slot: 'active', abilities: stealthy ? [stealthSelf] : [] }],
});

const LINE_RANGE_1: ParsedPattern = {
    raw: 'line-range-1',
    shape: 'line',
    range: 1,
    modifiers: {},
};

const realTargeting = (ship: string): Pick<BoardUnit, 'target' | 'pattern'> => {
    const built = buildTraceShip(ship);
    if (!built) throw new Error(`${ship} missing from reference data`);
    const { active } = parseShipTargeting(built);
    if (!active) throw new Error(`${ship} has no parsed active targeting`);
    return { target: active.target, pattern: active.pattern };
};

interface Seen {
    ghostStealthed: boolean;
    /** Damage each opponent took in round 1. */
    taken: Record<string, number>;
    /** Debuff names the caster landed on each opponent in round 1. */
    debuffs: Record<string, string[]>;
}

const run = (
    placement: Placement,
    caster: Omit<BoardUnit, 'id' | 'position' | 'speed'>,
    stealthy = true
): Seen => {
    const carrier: BoardUnit = {
        id: 'caster',
        position: 'M4',
        speed: 100,
        attack: 10_000,
        hacking: 1e6,
        // Far from full, so both sides cast the ACTIVE skill (a 0-charge charged kit fires its
        // charged skill every turn on the player side).
        chargeCount: 9,
        ...caster,
    };
    const visible: BoardUnit = { id: 'visible', position: 'M4', speed: 5, kit: NO_KIT };
    const ghost: BoardUnit = { id: 'ghost', position: 'M3', speed: 300, kit: ghostKit(stealthy) };
    const { input, id } = boardInput(placement, carrier, [], [visible, ghost], 1);
    const casterId = id(carrier);
    const bus = createEventBus();
    const seen: Seen = { ghostStealthed: false, taken: {}, debuffs: {} };
    bus.on('buff-applied', (e: Extract<CombatEvent, { type: 'buff-applied' }>) => {
        if (e.actorId === id(ghost) && e.buffName === 'Stealth') seen.ghostStealthed = true;
    });
    bus.on('debuff-applied', (e: Extract<CombatEvent, { type: 'debuff-applied' }>) => {
        if (e.sourceId === casterId) (seen.debuffs[e.targetId] ??= []).push(e.buffName);
    });
    const result = runCombat({ ...input, bus });
    const r1 = result.rounds.find((r) => r.round === 1)!;
    for (const u of [visible, ghost]) seen.taken[u.id] = r1.perTargetDamage?.[id(u)] ?? 0;
    return seen;
};

for (const placement of ['player', 'enemy'] as const) {
    describe(`Stealth does not shield a ship from area effects (caster on the ${placement} side)`, () => {
        it('LIVENESS: a single-target cast aimed at the stealthed back ship hits the visible one', () => {
            const aimedAtGhost = { kit: hitKit(), target: parseTarget('back') };
            const stealthed = run(placement, aimedAtGhost);
            expect(stealthed.ghostStealthed).toBe(true);
            expect(stealthed.taken.ghost).toBe(0);
            expect(stealthed.taken.visible).toBeGreaterThan(0);
            // Control: without Stealth the same cast hits GHOST.
            const open = run(placement, aimedAtGhost, false);
            expect(open.taken.ghost).toBeGreaterThan(0);
            expect(open.taken.visible).toBe(0);
        });

        it('row 7.5: an area pattern anchored on the visible ship splashes the stealthed one', () => {
            const s = run(placement, { kit: hitKit(), pattern: LINE_RANGE_1 });
            expect(s.ghostStealthed).toBe(true);
            expect(s.taken.visible).toBeGreaterThan(0);
            expect(s.taken.ghost).toBeGreaterThan(0);
        });

        it("Curator's all-enemies hit and debuffs reach the stealthed ship", () => {
            const s = run(placement, { kit: realKit('Curator'), ...realTargeting('Curator') });
            expect(s.ghostStealthed).toBe(true);
            expect(s.taken.ghost).toBeGreaterThan(0);
            expect(s.debuffs.ghost ?? []).toEqual(
                expect.arrayContaining(['Attack Down III', 'Crit Power Down III'])
            );
        });

        it("Amartya's all-enemies debuffs reach the stealthed ship (her hit lands on the visible one)", () => {
            const s = run(placement, { kit: realKit('Amartya'), ...realTargeting('Amartya') });
            expect(s.ghostStealthed).toBe(true);
            expect(s.taken.visible).toBeGreaterThan(0);
            expect(s.taken.ghost).toBe(0);
            expect(s.debuffs.ghost ?? []).toEqual(
                expect.arrayContaining(['Defense Down II', 'Inc. Repair Down II'])
            );
        });
    });
}
