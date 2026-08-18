### Task 4: Repair wave A — the two highest-count files

**Files (2 files / 75 tests):**
- `src/utils/combat/__tests__/healing.test.ts` (39 tests)
- `src/utils/combat/__tests__/engine.events.test.ts` (36 tests)

These two carry 30% of the whole inventory and are almost certainly one base-factory fix each, so
they come first: they are the cheapest test of whether the recipe below actually works before it is
applied 60 more times.

**Interfaces:**
- Consumes: Task 3's inventory and the greppable contract message `enemyAttackers is empty`.
- Produces: nothing new. Later waves reuse this recipe.

- [ ] **Step 1: Stand up a base-commit worktree**

```bash
git worktree add /tmp/sp4b2b-base 39d463f1
```

Use `cp -a`, never `cp -r`, if you copy `node_modules` into it — plain `cp -r` dereferences the
`.bin/tsc` symlink, after which `tsc` runs, reports zero errors, and validates nothing. That
false-good already nearly slipped through this branch.

Every wave in the prior sub-project that measured against a base worktree separated real defects from
assumed churn; the one hypothesis table written without one was mechanically wrong on 3 of 10 files.
Use it for any number you are about to call churn.

- [ ] **Step 2: Give each failing run a real enemy**

Replace the `enemyAttackers: []` that Task 1 inserted with a real opponent. Prefer the shared fixture
so 64 files do not invent 64 different enemies:

```ts
import { bareEnemy } from '../__testutils__/bareRosterFixture';
// …
enemyAttackers: bareEnemy(),
```

`bareEnemy()` is one 0-attack, skill-less, 500,000-HP enemy with no explicit position — the
normalization boundary places it. Where a fixture needs the enemy in a particular cell, give it an
explicit `position` rather than fighting the default.

**Fix the base factory, not each call site**, where the file has one — that is why these files repair
39 and 36 tests at once.

- [ ] **Step 3: Classify every remaining failure against a NAMED mechanism**

After the roster is real, some assertions will still move. Each one is attributed to one of these or
to a new named mechanism you write down — never absorbed:

- **M1** the dummy's turn is gone (`dummyEnemyIsVestigial` is true), so a fixture filtering on the
  actor id `enemy` must filter on `attacker`.
- **M2** the enemy ACTS: one zero-damage `ability-performed` per round, so event COUNTS moved. Filter
  on the focus id — do not re-pin the count. (`engine.events.test.ts` is the likeliest home for this.)
- **M3** per-victim credit replaces scalar credit: read `perTargetDealt`, not `cumulativeDamage`. Use
  the shared helper `src/utils/combat/__testutils__/perTargetDealt.ts` (`dealtEntries` / `dealtBy` /
  `dealtBySource`) rather than re-writing the nested reduce.
- **M4** `front` selection scans ROWS from the caster's own row before the front-most column, so the
  enemy often needs the victim's ROW, not just column 4 (which is the FRONT).

A 0-attack enemy emits NO `attacked` event at all (a zero-damage hit is skipped, not emitted as a 0),
but it DOES take a turn and emit a zero-damage `ability-performed`. **`deaths` is not a routing
discriminator; `perTargetDealt` is** — a subagent earlier in this epic concluded "damage lands
nowhere" from `deaths: []` when the damage had landed on a different but real actor.

- [ ] **Step 4: Repair the fixture, never the assertion**

Deleting, skipping, or widening an assertion to absorb a move is out of bounds, and so is re-pinning
a `> 0` to `toBe(0)` — that exact substitution happened on an earlier PR in this epic, on a fixture
shaped like the production page, and it passed review. If a fixture's premise has genuinely
evaporated (for instance `mostBuffsAmong` returns undefined against an unbuffed enemy, so a
most-buffs selector proc DROPS entirely rather than shifting), fix the fixture's SETUP — buff the
enemy — or escalate. Do not pin the drop.

- [ ] **Step 5: Verify**

```bash
npx vitest run src/utils/combat/__tests__/healing.test.ts src/utils/combat/__tests__/engine.events.test.ts
```

Expected: all 75 green, every changed line explained in your report.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "test(engine): wave A — real enemy roster for the two highest-count fixtures"
```

---

