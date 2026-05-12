# Ship Skills Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface ship template skill data on the Ship Details page and auto-populate DPS Calculator skill multipliers from parsed skill text.

**Architecture:** Extend the existing ShipsContext Supabase query to fetch six skill text fields already present in the DB join but not selected. Add two pure parsing functions to `skillTextParser.ts`. Add an `inline` prop to `SkillTooltip` for static display. Wire parsed skills into the DPS Calculator's ship selection flow.

**Tech Stack:** React 18, TypeScript, Vite, TailwindCSS, Supabase, Vitest

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `src/utils/skillTextParser.ts` | Modify | Add `parseSkillDamage` and `detectFullyCharged` |
| `src/utils/__tests__/skillTextParser.test.ts` | Create | Unit tests for both new parser functions |
| `src/types/ship.ts` | Modify | Add `chargeSkillCharge?: number` to `ShipData` interface |
| `src/contexts/ShipsContext.tsx` | Modify | Extend `RawShipData`, query string, and `transformShipData` |
| `src/components/ship/SkillTooltip.tsx` | Modify | Add `inline` prop — omit outer container + BuffTooltips |
| `src/components/ship/ShipSkills.tsx` | Create | Skills card for Ship Details page |
| `src/pages/manager/ShipDetailsPage.tsx` | Modify | Insert `ShipSkills` in right column |
| `src/utils/calculators/dpsSimulator.ts` | Modify | Add `startCharged?: boolean` to input type; init charges from it |
| `src/utils/calculators/__tests__/dpsSimulator.test.ts` | Modify | Add test for `startCharged` behaviour |
| `src/pages/calculators/DPSCalculatorPage.tsx` | Modify | ShipConfig fields, auto-fill, Start Charged checkbox, Skill Reference |
| `src/constants/changelog.ts` | Modify | Add UNRELEASED_CHANGES entry |
| `src/pages/DocumentationPage.tsx` | Modify | Update docs for new skills features |

---

## Task 1: Skill Parsing Utilities (TDD)

**Files:**
- Modify: `src/utils/skillTextParser.ts`
- Create: `src/utils/__tests__/skillTextParser.test.ts`

- [ ] **Step 1: Create the test file with failing tests**

```typescript
// src/utils/__tests__/skillTextParser.test.ts
import { describe, it, expect } from 'vitest';
import { parseSkillDamage, detectFullyCharged } from '../skillTextParser';

describe('parseSkillDamage', () => {
    it('returns 0 for empty string', () => {
        expect(parseSkillDamage('')).toBe(0);
    });

    it('extracts a single damage value', () => {
        expect(parseSkillDamage('Deals <unit-damage>180% damage</unit-damage> to target')).toBe(180);
    });

    it('sums multiple damage values', () => {
        const text = 'Deals <unit-damage>120% damage</unit-damage> then <unit-damage>60% damage</unit-damage>';
        expect(parseSkillDamage(text)).toBe(180);
    });

    it('skips stat-based damage (contains "of its" before tag)', () => {
        const text = 'Deals additional damage based on <unit-damage>30%</unit-damage> of its DEF';
        expect(parseSkillDamage(text)).toBe(0);
    });

    it('keeps a normal damage tag that happens to follow a long sentence without "of its"', () => {
        const text = 'This unit attacks the enemy and deals <unit-damage>200% damage</unit-damage>';
        expect(parseSkillDamage(text)).toBe(200);
    });

    it('returns integer percentage, not a float', () => {
        const result = parseSkillDamage('<unit-damage>180% damage</unit-damage>');
        expect(Number.isInteger(result)).toBe(true);
        expect(result).toBe(180);
    });

    it('handles a mix of stat-based and normal damage in the same text', () => {
        const text = 'Deals <unit-damage>100% damage</unit-damage> plus extra based on <unit-damage>50%</unit-damage> of its HP';
        expect(parseSkillDamage(text)).toBe(100);
    });
});

describe('detectFullyCharged', () => {
    it('returns false for empty array', () => {
        expect(detectFullyCharged([])).toBe(false);
    });

    it('returns false when no skill text contains "fully charged"', () => {
        expect(detectFullyCharged(['Deals 180% damage', 'Passive bonus'])).toBe(false);
    });

    it('returns true for "starts combat fully charged"', () => {
        expect(detectFullyCharged(['This unit starts combat fully charged.'])).toBe(true);
    });

    it('returns true for "starts combat with a fully charged charged skill" variant', () => {
        expect(detectFullyCharged(['This unit starts combat with a fully charged charged skill.'])).toBe(true);
    });

    it('is case-insensitive', () => {
        expect(detectFullyCharged(['This unit starts combat FULLY CHARGED.'])).toBe(true);
    });

    it('handles undefined entries in the array without throwing', () => {
        expect(detectFullyCharged([undefined, 'starts combat fully charged', undefined])).toBe(true);
    });

    it('returns true when match is in a passive skill (3rd entry)', () => {
        expect(detectFullyCharged([undefined, undefined, 'This unit starts combat fully charged.', undefined, undefined])).toBe(true);
    });

    it('returns false when all entries are undefined', () => {
        expect(detectFullyCharged([undefined, undefined])).toBe(false);
    });
});
```

