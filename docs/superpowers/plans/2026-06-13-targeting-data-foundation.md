# Targeting Data Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ingest the gathered ship target/pattern data into `ship_templates`, expose it as raw strings on the frontend `Ship` model, and build a tested parser that tokenizes the raw game strings into a structured model — no combat-engine changes.

**Architecture:** Raw game strings stored in four new nullable `ship_templates` columns (mirroring `*_skill_text`); a server-side populate script loads them from `docs/ship-targeting.csv`; a pure, dependency-free `targetingParser.ts` derives the structured model at runtime; empty charged columns mean "charged targets the same as active" and that inheritance is resolved in the parser, not the DB.

**Tech Stack:** TypeScript, Supabase (Postgres), Vitest, tsx scripts.

**Spec:** `docs/superpowers/specs/2026-06-13-targeting-data-foundation-design.md`

**Conventions to honor (from CLAUDE.md / project memory):**
- ESM project (`"type": "module"`). Scripts and tests run from the repo root, so relative paths like `'docs/ship-targeting.csv'` resolve correctly (same convention as `scripts/auditSkills.ts`).
- `docs/` is **gitignored** — the plan/spec are the only docs touched and were committed with `git add -f`. Source/test/migration/script files are NOT gitignored and commit normally.
- Service-role key (`SUPABASE_SERVICE_ROLE_KEY`) is **server-only** — only in `scripts/`. Never a `VITE_` var.
- Pre-commit hook runs the **full** vitest suite. Let it run for code commits (it's the safety net). Only docs-only commits use `--no-verify`.
- `gh auth switch --hostname github.com --user TheSusort` before any PR/merge op.

---

## Branch setup (do first)

This is one PR's worth of work. Do NOT work on `main`.

- [ ] **Create the feature branch**

```bash
cd /Users/kennethsusort/PersonalProjects/starborne-frontiers-calculator
git checkout main && git pull --ff-only
git checkout -b feat/targeting-data-foundation
```

---

## File Structure

| File | Responsibility |
|------|----------------|
| `supabase/migrations/20260613000001_add_targeting_to_ship_templates.sql` | NEW — add 4 nullable text columns to `ship_templates` |
| `src/utils/targetingParser.ts` | NEW — types + pure tokenizing parser (target axis, pattern axis, per-skill, per-ship with charged inheritance) |
| `src/utils/__tests__/targetingParser.test.ts` | NEW — per-token unit tests, charged-inheritance tests, corpus coverage test |
| `src/types/ship.ts` | MODIFY — add 4 optional raw-string fields to `Ship` and `ShipData` |
| `src/hooks/useShipsData.ts` | MODIFY — extend local `ShipTemplate` interface + `transformShipTemplate` |
| `src/services/shipTemplateProposalService.ts` | MODIFY — extend its `ShipTemplate` interface (keep table shape accurate) |
| `scripts/populate-ship-targeting.ts` | NEW — CSV → `ship_templates` (service role), dry-run + unmatched report |
| `package.json` | MODIFY — add `populate-targeting` script |

---

## Task 1: Database migration

**Files:**
- Create: `supabase/migrations/20260613000001_add_targeting_to_ship_templates.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Add ship targeting/pattern data to ship_templates.
-- Verbatim game strings (parsed at runtime by src/utils/targetingParser.ts).
-- Charged columns are an OVERRIDE: empty means "charged targets the same as active".
ALTER TABLE public.ship_templates
  ADD COLUMN IF NOT EXISTS active_target   text,
  ADD COLUMN IF NOT EXISTS active_pattern  text,
  ADD COLUMN IF NOT EXISTS charged_target  text,
  ADD COLUMN IF NOT EXISTS charged_pattern text;
```

- [ ] **Step 2: Sanity-check the SQL**

No RLS change needed (existing, already-policied table). Confirm column names use the
`charged_` prefix for targeting (matches the gathered CSV) even though the existing
skill column uses `charge_` — this divergence is intentional and documented in the spec.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260613000001_add_targeting_to_ship_templates.sql
git commit -m "feat(db): add targeting/pattern columns to ship_templates"
```

> **Note:** the migration is applied to Supabase by the maintainer via the Supabase
> CLI/dashboard (per CLAUDE.md "Database Migrations"). The frontend `select('*')`
> automatically picks up the new columns once applied; no code depends on them being
> populated to compile or pass tests.

---

## Task 2: Parser — types + target axis (TDD)

**Files:**
- Create: `src/utils/targetingParser.ts`
- Test: `src/utils/__tests__/targetingParser.test.ts`

- [ ] **Step 1: Write the failing test for `parseTarget`**

Create `src/utils/__tests__/targetingParser.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseTarget } from '../targetingParser';

