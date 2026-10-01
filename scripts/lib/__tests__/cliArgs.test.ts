import { describe, it, expect } from 'vitest';
import { flagValue, parseIds } from '../cliArgs';

describe('flagValue', () => {
    it('returns null when the flag is absent', () => {
        expect(flagValue(['--file', 'a.json'], '--ids')).toBeNull();
    });

    it('returns the next token when the flag has a value', () => {
        expect(flagValue(['--file', 'a.json'], '--file')).toBe('a.json');
    });

    it('throws when the flag is the last token', () => {
        expect(() => flagValue(['--file', 'a.json', '--ids'], '--ids')).toThrow('--ids needs a value');
    });

    it('throws when the flag is immediately followed by another flag', () => {
        expect(() => flagValue(['--report', '--outcome', 'out.json'], '--report')).toThrow(
            '--report needs a value'
        );
    });
});

describe('parseIds', () => {
    it('parses a comma-separated list, trimming whitespace', () => {
        expect(parseIds('A, B')).toEqual(['A', 'B']);
    });

    it('throws when every entry is blank', () => {
        expect(() => parseIds(' , ')).toThrow();
    });

    it('keeps spaces inside an entry and names the flag it parsed in its error', () => {
        expect(parseIds('Sha Xing,Gallant', '--accept-structural')).toEqual(['Sha Xing', 'Gallant']);
        expect(() => parseIds(',', '--accept-structural')).toThrow(/^--accept-structural needs/);
    });
});
