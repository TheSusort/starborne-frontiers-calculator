/**
 * Isha/Nayra's round-start Affinity Overrides have NO end (owner ruling R51, 2026-10-05, Q14):
 * they persist until purged and are granted again at the start of every round.
 *
 * Nayra's real passive: "At the start of the round this Unit gains Defensive Affinity Override."
 * Board: Nayra at the front, an opponent hits her once per turn with a plain 100% hit at attack
 * 1000 against defence 0. Under the override the hit lands at affinity disadvantage (750); without
 * it, 1000. The question the ruling answers is the fast-Nayra case: she takes her turn BEFORE the
 * opponent, and still holds the override when its hit lands.
 *
 * Run with Nayra on the player side and on the enemy side.
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
    realKit,
    type BoardUnit,
    type Placement,
} from '../__testutils__/realKitBoard';
import type { ShipSkills } from '../../../types/abilities';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable())
        throw new Error('docs/ship-skills.csv and docs/ship-data.json are required');
});
beforeEach(() => setupKeyedRng(51));

/** Nayra's real passive, with an empty active so she never attacks anyone. */
const nayraPassiveOnly = (): ShipSkills => ({
    slots: [
        { slot: 'active', abilities: [] },
        ...realKit('Nayra').slots.filter((s) => s.slot === 'passive'),
    ],
});

/** The opponent's active: purge 2 buffs from the struck enemy, then hit it. Two, because this
 *  board supplies no ship names, so Nayra's "If Isha is on the same team" gate takes its
 *  assume-met fallback and she also holds Offensive Affinity Override (granted second, so purged
 *  first). */
const purgeThenHit = (): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                {
                    id: 'purge',
                    type: 'purge',
                    target: 'enemy',
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'purge', count: 2 },
                },
                ...hitKit().slots[0].abilities,
            ],
        },
    ],
});

interface Run {
    /** The opponent's hit on Nayra, per round. */
    hit: Record<number, number>;
    expired: number;
    applied: number;
    /** Whether Nayra holds the override in each round's end-of-round status snapshot. */
    heldAtRoundEnd: Record<number, boolean>;
}

const run = (
    placement: Placement,
    nayraSpeed: number,
    rounds: number,
    opponentKit: ShipSkills = hitKit()
): Run => {
    const nayra: BoardUnit = {
        id: 'nayra',
        kit: nayraPassiveOnly(),
        position: 'M4',
        speed: nayraSpeed,
    };
    const opponent: BoardUnit = {
        id: 'opponent',
        kit: opponentKit,
        position: 'M4',
        speed: 100,
        attack: 1000,
        chargeCount: 99,
    };
    const { input, id } = boardInput(placement, nayra, [], [opponent], rounds);
    const nayraId = id(nayra);
    const opponentId = id(opponent);
    const bus = createEventBus();
    const out: Run = { hit: {}, expired: 0, applied: 0, heldAtRoundEnd: {} };
    bus.on('attacked', (e: Extract<CombatEvent, { type: 'attacked' }>) => {
        if (e.attackerId === opponentId && e.targetId === nayraId)
            out.hit[e.round] = Math.round(e.damage ?? 0);
    });
    bus.on('buff-applied', (e: Extract<CombatEvent, { type: 'buff-applied' }>) => {
        if (e.actorId === nayraId && e.buffName === 'Defensive Affinity Override') out.applied++;
    });
    bus.on('buff-expired', (e: Extract<CombatEvent, { type: 'buff-expired' }>) => {
        if (e.actorId === nayraId && e.buffName === 'Defensive Affinity Override') out.expired++;
    });
    bus.on('status-snapshot', (e: Extract<CombatEvent, { type: 'status-snapshot' }>) => {
        if (e.actorId === nayraId)
            out.heldAtRoundEnd[e.round] = e.buffNames.includes('Defensive Affinity Override');
    });
    runCombat({ ...input, bus });
    return out;
};

describe.each<Placement>(['player', 'enemy'])('Nayra on the %s side', (placement) => {
    it('fast Nayra (acts first) still holds the override when the hit lands: 750 every round', () => {
        const r = run(placement, 150, 3);
        expect(r.hit).toEqual({ 1: 750, 2: 750, 3: 750 });
        expect(r.applied).toBe(3);
        expect(r.expired).toBe(0);
    });

    it('reverse board: slow Nayra (acts after the hit) reads the same 750', () => {
        expect(run(placement, 50, 3).hit).toEqual({ 1: 750, 2: 750, 3: 750 });
    });

    it('negative: a purge removes it, and the next round start grants it again', () => {
        // Without a purge she ends every round holding it; the purging opponent takes it off in
        // each round, and she gains it again at the next round start.
        const kept = run(placement, 150, 2);
        expect(kept.heldAtRoundEnd).toEqual({ 1: true, 2: true });
        const purged = run(placement, 150, 2, purgeThenHit());
        expect(purged.heldAtRoundEnd).toEqual({ 1: false, 2: false });
        expect(purged.applied).toBe(2);
    });
});
