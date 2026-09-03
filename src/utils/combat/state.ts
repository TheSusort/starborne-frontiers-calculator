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
    /** Absolute-per-tick generic DoT channel (Voron/Orel damage-transform, Acidic Decay
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
 *  `sourceId` is the applier (per-actor attribution): inferno ticks resolve the
 *  applier's current-round effective attack/dotMult/affinityMult, and the damage attributes
 *  to that actor's per-round contributions (focus actor → row fields, others → teamDamage) —
 *  unless the entry carries `dealtCreditId`, which splits the display attribution off the
 *  applier. See its doc below. */
export interface ActiveDoTStack {
    stacks: number;
    tier: number;
    remainingRounds: number;
    sourceId: string;
    /** Generic DoT (Voron/Orel damage-transform): absolute damage per tick, independent
     *  of stats/HP. Set only on 'generic'-type entries; corrosion/inferno compute from stats. */
    perTickAmount?: number;
    /**
     * #358 ADDENDUM 3 (C4): the PRE-mitigation twin of `perTickAmount`, carried so a re-booked
     * transform slice lands on the "damage absorbed" axis at the size it was THROWN.
     *
     * THE COLLAPSE THIS FIXES. `convertHitToSelfDot` (Voron/Orel, Hit Mitigation) reverses BOTH
     * intake axes in lockstep when it defers a hit — `-damage` off `.incoming` and `-damageRaw`
     * off `.incomingRaw`. The ticks that re-book the deferred slice then ran `byDirectDamage:
     * false` with no pre-mitigation figure, so the funnel booked the POST-mitigation
     * `perTickAmount` on BOTH axes. Net effect: the slice migrated permanently onto the post axis
     * and the raw axis lost the difference — a Voron defender at 5,000 defence reported 24,993
     * where a plain defender reported 100,000. A purely DEFENSIVE ability quartered the headline
     * and re-inverted the ranking.
     *
     * Absent on corrosion/inferno entries and on any generic DoT that folded no defence — those
     * tick identically on both axes, which is what `?? perTickAmount` downstream means.
     */
    perTickPreMitigation?: number;
    /**
     * DISPLAY attribution, when it differs from `sourceId`. `sourceId` is the MECHANICS axis —
     * whose leech/proc basis the tick feeds — and for a `convertHitToSelfDot` entry it is the
     * VICTIM, because a hit the victim converted is not the attacker's "damage dealt". The
     * attacker still dealt the damage that became this DoT, so the per-victim credit channel
     * (`perTargetDealt`) and the focus's own generic channel book under this id instead.
     *
     * Absent on every DoT whose applier and dealer are the same actor (corrosion, inferno, any
     * applied generic), where every reader falls back to `sourceId`.
     */
    dealtCreditId?: string;
    /** Named DoT family for counting/display (e.g. 'Acidic Decay'). Undefined = plain type. */
    family?: string;
    /** Survives the Cheat-Death DoT-array wipe and any DoT cleanse (Acidic Decay). */
    unremovable?: boolean;
}

export interface PendingBomb {
    countdown: number;
    damagePerStack: number;
    stacks: number;
    tier: number;
    /** The applier (per-actor attribution). */
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
    /** The applier (per-actor attribution); the burst lands in this actor's
     *  detonation channel. The accumulation INPUT gathers all players' direct damage. */
    sourceId: string;
}

export interface ActorStats {
    attack: number;
    crit: number;
    critDamage: number;
    defensePenetration: number;
    /** Fraction of the target's shield pool bypassed before absorption (0–100 range,
     *  matches defensePenetration units). Read at the damage-apply site as `shieldAbsorb`'s
     *  `penPct`, on DIRECT hits only. Static — no buff folding; defaults to 0. */
    shieldPenetration: number;
    defence: number;
    hp: number;
    speed: number;
    /** Live debuff-landing stat. Optional — undefined treated as 0 by effectiveStatsOf;
     *  `liveDebuffLandingChance` defaults a missing base to 200 instead. */
    hacking?: number;
    /** Live debuff-resist stat. Optional — undefined treated as 0 by effectiveStatsOf;
     *  `liveDebuffLandingChance` defaults a missing base to 100 instead. */
    security?: number;
}

