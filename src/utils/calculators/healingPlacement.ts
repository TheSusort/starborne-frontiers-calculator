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

/**
 * The heal target's default slot — **minimal autoplace** (owner decision 9, 2026-08-12).
 *
 * Seeds a cell the HEALER's own support footprint covers, because an off-footprint heal target
 * receives **nothing at all**: `resolveSupportRecipients` FILTERS the recipient list by the footprint
 * and never expands it, and a single-`ally` heal's base is just `[healTargetId]`. That zero is
 * game-faithful and deliberately not softened — so the defaults must simply not walk into it.
 *
 * Selection order:
 *   1. a covered cell that is neither the healer's own cell nor the FRONT column (decision 2's
 *      no-front-bias still holds — it is about enemy fire, an independent axis from ally coverage);
 *   2. any covered cell that is not the healer's own cell;
 *   3. `NEUTRAL_HEAL_TARGET_SLOT`.
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
    if (!healerPattern?.modifiers.support) return NEUTRAL_HEAL_TARGET_SLOT;

    const covered = resolveCells(healerPattern, healerSlot)
        .map((c) => c.position)
        .filter((p) => p !== healerSlot);

    return covered.find((p) => !p.endsWith('4')) ?? covered[0] ?? NEUTRAL_HEAL_TARGET_SLOT;
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
export function resolveEnemySlots(slots: ReadonlyArray<Position>): Position[] {
    return resolvePlayerSlots(slots);
}

export { ATTACKER_SLOT_OPTIONS as HEALING_SLOT_OPTIONS };
