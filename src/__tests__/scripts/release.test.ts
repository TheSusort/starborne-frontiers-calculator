import { describe, it, expect } from 'vitest';
import {
    nextVersion,
    readCurrentVersion,
    readUnreleased,
    rewriteChangelog,
} from '../../../scripts/release';

/** A miniature changelog.ts with the same shape as the real file. */
const source = `import { ChangelogEntry } from '../types/changelog';

export const CURRENT_VERSION = '1.67.0';

export const UNRELEASED_CHANGES: string[] = [
    'Alpha: something changed.',
    "Beta: someone's thing changed.",
];

export const CHANGELOG: ChangelogEntry[] = [
    {
        version: '1.67.0',
        date: '2026-09-10',
        changes: ['Older: a previous change.'],
    },
];
`;

describe('nextVersion', () => {
    it('bumps minor by default, and major/patch on request', () => {
        expect(nextVersion('1.67.0', 'minor')).toBe('1.68.0');
        expect(nextVersion('1.67.3', 'patch')).toBe('1.67.4');
        expect(nextVersion('1.67.3', 'major')).toBe('2.0.0');
    });

    it('refuses a version that is not three integers', () => {
        // A malformed version reaches the git tag, the changelog and the app's what's-new gate.
        expect(() => nextVersion('1.67', 'minor')).toThrow();
        expect(() => nextVersion('1.67.0-beta', 'minor')).toThrow();
    });
});

describe('reading the current file', () => {
    it('finds the current version', () => {
        expect(readCurrentVersion(source)).toBe('1.67.0');
    });

    it('reads the unreleased entries in file order, quotes of either kind', () => {
        expect(readUnreleased(source)).toEqual([
            'Alpha: something changed.',
            "Beta: someone's thing changed.",
        ]);
    });

    it('reads an empty unreleased array as nothing to release', () => {
        const empty = source.replace(
            /export const UNRELEASED_CHANGES[\s\S]*?\n\];/,
            'export const UNRELEASED_CHANGES: string[] = [];'
        );
        expect(readUnreleased(empty)).toEqual([]);
    });
});

describe('rewriteChangelog', () => {
    const result = (): string =>
        rewriteChangelog(source, {
            version: '1.68.0',
            date: '2026-09-15',
            changes: readUnreleased(source),
        });

    it('bumps CURRENT_VERSION', () => {
        expect(result()).toContain("export const CURRENT_VERSION = '1.68.0'");
        expect(result()).not.toContain("export const CURRENT_VERSION = '1.67.0'");
    });

    it('empties UNRELEASED_CHANGES', () => {
        expect(readUnreleased(result())).toEqual([]);
    });

    it('puts the new entry at the top, ahead of the previous release', () => {
        const out = result();
        expect(out.indexOf("version: '1.68.0'")).toBeLessThan(out.indexOf("version: '1.67.0'"));
    });

    it('carries every unreleased entry into the new release, apostrophes intact', () => {
        const out = result();
        expect(out).toContain('"Alpha: something changed."');
        expect(out).toContain('"Beta: someone\'s thing changed."');
    });

    it('refuses to release nothing', () => {
        // A version bump with an empty entry shows users a what's-new dialog listing nothing.
        expect(() =>
            rewriteChangelog(source, { version: '1.68.0', date: '2026-09-15', changes: [] })
        ).toThrow(/empty/i);
    });

    it('refuses to reuse a version already in the changelog', () => {
        expect(() =>
            rewriteChangelog(source, { version: '1.67.0', date: '2026-09-15', changes: ['x'] })
        ).toThrow(/already contains/i);
    });
});
