/**
 * The engine's ONE accommodation boundary (SP-4b).
 *
 * `runCombat` calls this on its first line, so everything below it sees a fully positional world:
 * every actor carries a board slot, and every actor carries offensive targeting. Nothing else in
 * the engine may accommodate an under-specified input — that is the whole point of having a
 * boundary, and it is what lets SP-4c delete the dummy and its seven clusters of fallbacks.
 *
 * Four responsibilities, and deliberately no fifth:
 *   (a) auto-placement       — a deterministic slot for any actor with `position == null`
 *   (b) targeting synthesis  — DEFAULT_FRONT_ENEMY_TARGET + DEFAULT_BASE_PATTERN when ABSENT
 *   (c) targetable HP        — a max HP of 0/absent is floored so every enemy is a hittable ship
 *   (d) nothing else         — it does not invent enemies, fill in other stats, or choose a mode
 *
 * Pure: the caller's input object and its nested arrays are never mutated.
 */
import {
    DEFAULT_ATTACKER_SLOT,
    DEFAULT_ENEMY_SLOT,
    DEFAULT_BASE_PATTERN,
    DEFAULT_FRONT_ENEMY_TARGET,
    defaultTeamSlot,
    resolvePlayerSlots,
} from '../calculators/dpsEnemyPlacement';
import { defaultEnemySlot, resolveEnemySlots } from '../calculators/healingPlacement';
import type { Position } from '../../types/encounters';
import type { ParsedPattern, ParsedTarget } from '../targetingParser';
import type { CombatEngineInput } from './engine';

/**
 * Resolve one side's board.
 *
 * `wanted[0]` is the side's ANCHOR (the focus attacker, or the first enemy) and, when EXPLICIT,
 * keeps its slot exactly as before. `resolvePlayerSlots` pushes any later colliding actor to the
 * first free cell. The enemy side goes through `resolveEnemySlots`, which delegates to the same
 * resolver — sides are independent coordinate spaces, which is exactly why both anchor on `M4`
 * without conflicting.
 *
 * Explicit positions win, including over an INVENTED anchor: `explicit[i] ?? fallback(i)` is
 * computed BEFORE collision resolution, so an actor the caller placed only ever moves for the same
 * reason it would have moved before this module existed — another actor's EXPLICIT cell, or the
 * pre-existing anchor, already holds it. Every index the caller supplied a position for is nominated
 * via `priorityIndices` so it survives a collision against everything invented; `anchorIsExplicit`
 * additionally tells the resolver whether the anchor itself is one of those explicit actors —
 * `false` means `wanted[0]` was invented and must yield to a nominated collider instead of
 * unconditionally winning (see `resolvePlayerSlots`'s doc comment for why `priorityIndices` alone
 * cannot express that: index 0 is exempt from it by design).
 */
function placeSide(
    explicit: ReadonlyArray<Position | undefined>,
    anchor: Position,
    walkBack: (index: number) => Position,
    resolve: (
        slots: ReadonlyArray<Position>,
        priorityIndices?: ReadonlyArray<number>,
        anchorIsExplicit?: boolean
    ) => Position[]
): Position[] {
    const wanted = explicit.map((p, i) => p ?? (i === 0 ? anchor : walkBack(i - 1)));
    const priorityIndices = explicit.flatMap((p, i) => (i !== 0 && p !== undefined ? [i] : []));
    return resolve(wanted, priorityIndices, explicit[0] !== undefined);
}

/**
 * Fill the ACTIVE targeting axes when the caller supplied none.
 *
 * Both are load-bearing and independently required: `selectTurnTarget` needs
 * `resolvesPositionalVictim(...) && target` (no target → falls back to the dummy), and the
 * positional APPLY gate additionally needs `pattern != null`. With a target but no pattern the cast
 * resolves onto the real enemy and still credits `cumulativeDamage` through the legacy single-apply
 * (the credit is suppressed only when the POSITIONAL branch is taken), but never runs the
 * per-victim apply — so `perTargetDealt` comes back EMPTY while the damage number looks plausible.
 * That is why the two are filled independently rather than as a pair.
 *
 * Both sentences describe what happens WITHOUT these fills. With them, neither state is reachable
 * below this boundary — so where the engine and the calculators still describe the dummy fallback,
 * they are stating the RATIONALE for this module, not behaviour a caller can still reach.
 *
 * FILL, never SUBSTITUTE. An ally-side target the caller supplied is kept: rewriting it to the
 * front-enemy default is the healing adapter's matchup POLICY (`offensiveTarget`), not this
 * boundary's business, and doing it here would stop a battle-sim support ship from healing.
 *
 * The CHARGED axes are deliberately untouched. `undefined` there is meaningful — the engine's
 * fallback is "charged axis absent ⇒ reuse the active one" — so a default would silently override
 * a charged-axis-less actor's active binding.
 */
