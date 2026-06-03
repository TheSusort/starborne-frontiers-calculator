# Skill & Ability Editor — Phase 2: Simulator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Refactor the DPS simulator's round loop to drive damage/conditional/charge/DoT from the Phase 1 **ability model**, reusing the existing math kernels, with a flat→abilities adapter so the existing `dpsSimulator.test.ts` proves byte-identical numbers; then add modifier + multi-hit consumption (exercised via an explicit-abilities input path).

**Architecture:** `simulateDPS` keeps its `DPSSimulationInput` public API. Internally it builds a `ShipSkills` either from a new optional `input.shipSkills` (set by Phase 3 / new tests) or via a `flatInputToAbilities(input)` adapter. `runSinglePass` walks the firing skill's abilities each round: a damage ability (× `hits`, + conditional `scaledBonus`), an additional-damage ability (secondary kernel), dot abilities (DoT kernel), charge abilities (accumulator via `evaluateCondition`), and modifier abilities folded into the round's buff totals. Buffs/debuffs (`SelectedGameBuff`), the buff timeline, affinity/crit/hacking, and the damage formula are **unchanged** — only the *source* of multiplier/secondary/conditional/charge/dot changes.

**Tech Stack:** TypeScript, Vitest. No new deps.

**Spec:** `docs/superpowers/specs/2026-06-01-skill-ability-editor-design.md` (§4). **Phase 1 foundation** (already shipped): `src/types/abilities.ts`, `src/utils/abilities/evaluateConditions.ts` (`evaluateCondition`, `conditionsMet`, `scaledBonus`, `ConditionContext`).

**Baseline branch:** continue on `feat/skill-ability-editor` (already rebased on `feat/dps-charge-manipulation`). Confirm Phase 1 present: `ls src/utils/abilities/` shows `evaluateConditions.ts`, `buildShipAbilities.ts`.

**The identical-numbers contract (read before starting):** `src/utils/calculators/__tests__/dpsSimulator.test.ts` (62 tests) passes flat `DPSSimulationInput` and is the regression oracle. After every task it MUST stay green with no assertion changes. The reason this is safe: `evaluateCondition` was built to mirror the inline logic exactly —
- conditional `self-buff` count = `entry.activeSelfBuffs.filter(s.stacks===undefined||s.stacks>0).length` ⇔ `evaluateCondition({subject:'self-buff',derivable:true})` against `ctx.selfBuffNames` of those same entries.
- conditional/charge `enemy-debuff` count = `landedEnemyDebuffs.length + corrosionEntries.length + infernoEntries.length + pendingBombs.length` ⇔ `ctx.enemyDebuffCount` set to that sum.
- charge switch (`always`→1, `self-crit`→effectiveCrit/100, `self-buff`→count, `enemy-debuff`→count, `enemy-type`→match?1:0, else→`manualCount??1`) ⇔ `evaluateCondition` arms exactly.
- conditional bonus = `pct*count` then `Math.min(_, cap)` ⇔ `scaledBonus` (`perUnit=pct`, `cap=cap`).

**Conventions:** tests in `__tests__/` beside code; `npx vitest run <path>`; `npm run lint` (max-warnings 0); pre-commit hook runs lint + full suite. `docs/` is gitignored — `git add -f` the plan if amending it.

⚠️ **`Math.random()` caveat:** the debuff landing roll (`roundDebuffLanded = Math.random() < debuffLandingChance`) runs once per round. Do NOT add, remove, or reorder any `Math.random()` call — the existing tests that involve debuffs rely on the call count/position. Keep the single roll exactly where it is.

---

## File Structure (Phase 2)

