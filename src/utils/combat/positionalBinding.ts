import { selectTargets } from '../targeting/selectTargets';
import { colOf } from '../targeting/board';
import type { Position } from '../../types/encounters';
import type { ParsedTarget } from '../targetingParser';
import { drawKeyed } from '../calculators/rateAccumulator';
import type { CombatActor } from './state';
import { buildCellIndex, cellsOf, hitCellOf, representativeCells } from './cellIndex';

/** Per-actor targeting statuses consulted during positional resolution.
 *  An `undefined` lookup result (see resolvePositionalTarget) is treated as all-false. */
export interface ActorTargetingStatus {
    /** Self-buff 'Stealth' — untargetable unless all opposing actors are stealthed. */
    stealthed: boolean;
    /** Self-buff 'Taunt' — forces opposing attackers to target this actor. */
    taunting: boolean;
    /** Enemy-debuff 'Concentrate Fire' on this actor — force-targeted, bypasses stealth. */
    concentrated: boolean;
}

/**
 * Is this opposing actor a viable positional TARGET for the whole battle?
 *
 * A board position alone does not make an actor hittable: an actor declared with
 * `hp: 0` has no HP to lose and `resolvePositionalTarget` (which indexes only `currentHp > 0`
 * cells) can never return it — not in round 1, not ever. Such an actor is a SOURCE of pressure,
 * never a sink for damage.
 *
 * The predicate is deliberately keyed on MAX hp (`stats.hp`), not `currentHp`: it must be a
 * static property of the battle so the apply gate stays static. An actor that WAS targetable and
 * has since been killed keeps the run positional, so the cast whiffs against the corpse rather
 * than teleporting back onto the legacy dummy sink and recording phantom damage (see the
 * `DELIBERATELY no selectedEnemy != null precondition` note at engine.ts's focus cast site, and
 * `deathFallback.integration.test.ts`). That choice is load-bearing in a second way: re-keying
 * it to `currentHp` would reopen the "placed but unhittable" shape from the corpse end, undoing
 * `withTargetableHp`'s floor — which is why the tripwires that assert the shape is gone name this
 * line too.
 *
 * WHICH SIDE CAN STILL BE UNTARGETABLE. `normalizeCombatRoster`'s `withTargetableHp`
 * floors every ENEMY attacker's max HP to `MIN_TARGETABLE_MAX_HP`, so `false` from this predicate is
 * unreachable for an enemy actor below the boundary. The floor is ENEMY-SIDE ONLY by design (see its
 * own note: the focus's `hp` must stay untouched or a never-alive focus reads as a corpse), so a
 * PLAYER actor with max hp 0 still reads `false` — the shape a caller can still build, and the one
 * `perVictimDotTick.integration.test.ts`'s player-side GATE RETENTION case is written against.
 */
export function isTargetableRosterMember(a: CombatActor): boolean {
    return a.position !== undefined && a.stats.hp > 0;
}

/**
 * Is this actor playing the POSITIONAL game at all — i.e. is it placed on a board that has an
 * opposing side placed on it too?
 *
 * This is the "which mode is this run in" question. It says nothing about whether a cast from
 * this actor can find a VICTIM — for that, see `resolvesPositionalVictim` below. The two are
 * genuinely different, and conflating them is a defect:
 *   • sites that route an actor's OWN state (its own HP, its own timed bomb/accumulator
 *     containers, its own DoT ticks) ask THIS question — the opposing roster is only a
 *     mode signal, and narrowing it would strand the actor's containers unticked;
 *   • sites that resolve a cast onto an opposing victim ask the OTHER one.
 */
export function isPositional(
    actorPosition: Position | undefined,
    opposingLiving: CombatActor[]
): boolean {
    return !!actorPosition && opposingLiving.some((a) => a.position !== undefined);
}

