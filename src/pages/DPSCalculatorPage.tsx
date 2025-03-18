import React, { useState, useEffect, useRef } from 'react';
import { CloseIcon, PageLayout } from '../components/ui';
import { calculateDPS, calculateCritMultiplier } from '../utils/autogear/scoring';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { DPSCalculatorTable } from '../components/calculator/DPSCalculatorTable';
import { DPSHeatmap } from '../components/calculator/DPSHeatmap';
import { BaseStats } from '../types/stats';

// Define the type for a ship configuration
interface ShipConfig {
    id: string;
    name: string;
    attack: number;
    crit: number;
    critDamage: number;
    dps?: number;
}

const DPSCalculatorPage: React.FC = () => {
    const [configs, setConfigs] = useState<ShipConfig[]>([
        { id: '1', name: 'Ship 1', attack: 5000, crit: 100, critDamage: 100 },
    ]);
    const [nextId, setNextId] = useState(2);
    const initialRender = useRef(true);
    const [viewMode, setViewMode] = useState<'table' | 'heatmap'>('heatmap');

    // Calculate DPS for all configs
    useEffect(() => {
        // Skip the first render to avoid infinite loop
        if (initialRender.current) {
            initialRender.current = false;

            // Calculate initial values
            const initialConfigs = configs.map((config) => {
                const stats: BaseStats = {
                    attack: config.attack,
                    crit: config.crit,
                    critDamage: config.critDamage,
                    hp: 0,
                    defence: 0,
                    hacking: 0,
                    security: 0,
                    speed: 0,
                    healModifier: 0,
                };
                const dps = Math.round(config.attack * calculateCritMultiplier(stats));
                return {
                    ...config,
                    dps,
                };
            });
            setConfigs(initialConfigs);
            return;
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []); // Empty dependency array - we only want this to run once

    // Add a new ship configuration
    const addConfig = () => {
        const newConfig: ShipConfig = {
            id: nextId.toString(),
            name: `Ship ${nextId}`,
            attack: 5000,
            crit: 100,
            critDamage: 150,
        };

        // Calculate DPS for the new config
        const stats: BaseStats = {
            attack: newConfig.attack,
            crit: newConfig.crit,
            critDamage: newConfig.critDamage,
            hp: 0,
            defence: 0,
            hacking: 0,
            security: 0,
            speed: 0,
            healModifier: 0,
        };
        const dps = calculateDPS(stats);

        setConfigs([
            ...configs,
            {
                ...newConfig,
                dps,
            },
        ]);
        setNextId(nextId + 1);
    };

    // Remove a ship configuration
    const removeConfig = (id: string) => {
        setConfigs(configs.filter((config) => config.id !== id));
    };

    // Update a ship configuration
    const updateConfig = (
        id: string,
        field: 'name' | 'attack' | 'crit' | 'critDamage',
        value: string | number
    ) => {
        const updatedConfigs = configs.map((config) => {
            if (config.id === id) {
                const updatedConfig = { ...config, [field]: value };

                // Recalculate DPS if any relevant stat changed
                if (field === 'attack' || field === 'crit' || field === 'critDamage') {
                    const stats: BaseStats = {
                        attack: updatedConfig.attack,
                        crit: updatedConfig.crit,
                        critDamage: updatedConfig.critDamage,
                        hp: 0,
                        defence: 0,
                        hacking: 0,
                        security: 0,
                        speed: 0,
                        healModifier: 0,
                    };
                    const dps = calculateDPS(stats);
                    return {
                        ...updatedConfig,
                        dps,
                    };
                }

                return updatedConfig;
            }
            return config;
        });

        setConfigs(updatedConfigs);
    };

    // Find the config with the highest DPS
    const bestConfig = configs.reduce(
        (best, current) => {
            if (!best || (current.dps && best.dps && current.dps > best.dps)) {
                return current;
            }
            return best;
        },
        null as ShipConfig | null
    );

    const toggleViewMode = () => {
        setViewMode(viewMode === 'table' ? 'heatmap' : 'table');
    };

    return (
        <PageLayout
            title="DPS Calculator"
            description="Compare damage per second calculations for different ship configurations"
            action={{
                label: 'Add Ship',
                onClick: addConfig,
                variant: 'primary',
            }}
        >
            <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {configs.map((config) => (
                        <div
                            key={config.id}
                            className={`
                                p-4 bg-dark border
                                ${bestConfig && bestConfig.id === config.id ? 'border-primary' : 'border-dark-border'}
                            `}
                        >
                            <div className="flex justify-between items-center mb-4">
                                <Input
                                    value={config.name}
                                    onChange={(e) =>
                                        updateConfig(config.id, 'name', e.target.value)
                                    }
                                    className="font-bold"
                                />
                                <Button
                                    variant="danger"
                                    onClick={() => removeConfig(config.id)}
                                    aria-label="Remove ship"
                                >
                                    <CloseIcon />
                                </Button>
                            </div>

                            <div className="space-y-4">
                                <div className="flex gap-4">
                                    <Input
                                        label="Attack"
                                        type="number"
                                        value={config.attack}
                                        onChange={(e) =>
                                            updateConfig(
                                                config.id,
                                                'attack',
                                                parseInt(e.target.value) || 0
                                            )
                                        }
                                    />
                                </div>
                                <div className="flex gap-4">
                                    <Input
                                        label="Crit Rate (%)"
                                        type="number"
                                        min="0"
                                        max="100"
                                        value={config.crit}
                                        onChange={(e) =>
                                            updateConfig(
                                                config.id,
                                                'crit',
                                                parseInt(e.target.value) || 0
                                            )
                                        }
                                    />
                                    <Input
                                        label="Crit Damage (%)"
                                        type="number"
                                        min="0"
                                        value={config.critDamage}
                                        onChange={(e) =>
                                            updateConfig(
                                                config.id,
                                                'critDamage',
                                                parseInt(e.target.value) || 0
                                            )
                                        }
                                    />
                                </div>

                                <div className="mt-4 pt-4 border-t border-dark-border">
                                    <div className="flex justify-between mb-2">
                                        <span className="text-gray-400">Crit Multiplier:</span>
                                        <span>
                                            {calculateCritMultiplier({
                                                attack: config.attack,
                                                crit: config.crit,
                                                critDamage: config.critDamage,
                                                hp: 0,
                                                defence: 0,
                                                hacking: 0,
                                                security: 0,
                                                speed: 0,
                                                healModifier: 0,
                                            }).toFixed(2)}
                                            x
                                        </span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-gray-400">DPS:</span>
                                        <span
                                            className={
                                                bestConfig && bestConfig.id === config.id
                                                    ? 'text-primary font-bold'
                                                    : ''
                                            }
                                        >
                                            {config.dps?.toLocaleString()}
                                        </span>
                                    </div>
                                    {bestConfig &&
                                        bestConfig.id !== config.id &&
                                        bestConfig.dps &&
                                        config.dps && (
                                            <div className="flex justify-between mt-2">
                                                <span className="text-gray-400">
                                                    Compared to best:
                                                </span>
                                                <span className="text-red-500">
                                                    {(
                                                        ((config.dps - bestConfig.dps) /
                                                            bestConfig.dps) *
                                                        100
                                                    ).toFixed(2)}
                                                    %
                                                </span>
                                            </div>
                                        )}
                                </div>

                                {bestConfig && bestConfig.id === config.id && (
                                    <div className="text-primary text-sm mt-2 text-center">
                                        Best ship configuration
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                </div>

                <div className="bg-dark p-4 border border-dark-border">
                    <div className="flex justify-between items-center mb-2">
                        <h3 className="text-lg font-bold">DPS Comparison</h3>
                        <Button variant="secondary" onClick={toggleViewMode}>
                            Switch to {viewMode === 'table' ? 'Contour Map' : 'Table'} View
                        </Button>
                    </div>
                    <p className="text-sm text-gray-400 mb-4">
                        This visualization shows DPS values at 100% crit rate for different attack
                        values (relative to your current attack) and crit damage percentages.
                        {viewMode === 'table'
                            ? ' Each row shows how your DPS would scale with different attack values, and each column shows how it scales with different crit damage values.'
                            : ' The contour lines show combinations of attack and crit damage that produce equal DPS values. Follow these lines to find stat combinations that result in the same damage output.'}
                    </p>

                    {viewMode === 'table' ? (
                        <DPSCalculatorTable attack={bestConfig ? bestConfig.attack : 5000} />
                    ) : (
                        <DPSHeatmap
                            ships={configs.map((config) => ({
                                ...config,
                                critRate: config.crit,
                                isBest: bestConfig ? config.id === bestConfig.id : false,
                            }))}
                        />
                    )}
                </div>

                <div className="bg-dark p-4 border border-dark-border">
                    <h2 className="text-xl font-bold mb-4">About DPS Calculation</h2>
                    <p className="mb-2">
                        DPS (Damage Per Second) is calculated based on your attack value and crit
                        stats using the formula:
                    </p>
                    <p className="mb-2 font-mono bg-dark-lighter p-2">
                        DPS = Attack × (1 + (CritRate/100) × (CritDamage/100))
                    </p>
                    <p className="mb-2">At 100% crit rate, the formula simplifies to:</p>
                    <p className="mb-2 font-mono bg-dark-lighter p-2">
                        DPS = Attack × (1 + CritDamage/100)
                    </p>
                    <p className="mb-2">
                        For example, with 5,000 attack, 100% crit rate, and 150% crit damage, your
                        DPS would be 5,000 × (1 + 1.5) = 12,500.
                    </p>
                    <p>
                        The visualization shows that while both attack and crit damage increase your
                        DPS linearly, the ideal balance depends on your current stats and available
                        gear options.
                    </p>
                </div>
            </div>
        </PageLayout>
    );
};

export default DPSCalculatorPage;
