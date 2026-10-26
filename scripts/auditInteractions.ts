/* eslint-disable no-console */
import { parseAuditArgs } from './lib/auditArgs';
import { loadTaggedCorpus } from './lib/taggedCorpus';
import {
    formatCoverage,
    writeLedger,
    type CalibrationResidual,
    type LedgerCoverage,
} from './lib/interactionLedger';
import {
    baselineFillerPool,
    minimizeDifferential,
    playerDifferential,
    residualHistogram,
    runCalibration,
} from './lib/interactionOracle';
import { composeBattle } from '../src/utils/combat/audit/compose';
import { runSeededBattle } from '../src/utils/simulator/seededRuns';
import {
    checkInvariants,
    durationExtenderKinds,
    extraActionActorIds,
} from '../src/utils/combat/audit/invariants';
import { checkReproducibility } from '../src/utils/combat/audit/reproducibility';
import { runAblation } from '../src/utils/combat/audit/ablation';
import { minimizeComposition } from '../src/utils/combat/audit/minimize';
import { EXCLUDED_KINDS } from '../src/utils/combat/audit/oracleKinds';
import type { Finding, FingerprintDiff, InvariantViolation } from '../src/utils/combat/audit/types';
import type {
    BattlePlacement,
    BattleResult,
    BattleSimulationInput,
} from '../src/utils/calculators/battleSimulator';
import type { CombatLogEntryKind } from '../src/utils/combat/log/types';
import type { Position } from '../src/types/encounters';
import type { Ship } from '../src/types/ship';

// ---------------------------------------------------------------------------
// Roster resolution
// ---------------------------------------------------------------------------

function rosterName(result: BattleResult, actorId: string | undefined): string | undefined {
    if (!actorId) return undefined;
    return result.roster.find((r) => r.actorId === actorId)?.name;
}

function rosterPosition(result: BattleResult, actorId: string | undefined): Position | undefined {
    if (!actorId) return undefined;
    return result.roster.find((r) => r.actorId === actorId)?.position;
}

// ---------------------------------------------------------------------------
// Finding construction helpers
// ---------------------------------------------------------------------------

function invariantFinding(v: InvariantViolation, compResult: BattleResult, seed: number): Finding {
    const name = rosterName(compResult, v.actorId);
    const pos = rosterPosition(compResult, v.actorId);
    const ships = name ? [name] : compResult.roster.map((r) => r.name);
    const slots = pos ? [pos] : compResult.roster.map((r) => r.position);
    return {
        oracle: 'invariant',
        ships,
        slots,
        seed,
        invariant: v.invariant,
        severity: 'high',
    };
}

function differentialFinding(
    placement: BattlePlacement,
    diff: FingerprintDiff,
    seed: number
): Finding {
    return {
        oracle: 'differential',
        ships: [placement.ship.name],
        slots: [placement.position],
        seed,
        fingerprintDiff: diff,
        severity: 'med',
    };
}

// ---------------------------------------------------------------------------
// Ablation: top tagged pairs per composition, sampled across a few seeds (crit RNG makes
// `diverges` seed-sensitive). Keeps the pair count small (top 2 by shared-class intersection
// size) so runtime stays sane.
// ---------------------------------------------------------------------------

const ABLATION_SEED_OFFSETS = [0, 104_729, 224_737]; // 3 samples per pair, large-prime-spaced
const MAX_ABLATION_PAIRS_PER_COMPOSITION = 2;

function topTaggedPairs(
    compInput: BattleSimulationInput,
    shipClassesById: Map<string, Set<string>>
): Array<{ a: BattlePlacement; b: BattlePlacement; score: number }> {
    const all = [...compInput.playerTeam, ...compInput.enemyTeam];
    const seen = new Set<string>();
    const distinct: BattlePlacement[] = [];
    for (const p of all) {
        if (seen.has(p.ship.id)) continue;
        seen.add(p.ship.id);
        distinct.push(p);
    }
    const tagged = distinct.filter((p) => (shipClassesById.get(p.ship.id)?.size ?? 0) > 0);

    const pairs: Array<{ a: BattlePlacement; b: BattlePlacement; score: number }> = [];
    for (let i = 0; i < tagged.length; i++) {
        for (let j = i + 1; j < tagged.length; j++) {
            const ca = shipClassesById.get(tagged[i].ship.id) ?? new Set<string>();
            const cb = shipClassesById.get(tagged[j].ship.id) ?? new Set<string>();
            const score = [...ca].filter((c) => cb.has(c)).length;
            pairs.push({ a: tagged[i], b: tagged[j], score });
        }
    }
    pairs.sort((x, y) => y.score - x.score);
    return pairs.slice(0, MAX_ABLATION_PAIRS_PER_COMPOSITION);
}

