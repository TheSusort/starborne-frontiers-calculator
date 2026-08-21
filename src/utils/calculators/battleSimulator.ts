/**
 * Combat Simulator Phase 5 — PR 1, Task 2: symmetric battle-result types + a PURE
 * event-driven assembler.
 *
 * `assembleBattleResult` takes the raw combat event stream + per-round per-victim damage
 * map + a roster (all as plain data) and produces a symmetric, render-ready BattleResult.
 * It has NO engine dependency and NO side effects — it only imports the CombatEvent union
 * (combat/events) and the Position type (types/encounters).
 *
 * Data-source contract (pinned in combat/__tests__/twoTeamBattle.test.ts, Task 1;
 * damage-dealt updated by SP-F F1 — see the `ShipRoundState.damageDealt`/`damageTaken`
 * docstrings below for the reconciliation invariant):
 *   - damage DEALT per attacker = `perRoundPerDealt[round][attackerId]` summed over victims
 *     (sourced from `RoundData.perTargetDealt`, a per-attacker×victim mirror of every
 *     `perTargetDamage` increment keyed to its correct source-attacker).
 *   - damage TAKEN per victim   = `perRoundPerTarget[round][victimId]` (the reliable,
 *     symmetric source for BOTH sides; we do NOT use `hp-changed`).
 *   - heals = `heal-performed` { casterId, targets[], amount } (healing mode only).
 *   - death = `ship-destroyed` { actorId }.
 *   - buffs = `buff-applied` / `buff-expired` / `debuff-applied` / `dot-applied`.
 *
 * The per-round event LOG is a CHRONOLOGICAL (emission-order) play-by-play, team-labeled
 * at render time. It walks the round's events in bus-emission order and emits one line per
 * relevant event: turn delimiters (`turn-started`), ATTACKER-centric damage (from
 * `ability-performed` — actorId=attacker, targetId, amount), heals, buffs, debuffs, dots,
 * deaths. (The dummy-'enemy' targetId used to appear on ally/self-targeting ships' damage
 * lines, so some read as "X → enemy". Those lines are gone: SP-4c-2b made an ally-targeted
 * player cast resolve no victim and SP-4c-2d deleted the actor, and `runPlayerTurn` emits no
 * `ability-performed` at all for a turn with no victim.)
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
import type { CombatActor } from '../combat/state';
import type { Position } from '../../types/encounters';
import type { Ship, AffinityName } from '../../types/ship';
import type { CombatStatBlock, DoTType } from '../../types/calculator';
import { runCombat, CombatEngineInput, TeamActorEngineInput } from '../combat/engine';
import { createEventBus } from '../combat/events';
import { buildShipAbilities } from '../abilities/buildShipAbilities';
import { buildShipAbilitiesWithEquipment } from '../abilities/buildShipAbilitiesWithEquipment';
import type { ShipSkills } from '../../types/abilities';
import type { GearPiece } from '../../types/gear';
import { hasUsableChargedSkill } from '../abilities/applyAbilities';
import { parseShipTargeting, SkillTargeting, ParsedTarget } from '../targetingParser';
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
     * SP-F F1: attacker's per-ROUND aggregate, summed from `perRoundPerDealt[round][actorId]`
     * (sourced from `RoundData.perTargetDealt` — a per-attacker×victim mirror of every
     * `perTargetDamage` increment keyed to its correct source-attacker: reflect's source is the
     * reflector, counter's is the counter owner, a DoT tick's is that tick's own applier, etc).
     * RECONCILES with `damageTaken` by construction: `damageDealt` == `Σ` per-victim
     * `damageTaken` attributed to this attacker this round — i.e. for every round, summing this
     * field over all attackers who hit a given victim equals that victim's `damageTaken`.
     * Per-ROUND, not per-turn: a DoT applier can show nonzero `damageDealt` in a round where it
     * took no turn at all, because an earlier-applied DoT stack ticked on a victim THIS round
     * (mirrors `damageTaken`'s existing DoT-tick-lands-in-the-tick-round behaviour).
     *
     * A Protection redirect no longer inflates this: every booking site credits the intake the
     * engine's damage funnel actually RECORDED for that victim (`VictimDamageOutcome.incomingBooked`),
     * so a diverted chunk is credited on the protector's row INSTEAD of the victim's rather than in
     * addition to it — a redirect moves intake between rows without creating any. CAVEAT that
     * remains: when the redirected damage is a DoT-tick-batch (no single source attacker → not
     * mirrored into `perTargetDealt`), that round's `Σ damageDealt` is short by the redirected DoT
     * amount.
     */
    damageDealt: number;
    /**
     * Per-victim damage from `perRoundPerTarget[round][victimId]` (AoE origin full / covered
     * half; unchanged by SP-F F1). RECONCILES with `damageDealt` — see `damageDealt`'s docstring
     * for the invariant and its Protection-redirect caveat.
     */
    damageTaken: number;
    healingDone: number;
    /**
     * SP-F F2: per-recipient raw heal amount actually applied to this actor, sourced from
     * `heal-performed.perTarget` (the engine's real per-recipient breakdown — see that event's
     * doc in events.ts). An even split of `amount` across `targets` is only a FALLBACK for
     * hand-crafted test emits that omit `perTarget`; the engine itself always populates it.
     * CAVEAT (pre-existing, out of F2 scope): HoT-tick and reactive-heal channels are not
     * `heal-performed` casts and are not included here.
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
     * The debuffs (including DoT/bomb families, one chip per family) this actor still carries at
     * the END of this round, sourced from the engine's authoritative `status-snapshot`. Reflects
     * removal — cleanse, purge, steal, natural expiry, duration reduction — because the engine
     * reads its live status stores rather than accumulating infliction events.
     *
     * Was infliction-only before: it accumulated `debuff-applied`/`dot-applied` with no removal
     * path, so a cleansed debuff stayed listed for the whole battle and the Simulator's ship panel
     * contradicted the combat log. `activeBuffs` comes from the same snapshot.
     */
    activeDebuffs: string[];
}

