/* eslint-disable no-console */
import { mkdirSync, writeFileSync } from 'fs';
import { loadShipSkillRecords, csvAvailable } from './lib/shipSkillCsv';
import { buildKitBundle, renderKitBundleMarkdown } from './lib/kitBundle';

const OUT_DIR = 'docs/kit-bundles';

function main() {
    if (!csvAvailable()) {
        console.error('docs/ship-skills.csv not found — nothing to trace.');
        process.exit(1);
    }
    const args = process.argv.slice(2);
    const names = args.includes('--all')
        ? loadShipSkillRecords().map((r) => r.name)
        : args.filter((a) => !a.startsWith('--'));
    if (names.length === 0) {
        console.error('Usage: npm run trace:ship -- --all | <ShipName> [<ShipName> ...]');
        process.exit(1);
    }
    mkdirSync(OUT_DIR, { recursive: true });
    let errors = 0;
    for (const name of names) {
        const bundle = buildKitBundle(name);
        if ('error' in bundle) errors++;
        const safe = name.replace(/[^\w-]/g, '_');
        writeFileSync(`${OUT_DIR}/${safe}.json`, JSON.stringify(bundle, null, 2));
        writeFileSync(`${OUT_DIR}/${safe}.md`, renderKitBundleMarkdown(bundle));
    }
    console.log(`Wrote ${names.length} kit bundles to ${OUT_DIR}/ (${errors} harness errors).`);
}
main();
