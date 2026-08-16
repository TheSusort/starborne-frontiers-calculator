# SP-4b-1: The Normalization Boundary — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `runCombat` a single normalization boundary — `normalizeCombatRoster` — so that every actor below it carries a board position and offensive targeting, whether or not the caller supplied them.

**Architecture:** One new pure module, `src/utils/combat/normalizeRoster.ts`, called on the first line of `runCombat`. It takes a `CombatEngineInput` and returns a `CombatEngineInput` with (a) a deterministic slot for every position-less actor and (b) `DEFAULT_FRONT_ENEMY_TARGET` + `DEFAULT_BASE_PATTERN` for every actor missing them. It invents nothing else. Because `runCombat` reads everything off its `input` parameter, wiring is a parameter rename plus one `const` — every downstream read then sees the normalized world.

**Tech Stack:** TypeScript, Vitest, existing placement helpers in `src/utils/calculators/dpsEnemyPlacement.ts` and `src/utils/calculators/healingPlacement.ts`.

---

## Where this sits in the SP-4 ladder

The spec (`docs/superpowers/specs/2026-08-13-sp4-retire-the-dummy-design.md`) described four PRs; planning split it to five, and this plan splits the normalization step once more, on the owner's call (2026-08-13):

| PR | Scope | Churn expectation |
| --- | --- | --- |
| 4a ✅ | explicit `mode` replaces three implicit discriminators | zero golden movement (merged, `bf53a8a5`) |
| **4b-1 (this plan)** | `normalizeCombatRoster` + auto-placement + targeting synthesis; `enemyAttackers` stays **optional** | **all the positional churn** — ~54 fixture files |
| 4b-2 | `enemyAttackers` becomes **required**; migrate the 18 callers that pass none | the 18 files; dummy becomes unreachable |
| 4c | delete the dummy and clusters A–G | **zero** — that is the proof 4b made them dead |
| 4d | delete the four scalar inputs | mechanical |
| 4e | the two deferred heal-routing legacies | behavioural, team-symmetric |

**Why 4b-1 and 4b-2 are separate:** they have different churn stories, and tangling them produces a >100-file diff. A PR over 100 files gets **no CodeRabbit review at all while its check still passes** — the trap that hit #322. Both halves of 4b stay under that line.

## Measured facts — do NOT re-derive

Counted 2026-08-13 against `main` at `bf53a8a5`, over files matching `\brunCombat\s*\(` excluding `engine.ts` itself:

- **201 `runCombat` callers.** Exactly **3** are production: `battleSimulator.ts`, `dpsSimulator.ts`, `healingEngineAdapter.ts`. The other 198 are tests.
- **18** pass no `enemyAttackers` at all → `hasPositionedEnemyRoster` is false for them, so this PR does not touch their behaviour. They are 4b-2's problem.
- **54** pass `enemyAttackers` but the file contains no `position:` anywhere → **this is the churn set.**
- **129** already carry positions → little or no movement expected.

(The epic memory records "36 / 42". That count included `simulateDPS`-only callers. For `runCombat` specifically the numbers above are correct — update the memory when this lands.)

Everything this module needs **already exists** and is proven in production; this PR is a lift, not new architecture:

| Helper | Location | Role |
| --- | --- | --- |
| `DEFAULT_ATTACKER_SLOT` / `DEFAULT_ENEMY_SLOT` (`'M4'`) | `dpsEnemyPlacement.ts:15-16` | both sides anchor on M4; sides are separate coordinate spaces |
| `defaultTeamSlot(n)` | `dpsEnemyPlacement.ts` | player-side walk-back order |
| `defaultEnemySlot(n)` | `healingPlacement.ts:103` | enemy-side walk-back order |
| `resolvePlayerSlots(slots, priorityIndices?)` | `dpsEnemyPlacement.ts` | collision resolution; index 0 anchors |
| `resolveEnemySlots(slots)` | `healingPlacement.ts:116` | delegates to `resolvePlayerSlots` — already side-agnostic |
| `DEFAULT_FRONT_ENEMY_TARGET` | `dpsEnemyPlacement.ts` | `side: 'enemy'` is *relative to the actor*, so it is correct for both sides |
| `DEFAULT_BASE_PATTERN` | `dpsEnemyPlacement.ts` | `range` **must** be 0 |

`engine.ts` already imports from `../calculators/` (lines 19-22), so importing the placement helpers from `src/utils/combat/normalizeRoster.ts` breaks no layering rule.

## Global Constraints

- **`DEFAULT_BASE_PATTERN.range` must be 0.** `patternSignature` builds `"base|0|"`, whose offset table is `[ORIGIN]`. `"base|1|"` has no table and `resolveCells` **throws**.
- **A positional cast needs BOTH a `ParsedTarget` and a `ParsedPattern`, and the missing-pattern failure is SILENT** — the cast resolves onto the real enemy and credits `cumulativeDamage` via the legacy sink, but never runs the per-victim apply, so `perTargetDealt` comes back empty while the damage number looks plausible.
- **Never synthesize the CHARGED axes.** `chargedTarget`/`chargedPattern` being `undefined` is meaningful: the engine's own fallback is "charged axis absent ⇒ reuse the active one". Substituting a default there silently overrides a charged-axis-less actor's active binding. See `chargedOffensiveTarget`'s comment at `healingEngineAdapter.ts:401-405`.
- **Normalization FILLS IN a missing target; it never SUBSTITUTES a present one.** The healing adapter's `offensiveTarget` (`healingEngineAdapter.ts:399-400`) rewrites *ally-side* targets to the front-enemy default — that is caller **policy** for a healing matchup, not accommodation, and it stays in the adapter. An ally-targeting player in a battle sim must keep targeting allies.
- **Explicitly-positioned actors are never moved by auto-placement**, except by the existing collision resolver, which is the caller's own pre-existing behaviour.
- **Never `vitest -u`.** Every moved number is audited individually against a stated cause.
- Husky's pre-commit hook runs the **full** suite on every commit. Budget ~25s per commit.
- The dev server is `npm start` (there is no `npm run dev`). The DPS page route is `/damage`.

---

## File Structure

**Create:**
- `src/utils/combat/normalizeRoster.ts` — the boundary. Pure; imports only types plus the placement/targeting constants.
- `src/utils/combat/__tests__/normalizeRoster.test.ts` — unit tests in isolation, no engine.
- `src/utils/combat/__tests__/normalizationBoundary.integration.test.ts` — behavioural tests through `runCombat`.

**Modify:**
- `src/utils/combat/engine.ts:1678` — rename the parameter, add the normalization call.
- ~54 fixture files under `src/utils/combat/__tests__/` and `src/utils/calculators/__tests__/` — audited churn (Task 5).
- `src/utils/calculators/dpsSimulator.ts:487-512` and `src/utils/calculators/healingEngineAdapter.ts` — remove now-redundant fills (Task 7).

