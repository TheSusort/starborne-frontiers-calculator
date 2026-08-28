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
import { EnemyAttackersPanel } from '../../components/calculator/EnemyAttackersPanel';
import { TeamPanel } from '../../components/calculator/TeamPanel';
import Seo from '../../components/seo/Seo';
import { SEO_CONFIG } from '../../constants/seo';
import { useShips } from '../../contexts/ShipsContext';
import { useInventory } from '../../contexts/InventoryProvider';
import { useEngineeringStats } from '../../hooks/useEngineeringStats';
import { useEnemyTeamRoster } from '../../hooks/useEnemyTeamRoster';
import { shipFinalStats } from '../../utils/calculators/rosterHelpers';
import { Ship } from '../../types/ship';
import { ShipSkills } from '../../types/abilities';
import { DefenseShipConfig, DefenseBuffTotals, SelectedGameBuff } from '../../types/calculator';
import { buildSkillBuffAutoFill, mergeAutoFill } from '../../utils/calculators/skillBuffAutoFill';
import { gatedAutoFilledBuffs } from '../../utils/calculators/gatedBuffs';
import { buildShipAbilitiesWithEquipment } from '../../utils/abilities/buildShipAbilitiesWithEquipment';
import { buildDefaultShipSkills } from '../../utils/abilities/configToSimInputs';
import { asFactionKey } from '../../constants/factions';
import { targetingOf } from '../../utils/calculators/shipTargeting';

/** Engine stats + kit for a defender built from a real ship. Shared by the URL-param initial
 *  config and the ship-picker, which previously duplicated the stat mapping. */
