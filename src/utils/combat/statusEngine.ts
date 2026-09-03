import { ParsedBuffEffects, SelectedGameBuff, StackTrigger } from '../../types/calculator';
import { Condition, SkillSlot } from '../../types/abilities';
import type { FactionKey } from '../../constants/factions';
import { conditionsMet, ConditionContext } from '../abilities/evaluateConditions';
import { isPersistentByName, persistentCapFor } from '../../constants/oneShotPersistentBuffs';
import { UNREMOVABLE_STATUSES } from './cheatDeathBuffs';
import { isBuffProtection } from './buffProtectionBuffs';

export interface ActiveBuff {
    buffName: string;
    /** Numeric = timed window; 'recurring' = re-applied each round (always/aura/accum,
     *  re-rolls landing per round); 'permanent' = persistent stacking status that landed
     *  ONCE at application and must NOT be re-rolled per round (see persistentStackingBuffs). */
    turnsRemaining: number | 'recurring' | 'permanent';
    stacks?: number; // defined for accumulating buffs; current stack count
}

export interface StatusEngineInput {
    selfBuffs: SelectedGameBuff[];
    enemyDebuffs: SelectedGameBuff[];
    /** Team-actor scheduled sources. Each source's TIMED entries key
     *  off that source's own id (matched in sourceFired by sourceId), so they apply on
     *  the team actor's real turns rather than the attacker's cadence. ALWAYS-ACTIVE and
     *  ACCUMULATING entries from these sources join the same global always/accum sets as
     *  the attacker's (see below — those are cadence-independent). */
    teamSources?: {
        sourceId: string;
        selfBuffs: SelectedGameBuff[];
        enemyDebuffs: SelectedGameBuff[];
    }[];
    /** Landing decision for a TIMED enemy upsert, drawn ONCE at application time
     *  The engine owns the gate + affinity rule and threads it here. When
     *  it returns false the upsert is SKIPPED (no status stored, the existing one is
     *  not cleared) and the buffName is collected into sourceFired's `resistedEnemy`.
     *  Optional — defaulting to "always lands" keeps the unit tests gate-free. */
    landsTimedEnemyApplication?: (buff: SelectedGameBuff) => boolean;
    /** Boost gear set: extra turns to add to a TIMED SELF-SIDE buff applied by `casterId`
     *  (the firing source for scheduled buffs, `status.casterId` for ability buffs). Returns 0
     *  for non-wearers. Default → always 0 (no wearer, no change). */
    buffDurationExtensionFor?: (casterId: string) => number;
}

/** Effect payload of an ability-sourced status, folded into the round totals by the engine. */
export interface AbilityStatusPayload {
    buffName: string;
    stacks: number;
    parsedEffects: ParsedBuffEffects;
    application?: 'inflict' | 'apply';
    /** Mirrors the ability config's `isStackable` flag. `stacks` is populated on
     *  EVERY buff/debuff payload (even non-stackable ones default to 1) — this flag lets a
     *  consumer (the aura branch of activeAbilityStatuses) distinguish "genuinely stackable,
     *  report the count" from "stacks:1 is just the structural default, no count to report".
     *  Absent/false preserves prior behaviour byte-for-byte. */
    isStackable?: boolean;
}

interface AbilityStatusBase {
    payload: AbilityStatusPayload;
    side: 'self' | 'enemy';
    sourceSlot: SkillSlot;
    /** Already live-gated by the caller (see abilityStatusGating.liveGateConditions). */
    conditions: Condition[];
    /** The actor that CAST this ability (ally routing). Conditions evaluate against the
     *  caster's context even when the status lives on a different recipient (an ally-cast aura's
     *  gate is the caster's). The ENGINE always sets this (casterId = the registering owner);
     *  it is OPTIONAL only so the statusEngine's own unit-test fixtures need not restate it —
     *  read sites default it to 'attacker'. Historical/attacker-only statuses are casterId
     *  'attacker' → identical to today (the resolver returns the local ctx for the caster). */
    casterId?: string;
    /** Player-side RECIPIENTS that receive this status (ally routing): `self` → [casterId];
     *  `ally`/`all-allies` → every player actor id (fixed source order). Enemy-side statuses ignore
     *  this (enemy maps are singular). The ENGINE always sets this on the timed-by-slot statuses it
     *  threads into playerTurn (the per-recipient application loop reads it); OPTIONAL only so the
     *  statusEngine unit-test fixtures need not restate it. For attacker-only runs this is always
     *  ['attacker']. */
    recipients?: string[];
    /** #363 (Fuying): recipient FACTION scope copied off the source `Ability.factionFilter`.
     *  `recipients` above is resolved at actor CONSTRUCTION and knows nothing about factions, so
     *  the filter rides the status and is intersected in at APPLICATION time (playerTurn's
     *  per-slot timed loop → `resolveSupportRecipients`), where the engine's actor→faction map is
     *  in scope. Absent → no faction narrowing. */
    factionFilter?: FactionKey[];
    /** Recipient BOARD-ADJACENCY scope, copied off the source ability's `target`. Set ONLY for
     *  `'adjacent-allies'`; absent for every other target.
     *
     *  Same reasoning as `factionFilter` directly above, for the other axis registration cannot
     *  resolve: `recipients` is computed at actor CONSTRUCTION, before any actor has moved or
     *  died, so it cannot answer "who is a LIVING board-neighbour right now". Registration
     *  therefore hands `adjacent-allies` the same whole-side roster `all-allies` gets, and the
     *  scope rides the status to be intersected at APPLICATION time, where the per-side
     *  `adjacentAllyIds` resolver is in hand.
     *
     *  Before this flag existed, `adjacent-allies` fell through registration's trailing
     *  `[ownerId]` arm — an on-cast adjacent grant reached the CASTER and nobody else, which is
     *  how Centurion's charged "grants all adjacent allies 2 stacks of Core Charge I" was landing
     *  those stacks on Centurion instead of on his neighbours. */
    allyScope?: 'adjacent-allies';
    /** #390: set to `'all'` ONLY on an enemy-side status whose source target covers the whole
     *  opposing board (`all-enemies` — see `ABILITY_TARGET_ENEMY_SCOPE`). Enemy-side aura and
     *  accumulating statuses are registered once at actor construction, under the singular
     *  `DEFAULT_ENEMY_TARGET` key, because no victim id exists yet; `activeAbilityStatuses` folds
     *  that bucket into a per-victim read only for the entries carrying this flag, since a
     *  board-wide status is correct for EVERY victim while a subset-scoped one would be smeared
     *  onto enemies it never touched. Absent → not folded (every self-side status, every
     *  subset-scoped enemy status, and every fixture that predates this flag). */
    enemyScope?: 'all';
}

/**
 * A buff/debuff ability registered with the status engine, discriminated by `kind`:
 *  - accumulating: stacks accumulate per trigger (never gated); effect inclusion
 *    is aura-gated per round.
 *  - aura: recurring/passive; effect inclusion is gated per round against the round ctx.
 *  - timed: finite duration; gated (incl. landing) AT APPLICATION when the source slot
 *    fires, then runs its full window unconditionally (familyKey/tier upsert shared with
 *    scheduled statuses). `duration` is guaranteed to be a number on this variant.
 */
export type RegisteredAbilityStatus =
    | (AbilityStatusBase & {
          kind: 'timed';
          duration: number;
          /** Enemy-side own-turn reprieve opt-in (Martyrdom Disable). When true AND this status
           *  lands on the actor whose turn is currently executing (recipient === currentTurnActorId),
           *  the enemy-side write is flagged appliedThisTurn so decrementEnemy skips the first tick
           *  — exactly as decrementPlayer protects same-turn self-buffs. Set ONLY by an on-destroyed
           *  own-death reaction (a debuff born of the applier's death, landing on the killer during
           *  the killer's own turn). Absent/false → unchanged (every other enemy debuff). */
          reprieveOnRecipientTurn?: boolean;
          /** Intra-cast clause order (user-confirmed game rule, 2026-08-03): true when THIS
           *  status's clause sits AFTER a damage-dealing clause in the same firing slot — "deals
           *  X% damage and inflicts Defense Down" resolves the damage first, so the debuff must
           *  not be in the store while that cast's damage resolves. playerTurn defers the
           *  application (and its `debuff-applied` emission) of a flagged status to the engine's
           *  post-apply flush; the landing ROLL still happens at the original point, so the RNG
           *  draw order is unchanged. Set by the engine's status-collection walk, which sees the
           *  clause order directly (`buildShipAbilities` sorts each slot by text position).
           *  Enemy-side firing-slot statuses only; absent → applies inline exactly as before. */
          afterDamageClause?: boolean;
          /** Hit-counted lifecycle (Quixilver R2 / "Barrier for 1 hit"). When set, the status
           *  additionally expires after this many qualifying hits, spent via consumeStatusHit.
           *  Orthogonal to `duration`: a status with both expires on whichever comes first. A
           *  hit-counted status with no turn duration is applied with duration Infinity (never
           *  ticks out, still removable) — see the TOXIC_OVERFLOW_DURATION precedent. Absent →
           *  the turn lifecycle alone governs. */
          hits?: number;
          /** Cap for the LIVE stack count when a stackable timed status is re-applied onto a
           *  victim that still holds it (see applyTimedAbilityStatus's stack-accumulation rule).
           *  Only consulted on that add-and-cap branch — a first application always stores the
           *  declared `payload.stacks`, uncapped. Absent → uncapped.
           *  An applier only reaches the add-and-cap branch when its config is `isStackable`;
           *  a REFRESHING applier never consults this. The statusEngine unit test is what
           *  holds the bound. */
          maxStacks?: number;
      })
    | (AbilityStatusBase & { kind: 'aura' })
    | (AbilityStatusBase & {
          kind: 'accumulating';
          stackTrigger: StackTrigger;
          maxStacks?: number;
      });

/** An ability status active this round, paired with its payload for effect folding. */
export interface ActiveAbilityStatus {
    payload: AbilityStatusPayload;
    active: ActiveBuff;
    /** The actor that CAST this status (HoT attribution). Present whenever the
     *  registered status/state carried it; for TIMED statuses it is stamped on BuffState at
     *  application from `status.casterId`. Undefined for statuses applied without caster
     *  identity (e.g. scheduled timed upserts, or statusEngine unit-test fixtures that omit
     *  casterId). Read sites attribute HoT ticks to this applier; absent → the holder. */
    casterId?: string;
}

