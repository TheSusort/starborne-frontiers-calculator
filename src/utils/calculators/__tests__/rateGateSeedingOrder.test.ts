/**
 * Tripwire for a test-harness defect that propagated by copy-paste to 5 files / 7 sites:
 *
 *     beforeEach(() => {
 *         setupKeyedTestRng(12345);
 *         resetRateGateRng();     // <-- un-seeds everything the line above just installed
 *     });
 *
 * `resetRateGateRng` sets `rng = Math.random` AND `keyedProvider = null`
 * (`rateAccumulator.ts`), so calling it *after* a seed restores true randomness for both the
 * unkeyed and the keyed streams. The test then runs unseeded — silently, because the global
 * bootstrap in `src/setupTests.ts` seeds in its own `beforeEach`, which vitest runs BEFORE a
 * file-level one. Measured: two identical `setupKeyedTestRng(12345); resetRateGateRng()` setups
 * produce different draw sequences, while seed-only setups are byte-identical.
 *
 * It cost two bogus probe runs while speccing SP-4 (a "crit-bearing fixtures diverge" conclusion
 * that was the probe's bug, not the engine's).
 *
 * SCOPE — deliberately narrow, to stay free of false positives. This flags only the copy-paste
 * shape: a `resetRateGateRng()` with nothing but blank lines and comments between it and a
 * preceding `setupKeyedTestRng(...)`. It does NOT flag the legitimate seed-run-restore idiom,
 * where real work sits between the two:
 *
 *     setupKeyedTestRng(SEED);
 *     try { return simulateBattle(input); } finally { resetRateGateRng(); }
 *
 * Cleanup belongs in `afterEach` (or a `finally`), never on the line after the seed — and in a
 * test file it is usually redundant, since `src/setupTests.ts` already resets after every test.
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { describe, it, expect } from 'vitest';

const SRC_ROOT = join(__dirname, '..', '..', '..');

function testFilesUnder(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
            testFilesUnder(full, out);
        } else if (/\.test\.tsx?$/.test(entry)) {
            out.push(full);
        }
    }
    return out;
}

/** True for lines that carry no statement — blank, `//`, or inside/part of a block comment. */
function isInert(line: string): boolean {
    const t = line.trim();
    return t === '' || t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
}

/**
 * A reset that registers a *separate* cleanup hook is correct, even when it sits on the line
 * right after the seed — the two run at different times:
 *
 *     beforeEach(() => setupKeyedTestRng(RNG_SEED));
 *     afterEach(() => resetRateGateRng());
 */
function isCleanupHook(line: string): boolean {
    return /\b(afterEach|afterAll|finally)\b/.test(line);
}

/** The offending shape: a reset reachable from a seed with no statement in between. */
function offendingLines(lines: string[]): number[] {
    const hits: number[] = [];
    lines.forEach((line, i) => {
        if (!/\bsetupKeyedTestRng\s*\(/.test(line)) return;
        // Walk forward past blank lines and comments to the next real statement.
        let j = i + 1;
        while (j < lines.length && isInert(lines[j])) j++;
        if (j >= lines.length) return;
        if (!/\bresetRateGateRng\s*\(\s*\)/.test(lines[j])) return;
        if (isCleanupHook(lines[j])) return;
        hits.push(j);
    });
    return hits;
}

describe('rate-gate seeding order', () => {
    it('never calls resetRateGateRng() directly after setupKeyedTestRng()', () => {
        const offenders: string[] = [];

        for (const file of testFilesUnder(SRC_ROOT)) {
            const lines = readFileSync(file, 'utf8').split('\n');
            for (const j of offendingLines(lines)) {
                offenders.push(`${relative(SRC_ROOT, file)}:${j + 1}`);
            }
        }

        expect(offenders).toEqual([]);
    });

    it('detects the offending shape when it is present (the tripwire is not vacuous)', () => {
        // Guards the walker itself: without this, a broken regex or a wrong path root would make
        // the check above pass by scanning nothing / matching nothing.
        expect(
            offendingLines([
                'beforeEach(() => {',
                '    setupKeyedTestRng(12345);',
                '    // a comment does not separate them',
                '',
                '    resetRateGateRng();',
                '});',
            ])
        ).toEqual([4]);
    });

    it('does not flag the two correct idioms', () => {
        // Separate cleanup hook on the very next line.
        expect(
            offendingLines([
                'beforeEach(() => setupKeyedTestRng(RNG_SEED));',
                'afterEach(() => resetRateGateRng());',
            ])
        ).toEqual([]);

        // Seed, run, restore — real work between the two calls.
        expect(
            offendingLines([
                '    setupKeyedTestRng(SEED);',
                '    try {',
                '        return simulateBattle(input);',
                '    } finally {',
                '        resetRateGateRng();',
                '    }',
            ])
        ).toEqual([]);
    });

    it('scans a non-empty set of test files', () => {
        // The first assertion passes trivially if the walk finds nothing.
        const files = testFilesUnder(SRC_ROOT);
        expect(files.length).toBeGreaterThan(100);
        expect(files.some((f) => f.endsWith('rateGateSeedingOrder.test.ts'))).toBe(true);
    });
});
