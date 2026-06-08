import React from 'react';
import {
    HealingSimulationResult,
    HealingRoundData,
} from '../../utils/calculators/healingEngineAdapter';

interface HealerRoundOverviewProps {
    /** The config whose round timeline to surface (typically the best config). */
    result: HealingSimulationResult;
    /** Healer config name, shown in the header so it's clear which config this reflects. */
    name: string;
    /** Number of rounds simulated (rows are clamped to the available round data). */
    rounds: number;
}

/** A single labelled metric chip inside a round block. Hidden when value is zero. */
const Metric: React.FC<{ label: string; value: string; color?: string }> = ({
    label,
    value,
    color,
}) => (
    <div className="flex flex-col">
        <span className="text-[10px] uppercase tracking-wide text-theme-text-secondary">
            {label}
        </span>
        <span className="text-xs font-medium" style={color ? { color } : undefined}>
            {value}
        </span>
    </div>
);

const COLOR_DIRECT = '#60a5fa'; // blue — direct heal
const COLOR_HOT = '#34d399'; // emerald — heal over time
const COLOR_SHIELD = '#a78bfa'; // violet — shield granted
const COLOR_OVERHEAL = '#9ca3af'; // grey — wasted overheal
const COLOR_DAMAGE = '#f87171'; // red — incoming damage

/**
 * Per-round overview of the healer's output, mirroring the DPS round breakdown's structure
 * (a scrollable per-round list driven by the same simulation round data, reusing the page's
 * card/dark-theme visual language). Each round block surfaces the meaningful healer output:
 * direct heal, HoT, shield granted, effective vs overheal, cleanses, incoming damage and the
 * target HP% entering the round — plus charged/crit badges and team healing when present.
 *
 * Reflects the best (or selected) config; the header names the config so it's unambiguous.
 */
export const HealerRoundOverview: React.FC<HealerRoundOverviewProps> = ({
    result,
    name,
    rounds,
}) => {
    const count = Math.min(rounds, result.rounds.length);

    const isEmpty = (rd: HealingRoundData): boolean =>
        rd.directHeal === 0 &&
        rd.hotHeal === 0 &&
        rd.shield === 0 &&
        rd.cleanseCount === 0 &&
        rd.incomingDamage === 0 &&
        (rd.teamHealing ?? 0) === 0;

    return (
        <div className="card !p-0 overflow-hidden">
            <div className="bg-dark-lighter px-2.5 py-1.5 text-xs font-semibold text-theme-text-secondary uppercase tracking-wide">
                {name} — Healer Output by Round
            </div>
            <div className="max-h-72 overflow-y-auto">
                {Array.from({ length: count }, (_, i) => {
                    const rd = result.rounds[i];
                    return (
                        <div
                            key={rd.round}
                            data-round={rd.round}
                            className="px-2.5 py-2 border-b border-dark-border last:border-b-0"
                        >
                            <div className="flex items-center gap-2 mb-1.5">
                                <span className="text-xs font-semibold uppercase tracking-wide text-theme-text-secondary">
                                    Round {rd.round}
                                </span>
                                {rd.action === 'charged' && (
                                    <span className="text-[10px] text-yellow-400 uppercase tracking-wide">
                                        Charged
                                    </span>
                                )}
                                {rd.didCrit && (
                                    <span className="text-[10px] text-red-400 uppercase tracking-wide">
                                        Crit
                                    </span>
                                )}
                                <span className="ml-auto text-[10px] text-theme-text-secondary">
                                    Target HP {rd.targetHpPct}%
                                </span>
                            </div>
                            {isEmpty(rd) ? (
                                <p className="text-xs text-dark-border italic">
                                    No healer output this round
                                </p>
                            ) : (
                                <div className="grid grid-cols-3 gap-x-3 gap-y-1.5">
                                    {rd.directHeal > 0 && (
                                        <Metric
                                            label="Direct"
                                            value={rd.directHeal.toLocaleString()}
                                            color={COLOR_DIRECT}
                                        />
                                    )}
                                    {rd.hotHeal > 0 && (
                                        <Metric
                                            label="HoT"
                                            value={rd.hotHeal.toLocaleString()}
                                            color={COLOR_HOT}
                                        />
                                    )}
                                    {rd.shield > 0 && (
                                        <Metric
                                            label="Shield"
                                            value={rd.shield.toLocaleString()}
                                            color={COLOR_SHIELD}
                                        />
                                    )}
                                    {rd.effectiveHealing > 0 && (
                                        <Metric
                                            label="Effective"
                                            value={rd.effectiveHealing.toLocaleString()}
                                        />
                                    )}
                                    {rd.overheal > 0 && (
                                        <Metric
                                            label="Overheal"
                                            value={rd.overheal.toLocaleString()}
                                            color={COLOR_OVERHEAL}
                                        />
                                    )}
                                    {rd.cleanseCount > 0 && (
                                        <Metric label="Cleanses" value={`${rd.cleanseCount}`} />
                                    )}
                                    {rd.incomingDamage > 0 && (
                                        <Metric
                                            label="Incoming"
                                            value={rd.incomingDamage.toLocaleString()}
                                            color={COLOR_DAMAGE}
                                        />
                                    )}
                                    {(rd.teamHealing ?? 0) > 0 && (
                                        <Metric
                                            label="Team Heal"
                                            value={(rd.teamHealing ?? 0).toLocaleString()}
                                        />
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