---

## Task 1: The module — auto-placement

**Files:**
- Create: `src/utils/combat/normalizeRoster.ts`
- Test: `src/utils/combat/__tests__/normalizeRoster.test.ts`

**Interfaces:**
- Consumes: `CombatEngineInput`, `TeamActorEngineInput` from `./engine`; `Position` from `../../types/encounters`.
- Produces: `export function normalizeCombatRoster(input: CombatEngineInput): CombatEngineInput`

- [ ] **Step 1: Write the failing test**

Create `src/utils/combat/__tests__/normalizeRoster.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { normalizeCombatRoster } from '../normalizeRoster';
import { DEFAULT_ATTACKER_SLOT, DEFAULT_ENEMY_SLOT } from '../../calculators/dpsEnemyPlacement';
import type { CombatEngineInput } from '../engine';

/** Minimal valid engine input. Fields the boundary never reads are set to inert values. */
const baseInput = (over: Partial<CombatEngineInput> = {}): CombatEngineInput =>
    ({
        attack: 1000,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: 0,
        shipSkills: { slots: [] },
        numRounds: 1,
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
        hp: 100_000,
        ...over,
    }) as CombatEngineInput;

const enemyInput = (id: string, position?: string) => ({
    id,
    stats: { attack: 0, crit: 0, critDamage: 0, speed: 10 },
    chargeCount: 0,
    startCharged: false,
    ...(position ? { position: position as never } : {}),
});

describe('normalizeCombatRoster — auto-placement', () => {
    it('places a position-less focus attacker on DEFAULT_ATTACKER_SLOT', () => {
        const out = normalizeCombatRoster(baseInput({ enemyAttackers: [enemyInput('e1')] }));
        expect(out.position).toBe(DEFAULT_ATTACKER_SLOT);
    });

    it('places a position-less first enemy on DEFAULT_ENEMY_SLOT', () => {
        const out = normalizeCombatRoster(baseInput({ enemyAttackers: [enemyInput('e1')] }));
        expect(out.enemyAttackers?.[0].position).toBe(DEFAULT_ENEMY_SLOT);
    });

    it('walks later enemies back instead of stacking them on the anchor', () => {
        const out = normalizeCombatRoster(
            baseInput({ enemyAttackers: [enemyInput('e1'), enemyInput('e2'), enemyInput('e3')] })
        );
        const slots = out.enemyAttackers!.map((e) => e.position);
        expect(new Set(slots).size).toBe(3);
        expect(slots[0]).toBe(DEFAULT_ENEMY_SLOT);
    });

    it('does NOT move an explicitly-positioned actor', () => {
        const out = normalizeCombatRoster(
            baseInput({
                position: 'B1' as never,
                enemyAttackers: [enemyInput('e1', 'T2')],
            })
        );
        expect(out.position).toBe('B1');
        expect(out.enemyAttackers?.[0].position).toBe('T2');
    });

    it('places team actors without colliding with the focus', () => {
        const out = normalizeCombatRoster(
            baseInput({
                enemyAttackers: [enemyInput('e1')],
                teamActors: [{ id: 't1' }, { id: 't2' }] as never,
            })
        );
        const playerSlots = [out.position, ...out.teamActors!.map((t) => t.position)];
        expect(new Set(playerSlots).size).toBe(3);
    });

    it('keeps the two sides on independent boards (both may anchor on M4)', () => {
        const out = normalizeCombatRoster(baseInput({ enemyAttackers: [enemyInput('e1')] }));
        expect(out.position).toBe('M4');
        expect(out.enemyAttackers?.[0].position).toBe('M4');
    });

    it('leaves an empty enemy roster empty — it never invents an enemy', () => {
        const out = normalizeCombatRoster(baseInput());
        expect(out.enemyAttackers ?? []).toEqual([]);
    });

    it('is a pure function — the caller’s input object is not mutated', () => {
        const input = baseInput({ enemyAttackers: [enemyInput('e1')] });
        normalizeCombatRoster(input);
        expect(input.position).toBeUndefined();
        expect(input.enemyAttackers?.[0].position).toBeUndefined();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/utils/combat/__tests__/normalizeRoster.test.ts`
Expected: FAIL — `Failed to resolve import "../normalizeRoster"`.

- [ ] **Step 3: Write the implementation**

Create `src/utils/combat/normalizeRoster.ts`:

```ts
/**
 * The engine's ONE accommodation boundary (SP-4b).
 *
 * `runCombat` calls this on its first line, so everything below it sees a fully positional world:
 * every actor carries a board slot, and every actor carries offensive targeting. Nothing else in
 * the engine may accommodate an under-specified input — that is the whole point of having a
 * boundary, and it is what lets SP-4c delete the dummy and its seven clusters of fallbacks.
 *
 * Three responsibilities, and deliberately no fourth:
 *   (a) auto-placement       — a deterministic slot for any actor with `position == null`
 *   (b) targeting synthesis  — DEFAULT_FRONT_ENEMY_TARGET + DEFAULT_BASE_PATTERN when ABSENT
 *   (c) nothing else         — it does not invent enemies, fill in stats, or choose a mode
 *
 * Pure: the caller's input object and its nested arrays are never mutated.
 */
import {
    DEFAULT_ATTACKER_SLOT,
    DEFAULT_ENEMY_SLOT,
    defaultTeamSlot,
    resolvePlayerSlots,
} from '../calculators/dpsEnemyPlacement';
import { defaultEnemySlot, resolveEnemySlots } from '../calculators/healingPlacement';
import type { CombatEngineInput } from './engine';
import type { Position } from '../../types/encounters';

/**
 * Resolve one side's board.
 *
 * `wanted[0]` is the side's ANCHOR (the focus attacker, or the first enemy) and keeps its slot;
 * `resolvePlayerSlots` pushes any later colliding actor to the first free cell. The enemy side
 * goes through `resolveEnemySlots`, which delegates to the same resolver — sides are independent
 * coordinate spaces, which is exactly why both anchor on `M4` without conflicting.
 *
 * Explicit positions win: `explicit[i] ?? fallback(i)` is computed BEFORE collision resolution, so
 * an actor the caller placed only ever moves for the same reason it would have moved before this
 * module existed — another actor already holds its cell.
 */
function placeSide(
    explicit: ReadonlyArray<Position | undefined>,
    anchor: Position,
    walkBack: (index: number) => Position,
    resolve: (slots: ReadonlyArray<Position>) => Position[]
): Position[] {
    const wanted = explicit.map((p, i) => p ?? (i === 0 ? anchor : walkBack(i - 1)));
    return resolve(wanted);
}

export function normalizeCombatRoster(input: CombatEngineInput): CombatEngineInput {
    const teamActors = input.teamActors ?? [];
    const enemyAttackers = input.enemyAttackers ?? [];

    // Player side: the focus attacker is index 0 (the anchor), team actors follow in input order.
    const playerSlots = placeSide(
        [input.position, ...teamActors.map((t) => t.position)],
        DEFAULT_ATTACKER_SLOT,
        defaultTeamSlot,
        resolvePlayerSlots
    );
    const [focusSlot, ...teamSlots] = playerSlots;

    // Enemy side: its own board, resolved separately.
    const enemySlots = enemyAttackers.length
        ? placeSide(
              enemyAttackers.map((e) => e.position),
              DEFAULT_ENEMY_SLOT,
              defaultEnemySlot,
              resolveEnemySlots
          )
        : [];

    return {
        ...input,
        position: focusSlot,
        ...(input.teamActors
            ? { teamActors: input.teamActors.map((t, i) => ({ ...t, position: teamSlots[i] })) }
            : {}),
        ...(input.enemyAttackers
            ? {
                  enemyAttackers: input.enemyAttackers.map((e, i) => ({
                      ...e,
                      position: enemySlots[i],
                  })),
              }
            : {}),
    };
}
```

