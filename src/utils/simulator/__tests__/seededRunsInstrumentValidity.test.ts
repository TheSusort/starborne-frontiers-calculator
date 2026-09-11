import { describe, it, expect } from 'vitest';
import { buildTeam } from '../buildTeam';
import { runSeedSet } from '../seededRuns';
import type { BoardState } from '../../../components/simulator/PlacementBoard';
import type { CombatStatsDeps } from '../../ship/combatStats';
import type { Ship } from '../../../types/ship';
import type { StatOverrides } from '../statOverrides';

/**
 * Instrument-validity check for the simulator comparison tool, exercised through the same
 * `buildTeam` path the page uses (`placement.overrides` → `applyStatOverrides` →
 * `BattlePlacement.statOverrides`), not by authoring `BattlePlacement` by hand. A comparison
 * tool that cannot report a change is the failure mode this guards: if the page stopped
 * threading overrides into `buildTeam`, or `runSeedSet` collapsed to a single run, nothing
 * else in the suite would fail.
 */

const deps: CombatStatsDeps = {
    getGearPiece: () => undefined,
    getEngineeringStatsForShipType: () => undefined,
};

const SEED_COUNT = 20;
const BASE_SEED = 42000;

function makeShip(id: string, baseStats: Record<string, number>): Ship {
    return {
        id,
        name: id,
        type: 'ATTACKER',
        baseStats,
        equipment: {},
        implants: {},
        refits: [],
        // A plain single-target hit, mirroring the minimum kit used by `seededRuns.test.ts` —
        // enough for combat to have something to cast without pulling in a passive/charge kit.
        activeSkillText: 'This Unit deals <unit-damage>100% damage</unit-damage>.',
        activeTarget: 'front',
        activePattern: 'Pattern-Base',
    } as unknown as Ship;
}

/** A punching bag: enough HP that no attack magnitude used here kills it inside the round cap,
 *  so total damage dealt scales with attack instead of saturating at "enemy HP + overkill". */
const PUNCHING_BAG_HP = 5_000_000;

function board(
    playerAttack: number,
    playerOverrides?: StatOverrides
): {
    player: BoardState;
    enemy: BoardState;
} {
    const playerShip = makeShip('striker', {
        hp: 20000,
        attack: playerAttack,
        defence: 300,
        hacking: 200,
        security: 100,
        crit: 20,
        critDamage: 150,
        speed: 120,
    });
    const enemyShip = makeShip('dummy', {
        hp: PUNCHING_BAG_HP,
        attack: 10,
        defence: 300,
        hacking: 200,
        security: 100,
        crit: 20,
        critDamage: 150,
        speed: 80,
    });
    return {
        player: { T1: { ship: playerShip, overrides: playerOverrides } },
        enemy: { T1: { ship: enemyShip } },
    };
}

function runAggregate(playerAttack: number, playerOverrides?: StatOverrides) {
    const { player, enemy } = board(playerAttack, playerOverrides);
    const input = {
        playerTeam: buildTeam(player, deps),
        enemyTeam: buildTeam(enemy, deps),
    };
    return { input, agg: runSeedSet(input, BASE_SEED, SEED_COUNT) };
}

function playerMeanDealt(agg: ReturnType<typeof runSeedSet>): number {
    const playerId = agg.roster.find((r) => r.side === 'player')?.actorId;
    if (!playerId) throw new Error('no player actor in roster');
    return agg.perActorMean[playerId].damageDealt;
}

describe('simulator instrument validity (buildTeam -> runSeedSet)', () => {
    it('threads a placement override into the BattlePlacement the engine receives', () => {
        // The direct check: overrides actually reach the engine's input, before asking whether
        // they change the outcome.
        const baseline = buildTeam(board(1000).player, deps);
        const variant = buildTeam(board(1000, { attack: 6000 }).player, deps);
        expect(baseline[0].statOverrides?.attack).toBe(1000);
        expect(variant[0].statOverrides?.attack).toBe(6000);
    });

    it('moves mean damage dealt up when attack is overridden up, without saturating', () => {
        const baseline = runAggregate(1000, undefined);
        const variant = runAggregate(1000, { attack: 6000 });

        const baselineDealt = playerMeanDealt(baseline.agg);
        const variantDealt = playerMeanDealt(variant.agg);

        // Direction + margin (no golden numbers): a 6x attack override should move mean damage
        // dealt by well more than the ~1x noise floor of crit/proc variance.
        expect(variantDealt).toBeGreaterThan(baselineDealt * 3);

        // Non-saturation witness: the punching bag's HP is never approached, so the instrument
        // still has room to move if the override were raised further.
        expect(variantDealt).toBeLessThan(PUNCHING_BAG_HP * 0.1);

        // Win count is expected to saturate to all-draw by design (the enemy never dies inside
        // the round cap and never kills the player back) — damage dealt is the instrument here,
        // not the win tally.
        expect(baseline.agg.wins.draw).toBe(SEED_COUNT);
        expect(variant.agg.wins.draw).toBe(SEED_COUNT);
    });

    it('moves mean damage dealt down when attack is overridden down (both directions, not just up)', () => {
        const baseline = runAggregate(1000, undefined);
        const lowered = runAggregate(1000, { attack: 300 });

        expect(playerMeanDealt(lowered.agg)).toBeLessThan(playerMeanDealt(baseline.agg));
    });

    it('negative control: an override the kit cannot read does not move the outcome', () => {
        // `healModifier` has no effect on a kit with no repair clause. This is what distinguishes
        // "the instrument responds to input" (the attack probe above) from "the instrument
        // responds to everything" (a probe that would pass even for an override the engine never
        // consults).
        const baseline = runAggregate(1000, undefined);
        const withUnreadOverride = runAggregate(1000, { healModifier: 99999 });

        expect(withUnreadOverride.agg).toEqual(baseline.agg);
    });
});
