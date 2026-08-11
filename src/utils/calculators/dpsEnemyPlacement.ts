import type { Position } from '../../types/encounters';
import type { ParsedTarget, ParsedPattern } from '../targetingParser';

/**
 * Default board slots for the DPS calculator's positional run.
 *
 * Column 4 is the FRONT of the board. Both sides default to the middle-front slot so a 1v1 DPS
 * run has no adjacency and patterns collapse to single-target — the closest positional equivalent
 * of the scalar opponent this replaces.
 *
 * Positions are required, not cosmetic: `isPositional` (positionalBinding.ts) needs BOTH the acting
 * actor and an opposing actor to carry one, otherwise `selectTurnTarget` falls back to the
 * vestigial dummy and the focus never damages the real enemy.
 */
export const DEFAULT_ATTACKER_SLOT: Position = 'M4';
export const DEFAULT_ENEMY_SLOT: Position = 'M4';

/**
 * Fallback targeting for a positional DPS run.
 *
 * Position alone does NOT route a cast. `selectTurnTarget` requires
 * `isPositional(actor.position, opposingRoster) && target` — with no ParsedTarget it
 * short-circuits to `legacyVictim` (the dummy), however well-positioned the roster is. The same
 * missing target also keeps the dummy in the turn order, because `dummyEnemyIsVestigial` checks
 * `t?.side === 'enemy'`.
 *
 * `side: 'enemy'` is relative to the acting actor ("the side opposing me"), so this same value is
 * correct for the focus attacker AND for an enemy attacker targeting the player.
 */
export const DEFAULT_FRONT_ENEMY_TARGET: ParsedTarget = {
    raw: 'front enemy',
    side: 'enemy',
    selection: 'front',
};

/**
 * Fallback single-target footprint for a positional DPS run.
 *
 * ALSO load-bearing, not cosmetic. The positional apply gate is
 * `isPositional(...) && target != null && pattern != null && turn.positionalScalars != null`
 * (engine.ts:8344). With a target but no pattern the cast still RESOLVES onto the real enemy and
 * still credits `cumulativeDamage` via the legacy sink — but it never runs the per-victim apply, so
 * `creditDealt` never fires and `RoundData.perTargetDealt` comes back empty. That failure is silent:
 * damage looks right while the per-victim accounting the metric depends on is missing.
 */
/** `range` MUST be 0, not 1: `patternSignature` builds `"base|0|"`, whose offset table is
 *  `[ORIGIN]` — the anchor cell alone. `"base|1|"` has no table and `resolveCells` throws. */
export const DEFAULT_BASE_PATTERN: ParsedPattern = {
    raw: 'single target',
    shape: 'base',
    range: 0,
    modifiers: {},
};

/**
 * Default slot for the Nth team ship, walking BACK from the front along the middle row and then
 * spilling to the other rows — so team ships never start stacked on `DEFAULT_ATTACKER_SLOT`.
 *
 * Note attacker CONFIGS cannot collide with each other: each config is simulated in its OWN run
 * (they are alternatives being compared, not squadmates), so only a config-vs-team-ship overlap
 * puts two actors on one slot in a single simulation.
 */
export function defaultTeamSlot(index: number): Position {
    const order: readonly Position[] = ['M3', 'M2', 'M1', 'T4', 'T3', 'T2', 'T1', 'B4', 'B3', 'B2'];
    return order[index % order.length];
}

/** Every slot a player-side ship (attacker config or team ship) may occupy. */
export const ATTACKER_SLOT_OPTIONS: readonly Position[] = [
    'T1',
    'T2',
    'T3',
    'T4',
    'M1',
    'M2',
    'M3',
    'M4',
    'B1',
    'B2',
    'B3',
    'B4',
] as const;

/**
 * Resolve a player-side roster so no two ships share a cell.
 *
 * Load-bearing, not tidiness: `resolvePositionalTarget` and `footprintVictims` both index actors
 * into a `Map<Position, CombatActor>` (positionalBinding.ts, positionalApply.ts) and the enemy's
 * bindings receive `[attacker, ...teamActors]`. On a collision the LATER entry wins, so a team ship
 * sharing the attacker's slot silently ERASES the attacker from that cell — the enemy stops
 * targeting it and area damage skips it.
 *
 * `slots[0]` is the attacker and keeps its slot; each later ship that collides is pushed to the
 * first free slot in `ATTACKER_SLOT_OPTIONS` order. Returns a same-length array.
 */
export function resolvePlayerSlots(slots: ReadonlyArray<Position>): Position[] {
    const taken = new Set<Position>();
    return slots.map((wanted) => {
        if (!taken.has(wanted)) {
            taken.add(wanted);
            return wanted;
        }
        const free = ATTACKER_SLOT_OPTIONS.find((p) => !taken.has(p));
        // 12 slots vs at most 5 player ships (1 attacker + 4 team), so `free` always exists; the
        // fallback keeps the return type honest rather than asserting.
        const resolved = free ?? wanted;
        taken.add(resolved);
        return resolved;
    });
}
