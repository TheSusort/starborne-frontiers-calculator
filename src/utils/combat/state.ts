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
    stats: ActorStats;
    /** Remaining HP. Phase 1: meaningful for the enemy only (pool − cumulative damage, floored at 0 for HP%-derivation; the sim keeps hitting the dead dummy). */
    currentHp: number;
    turnMeter: number;
    corrosionEntries: ActiveDoTStack[];
    infernoEntries: ActiveDoTStack[];
    pendingBombs: PendingBomb[];
    pendingAccumulators: PendingAccumulator[];
}

export function createActor(
    partial: Pick<CombatActor, 'id' | 'side'> & { stats: ActorStats }
): CombatActor {
    return {
        ...partial,
        currentHp: partial.stats.hp,
        turnMeter: 0,
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
