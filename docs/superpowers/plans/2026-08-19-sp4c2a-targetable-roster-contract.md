# SP-4c-2a — the targetable-roster contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every enemy attacker a hittable ship at the normalization boundary, so no run can reach the vestigial dummy's scalar sink — driving `__getDummySinkCreditCount()` to 0 corpus-wide, which is the entry gate for the three rungs that follow.

**Architecture:** `normalizeCombatRoster` gains a fourth responsibility next to auto-placement and targeting synthesis: an enemy attacker whose max HP is absent or `<= 0` is floored to `MIN_TARGETABLE_MAX_HP`. That single rule flips `hasPositionedEnemyRoster` to constant `true`, so the engine's positional path is taken on every run and player damage books per-victim instead of draining into the dummy. Nothing in `engine.ts` changes in this rung — the churn is entirely in fixtures whose expectations were written against the scalar sink.

**Tech Stack:** TypeScript, Vitest, React (one small UI change in `EnemySettingsPanel.tsx`).

**Spec:** `docs/superpowers/specs/2026-08-18-sp4c-match-end-and-delete-the-dummy-design.md` — read **§7 (the 2026-08-19 amendment)** first; it is what this rung implements. §4's cluster table describes 4c-2d, not this PR.

## Global Constraints

- **Never `vitest -u`.** The golden audit spans the whole `npm test`. A snapshot rewrite silently launders real movement into an accepted baseline.
- **There is no CI test workflow.** The husky pre-commit hook is the only gate, so the whole suite must be green locally before every commit. **Stated exemption:** this rung deliberately breaks the suite at Task 1 and repairs it across Tasks 3–4, so the commits in Tasks 0–4 use `--no-verify` and each message names what is still red and which task restores green. From Task 5 onward the suite is green and `--no-verify` is forbidden. An exempt commit that does NOT name the remaining red work is a defect.
- **Full-suite baseline on `main` @ `8d2c2a61`: 529 files / 5867 tests passing, ~25s.** Any final number below this is a regression, not a "different count".
- **`grep -q` is unreliable in this shell** (grep is a ugrep wrapper; it reported all 201 files as matching nothing during 4b-2b). Measure file sets with a node or python script, or with a `grep` whose output you actually read.
- **The engine is NOT deterministic** — `rateAccumulator.ts` uses `Math.random`. Pin with `setupKeyedTestRng(<seed>)` **and** `resetRateGateRng()` in `beforeEach`. Before believing "X differs from Y", run X-vs-X first: a comparison with no same-input control cannot tell a real difference from its own nondeterminism.
- **Percentage stats are stored as integers** (`crit: 70`, not `0.70`). Fixture numbers must match.
- **Movement is attributed, never re-pinned.** Every golden that moves gets a named cause in the PR body: which fixture, which gate, which ship. A move outside the five predicted buckets (Task 3) is a defect signal — investigate it, do not update the expectation.
- **UI rule:** use the existing components in `src/components/ui/`. The one UI change here is an attribute on an existing `Input`.

---

## File Structure

| File | Responsibility in this rung |
| --- | --- |
| `src/utils/combat/normalizeRoster.ts` | **Modify.** Add `MIN_TARGETABLE_MAX_HP` + `withTargetableHp`; wire it into the `enemyAttackers` map. The module doc's "three responsibilities, and deliberately no fourth" becomes four. |
| `src/utils/combat/__tests__/normalizeRoster.test.ts` | **Modify.** Unit tests for the floor — the compensating control for the liveness guard Task 2 retires. |
| `src/utils/combat/__tests__/dummyReachability.test.ts` | **Modify.** Invert the pressure-source case (its premise becomes illegal) and update the file header. |
| ~54 fixture files under `src/utils/combat/__tests__/` and `src/utils/calculators/__tests__/` | **Modify.** Churn repair, bucketed by cause in Task 3. Enumerated by the suite, not in advance. |
| `src/components/calculator/EnemySettingsPanel.tsx` | **Modify.** Add `min="1"` to the Enemy HP input as a browser hint. (Task 5 originally clamped the handler too; that was REVERTED — see the amendment note at the end.) |
| `src/constants/changelog.ts` | **Modify.** `UNRELEASED_CHANGES` entry for the 0-DPS fix. |

`engine.ts` is deliberately **not** in this table. If a task tempts you to edit it, the fix belongs in a later rung — say so rather than reaching for it.

---

### Task 0: Land the design record first, in its own commit

**Files:**
- Add (force): `docs/superpowers/specs/2026-08-18-sp4c-match-end-and-delete-the-dummy-design.md` (§7 amendment)
- Add (force): `docs/superpowers/plans/2026-08-19-sp4c2a-targetable-roster-contract.md` (this file)

