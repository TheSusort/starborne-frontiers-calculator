import { useCallback, useMemo, useRef, useState } from 'react';
import { Ship } from '../types/ship';
import type { Position } from '../types/encounters';
import { asFactionKey } from '../constants/factions';
import { targetingOf } from '../utils/calculators/shipTargeting';
import { buildShipAbilitiesWithEquipment } from '../utils/abilities/buildShipAbilitiesWithEquipment';
import { EnemyAttackerConfig } from '../components/calculator/EnemyAttackersPanel';
import { TeamShipConfig, TeamActorInput } from '../types/calculator';
import { EnemyAttackerInput } from '../utils/calculators/healingEngineAdapter';
import {
    DEFAULT_ENEMY_DEFENCE,
    DEFAULT_ENEMY_HP,
    DEFAULT_ENEMY_SECURITY,
} from '../utils/calculators/healingDefaultEnemy';
import { defaultEnemySlot } from '../utils/calculators/healingPlacement';
import {
    defaultEnemyStats,
    firstFreeSlot,
    detectShipCharged,
    shipFinalStats,
} from '../utils/calculators/rosterHelpers';
import { useShips } from '../contexts/ShipsContext';
import { useInventory } from '../contexts/InventoryProvider';
import { useEngineeringStats } from './useEngineeringStats';

/** Options that capture the four points where the healing and defense calculator pages' enemy/
 *  team roster logic genuinely diverge — everything else below is the shared ~230 lines that used
 *  to be duplicated between `HealingCalculatorPage.tsx` and `DefenseCalculatorPage.tsx`. */
export interface UseEnemyTeamRosterOptions {
    /** 0 = the roster may be emptied (defense). 1 = removing the last team ship RESETS it
     *  instead of deleting it (healing). */
    minTeamShips: 0 | 1;
    /** First id handed out by addEnemy. Healing seeds 2 (one pre-seeded enemy exists);
     *  defense seeds 1 (its roster starts empty). */
    enemyIdSeed: number;
    /** First id handed out by addTeamShip. Same reasoning. */
    teamIdSeed: number;
    /** Index-derived display default for a team ship's cell. Supplying it enables
     *  `teamShipSlot` / `changeTeamShipSlot`; omitting it leaves both undefined. */
    defaultTeamSlot?: (index: number) => Position;
    initialEnemies?: EnemyAttackerConfig[];
    initialTeamShips?: TeamShipConfig[];
}

export interface UseEnemyTeamRosterResult {
    enemies: EnemyAttackerConfig[];
    teamShips: TeamShipConfig[];
    enemyInputs: EnemyAttackerInput[];
    teamActors: TeamActorInput[];
    addEnemy: () => void;
    removeEnemy: (id: string) => void;
    selectEnemyShip: (id: string, ship: Ship) => void;
    updateEnemy: (id: string, updates: Partial<EnemyAttackerConfig>) => void;
    addTeamShip: () => void;
    removeTeamShip: (id: string) => void;
    selectShipForTeamSlot: (id: string, ship: Ship) => void;
    updateTeamShip: (id: string, updates: Partial<TeamShipConfig>) => void;
    teamShipSlot?: (id: string, index: number) => Position;
    changeTeamShipSlot?: (id: string, slot: Position) => void;
}

/** Enemy/team roster state + handlers shared by the healing and defense calculator pages.
 *
 *  Was ~230 duplicated lines across `HealingCalculatorPage.tsx` and `DefenseCalculatorPage.tsx` —
 *  eight state handlers plus the two memoized mappings into combat-engine inputs. The bodies below
 *  are moved verbatim from the healing page (`HealingCalculatorPage.tsx:347-643` as of #392); the
 *  defense page's own copies were byte-identical apart from the four `UseEnemyTeamRosterOptions`
 *  divergence points this hook now takes as parameters. */