function withTargeting<T extends { target?: ParsedTarget; pattern?: ParsedPattern }>(actor: T): T {
    return {
        ...actor,
        target: actor.target ?? DEFAULT_FRONT_ENEMY_TARGET,
        pattern: actor.pattern ?? DEFAULT_BASE_PATTERN,
    };
}

/**
 * The max HP an enemy attacker is raised to when the caller supplied none or supplied `<= 0`.
 *
 * `1_000_000` is not a fresh invention: `healingEngineAdapter`'s `LEGACY_SINK_HP` already fills an
 * ABSENT enemy HP with exactly this number, for exactly this reason ("a 0-HP enemy silently zeroes
 * every damage-dealt rider"). Its `??` misses an EXPLICIT 0, which is what 288 of the 307 measured
 * all-zero-roster runs pass. Same number here, one layer lower, catching both.
 */
export const MIN_TARGETABLE_MAX_HP = 1_000_000;

/**
 * Responsibility (d): every enemy attacker is a HITTABLE ship.
 *
 * `isTargetableRosterMember` (positional + max hp > 0) is what `hasPositionedEnemyRoster` is built
 * from, and a roster holding no targetable member is the ONE shape that still reached the vestigial
 * dummy's scalar sink — measured at 412 credits across 26 files on `main` @ `8d2c2a61`, every one of
 * them this shape. Flooring here makes `hasPositionedEnemyRoster` constant `true` below the
 * boundary, so the positional path is taken on every run and player damage books per-victim.
 *
 * UNIFORM, not conditional on the side being untargetable. The census found 3,004 runCombat
 * invocations and ZERO mixed rosters (a 0-max-HP member alongside a targetable one), so the two
 * rules are behaviourally identical on the corpus — and the uniform one retires the whole class
 * instead of one instance, with no `if` for a later rung to have to reason about.
 *
 * ENEMY SIDE ONLY. The focus attacker's `hp` is deliberately untouched: most direct-engine fixtures
 * omit it, so the focus starts at `currentHp === 0` having never been destroyed. Reading that as a
 * corpse is the mistake that failed 346 tests during 4c-1 (spec §3.3), and nothing asks
 * `isTargetableRosterMember` about a player actor.
 */
function withTargetableHp<T extends { stats: { hp?: number } }>(actor: T): T {
    const hp = actor.stats.hp;
    return hp !== undefined && hp > 0
        ? actor
        : { ...actor, stats: { ...actor.stats, hp: MIN_TARGETABLE_MAX_HP } };
}

export function normalizeCombatRoster(input: CombatEngineInput): CombatEngineInput {
    // The contract (SP-4b-2b): every run has at least one opponent. This is a validation guard
    // rather than an accommodation on purpose — the boundary is the ONE place that accommodates an
    // under-specified input, and synthesizing a sink here is what kept the dummy alive.
    // `enemyAttackers` is typed as required on `CombatEngineInput`, but an `as CombatEngineInput`
    // cast at a call site defeats that compile-time check, so a fixture can still reach this line
    // with the field missing entirely rather than empty — the runtime guard must catch `undefined`
    // as well as `[]`, or those callers get a bare `TypeError` instead of this named contract error.
    if (!input.enemyAttackers?.length) {
        throw new Error(
            'normalizeCombatRoster: enemyAttackers is empty — every run needs at least one ' +
                'opponent (SP-4b-2b). A caller with no enemy to model should synthesize an inert ' +
                'one, as healingEngineAdapter.practiceTarget does.'
        );
    }
    const teamActors = input.teamActors ?? [];
    const enemyAttackers = input.enemyAttackers;

    // Player side: the focus attacker is index 0 (the anchor), team actors follow in input order.
    const playerSlots = placeSide(
        [input.position, ...teamActors.map((t) => t.position)],
        DEFAULT_ATTACKER_SLOT,
        defaultTeamSlot,
        resolvePlayerSlots
    );
    const [focusSlot, ...teamSlots] = playerSlots;

    // Enemy side: its own board, resolved separately. `enemyAttackers` is provably non-empty here
    // (the guard above), so this always takes the `placeSide` branch — no `: []` fallback needed.
    const enemySlots = placeSide(
        enemyAttackers.map((e) => e.position),
        DEFAULT_ENEMY_SLOT,
        (i) => defaultEnemySlot(i + 1),
        resolveEnemySlots
    );

    return {
        ...withTargeting(input),
        position: focusSlot,
        ...(input.teamActors
            ? {
                  teamActors: input.teamActors.map((t, i) => ({
                      ...withTargeting(t),
                      position: teamSlots[i],
                  })),
              }
            : {}),
        // `enemyAttackers` is provably truthy here (the guard above), so — unlike `teamActors`,
        // which is genuinely optional — there is no `: {}` branch to fall back to.
        enemyAttackers: enemyAttackers.map((e, i) => ({
            ...withTargetableHp(withTargeting(e)),
            position: enemySlots[i],
        })),
    };
}
