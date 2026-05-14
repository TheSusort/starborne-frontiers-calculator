import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageLayout } from '../../components/ui';
import {
    HealerConfig,
    HealerConfigUpdateableField,
    SelectedGameBuff,
} from '../../types/calculator';
import { calculateHealing } from '../../utils/calculators/healingCalculator';
import { simulateHealing } from '../../utils/calculators/healingSimulator';
import { calculateTotalStats } from '../../utils/ship/statsCalculator';
import { parseSkillHeal } from '../../utils/skillTextParser';
import { Ship } from '../../types/ship';
import { useShips } from '../../contexts/ShipsContext';
import { useInventory } from '../../contexts/InventoryProvider';
import { useEngineeringStats } from '../../hooks/useEngineeringStats';
import { HealerConfigCard } from '../../components/calculator/HealerConfigCard';
import { HealingBubbleChart } from '../../components/calculator/HealingBubbleChart';
import { HealingComparisonChart } from '../../components/calculator/HealingComparisonChart';
import { HealingRoundChart } from '../../components/calculator/HealingRoundChart';
import { HealingSettingsPanel } from '../../components/calculator/HealingSettingsPanel';
import Seo from '../../components/seo/Seo';
import { SEO_CONFIG } from '../../constants/seo';

const DEFAULT_CONFIG: Omit<HealerConfig, 'id' | 'name'> = {
    hp: 40000,
    healPercent: 15,
    chargedHealPercent: 0,
    chargeCount: 0,
    startCharged: false,
    crit: 50,
    critDamage: 100,
    healModifier: 20,
    buffs: [],
};

