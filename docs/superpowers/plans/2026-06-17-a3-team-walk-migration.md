# A.3 — Buff-only Team-Actor → Walked-Path Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route every team actor through the walked `runPlayerTurn` path by synthesizing an empty-kit `walk` bundle at the `runCombat` entry, then delete the now-dead legacy non-walked-team branch + its `sourceFired` landing-hook carve-out.

**Architecture:** A new `runCombat`-entry normalizer attaches a synthesized empty-kit `walk` to any team actor lacking one (empty `ShipSkills`, neutral stats `hp 1`/`defence 0`/`hacking 200`, `hasChargedSkill = chargeCount > 0`). The walked path then handles them uniformly — `runPlayerTurn`'s action/charge logic is byte-identical to the legacy branch except the charge gate, which `hasChargedSkill = chargeCount > 0` reproduces exactly. Manual `selfBuffs`/`enemyDebuffs` already apply via `teamSources` + the walked path's internal `sourceFired`.

**Tech Stack:** TypeScript, Vitest. Combat engine in `src/utils/combat/`.

**Spec:** `docs/superpowers/specs/2026-06-17-a3-team-walk-migration-design.md`. Epic: `docs/superpowers/specs/2026-06-17-combat-realism-epic-roadmap.md`.

**Gate:** **AUDITED golden churn — NOT byte-identical.** This is the one A-item that legitimately changes behavior. Only the spec's deltas 1-3 may move a snapshot: (1) buff-only actors' enemy-debuff landing flips to their own chance (≈zero churn — defaults land at 1.0), (2) `RoundData.teamDamage` becomes `0` instead of `undefined`, (3) `runPlayerTurn` may add zero-damage turn events. **Audit every moved `.snap` line-by-line and justify it in the commit. Never blind `vitest -u`.** If a snapshot moves that deltas 1-3 don't explain — STOP and investigate.

**Workflow:** Main checkout, branch `feat/combat-sim-phase5-pr2` (no fresh worktree — esbuild crash, see memory). `gh auth switch --hostname github.com --user TheSusort` only for PR ops. Docs gitignored → `git add -f` + `--no-verify`.

**Test runner:** NEVER bare `npm test` (Vitest WATCH — hangs). Use `npx vitest run <name>` / `npx vitest run`; `npx tsc --noEmit`; `npm run lint` (max-warnings 0, EVERY task); `npm run audit:skills`.

---

## Coexistence note (read first)

A.2 Step 3 (removing the `liveLandingComputable` gate in `playerTurn.ts:699-721`) has **not** landed
(HEAD is "A.2 partial"). This migration does **not** depend on it. A synthesized actor has
`stats.hacking = 200`; the walked path either computes the live landing `(200 − security-default 100) = 1.0`
or, when the dummy enemy lacks a `security` base, falls back to the synthesized
`walk.debuffLandingChance` — which Task 2 sets to `1`. Both yield 1.0, so the migration is correct
whether or not A.2 fully lands later.

---

## File structure

- **Create:** none of substance beyond one small module + one helper:
  - `src/utils/abilities/configToSimInputs.ts` — add `buildEmptyShipSkills()` (alongside `buildDefaultShipSkills`).
  - `src/utils/combat/teamActorWalk.ts` — NEW: `synthesizeBuffOnlyWalk()` + `normalizeTeamActorsToWalked()`.
- **Modify:** `src/utils/combat/engine.ts` — call the normalizer at entry; delete the legacy branch + carve-out; collapse the `t.walk ? … : 1/0` ternaries.
- **Test:**
  - `src/utils/abilities/__tests__/configToSimInputs.test.ts` (create if absent) — `buildEmptyShipSkills`.
  - `src/utils/combat/__tests__/teamActorWalk.test.ts` — NEW: normalizer unit tests.
  - Existing combat goldens (`dpsGoldenParity`, `engine.events`, `triggers`, `dpsSimulator`) — the audited churn surface.

---

## Task 1: `buildEmptyShipSkills()` helper

A genuinely empty kit (no abilities). **Must NOT** reuse `buildDefaultShipSkills()` — that carries a
100-multiplier damage ability and would inject phantom team damage.

**Files:**
- Modify: `src/utils/abilities/configToSimInputs.ts` (add after `buildDefaultShipSkills`, ~`:25`)
- Test: `src/utils/abilities/__tests__/configToSimInputs.test.ts`

- [ ] **Step 1: Write the failing test.** Add (create file if missing):

