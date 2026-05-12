# DPS Calculator — Game Buff Picker Design

**Date:** 2026-05-12
**Status:** Approved

## Summary

Replace the manual stat+value buff entry in the DPS Calculator with a searchable picker backed by the game's `BUFFS` constant. Add a matching enemy buff picker for two-way buff calculations. Extend the simulator to handle defense penetration buffs, DoT modifiers, enemy defense modifiers, and incoming damage modifiers.

---

## Scope

### In scope
- New `buffParser.ts` utility to extract numeric DPS effects from buff descriptions
- New `SelectedGameBuff` type representing a picked game buff with stack count
- Reusable `GameBuffPicker` component (searchable, stack-aware)
- DPS Calculator Active Buffs card replaced with attacker-side `GameBuffPicker`
- DPS Calculator new Enemy Buffs card with enemy-side `GameBuffPicker`
- Four new simulator inputs to support the new buff categories
- Verification script `scripts/verify-buff-parsing.ts`
- Normalise 3 buff descriptions in `src/constants/buffs.ts` to use standard `+N%` format

### Out of scope
- Changes to `DamageDeconstructionPage` (reference only)
- Conditional buffs (e.g., "Charged Overdrive II — next charged skill only")
- Hacking / Security / Speed stats (no DPS effect; shown greyed)

---

## Data Model

### `ParsedBuffEffects` (new, in `src/types/calculator.ts`)

All fields are optional percentage values. Sign convention: positive increases the DPS-relevant stat, negative decreases it — except `incomingDamage` and `incomingDotDamage`, where positive means more damage taken by the enemy (a debuff on the defender) and negative means less damage taken (a buff on the defender).

```ts
interface ParsedBuffEffects {
  // Attacker-side
  attack?: number;             // multiplicative, e.g. +30 → ×1.30 on attack
  crit?: number;               // additive on crit rate, e.g. +20 → crit+20
  critDamage?: number;         // additive on crit damage, e.g. +20 → critDamage+20
  outgoingDamage?: number;     // multiplicative, e.g. +15 → ×1.15 on direct damage
  defensePenetration?: number; // additive with per-ship value, e.g. +10 → defPen+10
  dotDamage?: number;          // from Out. DoT buffs on attacker (corrosion + inferno)

  // Enemy-side
  defense?: number;            // modifier on enemyDefense, e.g. -30 → defense×0.70
  incomingDamage?: number;     // modifier on direct damage taken by enemy, +30 → ×1.30
  incomingDotDamage?: number;  // from Inc. DoT buffs on enemy; +20 → enemy takes ×1.20 DoT
}
```

**`Out.` vs `Inc.` DoT distinction:** The `BUFFS` constant has two DoT modifier categories with identical description strings (`+N% DoT Damage`). They are distinguished by **buff name prefix** — `Out. DoT *` maps to `dotDamage` (attacker-side), `Inc. DoT *` maps to `incomingDotDamage` (enemy-side). The parser function therefore takes `(name: string, description: string)` as arguments.

**Cross-cutting buffs (e.g. Overload `+10% Outgoing Direct Damage, -10% Defense`):** When added to the attacker picker, `outgoingDamage: +10` is applied; the `defense` field (self-debuff in game) is silently ignored, since this simulation does not model the attacker's own defense. This is a documented limitation.

### `SelectedGameBuff` (new, in `src/types/calculator.ts`)

```ts
interface SelectedGameBuff {
  id: string;                       // unique instance id
  buffName: string;                 // matches BUFFS[].name
  stacks: number;                   // 1 by default; >1 only for stackable buffs
  parsedEffects: ParsedBuffEffects; // extracted from buff description (1 stack)
  isStackable: boolean;
  maxStacks?: number;               // parsed from description, e.g. "up to 10 times"
}
```

The existing `Buff` type and `calculateBuffTotals` in `dpsSimulator.ts` are **not changed**. An adapter function (in `DPSCalculatorPage`) converts `SelectedGameBuff[]` → `Buff[]` before passing to the simulator.

---

## `buffParser.ts` — `src/utils/calculators/buffParser.ts`

### `parseBuffEffects(name: string, description: string): ParsedBuffEffects`

Takes both the buff's `name` and `description`. Returns all extractable DPS effects. Uses regex patterns against `description`, except the Out./Inc. DoT distinction which reads the buff name:

| Trigger | Pattern | Field |
|---|---|---|
| description | `([+-]\d+)%\s*(?:Outgoing\s*)?(?:Direct\s*)?Attack` | `attack` |
| description | `([+-]\d+)%\s*(?:Outgoing\s*)?Crit\s*Rate` | `crit` — matches bare and "Outgoing" form |
| description | `([+-]\d+)%\s*(?:Outgoing\s*)?Crit\s*Power` | `critDamage` — matches bare and "Outgoing" form |
| description | `([+-]\d+)%\s*Outgoing\s*Direct\s*Damage` | `outgoingDamage` |
| description | `([+-]\d+)%\s*Defense\s*Penetration` | `defensePenetration` |
| **name starts with `Out.`** + description has `([+-]\d+)%\s*DoT\s*Damage` | → | `dotDamage` |
| **name starts with `Inc.`** + description has `([+-]\d+)%\s*DoT\s*Damage` | → | `incomingDotDamage` |
| description | `([+-]\d+)%\s*Defense(?!\s*Penetration)` | `defense` (enemy-side); negative lookahead prevents "Defense Penetration" from matching here |
| description | `([+-]\d+)%\s*Incoming\s*Direct\s*Damage` | `incomingDamage` (enemy-side) |

**Description normalizations applied to `src/constants/buffs.ts` before implementation:**
- `Supercharged I`: fixed `+ 10% Crit Power` → `+10% Crit Power` (spurious space)
- `Core Charge I`: rewritten as `+4% Outgoing Direct Damage, +1% Defense Penetration. Stackable up to 10 times.`
- `Defense Shred`: rewritten as `-2% Defense. Stackable up to 20 times.`

Returns `{}` if no patterns match (greyed in UI).

### `isStackable(description: string): { stackable: boolean; maxStacks?: number }`

Detects `/stackable/i` keyword (case-insensitive — descriptions use both "Stackable" and "stackable"). Optionally extracts `maxStacks` from `"up to N times"` using `/up to (\d+) times/i`.

**Note:** `isStackable` is a parser utility. `GameBuffPicker` calls it at add-time and stores the result as `isStackable: boolean` and `maxStacks?: number` in the `SelectedGameBuff` object. IDs are assigned via an incrementing counter ref inside `GameBuffPicker` (`nextIdRef.current++`).

### `hasDpsEffect(effects: ParsedBuffEffects, relevantStats: (keyof ParsedBuffEffects)[]): boolean`

Returns true if any of the `relevantStats` keys are present in `effects`.

---

## `GameBuffPicker` Component — `src/components/calculator/GameBuffPicker.tsx`

### Props

```ts
interface GameBuffPickerProps {
  label: string;                          // section heading
  relevantStats: (keyof ParsedBuffEffects)[];  // which stats matter for this section
  value: SelectedGameBuff[];
  onChange: (buffs: SelectedGameBuff[]) => void;
}
```

### Layout

```
[Section heading]
┌──────────────────────────────────────────┐
│ 🔍 Search buffs...                       │
└──────────────────────────────────────────┘

Selected buffs (shown when value.length > 0):
┌────────────────────────────────────────┬───┐
│ Marauder Rage III  +30% Atk, +20% CP  │ ✕ │
│  stacks: [1] (max 1)                  │   │
└────────────────────────────────────────┴───┘

Buff list (scrollable, max-h ~300px):
  [Attack Up I]      +15% Attack             [+]
  [Attack Up II]     +30% Attack             [+]
  [Speed Up I]       No DPS effect     (grey)[+]
```

### Behaviour

- Search filters both `name` and `description` fields from `BUFFS`
- Buffs where `hasDpsEffect(parsedEffects, relevantStats) === false` are rendered in muted colour with a "No DPS effect" label; they can still be added (shown in selected area without a parsed value)
- Selecting a buff with `isStackable = true` shows a stack counter (min 1, max `maxStacks`)
- Duplicate selections of the same buff are allowed (the same buff can be added multiple times — useful for buffs without a stackable annotation but that the game allows multiple of in practice)
- The search list only shows the add button; it does not track selection state — the selected area at the top is the source of truth

---

## DPS Simulator Changes — `src/utils/calculators/dpsSimulator.ts`

Four new optional fields on `DPSSimulationInput` (all default to 0 if absent):

```ts
defensePenetrationBuff?: number;  // additive to per-ship defensePenetration
dotDamageModifier?: number;       // % multiplier on corrosion + inferno damage (both Out. and Inc. sources combined)
enemyDefenseModifier?: number;    // % modifier on enemyDefense (e.g. -30 = defense×0.70)
incomingDamageModifier?: number;  // % multiplier on direct damage received by enemy
```

### Applied in simulation

The existing `effectiveDefense` line (currently `enemyDefense * (1 - defensePenetration / 100)`) is **replaced** with:

```ts
const effectivePen = defensePenetration + (defensePenetrationBuff ?? 0);
const effectiveDefense = enemyDefense
  * (1 + (enemyDefenseModifier ?? 0) / 100)
  * (1 - effectivePen / 100);

// direct damage — outgoingDamageBuff already extracted from buffs via calculateBuffTotals:
const directDamage = baseDamage
  * (multiplier / 100)
  * (1 + outgoingDamageBuff / 100)
  * (1 + (incomingDamageModifier ?? 0) / 100);

// DoT damage — dotDamageModifier combines both attacker-side (Out. DoT) and enemy-side (Inc. DoT):
const dotMult = 1 + (dotDamageModifier ?? 0) / 100;
const corrosionDamage = tickDoTStacks(corrosionEntries, enemyHp) * dotMult;
const infernoDamage   = tickDoTStacks(infernoEntries, effectiveAttack) * dotMult;
```

---

## DPS Calculator Page Changes — `src/pages/calculators/DPSCalculatorPage.tsx`

### State changes

Replace:
```ts
const [buffs, setBuffs] = useState<Buff[]>([]);
const [nextBuffId, setNextBuffId] = useState(1);
```

With:
```ts
const [attackerBuffs, setAttackerBuffs] = useState<SelectedGameBuff[]>([]);
const [enemyBuffs, setEnemyBuffs] = useState<SelectedGameBuff[]>([]);
```

### Adapter (in-file helper functions)

Each adapter multiplies `parsedEffects.fieldName * stacks` per buff and sums across all selected buffs.

```ts
// Attacker buffs → Buff[] for the existing calculateBuffTotals path (attack/crit/critDamage/outgoingDamage only)
// Each field value = parsedEffects.field * stacks, emitted as one Buff entry per stat per SelectedGameBuff
function toSimBuffs(selected: SelectedGameBuff[]): Buff[] { ... }

// Enemy buffs → enemyDefenseModifier + incomingDamageModifier
// Sum of (parsedEffects.defense * stacks) and (parsedEffects.incomingDamage * stacks) respectively
function toEnemyModifiers(selected: SelectedGameBuff[]): {
  enemyDefenseModifier: number;
  incomingDamageModifier: number;
} { ... }

// Attacker dotDamage + enemy incomingDotDamage → combined dotDamageModifier
// defPen: sum of (parsedEffects.defensePenetration * stacks) from attackerBuffs
// dot: sum of (parsedEffects.dotDamage * stacks from attackerBuffs)
//    + sum of (parsedEffects.incomingDotDamage * stacks from enemyBuffs)
function toDotAndPenModifiers(
  attackerBuffs: SelectedGameBuff[],
  enemyBuffs: SelectedGameBuff[]
): {
  defensePenetrationBuff: number;
  dotDamageModifier: number;
} { ... }
```

### UI changes

Remove the existing "Active Buffs" card and replace with two cards:

**Card 1 — Attacker Buffs**
```tsx
<GameBuffPicker
  label="Attacker Buffs"
  relevantStats={['attack','crit','critDamage','outgoingDamage','defensePenetration','dotDamage']}
  value={attackerBuffs}
  onChange={setAttackerBuffs}
/>
```

**Card 2 — Enemy Buffs / Debuffs**
```tsx
<GameBuffPicker
  label="Enemy Buffs / Debuffs"
  relevantStats={['defense','incomingDamage','incomingDotDamage']}
  value={enemyBuffs}
  onChange={setEnemyBuffs}
/>
```

---

## Verification Script — `scripts/verify-buff-parsing.ts`

Run via: `tsx scripts/verify-buff-parsing.ts`

Output categories:
1. **Parseable with DPS effects** — buff name, parsed stat fields
2. **No DPS effects** — buff name, description (will appear greyed in UI)
3. **Parse summary** — total count in each category

The script imports `BUFFS` from `src/constants/buffs.ts` and `parseBuffEffects` / `isStackable` from the new utility. No external dependencies beyond `tsx`.

---

## File Checklist

| File | Action |
|---|---|
| `src/types/calculator.ts` | Add `ParsedBuffEffects`, `SelectedGameBuff` |
| `src/utils/calculators/buffParser.ts` | Create new file |
| `src/components/calculator/GameBuffPicker.tsx` | Create new component |
| `src/utils/calculators/dpsSimulator.ts` | Add 4 new optional simulator inputs |
| `src/pages/calculators/DPSCalculatorPage.tsx` | Replace Active Buffs card, add Enemy Buffs card, update state + adapters |
| `scripts/verify-buff-parsing.ts` | Create verification script |

---

## What is NOT changed

- `Buff` type and `calculateBuffTotals` in `dpsSimulator.ts` — unchanged
- `DamageDeconstructionPage.tsx` — unchanged (reference only)
- `BUFFS` constant — unchanged

---

## Implementation Notes

- Add an entry to `UNRELEASED_CHANGES` in `src/constants/changelog.ts` (user-facing feature)
- Update `DocumentationPage.tsx` to document the buff picker sections
