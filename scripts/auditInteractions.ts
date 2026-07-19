/* eslint-disable no-console */
import { parseAuditArgs } from './lib/auditArgs';
import { loadShipSkillRecords, csvAvailable } from './lib/shipSkillCsv';
import { loadShipDataByName, shipDataAvailable } from './lib/shipDataSnapshot';
import { buildTraceShip } from './lib/traceShipFactory';
import { buildStandardScenario } from './lib/traceScenario';
import { writeLedger, buildLedgerJson } from './lib/interactionLedger';
import { tagShip } from '../src/utils/combat/audit/classes';
import { composeBattle, type TaggedShip } from '../src/utils/combat/audit/compose';
import { runSeededBattle } from '../src/utils/combat/audit/seededBattle';
import { checkInvariants } from '../src/utils/combat/audit/invariants';
import { checkReproducibility } from '../src/utils/combat/audit/reproducibility';
import { runDifferential } from '../src/utils/combat/audit/fingerprint';
import { runAblation } from '../src/utils/combat/audit/ablation';
import { minimizeComposition } from '../src/utils/combat/audit/minimize';
import type { Finding, FingerprintDiff, InvariantViolation } from '../src/utils/combat/audit/types';
import type {
    BattlePlacement,
    BattleResult,
    BattleSimulationInput,
} from '../src/utils/calculators/battleSimulator';
import type { Position } from '../src/types/encounters';

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

function resolveActorId(result: BattleResult, side: 'player' | 'enemy', position: Position): string {
    const entry = result.roster.find((r) => r.side === side && r.position === position);
    if (!entry) {
        throw new Error(`could not resolve actorId for ${side}@${position} in the roster`);
    }
    return entry.actorId;
}

function rosterName(result: BattleResult, actorId: string | undefined): string | undefined {
    if (!actorId) return undefined;
    return result.roster.find((r) => r.actorId === actorId)?.name;
}

function rosterPosition(result: BattleResult, actorId: string | undefined): Position | undefined {
    if (!actorId) return undefined;
    return result.roster.find((r) => r.actorId === actorId)?.position;
}

// ---------------------------------------------------------------------------
// Focus-vs-walked fingerprint fix (a): the engine's focus actor (playerTeam[0], reserved id
// 'attacker') rides richer top-level instrumentation than a walked ally (`p:<id>:<idx>`), so a
// ship's solo fingerprint (always as focus, via buildStandardScenario) vs its composition
// fingerprint (as whichever slot composeBattle drew it into) can differ purely from
// instrumentation, not real interference. FOCUS_ONLY_KINDS is populated by the calibration gate
// BEFORE any fuzzing: it runs the raw (unrestricted) differential across an inert-only battery,
// and since inert ships (empty class tag set) have no interaction primitives, ANY diff kind that
// shows up there is by construction harness noise, never a real behavioural difference. The
// filtering is order-independent — filtering the diff's missing/extra arrays after the fact is
// equivalent to filtering the underlying kind sets before diffing — so this stays a cheap
// post-hoc filter rather than a re-fingerprint.
// ---------------------------------------------------------------------------

