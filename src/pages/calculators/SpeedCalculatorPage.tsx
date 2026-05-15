import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageLayout, Tabs } from '../../components/ui';
import { Input } from '../../components/ui/Input';
import Seo from '../../components/seo/Seo';
import { SEO_CONFIG } from '../../constants/seo';
import { useShips } from '../../contexts/ShipsContext';
import { useInventory } from '../../contexts/InventoryProvider';
import { useEngineeringStats } from '../../hooks/useEngineeringStats';
import { calculateTotalStats } from '../../utils/ship/statsCalculator';
import { Ship } from '../../types/ship';
import { ShipSelector } from '../../components/ship/ShipSelector';
import { SelectedGameBuff } from '../../types/calculator';
import { GameBuffPicker } from '../../components/calculator/GameBuffPicker';

// Mode 1: Calculate final speed from base speed and total modifier
const calculateFinalSpeed = (baseSpeed: number, totalModifier: number): number => {
    return baseSpeed * (1 + totalModifier / 100);
};

// Mode 2: Calculate base speed range from target speed range and total modifier
// Returns null for min/max if the corresponding target is 0 (no limit)
const calculateBaseSpeedRange = (
    targetMinSpeed: number,
    targetMaxSpeed: number,
    totalModifier: number
): { min: number | null; max: number | null } | null => {
    const modifierMultiplier = 1 + totalModifier / 100;

    // Avoid division by zero or negative multipliers
    if (modifierMultiplier <= 0) {
        return null;
    }

    return {
        min: targetMinSpeed === 0 ? null : targetMinSpeed / modifierMultiplier,
        max: targetMaxSpeed === 0 ? null : targetMaxSpeed / modifierMultiplier,
    };
};

