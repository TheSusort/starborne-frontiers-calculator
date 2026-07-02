import { describe, it, expect } from 'vitest';
import { parseSquadLeaderSelection } from '../squadLeaderSelection';

describe('parseSquadLeaderSelection', () => {
    it('accepts a stored selection that matches the SQUAD_LEADERS data', () => {
        const raw = JSON.stringify({ faction: 'MARAUDERS', name: 'Brandisher', stage: 3 });
        expect(parseSquadLeaderSelection(raw)).toEqual({
            faction: 'MARAUDERS',
            name: 'Brandisher',
            stage: 3,
        });
    });

    it.each([1, 2, 3] as const)('accepts stage %i', (stage) => {
        const raw = JSON.stringify({ faction: 'ATLAS_SYNDICATE', name: 'Intern', stage });
        expect(parseSquadLeaderSelection(raw)?.stage).toBe(stage);
    });

    it('rejects null and empty input', () => {
        expect(parseSquadLeaderSelection(null)).toBeUndefined();
        expect(parseSquadLeaderSelection('')).toBeUndefined();
    });

    it('rejects malformed JSON', () => {
        expect(parseSquadLeaderSelection('{not json')).toBeUndefined();
    });

    it('rejects non-object values', () => {
        expect(parseSquadLeaderSelection(JSON.stringify('MARAUDERS'))).toBeUndefined();
        expect(parseSquadLeaderSelection(JSON.stringify(null))).toBeUndefined();
        expect(parseSquadLeaderSelection(JSON.stringify(42))).toBeUndefined();
    });

    it('rejects an unknown faction', () => {
        const raw = JSON.stringify({ faction: 'NOT_A_FACTION', name: 'Brandisher', stage: 3 });
        expect(parseSquadLeaderSelection(raw)).toBeUndefined();
    });

    it('rejects a leader name that does not belong to the faction', () => {
        // Brandisher is a Marauders leader, not Atlas Syndicate.
        const raw = JSON.stringify({ faction: 'ATLAS_SYNDICATE', name: 'Brandisher', stage: 3 });
        expect(parseSquadLeaderSelection(raw)).toBeUndefined();
    });

    it('rejects out-of-range or non-numeric stages', () => {
        for (const stage of [0, 4, -1, 1.5, '2', null, undefined]) {
            const raw = JSON.stringify({ faction: 'MARAUDERS', name: 'Brandisher', stage });
            expect(parseSquadLeaderSelection(raw)).toBeUndefined();
        }
    });

    it('rejects missing fields', () => {
        expect(parseSquadLeaderSelection(JSON.stringify({}))).toBeUndefined();
        expect(
            parseSquadLeaderSelection(JSON.stringify({ faction: 'MARAUDERS', stage: 1 }))
        ).toBeUndefined();
        expect(
            parseSquadLeaderSelection(JSON.stringify({ name: 'Brandisher', stage: 1 }))
        ).toBeUndefined();
    });
});
