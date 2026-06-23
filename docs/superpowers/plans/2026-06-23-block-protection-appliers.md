# D-PR16 — Block/Protection appliers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add four implant appliers (Firewall, Lockdown, Tenacity, Last Stand) that reactively grant the Block Debuff / Buff Protection / Barrier control buffs shipped by D-PR15.

**Architecture:** All *effects* ride the existing reactive-buff executor + `procChance` gates + all-allies routing. The new work is three trigger seams (`on-debuffed`, `on-debuff-resisted`, a damage-fraction filter on `on-attacked`), one new condition subject (`last-standing`), and a small multi-buff co-grant extension (Last Stand grants Barrier + Block Debuff on one roll). No production caller equips these implants in any fixture → all DPS/healing goldens stay byte-identical (the load-bearing safety invariant).

**Tech Stack:** TypeScript, Vitest. Combat engine in `src/utils/combat/`, equipment ability registry in `src/utils/abilities/`.

**Spec:** `docs/superpowers/specs/2026-06-23-block-protection-appliers-design.md`

---

## Environment notes (read first)

- **Worktree:** `.worktrees/d-pr16-block-protection-appliers` (branch `feat/combat-d-pr16-block-protection-appliers`, based on D-PR15 tip + cherry-picked Last Stand data fix). `.env` and `docs/*.csv` are symlinked from the main checkout — do NOT delete them (tests need them).
- **Pre-commit hook runs the FULL vitest suite.** For code commits let it run. For docs-only commits use `--no-verify`.
- **Goldens:** NEVER run `vitest -u`. If a golden snapshot file (`*.snap`, `healingGoldenParity`/DPS golden files) changes, a gate leaked — fix the gate, do not regenerate. Verify byte-identical via `git status` showing no snapshot files modified.
- **Verification commands** (run from the worktree root):
  - `npm test` — full suite
  - `npm run lint` — ESLint (max-warnings 0)
  - `npx tsc --noEmit` — type check
  - `npm test -- equipmentCoverage` — coverage tracker
- **Per-rarity proc data** is already in `src/constants/implants.ts` (verified): Firewall unc .08/rare .10/epic .12/leg .15; Lockdown com .05/unc .07/rare .09/epic .12/leg .16; Tenacity rare .10/epic .12/leg .16; Last Stand unc .18/rare .21/epic .26/leg .32.
- **Buffs exist:** D-PR15 added `Block Debuff` and `Buff Protection` to `BUFFS` (`src/constants/buffs.ts`) + `MANUAL_BUFFS`; `Barrier` predates them. So `mkNamedBuffGrant('Block Debuff'|'Buff Protection'|'Barrier', …)` resolves.

---

## File structure

| File | Responsibility | Change |
|---|---|---|
| `src/types/abilities.ts` | Ability/Condition types | += `on-debuffed`, `on-debuff-resisted` triggers; `last-standing` subject; `requireIncomingDamageFracOfMaxHp?` Ability field; `additionalBuffs?` on buff config |
| `src/utils/combat/events.ts` | Combat event union | `attacked` event += optional `damage?: number` |
| `src/utils/combat/engine.ts` | Engine loop | emit aggregate `damage` on `attacked`; `soleSurvivorOf` helper + `lastStandingId` in both drain literals + ctx literal |
| `src/utils/combat/triggers.ts` | Reactive listeners + executor | 3 listener arms; Tenacity filter; co-grant loop; `last-standing` thread + `maxHpOf` resolver |
| `src/utils/combat/abilityStatusGating.ts` | LIVE_SUBJECTS | += `last-standing` |
| `src/utils/abilities/evaluateConditions.ts` | Condition eval | `isLastStanding` ctx field + `last-standing` case |
| `src/utils/abilities/roundContext.ts` | Round context | `lastStanding` state field + builder pass-through |
| `src/utils/abilities/buildEquipmentAbilities.ts` | Implant registry | 4 proc maps + 4 registry entries; `mkNamedBuffGrant` `alsoGrantBuffNames` opt |
| `src/components/skills/AbilityCard.tsx` | Editor | TRIGGER_OPTIONS += 2 |
| `src/components/skills/ConditionRow.tsx` | Editor | SUBJECT_VALUES += `last-standing` |
| `src/utils/abilities/__tests__/equipmentCoverage.test.ts` | Coverage gate | += 4 implants (array + Set) |
| `src/constants/changelog.ts` | Changelog | UNRELEASED_CHANGES entry |
| test files (see tasks) | Behavior | per-applier integration + unit |

---

## Task 1: Firewall — `on-debuffed` trigger (self → Block Debuff)

