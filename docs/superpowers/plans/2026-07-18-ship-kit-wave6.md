# Ship Kit Wave 6 — Stealth-Targeting Bypass — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to
> implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let specific abilities (and Lodolite ship-wide) target Stealthed enemies, which the
positional resolver filters out today.

**Architecture:** Two carriers into `resolvePositionalTarget`, no new engine maps. Per-ability
`config.ignoresStealth` (single source) → `battleSimulator` stamps `ParsedTarget.ignoresStealth`
on the active/charged target → flows through existing target maps. Ship-level
`ShipSkills.ignoresStealth` → `CombatActor.ignoresStealth` → `acting.ignoresStealth` (clone of
`ignoresForcedTargeting`). Resolver skips the stealth filter when either is set.

**Tech Stack:** TypeScript, Vitest. Spec: `docs/superpowers/specs/2026-07-18-ship-kit-wave6-design.md`.

## Global Constraints

- `npm run lint` must pass with **0 warnings** (`--max-warnings 0`). Lint is a SEPARATE gate from
  tests — run both.
- The full `npm test` golden audit (whole suite) must stay green — DPS output is byte-identical
  (the DPS dummy is never Stealthed).
- Source of truth for skill text = `docs/ship-skills.csv` (gitignored, dev-only). Do NOT derive
  parser patterns from ship-data.
- Skill-parser tests import the CSV via `csvAvailable()` guards; unit tests that don't need the CSV
  use synthetic ability/text fixtures.
- Never run `vitest -u`. Never widen a snapshot to make it pass.
- Commit after each green task. Do NOT push or open the PR until told.

## Ships & clauses (verbatim from `docs/ship-skills.csv`)

- **Lodolite** active & charged (skill 3): "…<br />This attack can target Stealthed enemies."
  Both passives: "This Unit ignores Stealth effects.<br /><br />…"
- **Rhodium** charged (skill 6): "This Unit deals 170% damage…<br />This attack can target
  Stealthed enemies." (active & passives have NO stealth clause)
- **Selenite** charged (skill 4): "This Unit deals 300% damage…<br />This attack can target
  Stealthed enemies." (active & passives have NO stealth clause)

---

## Task 1: Per-ability `config.ignoresStealth` flag + parser detector

**Files:**
- Modify: `src/types/abilities.ts` (~625, damage config, next to `ignoresDefense`)
- Modify: `src/utils/skillTextParser.ts` (new exported `parseIgnoresStealth`, near `parseIgnoresDefense`)
- Modify: `src/utils/abilities/buildShipAbilities.ts` (~1116/1156, damage-ability construction)
- Test: `src/utils/abilities/__tests__/wave6StealthBypass.test.ts` (new)

**Interfaces:**
- Produces: `parseIgnoresStealth(text: string): boolean` (exported from `skillTextParser.ts`);
  damage `config.ignoresStealth?: boolean`.

- [ ] **Step 1: Add the type field.** In `src/types/abilities.ts`, in the damage config object
  (the one already containing `ignoresDefense?: boolean` at ~625), add:

```ts
          /** Ship-kit W6 (Lodolite/Rhodium/Selenite): this attack can target Stealthed enemies.
           *  Single source for the bypass; battleSimulator derives ParsedTarget.ignoresStealth
           *  (active vs charged slot) from this and the positional resolver skips the stealth
           *  filter. Absent → normal stealth filtering. */
          ignoresStealth?: boolean;
```

