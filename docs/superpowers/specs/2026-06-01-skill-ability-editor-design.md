# Skill & Ability Editor — Design Spec

**Date:** 2026-06-01
**Status:** Approved (brainstorming) → ready for implementation plan
**Scope of this build:** the shared ability *model* (designed holistically) + its first consumer, the **DPS calculator**, end-to-end. Healing calc, Defense calc, and a future simplified combat sim are explicit follow-on specs that adopt the same model.

---

## 1. Problem & Goal

The DPS calculator configures a ship's skill effects through a flat, growing set of fields on `DPSShipConfig` — parallel `active*`/`charged*` variants for multipliers, secondary damage, conditional scaling, DoTs, plus separate buff/debuff/charge fields. Each new mechanic (secondary damage, conditional scaling, charge manipulation) added another bespoke field, updater, parser, and collapsible UI section. The card is getting convoluted and the model can't express individual, chained skill behavior.

**Goal:** replace the flat config with a **dynamic, interactive skill editor** built on a shared ability model that mirrors how the game itself composes skills (see `docs/combat-system.md`: a skill is an ordered list of *abilities*, each with targeting, validity, hit/crit, and stat/effect application). This makes the UI less convoluted, supports arbitrary individual skills, powers the existing team-support feature, is reusable across calculators, and is designed to eventually drive a simplified combat sim.

**Non-goals (this build):** rewiring the Healing or Defense calculators; building the combat sim; simulating reactive mechanics (counter/reflect/revive) or multi-ship targeting. The model must *represent* these; the DPS sim need not *execute* them.

---

## 2. Key Decisions (from brainstorming)

1. **Engine depth:** refactor the DPS simulator to *walk an ability list*, reusing the existing proven math kernels (DoT stacking, buff timeline, affinity/crit/hacking, secondary scaling). Not a from-scratch engine; not a compile-to-old-inputs shim.
2. **Ability scope:** all ability types are modeled (damage, additional-damage, modifier, buff, debuff, dot, charge, heal, shield, cleanse, purge, control). The DPS sim executes the damage-affecting subset; the rest are represented for the later calcs.
3. **Phasing:** design the model holistically now; build DPS first. Other calcs + combat sim are follow-on specs.
   - **Baseline branch:** the implementation plan must branch from `feat/dps-charge-manipulation` (or from `main` after that PR merges), **not** current `main`. The charge-gain model (`ChargeGain`, `selfChargeGain`, the active-only + cap fix, `RoundData.chargeCount`) and the `always`/`self-crit`/`enemy-type` conditions are the baseline this spec assumes — they live on that branch, not yet on `main`.
4. **`modifier` is its own type** (distinct from `buff`): a passive stat/output aura with no duration/stacks and not cleansable/purgeable (Lionheart HP +10%, Panguan/Lodolite outgoing-damage %).
5. **Conditions are one primitive that resolves to a count**, used as a **gate** (apply iff count > 0) or a **scaler** (per-count effect, with a cap). OR-grouping handled by a simple per-condition `anyOf` flag.
6. **Skills are Active, Charged, and one Passive** resolved by refit level via the existing `getShipSkillRows()` — not three passives.
7. **Editor layout: one modal per skill** (each skill row has its own Edit button → focused modal with the ability chain + "Add ability").
8. **Extra model dimensions added now:** a `trigger` field (default `on-cast`), an HP-threshold condition subject, and a hit/action count on `damage`. Counter/reflect/revive are representable via triggers but not simulated for DPS.
9. **Parser: hybrid assembler** — reuse existing regex detectors as primitives, add a `buildShipAbilities()` layer that emits `Ability[]` per skill, plus new detectors for modifier/trigger/HP-threshold/multi-hit. Auto-fill *seeds* the editor; the user completes anything the parser can't extract.

---

## 3. The Shared Ability Model

Lives in `src/types/abilities.ts` (new), calc-agnostic — pure data, no DPS assumptions.

