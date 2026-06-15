/**
 * Combat Simulator Phase 5 — PR 1, Task 2: symmetric battle-result types + a PURE
 * event-driven assembler.
 *
 * `assembleBattleResult` takes the raw combat event stream + per-round per-victim damage
 * map + a roster (all as plain data) and produces a symmetric, render-ready BattleResult.
 * It has NO engine dependency and NO side effects — it only imports the CombatEvent union
 * (combat/events) and the Position type (types/encounters).
 *
 * Data-source contract (pinned in combat/__tests__/twoTeamBattle.test.ts, Task 1):
 *   - damage DEALT per attacker = `ability-performed.damage` summed by `actorId`.
 *   - damage TAKEN per victim   = `perRoundPerTarget[round][victimId]` (the reliable,
 *     symmetric source for BOTH sides; we do NOT use `hp-changed`).
 *   - heals = `heal-performed` { casterId, targets[], amount } (healing mode only).
 *   - death = `ship-destroyed` { actorId }.
 *   - buffs = `buff-applied` / `buff-expired` / `debuff-applied`.
 *
 * HP% is derived as maxHp - cumulative(damageTaken over rounds <= r), uniform for both
 * sides (ignores healing/shields on the HP curve — acceptable for PR1's surface).
 *
 * Debuff persistence: `activeDebuffs` is infliction-only — there is no `debuff-expired`
 * event in the stream, so once a debuff is added it accumulates and persists for the rest
 * of the battle. This is asymmetric with `activeBuffs`, which DOES expire via `buff-expired`.
 * A PR2 consumer should not expect debuffs to clear over time.
 *
 * `simulateBattle` (the runCombat wrapper that produces these inputs) is Task 3 — NOT here.
 */
import type { CombatEvent } from '../combat/events';
import type { Position } from '../../types/encounters';
import type { Ship, AffinityName } from '../../types/ship';
import type { CombatStatBlock } from '../../types/calculator';
import { runCombat, CombatEngineInput, TeamActorEngineInput } from '../combat/engine';
import { createEventBus } from '../combat/events';
import { buildShipAbilities } from '../abilities/buildShipAbilities';
import { selectFiringSkill } from '../abilities/applyAbilities';
import { parseShipTargeting, SkillTargeting } from '../targetingParser';
import { computeAffinityModifiers } from './affinityUtils';

export interface ShipRoundState {
    actorId: string;
    side: 'player' | 'enemy';
    damageDealt: number;
    damageTaken: number;
    healingDone: number;
    healingReceived: number;
    /**
     * Shield absorption. The `heal-performed` payload carries no shield channel flag
     * (just { casterId, targets[], amount }), so this is always 0 for PR1.
     */
    shieldsAbsorbed: number;
    /** End-of-round HP%, from maxHp - cumulative damageTaken. */
    hpPct: number;
    alive: boolean;
    activeBuffs: string[];
    activeDebuffs: string[];
}

export interface BattleLogEvent {
    round: number;
    kind: 'damage' | 'heal' | 'death';
    actorId: string;
    targetId?: string;
    amount?: number;
}

export interface BattleRound {
    round: number;
    ships: ShipRoundState[];
    events: BattleLogEvent[];
}

export interface BattleResult {
    /** Trimmed at termination (no rounds after outcome.lastRound). */
    rounds: BattleRound[];
    outcome: { winner: 'player' | 'enemy' | 'draw'; lastRound: number };
    roster: Array<{ actorId: string; side: 'player' | 'enemy'; name: string; position: Position }>;
}

interface RosterEntry {
    actorId: string;
    side: 'player' | 'enemy';
    name: string;
    position: Position;
    maxHp: number;
}

const clampPct = (value: number): number => Math.max(0, Math.min(100, value));

/**
 * The CombatEvent types `assembleBattleResult` actually consumes. The `simulateBattle`
 * adapter subscribes its event bus from THIS list, so adding a consumed event type here
 * can't silently leave the adapter unsubscribed (the two would otherwise drift apart).
 */
export const ASSEMBLED_EVENT_TYPES = [
    'ability-performed',
    'heal-performed',
    'ship-destroyed',
    'buff-applied',
    'buff-expired',
    'debuff-applied',
] as const satisfies readonly CombatEvent['type'][];

