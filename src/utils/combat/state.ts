/** One applied DoT application (an "entry"): N stacks of one tier, ticking down. */
export interface ActiveDoTStack {
    stacks: number;
    tier: number;
    remainingRounds: number;
}

export interface PendingBomb {
    countdown: number;
    damagePerStack: number;
    stacks: number;
    tier: number;
}

// Echoing Burst-style debuff: gathers the direct damage dealt to the enemy each round it
// is active, then detonates for `pct`% of the accumulated total when it expires.
export interface PendingAccumulator {
    roundsRemaining: number;
    pct: number;
    accumulated: number;
}

export interface ActorStats {
    attack: number;
    crit: number;
    critDamage: number;
    defensePenetration: number;
    defence: number;
    hp: number;
    speed: number;
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
    turnMeter: number;
    /** Banked charges toward this actor's charged skill (attacker + team). */
    charges: number;
    /** Charges required to fire this actor's charged skill; 0 = no charged skill. */
    chargeCount: number;
    corrosionEntries: ActiveDoTStack[];
    infernoEntries: ActiveDoTStack[];
    pendingBombs: PendingBomb[];
    pendingAccumulators: PendingAccumulator[];
}

export function createActor(
    partial: Pick<CombatActor, 'id' | 'side' | 'kind'> & {
        stats: ActorStats;
        chargeCount?: number;
        startCharged?: boolean;
    }
): CombatActor {
    // startCharged is a one-shot initialiser (it seeds `charges`), deliberately NOT
    // stored on the actor — banked charges are the only mutable charge state.
    const { chargeCount = 0, startCharged = false, ...rest } = partial;
    return {
        ...rest,
        currentHp: partial.stats.hp,
        turnMeter: 0,
        charges: startCharged ? chargeCount : 0,
        chargeCount,
        corrosionEntries: [],
        infernoEntries: [],
        pendingBombs: [],
        pendingAccumulators: [],
    };
}

/** Turn meter an actor must reach to act (docs/combat-system.md section 1). */
export const TURN_METER_THRESHOLD = 1000;

/** Safety cap on selection ticks — converts an all-zero-speed hang into an error. */
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
 * Reserved for future turn-meter manipulation phases; the Phase 2 round loop
 * uses buildTurnQueue instead.
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
    return [...actors]
        .map((a, i) => ({ a, i }))
        .sort((x, y) => {
            if (y.a.stats.speed !== x.a.stats.speed) return y.a.stats.speed - x.a.stats.speed;
            const sideRank = (s: CombatActor) => (s.side === 'player' ? 0 : 1);
            if (sideRank(x.a) !== sideRank(y.a)) return sideRank(x.a) - sideRank(y.a);
            return x.i - y.i;
        })
        .map((x) => x.a);
}