export interface StatusEngine {
    /** Advance the round counter (strictly sequential, 1-based). Increments
     *  per-round accumulating stacks. Call once at the top of each round, before
     *  any turns. */
    beginRound(round: number): void;
    /** Notification that a source actually fired a slot this round. 'attacker'
     *  covers the attacker's own cadence AND all legacy/merged scheduled buffs
     *  (per-buff sourceChargeCount/sourceStartCharged are IGNORED — superseded by
     *  per-team-actor cadence); team actor ids carry their own timed sets via
     *  `teamSources`; unregistered ids no-op for the TIMED half. Applies timed
     *  scheduled buffs keyed to (sourceId, slot) and increments per-active/per-charge
     *  accumulating stacks whose GRANTER is this source — on every owner's store, not
     *  just the focus actor's (#436, owner ruling 2026-09-01). The accumulating half
     *  runs even for a source with no registered timed sets: a granter's cadence is
     *  its casts, not its timed-buff list. Returns:
     *  - `resistedEnemy`: buffNames of TIMED enemy upserts the landing hook rejected
     *    (so the engine can emit debuff-resisted and record them in the resisted list).
     *  - `appliedEnemy`: buffNames of TIMED enemy upserts that LANDED this call,
     *    collected BEFORE the family-rule upsert (so family-absorbed applications
     *    still count as inflicted — the unit did inflict; family absorption is an
     *    internal map rule). The engine emits `debuff-applied` once per name here
     *    (the discrete-infliction event). */
    sourceFired(
        sourceId: string,
        slot: 'active' | 'charge',
        round: number
    ): { resistedEnemy: string[]; appliedEnemy: string[] };
    /** Swap the TIMED-enemy landing hook used by `sourceFired`. The engine resets
     *  this per turn to the ACTING actor's live landing closure (live hacking-vs-target-security
     *  + that actor's affinity), so a scheduled timed enemy upsert fired during `sourceFired`
     *  draws against the correct per-turn chance — not the attacker's setup-time scalar. */
    setLandsTimedEnemyApplication(fn: (buff: SelectedGameBuff) => boolean): void;
    /** The round's active lists. Pure read.
     *  `ownerId` selects which player-side carrier's maps to read; defaults to
     *  'attacker'. Always-active and accumulating scheduled buffs are
     *  attacker-owned and always appear in the 'attacker' snapshot.
     *  `enemyTargetId` selects which enemy-side target's debuff maps to read;
     *  defaults to the singular default enemy target. */
    snapshot(
        ownerId?: string,
        enemyTargetId?: string
    ): { activeSelfBuffs: ActiveBuff[]; activeEnemyDebuffs: ActiveBuff[] };
    /** Owner Post-Turn: decrement ALL timed statuses on the named player-side carrier
     *  — including ones applied earlier in this same turn (same-turn decrement rule).
     *  Calling on an owner with no statuses (lazy-empty map) is a safe no-op.
     *  Returns expired buff names so the engine can emit buff-expired. */
    decrementPlayer(ownerId: string): { expired: string[] };
    /** Mark the start of an actor's turn. Sets the "active carrier" so self-side timed
     *  writes during this turn are flagged appliedThisTurn (own-turn reprieve). The id MUST
     *  match the self-store key for that actor: the focus actor uses 'attacker'; team actors
     *  use their real id. Called at each turn-started. */
    beginTurn(actorId: string): void;
    /** Owner Post-Turn (enemy side): decrement ALL timed enemy statuses for the given
     *  `targetId` (defaults to the singular default enemy target).
     *  Returns expired buff names so the engine can emit buff-expired. */
    decrementEnemy(targetId?: string): { expired: string[] };
    /** Remove every REMOVABLE timed status carried by this id, across both the player-side
     *  self store (keyed by ownerId) and the enemy-side store (keyed by targetId). Preserves:
     *  persistent-stacking entries (separate maps, never touched), entries flagged
     *  `turnsRemaining === 'permanent'`, and entries whose buffName ∈ UNREMOVABLE_STATUSES.
     *  Standing always-active/aura source lists are NOT touched — they re-derive each round
     *  from ship data, so a wipe of applied statuses is the model and auras re-apply next round.
     *  Calling on an unknown id (lazy-empty maps) is a safe no-op. Pure: mutates only this
     *  engine's own stores. */
    clearRemovable(id: string): void;
    /** Remove a SINGLE named timed enemy status from `targetId`'s per-actor enemy store.
     *  Targeted — unlike clearRemovable's broad sweep, deletes ONLY the named family, preserving
     *  co-applied debuffs on the same victim. Used by §4.5 direct-damage Stasis break.
     *  Lazy-empty / unknown id / unknown name → safe no-op. */
    removeTimedEnemyStatus(targetId: string, buffName: string): void;
    /** Reduce a SINGLE named timed enemy status on `targetId` by one turn, deleting it only if
     *  that reaches 0. Targeted like removeTimedEnemyStatus, but a reduce (not a wipe): used by
     *  §4.5 direct-damage Stasis break so a hit shaves one turn off Stasis instead of clearing it.
     *  A 'permanent'/'recurring' entry is left untouched. Lazy-empty / unknown id / unknown name →
     *  safe no-op. */
    reduceTimedEnemyStatus(targetId: string, buffName: string): void;
    /** Spend ONE STACK of a SINGLE named timed enemy status on `targetId`, deleting the entry only
     *  when the last stack goes. Used by Exposed's consumption (a hit reads every stack and spends
     *  exactly one). Targeted like removeTimedEnemyStatus/reduceTimedEnemyStatus, and note that
     *  this moves the STACKS axis while reduceTimedEnemyStatus moves the TURNS axis — same store,
     *  two independent axes. An entry carrying no live stack count is treated as its last stack.
     *  Lazy-empty / unknown id / unknown name → safe no-op. */
    consumeTimedEnemyStatusStack(targetId: string, buffName: string): void;
    /** Remove a named buff family from ALL of `actorId`'s self stores (timed selfMaps,
     *  accumulating accumSelfMaps, persistent persistentSelfMaps). Lazy-empty / unknown id /
     *  unknown name → safe no-op. */
    removeSelfBuffByName(actorId: string, buffName: string): void;
    /** Spend one hit charge of a hit-counted self-side status. Safe to invoke unconditionally at
     *  an absorb site: it changes nothing when the actor holds no such status or the entry is
     *  turn-duration-governed (hitsRemaining undefined).
     *
     *  RETURNS true ONLY when this call spent the LAST charge and REMOVED the status — i.e. it
     *  answers "did the status just expire?", not "was a charge spent?". That is what the caller
     *  needs to emit `buff-expired` exactly once, on the same edge the turn-expiry path emits it.
     *  A partial spend (2 charges → 1) returns false: the status is still up, nothing expired. */
    consumeStatusHit(actorId: string, buffName: string): boolean;
    /** Remove up to `count` removable debuffs from `actorId`'s per-victim enemy store, newest
     *  applied first (see removeNewestFirst). `'all'` removes every removable debuff. Returns
     *  the number actually removed. Unknown id → no-op (returns 0). */
    cleanse(actorId: string, count: number | 'all'): number;
    /** Reduce the duration of ONE timed debuff on `actorId` by `turns`, newest-applied first
     *  (highest appliedSeq). Reduced to <= 0 → removed (expired). Only timed debuffs are
     *  eligible; 'recurring'/'permanent' and UNREMOVABLE_STATUSES are skipped (consistent with
     *  cleanse). Returns 1 if a debuff was affected, else 0. Unknown id → 0. */
    reduceNewestDebuffDuration(actorId: string, turns: number): number;
    /** Reduce the duration of EVERY eligible timed debuff on `actorId` by `turns` —
     *  the ALL-scoped sibling of reduceNewestDebuffDuration (Heliodor/Pestilence's "reduces the
     *  duration of all active Debuffs … by 1 turn", vs Warpstrike's single-newest reduce).
     *  Same eligibility rules as reduceNewestDebuffDuration (timed only; skips 'recurring'/
     *  'permanent' and UNREMOVABLE_STATUSES) and the same non-positive/non-finite `turns`
     *  rejection. Returns the number of debuffs affected (removed early if their reduced
     *  duration is <= 0). Unknown id → 0. */
    reduceAllDebuffsDuration(actorId: string, turns: number): number;
    /** The clean inverse of reduceAllDebuffsDuration (Sokol) — extends EVERY eligible
     *  timed debuff on `actorId` (per-victim `enemyMaps`) by `turns`. Same eligibility rules
     *  (numeric turnsRemaining only, skips isUnremovable(name, turnsRemaining)) and the same
     *  non-positive/non-finite `turns` rejection, but NEVER expires an entry — extending only
     *  grows `turnsRemaining`, so there is no deletion pass. Returns the number of debuffs
     *  affected. Unknown id → 0. */
    extendAllDebuffsDuration(
        actorId: string,
        turns: number,
        onlyNames?: ReadonlySet<string>
    ): number;
    /** The self-buff sibling of extendAllDebuffsDuration (Ripper) — extends EVERY
     *  eligible timed buff on `actorId` (per-owner `selfMaps`) by `turns`. Same eligibility
     *  rules and never expires an entry. Returns the number of buffs affected. Unknown id → 0.
     *  #363 (Fuying): when `buffName` is given, restricts the extension to statuses with that
     *  exact name (e.g. "Stealth") — every other eligible buff is left untouched. Absent →
     *  extend-everything (Sokol/Ripper/Lev behaviour). */
    extendAllBuffsDuration(actorId: string, turns: number, buffName?: string): number;
    /** Remove up to `count` removable BUFFS from `actorId`'s self store, newest first;
     *  `'all'` = all; respects UNREMOVABLE_STATUSES + 'permanent'; returns count removed. */
    purge(actorId: string, count: number | 'all'): number;
    /** Buff steal: move up to `count` removable TIMED self-buffs from `sourceId` to
     *  EVERY id in `recipientIds`, newest-applied first (same ordering as purge). The REMAINING
     *  duration travels with each moved buff — NOT reset to a fresh window. Skips the same
     *  per-buff-name exclusions purge does (UNREMOVABLE_STATUSES + 'permanent' sentinels) but
     *  does NOT consult the Buff Protection holder-guard — buff-steal is a distinct removal
     *  mechanism from purge (see buffProtectionBuffs.ts's purge-only note). Only the TIMED
     *  self-buff store is considered (accumulating/persistent statuses have no finite duration
     *  to "travel"). Each recipient gets an INDEPENDENT copy of every stolen buff (same payload
     *  + remaining duration) — `count` buffs disappear from the source, but `count` buffs
     *  appear on EVERY recipient (Tithonus grants the same stolen buff to itself AND all
     *  adjacent allies, not a fan-out split). Returns the buff names actually moved. Unknown
     *  `sourceId`, or a source with no eligible buffs → [] (no-op). */
    steal(sourceId: string, recipientIds: string[], count: number): string[];
    /** Register all buff/debuff abilities once at creation (classified by `kind`).
     *  `ownerId` routes self-side statuses to the correct per-owner store (defaults to 'attacker').
     *  `enemyTargetId` routes enemy-side accum/aura statuses to the correct per-target store
     *  (defaults to the singular default enemy target); ignored for self-side statuses. */
    registerAbilityStatuses(
        statuses: RegisteredAbilityStatus[],
        ownerId?: string,
        enemyTargetId?: string
    ): void;
    /** Apply a firing skill's TIMED ability status for this round; the engine passes
     *  only those whose application gate passed. Reuses the familyKey/tier upsert.
     *  `status.duration` is guaranteed numeric by the timed variant — no runtime guard needed.
     *  `recipientId` selects which player-side carrier receives a self-side status (defaults to
     *  'attacker'); ignored for enemy-side statuses.
     *  `enemyTargetId` selects which enemy target's debuff store receives an enemy-side status
     *  (defaults to the singular default enemy target); ignored for self-side statuses. */
    applyTimedAbilityStatus(
        round: number,
        status: Extract<RegisteredAbilityStatus, { kind: 'timed' }>,
        recipientId?: string,
        enemyTargetId?: string
    ): void;
    /** Aura + accumulating ability statuses whose conditions pass THIS ROUND, with payloads,
     *  for effect folding and snapshot inclusion. `ownerId` selects the player-side carrier
     *  (defaults to 'attacker'). Each status's gate evaluates against ITS CASTER's context —
     *  `resolveCtx(casterId)` returns the ConditionContext for that caster (an ally-cast
     *  aura sitting on a recipient is still gated by the caster's buffs/state). For attacker-only
     *  runs every casterId is 'attacker' and the resolver returns the local ctx.
     *  `enemyTargetId` selects which enemy target's accum/aura maps to read for enemy-side
     *  statuses; defaults to the singular default enemy target.
     *  Ignored for self-side statuses. */
    activeAbilityStatuses(
        side: 'self' | 'enemy',
        resolveCtx: (casterId: string) => ConditionContext,
        ownerId?: string,
        enemyTargetId?: string
    ): ActiveAbilityStatus[];
    /** Timed ability statuses currently in the maps (payload-carrying), for effect folding.
     *  `ownerId` selects the player-side carrier for self-side statuses; defaults to 'attacker'.
     *  Ignored for enemy-side (enemy maps are per-target, not per-owner).
     *  `enemyTargetId` selects the enemy target's debuff store for enemy-side statuses; defaults
     *  to the singular default enemy target. Ignored for self-side statuses. */
    timedAbilityStatuses(
        side: 'self' | 'enemy',
        ownerId?: string,
        enemyTargetId?: string
    ): ActiveAbilityStatus[];
}

const ROMAN_SUFFIX = /\s+(I{1,3}|IV|V)$/;
const TIER_VALUES: Record<string, number> = { I: 1, II: 2, III: 3, IV: 4, V: 5 };
// DoTs stack independently — Inferno I and Inferno II can both be active simultaneously.
// Each tier is its own entity, not a family where higher replaces lower.
const DOT_PREFIXES = new Set(['Corrosion', 'Inferno', 'Bomb']);

/** EXPORTED for #389's cross-store tier shadowing (`buffTotals.outgoingFamiliesOf`), which must
 *  key families by exactly the same rule this engine uses internally — a second copy of the
 *  Roman-suffix/DoT-prefix logic would drift. */
export function deriveFamilyKey(name: string): { familyKey: string; tier: number } {
    if (DOT_PREFIXES.has(name.split(' ')[0])) return { familyKey: name, tier: 0 };
    const m = ROMAN_SUFFIX.exec(name);
    if (!m) return { familyKey: name, tier: 0 };
    return { familyKey: name.slice(0, m.index), tier: TIER_VALUES[m[1]] };
}

/**
 * THE family-shadowing comparison. Higher TIER wins outright; on an equal tier the larger
 * tie-break value wins, and an exact tie keeps the incumbent (which makes every fold over it
 * order-independent).
 *
 * Game rule (user-verified 2026-06-04, restated as GENERAL by the owner 2026-08-25 and recorded
 * in #389's spec §6): highest tier wins for ALL buffs and debuffs, with DoTs (`Corrosion`,
 * `Inferno`) and bombs the only exceptions — and those never reach here, `deriveFamilyKey` gives
 * each of them its own family key.
 *
 * EXPORTED because there must be exactly ONE such comparison. `familyApplicationWins` below
 * supplies DURATION as the tie-break (a fresh cast that outlasts the remaining window wins);
 * `buffTotals.outgoingFamiliesOf` supplies MAGNITUDE, because across the self/enemy store boundary
 * there is no shared duration axis to compare on — see its own note. #389's review found those two
 * had drifted into two different rules (magnitude-only vs tier-only); this is the shared one.
 */
export function familyChallengerWins(
    incumbentTier: number,
    incumbentTieBreak: number,
    challengerTier: number,
    challengerTieBreak: number
): boolean {
    if (incumbentTier !== challengerTier) return incumbentTier < challengerTier;
    return challengerTieBreak > incumbentTieBreak;
}

/** `familyChallengerWins` against a live `BuffState`, with the cast's DURATION as the tie-break.
 *  Note that same-source re-applications still refresh: after the post-turn decrement a 2-turn
 *  buff has 1 remaining, and 2 > 1 so the fresh 2-turn cast wins. */
