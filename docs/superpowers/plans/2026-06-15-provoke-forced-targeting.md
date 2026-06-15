# Provoke Forced-Targeting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Provoke forced-targeting mechanic (a provoked attacker must target whoever applied it) plus a uniform "ignores Taunt/Provoke" attacker capability to the positional combat engine.

**Architecture:** Extend the pure `resolvePositionalTarget` seam with an optional `acting` param carrying the attacker's ignore flag + pre-resolved provoker id. A new `provokerOf` query reads the provoked actor's own enemy-side debuff store for a `casterId`-bearing `'Provoke'`. The reactive-debuff path is fixed to stamp `casterId` so Guardian's reactive Provoke works. Capability-only — no production caller passes board positions yet, so DPS/healing goldens stay **byte-identical**.

**Tech Stack:** TypeScript, Vitest. Combat engine under `src/utils/combat/`.

**Spec:** `docs/superpowers/specs/2026-06-15-provoke-forced-targeting-design.md`

**Priority (locked, combat-system.md §9):** `Concentrate Fire → Taunt → Provoke → stealth`. Ignore suppresses Taunt + Provoke, never CF.

---

## Pre-flight (read first)

- **Workflow:** `gh auth switch --hostname github.com --user TheSusort` before any PR/merge/API op. `docs/` is gitignored → `git add -f` for spec/plan; docs-only commits use `--no-verify` (pre-commit hook runs full vitest). Dev server :3000.
- **Goldens are SYNTHETIC** (hand-built, no parser import): any diff = bug, NEVER `vitest -u`. This PR must leave them byte-identical.
- **Worktree:** Do this work on a branch in its own worktree off latest `main`. Symlink the gitignored `.env` + `docs/{ship-targeting,ship-skills,bios}.csv` + `docs/combat-system.md` from the main checkout into the worktree (else env-only test failures + pre-commit block). See [memory: project_combat_engine_current_state — WORKTREE ENV GOTCHA].
- **Files you will touch:**
  - Modify: `src/utils/combat/triggers.ts` (add `provokerOf`; stamp `casterId` on reactive-debuff branch ~849-856)
  - Modify: `src/utils/combat/positionalBinding.ts` (5th `acting` param + Provoke/ignore logic)
  - Modify: `src/utils/skillTextParser.ts` (add `detectIgnoresForcedTargeting`)
  - Modify: `src/utils/combat/state.ts` (`CombatActor.ignoresForcedTargeting` + `createActor`)
  - Modify: `src/utils/combat/engine.ts` (input types + 3 construction sites + 3 resolve sites)
  - Test: `src/utils/combat/positionalBinding.test.ts` (resolver units), `src/utils/combat/__tests__/forcedTargetingStatus.test.ts` (`provokerOf` units), `src/utils/combat/__tests__/positionalSelection.test.ts` (integration), parser test file
  - Modify: `src/constants/changelog.ts` (fold into the one combat `UNRELEASED_CHANGES` entry)

---

## Task 1: `provokerOf` query helper

Reads the provoked actor's OWN enemy-side debuff store for a `casterId`-bearing `'Provoke'`. The `casterId` is the provoker, mapped to a living opposing actor later by the resolver.

**Files:**
- Modify: `src/utils/combat/triggers.ts` (add next to `ownerDebuffNamesFor`, ~line 680)
- Test: `src/utils/combat/__tests__/forcedTargetingStatus.test.ts`

- [ ] **Step 1: Write the failing tests** (append a new `describe` block to `forcedTargetingStatus.test.ts`). Build the timed Provoke directly via `applyTimedAbilityStatus` (the ability path that carries `casterId` — the seeded `enemyDebuffs` ctor path does NOT carry one):

