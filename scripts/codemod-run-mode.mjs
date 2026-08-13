/**
 * ONE-SHOT codemod for SP-4a. Deleted once the migration is committed.
 *
 * Rules, in precedence order (mirroring engine.ts's transitional derivation exactly):
 *   1. `positionalTeamBattle: true`  -> replaced by `mode: 'battle'`
 *   2. an object-literal `healTargetId: <value>` property -> `mode: 'healing',` inserted after it
 * A file already containing a `mode:` run-mode literal is skipped (idempotent).
 *
 * Deliberately conservative: it only matches an object-literal PROPERTY line, never a type
 * annotation (`healTargetId?: string`) and never a member access (`input.healTargetId`).
 * Anything it cannot classify is reported as residue for hand-migration, never guessed at.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const APPLY = process.argv.includes('--apply');

const files = execSync(
    "grep -rl 'healTargetId\\|positionalTeamBattle' src --include='*.ts' --include='*.tsx'",
    { encoding: 'utf8' }
)
    .split('\n')
    .filter((f) => f.includes('__tests__'));

// `healTargetId:` as an object-literal property with a real value. Excludes type annotations by
// requiring the value not to start with a TS primitive/type keyword.
const HEAL_PROP = /^(\s*)healTargetId:\s*(?!(?:string|undefined|never)\b)\S.*$/;
const PTB_TRUE = /^(\s*)positionalTeamBattle:\s*true\s*,?\s*$/;
const ALREADY = /\bmode:\s*'(?:dps|healing|battle)'/;

const changed = [];
const residue = [];

for (const file of files) {
    const src = readFileSync(file, 'utf8');
    if (ALREADY.test(src)) continue;

    const lines = src.split('\n');
    const out = [];
    let edits = 0;

    for (const line of lines) {
        const ptb = line.match(PTB_TRUE);
        if (ptb) {
            out.push(`${ptb[1]}mode: 'battle',`);
            edits++;
            continue;
        }
        out.push(line);
        const heal = line.match(HEAL_PROP);
        if (heal) {
            out.push(`${heal[1]}mode: 'healing',`);
            edits++;
        }
    }

    if (edits === 0) {
        // The file mentions one of the symbols but exposes no migratable property line —
        // a member access, a type, or a shape the codemod refuses to guess at.
        residue.push(file);
        continue;
    }
    changed.push(`${file}  (+${edits})`);
    if (APPLY) writeFileSync(file, out.join('\n'));
}

console.log(`${APPLY ? 'APPLIED' : 'DRY RUN'} — ${changed.length} files edited`);
for (const c of changed) console.log(`  ${c}`);
console.log(`\nRESIDUE — ${residue.length} files need a human (Task 6):`);
for (const r of residue) console.log(`  ${r}`);