/**
 * Precondition: expects BOTH sides of `roster` to be non-empty. The wipe checks guard
 * against empty sides (a side with zero members is never treated as "wiped"), so a
 * degenerate single-side roster fails safe to `draw` at numRounds rather than awarding
 * a spurious winner at round 1.
 */
export function assembleBattleResult(args: {
    events: CombatEvent[];
    perRoundPerTarget: Record<number, Record<string, number>>;
    roster: RosterEntry[];
    numRounds: number;
}): BattleResult {
    const { events, perRoundPerTarget, roster, numRounds } = args;

    // Round of first destruction per actor (earliest ship-destroyed).
    const destroyedAt = new Map<string, number>();
    for (const e of events) {
        if (e.type === 'ship-destroyed') {
            const prev = destroyedAt.get(e.actorId);
            if (prev === undefined || e.round < prev) destroyedAt.set(e.actorId, e.round);
        }
    }

    // Running buff/debuff sets per actor, mutated as we walk rounds in order.
    const activeBuffs = new Map<string, Set<string>>();
    const activeDebuffs = new Map<string, Set<string>>();
    const ensure = (map: Map<string, Set<string>>, id: string): Set<string> => {
        let set = map.get(id);
        if (!set) {
            set = new Set<string>();
            map.set(id, set);
        }
        return set;
    };

    // Cumulative damage taken per actor across rounds (for HP% derivation).
    const cumulativeTaken = new Map<string, number>();

    const rounds: BattleRound[] = [];
    let lastRound = numRounds;
    let winner: 'player' | 'enemy' | 'draw' = 'draw';

    for (let round = 1; round <= numRounds; round++) {
        const roundEvents = events.filter((e) => 'round' in e && e.round === round);

        // Buff/debuff transitions for this round (apply before snapshotting the round).
        for (const e of roundEvents) {
            if (e.type === 'buff-applied') {
                ensure(activeBuffs, e.actorId).add(e.buffName);
            } else if (e.type === 'buff-expired') {
                activeBuffs.get(e.actorId)?.delete(e.buffName);
            } else if (e.type === 'debuff-applied') {
                ensure(activeDebuffs, e.targetId).add(e.buffName);
            }
        }

        // Damage dealt per attacker this round (ability-performed.damage by actorId).
        const dealt = new Map<string, number>();
        for (const e of roundEvents) {
            if (e.type === 'ability-performed' && typeof e.damage === 'number') {
                dealt.set(e.actorId, (dealt.get(e.actorId) ?? 0) + e.damage);
            }
        }

        // Healing done (caster, full amount) + received (split evenly across targets —
        // approximation: heal-performed carries no per-recipient breakdown).
        const healDone = new Map<string, number>();
        const healReceived = new Map<string, number>();
        for (const e of roundEvents) {
            if (e.type === 'heal-performed') {
                healDone.set(e.casterId, (healDone.get(e.casterId) ?? 0) + e.amount);
                const per = e.targets.length > 0 ? e.amount / e.targets.length : 0;
                for (const tid of e.targets) {
                    healReceived.set(tid, (healReceived.get(tid) ?? 0) + per);
                }
            }
        }

        // Accumulate this round's per-victim taken damage into the running cumulative.
        const takenThisRound = perRoundPerTarget[round] ?? {};

        const ships: ShipRoundState[] = roster.map((entry) => {
            const taken = takenThisRound[entry.actorId] ?? 0;
            const cumulative = (cumulativeTaken.get(entry.actorId) ?? 0) + taken;
            cumulativeTaken.set(entry.actorId, cumulative);

            const destroyRound = destroyedAt.get(entry.actorId);
            const alive = destroyRound === undefined || round < destroyRound;

            return {
                actorId: entry.actorId,
                side: entry.side,
                damageDealt: dealt.get(entry.actorId) ?? 0,
                damageTaken: taken,
                healingDone: healDone.get(entry.actorId) ?? 0,
                healingReceived: healReceived.get(entry.actorId) ?? 0,
                shieldsAbsorbed: 0,
                hpPct: clampPct((100 * (entry.maxHp - cumulative)) / entry.maxHp),
                alive,
                activeBuffs: [...(activeBuffs.get(entry.actorId) ?? [])],
                activeDebuffs: [...(activeDebuffs.get(entry.actorId) ?? [])],
            };
        });

        // Readable per-round log: damage (ability-performed), heal (heal-performed),
        // death (ship-destroyed). NOT `attacked` (no amount).
        const log: BattleLogEvent[] = [];
        for (const e of roundEvents) {
            if (e.type === 'ability-performed' && typeof e.damage === 'number') {
                log.push({
                    round,
                    kind: 'damage',
                    actorId: e.actorId,
                    targetId: e.targetId,
                    amount: e.damage,
                });
            } else if (e.type === 'heal-performed') {
                for (const tid of e.targets) {
                    log.push({
                        round,
                        kind: 'heal',
                        actorId: e.casterId,
                        targetId: tid,
                        amount: e.targets.length > 0 ? e.amount / e.targets.length : e.amount,
                    });
                }
                if (e.targets.length === 0) {
                    // Divergence from the aggregation site above: that splits `amount`
                    // across targets, so an empty-targets heal credits nobody's
                    // healingReceived. Here the log instead surfaces a single full-amount
                    // line so the heal is still visible in the per-round log.
                    log.push({ round, kind: 'heal', actorId: e.casterId, amount: e.amount });
                }
            } else if (e.type === 'ship-destroyed') {
                log.push({ round, kind: 'death', actorId: e.actorId });
            }
        }

        rounds.push({ round, ships, events: log });

        // Termination: first round where ALL of one side's actors are destroyed.
        // A side counts as wiped only if it has >=1 member AND all are destroyed —
        // an empty side ([].every(...) === true) must NOT be treated as wiped, or a
        // degenerate single-side roster would award a spurious winner at round 1.
        const isWiped = (side: 'player' | 'enemy'): boolean => {
            const members = roster.filter((r) => r.side === side);
            return (
                members.length > 0 &&
                members.every((r) => {
                    const d = destroyedAt.get(r.actorId);
                    return d !== undefined && d <= round;
                })
            );
        };
        const playerWiped = isWiped('player');
        const enemyWiped = isWiped('enemy');

        if (playerWiped || enemyWiped) {
            lastRound = round;
            // If both wiped in the same round, treat as a draw.
            winner = playerWiped && enemyWiped ? 'draw' : playerWiped ? 'enemy' : 'player';
            break;
        }
    }

    // Trim any rounds after termination (break already stops appending, but guard anyway).
    const trimmed = rounds.filter((r) => r.round <= lastRound);

    return {
        rounds: trimmed,
        outcome: { winner, lastRound },
        roster: roster.map(({ actorId, side, name, position }) => ({
            actorId,
            side,
            name,
            position,
        })),
    };
}

