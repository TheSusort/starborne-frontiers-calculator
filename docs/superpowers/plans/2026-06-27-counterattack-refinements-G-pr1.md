# Sub-project G — PR1 (foundation + Stalwart) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Model the player-side reactive counterattack as a full mitigated/crit damage walk against the attacker, auto-parsed from skill text, gated on "primary target" — lighting up **Stalwart** (P1 30%, P2 70%).

**Architecture:** A new reactive `counter` AbilityConfig + a `counter` branch in the reactive executor (`triggers.ts`) that calls a new engine helper `applyCounterAttack`. The helper rolls the owner's crit, computes raw damage via the pure `victimHitDamage`, and applies it through the EXISTING Reflect no-event apply path (`applyVictimDamage`, which drains shield→HP, runs death handling, emits no `attacked` event → no ping-pong). A new `isPrimaryTarget` flag on the `attacked` event + a new per-turn once-per-attack guard complete the contract.

**Tech Stack:** React 18, TypeScript, Vitest. Combat engine in `src/utils/combat/`, parser in `src/utils/skillTextParser.ts` + `src/utils/abilities/buildShipAbilities.ts`.

**Spec:** `docs/superpowers/specs/2026-06-27-counterattack-refinements-G-design.md`

**Branch:** `feat/combat-g-counterattack-refinements` (already created; spec committed).

**Invariant for EVERY task:** production must stay **byte-identical** (no combat fixture equips Stalwart — verified: the name appears only in `constants/ships.ts`, parser unit tests, and `recruitmentCalculator.ts`). After each task run `npx tsc --noEmit` AND `npm run lint` (max-warnings 0) — vitest/esbuild does NOT typecheck, so never trust a "tsc clean" claim without running it. Goldens (`.snap`) must not move; never run `vitest -u`.

---

## Key code landmarks (verified 2026-06-27)

- `AbilityConfig` union: `src/types/abilities.ts:328` (the `damage` variant is line 329).
- `Ability` interface: `src/types/abilities.ts:519` — already has top-level `procChance?` (555), `oncePerRound?` (541), `triggerCritFilter?`, `requireIncomingDamageFracOfMaxHp?`.
- `victimHitDamage(s, v, didCrit, roleScale, equipReductionPct=0)`: pure — `src/utils/combat/victimDamage.ts:74`. `AttackerDamageScalars` (line 33) / `VictimDefenseProfile` (line 54).
- `applyVictimDamage(amount, victim, sink, cause)`: per-round closure, `src/utils/combat/engine.ts:~2782–3112`. Returns `{shieldBefore, hpDamage, barriered}`. The reflect re-entry guard is at `engine.ts:3020` (`!cause?.isReflected`). The reflect call site (the template) is `engine.ts:3087`.
- Reflect's affinity/defence/incoming-reduction resolution: `engine.ts:3051–3082` (uses `effectiveStatsOf(statusEngine, selfBuffLookup, actor).defence`, `computeAffinityModifiers`, `incomingReductionForHit`).
- The SOLE `attacked` emit: `src/utils/combat/engine.ts:4970–4981` (enemy-turn body; `targetId: tgt.id`, `attackerId: actor.id`).
- `on-attacked` listener: `src/utils/combat/triggers.ts:464–490` (routes `counterTargetId`, `didCrit`, `triggerDamage` into `eventCtx`).
- Reactive `damage` executor branch (bomb-like, Grif): `src/utils/combat/triggers.ts:1763–1783`.
- `IntentExecContext` per-round build (where `creditReactiveDamage` is set): `src/utils/combat/engine.ts:~3791`.
- Parse template: `parseHealAbilities` (`src/utils/skillTextParser.ts:2166`) consumed at `src/utils/abilities/buildShipAbilities.ts:946`; the `damageReaction` annotation → `on-attacked`/`on-ally-attacked` mapping is at `buildShipAbilities.ts:968`. `detectDamageReactionTrigger` already recognizes "when directly damaged".
- `eventCtx` type (reactive intent): `src/utils/combat/triggers.ts:~96–116`.

---

## File structure

