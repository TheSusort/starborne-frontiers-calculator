import {
    simulateBattle,
    type BattleResult,
    type BattleSimulationInput,
} from '../calculators/battleSimulator';
import { resetRateGateRng, setupKeyedRng } from '../calculators/rateAccumulator';
import type { GearPiece } from '../../types/gear';

/**
 * Run a battle under a pinned RNG seed so the result is byte-reproducible.
 *
 * Production combat draws crit, hit, debuff landing and every proc from `Math.random` via
 * `rateAccumulator`. This installs a seeded keyed sub-stream provider for the duration of the
 * call and restores `Math.random` in `finally`, so a throwing battle never leaks the seeded
 * stream into a later run.
 *
 * The `finally` restores the production default, NOT any ambient test seed — so a raw
 * `simulateBattle` called straight after this one is nondeterministic. Go through this
 * function, or re-seed yourself.
 */
export function runSeededBattle(
    input: BattleSimulationInput,
    seed: number,
    getGearPiece?: (id: string) => GearPiece | undefined
): BattleResult {
    setupKeyedRng(seed);
    try {
        return simulateBattle(input, getGearPiece);
    } finally {
        resetRateGateRng();
    }
}

export interface ActorTotals {
    damageDealt: number;
    damageTaken: number;
    healingDone: number;
}

export interface SeedRunSummary {
    seed: number;
    winner: 'player' | 'enemy' | 'draw';
    lastRound: number;
    /** Keyed by engine actorId (`p:<shipId>:<i>` / `e:<shipId>:<i>`, player index 0 is FOCUS_ID). */
    perActor: Record<string, ActorTotals>;
}

export interface SeedSetAggregate {
    baseSeed: number;
    count: number;
    /** Roster of the first run. Constant across seeds for one input, so the aggregate carries it
     *  and consumers never need to name actors by raw actorId. */
    roster: BattleResult['roster'];
    runs: SeedRunSummary[];
    wins: { player: number; enemy: number; draw: number };
    meanRounds: number;
    medianRounds: number;
    perActorMean: Record<string, ActorTotals>;
}

/** Collapse one battle into its comparable scalars.
 *  `ShipRoundState.damageDealt` / `damageTaken` / `healingDone` are PER-ROUND rates, not running
 *  cumulatives, so a fight total is a sum across `result.rounds`. */
export function summarizeRun(result: BattleResult, seed: number): SeedRunSummary {
    const perActor: Record<string, ActorTotals> = {};
    for (const round of result.rounds) {
        for (const ship of round.ships) {
            const totals = (perActor[ship.actorId] ??= {
                damageDealt: 0,
                damageTaken: 0,
                healingDone: 0,
            });
            totals.damageDealt += ship.damageDealt;
            totals.damageTaken += ship.damageTaken;
            totals.healingDone += ship.healingDone;
        }
    }
    return {
        seed,
        winner: result.outcome.winner,
        lastRound: result.outcome.lastRound,
        perActor,
    };
}

/**
 * Run the same input over seeds `baseSeed .. baseSeed + count - 1` and aggregate.
 *
 * One seeded run REPRODUCES a fight; only an aggregate over a seed set COMPARES two
 * configurations. Seeding is not full pairing: a stat change alters kill timing, which alters how
 * many draws each actor takes, so keyed sub-streams desync downstream of the first divergence
 * even under one seed.
 *
 * Each seed's setup and reset are contained in `runSeededBattle`, so yielding to the event loop
 * between seeds for a progress indicator is safe.
 */
export function runSeedSet(
    input: BattleSimulationInput,
    baseSeed: number,
    count: number,
    getGearPiece?: (id: string) => GearPiece | undefined
): SeedSetAggregate {
    if (!Number.isInteger(count) || count < 1) {
        throw new Error(`runSeedSet: count must be a positive integer, got ${count}`);
    }

    const runs: SeedRunSummary[] = [];
    let roster: BattleResult['roster'] = [];
    for (let i = 0; i < count; i++) {
        const seed = baseSeed + i;
        const result = runSeededBattle(input, seed, getGearPiece);
        if (i === 0) roster = result.roster;
        runs.push(summarizeRun(result, seed));
    }

    const wins = { player: 0, enemy: 0, draw: 0 };
    for (const run of runs) wins[run.winner]++;

    const rounds = runs.map((r) => r.lastRound);
    const sorted = [...rounds].sort((a, b) => a - b);

    const perActorMean: Record<string, ActorTotals> = {};
    for (const run of runs) {
        for (const [actorId, totals] of Object.entries(run.perActor)) {
            const acc = (perActorMean[actorId] ??= {
                damageDealt: 0,
                damageTaken: 0,
                healingDone: 0,
            });
            acc.damageDealt += totals.damageDealt;
            acc.damageTaken += totals.damageTaken;
            acc.healingDone += totals.healingDone;
        }
    }
    for (const totals of Object.values(perActorMean)) {
        totals.damageDealt /= runs.length;
        totals.damageTaken /= runs.length;
        totals.healingDone /= runs.length;
    }

    return {
        baseSeed,
        count,
        roster,
        runs,
        wins,
        meanRounds: rounds.reduce((a, b) => a + b, 0) / rounds.length,
        medianRounds: sorted[Math.floor(sorted.length / 2)],
        perActorMean,
    };
}
