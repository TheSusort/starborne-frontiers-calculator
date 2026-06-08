import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageLayout } from '../../components/ui';
import { Ship, AffinityName } from '../../types/ship';
import { computeAffinityModifiers } from '../../utils/calculators/affinityUtils';
import {
    DPSShipConfig,
    DPSShipConfigUpdateableField,
    SelectedGameBuff,
    TeamShipConfig,
    EnemyBaseClass,
} from '../../types/calculator';
import { ShipSkills } from '../../types/abilities';
import { detectFullyCharged } from '../../utils/skillTextParser';
import { buildShipAbilities } from '../../utils/abilities/buildShipAbilities';
import {
    buildDefaultShipSkills,
    configShipSkillsToSimInputs,
} from '../../utils/abilities/configToSimInputs';
import { calculateTotalStats } from '../../utils/ship/statsCalculator';
import { simulateDPS, DPSSimulationResult } from '../../utils/calculators/dpsSimulator';
import { useShips } from '../../contexts/ShipsContext';
import { useInventory } from '../../contexts/InventoryProvider';
import { useEngineeringStats } from '../../hooks/useEngineeringStats';
import { Button } from '../../components/ui/Button';
import { DPSCalculatorTable } from '../../components/calculator/DPSCalculatorTable';
import { DPSChart } from '../../components/calculator/DPSChart';
import { DefensePenetrationChart } from '../../components/calculator/DefensePenetrationChart';
import { DPSRoundChart } from '../../components/calculator/DPSRoundChart';
import { EnemySettingsPanel } from '../../components/calculator/EnemySettingsPanel';
import { TeamPanel } from '../../components/calculator/TeamPanel';
import { ShipConfigCard } from '../../components/calculator/ShipConfigCard';
import Seo from '../../components/seo/Seo';
import { SEO_CONFIG } from '../../constants/seo';

