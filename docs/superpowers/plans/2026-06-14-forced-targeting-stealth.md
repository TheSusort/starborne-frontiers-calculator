# Forced Targeting & Stealth (Positional Phase 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make positional target resolution honour stealth and the forced-targeting statuses (Taunt, Concentrate Fire), as a capability-only overlay on the existing engine.

**Architecture:** A new optional `statusOf` callback on `resolvePositionalTarget` injects per-actor targeting statuses; when present (enemy-side selection) the resolver applies Concentrate Fire → Taunt forced targeting and a stealth filter before delegating to `selectTargets`. A thin read-helper `buildForcedTargetingStatus` composes the existing status-query helpers into that callback, wired at the 3 engine call sites. No production caller passes positions, so all DPS/healing goldens stay byte-identical.

**Tech Stack:** TypeScript, Vitest. Files: `src/utils/combat/positionalBinding.ts`, `src/utils/combat/triggers.ts`, `src/utils/combat/engine.ts`.

**Spec:** `docs/superpowers/specs/2026-06-14-forced-targeting-stealth-design.md`

## Pre-flight / environment

- `gh auth switch --hostname github.com --user TheSusort` before any PR/merge op.
- This work runs in its own git worktree (a parallel session may own the main checkout). When creating the worktree, **symlink the gitignored `.env` and `docs/*.csv` / `docs/combat-system.md` reference files from the main checkout into the worktree** or env-dependent tests + the pre-commit hook break (Phase 2 gotcha).
- Dev server is :3000. Do not `vitest -u` goldens — any golden diff is a leak to fix, never a re-baseline.
- `docs/` is gitignored → spec/plan commits need `git add -f` and `--no-verify` (the pre-commit hook runs the full suite).
- Branch off current `main` (Phase 2 `e735e14f` merged): `git checkout -b feat/combat-engine-positional-phase3-forced-targeting`.

## File Structure

- **`src/utils/combat/positionalBinding.ts`** (modify) — owns the `ActorTargetingStatus` type (the `statusOf` contract) and the resolution logic. The type lives here, not in `triggers.ts`, because positionalBinding is the consumer/seam and imports nothing from triggers (no import cycle; `triggers.ts` type-imports it).
- **`src/utils/combat/triggers.ts`** (modify) — adds `buildForcedTargetingStatus` next to the existing `selfBuffNamesForOwners` / `ownerDebuffNamesFor` query helpers it composes.
- **`src/utils/combat/engine.ts`** (modify) — builds the status map per opposing roster at the 3 `resolvePositionalTarget` call sites and passes `statusOf`.
- **`src/utils/combat/positionalBinding.test.ts`** (modify) — extends the existing co-located tests with `statusOf` cases.
- **`src/utils/combat/__tests__/forcedTargetingStatus.test.ts`** (create) — unit tests for `buildForcedTargetingStatus` against a real status engine.
- **`src/utils/combat/__tests__/positionalSelection.test.ts`** (modify) — adds a Taunt-redirect integration test mirroring the existing Task C1 focus-turn test.
- **`docs/combat-system.md`** (modify) — annotate §9 that Concentrate Fire is on the target, not the team.

---

### Task 1: `resolvePositionalTarget` gains `statusOf` (stealth + forced targeting)

**Files:**
- Modify: `src/utils/combat/positionalBinding.ts`
- Test: `src/utils/combat/positionalBinding.test.ts`

The resolution logic is fully exercised here with a **stub `statusOf`** (a plain function/Map) — no status engine involved, keeping these tests pure.

- [ ] **Step 1: Write the failing tests** — append to `positionalBinding.test.ts`. Add a `statusOf` stub helper and a `describe` block:

```ts
import { colOf } from '../targeting/board'; // (only if a test needs it; otherwise omit)
import type { ActorTargetingStatus } from './positionalBinding';

// Build a statusOf stub from a partial map keyed by actor id.
const statusFrom =
    (m: Record<string, Partial<ActorTargetingStatus>>) =>
    (id: string): ActorTargetingStatus | undefined => {
        const s = m[id];
        return s
            ? { stealthed: false, taunting: false, concentrated: false, ...s }
            : undefined;
    };

describe('resolvePositionalTarget — stealth + forced targeting (statusOf)', () => {
    // M4 front-most, M1 back-most.
    const enemies = [actor('front', 'M4'), actor('back', 'M1')];

    it('omitting statusOf is identical to the Phase-2 result', () => {
        expect(resolvePositionalTarget('M4', enemyTarget('front'), enemies)?.id).toBe('front');
    });

    it('statusOf returning undefined for every id is identical to Phase-2', () => {
        const so = statusFrom({});
        expect(resolvePositionalTarget('M4', enemyTarget('front'), enemies, so)?.id).toBe('front');
    });

    it('stealth filter excludes a stealthed enemy (front stealthed → front picks back)', () => {
        const so = statusFrom({ front: { stealthed: true } });
        expect(resolvePositionalTarget('M4', enemyTarget('front'), enemies, so)?.id).toBe('back');
    });

    it('all-stealthed fallback: every enemy stealthed → still targetable (front → front)', () => {
        const so = statusFrom({ front: { stealthed: true }, back: { stealthed: true } });
        expect(resolvePositionalTarget('M4', enemyTarget('front'), enemies, so)?.id).toBe('front');
    });

    it('Taunt forces the taunting actor even when it is not the default anchor', () => {
        // front selection would pick M4(front); back taunts → redirect to back.
        const so = statusFrom({ back: { taunting: true } });
        expect(resolvePositionalTarget('M4', enemyTarget('front'), enemies, so)?.id).toBe('back');
    });

    it('Concentrate Fire forces the marked actor and reaches it through stealth', () => {
        // back is both stealthed AND concentrated → CF bypasses stealth, forces back.
        const so = statusFrom({ back: { stealthed: true, concentrated: true } });
        expect(resolvePositionalTarget('M4', enemyTarget('front'), enemies, so)?.id).toBe('back');
    });

    it('Concentrate Fire beats a simultaneous Taunt (priority CF > Taunt)', () => {
        // front taunts, back is concentrated → CF wins → back.
        const so = statusFrom({ front: { taunting: true }, back: { concentrated: true } });
        expect(resolvePositionalTarget('M4', enemyTarget('front'), enemies, so)?.id).toBe('back');
    });

    it('multi-taunt with no round data → front-most (colOf descending), not roster order', () => {
        // Roster lists back(M1) before front(M4); both taunt; front-most (M4) must win.
        const rosterBackFirst = [actor('back', 'M1'), actor('front', 'M4')];
        const so = statusFrom({ front: { taunting: true }, back: { taunting: true } });
        expect(
            resolvePositionalTarget('M4', enemyTarget('front'), rosterBackFirst, so)?.id
        ).toBe('front');
    });

    it('multi-taunt honours tauntAppliedRound when present (later round wins over front-most)', () => {
        // back is back-most but applied later → back wins despite front being front-most.
        const so = statusFrom({
            front: { taunting: true, tauntAppliedRound: 1 },
            back: { taunting: true, tauntAppliedRound: 2 },
        });
        expect(resolvePositionalTarget('M4', enemyTarget('front'), enemies, so)?.id).toBe('back');
    });

    it('ally-side selection ignores statusOf (no stealth/forced targeting)', () => {
        // side:'ally' → Phase-2 path; opposing map has no caster cell → null (unchanged).
        const allyTarget: ParsedTarget = { raw: 'ally', side: 'ally', selection: 'self' };
        const so = statusFrom({ front: { taunting: true } });
        expect(resolvePositionalTarget('M4', allyTarget, enemies, so)).toBeNull();
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/utils/combat/positionalBinding.test.ts`
Expected: FAIL — `ActorTargetingStatus` not exported / `statusOf` arg ignored so stealth/taunt/CF cases return `front`.

- [ ] **Step 3: Implement** — rewrite `src/utils/combat/positionalBinding.ts` to add the type, the param, and the resolution logic. Full file:

```ts
import { selectTargets } from '../targeting/selectTargets';
import { colOf } from '../targeting/board';
import type { Position } from '../../types/encounters';
import type { ParsedTarget } from '../targetingParser';
import type { CombatActor } from './state';

/** Per-actor targeting statuses consulted during positional resolution.
 *  An `undefined` lookup result (see resolvePositionalTarget) is treated as all-false. */
export interface ActorTargetingStatus {
    /** Self-buff 'Stealth' — untargetable unless all opposing actors are stealthed. */
    stealthed: boolean;
    /** Self-buff 'Taunt' — forces opposing attackers to target this actor. */
    taunting: boolean;
    /** Enemy-debuff 'Concentrate Fire' on this actor — force-targeted, bypasses stealth. */
    concentrated: boolean;
    /** Round the Taunt was applied (most-recent-wins tiebreak). Unset today → front-most. */
    tauntAppliedRound?: number;
}

export function isPositional(
    actorPosition: Position | undefined,
    opposingLiving: CombatActor[]
): boolean {
    return !!actorPosition && opposingLiving.some((a) => a.position !== undefined);
}

/**
 * Resolve the positional target anchor to a single living CombatActor.
 *
 * When `statusOf` is omitted, or the target is ally-side, behaviour is identical to
 * Phase 2 (the load-bearing byte-identical-goldens guarantee). When `statusOf` is supplied
 * AND `target.side === 'enemy'`, forced targeting and stealth run before `selectTargets`:
 *   1. Concentrate Fire (bypasses stealth) — force the marked actor (front-most if many).
 *   2. Taunt (before stealth) — force the taunting actor (latest tauntAppliedRound else front-most).
 *   3. Stealth filter — drop stealthed cells; if that empties the set, restore all.
 * `statusOf(id)` returning `undefined` is treated as all-false (never throws/skips).
 */
export function resolvePositionalTarget(
    actorPosition: Position,
    target: ParsedTarget,
    opposingLiving: CombatActor[],
    statusOf?: (id: string) => ActorTargetingStatus | undefined
): CombatActor | null {
    const byCell = new Map<Position, CombatActor>();
    for (const a of opposingLiving) {
        if (a.position !== undefined && a.currentHp > 0) {
            byCell.set(a.position, a);
        }
    }
    if (byCell.size === 0) {
        return null;
    }

    // Candidate cells; the stealth filter narrows this list, byCell stays intact for lookup.
    let cells = [...byCell.keys()];

    if (statusOf && target.side === 'enemy') {
        const actors = [...byCell.values()];
        // Front-most among candidates: highest column first (col 4 = front).
        const frontMost = (cands: CombatActor[]): CombatActor =>
            [...cands].sort((x, y) => colOf(y.position!) - colOf(x.position!))[0];

        // 1. Concentrate Fire — bypasses stealth.
        const concentrated = actors.filter((a) => statusOf(a.id)?.concentrated);
        if (concentrated.length) {
            return frontMost(concentrated);
        }

        // 2. Taunt — evaluated before the stealth filter.
        const taunting = actors.filter((a) => statusOf(a.id)?.taunting);
        if (taunting.length) {
            const round = (a: CombatActor) => statusOf(a.id)?.tauntAppliedRound ?? -Infinity;
            const maxRound = Math.max(...taunting.map(round));
            const latest = taunting.filter((a) => round(a) === maxRound);
            return frontMost(latest);
        }

        // 3. Stealth filter — restore all if every candidate is stealthed.
        const visible = cells.filter((p) => !statusOf(byCell.get(p)!.id)?.stealthed);
        if (visible.length) {
            cells = visible;
        }
    }

    const { anchor } = selectTargets(target, {
        casterPosition: actorPosition,
        enemyOccupied: cells,
    });
    return anchor ? (byCell.get(anchor) ?? null) : null;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/utils/combat/positionalBinding.test.ts`
Expected: PASS (all existing + new cases).

- [ ] **Step 5: Commit**

```bash
git add src/utils/combat/positionalBinding.ts src/utils/combat/positionalBinding.test.ts
git commit -m "feat(targeting): statusOf-driven stealth + forced targeting in resolvePositionalTarget"
```

---

### Task 2: `buildForcedTargetingStatus` read helper

**Files:**
- Modify: `src/utils/combat/triggers.ts` (next to `selfBuffNamesForOwners` ~line 635)
- Test: `src/utils/combat/__tests__/forcedTargetingStatus.test.ts` (create)

Composes the existing query helpers into a per-actor status map. Reads only — applying Concentrate Fire to an actor's store is deferred (no applier in Phase 3); the test seeds the status engine directly.

