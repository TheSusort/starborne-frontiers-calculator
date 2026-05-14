import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageLayout } from '../../components/ui';
import { calculateDamageReduction, calculateEffectiveHP } from '../../utils/autogear/scoring';
import { Button } from '../../components/ui/Button';
import { DamageReductionChart } from '../../components/calculator/DamageReductionChart';
import { DamageReductionTable } from '../../components/calculator/DamageReductionTable';
import { DefenseSettingsPanel } from '../../components/calculator/DefenseSettingsPanel';
import { DefenseShipCard } from '../../components/calculator/DefenseShipCard';
import { computeBuffedStats } from '../../utils/calculators/defenseCalculator';
import Seo from '../../components/seo/Seo';
import { SEO_CONFIG } from '../../constants/seo';
import { useShips } from '../../contexts/ShipsContext';
import { useInventory } from '../../contexts/InventoryProvider';
import { useEngineeringStats } from '../../hooks/useEngineeringStats';
import { calculateTotalStats } from '../../utils/ship/statsCalculator';
import { Ship } from '../../types/ship';
import { DefenseShipConfig, DefenseBuffTotals, SelectedGameBuff } from '../../types/calculator';

const DefenseCalculatorPage: React.FC = () => {
    const [searchParams, setSearchParams] = useSearchParams();
    const { getShipById } = useShips();
    const { getGearPiece } = useInventory();
    const { getEngineeringStatsForShipType } = useEngineeringStats();
    const shipInitialized = useRef(false);

    const getInitialConfig = (): DefenseShipConfig[] => {
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
                const hp = Math.round(final.hp);
                const defense = Math.round(final.defence);
                return [
                    {
                        id: '1',
                        shipId: ship.id,
                        name: ship.name,
                        hp,
                        defense,
                        damageReduction: calculateDamageReduction(defense),
                        effectiveHP: calculateEffectiveHP(hp, defense),
                        buffs: [],
                    },
                ];
            }
        }
        return [{ id: '1', name: 'Ship 1', hp: 10000, defense: 5000, buffs: [] }];
    };

    const [configs, setConfigs] = useState<DefenseShipConfig[]>(getInitialConfig);
    const [nextId, setNextId] = useState(2);
    const initialRender = useRef(true);
    const [showTable, setShowTable] = useState(false);
    const [globalBuffs, setGlobalBuffs] = useState<SelectedGameBuff[]>([]);
    const [settingsPanelOpen, setSettingsPanelOpen] = useState(false);

    useEffect(() => {
        if (shipInitialized.current) return;
        shipInitialized.current = true;
        if (searchParams.has('shipId')) {
            searchParams.delete('shipId');
            setSearchParams(searchParams, { replace: true });
        }
    }, [searchParams, setSearchParams]);

    useEffect(() => {
        if (initialRender.current) {
            initialRender.current = false;
            setConfigs((prev) =>
                prev.map((config) => ({
                    ...config,
                    damageReduction: calculateDamageReduction(config.defense),
                    effectiveHP: calculateEffectiveHP(config.hp, config.defense),
                }))
            );
        }
    }, []);

    const addConfig = () => {
        const newConfig: DefenseShipConfig = {
            id: nextId.toString(),
            name: `Ship ${nextId}`,
            hp: 10000,
            defense: 5000,
            damageReduction: calculateDamageReduction(5000),
            effectiveHP: calculateEffectiveHP(10000, 5000),
            buffs: [],
        };
        setConfigs((prev) => [...prev, newConfig]);
        setNextId((n) => n + 1);
    };

    const removeConfig = (id: string) => {
        setConfigs((prev) => prev.filter((c) => c.id !== id));
    };

    const updateConfig = (id: string, field: 'name' | 'hp' | 'defense', value: string | number) => {
        setConfigs((prev) =>
            prev.map((config) => {
                if (config.id !== id) return config;
                const updated = { ...config, [field]: value };
                if (field === 'hp' || field === 'defense') {
                    updated.damageReduction = calculateDamageReduction(updated.defense);
                    updated.effectiveHP = calculateEffectiveHP(updated.hp, updated.defense);
                }
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
        const hp = Math.round(final.hp);
        const defense = Math.round(final.defence);
        setConfigs((prev) =>
            prev.map((c) =>
                c.id === configId
                    ? {
                          ...c,
                          shipId: ship.id,
                          name: ship.name,
                          hp,
                          defense,
                          damageReduction: calculateDamageReduction(defense),
                          effectiveHP: calculateEffectiveHP(hp, defense),
                      }
                    : c
            )
        );
    };

    const updateConfigBuffs = (id: string, buffs: SelectedGameBuff[]) => {
        setConfigs((prev) => prev.map((c) => (c.id === id ? { ...c, buffs } : c)));
    };

    const globalBuffTotals = useMemo(
        () => ({
            defenseBuff: globalBuffs.reduce(
                (sum, b) => sum + (b.parsedEffects.defense ?? 0) * b.stacks,
                0
            ),
            incomingDamageBuff: globalBuffs.reduce(
                (sum, b) => sum + (b.parsedEffects.incomingDamage ?? 0) * b.stacks,
                0
            ),
        }),
        [globalBuffs]
    );

    const mergedBuffTotals = useMemo(
        () =>
            new Map<string, DefenseBuffTotals>(
                configs.map((c) => [
                    c.id,
                    {
                        defenseBuff:
                            globalBuffTotals.defenseBuff +
                            c.buffs.reduce(
                                (sum, b) => sum + (b.parsedEffects.defense ?? 0) * b.stacks,
                                0
                            ),
                        incomingDamageBuff:
                            globalBuffTotals.incomingDamageBuff +
                            c.buffs.reduce(
                                (sum, b) => sum + (b.parsedEffects.incomingDamage ?? 0) * b.stacks,
                                0
                            ),
                    },
                ])
            ),
        [configs, globalBuffTotals]
    );

    const bestShip = configs.reduce<DefenseShipConfig | null>((best, current) => {
        const currentEHP = computeBuffedStats(
            current.hp,
            current.defense,
            mergedBuffTotals.get(current.id)
        ).effectiveHP;
        const bestEHP = best
            ? computeBuffedStats(best.hp, best.defense, mergedBuffTotals.get(best.id)).effectiveHP
            : 0;
        return currentEHP > bestEHP ? current : best;
    }, null);

    const bestEffectiveHP = bestShip
        ? computeBuffedStats(bestShip.hp, bestShip.defense, mergedBuffTotals.get(bestShip.id))
              .effectiveHP
        : undefined;

    return (
        <>
            <Seo {...SEO_CONFIG.defense} />
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
                    <DefenseSettingsPanel
                        isOpen={settingsPanelOpen}
                        onToggle={() => setSettingsPanelOpen((v) => !v)}
                        defenseBuffs={globalBuffs}
                        onDefenseBuffsChange={setGlobalBuffs}
                    />

                    <div
                        className={`grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 ${configs.length >= 4 ? '2xl:w-[calc(100vw-256px-2rem)] 2xl:ml-[calc((-100vw/2)+768px+1rem)] 2xl:[grid-template-columns:repeat(auto-fit,minmax(370px,500px))] 2xl:justify-center' : ''}`}
                    >
                        {configs.map((config) => (
                            <DefenseShipCard
                                key={config.id}
                                config={config}
                                isBest={bestShip?.id === config.id}
                                isComparing={configs.length > 1}
                                bestEffectiveHP={bestEffectiveHP}
                                buffTotals={mergedBuffTotals.get(config.id)}
                                onRemove={() => removeConfig(config.id)}
                                onUpdate={(field, value) => updateConfig(config.id, field, value)}
                                onSelectShip={(ship) => selectShipForConfig(config.id, ship)}
                                onBuffsChange={(buffs) => updateConfigBuffs(config.id, buffs)}
                            />
                        ))}
                    </div>

                    <div className="card">
                        <h2 className="text-xl font-bold mb-4">Effective HP Explanation</h2>
                        <p className="mb-2">
                            Effective HP represents how much raw damage your ship can take before
                            being destroyed, taking damage reduction into account.
                        </p>
                        <p className="mb-2">The formula for calculating Effective HP is:</p>
                        <p className="mb-2 font-mono bg-dark-lighter p-2">
                            Effective HP = HP / (1 - (Damage Reduction / 100))
                        </p>
                        <p className="mb-2">
                            Defense buffs multiply the base defense stat before calculating damage
                            reduction. Incoming damage buffs (e.g.{' '}
                            <em>-30% Incoming Direct Damage</em>) further adjust effective HP.
                        </p>
                        <p>
                            For example, a ship with 10,000 HP and 70% damage reduction has an
                            effective HP of 33,333, meaning it can take more than three times as
                            much damage as its raw HP value.
                        </p>
                    </div>

                    <div className="card">
                        <h2 className="text-xl font-bold mb-4">Damage Reduction Curve</h2>
                        <p className="mb-4">
                            Damage reduction follows a curve where higher defense values have
                            diminishing returns. The interactive chart below shows how damage
                            reduction increases with defense values from 0 to 26,000, and marks the
                            position of your ship configurations.
                        </p>

                        <DamageReductionChart
                            height={400}
                            maxDefense={26000}
                            ships={configs.map((config) => {
                                const totals = mergedBuffTotals.get(config.id);
                                const { buffedDefense, damageReduction } = computeBuffedStats(
                                    config.hp,
                                    config.defense,
                                    totals
                                );
                                return {
                                    id: config.id,
                                    name: config.name,
                                    defense: buffedDefense,
                                    damageReduction,
                                    isHighlighted: bestShip ? config.id === bestShip.id : false,
                                };
                            })}
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
        </>
    );
};

export default DefenseCalculatorPage;
