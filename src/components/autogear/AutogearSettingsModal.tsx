import React from 'react';
import { Modal } from '../ui/layout/Modal';
import { Ship } from '../../types/ship';
import { StatPriority, SetPriority, StatBonus } from '../../types/autogear';
import { AutogearAlgorithm } from '../../utils/autogear/AutogearStrategy';
import { ShipTypeName } from '../../constants';
import { ArenaSeason } from '../../types/arena';
import { AutogearSettings } from './AutogearSettings';

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
    includeCalibratedGear: boolean;
    onShipSelect: (ship: Ship) => void;
    onRoleSelect: (role: ShipTypeName) => void;
    onAlgorithmSelect: (algorithm: AutogearAlgorithm) => void;
    onAddPriority: (priority: StatPriority) => void;
    onUpdatePriority: (index: number, priority: StatPriority) => void;
    onRemovePriority: (index: number) => void;
    onMovePriority: (fromIndex: number, toIndex: number) => void;
    onFindOptimalGear: () => void;
    onIgnoreEquippedChange: (value: boolean) => void;
    onIgnoreUnleveledChange: (value: boolean) => void;
    onToggleSecondaryRequirements: (value: boolean) => void;
    onAddSetPriority: (priority: SetPriority) => void;
    onUpdateSetPriority: (index: number, priority: SetPriority) => void;
    onRemoveSetPriority: (index: number) => void;
    onMoveSetPriority: (fromIndex: number, toIndex: number) => void;
    onAddStatBonus: (bonus: StatBonus) => void;
    onUpdateStatBonus: (index: number, bonus: StatBonus) => void;
    onRemoveStatBonus: (index: number) => void;
    onMoveStatBonus: (fromIndex: number, toIndex: number) => void;
    onUseUpgradedStatsChange: (value: boolean) => void;
    onTryToCompleteSetsChange: (value: boolean) => void;
    onOptimizeImplantsChange: (value: boolean) => void;
    onIncludeCalibratedGearChange: (value: boolean) => void;
    onResetConfig: () => void;
    activeSeason?: ArenaSeason | null;
    useArenaModifiers?: boolean;
    onUseArenaModifiersChange?: (value: boolean) => void;
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
        >
            <AutogearSettings {...settingsProps} onFindOptimalGear={handleFindOptimalGear} />
        </Modal>
    );
};