- [ ] **Step 2: Write the failing parser + build test.** Create
  `src/utils/abilities/__tests__/wave6StealthBypass.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseIgnoresStealth } from '../../skillTextParser';
import { buildShipAbilities } from '../buildShipAbilities';
import { Ship } from '../../../types/ship';
import { csvAvailable, loadShipSkillRecords } from '../../../../scripts/lib/shipSkillCsv';

// Build a full-refit Ship carrying a CSV record's texts (mirrors wave5DemolisherParse.test.ts).
// 4 refits → getShipSkillRows returns the highest refit-active passive; both Lodolite passives
// carry the clause so any refit-active variant is fine.
function shipFromCsv(name: string): Ship {
    const rec = loadShipSkillRecords().find((r) => r.name.toUpperCase() === name.toUpperCase());
    if (!rec) throw new Error(`docs/ship-skills.csv: no record for "${name}"`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return {
        ...({} as any),
        refits: [{}, {}, {}, {}],
        activeSkillText: rec.active,
        chargeSkillText: rec.charge,
        chargeSkillCharge: rec.chargeCharge,
        firstPassiveSkillText: rec.passives[0],
        secondPassiveSkillText: rec.passives[1],
        thirdPassiveSkillText: rec.passives[2],
    } as Ship;
}

describe('Wave 6 — parseIgnoresStealth (per-attack clause)', () => {
    it('matches the per-attack stealth-targeting clause', () => {
        expect(parseIgnoresStealth('This attack can target Stealthed enemies.')).toBe(true);
        expect(
            parseIgnoresStealth('This Unit deals 170% damage.<br />This attack can target <unit-aid>Stealthed</unit-aid> enemies.')
        ).toBe(true);
    });
    it('does NOT match the ship-wide passive phrasing or unrelated Stealth text', () => {
        expect(parseIgnoresStealth('This Unit ignores Stealth effects.')).toBe(false);
        expect(parseIgnoresStealth('This Unit gains Stealth for 2 turns.')).toBe(false);
        expect(parseIgnoresStealth('This Unit deals 200% damage.')).toBe(false);
    });
});

describe.skipIf(!csvAvailable())('Wave 6 — config.ignoresStealth on built abilities (per slot)', () => {
    const damageWithBypass = (name: string, slot: 'active' | 'charged') =>
        buildShipAbilities(shipFromCsv(name))
            .slots.find((s) => s.slot === slot)
            ?.abilities.some((a) => a.config.type === 'damage' && a.config.ignoresStealth === true) ?? false;

    it('Rhodium: charged bypasses, active does not', () => {
        expect(damageWithBypass('Rhodium', 'charged')).toBe(true);
        expect(damageWithBypass('Rhodium', 'active')).toBe(false);
    });
    it('Selenite: charged bypasses, active does not', () => {
        expect(damageWithBypass('Selenite', 'charged')).toBe(true);
        expect(damageWithBypass('Selenite', 'active')).toBe(false);
    });
    it('Lodolite: both active and charged bypass', () => {
        expect(damageWithBypass('Lodolite', 'active')).toBe(true);
        expect(damageWithBypass('Lodolite', 'charged')).toBe(true);
    });
});
```

> The `shipFromCsv` helper + `loadShipSkillRecords`/`csvAvailable` are the established CSV-fixture
> idiom (see `wave5DemolisherParse.test.ts` `recordFor`/`ship`). `ShipSkillRecord` fields:
> `{ name, active, charge, chargeCharge, passives: [string, string, string] }`.

- [ ] **Step 3: Run the test — expect FAIL** (`parseIgnoresStealth` not exported / configs unset).

Run: `npx vitest --run src/utils/abilities/__tests__/wave6StealthBypass.test.ts`
Expected: FAIL.

- [ ] **Step 4: Add the parser detector.** In `src/utils/skillTextParser.ts`, near
  `parseIgnoresDefense`, add (reuse the existing `stripUnitTags` helper):

```ts
// W6: "This attack can target Stealthed enemies" — a per-attack stealth-targeting bypass.
// Requires the "can target … Stealthed … enem" ordering so the ship-wide "ignores Stealth
// effects" passive (no "can target") does NOT match here.
const CAN_TARGET_STEALTHED_RE = /\bcan target\b[^.]*\bstealthed\b[^.]*\benem/i;

/** True when the given attack text states it can target Stealthed enemies (per-ability bypass). */
export function parseIgnoresStealth(text: string): boolean {
    return CAN_TARGET_STEALTHED_RE.test(stripUnitTags(text));
}
```

