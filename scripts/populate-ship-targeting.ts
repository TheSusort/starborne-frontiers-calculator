import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { parseTargetingCsv } from '../src/utils/targetingParser';

const DRY_RUN = process.env.DRY_RUN === 'true' || process.argv.includes('--dry-run');
const CSV_PATH = 'docs/ship-targeting.csv';

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
    console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

const main = async () => {
    const rows = parseTargetingCsv(readFileSync(CSV_PATH, 'utf8'));
    const orNull = (v: string) => (v.length ? v : null);

    const { data: templates, error } = await supabase
        .from('ship_templates')
        .select('id, name');
    if (error || !templates) {
        console.error('Failed to fetch ship_templates:', error?.message);
        process.exit(1);
    }

    const byName = new Map<string, { id: string; name: string }>();
    for (const t of templates) byName.set(t.name.toLowerCase(), t);

    const unmatchedCsv: string[] = [];
    const matched = new Set<string>();
    let updated = 0;

    for (const row of rows) {
        const tmpl = byName.get(row.name.toLowerCase());
        if (!tmpl) {
            unmatchedCsv.push(row.name);
            continue;
        }
        matched.add(tmpl.name.toLowerCase());

        const payload = {
            active_target: orNull(row.activeTarget),
            active_pattern: orNull(row.activePattern),
            charged_target: orNull(row.chargedTarget),
            charged_pattern: orNull(row.chargedPattern),
        };

        if (DRY_RUN) {
            console.log(`[dry-run] ${tmpl.name}:`, JSON.stringify(payload));
            updated++;
            continue;
        }

        const { error: upErr } = await supabase
            .from('ship_templates')
            .update(payload)
            .eq('id', tmpl.id);
        if (upErr) {
            console.error(`Failed to update ${tmpl.name}:`, upErr.message);
            continue;
        }
        updated++;
    }

    const unmatchedTemplates = templates
        .filter((t) => !matched.has(t.name.toLowerCase()))
        .map((t) => t.name)
        .sort();

    const verb = DRY_RUN ? 'Would update' : 'Updated';
    console.log(`\n${verb} ${updated}/${rows.length} matched CSV rows.`);
    if (unmatchedCsv.length) {
        console.warn(
            `\nCSV names with NO matching template (${unmatchedCsv.length}):\n  ${unmatchedCsv.join('\n  ')}`
        );
    }
    if (unmatchedTemplates.length) {
        console.warn(
            `\nTemplates with NO CSV targeting row (${unmatchedTemplates.length}):\n  ${unmatchedTemplates.join('\n  ')}`
        );
    }
};

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
