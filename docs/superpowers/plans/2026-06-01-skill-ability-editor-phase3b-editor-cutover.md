# Skill & Ability Editor — Phase 3b: Editor UI + Page Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Ship the user-visible feature — a modal-per-skill editor that owns each ship's abilities — and hard-cut the DPS calculator over to it: config holds `shipSkills`, the page passes damage-shaped abilities to the sim and converts buff/debuff abilities to `selfBuffs`/`enemyDebuffs`, and the old per-ship collapsible config sections + flat damage fields are removed.

**Architecture:** `DPSShipConfig` gains `shipSkills: ShipSkills` (built via `buildShipAbilities` on ship-select; a minimal default for the blank ship). The editor (layout A: one modal per skill) edits `shipSkills` and calls back with the updated value. The page derives sim inputs from `shipSkills`: the full `shipSkills` goes to `simulateDPS` (the Phase-2 sim consumes damage/additional/conditional/charge/dot/modifier and **ignores** buff/debuff abilities), and buff/debuff abilities are **converted** to `SelectedGameBuff[]` (scheduling reconstructed) and merged into `selfBuffs`/`enemyDebuffs`. Global attacker/enemy buff pickers, team ships, stats inputs, `chargeCount`/`startCharged`, and combat settings are unchanged. Reuses `GameBuffPicker` inside buff/debuff ability cards.

**Tech Stack:** React 18 + TypeScript + Vitest + RTL + TailwindCSS. UI per `CLAUDE.md` conventions (existing `Modal`, `Button`, `Select`, `Input`, `Checkbox`, `card` class, `CollapsibleForm`; never raw HTML buttons/inputs).

**Spec:** `docs/superpowers/specs/2026-06-01-skill-ability-editor-design.md` (editor = layout A, modal-per-skill; AbilityTypePicker → AbilityCard with target + conditions block).

**Baseline:** continue on `feat/skill-ability-editor` (Phases 1, 2, 3a shipped). Phase 3a gives: `buildShipAbilities` (full ability emission incl. buff/debuff), `buffAbilityConverters.ts`, `applyAbilities.ts`, `flatInputToAbilities.ts`. Phase 2 gives: `simulateDPS({..., shipSkills})`.

**Conventions:** tests in `__tests__/`; `npx vitest run <path>`; `npm run lint` (max-warnings 0); pre-commit hook = lint + full suite. Component tests use RTL (see existing `src/components/**/__tests__`). `git add -f` the gitignored plan if amending. Update `DocumentationPage.tsx` + `UNRELEASED_CHANGES` (`src/constants/changelog.ts`) for the user-facing change.

