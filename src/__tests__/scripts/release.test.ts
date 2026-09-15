import { describe, it, expect } from 'vitest';
import {
    assertVersion,
    decodeLiteral,
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

describe('assertVersion', () => {
    it('accepts three integers', () => {
        expect(assertVersion('1.68.0', '--version')).toBe('1.68.0');
    });

    it('rejects a missing value', () => {
        // `npm run release -- --version` with nothing after it reaches here as undefined, and an
        // unchecked undefined writes CURRENT_VERSION = 'undefined' and tags vundefined.
        expect(() => assertVersion(undefined, '--version')).toThrow(/--version/);
    });

    it('rejects malformed values', () => {
        expect(() => assertVersion('1.68', '--version')).toThrow();
        expect(() => assertVersion('v1.68.0', '--version')).toThrow();
        expect(() => assertVersion('1.68.0-rc1', '--version')).toThrow();
    });
});

describe('decodeLiteral', () => {
    it('turns source escapes into the runtime string', () => {
        // The changelog renders these values verbatim, so a surviving backslash is visible to
        // the reader.
        expect(decodeLiteral("Pilot\\'s ship")).toBe("Pilot's ship");
        expect(decodeLiteral('a \\\\ b')).toBe('a \\ b');
        expect(decodeLiteral('say \\"hi\\"')).toBe('say "hi"');
    });

    it('leaves an unescaped string alone', () => {
        expect(decodeLiteral("Combat simulator: a ship's stats")).toBe(
            "Combat simulator: a ship's stats"
        );
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

    it('carries an escaped apostrophe through as a clean runtime string', () => {
        const escaped = source.replace(
            '    "Beta: someone\'s thing changed.",',
            "    'Beta: someone\\'s thing changed.',"
        );
        const out = rewriteChangelog(escaped, {
            version: '1.68.0',
            date: '2026-09-15',
            changes: readUnreleased(escaped),
        });
        expect(out).toContain('"Beta: someone\'s thing changed."');
        expect(out).not.toContain('\\\\');
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
