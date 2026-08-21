import { calculateDamageReduction } from '../autogear/priorityScore';
import { evaluateCondition, scaledBonus, conditionsMet } from '../abilities/evaluateConditions';
import { buildRoundContext, dotFamilyCounts } from '../abilities/roundContext';
import {
    DoTApplicationConfig,
    DoTType,
    EnemyBaseClass,
    SelectedGameBuff,
} from '../../types/calculator';
import { Ability, ShipSkills, Skill } from '../../types/abilities';
import type { AffinityName } from '../../types/ship';
import type { ParsedPattern } from '../targetingParser';
import type { ConditionContext } from '../abilities/evaluateConditions';
import {
    selectFiringSkill,
    damageInputsFromSkill,
    secondaryFromSkill,
    dotsFromSkill,
    chargeAbilitiesFromSkill,
    controlAbilitiesFromSkill,
    detonationsFromSkill,
    accumulatorsFromSkill,
    gateFiringAbilities,
    extraActionsFromSkill,
    partitionDotDamageAbilities,
    type ExtraActionGrant,
} from '../abilities/applyAbilities';
import { toSimBuffs, toEnemyModifiers, toEnemyDotModifier } from '../calculators/dpsBuffHelpers';
import { computeAffinityModifiers } from '../calculators/affinityUtils';
import {
    ActiveDoTStack,
    ActorHealing,
    PendingAccumulator,
    PendingBomb,
    CombatActor,
    advanceChargeCadence,
} from './state';
import {
    ActiveBuff,
    ActiveAbilityStatus,
    RegisteredAbilityStatus,
    createStatusEngine,
} from './statusEngine';
import { CombatEventBus } from './events';
import { detonateContainers, type DetonationRecipe } from './detonation';
import { synthesizeResisted } from './shared';
import {
    buildActorConditionContext,
    selfBuffNamesForOwners,
    LIVE_TRIGGERS,
    type ReactiveAbility,
} from './triggers';
import { reduceBombsOnVictim } from './bombCountdown';
import { recipientCarriesBlockBuff } from './blockBuffBuffs';
import { BARRIER_BUFFS } from './barrierBuffs';
import { BARRIER_RECHARGING, holdsBarrierRecharging } from './barrierRecharging';
import {
    allyHpFraction,
    lowestHpAllyRecipients,
    resolveSupportRecipients,
} from './supportRecipients';
import { resolveDebuffRecipientIds } from './debuffRecipients';
import { supportFootprintAllyIds } from './supportFootprint';
import type { AttackerDamageScalars } from './victimDamage';
import type { PreFightCombatModifiers } from './preFight/types';
import { effectiveDamageStatsOf, liveDebuffLandingChance } from './effectiveStats';
import {
    targetCarriesBlockDebuff,
    emitBlockDebuffResist,
    dotResistLabel,
    controlEffectLabel,
} from './debuffImmunity';
import { outgoingAmplificationForHit } from './outgoingEffects';
import { healAmplificationForCast } from './healAmplification';
import {
    holdsChargedOverdriveII,
    consumeChargedOverdriveII,
    CHARGED_OVERDRIVE_II_PEN,
} from './chargedOverdrive';
// Buff-fold leaf helpers. Imported for in-file use and re-exported to preserve the
// historical public API (engine.ts + tests import these from playerTurn). Keeping the
// definitions in the leaf module breaks the playerTurn ⇄ effectiveStats import cycle.
import {
    calculateBuffTotals,
    expandBuffEntry,
    expandEnemyDebuffs,
    payloadToSelectedBuff,
} from './buffTotals';
export { calculateBuffTotals, expandEnemyDebuffs, payloadToSelectedBuff };

type StatusEngine = ReturnType<typeof createStatusEngine>;

/** A deterministic event gate: maps a probability/rate to a fire/no-fire decision. */
export type RateGate = (rate: number) => boolean;

/** The timed variant of a registered ability status (duration guaranteed numeric). */
export type TimedStatus = Extract<RegisteredAbilityStatus, { kind: 'timed' }>;

// Round-scoped context the enemy's DoT processing needs from the focus player actor's
// turn. At default speeds the player acts first, so the enemy's tick uses THIS round's
// context (identical to the pre-restructure behaviour). For a FASTER enemy it is the
// PREVIOUS round's context; only in that case is round 1 undefined (the enemy acts
// before any player turn — containers necessarily empty, processing skipped).
export interface PlayerRoundCtx {
    effectiveAttack: number;
    dotMult: number;
    affinityMult: number;
    /** Healing-calc seams (additive): the actor's current effective defence/max-HP, and its
     *  outgoing/incoming-heal % as of its last turn — read by enemy attacks (target defence),
     *  'target-hp' heals, outgoing-heal scaling, and incoming-heal amplification (corrosion
     *  applier-ctx rule). */
    effectiveDefence: number;
    effectiveMaxHp: number;
    outgoingHealPct: number;
    incomingHealPct: number;
    /** Sub-project I, PR I4b/I4c — `dotDamage`-channel modifier abilities whose GATE is a
     *  name-specific enemy-status condition (Wildfire's "when an enemy has Scorching
     *  Radiation… for every N% crit power" bonus), plus the ctx used to fold each group
     *  (`partitionDotDamageAbilities` — see its jsdoc for the shape check). EXCLUDED from
     *  `dotMult` above, which bakes only the UNCONDITIONAL dotDamage contribution (e.g.
     *  Decimation set gear). The engine re-folds each entry's `abilities` against a
     *  per-VICTIM, per-TICK ctx (only the enemy-status fields swapped to that victim's own
     *  CURRENT live status — see `tickDoTs`/`victimDotMult` in engine.ts) so the bonus
     *  applies to a tick only while the ticking victim currently carries the required
     *  status. A LIST (not a single entry) because I4c's refit-3 "all allies deal…" team
     *  aura contributes ADDITIONAL entries — one per ally aura SOURCE, each carrying that
     *  SOURCE's own `selfCritPower` (the locked rule: the bonus scales by the aura
     *  SOURCE's crit power, never the recipient's) — alongside this actor's own entry (if
     *  any), which keeps using this actor's own ctx unchanged from I4b. Undefined/empty →
     *  tick math is `dotMult` alone, byte-identical for every non-Wildfire-shaped ship (and
     *  for the DPS simulator, which never reads this field). */
    victimGatedDotDamage?: { abilities: Ability[]; ctx: ConditionContext }[];
}

/** Healing-mode context threaded into player turns (and later the executor). The ENGINE
 *  owns all mutation (applyHealToTarget/grantShieldToTarget close over the live target). */
export interface HealingRuntimeCtx {
    targetId: string;
    credit: (actorId: string, bucket: keyof ActorHealing, amount: number) => void;
    /** Credit a bucket against the RECIPIENT the repair landed on (the `perRecipient` axis).
     *  ⚠️ Call ONLY under `perRecipientApply` and ONLY where the pool application actually
     *  succeeded — see `HealingRoundEngine.perRecipient` for the full contract. */
    creditRecipient?: (recipientId: string, bucket: keyof ActorHealing, amount: number) => void;
    /** Recipient stats via lastTurnCtxByActor with base-stat fallback (pre-first-turn). */
    recipientMaxHp: (actorId: string) => number;
    recipientIncomingHealPct: (actorId: string) => number;
    /** D-PR6: summed incoming-heal amplification % for a repair landing on `rid` (Exuberance). Rolls the
     *  recipient's incoming-heal-amp procs ONCE (combat-lifetime gate keyed rid+ability). Absent → callers
     *  use 0 → byte-identical. */
    recipientIncomingHealAmpPct?: (rid: string) => number;
    /** A FOREIGN HoT applier's effective max HP at tick time (Task 7): reads
     *  lastTurnCtxByActor ONLY — NO base-stat fallback (the strict corrosion applier-ctx
     *  rule). Returns undefined when the applier has not acted this run yet, in which case
     *  the holder SKIPS the tick entirely. (The acting holder's self-granted HoTs use the
     *  local effectiveHp directly, never this accessor.) */
    applierMaxHp: (actorId: string) => number | undefined;
    /** Target-routed heal: consumed = min(raw, maxHp − currentHp); dead target → all overheal.
     *  Mutates the victim's currentHp. Returns the split. `victim` defaults to the heal target
     *  (E2 T1: optional per-victim override for positional AoE leech). */
    applyHealToTarget: (
        raw: number,
        victim?: CombatActor
    ) => { consumed: number; overheal: number };
    /** Additive pool capped at the victim's max HP; drains before HP (enemy attacks, Task 8).
     *  Dead victim → no-op (returns 0). `victim` defaults to the heal target (E2 T1: optional
     *  per-victim override for positional AoE leech). Returns the REAL pool growth (post-cap
     *  delta) so the caller can build a shield-applied event (H3.6). */
    grantShieldToTarget: (raw: number, victim?: CombatActor) => number;
    /** Fixed player-id order for all-allies recipient routing. */
    playerIds: string[];
    /** Fixed enemy-attacker-id order for an ENEMY caster's all-allies routing (E5). */
    enemyIds: string[];
    /** Resolve a recipient id to its CombatActor (E5 enemy-heal apply). undefined if absent. */
    recipientActor: (id: string) => CombatActor | undefined;
    /** Apply each heal to the recipient's OWN actor (and capture its own overheal) rather than
     *  accounting the whole heal against `targetId`. This is the APPLICATION axis only — recipient
     *  CHOICE is decided by the ability's target (see `recipientsFor`), never by the run mode.
     *  SP-4e retired the sibling `teamBattle` routing flag, which conflated the two. */
    perRecipientApply?: boolean;
}

/**
 * One enemy-debuff landing this cast decided but has not yet written, split so the ENGINE can run
 * its two halves at different moments (multi-hit full-walk epic, PR8).
 *
 * `applyState` performs the `applyTimedAbilityStatus` write plus the display-list refresh;
 * `emitEvents` emits the paired discrete `debuff-applied`. They are separate because a multi-hit
 * cast needs the STATE in the store at its sub-attack's boundary — so the next sub-attack's
 * `defenseProfileOf` read sees it — while the EVENT must wait for that sub-attack's
 * `ability-performed` row to exist, or `buildCombatLog`'s `openAttackEntry` misattributes it.
 * `flushDeferredEnemyApplications` runs them back-to-back, which is what keeps a single-sub-attack
 * cast byte-identical to the pre-PR8 single thunk.
 */
export interface DeferredEnemyApplication {
    applyState: () => void;
    emitEvents: () => void;
}

/**
 * The PASSIVE-SLOT damage instance of one cast (SP-4b-2 D6).
 *
 * A SEPARATE damage instance, not an addend on the firing hit: the always-active passive slot can
 * carry its own gated `damage` ability with its own multiplier, its own crit rule (`noCrit`) and
 * its own `target`. `runPlayerTurn` decides all three; the positional apply site only LANDS it.
 *
 * TARGETING is the ability's own, deliberately NOT the firing hit's footprint — see
 * `passiveSlotPattern` / `stagePassiveSlotHit` in engine.ts for the full justification and the
 * mapping from `target` to a footprint.
 */
export interface PassiveSlotHit {
    /**
     * Attacker-side scalars for THIS instance alone. `multiplierPct` is the passive's own gated
     * multiplier (its hit count already folded in by `passiveMultiplier`), `hits` is 1 (the
     * instance is one hit, however many hits the FIRING skill has) and `secondaryStatValue` is 0
     * (the defence/HP-scaling payload belongs to the firing hit and is already counted there).
     * Every other term is the firing cast's, because they are attacker-fixed for the whole turn —
     * the same terms `nonCritFactor` folds into the aggregate `passiveDamage`.
     */
    scalars: AttackerDamageScalars;
    /**
     * ALREADY DECIDED here — the apply site must never re-roll or re-decide it. `noCrit` on the
     * passive's own damage ability forces `false`; otherwise this REUSES the round's first crit
     * draw rather than taking a new one, so no CRIT draw is added.
     *
     * That is a statement about crit ALONE — it is NOT a claim that the instance is RNG-free.
     * It is a real damage instance and goes through the real victim funnel
     * (`tb.applyToVictim` → `applyOutgoingToEnemy`, `byDirectDamage: true`), so against a victim
     * carrying an `incoming-block` ability it advances that victim's `directIntakeIndex` and rolls
     * a `makeRateGate` draw on the victim's own `<id>:proc` sub-stream. See the
     * `stagePassiveSlotHit` doc in engine.ts for the full footprint of what it does draw and
     * provoke, and `passiveSlotDamageFootprint.integration.test.ts` for the pins.
     */
    didCrit: boolean;
    /**
     * The passive damage ability's OWN declared target ('all-enemies' for Judge/Incinerator,
     * 'enemy' for most). The firing skill's target/pattern are NOT used — see engine.ts.
     */
    target: Ability['target'];
}

/** Everything one player actor's turn contributes to the round's RoundData row. */
export interface PlayerTurnResult {
    action: 'active' | 'charged';
    roundCrit: boolean;
    dotsConfig: DoTApplicationConfig;
    dotsLanded: boolean;
    activeSelfBuffs: ActiveBuff[];
    landedEnemyDebuffs: ActiveBuff[];
    /** Debuffs THIS actor discretely inflicted on the target THIS turn (source-accurate, unlike
     *  the shared-per-target landedEnemyDebuffs window). Used by the healing enemy-effects
     *  overview to attribute each debuff to the enemy that applied it (Task 10a). */
    inflictedEnemyDebuffs: ActiveBuff[];
    resistedEnemyDebuffs: ActiveBuff[];
    /**
     * Enemy-debuff landings this cast decided but held back, because their clause follows a damage
     * clause in the same firing slot (user-confirmed game rule: "deals X% damage and inflicts
     * Defense Down" resolves the damage first). Each pair's `applyState` performs the deferred
     * `applyTimedAbilityStatus` write; `emitEvents` emits its discrete `debuff-applied`. The
     * landing roll already happened.
     *
     * The ENGINE must flush these once this turn's damage has landed (`flushDeferredEnemyApplications`),
     * before the actor's Post-Turn decrement so the status still runs its normal window. Empty for
     * every cast whose debuff clauses all precede its damage — i.e. for almost the whole corpus,
     * which keeps those byte-identical.
     *
     * PR8 split the element from a bare `() => void` thunk into `{applyState, emitEvents}` so the
     * engine can run the two halves at different moments at a multi-hit cast's sub-attack boundary.
     */
    deferredEnemyApplications: DeferredEnemyApplication[];
    /**
     * Rolls and applies this cast's direct enemy-debuff clauses for ONE sub-attack ≥ 1
     * (multi-hit full-walk epic, PR8). Present only on a positional cast that has at least one
     * condition-gated direct debuff clause; `undefined` everywhere else, which is what keeps DPS
     * mode, healing mode and every non-positional path on the single-flush behaviour they have
     * today.
     *
     * Sub-attack 0 is NOT served by this — it keeps its cast-time draw, because three consumers
     * read that outcome before the positional loop runs: `resistedTimedEnemyNames` (gates this
     * turn's `control-applied` emission, inside this function), `resistedEnemyDebuffs` (the round
     * display list), and `inflictedEnemyDebuffs` (the engine's `reInflictedStasis` check, which
     * runs immediately after this function returns). Keeping the k=0 draw where it is also keeps
     * the `${ownerId}:landing` RNG stream's draw order untouched for a single-hit cast.
     *
     * `phase` selects clause order WITHIN the sub-attack: `'before-damage'` for clauses written
     * ahead of the damage clause (applied at the sub-attack's start), `'after-damage'` for those
     * written after it (applied at its end). The locked intra-cast rule therefore holds per
     * sub-attack rather than per cast.
     *
     * Returns the landings' {@link DeferredEnemyApplication} pairs with `applyState` ALREADY RUN —
     * the caller only has to emit. The roll is fresh per call, against the anchor and footprint
     * that sub-attack actually resolved, so overkill retargeting is correct without extra work.
     */
    applyDebuffsForSubAttack?: (
        sub: { index: number; anchorId: string; victimIds: string[] },
        phase: 'before-damage' | 'after-damage'
    ) => DeferredEnemyApplication[];
    /** Present ONLY when this cast deferred its heal/shield/cleanse pass because it carries a
     *  firing-slot `damage-dealt` rider, whose basis is the damage the cast DELIVERED and so is
     *  unknowable until the engine's per-victim funnel has run.
     *
     *  The engine MUST call this after the funnel, with the cast's delivered total (the sum of its
     *  sub-attacks' `deliveredDamage`). It is not optional cleanup: while it is pending, none of
     *  the cast's repairs, shields or cleanses have happened and none of their events have been
     *  emitted. It is set under exactly the same condition that defers `ability-performed` to the
     *  engine, so any site that emits the one must invoke the other. */
    resolveCastSupport?: (deliveredTotal: number) => void;
    directDamage: number;
    secondaryDamage: number;
    conditionalDamage: number;
    detonationDamage: number; // the player-turn detonate() portion
    /** Per-hit crit outcomes of THIS turn's fired damage ability, in hit order
     *  (length = the ability's hit count; [] when the cast had no damage ability,
     *  or when it is noCrit — the hit loop doesn't run for noCrit abilities).
     *  Same draws that feed critHits/roundCrit — collected, not re-drawn. */
    hitCrits: boolean[];
    /** Extra-action grants this turn fired (pre-gated). The ENGINE owns queue
     *  re-insertion + the oncePerRound/backstop bookkeeping. */
    extraActionGrants: ExtraActionGrant[];
    /** Per-cast attacker-side damage scalars for the positional apply path (Task 7).
     *  Populated from the SAME locals that feed the aggregate `directDamage`, so feeding
     *  these + `hitCrits` through `victimHitDamage` for the bound victim's defense profile
     *  reproduces the FIRING HIT exactly (Task-4 parity). Read ONLY by the positional engine
     *  branch; non-positional callers ignore it → goldens byte-identical.
     *  Present whenever a damage ability fired this cast (else undefined).
     *
     *  FIRING HIT ≠ `directDamage` (SP-4b-2 D6 — the gap this doc used to paper over). The
     *  aggregate `directDamage` is `firing hit + passiveDamage`; `multiplierPct` here is the
     *  FIRING skill's multiplier only, deliberately excluding the passive slot's. So a positional
     *  cast that re-derives its round damage from this payload alone LOSES the passive-slot
     *  instance — which is exactly what happened until `passiveSlotHit` below started carrying it.
     *  Anything else `directDamage` folds in but this does not must be handed over the same way. */
    positionalScalars?: AttackerDamageScalars;
    /** SP-4b-2 D6 — the PASSIVE-SLOT damage instance, for the positional apply path to land
     *  itself (Judge: "At the start of the round, this Unit deals 60% damage to all enemies
     *  with less than 50% HP").
     *
     *  WHY IT HAS TO BE HANDED OVER. `passiveDamage` is folded into the aggregate
     *  `directDamage` below, which is the whole story on a NON-positional cast: the single sink
     *  takes `directDamage` and the passive lands with it. On a POSITIONAL cast the engine
     *  suppresses that scalar credit and re-derives the round's direct damage from the
     *  per-victim apply — whose payload is `positionalScalars`, the FIRING skill's scalars only.
     *  The passive instance was therefore computed and dropped (measured: Judge's round-4
     *  `directDamage` stuck at 23000 instead of 29000). Present only when the passive slot's
     *  GATED damage ability contributes damage this round; absent otherwise, so the engine's
     *  wiring is a no-op for every cast without one. */
    passiveSlotHit?: PassiveSlotHit;
    /** Sub-project I, PR I2 (Layer 3) — ingredients for the engine's per-victim outgoing-
     *  modifier delta (Tygr/Incinerator/Lodolite-shape "+N% to enemies with <named status>"
     *  gates). `primaryCtx` is the SAME `modifierCtx` folded into `positionalScalars.
     *  outgoingDamageBuffPct` above (built against the primary/bound target's enemy-status);
     *  `modifierAbilities` is the same list folded into `dmgStats`. The engine rebuilds a
     *  per-victim ConditionContext (enemy-status fields only) from `primaryCtx`, re-folds
     *  `modifierAbilities` against it, and subtracts the primary-ctx fold to isolate the
     *  per-victim enemy-status delta (non-enemy-status modifiers cancel identically in both
     *  folds). Present ONLY when a damage ability fired this cast (mirrors positionalScalars).
     *  Absent → the engine skips the per-victim fold (byte-identical to I1's single-ctx
     *  behavior); read ONLY by the positional engine branch. */
    perVictimOutgoing?: { modifierAbilities: Ability[]; primaryCtx: ConditionContext };
    /** SP-4b-2 D4 — this turn's SCHEDULED enemy-debuff effects AFTER the per-round landing
     *  decision, i.e. exactly the entries that LANDED (`scheduledEnemy.roundEnemyDebuffs`:
     *  recurring/always/accumulating re-rolled through `roundDebuffLanded()` / the affinity
     *  gate for `application:'apply'`, plus timed scheduled entries which were gated once at
     *  application). It is the SAME expansion of the SAME `snapshot(_, DEFAULT_ENEMY_TARGET)
     *  .activeEnemyDebuffs` list that `victimEnemyBuffs` re-reads raw — minus the resisted
     *  entries.
     *
     *  It exists because the landing/resist DRAW is memoized per turn and must not be taken
     *  twice: a second draw would consume RNG and let the reporting channel
     *  (`RoundData.activeEnemyDebuffs`) and the positional DAMAGE channel disagree about the
     *  very same debuff. The engine's `victimIncomingModifiers` therefore consumes THIS list
     *  for the scheduled channel instead of re-reading the ungated bucket. Present on every
     *  turn; the ability channel is per-victim and stays with `victimEnemyBuffs`. */
    scheduledEnemyEffects: SelectedGameBuff[];
    /** Per-victim crit resolver for the positional AoE apply path (per-victim crit).
     *  Rolls THIS attacker's crit gate at the given victim's affinity-capped rate, so a
     *  covered victim the attacker is at an affinity disadvantage against crits less often
     *  than the anchor. Uses the SAME `critGate` closure as the anchor's per-hit draws, so
     *  covered-victim draws continue the same RNG stream AFTER the anchor's per-hit draws.
     *  Read ONLY by the positional engine branch; non-positional callers ignore it. */
    rollVictimCrit: (victimAffinity: AffinityName) => boolean;
    /** Per-cast detonation recipe for the positional per-victim path. Present ONLY when the
     *  `positional` arg was set (the engine then detonates each footprint victim's own containers
     *  via detonateContainers). Absent for non-positional callers → byte-identical. */
    positionalDetonation?: DetonationRecipe;
    /** Deferred `ability-performed` payload (Task 5). Present ONLY when `deferAbilityPerformedToEngine`
     *  was set AND a damage ability fired this cast — in that case runPlayerTurn does NOT emit the
     *  aggregate `ability-performed` and the ENGINE emits it after its positional per-victim apply,
     *  overriding `didCrit`/`critHits` with the true per-victim aggregate (anyCrit / critPairs). The
     *  ANCHOR-based `didCrit`/`critHits` carried here are a defensive fallback only (if the engine
     *  somehow does not run positional apply). Absent → runPlayerTurn already emitted inline. */
    deferredAbilityPerformed?: {
        actorId: string;
        targetId: string;
        round: number;
        damage: number;
        didCrit: boolean;
        critHits: number;
    };
    turnCtx: PlayerRoundCtx; // round-scoped context for the enemy's DoT tick (this actor)
}

/** Everything one player actor's turns need. Built once at engine setup — the
 *  attacker's runtime comes from the top-level inputs; walked team runtimes (Task 4)
 *  from TeamActorInput. The engine core keys on runtime/actor ids, never 'attacker'. */
export interface PlayerActorRuntime {
    actor: CombatActor;
    /** actor.id === focusActorId — this runtime's turns feed the RoundData row. */
    focus: boolean;
    castSkills: ShipSkills; // reactive-partitioned (engine setup)
    reactiveAbilities: ReactiveAbility[];
    timedSelfBySlot: TimedStatus[];
    timedEnemyBySlot: TimedStatus[];
    hasChargedSkill: boolean;
    // Base stats
    attack: number;
    crit: number;
    critDamage: number;
    defensePenetration: number;
    defence: number;
    hp: number;
    /** Caster heal-modifier stat (healing calc). Default 0. */
    healModifier: number;
    // Per-actor adapter-derived rates
    /** LIVE debuff-landing chance (0..1) for THIS actor against ITS OWN TURN TARGET, set at turn
     *  start by runPlayerTurn from current effective hacking-vs-that-target's-security + affinity
     *  (A2 Task 4). Undefined until the actor's first turn — callers use `?? 1` as a neutral default.
     *
     *  ⚠️ SP-4c-2b: this is a CAST-path value and the REACTIVE path must not use it as a standing
     *  per-owner rate. It is a number derived from THIS turn's target being read against a DIFFERENT
     *  target later, which was wrong in kind and became wrong in effect once an ally-targeted cast
     *  started resolving no victim at all (it then published 0 and silenced the owner's reactive
     *  inflicts entirely — Flamel's on-damaged Stasis). The reactive path now resolves its own
     *  per-victim chance through `TriggerDrainContext.liveDebuffLandingChanceFor` and passes it in as
     *  `targetLandingChance`; this field survives only as the fallback for a caller with no REAL
     *  victim in hand.
     *
     *  WHO ACTUALLY READS IT, measured over the whole suite rather than assumed — an earlier draft of
     *  this doc guessed wrong in both directions. NONE of the three cast-path closures reads it
     *  (`runPlayerTurn` replaces the status engine's landing hook every turn with its own live
     *  closure, which computes from `enemy` directly). The live readers are the reactive fallbacks,
     *  reached when `liveDebuffLandingChanceFor` declines to price a victim: an id absent from
     *  `allActorsById`. Until SP-4c-2d there was a SECOND such case, and it was the load-bearing
     *  one: an explicit refusal to price the DUMMY SENTINEL, which WAS in the map (pricing an
     *  inflict aimed at nobody against a ghost's default security of 100 would never land — a
     *  stronger lie than this field ever told). The actor is deleted, so the sentinel is not in the
     *  map at all and the absent-id arm covers it; the RULE it encoded stands.
     *  Measured before that deletion: 3 such rows in the suite, 0 on shipped kits.
     *
     *  ONLY EVER WRITTEN FROM A TURN THAT HAD A VICTIM (see the guard at the write site). A no-victim
     *  turn deliberately publishes nothing, so this field can never hold the 0 that caused the
     *  original Flamel defect. */
    liveDebuffLandingChance?: number;
    selfDotModifier: number;
    defensePenetrationBuff: number;
    affinityDamageModifier: number;
    affinityCritCap: number;
    affinityCritPenalty: number;
    affinityDisadvantage: boolean;
    /** Raw attacker affinity (Task 7). The numeric modifiers above are PRE-RESOLVED
     *  (computeAffinityModifiers) against the bound enemy and cannot be inverted, so the
     *  positional apply path — which re-resolves per VICTIM — needs the raw affinity here.
     *  Optional: absent → `'antimatter'` (neutral vs anything, modifier 0), matching the
     *  default neutral matchup; surfaced only on positionalScalars. */
    attackerAffinity?: AffinityName;
    allyChargePerRound?: number; // attacker-only manual input
    // Per-actor deterministic gates. Isolation across actors now comes from the `${actorId}:
    // ${purpose}` stream key threaded into `makeRateGate` (SP-0 Task 3) under the keyed test
    // provider — NOT from these being separate closure instances (every gate still shares the
    // same fallback `rng()` when no key/provider is present, e.g. production).
    activeCritGate: RateGate;
    chargedCritGate: RateGate;
    debuffLandingGate: RateGate;
    extendChanceGate: RateGate;
    /** Heal crit gates (healing calc): SEPARATE from the damage crit gates so drawing a
     *  heal crit never shifts a heal-carrying ship's damage-crit schedule. */
    activeHealCritGate: RateGate;
    chargedHealCritGate: RateGate;
    landsTimedEnemyApplication: (
        application?: 'inflict' | 'apply',
        targetAffinity?: AffinityName,
        targetLandingChance?: number
    ) => boolean;
    // Lookups: attacker carries the global merged lookups; team runtimes get empty maps
    selfBuffLookup: Map<string, SelectedGameBuff[]>;
    enemyDebuffLookup: Map<string, SelectedGameBuff[]>;
}

/** Everything one player actor's turn closes over. The per-actor configuration/gates/
 *  stats live on `runtime`; the rest are round-shared engine state (status engine,
 *  enemy actor + its DoT containers, the bus, and the per-call round number /
 *  cumulative damage). chargeCount/startCharged are NOT here — they live on
 *  `runtime.actor` (CombatActor carries chargeCount + seeded charges). */