function ablationFinding(
    a: BattlePlacement,
    b: BattlePlacement,
    compositionSeed: number,
    inertPool: readonly Ship[]
): { finding: Finding | null; compared: number; total: number } {
    let diverged = 0;
    let compared = 0;
    let firstDetail = '';
    const gained = new Map<string, Set<CombatLogEntryKind>>();
    for (const offset of ABLATION_SEED_OFFSETS) {
        const result = runAblation(a.ship, b.ship, compositionSeed + offset, inertPool);
        compared += result.compared;
        if (result.diverges) {
            diverged++;
            if (!firstDetail) firstDetail = result.detail;
        }
        for (const g of result.gained) {
            const kinds = gained.get(g.ship) ?? new Set<CombatLogEntryKind>();
            for (const k of g.kinds) kinds.add(k);
            gained.set(g.ship, kinds);
        }
    }
    const total = 2 * ABLATION_SEED_OFFSETS.length;
    if (diverged === 0) return { finding: null, compared, total };
    return {
        finding: {
            oracle: 'ablation',
            ships: [a.ship.name, b.ship.name],
            slots: [a.position, b.position],
            seed: compositionSeed,
            ablationDetail: `${diverged}/${ABLATION_SEED_OFFSETS.length} seeds diverged; sample: ${firstDetail}`,
            ablationGained: [...gained].map(([ship, kinds]) => ({ ship, kinds: [...kinds] })),
            severity: 'low',
        },
        compared,
        total,
    };
}

// ---------------------------------------------------------------------------
// Minimization
// ---------------------------------------------------------------------------

/** A seeded run carrying `BattleResult.audit`, which the duration and reduction-cap invariants
 *  read. */
function auditedRun(input: BattleSimulationInput, seed: number): BattleResult {
    return runSeededBattle({ ...input, __auditTrail: true }, seed);
}

/** `checkInvariants` with the per-roster exemptions the composition's kits earn. */
function invariantViolations(input: BattleSimulationInput, result: BattleResult) {
    return checkInvariants(result, {
        extraActionActorIds: extraActionActorIds(input, result),
        durationExtenders: durationExtenderKinds(input, result),
    });
}

function safeRun(input: BattleSimulationInput, seed: number): BattleResult | null {
    try {
        return auditedRun(input, seed);
    } catch {
        return null;
    }
}

function minimizeInvariant(input: BattleSimulationInput, v: InvariantViolation, seed: number) {
    const stillFails = (candidate: BattleSimulationInput): boolean => {
        try {
            if (v.invariant === 'reproducibility') {
                return checkReproducibility(candidate, seed).length > 0;
            }
            const result = safeRun(candidate, seed);
            if (!result) return false;
            return invariantViolations(candidate, result).some(
                (x) =>
                    x.invariant === v.invariant &&
                    (v.actorId === undefined || x.actorId === v.actorId)
            );
        } catch {
            return false;
        }
    };
    return minimizeComposition(input, stillFails);
}

function toMinimalRepro(min: BattleSimulationInput) {
    return {
        playerShips: min.playerTeam.map((p) => p.ship.name),
        enemyShips: min.enemyTeam.map((p) => p.ship.name),
    };
}

// ---------------------------------------------------------------------------
// Engine-crash safety: this is a fuzzer over a real, hand-written combat engine. A crash on one
// composition/pair must not abort the whole batch and lose every finding collected so far — it IS
// a finding, so it gets recorded as a high-severity 'invariant' Finding and the loop moves on.
// ---------------------------------------------------------------------------

function crashFinding(ships: string[], slots: Position[], seed: number, err: unknown): Finding {
    const message = err instanceof Error ? err.message : String(err);
    return {
        oracle: 'invariant',
        ships,
        slots,
        seed,
        invariant: `engine-crash: ${message}`,
        severity: 'high',
    };
}

function allNames(input: BattleSimulationInput): string[] {
    return [...input.playerTeam, ...input.enemyTeam].map((p) => p.ship.name);
}

