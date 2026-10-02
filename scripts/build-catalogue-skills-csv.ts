/* eslint-disable no-console */
/**
 * Writes docs/ship-skills.catalogue.csv: docs/ship-skills.csv with every skill column replaced by
 * the official catalogue's text, rendered exactly as `sync:catalogue` would write it
 * (toCatalogueTemplate). Rows keep the current CSV's order and format, so after the cutover's text
 * write `fetch:ship-skills` should reproduce this file byte for byte (ships the gate held aside).
 * A column pinned in TEXT_PINS keeps the current CSV's text, as the sync keeps it (see `planSync`).
 *
 * Usage: npm run build:catalogue-skills [-- --refresh]
 * The crawl is cached at docs/catalogue-units.json; --refresh re-crawls.
 * Joins on ship_templates.definition_id (anon key; ship_templates is publicly readable).
 */
import 'dotenv/config';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';
import { fetchCatalogueIndex, fetchCatalogueUnits } from './lib/catalogueFetch';
import { toCatalogueTemplate, type SkillColumns } from './lib/catalogueMapping';
import { pinsFor, TEXT_PINS, withPinnedText } from './lib/catalogueTextPins';
import type { CatalogueUnit } from './lib/catalogueSchema';
import { loadShipSkillRecords, toCsvField } from './lib/shipSkillCsv';

const CACHE = 'docs/catalogue-units.json';
const OUT = 'docs/ship-skills.catalogue.csv';
const HEADER =
    'name,active_skill_text,charge_skill_charge,charge_skill_text,first_passive_skill_text,second_passive_skill_text,third_passive_skill_text';

const main = async () => {
    let units: CatalogueUnit[];
    if (existsSync(CACHE) && !process.argv.includes('--refresh')) {
        units = JSON.parse(readFileSync(CACHE, 'utf8')).units;
    } else {
        const index = await fetchCatalogueIndex();
        units = await fetchCatalogueUnits(index.slugs);
        writeFileSync(CACHE, JSON.stringify({ manifest: index.manifest, units }));
    }
    const byId = new Map(units.map(toCatalogueTemplate).map((t) => [t.definitionId, t]));

    const url = process.env.VITE_SUPABASE_URL;
    const key = process.env.VITE_SUPABASE_ANON_KEY;
    if (!url || !key) throw new Error('VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY missing');
    const { data, error } = await createClient(url, key).from('ship_templates').select('name, definition_id');
    if (error) throw new Error(error.message);
    const idOf = new Map((data ?? []).map((r) => [r.name as string, r.definition_id as string | null]));

    const lines = [HEADER];
    const unmatched: string[] = [];
    const mappingErrors: string[] = [];
    const pinnedSlots: string[] = [];
    // `loadShipSkillRecords` reads a null charge cost as 0; `|| null` writes it back as null.
    for (const r of loadShipSkillRecords()) {
        const t = byId.get(idOf.get(r.name) ?? '');
        if (!t) {
            unmatched.push(r.name);
            lines.push([r.name, r.active, r.chargeCharge || null, r.charge, ...r.passives].map((v) => toCsvField(v === '' ? null : v)).join(','));
            continue;
        }
        if (t.mappingErrors.length) mappingErrors.push(`${r.name}: ${t.mappingErrors.join('; ')}`);
        const current: SkillColumns = {
            active_skill_text: r.active || null,
            charge_skill_text: r.charge || null,
            first_passive_skill_text: r.passives[0] || null,
            second_passive_skill_text: r.passives[1] || null,
            third_passive_skill_text: r.passives[2] || null,
        };
        for (const p of pinsFor(t.definitionId, TEXT_PINS)) pinnedSlots.push(`${r.name} ${p.column}`);
        const s = withPinnedText(t.definitionId, current, t.skills, TEXT_PINS);
        lines.push(
            [r.name, s.active_skill_text, t.chargeSkillCharge ?? (r.chargeCharge || null), s.charge_skill_text,
                s.first_passive_skill_text, s.second_passive_skill_text, s.third_passive_skill_text]
                .map(toCsvField).join(',')
        );
    }
    writeFileSync(OUT, lines.join('\n') + '\n');
    console.log(`Wrote ${lines.length - 1} ships to ${OUT}`);
    if (unmatched.length) console.log(`Kept current text (no catalogue match): ${unmatched.join(', ')}`);
    if (pinnedSlots.length) console.log(`Kept current text (pinned): ${pinnedSlots.join(', ')}`);
    if (mappingErrors.length) console.log(`Mapping errors:\n  ${mappingErrors.join('\n  ')}`);
};

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
