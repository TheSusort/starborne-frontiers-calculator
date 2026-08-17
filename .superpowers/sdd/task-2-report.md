# Task 2 Report: A zero-enemy healing run becomes a real scenario

Branch `feat/sp4b2b-enemy-roster-required`, base `4104adbc` (Task 1).

## 1. The four-reader verification (brief item 1)

I did not trust the brief's count. I scanned the WHOLE adapter, not just past line 325, because a
reader above the destructure would have been invisible to the brief's own one-liner.

**Before** — `grep -n '\benemies\b'` over `healingEngineAdapter.ts`:

```
50, 102, 106, 285, 296, 303, 309, 350   comments
119                                      interface field  (EnemyAttackerInput[])
331                                      the destructure
503, 504, 505, 507                       CODE READERS  <- exactly four
```

The brief's list (`:503,:504,:505,:507`) was **correct and complete**. There is no `input.enemies`
reader, no aliased destructure, and no reader above `:331`.

**After** — the brief's Step 6 one-liner, widened to the whole file and excluding `effectiveEnemies`:

```
56, 108, 112, 267, 326, 337, 344, 350, 379, 396   comments
125                                                interface field
372                                                the destructure
```

**Zero surviving code readers.** Every one of the four now goes through `effectiveEnemies`.

## 2. Files

**Created**

- `src/utils/calculators/healingDefaultEnemy.ts` — the four shared default-enemy-card constants
  (`DEFAULT_ENEMY_HP` 40,000, `DEFAULT_ENEMY_DEFENCE` 5,000, `DEFAULT_ENEMY_SECURITY` 100,
  `DEFAULT_ENEMY_SPEED` 50). Imports nothing, per the brief's cycle reasoning.
