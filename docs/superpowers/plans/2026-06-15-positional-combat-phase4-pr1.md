# Positional Combat Phase 4 — PR 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a symmetric per-victim damage-apply path (so player attacks can damage and kill real enemy actors), wire `resolveCells` for multi-target AoE with per-hit re-resolution, and make the three Phase-2-deferred accounting paths per-victim-correct — all as a capability-only overlay that keeps DPS/healing goldens byte-identical.

**Architecture:** Today `applyIncomingToTarget` (engine.ts:1919) is the *only* `currentHp`-decrement path and runs only enemy→player; player→enemy damage uses the cumulative-damage sink and never decrements a real enemy. PR 1 (a) extracts the victim-intake core into a reusable `applyVictimDamage` parameterized by a side-specific accounting sink (the enemy→player wrapper stays byte-identical), (b) adds a player→enemy wrapper, (c) adds a per-victim damage *calculator* (per-victim defense/affinity), and (d) a new `positionalApply.ts` that, for a positioned attacker with a damage ability, loops per hit → re-resolves anchor → `resolveCells` → applies full/50% damage per living occupant. The non-positional path is untouched.

**Tech Stack:** TypeScript, Vitest. Engine code in `src/utils/combat/`, geometry in `src/utils/targeting/`.

**Spec:** `docs/superpowers/specs/2026-06-15-positional-combat-phase4-design.md`

---

## Workflow notes (read first)

- **Worktree:** do this PR in its own git worktree off latest `main`. After creating it, **symlink the gitignored files** the test suite + pre-commit hook need: `.env` and `docs/ship-targeting.csv`, `docs/ship-skills.csv`, `docs/bios.csv`, `docs/combat-system.md` from the main checkout — else env-only tests fail and the hook blocks the commit.
- **`gh auth switch --hostname github.com --user TheSusort`** before any PR/merge/gh-api op.
- **Goldens are SYNTHETIC** (`healingGoldenParity.test.ts` + the DPS golden suite; hand-built `ab()` actors, no parser import). **Any diff = a bug. NEVER `vitest -u`.** The whole PR's safety invariant is: with no positions supplied, every golden is byte-identical. If one moves, the positional gate leaked — fix the gate.
- **`docs/` is gitignored** → `git add -f` for spec/plan; docs-only commits use `--no-verify` (the pre-commit hook runs the full vitest suite).
- **Changelog:** one evolving `UNRELEASED_CHANGES` entry for combat work — fold, don't add separate entries. PR 1 is capability-only (no user-visible behavior yet) → **no changelog entry** until Phase 5 wires a caller.
- Test commands: `npm test -- <path>` (single file), `npm test` (full suite), `npm run lint`, `npx tsc --noEmit`, `npm run audit:skills`.

---

## File structure

| File | Responsibility | Change |
|---|---|---|
| `src/utils/combat/engine.ts` | `applyVictimDamage` core + two wrappers; wire positional apply at 3 damage sites; per-victim accounting | Modify |
| `src/utils/combat/victimDamage.ts` | **new** pure per-victim damage calculator (attacker scalars + victim defense/affinity → damage) | Create |
| `src/utils/combat/positionalApply.ts` | **new** per-hit loop: re-resolve anchor, `resolveCells`, role-scale, apply per living occupant | Create |
| `src/utils/combat/playerTurn.ts` | expose attacker-side damage scalars on `PlayerTurnResult` for the positional path | Modify |
| `src/utils/calculators/dpsSimulator.ts` (or wherever `RoundData` lives — confirm in Task 9) | additive `perTargetDamage` field | Modify |
| `src/utils/combat/__tests__/*.test.ts` | unit/integration tests — combat tests live under `__tests__/` (matches `barrier.test.ts`/`healing.test.ts` whose fixtures Tasks 1 & 3 reuse; import them as `./barrier`, `./healing` from within `__tests__/`). NOTE: `targeting/` tests are flat (no `__tests__/`) per its own convention. | Create |

---

## Task 1: Characterization tests for the current victim-intake (lock behavior before refactor)

