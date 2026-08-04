import {
    CombatStatBlock,
    DoTType,
    EnemyBaseClass,
    SelectedGameBuff,
    TeamActorInput,
} from '../../types/calculator';
import type { ShipTypeName } from '../../constants/shipTypes';
import { matchesRoleCategory } from '../../constants/shipTypes';
import {
    TOXIC_OVERFLOW,
    SPREAD_CORROSION_TIER,
    SPREAD_CORROSION_DURATION,
} from '../../constants/toxicOverflow';
import { Ability, AbilityTarget, IncomingHitContext, ShipSkills } from '../../types/abilities';
import type { Position } from '../../types/encounters';
import type { AffinityName } from '../../types/ship';
import type { ParsedTarget, ParsedPattern } from '../targetingParser';
import { makeRateGate, rollRateGate } from '../calculators/rateAccumulator';
import type { RoundData } from '../calculators/dpsSimulator';
import { toEnemyModifiers, toSelfIncomingDamageModifier } from '../calculators/dpsBuffHelpers';
import { computeAffinityModifiers, getAffinityMatchup } from '../calculators/affinityUtils';
import { calculateDamageReduction } from '../autogear/priorityScore';
import {
    type ExtraActionGrant,
    selectFiringSkill,
    damageInputsFromSkill,
    modifierTotalsFromAbilities,
    skillNeedsOpposingVictim,
} from '../abilities/applyAbilities';
import { conditionsMet, type ConditionContext } from '../abilities/evaluateConditions';
import { foldActorBuffTotals, effectiveStatsOf } from './effectiveStats';
import {
    ActiveDoTStack,
    ActorDamage,
    ActorHealing,
    CombatActor,
    PendingAccumulator,
    PendingBomb,
    createActor,
    selectNextBySpeed,
    MAX_SELECTION_TICKS,
    emptyActorDamage,
    emptyActorHealing,
    advanceChargeCadence,
    recordDestroyed,
} from './state';
import {
    ActiveBuff,
    AbilityStatusPayload,
    RegisteredAbilityStatus,
    StatusEngine,
    createStatusEngine,
} from './statusEngine';
import { liveGateConditions } from './abilityStatusGating';
import { isPositional, resolvePositionalTarget } from './positionalBinding';
import {
    applyPositionalDamage,
    footprintVictims,
    type VictimDamageOutcome,
    type AppliedVictimDamage,
} from './positionalApply';
import type { AttackerDamageScalars } from './victimDamage';
import { victimHitDamage } from './victimDamage';
import { incomingReductionForHit, incomingBlockForIntake, conditionMet } from './incomingEffects';
import { reflectedDamageForHit } from './damageReflection';
import { splashDamageForBomb } from './bombSplash';
import { detonateContainers, type DetonationRecipe } from './detonation';
import { outgoingAmplificationForHit } from './outgoingEffects';
import { incomingHealAmpForRecipient } from './healAmplification';
import { CHEAT_DEATH_BUFFS } from './cheatDeathBuffs';
import { BARRIER_BUFFS } from './barrierBuffs';
import { shieldAbsorb } from './shieldAbsorb';
import { thresholdShieldForHit } from './thresholdShield';
import { isStasis, STASIS_BUFFS } from './stasisBuffs';
import { isDisable } from './disableBuffs';
import { highestAttackAmong } from './highestAttack';
import { emitAttacked } from './emitAttacked';
import { emitPerVictimAttacked } from './emitPerVictimAttacked';
import { CombatEvent, CombatEventBus, createEventBus } from './events';
import { normalizeTeamActorsToWalked } from './teamActorWalk';
import { buildBuffDurationExtensionByOwner } from './buffDurationExtension';
import {
    HealingRuntimeCtx,
    PlayerActorRuntime,
    PlayerRoundCtx,
    PlayerTurnResult,
    RateGate,
    runPlayerTurn,
} from './playerTurn';
import {
    Intent,
    MAX_INTENT_GENERATIONS,
    buildActorConditionContext,
    buildForcedTargetingStatus,
    countOwnersWithSelfBuff,
    executeIntent,
    ownerDebuffNamesFor,
    partitionReactiveAbilities,
    provokerOf,
    registerReactiveListeners,
    selfBuffNamesForOwners,
    selfBuffStacksForOwner,
    victimEnemyBuffs,
    victimSelfBuffs,
} from './triggers';
import { adjacentAllyIds } from './adjacency';
import { consumeExposed, exposedIncomingPct } from './exposedStatus';
import {
    HIT_MITIGATION_DOT_ROUNDS,
    consumeHitMitigation,
    holdsHitMitigation,
} from './hitMitigation';
import { holdsShieldConverter, consumeShieldConverter } from './shieldConverter';
import { holdsRoguesLiberty } from './rogueLiberty';
import { holdsToxicOverflow } from './toxicOverflowStatus';
import { supportFootprintAllyIds } from './supportFootprint';
import type { PreFightCombatModifiers } from './preFight/types';
import { protectionCascade } from './protectionTransfer';

/** Backstop for pathological extra-action loops (a non-once-per-round grant whose
 *  conditions stay true re-fires on the extra turn it granted). Real texts are
 *  self-limited (charged-skill grants consume charges; passive grants are once per
 *  round), so any round needing more than this is a config/parser bug. */
const MAX_EXTRA_TURNS_PER_ROUND = 8;

/**
 * Sum an actor's LIVE speed-buff percentage from the status engine (Task 2 authority for
 * effectiveSpeedOf; pure read, no mutation). Folds the same two sources the per-actor buff
 * fold uses, keyed by owner id so it is correct for any actor on either side:
 *   1. Scheduled self-buffs: snapshot(actorId).activeSelfBuffs, each expanded via selfBuffLookup
 *      (accumulating buffs override their static stacks with the per-round count; 0 → dropped).
 *   2. Timed ability statuses: timedAbilityStatuses('self', actorId), each payload wrapped via
 *      payloadToSelectedBuff.
 * Both fold through toSimBuffs → calculateBuffTotals, summing only `.speedBuff`.
 *
 * Task 0 corpus investigation: every corpus speed buff (Speed Up I/II/III, Speed Down I/II,
 * XAOC Swiftness I/II/III) is an UNCONDITIONAL timed status grant — there is NO conditional/
 * gated speed buff, NO always-active/aura speed buff, and NO standing speed modifier — so the
 * ctx-gated activeAbilityStatuses path and a ModifierChannel speed entry are intentionally
 * omitted. Returns a percentage (e.g. 30 for +30%); effective speed is uncapped.
 */
export function foldSpeedBuffPct(
    statusEngine: StatusEngine,
    selfBuffLookup: Map<string, SelectedGameBuff[]>,
    actorId: string
): number {
    return foldActorBuffTotals(statusEngine, selfBuffLookup, actorId).speedBuff;
}

// Classify ONE actor's cast buff/debuff abilities into timed/aura/accumulating statuses
// and register them under the correct status-engine recipients. Returns the timed-by-slot
// lists (applied when that caster's slot fires). Extracted from the attacker's inline loop
// (Task 4); Task 5 makes the routing real (see below).
//
// Classification (spec): accumulating (stackTrigger && isStackable) → accumulating maps,
// effect inclusion aura-gated; aura (recurring/undefined duration) → per-round effect gate;
// timed (finite duration) → gated at application. A finite-duration passive buff is timed (NOT
// an aura): it is a one-time combat-start window ("gains X for N turns"), seeded once in the
// round-1 loop and then decrementing on the owner's normal timed lifecycle.
//
// TARGET ROUTING (Task 5): the binary side computation becomes recipient routing —
//   enemy/all-enemies → 'enemy' side (recipients ignored, enemy maps are singular);
//   self              → recipients [casterId] (the owner only);
//   ally/all-allies   → recipients = ALL player ids (`playerIds`, a FIXED source order
//                       [focusActorId, ...team ids in input order] — independent of which
//                       actor cast, so application order is deterministic).
// `casterId` (== this caster's ownerId) is stamped on every status so its gate evaluates
// against the caster's ctx even when the status lives on another recipient.
//
// AURA/ACCUMULATING fan-out: the engine fans these out by calling
// statusEngine.registerAbilityStatuses(...) ONCE PER RECIPIENT (keeping the statusEngine API
// stable). Each recipient gets its own per-owner aura/accum store entry carrying the same
// casterId. Timed statuses are NOT registered here — they apply lazily per recipient via
// applyTimedAbilityStatus at the firing site (playerTurn loops `status.recipients`).
//
// KNOWN APPROXIMATION (documented, not fixed this task): a team-cast all-allies ACCUMULATING
// status registered onto the attacker's store ticks per-active/per-charge on the ATTACKER's
// cadence (sourceFired increments only the 'attacker' map for per-slot triggers). Per-caster
// cadence tracking is out of scope here; per-round increments tick every owner's map already.
//
// Zero-churn: for an attacker-only run playerIds = ['attacker'], so self and ally/all-allies
// both yield recipients ['attacker'] and casterId 'attacker' — identical to the pre-Task-5
// owner-routing (one registration onto the attacker's store).
function registerActorAbilityStatuses(
    castSkills: ShipSkills,
    statusEngine: ReturnType<typeof createStatusEngine>,
    ownerId: string,
    // Same-side ally-recipient order for `ally`/`all-allies` cast buffs: player ids for player
    // actors, enemy attacker ids for enemy actors. Named `playerIds` historically; for enemy
    // actors the engine passes the enemy team's ids so cross-enemy buffs land on the enemy side.
    playerIds: string[],
    // Heal target id (healing mode) — the recipient a single-`ally` Cheat-Death-family
    // firing-slot grant narrows to (Hermes shape). Absent (DPS mode / no heal target) →
    // the carve-out falls back to [ownerId]. Irrelevant for every non-carve-out status.
    healTargetId?: string
): {
    timedSelfBySlot: Extract<RegisteredAbilityStatus, { kind: 'timed' }>[];
    timedEnemyBySlot: Extract<RegisteredAbilityStatus, { kind: 'timed' }>[];
} {
    // Aura/accumulating statuses to register, grouped per RECIPIENT owner id (the engine fans
    // them out with one registerAbilityStatuses call per recipient). Timed statuses are applied
    // lazily and tracked via timedSelfBySlot/timedEnemyBySlot — they carry recipients on the
    // status object for the per-recipient application loop in playerTurn.
    const byRecipient = new Map<string, RegisteredAbilityStatus[]>();
    const pushFor = (rid: string, status: RegisteredAbilityStatus) => {
        let list = byRecipient.get(rid);
        if (!list) {
            list = [];
            byRecipient.set(rid, list);
        }
        list.push(status);
    };
    const timedSelfBySlot: Extract<RegisteredAbilityStatus, { kind: 'timed' }>[] = [];
    const timedEnemyBySlot: Extract<RegisteredAbilityStatus, { kind: 'timed' }>[] = [];
    for (const slot of castSkills.slots) {
        // Intra-cast clause order: within ONE firing slot, a clause resolves after the clauses
        // before it, so a debuff whose clause follows a damage-dealing clause is not yet in the
        // store while that cast's damage resolves ("deals X% damage AND inflicts Defense Down").
        // `slot.abilities` IS clause order — buildShipAbilities sorts each slot by text position.
        // Only the two FIRING slots cast; a passive row has no damage clause to order against
        // (its statuses are seeded, not cast), so the tracker stays false there.
        const isFiringSlot = slot.slot === 'active' || slot.slot === 'charged';
        let sawDamageClause = false;
        for (const ability of slot.abilities) {
            const cfg = ability.config;
            // A real damage-dealing clause. A 0-multiplier entry is a structural no-op (the
            // fixtures' "took a turn" placeholder) and orders nothing.
            if (isFiringSlot && cfg.type === 'damage' && cfg.multiplier > 0) sawDamageClause = true;
            if (cfg.type !== 'buff' && cfg.type !== 'debuff') continue;
            // Ship-kit W5 Task A3: the two enemy-adjacency scopes (Vindicator Provoke/Out. Damage
            // Down I → 'adjacent-enemies'; Asphyxiator Stasis → 'target-and-adjacent-enemies')
            // are enemy-side debuffs scoped to the resolved target's board neighbours, not self
            // buffs — omitting them here silently misregisters the status on the CASTER.
            const side: 'self' | 'enemy' =
                ability.target === 'enemy' ||
                ability.target === 'all-enemies' ||
                ability.target === 'adjacent-enemies' ||
                ability.target === 'target-and-adjacent-enemies'
                    ? 'enemy'
                    : 'self';
            // Hit count ("Barrier for 1 hit"), captured as the VALUE rather than a flag so the
            // timed literal below can thread it without re-narrowing `cfg` back to the buff arm.
            // Only a buff config carries it — `hits` does not exist on the debuff arm.
            const hitCount = cfg.type === 'buff' ? cfg.hits : undefined;
            const hitCounted = hitCount !== undefined;
            // A hit-counted grant is never accumulating and never an aura — BOTH stores are
            // unreachable by `consumeStatusHit`, which only spends from the per-actor TIMED map.
            // Landing a hit-counted grant in either one would make it permanent and unspendable
            // (the known one-shot-in-an-unreachable-channel defect class). No corpus config
            // combines `hits` with `stackTrigger + isStackable` today; if one ever does, the hit
            // lifecycle wins and the stack accrual is what gets dropped, loudly here rather than
            // silently at the spend site.
            const accumulating = !hitCounted && !!cfg.stackTrigger && cfg.isStackable;
            // Cheat-Death-family grants from a FIRING slot (Hermes/Hayyan charged skills) are
            // cast-path persistent grants, NOT always-on auras: they apply when the slot fires
            // (per-slot timed loop in playerTurn, gated by conditionsMet at cast time) and never
            // expire (duration Infinity; the intercept consumes them via cheatDeathConsumed).
            // Scoped to CHEAT_DEATH_BUFFS — other firing-slot recurring buffs (Panon, Sansi,
            // Sentinel, Oleander…) keep the aura model for now (documented in coverage §5).
            const castPathCheatDeath =
                !accumulating &&
                CHEAT_DEATH_BUFFS.has(cfg.buffName) &&
                (slot.slot === 'active' || slot.slot === 'charged');
            // Player-side recipients (self vs ally/all-allies). Enemy-side statuses ignore this
            // (recipients are only consulted on the self side). Self → caster only; ally/all-allies
            // → every player actor (fixed source order). `playerIds` already includes the caster.
            // CARVE-OUT (castPathCheatDeath only): a single-`ally` grant narrows to the heal target
            // (Hermes "grants Cheat Death to the lowest-HP ally"), fallback [ownerId] when no heal
            // target; `all-allies` (Hayyan) keeps every player. The global ally → all-players rule
            // for every OTHER cast-path buff is UNCHANGED.
            const recipients: string[] =
                side === 'enemy'
                    ? [] // enemy-side statuses have no player recipients; the timed-enemy application path never reads recipients
                    : castPathCheatDeath && ability.target === 'ally'
                      ? [healTargetId ?? ownerId]
                      : ability.target === 'ally' || ability.target === 'all-allies'
                        ? playerIds
                        : [ownerId];
            // A hit-counted grant is never an aura: an aura is re-evaluated per round against
            // its gate and has no consumable charge, so a durationless "Barrier for 1 hit" would
            // otherwise be permanent for as long as its gate held. (`hitCounted` is computed with
            // `accumulating` above — the other classification it has to lose to.)
            const isAura =
                !accumulating &&
                !castPathCheatDeath &&
                !hitCounted &&
                (cfg.duration === 'recurring' || cfg.duration === undefined);
            const payload: AbilityStatusPayload = {
                buffName: cfg.buffName,
                stacks: cfg.stacks,
                parsedEffects: cfg.parsedEffects,
                ...(cfg.type === 'debuff' ? { application: cfg.application } : {}),
                // SP-G G1b: threads the config's isStackable flag through so the aura branch of
                // activeAbilityStatuses can tell a genuinely-stackable one-shot grant (Meatshield's
                // Protection) apart from the structural stacks:1 default every non-stackable buff
                // carries — only the former should surface a reported stack count.
                ...(cfg.isStackable ? { isStackable: true } : {}),
            };
            // `as const` keeps the literal types (side, sourceSlot) so the spread into
            // a union variant below doesn't widen them — runtime object is unchanged.
            // casterId/recipients (Task 5) carry the ally-routing decision on the status.
            const base = {
                payload,
                side,
                sourceSlot: slot.slot,
                conditions: liveGateConditions(ability.conditions),
                casterId: ownerId,
                recipients,
            } as const;
            let status: RegisteredAbilityStatus;
            if (accumulating) {
                // accumulating: stackTrigger is required and non-optional on this variant.
                status = {
                    ...base,
                    kind: 'accumulating',
                    stackTrigger: cfg.stackTrigger!,
                    maxStacks: cfg.maxStacks,
                };
            } else if (isAura) {
                // NOTE: persistent-stacking names (PERSISTENT_STACKING_BUFFS) should never
                // reach the aura arm with current data — their cast applications either carry
                // a stackTrigger (accumulating, climbs + caps there) or a reactive trigger
                // (partitioned out before this loop; the executor routes them to the
                // persistent map). If one ever lands here it would become a per-round
                // re-rolled aura and silently lose persistence — see persistentStackingBuffs.ts.
                status = { ...base, kind: 'aura' };
            } else {
                // timed: cfg.duration is a number here (NOT accumulating, NOT aura — i.e.
                // not recurring/undefined duration). A finite-duration passive buff lands here
                // too (seeded at combat start by the round-1 loop). The classification branches
                // above exhaustively exclude non-numeric durations from reaching this arm.
                // Cheat-Death-family firing-slot grants take Infinity (never decrements to 0:
                // Infinity − 1 === Infinity; expiry compares <= 0) → persists like Cheat Death;
                // clearRemovable on the intercept still wipes it (it's consumed anyway).
                status = {
                    ...base,
                    kind: 'timed',
                    duration: castPathCheatDeath
                        ? Infinity
                        : hitCounted && typeof cfg.duration !== 'number'
                          ? // Hit-counted with no stated turn window: never tick out, expire on
                            // the hit count alone. Same non-expiring-but-removable shape as
                            // TOXIC_OVERFLOW_DURATION.
                            Infinity
                          : (cfg.duration as number),
                    ...(hitCount !== undefined ? { hits: hitCount } : {}),
                    // Clause-order stamp (enemy side only — a self-buff never modifies the
                    // victim's incoming damage, so deferring one would change nothing but its
                    // event order). Consumed by playerTurn's timed-enemy application loop.
                    ...(side === 'enemy' && sawDamageClause ? { afterDamageClause: true } : {}),
                };
                (side === 'self' ? timedSelfBySlot : timedEnemyBySlot).push(status);
            }
            // Enemy-side statuses register once (singular enemy maps); self-side aura/accum fan
            // out to every recipient store. Timed statuses are applied lazily (per recipient) at
            // the firing site, so we only group the NON-timed statuses for registration here —
            // but enemy timed statuses also flow through registerAbilityStatuses as before (it
            // ignores timed — they apply via applyTimedAbilityStatus). Keep the historical
            // behaviour by registering every status under each recipient (registerAbilityStatuses
            // only stores aura/accumulating internally; timed are no-ops there).
            if (side === 'enemy') {
                // Enemy side: single registration (recipientId irrelevant — enemy maps singular).
                pushFor('enemy', status);
            } else {
                // `recipients` is the locally-computed list (always defined) — use it directly
                // rather than status.recipients (typed optional through the union).
                for (const rid of recipients) pushFor(rid, status);
            }
        }
    }
    // Fan out: one registerAbilityStatuses call per recipient owner (statusEngine API stable).
    // Enemy-side statuses were grouped under the sentinel key 'enemy'; their ownerId argument is
    // irrelevant (registerAbilityStatuses routes enemy-side statuses to the singular enemy maps).
    for (const [rid, statuses] of byRecipient) {
        statusEngine.registerAbilityStatuses(statuses, rid === 'enemy' ? ownerId : rid);
    }
    return { timedSelfBySlot, timedEnemyBySlot };
}

// ─────────────────────────────────────────────────────────────────────────────
// Combat-start seeding for PASSIVE-sourced finite (timed) self-statuses.
//
// The passive slot never fires as an action, so these would otherwise never apply; they
// are a one-time window from combat start ("gains X for N turns"), NOT a per-turn refresh.
// Apply once at round start, then the normal timed lifecycle (timedAbilityStatuses fold +
// decrementPlayer + clearRemovable) expires them and wipes them on death. Gated by
// conditionsMet for parity with the cast path (executeIntent).
function seedPassiveTimedStatuses(
    runtimes: PlayerActorRuntime[],
    statusEngine: ReturnType<typeof createStatusEngine>,
    bus: CombatEventBus,
    enemyType: EnemyBaseClass | undefined,
    round: number
): void {
    for (const rt of runtimes) {
        const seedCtx = buildActorConditionContext(statusEngine, rt.actor.id, {
            corrosionEntryCount: 0,
            infernoEntryCount: 0,
            bombCount: 0,
            enemyHpPct: 100,
            enemyType, // `enemy-type` survives liveGateConditions, so omitting it would
            // wrongly skip an enemy-class-gated passive buff.
        });
        for (const status of rt.timedSelfBySlot) {
            if (status.sourceSlot !== 'passive') continue;
            if (!conditionsMet(status.conditions, seedCtx)) continue;
            // recipients is populated by registerActorAbilityStatuses for every timed-by-slot
            // status; the [rt.actor.id] fallback only guards test fixtures that omit it.
            for (const rid of status.recipients ?? [rt.actor.id]) {
                statusEngine.applyTimedAbilityStatus(round, status, rid);
                bus.emit({
                    type: 'buff-applied',
                    actorId: rid,
                    round,
                    buffName: status.payload.buffName,
                    duration: status.duration,
                });
            }
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Combat-start seeding for PASSIVE-sourced PRE-COMBAT shields (epic PR4).
//
// "At the start of combat, this Unit gains a Shield equal to N% of its Max HP" (Crucialis,
// FrontLine) — the parser now tags these `type:'shield', trigger:'pre-combat'`. The cast path
// (runPlayerTurn's heal/shield loop) SKIPS pre-combat abilities (they used to re-grant the pool
// on every cast), and this seam applies them exactly ONCE, before any round-1 turn — the same
// sequence point as seedPassiveTimedStatuses. Semantics mirror the F3 squad-leader
// `startingShieldPctOfHp` seeding in createActor: silent (no shield-applied emission, no
// `granted` credit — a pre-fight pool, not a cast), basis = the actor's BASE max HP (post
// pre-fight stat passes; no round buffs exist yet), pool capped at max HP (locked H rule).
// Team-symmetric by construction: the engine calls this for both runtime collections.
// Conditions are ignored — every corpus clause is unconditional (verified ship-skills.csv);
// a future conditional pre-combat shield must add gating here.
function seedPreCombatShields(runtimes: PlayerActorRuntime[]): void {
    for (const rt of runtimes) {
        for (const slot of rt.castSkills.slots) {
            if (slot.slot !== 'passive') continue;
            for (const ability of slot.abilities) {
                if (ability.trigger !== 'pre-combat') continue;
                const cfg = ability.config;
                if (cfg.type !== 'shield' || cfg.basis !== 'hp') continue;
                const maxHp = rt.actor.stats.hp;
                rt.actor.shieldPool = Math.min(
                    rt.actor.shieldPool + maxHp * (cfg.pct / 100),
                    maxHp
                );
            }
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Enemy PlayerActorRuntime builder (Task 5; consumed by the Task 6b dispatch)
//
// Constructs a FULL PlayerActorRuntime for a healing-mode enemy attacker, mirroring
// the walked-team construction. The enemy walks runPlayerTurn bound to the heal target
// (Task 6b dispatch): its damage drains into the target, self-buffs land in its own owner
// store, debuffs/DoTs on the target's per-target store.
//
// Design decisions:
//   manual enemy:  A flat-card enemy (no shipSkills) gets a synthesized single-slot basic
//                  attack (100% multiplier, 1 hit, crit-eligible) so the walk produces
//                  byte-identical damage to the retired runEnemyAttackerTurn manual path.
//   defence/hp:    The enemy's own stats (default 0 until Task 9 populates real values
//                  via the adapter).
//   affinity:      Neutral placeholder (modifier 0, cap 100, penalty 0, no disadvantage).
//                  Task 9 wires real matchup after the affinity selector lands.
//   selfBuffLookup: Empty map (walked-style: payload effects are self-contained).
//   enemyDebuffLookup: The engine's global map (same as walked-team actors).
//   status registration: registerActorAbilityStatuses registers any buff/debuff abilities
//                  the enemy's kit carries (no-op for damage-only shipSkills).
// ─────────────────────────────────────────────────────────────────────────────

/** Input shape for buildEnemyPlayerActorRuntime. Mirrors CombatEngineInput['enemyAttackers'][number]. */
export interface EnemyActorInput {
    id: string;
    stats: {
        attack: number;
        crit: number;
        critDamage: number;
        speed: number;
        defence?: number;
        hp?: number;
        /** Base hacking (A2 Task 2). Optional — flows onto the enemy CombatActor's stats.hacking
         *  (base for effectiveStatsOf.hacking). No production reader until landing lands (A2 Task 4). */
        hacking?: number;
        /** Base security (A2 Task 2). Optional — flows onto the enemy CombatActor's stats.security
         *  (base for effectiveStatsOf.security). No production reader until landing lands (A2 Task 4). */
        security?: number;
        /** Shield penetration (H1 Task 2). Optional — flows onto the enemy CombatActor's
         *  stats.shieldPenetration. No production reader until H1 Task 4 wires the apply path. */
        shieldPenetration?: number;
        /** Heal-modifier % (SP-F F4). Folded into this enemy's own heal casts as
         *  `(1 + healModifier/100)`, team-symmetric with the player focus/walk paths. Optional —
         *  undefined treated as 0. */
        healModifier?: number;
    };
    chargeCount: number;
    startCharged: boolean;
    shipSkills?: ShipSkills;
    /** Pre-resolved affinity damage modifier (from computeAffinityModifiers). Default 0 (neutral). */
    affinityDamageModifier?: number;
    /** Pre-resolved crit cap (from computeAffinityModifiers). Default 100 (neutral). */
    affinityCritCap?: number;
    /** Pre-resolved crit penalty (from computeAffinityModifiers). Default 0 (neutral). */
    affinityCritPenalty?: number;
    /** Board position of this enemy. Consumed by isPositional/resolvePositionalTarget at the
     *  enemy-turn positional target-selection and footprint-apply sites. */
    position?: Position;
    /** Attacker ignores Taunt/Provoke forced targeting (not Concentrate Fire). Populated from the
     *  ship's own skill text via buildShipAbilities/detectIgnoresForcedTargeting; ORed at the read
     *  sites with the timed `Rogue's Liberty` buff (rogueLiberty.ts). */
    ignoresForcedTargeting?: boolean;
    /** W6: ship-wide stealth-targeting bypass. */
    ignoresStealth?: boolean;
    /** Attacker's direct hits do NOT break Stasis (Akula / Tygr). Gated at the break-mark
     *  site (§4.5 Akula exception). Optional — undefined treated as false. */
    doesntBreakStasis?: boolean;
    /** Attacker is immune to charge loss effects (Lev). Enemy-sourced charge removal is a
     *  no-op against actors with this flag set (Phase 0 Task 7). Optional — undefined = false. */
    chargeLossImmune?: boolean;
    /** Pre-parsed targeting preference for this enemy. Consumed by the enemy-turn positional
     *  target selection AND the positional apply at the enemy damage site (threaded via
     *  enemyTargetById). */
    target?: ParsedTarget;
    /** Pre-parsed positional pattern for this enemy. Consumed by the positional apply at the
     *  enemy damage site (origin/covered footprint expansion; threaded via enemyPatternById). */
    pattern?: ParsedPattern;
    /** Pre-parsed charged-skill pattern when it differs from active; falls back to `pattern`. */
    chargedPattern?: ParsedPattern;
    /** SP-F F5: pre-parsed charged-skill TARGET selection when it differs from active; falls
     *  back to `target`. Drives BOTH the damage footprint anchor AND target-selection on a
     *  charge-firing turn (mirrors `chargedPattern`'s contract). */
    chargedTarget?: ParsedTarget;
    /** RAW affinity of this enemy attacker — the SAME affinity the adapter fed to
     *  computeAffinityModifiers to produce `affinityDamageModifier` above. Threaded onto the
     *  runtime's attackerAffinity (consumed by the positional apply path via
     *  positionalScalars.attackerAffinity → victimHitDamage's per-victim matchup recompute) +
     *  the CombatActor.affinity (consumed wherever a victim's own affinity is read). Absent →
     *  neutral default ('antimatter') downstream. */
    affinity?: AffinityName;
    /** Pre-fight combat-modifier baseline (sub-project F, PR F3) — squad-leader modifier
     *  channels for this enemy attacker. Absent → all folds inert (byte-identical). */
    preFight?: PreFightCombatModifiers;
    /** SP-F F5: this enemy attacker's ship role (Ship.type), for role-filtered classification —
     *  today only Meatshield's defense-substitution "non-defender ally" gate (roleByActorId,
     *  matchesRoleCategory(..., ['DEFENDER'])). Mirrors TeamActorInput.role's contract: absent →
     *  the substitution gate treats an unknown role as dormant (no substitution) rather than
     *  assuming non-defender — consistent with Graphite's role-filtered reaction also staying
     *  dormant on an unknown role (matchesRoleCategory(undefined, ...) is always false). */
    role?: ShipTypeName;
    /** SP-F F4: this enemy attacker's ship name, for the live `ally-on-team` roster check
     *  (Isha/Nayra reciprocal Override gate). Absent → not added to the name map → the gate
     *  falls back to assume-met (byte-identical). */
    name?: string;
}

/** Build a full PlayerActorRuntime for a healing-mode enemy attacker.
 *  Exported for unit-testing; called inside runCombat. The enemy-dispatch branch
 *  walks runPlayerTurn with this runtime, bound to the heal target (Task 6b). */
export function buildEnemyPlayerActorRuntime(
    e: EnemyActorInput,
    ctx: {
        statusEngine: StatusEngine;
        // Enemy-team recipient order (mirror of playerIds for player actors): the enemy ATTACKER
        // ids in input order. An enemy supporter's `ally`/`all-allies` cast buffs route to THIS
        // list so they land on the enemy team (raising other enemies' damage to the tank) instead
        // of leaking onto the player team.
        enemyIds: string[];
        enemyDebuffLookup: Map<string, SelectedGameBuff[]>;
    }
): PlayerActorRuntime {
    const { statusEngine, enemyIds, enemyDebuffLookup } = ctx;

    // Manual flat-card enemy (no shipSkills): synthesize a single basic-attack active slot
    // (100% multiplier, 1 hit, crit-eligible) so the runPlayerTurn walk produces byte-identical
    // damage to the retired runEnemyAttackerTurn manual path. A ship-backed enemy uses its real
    // shipSkills. The synthesized ability is on-cast/target-enemy → survives reactive partition.
    const sourceSkills: ShipSkills = e.shipSkills ?? {
        slots: [
            {
                slot: 'active',
                abilities: [
                    {
                        id: `${e.id}-basic`,
                        type: 'damage',
                        target: 'enemy',
                        trigger: 'on-cast',
                        conditions: [],
                        config: { type: 'damage', multiplier: 100, hits: 1 },
                    },
                ],
            },
        ],
    };

    // Partition reactive abilities out of castSkills (mirrors walked-team pattern).
    // Damage abilities are never reactive, so the synthesized basic stays in castSkills; a
    // ship-backed enemy's reactive abilities (if any) partition out as for a walked team actor.
    const { castSkills, reactiveAbilities } = partitionReactiveAbilities(sourceSkills);

    // Register this enemy actor's cast buff/debuff abilities (no-op for damage-only
    // shipSkills; safe to call defensively). Own ownerId = actor id. `enemyIds` is the
    // same-side ally-recipient order: an enemy supporter's `ally`/`all-allies` buff routes
    // onto the ENEMY team (aura/accum fan out per enemy store; timed carry `recipients` for
    // the per-recipient apply loop), so it folds into each enemy's own turn rather than
    // leaking onto the player team.
    const { timedSelfBySlot, timedEnemyBySlot } = registerActorAbilityStatuses(
        castSkills,
        statusEngine,
        e.id,
        enemyIds
    );

    // hasChargedSkill: true only when the enemy banks charges (chargeCount >= 1) AND its
    // charged slot actually carries a damage ability (multiplier > 0). A manual flat card
    // (no shipSkills) never has a charged slot → false.
    const hasChargedSkill = e.shipSkills
        ? e.chargeCount >= 1 &&
          damageInputsFromSkill(selectFiringSkill(e.shipSkills, 'charged')).multiplier > 0
        : false;

    const actor = createActor({
        id: e.id,
        side: 'enemy',
        kind: 'enemy',
        stats: {
            attack: e.stats.attack,
            crit: e.stats.crit,
            critDamage: e.stats.critDamage,
            defensePenetration: 0,
            shieldPenetration: e.stats.shieldPenetration ?? 0,
            defence: e.stats.defence ?? 0,
            hp: e.stats.hp ?? 0,
            speed: e.stats.speed,
            // Base hacking/security (A2 Task 2) — base for effectiveStatsOf; unread until landing lands (A2 Task 4).
            hacking: e.stats.hacking,
            security: e.stats.security,
        },
        chargeCount: e.chargeCount,
        startCharged: e.startCharged,
        position: e.position,
        ignoresForcedTargeting: e.ignoresForcedTargeting,
        ignoresStealth: e.ignoresStealth,
        doesntBreakStasis: e.doesntBreakStasis,
        chargeLossImmune: e.chargeLossImmune,
        affinity: e.affinity,
        preFight: e.preFight,
    });

    // Resolved affinity fields — pre-computed by the adapter via computeAffinityModifiers
    // (enemy as attacker, heal target as defender). Absent → neutral defaults (damageMod 0,
    // cap 100, penalty 0), preserving byte-identical behaviour for fixtures without affinity.
    const resolvedDamageMod = e.affinityDamageModifier ?? 0;
    const resolvedCritCap = e.affinityCritCap ?? 100;
    const resolvedCritPenalty = e.affinityCritPenalty ?? 0;
    const affinityDisadvantage = resolvedDamageMod < 0;
    // Own gate instances — separate draw streams so this enemy's crit/heal-crit/debuff/extend
    // rolls are fully isolated from every other actor's deterministic schedule. Keyed by this
    // enemy's own id + purpose (SP-0 Task 3) so, under the keyed test provider, its draws come
    // from a sub-stream no other actor shares; production (no keyed provider) is unaffected.
    const enemyActiveCritGate = makeRateGate(`${e.id}:active-crit`);
    const enemyChargedCritGate = makeRateGate(`${e.id}:charged-crit`);
    const enemyActiveHealCritGate = makeRateGate(`${e.id}:active-heal-crit`);
    const enemyChargedHealCritGate = makeRateGate(`${e.id}:charged-heal-crit`);
    const enemyDebuffLandingGate = makeRateGate(`${e.id}:landing`);
    const enemyExtendChanceGate = makeRateGate(`${e.id}:extend`);
    // The landing closure reads the runtime's LIVE per-target landing chance (A2 Task 4 — set
    // each turn by runPlayerTurn) and falls back to the threaded scalar. It references `runtime`
    // (defined in the same const initializer); the arrow BODY runs only at turn time, well after
    // construction, so the self-reference is safe.
    const runtime: PlayerActorRuntime = {
        actor,
        focus: false,
        castSkills,
        reactiveAbilities,
        timedSelfBySlot,
        timedEnemyBySlot,
        hasChargedSkill,
        attack: e.stats.attack,
        crit: e.stats.crit,
        critDamage: e.stats.critDamage,
        defensePenetration: 0,
        defence: e.stats.defence ?? 0,
        hp: e.stats.hp ?? 0,
        // SP-F F4: fold the enemy's own heal-modifier (team symmetry with the player focus/walk
        // paths); was hard-coded 0 before F4. Undefined → 0.
        healModifier: e.stats.healModifier ?? 0,
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        affinityDamageModifier: resolvedDamageMod,
        affinityCritCap: resolvedCritCap,
        affinityCritPenalty: resolvedCritPenalty,
        affinityDisadvantage,
        // RAW affinity — sourced from the SAME e.affinity the adapter fed to
        // computeAffinityModifiers for resolvedDamageMod, so the two never disagree. Positional
        // plumbing: read by victimHitDamage for per-victim re-resolution (Task 8b/9). Undefined →
        // neutral 'antimatter' default downstream.
        attackerAffinity: e.affinity,
        allyChargePerRound: undefined,
        activeCritGate: enemyActiveCritGate,
        chargedCritGate: enemyChargedCritGate,
        activeHealCritGate: enemyActiveHealCritGate,
        chargedHealCritGate: enemyChargedHealCritGate,
        debuffLandingGate: enemyDebuffLandingGate,
        extendChanceGate: enemyExtendChanceGate,
        landsTimedEnemyApplication: (
            application?: 'inflict' | 'apply',
            targetAffinity?: AffinityName
        ): boolean =>
            application === 'apply'
                ? // Target-aware (Task A): when the ACTUAL target's affinity is supplied, re-resolve
                  // the applier's RAW affinity (e.affinity, same value fed to attackerAffinity) vs
                  // that target — an 'apply' lands UNLESS the applier is at a disadvantage. Absent
                  // (DPS/unit mode, single representative opponent) → the static flag, which already
                  // equals the target-aware result there → byte-identical.
                  targetAffinity !== undefined
                    ? getAffinityMatchup(e.affinity, targetAffinity) !== 'disadvantage'
                    : !affinityDisadvantage
                : enemyDebuffLandingGate(runtime.liveDebuffLandingChance ?? 1), // fresh timed inflictions draw against this enemy's LIVE hacking-vs-security landing chance (?? 1 — neutral guard for a read before the owner's first turn)
        selfBuffLookup: new Map(),
        enemyDebuffLookup,
    };
    return runtime;
}

function totalStacks(entries: ActiveDoTStack[]): number {
    return entries.reduce((sum, e) => sum + e.stacks, 0);
}

/** De-dupe ActiveBuffs by buffName, keeping the first occurrence. Used to collapse the
 *  per-round enemy-effects union (multiple enemy attackers can carry the same status) so
 *  the UI shows each effect once per round (Task 10). */
function dedupeByBuffName(buffs: ActiveBuff[]): ActiveBuff[] {
    const seen = new Set<string>();
    const out: ActiveBuff[] = [];
    for (const b of buffs) {
        if (seen.has(b.buffName)) continue;
        seen.add(b.buffName);
        out.push(b);
    }
    return out;
}

/** Merge a pre-tick DoT snapshot with the live (post-tick) container for display purposes.
 *  Live entries take precedence (they reflect the current state after the tick). Snapshot
 *  entries whose (sourceId, tier) key is absent from live are appended — those are the DoTs
 *  that ticked AND expired within this round (the tick-and-expire case: CodeRabbit finding). */
function mergeDoTsForDisplay(
    snapshot: Pick<ActiveDoTStack, 'sourceId' | 'tier' | 'stacks'>[],
    live: Pick<ActiveDoTStack, 'sourceId' | 'tier' | 'stacks'>[]
): Pick<ActiveDoTStack, 'sourceId' | 'tier' | 'stacks'>[] {
    if (snapshot.length === 0) return live;
    const liveKeys = new Set(live.map((e) => `${e.sourceId}-${e.tier}`));
    const expiredOnly = snapshot.filter((e) => !liveKeys.has(`${e.sourceId}-${e.tier}`));
    return expiredOnly.length === 0 ? live : [...live, ...expiredOnly];
}

/** Assemble the per-round `EnemyRoundEffects[]` for the healing UI (Task 4a). Each enemy that acted
 *  (in `roundEnemyEffects`, keyed by actor id) keeps its de-duped self-buffs/debuffs; on top, the
 *  DoTs ACTIVE on the heal target this round are attributed to their applier via the stack
 *  `sourceId`, summed per type+tier (mirroring the DPS active-DoT display). A DoT-only enemy (no
 *  self-buffs/debuffs, so absent from `roundEnemyEffects`) gets a fresh entry appended so its DoTs
 *  still surface. NAMES/COUNTS ONLY for display — never folded into a sim value. */
function buildEnemyRoundEffects(
    roundEnemyEffects: Map<
        string,
        {
            selfBuffs: ActiveBuff[];
            debuffs: ActiveBuff[];
            resistedDebuffs: ActiveBuff[];
            resistedDots: EnemyDoTState[];
        }
    >,
    corrosionEntries: Pick<ActiveDoTStack, 'sourceId' | 'tier' | 'stacks'>[],
    infernoEntries: Pick<ActiveDoTStack, 'sourceId' | 'tier' | 'stacks'>[]
): EnemyRoundEffects[] {
    // Sum active stacks per source → type → tier, preserving first-seen source order.
    const dotsBySource = new Map<string, Map<string, EnemyDoTState>>();
    const accumulate = (
        type: DoTType,
        entries: Pick<ActiveDoTStack, 'sourceId' | 'tier' | 'stacks'>[]
    ): void => {
        for (const e of entries) {
            let byKey = dotsBySource.get(e.sourceId);
            if (!byKey) {
                byKey = new Map();
                dotsBySource.set(e.sourceId, byKey);
            }
            const key = `${type}-${e.tier}`;
            const existing = byKey.get(key);
            if (existing) existing.stacks += e.stacks;
            else byKey.set(key, { type, tier: e.tier, stacks: e.stacks });
        }
    };
    accumulate('corrosion', corrosionEntries);
    accumulate('inferno', infernoEntries);

    // Merge resisted DoTs by type+tier, summing stacks — consistent with the landed `dots`
    // accumulate-by-type+tier semantics above so repeats collapse to one row.
    const mergeResistedDots = (dots: EnemyDoTState[]): EnemyDoTState[] => {
        const byKey = new Map<string, EnemyDoTState>();
        for (const d of dots) {
            const key = `${d.type}-${d.tier}`;
            const existing = byKey.get(key);
            if (existing) existing.stacks += d.stacks;
            else byKey.set(key, { ...d });
        }
        return Array.from(byKey.values());
    };

    const out: EnemyRoundEffects[] = [];
    const emitted = new Set<string>();
    // Enemies that acted (self-buffs/debuffs) first, in their acting order — each gains its DoTs.
    for (const [enemyId, e] of roundEnemyEffects) {
        emitted.add(enemyId);
        out.push({
            enemyId,
            selfBuffs: dedupeByBuffName(e.selfBuffs),
            debuffs: dedupeByBuffName(e.debuffs),
            dots: Array.from(dotsBySource.get(enemyId)?.values() ?? []),
            resistedDebuffs: dedupeByBuffName(e.resistedDebuffs),
            resistedDots: mergeResistedDots(e.resistedDots),
        });
    }
    // DoT-only enemies (active DoTs but no self-buffs/debuffs) appended in container order.
    for (const [sourceId, byKey] of dotsBySource) {
        if (emitted.has(sourceId)) continue;
        emitted.add(sourceId);
        out.push({
            enemyId: sourceId,
            selfBuffs: [],
            debuffs: [],
            dots: Array.from(byKey.values()),
            resistedDebuffs: [],
            resistedDots: [],
        });
    }
    return out;
}

function expireStacks(entries: ActiveDoTStack[]): void {
    for (let i = entries.length - 1; i >= 0; i--) {
        entries[i].remainingRounds -= 1;
        if (entries[i].remainingRounds <= 0) {
            entries.splice(i, 1);
        }
    }
}

// Step 6: Process bombs — their burst is detonation damage (same category as Step 2.95).
// `emitBombDetonated` is called once per burst (per detonating bomb entry) so Phase 3
// reactive triggers can observe each burst's actorId, round, stacks, and damage.
// Per-actor attribution (Task 4): each burst uses the APPLIER's affinityMult (snapshotted at
// application) and is credited to that applier's detonation channel via `creditDetonation`.
// `actorIdFor` supplies the bomb-detonated event's actorId (the applier).
function processBombs(args: {
    pendingBombs: PendingBomb[];
    emitBombDetonated?: (actorId: string, stacks: number, damage: number) => void;
    creditDetonation: (sourceId: string, damage: number) => void;
}): void {
    for (let i = args.pendingBombs.length - 1; i >= 0; i--) {
        args.pendingBombs[i].countdown -= 1;
        if (args.pendingBombs[i].countdown <= 0) {
            const bomb = args.pendingBombs[i];
            const burstDamage =
                bomb.stacks *
                bomb.damagePerStack *
                bomb.affinityMult *
                (1 + bomb.detonationDamageModifier / 100);
            args.emitBombDetonated?.(bomb.sourceId, bomb.stacks, burstDamage);
            args.creditDetonation(bomb.sourceId, burstDamage);
            args.pendingBombs.splice(i, 1);
        }
    }
}

// Step 6b: Echoing Burst accumulators gather this round's direct damage, then detonate
// for pct% of the accumulated total on expiry (game-categorised as detonation damage).
// directDamage already includes affinity, so no extra affinity multiplier is applied.
// Per-actor attribution (Task 4): the accumulation INPUT is the summed direct damage of ALL
// players this round (spec: Echoing Burst gathers all players' direct); the OUTPUT burst is
// credited to the accumulator's applier via `creditDetonation`.
function processAccumulators(args: {
    pendingAccumulators: PendingAccumulator[];
    allPlayersDirect: number;
    creditDetonation: (sourceId: string, damage: number) => void;
}): void {
    for (let i = args.pendingAccumulators.length - 1; i >= 0; i--) {
        const acc = args.pendingAccumulators[i];
        acc.accumulated += args.allPlayersDirect;
        acc.roundsRemaining -= 1;
        if (acc.roundsRemaining <= 0) {
            args.creditDetonation(acc.sourceId, acc.accumulated * (acc.pct / 100));
            args.pendingAccumulators.splice(i, 1);
        }
    }
}

// Steps 4 & 5: Tick corrosion (scales with enemy HP, capped at 5000 dmg per 1%) and
// inferno (scales with the APPLIER's effective attack, no outgoing buff), then expire both
// stack sets. Per-actor attribution (Task 4): each entry ticks with its applier's ctx (looked
// up via `ctxFor(entry.sourceId)`) — inferno uses the applier's effectiveAttack, both use the
// applier's dotMult/affinityMult; corrosion stays enemy-HP-based. An entry whose applier has
// no ctx yet (faster-enemy round 1) is skipped this tick (its applier acts later). Damage is
// credited per applier via `credit`; the `dot-ticked` event carries the per-dotType SUMMED
// damage (preserving the pre-Task-4 single-event-per-type emission). At attacker-only this
// produces byte-identical totals (exactly one applier → same sums).
//
// Sub-project I, PR I4b: `dotMultFor(ctx)` replaces the bare `ctx.dotMult` read for BOTH
// dotTypes — it re-folds any enemy-status-name-gated dotDamage modifier (Wildfire) against
// THIS call's ticking victim, live, at tick time (see `victimDotMult`). Every call site that
// doesn't pass it (or an applier ctx with no such modifier) is unaffected: `ctx.dotMult` alone.
/** DoT types `tickDoTs` handles as a per-round tick — everything except 'bomb' (bombs burst on a
 *  timed countdown via `processBombs`, a separate mechanism, never a per-round tick). SP-E: added
 *  'generic' alongside 'corrosion'/'inferno'. */
type TickableDoTType = Exclude<DoTType, 'bomb'>;

export function tickDoTs(args: {
    corrosionEntries: ActiveDoTStack[];
    infernoEntries: ActiveDoTStack[];
    /** SP-E: absolute per-tick generic DoT entries (Voron/Orel transform, Acidic Decay family). */
    genericDoTEntries: ActiveDoTStack[];
    enemyHp: number;
    ctxFor: (sourceId: string) => PlayerRoundCtx | undefined;
    /** Called ONCE PER (dotType, tier) GROUP that ticked (corrosion/inferno split by tier so the
     *  combat log shows "corrosion I ×n" and "corrosion III ×m" on separate lines; generic emits a
     *  single tier-0 call). `stacks` = the summed ticking stacks for that group (only entries with a
     *  resolvable applier ctx are counted for corrosion/inferno; generic counts all). `tier` = the
     *  group's tier MAGNITUDE (corrosion 3/6/9, inferno 15/30/45; 0 for generic). */
    emitTicked: (dotType: TickableDoTType, damage: number, stacks: number, tier: number) => void;
    credit: (sourceId: string, dotType: TickableDoTType, damage: number) => void;
    /** D-PR3 (Vortex Veil): % reduction applied to this carrier's DoT ticks of the given type.
     *  Absent → 0 → byte-identical. */
    incomingDotReductionPct?: (dotType: TickableDoTType) => number;
    /** Sub-project I, PR I4b — resolves the EFFECTIVE dotMult for one applier's ctx, given the
     *  ticking VICTIM (this tickDoTs call's whole entries list belongs to ONE victim, so the
     *  victim is fixed for the call; only the per-entry applier ctx varies). Defaults to the
     *  applier's `ctx.dotMult` unchanged — every call site that doesn't (yet) pass this stays
     *  byte-identical. Production call sites pass the engine's `victimDotMult` closure. */
    dotMultFor?: (ctx: PlayerRoundCtx) => number;
}): void {
    const dotMultFor = args.dotMultFor ?? ((ctx: PlayerRoundCtx) => ctx.dotMult);
    // Per-(dotType,tier) tick group — the combat log shows each tier on its own line, so a mix of
    // e.g. Corrosion I and Corrosion III does not collapse into one summed line. `credits` keeps
    // the per-entry credit list IN ENTRY ORDER so crediting is byte-identical to the pre-grouping
    // single-loop behaviour; only the log-facing `emitTicked` granularity changes.
    interface TickGroup {
        sum: number;
        stacks: number;
        credits: Array<{ sourceId: string; d: number }>;
    }
    // Sum-then-emit for a whole DoT type, split by tier. Emits per tier ASCENDING (deterministic
    // log order, independent of entry order). Credits run in entry order across all tiers, exactly
    // as before, so total credited damage and RNG-free credit order are unchanged.
    const tickByTier = (
        dotType: 'corrosion' | 'inferno',
        entries: ActiveDoTStack[],
        damageOf: (e: ActiveDoTStack, ctx: PlayerRoundCtx) => number
    ): void => {
        const byTier = new Map<number, TickGroup>();
        const creditOrder: Array<{
            sourceId: string;
            dotType: 'corrosion' | 'inferno';
            d: number;
        }> = [];
        let total = 0;
        for (const e of entries) {
            const ctx = args.ctxFor(e.sourceId);
            if (!ctx) continue; // applier has not acted yet this run (faster-enemy round 1)
            const d = damageOf(e, ctx);
            let g = byTier.get(e.tier);
            if (!g) {
                g = { sum: 0, stacks: 0, credits: [] };
                byTier.set(e.tier, g);
            }
            g.sum += d;
            g.stacks += e.stacks;
            creditOrder.push({ sourceId: e.sourceId, dotType, d });
            total += d;
        }
        if (total <= 0) return;
        const reductionPct = args.incomingDotReductionPct?.(dotType) ?? 0;
        const factor = 1 - reductionPct / 100;
        for (const { sourceId, d } of creditOrder) args.credit(sourceId, dotType, d * factor);
        for (const tier of [...byTier.keys()].sort((a, b) => a - b)) {
            const g = byTier.get(tier)!;
            if (g.sum <= 0) continue;
            args.emitTicked(dotType, g.sum * factor, g.stacks, tier);
        }
    };

    // Step 4: Tick corrosion (scales with enemy HP, capped at 5000 dmg per 1%)
    const corrosionBaseHp = Math.min(args.enemyHp, 500_000);
    tickByTier(
        'corrosion',
        args.corrosionEntries,
        (e, ctx) => e.stacks * (e.tier / 100) * corrosionBaseHp * dotMultFor(ctx) * ctx.affinityMult
    );

    // Step 5: Tick inferno (scales with the applier's effective attack, no outgoing buff)
    tickByTier(
        'inferno',
        args.infernoEntries,
        (e, ctx) =>
            e.stacks * (e.tier / 100) * ctx.effectiveAttack * dotMultFor(ctx) * ctx.affinityMult
    );

    // SP-E: Tick generic DoTs — an ABSOLUTE per-tick amount, independent of stats/HP (no ctxFor
    // gate: unlike corrosion/inferno, a generic tick doesn't need the applier's effective attack
    // or affinity, so it ticks even before the applier's first turn this run).
    let genericSum = 0;
    let genericStacks = 0;
    const genericCredits: Array<{ sourceId: string; d: number }> = [];
    for (const e of args.genericDoTEntries) {
        const d = (e.perTickAmount ?? 0) * e.stacks;
        genericCredits.push({ sourceId: e.sourceId, d });
        genericSum += d;
        genericStacks += e.stacks;
    }
    if (genericSum > 0) {
        const reductionPct = args.incomingDotReductionPct?.('generic') ?? 0;
        const factor = 1 - reductionPct / 100;
        for (const { sourceId, d } of genericCredits) args.credit(sourceId, 'generic', d * factor);
        // Generic DoTs are untiered (absolute per-tick) → single tier-0 group.
        args.emitTicked('generic', genericSum * factor, genericStacks, 0);
    }

    // Expire DoT stacks after ticking
    expireStacks(args.corrosionEntries);
    expireStacks(args.infernoEntries);
    expireStacks(args.genericDoTEntries);
}

/** Damage-credit channels the standing-leech hook distinguishes (damage-leech spec §4). */
type LeechChannel = 'direct' | 'detonation' | 'corrosion' | 'inferno' | 'generic';

/** A team actor input as the ENGINE consumes it: the public TeamActorInput plus an
 *  optional `walk` bundle the adapter (simulateDPS) resolves when the actor carries
 *  shipSkills. With `walk` the actor runs the full runPlayerTurn pipeline; without it it
 *  stays the legacy scheduled-list source (byte-identical to pre-walk behaviour). The
 *  walk's per-actor rates are pre-derived by the adapter (same shape as the attacker's). */
export type TeamActorEngineInput = TeamActorInput & {
    walk?: {
        shipSkills: ShipSkills;
        stats: CombatStatBlock;
        selfDotModifier: number;
        defensePenetrationBuff: number;
        affinityDamageModifier: number;
        affinityCritCap: number;
        affinityCritPenalty: number;
        hasChargedSkill: boolean;
        /** Caster heal-modifier stat (healing calc). Default 0. */
        healModifier?: number;
        /** RAW affinity of this team actor — the SAME affinity (TeamActorInput.affinity) the
         *  adapter fed to computeAffinityModifiers to produce `affinityDamageModifier` in this
         *  bundle, so the two never disagree. Threaded onto the runtime's attackerAffinity
         *  (consumed by the positional apply path via positionalScalars.attackerAffinity →
         *  victimHitDamage's per-victim matchup recompute) + the CombatActor.affinity (consumed
         *  wherever a victim's own affinity is read). Absent → neutral default ('antimatter')
         *  downstream. */
        affinity?: AffinityName;
    };
    /** Board position of this team actor. Consumed by isPositional/resolvePositionalTarget at
     *  the walked-team positional target-selection and footprint-apply sites. */
    position?: Position;
    /** Attacker ignores Taunt/Provoke forced targeting (not Concentrate Fire). Populated from the
     *  ship's own skill text via buildShipAbilities/detectIgnoresForcedTargeting; ORed at the read
     *  sites with the timed `Rogue's Liberty` buff (rogueLiberty.ts). */
    ignoresForcedTargeting?: boolean;
    /** W6: ship-wide stealth-targeting bypass. */
    ignoresStealth?: boolean;
    /** Attacker's direct hits do NOT break Stasis (Akula / Tygr). Gated at the break-mark
     *  site (§4.5 Akula exception). Optional — undefined treated as false. */
    doesntBreakStasis?: boolean;
    /** Attacker is immune to charge loss effects (Lev). Enemy-sourced charge removal is a
     *  no-op against actors with this flag set (Phase 0 Task 7). Optional — undefined = false. */
    chargeLossImmune?: boolean;
    /** Pre-parsed targeting preference for this team actor. Consumed by the walked-team
     *  positional target selection AND the Task 8b positional apply at the team damage site. */
    target?: ParsedTarget;
    /** Pre-parsed positional pattern for this team actor. Consumed by the Task 8b positional
     *  apply at the team damage site (origin/covered footprint expansion). */
    pattern?: ParsedPattern;
    /** Pre-parsed charged-skill pattern when it differs from active; falls back to `pattern`. */
    chargedPattern?: ParsedPattern;
    /** SP-F F5: pre-parsed charged-skill TARGET selection when it differs from active; falls
     *  back to `target`. Drives BOTH the damage footprint anchor AND target-selection on a
     *  charge-firing turn (mirrors `chargedPattern`'s contract). */
    chargedTarget?: ParsedTarget;
    /** Pre-fight combat-modifier baseline (sub-project F, PR F3) — squad-leader modifier
     *  channels for this team actor. Absent → all folds inert (byte-identical). */
    preFight?: PreFightCombatModifiers;
};

export interface CombatEngineInput {
    attack: number;
    crit: number;
    critDamage: number;
    defensePenetration: number;
    /** Shield penetration for the focus attacker (H1 Task 2). Optional — defaults to 0 at the
     *  actor-construction site. No production reader until H1 Task 4 wires the apply path. */
    shieldPenetration?: number;
    chargeCount: number;
    shipSkills: ShipSkills;
    /** Optional (F7) — omitted only by `battleSimulator.ts`'s positional call, where the
     *  dummy `enemy` actor these feed is vestigial (never read as a victim's stats there).
     *  `dpsSimulator.ts` (DPS mode) and `healingEngineAdapter.ts` still pass real values —
     *  the latter's healer can cast a `damage` ability at `target:'enemy'`, landing on this
     *  dummy and feeding `basis:'damage-dealt'` heal/shield riders, so its defence/HP are
     *  load-bearing there (see docs/superpowers/notes/2026-07-13-f7-dummy-audit.md follow-up).
     *  Absent → defaults to a huge-HP/zero-defence sink internally. */
    enemyDefense?: number;
    enemyHp?: number;
    numRounds: number;
    /** Scheduled (manual + team) buffs — statusEngine input. */
    selfBuffs: SelectedGameBuff[];
    enemyDebuffs: SelectedGameBuff[];
    /** Team ships as real speed-ordered actors (Phase 2). Their buff lists are keyed to
     *  their own turns via the status engine's teamSources, NOT merged into selfBuffs/
     *  enemyDebuffs (no-double-count). */
    teamActors?: TeamActorEngineInput[];
    // Rate/fold fields below (selfDotModifier, defensePenetrationBuff)
    // are pre-derived by the adapter (simulateDPS) — pass the resolved values, not raw hacking.
    selfDotModifier: number;
    defensePenetrationBuff: number;
    hasChargedSkill: boolean;
    startCharged: boolean;
    affinityDamageModifier: number;
    affinityCritCap: number;
    affinityCritPenalty: number;
    defence: number;
    hp: number;
    /** Focus attacker's base hacking (A2 Task 2). Optional — base for effectiveStatsOf.hacking on the
     *  attacker actor. The adapter passes `input.hacking ?? 200` (the OLD landing-formula default); no
     *  production reader until dynamic landing lands (A2 Task 4). */
    hacking?: number;
    /** Focus attacker's base security. Optional — base for effectiveStatsOf.security on the
     *  attacker actor. Threaded so the focus actor's own security (e.g. gear-folded via Code
     *  Guard) reaches both the per-turn stats-snapshot and the live debuff-landing recompute
     *  when the focus is the target of an enemy debuff, instead of silently defaulting. */
    security?: number;
    /** DPS dummy enemy's base security (A2 Task 2). Optional — base for effectiveStatsOf.security on the
     *  dummy enemy actor. The adapter passes `input.enemySecurity ?? 100` (the OLD landing-formula default);
     *  no production reader until dynamic landing lands (A2 Task 4). */
    enemySecurity?: number;
    allyChargePerRound?: number;
    enemyType?: EnemyBaseClass;
    /** Attacker turn-order speed. Default 100. */
    speed?: number;
    /** Enemy turn-order speed. Default 50 — the enemy acts last at default speeds. */
    enemySpeed?: number;
    /** Caster heal-modifier stat (healing calc). Default 0. */
    healModifier?: number;
    /** FOCUS actor's ship role (Ship.type) for role-filtered ally-damage reactions
     *  (Graphite's "when a Defender or Debuffer ally takes damage"). Team actors carry
     *  their own `role` on TeamActorInput. Absent (manual stats / no ship picked) →
     *  the focus actor never matches a role filter — the reaction stays dormant for
     *  hits on it (conservative; mirrors TeamActorInput.role's contract). */
    role?: ShipTypeName;
    /** SP-F F4: FOCUS actor's ship name, for the live `ally-on-team` roster check (Isha/Nayra
     *  reciprocal Override gate). Absent → assume-met fallback (byte-identical). */
    name?: string;
    /** Healing mode switch (healing calc): the player actor id that heals/shields route to
     *  and consume against. Must be a player actor id (focus or a team actor). When set, the
     *  engine runs in healing mode — heals/shields/cleanses are consumed and a `healing`
     *  result block is returned. Absent → DPS mode (the heal pipeline is fully inert). */
    healTargetId?: string;
    /** Positional team-vs-team battle (the combat simulator sets this), NOT the healing
     *  calculator. Threaded into the healing ctx so a PLAYER single-`ally` heal/shield resolves
     *  the lowest-HP living player ally (team-symmetric with the enemy side) instead of the
     *  vestigial `healTargetId` focus. See HealingRuntimeCtx.teamBattle. Default false. */
    positionalTeamBattle?: boolean;
    /** Enemy attackers (healing mode): offense-only queue actors bombarding the heal
     *  target. The singular dummy `enemy` remains the player-offense target + DoT carrier.
     *  `defence` and `hp` are optional now (default 0 for bare-stat legacy path); Task 9
     *  populates them with real matchup values via the adapter. */
    enemyAttackers?: {
        id: string;
        stats: {
            attack: number;
            crit: number;
            critDamage: number;
            speed: number;
            /** Enemy's own defence stat. Default 0. Task 9 provides real value. */
            defence?: number;
            /** Enemy's own hp stat. Default 0. Task 9 provides real value. */
            hp?: number;
            /** Base hacking (A2 Task 2). Optional — base for effectiveStatsOf.hacking; unread until A2 Task 4. */
            hacking?: number;
            /** Base security (A2 Task 2). Optional — base for effectiveStatsOf.security; unread until A2 Task 4. */
            security?: number;
            /** Shield penetration (H1 Task 2). Optional — flows onto the enemy CombatActor's
             *  stats.shieldPenetration. No production reader until H1 Task 4. */
            shieldPenetration?: number;
        };
        chargeCount: number;
        startCharged: boolean;
        shipSkills?: ShipSkills;
        /** Pre-resolved affinity damage modifier vs the heal target. Default 0 (neutral). */
        affinityDamageModifier?: number;
        /** Pre-resolved crit cap vs the heal target. Default 100 (neutral). */
        affinityCritCap?: number;
        /** Pre-resolved crit penalty vs the heal target. Default 0 (neutral). */
        affinityCritPenalty?: number;
        /** Board position of this enemy attacker. Consumed by isPositional/resolvePositionalTarget
         *  at the enemy-turn positional target-selection and footprint-apply sites. */
        position?: Position;
        /** Attacker ignores Taunt/Provoke forced targeting (not Concentrate Fire). Populated from the
         *  ship's own skill text via buildShipAbilities/detectIgnoresForcedTargeting; ORed at the read
         *  sites with the timed `Rogue's Liberty` buff (rogueLiberty.ts). */
        ignoresForcedTargeting?: boolean;
        /** W6: ship-wide stealth-targeting bypass. */
        ignoresStealth?: boolean;
        /** Attacker's direct hits do NOT break Stasis (Akula / Tygr). Gated at the break-mark
         *  site (§4.5 Akula exception). Optional — undefined treated as false. */
        doesntBreakStasis?: boolean;
        /** Attacker is immune to charge loss effects (Lev). Enemy-sourced charge removal is a
         *  no-op against actors with this flag set (Phase 0 Task 7). Optional — undefined = false. */
        chargeLossImmune?: boolean;
        /** Pre-parsed targeting preference for this enemy attacker. Consumed by the enemy-turn
         *  positional target selection AND the positional apply at the enemy damage site
         *  (threaded via enemyTargetById). */
        target?: ParsedTarget;
        /** Pre-parsed positional pattern for this enemy attacker. Consumed by the positional
         *  apply at the enemy damage site (origin/covered footprint expansion; threaded via
         *  enemyPatternById). */
        pattern?: ParsedPattern;
        /** Pre-parsed charged-skill pattern when it differs from active; falls back to `pattern`. */
        chargedPattern?: ParsedPattern;
        /** SP-F F5: pre-parsed charged-skill TARGET selection when it differs from active; falls
         *  back to `target`. Drives BOTH the damage footprint anchor AND target-selection on a
         *  charge-firing turn (mirrors `chargedPattern`'s contract). */
        chargedTarget?: ParsedTarget;
        /** RAW affinity of this enemy attacker — the SAME affinity the adapter fed to
         *  computeAffinityModifiers for `affinityDamageModifier` above. Threaded onto the
         *  runtime's attackerAffinity, consumed by the positional apply path via
         *  positionalScalars.attackerAffinity → victimHitDamage's per-victim matchup recompute.
         *  Absent → neutral default ('antimatter') downstream. */
        affinity?: AffinityName;
        /** Pre-fight combat-modifier baseline (sub-project F, PR F3) — squad-leader modifier
         *  channels for this enemy attacker. Absent → all folds inert (byte-identical). */
        preFight?: PreFightCombatModifiers;
        /** SP-F F5: this enemy attacker's ship role (Ship.type) — see EnemyActorInput.role's doc
         *  comment for the full contract (Meatshield defense-substitution's "non-defender ally"
         *  classification, side-agnostic via roleByActorId). */
        role?: ShipTypeName;
        /** SP-F F4: this enemy attacker's ship name — see EnemyActorInput.name (live
         *  `ally-on-team` roster check). Absent → assume-met fallback. */
        name?: string;
    }[];
    /** Emit-only event tap. Listeners must not read or mutate combat state. */
    bus?: CombatEventBus;
    /** Board position of the focus attacker. Consumed by isPositional/resolvePositionalTarget at
     *  the focus positional target-selection and footprint-apply sites. */
    position?: Position;
    /** Attacker ignores Taunt/Provoke forced targeting (not Concentrate Fire). Populated from the
     *  ship's own skill text via buildShipAbilities/detectIgnoresForcedTargeting; ORed at the read
     *  sites with the timed `Rogue's Liberty` buff (rogueLiberty.ts). */
    ignoresForcedTargeting?: boolean;
    /** W6: ship-wide stealth-targeting bypass. */
    ignoresStealth?: boolean;
    /** Attacker's direct hits do NOT break Stasis (Akula / Tygr). Gated at the break-mark
     *  site (§4.5 Akula exception). Optional — undefined treated as false. */
    doesntBreakStasis?: boolean;
    /** Attacker is immune to charge loss effects (Lev). Enemy-sourced charge removal is a
     *  no-op against actors with this flag set (Phase 0 Task 7). Optional — undefined = false. */
    chargeLossImmune?: boolean;
    /** Pre-parsed targeting preference for the focus attacker. Consumed by the focus positional
     *  target selection AND the Task 8b positional apply at the focus damage site. */
    target?: ParsedTarget;
    /** Pre-parsed positional pattern for the focus attacker. Consumed by the Task 8b positional
     *  apply at the focus damage site (origin/covered footprint expansion). */
    pattern?: ParsedPattern;
    /** Pre-parsed charged-skill pattern when it differs from active; falls back to `pattern`. */
    chargedPattern?: ParsedPattern;
    /** SP-F F5: pre-parsed charged-skill TARGET selection when it differs from active; falls
     *  back to `target`. Drives BOTH the damage footprint anchor AND target-selection on a
     *  charge-firing turn (mirrors `chargedPattern`'s contract). */
    chargedTarget?: ParsedTarget;
    /** RAW affinity of the focus attacker — the SAME affinity matchup the page resolved into the
     *  pre-resolved `affinityDamageModifier` above, so the two never disagree. Threaded onto the
     *  attacker runtime's attackerAffinity (consumed by the positional apply path via
     *  positionalScalars.attackerAffinity → victimHitDamage's per-victim matchup recompute) + the
     *  CombatActor.affinity (consumed wherever a victim's own affinity is read). Absent → neutral
     *  default ('antimatter') downstream. */
    affinity?: AffinityName;
    /** Pre-fight combat-modifier baseline (sub-project F, PR F3) — squad-leader modifier
     *  channels for the focus attacker. Absent → all folds inert (byte-identical). */
    preFight?: PreFightCombatModifiers;
    /** TEST-ONLY tap (Phase 4 PR1, Task 3): receives the genuine `applyOutgoingToEnemy` closure
     *  once on the first round it is built, so unit tests can exercise the player→enemy victim
     *  wrapper against a hand-built enemy actor. Never set by production code; the closure runs the
     *  real applyVictimDamage path (no mocks).
     *  KEPT (not removed once Task 8/9 wired production callers): `applyOutgoingToEnemy.test.ts`
     *  behaviour #6 — the enemy-side sink now records per-victim intake (incoming / shield-absorbed /
     *  barrier-absorbed into the victim's own bucket, since E1) — is unique coverage the
     *  positionalDamage integration test cannot observe (it only sees `ship-destroyed`). Inert
     *  (optional, never set in production). */
    __testTapApplyOutgoingToEnemy?: (
        fn: (damage: number, enemyVictim: CombatActor) => VictimDamageOutcome
    ) => void;
    /** TEST-ONLY notification hook (PR4b): fired on EVERY `creditDamage` call (both sides, every
     *  round) with the raw (sourceId, channel, amount) — a per-call NOTIFICATION, not a
     *  tap-the-closure-out pattern (creditDamage is redeclared every round inside the round
     *  loop, so exposing the closure reference the way `__testTapApplyOutgoingToEnemy` does
     *  would only ever surface the LAST round's instance). Needed because the reactive `damage`
     *  executor (Judge/Chakara/Incinerator/Rhodium/Grif/FrontLine) credits its mitigated/crit
     *  amount here rather than applying real HP damage via applyVictimDamage — there is no other
     *  observable surface for an ENEMY-owned reactive damage credit (its victim's `intakeFor`
     *  bucket is never touched; see the CREDIT-vs-INTAKE split above `roundDamage`). Lets
     *  integration tests observe the exact mitigated/crit amount an owner (either side) was
     *  credited, proving team-symmetric mitigation without needing a leech buff as an indirect
     *  HP-based proxy. Never set by production code; inert when absent. */
    __testTapCreditDamage?: (
        sourceId: string,
        // SP-E: widened to include 'generic' (mirrors LeechChannel).
        channel: 'direct' | 'detonation' | 'corrosion' | 'inferno' | 'generic',
        amount: number
    ) => void;
    /** TEST-ONLY tap (A2 Task 2): receives the full `allActors` roster once, right after actors
     *  are constructed, so unit tests can assert the plumbed base hacking/security on each actor
     *  (the bases have no production reader yet). Never set by production code; inert when absent.
     *  IMPORTANT: the passed array and its CombatActors are LIVE references mutated by the run
     *  (currentHp, currentShield, etc.) — test callbacks must read any mutable values immediately
     *  in the callback, not after runCombat returns. Base stats (hacking, security, etc.) are
     *  never mutated, so existing base-stat assertions are safe to read post-run. */
    __testTapActors?: (actors: CombatActor[]) => void;
    /** TEST-ONLY tap (B1 Task 2): receives the per-victim incoming-damage modifier reader
     *  (`victimIncomingModifiers`) once it is built in the round loop. Since D-PR12 the closure
     *  sums BOTH the enemy-debuff term AND the victim's own friendly self-buff term (field name
     *  kept as `__testTapVictimEnemyModifiers` to avoid churning the existing tap tests). Unit
     *  tests capture the closure and call it with a victim id to assert per-actor modifier reads.
     *  Never set by production code; inert when absent. The closure is per-round-identical
     *  in behaviour (only the live status-engine state changes), so capturing it once is sufficient
     *  for a single-round test. NOTE: the tap reads LIVE statusEngine state at call time, which
     *  is fine for single-round tests (the state is fully settled after runCombat returns). */
    __testTapVictimEnemyModifiers?: (
        fn: (victimId: string) => { enemyDefenseModifier: number; incomingDamageModifier: number }
    ) => void;
    /** TEST TAP (inert in production): exposes the engine-local isStasised(actorId) reader so a
     *  test can assert per-victim Stasis detection for both directions. Mirrors
     *  __testTapVictimEnemyModifiers. Never set by production callers. */
    __testTapIsStasised?: (fn: (actorId: string) => boolean) => void;
    /** TEST-ONLY tap (C2a Task 3): receives the live `statusEngine` once it is built so a test can
     *  read an actor's settled self-buff / debuff state AFTER `runCombat` returns (e.g. to assert a
     *  cast-path purge removed an enemy's self-buffs). Never set by production code; inert when
     *  absent. The engine reference is LIVE — read it after the run when state is fully settled. */
    __testTapStatusEngine?: (engine: StatusEngine) => void;
}

/** One round's healing accounting (healing mode only). `perActor` mirrors the round
 *  damage map. incomingDamage/shieldAbsorbed stay 0 until enemy attacks (Task 8).
 *  targetHpPctStart/targetShieldStart are captured at the ROUND TOP (raw floats — the
 *  adapter owns any rounding). */
/** One enemy attacker's effects for a single round, attributed to its actor id (Task 10a).
 *  selfBuffs = the self-buffs active on that enemy this round; debuffs = the debuffs/DoTs it
 *  landed on the heal target. Both are de-duped by buffName WITHIN this enemy (so the same
 *  status from two attackers stays distinct per source). The UI resolves enemyId → the enemy
 *  attacker's ship name (or its manual label) for the per-enemy round overview. */
export interface EnemyRoundEffects {
    enemyId: string;
    selfBuffs: ActiveBuff[];
    debuffs: ActiveBuff[];
    /** Enemy-applied DoTs (Corrosion/Inferno) ACTIVE on the heal target this round, attributed to
     *  this enemy via the stack's `sourceId` (the applier's actor id), summed per type+tier. Mirrors
     *  the DPS `ActiveDoTState` `{ type, tier, stacks }` shape so the UI reuses the DPS DoT-label
     *  helper. A DoT shows for every round it is active on the target (across its duration), so a
     *  DoT-based enemy (Torcher/Belladonna) surfaces in the panel even with no self-buffs/debuffs.
     *  NAMES ONLY for display — never folded into any sim value. Empty when no DoTs are active. */
    dots: EnemyDoTState[];
    /** TIMED debuffs this enemy attacker ATTEMPTED to inflict on the heal target this round but
     *  that were RESISTED by the live hacking-vs-security landing roll.
     *  De-duped by buffName WITHIN this enemy. NAMES ONLY for display — never folded into any sim
     *  value. Empty when every attempted debuff landed (or the enemy attempted none). */
    resistedDebuffs: ActiveBuff[];
    /** DoTs this enemy attacker ATTEMPTED to inflict on the heal target this round but that were
     *  RESISTED by the live hacking-vs-security landing roll (the whole turn's DoTs share one draw).
     *  Summed per type+tier like `dots`. NAMES/COUNTS ONLY for display — never folded into any sim
     *  value. Empty when the turn's DoTs landed (or the enemy attempted none). */
    resistedDots: EnemyDoTState[];
}

/** One enemy-applied DoT active on the heal target, attributed to its source enemy and summed per
 *  type+tier (mirrors the DPS `ActiveDoTState` shape, minus ticksRemaining which the panel omits). */
export interface EnemyDoTState {
    // SP-E: widened to DoTType (was 'corrosion' | 'inferno') for forward-compat with a future
    // generic-DoT healing-panel display; `accumulate` below is called only with 'corrosion'/
    // 'inferno' today (generic DoTs are not auto-applied from skill text in this task).
    type: DoTType;
    tier: number;
    stacks: number;
}

/** The four side-specific fields the reactive intent drain needs (enemy-team PR1). Everything
 *  else in the executor ctx is shared across sides; only these differ between the player drain
 *  and the enemy drain. `recipientIds` becomes the executor's `playerIds` (same-side recipients). */
interface ReactiveSideCtx {
    runtimes: Map<string, PlayerActorRuntime>;
    recipientIds: string[];
    isLowestSpeedAllyFor: (ownerId: string) => boolean;
    grantAllyCharges: (
        amount: number,
        opts?: { recipientIds?: string[]; emitBus?: CombatEventBus }
    ) => void;
    /** Enemy-targeted charge removal for this drain side — bySide(side).removeEnemyCharges, which
     *  subtracts from the OPPOSING side (floored at 0, immune actors skipped). The optional
     *  `applierAffinity` enforces the Charge Manipulation affinity gate (skip affinity-advantaged
     *  targets); omit it to disable the gate. The optional `emitBus` stamps the `charge-changed`
     *  when called during a reactive intent (pass ctx.bus). */
    removeEnemyCharges: (
        amount: number,
        applierAffinity?: AffinityName,
        emitBus?: CombatEventBus
    ) => void;
    /** Single-target charge removal for this drain side — bySide(side).removeChargesFrom, which
     *  subtracts from ONE actor by id (floored at 0, immune actors skipped). Same optional
     *  `applierAffinity` charge-manip gate as removeEnemyCharges, and the same optional `emitBus`. */
    removeChargesFrom: (
        targetId: string,
        amount: number,
        applierAffinity?: AffinityName,
        emitBus?: CombatEventBus
    ) => void;
    /** Live self-HP% for a same-side drain owner (drain-time hp-threshold gates). Optional —
     *  absent/undefined → buildDrainContext defaults the gate to 100 (DPS / pre-4c). Sourced from
     *  bySide(side).selfHpPctFor (bySide PR3): player = heal-target HP, enemy = 100 until PR5. */
    selfHpPctFor?: (ownerId: string) => number;
    /** Per-side most-buffs opposing-actor resolver (Rhodium). See IntentExecContext. */
    enemyWithMostBuffs?: (ownerId: string) => string | undefined;
    /** D-PR14 Doomsayer: per-side highest-attack opposing-actor resolver. See IntentExecContext. */
    enemyWithHighestAttack?: (ownerId: string) => string | undefined;
    /** SP-M M1 Task 6 Chakara: per-side highest-speed opposing-actor resolver. See
     *  IntentExecContext. Resolved LIVE (no onceByOwner memo) — unlike enemyWithMostBuffs,
     *  Chakara's co-located clause is a SELF-buff that never changes an enemy's speed. */
    enemyWithHighestSpeed?: (ownerId: string) => string | undefined;
    /** SP-M M1 Task 7 Judge/Incinerator: LIVING opposing-actor ids for an 'all-enemies' reactive
     *  DAMAGE proc (per-victim-conditional AoE). Player side → living enemy attackers; enemy side
     *  → living player actors. See IntentExecContext. Resolved LIVE per drain (no memo). */
    livingOpposingActorIds?: (ownerId: string) => string[];
    /** D-PR14: id of the round's first real activator (live value at drain-build time). */
    firstActivatorId?: string;
    /** D-PR16: id of the sole living actor on this side, recomputed each drain (Last Stand). */
    lastStandingId?: string;
    /** D-PR14 Bulwark: per-round once-per-(owner,ability) consume set (shared across both sides). */
    oncePerRoundConsumed?: Set<string>;
    /** ship-kit W3 (Sansi): per-round fire COUNT per (owner,ability) backing Ability.maxPerRound
     *  (shared across both sides, like oncePerRoundConsumed). */
    perRoundFireCounts?: Map<string, number>;
    /** Per-side adjacent-allies resolver (Fortifying Shroud). See IntentExecContext. */
    adjacentAllyIdsFor: (ownerId: string) => string[];
    /** Ship-kit W5 Task C3 (Demolisher bomb-splash): OPPOSING-side adjacent-ids resolver — mirrors
     *  `livingOpposingActorIds`'s same-direction wiring (player drain → enemy roster, enemy drain
     *  → player roster), but narrowed to board-neighbours of the given anchor instead of the
     *  whole roster. See IntentExecContext. */
    adjacentOpposingIdsFor?: (anchorId: string) => string[];
    /** Per-side support footprint resolver (pattern-scoped reactive grants). See IntentExecContext. */
    footprintAllyIdsFor: (ownerId: string) => string[] | undefined;
}

/** Per-victim incoming accounting bucket (PR5a foundation — written in parallel with the
 *  heal-target scalars; no reader until PR5b flips them). Keyed by victim actor id. */
interface ActorIntake {
    incoming: number;
    shieldAbsorbed: number;
    barrierAbsorbed: number;
    /** Direct-hit damage nullified by `Shield Converter` and turned into Shield. Netted against
     *  `.incoming` for display the same way `barrierAbsorbed` is: the hit still ARRIVED (so the
     *  attacker keeps its damage-dealt credit and the #293 identity holds), but its effect was
     *  converted rather than applied. Records the FULL nullified amount even when the resulting
     *  shield gain was clamped at max HP — this figure explains the missing HP damage, not the
     *  shield delta. */
    convertedToShield: number;
}

export interface HealingRoundEngine {
    perActor: Map<string, ActorHealing>;
    targetHpPctStart: number;
    targetShieldStart: number;
    incomingDamage: number;
    shieldAbsorbed: number;
    /** Per-round total fully blocked by an active Barrier (full damage immunity). Tracked
     *  separately from shieldAbsorbed (Barrier does not drain the shield pool). Task 2 adds the
     *  UI display surface; this field exists now so the blocked total is observable. */
    barrierAbsorbed: number;
    /** Per-actor incoming accounting bucket. The heal target's `incomingDamage`/`shieldAbsorbed`/
     *  `barrierAbsorbed` row totals above are sourced from this map's `healTarget.id` entry (PR5b);
     *  the legacy per-round scalars it replaced were removed in the same change. Keyed by victim
     *  actor id. */
    perActorIncoming: Map<string, ActorIntake>;
    /** Per-enemy effects this round (Task 10a): one entry per enemy attacker that produced an
     *  effect, carrying its own self-buffs + the debuffs it landed on the heal target. Surfaced
     *  for the UI's enemy-effects round overview, grouped/attributed by the source enemy ship.
     *  Empty for a bare/manual enemy with no effects. NAMES ONLY — never folded into a sim value. */
    enemyEffects: EnemyRoundEffects[];
    /** The HEAL TARGET's OWN active self-buffs this round, captured from the target actor's turn
     *  (PlayerTurnResult.activeSelfBuffs — comprehensive, so recurring/always-active buffs like
     *  Cheat Death / Everliving Regeneration are included). Empty when there is no heal target,
     *  the target never acted this round, or the target is destroyed. NAMES ONLY for the UI's
     *  round overview — never folded into any sim value. */
    healTargetBuffs: ActiveBuff[];
}

/**
 * Side-specific accounting hooks for {@link applyVictimDamage}. Everything keyed off the
 * `victim` (Barrier/shield/HP/Cheat-Death/recordDestroyed/hp-changed) lives in the shared
 * core; the per-direction intake accounting is injected here so the core stays
 * caller-agnostic. Both directions record into the same per-actor `perActorIncoming` map keyed
 * by the victim's id — a single `sink` (SP-U U1) serves BOTH enemy→player (tank intake) and
 * player→enemy (E1 symmetric surface) directions, since ids are globally unique across sides.
 */
interface DamageAccountingSink {
    /** today: intakeFor(victimId).incoming += amount */
    addIncoming: (amount: number, victimId: string) => void;
    /** today: intakeFor(victimId).shieldAbsorbed += amount */
    addShieldAbsorbed: (amount: number, victimId: string) => void;
    /** today: intakeFor(victimId).barrierAbsorbed += amount */
    addBarrierAbsorbed: (amount: number, victimId: string) => void;
    /** today: intakeFor(victimId).convertedToShield += amount */
    addConvertedToShield: (amount: number, victimId: string) => void;
}
/**
 * Replaces a direct hit the victim just took with a generic self-DoT spread over `rounds` rounds,
 * returning the amount converted (for the caller's `transformedToDot`).
 *
 * The single home of the DEFERRAL accounting both transform steps in {@link applyVictimDamage}
 * share — the ability-based Voron/Orel `transform-incoming-to-dot` and the name-keyed
 * `Hit Mitigation` one-shot. The two steps differ only in where `rounds` comes from (the ability's
 * `turns` vs the status's fixed spread), and the accounting MUST NOT diverge between them:
 *  - the DoT is credited to the victim itself (`sourceId: victim.id`), so the existing generic-DoT
 *    tick sites pick it up with no extra wiring, and its damage is never attributed to the attacker;
 *  - reversing the `.incoming` the funnel already recorded is what makes the battle sim's HP
 *    derivation (incoming − shield − barrier) net to zero real HP loss for this hit — the damage
 *    instead lands over time, each tick recording its own `.incoming`;
 *  - the returned amount is what the caller reports as `transformedToDot`, and that is what drops
 *    the hit from the per-victim damage-taken credit AND suppresses its `attacked` signal.
 * Unlike the Barrier path this hit is DEFERRED, not nullified, so it is deliberately NOT booked as
 * barrier- or shield-absorbed: nothing absorbed it.
 *
 * CALLER CONTRACT — this helper cannot reach the caller's `damage` local, so every call site MUST
 * follow it with `damage = 0` of its own WHEN THE RETURN VALUE IS NON-ZERO (both do — the guard
 * below is the one case the return can be 0). Omitting that on a real conversion does not merely
 * mis-report: the `immediateDamage` capture a few lines below the call sites reads `damage`, so a
 * non-zero leftover would drain the victim's shield/HP for the full amount as well as spreading it
 * over the DoT — the hit landing twice. Neither existing call site's real-conversion path would
 * change, so no test would catch a regression there.
 *
 * Module-local rather than its own module: it is a private detail of the one funnel, and speaking
 * `DamageAccountingSink` (an engine-internal accounting seam) from outside would mean exporting
 * that interface purely to relocate these three statements.
 *
 * GUARD: `rounds` traces back to a parsed skill row (the ability's `turns`) or a hand-coded
 * constant (Hit Mitigation's fixed 3) — the former is untrusted input. `detectTransformToDot`
 * already rejects a non-positive parse at the source, but this is the single shared choke point
 * for both call sites, so it defends independently: a non-positive `rounds` here would push
 * `perTickAmount: damage / rounds` = `Infinity` (or a poisoned negative) into `genericDoTEntries`,
 * silently corrupting every downstream tick and HP derivation that reads it. Treat it as a no-op
 * instead — convert nothing, leave the hit to resolve normally — rather than throwing: a
 * malformed skill row must not crash a simulation.
 */
function convertHitToSelfDot(
    victim: CombatActor,
    sink: DamageAccountingSink,
    damage: number,
    rounds: number
): number {
    if (rounds <= 0) return 0;
    victim.genericDoTEntries.push({
        stacks: 1,
        tier: 0,
        remainingRounds: rounds,
        sourceId: victim.id,
        perTickAmount: damage / rounds,
    });
    sink.addIncoming(-damage, victim.id);
    return damage;
}
/**
 * The combat-engine turn loop (combat-system.md §10). Each round seeds a per-actor action
 * pool (one pending action each) and repeatedly selects the unacted actor with the highest
 * CURRENT effective speed (selectNextBySpeed) until the pool drains — every actor takes one
 * turn (plus any extra-action grants): the attacker (default
 * speed 100) runs the full damage/buff/DoT-application pipeline; the enemy (default
 * speed 50) ticks the DoT containers it carries (DoTs tick at the start of the
 * afflicted ship's turn). When enemySpeed > speed the order inverts — the enemy acts
 * before the attacker, deferring round-1 DoT ticks to round 2. The round's RoundData
 * row is assembled after all turns. At default speeds the attacker always precedes the
 * enemy, making this a byte-identical relocation of the old single-block round —
 * events are write-only taps that never read or change a sim value.
 */
export function runCombat(input: CombatEngineInput): {
    rounds: RoundData[];
    rawTotals: {
        direct: number;
        corrosion: number;
        inferno: number;
        detonation: number;
        cumulative: number;
        totalSecondary: number;
        totalConditional: number;
        /** Total non-focus player (team) damage across all rounds — adapter summary. */
        teamTotal: number;
        /** SP-E: total generic (absolute-per-tick) DoT damage across all rounds. Always 0 today
         *  (generic DoTs are never auto-applied from skill text in this task) — not yet consumed
         *  by DPSSimulationSummary; a future task can surface it as totalGenericDamage. */
        generic: number;
    };
    /** SP-U U5: the real DPS enemy's end-of-run outcome. Meaningful only in pure DPS mode (no
     *  real enemy attackers); the DPS adapter maps it onto DPSSimulationSummary. */
    enemyOutcome: {
        /** True when the enemy never reached 0 HP within the round window. */
        survived: boolean;
        /** Round the enemy was destroyed; undefined when it survived. */
        roundsToKill?: number;
        /** Enemy HP% remaining at the end of the run (0 when killed). */
        finalHpPct: number;
    };
    /** Healing-mode accounting (additive — present ONLY when healTargetId is set). */
    healing?: { rounds: HealingRoundEngine[]; destroyedRound?: number };
} {
    const {
        attack,
        crit,
        critDamage,
        defensePenetration,
        chargeCount,
        // shipSkills is intentionally NOT destructured here — the cast/reactive split below
        // rebinds `shipSkills` to the cast-only subset (partitionReactiveAbilities).
        // F7: optional on the input — default to the vestigial dummy sink's stats
        // (0 defence / 1e9 HP) when the caller (battleSimulator.ts's positional mode) omits them.
        enemyDefense = 0,
        enemyHp = 1_000_000_000,
        numRounds,
        selfBuffs,
        enemyDebuffs,
        selfDotModifier,
        defensePenetrationBuff,
        hasChargedSkill,
        startCharged,
        affinityDamageModifier,
        affinityCritCap,
        affinityCritPenalty,
        defence,
        hp,
        hacking,
        security,
        enemySecurity,
        allyChargePerRound,
        enemyType,
        speed,
        enemySpeed,
        bus: externalBus,
    } = input;

    // A.3 migration: every team actor walks. Synthesize an empty-kit walk for any buff-only actor so the
    // legacy non-walked-team branch is unreachable (and deleted in Task 4). Single const → every downstream
    // teamActors read (teamCombatActors, teamRuntimeById, teamSources, lookups, hp/defence defaults) sees the
    // normalized roster unchanged.
    const teamActors = normalizeTeamActorsToWalked(input.teamActors ?? []);

    // Internal bus — always created (Phase 3). Reactive listeners attach here. When an
    // external bus is provided it is a pure WRITE-ONLY tap: each emit fans out to the
    // external bus FIRST (its listeners stay write-only, registered before the engine's
    // own reactive listeners), then to the internal bus. Everything that flowed through
    // `bus?` now flows through this unconditional `bus`.
    const internalBus = createEventBus();
    const bus: CombatEventBus = externalBus
        ? {
              on: internalBus.on,
              emit: (e) => {
                  externalBus.emit(e);
                  internalBus.emit(e);
              },
          }
        : internalBus;

    // Cast/reactive split (Phase 3). Live-trigger buff/debuff/dot/charge abilities are
    // EXCLUDED from every on-cast pipeline (the registration loop + runPlayerTurn) and
    // instead registered as reactive listeners in slot/text order. Everything else stays
    // on-cast — including any non-buff/debuff/dot/charge ability carrying a live trigger
    // value (the executor only supports those four types).
    const { castSkills: shipSkills, reactiveAbilities } = partitionReactiveAbilities(
        input.shipSkills
    );

    // Actors. The attacker (default speed 100) takes the first turn each round; the enemy
    // (default speed 50) takes the second turn and holds the DoT containers (previously
    // loop-locals) it ticks on its turn. Speeds are configurable via the speed/enemySpeed
    // inputs — a faster enemy (enemySpeed > attacker speed) inverts the turn order, which
    // delays the first DoT tick to round 2 (the enemy acts before the attacker's first
    // DoT application, so lastAttackerCtx is undefined on the enemy's round-1 turn).
    const attacker = createActor({
        id: 'attacker',
        side: 'player',
        kind: 'attacker',
        stats: {
            attack,
            crit,
            critDamage,
            defensePenetration,
            shieldPenetration: input.shieldPenetration ?? 0,
            defence,
            hp,
            speed: speed ?? 100,
            // Base hacking (A2 Task 2) — base for effectiveStatsOf.hacking; unread until landing lands (A2 Task 4).
            hacking,
            // Focus actor's own security — base for effectiveStatsOf.security (stats-snapshot
            // display) and the live debuff-landing recompute when the focus is targeted.
            security,
        },
        chargeCount,
        startCharged,
        position: input.position,
        ignoresForcedTargeting: input.ignoresForcedTargeting,
        ignoresStealth: input.ignoresStealth,
        doesntBreakStasis: input.doesntBreakStasis,
        chargeLossImmune: input.chargeLossImmune,
        affinity: input.affinity,
        preFight: input.preFight,
    });
    const enemy = createActor({
        id: 'enemy',
        // SP-U U5: the DPS opponent is now a REAL, destructible actor. In pure DPS mode (no real
        // enemyAttackers) it takes the round's dealt damage through the shared per-victim
        // `applyVictimDamage` funnel, its HP declines naturally, and it dies at 0 HP (terminating
        // the run). In sim/healing mode the fight runs on the positioned enemy roster and this
        // actor is a vestigial huge-HP sink (never dies — see `dpsEnemyTarget`).
        side: 'enemy',
        kind: 'enemy',
        stats: {
            attack: 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            shieldPenetration: 0,
            defence: enemyDefense,
            hp: enemyHp,
            speed: enemySpeed ?? 50,
            // Base security (A2 Task 2) — base for effectiveStatsOf.security; unread until landing lands (A2 Task 4).
            security: enemySecurity,
        },
    });

    // The reported actor. Internal for now — the DPS adapter's attacker. The engine core
    // keys on this, never on the literal 'attacker' (end-state rule, spec). A later phase
    // lifts this into CombatEngineInput once multi-actor damage rows are needed (YAGNI).
    const focusActorId = 'attacker';

    // The full player-id universe for ally-target routing (Task 5): the focus actor FIRST,
    // then every team actor in INPUT ORDER. This order is FIXED (independent of which actor
    // casts an ally buff) so per-recipient application order is deterministic across the run.
    // For an attacker-only run this is just ['attacker'] → ally/all-allies collapse to the
    // owner, exactly as before Task 5 (zero churn). NOTE: it lists EVERY team actor (walked or
    // legacy) — a legacy team actor carries no walked statuses, but it is still a valid ally
    // recipient of another actor's all-allies buff (status maps are lazy-created per owner).
    const playerIds = [focusActorId, ...teamActors.map((t) => t.id)];

    // Team actors (Phase 2). Real speed-ordered actors carrying their own charge cadence;
    // they deal no damage and hold no DoTs/statuses (their buff grants sit on the attacker/
    // enemy via the status engine's per-source timed sets). For a WALKED team actor the real
    // combat stats come from the walk bundle (so the heal target's `currentHp` starts at its
    // true max HP — healing mode needs it); the only combat-actor `stats` reads in the engine
    // are turn-order speed (already real) and `currentHp`'s seeding from `stats.hp` (the heal
    // target). runPlayerTurn reads every stat from the RUNTIME, not the actor — so populating
    // real stats here changes no DPS behaviour (goldens stay byte-identical; verified). A
    // LEGACY team actor (no walk) keeps the dummy stats it always had.
    const teamCombatActors = teamActors.map((t) =>
        createActor({
            id: t.id,
            side: 'player',
            kind: 'team',
            stats: t.walk
                ? {
                      attack: t.walk.stats.attack,
                      crit: t.walk.stats.crit,
                      critDamage: t.walk.stats.critDamage,
                      defensePenetration: t.walk.stats.defensePenetration,
                      shieldPenetration: t.walk.stats.shieldPenetration ?? 0,
                      defence: t.walk.stats.defence,
                      hp: t.walk.stats.hp,
                      speed: t.speed,
                      hacking: t.walk.stats.hacking,
                      security: t.walk.stats.security,
                  }
                : {
                      attack: 0,
                      crit: 0,
                      critDamage: 0,
                      defensePenetration: 0,
                      shieldPenetration: 0,
                      defence: 0,
                      hp: 1,
                      speed: t.speed,
                  },
            chargeCount: t.chargeCount,
            startCharged: t.startCharged,
            position: t.position,
            ignoresForcedTargeting: t.ignoresForcedTargeting,
            ignoresStealth: t.ignoresStealth,
            doesntBreakStasis: t.doesntBreakStasis,
            chargeLossImmune: t.chargeLossImmune,
            // RAW affinity rides on the walk bundle (set by the adapter from TeamActorInput.affinity
            // — the SAME source as the walk's affinityDamageModifier). Legacy (no walk) → undefined.
            affinity: t.walk?.affinity,
            preFight: t.preFight,
        })
    );

    // Per-team-actor parsed positional target (Task C2). The team actor's `position`
    // already rides on its CombatActor (createActor above), but its parsed `target`
    // lives only on the TeamActorEngineInput — thread it to the team-turn call site by
    // id. Empty for every non-positional input (no team actor passes a target) → the
    // gated branch never fires and the legacy binding stays byte-identical.
    const teamTargetById = new Map<string, ParsedTarget>();
    for (const t of teamActors) {
        if (t.target) {
            teamTargetById.set(t.id, t.target);
        }
    }

    // Per-team-actor parsed positional pattern (Task 8a), mirroring teamTargetById. The pattern
    // lives only on the TeamActorEngineInput — thread it to the team-turn call site by id for the
    // Task 8b apply path. Empty for every non-positional input (no pattern set) → inert today.
    const teamPatternById = new Map<string, ParsedPattern>();
    for (const t of teamActors) {
        if (t.pattern) {
            teamPatternById.set(t.id, t.pattern);
        }
    }
    const teamChargedPatternById = new Map<string, ParsedPattern>();
    for (const t of teamActors) {
        const cp = t.chargedPattern ?? t.pattern;
        if (cp) teamChargedPatternById.set(t.id, cp);
    }
    // SP-F F5: per-team-actor parsed CHARGED target selection, mirroring teamChargedPatternById.
    // Falls back to the active `target` when unset (chargedTarget absent) → byte-identical for
    // every existing input (no team actor threads a divergent charged selection today).
    const teamChargedTargetById = new Map<string, ParsedTarget>();
    for (const t of teamActors) {
        const ct = t.chargedTarget ?? t.target;
        if (ct) teamChargedTargetById.set(t.id, ct);
    }

    // Per-enemy-attacker parsed positional target (Task C3, side-symmetric). The enemy's
    // `position` already rides on its CombatActor (buildEnemyPlayerActorRuntime → createActor),
    // but its parsed `target` lives only on the EnemyActorInput — thread it to the enemy-turn
    // call site by id, mirroring teamTargetById. Empty for every non-positional input (no enemy
    // passes a target) → the gated branch never fires and the legacy heal-target binding stays
    // byte-identical.
    const enemyTargetById = new Map<string, ParsedTarget>();
    for (const e of input.enemyAttackers ?? []) {
        if (e.target) {
            enemyTargetById.set(e.id, e.target);
        }
    }

    // Per-enemy-attacker parsed positional pattern (Task 8a), mirroring enemyTargetById /
    // teamPatternById. The pattern lives only on the EnemyActorInput — thread it to the enemy-turn
    // call site by id for the Task 8b apply path. Empty for every non-positional input → inert today.
    const enemyPatternById = new Map<string, ParsedPattern>();
    for (const e of input.enemyAttackers ?? []) {
        if (e.pattern) {
            enemyPatternById.set(e.id, e.pattern);
        }
    }
    const enemyChargedPatternById = new Map<string, ParsedPattern>();
    for (const e of input.enemyAttackers ?? []) {
        const cp = e.chargedPattern ?? e.pattern;
        if (cp) enemyChargedPatternById.set(e.id, cp);
    }
    // SP-F F5: per-enemy-attacker parsed CHARGED target selection, mirroring
    // enemyChargedPatternById. Falls back to the active `target` when unset → byte-identical
    // for every existing input (no enemy attacker threads a divergent charged selection today).
    const enemyChargedTargetById = new Map<string, ParsedTarget>();
    for (const e of input.enemyAttackers ?? []) {
        const ct = e.chargedTarget ?? e.target;
        if (ct) enemyChargedTargetById.set(e.id, ct);
    }

    // Deterministic event gates — replace Math.random / expected-value math so
    // identical inputs always produce identical output. Crit uses one gate PER
    // ACTION STREAM so the charged hit crits at exactly the crit rate regardless
    // of how the charge cadence aligns with the crit schedule (no aliasing).
    // Declared BEFORE the status engine so the landing hook can close over the
    // debuff-landing gate (Task 7 — timed enemy applications draw it once).
    const activeCritGate = makeRateGate(`${focusActorId}:active-crit`);
    const chargedCritGate = makeRateGate(`${focusActorId}:charged-crit`);
    // Heal crit gates: SEPARATE streams from the damage crit gates (drawing from those would
    // shift a heal-carrying ship's damage-crit schedule → golden churn). Per-actor isolation.
    const activeHealCritGate = makeRateGate(`${focusActorId}:active-heal-crit`);
    const chargedHealCritGate = makeRateGate(`${focusActorId}:charged-heal-crit`);
    const debuffLandingGate = makeRateGate(`${focusActorId}:landing`);
    const extendChanceGate = makeRateGate(`${focusActorId}:extend`);

    // Affinity-based ('apply') debuffs always hit EXCEPT at an affinity disadvantage,
    // where they are resisted (combat-system.md hit-check). affinityDamageModifier is
    // -25 only on a disadvantage matchup. Constant for the whole run.
    const affinityDisadvantage = affinityDamageModifier < 0;

    // Landing decision for a TIMED enemy application (drawn ONCE at application time):
    // 'apply' (affinity-based) → lands unless at an affinity disadvantage, no gate draw;
    // 'inflict' (and unmarked) → draws the hacking-vs-security landing gate. Threaded
    // into the status engine for scheduled timed enemy upserts (sourceFired) and reused
    // by the engine for ability-sourced timed enemy applications below.
    // Reads the attacker runtime's LIVE per-target landing chance (A2 Task 4 — set each turn by
    // runPlayerTurn). Only invoked at turn time (after attackerRuntime is defined below), so the
    // forward reference is safe. `?? 1` is a neutral guard for a read before the first turn.
    const landsTimedEnemyApplication = (
        application?: 'inflict' | 'apply',
        targetAffinity?: AffinityName
    ): boolean =>
        application === 'apply'
            ? // Target-aware (Task A): when the ACTUAL target's affinity is supplied, re-resolve the
              // applier's RAW affinity (input.affinity, same value fed to attackerAffinity) vs that
              // target — an 'apply' lands UNLESS the applier is at a disadvantage. Absent
              // (DPS/unit mode, single representative opponent) → the static flag, byte-identical.
              targetAffinity !== undefined
                ? getAffinityMatchup(input.affinity, targetAffinity) !== 'disadvantage'
                : !affinityDisadvantage
            : debuffLandingGate(attackerRuntime.liveDebuffLandingChance ?? 1);

    // Boost gear set: per-owner buff-duration extension. Built from the RAW ShipSkills (which
    // already carry the BOOST passive merged by buildShipAbilitiesWithEquipment at the page
    // level) BEFORE the status engine is constructed — the runtime-derived ability maps
    // (incomingAbilitiesById etc.) aren't built until much later (~2257). Covers all actors
    // team-agnostically: attacker + walked team allies + enemy attackers.
    const buffDurationExtensionByOwner = buildBuffDurationExtensionByOwner([
        { id: 'attacker', shipSkills: input.shipSkills },
        ...teamActors.map((t) => ({ id: t.id, shipSkills: t.walk?.shipSkills })),
        ...(input.enemyAttackers ?? []).map((e) => ({ id: e.id, shipSkills: e.shipSkills })),
    ]);

    // Sub-project I, PR I3 (Layer 1) — per-actor-id map of this actor's PASSIVE `all-allies`-
    // targeted `modifier` abilities (Lodolite's "+15% to enemies with Concentrate Fire/
    // Stealth", Panguan's "+40% to Stealthed allies"). Only PASSIVE-slot abilities are
    // gathered — an aura is a standing kit property, not tied to the owner's firing skill
    // this turn (mirrors how runPlayerTurn reads its OWN modifierAbilities from
    // firingSkill + passiveSkill, but a non-acting ally never has a "firing skill" this
    // round). Filtered to `target === 'all-allies'` — a `self`-targeted modifier already
    // lives only in its owner's own list and must not leak to teammates. Keyed by the SAME
    // actor set as `buffDurationExtensionByOwner` immediately above (attacker + walked team
    // + enemy attackers) so distribution covers both sides symmetrically. `buildTurnArgs`
    // below unions each acting actor's LIVING same-side allies (excluding itself, via
    // `sameSideLivingFor`) through this map every turn.
    const allAlliesModifierAbilitiesOf = (skills?: ShipSkills): Ability[] =>
        (skills?.slots.find((s) => s.slot === 'passive')?.abilities ?? []).filter(
            (a) => a.type === 'modifier' && a.target === 'all-allies'
        );
    const allAlliesModifierAbilitiesById = new Map<string, Ability[]>(
        [
            { id: 'attacker', shipSkills: input.shipSkills },
            ...teamActors.map((t) => ({ id: t.id, shipSkills: t.walk?.shipSkills })),
            ...(input.enemyAttackers ?? []).map((e) => ({ id: e.id, shipSkills: e.shipSkills })),
        ].map(({ id, shipSkills }) => [id, allAlliesModifierAbilitiesOf(shipSkills)] as const)
    );

    // Incremental status machine — replaces the precomputed computeBuffTimeline array.
    const statusEngine = createStatusEngine({
        selfBuffs,
        enemyDebuffs,
        // Team actors' buff lists keyed to their own turns (per-source timed sets).
        teamSources: teamActors.map((t) => ({
            sourceId: t.id,
            selfBuffs: t.selfBuffs,
            enemyDebuffs: t.enemyDebuffs,
        })),
        landsTimedEnemyApplication: (buff) => landsTimedEnemyApplication(buff.application),
        buffDurationExtensionFor: (casterId) => buffDurationExtensionByOwner.get(casterId) ?? 0,
    });

    // TEST-ONLY: expose the live status engine so a test can read settled self/enemy state after
    // the run (e.g. cast-path purge removal). Inert in production (field never set).
    input.__testTapStatusEngine?.(statusEngine);

    // Register the attacker's own buff/debuff abilities for in-loop application with live
    // condition gating. These flow from ShipSkills directly — the page no longer feeds the
    // converted SelectedGameBuff arrays into the sim (no-double-count). The attacker registers
    // FIRST (zero-churn ordering gate); walked team actors register AFTER, in input order.
    const { timedSelfBySlot, timedEnemyBySlot } = registerActorAbilityStatuses(
        shipSkills,
        statusEngine,
        'attacker',
        playerIds,
        // Heal target (healing mode) — narrows a single-`ally` Cheat-Death-family firing-slot
        // grant to the tank (Hermes). Undefined in DPS mode → falls back to the caster.
        input.healTargetId
    );

    // Lookup maps (moved from simulateDPS) — expand the snapshot's buff names back
    // into the underlying SelectedGameBuff effects.
    // Include team-actor buffs: their snapshot entries (applied on team turns) must
    // expand back to their underlying effects exactly like attacker-scheduled ones.
    const selfBuffLookup = new Map<string, SelectedGameBuff[]>();
    for (const b of [...selfBuffs, ...teamActors.flatMap((t) => t.selfBuffs)]) {
        const existing = selfBuffLookup.get(b.buffName) ?? [];
        selfBuffLookup.set(b.buffName, [...existing, b]);
    }
    const enemyDebuffLookup = new Map<string, SelectedGameBuff[]>();
    for (const b of [...enemyDebuffs, ...teamActors.flatMap((t) => t.enemyDebuffs)]) {
        const existing = enemyDebuffLookup.get(b.buffName) ?? [];
        enemyDebuffLookup.set(b.buffName, [...existing, b]);
    }

    // Attacker runtime — everything the focus actor's turns close over, built once.
    // The attacker carries the top-level inputs, the global merged lookups, and the
    // shared gates. Walked team runtimes (Task 4) come from TeamActorInput with their
    // own gate instances and empty lookups. The engine core keys on runtime/actor ids.
    const attackerRuntime: PlayerActorRuntime = {
        actor: attacker,
        focus: attacker.id === focusActorId,
        castSkills: shipSkills,
        reactiveAbilities,
        timedSelfBySlot,
        timedEnemyBySlot,
        hasChargedSkill,
        attack,
        crit,
        critDamage,
        defensePenetration,
        defence,
        hp,
        healModifier: input.healModifier ?? 0,
        selfDotModifier,
        defensePenetrationBuff,
        affinityDamageModifier,
        affinityCritCap,
        affinityCritPenalty,
        affinityDisadvantage,
        // RAW focus affinity — sourced from the SAME input.affinity the page resolved into the
        // pre-resolved affinityDamageModifier above, so the two never disagree. Positional
        // plumbing: read by victimHitDamage for per-victim re-resolution (Task 8b/9). Undefined →
        // neutral 'antimatter' default downstream.
        attackerAffinity: input.affinity,
        allyChargePerRound,
        activeCritGate,
        chargedCritGate,
        activeHealCritGate,
        chargedHealCritGate,
        debuffLandingGate,
        extendChanceGate,
        landsTimedEnemyApplication,
        selfBuffLookup,
        enemyDebuffLookup,
    };

    // Walked team runtimes (Task 4). For each team input with a `walk` bundle, build a
    // PlayerActorRuntime so its real turns run the full runPlayerTurn pipeline. Each gets
    // its OWN gate instances (determinism isolation — its draws never interleave with the
    // attacker's or another team actor's), its own landing closure (its affinity disadvantage
    // + its landing gate + its chance), stats from the walk bundle, focus=false, and EMPTY
    // lookups (its walked statuses carry their effects in payloads — no scheduled-buff lookup
    // expansion). Registration order: attacker first (above), then team actors in input order
    // (the loop order here) — fixed order = determinism. The team combat actor (turn-order
    // carrier) is matched by index to its input.
    const teamRuntimeById = new Map<string, PlayerActorRuntime>();
    teamActors.forEach((t, i) => {
        if (!t.walk) return;
        const w = t.walk;
        const teamActor = teamCombatActors[i];
        // Cast/reactive split per walked actor. Reactive abilities are PARTITIONED here but
        // NOT registered as listeners this task — Task 6 registers them per owner. They are
        // stored on the runtime so Task 6 can pick them up without re-partitioning.
        const { castSkills: teamCastSkills, reactiveAbilities: teamReactive } =
            partitionReactiveAbilities(w.shipSkills);
        // Register this walked actor's cast buff/debuff abilities under its own owner id
        // (AFTER the attacker — zero-churn ordering for the attacker-only path).
        const teamTimed = registerActorAbilityStatuses(
            teamCastSkills,
            statusEngine,
            t.id,
            playerIds,
            // Same carve-out narrowing as the attacker — a walked healer's single-`ally`
            // Cheat-Death-family grant lands on the heal target.
            input.healTargetId
        );
        const teamAffinityDisadvantage = w.affinityDamageModifier < 0;
        // Own gate instances — separate draw streams so a team actor's crit/landing/extend
        // rolls are isolated from the attacker's deterministic schedule. Keyed by this team
        // actor's own id + purpose (SP-0 Task 3) — see the enemy/focus gates above for the
        // same convention.
        const teamActiveCritGate = makeRateGate(`${t.id}:active-crit`);
        const teamChargedCritGate = makeRateGate(`${t.id}:charged-crit`);
        const teamActiveHealCritGate = makeRateGate(`${t.id}:active-heal-crit`);
        const teamChargedHealCritGate = makeRateGate(`${t.id}:charged-heal-crit`);
        const teamDebuffLandingGate = makeRateGate(`${t.id}:landing`);
        const teamExtendChanceGate = makeRateGate(`${t.id}:extend`);
        // Reads this team actor's runtime LIVE per-target landing chance (A2 Task 4 — set each
        // turn by runPlayerTurn). Invoked only at turn time (after `runtime` below is defined),
        // so the forward reference is safe. `?? 1` is a neutral guard for a pre-first-turn read.
        const teamLandsTimedEnemyApplication = (
            application?: 'inflict' | 'apply',
            targetAffinity?: AffinityName
        ): boolean =>
            application === 'apply'
                ? // Target-aware (mirrors the attacker closure): when the ACTUAL target's affinity
                  // is supplied, re-resolve THIS team actor's RAW affinity (w.affinity) vs that
                  // target — an 'apply' lands UNLESS this actor is at a disadvantage. Absent
                  // (DPS/unit mode, single representative opponent) → the static flag, byte-identical.
                  targetAffinity !== undefined
                    ? getAffinityMatchup(w.affinity, targetAffinity) !== 'disadvantage'
                    : !teamAffinityDisadvantage
                : teamDebuffLandingGate(runtime.liveDebuffLandingChance ?? 1);
        const runtime: PlayerActorRuntime = {
            actor: teamActor,
            focus: teamActor.id === focusActorId, // always false today (focus = attacker)
            castSkills: teamCastSkills,
            reactiveAbilities: teamReactive, // stored, NOT registered (Task 6)
            timedSelfBySlot: teamTimed.timedSelfBySlot,
            timedEnemyBySlot: teamTimed.timedEnemyBySlot,
            hasChargedSkill: w.hasChargedSkill,
            attack: w.stats.attack,
            crit: w.stats.crit,
            critDamage: w.stats.critDamage,
            defensePenetration: w.stats.defensePenetration,
            defence: w.stats.defence,
            hp: w.stats.hp,
            healModifier: w.healModifier ?? 0,
            selfDotModifier: w.selfDotModifier,
            defensePenetrationBuff: w.defensePenetrationBuff,
            affinityDamageModifier: w.affinityDamageModifier,
            affinityCritCap: w.affinityCritCap,
            affinityCritPenalty: w.affinityCritPenalty,
            affinityDisadvantage: teamAffinityDisadvantage,
            // RAW affinity — sourced from the SAME w.affinity (TeamActorInput.affinity) the adapter
            // fed to computeAffinityModifiers for w.affinityDamageModifier, so the two never
            // disagree. Positional plumbing: read by victimHitDamage (Task 8b/9). Undefined →
            // neutral 'antimatter' default downstream.
            attackerAffinity: w.affinity,
            allyChargePerRound: undefined, // attacker-only manual input
            activeCritGate: teamActiveCritGate,
            chargedCritGate: teamChargedCritGate,
            activeHealCritGate: teamActiveHealCritGate,
            chargedHealCritGate: teamChargedHealCritGate,
            debuffLandingGate: teamDebuffLandingGate,
            extendChanceGate: teamExtendChanceGate,
            landsTimedEnemyApplication: teamLandsTimedEnemyApplication,
            // Lookup asymmetry by design:
            //  - selfBuffLookup empty: scheduled SELF lists are attacker-granted (the attacker
            //    runtime owns them). A walked actor's self snapshot carries only payload entries
            //    (timedAbilityStatuses / activeAbilityStatuses fold those directly) — there are no
            //    scheduled SelectedGameBuff self-names to expand for this actor.
            //  - enemyDebuffLookup = the engine's GLOBAL map (global enemy picker + every team's
            //    manual enemyDebuffs): the enemy-side scheduled debuffs are SHARED across all
            //    player turns, so the team actor's own damage fold must expand them too. An empty
            //    map here silently zeroes those stat effects on the team's own turn (the attacker
            //    runtime holds the same global map, so attacker turns were already correct).
            selfBuffLookup: new Map(),
            enemyDebuffLookup,
        };
        teamRuntimeById.set(t.id, runtime);
    });

    // Whether ANY walked team actor exists — controls whether RoundData.teamDamage is set
    // (undefined preserves the legacy/attacker-only RoundData shape; goldens stay locked).
    const hasWalkedTeam = teamRuntimeById.size > 0;

    // All player actors (attacker + team turn-order carriers) — the universe ally-charge grants
    // bump. Built once. Used by `actorsBySide`/`bySide` below.
    const allPlayerActors = [attacker, ...teamCombatActors];

    // Live effective speed for ANY actor on EITHER side (Task 2 authority; UNWIRED — Task 3
    // wires it into the turn loop via selectNextBySpeed). Effective speed =
    // baseSpeed × (1 + Σ speedBuff% / 100), where baseSpeed is the actor's construction-time
    // stats.speed and the speedBuff% is folded LIVE from the status engine so a Speed Up/Down
    // applied mid-combat is reflected. Two sources are summed (Task 0 corpus investigation:
    // every corpus speed buff — Speed Up I/II/III, Speed Down I/II, XAOC Swiftness I/II/III — is
    // an UNCONDITIONAL timed status grant; there is NO conditional/gated speed buff, NO
    // always-active/aura speed buff, and NO standing speed modifier, so the ctx-gated
    // activeAbilityStatuses path is intentionally omitted):
    //   1. Scheduled self-buffs: snapshot(id).activeSelfBuffs expanded via selfBuffLookup.
    //   2. Timed ability statuses: timedAbilityStatuses('self', id) payloads.
    // Both fold through toSimBuffs → calculateBuffTotals, taking only .speedBuff. snapshot(id)
    // and timedAbilityStatuses('self', id) are keyed by owner id, so this is correct for any
    // actor regardless of side. Effective speed is UNCAPPED (magnitude only orders turns).
    const effectiveSpeedOf = (actor: CombatActor): number =>
        effectiveStatsOf(statusEngine, selfBuffLookup, actor).speed;

    // All mutable state declared fresh on every call
    let cumulativeDamage = 0;
    // Non-focus (team) cumulative damage. Enemy HP decline everywhere uses
    // cumulativeDamage + cumulativeTeamDamage; the row/summary cumulativeDamage stays focus-only.
    let cumulativeTeamDamage = 0;
    let totalTeamRaw = 0;
    let totalDirectRaw = 0;
    let totalCorrosionRaw = 0;
    let totalInfernoRaw = 0;
    // SP-E: total generic (absolute-per-tick) DoT damage — always 0 today (never auto-applied
    // from skill text in this task); mirrors totalCorrosionRaw/totalInfernoRaw.
    let totalGenericRaw = 0;
    let totalDetonationRaw = 0;
    let totalSecondaryRaw = 0;
    let totalConditionalRaw = 0;
    // DoT containers live on the enemy actor (were loop-locals in the old single-pass loop).
    const corrosionEntries = enemy.corrosionEntries;
    const infernoEntries = enemy.infernoEntries;
    const genericDoTEntries = enemy.genericDoTEntries;
    const pendingBombs = enemy.pendingBombs;
    const pendingAccumulators = enemy.pendingAccumulators;
    // hp-changed event tracking (emission-only, no sim effect). ship-destroyed is owned by
    // the shared recordDestroyed helper, keyed on the per-actor destroyedRound field.
    let lastEnemyHpPctInt = 100;

    const roundData: RoundData[] = [];

    // Per-actor round-scoped context the enemy's DoT processing reads. Keyed by actor id;
    // every player turn sets its entry after runPlayerTurn. A DoT entry's tick resolves the
    // APPLIER's ctx (effectiveAttack for inferno; dotMult/affinityMult for both) via this map.
    // The focus actor's ctx feeds the row exactly as the old single `lastAttackerCtx` did. An
    // entry whose applier has not yet acted this run (faster-enemy round 1) has no ctx → skip.
    const lastTurnCtxByActor = new Map<string, PlayerRoundCtx>();
    // SP-D: per-actor count of enemies DAMAGED by that actor's most recent cast this round,
    // for the `enemies-hit-this-cast` gate at REACTIVE drain time (Berserker's Marauder Rage,
    // drained via the on-deal-damage trigger — a passive-sourced timed self-buff can otherwise
    // only be seeded once at combat start, before any cast has fired). Sourced from the SAME
    // `aoeVictimIds` footprint buildTurnArgs already computes for the AoE-purge fan-out (E3) —
    // the actor's own splash pattern from its resolved anchor position against the LIVE
    // opposing roster, known BEFORE runPlayerTurn returns (unlike the actual HP application,
    // which drivePositionalApply performs AFTER). Set at each of the three turn-firing call
    // sites (focus/team/enemy), mirroring lastTurnCtxByActor's per-turn update. Absent id (no
    // cast yet) → the enemiesHitThisCastFor delegate below defaults to 1.
    const enemiesHitThisCastByActor = new Map<string, number>();

    // --- Healing mode (healing calc) ---
    // Resolve the heal target up front (throw on an unknown id — the switch must name a
    // player actor). When set, the engine runs in healing mode: every runPlayerTurn call
    // gets the SHARED HealingRuntimeCtx, heals/shields consume against the live target, and
    // a per-round HealingRoundEngine is assembled. Absent → DPS mode (the ctx is never built
    // and `healing: undefined` flows into runPlayerTurn — the heal block is inert).
    const healTargetId = input.healTargetId;
    const allPlayerActorsById = new Map<string, CombatActor>([
        [attacker.id, attacker],
        ...teamCombatActors.map((a) => [a.id, a] as const),
    ]);
    const explicitHealTarget = healTargetId ? allPlayerActorsById.get(healTargetId) : undefined;
    if (healTargetId && !explicitHealTarget) {
        throw new Error(`runCombat: healTargetId '${healTargetId}' is not a player actor`);
    }
    // SP-U U5 (R6 decouple): the heal/shield pipeline runs whenever there is an EXPLICIT heal
    // focus (the healing calculator) OR a real positional team battle (the real-vs-real sim,
    // `battleSimulator`). Sim mode has no explicit focus, so anchor `healTarget` to the focus
    // actor there — this is byte-identical to the former vestigial `healTargetId: focus.id`
    // binding `battleSimulator` used purely to keep healingCtx built and unlock the enemy roster.
    // Every downstream focus-carve-out (`healTarget && actor.id === healTarget.id`) and the
    // healingCtx anchor thus resolve exactly as before. Real-vs-real team heals still route to the
    // lowest-HP living ally via `lowestHpAllyId` (the `teamBattle` path), NOT this anchor.
    const healTarget = explicitHealTarget ?? (input.positionalTeamBattle ? attacker : undefined);
    const healingMode = !!healTarget;

    // Enemy attackers. Offense actors that bombard the player side (healing/sim mode). The enemy
    // roster is built purely from their presence (SP-U U5): no `healTargetId` is required — sim
    // mode supplies them under `positionalTeamBattle` with no explicit heal focus, and a future
    // real DPS enemy (SP-U 5a) supplies one with neither.
    const enemyAttackerInputs = input.enemyAttackers ?? [];
    // SP-U U5: the dummy `enemy` is the REAL, destructible DPS target ONLY in pure DPS mode —
    // i.e. when NO real enemy attackers carry the fight. In that case its HP declines through the
    // per-victim `applyVictimDamage` funnel, it dies at 0 HP, and the run terminates (rounds-to-
    // kill). When enemy attackers exist (sim/healing mode) the positioned roster is the real
    // opponent and this `enemy` is a vestigial huge-HP sink that must NEVER die or terminate the
    // run (kept on the legacy scalar decline, byte-identical).
    const dpsEnemyTarget = enemyAttackerInputs.length === 0;
    // Validate enemy attacker ids before building any actors: an id that duplicates another
    // enemy attacker, or collides with a reserved/player id (the singular enemy entity, the
    // focus actor, or any team actor), would silently clobber a map entry (runtime lookup,
    // heal recipient, ctx) and corrupt the simulation. Reserved ids = playerIds + enemy.id.
    const reservedActorIds = new Set<string>([enemy.id, ...playerIds]);
    const seenEnemyAttackerIds = new Set<string>();
    for (const e of enemyAttackerInputs) {
        if (reservedActorIds.has(e.id)) {
            throw new Error(
                `runCombat: enemyAttackers[].id '${e.id}' collides with a reserved or player actor id`
            );
        }
        if (seenEnemyAttackerIds.has(e.id)) {
            throw new Error(`runCombat: duplicate enemyAttackers[].id '${e.id}'`);
        }
        seenEnemyAttackerIds.add(e.id);
    }
    // Enemy-team recipient order (mirror of playerIds): enemy ATTACKER ids in input order —
    // NOT the dummy enemy.id (the victim stand-in). Equals enemyAttackerActorIds but computable
    // before the runtimes map.
    const enemyRecipientIds = enemyAttackerInputs.map((e) => e.id);
    // Build a full PlayerActorRuntime for each enemy attacker (Task 5), in input order.
    // Each enemy gets its OWN gate instances (determinism isolation), reactive-partitioned
    // abilities, neutral affinity placeholder, and real defence/hp. The enemy walks
    // runPlayerTurn bound to the heal target (Task 6b) — its damage drains into the target,
    // self-buffs land in its own owner store, debuffs/DoTs on the target's per-target store.
    // Manual flat-card enemies (no shipSkills) are handled inside the builder by synthesizing
    // a single 100%/1-hit basic-attack active slot (parity with the retired EnemyAttackerRuntime).
    const enemyPlayerRuntimes: PlayerActorRuntime[] = enemyAttackerInputs.map((e) =>
        buildEnemyPlayerActorRuntime(e, {
            statusEngine,
            enemyIds: enemyRecipientIds,
            enemyDebuffLookup,
        })
    );
    const enemyAttackerActors = enemyPlayerRuntimes.map((r) => r.actor);
    const enemyAttackerActorIds = enemyAttackerActors.map((a) => a.id);
    const enemyPlayerRuntimeByActorId = new Map<string, PlayerActorRuntime>(
        enemyPlayerRuntimes.map((r) => [r.actor.id, r])
    );

    // ── Unified roster seam (bySide unification PR1) ───────────────────────────
    // The canonical, side-agnostic actor set, named once. Order MATTERS: it drives
    // the per-round turn order — `roundActors` is assigned to it each round —
    // [team…, attacker, dummy enemy, enemy attackers…], identical to the array
    // `roundActors` used inline before PR1. The companion accessor `actorsBySide`
    // arrives in a later PR with its first consumer (deferred — unread now =
    // YAGNI/lint); `allActorsById` has now arrived in PR2 (defined just below).
    const allActors: CombatActor[] = [...teamCombatActors, attacker, enemy, ...enemyAttackerActors];

    // TEST-ONLY: hand the full roster out once at construction so unit tests can assert the
    // plumbed base hacking/security on each actor (A2 Task 2). Inert in production (field never set).
    input.__testTapActors?.(allActors);

    // Combined id→actor map over the unified roster (bySide unification PR2 — first
    // consumer). Unlike allPlayerActorsById (attacker + team only), this includes the
    // dummy enemy and every enemy attacker, so a reactive granter on EITHER side
    // resolves. Used by grantExtraAction; companion actorsBySide lands in PR3.
    const allActorsById = new Map<string, CombatActor>(allActors.map((a) => [a.id, a]));

    // The dummy `enemy` is the player-offense sink for DPS-calc / non-positional mode. In a
    // fully-positional team-vs-team sim it is vestigial: every player resolves a real positioned
    // enemy target, so nothing ever routes into its containers and its DoT-tick turn is a pure
    // no-op that only leaks a phantom "enemy" line into the log. Gate its TURN out in that case
    // (it stays in allActors/allActorsById as the `legacyVictim` fallback object — only the turn
    // order drops it). The gate mirrors selectTurnTarget's success predicate statically: real
    // positioned enemies exist AND every player actor is positioned with an ENEMY-side parsed
    // target (positions + parsed targets are fixed for the whole battle). If ANY player could
    // fall back to the dummy sink, keep it in the turn order so its accumulated DoTs still tick.
    // NOT gated on healingMode / enemyAttackers.length — the healing calculator sets healTargetId
    // and can supply bare (non-positioned) enemies where the dummy is still the offense sink.
    //
    // SP-M M1 (Task 9b fix): the first conjunct is extracted as `hasPositionedEnemyRoster` — "does
    // a real, positioned opposing-enemy roster exist" — because the reactive target resolvers
    // below need EXACTLY that signal, not the AND'd version with the player-target conjunct.
    // dummyEnemyIsVestigial's full AND is the right combination for the turn-order gate (only drop
    // the dummy from the turn order when NO player could ever fall back to it), but the second
    // conjunct is irrelevant to whether the resolvers should target the real roster: a healer whose
    // active targets allies does not make the enemy roster any less real. Gating the resolvers on
    // dummyEnemyIsVestigial (its full AND) misrouted Judge/Incinerator/Chakara/Rhodium's reactive
    // damage onto the vestigial dummy whenever the player team included an ally-targeting ship, even
    // in a fully positional sim. Gating them on `input.positionalTeamBattle` instead (an earlier
    // draft of this fix) over-corrected the other way: direct-engine tests (e.g.
    // purgeConditionalSources.test.ts) supply a real, positioned enemyAttackers roster WITHOUT ever
    // setting input.positionalTeamBattle, so that flag is too strict a requirement for "should the
    // resolvers see the real roster". `hasPositionedEnemyRoster` is the narrowest correct signal for
    // both cases.
    const hasPositionedEnemyRoster = enemyAttackerActors.some((a) => a.position != null);
    const dummyEnemyIsVestigial =
        hasPositionedEnemyRoster &&
        allPlayerActors.every((a) => {
            const t = a.kind === 'attacker' ? input.target : teamTargetById.get(a.id);
            return a.position != null && t?.side === 'enemy';
        });
    // The turn-order roster: the dummy `enemy` is dropped when vestigial (positional sim).
    const turnOrderActors = dummyEnemyIsVestigial
        ? allActors.filter((a) => a.id !== enemy.id)
        : allActors;

    // Task 7 — NAMES-ONLY condition-context sources for `enemy-buff` / `self-debuff` gates.
    // These read buff/debuff NAMES from the status engine; they NEVER fold effects (effects
    // are folded exactly once via snapshot()/activeAbilityStatuses/timedAbilityStatuses), so
    // there is no double-fold. Recomputed per turn from CURRENT live state.
    //
    //  - PLAYER actor's `enemy-buff` gate → opposing side = the enemy attacker(s). Aggregation:
    //    UNION of every enemy attacker's self-buff names (the condition is "does an enemy have a
    //    buff", not "does THIS enemy"). Inert in DPS mode (no enemy attackers → empty list).
    //  - PLAYER actor's `self-debuff` gate → its OWN enemy-applied debuffs (per-target store keyed
    //    by its id — the tank carries the enemy attacker's debuffs).
    //  - ENEMY actor's `enemy-buff` gate → opposing side = the player team (union of player
    //    self-buff names). `self-debuff` → its own per-target debuff store keyed by its id.
    const livingEnemyAttackerIds = (): string[] =>
        enemyAttackerActorIds.filter((id) => allActorsById.get(id)?.destroyedRound === undefined);
    const isActorAlive = (actorId: string): boolean =>
        allActorsById.get(actorId)?.destroyedRound === undefined;
    // Quixilver R2: shield pool at or above max HP. Reads `allActorsById` (both sides) and the
    // shared max-HP lookup, so it is team-symmetric by construction. Guards maxHp > 0 so a
    // fixture actor with no HP stat cannot report a "full" shield of zero.
    const isSelfShieldFull = (actorId: string): boolean => {
        const a = allActorsById.get(actorId);
        if (a === undefined) return false;
        const maxHp = recipientMaxHp(actorId);
        return maxHp > 0 && a.shieldPool >= maxHp;
    };
    const playerEnemyBuffNames = (): string[] =>
        selfBuffNamesForOwners(statusEngine, livingEnemyAttackerIds());
    const enemyEnemyBuffNames = (): string[] => selfBuffNamesForOwners(statusEngine, playerIds);
    // Sub-project I, PR I5 — count (not union) of opposing actors holding Stealth, for
    // Selenite's "10% more direct damage for every enemy with Stealth" count-scaling.
    // Same owner-id sourcing as the buff-NAME unions immediately above (team-symmetric);
    // DPS mode has no enemy attackers → livingEnemyAttackerIds() is empty → 0, byte-identical.
    const playerStealthedEnemyCount = (): number =>
        countOwnersWithSelfBuff(statusEngine, livingEnemyAttackerIds(), 'Stealth');
    const enemyStealthedEnemyCount = (): number =>
        countOwnersWithSelfBuff(statusEngine, playerIds, 'Stealth');
    const ownerDebuffNames = (ownerId: string): string[] =>
        ownerDebuffNamesFor(statusEngine, ownerId);
    // Sub-project I, PR I1: NAMES on a resolved (real) opposing target for name-specific
    // `enemy-debuff` gates (Tygr's "to enemies with Stasis or Disable", Incinerator's "to
    // enemies afflicted with Inferno"). Control/marker debuff names come from the same
    // ownerDebuffNamesFor read used for selfDebuffNames above, keyed by the TARGET's id
    // (not the actor's). DoTs (Inferno/Corrosion/Bomb) carry no names of their own in the
    // status-engine's named stores — they are tracked as counted entry arrays only (see
    // roundContext.ts's landedEnemyDebuffCount fold) — so their base-type name is synthesized
    // here from entry-array presence on the target, matching the exact `buffName` strings
    // `enemyEffectConditions` extracts from the raw skill text (base type, no tier suffix —
    // verified empirically: Incinerator's "afflicted with Inferno" clause parses to
    // buffName:'Inferno', never 'Inferno III'). Called ONLY from buildTurnArgs, gated by the
    // same targetId guard (real/positional target) that already protects DPS parity below —
    // this function itself is side-agnostic (team-symmetric: works for a player actor's enemy
    // target or an enemy actor's player target).
    const enemyDebuffNamesForTarget = (target: CombatActor): string[] => [
        ...ownerDebuffNamesFor(statusEngine, target.id),
        ...(target.infernoEntries.length > 0 ? ['Inferno'] : []),
        ...(target.corrosionEntries.length > 0 ? ['Corrosion'] : []),
        ...(target.pendingBombs.length > 0 ? ['Bomb'] : []),
        // SP-E: generic DoTs have no single named type — synthesize a base "Damage over Time"
        // buff-name so an `enemy-debuff` name-gate can still see them.
        ...(target.genericDoTEntries.length > 0 ? ['Damage over Time'] : []),
    ];
    // Sub-project I, PR I4b/I4c — per-VICTIM, per-TICK resolution of an applier's dotMult.
    // Reads `ctx.victimGatedDotDamage` (set by runPlayerTurn ONLY when the applier's cast
    // carried an enemy-status-name-gated dotDamage modifier — Wildfire's Scorching Radiation
    // crit-power bonus, either the applier's OWN or one distributed from an ally's "all
    // allies deal…" aura). The fast path (no such modifier — every other ship) returns
    // `ctx.dotMult` unchanged: byte-identical. When present, re-folds EACH entry's
    // `abilities` against a ctx whose enemy-status fields are swapped to `victim`'s OWN
    // CURRENT live status (read fresh at TICK time via
    // `enemyDebuffNamesForTarget`/`selfBuffNamesForOwners` — deliberately NOT a pre-turn
    // snapshot: a DoT tick is a later, separate event from the cast that applied it, so
    // there is no anti-causality concern about it seeing that SAME cast's own debuff-
    // infliction, unlike I2's positional-apply delta). I4c: a LIST, not a single entry — the
    // applier's own entry (if any) keeps its own ctx (selfCritPower = the APPLIER's own crit
    // power, unchanged from I4b); each distributed ally-aura entry carries the AURA
    // SOURCE's ctx (selfCritPower = the SOURCE's crit power — the locked rule for Wildfire's
    // team aura). Each entry's `enemyDebuffNames`/`enemyBuffNames` are independently
    // re-pointed at `victim` here, so every entry gates on the SAME victim's live status
    // regardless of whose ctx it originated from. Since the abilities were EXCLUDED from
    // the cast-time `dotMult` bake (see `partitionDotDamageAbilities`), each fresh fold is
    // ADDED directly — no base-ctx subtraction needed (contrast I2's
    // `perVictimOutgoingDeltaPct`, which must subtract because its abilities stay baked
    // into the aggregate).
    const victimDotMult = (ctx: PlayerRoundCtx, victim: CombatActor): number => {
        const gated = ctx.victimGatedDotDamage;
        if (!gated || gated.length === 0) return ctx.dotMult;
        let bonus = 0;
        for (const entry of gated) {
            if (entry.abilities.length === 0) continue;
            const victimCtx: ConditionContext = {
                ...entry.ctx,
                ...(entry.ctx.enemyDebuffNames !== undefined
                    ? { enemyDebuffNames: enemyDebuffNamesForTarget(victim) }
                    : {}),
                enemyBuffNames: selfBuffNamesForOwners(statusEngine, [victim.id]),
            };
            bonus += modifierTotalsFromAbilities(entry.abilities, victimCtx).dotDamage;
        }
        return ctx.dotMult + bonus / 100;
    };
    const isStasised = (actorId: string): boolean => ownerDebuffNames(actorId).some(isStasis);
    const isDisabled = (actorId: string): boolean => ownerDebuffNames(actorId).some(isDisable);
    /** Turn-blocked = cannot take its scheduled action this turn (Stasis OR Disable). Used by the
     *  three turn-action gates AND the reactive drain filter (drainQueue). The Stasis-only break /
     *  immunity sites intentionally keep using isStasised — Disable never breaks. */
    const isTurnBlocked = (actorId: string): boolean => isStasised(actorId) || isDisabled(actorId);

    // Base-HP fallback for recipientMaxHp before an actor has taken its first turn (no ctx yet):
    // attacker → input.hp; walked team → walk stats hp; enemy attackers → their CombatActor hp
    // (E5: enemy ids ARE now queried as recipients once enemy heals restore HP).
    const baseHpById = new Map<string, number>([
        [attacker.id, hp],
        ...teamActors.map((t) => [t.id, t.walk!.stats.hp] as const),
        ...enemyAttackerActors.map((a) => [a.id, a.stats.hp] as const),
    ]);
    const baseHpFor = (id: string): number => baseHpById.get(id) ?? 0;

    // ── Side-context bundle (bySide unification PR3) ───────────────────────────
    // Collapses the four hand-paired side closures — the per-side ally-charge grant and the
    // per-side lowest-speed-ally set (plus the drain-time self-HP% lookup) — into ONE
    // side-parameterized SideContext. `actorsBySide(side)` is the primitive (its first
    // consumers are the closures below + the drain/turn call sites). Built once into cached
    // playerSide/enemySide objects so each field is a stable reference.
    //
    // BYTE-IDENTICAL: the player context reproduces the old player closures verbatim; the enemy
    // context reproduces the old enemy closures verbatim — lowestSpeedIds keeps the enemy
    // `length === 0 → ∅` guard (inert for the player side, which always has the attacker), grant
    // loops the side's own actors, and selfHpPctFor returns 100 for every enemy owner (exactly what
    // the old shared healTarget closure returned for a non-healTarget id; an enemy owner id can
    // never equal healTarget.id — reservedActorIds forbids it). The genuine per-actor enemy
    // self-HP% (real enemy currentHp) lands in PR5 with per-actor accounting.
    type Side = CombatActor['side'];

    const actorsBySide = (side: Side): CombatActor[] =>
        side === 'player' ? allPlayerActors : enemyAttackerActors;

    interface SideContext {
        /** Bump every same-side actor's charges by `amount` (capped at each actor's own
         *  chargeCount; chargeCount 0 skipped — no charge skill to bank). The optional `emitBus`
         *  overrides the captured outer bus for the `charge-changed` emission — reactive callers
         *  pass the stamping wrapper (ctx.bus) so the change is branded `reactive`/`duringTurnOf`
         *  and the log nests it under the triggering turn; on-turn callers omit it (unstamped). */
        grantAllyCharges: (
            amount: number,
            opts?: { recipientIds?: string[]; emitBus?: CombatEventBus }
        ) => void;
        /** Subtract `amount` charges from every OPPOSING-side actor (floored at 0), skipping
         *  actors that are `chargeLossImmune` or have no charged skill (chargeCount 0). The
         *  subtractive mirror of grantAllyCharges; flips the side internally so callers pass
         *  THIS side's context (never pre-flipped).
         *
         *  Charge Manipulation affinity gate: when `applierAffinity` is supplied, an opposing
         *  actor with affinity ADVANTAGE over the applier (applier disadvantaged vs it) is SKIPPED
         *  ("Does not affect enemies with affinity advantage over the applying unit"). Undefined →
         *  no gate (byte-identical to pre-gate behaviour); antimatter/neutral matchups never skip.
         *  The optional `emitBus` overrides the captured outer bus for the `charge-changed`
         *  emission — see grantAllyCharges. */
        removeEnemyCharges: (
            amount: number,
            applierAffinity?: AffinityName,
            emitBus?: CombatEventBus
        ) => void;
        /** Single-target charge removal: subtract `amount` from ONE actor by id (floored at 0,
         *  chargeLossImmune / chargeCount-0 actors skipped). Used for "decrease THAT enemy's
         *  charge" (Zosimos), routed by eventCtx.repairerId. Does NOT require the opposing-side
         *  filter — the caller passes a known-opposing id. Same `applierAffinity` charge-manip gate
         *  as removeEnemyCharges: an affinity-advantaged target is skipped when the affinity is
         *  supplied. The optional `emitBus` overrides the captured outer bus — see grantAllyCharges. */
        removeChargesFrom: (
            targetId: string,
            amount: number,
            applierAffinity?: AffinityName,
            emitBus?: CombatEventBus
        ) => void;
        /** Same-side ids sharing the minimum LIVE effective speed (ties → all). Empty side → ∅
         *  (DPS / no enemy attackers). Recomputed per gate eval (speed is dynamic). */
        lowestSpeedIds: () => Set<string>;
        /** Live self-HP% for a same-side drain owner (hp-threshold gates). Player side reads the
         *  heal target's live HP (every other id → 100), undefined in DPS mode (→ buildDrainContext
         *  defaults to 100). Enemy side returns 100 for every owner (no per-actor enemy HP until
         *  PR5). Consumed in Task 2. */
        selfHpPctFor?: (ownerId: string) => number;
        /** Same-side ids adjacent to `ownerId` on the board (living, owner excluded). Positional
         *  → board neighbours; non-positional (no positions wired) → all living same-side allies. */
        adjacentAllyIdsFor: (ownerId: string) => string[];
        /** Living ally ids on the owner's ACTIVE support pattern footprint. */
        footprintAllyIdsFor: (ownerId: string) => string[] | undefined;
    }

    const parsedPatternForActor = (a: CombatActor): ParsedPattern | undefined => {
        if (a.side === 'enemy') return enemyPatternById.get(a.id);
        if (a.kind === 'attacker') return input.pattern;
        return teamPatternById.get(a.id);
    };

    const buildSideContext = (side: Side): SideContext => {
        const actors = actorsBySide(side);
        return {
            grantAllyCharges: (
                amount: number,
                opts?: { recipientIds?: string[]; emitBus?: CombatEventBus }
            ): void => {
                const targets =
                    opts?.recipientIds !== undefined
                        ? actors.filter((a) => opts.recipientIds!.includes(a.id))
                        : actors;
                for (const a of targets) {
                    if (a.chargeCount <= 0) continue;
                    const oldCharge = a.charges;
                    a.charges = Math.min(a.charges + amount, a.chargeCount);
                    if (a.charges !== oldCharge) {
                        (opts?.emitBus ?? bus).emit({
                            type: 'charge-changed',
                            actorId: a.id,
                            round: currentRound,
                            oldCharge,
                            newCharge: a.charges,
                            reason: 'manip',
                        });
                    }
                }
            },
            // Enemy-targeted charge removal: subtract from each opposing actor, floored at 0,
            // skipping immune actors and those with no charged skill. Mirror of grantAllyCharges
            // but on the opposing side, and subtractive.
            removeEnemyCharges: (
                amount: number,
                applierAffinity?: AffinityName,
                emitBus?: CombatEventBus
            ): void => {
                for (const a of actorsBySide(side === 'player' ? 'enemy' : 'player')) {
                    if (a.chargeCount <= 0 || a.chargeLossImmune) continue;
                    // Charge-manip affinity gate: skip an actor with affinity advantage over the
                    // applier (applier disadvantaged vs it). No-op when affinity undefined/neutral.
                    if (
                        applierAffinity &&
                        getAffinityMatchup(applierAffinity, a.affinity) === 'disadvantage'
                    )
                        continue;
                    const oldCharge = a.charges;
                    a.charges = Math.max(0, a.charges - amount);
                    if (a.charges !== oldCharge) {
                        (emitBus ?? bus).emit({
                            type: 'charge-changed',
                            actorId: a.id,
                            round: currentRound,
                            oldCharge,
                            newCharge: a.charges,
                            reason: 'manip',
                        });
                    }
                }
            },
            // Single-target charge removal: subtract from ONE opposing actor (floored at 0,
            // immune actors skipped). Used for "decrease THAT enemy's charge" (Zosimos), routed
            // by eventCtx.repairerId. Mirror of removeEnemyCharges but one actor, not all.
            removeChargesFrom: (
                targetId: string,
                amount: number,
                applierAffinity?: AffinityName,
                emitBus?: CombatEventBus
            ): void => {
                const a = allActorsById.get(targetId);
                if (!a || a.chargeCount <= 0 || a.chargeLossImmune) return;
                // Charge-manip affinity gate: skip a target with affinity advantage over the
                // applier (applier disadvantaged vs it). No-op when affinity undefined/neutral.
                if (
                    applierAffinity &&
                    getAffinityMatchup(applierAffinity, a.affinity) === 'disadvantage'
                )
                    return;
                const oldCharge = a.charges;
                a.charges = Math.max(0, a.charges - amount);
                if (a.charges !== oldCharge) {
                    (emitBus ?? bus).emit({
                        type: 'charge-changed',
                        actorId: a.id,
                        round: currentRound,
                        oldCharge,
                        newCharge: a.charges,
                        reason: 'manip',
                    });
                }
            },
            lowestSpeedIds: (): Set<string> => {
                if (actors.length === 0) return new Set<string>();
                const speeds = actors.map((a) => effectiveSpeedOf(a));
                const min = Math.min(...speeds);
                return new Set(actors.filter((_, i) => speeds[i] === min).map((a) => a.id));
            },
            selfHpPctFor:
                side === 'player'
                    ? healTarget
                        ? (ownerId: string): number => {
                              if (ownerId !== healTarget.id) return 100;
                              // Same denominator as the cast-path selfHpPct (baseHpFor) so the gate
                              // flips at the same threshold at cast vs drain time.
                              const maxHp = baseHpFor(healTarget.id);
                              if (maxHp <= 0) return 100;
                              return Math.max(
                                  0,
                                  Math.min(100, (healTarget.currentHp / maxHp) * 100)
                              );
                          }
                        : undefined
                    : (): number => 100,
            adjacentAllyIdsFor: (ownerId: string): string[] => adjacentAllyIds(ownerId, actors),
            footprintAllyIdsFor: (ownerId: string): string[] | undefined => {
                const owner = allActorsById.get(ownerId);
                if (!owner) return undefined;
                return supportFootprintAllyIds({
                    pattern: parsedPatternForActor(owner),
                    anchor: owner.position,
                    sameSideLiving: actors.filter((a) => a.currentHp > 0),
                });
            },
        };
    };

    const playerSide = buildSideContext('player');
    const enemySide = buildSideContext('enemy');
    const bySide = (side: Side): SideContext => (side === 'player' ? playerSide : enemySide);

    // Base-DEFENCE fallback for an enemy attacker's target-defence read before the target has
    // taken its first turn (no ctx yet): attacker → input.defence; walked team → walk defence;
    // legacy team → 0. After the target's first turn the live ctx.effectiveDefence is preferred.
    const baseDefenceById = new Map<string, number>([
        [attacker.id, defence],
        ...teamActors.map((t) => [t.id, t.walk!.stats.defence] as const),
    ]);
    const baseDefenceFor = (id: string): number => baseDefenceById.get(id) ?? 0;

    // The per-round healing map. Rebound at the top of each round (in healing mode) so the
    // ctx's `credit` always writes into the CURRENT round's entries via this `let`.
    let currentRoundHealing = new Map<string, ActorHealing>();
    const healFor = (id: string): ActorHealing => {
        let h = currentRoundHealing.get(id);
        if (!h) {
            h = emptyActorHealing();
            currentRoundHealing.set(id, h);
        }
        return h;
    };
    // H1 Task 6: per-round shield-granted accumulator (recipient actor id → total shield
    // actually added to its pool THIS round, post-cap delta). Mirrors `currentRoundHealing`'s
    // lifecycle: declared once here, captured by grantShieldToTarget's live closure, and rebound
    // fresh at the top of each round so it never accumulates across rounds. Surfaced as the
    // `granted` half of RoundData.perActorShield at the post-round push.
    let perActorShieldGranted = new Map<string, number>();
    // Reflect gear set (Task 5): per-round reflected-thorns accumulator (ATTACKER actor id →
    // total reflected damage dealt back to it THIS round). Mirrors perActorShieldGranted's
    // lifecycle — declared once, written by the reflection block inside applyVictimDamage, and
    // rebound fresh each round so it never accumulates across rounds. Surfaced both as the
    // attacker's incoming (automatic via the sink) AND on RoundData.perActorReflected.
    let perActorReflected = new Map<string, number>();
    // Bomb-splash-on-death: per-round accumulator (adjacent-ally actor id → total splash damage
    // dealt to it THIS round by dying bombed allies). Mirrors perActorShieldGranted's lifecycle
    // (declared once, rebound fresh each round at ~3352, captured by the splash block in the death
    // seam). Surfaced as RoundData.perActorSplash at the post-round push (absent when empty →
    // non-positional / no-splash rounds stay byte-identical).
    let perActorSplash = new Map<string, number>();
    // Per-victim skill-triggered detonation (positional): per-round accumulator (detonating
    // actor id → total detonation damage it dealt across footprint victims THIS round). Mirrors
    // perActorSplash's lifecycle (declared once, rebound fresh each round, captured by the
    // positional detonation loop). Sources the focus detonationDamage display row in positional
    // mode (focus.detonation is 0 there — the aggregate credit is suppressed). Absent when empty
    // → non-positional rounds byte-identical.
    let perActorDetonation = new Map<string, number>();
    // Per-round per-applier DoT-tick display tally (sourceId → {corrosion, inferno}). Populated
    // ONLY by the positional per-victim DoT-tick path (Task C2); folded into the FOCUS actor's
    // corrosion/inferno display + raw totals at post-round assembly WITHOUT feeding cumulativeDamage
    // (the per-victim HP already lands via applyVictimDamage — exact mirror of perActorDetonation).
    // Empty on non-positional rounds → byte-identical.
    let perActorDot = new Map<string, { corrosion: number; inferno: number; generic: number }>();

    // Recipient's CURRENT effective max HP: prefer the actor's last-turn ctx (live buffs),
    // else its base HP (pre-first-turn). Same pattern for incoming-heal %: the ctx value
    // already folds the actor's pre-fight incomingHeal baseline (playerTurn folds it into
    // scheduledTotals), so the preFight fallback below fires ONLY before the actor's first
    // turn — never double-counted (F3).
    const recipientMaxHp = (id: string): number =>
        lastTurnCtxByActor.get(id)?.effectiveMaxHp ?? baseHpFor(id);
    const recipientIncomingHealPct = (id: string): number =>
        lastTurnCtxByActor.get(id)?.incomingHealPct ??
        allActorsById.get(id)?.preFight?.incomingHeal ??
        0;

    // Heal target's live HP% (0..100) for `hpSubject:'target'` cast-time gates (Task 5). Read at
    // the ACTING actor's turn start (pre-this-cast-heal): healTarget.currentHp already reflects
    // the turn-start DoT tick but not the cast's heal. DPS mode (no healTarget) → 100 → a "below
    // N" target gate fails → the grant is inert in DPS (correct). Defined here so every player
    // turn dispatch (attacker + walked team) reads the same denominator (recipientMaxHp).
    const healTargetHpPctNow = (): number => {
        if (!healTarget) return 100;
        const maxHp = recipientMaxHp(healTarget.id);
        return maxHp > 0 ? (100 * Math.max(0, healTarget.currentHp)) / maxHp : 100;
    };

    // The healing rounds + first-destroyed-round seam (target HP can only reach 0 via enemy
    // attacks, which land in Task 8 — the detection just never fires this task).
    const healingRounds: HealingRoundEngine[] = [];
    // Backstop-only local (PR5c): holds ONLY the post-round backstop's independent contribution
    // — the start-dead / no-`recordDestroyed` path where the heal target enters a round at
    // currentHp<=0 without ever being stamped by recordDestroyed (Task-1 OUTCOME B). The normal
    // death round now comes from the per-actor `healTarget.destroyedRound` field; this captures
    // only the case that field never sees.
    let backstopDestroyedRound: number | undefined;
    // Cheat Death consumption (Phase 4b). A 'recurring'/always-active Cheat Death buff is
    // re-derived every round and is NOT stored in the StatusEngine's timed maps, so it cannot
    // be consumed by deleting it from a store (it would regenerate next round). Consumption is
    // therefore a per-actor ENGINE FLAG with combat lifetime: once an actor's intercept fires,
    // its id lands here and a SECOND lethal hit destroys it normally even though the recurring
    // buff is still in the snapshot. Declared OUTSIDE the round loop → persists across rounds.
    const cheatDeathConsumed = new Set<string>();
    // Lifeline (incoming-shield-grant): once-per-BATTLE fired flags, keyed `${victimId}:${abilityId}`.
    // Combat-lifetime (NOT reset per round) — the shield grant occurs at most once per combat.
    const thresholdShieldFired = new Set<string>();
    // Display-only (Phase 4c): a spent Cheat Death keeps reappearing in the displayed buff list
    // for two reasons, depending on how it was granted. (1) Passive/aura grants (Tycho) are
    // re-derived from the persistent aura store every round and clearRemovable leaves auras
    // intact by design. (2) Active/charged cast-path grants (timed, Infinity) ARE deleted by
    // clearRemovable on consumption, but a slot that re-fires each round re-applies them. Either
    // way the chip would keep showing even though no further save is possible (consumption is the
    // flag above, not a permanent store removal). `cheatDeathConsumed` is combat-lifetime and
    // never re-armed (only ever .add'd / .has'd — see the intercept), so an actor present here
    // can never be saved again.
    //
    // We track the round the intercept fired (set alongside the flag) and hide the chip only in
    // rounds STRICTLY AFTER consumption: the consuming round still shows it (that round's chip
    // reflects the protection that was live and actually saved the unit), and every subsequent
    // round drops it. Pure display filter — does NOT touch save logic.
    const cheatDeathConsumedRound = new Map<string, number>();
    const hideSpentCheatDeath = (
        buffs: ActiveBuff[],
        ownerId: string,
        round: number
    ): ActiveBuff[] => {
        const consumedRound = cheatDeathConsumedRound.get(ownerId);
        return consumedRound !== undefined && round > consumedRound
            ? buffs.filter((b) => !CHEAT_DEATH_BUFFS.has(b.buffName))
            : buffs;
    };
    // Once-per-combat reactive repairs (Phase 4b, Task 8). Keyed `${ownerId}:${abilityId}`.
    // Declared OUTSIDE the round loop (combat lifetime, like cheatDeathConsumed) so a flagged
    // repair — Yazid's on-cheat-death-activated 60% repair — fires at most once per battle even
    // across rounds. Threaded into executeIntent's ctx; the executor checks/sets it.
    const oncePerCombatFired = new Set<string>();
    // Combat-lifetime per-(owner, ability, source) event counter for everyNthEvent gates.
    // Keyed `${ownerId}:${abilityId}:${repairerId}`; incremented on every qualifying enqueue-drain
    // and used to trigger removal only on the Nth event (e.g. Zosimos "every second repair").
    const repairCountBySource = new Map<string, number>();
    // Combat-lifetime proc-chance gates for equipment reactive procs (D-PR1). Keyed
    // `${ownerId}:${abilityId}`; each gate is a RateGate that fires with the ability's
    // procChance probability on each draw (random, like the crit/landing gates).
    const procChanceGates = new Map<string, RateGate>();
    // Per-actor-turn verdict cache for procScope:'per-attack' proc abilities (Insidiousness).
    // Keyed `${ownerId}:${abilityId}`; cleared at each actor turn-start beside
    // reactionFiredThisAttack so a later attack rolls afresh.
    const procDecisionThisAttack = new Map<string, boolean>();
    // G PR1: dedicated crit-gate for counterattacks. A NEW map (NOT any existing per-actor
    // crit gate) so it only ever creates keys for counter-carriers → no draw, no perturbation
    // for every existing fixture → byte-identical.
    const counterCritGates = new Map<string, RateGate>();
    // PR4b: dedicated crit-gate for the reactive `damage` executor (Judge/Chakara/Incinerator/
    // Rhodium/Grif/FrontLine start-of-round/end-of-round/on-enemy-cleansed/on-enemy-charged-cast
    // procs). A NEW map, mirroring counterCritGates — keyed `${ownerId}:${abilityId}`, so it only
    // ever draws for ships carrying one of these abilities. `noCrit`-flagged abilities (Grif,
    // Rhodium) never touch this map at all (the `!noCrit &&` short-circuit in applyReactiveDamage
    // skips the roll entirely) — no gate is ever created for them, so they can never crit by
    // construction, independent of the RNG stream.
    const reactiveDamageCritGates = new Map<string, RateGate>();
    // SP-G G3: the last reactive-damage `raw` each owner dealt, so a sibling reactive shield
    // enqueued on the SAME trigger (FrontLine's "Shield equal to 30% of the damage dealt")
    // can scale off the ACTUAL mitigated/crit amount rather than a flat attack approximation.
    // Written by applyReactiveDamage (below), read by the reactive-shield executor via the
    // exec ctx. Damage intent drains before the shield intent (enqueue order), so the value is
    // fresh when the shield reads it.
    const reactiveDealtByOwner = new Map<string, number>();

    // ═══════════════════════════════════════════════════════════════════════════════════════
    // Reactive extra-action timing analysis (Phase 4b Task 10). Two death paths land an
    // extra-action grant in DIFFERENT rounds; the engine's grantExtraAction (below) dispatches
    // by whether the round-local turn queue is still being walked:
    //
    //  PATH A — during-turn deaths (on-destroyed self, on-ally-destroyed ally → Harvester).
    //    These fire from applyIncomingToTarget / the general death path, which run DURING an
    //    actor's turn. They are followed by the per-turn drainIntentsFor(side) (drain point (b))
    //    while the selection loop is still walking → the grant CAN bump the granter's pending
    //    count via processExtraActionGrants(granter, …), and the selection loop then re-picks the
    //    granter at its live speed-rank among the remaining actors (a same-round extra turn).
    //    `inTurnLoop` is true only while the loop body walks; the pre-loop / post-round drains
    //    see it false → Path B.
    //
    //  PATH B — post-round enemy death (cross-round buffered grant). Fires when an enemy death is
    //    reconciled AFTER the turn loop closed and after the round's last per-turn
    //    drainIntentsFor(side), with NO live queue. The post-round drain block then:
    //      1. runs drainIntentsFor('player')/drainIntentsFor('enemy') right after the
    //         ship-destroyed emit — on-enemy-destroyed CHARGE reactives (Liberator's "all allies
    //         add 1 charge") apply immediately; charges carry into the next round → correct.
    //      2. buffers extra-action grants (inTurnLoop false → grantExtraAction pushes onto
    //         `pendingExtraActions`); at the START of the NEXT round's pool construction each
    //         buffered granter's pending count is bumped one extra (respecting once-per-round via
    //         the SAME round extraActionFired set) → the on-kill extra action lands the round AFTER
    //         the kill is registered.
    //    LIVE TODAY (SP-U U5): the DPS opponent (`enemy`) is now a REAL destructible actor. In
    //    pure DPS mode (`dpsEnemyTarget`, no positioned enemy attackers) its HP lands post-round —
    //    AFTER the turn loop closes, once per round — through the shared `applyVictimDamage`
    //    funnel; if that crosses 0 HP, `recordDestroyed` stamps `destroyedRound` and emits
    //    ship-destroyed with `inTurnLoop` false, so this IS a genuine Path-B post-round death (see
    //    the "Path-B drain (Task 10)" block right after that `applyVictimDamage` call, ~line
    //    7742). The round loop then breaks (the row for the killing round is already pushed), so
    //    the buffered grant lands only if the run continued — it currently does not, since the run
    //    terminates the round the DPS enemy dies. In sim/healing mode the vestigial dummy sink
    //    (`!dpsEnemyTarget`) never dies, so it never reaches this path. Real positioned enemy
    //    attackers still die DURING a turn (positional applyOutgoingToEnemy → recordDestroyed in
    //    the live queue) → Path A, not B. Enemy-incoming-accounting nuances around this tail are
    //    deferred to SP-F/F7.
    //
    // pendingExtraActions is COMBAT-lifetime (outside the round loop) so a kill reconciled at the
    // end of round R survives into round R+1's pool build. Each entry is flushed (and removed)
    // exactly once at the next round's start.
    // ═══════════════════════════════════════════════════════════════════════════════════════
    const pendingExtraActions: {
        granterId: string;
        abilityId: string;
        oncePerRound: boolean;
        endOfRound: boolean;
    }[] = [];

    // Per-round set of actor ids that received a positive HP repair this round (C2b-3).
    // Cleared at each round top; read in buildTurnArgs for the target-repaired gate.
    const repairedThisRound = new Set<string>();

    // D-PR8: actors hit by a direct attack this round (damage landed on shield or HP).
    // Mirrors repairedThisRound. Feeds the not-hit-this-round gate (Alacrity). Cleared each
    // round alongside repairedThisRound.
    const hitThisRound = new Set<string>();

    // G PR1: once-per-attack guard. Cleared at every actor turn-start so all per-hit `attacked`
    // events of ONE attack collapse to a single counter, while a separate later attack (a different
    // turn) counters again. NOT per-round.
    const counterFiredThisTurn = new Set<string>();

    // Task 5: sibling once-per-attack guard for SELF-scoped reactive buff/heal/charge riders
    // (Hermes's Everliving Regeneration + charge on on-ally-crit). Same lifecycle as
    // counterFiredThisTurn — cleared at every actor turn-start so a multi-hit / AoE attack applies
    // a self-rider once, while a later attack (a different turn) applies it again.
    const reactionFiredThisAttack = new Set<string>();

    // The SHARED healing ctx (built once; closures capture the live target + currentRoundHealing
    // through the `let`/the target reference). Only constructed in healing mode.
    const healingCtx: HealingRuntimeCtx | undefined = healTarget
        ? {
              targetId: healTarget.id,
              teamBattle: input.positionalTeamBattle ?? false,
              credit: (actorId, bucket, amount) => {
                  healFor(actorId)[bucket] += amount;
              },
              recipientMaxHp,
              recipientIncomingHealPct,
              recipientIncomingHealAmpPct: (rid) =>
                  incomingHealAmpForRecipient(
                      incomingHealAmpAbilitiesOf(rid),
                      (abilityId, chance) =>
                          rollRateGate(procChanceGates, `${rid}:${abilityId}`, chance)
                  ),
              // Foreign HoT applier max HP (Task 7): lastTurnCtxByActor ONLY, NO base-stat
              // fallback (strict corrosion applier-ctx rule — undefined → the holder skips the tick).
              applierMaxHp: (id) => lastTurnCtxByActor.get(id)?.effectiveMaxHp,
              applyHealToTarget: (raw, victim = healTarget) => {
                  // Dead target → all overheal. Otherwise consume up to the deficit against
                  // the target's CURRENT effective max HP (live ctx via recipientMaxHp).
                  if (victim.currentHp <= 0) {
                      return { consumed: 0, overheal: raw };
                  }
                  const targetMaxHp = recipientMaxHp(victim.id);
                  // Clamp the deficit at 0: a max-HP buff expiring can shrink effectiveMaxHp
                  // below currentHp, making (targetMaxHp - currentHp) negative — without the
                  // Math.max a heal would REDUCE the target's HP. Floor at 0 → consumed 0,
                  // overheal = raw (the whole heal is wasted, which is correct in that state).
                  const consumed = Math.max(0, Math.min(raw, targetMaxHp - victim.currentHp));
                  victim.currentHp += consumed;
                  if (consumed > 0) repairedThisRound.add(victim.id);
                  return { consumed, overheal: raw - consumed };
              },
              grantShieldToTarget: (raw, victim = healTarget) => {
                  if (victim.currentHp <= 0) return 0; // dead → no-op
                  const targetMaxHp = recipientMaxHp(victim.id);
                  // Capped at the CURRENT effective max HP. Note: if a max-HP buff later expires
                  // and shrinks targetMaxHp below an already-granted pool, the larger pool simply
                  // persists (we never shrink an existing shield) — acceptable, as the cap is only
                  // enforced at grant time and a shield is additive, never HP-reducing.
                  // Post-cap delta (Task 6): record the REAL increase, not `raw`. A grant that
                  // exceeds the maxHP cap records only the portion that actually landed, so the
                  // surfaced `granted` matches the pool growth the UI shows.
                  const before = victim.shieldPool;
                  victim.shieldPool = Math.min(victim.shieldPool + raw, targetMaxHp);
                  const actualGranted = victim.shieldPool - before;
                  perActorShieldGranted.set(
                      victim.id,
                      (perActorShieldGranted.get(victim.id) ?? 0) + actualGranted
                  );
                  // H3.6: return the REAL pool growth so the cast path / reactive executor can
                  // build the shield-applied event's recipientIds (granted > 0) + amount. Existing
                  // callers ignore the return (non-breaking — call for effect only).
                  return actualGranted;
              },
              playerIds,
              enemyIds: enemyRecipientIds,
              recipientActor: (id) => allActorsById.get(id),
          }
        : undefined;

    // --- Phase 3 reactive triggers ---
    // Intent queues (FIFO), one per side (SP-U U3: merged the former separate `intentQueue` /
    // `enemyIntentQueue` locals into one bySide record). Reactive listeners enqueue follow-up
    // executions; the engine drains them at the drain points. Pure listeners (enqueue only) keep
    // the Phase 1 contract — the executor is the only state mutator.
    const intentQueues: Record<Side, Intent[]> = { player: [], enemy: [] };
    // Per-owner reactive listeners (Task 6): the FOCUS/attacker owner FIRST (zero-churn —
    // its listeners enqueue in the historical order), then every walked team owner in input
    // order. Each owner's guards key on its OWN events; the executor routes the follow-up to
    // the owner's runtime. A legacy team actor (no walk) has no reactive abilities → omitted.
    const reactivePerOwner: { ownerId: string; reactiveAbilities: typeof reactiveAbilities }[] = [
        { ownerId: 'attacker', reactiveAbilities },
        ...teamActors
            .filter((t) => teamRuntimeById.has(t.id))
            .map((t) => ({
                ownerId: t.id,
                reactiveAbilities: teamRuntimeById.get(t.id)!.reactiveAbilities,
            })),
    ];
    // Enemy-side actor ids: the singular dummy wall enemy AND every enemy ATTACKER (healing
    // mode). Enemy attackers now walk runPlayerTurn (commit 6c456a14) and emit the full reactive
    // event suite with side === 'enemy'; ally-scoped player listeners MUST treat all of these as
    // non-allies, not just the dummy. seenEnemyAttackerIds holds the attacker ids (empty for a
    // DPS/attacker-only run → only the dummy is enemy-side).
    const isEnemySide = (actorId: string): boolean =>
        actorId === enemy.id || seenEnemyAttackerIds.has(actorId);
    // Damaged-ally role lookup for role-filtered reactions (Graphite). Roles come from
    // ship data on the healing page (TeamActorInput.role / the focus actor's input.role);
    // built for ALL player actors for uniformity even though in healing mode only the heal
    // target is ever attacked. An actor without a role stays OFF the map → roleOf returns
    // undefined → role-filtered reactions stay dormant for hits on it (conservative).
    // SP-F F5: also seeded from enemyAttackers' own `role` (EnemyActorInput.role) — the map
    // was already side-agnostic BY KEY (any actor id, either side); no enemy caller populated
    // it before this task. Consumed today by Meatshield's defense-substitution gate (via
    // matchesRoleCategory) on EITHER side, in addition to Graphite's existing player-only use.
    const roleByActorId = new Map<string, ShipTypeName>();
    if (input.role) roleByActorId.set(focusActorId, input.role);
    for (const t of teamActors) if (t.role) roleByActorId.set(t.id, t.role);
    for (const e of input.enemyAttackers ?? []) if (e.role) roleByActorId.set(e.id, e.role);
    // SP-F F4: actor id → ship name (mirrors roleByActorId, side-agnostic by key) for the live
    // `ally-on-team` roster check (Isha/Nayra reciprocal Override gate). Only populated when a
    // caller supplies ship names (team sim); left empty in single-ship DPS / manual runs → the
    // gate keeps its assume-met fallback. Threaded into executeIntent's IntentExecContext below.
    const nameByActorId = new Map<string, string>();
    if (input.name) nameByActorId.set(focusActorId, input.name);
    for (const t of teamActors) if (t.name) nameByActorId.set(t.id, t.name);
    for (const e of input.enemyAttackers ?? []) if (e.name) nameByActorId.set(e.id, e.name);
    // Enemy-side reactive per-owner list (enemy-team PR1): every enemy ATTACKER's own reactive
    // abilities (e.g. Chakara's start-of-round self Attack Up) — before this they were
    // partitioned onto the enemy runtime but never listened for.
    const enemyReactivePerOwner = enemyPlayerRuntimes.map((rt) => ({
        ownerId: rt.actor.id,
        reactiveAbilities: rt.reactiveAbilities,
    }));
    // SP-U U3: one bySide loop replaces the former two separate registerReactiveListeners calls
    // (player unconditional, enemy gated on `enemyReactivePerOwner.length > 0`).
    // registerReactiveListeners holds NO module-level state: it only attaches per-call
    // `bus.on(...)` subscriptions closing over its args, so registering per side independently
    // is safe — a second call adds an independent listener set without disturbing the other
    // side's registration. The length-gate is kept (applies uniformly to both sides here) purely
    // as an early-exit: an empty `perOwner` array already makes registerReactiveListeners a no-op
    // (its body is a single `for (const {..} of perOwner)` loop), so DPS / bare-stat-enemy runs
    // still register nothing on the enemy side (goldens byte-identical); the player side's
    // `perOwner` always has the attacker, so its gate never trips.
    const perOwnerBySide: Record<
        Side,
        { ownerId: string; reactiveAbilities: typeof reactiveAbilities }[]
    > = {
        player: reactivePerOwner,
        enemy: enemyReactivePerOwner,
    };
    for (const side of ['player', 'enemy'] as const) {
        const perOwner = perOwnerBySide[side];
        if (perOwner.length === 0) continue;
        registerReactiveListeners({
            bus,
            perOwner,
            enqueue: (intent) => intentQueues[side].push(intent),
            // Player registration: opposing = enemy-side (isEnemySide). Enemy registration:
            // opposing = player-side, its negation — bySide PR2's per-call isOpposing, so an
            // enemy owner's opposing/ally reactions route against the correct side. Reproduced
            // exactly per side from the pre-merge player/enemy calls.
            isOpposing: side === 'enemy' ? (id: string) => !isEnemySide(id) : isEnemySide,
            roleOf: (id) => roleByActorId.get(id),
            adjacentAllyIdsFor: (ownerId: string) =>
                bySide(isEnemySide(ownerId) ? 'enemy' : 'player').adjacentAllyIdsFor(ownerId),
            // D-PR16: owner effective max HP (live ctx ?? base HP) — gates Tenacity's >25% filter.
            // id-keyed and side-agnostic, so the same closure serves both side registrations.
            maxHpOf: (ownerId: string) => recipientMaxHp(ownerId),
        });
    }

    // Owner-routed executor context (Task 6): the executor resolves an intent's owner runtime
    // from this map for per-owner landing gates, charge caps, sourceId, bomb effective-attack.
    const runtimesById = new Map<string, PlayerActorRuntime>([
        ['attacker', attackerRuntime],
        ...teamRuntimeById,
    ]);

    // Passive-slot standing leeches per owner (damage-leech spec §4): X% of credited
    // damage repaired/shielded immediately at credit time. Scanned once at setup from each
    // runtime's reactive-partitioned castSkills (passive-slot heal/shield abilities are
    // on-cast, not reactive, so they remain here after partitioning). Healing mode only.
    interface StandingLeech {
        kind: 'heal' | 'shield';
        pct: number;
        target: AbilityTarget;
        noCrit: boolean;
        scope: 'all' | 'detonation';
    }
    const standingLeeches = new Map<string, StandingLeech[]>();
    if (healTarget) {
        for (const [ownerId, rt] of runtimesById) {
            const entries: StandingLeech[] = [];
            for (const slot of rt.castSkills.slots) {
                if (slot.slot !== 'passive') continue;
                for (const a of slot.abilities) {
                    const c = a.config;
                    if ((c.type === 'heal' || c.type === 'shield') && c.basis === 'damage-dealt') {
                        entries.push({
                            kind: c.type,
                            pct: c.pct,
                            target: a.target,
                            noCrit: c.type === 'heal' ? (c.noCrit ?? false) : true,
                            scope: c.leechScope ?? 'all',
                        });
                    }
                }
            }
            if (entries.length > 0) standingLeeches.set(ownerId, entries);
        }
    }

    // Passive damage-taken abilities per owner (damage-leech spec §5): each enemy ATTACK on a
    // victim procs that victim's own abilities AFTER the attack's shield-first drain. Sibling
    // shape to the standing leeches above — scanned once at setup from every runtime, keyed by
    // owner id. The non-positional consumption site reads only the heal target's list (enemy
    // attacks land on the heal target in that model), so its behavior is unchanged; the
    // per-owner map prepares the per-victim positional path (Phase-5 follow-up). Healing mode only.
    interface TakenLeech {
        kind: 'heal' | 'shield';
        pct: number;
        noCrit: boolean;
        requiresHpDamage: boolean;
    }
    const takenLeechesByOwner = new Map<string, TakenLeech[]>();
    if (healTarget) {
        for (const [ownerId, rt] of runtimesById) {
            const entries: TakenLeech[] = [];
            for (const slot of rt.castSkills.slots) {
                if (slot.slot !== 'passive') continue;
                for (const a of slot.abilities) {
                    const c = a.config;
                    if ((c.type === 'heal' || c.type === 'shield') && c.basis === 'damage-taken') {
                        entries.push({
                            kind: c.type,
                            pct: c.pct,
                            noCrit: c.type === 'heal' ? (c.noCrit ?? false) : true,
                            requiresHpDamage: c.requiresHpDamage ?? false,
                        });
                    }
                }
            }
            if (entries.length > 0) takenLeechesByOwner.set(ownerId, entries);
        }
    }

    // D-PR3: per-actor victim-side incoming-effect abilities (incoming-reduction + incoming-block),
    // side-agnostic (a ship defends on either team). Built once from BOTH runtime maps; empty for
    // actors without the relevant equipment. Consumed today only by the %-reduction fold in the
    // positional path; incoming-block is collected here too for the later block task.
    const incomingAbilitiesById = new Map<string, Ability[]>();
    for (const rt of [...runtimesById.values(), ...enemyPlayerRuntimeByActorId.values()]) {
        if (incomingAbilitiesById.has(rt.actor.id)) continue; // dedupe if an actor is in both maps
        const incoming: Ability[] = [];
        for (const slot of rt.castSkills.slots) {
            if (slot.slot !== 'passive') continue;
            for (const a of slot.abilities) {
                if (
                    a.config.type === 'incoming-reduction' ||
                    a.config.type === 'incoming-block' ||
                    a.config.type === 'incoming-shield-grant' ||
                    a.config.type === 'damage-reflection' ||
                    // SP-E: Voron/Orel's reactive self-DoT transform, consumed at the
                    // applyVictimDamage funnel below (direct intake only).
                    a.config.type === 'transform-incoming-to-dot'
                ) {
                    incoming.push(a);
                }
            }
        }
        if (incoming.length) incomingAbilitiesById.set(rt.actor.id, incoming);
    }
    const incomingAbilitiesOf = (id: string): Ability[] => incomingAbilitiesById.get(id) ?? [];

    // D-PR6: per-actor recipient-side incoming-heal-amplification abilities (Exuberance),
    // side-agnostic (a ship can be a heal recipient on either team). Built once from BOTH runtime
    // maps; empty for actors without the relevant equipment. Consumed by the heal-apply fold (a
    // later task) — nothing reads it yet, so this is byte-identical.
    const incomingHealAmpAbilitiesById = new Map<string, Ability[]>();
    for (const rt of [...runtimesById.values(), ...enemyPlayerRuntimeByActorId.values()]) {
        if (incomingHealAmpAbilitiesById.has(rt.actor.id)) continue; // dedupe if an actor is in both maps
        const heals: Ability[] = [];
        for (const slot of rt.castSkills.slots) {
            if (slot.slot !== 'passive') continue;
            for (const a of slot.abilities) {
                if (a.config.type === 'incoming-heal-amplification') heals.push(a);
            }
        }
        if (heals.length) incomingHealAmpAbilitiesById.set(rt.actor.id, heals);
    }
    const incomingHealAmpAbilitiesOf = (id: string): Ability[] =>
        incomingHealAmpAbilitiesById.get(id) ?? [];

    // D-PR4: per-actor attacker-side outgoing-amplification abilities (Menace/Giant Slayer),
    // side-agnostic (a ship amplifies on either team). Built once from BOTH runtime maps; empty for
    // actors without the relevant equipment. Consumed by the per-victim amplification hook on the
    // positional path.
    const outgoingAbilitiesById = new Map<string, Ability[]>();
    for (const rt of [...runtimesById.values(), ...enemyPlayerRuntimeByActorId.values()]) {
        if (outgoingAbilitiesById.has(rt.actor.id)) continue; // dedupe if an actor is in both maps
        const outgoing: Ability[] = [];
        for (const slot of rt.castSkills.slots) {
            if (slot.slot !== 'passive') continue;
            for (const a of slot.abilities) {
                if (a.config.type === 'outgoing-amplification') {
                    outgoing.push(a);
                }
            }
        }
        if (outgoing.length) outgoingAbilitiesById.set(rt.actor.id, outgoing);
    }
    const outgoingAbilitiesOf = (id: string): Ability[] => outgoingAbilitiesById.get(id) ?? [];

    // SP-F F5 (Meatshield, R4 refit-active passive — APPROXIMATION): per-actor set of ids
    // carrying an active `defense-substitution` passive, side-agnostic (a carrier can be on
    // either team — mirrors incomingAbilitiesById/outgoingAbilitiesById above). Built once from
    // BOTH runtime maps; empty for actors without the ability → substitutedDefenceFor below is a
    // no-op (byte-identical to every existing caller).
    const defenseSubstitutionCarrierIds = new Set<string>();
    for (const rt of [...runtimesById.values(), ...enemyPlayerRuntimeByActorId.values()]) {
        for (const slot of rt.castSkills.slots) {
            if (slot.slot !== 'passive') continue;
            if (slot.abilities.some((a) => a.config.type === 'defense-substitution')) {
                defenseSubstitutionCarrierIds.add(rt.actor.id);
                break;
            }
        }
    }
    // Wave 4 Task 8 (FrontLine, "While Shielded, it gains 2500 additional Defense"): per-actor
    // flat conditional-defence bonus, keyed by owner id -> flat bonus points. Side-agnostic, built
    // once from BOTH runtime maps, mirroring defenseSubstitutionCarrierIds. The GATE
    // (hasShield(ownerId)) is deliberately NOT checked here — it must be re-evaluated fresh on
    // every substitutedDefenceFor call (hasShield reads the LIVE shieldPool), so the bonus appears
    // the instant the owner holds a shield and reverts the instant it is consumed/expires. Empty
    // for actors without the ability → substitutedDefenceFor's added term is 0 for everyone else
    // (byte-identical to before this task).
    const conditionalDefenceBonusByActorId = new Map<string, number>();
    for (const rt of [...runtimesById.values(), ...enemyPlayerRuntimeByActorId.values()]) {
        for (const slot of rt.castSkills.slots) {
            if (slot.slot !== 'passive') continue;
            for (const a of slot.abilities) {
                if (
                    a.config.type === 'conditional-stat' &&
                    a.config.stat === 'defence' &&
                    a.config.condition === 'self-shield'
                ) {
                    conditionalDefenceBonusByActorId.set(rt.actor.id, a.config.flat);
                }
            }
        }
    }
    // Ships whose Protection is consumable (Lionheart R4: "all Protection is removed" after a
    // redirect). Scanned once from both runtime maps, slot-agnostic, mirroring hasAnyProtectionGrant.
    const clearProtectionOnRedirectIds = new Set<string>();
    for (const rt of [...runtimesById.values(), ...enemyPlayerRuntimeByActorId.values()]) {
        for (const slot of rt.castSkills.slots) {
            if (
                slot.abilities.some(
                    (a) =>
                        a.config.type === 'buff' &&
                        a.config.buffName === 'Protection' &&
                        a.config.clearAllOnRedirect === true
                )
            ) {
                clearProtectionOnRedirectIds.add(rt.actor.id);
                break;
            }
        }
    }
    // Board-level Protection gate: true iff ANY ability on the board grants Protection, OR any
    // actor carries a SCHEDULED Protection self-buff (SelectedGameBuff — the DPS/Healing
    // Calculator's manual "active buffs" input, e.g. protectionAccum in tests; independent of any
    // ability). `selfBuffLookup` (built above from `[...selfBuffs, ...teamActors.flatMap(t =>
    // t.selfBuffs)]`) already indexes every scheduled self-buff by name, so re-using it here is
    // the cheapest correct check for that source. A board-level boolean (not a per-actor carrier
    // Set) is deliberate — Protection can be stolen/transferred onto a ship that carries no grant
    // of its own (deferred mechanic), and the boolean only asserts "Protection is possible here,"
    // which is the gate protectorsFor needs. Scans ALL slots (not just passive, unlike
    // defenseSubstitutionCarrierIds) because Lionheart's round-start grant and a future
    // charge-slot steal are not passive-slot auras.
    const hasAnyProtectionGrant =
        (selfBuffLookup.get('Protection')?.length ?? 0) > 0 ||
        [...runtimesById.values(), ...enemyPlayerRuntimeByActorId.values()].some((rt) =>
            rt.castSkills.slots.some((slot) =>
                slot.abilities.some(
                    (a) => a.config.type === 'buff' && a.config.buffName === 'Protection'
                )
            )
        );
    // NOTE: neither `hasAnyProtectionGrant` nor `clearProtectionOnRedirectIds` scans
    // `reactiveAbilities` (partitioned out of `castSkills` above) — no ship grants Protection
    // reactively today. If one is added, both gates need a matching branch over the reactive list.
    // Protection damage transfer (deferred mechanic, now consumed). A protector is any living
    // ally that holds >=1 Protection stack; it intercepts a fraction of its allies' direct
    // damage. Side-agnostic by construction (resolves allies via bySide), mirroring
    // defenseSubstitutionCarrierIds. Fastest-first ordering drives the multi-protector cascade.
    const protectorsFor = (victim: CombatActor): { actor: CombatActor; stacks: number }[] => {
        if (!hasAnyProtectionGrant) return [];
        // Protection coverage = ALL living same-side allies (no self-cover), independent of
        // board adjacency. `adjacentAllyIdsFor` narrows to hex-neighbours in positional
        // encounters, which would wrongly shrink coverage — genuinely adjacency-scoped
        // mechanics (Lionheart's pre-combat HP gift, Centurion) keep using it; Protection
        // does not. Behavior-identical to before in non-positional production.
        const allyIds = [...allActorsById.values()]
            .filter((a) => a.side === victim.side && a.currentHp > 0 && a.id !== victim.id)
            .map((a) => a.id);
        const out: { actor: CombatActor; stacks: number }[] = [];
        for (const id of allyIds) {
            if (id === victim.id) continue;
            const actor = allActorsById.get(id);
            if (!actor || actor.currentHp <= 0) continue;
            // Aggregate across ALL status sources (scheduled snapshot + timed + aura/accum ability
            // statuses) — NOT snapshot().activeSelfBuffs alone, which misses aura-granted Protection
            // (real Meatshield / SP-G G1b) and any non-'attacker' owner (the Cheat-Death-detection
            // trap documented below at the Barrier/Cheat-Death read sites).
            const stacks = selfBuffStacksForOwner(statusEngine, id, 'Protection');
            if (stacks > 0) out.push({ actor, stacks });
        }
        out.sort((a, b) => {
            const sa = effectiveStatsOf(statusEngine, selfBuffLookup, a.actor).speed;
            const sb = effectiveStatsOf(statusEngine, selfBuffLookup, b.actor).speed;
            return sb - sa !== 0 ? sb - sa : a.actor.id.localeCompare(b.actor.id);
        });
        return out;
    };
    // "Any direct damage dealt to a non-defender ally that is not transferred by Protection is
    // dealt as if that ally had this Unit's defense." Protection-as-damage-transfer is now
    // IMPLEMENTED (see `protectorsFor` above + the transfer block in `applyVictimDamage`, which
    // peels `redirectFraction × P` off a hit BEFORE this substitution is applied) — so this
    // function only ever substitutes for the NON-TRANSFERRED remainder of a living non-defender
    // ally's damage; the transferred portion is a separate hit re-mitigated on the protector's own
    // defence via `protectionCascade`. Called from EVERY defence-read site (defenseProfileOf, the
    // reactive read, both victimDefenceFor bindings) so every attack type sees the same
    // mitigation — wiring it into only one path would silently diverge across attack types.
    // `fallback` is the site's OWN pre-substitution defence value (raw stats, buffed/effective, or
    // a last-turn-ctx read — whichever that site already computed), so a victim with no applicable
    // carrier is byte-identical to before this task. Multi-carrier tie-break (no known in-game dup
    // case): the HIGHEST effective defence among living, same-side carriers wins.
    const substitutedDefenceFor = (victim: CombatActor, fallback: number): number => {
        if (victim.currentHp <= 0) return fallback; // dead victims are never substituted
        // Wave 4 Task 8 (FrontLine): "While Shielded, it gains 2500 additional Defense" — an
        // ADDITIVE flat bonus on top of whatever defence value this victim would otherwise read
        // (the substitution below, or the site's own fallback), gated live on hasShield(victim.id)
        // so it is re-evaluated fresh on every hit and reverts the instant the shield is consumed
        // or expires. `hasShield` is declared later in this closure (below) but is already
        // initialized by the time this function is actually CALLED (deep in the battle loop) —
        // same closure-ordering convention as every other helper this function reads.
        const conditionalDefenceBonus = conditionalDefenceBonusByActorId.get(victim.id);
        const shieldDefenceBonus =
            conditionalDefenceBonus !== undefined && hasShield(victim.id)
                ? conditionalDefenceBonus
                : 0;
        // DEFENDER victims are never substituted (R4 text: "non-defender ally"). Substitution
        // requires PROVING the victim is a known non-defender role — an unknown/missing role
        // (no role data threaded for this actor) stays dormant (no substitution), matching the
        // codebase's established convention for this exact ambiguity: matchesRoleCategory(undefined,
        // ...) always returns false, so an unknown role can never satisfy "is a non-defender" here
        // either (mirrors Graphite's role-filtered reaction staying dormant on an unknown role —
        // see triggers.ts's forced-targeting/role-filter gates).
        const victimRole = roleByActorId.get(victim.id);
        if (!victimRole || matchesRoleCategory(victimRole, ['DEFENDER'])) {
            return fallback + shieldDefenceBonus;
        }
        let bestDefence: number | undefined;
        for (const carrierId of defenseSubstitutionCarrierIds) {
            if (carrierId === victim.id) continue; // a carrier never substitutes for itself
            const carrier = allActorsById.get(carrierId);
            if (!carrier || carrier.currentHp <= 0 || carrier.side !== victim.side) continue;
            const carrierDefence = effectiveStatsOf(statusEngine, selfBuffLookup, carrier).defence;
            if (bestDefence === undefined || carrierDefence > bestDefence) {
                bestDefence = carrierDefence;
            }
        }
        return (bestDefence ?? fallback) + shieldDefenceBonus;
    };

    // D-PR3: is this actor currently Stealthed? Sibling to isStasised — reads the actor's active
    // self-buff names (snapshot + timed + active ability statuses). 'Stealth' is the buff name the
    // positional targeting stealth-filter also queries (triggers.ts buildForcedTargetingStatus).
    const isStealthed = (actorId: string): boolean =>
        selfBuffNamesForOwners(statusEngine, [actorId]).includes('Stealth');

    // Epic PR12 (C): does the given actor currently carry a live Corrosion or Inferno DoT
    // stack? (Anemone — "takes 25% less direct damage from enemies debuffed with a Damage
    // over Time effect", evaluated against the ATTACKER of an incoming hit.) Sibling to
    // isStealthed/isStasised; reads the DoT containers directly off the CombatActor.
    const attackerHasDot = (actorId: string): boolean => {
        const a = allActorsById.get(actorId);
        return !!a && (a.corrosionEntries.length > 0 || a.infernoEntries.length > 0);
    };
    // Epic PR12 (C): does the given actor currently carry its own "Barrier Recharging"
    // self-status? (Panon — "reduces all incoming damage by 20% when affected by Barrier
    // Recharging.") Sibling to isStealthed — same selfBuffNamesForOwners lookup, different
    // literal name.
    const hasBarrierRecharging = (actorId: string): boolean =>
        selfBuffNamesForOwners(statusEngine, [actorId]).includes('Barrier Recharging');
    // Model-completeness epic (SP-A): does the given actor currently hold an active shield
    // pool? (Malvex — "When Shielded, this Ship takes 10% less damage.") Reads the live
    // absorption pool directly off the CombatActor, mirroring hasBarrierRecharging.
    const hasShield = (actorId: string): boolean =>
        (allActorsById.get(actorId)?.shieldPool ?? 0) > 0;
    // Epic PR12 (C): the given actor's own live HP% (0..100) at this instant, for
    // Tormenter's HP-proportional incoming-reduction scaling. Defaults 100 for an unresolvable
    // actor/zero max HP (inert — no reduction).
    const selfHpPctOf = (actorId: string): number => {
        const a = allActorsById.get(actorId);
        const maxHp = recipientMaxHp(actorId);
        if (!a || maxHp <= 0) return 100;
        return (100 * a.currentHp) / maxHp;
    };
    // SP-E (Orel): does the given actor (the ATTACKER of an incoming hit) currently carry Taunt
    // (a self-buff it granted itself) or Provoke (a debuff placed on it by someone else)? Sibling
    // to attackerHasDot — same "evaluated against the attacker" shape, different status family.
    // An empty/unresolvable actorId (e.g. a DoT-tick batch with no single attacker) resolves via
    // selfBuffNamesForOwners([]) → [] → false, and provokerOf on a nonexistent id → undefined →
    // false — both branches degrade safely to "not gated" without a separate guard.
    const attackerTauntedOrProvoked = (actorId: string): boolean =>
        selfBuffNamesForOwners(statusEngine, [actorId]).includes('Taunt') ||
        provokerOf(statusEngine, actorId) !== undefined;

    // Proc an owner's standing leeches against a damage credit (heals immediately at
    // credit time — a DoT-tick leech lands during the enemy turn, which is the correct
    // survival timing). Simplified drain-style fold (spec §4): healModifier only + a
    // deterministic heal-crit draw on the owner's activeHealCritGate at the RUNTIME's
    // standing crit/critDamage (base+gear stats — the per-turn folded effectiveCrit only
    // exists mid-turn). NO heal-performed emission (chain guard: leech procs never feed
    // on-ally-critically-repaired). Healing mode only; inert when no leeches registered.
    const procStandingLeeches = (sourceId: string, channel: LeechChannel, amount: number): void => {
        if (!healingCtx || amount <= 0) return;
        const entries = standingLeeches.get(sourceId);
        if (!entries) return;
        const owner = runtimesById.get(sourceId);
        if (!owner) return;
        for (const e of entries) {
            if (e.scope === 'detonation' && channel !== 'detonation') continue;
            let raw = amount * (e.pct / 100);
            if (e.kind === 'heal') {
                raw *= 1 + owner.healModifier / 100;
                if (!e.noCrit && owner.activeHealCritGate(owner.crit / 100)) {
                    raw *= 1 + owner.critDamage / 100;
                }
            }
            const recipients =
                e.target === 'ally'
                    ? [healTarget!.id]
                    : e.target === 'all-allies'
                      ? healingCtx.playerIds
                      : [sourceId];
            for (const rid of recipients) {
                if (e.kind === 'heal') {
                    healingCtx.credit(sourceId, 'directHeal', raw);
                    if (rid === healTarget!.id) {
                        const { consumed, overheal } = healingCtx.applyHealToTarget(raw);
                        healingCtx.credit(sourceId, 'effectiveHeal', consumed);
                        healingCtx.credit(sourceId, 'overheal', overheal);
                    }
                } else {
                    healingCtx.credit(sourceId, 'shield', raw);
                    if (rid === healTarget!.id) healingCtx.grantShieldToTarget(raw);
                }
            }
        }
    };

    // E2 Task 3: PER-VICTIM standing-leech proc for the POSITIONAL apply path.
    //
    // The non-positional `procStandingLeeches` above rides the aggregate `creditDamage(...
    // 'direct' ...)` write — but that write is SUPPRESSED for the positional case (the firing-hit
    // damage lands per-victim via applyPositionalDamage, so crediting it again would double-count).
    // So on the positional path NO standing leech fired before E2. This proc restores it by
    // running once per FOOTPRINT VICTIM (wired via drivePositionalApply's `onVictimResolved`),
    // leeching off THAT victim's already-role-scaled dealt damage — so origin victims contribute
    // full damage and covered victims contribute half automatically (the caller passes the
    // per-victim `damage`).
    //
    // It REUSES procStandingLeeches's fold math (pct → raw, healModifier, heal-crit draw) but does
    // its OWN pool application via the Task-1 parametrized closures (applyHealToTarget(raw, actor) /
    // grantShieldToTarget(raw, actor)), resolving each recipient's actor — so a covered enemy's
    // leech can repair the right ally, not just the heal target. procStandingLeeches is left
    // UNTOUCHED (its `rid === healTarget.id` pool-gating is load-bearing for the non-positional
    // all-allies case, leech.test.ts:355-404).
    //
    // RECIPIENT RESOLUTION: via `runtimesById` (NOT allActorsById) — the focus attacker is keyed
    // 'attacker', not its real id. `self` → the acting owner; `ally` → the heal target; `all-allies`
    // → every player id. A recipient with no resolvable runtime actor is credited but not
    // pool-applied (mirrors procStandingLeeches's effect for the all-allies non-target case).
    //
    // HEAL-CRIT-GATE CADENCE: this fires once per victim, so a heal-kind leech draws the owner's
    // `activeHealCritGate` ONCE PER VICTIM (an N-victim AoE makes N draws, in footprint order).
    // The perVictimLeech test pins the exact numbers.
    //
    // NO `dmg()`/cumulative accumulator write here (the per-victim apply already landed the HP
    // damage; the aggregate direct credit stays suppressed) → no double-count. Honors `scope`:
    // a detonation-scoped leech is skipped on the per-victim `direct` channel.
    const procStandingLeechesPerVictim = (sourceId: string, amount: number): void => {
        if (!healingCtx || amount <= 0) return;
        const entries = standingLeeches.get(sourceId);
        if (!entries) return;
        const owner = runtimesById.get(sourceId);
        if (!owner) return;
        for (const e of entries) {
            // Per-victim damage rides the `direct` channel only; detonation-scoped leeches
            // never fire here (bombs credit through the aggregate detonation path instead).
            if (e.scope === 'detonation') continue;
            let raw = amount * (e.pct / 100);
            if (e.kind === 'heal') {
                raw *= 1 + owner.healModifier / 100;
                // One heal-crit draw PER VICTIM (this proc runs per footprint victim).
                if (!e.noCrit && owner.activeHealCritGate(owner.crit / 100)) {
                    raw *= 1 + owner.critDamage / 100;
                }
            }
            const recipients =
                e.target === 'ally'
                    ? [healTarget!.id]
                    : e.target === 'all-allies'
                      ? healingCtx.playerIds
                      : [sourceId];
            for (const rid of recipients) {
                // Resolve the recipient's live actor for the pool application (Task-1 closures
                // take an explicit victim). runtimesById, not allActorsById: the focus is 'attacker'.
                const recipientActor = runtimesById.get(rid)?.actor;
                if (e.kind === 'heal') {
                    healingCtx.credit(sourceId, 'directHeal', raw);
                    if (recipientActor) {
                        const { consumed, overheal } = healingCtx.applyHealToTarget(
                            raw,
                            recipientActor
                        );
                        healingCtx.credit(sourceId, 'effectiveHeal', consumed);
                        healingCtx.credit(sourceId, 'overheal', overheal);
                    }
                } else {
                    healingCtx.credit(sourceId, 'shield', raw);
                    if (recipientActor) healingCtx.grantShieldToTarget(raw, recipientActor);
                }
            }
        }
    };

    // E2 Task 5: PER-VICTIM damage-TAKEN leech proc for the POSITIONAL enemy branch
    // (enemy→player). The non-positional consumption block (~:4025) credits ONLY the heal
    // target off the aggregate `damage`, gated by `!enemyPositional` — so on the positional
    // path NO taken leech fired before E2 (each player victim took only its OWN per-victim AoE
    // share, and the heal-target-only single-row credit would have been wrong). This proc
    // restores it by running once per FOOTPRINT VICTIM (wired via drivePositionalApply's
    // `onVictimResolved` at the enemy site), procing THAT victim's OWN taken-leeches
    // (takenLeechesByOwner.get(victim.id)) off the per-victim `damage` it took, applying to the
    // victim's OWN pool via the Task-1 closures.
    //
    // SEMANTICS — mirror the non-positional block (~:4025-4060) PER VICTIM:
    //   - Barrier carve-out: skip entirely if the victim was `barriered` (its hit was fully
    //     blocked — no damage taken, nothing to leech). Per victim via `outcome.barriered`.
    //   - requiresHpDamage (Quixilver): only fire an entry with requiresHpDamage when the hit
    //     dealt HP damage PAST shield — per victim via `outcome.shieldBefore > 0 &&
    //     outcome.hpDamage > 0`.
    //   - The leech is off `damage` (the FULL per-victim damage taken — already covered-cell
    //     reduced), NOT the HP portion — matching the non-positional `damage * (e.pct/100)`.
    //   - Same heal/shield fold (pct → raw, healModifier, heal-crit gate/noCrit) and the same
    //     directHeal/effectiveHeal/overheal vs shield bucket split, credited to the victim.
    //
    // HEAL-CRIT-GATE CADENCE: this fires once per victim, so a heal-kind leech draws the
    // victim's `activeHealCritGate` ONCE PER VICTIM (matching procStandingLeechesPerVictim).
    const procTakenLeechesPerVictim = (
        victim: CombatActor,
        damage: number,
        outcome: VictimDamageOutcome
    ): void => {
        if (!healingCtx || damage <= 0) return;
        // Barrier carve-out (per victim): a fully-blocked hit deals no damage taken.
        if (outcome.barriered) return;
        const entries = takenLeechesByOwner.get(victim.id);
        if (!entries) return;
        const rt = runtimesById.get(victim.id);
        for (const e of entries) {
            // requiresHpDamage gate (per victim): shield present at hit start AND HP damage dealt.
            if (e.requiresHpDamage && !(outcome.shieldBefore > 0 && outcome.hpDamage > 0)) {
                continue;
            }
            let raw = damage * (e.pct / 100);
            if (e.kind === 'heal' && rt) {
                raw *= 1 + rt.healModifier / 100;
                // One heal-crit draw PER VICTIM (this proc runs per footprint victim).
                if (!e.noCrit && rt.activeHealCritGate(rt.crit / 100)) {
                    raw *= 1 + rt.critDamage / 100;
                }
            }
            if (e.kind === 'heal') {
                healingCtx.credit(victim.id, 'directHeal', raw);
                const { consumed, overheal } = healingCtx.applyHealToTarget(raw, victim);
                healingCtx.credit(victim.id, 'effectiveHeal', consumed);
                healingCtx.credit(victim.id, 'overheal', overheal);
            } else {
                healingCtx.credit(victim.id, 'shield', raw);
                // H3.6: this engine standing-leech shield site intentionally does NOT emit
                // shield-applied — it is per-recipient (no shield-application CAST to key on) and
                // no H2/H3 source routes through it, so it is out of H3 scope. Emission lives only
                // in the cast path (playerTurn.ts) and the reactive executor (triggers.ts).
                healingCtx.grantShieldToTarget(raw, victim);
            }
        }
    };

    // C2b-2 T5: the id of the actor whose turn is CURRENTLY executing. Set once at the top of
    // each actor's turn (after the dead-actor skips, before any damage is applied), so the
    // DIRECT-damage wrappers can stamp the lethal attacker onto ship-destroyed (Faust reads it
    // in Task 6). NOT used by the DoT-tick batch path (no single killer → byDirectDamage:false).
    // Engine-scope (declared once) but rewritten every turn; the applyVictimDamage closures are
    // rebuilt per round and capture it by reference.
    let actingActorId: string | undefined;

    // Engine-scope mutable round tracker: updated at the top of each round so the
    // buildSideContext closures (defined once outside the loop) can stamp the correct
    // round onto charge-changed events without rebuilding their parent object each round.
    let currentRound = 0;

    for (let r = 1; r <= numRounds; r++) {
        // Advance the status engine's round counter (per-round accumulating stacks
        // tick here, before any turn fires). Sources notify via sourceFired in turn.
        currentRound = r;
        statusEngine.beginRound(r);
        // Clear the per-round repaired set HERE (not at the round-started emit) so start-of-round
        // reactive heals fired by that emit correctly count toward THIS round (C2b-3).
        repairedThisRound.clear();
        hitThisRound.clear();
        // SP-G G3 (CodeRabbit): reset the reactive dealt-amount slot each round so a
        // basis:'damage-dealt' shield can never read a stale value from a previous round if its
        // paired reactive-damage proc is gated out (differing procChance/oncePerRound/condition)
        // and applyReactiveDamage never runs — the fallback read then correctly resolves to 0.
        reactiveDealtByOwner.clear();
        // Reset per round so a start-of-round reactive drain (round 2+) stamps duringTurnOf
        // as turn-less (undefined) rather than the previous round's last acting actor.
        actingActorId = undefined;

        // Forced-targeting/stealth lookup for a roster (phase 3). Reads the status engine
        // for each actor's Concentrate Fire / Taunt / Stealth flags so resolvePositionalTarget
        // can redirect or stealth-filter. Identical to phase 2 when no such status is live.
        const statusLookupFor = (roster: CombatActor[]) => {
            const m = buildForcedTargetingStatus(
                statusEngine,
                roster.map((a) => a.id)
            );
            return (id: string) => m.get(id);
        };

        // Combat-start seeding (round 1) for PASSIVE-sourced finite (timed) self-statuses.
        // Player runtimes face the dummy enemy, so an `enemy-type` gate resolves against
        // `enemyType`. Enemy-attacker runtimes face the player heal target (which has no
        // EnemyBaseClass), so their `enemy-type` gate must resolve against undefined.
        if (r === 1) {
            seedPassiveTimedStatuses([...runtimesById.values()], statusEngine, bus, enemyType, r);
            seedPassiveTimedStatuses(enemyPlayerRuntimes, statusEngine, bus, undefined, r);
            // Epic PR4: one-time "at the start of combat" passive shields (Crucialis/FrontLine)
            // — seeded silently ONCE here, never on cast (the cast path skips pre-combat
            // abilities). Same both-collections call shape as the timed seeding above.
            seedPreCombatShields([...runtimesById.values()]);
            seedPreCombatShields(enemyPlayerRuntimes);
        }

        // Selection-based action pool (dynamic-speed turn order, Task 3). Each living actor
        // holds a count of PENDING actions for the round (seeded 1 each; an extra-action grant
        // pushes +1). Team actors listed BEFORE the attacker so the input-order tiebreak yields
        // team → attacker → enemy at equal speeds (selectNextBySpeed requirement — it feeds
        // orderByTurnPriority, whose final tiebreak is this input order). Enemy attackers
        // (healing mode) are appended after the dummy `enemy`; selection reads each actor's LIVE
        // effective speed every step, so a Speed Up/Down applied mid-round reorders the remaining
        // unacted actors automatically (no re-sort hook). Dead actors keep their seeded pending=1
        // — the death-skip below consumes it via a plain `continue` (identical to the old loop
        // visiting then continue-ing). The dummy `enemy` (no speed buffs) keeps its DoT-tick turn
        // in DPS/non-positional mode; a fully-positional sim drops it (dummyEnemyIsVestigial).
        const roundActors = turnOrderActors;
        const pending = new Map<string, number>(roundActors.map((a) => [a.id, 1]));
        const pendingOf = (id: string) => pending.get(id) ?? 0;

        // End-of-round action pool (Task 4): "1 extra end of round action" grants (Harvester)
        // land here instead of `pending`. The selection closure drains `pending` (speed-positioned)
        // FIRST and only consults this pool once the normal pool is empty — so end-of-round extra
        // turns fire AFTER every normal-pool action for the round, regardless of the granter's
        // speed-rank. Seeded empty each round (no actor starts with an end-of-round action).
        const endOfRoundPending = new Map<string, number>();
        const endOfRoundPendingOf = (id: string) => endOfRoundPending.get(id) ?? 0;

        // --- Round accumulator, shared by the turn blocks and the post-round assembly.
        // Declared fresh each round (like the old scalar locals). Each actor writes into
        // its own entry; the post-round assembly derives row fields from the focus entry.
        // The helper `dmg(id)` lazily creates entries on first write — actors that never
        // produce damage in a round simply have no entry, keeping the map sparse.
        //
        // E5 §4.5 — CREDIT vs INTAKE are COMPLEMENTARY, not redundant (closing the umbrella
        // spec's "collapse the dual paths" framing). This `roundDamage`/`creditDamage` path is
        // the CREDIT side: damage *dealt*, keyed by SOURCE id, feeding row totals + damage-dealt
        // leeches. The `perActorIncoming`/`intakeFor` path below (~2365) is the INTAKE side:
        // damage *taken*, keyed by VICTIM id, feeding healing-mode rows. They record different
        // facts about the same hit (who dealt it vs who took it); E5 does NOT merge them.
        const roundDamage = new Map<string, ActorDamage>();
        // Per-round per-victim positional damage accumulator (victim actor id → summed damage
        // dealt to it this round). Populated ONLY by the positional apply path's emitHit
        // callback (all three attack sites); stays EMPTY on non-positional rounds, so the
        // RoundData.perTargetDamage field is set only when non-empty → goldens byte-identical.
        const roundPerTargetDamage = new Map<string, number>();
        // SP-F F1: per-attacker×victim dealt attribution channel — attacker id → victim id →
        // damage dealt THIS round. Mirrors EVERY `roundPerTargetDamage.set` write above with an
        // equal-amount entry keyed to that increment's CORRECT source-attacker (not always
        // `actingActorId` — reflect's source is the reflector, counter's is the counter owner,
        // etc; see the per-site comments at each write). Σ over victims for one attacker ==
        // that attacker's `damageDealt`; Σ over attackers for one victim == `roundPerTargetDamage`
        // for that victim — so `damageDealt`/`damageTaken` reconcile BY CONSTRUCTION once every
        // site mirrors correctly. Stays EMPTY when roundPerTargetDamage is empty (non-positional
        // rounds), so RoundData.perTargetDealt is set only when non-empty → goldens byte-identical.
        const roundPerTargetDealt = new Map<string, Map<string, number>>();
        const creditDealt = (attackerId: string, victimId: string, amount: number): void => {
            let byVictim = roundPerTargetDealt.get(attackerId);
            if (!byVictim) {
                byVictim = new Map<string, number>();
                roundPerTargetDealt.set(attackerId, byVictim);
            }
            byVictim.set(victimId, (byVictim.get(victimId) ?? 0) + amount);
        };
        // D-PR3: per-victim direct-damage intake index (Ironclad nth-hit) + once-per-round block flags.
        const directIntakeIndex = new Map<string, number>();
        const blockOnceConsumed = new Set<string>(); // key `${victimId}:${abilityId}`
        const dmg = (id: string): ActorDamage => {
            let d = roundDamage.get(id);
            if (!d) {
                d = emptyActorDamage();
                roundDamage.set(id, d);
            }
            return d;
        };
        // Single damage-credit point: every channel write flows through here so standing
        // leeches (damage-leech spec) can proc at credit time. With no leeches registered
        // this is byte-identical to the bare dmg() writes (the goldens are the referee).
        const creditDamage = (sourceId: string, channel: LeechChannel, amount: number): void => {
            dmg(sourceId)[channel] += amount;
            procStandingLeeches(sourceId, channel, amount);
            input.__testTapCreditDamage?.(sourceId, channel, amount);
        };
        // Healing mode: rebind the per-round healing map (so `credit` writes into THIS round)
        // and snapshot the target's HP%/shield at the ROUND TOP — before any turn. Raw floats;
        // the adapter owns any rounding. No-op in DPS mode (currentRoundHealing stays unread).
        let targetHpPctStart = 0;
        let targetShieldStart = 0;
        // Per-round intake accounting (healing mode): per-actor incoming/shield/barrier buckets,
        // folded into this round's HealingRoundEngine entry at post-round assembly. Enemy attacker
        // turns add to these via the shield-first drain below (`sink` writes intakeFor()).
        // The heal target's row totals (incomingDamage/shieldAbsorbed/barrierAbsorbed) are read off
        // intakeFor(healTarget.id); barrierAbsorbed tracks the total fully blocked by an active
        // Barrier (full damage immunity), kept SEPARATE from shieldAbsorbed (Barrier does NOT drain
        // the shield pool) so the UI can attribute the blocked total to the Barrier, not the shield.
        // Fresh map each round; intakeFor() get-or-creates on first write.
        //
        // E5 §4.5 — this is the INTAKE side (damage *taken*, keyed by VICTIM id); the
        // complementary CREDIT side is `roundDamage`/`creditDamage` (~2331, damage *dealt*,
        // keyed by SOURCE id). Complementary facts, not duplicates — see the note there.
        const perActorIncoming = new Map<string, ActorIntake>();
        const intakeFor = (id: string): ActorIntake => {
            let entry = perActorIncoming.get(id);
            if (!entry) {
                entry = {
                    incoming: 0,
                    shieldAbsorbed: 0,
                    barrierAbsorbed: 0,
                    convertedToShield: 0,
                };
                perActorIncoming.set(id, entry);
            }
            return entry;
        };
        // Enemy-effects accounting (healing mode, Task 10a): per-enemy self-buffs + the debuffs
        // each enemy lands on the heal target this round, surfaced for the UI's enemy-effects
        // round overview ATTRIBUTED to the source enemy ship. Keyed by the enemy actor id; an
        // entry is created the first time an enemy contributes an effect this round. De-duped by
        // buffName WITHIN each enemy at the post-round push. Empty for a bare/manual enemy → no UI rows.
        const roundEnemyEffects = new Map<
            string,
            {
                selfBuffs: ActiveBuff[];
                debuffs: ActiveBuff[];
                resistedDebuffs: ActiveBuff[];
                resistedDots: EnemyDoTState[];
            }
        >();
        // Display snapshot of the heal target's DoT containers, captured BEFORE the
        // tank's turn-start tickDoTs/expireStacks run.  Merged with the live containers
        // via mergeDoTsForDisplay at end-of-round so that short DoTs (e.g. duration 1)
        // that ticked AND expired in the same round (enemy faster than tank) still appear
        // in enemyEffects[].dots.  Only the display shape is snapshotted (sourceId, tier,
        // stacks); numeric ticking uses the live containers unchanged.  Starts empty
        // every round — mergeDoTsForDisplay's fast-path (snapshot.length === 0) means
        // rounds where the tank never acts (DPS mode, destroyed tank) fall back to live
        // containers automatically, preserving pre-fix behaviour.
        let tankDotSnapshot: {
            corrosion: Pick<ActiveDoTStack, 'sourceId' | 'tier' | 'stacks'>[];
            inferno: Pick<ActiveDoTStack, 'sourceId' | 'tier' | 'stacks'>[];
        } = { corrosion: [], inferno: [] };
        // The heal target's OWN active self-buffs this round, captured from ITS turn result
        // (whichever branch processes it — focus, walked-team, or the dead-target synthesized
        // focus turn). PlayerTurnResult.activeSelfBuffs is comprehensive for the acting actor, so
        // it includes the target's recurring buffs (Cheat Death / Everliving Regeneration). Take
        // the LAST such turn if the target acts more than once; a destroyed target → []. Surfaced
        // to the UI's Heal Target round overview. NAMES ONLY — never folded into any sim value.
        let healTargetBuffs: ActiveBuff[] = [];
        // Shared incoming-damage intake (healing mode): drains the heal target shield-first
        // (pool before HP), reduces HP, records the destroyed round + emits ship-destroyed once,
        // and folds the totals into the victim's per-actor intake bucket (incoming / shieldAbsorbed
        // via the sink's intakeFor). Returns the
        // shield-before + the post-shield hpDamage the caller needs for any per-attack rider (the
        // taken-leech punch-through gate; hpDamage is 0 under Barrier so the leech reads 0). Both
        // the per-attack enemy intake (below) and the tank DoT-tick intake (turn-start) route
        // through here so the bleed accounting is identical.
        // `victim` defaults to the heal target — the legacy (non-positional) caller passes no
        // arg, so every existing path reads/mutates `healTarget!` exactly as before (byte-
        // identical). The positional enemy-turn path (Task C3) passes the SELECTED player actor
        // so the enemy's incoming drains the actor its parsed target picked. The heal target's
        // death round is read back off its per-actor `destroyedRound` field (stamped by
        // recordDestroyed below) at the result site — no heal-target-gated scalar write here.
        // Shared damage-intake core (Phase 4 PR 1, Task 2): the byte-identical body of the
        // legacy applyIncomingToTarget closure with the four side-specific accounting bits
        // hoisted into `sink`. Everything keyed off `victim` (Barrier full-immunity, shield
        // drain, HP decrement, Cheat-Death intercept, recordDestroyed, hp-changed) is moved
        // verbatim. Kept inside runCombat — it captures statusEngine/bus/r/recipientMaxHp/
        // cheatDeathConsumed/cheatDeathConsumedRound/recordDestroyed/BARRIER_BUFFS/
        // CHEAT_DEATH_BUFFS/selfBuffNamesForOwners exactly as before.
        //
        // Task 3 (combat-log) — deferred reflect log emit. Reflect thorns fire from INSIDE
        // applyVictimDamage. On the POSITIONAL path they run DURING drivePositionalApply, BEFORE
        // the attacker's aggregate `ability-performed` is emitted (emitDeferredAbilityPerformed,
        // post-apply). Emitting the reflect's LOG-ONLY `reactive-damage-performed` inline there
        // would nest it under whatever non-reactive entry already exists in the attacker's turn
        // (e.g. a self charge-gain / self-buff the attacker's active cast emitted BEFORE the
        // attack), not under the attack. So while `deferReflectLogs` is set (⟺ inside
        // drivePositionalApply) we BUFFER the reflect rows and flush them right AFTER
        // emitDeferredAbilityPerformed creates the attack entry, so routeReaction nests them under
        // it. On every NON-deferred path (legacy non-positional apply, where runPlayerTurn already
        // emitted `ability-performed` BEFORE the apply) the flag is false → inline emit, byte-
        // identical, and the attack entry already exists to nest under. NO combat listener
        // subscribes to `reactive-damage-performed` → it can never chain.
        let deferReflectLogs = false;
        const pendingReflectLogs: { sourceId: string; targetId: string; amount: number }[] = [];
        // Shared LOG-ONLY consequence-event buffer. Carries the log-only twins
        // `shield-destroyed-log` / `cheat-death-log` (NOT the real shield-destroyed /
        // cheat-death-activated events, which emit inline for their combat listeners). NO combat
        // listener subscribes to the twins, so buffering them cannot alter reaction timing.
        // Same defer-flush rationale as pendingReflectLogs above — twins emitted from INSIDE
        // applyVictimDamage during drivePositionalApply must wait until the attack entry exists
        // (post emitDeferredAbilityPerformed) so buildCombatLog's routeReaction nests them under
        // it instead of a preceding sibling entry in the attacker's turn.
        const pendingConsequenceLogs: CombatEvent[] = [];
        // Flush the log-only consequence twins buffered by an application. Split out of
        // flushReflectLogs so the REACTIVE-damage path can flush consequences alone (it buffers no
        // reflect rows), after its own attack row exists — see `deferConsequenceLogs`.
        const flushConsequenceLogs = (): void => {
            for (const ev of pendingConsequenceLogs) bus.emit(ev);
            pendingConsequenceLogs.length = 0;
        };
        // A reactive-damage proc (Insidiousness, counters) applies its hit and only THEN emits its
        // own `reactive-damage-performed` log row (triggers.ts emitReactiveDamageLog). Consequence
        // twins raised DURING that application — a Lifeline `shield-applied-log`, a
        // `shield-destroyed-log` — would therefore print ABOVE the attack that caused them, and
        // routeReaction would nest them under whatever entry preceded it. While this flag is set
        // they buffer instead; triggers.ts flushes them via `ctx.flushConsequenceLogs` immediately
        // after the attack row is emitted, so cause precedes consequence.
        let deferConsequenceLogs = false;
        const flushReflectLogs = (): void => {
            for (const row of pendingReflectLogs) {
                bus.emit({
                    type: 'reactive-damage-performed',
                    sourceId: row.sourceId,
                    targetId: row.targetId,
                    round: r,
                    amount: row.amount,
                    reactive: true,
                    duringTurnOf: actingActorId,
                    triggerActorId: actingActorId,
                });
            }
            pendingReflectLogs.length = 0;
            flushConsequenceLogs();
        };
        const applyVictimDamage = (
            rawDamage: number,
            victim: CombatActor,
            sink: DamageAccountingSink,
            // C2b-2 T5: optional kill attribution stamped onto ship-destroyed. Direct-damage
            // wrappers pass { killerId: actingActorId, byDirectDamage: true }; the DoT-tick batch
            // passes { byDirectDamage: false } (no single killer). No consumer reads these yet
            // (Faust, Task 6), so production stays byte-identical.
            cause?: {
                killerId?: string;
                byDirectDamage?: boolean;
                /** Acting attacker's effective shield penetration % (direct portion only). Default 0. */
                shieldPenetrationPct?: number;
                /** Portion of `rawDamage` that is bomb/detonation damage — drains shield in FULL, no pen. Default 0. */
                bombPortion?: number;
                /** True when THIS application is itself reflected thorns (Reflect gear set). The
                 *  reflection block skips when set → no ping-pong (a reflected hit never reflects). */
                isReflected?: boolean;
                /** G PR1: true when THIS application is a counterattack (Stalwart). The reflect
                 *  re-entry guard skips when set → a counter is never itself reflected (loop-safe). */
                isCounter?: boolean;
                /** Protection transfer: true when THIS application is a redirected Protection
                 *  chunk. The transfer block (Task 4) skips when set → a redirected chunk's own
                 *  cascade was already precomputed, so it never re-triggers (loop-safe). */
                isProtectionTransfer?: boolean;
                /** Epic PR12 (A): true when this victim IS the attacker's resolved anchor/primary
                 *  target (Nosorog's `requirePrimaryTarget` reflect gate). Undefined/true for every
                 *  non-positional (inherently single-target) call site; explicitly false only for
                 *  a covered/splash footprint victim. */
                isPrimaryTarget?: boolean;
            }
            // AppliedVictimDamage, not VictimDamageOutcome: this funnel always sets
            // `incomingBooked`, so the booking sites below read it without a fallback.
        ): AppliedVictimDamage => {
            // D-PR3: a hit may be reduced by proc block BEFORE it is recorded/absorbed. `damage`
            // becomes mutable so the block step can shave it; everything downstream (addIncoming,
            // shield drain, hp damage) operates on the post-block value.
            let damage = rawDamage;
            // Barrier — FULL DAMAGE IMMUNITY (locked game rule). Hoisted ABOVE addIncoming (it's a
            // pure read of the victim's active self-buffs — moving it earlier is byte-identical) so
            // the block step below can gate on it: a fully-Barrier-immune intake must NOT roll
            // block nor advance the Ironclad nth-hit counter (Barrier already nullifies the hit).
            // While the victim carries an active BARRIER_BUFFS status, ALL incoming damage is fully
            // blocked: direct attacks, DoT ticks, AND bomb detonations (all three funnel here).
            // Precedence: Barrier sits strictly IN FRONT OF both the shield pool AND Cheat Death —
            // so a lethal-sized hit blocked by Barrier neither drains the shield nor triggers the
            // Cheat-Death intercept below. Lifecycle is EITHER duration-based (the normal timed
            // lifecycle) OR hit-counted (the grant's `hits`, spent on a direct hit at the absorb
            // site below) — see barrierBuffs.ts. The damage still "arrives" (the victim's bucket
            // .incoming increments below) but its effect is nullified; the blocked amount is
            // tracked SEPARATELY as the bucket's .barrierAbsorbed (NOT .shieldAbsorbed — Barrier
            // never touches the shield).
            // Detection mirrors the Cheat-Death check (selfBuffNamesForOwners aggregates snapshot +
            // timed + active ability self statuses).
            const carriesBarrier = selfBuffNamesForOwners(statusEngine, [victim.id]).some((n) =>
                BARRIER_BUFFS.has(n)
            );
            // D-PR3: proc block on DIRECT damage only, when not fully Barrier-immune. Reduces the
            // hit before it is recorded/absorbed (silent reduction — no separate surface this PR).
            // Fully inert (no counter touch, no roll) when the victim has no incoming-block ability
            // → byte-identical for every existing fixture.
            if (cause?.byDirectDamage && !carriesBarrier) {
                const blockAbilities = incomingAbilitiesOf(victim.id).filter(
                    (a) => a.config.type === 'incoming-block'
                );
                if (blockAbilities.length > 0) {
                    const idx = (directIntakeIndex.get(victim.id) ?? 0) + 1;
                    directIntakeIndex.set(victim.id, idx);
                    const blocked = incomingBlockForIntake(
                        blockAbilities,
                        {
                            didCrit: false,
                            attackerStealthed: false,
                            victimStealthed: isStealthed(victim.id),
                            victimStasised: isStasised(victim.id),
                            hitIndexThisRound: idx,
                            attackerHasDot: attackerHasDot(cause?.killerId ?? ''),
                            victimHasBarrierRecharging: hasBarrierRecharging(victim.id),
                            victimHasShield: hasShield(victim.id),
                            selfHpPct: selfHpPctOf(victim.id),
                            attackerTauntedOrProvoked: attackerTauntedOrProvoked(
                                cause?.killerId ?? ''
                            ),
                        },
                        (abilityId, chance) => {
                            const cfg = blockAbilities.find((b) => b.id === abilityId)?.config;
                            const onceKey = `${victim.id}:${abilityId}`;
                            // INVARIANT (keep this order): consumed-check BEFORE drawing the gate,
                            // and set consumed ONLY on a successful proc — else a failed early draw
                            // would wrongly lock the round.
                            if (
                                cfg?.type === 'incoming-block' &&
                                cfg.oncePerRound &&
                                blockOnceConsumed.has(onceKey)
                            ) {
                                return false;
                            }
                            let gate = procChanceGates.get(onceKey);
                            if (!gate) {
                                // Keyed by the blocking victim's own id + purpose (SP-0 Task 3) —
                                // `victim.id` is the stable owner of this incoming-block ability.
                                gate = makeRateGate(`${victim.id}:proc`);
                                procChanceGates.set(onceKey, gate);
                            }
                            const proc = gate(chance);
                            if (proc && cfg?.type === 'incoming-block' && cfg.oncePerRound) {
                                blockOnceConsumed.add(onceKey);
                            }
                            return proc;
                        }
                    );
                    damage = damage * (1 - blocked);
                }
            }
            // Protection damage transfer. A living ally holding Protection stacks intercepts a
            // fraction (10%/stack) of this victim's direct hit. The redirected chunk keeps the
            // ORIGINAL target's affinity/outgoing (both baked into `damage`) and re-mitigates on
            // the PROTECTOR's own defense — realized by the mit-ratio inside protectionCascade.
            // Guards mirror the reflect block: direct damage only, and never a redirected/
            // reflected/counter application (loop-safe).
            // !carriesBarrier: Barrier sits strictly in front of every incoming-effect mechanism
            // (matches the incoming-block step and the transform step) — an invulnerable target
            // has no incoming hit for allies to soak.
            if (
                cause?.byDirectDamage &&
                !carriesBarrier &&
                !cause.isProtectionTransfer &&
                !cause.isReflected &&
                !cause.isCounter &&
                damage > 0
            ) {
                const protectors = protectorsFor(victim);
                if (protectors.length > 0) {
                    // `damage` was already mitigated by whatever defence the caller used at its
                    // read site — for a defense-substitution victim (Meatshield R4), that's the
                    // CARRIER's substituted defence, not the victim's own. Recomputing `targetMit`
                    // must use that same substituted value or the recovered pre-defence `P` (and
                    // therefore every protector chunk) is skewed. `substitutedDefenceFor` is a
                    // no-op fallback to `victimDef` when no carrier applies, so this is
                    // byte-identical to before for every non-substitution case.
                    const victimDef = effectiveStatsOf(
                        statusEngine,
                        selfBuffLookup,
                        victim
                    ).defence;
                    const targetDef = substitutedDefenceFor(victim, victimDef);
                    const targetMit =
                        targetDef > 0 ? 1 - calculateDamageReduction(targetDef) / 100 : 1;
                    const cascade = protectionCascade(
                        damage,
                        targetMit,
                        protectors.map((p) => ({
                            stacks: p.stacks,
                            mit:
                                effectiveStatsOf(statusEngine, selfBuffLookup, p.actor).defence > 0
                                    ? 1 -
                                      calculateDamageReduction(
                                          effectiveStatsOf(statusEngine, selfBuffLookup, p.actor)
                                              .defence
                                      ) /
                                          100
                                    : 1,
                        }))
                    );
                    // Redirect each protector's chunk BEFORE the victim's own HP is touched.
                    protectors.forEach((p, i) => {
                        const chunk = cascade.chunks[i];
                        if (!chunk || chunk.total <= 0) return;
                        // Apply as `stacks` equal sub-hits (matches the in-game per-stack procs and
                        // sets up the deferred DoT-transform, which acts per redirected chunk).
                        // SP-U U1: `sink` serves both sides (ids are globally unique), so no
                        // per-side selection is needed here.
                        let intakeTotal = 0;
                        for (let s = 0; s < chunk.stacks; s++) {
                            const outcome = applyVictimDamage(chunk.perStack, p.actor, sink, {
                                killerId: cause.killerId,
                                byDirectDamage: true,
                                isProtectionTransfer: true,
                                shieldPenetrationPct: 0,
                                bombPortion: 0,
                            });
                            intakeTotal += outcome.incomingBooked;
                        }
                        // We sum the intake the funnel RECORDED per sub-hit (`incomingBooked`) rather
                        // than `chunk.total − transformedToDot` — that subtraction wrongly counts a
                        // portion blocked by the protector's own incoming-block ability as damage
                        // taken, when in fact it was neither taken nor transformed. Meatshield's
                        // DoT-transform passive DEFERS the transformed portion to a self-DoT ticked
                        // over the next N rounds (the generic-DoT path books its own
                        // roundPerTargetDamage + .incoming per tick); only the remainder is
                        // credited/logged this round. For a protector without a block/transform
                        // ability, `incomingBooked === chunk.perStack` for every sub-hit, so
                        // `intakeTotal === chunk.total`.
                        //
                        // Was `immediateDamage`, which agrees on both of those but ALSO zeroes a
                        // Barrier-nullified chunk — dropping it from both display channels while the
                        // protector's `barrierAbsorbed` card still showed it, and suppressing the
                        // emission below so nothing in the log explained where that absorption came
                        // from. `.incoming` keeps a barriered amount (netted out downstream against
                        // `barrierAbsorbed`), which is what a DIRECTLY barriered hit books, so this
                        // now matches it.
                        //
                        // In the fully-transformed case a sub-epsilon float sliver can leave
                        // `intakeTotal` at ±~1e-10; the 1e-9 threshold suppresses that phantom
                        // near-zero emission (a real chunk is always >> 1e-9, so this never affects a
                        // genuine remainder).
                        if (intakeTotal > 1e-9) {
                            roundPerTargetDamage.set(
                                p.actor.id,
                                (roundPerTargetDamage.get(p.actor.id) ?? 0) + intakeTotal
                            );
                            // SP-F F1: this redirected chunk's real source-attacker is the
                            // ORIGINAL hit's killer (cause.killerId), not the protector — the log
                            // sourceId below (victim.id, the protecting wearer) is a DIFFERENT,
                            // reactive-log-only concept (see the audit note §1 row 1). killerId is
                            // absent when the redirected hit originated from a DoT-tick batch (no
                            // single attacker) — nothing to attribute there, so skip silently
                            // (the victim-keyed roundPerTargetDamage write above is unaffected).
                            if (cause.killerId) {
                                creditDealt(cause.killerId, p.actor.id, intakeTotal);
                            }
                            bus.emit({
                                type: 'reactive-damage-performed',
                                sourceId: victim.id,
                                targetId: p.actor.id,
                                round: r,
                                amount: intakeTotal,
                                reactive: true,
                                duringTurnOf: actingActorId,
                                triggerActorId: actingActorId,
                            });
                        }
                    });
                    // Lionheart R4: a consumable protector loses ALL Protection after it
                    // redirects a hit. The cascade was precomputed from pre-hit stacks, so THIS
                    // hit already redirected fully; clearing now only affects later hits this
                    // round. `removeSelfBuffByName` zeroes the accumulating stacks (Overload
                    // precedent) → next round's beginRound re-accumulates to maxStacks (=10).
                    // Gate on the protector's OWN chunk having actually redirected something —
                    // a faster protector upstream in the cascade can absorb the hit fully,
                    // leaving THIS protector's chunk at 0 even though it holds Protection stacks;
                    // the kit text ("after taking damage redirected through Protection") only
                    // fires the clear when a redirected chunk was actually taken.
                    protectors.forEach((p, i) => {
                        const chunk = cascade.chunks[i];
                        if (!chunk || chunk.total <= 0) return;
                        if (clearProtectionOnRedirectIds.has(p.actor.id)) {
                            statusEngine.removeSelfBuffByName(p.actor.id, 'Protection');
                        }
                    });
                    // The victim now only takes the non-transferred remainder.
                    damage = cascade.targetRemainder;
                }
            }
            sink.addIncoming(damage, victim.id);
            // The intake just recorded — post incoming-block, post Protection redirect. Returned as
            // `incomingBooked` (minus any transform reversal below) so every caller that books a
            // per-victim display amount can book the number the funnel actually recorded instead of
            // re-deriving it from the hit it passed in. Captured HERE rather than read back off the
            // sink because the sink is write-only from this side and a nested apply (a redirected
            // Protection chunk, whose recipient is a DIFFERENT actor) may have written to it
            // already.
            const incomingRecorded = damage;
            // SP-E: amount of THIS hit converted into a DoT (Voron/Orel). Reported in the returned
            // outcome so the caller excludes it from the per-victim damage-taken credit.
            let transformedToDot = 0;
            // SP-E: Voron/Orel — "when directly damaged, transforms the damage into a Damage over
            // Time effect lasting N turns". DIRECT INTAKE ONLY (byDirectDamage) — a DoT tick never
            // re-transforms (no recursive conversion). Never fires when Barrier is already
            // nullifying the hit — same precedence the incoming-block step above enforces via its
            // own `!carriesBarrier` guard (Barrier sits strictly in front of every other incoming-
            // effect mechanism; a Barrier-immune hit deals no real damage, so there is nothing to
            // convert). On a match, the FULL post-block direct amount is REPLACED — never drains
            // shield/HP this turn — by a generic self-DoT of `damage / turns` per round for
            // `turns` rounds, credited to the victim itself (sourceId: victim.id, ticked by the
            // existing generic-DoT path both turn-start tick sites already read). Fully inert (no
            // lookup beyond the empty-array default) for every actor without a
            // 'transform-incoming-to-dot' ability → byte-identical for every existing fixture.
            if (cause?.byDirectDamage && !carriesBarrier && damage > 0) {
                const attackerId = cause?.killerId ?? '';
                const transformAbilities = incomingAbilitiesOf(victim.id).filter(
                    (a) => a.config.type === 'transform-incoming-to-dot'
                );
                if (transformAbilities.length > 0) {
                    const hitCtx: IncomingHitContext = {
                        // didCrit is irrelevant to both Voron ('always') and Orel
                        // ('attacker-taunted-or-provoke') — no crit-gated transform exists in the
                        // corpus, so this mirrors the block step's own unconditioned `false`.
                        didCrit: false,
                        attackerStealthed: isStealthed(attackerId),
                        victimStealthed: isStealthed(victim.id),
                        victimStasised: isStasised(victim.id),
                        hitIndexThisRound: 0, // unused by this condition family
                        attackerHasDot: attackerHasDot(attackerId),
                        victimHasBarrierRecharging: hasBarrierRecharging(victim.id),
                        victimHasShield: hasShield(victim.id),
                        selfHpPct: selfHpPctOf(victim.id),
                        attackerTauntedOrProvoked: attackerTauntedOrProvoked(attackerId),
                        // Meatshield: this hit is a Protection-redirected chunk when the caller
                        // stamped isProtectionTransfer (the per-protector applyVictimDamage below).
                        viaProtectionRedirect: cause?.isProtectionTransfer ?? false,
                    };
                    const transform = transformAbilities.find(
                        (a) =>
                            a.config.type === 'transform-incoming-to-dot' &&
                            conditionMet(a.config.condition, hitCtx)
                    );
                    if (transform && transform.config.type === 'transform-incoming-to-dot') {
                        // The direct hit is REPLACED by the DoT — no shield/HP drain this turn.
                        // convertHitToSelfDot owns the deferral accounting the Hit Mitigation step
                        // below shares; keeping it in one place is what stops the two from drifting.
                        transformedToDot = convertHitToSelfDot(
                            victim,
                            sink,
                            damage,
                            transform.config.turns
                        );
                        // Only zero `damage` on a REAL conversion (see convertHitToSelfDot's
                        // CALLER CONTRACT). `turns` is parser-derived; `detectTransformToDot`
                        // already rejects a non-positive parse so no real ability reaches here
                        // with turns <= 0, but if one ever did, the helper's own guard returns 0
                        // and the hit must fall through to resolve normally rather than vanish.
                        if (transformedToDot > 0) {
                            damage = 0;
                        }
                    }
                }
            }
            // Hit Mitigation ("Blocks the next direct hit, transforming the damage receieved into
            // dot dealt over 3 rounds.", Oleander → all allies) — a NAME-KEYED one-shot sibling of
            // the ability-based transform above. Name-keyed rather than a `parsedEffects` channel
            // because a one-shot block has no honest standing value; see hitMitigation.ts.
            //
            // It repeats the transform step's own three guards for the same reasons:
            //  - `byDirectDamage`: the text says "direct hit", and a DoT tick must never be
            //    re-converted into another DoT (no recursive conversion).
            //  - `!carriesBarrier`: Barrier sits strictly in front of every other incoming-effect
            //    mechanism — a nullified hit deals no real damage, so there is nothing to block and
            //    spending the status on it would waste it.
            //  - `damage > 0`: nothing to convert, so nothing to consume.
            // Plus two of its own, both there because the status is a CONSUMABLE and the sibling
            // step is a free standing passive:
            //  - `bombPortion === 0`: "direct hit" means what the rest of this funnel means by it —
            //    `byDirectDamage === true && bombPortion === 0` (the threshold-shield check's
            //    `isDirect`, and Exposed's own consumption guard). A pure detonation reaches here
            //    stamped `byDirectDamage: true` with the whole amount in `bombPortion`, and burning
            //    a one-shot block on a bomb burst would leave the next real hit unblocked.
            //  - `transformedToDot === 0`: if the Voron/Orel transform already fired it consumed
            //    this hit, and a hit can only be blocked once — the status must survive for a later
            //    one.
            // All five together enforce the Exposed invariant: consume ONLY on a hit that actually
            // READ the block.
            //
            // The `bombPortion === 0` clause is why the two steps now DISAGREE about a bomb burst:
            // the sibling above still converts one. That asymmetry is not an oversight in either
            // step — for a free standing passive there is no consumable to waste, so whether a burst
            // should convert is a pure damage-magnitude question about that passive's own text, and
            // it is on the backlog. Answering it there must not drag this clause with it: a burst
            // must never SPEND the one-shot regardless of how that question lands.
            //
            // MIXED DIRECT + BOMB HIT: a single apply can carry `byDirectDamage: true` with
            // `0 < bombPortion < damage` — a cast that both lands a direct hit and detonates a bomb
            // in the same apply (see the MIXED DIRECT + DETONATE HIT note on the reflect guard
            // below, and the enemy non-positional apply site's `bombPortion: enemyDetonationDamage`).
            // `bombPortion === 0` is false for this case, so this guard skips entirely: the block is
            // NOT consumed (correct — reading `damage` here would spend it on a hit this funnel does
            // not treat as purely direct) but it also does NOT blunt the direct slice — the full
            // mixed `damage` (direct + bomb) lands for real. This is a deliberate, conservative
            // consequence of reusing the funnel's own `isDirect` definition rather than attempting to
            // block just the direct fraction of a mixed hit, and it is consistent with the
            // "consume only on a hit that actually READ the block" invariant above.
            //
            // Deliberately NOT excluded, unlike Exposed's consumption guard further down this
            // funnel, which drops reflected / countered / Protection-transferred hits explicitly:
            // those three genuinely DO read this block. They are real incoming direct damage on this
            // victim and the text is "blocks the next direct hit", so a reflect bouncing back onto
            // the wearer, a counterattack, or a redirected Protection chunk all deserve to be
            // blocked. Exposed excludes them for a reason that does not apply here — none of the
            // three folds the per-victim INCOMING-AMPLIFICATION channel Exposed rides, so spending
            // Exposed on one would charge for an amplification it never received. The difference
            // between the two guards is therefore intentional, not an omission.
            //
            // Hoisted here (single call, shared with the Barrier/Lifeline code below — MINOR 3 of
            // the Shield Converter review): both the Shield Converter branch's cap and the
            // post-transform `maxHp` used further down need the SAME value, and this is the
            // earliest point in the funnel where it is needed.
            const maxHp = recipientMaxHp(victim.id);
            // Set only when the Shield Converter branch below actually fires — the PRE-deposit
            // pool, so the returned `shieldBefore` (shieldWasHit detection at :6406-6411/:8592-8597) reflects
            // the state this hit FOUND, not what its own nullify-and-deposit just grew (IMPORTANT 1
            // of the Shield Converter review). `undefined` for every other hit, meaning "no override
            // — use the real `shieldBefore` captured below".
            let shieldPoolBeforeConversion: number | undefined;
            if (
                cause?.byDirectDamage === true &&
                (cause.bombPortion ?? 0) === 0 &&
                !carriesBarrier &&
                damage > 0 &&
                transformedToDot === 0 &&
                holdsHitMitigation(statusEngine, victim.id)
            ) {
                // Identical deferral accounting to the ability transform above, by construction —
                // see convertHitToSelfDot.
                transformedToDot = convertHitToSelfDot(
                    victim,
                    sink,
                    damage,
                    HIT_MITIGATION_DOT_ROUNDS
                );
                damage = 0;
                consumeHitMitigation(statusEngine, victim.id);
            } else if (
                cause?.byDirectDamage === true &&
                (cause.bombPortion ?? 0) === 0 &&
                !carriesBarrier &&
                damage > 0 &&
                transformedToDot === 0 &&
                holdsShieldConverter(statusEngine, victim.id)
            ) {
                // `Shield Converter` — nullify this direct hit and turn it into Shield.
                //
                // Chained as `else if` onto the Hit Mitigation step above, which is what makes the
                // ordering rule true: ONE HIT SPENDS EXACTLY ONE BLOCK. A victim holding both keeps
                // this one armed for the next hit. The guard is otherwise IDENTICAL to that step's,
                // deliberately - same definition of a direct hit (`byDirectDamage && bombPortion
                // === 0`), same Barrier exclusion, same already-transformed exclusion.
                //
                // ACCOUNTING: `.incoming` is NOT reversed. Hit Mitigation reverses via
                // addIncoming(-damage) only because its damage is DEFERRED and re-books on each DoT
                // tick; a converted hit re-books nowhere, so reversing here would erase the
                // attacker's damage-dealt credit for a hit that genuinely landed. This follows
                // Barrier instead (#293: "Barrier changes the EFFECT, not the accounting"), which
                // keeps the #293 identity holding by construction.
                const nullified = damage;
                const poolBeforeConversion = victim.shieldPool;
                shieldPoolBeforeConversion = poolBeforeConversion;
                // Never SHRINK the pool (MINOR 4 of the review): if a max-HP buff lapsed after an
                // earlier grant, `victim.shieldPool` can already sit above `maxHp` — the same
                // reachable state `grantShieldToTarget` (:2918-2921) documents. `Math.min(pool +
                // nullified, cap)` alone would clamp DOWN to `cap` in that state, destroying shield
                // the victim already held while still crediting the attacker in full via
                // `addConvertedToShield` below. `Math.max(before, …)` floors the result at the
                // pre-deposit pool so a converted hit can only grow the pool, matching Lifeline's
                // own guard at :4346-4348.
                victim.shieldPool = Math.max(
                    poolBeforeConversion,
                    Math.min(poolBeforeConversion + nullified, maxHp)
                );
                // Book the FULL nullified amount regardless of clamping — this channel explains the
                // missing HP damage, not the shield delta (constraint carried over from #293).
                sink.addConvertedToShield(nullified, victim.id);
                damage = 0;
                consumeShieldConverter(statusEngine, victim.id);
                // Third shield source (IMPORTANT 2 of the review, a recurrence of the #277 defect
                // class): credit the REAL post-cap pool growth to the granted accumulator and emit
                // the LOG-ONLY twin, exactly like Lifeline's mid-hit grant below — otherwise
                // `RoundData.perActorShield[id].granted` under-reports, the log shows an unexplained
                // pool jump, and a later hit draining this pool fires `shield-destroyed`/
                // `shield-destroyed-log` reading as "a shield was destroyed that was never granted".
                // Attributed to the VICTIM ITSELF: the attacker did not grant this shield, the
                // victim's own status did — the same self-attribution `convertHitToSelfDot` uses for
                // its converted DoT (`sourceId: victim.id`).
                const grantedFromConversion = victim.shieldPool - poolBeforeConversion;
                if (grantedFromConversion > 0) {
                    perActorShieldGranted.set(
                        victim.id,
                        (perActorShieldGranted.get(victim.id) ?? 0) + grantedFromConversion
                    );
                    const shieldConverterGrantLogEv: CombatEvent = {
                        type: 'shield-applied-log',
                        victimId: victim.id,
                        amount: grantedFromConversion,
                        round: r,
                        reactive: true,
                        duringTurnOf: actingActorId,
                        triggerActorId: actingActorId,
                    };
                    if (deferReflectLogs || deferConsequenceLogs)
                        pendingConsequenceLogs.push(shieldConverterGrantLogEv);
                    else bus.emit(shieldConverterGrantLogEv);
                }
            }
            // The post-block, non-transformed instant portion of this hit — captured HERE, right
            // after the transform step resolves (transform zeroes `damage` on a match) and BEFORE
            // any shield/HP drain below. For a normal hit (no block/transform/Barrier) this equals
            // the input `damage` argument byte-for-byte; the incoming-block step above is the only
            // thing that can have reduced it by this point. The Protection transfer block sums this
            // per protector sub-hit instead of `chunk.total − transformedToDot`, so a blocked
            // portion is correctly excluded from the instant-damage credit. The Barrier early-return
            // below overrides this to 0 (Barrier nullifies — nothing lands, instant or otherwise).
            const immediateDamage = damage;
            // Capture the pre-drain HP + the target's current effective max HP for the
            // tank-side hp-changed emission below (Phase 4c PR 3). Read BEFORE the drain
            // so oldPct reflects the entering state and a Cheat-Death save's oldPct stays
            // the pre-hit value (not 1).
            const hpBefore = victim.currentHp;
            // `maxHp` is hoisted above the Hit Mitigation / Shield Converter chain (MINOR 3 of the
            // Shield Converter review) — no re-fetch needed here.
            // Barrier branch (carriesBarrier computed above the block step). HP does not move → the
            // emit below is a no-op crossing (oldPct === newPct), still fired once for emission
            // consistency. The damage still "arrives" (the victim's .incoming already incremented)
            // but its effect is nullified; the blocked amount is tracked as .barrierAbsorbed (NOT
            // .shieldAbsorbed — Barrier never touches the shield).
            if (carriesBarrier) {
                sink.addBarrierAbsorbed(damage, victim.id);
                // Hit-counted Barrier: this absorb spends one charge. "for 1 hit" means a DIRECT
                // hit, and the guard spells that out exactly as the funnel's other two consumables
                // do (Hit Mitigation :4271-4272, Shield Converter :4289-4290):
                //  - `byDirectDamage`: a DoT tick is not a hit.
                //  - `bombPortion === 0`: a pure detonation arrives stamped `byDirectDamage: true`
                //    with the whole amount in `bombPortion`, and bomb-death-splash loops once PER
                //    BOMB — burning charges on a burst would leave the next real hit unblocked.
                //    A MIXED direct+bomb apply (0 < bombPortion < damage) also skips: it is not a
                //    hit by this funnel's own definition, so it must not spend either.
                //  - `damage > 0`: a zero-amount intake read nothing, so there is nothing to spend
                //    the charge on.
                // Every case still gets FULL immunity — the guard only decides whether the charge
                // is spent. No-op (returns false) for a turn-duration Barrier, so every existing
                // fixture is byte-identical.
                if (
                    cause?.byDirectDamage === true &&
                    (cause.bombPortion ?? 0) === 0 &&
                    damage > 0
                ) {
                    for (const name of BARRIER_BUFFS) {
                        // True ONLY when the last charge went and the status was removed — the
                        // turn-expiry path (decrementPlayer/decrementEnemy, :8886/:8898) emits the
                        // same event with the same fields, so a hit-consumed Barrier disappears
                        // from the combat log and the round status panel the same way a
                        // turn-expired one does instead of vanishing silently.
                        if (statusEngine.consumeStatusHit(victim.id, name))
                            bus.emit({
                                type: 'buff-expired',
                                actorId: victim.id,
                                round: r,
                                buffName: name,
                            });
                    }
                }
                if (victim.currentHp > 0 && maxHp > 0) {
                    bus.emit({
                        type: 'hp-changed',
                        targetId: victim.id,
                        round: r,
                        oldPct: (100 * hpBefore) / maxHp,
                        newPct: (100 * victim.currentHp) / maxHp,
                    });
                }
                return {
                    shieldBefore: victim.shieldPool,
                    hpDamage: 0,
                    barriered: true,
                    converted: false,
                    // Barrier nullifies the hit's EFFECT but does not un-record it: `.incoming` holds
                    // the amount and an equal `.barrierAbsorbed` nets it back out downstream. So the
                    // display channels book it, exactly as they do for any other barriered hit —
                    // unlike `immediateDamage`, which is 0 here (nothing landed).
                    incomingBooked: incomingRecorded,
                };
            }
            const shieldBefore = victim.shieldPool;
            // Lifeline (incoming-shield-grant): a PRE-hit threshold shield. When a PURE direct hit
            // (no DoT, no bomb portion) would cross this victim's HP below the configured % of max HP,
            // grant flat + %-of-attack to the pool BEFORE absorbing, so the rest of THIS hit drains
            // shield→HP per the H1 pen rules (the unit can still die). Once per battle. Fully inert
            // (no provisional absorb, no helper call) when the victim carries no such ability →
            // byte-identical for every existing fixture.
            const thresholdShieldAbilities = incomingAbilitiesOf(victim.id).filter(
                (a) => a.config.type === 'incoming-shield-grant'
            );
            if (thresholdShieldAbilities.length > 0) {
                // Provisional absorb against the CURRENT pool → the HP damage the hit would deal pre-Lifeline.
                const provisional = shieldAbsorb({
                    damage,
                    shieldPool: victim.shieldPool,
                    isDot: cause?.byDirectDamage === false,
                    penPct: cause?.shieldPenetrationPct ?? 0,
                    bombPortion: cause?.bombPortion ?? 0,
                });
                const grant = thresholdShieldForHit({
                    abilities: thresholdShieldAbilities,
                    currentHp: victim.currentHp,
                    maxHp,
                    provisionalHpDamage: provisional.hpDamage,
                    effectiveAttack: effectiveStatsOf(statusEngine, selfBuffLookup, victim).attack,
                    isDirect: cause?.byDirectDamage === true && (cause?.bombPortion ?? 0) === 0,
                    alreadyFired: (abilityId) =>
                        thresholdShieldFired.has(`${victim.id}:${abilityId}`),
                });
                if (grant) {
                    // Only ever ADD shield — never shrink a pre-hit pool that already
                    // sits above the current effective max HP (e.g. an HP-down debuff
                    // lowered maxHp after the pool was granted). Clamping the sum alone
                    // would make `granted` negative and could turn a survivable hit lethal.
                    const newPool =
                        shieldBefore >= maxHp
                            ? shieldBefore
                            : Math.min(maxHp, shieldBefore + grant.grant);
                    const granted = Math.max(0, newPool - shieldBefore);
                    victim.shieldPool = newPool;
                    thresholdShieldFired.add(`${victim.id}:${grant.abilityId}`);
                    // Surface the real pool growth on the H1 granted accumulator (StatCard).
                    perActorShieldGranted.set(
                        victim.id,
                        (perActorShieldGranted.get(victim.id) ?? 0) + granted
                    );
                    // LOG-ONLY twin (see the event's doc): this used to be the only shield source
                    // that lands here rather than in a cast / the reactive executor — Shield
                    // Converter above is the second, self-granting the same way for the same
                    // reason — so without it the pool grew with NO log line — while the
                    // `shield-destroyed` emit just below still fired for it, reading as "a shield
                    // was destroyed that was never granted". NOT the real `shield-applied` (that
                    // would fire on-shield-applied listeners from a mid-hit grant).
                    // Buffered/inline on exactly the same condition as `shield-destroyed-log` so it
                    // nests under the triggering attack.
                    if (granted > 0) {
                        const grantLogEv: CombatEvent = {
                            type: 'shield-applied-log',
                            victimId: victim.id,
                            amount: granted,
                            round: r,
                            reactive: true,
                            duringTurnOf: actingActorId,
                            triggerActorId: actingActorId,
                        };
                        if (deferReflectLogs || deferConsequenceLogs)
                            pendingConsequenceLogs.push(grantLogEv);
                        else bus.emit(grantLogEv);
                    }
                }
            }
            // SP-F F2 (AEGIS): the pre-absorb pool for the shield-destroyed emit below — read
            // AFTER the Lifeline threshold-shield grant above (NOT the earlier `shieldBefore`,
            // which is deliberately the PRE-Lifeline value other callers rely on) so a shield
            // freshly granted mid-hit by Lifeline and immediately destroyed by the SAME hit still
            // counts as "destroyed" (it went 0 → grant → 0 within this one resolution).
            const shieldBeforeThisAbsorb = victim.shieldPool;
            const { absorbed, hpDamage } = shieldAbsorb({
                damage,
                shieldPool: victim.shieldPool,
                isDot: cause?.byDirectDamage === false,
                penPct: cause?.shieldPenetrationPct ?? 0,
                bombPortion: cause?.bombPortion ?? 0,
            });
            victim.shieldPool -= absorbed;
            sink.addShieldAbsorbed(absorbed, victim.id);
            // AEGIS (SP-F F2): a DIRECT hit that fully depletes a non-empty shield pool. Excludes
            // DoT-tick batches (byDirectDamage:false) — a DoT zeroing a lingering shield is not a
            // "destruction" the game reacts to; a Barrier-blocked hit already returned above and
            // never reaches this line, so it can never false-positive here either.
            if (cause?.byDirectDamage && shieldBeforeThisAbsorb > 0 && victim.shieldPool === 0) {
                // Real event — INLINE for its combat listener (AEGIS on-ally-shield-destroyed).
                // Emitting inline keeps listener enqueue timing byte-identical to pre-log
                // behavior; the LOG-ONLY twin below carries the deferred nesting.
                bus.emit({ type: 'shield-destroyed', victimId: victim.id, round: r });
                const logEv: CombatEvent = {
                    type: 'shield-destroyed-log',
                    victimId: victim.id,
                    round: r,
                    reactive: true,
                    duringTurnOf: actingActorId,
                    triggerActorId: actingActorId,
                };
                if (deferReflectLogs || deferConsequenceLogs) pendingConsequenceLogs.push(logEv);
                else bus.emit(logEv);
            }
            victim.currentHp = Math.max(0, victim.currentHp - hpDamage);
            // At the lethal moment, intercept once per combat: a carrier of a CHEAT_DEATH_BUFFS
            // buff survives at 1 HP instead of dying. The buff is 'recurring' (always-active), so
            // it is never stored/timed — consumption is the per-actor cheatDeathConsumed flag
            // (NOT a store mutation). On intercept we floor HP at 1 (overriding the Math.max(0, …)
            // above), mark consumed, wipe the actor's REMOVABLE timed statuses (DoTs/timed
            // self-buffs; persistent-stack + unremovable preserved), emit cheat-death-activated,
            // and DO NOT record a destroy.
            //
            // Detection MUST go through selfBuffNamesForOwners, NOT snapshot().activeSelfBuffs:
            // a real (Yazid/Tycho/Hayyan-granted) Cheat Death is an ability-sourced recurring
            // self-buff that surfaces via activeAbilityStatuses('self', …, ownerId) — snapshot's
            // activeSelfBuffs only carries SCHEDULED always-active buffs, and only for the
            // 'attacker' owner (empty for any other owner). Since the heal target's owner id is
            // often a team-actor id (not 'attacker'), snapshot alone misses both the
            // ability-sourced case AND the non-attacker-owner case. selfBuffNamesForOwners
            // aggregates snapshot + timed + active ability self statuses keyed by the actor's
            // own id, covering every Cheat Death source.
            if (victim.currentHp <= 0) {
                const targetId = victim.id;
                // Captured BEFORE recordDestroyed (which sets destroyedRound): the death `else`
                // can RE-ENTER on a corpse hit again (currentHp ≤ 0 → recordDestroyed idempotent),
                // so this gate + the up-front bomb-consume below make the splash fire exactly once.
                const wasAliveBeforeThisCall = victim.destroyedRound === undefined;
                const carriesCheatDeath = selfBuffNamesForOwners(statusEngine, [targetId]).some(
                    (n) => CHEAT_DEATH_BUFFS.has(n)
                );
                if (carriesCheatDeath && !cheatDeathConsumed.has(targetId)) {
                    victim.currentHp = 1;
                    cheatDeathConsumed.add(targetId);
                    // Display-only: remember the round it was spent so the chip is dropped
                    // from rounds AFTER this one (see hideSpentCheatDeath). First write wins —
                    // the flag above already blocks any second intercept, so this set-once.
                    if (!cheatDeathConsumedRound.has(targetId)) {
                        cheatDeathConsumedRound.set(targetId, r);
                    }
                    statusEngine.clearRemovable(targetId);
                    // The tank's enemy-applied Corrosion/Inferno/generic DoTs are actor-state
                    // stacks (NOT StatusEngine entries), so clearRemovable doesn't touch them —
                    // wipe them here so the survivor takes no further ticks. These are the SAME
                    // arrays the turn-start DoT-tick intake reads (healTarget.corrosion/inferno/
                    // genericDoTEntries). SP-E: an `unremovable` stack (Acidic Decay) survives
                    // this wipe — filter, don't clear, so those entries keep ticking. Bombs
                    // (Blast, treated as persistent here) and accumulators are intentionally left
                    // untouched.
                    victim.corrosionEntries = victim.corrosionEntries.filter((e) => e.unremovable);
                    victim.infernoEntries = victim.infernoEntries.filter((e) => e.unremovable);
                    victim.genericDoTEntries = victim.genericDoTEntries.filter(
                        (e) => e.unremovable
                    );
                    // Real event — INLINE for its combat listener (Yazid on-cheat-death-activated),
                    // keeping listener timing byte-identical; the LOG-ONLY twin carries the nesting.
                    bus.emit({ type: 'cheat-death-activated', actorId: targetId, round: r });
                    const cheatDeathLogEv: CombatEvent = {
                        type: 'cheat-death-log',
                        actorId: targetId,
                        round: r,
                        reactive: true,
                        duringTurnOf: actingActorId,
                        triggerActorId: actingActorId,
                    };
                    if (deferReflectLogs || deferConsequenceLogs)
                        pendingConsequenceLogs.push(cheatDeathLogEv);
                    else bus.emit(cheatDeathLogEv);
                } else {
                    // First reach 0 (no intercept) → record the destroyed round + emit
                    // ship-destroyed once (shared helper; idempotent via the per-actor
                    // destroyedRound field). The healing result reads the destroyed round back
                    // off the heal target's runtime `destroyedRound` field at the result site —
                    // no side-specific scalar write is needed here.
                    recordDestroyed(victim, r, bus, cause?.killerId, cause?.byDirectDamage);
                    // Bomb-splash-on-death: a ship that dies with un-detonated bombs splashes a
                    // tier-scaled fraction (tier/4%: 100→25,200→50,300→75) of each bomb's damage to
                    // its LIVING same-side adjacent allies (positional only — victim.position gate
                    // enforces this; adjacentAllyIds has an all-allies fallback and does NOT
                    // self-gate, so the position check here is the sole non-positional guard).
                    // NO affinity (bombs aren't affinity-scaled). Bomb-like: full shield drain, no
                    // penetration (bombPortion = full). Credited to the bomb applier (sourceId).
                    // Chains: a splash that kills an adjacent bombed ally re-enters this same
                    // recordDestroyed else-branch for that ally, firing its splash — naturally finite
                    // (each ship dies once; bombs consumed up-front). Guarded against double-fire on a
                    // second hit to a corpse by (a) the wasAliveBeforeThisCall check and (b) consuming
                    // the bombs before splashing.
                    if (
                        wasAliveBeforeThisCall &&
                        victim.position !== undefined &&
                        victim.pendingBombs.length > 0
                    ) {
                        const bombs = victim.pendingBombs;
                        victim.pendingBombs = []; // consume up-front so a chain re-entry / corpse re-hit won't re-splash
                        const allyIds = bySide(
                            isEnemySide(victim.id) ? 'enemy' : 'player'
                        ).adjacentAllyIdsFor(victim.id);
                        for (const allyId of allyIds) {
                            const ally = allActorsById.get(allyId);
                            if (!ally || ally.destroyedRound !== undefined) continue;
                            for (const bomb of bombs) {
                                const splash = splashDamageForBomb(bomb, bomb.splashModifier);
                                if (splash <= 0) continue;
                                const splashOutcome = applyVictimDamage(splash, ally, sink, {
                                    killerId: bomb.sourceId,
                                    byDirectDamage: true,
                                    bombPortion: splash, // full bomb → full shield drain, no penetration
                                    shieldPenetrationPct: 0,
                                });
                                // perActorSplash stays the FULL splash — it reports what the dying
                                // bomb threw out, the splash counterpart of perActorReflected.
                                perActorSplash.set(
                                    ally.id,
                                    (perActorSplash.get(ally.id) ?? 0) + splash
                                );
                                // The display channels book the intake the funnel RECORDED, so a
                                // splash an ally's incoming-block shaved (or a Protection cascade
                                // diverted onward) is not counted where it never landed.
                                const splashBooked = splashOutcome.incomingBooked;
                                if (splashBooked > 1e-9) {
                                    roundPerTargetDamage.set(
                                        ally.id,
                                        (roundPerTargetDamage.get(ally.id) ?? 0) + splashBooked
                                    );
                                    // SP-F F1: the bomb's original applier (sourceId), not the dying
                                    // bombed ship that splashed.
                                    creditDealt(bomb.sourceId, ally.id, splashBooked);
                                }
                            }
                        }
                    }
                }
            }
            // Tank-side hp-changed (Phase 4c PR 3): ONCE per HP-intake event — this closure
            // is called per enemy attack (aggregate drain) AND per turn-start DoT batch, and
            // the emission covers both deliberately ("when HP drops below N%" includes DoT
            // damage in-game). Emitted after the Cheat-Death intercept (a 100→1-HP save
            // counts as a downward crossing — spec §5). Exact percentages (the enemy dummy's
            // post-round emission stays integer-granularity — asymmetry intended, events.ts).
            // A killed tank emits ship-destroyed above, never a posthumous crossing.
            if (victim.currentHp > 0 && maxHp > 0) {
                bus.emit({
                    type: 'hp-changed',
                    targetId: victim.id,
                    round: r,
                    oldPct: (100 * hpBefore) / maxHp,
                    newPct: (100 * victim.currentHp) / maxHp,
                });
            }
            // D-PR8: record a direct hit for the not-hit-this-round gate. A hit = a direct
            // attack that landed damage on shield or HP (absorbed > 0 || hpDamage > 0). The
            // byDirectDamage guard excludes DoT-tick batches (they pass byDirectDamage:false);
            // fully-Barrier-blocked hits return earlier (barriered:true) and are not recorded.
            // TODO(verify): whether a fully-Barrier-blocked direct attack should count as a hit
            // for Alacrity is unconfirmed in-game; current default is "not a hit".
            if (cause?.byDirectDamage && (absorbed > 0 || hpDamage > 0)) {
                hitThisRound.add(victim.id);
            }
            // Reflect gear set (Task 5): thorns. When a Reflect wearer takes a DIRECT hit that
            // dealt net HP damage, reflect Σpct% of that net HP damage back at the attacker —
            // mitigated by the attacker's affinity matchup (wearer is the source of the reflected
            // hit), defence, and incoming-reduction. Applied via a RECURSIVE applyVictimDamage with
            // isReflected:true so it (a) drains the attacker's shield→HP per the H1 rules, (b) runs
            // its own death handling (a reflected kill records the destroy + fires on-death FOR
            // FREE — recordDestroyed above), and (c) does NOT itself reflect (the isReflected guard
            // below skips). applyVictimDamage emits NO attacked/reaction events (those live in the
            // turn/wrapper layer), so reflection neither re-triggers reactions nor ping-pongs.
            //
            // GUARDS (any → skip): a reflected application (no ping-pong); no net HP damage; a DoT
            // tick (byDirectDamage === false); the victim has no damage-reflection ability. Fully
            // inert (no helper calls) for every fixture without REFLECT equipment → byte-identical.
            //
            // MIXED DIRECT + DETONATE HIT: a single apply can carry damage = directDamage +
            // detonationDamage with byDirectDamage:true AND bombPortion > 0 (a cast that both lands a
            // direct hit and detonates a bomb in the same hit — see the enemy-aggregate apply site).
            // The bomb portion never reflects (bombs full-drain, no reflect); the direct portion does.
            // We split the net HP damage proportionally by the RAW direct fraction of the post-block
            // total (`damage`). This is an intentional approximation: shieldAbsorb mixes the direct
            // and bomb slices into a single hpDamage, so we cannot recover the exact direct HP loss —
            // we apportion it by raw fraction. Pure-direct (bombPortion 0) → fraction 1 → full
            // hpDamage (byte-identical to the pre-split behavior). Pure-bomb (bombPortion === total)
            // → fraction 0 → basis 0 → skip (no reflect).
            //
            // KILLING-BLOW NOTE: no guard on victim.destroyedRound — if the hit that killed the
            // wearer also triggers reflection, the thorns still fire (hit landed before death).
            // The attacker.destroyedRound guard below prevents posthumous reflection TO an
            // already-dead attacker, but the WEARER dying on the same hit is intentional and
            // covered by test case (e).
            // !cause?.isCounter is loop-safe: a counter application must not itself be reflected.
            if (
                !cause?.isReflected &&
                !cause?.isCounter &&
                hpDamage > 0 &&
                cause?.byDirectDamage !== false
            ) {
                // Direct slice of the net HP damage: exclude the bomb portion by the raw direct
                // fraction of the post-block total. bombPortion 0 → directFraction 1 (full reflect);
                // bombPortion === total → directFraction 0 → basis 0 → skipped below.
                const totalRaw = damage;
                const bombPortion = cause?.bombPortion ?? 0;
                const directFraction =
                    totalRaw > 0 ? Math.max(0, (totalRaw - bombPortion) / totalRaw) : 0;
                const reflectBasis = hpDamage * directFraction;
                // Epic PR12 (A): a requirePrimaryTarget reflect ability (Nosorog) only fires when
                // this victim was the attacker's anchor — excluded for a covered/splash footprint
                // victim (cause.isPrimaryTarget === false). Undefined/true (every non-positional
                // call site, and every requirePrimaryTarget-less ability e.g. Reflect gear set)
                // keeps it included — byte-identical there.
                //
                // NIT 4 (latent-safety): the `undefined → treated as primary` default is correct
                // ONLY because every real-roster AoE path today is POSITIONAL — applyPositionalDamage
                // threads isAnchor → applyIncomingToTarget/applyOutgoingToEnemy → isPrimaryTarget, so
                // a covered victim always gets an explicit `false`. The remaining undefined callers are
                // all inherently SINGLE-target (the legacy non-positional applyIncomingToTarget binds
                // one victim, which IS the primary). A FUTURE non-positional real-roster AoE path would
                // have to pass isPrimaryTarget explicitly, or a covered victim would wrongly reflect.
                //
                // NIT 2 (reactive paths do not over-fire): a Nosorog taking REACTIVE damage does NOT
                // reflect, by construction — (a) counterattacks reach applyVictimDamage with
                // isCounter:true, which the `!cause?.isCounter` guard above skips entirely; and (b) the
                // reactive-damage executor (applyReactiveDamage) is credit-only (creditDamage), never
                // calling applyVictimDamage, so it never reaches this reflect block at all. Detonation/
                // bomb reactive hits pass bombPortion===total → directFraction 0 → reflectBasis 0 (no
                // reflect); DoT ticks pass byDirectDamage:false (guard above). So no reactive path
                // leaves isPrimaryTarget undefined in a way that could wrongly reflect — no code change
                // needed (see the PR12 review report for the full call-site enumeration).
                const reflectAbilities =
                    reflectBasis > 0
                        ? incomingAbilitiesOf(victim.id).filter(
                              (a) =>
                                  a.config.type === 'damage-reflection' &&
                                  (!a.config.requirePrimaryTarget ||
                                      cause?.isPrimaryTarget !== false)
                          )
                        : [];
                if (reflectAbilities.length > 0) {
                    const reflectPct = reflectAbilities.reduce(
                        (sum, a) =>
                            sum + (a.config.type === 'damage-reflection' ? a.config.pct : 0),
                        0
                    );
                    const attacker = allActorsById.get(cause?.killerId ?? '');
                    // Skip a missing attacker, self-damage (victim === attacker), and an
                    // already-destroyed attacker (no posthumous reflection).
                    if (
                        attacker &&
                        attacker.id !== victim.id &&
                        attacker.destroyedRound === undefined
                    ) {
                        // The WEARER (victim) is the source of the reflected hit → affinity is
                        // resolved wearer→attacker (computeAffinityModifiers(victim, attacker)).
                        const affinityDamageModifier = computeAffinityModifiers(
                            victim.affinity,
                            attacker.affinity
                        ).damageModifier;
                        const attackerDefence = effectiveStatsOf(
                            statusEngine,
                            selfBuffLookup,
                            attacker
                        ).defence;
                        const attackerDefenceReductionPct =
                            attackerDefence > 0 ? calculateDamageReduction(attackerDefence) : 0;
                        // Attacker's incoming-reduction against the reflected (direct) hit. Minimal
                        // ctx: no crit/stealth, direct scope (dotType undefined). Returns 0 for an
                        // attacker with no incoming-reduction ability → matches the duel-fit default.
                        const attackerIncomingReductionPct = incomingReductionForHit(
                            incomingAbilitiesOf(attacker.id),
                            {
                                didCrit: false,
                                attackerStealthed: false,
                                victimStealthed: false,
                                victimStasised: false,
                                hitIndexThisRound: 0,
                                // The reflected hit's "attacker" is the reflector (victim, outer
                                // scope) and its "victim" is `attacker` (receiving the bounce-back).
                                attackerHasDot: attackerHasDot(victim.id),
                                victimHasBarrierRecharging: hasBarrierRecharging(attacker.id),
                                victimHasShield: hasShield(attacker.id),
                                selfHpPct: selfHpPctOf(attacker.id),
                                // No 'transform-incoming-to-dot' ability reads the reflect ctx
                                // (Voron/Orel's own incoming-reduction, not the reflected hit's
                                // reduction) — default false, mirroring the pattern above.
                                attackerTauntedOrProvoked: false,
                            }
                        );
                        const reflected = reflectedDamageForHit({
                            reflectPct,
                            // Direct slice only — the bomb portion of a mixed hit never reflects.
                            netHpDamage: reflectBasis,
                            affinityDamageModifier,
                            attackerDefenceReductionPct,
                            attackerIncomingReductionPct,
                        });
                        if (reflected > 0) {
                            // `sink` accumulates the attacker's incoming into the unified
                            // perActorIncoming/intakeFor map under its own id (ids are globally
                            // unique across sides — no per-side selection needed, SP-U U1).
                            const reflectOutcome = applyVictimDamage(reflected, attacker, sink, {
                                killerId: victim.id,
                                byDirectDamage: true,
                                isReflected: true,
                                shieldPenetrationPct: 0,
                                bombPortion: 0,
                            });
                            perActorReflected.set(
                                attacker.id,
                                (perActorReflected.get(attacker.id) ?? 0) + reflected
                            );
                            // Surface the reflected hit as the attacker's per-victim incoming so it
                            // flows into RoundData.perTargetDamage → the attacker's damageTaken /
                            // hpPct (mirrors how a normal direct hit's emitHit accumulates). Without
                            // this, reflected damage would mutate the attacker's live HP but never
                            // appear on the reconstructed HP curve.
                            //
                            // Booked as the intake the funnel RECORDED (`incomingBooked`), not the
                            // bounce we computed. The recipient's own incoming-block can convert a
                            // bounce into a self-DoT (its Hit Mitigation one-shot or a Voron/Orel
                            // transform — a bounce-back DOES read both; see the Hit Mitigation
                            // guard's note), and that converted amount lands LATER as generic DoT
                            // ticks, each booking its own increment into these two maps. Booking the
                            // full bounce here as well would count it twice on both display channels
                            // (damageTaken, and the HP curve for any round that leaves no
                            // `perActorIncoming` bucket for this actor to prefer). A barriered bounce
                            // IS booked, exactly as a barriered direct hit is on the main path.
                            const reflectBooked = reflectOutcome.incomingBooked;
                            if (reflectBooked > 1e-9) {
                                roundPerTargetDamage.set(
                                    attacker.id,
                                    (roundPerTargetDamage.get(attacker.id) ?? 0) + reflectBooked
                                );
                                // SP-F F1: the reflecting WEARER (victim.id) is the source-attacker
                                // of this bounce-back hit; `attacker` (the original attacker, now
                                // the recipient) is the victim key — direction-inverted vs the outer
                                // names. Must move in LOCKSTEP with the write above: `perTargetDealt`
                                // is documented as a per-attacker mirror of EVERY
                                // roundPerTargetDamage increment, and `damageDealt`/`damageTaken`
                                // reconcile by construction. (A converted bounce is credited to the
                                // recipient itself — `convertHitToSelfDot` stamps the self-DoT
                                // `sourceId: victim.id` — so the reflector rightly loses the credit.)
                                creditDealt(victim.id, attacker.id, reflectBooked);
                            }
                            // Log-only reflect surface (see the deferReflectLogs doc above
                            // applyVictimDamage). On the deferred (positional) path we BUFFER the
                            // row and flush it after emitDeferredAbilityPerformed creates the
                            // attack entry, so it nests under the attack (not a preceding
                            // charge/buff entry). Off the deferred path the attacker's
                            // ability-performed already exists → emit inline. Stamp duringTurnOf
                            // with the acting attacker either way; didCrit omitted (reflects don't
                            // crit).
                            if (deferReflectLogs) {
                                pendingReflectLogs.push({
                                    sourceId: victim.id,
                                    targetId: attacker.id,
                                    amount: reflected,
                                });
                            } else {
                                bus.emit({
                                    type: 'reactive-damage-performed',
                                    sourceId: victim.id,
                                    targetId: attacker.id,
                                    round: r,
                                    amount: reflected,
                                    reactive: true,
                                    duringTurnOf: actingActorId,
                                    triggerActorId: actingActorId,
                                });
                            }
                        }
                    }
                }
            }
            // 'Exposed' is consumed by the hit it amplified ("removed after taking direct damage").
            // Placed at the funnel's landing exit so BOTH directions consume identically — and AFTER
            // the caller computed this hit's damage off the amplified modifier, so the hit that pays
            // for the status is the one that benefits from it.
            //
            // The governing rule: consume ONLY on a hit that actually read the amplification. So the
            // exclusions mirror exactly what the incoming-damage channel itself excludes:
            //  - DoT-tick batches and bomb/detonation portions (`byDirectDamage: false` / a non-zero
            //    `bombPortion`) never read `incomingDamageModifierPct`;
            //  - the three SECONDARY hit types compute their damage without that channel too, so
            //    they would spend the status for nothing (found in review, PR #289):
            //      · reflect  — `reflectedDamageForHit` folds only the attacker's incoming-REDUCTION,
            //      · counter  — passes `incomingDamageModifierPct: 0` outright (documented approximation),
            //      · transfer — the redirected chunk comes off the ORIGINAL victim's cascade.
            //    Same three flags, same reasoning as the Protection-transfer eligibility guard above.
            //  - the Barrier branch already returned without reaching here.
            //
            // NOTHING LANDED AT THAT INSTANT is the single premise the final term encodes, and it
            // covers all three ways this funnel can cancel a hit (owner ruling, 2026-08-03; extended
            // to a third path in the Shield Converter review):
            //  - Barrier ANNIHILATES the hit — nothing lands, ever, so the amplification was never
            //    cashed (that path returns above and never reaches this guard);
            //  - a TRANSFORM (Voron/Orel's `transform-incoming-to-dot`, or the `Hit Mitigation`
            //    one-shot) replaces the hit with a DoT, so nothing lands at THIS instant either.
            //    `immediateDamage - transformedToDot` is therefore <= 0 and Exposed stays ARMED.
            //  - `Shield Converter` NULLIFIES the hit into a shield deposit — no DoT, no HP/shield
            //    drain, `damage` is zeroed before `immediateDamage` is captured, so
            //    `immediateDamage - transformedToDot` is 0 here too (`transformedToDot` itself stays
            //    0 — this path doesn't touch it). It follows the BARRIER reading, not the transform
            //    one: like Barrier, the amount never re-books anywhere later (no deferred DoT tick),
            //    so Exposed staying armed costs nothing and matches Barrier's "nothing lands, ever".
            // That is deliberately the SAME reading of `transformedToDot` as the `attacked`
            // suppression in the per-victim `onVictimResolved` hook (`fullyTransformedToDot`): a
            // fully converted hit is not a direct hit, so it neither signals "directly damaged" to
            // on-attacked reactives nor spends a status whose game text is "removed after taking
            // direct damage". The two readings must stay in step — revisit them in the same commit
            // or the tree ends up asserting both premises at once (it briefly did). A hit whose
            // whole amount an incoming-BLOCK erased is excluded by the same term: both parts are 0.
            //
            // ACCEPTED CONSEQUENCE of that ruling: amplification is folded UPSTREAM of this funnel
            // (`victimIncomingModifiers`), so the amount a transform converts already carries the
            // +100% while Exposed also survives for a later hit — banked twice. Deliberate and
            // accepted, not an oversight: making it once-only would mean converting the UNAMPLIFIED
            // amount, which contradicts what a deferral is. Do not "fix" it in this guard.
            //
            // If a secondary path ever starts folding the per-victim incoming channel, drop its flag
            // from this guard in the same commit — amplify and consume must stay in lockstep.
            if (
                cause?.byDirectDamage === true &&
                (cause.bombPortion ?? 0) === 0 &&
                !cause.isProtectionTransfer &&
                !cause.isReflected &&
                !cause.isCounter &&
                immediateDamage - transformedToDot > 0
            ) {
                consumeExposed(statusEngine, victim.id);
            }
            return {
                // IMPORTANT 1 (Shield Converter review): report the PRE-deposit pool for a
                // converted hit, not the post-deposit `shieldBefore` captured above (which, for
                // this one hit, already includes the deposit) — otherwise shieldWasHit detection
                // at :6406-6411/:8592-8597 reads a nullify-and-grow as "the shield absorbed part of this hit".
                shieldBefore: shieldPoolBeforeConversion ?? shieldBefore,
                hpDamage,
                barriered: false,
                // Structurally excludes a converted hit from `shieldWasHit` detection at every
                // consumer site (see the field doc on VictimDamageOutcome.converted) — set whenever
                // the Shield Converter branch above actually fired this hit.
                converted: shieldPoolBeforeConversion !== undefined,
                transformedToDot,
                // A transform REVERSED the `.incoming` recorded above (convertHitToSelfDot), so the
                // net intake this application booked excludes it — the deferred amount is booked
                // later, per tick, by the DoT path.
                incomingBooked: incomingRecorded - transformedToDot,
            };
        };
        // Legacy healing-mode player intake — a THIN wrapper over applyVictimDamage. The sink
        // accumulates the victim's incoming / shield-absorbed / barrier-absorbed into its per-actor
        // bucket (intakeFor). The heal target's death round is no longer tracked via the sink —
        // it is read back off `healTarget.destroyedRound` (stamped by recordDestroyed) at the
        // result site. Signature, default `victim = healTarget!`, and return value are unchanged,
        // so every existing call site stays byte-identical.
        // SP-U U1: this single sink serves BOTH directions (player-victim and enemy-victim) —
        // ids are globally unique across sides, so one `intakeFor` map is safe for both. Formerly
        // two separate per-side sink objects with byte-identical bodies; collapsed since they
        // never diverged.
        const sink: DamageAccountingSink = {
            addIncoming: (amount, victimId) => {
                intakeFor(victimId).incoming += amount;
            },
            addShieldAbsorbed: (amount, victimId) => {
                intakeFor(victimId).shieldAbsorbed += amount;
            },
            addBarrierAbsorbed: (amount, victimId) => {
                intakeFor(victimId).barrierAbsorbed += amount;
            },
            addConvertedToShield: (amount, victimId) => {
                intakeFor(victimId).convertedToShield += amount;
            },
        };
        // H1 T4: the effective shield penetration % of an attacker, resolved from its static
        // ActorStats.shieldPenetration (threaded in Tasks 1-2). Defaults to 0 for an unknown id
        // or an attacker that never set the stat → byte-identical for fixtures without pen.
        const attackerShieldPenOf = (id?: string): number =>
            (id ? allActorsById.get(id)?.stats.shieldPenetration : undefined) ?? 0;
        const applyIncomingToTarget = (
            damage: number,
            victim: CombatActor = healTarget!,
            // C2b-2 T5: defaults to the DIRECT-damage attribution (the acting actor landed this
            // hit). The DoT-tick batch caller overrides with { byDirectDamage: false } — a DoT
            // batch is an aggregate of multiple appliers with NO single killer.
            // H1 T4: callers may also pass a `bombPortion` — the detonation slice of `damage`
            // that drains the shield in FULL (no penetration).
            cause: {
                killerId?: string;
                byDirectDamage?: boolean;
                bombPortion?: number;
                isReflected?: boolean;
            } = {
                killerId: actingActorId,
                byDirectDamage: true,
            },
            // Epic PR12 (A): forwarded to applyVictimDamage's cause.isPrimaryTarget (Nosorog's
            // reflect gate). Undefined at every pre-PR12 call site → byte-identical (treated as
            // primary, matching the existing behavior for every ability without
            // requirePrimaryTarget).
            isPrimaryTarget?: boolean
        ): VictimDamageOutcome =>
            applyVictimDamage(damage, victim, sink, {
                ...cause,
                // H1 T4: direct hits respect the ACTING attacker's shield penetration; DoT
                // batches (byDirectDamage:false) force pen 0 and bypass the shield entirely.
                shieldPenetrationPct:
                    cause.byDirectDamage === false
                        ? 0
                        : attackerShieldPenOf(cause.killerId ?? actingActorId),
                bombPortion: cause.bombPortion ?? 0,
                isPrimaryTarget,
            });
        // Player→enemy intake (E1 — symmetric incoming surface). The symmetric THIN wrapper over
        // applyVictimDamage for the direction where a PLAYER attacks an ENEMY victim. The enemy
        // victim runs the FULL HP/shield/Barrier/Cheat-Death/recordDestroyed path AND now records
        // its incoming / shield-absorbed / barrier-absorbed into the same per-actor `intakeFor`
        // bucket `sink` uses — keyed by the ENEMY victim's id (ids are globally unique across
        // sides, so one map serves both directions). `applyOutgoingToEnemy` is only invoked on the
        // positional apply path (drivePositionalApply), so non-positional fixtures never add an
        // enemy key → byte-identical. The enemy victim is never the heal target, so no heal-target
        // death-round bookkeeping applies. E2 (per-victim leech) reads this surface.
        const applyOutgoingToEnemy = (
            damage: number,
            enemyVictim: CombatActor,
            // Epic PR12 (A): forwarded to applyVictimDamage's cause.isPrimaryTarget (Nosorog's
            // reflect gate). Undefined at every pre-PR12 call site → byte-identical.
            isPrimaryTarget?: boolean
        ): VictimDamageOutcome =>
            // C2b-2 T5: a player→enemy hit is always DIRECT damage from the acting attacker.
            // H1 T4: positional player→enemy hits are all-direct (no detonation slice here), so
            // they respect the acting attacker's shield penetration with bombPortion 0 (default).
            applyVictimDamage(damage, enemyVictim, sink, {
                killerId: actingActorId,
                byDirectDamage: true,
                shieldPenetrationPct: attackerShieldPenOf(actingActorId),
                isPrimaryTarget,
            });
        // TEST-ONLY: hand the genuine wrapper out once (no production caller until Task 8). The
        // closure is per-round-identical in behaviour (only `r` differs), so capturing it on the
        // first round it is built is sufficient. Inert in production (the field is never set).
        input.__testTapApplyOutgoingToEnemy?.(applyOutgoingToEnemy);

        // G PR1: full mitigated/crit counter walk from the counter owner to the attacker.
        // Unreferenced dead code until the executor (Task 4) wires it via ctx.applyCounterAttack
        // → byte-identical now. Reuses applyVictimDamage (no attacked event → no re-counter).
        const applyCounterAttack = (
            ownerId: string,
            attackerId: string,
            abilityId: string,
            multiplier: number,
            hits: number
        ): { dealt: number; didCrit: boolean } | void => {
            const owner = allActorsById.get(ownerId);
            const attacker = allActorsById.get(attackerId);
            // Guards: owner alive, attacker alive, not self (spec rule 6).
            if (!owner || !attacker) return;
            if (owner.destroyedRound !== undefined) return;
            if (attacker.destroyedRound !== undefined || attacker.id === owner.id) return;

            const ownerStats = effectiveStatsOf(statusEngine, selfBuffLookup, owner);
            const attackerStats = effectiveStatsOf(statusEngine, selfBuffLookup, attacker);

            // Roll the OWNER's crit via the dedicated gate (one stream per counter ability per owner).
            const didCrit = rollRateGate(
                counterCritGates,
                `${ownerId}:${abilityId}`,
                ownerStats.crit / 100
            );

            const raw = victimHitDamage(
                {
                    effectiveAttack: ownerStats.attack,
                    // `multiplier` is the PER-HIT value, so the full counter total is
                    // multiplier × hits. The counter is modeled as ONE consolidated applied
                    // hit, so fold the count into the multiplier and pass hits:1 — passing the
                    // real `hits` here would make victimHitDamage re-split (preCritDamage / hits)
                    // and silently collapse a multi-hit counter back to a single hit's damage.
                    // Byte-identical for single-hit counters (hits === 1).
                    multiplierPct: multiplier * hits,
                    secondaryStatValue: 0,
                    hits: 1,
                    effectiveCritDamage: ownerStats.critDamage,
                    outgoingDamageBuffPct: 0,
                    // APPROXIMATION (asymmetry vs Reflect, which threads the attacker's
                    // incomingReductionForHit): the counter does NOT apply the attacker's
                    // incoming-damage-reduction abilities. Harmless today (no Stalwart fixture);
                    // PR2 may thread incomingReductionForHit(incomingAbilitiesOf(attacker.id))
                    // here to match the Reflect path exactly.
                    incomingDamageModifierPct: 0,
                    // effectiveStatsOf.defensePenetration is BASE-only (buff folds separately) —
                    // acceptable approximation (no Stalwart fixture; counters ignore pen-buffs).
                    defensePenetrationPct: ownerStats.defensePenetration,
                    attackerAffinity: owner.affinity ?? 'antimatter',
                },
                {
                    defence: attackerStats.defence,
                    defenceModifierPct: 0,
                    affinity: attacker.affinity ?? 'antimatter',
                },
                didCrit,
                1 // roleScale: a counter is a single full hit
            );
            if (raw <= 0) return;

            // `sink` (outer scope, SP-U U1) accumulates the attacker's incoming regardless of
            // side — ids are globally unique across sides.
            //
            // Buffer this application's log-only consequence twins, exactly as applyReactiveDamage
            // does: a counter also emits its own `reactive-damage-performed` row only AFTER this
            // call returns (triggers.ts emitReactiveDamageLog), so a Lifeline grant / shield-
            // destroyed / cheat-death raised by the counter hit would otherwise print above the
            // counter that caused it. try/finally so a throw can't strand the flag.
            const wasDeferring = deferConsequenceLogs;
            deferConsequenceLogs = true;
            // Annotated (not an inferred `let`): the assignment sits inside the try, so an untyped
            // declaration would evolve to `any` and stop type-checking the `.incomingBooked` read
            // below — a silent typo there would book `raw` and restore the double-count.
            // `AppliedVictimDamage` rather than `VictimDamageOutcome` so `incomingBooked` is
            // non-optional: the `?? 0` below then covers only the (unreachable) case of the throw
            // that skips the assignment, not a silently absent field.
            let counterOutcome: AppliedVictimDamage | undefined;
            try {
                counterOutcome = applyVictimDamage(raw, attacker, sink, {
                    killerId: owner.id,
                    byDirectDamage: true,
                    isCounter: true,
                    // Mirror Reflect (no shield penetration on the reactive hit). EffectiveStats has NO
                    // shieldPenetration field; we deliberately pass 0.
                    shieldPenetrationPct: 0,
                    bombPortion: 0,
                });
            } finally {
                deferConsequenceLogs = wasDeferring;
            }
            // Surface on the attacker's incoming so it appears on the HP curve (mirror Reflect):
            // the intake the funnel RECORDED, so a portion the attacker's own incoming-block
            // converted into a self-DoT is booked by its ticks rather than twice. See the Reflect
            // site's note.
            const counterBooked = counterOutcome?.incomingBooked ?? 0;
            if (counterBooked > 1e-9) {
                roundPerTargetDamage.set(
                    attacker.id,
                    (roundPerTargetDamage.get(attacker.id) ?? 0) + counterBooked
                );
                // SP-F F1: the counter-OWNER is the source-attacker of this counter hit. Moves in
                // lockstep with the write above (perTargetDealt mirrors every increment).
                creditDealt(owner.id, attacker.id, counterBooked);
            }
            // `dealt` stays the FULL counter, converted or not: it feeds only the log row
            // (triggers.ts emitReactiveDamageLog) and the reactive dealt-amount slot, and the main
            // cast path likewise logs its computed `directDamage` when a victim converts the hit
            // (playerTurn's deferredAbilityPerformed). Suppressing it would erase the counter from
            // the play-by-play entirely — a conversion emits no event of its own.
            return { dealt: raw, didCrit };
        };

        // PR4b: the reactive `damage` executor branch (triggers.ts cfg.type==='damage') — Grif's
        // on-enemy-cleansed, FrontLine's on-enemy-charged-cast, and epic PR4's re-tagged Judge/
        // Chakara/Incinerator/Rhodium start-of-round/end-of-round passives. Mirrors
        // applyCounterAttack's mitigated/crit walk (SAME victimHitDamage call, SAME documented
        // approximations: no outgoing-damage buff, no per-victim incoming-damage modifier,
        // base-only defense penetration, no shield penetration) but CREDITS the owner's round
        // damage-dealt bucket (creditDamage) instead of applying real HP damage via
        // applyVictimDamage — this executor never mutated a specific victim's HP before this fix
        // either (`ctx.creditReactiveDamage` was credit-only), so that contract is UNCHANGED; only
        // the CREDITED NUMBER's formula changes (now mitigated + crit-eligible instead of a flat
        // effectiveAttack × multiplier fold with no defense and no crit).
        //
        // Victim resolution is the caller's job (triggers.ts resolves `counterTargetId ?? ctx.
        // enemy.id`, the SAME idiom every sibling target:'enemy' reactive branch already uses) —
        // this closure only needs a concrete victim id to mitigate against.
        const applyReactiveDamage = (
            ownerId: string,
            victimId: string,
            abilityId: string,
            multiplier: number,
            hits: number,
            noCrit: boolean,
            hpBasisPct?: number,
            // Ship-kit W8 (Xcellence on-resist): sibling of hpBasisPct — when set (and
            // hpBasisPct is not), raw = owner's CURRENT SHIELD × shieldBasisPct% instead of
            // attack × multiplier. Mutually exclusive with hpBasisPct in the corpus; hpBasisPct
            // takes precedence if both were ever set.
            shieldBasisPct?: number,
            allowDeadOwner?: boolean,
            // Ship-kit W5 Task C3 (Demolisher bomb-splash). `flatBasis`: this proc is a FLAT copy
            // of some OTHER already-resolved damage figure (the bomb's own burst,
            // eventCtx.triggerDamage) rather than owner-attack × multiplier — raw is computed
            // directly, skipping `victimHitDamage` ENTIRELY (no defense, no crit roll, no
            // affinity). `ignoresDefense` (without `flatBasis`): the normal attack-basis/crit walk
            // still runs, but the victim's Defense term is bypassed (defence: 0) — kept minimal,
            // for generality beyond Demolisher's own (flat) path. Both absent (every pre-C3
            // caller) → byte-identical to the pre-C3 body below.
            opts?: { ignoresDefense?: boolean; flatBasis?: number }
        ): { dealt: number; didCrit: boolean } | void => {
            const owner = allActorsById.get(ownerId);
            const victim = allActorsById.get(victimId);
            // allowDeadOwner (PR-B1, Paracelsus): an on-destroyed retaliation is BORN of the
            // owner's own death — the owner is already stamped destroyedRound by the time this
            // drains (recordDestroyed runs before the ship-destroyed emit that enqueues this
            // intent), so the plain "owner must be alive" gate would always no-op it. Mirrors the
            // fromOwnDeath exemption the dead-owner drain gate already grants in triggers.ts
            // (executeIntent) for Martyrdom's killer-Disable / Salvation's heal.
            if (!owner || (owner.destroyedRound !== undefined && !allowDeadOwner)) return;
            // A missing/already-destroyed victim has no defense to mitigate against — skip
            // rather than crediting an un-mitigated number. BEHAVIOR CHANGE vs the pre-#211
            // formula (which never referenced a victim and credited unconditionally): for the
            // ctx.enemy fallback this is inert (the DPS/sim `enemy` is a real destructible actor
            // since SP-U U5, but its HP/`recordDestroyed` only land in the post-round accounting
            // step — never during this in-turn drain — so `victim.destroyedRound` is never set
            // yet here), but a counterTargetId-routed victim (FrontLine's charging
            // enemy) CAN die to an earlier reactive in the same drain batch — the proc then
            // credits nothing, which is the correct reading (you can't hit a corpse).
            if (!victim || victim.destroyedRound !== undefined) return;

            const ownerStats = effectiveStatsOf(statusEngine, selfBuffLookup, owner);
            const victimStats = effectiveStatsOf(statusEngine, selfBuffLookup, victim);

            let raw: number;
            let didCrit: boolean;

            if (opts?.flatBasis !== undefined) {
                // Ship-kit W5 Task C3 (Demolisher bomb-splash): a FLAT copy of the triggering
                // event's OWN already-resolved damage (the bomb's burst) — raw = flatBasis ×
                // multiplier/100 (100% = a straight copy), computed DIRECTLY with no
                // `victimHitDamage` call at all: no owner-attack basis, no Defense mitigation, no
                // crit roll (a flat copy can never crit by design — `noCrit` is honoured by
                // construction, not by a flag check), and deliberately NO affinity
                // re-application. Affinity rationale: the bomb's `damage` already resolved the
                // ORIGINAL applier's affinity matchup against the BOMBED victim; re-running
                // affinity math here would apply THIS neighbour's affinity to a hit that never
                // actually had a matchup against it — the burst is a single already-realized
                // number being copied, not a new attack being rolled. Mirrors the
                // bomb-splash-on-death precedent (engine.ts ~4187, `splashDamageForBomb`), which
                // is likewise flat/no-affinity.
                raw = Math.round((opts.flatBasis * multiplier) / 100);
                didCrit = false;
            } else {
                // Deterministic per-(owner, ability) crit gate — a NEW map (reactiveDamageCritGates),
                // never Math.random. `noCrit` short-circuits the roll entirely: a flagged ability
                // (Grif "cannot critically hit", Rhodium "cannot critically hit") never creates a gate
                // key, so it can never crit by construction, matching the flag rather than relying on
                // the executor to withhold crit eligibility. A 0%-crit owner ALSO skips the roll — a
                // guaranteed-miss draw would still consume a value from the shared seeded RNG stream
                // and perturb every later gate's schedule (proc gates, debuff landing) for ships that
                // can never crit anyway. Live-checked per call, so a mid-fight crit buff starts
                // drawing from that point on.
                didCrit =
                    !noCrit &&
                    ownerStats.crit > 0 &&
                    rollRateGate(
                        reactiveDamageCritGates,
                        `${ownerId}:${abilityId}`,
                        ownerStats.crit / 100
                    );

                // Vindicator on-resist: raw = owner effective max HP × hpBasisPct% (mitigated below the
                // same as any direct hit — defence + affinity + crit). Ship-kit W8 (Xcellence):
                // shieldBasisPct sibling uses the owner's CURRENT SHIELD (live shieldPool) as the
                // basis instead. Otherwise attack × multiplier.
                const basisStat =
                    hpBasisPct !== undefined
                        ? recipientMaxHp(ownerId)
                        : shieldBasisPct !== undefined
                          ? owner.shieldPool
                          : ownerStats.attack;
                const basisPct =
                    hpBasisPct !== undefined
                        ? hpBasisPct
                        : shieldBasisPct !== undefined
                          ? shieldBasisPct
                          : multiplier;

                raw = victimHitDamage(
                    {
                        effectiveAttack: basisStat,
                        // Fold hit count into the multiplier and pass hits:1 (mirrors
                        // applyCounterAttack) — models the reactive proc as ONE consolidated hit.
                        multiplierPct: basisPct * hits,
                        secondaryStatValue: 0,
                        hits: 1,
                        effectiveCritDamage: ownerStats.critDamage,
                        outgoingDamageBuffPct: 0,
                        incomingDamageModifierPct: 0,
                        defensePenetrationPct: ownerStats.defensePenetration,
                        attackerAffinity: owner.affinity ?? 'antimatter',
                    },
                    {
                        // SP-F F5: Meatshield defense-substitution (approximation) — see the
                        // substitutedDefenceFor doc comment above for the full rule. Ship-kit W5
                        // Task C3: `ignoresDefense` (non-flat generality path) bypasses the
                        // victim's Defense term entirely (defence: 0) instead of the normal
                        // substituted defence.
                        defence: opts?.ignoresDefense
                            ? 0
                            : substitutedDefenceFor(victim, victimStats.defence),
                        defenceModifierPct: 0,
                        affinity: victim.affinity ?? 'antimatter',
                    },
                    didCrit,
                    1 // roleScale: a reactive proc is a single full hit
                );
            }
            // Guard: swallows zero/negative procs (defensive — a 0-attack or 0-multiplier proc
            // credits nothing), matching the pre-fix zero-damage guard.
            if (raw <= 0) {
                // SP-G G3: a non-positive reactive hit still resets the owner's dealt-amount slot,
                // so a paired basis:'damage-dealt' shield (FrontLine) reads 0 for THIS proc rather
                // than a stale prior-round value.
                reactiveDealtByOwner.set(ownerId, 0);
                return;
            }
            reactiveDealtByOwner.set(ownerId, raw);
            // SP-M M1: in a positioned two-team battle (simulateBattle sets input.positionalTeamBattle)
            // a reactive proc REDUCES the resolved victim's real HP through the SAME shared funnel
            // counters use (applyVictimDamage) — surfacing on the victim's HP curve
            // (roundPerTargetDamage → damageTaken) and attributed to the owner (creditDealt →
            // perTargetDealt → damageDealt). Mirrors applyCounterAttack EXACTLY (isCounter:true → a
            // reactive hit is never itself reflected and never Protection-redirected; no shield
            // penetration) and deliberately does NOT creditDamage: positionalTeamBattle is never
            // dpsEnemyTarget, so the DPS-mode post-round aggregate (engine.ts:7931) never fires here
            // — cumulativeDamage only reports + declines the vestigial dummy, never a real victim, so
            // folding the reactive into it would double-count exactly like the per-victim DoT/
            // detonation split documented at engine.ts:7898.
            //
            // victim.id !== enemy.id: defensive backstop keeping the HP path off the vestigial dummy
            // (a proc whose target resolved to ctx.enemy — e.g. an AoE with an empty living roster —
            // stays credit-only). After Tasks 4-7 all eight ships resolve a real positioned victim.
            if (input.positionalTeamBattle && victim.id !== enemy.id) {
                // Buffer this application's log-only consequence twins (Lifeline shield grant,
                // shield destroyed, cheat death) so they print UNDER this proc's own attack row —
                // which triggers.ts emits only after this call returns. Restored in a `finally`
                // so a throw can never leave the flag stuck on for later applications.
                const wasDeferring = deferConsequenceLogs;
                deferConsequenceLogs = true;
                // Annotated for the same reason as applyCounterAttack's `counterOutcome`.
                let procOutcome: AppliedVictimDamage | undefined;
                try {
                    procOutcome = applyVictimDamage(raw, victim, sink, {
                        killerId: ownerId,
                        byDirectDamage: true,
                        isCounter: true,
                        shieldPenetrationPct: 0,
                        bombPortion: 0,
                    });
                } finally {
                    deferConsequenceLogs = wasDeferring;
                }
                // The intake the funnel RECORDED, mirroring applyCounterAttack (this site is
                // documented as its exact mirror, so booking `raw` here would re-create the
                // double-count for the eight reactive-damage ships). No fixture reaches this branch
                // — it needs `positionalTeamBattle` plus a reactive `damage` proc onto a
                // block-holding victim — so it is kept correct by construction with its sibling
                // rather than pinned.
                const procBooked = procOutcome?.incomingBooked ?? 0;
                if (procBooked > 1e-9) {
                    roundPerTargetDamage.set(
                        victim.id,
                        (roundPerTargetDamage.get(victim.id) ?? 0) + procBooked
                    );
                    creditDealt(ownerId, victim.id, procBooked);
                }
                // `dealt` stays the full proc — log/dealt-slot only, as in applyCounterAttack.
                return { dealt: raw, didCrit };
            }
            // DPS / healing mode (byte-identical): credit-only.
            creditDamage(ownerId, 'direct', raw);
            return { dealt: raw, didCrit };
        };

        // §4.5 STASIS direct-damage break (B3 Task 2). Fires via the `onHitBreakStasis` hook
        // injected into `runPlayerTurn` (playerTurn.ts), which calls it AFTER the scheduled
        // debuffs (sourceFired) but BEFORE the ability timed-debuff loop. This ordering ensures:
        //  - A pre-existing Stasis IS broken when the hit lands (victim was stasised at mark time).
        //  - A Stasis RE-APPLIED by the SAME attack's debuff ability (e.g. stasisInflictAttack)
        //    is NOT broken — detected via the turn's inflictedEnemyDebuffs at resolution time.
        //  - DoT ticks NEVER call this (they never enter runPlayerTurn's break hook path).
        //
        // DEFERRED-BREAK DESIGN: the hook does NOT immediately remove Stasis. Instead it marks
        // the victim id into a per-turn `stasisHitVictims` Set. Removal happens RIGHT AFTER the
        // attacker's own `drainIntentsFor('player')`/`drainIntentsFor('enemy')` in the same
        // turn-loop iteration. This satisfies two invariants:
        //  (i)  The on-attacked reactive's drainQueue check (Counter Shield suppression — test iii)
        //       sees `isStasised(victim) = true` because drainIntentsFor runs BEFORE the removal.
        //  (ii) The victim is freed BEFORE its own next turn, so it acts in the next round.
        //
        // RE-APPLY CHECK: at resolution time, if the SAME turn's `inflictedEnemyDebuffs` contain
        // a Stasis name for the target, the re-application wins → skip the break for that victim.
        // This is LOCAL to the same turn (no cross-turn casterId state needed), making the check
        // immune to the "same attacker later fires pure-damage hits" bug.
        //
        // (Task 3 adds the Akula doesntBreakStasis exception — placeholder left below.)

        // Per-victim enemy-debuff-derived modifiers (B1/PR7b). Reads the victim's OWN per-actor
        // enemy-debuff store — BOTH channels: scheduled (__enemy__ global) + ability (per-victim
        // payload timed+aura). Delegates to victimEnemyBuffs (triggers.ts) which mirrors
        // ownerDebuffNamesFor's three-source read, ensuring modifier-read and name-read stay in
        // lockstep. Attacker-sourced modifiers (outgoing buff, pen) stay attacker-sourced.
        // NOTE: the aura/accumulating ability channel is an approximation (NEUTRAL ctx, no re-roll)
        // — see the victimEnemyBuffs jsdoc (finding I1) for details and acceptance rationale.
        const victimIncomingModifiers = (
            victimId: string
        ): { enemyDefenseModifier: number; incomingDamageModifier: number } => {
            const victimDebuffs = victimEnemyBuffs(statusEngine, victimId, enemyDebuffLookup);
            const enemy = toEnemyModifiers(victimDebuffs);
            // 'Exposed' (Amartya/Nayra) is NAME-keyed, not a parsedEffects entry — it arms only the
            // NEXT direct hit and is consumed by it (see exposedStatus.ts for why it cannot ride
            // parsedEffects.incomingDamage). Folded into the same percentage channel as Inc. Damage
            // Up. Direct damage only, like every other term here — DoT ticks and bombs never read
            // this channel. `defenseProfileOf` calls this per HIT, so the consumption below
            // (applyVictimDamage) makes hit 2 of a multi-hit cast read a store with the status
            // already gone. It re-reads the status engine rather than folding off `victimDebuffs`
            // above: a one-shot must be read from exactly the channel its removal can spend, which
            // is narrower than the three-channel list `toEnemyModifiers` needs.
            const exposed = exposedIncomingPct(statusEngine, victimId);
            // D-PR12: friendly-side incoming-DIRECT-damage buffs on the victim's OWN 'self' store
            // (Inc. Damage Down/Up — Makoli/Salvation/Shelter/Refine/Battlecry). Summed into the SAME
            // per-victim incomingDamageModifier as enemy debuffs. Team-agnostic for the TIMED + AURA
            // ability channels (victimId keys the actor's own self store regardless of side). The
            // SCHEDULED channel reads selfBuffLookup, which today is populated only for player/team
            // actors (enemy runtimes pass an empty map) — a pre-existing gap, irrelevant until an
            // enemy carries a scheduled self-buff.
            // Direct-damage channel ONLY — by design. Per the game rules, incoming/outgoing
            // damage modifiers (Inc. Damage Down/Up, Out. Damage Up) apply to DIRECT hits
            // only; DoT ticks (corrosion/inferno) and bombs are EXCLUDED. DoT reduction has a
            // dedicated channel (incomingDotReductionPct / Vortex Veil); bombs apply through
            // the detonation/bombPortion path which never reads incomingDamageModifierPct.
            // Locked by bombModifierExclusion.test.ts.
            const selfIncoming = toSelfIncomingDamageModifier(
                victimSelfBuffs(statusEngine, victimId, selfBuffLookup)
            );
            // F3: the victim's pre-fight incomingDamage baseline (squad-leader "±N% incoming
            // direct damage") folds ADDITIVELY into the same per-victim channel the D-PR12
            // self-buff term rides (consumed via defenseProfileOf → incomingDamageModifierPct).
            // Sign convention matches the buff channel: negative = takes less damage
            // (leader protections use negative values). Absent → 0 → byte-identical. Like
            // the buff channel, this is DIRECT damage only (DoTs/bombs never read it).
            const preFightIncoming = allActorsById.get(victimId)?.preFight?.incomingDamage ?? 0;
            return {
                enemyDefenseModifier: enemy.enemyDefenseModifier,
                incomingDamageModifier:
                    enemy.incomingDamageModifier + selfIncoming + preFightIncoming + exposed,
            };
        };
        // TEST-ONLY: expose victimIncomingModifiers (enemy-debuff + friendly self-buff term,
        // D-PR12) to unit tests that assert per-victim modifier reads. Inert in production (never set).
        input.__testTapVictimEnemyModifiers?.(victimIncomingModifiers);
        input.__testTapIsStasised?.(isStasised);

        // Sub-project I, PR I2 (Layer 3) — per-victim OUTGOING modifier delta for enemy-
        // status-gated auras (Tygr "+30% to Stasis/Disable enemies", Incinerator "+30% to
        // Inferno enemies", Lodolite "+15% to Concentrate Fire/Stealth enemies"). The firing
        // turn's `positionalScalars.outgoingDamageBuffPct` already folds `modifierAbilities`
        // ONCE against `primaryCtx` (the bound/primary target's enemy-status, I1). Here we
        // re-fold the SAME abilities against a per-victim ctx (only the enemy-status fields
        // swapped to THIS victim's own status) and subtract the primary-ctx fold — every
        // non-enemy-status modifier (attack/crit/self-buff-gated outgoing, etc.) contributes
        // identically to both folds and cancels, isolating the pure per-victim delta.
        //
        // CAUSALITY: the per-victim status MUST be a PRE-TURN snapshot, not a live re-read at
        // apply time. `drivePositionalApply` runs AFTER `runPlayerTurn` returns, by which point
        // this turn's OWN debuff-inflict ability has already mutated the status engine — a live
        // read at that point would let a skill's own same-turn infliction retroactively satisfy
        // its own per-victim gate (exactly the anti-causality bug I1 guards against for the
        // PRIMARY target via buildTurnArgs's pre-turn `enemyDebuffNamesForTarget(tgt)` call).
        // `snapshotPreTurnVictimStatus` is called by each of the three turn sites BEFORE their
        // `runPlayerTurn` call, capturing every living opposing actor's status at that moment;
        // `perVictimOutgoingDeltaPct` below reads ONLY from that frozen snapshot.
        //
        //  - enemyDebuffNames: rebuilt from the snapshot (I1's per-target name read,
        //    `enemyDebuffNamesForTarget`), but ONLY when primaryCtx already carries the array
        //    (the DPS-parity sentinel: undefined means "not opted in" and must stay undefined
        //    here too — though this path only runs from the positional apply branch, where the
        //    primary ctx is always real/positional and the array is always populated).
        //  - enemyBuffNames: rebuilt from the snapshot for JUST this victim (the per-turn
        //    primaryCtx uses a UNION across every living enemy attacker — see
        //    enemyBuffNamesUnion above — which is correct for "does an enemy have X" REACTIVE
        //    gates but not for a per-victim OUTGOING-damage aura; the locked game rule (spec §2)
        //    requires each victim's OWN status here).
        //  - enemyHpPct: rebuilt from the snapshot's pre-turn currentHp/stats.hp reading (the
        //    primary ctx's value is a turn-start snapshot of the BOUND target only).
        //  - enemyType: NOT rebuilt — no per-enemy-attacker class field is plumbed on
        //    positional inputs today (only one fight-wide `input.enemyType`), so every victim
        //    reuses the primary ctx's value. Inert for every I2-scoped ship (none gate their
        //    outgoing modifier on `enemy-type`); a future enemy-type-gated per-victim aura
        //    needs real per-actor class plumbing first (deferred, not modeled here).
        //
        // For the PRIMARY target in a single-enemy fight this ctx is IDENTICAL to primaryCtx
        // (delta = 0) — byte-identical to I1. A ship with no enemy-status-gated outgoing
        // modifier also gets delta = 0 for every victim (the fold never differs by ctx).
        interface PreTurnVictimStatusSnapshot {
            enemyDebuffNames: string[];
            enemyBuffNames: string[];
            enemyHpPct: number;
        }
        const snapshotPreTurnVictimStatus = (
            opposingLiving: CombatActor[]
        ): Map<string, PreTurnVictimStatusSnapshot> =>
            new Map(
                opposingLiving.map((v) => [
                    v.id,
                    {
                        enemyDebuffNames: enemyDebuffNamesForTarget(v),
                        enemyBuffNames: selfBuffNamesForOwners(statusEngine, [v.id]),
                        enemyHpPct:
                            v.stats.hp > 0
                                ? Math.max(0, Math.min(100, (100 * v.currentHp) / v.stats.hp))
                                : 100,
                    },
                ])
            );
        const perVictimOutgoingDeltaPct = (
            perVictimOutgoing: PlayerTurnResult['perVictimOutgoing'],
            preTurnStatus: Map<string, PreTurnVictimStatusSnapshot> | undefined,
            victim: CombatActor
        ): number => {
            if (!perVictimOutgoing) return 0;
            const { modifierAbilities, primaryCtx } = perVictimOutgoing;
            if (modifierAbilities.length === 0) return 0; // fast path — nothing to re-fold
            // Defensive fallback: a victim absent from the snapshot (should never happen — the
            // snapshot covers the FULL opposing roster captured pre-turn) contributes delta 0
            // rather than crashing.
            const snap = preTurnStatus?.get(victim.id);
            if (!snap) return 0;
            const victimCtx: ConditionContext = {
                ...primaryCtx,
                ...(primaryCtx.enemyDebuffNames !== undefined
                    ? { enemyDebuffNames: snap.enemyDebuffNames }
                    : {}),
                enemyBuffNames: snap.enemyBuffNames,
                enemyHpPct: snap.enemyHpPct,
            };
            const full = modifierTotalsFromAbilities(modifierAbilities, victimCtx).outgoingDamage;
            const base = modifierTotalsFromAbilities(modifierAbilities, primaryCtx).outgoingDamage;
            return full - base;
        };

        // Shared positional-apply driver (Task 9, Step A) — the ONE place the three attack
        // sites (focus / walked-team / enemy) drive `applyPositionalDamage`. Each site has
        // already GATED (isPositional + non-null target/pattern/positionalScalars) and computed
        // its own `positional` flag (also used for credit suppression); this helper just runs the
        // per-victim apply against the resolved inputs. What differs per site is parameterized:
        //  - `scalars`/`hitCrits` — sourced from that site's turn result,
        //  - `pattern`/`target` — that actor's parsed pattern + parsed target,
        //  - `opposingLiving` — focus/team → enemyAttackerActors; enemy → allPlayerActors,
        //  - `applyToVictim` — focus/team → applyOutgoingToEnemy; enemy → applyIncomingToTarget,
        //  - `acting` — the firing actor's position / ignoresForcedTargeting / id (for provokerOf).
        // `defenseProfileOf` is identical across all three sites (B1/PR7b + D-PR12: wired to
        // victimIncomingModifiers — reads the victim's OWN per-actor enemy-debuff store AND
        // the victim's own self-buff store (both channels: scheduled + ability payload).
        // Direction-agnostic: victimIncomingModifiers(v.id) works for ENEMY victims
        // (focus/team site) and PLAYER victims (enemy site) alike.
        // No emitHit: runPlayerTurn already emits ONE aggregate ability-performed per turn;
        // per-hit/per-victim event fidelity is a documented Phase-5 follow-up.
        const drivePositionalApply = (args: {
            scalars: AttackerDamageScalars;
            // hitCrits is co-populated with positionalScalars by Task 7 (both are set iff a damage
            // ability fired), so the `?? []` below is DEFENSIVE only — never empty when scalars != null.
            hitCrits?: boolean[];
            pattern: ParsedPattern;
            target: ParsedTarget;
            actingPosition: Position;
            ignoresForcedTargeting?: boolean;
            /** W6: ship-wide stealth-targeting bypass. */
            ignoresStealth?: boolean;
            actingId: string;
            opposingLiving: CombatActor[];
            applyToVictim: (
                victim: CombatActor,
                damage: number,
                isAnchor?: boolean
            ) => VictimDamageOutcome;
            // E2 (per-victim leech): OPTIONAL per-direction hook. drivePositionalApply is ONE
            // helper shared by all three sites (focus / team / enemy); since standing (player→
            // enemy) and taken (enemy→player) leech need opposite logic, each site supplies its
            // own callback (Tasks 3/5) rather than branching inside the shared inline path.
            // Unsupplied by every current caller → fully inert.
            onVictimResolved?: (
                victim: CombatActor,
                damage: number,
                outcome: VictimDamageOutcome,
                didCrit: boolean
            ) => void;
            // Per-victim crit resolver (per-victim crit). The anchor victim reuses hitCrits[h];
            // each COVERED footprint victim rolls the attacker's crit gate at ITS OWN affinity-
            // capped rate via this callback. Unsupplied → every victim uses hitCrits[h] →
            // byte-identical. Each call site supplies the firing turn's rollVictimCrit.
            rollVictimCrit?: (victim: CombatActor) => boolean;
            // Sub-project I, PR I2: this turn's enemy-status-gated outgoing-modifier ingredients
            // (modifierAbilities + primaryCtx), forwarded from `turn.perVictimOutgoing`.
            // Unsupplied/undefined → perVictimOutgoingDeltaPct short-circuits to 0 for every
            // victim → byte-identical.
            perVictimOutgoing?: PlayerTurnResult['perVictimOutgoing'];
            // Sub-project I, PR I2: the PRE-TURN per-victim status snapshot (captured by the
            // call site via `snapshotPreTurnVictimStatus` BEFORE `runPlayerTurn` ran this turn),
            // keyed by victim id. Required for a non-zero delta — see the causality note above
            // perVictimOutgoingDeltaPct. Unsupplied → delta stays 0 for every victim.
            preTurnVictimStatus?: Map<string, PreTurnVictimStatusSnapshot>;
        }): { anyCrit: boolean; critPairs: number; critVictimIds: string[] } => {
            // Task 3: this is the ONE deferred (positional) apply path — reflects fired here must
            // buffer their log row until emitDeferredAbilityPerformed creates the attack entry
            // (see the deferReflectLogs doc above applyVictimDamage). try/finally so the flag
            // always clears, even if applyPositionalDamage throws.
            deferReflectLogs = true;
            try {
                return applyPositionalDamage({
                    hitCrits: args.hitCrits ?? [],
                    scalars: args.scalars,
                    pattern: args.pattern,
                    actorPosition: args.actingPosition,
                    target: args.target,
                    opposingLiving: args.opposingLiving,
                    statusOf: statusLookupFor(args.opposingLiving),
                    acting: {
                        ignoresForcedTargeting: args.ignoresForcedTargeting,
                        ignoresStealth: args.ignoresStealth,
                        provokedBy: provokerOf(statusEngine, args.actingId),
                    },
                    defenseProfileOf: (v) => {
                        const m = victimIncomingModifiers(v.id);
                        return {
                            // SP-F F5: Meatshield defense-substitution (approximation) — see the
                            // substitutedDefenceFor doc comment above for the full rule.
                            defence: substitutedDefenceFor(v, v.stats.defence),
                            // B1/PR7b: per-victim defense-debuff sourcing (was hardcoded 0).
                            // Direction-agnostic — v.id keys the victim's own enemy-debuff store
                            // regardless of side.
                            defenceModifierPct: m.enemyDefenseModifier,
                            // B1/PR7b + D-PR12: per-victim incoming-damage modifier; combines
                            // enemy-debuff (Out. Damage Up) AND victim's own self-buffs (Inc. Damage
                            // Down/Up). Attacker-sourced scalars (outgoing buff, pen) stay attacker-fixed.
                            incomingDamageModifierPct: m.incomingDamageModifier,
                            affinity: v.affinity ?? 'antimatter',
                            // Sub-project I, PR I2: this footprint victim's own enemy-status-gated
                            // outgoing-modifier delta vs the attacker-fixed positionalScalars term.
                            outgoingDamageDeltaPct: perVictimOutgoingDeltaPct(
                                args.perVictimOutgoing,
                                args.preTurnVictimStatus,
                                v
                            ),
                            // SP-F F4: this victim's 'Defensive Affinity Override' (Isha/Nayra) forces
                            // the incoming attacker to affinity DISADVANTAGE against it. Detected per
                            // victim (anchor AND covered) via the victim's own self-buff store — the
                            // positional counterpart to playerTurn's `victimHasDefensiveOverride`.
                            forceAffinityDisadvantage: selfBuffNamesForOwners(statusEngine, [
                                v.id,
                            ]).includes('Defensive Affinity Override'),
                        };
                    },
                    applyToVictim: args.applyToVictim,
                    // Pure ACCUMULATOR (not a bus emit): record per-victim damage into the
                    // per-round map so the RoundData row can expose perTargetDamage. Identical
                    // across all three sites (focus / team / enemy), so it lives here.
                    // §4.5 NOTE: the Stasis break is NOT wired here. It fires via `onHitBreakStasis`
                    // inside runPlayerTurn (BEFORE the ability timed-debuff loop) so a Stasis
                    // re-application from the same attack's debuff ability is not inadvertently
                    // removed. The break fires for the resolved `targetId` (the selected victim);
                    // AoE footprint victims are a future Task-3 follow-up.
                    emitHit: (victim, damage) => {
                        roundPerTargetDamage.set(
                            victim.id,
                            (roundPerTargetDamage.get(victim.id) ?? 0) + damage
                        );
                        // SP-F F1: args.actingId (closed over from drivePositionalApply's
                        // caller) is the firing attacker for every footprint victim (anchor AND
                        // covered) this hit landed on.
                        creditDealt(args.actingId, victim.id, damage);
                    },
                    // E2: forward the per-direction leech hook (unsupplied by all current callers).
                    onVictimResolved: args.onVictimResolved,
                    // Per-victim crit: forward the firing turn's per-victim crit resolver.
                    rollVictimCrit: args.rollVictimCrit,
                    // D-PR3: victim-side incoming %-reduction, per footprint victim per sub-hit. Shared
                    // across all three sites (focus / walked-team / enemy) since drivePositionalApply
                    // makes ONE applyPositionalDamage call. incomingReductionForHit returns 0 for actors
                    // with no incoming-reduction ability → byte-identical when no such equipment exists.
                    incomingReductionFor: (victim, didCrit) => {
                        const equip = incomingReductionForHit(incomingAbilitiesOf(victim.id), {
                            didCrit,
                            attackerStealthed: isStealthed(args.actingId),
                            victimStealthed: isStealthed(victim.id),
                            victimStasised: isStasised(victim.id),
                            hitIndexThisRound: 0, // unused by reduction (only block reads it)
                            attackerHasDot: attackerHasDot(args.actingId),
                            victimHasBarrierRecharging: hasBarrierRecharging(victim.id),
                            victimHasShield: hasShield(victim.id),
                            selfHpPct: selfHpPctOf(victim.id),
                            attackerTauntedOrProvoked: attackerTauntedOrProvoked(args.actingId),
                        });
                        if (!didCrit) return equip;
                        // F3 crit-conditional pre-fight damage modifiers, gated per sub-hit on
                        // didCrit — the SAME crit-family mechanism as the equip reduction above
                        // (a hit that crits sees the extra reduction on its whole damage).
                        // SIGN CONVENTION: this channel is a REDUCTION (positive = less damage),
                        // while the leader data is benefit/penalty-phrased pct points:
                        //   victim incomingCritDamage  -10 → takes 10% smaller crits → +10 reduction;
                        //   attacker outgoingCritDamage -10 (Negotiator III on enemies) → its crits
                        //   deal 10% less → +10 reduction; positive values invert symmetrically.
                        // Hence both terms are NEGATED. Absent → 0 → byte-identical.
                        const victimCritTerm = -(victim.preFight?.incomingCritDamage ?? 0);
                        const attackerCritTerm = -(
                            allActorsById.get(args.actingId)?.preFight?.outgoingCritDamage ?? 0
                        );
                        return equip + victimCritTerm + attackerCritTerm;
                    },
                    // D-PR4: attacker-side outgoing amplification (Menace/Giant Slayer), per footprint
                    // victim per sub-hit. outgoingAmplificationForHit returns 0 for attackers with no
                    // outgoing-amplification ability → byte-identical when no such equipment exists.
                    outgoingAmplificationFor: (victim, didCrit) => {
                        // Fast path: skip the per-victim effectiveStatsOf folds when the attacker has no
                        // outgoing-amplification ability (the overwhelmingly common case) — matches the
                        // aggregate path's `ampAbilities.length > 0` guard. Byte-identical (returns 0).
                        const outs = outgoingAbilitiesOf(args.actingId);
                        if (outs.length === 0) return 0;
                        const attacker = allActorsById.get(args.actingId);
                        if (!attacker) return 0;
                        return outgoingAmplificationForHit(
                            outs,
                            {
                                didCrit,
                                targetHigherAttack:
                                    effectiveStatsOf(statusEngine, selfBuffLookup, victim).attack >
                                    effectiveStatsOf(statusEngine, selfBuffLookup, attacker).attack,
                            },
                            (abilityId, chance) =>
                                rollRateGate(
                                    procChanceGates,
                                    `${args.actingId}:${abilityId}`,
                                    chance
                                )
                        );
                    },
                });
            } finally {
                deferReflectLogs = false;
            }
        };

        // ── Deferred ability-performed emit helper ────────────────────────────────────
        // Extracted from the four structurally identical bus.emit sites (focus positional,
        // walked-team positional, enemy positional, enemy 0-damage fallback). The caller
        // supplies the per-victim crit aggregate (anyCrit / critPairs) — or the anchor-based
        // fallback values for the 0-damage path — so each site only passes what it knows.
        const emitDeferredAbilityPerformed = (
            dap: NonNullable<PlayerTurnResult['deferredAbilityPerformed']>,
            didCrit: boolean,
            critHits: number,
            // The DISTINCT enemies this cast critically hit (positionalApply's per-victim crit
            // identity). Carried on the event so an `on-ally-crit` reactive can route "that enemy"
            // to the enemies actually crit rather than the cast's SELECTED anchor (which may not
            // have crit at all in an AoE). Empty on the 0-damage fallback path (no apply ran).
            critVictimIds: string[]
        ) => {
            bus.emit({
                type: 'ability-performed',
                actorId: dap.actorId,
                targetId: dap.targetId,
                round: dap.round,
                abilityType: 'damage',
                damage: dap.damage,
                didCrit,
                ...(critHits > 0 ? { critHits } : {}),
                ...(critVictimIds.length > 0 ? { critVictimIds } : {}),
                didHit: true,
            });
            // Task 3: the attack entry now exists — drain any reflect rows buffered during this
            // cast's per-victim apply so buildCombatLog nests them UNDER this attack (not a
            // preceding charge/buff entry in the attacker's turn). No-op when none buffered.
            flushReflectLogs();
        };

        // ── Unified per-actor turn resolvers (bySide unification PR6a) ──────────────
        // Resolve the per-actor runtime / parsed target / parsed pattern uniformly so the
        // three runPlayerTurn sites stop hard-coding their own lookups. Each reproduces the
        // exact value its site used before — byte-identical.
        const runtimeFor = (a: CombatActor): PlayerActorRuntime => {
            if (a.side === 'enemy') return enemyPlayerRuntimeByActorId.get(a.id)!;
            if (a.kind === 'attacker') return attackerRuntime;
            return teamRuntimeById.get(a.id)!;
        };
        const parsedTargetFor = (a: CombatActor): ParsedTarget | undefined => {
            if (a.side === 'enemy') return enemyTargetById.get(a.id);
            if (a.kind === 'attacker') return input.target;
            return teamTargetById.get(a.id);
        };
        const parsedPatternFor = (a: CombatActor): ParsedPattern | undefined => {
            if (a.side === 'enemy') return enemyPatternById.get(a.id);
            if (a.kind === 'attacker') return input.pattern;
            return teamPatternById.get(a.id);
        };

        const parsedChargedPatternFor = (a: CombatActor): ParsedPattern | undefined => {
            if (a.side === 'enemy') return enemyChargedPatternById.get(a.id);
            if (a.kind === 'attacker') return input.chargedPattern ?? input.pattern;
            return teamChargedPatternById.get(a.id);
        };

        // SP-F F5: the charged-skill TARGET-selection axis, mirroring parsedChargedPatternFor's
        // contract exactly (falls back to the active target when unset). Together with
        // parsedChargedPatternFor this drives BOTH the damage footprint AND target selection on
        // a charge-firing turn (willFireChargedFor below) at all three damage cast sites.
        const parsedChargedTargetFor = (a: CombatActor): ParsedTarget | undefined => {
            if (a.side === 'enemy') return enemyChargedTargetById.get(a.id);
            if (a.kind === 'attacker') return input.chargedTarget ?? input.target;
            return teamChargedTargetById.get(a.id);
        };

        // SP-F F5: predict whether THIS actor's turn will fire its CHARGED skill, using the
        // EXACT same predicate as runPlayerTurn's own action decision (playerTurn.ts:~1044 —
        // `hasChargedSkill && actor.charges >= chargeCount`). Safe to read here, BEFORE
        // runPlayerTurn is called: advanceChargeCadence (which consumes/resets the charge) runs
        // INSIDE runPlayerTurn, AFTER the decision, so the actor.charges value visible at each
        // engine cast site (before it calls runPlayerTurn) is the SAME value the decision reads.
        // Drives the charge-aware pattern/target resolution below at all three damage cast sites
        // + selectTurnTarget + the buildTurnArgs AoE-purge footprint.
        const willFireChargedFor = (a: CombatActor): boolean =>
            runtimeFor(a).hasChargedSkill && a.charges >= a.chargeCount;

        const sameSideLivingFor = (a: CombatActor): CombatActor[] =>
            actorsBySide(a.side).filter((x) => x.currentHp > 0);

        // ── Unified per-side turn bindings (bySide unification PR6a) ────────────────
        // Per-side values the three runPlayerTurn sites diverge on. Each reproduces the
        // exact value its site used before → byte-identical. PR6b (DONE): decline is now
        // derived inside runPlayerTurn from the struck victim's currentHp — declineFor has
        // been removed from this interface; the credit/intake & emit TAILS stay per-kind (→ PR7).
        interface TurnBindings {
            opposingRoster: CombatActor[];
            // Player side: the always-present dummy `enemy` sink. Enemy side: the heal target,
            // which can be undefined once enemy attackers no longer require one (SP-U U5 R6
            // decouple). selectTurnTarget returns `tgt: undefined` only in that enemy-side no-victim
            // case; the enemy turn then skips its attack (cadence-only), mirroring the dead-target path.
            legacyVictim: CombatActor | undefined;
            victimDefenceFor: (tgt: CombatActor) => number;
            victimMaxHpFor: (tgt: CombatActor) => number;
            enemyTypeArg: EnemyBaseClass | undefined;
            enemyBuffNamesUnion: () => string[];
            // Sub-project I, PR I5 — count (not union) of opposing actors holding Stealth.
            stealthedEnemyCount: () => number;
            healEventOnly: boolean;
            // Matches drivePositionalApply's applyToVictim param type exactly. E2: returns the
            // resolved VictimDamageOutcome (both impls wrap applyOutgoingToEnemy /
            // applyIncomingToTarget, which already surface it from E1). Epic PR12 (A): third
            // param forwards drivePositionalApply's isAnchor through to applyVictimDamage's
            // cause.isPrimaryTarget (Nosorog's reflect gate).
            applyToVictim: (
                victim: CombatActor,
                damage: number,
                isAnchor?: boolean
            ) => VictimDamageOutcome;
        }
        const playerTurnBindings: TurnBindings = {
            opposingRoster: enemyAttackerActors,
            legacyVictim: enemy,
            // SP-F F5: Meatshield defense-substitution (approximation) — see the
            // substitutedDefenceFor doc comment above for the full rule.
            victimDefenceFor: (tgt) => substitutedDefenceFor(tgt, tgt.stats.defence),
            victimMaxHpFor: (tgt) => tgt.stats.hp,
            enemyTypeArg: enemyType,
            enemyBuffNamesUnion: playerEnemyBuffNames,
            stealthedEnemyCount: playerStealthedEnemyCount,
            healEventOnly: false,
            applyToVictim: (victim, damage, isAnchor) =>
                applyOutgoingToEnemy(damage, victim, isAnchor),
        };
        const enemyTurnBindings: TurnBindings = {
            opposingRoster: allPlayerActors,
            legacyVictim: healTarget,
            // SP-F F5: Meatshield defense-substitution (approximation) — see the
            // substitutedDefenceFor doc comment above for the full rule.
            victimDefenceFor: (tgt) =>
                substitutedDefenceFor(
                    tgt,
                    lastTurnCtxByActor.get(tgt.id)?.effectiveDefence ?? baseDefenceFor(tgt.id)
                ),
            victimMaxHpFor: (tgt) => recipientMaxHp(tgt.id),
            enemyTypeArg: undefined,
            // Opposing side from the ENEMY's view = the player team, so `enemyBuffNames` here is the
            // UNION of PLAYER self-buff names (fed to the enemy's own `enemy-buff` gates). A bare
            // enemy has no such gate → inert today; computed for the full-kit enemy.
            enemyBuffNamesUnion: enemyEnemyBuffNames,
            stealthedEnemyCount: enemyStealthedEnemyCount,
            healEventOnly: true,
            // An enemy supporter running runPlayerTurn grants charges to its OWN (enemy) team via
            // bySide('enemy').grantAllyCharges (resolved in buildTurnArgs by side), NEVER the player
            // team. Likewise applyToVictim routes the firing hit as INCOMING damage to the struck
            // player actor (applyIncomingToTarget), not as a player damage row.
            applyToVictim: (victim, damage, isAnchor) =>
                applyIncomingToTarget(damage, victim, undefined, isAnchor),
        };
        const turnBindings = (side: Side): TurnBindings =>
            side === 'player' ? playerTurnBindings : enemyTurnBindings;

        // Shared per-victim skill-triggered detonation loop. Each victim hit by the cast
        // that is STILL ALIVE detonates its OWN containers (no role-scale). Bombs = full
        // shield drain/no pen; inferno+corrosion BYPASS shield. Credited to the detonating
        // actor's per-round detonation tally + roundPerTargetDamage; NOT into cumulativeDamage
        // (HP lands per-victim via applyVictimDamage). Used by the focus (player→enemy),
        // enemy (enemy→player), and walked-team (player→enemy) sites — the ONLY difference
        // between call sites is the sink + the recipe source + the per-side tb.
        const applyPerVictimDetonation = (
            recipe: DetonationRecipe,
            victims: Map<string, CombatActor>,
            sink: DamageAccountingSink,
            actorId: string,
            tb: TurnBindings
        ): void => {
            for (const victim of victims.values()) {
                if (victim.currentHp <= 0) continue; // died to the firing hit (already splashed)
                const result = detonateContainers(recipe, {
                    corrosionEntries: victim.corrosionEntries,
                    infernoEntries: victim.infernoEntries,
                    pendingBombs: victim.pendingBombs,
                    victimHp: tb.victimMaxHpFor(victim),
                });
                if (result.bomb > 0) {
                    applyVictimDamage(result.bomb, victim, sink, {
                        killerId: actorId,
                        byDirectDamage: true,
                        bombPortion: result.bomb, // full shield drain, no pen
                        shieldPenetrationPct: 0,
                    });
                    bus.emit({
                        type: 'bomb-detonated',
                        actorId,
                        victimId: victim.id,
                        // Ship-kit W7: the positional detonate caster IS the detonator (the burst
                        // is caused by this cast's detonate ability — SP-F F1: "the detonating
                        // caster (actorId) is the source-attacker").
                        detonatorId: actorId,
                        round: r,
                        stacks: result.bombStacks,
                        damage: result.bomb,
                    });
                    roundPerTargetDamage.set(
                        victim.id,
                        (roundPerTargetDamage.get(victim.id) ?? 0) + result.bomb
                    );
                    // SP-F F1: the detonating caster (actorId) is the source-attacker.
                    creditDealt(actorId, victim.id, result.bomb);
                }
                const bypass = result.inferno + result.corrosion;
                if (bypass > 0) {
                    applyVictimDamage(bypass, victim, sink, { byDirectDamage: false }); // DoT → bypass shield
                    bus.emit({
                        type: 'dot-detonated',
                        targetId: victim.id,
                        round: r,
                        damage: bypass,
                    });
                    roundPerTargetDamage.set(
                        victim.id,
                        (roundPerTargetDamage.get(victim.id) ?? 0) + bypass
                    );
                    // SP-F F1: the detonating caster (actorId) is the source-attacker — NOT
                    // whoever originally applied the ticking DoT stacks (the existing,
                    // accepted `perActorDetonation.set(actorId, …)` convention below).
                    creditDealt(actorId, victim.id, bypass);
                }
                const dealt = result.bomb + bypass;
                if (dealt > 0) {
                    perActorDetonation.set(actorId, (perActorDetonation.get(actorId) ?? 0) + dealt);
                }
            }
        };

        // SP-F F3 fix (Critical + Important): routes a FORCED bomb detonation (a caster's
        // countdown-reduce ability driving an existing PendingBomb to <=0, e.g. Lingshe) through
        // the SAME per-victim `applyVictimDamage` sink a natural countdown-0 burst uses
        // (processBombs' `creditDetonation` — see `applyPositionedTimedBurst` above). This is the
        // ONLY correct way to preserve Barrier full-damage-immunity, the Cheat-Death intercept,
        // recordDestroyed/`ship-destroyed` emission (no zombie units), and incoming-block/Lifeline
        // — all of which a hand-rolled shieldPool/currentHp debit would bypass. Credits the
        // round's detonation tally (roundPerTargetDamage + perActorDetonation) to the bomb's
        // ORIGINAL applier (`sourceId`), exactly like `applyPerVictimDetonation`/`creditDetonation`
        // above — never the forcing caster. `sink` is passed in by the CALLER (buildTurnArgs) —
        // the single shared sink (SP-U U1) since a forced detonation's victim is an arbitrary
        // opposing actor, not necessarily the bursting actor's own HP.
        const forceDetonateBombOnVictim = (
            victim: CombatActor,
            sink: DamageAccountingSink,
            sourceId: string,
            damage: number
        ): void => {
            applyVictimDamage(damage, victim, sink, {
                killerId: sourceId,
                byDirectDamage: true,
                bombPortion: damage, // full shield drain, no pen — bomb-burst precedent
                shieldPenetrationPct: 0,
            });
            roundPerTargetDamage.set(
                victim.id,
                (roundPerTargetDamage.get(victim.id) ?? 0) + damage
            );
            // SP-F F1: the bomb's ORIGINAL applier (sourceId) — never the forcing caster.
            creditDealt(sourceId, victim.id, damage);
            perActorDetonation.set(sourceId, (perActorDetonation.get(sourceId) ?? 0) + damage);
        };

        // Shared positioned timed-burst loop. A POSITIONED actor carrying timed
        // pendingBombs/pendingAccumulators (seeded by the opposing side's earlier bomb/accumulator
        // applications) bursts them at the START of its own turn — against its OWN HP — via
        // applyVictimDamage (the per-victim sink). Bombs + accumulators = full shield drain, NO
        // penetration (bomb-splash precedent). Credited to the per-round detonation tally keyed by
        // the bomb's APPLIER (sourceId, unchanged attribution) + roundPerTargetDamage on the
        // bursting actor. NEVER routed through creditDamage(actor.id,'detonation') — that feeds
        // cumulativeDamage → the focus-dummy HP overwrite → double-hit (HP already drained inside
        // applyVictimDamage). STRICT no-op (byte-identical) when the actor carries no timed
        // containers OR is not positioned vs opposingRoster — no fixture seeds actor-side timed
        // containers. Used by the enemy site (PR2: sink=sink, roster=allPlayerActors) and the
        // focus attacker + walked-team sites (PR-B: sink=sink, roster=enemyAttackerActors) — the
        // single shared sink (SP-U U1) works for both since ids are globally unique across sides.
        const applyPositionedTimedBurst = (
            actor: CombatActor,
            sink: DamageAccountingSink,
            opposingRoster: CombatActor[]
        ): void => {
            const hasTimedContainers =
                actor.pendingBombs.length > 0 || actor.pendingAccumulators.length > 0;
            if (!hasTimedContainers || !isPositional(actor.position, opposingRoster)) return;

            processBombs({
                pendingBombs: actor.pendingBombs,
                emitBombDetonated: (actorId, stacks, damage) =>
                    bus.emit({
                        type: 'bomb-detonated',
                        actorId,
                        victimId: actor.id,
                        round: r,
                        stacks,
                        damage,
                    }),
                creditDetonation: (sourceId, damage) => {
                    applyVictimDamage(damage, actor, sink, {
                        killerId: sourceId,
                        byDirectDamage: true,
                        bombPortion: damage, // full shield drain, no pen
                        shieldPenetrationPct: 0,
                    });
                    roundPerTargetDamage.set(
                        actor.id,
                        (roundPerTargetDamage.get(actor.id) ?? 0) + damage
                    );
                    // SP-F F1: the bomb's applier (sourceId) bursting on the bursting actor's own turn.
                    creditDealt(sourceId, actor.id, damage);
                    perActorDetonation.set(
                        sourceId,
                        (perActorDetonation.get(sourceId) ?? 0) + damage
                    );
                },
            });

            // Accumulator gather input: the round-global player-DIRECT sum (same expression as the
            // focus-dummy path). CORRECT for the enemy site; for the player side it is an INERT
            // placeholder — the symmetric all-enemies-direct sum is not exposed and no fixture/ability
            // applies accumulators to players. // symmetric input TBD — inert, no fixture
            const allPlayersDirect = [...roundDamage.values()].reduce((s, d) => s + d.direct, 0);
            processAccumulators({
                pendingAccumulators: actor.pendingAccumulators,
                allPlayersDirect,
                creditDetonation: (sourceId, damage) => {
                    applyVictimDamage(damage, actor, sink, {
                        killerId: sourceId,
                        byDirectDamage: true,
                        bombPortion: damage, // full shield drain, no pen (bomb-style)
                        shieldPenetrationPct: 0,
                    });
                    roundPerTargetDamage.set(
                        actor.id,
                        (roundPerTargetDamage.get(actor.id) ?? 0) + damage
                    );
                    // SP-F F1: the accumulator's applier (sourceId).
                    creditDealt(sourceId, actor.id, damage);
                    perActorDetonation.set(
                        sourceId,
                        (perActorDetonation.get(sourceId) ?? 0) + damage
                    );
                },
            });
        };

        // Unified positional target selection (bySide unification PR6a). Reproduces the
        // focus(C1)/team(C2)/enemy(C3) selection: resolve the actor's parsed target against
        // its opposing roster, else fall back to the side's legacy victim (dummy / heal target).
        // SP-F F5: on a charge-firing turn, resolve against the CHARGED target axis instead of
        // the active one (parsedChargedTargetFor falls back to the active target when unset →
        // byte-identical for every non-divergent ship).
        const selectTurnTarget = (a: CombatActor): { tgt: CombatActor | undefined } => {
            const tb = turnBindings(a.side);
            const target = willFireChargedFor(a) ? parsedChargedTargetFor(a) : parsedTargetFor(a);
            const selected =
                isPositional(a.position, tb.opposingRoster) && target
                    ? resolvePositionalTarget(
                          a.position!,
                          target,
                          tb.opposingRoster,
                          statusLookupFor(tb.opposingRoster),
                          {
                              // The static per-ship flag OR the timed, ally-granted `Rogue's
                              // Liberty` — read live here (not baked into the actor at
                              // construction) precisely because the buff can come and go
                              // mid-battle. Same treatment at the positional-apply site below,
                              // which re-resolves the anchor per hit.
                              ignoresForcedTargeting:
                                  a.ignoresForcedTargeting ||
                                  holdsRoguesLiberty(statusEngine, a.id),
                              ignoresStealth: a.ignoresStealth,
                              provokedBy: provokerOf(statusEngine, a.id),
                          }
                      )
                    : null;
            return { tgt: selected ?? tb.legacyVictim };
        };

        // Unified runPlayerTurn argument builder (bySide unification PR6a). Produces the
        // full arg object for any side, folding the per-side divergence through
        // turnBindings(side) + runtimeFor(actor). targetId / healEventOnly are present
        // ONLY for the enemy side (player sites omit both → byte-identical). The selfHpPct
        // denom is unified to runtimeFor(actor).hp (proven equal to baseHpFor(id) by
        // construction). The per-kind bookkeeping TAILS after each call stay inline.
        const buildTurnArgs = (a: CombatActor, tgt: CombatActor) => {
            const tb = turnBindings(a.side);
            const rt = runtimeFor(a);
            const maxHp = rt.hp; // unified denom (baseHpFor(id) === runtimeFor(id).hp)
            // E3 (AoE purge): footprint victim ids for an 'all-enemies' on-cast purge.
            // Computed ONLY when positional — `tgt.position != null` is the positional
            // discriminator (selectTurnTarget returns the position-less dummy/heal-target sink
            // in DPS/healing-single mode). footprintVictims is the same pure resolver the AoE
            // damage path uses; covered cells are included (status removal is uniform across the
            // footprint). Non-positional → undefined → the playerTurn purge loop falls back to
            // the single anchor → byte-identical. The purge ability gates on
            // target === 'all-enemies', so single-'enemy' purges ignore this regardless.
            // SP-F F5: charge-aware, mirroring the 3 damage cast sites — an on-cast purge fired
            // from a CHARGED cast (e.g. Lodolite) must expand its footprint from the charged
            // pattern too, not the active one. `?? ` fallback → byte-identical for every
            // non-divergent ship.
            const aoePattern = willFireChargedFor(a)
                ? parsedChargedPatternFor(a)
                : parsedPatternFor(a);
            const aoeTarget = parsedTargetFor(a); // parse-completeness guard only (not a footprint arg)
            const aoeVictimIds =
                aoePattern != null && aoeTarget != null && tgt.position != null
                    ? footprintVictims(aoePattern, tgt.position, tb.opposingRoster).map(
                          (h) => h.victim.id
                      )
                    : undefined;
            const opposingVictimById =
                tgt.position != null ? new Map(tb.opposingRoster.map((v) => [v.id, v])) : undefined;
            // I6: resolve the enemy-most-buffs selector target for an ON-CAST purge (Lodolite's
            // charged skill). mostBuffsAmong (§C2b-2, Rhodium) previously only fed the REACTIVE
            // purge path (triggers.ts's ctx.enemyWithMostBuffs, for end-of-round/on-attacked
            // triggers) — Lodolite's purge trigger is 'on-cast', which stays on THIS (castSkills)
            // path and never reaches triggers.ts. Computed fresh per turn (buff state changes
            // round to round) from THIS actor's opposing roster — same roster mostBuffsAmong's
            // other two call sites use for the reactive path. Undefined for a DPS-mode/empty
            // roster (mostBuffsAmong's own no-buffs-anywhere case) or a non-purge cast — the
            // playerTurn purge loop falls back to the anchor `targetId` in that case.
            const enemyMostBuffsId = mostBuffsAmong(tb.opposingRoster);
            return {
                runtime: rt,
                enemy: tgt,
                enemyMostBuffsId,
                // PR10 (buff steal): THIS caster's own living adjacent allies, resolved fresh
                // per turn from its own side's roster — same adjacentAllyIdsFor helper
                // 'adjacent-allies' targets use elsewhere (adjacency.ts). Team-symmetric via
                // bySide(a.side) (identical for player and enemy casters). Consumed only by a
                // buff-steal ability whose config carries grantAdjacentAllies.
                adjacentAllyIds: bySide(a.side).adjacentAllyIdsFor(a.id),
                // Ship-kit W5 Task A3: resolves the board-neighbours of an ENEMY-side anchor
                // (the resolved target `tgt`, not the caster) for the 'adjacent-enemies' /
                // 'target-and-adjacent-enemies' debuff fan-out. Reuses the same side-dispatching
                // adjacentAllyIdsFor the reactive-trigger registration (~2856) and the buff-steal
                // grant above already use — passing the target's id resolves ITS OWN side's
                // neighbours, which (since the target is always opposing this actor) are the
                // adjacent enemies, team-symmetric for free (bySide handles both directions).
                adjacentEnemyIdsFor: (anchorId: string): string[] =>
                    bySide(isEnemySide(anchorId) ? 'enemy' : 'player').adjacentAllyIdsFor(anchorId),
                // B1/PR7b: thread targetId for BOTH directions so player-applied ABILITY debuffs route
                // to the resolved victim's per-actor store (applyTimedAbilityStatus keys off targetId;
                // the aggregate ability-read timedAbilityStatuses('enemy',actor.id,targetId) follows
                // automatically). GUARDED for the player side: when selectTurnTarget fell back to the
                // dummy `enemy` sink (tgt.id === enemy.id), leave targetId unset so the __enemy__ path
                // (DPS/healing) is byte-identical. Scheduled channel stays global __enemy__ (upsertBuff
                // hardcoded). Enemy side unchanged (victim always a real actor).
                ...(a.side === 'enemy' || tgt.id !== enemy.id ? { targetId: tgt.id } : {}),
                statusEngine,
                corrosionEntries: tgt.corrosionEntries,
                infernoEntries: tgt.infernoEntries,
                genericDoTEntries: tgt.genericDoTEntries,
                pendingBombs: tgt.pendingBombs,
                pendingAccumulators: tgt.pendingAccumulators,
                enemyDefense: tb.victimDefenceFor(tgt),
                enemyHp: tb.victimMaxHpFor(tgt),
                enemyType: tb.enemyTypeArg,
                bus,
                round: r,
                grantAllyCharges: bySide(a.side).grantAllyCharges,
                removeEnemyCharges: bySide(a.side).removeEnemyCharges,
                removeChargesFrom: bySide(a.side).removeChargesFrom,
                healing: healingCtx,
                ...(tb.healEventOnly ? { healEventOnly: true } : {}),
                selfHpPct: maxHp > 0 ? (100 * Math.max(0, a.currentHp)) / maxHp : 100,
                // targetHpPct reports the HEAL TARGET's HP% (healTargetHpPctNow()), NOT the struck
                // `tgt`'s — even on the enemy positional path where `tgt` may be a different player
                // actor, this still tracks the heal target. Per-actor target-HP% is deferred to a
                // later phase; inert today (bare enemies have no `hpSubject:'target'` gate).
                targetHpPct: healTargetHpPctNow(),
                // C2b-3: was the STRUCK victim (tgt) repaired this round? Per-actor-correct
                // (unlike targetHpPct, which always reports the heal target). DPS dummy / un-
                // repaired enemy → false → byte-identical (the purge block guards on targetId).
                targetRepairedThisRound: repairedThisRound.has(tgt.id),
                enemyBuffNames: tb.enemyBuffNamesUnion(),
                // Sub-project I, PR I5: count (not union) of opposing actors holding Stealth,
                // for Selenite's "for every enemy with Stealth" count-scaling. Same per-turn
                // cadence as enemyBuffNames above; 0 in DPS mode (no enemy attackers).
                stealthedEnemyCount: tb.stealthedEnemyCount(),
                // Sub-project I, PR I1: opt-in NAMES on the resolved target for name-specific
                // `enemy-debuff` gates — SAME guard as targetId above (real/positional target
                // only). When tgt is the dummy `enemy` sink (DPS mode / no positional
                // resolution), this key is OMITTED entirely so buildRoundContext leaves
                // enemyDebuffNames undefined (the DPS-parity sentinel) and the round contexts
                // fall back to the legacy name-agnostic enemyDebuffCount path — byte-identical.
                ...(a.side === 'enemy' || tgt.id !== enemy.id
                    ? { enemyDebuffNames: enemyDebuffNamesForTarget(tgt) }
                    : {}),
                selfDebuffNames: ownerDebuffNames(a.id),
                ...(aoeVictimIds ? { aoeVictimIds } : {}),
                ...(opposingVictimById ? { opposingVictimById } : {}),
                // SP-F F3 fix: forced bomb-detonation sink (Lingshe's countdown-reduce-to-0).
                // SP-U U1: `sink` serves both directions (ids globally unique across sides), so
                // no per-side selection is needed here anymore.
                forceDetonateBomb: (victim: CombatActor, sourceId: string, damage: number) =>
                    forceDetonateBombOnVictim(victim, sink, sourceId, damage),
                // Positional detonation hint: when the engine will take the positional apply path
                // (same predicate that computes aoeVictimIds — pattern + target + position all set),
                // runPlayerTurn SKIPS the anchor detonation (no consume/credit/emit) and instead
                // returns a `positionalDetonation` recipe for the per-victim detonation loop below
                // to apply. Conditional spread → non-positional turns omit the key → byte-identical.
                //
                // ALL THREE CAST-SITES (PR1 + PR3 + PR4): the focus-turn site (PR1), the enemy-
                // attacker site (PR3), and now the WALKED-TEAM site (PR4 — `a.kind === 'team'`) each
                // consume the recipe via their own per-victim detonation loop, so all three get
                // `positional: true` (runPlayerTurn SKIPS the anchor detonation and returns the
                // recipe; detonationDamage stays 0 — the loop applies it per footprint victim). With
                // the walked-team loop now wired, every positional cast-site lands detonation per
                // footprint victim symmetrically; no cast-site silently drops the recipe.
                ...((a.id === focusActorId || a.side === 'enemy' || a.kind === 'team') &&
                aoePattern != null &&
                aoeTarget != null &&
                tgt.position != null
                    ? { positional: true }
                    : {}),
                // D-PR4: target's effective attack (for 'amplify-vs-higher-attack' eligibility) and
                // a per-(owner,ability) deterministic proc closure. Both are READ only when the
                // actor's passive slot carries an outgoing-amplification ability → byte-identical
                // for every fixture without one (rollOutgoingProc never invoked).
                targetEffectiveAttack: effectiveStatsOf(statusEngine, selfBuffLookup, tgt).attack,
                rollOutgoingProc: (abilityId: string, chance: number) =>
                    rollRateGate(procChanceGates, `${a.id}:${abilityId}`, chance),
                activePattern: parsedPatternFor(a),
                chargedPattern: parsedChargedPatternFor(a),
                sameSideLiving: sameSideLivingFor(a),
                // F3: the acting actor's pre-fight modifier baseline (outgoingDamage /
                // outgoingHeal / incomingHeal fold into its self-buff totals inside
                // runPlayerTurn). Side-agnostic — enemy attackers walk the same path.
                // Conditional spread → absent for every existing caller (byte-identical).
                ...(a.preFight ? { preFight: a.preFight } : {}),
                // Sub-project I, PR I3 (Layer 1): team-aura distribution. Union THIS actor's
                // LIVING same-side allies' `all-allies` passive modifier abilities, EXCLUDING
                // the actor's own id (its own aura is already in its own modifierAbilities —
                // no double-count) — reuses `sameSideLivingFor` (the SAME same-side-living
                // roster the support-footprint path uses; team-symmetric via `a.side`). Merged
                // into `modifierAbilities` in playerTurn.ts, so it folds into BOTH the per-turn
                // dmgStats AND (PR I2) perVictimOutgoing for free. Absent-source case → the
                // flatMap is [] → byte-identical.
                allyModifierAbilities: sameSideLivingFor(a)
                    .filter((x) => x.id !== a.id)
                    .flatMap((x) => allAlliesModifierAbilitiesById.get(x.id) ?? []),
                // Sub-project I, PR I4c: per-SOURCE breakdown of ally `all-allies` `dotDamage`-
                // channel modifier abilities (Wildfire's refit-3 team aura) — needed alongside
                // `allyModifierAbilities` above because that flat list loses PROVENANCE (which
                // ally sourced which ability), and the locked game rule requires this bonus to
                // scale by the AURA SOURCE's own crit power, never the recipient's (unlike
                // every other all-allies modifier condition, which correctly reads the
                // recipient's ctx per I3). Filters each ally's all-allies MODIFIER list down to
                // the `dotDamage` channel BEFORE computing crit power, so `effectiveStatsOf` is
                // only paid for actual aura sources (every ship without this shape → `.filter`
                // drops it → `[]`, byte-identical). `sourceCritPower` mirrors the "layers
                // 1+2+3" shape `modifierCtx.selfCritPower` uses for the ACTING actor (base +
                // scheduled/timed self-buffs) — the one difference is it omits the acting-
                // actor-only "active/gated self-ability aura" layer (playerTurn.ts's
                // `activeAbilityStatuses` component), which Wildfire's kit never uses for its
                // own crit power (docs/ship-skills.csv: Wildfire's only passives ARE this
                // dotDamage-scaling ability), so the two are equivalent for this ship.
                allyDotDamageAuraSources: sameSideLivingFor(a)
                    .filter((x) => x.id !== a.id)
                    .map((x) => ({
                        x,
                        abilities: (allAlliesModifierAbilitiesById.get(x.id) ?? []).filter(
                            (ab) =>
                                ab.config.type === 'modifier' && ab.config.channel === 'dotDamage'
                        ),
                    }))
                    .filter((entry) => entry.abilities.length > 0)
                    .map((entry) => ({
                        sourceId: entry.x.id,
                        sourceCritPower: effectiveStatsOf(statusEngine, selfBuffLookup, entry.x)
                            .critDamage,
                        abilities: entry.abilities,
                    })),
            };
        };

        // SP-U U2 (Option B): the triplicated positional-apply block, extracted ONCE. This is the
        // single largest chunk shared near-verbatim (modulo local names) by the focus, walked-team,
        // and enemy cast-sites: it drives the per-victim positional apply against the acting side's
        // opposing roster, wakes each hit victim's on-attacked reactives, breaks covered-victim
        // Stasis, and lands per-victim skill-triggered detonation. The block is ALREADY
        // tb-parameterized (tb.opposingRoster / tb.applyToVictim); the ONLY per-site divergences are
        // injected as callbacks (no `side` branch inside the helper):
        //   • onVictimResolved — the per-victim LEECH direction (Note A in task-2-report.md): the
        //     player→enemy sites proc a STANDING leech off the dealt damage; the enemy→player site
        //     procs a TAKEN leech off the damage each player victim took (+ captures the focus
        //     victim's shield-hit flag). Called at the SAME per-victim point for all three.
        //   • emitAttacked — the per-victim `attacked` emit. The player→enemy sites emit it HERE
        //     (before the per-victim detonation); the enemy site DEFERS its emit to AFTER its inline
        //     non-positional damage-taken-leech tail (its row-14 accounting, kept inline → U5) and so
        //     passes a no-op, consuming the RETURNED attackedSignals there instead.
        // Returns { critAgg, attackedSignals } so the enemy site can record enemyCritAgg (for its
        // 0-damage deferred-emit fallback) and run its deferred per-victim attacked emit. sel carries
        // the pre-call head-locals the block reads (esp. preTurnVictimStatus, which MUST be the
        // pre-runPlayerTurn snapshot — never recomputed post-hoc).
        /**
         * Intra-cast clause order: apply the landings this cast held back because their clause
         * follows its damage clause (playerTurn's `deferredEnemyApplications`). Called at each of
         * the three turn sites once that turn's damage has landed — and unconditionally, so a cast
         * that resolved non-positionally, whiffed, or killed its target still applies its debuff
         * rather than dropping it. Runs BEFORE the actor's Post-Turn decrement, so the status keeps
         * its normal window; and before the turn's intent drain, so reactions to the
         * `debuff-applied` still resolve within this turn (just after the damage, as the rule says).
         *
         * Empties the list, making a second call a no-op — the sites are allowed to overlap.
         * Team-symmetric: one helper, all three sites (focus / walked team / enemy).
         */
        const flushDeferredEnemyApplications = (
            deferred: PlayerTurnResult['deferredEnemyApplications']
        ): void => {
            if (deferred.length === 0) return;
            for (const apply of deferred.splice(0, deferred.length)) apply();
        };
        interface PositionalTurnSel {
            tgt: CombatActor;
            pattern: ParsedPattern;
            target: ParsedTarget;
            preTurnVictimStatus: Map<string, PreTurnVictimStatusSnapshot> | undefined;
            scalars: AttackerDamageScalars;
            hitCrits: boolean[];
            perVictimOutgoing: PlayerTurnResult['perVictimOutgoing'];
            rollVictimCrit?: (victimAffinity: AffinityName) => boolean;
            deferredAbilityPerformed: PlayerTurnResult['deferredAbilityPerformed'];
            positionalDetonation: DetonationRecipe | undefined;
        }
        type PositionalAttackedSignals = Map<
            string,
            { damage: number; shieldWasHit: boolean; hitOutcomes: boolean[] }
        >;
        const drivePositionalTurnApply = (
            actor: CombatActor,
            tb: TurnBindings,
            sel: PositionalTurnSel,
            onVictimResolved: (
                victim: CombatActor,
                damage: number,
                outcome: VictimDamageOutcome,
                didCrit: boolean
            ) => void,
            emitAttacked: (attackedSignals: PositionalAttackedSignals) => void
        ): {
            critAgg: { anyCrit: boolean; critPairs: number; critVictimIds: string[] };
            attackedSignals: PositionalAttackedSignals;
        } => {
            // Aggregate EACH footprint victim's per-attack damage + OR its shield-hit flag across the
            // attack's hits so the post-apply emit wakes EVERY hit victim's on-attacked reactives
            // (counters + self-repairs/defensive buffs), not just the anchor. Keyed by victim.id.
            const attackedSignals: PositionalAttackedSignals = new Map();
            // Per-footprint Stasis-break: collect EVERY covered footprint victim (≠ anchor) stasised
            // at hit time so its Stasis is broken too — the anchor break is handled at the call site.
            // Covered victims have no same-turn re-apply vector → unconditional break.
            const coveredStasisVictims = new Set<string>();
            // Collect EVERY footprint victim hit by this cast's firing damage (unique by id) so each
            // can detonate its OWN containers after the firing hits land.
            const detonationTargets = new Map<string, CombatActor>();
            const critAgg = drivePositionalApply({
                scalars: sel.scalars,
                hitCrits: sel.hitCrits,
                pattern: sel.pattern,
                target: sel.target,
                actingPosition: actor.position!,
                // Static per-ship flag OR the timed `Rogue's Liberty` (see selectTurnTarget).
                // Both reads are needed: selectTurnTarget picks the cast's `tgt`, while this loop
                // re-resolves the anchor for every hit — a buff read at only one of them would let
                // the two disagree about which victim the cast is actually pointed at.
                ignoresForcedTargeting:
                    actor.ignoresForcedTargeting || holdsRoguesLiberty(statusEngine, actor.id),
                ignoresStealth: actor.ignoresStealth,
                actingId: actor.id,
                opposingLiving: tb.opposingRoster,
                applyToVictim: tb.applyToVictim,
                perVictimOutgoing: sel.perVictimOutgoing,
                preTurnVictimStatus: sel.preTurnVictimStatus,
                // Per-victim crit: each covered footprint victim rolls at ITS own affinity-capped
                // rate against this attacker. sel.rollVictimCrit is defined for every positional turn
                // (turn.rollVictimCrit is a required PlayerTurnResult field); the conditional wrap
                // reproduces the enemy site's defensive `? … : undefined` shape exactly.
                rollVictimCrit: sel.rollVictimCrit
                    ? (v) => sel.rollVictimCrit!(v.affinity ?? 'antimatter')
                    : undefined,
                onVictimResolved: (victim, damage, outcome, didCrit) => {
                    // Injected per-site leech direction (Note A): standing (player→enemy) vs taken
                    // (enemy→player, which also captures the focus victim's shield-hit flag).
                    onVictimResolved(victim, damage, outcome, didCrit);
                    detonationTargets.set(victim.id, victim);
                    // A hit whose FULL post-block damage was converted into a DoT (Voron/Orel's
                    // transform-incoming-to-dot) dealt NO direct damage — it is not a direct hit,
                    // so it must NOT contribute an `attacked` signal. Otherwise "directly damaged"
                    // reactions (Cultivator's on-ally-attacked repair, counters, Tenacity) fire off
                    // a hit that never landed. The transform is all-or-nothing, so transformedToDot
                    // > 0 ⟺ zero direct damage. When Voron is stasised/disabled the transform never
                    // runs (transformedToDot stays 0) and the hit signals normally — no special case
                    // needed here. Detonation / stasis-break bookkeeping above stays unconditional
                    // (the victim WAS targeted).
                    const fullyTransformedToDot = (outcome.transformedToDot ?? 0) > 0;
                    if (!fullyTransformedToDot) {
                        const prev = attackedSignals.get(victim.id) ?? {
                            damage: 0,
                            shieldWasHit: false,
                            hitOutcomes: [],
                        };
                        prev.damage += damage;
                        prev.shieldWasHit =
                            prev.shieldWasHit ||
                            (!outcome.barriered &&
                                !outcome.converted &&
                                outcome.shieldBefore > 0 &&
                                outcome.hpDamage < damage);
                        prev.hitOutcomes.push(didCrit);
                        attackedSignals.set(victim.id, prev);
                    }
                    // Record covered (non-anchor) victims stasised at hit time for the post-apply break.
                    if (
                        !actor.doesntBreakStasis &&
                        victim.id !== sel.tgt.id &&
                        isStasised(victim.id)
                    ) {
                        coveredStasisVictims.add(victim.id);
                    }
                },
            });
            // Emit this attacker's ONE aggregate ability-performed AFTER the per-victim apply, but
            // BEFORE the per-victim `attacked` emits, with the TRUE per-victim crit signal. Present
            // ⟺ this turn resolved positionally (same suppression condition).
            if (sel.deferredAbilityPerformed) {
                emitDeferredAbilityPerformed(
                    sel.deferredAbilityPerformed,
                    critAgg.anyCrit,
                    critAgg.critPairs,
                    critAgg.critVictimIds
                );
            }
            // Set the DEFERRED Stasis break for every covered victim (unconditional — covered victims
            // have no same-turn re-apply vector). The victim's own skip branch consumes it next turn.
            for (const victimId of coveredStasisVictims) {
                stasisBreakPending.set(victimId, true);
            }
            // Player→enemy sites emit the per-victim `attacked` HERE (before detonation); the enemy
            // site passes a no-op and emits from the RETURNED attackedSignals in its inline tail.
            emitAttacked(attackedSignals);
            // Per-victim skill-triggered detonation. Each victim HIT by this cast that is STILL ALIVE
            // detonates its OWN containers (no role-scale — full stored stacks). Bombs = full shield
            // drain/no pen; inferno+corrosion BYPASS shield (DoT semantics). Credited to the
            // detonating actor's per-round detonation tally + roundPerTargetDamage; NOT into
            // cumulativeDamage (HP lands per-victim via applyVictimDamage). `sink` serves both
            // directions (SP-U U1). recipe present only when a detonate-dot ability fired.
            const recipe = sel.positionalDetonation;
            if (recipe && recipe.dets.length > 0) {
                applyPerVictimDetonation(recipe, detonationTargets, sink, actor.id, tb);
            }
            return { critAgg, attackedSignals };
        };

        // H1 Task 6: rebind the per-round shield-granted accumulator EVERY round (not gated on
        // healTarget) so DPS-mode and team runs reset it too — grantShieldToTarget can fire in
        // any mode, and a stale carry-over would over-report `granted`.
        perActorShieldGranted = new Map<string, number>();
        // Reflect gear set (Task 5): rebind the per-round reflected-thorns accumulator EVERY round
        // (mirrors perActorShieldGranted), so a stale carry-over never over-reports reflected damage.
        perActorReflected = new Map<string, number>();
        // Bomb-splash-on-death: rebind every round (like perActorShieldGranted) so a stale
        // carry-over never over-reports splash. Written only by the death-seam splash block.
        perActorSplash = new Map<string, number>();
        perActorDetonation = new Map<string, number>();
        perActorDot = new Map();
        if (healTarget) {
            currentRoundHealing = new Map<string, ActorHealing>();
            const targetMaxHp = recipientMaxHp(healTarget.id);
            // Clamp to [0, 100]: a shrunk effectiveMaxHp (expired max-HP buff) can leave
            // currentHp > targetMaxHp, pushing the ratio above 100 — cap it so the reported
            // start % never exceeds full.
            targetHpPctStart =
                targetMaxHp > 0
                    ? Math.min(100, Math.max(0, 100 * (healTarget.currentHp / targetMaxHp)))
                    : 0;
            targetShieldStart = healTarget.shieldPool;
        }

        // Per-focus-turn results; the post-round assembly reads the LAST one for the
        // row's attacker fields. Numeric damage totals are summed across all turns.
        const focusTurns: PlayerTurnResult[] = [];
        // Team-turn resisted enemy applications recorded BEFORE any attacker turn this
        // round (faster team actors). Drained into the FIRST subsequent attacker turn's
        // resistedEnemyDebuffs head; team turns AFTER an attacker turn append to the LAST
        // attacker turn's list (same observable order as the old attackerHasActed +
        // teamResistedEnemyDebuffs staging).
        const pendingResisted: ActiveBuff[] = [];

        // Dead-target turn skip (healing mode): a destroyed heal target does not act. We skip
        // the ENTIRE turn body for that actor — including turn-started/turn-ended emissions and
        // the post-turn status decrement (a dead ship has no live status to tick). Enemy attacker
        // turns are NOT skipped (they keep banking charges and the dead-target damage path returns
        // 0). When the dead actor IS the focus actor a round would otherwise produce ZERO focus
        // turns and the focusTurns.length throw below would fire — so we synthesize a minimal dead
        // focus-turn result (no sourceFired: it did not act) carrying the entering-round
        // enemyHpPct and a zeroed/last-known ctx, just enough for row assembly.
        //
        // Called at TWO sites with identical behavior: (a) the top-of-turn guard (target already
        // dead entering its turn), and (b) immediately after the heal target's OWN turn-start DoT
        // tick (a lethal Corrosion/Inferno tick kills it mid-turn → it must not fall through and
        // act). Returns true when the actor is the dead heal target and the caller must `continue`.
        const handleDeadTargetSkip = (actor: CombatActor): boolean => {
            if (!(healTarget && actor.id === healTarget.id && healTarget.currentHp <= 0)) {
                return false;
            }
            // A destroyed heal target shows no buffs this round.
            healTargetBuffs = [];
            if (actor.id === focusActorId) {
                // PR6b: read the dummy sink's live currentHp instead of the scalar (identical
                // value — the sink update at ~3771 keeps enemy.currentHp == enemyHp - cumulative).
                pushSynthesizedFocusSkipTurn();
            }
            return true;
        };

        // E5 §4.4: the synthesized no-action focus turn pushed when the focus skips its
        // turn (dead heal-target OR stasised). Extracted from the two byte-identical sites
        // (handleDeadTargetSkip + the stasis gate) so the shape cannot drift.
        const pushSynthesizedFocusSkipTurn = (): void => {
            const enemyHpDecline = Math.max(0, enemyHp - enemy.currentHp);
            const enemyHpPct =
                enemyHp > 0 ? Math.max(0, 100 * (1 - enemyHpDecline / enemyHp)) : 100;
            const lastKnownCtx = lastTurnCtxByActor.get(focusActorId);
            focusTurns.push({
                action: 'active',
                roundCrit: false,
                hitCrits: [],
                enemyHpPct,
                dotsConfig: [],
                dotsLanded: true,
                activeSelfBuffs: [],
                landedEnemyDebuffs: [],
                inflictedEnemyDebuffs: [],
                resistedEnemyDebuffs: [],
                // A skipped turn casts nothing, so it holds back nothing (clause order).
                deferredEnemyApplications: [],
                directDamage: 0,
                secondaryDamage: 0,
                conditionalDamage: 0,
                detonationDamage: 0,
                extraActionGrants: [],
                // Synthesized skip turn fires no positional attack (no positionalScalars) → this
                // resolver is never invoked; a no-op keeps the required-field shape.
                rollVictimCrit: () => false,
                turnCtx: lastKnownCtx ?? {
                    effectiveAttack: 0,
                    dotMult: 1,
                    affinityMult: 1,
                    effectiveDefence: 0,
                    effectiveMaxHp: 0,
                    outgoingHealPct: 0,
                    incomingHealPct: 0,
                },
            });
        };

        // Per-round extra-action bookkeeping: oncePerRound abilities fire at most once
        // per actor per round (key `${actorId}:${abilityId}`); total insertions are
        // backstopped. A grant bumps the granter's PENDING count by 1 — the selection
        // loop then re-picks it at its LIVE speed-rank among the remaining unacted actors
        // (game-verified: re-added to the turn order; acts immediately only when fastest
        // remaining). The selection comparator (orderByTurnPriority via selectNextBySpeed)
        // owns the speed-position + equal-speed tiebreak, so there is no splice to position.
        const extraActionFired = new Set<string>();
        let extraTurnInsertions = 0;
        const processExtraActionGrants = (
            granter: CombatActor,
            grants: ExtraActionGrant[]
        ): void => {
            for (const g of grants) {
                const key = `${granter.id}:${g.abilityId}`;
                if (g.oncePerRound && extraActionFired.has(key)) continue;
                if (g.oncePerRound) extraActionFired.add(key);
                extraTurnInsertions += 1;
                if (extraTurnInsertions > MAX_EXTRA_TURNS_PER_ROUND) {
                    throw new Error(
                        `combat round ${r}: extra-action insertions exceeded ` +
                            `MAX_EXTRA_TURNS_PER_ROUND (${MAX_EXTRA_TURNS_PER_ROUND}) — ` +
                            `an extra-action grant is re-firing without bound`
                    );
                }
                // Route by pool (Task 4): end-of-round grants (Harvester) bump the end-of-round
                // pool, drained after the normal speed pool; default grants stay speed-positioned
                // in the normal pool. The oncePerRound gate + MAX_EXTRA_TURNS_PER_ROUND backstop
                // above apply to BOTH pools.
                if (g.endOfRound) {
                    endOfRoundPending.set(granter.id, endOfRoundPendingOf(granter.id) + 1);
                } else {
                    pending.set(granter.id, pendingOf(granter.id) + 1);
                }
            }
        };

        // `inTurnLoop` is true only while the selection loop body walks. The pre-loop and
        // post-round drains see inTurnLoop=false → Path B (buffer).
        let inTurnLoop = false;

        // Reactive extra-action bridge (Task 10). PATH A (inTurnLoop): bump the granter's pending
        // count so the selection loop re-picks it at its live speed-rank among the remaining
        // actors (same machinery the attacker/team turn branches use), so a during-turn death
        // grants a SAME-round extra turn. PATH B (no live loop — post-round enemy death): buffer
        // onto pendingExtraActions; the next round's pool build flushes it. Since bySide PR2 the
        // granter may be a PLAYER or ENEMY actor (the ship whose death-passive fired), resolved
        // from the combined allActorsById roster; a missing id is impossible (every reactive owner
        // id is in allActors) → skip defensively rather than throw mid-drain.
        const grantExtraAction = (
            granterId: string,
            abilityId: string,
            oncePerRound: boolean,
            endOfRound: boolean
        ): void => {
            const granter = allActorsById.get(granterId);
            if (!granter) return;
            if (inTurnLoop) {
                processExtraActionGrants(granter, [{ abilityId, oncePerRound, endOfRound }]);
            } else {
                pendingExtraActions.push({ granterId, abilityId, oncePerRound, endOfRound });
            }
        };

        // Drain the intent queue FIFO. Listeners may have enqueued during the emission
        // that triggered this drain; executed intents may emit events (chaining) that
        // enqueue MORE — those form the next generation. A generation is the batch
        // present when a drain pass starts; the loop processes one generation per pass
        // and stops when the queue is empty. MAX_INTENT_GENERATIONS converts a
        // pathological self-feeding loop into a thrown error rather than a hang.
        // Side-parameterized drain (enemy-team PR1). The four side-specific fields are
        // `runtimes`, `recipientIds` (→ executeIntent ctx.playerIds), `isLowestSpeedAllyFor`,
        // and `grantAllyCharges`; everything else is shared and moved verbatim. The player
        // drain (`drainIntentsFor('player')`) and the enemy drain (`drainIntentsFor('enemy')`)
        // below each bind their own queue + sideCtx, so the player path is behaviourally unchanged.
        const drainQueue = (queue: Intent[], sideCtx: ReactiveSideCtx): void => {
            let generation = 0;
            while (queue.length > 0) {
                if (++generation > MAX_INTENT_GENERATIONS) {
                    throw new Error(
                        `combat round ${r}: intent queue exceeded MAX_INTENT_GENERATIONS ` +
                            `(${MAX_INTENT_GENERATIONS}) — a reactive trigger is self-amplifying without bound`
                    );
                }
                // Snapshot this generation's batch; new enqueues during execution run next pass.
                const batch = queue.splice(0, queue.length);
                for (const intent of batch) {
                    // §4.4 TURN-BLOCK reactive suppression (B3 / D-PR13): a turn-blocked unit's reactives are
                    // FULLY locked out. Drop every queued intent whose OWNER is currently turn-blocked (Stasis OR
                    // Disable) — on-attacked, on-ally-attacked, on-crit, on-enemy-destroyed, AND start-of-round
                    // self-buffs (Chakara via round-started) all carry intent.ownerId, so this ONE filter covers
                    // every reactive type for BOTH sides (drainIntentsFor('player') and drainIntentsFor('enemy') share this drainQueue).
                    // Filtered at the DRAIN, before executeIntent. Listeners only ENQUEUE (pure), so dropping an
                    // intent leaves NO partial state. Incoming effects (damage/heals/ally buffs/DoT ticks) are
                    // UNTOUCHED — only the turn-blocked unit's OWN outgoing intents drop.
                    // NOTE: Stasis-only sites (break-on-hit, damage-immunity) intentionally keep using isStasised
                    // directly — Disable never breaks and does not grant immunity.
                    if (isTurnBlocked(intent.ownerId)) continue;
                    executeIntent(intent, {
                        round: r,
                        enemy,
                        enemyId: enemy.id,
                        statusEngine,
                        bus,
                        // Combat-log attribution: the actor whose turn is active when this
                        // reactive intent drains. Set per turn (actingActorId); undefined for a
                        // round-1 start-of-round reactive or a post-round death-drain reaction
                        // (no turn active). The executor's stamping bus brands every reactive
                        // emission with this so a later builder nests the reaction under the
                        // triggering turn, not the reactor's own turn.
                        duringTurnOf: actingActorId,
                        corrosionEntries,
                        infernoEntries,
                        genericDoTEntries,
                        pendingBombs,
                        runtimes: sideCtx.runtimes,
                        grantAllyCharges: sideCtx.grantAllyCharges,
                        removeEnemyCharges: sideCtx.removeEnemyCharges,
                        removeChargesFrom: sideCtx.removeChargesFrom,
                        grantExtraAction,
                        playerIds: sideCtx.recipientIds,
                        // Task 7: drain `enemy-buff` gates read the union of enemy attackers'
                        // self-buffs (names only). Empty in DPS mode → byte-identical.
                        enemyAttackerIds: enemyAttackerActorIds,
                        isActorAlive,
                        selfShieldFullFor: isSelfShieldFull,
                        // SP-F F4: name map for the live `ally-on-team` roster check. Empty in DPS
                        // (no ship names supplied) → buildDrainContext leaves allyTeamNames
                        // undefined → assume-met fallback (byte-identical).
                        nameByActorId: nameByActorId.size > 0 ? nameByActorId : undefined,
                        lastTurnCtxByActor,
                        reactiveDealtByOwner,
                        enemyType,
                        enemyHp,
                        // Drain-time HP% includes this round's damage SO FAR (the round
                        // accumulators below are folded into cumulativeDamage only at
                        // post-round assembly): a follow-up reacts to the state its trigger
                        // created — e.g. an on-crit follow-up gated on enemy HP% sees the
                        // enemy's HP AFTER the attacker's hit that just crit. This differs
                        // from the attacker turn's own gates, which deliberately use the
                        // entering-round HP (pre-existing convention, unchanged).
                        // Map-sum: enemy-HP decline is focus + team cumulative + this round's
                        // map totals across ALL actors (the drain reacts to the enemy's true
                        // remaining HP, not just the focus actor's contribution).
                        cumulativeDamage:
                            cumulativeDamage +
                            cumulativeTeamDamage +
                            [...roundDamage.values()].reduce(
                                (s, d) => s + d.direct + d.corrosion + d.inferno + d.detonation,
                                0
                            ),
                        // Bomb damagePerStack/affinity now resolve per OWNER inside the executor
                        // (lastTurnCtxByActor.get(intent.ownerId)) — no global effectiveAttack/
                        // affinityMult here. The focus actor's entry resolves identically to the
                        // pre-Task-6 path (its lastTurnCtx feeds the same value).
                        recordResisted: (resisted) => {
                            const lastTurn = focusTurns[focusTurns.length - 1];
                            // After an attacker turn this round → append to its resisted list;
                            // before any → stage into pendingResisted (drained into the next
                            // attacker turn's head), mirroring the Task-2 team-resist staging.
                            if (lastTurn) lastTurn.resistedEnemyDebuffs.push(resisted);
                            else pendingResisted.push(resisted);
                        },
                        // PR4b: reactive direct damage (Grif/FrontLine/Judge/Chakara/Incinerator/
                        // Rhodium) — full mitigated/crit walk, credited via the single credit
                        // point (creditDamage, inside applyReactiveDamage) so leeches still see it.
                        applyReactiveDamage,
                        // Releases the consequence twins applyReactiveDamage buffered, called by
                        // the executor right after the proc's own attack row is emitted.
                        flushConsequenceLogs,
                        applyCounterAttack,
                        counterFiredThisTurn,
                        reactionFiredThisAttack,
                        // Healing mode only — the SAME shared ctx the player turns use, so a
                        // reactive heal/shield/cleanse credits the same per-round buckets and
                        // mutates the same live target. Undefined in DPS mode → the executor's
                        // heal/shield/cleanse branches stay inert (goldens byte-identical).
                        healing: healingCtx,
                        // Combat-lifetime once-per-battle guard (Task 8): a flagged reactive
                        // repair (Yazid) fires at most once across the whole combat.
                        oncePerCombatFired,
                        // Combat-lifetime per-(owner, ability, source) event counter for
                        // everyNthEvent gates (Zosimos "every second repair → remove charge").
                        repairCountBySource,
                        // Combat-lifetime proc-chance gates (D-PR1): equipment reactive procs
                        // that carry a procChance fire at their stated rate via this accumulator.
                        procChanceGates,
                        // Per-attack proc verdict cache (Insidiousness): one roll per attack,
                        // replayed for every debuff event that attack inflicts.
                        procDecisionThisAttack,
                        // Phase 4c PR 6: live lowest-speed-ally gate. UNCONDITIONAL (unlike the
                        // healing-only selfHpPctFor spread) — in DPS mode the set is {attacker}, so
                        // the lone attacker resolves true and DPS gating stays byte-identical.
                        isLowestSpeedAllyFor: sideCtx.isLowestSpeedAllyFor,
                        // Phase 4c PR 1 Task 6 / bySide PR3 Task 2: live self-HP% for drain-time
                        // hp-threshold gates, now sourced per-side from sideCtx.selfHpPctFor.
                        // Player side: heal-target current/max HP (every other id → 100); DPS mode
                        // has no closure (undefined → buildDrainContext defaults to 100). Enemy
                        // side: 100 for every owner until PR5. byte-identical to the old inline spread.
                        selfHpPctFor: sideCtx.selfHpPctFor,
                        enemyWithMostBuffs: sideCtx.enemyWithMostBuffs,
                        // Task A: resolve any actor's RAW affinity (combat-wide map, both sides) so
                        // the reactive 'apply'-debuff branch lands vs the ACTUAL target's affinity
                        // (e.g. Martyrdom Disable onto the real killer) rather than the applier's
                        // precomputed-vs-representative static disadvantage flag.
                        affinityOf: (id) => allActorsById.get(id)?.affinity,
                        // SP-E, Task E4: resolve any actor (either side) by id — the convert-dot
                        // executor uses this to find the ACTUAL victim of an ally's DoT
                        // application (eventCtx.victimId) instead of the fixed enemy/
                        // corrosionEntries closures above (side-biased to the player's single
                        // opposing focus). Combat-wide map — no per-side sideCtx field needed.
                        actorById: (id) => allActorsById.get(id),
                        // Live effective attack, for a reactive bomb applied before its owner's
                        // first turn of the run (no lastTurnCtx to snapshot). Same fold
                        // `effectiveSpeedOf` uses, reading `.attack` instead.
                        effectiveAttackFor: (id) => {
                            const a = allActorsById.get(id);
                            return a
                                ? effectiveStatsOf(statusEngine, selfBuffLookup, a).attack
                                : undefined;
                        },
                        // Same shared sink (SP-U U1) the cast-path forced detonation uses — a
                        // reduce-duration shrink can drive a bomb to 0 on EITHER side's actor.
                        forceDetonateBomb: (victim, sourceId, damage) =>
                            forceDetonateBombOnVictim(victim, sink, sourceId, damage),
                        // Ship-kit W8 Task 12: side-agnostic ship-role lookup (the SAME
                        // roleByActorId map Meatshield's defense-substitution and Graphite's
                        // roleFilter already consume) — feeds the reactive `purge` branch's
                        // per-victim `enemy-type` re-check (Zeolite: "when dealing damage to a
                        // Defender"), team-symmetrically.
                        roleOf: (id) => roleByActorId.get(id),
                        // SP-E, Task E4: live hacking/critDamage for `id` (either side), feeding
                        // Belladonna's conversion-chance (hacking) and paired extend-chance
                        // (critDamage) gates. Same statusEngine/selfBuffLookup every other
                        // effectiveStatsOf call site in this scope uses (e.g. mostBuffsAmong).
                        effectiveStatsFor: (id) => {
                            const a = allActorsById.get(id);
                            return a
                                ? effectiveStatsOf(statusEngine, selfBuffLookup, a)
                                : undefined;
                        },
                        // D-PR14: Doomsayer enemy-highest-attack resolver, the round's first
                        // real activator id, and the shared once-per-round consume set. All
                        // inert today — only consumed by the next task's executor branch.
                        enemyWithHighestAttack: sideCtx.enemyWithHighestAttack,
                        // SP-M M1 Task 6: Chakara's live highest-speed opposing-actor resolver.
                        enemyWithHighestSpeed: sideCtx.enemyWithHighestSpeed,
                        // SP-M M1 Task 7: living opposing roster for an 'all-enemies' reactive
                        // damage proc (Judge/Incinerator per-victim-conditional AoE).
                        livingOpposingActorIds: sideCtx.livingOpposingActorIds,
                        // SP-M M1 Task 7: synthesized enemy debuff/DoT NAMES for a victim — the
                        // EXACT synthesis buildTurnArgs uses (enemyDebuffNamesForTarget), so a
                        // per-victim 'enemy-debuff' name-gate (Incinerator's "with Inferno") reads
                        // the same names as an on-cast gate. Combat-wide (both sides) via
                        // allActorsById, mirroring actorById/affinityOf. Empty for a missing id.
                        enemyDebuffNamesFor: (id) => {
                            const a = allActorsById.get(id);
                            return a ? enemyDebuffNamesForTarget(a) : [];
                        },
                        // SP-M M1 Task 7: a victim's current effective max HP (the same
                        // recipientMaxHp denominator every heal/HP-basis site uses) so the
                        // per-victim hp-threshold gate (Judge's "<50% HP") reads a live HP%.
                        recipientMaxHpFor: (id) => recipientMaxHp(id),
                        firstActivatorId: sideCtx.firstActivatorId,
                        lastStandingId: sideCtx.lastStandingId,
                        oncePerRoundConsumed: sideCtx.oncePerRoundConsumed,
                        perRoundFireCounts: sideCtx.perRoundFireCounts,
                        // D-PR8: live not-hit-this-round gate (Alacrity). hitThisRound is a single
                        // combat-wide Set, so the SAME closure serves both sides (team-agnostic) —
                        // no per-side sideCtx field needed (unlike isLowestSpeedAllyFor).
                        wasHitThisRoundFor: (ownerId) => hitThisRound.has(ownerId),
                        // Phase 0 Task 5: live per-actor own-turn counter (Chrono Reaver /
                        // every-n-turns). allActorsById covers both sides in a single combat-wide
                        // map — no per-side sideCtx field needed (mirrors wasHitThisRoundFor).
                        turnsTakenFor: (ownerId) => allActorsById.get(ownerId)?.turnsTaken ?? 0,
                        // SP-D: live per-actor count of enemies damaged by that actor's most
                        // recent cast this round (Berserker's Marauder Rage, drained via
                        // on-deal-damage). Combat-wide map — no per-side sideCtx field needed
                        // (mirrors turnsTakenFor/wasHitThisRoundFor). Absent id → default 1
                        // (buildDrainContext).
                        enemiesHitThisCastFor: (ownerId) =>
                            enemiesHitThisCastByActor.get(ownerId) ?? 1,
                        // D-PR11: live adjacent-allies resolver (Fortifying Shroud). Sourced
                        // per-side from sideCtx; positional neighbours, else all same-side allies.
                        adjacentAllyIdsFor: sideCtx.adjacentAllyIdsFor,
                        // Ship-kit W5 Task C3: OPPOSING-side counterpart (Demolisher bomb-splash's
                        // 'adjacent-enemies' anchor resolution). See IntentExecContext.
                        adjacentOpposingIdsFor: sideCtx.adjacentOpposingIdsFor,
                        footprintAllyIdsFor: sideCtx.footprintAllyIdsFor,
                    });
                }
            }
        };

        // D-PR14: per-round state — reset each round (declared inside the round loop).
        let firstActivatorId: string | undefined;
        const oncePerRoundConsumed = new Set<string>();
        // ship-kit W3 (Sansi): per-round fire counts backing Ability.maxPerRound — reset each round
        // alongside oncePerRoundConsumed, shared across both drain sides.
        const perRoundFireCounts = new Map<string, number>();

        // C2b-2: opposing actor with the most buffs (Rhodium's enemy-most-buffs purge). Buff
        // count via selfBuffNamesForOwners (incl. unremovable — fine for SELECTION; removal still
        // respects the unremovable set). Ties → first by roster order (deterministic for goldens).
        // Returns undefined for an empty roster (DPS dummy) → executor falls back to ctx.enemyId.
        const mostBuffsAmong = (roster: CombatActor[]): string | undefined => {
            let best: string | undefined;
            let bestCount = -1;
            for (const a of roster) {
                const n = selfBuffNamesForOwners(statusEngine, [a.id]).length;
                if (n > bestCount) {
                    bestCount = n;
                    best = a.id;
                }
            }
            return bestCount > 0 ? best : undefined; // no buffs anywhere → no most-buffs target
        };

        // D-PR14: living opposing actor with the greatest LIVE effective attack
        // (Doomsayer's enemy-highest-attack target). Ties → roster order.
        const highestAttackInRoster = (roster: CombatActor[]): string | undefined =>
            highestAttackAmong(
                roster.map((a) => a.id),
                (id) => {
                    const a = roster.find((x) => x.id === id);
                    return a ? effectiveStatsOf(statusEngine, selfBuffLookup, a).attack : 0;
                },
                (id) => roster.find((a) => a.id === id)?.destroyedRound === undefined
            );

        // SP-M M1 (Task 6): living opposing actor with the greatest LIVE effective SPEED
        // (Chakara's enemy-highest-speed round-boundary hit). Reuses the generic
        // highestAttackAmong picker (a max-of-a-stat selector) with a speed accessor. Ties →
        // roster order.
        const highestSpeedInRoster = (roster: CombatActor[]): string | undefined =>
            highestAttackAmong(
                roster.map((a) => a.id),
                (id) => {
                    const a = roster.find((x) => x.id === id);
                    return a ? effectiveStatsOf(statusEngine, selfBuffLookup, a).speed : 0;
                },
                (id) => roster.find((a) => a.id === id)?.destroyedRound === undefined
            );

        // D-PR16: the id of the sole living actor in a roster, or undefined if !=1 alive.
        // Drives the `last-standing` condition (Last Stand). Recomputed each drain so it
        // reflects deaths recorded before the reactive drain.
        const soleSurvivorOf = (roster: CombatActor[]): string | undefined => {
            const living = roster.filter((a) => a.destroyedRound === undefined);
            return living.length === 1 ? living[0].id : undefined;
        };

        // SP-M M1 (Task 5): a round's co-located Rhodium purge+damage pair BOTH target
        // 'enemy-most-buffs' and are drained TOGETHER off the SAME queue with ONE ctx instance
        // (drainQueue drains every intent in the queue using the single ctx a drainIntentsFor
        // call built). The purge's own buff removal can zero out the very count that identified
        // the target, so a naive LIVE re-resolution by whichever ability drains SECOND (fixed by
        // sentence position — purge precedes "and deals X% damage" — so purge always drains
        // first) would resolve to nobody even though the FIRST-draining ability already found
        // somebody. `onceByOwner()` memoizes PER (CTX-INSTANCE, ownerId) PAIR: the purge and
        // damage intents belonging to the SAME Rhodium (same ownerId) share one resolution, so
        // they still agree on one pre-purge target — but a SECOND, DIFFERENT-ownerId Rhodium
        // draining off the SAME batch (e.g. two same-side Rhodiums both firing at round-end) gets
        // its OWN fresh resolution, re-evaluated live against the buff state AFTER the first
        // Rhodium's purge already ran (review fix: the original single-cell `once()` ignored
        // `ownerId` entirely and would reuse the FIRST owner's cached target for every owner in
        // the batch, causing the second Rhodium to re-hit the already-stripped target instead of
        // the now-most-buffed one). The NEXT separate drain call in the same round (a fresh
        // playerDrainCtx()/enemyDrainCtx() invocation — e.g. a later turn's pre-cast grant drain)
        // still gets an entirely fresh map and re-resolves live, exactly as before. Scoped to
        // enemyWithMostBuffs only — every other resolver (enemyWithHighestAttack,
        // lastStandingId, etc.) is untouched.
        const onceByOwner = <T>(fn: () => T): ((ownerId: string) => T) => {
            const cache = new Map<string, T>();
            return (ownerId: string) => {
                if (!cache.has(ownerId)) cache.set(ownerId, fn());
                return cache.get(ownerId) as T;
            };
        };

        // Player drain — binds the player queue + player-side ctx. Behaviourally identical to
        // the pre-refactor drainIntents (same runtimes/playerIds/lowest-speed/grantAllyCharges).
        // Hoisted into a named factory (SP-G G2) so the new pre-cast start-of-turn grant drain
        // can reuse the exact same ctx shape as the full drain.
        const playerDrainCtx = (): ReactiveSideCtx => ({
            runtimes: runtimesById,
            recipientIds: playerIds,
            isLowestSpeedAllyFor: (ownerId) => bySide('player').lowestSpeedIds().has(ownerId),
            grantAllyCharges: bySide('player').grantAllyCharges,
            removeEnemyCharges: bySide('player').removeEnemyCharges,
            removeChargesFrom: bySide('player').removeChargesFrom,
            selfHpPctFor: bySide('player').selfHpPctFor,
            // SP-M M1 (Task 7b review, Task 9b fix): gated on `hasPositionedEnemyRoster` — "does a
            // real, positioned opposing-enemy roster exist" — NOT `dummyEnemyIsVestigial` and NOT
            // `input.positionalTeamBattle`. dummyEnemyIsVestigial ANDs in a second conjunct (every
            // player actor's parsed target must be enemy-side) that is false whenever the player
            // team includes an ally-targeting ship (e.g. a healer) even in a fully positional
            // simulateBattle — that misrouted these resolvers onto the vestigial dummy instead of
            // the real enemy roster. `input.positionalTeamBattle` over-corrects the other way: it
            // is only ever set by simulateBattle, but direct-engine tests (e.g.
            // purgeConditionalSources.test.ts) supply a real, positioned enemyAttackers roster
            // without ever setting that flag — gating on it there wrongly fell back to the dummy.
            // In pure DPS mode (no enemyAttackers supplied) enemyAttackerActors is EMPTY, so
            // hasPositionedEnemyRoster is false and the positional-only
            // mostBuffsAmong(enemyAttackerActors) would otherwise resolve to undefined and the
            // reactive silently drop instead of crediting the dummy `enemy` — restoring the
            // pre-SP-M behavior of targeting the live dummy when it's the real DPS sink.
            enemyWithMostBuffs: hasPositionedEnemyRoster
                ? onceByOwner(() => mostBuffsAmong(enemyAttackerActors))
                : () => (enemy.destroyedRound === undefined ? enemy.id : undefined),
            enemyWithHighestAttack: () => highestAttackInRoster(enemyAttackerActors),
            // SP-M M1 (Task 6): plain arrow, NOT onceByOwner — Chakara has no purge/damage race
            // (its co-located clause is a self-buff), so LIVE re-resolution per drain is correct.
            // SP-M M1 (Task 7b review, Task 9b fix): gated on `hasPositionedEnemyRoster` — same
            // rationale as enemyWithMostBuffs above.
            enemyWithHighestSpeed: hasPositionedEnemyRoster
                ? () => highestSpeedInRoster(enemyAttackerActors)
                : () => (enemy.destroyedRound === undefined ? enemy.id : undefined),
            // SP-M M1 (Task 7, Task 9b fix): living opposing roster for an 'all-enemies' reactive
            // damage proc (Judge/Incinerator). When a real, positioned enemy roster exists
            // (`hasPositionedEnemyRoster`) the real opposing roster is the living enemy attackers.
            // In pure DPS mode the singular `enemy` dummy IS the real, destructible representative
            // target (SP-U U5) — so the AoE resolves to it, its per-victim hp-threshold/enemy-debuff
            // re-checked against its own live state, preserving Judge/Incinerator DPS-mode credit.
            // NEVER the dummy when a real roster exists — gated on `hasPositionedEnemyRoster`, NOT
            // `dummyEnemyIsVestigial` (falsely false whenever the player team includes an
            // ally-targeting ship such as a healer, even in a fully positional battle) and NOT
            // `input.positionalTeamBattle` (falsely false for direct-engine tests that supply a real
            // enemyAttackers roster without that flag — see Task 9b).
            livingOpposingActorIds: () =>
                hasPositionedEnemyRoster
                    ? enemyAttackerActors
                          .filter((a) => a.destroyedRound === undefined)
                          .map((a) => a.id)
                    : enemy.destroyedRound === undefined
                      ? [enemy.id]
                      : [],
            firstActivatorId,
            lastStandingId: soleSurvivorOf(allPlayerActors),
            oncePerRoundConsumed,
            perRoundFireCounts,
            adjacentAllyIdsFor: bySide('player').adjacentAllyIdsFor,
            // Ship-kit W5 Task C3: a player-owned reactive's 'adjacent-enemies' anchor (the bomb
            // victim) lives on the ENEMY side — mirrors livingOpposingActorIds' direction, not
            // adjacentAllyIdsFor's (which stays bound to this drain's OWN side, player).
            adjacentOpposingIdsFor: bySide('enemy').adjacentAllyIdsFor,
            footprintAllyIdsFor: bySide('player').footprintAllyIdsFor,
        });
        // Enemy drain (enemy-team PR1) — binds the SEPARATE enemy queue + enemy-side ctx.
        // recipientIds is the enemy-attacker ids (PR1 exercises self-target only; this
        // future-proofs PR2 enemy→enemy reactions). grantAllyCharges is bySide('enemy').grantAllyCharges
        // (Gap F — enemy ally-charge grants, done in enemy-team PR3): a reactive enemy
        // ally-charge grant now bumps the enemy attackers' charges, not the player team.
        // Skips entirely when the enemy queue is empty (DPS / no enemy reactives) so the
        // player path is untouched.
        // Use the enemy executor's own runtime map (NOT runtimesById, which drives
        // leech scan / seeding / credit and must stay player-only). This reuses the
        // existing enemyPlayerRuntimeByActorId — same source, key, and values.
        // Hoisted into a named factory (SP-G G2) alongside playerDrainCtx above.
        const enemyDrainCtx = (): ReactiveSideCtx => ({
            runtimes: enemyPlayerRuntimeByActorId,
            recipientIds: enemyAttackerActorIds,
            isLowestSpeedAllyFor: (ownerId) => bySide('enemy').lowestSpeedIds().has(ownerId),
            grantAllyCharges: bySide('enemy').grantAllyCharges,
            removeEnemyCharges: bySide('enemy').removeEnemyCharges,
            removeChargesFrom: bySide('enemy').removeChargesFrom,
            selfHpPctFor: bySide('enemy').selfHpPctFor,
            enemyWithMostBuffs: onceByOwner(() => mostBuffsAmong(allPlayerActors)),
            enemyWithHighestAttack: () => highestAttackInRoster(allPlayerActors),
            // SP-M M1 (Task 6): plain arrow, NOT onceByOwner — see playerDrainCtx's comment.
            enemyWithHighestSpeed: () => highestSpeedInRoster(allPlayerActors),
            // SP-M M1 (Task 7): mirror — an enemy owner scans the living player roster.
            livingOpposingActorIds: () =>
                allPlayerActors.filter((a) => a.destroyedRound === undefined).map((a) => a.id),
            firstActivatorId,
            lastStandingId: soleSurvivorOf(enemyAttackerActors),
            oncePerRoundConsumed,
            perRoundFireCounts,
            adjacentAllyIdsFor: bySide('enemy').adjacentAllyIdsFor,
            // Ship-kit W5 Task C3: mirror of playerDrainCtx's wiring — an enemy-owned reactive's
            // 'adjacent-enemies' anchor lives on the PLAYER side.
            adjacentOpposingIdsFor: bySide('player').adjacentAllyIdsFor,
            footprintAllyIdsFor: bySide('enemy').footprintAllyIdsFor,
        });
        // SP-U U3: side-parameterized drain replacing the former separate `drainIntents`/
        // `drainEnemyIntents` closures. The queue-empty guard (previously only on the enemy
        // side) is byte-identical for the player side too: drainQueue's `while (queue.length > 0)`
        // already no-ops on an empty queue, and playerDrainCtx()/enemyDrainCtx() build pure
        // closures (no side effects) — skipping their construction when the queue is empty
        // changes nothing observable.
        const drainIntentsFor = (side: Side): void => {
            const queue = intentQueues[side];
            if (queue.length === 0) return;
            drainQueue(queue, side === 'player' ? playerDrainCtx() : enemyDrainCtx());
        };

        // SP-G G2: start-of-turn GRANTS (buffs/shields/heals) must apply BEFORE the acting owner
        // casts, so a self-buff boosts the same turn it is granted (matching the game). Scoped to
        // the acting owner only. CHARGE intents are EXCLUDED — they keep their post-cast drain
        // (see the drainIntentsFor('player')/drainIntentsFor('enemy') calls in the turn loop
        // below), on which the Cobalt charge ledger depends. Team-symmetric: drains both side
        // queues, so a ship on either side gets the same pre-cast ordering. Turn-block
        // suppression is inherited from drainQueue's isTurnBlocked filter — a stunned owner's
        // grant is dropped, matching every other reactive.
        const drainStartOfTurnGrants = (ownerId: string): void => {
            // The spliced batch (p/e) is drained in isolation; any follow-up intents a grant
            // chain-enqueues land on the global queues and drain at the normal post-cast point.
            const isGrant = (i: Intent): boolean =>
                i.ownerId === ownerId &&
                i.ability.trigger === 'start-of-turn' &&
                i.ability.type !== 'charge';
            const take = (queue: Intent[]): Intent[] => {
                const ready: Intent[] = [];
                for (let i = 0; i < queue.length; ) {
                    if (isGrant(queue[i])) ready.push(queue.splice(i, 1)[0]);
                    else i++;
                }
                return ready;
            };
            const p = take(intentQueues.player);
            if (p.length) drainQueue(p, playerDrainCtx());
            const e = take(intentQueues.enemy);
            if (e.length) drainQueue(e, enemyDrainCtx());
        };

        // Path-B flush (Task 10): grants buffered from a PRIOR round's post-round enemy death
        // (on-enemy-destroyed → Sokol/Liberator) bump the granter's pending count for THIS round,
        // so the selection loop picks it up at its live speed-rank among all actors.
        // The round's extraActionFired set + MAX_EXTRA_TURNS_PER_ROUND backstop still bound them.
        // The buffer is drained (cleared) here — each pending grant lands exactly one round after
        // its kill was registered. The bump happens BEFORE the pre-loop drain/turn loop so the
        // granter takes its extra turn in selection order. Empty in normal DPS/healing runs → no-op.
        if (pendingExtraActions.length > 0) {
            const flush = pendingExtraActions.splice(0, pendingExtraActions.length);
            for (const g of flush) {
                const granter = allActorsById.get(g.granterId);
                if (!granter) continue;
                processExtraActionGrants(granter, [
                    {
                        abilityId: g.abilityId,
                        oncePerRound: g.oncePerRound,
                        endOfRound: g.endOfRound,
                    },
                ]);
            }
        }

        // round-started: the canonical start-of-round trigger (Phase 3). Fires once per
        // round, before any turn-started of that round. Documented deviation from the
        // Phase 1 contract's turn-started mapping: in a multi-actor round turn-started fires
        // once per actor, so round-started is the reliable "start of round" signal. Emitted
        // here (after the accumulator + drainIntentsFor are in scope) so its start-of-round
        // intents execute BEFORE any turn — no observable ordering change vs the old emit
        // site (nothing between beginRound and here emits an event).
        bus.emit({ type: 'round-started', round: r });
        // Drain point (a): start-of-round intents execute before the first turn.
        drainIntentsFor('player');
        drainIntentsFor('enemy');

        // §4.5 Stasis-break pending map (B3 Task 2). Reset fresh each round (new Map here).
        // Keys: victimIds whose Stasis should be removed when their skip branch runs.
        // Values: always true (present = break approved; absent = no break queued).
        // An entry is added by the ATTACKER's turn block AFTER runPlayerTurn returns:
        //   - the onHitBreakStasis hook fires DURING runPlayerTurn, marks a local Set;
        //   - AFTER the turn, if the victim was stasised at hit time AND the turn did NOT
        //     re-inflict Stasis (inflictedEnemyDebuffs check), the victim id is stored here.
        // Consumed inside each actor's own skip branch (focus / team / real-enemy): if the
        // victim id is present, remove Stasis after the turn-skip logic. This ensures the
        // victim STILL skips its current-round turn (invariant preserved), and is freed for
        // its next turn (Stasis gone). The same-round drain guard (drainIntentsFor('player') / drainIntentsFor('enemy'))
        // runs BEFORE the break resolution → on-attacked reactive sees isStasised=true (test iii).
        // Re-apply check is performed at the ATTACKER's turn, not at consume time, so there is
        // NO casterId lookup: the per-turn inflictedEnemyDebuffs signal is sufficient and correct
        // regardless of which attacker fires on later turns (fixes the casterId-identity bug).
        const stasisBreakPending = new Map<string, true>();
        inTurnLoop = true;
        try {
            let selectionGuard = 0;
            // Pick the next actor to act, OWNING the pending decrement (Task 4). Drain the NORMAL
            // pool first — the unacted actor with the highest CURRENT effective speed (reads live
            // speed buffs → mid-round Speed Up/Down reorders the remainder). Only once the normal
            // pool is fully drained do we consult the END-OF-ROUND pool (Harvester-style grants),
            // again picked by speed AMONG end-of-round actors but unconditionally after every normal
            // action. Returns undefined once both pools are empty → the round ends.
            const selectNext = (): CombatActor | undefined => {
                const normal = selectNextBySpeed(roundActors, pendingOf, effectiveSpeedOf);
                if (normal) {
                    pending.set(normal.id, pendingOf(normal.id) - 1);
                    return normal;
                }
                const eor = selectNextBySpeed(roundActors, endOfRoundPendingOf, effectiveSpeedOf);
                if (eor) {
                    endOfRoundPending.set(eor.id, endOfRoundPendingOf(eor.id) - 1);
                    return eor;
                }
                return undefined;
            };
            for (let actor = selectNext(); actor; actor = selectNext()) {
                if (++selectionGuard > MAX_SELECTION_TICKS) {
                    throw new Error(
                        `combat round ${r}: turn selection did not terminate (pending actions not draining)`
                    );
                }

                // Dead-target turn skip (top-of-turn): the heal target is already destroyed
                // entering its turn → skip the turn body (see handleDeadTargetSkip above).
                if (handleDeadTargetSkip(actor)) {
                    continue;
                }

                // General dead-actor turn skip (correctness): an actor DESTROYED earlier this
                // round (e.g. a player AoE killed an enemy attacker scheduled later in the turn
                // order, or a walked team ship that died) must NOT act when its turn comes up —
                // no turn-started/turn-ended emit, no runPlayerTurn, no damage. A plain `continue`
                // is correct: every per-iteration step below (turn-started emit, the kind-branch
                // turn body, drainIntentsFor('player')/drainIntentsFor('enemy'), turn-ended) is THIS actor's own turn
                // work, which a dead actor does none of. The pending decrement already happened in
                // selectNext (Task 4) BEFORE the body runs, so the dead actor's pending is consumed
                // and termination is preserved. Extra-action grants only fire from inside a live
                // turn body, so a skipped actor produces none.
                //
                // The signal is `destroyedRound !== undefined` (set by recordDestroyed when the
                // actor's HP first reaches 0) — NOT `currentHp <= 0`: a manual/flat enemy attacker
                // is constructed with stats.hp 0 (HP not modelled) → currentHp starts at 0 yet it
                // was never destroyed and MUST keep acting. Only an actor that ACTUALLY died is
                // skipped.
                //
                // TWO actors are deliberately exempt (they keep flowing through their EXISTING
                // special handling even after destruction):
                //  - the dead HEAL TARGET → handleDeadTargetSkip above (healTargetBuffs=[] + the
                //    synthesized dead-focus turn). It already `continue`d if dead, so reaching here
                //    means it's alive; the exemption is belt-and-suspenders.
                //  - the `enemy` actor (DPS opponent / sim-mode dummy sink). This exemption is
                //    effectively DORMANT today, coupled to the terminal `break` near the end of
                //    the round loop (~line 7994, `if (dpsEnemyTarget && enemy.destroyedRound !==
                //    undefined) break;`): in pure DPS mode `enemy` is a real destructible actor,
                //    but its HP only lands (and `destroyedRound` only gets stamped) in the
                //    POST-round accounting step, after this turn loop has already closed for that
                //    round — so within any given round's turn-loop walk, `enemy.destroyedRound` is
                //    never set yet, and the round loop breaks immediately once it is, so there is
                //    no subsequent round left for this exemption to matter in. In sim/healing mode
                //    the vestigial dummy sink never dies at all, so `destroyedRound` is never set
                //    there either. The exemption exists so that IF the terminal break above were
                //    ever removed (e.g. to keep simulating past the DPS enemy's death), a dead
                //    `enemy` would still take its turn — banking enemy charges and running the
                //    enemy-side DoT/decrement bookkeeping — rather than being skipped and dropping
                //    a turn-started/ended pair.
                const isDummyEnemy = actor.kind === 'enemy' && actor.id === enemy.id;
                if (
                    actor.destroyedRound !== undefined &&
                    !(healTarget && actor.id === healTarget.id) &&
                    !isDummyEnemy
                ) {
                    continue;
                }

                // C2b-2 T5: stamp the acting actor as the prospective lethal attacker BEFORE its
                // damage is applied. Every DIRECT-damage path this turn (focus/team→enemy via
                // applyOutgoingToEnemy, enemy→player via applyIncomingToTarget, positional apply,
                // the non-positional firing hit) routes through the wrappers that read this, so a
                // kill they cause is attributed here. The DoT-tick batch (heal-target turn-start)
                // is the one intake that runs in this same turn yet passes byDirectDamage:false,
                // so it never uses this value as a killer.
                actingActorId = actor.id;

                // G PR1: reset the once-per-attack counter guard at each actor turn-start so a
                // later attack (a different turn) can counter again while all per-hit `attacked`
                // events of ONE attack collapse to a single counter.
                counterFiredThisTurn.clear();
                // Task 5: reset the self-rider once-per-attack guard beside the counter guard so a
                // later attack re-applies Hermes's Everliving Regeneration / charge.
                reactionFiredThisAttack.clear();
                // Insidiousness: drop the per-attack proc verdicts so this attack draws its own
                // single roll (and every debuff it inflicts shares that one verdict).
                procDecisionThisAttack.clear();

                // Set the active carrier for the own-turn self-buff reprieve: a TIMED self-buff
                // written during this actor's own turn is flagged appliedThisTurn so it survives
                // one extra Post Turn (lasting through the carrier's next turn, matching the game).
                // Team-symmetric — applies to the focus, team actors, AND the dummy/enemy actors
                // (an enemy ship that self-buffs on its own turn gets the same reprieve). Must run
                // BEFORE the turn body applies any buffs, so it precedes the kind-branch below.
                statusEngine.beginTurn(actor.id);

                bus.emit({ type: 'turn-started', actorId: actor.id, round: r });
                // Task 6a: LOG-ONLY per-turn snapshot of the acting actor's live modelled stats
                // (no listener subscribes — see the events.ts doc comment). Reads the SAME
                // effectiveStatsOf fold every other live-stat call site in this file uses.
                {
                    const snapshotEff = effectiveStatsOf(statusEngine, selfBuffLookup, actor);
                    bus.emit({
                        type: 'stats-snapshot',
                        actorId: actor.id,
                        round: r,
                        stats: {
                            attack: snapshotEff.attack,
                            defence: snapshotEff.defence,
                            crit: snapshotEff.crit,
                            critDamage: snapshotEff.critDamage,
                            defensePenetration: snapshotEff.defensePenetration,
                            speed: snapshotEff.speed,
                            hacking: snapshotEff.hacking,
                            security: snapshotEff.security,
                            currentHp: actor.currentHp,
                            maxHp: actor.stats.hp,
                            shieldPool: actor.shieldPool,
                        },
                    });
                }
                // Phase 0 Task 5: bump the actor's own-turn counter so every-n-turns conditions
                // can evaluate the live N. Incremented AFTER turn-started so end-of-turn
                // (turn-ended) reactive drains — which run later — read the correct N. 1-based
                // (turnsTaken=1 on the first own turn) matches the evaluator's `t % period === offset`.
                //
                // STASIS/DISABLE: this increment is UNCONDITIONAL — it bumps even on a turn the
                // actor skips under Stasis/Disable, unlike advanceChargeCadence (~4249/4314) which
                // is gated behind !isTurnBlocked. Keeping it monotonic is DELIBERATE: turn-ended
                // (~4595) and the reactive drains (~4567) fire on skipped turns too, so freezing the
                // counter on a skip would let an every-n-turns gate spuriously re-fire against the
                // frozen value — instead the cadence loses the skipped tick and resumes on the
                // original residue (the next own-turn that satisfies `t % period === offset`).
                //
                // The every-n-turns periodic proc IS already fully suppressed on a turn-blocked turn
                // — NO gating is needed HERE. A periodic charge (e.g. Chrono Reaver's `end-of-turn`
                // charge) is a REACTIVE intent carrying intent.ownerId; on a blocked owner's turn the
                // §4.4 reactive-intent drain filter (~3403: `if (isTurnBlocked(intent.ownerId)) continue;`)
                // DROPS it before executeIntent applies the charge. So a stasised/disabled unit banks
                // NO periodic charge, matching the +1/turn baseline. Golden: chronoReaverCharge.integration.test.ts
                // ("stasis suppression"). NOTE: the suppression relies on the owner being STILL
                // turn-blocked at the drain pass — for a 1-turn block the Post-Turn decrement (~4651)
                // can clear the block before the deferred end-of-turn intent drains, so that golden
                // uses a ≥2-turn block spanning a proc turn.
                // The dummy-sink enemy is also bumped here; harmless (no every-n-turns ability on it).
                actor.turnsTaken += 1;

                // SP-G G2: apply this actor's start-of-turn GRANTS before it acts (see
                // drainStartOfTurnGrants). Runs for every acting actor on both sides.
                drainStartOfTurnGrants(actor.id);

                // Task 11b: tick the HEAL TARGET's own enemy-applied DoTs at ITS turn-start
                // (mirroring the dummy enemy's DoT-tick timing — DoTs tick at the afflicted ship's
                // turn-start). An enemy attacker lands inferno/corrosion in the tank's containers
                // (Task 6b); without this tick they would never deal damage. Routes the ticked
                // damage into the INCOMING-damage accounting (shield-first → HP → ship-destroyed →
                // the victim's per-actor intake bucket) — NOT the player→enemy damage path. Reuses tickDoTs:
                // the applier's effectiveAttack/dotMult/affinityMult come from the entry's sourceId
                // (the enemy) via lastTurnCtxByActor; corrosion scales with the AFFLICTED ship's
                // (the tank's) max HP. The dead-target guard above already skipped a destroyed tank,
                // so the tank is alive here. DPS mode / no enemy-applied DoTs → empty containers →
                // a no-op (goldens byte-identical).
                // PR-C C2: unified per-victim DoT-tick prologue. EVERY positioned non-dummy actor
                // (attacker, walked-team ally, enemy attacker) ticks its OWN DoT containers against
                // its OWN HP at its turn-start — the last per-victim gap after the firing hit +
                // skill detonation + timed bursts. The dummy `enemy` (actor.id === enemy.id) keeps
                // its legacy aggregate tick at the enemy-turn branch (~:4966, byte-identical via
                // creditDamage); only the dummy is excluded here. The heal-target branch is preserved
                // VERBATIM (snapshot + tankDotDamage healing accounting + dead-skip). The per-victim
                // branch lands HP via applyVictimDamage (DoT → bypass shield) and NEVER calls
                // creditDamage (no cumulativeDamage double-feed against the dummy HP overwrite).
                //
                // OUTSIDE every `if (!isTurnBlocked)` stasis gate (this prologue precedes all
                // kind-branches) → a STASISED victim STILL ticks, matching the heal-target/dummy
                // precedent and the E5-symmetry invariant. Moving this inside a stasis gate would
                // wrongly silence a stasised victim's DoTs.
                if (actor.id !== enemy.id) {
                    const isHealTarget = !!healTarget && actor.id === healTarget.id;
                    if (isHealTarget) {
                        // Snapshot BEFORE tickDoTs so expiring entries still appear in the
                        // display panel (mergeDoTsForDisplay + buildEnemyRoundEffects read it).
                        tankDotSnapshot = {
                            corrosion: healTarget.corrosionEntries.map((e) => ({
                                sourceId: e.sourceId,
                                tier: e.tier,
                                stacks: e.stacks,
                            })),
                            inferno: healTarget.infernoEntries.map((e) => ({
                                sourceId: e.sourceId,
                                tier: e.tier,
                                stacks: e.stacks,
                            })),
                        };
                        let tankDotDamage = 0;
                        tickDoTs({
                            corrosionEntries: healTarget.corrosionEntries,
                            infernoEntries: healTarget.infernoEntries,
                            genericDoTEntries: healTarget.genericDoTEntries,
                            // Corrosion scales with the afflicted ship's HP — the tank's own max HP.
                            enemyHp: recipientMaxHp(healTarget.id),
                            ctxFor: (sourceId) => lastTurnCtxByActor.get(sourceId),
                            emitTicked: (dotType, damage, stacks, tier) =>
                                bus.emit({
                                    type: 'dot-ticked',
                                    targetId: healTarget.id,
                                    round: r,
                                    dotType,
                                    damage,
                                    stacks,
                                    tier,
                                }),
                            // Sum the ticked damage across all appliers; route it as INCOMING to the tank
                            // (NOT into a player damage row). expireStacks inside tickDoTs ages the entries.
                            credit: (_sourceId, _dotType, damage) => {
                                tankDotDamage += damage;
                            },
                            // D-PR3 (Vortex Veil): reduce the carrier's incoming DoT ticks when
                            // the tank equips Vortex Veil. The condition 'dot-inferno-corrosion'
                            // gates on dotType being set, so querying with either dotType returns
                            // the same %. Absent → 0 → byte-identical for all existing tests.
                            incomingDotReductionPct: (dotType) =>
                                incomingReductionForHit(incomingAbilitiesOf(healTarget.id), {
                                    didCrit: false,
                                    attackerStealthed: false,
                                    victimStealthed: isStealthed(healTarget.id),
                                    victimStasised: isStasised(healTarget.id),
                                    hitIndexThisRound: 0,
                                    dotType,
                                    // A DoT tick has no single attacker (aggregate of appliers) —
                                    // 'attacker-has-dot' abilities are scope:'direct' only, so this
                                    // never matters (scope-filtered before conditionMet reads it).
                                    attackerHasDot: false,
                                    victimHasBarrierRecharging: hasBarrierRecharging(healTarget.id),
                                    victimHasShield: hasShield(healTarget.id),
                                    selfHpPct: selfHpPctOf(healTarget.id),
                                    // Same no-single-attacker reasoning as attackerHasDot above —
                                    // 'attacker-taunted-or-provoke' abilities are 'transform-
                                    // incoming-to-dot' (direct-only, gated inside applyVictimDamage
                                    // itself), so this reduction-path ctx never reads it.
                                    attackerTauntedOrProvoked: false,
                                }),
                            // PR I4b: the tank is the ticking victim.
                            dotMultFor: (ctx) => victimDotMult(ctx, healTarget),
                        });
                        if (tankDotDamage > 0) {
                            // C2b-2 T5: a DoT-tick batch is an AGGREGATE of multiple appliers with no
                            // single killer → byDirectDamage:false, killerId undefined (overrides the
                            // wrapper's direct-damage default). A defaulted true would wrongly tag a
                            // DoT kill as a direct hit (Faust, Task 6, distinguishes them).
                            applyIncomingToTarget(tankDotDamage, healTarget, {
                                byDirectDamage: false,
                            });
                        }
                        // Dead-is-dead: if the turn-start DoT tick was LETHAL the tank just died
                        // (recordDestroyed fired inside applyIncomingToTarget). It must NOT fall through
                        // and take a full turn — re-run the SAME dead-target skip as the top-of-turn
                        // guard. (With Cheat Death the intercept floored HP at 1 → not dead → false → it
                        // acts normally.)
                        if (handleDeadTargetSkip(actor)) {
                            continue;
                        }
                    } else {
                        // Per-victim DoT tick (both sides). The actor ticks its OWN containers
                        // against its OWN HP only when it is POSITIONAL against its opposing roster
                        // (DPS/healing-only mode has no positioned opposing actors → no-op →
                        // byte-identical for non-positional fixtures).
                        const sideIsPlayer = actor.side === 'player';
                        const opposing = sideIsPlayer ? enemyAttackerActors : allPlayerActors;
                        const hasDots =
                            actor.corrosionEntries.length > 0 ||
                            actor.infernoEntries.length > 0 ||
                            actor.genericDoTEntries.length > 0;
                        if (hasDots && isPositional(actor.position, opposing)) {
                            let total = 0;
                            // SP-F F1 RESHAPE: per-`sourceId` dealt detail for THIS tick batch —
                            // multiple distinct DoT appliers can tick on the same victim in the
                            // same round, so a single collapsed attacker id (like every other
                            // site) would misattribute. Populated on BOTH sides (team-symmetric:
                            // an enemy's DoT ticking on a player ally must attribute too), unlike
                            // the `!sideIsPlayer`-gated `perActorDot` DPS map below, which stays
                            // exactly as it was.
                            const tickDealtBySource = new Map<string, number>();
                            tickDoTs({
                                corrosionEntries: actor.corrosionEntries,
                                infernoEntries: actor.infernoEntries,
                                genericDoTEntries: actor.genericDoTEntries,
                                // Corrosion scales with the AFFLICTED ship's own max HP.
                                enemyHp: recipientMaxHp(actor.id),
                                ctxFor: (sourceId) => lastTurnCtxByActor.get(sourceId),
                                emitTicked: (dotType, damage, stacks, tier) =>
                                    bus.emit({
                                        type: 'dot-ticked',
                                        targetId: actor.id,
                                        round: r,
                                        dotType,
                                        damage,
                                        stacks,
                                        tier,
                                    }),
                                credit: (sourceId, dotType, damage) => {
                                    total += damage;
                                    tickDealtBySource.set(
                                        sourceId,
                                        (tickDealtBySource.get(sourceId) ?? 0) + damage
                                    );
                                    // Only PLAYER-applied DoTs ticking on an ENEMY victim are the
                                    // focus player's outgoing DPS → surface via perActorDot (keyed
                                    // by the DoT APPLIER; the C1 fold reads perActorDot[focus]).
                                    // Enemy-applied DoTs on a player victim are NOT the focus's DPS.
                                    if (!sideIsPlayer) {
                                        const e = perActorDot.get(sourceId) ?? {
                                            corrosion: 0,
                                            inferno: 0,
                                            generic: 0,
                                        };
                                        e[dotType] += damage;
                                        perActorDot.set(sourceId, e);
                                    }
                                },
                                // D-PR3 (Vortex Veil): reduce this carrier's incoming DoT ticks.
                                incomingDotReductionPct: (dotType) =>
                                    incomingReductionForHit(incomingAbilitiesOf(actor.id), {
                                        didCrit: false,
                                        attackerStealthed: false,
                                        victimStealthed: isStealthed(actor.id),
                                        victimStasised: isStasised(actor.id),
                                        hitIndexThisRound: 0,
                                        dotType,
                                        // See the sibling tank-path call above: no single attacker
                                        // on a DoT tick; harmless (scope:'direct'-only condition).
                                        attackerHasDot: false,
                                        victimHasBarrierRecharging: hasBarrierRecharging(actor.id),
                                        victimHasShield: hasShield(actor.id),
                                        selfHpPct: selfHpPctOf(actor.id),
                                        attackerTauntedOrProvoked: false,
                                    }),
                                // PR I4b: this actor IS the ticking victim.
                                dotMultFor: (ctx) => victimDotMult(ctx, actor),
                            });
                            if (total > 0) {
                                // DoT batch: bypass shield (byDirectDamage:false), aggregate of
                                // appliers with no single killer. Mirrors the heal-target route
                                // (applyIncomingToTarget == applyVictimDamage + sink + pen 0).
                                applyVictimDamage(total, actor, sink, { byDirectDamage: false });
                                roundPerTargetDamage.set(
                                    actor.id,
                                    (roundPerTargetDamage.get(actor.id) ?? 0) + total
                                );
                                // SP-F F1 RESHAPE: one roundPerTargetDealt entry PER distinct
                                // applier — do not collapse to a single guessed attacker (see
                                // tickDealtBySource above). Σ over sourceIds here == `total`, so
                                // this write reconciles with the unchanged victim-keyed write above.
                                for (const [sourceId, dealt] of tickDealtBySource) {
                                    creditDealt(sourceId, actor.id, dealt);
                                }
                            }
                            // Lethal turn-start tick → skip the rest of the turn. INTENTIONALLY
                            // follows the heal-target lethal convention (skip the shared post-turn
                            // block: decrements / turn-ended), NOT the timed-burst convention.
                            if (actor.destroyedRound !== undefined) {
                                if (actor.id === focusActorId) pushSynthesizedFocusSkipTurn();
                                continue;
                            }
                        }
                    }
                }

                if (actor.kind === 'attacker') {
                    // ====================================================================
                    // ATTACKER TURN — the full damage/buff/DoT-application pipeline lives
                    // in runPlayerTurn (playerTurn.ts), minus the DoT-processing calls
                    // (tickDoTs / processBombs / processAccumulators) which run on the enemy
                    // turn. It returns everything the round's RoundData row needs from this
                    // turn; the numeric damage fields fold into the round accumulator below.
                    // The attacker's per-actor config/gates/stats are bundled in
                    // attackerRuntime (built once at setup); Task 4 adds team runtimes.
                    // ====================================================================
                    // §4.3 STASIS GATE (B2 Task 3): a stasised actor SKIPS its action body
                    // (active/charged skill + attack + status applications). The DoT-tick
                    // prologue (healTarget branch above) and the Post-Turn decrements (below)
                    // STILL run — the guard wraps ONLY this action body. Duration N therefore
                    // skips exactly N scheduled actions (each skipped turn decrements Stasis).
                    // A stasised FOCUS actor must push a synthesized focus turn so the
                    // post-round `focusTurns.length` guard does not throw.
                    if (!isTurnBlocked(actor.id)) {
                        // D-PR14: first REAL activation of the round (Stasis/Disable-skipped
                        // actors never enter these blocks). ??= writes once.
                        firstActivatorId ??= actor.id;

                        // PR-B: PER-POSITIONED-PLAYER TIMED BURST (enemy-seeded bombs/accumulators
                        // on the focus attacker burst against its OWN HP at its turn-start, via
                        // sink). Mirror of the PR2 enemy site; strict no-op for every existing
                        // fixture (none seed player-actor timed containers). Canonical turn-start
                        // order is tickDoTs → processBombs → processAccumulators; PR-C will add
                        // tickDoTs AHEAD of this burst.
                        applyPositionedTimedBurst(actor, sink, enemyAttackerActors);

                        // Dead-after-burst guard (PR2 lesson): a lethal self-burst stamps
                        // destroyedRound inside applyVictimDamage AFTER the top-of-turn dead-skip
                        // already ran. Key off destroyedRound (NOT currentHp > 0 — bare actors carry
                        // currentHp 0). healTarget carve-out mirrors the top-of-turn guard. A focus
                        // actor killed by its own burst must still push a synthesized focus turn so
                        // the post-round focusTurns.length guard does not throw.
                        const burstDestroyedActor =
                            actor.destroyedRound !== undefined &&
                            !(healTarget && actor.id === healTarget.id);
                        if (!burstDestroyedActor) {
                            // SP-F F5: on a charge-firing turn, resolve BOTH the footprint pattern
                            // and the target selection from the CHARGED axes (each falls back to
                            // the active axis when unset) — mirrors runPlayerTurn's own action
                            // predicate exactly (playerTurn.ts:~1044), evaluated here BEFORE
                            // runPlayerTurn consumes the charge (advanceChargeCadence runs inside
                            // it, after the decision, so actor.charges is still the pre-decision
                            // value at this point).
                            const willFireCharged = willFireChargedFor(actor);
                            const target = willFireCharged
                                ? parsedChargedTargetFor(actor)
                                : parsedTargetFor(actor);
                            const pattern = willFireCharged
                                ? parsedChargedPatternFor(actor)
                                : parsedPatternFor(actor);
                            // Positional target selection (Task C1, GATED). When the focus attacker
                            // (`actor`) carries a board position AND the positioned enemy roster
                            // (`enemyAttackerActors`) has positioned actors, resolve the focus's parsed
                            // target (`input.target`) to a single living enemy and bind THIS turn to it.
                            // When the selection is null — not positional, OR positional but no living
                            // positioned enemy target — we diverge NOTHING from the legacy dummy `enemy`
                            // binding (keeps every existing path byte-identical; the null-target sub-case
                            // is treated as a no-op fallthrough to legacy). No existing test passes
                            // positions, so this branch never fires for them.
                            // Positional target (phase 2): the selected enemy actor, else the dummy sink.
                            // Both are full CombatActors, so all per-target bindings derive from `tgt`
                            // uniformly. For the legacy (non-positional) path tgt === enemy, whose
                            // stats.defence/stats.hp and DoT/bomb containers ARE the legacy module vars
                            // (see ~line 1297) — so deriving every binding from `tgt` is byte-identical.
                            // HP decline is no longer passed in (PR6b): runPlayerTurn derives it from the
                            // struck victim's currentHp (max − currentHp), so the dummy-sink and real-victim
                            // cases both read `tgt` uniformly — no separate decline ternary here.
                            const { tgt } = selectTurnTarget(actor);
                            // The player side's legacy victim is the always-present dummy `enemy`
                            // sink, so `tgt` is never undefined here — this is a type-narrowing
                            // no-op (selectTurnTarget widened for the enemy side in SP-U U5 R6).
                            if (tgt === undefined) continue;
                            // §4.5: inject break hook into runPlayerTurn. The hook marks stasisHitVictims
                            // only when the victim was stasised at hit time. The actual statusEngine
                            // removal happens AFTER drainIntentsFor('player')/drainIntentsFor('enemy') (below).
                            // §4.5 Akula exception: if the ACTING ATTACKER has doesntBreakStasis, the
                            // victim is never recorded → no break-mark, no stasisBreakPending entry.
                            const tgtWasStasised = !actor.doesntBreakStasis && isStasised(tgt.id);
                            // §4.5: `stasisHitVictims` collects ids of victims stasised at hit time.
                            // Resolved AFTER runPlayerTurn returns (when inflictedEnemyDebuffs is available)
                            // to compute the re-apply check, then stored in `stasisBreakPending` for the
                            // victim's skip branch to consume.
                            const turnStasisHitVictims = new Set<string>();
                            // Task 5: predict whether the engine will resolve this cast POSITIONALLY.
                            // The full `positional` gate below adds `turn.positionalScalars != null`
                            // (⟺ a damage ability fired). runPlayerTurn suppresses its inline
                            // ability-performed emit ONLY when this flag AND hasDamageAbility both
                            // hold — so the suppression condition matches the `positional` gate
                            // EXACTLY. A non-damage cast keeps its inline emit (flag ignored).
                            const willApplyPositionally =
                                isPositional(actor.position, enemyAttackerActors) &&
                                target != null &&
                                pattern != null;
                            // Sub-project I, PR I2: snapshot the opposing roster's enemy-status
                            // BEFORE this turn runs (see the causality note above
                            // perVictimOutgoingDeltaPct) — this turn's own debuff-inflict must
                            // not retroactively satisfy its own per-victim outgoing gate.
                            const preTurnVictimStatus =
                                snapshotPreTurnVictimStatus(enemyAttackerActors);
                            const focusTurnArgs = buildTurnArgs(actor, tgt);
                            const turn = runPlayerTurn({
                                ...focusTurnArgs,
                                deferAbilityPerformedToEngine: willApplyPositionally,
                                onHitBreakStasis: tgtWasStasised
                                    ? (targetId: string) => {
                                          turnStasisHitVictims.add(targetId);
                                      }
                                    : undefined,
                            });
                            if (turnStasisHitVictims.size > 0) {
                                const reInflictedStasis = turn.inflictedEnemyDebuffs.some((ab) =>
                                    isStasis(ab.buffName)
                                );
                                if (!reInflictedStasis) {
                                    for (const victimId of turnStasisHitVictims) {
                                        stasisBreakPending.set(victimId, true);
                                    }
                                }
                                // else: same-turn re-apply wins → break discarded, no pending mark.
                            }

                            // Drain any team-turn resisted entries staged BEFORE this attacker turn
                            // (faster team actors) into the HEAD of this turn's resisted list — same
                            // observable order as the old teamResistedEnemyDebuffs fold-in.
                            if (pendingResisted.length > 0) {
                                turn.resistedEnemyDebuffs.unshift(...pendingResisted);
                                pendingResisted.length = 0;
                            }

                            // Positional APPLY (Task 8b, GATED). When the focus attacker is positional,
                            // carries a parsed target, AND its firing hit produced scalars (a damage
                            // ability fired → turn.positionalScalars is set), drive the per-victim apply
                            // loop against the LIVE enemy roster. Re-resolves anchor + footprint per hit;
                            // origin cells take full damage, covered cells half. Each victim's HP/shield/
                            // Barrier/Cheat-Death/death is mutated through the real applyOutgoingToEnemy.
                            // No production caller threads position+target+pattern yet, so this is false
                            // for every existing test/golden → byte-identical.
                            // The pattern is REQUIRED for footprint expansion — without it there is no
                            // apply to perform (the existing positionalSelection tests set position+target
                            // to exercise target binding only, never a pattern, so they keep the legacy
                            // single-sink credit and never enter this branch).
                            //
                            // DELIBERATELY no `selectedEnemy != null` precondition (CodeRabbit raised this):
                            // in positional/simulator mode there is NO dummy enemy sink to fall back to.
                            // When per-hit resolution inside applyPositionalDamage finds no living opposing
                            // actor, the correct behaviour is for the attacker to WHIFF (deal 0) — see the
                            // death-fallback all-dead-whiff test. Gating `positional` on a pre-resolved
                            // living target would instead route the firing hit back to the legacy dummy
                            // sink, recording PHANTOM damage against a target that no longer exists. So we
                            // enter the positional branch on pattern/target/scalars alone and let the
                            // per-hit live re-resolution own the whiff. (Credit suppression below pairs with
                            // this: the per-victim apply is the ONLY damage path here.)
                            const positional =
                                isPositional(actor.position, enemyAttackerActors) &&
                                target != null &&
                                pattern != null &&
                                turn.positionalScalars != null;
                            if (positional) {
                                // Opposing roster + victim wrapper come from the per-side bindings
                                // (player→enemy here). pattern/target are non-null via the `positional` gate.
                                // SP-U U2: the per-victim apply/emit/detonation body is the shared
                                // drivePositionalTurnApply helper; the focus site injects the player→enemy
                                // STANDING leech (E2 Task 3 — the acting attacker's standing leeches proc
                                // off EACH footprint victim's role-scaled dealt damage) and emits the
                                // per-victim `attacked` inline (before detonation). The turn's deferred
                                // ability-performed carries the anchor firing-hit values for the log.
                                const tb = turnBindings(actor.side);
                                drivePositionalTurnApply(
                                    actor,
                                    tb,
                                    {
                                        tgt,
                                        pattern,
                                        target,
                                        preTurnVictimStatus,
                                        scalars: turn.positionalScalars!,
                                        hitCrits: turn.hitCrits,
                                        perVictimOutgoing: turn.perVictimOutgoing,
                                        rollVictimCrit: turn.rollVictimCrit,
                                        deferredAbilityPerformed: turn.deferredAbilityPerformed,
                                        positionalDetonation: turn.positionalDetonation,
                                    },
                                    (_victim, damage) =>
                                        procStandingLeechesPerVictim(actor.id, damage),
                                    (attackedSignals) => {
                                        if (attackedSignals.size > 0) {
                                            emitPerVictimAttacked({
                                                bus,
                                                round: r,
                                                attackerId: actor.id,
                                                primaryId: tgt.id,
                                                victims: attackedSignals,
                                            });
                                        }
                                    }
                                );
                            }
                            // Clause order: this turn's damage has landed (or the cast had none) —
                            // now apply the debuff clauses that followed it.
                            flushDeferredEnemyApplications(turn.deferredEnemyApplications);

                            // Fold the focus turn's numeric damage into the round accumulator.
                            // += (not =) on detonation: with a FASTER enemy, the enemy's bomb/
                            // accumulator bursts ran earlier this round — a plain assignment would
                            // clobber them. direct/secondary/conditional are single-focus-turn
                            // today; += keeps the 0..N-turn seam additive.
                            const d = dmg(actor.id);
                            // secondary/conditional are display sub-buckets already rolled into
                            // turn.directDamage — they must NOT be routed through creditDamage or the
                            // standing-leech hook would double-count them.
                            //
                            // Credit SUPPRESSION for the positional case (Task 8b): the firing-hit damage
                            // now lands per-victim via applyPositionalDamage above, so it must NOT also be
                            // folded into cumulativeDamage here (that would double-count it). Skip the
                            // direct/secondary/conditional credits; KEEP detonation (bombs are a separate
                            // mechanic, out of scope). The single-sink decline that used to be zeroed for
                            // the positional path is now derived from the victim's own currentHp inside
                            // runPlayerTurn (PR6b), so no separate decline suppression is needed here.
                            if (!positional) {
                                d.secondary += turn.secondaryDamage;
                                d.conditional += turn.conditionalDamage;
                                creditDamage(actor.id, 'direct', turn.directDamage);
                                // Detonation credit is suppressed in positional mode (turn.detonationDamage
                                // is 0 there anyway — runPlayerTurn returns the recipe instead). Keeping it
                                // inside this guard documents intent and keeps per-victim detonation out of
                                // cumulativeDamage (it lands per-victim via applyVictimDamage above).
                                creditDamage(actor.id, 'detonation', turn.detonationDamage);
                            }
                            focusTurns.push(turn);

                            // Heal-target buffs: if this focus actor IS the heal target (self-heal case),
                            // its comprehensive activeSelfBuffs are the target's own buffs for the round.
                            if (healTarget && actor.id === healTarget.id) {
                                healTargetBuffs = turn.activeSelfBuffs;
                            }

                            // Record this actor's round-scoped ctx for the enemy's DoT-tick attribution.
                            lastTurnCtxByActor.set(actor.id, turn.turnCtx);
                            // SP-D: record this cast's footprint size (aoeVictimIds — undefined in
                            // DPS/non-positional mode → default 1) for the enemies-hit-this-cast
                            // drain-time gate.
                            enemiesHitThisCastByActor.set(
                                actor.id,
                                focusTurnArgs.aoeVictimIds?.length ?? 1
                            );

                            // Extra-action grants from this turn bump the attacker's pending-action
                            // count, so selectNextBySpeed re-picks it at its live speed-rank (full extra
                            // turn — charge cadence, post-turn decrement, and triggers all run again on
                            // the re-picked iteration).
                            // The extra turn intentionally re-fires statusEngine.sourceFired too:
                            // re-applying timed buffs, adding persistent stacks, and ticking
                            // accumulators are all correct for a real second turn.
                            processExtraActionGrants(actor, turn.extraActionGrants);
                        } else if (actor.id === focusActorId) {
                            // The focus killed itself with its own timed burst → synthesize a
                            // no-action focus turn so the post-round focusTurns.length guard does
                            // not throw (it did not act). A walked-team actor is never the focus.
                            pushSynthesizedFocusSkipTurn();
                        } // end dead-after-burst guard (!burstDestroyedActor)
                    } else {
                        // Stasised focus/attacker turn: skip the action body.
                        // §4.3 STASIS GATE (B2 Task 3).
                        // §4.5 Deferred break: consume any pending Stasis break so this actor
                        // acts on their NEXT scheduled turn. The break was pre-approved by a
                        // direct hit in an earlier turn this round (stored in stasisBreakPending
                        // after verifying the attacker did NOT re-inflict Stasis that same turn).
                        // Consuming here (in the skip body) ensures the CURRENT skip still runs —
                        // the victim misses this turn, then is free from the next round onward.
                        if (stasisBreakPending.has(actor.id)) {
                            stasisBreakPending.delete(actor.id);
                            for (const name of STASIS_BUFFS)
                                statusEngine.reduceTimedEnemyStatus(actor.id, name);
                        }
                        // Synthesize a minimal no-action result so the post-round
                        // `focusTurns.length` guard does not throw (the focus actor
                        // was stasised — it did not act, but the round must still assemble).
                        // Delegated to pushSynthesizedFocusSkipTurn (E5 §4.4 DRY helper).
                        if (actor.id === focusActorId) {
                            pushSynthesizedFocusSkipTurn();
                        }
                    } // end stasis gate (attacker branch)
                } else if (actor.kind === 'team' && teamRuntimeById.has(actor.id)) {
                    // ====================================================================
                    // WALKED TEAM TURN — a real speed-ordered ally that runs the FULL
                    // runPlayerTurn pipeline (its own gates/stats/skills). Its damage reduces
                    // enemy HP but is reported separately (teamDamage); runPlayerTurn also calls
                    // statusEngine.sourceFired(actor.id, …) internally, so this actor's manual
                    // extras (TeamActorInput.selfBuffs/enemyDebuffs) still apply on its turns —
                    // the legacy sourceFired block below is fully superseded for walked actors.
                    // ====================================================================
                    // §4.3 STASIS GATE (B2 Task 3): a stasised walked-team actor skips its action
                    // body. The DoT-tick prologue (healTarget branch above) and Post-Turn decrements
                    // (below) still run. A walked team actor is never the focus → no focusTurns
                    // synthesis needed (no-else). §4.3 deviation: skip action, decrement preserved.
                    if (!isTurnBlocked(actor.id)) {
                        // D-PR14: first REAL activation of the round (Stasis/Disable-skipped
                        // actors never enter these blocks). ??= writes once.
                        firstActivatorId ??= actor.id;

                        // PR-B: per-positioned-player timed burst (walked-team ally). Same as the
                        // focus site; no focusTurns synthesis (a walked-team actor is never the
                        // focus). tickDoTs added ahead by PR-C.
                        applyPositionedTimedBurst(actor, sink, enemyAttackerActors);
                        const burstDestroyedActor =
                            actor.destroyedRound !== undefined &&
                            !(healTarget && actor.id === healTarget.id);
                        if (!burstDestroyedActor) {
                            // Positional target selection (Task C2, GATED). Mirrors the focus-turn
                            // branch (C1) but keyed to THIS team actor's own board position
                            // (`actor.position`) and parsed target (`teamTargetById` lookup), not the
                            // focus attacker's. When `selectedTeamEnemy` is null — not positional, no
                            // parsed target, or no living positioned enemy — we diverge NOTHING from the
                            // legacy dummy `enemy` binding. No existing test threads a team target →
                            // this branch never fires for them (goldens byte-identical).
                            // SP-F F5: charge-aware (mirrors the focus site) — resolve BOTH the
                            // target and the footprint pattern from the CHARGED axes on a
                            // charge-firing turn (each falls back to the active axis when unset).
                            const teamWillFireCharged = willFireChargedFor(actor);
                            const teamTarget = teamWillFireCharged
                                ? parsedChargedTargetFor(actor)
                                : parsedTargetFor(actor);
                            // Same `tgt` consolidation as the focus turn: both branches are full
                            // CombatActors, so every per-target binding derives from `tgt` uniformly.
                            // Legacy path tgt === enemy, whose stats/containers ARE the legacy module
                            // vars (enemyDefense/enemyHp/corrosionEntries/…) → byte-identical.
                            const { tgt } = selectTurnTarget(actor);
                            // Player side's legacy victim is the always-present dummy `enemy` sink →
                            // `tgt` is never undefined here (type-narrowing no-op; selectTurnTarget
                            // widened for the enemy side in SP-U U5 R6).
                            if (tgt === undefined) continue;
                            const teamPattern = teamWillFireCharged
                                ? parsedChargedPatternFor(actor)
                                : parsedPatternFor(actor);
                            // §4.5: inject break hook into runPlayerTurn (mirrors focus site).
                            // §4.5 Akula exception: if the ACTING ATTACKER has doesntBreakStasis,
                            // the victim is never recorded → no break-mark, no stasisBreakPending.
                            const teamTgtWasStasised =
                                !actor.doesntBreakStasis && isStasised(tgt.id);
                            const teamTurnStasisHitVictims = new Set<string>();
                            // Task 5 (per-victim crit signal): predict positional apply (mirror of the
                            // focus site) so runPlayerTurn defers its inline ability-performed emit.
                            const teamWillApplyPositionally =
                                isPositional(actor.position, enemyAttackerActors) &&
                                teamTarget != null &&
                                teamPattern != null;
                            // Sub-project I, PR I2: pre-turn snapshot (mirrors the focus site).
                            const teamPreTurnVictimStatus =
                                snapshotPreTurnVictimStatus(enemyAttackerActors);
                            const teamTurnArgs = buildTurnArgs(actor, tgt);
                            const teamTurn = runPlayerTurn({
                                ...teamTurnArgs,
                                deferAbilityPerformedToEngine: teamWillApplyPositionally,
                                onHitBreakStasis: teamTgtWasStasised
                                    ? (targetId: string) => {
                                          teamTurnStasisHitVictims.add(targetId);
                                      }
                                    : undefined,
                            });
                            if (teamTurnStasisHitVictims.size > 0) {
                                const reInflictedStasis = teamTurn.inflictedEnemyDebuffs.some(
                                    (ab) => isStasis(ab.buffName)
                                );
                                if (!reInflictedStasis) {
                                    for (const victimId of teamTurnStasisHitVictims) {
                                        stasisBreakPending.set(victimId, true);
                                    }
                                }
                            }

                            // Positional APPLY (Task 8b, GATED) — mirror of the focus site, keyed to THIS
                            // team actor's own position / parsed target (teamTargetById) / parsed pattern
                            // (teamPatternById). Drives the per-victim apply loop against the LIVE enemy
                            // roster when this walked team actor is positional, has a parsed target, AND its
                            // firing hit produced scalars. No production caller threads these yet → false for
                            // every existing test/golden → byte-identical.
                            // The pattern (teamPatternById) is REQUIRED for footprint expansion — without
                            // it there is no apply to perform (the positionalSelection C2 test sets
                            // position+target only, never a pattern, so it keeps the legacy single-sink
                            // credit and never enters this branch).
                            const teamPositional =
                                isPositional(actor.position, enemyAttackerActors) &&
                                teamTarget != null &&
                                teamPattern != null &&
                                teamTurn.positionalScalars != null;
                            if (teamPositional) {
                                // Same direction as the focus site (player→enemy); keyed to THIS team
                                // actor's position / parsed target / parsed pattern. Non-null via the gate.
                                // SP-U U2: shared drivePositionalTurnApply helper (mirror of the focus
                                // site, keyed to THIS walked team actor as the acting attacker) — injects
                                // the player→enemy STANDING leech and emits the per-victim `attacked`
                                // inline (before detonation).
                                const tb = turnBindings(actor.side);
                                drivePositionalTurnApply(
                                    actor,
                                    tb,
                                    {
                                        tgt,
                                        pattern: teamPattern,
                                        target: teamTarget,
                                        preTurnVictimStatus: teamPreTurnVictimStatus,
                                        scalars: teamTurn.positionalScalars!,
                                        hitCrits: teamTurn.hitCrits,
                                        perVictimOutgoing: teamTurn.perVictimOutgoing,
                                        rollVictimCrit: teamTurn.rollVictimCrit,
                                        deferredAbilityPerformed: teamTurn.deferredAbilityPerformed,
                                        positionalDetonation: teamTurn.positionalDetonation,
                                    },
                                    (_victim, damage) =>
                                        procStandingLeechesPerVictim(actor.id, damage),
                                    (attackedSignals) => {
                                        if (attackedSignals.size > 0) {
                                            emitPerVictimAttacked({
                                                bus,
                                                round: r,
                                                attackerId: actor.id,
                                                primaryId: tgt.id,
                                                victims: attackedSignals,
                                            });
                                        }
                                    }
                                );
                            }
                            // Clause order — mirror of the focus site (see flushDeferredEnemyApplications).
                            flushDeferredEnemyApplications(teamTurn.deferredEnemyApplications);

                            // Fold the team turn's damage into ITS OWN map entry (post-round assembly
                            // sums all non-focus entries into teamDamage). secondary/conditional are
                            // sub-buckets of direct (do NOT double-add) but kept distinct for the
                            // simulator-page seam.
                            //
                            // Credit SUPPRESSION for the positional case (Task 8b): same as the focus site —
                            // the firing-hit damage already landed per-victim via applyPositionalDamage, so
                            // skip the direct/secondary/conditional credit; KEEP detonation (bombs are out
                            // of scope). The single-sink decline that used to be zeroed for the positional
                            // path is now derived from the victim's own currentHp inside runPlayerTurn
                            // (PR6b), so no separate decline suppression is needed here.
                            const td = dmg(actor.id);
                            if (!teamPositional) {
                                td.secondary += teamTurn.secondaryDamage;
                                td.conditional += teamTurn.conditionalDamage;
                                creditDamage(actor.id, 'direct', teamTurn.directDamage);
                                // Detonation credit is suppressed in positional mode (teamTurn.detonationDamage
                                // is 0 there anyway — runPlayerTurn returns the recipe instead). Keeping it
                                // inside this guard documents intent and keeps per-victim detonation out of
                                // cumulativeDamage (it lands per-victim via applyVictimDamage above).
                                creditDamage(actor.id, 'detonation', teamTurn.detonationDamage);
                            }

                            // The team turn's result row fields (action/roundCrit/etc.) are NOT consumed
                            // beyond damage + resisted routing + ctx. Stage its resisted enemy applications
                            // EXACTLY like the legacy team block: before any focus turn → pendingResisted;
                            // after → the last focus turn's list.
                            if (teamTurn.resistedEnemyDebuffs.length > 0) {
                                const lastTurn = focusTurns[focusTurns.length - 1];
                                if (lastTurn) {
                                    lastTurn.resistedEnemyDebuffs.push(
                                        ...teamTurn.resistedEnemyDebuffs
                                    );
                                } else {
                                    pendingResisted.push(...teamTurn.resistedEnemyDebuffs);
                                }
                            }

                            // Record this team actor's ctx for the enemy's per-entry DoT-tick attribution
                            // (its inferno entries tick with ITS effectiveAttack/dotMult/affinityMult).
                            lastTurnCtxByActor.set(actor.id, teamTurn.turnCtx);
                            // SP-D: record this cast's footprint size (mirrors the focus site).
                            enemiesHitThisCastByActor.set(
                                actor.id,
                                teamTurnArgs.aoeVictimIds?.length ?? 1
                            );

                            // Heal-target buffs: a walked team actor that IS the heal target surfaces its
                            // own comprehensive activeSelfBuffs (incl. recurring Cheat Death/Everliving Regen).
                            if (healTarget && actor.id === healTarget.id) {
                                healTargetBuffs = teamTurn.activeSelfBuffs;
                            }

                            processExtraActionGrants(actor, teamTurn.extraActionGrants);
                        } // end dead-after-burst guard (!burstDestroyedActor)
                    } else {
                        // §4.5 Deferred break: consume any pending Stasis break (team skip).
                        if (stasisBreakPending.has(actor.id)) {
                            stasisBreakPending.delete(actor.id);
                            for (const name of STASIS_BUFFS)
                                statusEngine.reduceTimedEnemyStatus(actor.id, name);
                        }
                    } // end stasis gate (walked-team branch)
                } else if (actor.kind === 'enemy' && actor.id === enemy.id) {
                    // ====================================================================
                    // ENEMY TURN — ticks the DoT containers it carries, per-entry attributed
                    // to the entry's APPLIER. DoTs tick at the start of the afflicted ship's
                    // turn. At default speeds every player acted earlier THIS round (apply/
                    // detonate done, ctx set), so the enemy ticks with this round's contexts.
                    // An entry whose applier has no ctx yet (faster-enemy round 1) is skipped.
                    // Per-entry `+=` into dmg(sourceId): at attacker-only there is exactly one
                    // applier per round → identical totals to the old single-writer assignment.
                    // ====================================================================
                    tickDoTs({
                        corrosionEntries,
                        infernoEntries,
                        genericDoTEntries,
                        enemyHp,
                        ctxFor: (sourceId) => lastTurnCtxByActor.get(sourceId),
                        emitTicked: (dotType, damage, stacks, tier) =>
                            bus.emit({
                                type: 'dot-ticked',
                                targetId: enemy.id,
                                round: r,
                                dotType,
                                damage,
                                stacks,
                                tier,
                            }),
                        credit: (sourceId, dotType, damage) =>
                            creditDamage(sourceId, dotType, damage),
                        // PR I4b: the dummy sink `enemy` is the ticking victim.
                        dotMultFor: (ctx) => victimDotMult(ctx, enemy),
                    });

                    // Bombs: per-entry burst credited to the applier's detonation channel,
                    // using the applier's snapshotted affinityMult. bomb-detonated actorId is
                    // the applier (per-actor attribution).
                    processBombs({
                        pendingBombs,
                        emitBombDetonated: (actorId, stacks, damage) =>
                            bus.emit({
                                type: 'bomb-detonated',
                                actorId,
                                victimId: enemy.id,
                                round: r,
                                stacks,
                                damage,
                            }),
                        creditDetonation: (sourceId, damage) =>
                            creditDamage(sourceId, 'detonation', damage),
                    });

                    // Accumulators: the gather INPUT is the summed direct damage of ALL players
                    // this round (spec: Echoing Burst gathers all players' direct); each burst is
                    // credited to its applier's detonation channel.
                    const allPlayersDirect = [...roundDamage.values()].reduce(
                        (s, d) => s + d.direct,
                        0
                    );
                    processAccumulators({
                        pendingAccumulators,
                        allPlayersDirect,
                        creditDetonation: (sourceId, damage) =>
                            creditDamage(sourceId, 'detonation', damage),
                    });
                } else if (actor.kind === 'enemy') {
                    // ====================================================================
                    // ENEMY ATTACKER TURN (healing mode) — a bare-stat offense actor that
                    // bombards the heal target by walking the FULL runPlayerTurn pipeline with
                    // the TARGET bound as the `enemy` arg (Task 6b). Its damage drains shield-first
                    // into the live target via the intake below; self-buffs land in its OWN owner
                    // store; debuffs/DoTs land on the target's per-target store (targetId).
                    // Healing mode is guaranteed here in the current corpus: an enemy attacker only
                    // exists under an explicit heal focus OR a positional team battle (whose focus
                    // anchor makes healTarget defined), so healTarget is defined whenever this branch
                    // runs today. A future real DPS enemy (SP-U 5a) with neither will take the
                    // no-victim cadence-only skip before reaching the heal-target-dependent paths.
                    //
                    // DEAD-TARGET GUARD (restores the retired runEnemyAttackerTurn semantic): vs a
                    // dead heal target the enemy must NOT apply debuffs/DoTs or emit application
                    // events to it — but the charge cadence must STILL advance (charges keep banking,
                    // so a revived/re-spawned target would face a correctly-charged attacker). We
                    // therefore SKIP runPlayerTurn entirely when the target is dead (runPlayerTurn is
                    // the sole site that resolves the attack + applies the kit + emits events) and
                    // advance the cadence manually here, mirroring runPlayerTurn's preTurn step
                    // (consume-at-cap-and-reset, else +1) under the old `chargeCount > 0` guard.
                    // ====================================================================
                    // §4.3 STASIS GATE (B2 Task 3): a stasised real-enemy actor skips its
                    // action body. The Post-Turn decrements (below) still run — duration N
                    // therefore skips exactly N actions (decrement fires on the skipped turn).
                    // A stasised enemy banks NO charge (advanceChargeCadence is INSIDE the
                    // action body and is correctly skipped — matches in-game "charges do not
                    // generate while stasised"). §4.3 deviation: skip action, decrement
                    // preserved. No cadence-advance in the skip path.
                    if (!isTurnBlocked(actor.id)) {
                        // D-PR14: first REAL activation of the round (Stasis/Disable-skipped
                        // actors never enter these blocks). ??= writes once.
                        firstActivatorId ??= actor.id;

                        // ============================================================
                        // PR2: PER-POSITIONED-ENEMY TIMED BURST (player → enemy).
                        // ------------------------------------------------------------
                        // The focus-dummy `:4794` path bursts ONLY the dummy's own timed
                        // containers. A real POSITIONED enemy victim is its own turn-taking
                        // actor carrying its OWN pendingBombs/pendingAccumulators (seeded by
                        // the player's earlier bomb/accumulator applications). Those timed
                        // containers count down + burst at the START of THIS enemy's turn —
                        // against ITS OWN HP — via `applyVictimDamage` (the same per-victim
                        // sink PR1's skill-detonation + bomb-splash-on-death #161 use). The
                        // burst is NEVER routed through `creditDamage(actor.id,'detonation')`:
                        // that feeds `cumulativeDamage`→the focus-dummy HP overwrite (`:5432`),
                        // which would double-hit (HP already drained inside applyVictimDamage).
                        //
                        // GATE: only a POSITIONED enemy (enemy-site positional sense — the same
                        // `isPositional(actor.position, allPlayerActors)` predicate the firing-hit
                        // gate uses at `enemyPositional`/`:5011`) that actually carries timed
                        // entries. The non-empty guard makes this a STRICT no-op (byte-identical)
                        // for every existing fixture — none seed enemy-actor timed containers.
                        // Stasis: this burst sits INSIDE the `!isTurnBlocked` gate, so a stasised/
                        // disabled positioned enemy does NOT burst this turn (its whole turn is
                        // skipped per the locked combat rule).
                        applyPositionedTimedBurst(actor, sink, allPlayerActors);

                        // Dead-after-burst guard (spike Fact 3): a lethal timed burst above
                        // fires recordDestroyed inside applyVictimDamage, but the loop's
                        // top-of-turn dead-skip (`:4185`) already ran BEFORE this turn body, so
                        // it cannot catch a same-turn death. A ship the burst just destroyed must
                        // not act — skip the whole action-resolution body. We key off
                        // `destroyedRound` (the canonical death signal stamped by recordDestroyed),
                        // NOT `currentHp > 0`: a bare enemy ATTACKER carries no HP stat
                        // (`currentHp` undefined), yet still acts — only a recordDestroyed stamp
                        // means the burst actually killed it this turn. The healTarget exception
                        // mirrors the `:4185` top-of-turn guard so a dead heal-target enemy still
                        // runs its cadence-only body. The post-turn decrements / `turn-ended`
                        // AFTER this `if/else` still run (a dead ship's turn still consumed its
                        // slot; bomb-splash-on-death already chained inside applyVictimDamage).
                        const burstDestroyedActor =
                            actor.destroyedRound !== undefined &&
                            !(healTarget && actor.id === healTarget.id);
                        if (!burstDestroyedActor) {
                            const enemyRuntime = runtimeFor(actor);
                            // SP-F F5: predict whether THIS enemy turn will fire its CHARGED skill
                            // — the exact same predicate runPlayerTurn's own action decision reads
                            // (playerTurn.ts:~1044). Safe here because advanceChargeCadence (which
                            // consumes/resets the charge) runs INSIDE runPlayerTurn, AFTER the
                            // decision. Drives the charge-aware target/pattern resolution below AND
                            // (renamed from the former inline `enemyWouldFireAction` derivation)
                            // the dead-target firing-skill check just below.
                            const enemyWillFireCharged =
                                enemyRuntime.hasChargedSkill && actor.charges >= actor.chargeCount;
                            // Positional target selection (Task C3, side-symmetric, GATED). Mirrors the
                            // focus-turn (C1) and team-turn (C2) branches, but the OPPOSING roster from the
                            // enemy's view is the PLAYER TEAM (`allPlayerActors` = focus + walked team), the
                            // acting position is THIS enemy's board position (`actor.position`), and its
                            // parsed target rides on `enemyTargetById` (keyed by enemy actor id). When
                            // the selection is null — not positional, no parsed target, or no living
                            // positioned player — we diverge NOTHING from the legacy `healTarget` victim
                            // binding: the enemy's whole turn (defence/hp/decline lookup, the runPlayerTurn
                            // bind, AND the applyIncomingToTarget intake) reads `tgt === healTarget!`, so
                            // every existing path stays byte-identical. No existing test threads an enemy
                            // target → this branch never fires for them.
                            // SP-F F5: resolve from the CHARGED target axis on a charge-firing turn
                            // (falls back to the active target when unset → byte-identical).
                            const enemyTarget = enemyWillFireCharged
                                ? parsedChargedTargetFor(actor)
                                : parsedTargetFor(actor);
                            // The enemy's victim THIS turn: the positionally-selected player actor, else the
                            // legacy heal target. A full CombatActor in both cases, so every per-victim
                            // binding below derives from `tgt` uniformly (defence/maxHp/decline, the
                            // runPlayerTurn `enemy`+containers, and the applyIncomingToTarget intake).
                            const { tgt } = selectTurnTarget(actor);
                            // Narrowed dead-legacy-victim skip: a dead `tgt` only forces the
                            // cadence-only short-circuit below when the actor's WOULD-BE firing
                            // skill actually needs a living opposing victim (a `damage` ability,
                            // or any enemy-facing ability — debuff/dot/purge/control/etc.). An
                            // ally-targeted support cast (buffs/shields/heals only) never reads
                            // `tgt`'s HP/defence, so it must still fire even when the legacy
                            // binding (simulateBattle's vestigial focus-player healTargetId) is
                            // dead — otherwise every ally-targeted enemy caster permanently stops
                            // acting the moment the focus player dies (bug repro:
                            // twoTeamBattle.test.ts "bug repro: enemy supporter turn skipped
                            // after the focus player dies"). Mirrors runPlayerTurn's OWN action
                            // selection (preTurn, playerTurn.ts) exactly so the predicate inspects
                            // the SAME skill that would actually fire. (SP-F F5: now sourced from
                            // the single shared enemyWillFireCharged boolean above.)
                            const enemyWouldFireAction: 'active' | 'charged' = enemyWillFireCharged
                                ? 'charged'
                                : 'active';
                            const enemyFiringSkillForDeadCheck = selectFiringSkill(
                                enemyRuntime.castSkills,
                                enemyWouldFireAction
                            );
                            const skipDeadTargetTurn =
                                tgt !== undefined &&
                                tgt.currentHp <= 0 &&
                                skillNeedsOpposingVictim(enemyFiringSkillForDeadCheck);
                            // This enemy attacker's parsed pattern (Task 9) — REQUIRED for the enemy-site
                            // positional apply (footprint expansion). An enemy with a target but NO pattern
                            // stays on the legacy single-apply path (same `pattern != null` guard as the
                            // focus/team sites). Undefined for every current fixture → enemyPositional false.
                            // SP-F F5: resolve from the CHARGED pattern axis on a charge-firing turn
                            // (falls back to the active pattern when unset → byte-identical).
                            const enemyPattern = enemyWillFireCharged
                                ? parsedChargedPatternFor(actor)
                                : parsedPatternFor(actor);
                            let damage = 0;
                            // Hoisted for use in the post-else `attacked` emit (Task 8): enemyTurn is
                            // scoped inside the else block below; this flag carries its roundCrit out.
                            let enemyTurnDidCrit = false;
                            // H1 T4: the detonation slice of `damage` (enemyTurn.detonationDamage),
                            // hoisted out of the else block so the post-else apply call can pass it as
                            // `bombPortion` (the bomb portion drains the shield in FULL, no penetration).
                            // Stays 0 on the dead-target path and for any bare enemy with no detonate().
                            let enemyDetonationDamage = 0;
                            // Hoisted for per-hit `attacked` emission (Phase 4c Task 3): populated from
                            // enemyTurn.hitCrits in the ship-backed branch; stays [] on the dead-target
                            // path and on the manual flat-enemy path (which has no hitCrits to surface).
                            let enemyHitCrits: boolean[] = [];
                            // Hoisted positional-apply state (Task 9): the enemy-site mirror of the focus/team
                            // sites. enemyPositional gates BOTH the drivePositionalApply call AND the single-
                            // apply suppression below; enemyScalars carries this turn's firing-hit scalars out
                            // of the else block (enemyTurn is scoped inside it). Both stay false/null on the
                            // dead-target path and whenever the enemy is non-positional → legacy single-apply.
                            let enemyPositional = false;
                            let enemyScalars: AttackerDamageScalars | undefined;
                            // Sub-project I, PR I2: the enemy turn's per-victim outgoing-modifier
                            // ingredients, hoisted out of the else block (enemyTurn is scoped inside
                            // it) so the enemy drivePositionalApply site can pass it. Undefined on the
                            // dead-target / non-positional paths → perVictimOutgoingDeltaPct returns 0
                            // for every victim (byte-identical).
                            let enemyPerVictimOutgoing: PlayerTurnResult['perVictimOutgoing'];
                            // Sub-project I, PR I2: the pre-turn per-victim status snapshot
                            // (team-symmetric mirror of the focus/team sites' preTurnVictimStatus),
                            // captured just before `runPlayerTurn` below mutates the status engine.
                            let enemyPreTurnVictimStatus:
                                | Map<string, PreTurnVictimStatusSnapshot>
                                | undefined;
                            // Per-victim crit: the enemy turn's per-victim crit resolver, hoisted out
                            // of the else block (enemyTurn is scoped inside it) so the enemy
                            // drivePositionalApply site can pass it. Undefined on the dead-target /
                            // non-positional paths → covered victims fall back to hitCrits (byte-identical).
                            let enemyRollVictimCrit:
                                | ((victimAffinity: AffinityName) => boolean)
                                | undefined;
                            // PR3: the per-victim detonation recipe for the enemy positional path,
                            // hoisted out of the else block (enemyTurn is scoped inside it). When the
                            // enemy fires a positional detonate skill, runPlayerTurn returns the recipe
                            // (detonationDamage 0) and the per-victim loop at the enemy drivePositionalApply
                            // site consumes it. Stays undefined on the dead-target path and for any bare
                            // enemy with no detonate() → the loop never runs (byte-identical).
                            let enemyPositionalDetonation: DetonationRecipe | undefined;
                            // Task 5 (per-victim crit signal): the enemy turn's deferred ability-performed
                            // payload, hoisted out of the else block (enemyTurn is scoped inside it) so the
                            // enemy drivePositionalApply site can emit it post-apply with the true per-victim
                            // crit signal. Present ⟺ enemyPositional true (same suppression condition).
                            let enemyDeferredAbilityPerformed: PlayerTurnResult['deferredAbilityPerformed'];
                            // Intra-cast clause order: the enemy cast's held-back enemy-debuff
                            // landings, hoisted for the same reason as the payload above (enemyTurn is
                            // scoped inside the else block) so the flush can run after this turn's
                            // damage — positional or not. Empty for a dead-target/flat-card turn.
                            let enemyDeferredApplications: PlayerTurnResult['deferredEnemyApplications'] =
                                [];
                            // Task 5: the per-victim crit aggregate from the enemy positional apply, hoisted
                            // out of the `if (damage > 0)` block. Present only when the positional apply
                            // actually ran; when the enemy turn is positional but deals 0 damage (apply
                            // skipped), the deferred emit below falls back to the anchor-based crit values
                            // (byte-identical to the pre-Task-5 inline emit for that 0-damage edge case).
                            let enemyCritAgg:
                                | { anyCrit: boolean; critPairs: number; critVictimIds: string[] }
                                | undefined;
                            // Task 5: predict enemy positional apply (mirror of focus/team) so runPlayerTurn
                            // defers its inline ability-performed emit. The opposing roster from the enemy's
                            // view is the PLAYER team (allPlayerActors).
                            const enemyWillApplyPositionally =
                                isPositional(actor.position, allPlayerActors) &&
                                enemyTarget != null &&
                                enemyPattern != null;
                            // §4.5: inject break hook into runPlayerTurn for the enemy turn (mirrors
                            // focus/team sites). Captured BEFORE runPlayerTurn so Stasis re-applied
                            // by the same attack's debuff ability is not inadvertently broken.
                            // §4.5 Akula exception: if the ACTING ATTACKER has doesntBreakStasis,
                            // the victim is never recorded → no break-mark, no stasisBreakPending.
                            const enemyTgtWasStasised =
                                !actor.doesntBreakStasis && tgt !== undefined && isStasised(tgt.id);
                            const enemyTurnStasisHitVictims = new Set<string>();
                            const enemyBreakHook = enemyTgtWasStasised
                                ? (targetId: string) => {
                                      enemyTurnStasisHitVictims.add(targetId);
                                  }
                                : undefined;
                            if (skipDeadTargetTurn || tgt === undefined) {
                                // Cadence-only: bank a charge (or fire+reset at cap) without resolving the
                                // attack. Mirrors runPlayerTurn's preTurn charge step. No skill-fired/
                                // application events — a dead target is untouched (old short-circuit).
                                // The `&& actor.chargeCount > 0` term is redundant (hasChargedSkill already
                                // implies chargeCount >= 1); the helper's internal guard handles it.
                                // SP-U U5 (R6 decouple): `tgt === undefined` — no positional target AND no
                                // legacy heal anchor — takes this same cadence-only skip (the enemy has no
                                // victim this turn). Never reached in the existing corpus (the heal anchor is
                                // always defined when an enemy attacker acts); the `else` below narrows `tgt`
                                // to a defined CombatActor for the whole real-turn body.
                                advanceChargeCadence(actor, enemyRuntime.hasChargedSkill, bus, r);
                                // No enemyTurn → no lastTurnCtxByActor update (parity: the old dead path
                                // produced no ctx either; this actor has no live DoTs to attribute).
                            } else {
                                // D-PR3 Task 9: victim-side incoming %-reduction against the bound
                                // target on the AGGREGATE (non-positional) damage path — Iridium-as-tank.
                                // `tgt` is the victim (healTarget on the legacy path); `actor` is the
                                // acting enemy attacker. The non-crit baseline is the reduction with
                                // didCrit:false; the crit-family DELTA is the extra reduction a crit adds.
                                // Guarded by length so a victim with no incoming abilities passes 0/0 →
                                // byte-identical. (The positional enemy path applies its own per-sub-hit
                                // reduction via drivePositionalApply; this fold serves the legacy single-apply.)
                                const tgtIncoming = incomingAbilitiesOf(tgt.id);
                                const incomingReductionNonCritPct = tgtIncoming.length
                                    ? incomingReductionForHit(tgtIncoming, {
                                          didCrit: false,
                                          attackerStealthed: isStealthed(actor.id),
                                          victimStealthed: isStealthed(tgt.id),
                                          victimStasised: isStasised(tgt.id),
                                          hitIndexThisRound: 0,
                                          attackerHasDot: attackerHasDot(actor.id),
                                          victimHasBarrierRecharging: hasBarrierRecharging(tgt.id),
                                          victimHasShield: hasShield(tgt.id),
                                          selfHpPct: selfHpPctOf(tgt.id),
                                          attackerTauntedOrProvoked: attackerTauntedOrProvoked(
                                              actor.id
                                          ),
                                      })
                                    : 0;
                                const incomingReductionCritAll = tgtIncoming.length
                                    ? incomingReductionForHit(tgtIncoming, {
                                          didCrit: true,
                                          attackerStealthed: isStealthed(actor.id),
                                          victimStealthed: isStealthed(tgt.id),
                                          victimStasised: isStasised(tgt.id),
                                          hitIndexThisRound: 0,
                                          attackerHasDot: attackerHasDot(actor.id),
                                          victimHasBarrierRecharging: hasBarrierRecharging(tgt.id),
                                          victimHasShield: hasShield(tgt.id),
                                          selfHpPct: selfHpPctOf(tgt.id),
                                          attackerTauntedOrProvoked: attackerTauntedOrProvoked(
                                              actor.id
                                          ),
                                      })
                                    : 0;
                                // F3: crit-conditional pre-fight damage modifiers, mirrored from
                                // the positional incomingReductionFor site (crit hits only, via
                                // the crit-family delta). Same sign convention: the channel is a
                                // REDUCTION, leader values are benefit/penalty-phrased, so both
                                // terms are negated (victim incomingCritDamage -10 → +10 reduction
                                // on crits; attacker outgoingCritDamage -10 → its crits deal 10%
                                // less). Absent → 0 → byte-identical.
                                const preFightCritFamilyPct =
                                    -(tgt.preFight?.incomingCritDamage ?? 0) -
                                    (actor.preFight?.outgoingCritDamage ?? 0);
                                const incomingReductionCritFamilyPct =
                                    incomingReductionCritAll -
                                    incomingReductionNonCritPct +
                                    preFightCritFamilyPct;
                                // Sub-project I, PR I2: snapshot BEFORE runPlayerTurn (the enemy's
                                // opposing roster is the PLAYER team — allPlayerActors).
                                enemyPreTurnVictimStatus =
                                    snapshotPreTurnVictimStatus(allPlayerActors);
                                const enemyTurnArgs = buildTurnArgs(actor, tgt);
                                const enemyTurn = runPlayerTurn({
                                    ...enemyTurnArgs,
                                    deferAbilityPerformedToEngine: enemyWillApplyPositionally,
                                    onHitBreakStasis: enemyBreakHook,
                                    incomingReductionNonCritPct,
                                    incomingReductionCritFamilyPct,
                                });
                                // §4.5: resolve Stasis break for player victims hit by this enemy.
                                if (enemyTurnStasisHitVictims.size > 0) {
                                    const reInflictedStasis = enemyTurn.inflictedEnemyDebuffs.some(
                                        (ab) => isStasis(ab.buffName)
                                    );
                                    if (!reInflictedStasis) {
                                        for (const victimId of enemyTurnStasisHitVictims) {
                                            stasisBreakPending.set(victimId, true);
                                        }
                                    }
                                }
                                // Total damage the enemy dealt to the bound target this turn. secondary/
                                // conditional are display sub-buckets ALREADY inside directDamage (do NOT
                                // re-add). detonationDamage is the player-turn detonate() portion (0 for a bare
                                // enemy). Credit it as INCOMING damage to the tank — NOT a player damage row.
                                damage = enemyTurn.directDamage + enemyTurn.detonationDamage;
                                // H1 T4: hoist the detonation slice for the post-else apply (bombPortion).
                                enemyDetonationDamage = enemyTurn.detonationDamage;
                                // Hoist roundCrit into the outer scope for the `attacked` emit (Task 8).
                                enemyTurnDidCrit = enemyTurn.roundCrit;
                                // Hoist per-hit crit array for the per-hit `attacked` emit (Phase 4c Task 3).
                                enemyHitCrits = enemyTurn.hitCrits;
                                // Positional gate (Task 9, enemy site): mirror of the focus/team gates, but
                                // the OPPOSING roster from the enemy's view is the PLAYER team
                                // (allPlayerActors), the parsed target rides on enemyTargetById, and the
                                // parsed pattern on enemyPatternById. When true, the firing-hit damage lands
                                // per-victim via drivePositionalApply (below) against the live player roster
                                // and the legacy single-apply is SUPPRESSED. No production caller threads
                                // position+target+pattern for an enemy yet → false for every golden.
                                enemyPositional =
                                    isPositional(actor.position, allPlayerActors) &&
                                    enemyTarget != null &&
                                    enemyPattern != null &&
                                    enemyTurn.positionalScalars != null;
                                enemyScalars = enemyTurn.positionalScalars;
                                // Sub-project I, PR I2: capture the enemy turn's per-victim
                                // outgoing-modifier ingredients (team-symmetric mirror of the
                                // focus/team sites).
                                enemyPerVictimOutgoing = enemyTurn.perVictimOutgoing;
                                // Per-victim crit: capture the enemy turn's per-victim crit resolver.
                                enemyRollVictimCrit = enemyTurn.rollVictimCrit;
                                // Task 5: capture the deferred ability-performed payload (present ⟺ the
                                // enemy inline emit was suppressed, i.e. enemyPositional true).
                                enemyDeferredAbilityPerformed = enemyTurn.deferredAbilityPerformed;
                                // Clause order: capture the held-back landings for the post-damage flush.
                                enemyDeferredApplications = enemyTurn.deferredEnemyApplications;
                                // PR3: capture the per-victim detonation recipe (returned whenever
                                // `positional: true` was set for this enemy turn — see the positional
                                // hint gate). Consumed by the enemy-site per-victim detonation loop below.
                                enemyPositionalDetonation = enemyTurn.positionalDetonation;
                                // Record the enemy actor's round-scoped ctx (parity with player/team branches;
                                // its own future DoT entries would tick with this ctx).
                                lastTurnCtxByActor.set(actor.id, enemyTurn.turnCtx);
                                // SP-D: record this cast's footprint size (mirrors the focus/team sites).
                                enemiesHitThisCastByActor.set(
                                    actor.id,
                                    enemyTurnArgs.aoeVictimIds?.length ?? 1
                                );
                                // Surface this enemy attacker's effects for the UI's round overview (Task 10a):
                                // its own active self-buffs and the debuffs it landed on the heal target,
                                // ATTRIBUTED to this enemy's actor id. NAMES ONLY for display — never folded
                                // into any sim value. Empty for a bare enemy → no entry recorded for it.
                                // Debuffs use inflictedEnemyDebuffs (source-accurate: only what THIS enemy
                                // applied this turn) rather than landedEnemyDebuffs (the shared per-target
                                // window, which would leak other attackers' debuffs into this enemy's group).
                                // resistedEnemyDebuffs = the TIMED debuffs THIS enemy attempted but were
                                // resisted by its hacking-vs-security landing roll (display-only — Task R1).
                                // resistedEnemyDots = the DoTs THIS enemy attempted this turn that were
                                // resisted by the SAME landing roll (the whole turn's DoTs share one
                                // dotsLanded draw — all land or all miss together). Only corrosion/inferno
                                // are modelled by EnemyDoTState; any bomb entry is skipped (display-only —
                                // Task R3).
                                // The guard also fires on resists alone so a fully-resisted enemy (nothing
                                // landed) still gets an entry and surfaces its resisted debuffs/DoTs.
                                const resistedEnemyDots: EnemyDoTState[] =
                                    !enemyTurn.dotsLanded && enemyTurn.dotsConfig.length > 0
                                        ? enemyTurn.dotsConfig
                                              .filter(
                                                  (d) =>
                                                      d.type === 'corrosion' || d.type === 'inferno'
                                              )
                                              .map((d) => ({
                                                  type: d.type as 'corrosion' | 'inferno',
                                                  tier: d.tier,
                                                  stacks: d.stacks,
                                              }))
                                        : [];
                                if (
                                    enemyTurn.activeSelfBuffs.length > 0 ||
                                    enemyTurn.inflictedEnemyDebuffs.length > 0 ||
                                    enemyTurn.resistedEnemyDebuffs.length > 0 ||
                                    resistedEnemyDots.length > 0
                                ) {
                                    let entry = roundEnemyEffects.get(actor.id);
                                    if (!entry) {
                                        entry = {
                                            selfBuffs: [],
                                            debuffs: [],
                                            resistedDebuffs: [],
                                            resistedDots: [],
                                        };
                                        roundEnemyEffects.set(actor.id, entry);
                                    }
                                    entry.selfBuffs.push(...enemyTurn.activeSelfBuffs);
                                    entry.debuffs.push(...enemyTurn.inflictedEnemyDebuffs);
                                    entry.resistedDebuffs.push(...enemyTurn.resistedEnemyDebuffs);
                                    entry.resistedDots.push(...resistedEnemyDots);
                                }
                                // Extra-action grants: bump this enemy's pending-action count so it is re-picked
                                // for an extra turn (full-actor completeness — mirrors the attacker and walked-team branches).
                                // The oncePerRound / MAX_EXTRA_TURNS_PER_ROUND backstops inside
                                // processExtraActionGrants absorb any runaway grants. grantAllyCharges stays
                                // undefined (enemy's "allies" are enemy-side, not the player team).
                                processExtraActionGrants(actor, enemyTurn.extraActionGrants);
                            }
                            // `tgt !== undefined` narrows the victim for this block (SP-U U5 R6): a
                            // positive `damage` is only produced by the non-skip `else` above, which
                            // runs only when `tgt` is defined — byte-identical (the term is always true
                            // when damage > 0 in the existing corpus).
                            if (damage > 0 && tgt !== undefined) {
                                // Phase-5 per-victim accounting notes (see detailed notes below): (1) the
                                // damage-taken leech now fires PER VICTIM on the positional path too (E2 T5,
                                // procTakenLeechesPerVictim at the enemy site); the non-positional block below
                                // stays gated to `!enemyPositional` and heal-target-only; (2) since PR5b
                                // sink.addIncoming keys each victim's AoE share into ITS OWN per-actor
                                // bucket (the heal-target row is no longer inflated) — surfacing those other
                                // per-actor buckets as result rows is the still-deferred symmetric-accounting
                                // surface.
                                //
                                // Shield-first drain → HP → ship-destroyed → the victim's per-actor bucket. The
                                // shieldBefore/hpDamage are captured for the punch-through gate (Quixilver) below.
                                // hpDamage comes straight from the closure (0 under Barrier — damage fully
                                // blocked, not shield-absorbed — otherwise damage - absorbed). barriered = the
                                // attack was fully blocked by an active Barrier (decision #7, below).
                                // Route the enemy's incoming damage. Two mutually-exclusive paths:
                                //
                                //  - NON-positional (legacy): a SINGLE applyIncomingToTarget(damage, tgt)
                                //    drains the bound victim (tgt === healTarget! on the legacy path → the
                                //    no-arg-equivalent call, byte-identical). Returns the shield/HP/Barrier
                                //    outcome consumed by the damage-taken leech block below.
                                //
                                //  - POSITIONAL (Task 9): drivePositionalApply lands the firing hit per-victim
                                //    across the LIVE PLAYER roster (origin full / covered half) via the
                                //    PLAYER-side applyIncomingToTarget wrapper — each player victim takes REAL
                                //    HP/shield/death damage. The single apply is SUPPRESSED (else the anchor
                                //    victim would be double-hit: once by the AoE loop, once by the single
                                //    apply). enemyPattern is non-null via the enemyPositional gate.
                                //
                                // These aggregate locals feed ONLY the non-positional damage-taken leech
                                // block below; on the positional path they stay at neutral defaults. Per-victim
                                // taken leech on the positional path is now handled by procTakenLeechesPerVictim
                                // (E2 T5), which reads each player victim's OWN {shieldBefore,hpDamage,barriered}
                                // outcome via the onVictimResolved hook — not these heal-target aggregates. The
                                // non-positional path keeps the exact legacy single-target leech values.
                                let shieldBefore = 0;
                                let hpDamage = 0;
                                let barriered = false;
                                let converted = false;
                                // Symmetric shieldWasHit: capture the FOCUS player victim's shield
                                // outcome on the positional path (the non-positional `else` branch binds
                                // shieldBefore/hpDamage/barriered directly; positional leaves them 0).
                                // First-hit-focus victim matched by victim.id === tgt.id; OR'd across the
                                // attack's hits so an early shield-denting hit still counts.
                                let positionalShieldWasHit = false;
                                let positionalShieldCaptured = false;
                                // SP-U U2: the per-victim `attacked` signals from the shared positional
                                // helper, held in the OUTER (enemy-turn) scope because the enemy→player
                                // site emits its per-victim `attacked` AFTER its inline non-positional
                                // damage-taken-leech tail (its row-14 accounting, kept inline → U5) — unlike
                                // the player→enemy sites, which emit inside the helper. Assigned from the
                                // helper return when enemyPositional; stays undefined on the non-positional
                                // path (legacy single emit). The covered-victim Stasis break + detonation
                                // targets are now owned INSIDE the helper.
                                let enemyAttackedSignals: PositionalAttackedSignals | undefined;
                                if (enemyPositional) {
                                    // Opposing roster + victim wrapper from the per-side bindings
                                    // (enemy→player here). PLAYER-side wrapper: each player victim takes
                                    // real incoming damage; every victim's OWN currentHp/shield/death is
                                    // mutated. Since PR5b the sink keys intake by victim.id, so each covered
                                    // victim's AoE share lands in ITS OWN per-actor bucket. This enemy
                                    // positional path IS exercised in production: the sim goldens
                                    // (2v2/3v3/healing) thread enemy positions+patterns so real enemy
                                    // attackers hit player victims here (SP-U U5 corrected the earlier
                                    // "inert — no production caller" note).
                                    // SP-U U2: shared drivePositionalTurnApply helper. The enemy injects the
                                    // enemy→player TAKEN leech (E2 Task 5 — each player victim procs its OWN
                                    // damage-taken heal/shield leech off the damage IT took) PLUS the focus
                                    // victim's shield-hit capture; and it passes a NO-OP emitAttacked because
                                    // the enemy defers its per-victim `attacked` emit to its inline row-14
                                    // tail below (after the non-positional damage-taken-leech block) — see the
                                    // U5 deferral note there. enemyRollVictimCrit is defined whenever
                                    // enemyPositional (captured from enemyTurn.rollVictimCrit in the same
                                    // non-dead block). The helper owns the detonation targets + covered-victim
                                    // Stasis break; it returns critAgg (for the 0-damage deferred-emit
                                    // fallback) and attackedSignals (for the deferred emit).
                                    const tb = turnBindings(actor.side);
                                    const posApply = drivePositionalTurnApply(
                                        actor,
                                        tb,
                                        {
                                            tgt,
                                            pattern: enemyPattern!,
                                            target: enemyTarget!,
                                            preTurnVictimStatus: enemyPreTurnVictimStatus,
                                            scalars: enemyScalars!,
                                            hitCrits: enemyHitCrits,
                                            perVictimOutgoing: enemyPerVictimOutgoing,
                                            rollVictimCrit: enemyRollVictimCrit,
                                            deferredAbilityPerformed: enemyDeferredAbilityPerformed,
                                            positionalDetonation: enemyPositionalDetonation,
                                        },
                                        (victim, dmg, outcome) => {
                                            procTakenLeechesPerVictim(victim, dmg, outcome);
                                            if (victim.id === tgt.id) {
                                                positionalShieldCaptured = true;
                                                positionalShieldWasHit =
                                                    positionalShieldWasHit ||
                                                    (!outcome.barriered &&
                                                        !outcome.converted &&
                                                        outcome.shieldBefore > 0 &&
                                                        outcome.hpDamage < dmg);
                                            }
                                        },
                                        // Enemy defers its per-victim `attacked` emit to the inline tail (U5).
                                        () => {}
                                    );
                                    enemyCritAgg = posApply.critAgg;
                                    enemyAttackedSignals = posApply.attackedSignals;
                                } else {
                                    // SP-U U2: the enemy's non-positional INCOMING-damage accounting tail
                                    // (applyIncomingToTarget + the damage-taken heal/shield leech block + the
                                    // single legacy `attacked` emit below) is a different model from the
                                    // player→enemy outgoing credit — it is NOT extracted here; its unification
                                    // is deferred to U5 (real DPS enemy keystone), when the scalar sink dies.
                                    ({
                                        shieldBefore,
                                        hpDamage,
                                        barriered,
                                        converted = false,
                                    } = applyIncomingToTarget(damage, tgt, {
                                        // H1 T4: `damage` = directDamage + detonationDamage (above).
                                        // The detonation slice drains the shield in FULL (no pen);
                                        // only the direct slice respects the attacker's penetration.
                                        killerId: actingActorId,
                                        byDirectDamage: true,
                                        bombPortion: enemyDetonationDamage,
                                    }));
                                    // §4.5: the non-positional firing hit is DIRECT-channel. The Stasis
                                    // break already fired via onHitBreakStasis inside runPlayerTurn
                                    // (before the ability debuffs), so no additional break call needed here.
                                }

                                // Damage-taken procs (per ATTACK, on the aggregate — spec §5): applied
                                // AFTER this attack's drain so the proc never absorbs its own trigger.
                                // raw scales from the FULL attack damage, not the HP portion. Quixilver's
                                // punch-through gate (requiresHpDamage): shield present at attack start
                                // AND HP damage dealt; Malvex is unconditional.
                                // Per-attack (not per-hit): per-hit application would restructure the
                                // shield-drain arithmetic and risk float-float golden churn; the accuracy
                                // delta is below the fidelity of the flat enemy model — on the in-game
                                // verify list (spec §5).
                                // Same heal/shield fold as procStandingLeeches, but the recipient is fixed
                                // to the heal target — the healing-accounting model is single-target. With
                                // positional selection (Task C3) the enemy's HP/shield drain re-routes to the
                                // selected player (`tgt`, above), but these damage-taken HEAL/SHIELD leech
                                // procs still credit the heal target's accounting. Inert unless a player runs
                                // a "when damaged, heal/shield" reactive (the heal target's takenLeechesByOwner
                                // slice non-empty) — no current fixture does — so the legacy path stays
                                // byte-identical. Retargeting the
                                // single-target healing accounting to an arbitrary victim is out of scope for
                                // Phase 2 (incoming-damage routing).
                                // Barrier carve-out (decision #7): an attack FULLY BLOCKED by Barrier deals no
                                // damage taken at all, so its damage-taken procs are skipped entirely — there is
                                // nothing to leech from. (Distinct from a shield absorb, where the convention
                                // still leeches off the full attack: a shield takes the hit, Barrier nullifies it.)
                                //
                                // POSITIONAL SPLIT (E2 T4/T5): taken-leeches are now collected PER OWNER
                                // (takenLeechesByOwner, keyed by each owner's id), but the NON-positional
                                // consumption HERE reads only the heal target's slice — the legacy single-row
                                // healing-accounting model lands every enemy attack on the heal target, so its
                                // values stay byte-identical. The POSITIONAL path no longer defers: each player
                                // victim procs its OWN taken-leech off the damage IT took via
                                // procTakenLeechesPerVictim (wired at the enemy drivePositionalApply site, with
                                // the per-victim Barrier carve-out + requiresHpDamage gate). This block is
                                // gated to `!enemyPositional` so the two paths never double-count. Inert on the
                                // non-positional path unless a player runs a damage-taken reactive in healing
                                // mode (no current fixture does → the heal target's slice is empty).
                                // SP-U U5 (R6 decouple): guard the eager read — `healTarget` can be
                                // undefined once enemy attackers no longer require a heal target
                                // (future real DPS enemy). No heal target ⟹ no taken-leech slice ⟹
                                // the block below is skipped. Byte-identical for the existing corpus
                                // (healTarget always defined when an enemy attacker acts).
                                const healTargetTakenLeeches = healTarget
                                    ? (takenLeechesByOwner.get(healTarget.id) ?? [])
                                    : [];
                                if (
                                    !enemyPositional &&
                                    healTargetTakenLeeches.length > 0 &&
                                    healingCtx &&
                                    !barriered
                                ) {
                                    const rt = runtimesById.get(healTarget!.id);
                                    for (const e of healTargetTakenLeeches) {
                                        if (
                                            e.requiresHpDamage &&
                                            !(shieldBefore > 0 && hpDamage > 0)
                                        ) {
                                            continue;
                                        }
                                        let raw = damage * (e.pct / 100);
                                        if (e.kind === 'heal' && rt) {
                                            raw *= 1 + rt.healModifier / 100;
                                            if (!e.noCrit && rt.activeHealCritGate(rt.crit / 100)) {
                                                raw *= 1 + rt.critDamage / 100;
                                            }
                                        }
                                        if (e.kind === 'heal') {
                                            healingCtx.credit(healTarget!.id, 'directHeal', raw);
                                            const { consumed, overheal } =
                                                healingCtx.applyHealToTarget(raw);
                                            healingCtx.credit(
                                                healTarget!.id,
                                                'effectiveHeal',
                                                consumed
                                            );
                                            healingCtx.credit(healTarget!.id, 'overheal', overheal);
                                        } else {
                                            healingCtx.credit(healTarget!.id, 'shield', raw);
                                            healingCtx.grantShieldToTarget(raw);
                                        }
                                    }
                                }

                                // Per-hit `attacked` (Phase 4c PR 1): one event per hit of the enemy's fired
                                // damage ability, each carrying ITS OWN hit's crit outcome. Emitted after the
                                // aggregate shield-first drain (damage application stays per-attack — spec §3.1),
                                // so every event observes the same post-drain HP/shield state. A turn with
                                // damage > 0 but an empty enemyHitCrits (manual flat enemy, a noCrit damage
                                // ability, or a cast with no damage ability) falls back to one event with the
                                // roundCrit binary — the pre-4c contract.
                                const hitOutcomes =
                                    enemyHitCrits.length > 0 ? enemyHitCrits : [enemyTurnDidCrit];
                                // G PR2: did the attack actually dent the victim's shield this turn?
                                // absorbed = damage - hpDamage when not barriered; shieldBefore>0 guards a
                                // "had a shield" precondition. Non-positional path only (positional leaves
                                // shieldBefore/hpDamage at 0 → false; no fixture threads enemy positions).
                                // Positional path captures the focus victim's per-hit shield outcome
                                // (Step 3); the non-positional else-branch keeps the aggregate fallback.
                                if (enemyPositional) {
                                    // PR7 Task 4: per-victim emit. One `attacked` per footprint player
                                    // victim hit by this enemy cast (isPrimaryTarget only on the anchor,
                                    // tgt.id) → EVERY covered player's on-attacked reactives wake (enemy
                                    // counters land back on it / Second Wind etc.), not just the anchor.
                                    // The gate broadens from "anchor was hit" to "any victim was hit": if
                                    // the anchor whiffs but a covered victim is hit, emission fires for the
                                    // covered victim and no isPrimaryTarget event fires that turn — correct.
                                    // SP-U U2: DEFERRED here (not inside the shared helper) because the enemy
                                    // emits AFTER its non-positional damage-taken-leech tail; enemyAttackedSignals
                                    // is the helper's returned per-victim signals (set whenever enemyPositional).
                                    if (enemyAttackedSignals && enemyAttackedSignals.size > 0) {
                                        emitPerVictimAttacked({
                                            bus,
                                            round: r,
                                            attackerId: actor.id,
                                            primaryId: tgt.id,
                                            victims: enemyAttackedSignals,
                                        });
                                    }
                                } else {
                                    // LEGACY non-positional single emit — byte-identical to pre-Task-4.
                                    const shieldWasHit = positionalShieldCaptured
                                        ? positionalShieldWasHit
                                        : !barriered &&
                                          !converted &&
                                          shieldBefore > 0 &&
                                          hpDamage < damage;
                                    emitAttacked({
                                        bus,
                                        round: r,
                                        targetId: tgt.id,
                                        attackerId: actor.id,
                                        hitOutcomes,
                                        isPrimaryTarget: true,
                                        shieldWasHit,
                                        damage,
                                    });
                                }
                            }
                            // Clause order — mirror of the two player-side sites. Placed OUTSIDE the
                            // `damage > 0 && tgt !== undefined` block above: a cast that inflicts a
                            // debuff but deals no damage (a pure Stasis bot) still has to apply it,
                            // and inside that guard the landings were silently dropped.
                            flushDeferredEnemyApplications(enemyDeferredApplications);
                            // Task 5 (per-victim crit signal): a positional enemy turn that dealt 0
                            // damage skips the `if (damage > 0)` apply block entirely — so no per-victim
                            // apply ran (enemyCritAgg undefined) and the deferred ability-performed was
                            // never emitted above. Emit it here with the anchor-based FALLBACK crit values
                            // (didCrit/critHits carried on the deferred payload), byte-identical to the
                            // pre-Task-5 inline emit for this 0-damage edge case. Only reachable when the
                            // enemy is positional (deferred payload present) AND the apply was skipped.
                            if (enemyDeferredAbilityPerformed && !enemyCritAgg) {
                                const dap = enemyDeferredAbilityPerformed;
                                emitDeferredAbilityPerformed(
                                    dap,
                                    dap.didCrit,
                                    dap.critHits ?? 0,
                                    []
                                );
                            }
                        } // end dead-after-burst guard (!burstDestroyedActor)
                    } else {
                        // §4.5 Deferred break: consume any pending Stasis break (real-enemy skip).
                        if (stasisBreakPending.has(actor.id)) {
                            stasisBreakPending.delete(actor.id);
                            for (const name of STASIS_BUFFS)
                                statusEngine.reduceTimedEnemyStatus(actor.id, name);
                        }
                    } // end stasis gate (real-enemy branch)
                }

                // Drain point (b): follow-ups triggered by this actor's turn body run as
                // "consecutive actions" within the turn — BEFORE the owner Post Turn, so any
                // status they apply obeys the same-turn decrement rule (the carrier's Post Turn
                // below decrements it). A triggered effect therefore never boosts the hit that
                // triggered it (the hit's damage was already computed in the turn body).
                drainIntentsFor('player');
                drainIntentsFor('enemy');

                // Post Turn (combat-system.md section 4): the status CARRIER decrements ALL its
                // timed statuses by one turn — both its self-buff store and the debuff store of
                // effects landed ON it. (Side-agnostic: PR4 unification of the former 4-branch
                // player/enemy/heal-target split.) Empty stores are a safe no-op.
                //
                // The DPS dummy's debuffs live under the sentinel key, not its actor id — the
                // dummy/real-actor duality is removed in PR5; until then every real actor keys
                // its debuff store by actor.id and the dummy keeps the sentinel.
                // (isDummyEnemy is already declared above for the dead-actor skip guard.)
                for (const buffName of statusEngine.decrementPlayer(actor.id).expired) {
                    bus.emit({ type: 'buff-expired', actorId: actor.id, round: r, buffName });
                }
                // debuffs landed on this actor — closes the decrement gap: every non-dummy actor
                // now decrements its own debuff store. Reachable today for a non-heal-target team
                // actor an enemy debuffs in positional mode (decrementUnification Case 5); the
                // player→enemy-attacker variant is fixed by this same line but stays latent (no
                // firing site threads a player→enemy targetId yet — a future per-victim-accounting
                // PR lights it up).
                const debuffResult = isDummyEnemy
                    ? statusEngine.decrementEnemy() // sentinel '__enemy__' store
                    : statusEngine.decrementEnemy(actor.id); // per-actor debuff store
                for (const buffName of debuffResult.expired) {
                    bus.emit({ type: 'buff-expired', actorId: actor.id, round: r, buffName });
                }

                bus.emit({ type: 'turn-ended', actorId: actor.id, round: r });
                // Drain intents enqueued by end-of-turn triggers before the next actor acts.
                drainIntentsFor('player');
                drainIntentsFor('enemy');
            }
        } finally {
            // The turn loop is closed: no live queue remains. The reset lives in `finally` so it
            // is structurally guaranteed on ANY loop exit (normal, break, return, throw) — a future
            // early exit added to the round loop can no longer leave `inTurnLoop` stuck true and
            // mis-dispatch the post-round drain as Path A. Any extra-action grant from here on (the
            // post-round enemy-death drain below) sees inTurnLoop=false → Path B (buffered for next round).
            inTurnLoop = false;
            // Same rationale for combat-log attribution: the post-round death-drain and round-ended
            // reactives that follow are turn-less, so clear actingActorId here. Otherwise their
            // reactive emissions would stamp duringTurnOf with the round's last acting actor and
            // buildCombatLog would nest them under that actor's turn instead of the endOfRound group.
            actingActorId = undefined;
        }

        // The row's attacker fields come from the LAST focus turn this round. Rounds
        // always have exactly one focus turn today (the attacker is in every queue),
        // so this reproduces the old definite-assignment provenance. The throw replaces
        // the implicit definite-assignment crash with an explicit one naming the Phase-3+
        // seam: reactive triggers may APPEND extra focus turns (read the last), but a
        // round with ZERO focus turns is impossible while the focus actor is always queued.
        if (!focusTurns.length) {
            throw new Error(
                `combat round ${r} produced no focus actor turn (Phase-3+ seam: extra turns append, zero turns impossible while the focus actor is always queued)`
            );
        }
        const lastAttackerTurn = focusTurns[focusTurns.length - 1];
        const action = lastAttackerTurn.action;
        const roundCrit = lastAttackerTurn.roundCrit;
        const enemyHpPct = lastAttackerTurn.enemyHpPct;
        const dotsConfig = lastAttackerTurn.dotsConfig;
        const dotsLanded = lastAttackerTurn.dotsLanded;
        // Display-only: hide a spent Cheat Death (the focus actor owns activeSelfBuffs).
        const activeSelfBuffsForRound = hideSpentCheatDeath(
            lastAttackerTurn.activeSelfBuffs,
            focusActorId,
            r
        );
        const landedEnemyDebuffs = lastAttackerTurn.landedEnemyDebuffs;
        const resistedEnemyDebuffs = lastAttackerTurn.resistedEnemyDebuffs;

        // --- Post-round assembly: derive row fields from the FOCUS entry, total the
        // round's damage (now including the enemy turn's DoT ticks/bursts), update
        // cumulative totals + enemy HP, emit hp-changed / ship-destroyed, and push
        // the RoundData row. Only the attacker entry exists today — semantically identical
        // to the old scalar locals.
        const focus = dmg(focusActorId);
        // Row fields sourced from the focus entry. secondary/conditional go only to
        // rawTotals (RoundData has no sub-bucket columns) so they're read inline below.
        // directDamage/totalRoundDamage are `let`: the post-drain re-fold below (round-tail
        // ordering fix) reassigns them to include end-of-round reactive-damage credits that
        // land during the `round-ended` drain, after this snapshot.
        let directDamage = focus.direct;
        const focusDot = perActorDot.get(focusActorId);
        const corrosionDamage = focus.corrosion + (focusDot?.corrosion ?? 0);
        const infernoDamage = focus.inferno + (focusDot?.inferno ?? 0);
        // SP-E: mirrors corrosionDamage/infernoDamage. Always 0 today (generic DoTs are never
        // auto-applied from skill text in this task) — real once E2/E3/E4 populate genericDoTEntries.
        const genericDamage = focus.generic + (focusDot?.generic ?? 0);
        const focusPositionalDetonation = perActorDetonation.get(focusActorId) ?? 0;
        const detonationDamage = focus.detonation + focusPositionalDetonation;

        // Aggregate dot-detonated fires ONLY for the non-positional aggregate path; positional
        // detonation already emitted per-victim bomb-detonated/dot-detonated in the apply loop.
        if (focus.detonation > 0) {
            bus.emit({
                type: 'dot-detonated',
                targetId: enemy.id,
                round: r,
                damage: focus.detonation,
            });
        }

        // Deliberately uses focus.corrosion/focus.inferno/focus.generic ONLY (not the
        // perActorDot-folded corrosionDamage/infernoDamage/genericDamage locals) — per-victim DoT
        // ticks land via applyVictimDamage, so folding perActorDot here would double-drain the
        // dummy HP overwrite (same guard as the focusPositionalDetonation/detonation comment below).
        let totalRoundDamage =
            focus.direct + focus.corrosion + focus.inferno + focus.detonation + focus.generic;
        cumulativeDamage += totalRoundDamage;
        // Row/summary rawTotals stay FOCUS-only — only the focus actor reaches summary DPS
        // and the damage-type breakdown (config comparison stays meaningful).
        totalDirectRaw += focus.direct;
        totalSecondaryRaw += focus.secondary;
        totalConditionalRaw += focus.conditional;
        totalCorrosionRaw += corrosionDamage;
        totalInfernoRaw += infernoDamage;
        totalGenericRaw += genericDamage;
        // Summary detonation reflects per-victim positional detonation too (focusPositionalDetonation
        // is 0 non-positionally → byte-identical). NOTE: cumulativeDamage/totalRoundDamage above
        // deliberately use focus.detonation ONLY — per-victim detonation lands via applyVictimDamage,
        // so folding it into cumulativeDamage would double-count the enemy-HP decline.
        totalDetonationRaw += detonationDamage;

        // Team damage = Σ over all NON-focus actor entries of every channel (direct already
        // includes its secondary/conditional sub-buckets, so they are NOT added separately).
        // By construction totalRoundDamage + teamRoundDamage = the round's enemy-HP delta.
        let teamRoundDamage = 0;
        for (const [id, d] of roundDamage) {
            if (id === focusActorId) continue;
            teamRoundDamage += d.direct + d.corrosion + d.inferno + d.detonation + d.generic;
        }
        cumulativeTeamDamage += teamRoundDamage;
        totalTeamRaw += teamRoundDamage;

        // SP-U U5: land the enemy's remaining HP. Two modes:
        if (dpsEnemyTarget) {
            // REAL destructible DPS target (no enemy attackers). This round's dealt damage
            // (focus + team) lands on the enemy through the SHARED per-victim funnel, so its HP
            // declines and its intake is accounted per-victim like any real actor (R5): the
            // amount surfaces in `perActorIncoming[enemy]` and `recordDestroyed` fires inside
            // `applyVictimDamage` the instant HP first crosses 0 (emitting ship-destroyed +
            // stamping destroyedRound). The pre-drain guard mirrors the old sink's finite floor
            // (never re-hits a corpse). hp-changed is emitted from the REAL currentHp inside
            // applyVictimDamage (float granularity, like every other real victim) — no separate
            // coarse emit here.
            const roundEnemyDamage = totalRoundDamage + teamRoundDamage;
            if (roundEnemyDamage > 0 && enemy.currentHp > 0) {
                applyVictimDamage(roundEnemyDamage, enemy, sink, {
                    byDirectDamage: true,
                    killerId: focusActorId,
                });
            }
            if (enemy.currentHp <= 0) {
                // Path-B drain (Task 10): the enemy died POST-round — the turn loop is closed and
                // no per-turn drain follows. Drain the on-enemy-destroyed intents now: CHARGE
                // reactives apply immediately; EXTRA-ACTION grants buffer for next round. With no
                // on-enemy-destroyed listener the queue is empty → a NO-OP. The run terminates
                // right after this round's row is pushed (see the break below `roundData.push`).
                drainIntentsFor('player');
                drainIntentsFor('enemy');
            }
        } else {
            // Vestigial sink (sim/healing mode): the real fight runs on the positioned enemy
            // roster; this dummy just absorbs the focus's aggregate damage so its HP%-gates still
            // resolve. Kept on the legacy scalar decline + coarse integer hp-changed tap
            // (byte-identical) — it NEVER dies or terminates the run (its HP is billions).
            const enemyHpDecline = cumulativeDamage + cumulativeTeamDamage;
            enemy.currentHp = Math.max(0, enemyHp - enemyHpDecline);
            const newEnemyHpPctInt =
                enemyHp > 0 ? Math.round(Math.max(0, 100 * (1 - enemyHpDecline / enemyHp))) : 100;
            if (newEnemyHpPctInt !== lastEnemyHpPctInt) {
                bus.emit({
                    type: 'hp-changed',
                    targetId: enemy.id,
                    round: r,
                    oldPct: lastEnemyHpPctInt,
                    newPct: newEnemyHpPctInt,
                });
                lastEnemyHpPctInt = newEnemyHpPctInt;
            }
        }

        // Toxic Overflow end-of-round Corrosion spread (ship-kit W3, Task 9, ledger #49). Game rule
        // (constants/buffs.ts): "At the end of the round if a unit has Toxic Overflow and at least 1
        // stack of Corrosion, inflict Corrosion I for 3 turns to all adjacent allies and remove
        // Toxic Overflow." Runs BEFORE the round-ended emit/drain below so each `corrosion-spread`
        // event's enqueued reactions (Hemlock's self-heal, on-corrosion-spread) are flushed by the
        // same drainIntentsFor calls. Team-symmetric: iterates every living real actor (the DPS
        // dummy `enemy` is skipped — it holds no per-victim debuffs). The holder's Toxic Overflow is
        // read out of the per-victim TIMED enemy-debuff store ONLY, via `holdsToxicOverflow` — see
        // the guard below for why that channel and not the broad name union; Corrosion lives on the
        // actor's corrosionEntries. adjacentAllyIdsFor resolves the holder's SAME-SIDE adjacent
        // allies (board-neighbours positionally, all same-side allies otherwise).
        // Snapshot the qualifying spreaders BEFORE applying any spread. Applying spreads inline
        // while iterating would let an EARLIER holder's spread deposit a Corrosion stack on a
        // LATER holder, which — read live via totalStacks below — would then chain-spread that same
        // round off a stack it only just received. That is order-dependent (it hinges on allActors
        // ordering) and breaks combat symmetry/determinism. Collecting the holders that pass every
        // guard against the fixed round-end state first, then applying from that snapshot, makes the
        // spread order-independent: a holder spreads this round only if it already carried Corrosion
        // when the round ended (a stack received THIS round spreads only the FOLLOWING round).
        const toxicSpreaders: CombatActor[] = [];
        for (const holder of allActors) {
            if (holder.id === enemy.id) continue; // vestigial DPS dummy — never a real holder
            if (holder.destroyedRound !== undefined) continue;
            // TIMED per-victim channel only — deliberately NOT `ownerDebuffNames`, the broad
            // three-channel name union. Toxic Overflow is a CONSUMABLE ("...and remove Toxic
            // Overflow"), and the `removeTimedEnemyStatus` call below reaches only this channel, so
            // reading any wider set would spread every round forever instead of once: the status is
            // selectable in the calculator's debuff picker, which emits no turn count, and an
            // always-active scheduled debuff is injected into EVERY target's snapshot with no
            // per-victim entry to delete. Inert is the faithful rendering of a one-shot the manual
            // model cannot spend (same narrowing as hitMitigation.ts / exposedStatus.ts).
            // `holdsToxicOverflow` also surfaces the ability-sourced PERSISTENT-stacking store, which
            // the removal cannot reach either — unreachable for this status, since that routing is
            // gated solely on `PERSISTENT_STACKING_BUFFS.has(name)` and Toxic Overflow is not a
            // member (constants/persistentStackingBuffs.ts), so it is harmless rather than a second
            // unspendable door. Hemlock's real charged application lands in the timed store,
            // non-expiring, by construction — see constants/toxicOverflow.ts.
            if (!holdsToxicOverflow(statusEngine, holder.id)) continue;
            if (totalStacks(holder.corrosionEntries) < 1) continue;
            toxicSpreaders.push(holder);
        }
        for (const holder of toxicSpreaders) {
            const affectedIds = bySide(
                isEnemySide(holder.id) ? 'enemy' : 'player'
            ).adjacentAllyIdsFor(holder.id);
            // Inflict Corrosion I (SPREAD_CORROSION_TIER, SPREAD_CORROSION_DURATION turns) on each
            // adjacent ally. Attributed to the holder (a live, resolvable applier so the tick is
            // counted — see tickDoTs's corrosion applier-ctx rule). New independent stack (DoTs of
            // the same family stack), mirroring applyNewDoTs's corrosion entry shape.
            for (const allyId of affectedIds) {
                const ally = allActorsById.get(allyId);
                if (!ally) continue;
                ally.corrosionEntries.push({
                    stacks: 1,
                    tier: SPREAD_CORROSION_TIER,
                    remainingRounds: SPREAD_CORROSION_DURATION,
                    sourceId: holder.id,
                });
            }
            // Remove Toxic Overflow from the holder (targeted single-family removal — preserves any
            // co-applied debuffs on the same victim). It landed as a timed enemy debuff (Hemlock's
            // charged), so it lives in the per-victim enemy store keyed by the holder's id.
            statusEngine.removeTimedEnemyStatus(holder.id, TOXIC_OVERFLOW);
            bus.emit({ type: 'corrosion-spread', sourceId: holder.id, affectedIds, round: r });
        }

        // round-ended (C2b-2): end-of-round reactive purge (Rhodium). Emitted at the round TAIL,
        // after the post-round death drain so the purge sees post-death state, before roundData
        // assembly. Drain BOTH queues (player + enemy), mirroring the round-started emit+drain.
        // Drains the single-target reactive executor (most-buffs) — single-target by design, out of E3 scope.
        bus.emit({ type: 'round-ended', round: r });
        drainIntentsFor('player');
        drainIntentsFor('enemy');

        // LOG-ONLY per-actor status snapshot (see the events.ts doc). Emitted at the round TAIL —
        // after the post-round death drain, round-ended reactives AND their drains — so it reports
        // the statuses that genuinely survive into the next round. Team-symmetric: one emit per
        // actor in `allActors`, both sides. The DPS dummy keys its debuffs under the sentinel store
        // rather than its actor id, so its lists come back empty; harmless, since it is not on the
        // board and the assembler only reads roster ids.
        for (const a of allActors) {
            // Reuses the engine's established three-source name reads (scheduled snapshot +
            // payload-carrying timed + aura/accum ability statuses) rather than a bespoke store
            // walk, so the chips agree with every other live name-gate in this file.
            // `enemyDebuffNamesForTarget` already folds the DoT/bomb families from the actor's own
            // entry containers using the same synthesized base names the assembler labels with
            // (Corrosion / Inferno / Bomb / Damage over Time).
            bus.emit({
                type: 'status-snapshot',
                actorId: a.id,
                round: r,
                buffNames: selfBuffNamesForOwners(statusEngine, [a.id]),
                debuffNames: enemyDebuffNamesForTarget(a),
            });
        }

        // Post-drain re-fold (round-tail ordering fix): end-of-round reactive-damage procs
        // (Rhodium's most-buffed-enemy purge, Incinerator's enemy-debuff AoE) credit into
        // `roundDamage` via `creditDamage` DURING the `round-ended` drain above — AFTER this
        // round's scalar snapshot (directDamage/totalRoundDamage/cumulativeDamage/raw totals) was
        // taken and folded into the persistent accumulators. In pure DPS mode those credits would
        // otherwise be discarded when `roundDamage` is recreated next round, so they never reached
        // the public DPS summary. Re-read roundDamage, fold ONLY the post-drain delta into the row +
        // accumulators (the pre-drain amount was already folded at the snapshot, so adding the delta
        // avoids double-count), and decline the destructible DPS target's HP by the same delta so
        // `totalRoundDamage + teamRoundDamage == enemy-HP delta` (8085) and roundsToKill stay honest.
        //
        // GATED ON `dpsEnemyTarget` (the pure-DPS mode this fix targets). The other two modes are
        // deliberately excluded:
        //  - Positional sim (`positionalTeamBattle`, battleSimulator): reactives route through
        //    applyVictimDamage + the per-victim maps (serialized into RoundData AFTER this drain),
        //    NOT `roundDamage` — the delta would be 0 here anyway, so the gate only makes the no-op
        //    explicit.
        //  - Healing mode (healingEngineAdapter): NOT positional, so a reactive DOES credit
        //    `roundDamage` — but the healing adapter reads none of the damage scalars, and mutating
        //    `cumulativeDamage` here would perturb the vestigial dummy's NEXT-round HP-decline
        //    (8129) and its HP%-gates. The gate keeps healing byte-identical.
        // The delta is also 0 for every DPS round without an end-of-round reactive-damage proc
        // (`focusTotalFinal === totalRoundDamage` — identical float expression), so existing DPS
        // goldens don't move. Only the 'direct' channel can shift at round tail (applyReactiveDamage
        // credits 'direct' only), so `totalDirectRaw` is the only per-channel raw total reconciled;
        // `totalRoundDamage` is recomputed across all channels but equals the direct-only shift.
        if (dpsEnemyTarget) {
            const focusTotalFinal =
                focus.direct + focus.corrosion + focus.inferno + focus.detonation + focus.generic;
            let teamTotalFinal = 0;
            for (const [id, d] of roundDamage) {
                if (id === focusActorId) continue;
                teamTotalFinal += d.direct + d.corrosion + d.inferno + d.detonation + d.generic;
            }
            const focusReactiveDelta = focusTotalFinal - totalRoundDamage;
            const teamReactiveDelta = teamTotalFinal - teamRoundDamage;
            if (focusReactiveDelta !== 0 || teamReactiveDelta !== 0) {
                // Fold the focus delta into the row's directDamage + the persistent direct/cumulative
                // accumulators (compute the direct-channel raw delta BEFORE reassigning directDamage).
                totalDirectRaw += focus.direct - directDamage;
                directDamage = focus.direct;
                totalRoundDamage = focusTotalFinal;
                cumulativeDamage += focusReactiveDelta;
                // Team delta mirrors the focus fold on the team channels.
                teamRoundDamage = teamTotalFinal;
                cumulativeTeamDamage += teamReactiveDelta;
                totalTeamRaw += teamReactiveDelta;
                // Land the reactive delta on the DPS target's HP too. The pre-drain decline (the
                // dpsEnemyTarget branch above) used the pre-reactive total, so this is the remaining
                // amount (no double-apply). A post-drain death is stamped by recordDestroyed inside
                // applyVictimDamage; the row is pushed just below and the run terminates at the
                // dpsEnemyTarget break (8359). NOTE (accepted asymmetry): unlike the pre-drain death
                // path (8115), a kill landed HERE does NOT drain on-enemy-destroyed intents — this is
                // the terminal round (the row is already assembled and the run breaks immediately),
                // and re-draining would re-enter the same round-tail credit ordering this block just
                // reconciled. On-enemy-destroyed effects are charge/extra-action grants that are moot
                // once the run ends; no corpus ship credits further DPS-summary damage from them.
                const reactiveEnemyDelta = focusReactiveDelta + teamReactiveDelta;
                if (reactiveEnemyDelta > 0 && enemy.currentHp > 0) {
                    applyVictimDamage(reactiveEnemyDelta, enemy, sink, {
                        byDirectDamage: true,
                        killerId: focusActorId,
                    });
                }
            }
        }

        // Report stacks after expiry (state going into next round)
        roundData.push({
            round: r,
            action,
            // END-OF-ROUND charge state: with extra turns (extraTurns >= 1) the cadence
            // ran more than once this round, so this is NOT "charges going into the
            // turn that produced `action`" — it's the live counter after all turns.
            charges: Math.round(attacker.charges),
            chargeCount: hasChargedSkill ? chargeCount : 0,
            didCrit: roundCrit,
            enemyHpPct: Math.round(enemyHpPct),
            directDamage: Math.round(directDamage),
            corrosionDamage: Math.round(corrosionDamage),
            infernoDamage: Math.round(infernoDamage),
            detonationDamage: Math.round(detonationDamage),
            totalRoundDamage: Math.round(totalRoundDamage),
            cumulativeDamage: Math.round(cumulativeDamage),
            // genericDamage (SP-E): set ONLY when nonzero — generic DoTs are never auto-applied
            // from skill text in this task, so every existing round/golden keeps the field absent
            // (legacy RoundData shape preserved, byte-identical).
            ...(genericDamage > 0 ? { genericDamage: Math.round(genericDamage) } : {}),
            // teamDamage set ONLY when walked team actors exist (undefined preserves the
            // legacy/attacker-only RoundData shape — goldens stay byte-identical).
            ...(hasWalkedTeam ? { teamDamage: Math.round(teamRoundDamage) } : {}),
            // extraTurns set ONLY when ≥ 1 (undefined preserves legacy RoundData shape).
            ...(focusTurns.length > 1 ? { extraTurns: focusTurns.length - 1 } : {}),
            // perTargetDamage set ONLY when the positional path recorded victim damage this
            // round (map non-empty). Non-positional rounds leave it absent → goldens byte-identical.
            ...(roundPerTargetDamage.size > 0
                ? { perTargetDamage: Object.fromEntries(roundPerTargetDamage) }
                : {}),
            // perTargetDealt (SP-F F1): attacker id -> victim id -> dealt, mirroring EVERY
            // roundPerTargetDamage increment above to its correct source-attacker. Set ONLY when
            // non-empty — mirrors perTargetDamage's "absent when empty" rule, goldens byte-identical.
            ...(roundPerTargetDealt.size > 0
                ? {
                      perTargetDealt: Object.fromEntries(
                          [...roundPerTargetDealt].map(([attackerId, byVictim]) => [
                              attackerId,
                              Object.fromEntries(byVictim),
                          ])
                      ),
                  }
                : {}),
            // perActorSplash (bomb-splash-on-death): set ONLY when a dying bombed ally splashed
            // adjacent allies this round (map non-empty). Absent otherwise → byte-identical.
            ...(perActorSplash.size > 0
                ? { perActorSplash: Object.fromEntries(perActorSplash) }
                : {}),
            // perActorDetonation (per-victim skill-triggered detonation, positional): set ONLY when
            // the positional detonation loop dealt damage this round (map non-empty). Absent
            // otherwise → non-positional rounds keep the legacy RoundData shape, goldens byte-identical.
            ...(perActorDetonation.size > 0
                ? { perActorDetonation: Object.fromEntries(perActorDetonation) }
                : {}),
            // perActorShield (H1 Task 6): per-actor shield accounting for THIS round, set only
            // when at least one actor has a nonzero {granted, absorbed, pool}. Mirrors
            // perTargetDamage's "absent when empty" rule so legacy/no-shield rounds stay
            // byte-identical. granted = post-cap grant this round (perActorShieldGranted);
            // absorbed = shield drained by incoming this round (perActorIncoming.shieldAbsorbed,
            // a fresh per-round map like roundPerTargetDamage → already this-round, not cumulative);
            // pool = the actor's live remaining shieldPool at end-of-round assembly.
            ...(() => {
                const ids = new Set<string>([
                    ...perActorShieldGranted.keys(),
                    ...perActorIncoming.keys(),
                    ...allActors.filter((a) => a.shieldPool > 0).map((a) => a.id),
                ]);
                const perActorShield: Record<
                    string,
                    { granted: number; absorbed: number; pool: number }
                > = {};
                for (const id of ids) {
                    const granted = perActorShieldGranted.get(id) ?? 0;
                    const absorbed = perActorIncoming.get(id)?.shieldAbsorbed ?? 0;
                    const pool = allActorsById.get(id)?.shieldPool ?? 0;
                    if (granted === 0 && absorbed === 0 && pool === 0) continue;
                    perActorShield[id] = { granted, absorbed, pool };
                }
                return Object.keys(perActorShield).length > 0 ? { perActorShield } : {};
            })(),
            // perActorIncoming (PR7 Task 6): per-victim incoming-damage accounting for THIS round,
            // keyed by victim id ({incoming, shieldAbsorbed, barrierAbsorbed}). Mirrors
            // perActorShield's "absent when empty" rule — set ONLY when at least one victim has a
            // nonzero entry, so legacy / no-intake rounds keep the RoundData shape byte-identical
            // (perActorIncoming is a fresh per-round map, already this-round, not cumulative).
            ...(() => {
                const out: Record<
                    string,
                    {
                        incoming: number;
                        shieldAbsorbed: number;
                        barrierAbsorbed: number;
                        convertedToShield: number;
                    }
                > = {};
                for (const [id, v] of perActorIncoming) {
                    if (
                        v.incoming === 0 &&
                        v.shieldAbsorbed === 0 &&
                        v.barrierAbsorbed === 0 &&
                        v.convertedToShield === 0
                    )
                        continue;
                    out[id] = {
                        incoming: v.incoming,
                        shieldAbsorbed: v.shieldAbsorbed,
                        barrierAbsorbed: v.barrierAbsorbed,
                        convertedToShield: v.convertedToShield,
                    };
                }
                return Object.keys(out).length > 0 ? { perActorIncoming: out } : {};
            })(),
            // perActorReflected (Reflect gear set, Task 5): per-attacker reflected-thorns damage
            // dealt back THIS round. Mirrors perActorShield's "absent when empty" rule so legacy /
            // no-reflect rounds stay byte-identical (perActorReflected is empty unless a Reflect
            // wearer took a direct hit this round).
            ...(perActorReflected.size > 0
                ? { perActorReflected: Object.fromEntries(perActorReflected) }
                : {}),
            activeCorrosionStacks: totalStacks(corrosionEntries),
            activeInfernoStacks: totalStacks(infernoEntries),
            activeBombCount: pendingBombs.length,
            activeSelfBuffs: activeSelfBuffsForRound,
            activeEnemyDebuffs: landedEnemyDebuffs,
            resistedEnemyDebuffs,
            appliedDoTs: dotsConfig,
            dotsLanded,
            activeDoTStates: [
                ...corrosionEntries.map((e) => ({
                    type: 'corrosion' as const,
                    tier: e.tier,
                    stacks: e.stacks,
                    ticksRemaining: e.remainingRounds,
                })),
                ...infernoEntries.map((e) => ({
                    type: 'inferno' as const,
                    tier: e.tier,
                    stacks: e.stacks,
                    ticksRemaining: e.remainingRounds,
                })),
                ...pendingBombs.map((b) => ({
                    type: 'bomb' as const,
                    tier: b.tier,
                    stacks: b.stacks,
                    ticksRemaining: b.countdown,
                })),
                // SP-E: always [] today (generic DoTs are never auto-applied from skill text in
                // this task) — a no-op spread, byte-identical.
                ...genericDoTEntries.map((e) => ({
                    type: 'generic' as const,
                    tier: e.tier,
                    stacks: e.stacks,
                    ticksRemaining: e.remainingRounds,
                })),
            ],
        });

        // Healing mode: push this round's healing accounting. incomingDamage/shieldAbsorbed
        // are the per-round intake totals folded from this round's enemy attacker turns.
        // The destroyed-round seam is set the moment the target's HP first reaches 0 (in the
        // enemy attacker turn); this post-round guard is a backstop for any other 0-HP path.
        if (healTarget) {
            // PR5b: the heal target's intake totals are sourced from its per-actor bucket
            // (written by sink, PR5a). In the single-target path this is byte-identical to
            // the legacy per-round scalars this replaced (the heal target is the only recorded
            // victim); in positional AoE it is the correct per-victim share rather than the old
            // tank-sums-everything scalar. The replaced scalars were removed in this same change.
            const healTargetIntake = perActorIncoming.get(healTarget.id);
            healingRounds.push({
                perActor: currentRoundHealing,
                targetHpPctStart,
                targetShieldStart,
                incomingDamage: healTargetIntake?.incoming ?? 0,
                shieldAbsorbed: healTargetIntake?.shieldAbsorbed ?? 0,
                barrierAbsorbed: healTargetIntake?.barrierAbsorbed ?? 0,
                perActorIncoming,
                // Per-enemy effects: de-dupe each enemy's own self-buffs/debuffs by buffName
                // (keep the first occurrence so the UI shows each effect once per enemy per round),
                // preserving the order enemies first acted this round. Active enemy-applied DoTs on
                // the target are attributed by stack `sourceId` and merged in below — a DoT-only
                // enemy that produced no self-buffs/debuffs still gets an entry so its DoTs show.
                // mergeDoTsForDisplay combines the pre-tick snapshot with the live containers:
                // live entries (post-tick/newly-applied) take precedence; snapshot entries absent
                // from live (tick-and-expire case) are appended so the display panel always shows
                // DoTs that were active this round even if they expired before this call.
                // When the tank never acted (DPS mode or destroyed tank) the snapshot is empty
                // and mergeDoTsForDisplay returns the live containers unchanged.
                enemyEffects: buildEnemyRoundEffects(
                    roundEnemyEffects,
                    mergeDoTsForDisplay(tankDotSnapshot.corrosion, healTarget.corrosionEntries),
                    mergeDoTsForDisplay(tankDotSnapshot.inferno, healTarget.infernoEntries)
                ),
                // Display-only: hide a spent Cheat Death (the heal target owns these buffs).
                // The destroyed-tank branch already set this to [] (filtering [] is a no-op).
                healTargetBuffs: hideSpentCheatDeath(healTargetBuffs, healTarget.id, r),
            });
            // Post-round backstop (Task-1 OUTCOME B): captures ONLY the start-dead /
            // no-`recordDestroyed` path — a heal target that ENTERS a round already at
            // currentHp<=0 (e.g. seeded hp:0) takes no damage, so recordDestroyed never stamps
            // its destroyedRound. The `healTarget.destroyedRound === undefined` clause makes that
            // intent explicit (on any recordDestroyed path the field is already set). This must
            // NOT call recordDestroyed (would emit a spurious ship-destroyed the old code never
            // produced) nor stamp the actor field (would leak into the turn-skip dead-actor reader
            // and the combat-end readers, changing subsequent-round behavior). First such round
            // wins (`backstopDestroyedRound === undefined`), matching the old first-wins behavior.
            if (
                backstopDestroyedRound === undefined &&
                healTarget.destroyedRound === undefined &&
                healTarget.currentHp <= 0
            ) {
                backstopDestroyedRound = r;
            }
        }

        // SP-U U5: terminate the run the round the REAL DPS enemy is destroyed — the row for the
        // killing round is already pushed above, so `roundData` ends AT the kill (no zero-damage
        // rounds past it). Gated on `dpsEnemyTarget` so the vestigial sim/healing sink (which
        // never dies) never cuts a real battle short. The turn-loop finally already reset
        // inTurnLoop, so this early exit is safe (see that finally's rationale).
        if (dpsEnemyTarget && enemy.destroyedRound !== undefined) break;
    }

    // The heal target's death round comes from its per-actor `destroyedRound` field (stamped by
    // recordDestroyed), falling back to the post-round backstop's start-dead capture for the
    // no-`recordDestroyed` path (Task-1 OUTCOME B). Computed unconditionally — in non-healing mode
    // healTarget is undefined → undefined, never read (the healing shape is omitted below).
    const healTargetDestroyedRound = healTarget?.destroyedRound ?? backstopDestroyedRound;

    // SP-U U5: DPS enemy outcome (the real, destructible target). `roundsToKill` = the round the
    // enemy was destroyed (undefined if it survived the window); `survived` = never reached 0 HP;
    // `finalHpPct` = its HP% remaining at the end of the run (0 when killed). In sim/healing mode
    // (vestigial billion-HP sink) this always reports survived (never read — the DPS adapter is
    // the only consumer).
    const enemyFinalHpPct =
        enemy.destroyedRound !== undefined
            ? 0
            : enemyHp > 0
              ? Math.max(0, (100 * enemy.currentHp) / enemyHp)
              : 100;
    return {
        rounds: roundData,
        rawTotals: {
            direct: totalDirectRaw,
            corrosion: totalCorrosionRaw,
            inferno: totalInfernoRaw,
            detonation: totalDetonationRaw,
            cumulative: cumulativeDamage,
            totalSecondary: totalSecondaryRaw,
            totalConditional: totalConditionalRaw,
            teamTotal: totalTeamRaw,
            generic: totalGenericRaw,
        },
        enemyOutcome: {
            survived: enemy.destroyedRound === undefined,
            roundsToKill: enemy.destroyedRound,
            finalHpPct: enemyFinalHpPct,
        },
        // Additive — present ONLY in healing mode (DPS callers see the legacy shape).
        ...(healingMode
            ? {
                  healing: {
                      rounds: healingRounds,
                      ...(healTargetDestroyedRound !== undefined
                          ? { destroyedRound: healTargetDestroyedRound }
                          : {}),
                  },
              }
            : {}),
    };
}
