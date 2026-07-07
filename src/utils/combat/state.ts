import type { Position } from '../../types/encounters';
import type { AffinityName } from '../../types/ship';
import type { CombatEventBus } from './events';
import type { PreFightCombatModifiers } from './preFight/types';

/** Per-actor damage contributions within one round (spec: per-actor accounting —
 *  the simulator-page seam). secondary/conditional are sub-buckets of direct
 *  (mirroring rawTotals); corrosion/inferno/detonation are the enemy-turn channels
 *  attributed to the entry's applier. */
export interface ActorDamage {
    direct: number;
    secondary: number;
    conditional: number;
    corrosion: number;
    inferno: number;
    detonation: number;
    /** SP-E: absolute-per-tick generic DoT channel (Voron/Orel damage-transform, Acidic Decay
     *  family). Mirrors corrosion/inferno — an enemy-turn DoT-tick channel attributed to the
     *  entry's applier. */
    generic: number;
}

export function emptyActorDamage(): ActorDamage {
    return {
        direct: 0,
        secondary: 0,
        conditional: 0,
        corrosion: 0,
        inferno: 0,
        detonation: 0,
        generic: 0,
    };
}

/** Per-actor healing contributions within one round (healing-calc adoption; mirrors
 *  ActorDamage). effectiveHeal/overheal partition the TARGET-routed portion of
 *  directHeal+hotHeal; non-target recipients count raw only. */
export interface ActorHealing {
    directHeal: number;
    hotHeal: number;
    shield: number;
    cleanseCount: number;
    effectiveHeal: number;
    overheal: number;
}

export function emptyActorHealing(): ActorHealing {
    return {
        directHeal: 0,
        hotHeal: 0,
        shield: 0,
        cleanseCount: 0,
        effectiveHeal: 0,
        overheal: 0,
    };
}

/** One applied DoT application (an "entry"): N stacks of one tier, ticking down.
 *  `sourceId` is the applier (per-actor attribution — Task 4): inferno ticks resolve the
 *  applier's current-round effective attack/dotMult/affinityMult, and the damage attributes
 *  to that actor's per-round contributions (focus actor → row fields, others → teamDamage). */
export interface ActiveDoTStack {
    stacks: number;
    tier: number;
    remainingRounds: number;
    sourceId: string;
    /** SP-E generic DoT (Voron/Orel damage-transform): absolute damage per tick, independent
     *  of stats/HP. Set only on 'generic'-type entries; corrosion/inferno compute from stats. */
    perTickAmount?: number;
    /** SP-E: named DoT family for counting/display (e.g. 'Acidic Decay'). Undefined = plain type. */
    family?: string;
    /** SP-E: survives the Cheat-Death DoT-array wipe and any DoT cleanse (Acidic Decay). */
    unremovable?: boolean;
}

export interface PendingBomb {
    countdown: number;
    damagePerStack: number;
    stacks: number;
    tier: number;
    /** The applier (per-actor attribution — Task 4). */
    sourceId: string;
    /** Affinity multiplier snapshotted at application from the applier's affinity matchup,
     *  so the burst on detonation uses the APPLIER's affinity, not the focus actor's. */
    affinityMult: number;
    /** The applier's detonation-damage modifier (%), snapshotted at application like affinityMult.
     *  Scales the timed-expiry burst in processBombs and (later) skill detonation. Default 0. */
    detonationDamageModifier: number;
    /** The applier's bomb-splash-damage modifier (%), snapshotted at application like
     *  affinityMult/detonationDamageModifier. Scales splash-on-death. Default 0. */
    splashModifier: number;
}

// Echoing Burst-style debuff: gathers the direct damage dealt to the enemy each round it
// is active, then detonates for `pct`% of the accumulated total when it expires.
export interface PendingAccumulator {
    roundsRemaining: number;
    pct: number;
    accumulated: number;
    /** The applier (per-actor attribution — Task 4); the burst lands in this actor's
     *  detonation channel. The accumulation INPUT gathers all players' direct damage. */
    sourceId: string;
}

export interface ActorStats {
    attack: number;
    crit: number;
    critDamage: number;
    defensePenetration: number;
    /** Fraction of the target's shield pool bypassed before absorption (0–100 range,
     *  matches defensePenetration units). Read at the damage-apply site in later tasks.
     *  Static — no buff folding; defaults to 0 for all existing actors and fixtures. */
    shieldPenetration: number;
    defence: number;
    hp: number;
    speed: number;
    /** Live debuff-landing stat. Optional — undefined treated as 0. Buff-fold + dynamic landing land in A2. */
    hacking?: number;
    /** Live debuff-resist stat. Optional — undefined treated as 0 by effectiveStatsOf. Buff-fold + dynamic landing land in A2. */
    security?: number;
}

