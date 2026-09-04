import { describe, it, expect } from 'vitest';
import {
    FACTIONS,
    FACTION_KEYS,
    factionMatchesSearch,
    factionSpellings,
    type FactionKey,
} from '../factions';

describe('FactionKey', () => {
    it('is a literal union covering exactly the FACTIONS keys', () => {
        // A `satisfies`-checked exhaustive map: adding a faction to FACTIONS without adding it
        // here is a tsc error, which is the compile-time guard FactionName never gave us.
        const everyKey = {
            ATLAS_SYNDICATE: true,
            BINDERBURG: true,
            EVERLIVING: true,
            FRONTIER_LEGION: true,
            GELECEK: true,
            MPL: true,
            MARAUDERS: true,
            TERRAN_COMBINE: true,
            TIANCHAO: true,
            XAOC: true,
        } satisfies Record<FactionKey, true>;
        expect(Object.keys(everyKey).sort()).toEqual(Object.keys(FACTIONS).sort());
    });

    it('exposes the keys at runtime for the same set', () => {
        expect([...FACTION_KEYS].sort()).toEqual(Object.keys(FACTIONS).sort());
    });
});

describe('factionSpellings', () => {
    it('leads with the display name', () => {
        for (const key of FACTION_KEYS) {
            expect(factionSpellings(key)[0]).toBe(FACTIONS[key].name);
        }
    });

    it('carries the renamed faction under both spellings', () => {
        expect(FACTIONS.TIANCHAO.name).toBe('Tianchen'); // the display half of the rename
        expect(factionSpellings('TIANCHAO')).toEqual(['Tianchen', 'Tianchao']);
    });

    it('is just the name for a faction with no aliases', () => {
        expect(factionSpellings('XAOC')).toEqual(['XAOC']);
    });
});

describe('factionMatchesSearch', () => {
    it('finds a renamed faction by its old name as well as its new one', () => {
        expect(factionMatchesSearch('TIANCHAO', 'tianchen')).toBe(true);
        expect(factionMatchesSearch('TIANCHAO', 'Tianchao')).toBe(true);
        expect(factionMatchesSearch('TIANCHAO', 'chao')).toBe(true); // substring, like the name arm
    });

    it('does not match a different faction, or an unrecognised one', () => {
        expect(factionMatchesSearch('XAOC', 'tianchao')).toBe(false);
        expect(factionMatchesSearch('NOT_A_FACTION', 'tianchao')).toBe(false);
        expect(factionMatchesSearch(undefined, 'tianchao')).toBe(false);
    });
});
