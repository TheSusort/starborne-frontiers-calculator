import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageLayout } from '../../components/ui';
import { Ship, AffinityName } from '../../types/ship';
import type { ShipTypeName } from '../../constants/shipTypes';
import {
    HealerShipConfig,
    HealerShipConfigUpdateableField,
    SelectedGameBuff,
    TeamShipConfig,
    TeamActorInput,
    CombatStatBlock,
} from '../../types/calculator';
import { ShipSkills } from '../../types/abilities';
import { detectFullyCharged } from '../../utils/skillTextParser';
import { buildShipAbilities } from '../../utils/abilities/buildShipAbilities';
import { buildDefaultShipSkills } from '../../utils/abilities/configToSimInputs';
import { calculateTotalStats } from '../../utils/ship/statsCalculator';
import {
    simulateHealing,
    HealingSimulationResult,
    EnemyAttackerInput,
} from '../../utils/calculators/healingEngineAdapter';
import { useShips } from '../../contexts/ShipsContext';
import { useInventory } from '../../contexts/InventoryProvider';
import { useEngineeringStats } from '../../hooks/useEngineeringStats';
import { Input } from '../../components/ui/Input';
import { HealerConfigCard } from '../../components/calculator/HealerConfigCard';
import { HealTargetPanel, HealTargetState } from '../../components/calculator/HealTargetPanel';
import {
    EnemyAttackersPanel,
    EnemyAttackerConfig,
    MAX_ENEMY_ATTACKERS,
} from '../../components/calculator/EnemyAttackersPanel';
import { TeamPanel } from '../../components/calculator/TeamPanel';
import { GameBuffPicker } from '../../components/calculator/GameBuffPicker';
import { HealingCumulativeChart } from '../../components/calculator/HealingCumulativeChart';
import { HealingTimelineChart } from '../../components/calculator/HealingTimelineChart';
import { CollapsibleForm } from '../../components/ui/layout/CollapsibleForm';
import { ChevronDownIcon } from '../../components/ui/icons/ChevronIcons';
import { Button } from '../../components/ui/Button';
import Seo from '../../components/seo/Seo';
import { SEO_CONFIG } from '../../constants/seo';

const HEAL_TARGET_ID = 'heal-target';

const detectShipCharged = (ship: Ship): boolean =>
    detectFullyCharged([
        ship.activeSkillText,
        ship.chargeSkillText,
        ship.firstPassiveSkillText,
        ship.secondPassiveSkillText,
        ship.thirdPassiveSkillText,
    ]);

