# C2b-2 — Conditional-Source Purges (Iridium, Faust, Rhodium) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make purges that fire from a PASSIVE slot via a trigger actually emit and resolve — extend the C2a purge emit beyond active/charged to passive slots that carry a detected purge trigger, ride them through the C2b-1 reactive purge executor, and add the three new sources: **Iridium** (`on-attacked` → purge the attacker), **Rhodium** (new `end-of-round` trigger + new `enemy-most-buffs` target axis), and **Faust** (new `ship-destroyed` killer/cause threading → purge the killer when killed by direct damage).

**Architecture:** ONE generic passive-slot purge-emit path in `buildShipAbilities` keyed off a per-source trigger detector (`detectDamageReactionTrigger` for Iridium; new `detectEndOfRoundPurgeTrigger` for Rhodium; new `detectKilledByDirectDamageTrigger` for Faust). Passive purges with NO detected trigger stay non-emitted (Sefuba's chain stays on the dedicated `PURGE_MORE_RE` path; Zeolite's "when dealing damage to a Defender" purge stays deferred). The reactive executor (`triggers.ts`, C2b-1) already resolves `counterTargetId ?? ctx.enemyId` — Iridium needs zero new engine machinery. Rhodium adds a `round-ended` event drained at the round tail + an `enemyWithMostBuffs` per-side delegate. Faust adds `killerId`/`byDirectDamage` to `ship-destroyed` (threaded through `applyVictimDamage` via an engine-scope `actingActorId`), with the `on-destroyed` listener gating purge-type reactions on `byDirectDamage` and routing the killer.

**Tech Stack:** TypeScript, Vitest. Combat engine under `src/utils/combat/`; types `src/types/`; parser `src/utils/skillTextParser.ts`; ability build `src/utils/abilities/buildShipAbilities.ts`.

**Spec:** `docs/superpowers/specs/2026-06-19-purge-ecosystem-c2b-design.md` (§5 = C2b-2). Prior shipped on this branch: C1 (cleanse), C2a (on-cast purge core), C2b-1 (reactive purge ecosystem — `purge-performed` event, reactive purge executor, `on-enemy-purged`/`on-ally-purged`, Sefuba/Salvation).

## Scope (C2b-2 vs C2b-3)

**In scope (C2b-2):** the generic passive-slot purge emit; **Iridium** (p1 count-1 / p2 count-2, `on-attacked`); the `round-ended` event + `end-of-round` trigger; the `enemy-most-buffs` target axis + `enemyWithMostBuffs` engine delegate; **Rhodium** (p1/p2 count-2 `end-of-round` `enemy-most-buffs`); `ship-destroyed` `killerId`/`byDirectDamage` threading; **Faust** (p1 count-2 / p2 count-3, `on-destroyed` gated by killed-by-direct-damage, targeting the killer).

