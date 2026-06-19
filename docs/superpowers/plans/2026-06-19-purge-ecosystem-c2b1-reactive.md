# C2b-1 — Reactive Purge Ecosystem Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make purge fire the reactive ecosystem — emit a `purge-performed` event from every purge, wire the `on-enemy-purged` (Sefuba: self-heal + "purge 1 more" chain) and `on-ally-purged` (Salvation: heal the purged ally) reactors, with an emit-all + depth-1 chain guard, and extract the shared `reactiveRecipients` helper.

**Architecture:** Mirror C1's reactive *cleanse* work. Add a `purge-performed` event carrying `targetId` (the victim, so `on-ally-purged` can route a heal to the purged ally). The reactive purge EXECUTOR replaces the not-simulated skip and calls `ctx.statusEngine.purge(...)` directly (no delegate — cleanse does the same). Reactor *heals* ride the existing reactive heal branch via new position-scoped trigger detectors; Sefuba's chain *purge* is emitted from its passive slot via a dedicated "purges N more" detector. The depth-1 guard tags reaction intents with `eventCtx.fromPurgeEvent` so a purge triggered by a purge does not re-emit.

**Tech Stack:** TypeScript, Vitest. Combat engine under `src/utils/combat/`; types `src/types/`; parser `src/utils/skillTextParser.ts`; ability build `src/utils/abilities/buildShipAbilities.ts`.

**Spec:** `docs/superpowers/specs/2026-06-19-purge-ecosystem-c2b-design.md` (§4 = C2b-1). Prior shipped: C1 (cleanse), C2a (on-cast purge core).

## Scope (C2b-1 vs C2b-2/C2b-3)

**In scope (C2b-1):** `purge-performed` event; emit it from the C2a on-cast purge; the reactive purge executor; `on-enemy-purged` + `on-ally-purged` triggers + their parser detectors; Sefuba self-heal + "purge 1 more" chain; Salvation heal-the-ally; the depth-1 chain guard; the `reactiveRecipients` helper extraction. Reactors covered: **Sefuba** (p1 heal-only / p2 heal+chain) and **Salvation** (p3).

**DEFERRED (NOT this plan):**
- **C2b-2:** generic passive-source purges (Iridium `on-attacked`, Faust `on-destroyed`+killer-threading, Rhodium `end-of-round`+`enemy-most-buffs`), and the general passive-slot purge emit for those triggers.
- **C2b-3:** Nayra `target-repaired-this-round` condition.
- Lodolite p3 shield-removal-on-purge (→ H); Amartya multi-victim AoE (→ E).

## Key decisions

- **Emit-all + depth-1 guard (spec §2.4/§4.2):** EVERY purge emits `purge-performed`, EXCEPT a purge whose triggering intent carries `eventCtx.fromPurgeEvent`. The `on-enemy-purged`/`on-ally-purged` listeners set that flag when enqueueing, so only Sefuba's chained "purge 1 more" is silenced → bounded at depth 1. On-cast purges (C2a) and (later) on-attacked/on-destroyed/end-of-round purges are NOT flagged → they emit and trigger reactors.
- **`targetId` on the event:** required (unlike `cleanse-performed`) — Salvation's `on-ally-purged` is VICTIM-scoped (`isSameSideAlly(targetId, ownerId)`) and routes the heal to that ally via `eventCtx.damagedAllyId`.
- **No `ctx.purge` delegate:** the reactive purge executor calls `ctx.statusEngine.purge(targetId, count)` directly, exactly as the reactive cleanse branch calls `ctx.statusEngine.cleanse` (`triggers.ts:1133`). `statusEngine` is in `IntentExecContext` scope.
- **Reactor *heals* ride the existing reactive heal branch:** add `detectEnemyPurgedTrigger` / `detectAllyPurgedTrigger` (position-scoped, mirror `detectDestroyedTrigger`) into the heal `reactiveTrigger` chain (`buildShipAbilities.ts:937-958`). Sefuba's self-heal → `on-enemy-purged`; Salvation's "repairs that ally" → `on-ally-purged` (target `ally` via the existing heal-target flip).
- **Sefuba chain purge — narrow emit:** emit the "purge 1 more" purge ONLY via a dedicated `/purges?\s+(\d+|an?|all)\s+more\b/i` ("purges N more") detection attached to `on-enemy-purged`, NOT the generic `parsePurge` double-match (C2a pinned Sefuba-p2 as a 2-element `parsePurge` result; the generic passive-slot emit is C2b-2). This emits exactly ONE chain purge for Sefuba p2 and ZERO for p1.
- **Golden gate:** DPS byte-identical (no purge reactors, dummy has no buffs, purge no-op). Healing + two-team sim = AUDITED churn where Sefuba/Salvation now heal or a chain purge removes a real buff. `audit:skills` 0/141 (no purge rule — trivially stable; still run). Never blind `vitest -u`.

