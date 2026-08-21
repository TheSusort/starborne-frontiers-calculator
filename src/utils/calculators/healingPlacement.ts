import type { Position } from '../../types/encounters';
import type { ParsedPattern } from '../targetingParser';
import { resolveCells } from '../targeting/resolvePattern';
import { ATTACKER_SLOT_OPTIONS, resolvePlayerSlots } from './dpsEnemyPlacement';

/**
 * Default board slots for the healing calculator's positional run.
 *
 * Column 4 is the FRONT. Unlike the DPS calculator — where a 1v1 wants both sides front-and-centre
 * so patterns collapse to single-target — the healing calculator has a roster on both sides, so the
 * defaults spread out and the user places deliberately.
 *
 * ⚠️ The heal target deliberately gets NO front bias (owner ruling, 2026-08-12). Seeding it to the
 * front would keep it soaking damage by default and quietly preserve the old non-positional
 * premise; the explicit trade-off accepted instead is that a saved page may measure ~0 incoming
 * damage until its ships are placed.
 */
export const DEFAULT_HEALER_SLOT: Position = 'M2';

/** The neutral fallback when coverage cannot be computed — mid-board, NOT the front column. */
const NEUTRAL_HEAL_TARGET_SLOT: Position = 'M3';

/** Secondary neutral fallback, used only on the rare board where the healer itself already
 *  occupies `NEUTRAL_HEAL_TARGET_SLOT` — see `neutralHealTargetSlot` below. */
const NEUTRAL_HEAL_TARGET_SLOT_ALT: Position = 'M2';

/**
 * Healer-aware wrapper around `NEUTRAL_HEAL_TARGET_SLOT`. The slot dropdown lets the user move the
 * healer onto ANY cell, including M3 — and the plain constant returned unguarded would then hand
 * back the healer's own cell. `resolveHealingPlayerPlacement` has no way to tell that apart from a
 * genuine pick, so the healer wins index 0 and the heal target gets evicted to the first free cell
 * in `ATTACKER_SLOT_OPTIONS` order — chosen with NO knowledge of coverage, i.e. exactly the
 * off-footprint zero this module exists to steer defaults away from. Every fallback return in
 * `defaultHealTargetSlot` must go through this, never the bare constant.
 */
function neutralHealTargetSlot(healerSlot: Position): Position {
    return healerSlot === NEUTRAL_HEAL_TARGET_SLOT
        ? NEUTRAL_HEAL_TARGET_SLOT_ALT
        : NEUTRAL_HEAL_TARGET_SLOT;
}

/**
 * The heal target's default slot — **minimal autoplace** (owner decision 9, 2026-08-12).
 *
 * Seeds a cell the HEALER's own support footprint covers, because an off-footprint heal target
 * receives **nothing at all**: `resolveSupportRecipients` FILTERS the recipient list by the footprint
 * and never expands it, so an off-footprint id is dropped whether it arrived as the whole own-side
 * roster (a plain `'ally'`/`'all-allies'` heal since SP-4e Task 4) or, before that rung, as the
 * single-element `[healTargetId]` base. That zero is game-faithful and deliberately not softened —
 * so the defaults must simply not walk into it.
 *
 * Selection order:
 *   1. a covered cell that is neither the healer's own cell nor the FRONT column (decision 2's
 *      no-front-bias still holds — it is about enemy fire, an independent axis from ally coverage);
 *   2. any covered cell that is not the healer's own cell;
 *   3. `neutralHealTargetSlot(healerSlot)` — `NEUTRAL_HEAL_TARGET_SLOT`, or its alternate when the
 *      healer itself already stands there. Every return in this function goes through that wrapper,
 *      never the bare constant, so this can NEVER return the healer's own cell — including when
 *      `healerPattern` is absent/non-support or `resolveCells` throws, not just the covered branch.
 *
 * Returns the neutral default when `healerPattern` is absent (manual entry, no ship picked) or is
 * NOT a support pattern — a non-support pattern never filters ally recipients
 * (`supportFootprintAllyIds` returns `undefined`), so coverage is irrelevant there.
 *
 * DEFERRED (follow-up): the full multi-supporter footprint intersection. This considers the healer
 * only. Decision 8's placement warning is the safety net for everything this misses.
 */
