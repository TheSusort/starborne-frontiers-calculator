import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

/**
 * Tripwire for `scripts/netlify-ignore.sh`, Netlify's build-cancellation hook.
 *
 * Exit 0 CANCELS the build; non-zero builds. A regression that inverts or widens
 * this silently stops deploying the site while every deploy still reports success,
 * which is why the contract is pinned here rather than described in a comment.
 *
 * The fixture is a throwaway git repo, so these assertions do not depend on this
 * repository's own history.
 */

const SCRIPT = resolve(__dirname, '../../../scripts/netlify-ignore.sh');

let repo: string;

function git(...args: string[]): string {
    return execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
}

/** Writes the given paths, commits them, and returns the new commit sha. */
function commit(paths: string[], message: string): string {
    for (const p of paths) {
        const full = join(repo, p);
        mkdirSync(dirname(full), { recursive: true });
        writeFileSync(full, `${message}\n`);
    }
    git('add', '-A');
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', message);
    return git('rev-parse', 'HEAD');
}

/** Runs the hook and returns its exit code. 0 means "cancel the build". */
function run(env: Record<string, string>): number {
    try {
        execFileSync('bash', [SCRIPT], {
            cwd: repo,
            env: { ...process.env, ...env },
            stdio: 'pipe',
        });
        return 0;
    } catch (e) {
        return (e as { status: number }).status;
    }
}

const CANCEL = 0;

beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), 'netlify-ignore-'));
    git('init', '-q', '-b', 'main');
});

afterAll(() => {
    rmSync(repo, { recursive: true, force: true });
});

describe('netlify-ignore.sh', () => {
    it('cancels when only markdown changed', () => {
        const base = commit(['src/app.ts'], 'base');
        const head = commit(['README.md', 'src/utils/thing/CLAUDE.md'], 'docs only');
        expect(run({ CACHED_COMMIT_REF: base, COMMIT_REF: head })).toBe(CANCEL);
    });

    it('cancels when only .github/ and e2e/ changed', () => {
        const base = git('rev-parse', 'HEAD');
        const head = commit(['.github/workflows/x.yml', 'e2e/tests/a.spec.ts'], 'ci and e2e');
        expect(run({ CACHED_COMMIT_REF: base, COMMIT_REF: head })).toBe(CANCEL);
    });

    it('builds when a source file changed', () => {
        const base = git('rev-parse', 'HEAD');
        const head = commit(['src/pages/Thing.tsx'], 'feature');
        expect(run({ CACHED_COMMIT_REF: base, COMMIT_REF: head })).not.toBe(CANCEL);
    });

    it('builds when one source file rides along with documentation', () => {
        const base = git('rev-parse', 'HEAD');
        const head = commit(['CHANGELOG.md', 'src/constants/changelog.ts'], 'mixed');
        expect(run({ CACHED_COMMIT_REF: base, COMMIT_REF: head })).not.toBe(CANCEL);
    });

    it('builds when a dotfile at the root changed — .md is a suffix, not a prefix rule', () => {
        const base = git('rev-parse', 'HEAD');
        const head = commit(['netlify.toml'], 'config');
        expect(run({ CACHED_COMMIT_REF: base, COMMIT_REF: head })).not.toBe(CANCEL);
    });

    it('builds when there is no cached ref (first build or cleared cache)', () => {
        const head = git('rev-parse', 'HEAD');
        expect(run({ CACHED_COMMIT_REF: '', COMMIT_REF: head })).not.toBe(CANCEL);
    });

    it('builds when the cached ref is not resolvable in a shallow clone', () => {
        const head = git('rev-parse', 'HEAD');
        const missing = '0000000000000000000000000000000000000000';
        expect(run({ CACHED_COMMIT_REF: missing, COMMIT_REF: head })).not.toBe(CANCEL);
    });

    it('builds on a retry of an already-built commit, where the diff is empty', () => {
        const head = git('rev-parse', 'HEAD');
        expect(run({ CACHED_COMMIT_REF: head, COMMIT_REF: head })).not.toBe(CANCEL);
    });
});
