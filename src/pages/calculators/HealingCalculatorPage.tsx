import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageLayout } from '../../components/ui';
import { Ship, AffinityName } from '../../types/ship';
import type { ShipTypeName } from '../../constants/shipTypes';
import { asFactionKey, type FactionKey } from '../../constants/factions';
import {
    HealerShipConfig,
    HealerShipConfigUpdateableField,
    SelectedGameBuff,
    TeamActorInput,
    CombatStatBlock,
} from '../../types/calculator';
import { ShipSkills } from '../../types/abilities';
import type { Position } from '../../types/encounters';
import { type ParsedPattern } from '../../utils/targetingParser';
import { buildShipAbilitiesWithEquipment } from '../../utils/abilities/buildShipAbilitiesWithEquipment';
import { buildDefaultShipSkills } from '../../utils/abilities/configToSimInputs';
import { targetingOf } from '../../utils/calculators/shipTargeting';
import {
    simulateHealing,
    HealingSimulationResult,
    // The engine's focus-actor id — the key the RECIPIENT-axis map uses for the healer itself.
    FOCUS_ID as HEALER_ACTOR_ID,
} from '../../utils/calculators/healingEngineAdapter';
import {
    DEFAULT_HEALER_SLOT,
    defaultHealTargetSlot,
    defaultHealingTeamSlot,
    resolveHealingPlayerPlacement,
    uncoveredAllyIds,
} from '../../utils/calculators/healingPlacement';
import { useShips } from '../../contexts/ShipsContext';
import { useInventory } from '../../contexts/InventoryProvider';
import { useEngineeringStats } from '../../hooks/useEngineeringStats';
import { useEnemyTeamRoster } from '../../hooks/useEnemyTeamRoster';
import {
    defaultEnemyStats,
    detectShipCharged,
    shipFinalStats,
} from '../../utils/calculators/rosterHelpers';
import { Input } from '../../components/ui/Input';
import { HealerConfigCard } from '../../components/calculator/HealerConfigCard';
import { HealTargetPanel, HealTargetState } from '../../components/calculator/HealTargetPanel';
import { EnemyAttackersPanel } from '../../components/calculator/EnemyAttackersPanel';
import { TeamPanel } from '../../components/calculator/TeamPanel';
import { GameBuffPicker } from '../../components/calculator/GameBuffPicker';
import { HealingCumulativeChart } from '../../components/calculator/HealingCumulativeChart';
import {
    HealingRecipientBreakdown,
    RecipientRow,
} from '../../components/calculator/HealingRecipientBreakdown';
import { HealingTimelineChart } from '../../components/calculator/HealingTimelineChart';
import { CollapsibleForm } from '../../components/ui/layout/CollapsibleForm';
import { ChevronDownIcon } from '../../components/ui/icons/ChevronIcons';
import { Button } from '../../components/ui/Button';
import Seo from '../../components/seo/Seo';
import { SEO_CONFIG } from '../../constants/seo';

const HEAL_TARGET_ID = 'heal-target';

/**
 * A ship's ACTIVE pattern — the coverage source `uncoveredAllyIds` reads.
 *
 * Load-bearing twice over: the healer's own pattern drives the offensive cast AND — via its
 * support footprint — which allies its heals reach; every player ship's pattern is a coverage
 * source for the placement warning. A manual actor (no ship) has none, and the adapter's synthetic
 * single-target fallback then applies, which never filters ally recipients at all. Built on
 * `targetingOf` (shared, `utils/calculators/shipTargeting.ts`) — see that module for why the
 * try/catch is load-bearing: an unparseable kit falls back to no targeting at all rather than
 * crashing the render, which means no ally is ever reported "uncovered" for it. Same guard, same
 * reason as `defaultHealTargetSlot`'s `resolveCells` try/catch.
 *
 * Module-level on purpose: called from inside `useMemo`, where a component-scoped function would be
 * a new dependency on every render.
 */
const activePatternOf = (ship?: Ship): ParsedPattern | undefined =>
    targetingOf(ship)?.active?.pattern;

