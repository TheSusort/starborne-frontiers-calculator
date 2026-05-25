import React from 'react';
import { StatPriority, SetPriority, StatBonus, FleetBuff } from '../../types/autogear';
import { GEAR_SETS, ShipTypeName } from '../../constants';
import { IMPLANTS } from '../../constants/implants';
import { SHIP_TYPES } from '../../constants/shipTypes';
import { STATS } from '../../constants/stats';
import { StatName } from '../../types/stats';

interface AutogearConfigListProps {
    shipRole: ShipTypeName | null;
    statPriorities: StatPriority[];
    setPriorities: SetPriority[];
    statBonuses: StatBonus[];
    fleetBuffs?: FleetBuff[];
    ignoreEquipped: boolean;
    ignoreUnleveled: boolean;
    useUpgradedStats: boolean;
    tryToCompleteSets: boolean;
    optimizeImplants: boolean;
    excludedImplantTypes?: string[];
}

export const AutogearConfigList: React.FC<AutogearConfigListProps> = ({
    shipRole,
    statPriorities,
    setPriorities,
    statBonuses,
    fleetBuffs = [],
    ignoreEquipped,
    ignoreUnleveled,
    useUpgradedStats,
    tryToCompleteSets,
    optimizeImplants,
    excludedImplantTypes = [],
}) => {
    const hasConfig =
        statPriorities.length > 0 ||
        setPriorities.length > 0 ||
        statBonuses.length > 0 ||
        fleetBuffs.length > 0 ||
        (excludedImplantTypes?.length ?? 0) > 0 ||
        optimizeImplants ||
        ignoreEquipped ||
        ignoreUnleveled ||
        useUpgradedStats ||
        tryToCompleteSets;

    if (!hasConfig) {
        return (
            <div className="text-xs text-theme-text-secondary px-2 py-1">No configuration set</div>
        );
    }

    return (
        <div className="text-xs px-2 py-1 text-theme-text-secondary me-auto ms-3">
            {/* Ship Role */}
            {shipRole && (
                <div className="flex items-center text-white">
                    <span className="">{SHIP_TYPES[shipRole]?.name || shipRole}</span>
                </div>
            )}

            <div className="flex flex-wrap gap-1 divide-x-2 divide-dark-border *:ps-1 ms-[-0.25rem]">
                {/* Settings */}
                {optimizeImplants && <span>Include implants</span>}
                {ignoreEquipped && <span>Ignore equipped</span>}
                {ignoreUnleveled && <span>Ignore unleveled</span>}
                {useUpgradedStats && <span>Use upgraded</span>}
                {tryToCompleteSets && <span>Complete sets</span>}

                {/* Stat Priorities */}
                {statPriorities.length > 0 && (
                    <>
                        {statPriorities.map((priority, index) => (
                            <span key={index}>
                                {priority.weight && priority.weight !== 1 && (
                                    <span>({priority.weight}x)</span>
                                )}
                                {priority.minLimit && <span>{'min ' + priority.minLimit}</span>}
                                {priority.maxLimit && (
                                    <span>{'max ' + priority.maxLimit}</span>
                                )}{' '}
                                {STATS[priority.stat]?.label || priority.stat}
                                {priority.hardRequirement && <span> (strict)</span>}
                            </span>
                        ))}
                    </>
                )}

                {/* Set Priorities */}
                {setPriorities.length > 0 && (
                    <>
                        {setPriorities.map((setPriority, index) => (
                            <span key={index}>
                                {setPriority.kind === 'implant'
                                    ? (GEAR_SETS[setPriority.setName]?.name ??
                                      IMPLANTS[setPriority.setName]?.name ??
                                      setPriority.setName)
                                    : `${setPriority.count} x ${GEAR_SETS[setPriority.setName]?.name ?? setPriority.setName}`}
                            </span>
                        ))}
                    </>
                )}

                {/* Stat Bonuses */}
                {statBonuses.length > 0 && (
                    <>
                        {statBonuses.map((bonus, index) => (
                            <span key={index}>
                                {STATS[bonus.stat as StatName]?.label}{' '}
                                {bonus.mode === 'multiplier' ? '×' : '+'}
                                {bonus.percentage}%
                            </span>
                        ))}
                    </>
                )}

                {/* Fleet Buffs */}
                {fleetBuffs.length > 0 && (
                    <>
                        {fleetBuffs.map((buff, index) => (
                            <span key={index}>
                                {STATS[buff.stat]?.label} +{buff.percentage}%
                            </span>
                        ))}
                    </>
                )}

                {/* Excluded Implant Types */}
                {(excludedImplantTypes ?? []).map((key) => (
                    <span key={key}>Excl. {IMPLANTS[key]?.name ?? key}</span>
                ))}
            </div>
        </div>
    );
};
