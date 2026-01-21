import React, { useState, useEffect } from 'react';
import { CloseIcon, PageLayout } from '../../components/ui';
import { calculateCritMultiplier, calculateDamageReduction } from '../../utils/autogear/scoring';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { DPSCalculatorTable } from '../../components/calculator/DPSCalculatorTable';
import { DPSChart } from '../../components/calculator/DPSChart';
import { DefensePenetrationChart } from '../../components/calculator/DefensePenetrationChart';
import Seo from '../../components/seo/Seo';
import { SEO_CONFIG } from '../../constants/seo';

// Calculate DPS with variable enemy defense, buffs, and skill multiplier
const calculateDPSWithDefense = (
    attack: number,
    crit: number,
    critDamage: number,
    enemyDefense: number,
    defensePenetration: number,
    skillMultiplier: number,
    buffs: Buff[]
): number => {
    // Calculate buff totals
    const attackBuff = buffs
        .filter((b) => b.stat === 'attack')
        .reduce((sum, b) => sum + b.value, 0);
    const critBuff = buffs.filter((b) => b.stat === 'crit').reduce((sum, b) => sum + b.value, 0);
    const critDamageBuff = buffs
        .filter((b) => b.stat === 'critDamage')
        .reduce((sum, b) => sum + b.value, 0);
    const outgoingDamageBuff = buffs
        .filter((b) => b.stat === 'outgoingDamage')
        .reduce((sum, b) => sum + b.value, 0);

    // Apply buffs
    const effectiveAttack = attack * (1 + attackBuff / 100);
    const effectiveCrit = Math.min(100, crit + critBuff); // Cap at 100%
    const effectiveCritDamage = critDamage + critDamageBuff;

    const critMultiplier = calculateCritMultiplier({
        attack: effectiveAttack,
        crit: effectiveCrit,
        critDamage: effectiveCritDamage,
        defence: 0,
        hp: 0,
        hacking: 0,
        security: 0,
        speed: 0,
        healModifier: 0,
    });

    // Apply defense penetration to enemy defense
    const effectiveDefense = enemyDefense * (1 - defensePenetration / 100);

    // Calculate damage reduction based on effective defense
    const damageReduction = calculateDamageReduction(effectiveDefense);

    // Calculate base DPS with damage reduction
    const baseDPS = effectiveAttack * critMultiplier * (1 - damageReduction / 100);

    // Apply skill multiplier and outgoing damage buff
    return baseDPS * (skillMultiplier / 100) * (1 + outgoingDamageBuff / 100);
};

// Define the type for a buff
interface Buff {
    id: string;
    stat: 'attack' | 'crit' | 'critDamage' | 'outgoingDamage';
    value: number;
}

// Define the type for a ship configuration
interface ShipConfig {
    id: string;
    name: string;
    attack: number;
    crit: number;
    critDamage: number;
    defensePenetration: number;
    skillMultiplier: number;
    dps?: number;
}