const defenderFieldsFromShip = (
    ship: Ship,
    final: ReturnType<typeof shipFinalStats>,
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

    const getInitialConfig = (): DefenseShipConfig[] => {
        const shipId = searchParams.get('shipId');
        if (shipId) {
            const ship = getShipById(shipId);
            if (ship) {
                const final = shipFinalStats(ship, getGearPiece, getEngineeringStatsForShipType);
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
    const [enemyPanelOpen, setEnemyPanelOpen] = useState(false);
    const [teamPanelOpen, setTeamPanelOpen] = useState(false);

    const {
        enemies,
        teamShips,
        enemyInputs,
        teamActors,
        addEnemy,
        removeEnemy,
        selectEnemyShip,
        updateEnemy,
        addTeamShip,
        removeTeamShip,
        selectShipForTeamSlot,
        updateTeamShip,
    } = useEnemyTeamRoster({
        // This page's rosters start EMPTY, so the first added enemy is "Enemy 1", not "Enemy 2",
        // and removing the last team ship deletes it rather than resetting it.
        minTeamShips: 0,
        enemyIdSeed: 1,
        teamIdSeed: 1,
    });

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
        const final = shipFinalStats(ship, getGearPiece, getEngineeringStatsForShipType);
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

    // The sim reads every config field EXCEPT `name`, so keying the memo on `configs` re-ran a
    // full engine simulation per config on every keystroke in the name box. The field list below
    // is derived from the `simulateDefenseSurvivability({...})` call directly below — NOT from
    // `DefenseShipConfig` — so a field added to the type but never passed to the sim cannot
    // silently rejoin the key. `shipId` is included because it drives `targeting` via
    // `getShipById`, and `id` because it is the sim-results map key.
    //
    // ⚠️ `configs.map(pick)` returns NEW objects every render, so the projection must be compared
    // BY VALUE, not by identity, or this fixes nothing. The serialization IS the dependency.
    const simInputKey = useMemo(
        () =>
            JSON.stringify(
                configs.map((c) => [
                    c.id,
                    c.hp,
                    c.defense,
                    c.security,
                    c.attack,
                    c.crit,
                    c.critDamage,
                    c.speed,
                    c.hacking,
                    c.healModifier,
                    c.chargeCount,
                    c.startCharged,
                    c.affinity,
                    c.role,
                    c.faction,
                    c.position,
                    c.shipId,
                    c.buffs,
                    c.shipSkills,
                ])
            ),
        [configs]
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
        // `configs` is read through `simInputKey` (by-value) deliberately — see the comment above.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [simInputKey, globalBuffs, teamActors, enemyInputs, rounds, getShipById]);

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

    // Theoretical EHP is a hangar-stats figure with no enemy firing, so it has no way to know a
    // gate is unmet — it counted Redeemer's below-60%-HP Defense Up II as standing from turn one and
    // read 18% high against the engine-measured figure beside it. Gated AUTO-FILLED buffs are dropped
    // here, which moves all three consumers at once: the card figure, SecurityEHPChart's tank score,
    // and the badge tie-break's effectiveHP (via `mergedBuffTotals` below). A buff the user picked by
    // hand (or a global buff) is deliberate and stays counted regardless of any gate.
    const gatedBuffsByConfig = useMemo(
        () =>
            new Map(
                configs.map((c) => [c.id, gatedAutoFilledBuffs(c.buffs, c.shipSkills)] as const)
            ),
        [configs]
    );

    const mergedBuffTotals = useMemo(
        () =>
            new Map<string, DefenseBuffTotals>(
                configs.map((c) => {
                    const gatedIds = new Set(
                        (gatedBuffsByConfig.get(c.id) ?? []).map((g) => g.buffId)
                    );
                    const countedBuffs = c.buffs.filter((b) => !gatedIds.has(b.id));
                    return [
                        c.id,
                        {
                            defenseBuff:
                                globalBuffTotals.defenseBuff +
                                countedBuffs.reduce(
                                    (sum, b) => sum + (b.parsedEffects.defense ?? 0) * b.stacks,
                                    0
                                ),
                            incomingDamageBuff:
                                globalBuffTotals.incomingDamageBuff +
                                countedBuffs.reduce(
                                    (sum, b) =>
                                        sum + (b.parsedEffects.incomingDamage ?? 0) * b.stacks,
                                    0
                                ),
                            securityBuff:
                                globalBuffTotals.securityBuff +
                                countedBuffs.reduce(
                                    (sum, b) => sum + (b.parsedEffects.security ?? 0) * b.stacks,
                                    0
                                ),
                        },
                    ];
                })
            ),
        [configs, globalBuffTotals, gatedBuffsByConfig]
    );

    // Ranking now reads the MEASURED figure from the survivability sim, not the static formula —
    // the whole point of this epic is that the measured number is the one that should decide
    // "best", since it reflects real shields/self-buffs/enemy pressure the static formula ignores.
    //
    // ⚠️ TIES ON THE PRIMARY AXIS ARE NORMAL, NOT AN EDGE CASE — a plain `>` reduce seeded with
    // `null` therefore FAILS TO ANSWER, and did:
    //   • the page's DEFAULT state seeds `enemies: []`, which becomes the `attack: 0` practice
    //     target, so every config reports `damageAbsorbed === 0`. `0 > 0` is false forever, the
    //     seed stayed `null`, and the first page a user ever sees had no `border-primary`, no
    //     "Best ship configuration" badge, no "Compared to best" row and no highlighted chart
    //     series. On main the static ranking always produced a best; this was a REGRESSION.
    //   • when every config SURVIVES the window the figure is flat by construction (it is a
    //     property of the attackers — see the axis note in `defenseSurvivabilitySim.ts`), so the
    //     badge landed on whichever card happened to be added first, unranked.
    // The reduce below always answers (it is seeded with the first config, so a non-empty roster
    // of configs always has a best) and breaks ties EXPLICITLY, on a documented ladder:
    //   1. `damageAbsorbed` — the headline, and the axis "Compared to best" is measured on.
    //   2. Theoretical EHP  — the static estimate. Continuous, so it discriminates exactly the two
    //      flat cases above, and it makes the zero-pressure default rank on the static estimate,
    //      which is what the docs and changelog say this page does when the measured figures tie.
    //   3. `elapsedRounds`  — last, deliberately. See below.
    //
    // ⚠️ KEYS 2 AND 3 WERE THE OTHER WAY ROUND AND THAT WAS INVERTED. `damageAbsorbed` ALREADY
    // CONTAINS ROUNDS (more rounds thrown = more absorbed), so `elapsedRounds` only ever speaks
    // when `damageAbsorbed` ties — and in the case where it speaks loudest it says the wrong thing.
    // MEASURED, zero-pressure default at `rounds: 20`: the empty enemy roster becomes a KILLABLE
    // practice target (40,000 HP / 5,000 defence, `healingEngineAdapter.ts`), the defender takes
    // its own turns with its real `attack` from the ship sheet, and a wiped roster ends the run —
    // defender attack 0 → 20 rounds, 4,000 → 13, 40,000 → 2, 400,000 → 1, with `damageAbsorbed` 0
    // throughout. With `elapsedRounds` at key 2 the badge therefore went to the WEAKEST-ATTACKING
    // ship on the very first page a user sees. Ranked last it is only a final nudge between configs
    // that already tie on both the headline and the static estimate.
    // Total ties (identical stats) fall through to FIRST-WINS, which is stable across renders.
    const rankKeyOf = (config: DefenseShipConfig): readonly number[] => {
        const result = simResults.get(config.id);
        return [
            result?.damageAbsorbed ?? 0,
            computeBuffedStats(
                config.hp,
                config.defense,
                config.security,
                mergedBuffTotals.get(config.id)
            ).effectiveHP,
            result?.elapsedRounds ?? 0,
        ];
    };

    const bestShip = configs.reduce<DefenseShipConfig | null>((best, current) => {
        if (!best) return current;
        const a = rankKeyOf(current);
        const b = rankKeyOf(best);
        for (let i = 0; i < a.length; i++) {
            if (a[i] !== b[i]) return a[i] > b[i] ? current : best;
        }
        return best;
    }, null);

    // The "Compared to best" delta is measured on the RANKING axis (finding I3): it used to read
    // Theoretical EHP while `isBest` was decided on `damageAbsorbed`, so a not-best card could
    // print a POSITIVE delta — "worse than best" in the same red as a negative one.
    const bestDamageAbsorbed = bestShip ? simResults.get(bestShip.id)?.damageAbsorbed : undefined;

    return (
        <>
            <Seo {...SEO_CONFIG.defense} />
            <PageLayout
                title="Defense Calculator"
                description="Measure how long a ship lasts and how much damage is thrown at it, and compare that against the Theoretical EHP estimate from HP and Defense"
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

                    {/* #358 finding M9: the default roster is EMPTY, which the engine runs as an
                        `attack: 0` practice target — so a first-time visitor sees "Damage absorbed:
                        0" beside "Survived all 20 rounds" and nothing telling them why. */}
                    {enemies.length === 0 && (
                        <div className="card text-sm text-theme-text-secondary">
                            No enemy attackers yet, so nothing is being thrown at these ships:{' '}
                            <span className="font-semibold">Damage absorbed</span> reads 0 and no
                            ship can be destroyed. The fight still runs, though, against a single
                            inert practice target that never shoots back &mdash; and that target can
                            be DESTROYED, which ends the run there. So a hard-hitting ship can show
                            fewer <span className="font-semibold">Rounds survived</span> than the
                            window you set, and that says nothing about how tough it is. Add an
                            attacker in <span className="font-semibold">Enemy Team</span> above to
                            measure anything.
                        </div>
                    )}

                    <div
                        className={`grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 ${configs.length >= 4 ? '2xl:w-[calc(100vw-256px-2rem)] 2xl:ml-[calc((-100vw/2)+768px+1rem)] 2xl:[grid-template-columns:repeat(auto-fit,minmax(370px,500px))] 2xl:justify-center' : ''}`}
                    >
                        {configs.map((config) => (
                            <DefenseShipCard
                                key={config.id}
                                config={config}
                                isBest={bestShip?.id === config.id}
                                isComparing={configs.length > 1}
                                bestDamageAbsorbed={bestDamageAbsorbed}
                                rounds={rounds}
                                noEnemiesConfigured={enemies.length === 0}
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
                        <h2 className="text-xl font-bold mb-4">Theoretical EHP Explanation</h2>
                        <p className="mb-2">
                            Theoretical EHP is an estimate from hangar stats alone: how much damage
                            your ship could take before being destroyed if its damage reduction
                            applied to every point of it. It is <em>not</em> the Damage absorbed
                            figure above — that one is measured in a real fight and deliberately
                            counts damage <em>before</em> any reduction the ship applies.
                        </p>
                        <p className="mb-2">The formula for calculating Theoretical EHP is:</p>
                        <p className="mb-2 font-mono bg-dark-lighter p-2">
                            Theoretical EHP = HP / (1 - (Damage Reduction / 100))
                        </p>
                        <p className="mb-2">
                            Defense buffs multiply the base defense stat before calculating damage
                            reduction. Incoming damage buffs (e.g.{' '}
                            <em>-30% Incoming Direct Damage</em>) further adjust it. No enemy ever
                            fires at it, and it cannot see shields, Barrier, self-repair or
                            conditionally-gated buffs.
                        </p>
                        <p>
                            Security does not affect Theoretical EHP directly — it determines how
                            well your ship resists debuffs from hackers. Higher security reduces the
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