**Test-runner gotcha:** bare `npm test`/`npm test --` = Vitest WATCH (hangs). Use `npx vitest run <file>`.
**Gate every task:** `npm run lint` (0), `npx tsc --noEmit` (clean — run INDEPENDENTLY; esbuild/vitest does NOT typecheck), `npm run audit:skills` (0/141).
**Auth/commit:** docs are gitignored → `git add -f` for spec/plan/changelog-doc files; commit `--no-verify`.

## File structure

- **Modify** `src/utils/combat/events.ts` — add `purge-performed` event.
- **Modify** `src/types/abilities.ts` — add `on-enemy-purged` + `on-ally-purged` to `AbilityTrigger` union + `LIVE_TRIGGERS`.
- **Modify** `src/utils/combat/triggers.ts` — `reactiveRecipients` helper; `eventCtx.fromPurgeEvent` field; register the 2 triggers; reactive purge executor branch.
- **Modify** `src/utils/combat/playerTurn.ts` — emit `purge-performed` from the on-cast purge (capture removed count).
- **Modify** `src/utils/skillTextParser.ts` — `detectEnemyPurgedTrigger` / `detectAllyPurgedTrigger` (position-scoped) + a `parsePurgeMore` (or inline "purges N more") detector.
- **Modify** `src/utils/abilities/buildShipAbilities.ts` — wire the heal trigger chain; emit Sefuba chain purge.
- **Test (new):** `src/utils/combat/__tests__/purgeReactive.test.ts` (executor + chain guard); extend `skillTextParser.test.ts`; an integration test (Salvation/Sefuba two-team).
- **Changelog** `src/constants/changelog.ts`.

---

## Task 0: Baseline

- [ ] Run `npx vitest run` → all green (record count, ~2571). `npm run lint` (0), `npx tsc --noEmit` (clean), `npm run audit:skills` (0/141). If not green, STOP/report.
- [ ] Inventory: `grep -rln "purge-performed\|on-enemy-purged\|on-ally-purged\|reactiveRecipients" src/` → expect NONE (all new). Confirm `git status` clean on `feat/combat-sim-phase5-pr2`.

---

## Task 1: `purge-performed` event + trigger keys (types, unwired)

**Files:** Modify `src/utils/combat/events.ts`, `src/types/abilities.ts`.

- [ ] **Step 1:** In `events.ts`, add after the `cleanse-performed` member (`:107`):
```typescript
    /** A purge resolved. `casterId` = the purging actor; `targetId` = the VICTIM whose
     *  buffs were removed (REQUIRED — `on-ally-purged` is victim-scoped, unlike the
     *  caster-scoped `on-enemy-cleansed`); `count` = the number actually removed.
     *  Suppressed when 0 removed and when the triggering intent carried
     *  `eventCtx.fromPurgeEvent` (depth-1 chain guard — a purge triggered by a purge
     *  does not re-emit). `on-enemy-purged` filters `casterId === ownerId`;
     *  `on-ally-purged` filters `isSameSideAlly(targetId, ownerId)`. */
    | { type: 'purge-performed'; casterId: string; targetId: string; count: number; round: number }
```
- [ ] **Step 2:** In `src/types/abilities.ts`, add `'on-enemy-purged'` and `'on-ally-purged'` to the `AbilityTrigger` union (next to `on-enemy-cleansed`, `:58`) and to the `LIVE_TRIGGERS` set (`:68-87`), with a one-line comment ("Purge ecosystem C2b: Sefuba self-purge / Salvation ally-purged").
- [ ] **Step 3: tsc + byte-identical gate.** `npx tsc --noEmit` (clean — a new event variant + 2 trigger strings are additive; confirm no exhaustive `switch` over `AbilityTrigger`/event-type now errors. If a `switch` errors, add a no-op/`default` case and report). `npx vitest run` → green, ZERO snapshot movement. `npm run lint`/`audit:skills`.
- [ ] **Step 4: Commit.**
```bash
git add src/utils/combat/events.ts src/types/abilities.ts
git commit --no-verify -m "C2b-1 T1: purge-performed event + on-enemy/ally-purged trigger keys (types)"
```