```ts
type SkillSlot = 'active' | 'charged' | 'passive';

interface ShipSkills {
  slots: Skill[];            // at most 3: active, charged, passive (refit-resolved)
}

interface Skill {
  slot: SkillSlot;
  name?: string;
  abilities: Ability[];      // ordered, chainable
}

type AbilityType =
  | 'damage' | 'additional-damage' | 'modifier'
  | 'buff' | 'debuff' | 'dot' | 'charge'
  | 'heal' | 'shield' | 'cleanse' | 'purge' | 'control';

type AbilityTarget = 'self' | 'ally' | 'all-allies' | 'enemy' | 'all-enemies';

type AbilityTrigger =
  | 'on-cast'            // default: when the skill fires
  | 'start-of-round'
  | 'on-crit'            // after critically damaging
  | 'on-attacked'        // reactive (not simulated for DPS)
  | 'on-ally-destroyed'  // reactive (not simulated for DPS)
  | 'on-destroyed';      // reactive (not simulated for DPS)

interface Ability {
  id: string;
  type: AbilityType;
  target: AbilityTarget;
  trigger: AbilityTrigger;          // default 'on-cast'
  conditions: Condition[];          // gate by default; see `scaling`
  scaling?: ScalingRule;            // present on damage/additional-damage/charge that scale per-count
  config: AbilityConfig;            // discriminated by `type`
  autoFilled?: boolean;
}
```

### Conditions (the count primitive)

```ts
// Baseline is the charge branch (see §2 phasing), where ConditionalCondition
// already has always/self-crit/enemy-type. Subjects marked NEW are not in that
// union yet — the planner should add them.
type ConditionSubject =
  | 'always'
  | 'self-buff' | 'self-debuff'     // self-debuff NEW
  | 'enemy-buff' | 'enemy-debuff'
  | 'enemy-type'
  | 'self-crit'
  | 'adjacent-ally' | 'enemy-adjacent'
  | 'enemy-destroyed'
  | 'hp-threshold';                 // NEW

interface Condition {
  subject: ConditionSubject;
  derivable: boolean;               // count from sim state vs. manual
  manualCount?: number;             // when !derivable (default 1)
  anyOf?: boolean;                  // true → OR-grouped with adjacent anyOf conditions
  // subject-specific:
  requiredEnemyType?: EnemyBaseClass;
  buffName?: string;                // e.g. 'Stealth' for enemy-buff/self-buff
  hpComparator?: 'below' | 'above'; // for hp-threshold
  hpPercent?: number;               // for hp-threshold
}
```

A condition resolves to a **count** (≥ 0) against current sim state. An ability **applies** when its (AND of anyOf-groups of) conditions yields count > 0. A `scaling` ability multiplies by the count.

```ts
interface ScalingRule {
  conditionIndex: number;           // which condition supplies the count
  perUnit: number;                  // e.g. +5 (%) per unit
  cap?: number;                     // total-bonus ceiling
}
```

### Type-specific config (discriminated union on `Ability.type`)

```ts
| { type: 'damage'; multiplier: number; hits?: number }         // hits default 1 (multi-hit / extra action)
| { type: 'additional-damage'; stat: 'hp'|'defense'; pct: number }  // game also has shield-based, excluded per the shield game-bug convention; no ship uses attack-based
| { type: 'modifier'; channel: ModifierChannel; value: number; isMultiplicative: boolean }
| { type: 'buff'; stat: BuffStat; value: number; isMultiplicative: boolean;
    duration: number|'recurring'; stackable: boolean; maxStacks?: number; stackTrigger?: StackTrigger }
| { type: 'debuff'; stat: BuffStat; value: number; duration: number|'recurring';
    application: 'inflict'|'apply' }                            // inflict = hacking-gated
| { type: 'dot'; dotType: DoTType; tier: number; stacks: number; duration: number }
| { type: 'charge'; amount: number }                            // capped at chargeCount by sim
| { type: 'heal'|'shield'; pct: number; basis: 'hp'|'attack' }  // consumed by later calcs
| { type: 'cleanse'|'purge'; count: number }                    // consumed by later calcs
| { type: 'control'; effect: 'provoke'|'taunt'|'stasis'|'overload'|'concentrate-fire' }

type ModifierChannel = 'attack'|'defense'|'hp'|'crit'|'critDamage'
                     | 'outgoingDamage'|'outgoingHeal'|'incomingDamage';
```