- `src/utils/calculators/__tests__/healingPracticeTarget.test.ts` — 3 tests (see §4 for the two
  fixture corrections the brief's version needed).
- `src/pages/calculators/__tests__/HealingCalculatorPage.zeroEnemies.test.tsx` — the end-to-end
  consequence: emptying the roster still renders a result.

**Modified**

- `healingEngineAdapter.ts` — added `PRACTICE_TARGET_ID`, the `practiceTarget()` factory, the
  `effectiveEnemies` line, and rewrote the three stale comment blocks that asserted the floor and
  called `enemies: []` a test-only shape.
- `HealingCalculatorPage.tsx` — deleted the three local `DEFAULT_ENEMY_*` consts for the shared
  import; `removeEnemy` no longer floors; the ⚠️ block rewritten keeping the 3,876 → 1,290 history.
- `EnemyAttackersPanel.tsx` — `canRemove={enemies.length > 1}` → `canRemove`; the `:245-246` comment
  and the `canRemove` prop doc (`:62`, which the brief did not list) both rewritten.
- `changelog.ts` — new entry, and see §6.
- `DocumentationPage.tsx` — removed the now-false "the last one cannot be removed" sentence and added
  an "An empty enemy team measures pure output" paragraph.
- `healingGoldenParity.test.ts` + its `.snap`, `healingEngineAdapter.test.ts`,
  `dpsSubAttackEvents.integration.test.ts`, `HealingCalculatorPage.test.tsx`,
  `EnemyAttackersPanel.test.tsx` — see §3 and §5.

## 3. The fixture audit

Full table, mechanisms and the isolation method are in `progress.md`, written **before** any
regeneration as the brief required. Summary:

| Fixture | Assertion | Old | New | Explained by |
|---|---|---|---|---|
| goldenParity sc 9 (Magnolia) snap + in-code | r1 `directHeal` | 1258 | 417 | defence 10,000→5,000 (+159) **and** inferno-tick leech 1000→0 (pre-existing) **and** killable (rounds 7-10 → 0) |
| goldenParity sc 9 | `totalDirectHeal` | 12579 | 2499 | same three |
| goldenParity sc 10 (Tithonus) | `directHeal`/round | 181 | 292 | **defence only** (0.07×1289.708=90 → 0.07×2082.797=146, ×2 recipients); target survives all 10 rounds |
| goldenParity sc 10 | `totalDirectHeal` | 1806 | 2916 | same |
| goldenParity sc 11 (Valkyrie) | `totalDirectHeal` | 129 | 0 | **pre-existing**, not the rebase |
| goldenParity sc 13 (Defiant) | snapshot | no `perTargetDealt` | populated | field presence only, zero value movement |
| dpsSubAttackEvents on-crit | `performed.length` | 3 | 4 | the practice target's own 0-damage turn |

**Isolation method.** I decomposed every move by probe and isolated each candidate mechanism by
re-running the same scenario with an explicit enemy at (a) the sink's exact stats and (b) the
practice target's stats, against **both** the modified and the **unmodified** adapter. Every
explicit-enemy probe returned byte-identical numbers on both adapters, which proves my change is a
strict no-op for any non-empty roster; so anything that reproduces at sink stats on the unmodified
adapter is pre-existing. Cast damage moves purely with defence: 1289.708 → 2082.797 (×1.615).

Verification the regeneration stayed in bounds: every removed value line in the `.snap` diff is one
of exactly three sets — 1258 (sc 9), 181/90 (sc 10), 129 (sc 11). Nothing else moved, Defiant's diff
is purely additive, and `git status` shows exactly **one** `.snap` file touched repo-wide.

`healingEngineAdapter.test.ts` needed **no** change: all 33 tests pass unmodified, including
`empty enemies: no intake` (attack 0 still means no intake). The brief predicted it would move.

### ⚠️ Two pre-existing defects exposed — reported, NOT fixed

A `basis:'damage-dealt'` standing leech with a non-direct `leechScope` pays **zero** against a real
positioned enemy, and always has. `leechScope:'all'` misses DoT ticks (sc 9: the inferno DOES land —
`perTargetDealt` R1 = 6289.708 = cast 1289.708 + inferno 5,000 — but only the cast is leeched);
`leechScope:'detonation'` pays nothing at all (sc 11: `[0,0,0,0]` for an explicit enemy at the sink's
own stats on the unmodified adapter). Both credits existed **only** on the dummy path, so the gap has
been live in production since SP-3, and these two goldens were its last observers.

This is SP-4b-2a's lesson in mirror image: there, production migrated ahead of its corpus. Here the
corpus was the last holdout exercising a path production abandoned in SP-3. Regenerating is correct —
the goldens now record what every production run does — but it deletes the last observer, which is
why it is in `progress.md` and in an inline ⚠️ on both scenarios. Needs its own task.

### Incidental correction to the brief's Step 4 rationale

The brief's comment implies corrosion reads the practice target's HP today. It does not:
`engine.ts:1054` reads `args.enemyHp`, the fight-wide scalar the adapter still passes as
`LEGACY_SINK_HP`. Measured: the inferno tick is 5,000 against a 1,000,000-HP and a 40,000-HP victim
alike (inferno scales off the **applier's attack**, `engine.ts:1065`). Detonation is the one already
reading the real victim (`detonation.ts:106`). I kept the reasoning as brief item 4 requires but
re-tensed it as forward-looking to SP-4d — the conclusion (do not inflate HP) is unchanged and
strengthened, since inflating now would bank a distortion SP-4d silently switches on.

## 4. Deviations from the brief, and why

1. **The brief's test fixture would not compile.** Its heal config was `{ type: 'heal', multiplier: 100 }`
   but the type is `{ type: 'heal', pct, basis }`, and it put `security` on `HealerStats`, which has
   no such field. Rewritten against the conventions in `healingPositionalEnemy.test.ts`.
2. **The brief's third test was vacuous.** Its kit was a pure heal, whose amount does not depend on
   the opponent's defence — so "zero enemies == one default card" would have passed with the practice
   target at defence 0, exactly the drift the test exists to prevent. I gave the kit a damage clause
   plus a `basis:'damage-dealt'` rider and added an explicit anti-vacuity guard (defence 0 yields
   strictly more healing). The stat basis is now genuinely pinned.
3. **Test 1 asserts the victim by name.** `perTargetDealt.attacker` must contain
   `practice-target` — populated only by the per-victim positional apply, and the position-less dummy
   never appears in it. That is a direct proof of *which* opponent was fought, which the brief's
   presence-only assertions could not give.
4. **Two floor tests the brief did not list.** `HealingCalculatorPage.test.tsx:126` and
   `EnemyAttackersPanel.test.tsx:199` both pinned the old floor and failed. Rewritten to pin the new
   contract, keeping their anti-vacuity structure and their measured history. The panel one I also
   strengthened: it now asserts the last card's control is *wired* (`onRemove` called), not merely
   rendered — a control that appears but reports nothing would strand the roster just as effectively.
5. **`dpsSubAttackEvents` fixed by sharpening, not re-pinning.** The `3` is preserved; I added the
   `actorId !== FOCUS` filter. That is not an invention — `runCollectingPerformed` in the same file
   already carries exactly this filter with a comment explaining SP-4b-2a hit the identical situation.
   Re-pinning 3 → 4 would have turned a fan-out cardinality assertion into an assertion about how
   many actors happen to be on the board.
6. **`DEFAULT_ENEMY_SPEED` is used by the page too.** The brief said only three numbers move. Making
   the page's `defaultEnemyStats` use the fourth as well (identical value, 50) is numerically inert
   and stops the module shipping a "shared so they cannot drift" constant that only one side uses.
7. **`hacking` deliberately omitted from the practice target** rather than given a fifth constant: an
   absent `hacking` already defaults to the engine's 200, which is what the page's card seeds, and a
   kitless actor lands no debuffs anyway. Documented in both files.
8. **`EnemyAttackersPanel.tsx:62`** (the `canRemove` prop doc) also asserted the floor. Not in the
   brief's file list; rewritten.

## 5. Commands run

```
npx vitest run src/utils/calculators/__tests__/healingPracticeTarget.test.ts      # RED, then 3 passed
npx vitest run src/utils/calculators/__tests__/healingGoldenParity.test.ts -u     # 4 updated, 53 passed
```

Regeneration was a single-file `-u`, once, after the audit was written down. No suite-wide `-u`.
Probes ran as a temporary `__probe.test.ts`, deleted after; the adapter swap for the
pre-existing-defect proof was restored and verified by `git diff --stat`.

## 6. Changelog

The unreleased entry `'Healing calculator: the enemy team can no longer be emptied — the last enemy
keeps its place…'` is falsified by this task. Since it never shipped, I split it: the still-true
enemy-real-targeting half kept as its own entry, the floor half replaced by the new entry. Shipping
both would have put a direct contradiction in one release's notes.

## 7. Verification

| Check | Result |
|---|---|
| `npx tsc --noEmit` | exit **0** |
| `npx eslint src` | exit **0** |
| `npx prettier --check` (all touched files) | exit **0** (DocumentationPage needed `--write`) |
| `npm test` | **527 files / 5832 tests, all passing** |
| `.snap` movement | exactly one file, the audited golden |

Task 1's baseline was 525 files / 5828 tests; +2 files / +4 tests are the two new suites, so no test
was lost or skipped. No assertion was weakened, deleted, skipped, or re-pinned to absorb a move.

## Fix wave 1

Review found 3 comment-accuracy issues (1 Important, 1 Minor) plus 1 Minor dead-code item on
Task 2. No behaviour, assertion, or golden changed — comments and one dead prop only.

### Finding 1 (Important) — corrosion's HP basis was stated backwards

The Task 2 comments said corrosion "is insensitive to [practice-target HP] until SP-4d" because it
reads the fight-wide `args.enemyHp` scalar, not the victim's own HP. That is backwards. Verified in
source: the per-victim positional DoT-tick branch (`engine.ts:8741`) passes
`enemyHp: recipientMaxHp(actor.id)` — the AFFLICTED ship's own max HP — and this is the ONLY branch
that calls `creditDealt(sourceId, actor.id, dealt)` for a DoT tick (`engine.ts:8806`), i.e. the one
that populates the `perTargetDealt` entry Task 2's own scenario-9 assertion reads. The practice
target sits in `baseHpById` via `enemyAttackerActors` (`engine.ts:2753-2758`), so it runs this
branch. The bare `args.enemyHp` scalar only reaches `tickDoTs` through the vestigial
`actor.id === enemy.id` dummy branch (`engine.ts:9450`), which the practice target never takes.

So corrosion ALREADY scales off the practice target's own 40,000 HP today — inflating that HP to
make the target immortal would immediately multiply every corrosion tick against it by the same
ratio (e.g. 12.5× at 500,000). Re-tensed all three sites to present tense, kept the correct inferno
half (attack-scaled, `engine.ts:1065`, unaffected either way):
  - `src/utils/calculators/healingEngineAdapter.ts:276-284` (practice-target doc comment)
  - `src/utils/calculators/__tests__/healingGoldenParity.test.ts` (scenario-9 damage-constants
    comment, the Inferno-tick line)
  - `.superpowers/sdd/progress.md` ("Incidental finding — corrects the brief's Step 4 rationale")

### Finding 2 (Minor) — one of two leech-gap claims overstated production impact

`healingGoldenParity.test.ts` scenario 11 (Valkyrie, `leechScope:'detonation'`) claimed the gap "has
been live in production since SP-3," the same wording used for scenario 9's (`leechScope:'all'`)
gap. The two are not equally supported:
  - `'all'` (scenario 9, Magnolia): production-reachable — Magnolia's own standing self leech, and
    the identical shape is injected by gear (`buildEquipmentAbilities.ts:52`, the LEECH set).
  - `'detonation'` (scenario 11, Valkyrie): the only real-ship producer of this shape is Valkyrie's
    Echoing Burst leech (`skillTextParser.ts` ~4335-4338), which is `on-bomb-detonated` and therefore
    REACTIVE — it is partitioned out of `standingLeeches` before it can reach the gap at all
    (`engine.ts:3860-3866`, which says explicitly "no corpus ship reaches it here … Valkyrie's `ally`
    one is `on-bomb-detonated`, so it is reactive and never enters this map"). The code gap is real;
    the "live in production" claim for this half is not supported.

Softened only the scenario-11 half to say the gap is real but probably corpus-unreachable, with the
engine.ts/buildEquipmentAbilities.ts/skillTextParser.ts citations above. Scenario 9's stronger
wording (production-reachable) is kept as-is. No assertion touched.

Note: the review cited this finding's location as `healingGoldenParity.test.ts:527-535`; the text
matching the finding's description (the "live in production since SP-3" claim needing to be split
by scope) is the scenario-11 block, currently at lines ~619-627 post-edit — fixed by content match
against the cited engine.ts/buildEquipmentAbilities.ts evidence rather than by literal line number.

### Finding 3 (Minor) — dead `canRemove` branch in EnemyAttackersPanel

`canRemove` was hardcoded `true` at its only call site (`EnemyAttackersPanel.tsx:249` pre-fix) and
`EnemyCard` is module-private, so the `canRemove === false` branch was unreachable with no test
covering it. Removed the prop entirely from `EnemyCard`'s type and destructure, render the remove
`Button` unconditionally, dropped the "Kept as a prop … so a caller with its own reason to withhold
the control still can" speculative doc line, and removed the `canRemove` pass at the call site.
Checked both `EnemyAttackersPanel.test.tsx` and `HealingCalculatorPage.test.tsx` for any reference to
`canRemove` by name — none exists; the existing "removable including the last" tests assert on
rendered behaviour (the button/its click), not the prop, so nothing needed to change there.

### Verification

| Check | Result |
|---|---|
| `npx tsc --noEmit` | exit **0** |
| `npx eslint src` | exit **0** |
| `npx prettier --check` (4 touched files) | exit **0** |
| `npx vitest run src/components/calculator/__tests__/EnemyAttackersPanel.test.tsx src/pages/calculators/__tests__/HealingCalculatorPage.test.tsx src/pages/calculators/__tests__/HealingCalculatorPage.zeroEnemies.test.tsx src/utils/calculators/__tests__/healingGoldenParity.test.ts` | **4 files / 76 tests, all passing** |
| `.snap` movement | **zero** (`git status --short` shows only the 4 comment/dead-code files touched) |

No assertion weakened, skipped, or deleted. No golden regenerated.
