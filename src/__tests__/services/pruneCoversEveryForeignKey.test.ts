import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

/**
 * `pruneSupabaseDataNotInLocal` deletes parents (ships, inventory_items,
 * encounter_notes, loadouts, team_loadouts) and must clear every row that
 * references them first — the schema has no CASCADE constraints, so a missed
 * referencing table is an FK violation mid-prune, i.e. a restore that half
 * finishes.
 *
 * A hand-written list of those children rots the moment somebody adds a table.
 * This is keyed to the schema file instead: every FK into a pruned parent must
 * name its child table somewhere in the service.
 */

const SCHEMA = join(__dirname, '../../../supabase/current-schema.sql');
const SERVICE = join(__dirname, '../../services/userDataService.ts');

const PRUNED_PARENTS = ['ships', 'inventory_items', 'encounter_notes', 'loadouts', 'team_loadouts'];

/**
 * Walks the schema's `CREATE TABLE` blocks and returns, for each pruned parent,
 * the tables holding a foreign key into it.
 */
const referencingTables = (schema: string): Map<string, Set<string>> => {
    const byParent = new Map<string, Set<string>>(
        PRUNED_PARENTS.map((parent) => [parent, new Set<string>()])
    );

    let current = '';
    for (const line of schema.split('\n')) {
        const table = /^CREATE TABLE (?:IF NOT EXISTS )?public\.(\w+)/.exec(line);
        if (table) {
            current = table[1];
            continue;
        }
        const fk = /REFERENCES public\.(\w+)\s*\(/.exec(line);
        if (!fk || !current) continue;
        const parent = fk[1];
        // A table's FK to itself is not a prune ordering problem.
        if (parent !== current) byParent.get(parent)?.add(current);
    }
    return byParent;
};

/**
 * Only the prune's own body counts. `deleteUserSupabaseData` above it names
 * every table in the schema, so matching against the whole file would pass no
 * matter what the prune does.
 */
const pruneBody = (service: string): string => {
    const start = service.indexOf('export async function pruneSupabaseDataNotInLocal');
    if (start < 0) throw new Error('pruneSupabaseDataNotInLocal not found in userDataService.ts');
    return service.slice(start);
};

describe('the prune clears every table that references a pruned parent', () => {
    const schema = readFileSync(SCHEMA, 'utf8');
    const service = pruneBody(readFileSync(SERVICE, 'utf8'));

    it('reads a real schema — the parse is not silently empty', () => {
        const found = referencingTables(schema);
        for (const parent of PRUNED_PARENTS) {
            expect(found.get(parent)?.size, `no FKs found into ${parent}`).toBeGreaterThan(0);
        }
    });

    it('names every referencing child table in the service', () => {
        const found = referencingTables(schema);
        const missing: string[] = [];

        for (const [parent, children] of found) {
            for (const child of children) {
                if (!service.includes(`'${child}'`)) missing.push(`${child} -> ${parent}`);
            }
        }

        expect(missing).toEqual([]);
    });
});
