import type { Position } from '../../types/encounters';
import type { ParsedTarget, ParsedPattern } from '../targetingParser';

/**
 * Default board slots for the DPS calculator's positional run.
 *
 * Column 4 is the FRONT of the board. Both sides default to the middle-front slot so a 1v1 DPS
 * run has no adjacency and patterns collapse to single-target — the closest positional equivalent
 * of the scalar opponent this replaces.
 *
 * Positions are load-bearing, not cosmetic: `resolvesPositionalVictim` (positionalBinding.ts) needs
 * the acting actor to carry one AND the opposing roster to hold a targetable member (placed, max
 * hp > 0), or `selectTurnTarget` resolves NO victim and the focus damages nobody — it runs a
 * no-victim turn (the same rule on both sides since SP-4e/#335; before SP-4c-2b/2d the player side
 * fell back to the vestigial dummy, which is deleted, and the enemy side to the heal anchor).
 *
 * Since SP-4b-1 these are also the values `normalizeCombatRoster` — the engine's ONE accommodation
 * boundary, `runCombat`'s first line — auto-places with, so a CALLER no longer has to supply a
 * position for the fallback to be avoided. They stay exported because the PAGES still resolve their
 * own slots for the UI — `DPSCalculatorPage` calls `resolvePlayerSlots` itself and the slot
 * dropdowns (`SlotSelect`) mark taken cells — and a UI that showed different cells than the run
 * used would be lying.
 */
export const DEFAULT_ATTACKER_SLOT: Position = 'M4';
export const DEFAULT_ENEMY_SLOT: Position = 'M4';

/**
 * Fallback targeting for a positional DPS run — and, since SP-4b-1, the value
 * `normalizeCombatRoster` fills an ABSENT active target with for every actor on both sides.
 *
 * Position alone does NOT route a cast. `selectTurnTarget` requires
 * `resolvesPositionalVictim(actor.position, opposingRoster) && target` — with no ParsedTarget it
 * short-circuits, however well-positioned the roster is: the actor then resolves NO victim, on
 * either side (player since SP-4c-2b, enemy since SP-4e — the enemy's `healTarget` fallback and the
 * field that held it are deleted). (Until SP-4c-2d the
 * player-side fallback was the dummy. A missing target USED to keep the dummy in the turn order
 * too, via the `dummyEnemyIsVestigial` gate's `t?.side === 'enemy'` conjunct; that gate was deleted
 * in SP-4c-2c and SP-4c-2d deleted the actor, so only the targeting short-circuit remains.) That
 * short-circuit is now UNREACHABLE
 * for anything entering through
 * `runCombat`: the boundary fills this target on the first line, so no actor below it is
 * target-less, and `selectTurnTarget` is a closure inside `runCombat` with no other entry point.
 * The mechanism stays documented because it is the REASON the boundary exists — not because a
 * caller can still trip it.
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
 * Fallback single-target footprint for a positional DPS run — and, like the target above, the value
 * `normalizeCombatRoster` fills an ABSENT active pattern with for every actor since SP-4b-1.
 *
 * ALSO load-bearing, not cosmetic. The positional apply gate is
 * `resolvesPositionalVictim(...) && target != null && pattern != null && turn.positionalScalars != null`
 * (the focus cast site in engine.ts; the team and enemy sites mirror it). With a target but no
 * pattern the cast still RESOLVES onto the real enemy and still credits `cumulativeDamage` via the
 * legacy single-apply — but it never runs the per-victim apply, so `creditDealt` never fires and
 * `RoundData.perTargetDealt` comes back empty. That failure is silent: damage looks right while the
 * per-victim accounting the metric depends on is missing. The boundary fills target and pattern
 * INDEPENDENTLY for exactly this reason, and the resulting half-filled state no longer occurs below
 * `runCombat` — the audit found the signature (total credited, `perTargetDealt` empty) zero times.
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
 * `slots[0]` is the attacker and keeps its slot — with ONE exception since SP-4b-1: pass
 * `anchorIsExplicit: false` and an INVENTED anchor slot yields to a nominated explicit one instead
 * (see that parameter below). Each later ship that collides is pushed to the first free slot in
 * `ATTACKER_SLOT_OPTIONS` order. Returns a same-length array.
 *
 * `priorityIndices` (optional) nominates later indices whose wanted slot must ALSO survive a
 * collision: they are reserved right after index 0 and before every other index, so a generic ship
 * yields to them rather than the reverse. It exists for the healing calculator, where the heal
 * target's default cell is coverage-aware (`defaultHealTargetSlot`) while the generic team defaults
 * are not — and the page appends the heal target LAST, so without this it loses every collision and
 * gets evicted to a cell that may sit OUTSIDE the healer's support footprint, i.e. zero healing.
 *
 * Backward-compatible by construction: with `priorityIndices` empty (the DPS calculator, which has
 * no privileged ship) the reservation order is `[0, 1, 2, …]` — byte-identical to the original
 * single-pass behaviour. The returned array stays index-aligned with `slots` in both cases, so
 * callers' `slots[i + 1]` mappings are untouched.
 *
 * `anchorIsExplicit` (optional, defaults to `true` — every existing caller's byte-identical
 * behaviour) governs where index 0 sits relative to the priority group. `true` keeps the original
 * rule: the anchor is reserved before anything else, priority or not — correct when `slots[0]` is
 * itself an explicit placement (or when the caller has no such concept, e.g. the DPS page's
 * attacker-config slot). Pass `false` when `slots[0]` was ITSELF invented by auto-placement: an
 * invented slot must yield to an explicit one (`normalizeRoster.ts`'s binding constraint), and
 * `priorityIndices` alone cannot express that because index 0 is unconditionally exempt from it —
 * see `isPriority` below. With `anchorIsExplicit: false`, index 0 is reserved right AFTER the
 * priority group instead of before it, so a nominated explicit actor now wins the collision and the
 * invented anchor gets pushed to the first free cell instead. `priorityIndices` empty still yields
 * `[0, 1, 2, …]` either way, so this only changes behaviour when both a priority index AND
 * `anchorIsExplicit: false` are passed together — never for a caller that omits the third argument.
 */
