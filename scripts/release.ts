//
// Cuts a release: folds UNRELEASED_CHANGES into CHANGELOG, bumps CURRENT_VERSION,
// commits, tags, and fast-forwards `production` — the branch Netlify builds.
//
// `main` is continuously integrated and NOT deployed. Every deploy costs build minutes, so
// the site advances once per release rather than once per merge.
//
// Local by default: it edits, commits and tags, then prints the two push commands. Pass
// --push to run them.
//
//   npm run release              # cut the next minor locally
//   npm run release -- --patch   # cut a patch instead
//   npm run release -- --version 2.0.0
//   npm run release -- --push    # and publish it
//
// The pure transforms below are covered by src/__tests__/scripts/release.test.ts. `tsc --noEmit`
// only includes `src`, so this file is typechecked solely because that test imports it — the
// test is what keeps both the types and the behaviour honest.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHANGELOG_PATH = join(ROOT, 'src/constants/changelog.ts');

const git = (...args: string[]): string => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();

/** `1.67.0` + minor -> `1.68.0`. Throws on anything that is not three dot-separated integers,
 *  because a malformed version reaches the tag, the changelog and the app's "what's new" gate. */
export function nextVersion(current: string, bump: string): string {
    const parts = String(current).split('.');
    if (parts.length !== 3 || parts.some((p) => !/^\d+$/.test(p))) {
        throw new Error(`CURRENT_VERSION is not a three-part version: ${current}`);
    }
    const [major, minor, patch] = parts.map(Number);
    if (bump === 'major') return `${major + 1}.0.0`;
    if (bump === 'patch') return `${major}.${minor}.${patch + 1}`;
    return `${major}.${minor + 1}.0`;
}

export function readCurrentVersion(source: string): string {
    const match = source.match(/export const CURRENT_VERSION = '([^']+)'/);
    if (!match) throw new Error('CURRENT_VERSION not found in changelog.ts');
    return match[1];
}

/** The strings in UNRELEASED_CHANGES, in file order. Returns [] for an empty array literal. */
export function readUnreleased(source: string): string[] {
    // Non-greedy to the first `];` so this also matches the one-line `[]` a release leaves
    // behind — otherwise the release after a release reports the array as missing rather than
    // as empty.
    const match = source.match(/export const UNRELEASED_CHANGES: string\[\] = \[([\s\S]*?)\];/);
    if (!match) throw new Error('UNRELEASED_CHANGES not found in changelog.ts');
    const body = match[1];
    const entries = [...body.matchAll(/^\s*(['"])((?:\\.|(?!\1).)*)\1,\s*$/gm)];
    return entries.map((entry) => entry[2]);
}

/**
 * Rewrite changelog.ts for a release: CURRENT_VERSION becomes `version`, a new entry goes to the
 * TOP of CHANGELOG (newest first, matching the existing file), and UNRELEASED_CHANGES empties.
 *
 * All three happen together or not at all — a bumped version with its entries still unreleased
 * shows users a "what's new" dialog listing nothing.
 */
export interface ReleaseEntry {
    version: string;
    date: string;
    changes: string[];
}

export function rewriteChangelog(source: string, { version, date, changes }: ReleaseEntry): string {
    if (changes.length === 0) throw new Error('nothing to release: UNRELEASED_CHANGES is empty');
    if (source.includes(`version: '${version}'`)) {
        throw new Error(`CHANGELOG already contains version ${version}`);
    }

    const entry =
        `    {\n` +
        `        version: '${version}',\n` +
        `        date: '${date}',\n` +
        `        changes: [\n` +
        changes.map((change) => `            ${JSON.stringify(change)},\n`).join('') +
        `        ],\n` +
        `    },\n`;

    let next = source.replace(
        /export const CURRENT_VERSION = '[^']+'/,
        `export const CURRENT_VERSION = '${version}'`
    );
    next = next.replace(
        /export const UNRELEASED_CHANGES: string\[\] = \[[\s\S]*?\];/,
        'export const UNRELEASED_CHANGES: string[] = [];'
    );
    next = next.replace(
        /export const CHANGELOG: ChangelogEntry\[\] = \[\n/,
        `export const CHANGELOG: ChangelogEntry[] = [\n${entry}`
    );
    return next;
}

const isMain = () => git('rev-parse', '--abbrev-ref', 'HEAD') === 'main';

function assertReleasable() {
    if (!isMain()) throw new Error('a release is cut from main');
    if (git('status', '--porcelain') !== '') {
        throw new Error('working tree is not clean');
    }
    git('fetch', 'origin', '--quiet');
    if (git('rev-parse', 'HEAD') !== git('rev-parse', 'origin/main')) {
        throw new Error('local main and origin/main disagree — pull or push first');
    }
}

function main() {
    const argv = process.argv.slice(2);
    const push = argv.includes('--push');
    const bump = argv.includes('--major') ? 'major' : argv.includes('--patch') ? 'patch' : 'minor';
    const explicit = argv.indexOf('--version');
    const source = readFileSync(CHANGELOG_PATH, 'utf8');

    assertReleasable();

    const version =
        explicit !== -1 ? argv[explicit + 1] : nextVersion(readCurrentVersion(source), bump);
    const changes = readUnreleased(source);
    const date = new Date().toISOString().slice(0, 10);

    writeFileSync(CHANGELOG_PATH, rewriteChangelog(source, { version, date, changes }));
    execFileSync('npx', ['prettier', '--write', CHANGELOG_PATH], { cwd: ROOT, stdio: 'ignore' });

    git('add', CHANGELOG_PATH);
    git('commit', '-m', `chore(release): cut ${version}`);
    git('tag', `v${version}`);

    console.log(`Cut ${version} with ${changes.length} change${changes.length === 1 ? '' : 's'}.`);

    if (!push) {
        console.log('\nNot pushed. To publish:');
        console.log(`  git push origin main v${version}`);
        console.log('  git push origin main:production   # fast-forward; this is the deploy');
        return;
    }

    git('push', 'origin', 'main', `v${version}`);
    // A fast-forward, so a diverged production is a push failure rather than a silent
    // overwrite of whatever is live.
    git('push', 'origin', 'main:production');
    console.log(`Pushed. production is now ${version}; Netlify builds it.`);
}

// Importing this file for its pure transforms must not cut a release.
if (process.argv[1] && process.argv[1].endsWith('release.ts')) {
    try {
        main();
    } catch (error) {
        console.error(`release: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
    }
}
