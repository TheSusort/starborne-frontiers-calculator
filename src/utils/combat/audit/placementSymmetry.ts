import type { Ship } from '../../../types/ship';
import type { BattleResult } from '../../calculators/battleSimulator';
import type { CombatLogEntryKind } from '../log/types';
import { fingerprintActor } from './fingerprint';
import { runSeededBattle } from './seededBattle';
import {
    boardFor,
    buildScenarioBattle,
    scenariosFor,
    subjectSideFor,
    FOCUS_ACTOR_ID,
    type FingerprintScenario,
} from './kitFingerprintScenarios';
import { PLACEMENT_PAIRS, type Placement, type PlacementDiff } from './types';

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

/** `count` consecutive seeds starting at `base`. Consecutive rather than hashed: the sweep's job is
 *  to widen the RNG sample, and a reader reproducing a finding needs to be able to type the seeds. */
export function seedsFrom(base: number, count: number): number[] {
    return Array.from({ length: count }, (_, i) => base + i);
}

/** Everything the subject did in one placement: the UNION of bare log-entry kinds over every
 *  scenario it runs and every seed.
 *
 *  BARE kinds, via `fingerprintActor` — never `fingerprintActorTokens`. The `:slot` suffix records
 *  which log handler won the single-use `consumePendingSkill()` race, so it tracks emission ORDER
 *  and would flip across a placement change on its own, manufacturing diffs.
 *
 *  Union over seeds is what neutralises ownerId-keyed RNG: the same physical ship draws a different
 *  crit/landing/proc stream depending on its owner id, so a proc-gated kind can appear in one
 *  placement and not another purely by draw. A kind the placement can produce AT ALL shows up in the
 *  union of enough seeds, so only a kind appearing in ZERO seeds is reported. Union over scenarios
 *  goes the same way, trading "which scenario exposed it" for a lower false-positive rate. Both are
 *  deliberate false-negative trades: each finding costs a manual engine-instrumentation triage. */
export function fingerprintSubject(
    subject: Ship,
    placement: Placement,
    seeds: readonly number[]
): Set<CombatLogEntryKind> {
    const observed = new Set<CombatLogEntryKind>();
    for (const scenario of scenariosFor(subject)) {
        for (const seed of seeds) {
            const result = runSeededBattle(buildScenarioBattle(subject, scenario, placement), seed);
            const actorId = resolveSubjectActorId(result, scenario, placement);
            for (const kind of fingerprintActor(result, actorId)) observed.add(kind);
        }
    }
    return observed;
}

/** One DIRECTED comparison: kinds the subject produced in `from` but never in `to`. Null when there
 *  are none — including when `to` is a strict superset, which the reverse direction reports. Sorted
 *  so a ledger diff never churns on set-iteration order. */
export function diffPlacements(
    shipName: string,
    from: Placement,
    to: Placement,
    fromKinds: ReadonlySet<CombatLogEntryKind>,
    toKinds: ReadonlySet<CombatLogEntryKind>
): PlacementDiff | null {
    const missing = [...fromKinds].filter((k) => !toKinds.has(k)).sort();
    return missing.length === 0 ? null : { shipName, from, to, missing };
}

/** Every asymmetry between the three placements, in BOTH directions per pair. "Fires as attacker but
 *  never as enemy" and "fires as enemy but never as attacker" are both defects, so neither direction
 *  is privileged. */
export function diffAllPlacements(
    shipName: string,
    byPlacement: Record<Placement, ReadonlySet<CombatLogEntryKind>>
): PlacementDiff[] {
    const out: PlacementDiff[] = [];
    for (const [a, b] of PLACEMENT_PAIRS) {
        const ab = diffPlacements(shipName, a, b, byPlacement[a], byPlacement[b]);
        if (ab) out.push(ab);
        const ba = diffPlacements(shipName, b, a, byPlacement[b], byPlacement[a]);
        if (ba) out.push(ba);
    }
    return out;
}
