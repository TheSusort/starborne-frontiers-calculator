import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * Tripwire for the rule "no token may set or replace the password of a confirmed account" (#562).
 * The rule lives in `public.block_account_password_change()`, a BEFORE UPDATE trigger on
 * `auth.users`. No local database exists, so this pins the SQL text of the LATEST migration that
 * defines the function and of the latest one that creates the trigger; prod behaviour is checked
 * end to end by `scripts/oauth-probe.ts --password-set`, which must print `password-set: BLOCKED`.
 */

const MIGRATIONS_DIR = resolve(__dirname, '../../../supabase/migrations');

const migrations = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => ({ file: f, sql: readFileSync(join(MIGRATIONS_DIR, f), 'utf8') }));

// Strip `--` line comments so a commented-out clause cannot satisfy an assertion.
const code = (sql: string) => sql.replace(/--[^\n]*/g, '');

const DEFINES_FUNCTION =
    /create\s+or\s+replace\s+function\s+public\.block_account_password_change\s*\(/i;
const CREATES_TRIGGER = /create\s+trigger\s+block_account_password_change\b/gi;
const DROPS_TRIGGER = /drop\s+trigger\s+(?:if\s+exists\s+)?block_account_password_change\b/gi;

const latest = (re: RegExp) =>
    [...migrations].reverse().find((m) => new RegExp(re.source, 'i').test(code(m.sql)));

/** The body of the latest `public.<name>()` definition, from its CREATE to the closing `$$;`. */
const functionBody = (name: string): string => {
    const re = new RegExp(
        `create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\s*\\([\\s\\S]*?\\$\\$\\s*;`,
        'i'
    );
    const m = latest(re);
    expect(m, `no migration defines public.${name}()`).toBeDefined();
    return code(m!.sql).match(re)![0];
};

const SOFT_DELETE_EXEMPTION =
    /if\s+OLD\.deleted_at\s+IS\s+NULL\s+AND\s+NEW\.deleted_at\s+IS\s+NOT\s+NULL\s+THEN\s+RETURN\s+NEW\s*;/i;

describe('account password changes are blocked (auth.users trigger)', () => {
    it('some migration defines public.block_account_password_change()', () => {
        expect(latest(DEFINES_FUNCTION)).toBeDefined();
    });

    it('the latest definition rejects a new non-empty password on a confirmed account', () => {
        const body = functionBody('block_account_password_change');
        expect(body).toMatch(
            /OLD\.email_confirmed_at\s+IS\s+NOT\s+NULL\s+OR\s+OLD\.phone_confirmed_at\s+IS\s+NOT\s+NULL/i
        );
        expect(body).toMatch(/coalesce\s*\(\s*NEW\.encrypted_password\s*,\s*''\s*\)\s*<>\s*''/i);
        expect(body).toMatch(
            /NEW\.encrypted_password\s+IS\s+DISTINCT\s+FROM\s+OLD\.encrypted_password/i
        );
        expect(body).toMatch(/raise\s+exception/i);
        expect(body).toMatch(/return\s+new\s*;/i);
    });

    it.each(['block_account_password_change', 'block_account_contact_change'])(
        'the latest %s() lets an admin soft delete through',
        (name) => {
            expect(functionBody(name)).toMatch(SOFT_DELETE_EXEMPTION);
        }
    );

    it('the latest trigger fires before updates of encrypted_password on auth.users', () => {
        const m = latest(CREATES_TRIGGER);
        expect(m).toBeDefined();
        expect(code(m!.sql)).toMatch(
            /create\s+trigger\s+block_account_password_change\s+before\s+update\s+of\s+encrypted_password\s+on\s+auth\.users\s+for\s+each\s+row\s+execute\s+function\s+public\.block_account_password_change\s*\(\s*\)/i
        );
    });

    it('supabase_auth_admin, which runs the trigger, can reach and execute the function', () => {
        const all = migrations.map((m) => code(m.sql)).join('\n');
        expect(all).toMatch(/grant\s+usage\s+on\s+schema\s+public\s+to\s+supabase_auth_admin\b/i);
        expect(all).toMatch(
            /grant\s+execute\s+on\s+function\s+public\.block_account_password_change\s*\(\s*\)\s+to\s+supabase_auth_admin\b/i
        );
    });

    it('no migration revokes that grant', () => {
        for (const m of migrations) {
            expect(code(m.sql), m.file).not.toMatch(
                /revoke\s+[^;]*on\s+function\s+public\.block_account_password_change[^;]*from/i
            );
        }
    });

    it('no migration drops the trigger without re-creating it, or drops the function', () => {
        for (const m of migrations) {
            const sql = code(m.sql);
            const creates = [...sql.matchAll(CREATES_TRIGGER)].map((x) => x.index);
            for (const drop of sql.matchAll(DROPS_TRIGGER)) {
                expect(
                    creates.some((c) => c > drop.index),
                    `${m.file}: DROP TRIGGER at ${drop.index} has no later CREATE TRIGGER`
                ).toBe(true);
            }
            expect(sql, m.file).not.toMatch(
                /drop\s+function\s+(?:if\s+exists\s+)?public\.block_account_password_change\b/i
            );
        }
    });
});
