import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageLayout } from '../../components/ui';
import { calculateDamageReduction, calculateEffectiveHP } from '../../utils/autogear/scoring';
import { Button } from '../../components/ui/Button';
import { DamageReductionChart } from '../../components/calculator/DamageReductionChart';
import { DamageReductionTable } from '../../components/calculator/DamageReductionTable';
import { DefenseSettingsPanel } from '../../components/calculator/DefenseSettingsPanel';
import { DefenseShipCard } from '../../components/calculator/DefenseShipCard';
import { SecurityEHPChart } from '../../components/calculator/SecurityEHPChart';
import { computeBuffedStats } from '../../utils/calculators/defenseCalculator';
import {
    simulateDefenseSurvivability,
    DefenseSurvivabilityResult,
} from '../../utils/calculators/defenseSurvivabilitySim';
import { EnemyAttackerInput } from '../../utils/calculators/healingEngineAdapter';
import {
    EnemyAttackersPanel,
    EnemyAttackerConfig,
} from '../../components/calculator/EnemyAttackersPanel';
import { TeamPanel } from '../../components/calculator/TeamPanel';
import Seo from '../../components/seo/Seo';
import { SEO_CONFIG } from '../../constants/seo';
import { useShips } from '../../contexts/ShipsContext';
import { useInventory } from '../../contexts/InventoryProvider';
import { useEngineeringStats } from '../../hooks/useEngineeringStats';
import { calculateTotalStats } from '../../utils/ship/statsCalculator';
import { Ship } from '../../types/ship';
import { ShipSkills } from '../../types/abilities';
import {
    DefenseShipConfig,
    DefenseBuffTotals,
    SelectedGameBuff,
    TeamShipConfig,
    TeamActorInput,
} from '../../types/calculator';
import { buildSkillBuffAutoFill, mergeAutoFill } from '../../utils/calculators/skillBuffAutoFill';
import { buildShipAbilitiesWithEquipment } from '../../utils/abilities/buildShipAbilitiesWithEquipment';
import { buildDefaultShipSkills } from '../../utils/abilities/configToSimInputs';
import { asFactionKey } from '../../constants/factions';
import {
    defaultEnemySlot,
    HEALING_SLOT_OPTIONS as ENEMY_SLOT_OPTIONS,
} from '../../utils/calculators/healingPlacement';
import {
    DEFAULT_ENEMY_DEFENCE,
    DEFAULT_ENEMY_HP,
    DEFAULT_ENEMY_SECURITY,
    DEFAULT_ENEMY_SPEED,
} from '../../utils/calculators/healingDefaultEnemy';
import type { Position } from '../../types/encounters';
import { detectFullyCharged } from '../../utils/skillTextParser';
import { targetingOf } from '../../utils/calculators/shipTargeting';

/** The stat block a manually-added enemy starts from, placed at the Nth default enemy cell.
 *  Copied verbatim from `HealingCalculatorPage.tsx` — see that module for why none of these may be
 *  0 (`healingDefaultEnemy.ts` holds the shared reasoning). */
const defaultEnemyStats = (index: number) => ({
    attack: 4000,
    crit: 0,
    critDamage: 0,
    speed: DEFAULT_ENEMY_SPEED,
    hacking: 200,
    chargeCount: 0,
    startCharged: false,
    position: defaultEnemySlot(index),
    hp: DEFAULT_ENEMY_HP,
    defence: DEFAULT_ENEMY_DEFENCE,
    security: DEFAULT_ENEMY_SECURITY,
});

/** `wanted` if free, else the first unoccupied cell — copied verbatim from
 *  `HealingCalculatorPage.tsx`. */
const firstFreeSlot = (wanted: Position, taken: ReadonlyArray<Position | undefined>): Position => {
    const used = new Set(taken.filter((p): p is Position => !!p));
    if (!used.has(wanted)) return wanted;
    return ENEMY_SLOT_OPTIONS.find((p) => !used.has(p)) ?? wanted;
};

const detectShipCharged = (ship: Ship): boolean =>
    detectFullyCharged([
        ship.activeSkillText,
        ship.chargeSkillText,
        ship.firstPassiveSkillText,
        ship.secondPassiveSkillText,
        ship.thirdPassiveSkillText,
    ]);

/** Engine stats + kit for a defender built from a real ship. Shared by the URL-param initial
 *  config and the ship-picker, which previously duplicated the stat mapping. */
