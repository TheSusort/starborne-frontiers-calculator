#!/usr/bin/env node
/**
 * SP-4b-2b Task 1: make `CombatEngineInput.enemyAttackers` required.
 *
 * `tsc` is the oracle. Each pass asks the compiler which object literals are now missing the
 * property and inserts `enemyAttackers: [],` as the literal's FIRST property, so a later
 * `...overrides` spread still wins — the base factories this touches exist to be overridden.
 *
 * ONE insertion per file per pass, then re-run. Two errors can point at the same literal, and a
 * line-independent pass would insert twice: exactly the duplicate-key failure the SP-4a codemod
 * hit (TS1117, 13 files / 19 sites). The fixpoint loop makes that unrepresentable.
 *
 * Acceptance gate is `tsc --noEmit` == 0 in a disposable worktree, NOT this script's own report.
 * `scripts/` is covered by neither tsc (tsconfig includes only `src`) nor `eslint src`, so a
 * dry-run report proves nothing.
 */
import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';

const ENGINE = 'src/utils/combat/engine.ts';
const MAX_PASSES = 12;

function tscErrors() {
    try {
        execSync('npx tsc --noEmit', { encoding: 'utf8', stdio: 'pipe' });
        return [];
    } catch (e) {
        const out = `${e.stdout ?? ''}${e.stderr ?? ''}`;
        return out
            .split('\n')
            .map((l) => l.match(/^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/))
            .filter(Boolean)
            .map((m) => ({ file: m[1], line: +m[2], col: +m[3], code: m[4], msg: m[5] }));
    }
}

/** Insert `enemyAttackers: [],` after the first `{` at or after (line, col). */
function insertAt(file, line, col) {
    const src = readFileSync(file, 'utf8');
    const lines = src.split('\n');
    let li = line - 1;
    let ci = lines[li].indexOf('{', col - 1);
    while (ci === -1) {
        li += 1;
        if (li >= lines.length) throw new Error(`no opening brace after ${file}:${line}`);
        ci = lines[li].indexOf('{');
    }
    const indent = (lines[li].match(/^(\s*)/) ?? ['', ''])[1] + '    ';
    lines[li] =
        lines[li].slice(0, ci + 1) + `\n${indent}enemyAttackers: [],` + lines[li].slice(ci + 1);
    writeFileSync(file, lines.join('\n'));
}

// 1. Flip the field to required.
const engine = readFileSync(ENGINE, 'utf8');
if (engine.includes('    enemyAttackers?: {')) {
    writeFileSync(ENGINE, engine.replace('    enemyAttackers?: {', '    enemyAttackers: {'));
    console.log('flipped enemyAttackers to required');
}

// 2. Fixpoint: one insertion per file per pass.
const inserted = new Map();
for (let pass = 1; pass <= MAX_PASSES; pass += 1) {
    const errs = tscErrors().filter((e) => e.msg.includes('CombatEngineInput'));
    if (errs.length === 0) {
        console.log(`clean after ${pass - 1} pass(es)`);
        break;
    }
    const seen = new Set();
    let n = 0;
    for (const e of errs) {
        if (seen.has(e.file)) continue;
        seen.add(e.file);
        insertAt(e.file, e.line, e.col);
        inserted.set(e.file, (inserted.get(e.file) ?? 0) + 1);
        n += 1;
    }
    console.log(`pass ${pass}: ${errs.length} error(s), ${n} insertion(s)`);
    if (pass === MAX_PASSES) throw new Error('did not converge — inspect remaining errors by hand');
}

console.log(`\n${inserted.size} file(s) touched, ${[...inserted.values()].reduce((a, b) => a + b, 0)} insertion(s)`);