- [ ] **Step 5: Set the config flag in buildShipAbilities.** In
  `src/utils/abilities/buildShipAbilities.ts`, in the `else if (mult > 0)` damage branch, next to
  `const ignoresDefense = parseIgnoresDefense(text);` (~1116), add:

```ts
        // Ship-kit W6 (Lodolite/Rhodium/Selenite): "This attack can target Stealthed enemies".
        const ignoresStealth = parseIgnoresStealth(text);
```

  Then in the `config:` object where `...(ignoresDefense ? { ignoresDefense: true } : {})` is
  (~1156), add on the next line:

```ts
                    ...(ignoresStealth ? { ignoresStealth: true } : {}),
```

  Add `parseIgnoresStealth` to the `skillTextParser` import at the top of the file (find the
  existing `parseIgnoresDefense` import and append).

- [ ] **Step 6: Run the test — expect PASS.**

Run: `npx vitest --run src/utils/abilities/__tests__/wave6StealthBypass.test.ts`
Expected: PASS.

- [ ] **Step 7: Lint + commit.**

```bash
npm run lint
git add src/types/abilities.ts src/utils/skillTextParser.ts src/utils/abilities/buildShipAbilities.ts src/utils/abilities/__tests__/wave6StealthBypass.test.ts
git commit -m "feat: W6 per-ability ignoresStealth flag + parseIgnoresStealth detector"
```

---

## Task 2: Ship-level `ShipSkills.ignoresStealth` + `detectIgnoresStealth`

**Files:**
- Modify: `src/utils/skillTextParser.ts` (new exported `detectIgnoresStealth`, near `detectIgnoresForcedTargeting` ~734)
- Modify: `src/types/abilities.ts` (`ShipSkills`, ~1070, next to `ignoresForcedTargeting`)
- Modify: `src/utils/abilities/buildShipAbilities.ts` (~3425, next to the `ignoresForcedTargeting` compute)
- Test: `src/utils/abilities/__tests__/wave6StealthBypass.test.ts` (extend)

**Interfaces:**
- Consumes: nothing from Task 1 (independent parser signal).
- Produces: `detectIgnoresStealth(...skillTexts: Array<string | null | undefined>): boolean`;
  `ShipSkills.ignoresStealth?: boolean`.

- [ ] **Step 1: Write the failing test.** Append to `wave6StealthBypass.test.ts`:

```ts
import { detectIgnoresStealth } from '../../skillTextParser';

describe('Wave 6 — detectIgnoresStealth (ship-wide passive)', () => {
    it('matches "This Unit ignores Stealth effects"', () => {
        expect(detectIgnoresStealth('This Unit ignores <unit-skill>Stealth</unit-skill> effects.')).toBe(true);
    });
    it('does NOT match the per-attack clause or a Stealth grant', () => {
        expect(detectIgnoresStealth('This attack can target Stealthed enemies.')).toBe(false);
        expect(detectIgnoresStealth('This Unit gains Stealth for 2 turns.')).toBe(false);
        expect(detectIgnoresStealth(null, undefined)).toBe(false);
    });
});

describe.skipIf(!csvAvailable())('Wave 6 — ShipSkills.ignoresStealth', () => {
    it('Lodolite is true; Rhodium and Selenite are undefined', () => {
        expect(buildShipAbilities(shipFromCsv('Lodolite')).ignoresStealth).toBe(true);
        expect(buildShipAbilities(shipFromCsv('Rhodium')).ignoresStealth).toBeUndefined();
        expect(buildShipAbilities(shipFromCsv('Selenite')).ignoresStealth).toBeUndefined();
    });
});
```

> `shipFromCsv` is defined in Task 1's test block (same file). `detectIgnoresStealth` imports add to
> the existing `skillTextParser` import line.

- [ ] **Step 2: Run — expect FAIL** (`detectIgnoresStealth` missing; `ignoresStealth` unset).