function allPositions(input: BattleSimulationInput): Position[] {
    return [...input.playerTeam, ...input.enemyTeam].map((p) => p.position);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
    const { seed, count } = parseAuditArgs(process.argv.slice(2));
    if (!Number.isFinite(seed) || !Number.isFinite(count) || count <= 0) {
        console.error('Usage: npm run audit:interactions -- --seed <N> --count <M>');
        process.exit(1);
    }

    const tagged = loadTaggedCorpus();
    console.log(`Loaded ${tagged.length} ships from the corpus.`);
    console.log(`Excluded kinds: [${[...EXCLUDED_KINDS].join(', ')}]`);

    const calibration = runCalibration(tagged, seed, count);
    const calibrationCoverage = {
        comparable: calibration.comparablePlacements,
        total: calibration.placementsChecked,
    };
    console.log(`CALIBRATION coverage: ${formatCoverage(calibrationCoverage)} inert placements`);
    // The gate passes while the inert-battery residual stays within its tolerance
    // (`CALIBRATION_RESIDUAL_TOLERANCE`); a crash or invariant failure always fails.
    if (!calibration.passed) {
        console.error(`CALIBRATION FAILED: ${calibration.detail}`);
        process.exit(1);
    }
    console.log(`CALIBRATION: passed (${calibration.detail})`);
    const calibrationResidual: CalibrationResidual = {
        count: calibration.residual.length,
        rate: calibration.residualRate,
        tolerance: calibration.tolerance,
        histogram: residualHistogram(calibration.residual),
    };

    // Baseline fillers: the inert, non-supportive subset of the calibration gate's set, threaded
    // explicitly so the oracle and its ddmin stay a pure function of (seed, subject, pool).
    let inertPool: Ship[];
    try {
        inertPool = baselineFillerPool(tagged);
    } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
    }
    console.log(`Inert baseline filler pool: ${inertPool.length} ships.`);

    const shipClassesById = new Map(tagged.map((t) => [t.ship.id, t.classes] as const));
    const findings: Finding[] = [];
    let compositionsRun = 0;
    const differential = { comparable: 0, total: 0 };
    const ablation = { comparable: 0, total: 0 };

    for (let i = 0; i < count; i++) {
        const s = seed + i;

        let compInput: BattleSimulationInput;
        try {
            compInput = composeBattle(s, tagged);
        } catch (err) {
            findings.push(crashFinding([], [], s, err));
            compositionsRun++;
            continue;
        }

        let compResult: BattleResult;
        try {
            compResult = auditedRun(compInput, s);
        } catch (err) {
            findings.push(crashFinding(allNames(compInput), allPositions(compInput), s, err));
            compositionsRun++;
            continue;
        }
        compositionsRun++;

        try {
            for (const v of invariantViolations(compInput, compResult)) {
                const min = minimizeInvariant(compInput, v, s);
                findings.push({
                    ...invariantFinding(v, compResult, s),
                    minimalRepro: toMinimalRepro(min),
                });
            }
        } catch (err) {
            findings.push(crashFinding(allNames(compInput), allPositions(compInput), s, err));
        }

        try {
            for (const v of checkReproducibility(compInput, s)) {
                const min = minimizeInvariant(compInput, v, s);
                findings.push({
                    ...invariantFinding(v, compResult, s),
                    minimalRepro: toMinimalRepro(min),
                });
            }
        } catch (err) {
            findings.push(crashFinding(allNames(compInput), allPositions(compInput), s, err));
        }

        for (let idx = 0; idx < compInput.playerTeam.length; idx++) {
            const placement = compInput.playerTeam[idx];
            try {
                const { comparable, restricted } = playerDifferential(idx, compInput, s, inertPool);
                differential.total++;
                if (comparable) differential.comparable++;
                if (!restricted) continue;
                const min = minimizeDifferential(
                    compInput,
                    placement.ship.id,
                    restricted,
                    (candidate, candidateIdx) =>
                        playerDifferential(candidateIdx, candidate, s, inertPool).restricted
                );
                findings.push({
                    ...differentialFinding(placement, restricted, s),
                    minimalRepro: toMinimalRepro(min),
                });
            } catch (err) {
                findings.push(crashFinding([placement.ship.name], [placement.position], s, err));
            }
        }

        for (const { a, b } of topTaggedPairs(compInput, shipClassesById)) {
            try {
                const result = ablationFinding(a, b, s, inertPool);
                ablation.comparable += result.compared;
                ablation.total += result.total;
                if (result.finding) findings.push(result.finding);
            } catch (err) {
                findings.push(
                    crashFinding([a.ship.name, b.ship.name], [a.position, b.position], s, err)
                );
            }
        }
    }

    const coverage: LedgerCoverage = { calibration: calibrationCoverage, differential, ablation };
    const { confirmed, needsTriage, groups } = writeLedger(
        findings,
        { compositionsRun, coverage, calibrationResidual },
        'docs'
    );
    console.log(`compositionsRun: ${compositionsRun}`);
    console.log(`differential coverage: ${formatCoverage(differential)} player placements`);
    console.log(`ablation coverage: ${formatCoverage(ablation)} subject-runs`);
    console.log(`confirmed: ${confirmed.length} (${groups.confirmed.length} (ships, kind) groups)`);
    console.log(
        `needsTriage: ${needsTriage.length} (${groups.needsTriage.length} (ships, kind) groups)`
    );
    console.log('Wrote docs/interaction-audit-ledger.{json,md}');
}

main();
