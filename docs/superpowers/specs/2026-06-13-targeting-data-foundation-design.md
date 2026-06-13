# Targeting Data Foundation — Design

**Date:** 2026-06-13
**Status:** Approved (design), pending spec review
**Phase:** Combat engine — targeting prerequisite (data layer only)

## Context

The combat engine's targeting is deliberately degenerate today (single-target
focus-fire vs the configured heal target). The full positional model — 3×4 hex
board, front/back/skip target anchoring, AoE/pattern spread — was the deferred
"4d" work, blocked on two missing pieces of game data:

1. **Who each skill targets** (`front` / `back` / `skip` / `allies` / `self` / `all` / …)
2. **The spread pattern** (`Cone-Range-1`, `Line-Range-2`, `Backline-Range-1`, …)

Both have now been hand-gathered into `docs/ship-targeting.csv` (147 ships,
columns: `name, active_target, active_pattern, charged_target, charged_pattern`).
The 3×4 hex board already exists in the encounter-notes feature
(`src/types/encounters.ts` `Position` = `T1–T4` / `M1–M4` / `B1–B4`,
rendered by `src/components/encounters/FormationGrid.tsx`).

This phase is **scoped to the data foundation only**: ingest the data, expose it
on the frontend `Ship` model, and build a tested parser that tokenizes the raw
game strings into a structured model. **No combat-engine changes.** The positional
engine that consumes this model is a later phase.

## Goal

Make the targeting/pattern data available as a clean, validated, structured model
so the later positional-engine phase has a ready contract to build on — without
guessing at board geometry now.

## Non-goals (explicitly later phases)

- Cell geometry: `resolveCells(model, anchor) → Position[]` (which exact hexes a
  shape covers). This is the genuinely hard part that needs exact game-truth and
  is the engine phase's concern.
- Engine target-resolution / replacing single-target focus-fire.
- AoE / pattern application during combat.
- Any UI, board visualizer, or simulator-page work.

## Approach

Decisions locked during brainstorming:

- **Storage = raw strings, parse at runtime.** Mirrors how `*_skill_text` is
  stored and `skillTextParser` derives abilities. DB stays simple; the parser can
  evolve with no migration; data-quality fixes live in the parser, not the data.
- **Model depth = tokenize only.** The parser decomposes each string into a typed
  model and validates the whole corpus parses; it does not compute board cells.

## Design

### 1. Database (Supabase)

Migration `supabase/migrations/YYYYMMDD_add_targeting_to_ship_templates.sql` adds
four **nullable text columns** to `ship_templates`, holding verbatim game strings:

```sql
ALTER TABLE public.ship_templates
  ADD COLUMN IF NOT EXISTS active_target   text,
  ADD COLUMN IF NOT EXISTS active_pattern  text,
  ADD COLUMN IF NOT EXISTS charged_target  text,
  ADD COLUMN IF NOT EXISTS charged_pattern text;
```

- No RLS changes — `ship_templates` is an existing, already-policied table.
- **Charged columns are an OVERRIDE, not a full value.** The gathered data only
  fills `charged_target` / `charged_pattern` when the charged skill's targeting
  **differs** from the active skill's. An empty charged column therefore means
  "the charged skill targets the same as the active skill" (inheritance) — **not**
  "no charged targeting." We store the data verbatim (empty = inherit); the
  inheritance is resolved at parse time (see §4), so the DB stays minimal and
  matches the maintainer's intent. The populate script does **not** back-fill.
- Naming follows the existing `active_skill_text` / `charge_skill_text` convention.

### 2. Populate script

`scripts/populate-ship-targeting.ts` — server-side, uses
`SUPABASE_SERVICE_ROLE_KEY` (never a `VITE_` var, per the security rules; same key
pattern as `scripts/admin-import.ts` and `scripts/update-ship-skills.ts`).

Behaviour:

- Reads `docs/ship-targeting.csv`.
- Matches each row to a `ship_templates` row by **case-insensitive `name`**.
- Updates the four columns for matched rows.
- `--dry-run` flag: report what would change without writing.
- **Reports unmatched names in both directions** (CSV rows with no template,
  templates with no CSV row) so drift is caught before writing.

The maintainer (Kenneth) runs this; it needs the service-role key, exactly like
`npm run admin:import`. Name-match has been pre-verified: all 147 CSV names match
the canonical template names (the generated `docs/ship-skills.csv` derives from
`ship_templates.name`, and the targeting names are a subset of it with zero
mismatches).

### 3. Frontend plumbing

`supabase.from('ship_templates').select('*')` already pulls the new columns, so
the only code changes thread them into the typed model:

- `src/types/ship.ts` — add four optional raw-string fields to `Ship` (and the
  sibling interface in the same file): `activeTarget`, `activePattern`,
  `chargedTarget`, `chargedPattern`.
- `src/hooks/useShipsData.ts` — extend the local `ShipTemplate` interface with the
  four snake_case columns and map them in `transformShipTemplate`.
