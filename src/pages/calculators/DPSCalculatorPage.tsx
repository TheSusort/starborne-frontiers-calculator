import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageLayout } from '../../components/ui';
import { Ship, AffinityName } from '../../types/ship';
import { computeAffinityModifiers } from '../../utils/calculators/affinityUtils';
import {
    DPSShipConfig,
    DPSShipConfigUpdateableField,
    DoTApplicationEntry,
    DEFAULT_DOT_CONFIG,
    SelectedGameBuff,
    TeamShipConfig,
    SecondaryDamage,
    ConditionalDamage,
    ChargeGain,
    EnemyBaseClass,
} from '../../types/calculator';
import {
    parseSkillDamage,
    parseSecondaryDamage,
    parseConditionalDamage,
    detectFullyCharged,
    parseChargeGain,
} from '../../utils/skillTextParser';
import {
    buildSkillBuffAutoFill,
    buildDoTAutoFill,
    mergeAutoFill,
    mergeAutoFillDoTs,
} from '../../utils/calculators/skillBuffAutoFill';
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
import { CombatSettingsPanel } from '../../components/calculator/CombatSettingsPanel';
import { ShipConfigCard } from '../../components/calculator/ShipConfigCard';
import Seo from '../../components/seo/Seo';
import { SEO_CONFIG } from '../../constants/seo';

function buildSkillAutoFill(ship: Ship) {
    const activeParsed = parseSkillDamage(ship.activeSkillText ?? '');
    const chargedParsed = parseSkillDamage(ship.chargeSkillText ?? '');
    const activeSecondary = parseSecondaryDamage(ship.activeSkillText) ?? undefined;
    const chargedSecondary = parseSecondaryDamage(ship.chargeSkillText) ?? undefined;
    const seedManual = (c: ConditionalDamage | null): ConditionalDamage | undefined => {
        if (!c) return undefined;
        return !c.derivable && c.manualCount === undefined ? { ...c, manualCount: 1 } : c;
    };
    const activeConditional = seedManual(parseConditionalDamage(ship.activeSkillText));
    const chargedConditional = seedManual(parseConditionalDamage(ship.chargeSkillText));
    const seedChargeManual = (c: ChargeGain | null): ChargeGain | undefined => {
        if (!c) return undefined;
        return !c.derivable && c.manualCount === undefined ? { ...c, manualCount: 1 } : c;
    };
    const selfChargeGain = seedChargeManual(
        parseChargeGain(ship.activeSkillText) ??
            parseChargeGain(ship.firstPassiveSkillText) ??
            parseChargeGain(ship.secondPassiveSkillText) ??
            parseChargeGain(ship.thirdPassiveSkillText)
    );
    const autoFilledFields = new Set<
        | 'activeMultiplier'
        | 'chargedMultiplier'
        | 'hacking'
        | 'activeSecondary'
        | 'chargedSecondary'
        | 'activeConditional'
        | 'chargedConditional'
        | 'selfChargeGain'
    >();
    if (activeParsed > 0) autoFilledFields.add('activeMultiplier');
    if (chargedParsed > 0) autoFilledFields.add('chargedMultiplier');
    if (activeSecondary) autoFilledFields.add('activeSecondary');
    if (chargedSecondary) autoFilledFields.add('chargedSecondary');
    if (activeConditional) autoFilledFields.add('activeConditional');
    if (chargedConditional) autoFilledFields.add('chargedConditional');
    if (selfChargeGain) autoFilledFields.add('selfChargeGain');
    return {
        activeParsed,
        chargedParsed,
        activeSecondary,
        chargedSecondary,
        activeConditional,
        chargedConditional,
        selfChargeGain,
        autoFilledFields,
    };
}