const HealingCalculatorPage: React.FC = () => {
    const [searchParams, setSearchParams] = useSearchParams();
    const { getShipById } = useShips();
    const { getGearPiece } = useInventory();
    const { getEngineeringStatsForShipType } = useEngineeringStats();
    const shipInitialized = useRef(false);

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
        security: Math.round(final.security ?? 0),
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
        security: 0,
        chargeCount: 0,
        startCharged: false,
        shipSkills: buildDefaultShipSkills(),
        position: DEFAULT_HEALER_SLOT,
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
                            ...healerStatsFromShip(
                                shipFinalStats(ship, getGearPiece, getEngineeringStatsForShipType)
                            ),
                            chargeCount: ship.chargeSkillCharge ?? 0,
                            startCharged: detectShipCharged(ship),
                            shipSkills: buildShipAbilitiesWithEquipment(ship, getGearPiece),
                            position: DEFAULT_HEALER_SLOT,
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
        security: 0,
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
    // #363: selected heal-target ship's faction (explicit-target case). Decides whether a
    // faction-scoped ally grant reaches it (Fuying's "grants Tianchao allies Stealth"). Undefined
    // → no ship picked → unknown faction → never a recipient of one (conservative).
    const [targetFaction, setTargetFaction] = useState<FactionKey | undefined>(undefined);
    const [targetCombatStats, setTargetCombatStats] = useState<CombatStatBlock | undefined>(
        undefined
    );

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
        teamShipSlot,
        changeTeamShipSlot,
    } = useEnemyTeamRoster({
        minTeamShips: 1,
        enemyIdSeed: 2,
        teamIdSeed: 2,
        defaultTeamSlot: defaultHealingTeamSlot,
        initialEnemies: [{ id: '1', name: 'Enemy 1', ...defaultEnemyStats(0) }],
        // ⚠️ NO `position` HERE, DELIBERATELY. `position` on a team ship means "the user picked this
        // cell": `resolveHealingPlayerPlacement` reads its presence as an EXPLICIT placement and lets
        // it outrank the heal target's coverage-aware default. Seeding the index-derived default made
        // every untouched team ship look deliberate, the heal target lost its nomination and the page
        // reported 0 healing. The default is a DISPLAY value only, supplied by `teamShipSlot`.
        initialTeamShips: [
            {
                id: 'team-1',
                buffs: [],
                enemyDebuffs: [],
                startCharged: false,
                speed: 100,
                chargeCount: 0,
            },
        ],
    });

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
        const stats = healerStatsFromShip(
            shipFinalStats(ship, getGearPiece, getEngineeringStatsForShipType)
        );
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
                    shipSkills: buildShipAbilitiesWithEquipment(ship, getGearPiece),
                };
            })
        );
    };

    // ---- Heal target handlers ----
    const selectTargetShip = (ship: Ship) => {
        const final = shipFinalStats(ship, getGearPiece, getEngineeringStatsForShipType);
        setTarget((prev) => ({
            ...prev,
            shipId: ship.id,
            hp: Math.round(final.hp ?? 0),
            defence: Math.round(final.defence ?? 0),
            speed: Math.round(final.speed ?? 100),
            security: Math.round(final.security ?? 0),
        }));
        setTargetShipSkills(buildShipAbilitiesWithEquipment(ship, getGearPiece));
        setTargetChargeCount(ship.chargeSkillCharge ?? 0);
        setTargetStartCharged(detectShipCharged(ship));
        setTargetAffinity(ship.affinity);
        setTargetRole(ship.type);
        setTargetFaction(asFactionKey(ship.faction));
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

    // ---- Derived sim inputs ----
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
            // #363: faction-scoped ally grants resolve the recipient's faction here.
            faction: targetFaction,
            // ONLY when the user chose a cell. Left absent, the adapter applies its coverage-aware
            // `defaultHealTargetSlot` — which knows the healer's support footprint and therefore
            // whether the target gets healed at all. Passing a cell here overrides that.
            ...(target.position ? { position: target.position } : {}),
        };
    }, [
        target.useHealerAsTarget,
        target.position,
        target.speed,
        target.defence,
        target.hp,
        targetChargeCount,
        targetStartCharged,
        targetShipSkills,
        targetCombatStats,
        targetRole,
        targetFaction,
    ]);

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
            // #363: the healer's own faction — decides whether its OWN faction-scoped grant can
            // reach it, and (as the focus actor) seeds the engine's actor→faction map.
            const healerFaction = config.shipId
                ? asFactionKey(getShipById(config.shipId)?.faction)
                : undefined;
            // The heal target's security drives each enemy's inbound debuff landing chance
            // (enemy hacking − security). Self-heal uses the healer config's own security
            // (auto-filled from the ship, 0 for manual configs); otherwise the manual target.
            const healTargetSecurity = target.useHealerAsTarget ? config.security : target.security;
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
                    healTargetSecurity,
                    healerRole,
                    healerFaction,
                    teamActors: allTeamActors,
                    enemies: enemyInputs,
                    rounds,
                    healerPosition: config.position ?? DEFAULT_HEALER_SLOT,
                    // The healer's REAL parsed targeting when a ship is picked: it drives the
                    // offensive cast AND — via the support footprint — which allies its heals
                    // reach. Left undefined for a manual config so the adapter's synthetic
                    // single-target fallback applies (that pattern never filters ally recipients).
                    healerTargeting: targetingOf(
                        config.shipId ? getShipById(config.shipId) : undefined
                    ),
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
        target.security,
        targetAffinity,
        getShipById,
        enemyInputs,
        rounds,
    ]);

    // ---- Placement warning (decision 8) ----
    //
    // ⚠️ THIS IS THE SAFETY NET FOR THE WHOLE POSITIONAL MODEL. A support cast anchors on the
    // caster's own cell and `resolveSupportRecipients` FILTERS its recipients by that footprint, so
    // an ally standing outside every supporter's footprint receives EXACTLY ZERO healing. That zero
    // is owner-ruled game-faithful and is never softened — no fallback recipient, no widened filter.
    // Making it VISIBLE is the only permitted mitigation, and this is it. A silent zero is
    // indistinguishable from a bug.
    //
    // Two cases survive however good the defaults get: a CASTER-ONLY footprint (a healer at M4 with
    // Pattern-Line-Support-Range-1 has its forward cell clip off-board, so no ally cell is coverable
    // at all), and any ally the user places off-pattern.
    //
    // Computed per healer CONFIG, because configs are alternatives with different ships — and
    // therefore different patterns and different coverage — simulated on separate boards. Cells come
    // from the SHARED `resolveHealingPlayerPlacement` the sim itself uses, so the warning can never
    // name a cell nobody occupies.
    //
    // ⚠️ THE HEALER IS THE ONLY COVERAGE SOURCE, deliberately — even though `uncoveredAllyIds`
    // unions across every supporter and every team ship's pattern IS resolvable from its ship data.
    // The reason is fidelity: the adapter sources a team actor's axes from `t.target`/`t.pattern`
    // and this page supplies neither, so every team actor runs on the synthetic
    // `DEFAULT_BASE_PATTERN` — a NON-support pattern, which makes `supportFootprintAllyIds` return
    // undefined and leaves that actor's heals UNFILTERED. Feeding a team ship's real support
    // footprint in here would therefore invent coverage the simulation does not apply, and a
    // "rescued" ally would silently suppress the very warning this exists to raise. The union stays
    // in the helper (tested there) and goes live the moment team-actor targeting is threaded into
    // the adapter — a named follow-up, not an oversight.
    //
    // ⚠️ HOW WIDE "UNFILTERED" IS, since SP-4e Task 4 — INTENDED FOR NOW (owner ruling 2026-08-21).
    // "Unfiltered" used to be nearly harmless: a plain `'ally'` support clause resolved to the single
    // heal anchor, so no narrowing meant "the anchor, unnarrowed". It now resolves to the caster's
    // whole own side (`recipientsFor`, playerTurn.ts), so on a team actor — which this page threads
    // NO pattern to — an ally-targeted clause reaches the ENTIRE player side, the team actor itself
    // included. That is the deliberate meaning of `supportFootprintAllyIds`'s `undefined` ("do not
    // narrow"), left as-is rather than split into "no ally reach" vs "not threaded". It resolves
    // itself the same way this warning's union does: by threading real team-actor patterns.
    const placementWarnings = useMemo(() => {
        const allies = [
            // `position` stays `undefined` for an unplaced ship — `resolveHealingPlayerPlacement`
            // must see the SAME explicit/default split the sim sees, or the warning reasons about a
            // different board than the one being simulated.
            ...teamShips.map((t, i) => ({
                id: t.id,
                position: t.position,
                name: (t.shipId && getShipById(t.shipId)?.name) || `Team ${i + 1}`,
            })),
            ...(target.useHealerAsTarget
                ? []
                : [
                      {
                          id: HEAL_TARGET_ID,
                          position: target.position,
                          name:
                              (target.shipId && getShipById(target.shipId)?.name) || 'Heal Target',
                      },
                  ]),
        ];
        const healTargetId = target.useHealerAsTarget ? 'healer' : HEAL_TARGET_ID;
        return configs
            .map((config) => {
                const healerPattern = activePatternOf(
                    config.shipId ? getShipById(config.shipId) : undefined
                );
                const { healerSlot, allySlots } = resolveHealingPlayerPlacement({
                    healerSlot: config.position,
                    healerPattern,
                    healTargetId,
                    allies,
                });
                const board = [
                    // The healer is a candidate too: it is the heal target when self-healing, and it
                    // can sit outside ANOTHER supporter's footprint.
                    { id: 'healer', position: healerSlot, pattern: healerPattern },
                    ...allies.map((a, i) => ({ ...a, position: allySlots[i] })),
                ];
                const nameById = new Map<string, string>([
                    ['healer', config.name],
                    ...allies.map((a) => [a.id, a.name] as [string, string]),
                ]);
                return {
                    configId: config.id,
                    configName: config.name,
                    names: uncoveredAllyIds(board).map((id) => nameById.get(id) ?? id),
                };
            })
            .filter((w) => w.names.length > 0);
    }, [configs, teamShips, target, getShipById]);

    const bestConfig = configs.reduce<HealerShipConfig | null>((best, current) => {
        if (!best) return current;
        const bestHeal = simResults.get(best.id)?.summary.totalEffectiveHealing ?? 0;
        const curHeal = simResults.get(current.id)?.summary.totalEffectiveHealing ?? 0;
        return curHeal > bestHeal ? current : best;
    }, null);

    // Cells shown as "(taken)" in each dropdown. Healer CONFIGS are alternatives simulated on
    // SEPARATE boards, so a config's cell never truly collides with another config's — but every
    // config does share the board with the team ships and the heal target, so those two lists are
    // exact. Where configs appear in another actor's list they are a hint, not a block: the option
    // stays selectable.
    const teamShipCells = teamShips.map((t, i) => t.position ?? defaultHealingTeamSlot(i));
    const healerCells = configs.map((c) => c.position ?? DEFAULT_HEALER_SLOT);
    // `teamShipSlot`/`changeTeamShipSlot` come back possibly-undefined from the hook's shared type —
    // undefined only when `defaultTeamSlot` is omitted, which is the defense page's case, never this
    // one (it always passes `defaultHealingTeamSlot` above). Asserted once here, with an explicit
    // non-optional variable type, rather than sprinkling `?.` through the JSX below: TeamPanel's own
    // props are optional too (shared with the defense page), so passing the hook's value straight
    // through would still type-check even if it silently went undefined — this keeps that guarantee
    // explicit instead.
    const teamShipSlotForPanel: (id: string, index: number) => Position = teamShipSlot!;
    const changeTeamShipSlotForPanel: (id: string, slot: Position) => void = changeTeamShipSlot!;
    /** The heal target's cell: its own when chosen, else the coverage-aware default of the FIRST
     *  config's footprint. Only a display value — the adapter resolves it per config. */
    const healTargetCell =
        target.position ??
        defaultHealTargetSlot(
            configs[0]?.position ?? DEFAULT_HEALER_SLOT,
            activePatternOf(configs[0]?.shipId ? getShipById(configs[0].shipId) : undefined)
        );
    const healTargetCells = target.useHealerAsTarget ? [] : [healTargetCell];

    const bestEffectiveHealing = simResults.get(bestConfig?.id ?? '')?.summary
        .totalEffectiveHealing;
    const bestResult = bestConfig ? simResults.get(bestConfig.id) : undefined;

    /**
     * A RECIPIENT-axis row's engine actor id → the name the user picked it by.
     *
     * The map is keyed by ENGINE ids, which are not the ids this page hands out: the healer is the
     * engine's focus actor (`HEALER_ACTOR_ID`), the heal target keeps `HEAL_TARGET_ID`, and a team
     * ship keeps its own `team-N`. An unknown id falls through to itself rather than being hidden —
     * a row that appears with a raw id is a wiring bug worth seeing, not one worth swallowing.
     */
    const recipientName = (id: string): string => {
        if (id === HEALER_ACTOR_ID) return bestConfig?.name ?? 'Healer';
        if (id === HEAL_TARGET_ID) {
            return (target.shipId && getShipById(target.shipId)?.name) || 'Heal Target';
        }
        const index = teamShips.findIndex((t) => t.id === id);
        if (index >= 0) {
            const t = teamShips[index];
            return (t.shipId && getShipById(t.shipId)?.name) || `Team ${index + 1}`;
        }
        return id;
    };

    /**
     * The best config's per-ally rows. `summary.perRecipient` is "absent when empty" and OMITS
     * all-zero recipients, so this is the set of allies a repair actually LANDED on — never "every
     * ally the healer reaches". The two are different, and the gap is what the placement warning
     * above exists to explain.
     */
    const recipientRows: RecipientRow[] = Object.entries(
        bestResult?.summary.perRecipient ?? {}
    ).map(([id, r]) => ({
        id,
        effectiveHealing: r.totalEffectiveHealing,
        overheal: r.totalOverheal,
    }));

    return (
        <>
            <Seo {...SEO_CONFIG.healing} />
            <PageLayout
                title="Healing Calculator"
                description="Simulate effective healing, overheal, and shield absorption round-by-round on the combat engine."
                action={{ label: 'Add Healer', onClick: addConfig, variant: 'primary' }}
            >
                <div className="space-y-6">
                    {placementWarnings.length > 0 && (
                        <div className="card !border-orange-400">
                            <h3 className="text-lg font-bold mb-2 text-orange-400">
                                Placement warning
                            </h3>
                            <div className="space-y-2">
                                {placementWarnings.map((w) => (
                                    <p key={w.configId} className="text-sm">
                                        {configs.length > 1 && (
                                            <span className="text-theme-text-secondary">
                                                {w.configName}:{' '}
                                            </span>
                                        )}
                                        <span className="text-orange-400">
                                            {`${w.names.join(', ')} ${
                                                w.names.length === 1 ? 'is' : 'are'
                                            } outside ${w.configName}'s support pattern and will receive no healing from it.`}
                                        </span>{' '}
                                        {`Move ${
                                            w.names.length === 1 ? 'it' : 'them'
                                        } onto a covered cell, or move ${w.configName} — a heal only reaches allies inside the caster's support pattern, and that pattern is anchored on the caster's own cell.`}
                                    </p>
                                ))}
                            </div>
                        </div>
                    )}

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
                        onSecurityChange={(v) => setTarget((prev) => ({ ...prev, security: v }))}
                        slot={healTargetCell}
                        onSlotChange={(position) => setTarget((prev) => ({ ...prev, position }))}
                        takenSlots={[...healerCells, ...teamShipCells]}
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
                        teamShipSlot={teamShipSlotForPanel}
                        onTeamShipSlotChange={changeTeamShipSlotForPanel}
                        otherTakenSlots={[...healerCells, ...healTargetCells]}
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
                                slot={config.position ?? DEFAULT_HEALER_SLOT}
                                onSlotChange={(position) =>
                                    setConfigs((prev) =>
                                        prev.map((c) =>
                                            c.id === config.id ? { ...c, position } : c
                                        )
                                    )
                                }
                                takenSlots={[...teamShipCells, ...healTargetCells]}
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

                    {/* Per-ally breakdown for the best config. Configs are alternatives simulated
                        on separate boards, so the rows belong to exactly one of them — named in a
                        subtitle whenever there is more than one to choose between. */}
                    <HealingRecipientBreakdown
                        recipients={recipientRows}
                        healTargetId={target.useHealerAsTarget ? HEALER_ACTOR_ID : HEAL_TARGET_ID}
                        nameFor={recipientName}
                        {...(configs.length > 1 && bestConfig
                            ? { configName: bestConfig.name }
                            : {})}
                    />

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
                            buffs apply), while the enemy team bombards it.
                        </p>
                        <p>
                            <strong>Fully deterministic.</strong> The simulation contains no
                            randomness — identical inputs always produce identical results. Crits
                            use a fractional-accumulator schedule at the healer&apos;s effective
                            crit rate. Each enemy&apos;s affinity is matched against the heal
                            target&apos;s affinity to scale its incoming damage.
                        </p>
                    </div>
                </div>
            </PageLayout>
        </>
    );
};

export default HealingCalculatorPage;
