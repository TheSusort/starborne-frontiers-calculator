import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Ship } from '../../types/ship';
import { CloseIcon, PageLayout } from '../../components/ui';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { StatCard } from '../../components/ui/StatCard';
import { CollapsibleForm } from '../../components/ui/layout/CollapsibleForm';
import { ChevronDownIcon } from '../../components/ui/icons/ChevronIcons';
import { ShipSelector } from '../../components/ship/ShipSelector';
import { ShipSkillList } from '../../components/ship/ShipSkillList';
import { useShips } from '../../contexts/ShipsContext';
import { parseSkillDamage } from '../../utils/skillTextParser';
import Seo from '../../components/seo/Seo';
import { SEO_CONFIG } from '../../constants/seo';
import {
    simulateChronoReaver,
    type CRRarity,
    type CRSimulationResult,
} from '../../utils/calculators/chronoReaver';

interface ShipConfig {
    id: string;
    name: string;
    shipId?: string;
    chargesRequired: number;
    crRarity: CRRarity;
    activeSkillPercent: number;
    chargedSkillPercent: number;
    rounds: number;
    autoFilledFields?: Set<'activeSkillPercent' | 'chargedSkillPercent'>;
}

const DEFAULT_CONFIG: Omit<ShipConfig, 'id' | 'name' | 'shipId' | 'autoFilledFields'> = {
    chargesRequired: 4,
    crRarity: 'legendary',
    activeSkillPercent: 150,
    chargedSkillPercent: 350,
    rounds: 20,
};

const CR_RARITY_OPTIONS = [
    { value: 'none', label: 'None' },
    { value: 'epic', label: 'Epic' },
    { value: 'legendary', label: 'Legendary' },
];

function buildSkillAutoFill(ship: Ship) {
    const activeParsed = parseSkillDamage(ship.activeSkillText ?? '');
    const chargedParsed = parseSkillDamage(ship.chargeSkillText ?? '');
    const autoFilledFields = new Set<'activeSkillPercent' | 'chargedSkillPercent'>();
    if (activeParsed > 0) autoFilledFields.add('activeSkillPercent');
    if (chargedParsed > 0) autoFilledFields.add('chargedSkillPercent');
    return { activeParsed, chargedParsed, autoFilledFields };
}

