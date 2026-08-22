import { describe, it, expect } from 'vitest';
import { FACTIONS, FACTION_KEYS, type FactionKey } from '../factions';

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
