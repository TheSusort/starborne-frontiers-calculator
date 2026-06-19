# C2a — Purge Core (On-Cast) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make an active/charged `purge` skill actually remove buffs from the targeted enemy (newest-applied-first, respecting the unremovable set), instead of being annotation-only.

**Architecture:** Reuse C1's `removeNewestFirst(actorId, side, count)` — its `'buffs'` side already operates on `selfMaps`/`accumSelfMaps` for an actor, so `purge(actorId, count)` is a one-line wrapper. Add a `parsePurge` parser mirroring `parseCleanse`, emit purge abilities in `buildShipAbilities`, and fire on-cast purge in the cast path's all-modes enemy-target region (the `timedEnemyBySlot` loop area in `playerTurn.ts`, where the acting actor's resolved `targetId` is in scope). Un-gate purge from `NOT_SIMULATED_TYPES`.

**Tech Stack:** TypeScript, Vitest. Combat engine under `src/utils/combat/`.

**Spec:** `docs/superpowers/specs/2026-06-19-cleanse-purge-design.md` (sub-project C, C2 portion). C1 (cleanse) shipped (commits `4e7f97d4`→`5fcc0913`).

## Scope (C2a vs C2b)

**In scope (C2a):** parser + `purge()` wrapper + ON-CAST purge from the fired active/charged skill + Protection→unremovable + remove `'purge'` from `NOT_SIMULATED_TYPES`. Target = the acting actor's single resolved enemy (`targetId`).

**DEFERRED to C2b (documented, NOT this plan):** the reactive purge ecosystem — `purge-performed` event, `on-ally-purged` (Salvation) + `on-unit-purged` (Sefuba) triggers and their reactions, the Sefuba purge-chains-purge chain guard, the `reactiveRecipients(intent, ctx)` helper extraction (heal+cleanse+purge dedup). Also deferred: AoE `all-enemies` purge actually hitting multiple victims (single-anchor only here → sub-project E), the passive-voice "is Purged of all buffs" / "most-buffs" targeting (Lodolite/Rhodium), and conditional purges (Faust on-death, Cobalt-p2 on-charged, Iridium on-attacked) — those carry non-on-cast triggers and won't fire from the on-cast path.

## Key decisions

- **Firing site (CORRECTED after plan-review):** NOT the `timedEnemyBySlot` loop (~:884-903) — that iterates pre-bucketed `TimedStatus` objects, not `Ability` objects, and `gatedSkill` (the fired-skill abilities) is not constructed until `playerTurn.ts` ~:1149. Fire purge in a NEW pass placed AFTER `gatedSkill` is built (~:1149) and before/around the `if (args.healing)` block (~:1387): iterate `gatedSkill?.abilities` filtered for `a.config.type === 'purge' && a.trigger === 'on-cast'`, guarded by `if (targetId !== undefined)`, calling `statusEngine.purge(targetId, a.config.count)`. `targetId`, `actor`, `action`, `statusEngine` are all top-level `runPlayerTurn` bindings in scope there.
- **SIDE-SYMMETRIC, no `healEventOnly` gate (unlike cleanse):** purge keys off `targetId` — the acting actor's resolved OPPOSING target (per B1, keyed correctly per direction). A player actor's `targetId` is its enemy; an enemy actor's `targetId` is its player target. So `statusEngine.purge(targetId, count)` removes the right side's buffs for BOTH player and enemy casters with NO side gate. (Cleanse needed `!healEventOnly` only because its `recipientsFor` returned player ids; purge has no such problem.) Place the pass unconditionally (NOT inside `if(args.healing)`) — it's byte-identical in DPS because the dummy enemy carries no buffs (`purge(dummyId)` = no-op).
- **Target store:** an enemy's buffs are its self-buffs → `selfMaps.get(targetId)` / `accumSelfMaps.get(targetId)`. `purge(targetId, count) = removeNewestFirst(targetId, 'buffs', count)` removes them.
- **Emit ONLY from active/charged slots** (the over-approximation fix): every reactive/conditional purge in the corpus lives in a PASSIVE (Faust on-death p1, Iridium on-attacked p1, Cobalt on-charged p2, Rhodium end-of-round p1, Sefuba on-purged p1/p2 incl. the "purges 1 more" chain, Salvation on-ally-purged p2, Lodolite on-purged p1). Every genuine ON-CAST purge lives in an ACTIVE or CHARGED skill (Sefuba active, Cobalt active/charged, Chakara charged, Tithonus active, Zeolite active, Amartya charged). So gating the emit on `slot === 'active' || slot === 'charged'` cleanly excludes ALL reactive/conditional purges — no purge-trigger detection needed in C2a, and it eliminates the Sefuba-p2 double-emit. (`slot` is in scope in the buildShipAbilities emission, as used by the cleanse block's `flipBareSupportTarget`.)
- **Golden gate:** DPS mode byte-identical (dummy enemy has no buffs → purge no-op). Healing mode byte-identical (no purge ship in existing healing fixtures, and the enemy roster only walks when `healTargetId` is set). **Two-team battle-sim goldens** (twoTeamBattle/positionalDamage/dpsSimulator-multi) WILL churn where an active/charged purge removes a real enemy self-buff → AUDITED, never blind `vitest -u`.
- **`'all'` count** already supported by the type/primitive (C1 widened `count: number | 'all'`). `parsePurge` emits `'all'` for "purges all buffs".
- **No reactive purge** in C2a → no `purge-performed` event, no chain guard needed yet.
- **`audit:skills` does NOT measure purge** (`scripts/auditSkills.ts` has no cleanse/purge rule) — emitting purge abilities cannot move the 0/141 count. The gate stays 0/141 trivially; don't chase a non-issue. (Still run it to confirm no regression.)

**Test-runner gotcha:** bare `npm test` is Vitest WATCH (hangs). Use `npx vitest run <file>`.
**Gate every task:** `npm run lint` (0), `npx tsc --noEmit` (clean), `npm run audit:skills` (0/141).

## File structure

- **Modify** `src/utils/combat/statusEngine.ts` — add `purge()` wrapper + interface decl.
- **Modify** `src/utils/skillTextParser.ts` — `PURGE_RE` + `parsePurge`.
- **Modify** `src/utils/abilities/buildShipAbilities.ts` — emit purge abilities.
- **Modify** `src/utils/combat/playerTurn.ts` — on-cast purge firing in the enemy-target region.
- **Modify** `src/components/skills/simCoverage.ts` — remove `'purge'` from `NOT_SIMULATED_TYPES`.
- **Modify** `src/utils/combat/cheatDeathBuffs.ts` — add `Protection` (buff) to `UNREMOVABLE_STATUSES`.
- **Test (new)** `src/utils/combat/__tests__/purgeRemoval.test.ts`, `src/utils/__tests__/skillTextParser.test.ts` (extend), a cast-path integration test.
- **Changelog** `src/constants/changelog.ts`.

---

## Task 0: Baseline

- [ ] Run `npx vitest run` → all green (record count, ~2555). `npm run lint` (0), `npx tsc --noEmit` (clean), `npm run audit:skills` (0/141). If not green, STOP/report.
- [ ] Inventory: `grep -rln "purge\|Purge" src/utils/combat/__tests__ src/utils/__tests__ src/utils/calculators/__tests__` — note any test that asserts on purge today (likely none, since purge is unparsed/not-simulated).

---

## Task 1: `purge()` wrapper + Protection unremovable

**Files:** Modify `src/utils/combat/statusEngine.ts`, `src/utils/combat/cheatDeathBuffs.ts`; Test `src/utils/combat/__tests__/purgeRemoval.test.ts` (create).

- [ ] **Step 1: Write the failing test.** Create `purgeRemoval.test.ts` mirroring `cleanseRemoval.test.ts`'s setup. `purge` removes an actor's BUFFS — drive SELF-buffs onto an actor id (apply timed ability statuses self-side, i.e. `applyTimedAbilityStatus(round, status, ownerId)` with no enemyTargetId so they land in `selfMaps.get(ownerId)` — confirm the self-side application shape against statusEngine.test.ts). Tests: (a) `purge('e1', 2)` removes the 2 newest self-buffs of `e1`, oldest remains, returns 2; (b) `'all'` removes all; (c) `Protection` and `Magnetized Shielding` survive (unremovable buffs); (d) unknown id → 0. Run → FAIL (`purge` not a function).

- [ ] **Step 2: Add `purge`.** In `statusEngine.ts`, next to `cleanse`:
```typescript
    const purge = (actorId: string, count: number | 'all'): number =>
        removeNewestFirst(actorId, 'buffs', count);
```
Declare on the `StatusEngine` interface (next to `cleanse`'s declaration) with a doc comment ("Remove up to `count` removable BUFFS from `actorId`'s self store, newest first; `'all'` = all; returns count removed."). Add `purge,` to the returned engine object literal.

- [ ] **Step 3: Add `Protection` to `UNREMOVABLE_STATUSES`.** In `cheatDeathBuffs.ts`, add `'Protection'` (an in-game "Unremovable" BUFF, game UI 2026-06-19) to the set, with a comment. (`Magnetized Shielding` is already present.)

- [ ] **Step 4:** Run `npx vitest run src/utils/combat/__tests__/purgeRemoval.test.ts` → PASS.

- [ ] **Step 5: Byte-identical gate.** `npx vitest run` (full) → baseline + new tests, ZERO snapshot movement (purge is unwired; Protection only affects removeNewestFirst/clearRemovable — verify no golden revived an actor carrying Protection). `npm run lint`/`tsc`/`audit:skills`.

- [ ] **Step 6: Commit.**
```bash
git add -f src/utils/combat/statusEngine.ts src/utils/combat/cheatDeathBuffs.ts src/utils/combat/__tests__/purgeRemoval.test.ts
git commit --no-verify -m "C2a T1: purge() wrapper + Protection unremovable (unwired)"
```

---

## Task 2: `parsePurge` parser

**Files:** Modify `src/utils/skillTextParser.ts`; Test `src/utils/__tests__/skillTextParser.test.ts`.

- [ ] **Step 1: Write the failing parser test.** Find where `parseCleanse` is tested in `skillTextParser.test.ts` and mirror. Assert:
  - `parsePurge('This Unit purges 1 buff from the enemy.')` → `[{ count: 1, target: 'enemy', explicitTarget: true }]`
  - `parsePurge('purges all buffs from the enemy')` → `[{ count: 'all', target: 'enemy', explicitTarget: true }]`
  - `parsePurge('purges 1 buff from all enemies ...')` (Amartya) → `[{ count: 1, target: 'all-enemies', explicitTarget: true }]`
  - `parsePurge('purges a buff from an enemy')` (Sefuba p2 / Lodolite p3) → `[{ count: 1, target: 'enemy', explicitTarget: true }]`
  - `parsePurge('This Unit cleanses 1 debuff.')` → `[]` (does NOT match cleanse)
  - `parsePurge('is Purged of all buffs')` → `[]` (passive voice, no `purges` verb — deferred to C2b)
  - **Document the context-free double-match:** `parsePurge('when this unit purges an enemy buff, it repairs itself and purges 1 more buff')` (Sefuba p2) → returns TWO matches (count 1, count 1). This is EXPECTED — `parsePurge` is a pure, context-free matcher. The reactive-purge scoping is NOT the parser's job; it's handled in Task 3 by emitting purge ONLY from active/charged slots (Sefuba p2 is a passive → not emitted). Assert the 2-element result so the behavior is pinned and deliberate.
  Run → FAIL (`parsePurge` undefined).

- [ ] **Step 2: Implement `parsePurge`.** Mirror `parseCleanse` (study it first). Add near it:
```typescript
const PURGE_RE = /\bpurges?\s+(?:(\d+|all)|an?\b)/gi;
```
Function returns `{ count: number | 'all'; target: 'enemy' | 'all-enemies'; explicitTarget: boolean }[]`. For each match: capture group 1 is the count (`'all'`→`'all'`, digit→number); if group 1 is undefined the match was the `a`/`an` alternation → count 1. Skip on `count !== 'all' && (!count || isNaN(count))`. Target from the sentence (use the same `sentenceAround`/`stripUnitTags` helpers `parseCleanse` uses): `/all\s+enemies/` → `'all-enemies'`, else `'enemy'` (purge is enemy-only; `explicitTarget` true when "from (the/an) enemy/all enemies" matched, else false — keep the field for parity with parseCleanse even though purge has no support-flip). Do NOT match the passive-voice "is Purged of all buffs" form (Lodolite charge) — that's deferred to C2b; the `\bpurges?\b` active-verb anchor already excludes "is Purged".

- [ ] **Step 3:** Run the parser test → PASS. Confirm an existing cleanse test still passes (no cross-contamination).

- [ ] **Step 4: Byte-identical gate.** `parsePurge` is a pure unused function until Task 3 → full suite byte-identical. `npx vitest run`, lint/tsc/audit.

- [ ] **Step 5: Commit.**
```bash
git add -f src/utils/skillTextParser.ts src/utils/__tests__/skillTextParser.test.ts
git commit --no-verify -m "C2a T2: parsePurge parser (unwired)"
```

---

## Task 3: Emit purge abilities + wire the on-cast cast path + un-gate

**Files:** Modify `src/utils/abilities/buildShipAbilities.ts`, `src/utils/combat/playerTurn.ts`, `src/components/skills/simCoverage.ts`, `src/components/skills/__tests__/AbilityCard.test.tsx`; Test: a cast-path integration test + audited golden re-baseline.

This is the integration task. Emit, simulate, and un-gate land together.

- [ ] **Step 1: Write a failing integration test FIRST.** Build a two-team battle-sim scenario (model on the C1 `cleanseCastPath.test.ts` / `twoTeamBattle.test.ts` harness — note `healTargetId` MUST be set, which is what unlocks the enemy roster): an enemy actor that carries a removable SELF-buff (e.g. a start-of-round or on-cast `Attack Up`), and a player actor whose ACTIVE or CHARGED skill purges N buffs. After the player's turn, assert the enemy's buff is GONE from its self-buff store (via the snapshot/round-effects surface or `selfMaps.get(enemyId)`) and the purge removed the real count. Run → FAIL (purge does nothing today).

- [ ] **Step 2: Emit purge abilities** in `buildShipAbilities.ts` (mirror the cleanse emission block ~:1024-1042, but enemy-targeting and ACTIVE/CHARGED-SLOT-GATED):
```typescript
    // Emit purge ONLY from active/charged slots. Every reactive/conditional purge in the corpus
    // lives in a passive (Faust/Iridium/Cobalt-p2/Rhodium/Sefuba-p1-p2/Salvation/Lodolite-p1), so
    // this slot gate excludes them all WITHOUT needing purge-trigger detection (deferred to C2b),
    // and eliminates Sefuba-p2's "purges 1 more buff" double-emit.
    if (slot === 'active' || slot === 'charged') {
        for (const p of parsePurge(text)) {
            const purgePos = text.search(/purge/i);
            out.push({
                ability: {
                    id: nextId(),
                    type: 'purge',
                    target: p.target, // 'enemy' | 'all-enemies'
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'purge', count: p.count },
                    autoFilled: true,
                },
                pos: purgePos >= 0 ? purgePos : MAX_POS,
            });
        }
    }
```
Do NOT use `flipBareSupportTarget` (purge is enemy-only). Import `parsePurge`. CONFIRM `slot` is the in-scope per-slot discriminant here (the cleanse block uses it via `flipBareSupportTarget(c.target, c.explicitTarget, slot, ...)`) and that its values are `'active'`/`'charged'`/passive-variants — match the actual slot type. If the slot value for passives differs from what you expect, report and adapt the gate to "active or charged only".

- [ ] **Step 3: Wire the on-cast purge firing** in `playerTurn.ts`. Place a NEW pass AFTER `gatedSkill` is constructed (~:1149) — a natural spot is just before the `if (args.healing)` block (~:1387). It is UNCONDITIONAL (NOT inside `if(args.healing)`) and SIDE-SYMMETRIC (keys off `targetId`, the acting actor's opposing target — correct for both player and enemy casters; no `healEventOnly` gate):
```typescript
    // On-cast purge (C2a): remove buffs from the acting actor's target. Keyed off targetId
    // (the opposing victim) → side-symmetric. gatedSkill holds the fired slot's abilities.
    // DPS mode (dummy target, no buffs) → no-op → byte-identical.
    if (targetId !== undefined) {
        for (const ab of gatedSkill?.abilities ?? []) {
            if (ab.config.type === 'purge' && ab.trigger === 'on-cast') {
                // 'all-enemies' purges only the single targetId in C2a (single-anchor;
                // multi-victim AoE → sub-project E).
                statusEngine.purge(targetId, ab.config.count);
            }
        }
    }
```
CONFIRM `gatedSkill` (or the correct fired-skill-abilities binding) exists and is in scope at your chosen line, and that `ab.config.type`/`ab.trigger` are the right discriminants (read how `healAbilities` is built ~:1521 — it filters `gatedSkill?.abilities`). Do NOT add a `purge-performed` event (deferred to C2b). Report the exact line you placed it at.

- [ ] **Step 4: Un-gate purge.** In `src/components/skills/simCoverage.ts`, remove `'purge'` from `NOT_SIMULATED_TYPES` (leaving `'control'`). This un-greys purge in the coverage UI. **This breaks an existing test:** `src/components/skills/__tests__/AbilityCard.test.tsx` (~:487-491) asserts a purge ability renders the "not simulated" note. Update that test — the purge ability should no longer render the not-simulated note (its Count-field assertion stays valid). Read the test and adjust the assertion to match (purge is now simulated).

- [ ] **Step 5:** Run the integration test + the AbilityCard test → PASS.

- [ ] **Step 6: AUDITED re-baseline (judgment).** Run `npx vitest run`. Expect churn ONLY in two-team battle-sim goldens where an active/charged purge removes a real enemy self-buff (audit each: a buff that should now be gone is gone; downstream enemy damage/effect shifts consistent). For EACH churned snapshot, confirm the delta line-by-line before updating; NEVER blind `vitest -u`. If a purge fires where you don't expect (e.g. a passive purge leaked through the slot gate, or a ship's active-purge mis-parsed), STOP and report. NOTE: `audit:skills` does not measure purge (no rule in `scripts/auditSkills.ts`) → it will stay 0/141 trivially; still run it to confirm no regression.

- [ ] **Step 7:** `npm run lint` (0), `npx tsc --noEmit` (clean), `npm run audit:skills` (0/141).

- [ ] **Step 8: Commit** with the per-change justification list in the body:
```bash
git add -f src/utils/abilities/buildShipAbilities.ts src/utils/combat/playerTurn.ts src/components/skills/simCoverage.ts src/components/skills/__tests__/AbilityCard.test.tsx <test/snap files>
git commit --no-verify -m "C2a T3: emit + fire on-cast purge (active/charged, enemy buffs); un-gate; audited churn"
```

---

## Task 4: Changelog + closeout

- [ ] **Step 1:** Add a `UNRELEASED_CHANGES` entry in `src/constants/changelog.ts`, e.g. "Purge skills now actually remove buffs from the targeted enemy (newest first, keeping unremovable buffs like Magnetized Shielding) in the battle simulator, instead of being unsimulated."
- [ ] **Step 2: Full gate:** `npx vitest run` (green), `npm run lint` (0), `npx tsc --noEmit` (clean), `npm run audit:skills` (0/141).
- [ ] **Step 3: Commit.** `git add src/constants/changelog.ts && git commit --no-verify -m "C2a: changelog — purge removes enemy buffs"`

---

## Known limitations carried into C2b / later

- **Reactive purge ecosystem deferred to C2b:** `purge-performed` event, `on-ally-purged` (Salvation repair), `on-unit-purged` (Sefuba repair + the purge-chains-purge "purge 1 more" with its chain guard), and the `reactiveRecipients(intent, ctx)` helper extraction (heal+cleanse+purge).
- **Conditional/non-on-cast purges** (Faust on-death, Cobalt-p2 on-enemy-charged, Iridium on-attacked, Rhodium end-of-round) are emitted as `on-cast` in C2a (over-approximation) until C2b adds purge-trigger detection — verify in Task 3 this doesn't produce wrong goldens; scope the emit if it does.
- **AoE `all-enemies` purge** (Amartya) removes from only the single `targetId` (single-anchor); multi-victim → sub-project E.
- **Passive-voice "is Purged of all buffs" / most-buffs targeting** (Lodolite charge, Rhodium) not parsed in C2a.