function familyApplicationWins(
    existing: BuffState | undefined,
    tier: number,
    duration: number
): boolean {
    if (!existing) return true;
    return familyChallengerWins(existing.tier, existing.turnsRemaining, tier, duration);
}

function isAccumulating(buff: SelectedGameBuff): boolean {
    return !!buff.stackTrigger && buff.isStackable;
}

function isAlwaysActive(buff: SelectedGameBuff): boolean {
    if (isAccumulating(buff)) return false;
    return (
        !buff.skillSource ||
        buff.skillSource.startsWith('passive') ||
        buff.skillDuration === null ||
        buff.skillDuration === undefined ||
        buff.skillDuration === 'recurring'
    );
}

interface BuffState {
    buffName: string;
    turnsRemaining: number;
    tier: number;
    /** Present for ability-sourced timed statuses; folded into round totals by the engine. */
    payload?: AbilityStatusPayload;
    /** The caster of an ability-sourced timed status (HoT attribution). Stamped at
     *  application from `status.casterId`. Undefined for scheduled timed upserts (no caster
     *  identity) and for timed statuses whose registered status omitted casterId. */
    casterId?: string;
    /** Monotonic application order, newest = largest. Stamped at every write/refresh (both
     *  the initial create and any family-rule refresh that re-sets the same key). Drives
     *  cleanse/purge newest-applied-first removal ordering. */
    appliedSeq: number;
    /** Set true when this timed status was applied during the recipient's OWN turn (the
     *  recipient was the active actor — see beginTurn). Granted a one-turn reprieve at that
     *  turn's Post-Turn (skipped + flipped false by decrementPlayer/decrementEnemy), then
     *  decrements normally from the recipient's next Post-Turn. Two cases set it:
     *   - self-buffs a ship grants itself on its own turn (the original reprieve), and
     *   - an on-destroyed own-death debuff landing on the killer during the killer's own turn
     *     (`reprieveOnRecipientTurn`, #6b — legendary Martyrdom Disable). Every other off-turn
     *     and enemy-side write leaves it falsy. */
    appliedThisTurn?: boolean;
    /** Remaining hit charges for a hit-counted status (see RegisteredAbilityStatus.hits).
     *  Undefined = turn-duration-governed; consumeStatusHit is a no-op on such an entry. */
    hitsRemaining?: number;
    /** LIVE stack count, seeded from `payload.stacks` at every applyTimedAbilityStatus write and
     *  spent one at a time by consumeTimedEnemyStatusStack (Exposed). The reason this exists at
     *  all: `payload` is stored BY REFERENCE to the registered ability's own config object, shared
     *  across every victim and every application, so decrementing `payload.stacks` would corrupt
     *  the ability definition globally. This is the per-entry copy that CAN move.
     *  Undefined on entries written by `upsertBuff` (the scheduled channel, which has no stack
     *  model); every read treats undefined as "one stack, the declared count", so those entries
     *  behave exactly as they did before this field existed. */
    stacks?: number;
}

/** One granter's contribution to an accumulating status on one owner. Two ships can grant the
 *  SAME accumulating buff to one owner, and both grants land (owner ruling, 2026-09-01, #436:
 *  two adjacent Centurions each read 6 = their own 4-stack self grant plus the other's 2-stack
 *  adjacent grant). The contributions cannot be merged into a single rate, for two reasons the
 *  corpus actually exhibits:
 *    • they tick on DIFFERENT casts — Centurion B's rate-4 share rides B's charge, A's rate-2
 *      share rides A's charge, so one merged rate of 6 would grant 6 on EACH of the two casts;
 *    • they can carry DIFFERENT TRIGGERS — a Nuqtu adjacent to a Centurion holds his own
 *      per-round rate-1 share and Centurion's per-charge rate-2 share under one buffName.
 *  Measured corpus-wide 2026-09-01 (all 149 ships): the reachable collisions are Core Charge I
 *  and Blast, every accumulating grant carries `conditions: []`, and the declared cap agrees
 *  within every buffName — so the entry keeps ONE payload, ONE gate and ONE cap, and only the
 *  accrual is per-granter. */
interface AccumulatingContribution {
    /** The actor whose cadence this share rides — the GRANTER, not the holder. `'attacker'` for
     *  scheduled entries, which have no caster (that reproduces the pre-#436 cadence exactly). */
    granterId: string;
    rate: number;
    trigger: StackTrigger;
}

interface AccumulatingState {
    buffName: string;
    stacks: number;
    maxStacks: number | undefined;
    /** One share per granter (see AccumulatingContribution). Never empty. */
    contributions: AccumulatingContribution[];
    /** Present for ability-sourced accumulating statuses (payload + aura-gate conditions). */
    payload?: AbilityStatusPayload;
    conditions?: Condition[];
    /** The caster of an ability-sourced accumulating status — its gate evaluates against the
     *  caster's ctx. Undefined for scheduled accum entries (no conditions → no gate). */
    casterId?: string;
    /** Application order, stamped at the 0→positive stack transition (when the status first
     *  becomes active). Undefined while seeded-but-inert (stacks === 0). Drives cleanse/purge
     *  newest-applied-first removal ordering for accumulating statuses. */
    appliedSeq?: number;
}

/** Persistent stacking status state (game-verified 2026-06-05). These statuses land ONCE at
 *  application, accumulate one stack per landed application (capped at maxStacks), and never
 *  expire in-sim — see src/constants/persistentStackingBuffs.ts. `payload` is present only for
 *  ability-sourced applications (folded via timedAbilityStatuses); scheduled applications carry
 *  no payload (folded through snapshot()'s active lists + the buff lookup). */
interface PersistentStackState {
    buffName: string;
    stacks: number;
    maxStacks?: number;
    payload?: AbilityStatusPayload;
}

/** Per-source timed buff/debuff sets used by `createStatusEngine` to route scheduled
 *  timed upserts to the correct source turn. 'attacker' holds the legacy merged arrays'
 *  timed entries; each team source holds its own. `sourceFired` looks the source up here. */
interface TimedSourceSets {
    timedSelf: SelectedGameBuff[];
    timedEnemy: SelectedGameBuff[];
}

/**
 * Incremental, ACTION-FED status machine. The engine drives it per round:
 * `beginRound(r)` advances the counter and increments per-round accumulating
 * stacks; `sourceFired(sourceId, slot, r)` applies timed scheduled buffs when a
 * source actually acts (and increments per-active/per-charge stacks for the
 * attacker); `snapshot()` reads the round's active lists; `decrementPlayer` /
 * `decrementEnemy` run in each owner's Post Turn. It predicts nothing — cadences
 * are reported, not computed.
 */

/** Sentinel enemy-target id used for the default (non-per-victim) scheduled-debuff store.
 *  Callers that do not supply an explicit enemyTargetId resolve to this value. Exported so
 *  triggers.ts can reference the same constant instead of duplicating the string literal. */
export const DEFAULT_ENEMY_TARGET = '__enemy__';

/**
 * #390 — the DEFAULT_ENEMY_TARGET fold, for the AURA store only. Enemy-side aura and accumulating
 * statuses are both registered once at actor construction, into the singular
 * `DEFAULT_ENEMY_TARGET` bucket, because no victim id exists that early. Every reader looks them
 * up under the resolved victim's REAL id, so before this the bucket was written and never read —
 * the channel was inert end to end.
 *
 * Only the AURA store is folded. The accumulating store is left dropped on purpose: cleanse
 * gathers its candidates per victim, so a folded accumulating entry would be readable by every
 * victim and removable by none. See the call site in `activeAbilityStatuses` for the full reason.
 *
 * This returns the bucket entries that may be folded into ONE victim's read:
 *  - nothing at all when the caller IS reading the default bucket (it already has them, and
 *    folding would double every entry);
 *  - only entries flagged `enemyScope: 'all'`. A board-wide status is correct for every victim by
 *    definition. A subset-scoped one is NOT foldable — the bucket does not record which enemy it
 *    was meant for, so folding it would smear a one-victim debuff across the whole opposing board.
 *    Repairing that half means moving enemy-side aura registration to cast time; until then those
 *    statuses stay dropped, pinned by `enemyAuraDebuffChannel.characterization.test.ts` arm 4.
 *  - nothing already present under `alreadyHave` (a real per-target entry is the more specific
 *    answer and must not be doubled by the bucket's copy).
 */
function boardWideEnemyExtras<T extends { enemyScope?: 'all' }>(
    bucket: Iterable<T> | undefined,
    enemyTargetId: string,
    keyOf: (entry: T) => string,
    alreadyHave: (key: string) => boolean
): T[] {
    if (!bucket || enemyTargetId === DEFAULT_ENEMY_TARGET) return [];
    const out: T[] = [];
    for (const entry of bucket) {
        if (entry.enemyScope !== 'all') continue;
        if (alreadyHave(keyOf(entry))) continue;
        out.push(entry);
    }
    return out;
}

