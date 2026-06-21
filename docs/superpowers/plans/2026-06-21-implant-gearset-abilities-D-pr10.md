# D-PR10 — Flat-attack caster-snapshot buff subsystem — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Light up the `Power Infused Nanobots` buff (Font of Power implant) — grant the recipient flat attack = 100% of the casting unit's effective attack, snapshotted at grant time.

**Architecture:** A new **flat (absolute-units)** attack buff channel folded **additively** on top of the existing percentage attack fold. The magnitude is resolved at *apply* time (the fold has no caster identity) via a **sentinel → concrete split**: `attackFlatPctOfCaster` (parsed statically, inert in the fold) marks "needs a caster-attack snapshot"; `attackFlat` (the frozen absolute value) is materialized only at the grant site into the per-instance timed-ability-status payload, and is the field the fold sums.

**Tech Stack:** TypeScript, Vitest. Worktree `.worktrees/d-pr10-flat-attack-buff`, branch `feat/combat-d-pr10-flat-attack-buff` (off D-PR9 tip `be3ae187`).

**Spec:** `docs/superpowers/specs/2026-06-21-implant-gearset-abilities-D-pr10-design.md`

**Global invariants (all tasks):**
- Production goldens / `.snap` files stay **byte-identical** (no committed golden carries a Font-of-Power healer). NEVER run `vitest -u`. If a production golden moves, a fold leaked — fix the leak, don't update the snapshot.
- `npm run audit:skills` stays 141/0. `npm run lint` and `tsc` clean.
- docs/ is gitignored → spec/plan commits use `git add -f` and `git commit --no-verify`.
- All `cd` into the worktree: `/Users/kennethsusort/PersonalProjects/starborne-frontiers-calculator/.worktrees/d-pr10-flat-attack-buff`.

---

### Task 1: Type fields + static parser (sentinel)

**Files:**
- Modify: `src/types/calculator.ts` — `ParsedBuffEffects` (~line 93) + `Buff` interface `stat` union (~line 60).
- Modify: `src/utils/calculators/buffParser.ts` — `parseBuffEffects`.
- Test: `src/utils/calculators/__tests__/buffParser.test.ts` (create if absent; otherwise append).

- [ ] **Step 1: Write the failing test**

Append to the buffParser test file (find the existing one first; if none, create `src/utils/calculators/__tests__/buffParser.test.ts` with the standard `import { parseBuffEffects } from '../buffParser';`):

```ts
describe('parseBuffEffects — flat-attack caster snapshot (D-PR10)', () => {
    it('extracts the caster-attack percentage sentinel from Power Infused Nanobots', () => {
        const e = parseBuffEffects(
            'Power Infused Nanobots',
            "Grants attack equal to 100% of the caster's attack"
        );
        expect(e.attackFlatPctOfCaster).toBe(100);
        // It must NOT populate the percentage `attack` channel (that is %-of-own-attack).
        expect(e.attack).toBeUndefined();
        // The concrete value is materialized only at apply time, never by the parser.
        expect(e.attackFlat).toBeUndefined();
    });

    it('does NOT false-match an ordinary percentage Attack buff', () => {
        const e = parseBuffEffects('Atlas Coordination II', '+20% Attack');
        expect(e.attackFlatPctOfCaster).toBeUndefined();
        expect(e.attack).toBe(20);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/utils/calculators/__tests__/buffParser.test.ts -t "caster snapshot"`
Expected: FAIL — `attackFlatPctOfCaster` is not a property (tsc) / undefined.

- [ ] **Step 3: Add the type fields**

In `src/types/calculator.ts`, inside `ParsedBuffEffects` (after the `// Flat stats (not percentages)` block with `hacking`/`security`):

```ts
    /** CONCRETE frozen flat attack (absolute units), materialized at grant time from a caster
     *  snapshot. Summed additively in the fold (see effectiveStats / buffTotals). */
    attackFlat?: number;
    /** SENTINEL — "grant flat attack = N% of the CASTER's effective attack". Parsed statically
     *  from the buff description; carries no concrete value, so it is INERT in the fold. The
     *  reactive buff-grant site resolves it into `attackFlat` per instance. */
    attackFlatPctOfCaster?: number;
```

