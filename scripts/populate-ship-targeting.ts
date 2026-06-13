import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const DRY_RUN = process.env.DRY_RUN === 'true' || process.argv.includes('--dry-run');
const CSV_PATH = 'docs/ship-targeting.csv';

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
    console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

interface Row {
    name: string;
    active_target: string | null;
    active_pattern: string | null;
    charged_target: string | null;
    charged_pattern: string | null;
}

const parseCsv = (): Row[] => {
    const lines = readFileSync(CSV_PATH, 'utf8')
        .split(/\r?\n/)
        .filter((l) => l.trim().length > 0);
    const rows: Row[] = [];
    for (let i = 1; i < lines.length; i++) {
        const [name, at, ap, ct, cp] = lines[i].split(',');
        const norm = (v?: string) => {
            const t = (v ?? '').trim();
            return t.length ? t : null;
        };
        rows.push({
            name: (name ?? '').trim(),
            active_target: norm(at),
            active_pattern: norm(ap),
            charged_target: norm(ct),
            charged_pattern: norm(cp),
        });
    }
    return rows;
};

const main = async () => {
    const rows = parseCsv();

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
            active_target: row.active_target,
            active_pattern: row.active_pattern,
            charged_target: row.charged_target,
            charged_pattern: row.charged_pattern,
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

    console.log(`\n${DRY_RUN ? '[DRY RUN] ' : ''}Processed ${updated}/${rows.length} CSV rows.`);
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
