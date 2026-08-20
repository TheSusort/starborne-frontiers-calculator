# SP-4e Implementation Plan — heal-route selector and the enemy no-victim rule

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Derive ally-heal recipients from the ability's own skill text instead of from a run-mode
flag, then delete the engine's last fallback victim so both sides answer a no-victim turn the same
way.

**Architecture:** Add one `AbilityTarget` variant, `'lowest-hp-ally'`, and give it a routing arm at
each of the three `'ally'`-resolution sites *before* the parser emits it — so every commit up to the
parser flip is behaviourally inert. Flip the parser (the one behaviour-change commit for heal
routing), delete the mode-flag arms it made dead, then delete `TurnBindings.legacyVictim` and let a
no-victim enemy turn run through the side-agnostic machinery SP-4c-2b/4d already built.

**Tech Stack:** TypeScript, Vitest + React Testing Library, no runtime deps added.

**Spec:** `docs/superpowers/specs/2026-08-20-sp4e-heal-routes-and-enemy-no-victim-design.md`.
Read §1.2 (locked game rules), §3.2 (why Valkyrie's site is `triggers.ts`) and §5 (churn table)
before starting. **Ships as ONE PR** off `af4f05ae`.

## Global Constraints

- **Never `vitest -u`.** Every moved golden is attributed to exactly one of: C1, C2 (spec §5) or a
  named ship — Pallas, Volk, Valkyrie. A move fitting none of those is a defect.
- **Team symmetry is locked.** Every heal-routing test gets an enemy-side mirror. A player-side-only
  or enemy-side-only fix is the exact defect shape #306 found across 7 ships.
- **Run the whole suite**, not a directory: `npm test`. The golden audit spans all of it. There is
  **no CI test workflow** — the husky pre-commit hook is the only gate.
- **`npm start`**, never `npm run dev`. Dev server is on :3000.
- **`tsc --noEmit` covers `src` only** (`tsconfig` is `include: ["src"]`; lint is `eslint src`). Never
  place a compile-time exhaustiveness guard in `scripts/` — it is never evaluated.
- **Percentage stats are stored as integers** (crit: 70, not 0.70).
- **No emojis in UI text.** Plain text plus colour classes.
- **Re-grep every cited line number before editing it.** Verifying the spec's own citations found
  two already stale. Line numbers in this plan were correct at `af4f05ae` and will drift as you
  edit; anchor on the quoted code, not the number.
- `healTarget` **survives** as the healing calculator's accounting anchor. Only its use as a
  *targeting* fallback is being removed. Do not chase the symbol out of `engine.ts`.
- **`UNRELEASED_CHANGES`** in `src/constants/changelog.ts` gets an entry (Task 6) — this is
  user-visible in the combat sim.

---

## File Structure

| File | Responsibility | Tasks |
| --- | --- | --- |
| `src/types/abilities.ts` | `AbilityTarget` union — add `'lowest-hp-ally'` | 1 |
| `src/utils/skillTextParser.ts` | `ParsedHealAbility.target` union; `resolveHealTarget` selector detection | 1, 3 |
| `src/utils/abilities/buildShipAbilities.ts` | `flipBareSupportTarget` / `flipBareSupportShieldTarget` signature unions | 1 |
| `src/utils/combat/playerTurn.ts` | Site A: `recipientsFor`, `lowestHpAllyId`; `HealingRuntimeCtx.teamBattle` | 2, 4 |
| `src/utils/combat/triggers.ts` | Site B: `reactiveRecipients`, the reactive-heal pool gate | 2 |
| `src/utils/combat/engine.ts` | Site C: `procStandingLeeches*`; `TurnBindings.legacyVictim`; `selectTurnTarget`; the enemy turn body; counters | 2, 4, 5 |
| `src/components/skills/AbilityCard.tsx` | Skill editor target option — **Task 6**, not 1 (see Task 1 Step 10) | 6 |
| `src/pages/DocumentationPage.tsx` | In-app docs for the new routing rule | 6 |
| `src/constants/changelog.ts` | `UNRELEASED_CHANGES` entry | 6 |
| `src/utils/abilities/__tests__/lowestHpAllySelector.test.ts` | **Create** — parser + roster-inventory gate | 1, 3 |
| `src/utils/combat/__tests__/lowestHpAllyRouting.test.ts` | **Create** — sites A/B/C routing, both sides | 2 |
| `src/utils/combat/__tests__/dummyReachability.test.ts` | Counter contract — rewrite against spec §5 | 5 |

---

### Task 1: Add the `'lowest-hp-ally'` variant and sweep every consumer

Behaviourally **inert**: no parser path emits the variant yet, so no ability can carry it and no
golden may move. That inertness is the whole point — it makes the 186-site sweep reviewable on its
own, separately from any behaviour change.

**Files:**
- Modify: `src/types/abilities.ts:88-105` (the `AbilityTarget` union)
- Modify: `src/utils/skillTextParser.ts:3888` and `:4091` (the two `target:` unions)
- Modify: `src/utils/abilities/buildShipAbilities.ts:1051`, `:1064`, `:1105-1112`
- Modify: `src/components/skills/abilityDefaults.ts`, `src/components/skills/AbilityCard.tsx`
- Test: `src/utils/combat/__tests__/lowestHpAllyRouting.test.ts` (create — the containment test)

**Interfaces:**
- Consumes: nothing.
- Produces: the string literal `'lowest-hp-ally'` as a member of `AbilityTarget` and of
  `ParsedHealAbility['target']`. Later tasks route on it.

- [ ] **Step 1: Add the variant to `AbilityTarget`**

In `src/types/abilities.ts`, insert immediately after the `'all-allies'` line:

```ts
    | 'lowest-hp-ally' // SP-4e: the living same-side ally with the lowest currentHp/maxHp, caster
    // EXCLUDED, ties broken by source order. Named by the ability's own text
    // (Pallas "the other ally with the lowest current health percentage", Volk
    // "the ally with the most missing health", Valkyrie "the ally with the lowest
    // current health percentage"). NEVER narrowed by the caster's support
    // footprint — it reaches its ally wherever they stand, on either slot
    // (user-confirmed 2026-08-20). Resolves to NO recipient when the caster is the
    // only living ally: "the OTHER ally" means nobody, not a self-heal.
```

- [ ] **Step 2: Widen the two parser unions**

`src/utils/skillTextParser.ts:3888` (inside `interface ParsedHealAbility`) and the return type at
`:4091` (`resolveHealTarget`) both read:

```ts
    target: 'self' | 'ally' | 'all-allies';
```

Change both to:

```ts
    target: 'self' | 'ally' | 'all-allies' | 'lowest-hp-ally';
```

- [ ] **Step 3: Widen the two flip helpers**

In `src/utils/abilities/buildShipAbilities.ts`, `flipBareSupportTarget` (`:1051`, param and return)
and `flipBareSupportShieldTarget` (`:1105`, same) both use the narrow union. Widen both to
`'self' | 'ally' | 'all-allies' | 'lowest-hp-ally'`.

No logic change is needed: every flip branch is gated on `!explicitTarget`, and the selector always
sets `explicitTarget: true`, so a `'lowest-hp-ally'` value falls straight through to the trailing
`return target;`. Add this comment above that `return`:

```ts
    // SP-4e: 'lowest-hp-ally' always arrives with explicitTarget=true (the text NAMED a
    // recipient), so every branch above is skipped and it passes through unchanged. Do not add a
    // flip arm for it — a named selector is never a "bare" support target.
```

- [ ] **Step 4: Run the typechecker to enumerate the sweep**

Run: `npx tsc --noEmit`

Expected: FAIL, with one error per `switch` that is exhaustive over `AbilityTarget`. **This is the
sweep's worklist for switches.** Record every reported file:line in the PR body.

- [ ] **Step 5: Enumerate the `if`/`else` chains the compiler cannot see**

The compiler finds switches; it does **not** find `if`/`else` chains, which are the dangerous shape
(silent fallthrough, green suite, wrong answer). Enumerate them:

```bash
grep -rn "'all-allies'" src --include="*.ts" --include="*.tsx" \
  | grep -v "__tests__\|\.test\." | grep -v "^src/types/abilities.ts:" \
  | tee /tmp/sp4e-sweep.txt | wc -l
```

Expected: **186** lines across 15 files. Classify every line into one of three buckets and record
the classification in the PR body:

1. **equality test on a specific value** (`x === 'all-allies'`) → no change needed;
2. **`switch` on a target** → already on the Step 4 list;
3. **`if`/`else` chain whose `else` would now absorb the new variant** → needs an explicit arm.

Known bucket-3 sites, to be handled here or by the task that owns them:
- `playerTurn.ts:3850` `recipientsFor` → **Task 2**
- `triggers.ts:2486` `reactiveRecipients` → **Task 2**
- `engine.ts:3908` / `:4033` standing-leech arms → **Task 2**
- `playerTurn.ts:3764` **buff** path and the cleanse paths → **this task, Step 6**

- [ ] **Step 6: Write the failing containment test for the buff path**

The buff path calls `supportRecipients(ab.target, allyRoster, …)`, and `resolveSupportRecipients`
only *filters* — so a `'lowest-hp-ally'` buff would grant to **every ally**. No roster ability
produces one, so nothing catches this; the test must be written from the defect.

Create `src/utils/combat/__tests__/lowestHpAllyRouting.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resolveSupportRecipients } from '../supportRecipients';

describe("SP-4e 'lowest-hp-ally' containment", () => {
    // The variant is a SINGLE-recipient selector. resolveSupportRecipients only FILTERS its
    // baseRecipients, so any caller that passes the whole ally roster as `base` fans a
    // single-recipient target out to everyone. This test pins the invariant at the shared helper
    // so every caller inherits it.
    it('never widens a single-recipient selector to the whole roster', () => {
        const out = resolveSupportRecipients({
            target: 'lowest-hp-ally',
            casterId: 'p1',
            baseRecipients: ['p1', 'p2', 'p3'],
            footprintAllyIds: ['p1', 'p2', 'p3'],
        });
        expect(out.length).toBeLessThanOrEqual(1);
    });
});
```

- [ ] **Step 7: Run it and confirm it fails**

Run: `npx vitest run src/utils/combat/__tests__/lowestHpAllyRouting.test.ts`
Expected: FAIL — received `['p1','p2','p3']`, length 3.

- [ ] **Step 8: Make it pass in `resolveSupportRecipients`**

In `src/utils/combat/supportRecipients.ts`, add a guard at the top of the function body, before the
`footprintAllyIds === undefined` early return:

```ts
    // SP-4e: a named single-recipient selector is resolved by the CALLER (it needs live HP, which
    // this helper has no access to). Callers pass an already-resolved one-id array. Reaching here
    // with a multi-id base means a caller forgot to resolve it and is about to fan a
    // single-recipient heal out to the whole roster — clamp rather than widen.
    if (args.target === 'lowest-hp-ally') return args.baseRecipients.slice(0, 1);
```

- [ ] **Step 9: Run the test again**

Run: `npx vitest run src/utils/combat/__tests__/lowestHpAllyRouting.test.ts`
Expected: PASS.

- [ ] **Step 10: Do NOT add the editor surface yet — it moves to Task 6**

✅ **Superseded (2026-08-21).** The deferral held only until the routing sites landed, which they
did in Task 2. The option `{ value: 'lowest-hp-ally', label: 'Lowest HP ally' }` was added to
`AbilityCard.tsx`'s `TARGET_OPTIONS` (and the placeholder comment deleted) in **Task 3's fix wave**,
because Task 3 ships the three parsed ships and the editor was rendering their Target field as the
bare `defaultOption` "Select". **Task 6 Step 3 is therefore already done — do not add it twice.**

⚠️ **Corrected after review (2026-08-20).** Adding `'lowest-hp-ally'` to `AbilityCard.tsx`'s
`TARGET_OPTIONS` in this task makes a **user-authorable crash**: `recipientsFor`
(`playerTurn.ts`) does not route the variant until Task 2, so it reaches
`resolveSupportRecipients`, which now throws; and `reactiveRecipients` resolves it to
`[intent.ownerId]` — the caster, the one answer the selector forbids. A reviewer built the repro:
author a heal with that target, run any healing-mode sim with another living ally, and
`runPlayerTurn` throws.

So this task leaves the editor option OUT, with a comment at the `TARGET_OPTIONS` site saying why,
and **Task 6 adds it** once all three routing sites are live. The engine must never honour a target
the editor cannot author — but the editor must never offer one the engine cannot route.

`abilityDefaults.ts` needs no change either way: its only `AbilityTarget` surface is
`DEFAULT_TARGETS: Record<AbilityType, AbilityTarget>`, a default per ability *type*, with no
ally-target list to extend. Changing an existing default would be a behaviour change.

- [ ] **Step 11: Fix every switch from Step 4, adding a `never` guard to each**

For each site, add the `'lowest-hp-ally'` arm and, where the switch lacks one, a default that makes
the next variant a compile error:

```ts
        default: {
            const _exhaustive: never = target;
            return _exhaustive;
        }
```

Do **not** place any such guard in `scripts/` — `tsc` does not cover it.

- [ ] **Step 12: Verify green and inert**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: all pass, **zero golden movement.** Any moved golden here is a defect — nothing emits the
variant yet, so no behaviour can have changed.

- [ ] **Step 13: Commit**

```bash
git add -A
git commit -m "feat(abilities): add the 'lowest-hp-ally' target variant and sweep its consumers

Inert: no parser path emits it yet. Adds the variant, widens the parser and
flip-helper unions, adds exhaustiveness guards, and clamps the shared
support-recipient helper so a single-recipient selector can never fan out to
the whole roster (the latent buff-path defect the skill editor makes
constructible)."
```

---

### Task 2: Route the variant at all three `'ally'` sites

Still **inert** — nothing emits the variant. This task builds the destination so the parser flip in
Task 3 is a one-line behaviour change with somewhere correct to land.

Read spec §3.2 first: **Valkyrie's live site is `triggers.ts`, not `procStandingLeeches`.**

**Files:**
- Modify: `src/utils/combat/playerTurn.ts:3829-3866` (site A)
- Modify: `src/utils/combat/triggers.ts:2486-2502` (`reactiveRecipients`), `:3845-3862` (the heal
  pool gate), `:1539` (`IntentExecContext`) — site B
- Modify: `src/utils/combat/engine.ts:3908-3915` and `:4033-4041` (site C)
- Test: `src/utils/combat/__tests__/lowestHpAllyRouting.test.ts` (extend)

**Interfaces:**
- Consumes: `'lowest-hp-ally'` from Task 1.
- Produces:
  - `playerTurn.ts` — `lowestHpAllyId(ids: string[]): string | undefined` (**return type changes**
    from `string`; the caster fallback is gone).
  - `triggers.ts` — `IntentExecContext` gains
    `lowestHpAllyIdFor?: (ownerId: string) => string | undefined`, supplied by the engine where the
    other `ctx.healing` accessors are built.

- [ ] **Step 1: Write the failing site-A test (both sides)**

Append to `src/utils/combat/__tests__/lowestHpAllyRouting.test.ts`. Build the fixture with the
existing helpers in the file's sibling tests — copy the `runCombat` fixture shape from
`src/utils/combat/__tests__/healingPerRecipientApply.test.ts`, which already sets up a
multi-ally healing run, and give the caster a hand-built `'lowest-hp-ally'` heal ability:

```ts
// A hand-built ability, NOT a parsed one: the parser does not emit this variant until Task 3.
// Two allies at different HP fractions + the caster. The heal must land on the LOWER-fraction
// ally, and NOT on the caster or the heal anchor.
const lowestHpAllyHeal = (pct: number): Ability => ({
    id: 'ab-lowest',
    config: { type: 'heal', pct, basis: 'hp' },
    target: 'lowest-hp-ally',
    trigger: 'on-cast',
    conditions: [],
});
```

Assert on the **recipient axis** (`healing.perRecipient`), not a summed total — a total looks
plausible while per-recipient accounting is absent (spec §5.1 rule 5). Write four cases:

1. player caster, two living allies at 30% and 80% → the 30% ally is the sole recipient;
2. **enemy caster**, mirror of case 1 over the enemy roster (locked symmetry rule);
3. the worst-HP ally is **off the caster's support footprint** → still the recipient
   (spec §1.2: a named selector is never footprint-scoped, on either slot);
4. caster is the only living ally → **no recipient at all**, and no self-heal.

- [ ] **Step 2: Run and confirm all four fail**

Run: `npx vitest run src/utils/combat/__tests__/lowestHpAllyRouting.test.ts`
Expected: FAIL. Cases 1-3 route to `healing.targetId` (the `else` arm); case 4 self-heals.

- [ ] **Step 3: Implement site A**

In `src/utils/combat/playerTurn.ts`, replace the `lowestHpAllyId` comment and its `return`:

```ts
        // SP-4e: resolver for the `'lowest-hp-ally'` TARGET (Pallas, Volk, Valkyrie), which the
        // ability's own TEXT names — no longer a mode-flag route. Lowest HP FRACTION among living
        // same-side allies, caster excluded, ties broken by source order.
        // Returns UNDEFINED when the caster is the only living ally: Pallas says "the OTHER ally",
        // so there is nobody, and the pre-4e `?? actor.id` tail made that a self-heal her text
        // forbids. Callers must handle undefined by producing NO recipient.
        const lowestHpAllyId = (ids: string[]): string | undefined => {
```

and change the final line of that function from `return best ?? actor.id;` to `return best;`.

Then add the routing arm in `recipientsFor`, **before** the `all-allies` arm, returning directly so
it bypasses `supportRecipients`:

```ts
            // SP-4e: a named selector is NEVER narrowed by the support footprint — it reaches its
            // ally wherever they stand, on the active slot as much as the passive
            // (user-confirmed 2026-08-20; the same rule already recorded for passives at :1338).
            // So this returns DIRECTLY rather than falling through to supportRecipients.
            if (target === 'lowest-hp-ally') {
                const rid = lowestHpAllyId(isEnemyCaster ? healing.enemyIds : healing.playerIds);
                return rid === undefined ? [] : [rid];
            }
```

Leave the `isEnemyCaster` / `healing.teamBattle` / `else … targetId` arms **in place** — Task 4
deletes them, after the parser flip has made them dead.

- [ ] **Step 4: Run the site-A tests**

Run: `npx vitest run src/utils/combat/__tests__/lowestHpAllyRouting.test.ts`
Expected: PASS, all four cases.

- [ ] **Step 5: Write the failing site-B test (the reactive path)**

Valkyrie's route. Two defects in one: `reactiveRecipients` falls through to the anchor, and
`triggers.ts:3849`'s `if (rid === ctx.healing.targetId)` restores HP only to the anchor — so even
once routing is fixed, a non-anchor recipient would be credited gross and healed **nothing**.

Add to the same test file, driving a reactive `'lowest-hp-ally'` heal through
`partitionReactiveAbilities` (use a live trigger — `'on-bomb-detonated'` is Valkyrie's, and it is in
`LIVE_TRIGGERS`). Assert **two** things separately:

1. the recipient is the worst-HP ally, not `healTargetId`;
2. that ally's `currentHp` **actually rose** — i.e. `effectiveHeal` is non-zero for it, not just
   `directHeal`. This is the assertion that catches the pool gate; a gross-only test passes while
   the heal does nothing.

Mirror both on the enemy side.

- [ ] **Step 6: Run and confirm it fails**

Run: `npx vitest run src/utils/combat/__tests__/lowestHpAllyRouting.test.ts`
Expected: FAIL on both assertions.

- [ ] **Step 7: Implement site B — routing**

In `src/utils/combat/triggers.ts`, add the arm to `reactiveRecipients` ahead of the `'ally'` arm:

```ts
    const base =
        intent.ability.target === 'lowest-hp-ally'
            ? // SP-4e: resolved by the engine (it owns live HP), side-relative to the OWNER.
              // Undefined → no recipient (Pallas's "the OTHER ally" with nobody else alive).
              (() => {
                  const rid = ctx.lowestHpAllyIdFor?.(intent.ownerId);
                  return rid === undefined ? [] : [rid];
              })()
            : intent.ability.target === 'ally'
              ? ...
```

Add `lowestHpAllyIdFor?: (ownerId: string) => string | undefined` to `IntentExecContext`
(`triggers.ts:1391`, beside `footprintAllyIdsFor` at `:1539`), and
supply it in `engine.ts` beside the other `ctx.healing` accessors, resolving over the owner's OWN
side (`owner.actor.side === 'enemy' ? healingCtx.enemyIds : healingCtx.playerIds`) with the same
lowest-fraction/caster-excluded rule as site A.

**Do not duplicate the ranking logic.** Extract it once — a module-level
`pickLowestHpFractionAlly(ids, excludeId, hpOf, maxHpOf): string | undefined` in
`src/utils/combat/supportRecipients.ts` — and call it from both site A and the engine's accessor.
Two hand-copied rankings is the shape that produced the one-directional defects in #306.

- [ ] **Step 8: Implement site B — the pool gate**

Replace `triggers.ts:3849`'s anchor-only heal application with the per-recipient shape the reactive
**shield** branch 15 lines below already uses:

```ts
            if (cfg.type === 'heal') {
                ctx.healing.credit(intent.ownerId, 'directHeal', raw);
                healPerTarget.push({ targetId: rid, amount: raw });
                healSum += raw;
                // SP-4e: apply to the RESOLVED recipient's own pool, mirroring the reactive
                // SHIELD branch below (which has always resolved recipientActor). The old
                // `rid === ctx.healing.targetId` gate credited gross for every recipient but
                // restored HP only to the anchor — invisible while every reactive 'ally' heal
                // routed to the anchor anyway, a silent no-op the moment one does not.
                const recipientActor = ctx.healing.recipientActor(rid);
                if (recipientActor) {
                    const { consumed, overheal } = ctx.healing.applyHealToTarget(
                        raw,
                        recipientActor
                    );
                    ctx.healing.credit(intent.ownerId, 'effectiveHeal', consumed);
                    ctx.healing.credit(intent.ownerId, 'overheal', overheal);
                    if (ctx.healing.perRecipientApply) {
                        ctx.healing.creditRecipient?.(rid, 'directHeal', raw);
                        ctx.healing.creditRecipient?.(rid, 'effectiveHeal', consumed);
                        ctx.healing.creditRecipient?.(rid, 'overheal', overheal);
                    }
                }
            } else {
```

⚠️ **This one is not inert.** It changes reactive-heal application for *every* non-anchor recipient
— i.e. every `all-allies` reactive heal, which the corpus does have. Run the full suite at this step
and attribute every move: a non-anchor ally now gains HP where before it was credited gross only.
If a golden moves in a file with no reactive heal, stop — that is a different defect.

- [ ] **Step 9: Run the full suite and attribute**

Run: `npm test`
Expected: site-B tests PASS. Any golden movement is confined to files with reactive `all-allies`
heals, and each move is a non-anchor ally gaining HP. Record the list in the PR body.

- [ ] **Step 10: Implement site C (the corpus-dead standing-leech arms)**

In `engine.ts`, add a `'lowest-hp-ally'` arm to both `procStandingLeeches` (`:3908`) and
`procStandingLeechesPerVictim` (`:4033`), resolving via the shared
`pickLowestHpFractionAlly` over the owner's own side and applying to that actor's pool through
`applyHealToTarget(raw, recipientActor)` / `grantShieldToTarget(raw, recipientActor)` — the shape
`procStandingLeechesPerVictim` already uses.

Then correct the comment at `:4024-4032`, which currently justifies the enemy-side `[]` by saying
"`ally` … has no enemy-side equivalent". With the selector that is no longer true — an enemy owner
resolves its own side. Rewrite; do not delete.

**Churn expectation: ZERO** — every leech surviving the reactive partition targets `self`. Per spec
§5.1 rule 3, when the zero comes back, go find the test that *should* have moved and record why
none exists.

- [ ] **Step 11: Verify**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: all pass; movement only from Step 8, already attributed.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "feat(combat): route 'lowest-hp-ally' at all three ally-resolution sites

Cast (playerTurn recipientsFor), reactive (triggers reactiveRecipients) and
standing-leech (engine). Ranking lives once in pickLowestHpFractionAlly.
lowestHpAllyId now returns undefined instead of falling back to the caster.

Also fixes the reactive-heal pool gate: a non-anchor recipient was credited
gross but never had HP restored. Mirrors the reactive shield branch beside it."
```

---

### Task 3: Flip the parser — the heal-routing behaviour change

**This is where heal-routing churn lands.** One regex change, three ships.

**Files:**
- Modify: `src/utils/skillTextParser.ts:4104-4112` (`resolveHealTarget`)
- Test: `src/utils/abilities/__tests__/lowestHpAllySelector.test.ts` (create)

**Interfaces:**
- Consumes: `'lowest-hp-ally'` (Task 1) and its routing arms (Task 2).
- Produces: Pallas, Volk and Valkyrie carrying `target: 'lowest-hp-ally'` instead of `'ally'`.

- [ ] **Step 1: Write the failing parser + inventory test**

Create `src/utils/abilities/__tests__/lowestHpAllySelector.test.ts`. Two describe blocks.

Block 1 — per-ship parse, built on the CSV rows (the source of truth for the parser, **not**
`ships.ts`), read via `readCsvRecords` / `parseCsvLine` from `scripts/lib/shipSkillCsv` the way
`scripts/auditSkills.ts` does:

```ts
// Pallas: "The other ally with the lowest current health percentage heals for 20% of the damage
//   dealt" — active slot.
// Volk: "repairs 30% of its Max HP to the ally with the most missing health" — passive slot.
// Valkyrie: "this Unit and the ally with the lowest current health percentage repair 5% of damage
//   dealt" — passive slot, on-bomb-detonated. Note it ALSO emits a mirrored 'self' entry.
```

Assert each ship's heal ability carries `target: 'lowest-hp-ally'` with `explicitTarget: true`.

Block 2 — the **inventory gate** (spec §3.5). Sweep every CSV row through `buildShipAbilities`,
collect `{ship, slot, type, target}` for every ability, and assert the set of abilities with
`target: 'lowest-hp-ally'` is **exactly** those three. Assert separately that **Chimei** carries
none — its passive contains a full match for the selector regex ("the ally with the lowest current
health percentage") inside a sentence describing the unimplemented over-repair overflow, and the
parser's sentence scoping is the only thing keeping it out. Keep this checked in, so the next
parser change cannot quietly widen the selector.

- [ ] **Step 2: Run and confirm it fails**

Run: `npx vitest run src/utils/abilities/__tests__/lowestHpAllySelector.test.ts`
Expected: FAIL — all three ships still parse to `'ally'`.

- [ ] **Step 3: Flip the parser**

In `src/utils/skillTextParser.ts`, `resolveHealTarget`: remove `most\s+missing\s+health` and
`\bthe\s+other\s+ally\b` from the singular-`'ally'` alternation, and insert a selector test
**above** it (after the `sWithoutKillAntecedent` assignment):

```ts
    // SP-4e: the text NAMES its recipient by live HP — Pallas ("the other ally with the lowest
    // current health percentage"), Volk ("the ally with the most missing health"), Valkyrie ("the
    // ally with the lowest current health percentage"). One selector covers all three: "most
    // missing health" is loose phrasing for lowest HP PERCENTAGE, not absolute missing HP
    // (user-confirmed 2026-08-20) — do NOT model an absolute basis.
    // Tested BEFORE the generic singular arm below, because Pallas's sentence matches both.
    // Sentence-scoped by the caller, which is the only thing keeping Chimei's over-repair
    // sentence ("the ally with the lowest current health percentage repairs an amount equivalent
    // to the over-repair" — a different, unimplemented mechanic) out of this arm.
    if (
        /most\s+missing\s+health|lowest\s+current\s+health(?:\s+percentage)?|\bthe\s+other\s+ally\b/.test(
            sWithoutKillAntecedent
        )
    )
        return { target: 'lowest-hp-ally', explicit: true };
```

- [ ] **Step 4: Run the parser test**

Run: `npx vitest run src/utils/abilities/__tests__/lowestHpAllySelector.test.ts`
Expected: PASS, including the Chimei-unchanged assertion.

- [ ] **Step 5: Run the whole suite and attribute every move**

Run: `npm test`

Expected movement, and nothing else — each move traceable to one named ship:
- **Pallas** — her active heal reaches the worst-HP ally even when off-footprint (previously
  intersected away), and no longer self-heals when she is the only living ally.
- **Volk** — **moves in `mode: 'healing'`, not in `mode: 'battle'`.** ⚠️ Corrected 2026-08-20: an
  earlier draft of this step said "no change expected", which is true only for battle mode.
  `engine.ts:3402` sets `teamBattle: runMode === 'battle'`, so a healing-calculator run has
  `teamBattle === false` and Volk's passive currently falls to `else base = [healing.targetId]` —
  the user's chosen focus ship. The flip routes it to the worst-HP ally in **both** modes, which
  means **Task 3, not Task 4, is what closes defect D3** (spec §1). In battle mode he was already
  unscoped and already lowest-HP, so no movement there; a *battle-mode* Volk move would mean the
  selector's ranking diverges from `lowestHpAllyId`'s — investigate that, do not re-pin.
- **Pallas** — same two-mode split, plus the footprint change: in healing mode she moves off
  `healing.targetId`; in battle mode she moves because her ACTIVE-slot heal is no longer
  intersected with the support footprint.
- **Valkyrie** — her detonation repair moves off the heal anchor onto the worst-HP ally, and now
  actually restores that ally's HP (Task 2 Step 8).

**Never `vitest -u`.** A move attributable to none of the three is a defect. Record the attributed
list in the PR body.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(skills): parse a named worst-HP ally recipient as 'lowest-hp-ally'

Pallas, Volk and Valkyrie name their recipient by live HP; they now carry the
selector instead of a generic 'ally' resolved by a run-mode flag. 'most missing
health' maps to lowest HP percentage (user-confirmed), so one selector covers
all three. A checked-in roster inventory gate pins the set at exactly those
three and asserts Chimei stays out."
```

---

### Task 4: Delete the mode-flag arms and collapse the two-axis split

Task 3 made these dead. Deleting them changes plain-`'ally'` cast routing to the caster's target
pattern — the user's ruling, and **measured corpus-empty** on the cast path (only Pallas and Volk
reached that branch, and both now carry the selector).