In the `Buff` interface `stat` union (~line 60), add `'attackFlat'`:

```ts
        | 'security'
        | 'attackFlat';
```

- [ ] **Step 4: Add the parser branch**

In `src/utils/calculators/buffParser.ts`, after the `security` block (~line 58), add:

```ts
    // Flat attack granted as a percentage of the CASTER's attack ("...equal to 100% of the
    // caster's attack"). SENTINEL only — the concrete value is snapshotted at grant time.
    // Keys on the "of the caster('s) attack" phrasing so it never matches "+N% Attack" buffs.
    const attackFlatPct = description.match(
        /(\d+(?:\.\d+)?)%\s*of\s*the\s*caster'?s?\s*attack/i
    );
    if (attackFlatPct) effects.attackFlatPctOfCaster = parseFloat(attackFlatPct[1]);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/utils/calculators/__tests__/buffParser.test.ts -t "caster snapshot"`
Expected: PASS (both cases).

- [ ] **Step 6: Commit**

```bash
git add src/types/calculator.ts src/utils/calculators/buffParser.ts src/utils/calculators/__tests__/buffParser.test.ts
git commit -m "feat(combat): D-PR10 Task 1 — attackFlat type fields + caster-attack sentinel parser"
```

---

### Task 2: Buff-leaf emit + fold totals

**Files:**
- Modify: `src/utils/calculators/dpsBuffHelpers.ts` — `toSimBuffs`.
- Modify: `src/utils/combat/buffTotals.ts` — `calculateBuffTotals`.
- Test: co-located test files for each (find existing `__tests__/dpsBuffHelpers.test.ts` and `__tests__/buffTotals.test.ts`; append, or create alongside).

- [ ] **Step 1: Write the failing tests**

For `toSimBuffs` (append to its test file):

```ts
it('emits an attackFlat leaf (× stacks) but NOT the sentinel (D-PR10)', () => {
    const out = toSimBuffs([
        {
            id: 'b1',
            buffName: 'Power Infused Nanobots',
            stacks: 1,
            isStackable: false,
            parsedEffects: { attackFlat: 500, attackFlatPctOfCaster: 100 },
        },
    ]);
    expect(out).toContainEqual({ id: 'b1-attackFlat', stat: 'attackFlat', value: 500 });
    // The sentinel is inert — no leaf for it.
    expect(out.some((b) => b.value === 100)).toBe(false);
});
```

For `calculateBuffTotals` (append to its test file):

```ts
it('sums attackFlat into attackFlatBuff (D-PR10)', () => {
    const t = calculateBuffTotals([
        { id: 'x', stat: 'attackFlat', value: 300 },
        { id: 'y', stat: 'attackFlat', value: 200 },
        { id: 'z', stat: 'attack', value: 20 },
    ]);
    expect(t.attackFlatBuff).toBe(500);
    expect(t.attackBuff).toBe(20); // percentage channel untouched
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run -t "attackFlat"`
Expected: FAIL — `attackFlatBuff` undefined / no `attackFlat` leaf.

- [ ] **Step 3: Emit the leaf in `toSimBuffs`**

In `src/utils/calculators/dpsBuffHelpers.ts`, after the `security` push (~line 66), add:

```ts
        if (parsedEffects.attackFlat !== undefined)
            entries.push({
                id: `${s.id}-attackFlat`,
                stat: 'attackFlat',
                value: parsedEffects.attackFlat * stacks,
            });
```

(Do NOT emit `attackFlatPctOfCaster` — it has no concrete value and must stay inert.)

- [ ] **Step 4: Sum it in `calculateBuffTotals`**

In `src/utils/combat/buffTotals.ts`, add alongside the other reducers (after `securityBuff`, ~line 44):

