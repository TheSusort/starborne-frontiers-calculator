import React from 'react';
import { Ship } from '../../types/ship';
import { getShipSkillRows } from '../../utils/ship/skillRows';
import { parseShipTargeting } from '../../utils/targetingParser';
import { SkillTooltip } from './SkillTooltip';

export const ShipSkillList: React.FC<{ ship: Ship }> = ({ ship }) => {
    const rows = getShipSkillRows(ship);
    if (rows.length === 0) return null;

    const targeting = parseShipTargeting(ship);

    return (
        <div className="space-y-3">
            {rows.map((row) => (
                <div key={row.label}>
                    <SkillTooltip
                        inline
                        skillText={row.text}
                        skillType={row.label}
                        charge={row.charge}
                        targeting={
                            row.label === 'Active'
                                ? targeting.active
                                : row.label === 'Charge'
                                  ? targeting.charged
                                  : undefined
                        }
                    />
                </div>
            ))}
        </div>
    );
};
