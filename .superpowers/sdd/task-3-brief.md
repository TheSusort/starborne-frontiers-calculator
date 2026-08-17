### Task 3: The boundary throws on an empty roster — and names the behavioural population

**The suite ends this task RED, by design.** The throw is the classifier: every fixture that was secretly running without an opponent now fails loudly and by name, which is strictly better than inferring the population from moved goldens.

**Files:**
- Modify: `src/utils/combat/normalizeRoster.ts`
- Modify: `src/utils/combat/engine.ts:1259` (the stale field doc)
- Create: the inventory in `.superpowers/sdd/progress.md`

**Interfaces:**
- Consumes: Task 1's required field.
- Produces: `normalizeCombatRoster` throws `Error('normalizeCombatRoster: enemyAttackers is empty — every run needs at least one opponent (SP-4b-2b). A caller with no enemy to model should synthesize an inert one, as healingEngineAdapter.practiceTarget does.')`. Later tasks rely on that message being greppable.

- [ ] **Step 1: Write the failing boundary test**

Append to `src/utils/combat/__tests__/normalizationBoundary.integration.test.ts`:

```ts
describe('the roster contract', () => {
    it('throws on an empty enemy roster rather than handing the run to the dummy', () => {
        expect(() => runCombat({ ...bareInput(), enemyAttackers: [] })).toThrow(
            /enemyAttackers is empty/
        );
    });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/utils/combat/__tests__/normalizationBoundary.integration.test.ts`
Expected: FAIL — the run completes instead of throwing.

- [ ] **Step 3: Add the guard, and delete the two branches it makes dead**

In `src/utils/combat/normalizeRoster.ts`, at the top of `normalizeCombatRoster`:

```ts
export function normalizeCombatRoster(input: CombatEngineInput): CombatEngineInput {
    // The contract (SP-4b-2b): every run has at least one opponent. This is a validation guard
    // rather than an accommodation on purpose — the boundary is the ONE place that accommodates an
    // under-specified input, and synthesizing a sink here is what kept the dummy alive.
    if (input.enemyAttackers.length === 0) {
        throw new Error(
            'normalizeCombatRoster: enemyAttackers is empty — every run needs at least one ' +
                'opponent (SP-4b-2b). A caller with no enemy to model should synthesize an inert ' +
                'one, as healingEngineAdapter.practiceTarget does.'
        );
    }
    const teamActors = input.teamActors ?? [];
    const enemyAttackers = input.enemyAttackers;
```

Then simplify the placement branch, now provably non-empty:

```ts
    const enemySlots = placeSide(
        enemyAttackers.map((e) => e.position),
        DEFAULT_ENEMY_SLOT,
        (i) => defaultEnemySlot(i + 1),
        resolveEnemySlots
    );
```

- [ ] **Step 4: Rewrite the stale field doc**

`src/utils/combat/engine.ts:1259` currently opens "Enemy attackers (healing mode)" and claims "The singular dummy `enemy` remains the player-offense target + DoT carrier" — false since 4b-1, and the sort of stale comment that produced a confident, well-argued, wrong CodeRabbit finding on #324. Replace the lead-in:

```ts
    /** The opposing roster — REQUIRED on every run since SP-4b-2b, and never empty (the boundary
     *  throws). Real ships carrying stats + `shipSkills`, positioned by `normalizeCombatRoster`
     *  when they arrive without a slot. A caller with no enemy to model synthesizes an inert one
     *  rather than passing `[]`; see `healingEngineAdapter.practiceTarget`. */
```

- [ ] **Step 5: Produce the inventory**

```bash
npx vitest run 2>&1 | tee /tmp/sp4b2b-throw-inventory.txt | tail -40
grep -c "enemyAttackers is empty" /tmp/sp4b2b-throw-inventory.txt
grep -oE "src/[^ :]+\.test\.tsx?" /tmp/sp4b2b-throw-inventory.txt | sort -u
```

Write the resulting file list into `.superpowers/sdd/progress.md` under "Task 3 inventory", with a per-file count of failing tests. Expected around 20 files (the measured population at `39d463f1`), all failing with the contract message. **A file failing for any other reason is a finding, not churn — record it separately and report it.**

- [ ] **Step 6: Commit the red state deliberately**

```bash
git add -A
git commit --no-verify -m "feat(engine): an empty enemy roster is a validation error

RED BY DESIGN: the throw is the classifier for the fixture population that was
running with no opponent. Inventory in .superpowers/sdd/progress.md; Tasks 4-6
repair it. --no-verify because husky runs the suite, which is red on purpose."
```

---