Run: `npx vitest --run src/utils/abilities/__tests__/wave6StealthBypass.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add the detector.** In `skillTextParser.ts`, right after
  `detectIgnoresForcedTargeting` (~738):

```ts
// W6: "This Unit ignores Stealth effects" — a ship-wide stealth-ignoring passive (Lodolite).
// Requires ignor… THEN stealth THEN effect within a sentence so the per-attack "can target
// Stealthed enemies" clause and plain "gains Stealth" grants do NOT match.
const IGNORES_STEALTH_RE = /\bignor\w*\b[^.]*\bstealth\b[^.]*\beffects?\b/i;

/** True if any given skill text states the unit ignores Stealth effects (ship-wide targeting
 *  bypass). Per-ship: uniform across active/charged/passive. */
export function detectIgnoresStealth(
    ...skillTexts: Array<string | null | undefined>
): boolean {
    return skillTexts.some((t) => !!t && IGNORES_STEALTH_RE.test(stripUnitTags(t)));
}
```

- [ ] **Step 4: Add the `ShipSkills` field.** In `src/types/abilities.ts`, after
  `ignoresForcedTargeting?: boolean;` (~1070):

```ts
    /** True when the ship's passive text declares it ignores Stealth effects (Lodolite).
     *  Threaded onto CombatActor.ignoresStealth by the engine adapter and consumed by
     *  positionalBinding.ts to skip the stealth targeting filter on ALL of this ship's casts
     *  (the per-cast `config.ignoresStealth` handles single-skill bypasses like Rhodium/Selenite). */
    ignoresStealth?: boolean;
```

- [ ] **Step 5: Compute in buildShipAbilities.** In `buildShipAbilities.ts`, right after the
  `ignoresForcedTargeting` compute (~3427), add:

```ts
    // Ship-kit W6: "This Unit ignores Stealth effects" (Lodolite) — same refit-resolved rows.
    const ignoresStealth = detectIgnoresStealth(...getShipSkillRows(ship).map((row) => row.text));
```

  And in the returned object (~3433), after the `ignoresForcedTargeting` spread:

```ts
        ...(ignoresStealth ? { ignoresStealth: true } : {}),
