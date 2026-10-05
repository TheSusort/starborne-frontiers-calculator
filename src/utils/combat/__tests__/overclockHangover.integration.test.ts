/**
 * Overclock leaves a hangover. In-app Overclock III: "+30% Attack, +60% Crit Power. On removal or
 * expiration, apply Speed Down I and Attack Down I to self for 2 turns." The catalogue's family
 * text agrees ("Upon removal or expiration, apply [Speed Down] and [Attack Down] for 2 turns").
 *
 * Graphite's real active grants Overclock III (2 turns) to all allies. Graphite has 1 HP and is
 * destroyed by the opponent right after its round-1 cast, so the grant is never refreshed. The ally
 * (attack 1000, speed 10, crit 0) hits a defence-0 opponent once per turn, so its hit IS its
 * attack: 1300 under Overclock, 850 under Attack Down I, 1000 bare. Its speed is read at the start
 * of each of its turns: 10 bare, 8.5 under Speed Down I. The hangover debuffs sit in the ally's
 * ordinary debuff store, so they show in its debuff list.
 *
 * Run with Graphite on the player side and on the enemy side. A purge arm checks "removal".
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
beforeEach(() => setupKeyedRng(7));

interface PerRound {
    hit: Record<number, number>;
    speed: Record<number, number>;
    debuffs: Record<number, string[]>;
    /** Buffs granted to the ally, in order. */
    allyBuffs: string[];
}

const run = (
    placement: Placement,
    opponentKit: ShipSkills,
    rounds: number,
    opponentHitsAll = false,
    allyKit: ShipSkills = hitKit()
): PerRound => {
    const graphite: BoardUnit = {
        id: 'graphite',
        kit: realKit('Graphite'),
        position: 'M4',
        speed: 300,
        hp: 1,
        chargeCount: 4,
        pattern: parsePattern('Pattern-Support-All'),
    };
    const ally: BoardUnit = {
        id: 'ally',
        kit: allyKit,
        position: 'M3',
        speed: 10,
        attack: 1000,
    };
    const opponent: BoardUnit = {
        id: 'opponent',
        kit: opponentKit,
        position: 'M4',
        speed: 200,
        attack: 1000,
        chargeCount: 99,
        ...(opponentHitsAll ? { pattern: parsePattern('Pattern-All') } : {}),
    };
    const { input, id } = boardInput(placement, graphite, [ally], [opponent], rounds);
    const allyId = id(ally);
    const bus = createEventBus();
    const out: PerRound = { hit: {}, speed: {}, debuffs: {}, allyBuffs: [] };
    bus.on('attacked', (e: Extract<CombatEvent, { type: 'attacked' }>) => {
        if (e.attackerId === allyId) out.hit[e.round] = Math.round(e.damage ?? 0);
    });
    bus.on('buff-applied', (e: Extract<CombatEvent, { type: 'buff-applied' }>) => {
        if (e.actorId === allyId) out.allyBuffs.push(e.buffName);
    });
    bus.on('stats-snapshot', (e: Extract<CombatEvent, { type: 'stats-snapshot' }>) => {
        if (e.actorId === allyId && out.speed[e.round] === undefined)
            out.speed[e.round] = e.stats.speed;
    });
    bus.on('status-snapshot', (e: Extract<CombatEvent, { type: 'status-snapshot' }>) => {
        if (e.actorId === allyId) out.debuffs[e.round] = [...e.debuffNames].sort();
    });
    runCombat({ ...input, bus });
    return out;
};

/** The opponent purges one buff from every enemy it strikes, then hits. */
const purgingKit = (): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                {
                    id: 'purge',
                    type: 'purge',
                    target: 'all-enemies',
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'purge', count: 1 },
                },
                ...hitKit().slots[0].abilities,
            ],
        },
    ],
});

describe.each<Placement>(['player', 'enemy'])('Graphite on the %s side', (placement) => {
    it('expiry: 2 rounds of Overclock, then 2 turns of Attack Down I + Speed Down I', () => {
        const r = run(placement, hitKit(), 5);
        expect(r.hit).toEqual({ 1: 1300, 2: 1300, 3: 850, 4: 850, 5: 1000 });
        expect(r.speed[2]).toBe(10);
        expect(r.speed[3]).toBeCloseTo(8.5, 9);
        expect(r.speed[4]).toBeCloseTo(8.5, 9);
        expect(r.speed[5]).toBe(10);
        expect(r.debuffs[3]).toEqual(['Attack Down I', 'Speed Down I']);
        expect(r.debuffs[5]).toEqual([]);
    });

    it('removal: a purged Overclock leaves the same hangover', () => {
        const r = run(placement, purgingKit(), 2, true);
        // Round 1: the opponent (faster than the ally) purges Overclock before the ally acts.
        expect(r.hit[1]).toBe(850);
        expect(r.debuffs[1]).toEqual(['Attack Down I', 'Speed Down I']);
    });

    it("the hangover is not the holder applying a debuff: Yuyan's passive stays quiet", () => {
        // Yuyan: "gains Stealth ... when applying a debuff". Her own passive on a plain hit kit,
        // so the hangover is the only debuff she could be said to apply.
        const yuyan: ShipSkills = {
            slots: [
                ...hitKit().slots,
                ...realKit('Yuyan').slots.filter((sl) => sl.slot === 'passive'),
            ],
        };
        const r = run(placement, hitKit(), 4, false, yuyan);
        expect(r.debuffs[3]).toEqual(['Attack Down I', 'Speed Down I']);
        expect(r.allyBuffs.filter((b) => b !== 'Overclock III')).toEqual([]);
    });
});
