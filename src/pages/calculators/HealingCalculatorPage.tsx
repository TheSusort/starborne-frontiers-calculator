import React, { useState, useEffect, useRef } from 'react';
import { CloseIcon, PageLayout } from '../../components/ui';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import {
    LineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    Legend,
    ScatterChart,
    Scatter,
    ZAxis,
} from 'recharts';
import { BaseChart, ChartTooltip } from '../../components/ui/charts';
import Seo from '../../components/seo/Seo';
import { SEO_CONFIG } from '../../constants/seo';

// Base heal percent from constants
const BASE_HEAL_PERCENT = 0.15; // 15% of HP

// Define the type for a healer configuration
interface HealerConfig {
    id: string;
    name: string;
    hp: number;
    crit: number;
    critDamage: number;
    healModifier: number;
    healing?: number;
    healingWithCrit?: number;
    effectiveHealing?: number;
}

const calculateHealing = (config: HealerConfig) => {
    const baseHealing = config.hp * BASE_HEAL_PERCENT;

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
    { value: '20', label: '20%' },
    { value: '40', label: '40%' },
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
    const [configs, setConfigs] = useState<HealerConfig[]>([
        { id: '1', name: 'Healer 1', hp: 40000, crit: 50, critDamage: 100, healModifier: 20 },
    ]);
    const [nextId, setNextId] = useState(2);
    const initialRender = useRef(true);
    const [activeComparisonChart, setActiveComparisonChart] = useState<
        'hp' | 'crit' | 'critDamage' | 'healModifier'
    >('hp');
    const [showBubbleChart, setShowBubbleChart] = useState(false);

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
        field: 'name' | 'hp' | 'crit' | 'critDamage' | 'healModifier',
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
                description="Calculate effective healing based on HP, crit chance, crit power, and heal modifier"
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
                                className={`p-4 bg-dark border border-dark-border relative ${
                                    bestHealer && bestHealer.id === config.id
                                        ? 'border-primary'
                                        : ''
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
                                            <span className="text-gray-400">Base Healing:</span>
                                            <span>{config.healing?.toLocaleString()} HP</span>
                                        </div>
                                        <div className="flex justify-between mb-2">
                                            <span className="text-gray-400">
                                                Healing with Crits:
                                            </span>
                                            <span>
                                                {config.healingWithCrit?.toLocaleString()} HP
                                            </span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-gray-400">
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
                                                    <span className="text-gray-400">
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
                            <LineChart
                                data={getActiveComparisonData()}
                                margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                            >
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis
                                    dataKey={activeComparisonChart}
                                    label={{
                                        value: getActiveComparisonLabel(),
                                        position: 'insideBottomRight',
                                        offset: -10,
                                    }}
                                />
                                <YAxis
                                    label={{
                                        value: 'Healing (HP)',
                                        angle: -90,
                                        position: 'insideLeft',
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
                                <Legend />
                                {configs.map((config) => (
                                    <Line
                                        key={config.id}
                                        type="monotone"
                                        dataKey={config.name}
                                        stroke={
                                            config.id === bestHealer?.id ? '#8884d8' : '#82ca9d'
                                        }
                                        strokeWidth={config.id === bestHealer?.id ? 2 : 1}
                                        activeDot={{ r: 8 }}
                                    />
                                ))}
                            </LineChart>
                        </BaseChart>

                        <div className="mt-6 flex justify-center">
                            <Button
                                variant="secondary"
                                onClick={() => setShowBubbleChart(!showBubbleChart)}
                            >
                                {showBubbleChart ? 'Hide 3D Chart' : 'Show 3D Chart'}
                            </Button>
                        </div>

                        {showBubbleChart && (
                            <div className="mt-4">
                                <h3 className="text-lg font-bold mb-2">
                                    3D Relationship Visualization
                                </h3>
                                <p className="mb-4">
                                    This chart visualizes the relationship between HP (x-axis), Crit
                                    Chance (y-axis), and healing amount (bubble size). Each bubble
                                    represents a healer configuration.
                                </p>
                                <BaseChart height={384}>
                                    <ScatterChart
                                        margin={{ top: 20, right: 20, bottom: 20, left: 20 }}
                                    >
                                        <CartesianGrid />
                                        <XAxis
                                            type="number"
                                            dataKey="hp"
                                            name="HP"
                                            label={{
                                                value: 'HP',
                                                position: 'insideBottomRight',
                                                offset: -10,
                                            }}
                                        />
                                        <YAxis
                                            type="number"
                                            dataKey="crit"
                                            name="Crit Chance"
                                            label={{
                                                value: 'Crit Chance (%)',
                                                angle: -90,
                                                position: 'insideLeft',
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
                                                    formatter={(
                                                        value: number | string,
                                                        name: string
                                                    ) => {
                                                        if (name === 'Healing') {
                                                            return `${Math.round(Number(value)).toLocaleString()} HP`;
                                                        }
                                                        return String(value);
                                                    }}
                                                />
                                            }
                                            cursor={{ strokeDasharray: '3 3' }}
                                        />
                                        <Legend />
                                        <Scatter
                                            name="Healers"
                                            data={generateBubbleChartData()}
                                            fill="#8884d8"
                                        />
                                    </ScatterChart>
                                </BaseChart>
                            </div>
                        )}
                    </div>

                    <div className="card">
                        <h2 className="text-xl font-bold mb-4">Healing Formula Explanation</h2>
                        <p className="mb-2">
                            Healing is calculated based on the healer&apos;s HP, critical hit
                            chance, critical hit power, and healing modifier. We are using 15% as an
                            example.
                        </p>
                        <p className="mb-2">The formula for calculating Effective Healing is:</p>
                        <p className="mb-2 font-mono bg-dark-lighter p-2">
                            Base Healing = HP × 15%
                            <br />
                            Crit Multiplier = 1 + (Crit Chance% × Crit Power%) / 10000
                            <br />
                            Effective Healing = Base Healing × Crit Multiplier × (1 + Heal Modifier%
                            / 100)
                        </p>
                        <p>
                            For example, a ship with 40,000 HP, 50% crit chance, 100% crit power,
                            and 20% heal modifier has an effective healing of 7,200 HP per heal.
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
