import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
    LineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ScatterChart,
    Scatter,
    ZAxis,
} from 'recharts';
import { CloseIcon, PageLayout } from '../../components/ui';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import {
    BaseChart,
    ChartLegend,
    ChartTooltip,
    LINE_CHART_MARGIN,
    chartLineDefaults,
} from '../../components/ui/charts';
import { useThemeColors } from '../../hooks/useThemeColors';
import Seo from '../../components/seo/Seo';
import { SEO_CONFIG } from '../../constants/seo';
import { useShips } from '../../contexts/ShipsContext';
import { useInventory } from '../../contexts/InventoryProvider';
import { useEngineeringStats } from '../../hooks/useEngineeringStats';
import { calculateTotalStats } from '../../utils/ship/statsCalculator';
import { Ship } from '../../types/ship';
import { ShipSelector } from '../../components/ship/ShipSelector';

// Define the type for a healer configuration
interface HealerConfig {
    id: string;
    shipId?: string; // links config to a selected player ship
    name: string;
    hp: number;
    healPercent: number; // Base healing percentage (e.g., 15 for 15%)
    crit: number;
    critDamage: number;
    healModifier: number;
    healing?: number;
    healingWithCrit?: number;
    effectiveHealing?: number;
}

const calculateHealing = (config: HealerConfig) => {
    const healPercentDecimal = (config.healPercent || 15) / 100; // Convert percentage to decimal
    const baseHealing = config.hp * healPercentDecimal;

    // Calculate crit multiplier
    const critRate = config.crit >= 100 ? 1 : config.crit / 100;
    const critMultiplier = 1 + (critRate * config.critDamage) / 100;

    // Apply heal modifier after crit calculations
    const healModifier = config.healModifier || 0;
    const effectiveHealing = baseHealing * critMultiplier * (1 + healModifier / 100);

    return {
        baseHealing,
        critMultiplier,
        effectiveHealing,
    };
};

// Heal modifier options
const healModifierOptions = [
    { value: '0', label: '0%' },
    { value: '10', label: '10%' },
    { value: '20', label: '20%' },
    { value: '30', label: '30%' },
    { value: '40', label: '40%' },
    { value: '50', label: '50%' },
    { value: '60', label: '60%' },
];

// Chart comparison options
const comparisonChartOptions = [
    { value: 'hp', label: 'HP Impact' },
    { value: 'crit', label: 'Crit Chance Impact' },
    { value: 'critDamage', label: 'Crit Power Impact' },
    { value: 'healModifier', label: 'Heal Modifier Impact' },
];