// ===========================================================================
// Task 3: `simulateBattle` — the runCombat wrapper that turns two positioned
// squads into the symmetric BattleResult above. New caller only (no engine
// change) — goldens stay byte-identical.
// ===========================================================================

/** A ship placed on the board for a battle: the ship (skills + base stats +
 *  affinity + raw targeting strings), optional combat-stat overrides (fully derived
 *  stats from the page in PR2; falls back to the ship's baseStats here), and its grid
 *  position (drives the positional combat path on both sides).
 *
 *  WARNING: with no `statOverrides` this resolves to UN-GEARED base stats → combat
 *  results are MEANINGLESS (no gear/refits/engineering). `statOverrides` is kept
 *  optional only for test ergonomics. PR2's page MUST pass fully gear/refit/engineering-
 *  resolved stats (including `speed`) via `statOverrides`. */
export interface BattlePlacement {
    ship: Ship;
    /** Fully-derived combat stats (gear + refits + engineering). `speed` drives turn order.
     *  See the WARNING on `BattlePlacement`: omitting this yields un-geared base stats. */
    statOverrides?: Partial<CombatStatBlock & { speed: number }>;
    position: Position;
}

export interface BattleSimulationInput {
    playerTeam: BattlePlacement[];
    enemyTeam: BattlePlacement[];
    /** Fixed round cap. Default 30. The result is trimmed at the first wipe. */
    rounds?: number;
}

