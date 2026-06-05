import { EnemyBaseClass, SelectedGameBuff, TeamActorInput } from '../../types/calculator';
import { ShipSkills } from '../../types/abilities';
import { makeRateGate } from '../calculators/rateAccumulator';
import type { RoundData } from '../calculators/dpsSimulator';
import {
    ActiveDoTStack,
    ActorDamage,
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

function tickDoTStacks(entries: ActiveDoTStack[], baseValue: number): number {
    return entries.reduce((sum, e) => sum + e.stacks * (e.tier / 100) * baseValue, 0);
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
function processBombs(args: {
    pendingBombs: PendingBomb[];
    affinityMult: number;
    emitBombDetonated?: (stacks: number, damage: number) => void;
}): number {
    let bombBurst = 0;
    for (let i = args.pendingBombs.length - 1; i >= 0; i--) {
        args.pendingBombs[i].countdown -= 1;
        if (args.pendingBombs[i].countdown <= 0) {
            const burstDamage =
                args.pendingBombs[i].stacks *
                args.pendingBombs[i].damagePerStack *
                args.affinityMult;
            args.emitBombDetonated?.(args.pendingBombs[i].stacks, burstDamage);
            bombBurst += args.pendingBombs[i].stacks * args.pendingBombs[i].damagePerStack;
            args.pendingBombs.splice(i, 1);
        }
    }
    return bombBurst * args.affinityMult;
}

// Step 6b: Echoing Burst accumulators gather this round's direct damage, then detonate
// for pct% of the accumulated total on expiry (game-categorised as detonation damage).
// directDamage already includes affinity, so no extra affinity multiplier is applied.
function processAccumulators(args: {
    pendingAccumulators: PendingAccumulator[];
    directDamage: number;
}): number {
    let accumulatorBurst = 0;
    for (let i = args.pendingAccumulators.length - 1; i >= 0; i--) {
        args.pendingAccumulators[i].accumulated += args.directDamage;
        args.pendingAccumulators[i].roundsRemaining -= 1;
        if (args.pendingAccumulators[i].roundsRemaining <= 0) {
            accumulatorBurst +=
                args.pendingAccumulators[i].accumulated * (args.pendingAccumulators[i].pct / 100);
            args.pendingAccumulators.splice(i, 1);
        }
    }
    return accumulatorBurst;
}

// Steps 4 & 5: Tick corrosion (scales with enemy HP, capped at 5000 dmg per 1%) and
// inferno (scales with the attacker's effective attack, no outgoing buff), then expire
// both stack sets. Returns the two per-round tick totals.
function tickDoTs(args: {
    corrosionEntries: ActiveDoTStack[];
    infernoEntries: ActiveDoTStack[];
    enemyHp: number;
    effectiveAttack: number;
    dotMult: number;
    affinityMult: number;
    emitTicked: (dotType: 'corrosion' | 'inferno', damage: number) => void;
}): { corrosionDamage: number; infernoDamage: number } {
    // Step 4: Tick corrosion (scales with enemy HP, capped at 5000 dmg per 1%)
    const corrosionBaseHp = Math.min(args.enemyHp, 500_000);
    const corrosionDamage =
        tickDoTStacks(args.corrosionEntries, corrosionBaseHp) * args.dotMult * args.affinityMult;
    if (corrosionDamage > 0) {
        args.emitTicked('corrosion', corrosionDamage);
    }

    // Step 5: Tick inferno (scales with attacker's effective attack, no outgoing buff)
    const infernoDamage =
        tickDoTStacks(args.infernoEntries, args.effectiveAttack) * args.dotMult * args.affinityMult;
    if (infernoDamage > 0) {
        args.emitTicked('inferno', infernoDamage);
    }

    // Expire DoT stacks after ticking
    expireStacks(args.corrosionEntries);
    expireStacks(args.infernoEntries);

    return { corrosionDamage, infernoDamage };
}

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
    teamActors?: TeamActorInput[];
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

    // Register the attacker's own buff/debuff abilities for in-loop application with
    // live condition gating (Task 6). These flow from ShipSkills directly — the page
    // no longer feeds the converted SelectedGameBuff arrays into the sim (no-double-count).
    // Classification (spec): accumulating (stackTrigger && isStackable) → accumulating
    // maps, effect inclusion aura-gated; aura (recurring/undefined duration OR passive
    // slot) → per-round effect gate; timed (finite duration) → gated at application.
    // Routing mirrors buffAbilitiesToSelectedBuffs: enemy/all-enemies → enemy side.
    const registeredAbilityStatuses: RegisteredAbilityStatus[] = [];
    // Timed ability statuses indexed by source slot, applied when that slot fires.
    // Narrowed to the timed variant — duration is guaranteed numeric on this type.
    const timedSelfBySlot: Extract<RegisteredAbilityStatus, { kind: 'timed' }>[] = [];
    const timedEnemyBySlot: Extract<RegisteredAbilityStatus, { kind: 'timed' }>[] = [];
    for (const slot of shipSkills.slots) {
        for (const ability of slot.abilities) {
            const cfg = ability.config;
            if (cfg.type !== 'buff' && cfg.type !== 'debuff') continue;
            const side: 'self' | 'enemy' =
                ability.target === 'enemy' || ability.target === 'all-enemies' ? 'enemy' : 'self';
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
            const base = {
                payload,
                side,
                sourceSlot: slot.slot,
                conditions: liveGateConditions(ability.conditions),
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
            registeredAbilityStatuses.push(status);
        }
    }
    statusEngine.registerAbilityStatuses(registeredAbilityStatuses);

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

    // All mutable state declared fresh on every call
    let cumulativeDamage = 0;
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

    // Round-scoped context the enemy's DoT processing reads from the focus actor's turn.
    // Set at the end of every focus-actor turn (see PlayerRoundCtx). Only undefined
    // when the enemy acts before the attacker has EVER acted (faster-enemy round 1).
    let lastAttackerCtx: PlayerRoundCtx | undefined;

    // --- Phase 3 reactive triggers ---
    // Intent queue (FIFO). Reactive listeners enqueue follow-up executions; the engine
    // drains them at the drain points. Pure listeners (enqueue only) keep the Phase 1
    // contract — the executor is the only state mutator.
    const intentQueue: Intent[] = [];
    registerReactiveListeners({
        bus,
        reactiveAbilities,
        enqueue: (intent) => intentQueue.push(intent),
    });

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
                        attacker,
                        enemy,
                        statusEngine,
                        bus,
                        corrosionEntries,
                        infernoEntries,
                        pendingBombs,
                        debuffLandingGate,
                        debuffLandingChance,
                        landsTimedEnemyApplication,
                        enemyType,
                        enemyHp,
                        // Drain-time HP% includes this round's damage SO FAR (the round
                        // accumulators below are folded into cumulativeDamage only at
                        // post-round assembly): a follow-up reacts to the state its trigger
                        // created — e.g. an on-crit follow-up gated on enemy HP% sees the
                        // enemy's HP AFTER the attacker's hit that just crit. This differs
                        // from the attacker turn's own gates, which deliberately use the
                        // entering-round HP (pre-existing convention, unchanged).
                        // Map-sum: only the attacker entry exists today — equivalent to the
                        // old scalar sum (direct + corrosion + inferno + detonation).
                        cumulativeDamage:
                            cumulativeDamage +
                            [...roundDamage.values()].reduce(
                                (s, d) => s + d.direct + d.corrosion + d.inferno + d.detonation,
                                0
                            ),
                        effectiveAttack: lastAttackerCtx?.effectiveAttack,
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

        for (const actor of queue) {
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
                    cumulativeDamage,
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
                // Invariant (today): actor.id === focusActorId — the enemy-turn writes ticks
                // into dmg(focusActorId), so both resolve to the same map entry.
                const d = dmg(actor.id);
                d.direct += turn.directDamage;
                d.secondary += turn.secondaryDamage;
                d.conditional += turn.conditionalDamage;
                d.detonation += turn.detonationDamage;
                focusTurns.push(turn);

                // Hand the enemy's DoT-processing turn the round-scoped context. With a
                // faster enemy this is the PREVIOUS round's context, hence the carried
                // `lastAttackerCtx`; at default speeds the attacker always precedes the enemy.
                lastAttackerCtx = turn.attackerCtx;
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
                // ENEMY TURN — ticks the DoT containers it carries. DoTs tick at the
                // start of the afflicted ship's turn. At default speeds the attacker
                // acted earlier THIS round (apply/detonate done, ctx set), so the enemy
                // ticks with this round's context — same totals as the pre-restructure
                // engine. lastAttackerCtx is undefined only when a faster enemy acts
                // before the attacker's first turn (containers empty — skip).
                // ====================================================================
                if (lastAttackerCtx) {
                    const {
                        effectiveAttack,
                        dotMult,
                        affinityMult,
                        directDamage: ctxDirect,
                    } = lastAttackerCtx;
                    const ticks = tickDoTs({
                        corrosionEntries,
                        infernoEntries,
                        enemyHp,
                        effectiveAttack,
                        dotMult,
                        affinityMult,
                        emitTicked: (dotType, damage) =>
                            bus.emit({
                                type: 'dot-ticked',
                                targetId: enemy.id,
                                round: r,
                                dotType,
                                damage,
                            }),
                    });
                    // Corrosion/inferno ticks are = (assign) into the focus entry — today
                    // there is exactly one enemy turn per round, so assign is correct; the
                    // old scalar locals were = for the same reason. Per-entry sourceId
                    // attribution (when team DoTs land) arrives in a later task.
                    const fd = dmg(focusActorId);
                    fd.corrosion = ticks.corrosionDamage;
                    fd.inferno = ticks.infernoDamage;

                    // Bombs and accumulators are += into detonation: with a FASTER enemy,
                    // the attacker's detonate() portion already ran earlier this round (the
                    // attacker turn fold above used +=). The old scalar was also += here.
                    fd.detonation += processBombs({
                        pendingBombs,
                        affinityMult,
                        emitBombDetonated: (stacks, damage) =>
                            bus.emit({
                                type: 'bomb-detonated',
                                actorId: attacker.id,
                                round: r,
                                stacks,
                                damage,
                            }),
                    });
                    fd.detonation += processAccumulators({
                        pendingAccumulators,
                        directDamage: ctxDirect,
                    });
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
        totalDirectRaw += focus.direct;
        // NOTE: reads the FOCUS entry only — when team actors gain secondary/conditional
        // contributions, the assembly must iterate the full dmgMap or those sub-buckets are silently dropped.
        totalSecondaryRaw += focus.secondary;
        totalConditionalRaw += focus.conditional;
        totalCorrosionRaw += focus.corrosion;
        totalInfernoRaw += focus.inferno;
        totalDetonationRaw += focus.detonation;

        // Track the enemy's remaining HP and emit hp-changed / ship-destroyed taps
        // (emission-only; the sim keeps hitting the dead dummy regardless).
        enemy.currentHp = Math.max(0, enemyHp - cumulativeDamage);
        const newEnemyHpPctInt =
            enemyHp > 0 ? Math.round(Math.max(0, 100 * (1 - cumulativeDamage / enemyHp))) : 100;
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
        },
    };
}
