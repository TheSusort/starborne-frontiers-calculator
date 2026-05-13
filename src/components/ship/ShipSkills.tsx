import React from 'react';
import { Ship } from '../../types/ship';
import { getShipSkillRows } from '../../utils/ship/skillRows';
import { ShipSkillList } from './ShipSkillList';

interface ShipSkillsProps {
    ship: Ship;
}

export const ShipSkills: React.FC<ShipSkillsProps> = ({ ship }) => {
    if (getShipSkillRows(ship).length === 0) return null;

    return (
        // TODO: wire up tutorial data-tutorial attribute when tutorial system is extended
        <div className="card space-y-4">
            <h3 className="mb-4">Skills</h3>
            <ShipSkillList ship={ship} />
        </div>
    );
};
