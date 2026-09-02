# Combat comment sweep — the remainder

**Date:** 2026-09-02
**Branch:** `comment-sweep-remainder` (off `origin/main` @ `4abf141c`)
**Predecessor:** PR #457 (`16c3f1a4`) — the mechanical pass
**Policy this enforces:** `CLAUDE.md` § Code Comments

## Problem

PR #457 removed dead workstream labels, hard line-number pointers, and stale claims from
`src/utils/combat` comments — but only where the removal was *mechanical*. It deliberately
refused every block where the dead label is the **subject of the sentence** ("SP-4c-2a made it
constant", "this whole apply used to sit behind…"), because stripping the subject breaks the
grammar and rewriting is where a true comment becomes a false one.

That refusal left a remainder. This spec covers it.

The argument for doing the work is #457's own finding: **eight comments turned out to be
provably FALSE, not merely stale** — `chargeBefore`/`chargeMax` claiming "filled by a later
task; 0 for now" when both were filled and rendered; `selectNextBySpeed` marked "UNWIRED" when
it drives every turn; `shieldPenetration` "read in later tasks" when it is `shieldAbsorb`'s
`penPct`. Comments are the only channel that survives a context reset, and an agent reads them
literally. A false comment is worse than no comment.

## Scope

Measured across **all 75 non-test files** in `src/utils/combat` at `origin/main`, not just the
three the prior handoff named. The handoff's scope was incomplete:

| Scope | Files | Blocks with ≥1 candidate hit |
| --- | --- | --- |
| `engine.ts` | 1 | 438 |
| `triggers.ts` | 1 | 181 |
| `playerTurn.ts` | 1 | 153 |
| `statusEngine.ts` | 1 | 20 |
| 17 small files | 17 | 26 |
| **Total** | **21** | **818** |

Per-class breakdown for the big three:

| File | workstream-label | history-claim | pending-claim | count-enum |
| --- | --- | --- | --- | --- |
| `engine.ts` | 304 | 153 | 23 | 14 |
| `triggers.ts` | 143 | 63 | 3 | 0 |
| `playerTurn.ts` | 112 | 56 | 5 | 0 |

Test files are **out of scope** — #457 already swept all 388 of them.

**One PR for all 21 files** (owner's call, 2026-09-02).

## The classifier is a finder, not a verdict

`docs/kit-audit-tools/comment-sweep/census.mjs` parses each file with `ts.createSourceFile`,
collects every comment block via leading/trailing trivia ranges, and tests each against five
regex classes. It **locates candidates**. It does not decide anything.

Spot-checking proves why the distinction matters. Real hits and false positives sit side by side:

- `log__types.ts:65` — `reactions` "(filled by a later task; [] for now)" — the *exact* shape of
  #457's provably-false `chargeBefore`/`chargeMax`. A real hit.
- `adjacency.ts:23` — "Wave 5 hardening: if the anchor isn't in this roster…" — real dead label.
- `thresholdShield.ts:12` — "the ability has not yet fired this battle" — a **legitimate
  present-tense contract**. The regex matched "not yet". Leave it alone.
- `highestAttack.ts:7` — "#407: the `isLiving` predicate parameter was REMOVED." — history, but
  it carries a **keeper** issue ref. Judgement call, not a mechanical strip.

Every hit is read against the surrounding code before anything is touched.

### Keep

- Bare issue refs as rationale pointers (`#436`, `#407`, `#363`) — git-stable and resolvable.
- Present-tense behaviour contracts, verifiable against nearby code.
- Pointers to the one place a rule lives.

### Dead vocabulary to remove

`Task N` · `SP-*` · `PRn` · `D-PRn` · `Wave N` · `Phase N` · `Wn` · `A2 Task` / `H1 Task` ·
`bySide PRn` · `epic PRn` · `Ship-kit Wn`

## Three outcomes per block — the third is the deliverable

**1. Wiring / reader claims** — "no production reader until H1 Task 4 wires the apply path",
"unread until A2 Task 4", "Task 9 provides real value", "no reader until PR5b flips them".

Grep for the reader. If one exists, rewrite as a present-tense contract that names it. If there
genuinely is none, say so without the task number. Cheap to verify, safe to rewrite.

**2. Change history, counts, rules restated at N call sites, warnings where a test belongs** —
delete, per policy classes 1–4. Archaeology is `git log -L :<symbol>:<file>`. If the block also
carries a live rule, keep the rule and drop the history.

**3. Behaviour claims that CONTRADICT the code** — "clamped at X", "skips Y", "folds Z".

**Do not rewrite these silently.** Rewriting a comment to match the code assumes the code is
right, and that is exactly the assumption a sweep is not entitled to make. Log each one as a
finding — file:line, the claim, the contradicting evidence — and leave the call to the owner.
Game-behaviour questions go to the owner with a concrete in-fight example; they are never
inferred from the code.

**That findings list is this PR's real output**, the way #457's eight false comments were its
argument. A comment that was lying about behaviour is a candidate bug signal, not just noise.

## Delete-first default

When a rewrite requires knowledge that cannot be verified from nearby code, **delete rather than
reword**. Policy already says a comment that needs its PR to parse belongs in the PR. Deletion is
always safe under the token oracle; rewriting is where a true comment becomes false.

## Gates

**`tokenOracle.mjs`** — rebuilt from the recipe (the #457 tooling was gitignored and died with
its worktree). Parse both versions with `ts.createSourceFile`, walk to leaf tokens, diff. Green =
every code byte identical. Three instrument bugs it must avoid, each of which produced FALSE
FAILURES before being fixed:

1. `ts.createScanner` mis-parses template literals — use `createSourceFile`.
2. JSDoc nodes are children under `setParentNodes` and must be skipped.
3. A `.ts` file parsed as `ScriptKind.TSX` turns `a < b` into JSX whose text swallows comments —
   always `ScriptKind.TS`.

**The oracle is BLIND to comment content** — its own fourth bug class. In #457 an empty-paren
cleanup stripped `()` off function names in prose (`detonate()` → `detonate`) and the oracle
stayed green, because comments are not code. So: **oracle green is necessary, never sufficient.
Every diff gets read.**

Full gate list:

- `tokenOracle.mjs` green after every batch
- the diff read in full, by a reviewer who is not the author of that batch
- `npx tsc --noEmit`
- `npm test` — the whole suite (the golden audit spans all of it)
- `npm run lint` — **not hooked**, must be run explicitly
- prettier per project config (comment rewrites change line wrapping)

**Tripwire: if any golden snapshot moves, the change was not comment-only. Stop and diagnose.**
Never `vitest -u`.

## Execution

Four parallel implementers, each in its own worktree, each owning a disjoint file set — so no two
agents ever touch the same file:

| Agent | Files | Blocks |
| --- | --- | --- |
| A | `engine.ts` | 438 |
| B | `triggers.ts` | 181 |
| C | `playerTurn.ts` | 153 |
| D | `statusEngine.ts` + 17 small files | 46 |

Agent A batches `engine.ts` internally by region (type/construction declarations, round loop,
apply path) with the oracle after each batch.

Each agent emits a **per-block verification note** — claim → evidence → action — so the
orchestrator's diff review is reviewing decisions, not re-deriving them. A reviewer is never run
beside an implementer in one tree.

The orchestrator reviews every diff, then collects all 21 files onto `comment-sweep-remainder`
for the single PR.

## Success criteria

1. Token oracle green across all 21 files — zero code bytes changed.
2. `tsc`, full `npm test`, `lint`, prettier all clean; **no golden snapshot moved**.
3. Every remaining candidate hit is either fixed or has a recorded reason to keep it — no silent
   skips.
4. The PR body carries the findings list from outcome 3: every comment that contradicted the
   code, with evidence, as owner questions.