```

  Add `detectIgnoresStealth` to the `skillTextParser` import.

- [ ] **Step 6: Run — expect PASS.**

Run: `npx vitest --run src/utils/abilities/__tests__/wave6StealthBypass.test.ts`
Expected: PASS.

- [ ] **Step 7: Lint + commit.**

```bash
npm run lint
git add src/utils/skillTextParser.ts src/types/abilities.ts src/utils/abilities/buildShipAbilities.ts src/utils/abilities/__tests__/wave6StealthBypass.test.ts
git commit -m "feat: W6 ship-level ShipSkills.ignoresStealth + detectIgnoresStealth"
```

---

## Task 3: `ParsedTarget.ignoresStealth` + resolver bypass

**Files:**
- Modify: `src/utils/targetingParser.ts` (`ParsedTarget` interface, ~10)
- Modify: `src/utils/combat/positionalBinding.ts` (`acting` type ~51 + step-4 filter ~110)
- Modify: `src/utils/combat/positionalApply.ts` (`acting` type ~114)
- Test: `src/utils/combat/positionalBinding.test.ts` (extend)

**Interfaces:**
- Consumes: nothing (defines the carriers).
- Produces: `ParsedTarget.ignoresStealth?: boolean`; `acting.ignoresStealth?: boolean` on
  `resolvePositionalTarget` and `applyPositionalDamage`.

- [ ] **Step 1: Write the failing resolver tests.** In
  `src/utils/combat/positionalBinding.test.ts`, add a describe block. Follow the existing fixture
  style in that file (it builds `opposingLiving` actors + a `statusOf` map). Two cases:

```ts
describe('Wave 6 — stealth bypass', () => {
    // Two opposing actors: front-most (col 4) is Stealthed, a back one is visible.
    // Default targeting would skip the stealthed front and hit the visible back.
    // With bypass, the front-most Stealthed actor resolves normally.
    const makeActors = (): CombatActor[] => [
        // reuse the file's actor factory; front-most = higher column
        actorAt('e-front', /* position col 4 */),
        actorAt('e-back', /* position col 3 */),
    ];
    const statusOf = (id: string) =>
        id === 'e-front'
            ? { stealthed: true, taunting: false, concentrated: false }
            : { stealthed: false, taunting: false, concentrated: false };
    const target: ParsedTarget = { raw: 'single', side: 'enemy', selection: /* single/front */ };

    it('without bypass: the visible back actor is targeted (stealthed front filtered out)', () => {
        const r = resolvePositionalTarget(FRONT_POS, target, makeActors(), statusOf, {});
        expect(r?.id).toBe('e-back');
    });
    it('acting.ignoresStealth: the stealthed front-most actor is targeted', () => {
        const r = resolvePositionalTarget(FRONT_POS, target, makeActors(), statusOf, {
            ignoresStealth: true,
        });
        expect(r?.id).toBe('e-front');
    });
    it('target.ignoresStealth (per-cast): the stealthed front-most actor is targeted', () => {
        const r = resolvePositionalTarget(
            FRONT_POS,
            { ...target, ignoresStealth: true },
            makeActors(),
            statusOf,
            {}
        );
        expect(r?.id).toBe('e-front');
    });
});
```

> NOTE: use the actual actor/position factory and the single/front `selection` value already used
> elsewhere in `positionalBinding.test.ts` — match its column convention (col 4 = front-most, see
> `frontMost` in the source). The behavioural assertion is: bypass makes the resolver pick the
> Stealthed front-most cell that the default filter drops.

- [ ] **Step 2: Run — expect FAIL** (`ignoresStealth` not on the types; filter still active).

Run: `npx vitest --run src/utils/combat/positionalBinding.test.ts`
Expected: FAIL (compile error on `ignoresStealth`, or wrong id).

- [ ] **Step 3: Add `ParsedTarget.ignoresStealth`.** In `src/utils/targetingParser.ts`:

```ts
export interface ParsedTarget {
    raw: string;
    side: TargetSide;
    selection: TargetSelection;
    /** Ship-kit W6: this cast can target Stealthed enemies — the positional resolver skips the
     *  stealth visibility filter. Set by battleSimulator from the per-slot config.ignoresStealth.
     *  Absent → normal stealth filtering. */
    ignoresStealth?: boolean;
}
```

- [ ] **Step 4: Extend the `acting` types.** In `positionalBinding.ts` (~51) change the `acting`
  param type, and in `positionalApply.ts` (~114) the `acting` field type, from
  `{ ignoresForcedTargeting?: boolean; provokedBy?: string }` to:

```ts
    acting?: { ignoresForcedTargeting?: boolean; ignoresStealth?: boolean; provokedBy?: string }
```

- [ ] **Step 5: Skip the filter in the resolver.** In `positionalBinding.ts` step 4 (~110-114):

```ts
        // 4. Stealth filter — restore all if every candidate is stealthed. Skipped entirely when
        //    the acting attacker (ship-level) OR this cast's target (per-ability) ignores Stealth.
        if (!acting?.ignoresStealth && !target.ignoresStealth) {
            const visible = cells.filter((p) => !statusOf(byCell.get(p)!.id)?.stealthed);
            if (visible.length) {
                cells = visible;
            }
        }
