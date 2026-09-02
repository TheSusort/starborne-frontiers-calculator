# comment-sweep tooling

Tooling for the `src/utils/combat` comment sweep. The policy it enforces is the
`### Code Comments` section of `CLAUDE.md`.

**This directory is force-added to git on purpose.** The PR #457 build of this tooling was left
gitignored, lived only in a worktree, and was lost when that worktree was deleted — so the
remainder sweep had to rebuild it from a memory note. Do not un-track it.

## The three tools

| Tool | Answers |
| --- | --- |
| `census.mjs <file>...` | how many candidate blocks per file, per class |
| `blocks.mjs [--json] [--from N --to N] <file>...` | which blocks, with line ranges and text |
| `tokenOracle.mjs [--base <ref>] <file>...` | did this edit change any CODE byte? |

## tokenOracle.mjs — what it proves, and what it does not

Parses the base version (from git) and the working-tree version, walks both to **leaf tokens**,
and diffs the streams. GREEN = every code byte identical; only trivia moved. Exit 1 on RED.

Three instrument bugs it avoids. Each produced **false failures** in the first build:

1. `ts.createScanner` mis-parses template literals → use `createSourceFile`.
2. JSDoc nodes are children under `setParentNodes` and must be **skipped**, or comment text leaks
   into the token stream and every JSDoc edit reads as a code change.
3. A `.ts` file parsed as `ScriptKind.TSX` turns `a < b` into JSX whose text swallows comments →
   always `ScriptKind.TS`.

### The fourth bug class: THE ORACLE IS BLIND TO COMMENT CONTENT

Comments are not code, so the oracle stays green through any prose defect. In #457 an
empty-paren cleanup stripped `()` off function names in prose (`detonate()` → `detonate`) and the
oracle never noticed.

**Oracle green is necessary, never sufficient. Read the diff.**

### Validation probes (re-run these if you touch the oracle)

An instrument you have not seen report both outcomes is not an instrument. All four must hold:

| Probe | Expected |
| --- | --- |
| unmodified file | GREEN |
| edit a `//` comment | GREEN |
| edit text inside a **JSDoc body** | GREEN (this is the bug-2 probe; a `//` edit will not catch it) |
| append `export const X = 1;` | RED, exit 1 |

Verify the probe edit actually landed (`git diff --stat`) before believing its result — a
substitution that matched nothing yields a **vacuous GREEN**.

## blocks.mjs / census.mjs are FINDERS, not verdicts

They match five regex classes against comment text to locate candidates. Many hits are
legitimate comments that merely contain a trigger word:

- `thresholdShield.ts:12` "the ability has not yet fired this battle" — a present-tense contract.
  Leave it.
- `highestAttack.ts:7` "#407: the `isLiving` parameter was REMOVED" — history, but carries a
  **keeper** issue ref.

Read every hit against the surrounding code before touching it.
