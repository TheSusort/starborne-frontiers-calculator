/* eslint-disable no-console */
/**
 * Populates ship_templates.ascension_stats from the official unit catalogue.
 *
 * Usage: npm run fetch:ascension-stats [-- --dry-run]
 *
 * Writes ONLY that column. The catalogue's skill text is lossy — named effects
 * render as empty segments on most units — so ingesting anything else from here
 * would regress the skill parser, whose authority is docs/ship-skills.csv.
 *
 * Units are matched on definition_id (the catalogue's `unit.id`), never on name:
 * faction and unit naming drift between the two sources.
 *
 * Needs SUPABASE_SERVICE_ROLE_KEY — ship_templates is publicly readable but only
 * admins may write it.
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const CATALOGUE_ORIGIN = 'https://starborne.com';
const INDEX_URL = `${CATALOGUE_ORIGIN}/frontiers/units`;
const unitUrl = (slug: string) =>
    `${CATALOGUE_ORIGIN}/api/unit-catalogue/unit-locale?locale=en&slug=${slug}`;

interface AscensionStatRow {
    level: number;
    attribute: string;
    type: string;
    value: number;
}

/** Mirrors `isAscensionStat` in src/utils/ship/referenceShip.ts, which the app validates with. */
const MAX_REFIT_LEVEL = 6;

const isAscensionStatRow = (value: unknown): value is AscensionStatRow => {
    if (typeof value !== 'object' || value === null) return false;
    const row = value as Record<string, unknown>;
    return (
        typeof row.level === 'number' &&
        Number.isInteger(row.level) &&
        row.level >= 0 &&
        row.level <= MAX_REFIT_LEVEL &&
        typeof row.attribute === 'string' &&
        typeof row.type === 'string' &&
        typeof row.value === 'number' &&
        Number.isFinite(row.value)
    );
};

const fetchText = async (url: string): Promise<string> => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
    return response.text();
};

/** Slugs are only in the index page's markup; there is no catalogue index endpoint. */
const readSlugs = (html: string): string[] => [
    ...new Set([...html.matchAll(/\/frontiers\/units\/([a-z0-9-]+)/g)].map((m) => m[1])),
];

const readBuildId = (html: string): string | null => html.match(/"buildId":"([^"]+)"/)?.[1] ?? null;

const main = async () => {
    const dryRun = process.argv.includes('--dry-run');

    const supabaseUrl = process.env.VITE_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceKey) {
        console.error('Please set VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
        process.exit(1);
    }
    const supabase = createClient(supabaseUrl, serviceKey);

    const index = await fetchText(INDEX_URL);
    const slugs = readSlugs(index);
    console.log(`catalogue build ${readBuildId(index) ?? 'unknown'}, ${slugs.length} units`);
    if (slugs.length === 0) {
        console.error('No unit slugs found — the index page markup changed. Nothing written.');
        process.exit(1);
    }

    const { data: templates, error } = await supabase
        .from('ship_templates')
        .select('id, name, definition_id');
    if (error) throw error;

    const templateByDefinitionId = new Map<string, { id: string; name: string }>();
    for (const row of templates ?? []) {
        if (row.definition_id) templateByDefinitionId.set(row.definition_id, row);
    }

    const updates: Array<{ id: string; name: string; stats: AscensionStatRow[] }> = [];
    const unmatchedUnits: string[] = [];
    const emptyUnits: string[] = [];

    for (const slug of slugs) {
        const unit = JSON.parse(await fetchText(unitUrl(slug))).unit as {
            id: string;
            ascensionStats?: unknown;
        };
        // All or nothing, matching the app's own parse: a partial list would still satisfy
        // `canBeFullyRefitted`, so the picker would offer a refitted version missing grants.
        const rows = Array.isArray(unit.ascensionStats) ? unit.ascensionStats : [];
        if (rows.length === 0 || !rows.every(isAscensionStatRow)) {
            if (rows.length > 0) {
                console.error(`${slug}: ascension payload has unusable rows, skipping the unit`);
            }
            emptyUnits.push(slug);
            continue;
        }
        const stats = rows as AscensionStatRow[];
        const template = templateByDefinitionId.get(unit.id);
        if (!template) {
            unmatchedUnits.push(`${slug} (${unit.id})`);
            continue;
        }
        updates.push({ id: template.id, name: template.name, stats });
    }

    // A run that matched nothing is the failure that matters: it looks like a
    // clean no-op. Say so and write nothing.
    if (updates.length === 0) {
        console.error('No unit matched a template — refusing to write.');
        process.exit(1);
    }

    console.log(`matched ${updates.length}/${slugs.length} units`);
    if (emptyUnits.length) console.log(`no ascension data: ${emptyUnits.join(', ')}`);
    if (unmatchedUnits.length) console.log(`no template: ${unmatchedUnits.join(', ')}`);

    const untouched = (templates ?? []).filter(
        (row) => !updates.some((update) => update.id === row.id)
    );
    if (untouched.length) {
        console.log(`templates left unchanged: ${untouched.map((r) => r.name).join(', ')}`);
    }

    if (dryRun) {
        console.log('--dry-run: nothing written');
        return;
    }

    const failures: string[] = [];
    for (const update of updates) {
        const { error: updateError } = await supabase
            .from('ship_templates')
            .update({ ascension_stats: update.stats })
            .eq('id', update.id);
        if (updateError) {
            console.error(`failed to update ${update.name}:`, updateError.message);
            failures.push(update.name);
        }
    }

    console.log(`wrote ascension_stats for ${updates.length - failures.length} templates`);
    // A partial write that exits 0 tells automation the data landed. Fail loudly instead.
    if (failures.length > 0) {
        console.error(`${failures.length} failed: ${failures.join(', ')}`);
        process.exit(1);
    }
};

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
