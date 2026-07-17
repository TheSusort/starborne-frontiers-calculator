/* eslint-disable no-console */
/**
 * Fetches base stats + targeting + meta from Supabase ship_templates and
 * regenerates docs/ship-data.json (the local, gitignored snapshot the
 * kit-audit harness — scripts/lib/traceShipFactory.ts — uses for STATS and
 * targeting; skill TEXT still comes from docs/ship-skills.csv, which stays
 * the skill authority — see fetch-ship-skills.ts).
 *
 * Usage: npm run fetch:ship-data
 *
 * Reads VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY from .env (ship_templates
 * is publicly readable; no service role needed).
 */
import 'dotenv/config';
import { writeFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';
import type { ShipData } from '../src/types/ship';

const OUT_PATH = 'docs/ship-data.json';

const COLUMNS = [
    'name',
    'rarity',
    'faction',
    'type',
    'affinity',
    'image_key',
    'active_target',
    'active_pattern',
    'charged_target',
    'charged_pattern',
    'base_stats',
] as const;

interface TemplateRow {
    name: string;
    rarity: string;
    faction: string;
    type: string;
    affinity: string;
    image_key: string | null;
    active_target: string | null;
    active_pattern: string | null;
    charged_target: string | null;
    charged_pattern: string | null;
    base_stats: {
        hp: number;
        attack: number;
        defence: number;
        hacking: number;
        security: number;
        crit_rate: number;
        crit_damage: number;
        speed: number;
        shield: number;
        shield_penetration: number;
        defense_penetration: number;
    };
}

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('ERROR: Missing Supabase environment variables');
    console.error('Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// A handful of ship_templates rows (AEGIS, APEX, LUXX) store `name` fully upper-case —
// a pre-existing DB data-quality quirk that the old hand-maintained constants/ships.ts
// silently corrected. Title-case any fully-upper-case name so the harness's canonical
// name (and kit-bundle filenames/labels) stay mixed-case like every other ship.
function normalizeName(name: string): string {
    if (name.length > 1 && name === name.toUpperCase() && name !== name.toLowerCase()) {
        return name.charAt(0) + name.slice(1).toLowerCase();
    }
    return name;
}

// Mirrors transformShipTemplate (src/hooks/useShipsData.ts): rarity/affinity are
// lowercased to match RarityName/AffinityName; faction/type stay upper-case to
// match FactionName/ShipTypeName.
function transformRow(row: TemplateRow): ShipData {
    return {
        name: normalizeName(row.name),
        rarity: row.rarity.toLowerCase() as ShipData['rarity'],
        faction: row.faction as ShipData['faction'],
        role: row.type as ShipData['role'],
        affinity: row.affinity.toLowerCase() as ShipData['affinity'],
        imageKey: row.image_key ?? undefined,
        hp: row.base_stats.hp,
        attack: row.base_stats.attack,
        defense: row.base_stats.defence,
        hacking: row.base_stats.hacking,
        security: row.base_stats.security,
        critRate: row.base_stats.crit_rate,
        critDamage: row.base_stats.crit_damage,
        speed: row.base_stats.speed,
        shield: row.base_stats.shield,
        shieldPenetration: row.base_stats.shield_penetration,
        defensePenetration: row.base_stats.defense_penetration,
        activeTarget: row.active_target ?? undefined,
        activePattern: row.active_pattern ?? undefined,
        chargedTarget: row.charged_target ?? undefined,
        chargedPattern: row.charged_pattern ?? undefined,
    };
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
        console.error('No ship_templates rows returned — refusing to write an empty file');
        process.exit(1);
    }

    const records: ShipData[] = data.map(transformRow);
    writeFileSync(OUT_PATH, JSON.stringify(records, null, 2) + '\n');
    console.log(`Wrote ${records.length} ships to ${OUT_PATH}`);
}

main();