```typescript
import { describe, it, expect } from 'vitest';
import { buildEmptyShipSkills } from '../configToSimInputs';

describe('buildEmptyShipSkills', () => {
    it('returns a kit with no slots and therefore no abilities', () => {
        const kit = buildEmptyShipSkills();
        expect(kit.slots).toEqual([]);
    });
});
```

- [ ] **Step 2: Run it — expect FAIL.** `npx vitest run configToSimInputs` → FAIL ("buildEmptyShipSkills is not a function" / no export).

- [ ] **Step 3: Implement.** In `configToSimInputs.ts`:

```typescript
// Truly-empty kit (no abilities) for a buff-only team actor walked through runCombat: zero
// damage, no skill-sourced buffs — only the actor's manual selfBuffs/enemyDebuffs apply (via
// teamSources + sourceFired). Distinct from buildDefaultShipSkills, which carries a damage ability.
export function buildEmptyShipSkills(): ShipSkills {
    return { slots: [] };
}
```

- [ ] **Step 4: Run it — expect PASS.** `npx vitest run configToSimInputs` → PASS.

- [ ] **Step 5: Lint + commit.** `npm run lint` → 0. Then:

```bash
git add src/utils/abilities/configToSimInputs.ts src/utils/abilities/__tests__/configToSimInputs.test.ts
git commit -m "feat(combat): A.3 — buildEmptyShipSkills (empty kit for walked buff-only team actors)"
```

---

## Task 2: `teamActorWalk` normalizer module

Synthesizes an empty-kit `walk` for any team actor lacking one; passes already-walked actors through
unchanged.

**Files:**
- Create: `src/utils/combat/teamActorWalk.ts`
- Test: `src/utils/combat/__tests__/teamActorWalk.test.ts`

