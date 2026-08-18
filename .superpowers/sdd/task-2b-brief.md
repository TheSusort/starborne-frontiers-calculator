### Task 2b: A `damage-dealt` standing leech pays out on a positional DoT tick

**Added mid-flight (owner ruling, 2026-08-17).** Task 2's audit exposed two pre-existing engine defects, both masked by the dummy path and confirmed in source by the task reviewer: a `basis:'damage-dealt'` standing leech pays **zero** against a real positioned enemy unless its scope is `direct`.

- **`leechScope: 'all'` misses DoT ticks.** The positional per-victim DoT-tick branch's `credit` callback (`engine.ts:8755-8775`) accumulates into `total` / `tickDealtBySource` / `perActorDot` but never calls `creditDamage` — and `creditDamage` is the only thing that procs `procStandingLeeches` (`engine.ts:4122-4124`). **Production-reachable:** Magnolia's self leech is a passive standing `'all'` leech, and `buildEquipmentAbilities.ts:52` injects the same shape from gear. **This half is in scope.**
- **`leechScope: 'detonation'` pays nothing.** `procStandingLeechesPerVictim` explicitly `continue`s on `scope === 'detonation'` (`engine.ts:3849-3851`) and the positional burst is deliberately never routed through `creditDamage(actor.id, 'detonation')` (`engine.ts:6913`, `:9546`). **Corpus-unreachable:** its only producer is the "Echoing Burst explodes" parse (Valkyrie), whose leech is `on-bomb-detonated` and so is reactive-partitioned out of `standingLeeches` before it reaches the gap (`engine.ts:3860-3866`). **Out of scope — tripwire only.**

**Files:**
- Modify: `src/utils/combat/engine.ts` (the per-victim DoT-tick credit path)
- Create: `src/utils/combat/__tests__/positionalDotLeech.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks. Produces: no new exports.

- [ ] **Step 1: Write the failing test**

A focus attacker with a corrosion/DoT applier and a standing `basis:'damage-dealt'`, `leechScope:'all'` self-leech, against one real positioned enemy. Assert the leech pays out on the round the DoT ticks — read the heal from the run's heal buckets, and assert the tick itself landed (`perTargetDealt`) so the test cannot pass by the DoT silently not ticking.

Include a `leechScope: 'direct'` control in the same file: it already pays out, so if the control ever goes red the fix has broken the working path.

- [ ] **Step 2: Run it to confirm it fails**

Expected: the `'all'` case FAILS with a zero leech payout while the `direct` control PASSES. **If the `'all'` case passes, stop** — the defect is not where this task says it is, and the fix would be unfenced.

- [ ] **Step 3: Make the positional tick proc standing leeches**

Route the per-victim DoT-tick credit through the same standing-leech proc the direct path uses. Two rules:
- **Do not double-credit.** The tick already accumulates into `perActorDot` / `tickDealtBySource`; the proc must fire without re-crediting the damage itself.
- **Team symmetry is mandatory in this engine.** Whatever fires for the player side must fire for the enemy side. Check both sides' paths and assert the enemy-side mirror in the test — a one-directional fix is the defect class this epic has repaired repeatedly (see `feedback_engine_team_symmetry`).

- [ ] **Step 4: Tripwire the detonation half**

Add an explicitly-named known-gap test recording that a `leechScope: 'detonation'` standing leech pays zero positionally, with the corpus-unreachability reasoning in the test's comment. The point is that the gap announces itself if the fix ever lands, rather than being discovered a third time.

- [ ] **Step 5: Audit the blast radius**

This changes engine behaviour, so goldens may move. Every moved number must be attributed to "a standing `'all'`-scope leech now pays out on DoT ticks" — anything else is a second defect. Measure against `/tmp/sp4b2b-base` (a worktree at `39d463f1`) before calling a move churn.

Task 2 left two comments recording these gaps as unfixed (`healingGoldenParity.test.ts` around `:527-535` and an inline block in `healingEngineAdapter.ts`). Update the `'all'` half of both to say it is fixed and where; leave the `detonation` half.

- [ ] **Step 6: Verify and commit**

```bash
npx vitest run src/utils/combat/__tests__/positionalDotLeech.test.ts
npm test 2>&1 | tail -20
npx tsc --noEmit && npx eslint src
git add -A && git commit -m "fix(engine): a damage-dealt standing leech pays out on positional DoT ticks"
```

---