- [ ] **Step 1: Write the failing test** — create `forcedTargetingStatus.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createStatusEngine } from '../statusEngine';
import { buildForcedTargetingStatus } from '../triggers';
import type { SelectedGameBuff } from '../../../types/calculator';

// Always-active seed (skillDuration null → appears in snapshot every round for owner 'attacker';
// enemyDebuffs with no enemyTargetId resolve to the default '__enemy__' target).
const buff = (buffName: string): SelectedGameBuff =>
    ({
        id: buffName,
        buffName,
        stacks: 1,
        parsedEffects: {},
        isStackable: false,
        skillDuration: null,
    }) as SelectedGameBuff;

describe('buildForcedTargetingStatus', () => {
    it('reads Stealth and Taunt from the self-buff store', () => {
        const se = createStatusEngine({ selfBuffs: [buff('Stealth'), buff('Taunt')], enemyDebuffs: [] });
        se.beginRound(1);
        const map = buildForcedTargetingStatus(se, ['attacker']);
        expect(map.get('attacker')).toMatchObject({ stealthed: true, taunting: true, concentrated: false });
    });

    it('reads Concentrate Fire from the per-target enemy-debuff store', () => {
        const se = createStatusEngine({ selfBuffs: [], enemyDebuffs: [buff('Concentrate Fire')] });
        se.beginRound(1);
        const map = buildForcedTargetingStatus(se, ['__enemy__']);
        expect(map.get('__enemy__')).toMatchObject({ concentrated: true, stealthed: false, taunting: false });
    });

    it('absent statuses → all-false', () => {
        const se = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        se.beginRound(1);
        const map = buildForcedTargetingStatus(se, ['attacker']);
        expect(map.get('attacker')).toEqual({ stealthed: false, taunting: false, concentrated: false });
    });
});
```

