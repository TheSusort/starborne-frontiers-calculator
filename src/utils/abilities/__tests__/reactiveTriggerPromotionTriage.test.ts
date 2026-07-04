/**
 * Phase 3 reactive-trigger promotion — TRIAGE PROBE CORPUS (PR0).
 *
 * One probe per family-C ship, routed through the REAL production path (buildShipAbilities)
 * with skill text copied VERBATIM from docs/ship-skills.csv (parser source of truth).
 *
 * GREEN = the reactive effect is already correctly triggered → the sweep finding was a false
 * positive (locked here as a regression guard). RED = a real gap; the matching cluster fix-PR
 * flips it green. Red probes are INTENTIONAL and committed — a red CI is accepted until Phase 3
 * completes (no deploy before then). Each red probe carries a `// GAP:` comment naming its bucket.
 */
import { describe, it, expect } from 'vitest';
import { buildShipAbilities } from '../buildShipAbilities';
import { Ability, Skill } from '../../../types/abilities';
import { Ship } from '../../../types/ship';

function ship(over: Partial<Ship>): Ship {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { ...({} as any), refits: [{}, {}, {}, {}], ...over } as Ship;
}

function slot(skills: Skill[], name: string): Skill | undefined {
    return skills.find((s) => s.slot === name);
}

export function abilitiesFor(over: Partial<Ship>, name: string): Ability[] {
    return slot(buildShipAbilities(ship(over)).slots, name)?.abilities ?? [];
}

// Cluster describe-blocks are appended by Tasks 2–9.

describe('Phase 3 reactive-trigger triage — corpus scaffold', () => {
    it('abilitiesFor helper is available', () => {
        expect(typeof abilitiesFor).toBe('function');
    });
});
