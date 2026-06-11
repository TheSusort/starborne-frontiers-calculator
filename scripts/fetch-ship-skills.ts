/* eslint-disable no-console */
/**
 * Fetches current skill texts from Supabase ship_templates and regenerates
 * docs/ship-skills.csv (the local, gitignored source of truth for the skill
 * parser, audit:skills, and combat-engine lock tests).
 *
 * Usage: npm run fetch:ship-skills
 *
 * Reads VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY from .env (ship_templates
 * is publicly readable; no service role needed).
 */
import 'dotenv/config';
import { writeFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';

const OUT_PATH = 'docs/ship-skills.csv';

// Column order must match the existing CSV exactly — auditSkills.ts and the
// combat lock-test fixtures destructure fields positionally.
const COLUMNS = [
    'name',
    'active_skill_text',
    'charge_skill_charge',
    'charge_skill_text',
    'first_passive_skill_text',
    'second_passive_skill_text',
    'third_passive_skill_text',
] as const;

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('ERROR: Missing Supabase environment variables');
    console.error('Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

type TemplateRow = Record<(typeof COLUMNS)[number], string | number | null>;

// Standard CSV escaping; SQL NULL stays a literal unquoted `null` (the format
// the existing file uses and its consumers filter on).
function toCsvField(value: string | number | null): string {
    if (value === null || value === undefined) return 'null';
    const s = String(value);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function main(): Promise<void> {
    console.log('Fetching ship_templates from Supabase...');
    const { data, error } = await supabase
        .from('ship_templates')
        .select(COLUMNS.join(', '))
        .order('name')
        .overrideTypes<TemplateRow[]>();

    if (error) {
        console.error('Failed to fetch ship_templates:', error.message);
        process.exit(1);
    }
    if (!data || data.length === 0) {
        console.error('No ship_templates rows returned — refusing to write an empty CSV');
        process.exit(1);
    }

    const lines = [
        COLUMNS.join(','),
        ...data.map((row) => COLUMNS.map((c) => toCsvField(row[c])).join(',')),
    ];
    writeFileSync(OUT_PATH, lines.join('\n') + '\n');
    console.log(`Wrote ${data.length} ships to ${OUT_PATH}`);
}

main();
