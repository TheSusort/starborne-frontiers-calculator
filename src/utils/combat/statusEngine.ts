import { ParsedBuffEffects, SelectedGameBuff, StackTrigger } from '../../types/calculator';
import { Condition, SkillSlot } from '../../types/abilities';
import { conditionsMet, ConditionContext } from '../abilities/evaluateConditions';
import { PERSISTENT_STACKING_BUFFS } from '../../constants/persistentStackingBuffs';

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
    /** Team-actor scheduled sources (Phase 2 Task 8). Each source's TIMED entries key
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
     *  (Task 7). The engine owns the gate + affinity rule and threads it here. When
     *  it returns false the upsert is SKIPPED (no status stored, the existing one is
     *  not cleared) and the buffName is collected into sourceFired's `resistedEnemy`.
     *  Optional — defaulting to "always lands" keeps the unit tests gate-free. */
    landsTimedEnemyApplication?: (buff: SelectedGameBuff) => boolean;
}

/** Effect payload of an ability-sourced status, folded into the round totals by the engine. */
export interface AbilityStatusPayload {
    buffName: string;
    stacks: number;
    parsedEffects: ParsedBuffEffects;
    application?: 'inflict' | 'apply';
}

interface AbilityStatusBase {
    payload: AbilityStatusPayload;
    side: 'self' | 'enemy';
    sourceSlot: SkillSlot;
    /** Already live-gated by the caller (see abilityStatusGating.liveGateConditions). */
    conditions: Condition[];
    /** The actor that CAST this ability (Task 5 ally routing). Conditions evaluate against the
     *  caster's context even when the status lives on a different recipient (an ally-cast aura's
     *  gate is the caster's). The ENGINE always sets this (casterId = the registering owner);
     *  it is OPTIONAL only so the statusEngine's own unit-test fixtures need not restate it —
     *  read sites default it to 'attacker'. Historical/attacker-only statuses are casterId
     *  'attacker' → identical to today (the resolver returns the local ctx for the caster). */
    casterId?: string;
    /** Player-side RECIPIENTS that receive this status (Task 5 ally routing): `self` → [casterId];
     *  `ally`/`all-allies` → every player actor id (fixed source order). Enemy-side statuses ignore
     *  this (enemy maps are singular). The ENGINE always sets this on the timed-by-slot statuses it
     *  threads into playerTurn (the per-recipient application loop reads it); OPTIONAL only so the
     *  statusEngine unit-test fixtures need not restate it. For attacker-only runs this is always
     *  ['attacker'] → zero churn vs the pre-Task-5 owner-routing. */
    recipients?: string[];
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
    | (AbilityStatusBase & { kind: 'timed'; duration: number })
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
    /** The actor that CAST this status (Task 7 HoT attribution). Present whenever the
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
     *  `teamSources`; unregistered ids no-op. Applies timed scheduled buffs keyed
     *  to (sourceId, slot) and increments per-active/per-charge accumulating
     *  stacks when sourceId === 'attacker'. Returns:
     *  - `resistedEnemy`: buffNames of TIMED enemy upserts the landing hook rejected
     *    (so the engine can emit debuff-resisted and record them in the resisted list).
     *  - `appliedEnemy`: buffNames of TIMED enemy upserts that LANDED this call,
     *    collected BEFORE the family-rule upsert (so family-absorbed applications
     *    still count as inflicted — the unit did inflict; family absorption is an
     *    internal map rule). The engine emits `debuff-applied` once per name here
     *    (the discrete-infliction event, Phase 3 retiming). */
    sourceFired(
        sourceId: string,
        slot: 'active' | 'charge',
        round: number
    ): { resistedEnemy: string[]; appliedEnemy: string[] };
    /** The round's active lists (was step()'s return). Pure read.
     *  `ownerId` selects which player-side carrier's maps to read; defaults to
     *  'attacker' so all pre-Task-2 call sites remain unchanged. Always-active
     *  and accumulating scheduled buffs are attacker-owned and always appear in
     *  the 'attacker' snapshot (legacy semantics unchanged).
     *  `enemyTargetId` selects which enemy-side target's debuff maps to read;
     *  defaults to the singular default enemy target (pre-Task-1 path, byte-identical). */
    snapshot(
        ownerId?: string,
        enemyTargetId?: string
    ): { activeSelfBuffs: ActiveBuff[]; activeEnemyDebuffs: ActiveBuff[] };
    /** Owner Post-Turn: decrement ALL timed statuses on the named player-side carrier
     *  — including ones applied earlier in this same turn (same-turn decrement rule).
     *  Calling on an owner with no statuses (lazy-empty map) is a safe no-op.
     *  Returns expired buff names so the engine can emit buff-expired. */
    decrementPlayer(ownerId: string): { expired: string[] };
    /** Owner Post-Turn (enemy side): decrement ALL timed enemy statuses for the given
     *  `targetId` (defaults to the singular default enemy target — pre-Task-1 path,
     *  byte-identical). Returns expired buff names so the engine can emit buff-expired. */
    decrementEnemy(targetId?: string): { expired: string[] };
    /** Register all buff/debuff abilities once at creation (classified by `kind`).
     *  `ownerId` routes self-side statuses to the correct per-owner store (defaults to 'attacker').
     *  `enemyTargetId` routes enemy-side accum/aura statuses to the correct per-target store
     *  (defaults to the singular default enemy target — pre-Task-1 path, byte-identical);
     *  ignored for self-side statuses. */
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
     *  (defaults to the singular default enemy target — pre-Task-1 path, byte-identical);
     *  ignored for self-side statuses. */
    applyTimedAbilityStatus(
        round: number,
        status: Extract<RegisteredAbilityStatus, { kind: 'timed' }>,
        recipientId?: string,
        enemyTargetId?: string
    ): void;
    /** Aura + accumulating ability statuses whose conditions pass THIS ROUND, with payloads,
     *  for effect folding and snapshot inclusion. `ownerId` selects the player-side carrier
     *  (defaults to 'attacker'). Each status's gate evaluates against ITS CASTER's context —
     *  `resolveCtx(casterId)` returns the ConditionContext for that caster (Task 5: an ally-cast
     *  aura sitting on a recipient is still gated by the caster's buffs/state). For attacker-only
     *  runs every casterId is 'attacker' and the resolver returns the local ctx → zero churn.
     *  `enemyTargetId` selects which enemy target's accum/aura maps to read for enemy-side
     *  statuses; defaults to the singular default enemy target (pre-Task-1 path, byte-identical).
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
     *  to the singular default enemy target (pre-Task-1 path, byte-identical). Ignored for
     *  self-side statuses. */
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

function deriveFamilyKey(name: string): { familyKey: string; tier: number } {
    if (DOT_PREFIXES.has(name.split(' ')[0])) return { familyKey: name, tier: 0 };
    const m = ROMAN_SUFFIX.exec(name);
    if (!m) return { familyKey: name, tier: 0 };
    return { familyKey: name.slice(0, m.index), tier: TIER_VALUES[m[1]] };
}

/** Game rule (user-verified 2026-06-04): within a buff family, a new application wins only
 *  if its tier is higher, or the tier is equal and the new cast outlasts the remaining
 *  window. Otherwise the application is skipped — the stronger/longer buff stays. Note that
 *  same-source re-applications still refresh: after the post-turn decrement a 2-turn buff
 *  has 1 remaining, and 2 > 1 so the fresh 2-turn cast wins. */
function familyApplicationWins(
    existing: BuffState | undefined,
    tier: number,
    duration: number
): boolean {
    if (!existing) return true;
    if (existing.tier !== tier) return existing.tier < tier;
    return duration > existing.turnsRemaining;
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
    /** The caster of an ability-sourced timed status (Task 7 HoT attribution). Stamped at
     *  application from `status.casterId`. Undefined for scheduled timed upserts (no caster
     *  identity) and for timed statuses whose registered status omitted casterId. */
    casterId?: string;
}

interface AccumulatingState {
    buffName: string;
    stacks: number;
    maxStacks: number | undefined;
    rate: number;
    trigger: 'per-round' | 'per-active' | 'per-charge';
    /** Present for ability-sourced accumulating statuses (payload + aura-gate conditions). */
    payload?: AbilityStatusPayload;
    conditions?: Condition[];
    /** The caster of an ability-sourced accumulating status — its gate evaluates against the
     *  caster's ctx (Task 5). Undefined for scheduled accum entries (no conditions → no gate). */
    casterId?: string;
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
 * are reported, not computed (the old computeChargeSchedule path is retired).
 */
export function createStatusEngine(input: StatusEngineInput): StatusEngine {
    const { selfBuffs, enemyDebuffs } = input;
    const teamSources = input.teamSources ?? [];
    // Default: every timed enemy application lands (no gate) — keeps statusEngine unit
    // tests simple. The engine supplies the real hacking/affinity decision.
    const landsTimedEnemyApplication = input.landsTimedEnemyApplication ?? (() => true);

    // Categorized collections — kept as named closure variables (not inlined) so
    // Task 6 can append ability-sourced statuses to them later.
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

    // DEFAULT_ENEMY_TARGET: the pre-Task-1 singular enemy target id. Callers that do not
    // supply an enemyTargetId resolve to this constant → byte-identical to the old singular
    // enemyMap/accumEnemyMap/auraEnemy path.
    const DEFAULT_ENEMY_TARGET = '__enemy__';

    // Per-owner player-side accumulating maps. `accumSelfMaps` is keyed by ownerId → (buffName →
    // AccumulatingState), lazy-created on first write (mirroring selfMaps/persistentSelfMaps).
    // Scheduled accumulating buffs seed the 'attacker' owner's map (legacy semantics: always-active
    // and accumulating scheduled entries are cadence-independent attacker-owned grants). Later tasks
    // can seed team-actor maps for team-sourced accumulating statuses.
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
            rate: b.stacks,
            trigger: b.stackTrigger!,
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
            rate: b.stacks,
            trigger: b.stackTrigger!,
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
    // callers that do not supply a targetId resolve to it → byte-identical to the old singular enemyMap.
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
        const maxStacks = PERSISTENT_STACKING_BUFFS.get(buffName);
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

        // (Decrement+expire moved out to decrementPlayer/decrementEnemy, called from each
        //  owner's Post Turn in the engine.)

        const incrementPerRound = (map: Map<string, AccumulatingState>) => {
            for (const state of map.values()) {
                if (state.trigger !== 'per-round') continue;
                state.stacks =
                    state.maxStacks !== undefined
                        ? Math.min(state.stacks + state.rate, state.maxStacks)
                        : state.stacks + state.rate;
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
    // the DEFAULT_ENEMY_TARGET on the enemy side (legacy semantics: scheduled buffs/debuffs
    // ride the attacker's cadence and route to the singular default stores — byte-identical
    // to the pre-Task-1 enemyMap/persistentEnemy single-store path).
    const upsertBuff = (buff: SelectedGameBuff, side: 'self' | 'enemy') => {
        const map = side === 'self' ? getSelfMap('attacker') : getEnemyMap(DEFAULT_ENEMY_TARGET);
        // Persistent stacking statuses route by NAME before the family-rule timed path: this
        // application landed (the landing hook already ran at the call site), so add a stack
        // (capped) to the persistent map. The text skillDuration is intentionally ignored — the
        // buff-name rule overrides it (game-verified 2026-06-05).
        if (PERSISTENT_STACKING_BUFFS.has(buff.buffName)) {
            addPersistentStack(side, buff.buffName, buff.stacks || 1);
            return;
        }
        if (typeof buff.skillDuration !== 'number') return;
        const { familyKey, tier } = deriveFamilyKey(buff.buffName);
        const existing = map.get(familyKey);
        if (!familyApplicationWins(existing, tier, buff.skillDuration)) return;
        map.set(familyKey, {
            buffName: buff.buffName,
            turnsRemaining: buff.skillDuration,
            tier,
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
        const sets = timedBySource.get(sourceId);
        if (!sets) return { resistedEnemy: [], appliedEnemy: [] };

        // Per-active/per-charge accumulating stacks tick on the matching slot — ATTACKER
        // only (these track the attacker's own cadence; later tasks may generalise this per
        // team actor). Reads the 'attacker' owner's map; no-op if not yet populated.
        if (sourceId === 'attacker') {
            const incrementSlot = (map: Map<string, AccumulatingState>) => {
                for (const state of map.values()) {
                    const fires =
                        (state.trigger === 'per-active' && slot === 'active') ||
                        (state.trigger === 'per-charge' && slot === 'charge');
                    if (fires) {
                        state.stacks =
                            state.maxStacks !== undefined
                                ? Math.min(state.stacks + state.rate, state.maxStacks)
                                : state.stacks + state.rate;
                    }
                }
            };
            // Only increment the attacker's own accum map (legacy semantics).
            const attackerAccum = accumSelfMaps.get('attacker');
            if (attackerAccum) incrementSlot(attackerAccum);
            // Increment ALL enemy target accum maps — per-active/per-charge enemy stacks
            // ride the attacker's cadence regardless of target id (legacy semantics).
            for (const targetAccum of accumEnemyMaps.values()) {
                incrementSlot(targetAccum);
            }
        }

        // Timed scheduled buffs (this source's) whose skillSource matches the fired slot.
        for (const buff of sets.timedSelf) {
            if (buff.skillSource === slot) upsertBuff(buff, 'self');
        }
        // Timed ENEMY upserts draw the landing decision ONCE here (Task 7). A rejected
        // application is NOT upserted (the existing in-window status is untouched) and
        // its buffName is collected so the engine can emit debuff-resisted + record it.
        // A landed application's buffName is collected BEFORE the family-rule upsert so
        // family-absorbed applications still count as inflicted (the unit did inflict; the
        // family rule is an internal map rule). The engine emits `debuff-applied` once per
        // name in appliedEnemy (the discrete-infliction event — Phase 3 retiming).
        const resistedEnemy: string[] = [];
        const appliedEnemy: string[] = [];
        for (const buff of sets.timedEnemy) {
            if (buff.skillSource !== slot) continue;
            const isPersistent = PERSISTENT_STACKING_BUFFS.has(buff.buffName);
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

    // snapshot: the round's active lists (was step()'s return). Pure read.
    // `ownerId` selects which player-side carrier's timed maps to include; defaults
    // to 'attacker'. Always-active and accumulating scheduled buffs are attacker-owned
    // and always appear in the 'attacker' snapshot regardless of `ownerId`.
    // `enemyTargetId` selects which enemy-side target's debuff maps to include; defaults
    // to DEFAULT_ENEMY_TARGET (pre-Task-1 path, byte-identical).
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

    // Owner Post-Turn decrement helpers. The status CARRIER decrements ALL its timed
    // statuses by one turn, INCLUDING ones applied earlier in this same turn (same-turn
    // decrement rule — skipping same-turn applications would ADD a round). Expired
    // statuses are removed and their stored buffName reported so the engine emits
    // buff-expired. Ability-sourced timed statuses live in the same maps and decrement here.

    /** Decrement all timed statuses for the named player-side carrier. Calling on an owner
     *  with no statuses (lazy-empty map) is a safe no-op. */
    const decrementPlayer = (ownerId: string): { expired: string[] } => {
        const map = selfMaps.get(ownerId);
        const expired: string[] = [];
        if (map) {
            for (const [key, s] of map) {
                s.turnsRemaining -= 1;
                if (s.turnsRemaining <= 0) {
                    expired.push(s.buffName);
                    map.delete(key);
                }
            }
        }
        return { expired };
    };

    /** Decrement all timed enemy statuses for the given targetId.
     *  Defaults to DEFAULT_ENEMY_TARGET (pre-Task-1 path, byte-identical).
     *  Calling on a target with no statuses (lazy-empty map) is a safe no-op. */
    const decrementEnemy = (targetId = DEFAULT_ENEMY_TARGET): { expired: string[] } => {
        const map = enemyMaps.get(targetId);
        const expired: string[] = [];
        if (map) {
            for (const [key, s] of map) {
                s.turnsRemaining -= 1;
                if (s.turnsRemaining <= 0) {
                    expired.push(s.buffName);
                    map.delete(key);
                }
            }
        }
        return { expired };
    };

    // --- Ability-status API (Task 6) ---

    const registerAbilityStatuses = (
        statuses: RegisteredAbilityStatus[],
        ownerId = 'attacker',
        enemyTargetId = DEFAULT_ENEMY_TARGET
    ): void => {
        // Registered AFTER scheduled entries so list-order parity is preserved.
        // `ownerId` routes self-side statuses to the correct per-owner store so that a team
        // ship's aura/accumulating effects don't fold into the attacker's reads and vice versa.
        // `enemyTargetId` routes enemy-side accum/aura statuses to the correct per-target store;
        // defaults to DEFAULT_ENEMY_TARGET (pre-Task-1 path, byte-identical).
        for (const s of statuses) {
            if (s.kind === 'accumulating') {
                // Self-side accumulating statuses go into the given owner's map; enemy-side
                // statuses go into the given target's map (keyed by enemyTargetId).
                const map =
                    s.side === 'self' ? getAccumSelf(ownerId) : getAccumEnemy(enemyTargetId);
                // Ability accumulating statuses join the accumulating machinery with a
                // payload + (live-gated) conditions for per-round aura gating of effects.
                // s.stackTrigger is non-optional on the accumulating variant — no ! needed.
                map.set(s.payload.buffName, {
                    buffName: s.payload.buffName,
                    stacks: 0,
                    maxStacks: s.maxStacks,
                    rate: s.payload.stacks,
                    trigger: s.stackTrigger,
                    payload: s.payload,
                    conditions: s.conditions,
                    casterId: s.casterId,
                });
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
        // This keeps the existing call site `applyTimedAbilityStatus(r, status, actor.id)` byte-identical:
        // enemy-side statuses still go to DEFAULT_ENEMY_TARGET regardless of what actor.id is passed.
        const selfEffectiveId = recipientId ?? 'attacker';
        const enemyEffectiveId = enemyTargetId ?? DEFAULT_ENEMY_TARGET;

        // Persistent stacking statuses route by NAME before the family-rule timed path: this
        // application landed (the landing roll/hook already ran at the caller's site), so add a
        // stack (capped) and keep the payload for folding. The status.duration (text value) is
        // intentionally ignored — the buff-name rule overrides it (game-verified 2026-06-05).
        if (PERSISTENT_STACKING_BUFFS.has(status.payload.buffName)) {
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
        const existing = map.get(familyKey);
        // A landed-but-family-blocked application is silently absorbed: the landing roll
        // was already consumed by the caller's gate (the family rule runs AFTER the landing
        // hook), so a blocked application is NOT recorded as resisted — the stronger/longer
        // buff simply persists and this entry never enters the timed-ability folding.
        if (!familyApplicationWins(existing, tier, status.duration)) return;
        map.set(familyKey, {
            buffName: status.payload.buffName,
            turnsRemaining: status.duration,
            tier,
            payload: status.payload,
            casterId: status.casterId,
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
        // against the CASTER's ctx (Task 5: an ally-cast aura sitting on this recipient owner is
        // still gated by the caster's buffs/state — resolveCtx maps casterId → that ctx).
        // Self-side auras are per-owner — only the requested owner's list is read so a team
        // ship's aura doesn't silently fold into the attacker's round totals and vice versa.
        // Enemy-side auras are per-target — only the requested target's list is read (mirrors self).
        const auraList =
            side === 'self'
                ? (auraSelfMaps.get(ownerId) ?? [])
                : (auraEnemyMaps.get(enemyTargetId) ?? []);
        for (const a of auraList) {
            // casterId defaults to 'attacker' (the engine always sets it; only unit-test
            // fixtures omit it) so the resolver returns the local ctx in the attacker-only path.
            if (!conditionsMet(a.conditions, resolveCtx(a.casterId ?? 'attacker'))) continue;
            out.push({
                payload: a.payload,
                active: { buffName: a.payload.buffName, turnsRemaining: 'recurring' },
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
        // is ignored for self-side — matching the pre-Task-1 behavior where enemy maps were
        // singular and ownerId was never consulted for them.
        const map = side === 'self' ? selfMaps.get(ownerId) : enemyMaps.get(enemyTargetId);
        const out: ActiveAbilityStatus[] = [];
        if (map) {
            for (const s of map.values()) {
                if (!s.payload) continue;
                out.push({
                    payload: s.payload,
                    active: { buffName: s.buffName, turnsRemaining: s.turnsRemaining },
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
        snapshot,
        decrementPlayer,
        decrementEnemy,
        registerAbilityStatuses,
        applyTimedAbilityStatus,
        activeAbilityStatuses,
        timedAbilityStatuses,
    };
}