- **Modify** `src/types/abilities.ts` — new `counter` AbilityConfig variant; `eventCtx`/event type fields if declared here.
- **Modify** `src/utils/combat/events.ts` — `isPrimaryTarget?: boolean` on the `attacked` event.
- **Modify** `src/utils/combat/engine.ts` — `applyCounterAttack` helper + `IntentExecContext` wiring + set `isPrimaryTarget` at the emit + `counterFiredThisTurn` Set + per-turn clear + `isCounter` cause flag on the reflect guard.
- **Modify** `src/utils/combat/triggers.ts` — `counter` executor branch + `applyCounterAttack`/`counterFiredThisTurn` on `IntentExecContext` interface + `isPrimaryTarget` passthrough in the `on-attacked` listener + `eventCtx.isPrimaryTarget`.
- **Modify** `src/utils/skillTextParser.ts` — `parseCounterAbilities` (new) modeled on `parseHealAbilities`.
- **Modify** `src/utils/abilities/buildShipAbilities.ts` — consume `parseCounterAbilities`, build `counter` abilities on `on-attacked`.
- **Modify** editor exhaustiveness sites IF tsc forces: `src/components/skills/AbilityCard.tsx`, `AbilityTypePicker.tsx`, `src/components/skills/abilityDefaults.ts` (add stubs only).
- **Modify** `src/constants/changelog.ts`, `src/pages/DocumentationPage.tsx` — final task.
- **Tests:** `src/utils/combat/__tests__/counterAttack.test.ts` (new, executor/helper unit), `src/utils/combat/__tests__/counterAttack.integration.test.ts` (new, runCombat), parser test in `src/utils/abilities/__tests__/` or `src/utils/__tests__/skillTextParser` area.

---

## Task 0: Baseline

- [ ] **Step 1: Confirm branch + clean baseline**

Run:
```bash
cd /Users/kennethsusort/PersonalProjects/starborne-frontiers-calculator
git branch --show-current   # expect feat/combat-g-counterattack-refinements
git status --short          # expect clean
npx vitest run src/utils/combat/__tests__/reflect 2>&1 | tail -5
```
Expected: branch correct, working tree clean, reflect tests pass (sanity that the apply path we reuse is healthy).

---

## Task 1: `counter` AbilityConfig variant + editor stubs

**Files:**
- Modify: `src/types/abilities.ts:328` (union)
- Modify (only if tsc errors): `src/components/skills/AbilityCard.tsx`, `src/components/skills/AbilityTypePicker.tsx`, `src/components/skills/abilityDefaults.ts`

- [ ] **Step 1: Add the union variant**

In `src/types/abilities.ts`, add `'counter'` to the `AbilityType` union (after `'damage'`, line 7 area) AND a config variant immediately after the `damage` config (line 329):

```ts
    | {
          type: 'counter';
          /** raw percentage of the OWNER's effective attack, e.g. 30/70/100/200. */
          multiplier: number;
          hits?: number;
          /** Stalwart: fire only when this unit was the directly-targeted (primary) victim,
           *  not a splash/covered AoE victim. Gated on `attacked.isPrimaryTarget`. */
          requirePrimaryTarget?: boolean;
          /** Nyxen (PR2): fire only when the hit reduced the shield pool. Plumbed in PR2. */
          requireShieldHit?: boolean;
      }
```

- [ ] **Step 2: Build to find exhaustiveness sites**

Run: `npx tsc --noEmit 2>&1 | head -30`
Expected: errors at any `switch (ability.type)` / `Record<AbilityType, …>` that must enumerate `'counter'` (likely `AbilityCard.tsx`, `AbilityTypePicker.tsx`, `abilityDefaults.ts`, possibly `simCoverage.ts`). Note each.

- [ ] **Step 3: Add minimal stubs**

