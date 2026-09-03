#!/usr/bin/env node
/**
 * blocks.mjs — enumerate candidate comment blocks for the sweep.
 *
 * Usage:
 *   node blocks.mjs <file> [<file>...]            # human-readable
 *   node blocks.mjs --json <file> [<file>...]     # machine-readable
 *   node blocks.mjs --from <line> --to <line> f   # region batch
 *
 * THIS IS A FINDER, NOT A VERDICT. It matches five regex classes against comment
 * text to LOCATE candidates. Plenty of hits are legitimate comments that merely
 * contain a trigger word ("has not yet fired this battle" is a present-tense
 * contract, not a pending-work claim). Every hit must be read against the
 * surrounding code before it is touched.
 */
import ts from 'typescript';
import fs from 'fs';
import { CLASSES } from './classes.mjs';


const requireInt = (flag, value) => {
    if (value === undefined || !/^\d+$/.test(value)) {
        console.error(`${flag} requires a non-negative integer (got ${value ?? 'nothing'})`);
        process.exit(2);
    }
    return Number(value);
};

const argv = process.argv.slice(2);
let json = false;
let from = 0;
let to = Infinity;
const files = [];
for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--json') json = true;
    // Validate: `Number(undefined)` is NaN, and every comparison against NaN is false, so a
    // missing or non-numeric bound silently disables range filtering and returns the WHOLE file
    // — a batch agent would then sweep outside its assigned range without any error.
    else if (argv[i] === '--from') from = requireInt('--from', argv[++i]);
    else if (argv[i] === '--to') to = requireInt('--to', argv[++i]);
    else files.push(argv[i]);
}

const collect = (file) => {
    const src = fs.readFileSync(file, 'utf8');
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const seen = new Set();
    const out = [];
    const visit = (node) => {
        for (const r of [
            ...(ts.getLeadingCommentRanges(src, node.getFullStart()) ?? []),
            ...(ts.getTrailingCommentRanges(src, node.getEnd()) ?? []),
        ]) {
            const key = `${r.pos}:${r.end}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const text = src.slice(r.pos, r.end);
            const hits = Object.entries(CLASSES)
                .filter(([, re]) => re.test(text))
                .map(([n]) => n);
            if (hits.length === 0) continue;
            const startLine = sf.getLineAndCharacterOfPosition(r.pos).line + 1;
            const endLine = sf.getLineAndCharacterOfPosition(r.end).line + 1;
            if (endLine < from || startLine > to) continue;
            out.push({ file, startLine, endLine, classes: hits, text });
        }
        node.forEachChild(visit);
    };
    visit(sf);
    return out.sort((a, b) => a.startLine - b.startLine);
};

const all = files.flatMap(collect);

if (json) {
    console.log(JSON.stringify(all, null, 2));
} else {
    for (const b of all) {
        console.log(`\n--- ${b.file}:${b.startLine}-${b.endLine}  [${b.classes.join(', ')}]`);
        console.log(b.text);
    }
    console.log(`\n${all.length} candidate block(s).`);
}