```ts
    const attackFlatBuff = buffs
        .filter((b) => b.stat === 'attackFlat')
        .reduce((sum, b) => sum + b.value, 0);
```

and add `attackFlatBuff,` to the returned object.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run -t "attackFlat"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/utils/calculators/dpsBuffHelpers.ts src/utils/combat/buffTotals.ts src/utils/calculators/__tests__/ src/utils/combat/__tests__/
git commit -m "feat(combat): D-PR10 Task 2 — attackFlat buff leaf + attackFlatBuff fold total"
```

---

### Task 3: Effective-stats additive fold

**Files:**
- Modify: `src/utils/combat/effectiveStats.ts` — `foldActorBuffTotals`, `effectiveStatsOf`, `effectiveDamageStatsOf`.
- Test: `src/utils/combat/__tests__/effectiveStats.test.ts` (append; find the existing file).

NOTE: `foldActorBuffTotals` and `effectiveDamageStatsOf` both build a `totals` object by **explicit field-by-field sum** of `calculateBuffTotals` outputs. Because Task 2 added `attackFlatBuff` to the `calculateBuffTotals` return type, tsc will require it in both hand-written sum objects — add it to both or tsc fails.

- [ ] **Step 1: Write the failing test**

Append to `effectiveStats.test.ts`. Model it on the existing `effectiveStatsOf` / `effectiveDamageStatsOf` tests in that file (reuse their StatusEngine / selfBuffLookup setup helpers). Core assertions:

```ts
it('adds attackFlat after the percentage attack term (effectiveStatsOf, D-PR10)', () => {
    // Actor base attack 1000, with a +20% Attack self-buff AND a 300 attackFlat buff active.
    // Expected: 1000 * 1.20 + 300 = 1500.
    // (Use the file's existing harness to register both a percentage Attack buff and a buff
    //  whose parsedEffects carry attackFlat: 300 on the actor, then call effectiveStatsOf.)
    expect(result.attack).toBe(1500);
});

it('adds attackFlat after the percentage attack term (effectiveDamageStatsOf, D-PR10)', () => {
    // base.attack 1000, scheduledTotals.attackBuff 20, an abilitySelfEffects buff with
    // attackFlat: 300  →  1000 * 1.20 + 300 = 1500.
    expect(result.attack).toBe(1500);
});
```

If the existing harness makes registering an `attackFlat` self-buff awkward, prefer driving `effectiveDamageStatsOf` directly (it takes plain `base` + `abilitySelfEffects: SelectedGameBuff[]`), which is the lower-friction of the two.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/utils/combat/__tests__/effectiveStats.test.ts -t "attackFlat"`
Expected: FAIL — attack still `1200` (flat not added) or tsc error for the missing `attackFlatBuff` field.

- [ ] **Step 3: Thread `attackFlatBuff` through `foldActorBuffTotals`**

In the field-by-field return object of `foldActorBuffTotals` (~line 72), add:

```ts
        attackFlatBuff: scheduled.attackFlatBuff + timed.attackFlatBuff,
```

- [ ] **Step 4: Add the flat term in `effectiveStatsOf`**

Change the `attack` line (~line 95):

```ts
        attack: s.attack * (1 + t.attackBuff / 100) + t.attackFlatBuff,
```

- [ ] **Step 5: Thread + apply in `effectiveDamageStatsOf`**

In the `totals` assembly (~line 186), add (no modifier-channel equivalent exists, so it is scheduled + ability only):

```ts
        attackFlatBuff: scheduledTotals.attackFlatBuff + ability.attackFlatBuff,
```

and change the returned `attack` (~line 202):

```ts
        attack: base.attack * (1 + totals.attackBuff / 100) + totals.attackFlatBuff,
```

- [ ] **Step 6: Run test + full effectiveStats suite to verify pass + no regression**

Run: `npx vitest run src/utils/combat/__tests__/effectiveStats.test.ts`
Expected: new tests PASS; all existing PASS (no actor in existing tests carries attackFlat → `+0`).

- [ ] **Step 7: Commit**

