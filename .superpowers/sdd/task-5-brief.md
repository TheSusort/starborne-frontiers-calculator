### Task 5: Repair wave B — the next two highest-count files

**Files (2 files / 41 tests):**
- `src/utils/combat/__tests__/triggers.test.ts` (23 tests)
- `src/utils/combat/__tests__/equipmentAbilities.integration.test.ts` (18 tests)

- [ ] **Step 1: Apply Task 4's recipe to these two files**

Read Task 4's brief in full for the recipe — the four named mechanisms, the `bareEnemy()` fixture, the
`perTargetDealt` helper path, and the base worktree at `/tmp/sp4b2b-base`. Do not work from a summary
of it.

`equipmentAbilities.integration.test.ts` is the one file where a gear-injected standing leech may
appear (`buildEquipmentAbilities.ts` injects `leechScope:'all'` shapes). A leech that now pays out on
a DoT tick is expected — Task 2b fixed that deliberately. A leech paying zero on a **detonation
burst** is a known, documented gap, not something to fix here.

- [ ] **Step 2: Verify and commit**

```bash
npx vitest run src/utils/combat/__tests__/triggers.test.ts src/utils/combat/__tests__/equipmentAbilities.integration.test.ts
git add -A && git commit -m "test(engine): wave B — real enemy roster for triggers and equipment abilities"
```

---

