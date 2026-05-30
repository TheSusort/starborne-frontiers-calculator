import React from 'react';
import { DPSShipConfig, AttackerBuffTotals } from '../../types/calculator';
import { DPSSimulationResult } from '../../utils/calculators/dpsSimulator';
import { calculateCritMultiplier } from '../../utils/autogear/scoring';

interface ShipConfigSummaryProps {
    config: DPSShipConfig;
    simResult: DPSSimulationResult;
    isBest: boolean;
    isComparing: boolean;
    rounds: number;
    attackerBuffTotals: AttackerBuffTotals;
    bestTotalDamage: number | undefined;
    bestVsSecondPercentage: number | null;
}

export const ShipConfigSummary: React.FC<ShipConfigSummaryProps> = ({
    config,
    simResult,
    isBest,
    isComparing,
    rounds,
    attackerBuffTotals,
    bestTotalDamage,
    bestVsSecondPercentage,
}) => {
    const hasDoTs =
        simResult.summary.totalCorrosionDamage > 0 ||
        simResult.summary.totalInfernoDamage > 0 ||
        simResult.summary.totalBombDamage > 0;

    const critMultiplier = calculateCritMultiplier({
        attack: config.attack * (1 + attackerBuffTotals.attackBuff / 100),
        crit: Math.min(100, config.crit + attackerBuffTotals.critBuff),
        critDamage: config.critDamage + attackerBuffTotals.critDamageBuff,
        hp: 0,
        defence: 0,
        hacking: 0,
        security: 0,
        speed: 0,
        healModifier: 0,
    });

    const comparedToBestPercentage =
        bestTotalDamage !== undefined && bestTotalDamage !== 0 && !isBest
            ? ((simResult.summary.totalDamage - bestTotalDamage) / bestTotalDamage) * 100
            : null;

    return (
        <div className="mt-4 pt-4 border-t border-dark-border">
            <div className="flex justify-between mb-2">
                <span className="text-theme-text-secondary">Crit Multiplier:</span>
                <span>{critMultiplier.toFixed(2)}x</span>
            </div>
            <div className="flex justify-between mb-2">
                <span className="text-theme-text-secondary">Avg Damage / Round:</span>
                <span className={isBest ? 'text-primary font-bold' : ''}>
                    {simResult.summary.avgDamagePerRound.toLocaleString()}
                </span>
            </div>
            <div className="flex justify-between mb-2">
                <span className="text-theme-text-secondary">Total Damage ({rounds} rounds):</span>
                <span className={isBest ? 'text-primary font-bold' : ''}>
                    {simResult.summary.totalDamage.toLocaleString()}
                </span>
            </div>
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
                        <div className="text-xs text-red-400">Bomb</div>
                        <div className="text-xs text-red-400">
                            {simResult.summary.totalBombDamage.toLocaleString()}
                        </div>
                    </div>
                </div>
            )}
            {isBest && isComparing && (
                <div className="text-sm mt-2 text-center">
                    <span className="text-primary">Best ship configuration</span>
                    {bestVsSecondPercentage !== null && (
                        <span className="text-green-500 ml-2">
                            +{bestVsSecondPercentage.toFixed(2)}% vs #2
                        </span>
                    )}
                </div>
            )}
            {comparedToBestPercentage !== null && (
                <div className="flex justify-between mt-2">
                    <span className="text-theme-text-secondary">Compared to best:</span>
                    <span className="text-red-500">{comparedToBestPercentage.toFixed(2)}%</span>
                </div>
            )}
        </div>
    );
};