**Files:**
- Modify: `src/utils/combat/playerTurn.ts:3850-3866` (`recipientsFor`), `:176-182`
  (`HealingRuntimeCtx`), `:4149-4153` (the two-axis comment)
- Modify: `src/utils/combat/engine.ts:3338` (`teamBattle: runMode === 'battle'`), `:2490`
- Modify: `src/utils/calculators/healingEngineAdapter.ts:696` (the stale comment)
- Test: `src/utils/combat/__tests__/healingPerRecipientApply.test.ts`,
  `healingPerRecipientAxis.test.ts` (both carry `teamBattle` in header comments and cases)

- [ ] **Step 1: Write the failing test for plain-`'ally'` footprint routing**

Add to `src/utils/combat/__tests__/lowestHpAllyRouting.test.ts`: a hand-built plain `'ally'` heal
(`target: 'ally'`, no selector) on a caster whose support footprint covers only some allies routes
to the **footprint-covered** allies, not to `healing.targetId`. Mirror on the enemy side.

- [ ] **Step 2: Run and confirm it fails**

Run: `npx vitest run src/utils/combat/__tests__/lowestHpAllyRouting.test.ts`
Expected: FAIL — routes to `healing.targetId` via the surviving `else` arm.

- [ ] **Step 3: Reduce `recipientsFor` to the selector-derived form**

