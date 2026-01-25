import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShipSelector } from '../ship/ShipSelector';
import { Button } from '../ui';
import { Ship } from '../../types/ship';
import { CloseIcon, GearIcon, InfoIcon } from '../ui/icons';
import { AutogearConfigList } from './AutogearConfigList';
import { CommunityRecommendations } from './CommunityRecommendations';
import { StatPriority, SetPriority, StatBonus } from '../../types/autogear';
import { ShipTypeName } from '../../constants';
import { AutogearAlgorithm } from '../../utils/autogear/AutogearStrategy';

interface AutogearQuickSettingsProps {
    selectedShips: (Ship | null)[];
    onShipSelect: (ship: Ship, index: number) => void;
    onAddShip: () => void;
    onRemoveShip: (event: React.MouseEvent<HTMLButtonElement>, index: number) => void;
    onOpenSettings: (event: React.MouseEvent<HTMLButtonElement>, index: number) => void;
    onFindOptimalGear: () => void;
    getShipConfig: (shipId: string) => {
        shipRole: ShipTypeName | null;
        statPriorities: StatPriority[];
        setPriorities: SetPriority[];
        statBonuses: StatBonus[];
        ignoreEquipped: boolean;
        ignoreUnleveled: boolean;
        useUpgradedStats: boolean;
        tryToCompleteSets: boolean;
        selectedAlgorithm: AutogearAlgorithm;
        showSecondaryRequirements: boolean;
        optimizeImplants: boolean;
    };
}

export const AutogearQuickSettings: React.FC<AutogearQuickSettingsProps> = ({
    selectedShips,
    onShipSelect,
    onAddShip,
    onRemoveShip,
    onOpenSettings,
    onFindOptimalGear,
    getShipConfig,
}) => {
    const navigate = useNavigate();
    const [autoOpenIndex, setAutoOpenIndex] = useState<number | null>(null);

    const handleAddShip = () => {
        onAddShip();
        // Set the auto-open index to the newly added ship (last index)
        setAutoOpenIndex(selectedShips.length);
    };

    const handleShipSelect = (ship: Ship, index: number) => {
        onShipSelect(ship, index);
        // Clear the auto-open index after selection
        setAutoOpenIndex(null);
    };

    return (
        <div className="space-y-4 sticky top-2">
            <div className="flex justify-between items-center">
                <h3 className="text-xl font-bold">Autogear</h3>
                <div className="flex gap-2">
                    <Button variant="secondary" onClick={handleAddShip} className="text-sm">
                        Add Ship
                    </Button>
                </div>
            </div>

            <div className="space-y-3">
                {selectedShips.map((ship, index) => (
                    <div key={index} className="space-y-2">
                        <div className="flex gap-2 items-start">
                            <div className="flex-1">
                                <ShipSelector
                                    selected={ship || null}
                                    onSelect={(selectedShip) =>
                                        handleShipSelect(selectedShip, index)
                                    }
                                    autoOpen={autoOpenIndex === index}
                                >
                                    {ship && <AutogearConfigList {...getShipConfig(ship.id)} />}
                                    <div className="flex gap-2 items-center">
                                        {ship && (
                                            <Button
                                                variant="secondary"
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    navigate(`/ships/${ship.id}`, {
                                                        state: {
                                                            from: '/autogear',
                                                            shipId: ship.id,
                                                        },
                                                    });
                                                }}
                                                size="sm"
                                                className="flex gap-2 items-center"
                                                title="View ship details"
                                            >
                                                <InfoIcon />
                                            </Button>
                                        )}
                                        <Button
                                            variant="secondary"
                                            onClick={(event) => onOpenSettings(event, index)}
                                            size="sm"
                                            className="flex gap-2 items-center"
                                        >
                                            <GearIcon />
                                        </Button>
                                        <Button
                                            variant="danger"
                                            size="sm"
                                            onClick={(event) => onRemoveShip(event, index)}
                                        >
                                            <CloseIcon className="w-4 h-4" />
                                        </Button>
                                    </div>
                                </ShipSelector>
                            </div>
                        </div>
                        {/* Community Recommendations - show for every selected ship */}
                        {ship && (
                            <CommunityRecommendations
                                selectedShip={ship}
                                currentConfig={(() => {
                                    const config = getShipConfig(ship.id);
                                    if (!config.shipRole) return null;
                                    return {
                                        id: '',
                                        name: '',
                                        shipId: ship.id,
                                        shipRole: config.shipRole,
                                        statPriorities: config.statPriorities,
                                        setPriorities: config.setPriorities,
                                        statBonuses: config.statBonuses,
                                        ignoreEquipped: config.ignoreEquipped,
                                        ignoreUnleveled: config.ignoreUnleveled,
                                        useUpgradedStats: config.useUpgradedStats,
                                        tryToCompleteSets: config.tryToCompleteSets,
                                        algorithm: config.selectedAlgorithm,
                                        showSecondaryRequirements: config.showSecondaryRequirements,
                                        optimizeImplants: config.optimizeImplants,
                                    };
                                })()}
                            />
                        )}
                    </div>
                ))}
            </div>

            <div className="flex justify-end">
                <Button
                    onClick={onFindOptimalGear}
                    disabled={selectedShips.length === 0}
                    variant="primary"
                    className="w-full"
                >
                    Find Optimal Gear
                </Button>
            </div>
        </div>
    );
};