export function resolvePlayerSlots(
    slots: ReadonlyArray<Position>,
    priorityIndices: ReadonlyArray<number> = [],
    anchorIsExplicit: boolean = true
): Position[] {
    const isPriority = (i: number) => i !== 0 && priorityIndices.includes(i);
    const allIndices = slots.map((_, i) => i);
    // Reservation order: each group in ascending index order. Assignment writes back by index,
    // never by position in this order, so the result stays aligned with `slots`.
    const order = anchorIsExplicit
        ? // Original rule: the anchor (index 0), then the nominated indices, then the rest.
          [
              ...allIndices.filter((i) => i === 0 || isPriority(i)),
              ...allIndices.filter((i) => i !== 0 && !isPriority(i)),
          ]
        : // The anchor's slot was invented: the nominated (explicit) indices reserve first, THEN
          // the anchor, then the rest — so an explicit actor's cell survives even when the anchor
          // wanted it too.
          [
              ...allIndices.filter(isPriority),
              ...allIndices.filter((i) => i === 0),
              ...allIndices.filter((i) => i !== 0 && !isPriority(i)),
          ];

    const taken = new Set<Position>();
    const resolvedByIndex: Position[] = new Array(slots.length);
    for (const i of order) {
        const wanted = slots[i];
        if (!taken.has(wanted)) {
            taken.add(wanted);
            resolvedByIndex[i] = wanted;
            continue;
        }
        const free = ATTACKER_SLOT_OPTIONS.find((p) => !taken.has(p));
        // 12 slots vs at most 5 player ships (1 attacker + 4 team), so `free` always exists; the
        // fallback keeps the return type honest rather than asserting.
        const resolved = free ?? wanted;
        taken.add(resolved);
        resolvedByIndex[i] = resolved;
    }
    return resolvedByIndex;
}
