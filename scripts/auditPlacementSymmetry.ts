/* eslint-disable no-console */
import fs from 'fs';
import path from 'path';
import {
    buildPlacementLedgerJson,
    parsePlacementArgs,
    renderPlacementLedgerMarkdown,
    type PlacementHealth,
} from './lib/placementLedger';
import { buildTraceShip } from './lib/traceShipFactory';
import { csvAvailable } from './lib/shipSkillCsv';
import { shipDataAvailable } from './lib/shipDataSnapshot';
import { corpusNames, SEED } from '../src/utils/combat/audit/kitFingerprintScenarios';
import {
    diffAllPlacements,
    fingerprintSubject,
    runCalibration,
    seedsFrom,
} from '../src/utils/combat/audit/placementSymmetry';
import { PLACEMENTS, type Placement, type PlacementDiff } from '../src/utils/combat/audit/types';
import type { CombatLogEntryKind } from '../src/utils/combat/log/types';

const LEDGER_DIR = path.join(process.cwd(), 'docs');

function main(): void {
    if (!csvAvailable() || !shipDataAvailable()) {
        console.error(
            'docs/ship-skills.csv and/or docs/ship-data.json are missing from this worktree ' +
                '(gitignored reference data) — cannot build the ship corpus.'
        );
        process.exit(1);
    }

    const args = parsePlacementArgs(process.argv.slice(2));
    const baseSeed = Number.isNaN(args.baseSeed) ? SEED : args.baseSeed;
    const seeds = seedsFrom(baseSeed, args.seeds);

    // Calibration first: a kitless ship must fingerprint identically in all three placements, or the
    // asymmetry is in the harness and no real finding can be trusted.
    console.log(`CALIBRATION: inert subjects over ${seeds.length} seed(s)...`);
    const calibration = runCalibration(seeds);
    if (calibration.length > 0) {
        console.error('CALIBRATION FAILED — an inert kit is not placement-symmetric:');
        for (const d of calibration) {
            console.error(`  ${d.shipName}: ${d.from} -> ${d.to} lost ${d.missing.join(', ')}`);
        }
        console.error('No ledger written. Fix the harness asymmetry before trusting a sweep.');
        process.exit(1);
    }
    console.log('CALIBRATION: clean');
    console.log(
        '  (caveat: the calibration subjects only ever produce {} or {attack} — this proves ' +
            'actor-id resolution for the attack pathway only. heal/shield/buff/death/charge-changed ' +
            'attribution is NOT exercised by this gate, not ruled out.)'
    );
    console.log(
        '  (caveat: RNG is actor-id-keyed and re-draws per placement, and playerTeam[0] is also the ' +
            "engine's positional heal target — see the ledger's caveat block before instrumenting a " +
            'low-ship-count or heal finding.)'
    );

    const diffs: PlacementDiff[] = [];
    const emptyByPlacement: Record<Placement, number> = { focus: 0, team: 0, enemy: 0 };
    const kindsSeen = {
        focus: new Set<CombatLogEntryKind>(),
        team: new Set<CombatLogEntryKind>(),
        enemy: new Set<CombatLogEntryKind>(),
    };
    let shipsSwept = 0;
    let symmetricShips = 0;

    for (const name of corpusNames()) {
        const subject = buildTraceShip(name);
        if (!subject) continue;
        shipsSwept++;

        const byPlacement = {} as Record<Placement, Set<CombatLogEntryKind>>;
        for (const placement of PLACEMENTS) {
            const observed = fingerprintSubject(subject, placement, seeds);
            byPlacement[placement] = observed;
            if (observed.size === 0) emptyByPlacement[placement]++;
            for (const kind of observed) kindsSeen[placement].add(kind);
        }

        const shipDiffs = diffAllPlacements(subject.name, byPlacement);
        if (shipDiffs.length === 0) symmetricShips++;
        diffs.push(...shipDiffs);

        if (shipsSwept % 25 === 0) {
            console.log(`  ...${shipsSwept} ships, ${diffs.length} findings so far`);
        }
    }

    const health: PlacementHealth = {
        shipsSwept,
        seeds: [...seeds],
        emptyByPlacement,
        kindsByPlacement: {
            focus: kindsSeen.focus.size,
            team: kindsSeen.team.size,
            enemy: kindsSeen.enemy.size,
        },
        symmetricShips,
    };

    fs.writeFileSync(
        path.join(LEDGER_DIR, 'placement-symmetry-ledger.json'),
        `${JSON.stringify(buildPlacementLedgerJson(diffs, health), null, 2)}\n`
    );
    fs.writeFileSync(
        path.join(LEDGER_DIR, 'placement-symmetry-ledger.md'),
        renderPlacementLedgerMarkdown(diffs, health)
    );

    console.log('');
    console.log(`shipsSwept:      ${shipsSwept}`);
    console.log(`symmetricShips:  ${symmetricShips}`);
    console.log(`findings:        ${diffs.length}`);
    for (const placement of PLACEMENTS) {
        console.log(
            `  ${placement}: ${health.kindsByPlacement[placement]} distinct kinds, ` +
                `${emptyByPlacement[placement]} ships observed nothing`
        );
    }
    console.log('');
    console.log('Ledger: docs/placement-symmetry-ledger.{json,md}');
    console.log('Findings are CANDIDATES — confirm each with engine instrumentation.');
}

main();
