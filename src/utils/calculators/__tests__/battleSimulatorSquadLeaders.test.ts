/**
 * Sub-project F, PR F1: squad-leader plumbing through `simulateBattle` — integration
 * tests (positioned squads → runCombat → BattleResult).
 *
 * Fixture style copied from the Task 3/4 adapter tests in combat/__tests__/
 * twoTeamBattle.test.ts (minimal Ship factory + statOverrides placements), extended
 * with a per-ship faction so the leader's faction gate has something to bite on.
 *
 * Leader under test: MPL "Midas" (legendary). Stage III active set =
 *   I:  +10% HP & +10% Attack (all MPL allies — stat fold),
 *   II: -7.5% incoming direct damage (MPL allies — protection modifier, unsimulated until F3),
 *   III: enemies lose 15% crit rate (stat fold; inert here — fixture crit is 0).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setRateGateRng, resetRateGateRng } from '../rateAccumulator';
import { simulateBattle, BattlePlacement, BattleSimulationInput } from '../battleSimulator';
import type { Ship } from '../../../types/ship';
import type { FactionName } from '../../../constants/factions';
import type { Position } from '../../../types/encounters';

// Deterministic rate gates so paired runs are comparable via toEqual (crit is 0 across
// the fixtures anyway, but pinning the RNG keeps the byte-identity test airtight).
beforeEach(() => setRateGateRng(() => 0.999999));
afterEach(() => resetRateGateRng());

// Minimal Ship factory: only the fields simulateBattle reads — faction (pre-fight
// gating), baseStats, affinity, the raw active targeting strings, and a single-hit 100%
// damage active skill so the ship fires clean known damage (attack × 1 vs defence 0).
const makeShip = (
    id: string,
    name: string,
    faction: FactionName,
    opts: { activeTarget: string; activePattern: string }
): Ship => ({
    id,
    name,
    rarity: 'legendary',
    faction,
    type: 'Attacker',
    baseStats: {
        hp: 0,
        attack: 0,
        defence: 0,
        hacking: 200,
        security: 100,
        crit: 0,
        critDamage: 0,
        speed: 100,
    },
    equipment: {},
    implants: {},
    refits: [],
    affinity: 'antimatter',
    activeSkillText: 'This Unit deals <unit-damage>100% damage</unit-damage>.',
    chargeSkillCharge: 0,
    activeTarget: opts.activeTarget,
    activePattern: opts.activePattern,
});

const placement = (
    ship: Ship,
    position: Position,
    attack: number,
    hp: number
): BattlePlacement => ({
    ship,
    position,
    statOverrides: {
        attack,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        hacking: 200,
        defence: 0,
        hp,
    },
});

const FRONT = { activeTarget: 'front', activePattern: 'Pattern-Base' } as const;
const BACK = { activeTarget: 'back', activePattern: 'Pattern-Base' } as const;

/** 2v2 board: p1 = MPL focus up front, p2 = off-faction (Terran) in the back. */
const buildTeams = (
    p1Faction: FactionName = 'MPL'
): Pick<BattleSimulationInput, 'playerTeam' | 'enemyTeam'> => ({
    playerTeam: [
        placement(makeShip('p1', 'Player Front', p1Faction, FRONT), 'M4', 5000, 100_000),
        placement(makeShip('p2', 'Player Back', 'TERRAN_COMBINE', BACK), 'M3', 4000, 100_000),
    ],
    enemyTeam: [
        placement(makeShip('e1', 'Enemy Front', 'TERRAN_COMBINE', FRONT), 'M4', 2000, 100_000),
        placement(makeShip('e2', 'Enemy Back', 'TERRAN_COMBINE', BACK), 'M1', 2000, 100_000),
    ],
});

const MIDAS = { faction: 'MPL', name: 'Midas', stage: 3 } as const;