**Files:**
- Test: `src/utils/combat/__tests__/applyVictimDamage.characterization.test.ts` (new)

Pin the *current* `applyIncomingToTarget` behavior through the engine so the Task 2 extraction is provably behavior-preserving. Use the existing healing-mode engine entry (`simulateHealing` adapter or a direct `runCombat` harness — match how `healing.test.ts` / `barrier.test.ts` drive it) with hand-built actors.

- [ ] **Step 1: Write characterization tests** covering the victim-intake branches against a heal target:
  - plain HP damage (shield 0) decrements `currentHp` by exactly the damage;
  - shield absorbs first, overflow hits HP;
  - Barrier carrier → full block, HP unchanged, `barrierAbsorbed` accrues, `hp-changed` still emitted once;
  - lethal hit on a Cheat-Death carrier → survives at 1 HP, `cheat-death-activated` emitted, removable statuses cleared;
  - lethal hit, no Cheat Death → `currentHp` 0, `ship-destroyed` emitted once.
  (These mirror `barrier.test.ts` / Phase 4b death tests — reuse their fixture helpers.)
- [ ] **Step 2: Run, expect PASS** (documents current behavior): `npm test -- src/utils/combat/__tests__/applyVictimDamage.characterization.test.ts`
- [ ] **Step 3: Commit**

```bash
git add src/utils/combat/__tests__/applyVictimDamage.characterization.test.ts
git commit -m "test(combat): characterize victim-intake before phase-4 extraction"
```

---

## Task 2: Extract `applyVictimDamage` core (behavior-preserving)

**Files:**
- Modify: `src/utils/combat/engine.ts:1919-2036` (the `applyIncomingToTarget` closure)

Extract the body of `applyIncomingToTarget` into a closure `applyVictimDamage(damage, victim, sink)` where `sink` carries the three side-specific accumulators as callbacks/refs:

```ts
interface DamageAccountingSink {
    addIncoming: (amount: number) => void;      // today: roundIncomingDamage += amount
    addShieldAbsorbed: (amount: number) => void; // today: roundShieldAbsorbed += amount
    addBarrierAbsorbed: (amount: number) => void;// today: roundBarrierAbsorbed += amount
    onHealTargetDestroyed?: (victim: CombatActor) => void; // today: healTargetDestroyedRound write (guarded victim===healTarget)
}
```

Everything else (Barrier detection via `selfBuffNamesForOwners`, shield drain, `currentHp` decrement, Cheat-Death intercept, `recordDestroyed`, `hp-changed` emits) is already victim-keyed → moves verbatim.

`applyIncomingToTarget(damage, victim = healTarget!)` becomes a thin wrapper passing the **player-side sink** (the existing `roundIncomingDamage`/`roundShieldAbsorbed`/`roundBarrierAbsorbed` mutators + the `victim === healTarget` destroyed write). Behavior identical.

- [ ] **Step 1:** Run the Task 1 characterization tests + full golden suite to confirm green baseline: `npm test`
- [ ] **Step 2:** Perform the extraction (pure refactor — no behavior change). Keep `applyVictimDamage` as a closure inside `runCombat` (it needs `statusEngine`, `bus`, `r`, `recipientMaxHp`, `cheatDeathConsumed`, `recordDestroyed`).
- [ ] **Step 3:** Run characterization + full suite, **expect byte-identical** (all green, no golden diff): `npm test`
  - Expected: PASS, zero golden snapshot changes. If any golden moves, the extraction changed behavior — revert and redo.
- [ ] **Step 4:** `npx tsc --noEmit && npm run lint`
- [ ] **Step 5: Commit**

```bash
git add src/utils/combat/engine.ts
git commit -m "refactor(combat): extract applyVictimDamage core (behavior-preserving)"
```

---

## Task 3: Player→enemy wrapper

**Files:**
- Modify: `src/utils/combat/engine.ts` (near `applyIncomingToTarget`)
- Test: `src/utils/combat/__tests__/applyOutgoingToEnemy.test.ts` (new)

