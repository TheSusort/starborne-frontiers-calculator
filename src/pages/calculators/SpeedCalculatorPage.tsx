import React, { useState, useEffect } from 'react';
import { CloseIcon, PageLayout, Tabs } from '../../components/ui';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import Seo from '../../components/seo/Seo';
import { SEO_CONFIG } from '../../constants/seo';

// Interface for a speed modifier
interface SpeedModifier {
    id: string;
    value: number; // Percentage value (e.g., 30 for +30%, -15 for -15%)
    label?: string; // Optional label for the modifier
}

// Mode 1: Calculate final speed from base speed and modifiers
const calculateFinalSpeed = (baseSpeed: number, modifiers: SpeedModifier[]): number => {
    const totalModifier = modifiers.reduce((sum, mod) => sum + mod.value, 0);
    return baseSpeed * (1 + totalModifier / 100);
};

// Mode 2: Calculate base speed range from target speed range and modifiers
// Returns null for min/max if the corresponding target is 0 (no limit)
const calculateBaseSpeedRange = (
    targetMinSpeed: number,
    targetMaxSpeed: number,
    modifiers: SpeedModifier[]
): { min: number | null; max: number | null } | null => {
    const totalModifier = modifiers.reduce((sum, mod) => sum + mod.value, 0);
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
    const [activeMode, setActiveMode] = useState<'forward' | 'reverse'>('forward');

    // Mode 1 (Forward) state
    const [baseSpeed, setBaseSpeed] = useState<number>(120);
    const [modifiers, setModifiers] = useState<SpeedModifier[]>([{ id: '1', value: 30 }]);
    const [nextModifierId, setNextModifierId] = useState(2);
    const [finalSpeed, setFinalSpeed] = useState<number>(0);

    // Mode 2 (Reverse) state
    const [targetMinSpeed, setTargetMinSpeed] = useState<number>(100);
    const [targetMaxSpeed, setTargetMaxSpeed] = useState<number>(150);
    const [reverseModifiers, setReverseModifiers] = useState<SpeedModifier[]>([
        { id: 'r1', value: 30 },
    ]);
    const [nextReverseModifierId, setNextReverseModifierId] = useState(2);
    const [baseSpeedRange, setBaseSpeedRange] = useState<{
        min: number | null;
        max: number | null;
    } | null>(null);

    // Calculate final speed when base speed or modifiers change (Mode 1)
    useEffect(() => {
        const calculated = calculateFinalSpeed(baseSpeed, modifiers);
        setFinalSpeed(calculated);
    }, [baseSpeed, modifiers]);

    // Calculate base speed range when target speeds or modifiers change (Mode 2)
    useEffect(() => {
        const calculated = calculateBaseSpeedRange(
            targetMinSpeed,
            targetMaxSpeed,
            reverseModifiers
        );
        setBaseSpeedRange(calculated);
    }, [targetMinSpeed, targetMaxSpeed, reverseModifiers]);

    // Mode 1 functions
    const addModifier = () => {
        const newModifier: SpeedModifier = {
            id: nextModifierId.toString(),
            value: 0,
        };
        setModifiers([...modifiers, newModifier]);
        setNextModifierId(nextModifierId + 1);
    };

    const removeModifier = (id: string) => {
        setModifiers(modifiers.filter((mod) => mod.id !== id));
    };

    const updateModifier = (id: string, value: number) => {
        setModifiers(modifiers.map((mod) => (mod.id === id ? { ...mod, value } : mod)));
    };

    const updateModifierLabel = (id: string, label: string) => {
        setModifiers(modifiers.map((mod) => (mod.id === id ? { ...mod, label } : mod)));
    };

    // Mode 2 functions
    const addReverseModifier = () => {
        const newModifier: SpeedModifier = {
            id: `r${nextReverseModifierId}`,
            value: 0,
        };
        setReverseModifiers([...reverseModifiers, newModifier]);
        setNextReverseModifierId(nextReverseModifierId + 1);
    };

    const removeReverseModifier = (id: string) => {
        setReverseModifiers(reverseModifiers.filter((mod) => mod.id !== id));
    };

    const updateReverseModifier = (id: string, value: number) => {
        setReverseModifiers(
            reverseModifiers.map((mod) => (mod.id === id ? { ...mod, value } : mod))
        );
    };

    const updateReverseModifierLabel = (id: string, label: string) => {
        setReverseModifiers(
            reverseModifiers.map((mod) => (mod.id === id ? { ...mod, label } : mod))
        );
    };

    // Calculate total modifier percentage for display
    const getTotalModifier = (mods: SpeedModifier[]): number => {
        return mods.reduce((sum, mod) => sum + mod.value, 0);
    };

    const tabs = [
        { id: 'forward', label: 'Calculate Final Speed' },
        { id: 'reverse', label: 'Find Base Speed Range' },
    ];

    const handleTabChange = (tabId: string) => {
        setActiveMode(tabId as 'forward' | 'reverse');
    };

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
                                <div className="flex justify-between items-center mb-4">
                                    <h3 className="text-lg font-bold">Speed Modifiers</h3>
                                    <Button variant="primary" onClick={addModifier}>
                                        Add Modifier
                                    </Button>
                                </div>
                                <p className="text-sm text-gray-400 mb-4">
                                    Add speed buffs (+) and debuffs (-) as percentages. All
                                    modifiers are summed together and applied to the base speed.
                                </p>

                                <div className="space-y-3">
                                    {modifiers.map((modifier) => (
                                        <div
                                            key={modifier.id}
                                            className="flex gap-3 items-end p-3 bg-dark-lighter rounded"
                                        >
                                            <div className="flex-1">
                                                <Input
                                                    label="Label (optional)"
                                                    value={modifier.label || ''}
                                                    onChange={(e) =>
                                                        updateModifierLabel(
                                                            modifier.id,
                                                            e.target.value
                                                        )
                                                    }
                                                    placeholder="e.g., Engine Boost"
                                                />
                                            </div>
                                            <div className="flex-1">
                                                <Input
                                                    label="Modifier (%)"
                                                    type="number"
                                                    value={modifier.value}
                                                    onChange={(e) =>
                                                        updateModifier(
                                                            modifier.id,
                                                            parseFloat(e.target.value) || 0
                                                        )
                                                    }
                                                    placeholder="+30 or -15"
                                                />
                                            </div>
                                            <Button
                                                variant="danger"
                                                onClick={() => removeModifier(modifier.id)}
                                                aria-label="Remove modifier"
                                            >
                                                <CloseIcon />
                                            </Button>
                                        </div>
                                    ))}
                                </div>

                                {modifiers.length > 0 && (
                                    <div className="mt-4 pt-4 border-t border-dark-border">
                                        <div className="flex justify-between items-center">
                                            <span className="text-gray-400">Total Modifier:</span>
                                            <span
                                                className={`font-bold ${
                                                    getTotalModifier(modifiers) >= 0
                                                        ? 'text-green-400'
                                                        : 'text-red-400'
                                                }`}
                                            >
                                                {getTotalModifier(modifiers) >= 0 ? '+' : ''}
                                                {getTotalModifier(modifiers).toFixed(2)}%
                                            </span>
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div className="card">
                                <h3 className="text-lg font-bold mb-4">Result</h3>
                                <div className="space-y-2">
                                    <div className="flex justify-between items-center">
                                        <span className="text-gray-400">Base Speed:</span>
                                        <span className="font-mono">
                                            {Math.round(baseSpeed).toLocaleString()}
                                        </span>
                                    </div>
                                    <div className="flex justify-between items-center">
                                        <span className="text-gray-400">Total Modifier:</span>
                                        <span
                                            className={`font-mono ${
                                                getTotalModifier(modifiers) >= 0
                                                    ? 'text-green-400'
                                                    : 'text-red-400'
                                            }`}
                                        >
                                            {getTotalModifier(modifiers) >= 0 ? '+' : ''}
                                            {getTotalModifier(modifiers).toFixed(2)}%
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
                                <p className="text-sm text-gray-400 mb-2">
                                    Final Speed = Base Speed × (1 + Total Modifier / 100)
                                </p>
                                <p className="text-sm text-gray-400">
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
                                <p className="text-sm text-gray-400 mb-4">
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
                                <div className="flex justify-between items-center mb-4">
                                    <h3 className="text-lg font-bold">Speed Modifiers</h3>
                                    <Button variant="primary" onClick={addReverseModifier}>
                                        Add Modifier
                                    </Button>
                                </div>
                                <p className="text-sm text-gray-400 mb-4">
                                    Add speed buffs (+) and debuffs (-) as percentages. The
                                    calculator will determine what base speed range is needed to
                                    achieve your target speed range after applying these modifiers.
                                </p>

                                <div className="space-y-3">
                                    {reverseModifiers.map((modifier) => (
                                        <div
                                            key={modifier.id}
                                            className="flex gap-3 items-end p-3 bg-dark-lighter rounded"
                                        >
                                            <div className="flex-1">
                                                <Input
                                                    label="Label (optional)"
                                                    value={modifier.label || ''}
                                                    onChange={(e) =>
                                                        updateReverseModifierLabel(
                                                            modifier.id,
                                                            e.target.value
                                                        )
                                                    }
                                                    placeholder="e.g., Engine Boost"
                                                />
                                            </div>
                                            <div className="flex-1">
                                                <Input
                                                    label="Modifier (%)"
                                                    type="number"
                                                    value={modifier.value}
                                                    onChange={(e) =>
                                                        updateReverseModifier(
                                                            modifier.id,
                                                            parseFloat(e.target.value) || 0
                                                        )
                                                    }
                                                    placeholder="+30 or -15"
                                                />
                                            </div>
                                            <Button
                                                variant="danger"
                                                onClick={() => removeReverseModifier(modifier.id)}
                                                aria-label="Remove modifier"
                                            >
                                                <CloseIcon />
                                            </Button>
                                        </div>
                                    ))}
                                </div>

                                {reverseModifiers.length > 0 && (
                                    <div className="mt-4 pt-4 border-t border-dark-border">
                                        <div className="flex justify-between items-center">
                                            <span className="text-gray-400">Total Modifier:</span>
                                            <span
                                                className={`font-bold ${
                                                    getTotalModifier(reverseModifiers) >= 0
                                                        ? 'text-green-400'
                                                        : 'text-red-400'
                                                }`}
                                            >
                                                {getTotalModifier(reverseModifiers) >= 0 ? '+' : ''}
                                                {getTotalModifier(reverseModifiers).toFixed(2)}%
                                            </span>
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div className="card">
                                <h3 className="text-lg font-bold mb-4">Result</h3>
                                {baseSpeedRange ? (
                                    <div className="space-y-2">
                                        <div className="flex justify-between items-center">
                                            <span className="text-gray-400">
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
                                            <span className="text-gray-400">Total Modifier:</span>
                                            <span
                                                className={`font-mono ${
                                                    getTotalModifier(reverseModifiers) >= 0
                                                        ? 'text-green-400'
                                                        : 'text-red-400'
                                                }`}
                                            >
                                                {getTotalModifier(reverseModifiers) >= 0 ? '+' : ''}
                                                {getTotalModifier(reverseModifiers).toFixed(2)}%
                                            </span>
                                        </div>
                                        <div className="pt-4 border-t border-dark-border">
                                            <div className="flex justify-between items-center mb-2">
                                                <span className="text-lg font-semibold">
                                                    Required Base Speed Range:
                                                </span>
                                            </div>
                                            <div className="flex justify-between items-center">
                                                <span className="text-gray-400">Minimum:</span>
                                                <span className="text-xl font-bold text-primary">
                                                    {baseSpeedRange.min === null
                                                        ? 'No limit'
                                                        : baseSpeedRange.min.toFixed(2)}
                                                </span>
                                            </div>
                                            <div className="flex justify-between items-center">
                                                <span className="text-gray-400">Maximum:</span>
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
                                <p className="text-sm text-gray-400 mb-2">
                                    Base Speed = Target Speed / (1 + Total Modifier / 100)
                                </p>
                                <p className="text-sm text-gray-400">
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