`docs/` is gitignored (`.gitignore:9`), so both need `git add -f` — the project tracks these two deliberately, and every earlier rung's spec and plan are in the history the same way.

**Why its own commit, first.** On PR #324, **two of four CodeRabbit findings were against the plan doc** committed alongside the code, describing problems execution had already fixed — roughly half the review budget spent on archaeology. Isolating the docs in the branch's first commit lets the PR body say plainly that this commit is design record and not code under review, which is the deliberate call the #324 retro asked for.

- [ ] **Step 1: Commit the docs**

```bash
git add -f docs/superpowers/specs/2026-08-18-sp4c-match-end-and-delete-the-dummy-design.md \
           docs/superpowers/plans/2026-08-19-sp4c2a-targetable-roster-contract.md
git commit --no-verify -m "docs(engine): SP-4c §4 measured wrong; 4c-2 re-splits into four rungs

Instrumented the three dummy sites and ran the whole suite: the §4.4 entry
gate reads 412 credits (not 0), cluster C is consulted 4,188 times by
ally-targeting actors (not the whiff window), and the dummy takes 3,902
turns across 73 files including three golden suites — so the deletion
cannot be zero-movement as specced. Plan for rung 4c-2a included."
```

`--no-verify` here only because the tree is still at `main`'s green state and the hook would run the full suite for a docs-only change.

---

### Task 1: The HP floor at the boundary

**Files:**
- Modify: `src/utils/combat/normalizeRoster.ts`
- Test: `src/utils/combat/__tests__/normalizeRoster.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `export const MIN_TARGETABLE_MAX_HP: number` (value `1_000_000`) from `src/utils/combat/normalizeRoster.ts`. Task 2 imports it.

**Why 1,000,000 and why only the enemy side.** `healingEngineAdapter.ts:453` already fills an *absent* enemy HP with `LEGACY_SINK_HP = 1_000_000`; this floor applies the same number to an explicit `0`, so the boundary and the adapter agree. The focus attacker's own `hp` is **not** floored: most direct-engine fixtures omit it, so the focus legitimately starts at `currentHp === 0` without ever having been destroyed — that is exactly the trap that cost 4c-1 346 red tests (spec §3.3). And flooring the player side would CLOSE a divergence that must stay open: `resolvesPositionalVictim` calls `opposingLiving.some(isTargetableRosterMember)`, and for an ENEMY-side actor `opposingLiving` is the PLAYER roster — so `isTargetableRosterMember` IS asked about player actors. (An earlier draft of this line claimed it never was. That was false, and CodeRabbit caught the same false claim in the shipped comment — see the amendment note at the end of this plan.)

- [ ] **Step 1: Write the failing tests**

Append to `src/utils/combat/__tests__/normalizeRoster.test.ts`. `enemyInput` (already at the top of that file) builds `stats` with **no** `hp`, so it is the absent case; pass an explicit `stats` for the zero case.

```ts
describe('normalizeCombatRoster — targetable HP floor', () => {
    const zeroHpEnemy = (id: string) => ({
        id,
        stats: { attack: 0, crit: 0, critDamage: 0, speed: 10, hp: 0 },
        chargeCount: 0,
        startCharged: false,
    });

    it('floors an explicit 0 max HP to MIN_TARGETABLE_MAX_HP', () => {
        const out = normalizeCombatRoster(baseInput({ enemyAttackers: [zeroHpEnemy('e1')] }));
        expect(out.enemyAttackers[0].stats.hp).toBe(MIN_TARGETABLE_MAX_HP);
    });

    it('floors an ABSENT max HP too — the boundary default was 0', () => {
        const out = normalizeCombatRoster(baseInput({ enemyAttackers: [enemyInput('e1')] }));
        expect(out.enemyAttackers[0].stats.hp).toBe(MIN_TARGETABLE_MAX_HP);
    });

    it('leaves a real max HP untouched', () => {
        const real = { ...zeroHpEnemy('e1'), stats: { ...zeroHpEnemy('e1').stats, hp: 5_000 } };
        const out = normalizeCombatRoster(baseInput({ enemyAttackers: [real] }));
        expect(out.enemyAttackers[0].stats.hp).toBe(5_000);
    });

    it('floors EVERY member of an all-zero roster, not just the anchor', () => {
        const out = normalizeCombatRoster(
            baseInput({ enemyAttackers: [zeroHpEnemy('e1'), zeroHpEnemy('e2')] })
        );
        expect(out.enemyAttackers.map((e) => e.stats.hp)).toEqual([
            MIN_TARGETABLE_MAX_HP,
            MIN_TARGETABLE_MAX_HP,
        ]);
    });

    it('does NOT floor the focus attacker — hp 0 is legitimate there', () => {
        const out = normalizeCombatRoster(
            baseInput({ hp: 0, enemyAttackers: [zeroHpEnemy('e1')] })
        );
        expect(out.hp).toBe(0);
    });

    it('is pure — the caller’s nested stats object is never mutated', () => {
        const input = baseInput({ enemyAttackers: [zeroHpEnemy('e1')] });
        const before = input.enemyAttackers[0].stats.hp;
        normalizeCombatRoster(input);
        expect(input.enemyAttackers[0].stats.hp).toBe(before);
        expect(before).toBe(0);
    });
});
```

Add `MIN_TARGETABLE_MAX_HP` to the existing `import { normalizeCombatRoster } from '../normalizeRoster';` line.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/utils/combat/__tests__/normalizeRoster.test.ts`
Expected: FAIL — the four floor assertions read `0` or `undefined` instead of `1000000`. (The focus-attacker and purity cases pass already; they are regression fences, not drivers.)

