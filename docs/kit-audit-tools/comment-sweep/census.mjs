import ts from 'typescript';
import fs from 'fs';
import { CLASSES } from './classes.mjs';


for (const f of process.argv.slice(2)) {
  const src = fs.readFileSync(f, 'utf8');
  const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  // collect all comment ranges by scanning trivia at every token
  const seen = new Set();
  const comments = [];
  const visit = (node) => {
    for (const r of [
      ...(ts.getLeadingCommentRanges(src, node.getFullStart()) ?? []),
      ...(ts.getTrailingCommentRanges(src, node.getEnd()) ?? []),
    ]) {
      const key = `${r.pos}:${r.end}`;
      if (seen.has(key)) continue;
      seen.add(key);
      comments.push({ pos: r.pos, end: r.end, text: src.slice(r.pos, r.end) });
    }
    node.forEachChild(visit);
  };
  visit(sf);
  comments.sort((a, b) => a.pos - b.pos);

  const counts = {};
  const hitComments = new Set();
  for (const c of comments) {
    for (const [name, re] of Object.entries(CLASSES)) {
      if (re.test(c.text)) {
        counts[name] = (counts[name] ?? 0) + 1;
        hitComments.add(c.pos);
      }
    }
  }
  console.log(`\n=== ${f}  (${comments.length} comment blocks, ${hitComments.size} with >=1 hit) ===`);
  for (const [k, v] of Object.entries(counts).sort((a,b)=>b[1]-a[1])) console.log(`  ${String(v).padStart(4)}  ${k}`);
}