export interface BattleRound {
    round: number;
    ships: ShipRoundState[];
    /**
     * Distinct acting `actorId`s for this round in true speed order (emission order of
     * `turn-started`). Only roster actorIds: a `turn-started` for an id that is not on the
     * board is dropped. The dummy player-offense `'enemy'` id this used to exclude was
     * deleted in SP-4c-2d; the filter stays because this assembler is a pure function over
     * any event stream, including hand-authored ones.
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
     * Pre-fight effects that landed on an actor but are NOT simulated: squad-leader
     * conditional/'other'/per-round/'self' lines, plus any modifier-channel line whose channel
     * has no mapped engine field (see `MODIFIER_FIELD_BY_CHANNEL` in squadLeaderPass.ts — mapped
     * channels ARE consumed, so they no longer appear here). Present ONLY when a squad leader was
     * selected AND at least one such text was recorded, so a no-leader run's result stays
     * deep-equal to the pre-F shape.
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
    'shield-applied-log',
    'shield-destroyed-log',
    'cheat-death-log',
    'buff-applied',
    'buff-expired',
    'debuff-applied',
    'debuff-resisted',
    'dot-applied',
    'dot-ticked',
    'dot-detonated',
    'bomb-detonated',
    'control-applied',
    'cleanse-performed',
    'purge-performed',
    'ship-destroyed',
    // Log-only reactive procs (drain-time damage/heal/cleanse that emit no
    // ability-performed/heal-performed/cleanse-performed). Every LOG-ONLY twin MUST be listed
    // here: `buildCombatLog` has a handler keyed on the type, but the bus only subscribes from
    // THIS list, so an omission makes that handler dead code and the reaction invisible.
    'reactive-damage-performed',
    'reactive-heal-performed',
    'reactive-cleanse-performed',
    // Task 6: log-only per-turn acting-actor stat snapshot (no listener subscribes).
    'stats-snapshot',
    // Log-only per-actor end-of-round status snapshot — authoritative source for the
    // per-round activeBuffs/activeDebuffs chips (no listener subscribes).
    'status-snapshot',
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
        Record<
            string,
            {
                incoming: number;
                shieldAbsorbed: number;
                barrierAbsorbed: number;
                convertedToShield?: number;
            }
        >
    >;
    /**
     * SP-F F1: attacker id -> victim id -> dealt THIS round, keyed by round (parallel to
     * `perRoundPerTarget`, built the same way from `RoundData.perTargetDealt`). Drives
     * `damageDealt` below — replaces the old `ability-performed`-summed map so `damageDealt`
     * reconciles with `damageTaken` (Σ over victims for one attacker's entry here == that
     * attacker's `damageDealt`; Σ over attackers for one victim == `perRoundPerTarget[victim]`).
     */
    perRoundPerDealt?: Record<number, Record<string, Record<string, number>>>;
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
        perRoundPerDealt = {},
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
    // Cumulative healing received per actor (SP-F F2: per-recipient, from heal-performed.perTarget).
    const cumulativeHealed = new Map<string, number>();