| File | Change | Responsibility |
|---|---|---|
| `src/utils/abilities/flatInputToAbilities.ts` | create | Pure adapter: `DPSSimulationInput` → `ShipSkills` (active+charged skills; damage(+scaling)/additional-damage/dot/charge abilities). |
| `src/utils/abilities/roundContext.ts` | create | Pure helper `buildRoundContext(...)` assembling a `ConditionContext` from per-round sim state. |
| `src/utils/abilities/applyAbilities.ts` | create | Pure helpers that read a firing skill's abilities: `selectFiringSkill`, `damageInputsFromSkill` (multiplier, hits, scaling), `secondaryFromSkill`, `dotsFromSkill`, `chargeGainFromSkill`, `modifierTotalsFromAbilities`. |
| `src/utils/calculators/dpsSimulator.ts` | modify | Thread `ShipSkills` through; round loop reads from abilities via the helpers above; `DPSSimulationInput` gains optional `shipSkills?: ShipSkills`. |
| `src/utils/calculators/__tests__/dpsSimulator.test.ts` | extend | New cases for modifier + multi-hit (via `input.shipSkills`) + a flat-vs-abilities equivalence test. Existing 62 unchanged. |
| `src/utils/abilities/__tests__/flatInputToAbilities.test.ts` | create | Adapter unit tests. |

---

## Task 1: `flatInputToAbilities` adapter

**Files:** Create `src/utils/abilities/flatInputToAbilities.ts` + `src/utils/abilities/__tests__/flatInputToAbilities.test.ts`.

Converts the flat per-skill damage fields into a `ShipSkills`. Buffs/debuffs/stats are NOT converted (they stay on the flat input).

⚠️ **Condition mapping — pass `derivable` straight through; use an adapter-LOCAL 4-arg `toCondition`.** Do NOT reuse `buildShipAbilities.ts`'s 5-arg `toCondition` (it takes `rawText` and tags `buffName:'Stealth'` on buff subjects — wrong here, and a `buffName` on a `self-buff` conditional would make `countNames` filter by name and diverge from the inline length-count). Write a small local `toCondition(condition, derivable, manualCount, requiredEnemyType): Condition` that is a pure passthrough — `subject:condition`, and carries `derivable`/`manualCount`/`requiredEnemyType` **exactly as the flat field provides them**. CRITICAL: pass `activeConditional.derivable`/`chargedConditional.derivable`/`selfChargeGain.derivable` verbatim — never invent `derivable:true`. This is what keeps the engine swap (Task 2) numerically identical (see Task 2 Step 5 note).

- [ ] **Step 1: Write failing tests.**

```ts
import { describe, it, expect } from 'vitest';
import { flatInputToAbilities } from '../flatInputToAbilities';

const base = {
    attack: 1000, crit: 100, critDamage: 0, defensePenetration: 0,
    activeMultiplier: 180, chargedMultiplier: 350, chargeCount: 3,
    activeDoTs: [], chargedDoTs: [], enemyDefense: 0, enemyHp: 500000,
    rounds: 10, selfBuffs: [], enemyDebuffs: [],
};

describe('flatInputToAbilities', () => {
    it('builds active + charged skills with damage abilities from multipliers', () => {
        const s = flatInputToAbilities({ ...base });
        const active = s.slots.find((x) => x.slot === 'active')!;
        const charged = s.slots.find((x) => x.slot === 'charged')!;
        expect(active.abilities.find((a) => a.type === 'damage')!.config).toMatchObject({ multiplier: 180 });
        expect(charged.abilities.find((a) => a.type === 'damage')!.config).toMatchObject({ multiplier: 350 });
    });

    it('maps secondary → additional-damage on the right slot', () => {
        const s = flatInputToAbilities({ ...base, activeSecondary: { stat: 'defense', pct: 80 } });
        const active = s.slots.find((x) => x.slot === 'active')!;
        expect(active.abilities.find((a) => a.type === 'additional-damage')!.config).toMatchObject({ stat: 'defense', pct: 80 });
    });

    it('maps conditional → scaling on the slot damage ability', () => {
        const s = flatInputToAbilities({ ...base, activeConditional: { pct: 20, condition: 'enemy-debuff', derivable: true, cap: 100 } });
        const dmg = s.slots.find((x) => x.slot === 'active')!.abilities.find((a) => a.type === 'damage')!;
        expect(dmg.conditions[0]).toMatchObject({ subject: 'enemy-debuff', derivable: true });
        expect(dmg.scaling).toEqual({ conditionIndex: 0, perUnit: 20, cap: 100 });
    });

    it('maps selfChargeGain → a self charge ability on the active skill', () => {
        const s = flatInputToAbilities({ ...base, selfChargeGain: { amount: 1, condition: 'always', derivable: true } });
        const active = s.slots.find((x) => x.slot === 'active')!;
        const charge = active.abilities.find((a) => a.type === 'charge')!;
        expect(charge.target).toBe('self');
        expect(charge.config).toMatchObject({ amount: 1 });
        expect(charge.conditions[0]).toMatchObject({ subject: 'always' });
    });

    it('maps DoTs → dot abilities per slot', () => {
        const s = flatInputToAbilities({ ...base, activeDoTs: [{ id: 'x', type: 'corrosion', tier: 3, stacks: 1, duration: 2 }] });
        const active = s.slots.find((x) => x.slot === 'active')!;
        expect(active.abilities.find((a) => a.type === 'dot')!.config).toMatchObject({ dotType: 'corrosion', tier: 3, stacks: 1, duration: 2 });
    });

    it('omits the charged slot when there is no charged skill (multiplier 0)', () => {
        const s = flatInputToAbilities({ ...base, chargedMultiplier: 0, chargeCount: 0 });
        expect(s.slots.find((x) => x.slot === 'charged')).toBeUndefined();
    });
});
```