---

## Task 2: Extract `reactiveRecipients(intent, ctx)` (pure refactor, byte-identical)

**Files:** Modify `src/utils/combat/triggers.ts`; Test `src/utils/combat/__tests__/purgeReactive.test.ts` (create).

The recipient resolver is duplicated in the reactive heal branch (`~:1070`) and reactive cleanse branch (`~:1126`). Both compute: `ally → [eventCtx.damagedAllyId ?? <healTargetId>]`, `all-allies → ctx.playerIds`, else `[ownerId]`. **One subtlety:** the heal branch falls back to `healing.targetId`, the cleanse branch to `ctx.healing.targetId` — same value (`healing` is `ctx.healing`). The helper takes the fallback target id as a param to stay byte-identical.

- [ ] **Step 1: Write the failing unit test.** In `purgeReactive.test.ts`, import `reactiveRecipients` (not yet exported) and assert: `target:'ally'` + `eventCtx.damagedAllyId:'a2'` → `['a2']`; `target:'ally'` + no damagedAllyId → `[fallbackTargetId]`; `target:'all-allies'` → `ctx.playerIds`; `target:'self'`/other → `[ownerId]`. Run → FAIL (not exported).
- [ ] **Step 2: Implement + export** `reactiveRecipients(intent, ctx, fallbackTargetId)` in `triggers.ts` near the executor:
```typescript
export function reactiveRecipients(
    intent: ReactiveIntent,
    ctx: IntentExecContext,
    fallbackTargetId: string
): string[] {
    return intent.ability.target === 'ally'
        ? [intent.eventCtx?.damagedAllyId ?? fallbackTargetId]
        : intent.ability.target === 'all-allies'
          ? ctx.playerIds
          : [intent.ownerId];
}
```
(Confirm the exact intent type name — `ReactiveIntent` or similar — from the executor signature.)
- [ ] **Step 3: Replace both call sites.** Heal branch (`~:1070`): `const recipients = reactiveRecipients(intent, ctx, healing.targetId);`. Cleanse branch (`~:1126`): `const recipients = reactiveRecipients(intent, ctx, ctx.healing.targetId);`. Keep the surrounding comments. Verify NO behavior change (same expressions).
- [ ] **Step 4:** `npx vitest run` (full) → green, **ZERO snapshot movement** (pure refactor). `npx tsc --noEmit`, `npm run lint`, `npm run audit:skills`.
- [ ] **Step 5: Commit.**
```bash
git add src/utils/combat/triggers.ts src/utils/combat/__tests__/purgeReactive.test.ts
git commit --no-verify -m "C2b-1 T2: extract reactiveRecipients helper (byte-identical)"
```

---

## Task 3: Reactive purge executor + depth-guard field + trigger registration

**Files:** Modify `src/utils/combat/triggers.ts`; Test `src/utils/combat/__tests__/purgeReactive.test.ts`.

This wires the consuming side (executor + listeners). No ship emits these triggers yet (Task 6) and the on-cast purge doesn't emit the event yet (Task 5), so production stays byte-identical; the new behavior is exercised by unit tests that drive intents directly.

- [ ] **Step 1: Add the depth-guard field.** Extend the `eventCtx` type on the intent (`triggers.ts:92`, currently `{ counterTargetId?: string; damagedAllyId?: string }`) with `fromPurgeEvent?: boolean`. Document it ("depth-1 purge chain guard — a purge triggered by a purge-performed event does not re-emit").
- [ ] **Step 2: Write failing executor tests** in `purgeReactive.test.ts`. Build a minimal `IntentExecContext` stub (mirror an existing triggers test — find one that constructs `ctx` for `executeIntent`/`drainQueue`) with a fake `statusEngine.purge` spy returning a fixed count and a `bus.emit` spy. Assert, for a `{type:'purge', count:1}` intent:
  - (a) target resolves to `eventCtx.counterTargetId` when set, else `ctx.enemyId`; `statusEngine.purge` called with `(target, 1)`.
  - (b) emits `purge-performed` `{casterId: ownerId, targetId: target, count: <removed>, round}` when removed > 0 and `eventCtx.fromPurgeEvent` is unset.
  - (c) does NOT emit when `eventCtx.fromPurgeEvent === true` (depth guard) — removal still happens.
  - (d) does NOT emit when removed === 0.
  Run → FAIL (skip branch).
