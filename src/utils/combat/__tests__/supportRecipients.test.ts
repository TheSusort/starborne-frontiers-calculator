import { describe, it, expect } from 'vitest';
import { resolveSupportRecipients, narrowByFaction } from '../supportRecipients';
import type { FactionKey } from '../../../constants/factions';

describe('resolveSupportRecipients', () => {
    const caster = 'caster-1';

    describe('no footprint filter (legacy / non-positional)', () => {
        it('passes through base recipients unchanged', () => {
            expect(
                resolveSupportRecipients({
                    target: 'all-allies',
                    casterId: caster,
                    baseRecipients: ['a', 'b', 'c'],
                })
            ).toEqual(['a', 'b', 'c']);
        });
    });

    describe('with footprint filter', () => {
        const footprint = ['a', 'caster-1'];

        it('all-allies → intersection with footprint', () => {
            expect(
                resolveSupportRecipients({
                    target: 'all-allies',
                    casterId: caster,
                    baseRecipients: ['a', 'b', 'c'],
                    footprintAllyIds: footprint,
                })
            ).toEqual(['a']);
        });

        it('ally → intersection (whiff when the only base id is off-pattern)', () => {
            expect(
                resolveSupportRecipients({
                    target: 'ally',
                    casterId: caster,
                    baseRecipients: ['b'],
                    footprintAllyIds: footprint,
                })
            ).toEqual([]);
        });

        it('ally → base id kept when on-pattern', () => {
            expect(
                resolveSupportRecipients({
                    target: 'ally',
                    casterId: caster,
                    baseRecipients: ['a'],
                    footprintAllyIds: footprint,
                })
            ).toEqual(['a']);
        });

        it('self → caster when in footprint', () => {
            expect(
                resolveSupportRecipients({
                    target: 'self',
                    casterId: caster,
                    baseRecipients: [caster],
                    footprintAllyIds: footprint,
                })
            ).toEqual([caster]);
        });

        it('self → whiff when caster excluded (notSelf pattern)', () => {
            expect(
                resolveSupportRecipients({
                    target: 'self',
                    casterId: caster,
                    baseRecipients: [caster],
                    footprintAllyIds: ['a'],
                })
            ).toEqual([]);
        });

        it('adjacent-allies → intersection with footprint', () => {
            expect(
                resolveSupportRecipients({
                    target: 'adjacent-allies',
                    casterId: caster,
                    baseRecipients: ['a', 'b'],
                    footprintAllyIds: footprint,
                })
            ).toEqual(['a']);
        });

        it('empty footprint → whiff for all-allies', () => {
            expect(
                resolveSupportRecipients({
                    target: 'all-allies',
                    casterId: caster,
                    baseRecipients: ['a', 'b'],
                    footprintAllyIds: [],
                })
            ).toEqual([]);
        });
    });
});

// #363 (review finding 3): `narrowByFaction` is the shared helper behind ALL FOUR sites that
// apply `Ability.factionFilter` — `resolveSupportRecipients` above (site 1, the timed cast-path
// loop) plus the three sites covered end-to-end in fuyingFactionScopeSweep.test.ts (the
// passive-slot combat-start seed, the aura/accumulating registration fan-out, and the reactive
// `footprintFilteredRecipients`). Those engine-level tests prove each SITE calls this helper;
// these test the helper's OWN narrowing rules directly.
describe('narrowByFaction', () => {
    const factions: Record<string, FactionKey> = {
        a: 'TIANCHAO',
        b: 'TIANCHAO',
        c: 'XAOC',
    };
    const factionOf = (id: string): FactionKey | undefined => factions[id];

    it('intersects with the matching faction, dropping the rest', () => {
        expect(narrowByFaction(['a', 'b', 'c'], ['TIANCHAO'], factionOf)).toEqual(['a', 'b']);
    });

    it('drops an id whose faction is unknown to the reader (conservative)', () => {
        expect(narrowByFaction(['a', 'unknown'], ['TIANCHAO'], factionOf)).toEqual(['a']);
    });

    it('is inert when the filter is absent', () => {
        expect(narrowByFaction(['a', 'b', 'c'], undefined, factionOf)).toEqual(['a', 'b', 'c']);
    });

    it('treats an EMPTY filter as absent (canonical-absent convention)', () => {
        expect(narrowByFaction(['a', 'b', 'c'], [], factionOf)).toEqual(['a', 'b', 'c']);
    });

    it('matches nobody when a filter is present but no faction reader is supplied', () => {
        expect(narrowByFaction(['a', 'b'], ['TIANCHAO'], undefined)).toEqual([]);
    });
});
