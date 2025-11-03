import React from 'react';
import { StatPriority, SetPriority, StatBonus } from '../../types/autogear';
import { GEAR_SETS, ShipTypeName } from '../../constants';
import { SHIP_TYPES } from '../../constants/shipTypes';
import { STATS } from '../../constants/stats';
import { StatName } from '../../types/stats';

interface AutogearConfigListProps {
    shipRole: ShipTypeName | null;
    statPriorities: StatPriority[];
    setPriorities: SetPriority[];
    statBonuses: StatBonus[];
    ignoreEquipped: boolean;
    ignoreUnleveled: boolean;
    useUpgradedStats: boolean;
    tryToCompleteSets: boolean;
    optimizeImplants: boolean;
}

export const AutogearConfigList: React.FC<AutogearConfigListProps> = ({
    shipRole,
    statPriorities,
    setPriorities,
    statBonuses,
    ignoreEquipped,
    ignoreUnleveled,
    useUpgradedStats,
    tryToCompleteSets,
    optimizeImplants,
}) => {
    const hasConfig =
        statPriorities.length > 0 ||
        setPriorities.length > 0 ||
        statBonuses.length > 0 ||
        optimizeImplants ||
        ignoreEquipped ||
        ignoreUnleveled ||
        useUpgradedStats ||
        tryToCompleteSets;

    if (!hasConfig) {
        return <div className="text-xs text-gray-400 px-2 py-1">No configuration set</div>;
    }

    return (
        <div className="text-xs px-2 py-1 text-gray-400 me-auto ms-3">
            {/* Ship Role */}
            {shipRole && (
                <div className="flex items-center text-white">
                    <span className="">{SHIP_TYPES[shipRole]?.name || shipRole}</span>
                </div>
            )}

            <div className="flex flex-wrap gap-1 divide-x-2 divide-gray-500 *:ps-1 ms-[-0.25rem]">
                {/* Settings */}
                {optimizeImplants && <span>Include implants</span>}
                {ignoreEquipped && <span>Ignore equipped</span>}
                {ignoreUnleveled && <span>Ignore unleveled</span>}
                {useUpgradedStats && <span>Use upgraded</span>}
                {tryToCompleteSets && <span>Complete sets</span>}

                {/* Stat Priorities */}
                {statPriorities.length > 0 && (
                    <>
                        {statPriorities.slice(0, 3).map((priority, index) => (
                            <span key={index}>
                                {priority.weight && priority.weight !== 1 && (
                                    <span>({priority.weight}x)</span>
                                )}
                                {priority.minLimit && <span>{'min ' + priority.minLimit}</span>}
                                {priority.maxLimit && (
                                    <span>{'max ' + priority.maxLimit}</span>
                                )}{' '}
                                {STATS[priority.stat]?.label || priority.stat}
                            </span>
                        ))}
                        {statPriorities.length > 3 && (
                            <span>+{statPriorities.length - 3} more</span>
                        )}
                    </>
                )}

                {/* Set Priorities */}
                {setPriorities.length > 0 && (
                    <>
                        {setPriorities.slice(0, 2).map((setPriority, index) => (
                            <span key={index}>
                                {setPriority.count} x {GEAR_SETS[setPriority.setName]?.name}
                            </span>
                        ))}
                        {setPriorities.length > 2 && <span>+{setPriorities.length - 2} more</span>}
                    </>
                )}

                {/* Stat Bonuses */}
                {statBonuses.length > 0 && (
                    <>
                        {statBonuses.slice(0, 2).map((bonus, index) => (
                            <span key={index}>
                                {STATS[bonus.stat as StatName]?.label} +{bonus.percentage}%
                            </span>
                        ))}
                        {statBonuses.length > 2 && <span>+{statBonuses.length - 2} more</span>}
                    </>
                )}
            </div>
        </div>
    );
};
