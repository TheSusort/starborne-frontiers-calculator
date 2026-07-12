import { DPSSimulationSummary } from './dpsSimulator';

export interface RankableDpsResult {
    id: string;
    summary: DPSSimulationSummary;
}

/**
 * Ranks DPS configs best→worst against a killable enemy target (SP-U U6).
 *
 * Killers (the enemy died within the simulated window) always outrank survivors —
 * securing the kill is the point of a time-to-kill tool. Among killers, fewer
 * `roundsToKill` wins; ties are broken by higher `totalDamage` (rewards overkill
 * pace when two configs land the kill on the exact same round). Among survivors
 * (the enemy outlasted the window), lower `finalHpPct` wins — closer to death is
 * the best available signal when nobody actually secures the kill.
 *
 * Pure and side-effect free: does not mutate `results`, no React/UI concerns.
 */
export function rankDpsConfigs(results: RankableDpsResult[]): string[] {
    const killers = results.filter((r) => !r.summary.survived);
    const survivors = results.filter((r) => r.summary.survived);

    const rankedKillers = [...killers].sort((a, b) => {
        const roundsDiff =
            (a.summary.roundsToKill ?? Infinity) - (b.summary.roundsToKill ?? Infinity);
        if (roundsDiff !== 0) return roundsDiff;
        return b.summary.totalDamage - a.summary.totalDamage;
    });

    const rankedSurvivors = [...survivors].sort(
        (a, b) => a.summary.finalHpPct - b.summary.finalHpPct
    );

    return [...rankedKillers, ...rankedSurvivors].map((r) => r.id);
}
