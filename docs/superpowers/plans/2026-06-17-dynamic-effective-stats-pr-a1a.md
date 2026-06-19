# Dynamic Effective-Stats — PR A1a (accessor, unread) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce a unified per-actor effective-stats fold (`effectiveStatsOf`) that reproduces the engine's existing piecemeal stat folds, written *alongside* the existing code with **no consumer reading it yet** — provably byte-identical.

**Architecture:** Generalize the existing `foldSpeedBuffPct` (which folds only `.speedBuff` from an actor's two live-buff sources) into `foldActorBuffTotals` (the full `calculateBuffTotals` shape), then build `effectiveStatsOf(statusEngine, selfBuffLookup, actor)` that applies those folded deltas to the actor's base `ActorStats`. Add `hacking`/`security` as optional `ActorStats` fields carried as **base pass-through** (their buff-fold pipeline + dynamic landing land in A2, where they're consumed). Nothing reads the new accessor in this PR; A1b migrates consumers.

**Tech Stack:** TypeScript, Vitest. Combat engine in `src/utils/combat/`.

**Spec:** `docs/superpowers/specs/2026-06-17-dynamic-effective-stats-design.md` (sub-project A). Epic: `docs/superpowers/specs/2026-06-17-combat-realism-epic-roadmap.md`.

**Golden gate:** BYTE-IDENTICAL. No consumer reads the new accessor and the new `ActorStats` fields are unread, so DPS + healing snapshots must not move. If any `.snap` moves, a consumer leaked in — fix the seam, never `vitest -u`.

**Scope boundaries (do NOT do these in A1a):**
- No `calculateBuffTotals` / `Buff.stat` / `toSimBuffs` / `ParsedBuffEffects` / parser changes — the hacking/security buff-FOLD pipeline + its parser emission is **A2** (it has no consumer until A2 and needs parser work). In A1a, `effectiveStatsOf` carries hacking/security as base pass-through (`actor.stats.hacking ?? 0`), unfolded.
- No `shieldPenetration` in `EffectiveStats` — the shield-pen split is sub-project **H**.
- No consumer migration — that's A1b.

**Workflow:** Work on the **main checkout** (branch `feat/combat-sim-phase5-pr2`) — do NOT create a fresh worktree (esbuild crash). `gh auth switch --hostname github.com --user TheSusort` only for PR ops.

**Test runner note:** bare `npm test` runs Vitest in **watch mode** and will hang an agent. Always use the `--run` (single-pass) form below.
- Single test file: `npx vitest run <pathOrName>`
- Full suite: `npx vitest run`
- Types: `npx tsc --noEmit` · Lint: `npm run lint` · Skills: `npm run audit:skills`

---

## File Structure

- `src/utils/combat/state.ts` — add optional `hacking`/`security` to `ActorStats`. (createActor unchanged — it passes `stats` through.)
- `src/utils/combat/effectiveStats.ts` — **NEW**: `EffectiveStats` type, `foldActorBuffTotals`, `effectiveStatsOf`. Focused new module (engine.ts imports it in A1b).
- `src/utils/combat/effectiveStats.test.ts` — **NEW** co-located characterization tests.
- `src/utils/combat/engine.ts` — refactor `foldSpeedBuffPct` to delegate to `foldActorBuffTotals` (keeps its export + behavior); thread `hacking` onto the walked-team construction site (the only site with a base value). No other engine changes.

---

## Task 1: Add optional `hacking`/`security` to `ActorStats` + thread the team base value

**Files:**
- Modify: `src/utils/combat/state.ts:79-87` (`ActorStats`)
- Modify: `src/utils/combat/engine.ts` (walked-team construction ~1175-1207)
- Test: `src/utils/combat/__tests__/actorStats.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { createActor } from '../state';

describe('ActorStats — hacking/security', () => {
    it('carries hacking/security when supplied', () => {
        const a = createActor({
            id: 'x', side: 'player', kind: 'team',
            stats: { attack: 0, crit: 0, critDamage: 0, defensePenetration: 0, defence: 0, hp: 1, speed: 50, hacking: 120, security: 80 },
        } as any);
        expect(a.stats.hacking).toBe(120);
        expect(a.stats.security).toBe(80);
    });

    it('leaves hacking/security undefined when omitted (back-compat fixtures)', () => {
        const a = createActor({
            id: 'y', side: 'player', kind: 'team',
            stats: { attack: 0, crit: 0, critDamage: 0, defensePenetration: 0, defence: 0, hp: 1, speed: 50 },
        } as any);
        expect(a.stats.hacking).toBeUndefined();
        expect(a.stats.security).toBeUndefined();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run actorStats`
Expected: FAIL — `hacking` not assignable to `ActorStats` (tsc/runtime).

- [ ] **Step 3: Implement**

In `state.ts`, add OPTIONAL fields to `ActorStats` (optional so the many existing `ActorStats` fixtures don't need updating — undefined is treated as 0 by `effectiveStatsOf`):

```typescript
export interface ActorStats {
    attack: number;
    crit: number;
    critDamage: number;
    defensePenetration: number;
    defence: number;
    hp: number;
    speed: number;
    /** Live debuff-landing stat. Optional — undefined treated as 0. Buff-fold + dynamic landing land in A2. */
    hacking?: number;
    /** Live debuff-resist stat. Optional — undefined treated as 0. A2. */
    security?: number;
}
```

In `engine.ts`, the walked-team construction (the only site with a base value — `t.walk.stats.hacking` exists per `TeamActorEngineInput`) — add to the `t.walk ? { ... }` stats object:

```typescript
hacking: t.walk.stats.hacking,
// walk bundle has no `security` field today → leave undefined (A2 plumbs the input)
```

Do NOT touch the attacker, dummy-enemy, or enemy-attacker construction sites — they have no base hacking/security input today (only the derived `debuffLandingChance`).

- [ ] **Step 4: Verify pass + byte-identity**

Run: `npx vitest run actorStats` → PASS.
Run: `npx vitest run` → all green; **confirm zero `.snap` movement**: `git status --porcelain | grep '\.snap'` returns nothing.
Run: `npx tsc --noEmit` → clean.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(combat): A1a — optional hacking/security on ActorStats (pass-through); thread team base hacking"
```

---

## Task 2: Build `effectiveStats.ts` — `foldActorBuffTotals` + `effectiveStatsOf` (unread)

**Files:**
- Create: `src/utils/combat/effectiveStats.ts`
- Create: `src/utils/combat/effectiveStats.test.ts`
- Modify: `src/utils/combat/engine.ts:75-112` (`foldSpeedBuffPct` delegates)

- [ ] **Step 1: Write the failing characterization test**

Proves `effectiveStatsOf` reproduces the engine's existing piecemeal formulas:
`attack*(1+attackBuff/100)`, `defence*(1+defenceBuff/100)`, `crit+critBuff` (uncapped),
`critDamage+critDamageBuff`, `hp*(1+hpBuff/100)`, `speed*(1+speedBuff/100)`; and that
hacking/security pass through the base value unchanged (no fold in A1a).

**Reuse the StatusEngine + selfBuffLookup harness from `src/utils/combat/__tests__/effectiveSpeed.test.ts`** (it already sets up an actor with a self-buff and the lookup map — copy its `beforeEach`/builder verbatim). The buffs flow through the real `toSimBuffs` path; pick stats `toSimBuffs` already emits (attack/speed) for the non-zero asserts.

```typescript
import { describe, it, expect } from 'vitest';
import { effectiveStatsOf, foldActorBuffTotals } from '../effectiveStats';
import { foldSpeedBuffPct } from '../engine';
// + StatusEngine / selfBuffLookup harness mirrored from effectiveSpeed.test.ts

describe('effectiveStatsOf — characterization vs piecemeal formulas', () => {
    it('reproduces attack/speed folds and passes through unbuffed stats', () => {
        // harness: base attack 1000, speed 100, defence 200, hp 5000, crit 10, critDamage 50,
        //          hacking 120, security 80; self-buff granting attack +50 and speed +30.
        const { statusEngine, selfBuffLookup, actor } = buildHarness({
            base: { attack: 1000, crit: 10, critDamage: 50, defensePenetration: 0, defence: 200, hp: 5000, speed: 100, hacking: 120, security: 80 },
            selfBuffs: [{ stat: 'attack', value: 50 }, { stat: 'speed', value: 30 }],
        });

        const eff = effectiveStatsOf(statusEngine, selfBuffLookup, actor);

        expect(eff.attack).toBe(1000 * (1 + 50 / 100));   // 1500
        expect(eff.speed).toBe(100 * (1 + 30 / 100));      // 130 — must match effectiveSpeedOf
        // unbuffed stats pass through
        expect(eff.defence).toBe(200);
        expect(eff.crit).toBe(10);
        expect(eff.critDamage).toBe(50);
        expect(eff.hp).toBe(5000);
        // hacking/security are base pass-through in A1a (no fold yet)
        expect(eff.hacking).toBe(120);
        expect(eff.security).toBe(80);
    });

    it('treats undefined hacking/security as 0', () => {
        const { statusEngine, selfBuffLookup, actor } = buildHarness({
            base: { attack: 1000, crit: 0, critDamage: 0, defensePenetration: 0, defence: 0, hp: 1, speed: 50 },
            selfBuffs: [],
        });
        const eff = effectiveStatsOf(statusEngine, selfBuffLookup, actor);
        expect(eff.hacking).toBe(0);
        expect(eff.security).toBe(0);
    });

    it('foldActorBuffTotals.speedBuff equals legacy foldSpeedBuffPct', () => {
        const { statusEngine, selfBuffLookup, actor } = buildHarness({
            base: { attack: 1000, crit: 0, critDamage: 0, defensePenetration: 0, defence: 0, hp: 1, speed: 100 },
            selfBuffs: [{ stat: 'speed', value: 30 }],
        });
        expect(foldActorBuffTotals(statusEngine, selfBuffLookup, actor.id).speedBuff)
            .toBe(foldSpeedBuffPct(statusEngine, selfBuffLookup, actor.id));
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run effectiveStats`
Expected: FAIL — module `../effectiveStats` not found.

- [ ] **Step 3: Implement `effectiveStats.ts`**

Copy the import paths verbatim from `foldSpeedBuffPct` in `engine.ts`:
`toSimBuffs` from `../calculators/dpsBuffHelpers`, `SelectedGameBuff` from `../../types/calculator`,
`calculateBuffTotals` + `payloadToSelectedBuff` from `./playerTurn`, `StatusEngine` from `./statusEngine`,
`CombatActor` from `./state`.

```typescript
import { StatusEngine } from './statusEngine';
import { SelectedGameBuff } from '../../types/calculator';
import { CombatActor } from './state';
import { calculateBuffTotals, payloadToSelectedBuff } from './playerTurn';
import { toSimBuffs } from '../calculators/dpsBuffHelpers';

export interface EffectiveStats {
    attack: number;
    defence: number;
    /** crit + critBuff, BEFORE the affinity cap (cappedCrit stays at the consumer — it needs
     *  affinity context the snapshot doesn't carry). */
    crit: number;
    critDamage: number;
    defensePenetration: number;
    hp: number;       // pure pass-through (no in-fight HP buffs); never folded
    speed: number;
    hacking: number;  // base pass-through in A1a; buff-fold wired in A2
    security: number; // base pass-through in A1a; A2
}

/**
 * Sum an actor's live self-buff totals from the same two sources foldSpeedBuffPct uses
 * (scheduled self-buffs + timed ability statuses). Generalizes foldSpeedBuffPct to the full
 * calculateBuffTotals shape. Returns the calculateBuffTotals shape verbatim.
 */
export function foldActorBuffTotals(
    statusEngine: StatusEngine,
    selfBuffLookup: Map<string, SelectedGameBuff[]>,
    actorId: string
): ReturnType<typeof calculateBuffTotals> {
    const scheduledSelfBuffs = statusEngine.snapshot(actorId).activeSelfBuffs.flatMap((ab) => {
        const bufs = selfBuffLookup.get(ab.buffName) ?? [];
        return ab.stacks !== undefined
            ? ab.stacks > 0 ? bufs.map((b) => ({ ...b, stacks: ab.stacks! })) : []
            : bufs;
    });
    const timedEffects = statusEngine
        .timedAbilityStatuses('self', actorId)
        .map((s) => payloadToSelectedBuff(s.payload));
    const scheduled = calculateBuffTotals(toSimBuffs(scheduledSelfBuffs));
    const timed = calculateBuffTotals(toSimBuffs(timedEffects));
    // Sum the two sources field-by-field (mirrors foldSpeedBuffPct's scheduled+timed sum).
    // Build by iterating keys so this stays in lock-step with calculateBuffTotals' shape.
    const out = {} as ReturnType<typeof calculateBuffTotals>;
    (Object.keys(scheduled) as (keyof typeof scheduled)[]).forEach((k) => {
        out[k] = scheduled[k] + timed[k];
    });
    return out;
}

export function effectiveStatsOf(
    statusEngine: StatusEngine,
    selfBuffLookup: Map<string, SelectedGameBuff[]>,
    actor: CombatActor
): EffectiveStats {
    const t = foldActorBuffTotals(statusEngine, selfBuffLookup, actor.id);
    const s = actor.stats;
    return {
        attack: s.attack * (1 + t.attackBuff / 100),
        defence: s.defence * (1 + t.defenceBuff / 100),
        crit: s.crit + t.critBuff,                 // uncapped — cap stays at the consumer
        critDamage: s.critDamage + t.critDamageBuff,
        defensePenetration: s.defensePenetration,  // pen buffs fold elsewhere (A1b decides)
        hp: s.hp,                                   // pass-through, no HP fold
        speed: s.speed * (1 + t.speedBuff / 100),
        hacking: s.hacking ?? 0,                    // base pass-through (A2 folds)
        security: s.security ?? 0,                  // base pass-through (A2 folds)
    };
}
```

> If `ReturnType<typeof calculateBuffTotals>` indexing with the `Object.keys` reduce trips strict typing, fall back to summing each named field explicitly — but the keyed form keeps it DRY and in lock-step with `calculateBuffTotals`.

- [ ] **Step 4: Refactor `foldSpeedBuffPct` to delegate (parity, no behavior change)**

In `engine.ts`, replace `foldSpeedBuffPct`'s body with a delegation (import `foldActorBuffTotals` from `./effectiveStats`):

```typescript
export function foldSpeedBuffPct(
    statusEngine: StatusEngine,
    selfBuffLookup: Map<string, SelectedGameBuff[]>,
    actorId: string
): number {
    return foldActorBuffTotals(statusEngine, selfBuffLookup, actorId).speedBuff;
}
```

This keeps `effectiveSpeedOf` byte-identical while proving the generalization reproduces the legacy fold.

- [ ] **Step 5: Run tests to verify pass + byte-identity**

Run: `npx vitest run effectiveStats` → PASS.
Run: `npx vitest run` → all green; **zero `.snap` movement** (only engine change is `foldSpeedBuffPct` delegating to an equivalent helper).
Run: `npx tsc --noEmit` → clean.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(combat): A1a — effectiveStatsOf + foldActorBuffTotals (unread); foldSpeedBuffPct delegates"
```

---

## Task 3: Full gate + byte-identity confirmation

**Files:** none (verification only).

- [ ] **Step 1: Run the full gate**

Run: `npx vitest run` → all green (baseline + new tests).
Run: `npm run lint` → 0 warnings.
Run: `npx tsc --noEmit` → clean.
Run: `npm run audit:skills` → 0 findings / 141 ships.

- [ ] **Step 2: Confirm zero golden movement**

Run: `git status --porcelain | grep -c '\.snap'`
Expected: `0`. If non-zero, a consumer leaked into the new accessor — investigate and fix the seam; do NOT update snapshots.

- [ ] **Step 3: Confirm clean tree**

```bash
git status   # clean after the per-task commits
```

---

## Done criteria (A1a)
- `effectiveStatsOf` + `foldActorBuffTotals` exist, tested, and reproduce the legacy piecemeal folds (attack/defence/crit/critDamage/hp/speed); hacking/security are base pass-through.
- `hacking`/`security` are optional `ActorStats` fields; team base hacking threaded.
- `foldSpeedBuffPct` delegates to the generalized helper (proves parity).
- **No consumer reads `effectiveStatsOf`** → DPS + healing goldens byte-identical (zero `.snap`).
- Suite + lint + tsc + audit:skills all clean.

**Next:** A1b (migrate consumers — feed `effectiveAttack`/`effectiveDefence`/`cappedCrit` input/`effectiveSpeedOf`/HP% from `effectiveStatsOf`, byte-identical) then A2 (hacking/security fold pipeline + dynamic landing + affinity-on-hacking, audited).