**Distinctions that matter:** `additional-damage` adds a *new damage instance* (% of a stat). `modifier` *scales existing* output/stat (passive aura, no duration). `buff` is a named, timed, stackable, cleansable game effect.

---

## 4. Simulator: walking abilities (two-pass per round)

The DPS round loop (`runSinglePass` in `dpsSimulator.ts`) changes from reading flat fields to iterating abilities. Per round:

1. **Decide action** (active vs charged) — charge accumulator fed by `charge` abilities (replaces `selfChargeGain`/`allyChargePerRound`). Charge gains apply on **active rounds only** and cap at `chargeCount` (preserves the fix shipped on the charge branch).
2. **Select firing skill** — Active skill's abilities on active rounds, Charged skill's on charged rounds; Passive abilities always in the pool. Filter abilities whose `trigger` is satisfiable this round (`on-cast`, `start-of-round`, `on-crit`; reactive triggers are skipped under DPS assumptions).
3. **Pass A — build round context:** evaluate `modifier`/`buff`/`debuff` abilities' conditions against current sim state; fold applicable ones into effective stats via the existing **buff timeline / enemy-modifier / affinity-crit-hacking** kernels.
4. **Pass B — produce outputs** using that context: `damage` (× `hits`), `additional-damage` (secondary kernel), `dot` (DoT kernel), `charge` (accumulator). Sum round damage.

**The math kernels are unchanged.** Only the input source changes (walk abilities, not read fields). In particular, DPS keeps its existing **same-round DoT tick ordering** (apply new stacks, tick existing, expire — `runSinglePass` steps 3–6); we do not literally execute DoTs as separate high-priority abilities the way `combat-system.md` describes. The combat doc's ordering is the eventual combat-sim target, not a DPS-build requirement.

**Team support preserved:** a support ship is another `ShipSkills`. Its `ally`/`all-allies` buffs and modifiers feed the simulated attacker (Lionheart → attacker HP; Panguan → attacker outgoing damage); its `enemy` debuffs feed the dummy. This is the same merge `TeamShipConfig` does today, now expressed as abilities.

**Target interpretation in the 1v1 DPS sim:** `self`/`enemy` map to the attacker / dummy. `ally`/`all-allies` matter only for support ships feeding the attacker. Fine target selection (highest/lowest, stealth-ignoring) is a combat-sim concern and ignored here.

---

## 5. Parser → abilities (hybrid assembler)

New `buildShipAbilities(ship): ShipSkills` in `src/utils/calculators/` (or `src/utils/abilities/`):

1. Resolve real skills via `getShipSkillRows(ship)` (Active, Charged, one refit-active Passive).
2. Run existing detectors (`parseSkillDamage`, `parseSecondaryDamage`, `parseConditionalDamage`, `parseChargeGain`, `parseSkillEffects`) over each skill's text and emit `Ability[]`:
   - skill % → `damage`; "additional damage = X% of stat" → `additional-damage`; conditional scaling → a `damage`/`additional-damage` with a `scaling` rule; charge gain → `charge`; parsed buffs/debuffs → `buff`/`debuff`; DoTs → `dot`.
3. Add **new detectors** for: `modifier` ("X% more direct damage", "increases HP by X%"), `trigger` phrases ("at the start of the round", "after critically damaging"), `hp-threshold` conditions, multi-hit `hits`.
4. Mark emitted abilities `autoFilled` so the editor surfaces what was detected.

Auto-fill **seeds** the editor; free-text it can't crack is completed manually. Existing parser unit tests remain the regression backstop; flat-field parsers are retired once DPS runs fully on abilities.

---

## 6. Editor UI (layout A — modal per skill)

Reusable components under `src/components/skills/` so other calcs can adopt them:

- **`SkillSlotList`** — renders the ship's skill rows (Active, Charged, Passive), each with ability count + an **Edit** button.
- **`SkillEditorModal`** — focused modal for one skill: the ordered ability chain + **"+ Add ability"**. Uses the existing `Modal` UI primitive.
- **`AbilityTypePicker`** — grid of ability types grouped (Damage / Modify / Charge / Utility).
- **`AbilityCard`** — type-specific config (amount/stat/target) + a **Conditions block** that does double duty: *Scale by* (per-count, OR-groups via `anyOf`, cap) for damage; *Apply only when* (gate) for everything else. Includes a `trigger` selector when not `on-cast`.
- **`ConditionRow`** — subject dropdown + derivable/manual count + `anyOf` toggle + subject-specific fields.

Follows repo conventions: existing `Modal`, `Button`, `Select`, `Input`, `Checkbox`, the `card` class; no hand-rolled markup.

---

## 7. Data flow, migration, persistence

- `DPSShipConfig` gains `skills: ShipSkills`. The flat `active*`/`charged*`/`selfChargeGain`/`allyChargePerRound`/`activeDoTs`/`chargedDoTs`/`buffs`/`enemyDebuffs` fields are **migrated into abilities** and removed once the sim reads abilities.
- DPS configs are built fresh from ship-select + auto-fill (not persisted to storage), so migration is mostly **repointing the config builder** (`getInitialConfig`, `selectShipForConfig`) and the `simulateDPS` adapter to abilities. A mapping helper converts any existing in-memory flat config to abilities to avoid a hard cutover during implementation.
- The global game-buff pickers (`attackerBuffs`/`enemyBuffs`) and the Healing/Defense calcs keep working untouched; `SelectedGameBuff` stays. They migrate in their own follow-on specs.

---

## 8. Module / file structure

| File | Responsibility |
|---|---|
| `src/types/abilities.ts` | The shared model: `ShipSkills`, `Skill`, `Ability`, `Condition`, configs, enums |
| `src/utils/abilities/buildShipAbilities.ts` | Hybrid parser assembler (ship text → `ShipSkills`) |
| `src/utils/abilities/evaluateConditions.ts` | Resolve a `Condition[]` to a count against sim state (gate/scale) |
| `src/utils/abilities/applyAbilities.ts` | Map an ability + context to a sim effect (delegates to existing kernels) |
| `src/utils/calculators/dpsSimulator.ts` | Refactored two-pass round loop over abilities |
| `src/components/skills/*` | `SkillSlotList`, `SkillEditorModal`, `AbilityTypePicker`, `AbilityCard`, `ConditionRow` |
| `src/pages/calculators/DPSCalculatorPage.tsx` | Wire skills into config; pass to `simulateDPS` |

Small, focused files with clear interfaces: the model is pure types; the parser, condition-eval, and ability-application are independently testable; the editor components are presentational over the model.

---

## 9. Testing strategy

- **Model & condition eval (unit):** `evaluateConditions` — gate vs scale, OR-groups (`anyOf`), caps, manual vs derivable, hp-threshold, enemy-type.
- **Parser (unit):** `buildShipAbilities` against real fixtures from `docs/ship-skills.csv` (Selenite, Lodolite, Panguan, Lionheart, Chakara, Rhodium, Wusheng) — assert the emitted `Ability[]` per skill. Extends existing `skillTextParser.test.ts` patterns.
- **Simulator (regression):** the existing `dpsSimulator.test.ts` suite is the backstop — after the refactor, the same inputs (expressed as abilities) must reproduce the same per-round damage. Add ability-specific cases (modifier scaling, multi-hit `hits`, trigger filtering).
- **Editor (light):** smoke tests that adding/removing/configuring abilities updates the config; the sim numbers are covered by the layers above.
- **Verify in frontend** before finishing: build a complex ship (e.g. Lodolite/Selenite) in the editor and confirm the DPS chart matches expectations.

---

## 10. Out of scope (this build) — but model-aware

- Healing calc, Defense calc, combat sim consumers (follow-on specs).
- Simulating reactive triggers (counter/reflect/revive), multi-ship targeting, fine target selection. The model represents them; the DPS sim ignores them under its single-attacker-vs-dummy assumptions.
- Stochastic effects — none needed (the game text is deterministic; 0 ships use "% chance").