For each tsc error, add a minimal entry mirroring the `'damage'` case. Expected sites (verified): `src/components/skills/abilityDefaults.ts` `makeDefaultConfig` switch (~line 7) + `DEFAULT_TARGETS: Record<AbilityType, AbilityTarget>` (~line 91, use `'enemy'`); `AbilityTypePicker.tsx` `TYPE_LABELS: Record<AbilityType, string>` (~line 10, label "Counterattack"); `AbilityCard.tsx` (~line 248) reuse the damage rendering or a one-line summary. **No `simCoverage.ts` edit is needed** — `NOT_SIMULATED_TYPES = {'control'}` (simCoverage.ts:17) and `PASSIVE_NOOP_TYPES` both correctly exclude `counter` (it IS simulated); do NOT add `counter` to either. Keep stubs minimal — the editor is not the focus.

- [ ] **Step 4: Verify clean**

Run: `npx tsc --noEmit && npm run lint`
Expected: both clean.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(combat): counter AbilityConfig variant + editor stubs (G PR1)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `isPrimaryTarget` signal + `on-attacked` passthrough + `isCounter` cause flag

This task adds the signals only (no executor yet) — all byte-identical.

**Files:**
- Modify: `src/utils/combat/events.ts` (~line 199, `attacked` event)
- Modify: `src/utils/combat/engine.ts` (emit ~4970; cause type + reflect guard ~3020)
- Modify: `src/utils/combat/triggers.ts` (eventCtx type ~96; `on-attacked` listener ~482)

- [ ] **Step 1: Add `isPrimaryTarget?` to the `attacked` event**

`src/utils/combat/events.ts`, in the `attacked` event object (after `damage?`, line ~209):
```ts
          /** G PR1: true when the victim was the directly-targeted (primary) target of the
           *  attack, false/absent for splash/covered AoE victims. Today the sole emit is the
           *  focus victim (`tgt`) → always true; positional per-victim emission (future) sets
           *  false for covered cells. Stalwart's counter gates on this. */
          isPrimaryTarget?: boolean;
```

- [ ] **Step 2: Set it at the emit**

`src/utils/combat/engine.ts:4970–4981`, add to the emitted object:
```ts
                                    isPrimaryTarget: true,
```
(The sole emit is for `tgt`, the focus/primary victim — see spec "Enemy-side scope" / I5. A comment should note this is the primary victim today; covered-cell emission, when added, passes the real role.)

- [ ] **Step 3: Pass it through the `on-attacked` listener into eventCtx**

`src/utils/combat/triggers.ts:482–489`, add `isPrimaryTarget: e.isPrimaryTarget` to the enqueued `eventCtx`. Add `isPrimaryTarget?: boolean` to the `eventCtx` type (~line 96–116, near `counterTargetId`).

- [ ] **Step 4: Add `isCounter?` cause flag (for no-re-reflect / no-re-counter intent)**

The `cause` param type is an INLINE object literal on `applyVictimDamage` at
**engine.ts:~2701–2711** (a near-duplicate exists on `applyIncomingToTarget` ~3143–3148;
only the `applyVictimDamage` one is load-bearing for the counter apply path). Add
`isCounter?: boolean` to the `applyVictimDamage` cause literal (2701–2711). Update the
reflect re-entry guard at **engine.ts:3020** from `if (!cause?.isReflected && …)` to
`if (!cause?.isReflected && !cause?.isCounter && …)` so a counter application is NOT
itself reflected (loop-safe; documented in spec rule 2). Add a one-line comment.

- [ ] **Step 5: Verify byte-identical**

Run: `npx tsc --noEmit && npm run lint && npx vitest run 2>&1 | tail -8`
Expected: tsc/lint clean; full suite green; ZERO `.snap` changes (`git status --short` shows no `.snap`).

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(combat): attacked.isPrimaryTarget signal + isCounter cause flag (G PR1)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: `applyCounterAttack` engine helper + IntentExecContext wiring

The helper rolls the owner's crit, computes raw via `victimHitDamage`, applies via `applyVictimDamage` with `isCounter:true`. Modeled on the reflect block (`engine.ts:3051–3093`).

**Files:**
- Modify: `src/utils/combat/engine.ts` (helper near the reflect block / where `applyVictimDamage` is in scope; ctx wiring ~3791)
- Modify: `src/utils/combat/triggers.ts` (`IntentExecContext` interface: add `applyCounterAttack`)
- Test: `src/utils/combat/__tests__/counterAttack.test.ts` (engine testtap)