- `src/services/shipTemplateProposalService.ts` — extend its `ShipTemplate`
  interface with the four columns (kept in sync with the table shape).

These are raw strings only — no parsing in the plumbing layer.

### 4. The parser — `src/utils/targetingParser.ts` (new)

Pure, dependency-free, alongside `src/utils/skillTextParser.ts`. Tokenizes the two
axes into a structured model.

```ts
// ---- TARGET axis ----
export type TargetSide = 'enemy' | 'ally';
export type TargetSelection =
  | 'front' | 'back' | 'skip' | 'all'   // enemy-side selections
  | 'team' | 'others' | 'self';         // ally-side selections

export interface ParsedTarget {
  raw: string;
  side: TargetSide;
  selection: TargetSelection;
}

// Mapping (raw → side/selection):
//   front        → enemy / front
//   back         → enemy / back
//   skip         → enemy / skip
//   all          → enemy / all
//   allies       → ally  / team      (pattern-scoped allies)
//   all-allies   → ally  / all       (entire friendly team)
//   other-allies → ally  / others    (team minus self)
//   self         → ally  / self

// ---- PATTERN axis ----
export type PatternShape =
  | 'base' | 'cone' | 'line' | 'cross' | 'curve' | 'circle' | 'backline'
  | 'root' | 'split' | 'burst' | 'scattershot' | 'wings' | 'range'
  | 'pickaxe' | 'all';

export interface PatternModifiers {
  support?: boolean;     // "-Support-" / "Support-All" / "Base-Support"
  prolonged?: boolean;   // "Prolonged_Cone"
  reverse?: boolean;     // "Reverse-Curve" / "Reverse-Cone"
  notSelf?: boolean;     // "Not-Self"
  fromCentre?: boolean;  // "Line-from-centre"
  anchorMod?: 'back' | 'center' | 'forward'; // Cone-Back / …-Center / Support-Forward-Circle
}

export interface ParsedPattern {
  raw: string;
  shape: PatternShape;
  range: number | 'all' | 'lane'; // numeric 0–3; 'all' (Pattern-All/Support-All); 'lane' (whole-lane)
  modifiers: PatternModifiers;
}

// ---- combined ----
export interface SkillTargeting { target: ParsedTarget; pattern: ParsedPattern; }
export interface ShipTargeting { active?: SkillTargeting; charged?: SkillTargeting; }

export function parseTarget(raw: string): ParsedTarget;
export function parsePattern(raw: string): ParsedPattern;
export function parseSkillTargeting(target: string, pattern: string): SkillTargeting;
export function parseShipTargeting(ship: Pick<Ship,
  'activeTarget' | 'activePattern' | 'chargedTarget' | 'chargedPattern' | 'chargeSkillCharge'>): ShipTargeting;
```

**Charged-targeting inheritance (resolved here, not in the DB).** Because empty
charged columns mean "same as active", `parseShipTargeting` resolves charged as
follows:

- `active` = `parseSkillTargeting(activeTarget, activePattern)` when both are
  present, else `undefined`.
- `charged`:
  - If **both** `chargedTarget` and `chargedPattern` are present → parse them
    (an explicit override).
  - Else if the ship **has a charged skill** (`chargeSkillCharge != null`) and
    `active` is defined → `charged` **inherits** `active` (a structural copy of the
    active `SkillTargeting`).
  - Else → `undefined` (no charged skill, or no active to inherit from).

This means a consumer never has to special-case "empty = same as active"; the
model already carries the resolved charged targeting. The gate on
`chargeSkillCharge` prevents fabricating charged targeting for ships that have no
charged skill at all. `parseSkillTargeting` itself stays pure (one skill, no
inheritance) so it is independently testable.

**Grammar handled** (loosely — modifiers are order-flexible, so the parser should
detect tokens by presence, **not** by fixed position):
`Pattern-[Prolonged_]<Shape>[-Support][-Back|-Center|-Forward|-Not-Self|-from-centre|-Double-Pickaxe]-Range-<N|whole-lane>`,
plus the standalone forms `Pattern-All`, `Pattern-Support-All`, `Pattern-Base-Support`.

