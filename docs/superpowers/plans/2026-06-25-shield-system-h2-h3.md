# Shield System H2 + H3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Light up the dormant Shield gear set and three reactive shield implants (Adaptive Plating, Abundant Renewal, Resonating Fury) in the combat engine, shipped as one PR with H2 (gear set) and H3 (implants + a new `on-shield-applied` trigger) as ordered phases.

**Architecture:** All four are data-driven equipment abilities registered in `buildEquipmentAbilities.ts`, flowing through the existing reactive trigger machinery. A single foundation fix — routing reactive shield grants per-recipient via `recipientActor(rid)` instead of heal-target-only — enables every new source. Two new reactive bases (`damage-taken` via the on-attacked hit damage, `overheal` via a new `heal-performed.overheal` field) scale the implant shields off runtime amounts. A new `shield-applied` event + `on-shield-applied` trigger, emitted once per shield-application cast carrying the granter + recipient set, drives Resonating Fury.

**Tech Stack:** React 18, TypeScript, Vite, Vitest. Combat engine in `src/utils/combat/`, equipment-ability registry in `src/utils/abilities/`, ability/event types in `src/types/`.

---

## Pre-flight (read once, do not skip)

- **`.env` required for the full suite.** This repo's `.tsx` test files need the gitignored `.env`. If working in a worktree, `cp` the main repo's `.env` in first or ~14 test files fail to collect ("supabaseUrl is required"). The pre-commit (husky) hook runs the FULL vitest suite — a missing `.env` will fail the commit.
- **NEVER run `vitest -u`** (blanket golden update). H2/H3 are designed byte-identical; if a golden drifts, STOP and audit — do not rebaseline.
- **Goldens to watch after the Phase 0 foundation fix:** any battle-sim/healing golden exercising an existing reactive shield (FrontLine `on-enemy-charged-cast`, Defiant `on-stasis-applied`). Expected byte-identical (fixtures run owner==focus==healTarget). If one drifts, confirm the drift is a previously-dropped grant now landing on a non-focus owner (intended) before accepting; otherwise it's a bug.
- **Gates per task/PR:** `npm test` (full suite green), `npm run lint` (max-warnings 0), `tsc` (via build or editor), `npm run audit:skills` unchanged (141/0). 
- **Commits:** feature commits run the pre-commit hook (full vitest) — let it run. Use `gh auth switch --user TheSusort` before any `gh pr create`.
- **Subagents share the main working dir** on branch `feat/combat-shield-system`. Forbid `git checkout`/`git switch` in any dispatched subagent (a prior run left a detached HEAD).

## Reference: exact game data (already in the repo, do not re-derive)

- `src/constants/gearSets.ts:111` `SHIELD` = `{ name:'Shield', stats:[{name:'shield',value:4,type:'percentage'}], description:'Generate 4% shield each turn' }`.
- `src/constants/implants.ts`:
  - `ADAPTIVE_PLATING` (`:1089`, type `major`): "When directly damaged, X% chance to gain a Shield equal to Y% of the damage taken, limited to once per round." Rarities: `uncommon` 12%/.21, `epic` 16%/.34, `legendary` 19%/.42.
  - `ABUNDANT_RENEWAL` (`:37`, type `ultimate`): "Grants a shield equal to X% of the overrepaired amount on the target when overrepairing an ally." Rarities: `epic` 20%, `legendary` 30%. No proc (deterministic).
  - `RESONATING_FURY` (`:2556`, type `major`): "When applying a shield, X% chance to grant Crit Power Up 3 for 1 turn." Rarities: `common` 5%, `uncommon` 7%, `rare` 9%, `epic` 12%, `legendary` 16%.
- `'Crit Power Up 3'` is an existing named buff in `BUFFS` (used by Stealth crit implants) — `mkNamedBuffGrant` resolves it.

## Locked behavior (from the spec — do not relitigate)