- [ ] **Step 1: Declare the ctx method on the interface**

`src/utils/combat/triggers.ts`, in `IntentExecContext` (near `creditReactiveDamage?`, ~782):
```ts
    /** G PR1: apply a full mitigated/crit counter walk from `ownerId` to `attackerId`.
     *  `abilityId` keys the dedicated counter crit-gate. Reuses the engine's no-event
     *  apply path (no attacked event → no re-counter). */
    applyCounterAttack?: (
        ownerId: string,
        attackerId: string,
        abilityId: string,
        multiplier: number,
        hits: number
    ) => void;
```

- [ ] **Step 2: (No test committed in this task — see note)**

The helper's magnitude is only observable once the executor calls it (Task 4). To avoid
committing a RED test, the end-to-end magnitude test (`counterAttack.test.ts`) is written
in **Task 4** alongside the executor. This task adds the helper + ctx wiring only and
verifies via tsc/lint. (If you prefer a Task-3 test, expose an engine `__testTap` that
invokes `applyCounterAttack` directly and assert magnitude against `victimHitDamage` — but
the default is to defer the test to Task 4.)

- [ ] **Step 3: Implement `applyCounterAttack`**

Inside the per-round scope where `applyVictimDamage`, `statusEngine`, `selfBuffLookup`, `allActorsById`, `effectiveStatsOf`, `playerSink`/`enemySink`, and the crit rate-gate are available (same scope as the reflect block), add:

```ts
const applyCounterAttack = (
    ownerId: string,
    attackerId: string,
    abilityId: string,
    multiplier: number,
    hits: number
): void => {
    const owner = allActorsById.get(ownerId);
    const attacker = allActorsById.get(attackerId);
    // Guards (spec rule 6): owner alive, attacker alive, not self.
    if (!owner || !attacker) return;
    if (owner.destroyedRound !== undefined) return;
    if (attacker.destroyedRound !== undefined || attacker.id === owner.id) return;

    const ownerStats = effectiveStatsOf(statusEngine, selfBuffLookup, owner);
    const attackerStats = effectiveStatsOf(statusEngine, selfBuffLookup, attacker);

    // Roll the OWNER's crit (spec rule 4) via a NEW dedicated combat-scoped gate map
    // (Task 3a) — NOT any existing per-actor crit gate (reusing one would corrupt that
    // actor's crit schedule and could move goldens even without Stalwart). A dedicated
    // map only ever creates keys for counter-carriers → no key, no draw, no perturbation
    // for every existing fixture → byte-identical.
    const didCrit = rollRateGate(
        counterCritGates,
        `${ownerId}:${abilityId}`, // one crit stream per counter ability per owner
        ownerStats.crit / 100
    );

    const raw = victimHitDamage(
        {
            effectiveAttack: ownerStats.attack,
            multiplierPct: multiplier * hits,
            secondaryStatValue: 0,
            hits,
            effectiveCritDamage: ownerStats.critDamage,
            outgoingDamageBuffPct: 0,
            incomingDamageModifierPct: 0,
            // effectiveStatsOf.defensePenetration is BASE-only (the buff folds via a
            // separate channel) — acceptable: no Stalwart fixture, and counters ignoring
            // pen-buffs is a documented approximation. Field exists on EffectiveStats.
            defensePenetrationPct: ownerStats.defensePenetration,
            attackerAffinity: owner.affinity,
        },
        {
            defence: attackerStats.defence,
            defenceModifierPct: 0,
            affinity: attacker.affinity,
        },
        didCrit,
        1 // roleScale: a counter is a single full hit
    );
    if (raw <= 0) return;

    const sink = attacker.side === 'player' ? playerSink : enemySink;
    applyVictimDamage(raw, attacker, sink, {
        killerId: owner.id,
        byDirectDamage: true,
        isCounter: true,
        // Mirror Reflect (engine.ts:3091): no shield penetration on the reactive hit.
        // (EffectiveStats has NO shieldPenetration field; shield-pen lives on
        // actor.stats.shieldPenetration via attackerShieldPenOf — deliberately not used.)
        shieldPenetrationPct: 0,
        bombPortion: 0,
    });
    // Surface on the attacker's incoming so it appears on the HP curve (mirror reflect
    // engine.ts:3094–3106): perActor + roundPerTargetDamage.
    roundPerTargetDamage.set(
        attacker.id,
        (roundPerTargetDamage.get(attacker.id) ?? 0) + raw
    );
};
```