/**
 * A combat participant. Phase 1: exactly two actors — the attacker (acts every
 * turn) and the enemy dummy (speed 0, never acts; carries the DoT containers
 * that used to be loop-locals in runSinglePass). Phase 2 makes team ships and
 * the enemy real actors.
 */
export interface CombatActor {
    id: string;
    side: 'player' | 'enemy';
    /** Dispatch role in the Phase 2 turn loop. */
    kind: 'attacker' | 'team' | 'enemy';
    stats: ActorStats;
    /** Remaining HP. Phase 1: meaningful for the enemy only (pool − cumulative damage, floored at 0 for HP%-derivation; the sim keeps hitting the dead dummy). */
    currentHp: number;
    /** Absorption pool (healing mode): additive, capped at max HP, drains before HP. */
    shieldPool: number;
    turnMeter: number;
    /** Banked charges toward this actor's charged skill (attacker + team). */
    charges: number;
    /** Charges required to fire this actor's charged skill; 0 = no charged skill. */
    chargeCount: number;
    corrosionEntries: ActiveDoTStack[];
    infernoEntries: ActiveDoTStack[];
    /** SP-E: generic (absolute per-tick) DoT entries — Voron/Orel transform, Acidic Decay family. */
    genericDoTEntries: ActiveDoTStack[];
    pendingBombs: PendingBomb[];
    pendingAccumulators: PendingAccumulator[];
    /** Round this actor first reached 0 HP (set once via recordDestroyed). Undefined while alive. */
    destroyedRound?: number;
    /** True for the DPS dummy sink: drains currentHp like any actor but the death /
     *  combat-end path skips it (never recordDestroyed, never ends combat). Inert
     *  plumbing here — first read by the death path in a later PR (bySide unification). */
    indestructible?: boolean;
    /** Board position of this actor (positional plumbing — set at construction, not yet consumed). */
    position?: Position;
    /** Attacker ignores Taunt/Provoke forced targeting (not Concentrate Fire). Positional
     *  plumbing — set at construction, consumed by resolvePositionalTarget. */
    ignoresForcedTargeting?: boolean;
    /** Attacker's direct hits do NOT break Stasis (Akula / Tygr). Gated at the break-mark
     *  site in engine.ts (§4.5 Akula exception) — if true, the victim is never recorded into
     *  turnStasisHitVictims and stasisBreakPending is never set. */
    doesntBreakStasis?: boolean;
    /** RAW affinity of this actor (positional plumbing — set at construction, not yet consumed
     *  by apply). The positional damage calculator's `defenseProfileOf(victim)` will read this
     *  for per-victim affinity re-resolution (Task 8b/9). Absent → treated as neutral downstream. */
    affinity?: AffinityName;
    // Unlike the optional plumbing flags above (indestructible/doesntBreakStasis/affinity/…),
    // the next two always carry a defined value: createActor seeds them on every actor, so they
    // are required (non-optional) by design — no `X ?? default` reads needed at consume sites.
    /** Per-actor own-turn counter. Starts at 0; incremented at the actor's turn-start
     *  (engine.ts turn-started emit). Drives the `every-n-turns` condition (Chrono Reaver). */
    turnsTaken: number;
    /** When true, enemy-sourced charge removal is a no-op against this actor
     *  ("immune to charge loss effects"). Derived from ship skill text. */
    chargeLossImmune: boolean;
    /** Pre-fight combat-modifier baseline (sub-project F, PR F3): squad-leader modifier
     *  channels accumulated BEFORE combat (additive pct points). Hidden, permanent,
     *  non-purgeable — deliberately NOT statuses (they would leak into logs/purge/cleanse).
     *  Consumed via `?? 0` folds at the exact sites the regular buff channels are read;
     *  absent on every existing caller (DPS/healing sims, fixtures) → all folds inert. */
    preFight?: PreFightCombatModifiers;
}

