import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs';
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

// Git exports GIT_DIR/GIT_WORK_TREE/GIT_INDEX_FILE (and friends) to every
// process a hook spawns. This suite's own git commands are meant to run
// against the disposable `repo` below, but with GIT_DIR set and no
// GIT_WORK_TREE, git treats cwd as the work tree while still reading/writing
// the CALLER's repository — so run from inside a hook (e.g. husky's
// pre-commit, which shells out to this test suite), every `git` call here
// would target the real repository with `repo` as its work tree, committing
// fixture files into the caller's history. Stripping these vars keeps repo
// discovery anchored to `cwd`.
const REPO_LOCATING_ENV_VARS = [
    'GIT_DIR',
    'GIT_WORK_TREE',
    'GIT_INDEX_FILE',
    'GIT_COMMON_DIR',
    'GIT_OBJECT_DIRECTORY',
    'GIT_ALTERNATE_OBJECT_DIRECTORIES',
    'GIT_PREFIX',
];
const cleanEnv: NodeJS.ProcessEnv = { ...process.env };
for (const key of REPO_LOCATING_ENV_VARS) delete cleanEnv[key];

let repo: string;

function git(...args: string[]): string {
    return execFileSync('git', args, { cwd: repo, env: cleanEnv, encoding: 'utf8' }).trim();
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

/** Runs the hook and returns its exit code. 0 means "cancel the build".
 *  `overrides` cannot reintroduce a repo-locating var: they are stripped
 *  after the merge, so the script under test always discovers `repo`. */
function run(overrides: Record<string, string>): number {
    const env: NodeJS.ProcessEnv = { ...cleanEnv, ...overrides };
    for (const key of REPO_LOCATING_ENV_VARS) delete env[key];
    try {
        execFileSync('bash', [SCRIPT], {
            cwd: repo,
            env,
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
    // Tripwire: if repo discovery ever again escapes to the caller's
    // repository, this resolves to that repository's .git, not `repo`'s.
    const realGitDir = execFileSync('git', ['rev-parse', '--absolute-git-dir'], {
        cwd: repo,
        env: cleanEnv,
        encoding: 'utf8',
    }).trim();
    // Resolved from `repo` itself, not from `repo/.git`: when the env leaks,
    // the fixture never gets a .git at all and resolving it would throw ENOENT
    // instead of reporting where discovery actually went.
    const realRepo = join(realpathSync(repo), '.git');
    if (realGitDir !== realRepo) {
        throw new Error(
            `netlify-ignore.sh fixture escaped its own repo: git resolved --absolute-git-dir ` +
                `to ${realGitDir}, expected ${realRepo}`
        );
    }
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
