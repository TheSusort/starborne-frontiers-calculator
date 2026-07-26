/**
 * TEAM SYMMETRY for Lifeline (`incoming-shield-grant`).
 *
 * Locked engine rule: a ship behaves identically on either side. This mirrors ONE Lifeline
 * carrier + ONE attacker onto both teams — same ship definitions, same stats, mirrored
 * positions — and asserts the threshold shield fires for BOTH carriers, at the same amount.
 *
 * crit 0 so both attackers deal the same deterministic damage (a crit on one side only would
 * make the two thresholds cross at different rounds for legitimate reasons and mask a real
 * asymmetry). Distinct speeds are NOT used: the two attackers must hit with the same numbers.
 *
 * WHY THIS ASSERTS TOTALS, NOT THE FIRING ROUND. A perfect roster mirror is still NOT a mirror in
 * HP trajectory, because of the round's turn order: at EQUAL speeds the engine's input-order
 * tiebreak runs team → attacker → enemy (see the roundActors/pending comment in engine.ts), so the
 * whole PLAYER side acts before the whole enemy side. A ship that self-shields on its own turn
 * therefore has that pool up before the first incoming hit on the player side, and does NOT on the
 * enemy side — measured, with a mirrored self-shielding carrier: the very first hit sees
 * `shieldBefore=8400 / provisionalHpDamage=16600` for the player carrier vs
 * `shieldBefore=0 / provisionalHpDamage=25000` for the enemy one, leaving them at 58.5% vs 37.5%
 * HP after an identical round 1. Give the enemy side +1 speed and the two swap exactly. Since
 * Lifeline gates on the post-shield HP crossing, that one-round head start is enough to make the
 * threshold cross in different rounds — or on one side only — from identical rosters. That is
 * turn order, NOT a Lifeline asymmetry, which is what this test pins.
 */
import { describe, it, expect } from 'vitest';
import { simulateBattle, type BattlePlacement } from '../../calculators/battleSimulator';
import type { Ship, Refit } from '../../../types/ship';
import type { GearPiece } from '../../../types/gear';
import type { Position } from '../../../types/encounters';
import type { ShipTypeName } from '../../../constants/shipTypes';

const NO_REFITS: Refit[] = [];

const LIFELINE_GEAR_ID = 'lifeline-piece';

/** The single Lifeline implant piece both carriers wear (epic: 12000 + 100% attack). */
const getGearPiece = (id: string): GearPiece | undefined =>
    id === LIFELINE_GEAR_ID
        ? ({
              id: LIFELINE_GEAR_ID,
              slot: 'implant',
              level: 1,
              stars: 5,
              rarity: 'epic',
              mainStat: { name: 'hp', value: 0, type: 'flat' },
              subStats: [],
              setBonus: 'LIFELINE',
          } as unknown as GearPiece)
        : undefined;

const stats = (o: { hp: number; attack: number; defence: number; speed: number }) => ({
    hp: o.hp,
    attack: o.attack,
    defence: o.defence,
    hacking: 200,
    security: 200,
    crit: 0, // deterministic damage on BOTH sides
    critDamage: 0,
    speed: o.speed,
});

const shipBase = (
    id: string,
    name: string,
    type: ShipTypeName,
    o: { hp: number; attack: number; defence: number; speed: number }
): Ship => ({
    id,
    name,
    rarity: 'legendary',
    faction: 'MPL',
    type,
    baseStats: stats(o),
    equipment: {},
    implants: {},
    refits: NO_REFITS,
    level: 60,
    rank: 5,
    affinity: 'antimatter',
    chargeSkillCharge: 0,
});

const placement = (ship: Ship, position: Position): BattlePlacement => ({
    ship,
    position,
    statOverrides: {
        attack: ship.baseStats.attack,
        crit: ship.baseStats.crit,
        critDamage: ship.baseStats.critDamage,
        defensePenetration: 0,
        hacking: ship.baseStats.hacking,
        security: ship.baseStats.security,
        defence: ship.baseStats.defence,
        hp: ship.baseStats.hp,
        speed: ship.baseStats.speed,
    },
});

/** The Lifeline carrier: a plain body with no kit of its own, so the ONLY shield source in the
 *  battle is the implant. Low HP + a hard-hitting attacker guarantees the 30% crossing. */
const carrier = (id: string): Ship => ({
    ...shipBase(id, 'Warden', 'DEFENDER', {
        hp: 40_000,
        attack: 0,
        defence: 0,
        speed: 100,
    }),
    implants: { implant: LIFELINE_GEAR_ID },
    activeSkillText: 'This Unit deals <unit-damage>10% damage</unit-damage>.',
    activeTarget: 'front',
    activePattern: 'Pattern-Base',
});

/** The attacker: one hit per cast, big enough that hit #2 drives the carrier under 30%
 *  (40_000 → 15_000 → below 12_000 threshold). */
const striker = (id: string): Ship => ({
    ...shipBase(id, 'Curator', 'ATTACKER', {
        hp: 200_000,
        attack: 25_000,
        defence: 0,
        speed: 100,
    }),
    activeSkillText: 'This Unit deals <unit-damage>100% damage</unit-damage>.',
    activeTarget: 'front',
    activePattern: 'Pattern-Base',
});

describe('Lifeline threshold shield is team-symmetric', () => {
    it('fires for the PLAYER-side and ENEMY-side carrier alike', () => {
        const result = simulateBattle(
            {
                // Mirrored layout: each side's CARRIER at the front column (so the opposing
                // striker's 'front' selection resolves to it) with the striker behind it.
                playerTeam: [
                    placement(carrier('sym-carrier'), 'M4'),
                    placement(striker('sym-striker'), 'M1'),
                ],
                enemyTeam: [
                    placement(carrier('sym-carrier'), 'M4'),
                    placement(striker('sym-striker'), 'M1'),
                ],
                rounds: 6,
            },
            getGearPiece
        );

        const carrierIds = result.roster.filter((r) => r.name === 'Warden').map((r) => r.actorId);
        expect(carrierIds).toHaveLength(2);

        // Total shield granted to each carrier across the whole battle. Lifeline is
        // once-per-battle, so a firing carrier books exactly one grant.
        const grantedTotal = (actorId: string): number =>
            result.rounds.reduce(
                (sum, round) =>
                    sum + (round.ships.find((s) => s.actorId === actorId)?.shieldGranted ?? 0),
                0
            );

        const [a, b] = carrierIds.map(grantedTotal);
        expect(a).toBeGreaterThan(0); // the mechanic fired at all
        expect(b).toBe(a); // …and identically on the other side
    });
});