export function createActor(
    partial: Pick<CombatActor, 'id' | 'side' | 'kind'> & {
        stats: ActorStats;
        chargeCount?: number;
        startCharged?: boolean;
        position?: Position;
        ignoresForcedTargeting?: boolean;
        doesntBreakStasis?: boolean;
        affinity?: AffinityName;
        indestructible?: boolean;
        chargeLossImmune?: boolean;
        preFight?: PreFightCombatModifiers;
    }
): CombatActor {
    // startCharged is a one-shot initialiser (it seeds `charges`), deliberately NOT
    // stored on the actor — banked charges are the only mutable charge state.
    const { chargeCount = 0, startCharged = false, ...rest } = partial;
    return {
        ...rest,
        currentHp: partial.stats.hp,
        // Pre-fight shield seeding (F3): "Start combat shielded for N% of max HP" — hp is
        // already post-leader (the pre-fight stat pass mutated plan stats before actor
        // construction). Absent preFight → 0 → byte-identical to the old literal 0.
        shieldPool: partial.stats.hp * ((partial.preFight?.startingShieldPctOfHp ?? 0) / 100),
        turnMeter: 0,
        charges: startCharged ? chargeCount : 0,
        chargeCount,
        corrosionEntries: [],
        infernoEntries: [],
        genericDoTEntries: [],
        pendingBombs: [],
        pendingAccumulators: [],
        position: partial.position,
        ignoresForcedTargeting: partial.ignoresForcedTargeting,
        doesntBreakStasis: partial.doesntBreakStasis,
        affinity: partial.affinity,
        indestructible: partial.indestructible,
        turnsTaken: 0,
        chargeLossImmune: partial.chargeLossImmune ?? false,
        preFight: partial.preFight,
    };
}

/** Record an actor's destruction exactly once: stamp `destroyedRound` (first call wins)
 *  and emit a single `ship-destroyed` for it. Idempotent — repeat calls are no-ops, so
 *  the "set once" guard doubles as the single-emit guard. Callers floor `currentHp` to 0
 *  themselves; this helper only owns the destroyed-round bookkeeping + the emission. */
export function recordDestroyed(
    actor: CombatActor,
    round: number,
    bus: CombatEventBus,
    killerId?: string,
    byDirectDamage?: boolean
): void {
    if (actor.destroyedRound !== undefined) return;
    actor.destroyedRound = round;
    bus.emit({ type: 'ship-destroyed', actorId: actor.id, round, killerId, byDirectDamage });
}

/** Turn meter an actor must reach to act (docs/combat-system.md section 1). */
export const TURN_METER_THRESHOLD = 1000;

/** Safety cap on selection iterations — converts a non-terminating selection into a
 *  debuggable error. Used both by `selectNextActor` (all-zero-speed hang) and by the
 *  engine round loop's `selectNextBySpeed` pool drain (runaway pending actions). */
export const MAX_SELECTION_TICKS = 10000;

/**
 * Turn-meter selection per docs/combat-system.md section 1: tick every actor's
 * meter by its speed until someone reaches TURN_METER_THRESHOLD; highest meter
 * acts. Phase 1 degenerates to "attacker acts every round" (enemy speed 0) — the
 * scaffolding exists so Phase 2 only has to add actors, not restructure the loop.
 *
 * Callers must include at least one actor with speed > 0; otherwise no actor's
 * meter ever advances. The MAX_SELECTION_TICKS cap converts that all-zero-speed
 * hang into a debuggable error rather than an infinite loop.
 *
 * Reserved for future turn-meter manipulation phases; the engine round loop uses
 * `selectNextBySpeed` (order-only, dynamic effective speed) instead.
 */
export function selectNextActor(actors: CombatActor[]): CombatActor {
    if (actors.length === 0) {
        throw new Error('selectNextActor: actors must not be empty');
    }
    const eligible = () => actors.filter((a) => a.turnMeter >= TURN_METER_THRESHOLD);
    let ticks = 0;
    while (eligible().length === 0) {
        if (++ticks > MAX_SELECTION_TICKS) {
            throw new Error(
                `selectNextActor: no actor reached the turn meter after ${MAX_SELECTION_TICKS} ticks — ` +
                    'at least one actor must have speed > 0.'
            );
        }
        for (const a of actors) a.turnMeter += a.stats.speed;
    }
    return eligible().reduce((best, a) => (a.turnMeter > best.turnMeter ? a : best));
}