export interface PlayerTurnArgs {
    runtime: PlayerActorRuntime;
    /** SP-4c-2b: ABSENT means there is no victim this turn — an ally-targeted cast resolved nobody
     *  on the opposing side. Before this rung the engine passed the dummy `enemy` ghost here, whose
     *  `shieldPool`/`currentHp`/`stats` were then read as if they described a real opponent (plan
     *  §A.4-A.5). Absent is NOT "a neutral enemy": every read below answers "there is no enemy". */
    enemy?: CombatActor;
    statusEngine: StatusEngine;
    // DoT containers (live on the enemy actor; passed through for clarity). SP-4c-2b: absent on a
    // no-victim turn — a DoT applied to nobody lands nowhere.
    corrosionEntries?: ActiveDoTStack[];
    infernoEntries?: ActiveDoTStack[];
    /** SP-E: generic (absolute per-tick) DoT entries. */
    genericDoTEntries?: ActiveDoTStack[];
    pendingBombs?: PendingBomb[];
    pendingAccumulators?: PendingAccumulator[];
    /** SP-4c-2b: absent on a no-victim turn (no victim ⇒ no defence to pierce). */
    enemyDefense?: number;
    /** SP-4c-2b: absent on a no-victim turn. SP-4d: the `enemyHpPct` derivation below now answers
     *  `undefined` rather than 100 when this is absent — the honest "no reading" answer, not the
     *  ghost's fabricated one. */
    enemyHp?: number;
    enemyType?: EnemyBaseClass;
    // Required (Phase 3): the engine always passes its internal bus (wrapping the optional
    // external tap), so the player turn emits unconditionally.
    bus: CombatEventBus;
    // Per-call round state.
    round: number;
    /** Grant `amount` charges to EVERY player actor (Task 5 ally-charge routing). Supplied by
     *  the engine, which loops all player actors (incl. this caster) bumping
     *  min(charges + amount, chargeCount) and skipping chargeCount 0 (no charge skill → no
     *  banking). Called from the CASTER's active-round charge step (mirrors own gains). Optional
     *  so statusEngine/standalone callers without a team need not supply it — when absent the
     *  caster's own gains still apply (a self-only run never has ally-targeted charge abilities).
     *  The optional `emitBus` overrides the captured outer bus for the `charge-changed` emission;
     *  the on-turn (cast-path) caller never supplies it, so on-turn charge changes stay unstamped. */
    grantAllyCharges?: (
        amount: number,
        opts?: { recipientIds?: string[]; emitBus?: CombatEventBus }
    ) => void;
    /** Remove `amount` charges from every OPPOSING-side actor (Task 7 enemy-target charge
     *  removal). Supplied by the engine, which loops the opposing side flooring each actor at 0
     *  and skipping chargeLossImmune / chargeCount-0 actors. Called from the caster's active/charged
     *  charge step for enemy/all-enemies-targeted charge abilities. Optional so standalone callers
     *  without an opposing roster need not supply it — when absent enemy-target removal is a no-op
     *  (a self-only run never has enemy-targeted charge abilities). The optional `applierAffinity`
     *  enforces the Charge Manipulation affinity gate (skip targets with affinity advantage over
     *  the applier); omit it to disable the gate. The optional `emitBus` is unused on the on-turn
     *  cast path (charge changes here are NOT reactions) — it exists only for signature parity. */
    removeEnemyCharges?: (
        amount: number,
        applierAffinity?: AffinityName,
        emitBus?: CombatEventBus
    ) => void;
    /** Healing mode (healing calc): present ONLY when the engine runs in healing mode.
     *  Absent for DPS-mode turns — the heal block is fully gated on this, keeping the DPS
     *  goldens byte-identical. */
    healing?: HealingRuntimeCtx;
    /** Event-only heal/cleanse emission (Phase 4c PR 4 Task 5; HP-restore lifted in E5 §4.1):
     *  when true (the enemy walk), the heal block EMITS `heal-performed`/`cleanse-performed`
     *  carrying THIS actor's id and (E5) restores each heal recipient's OWN currentHp via the
     *  per-victim pool — but credits NO player healing bucket and never mutates the player
     *  heal-target (the shared player `healing` ctx never sees an enemy-id BUCKET credit).
     *  Shields/cleanse still mutate nothing on this path. Scopes emission to the CAST skill
     *  (gatedSkill) only, never the passive. Defaults falsy (player/team turns credit + mutate
     *  as before). */
    healEventOnly?: boolean;
    /** Acting actor's live HP% (0..100) for self-HP-threshold gates. Defaults to 100 so
     *  callers that do not supply it (e.g. standalone tests, un-updated call sites) behave
     *  as if the actor is at full HP — gate never fires → byte-identical to prior behaviour. */
    selfHpPct?: number;
    /** Heal target's live HP% (0..100) at THIS acting actor's turn start (pre-this-cast-heal),
     *  for `hpSubject:'target'` condition gates — Hermes' "grants Cheat Death to an ally below
     *  40% HP" evaluated at cast time. Defaults to 100 so DPS-mode / un-updated callers behave
     *  as if the target is full HP → a "below N" gate fails → grant inert in DPS (correct).
     *  Threaded into the round contexts (postDebuffGateCtx gates the per-slot timed application). */
    targetHpPct?: number;
    /** The acting attacker's STRUCK target was repaired (HP-healed) this round (C2b-3). Default
     *  false. Threaded into the round contexts to gate target-repaired-this-round conditions. */
    targetRepairedThisRound?: boolean;
    /** Enemy-side debuff target key (Task 6). Passed as the `enemyTargetId` arg to the three
     *  enemy-side statusEngine calls (applyTimedAbilityStatus / timedAbilityStatuses /
     *  activeAbilityStatuses). When UNDEFINED the statusEngine resolves to DEFAULT_ENEMY_TARGET
     *  (pre-Task-6 path, byte-identical). The real tank id is supplied only by the enemy-dispatch
     *  branch (Task 6b); all player-side call sites in engine.ts leave this unset. */
    targetId?: string;
    /** Active buff names on the OPPOSING side (Task 7) for this actor's `enemy-buff` condition
     *  gates. For a player actor this is the UNION of the enemy attacker(s)' self-buff names;
     *  for the enemy-dispatch walk it is symmetric (the player team's buffs). NAMES ONLY — these
     *  feed condition gates, never effect folding (no double-fold). Defaults to [] (DPS-assumption,
     *  byte-identical). Sourced by the engine via triggers.selfBuffNamesForOwners. */
    enemyBuffNames?: string[];
    /** Sub-project I, PR I5 — count (not union) of living opposing actors currently holding
     *  the Stealth self-buff, for this actor's `enemy-stealth-count` scaling condition
     *  (Selenite's "10% more direct damage for every enemy with Stealth"). Same per-turn
     *  cadence/sourcing as `enemyBuffNames` above (triggers.countOwnersWithSelfBuff). Defaults
     *  to 0 for any caller that does not supply it — byte-identical there. The old rationale
     *  ("no enemy attackers to count" in DPS mode) is stale: every DPS run has carried a real
     *  enemy since SP-4b-2a and, since SP-4b-2b, `normalizeCombatRoster` throws on a roster-less
     *  input. The 0 holds because the synthesized DPS stand-in carries no Stealth — nobody to
     *  count STEALTHED, not nobody to count. */
    stealthedEnemyCount?: number;
    /** Sub-project I, PR I1 — NAMES on the opposing (primary) target for this actor's
     *  name-specific `enemy-debuff` condition gates (Tygr's "to enemies with Stasis or
     *  Disable", Incinerator's "to enemies afflicted with Inferno"). SENTINEL: `undefined`
     *  (the default — simply omit this key) means the caller has NOT opted in, so the round
     *  contexts fall back to the legacy name-agnostic `enemyDebuffCount` path — this is the
     *  DPS-parity invariant; the DPS simulator never supplies this. Only the live combat
     *  engine's real/positional target resolution opts in (engine.ts `buildTurnArgs`, gated
     *  by the same targetId guard immediately below). */
    enemyDebuffNames?: string[];
    /** Active debuff names on THIS actor (Task 7) for its `self-debuff` condition gates. For a
     *  player heal target these are the enemy-applied debuffs in its per-target store (keyed by
     *  its own id). NAMES ONLY — never folded. Defaults to [] (DPS-assumption, byte-identical).
     *  Sourced by the engine via triggers.ownerDebuffNamesFor. */
    selfDebuffNames?: string[];
    /** §4.5 Stasis direct-damage break hook (B3 Task 2). When supplied, fires AFTER scheduled
     *  debuffs are applied (sourceFired) but BEFORE the ability timed-debuff loop, so the break
     *  correctly precedes any Stasis re-application from the same attack's debuff abilities.
     *  Receives the resolved enemy target id (`targetId`). The engine supplies this for DIRECT-
     *  channel apply boundaries (non-positional and positional via emitHit override); absent for
     *  DPS/standalone callers → inert (byte-identical). */
    onHitBreakStasis?: (targetId: string) => void;
    /**
     * E3 (AoE purge): the firing skill's footprint victim ids, supplied by the engine in
     * positional mode. The on-cast purge fans an 'all-enemies' purge over these instead of the
     * single `targetId`. Absent for non-positional callers → single-anchor (byte-identical).
     */
    aoeVictimIds?: string[];
    /** SP2b: living opposing actors keyed by id — per-victim debuff landing/application in
     *  positional mode. Supplied from the side's opposing roster. Absent → anchor-only path. */
    opposingVictimById?: Map<string, CombatActor>;
    /** Positional mode (per-victim detonation): when true, runPlayerTurn does NOT detonate the
     *  anchor enemy's containers (no consume, no credit, no bomb-detonated emit) and instead
     *  returns a `positionalDetonation` recipe for the engine to apply per footprint victim.
     *  detonationDamage is 0 in this mode. Absent/false → legacy anchor detonation (byte-identical). */
    positional?: boolean;
    /** D-PR3: victim-side incoming %-reduction against the bound target.
     *  nonCrit = applies to ALL hits (Voidshade/Nebula); critFamily = take-max crit-family reduction
     *  applied to the crit fraction only (Iridium/Hardened/Hyperion). Both default 0 → byte-identical. */
    incomingReductionNonCritPct?: number;
    incomingReductionCritFamilyPct?: number;
    /** D-PR4: the bound target's live effective attack (for Giant Slayer's higher-attack gate).
     *  Absent → targetHigherAttack false → Giant Slayer inert. */
    targetEffectiveAttack?: number;
    /** D-PR4: engine-supplied deterministic proc gate for outgoing-amplification procs, keyed by
     *  ability id under this actor. Absent → no amplification rolled (byte-identical). */
    rollOutgoingProc?: (abilityId: string, chance: number) => boolean;
    /** Per-victim crit signal (Task 5). When true AND a damage ability fires this cast, runPlayerTurn
     *  does NOT emit the aggregate `ability-performed` event itself — instead it returns
     *  `deferredAbilityPerformed` for the engine to emit AFTER its positional per-victim apply, with
     *  the true per-victim crit signal (didCrit = anyCrit OR, critHits = critPairs). The engine sets
     *  this ONLY on the positional-apply branch (its `positional` gate is `... && positionalScalars
     *  != null`, i.e. exactly `hasDamageAbility` — so the suppression condition here matches EXACTLY
     *  which turns the engine will resolve positionally). Absent/false, OR set on a cast with no
     *  damage ability → runPlayerTurn emits inline instead. NOT "as before": since PR5 of the
     *  multi-hit full-walk epic that inline emit is itself ONE event per SUB-ATTACK, each carrying
     *  `directDamage / N` and its own `subAttackIndex` — the SAME cardinality the engine's deferred
     *  path has emitted since PR2, not the pre-PR5 single aggregate. Only at hits === 1 (every
     *  corpus ship but Enforcer) is it one event carrying the undivided damage, i.e. byte-identical.
     *  See the block comment at the emit loop for the cardinality/damage-split derivation. */
    deferAbilityPerformedToEngine?: boolean;
    /** Active-skill parsed pattern (support footprint for on-cast grants/heals/shields/buffs). */
    activePattern?: ParsedPattern;
    /** Charged-skill parsed pattern when it differs from active; falls back to activePattern. */
    chargedPattern?: ParsedPattern;
    /** Living same-side roster for support footprint resolution (positional mode). */
    sameSideLiving?: CombatActor[];
    /** Pre-fight combat-modifier baseline for THIS acting actor (sub-project F, PR F3).
     *  outgoingDamage/outgoingHeal/incomingHeal fold additively into the scheduled self-buff
     *  totals right after resolveSelfBuffTotals, flowing through effectiveDamageStatsOf into
     *  every existing damage/heal consumer (incl. turnCtx + positionalScalars). NOTE:
     *  outgoingCritDamage is NOT folded here — "outgoing crit damage" is a crit-conditional
     *  DAMAGE modifier (not the Crit Power stat), consumed at the engine's crit-family
     *  damage sites. Absent → byte-identical. */
    preFight?: PreFightCombatModifiers;
    /** I6: the opposing actor with the most buffs (Rhodium's §C2b-2 `mostBuffsAmong`), resolved
     *  fresh per turn from THIS actor's opposing roster. Feeds an ON-CAST purge ability whose
     *  `target` is `'enemy-most-buffs'` (Lodolite's charged skill) — the reactive counterpart
     *  (end-of-round/on-attacked triggers, e.g. Rhodium) resolves this itself via
     *  triggers.ts's `ctx.enemyWithMostBuffs`, which this on-cast path never reaches. Undefined
     *  when no living opposing actor carries a buff, or for non-positional/DPS callers that never
     *  supply it — the purge loop then falls back to the anchor `targetId` (byte-identical to
     *  pre-I6 behavior for every ship without an enemy-most-buffs on-cast purge). */
    enemyMostBuffsId?: string;
    /** PR10 (buff steal): living adjacent allies of THIS acting actor, resolved fresh per turn
     *  from its own side's roster (engine.ts's buildTurnArgs: `bySide(a.side).adjacentAllyIdsFor
     *  (a.id)` — team-symmetric for free, same helper 'adjacent-allies' targets use elsewhere).
     *  Consumed ONLY by a `buff-steal` ability whose config carries `grantAdjacentAllies` — the
     *  stolen buff is additionally granted to every id here (alongside the caster itself).
     *  Absent/[] → the grant is caster-only (byte-identical for every ship without that flag,
     *  and for non-positional/DPS callers that never supply it). */
    adjacentAllyIds?: string[];
    /** Ship-kit W5 Task A3: resolves the board-neighbours of an ENEMY-side anchor id (the
     *  resolved `targetId`, not the caster) — feeds the `adjacent-enemies` /
     *  `target-and-adjacent-enemies` debuff recipientIds fan-out below. Supplied by
     *  engine.ts's `buildTurnArgs` (team-symmetric via `bySide`/`isEnemySide`, same pattern as
     *  `adjacentAllyIds` above). Absent → both scopes degrade to their DPS/non-positional
     *  fallback (see the recipientIds computation). */
    adjacentEnemyIdsFor?: (anchorId: string) => string[];
    /** Sub-project I, PR I3 (Layer 1) — `all-allies`-targeted passive `modifier` abilities
     *  gathered from THIS actor's living same-side allies (source excluded — see
     *  engine.ts's `buildTurnArgs`). Merged into `modifierAbilities` below alongside the
     *  actor's own firing + passive abilities, so a team aura (Lodolite's "+15% to enemies
     *  with Concentrate Fire", Panguan's "+40% to Stealthed allies") folds into the
     *  RECIPIENT's own dmgStats fold AND (PR I2) `perVictimOutgoing`, evaluated against the
     *  recipient's OWN ctx (self-buff/enemy-status gates resolve from the recipient's
     *  perspective, not the source's). Defaults to `[]` — absent/empty is byte-identical to
     *  pre-I3 behavior (no ship's all-allies modifier reaches teammates without this). */
    allyModifierAbilities?: Ability[];
    /** Sub-project I, PR I4c — per-SOURCE breakdown of `all-allies` `dotDamage`-channel
     *  modifier abilities, needed IN ADDITION TO `allyModifierAbilities` (which flattens
     *  every source into one list and so loses provenance). Wildfire's refit-3 aura is the
     *  one shape (today) where an all-allies modifier's bonus must scale by the SOURCE's
     *  own live stat (`self-crit-power`) rather than the recipient's — the locked game rule
     *  for "all allies deal…for every 10% crit power THIS UNIT has" (THIS UNIT = the aura's
     *  caster, not the ally dealing the tick). Each entry is one living same-side ally
     *  (excluding this actor): `abilities` is that ally's full all-allies MODIFIER list
     *  (re-partitioned below via `partitionDotDamageAbilities` to extract just the
     *  name-gated `dotDamage` ones — everything else already folds correctly via the
     *  recipient's own ctx through `allyModifierAbilities`, unaffected by this field);
     *  `sourceCritPower` is that ally's OWN live crit power (base + scheduled/timed self-
     *  buffs — the same "layers 1+2+3" shape `modifierCtx.selfCritPower` uses for the
     *  acting actor, computed via `effectiveStatsOf` since the source may not be acting
     *  this round — see engine.ts's `buildTurnArgs`). Defaults to `[]` — absent/empty is
     *  byte-identical to pre-I4c behavior. */
    allyDotDamageAuraSources?: {
        sourceId: string;
        sourceCritPower: number;
        abilities: Ability[];
    }[];
    /** SP-F F3 fix (Critical): routes a FORCED bomb detonation — `reduceEnemyBombs`/
     *  `reduceBombsOnVictim` driving an existing PendingBomb's countdown to <=0 (Lingshe) — through
     *  the engine's real per-victim `applyVictimDamage` sink, so it behaves EXACTLY like a natural
     *  countdown-0 burst: Barrier full-damage-immunity, the Cheat-Death intercept, `destroyedRound`/
     *  `ship-destroyed` emission (no zombie unit), incoming-block/Lifeline, and the round's
     *  detonation tally (roundPerTargetDamage + perActorDetonation, credited to the bomb's ORIGINAL
     *  `sourceId`) all apply. Supplied by the engine (`buildTurnArgs`), side-resolved (enemySink for
     *  a player caster, playerSink for an enemy caster) — mirrors `applyPerVictimDetonation`'s sink
     *  selection. Absent (standalone/unit-test callers with no engine scope) falls back to a bare
     *  shield-then-HP debit with NO Barrier/Cheat-Death/destroyed handling — `reduceEnemyBombs` is
     *  itself inert without a resolved `targetId`, which only a positional/engine-scoped caller ever
     *  supplies in production, so the fallback is exercised only by tests that hand-build args. */
    forceDetonateBomb?: (victim: CombatActor, sourceId: string, damage: number) => void;
}

// ---------------------------------------------------------------------------
// Module-private helpers used EXCLUSIVELY by the player turn.
// ---------------------------------------------------------------------------

// expandBuffs/expandEnemyDebuffs moved to buffTotals.ts (re-exported from lines 41-50 above).

// Per-round self-buff totals from the status engine's active list. Expands each
// active buff back into its SelectedGameBuff effects (stack override included) and
// folds them into the six tracked totals. The later active-passive modifier
// fold-in stays in the loop (it depends on modifierCtx); these totals are returned
// mutable so the loop can add the modifier deltas at the original sequence point.
function resolveSelfBuffTotals(args: {
    activeSelfBuffs: ActiveBuff[];
    selfBuffLookup: Map<string, SelectedGameBuff[]>;
}): ReturnType<typeof calculateBuffTotals> {
    const roundSelfBuffs = args.activeSelfBuffs.flatMap((ab) =>
        // Accumulating buff: override static stacks with per-round count; skip when 0
        expandBuffEntry(ab, args.selfBuffLookup.get(ab.buffName) ?? [])
    );
    return calculateBuffTotals(toSimBuffs(roundSelfBuffs));
}

// Per-round RECURRING/always enemy-debuff expansion with landing logic (Task 7).
// TIMED enemy applications are gated ONCE at application time (the status-engine hook
// and the ability loop below), so they are NOT re-rolled here — only the recurring/aura
// subset is, mirroring their conceptual per-round re-application. 'apply' (affinity-based)
// debuffs land unless the attacker is at an affinity disadvantage; everything else draws
// the hacking-vs-security landing roll. The roll is a LAZY getter (`roundDebuffLanded`)
// so the single per-round gate draw is taken only when a non-'apply' recurring debuff is
// present (and is memoized across all round consumers — recurring fold, DoT landing, and
// since SP-4b-2 D4 the POSITIONAL DAMAGE read, which consumes this function's
// `roundEnemyDebuffs` via `PlayerTurnResult.scheduledEnemyEffects` rather than re-reading
// the ungated `__enemy__` bucket. One draw, one decision, both channels).
// NOTE: no `debuff-applied` is emitted here (Phase 3 retiming: recurring/aura per-round
// re-applications are NOT discrete inflictions — only `debuff-resisted` fires on miss,
// unchanged from Phase 1).
function resolveEnemyDebuffs(args: {
    activeEnemyDebuffs: ActiveBuff[];
    enemyDebuffLookup: Map<string, SelectedGameBuff[]>;
    affinityDisadvantage: boolean;
    roundDebuffLanded: () => boolean;
    emitResisted: (buffName: string) => void;
}): {
    roundEnemyDebuffs: SelectedGameBuff[];
    landedEnemyDebuffs: ActiveBuff[];
    resistedEnemyDebuffs: ActiveBuff[];
} {
    const landedEnemyDebuffs: ActiveBuff[] = [];
    const resistedEnemyDebuffs: ActiveBuff[] = [];
    const roundEnemyDebuffs = args.activeEnemyDebuffs.flatMap((ab) => {
        const bufs = args.enemyDebuffLookup.get(ab.buffName) ?? [];
        // 'apply' = affinity-based: guaranteed unless the attacker is at an affinity
        // disadvantage. 'inflict' (and unmarked) = hacking-based: gated by the
        // hacking-vs-security landing roll. NOTE: application type is derived from
        // the lookup because ActiveBuff does not carry it — if ActiveBuff ever gains
        // an `application` field (e.g. team-sourced debuffs), prefer reading it there.
        const isApply = bufs.some((b) => b.application === 'apply');
        const lands = isApply ? !args.affinityDisadvantage : args.roundDebuffLanded();
        if (!lands) {
            resistedEnemyDebuffs.push(ab);
            args.emitResisted(ab.buffName);
            return [];
        }
        landedEnemyDebuffs.push(ab);
        return expandBuffEntry(ab, bufs);
    });
    return { roundEnemyDebuffs, landedEnemyDebuffs, resistedEnemyDebuffs };
}

// Per-round fold for TIMED scheduled enemy statuses currently in the status map. They
// drew their landing roll ONCE at application (status-engine hook) and persist their full
// window with no re-roll, so here they are unconditionally landed: expand their effects
// and report them as landed. No gate draw, no resist partition, NO `debuff-applied`
// emission (Phase 3 retiming: discrete-infliction-only; the emission moved to the
// sourceFired/applyTimedAbilityStatus application sites).
function foldTimedEnemyDebuffs(args: {
    timedEnemyDebuffs: ActiveBuff[];
    enemyDebuffLookup: Map<string, SelectedGameBuff[]>;
}): { roundEnemyDebuffs: SelectedGameBuff[]; landedEnemyDebuffs: ActiveBuff[] } {
    const landedEnemyDebuffs: ActiveBuff[] = [];
    const roundEnemyDebuffs = args.timedEnemyDebuffs.flatMap((ab) => {
        const bufs = args.enemyDebuffLookup.get(ab.buffName) ?? [];
        landedEnemyDebuffs.push(ab);
        return expandBuffEntry(ab, bufs);
    });
    return { roundEnemyDebuffs, landedEnemyDebuffs };
}

// Step 2.9: Extend ACTIVE-scope ticking DoTs (Corrosion/Inferno) by extend-dot abilities —
// applied BEFORE this round's new DoTs so only pre-existing ones grow (Provider's
// "extends active Damage Over Time effects"). Bombs are excluded (delaying a one-shot
// detonation adds nothing). Each ability is gated by its conditions (using ctx with binary
// roundCrit); a `chanceFromCritPower` extension fires at exactly critPowerFactor frequency
// via the deterministic extendChanceGate schedule. Sourced from BOTH the firing skill and
// the always-active passive slot. The stateful gate is passed in and called at the same
// sequence point as the original inline loop. 'inflicted'-scope extensions are handled
// separately AFTER applyNewDoTs (see extendInflictedDoTs).
function extendDoTs(args: {
    abilities: Ability[];
    ctx: ConditionContext;
    effectiveCritDamage: number;
    extendChanceGate: (rate: number) => boolean;
    corrosionEntries: ActiveDoTStack[];
    infernoEntries: ActiveDoTStack[];
}): void {
    for (const ab of args.abilities) {
        if (ab.config.type !== 'extend-dot') continue;
        if (ab.config.scope === 'inflicted') continue;
        if (!conditionsMet(ab.conditions, args.ctx)) continue;
        if (ab.config.chanceFromCritPower) {
            const critPowerFactor = Math.min(1, args.effectiveCritDamage / 100);
            if (!args.extendChanceGate(critPowerFactor)) continue;
        }
        for (const e of args.corrosionEntries) e.remainingRounds += ab.config.turns;
        for (const e of args.infernoEntries) e.remainingRounds += ab.config.turns;
    }
}

// Step 3a: Extend INFLICTED-scope DoTs — runs AFTER applyNewDoTs, extending ONLY the
// Corrosion/Inferno entries THIS cast just appended (Valerian's "the newly applied
// Corrosion ... extended by 1 turn"). `*EntriesBefore` are the container lengths captured
// before applyNewDoTs, so the slice from that index onward is exactly what landed this cast.
// Bombs are excluded (matching extendDoTs). Gating is identical to extendDoTs: ability
// conditions vs ctx (binary roundCrit), then extendChanceGate(critPowerFactor) for a
// chanceFromCritPower extension. If the landing roll failed, applyNewDoTs was skipped and
// the slice is empty — a natural no-op.
function extendInflictedDoTs(args: {
    abilities: Ability[];
    ctx: ConditionContext;
    effectiveCritDamage: number;
    extendChanceGate: (rate: number) => boolean;
    corrosionEntries: ActiveDoTStack[];
    infernoEntries: ActiveDoTStack[];
    corrosionEntriesBefore: number;
    infernoEntriesBefore: number;
}): void {
    for (const ab of args.abilities) {
        if (ab.config.type !== 'extend-dot') continue;
        if (ab.config.scope !== 'inflicted') continue;
        if (!conditionsMet(ab.conditions, args.ctx)) continue;
        if (ab.config.chanceFromCritPower) {
            const critPowerFactor = Math.min(1, args.effectiveCritDamage / 100);
            if (!args.extendChanceGate(critPowerFactor)) continue;
        }
        for (let i = args.corrosionEntriesBefore; i < args.corrosionEntries.length; i++) {
            args.corrosionEntries[i].remainingRounds += ab.config.turns;
        }
        for (let i = args.infernoEntriesBefore; i < args.infernoEntries.length; i++) {
            args.infernoEntries[i].remainingRounds += ab.config.turns;
        }
    }
}

// Charge gain from a GATED skill's charge abilities. Gating already happened in
// gateFiringAbilities (full AND/OR + thresholds) — for the firing skill via
// gatedSkill and for the passive slot via gatedPassive. A thresholded gate
// contributes the flat amount once; an unthresholded count/probability condition
// still SCALES it (binary self-crit, per-count subjects). No condition → flat amount.
function chargeGainFromSkill(args: {
    gatedSkill: Skill | undefined;
    ctxFor: Map<string, ConditionContext>;
    fallbackCtx: ConditionContext;
    /** Which charge abilities to sum (Task 5 ally routing; Task 7 enemy routing):
     *  - 'own'   → self-targeted (and anything not ally/all-allies/enemy/all-enemies) → bumps the
     *    caster only.
     *  - 'ally'  → ally/all-allies-targeted → bumps every player actor (via grantAllyCharges).
     *  - 'enemy' → enemy/all-enemies-targeted → REMOVES from every opposing actor (via
     *    removeEnemyCharges). Positive amount; the engine subtracts.
     *  For attacker-only runs the 'ally' total still routes through grantAllyCharges, which
     *  loops the sole attacker → identical net charge to the pre-Task-5 single 'own' sum. */
    targetFilter: 'own' | 'ally' | 'enemy';
}): number {
    let gain = 0;
    for (const ability of chargeAbilitiesFromSkill(args.gatedSkill)) {
        if (ability.config.type !== 'charge') continue;
        // SP-4e: 'lowest-hp-ally' is an ALLY target and must be counted as one. This filter is a
        // SIDE classifier, not a recipient resolver — it only decides which of the three totals a
        // charge ability contributes to, and 'ally' vs 'own' is precisely "somebody else on my
        // side" vs "me". Leaving the variant out would have routed a charge granted to the
        // lowest-HP ALLY into the caster's OWN charge instead, which is the same self-target
        // mistake the variant exists to forbid — a worse answer than the known approximation on
        // the 'ally' side (grantAllyCharges bumps every same-side actor, so a single-ally grant is
        // over-applied; that approximation is pre-existing and shared with plain 'ally').
        //
        // That over-application is an OPEN RESIDUAL belonging to no scheduled task — SP-4e Task 6
        // is the epic's last rung, so do not read the earlier "not this rung's scope" wording as a
        // pending fix. It is also CORPUS-DEAD: every ability carrying `'lowest-hp-ally'` in the
        // shipped roster is a HEAL, never a charge (all five of them — Pallas/active,
        // Volk/passive1+2, Valkyrie/passive1+2 — pinned by the inventory gate in
        // `lowestHpAllySelector.test.ts`). Only a hand-authored charge ability can reach it.
        const isAlly =
            ability.target === 'ally' ||
            ability.target === 'all-allies' ||
            ability.target === 'lowest-hp-ally';
        const isEnemy = ability.target === 'enemy' || ability.target === 'all-enemies';
        // 'own' sums everything that is neither ally- nor enemy-targeted; the other filters
        // sum only their matching target class.
        // NOTE: only 'enemy'/'all-enemies' count as enemy here; the selector enemy-targets
        // ('enemy-most-buffs'/'enemy-highest-attack') fall into 'own'. Harmless today — the
        // skill parser never emits a selector target for type:'charge' — but if charge ever
        // uses one, add it to the enemy match (and to the reactive branch in triggers.ts).
        const matches =
            args.targetFilter === 'ally'
                ? isAlly
                : args.targetFilter === 'enemy'
                  ? isEnemy
                  : !isAlly && !isEnemy;
        if (!matches) continue;
        const primary = ability.conditions[0];
        const scale =
            !primary || primary.countComparator != null
                ? 1
                : // SP-4d: an unresolvable scaling source contributes no charge.
                  (evaluateCondition(primary, args.ctxFor.get(ability.id) ?? args.fallbackCtx) ??
                  0);
        gain += scale * ability.config.amount;
    }
    return gain;
}

// Step 2.95: Detonate active DoTs of a type — consume them and deal their full remaining
// damage at once, scaled by powerPct. Done BEFORE this round's new DoTs apply, so a skill
// that detonates and re-applies the same type (e.g. Incinerator) doesn't eat its own new
// stack. The payout is DETONATION damage (the game category that also covers Bomb bursts).
// `emitBombDetonated` is called for the bomb branch when the payout is non-zero, carrying
// total stacks and damage so Phase 3 reactive triggers can respond (Phase 3 Task 3).
function detonate(args: {
    gatedSkill: Skill | undefined;
    effectiveAttack: number;
    enemyHp: number;
    dotMult: number;
    affinityMult: number;
    detonationMult: number;
    corrosionEntries: ActiveDoTStack[];
    infernoEntries: ActiveDoTStack[];
    pendingBombs: PendingBomb[];
    emitBombDetonated?: (stacks: number, damage: number) => void;
}): number {
    // Delegate the per-type detonation MATH to the pure helper. Bombs burst with the
    // APPLIER's affinity matchup AND detonation-damage modifier (Voidfire), both snapshotted
    // at application (PendingBomb.affinityMult / .detonationDamageModifier) — NOT the
    // detonating actor's — mirroring the per-entry burst on the enemy turn (engine.ts
    // detonatePendingBombs). The helper consumes each container (`.length = 0`) in `dets`
    // order, so a 2nd bomb det sees emptied bombs. We keep the side-effect (event emit) here.
    const result = detonateContainers(
        {
            dets: detonationsFromSkill(args.gatedSkill),
            effectiveAttack: args.effectiveAttack,
            dotMult: args.dotMult,
            affinityMult: args.affinityMult,
            detonationMult: args.detonationMult,
        },
        {
            corrosionEntries: args.corrosionEntries,
            infernoEntries: args.infernoEntries,
            pendingBombs: args.pendingBombs,
            victimHp: args.enemyHp,
        }
    );
    if (result.bomb > 0) {
        args.emitBombDetonated?.(result.bombStacks, result.bomb);
    }
    return result.total;
}

// Step 3: Apply new DoT stacks from this round's skill (subject to landing roll).
// `sourceId` (the applier) is stamped on every appended entry for per-actor attribution
// (Task 4); bombs also snapshot the applier's `affinityMult` at application (used at burst).
function applyNewDoTs(args: {
    dotsConfig: DoTApplicationConfig;
    effectiveAttack: number;
    affinityMult: number;
    detonationDamageModifier: number;
    splashModifier: number;
    sourceId: string;
    corrosionEntries: ActiveDoTStack[];
    infernoEntries: ActiveDoTStack[];
    /** SP-E: generic (absolute per-tick) DoT entries. Nothing in `dotsConfig` produces
     *  `type:'generic'` today — the parser never emits it — but this branch exists so a future
     *  transform (Voron/Orel, E3) can share this one apply entry point. */
    genericDoTEntries: ActiveDoTStack[];
    pendingBombs: PendingBomb[];
    emitDotApplied: (dotType: DoTType, stacks: number, tier: number) => void;
}): void {
    for (const dot of args.dotsConfig) {
        if (dot.stacks <= 0 || dot.tier <= 0) continue;
        if (dot.type === 'corrosion') {
            args.corrosionEntries.push({
                stacks: dot.stacks,
                tier: dot.tier,
                remainingRounds: dot.duration,
                sourceId: args.sourceId,
            });
            args.emitDotApplied('corrosion', dot.stacks, dot.tier);
        } else if (dot.type === 'inferno') {
            args.infernoEntries.push({
                stacks: dot.stacks,
                tier: dot.tier,
                remainingRounds: dot.duration,
                sourceId: args.sourceId,
            });
            args.emitDotApplied('inferno', dot.stacks, dot.tier);
        } else if (dot.type === 'bomb') {
            args.pendingBombs.push({
                countdown: Math.max(1, dot.duration),
                damagePerStack: args.effectiveAttack * (dot.tier / 100),
                stacks: dot.stacks,
                tier: dot.tier,
                sourceId: args.sourceId,
                affinityMult: args.affinityMult,
                detonationDamageModifier: args.detonationDamageModifier,
                splashModifier: args.splashModifier,
            });
            args.emitDotApplied('bomb', dot.stacks, dot.tier);
        } else if (dot.type === 'generic') {
            args.genericDoTEntries.push({
                stacks: dot.stacks,
                tier: dot.tier,
                remainingRounds: dot.duration,
                sourceId: args.sourceId,
            });
            args.emitDotApplied('generic', dot.stacks, dot.tier);
        }
    }
}

// Step 3b: Apply Echoing Burst-style accumulators inflicted by this round's skill
// (gated by the same landing roll as inflicted debuffs). Each starts gathering this
// round's direct damage in Step 6b below.
function applyAccumulators(args: {
    gatedSkill: Skill | undefined;
    pendingAccumulators: PendingAccumulator[];
    sourceId: string;
}): void {
    for (const acc of accumulatorsFromSkill(args.gatedSkill)) {
        args.pendingAccumulators.push({
            roundsRemaining: Math.max(1, acc.turns),
            pct: acc.pct,
            accumulated: 0,
            sourceId: args.sourceId,
        });
    }
}

/**
 * Reduces `victim.shieldPool` by `pct`% of its CURRENT value (the locked H shield rule: an
 * untimed maxHP-capped pool; a percentage strip removes a share of whatever is currently in
 * the pool, not of its max). `pct: 100` fully zeroes it — the same numeric result as the
 * pre-PR9 `victim.shieldPool = 0` it replaces at the I6 (Lodolite) purge-coupled call site.
 * Shared by BOTH strip mechanics so there is one strip-apply site, not two:
 *   - I6: the `stripsShield` flag on a 'purge' ability (gated on the purge landing).
 *   - PR9(b): the standalone `type:'shield-strip'` ability (APEX/Laika/Malvex, unconditional
 *     on-cast — see parseShieldStrip's doc comment for why these stay mutually exclusive).
 *
 * Ship-kit Wave 3 (Task 7, Laika): emits `shield-stripped` (combat/events.ts) HERE — the one
 * shared mutation site both call sites route through — rather than at each call site, so there
 * is exactly one emit point and no risk of a double-emit if a future third caller appears.
 * Suppressed when the pool was already 0 (nothing to remove) or the strip is a no-op, mirroring
 * `purge-performed`'s 0-removed suppression.
 */
function stripShieldPct(
    victim: CombatActor,
    pct: number,
    bus: CombatEventBus,
    casterId: string,
    round: number
): void {
    const before = victim.shieldPool;
    victim.shieldPool = Math.max(0, before * (1 - pct / 100));
    if (before > 0 && victim.shieldPool < before) {
        bus.emit({ type: 'shield-stripped', casterId, targetId: victim.id, pct, round });
    }
}

/**
 * SP-F F3: fans `reduceBombsOnVictim` over the firing skill's `bomb-countdown-reduce`
 * ability/abilities (all-enemies), across the AoE footprint (`aoeVictimIds` when present, else
 * the single anchor). Hacking-gated: reuses the SAME single-draw landing infra as every other
 * ability-timed 'inflict' enemy application in this file (`landsTimedEnemyApplicationLive`) — one
 * roll gates the whole cast, not a per-victim re-roll. Called BEFORE `applyNewDoTs` (mirrors
 * `extendDoTs`'s ordering) so a Bomb III this SAME cast inflicts is never itself reduced.
 */
function reduceEnemyBombs(args: {
    gatedSkill: Skill | undefined;
    ctx: ConditionContext;
    anchor: CombatActor;
    targetId: string | undefined;
    aoeVictimIds: string[] | undefined;
    opposingVictimById: Map<string, CombatActor> | undefined;
    round: number;
    bus: CombatEventBus;
    // Ship-kit W7: the caster forcing these detonations (Lingshe) — becomes each burst's
    // `detonatorId`. See reduceBombsOnVictim.
    detonatorId: string;
    landsTimedEnemyApplicationLive: (application?: 'inflict' | 'apply') => boolean;
    forceDetonateBomb?: (victim: CombatActor, sourceId: string, damage: number) => void;
}): void {
    if (args.targetId === undefined) return;
    for (const ab of args.gatedSkill?.abilities ?? []) {
        if (ab.config.type !== 'bomb-countdown-reduce') continue;
        if (!conditionsMet(ab.conditions, args.ctx)) continue;
        if (!args.landsTimedEnemyApplicationLive('inflict')) continue;
        const recipients =
            ab.target === 'all-enemies' && args.aoeVictimIds ? args.aoeVictimIds : [args.targetId];
        for (const vid of recipients) {
            const victim =
                args.opposingVictimById?.get(vid) ??
                (vid === args.anchor.id ? args.anchor : undefined);
            if (!victim) continue;
            reduceBombsOnVictim(
                victim,
                ab.config.turns,
                args.round,
                args.bus,
                args.detonatorId,
                args.forceDetonateBomb
            );
        }
    }
}