- [ ] **Step 3: Implement the executor branch.** Replace the `// Any other type (purge/control/...) → skip` tail (`~:1174`) — insert a `cfg.type === 'purge'` branch BEFORE it:
```typescript
    if (cfg.type === 'purge') {
        // Reactive purge (C2b): remove buffs from the victim. Target = the routed
        // attacker/killer (counterTargetId, set by on-attacked/on-destroyed in C2b-2)
        // else the turn's enemy. statusEngine is in ctx scope — call it directly (no
        // delegate; mirrors the reactive cleanse branch). Emit purge-performed UNLESS
        // this purge was itself triggered by a purge (depth-1 chain guard).
        const targetId = intent.eventCtx?.counterTargetId ?? ctx.enemyId;
        const removed = ctx.statusEngine.purge(targetId, cfg.count);
        if (removed > 0 && !intent.eventCtx?.fromPurgeEvent) {
            ctx.bus.emit({
                type: 'purge-performed',
                casterId: intent.ownerId,
                targetId,
                count: removed,
                round: ctx.round,
            });
        }
        return;
    }
```
(`ctx.bus: CombatEventBus` exists on `IntentExecContext` — `triggers.ts:6` — and `ctx.bus.emit(...)` is already used in the executor at `~:915/945/961/1014`. No structural change needed.)
- [ ] **Step 4: Register the two triggers** in `registerReactiveTrigger` (the `bus.on` switch, after the `on-enemy-cleansed` case `~:378`):
```typescript
                case 'on-enemy-purged':
                    bus.on('purge-performed', (e) => {
                        // Self-scoped on the caster: THIS owner purged an enemy (Sefuba).
                        // Enqueue with fromPurgeEvent so the reaction's own purge (Sefuba's
                        // "purge 1 more") does NOT re-emit → depth-1 guard.
                        if (e.casterId === ownerId)
                            enqueue({ ...intent, eventCtx: { ...intent.eventCtx, fromPurgeEvent: true } });
                    });
                    break;
                case 'on-ally-purged':
                    bus.on('purge-performed', (e) => {
                        // Victim-scoped: a buff was purged from MY ally (Salvation). Route the
                        // heal to that ally via damagedAllyId; fromPurgeEvent guards any chained purge.
                        if (isSameSideAlly(e.targetId, ownerId))
                            enqueue({
                                ...intent,
                                eventCtx: { ...intent.eventCtx, damagedAllyId: e.targetId, fromPurgeEvent: true },
                            });
                    });
                    break;
```
(CONFIRM `isSameSideAlly` is in scope here — it is defined `~:213`; if it's not in this closure's scope, hoist or pass it as the other side-scope helpers are.)
- [ ] **Step 5:** Run `purgeReactive.test.ts` → PASS. Add a registration-level test if the harness supports it (enqueue on `purge-performed` for matching/non-matching caster/victim) — optional if the executor tests + Task 7 integration cover it.
- [ ] **Step 6: Byte-identical gate.** `npx vitest run` (full) → green + new tests, ZERO snapshot movement (no emitter yet). `npx tsc --noEmit`, `npm run lint`, `npm run audit:skills`.
- [ ] **Step 7: Commit.**
```bash
git add src/utils/combat/triggers.ts src/utils/combat/__tests__/purgeReactive.test.ts
git commit --no-verify -m "C2b-1 T3: reactive purge executor + depth-guard + on-enemy/ally-purged registration (unwired)"
```

---

## Task 4: Emit `purge-performed` from the on-cast purge

**Files:** Modify `src/utils/combat/playerTurn.ts`; Test: extend an existing two-team/healing harness OR the integration test in Task 7 (a unit assertion here if feasible).

The C2a on-cast purge (`playerTurn.ts:1382-1390`) discards the removed count. Capture it and emit `purge-performed` (this is the cast purge that TRIGGERS Sefuba/Salvation). `bus` and `r` are in scope (the cleanse-performed emit at `~:1626` uses both).

