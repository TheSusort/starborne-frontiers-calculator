// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * Tripwire: the MCP function's module graph loads in plain Node.
 *
 * vitest defines `import.meta.env`, so a suite cannot see a transitive import of
 * `src/config/supabase.ts` (or anything else reading `import.meta.env`, or touching a browser
 * global at load) from the function — which would crash every cold start in production. Each
 * entry is imported in a child `node --import tsx` with every `VITE_*` and git variable removed.
 */

const ROOT = resolve(__dirname, '../../..');

const ENTRIES = ['src/services/fleetReads.ts'];

/** Loads `file` in a clean Node child; resolves to its exit status and stderr. */
const loadInNode = (file: string) => {
    const env: NodeJS.ProcessEnv = {};
    for (const [key, value] of Object.entries(process.env)) {
        if (!key.startsWith('VITE_') && !key.startsWith('GIT_')) env[key] = value;
    }
    const url = `file://${resolve(ROOT, file)}`;
    const script = `import(${JSON.stringify(url)}).then(() => process.exit(0), (e) => { console.error(e && e.message); process.exit(1); })`;
    const child = spawnSync(process.execPath, ['--import', 'tsx', '-e', script], {
        cwd: ROOT,
        env,
        encoding: 'utf8',
        timeout: 60_000,
    });
    return { status: child.status, stderr: child.stderr };
};

describe('the MCP function loads outside Vite', () => {
    it('fails for a module that reads import.meta.env, so a pass below means something', () => {
        const { status, stderr } = loadInNode('src/config/supabase.ts');

        expect(status).not.toBe(0);
        expect(stderr).toContain('VITE_SUPABASE_URL');
    });

    it.each(ENTRIES)('%s loads with VITE_* unset', (file) => {
        const { status, stderr } = loadInNode(file);

        expect(stderr).toBe('');
        expect(status).toBe(0);
    });
});
