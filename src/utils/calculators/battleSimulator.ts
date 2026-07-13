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
 *   - buffs = `buff-applied` / `buff-expired` / `debuff-applied` / `dot-applied`.
 *
 * The per-round event LOG is a CHRONOLOGICAL (emission-order) play-by-play, team-labeled
 * at render time. It walks the round's events in bus-emission order and emits one line per
 * relevant event: turn delimiters (`turn-started`), ATTACKER-centric damage (from
 * `ability-performed` — actorId=attacker, targetId, amount; dummy-'enemy' target lines are
 * kept), heals, buffs, debuffs, dots, deaths. (The dummy-'enemy' targetId on ally/self-
 * targeting ships means some damage lines read as "X → enemy"; that's accepted — the
 * per-victim unification is a deferred follow-up.)
 *
 * HP% is derived as maxHp minus cumulative actual HP loss (from perRoundPerIncoming when
 * present — post-shield/barrier HP damage — plus healing received), falling back to raw
 * perTargetDamage only when no incoming bucket exists for that actor (legacy goldens).
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
import type { CombatStatBlock, DoTType } from '../../types/calculator';
import { runCombat, CombatEngineInput, TeamActorEngineInput } from '../combat/engine';
import { createEventBus } from '../combat/events';
import { buildShipAbilities } from '../abilities/buildShipAbilities';
import { buildShipAbilitiesWithEquipment } from '../abilities/buildShipAbilitiesWithEquipment';
import type { ShipSkills } from '../../types/abilities';
import type { GearPiece } from '../../types/gear';
import { selectFiringSkill } from '../abilities/applyAbilities';
import { parseShipTargeting, SkillTargeting } from '../targetingParser';
import { buildCombatLog } from '../combat/log/buildCombatLog';
import type { CombatLogRound } from '../combat/log/types';
import type { FactionName } from '../../constants/factions';
import {
    runPreFight,
    squadLeaderPass,
    emptyPreFightModifiers,
    hasAnyPreFightModifier,
    type PreFightCombatModifiers,
    type PreFightUnit,
    type SquadLeaderSelection,
} from '../combat/preFight';
import { applyPreCombatShipPassives } from '../combat/preCombatPassives';
import { detectFullyCharged } from '../skillTextParser';
import { getShipSkillRows } from '../ship/skillRows';
import type { ShipTypeName } from '../../constants/shipTypes';
import { computeAffinityModifiers } from './affinityUtils';

/** A stack-independent debuff-badge label for a DoT family, so DoTs surface in a ship's
 *  `activeDebuffs` list like any other debuff. Stack-independent on purpose: `activeDebuffs`
 *  is a de-duplicating set, so a per-application "×N" suffix would proliferate a new chip on
 *  every re-application. (The chronological combat log keeps the "dotType ×stacks" detail.) */
const DOT_DEBUFF_LABELS: Record<DoTType, string> = {
    corrosion: 'Corrosion',
    inferno: 'Inferno',
    bomb: 'Bomb',
    generic: 'Damage over Time',
};