/**
 * Can a cast from this actor resolve onto a positional VICTIM?
 *
 * The static half of a decision whose dynamic half is `resolvePositionalTarget`; the two must
 * agree. `isPositional` alone is too weak here because a board position outlives
 * its owner's ability to be hit: a roster whose every member is a 0-max-HP pressure source is
 * placed but unhittable, so gating on `isPositional` there sends the run positional, selection
 * finds nobody, the per-victim apply books nothing, and the legacy scalar credit is suppressed
 * "because the positional branch was taken" — the cast's damage lands in NEITHER channel and
 * vanishes.
 *
 * `normalizeCombatRoster` auto-places every actor, so "nobody carries a position" is not a
 * usable signal for "this roster is pressure, not targets" — it has to be asked for explicitly.
 *
 * WHERE THAT DIVERGENCE IS STILL REACHABLE — the direction matters when reading
 * the gates built on this. `withTargetableHp` floors every ENEMY attacker's max HP, so for an
 * OPPOSING ROSTER OF ENEMIES this predicate agrees with `isPositional` on every input a caller
 * can construct — the shape described above is unreachable, and the tripwires in
 * `dummyEnemyTurnGate.test.ts` / `perVictimDotTick.integration.test.ts` /
 * `bombSplashOnDeath.integration.test.ts` pin it as such. The floor is enemy-side only, so for an
 * OPPOSING ROSTER OF PLAYERS (what an enemy-side caller passes) the divergence is fully intact: a
 * 0-max-HP focus plus 0-max-HP allies is still `isPositional` true / `resolvesPositionalVictim`
 * false. Keeping the two predicates distinct is therefore live.
 *
 * Keyed on MAX hp, so an actor KILLED mid-battle still keeps the run positional and the cast
 * whiffs against the corpse instead of teleporting back onto the legacy dummy sink and recording
 * phantom damage (see the `DELIBERATELY no selectedEnemy != null precondition` note at engine.ts's
 * focus cast site, and `deathFallback.integration.test.ts`).
 *
 * Team-symmetric by construction: both sides call this one helper with their own opposing roster.
 */
export function resolvesPositionalVictim(
    actorPosition: Position | undefined,
    opposingLiving: CombatActor[]
): boolean {
    return !!actorPosition && opposingLiving.some(isTargetableRosterMember);
}

/** The acting attacker's targeting context for `resolvePositionalTarget`. */
export interface PositionalActing {
    ignoresForcedTargeting?: boolean;
    ignoresStealth?: boolean;
    /** Skips the Concentrate Fire override (a control-immune attacker, `CombatActor.controlImmune`). */
    ignoresConcentrateFire?: boolean;
    provokedBy?: string;
    /** Keys the Concentrate Fire random pick to this attacker's own RNG stream. */
    attackerId?: string;
    /** The Concentrate Fire carrier this cast already picked. While it is alive and still marked,
     *  it is returned without a new draw, so every hit of one cast follows the cast's pick. */
    concentrateFirePickId?: string;
}

/**
 * Resolve the positional target anchor to a single living CombatActor.
 *
 * When `statusOf` is omitted, or the target is ally-side, no forced-targeting or stealth rule
 * runs — this is the arm the golden fixtures pin. When `statusOf` is supplied
 * AND `target.side === 'enemy'`, forced targeting and stealth run before `selectTargets`:
 *   1. Concentrate Fire (bypasses stealth) — force the marked actor (one picked at random when
 *      several are marked; a pick the cast already made stays while it lives). Skipped only when
 *      `acting.ignoresConcentrateFire` is true; `ignoresForcedTargeting` does not skip it.
 *   2. Taunt (before stealth) — force a taunting actor. Several taunters are ordered by the
 *      attacker's NORMAL targeting over the taunters' cells (its own row first, then the next
 *      rows; front to back for a `front` target), never by roster or application order.
 *      Skipped when `acting.ignoresForcedTargeting` is true.
 *   3. Provoke — attacker must target the actor whose id matches `acting.provokedBy`.
 *      Bypasses stealth (forced-targeting override). Falls through if the provoker is dead/absent.
 *      Skipped when `acting.ignoresForcedTargeting` is true.
 *   4. Stealth filter — drop stealthed cells; if that empties the set, restore all. Skipped
 *      entirely when the acting attacker (ship-level `acting.ignoresStealth`) or this cast's
 *      target (per-ability `target.ignoresStealth`) ignores Stealth.
 * `statusOf(id)` returning `undefined` is treated as all-false (never throws/skips).
 *
 * @param acting - Optional context for the acting attacker. `provokedBy` is the id of the
 *   actor that provoked this attacker (pre-resolved by the engine). `ignoresForcedTargeting`
 *   skips both Taunt and Provoke overrides, but NOT Concentrate Fire. `ignoresStealth` skips
 *   the stealth visibility filter (step 4) for this attacker.
 */
