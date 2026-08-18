### Task 7: `dummyReachability` — close both recorded gaps

The file's own header says a zero there is **not** SP-4c's go-ahead, for two independent reasons. Both close here, because 4c is about to lean on this file.

**Files:**
- Modify: `src/utils/combat/__tests__/dummyReachability.test.ts`
- Modify: `src/utils/combat/engine.ts:1717-1722` (counter machinery), `:6770` (player-side `applyToVictim`)
- Modify: `src/utils/combat/__testutils__/bareRosterFixture.ts` (fixtures for the new paths)

**Interfaces:**
- Consumes: the contract from Task 3.
- Produces: `__getDummySinkCreditCount()` and `__resetDummySinkCreditCount()` exported from `engine.ts`.

- [ ] **Step 1: Write the failing counter test**

The existing counter records **consultations** of `tb.legacyVictim` (`engine.ts:7027`), not credits to the sink, and the two legitimately come apart: in the mid-run whiff window the fallback is consulted and nothing is booked. So 4c cannot demand that number be zero. Add a second counter that records damage actually **booked against the dummy**, and pin the two apart:

```ts
describe('sink credits are distinct from fallback consultations', () => {
    beforeEach(() => {
        setupKeyedTestRng(12345);
        __resetLegacyVictimFallbackCount();
        __resetDummySinkCreditCount();
    });

    // POSITIVE CONTROL — without it a zero below could mean the counter was never wired.
    // A roster whose only member has max HP 0 holds no targetable victim, so resolution falls
    // through to the dummy AND books against it.
    it('counts a credit when the only enemy is untargetable', () => {
        runCombat({
            ...bareInput(),
            enemyAttackers: [{ ...bareEnemy()[0], stats: { ...bareEnemy()[0].stats, hp: 0 } }],
        });
        expect(__getDummySinkCreditCount()).toBeGreaterThan(0);
    });

    // The distinction that makes the new counter worth having.
    it('a live roster consults nothing and credits nothing', () => {
        runCombat(bareInput());
        expect(__getLegacyVictimFallbackCount()).toBe(0);
        expect(__getDummySinkCreditCount()).toBe(0);
    });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/utils/combat/__tests__/dummyReachability.test.ts`
Expected: FAIL — `__getDummySinkCreditCount` is not exported.

- [ ] **Step 3: Add the counter**

Beside the existing machinery at `engine.ts:1717-1722`:

```ts
/**
 * Damage actually BOOKED against the vestigial dummy — distinct from
 * `legacyVictimFallbackCount`, which counts CONSULTATIONS of `tb.legacyVictim`. The two come
 * apart in the mid-run whiff window, where the fallback is consulted and nothing is booked, so
 * this is the number SP-4c can require to be zero.
 */
let dummySinkCreditCount = 0;
export function __getDummySinkCreditCount(): number {
    return dummySinkCreditCount;
}
export function __resetDummySinkCreditCount(): void {
    dummySinkCreditCount = 0;
}
```

Increment it where damage is applied to a victim that IS the dummy — the player-side `applyToVictim` binding around `engine.ts:6770`, whose `legacyVictim` is the dummy `enemy` (`:6761`). Note the enemy-side binding's `legacyVictim` is the *heal target* (`:6775`), a real player actor: that is not a dummy credit and must not be counted. Confirm the site by making the positive control pass and the negative control still hold — if only one of the two can be satisfied, you are on the wrong site.

- [ ] **Step 4: Widen the coverage to the five uncovered paths**

The file exercises `bareInput()` — one focus-attacker damage path. Add a case per uncovered path named in its header: **team-actor turns**, **enemy turns**, **corpse targeting**, **death retargeting**, and **walked-team damage**. Put any new fixture shapes in `src/utils/combat/__testutils__/bareRosterFixture.ts`, never in the `.test.ts` file — importing from a `.test.ts` module executes its `describe` blocks as a side effect, running the suites twice under two seeds.

**Each case must be shown to reach the code it claims to cover.** A zero from a case that never exercised its path is the "no goldens moved can mean nothing covers this" trap in counter form. Prove it per case: assert something positive about the path itself (a team actor dealt damage, an enemy took a turn, a corpse was targeted) alongside the zero.

- [ ] **Step 5: Invert the empty-roster case and update the header**

The "STILL takes it with an empty roster" test becomes:

```ts
    it('cannot be reached through an empty roster any more — the boundary throws', () => {
        expect(() => runCombat({ ...bareInput(), enemyAttackers: [] })).toThrow(
            /enemyAttackers is empty/
        );
    });
```

Rewrite the file header: both recorded gaps are closed, so it should now say what the file *does* guarantee (five paths, credits vs consultations) and what SP-4c still has to handle (the whiff window consults the fallback without booking).

- [ ] **Step 6: Verify and commit**

```bash
npx vitest run src/utils/combat/__tests__/dummyReachability.test.ts
npm test 2>&1 | tail -20
git add -A && git commit -m "test(engine): dummy reachability covers five paths and counts sink credits"
```

---