/**
 * A combat participant. Team ships and enemy attackers are real actors alongside the focus
 * attacker; each carries its own DoT containers.
 */
export interface CombatActor {
    id: string;
    side: 'player' | 'enemy';
    /** Dispatch role in the turn loop. */
    kind: 'attacker' | 'team' | 'enemy';
    stats: ActorStats;
    /** Remaining HP (pool − cumulative damage, floored at 0 for HP%-derivation). */
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
    /** Generic (absolute per-tick) DoT entries — Voron/Orel transform, Acidic Decay family. */
    genericDoTEntries: ActiveDoTStack[];
    pendingBombs: PendingBomb[];
    pendingAccumulators: PendingAccumulator[];
    /** Round this actor first reached 0 HP (set once via recordDestroyed). Undefined while alive. */
    destroyedRound?: number;
    /** Board position of this actor — set at construction and consumed by the positional path:
     *  `isPositional` gates on it and `resolvePositionalTarget` reads it as the acting anchor. */
    position?: Position;
    /** Attacker ignores Taunt/Provoke forced targeting (not Concentrate Fire). Positional
     *  plumbing — set at construction, consumed by resolvePositionalTarget. ORed at the
     *  engine.ts read sites with the timed `Rogue's Liberty` buff (rogueLiberty.ts), so this
     *  field alone is not the resolver's effective input. */
    ignoresForcedTargeting?: boolean;
    /** Attacker ignores the Stealth targeting filter on ALL its casts (Lodolite's "ignores
     *  Stealth effects" passive). Positional plumbing — set at construction, consumed by
     *  resolvePositionalTarget via acting.ignoresStealth. */
    ignoresStealth?: boolean;
    /** Attacker's direct hits do NOT break Stasis (Akula / Tygr). Gated at the break-mark
     *  site in engine.ts (§4.5 Akula exception) — if true, the victim is never recorded into
     *  turnStasisHitVictims and stasisBreakPending is never set. */
    doesntBreakStasis?: boolean;
    /** RAW affinity of this actor, set at construction. The positional damage calculator's
     *  `defenseProfileOf(victim)` reads it for per-victim affinity re-resolution.
     *  Absent → treated as neutral downstream. */
    affinity?: AffinityName;
    // Unlike the optional plumbing flags above (doesntBreakStasis/affinity/…),
    // the next two always carry a defined value: createActor seeds them on every actor, so they
    // are required (non-optional) by design — no `X ?? default` reads needed at consume sites.
    /** Per-actor own-turn counter. Starts at 0; incremented at the actor's turn-start
     *  (engine.ts turn-started emit). Drives the `every-n-turns` condition (Chrono Reaver). */
    turnsTaken: number;
    /** When true, enemy-sourced charge removal is a no-op against this actor
     *  ("immune to charge loss effects"). Derived from ship skill text. */
    chargeLossImmune: boolean;
    /** Pre-fight combat-modifier baseline: squad-leader modifier
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
        ignoresStealth?: boolean;
        doesntBreakStasis?: boolean;
        affinity?: AffinityName;
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
        // Pre-fight shield seeding: "Start combat shielded for N% of max HP" — hp is
        // already post-leader (the pre-fight stat pass mutated plan stats before actor
        // construction). Absent preFight → 0.
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
        ignoresStealth: partial.ignoresStealth,
        doesntBreakStasis: partial.doesntBreakStasis,
        affinity: partial.affinity,
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
 * acts. With a single speed > 0 actor it degenerates to "that actor acts every round".
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
 * Turn order: each game round every living actor acts exactly once,
 * sorted by speed DESC, then by the game's tiebreak chain — board position, then side
 * (see `orderByTurnPriority`). Input order is only consulted between two actors equal on all
 * three, i.e. two position-less actors on the same side (DPS/healing-mode fixtures), where the
 * caller's canonical order (team 1..4, attacker, enemy) still yields team → attacker → enemy.
 * Speed affects ORDER, not frequency (spec: "once per round, speed = order"); extra-turn effects
 * are a later-phase seam.
 */
export function buildTurnQueue(actors: CombatActor[]): CombatActor[] {
    return orderByTurnPriority(
        actors.map((a) => ({ actor: a, speed: a.stats.speed, side: a.side, position: a.position }))
    ).map((w) => w.actor);
}

/**
 * Board-position turn priority (LOWER acts first) — the game's speed tiebreak.
 *
 * In-game rule: "furthest to the top back wins" — the whole TOP row outranks the whole MID row,
 * MID outranks BOTTOM, and within one row the lowest column number wins (columns run 1 = back to
 * 4 = front, so column 1 is the backmost cell). Two actors on the SAME side can never share a
 * position, so this fully decides every intra-team tie; a cross-team tie (both sides hold the
 * mirrored cell) falls through to the side rank below.
 *
 * A position-less actor (a bare enemy attacker in DPS/healing mode) ranks LAST, so it never
 * displaces a positioned actor. When NO actor in a tie group has a position the ranks are all
 * equal and ordering falls through to side + input order.
 */
export function positionTurnRank(position?: Position): number {
    if (!position) return Number.POSITIVE_INFINITY;
    const rowRank = position[0] === 'T' ? 0 : position[0] === 'M' ? 1 : 2;
    return rowRank * 10 + Number(position.slice(1));
}

/**
 * Turn-order comparator core, shared by the engine (buildTurnQueue) and UI displays.
 *
 * Speed DESC → board position (`positionTurnRank`) → player side before enemy → input order.
 * Speed and position are the game's own rules; side is the documented last-resort assumption for
 * a genuine cross-team position tie, and input order only ever decides between two actors that
 * are equal on all three (which today means two position-less actors on the same side).
 *
 * Returns a new array; does not mutate the input.
 */
export function orderByTurnPriority<
    T extends { speed: number; side: 'player' | 'enemy'; position?: Position },
>(items: T[]): T[] {
    return [...items]
        .map((item, i) => ({ item, i }))
        .sort((x, y) => {
            if (y.item.speed !== x.item.speed) return y.item.speed - x.item.speed;
            const px = positionTurnRank(x.item.position);
            const py = positionTurnRank(y.item.position);
            if (px !== py) return px - py;
            const sideRank = (s: { side: 'player' | 'enemy' }) => (s.side === 'player' ? 0 : 1);
            if (sideRank(x.item) !== sideRank(y.item)) return sideRank(x.item) - sideRank(y.item);
            return x.i - y.i;
        })
        .map((x) => x.item);
}

/**
 * Pick the next actor to act by CURRENT effective speed (dynamic-speed turn order).
 *
 * Side-agnostic and pure: among `actors` with `pendingOf(id) > 0`, returns the one with the
 * highest effective speed (per the `effectiveSpeedOf` callback), tiebroken by board position then
 * side then input order (`orderByTurnPriority`); returns `undefined` when none have pending > 0.
 *
 * `actors` MUST be supplied in canonical input order (team 1..4, attacker, enemy) — the
 * input-order tiebreak in `orderByTurnPriority` relies on this for position-less actors.
 * Filtering is stable so input order is preserved into the comparator.
 *
 * Effective speed is read live via the callback (NOT `actor.stats.speed`), so a Speed Up/Down
 * applied mid-combat changes the ordering. The engine's round loop drives every turn through it.
 */
export function selectNextBySpeed(
    actors: CombatActor[],
    pendingOf: (id: string) => number,
    effectiveSpeedOf: (actor: CombatActor) => number
): CombatActor | undefined {
    const ranked = orderByTurnPriority(
        actors
            .filter((a) => pendingOf(a.id) > 0)
            .map((actor) => ({
                actor,
                speed: effectiveSpeedOf(actor),
                side: actor.side,
                position: actor.position,
            }))
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