/**
 * Phase 2 turn order: each game round every living actor acts exactly once,
 * sorted by speed DESC. Tiebreak (game rule unknown — documented assumption):
 * player side before enemy, then input order. With the calculator's input order
 * (team 1..4, attacker, enemy) equal speeds yield team → attacker → enemy —
 * buffers act before the attacker. NOTE: within the player side the tiebreak is
 * purely input order — the CALLER must list team actors before the attacker to
 * get the team-before-attacker default. Speed affects ORDER, not frequency
 * (spec: "once per round, speed = order"); extra-turn effects are a later-phase seam.
 */
export function buildTurnQueue(actors: CombatActor[]): CombatActor[] {
    return orderByTurnPriority(
        actors.map((a) => ({ actor: a, speed: a.stats.speed, side: a.side }))
    ).map((w) => w.actor);
}

/**
 * Turn-order comparator core, shared by the engine (buildTurnQueue) and UI displays.
 * Speed DESC; player side before enemy; then input order (caller lists team actors
 * before the attacker for the team-first default). Returns a new array; does not
 * mutate the input.
 */
export function orderByTurnPriority<T extends { speed: number; side: 'player' | 'enemy' }>(
    items: T[]
): T[] {
    return [...items]
        .map((item, i) => ({ item, i }))
        .sort((x, y) => {
            if (y.item.speed !== x.item.speed) return y.item.speed - x.item.speed;
            const sideRank = (s: { side: 'player' | 'enemy' }) => (s.side === 'player' ? 0 : 1);
            if (sideRank(x.item) !== sideRank(y.item)) return sideRank(x.item) - sideRank(y.item);
            return x.i - y.i;
        })
        .map((x) => x.item);
}

/**
 * Pick the next actor to act by CURRENT effective speed (dynamic-speed turn order, Task 2).
 *
 * Side-agnostic and pure: among `actors` with `pendingOf(id) > 0`, returns the one with the
 * highest effective speed (per the `effectiveSpeedOf` callback), tiebroken by side (player
 * before enemy) then input order; returns `undefined` when none have pending > 0.
 *
 * `actors` MUST be supplied in canonical input order (team 1..4, attacker, enemy) — the
 * input-order tiebreak in `orderByTurnPriority` relies on this. Filtering is stable so input
 * order is preserved into the comparator.
 *
 * Effective speed is read live via the callback (NOT `actor.stats.speed`), so a Speed Up/Down
 * applied mid-combat changes the ordering. This helper is UNWIRED in Task 2 — Task 3 calls it.
 */
export function selectNextBySpeed(
    actors: CombatActor[],
    pendingOf: (id: string) => number,
    effectiveSpeedOf: (actor: CombatActor) => number
): CombatActor | undefined {
    const ranked = orderByTurnPriority(
        actors
            .filter((a) => pendingOf(a.id) > 0)
            .map((actor) => ({ actor, speed: effectiveSpeedOf(actor), side: actor.side }))
    );
    return ranked[0]?.actor;
}

/**
 * Advance an actor's charge bank by one turn: fire+reset at cap, else +1.
 * No-op when `hasChargedSkill` is false or the actor's chargeCount is 0 (belt-and-suspenders).
 *
 * Each call site supplies its OWN guard boolean so the helper unifies the
 * arithmetic without changing any site's existing activation semantics:
 *   - playerTurn preTurn:  pass `hasChargedSkill`
 *   - engine team branch:  pass `teamHasCharged` (= actor.chargeCount > 0)
 *   - engine dead-target:  pass `hasChargedSkill` (the redundant `&& chargeCount>0`
 *                          is absorbed by the internal guard below)
 *
 * `bus` and `round` are optional — when provided the function emits a `charge-changed`
 * event (reason: 'cast-reset' on cap-fire, 'gen' on +1 increment). Call sites that
 * have a bus and round in scope should always pass them.
 */
export function advanceChargeCadence(
    actor: CombatActor,
    hasChargedSkill: boolean,
    bus?: CombatEventBus,
    round?: number
): void {
    if (!hasChargedSkill || actor.chargeCount <= 0) return;
    const oldCharge = actor.charges;
    if (actor.charges >= actor.chargeCount) {
        actor.charges = 0;
        if (bus && round !== undefined) {
            bus.emit({
                type: 'charge-changed',
                actorId: actor.id,
                round,
                oldCharge,
                newCharge: actor.charges,
                reason: 'cast-reset',
            });
        }
    } else {
        actor.charges += 1;
        if (bus && round !== undefined) {
            bus.emit({
                type: 'charge-changed',
                actorId: actor.id,
                round,
                oldCharge,
                newCharge: actor.charges,
                reason: 'gen',
            });
        }
    }
}