export function resolvePositionalTarget(
    actorPosition: Position,
    target: ParsedTarget,
    opposingLiving: CombatActor[],
    statusOf?: (id: string) => ActorTargetingStatus | undefined,
    acting?: PositionalActing
): CombatActor | null {
    return (
        resolvePositionalTargetCell(actorPosition, target, opposingLiving, statusOf, acting)
            ?.actor ?? null
    );
}

/** A resolved positional target: the unit, and the cell of it the cast is pointed at (the
 *  pattern origin). For a single-hex unit the cell is its own position. */
export interface PositionalTargetHit {
    actor: CombatActor;
    cell: Position;
}

/**
 * {@link resolvePositionalTarget} plus the selected CELL. A multi-hex unit (a bounty boss) is
 * selected as one unit across every cell it occupies: it is in every row it occupies, and a
 * `skip` passes over it as a whole. The cell is the one the attacker's normal selection lands on
 * (`hitCellOf`): front-most in the scanned row, back-most for a `back` target. A forced pick
 * (Concentrate Fire, Taunt, Provoke) is aimed the same way at the forced unit's cells.
 */
export function resolvePositionalTargetCell(
    actorPosition: Position,
    target: ParsedTarget,
    opposingLiving: CombatActor[],
    statusOf?: (id: string) => ActorTargetingStatus | undefined,
    acting?: PositionalActing
): PositionalTargetHit | null {
    const living = opposingLiving.filter((a) => a.position !== undefined && a.currentHp > 0);
    if (living.length === 0) {
        return null;
    }

    // Ally-side targets do not resolve through the opposing list.
    if (target.side === 'ally') {
        return null;
    }

    const aimAt = (actor: CombatActor): PositionalTargetHit => ({
        actor,
        cell: hitCellOf(actor, actorPosition, target.selection) ?? actor.position!,
    });
    const selectAmong = (units: CombatActor[]): PositionalTargetHit | null => {
        const byCell = buildCellIndex(units);
        const { anchor } = selectTargets(target, {
            casterPosition: actorPosition,
            enemyOccupied: representativeCells(units, target.selection),
        });
        const actor = anchor ? byCell.get(anchor) : undefined;
        return actor && anchor ? { actor, cell: anchor } : null;
    };

    // Candidate units; the stealth filter narrows this list.
    let candidates = living;

    if (statusOf) {
        const ignore = acting?.ignoresForcedTargeting;

        // 1. Concentrate Fire — bypasses stealth; `ignore` does not skip it, only
        //    `ignoresConcentrateFire` does. Several marked actors → one is picked at random from
        //    the attacker's keyed stream; a single mark draws nothing.
        const concentrated = acting?.ignoresConcentrateFire
            ? []
            : living.filter((a) => statusOf(a.id)?.concentrated);
        if (concentrated.length === 1) {
            return aimAt(concentrated[0]);
        }
        if (concentrated.length > 1) {
            const stuck = concentrated.find((a) => a.id === acting?.concentrateFirePickId);
            if (stuck) return aimAt(stuck);
            const frontCol = (a: CombatActor) => Math.max(...cellsOf(a).map(colOf));
            const ordered = [...concentrated].sort((x, y) => frontCol(y) - frontCol(x));
            const draw = drawKeyed(`${acting?.attackerId ?? ''}:concentrate-fire-pick`);
            return aimAt(ordered[Math.min(ordered.length - 1, Math.floor(draw * ordered.length))]);
        }

        // 2. Taunt — evaluated before the stealth filter. Skipped when the attacker ignores
        //    forced targeting.
        if (!ignore) {
            const taunting = living.filter((a) => statusOf(a.id)?.taunting);
            if (taunting.length) {
                return selectAmong(taunting) ?? aimAt(taunting[0]);
            }
        }

        // 3. Provoke — attacker must target the actor that provoked it. Bypasses stealth
        //    (forced-targeting override). Falls through if the provoker is dead/absent.
        //    Skipped when the attacker ignores forced targeting.
        if (!ignore && acting?.provokedBy !== undefined) {
            const provoker = living.find((a) => a.id === acting.provokedBy);
            if (provoker) {
                return aimAt(provoker);
            }
        }

        // 4. Stealth filter — restore all if every candidate is stealthed. Skipped entirely when
        //    the acting attacker (ship-level) OR this cast's target (per-ability) ignores Stealth.
        if (!acting?.ignoresStealth && !target.ignoresStealth) {
            const visible = candidates.filter((a) => !statusOf(a.id)?.stealthed);
            if (visible.length) {
                candidates = visible;
            }
        }
    }

    return selectAmong(candidates);
}
