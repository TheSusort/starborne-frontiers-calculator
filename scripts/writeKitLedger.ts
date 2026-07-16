/* eslint-disable no-console */
import { readFileSync, writeFileSync } from 'fs';
import { renderLedgerMarkdown, renderLedgerJson, LedgerInput } from './lib/kitLedger';

function main() {
    const inPath = process.argv[2];
    if (!inPath) {
        console.error('Usage: npm run audit:kit-ledger -- <findings.json>');
        process.exit(1);
    }
    const input = JSON.parse(readFileSync(inPath, 'utf8')) as LedgerInput;
    writeFileSync('docs/ship-kit-correctness-ledger.md', renderLedgerMarkdown(input));
    writeFileSync('docs/ship-kit-correctness-ledger.json', renderLedgerJson(input));
    console.log('Wrote docs/ship-kit-correctness-ledger.{md,json}');
}
main();