Replace the whole arm chain (and the `teamBattle` block comment above it) with:

```ts
        const recipientsFor = (ability: Ability, fromPassive: boolean): string[] => {
            const target = ability.target;
            const ownSideIds = isEnemyCaster ? healing.enemyIds : healing.playerIds;
            // SP-4e: a named selector is NEVER footprint-scoped — it reaches its ally wherever
            // they stand, on either slot (user-confirmed 2026-08-20). Returns directly.
            if (target === 'lowest-hp-ally') {
                const rid = lowestHpAllyId(ownSideIds);
                return rid === undefined ? [] : [rid];
            }
            // Everything else routes over the caster's own side and is narrowed by the support
            // footprint. `'ally'` included: an unspecified single ally means "the ship's target
            // pattern" (user-confirmed 2026-08-20). The pre-4e mode-flag arms are GONE —
            // `isEnemyCaster`/`teamBattle` lowest-HP routing and the `[healing.targetId]`
            // fallback. Routing now comes from the ability's TEXT, not from the run mode, so the
            // two sides are symmetric by construction rather than by two mirrored branches.
            const base = target === 'self' ? [actor.id] : ownSideIds;
            return supportRecipients(target, base, { ability, fromPassive });
        };
```

- [ ] **Step 4: Delete `teamBattle`**

