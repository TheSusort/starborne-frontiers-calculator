import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { PERCENTAGE_ONLY_STATS } from '../../../types/stats';
import type { Stat } from '../../../types/stats';
import {
    decodeGearStats,
    encodeGearStats,
    tryDecodeGearStats,
    tryEncodeGearStats,
} from '../statsCodec';

const flat = (name: string, value: number): Stat => ({ name, value, type: 'flat' }) as Stat;
const pct = (name: string, value: number): Stat => ({ name, value, type: 'percentage' }) as Stat;

describe('encodeGearStats', () => {
    it('writes the main stat into slot 0 and substats after it', () => {
        expect(
            encodeGearStats({
                mainStat: flat('attack', 60),
                subStats: [flat('hacking', 6), flat('speed', 3), pct('crit', 6)],
            })
        ).toEqual(['a60', 'k6', 's3', 'C6']);
    });

    it('reserves slot 0 with an empty string when there is no main stat', () => {
        expect(encodeGearStats({ mainStat: null, subStats: [flat('hacking', 7)] })).toEqual([
            '',
            'k7',
        ]);
    });

    it('keeps slot 0 alone when there are no substats', () => {
        expect(encodeGearStats({ mainStat: flat('attack', 60), subStats: [] })).toEqual(['a60']);
    });

    it('encodes an empty piece as a single empty slot', () => {
        expect(encodeGearStats({ mainStat: null, subStats: [] })).toEqual(['']);
    });

    it('distinguishes a piece with no main stat from one with a main stat', () => {
        const noMain = encodeGearStats({
            mainStat: null,
            subStats: [flat('hacking', 6), flat('speed', 3)],
        });
        const withMain = encodeGearStats({
            mainStat: flat('hacking', 6),
            subStats: [flat('speed', 3)],
        });
        expect(noMain).not.toEqual(withMain);
        expect(decodeGearStats(noMain).mainStat).toBeNull();
        expect(decodeGearStats(withMain).mainStat).toEqual(flat('hacking', 6));
    });

    it('uses case for the type: uppercase percentage, lowercase flat', () => {
        expect(encodeGearStats({ mainStat: pct('attack', 12), subStats: [] })).toEqual(['A12']);
        expect(encodeGearStats({ mainStat: flat('attack', 12), subStats: [] })).toEqual(['a12']);
    });

    it('covers every name in the StatName union', () => {
        const names = [
            ...PERCENTAGE_ONLY_STATS,
            'hp',
            'attack',
            'defence',
            'speed',
            'hacking',
            'security',
        ];
        for (const name of names) {
            expect(() => encodeGearStats({ mainStat: pct(name, 1), subStats: [] })).not.toThrow();
        }
    });

    it('throws on a stat name outside the union rather than writing undefined', () => {
        expect(() => encodeGearStats({ mainStat: pct('effectiveHp', 5), subStats: [] })).toThrow(
            /effectiveHp/
        );
    });

    // Only 20 of the 28 (symbol, case) combinations are legal: a percentage-only
    // stat has no flat form, and encode must refuse rather than quietly emit a
    // symbol whose decode would later reject.
    it.each([...PERCENTAGE_ONLY_STATS])('refuses %s marked as flat', (name) => {
        expect(() => encodeGearStats({ mainStat: flat(name, 5), subStats: [] })).toThrow(
            /percentage/i
        );
    });

    // The writer sites this replaces defaulted a missing type to 'flat', so
    // stats from older local data can arrive without one. Encoding must not
    // throw on them: a flexible stat still reads flat, and a percentage-only
    // stat takes the only type it can legally have.
    it('treats a missing type on a flexible stat as flat', () => {
        const stat = { name: 'attack', value: 12 } as unknown as Stat;
        expect(encodeGearStats({ mainStat: stat, subStats: [] })).toEqual(['a12']);
    });

    it.each([...PERCENTAGE_ONLY_STATS])('treats a missing type on %s as percentage', (name) => {
        const stat = { name, value: 12 } as unknown as Stat;
        expect(() => encodeGearStats({ mainStat: stat, subStats: [] })).not.toThrow();
        expect(decodeGearStats(encodeGearStats({ mainStat: stat, subStats: [] })).mainStat).toEqual(
            pct(name, 12)
        );
    });
});

describe('decodeGearStats', () => {
    it('reads the compact shape', () => {
        expect(decodeGearStats(['a60', 'k6', 's3', 'C6'])).toEqual({
            mainStat: flat('attack', 60),
            subStats: [flat('hacking', 6), flat('speed', 3), pct('crit', 6)],
        });
    });

    it('reads an empty slot 0 as no main stat', () => {
        expect(decodeGearStats(['', 'k7'])).toEqual({
            mainStat: null,
            subStats: [flat('hacking', 7)],
        });
    });

    it('reads the legacy long-form shape', () => {
        expect(
            decodeGearStats({
                mainStat: { name: 'attack', type: 'flat', value: 60 },
                subStats: [{ name: 'crit', type: 'percentage', value: 6 }],
            })
        ).toEqual({ mainStat: flat('attack', 60), subStats: [pct('crit', 6)] });
    });

    it('reads a legacy row with a null main stat', () => {
        expect(decodeGearStats({ mainStat: null, subStats: [] })).toEqual({
            mainStat: null,
            subStats: [],
        });
    });

    it.each([[null], [undefined], [{}]])('reads %s as an empty piece', (wire) => {
        expect(decodeGearStats(wire)).toEqual({ mainStat: null, subStats: [] });
    });

    it('throws on an unmapped symbol instead of returning undefined', () => {
        expect(() => decodeGearStats(['q60'])).toThrow(/q/);
    });

    it('throws when the value is not a number', () => {
        expect(() => decodeGearStats(['aabc'])).toThrow(/value/i);
    });

    // The name decides the type wherever the name already determines it, so a
    // case fold cannot turn crit into a flat stat.
    it.each([...PERCENTAGE_ONLY_STATS])('resolves %s to percentage whatever the case', (name) => {
        const [cell] = encodeGearStats({ mainStat: pct(name, 9), subStats: [] });
        const folded = cell.toLowerCase();
        expect(decodeGearStats([folded]).mainStat).toEqual(pct(name, 9));
    });

    it('parses a multi-digit value', () => {
        expect(decodeGearStats(['h1234']).mainStat).toEqual(flat('hp', 1234));
    });
});