- [ ] **Step 2: Run the test file to confirm it fails**

```bash
npx vitest run src/utils/__tests__/skillTextParser.test.ts
```

Expected: FAIL — `parseSkillDamage is not a function` / `detectFullyCharged is not a function`

- [ ] **Step 3: Implement `parseSkillDamage` in `src/utils/skillTextParser.ts`**

Add after the existing `extractSkillNames` function (after line 122):

```typescript
/**
 * Sums all <unit-damage>X% ...</unit-damage> values in skill text.
 * Skips values where the 60 characters before the tag contain "of its"
 * (stat-based damage like "30% of its DEF" — must be added manually as a buff).
 * Returns an integer percentage (e.g. 180 for "180% damage"), or 0 if none found.
 */
export function parseSkillDamage(text: string): number {
    if (!text) return 0;
    const tagPattern = /<unit-damage>(.*?)<\/unit-damage>/g;
    let total = 0;
    let match: RegExpExecArray | null;
    while ((match = tagPattern.exec(text)) !== null) {
        const tagIndex = match.index;
        const preceding = text.slice(Math.max(0, tagIndex - 60), tagIndex);
        if (preceding.toLowerCase().includes('of its')) continue;
        const numeric = parseInt(match[1], 10);
        if (!isNaN(numeric)) total += numeric;
    }
    return total;
}

/**
 * Returns true if any of the provided skill texts contain "fully charged" (case-insensitive).
 * Checks all five skill text fields to cover all in-game phrasings including typos.
 */
export function detectFullyCharged(texts: (string | undefined)[]): boolean {
    return texts.some((t) => t?.toLowerCase().includes('fully charged') ?? false);
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx vitest run src/utils/__tests__/skillTextParser.test.ts
```

Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/skillTextParser.ts src/utils/__tests__/skillTextParser.test.ts
git commit -m "feat: add parseSkillDamage and detectFullyCharged to skillTextParser"
```

---

## Task 2: Fix ShipData Type + Extend Data Layer

**Files:**
- Modify: `src/types/ship.ts` (line 73–81, `ShipData` interface)
- Modify: `src/contexts/ShipsContext.tsx` (lines 100–102, 308–310, 243)

- [ ] **Step 1: Add `chargeSkillCharge` to `ShipData` in `src/types/ship.ts`**

`ShipData` currently (lines 73–77):
```typescript
    activeSkillText?: string;
    chargeSkillText?: string;
    firstPassiveSkillText?: string;
```

Change to:
```typescript
    activeSkillText?: string;
    chargeSkillText?: string;
    chargeSkillCharge?: number;
    firstPassiveSkillText?: string;
