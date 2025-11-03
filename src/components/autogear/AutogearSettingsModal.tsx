import React from 'react';
import { Modal } from '../ui/layout/Modal';
import { AutogearSettings } from './AutogearSettings';
import { Ship } from '../../types/ship';
import { StatPriority, SetPriority, StatBonus } from '../../types/autogear';
import { AutogearAlgorithm } from '../../utils/autogear/AutogearStrategy';
import { ShipTypeName } from '../../constants';

interface AutogearSettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    selectedShip: Ship | null;
    selectedShipRole: ShipTypeName | null;
    selectedAlgorithm: AutogearAlgorithm;
    priorities: StatPriority[];
    ignoreEquipped: boolean;
    ignoreUnleveled: boolean;
    showSecondaryRequirements: boolean;
    setPriorities: SetPriority[];
    statBonuses: StatBonus[];
    useUpgradedStats: boolean;
    tryToCompleteSets: boolean;
    optimizeImplants: boolean;
    onShipSelect: (ship: Ship) => void;
    onRoleSelect: (role: ShipTypeName) => void;
    onAlgorithmSelect: (algorithm: AutogearAlgorithm) => void;
    onAddPriority: (priority: StatPriority) => void;
    onRemovePriority: (index: number) => void;
    onFindOptimalGear: () => void;
    onIgnoreEquippedChange: (value: boolean) => void;
    onIgnoreUnleveledChange: (value: boolean) => void;
    onToggleSecondaryRequirements: (value: boolean) => void;
    onAddSetPriority: (priority: SetPriority) => void;
    onRemoveSetPriority: (index: number) => void;
    onAddStatBonus: (bonus: StatBonus) => void;
    onRemoveStatBonus: (index: number) => void;
    onUseUpgradedStatsChange: (value: boolean) => void;
    onTryToCompleteSetsChange: (value: boolean) => void;
    onOptimizeImplantsChange: (value: boolean) => void;
    onResetConfig: () => void;
}

export const AutogearSettingsModal: React.FC<AutogearSettingsModalProps> = ({
    isOpen,
    onClose,
    ...settingsProps
}) => {
    const handleFindOptimalGear = () => {
        settingsProps.onFindOptimalGear();
        onClose();
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={`Autogear Settings for ${settingsProps.selectedShip?.name || 'Ship'}`}
            fullHeight={true}
        >
            <AutogearSettings {...settingsProps} onFindOptimalGear={handleFindOptimalGear} />
        </Modal>
    );
};