const SpeedCalculatorPage: React.FC = () => {
    const [searchParams, setSearchParams] = useSearchParams();
    const { getShipById } = useShips();
    const { getGearPiece } = useInventory();
    const { getEngineeringStatsForShipType } = useEngineeringStats();
    const shipInitialized = useRef(false);

    const getInitialSpeed = (): number => {
        const shipId = searchParams.get('shipId');
        if (shipId) {
            const ship = getShipById(shipId);
            if (ship) {
                const engineeringStats = ship.type
                    ? getEngineeringStatsForShipType(ship.type)
                    : undefined;
                const statsBreakdown = calculateTotalStats(
                    ship.baseStats,
                    ship.equipment || {},
                    getGearPiece,
                    ship.refits,
                    ship.implants,
                    engineeringStats,
                    ship.id
                );
                return Math.round(statsBreakdown.final.speed);
            }
        }
        return 120;
    };

    const getInitialShip = (): Ship | null => {
        const shipId = searchParams.get('shipId');
        if (shipId) {
            return getShipById(shipId) ?? null;
        }
        return null;
    };

    const [activeMode, setActiveMode] = useState<'forward' | 'reverse'>('forward');

    // Mode 1 (Forward) state
    const [initialSpeed] = useState(getInitialSpeed);
    const [selectedShip, setSelectedShip] = useState<Ship | null>(getInitialShip);
    const [baseSpeed, setBaseSpeed] = useState<number>(initialSpeed);

    // Clear shipId from URL after initialization
    useEffect(() => {
        if (shipInitialized.current) return;
        shipInitialized.current = true;
        if (searchParams.has('shipId')) {
            searchParams.delete('shipId');
            setSearchParams(searchParams, { replace: true });
        }
    }, [searchParams, setSearchParams]);

    const [forwardBuffs, setForwardBuffs] = useState<SelectedGameBuff[]>([]);

    // Mode 2 (Reverse) state
    const [targetMinSpeed, setTargetMinSpeed] = useState<number>(100);
    const [targetMaxSpeed, setTargetMaxSpeed] = useState<number>(150);
    const [reverseBuffs, setReverseBuffs] = useState<SelectedGameBuff[]>([]);

    const handleShipSelect = (ship: Ship) => {
        const engineeringStats = ship.type ? getEngineeringStatsForShipType(ship.type) : undefined;
        const statsBreakdown = calculateTotalStats(
            ship.baseStats,
            ship.equipment || {},
            getGearPiece,
            ship.refits,
            ship.implants,
            engineeringStats,
            ship.id
        );
        setSelectedShip(ship);
        setBaseSpeed(Math.round(statsBreakdown.final.speed));
    };

    const tabs = [
        { id: 'forward', label: 'Calculate Final Speed' },
        { id: 'reverse', label: 'Find Base Speed Range' },
    ];

    const handleTabChange = (tabId: string) => {
        setActiveMode(tabId as 'forward' | 'reverse');
    };

    const forwardTotalModifier = forwardBuffs.reduce(
        (sum, b) => sum + (b.parsedEffects.speed ?? 0) * b.stacks,
        0
    );
    const finalSpeed = calculateFinalSpeed(baseSpeed, forwardTotalModifier);

    const reverseTotalModifier = reverseBuffs.reduce(
        (sum, b) => sum + (b.parsedEffects.speed ?? 0) * b.stacks,
        0
    );
    const baseSpeedRange = calculateBaseSpeedRange(
        targetMinSpeed,
        targetMaxSpeed,
        reverseTotalModifier
    );

    return (
        <>
            <Seo {...SEO_CONFIG.speed} />
            <PageLayout
                title="Speed Calculator"
                description="Calculate ship speed with buffs and debuffs, or find the base speed needed to achieve target speeds."
            >
                <div className="space-y-6">
                    <Tabs tabs={tabs} activeTab={activeMode} onChange={handleTabChange} />

                    {/* Mode 1: Forward Calculation */}
                    {activeMode === 'forward' && (
                        <div className="space-y-6">
                            <ShipSelector
                                selected={selectedShip}
                                onSelect={handleShipSelect}
                                variant="compact"
                            />

                            <div className="card">
                                <h3 className="text-lg font-bold mb-4">Base Speed</h3>
                                <Input
                                    label="Base Speed"
                                    type="number"
                                    value={baseSpeed}
                                    onChange={(e) => setBaseSpeed(parseInt(e.target.value) || 0)}
                                    min="0"
                                    step="1"
                                />
                            </div>

                            <div className="card">
                                <GameBuffPicker
                                    label="Speed Buffs"
                                    relevantStats={['speed']}
                                    value={forwardBuffs}
                                    onChange={setForwardBuffs}
                                />
                            </div>

                            <div className="card">
                                <h3 className="text-lg font-bold mb-4">Result</h3>
                                <div className="space-y-2">
                                    <div className="flex justify-between items-center">
                                        <span className="text-theme-text-secondary">
                                            Base Speed:
                                        </span>
                                        <span className="font-mono">
                                            {Math.round(baseSpeed).toLocaleString()}
                                        </span>
                                    </div>
                                    <div className="flex justify-between items-center">
                                        <span className="text-theme-text-secondary">
                                            Total Modifier:
                                        </span>
                                        <span
                                            className={`font-mono ${
                                                forwardTotalModifier >= 0
                                                    ? 'text-green-400'
                                                    : 'text-red-400'
                                            }`}
                                        >
                                            {forwardTotalModifier >= 0 ? '+' : ''}
                                            {forwardTotalModifier.toFixed(2)}%
                                        </span>
                                    </div>
                                    <div className="pt-4 border-t border-dark-border">
                                        <div className="flex justify-between items-center">
                                            <span className="text-lg font-semibold">
                                                Final Speed:
                                            </span>
                                            <span className="text-2xl font-bold text-primary">
                                                {finalSpeed.toFixed(2)}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="card">
                                <h3 className="text-lg font-bold mb-2">Calculation Formula</h3>
                                <p className="text-sm text-theme-text-secondary mb-2">
                                    Final Speed = Base Speed × (1 + Total Modifier / 100)
                                </p>
                                <p className="text-sm text-theme-text-secondary">
                                    Where Total Modifier is the sum of all individual modifiers.
                                </p>
                            </div>
                        </div>
                    )}

                    {/* Mode 2: Reverse Calculation */}
                    {activeMode === 'reverse' && (
                        <div className="space-y-6">
                            <div className="card">
                                <h3 className="text-lg font-bold mb-4">Target Speed Range</h3>
                                <p className="text-sm text-theme-text-secondary mb-4">
                                    Enter 0 for minimum or maximum to indicate no lower or upper
                                    limit respectively.
                                </p>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <Input
                                        label="Minimum Target Speed (0 = no minimum)"
                                        type="number"
                                        value={targetMinSpeed}
                                        onChange={(e) =>
                                            setTargetMinSpeed(parseFloat(e.target.value) || 0)
                                        }
                                        min="0"
                                    />
                                    <Input
                                        label="Maximum Target Speed (0 = no maximum)"
                                        type="number"
                                        value={targetMaxSpeed}
                                        onChange={(e) =>
                                            setTargetMaxSpeed(parseFloat(e.target.value) || 0)
                                        }
                                        min="0"
                                    />
                                </div>
                                {targetMinSpeed > 0 &&
                                    targetMaxSpeed > 0 &&
                                    targetMinSpeed > targetMaxSpeed && (
                                        <p className="text-sm text-red-400 mt-2">
                                            Warning: Minimum speed is greater than maximum speed.
                                        </p>
                                    )}
                            </div>

                            <div className="card">
                                <GameBuffPicker
                                    label="Speed Buffs"
                                    relevantStats={['speed']}
                                    value={reverseBuffs}
                                    onChange={setReverseBuffs}
                                />
                            </div>

                            <div className="card">
                                <h3 className="text-lg font-bold mb-4">Result</h3>
                                {baseSpeedRange ? (
                                    <div className="space-y-2">
                                        <div className="flex justify-between items-center">
                                            <span className="text-theme-text-secondary">
                                                Target Speed Range:
                                            </span>
                                            <span className="font-mono">
                                                {targetMinSpeed === 0
                                                    ? 'No minimum'
                                                    : targetMinSpeed.toLocaleString()}{' '}
                                                -{' '}
                                                {targetMaxSpeed === 0
                                                    ? 'No maximum'
                                                    : targetMaxSpeed.toLocaleString()}
                                            </span>
                                        </div>
                                        <div className="flex justify-between items-center">
                                            <span className="text-theme-text-secondary">
                                                Total Modifier:
                                            </span>
                                            <span
                                                className={`font-mono ${
                                                    reverseTotalModifier >= 0
                                                        ? 'text-green-400'
                                                        : 'text-red-400'
                                                }`}
                                            >
                                                {reverseTotalModifier >= 0 ? '+' : ''}
                                                {reverseTotalModifier.toFixed(2)}%
                                            </span>
                                        </div>
                                        <div className="pt-4 border-t border-dark-border">
                                            <div className="flex justify-between items-center mb-2">
                                                <span className="text-lg font-semibold">
                                                    Required Base Speed Range:
                                                </span>
                                            </div>
                                            <div className="flex justify-between items-center">
                                                <span className="text-theme-text-secondary">
                                                    Minimum:
                                                </span>
                                                <span className="text-xl font-bold text-primary">
                                                    {baseSpeedRange.min === null
                                                        ? 'No limit'
                                                        : baseSpeedRange.min.toFixed(2)}
                                                </span>
                                            </div>
                                            <div className="flex justify-between items-center">
                                                <span className="text-theme-text-secondary">
                                                    Maximum:
                                                </span>
                                                <span className="text-xl font-bold text-primary">
                                                    {baseSpeedRange.max === null
                                                        ? 'No limit'
                                                        : baseSpeedRange.max.toFixed(2)}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="text-red-400">
                                        Invalid calculation. Please check that your modifiers
                                        don&apos;t result in a negative or zero multiplier.
                                    </div>
                                )}
                            </div>

                            <div className="card">
                                <h3 className="text-lg font-bold mb-2">Calculation Formula</h3>
                                <p className="text-sm text-theme-text-secondary mb-2">
                                    Base Speed = Target Speed / (1 + Total Modifier / 100)
                                </p>
                                <p className="text-sm text-theme-text-secondary">
                                    The calculator finds the base speed range by reversing the
                                    forward calculation for both the minimum and maximum target
                                    speeds.
                                </p>
                            </div>
                        </div>
                    )}
                </div>
            </PageLayout>
        </>
    );
};

export default SpeedCalculatorPage;