Add `applyOutgoingToEnemy(damage, enemyVictim)` — a second thin wrapper over `applyVictimDamage` with an **enemy-side sink** that does NOT touch the player-incoming accumulators (those are the tank's incoming bucket). For PR 1 the enemy-side sink may be a no-op for the three accumulators (enemy-incoming accounting is the Phase-5 symmetric surface); it still runs the full HP/shield/Barrier/Cheat-Death/`recordDestroyed` path so enemies actually take damage and die.

- [ ] **Step 1: Write failing tests** with a hand-built enemy actor (positioned, real `currentHp`/`shieldPool`):
  - damage decrements the enemy victim's `currentHp`;
  - shield absorbs first;
  - enemy carrying Barrier → full block;
  - lethal damage, no Cheat Death → enemy `currentHp` 0 + `ship-destroyed` emitted;
  - lethal on enemy Cheat-Death carrier → survives at 1.
- [ ] **Step 2: Run, expect FAIL** (function undefined): `npm test -- src/utils/combat/__tests__/applyOutgoingToEnemy.test.ts`
- [ ] **Step 3: Implement** the wrapper + enemy-side sink.
- [ ] **Step 4: Run, expect PASS**; then `npm test` full suite **byte-identical** (no caller yet → goldens unmoved).
- [ ] **Step 5: Commit**

```bash
git add src/utils/combat/engine.ts src/utils/combat/__tests__/applyOutgoingToEnemy.test.ts
git commit -m "feat(combat): player->enemy per-victim damage apply wrapper"
```

---

## Task 4: Per-victim damage calculator

**Files:**
- Create: `src/utils/combat/victimDamage.ts`
- Test: `src/utils/combat/__tests__/victimDamage.test.ts`

A pure function turning attacker-side scalars + a per-hit crit outcome + a single victim's defensive profile into a damage number. Factor the per-victim-dependent math out of `playerTurn.ts:1110-1282` (`effectiveDefense`/`damageReduction` from victim defense+penetration, `affinityMult` from attacker-vs-victim affinity). Attacker-side scalars (`effectiveAttack`, `effectiveMultiplier + conditionalBonusPct`, `secondaryStatValue`, `effectiveCritDamage`, `outgoingDamageBuff`, `incomingDamageModifier`) are fixed per cast and passed in.

```ts
export interface AttackerDamageScalars {
    effectiveAttack: number;
    multiplierPct: number;        // effectiveMultiplier + conditionalBonusPct
    secondaryStatValue: number;
    effectiveCritDamage: number;  // percent
    outgoingDamageBuffPct: number;
    incomingDamageModifierPct: number;
    defensePenetrationPct: number;
    attackerAffinity: AffinityName;   // ship.ts:7 — for affinity matchup vs victim (affinityUtils.ts)
}
export interface VictimDefenseProfile {
    defence: number;
    defenceModifierPct: number;
    affinity: AffinityName;
}
// didCrit = the per-hit crit outcome (hitCrits[h]); roleScale = 1 (origin) | 0.5 (covered)
export function victimHitDamage(
    s: AttackerDamageScalars, v: VictimDefenseProfile, didCrit: boolean, roleScale: number
): number
```

**Parity constraint (the load-bearing test):** for a SINGLE victim and `hits` hits, `sum over h of victimHitDamage(s, v, hitCrits[h], 1)` must equal the current aggregate `directDamage` (minus passive/secondary which stay in their existing buckets — match the exact decomposition; see playerTurn.ts:1259-1282). Use full precision, no per-hit rounding.

- [ ] **Step 1: Write failing tests**: (a) a hand-computed single-hit value through defense+crit+affinity; (b) **per-hit-vs-aggregate parity**: with a fixed `hitCrits` array, the per-hit sum equals the existing aggregate formula for the same inputs; (c) `roleScale: 0.5` halves the origin damage.
- [ ] **Step 2: Run, expect FAIL**: `npm test -- src/utils/combat/__tests__/victimDamage.test.ts`
- [ ] **Step 3: Implement** by mirroring the existing formula (defense reduction via `calculateDamageReduction`, `nonCritFactor`, `damageCritMultiplier` but per-hit binary instead of blended `critFraction`).
- [ ] **Step 4: Run, expect PASS**.
- [ ] **Step 5: Commit**

```bash
git add src/utils/combat/victimDamage.ts src/utils/combat/__tests__/victimDamage.test.ts
git commit -m "feat(combat): pure per-victim hit-damage calculator"
```

---

## Task 5: `positionalApply` footprint expansion (no per-hit loop yet)

**Files:**
- Create: `src/utils/combat/positionalApply.ts`
- Test: `src/utils/combat/__tests__/positionalApply.test.ts`

A pure helper that, given a `ParsedPattern`, an `anchor`, and the living opposing roster, returns the per-cell victims with their role scale:

```ts
export interface FootprintHit { victim: CombatActor; roleScale: number; } // origin→1, covered→0.5
export function footprintVictims(
    pattern: ParsedPattern, anchor: Position, opposingLiving: CombatActor[]
): FootprintHit[]
```

Use `resolveCells(pattern, anchor)` → for each `{position, role}`, look up the living occupant via a `byCell` map (mirror `positionalBinding.ts:53-58`); skip empty cells; `role === 'covered'` → 0.5 else 1.0. `not-self` cells carry no `origin` role — key scale off `role`, not position.

- [ ] **Step 1: Write failing tests** with hand-built positioned actors (reuse `positionalBinding.test.ts`'s `actor()` helper style) + real `ParsedPattern`s from `parsePattern` (or the committed `corpusPatterns` fixture): single-target pattern → only origin victim; an AoE pattern → origin at 1.0 + covered at 0.5; a covered cell with no occupant contributes nothing.
- [ ] **Step 2: Run, expect FAIL**: `npm test -- src/utils/combat/__tests__/positionalApply.test.ts`
- [ ] **Step 3: Implement** `footprintVictims`.
- [ ] **Step 4: Run, expect PASS**.
- [ ] **Step 5: Commit**

```bash
git add src/utils/combat/positionalApply.ts src/utils/combat/__tests__/positionalApply.test.ts
git commit -m "feat(combat): positional footprint -> per-victim role-scaled list"
```

---

## Task 6: `positionalApply` per-hit loop with re-resolution

**Files:**
- Modify: `src/utils/combat/positionalApply.ts`
- Test: `src/utils/combat/__tests__/positionalApply.test.ts`

Add the per-hit driver that ties together re-resolution, footprint, damage calc, and apply:

```ts
export function applyPositionalDamage(args: {
    hits: number;
    hitCrits: boolean[];
    scalars: AttackerDamageScalars;
    pattern: ParsedPattern;
    actorPosition: Position;
    target: ParsedTarget;
    opposingLiving: CombatActor[];                 // re-read each hit (living filter)
    statusOf?: (id: string) => ActorTargetingStatus | undefined;
    acting?: { ignoresForcedTargeting?: boolean; provokedBy?: string };
    defenseProfileOf: (v: CombatActor) => VictimDefenseProfile;
    applyToVictim: (victim: CombatActor, damage: number) => void; // wrapper from Task 2/3
    emitHit?: (victim: CombatActor, damage: number, didCrit: boolean) => void;
}): void
```

For each hit `h`: `resolvePositionalTarget(actorPosition, target, opposingLiving (living-filtered now), statusOf, acting)` → anchor actor. **If null → whiff: no damage, no event** (spec §5.1). Else `footprintVictims(pattern, anchorActor.position, opposingLiving)` → for each `{victim, roleScale}`: `victimHitDamage(scalars, defenseProfileOf(victim), hitCrits[h] ?? false, roleScale)` → `applyToVictim(victim, dmg)` + `emitHit?.(...)`. Because `applyToVictim` decrements `currentHp`, a victim that dies on hit `h` is filtered out of the living roster for hit `h+1` → re-resolution redirects.

- [ ] **Step 1: Write failing tests**:
  - 3-hit single-target: anchor dies to hit 1 (set its HP so hit-1 damage is lethal) → hits 2-3 land on the next living target (assert via `applyToVictim` spy);
  - all opposing dead before a hit → that hit invokes neither `applyToVictim` nor `emitHit`;
  - AoE multi-hit: each hit applies origin full + covered half.
- [ ] **Step 2: Run, expect FAIL**.
- [ ] **Step 3: Implement** the loop.
- [ ] **Step 4: Run, expect PASS**.
- [ ] **Step 5: Commit**

```bash
git add src/utils/combat/positionalApply.ts src/utils/combat/__tests__/positionalApply.test.ts
git commit -m "feat(combat): positional per-hit apply loop with re-resolution"
```

---

## Task 7: Expose attacker scalars on `PlayerTurnResult`

**Files:**
- Modify: `src/utils/combat/playerTurn.ts:103-126` (interface) and `:1635-1660` (return)

Add an optional `positionalScalars?: AttackerDamageScalars` and `hitCrits?: boolean[]` to `PlayerTurnResult`, populated from the values already computed at `playerTurn.ts:1080-1268`. Optional + only read by the positional engine branch → non-positional callers ignore it.

- [ ] **Step 1: Write failing test** (`playerTurn` unit or via engine) asserting the returned `positionalScalars` reproduce the aggregate `directDamage` when fed through `victimHitDamage` for the bound single victim (parity guard at the integration boundary).
- [ ] **Step 2: Run, expect FAIL**.
- [ ] **Step 3: Implement** — populate the new fields from existing locals; **do not change** the existing aggregate `directDamage` computation or the single `ability-performed` emit.
- [ ] **Step 4: Run, expect PASS**; `npm test` full suite **byte-identical**.
- [ ] **Step 5: Commit**

```bash
git add src/utils/combat/playerTurn.ts
git commit -m "feat(combat): expose attacker damage scalars for positional apply"
```

---

## Task 8: Wire positional apply into the focus + team damage sites

**Files:**
- Modify: `src/utils/combat/engine.ts:2452-2503` (focus), `:2569-2617` (team)
- Test: `src/utils/combat/__tests__/positionalDamage.integration.test.ts` (new)

At each site, after `runPlayerTurn` returns, **if** `isPositional(actor.position, enemyAttackerActors) && input.target/teamTarget && turn.positionalScalars && <firing skill has a damage ability>`: call `applyPositionalDamage(...)` against `enemyAttackerActors` with `applyToVictim = applyOutgoingToEnemy`, the `statusLookupFor`/`provokerOf` already built at the site, and `defenseProfileOf` reading each enemy actor's stats. **Suppress** the cumulative-sink credit for the positional case (the existing `enemyHpDecline: selectedEnemy ? 0 : …` already zeroes the sink; ensure `creditDamage(...'direct'...)` for the focus/team turn is likewise gated so positional damage isn't double-counted into `cumulativeDamage`). Non-positional path unchanged.

> Decide & document at this task: in positional mode the focus/team `turn.directDamage` must NOT also feed `creditDamage`/`cumulativeDamage` (that's the DPS-sink model). Gate it on the same positional condition.

- [ ] **Step 1: Write failing integration test**: a positioned focus attacker + a positioned enemy team (must set `healTargetId` so `enemyAttackerActors` is populated — engine throws otherwise); assert the targeted enemy's `currentHp` declines by the computed damage, and an AoE skill also damages covered enemies at 50%.
- [ ] **Step 2: Run, expect FAIL**.
- [ ] **Step 3: Implement** focus + team wiring.
- [ ] **Step 4: Run, expect PASS**; `npm test` full suite **byte-identical** (no production caller passes positions).
- [ ] **Step 5:** `npx tsc --noEmit && npm run lint`
- [ ] **Step 6: Commit**

```bash
git add src/utils/combat/engine.ts src/utils/combat/__tests__/positionalDamage.integration.test.ts
git commit -m "feat(combat): wire positional AoE apply at focus + team damage sites"
```

---

## Task 9: Wire enemy site + per-target accounting (takenLeeches / targetHpPct / enemyHpDecline)

**Files:**
- Modify: `src/utils/combat/engine.ts:2812-2999` (enemy site), accounting at `:1736-1753`, `:2858`, `targetHpPct` reads
- Test: extend `positionalDamage.integration.test.ts`

Enemy→player AoE: at the enemy site, when positional, drive `applyPositionalDamage` against `allPlayerActors` with `applyToVictim = applyIncomingToTarget` (the player-side wrapper) so an enemy AoE can hit multiple player ships. Then make the three accounting paths per-victim-correct:
- **`takenLeeches`** — currently collected for `healTarget` only (engine.ts:1736). Resolve/credit leech against the **actual hit player victim**, not the heal target. (Scope: keep it correct per-victim; the unified per-actor heal surface is Phase 5.)
- **`targetHpPct`** — report the real victim's HP% for the victim being hit.
- **`enemyHpDecline`** — for a positionally-selected enemy on focus/team, decline now comes from the Task-8 real decrement; drop the `selectedEnemy ? 0 :` placeholder's reliance on the sink for the selected enemy (the enemy actor's `currentHp` is authoritative). Leave the enemy-turn site's real-HP derivation (`:2858`) as-is.

- [ ] **Step 1: Write failing tests**: (a) an enemy AoE hits two player ships, both `currentHp` decline (origin full, covered half); (b) a `damage-taken` leecher among the hit victims leeches off the damage *it* took; (c) `targetHpPct`/`enemyHpDecline` reflect the real victim.
- [ ] **Step 2: Run, expect FAIL**.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run, expect PASS**; `npm test` full suite **byte-identical**.
- [ ] **Step 5: Commit**

```bash
git add src/utils/combat/engine.ts src/utils/combat/__tests__/positionalDamage.integration.test.ts
git commit -m "feat(combat): enemy-side AoE apply + per-victim leech/HP accounting"
```

---

## Task 10: Additive `perTargetDamage` result field

**Files:**
- Modify: the `RoundData` definition (confirm location — `dpsSimulator.ts:90-126`) + the round-assembly sites
- Test: extend `positionalDamage.integration.test.ts` + a golden additive-shape check

Add an **additive, optional** `perTargetDamage?: Record<string, number>` (victim id → damage this round) populated only when the positional path ran. Existing fields untouched. Lock the field name + key type here (victim actor id) per the spec-review note.

- [ ] **Step 1: Write failing test** asserting `perTargetDamage` maps each hit victim id to its received damage in a positional round, and is `undefined`/absent in a non-positional round.
- [ ] **Step 2: Run, expect FAIL**.
- [ ] **Step 3: Implement** the additive field + population.
- [ ] **Step 4: Run, expect PASS**; `npm test` full suite — goldens may show **purely additive** churn ONLY if a snapshot serializes the new key on a non-positional run; if so, confirm the value is absent/empty and the churn is additive-only (like `barrierAbsorbed`/`resistedDebuffs`), then accept. **Numeric trajectories must not change.**
- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(combat): additive perTargetDamage round field"
```

---

## Task 11: Final verification + holistic review

**Files:** none (verification only)

- [ ] **Step 1:** `npm test` — full suite green; DPS + healing goldens **byte-identical** (diff the snapshot files vs `main`; only additive `perTargetDamage` keys allowed, no numeric changes).
- [ ] **Step 2:** `npm run audit:skills` — expect 0 findings / 141 ships.
- [ ] **Step 3:** `npx tsc --noEmit && npm run lint` — clean (lint max-warnings 0).
- [ ] **Step 4:** Final holistic self-review against the spec §5: generalized apply byte-identical wrapper; player→enemy decrement + death; per-hit re-resolution; whiff emits nothing; covered=50% damage-only; accounting per-victim; capability-only (no production caller passes positions).
- [ ] **Step 5:** Open PR (`gh auth switch` first). PR body: capability-only, goldens byte-identical, links the spec. Request CodeRabbit; poll `mergeState=CLEAN`.

---

## Out of scope (this PR)

- Death-fallback inter-turn retargeting, Harvester `on-ally-destroyed` activation, Salvation dead-recipient filtering → **PR 2**.
- Full side-symmetric per-actor-per-side result surface + enemy-incoming accounting buckets → **Phase 5**.
- Global per-hit refactor of the non-positional outgoing path → separate later phase.
- Any production caller passing positions / simulator UI → **Phase 5**.
