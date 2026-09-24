import { describe, it, expect } from 'vitest';
import { basisAuthoringError } from '../basisTermDraft';
import {
    MAX_BASIS_TERMS,
    MAX_NUMBER_MAGNITUDE,
    MIN_NUMBER_MAGNITUDE,
} from '../../../schemas/sharedAutogearBuild';

// #544 I4/I5: the ONE authoring validator both basis-term editors (`OffFormulaNotice`'s applied-
// equation editor and `CustomFormulaForm`'s row basis) call before saving a draft. It is stricter
// than the scorer's own read-time gate (`usableBasisTerms`, customFormula.ts): a stored
// zero-weight term is harmless (`resolveBasisValue` SUMS the terms, so it just contributes
// nothing), but a term a player is actively typing almost always means an unfilled field, not a
// deliberate zero.
describe('basisAuthoringError', () => {
    it('accepts an empty draft — a basis is optional on a formula row', () => {
        expect(basisAuthoringError([])).toBeNull();
    });

    it('accepts a single positive term', () => {
        expect(basisAuthoringError([{ stat: 'attack', weight: '2.1' }])).toBeNull();
    });

    it('accepts a full set of terms up to the shared cap', () => {
        const terms = Array.from({ length: MAX_BASIS_TERMS }, (_, i) => ({
            stat: 'attack' as const,
            weight: String(i + 1),
        }));
        expect(basisAuthoringError(terms)).toBeNull();
    });

    it('refuses a blank weight', () => {
        expect(basisAuthoringError([{ stat: 'attack', weight: '' }])).toMatch(/weight above zero/i);
    });

    it('refuses an explicit zero weight, even next to a positive term', () => {
        // The exact gap #544 I4 closes: `usableBasisTerms` alone (weight >= 0) would keep this
        // pair and silently save the second term as a no-op x0.000.
        expect(
            basisAuthoringError([
                { stat: 'attack', weight: '2.1' },
                { stat: 'hp', weight: '0' },
            ])
        ).toMatch(/weight above zero/i);
    });

    it('refuses a negative weight', () => {
        expect(basisAuthoringError([{ stat: 'attack', weight: '-1' }])).toMatch(
            /weight above zero/i
        );
    });

    it('refuses more terms than the shared schema allows', () => {
        const terms = Array.from({ length: MAX_BASIS_TERMS + 1 }, (_, i) => ({
            stat: 'attack' as const,
            weight: String(i + 1),
        }));
        expect(basisAuthoringError(terms)).toMatch(new RegExp(`${MAX_BASIS_TERMS}`));
    });

    it('refuses a weight above the shared schema magnitude window', () => {
        expect(
            basisAuthoringError([{ stat: 'attack', weight: String(MAX_NUMBER_MAGNITUDE * 10) }])
        ).toMatch(/too large|too small/i);
    });

    it('refuses a weight below the shared schema magnitude window', () => {
        expect(
            basisAuthoringError([{ stat: 'attack', weight: String(MIN_NUMBER_MAGNITUDE / 10) }])
        ).toMatch(/too large|too small/i);
    });
});