- [ ] **Step 1: Write/extend a failing test.** In a two-team sim where a player active/charged purge removes a real enemy buff, assert a `purge-performed` event is emitted with `{casterId: <actor>, targetId, count: <removed>}`. (Reuse the C2a integration harness — `healTargetId` must be set to unlock the enemy roster.) Run → FAIL (no emit).
- [ ] **Step 2: Implement.** Change the on-cast purge loop:
```typescript
    if (targetId !== undefined) {
        for (const ab of gatedSkill?.abilities ?? []) {
            if (ab.config.type === 'purge' && ab.trigger === 'on-cast') {
                const removed = statusEngine.purge(targetId, ab.config.count);
                // Emit purge-performed (C2b-1) — on-cast purges are never depth-guarded,
                // so they ALWAYS emit (when something was removed), triggering Sefuba/
                // Salvation. Suppressed at 0 removed (honest metric; mirrors cleanse-performed).
                if (removed > 0) {
                    bus.emit({
                        type: 'purge-performed',
                        casterId: actor.id,
                        targetId,
                        count: removed,
                        round: r,
                    });
                }
            }
        }
    }
```
Update the C2a comment that said "No purge-performed event (deferred to C2b)".
- [ ] **Step 3:** Run the test → PASS.
- [ ] **Step 4: AUDITED gate.** `npx vitest run`. DPS byte-identical (dummy has no buffs → removed 0 → no emit). Two-team/healing goldens: a NEW `purge-performed` event appears in the event log of any fixture where a purge removed a real buff — audit each (the event is additive; confirm no reactor exists in those fixtures yet, so only the event-log line changes, not downstream damage). Justify each delta; never blind `-u`. `npx tsc --noEmit`, `npm run lint`, `npm run audit:skills`.
- [ ] **Step 5: Commit** with the per-fixture justification in the body.
```bash
git add src/utils/combat/playerTurn.ts <test/snap files>
git commit --no-verify -m "C2b-1 T4: emit purge-performed from on-cast purge; audited event-log churn"
```

---

## Task 5: Reactor parsing — heal triggers + Sefuba chain purge

**Files:** Modify `src/utils/skillTextParser.ts`, `src/utils/abilities/buildShipAbilities.ts`; Test `src/utils/__tests__/skillTextParser.test.ts`, `src/utils/abilities/__tests__/buildShipAbilities*.test.ts` (find the right file).

- [ ] **Step 1: Write failing parser tests.** Mirror the `detectDestroyedTrigger`/`detectEnemyCleanseTrigger` tests. Assert:
  - `detectEnemyPurgedTrigger(SEFUBA_P2_TEXT, healPos)` → `'on-enemy-purged'` (heal anchored in "When this Unit purges an enemy buff, it repairs itself…").
  - `detectAllyPurgedTrigger(SALVATION_P3_TEXT, healPos)` → `'on-ally-purged'` ("When a buff is purged from an ally, this Unit repairs that ally…").
  - Negative: neither matches a sentence with no purge-trigger phrase.
  - A "purges N more" detector returns count 1 for Sefuba p2 ("purges 1 more buff") and nothing for Sefuba p1 / Salvation.
  Run → FAIL.
- [ ] **Step 2: Implement the detectors.** Add position-scoped detectors mirroring `detectDestroyedTrigger` (study it — it uses `phrasePosTrigger(text, RE, anchorPos, trigger)`). Regexes (case-insensitive):
  - `ENEMY_PURGED_RE = /\bwhen\s+this\s+unit\s+purges?\b[^.]*\benem/i` (Sefuba "when this Unit purges an enemy buff").
  - `ALLY_PURGED_RE = /\bwhen\s+a?\s*buff\s+is\s+purged\s+from\s+an?\s+ally/i` (Salvation passive voice).
  Confirm against the exact CSV text (`docs/ship-skills.csv` — Sefuba, Salvation). Adjust to match tag-stripped text (`buildShipAbilities` passes `text` with `<unit-aid>` tags — check whether detectors run on tagged or stripped text by how `detectDestroyedTrigger` is called).
