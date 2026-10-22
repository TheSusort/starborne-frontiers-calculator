/* eslint-disable no-console */
import { parseAuditArgs } from './lib/auditArgs';
import { loadShipSkillRecords, csvAvailable } from './lib/shipSkillCsv';
import { loadShipDataByName, shipDataAvailable } from './lib/shipDataSnapshot';
import { buildTraceShip } from './lib/traceShipFactory';
import {
    formatCoverage,
    writeLedger,
    type CalibrationResidual,
    type LedgerCoverage,
} from './lib/interactionLedger';
import {
    minimizeDifferential,
    playerDifferential,
    residualHistogram,
    runCalibration,
} from './lib/interactionOracle';
import { tagShip } from '../src/utils/combat/audit/classes';
import { composeBattle, type TaggedShip } from '../src/utils/combat/audit/compose';
import { runSeededBattle } from '../src/utils/simulator/seededRuns';
import { checkInvariants } from '../src/utils/combat/audit/invariants';
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
import type { Position } from '../src/types/encounters';
import type { Ship } from '../src/types/ship';

// ---------------------------------------------------------------------------
// Corpus loading — same pattern as compose.test.ts's buildTaggedCorpus: names collected from
// BOTH the CSV and the snapshot (de-duped case-insensitively), resolved via buildTraceShip, and
// the (should-be-zero) names that resolve from neither source are dropped.
// ---------------------------------------------------------------------------

function loadTaggedCorpus(): TaggedShip[] {
    if (!csvAvailable() || !shipDataAvailable()) {
        console.error(
            'docs/ship-skills.csv and/or docs/ship-data.json are missing from this worktree ' +
                '(gitignored reference data) — cannot build the ship corpus.'
        );
        process.exit(1);
    }
    const namesByUpper = new Map<string, string>();
    for (const r of loadShipSkillRecords()) namesByUpper.set(r.name.toUpperCase(), r.name);
    for (const [upper, data] of loadShipDataByName()) {
        if (!namesByUpper.has(upper)) namesByUpper.set(upper, data.name);
    }
    const tagged: TaggedShip[] = [];
    for (const name of namesByUpper.values()) {
        const ship = buildTraceShip(name);
        if (!ship) continue;
        tagged.push({ ship, classes: tagShip(ship) });
    }
    return tagged;
}

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
    for (const offset of ABLATION_SEED_OFFSETS) {
        const result = runAblation(a.ship, b.ship, compositionSeed + offset, inertPool);
        compared += result.compared;
        if (result.diverges) {
            diverged++;
            if (!firstDetail) firstDetail = result.detail;
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
            severity: 'low',
        },
        compared,
        total,
    };
}

// ---------------------------------------------------------------------------
// Minimization
// ---------------------------------------------------------------------------

function safeRun(input: BattleSimulationInput, seed: number): BattleResult | null {
    try {
        return runSeededBattle(input, seed);
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
            return checkInvariants(result).some(
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
    const { seed, count, allowCalibrationResidual } = parseAuditArgs(process.argv.slice(2));
    if (!Number.isFinite(seed) || !Number.isFinite(count) || count <= 0) {
        console.error(
            'Usage: npm run audit:interactions -- --seed <N> --count <M> [--allow-calibration-residual]'
        );
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
    // A residual is an inert-battery diff the exclusion set did not absorb: the oracle's own
    // false-positive floor for this sample. It fails the run unless explicitly accepted; it never
    // widens the exclusion set. A crash or invariant failure always fails.
    let calibrationResidual: CalibrationResidual | undefined;
    if (!calibration.clean) {
        const residualOnly = calibration.residual.length > 0;
        if (!residualOnly || !allowCalibrationResidual) {
            console.error(`CALIBRATION FAILED: ${calibration.detail}`);
            if (residualOnly) {
                console.error(
                    'Each residual is a diff on a board with no interaction kits. Investigate it, ' +
                        'or rerun with --allow-calibration-residual to fuzz anyway and record it ' +
                        'in the ledger header.'
                );
            }
            process.exit(1);
        }
        calibrationResidual = {
            count: calibration.residual.length,
            histogram: residualHistogram(calibration.residual),
        };
        console.warn(
            `CALIBRATION RESIDUAL ACCEPTED (--allow-calibration-residual): ${calibration.detail}`
        );
    } else {
        console.log(`CALIBRATION: clean (${calibration.detail})`);
    }

    // Baseline fillers: the same inert set the calibration gate is built from, threaded
    // explicitly so the oracle and its ddmin stay a pure function of (seed, subject, pool).
    const inertPool = tagged.filter((t) => t.classes.size === 0).map((t) => t.ship);
    if (inertPool.length === 0) {
        console.error(
            'no inert ships (empty class tag set) in the corpus — cannot build baselines'
        );
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
            compResult = runSeededBattle(compInput, s);
        } catch (err) {
            findings.push(crashFinding(allNames(compInput), allPositions(compInput), s, err));
            compositionsRun++;
            continue;
        }
        compositionsRun++;

        try {
            for (const v of checkInvariants(compResult)) {
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
    const { confirmed, needsTriage } = writeLedger(
        findings,
        { compositionsRun, coverage, calibrationResidual },
        'docs'
    );
    console.log(`compositionsRun: ${compositionsRun}`);
    console.log(`differential coverage: ${formatCoverage(differential)} player placements`);
    console.log(`ablation coverage: ${formatCoverage(ablation)} subject-runs`);
    console.log(`confirmed: ${confirmed.length}`);
    console.log(`needsTriage: ${needsTriage.length}`);
    console.log('Wrote docs/interaction-audit-ledger.{json,md}');
}

main();