```

- [ ] **Step 2: Extend `RawShipData.ship_templates` in `ShipsContext.tsx`**

Current (lines 100–102):
```typescript
    ship_templates: {
        image_key: string;
    };
```

Replace with:
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

- [ ] **Step 3: Extend the Supabase select query in `ShipsContext.tsx`**

Current (lines 308–310):
```typescript
                    ship_templates!inner (
                        image_key
                    )
```

Replace with:
```typescript
                    ship_templates!inner (
                        image_key,
                        active_skill_text,
                        charge_skill_text,
                        charge_skill_charge,
                        first_passive_skill_text,
                        second_passive_skill_text,
                        third_passive_skill_text
                    )
```

- [ ] **Step 4: Map skill fields in `transformShipData` in `ShipsContext.tsx`**

Current (line 243):
```typescript
            imageKey: data.ship_templates.image_key,
```

Replace with:
```typescript
            imageKey: data.ship_templates.image_key,
            activeSkillText: data.ship_templates.active_skill_text ?? undefined,
            chargeSkillText: data.ship_templates.charge_skill_text ?? undefined,
            chargeSkillCharge: data.ship_templates.charge_skill_charge ?? undefined,
            firstPassiveSkillText: data.ship_templates.first_passive_skill_text ?? undefined,
            secondPassiveSkillText: data.ship_templates.second_passive_skill_text ?? undefined,
            thirdPassiveSkillText: data.ship_templates.third_passive_skill_text ?? undefined,