export interface ShipRoundState {
    actorId: string;
    side: 'player' | 'enemy';
    /**
     * Attacker's per-turn aggregate (`ability-performed.damage` by `actorId`, anchor full).
     * Uses a DIFFERENT base from `damageTaken` (which is per-victim from `perTargetDamage`,
     * AoE origin full / covered half), so they are NOT expected to reconcile: under AoE,
     * `Σ damageDealt ≠ Σ damageTaken` — by design. (Per-hit/per-victim event fidelity is a
     * deferred follow-up.)
     */
    damageDealt: number;
    /**
     * Per-victim damage from `perRoundPerTarget[round][victimId]` (AoE origin full / covered
     * half). Uses a DIFFERENT base from `damageDealt` (the attacker's per-turn aggregate), so
     * the two do NOT reconcile under AoE — see `damageDealt`.
     */
    damageTaken: number;
    healingDone: number;
    /**
     * Heal `amount` split EVENLY across the heal's targets — the `heal-performed` event
     * carries no per-recipient breakdown, so this is an approximation (not a true per-recipient
     * amount).
     */
    healingReceived: number;
    /** Shield absorption this round (damage intercepted by the shield pool before reaching HP). */
    shieldsAbsorbed: number;
    /** Shield pool granted to this actor this round (post-cap delta). */
    shieldGranted: number;
    /** Remaining shield pool at end of this round. */
    currentShieldPool: number;
    /**
     * Per-victim incoming damage-taken this round (HP damage actually landed), from
     * `perRoundPerIncoming[round][victimId].incoming`. Parallel to the shield fields and sourced
     * from the engine's per-victim `perActorIncoming` map. Covered AoE victims carry their own
     * bucket. 0 when the actor took no recorded intake this round.
     */
    incomingDamage: number;
    /** Shield drained by this round's incoming damage (perActorIncoming.shieldAbsorbed). */
    incomingShieldAbsorbed: number;
    /** Barrier drained by this round's incoming damage (perActorIncoming.barrierAbsorbed). */
    incomingBarrierAbsorbed: number;
    /** End-of-round HP%, from maxHp minus cumulative HP loss (incoming HP damage, net of healing). */
    hpPct: number;
    shieldPct: number;
    alive: boolean;
    activeBuffs: string[];
    /**
     * Infliction-only: there is no `debuff-expired` event in the stream, so once a debuff is
     * added it accumulates and persists for the rest of the battle. This is asymmetric with
     * `activeBuffs`, which DOES expire via `buff-expired`. Consumers should not expect debuffs
     * to clear over time.
     */
    activeDebuffs: string[];
}

export interface BattleRound {
    round: number;
    ships: ShipRoundState[];
    /**
     * Distinct acting `actorId`s for this round in true speed order (emission order of
     * `turn-started`). Only roster actorIds — the dummy player-offense `'enemy'` id is
     * filtered out since it's not on the board.
     */
    turnOrder: string[];
}