Remove `teamBattle?: boolean` from `HealingRuntimeCtx` (`playerTurn.ts:179`) and the
`teamBattle: runMode === 'battle',` line in `engine.ts:3338`. Leave `perRecipientApply` as the
single axis, and delete the two-axis explanation at `:180-182` and `:4149-4153`.

Update `engine.ts:2490`, whose comment names "the `teamBattle` path".

Rewrite `healingEngineAdapter.ts:696` — it justifies `perRecipientHealApply: true` as "WITHOUT
teamBattle's lowest-HP routing, which is not the game's rule (only Volk's passive is)". Half of
that is now wrong (Pallas and Valkyrie qualify too) and the flag it justifies is the surviving
axis:

```ts
        // Heals apply to each recipient the caster's support pattern covers. Recipient CHOICE is
        // no longer a mode flag: a ship whose text names a worst-HP ally (Pallas, Volk, Valkyrie)
        // carries the 'lowest-hp-ally' target and routes there on any run; everything else routes
        // over the pattern. SP-4e retired `teamBattle`, which conflated the two.
```

- [ ] **Step 5: Update the two `teamBattle` tests**

`healingPerRecipientApply.test.ts` and `healingPerRecipientAxis.test.ts` both document
`single 'ally', teamBattle ON → [lowestHpAllyId(playerIds)]` in header comments and exercise it.
Rewrite the headers against the new rule and convert the routing cases to `'lowest-hp-ally'`. Do
not delete the *application*-axis cases — `perRecipientApply` still exists and is still what those
files are for.

- [ ] **Step 6: Run the whole suite**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: PASS. **No `teamBattle` symbol survives** — verify with
`grep -rn "teamBattle" src` returning only test-history prose you deliberately kept. Per the
raw-bytes lesson, if a grep returns nothing where you expected a hit, run `file <path>` before
trusting it.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(combat): delete the mode-flag heal routes and collapse teamBattle

Task 3 made the isEnemyCaster/teamBattle lowest-HP arms and the
[healing.targetId] fallback dead. Plain 'ally' now routes over the caster's
target pattern. teamBattle is gone; perRecipientApply is the only axis."
```

---

### Task 5: #335 — delete `legacyVictim`, one no-victim rule for both sides

The largest mechanical surface in the PR. Read spec §4 and §5 first — especially **§4.2**, which
records that #335's own narrative is wrong and must be corrected in the PR body.

**Files:**
- Modify: `src/utils/combat/engine.ts` — `:1700-1741` (the counter doc block), `:1744-1774` (the two
  counters), `:6941-6989` (`TurnBindings` + both bindings), `:7266-7277` (`selectTurnTarget`),
  `:10140` (the enemy cadence-only arm) and the enemy turn body below it
- Modify: `src/utils/combat/__tests__/dummyReachability.test.ts`
- Modify: `src/utils/combat/__tests__/twoTeamBattle.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `__getNoVictimTurnCount()` / `__resetNoVictimTurnCount()` (renamed from
  `…PlayerTurnCount`); `TurnBindings` without `legacyVictim`.

- [ ] **Step 1: Write the failing test for the enemy no-victim turn**

`twoTeamBattle.test.ts` already holds `"bug repro: enemy supporter turn skipped after the focus
player dies"`, which pins the **dead-anchor** half. Add the **live-anchor** half — spec §5's class
C2, 324 measured rows, the one with real consequences:

```
an ally-targeted enemy supporter, with a LIVING placed player roster, resolves NO victim
and still lands its support
```

Assert three things:
1. the supporter's buff/heal **lands** on its own ally (the turn ran);
2. **no** `targetId` is emitted for that turn (there is no victim to key a per-victim store by —
   contract §B: consumers must read this as "no enemy", never "an enemy with neutral stats");
3. the focus player's HP is **untouched** by that turn — today it is bound as the victim.

- [ ] **Step 2: Run and confirm it fails**

Run: `npx vitest run src/utils/combat/__tests__/twoTeamBattle.test.ts`
Expected: FAIL on assertions 2 and 3 — the focus player is currently the resolved victim.

- [ ] **Step 3: Delete `TurnBindings.legacyVictim`**

Remove the field from the interface (`engine.ts:6953`) together with its ~13-line doc comment, and
remove `legacyVictim: undefined,` from `playerTurnBindings` and `legacyVictim: healTarget,` from
`enemyTurnBindings`.

- [ ] **Step 4: Make `selectTurnTarget` side-agnostic**

Replace the tail of `selectTurnTarget`:

```ts
            // SP-4e: ONE rule for both sides. An actor that resolves no living positional victim
            // runs a NO-VICTIM turn — the honest answer, and the only one that does not silence a
            // supporter. The enemy side used to fall back to `legacyVictim: healTarget`, so an
            // ally-targeted enemy supporter resolved the FOCUS PLAYER as the victim of a cast that
            // never targeted them (324 measured rows, spec §5 class C2). Every victim-derived read
            // now answers "there is no enemy" instead (contract §B).
            if (selected == null) {
                noVictimTurnCount++;
                return { tgt: undefined };
            }
            return { tgt: selected };
```

- [ ] **Step 5: Retire one counter and rename the other**

Delete `legacyVictimFallbackCount`, `__getLegacyVictimFallbackCount` and its reset. Rename
`noVictimPlayerTurnCount` → `noVictimTurnCount` (and its accessor/reset) — it now covers both
sides, and a counter whose name has gone false is the exact failure the block at `:1700` warns
about. Replace that whole doc block: it describes a fallback object that no longer exists.

- [ ] **Step 6: Let the no-victim enemy turn run**

At `engine.ts:10140`, narrow:

```ts
                            if (skipDeadTargetTurn) {
```

Then make every victim-derived read in the `else` body conditional on the victim's presence. The
`else` currently narrows `tgt` to a defined `CombatActor` for the whole real-turn body, so this is
mechanical and wide.

**Follow the template 4d already built on the player side** — `buildTurnArgs` omitting the
victim-derived spread (`enemy`, the five containers, `enemyDefense`/`enemyHp`,
`targetRepairedThisRound`, `targetEffectiveAttack`, `enemyDebuffNames`) and `runPlayerTurn`
tolerating an absent victim, including the publication guard already living there. `runPlayerTurn`
is walked by **both** sides, so adopt it; do not re-derive a second rule.

Two traps, both already paid for on the player side:
- **Do not restore a `: 100` fallback** for a missing enemy-HP reading. The gate-facing value is
  absent, so an enemy-HP gate is *unresolvable*, not *satisfied* (see the `enemyHpPct` comment at
  `playerTurn.ts:1386`). The `: 0` arm there is separately reachable — do not collapse the ternary.
- **Fencing a derived value is only safe if it is not also published as standing state.** The
  published-value fencing defect silenced every supporter's reactive debuffs once already.

- [ ] **Step 7: Rewrite `dummyReachability.test.ts`**

Its header names the two enemy-side fallback classes and deliberately carries no figures. Both
classes are gone. Rewrite it against spec §5's table as the counter contract: `noVictimTurnCount`
counts **both** sides, and no `legacyVictim` symbol survives anywhere in `src`.

- [ ] **Step 8: Run the whole suite and attribute against spec §5**

Run: `npm test`

Expected movement, confined to the measured file lists in spec §5:
- **C2 (324 rows, 10 files)** — the real churn. `placementSymmetry.test.ts` (180) is the
  placement-symmetry **oracle**: it exists to catch exactly this asymmetry, so movement there is
  the point. Check the moves run *toward* symmetry — an enemy supporter that stops reading a player
  victim should make the two sides agree. Then `interactionInvariants` (53), `simGolden` (30),
  `enemyReactiveSelfBuffs` (16), `twoTeamBattle` (12), `combatLogVisibility` (12),
  `reflectGearSet` (8), `buffGranterAttribution` (5), `reactiveDamagePositionalHp` (4),
  `counterReflectLog` (4).
- **C1 (1,341 rows, 12 files)** — moves only where a no-victim turn has a self-effect (a self-buff,
  a charge step beyond the cadence the skip already ran, a DoT tick). `dpsSimulator.test.ts` holds
  1,047. Where a golden does **not** move, that is expected — but per spec §5.1 rule 3, go find the
  test that should have moved and say why none exists.
- **C3 (15 rows, 3 files)** — unchanged; still the dead-target skip.

A move in a file on none of those lists is a defect. **Never `vitest -u`.**

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "fix(combat): one no-victim rule for both sides; delete legacyVictim (#335)

The enemy side's legacyVictim: healTarget made an ally-targeted enemy supporter
resolve the FOCUS PLAYER as the victim of a cast that never targeted them (324
measured rows). It now runs a no-victim turn through the side-agnostic
machinery SP-4c-2b/4d built, exactly as the player side does.

Corrects #335's premise: its 1,341 rows are enemies with an enemy-side parsed
target and every victim dead, not silenced supporters. The supporter class is a
separate 324 rows, and those turns already ran - against a fabricated victim.

Closes #335"
```

---

### Task 6: Comment sweep, changelog, in-app docs

Spec §5.1 rule 6: sweep the comment claims **around** each edit, not just the edit. Three of five
stale comments found during #318 predated that change.

**Files:**
- Modify: `src/constants/changelog.ts` (`UNRELEASED_CHANGES`)
- Modify: `src/pages/DocumentationPage.tsx`
- Modify: comment blocks listed below

- [ ] **Step 1: Sweep every comment anchor**

Re-grep each before editing — two of the spec's own citations were already stale.

`engine.ts`: `:1700-1741` (the counter doc block — replaced in Task 5, verify nothing else cites
it), `:2490` (names "the `teamBattle` path"), `:6941-6953` (`TurnBindings` doc), `:10148-10152` (the
cadence-only arm's `SP-U U5` note about "no legacy heal anchor"), `:4024-4032` (the standing-leech
enemy-side `[]` justification — Task 2 Step 10).

`playerTurn.ts`: `:176-182` (two-axis), `:1338-1343` (the Volk footprint rule — **extend** it from
"passive" to "any text-named selector"; do not delete, it is the user-verified source), `:3827-3864`
(the routing block), `:4149-4153` (two-axis).

`triggers.ts`: `:2504-2517` (`footprintFilteredRecipients` jsdoc — state that a named selector is
not footprint-scoped at all), `:3793-3797` (the "prefers eventCtx.damagedAllyId over the healing
target" recipients comment).

- [ ] **Step 2: Add the changelog entry**

In `src/constants/changelog.ts`, append to `UNRELEASED_CHANGES` — plain English, no jargon, no
emoji:

```ts
    'Combat sim: ships whose skill text repairs "the ally with the lowest health" (Pallas, Volk, Valkyrie) now heal that ally wherever they are on the board, instead of the ship you picked as the focus.',
    'Combat sim: enemy support ships that cast on their own allies no longer register your focus ship as a target on that turn.',
```

- [x] ~~**Step 3: Add the editor surface (moved here from Task 1)**~~ — **DONE in Task 3's fix
wave (2026-08-21). Do not repeat it.**

`{ value: 'lowest-hp-ally', label: 'Lowest HP ally' }` is already in
`src/components/skills/AbilityCard.tsx`'s `TARGET_OPTIONS`, in ally-side order after `'all-allies'`,
and Task 1's placeholder comment is gone. It moved forward because Task 3 shipped Pallas, Volk and
Valkyrie carrying the target: with the option missing, the editor's Target field fell back to
`Select`'s `defaultOption` — the literal word "Select" — for all three, as though unset, and
touching the dropdown overwrote the parsed selector with no way to restore it.

Still worth doing here if not already done: verify in the running app (`npm start`, port 3000) that
a hand-authored heal with this target resolves to the worst-HP ally and does not throw — the crash
the original deferral existed to prevent.

`abilityDefaults.ts` needs no change: its only `AbilityTarget` surface is `DEFAULT_TARGETS:
Record<AbilityType, AbilityTarget>`, a per-ability-type default with no ally-target list.

- [ ] **Step 4: Update the in-app docs**

In `src/pages/DocumentationPage.tsx`, in the combat-sim/skills section, state the recipient rule:
a ship whose text names a worst-HP ally heals that ally regardless of its targeting pattern;
otherwise an ally-targeted repair follows the ship's pattern. Use existing UI components from
`src/components/ui/` — no raw HTML with inline Tailwind.

- [ ] **Step 5: Final verification**

Run: `npx tsc --noEmit && npm run lint && npm run format:check && npm test`
Expected: all pass.

⚠️ Do **not** run `npm run format` — it rewrites the whole tree and drags in main's pre-existing
Prettier drift. If `format:check` fails, run Prettier on your changed files only.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "docs(combat): editor surface, sweep stale routing comments, changelog and in-app docs"
```

- [ ] **Step 7: Open the PR**

Body must carry, per the spec's acceptance rules:
1. the **attributed** golden-movement list from Tasks 2, 3 and 5, each move tied to C1, C2 or a
   named ship;
2. the **§3.4 sweep classification** — all 186 sites bucketed, and the switch list from Task 1
   Step 4;
3. the **corrections**: §6 of the epic spec had two false claims (§1, §1.1), #335's narrative is
   wrong (§4.2), and Valkyrie's site is `triggers.ts` not `procStandingLeeches` (§3.2);
4. the **predicted-zero follow-ups**: site C's standing-leech arms, and any C1 file that did not
   move — with the reason no test covers it.

Then: `gh auth switch --user TheSusort` before any `gh` call. A rate-limited CodeRabbit check
reports **pass** — green does not mean reviewed. Verify via the reviews API, and note it *edits*
its summary comment, so polling for a new comment never fires.

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
| --- | --- |
| §2 selector variant + parser | 1 (variant), 3 (parser) |
| §3.1 site A routing | 2 (arm), 4 (delete mode-flag arms) |
| §3.2 site B `triggers.ts` + pool gate; site C dead arms | 2 (Steps 5-10) |
| §3.3 collapse `teamBattle` | 4 |
| §3.4 hand-enumerated-layer sweep | 1 (Steps 4-11) |
| §3.5 parser regression gate | 3 (Step 1, block 2) |
| §4.1 delete `legacyVictim`, both-sides rule, counter rename | 5 |
| §4.2 correct #335's narrative | 5 (commit body), 6 (Step 6) |
| §5 churn attribution | 2 Step 9, 3 Step 5, 5 Step 8 |
| §6 items 1-4 (Pallas/Volk/Valkyrie, mirrors) | 2 Steps 1, 5; 3 Step 1 |
| §6 item 5 healing-calculator route | 4 (the `[healing.targetId]` deletion) |
| §6 item 6 plain `'ally'` over footprint | 4 Step 1 |
| §6 item 7 enemy no-victim turn | 5 Steps 1-2 |
| §6 item 8 buff-path containment | 1 Steps 6-9 |
| §6 item 9 parser inventory diff | 3 Step 1 |
| §6 item 10 counter contract | 5 Step 7 |
| §7 out of scope (Chimei, absolute basis) | 3 Step 1 asserts Chimei stays out |

**Ordering rationale:** Tasks 1 and 2 are inert by construction — the variant exists and has
routing arms before anything emits it — so the 186-site sweep is reviewable separately from any
behaviour change. The two churn points are isolated: Task 3 (heal routing, three named ships) and
Task 5 (the enemy turn path, spec §5's C1/C2). Task 2 Step 8 is the one non-inert step in an
otherwise inert task; it is flagged in place with its own full-suite run rather than deferred,
because the pool gate must be fixed before Task 3 routes Valkyrie off the anchor, or her repair
silently does nothing.

**Type consistency:** `lowestHpAllyId` returns `string | undefined` from Task 2 Step 3 onward and
is called that way in Tasks 2 and 4. The shared ranker is `pickLowestHpFractionAlly(ids, excludeId,
hpOf, maxHpOf): string | undefined` in `supportRecipients.ts`, introduced in Task 2 Step 7 and used
by site A, the engine's `lowestHpAllyIdFor` accessor and site C. `IntentExecContext.lowestHpAllyIdFor?:
(ownerId: string) => string | undefined` is introduced and consumed in Task 2. The counter is
`noVictimTurnCount` everywhere after Task 5 Step 5 — never the old `noVictimPlayerTurnCount`.
`'lowest-hp-ally'` is spelled identically in all tasks.