const DPSCalculatorPage: React.FC = () => {
    const [configs, setConfigs] = useState<ShipConfig[]>([
        {
            id: '1',
            name: 'Ship 1',
            attack: 15000,
            crit: 100,
            critDamage: 125,
            defensePenetration: 0,
            skillMultiplier: 100,
        },
    ]);
    const [nextId, setNextId] = useState(2);
    const [enemyDefense, setEnemyDefense] = useState(10000);
    const [viewMode, setViewMode] = useState<'table' | 'heatmap'>('heatmap');
    const [buffs, setBuffs] = useState<Buff[]>([]);
    const [nextBuffId, setNextBuffId] = useState(1);

    // Calculate DPS for all configs on initial render
    useEffect(() => {
        // Skip the first render to avoid infinite loop
        // Calculate initial values
        const initialConfigs = configs.map((config) => {
            const dps = calculateDPSWithDefense(
                config.attack,
                config.crit,
                config.critDamage,
                enemyDefense,
                config.defensePenetration,
                config.skillMultiplier,
                buffs
            );
            return {
                ...config,
                dps,
            };
        });
        setConfigs(initialConfigs);
        return;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []); // Empty dependency array - we only want this to run once

    // Recalculate DPS when enemy defense or buffs change
    useEffect(() => {
        setConfigs((prevConfigs) =>
            prevConfigs.map((config) => {
                const dps = calculateDPSWithDefense(
                    config.attack,
                    config.crit,
                    config.critDamage,
                    enemyDefense,
                    config.defensePenetration,
                    config.skillMultiplier,
                    buffs
                );
                return {
                    ...config,
                    dps,
                };
            })
        );
    }, [enemyDefense, buffs]);

    // Add a new ship configuration
    const addConfig = () => {
        const newConfig: ShipConfig = {
            id: nextId.toString(),
            name: `Ship ${nextId}`,
            attack: 15000,
            crit: 100,
            critDamage: 150,
            defensePenetration: 0,
            skillMultiplier: 100,
        };

        // Calculate DPS for the new config
        const dps = calculateDPSWithDefense(
            newConfig.attack,
            newConfig.crit,
            newConfig.critDamage,
            enemyDefense,
            newConfig.defensePenetration,
            newConfig.skillMultiplier,
            buffs
        );

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
        field: 'name' | 'attack' | 'crit' | 'critDamage' | 'defensePenetration' | 'skillMultiplier',
        value: string | number
    ) => {
        const updatedConfigs = configs.map((config) => {
            if (config.id === id) {
                const updatedConfig = { ...config, [field]: value };

                // Recalculate DPS if any relevant stat changed
                if (
                    field === 'attack' ||
                    field === 'crit' ||
                    field === 'critDamage' ||
                    field === 'defensePenetration' ||
                    field === 'skillMultiplier'
                ) {
                    const dps = calculateDPSWithDefense(
                        updatedConfig.attack,
                        updatedConfig.crit,
                        updatedConfig.critDamage,
                        enemyDefense,
                        updatedConfig.defensePenetration,
                        updatedConfig.skillMultiplier,
                        buffs
                    );
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

    // Buff management functions
    const addBuff = () => {
        const newBuff: Buff = {
            id: nextBuffId.toString(),
            stat: 'attack',
            value: 0,
        };
        setBuffs([...buffs, newBuff]);
        setNextBuffId(nextBuffId + 1);
    };

    const removeBuff = (id: string) => {
        setBuffs(buffs.filter((buff) => buff.id !== id));
    };

    const updateBuff = (id: string, field: 'stat' | 'value', value: string | number) => {
        setBuffs(buffs.map((buff) => (buff.id === id ? { ...buff, [field]: value } : buff)));
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

    // Find the second best config
    const secondBestConfig = configs
        .filter((config) => config.id !== bestConfig?.id)
        .reduce(
            (best, current) => {
                if (!best || (current.dps && best.dps && current.dps > best.dps)) {
                    return current;
                }
                return best;
            },
            null as ShipConfig | null
        );

    // Calculate how much better the best is compared to second best
    const bestVsSecondPercentage =
        bestConfig?.dps && secondBestConfig?.dps
            ? ((bestConfig.dps - secondBestConfig.dps) / secondBestConfig.dps) * 100
            : null;

    const toggleViewMode = () => {
        setViewMode(viewMode === 'table' ? 'heatmap' : 'table');
    };

    return (
        <>
            <Seo {...SEO_CONFIG.damage} />
            <PageLayout
                title="DPS Calculator"
                description="Compare damage per hit calculations for different ship configurations."
                action={{
                    label: 'Add Ship',
                    onClick: addConfig,
                    variant: 'primary',
                }}
            >
                <div className="space-y-6">
                    <div className="card">
                        <h3 className="text-lg font-bold mb-4">Enemy Defense</h3>
                        <Input
                            label="Enemy Defense"
                            type="number"
                            value={enemyDefense}
                            onChange={(e) => setEnemyDefense(parseInt(e.target.value) || 0)}
                        />
                        <p className="text-sm text-gray-400 mt-2">
                            Common defense value that all ships will be calculated against
                        </p>
                    </div>

                    <div className="card">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-lg font-bold">Active Buffs</h3>
                            <Button variant="secondary" onClick={addBuff}>
                                Add Buff
                            </Button>
                        </div>
                        {buffs.length === 0 ? (
                            <p className="text-sm text-gray-400">No buffs active</p>
                        ) : (
                            <div className="space-y-2">
                                {buffs.map((buff) => (
                                    <div key={buff.id} className="flex items-center gap-2">
                                        <Select
                                            value={buff.stat}
                                            onChange={(value) =>
                                                updateBuff(buff.id, 'stat', value as Buff['stat'])
                                            }
                                            options={[
                                                { value: 'attack', label: 'Attack' },
                                                { value: 'crit', label: 'Crit Rate' },
                                                { value: 'critDamage', label: 'Crit Damage' },
                                                {
                                                    value: 'outgoingDamage',
                                                    label: 'Outgoing Damage',
                                                },
                                            ]}
                                            className="flex-1"
                                        />
                                        <Input
                                            type="number"
                                            value={buff.value}
                                            onChange={(e) =>
                                                updateBuff(
                                                    buff.id,
                                                    'value',
                                                    parseInt(e.target.value) || 0
                                                )
                                            }
                                            className="w-24"
                                        />
                                        <span className="text-gray-400">%</span>
                                        <Button
                                            variant="danger"
                                            size="sm"
                                            onClick={() => removeBuff(buff.id)}
                                            aria-label="Remove buff"
                                        >
                                            <CloseIcon />
                                        </Button>
                                    </div>
                                ))}
                            </div>
                        )}
                        <p className="text-sm text-gray-400 mt-2">
                            Buffs apply to all ships. Attack and Outgoing Damage are multiplicative,
                            Crit Rate and Crit Damage are additive.
                        </p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                                    <div className="flex gap-4">
                                        <Input
                                            label="Defense Penetration (%)"
                                            type="number"
                                            min="0"
                                            max="100"
                                            value={config.defensePenetration}
                                            onChange={(e) =>
                                                updateConfig(
                                                    config.id,
                                                    'defensePenetration',
                                                    parseInt(e.target.value) || 0
                                                )
                                            }
                                        />
                                        <Input
                                            label="Skill Multiplier (%)"
                                            type="number"
                                            min="0"
                                            value={config.skillMultiplier}
                                            onChange={(e) =>
                                                updateConfig(
                                                    config.id,
                                                    'skillMultiplier',
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
                                        <div className="text-sm mt-2 text-center">
                                            <span className="text-primary">
                                                Best ship configuration
                                            </span>
                                            {bestVsSecondPercentage !== null && (
                                                <span className="text-green-500 ml-2">
                                                    +{bestVsSecondPercentage.toFixed(2)}% vs #2
                                                </span>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>

                    <div className="card">
                        <div className="flex justify-between items-center mb-2">
                            <h3 className="text-lg font-bold">DPS Comparison</h3>
                            <Button variant="secondary" onClick={toggleViewMode}>
                                Switch to {viewMode === 'table' ? 'Contour Map' : 'Table'} View
                            </Button>
                        </div>
                        <p className="text-sm text-gray-400 mb-4">
                            This visualization shows DPS values at 100% crit rate for different
                            attack values (relative to your current attack) and crit damage
                            percentages.
                            {viewMode === 'table'
                                ? ' Each row shows how your DPS would scale with different attack values, and each column shows how it scales with different crit damage values.'
                                : ' The contour lines show combinations of attack and crit damage that produce equal DPS values. Follow these lines to find stat combinations that result in the same damage output.'}
                        </p>

                        {viewMode === 'table' ? (
                            <DPSCalculatorTable />
                        ) : (
                            <DPSChart
                                ships={configs.map((config) => ({
                                    ...config,
                                    critRate: config.crit,
                                    isBest: bestConfig ? config.id === bestConfig.id : false,
                                }))}
                            />
                        )}
                    </div>

                    {/* Defense Penetration Visualization */}
                    <div className="card">
                        <h3 className="text-lg font-bold mb-4">Defense Penetration</h3>
                        <p className="text-sm text-gray-400 mb-4">
                            Shows how defense penetration affects damage increase for different
                            enemy defense values. Hover over the lines to see exact values.
                        </p>

                        <DefensePenetrationChart height={400} />
                    </div>

                    <div className="card">
                        <h2 className="text-xl font-bold mb-4">About DPS Calculation</h2>
                        <p className="mb-2">
                            DPS (Damage Per Second) is calculated based on your attack value, crit
                            stats, and damage reduction using the formula:
                        </p>
                        <p className="mb-2 font-mono bg-dark-lighter p-2">
                            DPS = Attack × (1 + (CritRate/100) × (CritDamage/100)) × (1 -
                            DamageReduction/100)
                        </p>
                        <p className="mb-2">At 100% crit rate, the formula simplifies to:</p>
                        <p className="mb-2 font-mono bg-dark-lighter p-2">
                            DPS = Attack × (1 + CritDamage/100) × (1 - DamageReduction/100)
                        </p>
                        <p>
                            The visualization shows that while both attack and crit damage increase
                            your DPS linearly, the ideal balance depends on your current stats and
                            available gear options.
                        </p>
                    </div>
                </div>
            </PageLayout>
        </>
    );
};

export default DPSCalculatorPage;