- [ ] **Step 2: Run → fail** (module missing).

- [ ] **Step 3: Implement.** `flatInputToAbilities(input: DPSSimulationInput): ShipSkills`:
  - Active skill abilities (in this order — order matters for `conditionIndex`/test stability): `damage`(multiplier=`activeMultiplier`), then if `activeSecondary` an `additional-damage`, then for each `activeDoTs` entry a `dot`, then if `selfChargeGain` a `charge`(target `self`). If `activeConditional`, set the damage ability's `conditions=[toCondition(activeConditional)]` and `scaling={conditionIndex:0, perUnit:activeConditional.pct, cap?:activeConditional.cap}`.
  - Charged skill (only if `chargedMultiplier > 0`): `damage`(`chargedMultiplier`) + `chargedSecondary` + `chargedDoTs` + `chargedConditional` scaling. No charge ability on the charged skill.
  - `dot` ability config: `{ type:'dot', dotType: entry.type, tier: entry.tier, stacks: entry.stacks, duration: entry.duration }`, target `enemy`.
  - `charge` ability config `{ type:'charge', amount: selfChargeGain.amount }`; condition via `toCondition(selfChargeGain.condition, derivable, manualCount, requiredEnemyType)`.
  - All abilities `target:'enemy'` except charge (`self`); `trigger:'on-cast'`; mark `autoFilled:true` (consistent with the parser).
  - Note: `allyChargePerRound` is NOT converted to an ability in Phase 2 — it stays a flat sim param (see Task 3).
  - Deterministic ids are fine (`adapter-active-damage`, etc.) — they aren't asserted.

- [ ] **Step 4: Run → pass.** `npx vitest run src/utils/abilities/__tests__/flatInputToAbilities.test.ts`.
- [ ] **Step 5: Lint + commit.** `git commit -m "feat: flat DPS input → ShipSkills adapter"`

---

## Task 2: Integrate the Phase 1 engine for conditional + charge (no structural change yet)

**Files:** modify `src/utils/calculators/dpsSimulator.ts`; create `src/utils/abilities/roundContext.ts` + test.

This task swaps ONLY the two inline blocks (conditional scaling, charge gain) for the Phase 1 engine, building a `ConditionContext` per round. Everything else in `runSinglePass` stays. The existing 62 tests prove the swap is behavior-preserving.

- [ ] **Step 1: Write a failing test for `buildRoundContext`** in `src/utils/abilities/__tests__/roundContext.test.ts` — given primitive round state (active self-buff names, landed debuff count, dot-array lengths, effectiveCrit, enemyType, hp pcts), it returns a `ConditionContext` with `selfBuffNames`, `enemyDebuffCount = landed + corrosion + inferno + bomb`, `effectiveCritRate`, `enemyType`, `selfHpPct:100`, `enemyHpPct:100` (DPS assumptions), and zeros for adjacency/destroyed.

