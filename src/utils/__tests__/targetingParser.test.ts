import { describe, it, expect } from 'vitest';
import { parseTarget, parsePattern } from '../targetingParser';

describe('parseTarget', () => {
    it('maps enemy-side selections', () => {
        expect(parseTarget('front')).toEqual({ raw: 'front', side: 'enemy', selection: 'front' });
        expect(parseTarget('back')).toEqual({ raw: 'back', side: 'enemy', selection: 'back' });
        expect(parseTarget('skip')).toEqual({ raw: 'skip', side: 'enemy', selection: 'skip' });
        expect(parseTarget('all')).toEqual({ raw: 'all', side: 'enemy', selection: 'all' });
    });

    it('maps ally-side selections', () => {
        expect(parseTarget('allies')).toEqual({ raw: 'allies', side: 'ally', selection: 'team' });
        expect(parseTarget('all-allies')).toEqual({
            raw: 'all-allies',
            side: 'ally',
            selection: 'all',
        });
        expect(parseTarget('other-allies')).toEqual({
            raw: 'other-allies',
            side: 'ally',
            selection: 'others',
        });
        expect(parseTarget('self')).toEqual({ raw: 'self', side: 'ally', selection: 'self' });
    });

    it('is case/whitespace tolerant', () => {
        expect(parseTarget('  Front ')).toMatchObject({ side: 'enemy', selection: 'front' });
    });

    it('throws on unknown target', () => {
        expect(() => parseTarget('sideways')).toThrow(/unknown target/i);
    });
});

describe('parsePattern', () => {
    it('parses Pattern-Base as base / range 0', () => {
        expect(parsePattern('Pattern-Base')).toEqual({
            raw: 'Pattern-Base',
            shape: 'base',
            range: 0,
            modifiers: {},
        });
    });

    it('parses a numeric range', () => {
        expect(parsePattern('Pattern-Cone-Range-1')).toMatchObject({
            shape: 'cone',
            range: 1,
            modifiers: {},
        });
        expect(parsePattern('Pattern-Line-Range-2')).toMatchObject({
            shape: 'line',
            range: 2,
            modifiers: {},
        });
        expect(parsePattern('Pattern-Range-3')).toMatchObject({
            shape: 'range',
            range: 3,
            modifiers: {},
        });
        expect(parsePattern('Pattern-Support-Double-Pickaxe-Range-0')).toMatchObject({
            shape: 'pickaxe',
            range: 0,
        });
    });

    it('detects the support modifier (before or after the shape token)', () => {
        expect(parsePattern('Pattern-Circle-Support-Range-1').modifiers.support).toBe(true);
        expect(parsePattern('Pattern-Base-Support')).toMatchObject({
            shape: 'base',
            range: 0,
            modifiers: { support: true },
        });
        expect(parsePattern('Pattern-Support-All')).toMatchObject({
            shape: 'all',
            range: 'all',
            modifiers: { support: true },
        });
        expect(parsePattern('Pattern-All')).toMatchObject({
            shape: 'all',
            range: 'all',
            modifiers: {},
        });
    });

    it('detects whole-lane range', () => {
        expect(parsePattern('Pattern-Line-Support-whole-lane')).toMatchObject({
            shape: 'line',
            range: 'lane',
            modifiers: { support: true },
        });
    });

    it('detects prolonged + anchor modifiers', () => {
        expect(parsePattern('Pattern-Prolonged_Cone-Support-Range-2')).toMatchObject({
            shape: 'cone',
            range: 2,
            modifiers: { prolonged: true, support: true },
        });
        expect(
            parsePattern('Pattern-Prolonged_Cone-Support-Center-Range-2').modifiers
        ).toMatchObject({
            prolonged: true,
            support: true,
            anchorMod: 'center',
        });
        expect(parsePattern('Pattern-Cone-Back-Range-1').modifiers).toMatchObject({
            anchorMod: 'back',
        });
        expect(parsePattern('Pattern-Support-Forward-Circle-Range-1')).toMatchObject({
            shape: 'circle',
            modifiers: { support: true, anchorMod: 'forward' },
        });
    });

    it('does NOT treat backline as an anchor "back"', () => {
        const p = parsePattern('Pattern-Backline-Range-1');
        expect(p.shape).toBe('backline');
        expect(p.modifiers.anchorMod).toBeUndefined();
    });

    it('detects reverse / notSelf / fromCentre', () => {
        expect(parsePattern('Pattern-Reverse-Curve-Range-1')).toMatchObject({
            shape: 'curve',
            modifiers: { reverse: true },
        });
        expect(parsePattern('Pattern-Reverse-Cone-Range-1')).toMatchObject({
            shape: 'cone',
            modifiers: { reverse: true },
        });
        expect(parsePattern('Pattern-Line-Support-Not-Self-Range-2').modifiers).toMatchObject({
            support: true,
            notSelf: true,
        });
        expect(parsePattern('Pattern-Wings-Support-Not-Self-Range-2')).toMatchObject({
            shape: 'wings',
            modifiers: { support: true, notSelf: true },
        });
        expect(parsePattern('Pattern-Line-from-centre-Range-1').modifiers).toMatchObject({
            fromCentre: true,
        });
    });

    it('normalizes the "Patern" typo', () => {
        expect(parsePattern('Patern-Support-All')).toMatchObject({
            shape: 'all',
            range: 'all',
            modifiers: { support: true },
        });
    });

    it('throws on an unrecognizable shape', () => {
        expect(() => parsePattern('Pattern-Nonsense-Range-1')).toThrow(/unknown pattern shape/i);
    });
});
