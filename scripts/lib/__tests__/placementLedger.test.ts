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

    it("discloses the playerTeam[0]-is-the-heal-target caveat", () => {
        const md = renderPlacementLedgerMarkdown([diff], health);
        expect(md).toMatch(/heal target/i);
        expect(md).toContain('positionalTeamBattle');
    });
});