**Constraints carried from prior reviews (must honor):**
1. **Buff conversion is NOT called in render** — memoize `buffAbilitiesToSelectedBuffs` on a stable dep (the config's `shipSkills` + `enemyType`), or compute in the config-update path.
2. **Scheduling must be reconstructed** when converting buff/debuff abilities → `SelectedGameBuff` (Task 1), so `computeBuffTimeline` schedules them correctly instead of treating them as permanent (`isAlwaysActive` treats a buff with no `skillSource` as permanent → would over-count DPS).
3. `chargeCount`/`startCharged` stay flat config fields wired explicitly alongside `shipSkills`.
4. `modifier.isMultiplicative` is a sim no-op — the editor may show it but label it as not-yet-affecting numbers, or omit the toggle.
5. `hasChargedSkill` already gates on charged damage `multiplier > 0` (sim handles it).

---

## File Structure (Phase 3b)

| File | Change | Responsibility |
|---|---|---|
| `src/utils/abilities/buffAbilityConverters.ts` | modify | Reconstruct `skillSource` (from slot) + `skillDuration` (from `config.duration`) on conversion. |
| `src/utils/abilities/configToSimInputs.ts` | create | `configShipSkillsToSimInputs(shipSkills, enemyType) → { selfBuffs, enemyDebuffs }`; `buildDefaultShipSkills()`. |
| `src/types/calculator.ts` | modify | `DPSShipConfig` gains `shipSkills: ShipSkills`; remove the flat damage fields it no longer needs (staged — see Task 5). |
| `src/components/skills/ConditionRow.tsx` | create | Edit one `Condition` (subject + derivable/manual + enemy-type/buffName/hp fields + anyOf). |
| `src/components/skills/AbilityCard.tsx` | create | Edit one `Ability` (type-specific config + target + conditions block); buff/debuff reuse `GameBuffPicker`. |
| `src/components/skills/AbilityTypePicker.tsx` | create | Grid of ability types to add. |
| `src/components/skills/SkillEditorModal.tsx` | create | Modal for one skill: ability list + "Add ability". |
| `src/components/skills/SkillSlotList.tsx` | create | The 3 skill rows (Active/Charged/Passive) each with an Edit button. |
| `src/components/calculator/ShipConfigCard.tsx` | modify | Replace the collapsible damage/secondary/conditional/charge/DoT/buff sections with `SkillSlotList`; keep stats inputs + chargeCount/startCharged. |
| `src/pages/calculators/DPSCalculatorPage.tsx` | modify | Build/hold `shipSkills`; memoized buff conversion; pass `shipSkills` to `simulateDPS`; update handlers; remove flat-field plumbing. |
| `src/pages/DocumentationPage.tsx`, `src/constants/changelog.ts` | modify | Docs + changelog. |

---

## Task 1: Scheduling-preserving buff conversion

**Files:** modify `src/utils/abilities/buffAbilityConverters.ts`; extend its test.

The 3a converter dropped `skillSource`/`skillDuration`. Reconstruct them from the ability's **slot** and the config's **`duration`** so converted buffs schedule correctly in `computeBuffTimeline`.

- [ ] **Step 1: Read** `src/utils/calculators/buffTimeline.ts` to confirm how `skillSource`/`skillDuration`/`sourceChargeCount`/`sourceStartCharged` drive scheduling (esp. `isAlwaysActive`). Confirm the slot→source mapping needed: `active→'active'`, `charged→'charge'`, `passive→'passive1'`.
- [ ] **Step 2: Write failing tests.** `abilityToSelectedBuff(ability, slot)` (NEW second arg) sets `skillSource` from slot and `skillDuration` from `ability.config.duration` (undefined → stays undefined/recurring per buffTimeline default). `buffAbilitiesToSelectedBuffs` passes each ability's slot. Round-trip: a buff ability on the `charged` slot with `duration: 2` → `SelectedGameBuff` with `skillSource: 'charge'`, `skillDuration: 2`. `selectedBuffToAbility(buff, target)` carries `buff.skillDuration → config.duration` (so migration preserves it).
- [ ] **Step 3: Run → fail.**
- [ ] **Step 4: Implement.** Add the slot param to `abilityToSelectedBuff(ability, slot: SkillSlot)`; map slot→`skillSource`; set `skillDuration: ability.config.duration`. Update `buffAbilitiesToSelectedBuffs` to pass `slot.slot`. Update `selectedBuffToAbility` to set `config.duration: buff.skillDuration` (when numeric). Keep the deterministic id. Update the header comment (scheduling is now reconstructed, not dropped).
- [ ] **Step 5: Run → pass;** full suite green. NOTE: the existing 3a round-trip test asserts only by name/stacks/parsedEffects, so adding `skillSource`/`skillDuration` won't break it — do NOT weaken any existing assertion. ADD a positive assertion: a buff ability on the `charged` slot with `config.duration: 2` round-trips to a `SelectedGameBuff` with `skillSource: 'charge'` and `skillDuration: 2`.
- [ ] **Step 6: Lint + commit.** `git commit -m "feat: reconstruct buff scheduling (skillSource/skillDuration) on ability conversion"`

---

## Task 2: Config → sim-input derivation + default ShipSkills

**Files:** create `src/utils/abilities/configToSimInputs.ts` + test.

- [ ] **Step 1: Write failing tests** for:
  - `buildDefaultShipSkills()` → a `ShipSkills` with an active slot containing a single `damage` ability (multiplier 100), no charged slot — the blank-ship default (mirrors today's `activeMultiplier: 100, chargedMultiplier: 0`).
  - `configShipSkillsToSimInputs(shipSkills, enemyType)` → `{ selfBuffs, enemyDebuffs }` via `buffAbilitiesToSelectedBuffs(shipSkills, buildStaticBuffContext({ enemyType }))`. (Thin wrapper, but it's the single seam the page calls + memoizes.) Add a one-line comment: `sourceChargeCount`/`sourceStartCharged` are NOT reconstructed (not on the buff config), but that's correct for the single-attacker DPS config — `computeBuffTimeline`'s `getSourceChargedSet` falls back to the attacker's own charged set, and here the attacker IS the applier; team-applied debuffs keep flowing through the unchanged global `teamEnemyDebuffs` path which still carries those fields.
- [ ] **Step 2-4: TDD** → implement → pass.
- [ ] **Step 5: Lint + commit.** `git commit -m "feat: config ShipSkills → sim inputs derivation + default skills"`

---

## Task 3: ConditionRow + AbilityCard components

**Files:** create `src/components/skills/ConditionRow.tsx`, `src/components/skills/AbilityCard.tsx` + tests.

Build bottom-up. Use existing UI primitives (`Select`, `Input`, `Checkbox`, `Button`, `card`); reuse `GameBuffPicker` for buff/debuff selection; reuse `CONDITIONAL_CONDITION_LABELS` / `EnemyBaseClass` from `src/types/calculator.ts` and the ability enums from `src/types/abilities.ts`.

- [ ] **ConditionRow** — props `{ condition: Condition; onChange(c): void; onRemove(): void }`. Controls: a `Select` for `subject` (label via a subject→label map; include the new subjects); a derivable/manual toggle → when manual, an `Input` for `manualCount` (the "assume active / trigger count" field); when `subject === 'enemy-type'`, a `Select` for `requiredEnemyType`; when buff-name-based subject, an `Input`/text for `buffName`; an `anyOf` `Checkbox` ("OR with previous"). Keep it presentational. Test: changing the subject Select calls `onChange` with the new subject; toggling manual reveals the count input.

- [ ] **AbilityCard** — props `{ ability: Ability; onChange(a): void; onRemove(): void }`. Renders type-specific config + target `Select` + a conditions block (list of `ConditionRow` + "Add condition"). Type-specific bodies:
  - `damage`: multiplier `Input` + optional `hits` `Input`; conditions block doubles as the **scaling** editor when `scaling` is present (perUnit + cap inputs) — keep it simple: show a "scales per condition" toggle that sets `scaling`.
  - `additional-damage`: `stat` Select (hp/defense) + `pct` Input.
  - `modifier`: `channel` Select + `value` Input (+ a disabled/explained `isMultiplicative` note per constraint 4).
  - `charge`: `amount` Input (+ target self/ally).
  - `dot`: dotType Select + tier + stacks + duration Inputs.
  - `buff`/`debuff`: a **`GameBuffPicker`** + stacks Input + (debuff) application Select + duration Input. NOTE: `GameBuffPicker` is multi-select with no max — the AbilityCard must enforce single-buff semantics itself: pass `value={picked ? [picked] : []}` and in `onChange` take the LAST/new entry (`buffs[buffs.length-1]`) to populate buffName/parsedEffects/isStackable/maxStacks on the ability config.
  Tests: editing the multiplier calls onChange with updated config; adding a condition appends a ConditionRow; the buff card surfaces a GameBuffPicker. Keep tests behavioral and light — the sim math is covered elsewhere.

- [ ] Commit after ConditionRow (with its test), then after AbilityCard (with its test). `git commit -m "feat: ConditionRow editor component"` then `git commit -m "feat: AbilityCard editor component"`.

---

## Task 4: AbilityTypePicker + SkillEditorModal + SkillSlotList

**Files:** create the three components + tests.

- [ ] **AbilityTypePicker** — props `{ onPick(type: AbilityType): void }`. Grid of ability-type buttons grouped (Damage / Modify / Charge / Utility) per the spec mockup. Picking a type yields a sensible default `Ability` of that type (a factory `makeDefaultAbility(type): Ability`). Test: clicking "Damage" calls `onPick('damage')`.
- [ ] **SkillEditorModal** — props `{ open; slot: SkillSlot; skill: Skill | undefined; onChange(skill): void; onClose() }`. Uses the existing `Modal`. Lists the skill's `AbilityCard`s (add/remove/reorder optional) + an "Add ability" button that opens `AbilityTypePicker` and appends `makeDefaultAbility(type)`. Editing an ability updates the skill via `onChange`. Test: adding an ability via the picker appends a card; editing a card propagates onChange.
- [ ] **SkillSlotList** — props `{ shipSkills: ShipSkills; onChange(shipSkills): void; hasPassive: boolean }`. Renders rows for Active, Charged, Passive (Passive only when the ship has one) with ability counts + an Edit button each → opens `SkillEditorModal` for that slot; modal changes merge back into `shipSkills`. Test: clicking Edit opens the modal for that slot; modal onChange updates the slot in shipSkills.
- [ ] Commit each component with its test.

---

## Task 5: Page hard-cutover wiring

**Files:** modify `src/types/calculator.ts`, `src/components/calculator/ShipConfigCard.tsx`, `src/pages/calculators/DPSCalculatorPage.tsx`. This is the integration task — do it as one coherent change with a single commit (the pre-commit hook needs a compiling, green tree).

- [ ] **Step 1: Read** the current `DPSShipConfig` (`src/types/calculator.ts`), `ShipConfigCard.tsx` (the collapsible sections + props), and `DPSCalculatorPage.tsx` (`getInitialConfig`, `selectShipForConfig`, the per-config update handlers, the `simResults` memo) to map every flat-damage-field touch point.
- [ ] **Step 2: Model.** Add `shipSkills: ShipSkills` to `DPSShipConfig`. Remove the now-owned-by-editor flat fields: `activeMultiplier`, `chargedMultiplier`, `activeSecondary`, `chargedSecondary`, `activeConditional`, `chargedConditional`, `selfChargeGain`, `activeDoTs`, `chargedDoTs`, `buffs`, `enemyDebuffs`, AND `autoFilledFields` (its sole purpose was tracking those flat fields — it's dead after removal). Also prune `activeMultiplier`/`chargedMultiplier` from the `DPSShipConfigUpdateableField` union (`calculator.ts`). **Keep:** `attack`/`crit`/`critDamage`/`defensePenetration`/`hacking`/`affinity`/`defence`/`hp` (stats), `chargeCount`, `startCharged`, `allyChargePerRound`, `name`/`shipId`/`id`. (Removing fields surfaces every consumer via tsc — fix each.) **Named consumers to fix (don't miss these — some are beyond ShipConfigCard/the page):**
  - `src/components/calculator/ShipConfigSummary.tsx` reads `config.chargedMultiplier > 0` to gate the "Charged skill fires" row — replace with a shipSkills-derived gate, e.g. `damageInputsFromSkill(selectFiringSkill(config.shipSkills, 'charged')).multiplier > 0 && config.chargeCount > 0`.
  - `DPSCalculatorPage.tsx`: the `updateConfig` auto-fill-clearing branch + any `autoFilledFields` plumbing in `getInitialConfig`/`selectShipForConfig`/`updateConfig*` handlers — delete the auto-filled-set teardown along with the `buildSkillAutoFill` helper.
- [ ] **Step 3: Build shipSkills in the config builders.** `getInitialConfig`: ship-select branch → `shipSkills: buildShipAbilities(ship)` (+ keep stats/chargeCount/startCharged from the ship); blank branch → `shipSkills: buildDefaultShipSkills()`. `selectShipForConfig` (when a ship is picked into an existing config) → set `shipSkills: buildShipAbilities(ship)`. Remove the old `buildSkillAutoFill`/`buildDoTAutoFill` per-field wiring (the auto-fill now lives inside `buildShipAbilities`).
- [ ] **Step 4: Editor wiring in ShipConfigCard.** Replace the collapsible Secondary/Conditional/Charge/DoT/Buff sections with `<SkillSlotList shipSkills={config.shipSkills} hasPassive={...} onChange={(s) => onShipSkillsChange(s)} />`. Keep the stats inputs, chargeCount, startCharged, ally charges. Add an `onShipSkillsChange` prop wired to a `updateConfigShipSkills(id, shipSkills)` handler in the page. Remove the now-dead props/handlers (onSecondaryChange, onConditionalChange, onChargeGainChange, DoT handlers, onBuffsChange/onEnemyDebuffsChange for the per-ship picker — but note the GLOBAL buff pickers live elsewhere and stay).
- [ ] **Step 5: simResults memo.** Add a dedicated `useMemo` keyed on `[configs, enemyType]` that returns a **`Map<configId, { selfBuffs, enemyDebuffs }>`** — `converted = configShipSkillsToSimInputs(config.shipSkills, enemyType)` per config (constraint 1 — compute in THIS memo, not inline inside the `simResults` map callback). Then in `simResults`: `selfBuffs = [...attackerBuffs, ...teamAttackerBuffs, ...converted.get(config.id).selfBuffs]`, `enemyDebuffs = [...enemyBuffs, ...teamEnemyDebuffs, ...converted.get(config.id).enemyDebuffs]`. Pass `shipSkills: config.shipSkills` to `simulateDPS` and DROP the flat damage params (activeMultiplier, etc.). Keep chargeCount/startCharged/allyChargePerRound/stats/affinity/enemyType params.
- [ ] **Step 6: Run** `npm test` → all green (the existing dpsSimulator tests are unaffected — they call `simulateDPS` directly with flat input, which still works via the adapter). Fix any page/component test that referenced removed fields. `npm run lint`.
- [ ] **Step 7: Commit.** `git commit -m "feat: DPS calculator uses the skill/ability editor (hard cutover)"`

---

## Task 6: Docs, changelog, frontend verification

- [ ] **Step 1: Docs.** Update `src/pages/DocumentationPage.tsx` DPS section to describe the skill editor (per-skill abilities, conditions, buff/debuff via picker). Add an `UNRELEASED_CHANGES` entry in `src/constants/changelog.ts` (plain-English: "DPS Calculator skills are now edited through a per-skill ability editor — add damage, additional damage, modifiers, charge, DoTs, and conditional buffs/debuffs per skill, replacing the old fixed config sections").
- [ ] **Step 2: Commit docs.** `git commit -m "docs: document the DPS skill/ability editor"`
- [ ] **Step 3: Frontend verify** (REQUIRED — use the verify skill). `npm start`, open the DPS calculator, and confirm end to end:
  - Selecting a ship populates the skill slots (Active/Charged/Passive) from `buildShipAbilities`.
  - Opening a skill modal shows its abilities; editing a multiplier / adding an ability / adding a conditional buff via the picker updates the DPS chart.
  - A real ship (e.g. Selenite/Lodolite/Panguan) produces sensible numbers; charged cadence + additional damage behave.
  - The old collapsible damage sections are gone; stats inputs + global buff pickers + team + combat settings still work.
  - Capture a screenshot of the editor + chart.

---

## Done criteria (Phase 3b)

- `npm test` green; `npm run lint` clean; frontend verified with a screenshot.
- The DPS calculator is driven by the editor: config holds `shipSkills`; damage-shaped abilities flow to the sim; buff/debuff abilities convert (with reconstructed scheduling) to `selfBuffs`/`enemyDebuffs`, memoized.
- Flat damage fields + old collapsible sections removed; stats/chargeCount/startCharged/global pickers/team/combat-settings retained.
- Docs + changelog updated.

**This completes the DPS-first build of the skill & ability editor.** Follow-on specs (own brainstorm/plan cycles): Healing calc + Defense calc adopt the model; dynamic per-round conditional buffs (condition-aware buff timeline); future combat sim.
