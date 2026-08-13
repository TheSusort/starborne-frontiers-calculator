/**
 * ONE-SHOT codemod for SP-4a. Deleted once the migration is committed.
 *
 * Precedence rule (mirrors engine.ts's transitional derivation exactly):
 *   1. `positionalTeamBattle: true` -> `mode: 'battle'` — wins ALWAYS, even when the same
 *      object literal also carries `healTargetId`.
 *   2. an object-literal `healTargetId: <value>` property -> `mode: 'healing',` inserted
 *      after it, but ONLY if its enclosing object literal does not already carry a `mode:`
 *      property (from rule 1's insert, or a pre-existing one).
 * A file already containing a `mode:` run-mode literal ANYWHERE is skipped whole (idempotent).
 *
 * Implementation is two passes over each file, so precedence is structural, not an accident of
 * which property happens to appear later in the source:
 *   Pass 1 — textually replace every `positionalTeamBattle: true` line with `mode: 'battle',`.
 *   Pass 2 — for every qualifying `healTargetId:` property line in the pass-1 result, find its
 *   enclosing object literal via an explicit brace-depth stack scan (every `{` is matched to its
 *   `}` as a distinct occurrence, so two object literals opened on the same source line are still
 *   paired correctly) and insert `mode: 'healing',` after it UNLESS that exact enclosing object
 *   already has a `mode:` line as a direct child (not a nested sub-object's).
 *
 * Limitation: brace counting strips ordinary `'...'`/`"..."` string bodies per line first, so a
 * `{`/`}` character living inside a quoted string isn't miscounted. Template-literal `${...}`
 * expression braces are NOT specially handled. None of the corpus needed this as of this
 * writing (verified via `--debug-print`, see task-3-report.md) — if a future file trips it, the
 * dry-run report is the safety net: inspect that file's transform by hand before trusting it.
 *
 * Deliberately conservative: it only matches an object-literal PROPERTY line, never a type
 * annotation (`healTargetId?: string`) and never a member access (`input.healTargetId`).
 * Anything it cannot classify is reported as residue for hand-migration, never guessed at.
 * A THIRD category, inline call-argument overrides (e.g. `fn({ healTargetId: 'attacker' })` or
 * `...helper({ ..., healTargetId: 'attacker' })`), is also never edited — reported separately,
 * because the file it lives in usually gets OTHER automatic edits too and would otherwise never
 * surface in the residue list.
 *
 * FINDING 4 fix: a `healTargetId:` property line is NOT proof the enclosing object is
 * `runCombat`'s `CombatEngineInput` — the healing CALCULATOR's `HealingSimulationInput`
 * (`simulateHealing`) also has this field, but has no `mode`. Inserting `mode:` there is a type
 * error (TS2353), confirmed by a full-corpus `tsc --noEmit` in a disposable worktree (48 errors,
 * see task-3-report.md Fix wave 2). `classifyEnclosure` resolves, from evidence in the source
 * text alone, whether the enclosing object literal is:
 *   - 'ENGINE'    — CombatEngineInput (directly, via a `runCombat(` call, or via a same-file
 *                   helper whose own signature names `CombatEngineInput`) -> gets `mode:`.
 *   - 'HEALING'   — HealingSimulationInput (directly, via a `simulateHealing(` call, or via a
 *                   same-file helper naming `HealingSimulationInput`) -> never gets `mode:`.
 *   - null        — cannot be resolved from local evidence (e.g. a call to a function imported
 *                   from another module, whose signature isn't visible in this file) -> the
 *                   occurrence is excluded from edits and, if it's the file's only structural
 *                   hit, the whole file falls to residue. Never guessed.
 * See `classifyEnclosure`'s own comment for the climb-and-resolve algorithm.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const APPLY = process.argv.includes('--apply');

// --debug-print (optionally --debug-print=<substring>) prints the transformed text of every
// edited file (or only ones whose path includes <substring>) to stdout. Never writes anything —
// safe to use instead of --apply to inspect a transform. Kept in the script; useful for Task 4's
// verification too.
const DEBUG_ARG = process.argv.find((a) => a === '--debug-print' || a.startsWith('--debug-print='));
const DEBUG_PRINT = Boolean(DEBUG_ARG);
const DEBUG_FILTER = DEBUG_ARG && DEBUG_ARG.includes('=') ? DEBUG_ARG.slice(DEBUG_ARG.indexOf('=') + 1) : null;

const files = execSync(
    "grep -rl 'healTargetId\\|positionalTeamBattle' src --include='*.ts' --include='*.tsx'",
    { encoding: 'utf8' }
)
    .split('\n')
    .filter((f) => f.includes('__tests__'));

// `healTargetId:` as an object-literal property with a real value. Excludes type annotations by
// requiring the value not to start with a TS primitive/type keyword, and excludes an explicit
// empty-string value (which, like `undefined`, genuinely means DPS mode — no heal target).
const HEAL_PROP = /^(\s*)healTargetId:\s*(?!(?:string|undefined|never|null)\b)(?!'')(?!"")\S.*$/;
const PTB_TRUE = /^(\s*)positionalTeamBattle:\s*true\s*,?\s*$/;
const ALREADY = /\bmode:\s*'(?:dps|healing|battle)'/;
const MODE_LINE = /^\s*mode:\s*'(?:dps|healing|battle)'/;

// Detects `healTargetId:` used inline — e.g. as a call-argument override merged onto a base
// object — rather than as its own object-literal property line. Requires non-whitespace content
// BEFORE the match on the same line (a plain property line, HEAL_PROP's territory, has only
// leading whitespace before it), excludes a literal member-access `.healTargetId:`, skips comment
// lines (which only ever mention `healTargetId:` in prose — JSDoc, `//` notes, test-description
// strings), and requires the character immediately before the match to be `{` or `,` so a
// function-parameter type annotation like `(healTargetId: 'tank' | 'ally') =>` — preceded by a
// bare `(`, not an object-literal opener/separator — is correctly left alone.
function findInlineOverrides(lines) {
    const hits = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmedLine = line.trim();
        if (trimmedLine.startsWith('//') || trimmedLine.startsWith('/*') || trimmedLine.startsWith('*')) {
            continue; // comment line
        }
        const idx = line.indexOf('healTargetId:');
        if (idx === -1) continue;
        const prefix = line.slice(0, idx).trimEnd();
        if (prefix === '') continue; // plain property line — HEAL_PROP's territory
        if (prefix.endsWith('.')) continue; // member-access-shaped, not a property key
        const lastChar = prefix[prefix.length - 1];
        if (lastChar !== '{' && lastChar !== ',') continue; // not object-literal-shaped
        hits.push(i + 1); // 1-indexed line number
    }
    return hits;
}

// Strips ordinary single/double-quoted string bodies so the brace-matching below isn't fooled by
// a literal `{`/`}` character sitting inside a string. See header limitation re: template literals.
function stripStrings(line) {
    return line.replace(/'(?:[^'\\]|\\.)*'/g, "''").replace(/"(?:[^"\\]|\\.)*"/g, '""');
}

// Brace-depth scan over the whole file: matches every `{` to its `}` as a distinct occurrence
// (so two object literals opened on the same source line still pair correctly). Returns, per
// line, which currently-open object-literal occurrence (if any) directly encloses that line's
// own content — i.e. the top of the brace stack BEFORE that line's own braces are processed —
// plus the occurrence's open/close line lookup tables.
function computeEnclosures(lines) {
    const stack = []; // occurrence indices, in open order
    const pushLine = [];
    const closeLine = [];
    const enclosingOccOfLine = new Array(lines.length).fill(-1);

    for (let i = 0; i < lines.length; i++) {
        enclosingOccOfLine[i] = stack.length ? stack[stack.length - 1] : -1;
        const stripped = stripStrings(lines[i]);
        for (const ch of stripped) {
            if (ch === '{') {
                const occ = pushLine.length;
                pushLine.push(i);
                closeLine.push(-1);
                stack.push(occ);
            } else if (ch === '}') {
                const occ = stack.pop();
                if (occ !== undefined) closeLine[occ] = i;
            }
        }
    }
    return { enclosingOccOfLine, pushLine, closeLine };
}

// True if the object literal directly enclosing `lineIdx` already contains a `mode:` property
// line as one of ITS OWN direct children (not one belonging to a nested sub-object).
function enclosingAlreadyHasMode(lineIdx, lines, enclosures) {
    const occ = enclosures.enclosingOccOfLine[lineIdx];
    if (occ === -1) return false; // no enclosing object literal found — nothing to protect against
    const start = enclosures.pushLine[occ];
    const end = enclosures.closeLine[occ] === -1 ? lines.length - 1 : enclosures.closeLine[occ];
    for (let j = start; j <= end; j++) {
        if (j === lineIdx) continue;
        if (enclosures.enclosingOccOfLine[j] === occ && MODE_LINE.test(lines[j])) return true;
    }
    return false;
}

// Text immediately preceding the `{` that opens enclosure occurrence at `pushLine[occ]` — walks
// back across earlier lines only when the opening line has nothing but whitespace before its own
// `{` (e.g. a lone `? {` continuation), so a multi-line ternary/call still yields real context.
function precedingContext(lines, pushLineIdx) {
    let lineIdx = pushLineIdx;
    const braceCol = lines[lineIdx].lastIndexOf('{');
    let context = lines[lineIdx].slice(0, braceCol);
    let steps = 0;
    while (context.trim() === '' && lineIdx > 0 && steps < 5) {
        lineIdx--;
        context = `${lines[lineIdx]} ${context}`;
        steps++;
    }
    return context.trim();
}

// Scans `ctx` right-to-left tracking paren balance to find the nearest UNMATCHED `(` — i.e. the
// call this object literal is an argument of, even when other arguments/nested calls sit between
// the call name and the object (`counterBase(skills, {`, `dpsBase(skillsFor(ruiner), {`). Returns
// the identifier immediately before that `(`, or null if the context has no open call (a bare
// `return`, a ternary `?`, a spread `...(`, or a variable/return type annotation).
function findEnclosingCallName(ctx) {
    let balance = 0;
    for (let i = ctx.length - 1; i >= 0; i--) {
        const ch = ctx[i];
        if (ch === ')') {
            balance++;
        } else if (ch === '(') {
            if (balance === 0) {
                let j = i - 1;
                while (j >= 0 && /\s/.test(ctx[j])) j--;
                const end = j + 1;
                while (j >= 0 && /[A-Za-z0-9_$]/.test(ctx[j])) j--;
                const name = ctx.slice(j + 1, end);
                return name || null;
            }
            balance--;
        }
    }
    return null;
}

// Resolves a same-file helper's declaration (`const NAME = (...)`/`function NAME(`) and inspects
// its own signature (declaration line + next 15 lines — every real signature in this corpus
// names its type within a line or two) for CombatEngineInput / HealingSimulationInput. Returns
// 'ENGINE' | 'HEALING' | null (no local declaration found, or found but names neither type —
// e.g. `resolveHealingPlayerPlacement`, imported from healingPlacement.ts with an inline
// unrelated arg type — never guessed at).
function resolveLocalDeclaration(name, lines) {
    const declRe = new RegExp(
        `^\\s*(?:export\\s+)?(?:const|let)\\s+${name}\\s*[=:]|^\\s*(?:export\\s+)?function\\s+${name}\\s*\\(`
    );
    for (let i = 0; i < lines.length; i++) {
        if (declRe.test(lines[i])) {
            const windowText = lines.slice(i, Math.min(lines.length, i + 15)).join('\n');
            if (windowText.includes('CombatEngineInput')) return 'ENGINE';
            if (windowText.includes('HealingSimulationInput')) return 'HEALING';
            return null;
        }
    }
    return null;
}

// Classifies the object literal directly enclosing `lineIdx` as 'ENGINE' (CombatEngineInput —
// gets `mode:`), 'HEALING' (HealingSimulationInput or any other non-engine shape — never gets
// `mode:`), or null (unresolvable from local evidence — never guessed, becomes residue).
//
// Climbs through enclosing levels that carry no type information of their own — a bare `return`
// object, a ternary `cond ? { ... }`, or a spread `...(cond ? { ... } : {})` folded into a larger
// literal — until it reaches a level with either a visible type annotation (`): CombatEngineInput
// => (`, `const X: HealingSimulationInput =`) or a call site (`runCombat(`, `simulateHealing(`,
// or a same-file helper resolved via `resolveLocalDeclaration`). A call site is always terminal:
// once the object is confirmed to be somebody's call ARGUMENT, that call's own parameter type
// governs it — climbing past the call to whatever textually encloses the call EXPRESSION would
// not describe this object's type at all.
function classifyEnclosure(lineIdx, lines, enclosures) {
    let occ = enclosures.enclosingOccOfLine[lineIdx];
    let depth = 0;
    while (occ !== -1 && depth < 20) {
        const ctx = precedingContext(lines, enclosures.pushLine[occ]);
        if (ctx.includes('CombatEngineInput')) return 'ENGINE';
        if (ctx.includes('HealingSimulationInput')) return 'HEALING';
        const callName = findEnclosingCallName(ctx);
        if (callName) {
            if (callName === 'runCombat') return 'ENGINE';
            if (callName === 'simulateHealing') return 'HEALING';
            return resolveLocalDeclaration(callName, lines); // terminal — ENGINE | HEALING | null
        }
        occ = enclosures.enclosingOccOfLine[enclosures.pushLine[occ]];
        depth++;
    }
    return null;
}

const changed = [];
const residue = [];
const inlineOverrides = []; // { file, lines: [lineNo, ...] }
const healingSkipped = []; // { file, line } — confidently classified as a healing-calc input
const unresolvedSkipped = []; // { file, line } — could not classify; never guessed

for (const file of files) {
    const src = readFileSync(file, 'utf8');
    const rawLines = src.split('\n');

    const inlineHits = findInlineOverrides(rawLines);
    if (inlineHits.length) inlineOverrides.push({ file, lines: inlineHits });

    if (ALREADY.test(src)) continue;

    // Pass 1: positionalTeamBattle: true -> mode: 'battle',
    const pass1 = [];
    let edits = 0;
    let structuralHits = 0; // HEAL_PROP/PTB_TRUE lines seen, regardless of what happens next
    for (const line of rawLines) {
        const ptb = line.match(PTB_TRUE);
        if (ptb) {
            pass1.push(`${ptb[1]}mode: 'battle',`);
            edits++;
            structuralHits++;
        } else {
            pass1.push(line);
        }
    }

    // Pass 2: healTargetId: <value> -> mode: 'healing', inserted after it, UNLESS the enclosing
    // object literal already has a mode: line (from pass 1, or pre-existing) OR the enclosing
    // object literal is NOT a CombatEngineInput at all (FINDING 4 — e.g. the healing calculator's
    // HealingSimulationInput, which also has `healTargetId` but no `mode`).
    const enclosures = computeEnclosures(pass1);
    const out = [];
    let fileUnresolved = 0;
    for (let i = 0; i < pass1.length; i++) {
        const line = pass1[i];
        out.push(line);
        const heal = line.match(HEAL_PROP);
        if (!heal) continue;
        structuralHits++;
        if (enclosingAlreadyHasMode(i, pass1, enclosures)) continue;
        const classification = classifyEnclosure(i, pass1, enclosures);
        if (classification === 'ENGINE') {
            out.push(`${heal[1]}mode: 'healing',`);
            edits++;
        } else if (classification === 'HEALING') {
            healingSkipped.push({ file, line: i + 1 });
        } else {
            unresolvedSkipped.push({ file, line: i + 1 });
            fileUnresolved++;
        }
    }

    if (edits === 0) {
        if (structuralHits === 0 || fileUnresolved > 0) {
            // Either the file mentions one of the symbols but exposes no migratable property
            // line (a member access, a type, or a shape the codemod refuses to guess at), or it
            // has a structural hit the classifier could not resolve (never guessed).
            residue.push(file);
        }
        // Else: every structural hit resolved confidently to HEALING — this file's inputs are
        // correctly typed already; nothing to do, and it's not residue either.
        continue;
    }
    changed.push(`${file}  (+${edits})`);
    if (APPLY) writeFileSync(file, out.join('\n'));

    if (DEBUG_PRINT && (!DEBUG_FILTER || file.includes(DEBUG_FILTER))) {
        console.log(`\n----- TRANSFORMED (not written — --debug-print only): ${file} -----`);
        console.log(out.join('\n'));
        console.log(`----- end ${file} -----`);
    }
}

console.log(`${APPLY ? 'APPLIED' : 'DRY RUN'} — ${changed.length} files edited`);
for (const c of changed) console.log(`  ${c}`);
console.log(`\nRESIDUE — ${residue.length} files need a human (Task 5):`);
for (const r of residue) console.log(`  ${r}`);

const inlineCount = inlineOverrides.reduce((n, o) => n + o.lines.length, 0);
console.log(
    `\nINLINE OVERRIDES — ${inlineCount} occurrence(s) in ${inlineOverrides.length} file(s), need hand-migration (Task 5, never auto-edited):`
);
for (const { file, lines: ls } of inlineOverrides) {
    for (const ln of ls) console.log(`  ${file}:${ln}`);
}

console.log(
    `\nHEALING-CALC SKIPPED (FINDING 4) — ${healingSkipped.length} healTargetId site(s) confidently ` +
        `classified as a healing-calculator input (HealingSimulationInput or similar), never given mode:`
);
for (const { file, line } of healingSkipped) console.log(`  ${file}:${line}`);

console.log(
    `\nUNRESOLVED (FINDING 4) — ${unresolvedSkipped.length} healTargetId site(s) could not be classified ` +
        `as engine or healing input from local evidence; never guessed, left for hand-migration (Task 5):`
);
for (const { file, line } of unresolvedSkipped) console.log(`  ${file}:${line}`);
