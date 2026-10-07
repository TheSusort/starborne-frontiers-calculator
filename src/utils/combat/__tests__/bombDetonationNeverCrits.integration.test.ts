/**
 * Owner ruling: a Bomb (and an Echoing Burst) never critically hits. Its detonation pays the
 * non-crit formula whatever the applier's crit rate and crit power, and a detonation never wakes
 * a reaction to a critical hit ("when an ally critically hits").
 *
 * Board: a Bomber with 200% crit power whose active deals 100% damage and inflicts a Bomb (and, in
 * the skill-detonation case, first detonates Bombs on A), and an observer ally whose passive
 * grants Blast to the ally that crits. The front enemy A has no kit. The Bomber's own hit crits
 * once per cast at 100% crit, so every crit reaction must trace back to a cast.
 *
 * Run with the Bomber on the player side and on the enemy side.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus, type CombatEvent } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { boardInput, NO_KIT, type BoardUnit, type Placement } from '../__testutils__/realKitBoard';
import type { Ability, ShipSkills } from '../../../types/abilities';

beforeEach(() => setupKeyedRng(43));

const ATTACK = 1000;
const STACKS = 2;
const TIER = 100;

/** A 100% hit and a Bomb for `duration` turns; with `detonate`, the same cast first detonates
 *  Bombs on A. */
const bomberKit = (duration: number, detonate: boolean): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                {
                    id: 'hit',
                    type: 'damage',
                    target: 'enemy',
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'damage', multiplier: 100 },
                },
                ...(detonate
                    ? [
                          {
                              id: 'detonate',
                              type: 'damage' as const,
                              target: 'enemy' as const,
                              trigger: 'on-cast' as const,
                              conditions: [],
                              config: {
                                  type: 'detonate-dot' as const,
                                  dotType: 'bomb' as const,
                                  powerPct: 100,
                              },
                          },
                      ]
                    : []),
                {
                    id: 'bomb',
                    type: 'dot',
                    target: 'enemy',
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'dot', dotType: 'bomb', tier: TIER, stacks: STACKS, duration },
                },
            ],
        },
    ],
});

/** Howler/Sentinel shape: grants Blast to the ally that critically hits. */
const allyCritRider: Ability = {
    id: 'ally-crit-rider',
    type: 'buff',
    target: 'ally',
    trigger: 'on-ally-crit',
    conditions: [],
    config: {
        type: 'buff',
        buffName: 'Blast',
        duration: 2,
        stacks: 1,
        isStackable: false,
        parsedEffects: {},
    },
};

const run = (
    placement: Placement,
    crit: number,
    detonate: boolean
): {
    bursts: number[];
    allyCritReactions: number;
    critAttacks: number;
    attacksOffTurn: number;
    burstsOnBomberTurn: number;
} => {
    const bomber: BoardUnit = {
        id: 'bomber',
        kit: bomberKit(detonate ? 3 : 1, detonate),
        position: 'M3',
        speed: 300,
        attack: ATTACK,
        hacking: 1e6,
        crit,
        critDamage: 200,
    };
    const observer: BoardUnit = {
        id: 'observer',
        kit: {
            slots: [
                { slot: 'active', abilities: [] },
                { slot: 'passive', abilities: [allyCritRider] },
            ],
        },
        position: 'T3',
        speed: 5,
    };
    const a: BoardUnit = { id: 'a', kit: NO_KIT, position: 'M4', speed: 1 };
    const { input, id } = boardInput(placement, bomber, [observer], [a], 3);
    const bus = createEventBus();
    const bursts: number[] = [];
    let allyCritReactions = 0;
    let critAttacks = 0;
    let attacksOffTurn = 0;
    let burstsOnBomberTurn = 0;
    let turnOf = '';
    bus.on('turn-started', (e: Extract<CombatEvent, { type: 'turn-started' }>) => {
        turnOf = e.actorId;
    });
    bus.on('bomb-detonated', (e: Extract<CombatEvent, { type: 'bomb-detonated' }>) => {
        if (e.victimId !== id(a)) return;
        bursts.push(e.damage);
        if (turnOf === id(bomber)) burstsOnBomberTurn++;
    });
    bus.on('buff-applied', (e: Extract<CombatEvent, { type: 'buff-applied' }>) => {
        if (e.buffName === 'Blast') allyCritReactions++;
    });
    bus.on('ability-performed', (e: Extract<CombatEvent, { type: 'ability-performed' }>) => {
        if (e.actorId !== id(bomber)) return;
        if (turnOf !== id(bomber)) attacksOffTurn++;
        if (e.didCrit || (e.critHits ?? 0) > 0) critAttacks++;
    });
    runCombat({ ...input, bus });
    return { bursts, allyCritReactions, critAttacks, attacksOffTurn, burstsOnBomberTurn };
};

describe.each<Placement>(['player', 'enemy'])('a Bomber on the %s side', (placement) => {
    it('a natural expiry pays the non-crit formula at 100% crit and wakes no crit reaction', () => {
        const r = run(placement, 100, false);
        // Bomb applied each round, bursting on A's turn: stacks × attack × tier/100, no crit.
        expect(r.bursts.length).toBeGreaterThan(0);
        for (const d of r.bursts) expect(d).toBe(STACKS * ATTACK * (TIER / 100));
        // The burst is no attack: the Bomber attacks only on its own turn, and the only crit
        // reactions are to its own critting hits, one per cast.
        expect(r.attacksOffTurn).toBe(0);
        expect(r.critAttacks).toBe(3);
        expect(r.allyCritReactions).toBe(r.critAttacks);
    });

    it('a skill detonation pays the same at 100% crit as at 0% and wakes no crit reaction', () => {
        const critting = run(placement, 100, true);
        const plain = run(placement, 0, true);
        // The detonation runs inside the Bomber's own critting cast.
        expect(critting.burstsOnBomberTurn).toBeGreaterThan(0);
        expect(critting.bursts).toEqual(plain.bursts);
        expect(critting.attacksOffTurn).toBe(0);
        expect(critting.allyCritReactions).toBe(critting.critAttacks);
        expect(plain.allyCritReactions).toBe(0);
    });
});