- [ ] **Step 3: Implement the floor**

In `src/utils/combat/normalizeRoster.ts`, add after the `withTargeting` function:

```ts
/**
 * The max HP an enemy attacker is raised to when the caller supplied none or supplied `<= 0`.
 *
 * `1_000_000` is not a fresh invention: `healingEngineAdapter`'s `LEGACY_SINK_HP` already fills an
 * ABSENT enemy HP with exactly this number, for exactly this reason ("a 0-HP enemy silently zeroes
 * every damage-dealt rider"). Its `??` misses an EXPLICIT 0, which is what 288 of the 307 measured
 * all-zero-roster runs pass. Same number here, one layer lower, catching both.
 */
export const MIN_TARGETABLE_MAX_HP = 1_000_000;

/**
 * Responsibility (d): every enemy attacker is a HITTABLE ship.
 *
 * `isTargetableRosterMember` (positional + max hp > 0) is what `hasPositionedEnemyRoster` is built
 * from, and a roster holding no targetable member is the ONE shape that still reached the vestigial
 * dummy's scalar sink — measured at 412 credits across 26 files on `main` @ `8d2c2a61`, every one of
 * them this shape. Flooring here makes `hasPositionedEnemyRoster` constant `true` below the
 * boundary, so the positional path is taken on every run and player damage books per-victim.
 *
 * UNIFORM, not conditional on the side being untargetable. The census found 3,004 runCombat
 * invocations and ZERO mixed rosters (a 0-max-HP member alongside a targetable one), so the two
 * rules are behaviourally identical on the corpus — and the uniform one retires the whole class
 * instead of one instance, with no `if` for a later rung to have to reason about.
 *
 * ENEMY SIDE ONLY. The focus attacker's `hp` is deliberately untouched: most direct-engine fixtures
 * omit it, so the focus starts at `currentHp === 0` having never been destroyed. Reading that as a
 * corpse is the mistake that failed 346 tests during 4c-1 (spec §3.3), and nothing asks
 * `isTargetableRosterMember` about a player actor.
 */
function withTargetableHp<T extends { stats: { hp?: number } }>(actor: T): T {
    const hp = actor.stats.hp;
    return hp !== undefined && hp > 0
        ? actor
        : { ...actor, stats: { ...actor.stats, hp: MIN_TARGETABLE_MAX_HP } };
}
```

Then wire it into the returned roster — the only call site:

```ts
        enemyAttackers: enemyAttackers.map((e, i) => ({
            ...withTargetableHp(withTargeting(e)),
            position: enemySlots[i],
        })),
```

Finally update the module doc comment at the top of the file: `Three responsibilities, and deliberately no fourth:` becomes `Four responsibilities, and deliberately no fifth:`, with the new bullet added after `(b)`:

```
 *   (c) targetable HP        — a max HP of 0/absent is floored so every enemy is a hittable ship
 *   (d) nothing else         — it does not invent enemies, fill in other stats, or choose a mode
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/utils/combat/__tests__/normalizeRoster.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit && npx eslint src/utils/combat/normalizeRoster.ts src/utils/combat/__tests__/normalizeRoster.test.ts`
Expected: no output from either.

- [ ] **Step 6: Commit**

The full suite is NOT green yet — that is Tasks 3–4's job — so this commit takes `--no-verify` under the Global Constraints' stated exemption for Tasks 0–4. Say in the message body what is still red and which task restores green.

```bash
git add src/utils/combat/normalizeRoster.ts src/utils/combat/__tests__/normalizeRoster.test.ts
git commit --no-verify -m "feat(engine): every enemy attacker is a hittable ship (SP-4c-2a Task 1)

Floors an absent-or-0 enemy max HP to MIN_TARGETABLE_MAX_HP at the one
accommodation boundary, making hasPositionedEnemyRoster constant true.
Committed with --no-verify: the fixture churn this exposes is repaired in
Tasks 3-4 and the suite is green again before Task 4's final commit."
```

---