```ts
import { provokerOf } from '../triggers';
import type { RegisteredAbilityStatus } from '../statusEngine'; // adjust import to actual export

const timedProvoke = (casterId?: string): Extract<RegisteredAbilityStatus, { kind: 'timed' }> => ({
    payload: { buffName: 'Provoke', stacks: 1, parsedEffects: {} },
    side: 'enemy',
    sourceSlot: 'active',
    conditions: [],
    ...(casterId !== undefined ? { casterId } : {}),
    kind: 'timed',
    duration: 2,
});

describe('provokerOf', () => {
    it('returns the casterId of a Provoke debuff on the actor', () => {
        const se = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        se.beginRound(1);
        se.applyTimedAbilityStatus(1, timedProvoke('provoker-1'), undefined, 'victim-1');
        expect(provokerOf(se, 'victim-1')).toBe('provoker-1');
    });
    it('returns undefined when the actor carries no Provoke', () => {
        const se = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        se.beginRound(1);
        expect(provokerOf(se, 'victim-1')).toBeUndefined();
    });
    it('returns undefined for a Provoke applied without a casterId', () => {
        const se = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        se.beginRound(1);
        se.applyTimedAbilityStatus(1, timedProvoke(undefined), undefined, 'victim-1');
        expect(provokerOf(se, 'victim-1')).toBeUndefined();
    });
});
```

> Confirm the exact `RegisteredAbilityStatus` type name/export and the `applyTimedAbilityStatus` signature `(round, status, recipientId?, enemyTargetId?)` in `statusEngine.ts` before finalizing the helper shape.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/utils/combat/__tests__/forcedTargetingStatus.test.ts -t provokerOf`
Expected: FAIL — `provokerOf is not a function` / not exported.

- [ ] **Step 3: Implement `provokerOf`** in `triggers.ts` (after `ownerDebuffNamesFor`, mirroring its read style — both timed + active reads carry `casterId`):

```ts
/** The id of the actor that applied an active 'Provoke' debuff to `actorId`, or undefined
 *  if `actorId` carries no Provoke or the Provoke was applied without a caster identity.
 *  Provoke is a debuff ON the provoked attacker, so it lives in that actor's own enemy-side
 *  per-target store. Single entry expected (family-overwrite keys on 'Provoke'); the casterId
 *  is the provoker, mapped to a living opposing actor by resolvePositionalTarget. */