- [ ] **Step 3: Wire heal triggers.** In `buildShipAbilities.ts` heal `reactiveTrigger` chain (`:937-958`), add `detectEnemyPurgedTrigger(text, healPos)` and `detectAllyPurgedTrigger(text, healPos)` to the `??` chain (after `detectDestroyedTrigger`). Order: ally-purged and enemy-purged are mutually exclusive by phrase, so order among them is irrelevant; place after the existing detectors.
- [ ] **Step 4: Emit the Sefuba chain purge.** In the purge emit region (`buildShipAbilities.ts ~:1045`), ADD a separate emit (outside the `slot==='active'||'charged'` gate) for the chain reaction: if `detectEnemyPurgedTrigger(text, purgePos)` is truthy AND a "purges N more" match exists, push a `{type:'purge', target:'enemy', trigger:'on-enemy-purged', count:<N>, conditions:[], autoFilled:true}` ability. Do NOT also emit it from the generic active/charged block (Sefuba p1/p2 are passives → already excluded there). Pin: Sefuba p2 → exactly ONE on-enemy-purged purge (count 1) + one on-enemy-purged self-heal; Sefuba p1 → one on-enemy-purged self-heal, ZERO purge.
- [ ] **Step 5:** Run parser + buildShipAbilities tests → PASS. Add/confirm an `auditSkills`-style assertion that Sefuba/Salvation produce the expected abilities (or pin via a buildShipAbilities snapshot if that's the house pattern).
- [ ] **Step 6: AUDITED gate.** `npx vitest run`. Churn: any existing Sefuba/Salvation fixture's built abilities now carry the new triggers (the heals were previously `on-cast` → now reactive; the chain purge is new). Audit the ability-shape deltas. If a Salvation/Sefuba healing/two-team golden exists, its heals now fire reactively (different timing) → audit. `npx tsc --noEmit`, `npm run lint`, `npm run audit:skills` (0/141).
- [ ] **Step 7: Commit.**
```bash
git add src/utils/skillTextParser.ts src/utils/abilities/buildShipAbilities.ts <test files>
git commit --no-verify -m "C2b-1 T5: detect on-enemy/ally-purged heal triggers + emit Sefuba chain purge"
```

---

## Task 6: Integration — Salvation, Sefuba chain, depth guard

**Files:** Test `src/utils/combat/__tests__/purgeReactive.test.ts` (or a dedicated integration test mirroring C2a's two-team harness).

- [ ] **Step 1: Salvation.** Two-team sim: an ENEMY actor purges a buff off a PLAYER ally (set up an enemy active/charged purge + a buffed player ally; turn order so the enemy purges after the ally is buffed). Assert Salvation (player, p3) repairs that ally for 5% of Salvation's max HP — the heal routes to the purged ally (`damagedAllyId`), NOT Salvation. Run → PASS.
- [ ] **Step 2: Sefuba chain.** Sefuba (p2) casts/charges an active purge that removes ≥2 enemy buffs available: assert TOTAL removed = cast count + 1 (the chain), the self-heal landed once, and EXACTLY ONE `purge-performed` was emitted (the cast; the chain purge is depth-guarded → no second event). Run → PASS.
- [ ] **Step 3: Depth guard direct.** Drive an intent with `eventCtx.fromPurgeEvent:true` through the executor and assert NO `purge-performed` emitted while the buff WAS removed (covered in T3 unit, re-assert at integration if cheap). 
- [ ] **Step 4: Full gate.** `npx vitest run` green; `npx tsc --noEmit`; `npm run lint`; `npm run audit:skills` (0/141). Audit any remaining golden churn.
- [ ] **Step 5: Commit.**
```bash
git add src/utils/combat/__tests__/purgeReactive.test.ts <any snap>
git commit --no-verify -m "C2b-1 T6: integration — Salvation ally-purged heal, Sefuba chain, depth guard"
```

---

## Task 7: Changelog + closeout

- [ ] **Step 1:** Add a `UNRELEASED_CHANGES` entry in `src/constants/changelog.ts`, e.g. "Purge skills now trigger reactions in the battle simulator: Sefuba repairs itself and purges an extra buff when it purges an enemy, and Salvation repairs an ally whose buff is purged."
- [ ] **Step 2: Full gate:** `npx vitest run` (green), `npm run lint` (0), `npx tsc --noEmit` (clean), `npm run audit:skills` (0/141).
- [ ] **Step 3: Commit.** `git add src/constants/changelog.ts && git commit --no-verify -m "C2b-1: changelog — purge reactions (Sefuba, Salvation)"`

---

## Known limitations carried into C2b-2 / C2b-3

- **Generic passive-source purges** (Iridium on-attacked, Faust on-destroyed+killer, Rhodium end-of-round+most-buffs) are NOT emitted here — only Sefuba's on-enemy-purged chain purge is. C2b-2 adds the general passive-slot emit + those triggers + `round-ended`/`enemy-most-buffs`/killer-threading.
- **Nayra `target-repaired-this-round`** condition → C2b-3.
- **Lodolite p3** (remove enemy shield on purge) → H; **Amartya** multi-victim AoE → E.