### Task 2: Invert the pressure-source reachability case

**Files:**
- Modify: `src/utils/combat/__tests__/dummyReachability.test.ts`

**Interfaces:**
- Consumes: `MIN_TARGETABLE_MAX_HP` from `src/utils/combat/normalizeRoster.ts` (Task 1).
- Produces: nothing later tasks import.

**Read the file's header doc comment before editing.** It is the ladder's running record of what this suite can and cannot prove, and it currently says SP-4c "must give the whiff a non-dummy way to say 'no living victim'" — the whiff is gone (4c-1) and that sentence now describes rung **4c-2b**, not this one.

**The liveness guard is deliberately retired here, for the second time.** 4b-2b inverted the empty-roster case into a throw-assertion and thereby destroyed this file's only proof that the counters were wired to anything; Task 7 re-homed that proof onto the pressure-source shape. This rung makes *that* shape illegal too, so the proof has nowhere left to go inside this file — every reachable shape now reads 0. That is acceptable only because the compensating control is explicit: Task 1's unit tests prove the shape cannot exist, and the counters themselves are deleted in 4c-2d. Write that down in the header rather than leaving a reader to wonder whether six zeros mean anything.

- [ ] **Step 1: Rewrite the pressure-source case**

Replace the whole `it('the counters are LIVE: a pressure-source roster both consults AND credits the dummy', ...)` block in the `describe('sink CREDITS are distinct from fallback CONSULTATIONS')` suite with:

```ts
    it('a pressure-source roster is FLOORED, so it can no longer reach the sink at all', () => {
        // SP-4c-2a INVERTED THIS TEST, the same way SP-4b-2b inverted the empty-roster case above.
        // It used to read `{ consulted: BARE_ROUNDS, credited: BARE_ROUNDS }` and was this file's
        // VACUITY GUARD — the only proof the counters were wired to anything. A max-HP-0 roster was
        // placed but unhittable, so `resolvesPositionalVictim` kept the run non-positional and the
        // focus's whole output drained into the dummy's scalar channel.
        //
        // The boundary now floors that member to MIN_TARGETABLE_MAX_HP, so the shape is gone: the
        // cast resolves a real victim and books per-victim. Every reachable shape in this file
        // therefore reads 0/0, and the liveness proof has moved OUT of this file — to
        // `normalizeRoster.test.ts`'s floor cases, which prove the un-floored shape cannot be
        // constructed. The counters are deleted outright in SP-4c-2d.
        const result = runCombat({
            ...bareInput(),
            enemyAttackers: bareEnemy({ stats: { hp: 0 } }),
        });

        // The path ran: the floored member really is the victim, at full cast magnitude, every
        // round — 1 000 000 max HP is far above BARE_ROUNDS * PER_CAST, so it never dies and the
        // run is not cut short by 4c-1's wipe rule.
        expect(dealtBy(result, 1, 'attacker')).toEqual({ [BARE_ENEMY_ID]: PER_CAST });
        expect(dealtBy(result, BARE_ROUNDS, 'attacker')).toEqual({ [BARE_ENEMY_ID]: PER_CAST });
        expect(result.rounds).toHaveLength(BARE_ROUNDS);

        expect(counters()).toEqual({ consulted: 0, credited: 0 });
    });

    it('the floor is what does it: the roster arrives at the engine already hittable', () => {
        // Pins the MECHANISM, not just the outcome — without this, a future change that made the
        // dummy unreachable for some other reason would leave the case above green while the floor
        // silently stopped working.
        const floored = normalizeCombatRoster({
            ...bareInput(),
            enemyAttackers: bareEnemy({ stats: { hp: 0 } }),
        });
        expect(floored.enemyAttackers[0].stats.hp).toBe(MIN_TARGETABLE_MAX_HP);
    });
```

Add the two imports this needs:

```ts
import { normalizeCombatRoster, MIN_TARGETABLE_MAX_HP } from '../normalizeRoster';
```

- [ ] **Step 2: Update the file header**

In the header doc comment, replace the `── WHAT SP-4c STILL HAS TO HANDLE ──` section body with:

```
 * NOTHING, on the player side's REACHABILITY — but the fallback is still CONSULTED, and by a
 * different consumer than this file was written to describe.
 *
 * The MID-RUN WHIFF WINDOW is gone: SP-4c-1 ends the match on the turn that wipes a side, so a
 * killed roster produces no whiff rounds (see the CORPSE TARGETING case). The 0-max-HP PRESSURE
 * SOURCE is gone too: SP-4c-2a floors it at the boundary (see the inverted case below). Both were
 * quoted as the reason 4c must gate on the CREDIT counter rather than the consultations counter,
 * and both are now closed — measured 0 credits corpus-wide.
 *
 * What remains, and what rung 4c-2b owns: an ALLY-TARGETING player actor consults the fallback on
 * every turn, because `resolvePositionalTarget` returns null for an ally-side parsed target and
 * selection falls through. Measured at 4,188 player-side consultations across the suite on `main`
 * @ `8d2c2a61` — the real keystone, and NOT the whiff window this header used to name. The fix is
 * the one the enemy side already has: return `tgt: undefined` and let the turn skip its attack.
 *
 * ⚠️ THIS FILE NO LONGER CARRIES ITS OWN VACUITY GUARD. Every shape it can construct reads 0/0, so
 * a counter silently wired to nothing would leave all six cases green. The compensating control is
 * external and deliberate: `normalizeRoster.test.ts`'s floor cases prove the un-floored shape
 * cannot be built, and each case here still asserts something POSITIVE about the path it claims (a
 * `turn-started`, a `perTargetDealt` row naming the victim, a `ship-destroyed`, a changed victim
 * id) so a zero from a case that never ran its path stays impossible. The counters go away entirely
 * in SP-4c-2d.
```

- [ ] **Step 3: Run the file**

Run: `npx vitest run src/utils/combat/__tests__/dummyReachability.test.ts`
Expected: PASS, all eight cases (six reachability + the two rewritten credit cases).

- [ ] **Step 4: Commit**

The suite is still red from Task 1's floor, so this commit takes `--no-verify` under the Global Constraints' stated exemption, and the message says which task restores green:

```bash
git add src/utils/combat/__tests__/dummyReachability.test.ts
git commit --no-verify -m "test(engine): the pressure-source shape is illegal, so its case inverts (SP-4c-2a Task 2)

Suite still red from Task 1's floor; repaired in Tasks 3-4."
```

---

### Task 3: Measure and bucket the churn

**Files:**
- Create: `$SCRATCH/sp4c2a-churn.md`, where `SCRATCH` is your own scratch directory — `SCRATCH=$(mktemp -d)` if you have none (working inventory — NOT committed)

**Interfaces:**
- Consumes: the floor from Task 1.
- Produces: a written bucket-to-file mapping that Task 4 works through. Nothing in `src/`.

This task writes no production code. Its deliverable is the inventory, because Task 4's repairs are only defensible if each one names the bucket it belongs to.

- [ ] **Step 1: Capture the failure list**

```bash
SCRATCH="${SCRATCH:-$(mktemp -d)}"
npx vitest run --reporter=basic > "$SCRATCH/post-floor.txt" 2>&1
tail -8 "$SCRATCH/post-floor.txt"
grep -n "FAIL\|✗\|×" "$SCRATCH/post-floor.txt" | head -100
```

Expected: a non-zero failure count. The baseline is 529 files / 5867 tests; the census predicts movement concentrated in the **54 files that construct an all-zero-max-HP roster**, of which **26 also credited the sink**. A failure in a file *outside* that set is a defect signal — record it separately and investigate before repairing anything.

- [ ] **Step 2: Bucket every failing file by cause**

Write `$SCRATCH/sp4c2a-churn.md` as a table of `file | test name | bucket | one-line cause`. The five predicted buckets, each with its mechanism and its repair — derived from the code, not guessed:

**B1 — `perTargetDealt` appears and the scalar channel empties.** Before the floor, `resolvesPositionalVictim` was false, so the round tail took the vestigial-sink `else` branch: all player damage landed on `cumulativeDamage` (hence `rawTotals.cumulative`) and `perTargetDealt` was `undefined` for every round. After it, the positional apply books per-victim and the scalar credit is suppressed. *Repair:* read damage from `perTargetDealt[attackerId][victimId]`, not `rawTotals.cumulative`. This is the same migration SP-4b-2a did for `dpsSimulator`.

**B2 — `enemyHpPct` gate denominators.** The HP%-gate context used to describe the dummy, whose max HP is the `input.enemyHp` scalar (measured at 10,000,000 or 1,000,000,000 on these runs). It now describes the floored member at 1,000,000. An `hpSubject: 'enemy'` threshold gate can therefore flip which branch it takes. *Repair:* adjust the fixture's damage or its threshold so the branch the test is *about* still fires. Never re-pin a golden to whichever branch happens to fire now — that converts a test of a gate into a test of arithmetic.

**B3 — %-of-max-HP DoT magnitudes.** Corrosion scales with the AFFLICTED ship's max HP. The afflicted ship changes from the dummy (max HP = `input.enemyHp`) to the floored member (1,000,000), so every Corrosion number in these fixtures moves. *Repair:* recompute the expected value off 1,000,000 and show the arithmetic in the diff or a comment. See `[[reference_dot_tier_magnitude_vs_level]]` — `tier` is a MAGNITUDE (3/6/9, 15/30/45), not a 1/2/3 level.