```ts
import { describe, it, expect } from 'vitest';
import { buildRoundContext } from '../roundContext';

it('assembles a ConditionContext from round state', () => {
    const ctx = buildRoundContext({
        selfBuffNames: ['Attack Up II'],
        landedEnemyDebuffCount: 2, corrosionStacks: 1, infernoStacks: 0, bombCount: 1,
        effectiveCritRate: 70, enemyType: 'Defender',
    });
    expect(ctx.selfBuffNames).toEqual(['Attack Up II']);
    expect(ctx.enemyDebuffCount).toBe(4); // 2 + 1 + 0 + 1
    expect(ctx.effectiveCritRate).toBe(70);
    expect(ctx.enemyType).toBe('Defender');
    expect(ctx.selfHpPct).toBe(100);
    expect(ctx.enemyHpPct).toBe(100);
});
```
⚠️ The inline `enemy-debuff` count uses **array LENGTHS** (`corrosionEntries.length`, `infernoEntries.length`, `pendingBombs.length`), i.e. number of active DoT *entries*, NOT total stacks. Name the inputs accordingly (`corrosionEntryCount`, etc.) and pass `corrosionEntries.length` from the loop. Get this exactly right or numbers will diverge.

- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Implement `buildRoundContext`** (pure; returns `ConditionContext` from `evaluateConditions.ts`).
- [ ] **Step 4: Run → pass** (roundContext test).
- [ ] **Step 5: In `runSinglePass`,** build `ctx = buildRoundContext({...})` right after `landedEnemyDebuffs`/`effectiveCrit` are known (≈ line 347, before the conditional block). Pass `corrosionEntries.length`, `infernoEntries.length`, `pendingBombs.length`, `landedEnemyDebuffs.length`, the filtered active self-buff names (`entry.activeSelfBuffs.filter(a=>a.stacks===undefined||a.stacks>0).map(a=>a.buffName)`), `effectiveCrit`, `enemyType`.
  - **Replace the conditional block (≈348–368)** with: derive a `Condition` from `activeConditional`/`chargedConditional` (via the same `toCondition` mapping; for the conditional, no requiredEnemyType), build a throwaway `Ability` with `conditions:[cond]` + `scaling:{conditionIndex:0,perUnit:conditional.pct,cap:conditional.cap}`, and set `conditionalBonusPct = scaledBonus(ability, ctx)`. (Or call `evaluateCondition(cond, ctx)` and compute `Math.min(pct*count, cap)` — either reproduces the inline math; prefer `scaledBonus` to share the cap logic.)
  - **Replace the charge block (≈375–408)** with: for the `selfChargeGain`, derive a `Condition` and `chargeGainCount = evaluateCondition(cond, ctx)`; `bonusCharges = selfChargeGain ? chargeGainCount * selfChargeGain.amount : 0`; keep `charges = Math.min(charges + bonusCharges + (allyChargePerRound ?? 0), chargeCount)` inside the existing `if (hasChargedSkill && action === 'active')` guard.
  - ⚠️ **Why this is numerically identical (and its boundary):** the inline conditional block has only 3 branches — `self-buff` (count), `enemy-debuff` (count), and `else → manualCount ?? 1` — and it *ignores* `conditional.derivable`. `evaluateCondition` instead branches on `derivable` first. They agree for every input the flat parser produces because the parser sets `derivable:true` ONLY for `self-buff`/`enemy-debuff`; all other conditional subjects arrive `derivable:false`, so both the inline `else` and `evaluateCondition`'s `!derivable` path return `manualCount ?? 1`. This equivalence therefore depends on Task 1 passing `derivable` through faithfully (a constructed `{condition:'enemy-buff', derivable:true}` WOULD diverge: inline→1, engine→0 — but the adapter never produces that). The charge switch has no such asymmetry (it enumerates self-buff/enemy-debuff/enemy-type/always/self-crit explicitly), so the charge replacement is exact for all inputs. Minor: inline conditional uses raw `manualCount ?? 1` while `evaluateCondition` clamps `Math.max(0, …)` — only matters for a negative manualCount (not a real/tested input).
