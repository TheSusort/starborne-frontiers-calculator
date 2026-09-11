import { describe, it, expect } from 'vitest';
import type { BattlePlacement, BattleSimulationInput } from '../../calculators/battleSimulator';
import type { Ship } from '../../../types/ship';
import type { Position } from '../../../types/encounters';
import { runSeededBattle, runSeedSet, summarizeRun } from '../seededRuns';

const placement = (
    id: string,
    position: Position,
    stats: BattlePlacement['statOverrides']
): BattlePlacement => ({
    ship: {
        id,
        name: id,
        type: 'ATTACKER',
        baseStats: {},
        equipment: {},
        refits: [],
        // A ship with no skill text resolves to zero abilities (`getShipSkillRows` filters
        // empty-text rows), so the engine's turn loop has nothing to cast and every fight is
        // a permanent 0-damage draw regardless of `statOverrides`. A plain single-target hit
        // is the minimum kit that makes stat overrides observable in combat.
        activeSkillText: 'This Unit deals <unit-damage>100% damage</unit-damage>.',
        activeTarget: 'front',
        activePattern: 'Pattern-Base',
    } as unknown as Ship,
    position,
    statOverrides: stats,
});

/** A deliberately lopsided fight: the player side out-damages the enemy, so outcomes are
 *  non-degenerate (someone dies) while staying cheap. Stats are passed as `statOverrides`
 *  because omitting them floors combat to un-geared base stats. */
const input = (): BattleSimulationInput => ({
    playerTeam: [
        placement('striker', 'T1', {
            attack: 4000,
            crit: 50,
            critDamage: 150,
            hacking: 200,
            security: 100,
            defence: 500,
            hp: 20000,
            speed: 120,
        }),
    ],
    enemyTeam: [
        placement('dummy', 'T1', {
            attack: 800,
            crit: 50,
            critDamage: 150,
            hacking: 200,
            security: 100,
            defence: 500,
            hp: 20000,
            speed: 100,
        }),
    ],
});

describe('runSeededBattle', () => {
    it('is byte-reproducible for the same seed', () => {
        const a = runSeededBattle(input(), 12345);
        const b = runSeededBattle(input(), 12345);
        expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    });

    it('produces a different fight for a different seed', () => {
        // Non-vacuity: without this, a seeding path that froze every run to one fixed
        // sequence would read as a pass on the reproducibility test above.
        const a = runSeededBattle(input(), 12345);
        const b = runSeededBattle(input(), 999);
        expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
    });

    it('restores the production RNG afterwards, so a later run is not silently seeded', () => {
        runSeededBattle(input(), 12345);
        const a = runSeededBattle(input(), 777);
        const b = runSeededBattle(input(), 777);
        expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    });
});

describe('summarizeRun', () => {
    it('sums per-actor totals across rounds, because the round fields are rates not cumulatives', () => {
        const result = runSeededBattle(input(), 12345);
        const summary = summarizeRun(result, 12345);
        for (const actorId of Object.keys(summary.perActor)) {
            const expectedDealt = result.rounds.reduce(
                (sum, r) => sum + (r.ships.find((s) => s.actorId === actorId)?.damageDealt ?? 0),
                0
            );
            expect(summary.perActor[actorId].damageDealt).toBe(expectedDealt);
        }
    });

    it('carries the outcome and the seed', () => {
        const result = runSeededBattle(input(), 12345);
        const summary = summarizeRun(result, 12345);
        expect(summary.seed).toBe(12345);
        expect(summary.winner).toBe(result.outcome.winner);
        expect(summary.lastRound).toBe(result.outcome.lastRound);
    });

    it('records damage dealt for at least one actor (non-vacuous fixture)', () => {
        const summary = summarizeRun(runSeededBattle(input(), 12345), 12345);
        const totalDealt = Object.values(summary.perActor).reduce((s, a) => s + a.damageDealt, 0);
        expect(totalDealt).toBeGreaterThan(0);
    });
});

describe('runSeedSet', () => {
    it('uses exactly the seeds baseSeed .. baseSeed + count - 1', () => {
        const agg = runSeedSet(input(), 500, 4);
        expect(agg.runs.map((r) => r.seed)).toEqual([500, 501, 502, 503]);
        expect(agg.baseSeed).toBe(500);
        expect(agg.count).toBe(4);
    });

    it('win counts sum to the run count', () => {
        const agg = runSeedSet(input(), 500, 6);
        expect(agg.wins.player + agg.wins.enemy + agg.wins.draw).toBe(6);
    });

    it('meanRounds and medianRounds match its own runs', () => {
        const agg = runSeedSet(input(), 500, 5);
        const rounds = agg.runs.map((r) => r.lastRound);
        expect(agg.meanRounds).toBeCloseTo(rounds.reduce((a, b) => a + b, 0) / rounds.length, 10);
        const sorted = [...rounds].sort((a, b) => a - b);
        expect(agg.medianRounds).toBe(sorted[Math.floor(sorted.length / 2)]);
    });

    it('perActorMean equals the mean of its own per-run totals', () => {
        const agg = runSeedSet(input(), 500, 4);
        for (const actorId of Object.keys(agg.perActorMean)) {
            const runsWith = agg.runs.map((r) => r.perActor[actorId]?.damageDealt ?? 0);
            expect(agg.perActorMean[actorId].damageDealt).toBeCloseTo(
                runsWith.reduce((a, b) => a + b, 0) / agg.runs.length,
                10
            );
        }
    });

    it('is reproducible for the same base seed and count', () => {
        expect(JSON.stringify(runSeedSet(input(), 500, 3))).toBe(
            JSON.stringify(runSeedSet(input(), 500, 3))
        );
    });

    it('rejects a non-positive count rather than returning a meaningless empty aggregate', () => {
        expect(() => runSeedSet(input(), 500, 0)).toThrow(/count/i);
    });

    it('carries the roster, so consumers never have to name actors by raw actorId', () => {
        const agg = runSeedSet(input(), 500, 2);
        expect(agg.roster.length).toBe(2);
        expect(agg.roster.map((r) => r.side).sort()).toEqual(['enemy', 'player']);
        // Every actorId the summaries mention must be nameable from the roster.
        const rosterIds = new Set(agg.roster.map((r) => r.actorId));
        for (const run of agg.runs) {
            for (const actorId of Object.keys(run.perActor)) {
                expect(rosterIds.has(actorId)).toBe(true);
            }
        }
    });
});