/** The combat stats simulateBattle resolves per placement. Derived from the ship's
 *  baseStats, then `statOverrides` win field-by-field. `speed` drives turn order on
 *  both sides (focus, walked team actors, enemy attackers).
 *
 *  WARNING: with no `statOverrides`, `resolveStats` resolves to UN-GEARED base stats →
 *  combat results are MEANINGLESS (no gear/refits/engineering). PR2's page MUST pass
 *  fully gear/refit/engineering-resolved stats via `statOverrides`. */
interface DerivedCombatStats {
    attack: number;
    crit: number;
    critDamage: number;
    defensePenetration: number;
    hacking: number;
    defence: number;
    hp: number;
    /** Turn-order speed. Defaults to baseStats.speed ?? 100. */
    speed: number;
}

/** Resolve a placement's combat stats: ship.baseStats as the floor (with the page's
 *  magic defaults — hacking ?? 200, speed ?? 100), then `statOverrides` applied
 *  field-by-field.
 *
 *  WARNING: with no `statOverrides` this returns UN-GEARED base stats → combat results
 *  are MEANINGLESS. PR2's page MUST pass fully gear/refit/engineering-resolved stats. */
function resolveStats(p: BattlePlacement): DerivedCombatStats {
    const b = p.ship.baseStats;
    const o = p.statOverrides ?? {};
    return {
        attack: o.attack ?? b.attack ?? 0,
        crit: o.crit ?? b.crit ?? 0,
        critDamage: o.critDamage ?? b.critDamage ?? 0,
        defensePenetration: o.defensePenetration ?? b.defensePenetration ?? 0,
        hacking: o.hacking ?? b.hacking ?? 200,
        defence: o.defence ?? b.defence ?? 0,
        hp: o.hp ?? b.hp ?? 0,
        speed: o.speed ?? b.speed ?? 100,
    };
}

/** Shape `DerivedCombatStats` into the walk bundle's `stats` (player team actors).
 *  Centralized so a future stat addition can't be missed at one of the call sites. */
function toWalkStats(
    stats: DerivedCombatStats
): Pick<
    DerivedCombatStats,
    'attack' | 'crit' | 'critDamage' | 'defensePenetration' | 'hacking' | 'defence' | 'hp' | 'speed'
> {
    return {
        attack: stats.attack,
        crit: stats.crit,
        critDamage: stats.critDamage,
        defensePenetration: stats.defensePenetration,
        hacking: stats.hacking,
        defence: stats.defence,
        hp: stats.hp,
        speed: stats.speed,
    };
}

/** Shape `DerivedCombatStats` into the enemy attacker's `stats` bundle. Centralized so a
 *  future stat addition can't be missed at one of the call sites. */
function toEnemyStats(
    stats: DerivedCombatStats
): Pick<DerivedCombatStats, 'attack' | 'crit' | 'critDamage' | 'speed' | 'defence' | 'hp'> {
    return {
        attack: stats.attack,
        crit: stats.crit,
        critDamage: stats.critDamage,
        speed: stats.speed,
        defence: stats.defence,
        hp: stats.hp,
    };
}

/** Per-placement plan: its minted actor id, derived stats, ship skills, affinity,
 *  parsed active targeting, charge threshold, and its display name for the roster. */
interface PlacementPlan {
    id: string;
    name: string;
    position: Position;
    stats: DerivedCombatStats;
    shipSkills: ReturnType<typeof buildShipAbilities>;
    affinity: AffinityName | undefined;
    /** Parsed ACTIVE targeting ({ target, pattern }); undefined if the ship has no targeting data. */
    targeting: SkillTargeting | undefined;
    chargeCount: number;
}

function planPlacement(p: BattlePlacement, id: string): PlacementPlan {
    const targeting = parseShipTargeting(p.ship);
    // Use the ACTIVE targeting (target + pattern). The engine input takes ONE target/pattern
    // per actor, so charged-skill targeting is a follow-up (PR2) — when a ship's charged
    // skill targets differently the active selection is used for every turn here.
    return {
        id,
        name: p.ship.name,
        position: p.position,
        stats: resolveStats(p),
        shipSkills: buildShipAbilities(p.ship),
        affinity: p.ship.affinity,
        targeting: targeting.active,
        chargeCount: p.ship.chargeSkillCharge ?? 0,
    };
}

