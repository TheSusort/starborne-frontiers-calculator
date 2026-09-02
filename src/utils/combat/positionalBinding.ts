import { selectTargets } from '../targeting/selectTargets';
import { colOf } from '../targeting/board';
import type { Position } from '../../types/encounters';
import type { ParsedTarget } from '../targetingParser';
import type { CombatActor } from './state';

/** Per-actor targeting statuses consulted during positional resolution.
 *  An `undefined` lookup result (see resolvePositionalTarget) is treated as all-false. */
export interface ActorTargetingStatus {
    /** Self-buff 'Stealth' — untargetable unless all opposing actors are stealthed. */
    stealthed: boolean;
    /** Self-buff 'Taunt' — forces opposing attackers to target this actor. */
    taunting: boolean;
    /** Enemy-debuff 'Concentrate Fire' on this actor — force-targeted, bypasses stealth. */
    concentrated: boolean;
    /** Round the Taunt was applied (most-recent-wins tiebreak). Unset today → front-most. */
    tauntAppliedRound?: number;
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
 * placed but unhittable, so the gate went positional, selection found nobody, the per-victim apply
 * booked nothing, and the legacy scalar credit was suppressed "because the positional branch was
 * taken" — the cast's damage landed in NEITHER channel and vanished.
 *
 * `normalizeCombatRoster` auto-places every actor, so "nobody carries a position" is no longer a
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
 * false. Keeping the two predicates distinct is therefore still live, not merely historical.
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

/**
 * Resolve the positional target anchor to a single living CombatActor.
 *
 * When `statusOf` is omitted, or the target is ally-side, no forced-targeting or stealth rule
 * runs — this is the arm the byte-identical goldens pin. When `statusOf` is supplied
 * AND `target.side === 'enemy'`, forced targeting and stealth run before `selectTargets`:
 *   1. Concentrate Fire (bypasses stealth, never skipped) — force the marked actor (front-most if many).
 *   2. Taunt (before stealth) — force the taunting actor (latest tauntAppliedRound else front-most).
 *      Skipped when `acting.ignoresForcedTargeting` is true.
 *   3. Provoke — attacker must target the actor whose id matches `acting.provokedBy`.
 *      Bypasses stealth (forced-targeting override). Falls through if the provoker is dead/absent.
 *      Skipped when `acting.ignoresForcedTargeting` is true.
 *   4. Stealth filter — drop stealthed cells; if that empties the set, restore all. Skipped
 *      entirely when the acting attacker (ship-level `acting.ignoresStealth`) or this cast's
 *      target (per-ability `target.ignoresStealth`) ignores Stealth (Ship-kit W6).
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
    acting?: { ignoresForcedTargeting?: boolean; ignoresStealth?: boolean; provokedBy?: string }
): CombatActor | null {
    const byCell = new Map<Position, CombatActor>();
    for (const a of opposingLiving) {
        if (a.position !== undefined && a.currentHp > 0) {
            byCell.set(a.position, a);
        }
    }
    if (byCell.size === 0) {
        return null;
    }

    // Ally-side targets do not resolve through the opposing list.
    if (target.side === 'ally') {
        return null;
    }

    // Candidate cells; the stealth filter narrows this list, byCell stays intact for lookup.
    let cells = [...byCell.keys()];

    if (statusOf) {
        const actors = [...byCell.values()];
        // Front-most among candidates: highest column first (col 4 = front).
        // Precondition: callers must guarantee cands is non-empty (returns undefined on []).
        const frontMost = (cands: CombatActor[]): CombatActor =>
            [...cands].sort((x, y) => colOf(y.position!) - colOf(x.position!))[0];

        const ignore = acting?.ignoresForcedTargeting;

        // 1. Concentrate Fire — bypasses stealth, never skipped (even when ignore is true).
        const concentrated = actors.filter((a) => statusOf(a.id)?.concentrated);
        if (concentrated.length) {
            return frontMost(concentrated);
        }

        // 2. Taunt — evaluated before the stealth filter. Skipped when the attacker ignores
        //    forced targeting.
        if (!ignore) {
            const taunting = actors.filter((a) => statusOf(a.id)?.taunting);
            if (taunting.length) {
                // -Infinity sentinel: when all taunters lack tauntAppliedRound, every round(a) is -Infinity,
                // they all tie at maxRound, and frontMost resolves the tie (roundless multi-taunt → front-most).
                const round = (a: CombatActor) => statusOf(a.id)?.tauntAppliedRound ?? -Infinity;
                const maxRound = Math.max(...taunting.map(round));
                const latest = taunting.filter((a) => round(a) === maxRound);
                return frontMost(latest);
            }
        }

        // 3. Provoke — attacker must target the actor that provoked it. Bypasses stealth
        //    (forced-targeting override). Falls through if the provoker is dead/absent.
        //    Skipped when the attacker ignores forced targeting.
        if (!ignore && acting?.provokedBy !== undefined) {
            const provoker = actors.find((a) => a.id === acting.provokedBy);
            if (provoker) {
                return provoker;
            }
        }

        // 4. Stealth filter — restore all if every candidate is stealthed. Skipped entirely when
        //    the acting attacker (ship-level) OR this cast's target (per-ability) ignores Stealth.
        if (!acting?.ignoresStealth && !target.ignoresStealth) {
            const visible = cells.filter((p) => !statusOf(byCell.get(p)!.id)?.stealthed);
            if (visible.length) {
                cells = visible;
            }
        }
    }

    const { anchor } = selectTargets(target, {
        casterPosition: actorPosition,
        enemyOccupied: cells,
    });
    return anchor ? (byCell.get(anchor) ?? null) : null;
}
