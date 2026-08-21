import { describe, it, expect } from 'vitest';
import { resolveSupportRecipients } from '../supportRecipients';

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
