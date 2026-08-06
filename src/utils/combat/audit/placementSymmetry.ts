import type { BattleResult } from '../../calculators/battleSimulator';
import {
    boardFor,
    subjectSideFor,
    FOCUS_ACTOR_ID,
    type FingerprintScenario,
} from './kitFingerprintScenarios';
import type { Placement } from './types';

/** What a correctly-resolved subject id looks like per placement. `playerTeam[0]` mints the
 *  reserved `'attacker'`; the rest mint `p:<shipId>:<idx>` / `e:<shipId>:<idx>`
 *  (battleSimulator.ts:842-845). Checked rather than assumed: a mis-resolved id fingerprints an
 *  EMPTY set, so every kind reads as "missing in that placement" and the sweep reports confident
 *  nonsense. This is the #298 fixture-vacuity failure mode. */
const EXPECTED_ID_SHAPE: Record<Placement, (id: string) => boolean> = {
    focus: (id) => id === FOCUS_ACTOR_ID,
    team: (id) => id.startsWith('p:'),
    enemy: (id) => id.startsWith('e:'),
};

/** The subject's actor id in an already-run scenario battle, located by `(side, cell)` — the only
 *  key that is stable across placements. Array index differs by construction and the actor id is
 *  what we are resolving. Throws on a miss or a shape mismatch; never guesses. */
export function resolveSubjectActorId(
    result: BattleResult,
    scenario: FingerprintScenario,
    placement: Placement
): string {
    const side = subjectSideFor(placement);
    const cell = boardFor(scenario).focus;
    const entry = result.roster.find((r) => r.side === side && r.position === cell);
    if (!entry) {
        throw new Error(
            `placementSymmetry: could not resolve the subject actorId for ${placement} ` +
                `(${side}@${cell}) in the ${scenario} roster`
        );
    }
    if (!EXPECTED_ID_SHAPE[placement](entry.actorId)) {
        throw new Error(
            `placementSymmetry: resolved actorId "${entry.actorId}" for ${placement} ` +
                `(${side}@${cell}) does not match the expected shape for that placement`
        );
    }
    return entry.actorId;
}
