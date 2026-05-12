# Ship Skills Integration

**Date:** 2026-05-12  
**Status:** Approved

## Overview

Surface ship template skill data in two places: the Ship Details page (so users can see their ship's skills alongside gear and stats) and the DPS Calculator (so skill damage multipliers can be auto-populated from the template and a "Start Charged" state can be detected automatically).

## Background

Skills are stored as plain text strings on `ship_templates` with semantic markup tags (e.g. `<unit-damage>180% damage</unit-damage>`). The existing `ShipsContext` already joins `ships` with `ship_templates` but does not select or map the six skill text fields. The `Ship` type already declares them as optional properties — they are simply never populated.

The DPS Calculator currently has manually-entered `activeMultiplier` and `chargedMultiplier` inputs under a "Skills" section, with no link to actual skill data.

## Scope

### Out of scope
- Parsing HP/DEF/adjacency-based damage values (too ambiguous in natural language — users handle these via manual buff inputs)
- Editing or overriding skill text on a per-ship basis
- Adding skills to the ship card on the Ships list page (too crowded; details page is the right home)
- Tutorial integration for the new ShipSkills component (add a TODO comment placeholder only)

---

## 1. Data Layer

### RawShipData interface
The `RawShipData` interface in `ShipsContext.tsx` defines the TypeScript shape of the Supabase response. Its nested `ship_templates` object must be extended to include the six skill columns alongside the existing `image_key`:

```typescript
ship_templates: {
    image_key: string;
    active_skill_text: string | null;
    charge_skill_text: string | null;
    charge_skill_charge: number | null;
    first_passive_skill_text: string | null;
    second_passive_skill_text: string | null;
    third_passive_skill_text: string | null;
};
```

### ShipsContext query extension
Extend the Supabase select string to include the six skill columns from the `ship_templates` join:

```
active_skill_text,
charge_skill_text,
charge_skill_charge,
first_passive_skill_text,
second_passive_skill_text,
third_passive_skill_text
```

### transformShipData mapping
Map the six fetched fields to the existing optional properties on `Ship`:

| DB column | Ship property |
|---|---|
| `active_skill_text` | `activeSkillText` |
| `charge_skill_text` | `chargeSkillText` |
| `charge_skill_charge` | `chargeSkillCharge` |
| `first_passive_skill_text` | `firstPassiveSkillText` |
| `second_passive_skill_text` | `secondPassiveSkillText` |
| `third_passive_skill_text` | `thirdPassiveSkillText` |

No schema changes and no new TypeScript types are required.

---

## 2. Skill Parsing Utility

**File:** `src/utils/skillTextParser.ts` (extend existing file)

### `parseSkillDamage(text: string): number`

- Extract all `<unit-damage>` tag contents via regex
- Skip any match where the 60 characters immediately preceding the opening `<unit-damage>` tag contain the substring "of its" (indicates stat-based damage, e.g. "does additional damage based on 30% of its DEF"). Implement this as a manual index check (find the tag's position in the full text, slice `text.slice(Math.max(0, tagIndex - 60), tagIndex)`, check for "of its") rather than a regex lookbehind, for consistent cross-runtime behaviour
- Parse the leading numeric value from each qualifying match (e.g. `180` from `"180% damage"`)
- Sum all qualifying values and return as an **integer percentage** (e.g. returns `180` for a single `<unit-damage>180% damage</unit-damage>`, returns `240` if two tags sum to 240%)
- Returns `0` if no qualifying matches are found

### `detectFullyCharged(texts: (string | undefined)[]): boolean`

- Accepts an array of skill text strings (pass all five skill text fields)
- Returns `true` if any of the provided strings contains the substring `"fully charged"` (case-insensitive)
- This broad match intentionally covers all known in-game variants including typos ("stars combat with a fully charged charge skill")

---

## 3. Inline Skill Text Rendering

`SkillTooltip` renders a popup-style container (`bg-dark-lighter shadow-lg border`) intended for tooltip/popover use. For inline display in the Ship Details page and DPS Calculator reference panel, the segment rendering must be exposed without that outer container.

**Solution:** Add an `inline` prop to `SkillTooltip`:

```typescript
interface SkillTooltipProps {
    skillText: string;
    skillType: string;
    charge?: number;
    inline?: boolean;  // new — omits the outer container div and renders content directly
}
```

When `inline={true}`:
- Omit the outer `bg-dark-lighter p-2 shadow-lg max-w-xs border border-dark-border` wrapper
- Render the header (skill type label + charge icon) and segment text directly
- **Suppress** the `BuffTooltip` sub-components — they are popup-style elements that are meaningless in a static inline context

---

## 4. Ship Details Page — Skills Card

### New component: `src/components/ship/ShipSkills.tsx`

Props:
```typescript
interface ShipSkillsProps {
    ship: Ship;
}
```

Renders a `card` section with a heading "Skills". Each skill row shows a label and the skill text using `<SkillTooltip inline />`. Rows where the skill text is `undefined` or empty string are omitted entirely.

| Label | Source field | Notes |
|---|---|---|
| Active | `activeSkillText` | — |
| Charge (NT) | `chargeSkillText` | N = `chargeSkillCharge`. If `chargeSkillCharge` is falsy, render label as just "Charge" |
| Passive R1 | `firstPassiveSkillText` | — |
| Passive R2 | `secondPassiveSkillText` | — |
| Passive R4 | `thirdPassiveSkillText` | — |

Add a `{/* TODO: wire up tutorial data-tutorial attribute when tutorial system is extended */}` comment on the outer element.

### ShipDetailsPage placement

Insert `<ShipSkills ship={ship} />` in the right column of `ShipDetailsPage`, between `ShipShowcase` and `StatDistributionChart`.

---

## 5. DPS Calculator — Skills Integration

### `DPSSimulationInput` extension (`src/utils/calculators/dpsSimulator.ts`)

Add `startCharged: boolean` to the `DPSSimulationInput` interface.

In `simulateDPS`, change the initial charge state:

```typescript
// Before
let charges = 0;

// After
let charges = input.startCharged ? input.chargeCount : 0;
```

This causes the ship to fire its charge skill on round 1 if `startCharged` is true, with no accumulation turns consumed first.

### ShipConfig extension (`src/pages/calculators/DPSCalculatorPage.tsx`)

Add `startCharged: boolean` to the local `ShipConfig` interface (defined inline in the page file). Default value: `false`.

### Auto-fill on ship selection

When a ship is selected in the DPS Calculator ship selector, compute the auto-fill values and apply them via a direct `setConfigs` functional update (not through `updateConfig`, which only accepts `string | number` and has an explicit field union):

```typescript
setConfigs(prev => prev.map(cfg => {
    if (cfg.id !== selectedConfigId) return cfg;
    const activeParsed = parseSkillDamage(ship.activeSkillText ?? '');
    const chargedParsed = parseSkillDamage(ship.chargeSkillText ?? '');
    const newAutoFilled = new Set<'activeMultiplier' | 'chargedMultiplier'>();
    return {
        ...cfg,
        activeMultiplier: activeParsed > 0 ? (newAutoFilled.add('activeMultiplier'), activeParsed) : cfg.activeMultiplier,
        chargedMultiplier: chargedParsed > 0 ? (newAutoFilled.add('chargedMultiplier'), chargedParsed) : cfg.chargedMultiplier,
        startCharged: detectFullyCharged([ship.activeSkillText, ship.chargeSkillText, ship.firstPassiveSkillText, ship.secondPassiveSkillText, ship.thirdPassiveSkillText]),
        autoFilledFields: newAutoFilled,
    };
}));
```

Rules:
- If `parseSkillDamage` returns `0`, leave the existing field value unchanged and do not add it to `autoFilledFields`
- `startCharged` is always set (overrides previous value) — it cannot go through `updateConfig` and must use `setConfigs` directly

### ShipConfig additions

In addition to `startCharged: boolean` (default `false`), add to the local `ShipConfig` interface:

```typescript
autoFilledFields?: Set<'activeMultiplier' | 'chargedMultiplier'>;
```

Show a small `(auto-filled)` note in muted text next to `activeMultiplier` / `chargedMultiplier` inputs when their key is present in `autoFilledFields`. Clear the key from the set when the user manually edits that field (via the existing `updateConfig` call for that field, add `setConfigs` to remove the key from `autoFilledFields` at the same time).

### UI changes to the ship config panel

1. **"Start Charged" checkbox** — render a `Checkbox` component with label "Start Charged" directly adjacent to the charge count input. Its `onChange` calls `setConfigs` directly to toggle `startCharged` (not `updateConfig`). Auto-checked via `detectFullyCharged` on ship selection; remains manually toggleable.

2. **Skill Reference collapsible** — below the Skills inputs, manage a local `isSkillRefOpen` boolean state. Render a `Button` variant `link` labelled "Skill Reference ▾ / ▴" as the toggle. Pass `isSkillRefOpen` to `<CollapsibleAccordion isOpen={isSkillRefOpen}>`. Inside, show the ship's active and charge skill texts using `<SkillTooltip inline />`. Collapsed by default. This lets users identify stat-based or adjacency damage values to add manually as buffs.

---

## Components Affected

| File | Change |
|---|---|
| `src/contexts/ShipsContext.tsx` | Extend `RawShipData` interface, query string, and `transformShipData` mapping |
| `src/utils/skillTextParser.ts` | Add `parseSkillDamage` and `detectFullyCharged` |
| `src/components/ship/SkillTooltip.tsx` | Add `inline` prop |
| `src/components/ship/ShipSkills.tsx` | New component |
| `src/pages/manager/ShipDetailsPage.tsx` | Insert `ShipSkills` in right column |
| `src/utils/calculators/dpsSimulator.ts` | Add `startCharged` to `DPSSimulationInput`; init `charges` from it |
| `src/pages/calculators/DPSCalculatorPage.tsx` | Add `startCharged` to local `ShipConfig`; auto-fill on ship select; Start Charged checkbox; Skill Reference collapsible |
| `src/constants/changelog.ts` | Add entry to `UNRELEASED_CHANGES` |
| `src/pages/DocumentationPage.tsx` | Update docs to reflect new skills display and calculator auto-fill |

---

## Testing

- Unit tests for `parseSkillDamage`: summing multiple `<unit-damage>` values, skipping "of its" patterns, returning `0` on no match, returning integer percentage not a float
- Unit tests for `detectFullyCharged`: returns true for "fully charged" variants including mixed case, returns false when absent, handles undefined entries in array
- No new integration tests required (data layer change is covered by existing context tests)