/**
 * Thin adapter over the combat engine: positions two squads, runs a fixed-round mutual
 * battle through `runCombat`, and assembles the symmetric `BattleResult` from the event
 * stream + per-round per-victim damage.
 *
 * Side mapping (mirrors how the DPS/healing adapters feed the engine):
 *   - player[0]  → the focus `attacker` (its stats/position/target/pattern ride the top-level input).
 *   - player[1+] → `teamActors`, each with a `walk` bundle (own stats + skills + affinity-resolved
 *                  rates), position, target, pattern.
 *   - enemyTeam  → `enemyAttackers`, each with stats + shipSkills + position/target/pattern.
 *
 * `healTargetId` is set to the focus player actor's id as a VESTIGIAL workaround: the engine only
 * builds the positioned enemy roster (and lets enemies fire on players) when `healTargetId` is set
 * — it throws otherwise. The battle is driven by positions on both sides, not by the heal pipeline,
 * which stays inert beyond unlocking the enemy roster.
 *
 * Affinity: each actor's matchup is resolved against the FIRST opposing placement's affinity (the
 * single-opponent-affinity convention the DPS/healing adapters already use). The RAW affinity is
 * also threaded so the engine's positional path and the pre-resolved modifiers never disagree.
 *
 * Actor ids are minted globally-unique across both squads (`p:<shipId>:<idx>` / `e:<shipId>:<idx>`),
 * avoiding the reserved `'attacker'`/`'enemy'` ids and any duplicate (runCombat throws on either).
 */