```

  Also update the doc comment for step 4 (~39) to note the bypass.

- [ ] **Step 6: Run — expect PASS.**

Run: `npx vitest --run src/utils/combat/positionalBinding.test.ts`
Expected: PASS.

- [ ] **Step 7: Lint + commit.**

```bash
npm run lint
git add src/utils/targetingParser.ts src/utils/combat/positionalBinding.ts src/utils/combat/positionalApply.ts src/utils/combat/positionalBinding.test.ts
git commit -m "feat: W6 ParsedTarget.ignoresStealth + resolver stealth-filter bypass"
```

---

## Task 4: Ship-level engine threading (`CombatActor.ignoresStealth`)

Grep-driven mechanical clone of `ignoresForcedTargeting`. Run
`grep -n "ignoresForcedTargeting" src/utils/combat/state.ts src/utils/combat/engine.ts` for the
authoritative site list before editing; the sites below are the current ones.

**Files:**
- Modify: `src/utils/combat/state.ts` (CombatActor field ~156; createActor param ~188; assignment ~214)
- Modify: `src/utils/combat/engine.ts` (EngineInput fields ~464/982/1119/1156; adapter copies
  ~587/1541/1624; `drivePositionalApply` arg + acting ~5017-5018; `selectTurnTarget` acting ~5491;
  drive call ~5765)
- Test: `src/utils/combat/engine.ts` covered indirectly by Task 5's integration test; no new unit
  test here (pure plumbing) — the compile + Task 5 assert the thread is intact.

**Interfaces:**
- Consumes: `ShipSkills.ignoresStealth` (Task 2, read by battleSimulator in Task 5).
- Produces: `CombatActor.ignoresStealth?: boolean`; `acting.ignoresStealth` populated at both
  resolver call paths from `actor.ignoresStealth` / `a.ignoresStealth`.

- [ ] **Step 1: `state.ts` — CombatActor field.** After `ignoresForcedTargeting?: boolean;` (~156):

```ts
    /** Attacker ignores the Stealth targeting filter on ALL its casts (Lodolite's "ignores
     *  Stealth effects" passive). Positional plumbing — set at construction, consumed by
     *  resolvePositionalTarget via acting.ignoresStealth. */
    ignoresStealth?: boolean;
```

- [ ] **Step 2: `state.ts` — createActor.** Add `ignoresStealth?: boolean;` to the `partial` type
  (~188, after `ignoresForcedTargeting?`), and the assignment (~214, after the
  `ignoresForcedTargeting: partial.ignoresForcedTargeting,` line):

```ts
        ignoresStealth: partial.ignoresStealth,
```

- [ ] **Step 3: `engine.ts` — EngineInput interface fields.** At each interface that declares
  `ignoresForcedTargeting?: boolean;` (grep: ~464, ~982, ~1119, ~1156), add a sibling
  `ignoresStealth?: boolean;` with a one-line comment `// W6: ship-wide stealth-targeting bypass.`

- [ ] **Step 4: `engine.ts` — adapter copies.** At each site that copies
  `ignoresForcedTargeting: <x>.ignoresForcedTargeting,` (grep: ~587 `e.`, ~1541 `input.`, ~1624
  `t.`), add the sibling line copying `.ignoresStealth`. Also the `createActor`/actor-build copies
  that seed the field onto the CombatActor (mirror wherever `ignoresForcedTargeting` is passed into
  actor construction, e.g. ~5765 area is the drive call, not construction — construction copies are
  at the adapter sites above).

- [ ] **Step 5: `engine.ts` — `drivePositionalApply` arg + acting literal.** Add
  `ignoresStealth?: boolean;` to the `drivePositionalApply` args type (near its
  `ignoresForcedTargeting?: boolean;`), and in its `acting:` literal (~5017):

```ts
                    acting: {
                        ignoresForcedTargeting: args.ignoresForcedTargeting,
                        ignoresStealth: args.ignoresStealth,
                        provokedBy: provokerOf(statusEngine, args.actingId),
                    },
```

- [ ] **Step 6: `engine.ts` — drive call site (~5765).** Where the call passes
  `ignoresForcedTargeting: actor.ignoresForcedTargeting,`, add:

```ts
                ignoresStealth: actor.ignoresStealth,
```

- [ ] **Step 7: `engine.ts` — `selectTurnTarget` acting (~5491).** In the `acting:` literal, add:

```ts
                              ignoresStealth: a.ignoresStealth,
```

- [ ] **Step 8: Typecheck + full test + lint.**