const HealingCalculatorPage: React.FC = () => {
    const [searchParams, setSearchParams] = useSearchParams();
    const { getShipById } = useShips();
    const { getGearPiece } = useInventory();
    const { getEngineeringStatsForShipType } = useEngineeringStats();
    const shipInitialized = useRef(false);
    const themeColors = useThemeColors();

    const getInitialConfig = (): HealerConfig[] => {
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
                const final = statsBreakdown.final;
                return [
                    {
                        id: '1',
                        shipId: ship.id,
                        name: ship.name,
                        hp: Math.round(final.hp),
                        healPercent: 15,
                        crit: Math.round(final.crit),
                        critDamage: Math.round(final.critDamage),
                        healModifier: 0,
                    },
                ];
            }
        }
        return [
            {
                id: '1',
                name: 'Healer 1',
                hp: 40000,
                healPercent: 15,
                crit: 50,
                critDamage: 100,
                healModifier: 20,
            },
        ];
    };

    const [initialConfigs] = useState(getInitialConfig);
    const [configs, setConfigs] = useState<HealerConfig[]>(initialConfigs);
    const [nextId, setNextId] = useState(2);
    const initialRender = useRef(true);

    // Clear shipId from URL after initialization
    useEffect(() => {
        if (shipInitialized.current) return;
        shipInitialized.current = true;
        if (searchParams.has('shipId')) {
            searchParams.delete('shipId');
            setSearchParams(searchParams, { replace: true });
        }
    }, [searchParams, setSearchParams]);
    const [activeComparisonChart, setActiveComparisonChart] = useState<
        'hp' | 'crit' | 'critDamage' | 'healModifier'
    >('hp');

    // Calculate healing values for all configs
    useEffect(() => {
        // Skip the first render to avoid infinite loop
        if (initialRender.current) {
            initialRender.current = false;

            // Calculate initial values
            const initialConfigs = configs.map((config) => {
                const { baseHealing, critMultiplier, effectiveHealing } = calculateHealing(config);
                return {
                    ...config,
                    healing: baseHealing,
                    healingWithCrit: baseHealing * critMultiplier,
                    effectiveHealing,
                };
            });
            setConfigs(initialConfigs);
            return;
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []); // Empty dependency array to run only once

    // Add a new healer configuration
    const addConfig = () => {
        const newConfig: HealerConfig = {
            id: nextId.toString(),
            name: `Healer ${nextId}`,
            hp: 40000,
            healPercent: 15,
            crit: 50,
            critDamage: 100,
            healModifier: 20,
        };

        // Calculate values for the new config
        const { baseHealing, critMultiplier, effectiveHealing } = calculateHealing(newConfig);

        setConfigs([
            ...configs,
            {
                ...newConfig,
                healing: baseHealing,
                healingWithCrit: baseHealing * critMultiplier,
                effectiveHealing,
            },
        ]);
        setNextId(nextId + 1);
    };

    // Remove a healer configuration
    const removeConfig = (id: string) => {
        setConfigs(configs.filter((config) => config.id !== id));
    };

    // Update a healer configuration
    const updateConfig = (
        id: string,
        field: 'name' | 'hp' | 'healPercent' | 'crit' | 'critDamage' | 'healModifier',
        value: string | number
    ) => {
        const updatedConfigs = configs.map((config) => {
            if (config.id === id) {
                const updatedConfig = { ...config, [field]: value };

                // Recalculate healing values
                const { baseHealing, critMultiplier, effectiveHealing } =
                    calculateHealing(updatedConfig);

                return {
                    ...updatedConfig,
                    healing: baseHealing,
                    healingWithCrit: baseHealing * critMultiplier,
                    effectiveHealing,
                };
            }
            return config;
        });

        setConfigs(updatedConfigs);
    };

    const selectShipForConfig = (configId: string, ship: Ship) => {
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
        const final = statsBreakdown.final;
        setConfigs((prev) =>
            prev.map((c) => {
                if (c.id !== configId) return c;
                const updated = {
                    ...c,
                    shipId: ship.id,
                    name: ship.name,
                    hp: Math.round(final.hp),
                    crit: Math.round(final.crit),
                    critDamage: Math.round(final.critDamage),
                };
                const { baseHealing, critMultiplier, effectiveHealing } = calculateHealing(updated);
                return {
                    ...updated,
                    healing: baseHealing,
                    healingWithCrit: baseHealing * critMultiplier,
                    effectiveHealing,
                };
            })
        );
    };

    // Generate data for HP impact chart
    const generateHPComparisonData = () => {
        const hpValues = [
            10000, 20000, 30000, 40000, 50000, 60000, 70000, 80000, 90000, 100000, 110000, 120000,
        ];

        return hpValues.map((hp) => {
            const data: Record<string, number> = { hp };

            configs.forEach((config) => {
                // Create a temporary config with different HP
                const tempConfig = { ...config, hp };
                const { effectiveHealing } = calculateHealing(tempConfig);
                data[config.name] = effectiveHealing;
            });

            return data;
        });
    };

    // Generate data for crit impact chart
    const generateCritComparisonData = () => {
        const critValues = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

        return critValues.map((crit) => {
            const data: Record<string, number> = { crit };

            configs.forEach((config) => {
                // Create a temporary config with different crit
                const tempConfig = { ...config, crit };
                const { effectiveHealing } = calculateHealing(tempConfig);
                data[config.name] = effectiveHealing;
            });

            return data;
        });
    };

    // Generate data for critDamage impact chart
    const generateCritDamageComparisonData = () => {
        const critDamageValues = [0, 20, 40, 60, 80, 100, 120, 140, 160, 180, 200];

        return critDamageValues.map((critDamage) => {
            const data: Record<string, number> = { critDamage };

            configs.forEach((config) => {
                // Create a temporary config with different critDamage
                const tempConfig = { ...config, critDamage };
                const { effectiveHealing } = calculateHealing(tempConfig);
                data[config.name] = effectiveHealing;
            });

            return data;
        });
    };

    // Generate data for healModifier impact chart
    const generateHealModifierComparisonData = () => {
        const healModifierValues = [0, 20, 40, 60];

        return healModifierValues.map((healModifier) => {
            const data: Record<string, number> = { healModifier };

            configs.forEach((config) => {
                // Create a temporary config with different healModifier
                const tempConfig = { ...config, healModifier };
                const { effectiveHealing } = calculateHealing(tempConfig);
                data[config.name] = effectiveHealing;
            });

            return data;
        });
    };

    // Generate data for 3D bubble chart (HP, Crit, HealModifier)
    const generateBubbleChartData = () => {
        return configs.map((config) => ({
            name: config.name,
            hp: config.hp,
            crit: config.crit,
            critDamage: config.critDamage,
            healModifier: config.healModifier,
            healing: config.effectiveHealing || 0,
        }));
    };

    // Get the active comparison data based on selected chart
    const getActiveComparisonData = () => {
        switch (activeComparisonChart) {
            case 'hp':
                return generateHPComparisonData();
            case 'crit':
                return generateCritComparisonData();
            case 'critDamage':
                return generateCritDamageComparisonData();
            case 'healModifier':
                return generateHealModifierComparisonData();
            default:
                return [];
        }
    };

    // Get the label for the active comparison chart
    const getActiveComparisonLabel = () => {
        switch (activeComparisonChart) {
            case 'hp':
                return 'HP';
            case 'crit':
                return 'Crit Chance (%)';
            case 'critDamage':
                return 'Crit Power (%)';
            case 'healModifier':
                return 'Heal Modifier (%)';
            default:
                return '';
        }
    };

    // Find the healer with highest effective healing
    const bestHealer = configs.reduce(
        (best, current) => {
            if (
                !best ||
                (current.effectiveHealing &&
                    best.effectiveHealing &&
                    current.effectiveHealing > best.effectiveHealing)
            ) {
                return current;
            }
            return best;
        },
        null as HealerConfig | null
    );

    return (
        <>
            <Seo {...SEO_CONFIG.healing} />
            <PageLayout
                title="Healing Calculator"
                description="Calculate effective healing based on HP, base heal percentage, crit chance, crit power, and heal modifier"
                action={{
                    label: 'Add Healer',
                    onClick: addConfig,
                    variant: 'primary',
                }}
            >
                <div className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {configs.map((config) => (
                            <div
                                key={config.id}
                                className={`card relative ${
                                    bestHealer && bestHealer.id === config.id
                                        ? 'border-primary'
                                        : ''
                                }`}
                            >
                                <div className="mb-4">
                                    <ShipSelector
                                        selected={
                                            config.shipId
                                                ? (getShipById(config.shipId) ?? null)
                                                : null
                                        }
                                        onSelect={(ship) => selectShipForConfig(config.id, ship)}
                                        variant="compact"
                                    />
                                </div>
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
                                        aria-label="Remove healer"
                                    >
                                        <CloseIcon />
                                    </Button>
                                </div>

                                <div className="space-y-4">
                                    <div className="grid grid-cols-2 gap-4">
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
                                            label="Heal % (of HP)"
                                            type="number"
                                            min="0"
                                            max="100"
                                            step="0.1"
                                            value={config.healPercent}
                                            onChange={(e) =>
                                                updateConfig(
                                                    config.id,
                                                    'healPercent',
                                                    parseFloat(e.target.value) || 0
                                                )
                                            }
                                        />
                                        <Input
                                            label="Crit Chance (%)"
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
                                            label="Crit Power (%)"
                                            type="number"
                                            min="0"
                                            max="200"
                                            value={config.critDamage}
                                            onChange={(e) =>
                                                updateConfig(
                                                    config.id,
                                                    'critDamage',
                                                    parseInt(e.target.value) || 0
                                                )
                                            }
                                        />
                                        <Select
                                            label="Heal Modifier (%)"
                                            className="w-fit"
                                            value={config.healModifier.toString()}
                                            options={healModifierOptions}
                                            onChange={(value) =>
                                                updateConfig(
                                                    config.id,
                                                    'healModifier',
                                                    parseInt(value) || 0
                                                )
                                            }
                                        />
                                    </div>

                                    <div className="mt-4 pt-4 border-t border-dark-border">
                                        <div className="flex justify-between mb-2">
                                            <span className="text-theme-text-secondary">
                                                Base Healing:
                                            </span>
                                            <span>{config.healing?.toLocaleString()} HP</span>
                                        </div>
                                        <div className="flex justify-between mb-2">
                                            <span className="text-theme-text-secondary">
                                                Healing with Crits:
                                            </span>
                                            <span>
                                                {config.healingWithCrit?.toLocaleString()} HP
                                            </span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-theme-text-secondary">
                                                Effective Healing:
                                            </span>
                                            <span
                                                className={
                                                    bestHealer && bestHealer.id === config.id
                                                        ? 'text-primary font-bold'
                                                        : ''
                                                }
                                            >
                                                {config.effectiveHealing?.toLocaleString()} HP
                                            </span>
                                        </div>
                                        {bestHealer &&
                                            bestHealer.id !== config.id &&
                                            bestHealer.effectiveHealing &&
                                            config.effectiveHealing && (
                                                <div className="flex justify-between mt-2">
                                                    <span className="text-theme-text-secondary">
                                                        Compared to best:
                                                    </span>
                                                    <span className="text-red-500">
                                                        {(
                                                            ((config.effectiveHealing -
                                                                bestHealer.effectiveHealing) /
                                                                bestHealer.effectiveHealing) *
                                                            100
                                                        ).toFixed(2)}
                                                        %
                                                    </span>
                                                </div>
                                            )}
                                    </div>

                                    {bestHealer && bestHealer.id === config.id && (
                                        <div className="text-primary text-sm mt-2 text-center">
                                            Best healer configuration
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>

                    <div className="card">
                        <h2 className="text-xl font-bold mb-2">3D Relationship Visualization</h2>
                        <p className="mb-4">
                            This chart visualizes the relationship between HP (x-axis), Crit Chance
                            (y-axis), and healing amount (bubble size). Each bubble represents a
                            healer configuration.
                        </p>
                        <BaseChart height={384}>
                            <ScatterChart margin={LINE_CHART_MARGIN}>
                                <CartesianGrid
                                    strokeDasharray="3 3"
                                    stroke={themeColors.gridStroke}
                                />
                                <XAxis
                                    type="number"
                                    dataKey="hp"
                                    name="HP"
                                    tick={{ fill: themeColors.text }}
                                    tickFormatter={(v: number) =>
                                        v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)
                                    }
                                    label={{
                                        value: 'HP',
                                        position: 'insideBottom',
                                        offset: -10,
                                        fill: themeColors.text,
                                    }}
                                />
                                <YAxis
                                    type="number"
                                    dataKey="crit"
                                    name="Crit Chance"
                                    tick={{ fill: themeColors.text }}
                                    label={{
                                        value: 'Crit Chance (%)',
                                        angle: -90,
                                        position: 'insideLeft',
                                        fill: themeColors.text,
                                    }}
                                />
                                <ZAxis
                                    type="number"
                                    dataKey="healing"
                                    range={[100, 1000]}
                                    name="Healing"
                                />
                                <Tooltip
                                    content={
                                        <ChartTooltip
                                            formatter={(value: number | string, name: string) => {
                                                if (name === 'Healing') {
                                                    return `${Math.round(Number(value)).toLocaleString()} HP`;
                                                }
                                                return String(value);
                                            }}
                                        />
                                    }
                                    cursor={{ strokeDasharray: '3 3' }}
                                />
                                <Scatter
                                    name="Healers"
                                    data={generateBubbleChartData()}
                                    fill="#8884d8"
                                />
                            </ScatterChart>
                        </BaseChart>
                        <ChartLegend items={[{ label: 'Healers', color: '#8884d8' }]} />
                    </div>

                    <div className="card">
                        <div className="flex justify-between items-center mb-4">
                            <h2 className="text-xl font-bold w-full">Healing Comparison Chart</h2>
                            <Select
                                value={activeComparisonChart}
                                options={comparisonChartOptions}
                                onChange={(value) =>
                                    setActiveComparisonChart(
                                        value as 'hp' | 'crit' | 'critDamage' | 'healModifier'
                                    )
                                }
                                className="w-60"
                            />
                        </div>
                        <p className="mb-4">
                            This chart shows how changing {getActiveComparisonLabel()} affects
                            healing output, while keeping other values constant.
                        </p>
                        <BaseChart height={384}>
                            <LineChart data={getActiveComparisonData()} margin={LINE_CHART_MARGIN}>
                                <CartesianGrid
                                    strokeDasharray="3 3"
                                    stroke={themeColors.gridStroke}
                                />
                                <XAxis
                                    dataKey={activeComparisonChart}
                                    tick={{ fill: themeColors.text }}
                                    tickFormatter={(v: number) =>
                                        v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)
                                    }
                                    label={{
                                        value: getActiveComparisonLabel(),
                                        position: 'insideBottom',
                                        offset: -10,
                                        fill: themeColors.text,
                                    }}
                                />
                                <YAxis
                                    tick={{ fill: themeColors.text }}
                                    tickFormatter={(v: number) =>
                                        v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)
                                    }
                                    label={{
                                        value: 'Healing (HP)',
                                        angle: -90,
                                        position: 'insideLeft',
                                        fill: themeColors.text,
                                    }}
                                />
                                <Tooltip
                                    content={
                                        <ChartTooltip
                                            formatter={(value: number | string) =>
                                                Math.round(Number(value)).toLocaleString()
                                            }
                                        />
                                    }
                                />
                                {configs.map((config) => {
                                    const color =
                                        config.id === bestHealer?.id ? '#8884d8' : '#82ca9d';
                                    return (
                                        <Line
                                            key={config.id}
                                            type="monotone"
                                            dataKey={config.name}
                                            stroke={color}
                                            {...chartLineDefaults(color)}
                                            strokeWidth={config.id === bestHealer?.id ? 2 : 1}
                                        />
                                    );
                                })}
                            </LineChart>
                        </BaseChart>
                        <ChartLegend
                            items={configs.map((config) => ({
                                label: config.name,
                                color: config.id === bestHealer?.id ? '#8884d8' : '#82ca9d',
                            }))}
                        />
                    </div>

                    <div className="card">
                        <h2 className="text-xl font-bold mb-4">Healing Formula Explanation</h2>
                        <p className="mb-2">
                            Healing is calculated based on the healer&apos;s HP, base healing
                            percentage (configurable per ship), critical hit chance, critical hit
                            power, and healing modifier.
                        </p>
                        <p className="mb-2">The formula for calculating Effective Healing is:</p>
                        <p className="mb-2 font-mono bg-dark-lighter p-2">
                            Base Healing = HP × Heal %
                            <br />
                            Crit Multiplier = 1 + (Crit Chance% × Crit Power%) / 10000
                            <br />
                            Effective Healing = Base Healing × Crit Multiplier × (1 + Heal Modifier%
                            / 100)
                        </p>
                        <p>
                            For example, a ship with 40,000 HP, 15% base heal, 50% crit chance, 100%
                            crit power, and 20% heal modifier has an effective healing of 7,200 HP
                            per heal.
                        </p>
                    </div>

                    <div className="card">
                        <h2 className="text-xl font-bold mb-4">Optimization Recommendations</h2>
                        <ul className="list-disc pl-5 space-y-2">
                            <li>
                                <strong>HP:</strong> Increasing HP provides the most consistent
                                improvement to healing output.
                            </li>
                            <li>
                                <strong>Crit Stats:</strong> Balancing crit chance and crit power
                                yields better results than maximizing only one of them. For optimal
                                results, try to maintain a 1:2 ratio between crit chance and crit
                                power.
                            </li>
                            <li>
                                <strong>Heal Modifier:</strong> This stat applies multiplicatively
                                after all other calculations, making it extremely valuable.
                                Prioritize gear with heal modifiers when possible.
                            </li>
                        </ul>
                    </div>
                </div>
            </PageLayout>
        </>
    );
};

export default HealingCalculatorPage;