export function provokerOf(statusEngine: StatusEngine, actorId: string): string | undefined {
    for (const s of statusEngine.timedAbilityStatuses('enemy', undefined, actorId)) {
        if (s.active.buffName === 'Provoke' && s.casterId !== undefined) return s.casterId;
    }
    for (const s of statusEngine.activeAbilityStatuses(
        'enemy',
        () => NEUTRAL_NAMES_CTX,
        undefined,
        actorId
    )) {
        if (s.active.buffName === 'Provoke' && s.casterId !== undefined) return s.casterId;
    }
    return undefined;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/utils/combat/__tests__/forcedTargetingStatus.test.ts -t provokerOf`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/utils/combat/triggers.ts src/utils/combat/__tests__/forcedTargetingStatus.test.ts
git commit -m "feat(targeting): provokerOf query (casterId of a Provoke debuff)"
```

---

## Task 2: Resolver — Provoke redirect + ignore gating

Extend the pure `resolvePositionalTarget` with the optional `acting` param. Order: CF (always) → Taunt (skip if ignore) → Provoke (skip if ignore) → stealth.

**Files:**
- Modify: `src/utils/combat/positionalBinding.ts:38-98`
- Test: `src/utils/combat/positionalBinding.test.ts`

- [ ] **Step 1: Write the failing tests** (add to `positionalBinding.test.ts`, mirroring its existing CF/Taunt stub-`statusOf` pattern). Cover: provoked → targets provoker; provoker dead/absent → falls through to normal selection; ignore skips Taunt; ignore skips Provoke; ignore does NOT skip CF; priority Taunt > Provoke; Provoke bypasses stealth. Use the file's existing actor/`statusOf` builders. Example for the core case:

```ts
it('provoked attacker targets the provoker (bypasses stealth)', () => {
    // opposingLiving includes the provoker at some cell; acting.provokedBy names it.
    const provoker = actorAt('M2', 'enemy-prov'); // id 'enemy-prov'
    const other = actorAt('M4', 'enemy-other');
    const result = resolvePositionalTarget(
        'M1', // attacker position
        { side: 'enemy', selection: 'front' /* whatever front would pick: enemy-other */ },
        [provoker, other],
        () => ({ stealthed: false, taunting: false, concentrated: false }),
        { provokedBy: 'enemy-prov' }
    );
    expect(result?.id).toBe('enemy-prov'); // provoke overrides the front-most selection
});

it('ignoresForcedTargeting skips Taunt and Provoke but not Concentrate Fire', () => {
    // Build a roster where one actor taunts and another is concentrated; attacker is provoked too.
    // With ignore=true → CF wins (not Taunt, not Provoke).
});
```

> Match the existing test file's helper names and `ParsedTarget` shape exactly (read the top of `positionalBinding.test.ts` first). Pick `selection` values whose normal `selectTargets` result is a DIFFERENT actor than the forced one, so the assertion proves the override.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/utils/combat/positionalBinding.test.ts`
Expected: FAIL — `acting` arg ignored / Provoke not honored.

- [ ] **Step 3: Implement.** Change the signature and the `statusOf` block in `positionalBinding.ts`:

```ts
export function resolvePositionalTarget(
    actorPosition: Position,
    target: ParsedTarget,
    opposingLiving: CombatActor[],
    statusOf?: (id: string) => ActorTargetingStatus | undefined,
    acting?: { ignoresForcedTargeting?: boolean; provokedBy?: string }
): CombatActor | null {
    // ... byCell build + size===0 + ally-side return null unchanged ...

    let cells = [...byCell.keys()];

    if (statusOf) {
        const actors = [...byCell.values()];
        const frontMost = (cands: CombatActor[]): CombatActor =>
            [...cands].sort((x, y) => colOf(y.position!) - colOf(x.position!))[0];
        const ignore = acting?.ignoresForcedTargeting;

        // 1. Concentrate Fire — always (never ignored).
        const concentrated = actors.filter((a) => statusOf(a.id)?.concentrated);
        if (concentrated.length) {
            return frontMost(concentrated);
        }

        // 2. Taunt — skipped when the attacker ignores forced targeting.
        if (!ignore) {
            const taunting = actors.filter((a) => statusOf(a.id)?.taunting);
            if (taunting.length) {
                const round = (a: CombatActor) => statusOf(a.id)?.tauntAppliedRound ?? -Infinity;
                const maxRound = Math.max(...taunting.map(round));
                const latest = taunting.filter((a) => round(a) === maxRound);
                return frontMost(latest);
            }
        }

        // 3. Provoke — skipped when the attacker ignores forced targeting. Targets the
        //    provoker if it is a living opposing actor; bypasses stealth (forced-targeting
        //    override, like CF/Taunt). Falls through if the provoker is dead/absent.
        if (!ignore && acting?.provokedBy !== undefined) {
            const provoker = actors.find((a) => a.id === acting.provokedBy);
            if (provoker) {
                return provoker;
            }
        }

        // 4. Stealth filter — restore all if every candidate is stealthed.
        const visible = cells.filter((p) => !statusOf(byCell.get(p)!.id)?.stealthed);
        if (visible.length) {
            cells = visible;
        }
    }

    const { anchor } = selectTargets(target, { casterPosition: actorPosition, enemyOccupied: cells });
    return anchor ? (byCell.get(anchor) ?? null) : null;
}
```

Update the JSDoc above the function to document the new param + the CF→Taunt→Provoke→stealth order.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/utils/combat/positionalBinding.test.ts`
Expected: PASS (existing + new tests).

- [ ] **Step 5: Commit**

```bash
git add src/utils/combat/positionalBinding.ts src/utils/combat/positionalBinding.test.ts
git commit -m "feat(targeting): resolvePositionalTarget Provoke redirect + ignore gating"
```

---

## Task 3: Parser — `detectIgnoresForcedTargeting`

Detects "ignores Taunt and Provoke" (and "ignoring …", "… effects") in a ship's skill text. Per-ship boolean (corpus-justified).

**Files:**
- Modify: `src/utils/skillTextParser.ts`
- Test: the existing `skillTextParser` test file (find it: `ls src/utils/__tests__/ | grep -i skillTextParser` or co-located `src/utils/skillTextParser.test.ts`)

- [ ] **Step 1: Write the failing tests.** Positive: the 9 ignore-ship texts (use the literal strings, e.g. `"This Unit's attack ignores <unit-skill>Taunt</unit-skill> and <unit-skill>Provoke</unit-skill> and deals 160% damage."`, `"deals 130% damage, ignoring Taunt and Provoke."`, `"ignores Taunt and Provoke effects"`). Negative: a Provoke APPLIER (`"applies Provoke for 1 turn"`) and a Provoke-condition reader (`"additional damage against Taunted or Provoked enemies"`) must return `false`.

```ts
import { detectIgnoresForcedTargeting } from '../skillTextParser'; // adjust path
expect(detectIgnoresForcedTargeting("This Unit's attack ignores <unit-skill>Taunt</unit-skill> and <unit-skill>Provoke</unit-skill> and deals 160% damage.")).toBe(true);
expect(detectIgnoresForcedTargeting('deals 130% damage, ignoring Taunt and Provoke.')).toBe(true);
expect(detectIgnoresForcedTargeting('This Unit deals 180% damage and applies Provoke for 1 turn.')).toBe(false);
expect(detectIgnoresForcedTargeting('additional 60% damage against Taunted or Provoked enemies.')).toBe(false);
expect(detectIgnoresForcedTargeting(null)).toBe(false);
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run -t detectIgnoresForcedTargeting`
Expected: FAIL — not exported.

- [ ] **Step 3: Implement** in `skillTextParser.ts` (reuse the existing `stripUnitTags`). The regex requires `ignor…` then `taunt` then `provoke` in order, so applier/reader texts (no "ignor") don't match:

```ts
// "ignores Taunt and Provoke" / "ignoring Taunt and Provoke" / "ignores Taunt and Provoke effects"
const IGNORES_FORCED_TARGETING_RE = /\bignor\w*\b[^.]*\btaunt\b[^.]*\bprovoke\b/i;

/** True if any of the given skill texts states the unit ignores Taunt/Provoke (forced
 *  targeting). Per-ship: every corpus ignore-ship ignores uniformly across active/charged/
 *  passive. Does NOT cover Concentrate Fire (no ship text ignores CF). */
export function detectIgnoresForcedTargeting(
    ...skillTexts: Array<string | null | undefined>
): boolean {
    return skillTexts.some((t) => !!t && IGNORES_FORCED_TARGETING_RE.test(stripUnitTags(t)));
}
```

> `stripUnitTags` is currently a module-private function in `skillTextParser.ts` — `detectIgnoresForcedTargeting` lives in the same module so it can call it directly. No export change needed for `stripUnitTags`.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run -t detectIgnoresForcedTargeting`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/skillTextParser.ts src/utils/**/skillTextParser*.test.ts
git commit -m "feat(targeting): detectIgnoresForcedTargeting parser"
```

---

## Task 4: Plumbing — `ignoresForcedTargeting` on actor + inputs

Thread the flag exactly like the existing `position` field (set at construction, optional, defaults undefined).

**Files:**
- Modify: `src/utils/combat/state.ts` (`CombatActor` ~line 116; `createActor` partial ~124 + return ~141)
- Modify: `src/utils/combat/engine.ts` (`EnemyActorInput` ~331; `TeamActorEngineInput` ~723; focus on `CombatEngineInput` ~813; construction sites: enemy ~417, focus ~989, team ~1055)

- [ ] **Step 1: Add to `CombatActor`** (state.ts, next to `position`):

```ts
/** Attacker ignores Taunt/Provoke forced targeting (not Concentrate Fire). Positional
 *  plumbing — set at construction, consumed by resolvePositionalTarget. */
ignoresForcedTargeting?: boolean;
```

- [ ] **Step 2: Add to `createActor`** partial type + return:

```ts
// in the partial &{ ... } type, beside position?:
ignoresForcedTargeting?: boolean;
// in the returned object, beside `position: partial.position,`:
ignoresForcedTargeting: partial.ignoresForcedTargeting,
```

- [ ] **Step 3: Add to the 3 engine input types** (`EnemyActorInput`, `TeamActorEngineInput`, focus block on `CombatEngineInput`), each next to its existing `position?: Position;`:

```ts
/** Attacker ignores Taunt/Provoke (positional plumbing — not yet populated by a production caller). */
ignoresForcedTargeting?: boolean;
```

- [ ] **Step 4: Map it at the 3 construction sites** (next to each `position:` mapping):
  - enemy actor (~417, in `buildEnemyPlayerActorRuntime`): `ignoresForcedTargeting: e.ignoresForcedTargeting,`
  - focus actor (~989): `ignoresForcedTargeting: input.ignoresForcedTargeting,`
  - team actor (~1055): `ignoresForcedTargeting: t.ignoresForcedTargeting,`

- [ ] **Step 5: Verify build + full suite (no behavior change yet)**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS, goldens byte-identical (this task adds only optional dormant fields).

- [ ] **Step 6: Commit**

```bash
git add src/utils/combat/state.ts src/utils/combat/engine.ts
git commit -m "chore(targeting): thread ignoresForcedTargeting onto actor + inputs"
```

---

## Task 5: Engine wiring — pass `acting` at the 3 resolve sites

**Files:**
- Modify: `src/utils/combat/engine.ts` (resolve sites ~2442 focus, ~2555 team, ~2794 enemy)

- [ ] **Step 1: Import `provokerOf`** alongside the existing `buildForcedTargetingStatus` import (~line 52).

- [ ] **Step 2: At each of the 3 `resolvePositionalTarget` calls**, pass a 5th arg assembled INSIDE the existing `isPositional(...) && <target> ?` truthy branch (so the non-positional `: null` path runs no new query — preserves byte-identical goldens):

```ts
resolvePositionalTarget(
    actor.position!,
    <target>,                         // input.target / teamTargetById / enemyTargetById per site
    <roster>,                         // enemyAttackerActors (focus+team) / allPlayerActors (enemy)
    statusLookupFor(<roster>),
    {
        ignoresForcedTargeting: actor.ignoresForcedTargeting,
        provokedBy: provokerOf(statusEngine, actor.id),
    }
)
```

Use the exact `actor` variable in scope at each site (focus/team/enemy) and the same roster passed to `statusLookupFor`.

- [ ] **Step 3: Verify build + full suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS, goldens byte-identical (no production caller passes positions → all 3 branches stay on the `: null` path for every existing test).

- [ ] **Step 4: Commit**

```bash
git add src/utils/combat/engine.ts
git commit -m "feat(targeting): wire acting (ignore + provoker) into the 3 resolve sites"
```

---

## Task 6: Integration test — cast-path Provoke through `runCombat`

Prove the casterId path works end-to-end for an ability-cast Provoke.

**Files:**
- Test: `src/utils/combat/__tests__/positionalSelection.test.ts` (extend; mirror its existing positional setup — it already passes positions + `healTargetId`)

- [ ] **Step 1: Write the failing test.** Set up positioned actors where, absent Provoke, the focus/enemy attacker's normal `selectTargets` would hit actor B, but a faster actor applies a `'Provoke'` debuff (via an active skill ability config) onto the attacker; assert the attacker's resolved/emitted target becomes the provoker (actor A). Reuse the file's existing `ab()`/input builders and the `healTargetId` requirement (enemyAttackerActors only populate when `healTargetId` is set — see [memory]). Assert via the emitted `ability-performed.targetId` (the observable binding — per-target accounting is Phase 4).

> Read `positionalSelection.test.ts` + `enemyBuffSelfDebuffGate.test.ts` (the latter shows the realistic "enemy applies a Provoke debuff" setup) before writing — copy their fixture shape rather than inventing one.

- [ ] **Step 2: Run to verify failure (or pass).** If the cast-path Provoke already carries `casterId` (it should — `engine.ts:181`), this test may PASS immediately once wiring (Tasks 1–5) is in. That's acceptable: it then serves as a regression lock. If it FAILS, debug the wiring before proceeding.

Run: `npx vitest run src/utils/combat/__tests__/positionalSelection.test.ts`

- [ ] **Step 3: Commit**

```bash
git add src/utils/combat/__tests__/positionalSelection.test.ts
git commit -m "test(targeting): cast-path Provoke redirect e2e"
```

---

## Task 7: Reactive Provoke — stamp `casterId` (component 0) + e2e

Guardian's reactive Provoke ("when an ally is critically hit, apply Provoke to that enemy") routes through the reactive-debuff branch, which omits `casterId` → inert under `provokerOf`. The reactive e2e test is the failing test that drives the one-line fix.

**Files:**
- Modify: `src/utils/combat/triggers.ts:849-856` (reactive-debuff timed status object)
- Test: `src/utils/combat/__tests__/positionalSelection.test.ts`

- [ ] **Step 1: Write the failing test.** Positioned actors; a player ship reactively applies Provoke to an enemy attacker via an on-ally-critically-hit (or simplest available reactive-debuff) trigger; assert the provoked enemy's resolved target becomes the provoker. (If a full Guardian-style crit setup is too heavy, use the minimal reactive-debuff ability config that the engine's reactive executor accepts — the point is to exercise the `cfg.type === 'debuff'` reactive branch.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/utils/combat/__tests__/positionalSelection.test.ts -t reactiv`
Expected: FAIL — provoked enemy targets its normal pick, not the provoker (reactive Provoke carries no `casterId` → `provokerOf` returns undefined).

- [ ] **Step 3: Implement component 0** — add `casterId` to the reactive-debuff timed status object (`triggers.ts:849-856`), mirroring the reactive-buff branch (`:830`) and cast path (`engine.ts:181`):

```ts
const status: Extract<RegisteredAbilityStatus, { kind: 'timed' }> = {
    payload: payloadFromConfig(cfg),
    side: 'enemy',
    sourceSlot: intent.sourceSlot,
    conditions: gateConditions,
    casterId: intent.ownerId,   // ← ADD: applier identity (churn-free; see spec §3)
    kind: 'timed',
    duration: typeof cfg.duration === 'number' ? cfg.duration : 1,
};
```

- [ ] **Step 4: Run to verify pass + full suite (churn check)**

Run: `npx vitest run src/utils/combat/__tests__/positionalSelection.test.ts` then `npx vitest run`
Expected: PASS; **goldens byte-identical** (the spec verified no existing consumer reads enemy-side timed-debuff `casterId`). If any golden moves, STOP — the churn-free premise leaked; investigate before `-u` (do not `-u`).

- [ ] **Step 5: Commit**

```bash
git add src/utils/combat/triggers.ts src/utils/combat/__tests__/positionalSelection.test.ts
git commit -m "fix(targeting): stamp casterId on reactive-debuff path so reactive Provoke redirects"
```

---

## Task 8: Changelog + final verification

**Files:**
- Modify: `src/constants/changelog.ts` (`UNRELEASED_CHANGES` — fold into the single evolving combat entry, do NOT append a new one)

- [ ] **Step 1: Add a plain-English clause** to the existing combat `UNRELEASED_CHANGES` entry, e.g.: "Provoke now redirects a provoked attacker to target whoever applied it, and ships that 'ignore Taunt and Provoke' bypass that forced targeting (Concentrate Fire still applies)." Keep it user-facing; fold, don't append.

- [ ] **Step 2: Full verification gate**

Run: `npx tsc --noEmit && npm run lint && npx vitest run`
Expected: tsc clean, lint 0 warnings, all tests green, goldens byte-identical (no snapshot file in `git diff` vs base).

- [ ] **Step 3: `audit:skills` parity** (no parser regression):

Run: `npm run audit:skills` (confirm 0 findings / full ship count, as on `main`).

- [ ] **Step 4: Commit + open PR**

```bash
git add src/constants/changelog.ts
git commit -m "docs(changelog): Provoke forced targeting + ignore"
gh auth switch --hostname github.com --user TheSusort
git push -u origin <branch> | cat
gh pr create --title "feat(targeting): Provoke forced targeting + ignore Taunt/Provoke" --body "<summary>" | cat
```

---

## Definition of done

- `provokerOf` returns the provoker's id for cast- and reactive-applied Provoke; undefined when absent/casterId-less.
- Resolver order CF → Taunt → Provoke → stealth; ignore suppresses Taunt + Provoke, not CF; Provoke bypasses stealth; provoker dead/absent → graceful fallthrough.
- `detectIgnoresForcedTargeting` true for all 9 corpus ignore-ships, false for appliers/readers.
- DPS + healing goldens **byte-identical**; tsc/lint clean; `audit:skills` unchanged.
- Capability-only: no production caller passes positions (simulator, Phase 5, is the first).

## Deferred (out of scope — do not implement)

- Vindicator AoE Provoke ("all enemies adjacent to target") → Phase 4 multi-target.
- Implant-sourced Provoke; ignore-of-Concentrate-Fire; per-action (active vs charged) ignore granularity; manual/scheduled Provoke without `casterId` (inert).
