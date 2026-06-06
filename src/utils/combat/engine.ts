import { EnemyBaseClass, SelectedGameBuff, TeamActorInput } from '../../types/calculator';
import { ShipSkills } from '../../types/abilities';
import { makeRateGate } from '../calculators/rateAccumulator';
import type { RoundData } from '../calculators/dpsSimulator';
import { type ExtraActionGrant } from '../abilities/applyAbilities';
import {
    ActiveDoTStack,
    ActorDamage,
    CombatActor,
    PendingAccumulator,
    PendingBomb,
    createActor,
    buildTurnQueue,
    emptyActorDamage,
} from './state';
import {
    ActiveBuff,
    AbilityStatusPayload,
    RegisteredAbilityStatus,
    createStatusEngine,
} from './statusEngine';
import { liveGateConditions } from './abilityStatusGating';
import { CombatEventBus, createEventBus } from './events';
import { synthesizeResisted } from './shared';
import { PlayerActorRuntime, PlayerRoundCtx, PlayerTurnResult, runPlayerTurn } from './playerTurn';
import {
    Intent,
    MAX_INTENT_GENERATIONS,
    executeIntent,
    partitionReactiveAbilities,
    registerReactiveListeners,
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
// effect inclusion aura-gated; aura (recurring/undefined duration OR passive slot) → per-round
// effect gate; timed (finite duration) → gated at application.
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
    playerIds: string[]
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
            // Player-side recipients (self vs ally/all-allies). Enemy-side statuses ignore this
            // (recipients are only consulted on the self side). Self → caster only; ally/all-allies
            // → every player actor (fixed source order). `playerIds` already includes the caster.
            const recipients: string[] =
                side === 'enemy'
                    ? [] // enemy-side statuses have no player recipients; the timed-enemy application path never reads recipients
                    : ability.target === 'ally' || ability.target === 'all-allies'
                      ? playerIds
                      : [ownerId];
            const accumulating = !!cfg.stackTrigger && cfg.isStackable;
            const isAura =
                !accumulating &&
                (cfg.duration === 'recurring' ||
                    cfg.duration === undefined ||
                    slot.slot === 'passive');
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
                // not recurring/undefined duration and not a passive slot). The classification
                // branches above exhaustively exclude non-numeric durations from reaching this arm.
                status = { ...base, kind: 'timed', duration: cfg.duration as number };
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

function totalStacks(entries: ActiveDoTStack[]): number {
    return entries.reduce((sum, e) => sum + e.stacks, 0);
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
    /** Emit-only event tap. Listeners must not read or mutate combat state. */
    bus?: CombatEventBus;
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
    // enemy via the status engine's per-source timed sets). Dummy combat stats keep the
    // shared ActorStats shape; only `speed` (turn order) and chargeCount/startCharged matter.
    const teamCombatActors = teamActors.map((t) =>
        createActor({
            id: t.id,
            side: 'player',
            kind: 'team',
            stats: {
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
        playerIds
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
            playerIds
        );
        const teamAffinityDisadvantage = w.affinityDamageModifier < 0;
        // Own gate instances — separate draw streams so a team actor's crit/landing/extend
        // rolls are isolated from the attacker's deterministic schedule.
        const teamActiveCritGate = makeRateGate();
        const teamChargedCritGate = makeRateGate();
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
    // hp-changed / ship-destroyed event tracking (emission-only, no sim effect).
    let lastEnemyHpPctInt = 100;
    let destroyedEmitted = false;

    const roundData: RoundData[] = [];

    // Per-actor round-scoped context the enemy's DoT processing reads. Keyed by actor id;
    // every player turn sets its entry after runPlayerTurn. A DoT entry's tick resolves the
    // APPLIER's ctx (effectiveAttack for inferno; dotMult/affinityMult for both) via this map.
    // The focus actor's ctx feeds the row exactly as the old single `lastAttackerCtx` did. An
    // entry whose applier has not yet acted this run (faster-enemy round 1) has no ctx → skip.
    const lastTurnCtxByActor = new Map<string, PlayerRoundCtx>();

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
    registerReactiveListeners({
        bus,
        perOwner: reactivePerOwner,
        enqueue: (intent) => intentQueue.push(intent),
        enemyId: enemy.id,
    });

    // Owner-routed executor context (Task 6): the executor resolves an intent's owner runtime
    // from this map for per-owner landing gates, charge caps, sourceId, bomb effective-attack.
    const runtimesById = new Map<string, PlayerActorRuntime>([
        ['attacker', attackerRuntime],
        ...teamRuntimeById,
    ]);

    for (let r = 1; r <= numRounds; r++) {
        // Advance the status engine's round counter (per-round accumulating stacks
        // tick here, before any turn fires). Sources notify via sourceFired in turn.
        statusEngine.beginRound(r);

        // Team actors listed BEFORE the attacker so the input-order tiebreak yields
        // team → attacker → enemy at equal speeds (buildTurnQueue requirement).
        const queue = buildTurnQueue([...teamCombatActors, attacker, enemy]);

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
        // Per-focus-turn results; the post-round assembly reads the LAST one for the
        // row's attacker fields. Numeric damage totals are summed across all turns.
        const focusTurns: PlayerTurnResult[] = [];
        // Team-turn resisted enemy applications recorded BEFORE any attacker turn this
        // round (faster team actors). Drained into the FIRST subsequent attacker turn's
        // resistedEnemyDebuffs head; team turns AFTER an attacker turn append to the LAST
        // attacker turn's list (same observable order as the old attackerHasActed +
        // teamResistedEnemyDebuffs staging).
        const pendingResisted: ActiveBuff[] = [];

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
                        playerIds,
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
                    });
                }
            }
        };

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

        for (let qi = 0; qi < queue.length; qi++) {
            const actor = queue[qi];
            bus.emit({ type: 'turn-started', actorId: actor.id, round: r });

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
                d.direct += turn.directDamage;
                d.secondary += turn.secondaryDamage;
                d.conditional += turn.conditionalDamage;
                d.detonation += turn.detonationDamage;
                focusTurns.push(turn);

                // Record this actor's round-scoped ctx for the enemy's DoT-tick attribution.
                lastTurnCtxByActor.set(actor.id, turn.turnCtx);

                // Extra-action grants from this turn re-insert the attacker into the
                // remaining queue (full extra turn — charge cadence, post-turn
                // decrement, and triggers all run again on the inserted iteration).
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
                });

                // Fold the team turn's damage into ITS OWN map entry (post-round assembly
                // sums all non-focus entries into teamDamage). secondary/conditional are
                // sub-buckets of direct (do NOT double-add) but kept distinct for the
                // simulator-page seam.
                const td = dmg(actor.id);
                td.direct += teamTurn.directDamage;
                td.secondary += teamTurn.secondaryDamage;
                td.conditional += teamTurn.conditionalDamage;
                td.detonation += teamTurn.detonationDamage;

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

                processExtraActionGrants(qi, actor, teamTurn.extraActionGrants);
            } else if (actor.kind === 'team') {
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
                    actor.charges = 0;
                } else {
                    teamAction = 'active';
                    if (teamHasCharged) actor.charges += 1;
                }

                bus.emit({ type: 'skill-fired', actorId: actor.id, round: r, slot: teamAction });

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
            } else if (actor.kind === 'enemy') {
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
                    credit: (sourceId, dotType, damage) => {
                        dmg(sourceId)[dotType] += damage;
                    },
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
                    creditDetonation: (sourceId, damage) => {
                        dmg(sourceId).detonation += damage;
                    },
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
                    creditDetonation: (sourceId, damage) => {
                        dmg(sourceId).detonation += damage;
                    },
                });
            }

            // Drain point (b): follow-ups triggered by this actor's turn body run as
            // "consecutive actions" within the turn — BEFORE the owner Post Turn, so any
            // status they apply obeys the same-turn decrement rule (the carrier's Post Turn
            // below decrements it). A triggered effect therefore never boosts the hit that
            // triggered it (the hit's damage was already computed in the turn body).
            drainIntents();

            // Post Turn (combat-system.md section 4): the status CARRIER decrements.
            // Player-side actors call decrementPlayer(actor.id) — team actors have empty
            // maps now and calling on an empty owner is a safe no-op. Enemy actors call
            // decrementEnemy(). This wires ALL player-kind actors so that when team
            // actors gain real status in a later task, decrement just works.
            if (actor.kind === 'enemy') {
                for (const buffName of statusEngine.decrementEnemy().expired) {
                    bus.emit({ type: 'buff-expired', actorId: actor.id, round: r, buffName });
                }
            } else {
                // 'attacker' and 'team' kinds: decrement this actor's player-side map.
                for (const buffName of statusEngine.decrementPlayer(actor.id).expired) {
                    bus.emit({ type: 'buff-expired', actorId: actor.id, round: r, buffName });
                }
            }

            bus.emit({ type: 'turn-ended', actorId: actor.id, round: r });
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
        const activeSelfBuffsForRound = lastAttackerTurn.activeSelfBuffs;
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
        if (!destroyedEmitted && enemy.currentHp <= 0) {
            bus.emit({ type: 'ship-destroyed', actorId: enemy.id, round: r });
            destroyedEmitted = true;
        }

        // Report stacks after expiry (state going into next round)
        roundData.push({
            round: r,
            action,
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
    };
}