**DEFERRED (NOT this plan):**
- **C2b-3:** Nayra `target-repaired-this-round` condition (the dangerous over-removal flag).
- **Lodolite charged** "the enemy with the most Buffs is Purged of all buffs" (§5.4 optional fold-in) — passive-voice `is Purged` form on the CAST path needs most-buffs targeting wired into `playerTurn.ts` (a different code path from the reactive executor's `enemyWithMostBuffs`). DEFERRED to keep C2b-2 focused; note in closeout. (Lodolite p3 on-purge shield removal → sub-project **H**, depends on the shield system.)
- **Amartya** multi-victim AoE purge → sub-project **E**.
- **Zeolite / Cobalt / Voron / Obsidian / Chakara / Tithonus** purges: either already on-cast (active/charged — Cobalt/Obsidian/Chakara/Tithonus/Zeolite-active/Voron-charged) or a non-C2b-2 conditional ("when dealing damage to a Defender" — Zeolite passive) → stay as-is.

## Key decisions

- **Generic passive emit, trigger-gated (spec §5.1):** restructure the C2a purge-emit so a PASSIVE-slot purge emits IFF a purge trigger is detected at its anchor; active/charged stay `on-cast` (byte-identical). The emitted ability carries `trigger: <detected>` and rides the C2b-1 reactive executor. Verified safe: the only passive purges whose sentences match an `on-attacked`/`end-of-round`/`killed-by-direct-damage` detector are Iridium/Rhodium/Faust (Task 0 inventory pins this).
- **Iridium = zero new machinery:** `on-attacked` already enqueues `eventCtx.counterTargetId = attackerId` (`triggers.ts:316`); the reactive purge executor already resolves `counterTargetId ?? ctx.enemyId` (`triggers.ts:1215`); `purge` is already in `REACTIVE_ABILITY_TYPES`. Iridium needs only the parser detector + the generic emit.
- **Rhodium `enemy-most-buffs` resolution:** a new `AbilityTarget` token resolved in the reactive executor via a new optional `ctx.enemyWithMostBuffs?.(ownerId)` delegate (per-side: player owner scans `enemyAttackerActors`, enemy owner scans `allPlayerActors`); buff count = `selfBuffNamesForOwners(statusEngine, [id]).length` (reuse; includes unremovable buffs — acceptable for *target selection*, removal still respects the unremovable set; ties → first by roster order = deterministic for goldens). Falls back to `ctx.enemyId` when no opposing actor (DPS dummy) → byte-identical.
- **Faust `byDirectDamage` gate is ABILITY-scoped, not listener-global:** the `on-destroyed` listener serves BOTH Faust's purge AND Salvation's self-destruct heal (which fires on ANY death). So the `byDirectDamage`/killer gate is applied ONLY when `ra.ability.config.type === 'purge'`; heal/other on-destroyed reactions stay unconditional → Salvation byte-identical.
- **`actingActorId` for killer threading:** `applyVictimDamage` (`engine.ts:2266`) has no attacker in scope (the `applyToVictim` closure is called from inside `runPlayerTurn`). Capture the acting actor id in an engine-scope mutable set at the top of each turn; the direct wrappers (`applyIncomingToTarget`/`applyOutgoingToEnemy`) pass `{killerId: actingActorId, byDirectDamage: true}`; the DoT-tick batch path passes `{byDirectDamage: false}` (no killer). New `ship-destroyed` fields are OPTIONAL → byte-identical until Faust reads them.
- **Golden gate (spec §8):** DPS byte-identical (dummy carries no buffs → purge no-op; dummy never killed-with-observer; no most-buffs opponent). Healing + two-team sim = AUDITED churn wherever Iridium/Faust/Rhodium now legitimately purges a real buff, or a downstream Salvation/Sefuba reactor fires off the new emit (the C2b-1 chain guard means each C2b-2 source emits ONE `purge-performed`, so it DOES trigger Salvation/Sefuba — depth-1). `audit:skills` 0/141, `npm run lint` 0, `npx tsc --noEmit` clean every task. **Never blind `vitest -u`.**

**Test-runner gotcha:** bare `npm test`/`npm test --` = Vitest WATCH (hangs agents). Use `npx vitest run <file>`.
**Gate every task:** `npx vitest run` (full), `npm run lint` (0), `npx tsc --noEmit` (clean — run INDEPENDENTLY; esbuild/vitest does NOT typecheck), `npm run audit:skills` (0/141).
**Auth/commit:** docs are gitignored → `git add -f` for spec/plan/changelog-doc files; commit `--no-verify` (the pre-commit hook runs the full suite; docs-only commits should skip it).

## File structure

- **Modify** `src/utils/skillTextParser.ts` — new `detectEndOfRoundPurgeTrigger`, `detectKilledByDirectDamageTrigger`, `detectMostBuffsTarget` (+ regexes). Reuse existing `detectDamageReactionTrigger` for Iridium.
- **Modify** `src/utils/abilities/buildShipAbilities.ts` — restructure the purge-emit loop into the generic trigger-gated path (active/charged → `on-cast`; passive → detected trigger or skip); apply `enemy-most-buffs` target override.
- **Modify** `src/types/abilities.ts` — add `'end-of-round'` to `AbilityTrigger` union + `LIVE_TRIGGERS`; add `'enemy-most-buffs'` to `AbilityTarget`.
- **Modify** `src/utils/combat/events.ts` — add `round-ended` event; add `killerId?`/`byDirectDamage?` to `ship-destroyed`.
- **Modify** `src/utils/combat/state.ts` — extend `recordDestroyed` signature with optional `killerId`/`byDirectDamage`, put them on the emitted event.
- **Modify** `src/utils/combat/engine.ts` — emit `round-ended` + drain at the round tail; `enemyWithMostBuffs` per-side closures wired into the two drain contexts; `actingActorId` capture + thread `{killerId, byDirectDamage}` through `applyVictimDamage`/wrappers/DoT path.
- **Modify** `src/utils/combat/triggers.ts` — `enemyWithMostBuffs?` on `IntentExecContext` + `ReactiveSideCtx`; executor purge-branch `enemy-most-buffs` resolution; `end-of-round` trigger registration (`bus.on('round-ended', …)`); `on-destroyed` listener purge-type `byDirectDamage`+killer gate.
- **Test (new):** `src/utils/combat/__tests__/purgeConditionalSources.test.ts` (Iridium/Rhodium/Faust integration + most-buffs + round-ended + killer threading). Extend `skillTextParser.test.ts` (the new detectors) and a `buildShipAbilities` test file (the three ships' emitted abilities).
- **Changelog** `src/constants/changelog.ts`.

---

## Task 0: Baseline + purge-corpus inventory

- [ ] **Step 1:** `npx vitest run` → all green (record count). `npm run lint` (0), `npx tsc --noEmit` (clean), `npm run audit:skills` (0/141). If not green, STOP/report. Confirm `git status` clean on `feat/combat-sim-phase5-pr2`.
- [ ] **Step 2: Inventory** — confirm what the generic passive emit will newly pick up. Confirm the new IDENTIFIERS/tokens don't exist yet — grep the QUOTED exact tokens (bare phrases like `end-of-round` appear incidentally in comments/changelog prose, and `endOfRound` is a pre-existing unrelated extra-action config field — those do NOT collide): `grep -rn "'end-of-round'\|'round-ended'\|'enemy-most-buffs'\|enemyWithMostBuffs\|byDirectDamage\|detectEndOfRoundPurgeTrigger\|detectKilledByDirectDamageTrigger\|detectMostBuffsTarget" src/` → empty (only the plan/spec docs may mention them). Re-read the spec §5 + the three CSV rows (`grep -iE "^(Iridium|Faust|Rhodium)," docs/ship-skills.csv`). Pin the safety claim: the ONLY passive purges whose sentence matches an `on-attacked`/`end-of-round`/`killed-by-direct-damage` phrase are Iridium/Rhodium/Faust. Sefuba (chain → `PURGE_MORE_RE`), Salvation (heal), Zeolite ("when dealing damage to a Defender" — no detector), Voron (purge is CHARGED, not its `directly damaged` passive), Cobalt/Obsidian/Chakara/Tithonus (active/charged), Nayra (charged → C2b-3), Amartya (charged → E) MUST stay unaffected. Record this as the audit baseline.

---

## Task 1: Generic passive-slot purge emit + Iridium (`on-attacked`)

**Files:** Modify `src/utils/abilities/buildShipAbilities.ts`; Test `src/utils/abilities/__tests__/buildShipAbilities*.test.ts` (find the file that tests purge emission), `src/utils/combat/__tests__/purgeConditionalSources.test.ts` (create).

Iridium p1: `"When directly damaged, This Unit purges 1 buff from the enemy and inflicts Speed Down I for 1 turn."` p2 (second `<br/>` sentence): `"When directly damaged, This Unit purges 2 buffs from the enemy and inflicts Speed Down II…"`. Both are passive-slot, self-subject "when directly damaged" → `detectDamageReactionTrigger(text, purgePos)` returns `{trigger:'on-attacked'}` (it tests `DR_DIRECT_DAMAGE_RE` against the sentence around `purgePos`). The reactive executor already routes `counterTargetId = attacker` and calls `statusEngine.purge`.

- [ ] **Step 1: Write failing build test.** In the buildShipAbilities purge test file, assert: for Iridium's p1 passive text → exactly ONE ability `{type:'purge', target:'enemy', trigger:'on-attacked', config:{type:'purge', count:1}}`; p2 → `count:2`, `trigger:'on-attacked'`. Negative regression: Sefuba p1/p2 still produce ZERO generic-loop purge (only the existing `PURGE_MORE_RE` chain purge for p2); Zeolite passive ("when dealing damage to a Defender") produces ZERO purge; Cobalt active/charged still produce `on-cast` purges. Run → FAIL (Iridium passive currently emits nothing).
- [ ] **Step 2: Restructure the purge-emit block.** Replace the `if (slot === 'active' || slot === 'charged') { for (const p of parsePurge(text)) {…} }` block (`buildShipAbilities.ts:1075-1091`) with a single loop that computes the trigger per-slot. Import `detectDamageReactionTrigger` (already imported? check the top import block; if not, add it). Keep the long explanatory comment above (`:1054-1074`) but update it to describe the new passive-emit path.
```typescript
    // Emit purge from active/charged (on-cast, C2a) AND from a PASSIVE slot WHEN a purge
    // trigger is detected in the purge's own sentence (C2b-2): Iridium "when directly damaged"
    // → on-attacked. Rhodium end-of-round + Faust killed-by-direct-damage detectors are added
    // in later tasks. A passive purge with NO detected trigger is NOT emitted (Sefuba's chain
    // stays on PURGE_MORE_RE below; Zeolite's "when dealing damage to a Defender" stays
    // deferred). Purge is enemy-only (no support-flip).
    for (const p of parsePurge(text)) {
        const purgePos = text.search(/purge/i);
        const trigger: AbilityTrigger | undefined =
            slot === 'active' || slot === 'charged'
                ? 'on-cast'
                : // PASSIVE: detect a reactive/end-of-round purge trigger at the purge anchor.
                  // Iridium: self-subject "when directly damaged" → on-attacked. (Ignore the
                  // on-ally-attacked branch — no corpus ally-purge exists.)
                  detectDamageReactionTrigger(text, purgePos)?.trigger === 'on-attacked'
                  ? ('on-attacked' as const)
                  : undefined;
        if (!trigger) continue; // passive purge with no recognized trigger → not emitted
        out.push({
            ability: {
                id: nextId(),
                type: 'purge',
                target: p.target, // 'enemy' | 'all-enemies'
                trigger,
                conditions: [],
                config: { type: 'purge', count: p.count },
                autoFilled: true,
            },
            pos: purgePos >= 0 ? purgePos : MAX_POS,
        });
    }
```
(NOTE: the existing Sefuba `PURGE_MORE_RE` block at `:1097-1120` stays UNCHANGED — it runs after this loop and is the only path that emits Sefuba's chain purge. The new loop returns `undefined` for Sefuba's `on-enemy-purged` sentence since it matches neither `on-cast` (passive) nor `on-attacked`.)
- [ ] **Step 3: Verify the `AbilityTrigger` import.** `AbilityTrigger` must be importable in `buildShipAbilities.ts` for the local type annotation. Confirm it's already imported (it is used elsewhere); if not, add to the `src/types/abilities` import. `npx tsc --noEmit`.
- [ ] **Step 4:** Run the build test → PASS.
- [ ] **Step 5: Write the Iridium integration test** in `purgeConditionalSources.test.ts`. Two-team sim (mirror the C2b-1 `purgeReactive`/C2a integration harness — `healTargetId` set to unlock the enemy roster). Set up: a PLAYER Iridium (passive purge) + an ENEMY actor carrying ≥1 removable buff, with turn order so the enemy attacks Iridium. Assert the enemy loses a buff (purged) after attacking Iridium, and a `purge-performed` event was emitted with `casterId = Iridium`, `targetId = the attacker`. Run → PASS.
- [ ] **Step 6: AUDITED gate.** `npx vitest run`. DPS byte-identical (dummy no buffs). Audit any Iridium-bearing healing/two-team golden (Iridium purge now fires on-attacked → may remove a real enemy buff + trigger a downstream Salvation/Sefuba if present). `npx tsc --noEmit`, `npm run lint`, `npm run audit:skills` (0/141).
- [ ] **Step 7: Commit.**
```bash
git add src/utils/abilities/buildShipAbilities.ts src/utils/combat/__tests__/purgeConditionalSources.test.ts <build test file>
git commit --no-verify -m "C2b-2 T1: generic passive-slot purge emit + Iridium (on-attacked)"
```

---

## Task 2: `round-ended` event + `end-of-round` trigger (unwired)

**Files:** Modify `src/utils/combat/events.ts`, `src/types/abilities.ts`, `src/utils/combat/engine.ts`, `src/utils/combat/triggers.ts`; Test `src/utils/combat/__tests__/purgeConditionalSources.test.ts`.

No ship emits `end-of-round` yet (Rhodium parsing lands in Task 4) → production byte-identical; new behavior exercised by a unit test that registers an `end-of-round` intent directly.

- [ ] **Step 1: Add the event.** In `events.ts`, after `round-started` (`:31`), add:
```typescript
    /** Fires once per round at the round TAIL, AFTER all turns + the post-round death drain.
     *  Mirror of `round-started`. Drains the end-of-round reactive queue (Rhodium's
     *  end-of-round purge). Carries only the round number. */
    | { type: 'round-ended'; round: number }
```
- [ ] **Step 2: Add the trigger.** In `src/types/abilities.ts`, add `'end-of-round'` to the `AbilityTrigger` union (next to `'start-of-round'`, `:34`) and to `LIVE_TRIGGERS` (`:71-92`), with a one-line comment ("Rhodium end-of-round purge — C2b-2").
- [ ] **Step 3: Register the trigger** in `registerReactiveTrigger` (`triggers.ts`, the `bus.on` switch). Mirror `start-of-round` (find its `case 'start-of-round': bus.on('round-started', …)`):
```typescript
                case 'end-of-round':
                    // Global, like start-of-round: every round-ended enqueues this owner's intent
                    // (Rhodium's end-of-round purge). Gating (none for Rhodium) handled in the executor.
                    bus.on('round-ended', () => enqueue(intent));
                    break;
```
- [ ] **Step 4: Emit + drain at the round tail.** In `engine.ts`, locate the round-loop tail: the post-round enemy-death `recordDestroyed(enemy, r, bus)` (`~:4053`) and the subsequent `roundData.push`/healing-mode push. Emit `round-ended` **AFTER the post-round death drain** (so an end-of-round purge sees post-death state) and **BEFORE** the round's `roundData` assembly, then drain both queues — exactly mirroring how `round-started` emits then `drainIntents(); drainEnemyIntents();` (`:2987-2990`). Find the precise statement (the post-round `recordDestroyed` + any trailing `drainIntents()` at `~:4053-4063`); insert after the last post-round drain:
```typescript
        // round-ended (C2b-2): end-of-round reactive purge (Rhodium). Emitted at the round TAIL,
        // after the post-round death drain so the purge sees post-death state, before roundData
        // assembly. Drain BOTH queues (player + enemy), mirroring the round-started emit+drain.
        bus.emit({ type: 'round-ended', round: r });
        drainIntents();
        drainEnemyIntents();
```
**Confirm at impl time** the exact line this precedes (the `roundData.push` / healing push) and that no other post-round mutation must run first. If a post-round drain already exists immediately above, this new drain is the round-ended one (the queues are empty otherwise → cheap no-op).
- [ ] **Step 5: Write a unit test** (`purgeConditionalSources.test.ts`): register an `end-of-round` intent (a trivial purge or a spy) and assert it fires exactly once per round, after the turn loop. If a direct `round-ended` bus-spy is simpler, assert one `round-ended` per round with ascending `round`. Run → PASS.
- [ ] **Step 6: Byte-identical gate.** `npx vitest run` → green, **ZERO snapshot movement** (no ship emits `end-of-round`; `round-ended` has no consumer beyond the empty-queue drain). If any golden moves, an unexpected drain ran → investigate. `npx tsc --noEmit` (confirm no exhaustive event-type/`AbilityTrigger` switch now errors — add a no-op `default`/case + report if so), `npm run lint`, `npm run audit:skills`.
- [ ] **Step 7: Commit.**
```bash
git add src/utils/combat/events.ts src/types/abilities.ts src/utils/combat/engine.ts src/utils/combat/triggers.ts src/utils/combat/__tests__/purgeConditionalSources.test.ts
git commit --no-verify -m "C2b-2 T2: round-ended event + end-of-round trigger (unwired, byte-identical)"
```

---

## Task 3: `enemy-most-buffs` target axis + `enemyWithMostBuffs` delegate (unwired)

**Files:** Modify `src/types/abilities.ts`, `src/utils/combat/triggers.ts`, `src/utils/combat/engine.ts`; Test `src/utils/combat/__tests__/purgeConditionalSources.test.ts`.

No ship targets `enemy-most-buffs` yet (Rhodium parsing → Task 4) → byte-identical; exercised by an executor unit test.

- [ ] **Step 1: Add the target token.** In `src/types/abilities.ts`, extend `AbilityTarget` (`:24`): `'self' | 'ally' | 'all-allies' | 'enemy' | 'all-enemies' | 'enemy-most-buffs'`. Run `npx tsc --noEmit` → it WILL flag every exhaustive `switch`/consumer over `AbilityTarget`. **Inventory them** (`grep -rn "AbilityTarget\|\.target ===" src/utils | grep -v test` + follow tsc errors). For each, decide: most consumers (heal/buff recipient resolution, UI target dropdowns) should treat `enemy-most-buffs` like `'enemy'` (a single opposing target) — add it to the same branch, or add an explicit case. Document each touched switch. (The ONLY site that resolves it specially is the reactive purge executor, Step 3.)
- [ ] **Step 2: Add the delegate to the context types.** In `triggers.ts`: add to `IntentExecContext` (`:455`):
```typescript
    /** Resolve the opposing actor carrying the most buffs (Rhodium's enemy-most-buffs purge).
     *  Per-side: a player owner scans the enemy roster, an enemy owner scans the player roster.
     *  Returns undefined when no opposing actor exists (DPS dummy) → executor falls back to
     *  ctx.enemyId. Optional — absent in unit-test ctxs that don't drive most-buffs purges. */
    enemyWithMostBuffs?: (ownerId: string) => string | undefined;
```
and to `ReactiveSideCtx` (`engine.ts:1006`):
```typescript
    /** Per-side most-buffs opposing-actor resolver (Rhodium). See IntentExecContext. */
    enemyWithMostBuffs?: (ownerId: string) => string | undefined;
```
Pass it through in the `drainQueue` `executeIntent({...})` literal (`engine.ts:2850`): `enemyWithMostBuffs: sideCtx.enemyWithMostBuffs,`.
- [ ] **Step 3: Resolve it in the executor purge branch.** In `triggers.ts:1209-1227`, change the target resolution so `enemy-most-buffs` consults the delegate:
```typescript
    if (cfg.type === 'purge') {
        // Target: enemy-most-buffs (Rhodium) → the opposing actor with the most buffs;
        // else the routed attacker/killer (counterTargetId — Iridium/Faust) else the turn's enemy.
        const targetId =
            intent.ability.target === 'enemy-most-buffs'
                ? (ctx.enemyWithMostBuffs?.(intent.ownerId) ?? ctx.enemyId)
                : (intent.eventCtx?.counterTargetId ?? ctx.enemyId);
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
- [ ] **Step 4: Wire the per-side closures in the engine.** Add `enemyWithMostBuffs` to BOTH drain-context literals. Player drain (`engine.ts:2928`): scan `enemyAttackerActors`; enemy drain (`:2944`): scan `allPlayerActors`. Use `selfBuffNamesForOwners` (already imported, `:70`). A shared helper near the drain closures:
```typescript
        // C2b-2: opposing actor with the most buffs (Rhodium's enemy-most-buffs purge). Buff
        // count via selfBuffNamesForOwners (incl. unremovable — fine for SELECTION; removal still
        // respects the unremovable set). Ties → first by roster order (deterministic for goldens).
        // Returns undefined for an empty roster (DPS dummy) → executor falls back to ctx.enemyId.
        const mostBuffsAmong = (roster: CombatActor[]): string | undefined => {
            let best: string | undefined;
            let bestCount = -1;
            for (const a of roster) {
                const n = selfBuffNamesForOwners(statusEngine, [a.id]).length;
                if (n > bestCount) {
                    bestCount = n;
                    best = a.id;
                }
            }
            return bestCount > 0 ? best : undefined; // no buffs anywhere → no most-buffs target
        };
```
Player ctx: `enemyWithMostBuffs: () => mostBuffsAmong(enemyAttackerActors),`. Enemy ctx: `enemyWithMostBuffs: () => mostBuffsAmong(allPlayerActors),`. (The `ownerId` param is unused for now — owner side is already encoded by which drain context; keep the param in the signature for symmetry with the other per-owner delegates.)
- [ ] **Step 5: Write the executor unit test** (`purgeConditionalSources.test.ts`): build an `IntentExecContext` stub with an `enemyWithMostBuffs` spy returning a fixed id + a `statusEngine.purge` spy; drive a `{type:'purge', count:2, target:'enemy-most-buffs'}` intent and assert `purge` is called with the most-buffs id (not `counterTargetId`/`enemyId`); a `target:'enemy'` purge still uses `counterTargetId ?? enemyId`; when `enemyWithMostBuffs` returns undefined, falls back to `enemyId`. Run → PASS.
- [ ] **Step 6: Byte-identical gate.** `npx vitest run` → green, ZERO snapshot movement (no ship targets `enemy-most-buffs`). `npx tsc --noEmit` (all `AbilityTarget` switches handled), `npm run lint`, `npm run audit:skills`.
- [ ] **Step 7: Commit.**
```bash
git add src/types/abilities.ts src/utils/combat/triggers.ts src/utils/combat/engine.ts src/utils/combat/__tests__/purgeConditionalSources.test.ts
git commit --no-verify -m "C2b-2 T3: enemy-most-buffs target axis + enemyWithMostBuffs delegate (unwired)"
```

---

## Task 4: Rhodium — parse end-of-round + most-buffs, wire emit, integrate

**Files:** Modify `src/utils/skillTextParser.ts`, `src/utils/abilities/buildShipAbilities.ts`; Test `src/utils/__tests__/skillTextParser.test.ts`, the buildShipAbilities purge test, `src/utils/combat/__tests__/purgeConditionalSources.test.ts`.

Rhodium p1: `"At the end of the round, this Unit purges 2 buffs from the enemy with the most buffs."` p2 adds `"and deals 80% damage that cannot critically hit."`. Both passive-slot.

- [ ] **Step 1: Write failing parser tests** (`skillTextParser.test.ts`). Assert against the RAW tagged CSV strings (mirror `detectEnemyPurgedTrigger` tests):
  - `detectEndOfRoundPurgeTrigger(RHODIUM_P1_RAW, purgePos)` → `'end-of-round'`; negative on a sentence with no "end of the round" phrase.
  - `detectMostBuffsTarget(RHODIUM_P1_RAW, purgePos)` → `true`; `false` for a plain "from the enemy" sentence (Iridium).
  Run → FAIL (not defined).
- [ ] **Step 2: Implement the detectors** (`skillTextParser.ts`, near `detectEnemyPurgedTrigger`, `:1019-1056`). Use loose `[^.;]*` gaps to cross `<unit-aid>` tags (the CSV embeds tags mid-phrase — same lesson as C2b-1's `ENEMY_PURGED_RE`):
```typescript
// "at the end of the round, … purges …" — Rhodium end-of-round purge. Position-scoped.
const END_OF_ROUND_RE = /\bat\s+the\s+end\s+of\s+the\s+round\b/i;
export function detectEndOfRoundPurgeTrigger(
    text: string | null | undefined,
    anchorPos: number
): AbilityTrigger | undefined {
    return phrasePosTrigger(text, END_OF_ROUND_RE, anchorPos, 'end-of-round');
}

// "the enemy with the most buffs" — Rhodium most-buffs target axis. Crosses <unit-aid> tags.
const MOST_BUFFS_RE = /\benemy\b[^.;]*\bwith\s+the\s+most\b[^.;]*\bbuffs?\b/i;
export function detectMostBuffsTarget(
    text: string | null | undefined,
    anchorPos: number
): boolean {
    if (!text) return false;
    const sentence = rawSentenceAround(text, anchorPos);
    return sentence !== undefined && MOST_BUFFS_RE.test(sentence);
}
```
**Verify each regex against the RAW string** with a scratch `console.log(RE.test(RAW))` if unsure (the CSV has `<unit-aid>purges 2</unit-aid> buffs from the enemy with the most buffs`).
- [ ] **Step 3: Wire into the generic emit.** In `buildShipAbilities.ts` (the Task-1 loop), extend the passive trigger chain to also detect end-of-round, and apply the most-buffs target override:
```typescript
        const passiveTrigger: AbilityTrigger | undefined =
            detectDamageReactionTrigger(text, purgePos)?.trigger === 'on-attacked'
                ? ('on-attacked' as const)
                : detectEndOfRoundPurgeTrigger(text, purgePos); // Rhodium
        const trigger = slot === 'active' || slot === 'charged' ? 'on-cast' : passiveTrigger;
        if (!trigger) continue;
        const target: AbilityTarget = detectMostBuffsTarget(text, purgePos)
            ? 'enemy-most-buffs'
            : p.target;
```
(use `target` in the pushed ability instead of `p.target`). Import `detectEndOfRoundPurgeTrigger`/`detectMostBuffsTarget`. **Most-buffs override is global** (not passive-only) so a future active/charged most-buffs purge (Lodolite, deferred) would also resolve correctly — harmless now (no active/charged corpus purge says "most buffs").
- [ ] **Step 4: Build test.** Assert Rhodium p1 → `{type:'purge', target:'enemy-most-buffs', trigger:'end-of-round', count:2}`; p2 → same purge (+ its separate 80%-no-crit damage ability, unrelated). Iridium unchanged (`target:'enemy'`). Run → PASS.
- [ ] **Step 5: Rhodium integration test** (`purgeConditionalSources.test.ts`). Two-team sim: player Rhodium + TWO enemy actors, one carrying MORE buffs than the other. Assert at end of round Rhodium purges 2 buffs from the most-buffed enemy (not the other), and emits `purge-performed` targeting it. Add a TIE test: two enemies with equal buff counts → the FIRST by roster order is chosen (deterministic). Run → PASS.
- [ ] **Step 6: AUDITED gate.** `npx vitest run`. DPS byte-identical (dummy: `mostBuffsAmong([])` → undefined → falls to dummy → no buffs → purge 0 → no emit). Audit Rhodium-bearing healing/two-team goldens. `npx tsc --noEmit`, `npm run lint`, `npm run audit:skills` (0/141).
- [ ] **Step 7: Commit.**
```bash
git add src/utils/skillTextParser.ts src/utils/abilities/buildShipAbilities.ts src/utils/__tests__/skillTextParser.test.ts src/utils/combat/__tests__/purgeConditionalSources.test.ts <build test>
git commit --no-verify -m "C2b-2 T4: Rhodium end-of-round + enemy-most-buffs purge"
```

---

## Task 5: `ship-destroyed` killer + cause threading (byte-identical)

**Files:** Modify `src/utils/combat/events.ts`, `src/utils/combat/state.ts`, `src/utils/combat/engine.ts`; Test `src/utils/combat/__tests__/purgeConditionalSources.test.ts` (+ any existing `recordDestroyed`/state test).

> **Escape hatch:** Tasks 5+6 (Faust) are the heaviest, hot-path part. If Task 5's threading produces unexpected golden churn that can't be cleanly audited, peel Tasks 5+6 into a separate follow-up PR (C2b-2-Faust) and ship Tasks 1-4 (Iridium + Rhodium) as C2b-2. Decide after Step 6's gate.

The lethal attacker is NOT in scope inside `applyVictimDamage` (`engine.ts:2266` — the `applyToVictim` closure is invoked from inside `runPlayerTurn`). Capture the acting actor in an engine-scope mutable, thread `{killerId, byDirectDamage}` to `recordDestroyed`. New event fields OPTIONAL → no consumer until Task 6 → byte-identical.

- [ ] **Step 1: Extend the event.** In `events.ts`, change the `ship-destroyed` member (`:151`) to add optional fields:
```typescript
    /** … existing docs … `killerId`/`byDirectDamage` (C2b-2 Faust): the lethal attacker and
     *  whether the kill was a DIRECT hit (vs a DoT-tick batch, which has no single killer →
     *  byDirectDamage:false, killerId undefined). Optional — only Faust's on-destroyed purge
     *  reads them; all other listeners ignore them (backward-compatible). */
    | { type: 'ship-destroyed'; actorId: string; round: number; killerId?: string; byDirectDamage?: boolean }
```
- [ ] **Step 2: Extend `recordDestroyed`.** In `state.ts:177`, add optional params and put them on the emit:
```typescript
export function recordDestroyed(
    actor: CombatActor,
    round: number,
    bus: CombatEventBus,
    killerId?: string,
    byDirectDamage?: boolean
): void {
    // … existing idempotency guard …
    bus.emit({ type: 'ship-destroyed', actorId: actor.id, round, killerId, byDirectDamage });
}
```
(Read the existing body first — preserve the idempotent destroyedRound guard. Omitting the new args at existing call sites yields `undefined` → event shape gains two optional keys; confirm goldens that snapshot the event stream, if any, treat absent-vs-undefined identically — `battleSimulator.ts` switches on `e.type`, doesn't deep-equal the event.)
- [ ] **Step 3: Capture `actingActorId`.** In `engine.ts`, find the per-actor turn dispatch in the main round loop (where `runPlayerTurn` is invoked for the selected actor — search the selection loop near `selectNextBySpeed`/the turn iteration). Add an engine-scope `let actingActorId: string | undefined;` (near the round-loop locals) and set `actingActorId = <actor>.id;` at the TOP of each actor's turn, before its damage application. (If turns resolve through a single `runTurnFor(actor)`-style call, set it there; otherwise set it at each of the focus/team/enemy dispatch points — confirm the exact site(s) at impl time.)
- [ ] **Step 4: Thread through `applyVictimDamage` + wrappers.** Add an optional opts param:
```typescript
        const applyVictimDamage = (
            damage: number,
            victim: CombatActor,
            sink: DamageAccountingSink,
            cause?: { killerId?: string; byDirectDamage?: boolean }
        ): { … } => {
            …
                    recordDestroyed(victim, r, bus, cause?.killerId, cause?.byDirectDamage);
            …
        };
```
Direct wrappers pass the acting attacker + direct flag:
```typescript
        const applyIncomingToTarget = (damage, victim = healTarget!) =>
            applyVictimDamage(damage, victim, playerSink, { killerId: actingActorId, byDirectDamage: true });
        const applyOutgoingToEnemy = (damage, enemyVictim) =>
            applyVictimDamage(damage, enemyVictim, enemySink, { killerId: actingActorId, byDirectDamage: true });
```
**DoT-tick batch path** (`engine.ts:~3129` `applyIncomingToTarget(tankDotDamage)` — an aggregate with no single killer): it calls `applyIncomingToTarget`, which now defaults `byDirectDamage:true` — WRONG for DoT. Give the DoT call an explicit non-direct cause. Either (a) add an optional 3rd arg to `applyIncomingToTarget` for the DoT site to pass `{byDirectDamage:false}`, or (b) call `applyVictimDamage(tankDotDamage, healTarget!, playerSink, {byDirectDamage:false})` directly at the DoT site. **Audit EVERY caller of `applyIncomingToTarget`/`applyOutgoingToEnemy`** (the positional path `~:3799`, the legacy single-apply, the DoT batch) — direct-attack callers get `byDirectDamage:true` (the default), only DoT-tick/non-attack intake must override to `false`. A mis-set flag here is the main risk; enumerate the callers in the commit message.
- [ ] **Step 5: Test** (`purgeConditionalSources.test.ts`): drive a direct kill and assert `ship-destroyed` carries `killerId = attacker, byDirectDamage:true`; drive a DoT-tick kill and assert `byDirectDamage:false` (and `killerId` absent/undefined). Use the existing two-team/healing harness or a state-level `recordDestroyed` unit test for the cause-passthrough. Run → PASS.
- [ ] **Step 6: Byte-identical gate.** `npx vitest run` → green, **ZERO snapshot movement** (new event fields have no consumer yet; destruction trajectories unchanged). If a golden moves, a `byDirectDamage` flag is mis-set on a live path → fix the flag, do NOT `-u`. `npx tsc --noEmit`, `npm run lint`, `npm run audit:skills`. **If churn is unexplainable → invoke the escape hatch (peel Faust to its own PR).**
- [ ] **Step 7: Commit.**
```bash
git add src/utils/combat/events.ts src/utils/combat/state.ts src/utils/combat/engine.ts src/utils/combat/__tests__/purgeConditionalSources.test.ts
git commit --no-verify -m "C2b-2 T5: ship-destroyed killerId + byDirectDamage threading (byte-identical)"
```

---

## Task 6: Faust — on-destroyed purge gate, killer routing, parse, integrate

**Files:** Modify `src/utils/skillTextParser.ts`, `src/utils/abilities/buildShipAbilities.ts`, `src/utils/combat/triggers.ts`; Test `skillTextParser.test.ts`, the build test, `src/utils/combat/__tests__/purgeConditionalSources.test.ts`.

Faust p1: `"This Unit purges 2 buffs from the enemy when killed by direct Damage."` p2: `"purges 3 buffs … when killed by direct Damage."` Both passive, self-destruction-scoped, killer-targeted.

- [ ] **Step 1: Write failing parser test** (`skillTextParser.test.ts`): `detectKilledByDirectDamageTrigger(FAUST_P1_RAW, purgePos)` → `'on-destroyed'`; negative on a sentence without "killed by direct damage". Run → FAIL.
- [ ] **Step 2: Implement the detector** (`skillTextParser.ts`):
```typescript
// "… when killed by direct Damage" — Faust on-destroyed purge (killer-targeted, direct-only).
// Crosses tags; "direct" guards against a future DoT-kill phrasing.
const KILLED_BY_DIRECT_RE = /\bwhen\s+killed\s+by\s+direct\b[^.;]*\bdamage\b/i;
export function detectKilledByDirectDamageTrigger(
    text: string | null | undefined,
    anchorPos: number
): AbilityTrigger | undefined {
    return phrasePosTrigger(text, KILLED_BY_DIRECT_RE, anchorPos, 'on-destroyed');
}
```
- [ ] **Step 3: Wire into the generic emit.** Extend the passive trigger chain (`buildShipAbilities.ts`):
```typescript
        const passiveTrigger: AbilityTrigger | undefined =
            detectDamageReactionTrigger(text, purgePos)?.trigger === 'on-attacked'
                ? ('on-attacked' as const)
                : (detectEndOfRoundPurgeTrigger(text, purgePos) ??   // Rhodium
                   detectKilledByDirectDamageTrigger(text, purgePos)); // Faust
```
Build test: Faust p1 → `{type:'purge', target:'enemy', trigger:'on-destroyed', count:2}`; p2 → `count:3`. (Salvation's self-destruct heal is a HEAL with `on-destroyed` via `detectDestroyedTrigger` — unaffected; Faust's purge is a distinct ability.)
- [ ] **Step 4: Gate the `on-destroyed` listener (ABILITY-scoped).** In `triggers.ts:351-356`, replace the unconditional `enqueue(intent)` so a PURGE reaction only fires on a direct-damage kill and routes the killer; non-purge reactions (Salvation heal) stay unconditional:
```typescript
                case 'on-destroyed':
                    bus.on('ship-destroyed', (e) => {
                        // Self-scoped: THIS owner was destroyed. Faust's PURGE only fires when
                        // killed by DIRECT damage and targets the killer; Salvation's self-destruct
                        // HEAL (and any other on-destroyed reaction) fires on ANY death, unchanged.
                        if (e.actorId !== ownerId) return;
                        if (ra.ability.config.type === 'purge') {
                            if (!e.byDirectDamage) return;
                            enqueue({ ...intent, eventCtx: { ...intent.eventCtx, counterTargetId: e.killerId } });
                        } else {
                            enqueue(intent);
                        }
                    });
                    break;
```
(`ra` is in scope in this switch — the on-attacked case reads `ra.ability.triggerCritFilter`. The purge executor already resolves `counterTargetId ?? ctx.enemyId`, so `counterTargetId = killerId` routes the purge to the killer; if `killerId` were somehow undefined it falls back to `ctx.enemyId` — but the `byDirectDamage` gate guarantees a direct kill, where Task 5 sets `killerId`.)
- [ ] **Step 5: Faust integration test** (`purgeConditionalSources.test.ts`). Two-team sim: a buffed enemy attacker kills Faust with a DIRECT attack → assert Faust purges 2 (p1) buffs from that killer + emits `purge-performed` targeting the killer. SECOND scenario: Faust dies to a DoT tick (no direct killer) → assert NO purge fires (the `byDirectDamage:false` gate). Run → PASS.
- [ ] **Step 6: AUDITED gate.** `npx vitest run`. DPS byte-identical (dummy never recorded-destroyed-with-observer; Faust as the focus dies → its on-destroyed purge needs a real killer + buffs). Audit Faust/Salvation-bearing goldens (Salvation's on-destroyed heal must be UNCHANGED — pin a regression assertion that Salvation still heals on a non-direct death). `npx tsc --noEmit`, `npm run lint`, `npm run audit:skills` (0/141).
- [ ] **Step 7: Commit.**
```bash
git add src/utils/skillTextParser.ts src/utils/abilities/buildShipAbilities.ts src/utils/combat/triggers.ts src/utils/__tests__/skillTextParser.test.ts src/utils/combat/__tests__/purgeConditionalSources.test.ts <build test>
git commit --no-verify -m "C2b-2 T6: Faust on-destroyed killer-targeted purge (killed-by-direct-damage)"
```

---

## Task 7: Changelog + closeout

- [ ] **Step 1:** Add a `UNRELEASED_CHANGES` entry in `src/constants/changelog.ts`, plain-English, e.g.: "More purge skills now work in the battle simulator: Iridium purges its attacker when directly damaged, Rhodium purges the most-buffed enemy at the end of each round, and Faust purges its killer when destroyed by a direct attack."
- [ ] **Step 2: Full gate:** `npx vitest run` (green), `npm run lint` (0), `npx tsc --noEmit` (clean), `npm run audit:skills` (0/141). Re-audit the full healing/two-team golden diff vs the Task-0 baseline — every moved snapshot line justified (a real purge removing a real buff, or a downstream reactor firing).
- [ ] **Step 3: Commit.** `git add src/constants/changelog.ts && git commit --no-verify -m "C2b-2: changelog — conditional-source purges (Iridium, Faust, Rhodium)"`

---

## Known limitations carried into C2b-3 / later

- **Nayra `target-repaired-this-round`** condition → **C2b-3** (the dangerous over-removal flag stays until then; do NOT add a Nayra fixture before C2b-3).
- **Lodolite charged** "the enemy with the most Buffs is Purged of all buffs" (passive-voice, CAST path) → deferred (§5.4): `enemy-most-buffs` resolution exists only in the reactive executor; the cast-path purge fire in `playerTurn.ts` would need its own most-buffs wiring. Lodolite p3 on-purge shield removal → **H**.
- **Amartya** "purges 1 buff from all enemies for every 50% crit power" → still single-anchor count:1 (C2a under-approximation); true multi-victim AoE + crit-power scaling → **E**.
- **`enemy-most-buffs` count basis** includes unremovable buffs (uses `selfBuffNamesForOwners`); target *selection* may pick an enemy whose buffs are all unremovable (purge then removes 0). Acceptable v1; revisit if a removable-only count is needed.
