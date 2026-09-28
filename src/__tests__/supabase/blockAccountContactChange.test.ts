import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * Tripwire for the rule "no client may start a change of the account email or phone" (#562).
 * The rule lives in `public.block_account_contact_change()`, a BEFORE UPDATE trigger on
 * `auth.users`. No local database exists, so this pins the SQL text of the LATEST migration that
 * defines the function and of the latest one that creates the trigger; prod behaviour is checked
 * end to end by `scripts/oauth-probe.ts`, which must print `email-change: BLOCKED`.
 */

const MIGRATIONS_DIR = resolve(__dirname, '../../../supabase/migrations');

const migrations = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => ({ file: f, sql: readFileSync(join(MIGRATIONS_DIR, f), 'utf8') }));

// Strip `--` line comments so a commented-out clause cannot satisfy an assertion.
const code = (sql: string) => sql.replace(/--[^\n]*/g, '');

const DEFINES_FUNCTION =
    /create\s+or\s+replace\s+function\s+public\.block_account_contact_change\s*\(/i;
const CREATES_TRIGGER = /create\s+trigger\s+block_account_contact_change\b/gi;
const DROPS_TRIGGER = /drop\s+trigger\s+(?:if\s+exists\s+)?block_account_contact_change\b/gi;

const latest = (re: RegExp) =>
    [...migrations].reverse().find((m) => new RegExp(re.source, 'i').test(code(m.sql)));

describe('account email/phone changes are blocked (auth.users trigger)', () => {
    it('some migration defines public.block_account_contact_change()', () => {
        expect(latest(DEFINES_FUNCTION)).toBeDefined();
    });

    it.each(['email_change', 'phone_change'])(
        'the latest definition rejects starting a %s',
        (column) => {
            const body = code(latest(DEFINES_FUNCTION)!.sql);
            expect(body).toMatch(
                new RegExp(`coalesce\\s*\\(\\s*NEW\\.${column}\\s*,\\s*''\\s*\\)\\s*<>\\s*''`, 'i')
            );
            expect(body).toMatch(
                new RegExp(`NEW\\.${column}\\s+IS\\s+DISTINCT\\s+FROM\\s+OLD\\.${column}`, 'i')
            );
        }
    );

    it('the latest definition raises and otherwise returns NEW', () => {
        const body = code(latest(DEFINES_FUNCTION)!.sql);
        expect(body).toMatch(/raise\s+exception/i);
        expect(body).toMatch(/return\s+new\s*;/i);
    });

    it('the latest trigger fires before updates of both columns on auth.users', () => {
        const m = latest(CREATES_TRIGGER);
        expect(m).toBeDefined();
        expect(code(m!.sql)).toMatch(
            /create\s+trigger\s+block_account_contact_change\s+before\s+update\s+of\s+email_change\s*,\s*phone_change\s+on\s+auth\.users\s+for\s+each\s+row\s+execute\s+function\s+public\.block_account_contact_change\s*\(\s*\)/i
        );
    });

    it('supabase_auth_admin, which runs the trigger, can reach and execute the function', () => {
        const all = migrations.map((m) => code(m.sql)).join('\n');
        expect(all).toMatch(/grant\s+usage\s+on\s+schema\s+public\s+to\s+supabase_auth_admin\b/i);
        expect(all).toMatch(
            /grant\s+execute\s+on\s+function\s+public\.block_account_contact_change\s*\(\s*\)\s+to\s+supabase_auth_admin\b/i
        );
    });

    it('no migration revokes those grants', () => {
        for (const m of migrations) {
            const sql = code(m.sql);
            expect(sql, m.file).not.toMatch(
                /revoke\s+[^;]*on\s+schema\s+public\s+from\s+[^;]*supabase_auth_admin/i
            );
            expect(sql, m.file).not.toMatch(
                /revoke\s+[^;]*on\s+function\s+public\.block_account_contact_change[^;]*from/i
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
                /drop\s+function\s+(?:if\s+exists\s+)?public\.block_account_contact_change\b/i
            );
        }
    });
});
