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

- **Firing site:** the cast path's `timedEnemyBySlot` enemy-debuff loop region (`playerTurn.ts` ~:884-903) runs in ALL modes and has the resolved `targetId` in scope. Add a sibling pass over the fired slot's on-cast purge abilities there, calling `statusEngine.purge(targetId, count)`. (NOT the `healAbilities` block — that's `if(args.healing)`-gated and ally-targeting.)
- **Target store:** an enemy's buffs are its self-buffs → `selfMaps.get(targetId)` / `accumSelfMaps.get(targetId)`. `purge(targetId, count) = removeNewestFirst(targetId, 'buffs', count)` removes them.
- **Golden gate:** DPS mode byte-identical (dummy enemy has no buffs → purge no-op). Healing mode: the heal-target's enemy attackers may carry self-buffs, but the focus healer's `targetId`/whether it casts a purge — purge engages only if a purge ship is present; existing healing goldens have no purge ship → byte-identical. **Two-team battle-sim goldens** (twoTeamBattle/positionalDamage/dpsSimulator-multi) WILL churn where a purge ship removes a real enemy buff → AUDITED, never blind `vitest -u`.
- **`'all'` count** already supported by the type/primitive (C1 widened `count: number | 'all'`). `parsePurge` emits `'all'` for "purges all buffs".
- **No reactive purge** in C2a → no `purge-performed` event, no chain guard needed yet.

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

**Files:** Modify `src/utils/abilities/buildShipAbilities.ts`, `src/utils/combat/playerTurn.ts`, `src/components/skills/simCoverage.ts`; Test: a cast-path integration test + audited golden re-baseline.

This is the integration task. Emit, simulate, and un-gate must land together so emitted purge abilities are immediately simulated (no "emitted-but-not-simulated" intermediate that could trip `audit:skills`).

- [ ] **Step 1: Write a failing integration test FIRST.** Build a two-team battle-sim scenario (model on the C1 `cleanseCastPath.test.ts` / `twoTeamBattle` harness): an enemy actor that carries a removable SELF-buff (e.g. a start-of-round or on-cast `Attack Up`), and a player actor whose active/charged skill purges N buffs. After the player's turn, assert the enemy's buff is GONE from `selfMaps.get(enemyId)` (or via the snapshot/round-effects surface) and the purge removed the real count. Run → FAIL (purge does nothing today).

- [ ] **Step 2: Emit purge abilities** in `buildShipAbilities.ts` (mirror the cleanse emission block ~:1024-1042, but enemy-targeting):
```typescript
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
```
Do NOT use `flipBareSupportTarget` (purge is enemy-only, never an ally-support flip). Import `parsePurge`. NOTE: C2a only FIRES on-cast purges; a conditional/reactive purge (Faust on-death etc.) would also be emitted here with `trigger:'on-cast'` since C2a doesn't parse purge triggers — that is acceptable for C2a (it means e.g. Faust's on-death purge would fire on-cast instead, a known over-approximation). If this causes audit/golden issues for a specific conditional-purge ship, prefer scoping the emit to active/charged-skill text or add a brief `detect`-guard; report what you do. (C2b adds real purge-trigger detection.)

- [ ] **Step 3: Wire the on-cast purge firing** in `playerTurn.ts`, in the enemy-target region right after the `timedEnemyBySlot` loop (~:903), where `targetId`, `actor`, `action`, `statusEngine`, and the fired skill's abilities are in scope. Collect the fired slot's on-cast purge abilities and apply:
  - Determine the source of the acting skill's abilities for the fired slot (the same source `timedEnemyBySlot` / `healAbilities` derive from — likely `gatedSkill?.abilities`). Filter `a.config.type === 'purge'` with `trigger === 'on-cast'`.
  - Guard with `if (targetId !== undefined)` (DPS/standalone callers without a real target are inert → byte-identical).
  - For each, `purgedCount += statusEngine.purge(targetId, a.config.count)`. (For `target:'all-enemies'`, C2a still purges only the single `targetId` — single-anchor; multi-victim is sub-project E. Add a one-line comment noting the AoE deferral.)
  - Do NOT add a `purge-performed` event (deferred to C2b).
  Confirm the exact ability source + slot-gating by reading how `timedEnemyBySlot` and `healAbilities` are built; match that pattern. If the on-cast purge ability isn't reachable in that scope, find where the fired-skill abilities are and place the loop accordingly — report the exact site you chose.

- [ ] **Step 4: Un-gate purge.** In `src/components/skills/simCoverage.ts`, remove `'purge'` from `NOT_SIMULATED_TYPES` (leaving `'control'`). This un-greys purge in the coverage UI.

- [ ] **Step 5:** Run the integration test → PASS.

- [ ] **Step 6: AUDITED re-baseline (judgment).** Run `npx vitest run`. Expect churn in two-team battle-sim goldens where a purge ship removes a real enemy buff (audit each: a buff that should now be gone is gone; downstream enemy damage/effect shifts consistent). Also: parsing purge now EMITS purge abilities for ~15 ships → `audit:skills` must STAY 0/141 (the new abilities are now simulated, not findings). If `audit:skills` reports a finding or a purge ship's text now mis-parses, investigate. If a previously-allowlisted "unparsed purge" entry exists, update it. Keep a written per-change justification list. NEVER blind `vitest -u`. If you find unexplained churn (e.g. a purge firing where the ship's purge is actually conditional/reactive, per the Step-2 note), STOP and report — we may need to scope the emit.

- [ ] **Step 7:** `npm run lint` (0), `npx tsc --noEmit` (clean), `npm run audit:skills` (0/141).

- [ ] **Step 8: Commit** with the per-change justification list in the body:
```bash
git add -f src/utils/abilities/buildShipAbilities.ts src/utils/combat/playerTurn.ts src/components/skills/simCoverage.ts <test/snap files>
git commit --no-verify -m "C2a T3: emit + fire on-cast purge (enemy buffs); un-gate; audited churn"
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
