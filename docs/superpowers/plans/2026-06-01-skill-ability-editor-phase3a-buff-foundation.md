# Skill & Ability Editor — Phase 3a: Buff/Debuff Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make `buff`/`debuff` abilities first-class in the model by wrapping a picked game-buff payload, and build the pure converters that bridge buff/debuff abilities ↔ the simulator's existing `SelectedGameBuff[]` buff path — plus extend the parser to emit buff/debuff abilities (the deferred Phase-1 work). No UI, no page wiring yet (that's Phase 3b).

**Architecture:** A buff/debuff ability carries a game-buff reference (`buffName` + `parsedEffects` + stack info) in its `config`; the ability's `target` and `conditions` live on the `Ability` (existing fields). The sim is **unchanged** — it still consumes `SelectedGameBuff[]` via the schedule-based buff timeline. Phase 3b's page will call a converter that turns buff/debuff abilities into `SelectedGameBuff[]`, applying conditions as a **static include/exclude gate** (a buff is in or out for the run based on its condition resolving true under static state). Dynamic per-round buff application is explicitly out of scope.

**Tech Stack:** TypeScript, Vitest. No new deps.

**Spec:** `docs/superpowers/specs/2026-06-01-skill-ability-editor-design.md`. **Design decisions (this phase):**
- buff/debuff ability = game buff (via picker, Phase 3b) + target + stacks + ONE condition (derivable, or manual "assume active" toggle for reactive/unquantifiable triggers).
- Conditions applied as a static gate at conversion: only **enemy-type mismatch** or a **manual toggle set to 0/off** exclude a buff; derivable-dynamic conditions (on-crit, per-count, # debuffs) default to "satisfiable" → included. Rationale: under the DPS assumptions, ~36/56 conditional buffs (when-attacked, hp-threshold, on-destroy) never derive true and are modeled as user toggles; the rest are "assume active."
- Dynamic per-round buff gating (condition-aware buff timeline) = DEFERRED.

**Baseline branch:** continue on `feat/skill-ability-editor` (Phases 1+2 shipped). Confirm: `src/utils/abilities/` has `evaluateConditions.ts`, `buildShipAbilities.ts`, `flatInputToAbilities.ts`, `applyAbilities.ts`, `roundContext.ts`.

**Conventions:** tests in `__tests__/`; `npx vitest run <path>`; `npm run lint` (max-warnings 0); pre-commit hook runs lint + full suite. `git add -f` for the gitignored plan if amending.

**Key existing types/helpers to reuse (read first):**
- `SelectedGameBuff` (`src/types/calculator.ts`): `{ id, buffName, stacks, parsedEffects: ParsedBuffEffects, isStackable, maxStacks?, autoFilled?, skillSource?, skillDuration?, sourceChargeCount?, sourceStartCharged?, stackTrigger? }`.
- `buildSkillBuffAutoFill(ship)` (`src/utils/calculators/skillBuffAutoFill.ts`) → `{ selfBuffs: SelectedGameBuff[], enemyDebuffs: SelectedGameBuff[] }` (DoTs already filtered out; buffs resolved against the BUFFS DB; carries `skillSource`).
- `conditionsMet`, `ConditionContext` (`src/utils/abilities/evaluateConditions.ts`).

---

## File Structure (Phase 3a)

| File | Change | Responsibility |
|---|---|---|
| `src/types/abilities.ts` | modify | Revise `buff`/`debuff` `AbilityConfig` to wrap a game-buff payload. |
| `src/utils/abilities/buffAbilityConverters.ts` | create | `abilityToSelectedBuff`, `selectedBuffToAbility`, `buffAbilitiesToSelectedBuffs(shipSkills, staticCtx)`, `selectedBuffsToBuffAbilities(selfBuffs, enemyDebuffs)`, `buildStaticBuffContext({enemyType})`. |
| `src/utils/abilities/buildShipAbilities.ts` | modify | Emit `buff`/`debuff` abilities (reuse `buildSkillBuffAutoFill`), grouped to slots by `skillSource`. |
| `src/utils/abilities/__tests__/*` | create/extend | Converter tests + buildShipAbilities buff/debuff tests. |

---

## Task 1: Revise buff/debuff AbilityConfig to wrap a game buff

**Files:** modify `src/types/abilities.ts`; check `src/utils/abilities/abilityFixtures.ts` (no buff/debuff fixtures exist there, so likely no change) and grep for any consumer of the old `buff`/`debuff` config shape (there should be NONE — nothing emits/reads buff/debuff abilities yet; `modifierTotalsFromAbilities` only reads `modifier`).

- [ ] **Step 1: Grep for existing usage.** `grep -rn "type: 'buff'\|type: 'debuff'\|=== 'buff'\|=== 'debuff'" src` — confirm no production code constructs or destructures the current buff/debuff `AbilityConfig` (the union members exist but are unused). If anything does, note it.

- [ ] **Step 2: Write a failing shape-lock test** in `src/types/__tests__/abilities.test.ts` (extend it): construct a buff ability and a debuff ability with the NEW shape and assert their config fields.

```ts
it('buff ability wraps a game-buff payload', () => {
    const buffAbility: Ability = {
        id: 'b', type: 'buff', target: 'self', trigger: 'on-cast', conditions: [],
        config: { type: 'buff', buffName: 'Attack Up II', parsedEffects: { attack: 30 }, stacks: 1, isStackable: false },
    };
    expect(buffAbility.config).toMatchObject({ type: 'buff', buffName: 'Attack Up II', stacks: 1 });
});

it('debuff ability carries application + game-buff payload', () => {
    const debuffAbility: Ability = {
        id: 'd', type: 'debuff', target: 'enemy', trigger: 'on-cast', conditions: [],
        config: { type: 'debuff', buffName: 'Defense Down II', parsedEffects: { defense: -30 }, stacks: 1, isStackable: false, application: 'inflict' },
    };
    expect(debuffAbility.config).toMatchObject({ type: 'debuff', application: 'inflict', buffName: 'Defense Down II' });
});
```

- [ ] **Step 3: Run → fail** (TS compile error on the new fields).

- [ ] **Step 4: Revise the union** in `src/types/abilities.ts`. Replace the current `buff`/`debuff` members with:

```ts
    | {
          type: 'buff';
          buffName: string;
          parsedEffects: ParsedBuffEffects;
          stacks: number;
          isStackable: boolean;
          maxStacks?: number;
          stackTrigger?: StackTrigger;
          duration?: number | 'recurring';
      }
    | {
          type: 'debuff';
          buffName: string;
          parsedEffects: ParsedBuffEffects;
          stacks: number;
          isStackable: boolean;
          maxStacks?: number;
          stackTrigger?: StackTrigger;
          application: 'inflict' | 'apply';
          duration?: number | 'recurring';
      }
```
Add `import { ParsedBuffEffects } from './calculator';` (StackTrigger already imported). Remove the now-unused `BuffStat` type ONLY if nothing else references it (grep first — `modifier`/others may use it; if so, keep it).

- [ ] **Step 5: Run → pass.** `npx vitest run src/types/__tests__/abilities.test.ts`. Then `npx tsc --noEmit` to confirm no other file broke.
- [ ] **Step 6: Lint + commit.** `git commit -m "feat: buff/debuff abilities wrap a game-buff payload"`

---

## Task 2: Buff-ability ↔ SelectedGameBuff converters

**Files:** create `src/utils/abilities/buffAbilityConverters.ts` + `src/utils/abilities/__tests__/buffAbilityConverters.test.ts`.

- [ ] **Step 1: Write failing tests.** Cover:
  - `abilityToSelectedBuff(ability)` (ONE arg — id derived internally) → a `SelectedGameBuff` with buffName/parsedEffects/stacks/isStackable/maxStacks/stackTrigger copied, `autoFilled` from the ability.
  - `selectedBuffToAbility(buff, 'self')` → a `buff` ability (target self); `selectedBuffToAbility(debuff, 'enemy')` → a `debuff` ability (target enemy, application 'apply' default).
  - `buildStaticBuffContext({ enemyType: 'Defender' })` → a ConditionContext with enemyType set and the "satisfiable" defaults (effectiveCritRate 100, enemyDebuffCount 1, selfBuffNames [] — note: enemy-type gating works, but enemy-buff-by-name with the static ctx would be 0; that's acceptable, document it).
  - `buffAbilitiesToSelectedBuffs(shipSkills, staticCtx)`:
    - includes a buff ability with NO conditions (→ selfBuffs).
    - excludes a buff ability whose only condition is `enemy-type` requiring 'Defender' when ctx.enemyType is 'Attacker'; includes it when 'Defender'.
    - excludes a buff ability whose only condition is non-derivable with `manualCount: 0` (toggle off); includes with `manualCount: 1`.
    - routes `target: 'enemy'` debuff abilities → `enemyDebuffs`; `self`/`ally`/`all-allies` → `selfBuffs`.
  - `selectedBuffsToBuffAbilities(selfBuffs, enemyDebuffs)` → buff abilities (self) + debuff abilities (enemy), round-trips buffName/stacks.

- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Implement.** Sketch:

```ts
import { Ability, ShipSkills, AbilityTarget } from '../../types/abilities';
import { SelectedGameBuff } from '../../types/calculator';
import { EnemyBaseClass } from '../../types/calculator';
import { conditionsMet, ConditionContext } from './evaluateConditions';

let seq = 0;
const buffId = (name: string) => `buffability-${name}-${seq++}`;

export function abilityToSelectedBuff(ability: Ability): SelectedGameBuff | null {
    const c = ability.config;
    if (c.type !== 'buff' && c.type !== 'debuff') return null;
    return {
        id: buffId(c.buffName),
        buffName: c.buffName,
        stacks: c.stacks,
        parsedEffects: c.parsedEffects,
        isStackable: c.isStackable,
        maxStacks: c.maxStacks,
        stackTrigger: c.stackTrigger,
        autoFilled: ability.autoFilled,
    };
}

export function selectedBuffToAbility(buff: SelectedGameBuff, target: AbilityTarget): Ability {
    const isEnemy = target === 'enemy' || target === 'all-enemies';
    return {
        id: `ab-${buff.id}`,
        type: isEnemy ? 'debuff' : 'buff',
        target,
        trigger: 'on-cast',
        conditions: [],
        autoFilled: buff.autoFilled,
        config: isEnemy
            ? { type: 'debuff', buffName: buff.buffName, parsedEffects: buff.parsedEffects, stacks: buff.stacks, isStackable: buff.isStackable, maxStacks: buff.maxStacks, stackTrigger: buff.stackTrigger, application: 'apply' }
            : { type: 'buff', buffName: buff.buffName, parsedEffects: buff.parsedEffects, stacks: buff.stacks, isStackable: buff.isStackable, maxStacks: buff.maxStacks, stackTrigger: buff.stackTrigger },
    };
}

// Static context for the include/exclude gate. Derivable-dynamic counts default to
// "satisfiable" so only enemy-type mismatch or a manual toggle (count 0) excludes.
export function buildStaticBuffContext(opts: { enemyType?: EnemyBaseClass }): ConditionContext {
    return {
        selfBuffNames: [], selfDebuffNames: [], enemyBuffNames: [],
        enemyDebuffCount: 1, enemyType: opts.enemyType,
        effectiveCritRate: 100, adjacentAllyCount: 1, enemyAdjacentCount: 1,
        enemyDestroyedCount: 1, selfHpPct: 100, enemyHpPct: 100,
    };
}

export function buffAbilitiesToSelectedBuffs(
    shipSkills: ShipSkills,
    staticCtx: ConditionContext
): { selfBuffs: SelectedGameBuff[]; enemyDebuffs: SelectedGameBuff[] } {
    const selfBuffs: SelectedGameBuff[] = [];
    const enemyDebuffs: SelectedGameBuff[] = [];
    for (const slot of shipSkills.slots) {
        for (const ability of slot.abilities) {
            if (ability.config.type !== 'buff' && ability.config.type !== 'debuff') continue;
            if (!conditionsMet(ability.conditions, staticCtx)) continue;
            const sb = abilityToSelectedBuff(ability);
            if (!sb) continue;
            if (ability.target === 'enemy' || ability.target === 'all-enemies') enemyDebuffs.push(sb);
            else selfBuffs.push(sb);
        }
    }
    return { selfBuffs, enemyDebuffs };
}

export function selectedBuffsToBuffAbilities(
    selfBuffs: SelectedGameBuff[],
    enemyDebuffs: SelectedGameBuff[]
): Ability[] {
    return [
        ...selfBuffs.map((b) => selectedBuffToAbility(b, 'self')),
        ...enemyDebuffs.map((b) => selectedBuffToAbility(b, 'enemy')),
    ];
}
```
Note: `buildStaticBuffContext`'s "satisfiable" defaults mean an `enemy-buff`-by-name condition (e.g. enemy Stealth) evaluates to 0 (not in `enemyBuffNames`) and would exclude — for those, the editor should mark the condition non-derivable (manual toggle), which the gate honors. Document this in a comment.

Note: `abilityToSelectedBuff` intentionally does NOT carry the sim-scheduling fields `skillSource`/`skillDuration`/`sourceChargeCount`/`sourceStartCharged` — they aren't on the buff/debuff `AbilityConfig`. That's fine for Phase 3a: the sim is unchanged, Task 3 derives slot placement from the auto-fill's `skillSource` *before* conversion, and Phase 3b's page rebuilds any scheduling from auto-fill rather than from the ability round-trip. Add a one-line comment in the converter saying so.

- [ ] **Step 4: Run → pass.**
- [ ] **Step 5: Lint + commit.** `git commit -m "feat: buff/debuff ability ↔ SelectedGameBuff converters with static gate"`

---

## Task 3: Emit buff/debuff abilities from the parser

**Files:** modify `src/utils/abilities/buildShipAbilities.ts`; extend `src/utils/abilities/__tests__/buildShipAbilities.test.ts`.

This completes the deferred Phase-1 work: `buildShipAbilities` now also emits buff/debuff abilities, reusing `buildSkillBuffAutoFill`.

- [ ] **Step 1: Write failing tests.** A ship whose active skill grants a self buff (e.g. Wusheng-style "gains Crit Power Up II" — pick a real ship with a BUFFS-DB-known buff) → its `active` slot contains a `buff` ability (target 'self', buffName matching). A ship inflicting an enemy debuff (e.g. "inflicts Defense Down II") → a `debuff` ability (target 'enemy'). Verify against real `buildSkillBuffAutoFill` output first (its buffs only include BUFFS-DB entries; DoTs are excluded). Assert the buff/debuff abilities coexist with the damage abilities on the right slot.

- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Implement.** In `buildShipAbilities`, after building the per-skill scalar/dot/modifier abilities, call `buildSkillBuffAutoFill(ship)` → `{ selfBuffs, enemyDebuffs }`. Convert each to a buff/debuff ability via `selectedBuffToAbility` (self→'self', enemy→'enemy'). Assign to a slot using the SelectedGameBuff's `skillSource` (`active`→active, `charge`→charged, `passive1/2/3`→passive); default to `active` if absent. Merge into the existing slot `Map`. Keep `autoFilled: true`.
  - Note: `buildSkillBuffAutoFill` aggregates across all skills and de-dupes by name; that's fine — use `skillSource` to place each. If two skills grant the same buff, the de-dupe keeps one; acceptable for auto-fill.

- [ ] **Step 4: Run → pass.** Then the full `buildShipAbilities` + coverage tests still green.
- [ ] **Step 5: Lint + commit.** `git commit -m "feat: parser emits buff/debuff abilities from skill text"`

---

## Task 4: Equivalence guard — abilities buffs == legacy buff path

**Files:** extend `src/utils/abilities/__tests__/buffAbilityConverters.test.ts` (or a new integration test).

Prove the round-trip preserves sim behavior: converting auto-filled `SelectedGameBuff[]` → abilities → back to `SelectedGameBuff[]` (with a permissive static ctx) yields the same buffs the sim would have received.

- [ ] **Step 1: Write the test.** For a ship: `const { selfBuffs, enemyDebuffs } = buildSkillBuffAutoFill(ship)`. `const abilities = selectedBuffsToBuffAbilities(selfBuffs, enemyDebuffs)`. Wrap in a `ShipSkills` (one slot). `const round = buffAbilitiesToSelectedBuffs(shipSkills, buildStaticBuffContext({}))`. Assert `round.selfBuffs` and `round.enemyDebuffs` have the same `buffName`+`stacks`+`parsedEffects` set as the originals (ignore the regenerated `id`). This proves no buff data is lost across the ability representation.
- [ ] **Step 2: Run → pass.**
- [ ] **Step 3: Commit.** `git commit -m "test: buff ability round-trip preserves the legacy buff set"`

---

## Done criteria (Phase 3a)

- `npm test` green; `npm run lint` clean.
- buff/debuff `AbilityConfig` wraps a game-buff payload; converters bridge abilities ↔ `SelectedGameBuff[]` with a documented static gate; `buildShipAbilities` emits buff/debuff abilities.
- No UI / page / sim changes — the simulator still consumes `SelectedGameBuff[]` unchanged.

**Next:** Phase 3b plan — the modal-per-skill editor (reusing `GameBuffPicker` for buff/debuff abilities + `ConditionRow`), page hard-cutover (config holds `shipSkills`; the page converts buff/debuff abilities to `selfBuffs`/`enemyDebuffs` via `buffAbilitiesToSelectedBuffs(buildStaticBuffContext({enemyType}))` and passes damage abilities as `shipSkills`), removal of the legacy flat damage fields + collapsible sections, docs, and frontend verification.
