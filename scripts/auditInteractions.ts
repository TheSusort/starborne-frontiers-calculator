/* eslint-disable no-console */
import { parseAuditArgs } from './lib/auditArgs';
import { loadShipSkillRecords, csvAvailable } from './lib/shipSkillCsv';
import { loadShipDataByName, shipDataAvailable } from './lib/shipDataSnapshot';
import { buildTraceShip } from './lib/traceShipFactory';
import { buildInertAllyBaseline } from './lib/traceScenario';
import { writeLedger } from './lib/interactionLedger';
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

function resolveActorId(
    result: BattleResult,
    side: 'player' | 'enemy',
    position: Position
): string {
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
// Focus-vs-walked fingerprint fix (a) — HISTORY, and why the name outlived the problem. The
// engine's focus actor (playerTeam[0], reserved id 'attacker') rides richer top-level
// instrumentation than a walked ally (`p:<id>:<idx>`). Every earlier baseline took the subject's
// fingerprint as playerTeam[0] while the composition took it at whatever slot composeBattle drew,
// so the two could differ purely from instrumentation. FOCUS_ONLY_KINDS is populated by the
// calibration gate BEFORE any fuzzing: it runs the raw (unrestricted) differential across an
// inert-only battery, and since inert ships (empty class tag set) have no interaction primitives,
// ANY diff kind that shows up there is by construction harness noise, never a real behavioural
// difference. The filtering is order-independent — filtering the diff's missing/extra arrays after
// the fact is equivalent to filtering the underlying kind sets before diffing — so this stays a
// cheap post-hoc filter rather than a re-fingerprint.
//
// `buildInertAllyBaseline` RETIRES that specific asymmetry: the subject keeps its array index, so
// focus stays focus, a walked ally stays walked, and the actor id is byte-identical between the
// arms — which also stops the ownerId-keyed rate-gate RNG re-drawing every crit and landing roll.
// (Asserted end-to-end, at every player index, in
// scripts/lib/__tests__/differentialBaseline.regression.test.ts.)
//
// The exclusion set nonetheless survived recalibration under the new baseline, and by a wider
// margin than before — see the leave-one-out table below. What it is filtering is no longer an
// instrumentation or opponent artifact; it is the last remaining mechanism, RECIPIENT ATTRIBUTION,
// described in the next block. The constant keeps its historical name so the git history stays
// searchable; do not read it as a claim about which mechanism is active.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// THE BASELINE (2026-08-21) — `buildInertAllyBaseline`, not the canned `buildStandardScenario`.
// Read that function's docstring for the mechanism; what follows is the measurement, because it
// changes how the numbers further down should be read. THREE designs were built and measured, and
// the middle one is recorded here because its failure mode is the instructive part.
//
// (1) CANNED (original) — `buildStandardScenario`: three synthetic filler enemies at security 20
//     with fixed affinities and a fixed attack, two canned allies, the subject re-pinned to M4 as
//     playerTeam[0], a full 30 rounds. Four variables moved at once, so opponent variance read as
//     ally interference. Not a theory: at seed 300/count 100, SIX of its ten differentials ddmin'd
//     to a player side of exactly ONE ship — zero allies, ally interference impossible by
//     construction — and it reported one anyway. Same at seed 1/count 150: 5 of 9.
// (2) SOLO same-enemy — subject alone against the composition's own enemies. Fixed the opponent
//     confound and broke something worse: the subject lost the three bodies soaking incoming
//     attacks and died alone where it had survived in the composition. REJECTED.
// (3) INERT-ALLY (current) — same cells, same stats, same enemies, same array index, ally KITS
//     swapped for inert ships. The only variable left is the one under test.
//
// Measured across all three on identical seeds. "comparable" is placements where the subject
// survived BOTH arms; everything else is invisible to the oracle:
//
//   seed 1 / count 150      canned            solo              inert
//     comparable            37/600            10/600            155/600
//     findings              9                 2                 18
//   seed 300 / count 100
//     comparable            29/400             6/400             67/400
//     findings              10                2                 7
//   seed 1000 / count 700
//     comparable            161/2800          21/2800           691/2800
//     findings              43                7                 108
//   INERT-ONLY CALIBRATION BATTERY, seed 1 / count 40
//     comparable            4/160              2/160            52/160
//
// Read those two rows together, because the finding COUNT alone is misleading in both directions.
// Per comparable placement the inert baseline reports 15.6% (108/691) against the canned
// baseline's 26.7% (43/161) — it removes roughly 40% of the reports as confound — but it inspects
// 4.3x as many placements, so the absolute triage load goes UP, from 43 to 108 at count 700. That
// is the intended trade: the canned baseline was cheap because it was blind.
//
// The calibration gate is the sharpest of these numbers. It exists to hard-fail when a residual
// diff survives the restriction, and under the canned baseline it was reaching that verdict from
// 4 comparisons out of 160. It now reaches it from 52, and those 52 produce 17 raw diffs that the
// exclusion set filters — so the gate is now actually exercising the thing it certifies instead of
// passing because it saw nothing.
//
// Because "no diff" and "never compared" are indistinguishable in the output, both the calibration
// gate and the fuzz loop print their comparable-placement count, with an explicit VACUOUS warning
// at zero. That instrumentation is what made design (2)'s failure visible instead of silent, and
// it is the reason it never shipped.
//
// The seed-335 Makoli case is pinned as a regression in
// scripts/lib/__tests__/differentialBaseline.regression.test.ts, both arms asserted, along with
// the property the whole design turns on: the subject mints the SAME actor id in both arms at
// every player index.
// ---------------------------------------------------------------------------

// Empirically (see the Task 10 report), the dominant source of inert-battery noise turned out
// NOT to be pure actor-slot instrumentation but a broader class of "externally-driven" kinds —
// confirmed by reading buildCombatLog.ts's event→entry mapping: each of these kinds is logged
// under the RECIPIENT/VICTIM's actorId, not the caster's, so its presence reflects what OTHER
// ships in the battle did to this one, not this ship's own kit logic:
//   - 'death'/'cheat-death'   — whether incoming damage was lethal this run
//   - 'buff-expired'          — books to the RECIPIENT: no granter is tracked at expiry time, so
//                               unlike its `buff` counterpart (granter-attributed, see below)
//                               this fires whenever ANY other unit's buff on this ship runs out
//   - 'debuff-resisted'       — actorId = e.sourceId ?? e.targetId; even when this ship is the
//                               caster, "resisted or not" hinges on the TARGET's security stat
//                               and on a landing roll
//   - 'dot-ticked'/'detonation' — actorId = e.targetId (victim of someone else's DoT)
//   - 'shield-destroyed'      — actorId = e.victimId (shield broken by incoming damage)
// Seeded here so calibration doesn't depend on a single small battery happening to sample every
// one of these; the calibration gate still empirically tops this set up (and hard-fails if a
// residual diff survives even the top-up) rather than trusting the seed blindly.
//
// UPDATED for the inert-ally baseline. The mechanism these exclusions were originally justified
// by — "the canned opponents at security 20 differ from the real corpus opponents" — is GONE, and
// so are three more: both arms now face the identical enemy roster, on identical cells, with
// identical stats and turn order, and the subject holds the same array index so its actor id (and
// therefore its rate-gate RNG sub-stream) does not change. Every confound the previous two designs
// leaned on has been removed.
//
// The exclusions survive anyway, on the mechanism the ORIGINAL rationale named and nothing since
// has touched: RECIPIENT ATTRIBUTION. Each of these kinds books to the recipient/victim, so it
// reports what OTHER ships did to the subject — and swapping interacting allies for inert ones
// genuinely changes that. An ally that buffs the subject makes `buff-expired` fire on it later; an
// ally that cleanses the subject's DoT stops `dot-ticked`; an ally that shields it produces
// `shield-destroyed`. Those are ally EFFECTS ON the subject, not the subject's own kit behaving
// differently, which is what the oracle is supposed to report.
//
// RECALIBRATION, leave-one-out over the SAME battles (drop exactly one kind from the exclusion
// set, re-restrict the already-collected raw diffs, count the extra findings). Re-run on the
// inert-ally baseline at seed 1/count 150 (18 findings, 155 comparable), seed 300/count 100 (7
// findings, 67 comparable) and seed 1000/count 700 (108 findings, 691 comparable, 316 raw diffs):
//     kind              extra findings if dropped (s1c150 / s300c100 / s1000c700)   verdict
//     death                       +0 /  +0 /   +0    keep — UNREACHABLE, not cleared (see below)
//     cheat-death                 +0 /  +0 /   +1    keep — load-bearing, if only just
//     buff-expired               +44 / +11 / +137    keep — by far the largest single contributor
//     debuff-resisted            +14 /  +5 /  +48    keep
//     dot-ticked                  +9 /  +4 /  +32    keep
//     detonation                  +1 /  +0 /   +0    keep
//     shield-destroyed            +5 /  +6 /  +24    keep
//
// So the answer to "can any of them come back now that the confounds are gone" is NO — and more
// firmly than before the change, not less. Retiring the whole set would take seed 1000/count 700
// from 108 findings to 316. The one honest asterisk is `death`: `survivedWholeBattle` requires the
// subject alive at the last round of BOTH runs, so a comparable subject essentially cannot emit
// `death` at all. Its +0 means the entry is inert, not that it was tested and cleared. Removing an
// inert entry buys nothing, so it stays.
//
// This recalibration is on a much LARGER sample than the pre-change numbers below (691 comparable
// placements against 161), so unlike the earlier rounds it is not sample-starved. `buff` stays OUT
// of the set — it is granter-attributed, so a `buff` diff is the subject's own grant behaviour
// changing — but note its earlier justification ("appeared in ZERO raw diffs at count 150") is now
// stale: it appears in 20 raw diffs at seed 1000/count 700. The reason to keep it out is the
// attribution argument, not that negative.
//
// CORRECTED (review): this set is NOT superseded by the `survivedWholeBattle` guard below, nor by
// the inert-ally baseline — all three solve different problems. `survivedWholeBattle` only handles
// premature-death cascades (a ship dying early empties its whole remaining kind-set on one side).
// The inert-ally baseline only equalises everything about the two boards EXCEPT the ally kits.
// This exclusion set
// is what handles the log noise that survives both: on the REAL 148-ship corpus (not the inert-only
// calibration battery), forcing this set empty and re-running the differential oracle produces
// additional externally-driven differentials that neither of the other two catches — measured again
// AFTER the baseline change (the leave-one-out table above), not merely asserted. All three are
// necessary; none subsumes another. Excluding these kinds trades away
// differential-oracle coverage for them audit-wide — the ablation oracle is unaffected and remains
// the live signal for bugs in these areas (see the Task 10 report's "Differential sensitivity
// trade-off" concern).
//
// 'buff' WAS in this set and was REMOVED after a real-corpus recalibration (2026-08-06). It was
// excluded on the premise that `buff` entries book to the RECIPIENT, making them opponent-driven.
// That premise is dead: all four production `buff-applied` emission sites (playerTurn.ts ×3,
// engine.ts ×1) set `granterId`, and buildCombatLog books the entry to `e.granterId ?? e.actorId`,
// so in production a `buff` entry always books to the GRANTER — self-kit signal. (The `?? actorId`
// fallback is reachable only by statusEngine test fixtures that omit granterId.) Measured at seed 1
// over 40, 120 and 150 fuzzed compositions, restricting the SAME battles with vs without 'buff':
// identical finding counts every time (3/3, 6/6, 6/6), and 'buff' appeared in ZERO raw diffs. That
// negative is non-vacuous — at count 150, 31 of the 37 comparable placements DID emit `buff`
// tokens, and all 31 agreed across the solo and composition arms, so the kind is present and
// stable rather than simply absent. Confirmed end-to-end at the ledger level too: `--seed 1
// --count 40` with and without the exclusion writes a BYTE-IDENTICAL ledger.
//
// PRE-BASELINE-CHANGE numbers, kept for provenance — these were taken against the canned
// `buildStandardScenario` baseline and are NOT the current behaviour. The current equivalents are
// in the leave-one-out table above.
//
// The other seven exclusions remain load-bearing over the same corpus: dropping all of them takes
// seed 1/count 150 from 6 findings to 20. The per-kind numbers below are OCCURRENCE counts across
// those 20 raw diffs, NOT a partition of them — one diff routinely cites two excluded kinds, so
// they deliberately do not sum to 20 (all eight kinds together account for 28 mentions over the 20
// diffs). Excluded kinds: shield-destroyed ×6, buff-expired ×6, dot-ticked ×5, debuff-resisted ×3,
// detonation ×1. Non-excluded kinds, i.e. the ones that produce the 6 findings surviving
// restriction: cleanse ×5, heal ×1, debuff ×1. So this was a targeted drop, not a teardown.
//
// Scope of the evidence, stated honestly: all of the above is seed-1-rooted. `survivedWholeBattle`
// skips ~94% of placements on the real corpus (563 of 600 at count 150) because a wiped team's
// ships are dead at the trimmed last round, so the differential oracle only ever compares a few
// dozen placements per run — the sample behind ANY recalibration here is small, and that is a
// property of the oracle, not of this change.
//
// The superseded pre-change measurement (seed 1/count 5: "Aegis dot-ticked+detonation, Yuyan
// debuff-resisted, Quixilver buff+buff-expired") is retired — it was taken while `buff` was still
// recipient-attributed, and its Quixilver entry conflated `buff` with `buff-expired`, which stays
// recipient-attributed and so stays excluded. Do not cite it for either kind.
//
// KNOWN LIMITATION: the calibration gate above only ever exercises the inert-only battery (ships
// with an empty class-tag set have no interaction primitives, so any raw diff there is harness
// noise by construction). It does NOT run a "guard-only, no exclusions" configuration against the
// real corpus, so calibration passing clean is not evidence that the exclusion set could safely
// be dropped — the 6→20 regression above only shows up when actually fuzzing the real corpus,
// which calibration by design does not do. How much the gate is worth now has a number on it: it
// compares 52 of 160 placements at seed 1/count 40 (it was 4/160 under the canned baseline and
// 2/160 under the rejected solo one) and those 52 produce 17 raw diffs the exclusion set filters,
// so it is genuinely exercising what it certifies. The comparable-placement count is printed on
// every run for exactly this reason — a gate that inspected nothing used to look identical to a
// gate that passed. Note the converse also held for 'buff': calibration was
// clean both with and without it, which is exactly why dropping it required the real-corpus run
// rather than a calibration pass.
const BASE_EXCLUDED_KINDS = new Set<string>([
    'death',
    'cheat-death',
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

/** Runs the differential oracle for one PLAYER-side placement, identified by its INDEX in
 *  `compInput.playerTeam` (not by object identity — ddmin rebuilds the array, and the index is
 *  also what decides the subject's actor id): builds the baseline board via
 *  `buildInertAllyBaseline` — same cells, same stats, same enemies, ally KITS swapped for inert
 *  ones — runs it under the SAME seed, and diffs baseline vs composition, applying the
 *  FOCUS_ONLY_KINDS restriction.
 *
 *  Returns the RAW (unrestricted) diff alongside the restricted one so the calibration gate can
 *  inspect what got filtered, plus `comparable` — false when the ship died before completing
 *  either run (see `survivedWholeBattle`), in which case both diffs are null. `comparable` is NOT
 *  cosmetic: "no diff" and "never compared" are the same {null, null} to a caller that only reads
 *  the diffs, so without it a run that compared NOTHING reports exactly like a clean one. That is
 *  not hypothetical — an intermediate design that emptied the player side instead of neutering it
 *  drove the comparable rate to 21/2800 while the finding count looked reassuringly small.
 *
 *  A corollary of the baseline's shape: a composition whose player side is a single ship diffs
 *  against a BYTE-IDENTICAL battle and can never produce a finding, which is correct (no allies ⇒
 *  no ally interference) and is what stops ddmin from "minimizing" a differential down to a solo
 *  player team. */
function playerDifferential(
    subjectIndex: number,
    compInput: BattleSimulationInput,
    compResult: BattleResult,
    seed: number,
    inertPool: readonly Ship[]
): { comparable: boolean; raw: FingerprintDiff | null; restricted: FingerprintDiff | null } {
    const placement = compInput.playerTeam[subjectIndex];
    const soloInput = buildInertAllyBaseline(
        compInput.playerTeam,
        subjectIndex,
        compInput.enemyTeam,
        inertPool,
        seed,
        compInput.rounds
    );
    const soloResult = runSeededBattle(soloInput, seed);
    const soloActorId = resolveActorId(soloResult, 'player', placement.position);
    const compActorId = resolveActorId(compResult, 'player', placement.position);

    if (
        !survivedWholeBattle(soloResult, soloActorId) ||
        !survivedWholeBattle(compResult, compActorId)
    ) {
        return { comparable: false, raw: null, restricted: null };
    }

    const raw = runDifferential(
        soloResult,
        compResult,
        placement.ship.name,
        soloActorId,
        compActorId
    );
    return { comparable: true, raw, restricted: restrictDiff(raw) };
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
    /** How many placements the differential arm of the gate actually COMPARED. A clean verdict
     *  backed by zero comparisons is vacuous, not reassuring — see `playerDifferential`. */
    comparablePlacements: number;
    placementsChecked: number;
}

function runCalibration(tagged: TaggedShip[], seed: number, count: number): CalibrationResult {
    const inert = tagged.filter((t) => t.classes.size === 0);
    // The battery AND the baseline fillers come from the same inert set. Corpus order is stable
    // (loadTaggedCorpus walks a Map built from the CSV then the snapshot), so the pool order —
    // which `buildInertAllyBaseline`'s shuffle consumes — is stable too.
    const inertPool = inert.map((t) => t.ship);
    if (inert.length === 0) {
        return {
            clean: false,
            detail: 'no inert ships (empty class tag set) found in the corpus',
            comparablePlacements: 0,
            placementsChecked: 0,
        };
    }

    const invariantFailures: string[] = [];
    const reproFailures: string[] = [];
    const rawDiffs: FingerprintDiff[] = [];
    let comparablePlacements = 0;
    let placementsChecked = 0;

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
                comparablePlacements,
                placementsChecked,
            };
        }

        try {
            const invViolations = checkInvariants(compResult);
            if (invViolations.length > 0) {
                invariantFailures.push(
                    `seed ${s}: ${invViolations.map((v) => v.detail).join('; ')}`
                );
            }
            const repro = checkReproducibility(compInput, s);
            if (repro.length > 0) {
                reproFailures.push(`seed ${s}: ${repro.map((v) => v.detail).join('; ')}`);
            }
            for (let idx = 0; idx < compInput.playerTeam.length; idx++) {
                const { comparable, raw } = playerDifferential(
                    idx,
                    compInput,
                    compResult,
                    s,
                    inertPool
                );
                placementsChecked++;
                if (comparable) comparablePlacements++;
                if (raw) rawDiffs.push(raw);
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return {
                clean: false,
                detail: `engine crash while checking an INERT composition (seed ${s}) — no documented fix applies to this, it's a real bug: ${message}`,
                comparablePlacements,
                placementsChecked,
            };
        }
    }

    // Invariant/reproducibility violations on an INERT battery are real harness bugs — no
    // documented fix applies to these, so they hard-fail calibration outright.
    if (invariantFailures.length > 0 || reproFailures.length > 0) {
        return {
            clean: false,
            detail: [...invariantFailures, ...reproFailures].join(' | '),
            comparablePlacements,
            placementsChecked,
        };
    }

    if (rawDiffs.length === 0) {
        return {
            clean: true,
            detail: 'no fix needed — inert battery produced zero raw findings',
            comparablePlacements,
            placementsChecked,
        };
    }

    // Fix (a): apply the seeded BASE_EXCLUDED_KINDS restriction first.
    FOCUS_ONLY_KINDS = new Set(BASE_EXCLUDED_KINDS);
    let stillFailing = rawDiffs.filter((d) => restrictDiff(d) !== null);
    if (stillFailing.length === 0) {
        return {
            clean: true,
            detail: `fix (a) applied — base externally-driven-kind exclusion: [${[...BASE_EXCLUDED_KINDS].join(', ')}]`,
            comparablePlacements,
            placementsChecked,
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
            comparablePlacements,
            placementsChecked,
        };
    }

    return {
        clean: true,
        detail: `fix (a) applied — base set + empirical top-up excluded: [${[...FOCUS_ONLY_KINDS].join(', ')}]`,
        comparablePlacements,
        placementsChecked,
    };
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

function minimizeDifferential(
    input: BattleSimulationInput,
    placementShipId: string,
    seed: number,
    inertPool: readonly Ship[]
) {
    const stillFails = (candidate: BattleSimulationInput): boolean => {
        try {
            // Re-resolved per candidate BY INDEX: ddmin drops placements, so the subject's index
            // moves, and the index is what `buildInertAllyBaseline` and the engine's actor-id
            // minting both key on.
            const idx = candidate.playerTeam.findIndex((p) => p.ship.id === placementShipId);
            if (idx < 0) return false;
            const compResult = safeRun(candidate, seed);
            if (!compResult) return false;
            const { restricted } = playerDifferential(idx, candidate, compResult, seed, inertPool);
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
    console.log(
        `CALIBRATION differential coverage: ${calibration.comparablePlacements}/` +
            `${calibration.placementsChecked} placements were comparable` +
            (calibration.comparablePlacements === 0
                ? ' — VACUOUS: the gate compared nothing, so "clean" says nothing about the ' +
                  'exclusion set. Raise --count.'
                : '')
    );

    // Baseline fillers: the same inert set the calibration gate is built from. Derived once and
    // threaded explicitly rather than held in module state — the draw must be a pure function of
    // (seed, subject, pool) for the oracle and its ddmin to stay reproducible.
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
    // Differential-oracle coverage, printed alongside the finding counts. A low differential
    // finding count is only good news if the oracle actually compared something: the
    // survived-the-whole-battle guard still skips most placements, because a wiped team's ships
    // are dead at the trimmed last round. Roughly a quarter of placements are comparable under the
    // inert-ally baseline (691/2800 at seed 1000/count 700) against a twentieth under the canned
    // one (161/2800), so this number is also the headline evidence for the baseline design.
    let differentialPlacements = 0;
    let differentialComparable = 0;

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
                const { comparable, restricted } = playerDifferential(
                    idx,
                    compInput,
                    compResult,
                    s,
                    inertPool
                );
                differentialPlacements++;
                if (comparable) differentialComparable++;
                if (!restricted) continue;
                const min = minimizeDifferential(compInput, placement.ship.id, s, inertPool);
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
                findings.push(
                    crashFinding([a.ship.name, b.ship.name], [a.position, b.position], s, err)
                );
            }
        }
    }

    const { confirmed, needsTriage } = writeLedger(findings, { compositionsRun }, 'docs');
    console.log(`compositionsRun: ${compositionsRun}`);
    console.log(
        `differential coverage: ${differentialComparable}/${differentialPlacements} ` +
            'player placements comparable (the rest were skipped by survivedWholeBattle)'
    );
    console.log(`confirmed: ${confirmed.length}`);
    console.log(`needsTriage: ${needsTriage.length}`);
    console.log('Wrote docs/interaction-audit-ledger.{json,md}');
}

main();