NOTE: if the always-active seed does not surface in `snapshot().activeSelfBuffs` (verify by reading `createStatusEngine` `isAlwaysActive` at statusEngine.ts:234 — `skillDuration: null` qualifies), mirror the seed shape used in `src/utils/combat/__tests__/enemyBuffSelfDebuffGate.test.ts`. Call `se.beginRound(1)` before querying (the snapshot reads the current round's active sets).

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/utils/combat/__tests__/forcedTargetingStatus.test.ts`
Expected: FAIL — `buildForcedTargetingStatus` is not exported from `triggers.ts`.

- [ ] **Step 3: Implement** — add to `src/utils/combat/triggers.ts` directly after `selfBuffNamesForOwners` (and after `ownerDebuffNamesFor`). Import the type:

```ts
import type { ActorTargetingStatus } from './positionalBinding';
```

```ts
/** Per-actor forced-targeting/stealth status, read from the status engine for the given
 *  actor ids. Stealth/Taunt are self-buffs (selfBuffNamesForOwners); Concentrate Fire is a
 *  debuff on the focus target (ownerDebuffNamesFor). Read-half only — no applier wiring this
 *  phase (Concentrate Fire application is deferred). `tauntAppliedRound` is left unset (the
 *  query layer exposes no application round → callers degrade to front-most board order). */
export function buildForcedTargetingStatus(
    statusEngine: StatusEngine,
    actorIds: string[]
): Map<string, ActorTargetingStatus> {
    const map = new Map<string, ActorTargetingStatus>();
    for (const id of actorIds) {
        const selfNames = selfBuffNamesForOwners(statusEngine, [id]);
        const debuffNames = ownerDebuffNamesFor(statusEngine, id);
        map.set(id, {
            stealthed: selfNames.includes('Stealth'),
            taunting: selfNames.includes('Taunt'),
            concentrated: debuffNames.includes('Concentrate Fire'),
        });
    }
    return map;
}
```

(Buff-name constants live in `src/constants/buffs.ts`; the existing query helpers use bare string literals, so match that style.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/utils/combat/__tests__/forcedTargetingStatus.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/combat/triggers.ts src/utils/combat/__tests__/forcedTargetingStatus.test.ts
git commit -m "feat(targeting): buildForcedTargetingStatus read helper"
```

---

### Task 3: Wire `statusOf` at the 3 engine call sites + Taunt-redirect integration test

**Files:**
- Modify: `src/utils/combat/engine.ts` (call sites ~2430 focus, ~2542 team, ~2780 enemy; import ~line 56)
- Test: `src/utils/combat/__tests__/positionalSelection.test.ts` (add a Taunt-redirect test)

`buildForcedTargetingStatus` is already imported region (`./triggers`). `statusEngine` is in scope at all 3 sites.

- [ ] **Step 1: Write the failing integration test** — append to `positionalSelection.test.ts`. It mirrors the existing Task C1 focus-turn helpers (`focusAbilityTargetId`, `BASE`, `enemyAt`). The back-most enemy (M1) carries a Taunt self-buff; with `front` selection the focus must redirect to the taunter (M1) instead of the front-most (M4):

```ts
import { Ability } from '../../../types/abilities';

// A positioned enemy that self-buffs Taunt on its active slot (no damage), so it carries
// Taunt once it acts. Give it speed > focus so it acts first and Taunt is live when the
// focus resolves targets in the same round (focus default speed is low here).
const tauntingEnemyAt = (id: string, position: Position): EnemyAttacker =>
    ({
        id,
        stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000_000, speed: 1000 },
        chargeCount: 0,
        startCharged: false,
        position,
        shipSkills: {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        ab({
                            type: 'buff',
                            target: 'self',
                            config: {
                                type: 'buff',
                                buffName: 'Taunt',
                                parsedEffects: {},
                                stacks: 1,
                                isStackable: false,
                                duration: 99,
                            } as Ability['config'],
                        }),
                    ],
                },
            ],
        } as ShipSkills,
    }) as EnemyAttacker;

describe('Phase 3 — Taunt forces the focus attacker to redirect', () => {
    it('front selection redirects to the back-most enemy when it carries Taunt', () => {
        idc = 0;
        const input: CombatEngineInput = {
            ...BASE('front'),
            numRounds: 2, // round 1 enemy self-buffs Taunt; assert the focus hit's target
            enemyAttackers: [
                enemyAt('enemy-front', 'M4'),
                tauntingEnemyAt('enemy-back', 'M1'),
            ],
        };
        // Without Taunt, front → 'enemy-front'. With Taunt on the back enemy, the focus's
        // ability-performed targetId must be 'enemy-back'.
        expect(focusAbilityTargetId(input)).toBe('enemy-back');
    });
});
```

IMPLEMENTATION NOTE on timing: the assertion needs Taunt live when the focus resolves. Two viable setups — pick whichever makes the RED test fail then GREEN cleanly:
  (a) enemy speed 1000 ≫ focus so the enemy self-buffs Taunt **before** the focus acts in round 1 (above); `focusAbilityTargetId` returns the **first** focus `ability-performed`.
  (b) if turn order makes round-1 Taunt unavailable to the focus, give the enemy a **passive-slot** Taunt self-buff (seeded at round-1 start via `seedPassiveTimedStatuses`, present before any turn) and keep `numRounds: 1`.
Verify the chosen setup actually fails RED before wiring (Step 2).

- [ ] **Step 2: Run the new test to verify it fails (RED)**

Run: `npx vitest run src/utils/combat/__tests__/positionalSelection.test.ts -t "Taunt forces"`
Expected: FAIL — focus binds `enemy-front` (statusOf not yet wired, so Taunt is ignored).

- [ ] **Step 3: Wire the focus call site** (engine.ts ~2428-2435). Replace the `resolvePositionalTarget(...)` call with one that passes a status lookup built over the opposing roster:

```ts
                    const selectedEnemy =
                        isPositional(actor.position, enemyAttackerActors) && input.target
                            ? resolvePositionalTarget(
                                  actor.position!,
                                  input.target,
                                  enemyAttackerActors,
                                  (() => {
                                      const m = buildForcedTargetingStatus(
                                          statusEngine,
                                          enemyAttackerActors.map((a) => a.id)
                                      );
                                      return (id: string) => m.get(id);
                                  })()
                              )
                            : null;
```

Prefer a small local helper to avoid repeating the IIFE three times — e.g. near the top of the per-round/turn scope define:

```ts
const statusLookupFor = (roster: CombatActor[]) => {
    const m = buildForcedTargetingStatus(statusEngine, roster.map((a) => a.id));
    return (id: string) => m.get(id);
};
```

then pass `statusLookupFor(enemyAttackerActors)` as the 4th arg. Place `statusLookupFor` where all 3 call sites can see it and `statusEngine` is in scope (it is, throughout the turn loop). Confirm the chosen scope does not rebuild the map more than once per turn unnecessarily (acceptable either way for these roster sizes, but keep it tidy).

- [ ] **Step 4: Wire the team call site** (engine.ts ~2540-2547):

```ts
                    const selectedTeamEnemy =
                        isPositional(actor.position, enemyAttackerActors) && teamTarget
                            ? resolvePositionalTarget(
                                  actor.position!,
                                  teamTarget,
                                  enemyAttackerActors,
                                  statusLookupFor(enemyAttackerActors)
                              )
                            : null;
```

- [ ] **Step 5: Wire the enemy call site** (engine.ts ~2778-2781) — opposing roster is `allPlayerActors`:

```ts
                    const selectedPlayer =
                        isPositional(actor.position, allPlayerActors) && enemyTarget
                            ? resolvePositionalTarget(
                                  actor.position!,
                                  enemyTarget,
                                  allPlayerActors,
                                  statusLookupFor(allPlayerActors)
                              )
                            : null;
```

Add the import if `buildForcedTargetingStatus` is not already pulled from `./triggers` (engine.ts ~line 48-57):

```ts
    buildForcedTargetingStatus,
```

- [ ] **Step 6: Run the integration test to verify it passes (GREEN)**

Run: `npx vitest run src/utils/combat/__tests__/positionalSelection.test.ts`
Expected: PASS — including the existing C1/C2/C3 tests (statusOf returns all-false for statusless rosters → unchanged) and the new Taunt-redirect test.

- [ ] **Step 7: Confirm goldens are byte-identical**

Run: `npx vitest run src/utils/calculators/__tests__/dpsGoldenParity.test.ts src/utils/calculators/__tests__/healingGoldenParity.test.ts`
Expected: PASS with no snapshot writes. Then `git status` / `git diff --stat` must show **no `__snapshots__` or golden file changed**. If one moved, the gate leaked — fix the wiring, never `vitest -u`.

- [ ] **Step 8: Full suite + lint + types**

Run: `npx vitest run` then `npm run lint` then `npx tsc --noEmit`
Expected: all green, 0 warnings.

- [ ] **Step 9: Commit**

```bash
git add src/utils/combat/engine.ts src/utils/combat/__tests__/positionalSelection.test.ts
git commit -m "feat(targeting): wire forced targeting + stealth into the 3 positional call sites"
```

---

### Task 4: Doc — annotate combat-system.md §9 (Concentrate Fire on the target)

**Files:**
- Modify: `docs/combat-system.md` (the Forced Targeting table, ~line 210)

- [ ] **Step 1: Edit the Concentrate Fire row** — append a clarifying note that it is modelled as a debuff on the target ship, not the team:

In the forced-targeting table, change the Concentrate Fire description to note the model used by the simulator, e.g. add a trailing sentence: *"(Simulator model: applied as a debuff on the focus target ship — 'all attacks redirected to this unit' — not a team-wide debuff.)"*

- [ ] **Step 2: Commit** (docs are gitignored → force-add, skip the hook)

```bash
git add -f docs/combat-system.md
git commit --no-verify -m "docs: clarify Concentrate Fire is modelled as a target-side debuff"
```

---

## Wrap-up (after all tasks)

- [ ] Add ONE entry to the evolving combat/DPS `UNRELEASED_CHANGES` block in `src/constants/changelog.ts` ONLY if this surfaces to users. It does not (capability-only, no production caller) → **skip the changelog** per CLAUDE.md (internal/no user-visible behaviour change).
- [ ] Final holistic review (per subagent-driven-development), then open the PR with `gh` (auth-switch first). PR body should state: capability-only overlay, goldens byte-identical, Provoke is the immediate follow-up.
- [ ] After merge, update `project_combat_engine_current_state.md` memory: Phase 3 merged; NEXT = Provoke (applier→actor resolution via timed-buff `sourceId`), then Phase 4.

## Non-goals (do not implement here)

- Provoke (next PR).
- Per-ability "can target stealth" exception (needs `ParsedTarget` + parser work).
- Per-target damage accounting / AoE splash / death-fallback (Phase 4).
- A status-engine application-round query for exact "last-applied" taunt (the `tauntAppliedRound` field is the seam).
