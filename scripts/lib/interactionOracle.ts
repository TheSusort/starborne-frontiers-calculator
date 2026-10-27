import { buildInertAllyBaseline } from './traceScenario';
import { reachesAllies } from '../../src/utils/combat/audit/classes';
import { composeBattle, type TaggedShip } from '../../src/utils/combat/audit/compose';
import { runSeededBattle } from '../../src/utils/simulator/seededRuns';
import {
    checkInvariants,
    durationExtenderKinds,
    extraActionActorIds,
} from '../../src/utils/combat/audit/invariants';
import { checkReproducibility } from '../../src/utils/combat/audit/reproducibility';
import { minimizeComposition } from '../../src/utils/combat/audit/minimize';
import {
    diffPersists,
    restrictDiff,
    windowedDiff,
    withoutKinds,
} from '../../src/utils/combat/audit/oracleKinds';
import type {
    BattleRunner,
    DemotedKind,
    FingerprintDiff,
} from '../../src/utils/combat/audit/types';
import type {
    BattleResult,
    BattleSimulationInput,
} from '../../src/utils/calculators/battleSimulator';
import type { Position } from '../../src/types/encounters';
import type { Ship } from '../../src/types/ship';
import type { CombatLogEntryKind } from '../../src/utils/combat/log/types';

/**
 * The subject's HP multiplier, applied in BOTH arms of a differential. A comparison covers only
 * the rounds the subject was alive for in both arms, so a subject that dies early has a short
 * window; the scale keeps it on the board long enough to show its kit.
 *
 * What it costs: a gate on the subject's OWN HP ("below 50% HP", "when this Unit would be
 * destroyed") fires later or never, so the differential is blind to those. Listed in the ledger
 * header (`LEDGER_BLIND_SPOTS`).
 */
export const SUBJECT_HP_SCALE = 5;

/** Fewest baseline fillers a corpus must offer. A baseline needs one distinct filler per ally
 *  seat, so a pool below this is too thin to draw varied fillers from. */
export const MIN_FILLER_POOL = 12;

/**
 * The ships a baseline may draw its stand-in allies from: inert (empty class tag set) AND not
 * aimed at an ally (`reachesAllies`). An ally-buffing, repairing or shielding filler changes the
 * subject's baseline (a filler's buff sitting atop the subject's Taunt absorbs an enemy purge
 * meant for it), and the inert-vs-inert calibration battery cannot see that. Throws when fewer
 * than `MIN_FILLER_POOL` remain.
 */
export function baselineFillerPool(tagged: readonly TaggedShip[]): Ship[] {
    const pool = tagged
        .filter((t) => t.classes.size === 0 && !reachesAllies(t.ship))
        .map((t) => t.ship);
    if (pool.length < MIN_FILLER_POOL) {
        throw new Error(
            `baselineFillerPool: ${pool.length} usable filler(s), need at least ${MIN_FILLER_POOL}`
        );
    }
    return pool;
}

/** `input` with `playerTeam[subjectIndex]`'s HP multiplied by `scale`. */
export function scaleSubjectHp(
    input: BattleSimulationInput,
    subjectIndex: number,
    scale: number = SUBJECT_HP_SCALE
): BattleSimulationInput {
    return {
        ...input,
        playerTeam: input.playerTeam.map((p, i) =>
            i === subjectIndex
                ? {
                      ...p,
                      statOverrides: {
                          ...p.statOverrides,
                          hp: Math.round((p.statOverrides?.hp ?? p.ship.baseStats.hp) * scale),
                      },
                  }
                : p
        ),
    };
}

function playerActorId(result: BattleResult, position: Position): string {
    const entry = result.roster.find((r) => r.side === 'player' && r.position === position);
    if (!entry) throw new Error(`could not resolve actorId for player@${position} in the roster`);
    return entry.actorId;
}

/** Added to the battle seed to draw the second baseline's stand-ins. The battle itself still
 *  runs under the original seed, so only WHICH inert ships stand in differs between the two
 *  baselines. */
export const SECOND_FILLER_DRAW_OFFSET = 7919;

