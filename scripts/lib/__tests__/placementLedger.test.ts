import { describe, it, expect } from 'vitest';
import {
    buildPlacementLedgerJson,
    parsePlacementArgs,
    renderPlacementLedgerMarkdown,
    type PlacementHealth,
} from '../placementLedger';
import type { PlacementDiff } from '../../../src/utils/combat/audit/types';
import type { CombatLogEntryKind } from '../../../src/utils/combat/log/types';

const health: PlacementHealth = {
    shipsSwept: 147,
    seeds: [1, 2],
    emptyByPlacement: { focus: 0, team: 0, enemy: 0 },
    kindsByPlacement: { focus: 21, team: 20, enemy: 19 },
    symmetricShips: 140,
};

const diff: PlacementDiff = {
    shipName: 'Sentinel',
    from: 'focus',
    to: 'enemy',
    missing: ['heal'] as CombatLogEntryKind[],
};

describe('parsePlacementArgs', () => {
    it('defaults to 5 seeds', () => {
        expect(parsePlacementArgs([]).seeds).toBe(5);
    });

    it('parses --seeds and --base-seed', () => {
        expect(parsePlacementArgs(['--seeds', '3', '--base-seed', '99'])).toEqual({
            seeds: 3,
            baseSeed: 99,
        });
    });

    it('ignores unrecognized tokens', () => {
        expect(parsePlacementArgs(['--nope', 'x']).seeds).toBe(5);
    });

    it('rejects a non-numeric --seeds, naming the offending token', () => {
        expect(() => parsePlacementArgs(['--seeds', 'abc'])).toThrow(/abc/);
    });

    it('rejects --seeds 0, naming the offending token', () => {
        expect(() => parsePlacementArgs(['--seeds', '0'])).toThrow(/0/);
    });

    it('rejects a fractional --seeds instead of silently truncating', () => {
        expect(() => parsePlacementArgs(['--seeds', '3.7'])).toThrow(/3\.7/);
    });

    it('rejects a trailing --seeds with no value', () => {
        expect(() => parsePlacementArgs(['--seeds'])).toThrow(/positive integer/);
    });

    it('rejects a negative --seeds', () => {
        expect(() => parsePlacementArgs(['--seeds', '-1'])).toThrow(/-1/);
    });

    it('rejects a non-numeric --base-seed, naming the offending token', () => {
        expect(() => parsePlacementArgs(['--base-seed', 'abc'])).toThrow(/abc/);
    });

    it('accepts a negative or zero --base-seed', () => {
        expect(parsePlacementArgs(['--base-seed', '-1']).baseSeed).toBe(-1);
        expect(parsePlacementArgs(['--base-seed', '0']).baseSeed).toBe(0);
    });
});

describe('buildPlacementLedgerJson', () => {
    it('carries the health block and the findings', () => {
        const json = buildPlacementLedgerJson([diff], health);
        expect(json.health.shipsSwept).toBe(147);
        expect(json.findings).toEqual([diff]);
        expect(json.findingCount).toBe(1);
    });
});

describe('renderPlacementLedgerMarkdown', () => {
    it('renders the health block and each finding', () => {
        const md = renderPlacementLedgerMarkdown([diff], health);
        expect(md).toContain('# Placement Symmetry Ledger');
        expect(md).toContain('Ships swept: **147**');
        expect(md).toContain('Sentinel');
        expect(md).toContain('focus');
        expect(md).toContain('heal');
    });

    it('says so explicitly when there are no findings', () => {
        const md = renderPlacementLedgerMarkdown([], health);
        expect(md).toContain('No placement asymmetries');
    });

    it('does not hardcode the CombatLogEntryKind union size in the calibration caveat', () => {
        const md = renderPlacementLedgerMarkdown([diff], health);
        expect(md).toContain('CombatLogEntryKind');
        expect(md).not.toContain('17 `CombatLogEntryKind`');
    });

    it('flags a zero-kind placement as a vacuity warning', () => {
        const md = renderPlacementLedgerMarkdown([], {
            ...health,
            emptyByPlacement: { focus: 0, team: 4, enemy: 0 },
        });
        expect(md).toMatch(/VACUITY WARNING/i);
    });

    it('discloses the actor-id-keyed RNG seed-noise caveat', () => {
        const md = renderPlacementLedgerMarkdown([diff], health);
        expect(md).toMatch(/seed noise/i);
        expect(md).toContain('--base-seed');
    });

    it('derives the seed count in the seed-noise caveat instead of hardcoding it', () => {
        const md = renderPlacementLedgerMarkdown([diff], health);
        expect(md).toContain(`K=${health.seeds.length}`);
    });

    it('does not hardcode a specific run\'s findings in the generic seed-noise caveat', () => {
        const md = renderPlacementLedgerMarkdown([diff], health);
        expect(md).not.toContain('debuff-resisted');
        expect(md).not.toContain('Belladonna');
        expect(md).not.toContain('Enforcer');
        expect(md).not.toContain('Valerian');
    });

    it("discloses the playerTeam[0]-is-the-heal-target caveat", () => {
        const md = renderPlacementLedgerMarkdown([diff], health);
        expect(md).toMatch(/heal target/i);
        expect(md).toContain('positionalTeamBattle');
    });
});
