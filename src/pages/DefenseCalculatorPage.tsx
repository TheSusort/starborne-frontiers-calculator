import React, { useState, useEffect, useRef } from 'react';
import { CloseIcon, PageLayout } from '../components/ui';
import { calculateDamageReduction, calculateEffectiveHP } from '../utils/autogear/scoring';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { DamageReductionPlotly } from '../components/calculator/DamageReductionPlotly';
import { DamageReductionTable } from '../components/calculator/DamageReductionTable';

// Define the type for a ship configuration
interface ShipConfig {
    id: string;
    name: string;
    hp: number;
    defense: number;
    effectiveHP?: number;
    damageReduction?: number;
}

const DefenseCalculatorPage: React.FC = () => {
    const [configs, setConfigs] = useState<ShipConfig[]>([
        { id: '1', name: 'Ship 1', hp: 10000, defense: 5000 },
    ]);
    const [nextId, setNextId] = useState(2);
    const initialRender = useRef(true);
    const [showTable, setShowTable] = useState(false);

    // Calculate effective HP and damage reduction for all configs
    useEffect(() => {
        // Skip the first render to avoid infinite loop
        if (initialRender.current) {
            initialRender.current = false;

            // Calculate initial values
            const initialConfigs = configs.map((config) => {
                const damageReduction = calculateDamageReduction(config.defense);
                const effectiveHP = calculateEffectiveHP(config.hp, config.defense);
                return {
                    ...config,
                    damageReduction,
                    effectiveHP,
                };
            });
            setConfigs(initialConfigs);
            return;
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []); // Empty dependency array to run only once

    // Add a new ship configuration
    const addConfig = () => {
        const newConfig: ShipConfig = {
            id: nextId.toString(),
            name: `Ship ${nextId}`,
            hp: 10000,
            defense: 5000,
        };

        // Calculate values for the new config
        const damageReduction = calculateDamageReduction(newConfig.defense);
        const effectiveHP = calculateEffectiveHP(newConfig.hp, newConfig.defense);

        setConfigs([
            ...configs,
            {
                ...newConfig,
                damageReduction,
                effectiveHP,
            },
        ]);
        setNextId(nextId + 1);
    };

    // Remove a ship configuration
    const removeConfig = (id: string) => {
        setConfigs(configs.filter((config) => config.id !== id));
    };

    // Update a ship configuration
    const updateConfig = (id: string, field: 'name' | 'hp' | 'defense', value: string | number) => {
        const updatedConfigs = configs.map((config) => {
            if (config.id === id) {
                const updatedConfig = { ...config, [field]: value };

                // Recalculate if hp or defense changed
                if (field === 'hp' || field === 'defense') {
                    const damageReduction = calculateDamageReduction(updatedConfig.defense);
                    const effectiveHP = calculateEffectiveHP(
                        updatedConfig.hp,
                        updatedConfig.defense
                    );
                    return {
                        ...updatedConfig,
                        damageReduction,
                        effectiveHP,
                    };
                }

                return updatedConfig;
            }
            return config;
        });

        setConfigs(updatedConfigs);
    };

    // Find the ship with the highest effective HP
    const bestShip = configs.reduce(
        (best, current) => {
            if (
                !best ||
                (current.effectiveHP && best.effectiveHP && current.effectiveHP > best.effectiveHP)
            ) {
                return current;
            }
            return best;
        },
        null as ShipConfig | null
    );

    return (
        <PageLayout
            title="Defense Calculator"
            description="Calculate effective HP and damage reduction based on HP and defense values"
            action={{
                label: 'Add Ship',
                onClick: addConfig,
                variant: 'primary',
            }}
        >
            <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {configs.map((config) => (
                        <div
                            key={config.id}
                            className={`p-4 bg-dark border border-dark-border relative ${
                                bestShip && bestShip.id === config.id ? 'border-primary' : ''
                            }`}
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
                                        label="HP"
                                        type="number"
                                        value={config.hp}
                                        onChange={(e) =>
                                            updateConfig(
                                                config.id,
                                                'hp',
                                                parseInt(e.target.value) || 0
                                            )
                                        }
                                    />
                                    <Input
                                        label="Defense"
                                        type="number"
                                        value={config.defense}
                                        onChange={(e) =>
                                            updateConfig(
                                                config.id,
                                                'defense',
                                                parseInt(e.target.value) || 0
                                            )
                                        }
                                    />
                                </div>

                                <div className="mt-4 pt-4 border-t border-dark-border">
                                    <div className="flex justify-between mb-2">
                                        <span className="text-gray-400">Damage Reduction:</span>
                                        <span>{config.damageReduction?.toFixed(2)}%</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-gray-400">Effective HP:</span>
                                        <span
                                            className={
                                                bestShip && bestShip.id === config.id
                                                    ? 'text-primary font-bold'
                                                    : ''
                                            }
                                        >
                                            {config.effectiveHP?.toLocaleString()}
                                        </span>
                                    </div>
                                    <div className="flex justify-between mt-2">
                                        <span className="text-gray-400">HP Multiplier:</span>
                                        <span>
                                            {((config.effectiveHP || 0) / config.hp).toFixed(2)}x
                                        </span>
                                    </div>
                                </div>

                                {bestShip && bestShip.id === config.id && (
                                    <div className="text-primary text-sm mt-2 text-center">
                                        Best ship configuration
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                </div>

                <div className="bg-dark p-4 border border-dark-border">
                    <h2 className="text-xl font-bold mb-4">Effective HP Explanation</h2>
                    <p className="mb-2">
                        Effective HP represents how much raw damage your ship can take before being
                        destroyed, taking damage reduction into account.
                    </p>
                    <p className="mb-2">The formula for calculating Effective HP is:</p>
                    <p className="mb-2 font-mono bg-dark-lighter p-2">
                        Effective HP = HP / (1 - (Damage Reduction / 100))
                    </p>
                    <p>
                        For example, a ship with 10,000 HP and 70% damage reduction has an effective
                        HP of 33,333, meaning it can take more than three times as much damage as
                        its raw HP value.
                    </p>
                </div>

                <div className="bg-dark p-4 border border-dark-border">
                    <h2 className="text-xl font-bold mb-4">Damage Reduction Curve</h2>
                    <p className="mb-4">
                        Damage reduction follows a curve where higher defense values have
                        diminishing returns. The interactive chart below shows how damage reduction
                        increases with defense values from 0 to 26,000, and marks the position of
                        your ship configurations.
                    </p>

                    <DamageReductionPlotly
                        height={400}
                        maxDefense={26000}
                        ships={configs.map((config) => ({
                            id: config.id,
                            name: config.name,
                            defense: config.defense,
                            damageReduction: config.damageReduction || 0,
                            isHighlighted: bestShip ? config.id === bestShip.id : false,
                        }))}
                    />

                    <div className="mt-6 flex justify-center">
                        <Button variant="secondary" onClick={() => setShowTable(!showTable)}>
                            {showTable ? 'Hide Table' : 'Show Table'}
                        </Button>
                    </div>

                    {showTable && (
                        <div className="mt-4">
                            <h3 className="text-lg font-bold mb-2">Damage Reduction Table</h3>
                            <DamageReductionTable />
                        </div>
                    )}
                </div>
            </div>
        </PageLayout>
    );
};

export default DefenseCalculatorPage;
