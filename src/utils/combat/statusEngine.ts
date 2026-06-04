import { ParsedBuffEffects, SelectedGameBuff, StackTrigger } from '../../types/calculator';
import { Condition, SkillSlot } from '../../types/abilities';
import { conditionsMet, ConditionContext } from '../abilities/evaluateConditions';

export interface ActiveBuff {
    buffName: string;
    turnsRemaining: number | 'recurring';
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
}

export interface StatusEngine {
    /** Advance the round counter (strictly sequential, 1-based). Increments
     *  per-round accumulating stacks. Call once at the top of each round, before
     *  any turns. */
    beginRound(round: number): void;
    /** Notification that a source actually fired a slot this round. 'attacker'
     *  covers the attacker's own cadence AND all legacy/merged scheduled buffs
     *  (per-buff sourceChargeCount/sourceStartCharged are IGNORED — superseded;
     *  team actor ids join in a later task). Applies timed scheduled buffs keyed
     *  to (sourceId, slot) and increments per-active/per-charge accumulating
     *  stacks when sourceId === 'attacker'. Returns the buffNames of any TIMED enemy
     *  upserts the landing hook rejected this call (`resistedEnemy`), so the engine
     *  can emit debuff-resisted and record them in the round's resisted list. */
    sourceFired(
        sourceId: string,
        slot: 'active' | 'charge',
        round: number
    ): { resistedEnemy: string[] };
    /** The round's active lists (was step()'s return). Pure read. */
    snapshot(): { activeSelfBuffs: ActiveBuff[]; activeEnemyDebuffs: ActiveBuff[] };
    /** Owner Post-Turn: decrement ALL timed statuses on this side — including ones
     *  applied earlier in this same turn (spec: same-turn decrement rule; skipping
     *  same-turn applications would ADD a round). Returns expired buff names so the
     *  engine can emit buff-expired. */
    decrementSide(side: 'self' | 'enemy'): { expired: string[] };
    /** Register all buff/debuff abilities once at creation (classified by `kind`). */
    registerAbilityStatuses(statuses: RegisteredAbilityStatus[]): void;
    /** Apply a firing skill's TIMED ability status for this round; the engine passes
     *  only those whose application gate passed. Reuses the familyKey/tier upsert.
     *  `status.duration` is guaranteed numeric by the timed variant — no runtime guard needed. */
    applyTimedAbilityStatus(
        round: number,
        status: Extract<RegisteredAbilityStatus, { kind: 'timed' }>
    ): void;
    /** Aura + accumulating ability statuses whose conditions pass `ctx` this round,
     *  with payloads, for effect folding and snapshot inclusion. */
    activeAbilityStatuses(side: 'self' | 'enemy', ctx: ConditionContext): ActiveAbilityStatus[];
    /** Timed ability statuses currently in the maps (payload-carrying), for effect folding. */
    timedAbilityStatuses(side: 'self' | 'enemy'): ActiveAbilityStatus[];
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
 * attacker); `snapshot()` reads the round's active lists; `decrementSide` runs
 * in each owner's Post Turn. It predicts nothing — cadences are reported, not
 * computed (the old computeChargeSchedule path is retired).
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

    // Build accumulating state maps — start at 0 stacks, increment each trigger
    const accumSelfMap = new Map<string, AccumulatingState>();
    for (const b of accumSelf) {
        accumSelfMap.set(b.buffName, {
            buffName: b.buffName,
            stacks: 0,
            maxStacks: b.maxStacks,
            rate: b.stacks,
            trigger: b.stackTrigger!,
        });
    }
    const accumEnemyMap = new Map<string, AccumulatingState>();
    for (const b of accumEnemy) {
        accumEnemyMap.set(b.buffName, {
            buffName: b.buffName,
            stacks: 0,
            maxStacks: b.maxStacks,
            rate: b.stacks,
            trigger: b.stackTrigger!,
        });
    }

    const selfMap = new Map<string, BuffState>();
    const enemyMap = new Map<string, BuffState>();

    // Ability-sourced aura statuses (recurring/passive): held with their (already
    // live-gated) conditions; effect inclusion is re-evaluated per round.
    const auraSelf: Extract<RegisteredAbilityStatus, { kind: 'aura' }>[] = [];
    const auraEnemy: Extract<RegisteredAbilityStatus, { kind: 'aura' }>[] = [];

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

        // (Decrement+expire moved out to decrementSide, called from each owner's
        //  Post Turn in the engine — see the StatusEngine.decrementSide doc comment.)

        const incrementPerRound = (map: Map<string, AccumulatingState>) => {
            for (const state of map.values()) {
                if (state.trigger !== 'per-round') continue;
                state.stacks =
                    state.maxStacks !== undefined
                        ? Math.min(state.stacks + state.rate, state.maxStacks)
                        : state.stacks + state.rate;
            }
        };
        incrementPerRound(accumSelfMap);
        incrementPerRound(accumEnemyMap);
    };

    const upsertBuff = (buff: SelectedGameBuff, map: Map<string, BuffState>) => {
        if (typeof buff.skillDuration !== 'number') return;
        const { familyKey, tier } = deriveFamilyKey(buff.buffName);
        const existing = map.get(familyKey);
        if (existing && existing.tier > tier) return;
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
    ): { resistedEnemy: string[] } => {
        if (round !== lastRound) {
            throw new Error(
                `StatusEngine.sourceFired called for round ${round}, but the engine is at round ${lastRound}`
            );
        }
        const sets = timedBySource.get(sourceId);
        if (!sets) return { resistedEnemy: [] };

        // Per-active/per-charge accumulating stacks tick on the matching slot — ATTACKER
        // only (these track the attacker's own cadence).
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
            incrementSlot(accumSelfMap);
            incrementSlot(accumEnemyMap);
        }

        // Timed scheduled buffs (this source's) whose skillSource matches the fired slot.
        for (const buff of sets.timedSelf) {
            if (buff.skillSource === slot) upsertBuff(buff, selfMap);
        }
        // Timed ENEMY upserts draw the landing decision ONCE here (Task 7). A rejected
        // application is NOT upserted (the existing in-window status is untouched) and
        // its buffName is collected so the engine can emit debuff-resisted + record it.
        const resistedEnemy: string[] = [];
        for (const buff of sets.timedEnemy) {
            if (buff.skillSource !== slot) continue;
            if (typeof buff.skillDuration !== 'number') continue;
            if (!landsTimedEnemyApplication(buff)) {
                resistedEnemy.push(buff.buffName);
                continue;
            }
            upsertBuff(buff, enemyMap);
        }
        return { resistedEnemy };
    };

    // snapshot: the round's active lists (was step()'s return). Pure read.
    const snapshot = (): { activeSelfBuffs: ActiveBuff[]; activeEnemyDebuffs: ActiveBuff[] } => {
        // Always-active buffs injected as 'recurring'.
        // Deduplicate always-active by buffName so buffLookup expansion doesn't multiply effects
        const selfAlwaysSnap = [...new Map(alwaysSelf.map((b) => [b.buffName, b])).values()].map(
            (b) => ({ buffName: b.buffName, turnsRemaining: 'recurring' as const })
        );
        const enemyAlwaysSnap = [...new Map(alwaysEnemy.map((b) => [b.buffName, b])).values()].map(
            (b) => ({ buffName: b.buffName, turnsRemaining: 'recurring' as const })
        );
        // Accumulating buffs: include only when stacks > 0. Ability-sourced accumulating
        // statuses (payload-carrying) are excluded here — the engine collects them via
        // activeAbilityStatuses and appends them to the round lists after scheduled ones.
        const selfAccumSnap = [...accumSelfMap.values()]
            .filter((s) => s.stacks > 0 && !s.payload)
            .map((s) => ({
                buffName: s.buffName,
                turnsRemaining: 'recurring' as const,
                stacks: s.stacks,
            }));
        const enemyAccumSnap = [...accumEnemyMap.values()]
            .filter((s) => s.stacks > 0 && !s.payload)
            .map((s) => ({
                buffName: s.buffName,
                turnsRemaining: 'recurring' as const,
                stacks: s.stacks,
            }));

        // Timed scheduled statuses. Ability-sourced timed statuses (payload-carrying)
        // live in the same maps but are excluded here — the engine appends them via
        // timedAbilityStatuses after scheduled ones.
        return {
            activeSelfBuffs: [
                ...selfAlwaysSnap,
                ...selfAccumSnap,
                ...[...selfMap.values()]
                    .filter((s) => !s.payload)
                    .map((s) => ({
                        buffName: s.buffName,
                        turnsRemaining: s.turnsRemaining,
                    })),
            ],
            activeEnemyDebuffs: [
                ...enemyAlwaysSnap,
                ...enemyAccumSnap,
                ...[...enemyMap.values()]
                    .filter((s) => !s.payload)
                    .map((s) => ({
                        buffName: s.buffName,
                        turnsRemaining: s.turnsRemaining,
                    })),
            ],
        };
    };

    // Owner Post-Turn decrement: the status CARRIER decrements ALL its timed statuses
    // by one turn, INCLUDING ones applied earlier in this same turn (same-turn decrement
    // rule — skipping same-turn applications would ADD a round). Expired
    // statuses are removed and their stored buffName reported so the engine emits
    // buff-expired. Ability-sourced timed statuses live in the same map and decrement here.
    const decrementSide = (side: 'self' | 'enemy'): { expired: string[] } => {
        const map = side === 'self' ? selfMap : enemyMap;
        const expired: string[] = [];
        for (const [key, s] of map) {
            s.turnsRemaining -= 1;
            if (s.turnsRemaining <= 0) {
                expired.push(s.buffName);
                map.delete(key);
            }
        }
        return { expired };
    };

    // --- Ability-status API (Task 6) ---

    const registerAbilityStatuses = (statuses: RegisteredAbilityStatus[]): void => {
        // Registered AFTER scheduled entries so list-order parity is preserved.
        for (const s of statuses) {
            if (s.kind === 'accumulating') {
                const map = s.side === 'self' ? accumSelfMap : accumEnemyMap;
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
                });
            } else if (s.kind === 'aura') {
                (s.side === 'self' ? auraSelf : auraEnemy).push(s);
            }
            // timed statuses are applied lazily via applyTimedAbilityStatus when their
            // source slot fires and the application gate passes.
        }
    };

    const applyTimedAbilityStatus = (
        round: number,
        status: Extract<RegisteredAbilityStatus, { kind: 'timed' }>
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
        // status.duration is guaranteed numeric by the timed variant — no runtime guard needed.
        const map = status.side === 'self' ? selfMap : enemyMap;
        const { familyKey, tier } = deriveFamilyKey(status.payload.buffName);
        const existing = map.get(familyKey);
        if (existing && existing.tier > tier) return;
        map.set(familyKey, {
            buffName: status.payload.buffName,
            turnsRemaining: status.duration,
            tier,
            payload: status.payload,
        });
    };

    const activeAbilityStatuses = (
        side: 'self' | 'enemy',
        ctx: ConditionContext
    ): ActiveAbilityStatus[] => {
        const out: ActiveAbilityStatus[] = [];
        // Auras: effect included only when their (live-gated) conditions pass this round.
        for (const a of side === 'self' ? auraSelf : auraEnemy) {
            if (!conditionsMet(a.conditions, ctx)) continue;
            out.push({
                payload: a.payload,
                active: { buffName: a.payload.buffName, turnsRemaining: 'recurring' },
            });
        }
        // Accumulating ability statuses: included when stacks > 0 AND conditions pass.
        const accumMap = side === 'self' ? accumSelfMap : accumEnemyMap;
        for (const s of accumMap.values()) {
            if (!s.payload) continue;
            if (s.stacks <= 0) continue;
            if (s.conditions && !conditionsMet(s.conditions, ctx)) continue;
            out.push({
                payload: { ...s.payload, stacks: s.stacks },
                active: { buffName: s.buffName, turnsRemaining: 'recurring', stacks: s.stacks },
            });
        }
        return out;
    };

    const timedAbilityStatuses = (side: 'self' | 'enemy'): ActiveAbilityStatus[] => {
        const map = side === 'self' ? selfMap : enemyMap;
        const out: ActiveAbilityStatus[] = [];
        for (const s of map.values()) {
            if (!s.payload) continue;
            out.push({
                payload: s.payload,
                active: { buffName: s.buffName, turnsRemaining: s.turnsRemaining },
            });
        }
        return out;
    };

    return {
        beginRound,
        sourceFired,
        snapshot,
        decrementSide,
        registerAbilityStatuses,
        applyTimedAbilityStatus,
        activeAbilityStatuses,
        timedAbilityStatuses,
    };
}