**B4 — wipe-induced early termination.** A floored member can now be destroyed, which wipes the enemy side, which ends the match that turn under 4c-1's rule. *Repair:* 4c-1's own recipe — give the fixture an inert survivor (0 attack, no skills, speed 1: RNG-stream-inert and last in every turn order) so the deliberate kill is not a wipe, or raise that member's HP explicitly. Expect FEW of these: 1,000,000 is far above what these fixtures deal (the largest measured is ~10,000/round).

**B5 — the dummy leaves the turn order.** `dummyEnemyIsVestigial = hasPositionedEnemyRoster && every player actor positioned with an enemy-side parsed target`. The floor flips the first conjunct to `true`, so any fixture whose players *all* target enemy-side now drops the dummy's turn: its `turn-started`/`turn-ended` pair disappears from the event stream, and the round-loop D5 scheduled-debuff decrement starts firing (it is gated on `dummyEnemyIsVestigial`). Healing fixtures are mostly unaffected — an ally-targeting healer keeps the second conjunct false. *Repair:* for event/log assertions, drop the dummy's turn from the expectation. For a scheduled-debuff duration that shortens, that is the D5 decrement working as designed — re-derive the expectation and name it in the PR body, because it is a **behaviour fix**, not test maintenance.

- [ ] **Step 3: Record anything that fits no bucket**

Give it its own section headed `UNEXPLAINED`. Per the Global Constraints, an unexplained move is a defect signal: stop and report it rather than repairing it. Do not proceed to Task 4 with a non-empty `UNEXPLAINED` section unless you have written down why each entry is benign.

- [ ] **Step 4: No commit**

The inventory lives in the scratchpad, not the repo. Committing plan-adjacent prose alongside the diff cost PR #324 half of its CodeRabbit findings to archaeology — the inventory's content belongs in the **PR body** instead.

---

### Task 4: Repair the churn, one commit per bucket

**Files:**
- Modify: the ~54 fixture files Task 3 enumerated, grouped by bucket.

**Interfaces:**
- Consumes: Task 3's `sp4c2a-churn.md`.
- Produces: a green suite.

- [ ] **Step 1: Repair bucket B1 and commit**

Apply the B1 repair to every B1 file. Then:

```bash
npx vitest run --reporter=basic 2>&1 | tail -6
```
Expected: the B1 failures are gone and the remaining count matches Task 3's B2–B5 total. Then commit — the hook runs the full suite, so use `--no-verify` while it is still red, and state the remaining buckets in the message:

```bash
git add -A src/utils
git commit --no-verify -m "test(engine): read damage per-victim now the roster is hittable (SP-4c-2a B1)

Remaining red: buckets B2-B5."
```

- [ ] **Step 2: Repair buckets B2, B3, B4, B5 the same way**

One commit per bucket, in that order, each naming which buckets remain red. B5 goes last: it is the only bucket carrying a real behaviour change (the D5 decrement starting to fire), so landing it last keeps it isolated and easy to describe.

- [ ] **Step 3: Verify the suite is green and the gate is met**

```bash
npx vitest run --reporter=basic 2>&1 | tail -6
```
Expected: `Test Files 529 passed (529)` / `Tests 5867 passed (5867)` or higher on both counts. A LOWER test count means a case was deleted rather than repaired — go back and find it.

- [ ] **Step 4: Prove the entry gate corpus-wide, not just in one file**

`dummyReachability.test.ts` asserting 0 only covers the shapes it constructs. Re-run the measurement that found the 412 credits, so the gate is a measurement and not a reading (spec §7.5):

```bash
SCRATCH="${SCRATCH:-$(mktemp -d)}"
cp src/utils/combat/engine.ts "$SCRATCH/engine.gate.bak"
python3 - <<'PY'
p = 'src/utils/combat/engine.ts'
s = open(p).read()
old = "            if (totalRoundDamage + teamRoundDamage > 0) dummySinkCreditCount++;"
new = "            if (totalRoundDamage + teamRoundDamage > 0) { dummySinkCreditCount++; console.error('GATE_CREDIT'); }"
assert s.count(old) == 1
open(p, 'w').write(s.replace(old, new))
PY
npx vitest run --reporter=basic > "$SCRATCH/gate.txt" 2>&1
grep -c "GATE_CREDIT" "$SCRATCH/gate.txt"
cp "$SCRATCH/engine.gate.bak" src/utils/combat/engine.ts
git diff --stat src/utils/combat/engine.ts
```

Expected: the `grep -c` prints **0** (grep exits 1 on no matches — that is the success case here), and `git diff --stat` on `engine.ts` prints **nothing**, proving the probe was reverted. If the count is non-zero, a shape still reaches the sink: find it with the per-file aggregation from spec §7 and fix it before continuing. **Do not commit the probe.**

- [ ] **Step 5: Typecheck and lint the whole change**

