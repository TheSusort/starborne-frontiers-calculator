# Voidfire Catalyst + bomb-splash-on-death Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Model the Voidfire Catalyst implant (both halves, all rarities) and add the missing base bomb-splash-on-death combat mechanic that its splash half rides on.

**Architecture:** Three stacked PRs under one spec. PR-1 adds a `detonationDamage` modifier channel (byte-identical) scaling existing detonation bursts. PR-2 adds base bomb-splash-on-death at the shared `recordDestroyed` death seam (the only golden-moving piece; positional-only). PR-3 adds a `bombSplashDamage` channel feeding PR-2's splash, lighting up all Voidfire rarities (byte-identical).

**Tech Stack:** React 18, TypeScript, Vite, Vitest. Combat engine in `src/utils/combat/`; ability/modifier infra in `src/utils/abilities/`.

**Spec:** `docs/superpowers/specs/2026-06-26-voidfire-catalyst-bomb-splash-design.md`

---

## Setup (before Phase 1)

- [ ] **S1: Create a worktree + branch** off `main` per superpowers:using-git-worktrees. Branch: `feat/combat-voidfire-detonation` (PR-1). Copy the gitignored `.env` from the main repo into the worktree (husky runs the full vitest suite on commit; without `.env` ~14 `.tsx` test files fail to collect — see project memory).
- [ ] **S2: Baseline** — run `npm test` and confirm green; run `npm run lint` (max-warnings 0) and `npx tsc --noEmit` clean. Record the test count.

**Workflow notes (from project memory):**
- Never run `vitest -u` to bulk-update goldens. In PR-2, validate each moved golden by hand.
- `gh auth switch --user TheSusort` before `gh pr create`.
- Commits run husky → full vitest suite; expect commits to take time.

---

# Phase 1 (PR-1): `detonationDamage` modifier channel

**Outcome:** A new modifier channel that scales detonation bursts (bomb/Inferno/Corrosion) on both the skill-triggered and timed paths. Voidfire's detonation half (common/uncommon/epic) lights up. Byte-identical goldens.

### Task 1.1: Add the `detonationDamage` modifier channel to the fold

**Files:**
- Modify: `src/types/abilities.ts:314-323` (ModifierChannel union)
- Modify: `src/utils/abilities/applyAbilities.ts:6-15` (ModifierTotals), `:27-36` (init), `:52-78` (switch)
- Modify: `src/utils/combat/effectiveStats.ts:143-155` (EffectiveDamageStats), `:203-216` (return)
- Test: `src/utils/abilities/__tests__/applyAbilities.test.ts` (or the nearest existing modifier-fold test)

- [ ] **Step 1: Write the failing test** — a `modifier` ability with `channel: 'detonationDamage', value: 8` produces `totals.detonationDamage === 8`.