const DPSCalculatorPage: React.FC = () => {
    const [searchParams, setSearchParams] = useSearchParams();
    const { getShipById } = useShips();
    const { getGearPiece } = useInventory();
    const { getEngineeringStatsForShipType } = useEngineeringStats();
    const shipInitialized = useRef(false);
    const nextDoTIdRef = useRef(1);
    const nextTeamIdRef = useRef(2);

    const getInitialConfig = (): { configs: DPSShipConfig[]; nextId: number } => {
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
                const {
                    activeParsed,
                    chargedParsed,
                    activeSecondary,
                    chargedSecondary,
                    activeConditional,
                    chargedConditional,
                    selfChargeGain,
                    autoFilledFields,
                } = buildSkillAutoFill(ship);
                autoFilledFields.add('hacking');
                return {
                    configs: [
                        {
                            id: '1',
                            shipId: ship.id,
                            name: ship.name,
                            attack: Math.round(final.attack),
                            crit: Math.round(final.crit),
                            critDamage: Math.round(final.critDamage),
                            defensePenetration: Math.round(final.defensePenetration || 0),
                            hacking: Math.round(final.hacking ?? 200),
                            defence: Math.round(final.defence ?? 0),
                            hp: Math.round(final.hp ?? 0),
                            activeSecondary,
                            chargedSecondary,
                            activeConditional,
                            chargedConditional,
                            selfChargeGain,
                            allyChargePerRound: 0,
                            activeMultiplier: activeParsed > 0 ? activeParsed : 100,
                            chargedMultiplier: chargedParsed > 0 ? chargedParsed : 0,
                            chargeCount: ship.chargeSkillCharge ?? 0,
                            startCharged: detectFullyCharged([
                                ship.activeSkillText,
                                ship.chargeSkillText,
                                ship.firstPassiveSkillText,
                                ship.secondPassiveSkillText,
                                ship.thirdPassiveSkillText,
                            ]),
                            autoFilledFields,
                            activeDoTs: [...DEFAULT_DOT_CONFIG],
                            chargedDoTs: [...DEFAULT_DOT_CONFIG],
                            buffs: [],
                            enemyDebuffs: [],
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
                    activeMultiplier: 100,
                    chargedMultiplier: 0,
                    chargeCount: 0,
                    startCharged: false,
                    allyChargePerRound: 0,
                    activeDoTs: [...DEFAULT_DOT_CONFIG],
                    chargedDoTs: [...DEFAULT_DOT_CONFIG],
                    buffs: [],
                    enemyDebuffs: [],
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
    const [enemyType, setEnemyType] = useState<EnemyBaseClass | undefined>(undefined);
    const [rounds, setRounds] = useState(20);
    const [viewMode, setViewMode] = useState<'table' | 'heatmap'>('heatmap');
    const [attackerBuffs, setAttackerBuffs] = useState<SelectedGameBuff[]>([]);
    const [enemyBuffs, setEnemyBuffs] = useState<SelectedGameBuff[]>([]);
    const [teamShips, setTeamShips] = useState<TeamShipConfig[]>([
        { id: 'team-1', buffs: [], enemyDebuffs: [], startCharged: false },
    ]);
    const [enemyAffinity, setEnemyAffinity] = useState<AffinityName>('antimatter');
    const [combatSettingsOpen, setCombatSettingsOpen] = useState(false);

    useEffect(() => {
        if (shipInitialized.current) return;
        shipInitialized.current = true;
        if (searchParams.has('shipId')) {
            searchParams.delete('shipId');
            setSearchParams(searchParams, { replace: true });
        }
    }, [searchParams, setSearchParams]);

    const teamAttackerBuffs = useMemo(() => teamShips.flatMap((t) => t.buffs), [teamShips]);

    const teamEnemyDebuffs = useMemo(
        () =>
            teamShips.flatMap((t) =>
                t.enemyDebuffs.map((d) => ({ ...d, sourceStartCharged: t.startCharged }))
            ),
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

    const mergedAttackerBuffTotals = useMemo(
        () =>
            new Map(
                configs.map((c) => [
                    c.id,
                    {
                        attackBuff:
                            globalAttackerBuffTotals.attackBuff +
                            c.buffs.reduce(
                                (sum, b) => sum + (b.parsedEffects.attack ?? 0) * b.stacks,
                                0
                            ),
                        critBuff:
                            globalAttackerBuffTotals.critBuff +
                            c.buffs.reduce(
                                (sum, b) => sum + (b.parsedEffects.crit ?? 0) * b.stacks,
                                0
                            ),
                        critDamageBuff:
                            globalAttackerBuffTotals.critDamageBuff +
                            c.buffs.reduce(
                                (sum, b) => sum + (b.parsedEffects.critDamage ?? 0) * b.stacks,
                                0
                            ),
                    },
                ])
            ),
        [configs, globalAttackerBuffTotals]
    );

    const simResults = useMemo(() => {
        const map = new Map<string, DPSSimulationResult>();
        configs.forEach((config) => {
            const allAttackerBuffs = [...attackerBuffs, ...config.buffs];
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
                    activeSecondary: config.activeSecondary,
                    chargedSecondary: config.chargedSecondary,
                    activeConditional: config.activeConditional,
                    chargedConditional: config.chargedConditional,
                    activeMultiplier: config.activeMultiplier,
                    chargedMultiplier: config.chargedMultiplier,
                    chargeCount: config.chargeCount,
                    activeDoTs: config.activeDoTs,
                    chargedDoTs: config.chargedDoTs,
                    enemyDefense,
                    enemyHp,
                    enemySecurity,
                    rounds,
                    selfBuffs: [...allAttackerBuffs, ...teamAttackerBuffs],
                    enemyDebuffs: [...enemyBuffs, ...teamEnemyDebuffs, ...config.enemyDebuffs],
                    startCharged: config.startCharged,
                    affinityDamageModifier: damageModifier,
                    affinityCritCap: critCap,
                    affinityCritPenalty: critPenalty,
                    selfChargeGain: config.selfChargeGain,
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
        enemyType,
        rounds,
        attackerBuffs,
        enemyBuffs,
        enemyAffinity,
        teamAttackerBuffs,
        teamEnemyDebuffs,
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
                activeMultiplier: 100,
                chargedMultiplier: 0,
                chargeCount: 0,
                startCharged: false,
                activeDoTs: [...DEFAULT_DOT_CONFIG],
                chargedDoTs: [...DEFAULT_DOT_CONFIG],
                buffs: [],
                enemyDebuffs: [],
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
                        activeMultiplier: 100,
                        chargedMultiplier: 0,
                        chargeCount: 0,
                        startCharged: false,
                        activeDoTs: [...DEFAULT_DOT_CONFIG],
                        chargedDoTs: [...DEFAULT_DOT_CONFIG],
                        buffs: [],
                        enemyDebuffs: [],
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
                const updated = { ...config, [field]: normalizedValue };
                if (
                    field === 'activeMultiplier' ||
                    field === 'chargedMultiplier' ||
                    field === 'hacking'
                ) {
                    const next = new Set(config.autoFilledFields);
                    next.delete(field);
                    updated.autoFilledFields = next;
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
        const {
            activeParsed,
            chargedParsed,
            activeSecondary,
            chargedSecondary,
            activeConditional,
            chargedConditional,
            selfChargeGain,
            autoFilledFields,
        } = buildSkillAutoFill(ship);
        autoFilledFields.add('hacking');
        const { selfBuffs, enemyDebuffs: newEnemyDebuffs } = buildSkillBuffAutoFill(ship);
        const { activeDoTs: newActiveDoTs, chargedDoTs: newChargedDoTs } = buildDoTAutoFill(ship);

        setConfigs((prev) =>
            prev.map((c) => {
                if (c.id !== configId) return c;
                // Keep manually-added enemy debuffs; replace auto-filled ones with the new ship's
                const manualEnemyDebuffs = c.enemyDebuffs.filter((b) => !b.autoFilled);
                return {
                    ...c,
                    shipId: ship.id,
                    name: ship.name,
                    attack: Math.round(final.attack),
                    crit: Math.round(final.crit),
                    critDamage: Math.round(final.critDamage),
                    defensePenetration: Math.round(final.defensePenetration || 0),
                    hacking: Math.round(final.hacking ?? 200),
                    defence: Math.round(final.defence ?? 0),
                    hp: Math.round(final.hp ?? 0),
                    activeSecondary,
                    chargedSecondary,
                    activeConditional,
                    chargedConditional,
                    selfChargeGain,
                    allyChargePerRound: c.allyChargePerRound ?? 0,
                    activeMultiplier: activeParsed > 0 ? activeParsed : c.activeMultiplier,
                    chargedMultiplier: chargedParsed > 0 ? chargedParsed : c.chargedMultiplier,
                    chargeCount: ship.chargeSkillCharge ?? c.chargeCount,
                    startCharged: detectFullyCharged([
                        ship.activeSkillText,
                        ship.chargeSkillText,
                        ship.firstPassiveSkillText,
                        ship.secondPassiveSkillText,
                        ship.thirdPassiveSkillText,
                    ]),
                    autoFilledFields,
                    affinity: ship.affinity,
                    buffs: mergeAutoFill(c.buffs, selfBuffs),
                    enemyDebuffs: mergeAutoFill(manualEnemyDebuffs, newEnemyDebuffs),
                    activeDoTs: mergeAutoFillDoTs(c.activeDoTs, newActiveDoTs),
                    chargedDoTs: mergeAutoFillDoTs(c.chargedDoTs, newChargedDoTs),
                };
            })
        );
    };

    const addDoTEntry = (configId: string, dotField: 'activeDoTs' | 'chargedDoTs') => {
        const id = nextDoTIdRef.current;
        nextDoTIdRef.current += 1;
        setConfigs((prev) =>
            prev.map((c) =>
                c.id === configId
                    ? {
                          ...c,
                          [dotField]: [
                              ...c[dotField],
                              {
                                  id: id.toString(),
                                  type: 'inferno' as const,
                                  tier: 15,
                                  stacks: 1,
                                  duration: 2,
                              },
                          ],
                      }
                    : c
            )
        );
    };

    const removeDoTEntry = (
        configId: string,
        dotField: 'activeDoTs' | 'chargedDoTs',
        dotId: string
    ) => {
        setConfigs((prev) =>
            prev.map((c) =>
                c.id === configId
                    ? { ...c, [dotField]: c[dotField].filter((d) => d.id !== dotId) }
                    : c
            )
        );
    };

    const updateDoTEntry = (
        configId: string,
        dotField: 'activeDoTs' | 'chargedDoTs',
        dotId: string,
        updates: Partial<DoTApplicationEntry>
    ) => {
        setConfigs((prev) =>
            prev.map((c) =>
                c.id === configId
                    ? {
                          ...c,
                          [dotField]: c[dotField].map((d) =>
                              d.id === dotId ? { ...d, ...updates } : d
                          ),
                      }
                    : c
            )
        );
    };

    const updateConfigBuffs = (id: string, buffs: SelectedGameBuff[]) => {
        setConfigs((prev) => prev.map((c) => (c.id === id ? { ...c, buffs } : c)));
    };

    const updateConfigSecondary = (
        id: string,
        field: 'activeSecondary' | 'chargedSecondary',
        value: SecondaryDamage | undefined
    ) => {
        setConfigs((prev) =>
            prev.map((c) => {
                if (c.id !== id) return c;
                const next = new Set(c.autoFilledFields);
                next.delete(field);
                return { ...c, [field]: value, autoFilledFields: next };
            })
        );
    };

    const updateConfigConditional = (
        id: string,
        field: 'activeConditional' | 'chargedConditional',
        value: ConditionalDamage | undefined
    ) => {
        setConfigs((prev) =>
            prev.map((c) => {
                if (c.id !== id) return c;
                const next = new Set(c.autoFilledFields);
                next.delete(field);
                return { ...c, [field]: value, autoFilledFields: next };
            })
        );
    };

    const updateConfigChargeGain = (id: string, value: ChargeGain | undefined) => {
        setConfigs((prev) =>
            prev.map((c) => {
                if (c.id !== id) return c;
                const next = new Set(c.autoFilledFields);
                next.delete('selfChargeGain');
                return { ...c, selfChargeGain: value, autoFilledFields: next };
            })
        );
    };

    const updateConfigAllyCharge = (id: string, value: number) => {
        setConfigs((prev) =>
            prev.map((c) => (c.id === id ? { ...c, allyChargePerRound: value } : c))
        );
    };

    const updateConfigEnemyDebuffs = (id: string, enemyDebuffs: SelectedGameBuff[]) => {
        setConfigs((prev) => prev.map((c) => (c.id === id ? { ...c, enemyDebuffs } : c)));
    };

    const addTeamShip = () => {
        if (teamShips.length >= 4) return;
        const id = `team-${nextTeamIdRef.current++}`;
        setTeamShips((prev) => [...prev, { id, buffs: [], enemyDebuffs: [], startCharged: false }]);
    };

    const removeTeamShip = (id: string) => {
        setTeamShips((prev) => {
            if (prev.length <= 1)
                return [{ id: prev[0].id, buffs: [], enemyDebuffs: [], startCharged: false }];
            return prev.filter((t) => t.id !== id);
        });
    };

    const selectShipForTeamSlot = (id: string, ship: Ship) => {
        const { selfBuffs, enemyDebuffs: newEnemyDebuffs } = buildSkillBuffAutoFill(ship);
        const startCharged = detectFullyCharged([
            ship.activeSkillText,
            ship.chargeSkillText,
            ship.firstPassiveSkillText,
            ship.secondPassiveSkillText,
            ship.thirdPassiveSkillText,
        ]);
        setTeamShips((prev) =>
            prev.map((t) => {
                if (t.id !== id) return t;
                return {
                    ...t,
                    shipId: ship.id,
                    startCharged,
                    buffs: mergeAutoFill(t.buffs, selfBuffs),
                    enemyDebuffs: mergeAutoFill(t.enemyDebuffs, newEnemyDebuffs),
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
                    <CombatSettingsPanel
                        isOpen={combatSettingsOpen}
                        onToggle={() => setCombatSettingsOpen((v) => !v)}
                        enemyDefense={enemyDefense}
                        onEnemyDefenseChange={setEnemyDefense}
                        enemyHp={enemyHp}
                        onEnemyHpChange={setEnemyHp}
                        rounds={rounds}
                        onRoundsChange={setRounds}
                        attackerBuffs={attackerBuffs}
                        onAttackerBuffsChange={setAttackerBuffs}
                        enemyBuffs={enemyBuffs}
                        onEnemyBuffsChange={setEnemyBuffs}
                        enemyAffinity={enemyAffinity}
                        onEnemyAffinityChange={setEnemyAffinity}
                        enemySecurity={enemySecurity}
                        onEnemySecurityChange={setEnemySecurity}
                        teamShips={teamShips}
                        onAddTeamShip={addTeamShip}
                        onRemoveTeamShip={removeTeamShip}
                        onSelectTeamShip={selectShipForTeamSlot}
                        onTeamShipStartChargedChange={(id, checked) =>
                            updateTeamShip(id, { startCharged: checked })
                        }
                        onTeamShipBuffsChange={(id, buffs) => updateTeamShip(id, { buffs })}
                        onTeamShipEnemyDebuffsChange={(id, debuffs) =>
                            updateTeamShip(id, { enemyDebuffs: debuffs })
                        }
                        enemyType={enemyType}
                        onEnemyTypeChange={setEnemyType}
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
                                onAddDoT={(dotField) => addDoTEntry(config.id, dotField)}
                                onRemoveDoT={(dotField, dotId) =>
                                    removeDoTEntry(config.id, dotField, dotId)
                                }
                                onUpdateDoT={(dotField, dotId, updates) =>
                                    updateDoTEntry(config.id, dotField, dotId, updates)
                                }
                                onBuffsChange={(buffs) => updateConfigBuffs(config.id, buffs)}
                                onEnemyDebuffsChange={(debuffs) =>
                                    updateConfigEnemyDebuffs(config.id, debuffs)
                                }
                                onSecondaryChange={(field, value) =>
                                    updateConfigSecondary(config.id, field, value)
                                }
                                onConditionalChange={(field, value) =>
                                    updateConfigConditional(config.id, field, value)
                                }
                                onChargeGainChange={(value) =>
                                    updateConfigChargeGain(config.id, value)
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
                            100) debuffs always land. Each simulation is a single stochastic run —
                            rounds where the roll fails show no DoT or debuff damage, while rounds
                            where it lands show full effect. The chart reflects one realistic
                            playthrough rather than a smoothed average. Conditional buffs and
                            debuffs (e.g. &quot;on kill&quot;, &quot;when enemy has 3+
                            debuffs&quot;) are treated as always active for simplicity.
                        </p>
                    </div>
                </div>
            </PageLayout>
        </>
    );
};

export default DPSCalculatorPage;
