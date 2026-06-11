import { EnemyBaseClass, SelectedGameBuff, TeamActorInput } from '../../types/calculator';
import type { ShipTypeName } from '../../constants/shipTypes';
import { AbilityTarget, ShipSkills } from '../../types/abilities';
import { makeRateGate } from '../calculators/rateAccumulator';
import type { RoundData } from '../calculators/dpsSimulator';
import {
    type ExtraActionGrant,
    selectFiringSkill,
    damageInputsFromSkill,
} from '../abilities/applyAbilities';
import { conditionsMet } from '../abilities/evaluateConditions';
import {
    ActiveDoTStack,
    ActorDamage,
    ActorHealing,
    CombatActor,
    PendingAccumulator,
    PendingBomb,
    createActor,
    buildTurnQueue,
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
import { CHEAT_DEATH_BUFFS } from './cheatDeathBuffs';
import { BARRIER_BUFFS } from './barrierBuffs';
import { CombatEventBus, createEventBus } from './events';
import { synthesizeResisted } from './shared';
import {
    HealingRuntimeCtx,
    PlayerActorRuntime,
    PlayerRoundCtx,
    PlayerTurnResult,
    runPlayerTurn,
} from './playerTurn';
import {
    Intent,
    MAX_INTENT_GENERATIONS,
    buildActorConditionContext,
    executeIntent,
    ownerDebuffNamesFor,
    partitionReactiveAbilities,
    registerReactiveListeners,
    selfBuffNamesForOwners,
} from './triggers';

/** Backstop for pathological extra-action loops (a non-once-per-round grant whose
 *  conditions stay true re-fires on the extra turn it granted). Real texts are
 *  self-limited (charged-skill grants consume charges; passive grants are once per
 *  round), so any round needing more than this is a config/parser bug. */
const MAX_EXTRA_TURNS_PER_ROUND = 8;

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
        for (const ability of slot.abilities) {
            const cfg = ability.config;
            if (cfg.type !== 'buff' && cfg.type !== 'debuff') continue;
            const side: 'self' | 'enemy' =
                ability.target === 'enemy' || ability.target === 'all-enemies' ? 'enemy' : 'self';
            const accumulating = !!cfg.stackTrigger && cfg.isStackable;
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
            const isAura =
                !accumulating &&
                !castPathCheatDeath &&
                (cfg.duration === 'recurring' || cfg.duration === undefined);
            const payload: AbilityStatusPayload = {
                buffName: cfg.buffName,
                stacks: cfg.stacks,
                parsedEffects: cfg.parsedEffects,
                ...(cfg.type === 'debuff' ? { application: cfg.application } : {}),
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
                    duration: castPathCheatDeath ? Infinity : (cfg.duration as number),
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
}

/** Build a full PlayerActorRuntime for a healing-mode enemy attacker.
 *  Exported for unit-testing; called inside runCombat. The enemy-dispatch branch
 *  walks runPlayerTurn with this runtime, bound to the heal target (Task 6b). */
export function buildEnemyPlayerActorRuntime(
    e: EnemyActorInput,
    ctx: {
        statusEngine: StatusEngine;
        playerIds: string[];
        enemyDebuffLookup: Map<string, SelectedGameBuff[]>;
    }
): PlayerActorRuntime {
    const { statusEngine, playerIds, enemyDebuffLookup } = ctx;

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
    // shipSkills; safe to call defensively). Own ownerId = actor id. playerIds is
    // passed for ally-routing — irrelevant for pure damage actors.
    const { timedSelfBySlot, timedEnemyBySlot } = registerActorAbilityStatuses(
        castSkills,
        statusEngine,
        e.id,
        playerIds
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
            defence: e.stats.defence ?? 0,
            hp: e.stats.hp ?? 0,
            speed: e.stats.speed,
        },
        chargeCount: e.chargeCount,
        startCharged: e.startCharged,
    });

    // Resolved affinity fields — pre-computed by the adapter via computeAffinityModifiers
    // (enemy as attacker, heal target as defender). Absent → neutral defaults (damageMod 0,
    // cap 100, penalty 0), preserving byte-identical behaviour for fixtures without affinity.
    const resolvedDamageMod = e.affinityDamageModifier ?? 0;
    const resolvedCritCap = e.affinityCritCap ?? 100;
    const resolvedCritPenalty = e.affinityCritPenalty ?? 0;
    const affinityDisadvantage = resolvedDamageMod < 0;
    // Own gate instances — separate draw streams so this enemy's crit/heal-crit/debuff/extend
    // rolls are fully isolated from every other actor's deterministic schedule.
    const enemyActiveCritGate = makeRateGate();
    const enemyChargedCritGate = makeRateGate();
    const enemyActiveHealCritGate = makeRateGate();
    const enemyChargedHealCritGate = makeRateGate();
    const enemyDebuffLandingGate = makeRateGate();
    const enemyExtendChanceGate = makeRateGate();
    const landsTimedEnemyApplicationFn = (application?: 'inflict' | 'apply'): boolean =>
        application === 'apply' ? !affinityDisadvantage : enemyDebuffLandingGate(1); // 100% landing rate (no hacking check for enemy actors)

    return {
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
        healModifier: 0,
        debuffLandingChance: 1,
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        affinityDamageModifier: resolvedDamageMod,
        affinityCritCap: resolvedCritCap,
        affinityCritPenalty: resolvedCritPenalty,
        affinityDisadvantage,
        allyChargePerRound: undefined,
        activeCritGate: enemyActiveCritGate,
        chargedCritGate: enemyChargedCritGate,
        activeHealCritGate: enemyActiveHealCritGate,
        chargedHealCritGate: enemyChargedHealCritGate,
        debuffLandingGate: enemyDebuffLandingGate,
        extendChanceGate: enemyExtendChanceGate,
        landsTimedEnemyApplication: landsTimedEnemyApplicationFn,
        selfBuffLookup: new Map(),
        enemyDebuffLookup,
    };
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
    roundEnemyEffects: Map<string, { selfBuffs: ActiveBuff[]; debuffs: ActiveBuff[] }>,
    corrosionEntries: Pick<ActiveDoTStack, 'sourceId' | 'tier' | 'stacks'>[],
    infernoEntries: Pick<ActiveDoTStack, 'sourceId' | 'tier' | 'stacks'>[]
): EnemyRoundEffects[] {
    // Sum active stacks per source → type → tier, preserving first-seen source order.
    const dotsBySource = new Map<string, Map<string, EnemyDoTState>>();
    const accumulate = (
        type: 'corrosion' | 'inferno',
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
            const burstDamage = bomb.stacks * bomb.damagePerStack * bomb.affinityMult;
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
function tickDoTs(args: {
    corrosionEntries: ActiveDoTStack[];
    infernoEntries: ActiveDoTStack[];
    enemyHp: number;
    ctxFor: (sourceId: string) => PlayerRoundCtx | undefined;
    emitTicked: (dotType: 'corrosion' | 'inferno', damage: number) => void;
    credit: (sourceId: string, dotType: 'corrosion' | 'inferno', damage: number) => void;
}): void {
    // Step 4: Tick corrosion (scales with enemy HP, capped at 5000 dmg per 1%)
    const corrosionBaseHp = Math.min(args.enemyHp, 500_000);
    let corrosionSum = 0;
    for (const e of args.corrosionEntries) {
        const ctx = args.ctxFor(e.sourceId);
        if (!ctx) continue; // applier has not acted yet this run (faster-enemy round 1)
        const d = e.stacks * (e.tier / 100) * corrosionBaseHp * ctx.dotMult * ctx.affinityMult;
        args.credit(e.sourceId, 'corrosion', d);
        corrosionSum += d;
    }
    if (corrosionSum > 0) {
        args.emitTicked('corrosion', corrosionSum);
    }

    // Step 5: Tick inferno (scales with the applier's effective attack, no outgoing buff)
    let infernoSum = 0;
    for (const e of args.infernoEntries) {
        const ctx = args.ctxFor(e.sourceId);
        if (!ctx) continue;
        const d = e.stacks * (e.tier / 100) * ctx.effectiveAttack * ctx.dotMult * ctx.affinityMult;
        args.credit(e.sourceId, 'inferno', d);
        infernoSum += d;
    }
    if (infernoSum > 0) {
        args.emitTicked('inferno', infernoSum);
    }

    // Expire DoT stacks after ticking
    expireStacks(args.corrosionEntries);
    expireStacks(args.infernoEntries);
}

/** Damage-credit channels the standing-leech hook distinguishes (damage-leech spec §4). */
type LeechChannel = 'direct' | 'detonation' | 'corrosion' | 'inferno';

/** A team actor input as the ENGINE consumes it: the public TeamActorInput plus an
 *  optional `walk` bundle the adapter (simulateDPS) resolves when the actor carries
 *  shipSkills. With `walk` the actor runs the full runPlayerTurn pipeline; without it it
 *  stays the legacy scheduled-list source (byte-identical to pre-walk behaviour). The
 *  walk's per-actor rates are pre-derived by the adapter (same shape as the attacker's). */
export type TeamActorEngineInput = TeamActorInput & {
    walk?: {
        shipSkills: ShipSkills;
        stats: {
            attack: number;
            crit: number;
            critDamage: number;
            defensePenetration: number;
            hacking: number;
            defence: number;
            hp: number;
        };
        debuffLandingChance: number;
        selfDotModifier: number;
        defensePenetrationBuff: number;
        affinityDamageModifier: number;
        affinityCritCap: number;
        affinityCritPenalty: number;
        hasChargedSkill: boolean;
        /** Caster heal-modifier stat (healing calc). Default 0. */
        healModifier?: number;
    };
};

export interface CombatEngineInput {
    attack: number;
    crit: number;
    critDamage: number;
    defensePenetration: number;
    chargeCount: number;
    shipSkills: ShipSkills;
    enemyDefense: number;
    enemyHp: number;
    numRounds: number;
    /** Scheduled (manual + team) buffs — statusEngine input. */
    selfBuffs: SelectedGameBuff[];
    enemyDebuffs: SelectedGameBuff[];
    /** Team ships as real speed-ordered actors (Phase 2). Their buff lists are keyed to
     *  their own turns via the status engine's teamSources, NOT merged into selfBuffs/
     *  enemyDebuffs (no-double-count). */
    teamActors?: TeamActorEngineInput[];
    // Rate/fold fields below (debuffLandingChance, selfDotModifier, defensePenetrationBuff)
    // are pre-derived by the adapter (simulateDPS) — pass the resolved values, not raw hacking.
    debuffLandingChance: number;
    selfDotModifier: number;
    defensePenetrationBuff: number;
    hasChargedSkill: boolean;
    startCharged: boolean;
    affinityDamageModifier: number;
    affinityCritCap: number;
    affinityCritPenalty: number;
    defence: number;
    hp: number;
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
    /** Healing mode switch (healing calc): the player actor id that heals/shields route to
     *  and consume against. Must be a player actor id (focus or a team actor). When set, the
     *  engine runs in healing mode — heals/shields/cleanses are consumed and a `healing`
     *  result block is returned. Absent → DPS mode (the heal pipeline is fully inert). */
    healTargetId?: string;
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
    }[];
    /** Emit-only event tap. Listeners must not read or mutate combat state. */
    bus?: CombatEventBus;
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
}

/** One enemy-applied DoT active on the heal target, attributed to its source enemy and summed per
 *  type+tier (mirrors the DPS `ActiveDoTState` shape, minus ticksRemaining which the panel omits). */
export interface EnemyDoTState {
    type: 'corrosion' | 'inferno';
    tier: number;
    stacks: number;
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
 * The combat-engine turn loop (combat-system.md §10). Each round builds a turn queue
 * (buildTurnQueue, speed-ordered) and every actor takes one turn: the attacker (default
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
        enemyDefense,
        enemyHp,
        numRounds,
        selfBuffs,
        enemyDebuffs,
        teamActors = [],
        debuffLandingChance,
        selfDotModifier,
        defensePenetrationBuff,
        hasChargedSkill,
        startCharged,
        affinityDamageModifier,
        affinityCritCap,
        affinityCritPenalty,
        defence,
        hp,
        allyChargePerRound,
        enemyType,
        speed,
        enemySpeed,
        bus: externalBus,
    } = input;

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
        stats: { attack, crit, critDamage, defensePenetration, defence, hp, speed: speed ?? 100 },
        chargeCount,
        startCharged,
    });
    const enemy = createActor({
        id: 'enemy',
        side: 'enemy',
        kind: 'enemy',
        stats: {
            attack: 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            defence: enemyDefense,
            hp: enemyHp,
            speed: enemySpeed ?? 50,
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
                      defence: t.walk.stats.defence,
                      hp: t.walk.stats.hp,
                      speed: t.speed,
                  }
                : {
                      attack: 0,
                      crit: 0,
                      critDamage: 0,
                      defensePenetration: 0,
                      defence: 0,
                      hp: 1,
                      speed: t.speed,
                  },
            chargeCount: t.chargeCount,
            startCharged: t.startCharged,
        })
    );

    // Deterministic event gates — replace Math.random / expected-value math so
    // identical inputs always produce identical output. Crit uses one gate PER
    // ACTION STREAM so the charged hit crits at exactly the crit rate regardless
    // of how the charge cadence aligns with the crit schedule (no aliasing).
    // Declared BEFORE the status engine so the landing hook can close over the
    // debuff-landing gate (Task 7 — timed enemy applications draw it once).
    const activeCritGate = makeRateGate();
    const chargedCritGate = makeRateGate();
    // Heal crit gates: SEPARATE streams from the damage crit gates (drawing from those would
    // shift a heal-carrying ship's damage-crit schedule → golden churn). Per-actor isolation.
    const activeHealCritGate = makeRateGate();
    const chargedHealCritGate = makeRateGate();
    const debuffLandingGate = makeRateGate();
    const extendChanceGate = makeRateGate();

    // Affinity-based ('apply') debuffs always hit EXCEPT at an affinity disadvantage,
    // where they are resisted (combat-system.md hit-check). affinityDamageModifier is
    // -25 only on a disadvantage matchup. Constant for the whole run.
    const affinityDisadvantage = affinityDamageModifier < 0;

    // Landing decision for a TIMED enemy application (drawn ONCE at application time):
    // 'apply' (affinity-based) → lands unless at an affinity disadvantage, no gate draw;
    // 'inflict' (and unmarked) → draws the hacking-vs-security landing gate. Threaded
    // into the status engine for scheduled timed enemy upserts (sourceFired) and reused
    // by the engine for ability-sourced timed enemy applications below.
    const landsTimedEnemyApplication = (application?: 'inflict' | 'apply'): boolean =>
        application === 'apply' ? !affinityDisadvantage : debuffLandingGate(debuffLandingChance);

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
    });

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
        debuffLandingChance,
        selfDotModifier,
        defensePenetrationBuff,
        affinityDamageModifier,
        affinityCritCap,
        affinityCritPenalty,
        affinityDisadvantage,
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
        // rolls are isolated from the attacker's deterministic schedule.
        const teamActiveCritGate = makeRateGate();
        const teamChargedCritGate = makeRateGate();
        const teamActiveHealCritGate = makeRateGate();
        const teamChargedHealCritGate = makeRateGate();
        const teamDebuffLandingGate = makeRateGate();
        const teamExtendChanceGate = makeRateGate();
        const teamLandsTimedEnemyApplication = (application?: 'inflict' | 'apply'): boolean =>
            application === 'apply'
                ? !teamAffinityDisadvantage
                : teamDebuffLandingGate(w.debuffLandingChance);
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
            debuffLandingChance: w.debuffLandingChance,
            selfDotModifier: w.selfDotModifier,
            defensePenetrationBuff: w.defensePenetrationBuff,
            affinityDamageModifier: w.affinityDamageModifier,
            affinityCritCap: w.affinityCritCap,
            affinityCritPenalty: w.affinityCritPenalty,
            affinityDisadvantage: teamAffinityDisadvantage,
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
    // bump. Built once. Used by grantAllyCharges below (passed into every runPlayerTurn call).
    const allPlayerActors = [attacker, ...teamCombatActors];

    // Ally-charge grant (Task 5): bump EVERY player actor's charges by `amount`, each capped at
    // its OWN chargeCount, skipping chargeCount 0 (no charge skill → nothing to bank). Called
    // from a caster's active-round charge step (runPlayerTurn). For an attacker-only run this
    // loops the sole attacker → identical net charge to the pre-Task-5 own-only path (no team
    // actors means no ally-targeted charge abilities reach this either). `allyChargePerRound`
    // (the manual attacker-side input) is unchanged and applied separately in runPlayerTurn.
    const grantAllyCharges = (amount: number): void => {
        for (const a of allPlayerActors) {
            if (a.chargeCount <= 0) continue;
            a.charges = Math.min(a.charges + amount, a.chargeCount);
        }
    };

    // All mutable state declared fresh on every call
    let cumulativeDamage = 0;
    // Non-focus (team) cumulative damage. Enemy HP decline everywhere uses
    // cumulativeDamage + cumulativeTeamDamage; the row/summary cumulativeDamage stays focus-only.
    let cumulativeTeamDamage = 0;
    let totalTeamRaw = 0;
    let totalDirectRaw = 0;
    let totalCorrosionRaw = 0;
    let totalInfernoRaw = 0;
    let totalDetonationRaw = 0;
    let totalSecondaryRaw = 0;
    let totalConditionalRaw = 0;
    // DoT containers live on the enemy actor (were loop-locals in the old single-pass loop).
    const corrosionEntries = enemy.corrosionEntries;
    const infernoEntries = enemy.infernoEntries;
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
    const healTarget = healTargetId ? allPlayerActorsById.get(healTargetId) : undefined;
    if (healTargetId && !healTarget) {
        throw new Error(`runCombat: healTargetId '${healTargetId}' is not a player actor`);
    }
    const healingMode = !!healTarget;

    // Enemy attackers (healing mode). Offense-only queue actors that bombard the heal target.
    // They exist ONLY in healing mode — providing them without a heal target is a config bug.
    const enemyAttackerInputs = input.enemyAttackers ?? [];
    if (enemyAttackerInputs.length > 0 && !healTarget) {
        throw new Error('runCombat: enemyAttackers require healTargetId');
    }
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
    // Build a full PlayerActorRuntime for each enemy attacker (Task 5), in input order.
    // Each enemy gets its OWN gate instances (determinism isolation), reactive-partitioned
    // abilities, neutral affinity placeholder, and real defence/hp. The enemy walks
    // runPlayerTurn bound to the heal target (Task 6b) — its damage drains into the target,
    // self-buffs land in its own owner store, debuffs/DoTs on the target's per-target store.
    // Manual flat-card enemies (no shipSkills) are handled inside the builder by synthesizing
    // a single 100%/1-hit basic-attack active slot (parity with the retired EnemyAttackerRuntime).
    const enemyPlayerRuntimes: PlayerActorRuntime[] = enemyAttackerInputs.map((e) =>
        buildEnemyPlayerActorRuntime(e, { statusEngine, playerIds, enemyDebuffLookup })
    );
    const enemyAttackerActors = enemyPlayerRuntimes.map((r) => r.actor);
    const enemyAttackerActorIds = enemyAttackerActors.map((a) => a.id);
    const enemyPlayerRuntimeByActorId = new Map<string, PlayerActorRuntime>(
        enemyPlayerRuntimes.map((r) => [r.actor.id, r])
    );

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
    const playerEnemyBuffNames = (): string[] =>
        selfBuffNamesForOwners(statusEngine, enemyAttackerActorIds);
    const enemyEnemyBuffNames = (): string[] => selfBuffNamesForOwners(statusEngine, playerIds);
    const ownerDebuffNames = (ownerId: string): string[] =>
        ownerDebuffNamesFor(statusEngine, ownerId);

    // Base-HP fallback for recipientMaxHp before an actor has taken its first turn (no ctx yet):
    // attacker → input.hp; walked team → walk stats hp; legacy team → its combat-actor hp (1).
    // Enemy ids are never queried as recipients.
    const baseHpById = new Map<string, number>([
        [attacker.id, hp],
        ...teamActors.map((t) => [t.id, t.walk ? t.walk.stats.hp : 1] as const),
    ]);
    const baseHpFor = (id: string): number => baseHpById.get(id) ?? 0;

    // Base-DEFENCE fallback for an enemy attacker's target-defence read before the target has
    // taken its first turn (no ctx yet): attacker → input.defence; walked team → walk defence;
    // legacy team → 0. After the target's first turn the live ctx.effectiveDefence is preferred.
    const baseDefenceById = new Map<string, number>([
        [attacker.id, defence],
        ...teamActors.map((t) => [t.id, t.walk ? t.walk.stats.defence : 0] as const),
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

    // Recipient's CURRENT effective max HP: prefer the actor's last-turn ctx (live buffs),
    // else its base HP (pre-first-turn). Same pattern for incoming-heal % (ctx value ?? 0).
    const recipientMaxHp = (id: string): number =>
        lastTurnCtxByActor.get(id)?.effectiveMaxHp ?? baseHpFor(id);
    const recipientIncomingHealPct = (id: string): number =>
        lastTurnCtxByActor.get(id)?.incomingHealPct ?? 0;

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
    let healTargetDestroyedRound: number | undefined;
    // Cheat Death consumption (Phase 4b). A 'recurring'/always-active Cheat Death buff is
    // re-derived every round and is NOT stored in the StatusEngine's timed maps, so it cannot
    // be consumed by deleting it from a store (it would regenerate next round). Consumption is
    // therefore a per-actor ENGINE FLAG with combat lifetime: once an actor's intercept fires,
    // its id lands here and a SECOND lethal hit destroys it normally even though the recurring
    // buff is still in the snapshot. Declared OUTSIDE the round loop → persists across rounds.
    const cheatDeathConsumed = new Set<string>();
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

    // ═══════════════════════════════════════════════════════════════════════════════════════
    // Reactive extra-action timing analysis (Phase 4b Task 10). Two death paths land an
    // extra-action grant in DIFFERENT rounds; the engine's grantExtraAction (below) dispatches
    // by whether the round-local turn queue is still being walked:
    //
    //  PATH A — during-turn deaths (on-destroyed self, on-ally-destroyed ally → Harvester).
    //    These fire from applyIncomingToTarget / the general death path, which run DURING an
    //    actor's turn. They are followed by the per-turn drainIntents() (drain point (b)) while
    //    the round-local `queue`/`qi` are still live → the grant CAN splice into the current
    //    round via processExtraActionGrants(currentQi, granter, …). `currentQi` is a ROUND-SCOPED
    //    mutable cursor updated at the top of each `for (qi…)` iteration (NOT a closure over the
    //    loop binding — drainIntents is defined above the loop and also runs pre-loop where qi
    //    doesn't exist). `inTurnLoop` is true only while the loop body walks; the pre-loop /
    //    post-round drains see it false → Path B.
    //
    //  PATH B — post-round enemy death (on-enemy-destroyed → Sokol, Liberator). The enemy is a
    //    cumulative-damage wall whose death is reconciled AFTER the turn loop closed and after
    //    the round's last per-turn drainIntents(). There is NO live queue there. So:
    //      1. A drainIntents() runs immediately after the enemy ship-destroyed emit (post-
    //         reconciliation) — this lets on-enemy-destroyed CHARGE reactives (Liberator's "all
    //         allies add 1 charge") apply immediately; charges carry into the next round → correct.
    //      2. Extra-action grants from on-enemy-destroyed have no queue to splice this round.
    //         grantExtraAction (inTurnLoop false) buffers them onto `pendingExtraActions`; at the
    //         START of the NEXT round's queue construction each buffered granter is inserted one
    //         extra time into that round's queue (respecting once-per-round via the SAME round
    //         extraActionFired set). So the on-kill extra action lands the round AFTER the kill is
    //         registered — deliberate and faithful given the enemy's death is computed post-round
    //         in this DPS sim. The enemy dies exactly once → the grant fires at most once.
    //
    // pendingExtraActions is COMBAT-lifetime (outside the round loop) so a kill reconciled at the
    // end of round R survives into round R+1's queue build. Each entry is flushed (and removed)
    // exactly once at the next round's start.
    // ═══════════════════════════════════════════════════════════════════════════════════════
    const pendingExtraActions: { granterId: string; abilityId: string; oncePerRound: boolean }[] =
        [];

    // The SHARED healing ctx (built once; closures capture the live target + currentRoundHealing
    // through the `let`/the target reference). Only constructed in healing mode.
    const healingCtx: HealingRuntimeCtx | undefined = healTarget
        ? {
              targetId: healTarget.id,
              credit: (actorId, bucket, amount) => {
                  healFor(actorId)[bucket] += amount;
              },
              recipientMaxHp,
              recipientIncomingHealPct,
              // Foreign HoT applier max HP (Task 7): lastTurnCtxByActor ONLY, NO base-stat
              // fallback (strict corrosion applier-ctx rule — undefined → the holder skips the tick).
              applierMaxHp: (id) => lastTurnCtxByActor.get(id)?.effectiveMaxHp,
              applyHealToTarget: (raw) => {
                  // Dead target → all overheal. Otherwise consume up to the deficit against
                  // the target's CURRENT effective max HP (live ctx via recipientMaxHp).
                  if (healTarget.currentHp <= 0) {
                      return { consumed: 0, overheal: raw };
                  }
                  const targetMaxHp = recipientMaxHp(healTarget.id);
                  // Clamp the deficit at 0: a max-HP buff expiring can shrink effectiveMaxHp
                  // below currentHp, making (targetMaxHp - currentHp) negative — without the
                  // Math.max a heal would REDUCE the target's HP. Floor at 0 → consumed 0,
                  // overheal = raw (the whole heal is wasted, which is correct in that state).
                  const consumed = Math.max(0, Math.min(raw, targetMaxHp - healTarget.currentHp));
                  healTarget.currentHp += consumed;
                  return { consumed, overheal: raw - consumed };
              },
              grantShieldToTarget: (raw) => {
                  if (healTarget.currentHp <= 0) return; // dead → no-op
                  const targetMaxHp = recipientMaxHp(healTarget.id);
                  // Capped at the CURRENT effective max HP. Note: if a max-HP buff later expires
                  // and shrinks targetMaxHp below an already-granted pool, the larger pool simply
                  // persists (we never shrink an existing shield) — acceptable, as the cap is only
                  // enforced at grant time and a shield is additive, never HP-reducing.
                  healTarget.shieldPool = Math.min(healTarget.shieldPool + raw, targetMaxHp);
              },
              playerIds,
          }
        : undefined;

    // --- Phase 3 reactive triggers ---
    // Intent queue (FIFO). Reactive listeners enqueue follow-up executions; the engine
    // drains them at the drain points. Pure listeners (enqueue only) keep the Phase 1
    // contract — the executor is the only state mutator.
    const intentQueue: Intent[] = [];
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
    const roleByActorId = new Map<string, ShipTypeName>();
    if (input.role) roleByActorId.set(focusActorId, input.role);
    for (const t of teamActors) if (t.role) roleByActorId.set(t.id, t.role);
    registerReactiveListeners({
        bus,
        perOwner: reactivePerOwner,
        enqueue: (intent) => intentQueue.push(intent),
        isEnemySide,
        roleOf: (id) => roleByActorId.get(id),
    });

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

    // The heal target's passive damage-taken abilities (damage-leech spec §5): each enemy
    // ATTACK on the target procs these AFTER the attack's shield-first drain. Sibling shape
    // to the standing leeches above. Enemy attacks only ever hit the heal target in this
    // model, so only the heal target's runtime is scanned. Healing mode only.
    interface TakenLeech {
        kind: 'heal' | 'shield';
        pct: number;
        noCrit: boolean;
        requiresHpDamage: boolean;
    }
    const takenLeeches: TakenLeech[] = [];
    if (healTarget) {
        const rt = runtimesById.get(healTarget.id);
        if (rt) {
            for (const slot of rt.castSkills.slots) {
                if (slot.slot !== 'passive') continue;
                for (const a of slot.abilities) {
                    const c = a.config;
                    if ((c.type === 'heal' || c.type === 'shield') && c.basis === 'damage-taken') {
                        takenLeeches.push({
                            kind: c.type,
                            pct: c.pct,
                            noCrit: c.type === 'heal' ? (c.noCrit ?? false) : true,
                            requiresHpDamage: c.requiresHpDamage ?? false,
                        });
                    }
                }
            }
        }
    }

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

    for (let r = 1; r <= numRounds; r++) {
        // Advance the status engine's round counter (per-round accumulating stacks
        // tick here, before any turn fires). Sources notify via sourceFired in turn.
        statusEngine.beginRound(r);

        // Combat-start seeding (round 1) for PASSIVE-sourced finite (timed) self-statuses.
        // Player runtimes face the dummy enemy, so an `enemy-type` gate resolves against
        // `enemyType`. Enemy-attacker runtimes face the player heal target (which has no
        // EnemyBaseClass), so their `enemy-type` gate must resolve against undefined.
        if (r === 1) {
            seedPassiveTimedStatuses([...runtimesById.values()], statusEngine, bus, enemyType, r);
            seedPassiveTimedStatuses(enemyPlayerRuntimes, statusEngine, bus, undefined, r);
        }

        // Team actors listed BEFORE the attacker so the input-order tiebreak yields
        // team → attacker → enemy at equal speeds (buildTurnQueue requirement). Enemy
        // attackers (healing mode) are appended after the dummy `enemy`; the queue is
        // speed-ordered so their actual turn position follows their stats.speed.
        const queue = buildTurnQueue([
            ...teamCombatActors,
            attacker,
            enemy,
            ...enemyAttackerActors,
        ]);

        // --- Round accumulator, shared by the turn blocks and the post-round assembly.
        // Declared fresh each round (like the old scalar locals). Each actor writes into
        // its own entry; the post-round assembly derives row fields from the focus entry.
        // The helper `dmg(id)` lazily creates entries on first write — actors that never
        // produce damage in a round simply have no entry, keeping the map sparse.
        const roundDamage = new Map<string, ActorDamage>();
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
        };
        // Healing mode: rebind the per-round healing map (so `credit` writes into THIS round)
        // and snapshot the target's HP%/shield at the ROUND TOP — before any turn. Raw floats;
        // the adapter owns any rounding. No-op in DPS mode (currentRoundHealing stays unread).
        let targetHpPctStart = 0;
        let targetShieldStart = 0;
        // Per-round intake accounting (healing mode): folded into this round's HealingRoundEngine
        // entry at post-round assembly (replacing the 0 placeholders). Enemy attacker turns add
        // to these via the shield-first drain below.
        let roundIncomingDamage = 0;
        let roundShieldAbsorbed = 0;
        // Per-round total fully blocked by an active Barrier (full damage immunity). Tracked
        // SEPARATELY from shieldAbsorbed (Barrier does NOT drain the shield pool) so the UI
        // can attribute the blocked total to the Barrier, not the shield.
        let roundBarrierAbsorbed = 0;
        // Enemy-effects accounting (healing mode, Task 10a): per-enemy self-buffs + the debuffs
        // each enemy lands on the heal target this round, surfaced for the UI's enemy-effects
        // round overview ATTRIBUTED to the source enemy ship. Keyed by the enemy actor id; an
        // entry is created the first time an enemy contributes an effect this round. De-duped by
        // buffName WITHIN each enemy at the post-round push. Empty for a bare/manual enemy → no UI rows.
        const roundEnemyEffects = new Map<
            string,
            { selfBuffs: ActiveBuff[]; debuffs: ActiveBuff[] }
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
        // and folds the totals into roundIncomingDamage / roundShieldAbsorbed. Returns the
        // shield-before + the post-shield hpDamage the caller needs for any per-attack rider (the
        // taken-leech punch-through gate; hpDamage is 0 under Barrier so the leech reads 0). Both
        // the per-attack enemy intake (below) and the tank DoT-tick intake (turn-start) route
        // through here so the bleed accounting is identical.
        const applyIncomingToTarget = (
            damage: number
        ): { shieldBefore: number; hpDamage: number } => {
            roundIncomingDamage += damage;
            // Capture the pre-drain HP + the target's current effective max HP for the
            // tank-side hp-changed emission below (Phase 4c PR 3). Read BEFORE the drain
            // so oldPct reflects the entering state and a Cheat-Death save's oldPct stays
            // the pre-hit value (not 1).
            const hpBefore = healTarget!.currentHp;
            const maxHp = recipientMaxHp(healTarget!.id);
            // Barrier — FULL DAMAGE IMMUNITY (locked game rule). While the heal target carries
            // an active BARRIER_BUFFS status, ALL incoming damage is fully blocked: direct
            // attacks, DoT ticks, AND bomb detonations (all three funnel through this closure).
            // Precedence: Barrier sits strictly IN FRONT OF both the shield pool AND Cheat Death
            // — so a lethal-sized hit blocked by Barrier neither drains the shield nor triggers
            // the Cheat-Death intercept below. Duration-based (timed lifecycle), NOT consumed on
            // first hit. The damage still "arrives" (roundIncomingDamage already incremented
            // above) but its effect is nullified; the blocked amount is tracked SEPARATELY as
            // roundBarrierAbsorbed (NOT roundShieldAbsorbed — Barrier never touches the shield).
            // HP does not move → the emit below is a no-op crossing (oldPct === newPct), which we
            // still fire once for emission consistency. Detection mirrors the Cheat-Death check
            // (selfBuffNamesForOwners aggregates snapshot + timed + active ability self statuses).
            const carriesBarrier = selfBuffNamesForOwners(statusEngine, [healTarget!.id]).some(
                (n) => BARRIER_BUFFS.has(n)
            );
            if (carriesBarrier) {
                roundBarrierAbsorbed += damage;
                if (healTarget!.currentHp > 0 && maxHp > 0) {
                    bus.emit({
                        type: 'hp-changed',
                        targetId: healTarget!.id,
                        round: r,
                        oldPct: (100 * hpBefore) / maxHp,
                        newPct: (100 * healTarget!.currentHp) / maxHp,
                    });
                }
                return { shieldBefore: healTarget!.shieldPool, hpDamage: 0 };
            }
            const shieldBefore = healTarget!.shieldPool;
            const absorbed = Math.min(healTarget!.shieldPool, damage);
            healTarget!.shieldPool -= absorbed;
            roundShieldAbsorbed += absorbed;
            const hpDamage = damage - absorbed;
            healTarget!.currentHp = Math.max(0, healTarget!.currentHp - hpDamage);
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
            if (healTarget!.currentHp <= 0) {
                const targetId = healTarget!.id;
                const carriesCheatDeath = selfBuffNamesForOwners(statusEngine, [targetId]).some(
                    (n) => CHEAT_DEATH_BUFFS.has(n)
                );
                if (carriesCheatDeath && !cheatDeathConsumed.has(targetId)) {
                    healTarget!.currentHp = 1;
                    cheatDeathConsumed.add(targetId);
                    // Display-only: remember the round it was spent so the chip is dropped
                    // from rounds AFTER this one (see hideSpentCheatDeath). First write wins —
                    // the flag above already blocks any second intercept, so this set-once.
                    if (!cheatDeathConsumedRound.has(targetId)) {
                        cheatDeathConsumedRound.set(targetId, r);
                    }
                    statusEngine.clearRemovable(targetId);
                    // The tank's enemy-applied Corrosion/Inferno DoTs are actor-state stacks
                    // (NOT StatusEngine entries), so clearRemovable doesn't touch them — empty
                    // them here so the survivor takes no further ticks. These are the SAME arrays
                    // the turn-start DoT-tick intake reads (healTarget.corrosion/infernoEntries).
                    // Both DoT types are removable; bombs (Blast, treated as persistent here) and
                    // accumulators are intentionally left untouched.
                    healTarget!.corrosionEntries.length = 0;
                    healTarget!.infernoEntries.length = 0;
                    bus.emit({ type: 'cheat-death-activated', actorId: targetId, round: r });
                } else {
                    // First reach 0 (no intercept) → record the destroyed round + emit
                    // ship-destroyed once (shared helper; idempotent via the per-actor
                    // destroyedRound field). The healing result reads the destroyed round back
                    // off the heal target's runtime field below.
                    recordDestroyed(healTarget!, r, bus);
                    healTargetDestroyedRound = healTarget!.destroyedRound;
                }
            }
            // Tank-side hp-changed (Phase 4c PR 3): ONCE per HP-intake event — this closure
            // is called per enemy attack (aggregate drain) AND per turn-start DoT batch, and
            // the emission covers both deliberately ("when HP drops below N%" includes DoT
            // damage in-game). Emitted after the Cheat-Death intercept (a 100→1-HP save
            // counts as a downward crossing — spec §5). Exact percentages (the enemy dummy's
            // post-round emission stays integer-granularity — asymmetry intended, events.ts).
            // A killed tank emits ship-destroyed above, never a posthumous crossing.
            if (healTarget!.currentHp > 0 && maxHp > 0) {
                bus.emit({
                    type: 'hp-changed',
                    targetId: healTarget!.id,
                    round: r,
                    oldPct: (100 * hpBefore) / maxHp,
                    newPct: (100 * healTarget!.currentHp) / maxHp,
                });
            }
            return { shieldBefore, hpDamage };
        };
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
                const enemyHpDecline = cumulativeDamage + cumulativeTeamDamage;
                const enemyHpPct =
                    enemyHp > 0 ? Math.max(0, 100 * (1 - enemyHpDecline / enemyHp)) : 100;
                const lastKnownCtx = lastTurnCtxByActor.get(actor.id);
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
                    directDamage: 0,
                    secondaryDamage: 0,
                    conditionalDamage: 0,
                    detonationDamage: 0,
                    extraActionGrants: [],
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
            }
            return true;
        };

        // Per-round extra-action bookkeeping: oncePerRound abilities fire at most once
        // per actor per round (key `${actorId}:${abilityId}`); total insertions are
        // backstopped. The queue is MUTABLE within the round — grants splice the
        // granting actor back in at its speed position among the REMAINING actors
        // (game-verified: re-added to the turn queue; acts immediately only when
        // fastest remaining). Equal-speed remaining actors keep their place (they were
        // already in line) — deterministic, consistent with the accepted Phase-2
        // tiebreak simplification.
        const extraActionFired = new Set<string>();
        let extraTurnInsertions = 0;
        const processExtraActionGrants = (
            qi: number,
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
                let insertAt = qi + 1;
                while (
                    insertAt < queue.length &&
                    queue[insertAt].stats.speed >= granter.stats.speed
                ) {
                    insertAt += 1;
                }
                queue.splice(insertAt, 0, granter);
            }
        };

        // Round-scoped turn-loop cursor (Path A — see the timing-analysis block above). Updated
        // at the top of each `for (qi…)` iteration; `inTurnLoop` is true only while the loop body
        // walks. The pre-loop and post-round drains see inTurnLoop=false → Path B (buffer). The
        // -1 sentinel is harmless: the pre-loop drain never enqueues a death-triggered extra
        // action (no actor has died yet), and Path B ignores currentQi entirely.
        let currentQi = -1;
        let inTurnLoop = false;

        // Reactive extra-action bridge (Task 10). PATH A (inTurnLoop): splice the granter into
        // the LIVE queue at its speed position among the remaining actors (same machinery the
        // attacker/team turn branches use), so a during-turn death grants a SAME-round extra turn.
        // PATH B (no live queue — post-round enemy death): buffer onto pendingExtraActions; the
        // next round's queue build flushes it. The granter is always a player actor (the ship
        // whose death-passive fired); a missing id is impossible (the reactive owner ids ARE
        // player ids) → skip defensively rather than throw mid-drain.
        const grantExtraAction = (
            granterId: string,
            abilityId: string,
            oncePerRound: boolean
        ): void => {
            const granter = allPlayerActorsById.get(granterId);
            if (!granter) return;
            if (inTurnLoop) {
                processExtraActionGrants(currentQi, granter, [{ abilityId, oncePerRound }]);
            } else {
                pendingExtraActions.push({ granterId, abilityId, oncePerRound });
            }
        };

        // Drain the intent queue FIFO. Listeners may have enqueued during the emission
        // that triggered this drain; executed intents may emit events (chaining) that
        // enqueue MORE — those form the next generation. A generation is the batch
        // present when a drain pass starts; the loop processes one generation per pass
        // and stops when the queue is empty. MAX_INTENT_GENERATIONS converts a
        // pathological self-feeding loop into a thrown error rather than a hang.
        const drainIntents = (): void => {
            let generation = 0;
            while (intentQueue.length > 0) {
                if (++generation > MAX_INTENT_GENERATIONS) {
                    throw new Error(
                        `combat round ${r}: intent queue exceeded MAX_INTENT_GENERATIONS ` +
                            `(${MAX_INTENT_GENERATIONS}) — a reactive trigger is self-amplifying without bound`
                    );
                }
                // Snapshot this generation's batch; new enqueues during execution run next pass.
                const batch = intentQueue.splice(0, intentQueue.length);
                for (const intent of batch) {
                    executeIntent(intent, {
                        round: r,
                        enemy,
                        enemyId: enemy.id,
                        statusEngine,
                        bus,
                        corrosionEntries,
                        infernoEntries,
                        pendingBombs,
                        runtimes: runtimesById,
                        grantAllyCharges,
                        grantExtraAction,
                        playerIds,
                        // Task 7: drain `enemy-buff` gates read the union of enemy attackers'
                        // self-buffs (names only). Empty in DPS mode → byte-identical.
                        enemyAttackerIds: enemyAttackerActorIds,
                        lastTurnCtxByActor,
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
                        // Healing mode only — the SAME shared ctx the player turns use, so a
                        // reactive heal/shield/cleanse credits the same per-round buckets and
                        // mutates the same live target. Undefined in DPS mode → the executor's
                        // heal/shield/cleanse branches stay inert (goldens byte-identical).
                        healing: healingCtx,
                        // Combat-lifetime once-per-battle guard (Task 8): a flagged reactive
                        // repair (Yazid) fires at most once across the whole combat.
                        oncePerCombatFired,
                        // Phase 4c PR 1 Task 6: live self-HP% for drain-time hp-threshold gates.
                        // Healing mode: the heal target's current/max HP is read from the SAME
                        // `healTarget` actor that `applyIncomingToTarget` mutates, so the closure
                        // always sees post-drain HP state. Any non-tank id returns 100 (pre-4c
                        // default). DPS mode: no healTarget → every id returns 100 → byte-identical.
                        ...(healTarget
                            ? {
                                  selfHpPctFor: (ownerId: string): number => {
                                      if (ownerId !== healTarget.id) return 100;
                                      // Same denominator as the cast-path selfHpPct (baseHpFor) —
                                      // a buffed max HP must not make the gate flip at different
                                      // thresholds at cast vs drain time.
                                      const maxHp = baseHpFor(healTarget.id);
                                      if (maxHp <= 0) return 100;
                                      return Math.max(
                                          0,
                                          Math.min(100, (healTarget.currentHp / maxHp) * 100)
                                      );
                                  },
                              }
                            : {}),
                    });
                }
            }
        };

        // Path-B flush (Task 10): grants buffered from a PRIOR round's post-round enemy death
        // (on-enemy-destroyed → Sokol/Liberator) are inserted into THIS round's freshly-built
        // queue at the granter's speed position (qi=-1 → from the queue head among all actors).
        // The round's extraActionFired set + MAX_EXTRA_TURNS_PER_ROUND backstop still bound them.
        // The buffer is drained (cleared) here — each pending grant lands exactly one round after
        // its kill was registered. Insertion happens BEFORE the pre-loop drain/turn loop so the
        // granter takes its extra turn in queue order. Empty in normal DPS/healing runs → no-op.
        if (pendingExtraActions.length > 0) {
            const flush = pendingExtraActions.splice(0, pendingExtraActions.length);
            for (const g of flush) {
                const granter = allPlayerActorsById.get(g.granterId);
                if (!granter) continue;
                processExtraActionGrants(-1, granter, [
                    { abilityId: g.abilityId, oncePerRound: g.oncePerRound },
                ]);
            }
        }

        // round-started: the canonical start-of-round trigger (Phase 3). Fires once per
        // round, before any turn-started of that round. Documented deviation from the
        // Phase 1 contract's turn-started mapping: in a multi-actor round turn-started fires
        // once per actor, so round-started is the reliable "start of round" signal. Emitted
        // here (after the accumulator + drainIntents are in scope) so its start-of-round
        // intents execute BEFORE any turn — no observable ordering change vs the old emit
        // site (nothing between beginRound and here emits an event).
        bus.emit({ type: 'round-started', round: r });
        // Drain point (a): start-of-round intents execute before the first turn.
        drainIntents();

        inTurnLoop = true;
        try {
            for (let qi = 0; qi < queue.length; qi++) {
                // Path-A cursor (Task 10): a during-turn death's grantExtraAction splices into the
                // live queue relative to THIS position. Updated each iteration (queue.length grows as
                // grants splice in, so the for-condition re-reads it).
                currentQi = qi;
                const actor = queue[qi];

                // Dead-target turn skip (top-of-turn): the heal target is already destroyed
                // entering its turn → skip the turn body (see handleDeadTargetSkip above).
                if (handleDeadTargetSkip(actor)) {
                    continue;
                }

                bus.emit({ type: 'turn-started', actorId: actor.id, round: r });

                // Task 11b: tick the HEAL TARGET's own enemy-applied DoTs at ITS turn-start
                // (mirroring the dummy enemy's DoT-tick timing — DoTs tick at the afflicted ship's
                // turn-start). An enemy attacker lands inferno/corrosion in the tank's containers
                // (Task 6b); without this tick they would never deal damage. Routes the ticked
                // damage into the INCOMING-damage accounting (shield-first → HP → ship-destroyed →
                // roundIncoming/roundShield) — NOT the player→enemy damage path. Reuses tickDoTs:
                // the applier's effectiveAttack/dotMult/affinityMult come from the entry's sourceId
                // (the enemy) via lastTurnCtxByActor; corrosion scales with the AFFLICTED ship's
                // (the tank's) max HP. The dead-target guard above already skipped a destroyed tank,
                // so the tank is alive here. DPS mode / no enemy-applied DoTs → empty containers →
                // a no-op (goldens byte-identical).
                if (healTarget && actor.id === healTarget.id) {
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
                        // Corrosion scales with the afflicted ship's HP — the tank's own max HP.
                        enemyHp: recipientMaxHp(healTarget.id),
                        ctxFor: (sourceId) => lastTurnCtxByActor.get(sourceId),
                        emitTicked: (dotType, damage) =>
                            bus.emit({
                                type: 'dot-ticked',
                                targetId: healTarget.id,
                                round: r,
                                dotType,
                                damage,
                            }),
                        // Sum the ticked damage across all appliers; route it as INCOMING to the tank
                        // (NOT into a player damage row). expireStacks inside tickDoTs ages the entries.
                        credit: (_sourceId, _dotType, damage) => {
                            tankDotDamage += damage;
                        },
                    });
                    if (tankDotDamage > 0) {
                        applyIncomingToTarget(tankDotDamage);
                    }
                    // Dead-is-dead: if the turn-start DoT tick was LETHAL the tank just died
                    // (recordDestroyed fired inside applyIncomingToTarget). It must NOT fall through
                    // and take a full turn — re-run the SAME dead-target skip as the top-of-turn
                    // guard. (With Cheat Death the intercept floored HP at 1 → not dead → false → it
                    // acts normally.)
                    if (handleDeadTargetSkip(actor)) {
                        continue;
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
                    const attackerMaxHp = baseHpFor(actor.id);
                    const turn = runPlayerTurn({
                        runtime: attackerRuntime,
                        enemy,
                        statusEngine,
                        corrosionEntries,
                        infernoEntries,
                        pendingBombs,
                        pendingAccumulators,
                        enemyDefense,
                        enemyHp,
                        enemyType,
                        bus,
                        round: r,
                        // enemyHpDecline: focus + team cumulative — the enemy's entering-round HP%
                        // reflects all players' damage so far (gates/HP% column react to it).
                        enemyHpDecline: cumulativeDamage + cumulativeTeamDamage,
                        grantAllyCharges,
                        // Healing mode only — the SHARED ctx (undefined in DPS mode keeps the heal
                        // block inert, goldens byte-identical).
                        healing: healingCtx,
                        // Live HP% for self-HP-threshold gates. In DPS mode the attacker never
                        // takes damage (currentHp === maxHp → 100%) so gates don't fire →
                        // goldens byte-identical. In healing mode the acting actor may be
                        // below full HP (Task 8 enemy attacks reduce currentHp).
                        selfHpPct:
                            attackerMaxHp > 0
                                ? (100 * Math.max(0, actor.currentHp)) / attackerMaxHp
                                : 100,
                        // Heal target's live HP% at THIS turn start (pre-this-cast-heal) for
                        // `hpSubject:'target'` gates (Hermes' "ally below 40% HP" Cheat-Death grant).
                        // healTarget.currentHp here reflects the turn-start DoT tick but not this
                        // cast's heal → exactly the cast-time basis. DPS mode (no healTarget) → 100.
                        targetHpPct: healTargetHpPctNow(),
                        // Task 7: enemy-buff gates read the UNION of enemy attackers' self-buffs;
                        // self-debuff gates read this actor's own enemy-applied debuffs (names only).
                        // Both empty in DPS mode (no enemy attackers, no debuffs on the focus) →
                        // byte-identical goldens.
                        enemyBuffNames: playerEnemyBuffNames(),
                        selfDebuffNames: ownerDebuffNames(actor.id),
                    });

                    // Drain any team-turn resisted entries staged BEFORE this attacker turn
                    // (faster team actors) into the HEAD of this turn's resisted list — same
                    // observable order as the old teamResistedEnemyDebuffs fold-in.
                    if (pendingResisted.length > 0) {
                        turn.resistedEnemyDebuffs.unshift(...pendingResisted);
                        pendingResisted.length = 0;
                    }

                    // Fold the focus turn's numeric damage into the round accumulator.
                    // += (not =) on detonation: with a FASTER enemy, the enemy's bomb/
                    // accumulator bursts ran earlier this round — a plain assignment would
                    // clobber them. direct/secondary/conditional are single-focus-turn
                    // today; += keeps the 0..N-turn seam additive.
                    const d = dmg(actor.id);
                    // secondary/conditional are display sub-buckets already rolled into
                    // turn.directDamage — they must NOT be routed through creditDamage or the
                    // standing-leech hook would double-count them.
                    d.secondary += turn.secondaryDamage;
                    d.conditional += turn.conditionalDamage;
                    creditDamage(actor.id, 'direct', turn.directDamage);
                    creditDamage(actor.id, 'detonation', turn.detonationDamage);
                    focusTurns.push(turn);

                    // Heal-target buffs: if this focus actor IS the heal target (self-heal case),
                    // its comprehensive activeSelfBuffs are the target's own buffs for the round.
                    if (healTarget && actor.id === healTarget.id) {
                        healTargetBuffs = turn.activeSelfBuffs;
                    }

                    // Record this actor's round-scoped ctx for the enemy's DoT-tick attribution.
                    lastTurnCtxByActor.set(actor.id, turn.turnCtx);

                    // Extra-action grants from this turn re-insert the attacker into the
                    // remaining queue (full extra turn — charge cadence, post-turn
                    // decrement, and triggers all run again on the inserted iteration).
                    // The extra turn intentionally re-fires statusEngine.sourceFired too:
                    // re-applying timed buffs, adding persistent stacks, and ticking
                    // accumulators are all correct for a real second turn.
                    processExtraActionGrants(qi, actor, turn.extraActionGrants);
                } else if (actor.kind === 'team' && teamRuntimeById.has(actor.id)) {
                    // ====================================================================
                    // WALKED TEAM TURN — a real speed-ordered ally that runs the FULL
                    // runPlayerTurn pipeline (its own gates/stats/skills). Its damage reduces
                    // enemy HP but is reported separately (teamDamage); runPlayerTurn also calls
                    // statusEngine.sourceFired(actor.id, …) internally, so this actor's manual
                    // extras (TeamActorInput.selfBuffs/enemyDebuffs) still apply on its turns —
                    // the legacy sourceFired block below is fully superseded for walked actors.
                    // ====================================================================
                    const teamMaxHp = baseHpFor(actor.id);
                    const teamTurn = runPlayerTurn({
                        runtime: teamRuntimeById.get(actor.id)!,
                        enemy,
                        statusEngine,
                        corrosionEntries,
                        infernoEntries,
                        pendingBombs,
                        pendingAccumulators,
                        enemyDefense,
                        enemyHp,
                        enemyType,
                        bus,
                        round: r,
                        enemyHpDecline: cumulativeDamage + cumulativeTeamDamage,
                        grantAllyCharges,
                        // Healing mode only — walked team turns heal/shield through the same ctx.
                        healing: healingCtx,
                        // Live HP% for self-HP-threshold gates (same logic as attacker above).
                        selfHpPct:
                            teamMaxHp > 0 ? (100 * Math.max(0, actor.currentHp)) / teamMaxHp : 100,
                        // Heal target's live HP% at this turn start (pre-this-cast-heal) for
                        // `hpSubject:'target'` gates — same basis as the attacker branch.
                        targetHpPct: healTargetHpPctNow(),
                        // Task 7: same as the attacker branch — enemy-buff = union of enemy attackers'
                        // self-buffs; self-debuff = this team actor's own enemy-applied debuffs (names
                        // only). Empty in DPS mode → byte-identical goldens.
                        enemyBuffNames: playerEnemyBuffNames(),
                        selfDebuffNames: ownerDebuffNames(actor.id),
                    });

                    // Fold the team turn's damage into ITS OWN map entry (post-round assembly
                    // sums all non-focus entries into teamDamage). secondary/conditional are
                    // sub-buckets of direct (do NOT double-add) but kept distinct for the
                    // simulator-page seam.
                    const td = dmg(actor.id);
                    td.secondary += teamTurn.secondaryDamage;
                    td.conditional += teamTurn.conditionalDamage;
                    creditDamage(actor.id, 'direct', teamTurn.directDamage);
                    creditDamage(actor.id, 'detonation', teamTurn.detonationDamage);

                    // The team turn's result row fields (action/roundCrit/etc.) are NOT consumed
                    // beyond damage + resisted routing + ctx. Stage its resisted enemy applications
                    // EXACTLY like the legacy team block: before any focus turn → pendingResisted;
                    // after → the last focus turn's list.
                    if (teamTurn.resistedEnemyDebuffs.length > 0) {
                        const lastTurn = focusTurns[focusTurns.length - 1];
                        if (lastTurn) {
                            lastTurn.resistedEnemyDebuffs.push(...teamTurn.resistedEnemyDebuffs);
                        } else {
                            pendingResisted.push(...teamTurn.resistedEnemyDebuffs);
                        }
                    }

                    // Record this team actor's ctx for the enemy's per-entry DoT-tick attribution
                    // (its inferno entries tick with ITS effectiveAttack/dotMult/affinityMult).
                    lastTurnCtxByActor.set(actor.id, teamTurn.turnCtx);

                    // Heal-target buffs: a walked team actor that IS the heal target surfaces its
                    // own comprehensive activeSelfBuffs (incl. recurring Cheat Death/Everliving Regen).
                    if (healTarget && actor.id === healTarget.id) {
                        healTargetBuffs = teamTurn.activeSelfBuffs;
                    }

                    processExtraActionGrants(qi, actor, teamTurn.extraActionGrants);
                } else if (actor.kind === 'team') {
                    // No healTargetBuffs capture here: the heal target is always a WALKED actor
                    // (HealingCalculatorPage builds it with shipSkills+stats, so it takes the
                    // walked-team branch above), never this legacy branch. Revisit if heal-target
                    // actor construction ever changes.
                    // ====================================================================
                    // TEAM TURN — a real speed-ordered ally. It deals no damage; its sole
                    // job is to notify the status engine that ITS source fired this round so
                    // its timed buffs (keyed by this actor's id) upsert onto the maps. preTurn
                    // mirrors the attacker's charge cadence on the actor's OWN fields; bonus
                    // charges do not apply (team actors have no charge abilities). A FASTER
                    // team actor runs before the attacker's snapshot() → its buffs are visible
                    // this round; a SLOWER one upserts after → visible from the next round.
                    // ====================================================================
                    const teamHasCharged = actor.chargeCount > 0;
                    let teamAction: 'active' | 'charged';
                    if (teamHasCharged && actor.charges >= actor.chargeCount) {
                        teamAction = 'charged';
                    } else {
                        teamAction = 'active';
                    }
                    advanceChargeCadence(actor, teamHasCharged);

                    bus.emit({
                        type: 'skill-fired',
                        actorId: actor.id,
                        round: r,
                        slot: teamAction,
                    });

                    const { resistedEnemy, appliedEnemy } = statusEngine.sourceFired(
                        actor.id,
                        teamAction === 'charged' ? 'charge' : 'active',
                        r
                    );
                    // Emit debuff-applied ONCE per landed timed enemy application (discrete-
                    // infliction event — Phase 3 retiming). sourceId = this team actor's id.
                    for (const buffName of appliedEnemy) {
                        bus.emit({
                            type: 'debuff-applied',
                            sourceId: actor.id,
                            targetId: enemy.id,
                            round: r,
                            buffName,
                        });
                    }
                    // Synthesize + record this team turn's resisted timed enemy applications
                    // (mirror the attacker's resisted-synthesis). A FASTER team actor (before
                    // any attacker turn) stages into pendingResisted, drained into the next
                    // attacker turn's resisted head. A SLOWER team actor (after an attacker
                    // turn) appends directly to the LAST attacker turn's resisted list — same
                    // observable order as the old attackerHasActed split.
                    const teamResisted = synthesizeResisted(resistedEnemy, enemyDebuffLookup, (n) =>
                        bus.emit({
                            type: 'debuff-resisted',
                            targetId: enemy.id,
                            round: r,
                            buffName: n,
                        })
                    );
                    if (teamResisted.length > 0) {
                        const lastTurn = focusTurns[focusTurns.length - 1];
                        if (lastTurn) {
                            // Slower team turn: append to the last attacker turn's resisted list.
                            lastTurn.resistedEnemyDebuffs.push(...teamResisted);
                        } else {
                            // Faster team turn: no attacker turn yet this round; stage here.
                            pendingResisted.push(...teamResisted);
                        }
                    }
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
                        enemyHp,
                        ctxFor: (sourceId) => lastTurnCtxByActor.get(sourceId),
                        emitTicked: (dotType, damage) =>
                            bus.emit({
                                type: 'dot-ticked',
                                targetId: enemy.id,
                                round: r,
                                dotType,
                                damage,
                            }),
                        credit: (sourceId, dotType, damage) =>
                            creditDamage(sourceId, dotType, damage),
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
                    // Healing mode is guaranteed here (enemyAttackers require healTargetId), so
                    // healTarget is defined whenever this branch runs.
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
                    const enemyRuntime = enemyPlayerRuntimeByActorId.get(actor.id)!;
                    const targetDead = healTarget!.currentHp <= 0;
                    let damage = 0;
                    // Hoisted for use in the post-else `attacked` emit (Task 8): enemyTurn is
                    // scoped inside the else block below; this flag carries its roundCrit out.
                    let enemyTurnDidCrit = false;
                    // Hoisted for per-hit `attacked` emission (Phase 4c Task 3): populated from
                    // enemyTurn.hitCrits in the ship-backed branch; stays [] on the dead-target
                    // path and on the manual flat-enemy path (which has no hitCrits to surface).
                    let enemyHitCrits: boolean[] = [];
                    if (targetDead) {
                        // Cadence-only: bank a charge (or fire+reset at cap) without resolving the
                        // attack. Mirrors runPlayerTurn's preTurn charge step. No skill-fired/
                        // application events — a dead target is untouched (old short-circuit).
                        // The `&& actor.chargeCount > 0` term is redundant (hasChargedSkill already
                        // implies chargeCount >= 1); the helper's internal guard handles it.
                        advanceChargeCadence(actor, enemyRuntime.hasChargedSkill);
                        // No enemyTurn → no lastTurnCtxByActor update (parity: the old dead path
                        // produced no ctx either; this actor has no live DoTs to attribute).
                    } else {
                        // Target's CURRENT effective defence: prefer its last-turn ctx (live buffs),
                        // else its base defence (pre-first-turn fallback).
                        const targetDefence =
                            lastTurnCtxByActor.get(healTarget!.id)?.effectiveDefence ??
                            baseDefenceFor(healTarget!.id);
                        // Target's max-HP pool + its damage-so-far → the enemyHpPct the enemy's OWN
                        // condition gates read (a bare neutral enemy has no such gates, so this is inert
                        // for current fixtures; computed for correctness when Task 7+ adds gated kits).
                        const targetMaxHpForEnemy = recipientMaxHp(healTarget!.id);
                        const targetHpDecline = Math.max(
                            0,
                            targetMaxHpForEnemy - healTarget!.currentHp
                        );
                        // Enemy's OWN live HP% (Task 3): enemies are at full HP (or hp 0 → guard to 100).
                        const enemyActorMaxHp = enemyRuntime.hp;
                        const enemySelfHpPct =
                            enemyActorMaxHp > 0
                                ? (100 * Math.max(0, enemyRuntime.actor.currentHp)) /
                                  enemyActorMaxHp
                                : 100;
                        const enemyTurn = runPlayerTurn({
                            runtime: enemyRuntime,
                            // The heal target is the enemy's victim — bind it as the `enemy` arg so
                            // damage/debuffs resolve against it and route to its per-target store.
                            enemy: healTarget!,
                            targetId: healTarget!.id,
                            statusEngine,
                            // The TARGET's DoT/bomb/accumulator containers (enemy applications land here).
                            corrosionEntries: healTarget!.corrosionEntries,
                            infernoEntries: healTarget!.infernoEntries,
                            pendingBombs: healTarget!.pendingBombs,
                            pendingAccumulators: healTarget!.pendingAccumulators,
                            enemyDefense: targetDefence,
                            enemyHp: targetMaxHpForEnemy,
                            enemyHpDecline: targetHpDecline,
                            // No class is carried on a CombatActor → undefined (no enemyType matchup).
                            enemyType: undefined,
                            bus,
                            round: r,
                            // Opposing side from the ENEMY's view = the player team (Task 7). UNION of
                            // player self-buff names for the enemy's own `enemy-buff` gates. A bare enemy
                            // has no such gate, so this is inert today — computed for the full-kit enemy.
                            enemyBuffNames: enemyEnemyBuffNames(),
                            // This enemy's OWN debuffs (a player ability could land some onto it), keyed
                            // by THIS actor's id (its per-target store). Empty for the current fixtures —
                            // no player ability targets enemy attackers — but threaded for the full kit.
                            selfDebuffNames: ownerDebuffNames(actor.id),
                            // grantAllyCharges is OMITTED for the enemy walk (Task 6b emission scoping):
                            // the engine's closure bumps only PLAYER actors (allPlayerActors), so an enemy
                            // running runPlayerTurn must never reach it — its "allies" are enemy-side, not
                            // the player team. Inert today (the synthesized manual enemy is damage-only with
                            // no ally-charge ability, so runPlayerTurn never calls it → goldens byte-identical),
                            // but guarded now so a future full-kit enemy (Task 9) can never grant player charges.
                            grantAllyCharges: undefined,
                            healing: healingCtx,
                            selfHpPct: enemySelfHpPct,
                            // Heal target's live HP% (the enemy is bound to it). Inert for current
                            // fixtures (a bare enemy has no `hpSubject:'target'` gate) but threaded
                            // for consistency with the player-turn dispatches.
                            targetHpPct: healTargetHpPctNow(),
                        });
                        // Total damage the enemy dealt to the bound target this turn. secondary/
                        // conditional are display sub-buckets ALREADY inside directDamage (do NOT
                        // re-add). detonationDamage is the player-turn detonate() portion (0 for a bare
                        // enemy). Credit it as INCOMING damage to the tank — NOT a player damage row.
                        damage = enemyTurn.directDamage + enemyTurn.detonationDamage;
                        // Hoist roundCrit into the outer scope for the `attacked` emit (Task 8).
                        enemyTurnDidCrit = enemyTurn.roundCrit;
                        // Hoist per-hit crit array for the per-hit `attacked` emit (Phase 4c Task 3).
                        enemyHitCrits = enemyTurn.hitCrits;
                        // Record the enemy actor's round-scoped ctx (parity with player/team branches;
                        // its own future DoT entries would tick with this ctx).
                        lastTurnCtxByActor.set(actor.id, enemyTurn.turnCtx);
                        // Surface this enemy attacker's effects for the UI's round overview (Task 10a):
                        // its own active self-buffs and the debuffs it landed on the heal target,
                        // ATTRIBUTED to this enemy's actor id. NAMES ONLY for display — never folded
                        // into any sim value. Empty for a bare enemy → no entry recorded for it.
                        // Debuffs use inflictedEnemyDebuffs (source-accurate: only what THIS enemy
                        // applied this turn) rather than landedEnemyDebuffs (the shared per-target
                        // window, which would leak other attackers' debuffs into this enemy's group).
                        if (
                            enemyTurn.activeSelfBuffs.length > 0 ||
                            enemyTurn.inflictedEnemyDebuffs.length > 0
                        ) {
                            let entry = roundEnemyEffects.get(actor.id);
                            if (!entry) {
                                entry = { selfBuffs: [], debuffs: [] };
                                roundEnemyEffects.set(actor.id, entry);
                            }
                            entry.selfBuffs.push(...enemyTurn.activeSelfBuffs);
                            entry.debuffs.push(...enemyTurn.inflictedEnemyDebuffs);
                        }
                        // Extra-action grants: re-insert this enemy into the remaining queue for an extra
                        // turn (full-actor completeness — mirrors the attacker and walked-team branches).
                        // The oncePerRound / MAX_EXTRA_TURNS_PER_ROUND backstops inside
                        // processExtraActionGrants absorb any runaway grants. grantAllyCharges stays
                        // undefined (enemy's "allies" are enemy-side, not the player team).
                        processExtraActionGrants(qi, actor, enemyTurn.extraActionGrants);
                    }
                    if (damage > 0) {
                        // Shield-first drain → HP → ship-destroyed → roundIncoming/roundShield. The
                        // shieldBefore/hpDamage are captured for the punch-through gate (Quixilver) below.
                        // hpDamage comes straight from the closure (0 under Barrier — damage fully
                        // blocked, not shield-absorbed — otherwise damage - absorbed).
                        const { shieldBefore, hpDamage } = applyIncomingToTarget(damage);

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
                        // to the heal target (enemy attacks only ever hit it).
                        if (takenLeeches.length > 0 && healingCtx) {
                            const rt = runtimesById.get(healTarget!.id);
                            for (const e of takenLeeches) {
                                if (e.requiresHpDamage && !(shieldBefore > 0 && hpDamage > 0)) {
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
                                    healingCtx.credit(healTarget!.id, 'effectiveHeal', consumed);
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
                        for (const hitCrit of hitOutcomes) {
                            bus.emit({
                                type: 'attacked',
                                targetId: healTarget!.id,
                                attackerId: actor.id,
                                round: r,
                                ...(hitCrit ? { didCrit: true } : {}),
                            });
                        }
                    }
                }

                // Drain point (b): follow-ups triggered by this actor's turn body run as
                // "consecutive actions" within the turn — BEFORE the owner Post Turn, so any
                // status they apply obeys the same-turn decrement rule (the carrier's Post Turn
                // below decrements it). A triggered effect therefore never boosts the hit that
                // triggered it (the hit's damage was already computed in the turn body).
                drainIntents();

                // Post Turn (combat-system.md section 4): the status CARRIER decrements.
                // Player-side actors call decrementPlayer(actor.id) — team actors have empty
                // maps now and calling on an empty owner is a safe no-op. The DUMMY enemy calls
                // decrementEnemy() (it carries the singular enemy status maps).
                if (actor.kind === 'enemy' && actor.id === enemy.id) {
                    for (const buffName of statusEngine.decrementEnemy().expired) {
                        bus.emit({ type: 'buff-expired', actorId: actor.id, round: r, buffName });
                    }
                } else if (actor.kind === 'enemy') {
                    // Enemy ATTACKER (Task 6b): now a runPlayerTurn walker. It carries its OWN
                    // player-side status map (self-buffs land under its actor id) — decrement that
                    // exactly like an attacker/team owner. An attacker with an empty self map (manual
                    // enemy → no self-buffs) is a safe no-op. The enemy debuffs it lands on the heal
                    // target live in the enemy-side per-target store keyed by the TARGET's id; those
                    // decrement when the TARGET takes its Post Turn (the player-side branch below).
                    for (const buffName of statusEngine.decrementPlayer(actor.id).expired) {
                        bus.emit({ type: 'buff-expired', actorId: actor.id, round: r, buffName });
                    }
                } else {
                    // 'attacker' and 'team' kinds: decrement this actor's player-side self map.
                    for (const buffName of statusEngine.decrementPlayer(actor.id).expired) {
                        bus.emit({ type: 'buff-expired', actorId: actor.id, round: r, buffName });
                    }
                    // Heal target also carries the enemy-side debuffs an enemy attacker landed on it
                    // (per-target store keyed by its id — Task 1/6b). Decrement that store on its
                    // own Post Turn (the afflicted ship is the carrier, combat-system §4). Empty for
                    // damage-only enemies → no-op (goldens unaffected); the default '__enemy__' store
                    // is decremented separately on the dummy enemy's turn (above), never here.
                    if (healTarget && actor.id === healTarget.id) {
                        for (const buffName of statusEngine.decrementEnemy(actor.id).expired) {
                            bus.emit({
                                type: 'buff-expired',
                                actorId: actor.id,
                                round: r,
                                buffName,
                            });
                        }
                    }
                }

                bus.emit({ type: 'turn-ended', actorId: actor.id, round: r });
            }
        } finally {
            // The turn loop is closed: no live queue remains. The reset lives in `finally` so it
            // is structurally guaranteed on ANY loop exit (normal, break, return, throw) — a future
            // early exit added to the round loop can no longer leave `inTurnLoop` stuck true and
            // mis-dispatch the post-round drain as Path A. Any extra-action grant from here on (the
            // post-round enemy-death drain below) sees inTurnLoop=false → Path B (buffered for next round).
            inTurnLoop = false;
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
        const directDamage = focus.direct;
        const corrosionDamage = focus.corrosion;
        const infernoDamage = focus.inferno;
        const detonationDamage = focus.detonation;

        if (detonationDamage > 0) {
            bus.emit({
                type: 'dot-detonated',
                targetId: enemy.id,
                round: r,
                damage: detonationDamage,
            });
        }

        const totalRoundDamage = focus.direct + focus.corrosion + focus.inferno + focus.detonation;
        cumulativeDamage += totalRoundDamage;
        // Row/summary rawTotals stay FOCUS-only — only the focus actor reaches summary DPS
        // and the damage-type breakdown (config comparison stays meaningful).
        totalDirectRaw += focus.direct;
        totalSecondaryRaw += focus.secondary;
        totalConditionalRaw += focus.conditional;
        totalCorrosionRaw += focus.corrosion;
        totalInfernoRaw += focus.inferno;
        totalDetonationRaw += focus.detonation;

        // Team damage = Σ over all NON-focus actor entries of every channel (direct already
        // includes its secondary/conditional sub-buckets, so they are NOT added separately).
        // By construction totalRoundDamage + teamRoundDamage = the round's enemy-HP delta.
        let teamRoundDamage = 0;
        for (const [id, d] of roundDamage) {
            if (id === focusActorId) continue;
            teamRoundDamage += d.direct + d.corrosion + d.inferno + d.detonation;
        }
        cumulativeTeamDamage += teamRoundDamage;
        totalTeamRaw += teamRoundDamage;

        // Track the enemy's remaining HP and emit hp-changed / ship-destroyed taps
        // (emission-only; the sim keeps hitting the dead dummy regardless). Enemy HP decline
        // uses focus + team cumulative — team damage reduces enemy HP for gates/HP%/destruction.
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
        if (enemy.currentHp <= 0) {
            // Shared helper: stamps enemy.destroyedRound + emits ship-destroyed exactly once
            // (idempotent), replacing the old destroyedEmitted boolean.
            recordDestroyed(enemy, r, bus);
            // Path-B drain (Task 10): the enemy died POST-round — the turn loop is closed and no
            // per-turn drain follows. Drain the on-enemy-destroyed intents now: CHARGE reactives
            // (Liberator's "all allies add 1 charge") apply immediately (charges carry into the
            // next round → correct); EXTRA-ACTION grants see inTurnLoop=false → buffer for next
            // round (cross-round pending grant). recordDestroyed is idempotent so this drains at
            // most once per combat. With NO on-enemy-destroyed listener registered the intent
            // queue is empty → this is a NO-OP (goldens byte-identical).
            drainIntents();
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
            // teamDamage set ONLY when walked team actors exist (undefined preserves the
            // legacy/attacker-only RoundData shape — goldens stay byte-identical).
            ...(hasWalkedTeam ? { teamDamage: Math.round(teamRoundDamage) } : {}),
            // extraTurns set ONLY when ≥ 1 (undefined preserves legacy RoundData shape).
            ...(focusTurns.length > 1 ? { extraTurns: focusTurns.length - 1 } : {}),
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
            ],
        });

        // Healing mode: push this round's healing accounting. incomingDamage/shieldAbsorbed
        // are the per-round intake totals folded from this round's enemy attacker turns.
        // The destroyed-round seam is set the moment the target's HP first reaches 0 (in the
        // enemy attacker turn); this post-round guard is a backstop for any other 0-HP path.
        if (healTarget) {
            healingRounds.push({
                perActor: currentRoundHealing,
                targetHpPctStart,
                targetShieldStart,
                incomingDamage: roundIncomingDamage,
                shieldAbsorbed: roundShieldAbsorbed,
                barrierAbsorbed: roundBarrierAbsorbed,
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
            if (healTargetDestroyedRound === undefined && healTarget.currentHp <= 0) {
                healTargetDestroyedRound = r;
            }
        }
    }

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
