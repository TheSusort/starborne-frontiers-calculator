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

export function isPositional(
    actorPosition: Position | undefined,
    opposingLiving: CombatActor[]
): boolean {
    return !!actorPosition && opposingLiving.some((a) => a.position !== undefined);
}

/**
 * Resolve the positional target anchor to a single living CombatActor.
 *
 * When `statusOf` is omitted, or the target is ally-side, behaviour is identical to
 * Phase 2 (the load-bearing byte-identical-goldens guarantee). When `statusOf` is supplied
 * AND `target.side === 'enemy'`, forced targeting and stealth run before `selectTargets`:
 *   1. Concentrate Fire (bypasses stealth) — force the marked actor (front-most if many).
 *   2. Taunt (before stealth) — force the taunting actor (latest tauntAppliedRound else front-most).
 *   3. Stealth filter — drop stealthed cells; if that empties the set, restore all.
 * `statusOf(id)` returning `undefined` is treated as all-false (never throws/skips).
 */
export function resolvePositionalTarget(
    actorPosition: Position,
    target: ParsedTarget,
    opposingLiving: CombatActor[],
    statusOf?: (id: string) => ActorTargetingStatus | undefined
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

        // 1. Concentrate Fire — bypasses stealth.
        const concentrated = actors.filter((a) => statusOf(a.id)?.concentrated);
        if (concentrated.length) {
            return frontMost(concentrated);
        }

        // 2. Taunt — evaluated before the stealth filter.
        const taunting = actors.filter((a) => statusOf(a.id)?.taunting);
        if (taunting.length) {
            // -Infinity sentinel: when all taunters lack tauntAppliedRound, every round(a) is -Infinity,
            // they all tie at maxRound, and frontMost resolves the tie (roundless multi-taunt → front-most).
            const round = (a: CombatActor) => statusOf(a.id)?.tauntAppliedRound ?? -Infinity;
            const maxRound = Math.max(...taunting.map(round));
            const latest = taunting.filter((a) => round(a) === maxRound);
            return frontMost(latest);
        }

        // 3. Stealth filter — restore all if every candidate is stealthed.
        const visible = cells.filter((p) => !statusOf(byCell.get(p)!.id)?.stealthed);
        if (visible.length) {
            cells = visible;
        }
    }

    const { anchor } = selectTargets(target, {
        casterPosition: actorPosition,
        enemyOccupied: cells,
    });
    return anchor ? (byCell.get(anchor) ?? null) : null;
}
