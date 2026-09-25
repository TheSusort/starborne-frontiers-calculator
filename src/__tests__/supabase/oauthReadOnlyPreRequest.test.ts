import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * Tripwire for the Data API rule "a token issued to an OAuth client is read-only"
 * (#562). The rule lives in `public.check_request()`, PostgREST's pre-request hook.
 * No local database exists, so this pins the SQL text of the LATEST migration that
 * defines or registers the hook; prod behaviour is checked by the verification
 * snippet in docs/superpowers/specs/2026-09-25-mcp-oauth-read-only-tokens-design.md.
 */

const MIGRATIONS_DIR = resolve(__dirname, '../../../supabase/migrations');

const migrations = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => ({ file: f, sql: readFileSync(join(MIGRATIONS_DIR, f), 'utf8') }));

// Strip `--` line comments so a commented-out clause cannot satisfy an assertion.
const code = (sql: string) => sql.replace(/--[^\n]*/g, '');

const DEFINES_HOOK = /create\s+or\s+replace\s+function\s+public\.check_request\s*\(/i;
const REGISTERS_HOOK = /pgrst\.db_pre_request/i;

const latest = (re: RegExp) => [...migrations].reverse().find((m) => re.test(code(m.sql)));

describe('OAuth client tokens are read-only (pre-request hook)', () => {
    it('some migration defines public.check_request()', () => {
        expect(latest(DEFINES_HOOK)).toBeDefined();
    });

    it('the latest definition rejects non-GET/HEAD requests from tokens carrying client_id', () => {
        const body = code(latest(DEFINES_HOOK)!.sql);
        expect(body).toMatch(/request\.jwt\.claims/);
        expect(body).toMatch(/request\.method/);
        expect(body).toMatch(/\?\s*'client_id'/);
        expect(body).toMatch(/not\s+in\s*\(\s*'GET'\s*,\s*'HEAD'\s*\)/i);
        expect(body).toMatch(/raise\s+sqlstate\s+'PT403'/i);
    });

    it('the latest registration points the hook at public.check_request and reloads config', () => {
        const reg = latest(REGISTERS_HOOK);
        expect(reg).toBeDefined();
        const sql = code(reg!.sql);
        expect(sql).toMatch(
            /alter\s+role\s+authenticator\s+set\s+pgrst\.db_pre_request\s*=\s*'public\.check_request'/i
        );
        expect(sql).toMatch(/notify\s+pgrst\s*,\s*'reload config'/i);
    });

    it('no migration resets or repoints the hook', () => {
        for (const m of migrations) {
            const sql = code(m.sql);
            expect(sql, m.file).not.toMatch(/reset\s+pgrst\.db_pre_request/i);
            const targets = [...sql.matchAll(/pgrst\.db_pre_request\s*=\s*'([^']+)'/gi)].map(
                (x) => x[1]
            );
            for (const t of targets) expect(t, m.file).toBe('public.check_request');
        }
    });
});
