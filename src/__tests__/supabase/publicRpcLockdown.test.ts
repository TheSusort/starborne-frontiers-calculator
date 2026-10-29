import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * Tripwire for the RPC guards in 20261029000003_lock_down_public_rpcs.sql. No local database
 * exists, so this pins the SQL text of the LATEST migration that defines each function.
 */

const MIGRATIONS_DIR = resolve(__dirname, '../../../supabase/migrations');

const migrations = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => ({ file: f, sql: readFileSync(join(MIGRATIONS_DIR, f), 'utf8') }));

// Strip `--` line comments so a commented-out clause cannot satisfy an assertion.
const code = (sql: string) => sql.replace(/--[^\n]*/g, '');

/** The body of the latest `CREATE OR REPLACE FUNCTION public.<name>(` in the migrations. */
const latestBody = (name: string): string | undefined => {
    const re = new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\s*\\(`, 'i');
    for (const m of [...migrations].reverse()) {
        const sql = code(m.sql);
        const start = sql.search(re);
        if (start >= 0) return sql.slice(start, sql.indexOf('$function$;', start));
    }
    return undefined;
};

const allSql = () => migrations.map((m) => code(m.sql)).join('\n');

describe('public RPC lockdown', () => {
    it.each([
        'get_daily_usage_stats',
        'get_growth_stats',
        'get_live_traffic',
        'get_system_stats',
        'get_table_sizes',
        'get_top_active_users',
        'approve_ship_template_proposal',
        'reject_ship_template_proposal',
    ])('%s checks public.is_admin()', (name) => {
        const body = latestBody(name);
        expect(body, name).toBeDefined();
        expect(body).toMatch(/public\.is_admin\(\)/i);
    });

    it.each(['get_daily_usage_stats', 'get_growth_stats'])('%s caps days_back', (name) => {
        expect(latestBody(name)).toMatch(/LEAST\s*\(\s*GREATEST\s*\(\s*days_back/i);
    });

    it('is_user_admin answers only about the caller', () => {
        expect(latestBody('is_user_admin')).toMatch(/p_user_id\s*=\s*auth\.uid\(\)/i);
    });

    it('refresh_system_snapshot rejects any non-admin request carrying a JWT', () => {
        expect(latestBody('refresh_system_snapshot')).toMatch(
            /auth\.jwt\(\)\s+IS\s+NOT\s+NULL\s+AND\s+NOT\s+public\.is_admin\(\)/i
        );
    });

    it.each(['increment_autogear_count', 'increment_import_count'])(
        '%s only counts against a profile the caller can access',
        (name) => {
            const body = latestBody(name)!;
            expect(body).toMatch(/public\.has_profile_access\(/i);
            expect(body).toMatch(/WHERE\s+id\s*=\s*v_user_id/i);
        }
    );

    it('upsert_heartbeat ignores the caller-supplied date and checks the user id', () => {
        const body = latestBody('upsert_heartbeat')!;
        expect(body).toMatch(/public\.has_profile_access\(\s*p_user_id\s*\)/i);
        expect(body).toMatch(/length\(\s*p_session_id\s*\)\s*>\s*\d+/i);
        expect(body).not.toMatch(/VALUES\s*\([^)]*p_date/i);
        expect(body).not.toMatch(/VALUES\s*\([^)]*p_user_id/i);
    });

    it.each(['approve_ship_template_proposal', 'reject_ship_template_proposal'])(
        '%s records the caller as reviewer, not the argument',
        (name) => {
            const body = latestBody(name)!;
            expect(body).toMatch(/reviewed_by\s*=\s*auth\.uid\(\)::text/i);
            expect(body).not.toMatch(/reviewed_by\s*=\s*admin_user_id/i);
        }
    );

    it('the activity-log helpers have no client grants', () => {
        const sql = allSql();
        for (const fn of ['log_autogear_activity', 'log_import_activity']) {
            expect(sql).toMatch(
                new RegExp(
                    `revoke\\s+all\\s+on\\s+function\\s+public\\.${fn}\\(uuid\\)\\s+from\\s+public\\s*,\\s*anon\\s*,\\s*authenticated`,
                    'i'
                )
            );
        }
    });

    it('the owner UPDATE policy on ship_template_proposals is dropped', () => {
        expect(allSql()).toMatch(
            /drop\s+policy\s+if\s+exists\s+"Users can update own proposals"\s+on\s+public\.ship_template_proposals/i
        );
    });
});