```bash
git add src/utils/combat/effectiveStats.ts src/utils/combat/__tests__/effectiveStats.test.ts
git commit -m "feat(combat): D-PR10 Task 3 — additive attackFlat fold in effectiveStats"
```

---

### Task 4: Snapshot the caster's attack at the grant site

**Files:**
- Modify: `src/utils/combat/triggers.ts` — `executeIntent` buff branch (opens ~line 1045; hoisted `status` built ~line 1079).
- Test: engine-level integration test. Reuse the harness in `src/utils/abilities/__tests__/equipmentAbilities.integration.test.ts` (Font of Power / `on-own-repair-to-ally` patterns from D-PR9 live here and in `enemyReactiveSelfBuffs.test.ts`).

- [ ] **Step 1: Write the failing integration test**

In `equipmentAbilities.integration.test.ts`, add a test that:
- Builds a small battle where a Font-of-Power healer (the *caster*) with a KNOWN effective attack repairs a **non-self** ally whose own base attack differs from the caster's, forcing the PIN grant (set the proc to fire — if procChance blocks determinism in the harness, follow the D-PR9 tests' approach for forcing the grant, e.g. a rate-gate stub / legendary 100%-path helper already used there).
- Asserts the recipient's **effective attack after the grant** = `recipientOwnEffectiveAttack + casterEffectiveAttack` (i.e. the increase equals the caster's effective attack, NOT the recipient's base). Use distinct attack stats for caster vs recipient so a wrong-source bug (recipient's own attack) is caught.
- Asserts the recipient subsequently deals damage consistent with the raised attack (qualitative: damage strictly greater than the no-PIN baseline), to prove the fold reaches the damage path.

Look at the existing PIN presence-only tests (`enemyReactiveSelfBuffs.test.ts` ~lines 391/598) for the exact builder/proc-forcing idiom before writing this.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/utils/abilities/__tests__/equipmentAbilities.integration.test.ts -t "Power Infused"`
Expected: FAIL — recipient attack unchanged (buff still emit-only / no `attackFlat` materialized).

- [ ] **Step 3: Materialize the snapshot in the buff branch**

In `src/utils/combat/triggers.ts`, in `executeIntent` `if (cfg.type === 'buff') { ... }`, BEFORE the hoisted `status` literal (~line 1079), compute the per-instance payload config:

```ts
        // D-PR10: dynamic caster-attack snapshot. A buff whose parsedEffects carry the
        // `attackFlatPctOfCaster` sentinel ("N% of the caster's attack") freezes a concrete
        // `attackFlat` from the CASTER's effective attack at grant time (the same last-turn
        // ctx value bombs/reactive-damage snapshot). One value for all recipients → the shared
        // hoisted payload stays correct.
        const pinPct = cfg.parsedEffects.attackFlatPctOfCaster;
        let buffCfg = cfg;
        if (pinPct !== undefined) {
            const ownerCtx = ctx.lastTurnCtxByActor.get(intent.ownerId);
            const casterAttack = ownerCtx?.effectiveAttack ?? owner.attack;
            buffCfg = {
                ...cfg,
                parsedEffects: {
                    ...cfg.parsedEffects,
                    attackFlat: casterAttack * (pinPct / 100),
                },
            };
        }
```

Then change the `status` literal's payload to use `buffCfg`:

```ts
            payload: payloadFromConfig(buffCfg),
```

(Leave `cfg.buffName`/`cfg.duration`/`cfg.oncePerCombat` references as-is — only the payload's `parsedEffects` needs the per-instance copy. `payloadFromConfig` reads `buffName`/`stacks`/`parsedEffects`/`application` off its arg, all present on `buffCfg`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/utils/abilities/__tests__/equipmentAbilities.integration.test.ts -t "Power Infused"`
Expected: PASS — recipient effective attack rose by the caster's effective attack; damage strictly above baseline.

- [ ] **Step 5: Commit**