- [ ] **Step 6: Run the FULL dpsSimulator suite** `npx vitest run src/utils/calculators/__tests__/dpsSimulator.test.ts` → **all 62 pass, unchanged.** If any number differs, the context/condition mapping is wrong — fix until identical. Do NOT edit the test assertions.
- [ ] **Step 7: Lint + commit.** `git commit -m "refactor: drive DPS conditional + charge via the Phase 1 condition engine"`

---

## Task 3: Walk the firing skill's abilities (structural refactor)

**Files:** modify `dpsSimulator.ts`; create `src/utils/abilities/applyAbilities.ts` + test. Add `shipSkills?: ShipSkills` to `DPSSimulationInput`.

Now drive `multiplier`, `secondary`, `dotsConfig`, the conditional scaling, and the charge gain from a `ShipSkills` instead of flat fields.

- [ ] **Step 1: Write failing tests for `applyAbilities` helpers** (`src/utils/abilities/__tests__/applyAbilities.test.ts`): given a `Skill`, `selectFiringSkill(shipSkills, action)` returns the active/charged skill; `damageInputsFromSkill(skill)` returns `{ multiplier, hits, scalingAbility }` (the first `damage` ability's multiplier, `hits ?? 1`, and the ability itself for `scaledBonus`); `secondaryFromSkill(skill)` returns the first `additional-damage` config or undefined; `dotsFromSkill(skill)` returns `DoTApplicationConfig` (map each `dot` ability back to `{type,tier,stacks,duration}`); `chargeAbilitiesFromSkill(skill)` returns the `charge` abilities.
- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Implement `applyAbilities.ts`** (pure functions, no sim state).
- [ ] **Step 4: Run → pass** (applyAbilities test).
- [ ] **Step 5: Thread `ShipSkills` into the sim.**
  - `DPSSimulationInput` gains `shipSkills?: ShipSkills`.
  - In `simulateDPS`, compute `const shipSkills = input.shipSkills ?? flatInputToAbilities(input);` and pass to `runSinglePass` (add a `shipSkills` param).
  - In the loop: after deciding `action`, `const firingSkill = selectFiringSkill(shipSkills, action)`. Derive `multiplier`/`hits`/`scalingAbility` via `damageInputsFromSkill`, `secondary` via `secondaryFromSkill`, `dotsConfig` via `dotsFromSkill`. Replace the flat-field reads (`activeMultiplier`/`chargedMultiplier`, `activeSecondary`/`chargedSecondary`, `activeDoTs`/`chargedDoTs`, `activeConditional`/`chargedConditional`) accordingly.
  - Conditional: `conditionalBonusPct = scalingAbility ? scaledBonus(scalingAbility, ctx) : 0`.
  - Charge: sum over `chargeAbilitiesFromSkill(activeSkill)` of `amount * evaluateCondition(condition, ctx)`, plus `allyChargePerRound`, capped (active rounds only). (For the flat adapter there is exactly one charge ability, so this matches Task 2.)
  - `hasChargedSkill` becomes `shipSkills` has a charged slot with a damage ability AND `chargeCount >= 1`. Keep the `chargeCount`/`startCharged` flat params (they're sim-level, not per-ability).
  - **Multi-hit:** fold `hits` into the damage multiplier — `effectiveMultiplier = multiplier * hits`. Use `effectiveMultiplier` everywhere `multiplier` was used in the damage formula. (Adapter sets `hits` undefined → ×1 → identical.)
- [ ] **Step 6: Run FULL `dpsSimulator.test.ts`** → all 62 still pass, unchanged. The flat path now routes through the adapter; numbers must be identical.
- [ ] **Step 7: Add an equivalence test** to `dpsSimulator.test.ts`: pick a rich flat input (multiplier + charged + secondary + conditional + charge + a DoT) and assert `simulateDPS(flat)` deep-equals `simulateDPS({ ...flat, shipSkills: flatInputToAbilities(flat) })` (same rounds + summary). Proves the explicit-abilities path and the flat path agree.
- [ ] **Step 8: Lint + commit.** `git commit -m "refactor: DPS round loop walks the firing skill's abilities"`

---

## Task 4: Modifier + multi-hit consumption (new behavior)

**Files:** modify `dpsSimulator.ts` + `applyAbilities.ts`; extend `dpsSimulator.test.ts`.

Modifiers come only from `input.shipSkills` (the adapter never produces them), so this adds behavior without touching the flat-path numbers.

- [ ] **Step 1: Write failing tests** (via `input.shipSkills`):
  - **outgoingDamage modifier == outgoingDamage buff:** build a ship with a `modifier`(channel `outgoingDamage`, value 40, isMultiplicative) on the active skill (or a passive slot), no conditions. Assert its per-round direct damage equals the same sim with no modifier but a `selfBuffs` entry whose `parsedEffects.outgoingDamage = 40` (the existing buff path). They must match — a modifier is just another source of the same `outgoingDamageBuff` factor.
  - **attack modifier == attack buff** (channel `attack`, value 50) likewise equals `parsedEffects.attack = 50`.
  - **conditional modifier gates:** a modifier with a condition (e.g. `enemy-type` Defender) contributes only when `enemyType` matches.
  - **multi-hit:** a `damage` ability `{ multiplier: 50, hits: 3 }` produces direct damage equal to a single `{ multiplier: 150 }` ability (same other inputs).
- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Implement `modifierTotalsFromAbilities(abilities, ctx)`** in `applyAbilities.ts`: for each `modifier` ability whose `conditionsMet(conditions, ctx)`, add `value` to the matching channel bucket → returns `{ attack, crit, critDamage, outgoingDamage, defence, hp }` deltas (map model channel `defense`→`defence`; `outgoingDamage`→outgoingDamage; etc.). In the loop (Pass A), gather modifier abilities from the firing skill **plus any `passive`-slot abilities**, compute the totals, and ADD them to the corresponding `attackBuff`/`critBuff`/`critDamageBuff`/`outgoingDamageBuff`/`defenceBuff`/`hpBuff` BEFORE the effective-stat computations. (Additive percentage, same as buffs.) Only `isMultiplicative` percentage modifiers are in scope; treat all current modifiers as percentage (matches the parser).
  - Multi-hit was implemented in Task 3 (`effectiveMultiplier = multiplier * hits`); add the dedicated test here if not already covered.
- [ ] **Step 4: Run → pass.** Then FULL `dpsSimulator.test.ts` → 62 + new all green.
- [ ] **Step 5: Lint + commit.** `git commit -m "feat: DPS sim consumes modifier and multi-hit abilities"`

---

## Task 5: Real-ship integration test + regression sweep

**Files:** extend `dpsSimulator.test.ts` (or a new `__tests__/abilitiesIntegration.test.ts`).

- [ ] **Step 1: Write a test** that runs a real parsed ship end-to-end: `buildShipAbilities(selenite)` → feed as `input.shipSkills` (with stub stats) → `simulateDPS` produces sane output (charged fires on the expected cadence given `chargeCount`, additional-damage from HP present). Assert structural sanity + that the charge ability fires (not exact damage — that's covered elsewhere). This proves Phase 1 parser → Phase 2 sim composes.
- [ ] **Step 2: Run → pass.**
- [ ] **Step 3: Full suite** `npm test` → all green. `npm run lint` clean.
- [ ] **Step 4: Commit.** `git commit -m "test: real-ship parser→simulator integration"`

---

## Done criteria (Phase 2)

- `npm test` green (existing 62 dpsSimulator tests unchanged + new ability/modifier/multi-hit/equivalence/integration tests); `npm run lint` clean.
- `simulateDPS` accepts an optional `shipSkills`; the flat path routes through `flatInputToAbilities` and produces identical numbers.
- The round loop drives multiplier/hits/secondary/conditional/charge/dot/modifier from abilities; buffs/affinity/crit/hacking/DoT kernels unchanged; exactly one `Math.random()` roll per round preserved.
- No UI/page changes — `DPSCalculatorPage` still passes flat fields (it migrates to `shipSkills` in Phase 3).

**Next:** Phase 3 plan — the modal-per-skill editor + page wiring + buff/debuff ability mapping + trigger/hp-threshold detection.