> Note: `TeamActorEngineInput` (with the inline `walk` bundle type) is exported from `engine.ts`. Import it
> **type-only** here — types are erased at runtime, so there is no import cycle (this module's only runtime
> import from engine's graph is none; it imports `buildEmptyShipSkills` from `configToSimInputs`).

- [ ] **Step 1: Write the failing test.**

```typescript
import { describe, it, expect } from 'vitest';
import { normalizeTeamActorsToWalked, synthesizeBuffOnlyWalk } from '../teamActorWalk';
import type { TeamActorEngineInput } from '../engine';

const buffOnly = (over: Partial<TeamActorEngineInput> = {}): TeamActorEngineInput => ({
    id: 'support-1',
    speed: 100,
    chargeCount: 0,
    startCharged: false,
    selfBuffs: [],
    enemyDebuffs: [],
    ...over,
});

describe('synthesizeBuffOnlyWalk', () => {
    it('attaches an empty-kit walk with neutral stats (hp 1 / defence 0 / hacking 200)', () => {
        const w = synthesizeBuffOnlyWalk(buffOnly()).walk!;
        expect(w.shipSkills.slots).toEqual([]);
        expect(w.stats.hp).toBe(1);
        expect(w.stats.defence).toBe(0);
        expect(w.stats.hacking).toBe(200);
        expect(w.affinityDamageModifier).toBe(0);
        expect(w.debuffLandingChance).toBe(1);
    });

    it('sets hasChargedSkill from chargeCount (reproduces the legacy charge cadence gate)', () => {
        expect(synthesizeBuffOnlyWalk(buffOnly({ chargeCount: 0 })).walk!.hasChargedSkill).toBe(false);
        expect(synthesizeBuffOnlyWalk(buffOnly({ chargeCount: 2 })).walk!.hasChargedSkill).toBe(true);
    });
});

describe('normalizeTeamActorsToWalked', () => {
    it('synthesizes a walk only for actors lacking one; passes walked actors through by reference', () => {
        const walked = buffOnly({ id: 'w', walk: synthesizeBuffOnlyWalk(buffOnly()).walk });
        const [a, b] = normalizeTeamActorsToWalked([buffOnly({ id: 'a' }), walked]);
        expect(a.walk).toBeTruthy();
        expect(b).toBe(walked); // unchanged reference
    });
});
```

- [ ] **Step 2: Run it — expect FAIL.** `npx vitest run teamActorWalk` → FAIL (module not found).

- [ ] **Step 3: Implement.** Create `src/utils/combat/teamActorWalk.ts`:

```typescript
import type { TeamActorEngineInput } from './engine';
import type { CombatStatBlock } from '../../types/calculator';
import { buildEmptyShipSkills } from '../abilities/configToSimInputs';

// Neutral stats for a synthesized buff-only walk. hp 1 / defence 0 match the engine's prior
// buff-only defaults (the `t.walk ? … : 1` / `: 0` ternaries); hacking 200 reproduces the old
// static landing default (vs security-default 100 → landing 1.0). The empty kit deals no damage,
// so attack/crit/critDamage/defensePenetration are inert at 0.
const NEUTRAL_WALK_STATS: CombatStatBlock = {
    attack: 0,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    hacking: 200,
    defence: 0,
    hp: 1,
};

/**
 * Synthesize an empty-kit `walk` bundle for a team actor that arrived without one (the buff-only
 * format). The walked path then handles it uniformly: zero damage, manual selfBuffs/enemyDebuffs
 * applied via teamSources + sourceFired, charge cadence reproduced via hasChargedSkill = chargeCount > 0.
 */
export function synthesizeBuffOnlyWalk(actor: TeamActorEngineInput): TeamActorEngineInput {
    return {
        ...actor,
        walk: {
            shipSkills: buildEmptyShipSkills(),
            stats: { ...NEUTRAL_WALK_STATS },
            // Fallback only — the live A2 path recomputes from stats.hacking when the enemy carries a
            // security base; both yield 1.0 for this neutral actor.
            debuffLandingChance: 1,
            selfDotModifier: 0,
            defensePenetrationBuff: 0,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            hasChargedSkill: actor.chargeCount > 0,
            healModifier: 0,
            affinity: undefined,
        },
    };
}

/** Normalize a team roster so EVERY actor has a `walk` bundle (the legacy non-walked path is gone). */
export function normalizeTeamActorsToWalked(
    actors: TeamActorEngineInput[]
): TeamActorEngineInput[] {
    return actors.map((a) => (a.walk ? a : synthesizeBuffOnlyWalk(a)));
}
```

- [ ] **Step 4: Run it — expect PASS.** `npx vitest run teamActorWalk` → PASS.

- [ ] **Step 5: tsc + lint + commit.** `npx tsc --noEmit` clean; `npm run lint` → 0. Then:

```bash
git add src/utils/combat/teamActorWalk.ts src/utils/combat/__tests__/teamActorWalk.test.ts
git commit -m "feat(combat): A.3 — team-actor walk normalizer (synthesize empty-kit walk for buff-only actors)"
```

---

## Task 3: Wire the normalizer into `runCombat` (the behavior-change commit)

After this task every team actor walks → the legacy branch is unreachable (deleted in Task 4). This is
where the audited golden churn happens.

**Files:**
- Create: `src/utils/combat/__tests__/buffOnlyTeamWalk.integration.test.ts` (equivalence guard)
- Modify: `src/utils/combat/engine.ts` — import + apply the normalizer right after the input destructure
  (`~:1107`), BEFORE the `teamRuntimeById` builder (`~:1410`) and any other `teamActors` read.

- [ ] **Step 1: Write the equivalence/integration guard FIRST (it passes today via the legacy branch).**
  This is the spec's stated primary risk (§9: an empty kit through `runPlayerTurn`). Written before wiring,
  it pins the observable behavior so it must survive both the wiring (Step 2) and the legacy-branch deletion
  (Task 4). Drive `runCombat` directly with a buff-only team actor that has BOTH an active-sourced and a
  charge-sourced enemy debuff, and assert both land via the event bus. Mirror the `engine.events.test.ts`
  harness (collect `bus` events). Example shape:

```typescript
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus } from '../events'; // match engine.events.test.ts's bus import/pattern
// ...reuse the same baseInput / buff(...) helpers the existing combat tests use...

it('buff-only team actor applies BOTH its active- and charge-sourced enemy debuffs over rounds', () => {
    const events: any[] = [];
    const bus = createEventBus();
    bus.on?.((e) => events.push(e)); // adapt to the actual bus API used in engine.events.test.ts
    runCombat({
        ...baseInput({ numRounds: 4 }),
        bus,
        teamActors: [
            {
                id: 'support-1',
                speed: 140,
                chargeCount: 2,
                startCharged: true,
                selfBuffs: [],
                enemyDebuffs: [
                    buff({ id: 'tdA', buffName: 'Team Defense Down', parsedEffects: { defense: -15 }, skillSource: 'charge', skillDuration: 2 }),
                    buff({ id: 'tdB', buffName: 'Team Attack Down', parsedEffects: { attack: -10 }, skillSource: 'active', skillDuration: 2 }),
                ],
            },
        ],
    });
    const applied = events.filter((e) => e.type === 'debuff-applied' && e.sourceId === 'support-1').map((e) => e.buffName);
    expect(applied).toContain('Team Defense Down'); // charge-sourced → fired on charged turn
    expect(applied).toContain('Team Attack Down');  // active-sourced → fired on active turn
});
```

> Adapt the imports/helpers to the EXACT patterns in `engine.events.test.ts` (bus construction, `baseInput`,
> `buff`). The point is the two assertions: both manual debuff sources apply for a buff-only actor.

- [ ] **Step 2: Run the guard — expect PASS today.** `npx vitest run buffOnlyTeamWalk` → PASS (legacy branch
  still routes it). If it FAILS, the assertion doesn't match current behavior — fix the test to reflect
  reality before proceeding (do NOT change engine code yet).

- [ ] **Step 3: Apply the normalizer.** Add the import near the other `./` engine-module imports at the top
  of `engine.ts`:

```typescript
import { normalizeTeamActorsToWalked } from './teamActorWalk';
```

The runCombat input is destructured with `const { … teamActors = [], … } = input;` (`~:1076-1107`) — a
`const`, so it cannot be reassigned. Instead, **remove `teamActors = [],` from that destructure list**, and
immediately after the `} = input;` line (`~:1107`) bind the normalized roster as a fresh `const`:

```typescript
// A.3 migration: every team actor walks. Synthesize an empty-kit walk for any buff-only actor so the
// legacy non-walked-team branch is unreachable (and deleted in Task 4). Single const → every downstream
// teamActors read (teamCombatActors, teamRuntimeById, teamSources, lookups, hp/defence defaults) sees the
// normalized roster unchanged.
const teamActors = normalizeTeamActorsToWalked(input.teamActors ?? []);
```

> This keeps the identifier `teamActors`, so the ~13 downstream reads (`:1191, 1202, 1244, 1254, 1321, 1348,
> 1353, 1411, 1659, 1739, 1915, 1936`) need no edit. Verify after the edit that `teamActors` is no longer in
> the destructure (no duplicate-binding tsc error).

- [ ] **Step 4: Re-run the equivalence guard — it must STILL pass.** `npx vitest run buffOnlyTeamWalk` →
  PASS (now via the synthesized walk instead of the legacy branch). This is the direct proof the empty kit
  survives `runPlayerTurn`. If it fails, the synthesis is wrong — STOP and fix Task 2 before touching goldens.

- [ ] **Step 5: Run the targeted suites and AUDIT.** Run each and inspect every diff:

```
npx vitest run dpsGoldenParity engine.events triggers dpsSimulator
```

For EACH moved snapshot, confirm it matches one of the spec's deltas:
  - **Delta 1 (landing flip):** a buff-only actor's enemy debuff now lands by its own chance (1.0) vs the
    attacker's prior chance. Expected ≈zero — most goldens already land at 1.0.
  - **Delta 2 (`teamDamage`):** a `RoundData` that previously omitted `teamDamage` now shows `teamDamage: 0`.
  - **Delta 3 (events):** an added zero-damage turn event for a buff-only actor.
  If a diff matches a delta, it is acceptable. **If any diff does NOT match deltas 1-3, STOP and report.**

- [ ] **Step 6: Run the FULL suite and audit the rest.** `npx vitest run`. Audit any further combat `.snap`
  movement against deltas 1-3 (same rule). `npx tsc --noEmit` clean; `npm run lint` → 0.

- [ ] **Step 7: Accept goldens (only after audit).** For snapshots confirmed to match deltas 1-3, update them:
  `npx vitest run -u <specific-file>` for the audited files ONLY (never a blanket `-u`). Re-run `npx vitest run`
  → green.

- [ ] **Step 8: Commit (record the audit in the message).**

```bash
git add -A
git commit -m "feat(combat): A.3 — walk buff-only team actors via runCombat-entry normalizer

Every team actor now walks (empty-kit synthesized walk for buff-only inputs). Audited golden churn:
<list each moved snapshot file + which delta (1 landing / 2 teamDamage / 3 events) explains it>."
```

---

## Task 4: Delete the legacy non-walked-team branch + carve-out

Now unreachable. Pure deletion — expect ZERO further churn.

**Files:**
- Modify: `src/utils/combat/engine.ts` — delete the `else if (actor.kind === 'team')` block (`~:3257-3335`)
  including the `setLandsTimedEnemyApplication(...)` carve-out (`~:3287-3295`).

- [ ] **Step 1: Confirm unreachability.** Re-read the dispatch: the preceding
  `else if (actor.kind === 'team' && teamRuntimeById.has(actor.id))` (`~:3157`) now matches EVERY team actor
  (all have a walk → a runtime). Grep the test suite for any team actor still lacking a walk after
  normalization (there should be none — the normalizer is unconditional).

- [ ] **Step 2: Delete the block.** Remove the entire `else if (actor.kind === 'team') { … }` branch
  (`~:3257-3335`). Do NOT touch the preceding walked `if`. Do NOT delete shared helpers
  (`advanceChargeCadence`, `synthesizeResisted`, `landsTimedEnemyApplication`, `bus.emit('skill-fired')`) —
  they are used by the walked/focus paths.

- [ ] **Step 3: Verify zero churn.** `npx tsc --noEmit` clean. `npx vitest run` → all green, SAME snapshots
  as end of Task 3 (`git status --porcelain | grep '\.snap'` → empty). `npm run lint` → 0.

> If a test fails or a snapshot moves here, the branch was NOT fully unreachable — STOP and report.

- [ ] **Step 4: Commit.**

```bash
git add -A
git commit -m "refactor(combat): A.3 — delete dead legacy non-walked-team branch + sourceFired carve-out"
```

---

## Task 5: Simplify ternaries + remove proven-dead symbols

**Files:**
- Modify: `src/utils/combat/engine.ts` — the `t.walk ? t.walk.stats.hp : 1` (`~:1659`) and
  `t.walk ? t.walk.stats.defence : 0` (`~:1739`) ternaries; any symbol tsc now flags as unused.

- [ ] **Step 1: Collapse the ternaries.** With `walk` always present, replace:
  - `t.walk ? t.walk.stats.hp : 1` → `t.walk!.stats.hp` (or refactor to a non-optional read if the type
    permits — check whether `walk?` can be narrowed; keep minimal).
  - `t.walk ? t.walk.stats.defence : 0` → `t.walk!.stats.defence`.
  **Leave** the `:1412` `if (!t.walk) return;` guard in the runtime builder as-is — it is now a never-taken
  early return but is harmless, type-safe, and removing it is needless churn. Do not touch it.

- [ ] **Step 2: Remove dead symbols ONLY if tsc proves them unused.** Run `npx tsc --noEmit`. If it flags an
  import/local now unused (e.g. something only the deleted branch referenced), remove it — but FIRST grep to
  confirm it has no other caller. Shared helpers stay (see Task 4 Step 2).

- [ ] **Step 3: Verify byte-identity.** `npx vitest run` → green, zero `.snap` movement vs Task 4.
  `npx tsc --noEmit` clean. `npm run lint` → 0.

- [ ] **Step 4: Commit.**

```bash
git add -A
git commit -m "refactor(combat): A.3 — collapse walk-presence ternaries; drop proven-dead symbols"
```

---

## Task 6: Full gate + closure

**Files:** none (verification only).

- [ ] **Step 1:** `npx vitest run` → all green.
- [ ] **Step 2:** `npm run lint` → 0 warnings.
- [ ] **Step 3:** `npx tsc --noEmit` → clean.
- [ ] **Step 4:** `npm run audit:skills` → 0 findings / 141 ships.
- [ ] **Step 5:** Confirm the ONLY snapshot movement across the whole migration was the Task-3 audited churn
  (deltas 1-3), and Tasks 4-5 moved none.
- [ ] **Step 6:** `git status` → clean after the per-task commits.

---

## Done criteria
- Every team actor walks; the legacy non-walked-team branch + `sourceFired` carve-out are deleted.
- Buff-only `TeamActorInput` API unchanged (callers/tests need no shape change).
- Charge cadence preserved via `hasChargedSkill = chargeCount > 0`; manual buffs/debuffs apply unchanged.
- Golden churn limited to audited deltas 1-3, recorded in the Task-3 commit; Tasks 4-5 byte-identical.
- Suite + lint + tsc + audit:skills clean.
- **Sub-project A is closed** (A.1/A.2 from the parent sweep + this A.3 migration). Next: sub-project B (Stasis).