/**
 * One player actor's turn: the full damage/buff/DoT-application pipeline (combat-system.md
 * §10), minus the DoT-processing calls (tickDoTs / processBombs / processAccumulators) which
 * run on the enemy turn. Returns everything the round's RoundData row needs from this turn; the
 * caller folds the numeric damage fields into the round accumulator and drains any pending
 * resisted team-turn entries into `resistedEnemyDebuffs`. Math is byte-identical to the old
 * inline attacker block; only the structure (parameters + return) changed. Every per-actor
 * read comes from `runtime`, and every owner id is `runtime.actor.id` — only the attacker
 * uses this today (Task 3); Task 4 builds walked team runtimes.
 */
export function runPlayerTurn(args: PlayerTurnArgs): PlayerTurnResult {
    const {
        runtime,
        enemy,
        statusEngine,
        // SP-4c-2b: the containers and the two victim scalars are absent on a no-victim turn.
        // Defaulted HERE, once, so the ~40 downstream uses keep reading a non-optional local. A DoT
        // clause on a no-victim turn mutates a throwaway array, which is the correct semantics: it
        // lands on nobody. `enemyDefense`/`enemyHp` default to 0 — there is no defence to pierce and
        // no max HP to decline from.
        corrosionEntries = [],
        infernoEntries = [],
        genericDoTEntries = [],
        pendingBombs = [],
        pendingAccumulators = [],
        enemyDefense = 0,
        enemyHp = 0,
        enemyType,
        bus,
        round: r,
        grantAllyCharges,
        removeEnemyCharges,
        selfHpPct: selfHpPctArg = 100,
        targetHpPct: targetHpPctArg = 100,
        targetRepairedThisRound: targetRepairedThisRoundArg = false,
        targetId,
        enemyMostBuffsId,
        adjacentAllyIds,
        adjacentEnemyIdsFor,
        enemyBuffNames: enemyBuffNamesArg = [],
        stealthedEnemyCount: stealthedEnemyCountArg = 0,
        // No default — undefined is the DPS-parity sentinel (see PlayerTurnArgs doc).
        enemyDebuffNames: enemyDebuffNamesArg,
        selfDebuffNames: selfDebuffNamesArg = [],
        healEventOnly = false,
        onHitBreakStasis,
        aoeVictimIds,
        opposingVictimById,
        positional,
        activePattern,
        chargedPattern,
        sameSideLiving,
    } = args;

    const {
        actor,
        timedEnemyBySlot,
        timedSelfBySlot,
        selfBuffLookup,
        enemyDebuffLookup,
        activeCritGate,
        chargedCritGate,
        activeHealCritGate,
        chargedHealCritGate,
        debuffLandingGate,
        extendChanceGate,
        healModifier,
        castSkills: shipSkills,
        hasChargedSkill,
        attack,
        crit,
        critDamage,
        defensePenetration,
        defensePenetrationBuff,
        selfDotModifier,
        affinityDamageModifier,
        affinityCritCap,
        affinityCritPenalty,
        affinityDisadvantage,
        attackerAffinity,
        defence,
        hp,
        allyChargePerRound,
    } = runtime;
    // chargeCount lives on the actor (CombatActor carries it); read from there.
    const chargeCount = actor.chargeCount;

    /** SP-4c-2b: no victim this turn — an ally-targeted cast resolved nobody on the opposing side.
     *  Every victim-derived read below must answer "there is no enemy", NEVER "an enemy with neutral
     *  stats": the latter was exactly the dummy ghost, which SP-4c-2b stopped handing out and
     *  SP-4c-2d deleted (see plan §A.4-A.5 — the ghost's `shieldPool` was arming `enemyShielded`
     *  gates in 22 support-ship fingerprints).
     *  Read it as the ONE discriminator: every branch keyed off it keeps the with-victim
     *  path byte-identical by construction. Test it (never `enemy !== undefined`) at every site,
     *  including those that then dereference `enemy` — TS's aliased-condition narrowing carries the
     *  `const` through, closures included. */
    const hasVictim = enemy !== undefined;

    /** The victim-derived STAT slice of a gate context — the owner-vs-target comparison subjects
     *  (Bayah's crit-power gate, Cobalt's HP gate, Chakara's speed gate). Empty when there is no
     *  victim. Spread ONLY into the two contexts that carry these fields today (preDebuffGateCtx and
     *  `ctx`) — adding them to postDebuffGateCtx or modifierCtx would change which gates those
     *  contexts can resolve.
     *
     *  DISCHARGED (was a NAMED RESIDUAL through SP-4d task 2) — omission now correctly answers "there
     *  is no target". `ConditionContext.targetSpeed`/`targetCurrentHp`/`targetCritPower` are no
     *  longer defaulted with `?? 0`: `buildRoundContext` (roundContext.ts) conditionally spreads each
     *  one, withholding the KEY entirely when this slice is empty, and `evaluateConditions.ts`'s
     *  `stat-vs-target` arm returns `undefined` rather than comparing against a fabricated 0.
     *  `conditionMet` rejects that `undefined` above the comparator switch, so with the slice empty a
     *  **`gt`** comparator now reads FALSE against nobody, not TRUE — the same fix shape as the
     *  `enemyHpPct` derivation this task closes.
     *
     *  REACHABLE: this slice is spread into `ctx` (further down), which `gateFiringAbilities` uses to
     *  gate heal/shield/buff/charge payloads. That consumer is deliberately NOT victim-fenced — the
     *  repair must land on a no-victim turn — so the gate really does evaluate, and now evaluates
     *  honestly rather than against an invented target.
     *
     *  Exactly three corpus ships carry `stat-vs-target`, measured over parsed abilities:
     *    • Bayah   (charged control + debuff, crit-power, `gt`)
     *    • Cobalt  (active additional-damage, hp, `gt`)
     *    • Chakara (active charge, speed, `lt`) — was always SAFE regardless of this fix: `self < 0`
     *      is never true by arithmetic alone.
     *  None of the three is an ally-target ship (§A.2), so none can take a no-victim turn in the
     *  shipped corpus today — `noVictimAbsentSubject.integration.test.ts` (SP-4d task 3) pins the
     *  synthetic shape directly, since no shipped kit can build it. */
    const victimStatGateCtx = (v: CombatActor | undefined) =>
        v !== undefined
            ? {
                  targetSpeed: v.stats.speed,
                  targetCurrentHp: v.currentHp,
                  targetCritPower: v.stats.critDamage,
              }
            : {};

    /** The victim's shield-presence gate field (Malvex charged Barrier), shared by all four gate
     *  contexts. Read PRE-strip: a `type:'shield-strip'` clause in the same cast (Malvex's own
     *  "removes 30% of the enemy's Shield") only runs further down this turn, so this reads the pool
     *  as it stood before the cast. Harmless for the boolean — removing 30% of a positive pool
     *  leaves 70% of it, still positive — so pre- and post-strip agree; see the shield-strip site
     *  for the ordering. Empty when there is no victim: `enemyShielded` defaults false
     *  (triggers.ts:1793, roundContext.ts:151), so omission answers "there is no enemy to be
     *  shielded". This is the field the ghost was lying about (plan §A.5). */
    const victimShieldGateCtx = (v: CombatActor | undefined) =>
        v !== undefined ? { enemyShielded: v.shieldPool > 0 } : {};

    // ====================================================================
    // PLAYER TURN — the old attacker block, minus the DoT-processing
    // calls (tickDoTs / processBombs / processAccumulators), which move to
    // the enemy turn. Math is byte-identical; only the DoT block relocated.
    // ====================================================================

    // --- preTurn: action selection + charge consumption ---
    let action: 'active' | 'charged';
    if (hasChargedSkill && actor.charges >= chargeCount) {
        action = 'charged';
    } else {
        action = 'active';
    }
    advanceChargeCadence(actor, hasChargedSkill, bus, r);

    // `Charged Overdrive II` — one-shot +20 points of Defense Penetration on the next CHARGED
    // activation. Read and consumed HERE, immediately after `action` is decided and before this
    // turn's own slot-matched ability statuses are applied to the status store below (the
    // timedSelfBySlot loop, ~:1719, which includes an `all-allies` self-grant reaching this same
    // actor). Reading any later would let a self-granting charged cast consume the copy it just
    // granted itself, boosting the very cast that grants it — the game text ("the next Charged
    // Skill activation") requires the grant to only ever affect a LATER cast. An ally's grant is
    // unaffected by this ordering: it landed during the ally's own earlier turn, so it is already
    // in the store before this actor's turn begins either way.
    //
    // Consumed UNCONDITIONALLY on a charged activation - the game text has no damage qualifier, so
    // a pure-buff charged skill (Sentinel's own) still spends it.
    const chargedOverdrivePen =
        action === 'charged' && holdsChargedOverdriveII(statusEngine, actor.id)
            ? CHARGED_OVERDRIVE_II_PEN
            : 0;
    if (chargedOverdrivePen > 0) consumeChargedOverdriveII(statusEngine, actor.id);

    bus.emit({ type: 'skill-fired', actorId: actor.id, round: r, slot: action });

    const firingPattern = action === 'charged' ? (chargedPattern ?? activePattern) : activePattern;
    const footprintAllyIds = supportFootprintAllyIds({
        pattern: firingPattern,
        anchor: actor.position,
        sameSideLiving: sameSideLiving ?? [],
    });
    // The firing skill's support footprint narrows the CAST's ally recipients. TWO things escape it,
    // and they are independent — do not collapse them into one rule:
    //
    //  (1) SLOT. A PASSIVE-slot support ability is not part of the cast, so the pattern does not
    //      govern it (user-verified 2026-07-31 via Volk: its active buffs stay on-pattern, its
    //      passive repair reaches the ally with the most missing health wherever that ally stands).
    //      The exception is a passive whose own clause names the pattern —
    //      `Ability.patternScoped`, see the flag's doc comment. That is what `scopedByFootprint`
    //      below decides, and it is the ONLY axis this predicate knows about.
    //
    //  (2) TARGET (SP-4e, user-confirmed 2026-08-20). A TEXT-NAMED ally selector is never
    //      footprint-scoped **on either slot**. The Volk observation above was originally recorded
    //      as a fact about his passive slot, but the load-bearing half of it is the selector: his
    //      text names "the ally with the most missing health", and a named ally is reached wherever
    //      it stands. `'lowest-hp-ally'` (Pallas, Volk, Valkyrie) therefore bypasses
    //      `supportRecipients` entirely — `recipientsFor` returns for it BEFORE calling this, and
    //      `resolveSupportRecipients` THROWS on the target by design so a future caller cannot
    //      quietly narrow it. Put a named selector on an ACTIVE skill and it still ignores the
    //      pattern; that is not the passive-slot rule leaking, it is rule (2).
    //
    // Everything left over — a plain `'ally'`, `'all-allies'`, `'adjacent-allies'` on the cast slot
    // — IS narrowed, including plain `'ally'` since SP-4e Task 4 (see `recipientsFor`).
    const scopedByFootprint = (ability: Ability | undefined, fromPassive: boolean): boolean =>
        !fromPassive || ability?.patternScoped === true;
    const supportRecipients = (
        target: Ability['target'],
        base: string[],
        // Omitted ⇒ cast-slot (always footprint-scoped), matching every pre-existing caller.
        source?: { ability: Ability; fromPassive: boolean }
    ): string[] =>
        resolveSupportRecipients({
            target,
            casterId: actor.id,
            baseRecipients: base,
            footprintAllyIds:
                source === undefined || scopedByFootprint(source.ability, source.fromPassive)
                    ? footprintAllyIds
                    : undefined,
        });

    // SP-4e: live HP fraction of a same-side actor, bound to this turn's healing ctx / live
    // roster. Reads the healing-mode accessors when present (authoritative max HP, buff-aware)
    // and the live same-side roster otherwise. Feeds the 'lowest-hp-ally' selector, which needs
    // live HP that `resolveSupportRecipients` cannot see. `allyHpFraction` itself is lifted to
    // `supportRecipients.ts` (shared across callers); this is just the per-turn binding of it.
    const allyHpFractionOf = (id: string): number | undefined =>
        allyHpFraction({ id, healing: args.healing, sameSideLiving });

    // Enemy HP% entering this round, derived from the struck victim's live HP decline (PR6b:
    // the engine no longer passes a precomputed scalar — `enemy` is the tgt actor, `enemyHp`
    // its max, so decline = how much HP the victim has lost). For the DPS dummy sink it equalled
    // the old cumulativeDamage+cumulativeTeamDamage (the sink's currentHp tracked it post-round);
    // for a real positional victim — which since SP-4c-2d is the only kind — it reflects that
    // victim's actual HP.
    // LOAD-BEARING TIMING: on a roster-less run the dummy's currentHp updated POST-round (the
    // round-tail HP block, deleted in SP-4c-2d), not per-hit, so the derived value equalled the
    // entering-round scalar the old param carried. That timing does NOT hold for a real positioned
    // victim — its HP falls
    // during the turn walk — so on a positional run (since SP-4b-2a, every DPS-calculator run)
    // this reads the victim's HP as it stood when THIS actor's turn began, which is the intended
    // "entering this turn" semantics for the hp-threshold gates, not a per-round scalar.
    // SP-4d: with no victim there is no HP to have declined and no denominator to divide by, so
    // there is NO READING — the gate-facing value is absent, and every enemy-HP gate on this turn
    // is unresolvable rather than satisfied by a fabricated 100 ("a healthy enemy"). The
    // 4c-2b-era residual note that stood here is discharged; do not restore a `: 100` fallback.
    // The `: 0` arm is REACHABLE — do not collapse this ternary. A victim with max HP 0 is a real
    // victim with no HP, i.e. 0%, which is a different answer from `undefined` ("no victim") and
    // from 100 ("a healthy enemy"). It is NOT reached the obvious way: `normalizeRoster` floors an
    // ENEMY's max HP to 1,000,000, so `bareEnemy({ stats: { hp: 0 } })` never gets here. It is
    // reached on an ENEMY's own turn against a PLAYER-side actor whose `stats.hp` is omitted or
    // zero — the player side carries no such floor. Measured by instrumenting this branch over the
    // combat suite: 4 hits, every one with victim id `'attacker'`.
    const enemyHpPct = hasVictim
        ? enemyHp > 0
            ? Math.max(0, 100 * (1 - Math.max(0, enemyHp - enemy.currentHp) / enemyHp))
            : 0
        : undefined;

    const firingSkill = selectFiringSkill(shipSkills, action);
    // noCrit is read from the UNGATED skill: the flag is a property of the attack
    // itself and must be known before the ctx (and therefore the gate) exists.
    // Assumes one base-damage ability per skill (true for all parser output); a
    // gated-off first damage ability with a differently-flagged second one would
    // read the wrong flag — not representable from skill text today.
    const { noCrit: damageNoCrit, scalingAbility: damageAbility } =
        damageInputsFromSkill(firingSkill);
    const hasDamageAbility = damageAbility !== undefined;

    // SP-4c-2b: `victimId` is REQUIRED (it used to default to the turn victim's id). There is no
    // victim to default to on a no-victim turn, and an application/resist event with no victim is
    // not a thing — so every caller now names its victim, and each enclosing application block is
    // fenced on `hasVictim` so a no-victim turn never reaches one.
    const emitDebuffResisted = (buffName: string, victimId: string) =>
        bus.emit({
            type: 'debuff-resisted',
            sourceId: actor.id,
            targetId: victimId,
            round: r,
            buffName,
        });
    // emitDebuffApplied: discrete-infliction-only (Phase 3 retiming). `sourceId` is the
    // actor that inflicted the debuff. NOT called for recurring/aura per-round re-applications
    // or for every round a standing timed status is active — only at the infliction site.
    // SP-4c-2b: `victimId` is REQUIRED here too — see emitDebuffResisted above.
    const emitDebuffApplied = (sourceId: string, buffName: string, victimId: string) =>
        bus.emit({ type: 'debuff-applied', sourceId, targetId: victimId, round: r, buffName });

    // LIVE per-target debuff-landing chance (A2 Task 4 / A-closeout). The sole producer of
    // landing chance: recomputed each turn from the acting actor's effective hacking (× this
    // actor's affinity) vs the TURN TARGET's effective security. `liveDebuffLandingChance` is
    // self-sufficient — it defaults a missing attacker hacking → 200 and target security → 100,
    // reproducing the old static formula for base-less/neutral actors. The acting actor's
    // `selfBuffLookup` folds scheduled self-buffs; timed ability statuses (the hacking/security
    // buffs that move landing) fold lookup-free from the status engine. Cached once per turn here
    // — every landing consumer below reads this value.
    // SP2a: positional casts re-resolve affinity vs the bound anchor; non-positional keeps
    // representative scalars (DPS byte-identical).
    const attackerAff = attackerAffinity ?? actor.affinity ?? 'antimatter';
    const positionalLanding = args.deferAbilityPerformedToEngine === true;

    // ── SP-F F4: forced-affinity override surface ──────────────────────────────────────────
    // Two sources force this cast's affinity, superseding the real matchup / pre-baked adapter
    // flat fields:
    //  (1) the firing damage ability's `forceAffinityAdvantage` flag (Wusheng's charged "deals
    //      220% damage WITH AFFINITY ADVANTAGE"); OR
    //  (2) the acting unit carrying the 'Offensive Affinity Override' buff (Isha/Nayra).
    //  Either forces this attacker's OUTGOING hits to affinity ADVANTAGE (+25 dmg, crit cap 100,
    //  no crit penalty, 'apply' debuffs land).
    //  (3) A VICTIM carrying 'Defensive Affinity Override' forces the incoming attacker to affinity
    //      DISADVANTAGE against that victim ("advantage while getting attacked" = the defender
    //      holds the advantage, so the attacker is disadvantaged): −25 dmg, crit cap 75, +25 crit
    //      penalty, 'apply' debuffs resist.
    //  PRECEDENCE: an outgoing-advantage force wins over a victim's defensive force (rare collision).
    //  DEFAULT (no override, incl. single-ship DPS against a synthesized enemy that carries no
    //  skills and so grants itself no buffs — before SP-4c-2d, the dummy enemy): the
    //  effective values equal the destructured runtime scalars / real matchup — byte-identical.
    //  SCOPE: the anchor (primary/bound target) path is fully covered. Per-covered-victim AoE
    //  offensive/defensive forcing is a documented limitation (no corpus override ship is AoE).
    const damageForcesAffinityAdvantage =
        damageAbility !== undefined &&
        damageAbility.config.type === 'damage' &&
        damageAbility.config.forceAffinityAdvantage === true;
    const forceOutgoingAdvantage =
        damageForcesAffinityAdvantage ||
        selfBuffNamesForOwners(statusEngine, [actor.id]).includes('Offensive Affinity Override');
    const victimHasDefensiveOverride = (victim: CombatActor): boolean =>
        selfBuffNamesForOwners(statusEngine, [victim.id]).includes('Defensive Affinity Override');
    // Effective affinity modifiers vs a specific victim, applying the override precedence.
    // SP-4c-2b: `victim` is optional — with no victim there is no matchup, so there is also no
    // defensive override to honour and the neutral 'antimatter' answer stands. Byte-identical to the
    // ghost's reading (plan §A.4: the dummy's `affinity` was ALWAYS undefined, so this call already
    // resolved 'antimatter' on every ally-targeted turn).
    const affinityModsVsVictim = (
        victim: CombatActor | undefined
    ): { damageModifier: number; critCap: number; critPenalty: number } => {
        if (forceOutgoingAdvantage) return { damageModifier: 25, critCap: 100, critPenalty: 0 };
        if (victim !== undefined && victimHasDefensiveOverride(victim))
            return { damageModifier: -25, critCap: 75, critPenalty: 25 };
        return computeAffinityModifiers(attackerAff, victim?.affinity ?? 'antimatter');
    };
    // Primary/bound-target effective scalars — supersede the pre-baked flat fields when an override
    // is active; otherwise equal the destructured runtime values (byte-identical default).
    // SP-4c-2b: no victim ⇒ nobody can be holding a defensive override against this cast.
    const primaryDefensiveOverride =
        !forceOutgoingAdvantage && hasVictim && victimHasDefensiveOverride(enemy);
    const affinityOverrideActive = forceOutgoingAdvantage || primaryDefensiveOverride;
    const effAffinityDamageModifier = forceOutgoingAdvantage
        ? 25
        : primaryDefensiveOverride
          ? -25
          : affinityDamageModifier;
    const effAffinityCritCap = forceOutgoingAdvantage
        ? 100
        : primaryDefensiveOverride
          ? 75
          : affinityCritCap;
    const effAffinityCritPenalty = forceOutgoingAdvantage
        ? 0
        : primaryDefensiveOverride
          ? 25
          : affinityCritPenalty;
    const effAffinityDisadvantage = forceOutgoingAdvantage
        ? false
        : primaryDefensiveOverride
          ? true
          : affinityDisadvantage;

    const landingAffinityMod = affinityOverrideActive
        ? effAffinityDamageModifier
        : positionalLanding
          ? // SP-4c-2b: no victim ⇒ no matchup ⇒ the neutral answer. Byte-identical to the ghost's
            // (plan §A.4: its `affinity` was always undefined, so this already read 'antimatter').
            computeAffinityModifiers(attackerAff, enemy?.affinity ?? 'antimatter').damageModifier
          : affinityDamageModifier;
    const landingAtDisadvantage = affinityOverrideActive
        ? effAffinityDisadvantage
        : positionalLanding
          ? landingAffinityMod < 0
          : affinityDisadvantage;
    // SP-4c-2b: the landing chance is hacking-vs-THIS-VICTIM's-security. With no victim there is no
    // security to beat and nothing that could receive a debuff, so the chance is 0 — NOT "vs a
    // defender with default security", which is what handing the ghost to this call computed.
    const liveLandingChance = hasVictim
        ? liveDebuffLandingChance(statusEngine, selfBuffLookup, actor, enemy, landingAffinityMod)
        : 0;
    // Block Debuff: an immune turn-target auto-resists every timed/persistent application.
    // Computed ONCE per turn (the turn target `enemy` is fixed for this turn) — the immune
    // short-circuit below is only reached when this is true, which no existing fixture triggers,
    // so the non-immune path stays byte-identical. Task 6 reuses this for the DoT path.
    // SP-4c-2b: no victim ⇒ nobody is carrying Block Debuff against this cast, so `false`. This
    // also makes the Block-Debuff DoT branch further down provably unreachable on a no-victim turn.
    const targetImmuneToDebuffs = hasVictim
        ? targetCarriesBlockDebuff(statusEngine, enemy.id)
        : false;
    // Turn-local landing decision: an immune target auto-resists (return false WITHOUT drawing
    // the gate, so the existing resist branches record it); otherwise 'apply' (affinity) lands
    // unless at an affinity disadvantage (UNCHANGED rule); 'inflict' (and unmarked) draws the
    // runtime's deterministic gate against the LIVE chance. Replaces the runtime's pre-baked
    // `landsTimedEnemyApplication` so every 'inflict' draw — the playerTurn timed loop, the
    // status-engine sourceFired hook, and the reactive (triggers.ts) path — uses the live value
    // uniformly.
    // SP-4c-2b: with NO VICTIM nothing lands, and it does so WITHOUT drawing the gate — a phantom
    // draw against a 0 chance (makeRateGate draws unconditionally, rateAccumulator.ts:105) would
    // shift the deterministic schedule of every later real application for no reason.
    const landsTimedEnemyApplicationLive = (application?: 'inflict' | 'apply'): boolean =>
        !hasVictim || targetImmuneToDebuffs
            ? false
            : application === 'apply'
              ? !landingAtDisadvantage
              : debuffLandingGate(liveLandingChance);
    /** The CAST path's per-victim landing decision (the positional apply loop's victims).
     *
     *  DELIBERATELY NOT THE SAME as the reactive path's `reactiveLandingChanceFor` (engine.ts), and a
     *  future reader should not "unify" them: this one honours `affinityModsVsVictim` — the
     *  `forceOutgoingAdvantage` / defensive-override resolution — because those are TURN-SCOPED CAST
     *  concepts, live only while this actor's own cast is resolving. The reactive resolver
     *  deliberately takes the base `computeAffinityModifiers` matchup instead, matching its own
     *  sibling (the reactive `'apply'` arm's `getAffinityMatchup`), because a reaction fires outside
     *  any cast and has no override in scope. Same formula, different affinity input, on purpose. */
    const landsDebuffOnVictim = (
        application: 'inflict' | 'apply' | undefined,
        victim: CombatActor
    ): boolean => {
        if (targetCarriesBlockDebuff(statusEngine, victim.id)) return false;
        // SP-F F4: per-victim affinity honours the override (offensive advantage / this victim's
        // defensive override) before falling back to the real matchup.
        const victimAffinityMod = affinityModsVsVictim(victim).damageModifier;
        if (application === 'apply') {
            return victimAffinityMod >= 0;
        }
        const chance = liveDebuffLandingChance(
            statusEngine,
            selfBuffLookup,
            actor,
            victim,
            victimAffinityMod
        );
        return debuffLandingGate(chance);
    };
    // Publish this turn's chance onto the runtime. It is a CAST-PATH value: the chance THIS actor's
    // own turn target resists, for THIS turn.
    //
    // ⚠️ WHAT THIS COMMENT USED TO SAY, and why both halves are now false. It read: "so the REACTIVE
    // (triggers.ts) path — which draws the OWNER's landing gate via
    // `owner.debuffLandingGate(owner.liveDebuffLandingChance ?? 1)` — uses the same live value.
    // Always set now (the live path is unconditional)."
    //  1. The reactive path no longer draws against this value. It resolves its OWN per-victim
    //     chance (`TriggerDrainContext.liveDebuffLandingChanceFor`) against the enemy it is actually
    //     inflicting on, and only falls back here when that resolver declines. Sharing a cast-derived
    //     number with the reactive path was the DEFECT, not the design: an enemy shoots Flamel, and
    //     the roll must be Flamel's hacking vs THAT ship's security, not vs whatever Flamel last
    //     aimed its own skill at.
    //  2. It is no longer unconditional — see the `hasVictim` guard on the line below.
    //
    // THE GUARD, and why it is load-bearing rather than tidy. ATTRIBUTION, so nobody reads this block
    // as the rung that added the conjunct: the `hasVictim` conjunct on the write below arrived with
    // SP-4c-2b (`f1bce838`), whose own review wave 1 labelled it "FIX 2". SP-4c-2d added only the
    // corrected commentary here and the `dynamicLanding.test.ts` fence named at the end of it. With no victim
    // `liveLandingChance` is correctly 0 ("there is no enemy whose security to beat"), but publishing
    // that 0 poisons every later reader of the field. That is precisely how the Flamel defect
    // happened — a real, previously-SHIPPED defect, not a hypothetical: an ally-targeted supporter
    // published 0 and its on-damaged retaliation then auto-resisted forever (measured on Flamel at
    // the time: 138 landings → 0). So a no-victim turn publishes NOTHING and the field keeps the
    // last chance this actor computed against a real victim.
    //
    // CURRENT STATUS (SP-4c-2d review wave 2) — a MEASURED-INERT BACKSTOP. SP-4c-2b gave the
    // reactive path its own per-victim resolver, and SP-4c-2d then deleted the victimless fallbacks
    // in triggers.ts, so no victimless reaction can reach the `?? owner.liveDebuffLandingChance`
    // tails there either. An earlier draft of this comment predicted the opposite — that 4c-2d would
    // change the resolver's fallbacks and re-arm this mine — and that prediction is FALSE: the rung
    // removed those fallbacks instead. Verified by mutation rather than argued: with the `hasVictim`
    // conjunct dropped, all 7 pre-existing test files that name `liveDebuffLandingChance` stay green
    // (96 tests). The accurate claim is CORPUS-INERT — no shape the suite can build reaches it — and
    // NOT "structurally unreachable": the field still has readers, and 24 of 148 shipped ships carry
    // the arming shape (an ally-side active target), so it is one refactor from mattering again.
    // Because an inert guard is exactly what a future simplification deletes unopposed, the line is
    // now fenced by `dynamicLanding.test.ts`'s 'a no-victim turn does not publish a landing chance'.
    //
    // ⚠️ THIS GUARD SURVIVED THE EPIC — do NOT sweep it alongside its (now removed) sibling. The
    // dummy-sentinel refusal in engine.ts's `reactiveLandingChanceFor` went DEAD the moment SP-4c-2d
    // deleted the dummy actor, because refusing that one actor's id was all it did, and 4c-2d deleted
    // it: an id naming no actor now takes the generic `!victim` return. This guard never mentioned the
    // dummy — its subject is a turn with NO victim, a shape SP-4c-2b created and which outlived the
    // dummy entirely. The two were inert for different reasons and only one of them expired.
    //
    // GUARD rather than DROP the write: the field still has readers (the reactive fallbacks), and
    // dropping it would push those rows from a real cast-derived chance to a flat `?? 1` — new
    // movement for no gain. The guard suppresses only the poisoned value.
    if (hasVictim) runtime.liveDebuffLandingChance = liveLandingChance;
    // Point the status engine's sourceFired landing hook at THIS actor's live closure for the
    // duration of this turn (it is invoked synchronously inside sourceFired below).
    statusEngine.setLandsTimedEnemyApplication((buff) =>
        landsTimedEnemyApplicationLive(buff.application)
    );

    // Per-round buff totals from the status engine. This actor notifies the
    // engine of its REAL fired slot this round (action-fed: scheduled timed
    // buffs key off the actual cadence, not a predicted schedule), then we read
    // the snapshot. No decrement here — that lives in each owner's Post Turn
    // (statusEngine.decrementPlayer/decrementEnemy, called after this actor's turn block).
    // sourceFired returns the buffNames of any TIMED enemy applications the
    // landing hook rejected this round (drawn once at application — Task 7).
    // NOTE: sourceFired(runtime.actor.id, …) is already correct for future team ids —
    // it applies that source's own manual lists.
    const { resistedEnemy: resistedScheduledTimedNames, appliedEnemy: appliedScheduledTimedNames } =
        statusEngine.sourceFired(actor.id, action === 'charged' ? 'charge' : 'active', r);
    // Emit debuff-applied ONCE per landed timed enemy application (discrete-infliction event).
    // This is this actor's scheduled timed debuffs path. The ability timed path emits below.
    // SP-4c-2b: fenced on the victim — the event names the victim that received the debuff, and a
    // no-victim turn has none. The list is provably empty there anyway: the landing hook sourceFired
    // just consulted (`landsTimedEnemyApplicationLive`) rejects every application with no victim.
    if (hasVictim) {
        for (const buffName of appliedScheduledTimedNames) {
            emitDebuffApplied(actor.id, buffName, enemy.id);
        }
    }
    const entry = statusEngine.snapshot(actor.id);

    // Effective crit rate from a given crit-buff total, clamped by affinity.
    // Gate/context estimates use representative scalars (byte-identical to pre-SP1). The actual
    // per-hit roll below uses realAffinityCappedCrit when deferAbilityPerformedToEngine.
    // SP-F F4: cap/penalty honour the forced-affinity override (effAffinity* equal the runtime
    // scalars when no override is active → byte-identical default).
    const cappedCrit = (critBuffTotal: number) =>
        Math.min(effAffinityCritCap, Math.max(0, crit + critBuffTotal - effAffinityCritPenalty));

    const realAffinityCappedCrit = (critBuffTotal: number) => {
        // SP-F F4: the anchor's real matchup, overridden when this cast forces affinity.
        // SP-4c-2b: with no victim there is no matchup, so this reads the neutral cap/penalty (see
        // affinityModsVsVictim). Inert on that path — no victim means no hit to roll a crit for.
        const { critCap, critPenalty } = affinityModsVsVictim(enemy);
        return Math.min(critCap, Math.max(0, crit + critBuffTotal - critPenalty));
    };

    // --- Scheduled (manual + team) statuses: same path as before ---
    // Scheduled self-buff names + totals.
    const scheduledSelfBuffNames = entry.activeSelfBuffs
        .filter((ab) => ab.stacks === undefined || ab.stacks > 0)
        .map((ab) => ab.buffName);
    // Layer 1 of the damage fold (scheduled manual + team self buffs). The accessor
    // (effectiveDamageStatsOf) recomputes ALL four layers from scheduledTotals +
    // abilitySelfEffects + modifiers, so the per-layer `+=` staging that used to live
    // here is gone — only critBuffForGates is staged, to feed the three mid-fold gate
    // estimates (cappedCrit) that read a partial crit total before the final fold.
    const scheduledTotals = resolveSelfBuffTotals({
        activeSelfBuffs: entry.activeSelfBuffs,
        selfBuffLookup,
    });
    // F3: fold the actor's pre-fight modifier baseline (squad leaders) into the layer-1
    // totals — outgoingDamage → outgoing-damage buff, outgoingHeal/incomingHeal → the heal
    // buffs. All three flow through effectiveDamageStatsOf into the existing consumers
    // (damage assembly, heal block, turnCtx, positionalScalars) with buff-channel semantics
    // (direct damage only; additive pct points). outgoingCritDamage is deliberately NOT
    // folded (crit-conditional damage modifier — consumed at the engine's crit-family
    // sites, never via critDamageBuff/effectiveDamageStatsOf). Absent → byte-identical.
    if (args.preFight) {
        scheduledTotals.outgoingDamageBuff += args.preFight.outgoingDamage;
        scheduledTotals.outgoingHealBuff += args.preFight.outgoingHeal;
        scheduledTotals.incomingHealBuff += args.preFight.incomingHeal;
    }
    // Partial crit-buff total for the gate estimates: starts at layer 1, then gains
    // layers 2+3 (abilityTotalsForGates) before the modifier gate at the modifierCtx.
    let critBuffForGates = scheduledTotals.critBuff;
    // I4a: parallel PRE-modifier critDAMAGE (crit power) estimate — layers 1+2+3, mirroring
    // critBuffForGates above. Feeds modifierCtx.selfCritPower (Wildfire's "for every 10%
    // crit power" dotDamage scaling) without a self-referential dependency on dmgStats
    // (which is computed FROM modifierCtx, further down). Exact for Wildfire (its own
    // ability only touches the dotDamage channel, never critDamage), same documented
    // approximation as critBuffForGates for any OTHER self-crit-gated modifier condition.
    let critDamageForGates = scheduledTotals.critDamageBuff;

    // Per-round landing roll, drawn ONCE and memoized across this round's
    // consumers (the RECURRING/aura partition, DoT landing, and — since SP-4b-2 D4, through
    // `scheduledEnemyEffects` — the positional per-victim damage read; a second draw would
    // let the reporting and damage channels disagree about the same debuff). Lazy so the
    // single draw is taken only when something actually needs it — TIMED
    // applications gate at application time and do NOT re-draw here, so a
    // round with no recurring/aura enemy content and no DoTs takes no draw
    // (preserving the deterministic schedule for application-only fixtures).
    let roundDebuffLandedValue: boolean | undefined;
    const roundDebuffLanded = (): boolean => {
        if (roundDebuffLandedValue === undefined) {
            roundDebuffLandedValue = debuffLandingGate(liveLandingChance);
        }
        return roundDebuffLandedValue;
    };

    // Partition the scheduled-status snapshot. TIMED scheduled statuses (numeric
    // turnsRemaining) already drew their landing roll at application — fold them
    // unconditionally. RECURRING/always/accumulating statuses ('recurring') are
    // conceptually re-applied each round — re-roll them via resolveEnemyDebuffs.
    const recurringEnemySnap = entry.activeEnemyDebuffs.filter(
        (ab) => ab.turnsRemaining === 'recurring'
    );
    const timedEnemySnap = entry.activeEnemyDebuffs.filter(
        (ab) => ab.turnsRemaining !== 'recurring'
    );
    const recurringEnemy = resolveEnemyDebuffs({
        // SP-4c-2b: a recurring/aura enemy debuff is conceptually re-applied to the opposing side
        // every round. With no victim it re-applies to nobody, so the fold is handed an EMPTY list:
        // nothing folds, nothing lands, nothing resists, and no landing draw is taken. Fencing the
        // INPUT (rather than the resist emit) is what makes "the clause does not happen" a single
        // code path — and it leaves the emit closure below unreachable on that path. Mirrors the
        // ability-sourced aura loop further down, which is fenced the same way.
        activeEnemyDebuffs: hasVictim ? recurringEnemySnap : [],
        enemyDebuffLookup,
        affinityDisadvantage: landingAtDisadvantage,
        roundDebuffLanded,
        emitResisted: (buffName) => {
            // Unreachable with no victim (empty input above). Guarded rather than defaulted so the
            // event can never name a phantom victim.
            if (hasVictim) emitDebuffResisted(buffName, enemy.id);
        },
        // No emitApplied: recurring/aura per-round re-applications are NOT discrete inflictions.
    });
    const timedScheduledEnemy = foldTimedEnemyDebuffs({
        timedEnemyDebuffs: timedEnemySnap,
        enemyDebuffLookup,
        // No emitApplied: timed debuffs already emitted debuff-applied at application time
        // (sourceFired appliedEnemy path). Per-round re-emission removed (Phase 3 retiming).
    });
    // Scheduled timed applications the landing hook rejected this round: synthesize
    // a resisted ActiveBuff carrying the would-be duration (skillDuration) and emit.
    // SP-4c-2b: with no victim there was nothing for a scheduled timed application to land ON, so
    // there is also nothing that RESISTED one — synthesizing resist rows and events here would
    // report a victim resisting a debuff when there is no victim. (The name list is non-empty on
    // that path only because `landsTimedEnemyApplicationLive` answers "does not land" for every
    // application; see its no-victim arm. It is still consulted below to SUPPRESS `control-applied`
    // for an enemy-targeted control, which is the correct outcome — nothing was controlled.)
    const resistedScheduledTimed: ActiveBuff[] = hasVictim
        ? synthesizeResisted(resistedScheduledTimedNames, enemyDebuffLookup, (buffName) =>
              emitDebuffResisted(buffName, enemy.id)
          )
        : [];
    // DELIBERATELY NOT FENCED ON THE VICTIM (SP-4c-2b, ruled by the owner at review): unlike the
    // recurring fold above, `foldTimedEnemyDebuffs` reads scheduled TIMED statuses already sitting
    // in the store, and on a no-victim turn `targetId` is undefined so the statusEngine resolves
    // them against DEFAULT_ENEMY_TARGET — i.e. they still fold from the phantom-target store. That
    // is accepted as-is: the side-wide scheduled `__enemy__` channel legitimately survives as a
    // modelling assumption, the fold is inert today (a no-victim cast deals no damage, so the only
    // reachable effect is the round's display list and `landedEnemyDebuffCount`), and fencing it
    // would risk unmeasured movement.
    // MEASURED, and the answer is ZERO. "Belongs to Task 5's measurement scope" is now discharged:
    // a console.error probe on this fold and on the `timedAbilityEnemy` loop below, run over the
    // WHOLE suite (531 files / 5,882 tests), fired 0 times — nothing folds from the phantom
    // `__enemy__` store on a no-victim turn anywhere. So the modelling assumption is not merely
    // sanctioned, it is unexercised, and this fold is provably a no-op on these turns.
    // The same ruling covers the `timedAbilityEnemy` loop further down (see its own note).
    //
    // Combined scheduled enemy effect/landed/resisted lists. Recurring/always/
    // accum first, then timed — matching the original snapshot() iteration order
    // (alwaysSnap, accumSnap, timed map) so the all-landing golden fixtures keep
    // byte-identical list ordering.
    const scheduledEnemy = {
        roundEnemyDebuffs: [
            ...recurringEnemy.roundEnemyDebuffs,
            ...timedScheduledEnemy.roundEnemyDebuffs,
        ],
        landedEnemyDebuffs: [
            ...recurringEnemy.landedEnemyDebuffs,
            ...timedScheduledEnemy.landedEnemyDebuffs,
        ],
        resistedEnemyDebuffs: [...recurringEnemy.resistedEnemyDebuffs, ...resistedScheduledTimed],
    };

    // --- In-loop ability statuses with live condition gating (Task 6) ---
    // Single forward pass (spec determinism rule): build a pre-application gate
    // context → gate+apply this round's TIMED enemy debuffs → recount → gate+apply
    // TIMED self buffs → collect effective ability statuses and fold their payloads
    // exactly where scheduled buffs fold.

    // "Already active" ability self statuses (window-persisting timed + accumulated)
    // are visible to the gate; auras are gated themselves, so they don't pre-seed names.
    const priorAbilitySelfNames = statusEngine
        .timedAbilityStatuses('self', actor.id)
        .map((s) => s.active.buffName);

    // (a) Pre-application gate context (before ability debuffs land). effectiveCritRate uses
    // the scheduled crit buff only (modifiers/ability buffs not yet folded), and NO roundCrit
    // — buff gates use the probability tier like modifierCtx. NOTE: a self-crit-gated buff
    // therefore resolves effectiveCritRate/100 > 0, i.e. passes whenever the crit rate is
    // non-zero — intended "live-subject, satisfiable" behaviour, not a bug.
    const preDebuffGateCtx = buildRoundContext({
        selfBuffNames: [...scheduledSelfBuffNames, ...priorAbilitySelfNames],
        landedEnemyDebuffCount: scheduledEnemy.landedEnemyDebuffs.length,
        corrosionEntryCount: corrosionEntries.length,
        infernoEntryCount: infernoEntries.length,
        bombCount: pendingBombs.length,
        genericCount: genericDoTEntries.length,
        enemyDotFamilyCounts: dotFamilyCounts(corrosionEntries, infernoEntries, genericDoTEntries),
        effectiveCritRate: cappedCrit(critBuffForGates),
        enemyType,
        enemyHpPct,
        // SP-4d: the entry counts above are all 0 on a no-victim turn (see the `corrosionEntries
        // = []` default note at this function's destructure), which is ALSO what a real victim
        // with no debuffs/DoTs looks like — the sum alone cannot tell the two apart. `hasVictim`
        // is the same discriminator every other victim-derived field in this ctx already uses
        // (victimStatGateCtx/victimShieldGateCtx below).
        noOpposingVictim: !hasVictim,
        selfHpPct: selfHpPctArg,
        targetHpPct: targetHpPctArg,
        targetRepairedThisRound: targetRepairedThisRoundArg,
        enemyBuffNames: enemyBuffNamesArg,
        enemyDebuffNames: enemyDebuffNamesArg,
        selfDebuffNames: selfDebuffNamesArg,
        turnsTaken: actor.turnsTaken,
        // SP-C: owner-vs-target stat comparison. REQUIRED here (not just at the payload
        // hard-gate `ctx` further down) — this is the gate for TIMED ENEMY DEBUFF application
        // (the `conditionsMet(status.conditions, preDebuffGateCtx)` check just below), which is
        // how Bayah's crit-power-gated Stasis INFLICT actually lands (the `type:'control'`
        // ability gated by the later `ctx` only drives the `control-applied` reaction event, not
        // the debuff status itself). Same live actor/enemy sourcing as `ctx` (team-symmetric,
        // DPS-safe); selfCritPower is a layer-1-only estimate here (critDamageForGates hasn't
        // folded layers 2+3 yet at this point in the turn) — matching this ctx's existing
        // effectiveCritRate, which is the same partial-fold convention.
        selfSpeed: actor.stats.speed,
        selfCurrentHp: actor.currentHp,
        selfCritPower: critDamage + critDamageForGates,
        // SP-4c-2b: omitted entirely when there is no victim — see victimStatGateCtx.
        ...victimStatGateCtx(enemy),
        // Ship-kit Wave 4, Task 3: the caster's own shield-presence gate, live-derived from
        // actor.shieldPool (SAME field/derivation as modifierCtx's selfShielded below) — REQUIRED
        // here because THIS ctx (not modifierCtx) gates the TIMED ENEMY DEBUFF application just
        // below (the `conditionsMet(status.conditions, preDebuffGateCtx)` check at :1476). APEX's
        // charged Disable ("If this Unit has Shield, the primary target is inflicted with
        // Disable") is a self-shield-gated NAMED debuff — without this field, selfShielded
        // defaults false here (buildRoundContext's DPS-safe default) and the debuff would never
        // land regardless of the caster's real shieldPool, which is just as wrong as the
        // original unconditional-inflict bug this task fixes.
        selfShielded: actor.shieldPool > 0,
        // Approximates max HP with the static base stat (`actor.stats.hp`), NOT the live
        // buff-inclusive value drain-time reads (engine.ts's isSelfShieldFull via
        // recipientMaxHp). This ctx is built before `dmgStats`/`effectiveHp` exist in the turn
        // (they're computed further down, :1878/:1987) and cannot be reordered here without
        // reordering the whole turn, which is out of scope. Consequence: an actor under an
        // active max-HP buff can read "full" here slightly EARLY (base HP is smaller than the
        // buffed HP, so the shieldPool>=threshold trips sooner). Inert today regardless — the
        // only shipped consumer of `self-shield-full` is the reactive end-of-turn drain path,
        // which reads the live value and is unaffected by this approximation. Left in place
        // (not deleted): dropping the field would make a future on-cast gate on this subject
        // silently never fire, which is worse than the approximation.
        selfShieldFull: actor.stats.hp > 0 && actor.shieldPool >= actor.stats.hp,
        // Malvex charged Barrier: the TARGET's shield-presence gate — derivation, PRE-strip reading
        // and the no-victim answer all documented on victimShieldGateCtx.
        ...victimShieldGateCtx(enemy),
    });

    // §4.5 Direct-damage Stasis break (B3 Task 2). Fires AFTER scheduled debuffs (sourceFired)
    // but BEFORE the ability timed-debuff loop, so a Stasis re-application from THIS attack's
    // debuff abilities is not inadvertently removed. The engine supplies `onHitBreakStasis` only
    // for direct-channel apply boundaries (non-positional and positional emitHit paths); DPS/
    // standalone callers leave it absent → no-op. Receives the resolved target id so the break
    // can key the statusEngine's per-actor enemy store correctly (side-symmetric: same key
    // regardless of whether the actor is a player or enemy).
    // Only fire when targetId is defined (the engine always supplies it for direct-channel
    // break-eligible turns; DPS/standalone callers without a real targetId are inert).
    if (targetId !== undefined) onHitBreakStasis?.(targetId);

    // (b) Gate + apply this round's firing-skill TIMED enemy debuff abilities.
    // Each application that passes its condition gate draws the landing decision here
    // (Task 7): 'apply' → lands unless affinity-disadvantaged (no draw); otherwise draws
    // the hacking-vs-security gate. Resisted → the apply is SKIPPED (no status stored),
    // recorded resisted with its would-be duration, and emitted. Landed → emit
    // debuff-applied at this infliction site (Phase 3 retiming).
    //
    // CARDINALITY (multi-hit full-walk epic, PR8): this draw is SUB-ATTACK 0's, not the
    // whole cast's. A multi-hit skill is N consecutive full attacks, so sub-attacks ≥ 1
    // re-roll every clause below against their OWN anchor and footprint, via
    // `applyDebuffsForSubAttack` (defined after this loop, driven by the engine's
    // sub-attack boundary hooks). Reading this block as "the cast's one landing decision"
    // is only correct at N=1. The condition GATE, the resist bookkeeping and the
    // `control-applied` gating below do stay cast-time — see `perSubAttackDebuffRecipes`
    // and `resistedTimedEnemyNames` for why each has to.
    const resistedAbilityTimedEnemy: ActiveBuff[] = [];
    // Debuffs THIS actor discretely inflicted on the target this turn (source-accurate
    // attribution for the enemy-effects overview — Task 10a). Unlike landedEnemyDebuffs,
    // which reflects the whole per-target window (shared across all attackers of one target),
    // this captures only the applications THIS actor made at their own infliction sites.
    // Seed with the newly-applied SCHEDULED timed enemy debuffs (this actor's own manual
    // lists, owner-scoped): the intersection of the window snapshot with the names that fired
    // this turn (appliedScheduledTimedNames). Empty for enemy attackers (no manual debuffs).
    const appliedScheduledSet = new Set(appliedScheduledTimedNames);
    const inflictedEnemyDebuffs: ActiveBuff[] = scheduledEnemy.landedEnemyDebuffs.filter((ab) =>
        appliedScheduledSet.has(ab.buffName)
    );
    // Buff NAMES of the ability-timed enemy debuffs the landing decision REJECTED this cast (the
    // condition gate passed but the application was resisted — by affinity disadvantage, the
    // landing-roll gate, or Block-Debuff immunity, since landsTimedEnemyApplicationLive folds all
    // three). Unioned with the scheduled-path resisted names below to gate the control-applied
    // emission: a control whose paired named status was RESISTED must NOT emit a success event
    // (Finding 1). A control with NO paired named status leaves this set empty for that name, so it
    // still emits (only Block-Debuff immunity gates a standalone control — preserved separately).
    const resistedTimedEnemyNames: string[] = [];
    // Landings held back by intra-cast clause order (see the `afterDamageClause` branch below).
    // Returned on the turn result. PR8: the engine drains this at ONE of two points — at the end of
    // sub-attack 0 when a later sub-attack exists (so hit 2 can see hit 1's stack), otherwise at the
    // historical post-walk `flushDeferredEnemyApplications`. Both run before the actor's Post-Turn
    // decrement, so either way the status keeps its normal window.
    const deferredEnemyApplications: DeferredEnemyApplication[] = [];

    /**
     * Roll + apply ONE timed enemy status over one recipient list. Extracted from the cast-time
     * loop (multi-hit full-walk epic, PR8) so sub-attacks ≥ 1 re-run the IDENTICAL body against
     * their own anchor and footprint — a second copy is how the two paths would drift on the
     * resist bookkeeping or the display refresh.
     *
     * `collect`: when supplied, a landing's pair (landed OR resisted) is pushed here instead of
     * being applied/emitted inline, and `applyState` is NOT run by this function — the caller owns
     * both halves' timing. When absent (the cast-time path) behaviour is exactly pre-PR8: a
     * before-damage clause applies inline, an after-damage clause is pushed to the deferred list
     * unapplied.
     *
     * Cast-time inline note: the inline (before-damage, `collect` absent) branch deliberately does
     * NOT call `pair.applyState` — it performs the raw store write directly instead. `applyState`
     * also re-reads the live status to refresh the `landedEnemyDebuffs` DISPLAY list, closing over
     * the `const landedEnemyDebuffs` declared further down this function (after `landedAbilityEnemy`
     * is computed from a POST-write store read, which is what already carries an inline write into
     * the round's display list without any refresh). Calling `pair.applyState` from inside this
     * loop — before that later declaration runs — would throw (TDZ). It is safe only for the
     * deferred/collect callers (`flushDeferredEnemyApplications`, `applyDebuffsForSubAttack`),
     * which always run after runPlayerTurn has returned.
     */
    const landStatusOnRecipients = (
        status: TimedStatus,
        recipientIds: (string | undefined)[],
        collect?: DeferredEnemyApplication[]
    ): void => {
        let anyLanded = false;
        for (const vid of recipientIds) {
            // SP-4c-2b: the anchor fallback arm is dropped when there is no victim — with no victim
            // there is no anchor id for a vid to match, and the `vid === undefined` (non-positional
            // anchor) arm resolves nobody.
            const victim =
                vid !== undefined
                    ? (opposingVictimById?.get(vid) ??
                      (hasVictim && vid === enemy.id ? enemy : undefined))
                    : enemy;
            const usePerVictim =
                positionalLanding && opposingVictimById != null && vid !== undefined;
            if (usePerVictim && victim === undefined) continue;
            const resolvedVictim = victim ?? enemy;
            // SP-4c-2b: nobody to inflict this status on — neither landed nor resisted (a resist
            // implies a target that resisted it). Unreachable today AND on a no-victim turn from the
            // cast-time caller, whose enclosing loop is fenced on `hasVictim`; this keeps the
            // function total for the deferred/sub-attack callers too.
            if (resolvedVictim === undefined) continue;
            const emitTargetId = vid ?? resolvedVictim.id;

            const lands = usePerVictim
                ? landsDebuffOnVictim(status.payload.application, resolvedVictim)
                : landsTimedEnemyApplicationLive(status.payload.application);

            if (lands) {
                // Intra-cast clause order: a clause that follows a damage clause in this same slot
                // must not be in the store while that damage resolves. Since PR8 the unit of
                // "that damage" is the SUB-ATTACK, not the cast.
                // NOT deferred:
                //  - the LANDING decision for sub-attack 0 (drawn at the cast-time call site) — so
                //    its RNG draw order and the resist bookkeeping below, which gates this turn's
                //    control-applied emission, are untouched;
                //  - `inflictedEnemyDebuffs`, a record of what THIS cast inflicted rather than of
                //    store state. The §4.5 Stasis-break re-inflict check reads it back before the
                //    flush runs (engine, `reInflictedStasis`); deferring the row let that check
                //    conclude "not re-inflicted" and shave a turn off a freshly applied Stasis.
                // Single source of truth for the store write — both the deferred `applyState`
                // path and the cast-time inline branch below call this instead of each keeping
                // their own copy of `statusEngine.applyTimedAbilityStatus(...)` (a second copy is
                // exactly how the two paths would drift, per the doc comment above).
                const writeState = (): void => {
                    statusEngine.applyTimedAbilityStatus(r, status, actor.id, vid);
                };
                // DISPLAY ONLY: the round's reported enemy-debuff window
                // (RoundData.activeEnemyDebuffs, sourced from `landedEnemyDebuffs`) is
                // assembled below, BEFORE this write runs — so re-read this status and
                // add/refresh its row. Without it a debuff the cast really did apply is
                // missing from the round it landed in, and a persistent-stacking family
                // reports one stack short. With N sub-attacks that shortfall multiplies,
                // which is why the refresh re-reads the LIVE stack count every time rather
                // than incrementing. Touches ONLY the display list: the modifier fold
                // (`roundEnemyDebuffs`) and every gate ctx are already computed, which is
                // exactly the rule — this sub-attack's own damage and its later clauses
                // must not see the status. Referencing a `const` declared further down is
                // safe only because `applyState` is never invoked from inside `runPlayerTurn`
                // — the inline branch calls `writeState` directly for exactly this reason.
                const refreshDisplayRow = (): void => {
                    const live = statusEngine
                        .timedAbilityStatuses('enemy', actor.id, vid ?? targetId)
                        .find((s) => s.payload.buffName === status.payload.buffName);
                    if (live) {
                        const at = landedEnemyDebuffs.findIndex(
                            (b) => b.buffName === live.active.buffName
                        );
                        if (at >= 0) landedEnemyDebuffs[at] = live.active;
                        else landedEnemyDebuffs.push(live.active);
                    }
                };
                const pair: DeferredEnemyApplication = {
                    applyState: () => {
                        writeState();
                        refreshDisplayRow();
                    },
                    emitEvents: () => {
                        emitDebuffApplied(actor.id, status.payload.buffName, emitTargetId);
                    },
                };
                if (collect) {
                    collect.push(pair);
                } else if (status.afterDamageClause === true) {
                    deferredEnemyApplications.push(pair);
                } else {
                    // Cast-time inline apply: EXACTLY pre-PR8 — the raw write plus the discrete
                    // emit, without the display-list refresh (see the TDZ note above pair).
                    writeState();
                    pair.emitEvents();
                }
                if (!anyLanded) {
                    inflictedEnemyDebuffs.push({
                        buffName: status.payload.buffName,
                        turnsRemaining: status.duration,
                    });
                }
                anyLanded = true;
            } else if (collect) {
                // A later sub-attack's resist: the event still fires, but buffered like its
                // landed sibling so the log row it attaches to is that sub-attack's own.
                collect.push({
                    applyState: () => {},
                    emitEvents: () => emitDebuffResisted(status.payload.buffName, emitTargetId),
                });
            } else {
                emitDebuffResisted(status.payload.buffName, emitTargetId);
            }
        }

        // Resist bookkeeping is CAST-TIME only. It gates this turn's control-applied emission
        // (below), which is emitted before any sub-attack ≥ 1 has rolled — a later sub-attack's
        // resist cannot retroactively suppress an event that already fired, and adding it here
        // would double-count the name in the round's display list.
        if (!collect && !anyLanded && recipientIds.length > 0) {
            resistedAbilityTimedEnemy.push({
                buffName: status.payload.buffName,
                turnsRemaining: status.duration,
            });
            resistedTimedEnemyNames.push(status.payload.buffName);
        }
    };

    /**
     * The condition-gated direct debuff clauses of THIS cast, captured for replay on sub-attacks
     * ≥ 1 (multi-hit full-walk epic, PR8).
     *
     * DELIBERATE SCOPE LINE: the recipe carries the RESULT of the cast-time
     * `conditionsMet(status.conditions, preDebuffGateCtx)` gate, not the conditions themselves.
     * Re-evaluating per sub-attack means rebuilding `preDebuffGateCtx` (~30 live-sourced fields,
     * built earlier in this function) inside the hit loop; that is a separate change. Consequence:
     * a clause gated on state the cast itself changes (e.g. the victim's HP%) is judged once, at
     * cast time, for all N sub-attacks.
     */
    const perSubAttackDebuffRecipes: {
        status: TimedStatus;
        abTarget: Ability['target'] | undefined;
    }[] = [];

    for (const status of timedEnemyBySlot) {
        if (status.sourceSlot !== action) continue;
        // SP-4c-2b: an enemy-debuff clause needs an enemy. With no victim this whole clause does not
        // happen: nothing is inflicted, nothing is resisted (a resist implies a target that resisted
        // it), and no landing draw is taken. Fenced at the CLAUSE, not at the emit — a guard further
        // in would produce a debuff-applied/debuff-resisted event naming no victim.
        if (!hasVictim) continue;
        if (!conditionsMet(status.conditions, preDebuffGateCtx)) continue;

        const matchingAbility = firingSkill?.abilities.find(
            (a) => a.config.type === 'debuff' && a.config.buffName === status.payload.buffName
        );
        // Ship-kit W5 Task A3 introduced the 'adjacent-enemies' / 'target-and-adjacent-enemies'
        // board-neighbour fan-out (`adjacentEnemyIdsFor`, supplied by engine.ts's buildTurnArgs —
        // team-symmetric via bySide). That mapping is no longer written here: PR8 Task 1 moved the
        // whole nine-branch ternary into ./debuffRecipients, whose JSDoc is now the one place it is
        // described (including why a positional caller gets [] rather than the non-positional
        // `undefined` sink). Do not restate the branch rules here — two copies is exactly how the
        // cast-time and per-sub-attack paths would drift.
        const abTarget = matchingAbility?.target;
        // PR8 Task 1: the nine-branch mapping now lives in ./debuffRecipients so the
        // per-sub-attack path (PR8 Task 3) resolves recipients by exactly the same rules,
        // keyed off ITS OWN re-resolved anchor and footprint instead of the cast's.
        const recipientIds: (string | undefined)[] = resolveDebuffRecipientIds({
            abTarget,
            anchorId: targetId,
            aoeVictimIds,
            adjacentEnemyIdsFor,
            positionalLanding,
        });

        landStatusOnRecipients(status, recipientIds);
        if (positionalLanding) perSubAttackDebuffRecipes.push({ status, abTarget });
    }

    /** PR8: sub-attacks ≥ 1 re-roll every gated clause against their own anchor + footprint. */
    const applyDebuffsForSubAttack = (
        sub: { index: number; anchorId: string; victimIds: string[] },
        phase: 'before-damage' | 'after-damage'
    ): DeferredEnemyApplication[] => {
        const collected: DeferredEnemyApplication[] = [];
        for (const { status, abTarget } of perSubAttackDebuffRecipes) {
            const isAfter = status.afterDamageClause === true;
            if (isAfter !== (phase === 'after-damage')) continue;
            const before = collected.length;
            landStatusOnRecipients(
                status,
                resolveDebuffRecipientIds({
                    abTarget,
                    anchorId: sub.anchorId,
                    // THIS sub-attack's real footprint, not the cast's — so an `all-enemies`
                    // clause fans over who it actually struck and a killed victim drops out.
                    aoeVictimIds: sub.victimIds,
                    adjacentEnemyIdsFor,
                    positionalLanding: true,
                }),
                collected
            );
            // Write THIS clause's landings before the next clause resolves, mirroring the cast-time
            // path — where a before-damage clause applies inline and after-damage clauses run
            // sequentially at the flush, so clause 2 always evaluates against clause 1's store
            // write. Collecting every pair and applying afterwards would make sub-attacks >= 1
            // asymmetric with sub-attack 0 for a cast carrying two same-phase debuff clauses:
            // clause 2's landing roll reads the victim's live status (the Block-Debuff gate in
            // `landsDebuffOnVictim`), so it must see what clause 1 just applied. Latent today —
            // no corpus ship has that shape (CodeRabbit, PR #314).
            for (let i = before; i < collected.length; i++) collected[i].applyState();
        }
        return collected;
    };

    // Caster-ctx resolver (Task 5): activeAbilityStatuses gates each aura/accum against ITS
    // CASTER's context. For the acting actor's OWN statuses (casterId === actor.id) the resolver
    // returns the local round ctx — byte-identical to the pre-Task-5 single-ctx call, so the
    // attacker-only path (where every casterId is the attacker) is zero-churn. For a FOREIGN
    // caster (an ally-cast aura sitting on this actor's side) it builds that caster's ctx from
    // its own snapshot + the shared enemy state, MEMOIZED per caster for this turn (cheap: one
    // snapshot read per distinct foreign caster). effectiveCritRate is 0 for foreign casters
    // (the per-round crit fold is local-only). The foreign ctx is independent of which local ctx
    // is passed, so one memo serves both the enemy-side (preDebuff) and self-side (postDebuff)
    // resolvers below.
    const foreignCtxMemo = new Map<string, ConditionContext>();
    const foreignCasterCtx = (casterId: string): ConditionContext => {
        let c = foreignCtxMemo.get(casterId);
        if (!c) {
            c = buildActorConditionContext(statusEngine, casterId, {
                corrosionEntryCount: corrosionEntries.length,
                infernoEntryCount: infernoEntries.length,
                bombCount: pendingBombs.length,
                genericCount: genericDoTEntries.length,
                enemyDotFamilyCounts: dotFamilyCounts(
                    corrosionEntries,
                    infernoEntries,
                    genericDoTEntries
                ),
                enemyType,
                enemyHpPct,
                // Include the foreign caster's ability-sourced self statuses (e.g. its self-granted
                // gate buffs) so its own aura's gate sees them — matches the local priorAbilitySelfNames.
                includeAbilitySelfNames: true,
                // SP-4d: this ctx gates the FOREIGN caster's OWN enemy-side aura/accum ability
                // against whether IT currently applies to THIS actor's resolved victim this turn
                // (it feeds `activeAbilityStatuses('enemy', resolveCtx(...), actor.id, targetId)`
                // below) — so the relevant "opposing victim" is the ACTING actor's own `hasVictim`,
                // the same discriminator the local (non-foreign) contexts in this function use.
                noOpposingVictim: !hasVictim,
            });
            foreignCtxMemo.set(casterId, c);
        }
        return c;
    };
    const resolveCtx =
        (localCtx: ConditionContext) =>
        (casterId: string): ConditionContext =>
            casterId === actor.id ? localCtx : foreignCasterCtx(casterId);

    // Enemy-side ability statuses active this round, split by kind (Task 7):
    //  - TIMED (timedAbilityStatuses): already gated at application above; they
    //    persist their window unconditionally → folded WITHOUT a landing re-roll.
    //  - aura/accumulating (activeAbilityStatuses): conceptually re-applied each
    //    round → KEEP the per-round landing re-roll, with application respected.
    const timedAbilityEnemy = statusEngine.timedAbilityStatuses('enemy', actor.id, targetId);
    const recurringAbilityEnemy = statusEngine.activeAbilityStatuses(
        'enemy',
        resolveCtx(preDebuffGateCtx),
        actor.id,
        targetId
    );
    const landedAbilityEnemy: ActiveBuff[] = [];
    const resistedAbilityEnemy: ActiveBuff[] = [...resistedAbilityTimedEnemy];
    const abilityEnemyEffects: SelectedGameBuff[] = [];
    // Timed ability statuses: unconditionally landed (gated at application in the timed
    // loop above). NO debuff-applied here — already emitted at the application site above
    // (Phase 3 retiming: discrete-infliction-only, not per-round while the window is active).
    // DELIBERATELY NOT FENCED ON THE VICTIM (SP-4c-2b, ruled by the owner at review): with no victim
    // `targetId` is undefined, so `timedAbilityStatuses` above read the DEFAULT_ENEMY_TARGET store
    // and this loop still folds those statuses. Accepted as-is for the same three reasons as the
    // scheduled-timed fold (see the note above `scheduledEnemy`): the side-wide `__enemy__` channel
    // is a sanctioned modelling assumption, the fold is inert today, and fencing it risks unmeasured
    // movement. MEASURED at zero over the whole suite — see the full note above `scheduledEnemy`,
    // which carries the probe result for both folds. Do not fence it here.
    for (const s of timedAbilityEnemy) {
        landedAbilityEnemy.push(s.active);
        abilityEnemyEffects.push(payloadToSelectedBuff(s.payload));
    }
    // Aura/accumulating ability statuses: per-round landing re-roll. No debuff-applied
    // (recurring/aura re-applications are NOT discrete inflictions — Phase 3 retiming).
    // SP-4c-2b: an aura debuff is conceptually re-applied to the opposing side every round. With no
    // victim it re-applies to nobody, so it neither lands (no effect folded, no display row) nor
    // resists (no debuff-resisted event naming no victim) and takes no landing draw. Fenced at the
    // LOOP rather than at the emit, for the same reason the cast-time timed loop above is.
    if (hasVictim) {
        for (const s of recurringAbilityEnemy) {
            const sb = payloadToSelectedBuff(s.payload);
            const isApply = sb.application === 'apply';
            const lands = isApply ? !landingAtDisadvantage : roundDebuffLanded();
            if (!lands) {
                resistedAbilityEnemy.push(s.active);
                emitDebuffResisted(s.payload.buffName, enemy.id);
                continue;
            }
            landedAbilityEnemy.push(s.active);
            abilityEnemyEffects.push(sb);
        }
    }

    // Combined landed enemy debuffs (scheduled + ability) drive modifiers and counts.
    // Ability entries appended AFTER scheduled (KNOWN-DIFF c ordering).
    const roundEnemyDebuffs = [...scheduledEnemy.roundEnemyDebuffs, ...abilityEnemyEffects];
    const landedEnemyDebuffs = [...scheduledEnemy.landedEnemyDebuffs, ...landedAbilityEnemy];
    // Resisted enemy debuffs sourced from THIS player actor's turn (scheduled + ability).
    // The caller prepends any team-turn resisted entries staged before this turn.
    const resistedEnemyDebuffs = [...scheduledEnemy.resistedEnemyDebuffs, ...resistedAbilityEnemy];
    const { enemyDefenseModifier, incomingDamageModifier } = toEnemyModifiers(roundEnemyDebuffs);

    // (c) Recount with ability debuffs landed → postDebuffGateCtx.
    // (d) Gate + apply this round's firing-skill TIMED self buff abilities vs postDebuffGateCtx.
    const postDebuffGateCtx = buildRoundContext({
        selfBuffNames: [...scheduledSelfBuffNames, ...priorAbilitySelfNames],
        landedEnemyDebuffCount: landedEnemyDebuffs.length,
        corrosionEntryCount: corrosionEntries.length,
        infernoEntryCount: infernoEntries.length,
        bombCount: pendingBombs.length,
        genericCount: genericDoTEntries.length,
        enemyDotFamilyCounts: dotFamilyCounts(corrosionEntries, infernoEntries, genericDoTEntries),
        effectiveCritRate: cappedCrit(critBuffForGates),
        enemyType,
        enemyHpPct,
        // SP-4d: see preDebuffGateCtx's matching note above — same `hasVictim` discriminator.
        noOpposingVictim: !hasVictim,
        selfHpPct: selfHpPctArg,
        targetHpPct: targetHpPctArg,
        targetRepairedThisRound: targetRepairedThisRoundArg,
        enemyBuffNames: enemyBuffNamesArg,
        enemyDebuffNames: enemyDebuffNamesArg,
        selfDebuffNames: selfDebuffNamesArg,
        turnsTaken: actor.turnsTaken,
        // Approximates max HP with the static base stat (`actor.stats.hp`), same limitation and
        // same reasoning as preDebuffGateCtx above (:1461) — this ctx is also built before
        // `dmgStats`/`effectiveHp` exist in the turn (computed further down, :2055/:2056) and
        // cannot be reordered here without reordering the whole turn, which is out of scope.
        // THIS is the ctx that matters for the subject: the per-slot timed-SELF-buff loop just
        // below (`timedSelfBySlot`, gated via `conditionsMet(status.conditions, postDebuffGateCtx)`
        // at :1763) is what fires an ON-CAST ability gated on `self-shield-full` (Quixilver R2's
        // shape, e.g. a charge/active-slot "if this Unit has Shield equal to 100% of its max HP"
        // grant). Without this field, selfShieldFull defaults false here (buildRoundContext's
        // DPS-safe default) and such a cast-path grant would be permanently suppressed regardless
        // of the caster's real shieldPool — the same silent-failure class the sibling fields in
        // the other three contexts already guard against.
        selfShieldFull: actor.stats.hp > 0 && actor.shieldPool >= actor.stats.hp,
        // Malvex charged Barrier: the TARGET's shield-presence gate (see victimShieldGateCtx). Note
        // `selfShielded` is still absent from THIS ctx (its only consumers gate enemy debuffs /
        // modifiers / payload abilities instead) — but `selfShieldFull` above IS populated here,
        // unlike the other two absent-sibling notes elsewhere in this function: this is the one ctx
        // a firing-slot timed self-buff actually gates on.
        ...victimShieldGateCtx(enemy),
    });
    for (const status of timedSelfBySlot) {
        if (status.sourceSlot !== action) continue;
        // The gate evaluates against THIS CASTER's post-debuff ctx (the status belongs to the
        // acting runtime — postDebuffGateCtx IS the caster's context). Once it passes, the status
        // is applied to EVERY recipient (Task 5): self → [caster]; ally/all-allies → all players.
        // The status lives on each recipient (decrements at the recipient's Post Turn; family +
        // persistent rules run per recipient side because applyTimedAbilityStatus threads
        // recipientId). buff-applied emits ONCE PER RECIPIENT with the recipient's actorId, with
        // the granter riding alongside in `granterId`.
        if (!conditionsMet(status.conditions, postDebuffGateCtx)) continue;
        // recipients is set by the engine helper for every timed-by-slot status; default to
        // [actor.id] (self routing) for any caller that omitted it (statusEngine fixtures).
        for (const rid of supportRecipients('all-allies', status.recipients ?? [actor.id])) {
            // Block Buff: a recipient carrying it cannot receive new buffs. Covers self-buffs,
            // single-ally grants, and all-allies grants (each recipient guarded independently);
            // covers BOTH sides (enemies run this same path). Silent skip — no buff-applied emit.
            if (recipientCarriesBlockBuff(statusEngine, rid)) continue;
            // Barrier Recharging: mirrors triggers.ts's reactive-path gate (same two arms — see
            // that comment for why both exist). Malvex/Sansi/Panon's charge-slot "Barrier for 1
            // hit" grants ride THIS loop (sourceSlot 'charge' is `action` here), so without this
            // gate a live lockout was only ever enforced on the reactive path, not the cast path.
            if (
                (BARRIER_BUFFS.has(status.payload.buffName) ||
                    status.payload.buffName === BARRIER_RECHARGING) &&
                holdsBarrierRecharging(statusEngine, rid)
            ) {
                continue;
            }
            statusEngine.applyTimedAbilityStatus(r, status, rid);
            bus.emit({
                type: 'buff-applied',
                actorId: rid,
                granterId: status.casterId ?? actor.id,
                round: r,
                buffName: status.payload.buffName,
                duration: status.duration,
            });
        }
    }

    // (e) Effective self ability statuses this round (timed in-window + auras +
    // accumulating), gated vs postDebuffGateCtx. Fold their payloads into the self totals
    // exactly where scheduled buffs fold (toSimBuffs semantics).
    const selfAbilityStatuses: ActiveAbilityStatus[] = [
        ...statusEngine.timedAbilityStatuses('self', actor.id),
        ...statusEngine.activeAbilityStatuses('self', resolveCtx(postDebuffGateCtx), actor.id),
    ];
    const abilitySelfEffects = selfAbilityStatuses.map((s) => payloadToSelectedBuff(s.payload));
    // Stage layers 2+3 into the gate-only crit partial so the modifier gate (modifierCtx,
    // below) sees layers 1+2+3 — matching the pre-A1b staged critBuff at that point. The
    // full four-layer fold (and the other channels) is owned by effectiveDamageStatsOf.
    const abilityTotalsForGates = calculateBuffTotals(toSimBuffs(abilitySelfEffects));
    critBuffForGates += abilityTotalsForGates.critBuff;
    critDamageForGates += abilityTotalsForGates.critDamageBuff;

    // Snapshot lists for this round / context: ability statuses appended AFTER
    // scheduled ones (KNOWN-DIFF c ordering).
    const abilitySelfActive = selfAbilityStatuses.map((s) => s.active);
    const activeSelfBuffsForRound = [...entry.activeSelfBuffs, ...abilitySelfActive];
    // Self-buff names visible to the condition engine (modifiers, payload abilities,
    // both buildRoundContext calls below). Includes ability self statuses now.
    const activeSelfBuffNames = activeSelfBuffsForRound
        .filter((ab) => ab.stacks === undefined || ab.stacks > 0)
        .map((ab) => ab.buffName);

    // Fold active passive modifiers (firing skill + passive slot) into the round's
    // buff totals so they affect damage exactly like an equivalent buff. Folded here,
    // after enemy modifiers are known but before the effective-stat computations consume
    // the buff totals. The PRE-modifier crit estimate (cappedCrit(critBuffForGates), layers
    // 1+2+3) is used only for the rare self-crit-gated modifier condition, avoiding a
    // self-referential gate.
    const modifierCtx = buildRoundContext({
        selfBuffNames: activeSelfBuffNames,
        landedEnemyDebuffCount: landedEnemyDebuffs.length,
        corrosionEntryCount: corrosionEntries.length,
        infernoEntryCount: infernoEntries.length,
        bombCount: pendingBombs.length,
        genericCount: genericDoTEntries.length,
        enemyDotFamilyCounts: dotFamilyCounts(corrosionEntries, infernoEntries, genericDoTEntries),
        effectiveCritRate: cappedCrit(critBuffForGates),
        enemyType,
        enemyHpPct,
        // SP-4d: see preDebuffGateCtx's matching note above — same `hasVictim` discriminator.
        noOpposingVictim: !hasVictim,
        selfHpPct: selfHpPctArg,
        targetHpPct: targetHpPctArg,
        targetRepairedThisRound: targetRepairedThisRoundArg,
        enemyBuffNames: enemyBuffNamesArg,
        enemyDebuffNames: enemyDebuffNamesArg,
        selfDebuffNames: selfDebuffNamesArg,
        selfShielded: actor.shieldPool > 0,
        // Approximates max HP with the static base stat, same limitation as preDebuffGateCtx
        // above (:1470) — but here it is a hard dependency ordering, not just "not yet
        // computed": this ctx is threaded into effectiveDamageStatsOf as `modifierCtx`, which
        // gates `modifierAbilities` and folds the result into `mod.hp` → `dmgStats.hp` →
        // `effectiveHp` (:1878/:1987 below). Reading `effectiveHp` here would be circular —
        // exactly the self-referential-gate class the PRE-modifier `critBuffForGates` estimate
        // above (layers 1+2+3, see the comment two above this ctx) exists to avoid for crit.
        // Consequence: an actor under an active max-HP buff can read "full" here slightly
        // EARLY. Inert today regardless — the only shipped consumer of `self-shield-full` is
        // the reactive end-of-turn drain path (engine.ts's isSelfShieldFull), which reads the
        // live recipientMaxHp value and never sees this ctx. Left in place (not deleted):
        // dropping the field would make a future on-cast modifier gate on this subject
        // silently never fire, which is worse than the approximation.
        selfShieldFull: actor.stats.hp > 0 && actor.shieldPool >= actor.stats.hp,
        // Malvex charged Barrier: the TARGET's shield-presence gate (see victimShieldGateCtx). No
        // corpus MODIFIER ability gates on this subject today; populated for the same reason its
        // `selfShielded` neighbour is — an absent field makes a future gate on this ctx silently
        // never fire, which is worse than a field nothing reads yet.
        ...victimShieldGateCtx(enemy),
        turnsTaken: actor.turnsTaken,
        // Sub-project I, PR I5: only the modifier ctx needs this — it feeds
        // modifierAbilities/modifierTotalsFromAbilities (Selenite's count-scaling passive).
        // The I2 per-victim re-fold spreads this ctx unchanged (only enemyDebuffNames/
        // enemyBuffNames/enemyHpPct are swapped per victim), so it naturally stays constant
        // across the delta computation — no per-victim distribution, matching the design
        // (this is a global count, not a per-target gate).
        stealthedEnemyCount: stealthedEnemyCountArg,
        // Sub-project I, PR I4a: the acting unit's own live crit power (Wildfire's
        // dotDamage scaling source). Only modifierCtx needs it — same "only the modifier
        // ctx needs this" rationale as stealthedEnemyCount above. critDamageForGates is the
        // PRE-modifier (layers 1+2+3) estimate; see its declaration for why layer 4 is
        // deliberately excluded (self-referential-gate avoidance, mirrors critBuffForGates).
        selfCritPower: critDamage + critDamageForGates,
    });
    const passiveSkill = shipSkills.slots.find((s) => s.slot === 'passive');
    // Sub-project I, PR I3 (Layer 1): distributed all-allies auras (Lodolite/Panguan-shape)
    // append AFTER this actor's own firing + passive abilities — array order only affects
    // scaling-condition positional context (ctxFor in gateFiringAbilities, which this list
    // does not feed), so ordering is inert here; every ability folds independently in
    // modifierTotalsFromAbilities. Defaults to [] (pre-I3 callers / no ally aura present)
    // → byte-identical.
    const selfModifierAbilities = [
        ...(firingSkill?.abilities ?? []),
        ...(passiveSkill?.abilities ?? []),
    ];
    const modifierAbilities = [...selfModifierAbilities, ...(args.allyModifierAbilities ?? [])];
    // Sub-project I, PR I4b/I4c: pull the enemy-status-name-gated dotDamage abilities
    // (Wildfire's Scorching Radiation crit-power bonus) OUT of the abilities fed to the
    // cast-time fold below — they must be re-evaluated per VICTIM per TICK against that
    // victim's own live status (turnCtx.victimGatedDotDamage, resolved in engine.ts's
    // tickDoTs), not baked once against the primary target. `dotDamageUnconditional` is
    // derived from the FULL flat list (self + every ally aura source) so it correctly
    // excludes name-gated dotDamage from EITHER provenance — carries every OTHER ability
    // unchanged (all channels, plus any non-name-gated dotDamage source e.g. Decimation set
    // gear); for every ship without such a modifier this equals `modifierAbilities` and the
    // fold below is byte-identical to before.
    //
    // I4c: the CONDITIONAL half is no longer taken from the flat list, because the flat list
    // loses PROVENANCE (self vs. which ally sourced it) — and the locked game rule requires
    // Wildfire's team-aura bonus to scale by the SOURCE's crit power, not the recipient's
    // (`modifierCtx.selfCritPower` below is the RECIPIENT's). Instead: this actor's OWN
    // conditional dotDamage (unchanged from I4b — ctx = modifierCtx) is partitioned from
    // `selfModifierAbilities` ALONE, and each ally aura source contributes its OWN entry,
    // partitioned from JUST that source's abilities, with `selfCritPower` swapped to that
    // source's own live crit power. No double-apply: a given ability object is folded via
    // AT MOST one of {dotDamageUnconditional, the self entry, one ally-source entry} — the
    // flat-list `unconditional` split above already removes every name-gated ability
    // (self AND ally) from the general fold, and each ally source's abilities are
    // partitioned in isolation (one source's list can't leak into another's or into self's).
    const { unconditional: dotDamageUnconditional } =
        partitionDotDamageAbilities(modifierAbilities);
    const selfDotDamageConditional = partitionDotDamageAbilities(selfModifierAbilities).conditional;
    const allyDotDamageGated = (args.allyDotDamageAuraSources ?? [])
        .map((src) => ({
            abilities: partitionDotDamageAbilities(src.abilities).conditional,
            ctx: { ...modifierCtx, selfCritPower: src.sourceCritPower },
        }))
        .filter((entry) => entry.abilities.length > 0);
    const victimGatedDotDamage = [
        ...(selfDotDamageConditional.length > 0
            ? [{ abilities: selfDotDamageConditional, ctx: modifierCtx }]
            : []),
        ...allyDotDamageGated,
    ];
    // Final four-layer effective-stat fold (layer 1 scheduledTotals + layers 2+3
    // abilitySelfEffects + layer 4 modifierAbilities gated by modifierCtx). The accessor
    // reproduces the prior inline fold byte-for-byte; the turn loop owns gating/side effects.
    // `Charged Overdrive II`'s `chargedOverdrivePen` was read/consumed above (~:1046), before the
    // self-status-apply loop; folded here into base.defensePenetrationBuff rather than into
    // effectiveStats.ts: `dmgStats` is turn-local, rebuilt every turn, so the bonus cannot outlive
    // this cast. Pushing it into the standing stat instead would leak +20% pen into every later hit
    // AND into the DPS-mode aggregate scalars and the buff-display UI, which is exactly what
    // name-keying exists to avoid.
    const dmgStats = effectiveDamageStatsOf({
        base: {
            attack,
            defence,
            crit,
            critDamage,
            hp,
            defensePenetration,
            defensePenetrationBuff: defensePenetrationBuff + chargedOverdrivePen,
        },
        scheduledTotals,
        abilitySelfEffects,
        modifierAbilities: dotDamageUnconditional,
        modifierCtx,
    });
    const effectiveAttack = dmgStats.attack;
    // Full buff total at the final fold; equals the prior staged critBuff (layers 1+2+3+4).
    const effectiveCrit =
        args.deferAbilityPerformedToEngine === true
            ? realAffinityCappedCrit(dmgStats.totals.critBuff)
            : cappedCrit(dmgStats.totals.critBuff);
    const effectiveCritDamage = dmgStats.critDamage;
    // Per-hit crit checks (game-verified 2026-06-06): each hit of a multi-hit skill
    // draws the deterministic crit gate INDIVIDUALLY. Draw count = the UNGATED firing
    // skill's hit count (schedule is cast-based like the old single draw — gating
    // never changes the number of draws; a skill with no damage ability keeps the
    // legacy hits=1 default → one draw, unchanged schedule). A noCrit attack draws
    // nothing (the gate does not advance — unchanged). Decided AFTER the modifier
    // fold-in so the draws use the final effective crit rate; modifierCtx above
    // deliberately keeps the probability-based estimate (see spec).
    // KNOWN LIMITATION (mirrors the noCrit caveat at the damageNoCrit read): the draw
    // count follows the UNGATED hit count — if the damage ability itself were
    // conditionally gated off, the gate would still advance. Not representable from
    // parser output today (gate conditions never land on active/charged damage).
    const drawHits = damageNoCrit ? 0 : damageInputsFromSkill(firingSkill).hits;
    const critGate = action === 'charged' ? chargedCritGate : activeCritGate;
    // Per-victim crit resolver for the positional AoE path (per-victim crit). The anchor's
    // own hitCrits are still rolled by the per-hit loop below (using the SAME critGate); a
    // covered victim resolves via this closure at ITS OWN affinity-capped rate — a victim the
    // attacker is at an affinity disadvantage against crits less often. The UNCAPPED crit total
    // (before any affinity cap) is `crit + dmgStats.totals.critBuff`; we cap it against THIS
    // victim's matchup (NOT the representative cappedCrit, which uses the bound target's cap).
    const uncappedCritTotal = crit + dmgStats.totals.critBuff;
    const rollVictimCrit = (victimAffinity: AffinityName): boolean => {
        // A noCrit attack can never crit — mirror the anchor (drawHits=0 → hitCrits empty
        // → anchorCrit false) and, critically, draw NOTHING so the RNG schedule stays
        // identical to the pre-per-victim behavior for noCrit AoE.
        if (damageNoCrit) return false;
        // SP-F F4: an outgoing-advantage force lifts the cap for every victim; otherwise the real
        // per-victim matchup (a covered victim's own Defensive Override is NOT resolved here —
        // rollVictimCrit receives only the affinity, not the victim actor — a documented AoE
        // limitation; no corpus override ship is AoE).
        const { critCap, critPenalty } = forceOutgoingAdvantage
            ? { critCap: 100, critPenalty: 0 }
            : computeAffinityModifiers(attackerAff, victimAffinity);
        const rate = Math.min(critCap, Math.max(0, uncappedCritTotal - critPenalty)) / 100;
        return critGate(rate);
    };
    // D-PR4: per-hit outgoing amplification (Menace/Giant Slayer) on the firing hit only.
    // Sourced from the always-active passive slot. With no amplification ability OR no
    // engine-supplied proc gate, the loop never calls outgoingAmplificationForHit and the
    // weighted sums collapse to (nonCritHits, critHits) → byte-identical.
    const ampAbilities = (passiveSkill?.abilities ?? []).filter(
        (a) => a.config.type === 'outgoing-amplification'
    );
    const targetHigherAttack =
        args.targetEffectiveAttack !== undefined && args.targetEffectiveAttack > effectiveAttack;
    const rollOutgoingProc = args.rollOutgoingProc;
    let critHits = 0;
    const hitCrits: boolean[] = [];
    /**
     * The FIRST firing-hit crit draw's outcome — the ONE crit result the passive-slot damage
     * instance reuses, in both of the channels that carry it (task-18 finding 4).
     *
     * Not `hitCrits[0]`: the loop below draws `drawHits` times whether or not a damage ability
     * fired, but only PUSHES when one did (`damageInputsFromSkill` reports `hits: 1` for a slot
     * with no damage ability, so the draw still happens). A cast with no firing-slot damage
     * ability therefore has an EMPTY `hitCrits` and a crit outcome all the same — reading
     * `hitCrits[0] ?? false` there declares the instance non-critical while the aggregate below
     * crits off that very draw. Capturing the draw itself is what makes the two agree in every
     * case. `false` when `drawHits` is 0 (a `noCrit` cast), which is the correct no-crit answer.
     *
     * NO EXTRA DRAW: this reads the existing per-hit draw, it does not add one.
     */
    let firstDrawCrit = false;
    let ampNonCritWeight = 0;
    let ampCritWeight = 0;
    // The engine resolves amplification per footprint victim exactly when it also takes over the
    // `ability-performed` emit — the same condition, spelled the same way as `deferAbilityPerformed`
    // further down. Kept as its own named const so the two reads cannot drift apart.
    const deferAmplificationToEngine =
        args.deferAbilityPerformedToEngine === true && hasDamageAbility;
    for (let h = 0; h < drawHits; h++) {
        const didCritHit = critGate(effectiveCrit / 100);
        if (didCritHit) critHits += 1;
        if (h === 0) firstDrawCrit = didCritHit;
        // Only collect per-hit outcomes when a damage ability actually exists.
        // The draw still happens regardless, so the per-hit RNG draw count is stable.
        if (hasDamageAbility) hitCrits.push(didCritHit);
        // Only call outgoingAmplificationForHit when amplification is actually present AND a
        // proc gate is supplied — keeps the critGate sequence and behaviour untouched otherwise.
        //
        // NOT on the positional path (multi-hit full-walk epic, PR4 — spec §4.6). There the
        // engine's per-victim apply is the authority on amplification: it resolves the condition
        // against each footprint victim's OWN crit outcome and attack matchup, and THIS aggregate
        // result is never applied to anyone's HP. Drawing here anyway advanced the SAME
        // `procChanceGates` key (`${ownerId}:${abilityId}`) a second time — measured
        // `hits × (1 + victims)` draws for one cast — and left the deferred `ability-performed`
        // damage basis decided by a coin flip the applied damage ignored. One verdict per
        // sub-attack, drawn where eligibility is actually known, is the fix; the accepted cost is
        // that the positional event's pre-funnel `damage` basis no longer carries amplification
        // (it never reflected any other per-victim outcome either). Non-positional / DPS / healing
        // casts are the sole remaining consumer here and stay byte-identical.
        //
        // PR7 RESOLVED that cost for effect purposes: damage-proportional reactives now read the
        // event's `deliveredDamage` (post-amplification, per-victim, funnel-accurate). This field
        // remains the pre-funnel DISPLAY basis that buildCombatLog reads.
        const amp =
            ampAbilities.length > 0 && rollOutgoingProc && !deferAmplificationToEngine
                ? outgoingAmplificationForHit(
                      ampAbilities,
                      { didCrit: didCritHit, targetHigherAttack },
                      rollOutgoingProc
                  ) / 100
                : 0;
        if (didCritHit) ampCritWeight += 1 + amp;
        else ampNonCritWeight += 1 + amp;
    }
    // Any-hit binary: feeds ctx self-crit gates, the RoundData row, and didCrit.
    // on-crit triggers consume critHits (per-critting-hit), NOT this binary — see
    // registerReactiveListeners in triggers.ts.
    const roundCrit = critHits > 0;
    const effectivePen = dmgStats.effectivePen;
    const effectiveDefense =
        enemyDefense * (1 + enemyDefenseModifier / 100) * (1 - effectivePen / 100);
    const damageReduction = effectiveDefense > 0 ? calculateDamageReduction(effectiveDefense) : 0;

    // Step 1: Calculate direct damage
    const enemyDotMod = toEnemyDotModifier(roundEnemyDebuffs);
    // Ability-status self Out. DoT folds in per-round (KNOWN-DIFF b). Enemy Inc. DoT is
    // already inside enemyDotMod (roundEnemyDebuffs includes abilityEnemyEffects).
    const dotMult = 1 + (selfDotModifier + enemyDotMod + dmgStats.selfDotDamageModifier) / 100;
    // SP-F F4: the anchor damage mult honours the forced-affinity override (equals the runtime
    // scalar when no override → byte-identical default).
    const affinityMult = 1 + effAffinityDamageModifier / 100;
    const effectiveDefence = dmgStats.defence;
    const effectiveHp = dmgStats.hp;

    // Per-round condition context for the Phase 1 condition engine. Built once
    // after landedEnemyDebuffs and effectiveCrit are known, but BEFORE Step 3
    // applies this round's fresh DoTs — so derivable counts read pre-Step-3 state,
    // matching the prior inline behaviour.
    const ctx = buildRoundContext({
        selfBuffNames: activeSelfBuffNames,
        landedEnemyDebuffCount: landedEnemyDebuffs.length,
        corrosionEntryCount: corrosionEntries.length,
        infernoEntryCount: infernoEntries.length,
        bombCount: pendingBombs.length,
        genericCount: genericDoTEntries.length,
        enemyDotFamilyCounts: dotFamilyCounts(corrosionEntries, infernoEntries, genericDoTEntries),
        effectiveCritRate: effectiveCrit,
        enemyType,
        roundCrit,
        enemyHpPct,
        // SP-4d: see preDebuffGateCtx's matching note above — same `hasVictim` discriminator.
        // This is the ctx `gateFiringAbilities` gates against just below, i.e. the one that
        // actually reaches the Hermes-shaped repro (a self-shield gated on `enemy-debuff eq 0`).
        noOpposingVictim: !hasVictim,
        selfHpPct: selfHpPctArg,
        targetHpPct: targetHpPctArg,
        targetRepairedThisRound: targetRepairedThisRoundArg,
        enemyBuffNames: enemyBuffNamesArg,
        enemyDebuffNames: enemyDebuffNamesArg,
        selfDebuffNames: selfDebuffNamesArg,
        // Thread the acting actor's live own-turn counter so cast-path `every-n-turns` gates
        // (on-cast/active/charged) evaluate against the real N — symmetric with the reactive
        // (end-of-turn) drain path, which already reads it via the turnsTakenFor delegate.
        turnsTaken: actor.turnsTaken,
        // SP-C: owner-vs-target stat comparison (Bayah/Cobalt/Chakara), gating THIS cast's
        // payload abilities via gateFiringAbilities below. Sourced directly from the live
        // `actor`/`enemy` CombatActor pair — the SAME pairing every call site (focus/team/
        // enemy-walk) passes via buildTurnArgs's `runtime`/`enemy` — so this is team-symmetric
        // with zero player/enemy branching. SP-4c-2b: the target half is now omitted outright when
        // there is no victim (see victimStatGateCtx); the OWNER half below always has a subject.
        selfSpeed: actor.stats.speed,
        selfCurrentHp: actor.currentHp,
        // Mirrors modifierCtx's existing selfCritPower estimate (layers 1+2+3, pre-modifier) —
        // both this ctx and modifierCtx sit AFTER critDamageForGates' final += (line ~1431), so
        // the value is identical and stable here.
        selfCritPower: critDamage + critDamageForGates,
        // Cobalt/Bayah are single-target casts, so the primary `enemy` IS "the target". Chakara's
        // charge gate ("all damaged enemies have more Speed") is also single-target in the
        // corpus today — the MIN-across-damaged-enemies aggregate the game text describes
        // degenerates to this one target's speed. A future multi-target stat-vs-target ship
        // would need real per-victim aggregation; out of scope here (no corpus ship needs it).
        ...victimStatGateCtx(enemy),
        // SP-D: enemies-hit-this-cast, gating Tygr's self-charge-gain (a `type:'charge'` on-cast
        // ability evaluated via gateFiringAbilities below, NOT a timed self-buff — so it needs
        // THIS ctx, distinct from Berserker's Marauder Rage which drains via the on-deal-damage
        // reactive path instead). aoeVictimIds is the actor's own splash-pattern footprint
        // (already computed pre-turn by buildTurnArgs for the AoE-purge fan-out, E3) — undefined
        // in DPS/non-positional mode, which is exactly the single-target-cast and no-victim-cast
        // cases alike. SP-4d Task 8: those two are NOT the same measurement — a single-target
        // cast hit its one target (1), a no-victim cast hit nobody (0) — so the fallback is keyed
        // on `hasVictim` (the same discriminator every other victim-derived field in this ctx
        // uses), not a bare `?? 1`. A prior rung dropped that `?? 1` default outright, which made
        // the single-target case read absent instead of 1 (Tygr's own `eq 1`-shaped gate would
        // silently never fire); this restores the correct-for-single-target value while also
        // fixing the no-victim value from absent to the honest 0.
        enemiesHitThisCast: aoeVictimIds?.length ?? (hasVictim ? 1 : 0),
        // Ship-kit Wave 4, Task 3 (review follow-up): SAME field/derivation as preDebuffGateCtx
        // (:1444) and modifierCtx (:1724) above — REQUIRED here because THIS ctx is what
        // gateFiringAbilities consumes just below (:1956) to gate `type:'control'` payload
        // abilities. APEX's charged Disable is modelled BOTH as a named debuff (gated by
        // preDebuffGateCtx) AND as a `control`-type ability (effect:'disable', gated by this
        // ctx) — both twins carry the same self-shield condition (buildShipAbilities.ts
        // :3237-3238), so both need selfShielded here or the control twin is permanently
        // suppressed regardless of the caster's real shieldPool (control-applied never fires,
        // the combat log's kind:'control' Disable entry never appears — even with a shield).
        selfShielded: actor.shieldPool > 0,
        // Reconciled with drain-time (engine.ts's isSelfShieldFull, which reads
        // recipientMaxHp → lastTurnCtxByActor.get(id)?.effectiveMaxHp): `effectiveHp` (:1987,
        // above this ctx) is exactly that same live, buff-inclusive max HP (it IS the value
        // stored into effectiveMaxHp at turnCtx below, :3289) — so this reads byte-identically
        // to the drain-time gate instead of the static base stat, which would disagree under an
        // active max-HP buff.
        selfShieldFull: effectiveHp > 0 && actor.shieldPool >= effectiveHp,
        // Malvex charged Barrier: the TARGET's shield-presence gate (see victimShieldGateCtx), for
        // the payload abilities gateFiringAbilities gates just below. No corpus payload ability gates
        // on this subject today (Malvex's own charge-slot Barrier is a timed self buff, gated by
        // postDebuffGateCtx); populated for the same silently-never-fires reason as its
        // `selfShielded` neighbour.
        ...victimShieldGateCtx(enemy),
    });

    // Hard gate: payload abilities whose conditions fail contribute nothing this
    // round. Walked in text order with a same-cast DoT overlay (see applyAbilities).
    const { gatedSkill, ctxFor } = gateFiringAbilities(firingSkill, ctx);

    // Control inflictions (Stasis, Provoke, Taunt, Concentrate Fire, Disable): emit `control-applied`
    // so reactions (on-stasis-applied) can fire. Each control effect's combat impact is modelled
    // in the engine (Overload is the sole deferred exception). An emitted-but-unconsumed event
    // changes nothing, so DPS-mode goldens are unaffected.
    //
    // A control effect reaches the engine BOTH as a named timed debuff (its buffName, routed
    // through the timed landing fold above which OWNS the resist decision — Block-Debuff immunity,
    // affinity disadvantage on 'apply', and the landing-roll gate on 'inflict' — symmetric with
    // every debuff type) AND, additively, as this `type:'control'` ability. So the control loop
    // does NOT emit its own resist — that would double-count (the named-status path already emits
    // `debuff-resisted`).
    //
    // We SUPPRESS the success event (`control-applied`) for an ENEMY-targeted control when its
    // paired named status was RESISTED this cast — its buffName is in the union of the resisted
    // names from the two enemy-debuff landing paths: the ability-timed loop (resistedTimedEnemyNames,
    // which already folds affinity/landing-roll/Block-Debuff) and the scheduled path
    // (resistedScheduledTimedNames). On a resist we skip the success event so on-stasis-applied
    // (etc.) reactions stay dormant for a control that did not land (Finding 1).
    //
    // A control with NO paired named status (the engine's control-only fixtures: Defiant Stasis,
    // etc.) has no entry in the resisted set, so it still emits — its ONLY suppression is
    // Block-Debuff immunity on the turn target (targetImmuneToDebuffs), preserving the prior
    // standalone-control behaviour. SELF-target controls (Taunt) are self-buffs (never resisted)
    // and have no enemy debuff target → always emit.
    const resistedEnemyDebuffNames = new Set([
        ...resistedTimedEnemyNames,
        ...resistedScheduledTimedNames,
    ]);
    for (const ctrl of controlAbilitiesFromSkill(gatedSkill)) {
        if (ctrl.config.type !== 'control') continue;
        if (ctrl.target === 'enemy') {
            // SP-4c-2b (final review, IMPORTANT 2): NO VICTIM ⇒ nothing was controlled, so there is
            // no success to announce. This site was a MISSED SITE, not a ruled residual — contract §B
            // class 2 says "fence the enclosing clause, not the emit" and this loop is simply absent
            // from that table. Fencing it here (a `continue`, i.e. the clause) rather than at the
            // `bus.emit` is that rule applied.
            //
            // WHY IT COULD NOT BE LEFT: on a no-victim turn NOTHING below suppresses this emit.
            // `targetImmuneToDebuffs` is fenced to `false` (nobody is carrying Block Debuff against a
            // cast with no target), and `resistedEnemyDebuffNames` can only carry ability-sourced
            // names via `landStatusOnRecipients`, whose loop is itself victim-fenced — so only the
            // SCHEDULED resist list can populate it, and that covers scheduled statuses, not the
            // ability-sourced control this loop reads. The ghost path at least suppressed the event
            // whenever the paired named status lost its landing roll; without a fence the rung would
            // have moved this from a PROBABILISTIC phantom to an ALWAYS-ON one, and the event is not
            // inert — it wakes `on-stasis-applied` reactions.
            //
            // `ctrl.target === 'enemy'` scoping is load-bearing: a SELF-targeted control (Taunt) has
            // nothing to do with the opposing side and must keep emitting on a no-victim turn.
            if (!hasVictim) continue;
            // Standalone control with no named status: only Block-Debuff immunity gates it.
            if (targetImmuneToDebuffs) continue;
            // Paired named status resisted (affinity / landing-roll) → suppress the success event.
            if (resistedEnemyDebuffNames.has(controlEffectLabel(ctrl.config.effect))) continue;
        }
        bus.emit({
            type: 'control-applied',
            casterId: actor.id,
            effect: ctrl.config.effect,
            round: r,
        });
    }

    const { multiplier: rawMultiplier, hits, scalingAbility } = damageInputsFromSkill(gatedSkill);
    const effectiveMultiplier = rawMultiplier * hits;
    const secondary = secondaryFromSkill(gatedSkill);
    const dotsConfig = dotsFromSkill(gatedSkill);

    let secondaryStatValue = 0;
    if (secondary) {
        // PR9(a): 'shield' reads the caster's own LIVE shieldPool at cast time (the SAME field
        // the I6 shield-strip mechanic reads/writes) — 0 by default (no starting pool), grown
        // only by the caster's own prior shield grants (self-cast or pre-combat seeding). No
        // DPS-mode special-casing needed: a solo DPS run without a healing-mode target never
        // processes on-cast self-shield grants (that block is gated on args.healing), so
        // shieldPool naturally stays 0 there too, EXCEPT for a "start of combat" pre-combat
        // shield seed (unconditional, seedPreCombatShields), which correctly still counts.
        const source =
            secondary.stat === 'defense'
                ? effectiveDefence
                : secondary.stat === 'shield'
                  ? actor.shieldPool
                  : effectiveHp;
        secondaryStatValue = source * (secondary.pct / 100);
    }

    // Conditional scaling bonus, folded additively into the skill multiplier.
    // Read from the firing skill's damage ability's own scaling rule. Derivable
    // conditions read this round's sim state (pre-Step-3 DoT arrays, so this
    // round's freshly-applied DoTs are not yet counted); manual conditions use
    // a static count. Threads the POSITIONAL context (ctxFor) so a damage ability
    // AFTER a same-cast dot scales with the fresh dot counted.
    const conditionalBonusPct = scalingAbility
        ? scaledBonus(scalingAbility, ctxFor.get(scalingAbility.id) ?? ctx)
        : 0;

    // Passive payload hit (Judge: "At the start of the round, this Unit deals 60%
    // damage to all enemies with less than 50% HP"). The always-active passive slot
    // can carry a gated damage ability; gate it per round against the same ctx and
    // add the passing hit as an extra damage instance. "Start of the round" matches
    // the entering-round enemyHpPct the gate evaluates. Uses the round's crit
    // outcome and defense math like the firing hit; its own noCrit is respected.
    const { gatedSkill: gatedPassive, ctxFor: passiveCtxFor } = gateFiringAbilities(
        passiveSkill,
        ctx
    );
    const passiveHit = damageInputsFromSkill(gatedPassive);
    const passiveScalingBonus = passiveHit.scalingAbility
        ? scaledBonus(
              passiveHit.scalingAbility,
              passiveCtxFor.get(passiveHit.scalingAbility.id) ?? ctx
          )
        : 0;
    const passiveMultiplier = passiveHit.multiplier * passiveHit.hits + passiveScalingBonus;

    // Charge manipulation: charges only accumulate on ACTIVE rounds. A charged
    // round fires the charged skill, which consumes all charges (reset to 0 at
    // the top of the loop) — nothing banks toward the next charge on that round.
    // Sourced from the firing skill AND the always-active passive slot (charge
    // auras: Hermes/Asphodel/Hemlock/Oleander/Cobalt) — both pre-gated by
    // gateFiringAbilities with their positional contexts. Self + ally gains are
    // added here and the total is capped at chargeCount, since charges never
    // exceed what the charged skill requires.
    if (hasChargedSkill && action === 'active') {
        // OWN charge gains: self-targeted (and unscoped) charge abilities from the firing skill
        // + the always-active passive slot. Bumps the caster only, capped at its own chargeCount.
        const bonusCharges =
            chargeGainFromSkill({ gatedSkill, ctxFor, fallbackCtx: ctx, targetFilter: 'own' }) +
            chargeGainFromSkill({
                gatedSkill: gatedPassive,
                ctxFor: passiveCtxFor,
                fallbackCtx: ctx,
                targetFilter: 'own',
            });
        const oldChargeManip = actor.charges;
        actor.charges = Math.min(
            actor.charges + bonusCharges + (allyChargePerRound ?? 0),
            chargeCount
        );
        if (actor.charges !== oldChargeManip) {
            bus.emit({
                type: 'charge-changed',
                actorId: actor.id,
                round: r,
                oldCharge: oldChargeManip,
                newCharge: actor.charges,
                reason: 'manip',
            });
        }
    }
    // ALLY charge gains (Task 5): ally/all-allies-targeted charge abilities bump EVERY player
    // actor (incl. this caster), each capped at its OWN chargeCount. Sourced from the FIRING
    // skill (`gatedSkill`), active OR charged — a grant riding the charged skill (Hayyan) fires
    // on a charged turn just as an active-skill grant fires on an active turn; recipients receive
    // regardless of their own action state. Applied at the SAME sequence point as own gains.
    // Independent of hasChargedSkill: a caster with no charged skill of its own can still grant
    // charges to allies (Hermes pattern). The engine supplies grantAllyCharges, which performs
    // the per-actor cap-bump; absent (standalone callers) → no-op.
    if ((action === 'active' || action === 'charged') && grantAllyCharges) {
        const allyCharges =
            chargeGainFromSkill({ gatedSkill, ctxFor, fallbackCtx: ctx, targetFilter: 'ally' }) +
            chargeGainFromSkill({
                gatedSkill: gatedPassive,
                ctxFor: passiveCtxFor,
                fallbackCtx: ctx,
                targetFilter: 'ally',
            });
        if (allyCharges > 0) {
            const isEnemyCaster = actor.side === 'enemy';
            const allyRoster = args.healing
                ? isEnemyCaster
                    ? args.healing.enemyIds
                    : args.healing.playerIds
                : (sameSideLiving ?? []).map((a) => a.id);
            // Stays unconditionally footprint-scoped even though `allyCharges` folds the passive
            // slot in: chargeGainFromSkill returns a scalar, so there is no per-ability slot to
            // consult here (unlike the heal/extend loops). Unobservable today — every corpus
            // passive ally-charge grant is REACTIVE (Graphite start-of-round, Liberator
            // on-enemy-destroyed, …) and therefore routes through triggers.ts's
            // `reactiveRecipients`, which does honour the passive rule. Split this if a
            // non-reactive passive ally-charge aura ever ships.
            const chargeRecipients = supportRecipients('all-allies', allyRoster);
            grantAllyCharges(
                allyCharges,
                footprintAllyIds !== undefined ? { recipientIds: chargeRecipients } : undefined
            );
        }
    }

    // ENEMY charge removal (Task 7): enemy/all-enemies-targeted charge abilities REMOVE charges
    // from every opposing actor (floored at 0, immune actors skipped). Sourced from the FIRING
    // skill + the always-active passive slot, both pre-gated; summed as a positive amount and
    // passed to removeEnemyCharges (the engine subtracts). Same active/charged sequence point as
    // own/ally gains. The engine supplies removeEnemyCharges (per-actor floor loop on the opposing
    // side); absent (standalone callers without an opposing roster) → no-op.
    if ((action === 'active' || action === 'charged') && removeEnemyCharges) {
        const enemyChargeRemoval =
            chargeGainFromSkill({ gatedSkill, ctxFor, fallbackCtx: ctx, targetFilter: 'enemy' }) +
            chargeGainFromSkill({
                gatedSkill: gatedPassive,
                ctxFor: passiveCtxFor,
                fallbackCtx: ctx,
                targetFilter: 'enemy',
            });
        if (enemyChargeRemoval > 0) removeEnemyCharges(enemyChargeRemoval, attackerAffinity);
    }

    // Extra-action grants (game-verified: a full extra turn; the engine re-inserts
    // this actor into the round's remaining queue by speed). Sourced from the FIRING
    // skill + the always-active passive slot, both pre-gated by gateFiringAbilities.
    const extraActionGrants = [
        ...extraActionsFromSkill(gatedSkill),
        ...extraActionsFromSkill(gatedPassive),
    ];

    const preCritDamage =
        effectiveAttack * ((effectiveMultiplier + conditionalBonusPct) / 100) + secondaryStatValue;
    // Blended per-hit crit multiplier: critHits of drawHits hits crit, each at the
    // full (1 + critDamage) multiplier. Algebraically identical to splitting the
    // skill multiplier + secondary + conditional bonus evenly across hits and
    // critting each hit individually — so totals match per-hit expectation without
    // restructuring the damage assembly. drawHits 0 (noCrit) → fraction 0 →
    // multiplier 1 (the "cannot critically hit" path, unchanged).
    const critFraction = drawHits > 0 ? critHits / drawHits : 0;
    // D-PR3 victim-side incoming %-reduction against the bound target (aggregate path).
    // Both default 0 → byte-identical to the prior fold.
    const equipNonCrit = args.incomingReductionNonCritPct ?? 0;
    const R = args.incomingReductionCritFamilyPct ?? 0;
    // D-PR3: crit-family reduction folds ADDITIVELY into the incoming channel for the CRIT
    // FRACTION only — consistent with the positional path (victimHitDamage). Expressed as a
    // ratio against the non-crit incoming factor so damageCritMultiplier * nonCritFactor stays
    // structurally valid and the passive-hit path is unaffected. R=0 → ratio 1 → byte-identical
    // to the prior expression. The crit fraction therefore sees incoming channel (incBase - R)
    // additively, exactly like positional victimHitDamage; the non-crit fraction sees incBase.
    // Redefining damageCritMultiplier (vs a separate factor) is correct: both downstream uses —
    // postDefenseFactor (firing hit) and passiveCritMultiplier (passive hit) — are the SAME enemy
    // attack against the SAME victim, so the victim's crit reduction applies to both.
    const incBase = incomingDamageModifier - equipNonCrit; // incoming channel for all hits
    const incDenom = 1 + incBase / 100;
    const critIncomingRatio = incDenom !== 0 ? (1 + (incBase - R) / 100) / incDenom : 1;
    const damageCritMultiplier =
        1 - critFraction + critFraction * (1 + effectiveCritDamage / 100) * critIncomingRatio;
    // Crit-independent damage pipeline (defense, outgoing/incoming, affinity) — shared
    // by the firing hit and the passive hit, which may differ in crit treatment (noCrit).
    // The incoming channel (incBase) folds the non-crit reduction additively; 0 → unchanged.
    const nonCritFactor =
        (1 - damageReduction / 100) *
        (1 + dmgStats.totals.outgoingDamageBuff / 100) *
        (1 + incBase / 100) *
        affinityMult;
    // D-PR4: per-hit outgoing amplification (Menace/Giant Slayer), firing hit only. Collapses to
    // damageCritMultiplier when no amplification fired (ampNonCritWeight=nonCritHits, ampCritWeight=critHits)
    // → byte-identical. critIncomingRatio carries D-PR3's crit-family incoming reduction.
    const amplifiedCritMultiplier =
        drawHits > 0
            ? (ampNonCritWeight +
                  ampCritWeight * (1 + effectiveCritDamage / 100) * critIncomingRatio) /
              drawHits
            : damageCritMultiplier;
    const postDefenseFactor = amplifiedCritMultiplier * nonCritFactor;
    /**
     * ONE instance, ONE crit outcome — the single boolean BOTH channels that carry the
     * passive-slot hit read (task-18 finding 4): the aggregate `passiveDamage` just below, and
     * the `PassiveSlotHit.didCrit` the positional per-victim apply lands with.
     *
     * WHY IT IS NOT `damageCritMultiplier`. That factor is the FIRING skill's per-hit BLEND —
     * `1 - critFraction + critFraction × critMult`, i.e. the average over `drawHits` draws. It is
     * the right basis for a `hits: N` firing hit (N hits, `critHits` of them critical) and the
     * wrong one for the passive slot, which contributes exactly ONE hit that either crits or does
     * not. On a 2-hit cast with one crit it valued the instance at 1.5× while the positional apply
     * — reading `hitCrits[0]` — landed it at 2×, so the log's number and the enemy's health loss
     * disagreed by that ratio (measured: aggregate 750 vs applied 1000 on the fixture in
     * `passiveSlotHitCritParity`). Single-hit casts were unaffected, which is why nothing caught it.
     *
     * `noCrit` still forces false, exactly as `? 1` did. NO EXTRA DRAW: `firstDrawCrit` is the
     * per-hit loop's own first draw.
     */
    const passiveDidCrit = passiveHit.noCrit ? false : firstDrawCrit;
    const passiveCritMultiplier = passiveDidCrit
        ? (1 + effectiveCritDamage / 100) * critIncomingRatio
        : 1;
    const passiveDamage =
        effectiveAttack * (passiveMultiplier / 100) * passiveCritMultiplier * nonCritFactor;
    // SP-4c-2b: A CAST WITH NO VICTIM DEALS NO DAMAGE — full stop (owner's ruling). Fencing the
    // EMIT was not enough: `enemyDefense` is absent on a no-victim turn and resolves to 0, so
    // `effectiveDefense` → `damageReduction` → `nonCritFactor` → `postDefenseFactor` would carry
    // these three magnitudes out as REAL numbers answering "an enemy with no defence" — the exact
    // disguised-ghost shape this rung deletes — and the CALLER folds them into the round
    // accumulator regardless of any event guard. It also zeroes the `% of damage dealt` support
    // basis below (`castDeliveredDamage ?? directDamage`), which is the same ruling applied to a
    // repair scaled off damage that never happened.
    // WHY THE THREE ASSIGNMENTS AND NOT A POINT FURTHER UP: the whole chain from `effectiveDefense`
    // (:2472) down to `passiveDamage` above consists of intermediate FACTORS whose only consumers
    // are these three lines (grep-verified: `effectiveDefense`, `damageReduction`, `nonCritFactor`,
    // `postDefenseFactor`, `preCritDamage` and `passiveDamage` appear nowhere else), so no phantom
    // magnitude escapes past this point and each returned number is fenced where it is produced
    // rather than zeroed after the fact. `detonationDamage` is fenced at its own branch (:3147).
    // Corpus-inert today — no shipped ally-target ship carries a damage clause (plan §A.2) — so
    // this is zero movement.
    const directDamage = hasVictim ? preCritDamage * postDefenseFactor + passiveDamage : 0;
    const secondaryDamage = hasVictim ? secondaryStatValue * postDefenseFactor : 0;
    const conditionalDamage = hasVictim
        ? effectiveAttack * (conditionalBonusPct / 100) * postDefenseFactor
        : 0;

    // ability-performed: emitted below, once per SUB-ATTACK when not deferred to the engine (and
    // stopping early if the bound target is already dead — the R5 whiff guard) — see the loop's
    // own comment for cardinality, the DAMAGE split, and the hits===1 byte-identical guarantee
    // (not restated here).
    // Task 5 (per-victim crit signal): when the ENGINE will resolve this cast POSITIONALLY
    // (deferAbilityPerformedToEngine set AND a damage ability fired — the exact condition under
    // which the engine runs its per-victim apply, since its `positional` gate requires
    // positionalScalars != null ⟺ hasDamageAbility), DO NOT emit here. The engine emits ONE
    // `ability-performed` AFTER its per-victim apply so `didCrit`/`critHits` reflect the TRUE
    // per-victim outcomes rather than the anchor-only values.
    // Since PR2 of the multi-hit full-walk epic the engine emits ONE event per SUB-ATTACK (a
    // `hits: N` skill is N consecutive full-walk attacks), each immediately followed by that
    // sub-attack's own `attacked` events — so what deferring preserves is the
    // ability-performed → per-victim `attacked` bus order, per sub-attack. With N=1 that is one
    // event per positional cast, exactly as before.
    // Non-positional / DPS / healing (flag absent, or no damage ability): emitted inline in the
    // loop below, at the SAME per-sub-attack cardinality as the positional/engine path since PR5.
    const deferAbilityPerformed = args.deferAbilityPerformedToEngine === true && hasDamageAbility;
    // SP-4c-2b: `hasVictim` fences the whole emitting block, not the emit inside it — every
    // `ability-performed` here NAMES the victim it was performed against, and with no victim the
    // attack did not happen to anybody.
    //
    // RULED CORRECT (owner, SP-4c-2b review): "a heal is not an attack, but a heal can still crit,
    // so it should fire the 'critically repaired' rider and not the 'critically hit an enemy'
    // rider." The engine already splits exactly that way, so this fence lands on the right side of
    // it: `on-crit` / `on-ally-crit` ride THIS event and are per-ATTACK, documented "critically
    // hits an enemy" (triggers.ts:308, :434, :789) — losing them off an ally-targeted support cast
    // is the INTENDED consequence, not collateral. The repair-crit rider is untouched:
    // `on-ally-critically-repaired` rides `heal-performed` and reads its own `critHits`
    // (triggers.ts:722-731), which the heal block below still emits. Hermes carries both riders and
    // is therefore the case to name: after this rung its ally-targeted repair still fires the
    // critically-repaired rider and no longer fires the critically-hit-an-enemy one.
    //
    // The cast's `directDamage` is 0 on this path (fenced at the assembly above), so nothing is
    // silently applied without an event either.
    if (!deferAbilityPerformed && hasVictim) {
        // PR5 (multi-hit full-walk epic): ONE event per SUB-ATTACK, matching the positional
        // path's interleaved emission (engine.ts `emitDeferredAbilityPerformed`, per sub-attack
        // since PR2). A `hits: N` skill is N consecutive FULL-WALK attacks (locked rule R1), so
        // outgoing riders must fire N times: `on-deal-damage` (Burner's Inferno, Warpstrike's
        // duration-reduction, Zeolite's purge), `on-crit`, `on-ally-crit`. Folding the cast into
        // one event fired them ONCE — which is why the DPS calculator reported one Inferno stack
        // for Enforcer + Burner while the simulator reported three (verified in-game 2026-08-08).
        //
        // CARDINALITY comes from `hits` — the GATED count (damageInputsFromSkill(gatedSkill)),
        // the same value that built `effectiveMultiplier`, so the event count and the damage it
        // splits derive from ONE number (clamped to at least 1 by `emitHits` below). Deliberately
        // NOT `drawHits`, which reads the UNGATED firingSkill and can only diverge if a gate lands
        // on an active/charged damage ability (not representable from parser output today — see
        // the KNOWN LIMITATION at the `drawHits` read). A cast with NO damage ability gets
        // hits === 1 from damageInputsFromSkill's default, so heal/buff/utility casts emit
        // exactly one event as before.
        //
        // `hits: 0` GUARD: the ability editor's `min={1}` is advisory HTML — a hand-stored 0
        // survives `damageInputsFromSkill`'s `?? 1` (that only guards `undefined`) and
        // `parseInt('0', 10) === 0`. A bare `h < hits` loop would then run zero times: no event,
        // no riders, no log row, silently dropping the ONE zero-damage event pre-PR5 code
        // unconditionally emitted. `emitHits` (declared just above the loop) clamps BOTH the loop
        // bound and the damage divisor to the same value so they cannot drift apart, reproducing
        // that one event exactly (directDamage undivided) for an explicit hits:0 cast.
        //
        // DAMAGE per event is the cast's pre-funnel `directDamage` split N ways — the SAME basis
        // and the SAME split the positional path uses (`share = dap.damage / emitting.length`).
        // Sigma over the loop reproduces the old single event's `damage` exactly, so NO damage
        // total moves. Looping buys zero damage accuracy (victimDamage.ts:16-30 proves the fold
        // is algebraically identical); it buys one derivation of "a sub-attack" instead of two
        // that can drift.
        //
        // KNOWN ASYMMETRY (epic spec PR5 section 5.4), deliberately NOT decided here:
        // `secondaryStatValue`, `conditionalBonusPct` and the passive-slot hit (`passiveDamage`,
        // computed just above and added into `directDamage` BEFORE this divisor) are each folded
        // in ONCE per cast while the base multiplier scales with `hits`, so each sub-attack
        // receives 1/N of a single secondary / conditional / passive payload rather than a full
        // one. All three are the same class. Note the split is REPORTING-only for all three: the
        // cast's Sigma is unchanged, so no damage total moves — what is uncertain is only whether
        // a per-sub-attack rider reading `e.damage` should see a 1/N share of them. Untestable
        // in-game today (no multi-hit ship carries defence/HP-scaling or a conditional bonus);
        // flagged for the next in-game pass rather than silently resolved.
        //
        // RULE R5 ("with no living target left, the multi-hit simply stops dealing damage",
        // verified in-game 2026-08-08). The `enemy.destroyedRound !== undefined` break at the top
        // of the loop below implements the LOG/EVENT half of it, and ONLY that half: it stops the
        // remaining sub-attacks from emitting `ability-performed`, so they open no log row and fire
        // no outgoing rider. It computes and applies NO HP loss — `directDamage` was totalled
        // above, before this loop, and still flows out unchanged in this function's return value
        // for the CALLER to apply. So the damage half of R5 remains the caller's responsibility on
        // this path; do not read the break as making a dead-target multi-hit deal zero.
        // PR5 derived the branch to be structurally UNREACHABLE on this
        // path and left it unbuilt; PR6 builds it anyway so that the whiff safety is INTENTIONAL
        // rather than an incidental side-effect of unrelated plumbing (see WAS-COUPLED-TO below).
        // Because the branch is unreachable, its ONLY coverage is a direct-runPlayerTurn test
        // (`__tests__/multiHitInlineEmitGuards.test.ts`); no integration test can take it, so do
        // not "consolidate" that test into one.
        //
        // WHICH SIGNAL, AND WHY NOT `currentHp <= 0` (PR6, after a review caught the first cut).
        // The guard's first version read `enemy.currentHp <= 0` and was WRONG — reachable, in
        // healing/sim mode, where it silently killed the focus's entire event stream from the
        // moment cumulative damage crossed `enemyHp` (round 6 of 10 in the reproduction; see
        // `multiHitInlineEmitGuards.test.ts`'s runCombat-level block). HISTORY, and it is what makes
        // the signal choice permanent rather than incidental: the sink NEVER DIED, but its
        // `currentHp` was CLAMPED — engine.ts set it to `Math.max(0, enemyHp - cumulativeDamage -
        // cumulativeTeamDamage)` at every round tail, so it reached 0 and stayed there forever
        // while nothing terminated the run. SP-4c-2d deleted the sink, that clamp and the
        // roster-emptiness break together, so the specific reproduction is gone — but the LESSON
        // (`currentHp <= 0` is not an aliveness signal) is not about the dummy at all: a
        // never-alive actor reads the same way, which is the class that failed 346 tests during
        // SP-4c-1.
        // THE READING ERROR WORTH NOT REPEATING: the derivation below reasons exclusively about
        // MID-CAST HP application — "can anything decline this target's HP while the loop runs" —
        // and every bullet in it is still true. It simply never asked the OTHER question, "can the
        // bound target already be at 0 before the cast begins", for which the answer on the sink is
        // yes, permanently, without a death. `currentHp <= 0` conflates "at the HP floor" with
        // "dead"; on the sink those are different facts. `destroyedRound` is the canonical
        // aliveness signal (state.ts:151, stamped once by `recordDestroyed`, state.ts:243 — the
        // same signal the dead-owner gate at triggers.ts ~2514 reads) and is never stamped on the
        // sink, so the guard is inert there and fires only on a genuinely destroyed bound target.
        // The unreachability derivation, re-walked against source for PR5 and still accurate:
        //   • THE PRIMARY ARGUMENT, and self-sufficient on its own — it needs nothing from the
        //     engine enumeration below. This loop never mutates HP: it only emits events, and the
        //     listeners those events reach are enqueue-only (the Phase 1 listener contract,
        //     triggers.ts), draining at end of turn. The bound target's actual currentHp decrement
        //     happens exactly ONCE, after `runPlayerTurn` returns, via the caller's own aggregate
        //     apply. So a mid-cast kill inside this loop is impossible — including on the
        //     symmetric reverse invocation (an enemy actor's turn against a player `enemy`/tgt,
        //     e.g. healing mode's tank).
        //     ⚠️ SP-4e (#335): this bullet used to END by citing "a target already dead BEFORE
        //     the cast is caught by the turn-level `skipDeadTargetTurn` guard", a guard that
        //     existed only at the ENEMY call site while this function is walked by BOTH sides.
        //     #346 DELETED it: a resolved victim is drawn from `positionalBinding`'s living-only
        //     `byCell` and can never be a corpse, so the guard's precondition was unsatisfiable
        //     (tripwired in `dummyReachability.test.ts`'s `A RESOLVED VICTIM IS ALIVE`). The
        //     derivation does not need it: the primary argument above is self-sufficient, and an
        //     already-dead bound target is impossible one step EARLIER, at resolution.
        //   Everything below is CORROBORATION: it shows no OTHER actor's mid-round work can
        //   decline the bound target's HP either, so the target is alive at every cast this loop
        //   can reach and not merely un-killable by this loop.
        //   • ⚠️ TWO BULLETS HERE DESCRIBED THE DUMMY SINK AND WENT WITH IT (SP-4c-2d). They said
        //     that a ROSTER-LESS run drove a real destructible `enemy` whose HP landed POST-round
        //     (so nothing declined it mid-round), and that every OTHER non-positional mode bound the
        //     vestigial billion-HP sink, which never DIED even though the round-tail clamp pinned
        //     its `currentHp` at 0. Both shapes are gone: the roster-less run has been impossible
        //     since SP-4b-2b, and the sink itself is deleted. Every bound target is now a real
        //     actor, so this corroboration reduces to the PRIMARY argument above.
        //   • The general reactive-proc funnel (`applyVictimDamage` for a proc victim) used to be
        //     gated `hasPositionedEnemyRoster && victim.id !== enemy.id`, which kept it off a
        //     non-positional bound target. SP-4c-2d deleted both conjuncts (the first was constant
        //     true below the normalization boundary, the second named the deleted dummy), so the
        //     funnel is unconditional — which is why the derivation rests on the PRIMARY argument
        //     (this loop emits only, and its listeners are enqueue-only) rather than on any gate.
        //   • The remaining mid-round `applyVictimDamage` sites do NOT share one gate. An earlier
        //     draft of this comment claimed they were all "gated on `victim.position !== undefined`
        //     or on the victim carrying an ability/kit"; that is WRONG for two of them. The real
        //     grouping:
        //       – POSITION-gated: bomb splash-on-death (engine.ts:4772, `victim.position !==
        //         undefined`) and positioned bomb/accumulator bursts (`applyPositionedTimedBurst`,
        //         engine.ts ~6286, `isPositional(actor.position, opposingRoster)`).
        //       – VICTIM'S-OWN-KIT-gated: the protection redirect (engine.ts ~4181) applies to the
        //         hit victim's own PROTECTORS, and a DoT-tick batch applies to the container's own
        //         carrier. The kit-less sink is never granted Protection and carries no DoTs.
        //       – NEITHER: reflect (engine.ts:4982) and counterattack (engine.ts:5307) resolve
        //         their victim from whoever DELIVERED the triggering hit —
        //         `allActorsById.get(cause.killerId)` and the `counterTargetId` triggers.ts routes
        //         into `applyCounterAttack`'s `attackerId`. Position has nothing to do with it.
        //         They are safe because the vestigial `enemy` never acts as an ATTACKER, so it is
        //         never a killerId or a counterTargetId.
        //   • `forceDetonateBomb` (Lingshe/Heliodor countdown-to-0) has TWO producers and NEITHER
        //     is position-gated. (a) The reactive cleanse path resolves same-side recipients only
        //     (`reactiveRecipients` → 'ally' / 'all-allies' / 'adjacent-allies' / self,
        //     triggers.ts:2118), so it never reaches an opposing id. (b) `reduceEnemyBombs`
        //     (this file, ~2556 → `reduceBombsOnVictim` ~941 → `args.forceDetonateBomb` →
        //     `forceDetonateBombOnVictim`, engine.ts:6252 → `applyVictimDamage`) routes to
        //     OPPOSING victims and never touches `reactiveRecipients`. There is no guard inside it.
        //     WAS-COUPLED-TO (PR5's WARNING, NARROWED — not discharged — by PR6; kept because a
        //     reader tracing why the guard below exists needs to know what it replaced): path (b)
        //     missed the vestigial `enemy` only as an INCIDENTAL SIDE-EFFECT of unrelated plumbing.
        //     `reduceEnemyBombs` bails on `args.targetId === undefined`, and engine.ts's
        //     `buildTurnArgs` deliberately left `targetId` unset whenever the player-side target
        //     resolved to the dummy sink — a BUFF-ROUTING parity choice whose own comment flagged the
        //     unset field as a gap that may later be "fixed". (SP-4c-2d dropped that dummy-sink
        //     conjunct; `targetId` is now unset only on a genuine NO-VICTIM turn.) That was never
        //     an intentional guard on this rule, so PR5 required a maintainer closing that gap to
        //     revisit this derivation: path (b) would then land real mid-cast HP damage on a
        //     non-positional bound target.
        //     WHAT THE OBLIGATION NOW COVERS. PR5's WARNING was about DAMAGE, and the guard below
        //     is an EVENT guard — it stops the loop emitting, not the caller applying. Closing that
        //     `buildTurnArgs` gap would have let path (b) land real mid-cast HP damage on a
        //     non-positional bound target, with the aggregate `directDamage` this function returns
        //     applied on top of it by the caller. SP-4c-2d closed the gap the other way: the
        //     dummy-sink conjunct is gone, `targetId` is unset only on a genuine NO-VICTIM turn, and
        //     every bound target is a real positioned actor — so the shape the obligation was about
        //     no longer exists. It is recorded because the DERIVATION still rests on the PRIMARY
        //     argument, not on any of this. What PR6 removes from the obligation is
        //     only its LOG/EVENT half: however the bound target dies mid-cast, the remaining
        //     sub-attacks emit nothing, so no phantom sub-attack row or rider firing can result.
        //     The damage half stands.
        // The positional path, where the rule is also observable, implements it separately at
        // positionalApply.ts's per-sub-attack anchor re-resolution against `opposingLiving`.
        const emitHits = hits > 0 ? hits : 1;
        for (let h = 0; h < emitHits; h++) {
            // R5 whiff guard (PR6). `destroyedRound` is the bound target's DEATH stamp
            // (state.ts:151, written once by `recordDestroyed`): once set, the remaining
            // sub-attacks land on a corpse and, per R5, deal nothing — so they emit nothing either.
            // Deliberately NOT `currentHp <= 0`, which is an HP FLOOR and not a death: the
            // vestigial sim/healing sink sat clamped at 0 forever without ever dying, and gating
            // on it silenced the focus's whole event stream (see WHICH SIGNAL in the derivation
            // above — that was this guard's first cut, and it was a live regression). SP-4c-2d
            // deleted that sink; the DISTINCTION is not about it (a never-alive actor reads the
            // same way), which is why the signal choice stands.
            // EVENTS only: the cast's `directDamage` is already totalled and is returned to the
            // caller regardless of where this break lands, so the damage half of R5 is not enforced
            // here. Unreachable through any production cast (the derivation above), and
            // INTENTIONALLY built anyway: before PR6 the same outcome depended on engine.ts's
            // `buildTurnArgs` leaving `targetId` unset for the dummy sink, a choice that site's own
            // comment flagged as a gap a maintainer might later close (SP-4c-2d removed both the
            // conjunct and the sink).
            // SP-4c-2b: `enemy` is narrowed non-optional here — the enclosing block is fenced on the
            // victim, so a no-victim turn emits nothing at all rather than reaching this break.
            if (enemy.destroyedRound !== undefined) break;
            // This sub-attack's OWN crit outcome, from the draws the per-hit loop above already
            // collected. `hitCrits` is populated only when a damage ability fired and only for
            // `drawHits` entries, so fall back to the cast-wide binary when it is empty: a noCrit
            // cast (drawHits 0 -> roundCrit false) and a non-damage cast (hitCrits never pushed,
            // hits === 1, roundCrit carries the single draw) both then reproduce exactly the value
            // the old single emit carried.
            const subCrit = hitCrits.length > 0 ? (hitCrits[h] ?? false) : roundCrit;
            bus.emit({
                type: 'ability-performed',
                actorId: actor.id,
                targetId: enemy.id,
                round: r,
                abilityType: 'damage',
                damage: directDamage / emitHits,
                didCrit: subCrit,
                // 1, not the cast-wide `critHits`: this counts the critting VICTIMS within THIS
                // sub-attack, which for the single bound non-positional enemy is exactly the crit
                // binary. That is the SAME meaning the positional path carries
                // (sub.critVictimIds.length), which is what lets triggers.ts's `on-crit` listener
                // drop its second, non-positional branch. At hits === 1 this is identical to the
                // old payload WHENEVER `drawHits` is also 1 — which is every cast the parser can
                // produce, since `hits` and `drawHits` diverge only when a gate lands on an
                // active/charged damage ability (see the KNOWN LIMITATION at the `drawHits` read
                // above). In that hand-authored-only case — a gated-off `hits: 3` ability leaving
                // hits 1 with drawHits 3 — the old payload could carry critHits up to 3 and this
                // one caps at 1. Deliberate: 1 is the CORRECT value under the new per-sub-attack
                // meaning (critting victims in this sub-attack, and there is exactly one bound
                // victim), and the two sentences must not be read as claiming drawHits is always 1.
                ...(subCrit ? { critHits: 1 } : {}),
                // PR4: the outgoing reactive listeners stamp this onto the intents they enqueue so
                // the end-of-turn drain — which runs once per turn, after every sub-attack — can
                // gate at sub-attack scope (`passesProcChanceGate`'s memo key; the per-victim
                // `firedKey` in the reactive-damage branch). Emitted unconditionally now that this
                // path has a real sub-attack identity. Safe at hits === 1: both maps
                // (`procDecisionThisSubAttack`, `reactionFiredThisAttack`) are cleared at every
                // actor turn-start (engine.ts:7730/7735) and both keys are already owner-scoped,
                // so moving the suffix from 'x' to 0 is a pure rename with no collision.
                subAttackIndex: h,
                didHit: true,
            });
        }
    }

    extendDoTs({
        abilities: [...(firingSkill?.abilities ?? []), ...(passiveSkill?.abilities ?? [])],
        ctx,
        effectiveCritDamage,
        extendChanceGate,
        corrosionEntries,
        infernoEntries,
    });

    // SP-F F3 (Lingshe): countdown-reduces + force-detonates enemy Bombs. Runs BEFORE
    // applyNewDoTs (mirrors extendDoTs' ordering immediately above) so a Bomb III THIS cast
    // inflicts is never itself reduced.
    // SP-4c-2b: the whole call is fenced on the victim — its `anchor` IS the victim, and with none
    // there is no opposing Bomb for this cast to reduce or force-detonate. Inert on that path
    // regardless (plan §A.4: the ghost's `pendingBombs` measured empty on every such turn).
    if (hasVictim) {
        reduceEnemyBombs({
            gatedSkill,
            ctx,
            anchor: enemy,
            targetId,
            aoeVictimIds,
            opposingVictimById,
            round: r,
            bus,
            detonatorId: actor.id, // Ship-kit W7: the countdown-reduce caster is the detonator.
            landsTimedEnemyApplicationLive,
            forceDetonateBomb: args.forceDetonateBomb,
        });
    }

    // += (not =): with a FASTER enemy, the enemy's bomb/accumulator bursts
    // run earlier in the round — a plain assignment would clobber them.
    // Identical at default order (the accumulator resets to 0 each round).
    // This is the player-turn portion; the caller folds it into the round
    // accumulator's detonationDamage with += (the enemy turn may have already
    // added bursts this round at a faster speed).
    let detonationDamage = 0;
    let positionalDetonation: DetonationRecipe | undefined;
    if (positional) {
        // Positional: DO NOT detonate the anchor (no consume/credit/emit). Expose the recipe so the
        // engine detonates each footprint victim's own containers. detonationDamage stays 0.
        //
        // OWN-STACK PROTECTION: the engine consumes this recipe at the END of the positional apply,
        // i.e. AFTER Step 3 (applyNewDoTs) below has appended this cast's own DoTs — so without a
        // guard a detonate-and-reinflict skill would eat the very stack it just planted (the exact
        // hazard Step 2.95's before-Step-3 ordering prevents on the non-positional path: a bomb
        // planted by such a skill could then NEVER survive to count down and burst). Snapshot the
        // entries that exist RIGHT NOW — identities, so it holds across every victim this cast may
        // append to (the anchor's containers plus any splash victim's) regardless of order.
        const detonatable = new Set<ActiveDoTStack | PendingBomb>();
        const collectDetonatable = (v: {
            corrosionEntries: ActiveDoTStack[];
            infernoEntries: ActiveDoTStack[];
            pendingBombs: PendingBomb[];
        }): void => {
            for (const e of v.corrosionEntries) detonatable.add(e);
            for (const e of v.infernoEntries) detonatable.add(e);
            for (const b of v.pendingBombs) detonatable.add(b);
        };
        // The anchor's containers arrive as loose params (until SP-4c-2d they could be the dummy
        // sink's), so collect them directly; the footprint/splash victims come from the opposing
        // roster map.
        collectDetonatable({ corrosionEntries, infernoEntries, pendingBombs });
        for (const victim of opposingVictimById?.values() ?? []) collectDetonatable(victim);
        positionalDetonation = {
            dets: detonationsFromSkill(gatedSkill),
            effectiveAttack,
            dotMult,
            affinityMult,
            detonationMult: 1 + dmgStats.detonationDamageModifier / 100,
            detonatable,
        };
    } else if (hasVictim) {
        // SP-4c-2b: fenced on the victim — this branch bursts the VICTIM's own DoT/bomb containers and
        // its `bomb-detonated` event names that victim. With none there is nothing to detonate (plan
        // §A.4: the ghost's containers measured empty on every ally-targeted turn) and
        // `detonationDamage` correctly stays 0.
        detonationDamage = detonate({
            gatedSkill,
            effectiveAttack,
            enemyHp,
            dotMult,
            affinityMult,
            detonationMult: 1 + dmgStats.detonationDamageModifier / 100,
            corrosionEntries,
            infernoEntries,
            pendingBombs,
            emitBombDetonated: (stacks, damage) =>
                bus.emit({
                    type: 'bomb-detonated',
                    actorId: actor.id,
                    victimId: enemy.id,
                    // Ship-kit W7: this cast's own detonate ability caused the burst — the caster
                    // IS the detonator (here actorId and detonatorId coincide, but they diverge on
                    // the reduceBombsOnVictim path where actorId is the original applier).
                    detonatorId: actor.id,
                    round: r,
                    stacks,
                    damage,
                }),
        });
    }

    // Step 3: Apply new DoT stacks from this round's skill (subject to landing roll).
    // Block Debuff (Task 6): when the turn target is immune, every cast-side DoT is
    // BLOCKED and recorded as a resist here. Normal DoT landing-roll failures (the else
    // branch's `else if`) ALSO emit a resist event now (a resisted DoT is a log line,
    // symmetric with stat-debuff resists) — the two paths differ only in cause (immunity
    // vs a failed roll). `dotsLanded` is set false so the downstream display surfaces the
    // blocked DoTs as resisted (symmetric with timed/persistent resists).
    let dotsLanded: boolean;
    if (!hasVictim) {
        // SP-4c-2b: no victim — this cast's DoT clauses have nobody to be inflicted on, so none is
        // applied and none is resisted (a resist implies a target that resisted it), and no landing
        // draw is taken. Fenced HERE, at the whole primary-DoT clause, rather than at the three
        // events inside it (`dot-applied` and the two resist emits all name their victim).
        // `dotsLanded` is vacuously true with no draw taken — the same reading the
        // no-DoTs-configured case gets in the else branch below. `true` is only honest because the
        // REPORTED list is emptied to match at the return (`dotsConfig:` there); see that comment
        // for why `false` would be worse than `true` and why emptying the list is the real answer.
        dotsLanded = true;
    } else if (dotsConfig.length > 0 && targetImmuneToDebuffs) {
        dotsLanded = false;
        for (const dot of dotsConfig) {
            // NOTE: a blocked `bomb` DoT emits the resist event but has NO `resistedDots`
            // row — the engine's resistedDots derivation filters to corrosion/inferno only
            // (bombs are display-only elsewhere too). Event-yes/surface-no is intentional.
            emitBlockDebuffResist(bus, actor.id, enemy.id, r, dotResistLabel(dot.type, dot.tier));
        }
    } else {
        // DoTs gate at application: draw the shared per-round roll only when there are
        // DoTs to apply this round (memoized — shares the recurring partition's single
        // draw). With nothing to apply, dotsLanded is vacuously true (no draw taken),
        // preserving the all-landing fixtures where no-DoT rounds report dotsLanded:true.
        dotsLanded = dotsConfig.length > 0 ? roundDebuffLanded() : true;
        // Capture pre-application lengths so 'inflicted'-scope extensions touch only
        // the entries this cast adds below (the slice from these indices onward).
        const corrosionEntriesBefore = corrosionEntries.length;
        const infernoEntriesBefore = infernoEntries.length;
        // Ship-kit W5 Task B2: 'adjacent-enemies' (neighbours-only) is filtered OUT of the
        // primary apply — it is applied only via the splash loop below. Corpus has no
        // adjacent-only DoT, so primaryDots === dotsConfig today → zero behaviour change.
        const primaryDots = dotsConfig.filter((d) => d.splashTarget !== 'adjacent-enemies');
        if (dotsLanded) {
            applyNewDoTs({
                dotsConfig: primaryDots,
                effectiveAttack,
                affinityMult,
                detonationDamageModifier: dmgStats.detonationDamageModifier,
                splashModifier: dmgStats.bombSplashModifier,
                sourceId: actor.id,
                corrosionEntries,
                infernoEntries,
                genericDoTEntries,
                pendingBombs,
                emitDotApplied: (dotType, stacks, tier) =>
                    bus.emit({
                        type: 'dot-applied',
                        sourceId: actor.id,
                        targetId: enemy.id,
                        round: r,
                        dotType,
                        stacks,
                        tier,
                        ...(critHits > 0 ? { viaCrit: true } : {}),
                    }),
            });
        } else if (dotsConfig.length > 0) {
            // Landing roll FAILED → the DoT(s) resisted. Emit a resist event per DoT so the
            // combat log shows "Inferno III resisted" etc., symmetric with the stat-debuff
            // resist path (emitDebuffResisted) and the Block-Debuff branch above. `primaryDots`
            // filters out adjacent-only splash DoTs (which land on OTHER victims, not enemy.id) —
            // corpus has none today, so this equals dotsConfig, but stays victim-correct if one
            // is ever added.
            for (const dot of primaryDots) {
                emitBlockDebuffResist(
                    bus,
                    actor.id,
                    enemy.id,
                    r,
                    dotResistLabel(dot.type, dot.tier)
                );
            }
        }

        // Step 3a: 'inflicted'-scope extensions grow ONLY this cast's new DoTs
        // (Valerian). Sourced from the same firing+passive ability set as Step 2.9.
        // Guarded by dotsLanded (like applyNewDoTs/applyAccumulators): when the
        // landing roll failed nothing was appended, and skipping the call keeps
        // the deterministic extendChanceGate schedule free of phantom draws.
        if (dotsLanded) {
            extendInflictedDoTs({
                abilities: [...(firingSkill?.abilities ?? []), ...(passiveSkill?.abilities ?? [])],
                ctx,
                effectiveCritDamage,
                extendChanceGate,
                corrosionEntries,
                infernoEntries,
                corrosionEntriesBefore,
                infernoEntriesBefore,
            });
        }

        if (dotsLanded) {
            applyAccumulators({ gatedSkill, pendingAccumulators, sourceId: actor.id });
        }
    }

    // Ship-kit W5: fan splash-scoped DoTs (Asphyxiator active Inferno) onto the target's
    // board-neighbours. 'target-and-adjacent-enemies' hits the primary via the block above
    // ('adjacent-enemies', neighbours-only, is filtered OUT of the primary apply and applied
    // ONLY here). Runs INDEPENDENTLY of the primary's Block-Debuff immunity/`dotsLanded` gate
    // above (review fix, B2) — each neighbour rolls its OWN landing via `landsDebuffOnVictim`
    // (Block-Debuff + hacking-vs-security, mirrors PR #185 for non-DoT debuffs), so a neighbour
    // can be hit even when the primary resists (immune or failed its own roll), and vice versa.
    // Positional-only: adjacentEnemyIdsFor returns [] / is undefined for a target with no board
    // slot — which, until SP-4c-2d, meant the DPS dummy sink (targetId was unset there), so DPS was
    // byte-identical. affinityMult reused as the caster's
    // own value (correct for the corpus: Asphyxiator's splash is Inferno, which doesn't consume
    // affinityMult at apply time; only pendingBombs snapshot it, and no corpus bomb-DoT splashes
    // exist) — true per-victim affinity is deferred.
    const splashDots = dotsConfig.filter((d) => d.splashTarget !== undefined);
    if (splashDots.length > 0 && targetId !== undefined && adjacentEnemyIdsFor) {
        for (const rid of adjacentEnemyIdsFor(targetId)) {
            const victim = opposingVictimById?.get(rid);
            if (!victim) continue;
            if (!landsDebuffOnVictim('inflict', victim)) {
                // Per-neighbour landing gate FAILED → resisted. Emit a resist per splash DoT
                // against the neighbour id, symmetric with the primary-DoT resist path above
                // (a resisted DoT is a log line). Live for Asphyxiator's target-and-adjacent-
                // enemies Inferno (a neighbour that resists now surfaces a resist line);
                // the neighbours-only 'adjacent-enemies' variant has no corpus yet.
                for (const dot of splashDots) {
                    emitDebuffResisted(dotResistLabel(dot.type, dot.tier), rid);
                }
                continue;
            }
            applyNewDoTs({
                dotsConfig: splashDots,
                effectiveAttack,
                affinityMult,
                detonationDamageModifier: dmgStats.detonationDamageModifier,
                splashModifier: dmgStats.bombSplashModifier,
                sourceId: actor.id,
                corrosionEntries: victim.corrosionEntries,
                infernoEntries: victim.infernoEntries,
                genericDoTEntries: victim.genericDoTEntries,
                pendingBombs: victim.pendingBombs,
                emitDotApplied: (dotType, stacks, tier) =>
                    bus.emit({
                        type: 'dot-applied',
                        sourceId: actor.id,
                        targetId: rid,
                        round: r,
                        dotType,
                        stacks,
                        tier,
                        ...(critHits > 0 ? { viaCrit: true } : {}),
                    }),
            });
        }
    }

    // On-cast buff-steal (PR10): move the newest removable TIMED buff(s) held by the acting
    // actor's target onto the caster — and, when the ability says so, every living adjacent
    // ally of the caster (Tithonus) — via statusEngine.steal. Keyed off targetId, same
    // side-symmetric pattern as the on-cast purge loop below (works for player AND enemy
    // casters; no healEventOnly gate — a buff transfer, not a heal/shield/cleanse consumption).
    // A run whose target was the dummy sink (no buffs on its empty self-store) had
    // statusEngine.steal find nothing → [] → no-op → byte-identical. That stopped being the DPS
    // calculator at SP-4b-2a — a DPS cast anchors on a real positioned enemy and CAN steal from it,
    // which is correct, and inert only because the synthesized stand-in grants itself none — and
    // SP-4c-2d deleted the sink, so no cast anchors on one at all.
    //
    // ORDER (Finding 1): this block runs BEFORE the on-cast purge block below. The sole corpus
    // ship carrying both in one skill (Tithonus) reads "steals 1 buff ... THEN purges 2 buffs",
    // so the steal must see the target's FULL buff set and take its NEWEST buff; the purge then
    // strips from what remains. Running purge first would let it remove the newest buffs before
    // the steal, handing the caster a stale/older buff (or nothing).
    if (targetId !== undefined) {
        for (const ab of gatedSkill?.abilities ?? []) {
            if (
                ab.config.type === 'buff-steal' &&
                ab.trigger === 'on-cast' &&
                conditionsMet(ab.conditions, ctx)
            ) {
                const recipients = ab.config.grantAdjacentAllies
                    ? [actor.id, ...(adjacentAllyIds ?? [])]
                    : [actor.id];
                statusEngine.steal(targetId, recipients, ab.config.count);
            }
        }
    }

    // On-cast purge (C2a/C2b-3): remove buffs from the acting actor's target. Keyed off targetId
    // (the opposing victim) → side-symmetric (works for player AND enemy casters; no
    // healEventOnly gate). gatedSkill holds the fired slot's abilities. A dummy-sink target (no
    // buffs) was a no-op → byte-identical; since SP-4b-2a that stopped being the DPS calculator,
    // whose cast anchors on a real positioned enemy, and SP-4c-2d deleted the sink outright. NOT
    // inside the args.healing gate.
    // conditionsMet() enforces any ability-level gates (e.g. Nayra's target-repaired-this-round
    // condition) so conditional purges only fire when their precondition holds.
    // E3: 'all-enemies' purge ability fans over the footprint victims (aoeVictimIds) instead of just targetId.
    if (targetId !== undefined) {
        for (const ab of gatedSkill?.abilities ?? []) {
            if (
                ab.config.type === 'purge' &&
                ab.trigger === 'on-cast' &&
                conditionsMet(ab.conditions, ctx)
            ) {
                // E3: an 'all-enemies' purge fans out to EVERY footprint victim (aoeVictimIds,
                // supplied by the engine in positional mode). Single-'enemy' purges — and any
                // caller without a footprint (non-positional) — stay on the single anchor
                // `targetId`. Each victim emits its own purge-performed (Salvation/Sefuba are
                // victim-scoped). (Amartya's per-victim COUNT scaling is E4; this ships at the
                // parsed count.)
                // I6: an 'enemy-most-buffs' purge (Lodolite's charged skill) resolves to the
                // engine-supplied enemyMostBuffsId instead of the normal positional anchor
                // (targetId) — the reactive counterpart (Rhodium, end-of-round) resolves this
                // itself via triggers.ts and never reaches this on-cast path. Falls back to the
                // anchor when no living opposing actor carries a buff (mostBuffsAmong's
                // no-buffs-anywhere case) or for a non-positional/DPS caller that never supplies
                // enemyMostBuffsId — byte-identical to pre-I6 behavior in both cases.
                const recipients =
                    ab.target === 'all-enemies' && aoeVictimIds
                        ? aoeVictimIds
                        : ab.target === 'enemy-most-buffs' && enemyMostBuffsId !== undefined
                          ? [enemyMostBuffsId]
                          : [targetId];
                // E4: when the purge scales on crit power, total purged per victim =
                // count × floor(live effectiveCritDamage / per). effectiveCritDamage (~line 1104 =
                // dmgStats.critDamage) is the caster's LIVE crit power (buffs/debuffs folded),
                // integer percent (e.g. 150). Hoisted out of the victim loop — constant within a cast.
                const scaling = ab.config.countScaling;
                // Guard `per` (defensive: the parser only emits per≥1 from `\d+`, but a
                // hand-built config with per<=0/non-finite would make floor(x/per) Infinity/NaN).
                let purgeCount: number | 'all' = ab.config.count;
                if (
                    scaling &&
                    typeof ab.config.count === 'number' &&
                    Number.isFinite(scaling.per) &&
                    scaling.per > 0
                ) {
                    purgeCount =
                        ab.config.count *
                        Math.max(0, Math.floor(effectiveCritDamage / scaling.per));
                }
                for (const vid of recipients) {
                    const removed = statusEngine.purge(vid, purgeCount);
                    if (removed > 0) {
                        bus.emit({
                            type: 'purge-performed',
                            casterId: actor.id,
                            targetId: vid,
                            count: removed,
                            round: r,
                        });
                        // I6: Lodolite legendary refit — "When this Unit Purges a buff from an
                        // enemy, it removes 100% of the enemy's shield." Gated on the parsed
                        // ability config (stripsShield), never a hardcoded ship name — see
                        // detectPurgeStripsShield/buildShipAbilities. Strips AFTER the purge
                        // resolves, on the SAME victim id (vid). Team-symmetric for free: this
                        // function runs identically for player and enemy casters (see the
                        // "side-symmetric" note above), so an enemy-side ship carrying this
                        // config strips a player shield the same way. Mirrors the victim-lookup
                        // fallback used by the per-victim debuff-landing loop above (opposingVictimById
                        // in positional mode; the anchor `enemy` actor otherwise). This makes the
                        // strip POSITIONAL-SCOPED by the same design as every other per-victim effect:
                        // in a non-positional cast opposingVictimById is absent and per-victim
                        // resolution intentionally no-ops (the sim's per-victim fidelity is a
                        // positional feature) — the real battle sim always positions actors, so a
                        // resolved enemy-most-buffs victim is always in opposingVictimById.
                        if (ab.config.stripsShield) {
                            // SP-4c-2b: the anchor fallback arm drops out when there is no victim —
                            // no victim means no anchor id for `vid` to match.
                            const victim =
                                opposingVictimById?.get(vid) ??
                                (hasVictim && vid === enemy.id ? enemy : undefined);
                            if (victim) stripShieldPct(victim, 100, bus, actor.id, r);
                        }
                    }
                }
            }
        }
    }

    // PR9(b): standalone "removes X% of the enemy Shield" (APEX/Laika/Malvex) — NOT gated on a
    // purge landing (that's the I6 branch above). Fires on-cast against the skill's own
    // damage target(s), side-symmetric for the same reason as the purge block above (this
    // function runs identically for player and enemy casters).
    if (targetId !== undefined) {
        for (const ab of gatedSkill?.abilities ?? []) {
            if (
                ab.config.type === 'shield-strip' &&
                ab.trigger === 'on-cast' &&
                conditionsMet(ab.conditions, ctx)
            ) {
                const recipients =
                    ab.target === 'all-enemies' && aoeVictimIds ? aoeVictimIds : [targetId];
                for (const vid of recipients) {
                    // SP-4c-2b: anchor fallback arm dropped when there is no victim (as at the I6
                    // purge-strip site above).
                    const victim =
                        opposingVictimById?.get(vid) ??
                        (hasVictim && vid === enemy.id ? enemy : undefined);
                    if (victim) stripShieldPct(victim, ab.config.pct, bus, actor.id, r);
                }
            }
        }
    }

    // Wave 4 (Task 6): on-cast extend-status (Sokol charged debuff-extend; Ripper passive
    // all-allies buff-extend; Lev charged all-enemies debuff-extend gated on self-crit). Pure
    // StatusEngine duration mutation — side-symmetric (mirrors the purge/steal/shield-strip
    // blocks above: runs identically for player AND enemy casters, OUTSIDE the healing gate).
    // Sourced from BOTH the firing slot (gatedSkill: Sokol/Lev, charged) AND the always-active
    // passive slot (gatedPassive: Ripper) — mirroring the healAbilities combine (:2733-2739
    // below) and the extendDoTs/extendInflictedDoTs combine (:2236/:2351 above), since a
    // gatedSkill-only scan (like the purge/steal loops, whose abilities are never passive-slot
    // in the corpus) would silently skip Ripper's passive-slot extend ability.
    // conditionsMet(ab.conditions, ctx) evaluates Lev's self-crit gate against THIS cast's live
    // `ctx.roundCrit` (set at buildRoundContext above from `roundCrit = critHits > 0`) — the
    // SAME ctx the purge/steal blocks gate against, so a non-crit cast correctly suppresses
    // Lev's extension (see evaluateConditions.ts's 'self-crit' case, binary off ctx.roundCrit).
    // The DEBUFF branch targets enemies, so it requires a hit target (targetId / aoeVictimIds)
    // and is skipped when there is none — a NO-VICTIM turn, and before SP-4c-2d the DPS dummy sink,
    // both of which leave targetId unset. The
    // BUFF branch (Ripper 'all-allies') needs NO enemy target — it must run regardless of
    // targetId, otherwise the ally/self buff-extend is silently dropped in DPS mode and on any
    // enemy-less cast. extendAll{Debuffs,Buffs}Duration return 0 against an empty/missing store,
    // so both branches no-op harmlessly when the relevant roster is empty.
    for (const { ability: ab, fromPassive } of [
        ...(gatedSkill?.abilities ?? []).map((ability) => ({ ability, fromPassive: false })),
        ...(gatedPassive?.abilities ?? []).map((ability) => ({ ability, fromPassive: true })),
    ]) {
        if (
            ab.config.type !== 'extend-status' ||
            ab.trigger !== 'on-cast' ||
            !conditionsMet(ab.conditions, ctx)
        ) {
            continue;
        }
        const { statusKind, turns } = ab.config;
        if (statusKind === 'debuff') {
            // Sokol: single hit enemy (targetId). Lev: fans over the cast's hit-enemy footprint
            // (aoeVictimIds) for an 'all-enemies' target — same E3 pattern the purge/shield-strip
            // blocks above use. Requires a hit target; skipped when there is none.
            if (targetId === undefined) continue;
            const recipients =
                ab.target === 'all-enemies' && aoeVictimIds ? aoeVictimIds : [targetId];
            for (const vid of recipients) {
                statusEngine.extendAllDebuffsDuration(vid, turns);
            }
        } else {
            // Ripper: 'all-allies' — same allyRoster pattern the ally-charge-gain block uses
            // (:2118-2123 above): healing-mode roster when present, else the live same-side
            // roster, narrowed through supportRecipients (the caster's own footprint pattern,
            // if any — undefined pattern/anchor leaves the roster unfiltered, so Ripper's own
            // buffs extend too, matching "All allies extend their active Buffs"). Independent of
            // targetId — an ally buff-extend needs no enemy target.
            const isEnemyCaster = actor.side === 'enemy';
            const allyRoster = args.healing
                ? isEnemyCaster
                    ? args.healing.enemyIds
                    : args.healing.playerIds
                : (sameSideLiving ?? []).map((a) => a.id);
            // SP-4e: 'lowest-hp-ally' is a NAMED single-recipient selector, so it is resolved
            // HERE from live HP rather than handed to supportRecipients — that helper only
            // FILTERS its base, so passing it the whole allyRoster would fan a single-recipient
            // target out to every ally. Not footprint-scoped: the selector reaches its ally
            // wherever they stand. Resolves to nobody when the caster is the only living ally.
            const recipients =
                ab.target === 'lowest-hp-ally'
                    ? lowestHpAllyRecipients({
                          casterId: actor.id,
                          candidateIds: allyRoster,
                          hpFractionOf: allyHpFractionOf,
                      })
                    : supportRecipients(ab.target, allyRoster, {
                          ability: ab,
                          fromPassive,
                      });
            for (const rid of recipients) {
                statusEngine.extendAllBuffsDuration(rid, turns);
            }
        }
    }

    // ====================================================================
    // HEALING MODE — heal/shield/cleanse consumption against the live heal
    // target (healing-calc adoption). FULLY GATED on `args.healing`: DPS mode
    // never supplies it, so this block is inert there (goldens byte-identical).
    // Runs at a fixed sequence point AFTER all DoT-application steps and BEFORE
    // the turnCtx assembly. Processes gated firing + passive abilities in array
    // order; heals draw the SEPARATE per-actor heal crit gate (never the damage
    // crit gate). HoT (hotHeal) ticking is Task 7 — not produced here.
    // ====================================================================
    // The cast's DELIVERED total, filled in only when the support pass is deferred to the engine
    // (see `deferCastSupport` below). Undefined on every inline path, where `directDamage` remains
    // the basis — which is what keeps the healing calculator and every non-positional fixture
    // byte-identical.
    let castDeliveredDamage: number | undefined;
    /** Set only when the support pass deferred; the engine invokes it after the funnel with the
     *  cast's delivered total. Surfaced on the result as `resolveCastSupport`. */
    let deferredCastSupport: ((deliveredTotal: number) => void) | undefined;
    if (args.healing) {
        const healing = args.healing;
        const healCritGate = action === 'charged' ? chargedHealCritGate : activeHealCritGate;
        // Recipient's incoming-heal %: the acting actor reads its own LOCAL folded total;
        // any other recipient resolves through lastTurnCtxByActor (may be stale/base for a
        // non-target non-self recipient — an accepted approximation, see plan).
        const incomingPctFor = (rid: string): number =>
            rid === actor.id
                ? dmgStats.totals.incomingHealBuff
                : healing.recipientIncomingHealPct(rid);
        // D-PR5: caster-side heal-cast amplification (Nourishment/Vivacious), sourced from the
        // passive slot. Per recipient, fold (1 + ampPct/100) into the cast-heal raw. With no
        // heal-amplification ability OR no engine-supplied proc gate, the guard short-circuits to
        // 0 (and never rolls) → byte-identical for every fixture without one.
        const healAmpAbilities = (passiveSkill?.abilities ?? []).filter(
            (a) => a.config.type === 'heal-amplification'
        );
        // Recipient HP% at cast time: live ctx via recipientActor/recipientMaxHp; fall back to the
        // engine-threaded targetHpPct for the heal target before it has a ctx, else 100.
        const recipientHpPctFor = (rid: string): number => {
            const max = healing.recipientMaxHp(rid);
            const a = healing.recipientActor(rid);
            if (a && max > 0) return (100 * Math.max(0, a.currentHp)) / max;
            if (rid === healing.targetId) return targetHpPctArg;
            return 100;
        };
        // Summed amp % for ONE cast on recipient `rid`. Rolls each ability's proc gate exactly
        // once (call this ONCE per recipient per cast). selfHpPctArg = the caster's live HP%.
        const healAmpPctFor = (rid: string): number =>
            healAmpAbilities.length > 0 && rollOutgoingProc
                ? healAmplificationForCast(
                      healAmpAbilities,
                      { targetHpPct: recipientHpPctFor(rid), selfHpPct: selfHpPctArg },
                      rollOutgoingProc
                  )
                : 0;
        // Recipient routing (user-confirmed): self → caster; `lowest-hp-ally` → the worst-HP living
        // ally on the caster's own side (caster excluded, nobody if it is alone); `ally` and
        // `all-allies` → the caster's own side in fixed source order, narrowed by its support
        // footprint. Shared by the heal + shield branches. SP-4e Task 4 replaced "ally → the
        // bombarded target" with the footprint route and deleted the run-mode arms that chose
        // between them.
        const isEnemyCaster = actor.side === 'enemy';
        // SP-4e: resolver for the `'lowest-hp-ally'` TARGET (Pallas, Volk, Valkyrie), which the
        // ability's own TEXT names — no longer a mode-flag route. Lowest HP FRACTION among living
        // same-side allies, caster excluded, ties broken by source order.
        // Returns UNDEFINED when the caster is the only living ally: Pallas says "the OTHER ally",
        // so there is nobody, and the pre-4e `?? actor.id` tail made that a self-heal her text
        // forbids. Callers must handle undefined by producing NO recipient.
        //
        // The ranking itself lives ONCE, in `lowestHpAllyRecipients` (supportRecipients.ts) — this
        // is only the per-turn binding of the caster id and the live HP reader. The hand-copy that
        // used to stand here disagreed with the shared helper on exactly the lone-caster case, so
        // routing `recipientsFor` through the copy would have re-created the forbidden self-heal.
        // `allyHpFractionOf` reads the healing ctx's buff-aware `recipientMaxHp` (requirement (b)
        // in the helper's doc), and both id lists below arrive in fixed source order (requirement
        // (a), the tie-break).
        const lowestHpAllyId = (ids: string[]): string | undefined =>
            lowestHpAllyRecipients({
                casterId: actor.id,
                candidateIds: ids,
                hpFractionOf: allyHpFractionOf,
            })[0];
        const recipientsFor = (ability: Ability, fromPassive: boolean): string[] => {
            const target = ability.target;
            const ownSideIds = isEnemyCaster ? healing.enemyIds : healing.playerIds;
            // SP-4e: a named selector is NEVER footprint-scoped — it reaches its ally wherever
            // they stand, on either slot (user-confirmed 2026-08-20). Returns directly.
            if (target === 'lowest-hp-ally') {
                const rid = lowestHpAllyId(ownSideIds);
                return rid === undefined ? [] : [rid];
            }
            // Everything else routes over the caster's own side and is narrowed by the support
            // footprint. `'ally'` included: an unspecified single ally means "the ship's target
            // pattern" (user-confirmed 2026-08-20). The pre-4e mode-flag arms are GONE —
            // `isEnemyCaster`/`teamBattle` lowest-HP routing and the `[healing.targetId]`
            // fallback. Routing now comes from the ability's TEXT, not from the run mode, so the
            // two sides are symmetric by construction rather than by two mirrored branches.
            //
            // ⚠️ `'ally'` MEANS THREE DIFFERENT THINGS in this engine. It is not a typo when you
            // find them disagreeing — each is the right answer for its own path, and none of the
            // three is derivable from the others:
            //   1. HERE (the CAST path) — the caster's whole own side narrowed by its support
            //      footprint, not one ally. Owner ruling 2026-08-21: a plain `'ally'` clause covers
            //      the same allies as its co-cast buff, and on every shipped kit that reaches this
            //      branch the sibling clause in the SAME sentence parses to `all-allies`
            //      ("grants Defense Up III **and** cleanses 1 debuff"). So `'ally'` and
            //      `'all-allies'` resolve IDENTICALLY here — the parsed distinction survives only
            //      because it still matters on path 2. The 10 shipped abilities that land here are
            //      all cleanses (AEGIS, Cultivator ×2, Harvester, Makoli, Nyxen ×2, Paracelsus,
            //      Purifier ×2); plain-`'ally'` cast heals and shields are corpus-empty. Pinned by
            //      `plainAllyCleanseFootprintReach.integration.test.ts`, both placements.
            //   2. The REACTIVE path (`reactiveRecipients`, triggers.ts) — ONE ally, derived from
            //      the triggering EVENT (`cleansedAllyIds` / `damagedAllyId`, falling back to the
            //      heal anchor). Deliberately NOT this branch's footprint meaning: a passive that
            //      says "repairs THAT ally" names a specific ally the event identified.
            //   3. The standing-leech proc (`procStandingLeechesPerVictim`, engine.ts) — the player
            //      heal anchor, or NOBODY for an enemy owner. Corpus-dead and logged as an open
            //      residual at its own site.
            const base = target === 'self' ? [actor.id] : ownSideIds;
            return supportRecipients(target, base, { ability, fromPassive });
        };
        // Basis value for a heal/shield ability against recipient `rid`.
        const basisValue = (
            basis:
                | 'hp'
                | 'attack'
                | 'defense'
                | 'target-hp'
                | 'damage-dealt'
                | 'damage-taken'
                | 'overheal',
            rid: string
        ): number => {
            switch (basis) {
                case 'attack':
                    return effectiveAttack;
                case 'defense':
                    return effectiveDefence;
                case 'target-hp':
                    return healing.recipientMaxHp(rid);
                // Cast rider (active/charged 'damage-dealt'): the damage this cast actually
                // DELIVERED, summed over its whole footprint — the locked "% of damage dealt"
                // rule (a Protection redirect counts, a DoT transform does not). That number is
                // produced by the engine's per-victim funnel, which runs AFTER this turn returns,
                // so a cast carrying such a rider defers its whole support pass and the engine
                // fills `castDeliveredDamage` before invoking it.
                //
                // The `directDamage` fallback is not a safety net, it is the correct answer for
                // every path that does not defer: no positional apply runs there, so there is no
                // funnel for the two figures to disagree across. It is the local pre-funnel cast
                // damage (incl. secondary/conditional sub-buckets and the passive hit; detonation
                // excluded by spec), computed against the bound anchor.
                //
                // The slot-partition guard below keeps passive-slot 'damage-dealt' and all
                // 'damage-taken' abilities off the cast path, so basisValue only sees
                // 'damage-dealt' for active/charged riders; 'damage-taken' never reaches here.
                case 'damage-dealt':
                    return castDeliveredDamage ?? directDamage;
                case 'damage-taken':
                    throw new Error(
                        'basisValue: damage-taken must not reach the cast path (slot-partition guard owns it)'
                    );
                // 'overheal' is a reactive-only basis (on-own-repair-to-ally; Abundant Renewal):
                // the clipped over-repair is known only at drain time via eventCtx.overhealAmount,
                // so it never reaches the cast path.
                case 'overheal':
                    throw new Error(
                        'basisValue: overheal must not reach the cast path (reactive-only basis)'
                    );
                case 'hp':
                default:
                    return effectiveHp;
            }
        };

        // ── HoT (Repair Over Time) ticking ──────────────────────────────────────────
        // Ordering note (RECORDED APPROXIMATION, pending in-game verification — coverage doc §6):
        // these ticks fire here, BEFORE this turn's cast heals, but the HoT SOURCES are read
        // AFTER this turn's own status/buff applications. Consequence: a HoT a ship grants to
        // ITSELF this turn already appears in selfAbilityStatuses/activeSelfBuffs and therefore
        // ticks on its OWN cast turn (not only on subsequent turns). The healing goldens lock
        // this behaviour; do not change it without re-validating the in-game rule.
        // The HOLDER (this acting actor) heals each of its own turns for
        // applierEffectiveMaxHp × hotPct% × stacks, attributed to the APPLIER's hotHeal
        // bucket (mirrors DoT sourceId attribution). HoT heals NEVER crit and ignore
        // healModifier/outgoingHeal (they are the applier's standing effect, not a cast),
        // but DO get the HOLDER's incomingHeal amplification (dmgStats.totals.incomingHealBuff,
        // since the holder is the acting actor). Holder === target → the consumption split
        // (applyHealToTarget) is credited to the APPLIER's effectiveHeal/overheal.
        //
        // Applier max HP at tick time:
        //  - applier === this acting actor (self-granted HoT) → local effectiveHp.
        //  - foreign applier → healing.applierMaxHp(applierId); undefined → SKIP the tick
        //    (strict corrosion rule, NO base-stat fallback).
        //  - scheduled HoT (no caster identity) → applier = the holder itself (local effectiveHp).
        //
        // Sources are DISJOINT (no double-count): payload-carrying ability statuses
        // (selfAbilityStatuses = timed + active, payload.parsedEffects.hotPct × payload.stacks,
        // applier = status.casterId) and scheduled snapshot buffs (entry.activeSelfBuffs ×
        // selfBuffLookup, expanded SelectedGameBuff.parsedEffects.hotPct × stacks, applier = holder).
        const holderIncomingFactor = 1 + dmgStats.totals.incomingHealBuff / 100;
        // Resolve the applier's effective max HP for a HoT tick; undefined → caller skips.
        const hotApplierMaxHp = (applierId: string | undefined): number | undefined => {
            if (applierId === undefined || applierId === actor.id) return effectiveHp;
            return healing.applierMaxHp(applierId);
        };
        // Credit one HoT tick (raw = applierMaxHp × hotPct% × stacks × holderIncomingFactor)
        // to the applier's hotHeal bucket, and route consumption (holder === target) to the
        // applier's effectiveHeal/overheal.
        const tickHot = (applierId: string | undefined, hotPct: number, stacks: number): void => {
            if (hotPct <= 0 || stacks <= 0) return;
            const maxHp = hotApplierMaxHp(applierId);
            if (maxHp === undefined) return; // foreign applier with no ctx yet → skip the tick
            // Scheduled HoT (no caster) attributes to the holder; otherwise to the applier.
            const creditId = applierId ?? actor.id;
            let raw = maxHp * (hotPct / 100) * stacks * holderIncomingFactor;
            // D-PR6: recipient-side incoming-heal amplification (Exuberance) — the HoT recipient is
            // the holder (actor.id). Rolls its combat-lifetime gate ONCE per tick (0 → byte-identical).
            raw *= 1 + (healing.recipientIncomingHealAmpPct?.(actor.id) ?? 0) / 100;
            if (raw <= 0) return;
            healing.credit(creditId, 'hotHeal', raw);
            // Holder === target → the heal lands on the target; split consumption to the applier.
            if (actor.id === healing.targetId) {
                const { consumed, overheal } = healing.applyHealToTarget(raw);
                healing.credit(creditId, 'effectiveHeal', consumed);
                healing.credit(creditId, 'overheal', overheal);
                // Recipient axis (SP-3b Task 7): the tick lands on the HOLDER (this acting actor),
                // whoever applied it — so the raw goes to the holder's `hotHeal` bucket while the
                // source axis keeps crediting the APPLIER. Gated on `perRecipientApply` so a legacy
                // single-target run still leaves `perRecipient` empty.
                if (healing.perRecipientApply) {
                    healing.creditRecipient?.(actor.id, 'hotHeal', raw);
                    healing.creditRecipient?.(actor.id, 'effectiveHeal', consumed);
                    healing.creditRecipient?.(actor.id, 'overheal', overheal);
                }
            }
        };
        // Event-only (enemy) mode: HoT ticking must not credit or apply to the player healing map.
        if (!healEventOnly) {
            // (a) Payload-carrying ability HoT statuses on this holder (applier = status.casterId).
            // payload.stacks already folds accumulating per-round counts / timed configured stacks.
            for (const s of selfAbilityStatuses) {
                const hotPct = s.payload.parsedEffects.hotPct;
                if (!hotPct) continue;
                tickHot(s.casterId, hotPct, s.payload.stacks);
            }
            // (b) Scheduled snapshot HoTs (applier = the holder itself). Mirror resolveSelfBuffTotals'
            // lookup consumption: expandBuffs applies the per-round stack override, so the expanded
            // SelectedGameBuff carries the effective stacks already.
            for (const ab of entry.activeSelfBuffs) {
                for (const b of expandBuffEntry(ab, selfBuffLookup.get(ab.buffName) ?? [])) {
                    const hotPct = b.parsedEffects?.hotPct;
                    if (!hotPct) continue;
                    tickHot(undefined, hotPct, b.stacks ?? 1);
                }
            }
        }

        // Slot partition (damage-leech): passive-slot 'damage-dealt' abilities are standing
        // leeches owned by the ENGINE's credit hook (engine.ts) — processing them here would
        // double-count the cast's direct portion. 'damage-taken' abilities (any slot) are
        // owned by the enemy-attack block. Both are skipped on the cast path.
        // Only heal/shield abilities can be hook-owned; other ability types pass
        // through (the heal loop ignores them anyway).
        const isHookOwned = (a: Ability, fromPassive: boolean): boolean => {
            const c = a.config;
            if (c.type !== 'heal' && c.type !== 'shield') return false;
            if (c.basis === 'damage-taken') return true;
            return c.basis === 'damage-dealt' && fromPassive;
        };
        // Event-only mode (enemy walk, Task 5): the enemy path performs the SAME real effects as
        // the player path — heals restore each recipient's OWN currentHp (E5 §4.1), shields grant
        // real pools (#166), and cleanse removes real debuffs (#167) — via the side-agnostic
        // helpers over recipientsFor; it only credits NO player healing/metric bucket and never
        // mutates the player heal-target.
        //
        // It used to scope to the CAST skill alone ("the cast skill carries"), dropping the
        // passive slot entirely, so no enemy ever fired a passive-slot repair or shield. That is
        // not the game rule: a ship fires its passives whenever their conditions are met, on
        // either side of the board (user-confirmed 2026-08-07). Both modes now build the same
        // list; healEventOnly continues to govern CREDIT, not which abilities run. The passive
        // entries carry the same `isHookOwned(a, true)` filter as normal mode, so a leech-basis
        // passive still belongs to its engine hook and cannot double-count here.
        // Epic PR4: pre-combat abilities ("At the start of combat, this Unit gains a Shield …" —
        // Crucialis/FrontLine) are one-time pre-fight grants seeded ONCE by the engine
        // (seedPreCombatShields, r === 1); processing them here would re-grant the pool on every
        // cast. `pre-combat` is not a live trigger, so the reactive partition leaves them in
        // castSkills — this is the single cast-path exclusion point.
        const notPreCombat = (a: Ability): boolean => a.trigger !== 'pre-combat';
        // Each entry carries the slot it came from: `recipientsFor` needs it to decide whether
        // the firing skill's support footprint applies (cast: always; passive: only when the
        // ability is `patternScoped`). See `scopedByFootprint`.
        const healAbilities: { ability: Ability; fromPassive: boolean }[] = [
            ...(gatedSkill?.abilities ?? [])
                .filter((a) => !isHookOwned(a, false) && notPreCombat(a))
                .map((ability) => ({ ability, fromPassive: false })),
            ...(gatedPassive?.abilities ?? [])
                .filter((a) => !isHookOwned(a, true) && notPreCombat(a))
                .map((ability) => ({ ability, fromPassive: true })),
        ];
        const healTargets: string[] = [];
        let healCritCount = 0;
        let healRawSum = 0;
        // H3.3: summed clipped excess (overheal) across this cast's repairs on the heal target.
        // Carried on heal-performed.overheal for an `overheal`-basis reactive shield (Abundant Renewal).
        let overhealSum = 0;
        let cleansePerformedCount = 0;
        // Phase 3 PR-H: recipient ids that ACTUALLY had >= 1 debuff removed this cast (a subset
        // of recipientsFor's targeted recipients — e.g. an `all-allies` cleanse where only some
        // allies carried a debuff). Carried on cleanse-performed.targets for the on-own-cleanse
        // listener's ally-routing (mirrors healTargets, gated the same way as shieldRecipientIds:
        // only entries where something actually happened are included).
        const cleansedRecipientIds: string[] = [];
        // Per-recipient breakdown for heal-performed.perTarget (additive — one entry per recipient).
        const healPerTarget: {
            targetId: string;
            amount: number;
            overheal?: number;
            didCrit?: boolean;
        }[] = [];

        // ── The support pass, as a unit ────────────────────────────────────────────────────
        // Wrapped in a closure so it can run either INLINE (the default, unchanged) or DEFERRED
        // until after the engine's per-victim funnel. Deferral exists for one reason: a cast
        // `damage-dealt` rider must scale off what the cast DELIVERED, and that number does not
        // exist yet at this point in the turn.
        //
        // ALL-OR-NOTHING, deliberately. When any cast heal/shield in this cast carries the rider
        // basis, the WHOLE pass defers — not just the rider. Splitting it would resolve some of
        // the cast's support before the attack and some after, and would emit TWO
        // `heal-performed` rows for one cast, which doubles the `on-enemy-repaired` riders
        // (Ruiner's Bomb, Overload) that key off it. Corpus-inert either way: all seven cast
        // riders are the ONLY heal/shield on their slot, so nothing is dragged along today.
        const runSupportPass = () => {
            for (const { ability, fromPassive } of healAbilities) {
                const cfg = ability.config;
                if (cfg.type === 'heal') {
                    const recipients = recipientsFor(ability, fromPassive);
                    if (healEventOnly) {
                        // E5 §4.1: enemy heals restore each recipient's OWN currentHp (via the
                        // per-victim pool), fire repairedThisRound, and emit heal-performed — but
                        // contribute NOTHING to the player healing buckets (no healing.credit).
                        const didCrit = cfg.noCrit ? false : healCritGate(effectiveCrit / 100);
                        if (didCrit) healCritCount += 1;
                        for (const rid of recipients) {
                            const basis = basisValue(cfg.basis, rid);
                            let raw =
                                basis *
                                (cfg.pct / 100) *
                                (didCrit ? 1 + effectiveCritDamage / 100 : 1) *
                                (1 + healModifier / 100) *
                                (1 + dmgStats.totals.outgoingHealBuff / 100) *
                                (1 + incomingPctFor(rid) / 100);
                            // D-PR5: caster heal-cast amplification (rolls the proc gate ONCE per recipient).
                            raw *= 1 + healAmpPctFor(rid) / 100;
                            // D-PR6: recipient-side incoming-heal amplification (Exuberance) — rolls the
                            // recipient's combat-lifetime gate ONCE per applied repair (0 → byte-identical).
                            raw *= 1 + (healing.recipientIncomingHealAmpPct?.(rid) ?? 0) / 100;
                            const recipientActor = healing.recipientActor(rid);
                            // Capture the clipped over-repair per recipient (team symmetry with the
                            // player path): surfaces on heal-performed.perTarget so an enemy healer's
                            // Abundant Renewal shields its over-repaired allies too.
                            let perTargetOverheal: number | undefined;
                            if (recipientActor) {
                                const { overheal } = healing.applyHealToTarget(raw, recipientActor);
                                if (overheal > 0) perTargetOverheal = overheal;
                            }
                            healTargets.push(rid);
                            healRawSum += raw;
                            healPerTarget.push({
                                targetId: rid,
                                amount: raw,
                                ...(perTargetOverheal !== undefined
                                    ? { overheal: perTargetOverheal }
                                    : {}),
                                ...(didCrit ? { didCrit: true } : {}),
                            });
                        }
                        continue;
                    }
                    // ONE crit draw per heal ability (not per recipient).
                    const didCrit = cfg.noCrit ? false : healCritGate(effectiveCrit / 100);
                    if (didCrit) healCritCount += 1;
                    for (const rid of recipients) {
                        const basis = basisValue(cfg.basis, rid);
                        let raw =
                            basis *
                            (cfg.pct / 100) *
                            (didCrit ? 1 + effectiveCritDamage / 100 : 1) *
                            (1 + healModifier / 100) *
                            (1 + dmgStats.totals.outgoingHealBuff / 100) *
                            (1 + incomingPctFor(rid) / 100);
                        // D-PR5: caster heal-cast amplification (rolls the proc gate ONCE per recipient).
                        raw *= 1 + healAmpPctFor(rid) / 100;
                        // D-PR6: recipient-side incoming-heal amplification (Exuberance) — rolls the
                        // recipient's combat-lifetime gate ONCE per applied repair (0 → byte-identical).
                        raw *= 1 + (healing.recipientIncomingHealAmpPct?.(rid) ?? 0) / 100;
                        healing.credit(actor.id, 'directHeal', raw);
                        let perTargetOverheal: number | undefined;
                        // Per-recipient application: apply HP + capture the clipped over-repair on
                        // EACH recipient's OWN actor (mirrors the enemy event-only path), so an AoE
                        // heal restores every ally's real HP and each over-repaired ally's overheal
                        // is surfaced per-target (drives Abundant Renewal's per-ally shield).
                        // This is the APPLICATION axis and nothing else: recipient CHOICE was
                        // decided upstream by `recipientsFor` from the ability's target, so a heal
                        // applies per-recipient regardless of how its recipients were picked.
                        // Absent `perRecipientApply`, the healing calculator keeps single-target
                        // accounting on healing.targetId. `perRecipientApply` is set by BOTH
                        // `mode: 'battle'` and the healing calculator's own perRecipientHealApply.
                        const perRecipientActor = healing.perRecipientApply
                            ? healing.recipientActor(rid)
                            : undefined;
                        if (perRecipientActor || rid === healing.targetId) {
                            // applyHealToTarget defaults victim to the heal target when
                            // perRecipientActor is undefined (healing-calculator single-target path).
                            const { consumed, overheal } = healing.applyHealToTarget(
                                raw,
                                perRecipientActor
                            );
                            healing.credit(actor.id, 'effectiveHeal', consumed);
                            healing.credit(actor.id, 'overheal', overheal);
                            // Recipient axis (SP-3a Task 2): credit the actor the repair LANDED
                            // ON. Gated on perRecipientActor so a legacy single-target run leaves
                            // the map empty and every existing golden stays byte-identical.
                            if (perRecipientActor) {
                                healing.creditRecipient?.(rid, 'directHeal', raw);
                                healing.creditRecipient?.(rid, 'effectiveHeal', consumed);
                                healing.creditRecipient?.(rid, 'overheal', overheal);
                            }
                            overhealSum += overheal;
                            if (overheal > 0) perTargetOverheal = overheal;
                        }
                        healTargets.push(rid);
                        healRawSum += raw;
                        healPerTarget.push({
                            targetId: rid,
                            amount: raw,
                            ...(perTargetOverheal !== undefined
                                ? { overheal: perTargetOverheal }
                                : {}),
                            ...(didCrit ? { didCrit: true } : {}),
                        });
                    }
                } else if (cfg.type === 'shield') {
                    if (healEventOnly) {
                        // Enemy shields grant a real pool to each enemy recipient and emit
                        // shield-applied, but credit NO player bucket — the symmetric counterpart to
                        // the E5 enemy-heal lift above. Routing/cap/absorb are already side-agnostic
                        // (recipientsFor, grantShieldToTarget caps at recipientMaxHp, the absorb path).
                        // No crit / no modifiers (shields aren't repairs), matching the player branch.
                        const recipients = recipientsFor(ability, fromPassive);
                        const shieldRecipientIds: string[] = [];
                        let shieldGrantedSum = 0;
                        const shieldPerTarget: { targetId: string; amount: number }[] = [];
                        for (const rid of recipients) {
                            const raw = basisValue(cfg.basis, rid) * (cfg.pct / 100);
                            const recipientActor = healing.recipientActor(rid);
                            if (recipientActor) {
                                const granted = healing.grantShieldToTarget(raw, recipientActor);
                                if (granted > 0) {
                                    shieldRecipientIds.push(rid);
                                    shieldGrantedSum += granted;
                                    shieldPerTarget.push({ targetId: rid, amount: granted });
                                }
                            }
                        }
                        if (shieldRecipientIds.length > 0) {
                            bus.emit({
                                type: 'shield-applied',
                                granterId: actor.id,
                                recipientIds: shieldRecipientIds,
                                round: r,
                                amount: shieldGrantedSum,
                                perTarget: shieldPerTarget,
                            });
                        }
                        continue;
                    }
                    // Shields aren't repairs (documented assumption): NO crit, NO healModifier/
                    // outgoingHeal/incomingHeal channels — raw = basis × pct.
                    const recipients = recipientsFor(ability, fromPassive);
                    // H3.6: collect the per-recipient REAL pool growth so we emit ONE shield-applied
                    // per cast (NOT per recipient) carrying only recipients that actually gained pool.
                    const shieldRecipientIds: string[] = [];
                    let shieldGrantedSum = 0;
                    const shieldPerTarget: { targetId: string; amount: number }[] = [];
                    for (const rid of recipients) {
                        const raw = basisValue(cfg.basis, rid) * (cfg.pct / 100);
                        healing.credit(actor.id, 'shield', raw);
                        // H1 Task 5: route the pool to EACH targeted ally's own actor (mirrors the
                        // event-only heal branch's recipientActor routing) — not just the heal
                        // target. The absorb side already works per-actor, so an `all-allies`/`ally`
                        // shield must land a `shieldPool` on every targeted ally, not only the focus.
                        // A recipient with no resolvable runtime actor is credited but not pool-applied
                        // (mirrors the heal-recipient handling for an unwalked legacy team actor).
                        const recipientActor = healing.recipientActor(rid);
                        if (recipientActor) {
                            const granted = healing.grantShieldToTarget(raw, recipientActor);
                            if (granted > 0) {
                                shieldRecipientIds.push(rid);
                                shieldGrantedSum += granted;
                                shieldPerTarget.push({ targetId: rid, amount: granted });
                            }
                        }
                    }
                    // H3.6: emit ONE shield-applied per shield CAST, keyed on the caster, listing only
                    // recipients whose pool actually grew (granted > 0). Drives Resonating Fury
                    // (on-shield-applied). No recipient gained pool → no event. Mirrors the
                    // heal-performed emit below. NOTE: enemy event-only shields now grant their OWN
                    // pool and emit their OWN shield-applied from the lifted event-only sub-branch
                    // above; this player-path emit is the non-event-only (player-side) path.
                    if (shieldRecipientIds.length > 0) {
                        bus.emit({
                            type: 'shield-applied',
                            granterId: actor.id,
                            recipientIds: shieldRecipientIds,
                            round: r,
                            amount: shieldGrantedSum,
                            perTarget: shieldPerTarget,
                        });
                    }
                } else if (cfg.type === 'cleanse') {
                    // Team-symmetric removal: BOTH the player path and the enemy (event-only) path
                    // remove real debuffs via the side-agnostic statusEngine.cleanse over the
                    // side-aware recipientsFor recipients (self/ally/all-allies). cleansePerformedCount
                    // reflects the ACTUAL removed count on both sides, so the cleanse-performed emit
                    // (guarded `> 0`) now fires only on real removal — symmetric to the E5 heal lift and
                    // the #166 shield lift. The ONLY side-difference is the player-facing cleanseCount
                    // metric: the enemy event-only path suppresses it (mirrors E5/#166 credit suppression).
                    let removed = 0;
                    for (const rid of recipientsFor(ability, fromPassive)) {
                        const removedForRid = statusEngine.cleanse(rid, cfg.count);
                        removed += removedForRid;
                        // Phase 3 PR-H: only recipients with a REAL removal are on-own-cleanse's
                        // ally-routing candidates (mirrors shieldRecipientIds' granted>0 gate) — a
                        // targeted-but-untouched ally (e.g. an all-allies cleanse hitting a debuff-free
                        // ally) must not appear in cleanse-performed.targets.
                        if (removedForRid > 0) cleansedRecipientIds.push(rid);
                    }
                    cleansePerformedCount += removed;
                    if (!healEventOnly) healing.credit(actor.id, 'cleanseCount', removed);
                }
            }

            // ONE heal-performed per cast that healed at least one recipient. critHits is the
            // number of heal abilities that crit (present-only-when-positive). In event-only
            // (enemy) mode E5 §4.1 now computes the numeric, so amount/critHits reflect the real
            // enemy heal (the player healing buckets stay uncredited — see the healEventOnly note above).
            //
            // The gate is "resolved to at least one recipient AND restored something". The second
            // term closed the asymmetry PR6 knowingly opened: PR6 gated the REACTIVE path on
            // `healSum > 0` (triggers.ts heal branch) and left this one on recipients alone, so a CAST
            // repair that restored nothing still emitted, still opened a "repaired 0" combat-log row,
            // and still counted as a repair for the `on-enemy-repaired` riders (Ruiner's Bomb,
            // Overload, Zosimos's charge removal, Amartya's Defense Shred). The two paths now agree.
            //
            // `healRawSum` is the GROSS across recipients — the same basis the reactive gate uses — so
            // an over-repair that is entirely clipped still emits. That is deliberate: the repair DID
            // happen, the recipient was simply already full, and `overheal` carries that. Only a
            // repair that resolved to nothing at all is silenced.
            if (healTargets.length > 0 && healRawSum > 0) {
                bus.emit({
                    type: 'heal-performed',
                    casterId: actor.id,
                    targets: healTargets,
                    round: r,
                    amount: healRawSum,
                    ...(healCritCount > 0 ? { critHits: healCritCount } : {}),
                    ...(overhealSum > 0 ? { overheal: overhealSum } : {}),
                    perTarget: healPerTarget,
                });
            }

            // ONE cleanse-performed per cast that cleansed (BOTH modes — the on-enemy-cleansed AND
            // on-own-cleanse listeners filter by side/owner, so an inert emit is harmless without a
            // matching reactor).
            if (cleansePerformedCount > 0) {
                bus.emit({
                    type: 'cleanse-performed',
                    casterId: actor.id,
                    count: cleansePerformedCount,
                    round: r,
                    targets: cleansedRecipientIds,
                });
            }
        };

        // Defer iff the cast carries a `damage-dealt` rider AND the engine will resolve this cast
        // positionally. Pinned to `deferAbilityPerformed` — the SAME condition that already hands
        // `ability-performed` to the engine — so the engine has exactly one place to invoke both.
        //
        // SP-4c-2b CORRECTS the rest of that claim: the two CAN now disagree about whether a cast is
        // engine-resolved, on a no-victim turn (an ally-targeted cast — engine.ts's two player call
        // sites). `deferAbilityPerformed` carries no `hasVictim` term, so this deferral still fires;
        // but the engine victim-FENCED its `positional` apply gate, so the basis it feeds back
        // (`castDelivered`) is undefined and the call lands on its `?? turn.directDamage` fallback.
        // That fallback is the correct answer rather than a degradation: `directDamage` is fenced to 0
        // with no victim, so the support pass still runs and a damage-dealt-scaled repair on a cast
        // that hit nobody repairs 0. Do NOT re-pin the two by adding `hasVictim` to
        // `deferAbilityPerformed` or to the engine's `willApplyPositionally`: that flag also selects
        // `positionalLanding` below, so it would move the turn's crit draws.
        //
        // A cast rider is FIRING-SLOT only: a passive-slot `damage-dealt` heal is a standing leech
        // that `isHookOwned` already routed away from `healAbilities`, and it is procced per victim
        // by the engine on its own post-funnel path.
        const hasCastDamageDealtRider = healAbilities.some(
            ({ ability, fromPassive }) =>
                !fromPassive &&
                (ability.config.type === 'heal' || ability.config.type === 'shield') &&
                ability.config.basis === 'damage-dealt'
        );
        if (deferAbilityPerformed && hasCastDamageDealtRider) {
            deferredCastSupport = (deliveredTotal: number) => {
                castDeliveredDamage = deliveredTotal;
                runSupportPass();
            };
        } else {
            runSupportPass();
        }
    }

    // Display-only: surface pending accumulate-detonate effects (Echoing Burst — the only
    // such effect the parser emits; the ability config carries no name) in the round's
    // debuff list with their countdown. Appended AFTER the gate contexts are built and
    // after Step 3b, so they never feed enemy-debuff counts or any fold — the accumulator
    // mechanics are entirely separate (pendingAccumulators on the enemy actor).
    // Placement safety: all three buildRoundContext calls (preDebuffGateCtx, postDebuffGateCtx,
    // modifierCtx) consumed landedEnemyDebuffs.length BEFORE this point; no subsequent fold
    // reads the list after the return, so appending here is purely additive display data.
    for (const acc of pendingAccumulators) {
        landedEnemyDebuffs.push({ buffName: 'Echoing Burst', turnsRemaining: acc.roundsRemaining });
    }

    // Round-scoped context the enemy's DoT-processing turn needs (this actor's). With a
    // faster enemy the enemy reads the PREVIOUS round's context; at default speeds the
    // player always precedes the enemy. The caller stores it in lastTurnCtxByActor[actor.id].
    const turnCtx: PlayerRoundCtx = {
        effectiveAttack,
        dotMult,
        affinityMult,
        effectiveDefence,
        effectiveMaxHp: effectiveHp,
        outgoingHealPct: dmgStats.totals.outgoingHealBuff,
        incomingHealPct: dmgStats.totals.incomingHealBuff,
        // PR I4b/I4c: only set when this cast's own abilities OR a distributed ally aura
        // actually carry a victim-gated dotDamage ability — undefined for every ship without
        // one (the common case), so tickDoTs' fast path (`ctx.victimGatedDotDamage` falsy →
        // use `dotMult` unchanged) is byte-identical.
        ...(victimGatedDotDamage.length > 0 ? { victimGatedDotDamage } : {}),
    };

    // Per-cast attacker-side scalars for the positional apply path (Task 7). Sourced from
    // the SAME locals that assemble the aggregate `directDamage` above (preCritDamage +
    // postDefenseFactor): effectiveMultiplier ALREADY folds the hit count, so multiplierPct
    // is `effectiveMultiplier + conditionalBonusPct` and `hits` re-splits it per hit inside
    // victimHitDamage. attackerAffinity is the RAW affinity (the runtime's numeric
    // affinityDamageModifier is pre-resolved vs the bound enemy and can't be inverted);
    // defaults to neutral 'antimatter' when unset → modifier 0, matching the default matchup.
    // Only present when a damage ability actually fired (else there is nothing to apply).
    const positionalScalars: AttackerDamageScalars | undefined = hasDamageAbility
        ? {
              effectiveAttack,
              multiplierPct: effectiveMultiplier + conditionalBonusPct,
              secondaryStatValue,
              hits,
              effectiveCritDamage,
              outgoingDamageBuffPct: dmgStats.totals.outgoingDamageBuff,
              incomingDamageModifierPct: incomingDamageModifier,
              defensePenetrationPct: effectivePen,
              attackerAffinity: attackerAffinity ?? actor.affinity ?? 'antimatter',
              // SP-F F4: carry the forced-affinity OFFENSIVE override to the positional apply path
              // (Wusheng's forceAffinityAdvantage flag / Isha/Nayra 'Offensive Affinity Override').
              // Without this the engine's per-victim `victimHitDamage` recomputes the REAL matchup
              // from attackerAffinity and the forced advantage is lost on the production path.
              ...(forceOutgoingAdvantage ? { forceAffinityAdvantage: true } : {}),
          }
        : undefined;

    // PR I2: same guard as positionalScalars — only meaningful when a damage ability fired.
    // Carries the exact ingredients (modifierAbilities + the per-turn modifierCtx) the engine
    // needs to re-fold outgoingDamage against each footprint victim's OWN enemy-status.
    const perVictimOutgoing: PlayerTurnResult['perVictimOutgoing'] = hasDamageAbility
        ? { modifierAbilities, primaryCtx: modifierCtx }
        : undefined;

    // SP-4b-2 D6: hand the PASSIVE-SLOT damage instance to the positional apply path, which
    // otherwise never sees it (`positionalScalars` above is the FIRING skill's scalars — the
    // passive multiplier is deliberately absent from `multiplierPct`, which is why adding this
    // cannot double-count against it).
    //
    // Same shape as `positionalScalars`, with the three fields that are NOT shared:
    //   multiplierPct      the passive's own gated multiplier (hits already folded in),
    //   hits: 1            ONE instance, regardless of the firing skill's hit count — the
    //                      aggregate `passiveDamage` folds it in exactly once too,
    //   secondaryStatValue 0 — the defence/HP-scaling payload belongs to the firing hit.
    // Feeding these through `victimHitDamage(scalars, profile, didCrit, 1)` reproduces
    // `passiveDamage` exactly for the bound victim's defence profile (the same identity Task 4
    // established for the firing hit), so the positional and aggregate values agree.
    //
    // GUARD: `passiveMultiplier > 0`. `damageInputsFromSkill` returns multiplier 0 for a slot
    // with no damage ability AND for one whose damage ability was gated OFF this round
    // (gateFiringAbilities drops it), so this is exactly "the passive contributed damage this
    // round" — the same condition that makes the aggregate `passiveDamage` non-zero.
    //
    // TRIGGER EXCLUSIVITY (the same "two channels, never both" discipline D1 needed). A passive
    // `damage` ability with a LIVE trigger belongs to the REACTIVE machinery: it lands per victim
    // through `applyReactiveDamage`, WITH a per-victim gate re-check — which is what makes real
    // Judge's "all enemies below 50% HP" skip the healthy one. Only NON-live triggers belong
    // here; `on-cast` is explicitly not a live trigger (triggers.ts's ReactiveAbilityType note),
    // and the reactive machinery never delivers those, so this is their only channel.
    //
    // DEFENCE IN DEPTH, not the primary gate: `partitionReactiveAbilities` (triggers.ts) already
    // strips every live-triggered ability out of `castSkills` before this function sees the slot,
    // so `damageInputsFromSkill` reports multiplier 0 for them and this condition never decides
    // anything in production today. VERIFIED by instrumentation: a passive `damage` ability moved
    // from `on-cast` to `start-of-round` arrives here with an EMPTY gated passive slot, and the
    // hit still lands exactly once — via the reactive channel (measured identical per-victim
    // credit both ways, and real Judge deals its 600 once, skipping the >50%-HP enemy). The
    // condition is kept because `damageInputsFromSkill` itself does NOT filter by trigger: if the
    // partition ever stopped covering a slot, the two channels would silently both pay out.
    // `passiveHit.scalingAbility` is the EXACT ability `damageInputsFromSkill` measured
    // `passiveMultiplier` from — not a second `find`, which could select a different one and
    // pair this instance's target/trigger with another ability's multiplier.
    const passiveDamageAbility = passiveHit.scalingAbility;
    const passiveSlotHit: PassiveSlotHit | undefined =
        passiveMultiplier > 0 &&
        passiveDamageAbility &&
        !LIVE_TRIGGERS.has(passiveDamageAbility.trigger)
            ? {
                  scalars: {
                      effectiveAttack,
                      multiplierPct: passiveMultiplier,
                      secondaryStatValue: 0,
                      hits: 1,
                      effectiveCritDamage,
                      outgoingDamageBuffPct: dmgStats.totals.outgoingDamageBuff,
                      incomingDamageModifierPct: incomingDamageModifier,
                      defensePenetrationPct: effectivePen,
                      attackerAffinity: attackerAffinity ?? actor.affinity ?? 'antimatter',
                      ...(forceOutgoingAdvantage ? { forceAffinityAdvantage: true } : {}),
                  },
                  // REUSED, never re-drawn — and it is THE SAME `passiveDidCrit` the aggregate
                  // `passiveDamage` is scaled by (see its definition for why one instance gets one
                  // outcome rather than the firing skill's per-hit blend). Reading `hitCrits[0]`
                  // here instead is what let the two channels disagree on a multi-hit cast.
                  didCrit: passiveDidCrit,
                  target: passiveDamageAbility.target,
              }
            : undefined;

    return {
        action,
        roundCrit,
        hitCrits,
        // SP-4c-2b: a no-victim cast inflicted no DoT on anybody, so the round row reports NONE —
        // neither landed nor resisted. Both engine derivations read this pair, and each is wrong if
        // only `dotsLanded` is touched: `appliedDoTs: dotsConfig` (engine.ts:11240) would display
        // this cast's configured DoTs as applied, and the resisted-DoT derivation
        // (`!dotsLanded && dotsConfig.length > 0`, engine.ts:10163) would surface them as RESISTED
        // if `dotsLanded` were flipped to false — a resist implies a target that resisted. Emptying
        // the LIST makes both answer "nothing happened" and leaves `dotsLanded` immaterial, which is
        // exactly the reading a cast with no DoT clauses already gets.
        dotsConfig: hasVictim ? dotsConfig : [],
        dotsLanded,
        activeSelfBuffs: activeSelfBuffsForRound,
        landedEnemyDebuffs,
        inflictedEnemyDebuffs,
        resistedEnemyDebuffs,
        deferredEnemyApplications,
        // PR8: only meaningful on a positional cast that has gated clauses to replay. Left
        // undefined otherwise so the engine's wiring is a no-op for DPS/healing/non-positional.
        applyDebuffsForSubAttack:
            positionalLanding && perSubAttackDebuffRecipes.length > 0
                ? applyDebuffsForSubAttack
                : undefined,
        // Set ONLY when this cast's support pass deferred (a firing-slot `damage-dealt` rider on an
        // engine-resolved cast). The engine MUST invoke it after the funnel — the repair/shield has
        // not happened yet. Undefined on every other path, where the pass already ran inline.
        resolveCastSupport: deferredCastSupport,
        directDamage,
        secondaryDamage,
        conditionalDamage,
        detonationDamage,
        extraActionGrants,
        positionalScalars,
        passiveSlotHit,
        perVictimOutgoing,
        // SP-4b-2 D4: the landed half of this turn's scheduled enemy-debuff decision, handed to
        // the engine's per-victim damage read so both consumers share ONE draw.
        scheduledEnemyEffects: scheduledEnemy.roundEnemyDebuffs,
        rollVictimCrit,
        ...(positionalDetonation ? { positionalDetonation } : {}),
        // Task 5: when the inline emit was SUPPRESSED (engine will resolve positionally), hand the
        // engine the payload to emit post-apply with the true per-victim crit signal. anchor-based
        // didCrit/critHits are a defensive fallback; the engine overrides them with anyCrit/critPairs.
        // SP-4c-2b: also fenced on the victim — the payload's `targetId` IS the victim, so with none
        // there is no `ability-performed` for the engine to emit and the field is omitted outright
        // (the same answer the inline emit block above gives).
        ...(deferAbilityPerformed && hasVictim
            ? {
                  deferredAbilityPerformed: {
                      actorId: actor.id,
                      targetId: enemy.id,
                      round: r,
                      damage: directDamage,
                      didCrit: roundCrit,
                      critHits,
                  },
              }
            : {}),
        turnCtx,
    };
}