**Files:**
- Modify: `src/types/abilities.ts` (AbilityTrigger union)
- Modify: `src/components/skills/AbilityCard.tsx` (TRIGGER_OPTIONS)
- Modify: `src/utils/combat/triggers.ts` (listener arm, ~after the `on-attacked` case)
- Modify: `src/utils/abilities/buildEquipmentAbilities.ts` (FIREWALL_PROC + FIREWALL entry)
- Modify: `src/utils/abilities/__tests__/equipmentCoverage.test.ts`
- Test: `src/utils/combat/__tests__/firewallApplier.test.ts` (new)

- [ ] **Step 1: Write the failing integration test**

Create `src/utils/combat/__tests__/firewallApplier.test.ts`. Model it on an existing equipment-applier engine test (e.g. find one that uses `buildShipAbilitiesWithEquipment` + `simulateBattle`/`runCombat` with a `getGearPiece` stub — search `grep -rln "buildShipAbilitiesWithEquipment" src/utils/combat/__tests__`). The test: a player carrier equips a legendary Firewall implant (procChance forced to fire — set the rate-gate to certainty by using a high-enough accumulated rate, i.e. give the implant via a gear stub whose implant `setBonus='Firewall'`/`rarity='legendary'`, and ensure an enemy lands a timed debuff on the carrier). Assert that after the debuff lands, the carrier carries a `Block Debuff` self-buff (query via the same status read the other tests use — `selfBuffNamesForOwners` or the round buff display).

Note: procChance .15 is not deterministic per single event. Use the established test approach for forcing a proc — search how `BLOODTHIRST`/`BULWARK` tests force their gate (`grep -rln "procChance\|makeRateGate\|rollRateGate" src/utils/combat/__tests__`); reuse that mechanism (typically multiple qualifying events or a seeded/forced gate). If no forcing hook exists, assert the *capability* (over enough debuff events the buff appears) or use the deterministic-accumulator property (a gate at rate r fires on the ceil(1/r)-th event).

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- firewallApplier`
Expected: FAIL — `on-debuffed` is not a valid trigger / no Block Debuff granted.

- [ ] **Step 3: Add the `on-debuffed` trigger to the union**

In `src/types/abilities.ts` AbilityTrigger union, add after `'on-charged-cast'` (or near the other `on-*` values):

```ts
    // D-PR16 Firewall: fires when THIS unit receives a timed debuff (rides the existing
    // `debuff-applied` event, self-scoped on targetId === ownerId). Does NOT fire for DoTs
    // (separate `dot-applied` event) — matches "when debuffed".
    | 'on-debuffed'
```

- [ ] **Step 4: Add the editor TRIGGER_OPTIONS stub**

In `src/components/skills/AbilityCard.tsx` TRIGGER_OPTIONS array (line ~127), add:

```ts
    { value: 'on-debuffed', label: 'On debuffed (self)' },
```

- [ ] **Step 5: Register the listener arm**

In `src/utils/combat/triggers.ts` `registerReactiveListeners`, add a `case` next to `on-attacked` (~line 394):

```ts
                case 'on-debuffed':
                    bus.on('debuff-applied', (e) => {
                        // Self-scoped: fires when THIS owner receives a timed debuff. Mirrors
                        // on-attacked's targetId === ownerId scoping. DoTs use dot-applied (not
                        // this event) → Firewall does not fire on DoT application, by design.
                        if (e.targetId === ownerId) enqueue(intent);
                    });
                    break;
```

Also add `'on-debuffed'` to the `REACTIVE_ABILITY_TYPES`/`LIVE_TRIGGERS` membership ONLY if required for the listener to be registered — check how `on-attacked` is gated into `registerReactiveListeners` (search `LIVE_TRIGGERS` in `triggers.ts`/`abilityStatusGating.ts`). Add it wherever `on-attacked` appears so the partition treats it as a reactive (not on-cast) trigger.

- [ ] **Step 6: Add the registry entry + proc map**

In `src/utils/abilities/buildEquipmentAbilities.ts`, add a proc map near the others (~line 280):

```ts
const FIREWALL_PROC: Record<string, number> = {
    uncommon: 0.08,
    rare: 0.1,
    epic: 0.12,
    legendary: 0.15,
};
```

Add to `IMPLANT_ABILITIES` (near BULWARK/DOOMSAYER):

```ts
    // D-PR16: Firewall — when debuffed, X% chance to gain Block Debuff (self) for 1 turn.
    FIREWALL: (rarity) => {
        const procChance = FIREWALL_PROC[rarity];
        if (procChance === undefined) return undefined;
        return mkNamedBuffGrant('Block Debuff', 'self', 'on-debuffed', 1, { procChance });
    },
