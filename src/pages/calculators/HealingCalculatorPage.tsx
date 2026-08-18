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
import type { Position } from '../../types/encounters';
import { detectFullyCharged } from '../../utils/skillTextParser';
import {
    parseShipTargeting,
    type ParsedPattern,
    type ShipTargeting,
} from '../../utils/targetingParser';
import { buildShipAbilitiesWithEquipment } from '../../utils/abilities/buildShipAbilitiesWithEquipment';
import { buildDefaultShipSkills } from '../../utils/abilities/configToSimInputs';
import { calculateTotalStats } from '../../utils/ship/statsCalculator';
import {
    simulateHealing,
    HealingSimulationResult,
    EnemyAttackerInput,
    // The engine's focus-actor id — the key the RECIPIENT-axis map uses for the healer itself.
    FOCUS_ID as HEALER_ACTOR_ID,
} from '../../utils/calculators/healingEngineAdapter';
import {
    DEFAULT_HEALER_SLOT,
    HEALING_SLOT_OPTIONS,
    defaultEnemySlot,
    defaultHealTargetSlot,
    defaultHealingTeamSlot,
    resolveHealingPlayerPlacement,
    uncoveredAllyIds,
} from '../../utils/calculators/healingPlacement';
import {
    DEFAULT_ENEMY_DEFENCE,
    DEFAULT_ENEMY_HP,
    DEFAULT_ENEMY_SECURITY,
    DEFAULT_ENEMY_SPEED,
} from '../../utils/calculators/healingDefaultEnemy';
import { useShips } from '../../contexts/ShipsContext';
import { useInventory } from '../../contexts/InventoryProvider';
import { useEngineeringStats } from '../../hooks/useEngineeringStats';
import { Input } from '../../components/ui/Input';
import { HealerConfigCard } from '../../components/calculator/HealerConfigCard';
import { HealTargetPanel, HealTargetState } from '../../components/calculator/HealTargetPanel';
import {
    EnemyAttackersPanel,
    EnemyAttackerConfig,
} from '../../components/calculator/EnemyAttackersPanel';
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

/** The stat block a manually-added enemy starts from, placed at the Nth default enemy cell.
 *
 *  The stats themselves live in `healingDefaultEnemy.ts` because the adapter needs the same numbers
 *  for the PRACTICE TARGET it synthesizes when the roster is empty — see that module for why none of
 *  them may be 0. `attack` and `hacking` stay here: they are the two the practice target does not
 *  share (it has no attack, and an absent hacking already defaults to the engine's 200). */
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

/** `wanted` if free, else the first unoccupied cell — two actors on one cell means the sim MOVES
 *  one of them, so a freshly-added ship should not start in a collision. */
const firstFreeSlot = (wanted: Position, taken: ReadonlyArray<Position | undefined>): Position => {
    const used = new Set(taken.filter((p): p is Position => !!p));
    if (!used.has(wanted)) return wanted;
    return HEALING_SLOT_OPTIONS.find((p) => !used.has(p)) ?? wanted;
};

/**
 * A ship's parsed ACTIVE targeting. Load-bearing twice over: the healer's copy drives the offensive
 * cast AND — via its support footprint — which allies its heals reach; every player ship's copy is a
 * coverage source for the placement warning. A manual actor (no ship) has none, and the adapter's
 * synthetic single-target fallback then applies, which never filters ally recipients at all.
 *
 * Module-level on purpose: called from inside `useMemo`, where a component-scoped function would be
 * a new dependency on every render.
 *
 * ⚠️ GUARDED, and not defensively-for-the-sake-of-it: BOTH axes of `parseShipTargeting` THROW on a
 * string they do not recognise — `parseTarget` on anything outside its 8-entry map
 * (targetingParser.ts:119) and `parsePattern`'s `detectShape` on an unknown shape token (:171).
 * This call sits on the RENDER path over whatever targeting strings a user's stored ship records
 * happen to carry, so one stale or hand-edited value would take the whole page down with a React
 * render crash instead of degrading. An unparseable kit tells us nothing about targeting, so it
 * falls back to no targeting at all — exactly as a manual config does, which means the adapter's
 * synthetic single-target fallback applies and no ally is ever reported "uncovered". Same guard, same
 * reason as `defaultHealTargetSlot`'s `resolveCells` try/catch.
 */