Run: `npx tsc --noEmit && npx eslint src`
Expected: no output. `tsc` catches what vitest cannot — a fixture whose `stats` shape drifted will compile-fail rather than silently pass.

---

### Task 5: Clamp the Enemy HP input and log the fix

**Files:**
- Modify: `src/components/calculator/EnemySettingsPanel.tsx`
- Modify: `src/constants/changelog.ts`

**Interfaces:**
- Consumes: nothing. Independent of Tasks 1–4, but it documents the same user-visible fix, so it ships in this PR.

Task 1 already fixes the 0-DPS bug at the engine (a cleared field is floored to 1,000,000 rather than draining into the dummy). This step stops the field accepting a value the engine will silently replace, so the user fights the HP they can see.

- [ ] **Step 1: Clamp the input**

In `src/components/calculator/EnemySettingsPanel.tsx`, the Enemy HP `Input` (currently `onChange={(e) => onEnemyHpChange(parseInt(e.target.value) || 0)}` with no `min`) becomes:

```tsx
                    <Input
                        label="Enemy HP"
                        type="number"
                        min="1"
                        value={enemyHp}
                        onChange={(e) => onEnemyHpChange(parseInt(e.target.value) || 0)}
                    />
```

**Add `min="1"` only — do NOT clamp the handler.** An earlier draft of this step also wrapped the
handler in `Math.max(1, …)`; it was written, shipped, and then REVERTED during the final review round,
for three measured reasons: the engine floor alone already fixes the 0-DPS bug (`enemyHp: 0` yields 5
rounds / 38,763 damage, identical to an explicit 1,000,000); a clamped `hp: 1` dies in round 1 under
4c-1's wipe rule, misrepresenting every multi-round mechanic; and it introduced a sticky-leading-digit
hazard (delete-then-retype `500000` gave `1500000`). A second clamp in the UI is a second
accommodation site, which contradicts this rung's own thesis that there is exactly ONE.

The sibling Enemy Defense field keeps `|| 0`: 0 defence is a legitimate value.

- [ ] **Step 2: Add the changelog entry**

Append to `UNRELEASED_CHANGES` in `src/constants/changelog.ts`. The surrounding entries are **full explanatory paragraphs**, not one-liners — they say what was wrong, what the user saw, and what changed. Match that, and keep to the no-emojis-in-UI-text rule:

```
'DPS calculator: an enemy with no HP no longer reports zero damage. Clearing the Enemy HP field, or setting it to 0, produced an enemy that could not be hit at all — every attack passed through it, so the damage total came back as zero and the whole run looked broken. An enemy with no HP set is now treated as a real ship with substantial health. The same applies to the combat simulator and the healing calculator, where an enemy left without HP is now a genuine target rather than an invisible one.',
```

- [ ] **Step 3: Verify**

Run: `npx vitest run src/components/calculator && npx tsc --noEmit && npx eslint src/components/calculator/EnemySettingsPanel.tsx src/constants/changelog.ts`
Expected: green, no output from `tsc`/`eslint`. If no test file covers that panel, say so rather than inventing one — the behaviour is verified in Step 4.

- [ ] **Step 4: Verify in the real app**

Run `npm start` (**not** `npm run dev` — that script does not exist), open the DPS calculator, clear the Enemy HP field, and confirm the DPS number is non-zero (the engine floor is what makes it so — the field itself may sit at 0). Report what you saw. This is the only step in the plan that exercises the bug the way a user hits it.

- [ ] **Step 5: Commit**

The suite is green from Task 4, so the hook runs clean and `--no-verify` is no longer permitted.

```bash
git add src/components/calculator/EnemySettingsPanel.tsx src/constants/changelog.ts
git commit -m "fix(dps): an empty enemy HP field no longer reports zero DPS (SP-4c-2a Task 5)"
```

---

### Task 6: Final verification and PR

**Files:** none.

- [ ] **Step 1: Run the full gate**

```bash
npx vitest run --reporter=basic 2>&1 | tail -6
npx tsc --noEmit
npx eslint src
git status --short
```
Expected: 529+ files / 5867+ tests passing, no `tsc` output, no `eslint` output, and a clean tree apart from the intended changes. Per `superpowers:verification-before-completion`, paste the actual output — do not assert green without it.

- [ ] **Step 2: Confirm no `engine.ts` change slipped in**

Run: `git diff main --stat -- src/utils/combat/engine.ts`
Expected: **empty**. This rung's whole claim is that the fix lives at the boundary; a diff here falsifies that and belongs in 4c-2b/c/d.

- [ ] **Step 3: Check the file count against the CodeRabbit threshold**

