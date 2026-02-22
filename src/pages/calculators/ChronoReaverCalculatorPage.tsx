import React, { useState, useMemo } from 'react';
import { CloseIcon, PageLayout } from '../../components/ui';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { StatCard } from '../../components/ui/StatCard';
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
    chargesRequired: number;
    crRarity: CRRarity;
    activeSkillPercent: number;
    chargedSkillPercent: number;
    rounds: number;
}

const DEFAULT_CONFIG: Omit<ShipConfig, 'id' | 'name'> = {
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

const ChronoReaverCalculatorPage: React.FC = () => {
    const [configs, setConfigs] = useState<ShipConfig[]>([
        { id: '1', name: 'Ship 1', ...DEFAULT_CONFIG },
    ]);
    const [nextId, setNextId] = useState(2);

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
        field: keyof Omit<ShipConfig, 'id'>,
        value: string | number
    ) => {
        setConfigs(configs.map((c) => (c.id === id ? { ...c, [field]: value } : c)));
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

                        return (
                            <div
                                key={config.id}
                                className={`p-4 bg-dark border ${isBest ? 'border-primary' : 'border-dark-border'}`}
                            >
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
                                <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-4">
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

                                {/* Summary Metrics */}
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
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
                                            <tr className="border-b border-dark-border text-gray-400">
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
                                                            <span className="text-gray-600">-</span>
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
                        <h2 className="text-xl font-bold mb-4">How Chrono Reaver Works</h2>
                        <p className="mb-2">
                            The Chrono Reaver is an ultimate implant that grants +1 charge to your
                            ship&apos;s charged skill on proc turns. Legendary procs every other
                            turn, Epic procs every third turn.
                        </p>
                        <p className="mb-2">
                            <strong>Wasted procs</strong> occur when the CR procs on the same turn
                            your active attack naturally fills the last charge. Since charges
                            can&apos;t exceed the maximum, the extra charge is lost.
                        </p>
                        <p>
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
