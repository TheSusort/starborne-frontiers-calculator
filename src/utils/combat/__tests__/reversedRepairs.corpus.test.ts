/**
 * `Reversed Repairs` (#362) — corpus-wide scan and tripwire.
 *
 * The issue's definition of done asks for the number of ships whose skill text applies this
 * status, explicitly including the case where it's zero-besides-Zosimos. This is that count,
 * pinned as a hard assertion rather than just printed, so a future ship-data refresh that adds a
 * second applier fails loudly here instead of silently changing what the Zosimos-only fingerprint
 * re-baseline (`realKitFingerprints.test.ts`) was allowed to assume.
 *
 * Source of the roster: `docs/ship-data.json` (the gitignored harness snapshot; the old `SHIPS`
 * constant is gone — see `project_ship_kit_correctness_audit`). It carries no skill text of its
 * own, so each entry is joined against `docs/ship-skills.csv` (the skill-text source of truth,
 * per `project_skill_text_source_of_truth`) by uppercased name, mirroring
 * `shipDataSnapshot.ts#loadShipDataByName`'s own join convention.
 *
 * Two independent counting methods are cross-checked (a fixed-width/narrow grep silently
 * under-counted by two elsewhere on this branch): a full CSV-record parse (handles the six
 * ships whose passive text spans multiple physical lines) and a raw-line substring scan. Both are
 * asserted against a hard corpus (docs/ship-data.json) name filter so a stray CSV-only or
 * JSON-only name can't inflate either count.
 */
import { readFileSync } from 'fs';
import { describe, it, expect, beforeAll } from 'vitest';
import {
    csvAvailable,
    loadShipSkillRecords,
    readCsvRecords,
} from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable, loadShipDataRecords } from '../../../../scripts/lib/shipDataSnapshot';

const REVERSED_REPAIRS_TEXT = 'Reversed Repairs';

function requireReferenceData(): void {
    if (!csvAvailable() || !shipDataAvailable()) {
        throw new Error(
            'docs/ship-skills.csv and/or docs/ship-data.json are missing from this worktree ' +
                '(gitignored reference data) — the corpus scan needs both to resolve real ship ' +
                'skill text against the real ship roster.'
        );
    }
}

describe('Reversed Repairs corpus scan', () => {
    beforeAll(requireReferenceData);

    it('applies to exactly one ship in the corpus: Zosimos', () => {
        // Method 1: structured parse — join docs/ship-data.json's roster against
        // docs/ship-skills.csv's records (loadShipSkillRecords already runs the same
        // multi-line-aware CSV reader the real fingerprint harness depends on) and scan every
        // skill-text field (active, charge, and all three passives) per matched ship.
        const rosterNames = new Set(loadShipDataRecords().map((s) => s.name.toUpperCase()));
        const skillRecords = loadShipSkillRecords().filter((r) =>
            rosterNames.has(r.name.toUpperCase())
        );
        expect(skillRecords.length).toBeGreaterThan(0);

        const structuredMatches = skillRecords
            .filter((r) =>
                [r.active, r.charge, ...r.passives].some((t) => t.includes(REVERSED_REPAIRS_TEXT))
            )
            .map((r) => r.name);

        // Method 2: independent raw-line scan of the CSV, cross-checked against the same roster
        // filter. Line-anchored (not a fixed-width substring window) over the FULL record text
        // (readCsvRecords already reassembles multi-line quoted fields before this filters them),
        // so it can't silently truncate a long passive the way a fixed-width grep did elsewhere on
        // this branch.
        const rawCsv = readFileSync('docs/ship-skills.csv', 'utf8');
        const records = readCsvRecords(rawCsv).slice(1); // drop header
        const rawMatches = records
            .filter((rec) => rec.includes(REVERSED_REPAIRS_TEXT))
            .map((rec) => rec.split(',')[0].trim())
            .filter((name) => rosterNames.has(name.toUpperCase()));

        expect(structuredMatches).toStrictEqual(rawMatches);
        expect(structuredMatches).toStrictEqual(['Zosimos']);
        expect(structuredMatches).toHaveLength(1);
    });
});
