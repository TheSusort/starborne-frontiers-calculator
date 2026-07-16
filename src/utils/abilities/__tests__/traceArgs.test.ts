import { describe, it, expect } from 'vitest';
import { parseTraceArgs } from '../../../../scripts/lib/traceArgs';

describe('parseTraceArgs', () => {
    it('parses --all with no names or overrides', () => {
        expect(parseTraceArgs(['--all'])).toEqual({
            all: true,
            names: [],
            overrides: {},
        });
    });

    it('parses bare ship name tokens with no overrides', () => {
        expect(parseTraceArgs(['Aegis', 'Akula'])).toEqual({
            all: false,
            names: ['Aegis', 'Akula'],
            overrides: {},
        });
    });

    it('parses a full set of scenario-override flags alongside a ship name', () => {
        expect(
            parseTraceArgs([
                'Centurion',
                '--hp-scale',
                '0.1',
                '--crit',
                '100',
                '--fragile-ally',
                '--refit',
                '2',
                '--out-suffix',
                'lowhp',
            ])
        ).toEqual({
            all: false,
            names: ['Centurion'],
            overrides: {
                reviewedHpScale: 0.1,
                reviewedCrit: 100,
                includeFragileAlly: true,
                refitLevel: 2,
            },
            outSuffix: 'lowhp',
        });
    });
});