describe('non-finite values', () => {
    // The module contract is that encode never emits a cell decode would reject.
    // `${NaN}` would produce "aNaN", which decode throws on, so the value is
    // refused at the write instead.
    it.each([[NaN], [Infinity], [-Infinity]])('refuses a value of %s at encode time', (value) => {
        expect(() => encodeGearStats({ mainStat: flat('attack', value), subStats: [] })).toThrow(
            /value/i
        );
    });

    it('refuses a non-finite substat too', () => {
        expect(() =>
            encodeGearStats({ mainStat: flat('attack', 60), subStats: [flat('speed', NaN)] })
        ).toThrow(/value/i);
    });
});

describe('the try* wrappers', () => {
    // Read and write paths both cross boundaries where one bad row must not
    // abort the whole operation: a leaderboard covering every user, and a
    // 48k-row inventory sync that has already cleared calibration.
    it('tryEncodeGearStats returns the cells on success', () => {
        expect(tryEncodeGearStats({ mainStat: flat('attack', 60), subStats: [] })).toEqual(['a60']);
    });

    it('tryEncodeGearStats returns null instead of throwing', () => {
        expect(tryEncodeGearStats({ mainStat: flat('crit', 5), subStats: [] })).toBeNull();
        expect(tryEncodeGearStats({ mainStat: flat('attack', NaN), subStats: [] })).toBeNull();
        expect(tryEncodeGearStats({ mainStat: pct('effectiveHp', 5), subStats: [] })).toBeNull();
    });

    it('tryDecodeGearStats returns the stats on success', () => {
        expect(tryDecodeGearStats(['a60', 'C6'])).toEqual({
            mainStat: flat('attack', 60),
            subStats: [pct('crit', 6)],
        });
    });

    it('tryDecodeGearStats returns null instead of throwing', () => {
        expect(tryDecodeGearStats(['q60'])).toBeNull();
        expect(tryDecodeGearStats(['aabc'])).toBeNull();
    });

    it('tryDecodeGearStats still reads an empty piece rather than failing it', () => {
        expect(tryDecodeGearStats(null)).toEqual({ mainStat: null, subStats: [] });
        expect(tryDecodeGearStats([''])).toEqual({ mainStat: null, subStats: [] });
    });
});

describe('round trip over the real corpus', () => {
    // 3,607 production `inventory_items.stats` rows in the legacy long form,
    // sampled across 8 users. Synthetic rows would not exercise the real
    // distribution of null main stats, substat counts and (name, type) pairs.
    const corpus: Array<{ mainStat: unknown; subStats: unknown }> = readFileSync(
        join(__dirname, 'fixtures/realGearStats.jsonl'),
        'utf8'
    )
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line));

    it('has rows worth testing — the fixture is not silently empty', () => {
        expect(corpus.length).toBeGreaterThan(3000);
        expect(corpus.filter((row) => row.mainStat === null).length).toBeGreaterThan(0);
        expect(
            corpus.filter((row) => (row.subStats as unknown[]).length === 4).length
        ).toBeGreaterThan(0);
    });

    it('decodes every legacy row without throwing', () => {
        for (const row of corpus) {
            expect(() => decodeGearStats(row)).not.toThrow();
        }
    });

    it('survives legacy -> compact -> decoded with the same stats', () => {
        for (const row of corpus) {
            const fromLegacy = decodeGearStats(row);
            const fromCompact = decodeGearStats(encodeGearStats(fromLegacy));
            expect(fromCompact).toEqual(fromLegacy);
        }
    });

    it('re-encodes a compact row to the identical array', () => {
        for (const row of corpus) {
            const compact = encodeGearStats(decodeGearStats(row));
            expect(encodeGearStats(decodeGearStats(compact))).toEqual(compact);
        }
    });

    it('preserves the value and type of every stat', () => {
        for (const row of corpus) {
            const decoded = decodeGearStats(encodeGearStats(decodeGearStats(row)));
            const original = [
                ...(row.mainStat ? [row.mainStat as Stat] : []),
                ...((row.subStats ?? []) as Stat[]),
            ];
            const roundTripped = [
                ...(decoded.mainStat ? [decoded.mainStat] : []),
                ...decoded.subStats,
            ];
            expect(roundTripped).toEqual(original);
        }
    });

    it('is smaller than the legacy shape on every row', () => {
        let legacyBytes = 0;
        let compactBytes = 0;
        for (const row of corpus) {
            legacyBytes += JSON.stringify(row).length;
            compactBytes += JSON.stringify(encodeGearStats(decodeGearStats(row))).length;
        }
        expect(compactBytes).toBeLessThan(legacyBytes / 3);
    });
});