export interface PlacementDifferential {
    /** False when the subject's alive window was shorter than `MIN_WINDOW`; every diff is then
     *  null. "no diff" and "never compared" are the same {null, null} without it. */
    comparable: boolean;
    window: number;
    raw: FingerprintDiff | null;
    restricted: FingerprintDiff | null;
    /** What the audit confirms: `restricted` minus every kind in `demoted`. */
    reported: FingerprintDiff | null;
    /** Restricted kinds moved to the drift tier, with the rule that moved each. */
    demoted: DemotedKind[];
    /** The boards actually run, subject HP scale applied. `secondBaseline` is null when the
     *  second draw picked the same stand-ins as the first. */
    boards: {
        comp: BattleSimulationInput;
        baseline: BattleSimulationInput;
        secondBaseline: BattleSimulationInput | null;
    };
}

const fillerNames = (input: BattleSimulationInput): string =>
    input.playerTeam.map((p) => p.ship.name).join('|');

/**
 * The differential oracle for one PLAYER-side placement, identified by its INDEX in
 * `compInput.playerTeam` (ddmin rebuilds the array, and the index decides the actor id). Scales
 * the subject's HP, builds the `buildInertAllyBaseline` board from the scaled composition, runs
 * both under the SAME seed and diffs the subject over its alive window (`windowedDiff`, which
 * also demotes `timing` kinds).
 *
 * A kind that survives is checked against a SECOND baseline whose stand-ins are drawn with
 * `SECOND_FILLER_DRAW_OFFSET`. Stand-ins are inert, not absent: they attack, crit and provoke
 * enemy reactions, and an "another ally crits" or "an enemy cleanses" clause on the subject can
 * read them. A kind the second baseline does not report in the same direction was decided by
 * which stand-ins were drawn, and is demoted as `filler`. When the second baseline is not
 * comparable, or draws the same stand-ins, nothing is demoted on that rule.
 *
 * A one-ship player side diffs against a byte-identical battle and can never produce a finding:
 * no allies, no ally interference. That is also what stops ddmin from minimising a differential
 * down to a solo player team.
 *
 * `run` is the battle runner, injectable so a test can plant a defect in one arm. Arms run in the
 * order composition, baseline, second baseline.
 */
export function playerDifferential(
    subjectIndex: number,
    compInput: BattleSimulationInput,
    seed: number,
    inertPool: readonly Ship[],
    run: BattleRunner = runSeededBattle
): PlacementDifferential {
    const comp = scaleSubjectHp(compInput, subjectIndex);
    const baselineOf = (drawSeed: number) =>
        buildInertAllyBaseline(
            comp.playerTeam,
            subjectIndex,
            comp.enemyTeam,
            inertPool,
            drawSeed,
            comp.rounds
        );
    const baseline = baselineOf(seed);
    const compResult = run(comp, seed);
    const baselineResult = run(baseline, seed);
    const position = comp.playerTeam[subjectIndex].position;
    const shipName = comp.playerTeam[subjectIndex].ship.name;
    const compActorId = playerActorId(compResult, position);
    const first = windowedDiff(
        baselineResult,
        compResult,
        shipName,
        playerActorId(baselineResult, position),
        compActorId
    );

    let secondBaseline: BattleSimulationInput | null = baselineOf(seed + SECOND_FILLER_DRAW_OFFSET);
    if (fillerNames(secondBaseline) === fillerNames(baseline)) secondBaseline = null;
    if (!first.reported || !secondBaseline) {
        return { ...first, boards: { comp, baseline, secondBaseline } };
    }

    const secondResult = run(secondBaseline, seed);
    const second = windowedDiff(
        secondResult,
        compResult,
        shipName,
        playerActorId(secondResult, position),
        compActorId
    );
    const demoted = [...first.demoted];
    if (second.comparable) {
        const confirmedBySecond = (sign: '-' | '+', k: CombatLogEntryKind) =>
            (sign === '-'
                ? second.reported?.missingInComposition
                : second.reported?.extraInComposition
            )?.includes(k) ?? false;
        for (const kind of first.reported.missingInComposition) {
            if (!confirmedBySecond('-', kind)) demoted.push({ kind, sign: '-', reason: 'filler' });
        }
        for (const kind of first.reported.extraInComposition) {
            if (!confirmedBySecond('+', kind)) demoted.push({ kind, sign: '+', reason: 'filler' });
        }
    }
    return {
        ...first,
        reported: withoutKinds(first.restricted, demoted),
        demoted,
        boards: { comp, baseline, secondBaseline },
    };
}