Run: `git diff main --stat | tail -1`
Expected: well under 100 files. Past 100, CodeRabbit reviews **nothing** while its check still passes (recorded on #322) — if the churn crossed it, split Task 4's buckets into a second PR rather than accepting a silent review gap.

- [ ] **Step 4: Open the PR**

Body must carry: the §7 measurement table (what was claimed vs what was measured), the bucket-by-bucket attribution from Task 3 — every moved golden with its named cause: which fixture, which gate, which ship — the corpus-wide `GATE_CREDIT` zero from Task 4 Step 4, and the browser check from Task 5 Step 4. Do **not** commit `sp4c2a-churn.md`; its content goes in the body.

---

## Self-Review

**Spec coverage (§7):** §7.2.1 auto-clamp → Task 1. §7.1's uniform-rule finding → Task 1 Step 3's doc comment. §7.3 production bug → Task 5 (engine half already in Task 1). §7.4's 4c-2a row (54 files, credit gate to 0) → Tasks 3–4, gate proven in Task 4 Step 4. §7.5's measurement discipline → Task 4 Step 4 re-runs the probe rather than quoting a doc. §7.2.2 (turn-order rung) and §7.4's b/c/d rows are deliberately **out of scope** — no task touches `engine.ts`, and Task 6 Step 2 enforces that.

**Placeholders:** none — every code step carries the actual code, and the one unknowable (which files fail) is handled by a measurement task that produces the list, with all five buckets' mechanisms and repairs given in advance.

**Type consistency:** `MIN_TARGETABLE_MAX_HP` is named identically in Tasks 1 and 2. `withTargetableHp` composes with `withTargeting` (both generic and return `T`; the enemy-attacker type satisfies both constraints). `stats.hp` is `hp?: number` on `CombatEngineInput['enemyAttackers'][number]`, so the floor checks `undefined` **and** `<= 0` — the absent case is real, not defensive.

**Known residual:** `dummyReachability.test.ts` ends this rung with no internal vacuity guard (Task 2 documents it, with `normalizeRoster.test.ts` as the compensating control). That is a deliberate, recorded trade, not an oversight — and it resolves in 4c-2d when the counters are deleted.

---

## Amendment (2026-08-19, post-execution) — what this plan got wrong

Recorded here because a plan is read by later rungs, and a plan that still describes what was
*intended* rather than what *shipped* is the same stale-prose defect this rung kept paying for.

**1. The plan's own false claim, caught by CodeRabbit on PR #330.** Task 1's rationale said
"`isTargetableRosterMember` is only ever asked about enemy attackers anyway", and that wording reached
the shipped comment in `normalizeRoster.ts`. It is **false**: `resolvesPositionalVictim` calls
`opposingLiving.some(isTargetableRosterMember)`, and for an ENEMY-side actor `opposingLiving` is the
PLAYER roster. Two of my own review rounds missed it. The enemy-only floor is still correct, but for
a second and stronger reason: flooring the player side would CLOSE the player-side divergence, which
must stay open (it is what `perVictimDotTick`'s GATE RETENTION mirror pins).

**2. The UI clamp was reverted.** Task 5 originally clamped the Enemy HP handler to a minimum of 1.
Measured during the final review: the engine floor alone already fixes the 0-DPS bug, `hp: 1` dies in
round 1 under 4c-1's wipe rule, and the clamp created a sticky-leading-digit input hazard. Only
`min="1"` shipped. Task 5's text above has been corrected.

**3. B2/B3/B4 never occurred; B0 and B6 were not predicted.** The five predicted churn buckets
over-fitted: the DoT-magnitude and HP%-gate churn never materialised at a 1,000,000 floor, while an
in-file fence (B0) and a structurally-unconstructible premise (B6) did. Actual: B1 24 tests / 16
files, B5 2, B0 1, B6 1.

**4. The B6 ruling I made mid-execution was wrong and had to be partly undone.** I ruled that "an
enemy positioned but not a valid victim" was unconstructible and converted three tests to tripwires.
`dummyEnemyIsVestigial` is an **AND**, and the floor closes only its first conjunct — an ally-side
parsed target still falsifies the second. My own probe data (3,128 turns at `vest=false hasPos=true`)
had already shown this. Two of the three were restored; only `bombSplashOnDeath` case (c) was a real
loss. **A conjunctive gate is closed only when every conjunct is.**

**5. Deferred, with CodeRabbit's Major on the record.** `RoundData.teamDamage` omits positional
walked-team damage, so it underreports. Confirmed pre-existing (the summing loop dates from
`0650e6a6`, 2026-06-05; `engine.ts` is untouched by this branch) and tripwired at 0 rather than
fixed, because the remedy is an engine behaviour change to a UI-facing field and needs its own churn
story. Tracked as a follow-up issue, not just as PR prose.

Full execution history, including the four false-comment rounds: `.superpowers/sdd/progress.md`
(git-ignored scratch) and the PR #330 body.
