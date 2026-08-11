import React from 'react';
import { DPSShipConfig } from '../../types/calculator';
import { DPSSimulationResult } from '../../utils/calculators/dpsSimulator';
import { averageFocusStats, averageEffectiveCrit } from '../../utils/calculators/roundStatsAverage';
import { calculateCritMultiplier } from '../../utils/autogear/scoring';
import { selectFiringSkill } from '../../utils/abilities/applyAbilities';
import { orderByTurnPriority } from '../../utils/combat/state';
import {
    bestVsSecondLabelColorClass,
    comparedToBestColorClass,
    formatComparedToBestPercentage,
} from '../../utils/calculators/rankDpsConfigs';

/** Display-ready team actor: resolved name + turn-order speed. */
export interface TurnOrderTeamActor {
    name: string;
    speed: number;
}

interface ShipConfigSummaryProps {
    config: DPSShipConfig;
    simResult: DPSSimulationResult;
    isBest: boolean;
    isComparing: boolean;
    rounds: number;
    bestTotalDamage: number | undefined;
    /** Ranking-aware label describing best's advantage over #2 (SP-U U6). Null → no badge. */
    bestVsSecondLabel: string | null;
    teamActors: TurnOrderTeamActor[];
    enemySpeed: number;
}

export const ShipConfigSummary: React.FC<ShipConfigSummaryProps> = ({
    config,
    simResult,
    isBest,
    isComparing,
    rounds,
    bestTotalDamage,
    bestVsSecondLabel,
    teamActors,
    enemySpeed,
}) => {
    // Build the round's actor order with the engine's exact tiebreak rule. Input order
    // mirrors buildTurnQueue's caller contract: team actors, then the attacker, then the
    // enemy — so equal speeds resolve team → attacker → enemy.
    const turnOrder = orderByTurnPriority([
        ...teamActors.map((t) => ({ name: t.name, speed: t.speed, side: 'player' as const })),
        { name: config.name, speed: config.speed, side: 'player' as const },
        { name: 'Enemy', speed: enemySpeed, side: 'enemy' as const },
    ]);

    const hasDoTs =
        simResult.summary.totalCorrosionDamage > 0 ||
        simResult.summary.totalInfernoDamage > 0 ||
        simResult.summary.totalDetonationDamage > 0;

    // SP-2: the buffed stats behind these numbers come from the engine's own per-turn
    // `stats-snapshot` readings, turn-weighted across the run — one authority, not a second static
    // conversion that could disagree with the damage number printed beside it. Undefined only when
    // the run was simulated without the timeline; then the config's unbuffed base stats are the
    // honest fallback.
    const avgStats = averageFocusStats(simResult.rounds);
    // The per-turn clamp lives in `averageEffectiveCrit`, not here: clamping the AVERAGE instead of
    // each turn over-reports (a turn folded to 120 still crits at 100, but averaging the raw folds
    // first can push the mean above what any turn actually rolled). See its doc for the worked
    // example.
    const avgCrit = averageEffectiveCrit(simResult.rounds);
    const critMultiplier = calculateCritMultiplier({
        attack: avgStats?.attack ?? config.attack,
        crit: avgCrit ?? Math.min(100, config.crit),
        critDamage: avgStats?.critDamage ?? config.critDamage,
        hp: 0,
        defence: 0,
        hacking: 0,
        security: 0,
        speed: 0,
        healModifier: 0,
    });

    const chargedSkill = selectFiringSkill(config.shipSkills, 'charged');
    // Mirror the adapter's hasChargedSkill rule: the charged slot "fires" when it carries ANY
    // ability (damage or pure utility), not only when it has a damage multiplier.
    const hasChargedSkill = (chargedSkill?.abilities.length ?? 0) > 0;

    const comparedToBestPercentage =
        bestTotalDamage !== undefined && bestTotalDamage !== 0 && !isBest
            ? ((simResult.summary.totalDamage - bestTotalDamage) / bestTotalDamage) * 100
            : null;

    // SP-U U6: the enemy is now a real, destructible target. Lead with the outcome that
    // actually matters — rounds-to-kill for a killed run, remaining HP% for a survivor —
    // ahead of the raw damage totals (kept below as secondary detail).
    const { survived, roundsToKill, finalHpPct } = simResult.summary;

    return (
        <div className="mt-4 pt-4 border-t border-dark-border">
            <div className="mb-3">
                <span className="text-xs font-semibold uppercase tracking-wide text-primary">
                    Turn Order
                </span>
                <div className="flex flex-wrap gap-1 mt-1">
                    {turnOrder.map((actor, i) => (
                        <span
                            key={`${actor.name}-${i}`}
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-dark-lighter ${
                                actor.side === 'enemy' ? 'text-red-400' : 'text-theme-text-primary'
                            }`}
                        >
                            <span className="text-theme-text-secondary">{i + 1}</span>
                            <span className="font-medium">{actor.name}</span>
                            <span className="text-theme-text-secondary">{actor.speed}</span>
                        </span>
                    ))}
                </div>
            </div>
            <div className="flex justify-between items-baseline mb-3">
                <span className="text-theme-text-secondary">Outcome:</span>
                {!survived ? (
                    <span className="text-green-400 font-bold text-lg">
                        Killed in {roundsToKill} round{roundsToKill === 1 ? '' : 's'}
                    </span>
                ) : (
                    <span className="text-yellow-400 font-bold text-lg">
                        Survived ({finalHpPct.toFixed(1)}% HP left)
                    </span>
                )}
            </div>
            <div className="flex justify-between mb-2">
                <span className="text-theme-text-secondary">Crit Multiplier:</span>
                <span>{critMultiplier.toFixed(2)}x</span>
            </div>
            {avgStats && (
                <div className="flex justify-between mb-2">
                    <span className="text-theme-text-secondary">
                        Avg Buffed Attack / Crit / Crit DMG:
                    </span>
                    <span>
                        {Math.round(avgStats.attack).toLocaleString()} /{' '}
                        {Math.round(avgCrit ?? avgStats.crit)}% / {Math.round(avgStats.critDamage)}%
                    </span>
                </div>
            )}
            <div className="flex justify-between mb-2">
                <span className="text-theme-text-secondary">Avg Damage / Round:</span>
                <span className={isBest ? 'text-primary font-bold' : ''}>
                    {simResult.summary.avgDamagePerRound.toLocaleString()}
                </span>
            </div>
            <div className="flex justify-between mb-2">
                <span className="text-theme-text-secondary">
                    Total Damage ({!survived ? `${roundsToKill} rounds` : `${rounds} rounds`}):
                </span>
                <span className={isBest ? 'text-primary font-bold' : ''}>
                    {simResult.summary.totalDamage.toLocaleString()}
                </span>
            </div>
            {hasChargedSkill && config.chargeCount > 0 && (
                <div className="flex justify-between mb-2">
                    <span className="text-theme-text-secondary">Charged skill fires:</span>
                    <span>
                        {(() => {
                            const fires = simResult.rounds.filter(
                                (r) => r.action === 'charged'
                            ).length;
                            return fires > 0
                                ? `every ${(simResult.rounds.length / fires).toFixed(1)} rounds`
                                : '—';
                        })()}
                    </span>
                </div>
            )}
            {simResult.summary.totalSecondaryDamage > 0 && (
                <div className="flex justify-between mb-2">
                    <span className="text-theme-text-secondary">
                        Secondary (stat-based, incl. in Direct):
                    </span>
                    <span>{simResult.summary.totalSecondaryDamage.toLocaleString()}</span>
                </div>
            )}
            {simResult.summary.totalConditionalDamage > 0 && (
                <div className="flex justify-between mb-2">
                    <span className="text-theme-text-secondary">
                        Conditional (scaling, incl. in Direct):
                    </span>
                    <span>{simResult.summary.totalConditionalDamage.toLocaleString()}</span>
                </div>
            )}
            {hasDoTs && (
                <div className="grid grid-cols-4 gap-1 mt-2">
                    <div className="text-center p-1 bg-dark-lighter rounded">
                        <div className="text-xs text-theme-text-secondary">Direct</div>
                        <div className="text-xs">
                            {simResult.summary.totalDirectDamage.toLocaleString()}
                        </div>
                    </div>
                    <div className="text-center p-1 bg-dark-lighter rounded">
                        <div className="text-xs text-green-400">Corrosion</div>
                        <div className="text-xs text-green-400">
                            {simResult.summary.totalCorrosionDamage.toLocaleString()}
                        </div>
                    </div>
                    <div className="text-center p-1 bg-dark-lighter rounded">
                        <div className="text-xs text-orange-400">Inferno</div>
                        <div className="text-xs text-orange-400">
                            {simResult.summary.totalInfernoDamage.toLocaleString()}
                        </div>
                    </div>
                    <div className="text-center p-1 bg-dark-lighter rounded">
                        <div className="text-xs text-red-400">Detonation</div>
                        <div className="text-xs text-red-400">
                            {simResult.summary.totalDetonationDamage.toLocaleString()}
                        </div>
                    </div>
                </div>
            )}
            {isBest && isComparing && (
                <div className="text-sm mt-2 text-center">
                    <span className="text-primary">Best ship configuration</span>
                    {bestVsSecondLabel && (
                        <span className={`${bestVsSecondLabelColorClass(bestVsSecondLabel)} ml-2`}>
                            {bestVsSecondLabel}
                        </span>
                    )}
                </div>
            )}
            {comparedToBestPercentage !== null && (
                <div className="flex justify-between mt-2">
                    <span className="text-theme-text-secondary">Compared to best:</span>
                    <span className={comparedToBestColorClass(comparedToBestPercentage)}>
                        {formatComparedToBestPercentage(comparedToBestPercentage)}
                    </span>
                </div>
            )}
        </div>
    );
};