const HealingCalculatorPage: React.FC = () => {
    const [searchParams, setSearchParams] = useSearchParams();
    const { getShipById } = useShips();
    const { getGearPiece } = useInventory();
    const { getEngineeringStatsForShipType } = useEngineeringStats();
    const shipInitialized = useRef(false);

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
                const parsedActive = parseSkillHeal(ship.activeSkillText ?? '');
                const parsedCharged = parseSkillHeal(ship.chargeSkillText ?? '');
                const parsedFallback = !parsedActive
                    ? parseSkillHeal(ship.firstPassiveSkillText ?? '') ||
                      parseSkillHeal(ship.secondPassiveSkillText ?? '') ||
                      parseSkillHeal(ship.thirdPassiveSkillText ?? '')
                    : 0;
                const healPercent = parsedActive || parsedFallback || 15;
                return [
                    {
                        id: '1',
                        shipId: ship.id,
                        name: ship.name,
                        hp: Math.round(final.hp),
                        healPercent,
                        healPercentAutoFilled: parsedActive > 0 || parsedFallback > 0,
                        chargedHealPercent: parsedCharged,
                        chargedHealPercentAutoFilled: parsedCharged > 0,
                        chargeCount: ship.chargeSkillCharge ?? 0,
                        startCharged: false,
                        crit: Math.round(final.crit),
                        critDamage: Math.round(final.critDamage),
                        healModifier: 0,
                        buffs: [],
                    },
                ];
            }
        }
        return [{ id: '1', name: 'Healer 1', ...DEFAULT_CONFIG }];
    };

    const [configs, setConfigs] = useState<HealerConfig[]>(getInitialConfig);
    const [nextId, setNextId] = useState(2);
    const [rounds, setRounds] = useState(20);
    const [healerBuffs, setHealerBuffs] = useState<SelectedGameBuff[]>([]);
    const [settingsPanelOpen, setSettingsPanelOpen] = useState(false);

    useEffect(() => {
        if (shipInitialized.current) return;
        shipInitialized.current = true;
        if (searchParams.has('shipId')) {
            searchParams.delete('shipId');
            setSearchParams(searchParams, { replace: true });
        }
    }, [searchParams, setSearchParams]);

    const addConfig = () => {
        setConfigs((prev) => [
            ...prev,
            { id: nextId.toString(), name: `Healer ${nextId}`, ...DEFAULT_CONFIG },
        ]);
        setNextId((n) => n + 1);
    };

    const removeConfig = (id: string) => {
        setConfigs((prev) => prev.filter((c) => c.id !== id));
    };

    const updateConfig = (
        id: string,
        field: HealerConfigUpdateableField,
        value: string | number
    ) => {
        setConfigs((prev) =>
            prev.map((c) => {
                if (c.id !== id) return c;
                const updated = { ...c, [field]: value };
                if (field === 'healPercent') updated.healPercentAutoFilled = false;
                if (field === 'chargedHealPercent') updated.chargedHealPercentAutoFilled = false;
                return updated;
            })
        );
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
        const parsedActive = parseSkillHeal(ship.activeSkillText ?? '');
        const parsedCharged = parseSkillHeal(ship.chargeSkillText ?? '');
        const parsedFallback = !parsedActive
            ? parseSkillHeal(ship.firstPassiveSkillText ?? '') ||
              parseSkillHeal(ship.secondPassiveSkillText ?? '') ||
              parseSkillHeal(ship.thirdPassiveSkillText ?? '')
            : 0;

        setConfigs((prev) =>
            prev.map((c) => {
                if (c.id !== configId) return c;
                return {
                    ...c,
                    shipId: ship.id,
                    name: ship.name,
                    hp: Math.round(final.hp),
                    crit: Math.round(final.crit),
                    critDamage: Math.round(final.critDamage),
                    chargeCount: ship.chargeSkillCharge ?? c.chargeCount,
                    ...(parsedActive || parsedFallback
                        ? {
                              healPercent: parsedActive || parsedFallback,
                              healPercentAutoFilled: true,
                          }
                        : {}),
                    ...(parsedCharged > 0
                        ? {
                              chargedHealPercent: parsedCharged,
                              chargedHealPercentAutoFilled: true,
                          }
                        : {}),
                };
            })
        );
    };

    const updateConfigBuffs = (id: string, buffs: SelectedGameBuff[]) => {
        setConfigs((prev) => prev.map((c) => (c.id === id ? { ...c, buffs } : c)));
    };

    const globalBuffTotals = useMemo(
        () => ({
            critBuff: healerBuffs.reduce(
                (sum, b) => sum + (b.parsedEffects.crit ?? 0) * b.stacks,
                0
            ),
            critDamageBuff: healerBuffs.reduce(
                (sum, b) => sum + (b.parsedEffects.critDamage ?? 0) * b.stacks,
                0
            ),
            outgoingHealBuff: healerBuffs.reduce(
                (sum, b) => sum + (b.parsedEffects.outgoingHeal ?? 0) * b.stacks,
                0
            ),
        }),
        [healerBuffs]
    );

    const mergedBuffTotals = useMemo(
        () =>
            new Map(
                configs.map((c) => [
                    c.id,
                    {
                        critBuff:
                            globalBuffTotals.critBuff +
                            c.buffs.reduce(
                                (sum, b) => sum + (b.parsedEffects.crit ?? 0) * b.stacks,
                                0
                            ),
                        critDamageBuff:
                            globalBuffTotals.critDamageBuff +
                            c.buffs.reduce(
                                (sum, b) => sum + (b.parsedEffects.critDamage ?? 0) * b.stacks,
                                0
                            ),
                        outgoingHealBuff:
                            globalBuffTotals.outgoingHealBuff +
                            c.buffs.reduce(
                                (sum, b) => sum + (b.parsedEffects.outgoingHeal ?? 0) * b.stacks,
                                0
                            ),
                    },
                ])
            ),
        [configs, globalBuffTotals]
    );

    const simResults = useMemo(() => {
        const map = new Map(
            configs.map((c) => [c.id, simulateHealing(c, rounds, mergedBuffTotals.get(c.id))])
        );
        return map;
    }, [configs, rounds, mergedBuffTotals]);

    const bestHealer = configs.reduce<HealerConfig | null>((best, current) => {
        if (!best) return current;
        return calculateHealing(current, mergedBuffTotals.get(current.id)).effectiveHealing >
            calculateHealing(best, mergedBuffTotals.get(best.id)).effectiveHealing
            ? current
            : best;
    }, null);

    const bestEffectiveHealing = bestHealer
        ? calculateHealing(bestHealer, mergedBuffTotals.get(bestHealer.id)).effectiveHealing
        : undefined;

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
                    <HealingSettingsPanel
                        isOpen={settingsPanelOpen}
                        onToggle={() => setSettingsPanelOpen((v) => !v)}
                        rounds={rounds}
                        onRoundsChange={setRounds}
                        healerBuffs={healerBuffs}
                        onHealerBuffsChange={setHealerBuffs}
                    />

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {configs.map((config) => (
                            <HealerConfigCard
                                key={config.id}
                                config={config}
                                isBest={bestHealer?.id === config.id}
                                isComparing={configs.length > 1}
                                bestEffectiveHealing={bestEffectiveHealing}
                                buffTotals={mergedBuffTotals.get(config.id)}
                                onRemove={() => removeConfig(config.id)}
                                onUpdate={(field, value) => updateConfig(config.id, field, value)}
                                onSelectShip={(ship) => selectShipForConfig(config.id, ship)}
                                onStartChargedChange={(checked) =>
                                    setConfigs((prev) =>
                                        prev.map((c) =>
                                            c.id === config.id ? { ...c, startCharged: checked } : c
                                        )
                                    )
                                }
                                onBuffsChange={(buffs) => updateConfigBuffs(config.id, buffs)}
                            />
                        ))}
                    </div>

                    <HealingBubbleChart configs={configs} buffTotals={mergedBuffTotals} />

                    <HealingComparisonChart configs={configs} buffTotals={mergedBuffTotals} />

                    <div className="card">
                        <div className="flex justify-between items-center mb-2">
                            <h3 className="text-lg font-bold">Healing Over Time</h3>
                        </div>
                        <p className="text-sm text-theme-text-secondary mb-4">
                            Cumulative healing comparison across rounds. Ships with a charged heal
                            show a stepped pattern — a larger heal every few rounds.
                        </p>
                        <HealingRoundChart
                            healers={configs
                                .map((c) => ({
                                    id: c.id,
                                    name: c.name,
                                    result: simResults.get(c.id)!,
                                }))
                                .filter((h) => h.result)}
                            rounds={rounds}
                        />
                    </div>

                    <div className="card">
                        <h2 className="text-xl font-bold mb-4">Healing Formula Explanation</h2>
                        <p className="mb-2">
                            Healing is calculated based on the healer&apos;s HP, base healing
                            percentage (configurable per ship), critical hit chance, critical hit
                            power, and healing modifier.
                        </p>
                        <p className="mb-2 font-mono bg-dark-lighter p-2">
                            Effective Heal = HP × Heal% × CritMultiplier × (1 + HealMod%)
                            <br />
                            Crit Multiplier = 1 + (Crit Chance% × Crit Power%) / 10000
                            <br />
                            Avg per Round = (Charged + ChargeCount × Active) / (ChargeCount + 1)
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
