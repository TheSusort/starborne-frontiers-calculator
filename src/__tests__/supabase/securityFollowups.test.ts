import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * Tripwires for three privacy rules with no local database or service worker to test against:
 * shared encounter author names come from the database, new public objects are not granted to
 * anon by default, and the service worker never caches Supabase responses.
 */

const ROOT = resolve(__dirname, '../../..');
const MIGRATIONS_DIR = join(ROOT, 'supabase/migrations');

const migrations = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => ({ file: f, sql: readFileSync(join(MIGRATIONS_DIR, f), 'utf8') }));

// Strip `--` line comments so a commented-out clause cannot satisfy an assertion.
const code = (sql: string) => sql.replace(/--[^\n]*/g, '');
const allSql = migrations.map((m) => code(m.sql)).join('\n');

describe('shared encounter author names', () => {
    it('a trigger sets encounter_notes.user_name from the author profile on every write', () => {
        expect(allSql).toMatch(
            /create\s+trigger\s+set_encounter_note_author_trigger\s+before\s+insert\s+or\s+update\s+on\s+public\.encounter_notes\s+for\s+each\s+row\s+execute\s+function\s+public\.set_encounter_note_author\s*\(\s*\)/i
        );
        expect(allSql).toMatch(
            /NEW\.user_name\s*:=\s*\(\s*SELECT\s+username\s+FROM\s+public\.users\s+WHERE\s+id\s*=\s*NEW\.user_id\s*\)/i
        );
    });

    it('the client does not send user_name when sharing', () => {
        const hook = readFileSync(join(ROOT, 'src/hooks/useSharedEncounters.ts'), 'utf8');
        expect(hook).not.toMatch(/\.(?:update|insert|upsert)\(\s*\{[^}]*user_name/);
    });
});

describe('default privileges', () => {
    it.each(['TABLES', 'SEQUENCES', 'FUNCTIONS'])('new %s are not granted to anon', (kind) => {
        expect(allSql).toMatch(
            new RegExp(
                `alter\\s+default\\s+privileges\\s+for\\s+role\\s+postgres\\s+in\\s+schema\\s+public\\s+revoke\\s+all\\s+on\\s+${kind}\\s+from\\s+anon`,
                'i'
            )
        );
    });

    // PUBLIC's EXECUTE default is global, and an IN SCHEMA default privilege can only add grants,
    // so only a revoke WITHOUT a schema removes it.
    it('new functions are not executable by PUBLIC (global revoke)', () => {
        expect(allSql).toMatch(
            /alter\s+default\s+privileges\s+for\s+role\s+postgres\s+revoke\s+execute\s+on\s+functions\s+from\s+public/i
        );
    });

    it('no migration grants the defaults back to anon', () => {
        expect(allSql).not.toMatch(/alter\s+default\s+privileges[^;]*grant[^;]*to\s+[^;]*anon/i);
    });
});

describe('service worker', () => {
    it('has no runtime-caching route for Supabase', () => {
        const config = readFileSync(join(ROOT, 'vite.config.ts'), 'utf8');
        expect(config).not.toMatch(/supabase\\?\.co/);
        expect(config).not.toMatch(/cacheName:\s*'supabase-api'/);
    });
});
