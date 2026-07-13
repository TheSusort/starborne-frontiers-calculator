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

/** Correctly-signed total-damage delta of `best` vs `second`, as a percentage label. */
function damageDeltaLabel(bestDamage: number, secondDamage: number): string {
    if (secondDamage === 0) return '';
    const pct = ((bestDamage - secondDamage) / secondDamage) * 100;
    // toFixed already renders the minus sign for negatives; only positives need a '+'.
    const sign = pct >= 0 ? '+' : '';
    return `${sign}${pct.toFixed(2)}% damage vs #2`;
}

/**
 * The comparison label shown on the top-ranked ("Best") config, describing how it beats #2
 * ALONG THE RANKING DIMENSION (SP-U U6 review fix). The old code always printed a hardcoded
 * `+{damage%} vs #2`, which goes nonsensical once ranking is by fewest rounds-to-kill: the
 * fastest killer can deal LESS total damage than #2, rendering e.g. `+-38.42% vs #2`.
 *
 * - Both killed: report the rounds advantage (`Kills N round(s) faster than #2`). On a rounds
 *   tie (best won on the totalDamage tie-break), fall back to a correctly-signed damage delta.
 * - Best killed, #2 survived: best is the sole killer (killers always rank ahead of survivors,
 *   so if #2 survived, nothing else killed) — say so; never compute a rounds delta vs a non-killer.
 * - Both survived (no killer anywhere): rank is by remaining HP%; report the correctly-signed
 *   damage delta (kept simple, and never a literal '+' in front of a negative number).
 *
 * Pure — no React, no side effects.
 */
export function describeBestVsSecond(
    best: DPSSimulationSummary,
    second: DPSSimulationSummary
): string {
    const bestKilled = !best.survived;
    const secondKilled = !second.survived;

    if (bestKilled && secondKilled) {
        const roundsFaster = (second.roundsToKill ?? 0) - (best.roundsToKill ?? 0);
        if (roundsFaster > 0) {
            return `Kills ${roundsFaster} round${roundsFaster === 1 ? '' : 's'} faster than #2`;
        }
        // Tie on rounds — best ranked first via the higher-total-damage tie-break.
        return damageDeltaLabel(best.totalDamage, second.totalDamage);
    }

    if (bestKilled && !secondKilled) {
        return 'Only config to destroy the target';
    }

    // Both survived (best ranks first ⇒ if best survived, so did #2 and everything else).
    return damageDeltaLabel(best.totalDamage, second.totalDamage);
}

/**
 * Tailwind color class for the best-vs-#2 badge produced by {@link describeBestVsSecond}
 * (final-review fix, SP-U). `damageDeltaLabel` renders a bare leading `-` for a negative delta
 * (never a `+-`), so a label starting with `-` is the sole "this isn't good news" case — the
 * all-survived / rounds-tie edge where the higher-ranked config actually dealt LESS damage than
 * #2. Every other shape (`Kills N round(s) faster…`, a `+`-prefixed damage delta, `Only config
 * to destroy the target`) is good news for the #1 config and stays green.
 */
export function bestVsSecondLabelColorClass(label: string): string {
    return label.startsWith('-') ? 'text-red-500' : 'text-green-500';
}

/**
 * Sign-prefixed percentage text for the non-best "Compared to best" badge (CodeRabbit fix,
 * SP-U). `toFixed` already renders the minus sign for negatives; only non-negatives need an
 * explicit '+' — mirrors {@link damageDeltaLabel}'s sign convention.
 */
export function formatComparedToBestPercentage(percentage: number): string {
    const sign = percentage >= 0 ? '+' : '';
    return `${sign}${percentage.toFixed(2)}%`;
}

/**
 * Tailwind color class for the "Compared to best" badge (CodeRabbit fix, SP-U). Since
 * bestConfig is now ranked by roundsToKill rather than max total damage, a non-best config's
 * total damage can exceed the best config's (a positive delta) — that must render as favorable
 * (green), not the old hardcoded red. Mirrors {@link bestVsSecondLabelColorClass}'s sign
 * convention: non-negative is favorable.
 */
export function comparedToBestColorClass(percentage: number): string {
    return percentage >= 0 ? 'text-green-500' : 'text-red-500';
}