export function useEnemyTeamRoster(options: UseEnemyTeamRosterOptions): UseEnemyTeamRosterResult {
    const { minTeamShips, defaultTeamSlot, initialEnemies, initialTeamShips } = options;

    const { getShipById } = useShips();
    const { getGearPiece } = useInventory();
    const { getEngineeringStatsForShipType } = useEngineeringStats();

    const nextEnemyIdRef = useRef(options.enemyIdSeed);
    const nextTeamIdRef = useRef(options.teamIdSeed);

    const [enemies, setEnemies] = useState<EnemyAttackerConfig[]>(initialEnemies ?? []);
    const [teamShips, setTeamShips] = useState<TeamShipConfig[]>(initialTeamShips ?? []);

    // ---- Enemy attacker handlers ----
    const addEnemy = useCallback(() => {
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
    }, []);

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
    const removeEnemy = useCallback((id: string) => {
        setEnemies((prev) => prev.filter((e) => e.id !== id));
    }, []);

    const selectEnemyShip = useCallback(
        (id: string, ship: Ship) => {
            const final = shipFinalStats(ship, getGearPiece, getEngineeringStatsForShipType);
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
        },
        [getGearPiece, getEngineeringStatsForShipType]
    );

    const updateEnemy = useCallback((id: string, updates: Partial<EnemyAttackerConfig>) => {
        setEnemies((prev) => prev.map((e) => (e.id === id ? { ...e, ...updates } : e)));
    }, []);

    // ---- Team handlers ----
    const addTeamShip = useCallback(() => {
        // Again NO `position`: an added ship the user has not placed must stay a DEFAULT, or it
        // outranks the heal target's coverage-aware cell (see the state initialiser above).
        // `teamShipSlot(id, index)` shows `defaultHealingTeamSlot(index)` for it, which is the very
        // cell the adapter will resolve for it.
        setTeamShips((prev) => {
            if (prev.length >= 4) return prev;
            const id = `team-${nextTeamIdRef.current++}`;
            return [
                ...prev,
                {
                    id,
                    buffs: [],
                    enemyDebuffs: [],
                    startCharged: false,
                    speed: 100,
                    chargeCount: 0,
                },
            ];
        });
    }, []);

    const removeTeamShip = useCallback(
        (id: string) => {
            setTeamShips((prev) => {
                if (minTeamShips === 1 && prev.length <= 1)
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
        },
        [minTeamShips]
    );

    const selectShipForTeamSlot = useCallback(
        (id: string, ship: Ship) => {
            const final = shipFinalStats(ship, getGearPiece, getEngineeringStatsForShipType);
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
                        // #363: faction-scoped ally grants (Fuying's Tianchen Stealth) resolve the
                        // recipient's faction from here.
                        faction: asFactionKey(ship.faction),
                        buffs: t.buffs.filter((b) => !b.autoFilled),
                        enemyDebuffs: t.enemyDebuffs.filter((b) => !b.autoFilled),
                    };
                })
            );
        },
        [getGearPiece, getEngineeringStatsForShipType]
    );

    const updateTeamShip = useCallback((id: string, updates: Partial<TeamShipConfig>) => {
        setTeamShips((prev) => prev.map((t) => (t.id === id ? { ...t, ...updates } : t)));
    }, []);

    /** This team ship's cell, falling back to its index-derived default. */
    const teamShipSlot = useCallback(
        (id: string, index: number): Position =>
            teamShips.find((t) => t.id === id)?.position ?? defaultTeamSlot!(index),
        [teamShips, defaultTeamSlot]
    );

    /**
     * Move a team ship, SWAPPING with whichever team ship already holds the cell.
     *
     * Scoped to team ships, matching the DPS page: healer CONFIGS are alternatives simulated in
     * separate runs, so they never share a board with each other. Swapping (rather than leaving the
     * collision to the sim) keeps the displayed board honest — the sim's own collision pass would
     * move a ship to a cell no dropdown shows.
     */
    const changeTeamShipSlot = useCallback(
        (id: string, slot: Position) =>
            setTeamShips((prev) => {
                const moving = prev.find((t) => t.id === id);
                if (!moving) return prev;
                const from = moving.position ?? defaultTeamSlot!(prev.indexOf(moving));
                if (from === slot) return prev;
                const occupantIndex = prev.findIndex(
                    (t, i) => t.id !== id && (t.position ?? defaultTeamSlot!(i)) === slot
                );
                return prev.map((t, i) => {
                    if (t.id === id) return { ...t, position: slot };
                    if (i === occupantIndex) return { ...t, position: from };
                    return t;
                });
            }),
        [defaultTeamSlot]
    );

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
                faction: t.faction,
                // #426: the team ship's real name, for the live `ally-on-team` roster check
                // (Isha/Nayra's reciprocal Affinity Override gate). DERIVED from `shipId` rather
                // than stored on `TeamShipConfig` beside `role`/`faction`: those are snapshots of
                // stats that the user may edit, whereas the name is pure identity and a stored
                // copy would be one more field every re-enumerating call site has to remember.
                // Absent for a manual slot → an unnamed actor can never satisfy a name gate,
                // matching how `role` and `faction` already treat manual slots.
                name: (t.shipId && getShipById(t.shipId)?.name) || undefined,
                // Board cell, ONLY when the user actually picked one — the same shape `targetActor`
                // uses below, and for the same reason. Left absent, the adapter applies
                // `defaultHealingTeamSlot(index)` itself (identical to what `teamShipSlot` displays)
                // and, crucially, treats the ship as UNPLACED, so it cannot outrank the heal
                // target's coverage-aware default. Sending the default here made every untouched
                // team ship look deliberate and could evict the heal target off its covered cell.
                ...(t.position ? { position: t.position } : {}),
            })),
        [teamShips, getShipById]
    );

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
                const enemyShip = e.shipId ? getShipById(e.shipId) : undefined;
                const targeting = targetingOf(enemyShip);
                return {
                    id: e.id,
                    // #363: this enemy's own faction — mirrors how the player-side team-ship/
                    // target-ship branches above already thread `faction: asFactionKey(ship.
                    // faction)`. Without this an ENEMY-side Fuying grants Stealth to nobody
                    // (unknown faction never matches a filter), the opposite-direction defect
                    // from those branches missing it. A manual enemy (no `shipId`) stays
                    // unknown-faction, same as before.
                    faction: asFactionKey(enemyShip?.faction),
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

    return {
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
        teamShipSlot: defaultTeamSlot ? teamShipSlot : undefined,
        changeTeamShipSlot: defaultTeamSlot ? changeTeamShipSlot : undefined,
    };
}
