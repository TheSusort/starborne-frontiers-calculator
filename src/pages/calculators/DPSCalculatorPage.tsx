import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CloseIcon, PageLayout } from '../../components/ui';
import { calculateCritMultiplier } from '../../utils/autogear/scoring';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { DPSCalculatorTable } from '../../components/calculator/DPSCalculatorTable';
import { DPSChart } from '../../components/calculator/DPSChart';
import { DefensePenetrationChart } from '../../components/calculator/DefensePenetrationChart';
import { DPSRoundChart } from '../../components/calculator/DPSRoundChart';
import { CollapsibleAccordion } from '../../components/ui/CollapsibleAccordion';
import Seo from '../../components/seo/Seo';
import { SEO_CONFIG } from '../../constants/seo';
import { useShips } from '../../contexts/ShipsContext';
import { useInventory } from '../../contexts/InventoryProvider';
import { useEngineeringStats } from '../../hooks/useEngineeringStats';
import { calculateTotalStats } from '../../utils/ship/statsCalculator';
import { Buff, DoTApplicationConfig, DEFAULT_DOT_CONFIG } from '../../types/calculator';
import { simulateDPS, DPSSimulationResult } from '../../utils/calculators/dpsSimulator';

// Define the type for a ship configuration
interface ShipConfig {
    id: string;
    name: string;
    attack: number;
    crit: number;
    critDamage: number;
    defensePenetration: number;
    activeMultiplier: number;
    chargedMultiplier: number;
    chargeCount: number;
    activeDoTs: DoTApplicationConfig;
    chargedDoTs: DoTApplicationConfig;
    advancedOpen: boolean;
}

const CORROSION_TIER_OPTIONS = [
    { value: '0', label: 'None' },
    { value: '3', label: 'I (3%)' },
    { value: '6', label: 'II (6%)' },
    { value: '9', label: 'III (9%)' },
];
const INFERNO_TIER_OPTIONS = [
    { value: '0', label: 'None' },
    { value: '15', label: 'I (15%)' },
    { value: '30', label: 'II (30%)' },
    { value: '45', label: 'III (45%)' },
];
const BOMB_TIER_OPTIONS = [
    { value: '0', label: 'None' },
    { value: '100', label: 'I (100%)' },
    { value: '200', label: 'II (200%)' },
    { value: '300', label: 'III (300%)' },
];