// Round-1 ship row lookup (p1 is the focus placement, so its actorId is 'attacker').
const round1 = (result: ReturnType<typeof simulateBattle>, actorId: string) => {
    const row = result.rounds[0].ships.find((s) => s.actorId === actorId);
    if (!row) throw new Error(`no round-1 row for ${actorId}`);
    return row;
};

describe('simulateBattle squad leaders — golden safety (no leader = exact no-op)', () => {
    it('a run with the new fields absent is deep-equal to one with them explicitly undefined, and has NO preFight key', () => {
        const resultA = simulateBattle({ ...buildTeams(), rounds: 3 });
        const resultB = simulateBattle({
            ...buildTeams(),
            rounds: 3,
            playerSquadLeader: undefined,
            enemySquadLeader: undefined,
        });
        expect(resultA).toEqual(resultB);
        expect('preFight' in resultA).toBe(false);
        expect('preFight' in resultB).toBe(false);
    });
});

describe('simulateBattle squad leaders — stat effects reach the battle', () => {
    it('Midas stage 3 scales the MPL ship (damage ×1.1, maxHp +10%) and leaves the off-faction teammate untouched', () => {
        const baseline = simulateBattle({ ...buildTeams(), rounds: 2 });
        const withLeader = simulateBattle({
            ...buildTeams(),
            rounds: 2,
            playerSquadLeader: MIDAS,
        });

        // +10% attack → the MPL focus ship's round-1 dealt damage scales exactly ×1.1.
        expect(round1(withLeader, 'attacker').damageDealt).toBeCloseTo(
            1.1 * round1(baseline, 'attacker').damageDealt
        );
        expect(round1(baseline, 'attacker').damageDealt).toBeGreaterThan(0);

        // Off-faction teammate's output is unchanged.
        expect(round1(withLeader, 'p:p2:1').damageDealt).toBe(
            round1(baseline, 'p:p2:1').damageDealt
        );

        // +10% HP → same incoming damage against a larger maxHp lands a HIGHER hpPct
        // (roster maxHp comes from the mutated plan stats).
        expect(round1(baseline, 'attacker').damageTaken).toBeGreaterThan(0);
        expect(round1(withLeader, 'attacker').hpPct).toBeGreaterThan(
            round1(baseline, 'attacker').hpPct
        );
        expect(round1(withLeader, 'p:p2:1').hpPct).toBe(round1(baseline, 'p:p2:1').hpPct);

        // The stage-II ally protection modifier is NOT consumed in F1 → surfaced as
        // unsimulated on the MPL ship only (F3 will remove this and apply the channel).
        expect(withLeader.preFight).toBeDefined();
        expect(withLeader.preFight?.unsimulated).toEqual([
            { actorId: 'attacker', name: 'Player Front', texts: ['-7.5% incoming direct damage'] },
        ]);
    });

    it('faction gate integration: with no MPL ship on the player team, Midas changes NOTHING', () => {
        // p1 swapped to XAOC → no MPL ship anywhere on the player side. Ally effects
        // (incl. the stage-II protection modifier) have no recipient and the all-enemies
        // stage-III effect is gated off → the whole result is deep-equal to a no-leader
        // run (and no preFight block appears).
        const baseline = simulateBattle({ ...buildTeams('XAOC'), rounds: 2 });
        const gated = simulateBattle({
            ...buildTeams('XAOC'),
            rounds: 2,
            playerSquadLeader: MIDAS,
        });
        expect(gated).toEqual(baseline);
        expect('preFight' in gated).toBe(false);
    });
});

describe('simulateBattle squad leaders — input validation', () => {
    it('throws on an unknown leader name (trust boundary)', () => {
        expect(() =>
            simulateBattle({
                ...buildTeams(),
                rounds: 2,
                playerSquadLeader: { faction: 'MPL', name: 'Not A Leader', stage: 1 },
            })
        ).toThrow('squadLeaderPass: unknown squad leader "Not A Leader" for faction "MPL"');
    });
});
