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
| `tokenOracle.mjs [--base <ref>] <file>...` | did this edit change the CODE token stream? |

## tokenOracle.mjs — what it proves, and what it does not

Parses the base version (from git) and the working-tree version, walks both to **leaf tokens**,
and diffs the streams. GREEN = **the leaf-token stream is identical** (plus the ASI tags below);
only comments and whitespace moved. Exit 1 on RED, exit 2 if nothing was checked.

Note the guarantee is a TOKEN-STREAM one, not literally "every byte". Whitespace between tokens is
invisible to it — which matters in exactly one place, handled next.

Three instrument bugs it avoids. Each produced **false failures** in the first build:

1. `ts.createScanner` mis-parses template literals → use `createSourceFile`.
2. JSDoc nodes are children under `setParentNodes` and must be **skipped**, or comment text leaks
   into the token stream and every JSDoc edit reads as a code change.
3. A `.ts` file parsed as `ScriptKind.TSX` turns `a < b` into JSX whose text swallows comments →
   always `ScriptKind.TS`.

### The fifth bug class: AUTOMATIC SEMICOLON INSERTION

A leaf-token diff discards the newlines BETWEEN tokens, so splitting a `return` statement across a
newline produces an **identical token stream** while JavaScript parses the split form as a bare
`return;`. Raised in review, then reproduced: the oracle called exactly that edit *"zero code bytes
changed"*.

Fixed by tagging the **restricted productions** (`return`, `throw`, `break`, `continue`, `yield`)
with whether the next token is still on the same line, so the tag rides in the token stream. `tsc`
catches the fallout independently — but an oracle should not lie.

### The fourth bug class: THE ORACLE IS BLIND TO COMMENT CONTENT

Comments are not code, so the oracle stays green through any prose defect. In #457 an
empty-paren cleanup stripped `()` off function names in prose (`detonate()` → `detonate`) and the
oracle never noticed.

**Oracle green is necessary, never sufficient. Read the diff.**

### Validation probes (re-run these if you touch the oracle)

An instrument you have not seen report both outcomes is not an instrument. All six must hold:

| Probe | Expected |
| --- | --- |
| unmodified file | GREEN |
| edit a `//` comment | GREEN |
| edit text inside a **JSDoc body** | GREEN (the bug-2 probe; a `//` edit will not catch it) |
| append `export const X = 1;` | RED, exit 1 |
| **split `return value;` across a newline** | RED (the bug-5/ASI probe — token COUNT is unchanged, so only the ASI tag catches it) |
| pass a path that does not exist at base | exit 2, "NOTHING CHECKED" — a skip is not a pass |

Verify the probe edit actually landed (`git diff --stat`) before believing its result — a
substitution that matched nothing yields a **vacuous GREEN**.

## blocks.mjs / census.mjs are FINDERS, not verdicts

They match the `classes.mjs` regex classes against comment text to locate candidates. Many hits are
legitimate comments that merely contain a trigger word:

- `thresholdShield.ts:12` "the ability has not yet fired this battle" — a present-tense contract.
  Leave it.
- `highestAttack.ts:7` "#407: the `isLiving` parameter was REMOVED" — history, but carries a
  **keeper** issue ref.

Read every hit against the surrounding code before touching it.
