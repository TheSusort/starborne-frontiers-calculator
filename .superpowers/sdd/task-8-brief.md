### Task 8: Comment sweep, then the whole-branch gates

**Files:**
- Modify: `src/utils/calculators/healingEngineAdapter.ts:303-315,350,511-513`
- Modify: any comment surfaced by the sweep below

**Interfaces:** Consumes every prior task. Produces a merge-ready branch.

- [ ] **Step 1: Sweep the comments the contract falsified**

Deleting or changing behaviour obliges a comment sweep, and the claims *around* a change go stale as reliably as the change's own note — three of five stale comments on #318 were already stale from an earlier sub-project. Distinguish the two kinds: describes CURRENT behaviour → rewrite; historical rationale → keep the history, gloss the old name. Never delete rationale to make a grep clean.

Known sites:
- `healingEngineAdapter.ts:303-315` — the `enemies: []` is TEST-ONLY paragraph, and its claim that the page floors the roster at one. Both are now false; rewrite as the practice-target contract, keeping the measured 3,876 → 1,290 history.
- `healingEngineAdapter.ts:350` — "they still describe the dummy, which is the only opponent when `enemies` is EMPTY".
- `healingEngineAdapter.ts:511-513` + the `LEGACY_SINK_*` block — still correct for *unspecified stats on a supplied enemy*, but must no longer imply an empty roster reaches the sink.

Then sweep for anything else asserting that a run can have no opponent:

```bash
node -e "
const {execSync}=require('child_process');const fs=require('fs');
const files=execSync(\"find src -name '*.ts' -o -name '*.tsx'\",{encoding:'utf8'}).split('\n').filter(Boolean);
for(const f of files){const L=fs.readFileSync(f,'utf8').split('\n');
 L.forEach((l,i)=>{ if(/^\s*(\*|\/\/)/.test(l) && /(empty roster|enemies is EMPTY|no enemy|enemyAttackers.*empty)/i.test(l)) console.log(f+':'+(i+1)+': '+l.trim()); });}
"
```

Judge each hit; a comment that documents *history* stays.

- [ ] **Step 2: Attribute every moved golden**

```bash
git diff --stat 39d463f1..HEAD -- '*.snap'
git diff 39d463f1..HEAD -- '*.snap' | grep -cE '^[+-][^+-]'
```

Every moved line must map to a named mechanism, with the count of unclassified lines being **zero** — the 4b-2a gate (1160 moved lines, 0 unclassified). Write the attribution table into `.superpowers/sdd/progress.md`. State the gate's *scope* honestly in the PR body: the repo has few `.snap` files and none covers a direct `runCombat` fixture, so "zero snapshot movement" would be load-bearing only for the production callers.

- [ ] **Step 3: Run the full gate set**

```bash
npx tsc --noEmit; echo "tsc: $?"
npx eslint src; echo "eslint: $?"
npm test 2>&1 | tail -20
npx vitest run src/utils/combat/audit 2>&1 | tail -20
```

Expected: tsc 0, eslint 0, full suite green, placement-symmetry oracle at its baseline of **2 findings / 146 / 13-13-13**. An oracle count that moved is a finding to report, not a baseline to update.

- [ ] **Step 4: Browser-verify**

```bash
npm start
```

On `/healing`: remove every enemy and confirm the run still produces a result, that healing shows as overheal, and that the console is clean. Confirm a one-enemy run's healer output is unchanged by the enemy's removal (only incoming damage should differ). On `/damage`: confirm the page still runs. Record the actual numbers in the ledger — the 4b-1 `teamDamage: 0` regression was invisible to a green suite and visible in the browser.

- [ ] **Step 5: Update the ledger and commit**

```bash
git add -A && git commit -m "docs(sp4b2b): comment sweep and gate results"
```

---

## Self-Review

**Spec coverage.** §4 contract → Tasks 1, 3. §5 zero-enemy healing → Task 2 (including the constants module, the un-flooring, changelog and docs). §6 migration: (a) the 20 files → Tasks 4-6; (b) the ~95 base literals → Task 1; (c) the 3 healing callers → Task 2 Step 9. §7 both `dummyReachability` gaps → Task 7. §8 gates → Task 8. §2.5's dead branches → Task 3 Step 3. The stale field doc → Task 3 Step 4; the wider comment sweep → Task 8 Step 1.

**One deliberate divergence from the spec.** §6(b) proposed using the *suite* as the classifier for which base-literal files are behavioural. Task 1 supersedes that with a strictly better one: insert `enemyAttackers: []` (byte-equivalent to absent), so Task 1 is provably inert, and let Task 3's **throw** name the behavioural population loudly. This follows the epic's "design a classifier to fail in the LOUD direction" rule — a wrong classification becomes an error rather than a silent number change — and it means no file gets a real enemy inserted by a script.

**Names used across tasks:** `PRACTICE_TARGET_ID` and `practiceTarget()` (Task 2, consumed by Tasks 7-8 prose), `DEFAULT_ENEMY_{HP,DEFENCE,SECURITY,SPEED}` (Task 2), `effectiveEnemies` (Task 2), `__getDummySinkCreditCount` / `__resetDummySinkCreditCount` (Task 7), `bareEnemy()` / `bareInput()` (existing, Tasks 4-7). Checked consistent.