- [ ] **Step 3a: Wire the owner crit roll via a NEW dedicated gate map**

Do NOT reuse any existing per-actor crit gate — those are per-actor-runtime fields
(`owner.activeCritGate(rate)` / `rt.activeHealCritGate(...)`, e.g. engine.ts:2352/2422/
2497/4939) and reusing one corrupts that actor's crit schedule (golden movement risk
even without Stalwart). Instead:
1. `rollRateGate` and `makeRateGate` are ALREADY imported in `engine.ts:12`
   (`import { makeRateGate, rollRateGate } from '../calculators/rateAccumulator';`) — no new
   import needed. Signature `rollRateGate(gates, key, chance)` (`calculators/rateAccumulator.ts:31`)
   — the same deterministic accumulator the D-PR proc gates use.
2. Declare a NEW combat-scoped map next to the other gate maps (e.g. beside
   `procChanceGates`, engine.ts:~1997): `const counterCritGates = new Map<string, RateGate>();`
   (use the `RateGate` alias to match `procChanceGates`' style).
3. Key it `${ownerId}:${abilityId}` (NOT `${ownerId}:${attackerId}` — one crit stream per
   counter ability per owner; update the helper's key accordingly, threading the ability id
   into `applyCounterAttack` if needed, or roll the gate in the executor and pass `didCrit`
   in). A dedicated map creates keys ONLY for counter-carriers → no draw for any existing
   fixture → byte-identical.

Document the chosen stream in a comment.

- [ ] **Step 4: Expose on the per-round ctx**

`src/utils/combat/engine.ts:~3791`, in the IntentExecContext object literal next to `creditReactiveDamage`, add `applyCounterAttack,`.

- [ ] **Step 5: Verify clean (no behavior change yet)**

The helper exists but nothing calls it yet → byte-identical. Run:

Run: `npx tsc --noEmit && npm run lint && npx vitest run 2>&1 | tail -6`
Expected: clean; full suite green; ZERO `.snap` movement (helper is unreferenced).

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(combat): applyCounterAttack engine helper (full walk via reflect apply path) (G PR1)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: `counter` executor branch + per-turn once-per-attack guard

**Files:**
- Modify: `src/utils/combat/triggers.ts` (executor, near the `damage` branch ~1763)
- Modify: `src/utils/combat/engine.ts` (`counterFiredThisTurn` Set + per-turn clear + ctx field)
- Test: `src/utils/combat/__tests__/counterAttack.test.ts` (once-per-attack + primary gate)

- [ ] **Step 1: Add the per-turn guard infra (engine)**

In `engine.ts` at combat scope (near `hitThisRound`), declare:
```ts
// G PR1: once-per-attack guard. Cleared at every actor turn-start so all per-hit
// `attacked` events of ONE attack collapse to a single counter, while a separate
// later attack (a different turn) counters again. NOT per-round (a per-round set
// would wrongly suppress a second attack in the same round).
const counterFiredThisTurn = new Set<string>();
```
Clear it (`counterFiredThisTurn.clear();`) once per actor turn at the TOP of the per-actor turn-order loop. The single boundary is the `turn-started` emit at **engine.ts:~4061** (loop `for (let actor = selectNext(); ...)` at ~4003; clear right after `actingActorId = actor.id` ~4059, before the action branches and before the post-turn drain). Two dead-actor `continue`s precede it (~4012, ~4044) — harmless, a skipped dead actor doesn't attack. (NOT line 3562 — that's unrelated `targetHpPctStart`.) Expose on the per-round ctx (next to `applyCounterAttack`):
```ts
counterFiredThisTurn,
```
and declare `counterFiredThisTurn?: Set<string>;` on `IntentExecContext` (triggers.ts).