const ChronoReaverCalculatorPage: React.FC = () => {
    const [searchParams, setSearchParams] = useSearchParams();
    const { getShipById } = useShips();
    const shipInitialized = useRef(false);

    const getInitialConfig = (): { configs: ShipConfig[]; nextId: number } => {
        const shipId = searchParams.get('shipId');
        if (shipId) {
            const ship = getShipById(shipId);
            if (ship) {
                const { activeParsed, chargedParsed, autoFilledFields } = buildSkillAutoFill(ship);
                return {
                    configs: [
                        {
                            id: '1',
                            name: ship.name,
                            shipId: ship.id,
                            chargesRequired:
                                ship.chargeSkillCharge ?? DEFAULT_CONFIG.chargesRequired,
                            crRarity: DEFAULT_CONFIG.crRarity,
                            activeSkillPercent:
                                activeParsed > 0 ? activeParsed : DEFAULT_CONFIG.activeSkillPercent,
                            chargedSkillPercent:
                                chargedParsed > 0
                                    ? chargedParsed
                                    : DEFAULT_CONFIG.chargedSkillPercent,
                            rounds: DEFAULT_CONFIG.rounds,
                            autoFilledFields,
                        },
                    ],
                    nextId: 2,
                };
            }
        }
        return {
            configs: [{ id: '1', name: 'Ship 1', ...DEFAULT_CONFIG }],
            nextId: 2,
        };
    };

    const [initialState] = useState(getInitialConfig);
    const [configs, setConfigs] = useState<ShipConfig[]>(initialState.configs);
    const [nextId, setNextId] = useState(initialState.nextId);
    const [skillRefOpenIds, setSkillRefOpenIds] = useState<Set<string>>(new Set());

    useEffect(() => {
        if (shipInitialized.current) return;
        shipInitialized.current = true;
        if (searchParams.has('shipId')) {
            searchParams.delete('shipId');
            setSearchParams(searchParams, { replace: true });
        }
    }, [searchParams, setSearchParams]);

    const results = useMemo(() => {
        const map = new Map<string, CRSimulationResult>();
        configs.forEach((config) => {
            map.set(
                config.id,
                simulateChronoReaver({
                    chargesRequired: config.chargesRequired,
                    crRarity: config.crRarity,
                    activeSkillPercent: config.activeSkillPercent,
                    chargedSkillPercent: config.chargedSkillPercent,
                    rounds: config.rounds,
                })
            );
        });
        return map;
    }, [configs]);

    const addConfig = () => {
        setConfigs([
            ...configs,
            { id: nextId.toString(), name: `Ship ${nextId}`, ...DEFAULT_CONFIG },
        ]);
        setNextId(nextId + 1);
    };

    const removeConfig = (id: string) => {
        setConfigs(configs.filter((c) => c.id !== id));
    };

    const updateConfig = (
        id: string,
        field: keyof Omit<ShipConfig, 'id' | 'shipId' | 'autoFilledFields'>,
        value: string | number
    ) => {
        setConfigs(
            configs.map((c) => {
                if (c.id !== id) return c;
                const updated = { ...c, [field]: value };
                if (field === 'activeSkillPercent' || field === 'chargedSkillPercent') {
                    const next = new Set(c.autoFilledFields);
                    next.delete(field);
                    updated.autoFilledFields = next;
                }
                return updated;
            })
        );
    };

    const selectShipForConfig = (id: string, ship: Ship) => {
        const { activeParsed, chargedParsed, autoFilledFields } = buildSkillAutoFill(ship);
        setConfigs(
            configs.map((c) => {
                if (c.id !== id) return c;
                return {
                    ...c,
                    shipId: ship.id,
                    name: ship.name,
                    chargesRequired: ship.chargeSkillCharge ?? c.chargesRequired,
                    activeSkillPercent: activeParsed > 0 ? activeParsed : c.activeSkillPercent,
                    chargedSkillPercent: chargedParsed > 0 ? chargedParsed : c.chargedSkillPercent,
                    autoFilledFields,
                };
            })
        );
    };

    const toggleSkillRef = (id: string) => {
        setSkillRefOpenIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    };

    // Find config with highest avg damage per round
    const bestConfig = configs.reduce<ShipConfig | null>((best, current) => {
        if (!best) return current;
        const bestResult = results.get(best.id);
        const currentResult = results.get(current.id);
        if (!bestResult || !currentResult) return best;
        return currentResult.summary.avgDamagePerRound > bestResult.summary.avgDamagePerRound
            ? current
            : best;
    }, null);

    return (
        <>
            <Seo {...SEO_CONFIG.chronoReaver} />
            <PageLayout
                title="Chrono Reaver Calculator"
                description="Simulate Chrono Reaver charge mechanics to compare efficiency across ships and rarities"
                action={{
                    label: 'Add Ship',
                    onClick: addConfig,
                    variant: 'primary',
                }}
            >
                <div className="space-y-6">
                    {configs.map((config) => {
                        const result = results.get(config.id);
                        if (!result) return null;
                        const isBest = bestConfig?.id === config.id && configs.length > 1;
                        const selectedShip = config.shipId ? getShipById(config.shipId) : undefined;
                        const skillRefOpen = skillRefOpenIds.has(config.id);

                        return (
                            <div
                                key={config.id}
                                className={`card ${isBest ? 'border-primary' : ''}`}
                            >
                                {/* Ship Selector */}
                                <div className="mb-4">
                                    <ShipSelector
                                        selected={selectedShip ?? null}
                                        onSelect={(ship) => selectShipForConfig(config.id, ship)}
                                        variant="compact"
                                    />
                                </div>

                                {/* Header */}
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

                                {/* Inputs */}
                                <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-4 items-end">
                                    <Input
                                        label="Charges Required"
                                        type="number"
                                        value={config.chargesRequired}
                                        onChange={(e) => {
                                            const val = Math.min(
                                                20,
                                                Math.max(1, parseInt(e.target.value) || 1)
                                            );
                                            updateConfig(config.id, 'chargesRequired', val);
                                        }}
                                    />
                                    <Select
                                        label="Chrono Rarity"
                                        options={CR_RARITY_OPTIONS}
                                        value={config.crRarity}
                                        onChange={(val) => updateConfig(config.id, 'crRarity', val)}
                                    />
                                    <Input
                                        label="Active Skill %"
                                        type="number"
                                        value={config.activeSkillPercent}
                                        onChange={(e) =>
                                            updateConfig(
                                                config.id,
                                                'activeSkillPercent',
                                                parseInt(e.target.value) || 0
                                            )
                                        }
                                    />
                                    <Input
                                        label="Charged Skill %"
                                        type="number"
                                        value={config.chargedSkillPercent}
                                        onChange={(e) =>
                                            updateConfig(
                                                config.id,
                                                'chargedSkillPercent',
                                                parseInt(e.target.value) || 0
                                            )
                                        }
                                    />
                                    <Input
                                        label="Rounds"
                                        type="number"
                                        value={config.rounds}
                                        onChange={(e) =>
                                            updateConfig(
                                                config.id,
                                                'rounds',
                                                Math.max(1, parseInt(e.target.value) || 1)
                                            )
                                        }
                                    />
                                </div>

                                {/* Skill Reference */}
                                {selectedShip && (
                                    <>
                                        <Button
                                            variant="link"
                                            onClick={() => toggleSkillRef(config.id)}
                                            className="w-full flex justify-between items-center mt-4"
                                        >
                                            <span className="flex items-center gap-2">
                                                <ChevronDownIcon
                                                    className={`text-sm text-theme-text-secondary h-8 w-8 p-2 transition-transform duration-300 ${skillRefOpen ? 'rotate-180' : ''}`}
                                                />
                                                Skill Reference
                                            </span>
                                        </Button>
                                        <CollapsibleForm isVisible={skillRefOpen}>
                                            <div className="pt-2">
                                                <ShipSkillList ship={selectedShip} />
                                            </div>
                                        </CollapsibleForm>
                                    </>
                                )}

                                {/* Summary Metrics */}
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 my-4">
                                    <StatCard
                                        title="Avg Damage % / Round"
                                        value={`${result.summary.avgDamagePerRound.toFixed(1)}%`}
                                        color={isBest ? 'green' : undefined}
                                    />
                                    <StatCard
                                        title="Charged Frequency"
                                        value={
                                            result.summary.chargedFrequency > 0
                                                ? `Every ${result.summary.chargedFrequency.toFixed(1)} rounds`
                                                : 'Never'
                                        }
                                        color="blue"
                                    />
                                    <StatCard
                                        title="Wasted Chrono Procs"
                                        value={
                                            config.crRarity === 'none'
                                                ? 'N/A'
                                                : `${result.summary.wastedProcs} / ${result.summary.totalProcs}`
                                        }
                                        color={result.summary.wastedProcs > 0 ? 'red' : 'green'}
                                    />
                                    <StatCard
                                        title="DPS Increase vs No Chrono"
                                        value={
                                            config.crRarity === 'none'
                                                ? 'Baseline'
                                                : `+${result.summary.dpsIncreasePercent.toFixed(1)}%`
                                        }
                                        color={
                                            result.summary.dpsIncreasePercent > 0
                                                ? 'green'
                                                : undefined
                                        }
                                    />
                                </div>

                                {/* Turn Timeline Table */}
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="border-b border-dark-border text-theme-text-secondary">
                                                <th className="px-2 py-1 text-left">Round</th>
                                                <th className="px-2 py-1 text-left">Charges</th>
                                                <th className="px-2 py-1 text-left">Action</th>
                                                <th className="px-2 py-1 text-left">Chrono Proc</th>
                                                <th className="px-2 py-1 text-left">End of Turn</th>
                                                <th className="px-2 py-1 text-right">Damage</th>
                                                <th className="px-2 py-1 text-right">Total</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {result.rounds.map((round) => (
                                                <tr
                                                    key={round.round}
                                                    className={`border-b border-dark-border/50 ${
                                                        round.action === 'charged'
                                                            ? 'bg-primary/10 text-primary'
                                                            : ''
                                                    }`}
                                                >
                                                    <td className="px-2 py-1">{round.round}</td>
                                                    <td className="px-2 py-1">
                                                        {round.startCharges}
                                                    </td>
                                                    <td className="px-2 py-1 capitalize font-medium">
                                                        {round.action}
                                                    </td>
                                                    <td className="px-2 py-1">
                                                        {round.crProc ? (
                                                            round.wastedProc ? (
                                                                <span className="text-red-400 font-medium">
                                                                    WASTED
                                                                </span>
                                                            ) : (
                                                                <span className="text-green-400">
                                                                    +1
                                                                </span>
                                                            )
                                                        ) : (
                                                            <span className="text-theme-text-secondary">
                                                                -
                                                            </span>
                                                        )}
                                                    </td>
                                                    <td className="px-2 py-1">
                                                        {round.endCharges}
                                                    </td>
                                                    <td className="px-2 py-1 text-right">
                                                        {round.damage}%
                                                    </td>
                                                    <td className="px-2 py-1 text-right font-medium">
                                                        {round.totalDamage}%
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>

                                {isBest && (
                                    <div className="text-primary text-sm mt-2 text-center">
                                        Best configuration
                                    </div>
                                )}
                            </div>
                        );
                    })}

                    {/* Explanation */}
                    <div className="card">
                        <h2 className="text-lg font-bold mb-4">How Chrono Reaver Works</h2>
                        <p className="mb-2 text-theme-text-secondary">
                            The Chrono Reaver is an ultimate implant that grants +1 charge to your
                            ship&apos;s charged skill on proc turns. Legendary procs every other
                            turn, Epic procs every third turn.
                        </p>
                        <p className="mb-2 text-theme-text-secondary">
                            <strong>Wasted procs</strong> occur when the CR procs on the same turn
                            your active attack naturally fills the last charge. Since charges
                            can&apos;t exceed the maximum, the extra charge is lost.
                        </p>
                        <p className="text-theme-text-secondary">
                            Ships with different charge requirements have different CR efficiency.
                            Add multiple configurations to compare.
                        </p>
                    </div>
                </div>
            </PageLayout>
        </>
    );
};

export default ChronoReaverCalculatorPage;