export function createStatusEngine(input: StatusEngineInput): StatusEngine {
    const { selfBuffs, enemyDebuffs } = input;
    const teamSources = input.teamSources ?? [];
    // Default: every timed enemy application lands (no gate) — keeps statusEngine unit
    // tests simple. The engine supplies the real hacking/affinity decision.
    // Mutable so the engine can swap it per turn to the ACTING actor's live landing closure
    let landsTimedEnemyApplication = input.landsTimedEnemyApplication ?? (() => true);
    const setLandsTimedEnemyApplication = (fn: (buff: SelectedGameBuff) => boolean): void => {
        landsTimedEnemyApplication = fn;
    };
    const buffDurationExtensionFor = input.buffDurationExtensionFor ?? (() => 0);

    // Categorized collections — kept as named closure variables (not inlined) so
    // the engine can append ability-sourced statuses to them later.
    //
    // ALWAYS-ACTIVE and ACCUMULATING entries are cadence-independent: an always-active
    // buff is on every round regardless of whose turn applies it, and accumulating
    // per-round stacks tick at round top (per-active/per-charge stay attacker-only — see
    // sourceFired). So team-source always/accum entries join the SAME global sets as the
    // attacker's. Only TIMED entries are scheduled per-source (keyed by sourceId in
    // sourceFired) so they ride the team actor's real turns.
    //
    // teamAllSelf/teamAllEnemy hold ALL team-source buffs (both sides). The always/accum
    // split is applied downstream when they are folded into the global sets.
    const teamAllSelf = teamSources.flatMap((s) => s.selfBuffs);
    const teamAllEnemy = teamSources.flatMap((s) => s.enemyDebuffs);
    const alwaysSelf = [...selfBuffs, ...teamAllSelf].filter(
        (b) => !isAccumulating(b) && isAlwaysActive(b)
    );
    const timedSelf = selfBuffs.filter((b) => !isAccumulating(b) && !isAlwaysActive(b));
    const accumSelf = [...selfBuffs, ...teamAllSelf].filter(isAccumulating);
    const alwaysEnemy = [...enemyDebuffs, ...teamAllEnemy].filter(
        (b) => !isAccumulating(b) && isAlwaysActive(b)
    );
    const timedEnemy = enemyDebuffs.filter((b) => !isAccumulating(b) && !isAlwaysActive(b));
    const accumEnemy = [...enemyDebuffs, ...teamAllEnemy].filter(isAccumulating);

    // Per-source TIMED sets. 'attacker' holds the legacy merged arrays' timed entries;
    // each team source holds its own. sourceFired looks the firing source up here.
    const timedBySource = new Map<string, TimedSourceSets>();
    timedBySource.set('attacker', { timedSelf, timedEnemy });
    for (const src of teamSources) {
        timedBySource.set(src.sourceId, {
            timedSelf: src.selfBuffs.filter((b) => !isAccumulating(b) && !isAlwaysActive(b)),
            timedEnemy: src.enemyDebuffs.filter((b) => !isAccumulating(b) && !isAlwaysActive(b)),
        });
    }

    // Per-owner player-side accumulating maps. `accumSelfMaps` is keyed by ownerId → (buffName →
    // AccumulatingState), lazy-created on first write (mirroring selfMaps/persistentSelfMaps).
    // Scheduled accumulating buffs seed the 'attacker' owner's map (always-active and
    // accumulating scheduled entries are cadence-independent attacker-owned grants); team-actor
    // maps are seeded through `registerAbilityStatuses`, which routes each self-side accumulating
    // status to its own `ownerId` (engine.ts fans out one call per recipient).
    const accumSelfMaps = new Map<string, Map<string, AccumulatingState>>();

    // Lazy helper — mirrors getSelfMap/getPersistentSelf.
    const getAccumSelf = (ownerId: string): Map<string, AccumulatingState> => {
        let m = accumSelfMaps.get(ownerId);
        if (!m) {
            m = new Map();
            accumSelfMaps.set(ownerId, m);
        }
        return m;
    };

    // Seed scheduled accumulating buffs into the 'attacker' owner (legacy semantics).
    const attackerAccumSelf = getAccumSelf('attacker');
    for (const b of accumSelf) {
        attackerAccumSelf.set(b.buffName, {
            buffName: b.buffName,
            stacks: 0,
            maxStacks: b.maxStacks,
            // Scheduled entries have no caster — they are attacker-owned grants, so the attacker
            // is the granter whose cadence they ride (pre-#436 semantics, unchanged).
            contributions: [{ granterId: 'attacker', rate: b.stacks, trigger: b.stackTrigger! }],
        });
    }

    // Per-target enemy-side accumulating maps. Keyed by targetId → (buffName →
    // AccumulatingState). Lazy-created on first write — mirrors accumSelfMaps/getAccumSelf.
    // Scheduled accumulating enemy debuffs seed the DEFAULT_ENEMY_TARGET map (legacy semantics:
    // scheduled enemy debuffs ride the attacker's cadence and always target the default enemy).
    const accumEnemyMaps = new Map<string, Map<string, AccumulatingState>>();

    // Lazy helper — mirrors getAccumSelf.
    const getAccumEnemy = (targetId: string): Map<string, AccumulatingState> => {
        let m = accumEnemyMaps.get(targetId);
        if (!m) {
            m = new Map();
            accumEnemyMaps.set(targetId, m);
        }
        return m;
    };

    // Seed scheduled accumulating enemy debuffs into the DEFAULT_ENEMY_TARGET (legacy semantics).
    const defaultAccumEnemy = getAccumEnemy(DEFAULT_ENEMY_TARGET);
    for (const b of accumEnemy) {
        defaultAccumEnemy.set(b.buffName, {
            buffName: b.buffName,
            stacks: 0,
            maxStacks: b.maxStacks,
            // Scheduled enemy debuffs ride the attacker's cadence: one `'attacker'` contribution
            // under #436's uniform granter rule. This loop seeds the DEFAULT_ENEMY_TARGET map
            // only; `registerAbilityStatuses` seeds the per-victim enemy accum maps separately.
            contributions: [{ granterId: 'attacker', rate: b.stacks, trigger: b.stackTrigger! }],
        });
    }

    // Per-owner player-side timed maps. Keyed by ownerId (typically 'attacker' or a team
    // actor id) → (familyKey → BuffState). Lazy-created on first write so touching an
    // unknown owner (e.g. decrementPlayer on an empty team-slot) is always a safe no-op.
    // Scheduled timed buffs from sourceFired ALWAYS go to the 'attacker' owner (legacy
    // semantics: manual + team-picker buffs are granted to the attacker, not to the team
    // actor — the team actor's sourceFired merely triggers the upsert into the attacker's map).
    const selfMaps = new Map<string, Map<string, BuffState>>();

    // Per-target enemy-side timed maps. Keyed by targetId → (familyKey → BuffState).
    // Lazy-created on first write — mirroring the per-owner selfMaps pattern.
    // DEFAULT_ENEMY_TARGET is declared earlier (before accumEnemyMaps, which references it);
    // callers that do not supply a targetId resolve to it.
    const enemyMaps = new Map<string, Map<string, BuffState>>();

    // Per-owner player-side persistent-stacking maps. Same lazy-create semantics.
    const persistentSelfMaps = new Map<string, Map<string, PersistentStackState>>();

    // Per-target enemy-side persistent-stacking maps. Keyed by targetId → (buffName →
    // PersistentStackState). Lazy-created on first write — mirrors persistentSelfMaps.
    const persistentEnemyMaps = new Map<string, Map<string, PersistentStackState>>();

    // Helpers: lazily create a per-owner player-side map on first access.
    const getSelfMap = (ownerId: string): Map<string, BuffState> => {
        let m = selfMaps.get(ownerId);
        if (!m) {
            m = new Map();
            selfMaps.set(ownerId, m);
        }
        return m;
    };
    const getPersistentSelf = (ownerId: string): Map<string, PersistentStackState> => {
        let m = persistentSelfMaps.get(ownerId);
        if (!m) {
            m = new Map();
            persistentSelfMaps.set(ownerId, m);
        }
        return m;
    };

    // Lazy helpers for the per-target enemy-side maps — mirror getSelfMap/getPersistentSelf.
    const getEnemyMap = (targetId: string): Map<string, BuffState> => {
        let m = enemyMaps.get(targetId);
        if (!m) {
            m = new Map();
            enemyMaps.set(targetId, m);
        }
        return m;
    };
    const getPersistentEnemy = (targetId: string): Map<string, PersistentStackState> => {
        let m = persistentEnemyMaps.get(targetId);
        if (!m) {
            m = new Map();
            persistentEnemyMaps.set(targetId, m);
        }
        return m;
    };

    // Add one application's worth of stacks (capped) to a side's persistent entry, creating it
    // on first application. `payload` is stored for ability-sourced applications and refreshed on
    // each application (the effect is identical per stack; the fold multiplies effect × stacks).
    // For self-side: `ownerOrTargetId` is the player-side carrier (defaults to 'attacker').
    // For enemy-side: `ownerOrTargetId` is the enemy target id (defaults to DEFAULT_ENEMY_TARGET).
    // NOTE: self-side default 'attacker' routes silently to the attacker's persistent map. Future
    // multi-recipient callers (e.g. ally routing) MUST thread the actual recipient id explicitly.
    const addPersistentStack = (
        side: 'self' | 'enemy',
        buffName: string,
        applicationStacks: number,
        payload?: AbilityStatusPayload,
        ownerOrTargetId = side === 'self' ? 'attacker' : DEFAULT_ENEMY_TARGET
    ): void => {
        const map =
            side === 'self'
                ? getPersistentSelf(ownerOrTargetId)
                : getPersistentEnemy(ownerOrTargetId);
        const maxStacks = persistentCapFor(buffName);
        const existing = map.get(buffName);
        if (existing) {
            existing.stacks =
                maxStacks !== undefined
                    ? Math.min(existing.stacks + applicationStacks, maxStacks)
                    : existing.stacks + applicationStacks;
            if (payload) existing.payload = payload;
            return;
        }
        map.set(buffName, {
            buffName,
            stacks:
                maxStacks !== undefined
                    ? Math.min(applicationStacks, maxStacks)
                    : applicationStacks,
            maxStacks,
            payload,
        });
    };

    // Ability-sourced aura statuses (recurring/passive): held with their (already
    // live-gated) conditions; effect inclusion is re-evaluated per round.
    // `auraSelfMaps` is per-owner (keyed by ownerId) so a team ship's aura is read only
    // through its own ownerId and does not fold into the attacker's round totals.
    // `auraEnemyMaps` is per-target (keyed by targetId) — mirrors auraSelfMaps.
    const auraSelfMaps = new Map<string, Extract<RegisteredAbilityStatus, { kind: 'aura' }>[]>();

    // Lazy helper for aura lists — mirrors getAccumSelf.
    const getAuraSelf = (ownerId: string): Extract<RegisteredAbilityStatus, { kind: 'aura' }>[] => {
        let list = auraSelfMaps.get(ownerId);
        if (!list) {
            list = [];
            auraSelfMaps.set(ownerId, list);
        }
        return list;
    };

    // Per-target enemy-side aura maps. Keyed by targetId → aura status list.
    // Lazy-created on first write — mirrors auraSelfMaps/getAuraSelf.
    const auraEnemyMaps = new Map<string, Extract<RegisteredAbilityStatus, { kind: 'aura' }>[]>();

    // Lazy helper for enemy aura lists — mirrors getAuraSelf.
    const getAuraEnemy = (
        targetId: string
    ): Extract<RegisteredAbilityStatus, { kind: 'aura' }>[] => {
        let list = auraEnemyMaps.get(targetId);
        if (!list) {
            list = [];
            auraEnemyMaps.set(targetId, list);
        }
        return list;
    };

    let lastRound = 0;

    // Monotonic application sequence for newest-first cleanse/purge ordering.
    // Incremented at every BuffState write (create + refresh) and at the 0→positive
    // stack transition for AccumulatingState entries.
    let appliedSeqCounter = 0;
    const nextAppliedSeq = (): number => ++appliedSeqCounter;

    /** Add `amount` stacks to an accumulating entry, clamped to its cap, stamping `appliedSeq` on
     *  the 0→positive transition (the first time the status becomes active). Later gains do not
     *  re-stamp — the first-active order is what cleanse/purge needs for newest-first ordering.
     *  `amount` is the SUM of the contributions that matched this tick (#436), so the cap clamps
     *  the TOTAL rather than each granter's share (owner ruling: two adjacent Centurions each
     *  read 6, and a Core Charge I total still stops at 10). A non-positive amount is a no-op —
     *  it cannot move `stacks`, so it must not consume an appliedSeq either. */
    const addAccumStacks = (state: AccumulatingState, amount: number): void => {
        if (amount <= 0) return;
        const before = state.stacks;
        state.stacks =
            state.maxStacks !== undefined
                ? Math.min(state.stacks + amount, state.maxStacks)
                : state.stacks + amount;
        if (before === 0 && state.stacks > 0) state.appliedSeq = nextAppliedSeq();
    };

    // The actor whose turn is currently executing (set at each turn-started via beginTurn).
    // Self-side timed writes stamp appliedThisTurn when the carrier id matches this — the
    // own-turn reprieve. Undefined before the first beginTurn → no reprieve (safe default).
    let currentTurnActorId: string | undefined;
    const beginTurn = (actorId: string): void => {
        currentTurnActorId = actorId;
    };

    // beginRound: advance the round counter (strictly sequential) and apply the
    // per-round accumulating increment. Per-round stacks tick once at round top,
    // independent of any source firing. Called before any turns — preserving the
    // old step()'s ordering of "per-round accum BEFORE timed upserts".
    const beginRound = (r: number): void => {
        if (r !== lastRound + 1) {
            throw new Error(
                `StatusEngine.beginRound called out of sequence: expected round ${lastRound + 1}, got ${r}`
            );
        }
        lastRound = r;

        // The active carrier is turn-scoped: clearing it at round top ensures start-of-round /
        // pre-turn-body self-buff writes (which run before any beginTurn this round) are not
        // mis-flagged for the prior round's last actor — they get no own-turn reprieve.
        currentTurnActorId = undefined;

        // (Decrement+expire moved out to decrementPlayer/decrementEnemy, called from each
        //  owner's Post Turn in the engine.)

        const incrementPerRound = (map: Map<string, AccumulatingState>) => {
            for (const state of map.values()) {
                // #436: sum EVERY granter's per-round share. Two granters of one buff on one
                // owner both accrue — Howler's `ally`-scoped Blast landing on a Lev who also
                // self-grants Blast reads 2 per round, capped at 4. Pre-#436 the second
                // registration REPLACED the first, so only one share existed.
                let amount = 0;
                for (const c of state.contributions) {
                    if (c.trigger === 'per-round') amount += c.rate;
                }
                addAccumStacks(state, amount);
            }
        };
        // Iterate EVERY owner's accum map so per-round stacks tick for all owners. Today only
        // 'attacker' is seeded from scheduled buffs — team-actor accumulating ability statuses
        // will appear under their own ownerId once registered. Behavior is identical for the
        // attacker-only case.
        for (const ownerAccum of accumSelfMaps.values()) {
            incrementPerRound(ownerAccum);
        }
        // Iterate EVERY target's enemy accum map — mirrors the self side.
        // Today only DEFAULT_ENEMY_TARGET is seeded from scheduled debuffs; ability-sourced
        // accumulating enemy statuses will appear under their own targetId once registered.
        for (const targetAccum of accumEnemyMaps.values()) {
            incrementPerRound(targetAccum);
        }
    };

    // Scheduled timed upserts always target the 'attacker' owner on the self side and
    // the DEFAULT_ENEMY_TARGET on the enemy side: scheduled buffs/debuffs ride the attacker's
    // cadence and route to the singular default stores.
    const upsertBuff = (buff: SelectedGameBuff, side: 'self' | 'enemy', casterId?: string) => {
        const map = side === 'self' ? getSelfMap('attacker') : getEnemyMap(DEFAULT_ENEMY_TARGET);
        // Persistent stacking statuses route by NAME before the family-rule timed path: this
        // application landed (the landing hook already ran at the call site), so add a stack
        // (capped) to the persistent map. The text skillDuration is intentionally ignored — the
        // buff-name rule overrides it (game-verified 2026-06-05).
        if (isPersistentByName(buff.buffName)) {
            addPersistentStack(side, buff.buffName, buff.stacks || 1);
            return;
        }
        if (typeof buff.skillDuration !== 'number') return;
        const { familyKey, tier } = deriveFamilyKey(buff.buffName);
        // Boost: +N turns on a buff the caster APPLIES, self-side only (debuffs land enemy-side).
        // The `&& casterId` is defensive: scheduled buffs always carry a concrete firing sourceId.
        const extension = side === 'self' && casterId ? buffDurationExtensionFor(casterId) : 0;
        const duration = buff.skillDuration + extension;
        const existing = map.get(familyKey);
        if (!familyApplicationWins(existing, tier, duration)) return;
        map.set(familyKey, {
            buffName: buff.buffName,
            turnsRemaining: duration,
            tier,
            appliedSeq: nextAppliedSeq(),
            appliedThisTurn: side === 'self' && currentTurnActorId === 'attacker',
        });
    };

    // sourceFired: a source actually fired a slot this round. It upserts that source's
    // TIMED scheduled buffs whose skillSource matches the fired slot — 'attacker' draws
    // from the legacy merged arrays, each team source from its own list (per-source maps
    // built above). Per-active/per-charge accumulating stacks tick on the ATTACKER only
    // (they track the attacker's cadence — team actors do not advance them); these run
    // BEFORE the timed upserts, preserving the old step() ordering.
    //
    // Per-buff sourceChargeCount/sourceStartCharged remain IGNORED — superseded by real
    // team turns (the engine drives each team actor's real charge cadence and calls
    // sourceFired with its own slot). An UNREGISTERED source id is a no-op.
    const sourceFired = (
        sourceId: string,
        slot: 'active' | 'charge',
        round: number
    ): { resistedEnemy: string[]; appliedEnemy: string[] } => {
        if (round !== lastRound) {
            throw new Error(
                `StatusEngine.sourceFired called for round ${round}, but the engine is at round ${lastRound}`
            );
        }
        // Per-active/per-charge accumulating stacks tick on the GRANTER's cadence (owner ruling
        // 2026-09-01, #436): a stack granted BY another ship keeps accruing every time THAT ship
        // casts, so the share that ticks is the one naming this source as its granter — on
        // whatever owner's store it lives, not only the focus actor's. Centurion standing next to
        // an idle ally, charging and casting on rounds 2 and 4, leaves the ally on 4 stacks of
        // Core Charge I; pre-#436 the ally banked nothing at all, because only accumSelfMaps
        // under 'attacker' was ever incremented.
        //
        // The same rule runs on the enemy side, where it is provably a no-op today: the corpus
        // holds exactly ONE enemy-side accumulating entry (Amartya's Defense Shred) and it is
        // per-round, and scheduled enemy entries carry granterId 'attacker' — which reproduces
        // the old "tick every enemy map when the attacker fires" exactly, since only the
        // DEFAULT_ENEMY_TARGET map is ever seeded. Measured corpus-wide 2026-09-01.
        //
        // Deliberately ABOVE the `if (!sets) return` early return below: a granter's cadence is
        // its CASTS, which has nothing to do with whether it also registered timed buffs. A ship
        // whose kit carries an accumulating grant but no timed self/enemy buff has no
        // `timedBySource` entry at all, and gating the accrual on one would leave exactly the
        // dead channel this repairs.
        const slotAmount = (state: AccumulatingState): number => {
            let amount = 0;
            for (const c of state.contributions) {
                if (c.granterId !== sourceId) continue;
                if (
                    (c.trigger === 'per-active' && slot === 'active') ||
                    (c.trigger === 'per-charge' && slot === 'charge')
                ) {
                    amount += c.rate;
                }
            }
            return amount;
        };
        for (const ownerAccum of accumSelfMaps.values()) {
            for (const state of ownerAccum.values()) {
                addAccumStacks(state, slotAmount(state));
            }
        }
        for (const targetAccum of accumEnemyMaps.values()) {
            for (const state of targetAccum.values()) {
                addAccumStacks(state, slotAmount(state));
            }
        }

        const sets = timedBySource.get(sourceId);
        if (!sets) return { resistedEnemy: [], appliedEnemy: [] };

        // Timed scheduled buffs (this source's) whose skillSource matches the fired slot.
        for (const buff of sets.timedSelf) {
            if (buff.skillSource === slot) upsertBuff(buff, 'self', sourceId);
        }
        // Timed ENEMY upserts draw the landing decision ONCE here. A rejected
        // application is NOT upserted (the existing in-window status is untouched) and
        // its buffName is collected so the engine can emit debuff-resisted + record it.
        // A landed application's buffName is collected BEFORE the family-rule upsert so
        // family-absorbed applications still count as inflicted (the unit did inflict; the
        // family rule is an internal map rule). The engine emits `debuff-applied` once per
        // name in appliedEnemy (the discrete-infliction event).
        const resistedEnemy: string[] = [];
        const appliedEnemy: string[] = [];
        for (const buff of sets.timedEnemy) {
            if (buff.skillSource !== slot) continue;
            // Union helper (not the raw PERSISTENT_STACKING_BUFFS set) so this gate can never
            // disagree with `upsertBuff`'s own routing just below, which already calls
            // `isPersistentByName`. Strictly wider than the set alone — inert for today's two
            // one-shot names (both are self-granted buffs and can never reach this enemy-debuff
            // path) — but keeps this site aligned with upsertBuff for any future enemy-side
            // one-shot.
            const isPersistent = isPersistentByName(buff.buffName);
            // Persistent statuses ignore skillDuration; non-persistent timed entries require a
            // numeric duration to upsert a finite window.
            if (!isPersistent && typeof buff.skillDuration !== 'number') continue;
            if (!landsTimedEnemyApplication(buff)) {
                resistedEnemy.push(buff.buffName);
                continue;
            }
            // Collect the name BEFORE the upsert (landed = passed the landing hook,
            // regardless of family absorption / persistent-cap absorption inside upsertBuff).
            appliedEnemy.push(buff.buffName);
            upsertBuff(buff, 'enemy');
        }
        return { resistedEnemy, appliedEnemy };
    };

    // snapshot: the round's active lists. Pure read.
    // `ownerId` selects which player-side carrier's timed maps to include; defaults
    // to 'attacker'. Always-active and accumulating scheduled buffs are attacker-owned
    // and always appear in the 'attacker' snapshot regardless of `ownerId`.
    // `enemyTargetId` selects which enemy-side target's debuff maps to include; defaults
    // to DEFAULT_ENEMY_TARGET.
    const snapshot = (
        ownerId = 'attacker',
        enemyTargetId = DEFAULT_ENEMY_TARGET
    ): { activeSelfBuffs: ActiveBuff[]; activeEnemyDebuffs: ActiveBuff[] } => {
        // Always-active buffs injected as 'recurring'.
        // Deduplicate always-active by buffName so buffLookup expansion doesn't multiply effects.
        // These are attacker-owned (cadence-independent scheduled grants) and appear only in
        // the 'attacker' snapshot — not in per-team-actor snapshots.
        const selfAlwaysSnap =
            ownerId === 'attacker'
                ? [...new Map(alwaysSelf.map((b) => [b.buffName, b])).values()].map((b) => ({
                      buffName: b.buffName,
                      turnsRemaining: 'recurring' as const,
                  }))
                : [];
        const enemyAlwaysSnap = [...new Map(alwaysEnemy.map((b) => [b.buffName, b])).values()].map(
            (b) => ({ buffName: b.buffName, turnsRemaining: 'recurring' as const })
        );
        // Accumulating buffs: include only when stacks > 0. Ability-sourced accumulating
        // statuses (payload-carrying) are excluded here — the engine collects them via
        // activeAbilityStatuses and appends them to the round lists after scheduled ones.
        // Read the requested owner's accum map (scheduled entries live under 'attacker').
        const ownerAccumSelf = accumSelfMaps.get(ownerId);
        const selfAccumSnap = ownerAccumSelf
            ? [...ownerAccumSelf.values()]
                  .filter((s) => s.stacks > 0 && !s.payload)
                  .map((s) => ({
                      buffName: s.buffName,
                      turnsRemaining: 'recurring' as const,
                      stacks: s.stacks,
                  }))
            : [];
        // Accumulating enemy debuffs: read the requested enemy target's accum map.
        const ownerAccumEnemy = accumEnemyMaps.get(enemyTargetId);
        const enemyAccumSnap = ownerAccumEnemy
            ? [...ownerAccumEnemy.values()]
                  .filter((s) => s.stacks > 0 && !s.payload)
                  .map((s) => ({
                      buffName: s.buffName,
                      turnsRemaining: 'recurring' as const,
                      stacks: s.stacks,
                  }))
            : [];

        // Scheduled-sourced persistent stacking statuses (no payload): included with the
        // 'permanent' sentinel + stack count so the attacker-turn partition routes them to the
        // no-re-roll fold (foldTimedEnemyDebuffs) and expandBuffs applies the stack override.
        // Ability-sourced persistent statuses carry a payload and are excluded here — the engine
        // appends them via timedAbilityStatuses (mirroring the timed-map exclusion below).
        // Persistent self statuses are per-owner; read the requested owner's map.
        const persistentSelf = persistentSelfMaps.get(ownerId);
        const selfPersistentSnap = persistentSelf
            ? [...persistentSelf.values()]
                  .filter((s) => !s.payload && s.stacks > 0)
                  .map((s) => ({
                      buffName: s.buffName,
                      turnsRemaining: 'permanent' as const,
                      stacks: s.stacks,
                  }))
            : [];
        // Persistent enemy statuses are per-target; read the requested target's map.
        const persistentEnemyTarget = persistentEnemyMaps.get(enemyTargetId);
        const enemyPersistentSnap = persistentEnemyTarget
            ? [...persistentEnemyTarget.values()]
                  .filter((s) => !s.payload && s.stacks > 0)
                  .map((s) => ({
                      buffName: s.buffName,
                      turnsRemaining: 'permanent' as const,
                      stacks: s.stacks,
                  }))
            : [];

        // Timed scheduled statuses — read from the requested owner's map (lazy-empty = []).
        // Ability-sourced timed statuses (payload-carrying) live in the same maps but are
        // excluded here — the engine appends them via timedAbilityStatuses after scheduled ones.
        const selfMap = selfMaps.get(ownerId);
        // Timed enemy debuffs — read from the requested enemy target's map (lazy-empty = []).
        const enemyTimedMap = enemyMaps.get(enemyTargetId);
        return {
            activeSelfBuffs: [
                ...selfAlwaysSnap,
                ...selfAccumSnap,
                ...(selfMap
                    ? [...selfMap.values()]
                          .filter((s) => !s.payload)
                          .map((s) => ({
                              buffName: s.buffName,
                              turnsRemaining: s.turnsRemaining,
                          }))
                    : []),
                ...selfPersistentSnap,
            ],
            activeEnemyDebuffs: [
                ...enemyAlwaysSnap,
                ...enemyAccumSnap,
                ...(enemyTimedMap
                    ? [...enemyTimedMap.values()]
                          .filter((s) => !s.payload)
                          .map((s) => ({
                              buffName: s.buffName,
                              turnsRemaining: s.turnsRemaining,
                          }))
                    : []),
                ...enemyPersistentSnap,
            ],
        };
    };

    // Owner Post-Turn decrement helpers. The status CARRIER decrements its timed statuses
    // by one turn at its own Post-Turn. The two stores differ in their own-turn handling:
    //
    //   - decrementPlayer (self-buff store): a timed self-buff applied during the carrier's
    //     OWN turn is flagged appliedThisTurn (set by beginTurn, stamped in both self-side
    //     timed write seams — applyTimedAbilityStatus and upsertBuff). Such an entry gets a
    //     one-turn reprieve — it is skipped
    //     once and the flag cleared, so it first decrements at the carrier's NEXT Post-Turn
    //     (and thus lasts through the carrier's next turn). All other timed self statuses
    //     decrement normally.
    //   - decrementEnemy (debuffs landed on the carrier): UNCHANGED — it always decrements,
    //     including same-turn applications, because debuffs are applied during the ATTACKER's
    //     turn and so are never "own-turn" for the carrier they sit on.
    //
    // Expired statuses are removed and their stored buffName reported so the engine emits
    // buff-expired. Ability-sourced timed statuses live in the same maps and decrement here.

    /** Decrement all timed statuses in the SELF-BUFF STORE for the named carrier (side-agnostic;
     *  the 'Player' suffix is legacy — this is the store for buffs the actor applied to itself).
     *  Calling on a carrier with no statuses (lazy-empty map) is a safe no-op. */
    const decrementPlayer = (ownerId: string): { expired: string[] } => {
        const map = selfMaps.get(ownerId);
        const expired: string[] = [];
        if (map) {
            for (const [key, s] of map) {
                if (s.appliedThisTurn) {
                    s.appliedThisTurn = false; // reprieve consumed; next Post-Turn decrements
                    continue;
                }
                s.turnsRemaining -= 1;
                if (s.turnsRemaining <= 0) {
                    expired.push(s.buffName);
                    map.delete(key);
                }
            }
        }
        // The active-turn marker is turn-scoped and consumed here. Clearing it once the owner's
        // Post-Turn has run prevents later same-turn writes (engine turn-ended / round-ended
        // drains run after this) from being stamped appliedThisTurn for a turn whose Post-Turn
        // is already spent — which would otherwise grant them an extra turn. (Pairs with the
        // round-top reset in beginRound, which guards the start-of-round drain.)
        if (currentTurnActorId === ownerId) currentTurnActorId = undefined;
        return { expired };
    };

    /** Decrement all timed statuses in the DEBUFFS-LANDED-ON store for the given actor id
     *  (side-agnostic; the 'Enemy' suffix is legacy — this is the store for debuffs landed ON
     *  the named carrier by an opposing actor). Defaults to DEFAULT_ENEMY_TARGET (the DPS-dummy
     *  sentinel '__enemy__').
     *  Calling on a carrier with no statuses (lazy-empty map) is a safe no-op. */
    const decrementEnemy = (targetId = DEFAULT_ENEMY_TARGET): { expired: string[] } => {
        const map = enemyMaps.get(targetId);
        const expired: string[] = [];
        if (map) {
            for (const [key, s] of map) {
                // Own-turn reprieve (Martyrdom Disable): an on-destroyed debuff that landed on this
                // actor DURING its own turn is skipped once (flag flips false), so it first
                // decrements at this actor's NEXT Post-Turn and runs its full window. Mirrors
                // decrementPlayer's self-side reprieve. All other enemy debuffs leave the flag falsy.
                if (s.appliedThisTurn) {
                    s.appliedThisTurn = false; // reprieve consumed; next Post-Turn decrements
                    continue;
                }
                s.turnsRemaining -= 1;
                if (s.turnsRemaining <= 0) {
                    expired.push(s.buffName);
                    map.delete(key);
                }
            }
        }
        return { expired };
    };

    /** Classify whether a timed status entry survives a cleanse/purge/Cheat-Death wipe.
     *  Reusable by a later phase's cleanse/purge. A status is unremovable when it is a
     *  persistent stack (the 'permanent' sentinel — those also live in separate maps that
     *  clearRemovable never visits, so this is a belt-and-braces guard) or its buffName is
     *  named in UNREMOVABLE_STATUSES. Persistent-stacking debuffs are unremovable by
     *  construction (separate maps); UNREMOVABLE_STATUSES names any ADDITIONAL effects. */
    const isUnremovable = (
        buffName: string,
        turnsRemaining: number | 'recurring' | 'permanent'
    ): boolean => turnsRemaining === 'permanent' || UNREMOVABLE_STATUSES.has(buffName);

    /** Remove every removable timed entry for `id` across the player-side self store
     *  (keyed by ownerId) and the enemy-side store (keyed by targetId). Persistent-stack
     *  maps are not visited (unremovable by construction). Unknown id → lazy-empty maps →
     *  no-op. Always/aura source lists are intentionally left intact (they re-derive each
     *  round from ship data). */
    const clearRemovable = (id: string): void => {
        const sweep = (map: Map<string, BuffState> | undefined): void => {
            if (!map) return;
            for (const [key, s] of map) {
                if (isUnremovable(s.buffName, s.turnsRemaining)) continue;
                map.delete(key);
            }
        };
        sweep(selfMaps.get(id));
        sweep(enemyMaps.get(id));
    };

    /** Remove a SINGLE named timed enemy status from `targetId`'s per-actor enemy store (the
     *  channel applyTimedAbilityStatus writes, keyed by familyKey). Targeted — unlike
     *  clearRemovable's broad sweep, deletes ONLY the named family, preserving co-applied
     *  debuffs on the same victim. Used by the engine's §4.5 direct-damage Stasis break.
     *  Lazy-empty / unknown id / unknown name → safe no-op. */
    const removeTimedEnemyStatus = (targetId: string, buffName: string): void => {
        const map = enemyMaps.get(targetId);
        if (!map) return;
        map.delete(deriveFamilyKey(buffName).familyKey);
    };

    /** §4.5 direct-damage Stasis break: shave ONE turn off the named timed enemy status instead
     *  of wiping it (the game reduces Stasis' turn count on a direct hit, not removes it). Delete
     *  only when the count reaches 0. 'permanent'/'recurring' entries are non-numeric → left as-is. */
    const reduceTimedEnemyStatus = (targetId: string, buffName: string): void => {
        const map = enemyMaps.get(targetId);
        if (!map) return;
        const key = deriveFamilyKey(buffName).familyKey;
        const s = map.get(key);
        if (!s || typeof s.turnsRemaining !== 'number') return;
        s.turnsRemaining -= 1;
        if (s.turnsRemaining <= 0) map.delete(key);
    };

    /** Spend ONE stack of the named timed enemy status on `targetId`, deleting the entry only when
     *  the last stack goes (Exposed: a hit reads all of a victim's stacks and spends exactly one,
     *  owner ruling 2026-08-10). Same targeting and same store as removeTimedEnemyStatus, but on
     *  the STACKS axis — orthogonal to reduceTimedEnemyStatus, which moves the TURNS axis. Do not
     *  conflate the two.
     *  An entry with no live `stacks` (written by upsertBuff, which has no stack model) counts as
     *  its last stack and is deleted — the same outcome removeTimedEnemyStatus gives such entries.
     *  Lazy-empty / unknown id / unknown name → safe no-op. */
    const consumeTimedEnemyStatusStack = (targetId: string, buffName: string): void => {
        const map = enemyMaps.get(targetId);
        if (!map) return;
        const key = deriveFamilyKey(buffName).familyKey;
        const s = map.get(key);
        if (!s) return;
        const live = s.stacks ?? 1;
        if (live <= 1) {
            map.delete(key);
            return;
        }
        s.stacks = live - 1;
    };

    /** Remove a named buff family from ALL of `actorId`'s self stores. The three self-side
     *  doors a buff can arrive through each use a different key:
     *   - timed `selfMaps` are keyed by `deriveFamilyKey(buffName).familyKey`,
     *   - accumulating `accumSelfMaps` are keyed by the raw `buffName` (payload.buffName),
     *   - persistent `persistentSelfMaps` are keyed by the raw `buffName`.
     *  Clearing all three makes removal robust regardless of which door applied the buff.
     *  Lazy-empty / unknown id / unknown name → safe no-op. */
    const removeSelfBuffByName = (actorId: string, buffName: string): void => {
        selfMaps.get(actorId)?.delete(deriveFamilyKey(buffName).familyKey);
        // Accumulating (per-round) Overload: RESET stacks to 0 instead of deleting the entry.
        // The "gains Overload every turn" grant is a single seeded accumulating entry that
        // beginRound's per-round tick increments; deleting it would stop accrual permanently, but
        // the Marauder mechanic is "lose all stacks on kill, then keep building again". Zeroing the
        // entry (and clearing its appliedSeq so the next 0→positive tick re-stamps ordering) makes
        // it inert THIS round (activeAbilityStatuses excludes stacks<=0) yet lets beginRound resume
        // accrual next round. Per-active/per-charge entries reset the same way.
        const accum = accumSelfMaps.get(actorId)?.get(buffName);
        if (accum) {
            accum.stacks = 0;
            accum.appliedSeq = undefined;
        }
        persistentSelfMaps.get(actorId)?.delete(buffName);
    };

    /** Spend one hit charge of a hit-counted self-side status. See the interface doc: the return
     *  is "the status was REMOVED by this call", not "a charge was spent", so the absorb site can
     *  emit `buff-expired` on exactly the same edge the turn-expiry path does.
     *
     *  `selfMaps.get(...)` rather than `getSelfMap(...)`, matching the sibling
     *  `removeSelfBuffByName` above: this runs on EVERY barriered hit, and the lazy-creating
     *  accessor would allocate an empty map for every actor that never holds one. */
    const consumeStatusHit = (actorId: string, buffName: string): boolean => {
        const map = selfMaps.get(actorId);
        if (!map) return false;
        for (const [key, state] of map) {
            if (state.buffName !== buffName || state.hitsRemaining === undefined) continue;
            const left = state.hitsRemaining - 1;
            if (left <= 0) {
                map.delete(key);
                return true;
            }
            map.set(key, { ...state, hitsRemaining: left });
            return false;
        }
        return false;
    };

    /** Remove up to `count` removable statuses for `actorId` on the chosen side, NEWEST-APPLIED
     *  FIRST (highest `appliedSeq` removed first).
     *
     *  Side mapping:
     *  - `'debuffs'` → the actor's per-victim enemy-side timed + accumulating stores (cleanse).
     *  - `'buffs'`   → the actor's player-side self stores (purge).
     *
     *  Skips:
     *  - entries whose `buffName` is in `UNREMOVABLE_STATUSES`.
     *  - timed entries with `turnsRemaining === 'permanent'` (belt-and-braces guard; in
     *    practice 'permanent'-sentinel entries live in the separate persistent maps, not here).
     *  - accumulating entries that are still inert (`stacks <= 0` or `appliedSeq` not yet stamped).
     *
     *  NOT gathered (unremovable by construction):
     *  - persistent-stacking maps (`persistentSelfMaps` / `persistentEnemyMaps`) — never visited.
     *
     *  NOT in these maps (re-derive each round, no stored entry to remove):
     *  - always-active / aura statuses.
     *
     *  `count === 'all'` removes every removable candidate.
     *  Unknown actor id → lazy-empty maps → no-op (returns 0).
     *  Returns the number of statuses actually removed. */
    const removeNewestFirst = (
        actorId: string,
        side: 'debuffs' | 'buffs',
        count: number | 'all'
    ): number => {
        const timedMap = side === 'debuffs' ? enemyMaps.get(actorId) : selfMaps.get(actorId);
        const accumMap =
            side === 'debuffs' ? accumEnemyMaps.get(actorId) : accumSelfMaps.get(actorId);
        const candidates: { seq: number; remove: () => void }[] = [];
        if (timedMap) {
            for (const [key, s] of timedMap) {
                if (isUnremovable(s.buffName, s.turnsRemaining)) continue;
                candidates.push({ seq: s.appliedSeq, remove: () => timedMap.delete(key) });
            }
        }
        if (accumMap) {
            for (const [key, s] of accumMap) {
                if (s.stacks <= 0 || s.appliedSeq === undefined) continue;
                // Accumulating statuses never expire by time → name-gate only.
                // (accum entries have no duration; 0 is an inert placeholder — only the name gate applies)
                if (isUnremovable(s.buffName, 0)) continue;
                candidates.push({ seq: s.appliedSeq, remove: () => accumMap.delete(key) });
            }
        }
        candidates.sort((a, b) => b.seq - a.seq);
        const limit =
            count === 'all' ? candidates.length : Math.max(0, Math.min(count, candidates.length));
        for (let i = 0; i < limit; i++) candidates[i].remove();
        return limit;
    };

    /** Remove up to `count` removable debuffs from `actorId`'s per-victim enemy store, newest
     *  first (see removeNewestFirst). `'all'` removes every removable debuff. Returns the number
     *  actually removed. Unknown id → no-op (returns 0). */
    const cleanse = (actorId: string, count: number | 'all'): number =>
        removeNewestFirst(actorId, 'debuffs', count);

    /** Reduce the duration of ONE timed debuff on `actorId` by `turns`, newest-applied first
     *  (highest appliedSeq). Reduced to <= 0 → removed (expired). Only the per-victim timed
     *  enemy store is visited — accumulating/persistent maps have no finite duration (so the
     *  "newest" picked here is the newest TIMED debuff, which may differ from cleanse's newest
     *  across all stores). Skips 'recurring'/'permanent' sentinels and UNREMOVABLE_STATUSES (same
     *  skip rules as cleanse). Returns 1 if a debuff was affected, else 0. Unknown id → 0.
     *  A non-positive / non-finite `turns` is rejected (→ 0): only a positive whole-turn
     *  reduction is meaningful — 0 would credit a no-op as success, a negative value would
     *  INCREASE the duration, and NaN would corrupt `turnsRemaining`. */
    const reduceNewestDebuffDuration = (actorId: string, turns: number): number => {
        const delta = Number.isFinite(turns) ? Math.trunc(turns) : 0;
        if (delta <= 0) return 0;
        const timedMap = enemyMaps.get(actorId);
        if (!timedMap) return 0;
        let best: { seq: number; key: string; s: BuffState } | undefined;
        for (const [key, s] of timedMap) {
            // Defensive: BuffState.turnsRemaining is typed `number` — non-numeric durations
            // ('recurring'/'permanent') live in separate maps and cannot reach enemyMaps today.
            // Belt-and-braces only (this exact guard is not present in removeNewestFirst).
            if (typeof s.turnsRemaining !== 'number') continue;
            if (isUnremovable(s.buffName, s.turnsRemaining)) continue;
            if (!best || s.appliedSeq > best.seq) best = { seq: s.appliedSeq, key, s };
        }
        if (!best) return 0;
        best.s.turnsRemaining -= delta;
        if (best.s.turnsRemaining <= 0) timedMap.delete(best.key);
        return 1;
    };

    /** ALL-scoped sibling of reduceNewestDebuffDuration — shrinks EVERY eligible timed
     *  debuff on `actorId` by `turns` rather than just the newest. Same store (per-victim
     *  `enemyMaps`) and eligibility rules (numeric turnsRemaining only, skip
     *  isUnremovable(name, turnsRemaining)); a reduced entry <= 0 is deleted (expired). Collects
     *  keys to delete in a separate pass so mutating the map mid-iteration is safe. Returns the
     *  count of debuffs affected; a non-positive/non-finite `turns` or unknown id returns 0. */
    const reduceAllDebuffsDuration = (actorId: string, turns: number): number => {
        const delta = Number.isFinite(turns) ? Math.trunc(turns) : 0;
        if (delta <= 0) return 0;
        const timedMap = enemyMaps.get(actorId);
        if (!timedMap) return 0;
        let affected = 0;
        const toDelete: string[] = [];
        for (const [key, s] of timedMap) {
            if (typeof s.turnsRemaining !== 'number') continue;
            if (isUnremovable(s.buffName, s.turnsRemaining)) continue;
            s.turnsRemaining -= delta;
            affected++;
            if (s.turnsRemaining <= 0) toDelete.push(key);
        }
        for (const key of toDelete) timedMap.delete(key);
        return affected;
    };

    /** The clean inverse of reduceAllDebuffsDuration (Sokol) — extends EVERY eligible
     *  timed debuff on `actorId` (per-victim `enemyMaps`) by `turns`. Same store and
     *  eligibility rules as reduceAllDebuffsDuration (numeric turnsRemaining only, skip
     *  isUnremovable(name, turnsRemaining)) but ADDS instead of subtracting, and there is no
     *  deletion pass — extending a duration can never expire an entry. Returns the count of
     *  debuffs affected; a non-positive/non-finite `turns` or unknown id returns 0.
     *
     *  `onlyNames` restricts the extension to statuses with one of those exact names — the
     *  INFLICTED-scope case (Asphyxiator), where the caller has recorded what its own cast just
     *  applied to this victim and everything else standing must be left alone. Absent → extend
     *  every eligible debuff (Sokol/Lev). An EMPTY set therefore extends nothing,
     *  which is the correct reading of "extend what I inflicted" when nothing landed. */
    const extendAllDebuffsDuration = (
        actorId: string,
        turns: number,
        onlyNames?: ReadonlySet<string>
    ): number => {
        const delta = Number.isFinite(turns) ? Math.trunc(turns) : 0;
        if (delta <= 0) return 0;
        const timedMap = enemyMaps.get(actorId);
        if (!timedMap) return 0;
        let affected = 0;
        for (const [, s] of timedMap) {
            if (typeof s.turnsRemaining !== 'number') continue;
            if (isUnremovable(s.buffName, s.turnsRemaining)) continue;
            if (onlyNames !== undefined && !onlyNames.has(s.buffName)) continue;
            s.turnsRemaining += delta;
            affected++;
        }
        return affected;
    };

    /** The self-buff sibling of extendAllDebuffsDuration (Ripper) — extends EVERY
     *  eligible timed buff on `actorId` (per-owner `selfMaps`) by `turns`. Same eligibility
     *  rules and never expires an entry. Returns the count of buffs affected; a
     *  non-positive/non-finite `turns` or unknown id returns 0.
     *  #363 (Fuying): an optional `buffName` restricts the extension to statuses with that
     *  exact name — a NAMED extension touches only that status; absent → every eligible
     *  buff (Sokol/Ripper/Lev). */
    const extendAllBuffsDuration = (actorId: string, turns: number, buffName?: string): number => {
        const delta = Number.isFinite(turns) ? Math.trunc(turns) : 0;
        if (delta <= 0) return 0;
        const timedMap = selfMaps.get(actorId);
        if (!timedMap) return 0;
        let affected = 0;
        for (const [, s] of timedMap) {
            if (typeof s.turnsRemaining !== 'number') continue;
            if (isUnremovable(s.buffName, s.turnsRemaining)) continue;
            if (buffName !== undefined && s.buffName !== buffName) continue;
            s.turnsRemaining += delta;
            affected++;
        }
        return affected;
    };

    /** Remove up to `count` removable BUFFS from `actorId`'s self store, newest first
     *  (see removeNewestFirst). `'all'` removes every removable buff. Respects
     *  UNREMOVABLE_STATUSES + 'permanent'; returns count removed. Unknown id → no-op (returns 0). */
    const purge = (actorId: string, count: number | 'all'): number => {
        // Holder-state guard: a unit carrying Buff Protection cannot have its buffs purged.
        // Purge-only — `cleanse` (removeNewestFirst(_, 'debuffs', _)) does NOT call this.
        const selfBuffNames = new Set<string>();
        for (const ab of snapshot(actorId).activeSelfBuffs) {
            if (ab.stacks === undefined || ab.stacks > 0) selfBuffNames.add(ab.buffName);
        }
        for (const s of timedAbilityStatuses('self', actorId)) selfBuffNames.add(s.active.buffName);
        // NOTE: deliberately omits the aura/accum channel (`activeAbilityStatuses('self', …)`) that
        // `selfBuffNamesForOwners` also reads — Buff Protection is only ever granted as a TIMED buff,
        // so the timed + scheduled channels cover every real grant. Revisit if an aura grant appears.
        if ([...selfBuffNames].some(isBuffProtection)) return 0;
        return removeNewestFirst(actorId, 'buffs', count);
    };

    /** Move up to `count` removable TIMED self-buffs from `sourceId` to EVERY id in
     *  `recipientIds`, newest-applied first (mirrors removeNewestFirst's ordering, but
     *  restricted to the TIMED map only — accumulating/persistent statuses have no finite
     *  duration to carry over). Deliberately does NOT consult the Buff Protection holder-guard
     *  (purge-only, see buffProtectionBuffs.ts) — buff-steal is a distinct removal mechanism.
     *  Each recipient receives an independent copy of every stolen entry (same payload +
     *  REMAINING turnsRemaining, routed through the same family-tier-win rule a normal
     *  applyTimedAbilityStatus write uses) — a stolen buff can still be absorbed if the
     *  recipient already holds a stronger/longer version of the same buff family. Returns the
     *  buff names actually removed from the source (grants are best-effort per recipient and do
     *  not affect this return value). Unknown sourceId / nothing eligible → []. */
    const steal = (sourceId: string, recipientIds: string[], count: number): string[] => {
        const timedMap = selfMaps.get(sourceId);
        if (!timedMap) return [];
        const candidates: { seq: number; key: string; s: BuffState }[] = [];
        for (const [key, s] of timedMap) {
            if (isUnremovable(s.buffName, s.turnsRemaining)) continue;
            candidates.push({ seq: s.appliedSeq, key, s });
        }
        candidates.sort((a, b) => b.seq - a.seq);
        const limit = Math.max(0, Math.min(count, candidates.length));
        if (limit === 0) return [];
        const stolen = candidates.slice(0, limit).map(({ key, s }) => {
            timedMap.delete(key);
            return {
                buffName: s.buffName,
                turnsRemaining: s.turnsRemaining,
                payload: s.payload,
                casterId: s.casterId,
                // Hit-counted lifecycle travels with the theft (see the recipientMap.set below):
                // a stolen hit-counted status is durationless (turnsRemaining: Infinity) and
                // would otherwise become permanent, unspendable damage immunity in the thief's
                // hands — consumeStatusHit can only spend an entry that actually carries this.
                hitsRemaining: s.hitsRemaining,
                // The LIVE stack count travels with the theft too — this site RE-ENUMERATES
                // BuffState's fields rather than spreading it, so a new field that is not restated
                // here is silently dropped. Inert on today's corpus (only the enemy store's
                // Exposed can diverge from its declared count, and buff steal reads self stores),
                // but a dropped `stacks` would make a stolen partly-spent status read as full.
                stacks: s.stacks,
            };
        });
        for (const recipientId of recipientIds) {
            const recipientMap = getSelfMap(recipientId);
            for (const st of stolen) {
                const { familyKey, tier } = deriveFamilyKey(st.buffName);
                const existing = recipientMap.get(familyKey);
                if (!familyApplicationWins(existing, tier, st.turnsRemaining)) continue;
                recipientMap.set(familyKey, {
                    buffName: st.buffName,
                    turnsRemaining: st.turnsRemaining,
                    tier,
                    payload: st.payload,
                    casterId: st.casterId,
                    // REMAINING hit count travels intact, mirroring the REMAINING turnsRemaining
                    // rule documented above — otherwise a stolen hit-counted Barrier arrives with
                    // hitsRemaining undefined, which consumeStatusHit treats as turn-duration-
                    // governed (a no-op), leaving the thief permanently immune until it expires
                    // (never, since it also carries turnsRemaining: Infinity).
                    hitsRemaining: st.hitsRemaining,
                    // REMAINING stack count travels intact, same rule as hitsRemaining above.
                    stacks: st.stacks,
                    appliedSeq: nextAppliedSeq(),
                    // Own-turn reprieve (Finding 2): a buff granted to the actor whose turn is
                    // executing is protected from that same turn's Post-Turn decrement — its
                    // REMAINING duration must travel intact per the ratified rule. Identical rule
                    // to applyTimedAbilityStatus's self-side write: reprieve iff the recipient IS
                    // the active actor. The caster (recipientIds[0], stealing on its own turn) gets
                    // it; adjacent-ally recipients are not the active actor → no reprieve, they
                    // decrement normally on their own turn (their duration was already preserved by
                    // the transfer).
                    appliedThisTurn: recipientId === currentTurnActorId,
                });
            }
        }
        return stolen.map((s) => s.buffName);
    };

    // --- Ability-status API ---

    const registerAbilityStatuses = (
        statuses: RegisteredAbilityStatus[],
        ownerId = 'attacker',
        enemyTargetId = DEFAULT_ENEMY_TARGET
    ): void => {
        // Registered AFTER scheduled entries so list-order parity is preserved.
        // `ownerId` routes self-side statuses to the correct per-owner store so that a team
        // ship's aura/accumulating effects don't fold into the attacker's reads and vice versa.
        // `enemyTargetId` routes enemy-side accum/aura statuses to the correct per-target store;
        // defaults to DEFAULT_ENEMY_TARGET.
        for (const s of statuses) {
            if (s.kind === 'accumulating') {
                // Self-side accumulating statuses go into the given owner's map; enemy-side
                // statuses go into the given target's map (keyed by enemyTargetId).
                const map =
                    s.side === 'self' ? getAccumSelf(ownerId) : getAccumEnemy(enemyTargetId);
                // Ability accumulating statuses join the accumulating machinery with a
                // payload + (live-gated) conditions for per-round aura gating of effects.
                // s.stackTrigger is non-optional on the accumulating variant — no ! needed.
                //
                // The GRANTER whose cadence this share rides. `casterId` is stamped by the
                // engine's fan-out on every ability-sourced status; a fixture that omits it falls
                // back to the attacker, i.e. the pre-#436 cadence.
                const contribution: AccumulatingContribution = {
                    granterId: s.casterId ?? 'attacker',
                    rate: s.payload.stacks,
                    trigger: s.stackTrigger,
                };
                const existing = map.get(s.payload.buffName);
                if (existing) {
                    // #436 ruling B: a second grant of the same buff onto this owner ADDS a
                    // share; it does not replace the first. Pre-#436 this was a `.set()`, so
                    // Centurion's own 4-stack self grant and a neighbouring Centurion's 2-stack
                    // adjacent grant collapsed to whichever registered last — which is why his
                    // pre-fix double-registration onto himself was harmless rather than doubling.
                    //
                    // No de-duplication by granter: registration happens ONCE per actor per fight
                    // (engine.ts's registerActorAbilityStatuses runs at actor construction and is
                    // never revisited), so a repeat registration onto one owner is two genuine
                    // grants, and a dedupe key would silently swallow one of them — the very bug
                    // this repairs.
                    //
                    // `payload`, `conditions`, `casterId` and `maxStacks` stay the FIRST
                    // registration's. Measured corpus-wide 2026-09-01 (all 149 ships): every
                    // accumulating grant carries `conditions: []` and the declared cap agrees
                    // within every buffName, so there is nothing for a second registration to
                    // disagree about. A future kit that breaks either invariant needs a real
                    // decision here rather than a silent first-wins; the census that measured it
                    // is in the #436 plan under docs/superpowers/plans/.
                    existing.contributions.push(contribution);
                } else {
                    map.set(s.payload.buffName, {
                        buffName: s.payload.buffName,
                        stacks: 0,
                        maxStacks: s.maxStacks,
                        contributions: [contribution],
                        payload: s.payload,
                        conditions: s.conditions,
                        casterId: s.casterId,
                    });
                }
            } else if (s.kind === 'aura') {
                // Self-side auras are per-owner; enemy-side auras are per-target.
                (s.side === 'self' ? getAuraSelf(ownerId) : getAuraEnemy(enemyTargetId)).push(s);
            }
            // timed statuses are applied lazily via applyTimedAbilityStatus when their
            // source slot fires and the application gate passes.
        }
    };

    const applyTimedAbilityStatus = (
        round: number,
        status: Extract<RegisteredAbilityStatus, { kind: 'timed' }>,
        recipientId?: string,
        enemyTargetId?: string
    ): void => {
        if (round < 1) {
            // lastRound initializes to 0, so the equality check alone would accept
            // round 0 before the first beginRound call. Rounds are 1-based.
            throw new Error(
                `StatusEngine.applyTimedAbilityStatus called for round ${round}; rounds are 1-based`
            );
        }
        if (round !== lastRound) {
            throw new Error(
                `StatusEngine.applyTimedAbilityStatus called for round ${round}, but the engine is at round ${lastRound}`
            );
        }
        // Resolve the effective ids per side:
        //   self side  → recipientId (player-side carrier, defaults to 'attacker')
        //   enemy side → enemyTargetId (enemy target's debuff store, defaults to DEFAULT_ENEMY_TARGET)
        // `recipientId` is IGNORED for enemy-side statuses; `enemyTargetId` is IGNORED for self-side.
        // So at the call site `applyTimedAbilityStatus(r, status, actor.id)` an enemy-side status
        // goes to DEFAULT_ENEMY_TARGET regardless of what actor.id is passed.
        const selfEffectiveId = recipientId ?? 'attacker';
        const enemyEffectiveId = enemyTargetId ?? DEFAULT_ENEMY_TARGET;

        // Persistent stacking statuses route by NAME before the family-rule timed path: this
        // application landed (the landing roll/hook already ran at the caller's site), so add a
        // stack (capped) and keep the payload for folding. The status.duration (text value) is
        // intentionally ignored — the buff-name rule overrides it (game-verified 2026-06-05).
        if (isPersistentByName(status.payload.buffName)) {
            // A hit-counted grant cannot take this door: the persistent store is keyed by raw
            // buff name with no per-entry lifecycle, and `consumeStatusHit` only spends from the
            // timed selfMaps — so `status.hits` would be dropped here and the status would be
            // permanent and unspendable (the one-shot-in-an-unreachable-channel defect class).
            // Unreachable today by construction: `isPersistentByName` is the UNION of two closed
            // sets — PERSISTENT_STACKING_BUFFS (Defense Shred / Blast / Overload / Titanite) and
            // ONE_SHOT_PERSISTENT_BUFFS (Shield Converter / Charged Overdrive II) — and none of
            // the six parse a hit count. Throwing rather than silently dropping so a future
            // parser change fails LOUDLY.
            if (status.hits !== undefined) {
                throw new Error(
                    `StatusEngine.applyTimedAbilityStatus: hit-counted status '${status.payload.buffName}' ` +
                        `is a persistent-stacking or one-shot-persistent name — the persistent store cannot ` +
                        `carry a hit count. Route it through the timed path or extend the persistent store first.`
                );
            }
            addPersistentStack(
                status.side,
                status.payload.buffName,
                status.payload.stacks || 1,
                status.payload,
                status.side === 'self' ? selfEffectiveId : enemyEffectiveId
            );
            return;
        }
        // status.duration is guaranteed numeric by the timed variant — no runtime guard needed.
        // Self-side statuses go to the player-side carrier; enemy-side statuses go to the
        // requested enemy target's debuff store (keyed by enemyTargetId).
        const map =
            status.side === 'self' ? getSelfMap(selfEffectiveId) : getEnemyMap(enemyEffectiveId);
        const { familyKey, tier } = deriveFamilyKey(status.payload.buffName);
        // Boost: +N turns on a buff the caster APPLIES, self-side only (debuffs land enemy-side).
        // Caster fail-safe: fixtures may omit casterId → default to 'attacker'.
        const extension =
            status.side === 'self' ? buffDurationExtensionFor(status.casterId ?? 'attacker') : 0;
        const duration = status.duration + extension;
        const existing = map.get(familyKey);
        // A landed-but-family-blocked application is silently absorbed: the landing roll
        // was already consumed by the caller's gate (the family rule runs AFTER the landing
        // hook), so a blocked application is NOT recorded as resisted — the stronger/longer
        // buff simply persists and this entry never enters the timed-ability folding.
        if (!familyApplicationWins(existing, tier, duration)) return;
        // LIVE stack count for this entry (see BuffState.stacks). Re-application semantics
        // (owner ruling 2026-08-10):
        //  - a stackable status landing on a victim that still holds it ADDS the incoming stacks,
        //    capped at maxStacks — the same "add a stack (capped)" rule the persistent-stacking
        //    door above already applies (addPersistentStack), so the two doors agree;
        //  - anything else REFRESHES to the incoming declared count. That covers the first
        //    application (no `existing`) and every non-stackable re-application, which is what
        //    both corpus Exposed appliers are: Amartya's reactive payload comes from
        //    payloadFromConfig, which does not even carry isStackable, and Nayra's cast config
        //    declares isStackable: false. So on today's corpus this is always the refresh branch,
        //    and refresh-to-declared is exactly the value the entry has always held implicitly.
        // The DURATION refresh is untouched — `existing` reaches here only because
        // familyApplicationWins already ruled on it.
        const declaredStacks = status.payload.stacks ?? 1;
        const liveStacks =
            existing !== undefined && status.payload.isStackable === true
                ? Math.min(
                      (existing.stacks ?? declaredStacks) + declaredStacks,
                      status.maxStacks ?? Infinity
                  )
                : declaredStacks;
        map.set(familyKey, {
            buffName: status.payload.buffName,
            turnsRemaining: duration,
            tier,
            payload: status.payload,
            casterId: status.casterId,
            stacks: liveStacks,
            appliedSeq: nextAppliedSeq(),
            // Own-turn reprieve. Self-side: any timed self-buff applied while its carrier is the
            // active actor. Enemy-side: ONLY an opt-in reprieve status (on-destroyed Martyrdom
            // Disable) landing on the actor whose turn is executing — so decrementEnemy skips the
            // first same-turn tick, mirroring the self-side protection. All other enemy debuffs
            // (no flag) stay falsy → decrement immediately.
            appliedThisTurn:
                status.side === 'self'
                    ? selfEffectiveId === currentTurnActorId
                    : status.reprieveOnRecipientTurn === true &&
                      enemyEffectiveId === currentTurnActorId,
            // Hit-counted lifecycle. Stamped only when the registered status asks for it, so
            // every existing timed write leaves the field undefined and behaves as before.
            ...(status.hits !== undefined ? { hitsRemaining: status.hits } : {}),
        });
    };

    const activeAbilityStatuses = (
        side: 'self' | 'enemy',
        resolveCtx: (casterId: string) => ConditionContext,
        ownerId = 'attacker',
        enemyTargetId = DEFAULT_ENEMY_TARGET
    ): ActiveAbilityStatus[] => {
        const out: ActiveAbilityStatus[] = [];
        // Auras: effect included only when their (live-gated) conditions pass this round, gated
        // against the CASTER's ctx (an ally-cast aura sitting on this recipient owner is
        // still gated by the caster's buffs/state — resolveCtx maps casterId → that ctx).
        // Self-side auras are per-owner — only the requested owner's list is read so a team
        // ship's aura doesn't silently fold into the attacker's round totals and vice versa.
        // Enemy-side auras are per-target — only the requested target's list is read (mirrors
        // self), PLUS the board-wide entries from the singular DEFAULT_ENEMY_TARGET bucket (#390).
        const perTargetAuras = side === 'enemy' ? (auraEnemyMaps.get(enemyTargetId) ?? []) : [];
        const perTargetAuraNames = new Set(perTargetAuras.map((a) => a.payload.buffName));
        const auraList =
            side === 'self'
                ? (auraSelfMaps.get(ownerId) ?? [])
                : [
                      ...perTargetAuras,
                      ...boardWideEnemyExtras(
                          auraEnemyMaps.get(DEFAULT_ENEMY_TARGET),
                          enemyTargetId,
                          (a) => a.payload.buffName,
                          (name) => perTargetAuraNames.has(name)
                      ),
                  ];
        for (const a of auraList) {
            // casterId defaults to 'attacker' (the engine always sets it; only unit-test
            // fixtures omit it) so the resolver returns the local ctx in the attacker-only path.
            if (!conditionsMet(a.conditions, resolveCtx(a.casterId ?? 'attacker'))) continue;
            out.push({
                payload: a.payload,
                active: {
                    buffName: a.payload.buffName,
                    turnsRemaining: 'recurring',
                    // A one-time "N stacks" grant (Meatshield's Protection) rides the
                    // aura branch once its per-round stackTrigger cadence is suppressed (a stackable,
                    // non-accumulating buff — see skillTextParser's startOfCombatOneShot carve-out).
                    // Without this, the aura's reported stack count silently dropped (undefined),
                    // even though the STATIC payload.stacks carried the configured count all along.
                    // Gated on isStackable (not just `stacks !== undefined`) because EVERY buff/debuff
                    // payload carries a `stacks` field — non-stackable buffs default it to 1, which is
                    // a structural placeholder, not a meaningful count to surface here.
                    ...(a.payload.isStackable && a.payload.stacks !== undefined
                        ? { stacks: a.payload.stacks }
                        : {}),
                },
                casterId: a.casterId,
            });
        }
        // Accumulating ability statuses: included when stacks > 0 AND conditions pass (gated
        // against the caster's ctx, same as auras).
        // Self-side accumulating statuses are per-owner — read the requested owner's map.
        // Enemy-side accumulating statuses are per-target — read the requested target's map.
        const accumMap =
            side === 'self'
                ? (accumSelfMaps.get(ownerId) ?? new Map<string, AccumulatingState>())
                : (accumEnemyMaps.get(enemyTargetId) ?? new Map<string, AccumulatingState>());
        // #390: the board-wide entries from the DEFAULT_ENEMY_TARGET bucket, minus any buffName
        // the per-target map already holds — a real per-target entry is the more specific answer
        // and must not be doubled by the bucket's copy.
        // #390: the DEFAULT_ENEMY_TARGET fold is deliberately NOT applied to the accumulating
        // store, even for a board-wide target. `removeNewestFirst` (cleanse) gathers its
        // accumulating candidates from `accumEnemyMaps.get(actorId)` alone, so a folded entry
        // would be visible in every victim's read yet absent from every victim's cleanse — a
        // status that cannot be removed from one enemy without removing it from all of them,
        // which contradicts the very ruling this repair implements ("stays until it is cleansed
        // or removed in another way"). Auras have no such conflict: they are uncleansable BY
        // CONSTRUCTION on both sides (see removeNewestFirst's "NOT in these maps" note — they
        // re-derive each round and have no stored entry to remove), so folding them changes
        // nothing about removability. The accumulating half needs the same real fix the subset
        // scopes need — registration at CAST time, per resolved victim — and stays dropped until
        // then, guarded by `enemyAuraChannelCorpus.test.ts`.
        for (const s of accumMap.values()) {
            if (!s.payload) continue;
            if (s.stacks <= 0) continue;
            // s.casterId is present for ability-sourced accumulating statuses; scheduled accum
            // entries carry no conditions so the gate is skipped (and they have no casterId).
            if (s.conditions && !conditionsMet(s.conditions, resolveCtx(s.casterId ?? 'attacker')))
                continue;
            out.push({
                payload: { ...s.payload, stacks: s.stacks },
                active: { buffName: s.buffName, turnsRemaining: 'recurring', stacks: s.stacks },
                casterId: s.casterId,
            });
        }
        return out;
    };

    const timedAbilityStatuses = (
        side: 'self' | 'enemy',
        ownerId = 'attacker',
        enemyTargetId = DEFAULT_ENEMY_TARGET
    ): ActiveAbilityStatus[] => {
        // Self maps are per-owner (keyed by ownerId); enemy maps are per-target (keyed by
        // enemyTargetId). The `ownerId` param is ignored for enemy-side; `enemyTargetId`
        // is ignored for self-side.
        // LIVE stack count. This branch surfaces `BuffState.stacks` — the per-entry copy a
        // consume-one-stack API can move (Exposed) — the same way the aura and persistent branches
        // surface theirs: spread over the payload so `payload.stacks` reads the live value without
        // anyone mutating the shared, by-reference registered payload.
        //
        // GATED ON DIVERGENCE, deliberately not on `payload.isStackable`. Divergence is the only
        // gate that is both (a) inert for every status nothing has spent from — which is
        // every status in the corpus except a partly-spent Exposed — and (b) actually reachable by
        // the mechanic it exists for: NEITHER corpus Exposed applier sets isStackable (Amartya's
        // reactive payload is built by payloadFromConfig, which drops the flag entirely; Nayra's
        // cast config declares it false), so an isStackable gate would leave `payload.stacks` stuck
        // at the declared count and Exposed would re-read its full amplification forever.
        // Only consumeTimedEnemyStatusStack can make `stacks` diverge, so nothing else moves.
        const map = side === 'self' ? selfMaps.get(ownerId) : enemyMaps.get(enemyTargetId);
        const out: ActiveAbilityStatus[] = [];
        if (map) {
            for (const s of map.values()) {
                if (!s.payload) continue;
                const live = s.stacks;
                const spent = live !== undefined && live !== s.payload.stacks;
                out.push({
                    payload: spent ? { ...s.payload, stacks: live } : s.payload,
                    active: {
                        buffName: s.buffName,
                        turnsRemaining: s.turnsRemaining,
                        // Kept in lockstep with the payload above: a partly-spent entry reporting
                        // a live payload count but no `active.stacks` (which readers default to 1)
                        // would have the two halves of one entry disagreeing.
                        ...(spent ? { stacks: live } : {}),
                    },
                    casterId: s.casterId,
                });
            }
        }
        // Ability-sourced persistent stacking statuses (payload-carrying): folded exactly like
        // landed timed statuses but with a stack multiplier and the 'permanent' sentinel (no
        // expiry, no per-round re-roll). The fold multiplies effect × stacks via the payload.
        // Persistent self statuses are per-owner; persistent enemy statuses are per-target.
        const persistentMap =
            side === 'self'
                ? persistentSelfMaps.get(ownerId)
                : persistentEnemyMaps.get(enemyTargetId);
        if (persistentMap) {
            for (const s of persistentMap.values()) {
                if (!s.payload) continue;
                out.push({
                    payload: { ...s.payload, stacks: s.stacks },
                    active: {
                        buffName: s.buffName,
                        turnsRemaining: 'permanent',
                        stacks: s.stacks,
                    },
                });
            }
        }
        return out;
    };

    return {
        beginRound,
        sourceFired,
        setLandsTimedEnemyApplication,
        snapshot,
        decrementPlayer,
        beginTurn,
        decrementEnemy,
        clearRemovable,
        removeTimedEnemyStatus,
        reduceTimedEnemyStatus,
        consumeTimedEnemyStatusStack,
        removeSelfBuffByName,
        consumeStatusHit,
        cleanse,
        reduceNewestDebuffDuration,
        reduceAllDebuffsDuration,
        extendAllDebuffsDuration,
        extendAllBuffsDuration,
        purge,
        steal,
        registerAbilityStatuses,
        applyTimedAbilityStatus,
        activeAbilityStatuses,
        timedAbilityStatuses,
    };
}
