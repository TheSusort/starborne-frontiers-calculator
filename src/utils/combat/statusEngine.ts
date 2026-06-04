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
}

/** Effect payload of an ability-sourced status, folded into the round totals by the engine. */
export interface AbilityStatusPayload {
    buffName: string;
    stacks: number;
    parsedEffects: ParsedBuffEffects;
    application?: 'inflict' | 'apply';
}

/**
 * A buff/debuff ability registered with the status engine for in-loop application.
 * `kind` classifies how it is gated and scheduled:
 *  - accumulating: registered into the accumulating maps; stacks accumulate per
 *    trigger (never gated); effect inclusion is aura-gated per round.
 *  - aura: recurring/passive; effect inclusion is gated per round against the round ctx.
 *  - timed: finite duration; gated AT APPLICATION when the source slot fires, then runs
 *    its full window unconditionally (familyKey/tier upsert shared with scheduled statuses).
 */
export interface RegisteredAbilityStatus {
    payload: AbilityStatusPayload;
    side: 'self' | 'enemy';
    sourceSlot: SkillSlot;
    duration: number | 'recurring' | undefined;
    /** Already live-gated by the caller (see abilityStatusGating.liveGateConditions). */
    conditions: Condition[];
    kind: 'accumulating' | 'aura' | 'timed';
    maxStacks?: number;
    stackTrigger?: StackTrigger;
}

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
     *  stacks when sourceId === 'attacker'. */
    sourceFired(sourceId: string, slot: 'active' | 'charge', round: number): void;
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
     *  only those whose application gate passed. Reuses the familyKey/tier upsert. */
    applyTimedAbilityStatus(round: number, status: RegisteredAbilityStatus): void;
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

    // Categorized collections — kept as named closure variables (not inlined) so
    // Task 6 can append ability-sourced statuses to them later.
    const alwaysSelf = selfBuffs.filter((b) => !isAccumulating(b) && isAlwaysActive(b));
    const timedSelf = selfBuffs.filter((b) => !isAccumulating(b) && !isAlwaysActive(b));
    const accumSelf = selfBuffs.filter(isAccumulating);
    const alwaysEnemy = enemyDebuffs.filter((b) => !isAccumulating(b) && isAlwaysActive(b));
    const timedEnemy = enemyDebuffs.filter((b) => !isAccumulating(b) && !isAlwaysActive(b));
    const accumEnemy = enemyDebuffs.filter(isAccumulating);

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
    const auraSelf: RegisteredAbilityStatus[] = [];
    const auraEnemy: RegisteredAbilityStatus[] = [];

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

    // sourceFired: a source actually fired a slot this round. For 'attacker' this
    // increments per-active/per-charge accumulating stacks (BEFORE the timed upserts,
    // preserving the old step() ordering) and upserts timed scheduled buffs whose
    // skillSource matches the fired slot.
    //
    // LEGACY RULE: in this task ALL scheduled buffs (merged manual + team arrays)
    // ride the ATTACKER's real cadence. Per-buff sourceChargeCount/sourceStartCharged
    // are IGNORED — superseded by real team turns in the teamActors task. Other
    // sourceIds are a no-op for now (team actors arrive next).
    const sourceFired = (sourceId: string, slot: 'active' | 'charge', round: number): void => {
        if (round !== lastRound) {
            throw new Error(
                `StatusEngine.sourceFired called for round ${round}, but the engine is at round ${lastRound}`
            );
        }
        if (sourceId !== 'attacker') return;

        // Per-active/per-charge accumulating stacks tick on the matching slot.
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

        // Timed scheduled buffs whose skillSource matches the fired slot. Both self
        // and enemy ride the attacker's cadence (legacy rule above).
        for (const buff of timedSelf) {
            if (buff.skillSource === slot) upsertBuff(buff, selfMap);
        }
        for (const buff of timedEnemy) {
            if (buff.skillSource === slot) upsertBuff(buff, enemyMap);
        }
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
                map.set(s.payload.buffName, {
                    buffName: s.payload.buffName,
                    stacks: 0,
                    maxStacks: s.maxStacks,
                    rate: s.payload.stacks,
                    trigger: s.stackTrigger!,
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

    const applyTimedAbilityStatus = (round: number, status: RegisteredAbilityStatus): void => {
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
        if (typeof status.duration !== 'number') return;
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