const HealingCalculatorPage: React.FC = () => {
    const [searchParams, setSearchParams] = useSearchParams();
    const { getShipById } = useShips();
    const { getGearPiece } = useInventory();
    const { getEngineeringStatsForShipType } = useEngineeringStats();
    const shipInitialized = useRef(false);
    const nextTeamIdRef = useRef(2);
    const nextEnemyIdRef = useRef(2);

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

    // Shared healer-stat extraction from resolved final stats.
    const healerStatsFromShip = (final: ReturnType<typeof shipFinalStats>) => ({
        hp: Math.round(final.hp ?? 0),
        attack: Math.round(final.attack ?? 0),
        defence: Math.round(final.defence ?? 0),
        crit: Math.round(final.crit ?? 0),
        critDamage: Math.round(final.critDamage ?? 0),
        healModifier: Math.round(final.healModifier ?? 0),
        speed: Math.round(final.speed ?? 100),
        hacking: Math.round(final.hacking ?? 200),
    });

    const defaultConfig = (id: string, name: string): HealerShipConfig => ({
        id,
        name,
        hp: 40000,
        attack: 10000,
        defence: 5000,
        crit: 50,
        critDamage: 100,
        healModifier: 20,
        speed: 100,
        hacking: 200,
        chargeCount: 0,
        startCharged: false,
        shipSkills: buildDefaultShipSkills(),
    });

    const getInitialConfig = (): { configs: HealerShipConfig[]; nextId: number } => {
        const shipId = searchParams.get('shipId');
        if (shipId) {
            const ship = getShipById(shipId);
            if (ship) {
                return {
                    configs: [
                        {
                            id: '1',
                            shipId: ship.id,
                            name: ship.name,
                            ...healerStatsFromShip(shipFinalStats(ship)),
                            chargeCount: ship.chargeSkillCharge ?? 0,
                            startCharged: detectShipCharged(ship),
                            shipSkills: buildShipAbilities(ship),
                        },
                    ],
                    nextId: 2,
                };
            }
        }
        return { configs: [defaultConfig('1', 'Healer 1')], nextId: 2 };
    };

    const [initialState] = useState(getInitialConfig);
    const [configs, setConfigs] = useState<HealerShipConfig[]>(initialState.configs);
    const [nextId, setNextId] = useState(initialState.nextId);
    const [rounds, setRounds] = useState(20);
    const [healerBuffs, setHealerBuffs] = useState<SelectedGameBuff[]>([]);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [targetOpen, setTargetOpen] = useState(false);
    const [enemiesOpen, setEnemiesOpen] = useState(false);
    const [teamOpen, setTeamOpen] = useState(false);

    const [target, setTarget] = useState<HealTargetState>({
        useHealerAsTarget: true,
        hp: 40000,
        defence: 5000,
        speed: 100,
    });
    const [targetShipSkills, setTargetShipSkills] = useState<ShipSkills | undefined>(undefined);
    const [targetChargeCount, setTargetChargeCount] = useState(0);
    const [targetStartCharged, setTargetStartCharged] = useState(false);
    // Selected heal-target ship's affinity (explicit-target case). Drives each enemy attacker's
    // matchup vs the target. Undefined → neutral. Self-heal resolves from the healer ship instead.
    const [targetAffinity, setTargetAffinity] = useState<AffinityName | undefined>(undefined);
    // Selected heal-target ship's role (explicit-target case). Drives role-filtered
    // on-ally-attacked reactions (Graphite) when the target is hit. Undefined → no ship picked →
    // the reaction stays dormant for hits on it (conservative). Self-heal resolves from the
    // healer ship instead (healerRole below).
    const [targetRole, setTargetRole] = useState<ShipTypeName | undefined>(undefined);
    const [targetCombatStats, setTargetCombatStats] = useState<CombatStatBlock | undefined>(
        undefined
    );

    const [enemies, setEnemies] = useState<EnemyAttackerConfig[]>([
        {
            id: '1',
            name: 'Enemy 1',
            attack: 4000,
            crit: 0,
            critDamage: 0,
            speed: 50,
            chargeCount: 0,
            startCharged: false,
        },
    ]);

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

    useEffect(() => {
        if (shipInitialized.current) return;
        shipInitialized.current = true;
        if (searchParams.has('shipId')) {
            searchParams.delete('shipId');
            setSearchParams(searchParams, { replace: true });
        }
    }, [searchParams, setSearchParams]);

    // ---- Healer config handlers ----
    const addConfig = () => {
        const id = nextId.toString();
        setConfigs((prev) => [...prev, defaultConfig(id, `Healer ${nextId}`)]);
        setNextId((n) => n + 1);
    };

    const removeConfig = (id: string) => {
        setConfigs((prev) => {
            if (prev.length <= 1) return [defaultConfig(prev[0].id, prev[0].name)];
            return prev.filter((c) => c.id !== id);
        });
    };

    const updateConfig = (
        id: string,
        field: HealerShipConfigUpdateableField,
        value: string | number
    ) => {
        setConfigs((prev) => prev.map((c) => (c.id === id ? { ...c, [field]: value } : c)));
    };

    const updateConfigShipSkills = (id: string, shipSkills: ShipSkills) => {
        setConfigs((prev) => prev.map((c) => (c.id === id ? { ...c, shipSkills } : c)));
    };

    const selectShipForConfig = (configId: string, ship: Ship) => {
        const stats = healerStatsFromShip(shipFinalStats(ship));
        setConfigs((prev) =>
            prev.map((c) => {
                if (c.id !== configId) return c;
                return {
                    ...c,
                    shipId: ship.id,
                    name: ship.name,
                    ...stats,
                    chargeCount: ship.chargeSkillCharge ?? 0,
                    startCharged: detectShipCharged(ship),
                    shipSkills: buildShipAbilities(ship),
                };
            })
        );
    };

    // ---- Heal target handlers ----
    const selectTargetShip = (ship: Ship) => {
        const final = shipFinalStats(ship);
        setTarget((prev) => ({
            ...prev,
            shipId: ship.id,
            hp: Math.round(final.hp ?? 0),
            defence: Math.round(final.defence ?? 0),
            speed: Math.round(final.speed ?? 100),
        }));
        setTargetShipSkills(buildShipAbilities(ship));
        setTargetChargeCount(ship.chargeSkillCharge ?? 0);
        setTargetStartCharged(detectShipCharged(ship));
        setTargetAffinity(ship.affinity);
        setTargetRole(ship.type);
        setTargetCombatStats({
            attack: Math.round(final.attack ?? 0),
            crit: Math.round(final.crit ?? 0),
            critDamage: Math.round(final.critDamage ?? 0),
            defensePenetration: Math.round(final.defensePenetration ?? 0),
            hacking: Math.round(final.hacking ?? 200),
            defence: Math.round(final.defence ?? 0),
            hp: Math.round(final.hp ?? 0),
        });
    };

    // ---- Enemy attacker handlers ----
    const addEnemy = () => {
        if (enemies.length >= MAX_ENEMY_ATTACKERS) return;
        const n = nextEnemyIdRef.current++;
        setEnemies((prev) => [
            ...prev,
            {
                id: n.toString(),
                name: `Enemy ${n}`,
                attack: 4000,
                crit: 0,
                critDamage: 0,
                speed: 50,
                chargeCount: 0,
                startCharged: false,
            },
        ]);
    };

    const removeEnemy = (id: string) => {
        setEnemies((prev) => prev.filter((e) => e.id !== id));
    };

    const selectEnemyShip = (id: string, ship: Ship) => {
        const final = shipFinalStats(ship);
        setEnemies((prev) =>
            prev.map((e) => {
                if (e.id !== id) return e;
                return {
                    ...e,
                    shipId: ship.id,
                    name: ship.name,
                    attack: Math.round(final.attack ?? 0),
                    crit: Math.round(final.crit ?? 0),
                    critDamage: Math.round(final.critDamage ?? 0),
                    speed: Math.round(final.speed ?? 50),
                    chargeCount: ship.chargeSkillCharge ?? 0,
                    startCharged: detectShipCharged(ship),
                    shipSkills: buildShipAbilities(ship),
                    affinity: ship.affinity,
                };
            })
        );
    };

    const updateEnemy = (id: string, updates: Partial<EnemyAttackerConfig>) => {
        setEnemies((prev) => prev.map((e) => (e.id === id ? { ...e, ...updates } : e)));
    };

    // ---- Team handlers ----
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
        const final = shipFinalStats(ship);
        setTeamShips((prev) =>
            prev.map((t) => {
                if (t.id !== id) return t;
                return {
                    ...t,
                    shipId: ship.id,
                    startCharged: detectShipCharged(ship),
                    speed: Math.round(final.speed ?? 100),
                    chargeCount: ship.chargeSkillCharge ?? 0,
                    shipSkills: buildShipAbilities(ship),
                    stats: {
                        attack: Math.round(final.attack ?? 0),
                        crit: Math.round(final.crit ?? 0),
                        critDamage: Math.round(final.critDamage ?? 0),
                        defensePenetration: Math.round(final.defensePenetration ?? 0),
                        hacking: Math.round(final.hacking ?? 200),
                        defence: Math.round(final.defence ?? 0),
                        hp: Math.round(final.hp ?? 0),
                        healModifier: Math.round(final.healModifier ?? 0),
                    },
                    affinity: ship.affinity,
                    role: ship.type,
                    buffs: t.buffs.filter((b) => !b.autoFilled),
                    enemyDebuffs: t.enemyDebuffs.filter((b) => !b.autoFilled),
                };
            })
        );
    };

    const updateTeamShip = (id: string, updates: Partial<TeamShipConfig>) => {
        setTeamShips((prev) => prev.map((t) => (t.id === id ? { ...t, ...updates } : t)));
    };

    // ---- Derived sim inputs ----
    const teamActors = useMemo<TeamActorInput[]>(
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
                role: t.role,
            })),
        [teamShips]
    );

    // The heal target as its own team actor (only when NOT healing the healer itself).
    // The actor ALWAYS carries shipSkills + stats so the engine honours its editable HP and
    // defence (a team actor without `walk` defaults to HP 1 / defence 0 in the engine). When no
    // ship is picked it walks an empty kit — it just absorbs damage with the manual HP/defence.
    const targetActor = useMemo<TeamActorInput | null>(() => {
        if (target.useHealerAsTarget) return null;
        const baseStats: CombatStatBlock = targetCombatStats ?? {
            attack: 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            hacking: 200,
            defence: 0,
            hp: 0,
        };
        return {
            id: HEAL_TARGET_ID,
            speed: target.speed,
            chargeCount: targetChargeCount,
            startCharged: targetStartCharged,
            selfBuffs: [],
            enemyDebuffs: [],
            shipSkills: targetShipSkills ?? buildDefaultShipSkills(),
            // Editable HP/defence are authoritative over the ship's stat snapshot.
            stats: { ...baseStats, defence: target.defence, hp: target.hp },
            // Role-filtered on-ally-attacked reactions resolve the damaged target's role here.
            role: targetRole,
        };
    }, [
        target.useHealerAsTarget,
        target.speed,
        target.defence,
        target.hp,
        targetChargeCount,
        targetStartCharged,
        targetShipSkills,
        targetCombatStats,
        targetRole,
    ]);

    const enemyInputs = useMemo<EnemyAttackerInput[]>(
        () =>
            enemies.map((e) => ({
                id: e.id,
                stats: {
                    attack: e.attack,
                    crit: e.crit,
                    critDamage: e.critDamage,
                    speed: e.speed,
                },
                chargeCount: e.chargeCount,
                startCharged: e.startCharged,
                shipSkills: e.shipSkills,
                affinity: e.affinity,
            })),
        [enemies]
    );

    const simResults = useMemo(() => {
        const map = new Map<string, HealingSimulationResult>();
        const allTeamActors = targetActor ? [...teamActors, targetActor] : teamActors;
        const healTargetId = target.useHealerAsTarget ? 'healer' : HEAL_TARGET_ID;
        configs.forEach((config) => {
            // Heal-target affinity drives each enemy attacker's matchup. When self-healing the
            // target IS this config's healer ship; otherwise it's the selected heal-target ship.
            const healTargetAffinity = target.useHealerAsTarget
                ? config.shipId
                    ? getShipById(config.shipId)?.affinity
                    : undefined
                : targetAffinity;
            // The healer's own role (Ship.type) — auto-filled from the picked ship; manual
            // configs have none. Drives role-filtered ally-damage reactions when the healer
            // is the heal target (engine focus-actor role).
            const healerRole = config.shipId ? getShipById(config.shipId)?.type : undefined;
            map.set(
                config.id,
                simulateHealing({
                    healer: {
                        hp: config.hp,
                        attack: config.attack,
                        defence: config.defence,
                        crit: config.crit,
                        critDamage: config.critDamage,
                        defensePenetration: 0,
                        healModifier: config.healModifier,
                        hacking: config.hacking,
                        speed: config.speed,
                    },
                    chargeCount: config.chargeCount,
                    startCharged: config.startCharged,
                    shipSkills: config.shipSkills,
                    selfBuffs: healerBuffs,
                    healTargetId,
                    healTargetAffinity,
                    healerRole,
                    teamActors: allTeamActors,
                    enemies: enemyInputs,
                    rounds,
                })
            );
        });
        return map;
    }, [
        configs,
        healerBuffs,
        teamActors,
        targetActor,
        target.useHealerAsTarget,
        targetAffinity,
        getShipById,
        enemyInputs,
        rounds,
    ]);

    const bestConfig = configs.reduce<HealerShipConfig | null>((best, current) => {
        if (!best) return current;
        const bestHeal = simResults.get(best.id)?.summary.totalEffectiveHealing ?? 0;
        const curHeal = simResults.get(current.id)?.summary.totalEffectiveHealing ?? 0;
        return curHeal > bestHeal ? current : best;
    }, null);

    const bestEffectiveHealing = simResults.get(bestConfig?.id ?? '')?.summary
        .totalEffectiveHealing;
    const bestResult = bestConfig ? simResults.get(bestConfig.id) : undefined;

    return (
        <>
            <Seo {...SEO_CONFIG.healing} />
            <PageLayout
                title="Healing Calculator"
                description="Simulate effective healing, overheal, and shield absorption round-by-round on the combat engine."
                action={{ label: 'Add Healer', onClick: addConfig, variant: 'primary' }}
            >
                <div className="space-y-6">
                    <HealTargetPanel
                        isOpen={targetOpen}
                        onToggle={() => setTargetOpen((v) => !v)}
                        target={target}
                        onUseHealerAsTargetChange={(checked) =>
                            setTarget((prev) => ({ ...prev, useHealerAsTarget: checked }))
                        }
                        onSelectShip={selectTargetShip}
                        onHpChange={(v) => setTarget((prev) => ({ ...prev, hp: v }))}
                        onDefenceChange={(v) => setTarget((prev) => ({ ...prev, defence: v }))}
                        onSpeedChange={(v) => setTarget((prev) => ({ ...prev, speed: v }))}
                    />

                    <EnemyAttackersPanel
                        isOpen={enemiesOpen}
                        onToggle={() => setEnemiesOpen((v) => !v)}
                        enemies={enemies}
                        onAdd={addEnemy}
                        onRemove={removeEnemy}
                        onSelectShip={selectEnemyShip}
                        onUpdate={updateEnemy}
                    />

                    <TeamPanel
                        isOpen={teamOpen}
                        onToggle={() => setTeamOpen((v) => !v)}
                        showSharedBuffs={false}
                        enemyAffinity="antimatter"
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

                    <div className="card space-y-2">
                        <Button
                            variant="link"
                            onClick={() => setSettingsOpen((v) => !v)}
                            className="w-[calc(100%+1.5rem)] flex justify-between items-center -m-3 !p-3"
                        >
                            <span className="flex items-center gap-2">
                                <ChevronDownIcon
                                    className={`h-4 w-4 transition-transform duration-300 ${settingsOpen ? 'rotate-180' : ''}`}
                                />
                                <span className="text-lg font-bold">Simulation Settings</span>
                            </span>
                        </Button>
                        <CollapsibleForm isVisible={settingsOpen}>
                            <div className="space-y-4 pt-2">
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                    <Input
                                        label="Rounds"
                                        type="number"
                                        min="1"
                                        max="50"
                                        value={rounds}
                                        onChange={(e) =>
                                            setRounds(
                                                Math.max(
                                                    1,
                                                    Math.min(50, parseInt(e.target.value) || 1)
                                                )
                                            )
                                        }
                                    />
                                </div>
                                <p className="text-sm text-theme-text-secondary">
                                    Shared healer buffs applied to all healer configurations
                                </p>
                                <GameBuffPicker
                                    label="Healer Buffs"
                                    relevantStats={[
                                        'crit',
                                        'critDamage',
                                        'outgoingHeal',
                                        'incomingHeal',
                                    ]}
                                    excludeTypes={['effect']}
                                    value={healerBuffs}
                                    onChange={setHealerBuffs}
                                    noEffectLabel="No healing effect"
                                />
                            </div>
                        </CollapsibleForm>
                    </div>

                    <div
                        className={`grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 ${configs.length >= 4 ? '2xl:w-[calc(100vw-256px-2rem)] 2xl:ml-[calc((-100vw/2)+768px+1rem)] 2xl:[grid-template-columns:repeat(auto-fit,minmax(370px,500px))] 2xl:justify-center' : ''}`}
                    >
                        {configs.map((config) => (
                            <HealerConfigCard
                                key={config.id}
                                config={config}
                                isBest={bestConfig?.id === config.id}
                                isComparing={configs.length > 1}
                                simResult={simResults.get(config.id)}
                                bestEffectiveHealing={bestEffectiveHealing}
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
                            />
                        ))}
                    </div>

                    <div className="card">
                        <h3 className="text-lg font-bold mb-2">Healing Over Time</h3>
                        <p className="text-sm text-theme-text-secondary mb-4">
                            Cumulative effective healing across rounds. Effective healing excludes
                            overheal, so a config that out-heals incoming damage plateaus once the
                            target is topped up. Hover a round to see every config&apos;s output for
                            that round (direct heal, HoT, shield, effective vs overheal, cleanses,
                            incoming damage) in the chart card, and the enemy effects active that
                            round in the panel beside it.
                        </p>
                        <HealingCumulativeChart
                            healers={configs
                                .map((config) => ({
                                    id: config.id,
                                    name: config.name,
                                    result: simResults.get(config.id)!,
                                }))
                                .filter((h) => h.result)}
                            rounds={rounds}
                            enemyName={(id) => enemies.find((e) => e.id === id)?.name ?? id}
                            healTargetName={
                                target.useHealerAsTarget
                                    ? 'Heal Target (self)'
                                    : (target.shipId && getShipById(target.shipId)?.name) ||
                                      'Heal Target'
                            }
                        />
                        {bestResult && bestConfig && (
                            <div className="mt-6 pt-6 border-t border-dark-border">
                                <h4 className="text-md font-bold mb-2">Best Config Timeline</h4>
                                <HealingTimelineChart
                                    result={bestResult}
                                    name={bestConfig.name}
                                    rounds={rounds}
                                />
                            </div>
                        )}
                    </div>

                    <div className="card">
                        <h2 className="text-xl font-bold mb-4">About the Simulation</h2>
                        <p className="mb-2">
                            The Healing Calculator runs the same round-by-round combat engine as the
                            DPS Calculator, in healing mode. Each round, the healer fires its active
                            or charged skill and its heal, shield, and cleanse abilities are read
                            directly from the skill kit (editable per skill).
                        </p>
                        <p className="mb-2 font-mono bg-dark-lighter p-2 text-sm">
                            Raw Heal = SourceStat × HealMultiplier% × CritMultiplier × (1 +
                            HealMod%) × (1 + OutgoingRepair%) × (1 + IncomingRepair%)
                        </p>
                        <p className="mb-2">
                            <strong>Raw vs effective.</strong> Raw healing is the full amount a heal
                            would restore. Effective healing is what the target actually absorbs —
                            healing past the target&apos;s max HP is counted as overheal and does
                            not help survival. The per-config summary reports both.
                        </p>
                        <p className="mb-2">
                            <strong>Shields.</strong> Shield abilities add a separate absorption
                            pool on top of HP. Incoming damage is soaked by the shield pool first;
                            the amount it absorbs is reported as Shield Absorbed.
                        </p>
                        <p className="mb-2">
                            <strong>Dead is dead.</strong> If incoming damage empties the
                            target&apos;s HP, the target is destroyed and the simulation reports the
                            round it fell. Healing applied after that round contributes nothing.
                        </p>
                        <p className="mb-2">
                            <strong>Heal target.</strong> By default the healer heals itself. Pick a
                            separate target to model healing an ally — the target enters the
                            simulation as a real actor and walks its own kit (its self-heals and
                            buffs apply), while the enemy attackers bombard it.
                        </p>
                        <p>
                            <strong>Fully deterministic.</strong> The simulation contains no
                            randomness — identical inputs always produce identical results. Crits
                            use a fractional-accumulator schedule at the healer&apos;s effective
                            crit rate. Each enemy attacker&apos;s affinity is matched against the
                            heal target&apos;s affinity to scale its incoming damage.
                        </p>
                    </div>
                </div>
            </PageLayout>
        </>
    );
};

export default HealingCalculatorPage;
