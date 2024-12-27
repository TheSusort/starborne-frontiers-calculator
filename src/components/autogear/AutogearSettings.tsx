import React from 'react';
import { ShipSelector } from '../ship/ShipSelector';
import { StatPriorityForm } from '../stats/StatPriorityForm';
import { Button, Select, Checkbox } from '../ui';
import { AutogearAlgorithm, AUTOGEAR_STRATEGIES } from '../../utils/autogear/AutogearStrategy';
import { Ship } from '../../types/ship';
import { StatPriority } from '../../types/autogear';
import { SHIP_TYPES, ShipTypeName } from '../../constants';

interface AutogearSettingsProps {
  selectedShip: Ship | null;
  selectedShipRole: ShipTypeName | null;
  selectedAlgorithm: AutogearAlgorithm;
  priorities: StatPriority[];
  ignoreEquipped: boolean;
  onShipSelect: (ship: Ship) => void;
  onRoleSelect: (role: ShipTypeName) => void;
  onAlgorithmSelect: (algorithm: AutogearAlgorithm) => void;
  onAddPriority: (priority: StatPriority) => void;
  onRemovePriority: (index: number) => void;
  onFindOptimalGear: () => void;
  onIgnoreEquippedChange: (value: boolean) => void;
}

export const AutogearSettings: React.FC<AutogearSettingsProps> = ({
  selectedShip,
  selectedShipRole,
  selectedAlgorithm,
  priorities,
  ignoreEquipped,
  onShipSelect,
  onRoleSelect,
  onAlgorithmSelect,
  onAddPriority,
  onRemovePriority,
  onFindOptimalGear,
  onIgnoreEquippedChange,
}) => {
  return (
    <div className="space-y-4">
      <h3 className="text-xl font-bold text-gray-200">Settings</h3>
      <ShipSelector onSelect={onShipSelect} selected={selectedShip} />

      <div className="p-4 bg-dark space-y-2">
        <span className="text-gray-300 text-sm">Predefined Strategies (Experimental)</span>
        <Select
          options={Object.values(SHIP_TYPES).map((type) => ({
            value: type.name,
            label: `${type.name} (${type.description})`,
          }))}
          value={selectedShipRole || ''}
          onChange={(value) => onRoleSelect(value as ShipTypeName)}
          noDefaultSelection
          defaultOption="Manual"
        />
      </div>

      {(selectedShipRole === '' || selectedShipRole === null) && (
        <StatPriorityForm onAdd={onAddPriority} existingPriorities={priorities} />
      )}

      {priorities.length > 0 && (
        <div className="bg-dark p-4 rounded space-y-2 text-gray-200">
          <h3 className="text-lg font-semibold">Priority List</h3>
          {priorities.map((priority, index) => (
            <div key={index} className="flex justify-between items-center">
              <span>{index + 1}</span>
              <span>
                {priority.stat}
                {priority.maxLimit ? ` (Max: ${priority.maxLimit})` : ''}
              </span>
              <Button
                aria-label="Remove priority"
                variant="danger"
                onClick={() => onRemovePriority(index)}
              >
                Remove
              </Button>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-2 p-4 bg-dark">
        <span className="text-gray-300 text-sm">Algorithm</span>
        <Select
          options={Object.entries(AUTOGEAR_STRATEGIES).map(([key, { name }]) => ({
            value: key,
            label: name,
          }))}
          value={selectedAlgorithm}
          onChange={(value) => onAlgorithmSelect(value as AutogearAlgorithm)}
        />
        <p className="text-sm text-gray-400">
          {AUTOGEAR_STRATEGIES[selectedAlgorithm].description}
        </p>
      </div>

      <div className="p-4 bg-dark">
        <Checkbox
          label="Ignore currently equipped gear"
          checked={ignoreEquipped}
          onChange={(value) => onIgnoreEquippedChange(value)}
        />
        <p className="text-sm text-gray-400 mt-1">
          When checked, the algorithm will ignore gear that is currently equipped on other ships
        </p>
      </div>

      <Button
        aria-label="Find optimal gear"
        variant="primary"
        onClick={onFindOptimalGear}
        disabled={
          !selectedShip ||
          ((selectedShipRole === '' || selectedShipRole === null) && priorities.length === 0)
        }
        fullWidth
      >
        Find Optimal Gear
      </Button>
    </div>
  );
};
