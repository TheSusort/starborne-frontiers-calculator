import React from 'react';
import { Ship } from '../../types/ship';
import { SkillTooltip } from './SkillTooltip';

interface ShipSkillsProps {
    ship: Ship;
}

interface SkillRow {
    label: string;
    text: string;
    charge?: number;
}

export const ShipSkills: React.FC<ShipSkillsProps> = ({ ship }) => {
    const rows: SkillRow[] = [
        { label: 'Active', text: ship.activeSkillText ?? '' },
        {
            label: ship.chargeSkillCharge ? `Charge (${ship.chargeSkillCharge}T)` : 'Charge',
            text: ship.chargeSkillText ?? '',
            charge: ship.chargeSkillCharge,
        },
        { label: 'Passive R1', text: ship.firstPassiveSkillText ?? '' },
        { label: 'Passive R2', text: ship.secondPassiveSkillText ?? '' },
        { label: 'Passive R4', text: ship.thirdPassiveSkillText ?? '' },
    ].filter((row) => row.text.length > 0);

    if (rows.length === 0) return null;

    return (
        // TODO: wire up tutorial data-tutorial attribute when tutorial system is extended
        <div className="card space-y-4">
            <h3 className="mb-4">Skills</h3>
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
