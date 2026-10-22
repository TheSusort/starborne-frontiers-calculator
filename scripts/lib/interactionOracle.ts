import { buildInertAllyBaseline } from './traceScenario';
import { composeBattle, type TaggedShip } from '../../src/utils/combat/audit/compose';
import { runSeededBattle } from '../../src/utils/simulator/seededRuns';
import { checkInvariants } from '../../src/utils/combat/audit/invariants';
import { checkReproducibility } from '../../src/utils/combat/audit/reproducibility';
import { minimizeComposition } from '../../src/utils/combat/audit/minimize';
import { diffPersists, restrictDiff, windowedDiff } from '../../src/utils/combat/audit/oracleKinds';
import type { BattleRunner, FingerprintDiff } from '../../src/utils/combat/audit/types';
import type {
    BattleResult,
    BattleSimulationInput,
} from '../../src/utils/calculators/battleSimulator';
import type { Position } from '../../src/types/encounters';
import type { Ship } from '../../src/types/ship';

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

export interface PlacementDifferential {
    /** False when the subject's alive window was shorter than `MIN_WINDOW`; both diffs are null.
     *  "no diff" and "never compared" are the same {null, null} without it. */
    comparable: boolean;
    window: number;
    raw: FingerprintDiff | null;
    restricted: FingerprintDiff | null;
    /** The two boards actually run, subject HP scale applied. */
    boards: { comp: BattleSimulationInput; baseline: BattleSimulationInput };
}

/**
 * The differential oracle for one PLAYER-side placement, identified by its INDEX in
 * `compInput.playerTeam` (ddmin rebuilds the array, and the index decides the actor id). Scales
 * the subject's HP, builds the `buildInertAllyBaseline` board from the scaled composition, runs
 * both under the SAME seed and diffs the subject over its alive window (`windowedDiff`).
 *
 * A one-ship player side diffs against a byte-identical battle and can never produce a finding:
 * no allies, no ally interference. That is also what stops ddmin from minimising a differential
 * down to a solo player team.
 *
 * `run` is the battle runner, injectable so a test can plant a defect in one arm.
 */
export function playerDifferential(
    subjectIndex: number,
    compInput: BattleSimulationInput,
    seed: number,
    inertPool: readonly Ship[],
    run: BattleRunner = runSeededBattle
): PlacementDifferential {
    const comp = scaleSubjectHp(compInput, subjectIndex);
    const baseline = buildInertAllyBaseline(
        comp.playerTeam,
        subjectIndex,
        comp.enemyTeam,
        inertPool,
        seed,
        comp.rounds
    );
    const compResult = run(comp, seed);
    const baselineResult = run(baseline, seed);
    const position = comp.playerTeam[subjectIndex].position;
    const diff = windowedDiff(
        baselineResult,
        compResult,
        comp.playerTeam[subjectIndex].ship.name,
        playerActorId(baselineResult, position),
        playerActorId(compResult, position)
    );
    return { ...diff, boards: { comp, baseline } };
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
// ships (empty class tag set) has no interaction primitives, so any differential that survives
// `EXCLUDED_KINDS` there is harness noise by construction, and the gate fails rather than trust
// the oracle on the real corpus.
// ---------------------------------------------------------------------------

export interface CalibrationVerdict {
    clean: boolean;
    /** Inert-battery diffs that survived the exclusion set. */
    residual: FingerprintDiff[];
}

/** The gate's verdict over the battery's raw diffs: clean iff `restrictDiff` empties every one.
 *  The exclusion set is fixed; a residual is reported, never absorbed into the set. */
export function calibrationVerdict(rawDiffs: readonly FingerprintDiff[]): CalibrationVerdict {
    const residual = rawDiffs
        .map((d) => restrictDiff(d))
        .filter((d): d is FingerprintDiff => d !== null);
    return { clean: residual.length === 0, residual };
}

export interface CalibrationResult {
    clean: boolean;
    detail: string;
    residual: FingerprintDiff[];
    /** How many placements the differential arm of the gate actually COMPARED. A clean verdict
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

/** `run` drives the differential arms only; the invariant and reproducibility checks always run
 *  the real engine. */
export function runCalibration(
    tagged: TaggedShip[],
    seed: number,
    count: number,
    run: BattleRunner = runSeededBattle
): CalibrationResult {
    const inert = tagged.filter((t) => t.classes.size === 0);
    // The battery AND the baseline fillers come from the same inert set, in corpus order.
    const inertPool = inert.map((t) => t.ship);
    const fail = (detail: string, comparablePlacements: number, placementsChecked: number) => ({
        clean: false,
        detail,
        residual: [],
        comparablePlacements,
        placementsChecked,
    });
    if (inert.length === 0) {
        return fail('no inert ships (empty class tag set) found in the corpus', 0, 0);
    }

    const invariantFailures: string[] = [];
    const rawDiffs: FingerprintDiff[] = [];
    let comparablePlacements = 0;
    let placementsChecked = 0;

    for (let i = 0; i < count; i++) {
        const s = seed + i;
        try {
            const compInput = composeBattle(s, inert);
            const compResult = runSeededBattle(compInput, s);
            for (const v of checkInvariants(compResult)) {
                invariantFailures.push(`seed ${s}: ${v.detail}`);
            }
            for (const v of checkReproducibility(compInput, s)) {
                invariantFailures.push(`seed ${s}: ${v.detail}`);
            }
            for (let idx = 0; idx < compInput.playerTeam.length; idx++) {
                const { comparable, raw } = playerDifferential(idx, compInput, s, inertPool, run);
                placementsChecked++;
                if (comparable) comparablePlacements++;
                if (raw) rawDiffs.push(raw);
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

    const verdict = calibrationVerdict(rawDiffs);
    if (!verdict.clean) {
        return {
            clean: false,
            detail:
                `${verdict.residual.length} inert differential(s) survive the exclusion set ` +
                `(${residualHistogram(verdict.residual)}); first: ${JSON.stringify(verdict.residual[0])}`,
            residual: verdict.residual,
            comparablePlacements,
            placementsChecked,
        };
    }
    return {
        clean: true,
        detail: `${rawDiffs.length} raw inert diff(s), all emptied by the exclusion set`,
        residual: [],
        comparablePlacements,
        placementsChecked,
    };
}