```

- [ ] **Step 7: Update the coverage tracker**

In `src/utils/abilities/__tests__/equipmentCoverage.test.ts`, add `'FIREWALL'` to BOTH the `.toEqual([...])` decl-order array (line ~122 — insert in `IMPLANTS` declaration order) AND the `implementedImplants` Set (line ~203). Update the `it('exactly {...}')` description string if it enumerates names. Run `npm test -- equipmentCoverage` and fix ordering until green.

- [ ] **Step 8: Run the tests**

Run: `npm test -- firewallApplier equipmentCoverage` then `npx tsc --noEmit` and `npm run lint`.
Expected: PASS, clean.

- [ ] **Step 9: Confirm goldens byte-identical**

Run: `npm test` then `git status --short`.
Expected: full suite green; NO `*.snap`/golden files modified.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat(combat): D-PR16 Firewall — on-debuffed trigger grants self Block Debuff"
```

---

## Task 2: Lockdown — `on-debuff-resisted` trigger (all-allies → Buff Protection)

**Files:**
- Modify: `src/types/abilities.ts`, `src/components/skills/AbilityCard.tsx`
- Modify: `src/utils/combat/triggers.ts` (listener arm)
- Modify: `src/utils/abilities/buildEquipmentAbilities.ts` (LOCKDOWN_PROC + entry)
- Modify: `src/utils/abilities/__tests__/equipmentCoverage.test.ts`
- Test: `src/utils/combat/__tests__/lockdownApplier.test.ts` (new)

- [ ] **Step 1: Write the failing tests**