```

- [ ] **Step 5: Run full test suite to confirm nothing broke**

```bash
npm test
```

Expected: All existing tests PASS (no type errors, no failing tests)

- [ ] **Step 6: Commit**

```bash
git add src/types/ship.ts src/contexts/ShipsContext.tsx
git commit -m "feat: fetch and map skill text fields from ship_templates join"
```

---

## Task 3: SkillTooltip Inline Prop

**Files:**
- Modify: `src/components/ship/SkillTooltip.tsx`

- [ ] **Step 1: Add `inline` prop to `SkillTooltipProps` and conditionally render**

Current interface (line 6–10):
```typescript
interface SkillTooltipProps {
    skillText: string;
    skillType: string;
    charge?: number;
}
```

Replace with:
```typescript
interface SkillTooltipProps {
    skillText: string;
    skillType: string;
    charge?: number;
    inline?: boolean;
}
```

Current render (lines 27–99) starts with:
```typescript
    return (
        <>
            <div className="bg-dark-lighter p-2 shadow-lg max-w-xs border border-dark-border">
```

Change to conditionally omit the outer div and suppress `BuffTooltip` sub-components when `inline` is true:

```typescript
export const SkillTooltip: React.FC<SkillTooltipProps> = ({ skillText, skillType, charge, inline }) => {
    const segments = parseSkillText(skillText);
    const skillNames = extractSkillNames(skillText);

    const renderTextWithBreaks = (text: string) => {
        const parts = text.split('<br />');
        return parts.map((part, i) => (
            <React.Fragment key={i}>
                {part}
                {i < parts.length - 1 && <br />}
            </React.Fragment>
        ));
    };

    const content = (
        <>
            <div className="flex items-center gap-2">
                <span className="font-semibold text-primary">{skillType}</span>
                {charge !== undefined && (
                    <span className="flex items-center gap-1 font-medium">
                        <ClockIcon className="w-3.5 h-3.5" />
                        {charge}
                    </span>
                )}
            </div>
            <div className="text-sm text-theme-text mb-2">
                {segments.map((segment, index) => {
                    if (segment.type === 'text') {
                        return <span key={index}>{renderTextWithBreaks(segment.text)}</span>;
                    }
                    if (segment.type === 'unit-skill') {
                        return (
                            <span key={index} className="relative group inline-block">
                                <span className="skill-name">{segment.text}</span>
                                {segment.buffDescription && (
                                    <div className="skill-tooltip">
                                        <div className="font-semibold text-sm text-primary capitalize">
                                            {segment.text}
                                        </div>
                                        <div className="text-sm text-theme-text">
                                            {segment.buffDescription}
                                        </div>
                                    </div>
                                )}
                            </span>
                        );
                    }
                    if (segment.type === 'unit-damage') {
                        return (
                            <span key={index} className="skill-damage">
                                {renderTextWithBreaks(segment.text)}
                            </span>
                        );
                    }
                    if (segment.type === 'unit-aid') {
                        return (
                            <span key={index} className="skill-aid">
                                {renderTextWithBreaks(segment.text)}
                            </span>
                        );
                    }
                    return null;
                })}
            </div>
        </>
    );

    if (inline) {
        return content;
    }

    return (
        <>
            <div className="bg-dark-lighter p-2 shadow-lg max-w-xs border border-dark-border">
                {content}
            </div>
            {skillNames
                .filter((name) => {
                    const segment = segments.find(
                        (s) => s.type === 'unit-skill' && s.text === name
                    );
                    return segment?.buffDescription;
                })
                .map((buffName) => (
                    <BuffTooltip key={buffName} buffName={buffName} />
                ))}
        </>
    );
};
```

- [ ] **Step 2: Run full test suite**

```bash
npm test
```

Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add src/components/ship/SkillTooltip.tsx
git commit -m "feat: add inline prop to SkillTooltip for static display contexts"
```

---

## Task 4: ShipSkills Component + Ship Details Page

**Files:**
- Create: `src/components/ship/ShipSkills.tsx`
- Modify: `src/pages/manager/ShipDetailsPage.tsx`

- [ ] **Step 1: Create `src/components/ship/ShipSkills.tsx`**

```typescript
import React from 'react';
import { Ship } from '../../types/ship';
import { SkillTooltip } from './SkillTooltip';

interface ShipSkillsProps {
    ship: Ship;
}

interface SkillRow {
    label: string;
    text: string;
    charge?: number;
}

export const ShipSkills: React.FC<ShipSkillsProps> = ({ ship }) => {
    const rows: SkillRow[] = [
        { label: 'Active', text: ship.activeSkillText ?? '' },
        {
            label: ship.chargeSkillCharge ? `Charge (${ship.chargeSkillCharge}T)` : 'Charge',
            text: ship.chargeSkillText ?? '',
            charge: ship.chargeSkillCharge,
        },
        { label: 'Passive R1', text: ship.firstPassiveSkillText ?? '' },
        { label: 'Passive R2', text: ship.secondPassiveSkillText ?? '' },
        { label: 'Passive R4', text: ship.thirdPassiveSkillText ?? '' },
    ].filter((row) => row.text.length > 0);

    if (rows.length === 0) return null;

    return (
        // TODO: wire up tutorial data-tutorial attribute when tutorial system is extended
        <div className="card space-y-4">
            <h3>Skills</h3>
            {rows.map((row) => (
                <div key={row.label}>
                    <SkillTooltip
                        inline
                        skillText={row.text}
                        skillType={row.label}
                        charge={row.charge}
                    />
                </div>
            ))}
        </div>
    );
};
```

- [ ] **Step 2: Add `ShipSkills` to the right column in `ShipDetailsPage.tsx`**

In `src/pages/manager/ShipDetailsPage.tsx`, find the right column (starts at line 228):
```typescript
                    <div className="space-y-6">
                        <ShipShowcase ship={ship} />
                        <div data-tutorial="ship-details-stat-distribution">
```

Insert `<ShipSkills ship={ship} />` between `ShipShowcase` and the stat distribution div:
```typescript
                    <div className="space-y-6">
                        <ShipShowcase ship={ship} />
                        <ShipSkills ship={ship} />
                        <div data-tutorial="ship-details-stat-distribution">
```

- [ ] **Step 3: Add the import to `ShipDetailsPage.tsx`**

Add to the imports near the top of the file (after the `ShipShowcase` import line):
```typescript
import { ShipSkills } from '../../components/ship/ShipSkills';
```

- [ ] **Step 4: Run full test suite**

```bash
npm test
```

Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/ship/ShipSkills.tsx src/pages/manager/ShipDetailsPage.tsx
git commit -m "feat: add ShipSkills card to Ship Details page"
```

---

## Task 5: DPS Simulator — startCharged Support (TDD)

**Files:**
- Modify: `src/utils/calculators/dpsSimulator.ts`
- Modify: `src/utils/calculators/__tests__/dpsSimulator.test.ts`

- [ ] **Step 1: Write a failing test for `startCharged` behaviour**

In `src/utils/calculators/__tests__/dpsSimulator.test.ts`, add a new `describe` block after the existing tests.

Note: the existing `baseInput` object in the test file does not include `startCharged` — that is fine because we will make the field optional.

```typescript
describe('startCharged', () => {
    it('fires charged skill on round 1 when startCharged is true', () => {
        const result = simulateDPS({
            attack: 15000,
            crit: 0,
            critDamage: 150,
            defensePenetration: 0,
            activeMultiplier: 100,
            chargedMultiplier: 300,
            chargeCount: 3,
            activeDoTs: [],
            chargedDoTs: [],
            enemyDefense: 0,
            enemyHp: 500000,
            rounds: 5,
            buffs: [],
            startCharged: true,
        });
        expect(result.rounds[0].action).toBe('charged');
    });

    it('does not fire charged skill on round 1 when startCharged is false', () => {
        const result = simulateDPS({
            attack: 15000,
            crit: 0,
            critDamage: 150,
            defensePenetration: 0,
            activeMultiplier: 100,
            chargedMultiplier: 300,
            chargeCount: 3,
            activeDoTs: [],
            chargedDoTs: [],
            enemyDefense: 0,
            enemyHp: 500000,
            rounds: 5,
            buffs: [],
            startCharged: false,
        });
        expect(result.rounds[0].action).toBe('active');
    });

    it('defaults to not start charged when field is absent', () => {
        const result = simulateDPS({
            attack: 15000,
            crit: 0,
            critDamage: 150,
            defensePenetration: 0,
            activeMultiplier: 100,
            chargedMultiplier: 300,
            chargeCount: 3,
            activeDoTs: [],
            chargedDoTs: [],
            enemyDefense: 0,
            enemyHp: 500000,
            rounds: 5,
            buffs: [],
        });
        expect(result.rounds[0].action).toBe('active');
    });
});
```

- [ ] **Step 2: Run to confirm the new tests fail**

```bash
npx vitest run src/utils/calculators/__tests__/dpsSimulator.test.ts
```

Expected: The three new `startCharged` tests FAIL

- [ ] **Step 3: Add `startCharged` to `DPSSimulationInput` and update `simulateDPS`**

In `src/utils/calculators/dpsSimulator.ts`, add to `DPSSimulationInput` interface (after `buffs: Buff[];` at line 17):

```typescript
    startCharged?: boolean;
```

In `simulateDPS`, change line 132:
```typescript
    let charges = 0;
```
to:
```typescript
    let charges = input.startCharged ? input.chargeCount : 0;
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx vitest run src/utils/calculators/__tests__/dpsSimulator.test.ts
```

Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/calculators/dpsSimulator.ts src/utils/calculators/__tests__/dpsSimulator.test.ts
git commit -m "feat: add startCharged support to DPS simulator"
```

---

## Task 6: DPS Calculator UI

**Files:**
- Modify: `src/pages/calculators/DPSCalculatorPage.tsx`

- [ ] **Step 1: Add new fields to the `ShipConfig` interface and update `updateConfig` cleared set logic**

Current `ShipConfig` (lines 32–45):
```typescript
interface ShipConfig {
    id: string;
    shipId?: string;
    name: string;
    attack: number;
    crit: number;
    critDamage: number;
    defensePenetration: number;
    activeMultiplier: number;
    chargedMultiplier: number;
    chargeCount: number;
    activeDoTs: DoTApplicationConfig;
    chargedDoTs: DoTApplicationConfig;
}
```

Replace with:
```typescript
interface ShipConfig {
    id: string;
    shipId?: string;
    name: string;
    attack: number;
    crit: number;
    critDamage: number;
    defensePenetration: number;
    activeMultiplier: number;
    chargedMultiplier: number;
    chargeCount: number;
    startCharged: boolean;
    autoFilledFields?: Set<'activeMultiplier' | 'chargedMultiplier'>;
    activeDoTs: DoTApplicationConfig;
    chargedDoTs: DoTApplicationConfig;
}
```

- [ ] **Step 2: Add `startCharged: false` to every default config object**

There are three places in the file that create a default `ShipConfig` object. Find them with:
```bash
grep -n "chargeCount: 0," src/pages/calculators/DPSCalculatorPage.tsx
```

Add `startCharged: false,` after each `chargeCount: 0,` line in all three locations (around lines 108, 128, 199).

- [ ] **Step 3: Add parser imports**

At the top of the file, add to the imports:
```typescript
import { parseSkillDamage, detectFullyCharged } from '../../utils/skillTextParser';
```

Also add `CollapsibleAccordion` import:
```typescript
import { CollapsibleAccordion } from '../../components/ui/CollapsibleAccordion';
```

And `Checkbox` from the ui index:
```typescript
import { Checkbox } from '../../components/ui/Checkbox';
```

- [ ] **Step 4: Add `startCharged` to the `simulateDPS` call in `simResults` useMemo**

Current (around line 165):
```typescript
            map.set(
                config.id,
                simulateDPS({
                    attack: config.attack,
                    ...
                    buffs,
                })
            );
```

Add `startCharged: config.startCharged,` after `buffs,`:
```typescript
                    buffs,
                    startCharged: config.startCharged,
```

- [ ] **Step 5: Update `selectShipForConfig` to auto-fill skills**

Replace the current `selectShipForConfig` function (lines 231–258):

```typescript
    const selectShipForConfig = (configId: string, ship: Ship) => {
        const engineeringStats = ship.type ? getEngineeringStatsForShipType(ship.type) : undefined;
        const statsBreakdown = calculateTotalStats(
            ship.baseStats,
            ship.equipment || {},
            getGearPiece,
            ship.refits,
            ship.implants,
            engineeringStats,
            ship.id
        );
        const final = statsBreakdown.final;
        const activeParsed = parseSkillDamage(ship.activeSkillText ?? '');
        const chargedParsed = parseSkillDamage(ship.chargeSkillText ?? '');
        const newAutoFilled = new Set<'activeMultiplier' | 'chargedMultiplier'>();
        setConfigs((prev) =>
            prev.map((c) => {
                if (c.id !== configId) return c;
                return {
                    ...c,
                    shipId: ship.id,
                    name: ship.name,
                    attack: Math.round(final.attack),
                    crit: Math.round(final.crit),
                    critDamage: Math.round(final.critDamage),
                    defensePenetration: Math.round(final.defensePenetration || 0),
                    activeMultiplier: activeParsed > 0 ? (newAutoFilled.add('activeMultiplier'), activeParsed) : c.activeMultiplier,
                    chargedMultiplier: chargedParsed > 0 ? (newAutoFilled.add('chargedMultiplier'), chargedParsed) : c.chargedMultiplier,
                    startCharged: detectFullyCharged([
                        ship.activeSkillText,
                        ship.chargeSkillText,
                        ship.firstPassiveSkillText,
                        ship.secondPassiveSkillText,
                        ship.thirdPassiveSkillText,
                    ]),
                    autoFilledFields: newAutoFilled,
                };
            })
        );
    };
```

- [ ] **Step 6: Clear `autoFilledFields` on manual edits of `activeMultiplier` / `chargedMultiplier`**

The existing `updateConfig` function (lines 213–229) handles field updates. Add clearing logic by replacing the function:

```typescript
    const updateConfig = (
        id: string,
        field:
            | 'name'
            | 'attack'
            | 'crit'
            | 'critDamage'
            | 'defensePenetration'
            | 'activeMultiplier'
            | 'chargedMultiplier'
            | 'chargeCount',
        value: string | number
    ) => {
        setConfigs((prev) =>
            prev.map((config) => {
                if (config.id !== id) return config;
                const updated = { ...config, [field]: value };
                if (field === 'activeMultiplier' || field === 'chargedMultiplier') {
                    const next = new Set(config.autoFilledFields);
                    next.delete(field);
                    updated.autoFilledFields = next;
                }
                return updated;
            })
        );
    };
```

- [ ] **Step 7: Add `isSkillRefOpen` state per config and the Start Charged checkbox + Skill Reference collapsible in the JSX**

Add a state map for skill reference panel open state near the other `useState` declarations (around line 140):

```typescript
    const [skillRefOpen, setSkillRefOpen] = useState<Set<string>>(new Set());
```

- [ ] **Step 8: Update the Skills section JSX**

Find the current Skills section (around lines 587–631):
```tsx
                                        {/* Skills section */}
                                        <div className="text-xs font-semibold text-primary uppercase tracking-wide mb-2">
                                            Skills
                                        </div>
                                        <div className="grid grid-cols-3 gap-4 mb-4">
                                            <Input
                                                label="Active (%)"
                                                ...
                                            />
                                            <Input
                                                label="Charged (%)"
                                                ...
                                            />
                                            <Input
                                                label="Charge Count"
                                                ...
                                            />
                                        </div>
```

Replace with:
```tsx
                                        {/* Skills section */}
                                        <div className="text-xs font-semibold text-primary uppercase tracking-wide mb-2">
                                            Skills
                                        </div>
                                        <div className="grid grid-cols-3 gap-4 mb-2">
                                            <Input
                                                label="Active (%)"
                                                type="number"
                                                min="0"
                                                value={config.activeMultiplier}
                                                helpLabel={config.autoFilledFields?.has('activeMultiplier') ? 'auto-filled' : undefined}
                                                onChange={(e) =>
                                                    updateConfig(
                                                        config.id,
                                                        'activeMultiplier',
                                                        parseInt(e.target.value) || 0
                                                    )
                                                }
                                            />
                                            <Input
                                                label="Charged (%)"
                                                type="number"
                                                min="0"
                                                value={config.chargedMultiplier}
                                                helpLabel={config.autoFilledFields?.has('chargedMultiplier') ? 'auto-filled' : undefined}
                                                onChange={(e) =>
                                                    updateConfig(
                                                        config.id,
                                                        'chargedMultiplier',
                                                        parseInt(e.target.value) || 0
                                                    )
                                                }
                                            />
                                            <Input
                                                label="Charge Count"
                                                type="number"
                                                min="0"
                                                value={config.chargeCount}
                                                onChange={(e) =>
                                                    updateConfig(
                                                        config.id,
                                                        'chargeCount',
                                                        parseInt(e.target.value) || 0
                                                    )
                                                }
                                            />
                                        </div>
                                        <div className="mb-4">
                                            <Checkbox
                                                label="Start Charged"
                                                checked={config.startCharged}
                                                onChange={(e) =>
                                                    setConfigs((prev) =>
                                                        prev.map((c) =>
                                                            c.id === config.id
                                                                ? { ...c, startCharged: e.target.checked }
                                                                : c
                                                        )
                                                    )
                                                }
                                            />
                                        </div>
                                        {config.shipId && (
                                            <>
                                                <Button
                                                    variant="link"
                                                    size="sm"
                                                    onClick={() =>
                                                        setSkillRefOpen((prev) => {
                                                            const next = new Set(prev);
                                                            if (next.has(config.id)) {
                                                                next.delete(config.id);
                                                            } else {
                                                                next.add(config.id);
                                                            }
                                                            return next;
                                                        })
                                                    }
                                                >
                                                    Skill Reference {skillRefOpen.has(config.id) ? '▴' : '▾'}
                                                </Button>
                                                <CollapsibleAccordion isOpen={skillRefOpen.has(config.id)}>
                                                    {(() => {
                                                        const ship = config.shipId ? getShipById(config.shipId) : undefined;
                                                        if (!ship) return null;
                                                        return (
                                                            <div className="space-y-3">
                                                                {ship.activeSkillText && (
                                                                    <SkillTooltip
                                                                        inline
                                                                        skillText={ship.activeSkillText}
                                                                        skillType="Active"
                                                                    />
                                                                )}
                                                                {ship.chargeSkillText && (
                                                                    <SkillTooltip
                                                                        inline
                                                                        skillText={ship.chargeSkillText}
                                                                        skillType={ship.chargeSkillCharge ? `Charge (${ship.chargeSkillCharge}T)` : 'Charge'}
                                                                        charge={ship.chargeSkillCharge}
                                                                    />
                                                                )}
                                                            </div>
                                                        );
                                                    })()}
                                                </CollapsibleAccordion>
                                            </>
                                        )}
```

Add the `SkillTooltip` import at the top of the file:
```typescript
import { SkillTooltip } from '../../components/ship/SkillTooltip';
```

- [ ] **Step 9: Run the full test suite and fix any TypeScript errors**

```bash
npm test
```

Expected: All tests PASS. If TypeScript errors appear about missing `startCharged` in `getInitialConfig` default configs, add `startCharged: false` to those objects.

- [ ] **Step 10: Commit**

```bash
git add src/pages/calculators/DPSCalculatorPage.tsx
git commit -m "feat: auto-fill skill multipliers and add Start Charged in DPS calculator"
```

---

## Task 7: Changelog and Documentation

**Files:**
- Modify: `src/constants/changelog.ts`
- Modify: `src/pages/DocumentationPage.tsx`

- [ ] **Step 1: Add entry to `UNRELEASED_CHANGES` in `src/constants/changelog.ts`**

The array starts at line 8. Add a new entry:
```typescript
    'Ship skills are now shown on the Ship Details page. The DPS Calculator auto-fills skill damage multipliers and detects "Start Charged" state from your selected ship\'s skill data.',
```

- [ ] **Step 2: Update `DocumentationPage.tsx` to document the new features**

Search for the ships or DPS calculator section in `DocumentationPage.tsx` and add brief descriptions of:
1. The Skills card on the Ship Details page
2. DPS Calculator auto-fill from skill text (and the "of its STAT" limitation)
3. The Start Charged checkbox

- [ ] **Step 3: Run the full test suite one final time**

```bash
npm test
```

Expected: All tests PASS

- [ ] **Step 4: Final commit**

```bash
git add src/constants/changelog.ts src/pages/DocumentationPage.tsx
git commit -m "docs: update changelog and documentation for ship skills integration"
```

---

## Verification Checklist

After all tasks, verify the following manually in the browser (`npm start`):

- [ ] Ship Details page shows a Skills card with correctly labelled rows and formatted skill text
- [ ] Selecting a ship in the DPS Calculator auto-populates Active/Charged multipliers with "(auto-filled)" hint
- [ ] Start Charged checkbox is checked for ships with "fully charged" in passive skills
- [ ] Manually editing a multiplier removes the "(auto-filled)" hint
- [ ] Skill Reference panel opens/closes and shows active + charge skill text
- [ ] Ships with no skill data: Ship Details shows no Skills card; DPS Calculator fields are unchanged on selection