export function defaultHealTargetSlot(
    healerSlot: Position = DEFAULT_HEALER_SLOT,
    healerPattern?: ParsedPattern
): Position {
    if (!healerPattern?.modifiers.support) return neutralHealTargetSlot(healerSlot);

    // `resolveCells` THROWS for a pattern signature with no offset table (resolvePattern.ts:40) —
    // and this helper now sits on `simulateHealing`'s hot path, so an unguarded throw would surface
    // as a React render crash once the UI threads real ship targeting. The corpus is currently safe
    // (`docs/ship-targeting.csv`: none of its 14 support patterns throws today), so this is a guard
    // against a FUTURE offset-table gap, not a bug being papered over — e.g. the parseable-but-
    // tableless `Pattern-Line-Support-Range-2` (signature `line|2|support`) throws right now if a
    // ship ever ships it. An unknown footprint tells us nothing about coverage, so fall back to the
    // neutral slot exactly as an absent/non-support pattern does.
    let coveredCells: ReturnType<typeof resolveCells>;
    try {
        coveredCells = resolveCells(healerPattern, healerSlot);
    } catch {
        return neutralHealTargetSlot(healerSlot);
    }

    const covered = coveredCells.map((c) => c.position).filter((p) => p !== healerSlot);

    return covered.find((p) => !p.endsWith('4')) ?? covered[0] ?? neutralHealTargetSlot(healerSlot);
}

/**
 * Default slot for the Nth healing-calc team ship, avoiding the healer's and heal target's
 * defaults so no two player ships start stacked. `resolvePlayerSlots` is still the authority at
 * sim time — a collision there silently ERASES the earlier actor from its cell.
 */
export function defaultHealingTeamSlot(index: number): Position {
    const order: readonly Position[] = ['M1', 'T2', 'T3', 'B2', 'B3', 'T1', 'B1', 'T4', 'B4', 'M4'];
    return order[index % order.length];
}

/** Default slot for the Nth enemy: front column first, so enemies start in contact. */
export function defaultEnemySlot(index: number): Position {
    const order: readonly Position[] = ['M4', 'T4', 'B4', 'M3', 'T3', 'B3', 'M2', 'T2', 'B2', 'M1'];
    return order[index % order.length];
}

/**
 * Resolve an ENEMY-side roster so no two enemies share a cell.
 *
 * Same contract and same hazard as `resolvePlayerSlots`: `resolvePositionalTarget` and
 * `footprintVictims` index actors into a `Map<Position, CombatActor>`, so on a collision the LATER
 * entry wins and the earlier enemy vanishes from that cell. Sides are independent boards, so the
 * player and enemy rosters are resolved separately.
 */
export function resolveEnemySlots(
    slots: ReadonlyArray<Position>,
    priorityIndices: ReadonlyArray<number> = [],
    anchorIsExplicit: boolean = true
): Position[] {
    return resolvePlayerSlots(slots, priorityIndices, anchorIsExplicit);
}

/**
 * Resolve the whole PLAYER-side board for a healing run: the healer's cell plus one cell per ally,
 * with no two actors sharing a cell.
 *
 * Shared by `simulateHealing` and the page's placement warning deliberately — the warning must
 * reason about the cells the SIM actually uses, and those are not the wanted cells: an unplaced
 * ally takes an index-derived default, and a collision MOVES someone. A second, independent
 * derivation on the UI side would drift and warn about a cell nobody occupies.
 *
 * Two rules live here:
 *
 *  1. an unplaced HEAL TARGET gets the coverage-aware `defaultHealTargetSlot` (an off-footprint heal
 *     target receives exactly zero — see that function), and every other unplaced ally gets
 *     `defaultHealingTeamSlot(index)`;
 *
 *  2. **EXPLICIT beats DEFAULT, in both directions.** Every explicitly-placed ally is nominated for
 *     collision priority, and the heal target's coverage-aware default is nominated too — except
 *     when an explicitly-placed ally wants that same cell. Losing a collision is not cosmetic: the
 *     loser is silently MOVED, which can change which ship is front-most and therefore who the enemy
 *     shoots.
 *
 *     Both directions need fencing, and one nomination flag cannot express both because
 *     `resolvePlayerSlots` orders its priority group by INDEX, not by tier:
 *       - nominating unconditionally let a *default* evict a deliberate placement — measured
 *         `resolvePlayerSlots(['M2','T2','T2'], [2])` → `['M2','T1','T2']`, i.e. the ally the user
 *         parked on T2 was moved to make room for the heal target's default pick;
 *       - dropping the nomination whenever the heal target is explicit would flip the error over:
 *         a generic ally's *default* would then evict the heal target's deliberate placement,
 *         because the page appends the heal target LAST and the lower index wins.
 *
 *     When an explicit ally does win the contested cell the heal target may land off-footprint and
 *     heal for zero. That is intended: the zero is game-faithful, the user's placement is
 *     authoritative, and `uncoveredAllyIds` below is what makes the consequence visible.
 */
