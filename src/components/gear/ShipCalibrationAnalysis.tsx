import React, { useState, useMemo, useEffect } from 'react';
import { Ship } from '../../types/ship';
import { GearPiece } from '../../types/gear';
import { ShipTypeName, GEAR_SLOTS } from '../../constants';
import { ShipSelector } from '../ship/ShipSelector';
import { RoleSelector } from '../ui';
import { SHIP_TYPES } from '../../constants/shipTypes';
import { useInventory } from '../../contexts/InventoryProvider';
import { useEngineeringStats } from '../../hooks/useEngineeringStats';
import { useShips } from '../../contexts/ShipsContext';
import { analyzeShipCalibrationImpact } from '../../utils/gear/calibrationCalculator';
import { GearPieceDisplay } from './GearPieceDisplay';
import { Button } from '../ui';

interface Props {
    onEdit?: (piece: GearPiece) => void;
    onCalibrate?: (piece: GearPiece, shipId?: string) => void;
    initialShipId?: string | null;
}

export const ShipCalibrationAnalysis: React.FC<Props> = ({
    onEdit,
    onCalibrate,
    initialShipId,
}) => {
    const { getGearPiece } = useInventory();
    const { getEngineeringStatsForShipType } = useEngineeringStats();
    const { getShipById } = useShips();
    const [selectedShip, setSelectedShip] = useState<Ship | null>(null);
    const [selectedRole, setSelectedRole] = useState<ShipTypeName | null>(null);

    // Pre-select ship from initialShipId (e.g., from URL params)
    useEffect(() => {
        if (initialShipId && !selectedShip) {
            const ship = getShipById(initialShipId);
            if (ship) {
                setSelectedShip(ship);
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initialShipId]);

    // Update role to ship's type when ship changes
    useEffect(() => {
        if (selectedShip) {
            setSelectedRole(selectedShip.type);
        }
    }, [selectedShip]);

    // Calculate calibration impact
    const analysis = useMemo(() => {
        if (!selectedShip || !selectedRole) {
            return null;
        }

        return analyzeShipCalibrationImpact(
            selectedShip,
            selectedRole,
            getGearPiece,
            getEngineeringStatsForShipType
        );
    }, [selectedShip, selectedRole, getGearPiece, getEngineeringStatsForShipType]);

    return (
        <div className="space-y-6">
            <div className="text-sm text-gray-400 space-y-2">
                <p>
                    Select a ship and role to see how calibrating each equipped gear piece would
                    improve the ship&apos;s role score.
                </p>
                <p>
                    This shows the impact of calibrating gear that&apos;s already equipped, helping
                    you prioritize which gear to calibrate first.
                </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                    <label className="block text-sm font-medium">Select Ship</label>
                    <ShipSelector selected={selectedShip} onSelect={setSelectedShip} />
                </div>

                {selectedShip && (
                    <div className="space-y-2">
                        <RoleSelector
                            value={selectedRole || ''}
                            onChange={setSelectedRole}
                            label="Select Role"
                        />
                        <p className="text-xs text-gray-400">
                            Defaults to ship&apos;s type: {SHIP_TYPES[selectedShip.type]?.name}
                        </p>
                    </div>
                )}
            </div>

            {analysis && (
                <div className="space-y-6">
                    {/* Summary */}
                    <div className="card space-y-4">
                        <h3 className="text-lg font-medium">Overall Impact</h3>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <div>
                                <div className="text-sm text-gray-400">Current Score</div>
                                <div className="text-xl font-semibold">
                                    {Math.round(analysis.currentTotalScore).toLocaleString()}
                                </div>
                            </div>
                            <div>
                                <div className="text-sm text-gray-400">Calibrated Score</div>
                                <div className="text-xl font-semibold text-cyan-400">
                                    {Math.round(analysis.calibratedTotalScore).toLocaleString()}
                                </div>
                            </div>
                            <div>
                                <div className="text-sm text-gray-400">Total Improvement</div>
                                <div className="text-xl font-semibold text-green-400">
                                    +{Math.round(analysis.totalImprovement).toLocaleString()}
                                </div>
                            </div>
                            <div>
                                <div className="text-sm text-gray-400">% Improvement</div>
                                <div className="text-xl font-semibold text-green-400">
                                    +{Math.round(analysis.totalImprovementPercentage)}%
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Per-Slot Analysis */}
                    <div className="space-y-4">
                        <h3 className="text-lg font-medium">Per-Slot Analysis</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {analysis.slots.map((slotResult) => {
                                const slotInfo = GEAR_SLOTS[slotResult.slot];
                                if (!slotInfo) return null;

                                return (
                                    <div key={slotResult.slot} className="card space-y-4">
                                        <div>
                                            <h4 className="font-medium">{slotInfo.label}</h4>
                                            {slotResult.gear ? (
                                                <>
                                                    <GearPieceDisplay
                                                        gear={slotResult.gear}
                                                        mode="manage"
                                                        onEdit={onEdit}
                                                        showDetails
                                                    />
                                                    {slotResult.isEligible ? (
                                                        <div className="mt-2 space-y-1 text-sm">
                                                            <div className="flex justify-between text-gray-300">
                                                                <span>Ship score (current):</span>
                                                                <span>
                                                                    {Math.round(
                                                                        slotResult.currentScore
                                                                    ).toLocaleString()}
                                                                </span>
                                                            </div>
                                                            <div className="flex justify-between text-cyan-400">
                                                                <span>
                                                                    Ship score (calibrated):
                                                                </span>
                                                                <span>
                                                                    {Math.round(
                                                                        slotResult.calibratedScore
                                                                    ).toLocaleString()}
                                                                </span>
                                                            </div>
                                                            <div className="flex justify-between text-green-400">
                                                                <span>Improvement:</span>
                                                                <span>
                                                                    +
                                                                    {Math.round(
                                                                        slotResult.improvement
                                                                    ).toLocaleString()}{' '}
                                                                    (+
                                                                    {Math.round(
                                                                        slotResult.improvementPercentage
                                                                    )}
                                                                    %)
                                                                </span>
                                                            </div>
                                                            {onCalibrate && slotResult.gear && (
                                                                <Button
                                                                    variant="secondary"
                                                                    size="sm"
                                                                    fullWidth
                                                                    onClick={() =>
                                                                        onCalibrate(
                                                                            slotResult.gear!,
                                                                            selectedShip?.id
                                                                        )
                                                                    }
                                                                >
                                                                    Calibrate Gear
                                                                </Button>
                                                            )}
                                                        </div>
                                                    ) : slotResult.gear.calibration ? (
                                                        <div className="mt-2 text-xs text-cyan-400">
                                                            ✓ Already calibrated
                                                        </div>
                                                    ) : (
                                                        <div className="mt-2 text-xs text-gray-400">
                                                            Not eligible (requires level 16, 5-6
                                                            stars)
                                                        </div>
                                                    )}
                                                </>
                                            ) : (
                                                <div className="text-sm text-gray-400 py-4">
                                                    No gear equipped
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            )}

            {selectedShip && !selectedRole && (
                <div className="text-center py-12 text-gray-400">
                    <p>Please select a role to analyze.</p>
                </div>
            )}

            {!selectedShip && (
                <div className="text-center py-12 text-gray-400">
                    <p>Please select a ship to analyze.</p>
                </div>
            )}
        </div>
    );
};