**Important:** `Support` and the anchor token can appear *before* the shape, not
just after it — e.g. `Pattern-Support-Double-Pickaxe-Range-0`,
`Pattern-Support-Forward-Circle-Range-1`, `Pattern-Support-All`. The parser must
**not** assume `<Shape>` precedes `-Support`. Implement it as: normalize → strip
the `Pattern-` prefix → pull out the `Range-N` / `whole-lane` suffix → detect each
modifier token by presence anywhere in the remainder → the surviving token is the
shape. Also do not assume `Prolonged_Cone` always carries an anchor (AEGIS's
`Pattern-Prolonged_Cone-Support-Range-2` has none; Sentinel's `…-Center-…` does).

**Token → model mapping for the irregular cases:**

| Raw pattern (example)                          | shape        | range  | modifiers                         |
|------------------------------------------------|--------------|--------|-----------------------------------|
| `Pattern-Base`                                 | `base`       | `0`    | —                                 |
| `Pattern-Base-Support` (Meatshield)            | `base`       | `0`    | `support`                         |
| `Pattern-Cone-Range-1`                         | `cone`       | `1`    | —                                 |
| `Pattern-Cone-Back-Range-1` (APEX)             | `cone`       | `1`    | `anchorMod:'back'`                |
| `Pattern-Prolonged_Cone-Support-Center-Range-2`| `cone`       | `2`    | `prolonged, support, anchorMod:'center'` |
| `Pattern-Reverse-Cone-Range-1` (Pestilence chg)| `cone`       | `1`    | `reverse`                         |
| `Pattern-Line-from-centre-Range-1`             | `line`       | `1`    | `fromCentre`                      |
| `Pattern-Line-Support-whole-lane`              | `line`       | `lane` | `support`                         |
| `Pattern-Line-Support-Not-Self-Range-2` (Mender)| `line`      | `2`    | `support, notSelf`                |
| `Pattern-Reverse-Curve-Range-1` (Sansi)        | `curve`      | `1`    | `reverse`                         |
| `Pattern-Range-3` (Incinerator/Ripper)         | `range`      | `3`    | —                                 |
| `Pattern-Support-Forward-Circle-Range-1` (Howler)| `circle`   | `1`    | `support, anchorMod:'forward'`    |
| `Pattern-Support-Double-Pickaxe-Range-0` (Graphite)| `pickaxe`| `0`    | `support`                         |
| `Pattern-Wings-Support-Not-Self-Range-2` (Purifier)| `wings`  | `2`    | `support, notSelf`                |
| `Pattern-All` (Curator)                        | `all`        | `all`  | —                                 |
| `Pattern-Support-All` (Chimei/Hayyan)          | `all`        | `all`  | `support`                         |

**Data-quality normalization (in the parser, before tokenizing):**

- `Patern` → `Pattern` (Grif's `Patern-Support-All` typo).
- `Prolonged_Cone` underscore handled by the `Prolonged_` prefix rule.
- `Range-0` is valid (numeric 0).
- `whole-lane` → `range:'lane'`.

### 5. Tests (TDD)

`src/utils/__tests__/targetingParser.test.ts`:

- **Per-token unit tests** — each of the 8 target values; each shape; each
  modifier (support, prolonged, reverse, notSelf, fromCentre, anchorMod variants);
  range numeric / `all` / `lane`.
- **Charged-inheritance tests** for `parseShipTargeting`: (a) empty charged +
  `chargeSkillCharge != null` → `charged` deep-equals `active`; (b) explicit
  charged override → `charged` reflects the override, not active; (c) empty
  charged + `chargeSkillCharge == null` → `charged` is `undefined`.
- **Corpus test** — reads `docs/ship-targeting.csv` and asserts every `active`
  and (non-empty) `charged` value parses with **no `'unknown'` shape or selection
  and no unconsumed tokens**. This is the coverage gate that the entire vocabulary
  is handled. (Note: `docs/` is gitignored; the test reads the local file via a
  relative path, consistent with other reference-data-backed tooling. If the file
  is absent the test should skip with a clear message rather than fail, since the
  reference data is dev-machine-local.)

## File touch list

| File | Change |
|------|--------|
| `supabase/migrations/YYYYMMDD_add_targeting_to_ship_templates.sql` | new — 4 nullable columns |
| `scripts/populate-ship-targeting.ts` | new — CSV → ship_templates (service role), dry-run + unmatched report |
| `src/utils/targetingParser.ts` | new — types + parser |
| `src/utils/__tests__/targetingParser.test.ts` | new — token + corpus tests |
| `src/types/ship.ts` | add 4 optional raw-string fields |
| `src/hooks/useShipsData.ts` | extend `ShipTemplate` + `transformShipTemplate` |
| `src/services/shipTemplateProposalService.ts` | extend `ShipTemplate` interface |

## Success criteria

- Migration adds the 4 nullable columns (applied via Supabase CLI/dashboard).
- Populate script runs, reports **0 unmatched** (or the few are resolved).
- Corpus test green across all 147 ships (every active + charged value tokenizes
  with no `unknown` and no leftover tokens).
- Raw targeting strings reach the frontend `Ship` model.
- Existing test suite unchanged (no engine behaviour touched); `lint` + `tsc` clean.

## Risks / notes

- **Name drift** between CSV and `ship_templates` — mitigated by the dry-run
  unmatched report; pre-verified zero mismatches at design time.
- **Vocabulary completeness** — the corpus test is the backstop; any future ship
  with a novel shape/modifier fails the test loudly rather than silently producing
  `unknown`.
- **`charge_skill_text` vs `charged_pattern` naming** — the existing skill column
  uses `charge_` while the targeting CSV uses `charged_`. We keep `charged_` for
  the targeting columns to match the gathered data verbatim; documented here to
  avoid confusion.
- The structured model intentionally stops at tokens. The later engine phase adds
  geometry; keeping the model token-only now avoids encoding board-cell guesses.
