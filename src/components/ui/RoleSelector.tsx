import React from 'react';
import { SHIP_TYPES, ShipTypeName } from '../../constants';
import { Select } from './Select';

interface RoleSelectorProps {
    value: ShipTypeName | '';
    onChange: (role: ShipTypeName) => void;
    label?: string;
    className?: string;
    disabled?: boolean;
    noDefaultSelection?: boolean;
    defaultOption?: string;
    baseRolesOnly?: boolean;
}

// Group roles by base role with subtypes indented
const ROLE_OPTIONS: { value: ShipTypeName; label: string }[] = [
    // Attacker
    { value: 'ATTACKER', label: SHIP_TYPES.ATTACKER.name },
    // Defender
    { value: 'DEFENDER', label: SHIP_TYPES.DEFENDER.name },
    { value: 'DEFENDER_SECURITY', label: `  └ ${SHIP_TYPES.DEFENDER_SECURITY.name}` },
    // Debuffer
    { value: 'DEBUFFER', label: SHIP_TYPES.DEBUFFER.name },
    { value: 'DEBUFFER_DEFENSIVE', label: `  └ ${SHIP_TYPES.DEBUFFER_DEFENSIVE.name}` },
    {
        value: 'DEBUFFER_DEFENSIVE_SECURITY',
        label: `  └ ${SHIP_TYPES.DEBUFFER_DEFENSIVE_SECURITY.name}`,
    },
    { value: 'DEBUFFER_BOMBER', label: `  └ ${SHIP_TYPES.DEBUFFER_BOMBER.name}` },
    { value: 'DEBUFFER_CORROSION', label: `  └ ${SHIP_TYPES.DEBUFFER_CORROSION.name}` },
    // Supporter
    { value: 'SUPPORTER', label: SHIP_TYPES.SUPPORTER.name },
    { value: 'SUPPORTER_BUFFER', label: `  └ ${SHIP_TYPES.SUPPORTER_BUFFER.name}` },
    { value: 'SUPPORTER_OFFENSIVE', label: `  └ ${SHIP_TYPES.SUPPORTER_OFFENSIVE.name}` },
    { value: 'SUPPORTER_SHIELD', label: `  └ ${SHIP_TYPES.SUPPORTER_SHIELD.name}` },
];

const BASE_ROLE_OPTIONS: { value: ShipTypeName; label: string }[] = [
    { value: 'ATTACKER', label: SHIP_TYPES.ATTACKER.name },
    { value: 'DEFENDER', label: SHIP_TYPES.DEFENDER.name },
    { value: 'DEBUFFER', label: SHIP_TYPES.DEBUFFER.name },
    { value: 'SUPPORTER', label: SHIP_TYPES.SUPPORTER.name },
];

export const RoleSelector: React.FC<RoleSelectorProps> = ({
    value,
    onChange,
    label = 'Role',
    className = '',
    disabled = false,
    noDefaultSelection = true,
    defaultOption = 'Select Role',
    baseRolesOnly = false,
}) => {
    return (
        <Select
            label={label}
            value={value}
            onChange={(val) => onChange(val)}
            options={baseRolesOnly ? BASE_ROLE_OPTIONS : ROLE_OPTIONS}
            className={className}
            disabled={disabled}
            noDefaultSelection={noDefaultSelection}
            defaultOption={defaultOption}
        />
    );
};
