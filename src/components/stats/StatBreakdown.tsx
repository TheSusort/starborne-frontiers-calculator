import React from 'react';
import { StatBreakdown as StatBreakdownType } from '../../utils/statsCalculator';
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
    if (value > 0) return `+${value}`;
    return value.toString();
};

export const StatBreakdown: React.FC<Props> = ({ breakdown }) => {
    const allStats = new Set<keyof BaseStats>();
    [
        breakdown.base,
        breakdown.afterRefits,
        breakdown.afterEngineering,
        breakdown.afterGear,
        breakdown.afterSets,
        breakdown.final,
    ].forEach((stats) => {
        Object.keys(stats).forEach((key) => allStats.add(key as keyof BaseStats));
    });

    const refitDiff = calculateDiff(breakdown.afterRefits, breakdown.base);
    const engineeringDiff = calculateDiff(breakdown.afterEngineering, breakdown.afterRefits);
    const gearDiff = calculateDiff(breakdown.afterGear, breakdown.afterEngineering);
    const setsDiff = calculateDiff(breakdown.afterSets, breakdown.afterGear);
    const implantDiff = calculateDiff(breakdown.final, breakdown.afterSets);

    return (
        <div className="bg-dark-lighter p-4 border border-gray-600 shadow-lg">
            <table className="w-full text-sm table-auto text-gray-300">
                <thead>
                    <tr className="border-b border-gray-600">
                        <th className="font-bold p-1">Stat</th>
                        <th className="font-bold p-1">Base</th>
                        <th className="font-bold p-1">Refits</th>
                        <th className="font-bold p-1">Eng.</th>
                        <th className="font-bold p-1">Gear</th>
                        <th className="font-bold p-1">Sets</th>
                        <th className="font-bold p-1">Impl.</th>
                    </tr>
                </thead>
                <tbody>
                    {Array.from(allStats).map((statName) => {
                        const baseValue = breakdown.base[statName] || 0;
                        const refitValue = refitDiff[statName];
                        const engineeringValue = engineeringDiff[statName];
                        const gearValue = gearDiff[statName];
                        const setsValue = setsDiff[statName];
                        const implantValue = implantDiff[statName];

                        if (
                            !baseValue &&
                            !refitValue &&
                            !engineeringValue &&
                            !gearValue &&
                            !setsValue &&
                            !implantValue
                        ) {
                            return null;
                        }

                        return (
                            <tr key={statName} className="text-gray-300 border-b border-gray-600">
                                <td className="p-1">{STATS[statName].shortLabel}</td>
                                <td className="p-1">{baseValue || '-'}</td>
                                <td className={`p-1 ${refitValue ? 'text-yellow-400' : ''}`}>
                                    {refitValue ? formatValue(refitValue) : '-'}
                                </td>
                                <td className={`p-1 ${engineeringValue ? 'text-blue-400' : ''}`}>
                                    {engineeringValue ? formatValue(engineeringValue) : '-'}
                                </td>
                                <td className={`p-1 ${gearValue ? 'text-green-400' : ''}`}>
                                    {gearValue ? formatValue(gearValue) : '-'}
                                </td>
                                <td className={`p-1 ${setsValue ? 'text-emerald-400' : ''}`}>
                                    {setsValue ? formatValue(setsValue) : '-'}
                                </td>
                                <td className={`p-1 ${implantValue ? 'text-purple-400' : ''}`}>
                                    {implantValue ? formatValue(implantValue) : '-'}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
};