describe('parseTarget', () => {
    it('maps enemy-side selections', () => {
        expect(parseTarget('front')).toEqual({ raw: 'front', side: 'enemy', selection: 'front' });
        expect(parseTarget('back')).toEqual({ raw: 'back', side: 'enemy', selection: 'back' });
        expect(parseTarget('skip')).toEqual({ raw: 'skip', side: 'enemy', selection: 'skip' });
        expect(parseTarget('all')).toEqual({ raw: 'all', side: 'enemy', selection: 'all' });
    });

    it('maps ally-side selections', () => {
        expect(parseTarget('allies')).toEqual({ raw: 'allies', side: 'ally', selection: 'team' });
        expect(parseTarget('all-allies')).toEqual({ raw: 'all-allies', side: 'ally', selection: 'all' });
        expect(parseTarget('other-allies')).toEqual({ raw: 'other-allies', side: 'ally', selection: 'others' });
        expect(parseTarget('self')).toEqual({ raw: 'self', side: 'ally', selection: 'self' });
    });

    it('is case/whitespace tolerant', () => {
        expect(parseTarget('  Front ')).toMatchObject({ side: 'enemy', selection: 'front' });
    });

    it('throws on unknown target', () => {
        expect(() => parseTarget('sideways')).toThrow(/unknown target/i);
    });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npx vitest run src/utils/__tests__/targetingParser.test.ts`
Expected: FAIL — cannot import `parseTarget` (module/file does not exist).

- [ ] **Step 3: Implement types + `parseTarget`**

Create `src/utils/targetingParser.ts`:

```ts
import { Ship } from '../types/ship';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TargetSide = 'enemy' | 'ally';
export type TargetSelection =
    | 'front'
    | 'back'
    | 'skip'
    | 'all'
    | 'team'
    | 'others'
    | 'self';

export interface ParsedTarget {
    raw: string;
    side: TargetSide;
    selection: TargetSelection;
}

export type PatternShape =
    | 'base'
    | 'cone'
    | 'line'
    | 'cross'
    | 'curve'
    | 'circle'
    | 'backline'
    | 'root'
    | 'split'
    | 'burst'
    | 'scattershot'
    | 'wings'
    | 'range'
    | 'pickaxe'
    | 'all';

export interface PatternModifiers {
    support?: boolean;
    prolonged?: boolean;
    reverse?: boolean;
    notSelf?: boolean;
    fromCentre?: boolean;
    anchorMod?: 'back' | 'center' | 'forward';
}

export interface ParsedPattern {
    raw: string;
    shape: PatternShape;
    range: number | 'all' | 'lane';
    modifiers: PatternModifiers;
}

export interface SkillTargeting {
    target: ParsedTarget;
    pattern: ParsedPattern;
}

export interface ShipTargeting {
    active?: SkillTargeting;
    charged?: SkillTargeting;
}

// ---------------------------------------------------------------------------
// Target axis
// ---------------------------------------------------------------------------

const TARGET_MAP: Record<string, { side: TargetSide; selection: TargetSelection }> = {
    front: { side: 'enemy', selection: 'front' },
    back: { side: 'enemy', selection: 'back' },
    skip: { side: 'enemy', selection: 'skip' },
    all: { side: 'enemy', selection: 'all' },
    allies: { side: 'ally', selection: 'team' },
    'all-allies': { side: 'ally', selection: 'all' },
    'other-allies': { side: 'ally', selection: 'others' },
    self: { side: 'ally', selection: 'self' },
};

export function parseTarget(raw: string): ParsedTarget {
    const key = raw.trim().toLowerCase();
    const mapped = TARGET_MAP[key];
    if (!mapped) {
        throw new Error(`Unknown target value: "${raw}"`);
    }
    return { raw, side: mapped.side, selection: mapped.selection };
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `npx vitest run src/utils/__tests__/targetingParser.test.ts`
Expected: PASS (the `parseTarget` describe block).

- [ ] **Step 5: Commit**

```bash
git add src/utils/targetingParser.ts src/utils/__tests__/targetingParser.test.ts
git commit -m "feat(targeting): parser types + target-axis tokenizer"
```

---

## Task 3: Parser — pattern axis (TDD)

**Files:**
- Modify: `src/utils/targetingParser.ts`
- Test: `src/utils/__tests__/targetingParser.test.ts`

- [ ] **Step 1: Add the failing `parsePattern` tests**

Append to the test file (and add `parsePattern` to the import):

```ts
import { parsePattern } from '../targetingParser';

describe('parsePattern', () => {
    it('parses Pattern-Base as base / range 0', () => {
        expect(parsePattern('Pattern-Base')).toEqual({
            raw: 'Pattern-Base', shape: 'base', range: 0, modifiers: {},
        });
    });

    it('parses a numeric range', () => {
        expect(parsePattern('Pattern-Cone-Range-1')).toMatchObject({ shape: 'cone', range: 1, modifiers: {} });
        expect(parsePattern('Pattern-Line-Range-2')).toMatchObject({ shape: 'line', range: 2, modifiers: {} });
        expect(parsePattern('Pattern-Range-3')).toMatchObject({ shape: 'range', range: 3, modifiers: {} });
        expect(parsePattern('Pattern-Support-Double-Pickaxe-Range-0')).toMatchObject({ shape: 'pickaxe', range: 0 });
    });

    it('detects the support modifier (before or after the shape token)', () => {
        expect(parsePattern('Pattern-Circle-Support-Range-1').modifiers.support).toBe(true);
        expect(parsePattern('Pattern-Base-Support')).toMatchObject({ shape: 'base', range: 0, modifiers: { support: true } });
        expect(parsePattern('Pattern-Support-All')).toMatchObject({ shape: 'all', range: 'all', modifiers: { support: true } });
        expect(parsePattern('Pattern-All')).toMatchObject({ shape: 'all', range: 'all', modifiers: {} });
    });

    it('detects whole-lane range', () => {
        expect(parsePattern('Pattern-Line-Support-whole-lane')).toMatchObject({
            shape: 'line', range: 'lane', modifiers: { support: true },
        });
    });

    it('detects prolonged + anchor modifiers', () => {
        expect(parsePattern('Pattern-Prolonged_Cone-Support-Range-2')).toMatchObject({
            shape: 'cone', range: 2, modifiers: { prolonged: true, support: true },
        });
        expect(parsePattern('Pattern-Prolonged_Cone-Support-Center-Range-2').modifiers).toMatchObject({
            prolonged: true, support: true, anchorMod: 'center',
        });
        expect(parsePattern('Pattern-Cone-Back-Range-1').modifiers).toMatchObject({ anchorMod: 'back' });
        expect(parsePattern('Pattern-Support-Forward-Circle-Range-1')).toMatchObject({
            shape: 'circle', modifiers: { support: true, anchorMod: 'forward' },
        });
    });

    it('does NOT treat backline as an anchor "back"', () => {
        const p = parsePattern('Pattern-Backline-Range-1');
        expect(p.shape).toBe('backline');
        expect(p.modifiers.anchorMod).toBeUndefined();
    });

    it('detects reverse / notSelf / fromCentre', () => {
        expect(parsePattern('Pattern-Reverse-Curve-Range-1')).toMatchObject({ shape: 'curve', modifiers: { reverse: true } });
        expect(parsePattern('Pattern-Reverse-Cone-Range-1')).toMatchObject({ shape: 'cone', modifiers: { reverse: true } });
        expect(parsePattern('Pattern-Line-Support-Not-Self-Range-2').modifiers).toMatchObject({ support: true, notSelf: true });
        expect(parsePattern('Pattern-Wings-Support-Not-Self-Range-2')).toMatchObject({ shape: 'wings', modifiers: { support: true, notSelf: true } });
        expect(parsePattern('Pattern-Line-from-centre-Range-1').modifiers).toMatchObject({ fromCentre: true });
    });

    it('normalizes the "Patern" typo', () => {
        expect(parsePattern('Patern-Support-All')).toMatchObject({ shape: 'all', range: 'all', modifiers: { support: true } });
    });

    it('throws on an unrecognizable shape', () => {
        expect(() => parsePattern('Pattern-Nonsense-Range-1')).toThrow(/unknown pattern shape/i);
    });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npx vitest run src/utils/__tests__/targetingParser.test.ts -t parsePattern`
Expected: FAIL — `parsePattern` not exported.

- [ ] **Step 3: Implement `parsePattern`**

Append to `src/utils/targetingParser.ts`:

```ts
// ---------------------------------------------------------------------------
// Pattern axis
// ---------------------------------------------------------------------------

// Shape detection is presence-based (not positional) and ORDER-SENSITIVE:
// check 'backline' before any 'line'/'back' rule so it isn't mis-split.
function detectShape(lower: string): PatternShape {
    if (/backline/.test(lower)) return 'backline';
    if (/scattershot/.test(lower)) return 'scattershot';
    if (/pickaxe/.test(lower)) return 'pickaxe';
    if (/cone/.test(lower)) return 'cone';
    if (/cross/.test(lower)) return 'cross';
    if (/curve/.test(lower)) return 'curve';
    if (/circle/.test(lower)) return 'circle';
    if (/wings/.test(lower)) return 'wings';
    if (/root/.test(lower)) return 'root';
    if (/split/.test(lower)) return 'split';
    if (/burst/.test(lower)) return 'burst';
    if (/line/.test(lower)) return 'line';
    if (/base/.test(lower)) return 'base';
    // standalone "all" shape (Pattern-All, Pattern-Support-All) with no other shape token
    if (/(^|-)all($|-)/.test(lower)) return 'all';
    // pure range shape (Pattern-Range-N) with no other shape token
    if (/range-\d+/.test(lower)) return 'range';
    throw new Error(`Unknown pattern shape in: "${lower}"`);
}

export function parsePattern(raw: string): ParsedPattern {
    // Normalize: fix the "Patern" typo, turn "Prolonged_Cone" into "Prolonged-Cone".
    const normalized = raw
        .trim()
        .replace(/^Patern-/i, 'Pattern-')
        .replace(/_/g, '-');
    const body = normalized.replace(/^Pattern-/i, '');
    const lower = body.toLowerCase();

    const modifiers: PatternModifiers = {};
    if (/(^|-)support(-|$)/.test(lower)) modifiers.support = true;
    if (/(^|-)prolonged(-|$)/.test(lower)) modifiers.prolonged = true;
    if (/(^|-)reverse(-|$)/.test(lower)) modifiers.reverse = true;
    if (/not-self/.test(lower)) modifiers.notSelf = true;
    if (/from-centre/.test(lower)) modifiers.fromCentre = true;
    // anchor modifier (mutually exclusive); 'back' must not fire on 'backline'
    if (/(^|-)back(-|$)/.test(lower)) modifiers.anchorMod = 'back';
    else if (/(^|-)center(-|$)/.test(lower)) modifiers.anchorMod = 'center';
    else if (/(^|-)forward(-|$)/.test(lower)) modifiers.anchorMod = 'forward';

    let range: number | 'all' | 'lane';
    const rangeMatch = lower.match(/range-(\d+)/);
    if (rangeMatch) {
        range = parseInt(rangeMatch[1], 10);
    } else if (/whole-lane/.test(lower)) {
        range = 'lane';
    } else if (/(^|-)all($|-)/.test(lower)) {
        range = 'all';
    } else {
        // Pattern-Base / Pattern-Base-Support — no range token, point-blank.
        range = 0;
    }

    return { raw, shape: detectShape(lower), range, modifiers };
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `npx vitest run src/utils/__tests__/targetingParser.test.ts`
Expected: PASS (parseTarget + parsePattern blocks).

- [ ] **Step 5: Commit**

```bash
git add src/utils/targetingParser.ts src/utils/__tests__/targetingParser.test.ts
git commit -m "feat(targeting): pattern-axis tokenizer"
```

---

## Task 4: Parser — per-skill + per-ship with charged inheritance (TDD)

**Files:**
- Modify: `src/utils/targetingParser.ts`
- Modify: `src/types/ship.ts` (needed for the `parseShipTargeting` Pick type to compile — add the fields here)
- Test: `src/utils/__tests__/targetingParser.test.ts`

> The `Ship` type fields are added in this task because `parseShipTargeting` references
> them via `Pick<Ship, ...>`. The plumbing that *populates* those fields is Task 6.

- [ ] **Step 1: Add the raw-string fields to the `Ship` and `ShipData` interfaces**

In `src/types/ship.ts`, after `thirdPassiveSkillText?: string;` in BOTH the `Ship`
interface (around line 28) and the `ShipData` interface (around line 78), add:

```ts
    activeTarget?: string;
    activePattern?: string;
    chargedTarget?: string;
    chargedPattern?: string;
```

- [ ] **Step 2: Write the failing tests for the per-skill + per-ship functions**

Append to the test file (add the imports):

```ts
import { parseSkillTargeting, parseShipTargeting } from '../targetingParser';

describe('parseSkillTargeting', () => {
    it('combines target + pattern', () => {
        expect(parseSkillTargeting('front', 'Pattern-Cone-Range-1')).toEqual({
            target: { raw: 'front', side: 'enemy', selection: 'front' },
            pattern: { raw: 'Pattern-Cone-Range-1', shape: 'cone', range: 1, modifiers: {} },
        });
    });
});

describe('parseShipTargeting — charged inheritance', () => {
    const base = {
        activeTarget: 'front',
        activePattern: 'Pattern-Line-Range-1',
        chargedTarget: undefined,
        chargedPattern: undefined,
        chargeSkillCharge: undefined,
    };

    it('parses active when present', () => {
        const r = parseShipTargeting({ ...base });
        expect(r.active).toMatchObject({ target: { selection: 'front' }, pattern: { shape: 'line' } });
    });

    it('inherits active when charged is empty AND the ship has a charged skill', () => {
        const r = parseShipTargeting({ ...base, chargeSkillCharge: 4 });
        expect(r.charged).toEqual(r.active);
    });

    it('uses the explicit charged override when present', () => {
        const r = parseShipTargeting({
            ...base,
            chargeSkillCharge: 4,
            chargedTarget: 'front',
            chargedPattern: 'Pattern-Cone-Range-1',
        });
        expect(r.charged?.pattern.shape).toBe('cone');
        expect(r.charged).not.toEqual(r.active);
    });

    it('leaves charged undefined when there is no charged skill', () => {
        const r = parseShipTargeting({ ...base, chargeSkillCharge: undefined });
        expect(r.charged).toBeUndefined();
    });

    it('returns empty object when there is no active targeting', () => {
        const r = parseShipTargeting({
            activeTarget: undefined,
            activePattern: undefined,
            chargedTarget: undefined,
            chargedPattern: undefined,
            chargeSkillCharge: 4,
        });
        expect(r.active).toBeUndefined();
        expect(r.charged).toBeUndefined();
    });
});
```

- [ ] **Step 3: Run the test, verify it fails**

Run: `npx vitest run src/utils/__tests__/targetingParser.test.ts -t inheritance`
Expected: FAIL — `parseSkillTargeting` / `parseShipTargeting` not exported.

- [ ] **Step 4: Implement the two functions**

Append to `src/utils/targetingParser.ts`:

```ts
// ---------------------------------------------------------------------------
// Per-skill and per-ship
// ---------------------------------------------------------------------------

export function parseSkillTargeting(target: string, pattern: string): SkillTargeting {
    return { target: parseTarget(target), pattern: parsePattern(pattern) };
}

export function parseShipTargeting(
    ship: Pick<
        Ship,
        'activeTarget' | 'activePattern' | 'chargedTarget' | 'chargedPattern' | 'chargeSkillCharge'
    >
): ShipTargeting {
    const result: ShipTargeting = {};

    if (ship.activeTarget && ship.activePattern) {
        result.active = parseSkillTargeting(ship.activeTarget, ship.activePattern);
    }

    if (ship.chargedTarget && ship.chargedPattern) {
        // Explicit override (charged differs from active).
        result.charged = parseSkillTargeting(ship.chargedTarget, ship.chargedPattern);
    } else if (result.active && ship.chargeSkillCharge != null) {
        // Empty charged columns mean "charged targets the same as active"; only
        // inherit when the ship actually has a charged skill.
        result.charged = result.active;
    }

    return result;
}
```

- [ ] **Step 5: Run the test, verify it passes**

Run: `npx vitest run src/utils/__tests__/targetingParser.test.ts`
Expected: PASS (all four describe blocks).

- [ ] **Step 6: Type-check (the new `Ship` fields + Pick must compile)**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/utils/targetingParser.ts src/utils/__tests__/targetingParser.test.ts src/types/ship.ts
git commit -m "feat(targeting): per-skill + per-ship parse with charged inheritance"
```

---

## Task 5: Corpus coverage test

Proves the whole gathered vocabulary tokenizes with no `unknown` and no throw.

**Files:**
- Test: `src/utils/__tests__/targetingParser.test.ts`

- [ ] **Step 1: Add the corpus test**

Append to the test file (add `existsSync`/`readFileSync` imports at the top):

```ts
import { existsSync, readFileSync } from 'fs';

// docs/ is gitignored (dev-machine-local reference data). Skip cleanly if absent.
const CSV_PATH = 'docs/ship-targeting.csv';
const csvAvailable = existsSync(CSV_PATH);

describe.skipIf(!csvAvailable)('ship-targeting.csv corpus coverage', () => {
    const rows = readFileSync(CSV_PATH, 'utf8')
        .split(/\r?\n/)
        .filter((l) => l.trim().length > 0)
        .slice(1) // drop header
        .map((line) => {
            const [name, activeTarget, activePattern, chargedTarget, chargedPattern] =
                line.split(',');
            return {
                name: name.trim(),
                activeTarget: (activeTarget ?? '').trim(),
                activePattern: (activePattern ?? '').trim(),
                chargedTarget: (chargedTarget ?? '').trim(),
                chargedPattern: (chargedPattern ?? '').trim(),
            };
        });

    it('has rows to test', () => {
        expect(rows.length).toBeGreaterThan(100);
    });

    it('every active target+pattern tokenizes with no unknown / no throw', () => {
        for (const row of rows) {
            expect(
                () => parseSkillTargeting(row.activeTarget, row.activePattern),
                `active for ${row.name}: "${row.activeTarget}" / "${row.activePattern}"`
            ).not.toThrow();
        }
    });

    it('every explicit charged target+pattern tokenizes with no unknown / no throw', () => {
        for (const row of rows) {
            if (row.chargedTarget && row.chargedPattern) {
                expect(
                    () => parseSkillTargeting(row.chargedTarget, row.chargedPattern),
                    `charged for ${row.name}: "${row.chargedTarget}" / "${row.chargedPattern}"`
                ).not.toThrow();
            }
        }
    });
});
```

- [ ] **Step 2: Run the corpus test, verify it passes**

Run: `npx vitest run src/utils/__tests__/targetingParser.test.ts -t corpus`
Expected: PASS. If any row throws, the failure message names the ship and the raw
values — fix `targetingParser.ts` (a missing shape/modifier) until green. This is the
coverage gate from the spec.

- [ ] **Step 3: Run the full parser test file once more**

Run: `npx vitest run src/utils/__tests__/targetingParser.test.ts`
Expected: ALL PASS.

- [ ] **Step 4: Commit**

```bash
git add src/utils/__tests__/targetingParser.test.ts
git commit -m "test(targeting): corpus coverage gate over ship-targeting.csv"
```

---

## Task 6: Frontend plumbing (template → Ship)

Thread the raw strings from `ship_templates` onto the `Ship` model. `Ship`/`ShipData`
fields were already added in Task 4; this task wires the template fetch + transform.

**Files:**
- Modify: `src/hooks/useShipsData.ts` (`ShipTemplate` interface ~lines 5–35, `transformShipTemplate` ~lines 37–72)
- Modify: `src/services/shipTemplateProposalService.ts` (`ShipTemplate` interface ~lines 22–55)

- [ ] **Step 1: Extend the `ShipTemplate` interface in `useShipsData.ts`**

After `third_passive_skill_text?: string;` (around line 18) add:

```ts
    active_target?: string;
    active_pattern?: string;
    charged_target?: string;
    charged_pattern?: string;
```

- [ ] **Step 2: Map the columns in `transformShipTemplate`**

After `thirdPassiveSkillText: template.third_passive_skill_text,` (around line 68) add:

```ts
    activeTarget: template.active_target,
    activePattern: template.active_pattern,
    chargedTarget: template.charged_target,
    chargedPattern: template.charged_pattern,
```

- [ ] **Step 3: Extend the `ShipTemplate` interface in `shipTemplateProposalService.ts`**

After `third_passive_skill_text: string | null;` (around line 35) add:

```ts
    active_target?: string | null;
    active_pattern?: string | null;
    charged_target?: string | null;
    charged_pattern?: string | null;
```

(No change to the proposal insert/upsert paths — targeting is not proposal-driven; this
just keeps the interface accurate to the table shape.)

- [ ] **Step 4: Type-check + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors, 0 warnings.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useShipsData.ts src/services/shipTemplateProposalService.ts
git commit -m "feat(targeting): plumb targeting columns onto the Ship model"
```

---

## Task 7: Populate script

Loads the CSV into `ship_templates` using the service role; dry-run + unmatched report.

**Files:**
- Create: `scripts/populate-ship-targeting.ts`
- Modify: `package.json` (add the npm script)

- [ ] **Step 1: Write the script**

Create `scripts/populate-ship-targeting.ts`:

```ts
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const DRY_RUN = process.env.DRY_RUN === 'true' || process.argv.includes('--dry-run');
const CSV_PATH = 'docs/ship-targeting.csv';

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
    console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

interface Row {
    name: string;
    active_target: string | null;
    active_pattern: string | null;
    charged_target: string | null;
    charged_pattern: string | null;
}

const parseCsv = (): Row[] => {
    const lines = readFileSync(CSV_PATH, 'utf8')
        .split(/\r?\n/)
        .filter((l) => l.trim().length > 0);
    const rows: Row[] = [];
    for (let i = 1; i < lines.length; i++) {
        const [name, at, ap, ct, cp] = lines[i].split(',');
        const norm = (v?: string) => {
            const t = (v ?? '').trim();
            return t.length ? t : null;
        };
        rows.push({
            name: (name ?? '').trim(),
            active_target: norm(at),
            active_pattern: norm(ap),
            charged_target: norm(ct),
            charged_pattern: norm(cp),
        });
    }
    return rows;
};

const main = async () => {
    const rows = parseCsv();

    const { data: templates, error } = await supabase
        .from('ship_templates')
        .select('id, name');
    if (error || !templates) {
        console.error('Failed to fetch ship_templates:', error?.message);
        process.exit(1);
    }

    const byName = new Map<string, { id: string; name: string }>();
    for (const t of templates) byName.set(t.name.toLowerCase(), t);

    const unmatchedCsv: string[] = [];
    const matched = new Set<string>();
    let updated = 0;

    for (const row of rows) {
        const tmpl = byName.get(row.name.toLowerCase());
        if (!tmpl) {
            unmatchedCsv.push(row.name);
            continue;
        }
        matched.add(tmpl.name.toLowerCase());

        const payload = {
            active_target: row.active_target,
            active_pattern: row.active_pattern,
            charged_target: row.charged_target,
            charged_pattern: row.charged_pattern,
        };

        if (DRY_RUN) {
            console.log(`[dry-run] ${tmpl.name}:`, JSON.stringify(payload));
            updated++;
            continue;
        }

        const { error: upErr } = await supabase
            .from('ship_templates')
            .update(payload)
            .eq('id', tmpl.id);
        if (upErr) {
            console.error(`Failed to update ${tmpl.name}:`, upErr.message);
            continue;
        }
        updated++;
    }

    const unmatchedTemplates = templates
        .filter((t) => !matched.has(t.name.toLowerCase()))
        .map((t) => t.name)
        .sort();

    console.log(`\n${DRY_RUN ? '[DRY RUN] ' : ''}Processed ${updated}/${rows.length} CSV rows.`);
    if (unmatchedCsv.length) {
        console.warn(
            `\nCSV names with NO matching template (${unmatchedCsv.length}):\n  ${unmatchedCsv.join('\n  ')}`
        );
    }
    if (unmatchedTemplates.length) {
        console.warn(
            `\nTemplates with NO CSV targeting row (${unmatchedTemplates.length}):\n  ${unmatchedTemplates.join('\n  ')}`
        );
    }
};

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
```

- [ ] **Step 2: Add the npm script**

In `package.json` `scripts`, next to `"admin:import"`, add:

```json
        "populate-targeting": "tsx scripts/populate-ship-targeting.ts",
```

- [ ] **Step 3: Type-check the script**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Dry-run (maintainer, needs `.env` with service role key)**

Run: `npm run populate-targeting -- --dry-run`
Expected: prints per-ship payloads, ends with `Processed N/147 CSV rows.` and ideally
`0` unmatched in both directions. Investigate any unmatched names before the real run.

- [ ] **Step 5: Commit**

```bash
git add scripts/populate-ship-targeting.ts package.json
git commit -m "feat(targeting): populate script for ship_templates targeting columns"
```

---

## Final verification

- [ ] **Run the full suite + lint + types**

```bash
npx vitest run && npm run lint && npx tsc --noEmit
```
Expected: all tests pass (existing suite unchanged + new parser tests), 0 lint warnings, no type errors.

- [ ] **Apply the migration** (maintainer, Supabase CLI/dashboard) and **run the real populate**:

```bash
# after migration is applied:
npm run populate-targeting -- --dry-run   # confirm 0 unmatched
npm run populate-targeting                 # write
```

- [ ] **Changelog** — this is a data/infrastructure foundation with no user-visible
  behaviour change, so **no** `UNRELEASED_CHANGES` entry is needed (per the changelog
  rule: skip internal tooling / non-user-facing changes). If the maintainer disagrees,
  add a one-liner under `src/constants/changelog.ts`.

- [ ] **Open the PR** (`gh auth switch --hostname github.com --user TheSusort` first).

---

## Success criteria (from spec)

- Migration adds the 4 nullable columns.
- Populate dry-run reports 0 unmatched (or the few are resolved).
- Corpus test green across all 147 ships (every active + explicit charged value
  tokenizes with no `unknown` and no throw).
- Raw targeting strings reach the frontend `Ship` model.
- Existing test suite unchanged; `lint` + `tsc` clean.

## Out of scope (later phases)

Cell geometry (`resolveCells`), engine target-resolution, AoE application, UI/visualizer.