> **Note on `walkBack(i - 1)`:** `defaultTeamSlot(0)` returns `'M3'`, the first slot *behind* the attacker's `M4`. The array passed to `placeSide` has the anchor at index 0, so the Nth team actor sits at array index `N+1` and must ask for `defaultTeamSlot(N)` — hence `i - 1`. The same holds for `defaultEnemySlot`, whose order *starts* at `'M4'`; index 0 takes the anchor branch, so its first walk-back call is `defaultEnemySlot(0)` → `'M4'`, which then loses the collision to the anchor and gets pushed to a free cell. That is correct but wasteful; Step 5 tightens it.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/utils/combat/__tests__/normalizeRoster.test.ts`
Expected: PASS — 8 tests.

If "walks later enemies back" fails with duplicate slots, the `i - 1` offset is the cause — read the note above.

- [ ] **Step 5: Tighten the enemy walk-back offset**

`defaultEnemySlot`'s order begins with `'M4'`, which is also `DEFAULT_ENEMY_SLOT`. Passing `defaultEnemySlot(i - 1)` therefore asks the second enemy for `'M4'` — already taken — and relies on the collision resolver to bail it out, which places it by `ATTACKER_SLOT_OPTIONS` order (`T1`) rather than the intended walk-back order (`T4`). Use the array index directly for the enemy side:

```ts
    const enemySlots = enemyAttackers.length
        ? placeSide(
              enemyAttackers.map((e) => e.position),
              DEFAULT_ENEMY_SLOT,
              (i) => defaultEnemySlot(i + 1),
              resolveEnemySlots
          )
        : [];
```

Add the fencing test to `normalizeRoster.test.ts`:

```ts
    it('walks enemies back in defaultEnemySlot order, not collision-resolver order', () => {
        const out = normalizeCombatRoster(
            baseInput({ enemyAttackers: [enemyInput('e1'), enemyInput('e2'), enemyInput('e3')] })
        );
        // defaultEnemySlot order is ['M4','T4','B4',...]; index 0 takes the anchor.
        expect(out.enemyAttackers!.map((e) => e.position)).toEqual(['M4', 'T4', 'B4']);
    });
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/utils/combat/__tests__/normalizeRoster.test.ts`
Expected: PASS — 9 tests.

- [ ] **Step 7: Commit**

```bash
git add src/utils/combat/normalizeRoster.ts src/utils/combat/__tests__/normalizeRoster.test.ts
git commit -m "feat(engine): normalizeCombatRoster auto-places position-less actors (SP-4b-1)"
```

---

## Task 2: The module — targeting synthesis

**Files:**
- Modify: `src/utils/combat/normalizeRoster.ts`
- Test: `src/utils/combat/__tests__/normalizeRoster.test.ts`

**Interfaces:**
- Consumes: Task 1's `normalizeCombatRoster`.
- Produces: same signature; the returned input now also carries `target`/`pattern` on the focus, each team actor, and each enemy attacker.

- [ ] **Step 1: Write the failing test**

Append to `src/utils/combat/__tests__/normalizeRoster.test.ts`:

```ts
import {
    DEFAULT_FRONT_ENEMY_TARGET,
    DEFAULT_BASE_PATTERN,
} from '../../calculators/dpsEnemyPlacement';

describe('normalizeCombatRoster — targeting synthesis', () => {
    it('gives a target-less focus the front-enemy default and the base pattern', () => {
        const out = normalizeCombatRoster(baseInput({ enemyAttackers: [enemyInput('e1')] }));
        expect(out.target).toEqual(DEFAULT_FRONT_ENEMY_TARGET);
        expect(out.pattern).toEqual(DEFAULT_BASE_PATTERN);
    });

    it('gives target-less enemies the same defaults (side is relative to the actor)', () => {
        const out = normalizeCombatRoster(baseInput({ enemyAttackers: [enemyInput('e1')] }));
        expect(out.enemyAttackers?.[0].target).toEqual(DEFAULT_FRONT_ENEMY_TARGET);
        expect(out.enemyAttackers?.[0].pattern).toEqual(DEFAULT_BASE_PATTERN);
    });

    it('synthesizes a pattern with range 0 — "base|1|" has no offset table and throws', () => {
        const out = normalizeCombatRoster(baseInput({ enemyAttackers: [enemyInput('e1')] }));
        expect(out.pattern?.range).toBe(0);
    });

    it('NEVER substitutes a target the caller supplied, including an ally-side one', () => {
        const allySide = { raw: 'lowest hp ally', side: 'ally', selection: 'lowest-hp' } as never;
        const out = normalizeCombatRoster(
            baseInput({ target: allySide, enemyAttackers: [enemyInput('e1')] })
        );
        // Substituting here is the healing ADAPTER's policy, not the boundary's. A battle-sim
        // support ship must keep targeting allies.
        expect(out.target).toBe(allySide);
    });

    it('NEVER synthesizes the charged axes — undefined there means "reuse the active axis"', () => {
        const out = normalizeCombatRoster(baseInput({ enemyAttackers: [enemyInput('e1')] }));
        expect(out.enemyAttackers?.[0].chargedTarget).toBeUndefined();
        expect(out.enemyAttackers?.[0].chargedPattern).toBeUndefined();
    });

    it('fills a missing pattern even when the target was supplied, and vice versa', () => {
        const explicitTarget = { raw: 'back enemy', side: 'enemy', selection: 'back' } as never;
        const out = normalizeCombatRoster(
            baseInput({ target: explicitTarget, enemyAttackers: [enemyInput('e1')] })
        );
        // Both axes are independently required for a positional cast, and a missing PATTERN fails
        // silently — perTargetDealt comes back empty while the damage number looks plausible.
        expect(out.target).toBe(explicitTarget);
        expect(out.pattern).toEqual(DEFAULT_BASE_PATTERN);
    });

    it('gives target-less team actors the defaults too', () => {
        const out = normalizeCombatRoster(
            baseInput({ enemyAttackers: [enemyInput('e1')], teamActors: [{ id: 't1' }] as never })
        );
        expect(out.teamActors?.[0].target).toEqual(DEFAULT_FRONT_ENEMY_TARGET);
        expect(out.teamActors?.[0].pattern).toEqual(DEFAULT_BASE_PATTERN);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/utils/combat/__tests__/normalizeRoster.test.ts -t "targeting synthesis"`