Run: `npx tsc --noEmit && npm test && npm run lint`
Expected: green (no behavioural change yet — battleSimulator doesn't populate the field until
Task 5, so `actor.ignoresStealth` is undefined everywhere → byte-identical).

- [ ] **Step 9: Commit.**

```bash
git add src/utils/combat/state.ts src/utils/combat/engine.ts
git commit -m "feat: W6 thread CombatActor.ignoresStealth into acting (ship-level clone)"
```

---

## Task 5: battleSimulator per-slot derivation + stamping + integration test

**Files:**
- Modify: `src/utils/calculators/battleSimulator.ts` (`PlacementPlan` type ~676; `planPlacement`
  ~698; the three actor-input build sites ~849/865, ~909/904, ~966/981)
- Test: `src/utils/combat/__tests__/wave6StealthBypassBattle.integration.test.ts` (new)

**Interfaces:**
- Consumes: `config.ignoresStealth` (Task 1), `ShipSkills.ignoresStealth` (Task 2),
  `ParsedTarget.ignoresStealth` + `CombatActor.ignoresStealth` (Tasks 3-4).
- Produces: end-to-end behaviour — a Stealthed enemy is targetable by a bypass cast.

- [ ] **Step 1: Write the failing integration test.** Create
  `src/utils/combat/__tests__/wave6StealthBypassBattle.integration.test.ts`. Model a minimal
  positional battle (mirror an existing positional battleSimulator/engine integration test, e.g.
  `demolisherBombSplash.integration.test.ts` or a `battleSimulator*` positional test) with:
  - One player attacker whose CHARGED target carries `ignoresStealth` (or set
    `actor.ignoresStealth` directly for the ship-level case).
  - Two enemies, the front-most Stealthed.
  - Assert: with bypass, the Stealthed front enemy takes damage / is the resolved anchor; a control
    run WITHOUT bypass leaves the Stealthed enemy untouched (the visible one is hit).

  Keep it engine-level and deterministic (fixed rounds, no RNG divergence). If a full
  `simulateBattle` is too heavy, assert via `resolvePositionalTarget` fed the ParsedTarget that
  battleSimulator produces for the bypass ship (build the plan, read the stamped target).

