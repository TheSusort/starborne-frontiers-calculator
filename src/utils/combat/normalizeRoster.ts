/**
 * The engine's ONE accommodation boundary (SP-4b).
 *
 * `runCombat` calls this on its first line, so everything below it sees a fully positional world:
 * every actor carries a board slot, and every actor carries offensive targeting. Nothing else in
 * the engine may accommodate an under-specified input — that is the whole point of having a
 * boundary, and it is what lets SP-4c delete the dummy and its seven clusters of fallbacks.
 *
 * Three responsibilities, and deliberately no fourth:
 *   (a) auto-placement       — a deterministic slot for any actor with `position == null`
 *   (b) targeting synthesis  — DEFAULT_FRONT_ENEMY_TARGET + DEFAULT_BASE_PATTERN when ABSENT
 *   (c) nothing else         — it does not invent enemies, fill in stats, or choose a mode
 *
 * Pure: the caller's input object and its nested arrays are never mutated.
 */
import {
    DEFAULT_ATTACKER_SLOT,
    DEFAULT_ENEMY_SLOT,
    defaultTeamSlot,
    resolvePlayerSlots,
} from '../calculators/dpsEnemyPlacement';
import { defaultEnemySlot, resolveEnemySlots } from '../calculators/healingPlacement';
import type { Position } from '../../types/encounters';
import type { CombatEngineInput } from './engine';

/**
 * Resolve one side's board.
 *
 * `wanted[0]` is the side's ANCHOR (the focus attacker, or the first enemy) and keeps its slot;
 * `resolvePlayerSlots` pushes any later colliding actor to the first free cell. The enemy side
 * goes through `resolveEnemySlots`, which delegates to the same resolver — sides are independent
 * coordinate spaces, which is exactly why both anchor on `M4` without conflicting.
 *
 * Explicit positions win: `explicit[i] ?? fallback(i)` is computed BEFORE collision resolution, so
 * an actor the caller placed only ever moves for the same reason it would have moved before this
 * module existed — another actor already holds its cell.
 */
function placeSide(
    explicit: ReadonlyArray<Position | undefined>,
    anchor: Position,
    walkBack: (index: number) => Position,
    resolve: (slots: ReadonlyArray<Position>) => Position[]
): Position[] {
    const wanted = explicit.map((p, i) => p ?? (i === 0 ? anchor : walkBack(i - 1)));
    return resolve(wanted);
}

export function normalizeCombatRoster(input: CombatEngineInput): CombatEngineInput {
    const teamActors = input.teamActors ?? [];
    const enemyAttackers = input.enemyAttackers ?? [];

    // Player side: the focus attacker is index 0 (the anchor), team actors follow in input order.
    const playerSlots = placeSide(
        [input.position, ...teamActors.map((t) => t.position)],
        DEFAULT_ATTACKER_SLOT,
        defaultTeamSlot,
        resolvePlayerSlots
    );
    const [focusSlot, ...teamSlots] = playerSlots;

    // Enemy side: its own board, resolved separately.
    const enemySlots = enemyAttackers.length
        ? placeSide(
              enemyAttackers.map((e) => e.position),
              DEFAULT_ENEMY_SLOT,
              (i) => defaultEnemySlot(i + 1),
              resolveEnemySlots
          )
        : [];

    return {
        ...input,
        position: focusSlot,
        ...(input.teamActors
            ? { teamActors: input.teamActors.map((t, i) => ({ ...t, position: teamSlots[i] })) }
            : {}),
        ...(input.enemyAttackers
            ? {
                  enemyAttackers: input.enemyAttackers.map((e, i) => ({
                      ...e,
                      position: enemySlots[i],
                  })),
              }
            : {}),
    };
}