```bash
git add src/utils/combat/triggers.ts src/utils/abilities/__tests__/equipmentAbilities.integration.test.ts
git commit -m "feat(combat): D-PR10 Task 4 — snapshot caster attack into Power Infused Nanobots grant"
```

---

### Task 5: Update emit-only tests + verify coverage tracker

**Files:**
- Modify: `src/utils/combat/__tests__/enemyReactiveSelfBuffs.test.ts` (~lines 391, 598) — stale "parses to no stat effect" comments + presence-only assertions.
- Modify: `src/utils/abilities/__tests__/equipmentAbilities.integration.test.ts` (~line 2590) if it carries a similar stale comment.
- Verify (likely NO edit): `src/utils/abilities/__tests__/equipmentCoverage.test.ts` — FONT_OF_POWER already in `implementedImplants` and the `.toEqual` array (count-only; D-PR10 doesn't change the count).

- [ ] **Step 1: Read each cited site**

Read `enemyReactiveSelfBuffs.test.ts` ~lines 380-410 and ~585-610, and `equipmentAbilities.integration.test.ts` ~line 2580-2600. Identify which assertions observe the recipient's stats/damage (those will now change) vs which only assert buff presence.

- [ ] **Step 2: Update comments + assertions**

For each PIN site: correct the stale comment ("parses to no stat effect" → describe the real flat-attack effect, snapshotted from the caster). Where an assertion previously captured the recipient's stats/damage and now changes, update the expected value (compute from the snapshot). Where the test's sole purpose is the grant *mechanic* (presence), keep the presence assertion but point the comment at the dedicated magnitude test from Task 4. Do NOT `vitest -u`.

- [ ] **Step 3: Run the affected files + confirm coverage unchanged**

Run:
```bash
npx vitest run src/utils/combat/__tests__/enemyReactiveSelfBuffs.test.ts \
  src/utils/abilities/__tests__/equipmentAbilities.integration.test.ts \
  src/utils/abilities/__tests__/equipmentCoverage.test.ts
```
Expected: all PASS; equipmentCoverage PASS with no edit (if it fails, the count assumption was wrong — reconcile per the known decl-order/Set pitfall).

- [ ] **Step 4: Commit**

```bash
git add src/utils/combat/__tests__/enemyReactiveSelfBuffs.test.ts src/utils/abilities/__tests__/equipmentAbilities.integration.test.ts
git commit -m "test(combat): D-PR10 Task 5 — PIN emit-only tests now assert real flat-attack effect"
```

---

### Task 6: Changelog + full-suite verification

**Files:**
- Modify: `src/constants/changelog.ts` — `UNRELEASED_CHANGES`.

- [ ] **Step 1: Add the changelog entry**

In `UNRELEASED_CHANGES`, add a plain-English line, matching the surrounding style, e.g.:

> "Combat sim: the Font of Power implant's Power Infused Nanobots buff now grants the ally flat attack equal to the caster's attack (previously had no effect)."

- [ ] **Step 2: Full verification sweep**

Run each and confirm:
```bash
npm test            # full suite green; production goldens BYTE-IDENTICAL (no .snap in git diff)
npm run lint        # 0 warnings
npx tsc --noEmit    # clean
npm run audit:skills # 141 ships, 0 findings
git diff --stat origin/main -- '*.snap' 2>/dev/null  # expect EMPTY (no production golden moved)
```
Expected: all green. If any production `.snap` shows in the diff, a fold leaked — STOP and fix the leak; do not regenerate.

- [ ] **Step 3: Commit**

```bash
git add src/constants/changelog.ts
git commit -m "docs(changelog): D-PR10 — Power Infused Nanobots flat-attack effect"
```

---

## Final review (after all tasks)

- [ ] Holistic self-review of the full diff against the spec (sentinel inert in fold; concrete only at grant; additive fold both effective-stat accessors; byte-identical production goldens; coverage 141/0).
- [ ] Confirm the branch is stacked correctly on D-PR9 tip and ready to PR (retarget to main as the lower stack merges). Push and open the PR per the established stack-merge strategy.