const targetingOf = (ship?: Ship): ShipTargeting | undefined => {
    if (!ship) return undefined;
    try {
        return parseShipTargeting(ship);
    } catch {
        return undefined;
    }
};

/** A ship's ACTIVE pattern — the coverage source `uncoveredAllyIds` reads. */
const activePatternOf = (ship?: Ship): ParsedPattern | undefined =>
    targetingOf(ship)?.active?.pattern;

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
                            ...healerStatsFromShip(shipFinalStats(ship)),
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
    const [targetCombatStats, setTargetCombatStats] = useState<CombatStatBlock | undefined>(
        undefined
    );

    const [enemies, setEnemies] = useState<EnemyAttackerConfig[]>([
        { id: '1', name: 'Enemy 1', ...defaultEnemyStats(0) },
    ]);

    // ⚠️ NO `position` HERE, DELIBERATELY. `position` on a team ship means "the user picked this
    // cell": `resolveHealingPlayerPlacement` reads its presence as an EXPLICIT placement and lets it
    // outrank the heal target's coverage-aware default. Seeding the index-derived default into state
    // made every untouched team ship look deliberate, so `contestedByExplicit` fired against a
    // *default*, the heal target lost its nomination and was evicted to the first free cell in
    // `ATTACKER_SLOT_OPTIONS` order — chosen with no knowledge of coverage. Measured on the default
    // board with Volk (`Pattern-Line-Support-from-centre-Range-1`, covering {M2, M1, M3} from M2):
    // the moment a separate heal target was chosen, the untouched team ship's "explicit" M1 took the
    // heal target's only covered cell and the page reported 0 healing — no placement edit involved.
    // The default is a DISPLAY value only, supplied by `teamShipSlot` below.
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
                    shipSkills: buildShipAbilitiesWithEquipment(ship, getGearPiece),
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
            security: Math.round(final.security ?? 0),
        }));
        setTargetShipSkills(buildShipAbilitiesWithEquipment(ship, getGearPiece));
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
        const n = nextEnemyIdRef.current++;
        setEnemies((prev) => [
            ...prev,
            {
                id: n.toString(),
                name: `Enemy ${n}`,
                ...defaultEnemyStats(prev.length),
                // Index-derived defaults collide once the user has moved anyone, and a collision is
                // resolved by MOVING an enemy at sim time — so pick a free cell up front.
                position: firstFreeSlot(
                    defaultEnemySlot(prev.length),
                    prev.map((e) => e.position)
                ),
            },
        ]);
    };

    // An empty roster is allowed: it means "nothing shoots back", and the adapter synthesizes an
    // inert PRACTICE TARGET for it (`healingEngineAdapter.practiceTarget`) so the run reads as pure
    // healing output with everything overhealed.
    //
    // History, and why the practice target carries a real defence rather than 0: before SP-4b-2b an
    // empty roster fell to the engine's vestigial dummy — a fixed 10,000-defence / 1,000,000-HP sink
    // that never dies — so every `basis:'damage-dealt'` rider silently rebased off that 10,000 and
    // `perTargetDealt` disappeared. Measured at the time: totalDirectHeal 3,876 with one real enemy
    // at defence 1,000 → 1,290 with none, a 3x move from a single click on a fresh page. The practice
    // target carries the same numbers this page's own default card does, so emptying the roster now
    // changes only the damage coming at you.
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
                    hacking: Math.round(final.hacking ?? 200),
                    // The enemy is a real, killable actor since SP-3: its own HP/defence/security
                    // drive whether it dies, how much the healer's cast hurts it (the basis for
                    // damage-dealt riders), and whether the healer's debuffs land on it.
                    // Floored at 1: `final.hp` can resolve to 0 (e.g. a ship with 0 base HP), and
                    // `??` only substitutes the default for null/undefined — it lets a resolved 0
                    // straight through. A 0-HP enemy enters the run already destroyed, which
                    // silently zeroes every `basis:'damage-dealt'` rider (see the HP-field comment
                    // in EnemyAttackersPanel.tsx, which clamps for the same reason on manual entry).
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
    const addTeamShip = () => {
        if (teamShips.length >= 4) return;
        const id = `team-${nextTeamIdRef.current++}`;
        // Again NO `position`: an added ship the user has not placed must stay a DEFAULT, or it
        // outranks the heal target's coverage-aware cell (see the state initialiser above).
        // `teamShipSlot(id, index)` shows `defaultHealingTeamSlot(index)` for it, which is the very
        // cell the adapter will resolve for it.
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
                        // Carried through as-is, `undefined` included: an untouched ship must not
                        // gain an explicit cell just because the roster shrank to one.
                        position: prev[0].position,
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
                    buffs: t.buffs.filter((b) => !b.autoFilled),
                    enemyDebuffs: t.enemyDebuffs.filter((b) => !b.autoFilled),
                };
            })
        );
    };

    const updateTeamShip = (id: string, updates: Partial<TeamShipConfig>) => {
        setTeamShips((prev) => prev.map((t) => (t.id === id ? { ...t, ...updates } : t)));
    };

    /** This team ship's cell, falling back to its index-derived default. */
    const teamShipSlot = (id: string, index: number): Position =>
        teamShips.find((t) => t.id === id)?.position ?? defaultHealingTeamSlot(index);

    /**
     * Move a team ship, SWAPPING with whichever team ship already holds the cell.
     *
     * Scoped to team ships, matching the DPS page: healer CONFIGS are alternatives simulated in
     * separate runs, so they never share a board with each other. Swapping (rather than leaving the
     * collision to the sim) keeps the displayed board honest — the sim's own collision pass would
     * move a ship to a cell no dropdown shows.
     */
    const changeTeamShipSlot = (id: string, slot: Position) =>
        setTeamShips((prev) => {
            const moving = prev.find((t) => t.id === id);
            if (!moving) return prev;
            const from = moving.position ?? defaultHealingTeamSlot(prev.indexOf(moving));
            if (from === slot) return prev;
            const occupantIndex = prev.findIndex(
                (t, i) => t.id !== id && (t.position ?? defaultHealingTeamSlot(i)) === slot
            );
            return prev.map((t, i) => {
                if (t.id === id) return { ...t, position: slot };
                if (i === occupantIndex) return { ...t, position: from };
                return t;
            });
        });

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
                // Board cell, ONLY when the user actually picked one — the same shape `targetActor`
                // uses below, and for the same reason. Left absent, the adapter applies
                // `defaultHealingTeamSlot(index)` itself (identical to what `teamShipSlot` displays)
                // and, crucially, treats the ship as UNPLACED, so it cannot outrank the heal
                // target's coverage-aware default. Sending the default here made every untouched
                // team ship look deliberate and could evict the heal target off its covered cell.
                ...(t.position ? { position: t.position } : {}),
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
    ]);

    const enemyInputs = useMemo<EnemyAttackerInput[]>(
        () =>
            enemies.map((e) => {
                // The enemy's OWN parsed targeting, exactly as the healer gets its own (decision 4:
                // targeting comes from every ACTOR's parsed skill targeting, not just the healer's).
                // Without it every enemy defaulted to single-target FRONT, so an enemy AoE attacker hit
                // exactly one player ship instead of its real footprint — understating incoming
                // pressure on a spread board and making defensive placement inert against the enemy
                // side. Undefined for a manual enemy (or an unparseable kit), and the adapter's
                // synthetic front/base fallback then applies.
                const targeting = targetingOf(e.shipId ? getShipById(e.shipId) : undefined);
                return {
                    id: e.id,
                    stats: {
                        attack: e.attack,
                        crit: e.crit,
                        critDamage: e.critDamage,
                        speed: e.speed,
                        // The enemy's OWN numbers, no longer the adapter's legacy-sink fallbacks: its
                        // defence is the basis for the healer's damage-dealt riders, its HP decides
                        // whether it can be destroyed, and its security resists the healer's debuffs.
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
                        teamShipSlot={teamShipSlot}
                        onTeamShipSlotChange={changeTeamShipSlot}
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