Expected: FAIL — `expected undefined to equal { raw: 'front enemy', … }`.

- [ ] **Step 3: Write the implementation**

In `src/utils/combat/normalizeRoster.ts`, extend the imports and add the helper:

```ts
import {
    DEFAULT_ATTACKER_SLOT,
    DEFAULT_ENEMY_SLOT,
    DEFAULT_BASE_PATTERN,
    DEFAULT_FRONT_ENEMY_TARGET,
    defaultTeamSlot,
    resolvePlayerSlots,
} from '../calculators/dpsEnemyPlacement';
import type { ParsedPattern, ParsedTarget } from '../targetingParser';
```

```ts
/**
 * Fill the ACTIVE targeting axes when the caller supplied none.
 *
 * Both are load-bearing and independently required: `selectTurnTarget` needs
 * `isPositional(...) && target` (no target → falls back to the dummy), and the positional APPLY
 * gate additionally needs `pattern != null`. With a target but no pattern the cast resolves onto
 * the real enemy and still credits `cumulativeDamage` through the legacy sink, but never runs the
 * per-victim apply — so `perTargetDealt` comes back EMPTY while the damage number looks plausible.
 * That is why the two are filled independently rather than as a pair.
 *
 * FILL, never SUBSTITUTE. An ally-side target the caller supplied is kept: rewriting it to the
 * front-enemy default is the healing adapter's matchup POLICY (`offensiveTarget`), not this
 * boundary's business, and doing it here would stop a battle-sim support ship from healing.
 *
 * The CHARGED axes are deliberately untouched. `undefined` there is meaningful — the engine's
 * fallback is "charged axis absent ⇒ reuse the active one" — so a default would silently override
 * a charged-axis-less actor's active binding.
 */
function withTargeting<T extends { target?: ParsedTarget; pattern?: ParsedPattern }>(actor: T): T {
    return {
        ...actor,
        target: actor.target ?? DEFAULT_FRONT_ENEMY_TARGET,
        pattern: actor.pattern ?? DEFAULT_BASE_PATTERN,
    };
}
```

Then thread it through the return, replacing the object built in Task 1:

```ts
    return {
        ...withTargeting(input),
        position: focusSlot,
        ...(input.teamActors
            ? {
                  teamActors: input.teamActors.map((t, i) => ({
                      ...withTargeting(t),
                      position: teamSlots[i],
                  })),
              }
            : {}),
        ...(input.enemyAttackers
            ? {
                  enemyAttackers: input.enemyAttackers.map((e, i) => ({
                      ...withTargeting(e),
                      position: enemySlots[i],
                  })),
              }
            : {}),
    };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/utils/combat/__tests__/normalizeRoster.test.ts`
Expected: PASS — 16 tests.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0, no output.

If `withTargeting(input)` complains that `CombatEngineInput` is not assignable to the generic constraint, the cause is `target`/`pattern` being declared on the input at `engine.ts:1327-1332` with a narrower type than `ParsedTarget | undefined` — read those lines and widen the constraint rather than casting.

- [ ] **Step 6: Commit**

```bash
git add src/utils/combat/normalizeRoster.ts src/utils/combat/__tests__/normalizeRoster.test.ts
git commit -m "feat(engine): normalizeCombatRoster synthesizes missing active targeting (SP-4b-1)"
```

---

## Task 3: Wire the boundary into `runCombat`

This is the task that produces the churn. It is deliberately a **separate commit** from the module so that `git show` on this commit is exactly "the boundary went live", and the fixture churn in Task 5 can be diffed against it.

**Files:**
- Modify: `src/utils/combat/engine.ts:1678`
- Create: `src/utils/combat/__testutils__/bareRosterFixture.ts`
- Create: `src/utils/combat/__tests__/normalizationBoundary.integration.test.ts`

**Interfaces:**
- Consumes: `normalizeCombatRoster` from Task 2.
- Produces: no signature change to `runCombat`. Exports `bareInput`, `bareEnemy`, `damageKit` from `__testutils__/bareRosterFixture` — Task 4 consumes them.

- [ ] **Step 1: Write the failing test**

First create the shared fixture module `src/utils/combat/__testutils__/bareRosterFixture.ts` — Task 4 imports it too, and it must NOT live in a `.test.ts` file (importing one executes its `describe` blocks as a side effect, running the suites twice under two different files and two different seeds):

```ts
/**
 * The "bare roster" shape: no positions, no targeting, one real enemy — what 54 fixture files
 * pass to `runCombat` today. Shared by the boundary and dummy-reachability suites so the two
 * agree on exactly what an under-specified caller looks like.
 */
import type { CombatEngineInput, ShipSkills } from '../engine';

export const damageKit = (): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                {
                    id: 'a1',
                    type: 'damage',
                    target: 'enemy',
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'damage', multiplier: 100 },
                },
            ],
        },
    ],
});

/** No position, no target, no pattern. */
export const bareEnemy = () => [
    {
        id: 'e1',
        stats: { attack: 0, crit: 0, critDamage: 0, speed: 10, defence: 0, hp: 500_000 },
        chargeCount: 0,
        startCharged: false,
    },
];

export const bareInput = (): CombatEngineInput =>
    ({
        attack: 10_000,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: 0,
        shipSkills: damageKit(),
        numRounds: 2,
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
        hp: 1_000_000,
        enemyAttackers: bareEnemy(),
    }) as CombatEngineInput;
```

Then create `src/utils/combat/__tests__/normalizationBoundary.integration.test.ts`:

```ts
/**
 * SP-4b-1: the boundary is live — a caller that supplies NO positions and NO targeting still gets
 * a fully positional run. Pre-boundary, this fixture routed the focus's cast into the dummy sink:
 * `perTargetDealt` came back empty while `rawTotals.cumulative` looked plausible.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { setupKeyedTestRng } from '../../calculators/rateAccumulator';
import { bareInput, bareEnemy } from '../__testutils__/bareRosterFixture';
import type { CombatEngineInput } from '../engine';

describe('the normalization boundary is live in runCombat', () => {
    beforeEach(() => {
        setupKeyedTestRng(12345);
    });

    it('routes a position-less, targeting-less roster per-victim instead of into the sink', () => {
        const { rounds } = runCombat(bareInput());

        // perTargetDealt is the discriminator. Pre-boundary it was EMPTY for this input.
        const dealt = rounds.flatMap((r) =>
            Object.entries(r.perTargetDealt ?? {}).flatMap(([source, byVictim]) =>
                Object.entries(byVictim as Record<string, number>).map(([victim, amount]) => ({
                    source,
                    victim,
                    amount,
                }))
            )
        );
        expect(dealt.length).toBeGreaterThan(0);
        expect(dealt.every((d) => d.victim === 'e1')).toBe(true);
        expect(dealt.some((d) => d.amount > 0)).toBe(true);
    });

    it('never routes damage to the dummy when a roster is supplied', () => {
        const { rounds } = runCombat(bareInput());
        const victims = rounds.flatMap((r) =>
            Object.values(r.perTargetDealt ?? {}).flatMap((byVictim) =>
                Object.keys(byVictim as Record<string, number>)
            )
        );
        expect(victims).not.toContain('enemy');
    });

    it('leaves an explicitly-positioned run byte-identical', () => {
        const explicit = {
            ...bareInput(),
            position: 'B1',
            enemyAttackers: [{ ...bareEnemy()[0], position: 'T2' }],
        } as CombatEngineInput;

        setupKeyedTestRng(12345);
        const before = runCombat(explicit);
        setupKeyedTestRng(12345);
        const after = runCombat(explicit);
        expect(after.rawTotals).toEqual(before.rawTotals);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/utils/combat/__tests__/normalizationBoundary.integration.test.ts`
Expected: FAIL on the first test — `expected 0 to be greater than 0` (`perTargetDealt` is empty because the cast fell back to `legacyVictim`).

**If it PASSES before the wiring, stop.** That means the fixture is already positional and proves nothing — recheck that neither `position` nor `target` is set anywhere in `bareInput`.

- [ ] **Step 3: Wire it in**

In `src/utils/combat/engine.ts`, change the `runCombat` signature at line 1678 from:

```ts
export function runCombat(input: CombatEngineInput): {
```

to:

```ts
export function runCombat(rawInput: CombatEngineInput): {
```

Then, immediately after the return-type block's opening `{` at line 1707 — i.e. as the **first statement in the body**, before the `const { … } = input;` destructure at 1708 — insert:

```ts
    /**
     * SP-4b: the ONE accommodation boundary. Everything below this line sees a fully positional
     * world — every actor has a slot and active targeting — regardless of how under-specified the
     * caller's input was. Rebinding to `input` means every existing `input.x` read below picks up
     * the normalized values with no further edits.
     *
     * Deliberately the FIRST statement: actor construction (`createActor`, ~line 1779) consumes
     * `input.position`, and `teamTargetById` / `enemyTargetById` consume the target axes.
     */
    const input = normalizeCombatRoster(rawInput);
```

Add the import near the other `./` imports at the top of `engine.ts`:

```ts
import { normalizeCombatRoster } from './normalizeRoster';
```

- [ ] **Step 4: Run the boundary test to verify it passes**