export function simulateBattle(input: BattleSimulationInput): BattleResult {
    const numRounds = input.rounds ?? 30;

    // The engine's focus actor is ALWAYS the reserved id `'attacker'` (its damage/per-victim
    // rows key off it), so player[0] must carry that id — minting `p:...` for it and pointing
    // healTargetId there fails the engine's "is a player actor" check. The REST of the player
    // team + every enemy get minted globally-unique ids that avoid `'attacker'`/`'enemy'`.
    const FOCUS_ID = 'attacker';
    const playerPlans = input.playerTeam.map((p, i) =>
        planPlacement(p, i === 0 ? FOCUS_ID : `p:${p.ship.id}:${i}`)
    );
    const enemyPlans = input.enemyTeam.map((p, i) => planPlacement(p, `e:${p.ship.id}:${i}`));

    // Representative opposing affinity for each side's matchup resolution (first opponent).
    const enemyRepAffinity = enemyPlans[0]?.affinity;
    const playerRepAffinity = playerPlans[0]?.affinity;

    // Landing chance from an actor's hacking vs the opposing security. baseStats carry a
    // `security` field; the enemy/player representative security drives the clamp. Default 100.
    const enemyRepSecurity = input.enemyTeam[0]?.ship.baseStats.security ?? 100;
    const playerRepSecurity = input.playerTeam[0]?.ship.baseStats.security ?? 100;

    const landingChance = (
        plan: PlacementPlan,
        aff: ReturnType<typeof computeAffinityModifiers>,
        defenderSecurity: number
    ): number => {
        const effectiveHacking = plan.stats.hacking * (1 + aff.damageModifier / 100);
        return Math.min(100, Math.max(0, effectiveHacking - defenderSecurity)) / 100;
    };

    const hasCharged = (plan: PlacementPlan): boolean => {
        const charged = selectFiringSkill(plan.shipSkills, 'charged');
        return plan.chargeCount >= 1 && (charged?.abilities.length ?? 0) > 0;
    };

    // ----- Focus player actor (player[0]) -----
    const focus = playerPlans[0];
    if (!focus) {
        throw new Error('simulateBattle: playerTeam must contain at least one placement');
    }
    const focusAff = computeAffinityModifiers(focus.affinity, enemyRepAffinity);
    const focusLanding = landingChance(focus, focusAff, enemyRepSecurity);

    // ----- The rest of the player team → walked teamActors -----
    const teamActors: TeamActorEngineInput[] = playerPlans.slice(1).map((plan) => {
        const aff = computeAffinityModifiers(plan.affinity, enemyRepAffinity);
        return {
            id: plan.id,
            speed: plan.stats.speed,
            chargeCount: plan.chargeCount,
            startCharged: false,
            selfBuffs: [],
            enemyDebuffs: [],
            position: plan.position,
            target: plan.targeting?.target,
            pattern: plan.targeting?.pattern,
            walk: {
                shipSkills: plan.shipSkills,
                stats: toWalkStats(plan.stats),
                debuffLandingChance: landingChance(plan, aff, enemyRepSecurity),
                selfDotModifier: 0,
                defensePenetrationBuff: 0,
                affinityDamageModifier: aff.damageModifier,
                affinityCritCap: aff.critCap,
                affinityCritPenalty: aff.critPenalty,
                affinity: plan.affinity,
                hasChargedSkill: hasCharged(plan),
            },
        };
    });

    // ----- Enemy team → enemyAttackers -----
    const enemyAttackers: NonNullable<CombatEngineInput['enemyAttackers']> = enemyPlans.map(
        (plan) => {
            const aff = computeAffinityModifiers(plan.affinity, playerRepAffinity);
            return {
                id: plan.id,
                stats: toEnemyStats(plan.stats),
                chargeCount: plan.chargeCount,
                startCharged: false,
                shipSkills: plan.shipSkills,
                affinityDamageModifier: aff.damageModifier,
                affinityCritCap: aff.critCap,
                affinityCritPenalty: aff.critPenalty,
                debuffLandingChance: landingChance(plan, aff, playerRepSecurity),
                position: plan.position,
                target: plan.targeting?.target,
                pattern: plan.targeting?.pattern,
                affinity: plan.affinity,
            };
        }
    );

    // ----- Capture the event stream + run -----
    const bus = createEventBus();
    const events: CombatEvent[] = [];
    // Subscribe exactly the events the assembler consumes (shared list — can't drift).
    for (const t of ASSEMBLED_EVENT_TYPES) {
        bus.on(t, (e) => events.push(e as CombatEvent));
    }

    const { rounds: engineRounds } = runCombat({
        attack: focus.stats.attack,
        crit: focus.stats.crit,
        critDamage: focus.stats.critDamage,
        defensePenetration: focus.stats.defensePenetration,
        chargeCount: focus.chargeCount,
        shipSkills: focus.shipSkills,
        // The dummy player-offense enemy target (vestigial alongside the positioned roster):
        // a huge HP / 0 defence punching bag — the real per-victim damage flows positionally.
        enemyDefense: 0,
        enemyHp: 1_000_000_000,
        numRounds,
        selfBuffs: [],
        enemyDebuffs: [],
        debuffLandingChance: focusLanding,
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        hasChargedSkill: hasCharged(focus),
        startCharged: false,
        affinityDamageModifier: focusAff.damageModifier,
        affinityCritCap: focusAff.critCap,
        affinityCritPenalty: focusAff.critPenalty,
        affinity: focus.affinity,
        defence: focus.stats.defence,
        hp: focus.stats.hp,
        speed: focus.stats.speed,
        position: focus.position,
        target: focus.targeting?.target,
        pattern: focus.targeting?.pattern,
        // VESTIGIAL: enemyAttackers only populate (and enemies only fire on players) when
        // healTargetId is set — the engine throws otherwise. Point it at the focus player id.
        healTargetId: focus.id,
        teamActors,
        enemyAttackers,
        bus,
    });

    // Per-round per-victim damage, keyed by each returned round's own `round` field
    // (the rows are player-centric but each carries the round's full perTargetDamage map).
    const perRoundPerTarget: Record<number, Record<string, number>> = {};
    for (const rd of engineRounds) {
        perRoundPerTarget[rd.round] = rd.perTargetDamage ?? {};
    }

    // Roster: every placed ship, with maxHp from its derived stats.
    const roster: RosterEntry[] = [
        ...playerPlans.map((plan) => ({
            actorId: plan.id,
            side: 'player' as const,
            name: plan.name,
            position: plan.position,
            maxHp: plan.stats.hp,
        })),
        ...enemyPlans.map((plan) => ({
            actorId: plan.id,
            side: 'enemy' as const,
            name: plan.name,
            position: plan.position,
            maxHp: plan.stats.hp,
        })),
    ];

    return assembleBattleResult({ events, perRoundPerTarget, roster, numRounds });
}