- [ ] **Step 2: Write the failing executor tests**

In `counterAttack.test.ts` add: (a) **magnitude** (moved from Task 3) — a player counter-carrier hit by an enemy → attacker takes mitigated counter damage matching `victimHitDamage` (owner attack × mult/100 vs attacker defence/affinity); (b) a 3-hit attack on a counter-carrier → exactly ONE counter (assert attacker incoming == one counter's worth); (c) `requirePrimaryTarget:true` + an `attacked` with `isPrimaryTarget:false` → NO counter; with `true` → counter; (d) no-re-counter: attacker also carries a counter → only the first fires.

Run: `npx vitest run src/utils/combat/__tests__/counterAttack.test.ts -v`
Expected: FAIL.

- [ ] **Step 3: Implement the `counter` executor branch**

In `triggers.ts`, BEFORE or beside the `if (cfg.type === 'damage')` branch (1763), add:
```ts
if (cfg.type === 'counter') {
    if (!passesProcChanceGate(intent, ctx)) return;
    if (!passesOncePerRoundGate(intent, ctx)) return;
    // Primary-target gate (Stalwart).
    if (cfg.requirePrimaryTarget && intent.eventCtx?.isPrimaryTarget !== true) return;
    // Shield-hit gate (Nyxen) — PR2 plumbs eventCtx.shieldWasHit; default-skip when required.
    if (cfg.requireShieldHit && intent.eventCtx?.shieldWasHit !== true) return;
    const attackerId = intent.eventCtx?.counterTargetId;
    if (!attackerId) return;
    // Once-per-attack guard (cleared per turn in the engine).
    const key = `${intent.ownerId}:${intent.ability.id}`;
    if (ctx.counterFiredThisTurn?.has(key)) return;
    ctx.counterFiredThisTurn?.add(key);
    ctx.applyCounterAttack?.(intent.ownerId, attackerId, intent.ability.id, cfg.multiplier, cfg.hits ?? 1);
    return;
}
```
(Confirm `passesOncePerRoundGate` consumes only when it returns true — mirror the `damage` branch ordering so the guard interplay is clean.)

- [ ] **Step 4: Run tests green**

Run: `npx vitest run src/utils/combat/__tests__/counterAttack.test.ts -v`
Expected: PASS (magnitude from Task 3 + once-per-attack + primary gate + no-re-counter).

- [ ] **Step 5: Full suite byte-identical**

Run: `npx tsc --noEmit && npm run lint && npx vitest run 2>&1 | tail -8`
Expected: clean, green, ZERO `.snap` movement.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(combat): counter executor branch + per-turn once-per-attack guard (G PR1)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Parser — `parseCounterAbilities` → Stalwart parses a counter

**Files:**
- Modify: `src/utils/skillTextParser.ts` (new `parseCounterAbilities`, modeled on `parseHealAbilities:2166`)
- Modify: `src/utils/abilities/buildShipAbilities.ts` (consume it, ~near the heal loop 946)
- Test: parser test (mirror an existing `skillTextParser`/`buildShipAbilities` test file)

- [ ] **Step 1: Write the failing parser test**

Assert `buildShipAbilities` for Stalwart yields a passive `counter` ability with `multiplier: 30` (P1) / `70` (P2), `trigger: 'on-attacked'`, `requirePrimaryTarget: true`, AND that Stalwart's co-located `Legion Discipline II` buff still parses (M1 non-regression). Use the real CSV-derived skill text (copy the verbatim string from `docs/ship-skills.csv`).

Run it → FAIL.

- [ ] **Step 2: Implement `parseCounterAbilities`**

In `skillTextParser.ts`, add a function that scans a passive clause for the counter shapes (anchor on the consequence, NOT requiring the literal word "damage" — Centurion ends "retaliates dealing 50%."):
- `it deals <X>% damage to that enemy` (Stalwart) → `{ multiplier: X, primaryTarget: <"as a primary target" present>, ... }`
- `This Unit deals <X>% damage when its Shield is directly damaged` (Nyxen) → `{ multiplier: X, shieldHit: true }` (parsed now; gate wired in PR2)
- `this Unit retaliates dealing <X>%` (Centurion) → `{ multiplier: X, allySubject: <"or an adjacent ally" present> }` (parsed now; ally routing in PR2)

Guard against heal/shield/reflect false positives (the consequence must be a counter, not "repairs"/"gains Shield"/"reflects"). Return a typed list (mirror `ParsedHealAbility`'s `damageReaction` annotation shape).

- [ ] **Step 3: Consume in `buildShipAbilities`**

Near the heal loop (`buildShipAbilities.ts:946`), add a loop over `parseCounterAbilities(text)` that pushes a `counter` ability on `on-attacked` (PR1) with `requirePrimaryTarget` from the annotation. Use the same anchor-position convention for editor order. Leave `requireShieldHit`/`on-ally-attacked` routing for PR2 (parse the data now, but for PR1 only Stalwart's on-attacked primary-target counter must go live; Nyxen/Centurion counter abilities may be built but remain effectively dormant until PR2 wires their gates/triggers — OR scope `buildShipAbilities` to emit only the Stalwart shape in PR1 and add Nyxen/Centurion emission in PR2. Choose the latter if it keeps PR1 's blast radius smaller).

- [ ] **Step 4: Tests green + audit**

Run:
```bash
npx vitest run <parser test> -v
npm run audit:skills 2>&1 | tail -3   # expect 141 ships, 0 findings
```
Expected: parser test passes; audit still 141/0.

- [ ] **Step 5: Full suite byte-identical**

Run: `npx tsc --noEmit && npm run lint && npx vitest run 2>&1 | tail -8`
Expected: clean, green, ZERO `.snap` (Stalwart not in any fixture).

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(combat): parse counterattack passives → Stalwart on-attacked counter (G PR1)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Integration test + changelog + docs

**Files:**
- Test: `src/utils/combat/__tests__/counterAttack.integration.test.ts`
- Modify: `src/constants/changelog.ts` (`UNRELEASED_CHANGES`)
- Modify: `src/pages/DocumentationPage.tsx` (combat-sim coverage prose)

- [ ] **Step 1: Write the integration test**

Via real `buildShipAbilities` (Stalwart) → `runCombat` / `simulateBattle`, player-side Stalwart hit by an enemy as the primary target retaliates for a mitigated amount (and can contribute to a kill); assert the attacker's `perTargetDamage`/HP reflects the counter. Confirm the co-located Legion Discipline II still applies. (No enemy-side mirror — spec I4.)

Run: `npx vitest run src/utils/combat/__tests__/counterAttack.integration.test.ts -v`
Expected: PASS.

- [ ] **Step 2: Changelog**

Add to `UNRELEASED_CHANGES` in `src/constants/changelog.ts`:
> "Combat simulator now models counterattacks: a ship with a 'when directly damaged' passive (e.g. Stalwart) strikes back at the attacker for a share of its own attack — full damage that can crit and kill."

- [ ] **Step 3: Docs**

Update the combat-sim coverage prose in `src/pages/DocumentationPage.tsx` to mention counterattacks (player-side).

- [ ] **Step 4: Final verification**

Run: `npx tsc --noEmit && npm run lint && npx vitest run 2>&1 | tail -8 && npm run audit:skills 2>&1 | tail -3`
Expected: all clean/green, audit 141/0, ZERO `.snap` movement.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(combat): counterattack integration test + changelog + docs (G PR1)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Done criteria (PR1)

- Stalwart (P1/P2) parses a `counter` ability on `on-attacked` with `requirePrimaryTarget`.
- A player-side counter is a full mitigated/crit walk against the attacker (can kill), fires once per attack, does not re-counter, and is gated on primary-target.
- Co-located Stalwart buff (Legion Discipline II) unchanged.
- `npx tsc --noEmit`, `npm run lint`, full `npx vitest run`, `npm run audit:skills` (141/0) all clean; ZERO `.snap` movement (production byte-identical).
- PR2 will add Nyxen (`shieldWasHit`) + Centurion (`on-ally-attacked` + adjacency), reusing this foundation.
