import React from 'react';
import { Ship } from '../../types/ship';
import { getShipSkillRows } from '../../utils/ship/skillRows';
import { SkillTooltip } from './SkillTooltip';

export const ShipSkillList: React.FC<{ ship: Ship }> = ({ ship }) => {
    const rows = getShipSkillRows(ship);
    if (rows.length === 0) return null;

    return (
        <div className="space-y-3">
            {rows.map((row) => (
                <div key={row.label}>
                    <SkillTooltip
                        inline
                        skillText={row.text}
                        skillType={row.label}
                        charge={row.charge}
                    />
                </div>
            ))}
        </div>
    );
};