```ts
it('folds a detonationDamage modifier into its own bucket', () => {
    const ability = mkModifierAbility({ channel: 'detonationDamage', value: 8 });
    const totals = modifierTotalsFromAbilities([ability], makeConditionContext());
    expect(totals.detonationDamage).toBe(8);
});
```
(Use the existing test's helpers — `mkModifierAbility`/`makeConditionContext` or equivalents already in the file.)

- [ ] **Step 2: Run test, verify it fails** — `npx vitest run src/utils/abilities/__tests__/applyAbilities.test.ts` → FAIL (`detonationDamage` not on `ModifierTotals`, channel not in union → tsc error).

- [ ] **Step 3: Implement**
  - `types/abilities.ts`: add `| 'detonationDamage'` to `ModifierChannel`.
  - `applyAbilities.ts`: add `detonationDamage: number;` to `ModifierTotals`; `detonationDamage: 0,` to the init object; `case 'detonationDamage': totals.detonationDamage += amount; break;` to the switch.
  - `effectiveStats.ts`: add `detonationDamageModifier: number;` to `EffectiveDamageStats`; in the return object add `detonationDamageModifier: mod.detonationDamage,` (parallel to `selfDotDamageModifier`).

- [ ] **Step 4: Run test, verify it passes.**

- [ ] **Step 5: Commit** — `feat(combat): add detonationDamage modifier channel`

### Task 1.2: Editor exhaustiveness stubs

**Files:**
- Modify: `src/components/skills/AbilityCard.tsx:82` (DAMAGE_STAT_OPTIONS list) and `:162` (the second channel list)
- Modify: `src/components/calculator/GameBuffPicker.tsx:29` (label map, e.g. `detonationDamage: 'Detonation'`)

- [ ] **Step 1:** Add `{ value: 'detonationDamage', label: 'Detonation Damage' }` to the AbilityCard option list at ~82, and `'detonationDamage',` to the list at ~162. Add `detonationDamage: 'Detonation',` to GameBuffPicker's label map.
- [ ] **Step 2:** Run `npx tsc --noEmit` and `npm test` — confirm no exhaustiveness/type errors and goldens unchanged.
- [ ] **Step 3: Commit** — `chore(skills): editor stubs for detonationDamage channel`

### Task 1.3: Snapshot the applier's detonation modifier onto `PendingBomb` + timed path

**Files:**
- Modify: `src/utils/combat/state.ts:56-66` (PendingBomb)
- Modify: `src/utils/combat/playerTurn.ts:587-627` (`applyNewDoTs` — add param + push field) and its call site (~`:1494`+, thread `dmgStats.detonationDamageModifier`)
- Modify: `src/utils/combat/triggers.ts:1557` (reactive bomb push — set the field, default 0)
- Modify: `src/utils/combat/engine.ts:695-710` (`processBombs` — scale burst)
- Test: `src/utils/combat/__tests__/` (a focused processBombs/timed-detonation test, or extend an existing bomb test)

- [ ] **Step 1: Write the failing test** — a timed bomb whose `PendingBomb.detonationDamageModifier = 100` bursts for 2× the unmodified value via `processBombs`.

- [ ] **Step 2: Run, verify fail** (field doesn't exist).

- [ ] **Step 3: Implement**
  - `state.ts`: add `detonationDamageModifier: number;` to `PendingBomb` (document: applier's, snapshotted at application, like `affinityMult`).
  - `applyNewDoTs`: add a **new** `detonationDamageModifier: number` field to its args object (it has no `dmgStats` today); set it on the pushed bomb. Thread the applier's value from the call site as `detonationDamageModifier: dmgStats.detonationDamageModifier` (the call site already has `dmgStats` in scope).
  - `triggers.ts:1557`: set `detonationDamageModifier: 0` on the reactive push (reactive bomb appliers don't carry a live dmgStats here — default 0; document this as a known approximation, mirroring how other reactive snapshots default).
  - `processBombs`: `burstDamage = bomb.stacks * bomb.damagePerStack * bomb.affinityMult * (1 + bomb.detonationDamageModifier / 100)`.
  - Update **all** `PendingBomb` literals in tests/fixtures to include `detonationDamageModifier: 0` (grep `pendingBombs: [` and bomb-object literals). tsc will enumerate them.

- [ ] **Step 4: Run test + full suite** — verify the new test passes and goldens are byte-identical (default 0 → mult 1).

- [ ] **Step 5: Commit** — `feat(combat): scale timed bomb detonation by applier's detonation modifier`

### Task 1.4: Apply the detonation modifier in skill-triggered `detonate()`

**Files:**
- Modify: `src/utils/combat/playerTurn.ts:526-582` (`detonate` — add `detonationMult` param, apply to all 3 branches) and its call site `:1486-1498` (pass `1 + dmgStats.detonationDamageModifier / 100`)
- Test: existing detonation test (e.g. `engine.events.test.ts` bomb-detonated, or a focused detonate test)

- [ ] **Step 1: Write the failing test** — a skill detonation with the detonating actor carrying `detonationDamageModifier = 50` produces 1.5× the bomb/inferno/corrosion payout.

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement** — add `detonationMult: number` to `detonate`'s args; multiply each branch's contribution (bomb `payout`, inferno sum, corrosion sum) by `args.detonationMult`. At the call site pass `detonationMult: 1 + dmgStats.detonationDamageModifier / 100`. Default modifier 0 → mult 1.

- [ ] **Step 4: Run test + full suite** — new test passes; goldens byte-identical.

- [ ] **Step 5: Commit** — `feat(combat): scale skill-triggered detonation by detonator's modifier`

### Task 1.5: Voidfire Catalyst registry entry (detonation half) + coverage

**Files:**
- Modify: `src/utils/abilities/buildEquipmentAbilities.ts` (add `VOIDFIRE_CATALYST` to `IMPLANT_ABILITIES` + per-rarity value table)
- Modify: `src/utils/abilities/__tests__/equipmentCoverage.test.ts` (3 spots: `.toEqual` decl-order array, the Set, the `it('exactly{}')` count string)
- Test: `src/utils/combat/__tests__/equipmentAbilities.integration.test.ts`

- [ ] **Step 1: Write the failing test** — through the **real registry** (`buildShipAbilitiesWithEquipment` with an implant whose `setBonus = 'VOIDFIRE_CATALYST'`, rarity `epic`), the ship gains a `modifier` ability with `channel: 'detonationDamage', value: 8`. (Also assert `common` → 2, `uncommon` → 4.)

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement** — add value tables:
```ts
const VOIDFIRE_DETONATION_PCT: Record<string, number | undefined> = {
    common: 2, uncommon: 4, rare: undefined, epic: 8, legendary: undefined,
};
const VOIDFIRE_SPLASH_PCT: Record<string, number> = {
    common: 4, uncommon: 8, rare: 24, epic: 16, legendary: 40,
}; // splash channel wired in Phase 3
```
  Add the builder (detonation ability only this phase; returns `undefined` when the detonation value is undefined — but note Phase 3 makes this return an array including the splash ability, so structure it to return an array now with just the detonation entry, or a single ability — keep it simple this phase, expand in 3.3):
```ts
VOIDFIRE_CATALYST: (rarity) => {
    const det = VOIDFIRE_DETONATION_PCT[rarity];
    if (det === undefined) return undefined; // rare/legendary have no detonation half (splash added in Phase 3)
    return {
        type: 'modifier', target: 'self', trigger: 'on-cast', conditions: [],
        config: { type: 'modifier', channel: 'detonationDamage', value: det, isMultiplicative: false },
        autoFilled: true,
    };
},
```
  Update `equipmentCoverage.test.ts`: add `VOIDFIRE_CATALYST` to the implemented-set `.toEqual` array (correct IMPLANTS decl-order position), the Set, and bump the `exactly{N}` count.

- [ ] **Step 4: Run tests** — integration + coverage pass; full suite byte-identical.

- [ ] **Step 5: Commit** — `feat(combat): Voidfire Catalyst detonation half`

### Task 1.6: Phase 1 verification + changelog + PR

- [ ] **Step 1:** Full suite green, `npm run lint`, `npx tsc --noEmit`, `npm run audit:skills` (expect 141/0 unchanged).
- [ ] **Step 2:** Add a plain-English `UNRELEASED_CHANGES` entry in `src/constants/changelog.ts` (e.g. "Voidfire Catalyst now increases detonation damage").
- [ ] **Step 3:** Update `src/pages/DocumentationPage.tsx` if it lists implant/combat mechanics.
- [ ] **Step 4: Commit** docs/changelog; open PR-1 (`gh auth switch --user TheSusort` first).

---

# Phase 2 (PR-2): base bomb-splash-on-death

**Outcome:** Any ship that dies with un-detonated bombs splashes 25/50/75% (by tier) of each bomb's raw burst to its living same-side adjacent allies, chaining recursively. Positional-only. **The one golden-moving phase** — validate each delta by hand.

Branch `feat/combat-bomb-splash-on-death` stacked on PR-1 (or off main if PR-1 merges first).

### Task 2.0: Verify the death seam (research — do first)

- [ ] **Step 1:** Confirm `applyVictimDamage`'s `recordDestroyed` `else` branch (`engine.ts:2895-2902`) is the **sole** real-death seam for positional sims (bySide unification claim). Grep for all `recordDestroyed` call sites; confirm there is no separate positional death path that bypasses `applyVictimDamage`. Document findings as a comment in the plan/PR. If a second death path exists, the splash hook must cover it too — surface before proceeding.

### Task 2.1: `splashPct` pure helper

**Files:**
- Create: `src/utils/combat/bombSplash.ts`
- Test: `src/utils/combat/__tests__/bombSplash.test.ts`

- [ ] **Step 1: Write failing tests** — `splashPctForTier(100) === 25`, `(200) === 50`, `(300) === 75` (i.e. `tier / 4`). Also a `splashDamageForBomb({bomb, allyCount?})`-style pure fn if it clarifies the math, returning the per-ally splash for one bomb: `stacks * damagePerStack * splashPct/100 * (1 + splashModifier/100)`.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** the pure helper(s) in `bombSplash.ts`. No affinity term.
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `feat(combat): bomb-splash damage helper`

### Task 2.2: `perActorSplash` surfacing plumbing

**Files:**
- Modify: `src/utils/combat/engine.ts` (declare `let perActorSplash = new Map<string, number>();` next to `perActorReflected` ~`:1910`; reset per round at the `perActorReflected` reset ~`:3490`; surface in the round-result fold ~`:5149`, the `Object.fromEntries`/spread that emits `perActorReflected`)
- Modify: `RoundData` type at `src/utils/calculators/dpsSimulator.ts:142` (where `perActorReflected?` is declared) — add `perActorSplash?` with the same shape, plumbed into the round result like `perActorReflected`.

- [ ] **Step 1:** Add the map + per-round reset + RoundData field, mirroring `perActorReflected` exactly. No StatCard.
- [ ] **Step 2:** `npm test` — byte-identical (nothing writes the map yet).
- [ ] **Step 3: Commit** — `feat(combat): plumb perActorSplash round surface`

### Task 2.3: Splash-on-death block at the death seam (core)

**Files:**
- Modify: `src/utils/combat/engine.ts:2895-2902` (immediately after the `recordDestroyed(victim, …)` call in the real-death `else` branch)
- Test: `src/utils/combat/__tests__/bombSplashOnDeath.integration.test.ts`

- [ ] **Step 1: Write the failing integration test** — a positional 2-team sim where an enemy carrying one Bomb (tier 200, known stacks/damagePerStack) is killed by a direct hit while a living same-side adjacent ally exists. Assert the adjacent ally takes `stacks * damagePerStack * 0.50` splash (full shield drain, no pen, no affinity), and the dead ship's `pendingBombs` is cleared. Use the positional fixture helpers from `positionalDamage.integration.test.ts`.

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement** the splash block. Gate: this call newly destroyed the victim (it's in the `else`/no-cheat-death branch) **and** `victim.pendingBombs.length > 0`. Then, capturing the bombs and clearing them first (to avoid re-entrancy double-fire):
```ts
// Bomb-splash-on-death: a ship that dies with un-detonated bombs splashes a
// tier-scaled fraction of each bomb's raw burst to its LIVING same-side adjacent
// allies (positional only — adjacentAllyIds returns [] without positions).
// No affinity (bombs/DoTs are not affinity-scaled). Bomb-like: full shield drain,
// no penetration. Credited to the bomb applier. Chains: a splash kill re-enters
// this branch for the new victim's bombs (finite — each ship dies once, bombs cleared).
const bombs = victim.pendingBombs;
if (bombs.length > 0) {
    victim.pendingBombs = []; // consume up-front → no double-fire on chain re-entry
    const allyIds = adjacentAllyIdsFor(victim.id); // living same-side neighbors
    for (const allyId of allyIds) {
        const ally = allActorsById.get(allyId);
        if (!ally || ally.destroyedRound !== undefined) continue;
        for (const bomb of bombs) {
            const splash = splashDamageForBomb(bomb); // stacks*dps*tier/4% *(1+splashMod/100)
            if (splash <= 0) continue;
            const splashSink = ally.side === 'player' ? playerSink : enemySink;
            applyVictimDamage(splash, ally, splashSink, {
                killerId: bomb.sourceId,
                byDirectDamage: true,
                bombPortion: splash,      // full bomb → full shield drain, no reflect
                shieldPenetrationPct: 0,
            });
            perActorSplash.set(ally.id, (perActorSplash.get(ally.id) ?? 0) + splash);
            roundPerTargetDamage.set(ally.id, (roundPerTargetDamage.get(ally.id) ?? 0) + splash);
        }
    }
}
```
  Resolve `adjacentAllyIdsFor` in this closure's scope (the side-aware helper `bySide(isEnemySide(victim.id) ? 'enemy' : 'player').adjacentAllyIdsFor` — confirm the in-scope binding; Reflect's block uses sibling closure-captured helpers). `splashDamageForBomb` is the Task-2.1 helper (reads `bomb.splashModifier`, default 0 until Phase 3).

- [ ] **Step 4: Run the new test** — passes.

- [ ] **Step 5: Run the FULL suite.** Expect some positional goldens to move. For each moved golden, hand-verify the delta equals the splash formula. **Do not** `vitest -u` blindly. Update only validated goldens.

- [ ] **Step 6: Commit** — `feat(combat): bomb-splash-on-death core mechanic`

### Task 2.4: Chaining test

- [ ] **Step 1:** Test: three same-side ships A,B,C adjacent in a line; A and B both carry bombs; killing A splashes B; if that kills B, B splashes C. Assert C takes B's splash (chain) and the whole thing terminates.
- [ ] **Step 2-4:** Run (should already pass from 2.3's recursion); if not, fix re-entrancy. Commit — `test(combat): bomb-splash chain reaction`.

### Task 2.5: Edge-case guards

- [ ] **Step 1:** Tests: (a) **non-positional** sim with a bombed death → no splash, byte-identical; (b) **cheat-death** survivor (the `if` branch) does **not** splash; (c) **dead applier** (sourceId actor already destroyed) → splash still fires and credits the applier; (d) **no living neighbor** → no splash, bombs still consumed.
- [ ] **Step 2-4:** Run, fix if needed, commit — `test(combat): bomb-splash edge cases`.

### Task 2.6: Phase 2 verification + changelog + PR

- [ ] Full suite green (with validated golden updates), lint, tsc, audit:skills. Changelog entry ("Bombs now splash to adjacent ships when the carrier dies before they detonate"). DocumentationPage update if relevant. Open PR-2.

---

# Phase 3 (PR-3): `bombSplashDamage` channel + Voidfire splash half

**Outcome:** Voidfire's splash% amplifies Phase-2 splash for all rarities (incl. rare/legendary). Byte-identical (no fixture equips Voidfire).

Branch `feat/combat-voidfire-splash` stacked on PR-2.

### Task 3.1: `bombSplashDamage` modifier channel

**Files:** same set as Task 1.1 + 1.2 (union, ModifierTotals, switch, EffectiveDamageStats field `bombSplashModifier`, editor stubs).

- [ ] **Step 1: Failing test** — modifier `channel: 'bombSplashDamage', value: 40` → `totals.bombSplashDamage === 40`.
- [ ] **Step 2: Run, fail.**
- [ ] **Step 3: Implement** — add `'bombSplashDamage'` to union; `bombSplashDamage` to ModifierTotals/init/switch; `bombSplashModifier: mod.bombSplashDamage` on EffectiveDamageStats; editor stubs (AbilityCard ×2, GameBuffPicker label).
- [ ] **Step 4: Run, pass; full suite byte-identical.**
- [ ] **Step 5: Commit** — `feat(combat): add bombSplashDamage modifier channel`

### Task 3.2: Snapshot applier's splash modifier onto `PendingBomb` + wire formula

**Files:**
- Modify: `state.ts` (`PendingBomb.splashModifier`)
- Modify: `playerTurn.ts` `applyNewDoTs` + call site (thread `dmgStats.bombSplashModifier`), `triggers.ts:1557` (default 0)
- Modify: `bombSplash.ts` — `splashDamageForBomb` already reads `bomb.splashModifier`; ensure it's wired (it was 0-defaulted in Phase 2)
- Update all `PendingBomb` literals to add `splashModifier: 0`.

- [ ] **Step 1: Failing test** — a bomb with `splashModifier: 50` splashes 1.5× the Phase-2 amount on death.
- [ ] **Step 2: Run, fail.**
- [ ] **Step 3: Implement** the field + snapshot threading.
- [ ] **Step 4: Run test + full suite** — new test passes; goldens byte-identical (default 0).
- [ ] **Step 5: Commit** — `feat(combat): snapshot applier bomb-splash modifier onto bombs`

### Task 3.3: Voidfire splash ability (registry array return) + coverage

**Files:** `buildEquipmentAbilities.ts` (expand `VOIDFIRE_CATALYST` to return an array), `equipmentCoverage.test.ts` (count already includes Voidfire from Phase 1; bump the per-builder ability count if asserted).

- [ ] **Step 1: Failing test** — through the real registry, `VOIDFIRE_CATALYST` epic yields **two** modifier abilities (`detonationDamage: 8` + `bombSplashDamage: 16`); rare yields **one** (`bombSplashDamage: 24`, no detonation); legendary → one (`bombSplashDamage: 40`).
- [ ] **Step 2: Run, fail.**
- [ ] **Step 3: Implement** — expand the builder to return an array (Warpstrike precedent), pushing the detonation modifier only when its value is defined, always pushing the splash modifier:
```ts
VOIDFIRE_CATALYST: (rarity) => {
    const det = VOIDFIRE_DETONATION_PCT[rarity];
    const splash = VOIDFIRE_SPLASH_PCT[rarity];
    if (splash === undefined && det === undefined) return undefined;
    const abilities: Omit<Ability, 'id'>[] = [];
    if (det !== undefined) abilities.push({ /* detonationDamage modifier as in 1.5 */ });
    if (splash !== undefined) abilities.push({
        type: 'modifier', target: 'self', trigger: 'on-cast', conditions: [],
        config: { type: 'modifier', channel: 'bombSplashDamage', value: splash, isMultiplicative: false },
        autoFilled: true,
    });
    return abilities;
},
```
  The consumer index-suffixes ids for array returns (Warpstrike precedent).
- [ ] **Step 4: Run tests** — integration + coverage pass; full suite byte-identical.
- [ ] **Step 5: Commit** — `feat(combat): Voidfire Catalyst splash half`

### Task 3.4: Phase 3 verification + changelog + PR

- [ ] Full suite green, lint, tsc, audit:skills. Add an integration test that a positional sim where a Voidfire-wearing applier's bomb kills its carrier produces amplified splash vs. an identical no-implant run. Changelog ("Voidfire Catalyst now also increases bomb splash damage"). DocumentationPage. Open PR-3.

---

## Definition of Done

- All three PRs open (stacked), each: full vitest suite green, `npm run lint` clean, `npx tsc --noEmit` clean, `npm run audit:skills` 141/0.
- PR-1 & PR-3 goldens byte-identical; PR-2 golden deltas each hand-validated against the splash formula.
- `equipmentCoverage.test.ts` lists `VOIDFIRE_CATALYST` as implemented.
- Changelog + DocumentationPage updated.
