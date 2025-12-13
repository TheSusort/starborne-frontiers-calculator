import React, { useState, useMemo } from 'react';
import { GearPiece } from '../../types/gear';
import { Ship } from '../../types/ship';
import { useShips } from '../../contexts/ShipsContext';
import { Button, Input, Modal } from '../ui';
import { ShipDisplay } from '../ship/ShipDisplay';
import { GearPieceDisplay } from './GearPieceDisplay';
import { RARITY_ORDER } from '../../constants';
import {
    getCalibratedMainStat,
    getCalibrationBonus,
    isCalibrationEligible,
} from '../../utils/gear/calibrationCalculator';

interface CalibrationModalProps {
    isOpen: boolean;
    onClose: () => void;
    gear: GearPiece | null;
    onConfirm: (gearId: string, shipId: string) => void;
}

export const CalibrationModal: React.FC<CalibrationModalProps> = ({
    isOpen,
    onClose,
    gear,
    onConfirm,
}) => {
    const { ships, getShipById } = useShips();
    const [search, setSearch] = useState('');
    const [selectedShip, setSelectedShip] = useState<Ship | null>(null);

    // Get the currently calibrated ship if gear is already calibrated
    const calibratedShip = useMemo(() => {
        if (gear?.calibration?.shipId) {
            return getShipById(gear.calibration.shipId);
        }
        return null;
    }, [gear?.calibration?.shipId, getShipById]);

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
    const calibratedMainStat = getCalibratedMainStat(gear);
    const calibrationBonus = getCalibrationBonus(gear);

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
                        <h4 className="text-sm font-medium text-gray-400">Selected Gear</h4>
                        <div className="max-w-sm">
                            <GearPieceDisplay gear={gear} mode="manage" showDetails />
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

                        {/* Calibration Bonus Preview */}
                        {isEligible && gear.mainStat && (
                            <div className="bg-cyan-900/30 border border-cyan-700 p-4 rounded">
                                <h4 className="text-sm font-medium text-cyan-400 mb-2">
                                    Calibration Bonus Preview
                                </h4>
                                <div className="flex items-center gap-4 text-sm">
                                    <span className="text-gray-400">
                                        {gear.mainStat.name}: {gear.mainStat.value}
                                        {gear.mainStat.type === 'percentage' ? '%' : ''}
                                    </span>
                                    <span className="text-cyan-400">→</span>
                                    <span className="text-cyan-300 font-medium">
                                        {calibratedMainStat?.value}
                                        {calibratedMainStat?.type === 'percentage' ? '%' : ''}
                                    </span>
                                    <span className="text-green-400">
                                        (+{calibrationBonus}
                                        {gear.mainStat.type === 'percentage' ? 'pp' : ''})
                                    </span>
                                </div>
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