export interface BattleResult {
    /** Trimmed at termination (no rounds after outcome.lastRound). */
    rounds: BattleRound[];
    outcome: { winner: 'player' | 'enemy' | 'draw'; lastRound: number };
    roster: Array<{ actorId: string; side: 'player' | 'enemy'; name: string; position: Position }>;
    /**
     * Rich, hierarchical play-by-play folded from the raw CombatEvent stream by
     * `buildCombatLog`. Spans ALL rounds and carries its own `round` numbers (NOT
     * trimmed in lockstep with `rounds`). Additive — does not affect DPS/healing math.
     */
    combatLog: CombatLogRound[];
    /**
     * Pre-fight effects that landed on an actor but are NOT simulated (yet): squad-leader
     * conditional/'other'/per-round lines, plus — until PR F3 consumes them — the modifier-
     * channel lines. Present ONLY when a squad leader was selected AND at least one such
     * text was recorded, so a no-leader run's result stays deep-equal to the pre-F shape.
     */
    preFight?: { unsimulated: { actorId: string; name: string; texts: string[] }[] };
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
 * The CombatEvent types `assembleBattleResult` folds into its per-round damage/heal/buff
 * aggregates. `simulateBattle` subscribes from the broader `LOG_EVENT_TYPES` (a superset of
 * this list) so the combatLog builder also gets its events; this list documents — and a
 * `satisfies` guards — the assembler's own consumed subset so the two never drift apart.
 */
export const ASSEMBLED_EVENT_TYPES = [
    'ability-performed',
    'heal-performed',
    'ship-destroyed',
    'buff-applied',
    'buff-expired',
    'debuff-applied',
    'dot-applied',
    'turn-started',
] as const satisfies readonly CombatEvent['type'][];

/**
 * The full set of event types captured for the hierarchical `combatLog` builder
 * (`buildCombatLog`). Superset of `ASSEMBLED_EVENT_TYPES` — adds the round/turn boundaries,
 * per-hit (`attacked`/`hp-changed`), charge, shield, and effect events the builder folds.
 * `simulateBattle` subscribes from THIS list so the builder sees the complete stream while
 * the assembler's own type-guarded loops simply ignore the extra event types.
 */
export const LOG_EVENT_TYPES = [
    'round-started',
    'round-ended',
    'turn-started',
    'turn-ended',
    'skill-fired',
    'charge-changed',
    'ability-performed',
    'attacked',
    'hp-changed',
    'heal-performed',
    'shield-applied',
    'buff-applied',
    'buff-expired',
    'debuff-applied',
    'dot-applied',
    'dot-ticked',
    'dot-detonated',
    'bomb-detonated',
    'control-applied',
    'cleanse-performed',
    'purge-performed',
    'ship-destroyed',
    // Log-only reactive procs (drain-time damage/heal that emit no ability-performed/heal-performed).
    'reactive-damage-performed',
    'reactive-heal-performed',
    // Task 6: log-only per-turn acting-actor stat snapshot (no listener subscribes).
    'stats-snapshot',
] as const satisfies readonly CombatEvent['type'][];

// Compile-time proof that LOG_EVENT_TYPES ⊇ ASSEMBLED_EVENT_TYPES (bus subscribes to LOG;
// assembler reads ASSEMBLED). If an ASSEMBLED type is removed from LOG this becomes `never`
// and the assignment below fails to compile.
type _AssertLogSupersetOfAssembled =
    (typeof ASSEMBLED_EVENT_TYPES)[number] extends (typeof LOG_EVENT_TYPES)[number] ? true : never;
const _checkLogSuperset: _AssertLogSupersetOfAssembled = true;

/**
 * Precondition: expects BOTH sides of `roster` to be non-empty. The wipe checks guard
 * against empty sides (a side with zero members is never treated as "wiped"), so a
 * degenerate single-side roster fails safe to `draw` at numRounds rather than awarding
 * a spurious winner at round 1.
 */
export function assembleBattleResult(args: {
    events: CombatEvent[];
    perRoundPerTarget: Record<number, Record<string, number>>;
    perRoundPerShield?: Record<
        number,
        Record<string, { granted: number; absorbed: number; pool: number }>
    >;
    perRoundPerIncoming?: Record<
        number,
        Record<string, { incoming: number; shieldAbsorbed: number; barrierAbsorbed: number }>
    >;
    roster: RosterEntry[];
    numRounds: number;
    /**
     * Per-actor pre-combat charge state for the hierarchical `combatLog`:
     * `charge` = initial/seeded charges (0 if none), `max` = charge-skill cap (0 if no
     * charge skill). Cosmetic (drives the per-turn charge header); defaults to an empty
     * map (all actors render charge 0/0) when omitted.
     */
    initialCharge?: Map<string, { charge: number; max: number }>;
}): BattleResult {
    const {
        events,
        perRoundPerTarget,
        perRoundPerShield = {},
        perRoundPerIncoming = {},
        roster,
        numRounds,
        initialCharge = new Map<string, { charge: number; max: number }>(),
    } = args;

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

    // Cumulative raw perTargetDamage per actor (damageTaken stat only — not used for HP%).
    const cumulativeTaken = new Map<string, number>();
    // Cumulative actual HP loss per actor (post-shield/barrier incoming, or raw fallback).
    const cumulativeHpLost = new Map<string, number>();
    // Cumulative healing received per actor (approximation from heal-performed splits).
    const cumulativeHealed = new Map<string, number>();

    // Roster id set: turn-started for a non-roster id (the dummy player-offense 'enemy')
    // is filtered out of turnOrder since it's not on the board.
    const rosterIds = new Set(roster.map((r) => r.actorId));

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
            } else if (e.type === 'dot-applied') {
                // DoTs are debuffs too — surface them in the victim's debuff list (infliction-only,
                // like debuff-applied). Labeled by family so re-applications collapse to one chip.
                ensure(activeDebuffs, e.targetId).add(DOT_DEBUFF_LABELS[e.dotType]);
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
        const shieldThisRound = perRoundPerShield[round] ?? {};
        const incomingThisRound = perRoundPerIncoming[round] ?? {};

        const ships: ShipRoundState[] = roster.map((entry) => {
            const taken = takenThisRound[entry.actorId] ?? 0;
            const cumulativeRaw = (cumulativeTaken.get(entry.actorId) ?? 0) + taken;
            cumulativeTaken.set(entry.actorId, cumulativeRaw);

            const destroyRound = destroyedAt.get(entry.actorId);
            const alive = destroyRound === undefined || round < destroyRound;

            const shield = shieldThisRound[entry.actorId];
            const incoming = incomingThisRound[entry.actorId];
            const incomingHpThisRound = incoming
                ? Math.max(
                      0,
                      incoming.incoming - incoming.shieldAbsorbed - incoming.barrierAbsorbed
                  )
                : taken;
            const hpLost = (cumulativeHpLost.get(entry.actorId) ?? 0) + incomingHpThisRound;
            cumulativeHpLost.set(entry.actorId, hpLost);
            const healedThisRound = healReceived.get(entry.actorId) ?? 0;
            const healed = (cumulativeHealed.get(entry.actorId) ?? 0) + healedThisRound;
            cumulativeHealed.set(entry.actorId, healed);

            return {
                actorId: entry.actorId,
                side: entry.side,
                damageDealt: dealt.get(entry.actorId) ?? 0,
                damageTaken: taken,
                healingDone: healDone.get(entry.actorId) ?? 0,
                healingReceived: healedThisRound,
                shieldsAbsorbed: shield?.absorbed ?? 0,
                shieldGranted: shield?.granted ?? 0,
                currentShieldPool: shield?.pool ?? 0,
                incomingDamage: incomingHpThisRound,
                incomingShieldAbsorbed: incoming?.shieldAbsorbed ?? 0,
                incomingBarrierAbsorbed: incoming?.barrierAbsorbed ?? 0,
                hpPct:
                    entry.maxHp > 0
                        ? clampPct((100 * (entry.maxHp - hpLost + healed)) / entry.maxHp)
                        : 0,
                shieldPct:
                    shield?.pool > 0 ? clampPct((100 * (shield?.pool ?? 0)) / entry.maxHp) : 0,
                alive,
                activeBuffs: [...(activeBuffs.get(entry.actorId) ?? [])],
                activeDebuffs: [...(activeDebuffs.get(entry.actorId) ?? [])],
            };
        });

        // Per-round turn order: distinct acting roster actorIds in `turn-started` emission
        // order (true speed order). Dummy/non-roster ids are dropped.
        const turnOrder: string[] = [];
        const seenActors = new Set<string>();
        for (const e of roundEvents) {
            if (
                e.type === 'turn-started' &&
                rosterIds.has(e.actorId) &&
                !seenActors.has(e.actorId)
            ) {
                seenActors.add(e.actorId);
                turnOrder.push(e.actorId);
            }
        }

        rounds.push({ round, ships, turnOrder });

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

    // Rich hierarchical play-by-play folded from the SAME raw event stream. `roster`
    // (RosterEntry) is a structural superset of the builder's `{actorId, side, name}`
    // RosterEntry, so it passes directly. `initialCharge` seeds the per-turn charge header.
    const combatLog = buildCombatLog(events, roster, initialCharge);

    return {
        rounds: trimmed,
        outcome: { winner, lastRound },
        roster: roster.map(({ actorId, side, name, position }) => ({
            actorId,
            side,
            name,
            position,
        })),
        combatLog,
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
    /** Player-side squad leader (pre-fight faction aura). Absent → no pre-fight change. */
    playerSquadLeader?: SquadLeaderSelection;
    /** Enemy-side squad leader (pre-fight faction aura). Absent → no pre-fight change. */
    enemySquadLeader?: SquadLeaderSelection;
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
    /** Shield penetration (H1 Task 2). Optional — sourced from ship.baseStats / statOverrides.
     *  Defaults to 0 at the actor-construction site. No production reader until H1 Task 4. */
    shieldPenetration: number;
    hacking: number;
    /** Debuff-resist stat. Defaults to baseStats.security ?? 100 (the OLD landing-formula default). */
    security: number;
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
        shieldPenetration: o.shieldPenetration ?? b.shieldPenetration ?? 0,
        hacking: o.hacking ?? b.hacking ?? 200,
        security: o.security ?? b.security ?? 100,
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
    | 'attack'
    | 'crit'
    | 'critDamage'
    | 'defensePenetration'
    | 'shieldPenetration'
    | 'hacking'
    | 'security'
    | 'defence'
    | 'hp'
    | 'speed'
> {
    return {
        attack: stats.attack,
        crit: stats.crit,
        critDamage: stats.critDamage,
        defensePenetration: stats.defensePenetration,
        shieldPenetration: stats.shieldPenetration,
        hacking: stats.hacking,
        security: stats.security,
        defence: stats.defence,
        hp: stats.hp,
        speed: stats.speed,
    };
}

/** Shape `DerivedCombatStats` into the enemy attacker's `stats` bundle. Centralized so a
 *  future stat addition can't be missed at one of the call sites. */
function toEnemyStats(
    stats: DerivedCombatStats
): Pick<
    DerivedCombatStats,
    | 'attack'
    | 'crit'
    | 'critDamage'
    | 'speed'
    | 'defence'
    | 'hp'
    | 'hacking'
    | 'security'
    | 'shieldPenetration'
> {
    return {
        attack: stats.attack,
        crit: stats.crit,
        critDamage: stats.critDamage,
        speed: stats.speed,
        defence: stats.defence,
        hp: stats.hp,
        // Base hacking/security (A2 Task 4): the enemy attacker folds ITS hacking when attacking
        // and ITS security when targeted, so the engine's live landing recompute has real inputs.
        hacking: stats.hacking,
        security: stats.security,
        shieldPenetration: stats.shieldPenetration,
    };
}

/** Per-placement plan: its minted actor id, derived stats, ship skills, affinity,
 *  parsed active targeting, charge threshold, and its display name for the roster. */
interface PlacementPlan {
    id: string;
    name: string;
    position: Position;
    /** Ship faction — drives the pre-fight squad-leader aura's faction gating. */
    faction: FactionName;
    /** Ship role — gates role-conditional pre-fight ship passives (Enforcer/Defiant/Stalwart). */
    role: ShipTypeName | undefined;
    stats: DerivedCombatStats;
    shipSkills: ShipSkills;
    affinity: AffinityName | undefined;
    /** Parsed ACTIVE targeting ({ target, pattern }); undefined if the ship has no targeting data. */
    targeting: SkillTargeting | undefined;
    /** Parsed CHARGED targeting when it differs from active; otherwise same as active. */
    chargedTargeting: SkillTargeting | undefined;
    chargeCount: number;
    /** True when a refit-active skill row declares the ship "starts combat fully charged"
     *  (Chimei). Seeds `charges = chargeCount` on the engine actor + the initialCharge map. */
    startCharged: boolean;
}

function planPlacement(
    p: BattlePlacement,
    id: string,
    getGearPiece?: (id: string) => GearPiece | undefined
): PlacementPlan {
    const targeting = parseShipTargeting(p.ship);
    // Use the ACTIVE targeting (target + pattern). Charged targeting is threaded separately
    // for support footprint resolution when the charged skill fires.
    return {
        id,
        name: p.ship.name,
        position: p.position,
        faction: p.ship.faction,
        role: p.ship.type,
        stats: resolveStats(p),
        shipSkills: getGearPiece
            ? buildShipAbilitiesWithEquipment(p.ship, getGearPiece)
            : buildShipAbilities(p.ship),
        affinity: p.ship.affinity,
        targeting: targeting.active,
        chargedTargeting: targeting.charged ?? targeting.active,
        chargeCount: p.ship.chargeSkillCharge ?? 0,
        // Chimei "starts combat fully charged": detected over the REFIT-RESOLVED skill rows
        // (getShipSkillRows returns only the refit-active passive), so a below-threshold
        // refit count automatically drops the declaring passive and the ship starts at 0.
        startCharged: detectFullyCharged(getShipSkillRows(p.ship).map((r) => r.text)),
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
 * The battle is driven by positions on both sides. `positionalTeamBattle: true` is the single
 * signal the engine keys on (SP-U U5 R6 decouple): it builds the positioned enemy roster from the
 * enemyAttackers presence, lets enemies fire on players, and runs the real-vs-real heal/shield
 * pipeline (heals route to the lowest-HP living ally) — no `healTargetId` is passed.
 *
 * Affinity: each actor's matchup is resolved against the FIRST opposing placement's affinity (the
 * single-opponent-affinity convention the DPS/healing adapters already use). The RAW affinity is
 * also threaded so the engine's positional path and the pre-resolved modifiers never disagree.
 *
 * Actor ids are minted globally-unique across both squads (`p:<shipId>:<idx>` / `e:<shipId>:<idx>`),
 * avoiding the reserved `'attacker'`/`'enemy'` ids and any duplicate (runCombat throws on either).
 */
export function simulateBattle(
    input: BattleSimulationInput,
    getGearPiece?: (id: string) => GearPiece | undefined
): BattleResult {
    // Validate inputs up front (trust boundary): empty teams or a bad round count
    // would otherwise flow through and produce misleading draw/empty outcomes.
    if (input.playerTeam.length === 0) {
        throw new Error('simulateBattle: playerTeam is empty');
    }
    if (input.enemyTeam.length === 0) {
        throw new Error('simulateBattle: enemyTeam is empty');
    }
    const numRounds = input.rounds ?? 30;
    if (input.rounds !== undefined && (!Number.isInteger(numRounds) || numRounds < 1)) {
        throw new Error('simulateBattle: rounds must be a positive integer');
    }

    // The engine's focus actor is ALWAYS the reserved id `'attacker'` (its damage/per-victim
    // rows key off it), so player[0] must carry that id. The REST of the player team + every
    // enemy get minted globally-unique ids that avoid `'attacker'`/`'enemy'`.
    const FOCUS_ID = 'attacker';
    const playerPlans = input.playerTeam.map((p, i) =>
        planPlacement(p, i === 0 ? FOCUS_ID : `p:${p.ship.id}:${i}`, getGearPiece)
    );
    const enemyPlans = input.enemyTeam.map((p, i) =>
        planPlacement(p, `e:${p.ship.id}:${i}`, getGearPiece)
    );

    // ----- Pre-fight layer (sub-project F): squad-leader auras, then ship passives -----
    // Each PreFightUnit shares its PLAN's stats object BY REFERENCE, so the pass mutates
    // the plan stats in place — actor construction, roster maxHp, and turn order below
    // all inherit the modified values automatically. With neither leader selected the
    // pass touches nothing, keeping a no-leader run byte-identical (golden safety).
    const toPreFightUnit = (plan: PlacementPlan, side: 'player' | 'enemy'): PreFightUnit => ({
        id: plan.id,
        side,
        faction: plan.faction,
        stats: plan.stats,
        modifiers: emptyPreFightModifiers(),
        unsimulated: [],
    });
    const preFightPlayer = playerPlans.map((plan) => toPreFightUnit(plan, 'player'));
    const preFightEnemy = enemyPlans.map((plan) => toPreFightUnit(plan, 'enemy'));
    runPreFight({ player: preFightPlayer, enemy: preFightEnemy }, [
        squadLeaderPass({ player: input.playerSquadLeader, enemy: input.enemySquadLeader }),
    ]);
    // Pre-fight step 2 (F5) — ship passives (Lionheart/Centurion/Enforcer/Defiant/Stalwart),
    // run per side (passives never cross sides) AFTER the squad-leader pass per the spec's
    // ordering rule: each grant computes from the frozen POST-LEADER snapshot (simultaneous —
    // no grant sees another's output). Mutates the same by-reference plan stats; a squad with
    // no pre-combat passives is an exact no-op (golden safety).
    applyPreCombatShipPassives(playerPlans);
    applyPreCombatShipPassives(enemyPlans);
    // Kept for the modifier attachment below (F3) and the result's `preFight.unsimulated` block.
    const preFightById = new Map<string, PreFightUnit>(
        [...preFightPlayer, ...preFightEnemy].map((u) => [u.id, u])
    );
    // F3: a unit's accumulated modifier channels ride onto its engine actor as the
    // `preFight` baseline — but ONLY when at least one channel is non-zero, so a no-leader
    // or stat-only-leader run passes NO preFight key anywhere (all engine folds inert →
    // byte-identical to pre-F3 by construction).
    const preFightModifiersFor = (
        id: string
    ): { preFight: PreFightCombatModifiers } | Record<string, never> => {
        const m = preFightById.get(id)?.modifiers;
        return m && hasAnyPreFightModifier(m) ? { preFight: m } : {};
    };

    // Representative opposing affinity for each side's matchup resolution (first opponent).
    const enemyRepAffinity = enemyPlans[0]?.affinity;
    const playerRepAffinity = playerPlans[0]?.affinity;

    // Representative enemy security (threaded onto the dummy target for live landing recompute).
    const enemyRepSecurity = input.enemyTeam[0]?.ship.baseStats.security ?? 100;

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

    // ----- The rest of the player team → walked teamActors -----
    const teamActors: TeamActorEngineInput[] = playerPlans.slice(1).map((plan) => {
        const aff = computeAffinityModifiers(plan.affinity, enemyRepAffinity);
        return {
            id: plan.id,
            speed: plan.stats.speed,
            chargeCount: plan.chargeCount,
            startCharged: plan.startCharged,
            selfBuffs: [],
            enemyDebuffs: [],
            ...preFightModifiersFor(plan.id),
            position: plan.position,
            target: plan.targeting?.target,
            pattern: plan.targeting?.pattern,
            chargedPattern: plan.chargedTargeting?.pattern,
            // SP-F F5: thread the ship role (Ship.type) for role-filtered classification
            // (Meatshield defense-substitution's "non-defender ally" gate).
            role: plan.role,
            // SP-F F4: thread the ship name for the live `ally-on-team` roster check
            // (Isha/Nayra reciprocal Affinity Override gate).
            name: plan.name,
            // §4.5 Akula exception: thread doesntBreakStasis from ShipSkills.
            doesntBreakStasis: plan.shipSkills.doesntBreakStasis,
            chargeLossImmune: plan.shipSkills.chargeLossImmune,
            walk: {
                shipSkills: plan.shipSkills,
                stats: toWalkStats(plan.stats),
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
                startCharged: plan.startCharged,
                shipSkills: plan.shipSkills,
                ...preFightModifiersFor(plan.id),
                // SP-F F5: thread the ship role (Ship.type) for role-filtered classification
                // (Meatshield defense-substitution's "non-defender ally" gate). Team symmetry
                // with the teamActors branch above.
                role: plan.role,
                // SP-F F4: thread the ship name for the live `ally-on-team` roster check.
                name: plan.name,
                // §4.5 Akula exception: thread doesntBreakStasis from ShipSkills into the
                // engine input so the break-mark gate reads the flag from the CombatActor.
                doesntBreakStasis: plan.shipSkills.doesntBreakStasis,
                chargeLossImmune: plan.shipSkills.chargeLossImmune,
                affinityDamageModifier: aff.damageModifier,
                affinityCritCap: aff.critCap,
                affinityCritPenalty: aff.critPenalty,
                position: plan.position,
                target: plan.targeting?.target,
                pattern: plan.targeting?.pattern,
                chargedPattern: plan.chargedTargeting?.pattern,
                affinity: plan.affinity,
            };
        }
    );

    // ----- Capture the event stream + run -----
    const bus = createEventBus();
    const events: CombatEvent[] = [];
    // Subscribe the SUPERSET of (a) the events `assembleBattleResult` folds for its damage/
    // heal/buff aggregates and (b) the events `buildCombatLog` folds into the hierarchical
    // combatLog (round/turn boundaries, attacked/hp-changed, charge, shields, effects). The
    // assembler's own loops guard by `e.type`, so the extra builder-only events are inert there.
    for (const t of LOG_EVENT_TYPES) {
        bus.on(t, (e) => events.push(e as CombatEvent));
    }

    const { rounds: engineRounds } = runCombat({
        attack: focus.stats.attack,
        crit: focus.stats.crit,
        critDamage: focus.stats.critDamage,
        defensePenetration: focus.stats.defensePenetration,
        shieldPenetration: focus.stats.shieldPenetration,
        chargeCount: focus.chargeCount,
        shipSkills: focus.shipSkills,
        // The dummy player-offense enemy target (vestigial alongside the positioned roster):
        // a huge HP / 0 defence punching bag — the real per-victim damage flows positionally.
        enemyDefense: 0,
        enemyHp: 1_000_000_000,
        numRounds,
        selfBuffs: [],
        enemyDebuffs: [],
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        hasChargedSkill: hasCharged(focus),
        startCharged: focus.startCharged,
        affinityDamageModifier: focusAff.damageModifier,
        affinityCritCap: focusAff.critCap,
        affinityCritPenalty: focusAff.critPenalty,
        affinity: focus.affinity,
        defence: focus.stats.defence,
        hp: focus.stats.hp,
        speed: focus.stats.speed,
        // Base hacking/security so the engine's live landing recompute has real inputs for
        // the focus actor and the vestigial dummy enemy. The dummy carries the representative
        // enemy security (first opponent). When the focus targets a POSITIONED enemy with
        // differing security, the live recompute resolves against that actual target's security
        // and therefore differs from the representative-security basis — the intended per-target
        // behaviour covered by the heterogeneous-security team-vs-team test in twoTeamBattle.test.ts.
        hacking: focus.stats.hacking,
        security: focus.stats.security,
        enemySecurity: enemyRepSecurity,
        position: focus.position,
        target: focus.targeting?.target,
        pattern: focus.targeting?.pattern,
        chargedPattern: focus.chargedTargeting?.pattern,
        // SP-F F5: thread the focus actor's ship role (Ship.type) for role-filtered
        // classification (Meatshield defense-substitution's "non-defender ally" gate). Team
        // symmetry with the teamActors/enemyAttackers branches above.
        role: focus.role,
        // SP-F F4: thread the focus actor's ship name for the live `ally-on-team` roster check.
        name: focus.name,
        // §4.5 Akula exception: thread doesntBreakStasis from ShipSkills.
        doesntBreakStasis: focus.shipSkills.doesntBreakStasis,
        chargeLossImmune: focus.shipSkills.chargeLossImmune,
        ...preFightModifiersFor(focus.id),
        // Positional team battle: the engine builds the positioned enemy roster from the
        // enemyAttackers presence and runs the heal/shield pipeline off this flag (SP-U U5 R6
        // decouple — no vestigial `healTargetId` needed). A player single-`ally` heal/shield
        // resolves the lowest-HP living player ally (team-symmetric with the enemy side).
        positionalTeamBattle: true,
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

    // Per-round per-actor shield accounting (H1 Task 8): parallel to perRoundPerTarget,
    // built from rd.perActorShield (set only when non-empty — absent rounds map to {}).
    const perRoundPerShield: Record<
        number,
        Record<string, { granted: number; absorbed: number; pool: number }>
    > = {};
    for (const rd of engineRounds) {
        perRoundPerShield[rd.round] = rd.perActorShield ?? {};
    }

    // Per-round per-victim incoming damage-taken (PR7 Task 7): parallel to perRoundPerShield,
    // built from rd.perActorIncoming (set only when non-empty — absent rounds map to {}). Surfaces
    // each covered victim's own damage-taken bucket {incoming, shieldAbsorbed, barrierAbsorbed}.
    const perRoundPerIncoming: Record<
        number,
        Record<string, { incoming: number; shieldAbsorbed: number; barrierAbsorbed: number }>
    > = {};
    for (const rd of engineRounds) {
        perRoundPerIncoming[rd.round] = rd.perActorIncoming ?? {};
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

    // Pre-combat charge state per actor for the combatLog's per-turn charge header.
    //   - max    = the ship's charge cap (chargeCount) ONLY when it actually has a usable
    //              charged skill (hasCharged); 0 otherwise so non-charge ships render 0/0.
    //   - charge = seeded initial charge: `max` for ships whose refit-active skill rows
    //              declare "starts combat fully charged" (plan.startCharged — Chimei), 0
    //              otherwise. Mirrors the engine seed (state.ts: charges = startCharged ?
    //              chargeCount : 0), gated on `max` so a charge-less ship still renders 0/0.
    const initialCharge = new Map<string, { charge: number; max: number }>();
    for (const plan of [...playerPlans, ...enemyPlans]) {
        const max = hasCharged(plan) ? plan.chargeCount : 0;
        initialCharge.set(plan.id, { charge: plan.startCharged ? max : 0, max });
    }

    const result = assembleBattleResult({
        events,
        perRoundPerTarget,
        perRoundPerShield,
        perRoundPerIncoming,
        roster,
        numRounds,
        initialCharge,
    });

    // Attach the pre-fight unsimulated report ONLY when a leader was actually selected
    // AND at least one effect text was recorded — a no-leader run returns the assembler's
    // result untouched, so it stays deep-equal to the pre-F shape (golden safety).
    if (input.playerSquadLeader === undefined && input.enemySquadLeader === undefined) {
        return result;
    }
    const unsimulated = [...playerPlans, ...enemyPlans].flatMap((plan) => {
        const unit = preFightById.get(plan.id);
        return unit && unit.unsimulated.length > 0
            ? [{ actorId: plan.id, name: plan.name, texts: [...unit.unsimulated] }]
            : [];
    });
    return {
        ...result,
        ...(unsimulated.length > 0 ? { preFight: { unsimulated } } : {}),
    };
}