- [ ] **Step 2: Run — expect FAIL** (battleSimulator doesn't stamp/thread yet).

Run: `npx vitest --run src/utils/combat/__tests__/wave6StealthBypassBattle.integration.test.ts`
Expected: FAIL.

- [ ] **Step 3: `PlacementPlan` fields.** In `battleSimulator.ts`, add to the `PlacementPlan` type
  (~676, after `chargedTargeting`):

```ts
    /** W6: per-slot stealth-targeting bypass, derived from the built damage configs. Stamped onto
     *  the active/charged ParsedTarget at the actor-input build sites. */
    activeIgnoresStealth: boolean;
    chargedIgnoresStealth: boolean;
```

- [ ] **Step 4: Derive in `planPlacement`.** In the returned object (~698), after building
  `shipSkills`, add a local and the two fields:

```ts
    const shipSkills = getGearPiece
        ? buildShipAbilitiesWithEquipment(p.ship, getGearPiece)
        : buildShipAbilities(p.ship);
    const slotBypass = (slot: 'active' | 'charged'): boolean =>
        shipSkills.slots
            .find((s) => s.slot === slot)
            ?.abilities.some((a) => a.config.type === 'damage' && a.config.ignoresStealth === true) ??
        false;
```

  (Assign `shipSkills` to the returned `shipSkills:` field instead of the inline expression.) Then
  in the returned object:

```ts
        activeIgnoresStealth: slotBypass('active'),
        chargedIgnoresStealth: slotBypass('charged'),
```

- [ ] **Step 5: Add the `withBypass` helper + stamp at the actor-input sites.** Near the top of the
  battle-assembly function (module scope or local), add:

```ts
const withStealthBypass = (
    t: ParsedTarget | undefined,
    on: boolean
): ParsedTarget | undefined => (t && on ? { ...t, ignoresStealth: true } : t);
```

  Add `ParsedTarget` to the `targetingParser` import if not already present. Then at EACH of the
  three actor-input build sites, wrap the target/chargedTarget and add the ship-level flag:
  - Focus attacker (~966/981): `target: withStealthBypass(focus.targeting?.target, focus.activeIgnoresStealth)`,
    `chargedTarget: withStealthBypass(focus.chargedTargeting?.target, focus.chargedIgnoresStealth)`,
    and `ignoresStealth: focus.shipSkills.ignoresStealth` (next to `ignoresForcedTargeting`).
  - Team actors (~849/865): same with `plan.` prefix.
  - Enemy actors (~909/904): same with `plan.` prefix.

- [ ] **Step 6: Run the integration test — expect PASS.**

Run: `npx vitest --run src/utils/combat/__tests__/wave6StealthBypassBattle.integration.test.ts`
Expected: PASS.

- [ ] **Step 7: Full suite + lint.**

Run: `npm test && npm run lint`
Expected: green (all prior goldens byte-identical — no non-bypass ship gets a stamped flag).

- [ ] **Step 8: Commit.**

```bash
git add src/utils/calculators/battleSimulator.ts src/utils/combat/__tests__/wave6StealthBypassBattle.integration.test.ts
git commit -m "feat: W6 battleSimulator stamps ParsedTarget.ignoresStealth + threads ship-level flag"
```

---

## Task 6: Changelog + docs

**Files:**
- Modify: `src/constants/changelog.ts` (`UNRELEASED_CHANGES`, ~8)
- Modify: `src/pages/DocumentationPage.tsx` (stealth / combat-mechanics section, if present)

- [ ] **Step 1: Add a changelog entry.** Append to the `UNRELEASED_CHANGES` array:

```ts
    'Ships whose kits can target Stealthed enemies (Lodolite, Rhodium, Selenite) now correctly bypass the Stealth targeting filter in the combat simulator.',
```

- [ ] **Step 2: DocumentationPage.** If there is a combat-mechanics / stealth passage, add a
  sentence that some ships/abilities can target Stealthed enemies (mirror the existing Concentrate
  Fire wording). If no such passage exists, skip — do NOT invent a new section.

- [ ] **Step 3: Lint + commit.**

```bash
npm run lint
git add src/constants/changelog.ts src/pages/DocumentationPage.tsx
git commit -m "docs: W6 changelog + stealth-bypass mechanic note"
```

---

## Final verification (before PR)

- [ ] `npm test` green (whole suite = golden audit).
- [ ] `npm run lint` clean (0 warnings).
- [ ] `npx tsc --noEmit` clean.
- [ ] Spot-check via the harness (optional, dev-only): `npm run trace:ship -- Rhodium` and confirm
      the charged attack's parsed config shows `ignoresStealth`. (Recall Wave-4 lesson: the trace
      renders config type/target but not conditions/scaling — config booleans DO serialize, so this
      is confirmable; ship-level actor flag is not in the bundle, verified via Task 2's build test.)
- [ ] Fable final whole-branch review → target no Critical/Important.
- [ ] CodeRabbit round after PR open.

## Self-review notes (spec coverage)

- Lodolite passive → Task 2 (ship-level). Lodolite/Rhodium/Selenite per-attack clause → Task 1
  (config) + Task 5 (ParsedTarget). Resolver bypass → Task 3. Ship-level thread → Task 4.
  battleSimulator wiring → Task 5. Editor/audit → intentionally NONE (spec §"Editor + audit").
- Regex disambiguation (`parseIgnoresStealth` vs `detectIgnoresStealth`) asserted both directions
  in Tasks 1-2.
- DPS invariance guaranteed by the `withStealthBypass`/spread-only-when-set pattern (Task 5 step 5)
  + undefined actor flag until stamped (Task 4 step 8) — full-suite green gates it in Tasks 4/5.