/**
 * ddmin for a differential finding: the smallest board on which the subject still shows every
 * kind the ORIGINAL finding reported (`diffPersists`). `differentialOf` runs the oracle on a
 * candidate for the subject at the given index.
 */
export function minimizeDifferential(
    input: BattleSimulationInput,
    subjectShipId: string,
    original: FingerprintDiff,
    differentialOf: (
        candidate: BattleSimulationInput,
        subjectIndex: number
    ) => FingerprintDiff | null
): BattleSimulationInput {
    return minimizeComposition(input, (candidate) => {
        // Re-resolved per candidate: ddmin drops placements, so the subject's index moves.
        const idx = candidate.playerTeam.findIndex((p) => p.ship.id === subjectShipId);
        if (idx < 0) return false;
        try {
            return diffPersists(original, differentialOf(candidate, idx));
        } catch {
            return false;
        }
    });
}

// ---------------------------------------------------------------------------
// Calibration gate: runs BEFORE any fuzzing. A battery of compositions built only from inert
// ships (empty class tag set) has no interaction primitives, so a differential that survives
// `EXCLUDED_KINDS` there is the oracle's own false-positive floor.
// ---------------------------------------------------------------------------

/**
 * The residual rate the gate tolerates: residual diffs over COMPARABLE calibration placements.
 *
 * Inert is not zero influence. Inert kits deal different damage, which moves kill timing and so
 * target selection, and a target-conditioned clause on the subject can flip with it (Rys "when
 * damaging a debuffer or supporter", Thresh's buff steal that logs only when there is a buff to
 * take). Excluding those kinds would hide real findings of the same kinds, so the gate bounds the
 * rate instead. Measured on the inert battery with both drift rules applied (2026-10-27): 0/1932 at
 * seed 1 and 0/1940 at seed 5000 (count 500), 6/7718 at seed 1 (count 2000); the threshold sits
 * above that floor and fails a run that drifts well past it.
 */
export const CALIBRATION_RESIDUAL_TOLERANCE = 0.01;

export interface CalibrationVerdict {
    /** True when the residual rate is within `CALIBRATION_RESIDUAL_TOLERANCE`. */
    passed: boolean;
    /** Inert-battery diffs that survived the exclusion set. */
    residual: FingerprintDiff[];
    /** `residual.length / comparablePlacements`; 0 when nothing was compared. */
    rate: number;
}

/** The gate's verdict over the battery's reported diffs (`PlacementDifferential.reported`). The
 *  exclusion set is fixed: a residual is measured against the tolerance, never absorbed into the
 *  set. */
export function calibrationVerdict(
    rawDiffs: readonly FingerprintDiff[],
    comparablePlacements: number,
    tolerance: number = CALIBRATION_RESIDUAL_TOLERANCE
): CalibrationVerdict {
    const residual = rawDiffs
        .map((d) => restrictDiff(d))
        .filter((d): d is FingerprintDiff => d !== null);
    const rate = comparablePlacements === 0 ? 0 : residual.length / comparablePlacements;
    return { passed: rate <= tolerance, residual, rate };
}

export interface CalibrationResult {
    /** False on a residual rate over tolerance, and always on a crash or invariant failure. */
    passed: boolean;
    detail: string;
    residual: FingerprintDiff[];
    residualRate: number;
    tolerance: number;
    /** How many placements the differential arm of the gate actually COMPARED. A passing verdict
     *  backed by zero comparisons is vacuous. */
    comparablePlacements: number;
    placementsChecked: number;
}