// Empirically (see the Task 10 report), the dominant source of inert-battery noise turned out
// NOT to be pure actor-slot instrumentation but a broader class of "externally-driven" kinds —
// confirmed by reading buildCombatLog.ts's event→entry mapping: each of these kinds is logged
// under the RECIPIENT/VICTIM's actorId, not the caster's, so its presence reflects what OTHER
// ships in the battle did to this one (which necessarily differs between the canned
// buildStandardScenario opponents and composeBattle's real random-corpus opponents), not this
// ship's own kit logic:
//   - 'death'/'cheat-death'   — whether incoming damage was lethal this run (opponent power)
//   - 'buff'/'buff-expired'   — buff-applied's actorId is the RECIPIENT (types/abilities.ts:
//                               "opposing-scoped on actorId — the buff RECIPIENT"), so this
//                               fires whenever ANY other unit buffs/heals this one
//   - 'debuff-resisted'       — actorId = e.sourceId ?? e.targetId; even when this ship is the
//                               caster, "resisted or not" hinges on the TARGET's security stat,
//                               which varies hugely between canned (security 20) and real corpus
//                               opponents
//   - 'dot-ticked'/'detonation' — actorId = e.targetId (victim of someone else's DoT)
//   - 'shield-destroyed'      — actorId = e.victimId (shield broken by incoming damage)
// Seeded here so calibration doesn't depend on a single small battery happening to sample every
// one of these; the calibration gate still empirically tops this set up (and hard-fails if a
// residual diff survives even the top-up) rather than trusting the seed blindly.
//
// CORRECTED (review): this set is NOT superseded by the `survivedWholeBattle` guard below and is
// NOT dead weight — the two fixes solve different problems. `survivedWholeBattle` only handles
// premature-death cascades (a ship dying early empties its whole remaining kind-set on one side).
// This exclusion set is what handles opponent-driven log noise: on the REAL 148-ship corpus
// (not the inert-only calibration battery), forcing this set empty and re-running the
// differential oracle at seed 1/count 5 produces 3 additional opponent-noise differentials that
// the guard does NOT catch (Aegis dot-ticked+detonation, Yuyan debuff-resisted, Quixilver
// buff+buff-expired — verified empirically). Both fixes are necessary; neither subsumes the
// other. Excluding these kinds trades away differential-oracle coverage for them audit-wide —
// the ablation oracle is unaffected and remains the live signal for bugs in these areas (see the
// Task 10 report's "Differential sensitivity trade-off" concern).
//
// KNOWN LIMITATION: the calibration gate above only ever exercises the inert-only battery (ships
// with an empty class-tag set have no interaction primitives, so any raw diff there is harness
// noise by construction). It does NOT run a "guard-only, no exclusions" configuration against the
// real corpus, so calibration passing clean is not evidence that the exclusion set could safely
// be dropped — the 3-differential regression above only shows up when actually fuzzing the real
// corpus, which calibration by design does not do.
const BASE_EXCLUDED_KINDS = new Set<string>([
    'death',
    'cheat-death',
    'buff',
    'buff-expired',
    'debuff-resisted',
    'dot-ticked',
    'detonation',
    'shield-destroyed',
]);

// Module-level mutable state, ordering invariant: calibration MUST run before any restrictDiff
// call — this single-shot synchronous CLI guarantees that via main()'s sequencing (runCalibration()
// is invoked, and completes, before the fuzz loop that calls playerDifferential()/restrictDiff()
// begins). Do not read this before runCalibration() in any refactor.
let FOCUS_ONLY_KINDS = new Set<string>(BASE_EXCLUDED_KINDS);

function restrictDiff(raw: FingerprintDiff | null): FingerprintDiff | null {
    if (!raw) return null;
    const missing = raw.missingInComposition.filter((k) => !FOCUS_ONLY_KINDS.has(k));
    const extra = raw.extraInComposition.filter((k) => !FOCUS_ONLY_KINDS.has(k));
    if (missing.length === 0 && extra.length === 0) return null;
    return { ...raw, missingInComposition: missing, extraInComposition: extra };
}

/** True iff `actorId` is still alive at the LAST simulated round of `result`. A ship that dies
 *  partway through either the solo or the composition run confounds EVERY downstream kind (it
 *  simply never gets the turns to cast whatever it would have cast) — not just 'death' itself —
 *  so this is a broader, root-cause guard alongside FOCUS_ONLY_KINDS rather than a duplicate of
 *  it: excluding the 'death' kind alone does not stop a premature death from silently emptying
 *  out a ship's 'attack'/'debuff'/etc. kind-set on whichever side it died in. */
function survivedWholeBattle(result: BattleResult, actorId: string): boolean {
    const rounds = result.rounds;
    if (rounds.length === 0) return true; // degenerate result — don't block on it
    const last = rounds[rounds.length - 1];
    return last.ships.find((s) => s.actorId === actorId)?.alive ?? false;
}

/** Runs the differential oracle for one PLAYER-side placement: builds its standard solo
 *  scenario, runs it under the SAME seed, and diffs solo-as-focus vs its composition slot,
 *  applying the FOCUS_ONLY_KINDS restriction. Returns the RAW (unrestricted) diff alongside the
 *  restricted one so the calibration gate can inspect what got filtered. Returns {null, null}
 *  (not comparable) when the ship died before completing either run — see
 *  `survivedWholeBattle`. */
