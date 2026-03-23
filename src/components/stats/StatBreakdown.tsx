import React from 'react';
import { StatBreakdown as StatBreakdownType } from '../../utils/ship/statsCalculator';
import { BaseStats } from '../../types/stats';
import { STATS } from '../../constants/stats';

interface Props {
    breakdown: StatBreakdownType;
}

const calculateDiff = (current: BaseStats, previous: BaseStats): Partial<BaseStats> => {
    const diff: Partial<BaseStats> = {};
    Object.keys(current).forEach((key) => {
        const typedKey = key as keyof BaseStats;
        const currentValue = current[typedKey] || 0;
        const previousValue = previous[typedKey] || 0;
        const difference = currentValue - previousValue;
        if (difference !== 0) {
            diff[typedKey] = difference;
        }
    });
    return diff;
};

const formatValue = (value: number): string => {
    value = Math.round(value);
    if (value > 0) return `+${value}`;
    return value.toString();
};

export const StatBreakdown: React.FC<Props> = ({ breakdown }) => {
    // Order based on BaseStats interface
    const orderedStatNames: (keyof BaseStats)[] = [
        'hp',
        'attack',
        'defence',
        'hacking',
        'security',
        'crit',
        'critDamage',
        'speed',
        'healModifier',
        'shield',
        'shieldPenetration',
        'defensePenetration',
        'damageReduction',
    ];

    const refitDiff = calculateDiff(breakdown.afterRefits, breakdown.base);
    const engineeringDiff = calculateDiff(breakdown.afterEngineering, breakdown.afterRefits);
    const gearDiff = calculateDiff(breakdown.afterGear, breakdown.afterEngineering);
    const setsDiff = calculateDiff(breakdown.afterSets, breakdown.afterGear);
    const implantDiff = calculateDiff(breakdown.final, breakdown.afterSets);

    return (
        <div className="pb-4">
            <table className="w-full text-xs table-auto">
                <thead>
                    <tr className="border-b border-dark-border text-left">
                        <th className="font-bold p-1 border-r border-dark-border">Stat</th>
                        <th className="font-bold p-1">Base</th>
                        <th className="font-bold p-1">Refits</th>
                        <th className="font-bold p-1 border-r border-dark-border">Eng.</th>
                        <th className="font-bold p-1">Gear</th>
                        <th className="font-bold p-1">Sets</th>
                        <th className="font-bold p-1">Impl.</th>
                        <th className="font-bold p-1 border-l border-dark-border">Final</th>
                    </tr>
                </thead>
                <tbody>
                    {orderedStatNames.map((statName) => {
                        if (statName === 'hpRegen') return null;

                        const baseValue = breakdown.base[statName] || 0;
                        const refitValue = refitDiff[statName];
                        const engineeringValue = engineeringDiff[statName];
                        const gearValue = gearDiff[statName];
                        const setsValue = setsDiff[statName];
                        const implantValue = implantDiff[statName];
                        const finalValue = breakdown.final[statName];

                        if (
                            !baseValue &&
                            !refitValue &&
                            !engineeringValue &&
                            !gearValue &&
                            !setsValue &&
                            !implantValue &&
                            !finalValue
                        ) {
                            return null;
                        }

                        return (
                            <tr
                                key={statName}
                                className={`${statName !== 'speed' ? 'border-b border-dark-border' : ''}`}
                            >
                                <td className="p-1 border-r border-dark-border">
                                    {STATS[statName].shortLabel}
                                </td>
                                <td className="p-1 text-theme-text-secondary">
                                    {baseValue || '-'}
                                </td>
                                <td
                                    className={`p-1 ${refitValue ? 'text-yellow-400' : 'text-theme-text-secondary'}`}
                                >
                                    {refitValue ? formatValue(refitValue) : '-'}
                                </td>
                                <td
                                    className={`p-1 border-r border-dark-border ${engineeringValue ? 'text-blue-400' : 'text-theme-text-secondary'}`}
                                >
                                    {engineeringValue ? formatValue(engineeringValue) : '-'}
                                </td>
                                <td
                                    className={`p-1 ${gearValue ? 'text-green-400' : 'text-theme-text-secondary'}`}
                                >
                                    {gearValue ? formatValue(gearValue) : '-'}
                                </td>
                                <td
                                    className={`p-1 ${setsValue ? 'text-emerald-400' : 'text-theme-text-secondary'}`}
                                >
                                    {setsValue ? formatValue(setsValue) : '-'}
                                </td>
                                <td
                                    className={`p-1 ${implantValue ? 'text-purple-400' : 'text-theme-text-secondary'}`}
                                >
                                    {implantValue ? formatValue(implantValue) : '-'}
                                </td>
                                <td className={`p-1 border-l border-dark-border`}>
                                    {finalValue ? Math.round(finalValue) : '-'}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
};
