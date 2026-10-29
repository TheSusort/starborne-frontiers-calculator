import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * Tripwire for what a client may write to public.users: no self-promotion to admin, and no
 * rewriting of id, owner_auth_user_id or email. No local database exists, so this pins the SQL text
 * of the LATEST migration that defines each piece. See 20261029000002_lock_down_users_writes.sql.
 */

const MIGRATIONS_DIR = resolve(__dirname, '../../../supabase/migrations');

const migrations = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => ({ file: f, sql: readFileSync(join(MIGRATIONS_DIR, f), 'utf8') }));

// Strip `--` line comments so a commented-out clause cannot satisfy an assertion.
const code = (sql: string) => sql.replace(/--[^\n]*/g, '');

const latest = (re: RegExp) =>
    [...migrations].reverse().find((m) => new RegExp(re.source, 'i').test(code(m.sql)));

const DEFINES_GUARD =
    /create\s+or\s+replace\s+function\s+public\.prevent_is_admin_escalation\s*\(/i;
const CREATES_GUARD_TRIGGER = /create\s+trigger\s+prevent_is_admin_escalation_trigger\b/i;

const guardBody = () => {
    const sql = code(latest(DEFINES_GUARD)!.sql);
    const start = sql.search(DEFINES_GUARD);
    return sql.slice(start, sql.indexOf('$$;', start));
};

describe('public.users write lockdown', () => {
    it('the escalation trigger fires on INSERT and UPDATE', () => {
        const m = latest(CREATES_GUARD_TRIGGER);
        expect(m).toBeDefined();
        expect(code(m!.sql)).toMatch(
            /create\s+trigger\s+prevent_is_admin_escalation_trigger\s+before\s+insert\s+or\s+update\s+on\s+public\.users\s+for\s+each\s+row\s+execute\s+function\s+public\.prevent_is_admin_escalation\s*\(\s*\)/i
        );
    });

    it('no later migration drops the trigger without recreating it', () => {
        const drop = /drop\s+trigger\s+(?:if\s+exists\s+)?prevent_is_admin_escalation_trigger\b/i;
        const lastDrop = [...migrations].reverse().find((m) => drop.test(code(m.sql)));
        expect(lastDrop).toBeDefined();
        expect(CREATES_GUARD_TRIGGER.test(code(lastDrop!.sql))).toBe(true);
    });

    it('the guard is SECURITY INVOKER and exempts only non-client roles', () => {
        const body = guardBody();
        expect(body).toMatch(/security\s+invoker/i);
        expect(body).not.toMatch(/security\s+definer/i);
        expect(body).toMatch(/current_user\s+not\s+in\s*\(\s*'anon'\s*,\s*'authenticated'\s*\)/i);
    });

    it('the guard rejects an admin insert and freezes id, owner and email on update', () => {
        const body = guardBody();
        expect(body).toMatch(/TG_OP\s*=\s*'INSERT'/);
        expect(body).toMatch(/NEW\.is_admin\s+IS\s+TRUE/i);
        for (const column of ['is_admin', 'id', 'owner_auth_user_id', 'email']) {
            expect(body).toMatch(
                new RegExp(`NEW\\.${column}\\s+IS\\s+DISTINCT\\s+FROM\\s+OLD\\.${column}`, 'i')
            );
        }
        expect(body).toMatch(/auth\.jwt\(\)\s*->>\s*'email'/i);
    });

    it('the latest users INSERT policies all pin is_admin = false', () => {
        const create =
            /create\s+policy\s+"([^"]+)"\s+on\s+public\.users\s+for\s+insert\b([^;]*);/gi;
        const drop = /drop\s+policy\s+(?:if\s+exists\s+)?"([^"]+)"\s+on\s+public\.users\b/gi;
        const live = new Map<string, string>();
        for (const m of migrations) {
            const sql = code(m.sql);
            for (const [, name] of sql.matchAll(drop)) live.delete(name);
            for (const [, name, rest] of sql.matchAll(create)) live.set(name, rest);
        }
        expect(live.size).toBeGreaterThan(0);
        for (const [name, rest] of live) {
            expect(rest, name).toMatch(/is_admin\s*=\s*false/i);
        }
    });

    it('insert_users_policy is dropped and never recreated', () => {
        const sql = migrations.map((m) => code(m.sql)).join('\n');
        expect(sql).toMatch(
            /drop\s+policy\s+if\s+exists\s+"insert_users_policy"\s+on\s+public\.users/i
        );
        expect(sql).not.toMatch(/create\s+policy\s+"insert_users_policy"/i);
    });

    it('the latest users SELECT policy has no public-profile branch', () => {
        const create = /create\s+policy\s+"[^"]+"\s+on\s+public\.users\s+for\s+select\b[^;]*;/gi;
        const last = [...migrations]
            .reverse()
            .map((m) => [...code(m.sql).matchAll(create)].map(([s]) => s))
            .find((all) => all.length > 0)!;
        const ownerPolicy = last.find((s) => /owner_auth_user_id/i.test(s));
        expect(ownerPolicy).toBeDefined();
        expect(ownerPolicy).not.toMatch(/is_public/i);
    });
});