const defenderFieldsFromShip = (
    ship: Ship,
    final: ReturnType<typeof calculateTotalStats>['final'],
    getGearPiece: Parameters<typeof buildShipAbilitiesWithEquipment>[1]
) => ({
    shipId: ship.id,
    name: ship.name,
    hp: Math.round(final.hp),
    defense: Math.round(final.defence),
    security: Math.round(final.security ?? 0),
    attack: Math.round(final.attack ?? 0),
    crit: Math.round(final.crit ?? 0),
    critDamage: Math.round(final.critDamage ?? 0),
    // NOT `?? 0` for these two. A speed-0 defender never takes a turn, so its self-shields and
    // self-buffs never fire and its damage absorbed is silently understated; hacking 0 would also
    // misreport its own outbound landing. These fallbacks match `healerStatsFromShip` in
    // HealingCalculatorPage.tsx:173-174, which is the reference implementation.
    speed: Math.round(final.speed ?? 100),
    hacking: Math.round(final.hacking ?? 200),
    healModifier: Math.round(final.healModifier ?? 0),
    chargeCount: ship.chargeSkillCharge ?? 0,
    startCharged: false,
    shipSkills: buildShipAbilitiesWithEquipment(ship, getGearPiece),
    affinity: ship.affinity,
    role: ship.type,
    faction: asFactionKey(ship.faction),
});