- Resonating Fury: **one proc roll per shield-application cast**; on success Crit Power Up 3 (1 turn) goes to **every recipient that gained shield on that cast** (caster included if among them). NOT per-recipient, NOT carrier-only.
- `on-shield-applied` is emitted **once per cast** carrying `granterId` + `recipientIds` (only recipients with `actualGranted > 0`); if none gained shield, no event.
- Adaptive Plating: `on-attacked` (direct only — DoTs route through `dot-applied`, never `on-attacked`), `oncePerRound: true`.
- Abundant Renewal: `on-own-repair-to-ally`, ally overheals only, deterministic, shield to the over-repaired ally.
- Emission scope: `on-shield-applied` is emitted from the **cast path** (`playerTurn.ts`) and the **reactive executor** (`triggers.ts`) only — these cover all H2/H3 sources. The standing damage-leech shield sites (`engine.ts` 2337/2415/2475/4686) are **out of scope** for emission (document in-code; no H2/H3 source uses them, and they're per-recipient not per-cast).

---

## File Structure

**Modify:**
- `src/types/abilities.ts` — add `'on-shield-applied'` to `AbilityTrigger` + `LIVE_TRIGGERS`; add `'overheal'` to the `heal|shield` config `basis` union.
- `src/utils/combat/events.ts` — add `shield-applied` event variant; add `overheal?` to `heal-performed`.
- `src/utils/combat/playerTurn.ts` — accumulate `overheal` in the cast heal loop, attach to `heal-performed`; emit `shield-applied` once per cast in the shield loop.
- `src/utils/combat/triggers.ts` — Phase 0 per-recipient shield routing; `damage-taken` + `overheal` basis arms; stamp `triggerDamage` on `on-attacked`; thread `overheal` on `on-own-repair-to-ally`; emit `shield-applied` from the reactive shield branch; new `eventCtx.shieldRecipientIds`; new `on-shield-applied` listener; RF recipient routing in the buff executor.
- `src/utils/abilities/buildEquipmentAbilities.ts` — `SHIELD` gear set entry + `ADAPTIVE_PLATING`/`ABUNDANT_RENEWAL`/`RESONATING_FURY` implant entries + rarity tables.
- `src/utils/abilities/__tests__/equipmentCoverage.test.ts` — register the 4 new abilities in the coverage matrix.
- `src/constants/changelog.ts` — `UNRELEASED_CHANGES` entry.
- `src/pages/DocumentationPage.tsx` — note the new shield sources if a relevant section exists.

**Create (tests):**
- `src/utils/combat/__tests__/reactiveShieldRouting.test.ts` — Phase 0.
- Extend `src/utils/combat/__tests__/equipmentAbilities.integration.test.ts` — one integration test per new source.

---

## Phase 0 — Foundation: reactive shield per-recipient routing

This is the enabler for every new source. Today the reactive heal/shield executor only lands a pool when `rid === ctx.healing.targetId`.

### Task 0.1: Reactive shield grants land on any same-side recipient

**Files:**
- Modify: `src/utils/combat/triggers.ts:1614-1617`
- Test: `src/utils/combat/__tests__/reactiveShieldRouting.test.ts` (create)

- [ ] **Step 1: Write the failing test.** Build a battle-sim scenario (use the `simulateBattle` / `runCombat` + `createEventBus` harness from `equipmentAbilities.integration.test.ts`) with a focus ship A (the heal target) and an ally ship B, where B has a reactive shield ability targeting `self` that fires (e.g. a hand-built `start-of-turn` `{type:'shield', pct:10, basis:'hp'}` ability on B). Assert B's shield pool / `shieldGranted` becomes `0.10 × Bmaxhp` even though B is NOT the focus.

```ts
// reactiveShieldRouting.test.ts — sketch; adapt to the integration harness BASE()/makeShip
it('reactive self-shield lands a pool on a non-focus ally', () => {
    // ship B (ally, not focus) carries a start-of-turn self-shield ability
    // run simulateBattle with focus = A
    // expect B's currentShieldPool ≈ 0.10 * B.maxHp
});
```

- [ ] **Step 2: Run to verify it fails.** `npm test -- reactiveShieldRouting` → FAIL (B's pool stays 0; only the focus gets a pool).

- [ ] **Step 3: Implement.** Replace the heal-target-only guard with per-recipient routing mirroring the cast path (`playerTurn.ts:1907-1910`):

```ts
// triggers.ts ~1614-1617, the `else` (shield) branch of the heal/shield executor
} else {
    ctx.healing.credit(intent.ownerId, 'shield', raw);
    const recipientActor = ctx.healing.recipientActor(rid);
    if (recipientActor) ctx.healing.grantShieldToTarget(raw, recipientActor);
}
```

- [ ] **Step 4: Run the new test + the full suite.** `npm test -- reactiveShieldRouting` → PASS. Then `npm test` (full). Goldens MUST stay byte-identical. If any reactive-shield golden drifts, STOP and audit per Pre-flight before continuing.

- [ ] **Step 5: Commit.**
```bash
git add src/utils/combat/triggers.ts src/utils/combat/__tests__/reactiveShieldRouting.test.ts
git commit -m "feat(combat): route reactive shield grants per-recipient via recipientActor (H2/H3 foundation)"
```

---

## Phase H2 — Shield gear set

### Task H2.1: SHIELD gear-set ability entry

**Files:**
- Modify: `src/utils/abilities/buildEquipmentAbilities.ts` (the `GEAR_SET_ABILITIES` object, `:44-112`)
- Test: `src/utils/abilities/__tests__/equipmentCoverage.test.ts`

- [ ] **Step 1: Write the failing shape test** in `equipmentCoverage.test.ts`, modeled on the CLOAKING shape test (`:202-227`):

```ts
it('SHIELD produces a start-of-turn self shield of 4% caster max HP', () => {
    const minPieces = GEAR_SETS['SHIELD']?.minPieces ?? 2;
    const slots = ['weapon', 'hull', 'sensor', 'engine', 'shield', 'computer'] as const;
    const equipment: Record<string, string> = {};
    const pieceMap: Record<string, GearPiece> = {};
    for (let i = 0; i < minPieces; i++) {
        const id = `SHIELD-piece-${i}`;
        equipment[slots[i % slots.length]] = id;
        pieceMap[id] = makePiece({ id, slot: slots[i % slots.length], setBonus: 'SHIELD' });
    }
    const ship = makeShip({ equipment });
    const abilities = buildEquipmentAbilities(ship, (id) => pieceMap[id]);
    const sh = abilities.find((a) => a.id === 'equip-set-SHIELD');
    expect(sh).toBeDefined();
    expect(sh!.type).toBe('shield');
    expect(sh!.target).toBe('self');
    expect(sh!.trigger).toBe('start-of-turn');
    expect(sh!.config.type).toBe('shield');
    // @ts-expect-error shield config
    expect(sh!.config.pct).toBe(4);
    // @ts-expect-error shield config
    expect(sh!.config.basis).toBe('hp');
});
```
Also update the implemented-sets list (`:128`) and the `IMPLEMENTED_SETS` Set (`:179`) to include `'SHIELD'`.

- [ ] **Step 2: Run to verify it fails.** `npm test -- equipmentCoverage` → FAIL (no SHIELD entry).

- [ ] **Step 3: Implement the entry** in `GEAR_SET_ABILITIES` (hand-written literal, no shield helper exists; model on inline LEECH/HARDENED):

```ts
// Shield gear set: "Generate 4% shield each turn" → start-of-turn self shield of 4% caster max HP.
// start-of-turn is a LIVE trigger → partitions to the reactive path; lands via the Phase 0
// per-recipient routing fix.
SHIELD: () => ({
    type: 'shield',
    target: 'self',
    trigger: 'start-of-turn',
    conditions: [],
    config: { type: 'shield', pct: 4, basis: 'hp' },
    autoFilled: true,
}),
```

- [ ] **Step 4: Run to verify it passes.** `npm test -- equipmentCoverage` → PASS.

- [ ] **Step 5: Commit.**
```bash
git add src/utils/abilities/buildEquipmentAbilities.ts src/utils/abilities/__tests__/equipmentCoverage.test.ts
git commit -m "feat(combat): Shield gear set — start-of-turn 4% maxHP self shield (H2)"
```

### Task H2.2: Shield gear-set integration test (full build→engine path)

**Files:**
- Test: `src/utils/combat/__tests__/equipmentAbilities.integration.test.ts`

- [ ] **Step 1: Write the integration test.** Equip a ship with 2 SHIELD pieces, build via `buildShipAbilitiesWithEquipment`, run `simulateBattle` (focus = that ship so its `ShipRoundState` surfaces), assert `shieldGranted` / `currentShieldPool` ≈ `0.04 × maxHp` after its first turn. Model on the LEECH integration test (`:135-210`) for the build path and the H1 surfacing fields (`ShipRoundState.shieldGranted`, `currentShieldPool`).

- [ ] **Step 2: Run to verify it fails first if written before H2.1** (skip if H2.1 already merged) — otherwise run to confirm PASS.

- [ ] **Step 3: Run.** `npm test -- equipmentAbilities.integration` → PASS.

- [ ] **Step 4: Commit.**
```bash
git add src/utils/combat/__tests__/equipmentAbilities.integration.test.ts
git commit -m "test(combat): Shield gear set grants 4% maxHP pool via full build→sim path (H2)"
```

---

## Phase H3 — Reactive shield implants + on-shield-applied

### Task H3.1: `damage-taken` reactive basis (Adaptive Plating foundation)

**Files:**
- Modify: `src/utils/combat/triggers.ts` (on-attacked listener `:446-449`; basis ternary `:1561-1572`)
- Test: `src/utils/combat/__tests__/reactiveShieldRouting.test.ts` (extend) or a focused new test

- [ ] **Step 1: Write the failing test.** A ship with a hand-built `on-attacked` `{type:'shield', basis:'damage-taken', pct:50}` ability; when it takes a direct hit of D damage, assert its shield pool grows by `0.50 × D`.

- [ ] **Step 2: Run to verify it fails.** The basis falls through to `effectiveMaxHp` today → pool wrong/huge. → FAIL.

- [ ] **Step 3: Implement two edits.**
(a) Stamp the hit damage into eventCtx in the `on-attacked` listener (`triggers.ts:446-449`):
```ts
enqueue({
    ...intent,
    eventCtx: { counterTargetId: e.attackerId, didCrit: e.didCrit, triggerDamage: e.damage },
});
```
(b) Add a `damage-taken` arm to the `nonTargetHpBasis` ternary (`triggers.ts:1561-1572`) reading `eventCtx.triggerDamage` (same source the `damage-dealt` arm uses):
```ts
const nonTargetHpBasis =
    cfg.basis === 'attack'
        ? (ownerCtx?.effectiveAttack ?? owner.attack)
        : cfg.basis === 'defense'
          ? (ownerCtx?.effectiveDefence ?? owner.defence)
          : cfg.basis === 'damage-dealt' || cfg.basis === 'damage-taken'
            ? (intent.eventCtx?.triggerDamage ?? 0)
            : (ownerCtx?.effectiveMaxHp ?? owner.hp);
```

- [ ] **Step 4: Run the new test + full suite.** PASS; goldens byte-identical (no existing reactive shield uses `damage-taken`; the standing `damage-taken` leech path is untouched because reactive partitioning strips on-attacked abilities from `castSkills`).

- [ ] **Step 5: Commit.**
```bash
git add src/utils/combat/triggers.ts src/utils/combat/__tests__/reactiveShieldRouting.test.ts
git commit -m "feat(combat): reactive damage-taken shield basis via on-attacked hit damage (H3)"
```

### Task H3.2: Adaptive Plating implant entry + integration test

**Files:**
- Modify: `src/utils/abilities/buildEquipmentAbilities.ts` (`IMPLANT_ABILITIES`)
- Test: `equipmentCoverage.test.ts` + `equipmentAbilities.integration.test.ts`

- [ ] **Step 1: Write the failing coverage test** asserting the entry's shape (model on SECOND_WIND `:685-698` for an on-attacked reactive shield). Add `'ADAPTIVE_PLATING'` to the implemented-implants list (`:136-171`) and Set (`:269-304`).

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** the rarity tables + entry:
```ts
const ADAPTIVE_PLATING_PROC: Record<string, number> = { uncommon: 0.12, epic: 0.16, legendary: 0.19 };
const ADAPTIVE_PLATING_PCT: Record<string, number> = { uncommon: 21, epic: 34, legendary: 42 };
// ...
ADAPTIVE_PLATING: (rarity) => {
    const procChance = ADAPTIVE_PLATING_PROC[rarity];
    const pct = ADAPTIVE_PLATING_PCT[rarity];
    if (procChance === undefined || pct === undefined) return undefined;
    return {
        type: 'shield',
        target: 'self',
        trigger: 'on-attacked', // direct only — DoTs use dot-applied, never on-attacked
        conditions: [],
        procChance,
        oncePerRound: true,
        config: { type: 'shield', pct, basis: 'damage-taken' },
        autoFilled: true,
    };
},
```

- [ ] **Step 4: Run coverage → PASS.**

- [ ] **Step 5: Write integration test** — equip a legendary Adaptive Plating implant, run a sim where the ship takes a direct hit, force the proc (set proc to fire — see how existing reactive tests drive procChance, e.g. via a deterministic rate-gate at 1.0 or a high-probability fixture), assert shield pool ≈ `0.42 × damageTaken` and that it fires at most once per round. Model on the integration harness.

- [ ] **Step 6: Run full suite → PASS, goldens byte-identical.**

- [ ] **Step 7: Commit.**
```bash
git add src/utils/abilities/buildEquipmentAbilities.ts src/utils/abilities/__tests__/equipmentCoverage.test.ts src/utils/combat/__tests__/equipmentAbilities.integration.test.ts
git commit -m "feat(combat): Adaptive Plating — once-per-round shield on direct hit (H3)"
```

### Task H3.3: `overheal` basis + `heal-performed.overheal` plumbing (Abundant Renewal foundation)

**Files:**
- Modify: `src/types/abilities.ts:384` (basis union); `src/utils/combat/events.ts:98-105` (heal-performed); `src/utils/combat/playerTurn.ts` (cast heal loop `:1868-1890`, emit `:1936`); `src/utils/combat/triggers.ts` (on-own-repair-to-ally listener `:369-382`, basis ternary)
- Test: focused new test

- [ ] **Step 1: Write the failing test.** A ship with a hand-built `on-own-repair-to-ally` `{type:'shield', basis:'overheal', pct:50}` ability that heals an ally for more than its missing HP; assert the over-repaired ally's shield pool grows by `0.50 × overheal`.

- [ ] **Step 2: Run → FAIL** (`overheal` basis not in the type / not threaded).

- [ ] **Step 3: Implement, in order:**
(a) `abilities.ts:384` — add `'overheal'`:
```ts
basis: 'hp' | 'attack' | 'defense' | 'target-hp' | 'damage-dealt' | 'damage-taken' | 'overheal';
```
(b) `events.ts` `heal-performed` payload (`:98-105`) — add `overheal?: number`.
(c) `playerTurn.ts` cast heal loop (`:1868-1890`) — accumulate overheal:
```ts
let overhealSum = 0; // declare alongside healRawSum
// inside the rid === healing.targetId block, after computing { consumed, overheal }:
overhealSum += overheal;
```
and at the emit (`:1936`) attach `...(overhealSum > 0 ? { overheal: overhealSum } : {})`.
(d) `triggers.ts` on-own-repair-to-ally listener (`:369-382`) — thread it:
```ts
eventCtx: { ...intent.eventCtx, repairedAllyIds: repaired, triggerDamage: e.overheal ?? 0 },
```
Add a dedicated `overhealAmount?: number` to the eventCtx type (`triggers.ts:104-123`) — `damage-taken` and `overheal` never share an event, so reusing `triggerDamage` would be safe, but a dedicated field keeps the eventCtx self-documenting (preferred).
(e) `triggers.ts` basis ternary — add an `overheal` arm reading the same magnitude field as chosen in (d).

- [ ] **Step 4: Run the new test + full suite → PASS, goldens byte-identical** (no existing ability uses `overheal` basis; the new `heal-performed.overheal` field is additive and ignored by existing listeners).

- [ ] **Step 5: Commit.**
```bash
git add src/types/abilities.ts src/utils/combat/events.ts src/utils/combat/playerTurn.ts src/utils/combat/triggers.ts <test>
git commit -m "feat(combat): overheal shield basis + heal-performed.overheal field (H3)"
```

### Task H3.4: Abundant Renewal implant entry + integration test

**Files:** `buildEquipmentAbilities.ts`, `equipmentCoverage.test.ts`, `equipmentAbilities.integration.test.ts`

- [ ] **Step 1: Coverage test** (shape; model on FONT_OF_POWER `:812-818` for on-own-repair-to-ally). Add `'ABUNDANT_RENEWAL'` to the implant lists.

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement.** Target `ally` (reactive recipients fall back to the focus heal target = the over-repaired ally). Deterministic (no procChance):
```ts
const ABUNDANT_RENEWAL_PCT: Record<string, number> = { epic: 20, legendary: 30 };
// ...
ABUNDANT_RENEWAL: (rarity) => {
    const pct = ABUNDANT_RENEWAL_PCT[rarity];
    if (pct === undefined) return undefined;
    return {
        type: 'shield',
        target: 'ally',
        trigger: 'on-own-repair-to-ally',
        conditions: [],
        config: { type: 'shield', pct, basis: 'overheal' },
        autoFilled: true,
    };
},
```

- [ ] **Step 4: Coverage → PASS.**

- [ ] **Step 5: Integration test** — a healer with legendary Abundant Renewal overheals an ally; assert the ally's shield pool ≈ `0.30 × overheal`. Verify the over-repaired ally (heal target) is the recipient.

- [ ] **Step 6: Full suite → PASS, byte-identical. Commit.**
```bash
git commit -m "feat(combat): Abundant Renewal — overheal→shield to the over-repaired ally (H3)"
```

### Task H3.5: `shield-applied` event + `on-shield-applied` trigger (definitions)

**Files:** `src/types/abilities.ts` (AbilityTrigger + LIVE_TRIGGERS), `src/utils/combat/events.ts`

- [ ] **Step 1: Write a failing test** asserting `'on-shield-applied'` is in `LIVE_TRIGGERS` and that a `shield-applied` event can be emitted/consumed via `createEventBus`.

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement.**
(a) `abilities.ts` — add `'on-shield-applied'` to the `AbilityTrigger` union (with a doc comment: "fired once per shield-application cast; reaction keyed on the granter, targets the shield recipients — Resonating Fury") AND to `LIVE_TRIGGERS`.
(b) `events.ts` — add the variant (model on `heal-performed` `:98-105`):
```ts
| {
      type: 'shield-applied';
      granterId: string;
      recipientIds: string[]; // only recipients with actualGranted > 0
      round: number;
      amount: number; // total shield actually granted this cast
  }
```

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Commit.**
```bash
git commit -m "feat(combat): add shield-applied event + on-shield-applied trigger (H3)"
```

### Task H3.6: Emit `shield-applied` once per cast (cast path + reactive executor)

**Files:** `src/utils/combat/playerTurn.ts` (shield loop `:1891-1911`), `src/utils/combat/triggers.ts` (reactive shield branch, after the recipient loop)

- [ ] **Step 1: Write the failing test.** Two scenarios via `createEventBus` + `bus.on('shield-applied', …)`:
  1. A cast shield to self + one ally emits ONE `shield-applied` with both recipientIds (those that gained shield) and the granter.
  2. The Shield gear set (`start-of-turn`, reactive) emits ONE `shield-applied` with `[ownerId]`.
Assert exactly one event per cast and that fully-capped (0-grant) recipients are excluded.

- [ ] **Step 2: Run → FAIL** (no emission yet).

- [ ] **Step 3: Implement.** In each grant loop, track recipients whose `grantShieldToTarget` produced `actualGranted > 0`. `grantShieldToTarget` doesn't return the delta today — either (a) have it return `actualGranted`, or (b) read the pool before/after at the call site. Prefer (a): change the closure signature to `grantShieldToTarget: (raw, victim?) => number` returning `actualGranted` (update the `HealingRuntimeCtx` interface at `playerTurn.ts:116` and the impl at `engine.ts:2062-2079`; all existing callers ignore the return — non-breaking). Then:
  - Cast path (`playerTurn.ts:1891-1911`): collect `{rid, granted}` per recipient; after the loop, if any `granted > 0`, `bus.emit({ type:'shield-applied', granterId: actor.id, recipientIds: granted>0 ones, round: r, amount: sum })`.
  - Reactive executor (`triggers.ts`, shield branch): same — after the recipient loop, emit one `shield-applied` keyed on `intent.ownerId`. Add a clear comment: this is intentional (unlike heal-performed which is deliberately NOT re-emitted) — `shield-applied` drives Resonating Fury (a buff, not a shield → terminates, no chain). 
  - Document in-code at the `engine.ts` standing-leech shield sites that they are intentionally NOT emitting `shield-applied` (out of H3 scope; per-recipient, no H2/H3 source uses them).

- [ ] **Step 4: Run new test + full suite → PASS, byte-identical** (emission is additive; no existing listener consumes `shield-applied`).

- [ ] **Step 5: Commit.**
```bash
git commit -m "feat(combat): emit shield-applied once per cast (cast path + reactive executor) (H3)"
```

### Task H3.7: `on-shield-applied` listener + RF recipient routing

**Files:** `src/utils/combat/triggers.ts` (eventCtx type `:104-123`; `registerReactiveListeners` `:232-633`; buff-executor recipient resolution)

- [ ] **Step 1: Write the failing test.** A ship with a hand-built `on-shield-applied` buff ability (Crit Power Up 3, target the shield recipients) that, when it grants a shield to an ally, applies Crit Power Up 3 to that ally (and to all recipients of a multi-recipient cast on a single proc). Use `bus.on('buff-applied', …)` to assert recipients.

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement.**
(a) Add `shieldRecipientIds?: string[]` to the `eventCtx` type (`:104-123`).
(b) Add an `on-shield-applied` case in `registerReactiveListeners` keyed on the granter (model on `on-own-repair-to-ally` `:369-382`):
```ts
case 'on-shield-applied':
    bus.on('shield-applied', (e) => {
        if (e.granterId !== ownerId) return;
        if (e.recipientIds.length === 0) return;
        enqueue({ ...intent, eventCtx: { ...intent.eventCtx, shieldRecipientIds: e.recipientIds } });
    });
    break;
```
(c) Route the buff executor's recipients to `eventCtx.shieldRecipientIds` when present. Find where the buff branch resolves recipients (mirrors how `on-own-repair-to-ally` buffs use `repairedAllyIds`, and `reactiveRecipients` consumes eventCtx). Add `shieldRecipientIds` as the recipient source for an `on-shield-applied` reaction (a "shield-recipient" resolution). The proc roll (`passesProcChanceGate`) happens ONCE per enqueued intent = once per cast → correct single-roll-per-cast semantics.

- [ ] **Step 4: Run new test + full suite → PASS, byte-identical.**

- [ ] **Step 5: Commit.**
```bash
git commit -m "feat(combat): on-shield-applied listener — reaction targets shield recipients (H3)"
```

### Task H3.8: Resonating Fury implant entry + integration test (incl. reactive→reactive hop)

**Files:** `buildEquipmentAbilities.ts`, `equipmentCoverage.test.ts`, `equipmentAbilities.integration.test.ts`

- [ ] **Step 1: Coverage test** (shape; `mkNamedBuffGrant('Crit Power Up 3', target, 'on-shield-applied', 1, { procChance })`). Add `'RESONATING_FURY'` to the implant lists. The `target` for the buff must resolve to the shield recipients via the H3.7 routing — confirm the chosen `AbilityTarget` (likely `'ally'` or a dedicated value) maps to `shieldRecipientIds`.

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement:**
```ts
const RESONATING_FURY_PROC: Record<string, number> = {
    common: 0.05, uncommon: 0.07, rare: 0.09, epic: 0.12, legendary: 0.16,
};
// ...
RESONATING_FURY: (rarity) => {
    const procChance = RESONATING_FURY_PROC[rarity];
    if (procChance === undefined) return undefined;
    return mkNamedBuffGrant('Crit Power Up 3', /* recipient-routed target */, 'on-shield-applied', 1, { procChance });
},
```
(If `mkNamedBuffGrant`'s target union doesn't include a recipient-routed value, either extend it or hand-write the buff Ability literal — match the H3.7 recipient resolution.)

- [ ] **Step 4: Coverage → PASS.**

- [ ] **Step 5: Integration tests** (force the proc deterministically):
  1. A ship with Resonating Fury that shields an ally → that ally gets Crit Power Up 3.
  2. **Reactive→reactive hop:** a ship with BOTH Adaptive Plating + Resonating Fury takes a direct hit → Adaptive Plating self-shield fires → `shield-applied` → Resonating Fury grants Crit Power Up 3 to self. Assert the buff lands (proves the single safe hop terminates). If the intent queue does NOT drain intents enqueued mid-drain, this test surfaces it — if so, fix by ensuring the drain loop processes newly-enqueued intents (verify the `enqueue`/drain mechanism in `triggers.ts`).
  3. Gear set + Resonating Fury: start-of-turn self shield → Crit Power Up 3 on self.

- [ ] **Step 6: Full suite → PASS, byte-identical. Commit.**
```bash
git commit -m "feat(combat): Resonating Fury — Crit Power Up 3 to shield recipients on shield-applied (H3)"
```

---

## Phase F — Finalize

### Task F.1: Changelog + docs

- [ ] Add an `UNRELEASED_CHANGES` entry to `src/constants/changelog.ts` (plain English): Shield gear set and the three reactive shield implants now function in the battle simulator. 
- [ ] If `DocumentationPage.tsx` has a combat/gear-set/implant section, note the new working sources.
- [ ] Commit: `git commit -m "docs(combat): changelog + docs for Shield gear set and reactive shield implants (H2/H3)"` (this is user-facing; do NOT `--no-verify` unless docs-only with no code — changelog.ts is code, let the hook run).

### Task F.2: Full verification gate

- [ ] `npm test` — full suite green (note pass count vs baseline 3281+; new tests add to it).
- [ ] `npm run lint` — 0 warnings.
- [ ] `tsc` clean (build or editor diagnostics).
- [ ] `npm run audit:skills` — unchanged (141/0).
- [ ] Confirm goldens byte-identical across the whole PR (NO `vitest -u`). If anything drifted, it must be explained and accepted (only the Phase 0 reactive-shield routing could plausibly drift, and only if a fixture ran a reactive shield on a non-focus owner — audit and document).

### Task F.3: PR

- [ ] `gh auth switch --user TheSusort`
- [ ] Push `feat/combat-shield-system`, open the PR summarizing H2 + H3, link the spec, and note: byte-identical goldens, the Phase 0 enabler, and the documented out-of-scope items (standing-leech shield sites don't emit `shield-applied`; dynamic shieldPenetration buff-folding remains out of scope from H1).

---

## Risks & open verification points (resolve during execution, not by guessing)

1. **Intent queue drains mid-drain enqueues** (Task H3.8 hop). Verified during plan review: `drainQueue` (`engine.ts:~3447-3457`) is a multi-generation `while (queue.length > 0)` loop re-snapshotting via `splice` each pass, so a `shield-applied` emitted mid-drain gets its `on-shield-applied` intent processed in the next generation within the same drain. The hop terminates (RF emits a buff, not a shield). The H3.8 #2 integration test remains the guard — keep it.
2. **`mkNamedBuffGrant` target union** may not include a recipient-routed target for RF — extend or hand-write (Task H3.8).
3. **`grantShieldToTarget` return value** — adding a return is non-breaking (callers ignore it), but verify no caller destructures/spreads its result (Task H3.6).
4. **Golden drift from Phase 0** — expected none; audit if any (Pre-flight).
5. **Adaptive Plating slot** — confirm equipment implants land where `on-attacked` reactive partitioning picks them up (passive slot per Leech precedent); the integration test confirms end-to-end.