const DPSCalculatorPage: React.FC = () => {
    const [searchParams, setSearchParams] = useSearchParams();
    const { getShipById } = useShips();
    const { getGearPiece } = useInventory();
    const { getEngineeringStatsForShipType } = useEngineeringStats();
    const shipInitialized = useRef(false);

    const getInitialConfig = (): { configs: ShipConfig[]; nextId: number } => {
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
                return {
                    configs: [
                        {
                            id: '1',
                            name: ship.name,
                            attack: Math.round(final.attack),
                            crit: Math.round(final.crit),
                            critDamage: Math.round(final.critDamage),
                            defensePenetration: Math.round(final.defensePenetration || 0),
                            activeMultiplier: 100,
                            chargedMultiplier: 0,
                            chargeCount: 0,
                            activeDoTs: { ...DEFAULT_DOT_CONFIG },
                            chargedDoTs: { ...DEFAULT_DOT_CONFIG },
                            advancedOpen: false,
                        },
                    ],
                    nextId: 2,
                };
            }
        }
        return {
            configs: [
                {
                    id: '1',
                    name: 'Ship 1',
                    attack: 15000,
                    crit: 100,
                    critDamage: 125,
                    defensePenetration: 0,
                    activeMultiplier: 100,
                    chargedMultiplier: 0,
                    chargeCount: 0,
                    activeDoTs: { ...DEFAULT_DOT_CONFIG },
                    chargedDoTs: { ...DEFAULT_DOT_CONFIG },
                    advancedOpen: false,
                },
            ],
            nextId: 2,
        };
    };

    const initial = getInitialConfig();
    const [configs, setConfigs] = useState<ShipConfig[]>(initial.configs);
    const [nextId, setNextId] = useState(initial.nextId);
    const [enemyDefense, setEnemyDefense] = useState(10000);
    const [enemyHp, setEnemyHp] = useState(500000);
    const [rounds, setRounds] = useState(20);
    const [viewMode, setViewMode] = useState<'table' | 'heatmap'>('heatmap');
    const [buffs, setBuffs] = useState<Buff[]>([]);
    const [nextBuffId, setNextBuffId] = useState(1);

    // Clear shipId from URL after initialization to avoid re-triggering
    useEffect(() => {
        if (shipInitialized.current) return;
        shipInitialized.current = true;
        if (searchParams.has('shipId')) {
            searchParams.delete('shipId');
            setSearchParams(searchParams, { replace: true });
        }
    }, [searchParams, setSearchParams]);

    // Simulate DPS for all configs
    const simResults = useMemo(() => {
        const map = new Map<string, DPSSimulationResult>();
        configs.forEach((config) => {
            map.set(
                config.id,
                simulateDPS({
                    attack: config.attack,
                    crit: config.crit,
                    critDamage: config.critDamage,
                    defensePenetration: config.defensePenetration,
                    activeMultiplier: config.activeMultiplier,
                    chargedMultiplier: config.chargedMultiplier,
                    chargeCount: config.chargeCount,
                    activeDoTs: config.activeDoTs,
                    chargedDoTs: config.chargedDoTs,
                    enemyDefense,
                    enemyHp,
                    rounds,
                    buffs,
                })
            );
        });
        return map;
    }, [configs, enemyDefense, enemyHp, rounds, buffs]);

    // Add a new ship configuration
    const addConfig = () => {
        const newConfig: ShipConfig = {
            id: nextId.toString(),
            name: `Ship ${nextId}`,
            attack: 15000,
            crit: 100,
            critDamage: 150,
            defensePenetration: 0,
            activeMultiplier: 100,
            chargedMultiplier: 0,
            chargeCount: 0,
            activeDoTs: { ...DEFAULT_DOT_CONFIG },
            chargedDoTs: { ...DEFAULT_DOT_CONFIG },
            advancedOpen: false,
        };
        setConfigs([...configs, newConfig]);
        setNextId(nextId + 1);
    };

    // Remove a ship configuration
    const removeConfig = (id: string) => {
        setConfigs(configs.filter((config) => config.id !== id));
    };

    // Update a ship configuration
    const updateConfig = (
        id: string,
        field:
            | 'name'
            | 'attack'
            | 'crit'
            | 'critDamage'
            | 'defensePenetration'
            | 'activeMultiplier'
            | 'chargedMultiplier'
            | 'chargeCount'
            | 'advancedOpen',
        value: string | number | boolean
    ) => {
        setConfigs((prev) =>
            prev.map((config) => (config.id === id ? { ...config, [field]: value } : config))
        );
    };

    const updateDoTConfig = (
        configId: string,
        dotField: 'activeDoTs' | 'chargedDoTs',
        key: keyof DoTApplicationConfig,
        value: number
    ) => {
        setConfigs((prev) =>
            prev.map((c) =>
                c.id === configId ? { ...c, [dotField]: { ...c[dotField], [key]: value } } : c
            )
        );
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

    // Find the config with the highest total damage
    const bestConfig = configs.reduce<ShipConfig | null>((best, current) => {
        if (!best) return current;
        const bestDmg = simResults.get(best.id)?.summary.totalDamage ?? 0;
        const currentDmg = simResults.get(current.id)?.summary.totalDamage ?? 0;
        return currentDmg > bestDmg ? current : best;
    }, null);

    const secondBestConfig = configs
        .filter((config) => config.id !== bestConfig?.id)
        .reduce<ShipConfig | null>((best, current) => {
            if (!best) return current;
            const bestDmg = simResults.get(best.id)?.summary.totalDamage ?? 0;
            const currentDmg = simResults.get(current.id)?.summary.totalDamage ?? 0;
            return currentDmg > bestDmg ? current : best;
        }, null);

    const bestDmg = simResults.get(bestConfig?.id ?? '')?.summary.totalDamage;
    const secondBestDmg = simResults.get(secondBestConfig?.id ?? '')?.summary.totalDamage;
    const bestVsSecondPercentage =
        bestDmg && secondBestDmg ? ((bestDmg - secondBestDmg) / secondBestDmg) * 100 : null;

    const toggleViewMode = () => {
        setViewMode(viewMode === 'table' ? 'heatmap' : 'table');
    };

    return (
        <>
            <Seo {...SEO_CONFIG.damage} />
            <PageLayout
                title="DPS Calculator"
                description="Compare damage output across different ship configurations and combat scenarios."
                action={{
                    label: 'Add Ship',
                    onClick: addConfig,
                    variant: 'primary',
                }}
            >
                <div className="space-y-6">
                    <div className="card">
                        <h3 className="text-lg font-bold mb-4">Combat Settings</h3>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <Input
                                label="Enemy Defense"
                                type="number"
                                value={enemyDefense}
                                onChange={(e) => setEnemyDefense(parseInt(e.target.value) || 0)}
                            />
                            <Input
                                label="Enemy HP"
                                type="number"
                                value={enemyHp}
                                onChange={(e) => setEnemyHp(parseInt(e.target.value) || 0)}
                            />
                            <Input
                                label="Rounds"
                                type="number"
                                min="1"
                                max="50"
                                value={rounds}
                                onChange={(e) =>
                                    setRounds(
                                        Math.max(1, Math.min(50, parseInt(e.target.value) || 1))
                                    )
                                }
                            />
                        </div>
                        <p className="text-sm text-theme-text-secondary mt-2">
                            Shared combat settings applied to all ship configurations
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
                            <p className="text-sm text-theme-text-secondary">No buffs active</p>
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
                                                { value: 'critDamage', label: 'Crit Power' },
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
                                        <span className="text-theme-text-secondary">%</span>
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
                        <p className="text-sm text-theme-text-secondary mt-2">
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
                                    </div>

                                    <button
                                        className="w-full flex justify-between items-center p-2 mt-4 bg-dark-lighter border border-dark-border hover:bg-dark-lighter/80"
                                        onClick={() =>
                                            updateConfig(
                                                config.id,
                                                'advancedOpen',
                                                !config.advancedOpen
                                            )
                                        }
                                    >
                                        <span className="font-semibold text-sm">Advanced</span>
                                        <span className="text-theme-text-secondary text-xs">
                                            {config.advancedOpen ? '▼' : '▶'}
                                        </span>
                                    </button>
                                    <CollapsibleAccordion isOpen={config.advancedOpen}>
                                        {/* Skills section */}
                                        <div className="text-xs font-semibold text-primary uppercase tracking-wide mb-2">
                                            Skills
                                        </div>
                                        <div className="grid grid-cols-3 gap-4 mb-4">
                                            <Input
                                                label="Active (%)"
                                                type="number"
                                                min="0"
                                                value={config.activeMultiplier}
                                                onChange={(e) =>
                                                    updateConfig(
                                                        config.id,
                                                        'activeMultiplier',
                                                        parseInt(e.target.value) || 0
                                                    )
                                                }
                                            />
                                            <Input
                                                label="Charged (%)"
                                                type="number"
                                                min="0"
                                                value={config.chargedMultiplier}
                                                onChange={(e) =>
                                                    updateConfig(
                                                        config.id,
                                                        'chargedMultiplier',
                                                        parseInt(e.target.value) || 0
                                                    )
                                                }
                                            />
                                            <Input
                                                label="Charge Count"
                                                type="number"
                                                min="0"
                                                value={config.chargeCount}
                                                onChange={(e) =>
                                                    updateConfig(
                                                        config.id,
                                                        'chargeCount',
                                                        parseInt(e.target.value) || 0
                                                    )
                                                }
                                            />
                                        </div>

                                        {/* DoTs — Active Skill */}
                                        <div className="text-xs font-semibold text-orange-400 uppercase tracking-wide mb-2">
                                            DoTs — Active Skill
                                        </div>
                                        <div className="space-y-3 mb-4">
                                            <div className="grid grid-cols-2 gap-4">
                                                <Select
                                                    label="Corrosion Tier"
                                                    options={CORROSION_TIER_OPTIONS}
                                                    value={String(config.activeDoTs.corrosionTier)}
                                                    onChange={(v) =>
                                                        updateDoTConfig(
                                                            config.id,
                                                            'activeDoTs',
                                                            'corrosionTier',
                                                            parseInt(v)
                                                        )
                                                    }
                                                />
                                                <Input
                                                    label="Stacks / use"
                                                    type="number"
                                                    min="0"
                                                    value={config.activeDoTs.corrosionStacks}
                                                    onChange={(e) =>
                                                        updateDoTConfig(
                                                            config.id,
                                                            'activeDoTs',
                                                            'corrosionStacks',
                                                            parseInt(e.target.value) || 0
                                                        )
                                                    }
                                                />
                                            </div>
                                            <div className="grid grid-cols-2 gap-4">
                                                <Select
                                                    label="Inferno Tier"
                                                    options={INFERNO_TIER_OPTIONS}
                                                    value={String(config.activeDoTs.infernoTier)}
                                                    onChange={(v) =>
                                                        updateDoTConfig(
                                                            config.id,
                                                            'activeDoTs',
                                                            'infernoTier',
                                                            parseInt(v)
                                                        )
                                                    }
                                                />
                                                <Input
                                                    label="Stacks / use"
                                                    type="number"
                                                    min="0"
                                                    value={config.activeDoTs.infernoStacks}
                                                    onChange={(e) =>
                                                        updateDoTConfig(
                                                            config.id,
                                                            'activeDoTs',
                                                            'infernoStacks',
                                                            parseInt(e.target.value) || 0
                                                        )
                                                    }
                                                />
                                            </div>
                                            <div className="grid grid-cols-3 gap-4">
                                                <Select
                                                    label="Bomb Tier"
                                                    options={BOMB_TIER_OPTIONS}
                                                    value={String(config.activeDoTs.bombTier)}
                                                    onChange={(v) =>
                                                        updateDoTConfig(
                                                            config.id,
                                                            'activeDoTs',
                                                            'bombTier',
                                                            parseInt(v)
                                                        )
                                                    }
                                                />
                                                <Input
                                                    label="Stacks / use"
                                                    type="number"
                                                    min="0"
                                                    value={config.activeDoTs.bombStacks}
                                                    onChange={(e) =>
                                                        updateDoTConfig(
                                                            config.id,
                                                            'activeDoTs',
                                                            'bombStacks',
                                                            parseInt(e.target.value) || 0
                                                        )
                                                    }
                                                />
                                                <Input
                                                    label="Countdown"
                                                    type="number"
                                                    min="1"
                                                    value={config.activeDoTs.bombCountdown}
                                                    onChange={(e) =>
                                                        updateDoTConfig(
                                                            config.id,
                                                            'activeDoTs',
                                                            'bombCountdown',
                                                            Math.max(
                                                                1,
                                                                parseInt(e.target.value) || 1
                                                            )
                                                        )
                                                    }
                                                />
                                            </div>
                                        </div>

                                        {/* DoTs — Charged Skill */}
                                        <div className="text-xs font-semibold text-purple-400 uppercase tracking-wide mb-2">
                                            DoTs — Charged Skill
                                        </div>
                                        <div className="space-y-3">
                                            <div className="grid grid-cols-2 gap-4">
                                                <Select
                                                    label="Corrosion Tier"
                                                    options={CORROSION_TIER_OPTIONS}
                                                    value={String(config.chargedDoTs.corrosionTier)}
                                                    onChange={(v) =>
                                                        updateDoTConfig(
                                                            config.id,
                                                            'chargedDoTs',
                                                            'corrosionTier',
                                                            parseInt(v)
                                                        )
                                                    }
                                                />
                                                <Input
                                                    label="Stacks / use"
                                                    type="number"
                                                    min="0"
                                                    value={config.chargedDoTs.corrosionStacks}
                                                    onChange={(e) =>
                                                        updateDoTConfig(
                                                            config.id,
                                                            'chargedDoTs',
                                                            'corrosionStacks',
                                                            parseInt(e.target.value) || 0
                                                        )
                                                    }
                                                />
                                            </div>
                                            <div className="grid grid-cols-2 gap-4">
                                                <Select
                                                    label="Inferno Tier"
                                                    options={INFERNO_TIER_OPTIONS}
                                                    value={String(config.chargedDoTs.infernoTier)}
                                                    onChange={(v) =>
                                                        updateDoTConfig(
                                                            config.id,
                                                            'chargedDoTs',
                                                            'infernoTier',
                                                            parseInt(v)
                                                        )
                                                    }
                                                />
                                                <Input
                                                    label="Stacks / use"
                                                    type="number"
                                                    min="0"
                                                    value={config.chargedDoTs.infernoStacks}
                                                    onChange={(e) =>
                                                        updateDoTConfig(
                                                            config.id,
                                                            'chargedDoTs',
                                                            'infernoStacks',
                                                            parseInt(e.target.value) || 0
                                                        )
                                                    }
                                                />
                                            </div>
                                            <div className="grid grid-cols-3 gap-4">
                                                <Select
                                                    label="Bomb Tier"
                                                    options={BOMB_TIER_OPTIONS}
                                                    value={String(config.chargedDoTs.bombTier)}
                                                    onChange={(v) =>
                                                        updateDoTConfig(
                                                            config.id,
                                                            'chargedDoTs',
                                                            'bombTier',
                                                            parseInt(v)
                                                        )
                                                    }
                                                />
                                                <Input
                                                    label="Stacks / use"
                                                    type="number"
                                                    min="0"
                                                    value={config.chargedDoTs.bombStacks}
                                                    onChange={(e) =>
                                                        updateDoTConfig(
                                                            config.id,
                                                            'chargedDoTs',
                                                            'bombStacks',
                                                            parseInt(e.target.value) || 0
                                                        )
                                                    }
                                                />
                                                <Input
                                                    label="Countdown"
                                                    type="number"
                                                    min="1"
                                                    value={config.chargedDoTs.bombCountdown}
                                                    onChange={(e) =>
                                                        updateDoTConfig(
                                                            config.id,
                                                            'chargedDoTs',
                                                            'bombCountdown',
                                                            Math.max(
                                                                1,
                                                                parseInt(e.target.value) || 1
                                                            )
                                                        )
                                                    }
                                                />
                                            </div>
                                        </div>
                                    </CollapsibleAccordion>

                                    {(() => {
                                        const sim = simResults.get(config.id);
                                        if (!sim) return null;
                                        const isBest = bestConfig?.id === config.id;
                                        const hasDoTs =
                                            sim.summary.totalCorrosionDamage > 0 ||
                                            sim.summary.totalInfernoDamage > 0 ||
                                            sim.summary.totalBombDamage > 0;

                                        return (
                                            <div className="mt-4 pt-4 border-t border-dark-border">
                                                <div className="flex justify-between mb-2">
                                                    <span className="text-theme-text-secondary">
                                                        Crit Multiplier:
                                                    </span>
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
                                                <div className="flex justify-between mb-2">
                                                    <span className="text-theme-text-secondary">
                                                        Avg Damage / Round:
                                                    </span>
                                                    <span
                                                        className={
                                                            isBest ? 'text-primary font-bold' : ''
                                                        }
                                                    >
                                                        {sim.summary.avgDamagePerRound.toLocaleString()}
                                                    </span>
                                                </div>
                                                <div className="flex justify-between mb-2">
                                                    <span className="text-theme-text-secondary">
                                                        Total Damage ({rounds} rounds):
                                                    </span>
                                                    <span
                                                        className={
                                                            isBest ? 'text-primary font-bold' : ''
                                                        }
                                                    >
                                                        {sim.summary.totalDamage.toLocaleString()}
                                                    </span>
                                                </div>
                                                {hasDoTs && (
                                                    <div className="grid grid-cols-4 gap-1 mt-2">
                                                        <div className="text-center p-1 bg-dark-lighter rounded">
                                                            <div className="text-xs text-theme-text-secondary">
                                                                Direct
                                                            </div>
                                                            <div className="text-xs">
                                                                {sim.summary.totalDirectDamage.toLocaleString()}
                                                            </div>
                                                        </div>
                                                        <div className="text-center p-1 bg-dark-lighter rounded">
                                                            <div className="text-xs text-green-400">
                                                                Corrosion
                                                            </div>
                                                            <div className="text-xs text-green-400">
                                                                {sim.summary.totalCorrosionDamage.toLocaleString()}
                                                            </div>
                                                        </div>
                                                        <div className="text-center p-1 bg-dark-lighter rounded">
                                                            <div className="text-xs text-orange-400">
                                                                Inferno
                                                            </div>
                                                            <div className="text-xs text-orange-400">
                                                                {sim.summary.totalInfernoDamage.toLocaleString()}
                                                            </div>
                                                        </div>
                                                        <div className="text-center p-1 bg-dark-lighter rounded">
                                                            <div className="text-xs text-red-400">
                                                                Bomb
                                                            </div>
                                                            <div className="text-xs text-red-400">
                                                                {sim.summary.totalBombDamage.toLocaleString()}
                                                            </div>
                                                        </div>
                                                    </div>
                                                )}
                                                {isBest && configs.length > 1 && (
                                                    <div className="text-sm mt-2 text-center">
                                                        <span className="text-primary">
                                                            Best ship configuration
                                                        </span>
                                                        {bestVsSecondPercentage !== null && (
                                                            <span className="text-green-500 ml-2">
                                                                +{bestVsSecondPercentage.toFixed(2)}
                                                                % vs #2
                                                            </span>
                                                        )}
                                                    </div>
                                                )}
                                                {!isBest && bestConfig && (
                                                    <div className="flex justify-between mt-2">
                                                        <span className="text-theme-text-secondary">
                                                            Compared to best:
                                                        </span>
                                                        <span className="text-red-500">
                                                            {(
                                                                ((sim.summary.totalDamage -
                                                                    (simResults.get(bestConfig.id)
                                                                        ?.summary.totalDamage ??
                                                                        0)) /
                                                                    (simResults.get(bestConfig.id)
                                                                        ?.summary.totalDamage ??
                                                                        1)) *
                                                                100
                                                            ).toFixed(2)}
                                                            %
                                                        </span>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })()}
                                </div>
                            </div>
                        ))}
                    </div>

                    <div className="card">
                        <h3 className="text-lg font-bold mb-2">Damage Over Time</h3>
                        <p className="text-sm text-theme-text-secondary mb-4">
                            Cumulative damage comparison across rounds. Burst ships climb fast then
                            plateau; DoT ships ramp up over time.
                        </p>
                        <DPSRoundChart
                            ships={configs
                                .map((config) => ({
                                    id: config.id,
                                    name: config.name,
                                    result: simResults.get(config.id)!,
                                }))
                                .filter((s) => s.result)}
                            rounds={rounds}
                        />
                    </div>

                    <div className="card">
                        <div className="flex justify-between items-center mb-2">
                            <h3 className="text-lg font-bold">DPS Comparison</h3>
                            <Button variant="secondary" onClick={toggleViewMode}>
                                Switch to {viewMode === 'table' ? 'Contour Map' : 'Table'} View
                            </Button>
                        </div>
                        <p className="text-sm text-theme-text-secondary mb-4">
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
                        <p className="text-sm text-theme-text-secondary mb-4">
                            Shows how defense penetration affects damage increase for different
                            enemy defense values. Hover over the lines to see exact values.
                        </p>

                        <DefensePenetrationChart height={400} />
                    </div>

                    <div className="card">
                        <h2 className="text-xl font-bold mb-4">About the Simulation</h2>
                        <p className="mb-2">
                            The simulator models combat round-by-round. Each round, your ship fires
                            either its active or charged skill (if configured). Damage is calculated
                            as:
                        </p>
                        <p className="mb-2 font-mono bg-dark-lighter p-2 text-sm">
                            Direct = Attack × CritMultiplier × (1 - DamageReduction%) ×
                            SkillMultiplier% × (1 + OutgoingDmg%)
                        </p>
                        <p className="mb-2">
                            DoT effects (corrosion, inferno, bombs) bypass enemy defense entirely.
                            Corrosion deals a percentage of the target&apos;s HP per stack. Inferno
                            and bombs deal a percentage of the attacker&apos;s attack stat. Bombs
                            detonate after a countdown period.
                        </p>
                        <p>All DoTs stack permanently and tick on the turn they are applied.</p>
                    </div>
                </div>
            </PageLayout>
        </>
    );
};

export default DPSCalculatorPage;