export function resolveHealingPlayerPlacement(args: {
    /** The healer's cell. Index 0 never moves, so this is returned unchanged. */
    healerSlot?: Position;
    /** The healer's parsed ACTIVE pattern — drives the heal target's coverage-aware default. */
    healerPattern?: ParsedPattern;
    /** Which ally id IS the heal target. No match (e.g. self-heal) → no nomination. */
    healTargetId: string;
    /** Allies in the SAME order the caller passes them to the engine; `position` absent = unplaced. */
    allies: ReadonlyArray<{ id: string; position?: Position }>;
}): { healerSlot: Position; allySlots: Position[] } {
    const healerSlot = args.healerSlot ?? DEFAULT_HEALER_SLOT;
    const wanted: Position[] = [
        healerSlot,
        ...args.allies.map((a, i) =>
            a.position
                ? a.position
                : a.id === args.healTargetId
                  ? defaultHealTargetSlot(healerSlot, args.healerPattern)
                  : defaultHealingTeamSlot(i)
        ),
    ];
    const healTargetIndex = args.allies.findIndex((a) => a.id === args.healTargetId);
    // `+ 1` throughout because `wanted[0]` is the healer; index 0 already outranks everything.
    const priority = args.allies.flatMap((a, i) => (a.position ? [i + 1] : []));
    const healTargetIsDefault = healTargetIndex >= 0 && !args.allies[healTargetIndex].position;
    const contestedByExplicit =
        healTargetIsDefault &&
        args.allies.some(
            (a, i) => i !== healTargetIndex && a.position === wanted[healTargetIndex + 1]
        );
    if (healTargetIsDefault && !contestedByExplicit) priority.push(healTargetIndex + 1);
    const resolved = resolvePlayerSlots(wanted, priority);
    return { healerSlot: resolved[0], allySlots: resolved.slice(1) };
}

/**
 * Player-side ally ids standing on a cell that NO supporter's footprint covers.
 *
 * A support cast anchors on the caster's own cell and `resolveSupportRecipients` FILTERS recipients
 * by that footprint, so an uncovered ally receives exactly zero. That zero is intended (owner ruling)
 * — this helper exists to make it VISIBLE, never to change it. No caller may use it to widen a
 * footprint, pick a fallback recipient, or move a ship on the user's behalf.
 *
 * A supporter is any player ship whose parsed ACTIVE pattern carries `modifiers.support`. Ships with
 * no resolvable support pattern contribute no coverage. When there is NO supporter at all, returns an
 * empty array: nothing is "uncovered" if nothing was ever going to cover it, and warning on every
 * ally in a damage-only team would be noise.
 *
 * The caster is itself a candidate: a support footprint always includes the anchor cell, so a
 * supporter standing on its own cell is covered — but a supporter whose pattern cannot be resolved
 * at all (see the guard below) is reported like any other uncovered ally.
 */
export function uncoveredAllyIds(
    allies: ReadonlyArray<{ id: string; position: Position; pattern?: ParsedPattern }>
): string[] {
    const covered = new Set<Position>();
    let sawSupporter = false;
    for (const a of allies) {
        if (!a.pattern?.modifiers.support) continue;
        sawSupporter = true;
        try {
            for (const c of resolveCells(a.pattern, a.position)) covered.add(c.position);
        } catch {
            // Unknown pattern signature (no offset table) — contributes no coverage rather than
            // throwing. Same guard as defaultHealTargetSlot; see its comment. This helper runs on
            // every render of the healing page, so an unguarded throw is a React render crash.
        }
    }
    if (!sawSupporter) return [];
    return allies.filter((a) => !covered.has(a.position)).map((a) => a.id);
}

export { ATTACKER_SLOT_OPTIONS as HEALING_SLOT_OPTIONS };