function playerDifferential(
    placement: BattlePlacement,
    compResult: BattleResult,
    seed: number
): { raw: FingerprintDiff | null; restricted: FingerprintDiff | null } {
    const soloInput = buildStandardScenario(placement.ship);
    const soloResult = runSeededBattle(soloInput, seed);
    const soloActorId = resolveActorId(soloResult, 'player', 'M4');
    const compActorId = resolveActorId(compResult, 'player', placement.position);

    if (
        !survivedWholeBattle(soloResult, soloActorId) ||
        !survivedWholeBattle(compResult, compActorId)
    ) {
        return { raw: null, restricted: null };
    }

    const raw = runDifferential(soloResult, compResult, placement.ship.name, soloActorId, compActorId);
    return { raw, restricted: restrictDiff(raw) };
}

// ---------------------------------------------------------------------------
// Calibration gate (Wave-0): runs BEFORE any fuzzing. A battery of `count` compositions built
// from ONLY inert ships (empty class tag set) must produce zero invariant/reproducibility/
// differential findings. Any raw differential noise observed here is, by construction, harness
// asymmetry (see FOCUS_ONLY_KINDS above) — this discovers the offending kinds directly from the
// data, applies the restriction, and re-verifies the SAME battery comes back clean before
// trusting FOCUS_ONLY_KINDS for the real fuzz run.
// ---------------------------------------------------------------------------

interface CalibrationResult {
    clean: boolean;
    detail: string;
}

function runCalibration(tagged: TaggedShip[], seed: number, count: number): CalibrationResult {
    const inert = tagged.filter((t) => t.classes.size === 0);
    if (inert.length === 0) {
        return { clean: false, detail: 'no inert ships (empty class tag set) found in the corpus' };
    }

    const invariantFailures: string[] = [];
    const reproFailures: string[] = [];
    const rawDiffs: FingerprintDiff[] = [];

    for (let i = 0; i < count; i++) {
        const s = seed + i;
        let compInput: BattleSimulationInput;
        let compResult: BattleResult;
        try {
            compInput = composeBattle(s, inert);
            compResult = runSeededBattle(compInput, s);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return {
                clean: false,
                detail: `engine crash on an INERT composition (seed ${s}) — no documented fix applies to this, it's a real bug: ${message}`,
            };
        }

        try {
            const invViolations = checkInvariants(compResult);
            if (invViolations.length > 0) {
                invariantFailures.push(`seed ${s}: ${invViolations.map((v) => v.detail).join('; ')}`);
            }
            const repro = checkReproducibility(compInput, s);
            if (repro.length > 0) {
                reproFailures.push(`seed ${s}: ${repro.map((v) => v.detail).join('; ')}`);
            }
            for (const placement of compInput.playerTeam) {
                const { raw } = playerDifferential(placement, compResult, s);
                if (raw) rawDiffs.push(raw);
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return {
                clean: false,
                detail: `engine crash while checking an INERT composition (seed ${s}) — no documented fix applies to this, it's a real bug: ${message}`,
            };
        }
    }

    // Invariant/reproducibility violations on an INERT battery are real harness bugs — no
    // documented fix applies to these, so they hard-fail calibration outright.
    if (invariantFailures.length > 0 || reproFailures.length > 0) {
        return {
            clean: false,
            detail: [...invariantFailures, ...reproFailures].join(' | '),
        };
    }

    if (rawDiffs.length === 0) {
        return { clean: true, detail: 'no fix needed — inert battery produced zero raw findings' };
    }

    // Fix (a): apply the seeded BASE_EXCLUDED_KINDS restriction first.
    FOCUS_ONLY_KINDS = new Set(BASE_EXCLUDED_KINDS);
    let stillFailing = rawDiffs.filter((d) => restrictDiff(d) !== null);
    if (stillFailing.length === 0) {
        return {
            clean: true,
            detail: `fix (a) applied — base externally-driven-kind exclusion: [${[...BASE_EXCLUDED_KINDS].join(', ')}]`,
        };
    }

    // Base set wasn't enough for this battery — top up empirically from the residual diffs and
    // re-verify once. This keeps the exclusion set from being silently incomplete for a battery
    // that happens to exercise a kind the base set didn't anticipate.
    const topUp = new Set<string>();
    for (const d of stillFailing) {
        d.missingInComposition.forEach((k) => topUp.add(k));
        d.extraInComposition.forEach((k) => topUp.add(k));
    }
    FOCUS_ONLY_KINDS = new Set([...BASE_EXCLUDED_KINDS, ...topUp]);
    stillFailing = rawDiffs.filter((d) => restrictDiff(d) !== null);
    if (stillFailing.length > 0) {
        return {
            clean: false,
            detail:
                `fix (a) insufficient even after empirical top-up — ${stillFailing.length} ` +
                `inert differential(s) survive restriction: ${JSON.stringify(stillFailing[0])}`,
        };
    }

    return {
        clean: true,
        detail: `fix (a) applied — base set + empirical top-up excluded: [${[...FOCUS_ONLY_KINDS].join(', ')}]`,
    };
}

// ---------------------------------------------------------------------------
// Finding construction helpers
// ---------------------------------------------------------------------------

function invariantFinding(
    v: InvariantViolation,
    compResult: BattleResult,
    seed: number
): Finding {
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
// `diverges` seed-sensitive — see ablation.test.ts / Task 6). Keeps the pair count small (top 2
// by shared-class intersection size) so runtime stays sane.
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
    compositionSeed: number
): Finding | null {
    let diverged = 0;
    let firstDetail = '';
    for (const offset of ABLATION_SEED_OFFSETS) {
        const s = compositionSeed + offset;
        const result = runAblation(a.ship, b.ship, s);
        if (result.diverges) {
            diverged++;
            if (!firstDetail) firstDetail = result.detail;
        }
    }
    if (diverged === 0) return null;
    return {
        oracle: 'ablation',
        ships: [a.ship.name, b.ship.name],
        slots: [a.position, b.position],
        seed: compositionSeed,
        ablationDetail: `${diverged}/${ABLATION_SEED_OFFSETS.length} seeds diverged; sample: ${firstDetail}`,
        severity: 'low',
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
                (x) => x.invariant === v.invariant && (v.actorId === undefined || x.actorId === v.actorId)
            );
        } catch {
            return false;
        }
    };
    return minimizeComposition(input, stillFails);
}