    // Roster id set: a turn-started for a non-roster id is filtered out of turnOrder since it's
    // not on the board. It used to catch the dummy player-offense 'enemy' id, which SP-4c-2d
    // deleted. Note that `SENTINEL_ENEMY_ACTOR_ID` ('enemy') still names the side-wide scheduled
    // enemy-debuff BUCKET on `buff-expired`, so a non-roster id can still reach the buff/debuff
    // accumulation above — it just never reaches a rendered roster row.
    const rosterIds = new Set(roster.map((r) => r.actorId));

    const rounds: BattleRound[] = [];
    let lastRound = numRounds;
    let winner: 'player' | 'enemy' | 'draw' = 'draw';

    for (let round = 1; round <= numRounds; round++) {
        const roundEvents = events.filter((e) => 'round' in e && e.round === round);

        // Buff/debuff transitions for this round (apply before snapshotting the round).
        //
        // This accumulation is the FALLBACK. It has no removal path for debuffs, so it is
        // overwritten below by the engine's authoritative end-of-round `status-snapshot` for every
        // actor that emits one. It survives only for hand-authored event streams (unit tests that
        // emit apply-events without running the engine), which have no snapshot to prefer.
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

        // Authoritative overwrite: the engine's live end-of-round read per actor (DoT/bomb families
        // already folded in engine-side). Emitted at the round TAIL, so it already reflects
        // cleanse/purge/steal/expiry/duration changes the apply-only accumulation above cannot see.
        // REPLACES (never merges with) the accumulated set for exactly the actors named — merging
        // would resurrect the very entries this is here to remove.
        for (const e of roundEvents) {
            if (e.type !== 'status-snapshot') continue;
            activeBuffs.set(e.actorId, new Set(e.buffNames));
            activeDebuffs.set(e.actorId, new Set(e.debuffNames));
        }

        // SP-F F1: damage dealt per attacker this round, re-derived from `perRoundPerDealt`
        // (attacker id -> victim id -> dealt, sourced from `RoundData.perTargetDealt`) instead
        // of the old `ability-performed`-summed anchor-only aggregate. Summing each attacker's
        // per-victim entries here is what makes `damageDealt` reconcile with `damageTaken` by
        // construction (see the `ShipRoundState.damageDealt` docstring below).
        const dealtThisRound = perRoundPerDealt[round] ?? {};
        const dealt = new Map<string, number>();
        for (const [attackerId, byVictim] of Object.entries(dealtThisRound)) {
            dealt.set(
                attackerId,
                Object.values(byVictim).reduce((s, v) => s + v, 0)
            );
        }

        // Healing done (caster, full amount) + received. SP-F F2: prefers the engine's real
        // per-recipient breakdown (`heal-performed.perTarget`); an even split across `targets`
        // is only the FALLBACK for hand-crafted test emits that omit `perTarget` (the engine
        // itself always populates it — see the `heal-performed` event doc in events.ts).
        const healDone = new Map<string, number>();
        const healReceived = new Map<string, number>();
        for (const e of roundEvents) {
            if (e.type === 'heal-performed') {
                healDone.set(e.casterId, (healDone.get(e.casterId) ?? 0) + e.amount);
                if (e.perTarget && e.perTarget.length > 0) {
                    for (const pt of e.perTarget) {
                        healReceived.set(
                            pt.targetId,
                            (healReceived.get(pt.targetId) ?? 0) + pt.amount
                        );
                    }
                } else {
                    const per = e.targets.length > 0 ? e.amount / e.targets.length : 0;
                    for (const tid of e.targets) {
                        healReceived.set(tid, (healReceived.get(tid) ?? 0) + per);
                    }
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
                      incoming.incoming -
                          incoming.shieldAbsorbed -
                          incoming.barrierAbsorbed -
                          (incoming.convertedToShield ?? 0)
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
        // order (true speed order). Non-roster ids are dropped.
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
    /** TEST-ONLY: forwarded verbatim to the engine's `__testTapActors` (engine.ts:1363, fired once
     *  at actor construction). Lets a fixture seed initial actor state — `shieldPool`, `currentHp`
     *  — that `BattlePlacement`/`statOverrides` cannot express, which is what the real-kit
     *  fingerprint scenarios (richEnemy / hurtAllies) need. Never set by production callers.
     *  Mutates the LIVE roster; the engine hands out `allActors` itself, not a copy. */
    __testTapActors?: (actors: CombatActor[]) => void;
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
    /** Heal-modifier % (SP-F F4). Folded into this actor's heal casts as `(1 + healModifier/100)`
     *  by the engine (playerTurn `raw` fold + standing-leech/reactive-heal folds). Sourced from
     *  statOverrides / baseStats (a gear-set or base stat); defaults 0. */
    healModifier: number;
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
        healModifier: o.healModifier ?? b.healModifier ?? 0,
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
    | 'healModifier'
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
        // SP-F F4: the enemy folds ITS heal-modifier on its own heal casts (team symmetry with the
        // focus/walk paths). Read by the engine's enemy runtime builder as `e.stats.healModifier`.
        healModifier: stats.healModifier,
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
    /** W6: per-slot stealth-targeting bypass, derived from the built damage configs. Stamped onto
     *  the active/charged ParsedTarget at the actor-input build sites. */
    activeIgnoresStealth: boolean;
    chargedIgnoresStealth: boolean;
}

function planPlacement(
    p: BattlePlacement,
    id: string,
    getGearPiece?: (id: string) => GearPiece | undefined
): PlacementPlan {
    const targeting = parseShipTargeting(p.ship);
    const shipSkills = getGearPiece
        ? buildShipAbilitiesWithEquipment(p.ship, getGearPiece)
        : buildShipAbilities(p.ship);
    // W6: does the given slot carry a damage ability whose built config declares the
    // per-cast stealth-targeting bypass (Lodolite/Rhodium/Selenite's "This attack can target
    // Stealthed enemies.")? config.ignoresStealth is the single source (Task 1) — this derives
    // the per-slot boolean that gets stamped onto the corresponding ParsedTarget below.
    const slotBypass = (slot: 'active' | 'charged'): boolean =>
        shipSkills.slots
            .find((s) => s.slot === slot)
            ?.abilities.some(
                (a) => a.config.type === 'damage' && a.config.ignoresStealth === true
            ) ?? false;
    // Use the ACTIVE targeting (target + pattern) as the default axes. Charged targeting is
    // threaded separately (`chargedTargeting`) — SP-F F5: it now drives the damage footprint
    // AND the target selection on a charge-firing turn (not just support-footprint resolution),
    // via the engine's `chargedPattern`/`chargedTarget` inputs.
    return {
        id,
        name: p.ship.name,
        position: p.position,
        faction: p.ship.faction,
        role: p.ship.type,
        stats: resolveStats(p),
        shipSkills,
        affinity: p.ship.affinity,
        targeting: targeting.active,
        chargedTargeting: targeting.charged ?? targeting.active,
        chargeCount: p.ship.chargeSkillCharge ?? 0,
        // Chimei "starts combat fully charged": detected over the REFIT-RESOLVED skill rows
        // (getShipSkillRows returns only the refit-active passive), so a below-threshold
        // refit count automatically drops the declaring passive and the ship starts at 0.
        startCharged: detectFullyCharged(getShipSkillRows(p.ship).map((r) => r.text)),
        activeIgnoresStealth: slotBypass('active'),
        chargedIgnoresStealth: slotBypass('charged'),
    };
}

/** W6: stamp `ignoresStealth` onto a ParsedTarget when this slot's bypass flag is on — a FRESH
 *  object, never a mutation, because `parseShipTargeting` returns `charged === active` (the SAME
 *  object reference) when the ship's charged targeting columns are empty; mutating in place would
 *  make the active/charged bypass flags clobber each other. When `on` is false, the SAME
 *  reference is returned so every non-bypass ship stays byte-identical. */
const withStealthBypass = (t: ParsedTarget | undefined, on: boolean): ParsedTarget | undefined =>
    t && on ? { ...t, ignoresStealth: true } : t;

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
 * The battle is driven by positions on both sides. `mode: 'battle'` is the single signal the
 * engine keys on (SP-U U5 R6 decouple): it builds the positioned enemy roster from the
 * enemyAttackers presence, lets enemies fire on players, and runs the real-vs-real heal/shield
 * pipeline (heals route to the lowest-HP living ally) — no `healTargetId` is passed.
 *
 * Affinity: a single "representative opposing affinity" (the FIRST opposing placement's affinity,
 * the single-opponent-affinity convention the DPS/healing adapters already use) is used ONLY to
 * pre-resolve each actor's aggregate walk modifiers and the combat-log aggregate. It is NOT the
 * authoritative accounting signal: SP-F F6 confirmed the engine's positional path recomputes
 * affinity PER VICTIM from the RAW affinity (also threaded here — `walk.affinity`/`affinity`),
 * so `damageDealt`/`damageTaken` reflect each victim's true matchup within a single AoE cast (an
 * advantage victim can book +25% while a disadvantaged covered victim books −25% in the same
 * cast; likewise per-victim crit via `rollVictimCrit`). Threading both keeps the representative
 * aggregate and the per-victim path from disagreeing on a single-opponent battle.
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

    // Representative opposing affinity (first opponent) — used ONLY to pre-resolve the aggregate
    // walk modifiers below; the authoritative per-victim affinity is recomputed in the engine from
    // the RAW `affinity` threaded alongside these (SP-F F6). See the function docstring above.
    const enemyRepAffinity = enemyPlans[0]?.affinity;
    const playerRepAffinity = playerPlans[0]?.affinity;

    const hasCharged = (plan: PlacementPlan): boolean =>
        hasUsableChargedSkill(plan.shipSkills, plan.chargeCount);

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
            target: withStealthBypass(plan.targeting?.target, plan.activeIgnoresStealth),
            pattern: plan.targeting?.pattern,
            chargedPattern: plan.chargedTargeting?.pattern,
            // SP-F F5 (charged-skill targeting): thread the charged TARGET selection alongside
            // the charged pattern above — drives both the damage footprint and the target
            // selection on a charge-firing turn. Falls back to the active target when unset.
            chargedTarget: withStealthBypass(
                plan.chargedTargeting?.target,
                plan.chargedIgnoresStealth
            ),
            // SP-F F5 (Meatshield defense-substitution): thread the ship role (Ship.type) for
            // role-filtered classification ("non-defender ally" gate).
            role: plan.role,
            // SP-F F4: thread the ship name for the live `ally-on-team` roster check
            // (Isha/Nayra reciprocal Affinity Override gate).
            name: plan.name,
            // §4.5 Akula exception: thread doesntBreakStasis from ShipSkills.
            doesntBreakStasis: plan.shipSkills.doesntBreakStasis,
            chargeLossImmune: plan.shipSkills.chargeLossImmune,
            ignoresForcedTargeting: plan.shipSkills.ignoresForcedTargeting,
            // W6: ship-wide stealth-targeting bypass (Lodolite's "This Unit ignores Stealth
            // effects."). Team-symmetric with the focus/enemy branches below.
            ignoresStealth: plan.shipSkills.ignoresStealth,
            walk: {
                shipSkills: plan.shipSkills,
                stats: toWalkStats(plan.stats),
                // SP-F F4: fold the walked actor's heal-modifier on its heal casts (read flat as
                // `w.healModifier`). Team symmetry with the focus/enemy paths.
                healModifier: plan.stats.healModifier,
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
                ignoresForcedTargeting: plan.shipSkills.ignoresForcedTargeting,
                // W6: ship-wide stealth-targeting bypass. Team-symmetric with the teamActors/
                // focus branches.
                ignoresStealth: plan.shipSkills.ignoresStealth,
                affinityDamageModifier: aff.damageModifier,
                affinityCritCap: aff.critCap,
                affinityCritPenalty: aff.critPenalty,
                position: plan.position,
                target: withStealthBypass(plan.targeting?.target, plan.activeIgnoresStealth),
                pattern: plan.targeting?.pattern,
                chargedPattern: plan.chargedTargeting?.pattern,
                // SP-F F5 (charged-skill targeting): thread the charged TARGET selection
                // alongside the charged pattern above (team-symmetric with the teamActors branch).
                chargedTarget: withStealthBypass(
                    plan.chargedTargeting?.target,
                    plan.chargedIgnoresStealth
                ),
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
        // SP-F F4: fold the focus actor's heal-modifier on its heal casts (read as
        // `input.healModifier`). Team symmetry with the walk/enemy paths.
        healModifier: focus.stats.healModifier,
        // Base hacking/security so the engine's live landing recompute has real inputs for the
        // focus actor. Landing against an enemy resolves against that actual target's own
        // security — the intended per-target behaviour covered by the heterogeneous-security
        // team-vs-team test in twoTeamBattle.test.ts.
        hacking: focus.stats.hacking,
        security: focus.stats.security,
        position: focus.position,
        target: withStealthBypass(focus.targeting?.target, focus.activeIgnoresStealth),
        pattern: focus.targeting?.pattern,
        chargedPattern: focus.chargedTargeting?.pattern,
        // SP-F F5 (charged-skill targeting): thread the charged TARGET selection alongside the
        // charged pattern above (team-symmetric with the teamActors/enemyAttackers branches).
        chargedTarget: withStealthBypass(
            focus.chargedTargeting?.target,
            focus.chargedIgnoresStealth
        ),
        // SP-F F5: thread the focus actor's ship role (Ship.type) for role-filtered
        // classification (Meatshield defense-substitution's "non-defender ally" gate). Team
        // symmetry with the teamActors/enemyAttackers branches above.
        role: focus.role,
        // SP-F F4: thread the focus actor's ship name for the live `ally-on-team` roster check.
        name: focus.name,
        // §4.5 Akula exception: thread doesntBreakStasis from ShipSkills.
        doesntBreakStasis: focus.shipSkills.doesntBreakStasis,
        chargeLossImmune: focus.shipSkills.chargeLossImmune,
        ignoresForcedTargeting: focus.shipSkills.ignoresForcedTargeting,
        // W6: ship-wide stealth-targeting bypass. Team-symmetric with the teamActors/
        // enemyAttackers branches.
        ignoresStealth: focus.shipSkills.ignoresStealth,
        ...preFightModifiersFor(focus.id),
        // Positional team battle: the positioned enemy roster comes from the `enemyAttackers`
        // presence below (SP-U U5), not from `mode`. `mode: 'battle'` is the run-kind, not a
        // flag the pipeline is switched on by — it anchors `healTarget` to the focus actor
        // (engine.ts) so the heal/shield pipeline stays active with no vestigial `healTargetId`
        // needed. SP-4e Task 4: recipient choice no longer depends on this run kind at all — a
        // single-`ally` heal/shield routes over the caster's support footprint and a text-named
        // worst-HP ally routes to that ally, identically here and in the healing calculator. The
        // `teamBattle` flag that made `mode: 'battle'` mean "lowest-HP routing" is gone.
        mode: 'battle',
        teamActors,
        enemyAttackers,
        __testTapActors: input.__testTapActors,
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
    // each covered victim's own damage-taken bucket {incoming, shieldAbsorbed, barrierAbsorbed,
    // convertedToShield}.
    const perRoundPerIncoming: Record<
        number,
        Record<
            string,
            {
                incoming: number;
                shieldAbsorbed: number;
                barrierAbsorbed: number;
                convertedToShield?: number;
            }
        >
    > = {};
    for (const rd of engineRounds) {
        perRoundPerIncoming[rd.round] = rd.perActorIncoming ?? {};
    }

    // SP-F F1: per-round per-attacker×victim dealt, parallel to perRoundPerTarget — built from
    // rd.perTargetDealt (set only when non-empty — absent rounds map to {}). Drives damageDealt.
    const perRoundPerDealt: Record<number, Record<string, Record<string, number>>> = {};
    for (const rd of engineRounds) {
        perRoundPerDealt[rd.round] = rd.perTargetDealt ?? {};
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
        perRoundPerDealt,
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