const DefenseCalculatorPage: React.FC = () => {
    const [searchParams, setSearchParams] = useSearchParams();
    const { getShipById } = useShips();
    const { getGearPiece } = useInventory();
    const { getEngineeringStatsForShipType } = useEngineeringStats();
    const shipInitialized = useRef(false);
    // Both start at 1 (not the healing page's 2): this page's initial enemy/team rosters are
    // empty, unlike the healing page's pre-seeded first slot, so the FIRST added enemy/team ship
    // should be numbered 1.
    const nextEnemyIdRef = useRef(1);
    const nextTeamIdRef = useRef(1);

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
                const fields = defenderFieldsFromShip(ship, final, getGearPiece);
                return [
                    {
                        id: '1',
                        ...fields,
                        damageReduction: calculateDamageReduction(fields.defense),
                        effectiveHP: calculateEffectiveHP(fields.hp, fields.defense),
                        buffs: [],
                    },
                ];
            }
        }
        return [
            {
                id: '1',
                name: 'Ship 1',
                hp: 10000,
                defense: 5000,
                security: 70,
                buffs: [],
                shipSkills: buildDefaultShipSkills(),
                attack: 0,
                crit: 0,
                critDamage: 0,
                speed: 100,
                hacking: 200,
                healModifier: 0,
                chargeCount: 0,
                startCharged: false,
            },
        ];
    };

    const [configs, setConfigs] = useState<DefenseShipConfig[]>(getInitialConfig);
    const [nextId, setNextId] = useState(2);
    const initialRender = useRef(true);
    const [showTable, setShowTable] = useState(false);
    const [globalBuffs, setGlobalBuffs] = useState<SelectedGameBuff[]>([]);
    const [settingsPanelOpen, setSettingsPanelOpen] = useState(false);
    const [rounds, setRounds] = useState(20);
    const [enemies, setEnemies] = useState<EnemyAttackerConfig[]>([]);
    const [teamShips, setTeamShips] = useState<TeamShipConfig[]>([]);
    const [enemyPanelOpen, setEnemyPanelOpen] = useState(false);
    const [teamPanelOpen, setTeamPanelOpen] = useState(false);

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
            security: 70,
            damageReduction: calculateDamageReduction(5000),
            effectiveHP: calculateEffectiveHP(10000, 5000),
            buffs: [],
            shipSkills: buildDefaultShipSkills(),
            attack: 0,
            crit: 0,
            critDamage: 0,
            speed: 100,
            hacking: 200,
            healModifier: 0,
            chargeCount: 0,
            startCharged: false,
        };
        setConfigs((prev) => [...prev, newConfig]);
        setNextId((n) => n + 1);
    };

    const removeConfig = (id: string) => {
        setConfigs((prev) => prev.filter((c) => c.id !== id));
    };

    const updateConfig = (
        id: string,
        field: 'name' | 'hp' | 'defense' | 'security',
        value: string | number
    ) => {
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
        const fields = defenderFieldsFromShip(ship, final, getGearPiece);
        const { selfBuffs } = buildSkillBuffAutoFill(ship);
        setConfigs((prev) =>
            prev.map((c) =>
                c.id === configId
                    ? {
                          ...c,
                          ...fields,
                          damageReduction: calculateDamageReduction(fields.defense),
                          effectiveHP: calculateEffectiveHP(fields.hp, fields.defense),
                          buffs: mergeAutoFill(c.buffs, selfBuffs),
                      }
                    : c
            )
        );
    };

    const updateConfigBuffs = (id: string, buffs: SelectedGameBuff[]) => {
        setConfigs((prev) => prev.map((c) => (c.id === id ? { ...c, buffs } : c)));
    };

    const updateConfigShipSkills = (id: string, shipSkills: ShipSkills) => {
        setConfigs((prev) => prev.map((c) => (c.id === id ? { ...c, shipSkills } : c)));
    };

    // ---- Enemy attacker handlers ----
    // Copied verbatim from `HealingCalculatorPage.tsx` (shared shape) — an empty roster is allowed;
    // the adapter synthesizes an inert practice target for it.
    const addEnemy = () => {
        const n = nextEnemyIdRef.current++;
        setEnemies((prev) => [
            ...prev,
            {
                id: n.toString(),
                name: `Enemy ${n}`,
                ...defaultEnemyStats(prev.length),
                position: firstFreeSlot(
                    defaultEnemySlot(prev.length),
                    prev.map((e) => e.position)
                ),
            },
        ]);
    };

    const removeEnemy = (id: string) => {
        setEnemies((prev) => prev.filter((e) => e.id !== id));
    };

    const selectEnemyShip = (id: string, ship: Ship) => {
        const engineeringStats = ship.type ? getEngineeringStatsForShipType(ship.type) : undefined;
        const final = calculateTotalStats(
            ship.baseStats,
            ship.equipment || {},
            getGearPiece,
            ship.refits,
            ship.implants,
            engineeringStats,
            ship.id
        ).final;
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
                    hacking: Math.round(final.hacking ?? 200),
                    hp: Math.max(1, Math.round(final.hp ?? DEFAULT_ENEMY_HP)),
                    defence: Math.round(final.defence ?? DEFAULT_ENEMY_DEFENCE),
                    security: Math.round(final.security ?? DEFAULT_ENEMY_SECURITY),
                    chargeCount: ship.chargeSkillCharge ?? 0,
                    startCharged: detectShipCharged(ship),
                    shipSkills: buildShipAbilitiesWithEquipment(ship, getGearPiece),
                    affinity: ship.affinity,
                };
            })
        );
    };

    const updateEnemy = (id: string, updates: Partial<EnemyAttackerConfig>) => {
        setEnemies((prev) => prev.map((e) => (e.id === id ? { ...e, ...updates } : e)));
    };

    // ---- Team handlers ----
    // Copied verbatim from `HealingCalculatorPage.tsx` (shared shape).
    const addTeamShip = () => {
        if (teamShips.length >= 4) return;
        const id = `team-${nextTeamIdRef.current++}`;
        setTeamShips((prev) => [
            ...prev,
            {
                id,
                buffs: [],
                enemyDebuffs: [],
                startCharged: false,
                speed: 100,
                chargeCount: 0,
            },
        ]);
    };

    const removeTeamShip = (id: string) => {
        setTeamShips((prev) => prev.filter((t) => t.id !== id));
    };

    const selectShipForTeamSlot = (id: string, ship: Ship) => {
        const engineeringStats = ship.type ? getEngineeringStatsForShipType(ship.type) : undefined;
        const final = calculateTotalStats(
            ship.baseStats,
            ship.equipment || {},
            getGearPiece,
            ship.refits,
            ship.implants,
            engineeringStats,
            ship.id
        ).final;
        setTeamShips((prev) =>
            prev.map((t) => {
                if (t.id !== id) return t;
                return {
                    ...t,
                    shipId: ship.id,
                    startCharged: detectShipCharged(ship),
                    speed: Math.round(final.speed ?? 100),
                    chargeCount: ship.chargeSkillCharge ?? 0,
                    shipSkills: buildShipAbilitiesWithEquipment(ship, getGearPiece),
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
                    faction: asFactionKey(ship.faction),
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
    // Copied verbatim from `HealingCalculatorPage.tsx:543` — maps TeamShipConfig -> TeamActorInput.
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
                faction: t.faction,
                ...(t.position ? { position: t.position } : {}),
            })),
        [teamShips]
    );

    // Copied verbatim from `HealingCalculatorPage.tsx:616` — maps EnemyAttackerConfig ->
    // EnemyAttackerInput, including each enemy's OWN parsed targeting (decision 4: targeting comes
    // from every actor's parsed skill targeting, not just the defender's).
    const enemyInputs = useMemo<EnemyAttackerInput[]>(
        () =>
            enemies.map((e) => {
                const enemyShip = e.shipId ? getShipById(e.shipId) : undefined;
                const targeting = targetingOf(enemyShip);
                return {
                    id: e.id,
                    faction: asFactionKey(enemyShip?.faction),
                    stats: {
                        attack: e.attack,
                        crit: e.crit,
                        critDamage: e.critDamage,
                        speed: e.speed,
                        hp: e.hp,
                        defence: e.defence,
                        security: e.security,
                    },
                    hacking: e.hacking,
                    chargeCount: e.chargeCount,
                    startCharged: e.startCharged,
                    shipSkills: e.shipSkills,
                    affinity: e.affinity,
                    position: e.position,
                    target: targeting?.active?.target,
                    pattern: targeting?.active?.pattern,
                    chargedTarget: targeting?.charged?.target,
                    chargedPattern: targeting?.charged?.pattern,
                };
            }),
        [enemies, getShipById]
    );

    // ---- Survivability sim, memoized ----
    const simResults = useMemo(() => {
        const map = new Map<string, DefenseSurvivabilityResult>();
        configs.forEach((config) => {
            map.set(
                config.id,
                simulateDefenseSurvivability({
                    defender: {
                        hp: config.hp,
                        defence: config.defense,
                        security: config.security,
                        attack: config.attack,
                        crit: config.crit,
                        critDamage: config.critDamage,
                        speed: config.speed,
                        hacking: config.hacking,
                        // The defender's REAL heal modifier — a self-repairing tank must repair.
                        healModifier: config.healModifier,
                    },
                    shipSkills: config.shipSkills,
                    selfBuffs: [...globalBuffs, ...config.buffs],
                    chargeCount: config.chargeCount,
                    startCharged: config.startCharged,
                    affinity: config.affinity,
                    role: config.role,
                    faction: config.faction,
                    position: config.position,
                    // The defender's REAL parsed targeting — without this the cast falls back to
                    // the adapter's synthetic single-target-front pattern, understating an AoE
                    // defender's own offence and (since it takes its own turns) overstating how
                    // long incoming pressure stays high.
                    targeting: targetingOf(config.shipId ? getShipById(config.shipId) : undefined),
                    teamActors,
                    enemies: enemyInputs,
                    rounds,
                })
            );
        });
        return map;
    }, [configs, globalBuffs, teamActors, enemyInputs, rounds, getShipById]);

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
            securityBuff: globalBuffs.reduce(
                (sum, b) => sum + (b.parsedEffects.security ?? 0) * b.stacks,
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
                        securityBuff:
                            globalBuffTotals.securityBuff +
                            c.buffs.reduce(
                                (sum, b) => sum + (b.parsedEffects.security ?? 0) * b.stacks,
                                0
                            ),
                    },
                ])
            ),
        [configs, globalBuffTotals]
    );

    // Ranking now reads the MEASURED figure from the survivability sim, not the static formula —
    // the whole point of this epic is that the measured number is the one that should decide
    // "best", since it reflects real shields/self-buffs/enemy pressure the static formula ignores.
    const bestShip = configs.reduce<DefenseShipConfig | null>((best, current) => {
        const currentEHP = simResults.get(current.id)?.damageAbsorbed ?? 0;
        const bestEHP = best ? (simResults.get(best.id)?.damageAbsorbed ?? 0) : 0;
        return currentEHP > bestEHP ? current : best;
    }, null);

    const bestEffectiveHP = bestShip
        ? computeBuffedStats(
              bestShip.hp,
              bestShip.defense,
              bestShip.security,
              mergedBuffTotals.get(bestShip.id)
          ).effectiveHP
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
                    <EnemyAttackersPanel
                        isOpen={enemyPanelOpen}
                        onToggle={() => setEnemyPanelOpen((v) => !v)}
                        enemies={enemies}
                        onAdd={addEnemy}
                        onRemove={removeEnemy}
                        onSelectShip={selectEnemyShip}
                        onUpdate={updateEnemy}
                    />

                    <TeamPanel
                        isOpen={teamPanelOpen}
                        onToggle={() => setTeamPanelOpen((v) => !v)}
                        showSharedBuffs={false}
                        enemyAffinity={enemies[0]?.affinity ?? 'antimatter'}
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

                    <DefenseSettingsPanel
                        isOpen={settingsPanelOpen}
                        onToggle={() => setSettingsPanelOpen((v) => !v)}
                        defenseBuffs={globalBuffs}
                        onDefenseBuffsChange={setGlobalBuffs}
                        rounds={rounds}
                        onRoundsChange={setRounds}
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
                                result={simResults.get(config.id)}
                                onRemove={() => removeConfig(config.id)}
                                onUpdate={(field, value) => updateConfig(config.id, field, value)}
                                onSelectShip={(ship) => selectShipForConfig(config.id, ship)}
                                onBuffsChange={(buffs) => updateConfigBuffs(config.id, buffs)}
                                onShipSkillsChange={(shipSkills) =>
                                    updateConfigShipSkills(config.id, shipSkills)
                                }
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
                            Security does not affect Effective HP directly — it determines how well
                            your ship resists debuffs from hackers. Higher security reduces the
                            chance that hacking attempts succeed.
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
                                    config.security,
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

                    <SecurityEHPChart configs={configs} buffTotals={mergedBuffTotals} />
                </div>
            </PageLayout>
        </>
    );
};

export default DefenseCalculatorPage;