Run: `npx vitest run src/utils/combat/__tests__/normalizationBoundary.integration.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

A circular-import error between `engine.ts` and `normalizeRoster.ts` is expected to be absent — `normalizeRoster.ts` imports only the **type** `CombatEngineInput` from `./engine`, which erases at compile time. If a runtime cycle does appear, move `CombatEngineInput` to a types module rather than duplicating it.

- [ ] **Step 6: Capture the churn baseline — do NOT fix anything yet**

Run: `npm test 2>&1 | tee /tmp/sp4b1-churn.txt | tail -40`

Expected: a substantial number of failures across the ~54 bare-enemy fixture files. **This is the expected outcome, not a problem.** Record the count:

```bash
grep -c "^ *×" /tmp/sp4b1-churn.txt
grep "^ *×" /tmp/sp4b1-churn.txt | sed 's/ > .*//' | sort -u > /tmp/sp4b1-failing-files.txt
wc -l /tmp/sp4b1-failing-files.txt
```

**Gate:** the failing files must be a subset of the 54 bare-enemy set plus the 18 no-enemy set. A failure in a file that already carried positions is a **defect in the module**, not churn — investigate it before proceeding. Re-derive the sets with:

```bash
node -e "
const {readdirSync,readFileSync,statSync}=require('fs'),{join}=require('path');
const walk=(d,o=[])=>{for(const e of readdirSync(d)){const f=join(d,e);statSync(f).isDirectory()?walk(f,o):/\.tsx?$/.test(e)&&o.push(f)}return o};
for(const f of walk('src')){const s=readFileSync(f,'utf8');
if(!/\brunCombat\s*\(/.test(s)||f.endsWith('combat/engine.ts'))continue;
console.log((!/enemyAttackers/.test(s)?'NO_ENEMY':/position\s*:/.test(s)?'POSITIONED':'BARE')+' '+f)}
" | sort > /tmp/sp4b1-caller-classes.txt
```

- [ ] **Step 7: Commit the wiring alone (tests still red)**

The pre-commit hook runs the full suite and will block this. Commit with `--no-verify` — this is the one commit in the plan that is knowingly red, and Task 5 makes it green:

```bash
git add src/utils/combat/engine.ts src/utils/combat/__tests__/normalizationBoundary.integration.test.ts
git commit --no-verify -m "feat(engine): call normalizeCombatRoster at the top of runCombat (SP-4b-1)

Fixture churn follows in the next commit. This commit is knowingly red so that
'the boundary went live' is one reviewable diff, separate from the audited churn."
```

---

## Task 4: The dummy-reachability counter

Before auditing 54 files by hand, instrument the thing the audit is really about: **is anything still falling back to the dummy?** This counter is 4c's entry gate, and it turns Task 5 from "make the tests green" into "make the fallback stop being taken".

**Files:**
- Modify: `src/utils/combat/engine.ts` (the `selected ?? tb.legacyVictim` site, ~`6265`/`6279`)
- Create: `src/utils/combat/__tests__/dummyReachability.test.ts`

**Interfaces:**
- Produces: `export function __getLegacyVictimFallbackCount(): number` and `export function __resetLegacyVictimFallbackCount(): void` from `engine.ts` — test-only, prefixed like the existing `__testTapActors` convention.

- [ ] **Step 1: Write the failing test**

Create `src/utils/combat/__tests__/dummyReachability.test.ts`:

```ts
/**
 * SP-4b-1 → SP-4c gate. Cluster C (`selected ?? tb.legacyVictim`) is the KEYSTONE: once nothing
 * takes that fallback, clusters B/D/E/F/G fall out behind it and 4c is pure deletion.
 *
 * This file pins what 4b-1 can actually guarantee: a run with a NON-EMPTY enemy roster never takes
 * it. Runs with no enemy at all still do — that is 4b-2's job, and the second test pins the
 * fallback as still-live so this file cannot silently go vacuous before then.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
    runCombat,
    __getLegacyVictimFallbackCount,
    __resetLegacyVictimFallbackCount,
} from '../engine';
import { setupKeyedTestRng } from '../../calculators/rateAccumulator';
// Fixtures live in __testutils__, NOT in the other test file. Importing from a `.test.ts`
// module executes its `describe` blocks as an import side effect — the suites would run twice,
// under two different files, with two different seeds.
import { bareInput } from '../__testutils__/bareRosterFixture';

describe('dummy reachability after normalization', () => {
    beforeEach(() => {
        setupKeyedTestRng(12345);
        __resetLegacyVictimFallbackCount();
    });

    it('never takes the legacyVictim fallback when an enemy roster is supplied', () => {
        runCombat(bareInput());
        expect(__getLegacyVictimFallbackCount()).toBe(0);
    });

    it('STILL takes it with an empty roster — 4b-2 closes this, and the counter proves it is live', () => {
        // Without this, the assertion above could pass because the counter was never wired.
        const noEnemy = { ...bareInput(), enemyAttackers: [] };
        runCombat(noEnemy);
        expect(__getLegacyVictimFallbackCount()).toBeGreaterThan(0);
    });
});
```

No fixture changes needed — `bareInput` already lives in `src/utils/combat/__testutils__/bareRosterFixture.ts` (created in Task 3) and is imported by both suites.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/utils/combat/__tests__/dummyReachability.test.ts`
Expected: FAIL — `__getLegacyVictimFallbackCount is not a function`.

- [ ] **Step 3: Wire the counter**

In `engine.ts`, near the other test-only hooks, add:

```ts
/**
 * TEST-ONLY instrumentation for the SP-4 ladder. Counts how many times a turn resolved its victim
 * through `tb.legacyVictim` — the dummy fallback (cluster C, the keystone). SP-4c can only be pure
 * deletion once this is zero for every run, so the number is the ladder's gate, not a debug aid.
 * Module-level and NOT reset per run: `__resetLegacyVictimFallbackCount` is the test's job.
 */
let legacyVictimFallbackCount = 0;
export function __getLegacyVictimFallbackCount(): number {
    return legacyVictimFallbackCount;
}
export function __resetLegacyVictimFallbackCount(): void {
    legacyVictimFallbackCount = 0;
}
```

Then find every `selected ?? tb.legacyVictim` site (grep: `grep -n "legacyVictim" src/utils/combat/engine.ts` — expect them around 6244, 6265, 6279, 6523) and change the resolution expression from:

```ts
const victim = selected ?? tb.legacyVictim;
```

to:

```ts
if (selected == null) legacyVictimFallbackCount++;
const victim = selected ?? tb.legacyVictim;
```

Apply the increment at **every** site that reads `?? tb.legacyVictim`, not just the first — a counter wired at one of four sites reports zero for the other three and would hand 4c a false green.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/utils/combat/__tests__/dummyReachability.test.ts`
Expected: PASS — 2 tests. If the *second* test fails (count is 0 with an empty roster), the counter is not wired at the site that actually fires — grep again and check you covered all four.

- [ ] **Step 5: Commit**

```bash
git add src/utils/combat/engine.ts src/utils/combat/__tests__/dummyReachability.test.ts src/utils/combat/__tests__/normalizationBoundary.integration.test.ts
git commit --no-verify -m "test(engine): count legacyVictim fallback takes — the 4c entry gate (SP-4b-1)"
```

---

## Task 5: Audit the churn, one moved number at a time

**Files:**
- Modify: the ~54 fixture files from `/tmp/sp4b1-failing-files.txt`

**The rule, from the epic's standing ruling:** every moved number must be explained by the **stated cause** —

> *the cast now routes positionally onto a real, placed enemy instead of into the legacy dummy sink.*

A move **not** explained by that is a defect, not something to re-pin. **Never `vitest -u`.**

- [ ] **Step 1: Classify the failures before touching any of them**

```bash
npm test 2>&1 | tee /tmp/sp4b1-churn.txt
grep "^ *×" /tmp/sp4b1-churn.txt | sed 's/ > .*//' | sort | uniq -c | sort -rn
```

Sort each failing file into exactly one bucket and write the list to `.superpowers/sdd/sp4b1-churn-audit.md`:

| Bucket | Signature | Correct response |
| --- | --- | --- |
| **1. Damage now lands per-victim** | `perTargetDealt` gained entries; `rawTotals.cumulative` dropped toward 0 | Re-derive the assertion on `perTargetDealt` (use `src/utils/combat/__testutils__/perTargetDealt.ts` — `dealtEntries`/`dealtBy`/`dealtBySource`), never on the scalar |
| **2. Magnitude changed** | same victim, different number | The enemy's real `defence`/`hp` now apply instead of the sink's. **Verify the new number against the enemy's actual stats** before accepting it |
| **3. Turn order changed** | an extra or missing turn | The dummy left the turn order (`dummyEnemyIsVestigial` flipped). Expected — confirm the dropped turn is the dummy's and not a real actor's |
| **4. Anything else** | — | **STOP. This is a defect.** Investigate the module before continuing |

- [ ] **Step 2: Fix bucket 1 files**

For each: replace scalar-total assertions with per-victim ones. The shared util already exists — do not re-write the nested-reduce walk (CodeRabbit's nitpick on #318, and it was right):

```ts
import { dealtBy, dealtBySource } from '../__testutils__/perTargetDealt';
// was: expect(rawTotals.cumulative).toBe(15600)
expect(dealtBy(rounds, 'e1')).toBe(15600);
```

When migrating an assertion to the new channel, **assert the OLD channel is now empty**. The two destinations are mutually exclusive per proc, so `dealt > 0` alone would still pass if a future change re-credited both and double-counted:

```ts
expect(dealtBy(rounds, 'e1')).toBeGreaterThan(0);
expect(dealtBy(rounds, 'enemy')).toBe(0);
```

And extend any **negative controls** to the new channel too, or they go vacuous.

- [ ] **Step 3: Run the suite; commit bucket 1**

Run: `npm test 2>&1 | grep -E "^ +(Test Files|Tests) "`
Expected: failure count reduced by the bucket-1 file count; no NEW files failing.

```bash
git add -u && git commit --no-verify -m "test(engine): re-derive sink assertions on perTargetDealt (SP-4b-1 churn, bucket 1)"
```

- [ ] **Step 4: Fix bucket 2 files, verifying each magnitude**

For each moved number, compute the expectation by hand from the enemy's real stats before accepting it. A number that does not reconcile is bucket 4.

Record each in the audit file as `file:line — was N, now M, because <enemy defence D vs sink 10_000>`.

- [ ] **Step 5: Run the suite; commit bucket 2**

Run: `npm test 2>&1 | grep -E "^ +(Test Files|Tests) "`

```bash
git add -u && git commit --no-verify -m "test(engine): re-pin magnitudes against real enemy stats (SP-4b-1 churn, bucket 2)"
```

- [ ] **Step 6: Fix bucket 3 files**

Confirm in each case that the dropped turn belongs to the dummy (id `'enemy'`) and not a real actor, then adjust the expected turn counts.

- [ ] **Step 7: Full green**

Run: `npm test`
Expected: **all files pass.** Also confirm the snapshot gate:

```bash
git status --short -- '*.snap' | wc -l
```

Expected: `0`. The repo has only 5 `.snap` files and **none covers a direct `runCombat` fixture**, so this gate is load-bearing for the 3 production callers and **empty** for the 54 migrated direct-engine files. Say exactly that in the PR body — do not let "zero snapshot movement" imply more than it does.

- [ ] **Step 8: Commit**

```bash
git add -u && git commit -m "test(engine): audited turn-order churn from the vestigial dummy (SP-4b-1 churn, bucket 3)"
```

(No `--no-verify` — the suite is green from here on.)

---

## Task 6: Fence the boundary in both directions

A widened gate proves nothing unless the strict side is fenced too. This is the lesson #318 paid for: too strict fails the new test, too loose fails 8 assertions across 3 files, and only the **pair** proves the signal is the narrowest correct one.

**Files:**
- Modify: `src/utils/combat/__tests__/normalizeRoster.test.ts`

- [ ] **Step 1: Write the fencing tests**

```ts
describe('normalizeCombatRoster — fenced in both directions', () => {
    it('TOO LOOSE would move explicit positions: a full explicit board is returned unchanged', () => {
        const input = baseInput({
            position: 'T1' as never,
            teamActors: [{ id: 't1', position: 'T2' }] as never,
            enemyAttackers: [enemyInput('e1', 'B3'), enemyInput('e2', 'B4')],
        });
        const out = normalizeCombatRoster(input);
        expect(out.position).toBe('T1');
        expect(out.teamActors?.[0].position).toBe('T2');
        expect(out.enemyAttackers?.map((e) => e.position)).toEqual(['B3', 'B4']);
    });

    it('TOO STRICT would skip mixed rosters: it places only the actors that lack a position', () => {
        const out = normalizeCombatRoster(
            baseInput({
                enemyAttackers: [enemyInput('e1', 'B3'), enemyInput('e2')],
            })
        );
        expect(out.enemyAttackers?.[0].position).toBe('B3');
        expect(out.enemyAttackers?.[1].position).toBeDefined();
        expect(out.enemyAttackers?.[1].position).not.toBe('B3');
    });

    it('an explicit position still loses a genuine collision — pre-existing resolver behaviour', () => {
        const out = normalizeCombatRoster(
            baseInput({
                position: 'M4' as never,
                teamActors: [{ id: 't1', position: 'M4' }] as never,
                enemyAttackers: [enemyInput('e1')],
            })
        );
        // The anchor (index 0) keeps its cell; the later actor is pushed to a free one.
        expect(out.position).toBe('M4');
        expect(out.teamActors?.[0].position).not.toBe('M4');
    });
});
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run src/utils/combat/__tests__/normalizeRoster.test.ts`
Expected: PASS — 19 tests.

- [ ] **Step 3: Commit**

```bash
git add src/utils/combat/__tests__/normalizeRoster.test.ts
git commit -m "test(engine): fence normalizeCombatRoster in both directions (SP-4b-1)"
```

---

## Task 7: Retire the now-redundant adapter fills

The spec's principle is "the engine accommodates in exactly **one** place". Three adapters currently do their own filling; the parts that normalization now provably covers should go, and the parts that are caller **policy** must stay.

**Files:**
- Modify: `src/utils/calculators/dpsSimulator.ts:487-512`
- Modify: `src/utils/calculators/healingEngineAdapter.ts:451`, `:498`, `:553`

**Remove** (now redundant — normalization fills exactly these):
- `pattern: e.pattern ?? DEFAULT_BASE_PATTERN` and its siblings, in both adapters.
- `dpsSimulator.ts`'s `?? ((input.enemyAttackers?.length ?? 0) > 0 ? DEFAULT_ATTACKER_SLOT : undefined)` position/target/pattern trio.

**Keep** (policy, not accommodation — deleting these is a behaviour change, not a cleanup):
- `healingEngineAdapter.ts:399-405`'s `offensiveTarget` / `chargedOffensiveTarget` **ally-side substitution**. Normalization only fills absent axes; rewriting an ally-side target to the front-enemy default is the healing calculator's matchup rule, and 20 support ships have an ally-side active target.
- The `LEGACY_SINK_DEFENCE` / `LEGACY_SINK_HP` / `LEGACY_SINK_SECURITY` stat fallbacks. Those are **stats**, and §4.1(c) says normalization does not fill in stats.

- [ ] **Step 1: Remove one adapter's redundant fills**

Start with `dpsSimulator.ts`. Delete the three `?? (…)` accommodation expressions at 496, 505, 512, leaving the caller's own explicit values.

- [ ] **Step 2: Run the suite**

Run: `npm test`
Expected: **PASS with zero movement.** Zero movement is the proof the two derivations were equivalent.

**If anything moves, they were NOT equivalent — that is a finding, not a re-pin.** Read the moved assertion, work out which of the two fills differed, and record it in the audit file. The most likely divergence: the adapter gated its fills on `enemyAttackers.length > 0`, whereas normalization always fills. A DPS run with no enemies now gets a position where it previously got `undefined`.

- [ ] **Step 3: Commit**

```bash
git add src/utils/calculators/dpsSimulator.ts
git commit -m "refactor(dps): drop the adapter fills the engine boundary now provides (SP-4b-1)"
```

- [ ] **Step 4: Repeat for `healingEngineAdapter.ts`**

Delete only the `?? DEFAULT_BASE_PATTERN` fills at 451, 498, 553. Leave `offensiveTarget` and the `LEGACY_SINK_*` stat fallbacks exactly as they are.

- [ ] **Step 5: Run the suite**

Run: `npm test`
Expected: PASS with zero movement, including `healingGoldenParity.test.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/utils/calculators/healingEngineAdapter.ts
git commit -m "refactor(healing): drop the adapter pattern fills the boundary now provides (SP-4b-1)"
```

---

## Task 8: Comment sweep and verification

Deleting a fallback obliges a comment sweep — and a comment block documenting a deferred gap accumulates staleness in its **neighbours**, so sweep the claims *around* each site, not just the site's own note.

**Files:**
- Modify: `src/utils/combat/engine.ts` (comments only)

- [ ] **Step 1: Find the claims this PR falsified**

```bash
grep -n "legacyVictim\|falls back to the dummy\|however well-positioned\|short-circuits to" src/utils/combat/engine.ts src/utils/calculators/*.ts
```

Two kinds, handled differently:
- **Describes CURRENT behaviour** → rewrite. e.g. `dpsEnemyPlacement.ts`'s "with no ParsedTarget it short-circuits to `legacyVictim`" is now unreachable for engine callers — say so, and say the boundary is why.
- **Historical rationale** → **KEEP the history**, gloss it. Never delete rationale to make a grep clean.

- [ ] **Step 2: Verify the gate is prose-vs-code, not "prints nothing"**

```bash
grep -n "legacyVictim" src/utils/combat/engine.ts | grep -v "^\s*[0-9]*:\s*[/*]"
```

Expected: only real code sites (cluster C, to be deleted in 4c) — no stale prose claiming a behaviour this PR changed.

- [ ] **Step 3: Full verification**

```bash
npm test
npx tsc --noEmit
npx eslint src
git status --short -- '*.snap' | wc -l
```

Expected: all tests pass; tsc exit 0; eslint clean; `0` snapshot files moved.

- [ ] **Step 4: Confirm the reachability gate for 4c**

Run: `npx vitest run src/utils/combat/__tests__/dummyReachability.test.ts`
Expected: PASS — the fallback count is 0 for every roster-bearing run.

- [ ] **Step 5: Browser-verify the two calculator pages**

The DPS page carries unverified-in-UI commits from earlier in this epic, and this PR changes routing under both calculators.

```bash
npm start
```

Visit `/damage` and the healing calculator. Confirm a run produces non-zero damage and the enemy HP bar declines. This is a smoke check, not a numeric audit.

- [ ] **Step 6: Commit**

```bash
git add -u
git commit -m "docs(engine): sweep comments falsified by the normalization boundary (SP-4b-1)"
```

---

## Task 9: Open the PR

- [ ] **Step 1: Push and open**

```bash
gh auth switch --user TheSusort
git push -u origin HEAD
gh pr create --title "feat(engine): one normalization boundary makes every run positional (SP-4b-1)" --body "$(cat <<'EOF'
## What

Adds `normalizeCombatRoster` — the single place the engine accommodates an under-specified input.
Called on the first line of `runCombat`, it auto-places position-less actors and synthesizes
missing ACTIVE targeting. Everything below it sees a fully positional world.

Second step of the SP-4 ladder (4a `bf53a8a5` → **4b-1** → 4b-2 → 4c → 4d → 4e). `enemyAttackers`
stays optional here; 4b-2 makes it required, and 4c then deletes the dummy as pure deletion.

## Churn

**Expected and audited: ~54 fixture files.** Every moved number is explained by one stated cause —
the cast now routes positionally onto a real, placed enemy instead of into the legacy dummy sink.
The per-file audit is in `.superpowers/sdd/sp4b1-churn-audit.md`, bucketed by signature. No
`vitest -u` was used.

**Snapshot gate, stated honestly:** zero `.snap` movement — but the repo has only 5 `.snap` files
and none covers a direct `runCombat` fixture. That gate is load-bearing for the 3 production
callers and EMPTY for the 54 migrated direct-engine files.

## The 4c gate

`__getLegacyVictimFallbackCount` counts takes of `selected ?? tb.legacyVictim` (cluster C, the
keystone). It is now 0 for every run with a non-empty enemy roster. `dummyReachability.test.ts`
also pins that an EMPTY roster still takes it — so the counter cannot go vacuous before 4b-2
closes that path.

## Not in scope

- `enemyAttackers` becoming required (4b-2)
- Deleting the dummy (4c) — it still exists here, just unreachable for roster-bearing runs
- The healing adapter's ally-side `offensiveTarget` substitution and its `LEGACY_SINK_*` stat
  fallbacks: those are caller policy and stats respectively, not accommodation.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01V65xi1NsFW1sP32DYcxqug
EOF
)"
```

- [ ] **Step 2: Verify CodeRabbit actually reviewed HEAD**

This epic has produced **three** distinct variants of the green-check-reviewed-nothing trap: the rate-limit false green, the stale-range green, and (#322) a **>100-file PR that gets no review at all while its check passes**. Never trust the check.

```bash
gh pr view --json files --jq '.files | length'
```

If that is over 100, CodeRabbit will skip the review entirely — split the PR or accept the gap knowingly and say so.

Then confirm the review range against HEAD:

```bash
gh pr view --comments | grep -i "Reviewing files that changed"
git rev-parse HEAD
```

The range's head SHA must equal `HEAD`. Reading the walkthrough prose to confirm it describes *your* diff is the cheaper cross-check.

---

## SP-4b-2 — the follow-on, for context only

Not this plan's scope; recorded so the ladder is legible.

- Make `enemyAttackers` **required** on `CombatEngineInput` (`§4.1(c)`: a missing roster is a caller error, not something to paper over).
- Migrate the **18** callers that pass none — give each a minimal real enemy.
- Tighten `dummyReachability.test.ts`: delete the "STILL takes it with an empty roster" test and assert the fallback count is **0 across the whole suite**.
- That zero is 4c's entry gate.

---

## Self-review notes

**Spec coverage.** §4.1(a) auto-placement → Task 1. §4.1(b) targeting synthesis → Task 2. §4.1(c) "nothing else" → fenced by Task 1's "never invents an enemy" test and Task 7's keep-list. §4.2 explicit `mode` → shipped in 4a. §5 cluster C reachability → Task 4. §7.3 "go find the test that should have moved" → Task 5 Step 1's bucket 4. Test 4a.3 (explicit positions not moved) → Task 6.

**Deliberately deferred to 4b-2:** required `enemyAttackers`, and therefore suite-wide fallback-count zero.

**Known soft spot.** `dummyEnemyIsVestigial` ANDs `hasPositionedEnemyRoster` with "every player actor has an enemy-side target". Normalization makes the first conjunct true whenever a roster exists, and fills a *missing* target — but it never rewrites an **ally-side** target, so an ally-targeting player keeps the dummy in the turn order even after this PR. That is correct and intended: 4c deletes the dummy outright, and an ally-targeting player then resolves an ally positionally. Do not "fix" it here by substituting ally-side targets — that would break battle-sim support ships.
