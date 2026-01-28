import React, { useState, useMemo, useEffect } from 'react';
import { GearPiece } from '../../types/gear';
import { Ship } from '../../types/ship';
import { useShips } from '../../contexts/ShipsContext';
import { useInventory } from '../../contexts/InventoryProvider';
import { useEngineeringStats } from '../../hooks/useEngineeringStats';
import { Button, Input, Modal } from '../ui';
import { ShipDisplay } from '../ship/ShipDisplay';
import { GearPieceDisplay } from './GearPieceDisplay';
import { StatList } from '../stats/StatList';
import { RARITY_ORDER } from '../../constants';
import { isCalibrationEligible } from '../../utils/gear/calibrationCalculator';
import { calculateTotalStats } from '../../utils/ship/statsCalculator';

interface CalibrationModalProps {
    isOpen: boolean;
    onClose: () => void;
    gear: GearPiece | null;
    onConfirm: (gearId: string, shipId: string) => void;
    initialShipId?: string | null;
}

export const CalibrationModal: React.FC<CalibrationModalProps> = ({
    isOpen,
    onClose,
    gear,
    onConfirm,
    initialShipId,
}) => {
    const { ships, getShipById } = useShips();
    const { getGearPiece } = useInventory();
    const { getEngineeringStatsForShipType } = useEngineeringStats();
    const [search, setSearch] = useState('');
    const [selectedShip, setSelectedShip] = useState<Ship | null>(null);

    // Pre-select ship from initialShipId when modal opens
    useEffect(() => {
        if (isOpen && initialShipId) {
            const ship = getShipById(initialShipId);
            if (ship) {
                setSelectedShip(ship);
            }
        }
    }, [isOpen, initialShipId, getShipById]);

    // Get the currently calibrated ship if gear is already calibrated
    const calibratedShip = useMemo(() => {
        if (gear?.calibration?.shipId) {
            return getShipById(gear.calibration.shipId);
        }
        return null;
    }, [gear?.calibration?.shipId, getShipById]);

    // Calculate current and potential stats for the selected ship
    const { currentStats, calibratedStats } = useMemo(() => {
        if (!selectedShip || !gear) {
            return { currentStats: null, calibratedStats: null };
        }

        // Create a gear getter that returns gear WITHOUT calibration for this piece
        // (to show "before" stats)
        const getCurrentGearPiece = (id: string) => {
            if (id === gear.id) {
                // Return gear without calibration to this ship
                return {
                    ...gear,
                    calibration: undefined,
                };
            }
            return getGearPiece(id);
        };

        // Create a gear getter that returns gear WITH calibration flag set
        // (calculateTotalStats will apply the actual stat bonus)
        const getCalibratedGearPiece = (id: string) => {
            if (id === gear.id) {
                // Just set the calibration flag - don't pre-apply stats
                // calculateTotalStats will handle applying the calibration bonus
                return {
                    ...gear,
                    calibration: { shipId: selectedShip.id },
                };
            }
            return getGearPiece(id);
        };

        // Build equipment that includes this gear piece in its slot
        const equipmentWithGear = {
            ...selectedShip.equipment,
            [gear.slot]: gear.id,
        };

        const engineeringStats = getEngineeringStatsForShipType(selectedShip.type);

        // Calculate current stats (without calibration bonus for this gear)
        const current = calculateTotalStats(
            selectedShip.baseStats,
            equipmentWithGear,
            getCurrentGearPiece,
            selectedShip.refits,
            selectedShip.implants,
            engineeringStats,
            selectedShip.id
        );

        // Calculate calibrated stats (with calibration bonus for this gear)
        const calibrated = calculateTotalStats(
            selectedShip.baseStats,
            equipmentWithGear,
            getCalibratedGearPiece,
            selectedShip.refits,
            selectedShip.implants,
            engineeringStats,
            selectedShip.id
        );

        return { currentStats: current.final, calibratedStats: calibrated.final };
    }, [selectedShip, gear, getGearPiece, getEngineeringStatsForShipType]);

    // Filter and sort ships
    const filteredShips: Ship[] = useMemo(() => {
        return ships
            .filter((ship) => ship.name.toLowerCase().includes(search.toLowerCase()))
            .sort((a, b) => {
                // First sort by rarity
                const rarityComparison =
                    RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity);
                if (rarityComparison !== 0) return rarityComparison;

                // If rarities are equal, sort by name
                return a.name.localeCompare(b.name);
            });
    }, [ships, search]);

    const handleConfirm = () => {
        if (gear && selectedShip) {
            onConfirm(gear.id, selectedShip.id);
            setSelectedShip(null);
            setSearch('');
            onClose();
        }
    };

    const handleClose = () => {
        setSelectedShip(null);
        setSearch('');
        onClose();
    };

    if (!gear) return null;

    const isEligible = isCalibrationEligible(gear);

    return (
        <Modal
            isOpen={isOpen}
            onClose={handleClose}
            title={gear.calibration ? 'Recalibrate Gear' : 'Calibrate Gear'}
            fullHeight
        >
            <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Gear Preview */}
                    <div className="space-y-2">
                        <h4 className="text-sm font-medium">Selected Gear</h4>
                        <div className="max-w-sm">
                            <GearPieceDisplay
                                gear={gear}
                                mode="manage"
                                showDetails
                                showCalibratedPreview={isEligible}
                            />
                        </div>
                    </div>
                    <div className="space-y-2">
                        {/* Eligibility Check */}
                        {!isEligible && (
                            <div className="bg-red-900/30 border border-red-700 p-4 rounded">
                                <p className="text-red-400">
                                    This gear is not eligible for calibration. Requirements:
                                </p>
                                <ul className="list-disc list-inside text-sm text-red-300 mt-2">
                                    <li>Level 16 (current: {gear.level})</li>
                                    <li>5 or 6 stars (current: {gear.stars})</li>
                                </ul>
                            </div>
                        )}

                        {/* Potential Stats Preview - shown when ship is selected */}
                        {isEligible && selectedShip && calibratedStats && currentStats && (
                            <>
                                <h4 className="text-sm font-medium mb-2">
                                    Potential Stats on {selectedShip.name}
                                </h4>
                                <div className="card">
                                    <StatList
                                        stats={calibratedStats}
                                        comparisonStats={currentStats}
                                        className="text-sm"
                                    />
                                </div>
                            </>
                        )}

                        {/* Hint to select a ship */}
                        {isEligible && !selectedShip && (
                            <div className="bg-gray-800/50 border border-gray-700 p-4 rounded">
                                <p className="text-sm text-gray-400">
                                    Select a ship below to see the potential stat improvements.
                                </p>
                            </div>
                        )}

                        {/* Current Calibration */}
                        {calibratedShip && (
                            <div className="bg-yellow-900/30 border border-yellow-700 p-4 rounded">
                                <h4 className="text-sm font-medium text-yellow-400 mb-2">
                                    Currently Calibrated To
                                </h4>
                                <ShipDisplay ship={calibratedShip} variant="compact" />
                                <p className="text-xs text-yellow-300 mt-2">
                                    Recalibrating will change the calibration to a new ship.
                                </p>
                            </div>
                        )}

                        {/* Warning */}
                        {isEligible && (
                            <div className="bg-yellow-900/20 border border-yellow-700/50 p-3 rounded text-sm text-yellow-400">
                                ⚠️ Once calibrated, the bonus stats only apply when this gear is
                                equipped on the selected ship.
                            </div>
                        )}
                    </div>
                </div>

                {/* Ship Selection */}
                {isEligible && (
                    <div className="space-y-4">
                        <h4 className="text-sm font-medium text-gray-400">
                            Select Ship to Calibrate For
                        </h4>

                        {selectedShip ? (
                            <div className="space-y-2">
                                <ShipDisplay
                                    ship={selectedShip}
                                    variant="compact"
                                    onClick={() => setSelectedShip(null)}
                                />
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => setSelectedShip(null)}
                                >
                                    Change Ship
                                </Button>
                            </div>
                        ) : (
                            <>
                                <Input
                                    placeholder="Search ships..."
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                    autoFocus
                                />

                                <div className="grid grid-cols-2 md:grid-cols-3 gap-2 max-h-[300px] overflow-y-auto">
                                    {filteredShips.length === 0 && (
                                        <p className="text-gray-400 col-span-full text-center py-4">
                                            No ships found
                                        </p>
                                    )}
                                    {filteredShips.map((shipItem: Ship) => (
                                        <ShipDisplay
                                            key={shipItem.id}
                                            ship={shipItem}
                                            variant="compact"
                                            onClick={() => setSelectedShip(shipItem)}
                                        />
                                    ))}
                                </div>
                            </>
                        )}
                    </div>
                )}

                {/* Actions */}
                <div className="flex justify-end gap-4 pt-4 border-t border-gray-700">
                    <Button variant="secondary" onClick={handleClose}>
                        Cancel
                    </Button>
                    <Button
                        variant="primary"
                        onClick={handleConfirm}
                        disabled={!isEligible || !selectedShip}
                    >
                        {gear.calibration ? 'Recalibrate' : 'Calibrate'}
                    </Button>
                </div>
            </div>
        </Modal>
    );
};
