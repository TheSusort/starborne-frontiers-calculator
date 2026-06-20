# E3 — AoE on-cast purge over footprint victims — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make an on-cast purge whose ability `target` is `'all-enemies'` remove buffs from **every footprint victim** of the firing skill's pattern, instead of only the single resolved anchor victim.

**Architecture:** The on-cast purge in `playerTurn.ts` removes buffs from the single resolved anchor `targetId`. E3 threads an optional `aoeVictimIds: string[]` (the firing skill's footprint victim ids) into `runPlayerTurn` via `buildTurnArgs` (engine.ts) — which is spread into all three `runPlayerTurn` call sites (focus / team / enemy), so one change covers every direction. `buildTurnArgs` computes the footprint with the existing pure helper `footprintVictims(pattern, anchor, opposingRoster)` (already the authority for AoE *damage*) **only when positional** (`pattern`, `target` present AND the resolved target is a positioned actor); otherwise it stays `undefined`. The on-cast purge loop then routes `ab.target === 'all-enemies' && aoeVictimIds ? aoeVictimIds : [targetId]`, purging and emitting `purge-performed` **per victim**. Single-target (`'enemy'`) purges and all non-positional callers keep the single-anchor behaviour → **production byte-identical**.

**Tech Stack:** TypeScript, Vitest. Combat engine (`src/utils/combat/`).

**Spec:** `docs/superpowers/specs/2026-06-19-per-victim-aoe-accounting-E-design.md` (§4 row E3, §"E3 — AoE purge/cleanse").

**Branch:** `feat/combat-sim-aoe-purge-E3` (off `main` post-#117; E3 is Thread-2, independent of E1/E2 — see spec §4).

---

## Grounding facts (verified on this branch, 2026-06-19)

- **The only AoE purge in the corpus is Amartya** ("purges 1 buff from all enemies for every 50% crit power"). `parsePurge` (`skillTextParser.ts:2135`) already emits `target: 'all-enemies'` for "from all enemies"; every other purge emits `target: 'enemy'` (single). Amartya's **crit-power count scaling** is **deferred to E4** — E3 builds the multi-victim routing that E4 rides, and ships at Amartya's parsed count (`1`). **No existing fixture/golden carries an `'all-enemies'` purge**, so this PR is production byte-identical.
- **On-cast purge site:** `src/utils/combat/playerTurn.ts:1386-1416`. Loops `gatedSkill?.abilities`, fires on `ab.config.type === 'purge' && ab.trigger === 'on-cast' && conditionsMet(...)`, calls `statusEngine.purge(targetId, ab.config.count)`, emits `purge-performed` when `removed > 0`. **Side-symmetric** (keyed off `targetId`, no `healEventOnly` gate → fires for player AND enemy casters). `ab.target` is a top-level `Ability` field (e.g. `'all-enemies' | 'enemy' | 'enemy-most-buffs'`).
- **Ability shape** (`buildShipAbilities.ts:1093-1104`): `{ id, type:'purge', target, trigger, conditions, config:{type:'purge', count}, autoFilled }`. So the loop reads `ab.config.type`, `ab.config.count`, `ab.trigger`, `ab.conditions`, and `ab.target`.
- **`buildTurnArgs`** (`src/utils/combat/engine.ts:2670-2711`) builds the full `runPlayerTurn` arg object for any side, folding per-side divergence via `turnBindings(a.side)`. It is spread (`...buildTurnArgs(actor, tgt)`) into all three `runPlayerTurn` sites: **focus 3262, team 3463, enemy 3712**. In scope: `parsedPatternFor(a)` (2589), `parsedTargetFor(a)` (2584), `tb.opposingRoster`, and (after T2) `footprintVictims`.
- **`selectTurnTarget`** (engine.ts:2645) returns `{ tgt: selected ?? tb.legacyVictim }`. When **positional**, `tgt` is the resolved positioned enemy (`tgt.position != null`). When **non-positional** (DPS/healing-single), `tgt` is the legacy dummy/heal-target (`tgt.position == null`). So **`tgt.position != null` is the positional discriminator** → guarantees `aoeVictimIds === undefined` for every existing fixture.
- **`footprintVictims(pattern, anchor, opposingLiving)`** (`src/utils/combat/positionalApply.ts:37`) → `FootprintHit[]` (`{ victim, roleScale }`), living positioned actors ≤1/cell, includes the origin (anchor) cell. **Pure** geometry+roster; already the per-hit authority inside `applyPositionalDamage`. `roleScale` is irrelevant to status removal (covered cells are 50% *damage only*; purge/buff/debuff is **uniform** across the footprint — board-geometry resolver locked rule). Currently imported into engine.ts as: `import { applyPositionalDamage } from './positionalApply';` (engine.ts:46) — **must add `footprintVictims`**.
- **`statusEngine.purge(actorId, count)`** (`src/utils/combat/statusEngine.ts`) removes ≤`count` removable buffs newest-first (skips `UNREMOVABLE_STATUSES`/`'permanent'`), returns count removed, unknown id → `0`.
- **NO change** needed at the other status-removal sites (verified, documented in T4):
  - *Reactive purge* (`triggers.ts`, executor `cfg.type==='purge'`): targets are `'enemy-most-buffs'` (Rhodium) or `counterTargetId ?? enemyId` (Iridium counter-attacker / Faust killer) — **inherently single-target**; no `'all-enemies'` reactive purge exists in the corpus, and the footprint (pattern + opposing roster) is **not reachable at drain time**.
  - *End-of-round purge* (Rhodium, engine round tail): drains the reactive queue; same single-`enemy-most-buffs` target.
  - *Cleanse* (on-cast `playerTurn.ts`, reactive `triggers.ts`): already loops `recipientsFor(ability.target)` / `reactiveRecipients(...)`. Cleanse targets **allies**; `'all-allies'` = the whole team (not a footprint) — already correct.

---

## File structure

- **Modify** `src/utils/combat/playerTurn.ts` — add optional `aoeVictimIds?: string[]` to `PlayerTurnArgs`; route the on-cast purge over it for `'all-enemies'` targets.
- **Modify** `src/utils/combat/engine.ts` — add `footprintVictims` to the `positionalApply` import; compute + return `aoeVictimIds` in `buildTurnArgs`.
- **Create** `src/utils/combat/__tests__/aoePurge.test.ts` — integration coverage (mirrors `purgeCastPath.test.ts`).
- **Modify** `docs/superpowers/specs/2026-06-19-per-victim-aoe-accounting-E-design.md` — E3 closeout note.
- **Modify** `src/constants/changelog.ts` — `UNRELEASED_CHANGES` entry.

---

## Gate (every task, before any "done"/commit)

- `npx vitest run <file>` for the touched test(s) — **bare `npm test` is watch mode and hangs**.
- Production **byte-identical**: `git status` shows **zero `.snap` movement**; if any golden moves, the positional gate leaked — fix it, **never `vitest -u`**.
- Final task only: full suite `npx vitest run`, `npm run lint` (max-warnings 0), `npx tsc --noEmit` clean, `npm run audit:skills` (0 findings / 141 ships).
- **ALWAYS run `npx tsc --noEmit` independently** after subagent work — vitest/esbuild does not typecheck.

---

### Task 0: Baseline

**Files:** none.

- [ ] **Step 1: Confirm the branch + clean tree**

Run: `git branch --show-current && git status --porcelain`
Expected: `feat/combat-sim-aoe-purge-E3`, empty status.

- [ ] **Step 2: Confirm the suite is green at baseline**

Run: `npx vitest run src/utils/combat/__tests__/purgeCastPath.test.ts`
Expected: PASS (5 tests). This is the harness Task 1 mirrors.

---

### Task 1: Failing integration test — AoE purge hits all footprint enemies

**Files:**
- Create: `src/utils/combat/__tests__/aoePurge.test.ts`

This mirrors `purgeCastPath.test.ts` but uses **two** positioned enemies and an **`all`-shape pattern** on the player focus so the footprint covers both, and an `'all-enemies'` purge ability. On current code the purge hits only the single anchor → the "both purged" assertion FAILS.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';
import type { StatusEngine } from '../statusEngine';

// ---------------------------------------------------------------------------
// E3: an on-cast purge with ability target 'all-enemies' removes buffs from
// EVERY footprint victim, not just the single resolved anchor.
//
// Harness mirrors purgeCastPath.test.ts (positional two-team battle-sim:
// healTargetId set unlocks the enemy roster; the focus needs position + parsed
// target so selectTurnTarget resolves a REAL enemy as the anchor `targetId`).
// TWO enemies (M4 front + M3) each self-buff "Attack Up" every round. The focus
// fires an 'all'-shape pattern (footprint = all living enemies), so the footprint
// covers BOTH. The control uses a single-'enemy' purge (anchor only).
// ---------------------------------------------------------------------------
let idc = 0;
const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `e3p${++idc}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...p,
});

const parsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});

// 'all'-shape pattern → resolveCells returns all 12 cells as origin (board-geometry
// resolver: "`all` shape returns all 12 as origin ignoring anchor") → footprintVictims
// returns every living enemy.
const allPattern = (): ParsedPattern => ({ raw: 'all', shape: 'all', range: 'all', modifiers: {} });

const attackUp = (): Ability =>
    ab({
        type: 'buff',
        target: 'self',
        config: {
            type: 'buff',
            buffName: 'Attack Up',
            parsedEffects: { attack: 30 },
            stacks: 1,
            isStackable: false,
            duration: 99,
        },
    });

const hit = (): Ability =>
    ab({ type: 'damage', target: 'enemy', config: { type: 'damage', multiplier: 100 } });

// An enemy that self-buffs "Attack Up" each round then hits. speed 200 > focus 100 so
// the enemies act FIRST (apply their buffs) before the focus purges this round.
const buffingEnemy = (id: string, position: Position) => ({
    id,
    stats: { attack: 1000, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000_000, speed: 200 },
    chargeCount: 0,
    startCharged: false,
    position,
    target: parsedTarget('front'),
    pattern: allPattern(),
    shipSkills: { slots: [{ slot: 'active' as const, abilities: [attackUp(), hit()] }] },
});

// Player focus: an 'all-enemies' (AoE) or single-'enemy' purge active + a basic hit so it
// fires positionally.
const focusSkills = (aoe: boolean): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                ab({
                    type: 'purge',
                    target: aoe ? 'all-enemies' : 'enemy',
                    config: { type: 'purge', count: 5 },
                }),
                hit(),
            ],
        },
    ],
});

const BASE = (aoe: boolean): CombatEngineInput => ({
    attack: 5000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: focusSkills(aoe),
    enemyDefense: 0,
    enemyHp: 1_000_000_000,
    numRounds: 3,
    selfBuffs: [],
    enemyDebuffs: [],
    selfDotModifier: 0,
    defensePenetrationBuff: 0,
    hasChargedSkill: false,
    startCharged: false,
    affinityDamageModifier: 0,
    affinityCritCap: 100,
    affinityCritPenalty: 0,
    defence: 0,
    hp: 1_000_000_000, // focus immortal so the battle runs all rounds
    healTargetId: 'attacker',
    position: 'M4',
    target: parsedTarget('front'),
    pattern: allPattern(), // focus AoE pattern → footprint = all living enemies
    enemyAttackers: [buffingEnemy('enemy-front', 'M4'), buffingEnemy('enemy-back', 'M3')],
});

const finalSelfBuffs = (aoe: boolean, enemyId: string): string[] => {
    idc = 0;
    let engine: StatusEngine | undefined;
    runCombat({
        ...BASE(aoe),
        __testTapStatusEngine: (e) => {
            engine = e;
        },
    });
    return engine!.timedAbilityStatuses('self', enemyId).map((b) => b.active.buffName);
};

describe('E3: on-cast all-enemies purge removes buffs from every footprint victim', () => {
    it('an all-enemies purge strips the self-buff from BOTH enemies', () => {
        expect(finalSelfBuffs(true, 'enemy-front')).toEqual([]);
        expect(finalSelfBuffs(true, 'enemy-back')).toEqual([]);
    });
});
```

- [ ] **Step 2: Run the test to verify it fails on the multi-victim assertion**

Run: `npx vitest run src/utils/combat/__tests__/aoePurge.test.ts`
Expected: FAIL — `enemy-front` is purged (`[]`) but `enemy-back` keeps `['Attack Up']` (single-anchor today). Confirm the failure is the `enemy-back` expectation, NOT a harness/setup error (if `enemy-front` is also non-empty, the positional anchor resolution is wrong — fix the test before proceeding).

- [ ] **Step 3: Commit the red test**

```bash
git add -f docs/superpowers/plans/2026-06-19-per-victim-aoe-E3-aoe-purge.md
git add src/utils/combat/__tests__/aoePurge.test.ts
git commit -m "test(combat): E3 — failing AoE-purge multi-victim test (red)"
```
(Plan is gitignored under `docs/` → `git add -f`; commit with `--no-verify` only if the pre-commit hook blocks on the not-yet-passing test — but prefer keeping the red commit local; if the hook runs the full suite and fails, use `git commit --no-verify`.)

---

### Task 2: Thread `aoeVictimIds` and route the all-enemies purge over it (green)

**Files:**
- Modify: `src/utils/combat/engine.ts:46` (import), `:2670-2711` (`buildTurnArgs`)
- Modify: `src/utils/combat/playerTurn.ts:~252` (`PlayerTurnArgs`), `:~609` (destructure), `:1386-1416` (purge loop)

- [ ] **Step 1: Add `footprintVictims` to the engine import**

`src/utils/combat/engine.ts:46` — change:
```typescript
import { applyPositionalDamage } from './positionalApply';
```
to:
```typescript
import { applyPositionalDamage, footprintVictims } from './positionalApply';
```

- [ ] **Step 2: Compute + return `aoeVictimIds` in `buildTurnArgs`**

`src/utils/combat/engine.ts` — inside `buildTurnArgs` (just after `const maxHp = rt.hp;` at ~2673), add:
```typescript
            // E3 (AoE purge): footprint victim ids for an 'all-enemies' on-cast purge.
            // Computed ONLY when positional — `tgt.position != null` is the positional
            // discriminator (selectTurnTarget returns the dummy/heal-target sink, which has
            // no position, in DPS/healing-single mode). footprintVictims is the same pure
            // resolver the AoE damage path uses; covered cells are included (status removal is
            // uniform across the footprint, unlike the 50% damage scale). Non-positional →
            // undefined → the playerTurn purge loop falls back to the single anchor →
            // byte-identical. The purge ability gates on `target === 'all-enemies'`, so single-
            // 'enemy' purges ignore this regardless.
            const aoePattern = parsedPatternFor(a);
            const aoeTarget = parsedTargetFor(a);
            const aoeVictimIds =
                aoePattern != null && aoeTarget != null && tgt.position != null
                    ? footprintVictims(aoePattern, tgt.position, tb.opposingRoster).map(
                          (h) => h.victim.id
                      )
                    : undefined;
```
Then add to the returned object literal (alongside the other conditional spreads, e.g. after the `targetId` spread at ~2684):
```typescript
                ...(aoeVictimIds ? { aoeVictimIds } : {}),
```

- [ ] **Step 3: Add `aoeVictimIds` to `PlayerTurnArgs` and destructure it**

`src/utils/combat/playerTurn.ts` — in `interface PlayerTurnArgs` (near `targetId?: string;` at ~252), add:
```typescript
    /**
     * E3 (AoE purge): the firing skill's footprint victim ids, supplied by the engine in
     * positional mode. The on-cast purge fans an 'all-enemies' purge over these instead of the
     * single `targetId`. Absent for non-positional callers → single-anchor (byte-identical).
     */
    aoeVictimIds?: string[];
```
And add `aoeVictimIds` to the args destructure (near `targetId,` at ~609):
```typescript
        aoeVictimIds,
```

- [ ] **Step 4: Route the on-cast purge over the footprint victims**

`src/utils/combat/playerTurn.ts:1392-1416` — replace the purge block body. New version:
```typescript
    if (targetId !== undefined) {
        for (const ab of gatedSkill?.abilities ?? []) {
            if (
                ab.config.type === 'purge' &&
                ab.trigger === 'on-cast' &&
                conditionsMet(ab.conditions, ctx)
            ) {
                // E3: an 'all-enemies' purge fans out to EVERY footprint victim (aoeVictimIds,
                // supplied by the engine in positional mode). Single-'enemy' purges — and any
                // caller without a footprint (non-positional) — stay on the single anchor
                // `targetId`. Each victim emits its own purge-performed (Salvation/Sefuba are
                // victim-scoped). (Amartya's per-victim COUNT scaling is E4; this ships at the
                // parsed count.)
                const recipients =
                    ab.target === 'all-enemies' && aoeVictimIds ? aoeVictimIds : [targetId];
                for (const vid of recipients) {
                    const removed = statusEngine.purge(vid, ab.config.count);
                    if (removed > 0) {
                        bus.emit({
                            type: 'purge-performed',
                            casterId: actor.id,
                            targetId: vid,
                            count: removed,
                            round: r,
                        });
                    }
                }
            }
        }
    }
```

- [ ] **Step 5: Run the Task-1 test — verify it passes**

Run: `npx vitest run src/utils/combat/__tests__/aoePurge.test.ts`
Expected: PASS (both enemies `[]`).

- [ ] **Step 6: Verify production byte-identical + typecheck**

Run: `npx vitest run src/utils/combat/__tests__/purgeCastPath.test.ts src/utils/combat/__tests__/twoTeamBattle.test.ts src/utils/combat/__tests__/positionalDamage.integration.test.ts && git status --porcelain | grep '\.snap' || echo "NO SNAP MOVEMENT"`
Expected: all PASS, `NO SNAP MOVEMENT`.

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/utils/combat/engine.ts src/utils/combat/playerTurn.ts
git commit -m "feat(combat): E3 — route on-cast all-enemies purge over footprint victims"
```

---

### Task 3: Broaden coverage — control, side-symmetry, per-victim count, single-target safety

**Files:**
- Modify: `src/utils/combat/__tests__/aoePurge.test.ts`

Add these `it` blocks / a side-symmetry `describe` using the same harness. Each is one assertion of an independent guarantee.

- [ ] **Step 1: CONTROL — a single-'enemy' purge hits only the anchor**

```typescript
    it('CONTROL: a single-enemy purge strips only the anchor (front-most), not the back enemy', () => {
        expect(finalSelfBuffs(false, 'enemy-front')).toEqual([]); // anchor purged
        expect(finalSelfBuffs(false, 'enemy-back')).toEqual(['Attack Up']); // untouched
    });
```

- [ ] **Step 2: Per-victim count is honoured independently**

Add a variant where each enemy carries TWO removable buffs and the purge count is 1 → each enemy loses exactly one (newest-first), proving the count applies per victim (not pooled). (Extend `buffingEnemy` with a second self-buff via a small local helper, or add a second `describe` block modelled on the `count:'all'` suite in `purgeCastPath.test.ts`.) Assert both enemies retain exactly one buff after a `count:1` all-enemies purge.

- [ ] **Step 3: SIDE-SYMMETRY — an enemy all-enemies purge strips both players**

Add a `describe` mirroring the side-symmetry suite in `purgeCastPath.test.ts`: TWO player actors (the focus `attacker` at M4 + a team actor at M3) each self-buff "Attack Up"; a single ENEMY at M4 fires an `'all-enemies'` purge with an `all`-shape pattern (speed < players so it purges after they buff). Assert BOTH players' self-buff stores are emptied. Read player team-actor stores via `timedAbilityStatuses('self', <teamActorId>)`. (If wiring a second player team actor is heavy, this can instead assert the focus alone is purged via the enemy path — but prefer the two-player form to actually exercise multi-victim on the enemy side.)

- [ ] **Step 4: Run the file — all green**

Run: `npx vitest run src/utils/combat/__tests__/aoePurge.test.ts`
Expected: PASS (all blocks).

- [ ] **Step 5: Commit**

```bash
git add src/utils/combat/__tests__/aoePurge.test.ts
git commit -m "test(combat): E3 — control, per-victim count, side-symmetry coverage"
```

---

### Task 4: Documentation, no-change site notes, changelog, spec closeout

**Files:**
- Modify: `src/utils/combat/playerTurn.ts` (purge comment refresh)
- Modify: `src/utils/combat/triggers.ts` (reactive purge — one-line "single-target by design" note)
- Modify: `src/utils/combat/engine.ts` (end-of-round purge — one-line note, optional)
- Modify: `docs/superpowers/specs/2026-06-19-per-victim-aoe-accounting-E-design.md`
- Modify: `src/constants/changelog.ts`

- [ ] **Step 1: Refresh the on-cast purge comment**

In `playerTurn.ts` purge block: the stale C2a line `'all-enemies' purges only the single targetId in C2a (single-anchor; multi-victim AoE → sub-project E).` was replaced by the E3 routing comment in Task 2 — confirm no other comment still claims single-anchor AoE. The header comment (`On-cast purge (C2a/C2b-3)...`) can gain "E3: all-enemies fans over the footprint" for accuracy.

- [ ] **Step 2: Annotate the no-change sites**

Add a one-line comment at the **reactive purge** executor (`triggers.ts`, `cfg.type==='purge'` branch) noting it is single-target by design (counter-attacker / killer / most-buffs); no `'all-enemies'` reactive purge exists and the footprint is unreachable at drain time (out of E3 scope). Optionally the same at the end-of-round (Rhodium) drain. Do NOT change behaviour.

- [ ] **Step 3: Spec closeout**

Append to the spec's "E3 — AoE purge/cleanse" section an **`> E3 SHIPPED`** note (mirroring the E1/E2 notes): on-cast `'all-enemies'` purge now fans over the footprint via `footprintVictims` threaded through `buildTurnArgs` → `aoeVictimIds`; single-`enemy` purges, cleanse (already loops all-allies), reactive + end-of-round purges (single-target by design) unchanged; production byte-identical (no `'all-enemies'`-purge fixture); Amartya count-scaling still deferred to E4.

- [ ] **Step 4: Changelog**

Add a plain-English entry to `UNRELEASED_CHANGES` in `src/constants/changelog.ts`, e.g.: *"Combat simulator: area-of-effect purge skills now remove buffs from every enemy they hit, not just the primary target."*

- [ ] **Step 5: Final full gate**

Run: `npx vitest run`
Expected: full suite green (baseline + the new `aoePurge.test.ts` cases; **zero `.snap` movement**).

Run: `npm run lint && npx tsc --noEmit && npm run audit:skills`
Expected: lint 0 warnings, tsc clean, audit 0 findings / 141 ships.

Run: `git status --porcelain | grep '\.snap' || echo "NO SNAP MOVEMENT"`
Expected: `NO SNAP MOVEMENT`.

- [ ] **Step 6: Commit**

```bash
git add src/utils/combat/playerTurn.ts src/utils/combat/triggers.ts src/utils/combat/engine.ts src/constants/changelog.ts
git add -f docs/superpowers/specs/2026-06-19-per-victim-aoe-accounting-E-design.md
git commit -m "docs(combat): E3 — changelog, no-change-site notes, spec closeout"
```

---

## Out of scope (deferred, per spec §4 / §6)

- **Amartya per-victim count scaling** `count = floor(critDamage / 50)` → **E4** (builds on this multi-victim loop).
- **Reactive / end-of-round AoE purge** — no corpus case; footprint unreachable at drain time.
- **Per-victim leech / intake accounting** → E1/E2 (shipped, separate PRs #122/#123).
- **Per-victim repair (Nayra) + credit unification** → E5.
