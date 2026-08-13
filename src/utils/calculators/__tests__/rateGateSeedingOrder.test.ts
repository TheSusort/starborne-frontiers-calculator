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

/**
 * Mark every line that carries no statement — blank, `//`, or anywhere inside a `/* … *&#47;` block.
 *
 * Block state has to be tracked ACROSS lines, not guessed per line. A body line inside a block
 * comment need not start with `*`:
 *
 *     setupKeyedTestRng(12345);
 *     /*
 *     a note                    <-- no leading `*`, so a per-line test calls this a statement
 *     *&#47;
 *     resetRateGateRng();       <-- ...and the forward scan stops before ever reaching this
 *
 * That is a false NEGATIVE in a tripwire — the offending shape goes unreported.
 *
 * The mask also settles which lines can START a scan: a `setupKeyedTestRng(` inside a comment is a
 * commented-out example, not a call site. This file's own header comment contains exactly that
 * shape, and before the mask it escaped being flagged only by luck (its `*`-prefixed neighbours
 * read as inert, so the scan overshot the example's `resetRateGateRng()` entirely).
 */
function inertMask(lines: string[]): boolean[] {
    let inBlock = false;
    return lines.map((line) => {
        const t = line.trim();
        if (inBlock) {
            if (t.includes('*/')) inBlock = false;
            return true;
        }
        if (t.startsWith('/*')) {
            if (!t.includes('*/')) inBlock = true;
            return true;
        }
        return t === '' || t.startsWith('//');
    });
}

/**
 * A reset that registers a *separate* cleanup hook is correct, even when it sits on the line
 * right after the seed — the two run at different times:
 *
 *     beforeEach(() => setupKeyedTestRng(RNG_SEED));
 *     afterEach(() => resetRateGateRng());
 *
 * Matched as a REGISTRATION at the start of the statement, never as a keyword appearing anywhere
 * on the line. A loose `\b(afterEach|afterAll|finally)\b` lets a trailing comment buy an offending
 * reset a free pass — `resetRateGateRng(); // finally cleanup` would go unflagged.
 */
function isCleanupHook(line: string): boolean {
    const t = line.trim();
    return /^(afterEach|afterAll)\s*\(/.test(t) || /^\}?\s*finally\s*\{/.test(t);
}

/** The offending shape: a reset reachable from a seed with no statement in between. */
function offendingLines(lines: string[]): number[] {
    const inert = inertMask(lines);
    const hits: number[] = [];
    lines.forEach((line, i) => {
        if (inert[i]) return;
        if (!/\bsetupKeyedTestRng\s*\(/.test(line)) return;
        // Walk forward past blank lines and comments to the next real statement.
        let j = i + 1;
        while (j < lines.length && inert[j]) j++;
        if (j >= lines.length) return;
        if (!/\bresetRateGateRng\s*\(\s*\)/.test(lines[j])) return;
        if (isCleanupHook(lines[j])) return;
        hits.push(j);
    });
    return hits;
}

/**
 * This file is excluded from the tree scan: its fixtures are string literals SPELLING OUT the
 * offending shape, so scanning itself reports its own test data. Standard for a linter's fixture
 * file, and it costs no coverage — the detector's behaviour is proven by the direct
 * `offendingLines([...])` unit tests below, which is stronger evidence than a self-scan anyway.
 *
 * Nothing else is excluded. Any new exclusion needs the same justification.
 */
const SELF = 'rateGateSeedingOrder.test.ts';

describe('rate-gate seeding order', () => {
    it('never calls resetRateGateRng() directly after setupKeyedTestRng()', () => {
        const offenders: string[] = [];

        for (const file of testFilesUnder(SRC_ROOT)) {
            if (file.endsWith(SELF)) continue;
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

    it('sees through a block comment whose body has no leading asterisk', () => {
        // False-negative bypass #1 (CodeRabbit, PR #323). A per-line inert test treats `a note` as
        // a statement, so the forward scan stops there and never reaches the reset below it.
        expect(
            offendingLines([
                'beforeEach(() => {',
                '    setupKeyedTestRng(12345);',
                '    /*',
                '    a note',
                '    */',
                '    resetRateGateRng();',
                '});',
            ])
        ).toEqual([5]);
    });

    it('is not fooled by a trailing comment that merely mentions a cleanup keyword', () => {
        // False-negative bypass #2 (CodeRabbit, PR #323). Matching `\b(afterEach|afterAll|finally)\b`
        // anywhere on the line let a comment buy an offending reset a free pass.
        expect(
            offendingLines([
                'beforeEach(() => {',
                '    setupKeyedTestRng(12345);',
                '    resetRateGateRng(); // finally cleanup',
                '});',
            ])
        ).toEqual([2]);
    });

    it('does not start a scan from a commented-out example', () => {
        // This file's own header comment contains the offending shape verbatim. It must never be
        // reported — and must not be excused by luck, which is what the pre-mask version relied on.
        expect(
            offendingLines([
                '/**',
                ' * beforeEach(() => {',
                ' *     setupKeyedTestRng(12345);',
                ' *     resetRateGateRng();',
                ' * });',
                ' */',
                'const real = 1;',
            ])
        ).toEqual([]);
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

    it('scans a non-empty set of test files, and skips exactly one', () => {
        // The tree-scan assertion passes trivially if the walk finds nothing.
        const files = testFilesUnder(SRC_ROOT);
        const scanned = files.filter((f) => !f.endsWith(SELF));
        expect(scanned.length).toBeGreaterThan(100);
        // The self-exclusion must remove this file and nothing else — an exclusion that quietly
        // grew to cover a second file would blind the tripwire without failing anything.
        expect(files.length - scanned.length).toBe(1);
    });
});