/** Residual kinds with how many diffs cite each, most frequent first: `kind×n`. */
export function residualHistogram(residual: readonly FingerprintDiff[]): string {
    const counts = new Map<string, number>();
    for (const d of residual) {
        for (const k of d.missingInComposition) counts.set(`-${k}`, (counts.get(`-${k}`) ?? 0) + 1);
        for (const k of d.extraInComposition) counts.set(`+${k}`, (counts.get(`+${k}`) ?? 0) + 1);
    }
    return [...counts]
        .sort((x, y) => y[1] - x[1])
        .map(([k, n]) => `${k}×${n}`)
        .join(', ');
}

const formatRate = (rate: number): string => `${(100 * rate).toFixed(2)}%`;

/** `run` drives the differential arms only; the invariant and reproducibility checks always run
 *  the real engine. */
export function runCalibration(
    tagged: TaggedShip[],
    seed: number,
    count: number,
    run: BattleRunner = runSeededBattle,
    tolerance: number = CALIBRATION_RESIDUAL_TOLERANCE
): CalibrationResult {
    const inert = tagged.filter((t) => t.classes.size === 0);
    // The battery is the inert set; the baseline fillers are its non-supportive subset.
    const fail = (
        detail: string,
        comparablePlacements: number,
        placementsChecked: number
    ): CalibrationResult => ({
        passed: false,
        detail,
        residual: [],
        residualRate: 0,
        tolerance,
        comparablePlacements,
        placementsChecked,
    });
    if (inert.length === 0) {
        return fail('no inert ships (empty class tag set) found in the corpus', 0, 0);
    }
    let inertPool: Ship[];
    try {
        inertPool = baselineFillerPool(tagged);
    } catch (err) {
        return fail(err instanceof Error ? err.message : String(err), 0, 0);
    }

    const invariantFailures: string[] = [];
    const rawDiffs: FingerprintDiff[] = [];
    let comparablePlacements = 0;
    let placementsChecked = 0;

    for (let i = 0; i < count; i++) {
        const s = seed + i;
        try {
            const compInput = composeBattle(s, inert);
            const compResult = runSeededBattle({ ...compInput, __auditTrail: true }, s);
            for (const v of checkInvariants(compResult, {
                extraActionActorIds: extraActionActorIds(compInput, compResult),
                durationExtenders: durationExtenderKinds(compInput, compResult),
            })) {
                invariantFailures.push(`seed ${s}: ${v.detail}`);
            }
            for (const v of checkReproducibility(compInput, s)) {
                invariantFailures.push(`seed ${s}: ${v.detail}`);
            }
            for (let idx = 0; idx < compInput.playerTeam.length; idx++) {
                const { comparable, reported } = playerDifferential(
                    idx,
                    compInput,
                    s,
                    inertPool,
                    run
                );
                placementsChecked++;
                if (comparable) comparablePlacements++;
                if (reported) rawDiffs.push(reported);
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return fail(
                `engine crash on an INERT composition (seed ${s}), a real bug: ${message}`,
                comparablePlacements,
                placementsChecked
            );
        }
    }

    if (invariantFailures.length > 0) {
        return fail(invariantFailures.join(' | '), comparablePlacements, placementsChecked);
    }

    // A gate that compared nothing has measured nothing; a 0% rate over zero placements is not a pass.
    if (comparablePlacements === 0) {
        return fail(
            `no comparable inert placements (0/${placementsChecked} checked), so the gate measured nothing`,
            comparablePlacements,
            placementsChecked
        );
    }

    const verdict = calibrationVerdict(rawDiffs, comparablePlacements, tolerance);
    const residualSummary =
        `${verdict.residual.length}/${comparablePlacements} inert placement(s) left a residual ` +
        `diff (${formatRate(verdict.rate)}, tolerance ${formatRate(tolerance)})` +
        (verdict.residual.length > 0 ? `: ${residualHistogram(verdict.residual)}` : '');
    return {
        passed: verdict.passed,
        detail: verdict.passed
            ? residualSummary
            : `${residualSummary}; first: ${JSON.stringify(verdict.residual[0])}`,
        residual: verdict.residual,
        residualRate: verdict.rate,
        tolerance,
        comparablePlacements,
        placementsChecked,
    };
}