function minimizeDifferential(input: BattleSimulationInput, placementShipId: string, seed: number) {
    const stillFails = (candidate: BattleSimulationInput): boolean => {
        try {
            const placement = candidate.playerTeam.find((p) => p.ship.id === placementShipId);
            if (!placement) return false;
            const compResult = safeRun(candidate, seed);
            if (!compResult) return false;
            const { restricted } = playerDifferential(placement, compResult, seed);
            return restricted !== null;
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
// Engine-crash safety: this is a fuzzer over a real, hand-written combat engine — Task 10's own
// dry run (seed 200/count 40) surfaced a genuine engine crash (`reduceBombsOnVictim` reading
// `.countdown` off `undefined` on a composed bomb-DoT interaction, thrown from deep inside
// `runAblation`/`simulateBattle`). A crash on one composition/pair must not abort the whole
// batch and lose every finding collected so far — it IS a finding (arguably the highest-value
// kind), so it gets recorded as a high-severity 'invariant' Finding and the loop moves on.
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

    const calibration = runCalibration(tagged, seed, count);
    if (!calibration.clean) {
        console.error(`CALIBRATION FAILED: ${calibration.detail}`);
        process.exit(1);
    }
    console.log(`CALIBRATION: clean (${calibration.detail})`);

    const shipClassesById = new Map(tagged.map((t) => [t.ship.id, t.classes] as const));
    const findings: Finding[] = [];
    let compositionsRun = 0;

    for (let i = 0; i < count; i++) {
        const s = seed + i;

        let compInput: BattleSimulationInput;
        let compResult: BattleResult;
        try {
            compInput = composeBattle(s, tagged);
            compResult = runSeededBattle(compInput, s);
        } catch (err) {
            findings.push(crashFinding([], [], s, err));
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

        for (const placement of compInput.playerTeam) {
            try {
                const { restricted } = playerDifferential(placement, compResult, s);
                if (!restricted) continue;
                const min = minimizeDifferential(compInput, placement.ship.id, s);
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
                const finding = ablationFinding(a, b, s);
                if (finding) findings.push(finding);
            } catch (err) {
                findings.push(crashFinding([a.ship.name, b.ship.name], [a.position, b.position], s, err));
            }
        }
    }

    writeLedger(findings, { compositionsRun }, 'docs');
    const { confirmed, needsTriage } = buildLedgerJson(findings, { compositionsRun });
    console.log(`compositionsRun: ${compositionsRun}`);
    console.log(`confirmed: ${confirmed.length}`);
    console.log(`needsTriage: ${needsTriage.length}`);
    console.log('Wrote docs/interaction-audit-ledger.{json,md}');
}

main();