Create `src/utils/combat/__tests__/lockdownApplier.test.ts` with TWO cases:
1. **Direct:** a Lockdown carrier resists an incoming enemy debuff (force the resist via high tank security / hacking-disadvantage so the landing roll fails — search how existing tests force a resist, e.g. the PR#100 `resistedDebuffs` tests). Assert all same-side allies carry `Buff Protection` after the resist (forced proc). Optionally assert an enemy purge against an ally is then a no-op (purge-immunity, D-PR15 primitive).
2. **Synergy (the headline test):** a carrier holding `Block Debuff` (grant it directly via the test setup, or via a Firewall on a prior event) auto-resists an incoming debuff → `debuff-resisted` fires → a *same-side* Lockdown carrier grants the team `Buff Protection`. This proves the chain across D-PR15's Block-Debuff resist emission.

- [ ] **Step 2: Run to confirm fail**

Run: `npm test -- lockdownApplier`
Expected: FAIL — `on-debuff-resisted` invalid / no Buff Protection.

- [ ] **Step 3: Add the trigger to the union**

`src/types/abilities.ts`:

```ts
    // D-PR16 Lockdown: fires when THIS unit resists an incoming debuff (rides the existing
    // `debuff-resisted` event, self-scoped on targetId === ownerId). Chains off D-PR15's
    // Block-Debuff auto-resist emission AND normal hacking/affinity resists.
    | 'on-debuff-resisted'
```

- [ ] **Step 4: Editor stub**

`AbilityCard.tsx` TRIGGER_OPTIONS:

```ts
    { value: 'on-debuff-resisted', label: 'On debuff resisted (self)' },
```

- [ ] **Step 5: Register the listener arm**

In `triggers.ts` `registerReactiveListeners`:

```ts
                case 'on-debuff-resisted':
                    bus.on('debuff-resisted', (e) => {
                        // Self-scoped on the RESISTER. `debuff-resisted` carries targetId = the
                        // unit that resisted (either side: cast-side, reactive-side, and the
                        // D-PR15 Block-Debuff auto-resist all emit it). all-allies recipient
                        // routing happens in the buff executor.
                        if (e.targetId === ownerId) enqueue(intent);
                    });
                    break;
```

Add `'on-debuff-resisted'` to the same reactive-trigger membership list as in Task 1 Step 5.

- [ ] **Step 6: Registry entry + proc map**

```ts
const LOCKDOWN_PROC: Record<string, number> = {
    common: 0.05,
    uncommon: 0.07,
    rare: 0.09,
    epic: 0.12,
    legendary: 0.16,
};
```

```ts
    // D-PR16: Lockdown — when resisting a debuff, X% chance to grant Buff Protection to
    // all allies for 1 turn.
    LOCKDOWN: (rarity) => {
        const procChance = LOCKDOWN_PROC[rarity];
        if (procChance === undefined) return undefined;
        return mkNamedBuffGrant('Buff Protection', 'all-allies', 'on-debuff-resisted', 1, {
            procChance,
        });
    },
```

- [ ] **Step 7: Coverage tracker** — add `'LOCKDOWN'` to both the array and the Set.

- [ ] **Step 8: Run tests + tsc + lint** (`npm test -- lockdownApplier equipmentCoverage`).

- [ ] **Step 9: Goldens byte-identical** (`npm test` + `git status --short`).

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat(combat): D-PR16 Lockdown — on-debuff-resisted grants all-ally Buff Protection (chains off Block Debuff)"
```

---

## Task 3: Tenacity — `on-attacked` + >25%-max-HP filter (all-allies → Buff Protection)

**Files:**
- Modify: `src/utils/combat/events.ts` (`attacked` event += `damage?`)
- Modify: `src/utils/combat/engine.ts` (emit aggregate `damage` ~line 4510)
- Modify: `src/types/abilities.ts` (`requireIncomingDamageFracOfMaxHp?` Ability field)
- Modify: `src/utils/combat/triggers.ts` (thread `maxHpOf` resolver + filter in `on-attacked` arm)
- Modify: `src/utils/combat/engine.ts` (pass `maxHpOf` into `registerReactiveListeners` — both call sites)
- Modify: `src/utils/abilities/buildEquipmentAbilities.ts` (TENACITY_PROC + entry)
- Modify: `src/utils/abilities/__tests__/equipmentCoverage.test.ts`
- Test: `src/utils/combat/__tests__/tenacityApplier.test.ts` (new)

- [ ] **Step 1: Write the failing tests**

Create `tenacityApplier.test.ts` with three cases:
1. A single direct attack dealing > 25% of the carrier's max HP → all allies gain `Buff Protection` (2 turns), proc forced.
2. An attack dealing ≤ 25% → no grant.
3. A DoT batch exceeding 25% → no grant (DoT ticks emit no `attacked` event).

- [ ] **Step 2: Run to confirm fail** (`npm test -- tenacityApplier`).

- [ ] **Step 3: Add `damage?` to the `attacked` event**

`src/utils/combat/events.ts`, in the `attacked` event member (~line 173):

```ts
    | {
          type: 'attacked';
          targetId: string;
          attackerId: string;
          round: number;
          didCrit?: boolean;
          /** D-PR16: per-ATTACK aggregate direct damage dealt this turn (identical across the
           *  turn's per-hit events — per-hit damage is not tracked, same approximation as
           *  Bloodthirst's triggerDamage). Present only when a damage aggregate is in scope.
           *  Tenacity's >25%-max-HP filter reads this. */
          damage?: number;
      };
```

- [ ] **Step 4: Emit the aggregate damage**

In `src/utils/combat/engine.ts` at the `attacked` emission (~line 4510), add `damage` to the emitted object using the per-attack `damage` aggregate already in scope (used at line ~4476):

```ts
                                bus.emit({
                                    type: 'attacked',
                                    targetId: tgt.id,
                                    attackerId: actor.id,
                                    round: r,
                                    ...(hitCrit ? { didCrit: true } : {}),
                                    ...(damage > 0 ? { damage } : {}),
                                });
```

(Verify the in-scope binding name is `damage` at this point; if it's named differently, use that. Conditional spread keeps the event byte-shape unchanged when damage is 0/absent.)

- [ ] **Step 5: Add the Ability filter field**

`src/types/abilities.ts`, on the `Ability` interface (near `triggerCritFilter`/`requireDamagedAllyAdjacent`):

```ts
    /** D-PR16 Tenacity: gate an `on-attacked` reaction on the per-attack aggregate damage
     *  exceeding this fraction of the owner's effective max HP (e.g. 0.25). Absent → no gate
     *  (byte-identical for every existing on-attacked ability). */
    requireIncomingDamageFracOfMaxHp?: number;
```

- [ ] **Step 6: Thread a `maxHpOf` resolver into the listeners**

In `triggers.ts` `registerReactiveListeners` args object (~line 223, next to `adjacentAllyIdsFor`):

```ts
    /** D-PR16: owner effective max HP resolver — gates Tenacity's incoming-damage-fraction
     *  filter. Optional: absent → the filter is skipped (no Tenacity in scope). */
    maxHpOf?: (ownerId: string) => number;
```

Destructure it (`const { …, maxHpOf } = args;`).

In the `on-attacked` case, after the existing crit-filter checks and before `enqueue`, add:

```ts
                        const fracGate = ra.ability.requireIncomingDamageFracOfMaxHp;
                        if (fracGate !== undefined) {
                            const maxHp = maxHpOf?.(ownerId);
                            if (e.damage === undefined || !maxHp || e.damage <= fracGate * maxHp)
                                return;
                        }
```

- [ ] **Step 7: Provide `maxHpOf` from the engine**

In `engine.ts`, both `registerReactiveListeners(...)` call sites (player + enemy — search `registerReactiveListeners(`), pass a resolver that returns the actor's effective max HP. Reuse the same effective-max-HP source the engine already uses (search `effectiveMaxHp` — `triggers.ts:1378` shows `ownerCtx?.effectiveMaxHp ?? owner.hp` as the pattern; the engine has an `effectiveStatsOf`/per-actor HP lookup). Implement:

```ts
        maxHpOf: (id) => {
            const a = allActorsById.get(id); // or the existing roster map in scope
            return a ? effectiveStatsOf(statusEngine, selfBuffLookup, a).hp : 0;
        },
```

Use whatever roster map + effective-stats helper is already in engine scope (mirror how `highestAttackInRoster` resolves `effectiveStatsOf(...).attack`). If `effectiveStatsOf` exposes max HP under a different key, use that. Add to BOTH call sites (same closure is fine — it's side-agnostic by id).

- [ ] **Step 8: Registry entry + proc map**

```ts
const TENACITY_PROC: Record<string, number> = { rare: 0.1, epic: 0.12, legendary: 0.16 };
```

```ts
    // D-PR16: Tenacity — upon directly receiving damage > 25% of max HP, X% chance to grant
    // Buff Protection to all allies for 2 turns. Models the per-ATTACK aggregate (the
    // `attacked` event excludes DoT/bomb → "directly receiving").
    TENACITY: (rarity) => {
        const procChance = TENACITY_PROC[rarity];
        if (procChance === undefined) return undefined;
        const base = mkNamedBuffGrant('Buff Protection', 'all-allies', 'on-attacked', 2, {
            procChance,
        });
        if (!base) return undefined;
        return { ...base, requireIncomingDamageFracOfMaxHp: 0.25 };
    },
```

- [ ] **Step 9: Coverage tracker** — add `'TENACITY'` to array + Set.

- [ ] **Step 10: Run tests + tsc + lint** (`npm test -- tenacityApplier equipmentCoverage`).

- [ ] **Step 11: Goldens byte-identical** (`npm test` + `git status --short` — the `attacked` `damage` field is conditionally spread, so no golden should move; if one does, the conditional spread or a healing-mode `attacked` consumer leaked — investigate, do NOT `-u`).

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "feat(combat): D-PR16 Tenacity — on-attacked >25% max-HP filter grants all-ally Buff Protection"
```

---

## Task 4: `last-standing` condition subject (infrastructure)

Mirror the D-PR14 `first-activator` threading exactly (11 sites — see `grep -rn "first-activator\|firstActivator" src/`). The ONLY behavioral difference: `last-standing` is derived liveness (recomputed each drain), not a monotonic id.

**Files:**
- Modify: `src/types/abilities.ts` (ConditionSubject union)
- Modify: `src/utils/combat/abilityStatusGating.ts` (LIVE_SUBJECTS, ~line 29)
- Modify: `src/utils/abilities/evaluateConditions.ts` (ctx field + case, ~lines 37/91)
- Modify: `src/utils/abilities/roundContext.ts` (state field + builder, ~lines 44/68)
- Modify: `src/utils/combat/triggers.ts` (IntentExecContext field ~654, buildDrainContext shared bag ~719/747/784)
- Modify: `src/utils/combat/engine.ts` (`soleSurvivorOf` helper; ReactiveSideCtx field ~1044; ctx literal ~3422; both drain literals ~3480/3505)
- Modify: `src/components/skills/ConditionRow.tsx` (SUBJECT_VALUES)
- Test: `src/utils/abilities/__tests__/evaluateConditions.test.ts` (extend) + `src/utils/combat/__tests__/lastStandingSubject.test.ts` (new, engine-level)

- [ ] **Step 1: Write the failing unit test (pure evaluator)**

In `evaluateConditions.test.ts` (or co-located), assert `last-standing` evaluates to 1 when `ctx.isLastStanding === true` and 0 otherwise. Follow the existing `first-activator` test if present.

- [ ] **Step 2: Write the failing engine wiring test**

Create `lastStandingSubject.test.ts`: build a 2-actor player team where one actor carries a buff-grant ability gated on `{ subject: 'last-standing', derivable: true }` triggered by `on-ally-destroyed`. Kill the other ally; assert the survivor's gate evaluates true and the buff is granted. Add a control: with both alive, an unrelated `on-ally-destroyed` does NOT grant (gate false). (This task does not add a co-grant yet — use a single-buff grant like `Defense Up I` to prove the subject; Last Stand's real buffs come in Task 6.)

- [ ] **Step 3: Run to confirm fail** (`npm test -- lastStandingSubject evaluateConditions`).

- [ ] **Step 4: Add the subject to the union**

`src/types/abilities.ts` ConditionSubject union (next to `'first-activator'`, ~line 173):

```ts
    | 'last-standing'; // D-PR16 Last Stand: true iff the owner is the SOLE living same-side actor.
```

(Adjust the union's trailing `;`/`|` punctuation to keep it valid.)

- [ ] **Step 5: LIVE_SUBJECTS**

`src/utils/combat/abilityStatusGating.ts` (~line 29, where `'first-activator'` is listed):

```ts
    'last-standing',
```

- [ ] **Step 6: evaluateConditions**

`src/utils/abilities/evaluateConditions.ts`: add to `ConditionContext` (~line 37, near `firstActivator?`):

```ts
    isLastStanding?: boolean;
```

Add the eval case (~line 91, next to `first-activator`):

```ts
        case 'last-standing':
            return ctx.isLastStanding ? 1 : 0;
```

- [ ] **Step 7: roundContext**

`src/utils/abilities/roundContext.ts`: add to the state type (~line 44):

```ts
    lastStanding?: boolean;
```

and in `buildRoundContext` output (~line 68, where `firstActivator: state.firstActivator ?? false` is):

```ts
        isLastStanding: state.lastStanding ?? false,
```

(Confirm the field name the context forwards to `ConditionContext` — it must match Step 6's `isLastStanding`. `first-activator` forwards as `firstActivator`; for last-standing the context field is `isLastStanding` and the round-context *state* key is `lastStanding`. Keep these consistent across files; pick `isLastStanding` for the ConditionContext key and `lastStanding` for the round-state/sideCtx delegate value to avoid double-negation bugs.)

- [ ] **Step 8: triggers.ts thread**

- IntentExecContext (~line 654, near `firstActivatorId?`):

```ts
    /** D-PR16: the id of the SOLE living same-side actor for the owner's side this drain, or
     *  undefined when ≠1 alive. Recomputed per drain (derived liveness). */
    lastStandingId?: string;
```

- In `buildDrainContext` shared bag (mirror `firstActivator: ctx.firstActivatorId === ownerId` at ~line 784):

```ts
        lastStanding: ctx.lastStandingId === ownerId,
```

and add `lastStanding?: boolean;` to the shared-bag type (~line 719) and forward it into `buildActorConditionContext`/the round context input so it reaches `buildRoundContext` state as `lastStanding`. Follow exactly how `firstActivator` flows from line 747 → roundContext.

- [ ] **Step 9: engine.ts compute + thread**

- Add a helper near `highestAttackInRoster` (~line 3459):

```ts
        // D-PR16: the id of the sole living actor in a roster, or undefined if ≠1 alive.
        // Drives the `last-standing` condition (Last Stand). Recomputed each drain so it
        // reflects deaths recorded before the reactive drain.
        const soleSurvivorOf = (roster: CombatActor[]): string | undefined => {
            const living = roster.filter((a) => a.destroyedRound === undefined);
            return living.length === 1 ? living[0].id : undefined;
        };
```

- Add `lastStandingId?: string;` to the ReactiveSideCtx interface (~line 1044, near `firstActivatorId?`).
- Pass it into the `executeIntent`/ctx literal (~line 3422, next to `firstActivatorId: sideCtx.firstActivatorId`):

```ts
                        lastStandingId: sideCtx.lastStandingId,
```

- Set it in BOTH drain literals:
  - Player drain (~line 3480): `lastStandingId: soleSurvivorOf(allPlayerActors),`
  - Enemy drain (~line 3505): `lastStandingId: soleSurvivorOf(enemyAttackerActors),`

(These literals rebuild on each drain call → `soleSurvivorOf` reflects current liveness.)

- [ ] **Step 10: Editor stub**

`src/components/skills/ConditionRow.tsx` SUBJECT_VALUES (~line 15):

```ts
    'last-standing',
```

Add an `EXTRA_SUBJECT_LABELS` entry (~line 38) if the auto-label is poor:

```ts
    'last-standing': 'Last one standing (self)',
```

- [ ] **Step 11: Run tests + tsc + lint** (`npm test -- lastStandingSubject evaluateConditions`, then `npx tsc --noEmit`, `npm run lint`).

- [ ] **Step 12: Goldens byte-identical** (`npm test` + `git status --short`).

- [ ] **Step 13: Commit**

```bash
git add -A
git commit -m "feat(combat): D-PR16 last-standing condition subject (mirrors first-activator threading)"
```

---

## Task 5: multi-buff co-grant extension (`additionalBuffs`)

Lets a single buff-grant ability apply more than one named buff on ONE proc roll (Last Stand: Barrier + Block Debuff). Purely additive — existing single-buff grants are byte-identical (`additionalBuffs` undefined → no-op).

**Files:**
- Modify: `src/types/abilities.ts` (buff `AbilityConfig` += `additionalBuffs?`)
- Modify: `src/utils/abilities/buildEquipmentAbilities.ts` (`mkNamedBuffGrant` `alsoGrantBuffNames` opt)
- Modify: `src/utils/combat/triggers.ts` (co-grant loop in the `cfg.type === 'buff'` branch, ~after line 1189)
- Test: `src/utils/abilities/__tests__/buildEquipmentAbilities.test.ts` (extend or new co-grant test) + reuse an engine test

- [ ] **Step 1: Write the failing test**

Add a unit test: `mkNamedBuffGrant('Barrier', 'self', 'on-ally-destroyed', 1, { procChance: 0.32, alsoGrantBuffNames: ['Block Debuff'] })` returns an ability whose buff config has `buffName: 'Barrier'` and `additionalBuffs` containing a `Block Debuff` config with resolved `parsedEffects`. Plus an engine-level assertion (can fold into Task 6) that applying it grants BOTH buffs to the recipient.

- [ ] **Step 2: Run to confirm fail.**

- [ ] **Step 3: Add `additionalBuffs` to the buff config type**

`src/types/abilities.ts`, on the buff `AbilityConfig` variant (where `buffName`/`parsedEffects`/`stacks`/`duration` live):

```ts
    /** D-PR16: extra buffs granted ALONGSIDE the primary in the SAME application (one proc
     *  roll → all of them). Each carries its own resolved effects + duration. Absent → the
     *  single-buff path is unchanged. */
    additionalBuffs?: Array<{
        buffName: string;
        parsedEffects: ParsedBuffEffects; // same type as the primary config's parsedEffects
        stacks: number;
        isStackable: boolean;
        maxStacks?: number;
        duration: number;
    }>;
```

(Use the exact element type of the primary config's fields — copy the field types from the buff config so they match. `ParsedBuffEffects` is the return type of `parseBuffEffects`; import/reference whatever the primary uses.)

- [ ] **Step 4: Extend `mkNamedBuffGrant`**

In `buildEquipmentAbilities.ts`, add `alsoGrantBuffNames?: string[]` to the `opts` param type, and after building the primary `config`, populate `additionalBuffs`:

```ts
    const additionalBuffs = (opts?.alsoGrantBuffNames ?? [])
        .map((n) => {
            const b = BUFFS.find((x) => x.name === n);
            if (!b) return undefined;
            const { stackable, maxStacks } = isStackable(b.description);
            return {
                buffName: n,
                parsedEffects: parseBuffEffects(b.name, b.description),
                stacks: 1,
                isStackable: stackable,
                maxStacks,
                duration,
            };
        })
        .filter((x): x is NonNullable<typeof x> => x !== undefined);
```

and add `...(additionalBuffs.length ? { additionalBuffs } : {})` into the returned `config` object.

- [ ] **Step 5: Apply co-buffs in the executor**

In `triggers.ts`, in the `cfg.type === 'buff'` branch, AFTER the existing per-recipient apply+emit loop (after line ~1189, before `return;`), add:

```ts
        // D-PR16: co-granted buffs (Last Stand's Barrier + Block Debuff) — applied in the
        // SAME application as the primary (the single proc gate above already passed).
        for (const extra of cfg.additionalBuffs ?? []) {
            const extraStatus: Extract<RegisteredAbilityStatus, { kind: 'timed' }> = {
                payload: payloadFromConfig({ type: 'buff', ...extra }),
                side: 'self',
                sourceSlot: intent.sourceSlot,
                conditions: gateConditions,
                casterId: intent.ownerId,
                recipients,
                kind: 'timed',
                duration: extra.duration,
            };
            for (const rid of recipients) {
                ctx.statusEngine.applyTimedAbilityStatus(ctx.round, extraStatus, rid);
                ctx.bus.emit({
                    type: 'buff-applied',
                    actorId: rid,
                    round: ctx.round,
                    buffName: extra.buffName,
                    duration: extra.duration,
                });
            }
        }
```

(Verify `payloadFromConfig` accepts a `{ type:'buff', buffName, parsedEffects, stacks, isStackable, maxStacks, duration }` shape — it consumes the primary `buffCfg` of that shape today. The co-buffs intentionally skip the `attackFlatPctOfCaster` pin — Block Debuff/Barrier carry no such sentinel.)

- [ ] **Step 6: Run tests + tsc + lint.**

- [ ] **Step 7: Goldens byte-identical** (`npm test` + `git status --short`).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(combat): D-PR16 multi-buff co-grant (additionalBuffs) — one proc roll grants several buffs"
```

---

## Task 6: Last Stand registry entry (combines Tasks 4 + 5)

**Files:**
- Modify: `src/utils/abilities/buildEquipmentAbilities.ts` (LAST_STAND_PROC + entry)
- Modify: `src/utils/abilities/__tests__/equipmentCoverage.test.ts`
- Test: `src/utils/combat/__tests__/lastStandApplier.test.ts` (new)

- [ ] **Step 1: Write the failing integration test**

`lastStandApplier.test.ts`: a player team of 2; the carrier (legendary Last Stand, proc forced) survives while the other ally is killed. Assert the carrier carries BOTH `Barrier` AND `Block Debuff` after the death (one proc → both). Control: with ≥2 allies alive, no grant fires. Enemy-side mirror (optional but recommended for team-agnostic coverage): an enemy carrier becomes last-standing against the player team → gains both.

- [ ] **Step 2: Run to confirm fail.**

- [ ] **Step 3: Registry entry + proc map**

```ts
const LAST_STAND_PROC: Record<string, number> = {
    uncommon: 0.18,
    rare: 0.21,
    epic: 0.26,
    legendary: 0.32,
};
```

```ts
    // D-PR16: Last Stand — when this unit becomes the last one standing, X% chance to gain
    // Barrier AND Block Debuff (self) for 1 turn. Rides on-ally-destroyed gated on last-standing
    // (fires on the ally death that leaves the owner sole survivor); both buffs on ONE proc roll.
    LAST_STAND: (rarity) => {
        const procChance = LAST_STAND_PROC[rarity];
        if (procChance === undefined) return undefined;
        return mkNamedBuffGrant('Barrier', 'self', 'on-ally-destroyed', 1, {
            procChance,
            conditions: [{ subject: 'last-standing', derivable: true }],
            alsoGrantBuffNames: ['Block Debuff'],
        });
    },
```

- [ ] **Step 4: Coverage tracker** — add `'LAST_STAND'` to array + Set.

- [ ] **Step 5: Run tests + tsc + lint** (`npm test -- lastStandApplier equipmentCoverage`).

- [ ] **Step 6: Goldens byte-identical** (`npm test` + `git status --short`).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(combat): D-PR16 Last Stand — last-standing grants self Barrier + Block Debuff"
```

---

## Task 7: Changelog + final holistic verification

**Files:**
- Modify: `src/constants/changelog.ts`

- [ ] **Step 1: Add the changelog entry**

In `UNRELEASED_CHANGES` (`src/constants/changelog.ts`), add a plain-English line, e.g.:

> "Combat sim: the Firewall, Lockdown, Tenacity, and Last Stand implants now take effect — they reactively grant Block Debuff (auto-resist incoming debuffs), Buff Protection (buffs can't be purged), and Barrier when their conditions are met."

- [ ] **Step 2: Final coverage assertion** — confirm `equipmentCoverage.test.ts` now lists all four (FIREWALL, LOCKDOWN, TENACITY, LAST_STAND) in BOTH the array and the Set, and the `it('exactly {...}')` description string matches. Run `npm test -- equipmentCoverage`.

- [ ] **Step 3: Full verification gate**

```bash
npm test            # full suite green
npx tsc --noEmit    # clean
npm run lint        # 0 warnings
npm test -- audit   # if an audit:skills test exists; else npm run audit:skills
git status --short  # NO *.snap / golden files modified
```

Expected: all green; zero golden/snapshot drift. If any golden moved, STOP and find the leaked gate — never `vitest -u`.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "docs(combat): D-PR16 changelog entry for Block/Protection appliers"
```

- [ ] **Step 5: Push + open PR** (after the holistic review approves)

```bash
git push -u origin feat/combat-d-pr16-block-protection-appliers 2>&1 | cat
gh pr create --base feat/combat-d-pr15-block-control-primitives \
  --title "feat(combat): D-PR16 — Block/Protection appliers (Firewall/Lockdown/Tenacity/Last Stand)" \
  --body "..."
```

(Base = the D-PR15 branch since #147 is unmerged; retarget to `main` after #147 merges. Use `gh auth switch --user TheSusort` first if needed.)

---

## Known limitations / notes for reviewers

- **Tenacity damage granularity:** the threshold reads the per-ATTACK aggregate damage, not per-hit (per-hit damage isn't tracked — same accepted approximation as Bloodthirst, D-PR1). DoT/bomb never emit `attacked` → correctly excluded ("directly receiving").
- **Firewall scope:** fires on timed debuffs received (incl. control-as-named-debuff Stasis/Disable), NOT on DoT application (`dot-applied` is a separate event). Matches "when debuffed".
- **Last Stand `last-standing`:** evaluated at drain time after deaths are recorded; fires on the ally-death event that leaves the owner sole survivor. Multiple simultaneous deaths → on-ally-destroyed fires per death, gate passes only on the one leaving exactly one alive.
- **No once-per-round caps** — all four are pure %-chance procs (unlike D-PR14 Bulwark).
- **Byte-identical invariant:** no fixture equips these implants → all goldens must stay byte-identical. The `attacked.damage` field is conditionally spread to preserve event byte-shape in healing mode.