const DPSCalculatorPage: React.FC = () => {
    const [searchParams, setSearchParams] = useSearchParams();
    const { getShipById } = useShips();
    const { getGearPiece } = useInventory();
    const { getEngineeringStatsForShipType } = useEngineeringStats();
    const shipInitialized = useRef(false);
    const nextTeamIdRef = useRef(2);

    // Shared final-stats derivation for ship selection (attacker config, team slots,
    // URL-seeded initial config) — one calculateTotalStats pattern, three call sites.
    const shipFinalStats = (ship: Ship) => {
        const engineeringStats = ship.type ? getEngineeringStatsForShipType(ship.type) : undefined;
        return calculateTotalStats(
            ship.baseStats,
            ship.equipment || {},
            getGearPiece,
            ship.refits,
            ship.implants,
            engineeringStats,
            ship.id
        ).final;
    };

    // Shared combat-stat extraction from a resolved final-stats object.
    // Single source of truth for the magic defaults (hacking ?? 200, speed ?? 100, etc.)
    // so selectShipForConfig and selectShipForTeamSlot can never silently diverge.
    const combatStatsFromShip = (final: ReturnType<typeof shipFinalStats>) => ({
        attack: Math.round(final.attack),
        crit: Math.round(final.crit),
        critDamage: Math.round(final.critDamage),
        defensePenetration: Math.round(final.defensePenetration || 0),
        hacking: Math.round(final.hacking ?? 200),
        defence: Math.round(final.defence ?? 0),
        hp: Math.round(final.hp ?? 0),
        healModifier: Math.round(final.healModifier ?? 0),
        speed: Math.round(final.speed ?? 100),
    });

    const getInitialConfig = (): { configs: DPSShipConfig[]; nextId: number } => {
        const shipId = searchParams.get('shipId');
        if (shipId) {
            const ship = getShipById(shipId);
            if (ship) {
                // Drop healModifier — it's not part of DPSShipConfig (attacker config).
                const { healModifier: _healModifier, ...stats } = combatStatsFromShip(
                    shipFinalStats(ship)
                );
                return {
                    configs: [
                        {
                            id: '1',
                            shipId: ship.id,
                            name: ship.name,
                            ...stats,
                            allyChargePerRound: 0,
                            chargeCount: ship.chargeSkillCharge ?? 0,
                            affinity: ship.affinity,
                            startCharged: detectFullyCharged([
                                ship.activeSkillText,
                                ship.chargeSkillText,
                                ship.firstPassiveSkillText,
                                ship.secondPassiveSkillText,
                                ship.thirdPassiveSkillText,
                            ]),
                            shipSkills: buildShipAbilities(ship),
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
                    hacking: 200,
                    defence: 0,
                    hp: 0,
                    speed: 100,
                    chargeCount: 0,
                    startCharged: false,
                    allyChargePerRound: 0,
                    shipSkills: buildDefaultShipSkills(),
                },
            ],
            nextId: 2,
        };
    };

    const [initialState] = useState(getInitialConfig);
    const [configs, setConfigs] = useState<DPSShipConfig[]>(initialState.configs);
    const [nextId, setNextId] = useState(initialState.nextId);
    const [enemyDefense, setEnemyDefense] = useState(10000);
    const [enemyHp, setEnemyHp] = useState(500000);
    const [enemySecurity, setEnemySecurity] = useState(100);
    const [enemySpeed, setEnemySpeed] = useState(50);
    const [enemyType, setEnemyType] = useState<EnemyBaseClass | undefined>(undefined);
    const [rounds, setRounds] = useState(20);
    const [viewMode, setViewMode] = useState<'table' | 'heatmap'>('heatmap');
    const [attackerBuffs, setAttackerBuffs] = useState<SelectedGameBuff[]>([]);
    const [enemyBuffs, setEnemyBuffs] = useState<SelectedGameBuff[]>([]);
    const [teamShips, setTeamShips] = useState<TeamShipConfig[]>([
        {
            id: 'team-1',
            buffs: [],
            enemyDebuffs: [],
            startCharged: false,
            speed: 100,
            chargeCount: 0,
        },
    ]);
    const [enemyAffinity, setEnemyAffinity] = useState<AffinityName>('antimatter');
    const [enemySettingsOpen, setEnemySettingsOpen] = useState(false);
    const [teamOpen, setTeamOpen] = useState(false);

    useEffect(() => {
        if (shipInitialized.current) return;
        shipInitialized.current = true;
        if (searchParams.has('shipId')) {
            searchParams.delete('shipId');
            setSearchParams(searchParams, { replace: true });
        }
    }, [searchParams, setSearchParams]);

    const teamAttackerBuffs = useMemo(() => teamShips.flatMap((t) => t.buffs), [teamShips]);

    // Display-ready team actors for the per-config turn-order strip: resolved ship name
    // (fallback "Team N") + turn-order speed. Listed in team order so the shared
    // orderByTurnPriority tiebreak resolves team → attacker → enemy at equal speeds.
    // Unconfigured placeholder slots (no ship picked AND no buffs/debuffs) contribute
    // nothing to the sim, so they are hidden from the strip ("Team N" numbering keeps
    // the slot index). The sim's teamActors list is intentionally NOT filtered — a
    // do-nothing actor is behavior-neutral, and manual-buff-only slots must stay in.
    const teamTurnOrderActors = useMemo(
        () =>
            teamShips
                .map((t, i) => ({
                    name: (t.shipId && getShipById(t.shipId)?.name) || `Team ${i + 1}`,
                    speed: t.speed,
                    configured: !!t.shipId || t.buffs.length > 0 || t.enemyDebuffs.length > 0,
                }))
                .filter((t) => t.configured)
                .map(({ name, speed }) => ({ name, speed })),
        [teamShips, getShipById]
    );

    const teamActors = useMemo(
        () =>
            teamShips.map((t) => ({
                id: t.id,
                speed: t.speed,
                chargeCount: t.chargeCount,
                startCharged: t.startCharged,
                selfBuffs: t.buffs,
                enemyDebuffs: t.enemyDebuffs,
                shipSkills: t.shipSkills,
                stats: t.stats,
                affinity: t.affinity,
            })),
        [teamShips]
    );

    const globalAttackerBuffTotals = useMemo(() => {
        const allGlobal = [...attackerBuffs, ...teamAttackerBuffs];
        return {
            attackBuff: allGlobal.reduce(
                (sum, s) => sum + (s.parsedEffects.attack ?? 0) * s.stacks,
                0
            ),
            critBuff: allGlobal.reduce((sum, s) => sum + (s.parsedEffects.crit ?? 0) * s.stacks, 0),
            critDamageBuff: allGlobal.reduce(
                (sum, s) => sum + (s.parsedEffects.critDamage ?? 0) * s.stacks,
                0
            ),
        };
    }, [attackerBuffs, teamAttackerBuffs]);

    // Convert each config's editor abilities (buff/debuff) into SelectedGameBuff form for
    // the display-only buff-totals preview (mergedAttackerBuffTotals below). The sim itself
    // no longer consumes these — the combat engine reads buff/debuff abilities from
    // shipSkills directly with live condition gating (no double-count). Memoized off
    // configs + enemyType so it never runs in render.
    const convertedMap = useMemo(
        () =>
            new Map(
                configs.map((c) => [c.id, configShipSkillsToSimInputs(c.shipSkills, enemyType)])
            ),
        [configs, enemyType]
    );

    const mergedAttackerBuffTotals = useMemo(
        () =>
            new Map(
                configs.map((c) => {
                    const selfBuffs = convertedMap.get(c.id)?.selfBuffs ?? [];
                    return [
                        c.id,
                        {
                            attackBuff:
                                globalAttackerBuffTotals.attackBuff +
                                selfBuffs.reduce(
                                    (sum, b) => sum + (b.parsedEffects.attack ?? 0) * b.stacks,
                                    0
                                ),
                            critBuff:
                                globalAttackerBuffTotals.critBuff +
                                selfBuffs.reduce(
                                    (sum, b) => sum + (b.parsedEffects.crit ?? 0) * b.stacks,
                                    0
                                ),
                            critDamageBuff:
                                globalAttackerBuffTotals.critDamageBuff +
                                selfBuffs.reduce(
                                    (sum, b) => sum + (b.parsedEffects.critDamage ?? 0) * b.stacks,
                                    0
                                ),
                        },
                    ];
                })
            ),
        [configs, convertedMap, globalAttackerBuffTotals]
    );

    const simResults = useMemo(() => {
        const map = new Map<string, DPSSimulationResult>();
        configs.forEach((config) => {
            const { damageModifier, critCap, critPenalty } = computeAffinityModifiers(
                config.affinity,
                enemyAffinity
            );
            map.set(
                config.id,
                simulateDPS({
                    attack: config.attack,
                    crit: config.crit,
                    critDamage: config.critDamage,
                    defensePenetration: config.defensePenetration,
                    hacking: config.hacking ?? 200,
                    defence: config.defence,
                    hp: config.hp,
                    speed: config.speed,
                    chargeCount: config.chargeCount,
                    shipSkills: config.shipSkills,
                    enemyDefense,
                    enemyHp,
                    enemySecurity,
                    enemySpeed,
                    teamActors,
                    rounds,
                    enemyAffinity,
                    selfBuffs: attackerBuffs,
                    enemyDebuffs: enemyBuffs,
                    startCharged: config.startCharged,
                    affinityDamageModifier: damageModifier,
                    affinityCritCap: critCap,
                    affinityCritPenalty: critPenalty,
                    allyChargePerRound: config.allyChargePerRound,
                    enemyType,
                })
            );
        });
        return map;
    }, [
        configs,
        enemyDefense,
        enemyHp,
        enemySecurity,
        enemySpeed,
        enemyType,
        rounds,
        attackerBuffs,
        enemyBuffs,
        enemyAffinity,
        teamActors,
    ]);

    const addConfig = () => {
        const id = nextId.toString();
        setConfigs((prev) => [
            ...prev,
            {
                id,
                name: `Ship ${nextId}`,
                attack: 15000,
                crit: 100,
                critDamage: 150,
                defensePenetration: 0,
                hacking: 200,
                defence: 0,
                hp: 0,
                speed: 100,
                chargeCount: 0,
                startCharged: false,
                allyChargePerRound: 0,
                shipSkills: buildDefaultShipSkills(),
            },
        ]);
        setNextId(nextId + 1);
    };

    const removeConfig = (id: string) => {
        setConfigs((prev) => {
            if (prev.length <= 1)
                return [
                    {
                        id: prev[0].id,
                        name: prev[0].name,
                        attack: 15000,
                        crit: 100,
                        critDamage: 125,
                        defensePenetration: 0,
                        hacking: 200,
                        defence: 0,
                        hp: 0,
                        speed: 100,
                        chargeCount: 0,
                        startCharged: false,
                        allyChargePerRound: 0,
                        shipSkills: buildDefaultShipSkills(),
                    },
                ];
            return prev.filter((config) => config.id !== id);
        });
    };

    const updateConfig = (
        id: string,
        field: DPSShipConfigUpdateableField,
        value: string | number | undefined
    ) => {
        setConfigs((prev) =>
            prev.map((config) => {
                if (config.id !== id) return config;
                const normalizedValue = field === 'affinity' && value === '' ? undefined : value;
                return { ...config, [field]: normalizedValue };
            })
        );
    };

    const updateConfigShipSkills = (id: string, shipSkills: ShipSkills) => {
        setConfigs((prev) => prev.map((c) => (c.id === id ? { ...c, shipSkills } : c)));
    };

    const selectShipForConfig = (configId: string, ship: Ship) => {
        // healModifier is a team/heal-target concern, not part of DPSShipConfig — drop it
        // from the attacker config spread (mirrors how team slots keep it separately).
        const { healModifier: _healModifier, ...stats } = combatStatsFromShip(shipFinalStats(ship));

        setConfigs((prev) =>
            prev.map((c) => {
                if (c.id !== configId) return c;
                return {
                    ...c,
                    shipId: ship.id,
                    name: ship.name,
                    ...stats,
                    allyChargePerRound: c.allyChargePerRound ?? 0,
                    // Reset (not carry over) when the new ship has no charge metadata —
                    // a stale threshold from the previous ship would mis-pace the sim.
                    chargeCount: ship.chargeSkillCharge ?? 0,
                    startCharged: detectFullyCharged([
                        ship.activeSkillText,
                        ship.chargeSkillText,
                        ship.firstPassiveSkillText,
                        ship.secondPassiveSkillText,
                        ship.thirdPassiveSkillText,
                    ]),
                    affinity: ship.affinity,
                    shipSkills: buildShipAbilities(ship),
                };
            })
        );
    };

    const updateConfigAllyCharge = (id: string, value: number) => {
        setConfigs((prev) =>
            prev.map((c) => (c.id === id ? { ...c, allyChargePerRound: value } : c))
        );
    };

    const addTeamShip = () => {
        if (teamShips.length >= 4) return;
        const id = `team-${nextTeamIdRef.current++}`;
        setTeamShips((prev) => [
            ...prev,
            { id, buffs: [], enemyDebuffs: [], startCharged: false, speed: 100, chargeCount: 0 },
        ]);
    };

    const removeTeamShip = (id: string) => {
        setTeamShips((prev) => {
            if (prev.length <= 1)
                return [
                    {
                        id: prev[0].id,
                        buffs: [],
                        enemyDebuffs: [],
                        startCharged: false,
                        speed: 100,
                        chargeCount: 0,
                    },
                ];
            return prev.filter((t) => t.id !== id);
        });
    };

    const selectShipForTeamSlot = (id: string, ship: Ship) => {
        const startCharged = detectFullyCharged([
            ship.activeSkillText,
            ship.chargeSkillText,
            ship.firstPassiveSkillText,
            ship.secondPassiveSkillText,
            ship.thirdPassiveSkillText,
        ]);
        const { speed, ...combatStats } = combatStatsFromShip(shipFinalStats(ship));
        setTeamShips((prev) =>
            prev.map((t) => {
                if (t.id !== id) return t;
                return {
                    ...t,
                    shipId: ship.id,
                    startCharged,
                    speed,
                    chargeCount: ship.chargeSkillCharge ?? 0,
                    shipSkills: buildShipAbilities(ship),
                    stats: combatStats,
                    affinity: ship.affinity,
                    // Walked skills supersede auto-fill stamping; clear any prior auto-filled
                    // entries while preserving the user's manual extras.
                    buffs: t.buffs.filter((b) => !b.autoFilled),
                    enemyDebuffs: t.enemyDebuffs.filter((b) => !b.autoFilled),
                };
            })
        );
    };

    const updateTeamShip = (id: string, updates: Partial<TeamShipConfig>) => {
        setTeamShips((prev) => prev.map((t) => (t.id === id ? { ...t, ...updates } : t)));
    };

    const bestConfig = configs.reduce<DPSShipConfig | null>((best, current) => {
        if (!best) return current;
        const bestDmg = simResults.get(best.id)?.summary.totalDamage ?? 0;
        const currentDmg = simResults.get(current.id)?.summary.totalDamage ?? 0;
        return currentDmg > bestDmg ? current : best;
    }, null);

    const secondBestConfig = configs
        .filter((c) => c.id !== bestConfig?.id)
        .reduce<DPSShipConfig | null>((best, current) => {
            if (!best) return current;
            const bestDmg = simResults.get(best.id)?.summary.totalDamage ?? 0;
            const currentDmg = simResults.get(current.id)?.summary.totalDamage ?? 0;
            return currentDmg > bestDmg ? current : best;
        }, null);

    const bestTotalDamage = simResults.get(bestConfig?.id ?? '')?.summary.totalDamage;
    const secondBestDmg = simResults.get(secondBestConfig?.id ?? '')?.summary.totalDamage;
    const bestVsSecondPercentage =
        bestTotalDamage && secondBestDmg
            ? ((bestTotalDamage - secondBestDmg) / secondBestDmg) * 100
            : null;

    return (
        <>
            <Seo {...SEO_CONFIG.damage} />
            <PageLayout
                title="DPS Calculator"
                description="Compare damage output across different ship configurations and combat scenarios."
                action={{ label: 'Add Ship', onClick: addConfig, variant: 'primary' }}
            >
                <div className="space-y-6">
                    <EnemySettingsPanel
                        isOpen={enemySettingsOpen}
                        onToggle={() => setEnemySettingsOpen((v) => !v)}
                        enemyDefense={enemyDefense}
                        onEnemyDefenseChange={setEnemyDefense}
                        enemyHp={enemyHp}
                        onEnemyHpChange={setEnemyHp}
                        rounds={rounds}
                        onRoundsChange={setRounds}
                        enemyBuffs={enemyBuffs}
                        onEnemyBuffsChange={setEnemyBuffs}
                        enemyAffinity={enemyAffinity}
                        onEnemyAffinityChange={setEnemyAffinity}
                        enemySecurity={enemySecurity}
                        onEnemySecurityChange={setEnemySecurity}
                        enemySpeed={enemySpeed}
                        onEnemySpeedChange={setEnemySpeed}
                        enemyType={enemyType}
                        onEnemyTypeChange={setEnemyType}
                    />

                    <TeamPanel
                        isOpen={teamOpen}
                        onToggle={() => setTeamOpen((v) => !v)}
                        attackerBuffs={attackerBuffs}
                        onAttackerBuffsChange={setAttackerBuffs}
                        enemyAffinity={enemyAffinity}
                        teamShips={teamShips}
                        onAddTeamShip={addTeamShip}
                        onRemoveTeamShip={removeTeamShip}
                        onSelectTeamShip={selectShipForTeamSlot}
                        onTeamShipStartChargedChange={(id, checked) =>
                            updateTeamShip(id, { startCharged: checked })
                        }
                        onTeamShipSpeedChange={(id, speed) => updateTeamShip(id, { speed })}
                        onTeamShipChargeCountChange={(id, chargeCount) =>
                            updateTeamShip(id, { chargeCount })
                        }
                        onTeamShipBuffsChange={(id, buffs) => updateTeamShip(id, { buffs })}
                        onTeamShipEnemyDebuffsChange={(id, debuffs) =>
                            updateTeamShip(id, { enemyDebuffs: debuffs })
                        }
                        onTeamShipStatsChange={(id, stats) => updateTeamShip(id, { stats })}
                        onTeamShipAffinityChange={(id, affinity) =>
                            updateTeamShip(id, { affinity })
                        }
                        onTeamShipShipSkillsChange={(id, shipSkills) =>
                            updateTeamShip(id, { shipSkills })
                        }
                    />

                    <div
                        className={`grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 ${configs.length >= 4 ? '2xl:w-[calc(100vw-256px-2rem)] 2xl:ml-[calc((-100vw/2)+768px+1rem)] 2xl:[grid-template-columns:repeat(auto-fit,minmax(370px,500px))] 2xl:justify-center' : ''}`}
                    >
                        {configs.map((config) => (
                            <ShipConfigCard
                                key={config.id}
                                config={config}
                                isBest={bestConfig?.id === config.id}
                                enemyAffinity={enemyAffinity}
                                enemySecurity={enemySecurity}
                                teamActors={teamTurnOrderActors}
                                enemySpeed={enemySpeed}
                                isComparing={configs.length > 1}
                                simResult={simResults.get(config.id)}
                                bestTotalDamage={bestTotalDamage}
                                bestVsSecondPercentage={bestVsSecondPercentage}
                                rounds={rounds}
                                attackerBuffTotals={mergedAttackerBuffTotals.get(config.id)!}
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
                                onShipSkillsChange={(shipSkills) =>
                                    updateConfigShipSkills(config.id, shipSkills)
                                }
                                onAllyChargeChange={(value) =>
                                    updateConfigAllyCharge(config.id, value)
                                }
                            />
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
                            enemyHp={enemyHp}
                        />
                    </div>

                    <div className="card">
                        <div className="flex justify-between items-center mb-2">
                            <h3 className="text-lg font-bold">DPS Comparison</h3>
                            <Button
                                variant="secondary"
                                onClick={() =>
                                    setViewMode((v) => (v === 'table' ? 'heatmap' : 'table'))
                                }
                            >
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
                            Direct = (Attack × (SkillMultiplier% + ConditionalBonus%) + SourceStat ×
                            Secondary%) × CritMultiplier × (1 - DamageReduction%) × (1 +
                            OutgoingDmg%) × (1 + IncomingDmg%) × (1 + Affinity%)
                        </p>
                        <p className="mb-2">
                            Some ships deal additional damage equal to a percentage of their Defense
                            or max HP (e.g. Chakara, Lodolite). This secondary term is added to the
                            base hit before crit and defense reduction are applied, and it scales
                            with Defense Up / HP buffs. It is auto-detected from skill text and
                            editable in each skill row.
                        </p>
                        <p className="mb-2">
                            Some attackers gain bonus damage that scales with a count — e.g. +20%
                            per adjacent ally, or +15% per debuff on the enemy. This bonus is added
                            to the skill multiplier. When the count is something the simulator
                            tracks (your own buffs, or debuffs on the enemy) it is counted
                            automatically each round; otherwise you set the count manually. It is
                            auto-detected from skill text and editable per skill row.
                        </p>
                        <p className="mb-2">
                            DoT effects (corrosion, inferno, bombs) bypass enemy defense entirely.
                            Corrosion deals a percentage of the target&apos;s HP per stack. Inferno
                            and bombs deal a percentage of the attacker&apos;s attack stat. Bombs
                            detonate after a countdown period. DoT damage is multiplied by the
                            combined Out. DoT + Inc. DoT modifier from the buff pickers.
                        </p>
                        <p>All DoTs stack permanently and tick on the turn they are applied.</p>
                        <p className="mt-2">
                            Debuff landing is modelled via hacking and security stats. Each round,
                            every active enemy debuff is rolled independently:{' '}
                            <span className="font-mono">
                                clamp(hacking × affinityMult − enemySecurity, 0, 100)%
                            </span>{' '}
                            chance to land, where affinityMult is ×1.25 for advantage, ×0.75 for
                            disadvantage, or ×1 for neutral. At the defaults (hacking 200, security
                            100) debuffs always land.
                        </p>
                        <p className="mt-2">
                            <strong>Fully deterministic.</strong> The simulation contains no
                            randomness — identical inputs always produce identical results. Crits
                            are decided round-by-round using a fractional-accumulator schedule at
                            the ship&apos;s effective crit rate, with separate schedules for active
                            and charged hits (preventing cadence aliasing). Rounds that crit show a{' '}
                            <strong>Crit</strong> badge in the chart tooltip. Attacks marked
                            &quot;cannot critically hit&quot; never crit and consume no crit chance.
                            Debuff/DoT landing and chance-based DoT extensions use the same
                            deterministic schedule approach.
                        </p>
                        <p className="mt-2">
                            <strong>Hard condition gates.</strong> Conditions on damage, stat-based
                            bonus damage, DoTs, detonations, and accumulate-and-detonate abilities
                            gate strictly — if a condition is not met in a given round, that
                            component contributes zero damage. Scaling conditions (e.g. &quot;+X%
                            per enemy debuff&quot;) deal no damage when the count is zero.
                        </p>
                        <p className="mt-2">
                            <strong>Derived enemy HP.</strong> Enemy HP percentage declines as
                            cumulative damage accumulates against the configured enemy HP pool, so
                            execute-style &quot;below X% HP&quot; gates switch on at the correct
                            round mid-fight rather than always passing or always failing.
                        </p>
                        <p className="mt-2">
                            <strong>Execution order.</strong> Abilities within a skill fire in the
                            order they appear in the skill text, matching in-game execution. A DoT
                            inflicted early in a skill can therefore satisfy a later ability&apos;s
                            &quot;enemy has a debuff&quot; condition in the same round.
                        </p>
                    </div>
                </div>
            </PageLayout>
        </>
    );
};

export default DPSCalculatorPage;
