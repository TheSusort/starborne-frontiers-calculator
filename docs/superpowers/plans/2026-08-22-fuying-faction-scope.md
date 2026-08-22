# Fuying: faction-scoped recipients and the Stealth DR aura — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the five modelling gaps on Fuying (#363) — her missing targeting data, the dropped
faction scope on her Stealth grant, her unapplied Stealth damage-reduction aura, her unscaled
cleanse count, and her Stealth duration extension.

**Architecture:** Every gap rides machinery that already exists. Gap 0 is pure data. Gap 1 adds a
recipient-attribute filter mirroring `roleFilter` at all five of its layers. Gap 2 makes the
per-actor incoming-effects map fan an ally-scoped ability out to allies. Gaps 3 and 4 each widen one
existing config field and its executor. No new engine channel is introduced.

**Tech Stack:** TypeScript, Vitest, React + TailwindCSS, Supabase (`ship_templates`).

Spec: `docs/superpowers/specs/2026-08-22-fuying-faction-scope-design.md`
Issue: [#363](https://github.com/TheSusort/starborne-frontiers-calculator/issues/363)
Branch: `fuying-faction-scope`, based on `2168ccf0`. Spec commit: `d10050c9`.

## Global Constraints

- **Never run `vitest -u`.** Snapshots are re-baselined by hand. `vitest run` auto-writes NEW
  snapshot keys silently — after any run that could add one, check `git diff` on `*.snap`.
- **`npm test` is the gate** (husky pre-commit). There is no CI test workflow. It also runs the
  golden audit, so a golden break surfaces at commit time.
- **Dev server is `npm start`, not `npm run dev`.** Port 3000.
- **`tsc --noEmit` does NOT cover `scripts/`** (tsconfig `include: ["src"]`; lint is `eslint src`).
  A compile-time guard placed in `scripts/` is never evaluated.
- **`docs/` is gitignored** (`.gitignore:9`). Spec/plan/data files under it are committed with
  `git add -f` and untracked post-merge (precedent: `7b94b444`).
- **Combat-engine work must be team-symmetric.** Every map added here is keyed by actor id and
  seeded for both sides, so an enemy-side Fuying behaves identically. No mirrored branches.
- **`PERCENTAGE_ONLY_STATS` are stored as integers** — crit power 150 means 150%, not 1.5.
- **Every engine change gets a concrete in-fight example** in its commit message: which ship, which
  turn, what the player sees.
- Changelog: add a plain-English line to `UNRELEASED_CHANGES` in `src/constants/changelog.ts`
  before committing any user-facing `feat:`/`fix:`. **No emojis in UI text.**

## Measurement discipline (applies to every task)

- **Prove the instrument could report the opposite before believing it.** A fixture that observes
  nothing passes. For each new test, make the assertion fail deliberately once (revert the fix with
  `git checkout <base> -- <path>`, never `git stash push <path>` — once the fix is committed,
  stashing a path reverts nothing and every test passes, which reads exactly like a validated
  instrument).
- **Red test through PRODUCTION slot routing first**, never against a hand-built `Ability`. A unit
  test on a mapping does not prove the engine feeds it the right input.
- **Measure corpus-wide before each fix** so each blast radius is known, not assumed.

---

## File Structure

**Create:**
- `src/utils/combat/__tests__/fuyingFactionScope.integration.test.ts` — gap 1 + gap 2 recipient and
  reduction assertions through production routing.
- `src/utils/combat/__tests__/fuyingStealthExtension.test.ts` — gap 4.
- `src/utils/combat/audit/__tests__/corpusTargetingCoverage.test.ts` — gap 0 tripwire.

**Modify:**
- `src/constants/factions.ts` — split `FACTION_DEFS` out to expose a real `FactionKey` union.
- `src/types/abilities.ts` — `Ability.factionFilter`; `extend-status.buffName`; `countScaling`
  doc comment.
- `src/utils/combat/supportRecipients.ts:10-56` — faction intersection in
  `resolveSupportRecipients`.
- `src/utils/combat/playerTurn.ts` — `supportRecipients` wiring (~1371); shared count-scaling
  helper + cleanse branch (~4356-4376, purge ~3679-3691); named extend (~3780-3812);
  `HealingCtx`-adjacent faction accessor (~146).
- `src/utils/combat/engine.ts` — `factionByActorId` + `factionOf` (~3592); ally-scoped
  incoming-reduction fan-out (~3739).
- `src/utils/combat/statusEngine.ts:1341` — `buffName` filter on `extendAllBuffsDuration`.
- `src/utils/skillTextParser.ts` — faction detector beside `detectGrantScope` (~5637);
  `parseCleanse` countScaling (~4928); named extend regex (~1885).
- `src/utils/abilities/buildShipAbilities.ts` — `ParsedIncomingDamageReduction` target/faction
  (~804, ~2866); grant faction wiring (~5841 caller side); extend `buffName` (~1777).
- `src/types/calculator.ts:360-400` — `TeamActorInput.faction`; the enemy actor input.
- `src/utils/calculators/battleSimulator.ts` — thread `plan.faction` into the engine actors.
- `src/components/skills/AbilityCard.tsx` — `factionFilter` control + strip-on-target-change.
- `scripts/auditSkills.allowlist.ts:118-122` — remove the Fuying entry.
- `docs/ship-targeting.csv` — Fuying's row.
- `src/constants/changelog.ts` — `UNRELEASED_CHANGES`.

**Re-baseline by hand:**
- `src/utils/calculators/__tests__/__snapshots__/realKitFingerprints.test.ts.snap` — Fuying's key
  at :911, and the `shipCount`/`digest` pin at :4064.

---

## Task 1: `FactionKey` — a literal union that actually checks

Gap 1 cannot be built safely on `FactionName`, which has silently widened to `string`.

**Files:**
- Modify: `src/constants/factions.ts`
- Test: `src/constants/__tests__/factions.test.ts` (create if absent)

**Interfaces:**
- Consumes: nothing.
- Produces: `export type FactionKey = keyof typeof FACTION_DEFS` from
  `src/constants/factions.ts` — a literal union of the 10 keys. `FACTIONS` keeps its
  `Record<string, Faction>` type so the 15 existing loose-index call sites are untouched.
  `FactionName` is left exactly as it is; this task does not migrate its consumers.

- [ ] **Step 1: Prove the current type is vacuous**

Write this scratch file (outside `src/`, so it is not committed) and compile it:

```ts
// /tmp/probe.ts
import type { FactionName } from '<abs path>/src/constants/factions';
const probe: FactionName = 'NOT_A_REAL_FACTION';
export default probe;
```

Run: `npx tsc --noEmit --skipLibCheck /tmp/probe.ts`
Expected: **exit 0** — no error. This is the defect: `FactionName` is `string`. Record the result;
if it DOES error, stop and re-read the file, because the premise of this task has changed.

- [ ] **Step 2: Write the failing test**

Create `src/constants/__tests__/factions.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { FACTIONS, FACTION_KEYS, type FactionKey } from '../factions';

describe('FactionKey', () => {
    it('is a literal union covering exactly the FACTIONS keys', () => {
        // A `satisfies`-checked exhaustive map: adding a faction to FACTIONS without adding it
        // here is a tsc error, which is the compile-time guard FactionName never gave us.
        const everyKey = {
            ATLAS_SYNDICATE: true,
            BINDERBURG: true,
            EVERLIVING: true,
            FRONTIER_LEGION: true,
            GELECEK: true,
            MPL: true,
            MARAUDERS: true,
            TERRAN_COMBINE: true,
            TIANCHAO: true,
            XAOC: true,
        } satisfies Record<FactionKey, true>;
        expect(Object.keys(everyKey).sort()).toEqual(Object.keys(FACTIONS).sort());
    });

    it('exposes the keys at runtime for the same set', () => {
        expect([...FACTION_KEYS].sort()).toEqual(Object.keys(FACTIONS).sort());
    });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run src/constants/__tests__/factions.test.ts`
Expected: FAIL — `FactionKey` and `FACTION_KEYS` are not exported from `../factions`.

- [ ] **Step 4: Implement**

In `src/constants/factions.ts`, rename the object literal and re-expose it. Keep every entry's
contents byte-identical — only the binding changes:

```ts
// The object literal is bound WITHOUT a `Record<string, Faction>` annotation so `keyof typeof`
// yields a real literal union. `FACTIONS` below re-exports it under the loose type that the 15
// existing `FACTIONS[someString]` call sites (SquadLeaderPicker, ArenaModifiersTab, ShipInventory,
// ShipSelector, ShipIndexPage, …) rely on, so none of them move.
//
// Do NOT annotate FACTION_DEFS — an explicit `Record<string, Faction>` is exactly what made
// `FactionName` widen to `string` (same defect class as STAT_NORMALIZERS, #295). `satisfies`
// gives the shape check without collapsing the keys.
const FACTION_DEFS = {
    ATLAS_SYNDICATE: { /* unchanged */ },
    // … all ten entries, unchanged …
} satisfies Record<string, Faction>;

export const FACTIONS: Record<string, Faction> = FACTION_DEFS;

/** A real literal union of the faction keys. Prefer this over `FactionName` (which is `string`)
 *  anywhere a typo must be a compile error — e.g. `Ability.factionFilter`. */
export type FactionKey = keyof typeof FACTION_DEFS;

/** Runtime companion to `FactionKey`, for validation at trust boundaries. */
export const FACTION_KEYS = Object.keys(FACTION_DEFS) as readonly FactionKey[];

// Unchanged, and deliberately not migrated by this task: `FactionName` is `string` because
// FACTIONS is annotated. Its existing consumers keep working exactly as before.
export type FactionName = keyof typeof FACTIONS;
```

- [ ] **Step 5: Verify the test passes and the guard is real**

Run: `npx vitest run src/constants/__tests__/factions.test.ts`
Expected: PASS (2 tests).

Then prove the new type is not also vacuous — repeat Step 1's probe against `FactionKey`:

```ts
const probe: FactionKey = 'NOT_A_REAL_FACTION';
```

Run: `npx tsc --noEmit --skipLibCheck /tmp/probe.ts`
Expected: **FAIL** with `Type '"NOT_A_REAL_FACTION"' is not assignable to type 'FactionKey'`.
If this compiles clean, the fix did not take — do not proceed to Task 2.

- [ ] **Step 6: Confirm no existing consumer moved**

Run: `npx tsc --noEmit && npm run lint`
Expected: both clean, 0 errors. Any error at a `FACTIONS[...]` site means the loose re-export was
lost — restore the `Record<string, Faction>` annotation on `FACTIONS` (not on `FACTION_DEFS`).

- [ ] **Step 7: Commit**

```bash
git add src/constants/factions.ts src/constants/__tests__/factions.test.ts
git commit -m "refactor(types): expose a real FactionKey literal union

FactionName is \`string\`: the explicit Record<string, Faction> annotation on
FACTIONS defeats \`keyof typeof\`. Verified — \`const p: FactionName =
'NOT_A_REAL_FACTION'\` compiles clean. Same defect class as STAT_NORMALIZERS
(#295), where two dead keys sat unused for months.

Binds the literal WITHOUT the annotation as FACTION_DEFS and re-exports
FACTIONS under the loose type, so all 15 FACTIONS[someString] index sites are
untouched. FactionName itself is unchanged and unmigrated.

Needed by #363: factionFilter must make a typo'd 'TIANCHOA' a tsc error. Under
the conservative unknown-never-matches rule it would otherwise compile and
grant Stealth to nobody."
```

---

## Task 2: Gap 0 — Fuying's targeting data

**Files:**
- Modify: `docs/ship-targeting.csv` (gitignored — `git add -f`)
- Create: `src/utils/combat/audit/__tests__/corpusTargetingCoverage.test.ts`
- Re-baseline: `src/utils/calculators/__tests__/__snapshots__/realKitFingerprints.test.ts.snap`

**Interfaces:**
- Consumes: nothing.
- Produces: `docs/ship-data.json` gains `activeTarget: 'other-allies'` and
  `activePattern: 'Pattern-Wings-Support-Not-Self-Range-2'` on Fuying. Every later task's
  fixtures depend on this, because without it Fuying's ally clauses are un-narrowed.

> ⚠️ **This task contains a production data write and CANNOT be completed by a subagent.**
> Steps 3-4 need `SUPABASE_SERVICE_ROLE_KEY` and the owner's go-ahead. A subagent must stop at
> Step 2 and hand back.

- [ ] **Step 1: Measure the gap, and confirm it is Fuying alone**

Run:

```bash
python3 - <<'PY'
import csv, json
tg = {r['name'] for r in csv.DictReader(open('docs/ship-targeting.csv'))}
sd = json.load(open('docs/ship-data.json'))
names = {s['name'] for s in sd}
print('ships:', len(names), 'targeting rows:', len(tg))
print('missing from csv:', sorted(names - tg))
print('lacking activeTarget/activePattern:',
      sorted(s['name'] for s in sd if not s.get('activeTarget') or not s.get('activePattern')))
PY
```

Expected exactly:
```
ships: 149 targeting rows: 148
missing from csv: ['Aegis', 'Apex', 'Fuying', 'Luxx']
lacking activeTarget/activePattern: ['Fuying']
```

`Aegis`/`Apex`/`Luxx` are case skew only (`AEGIS`/`APEX`/`LUXX` in the CSV); the populate script
matches case-insensitively, so they are NOT gaps. **Fuying is the only real one.**

- [ ] **Step 2: Add the CSV row**

Append to `docs/ship-targeting.csv` (columns are
`name,active_target,active_pattern,charged_target,charged_pattern`):

```csv
Fuying,other-allies,Pattern-Wings-Support-Not-Self-Range-2,,
```

Both charged columns stay **empty on purpose**: `parseShipTargeting`
(`src/utils/targetingParser.ts:227-247`) inherits the active axes for the charged slot when both
charged columns are empty and the ship has a charged skill. Fuying's `charge_skill_charge` is 3, so
her charged skill correctly reuses the active pattern — which is what the owner's ruling
("all allies within her **active** pattern") describes.

This is Purifier's exact pattern, per the owner 2026-08-22. Verify:

```bash
grep -E '^(Purifier|Fuying),' docs/ship-targeting.csv
```
Expected: the two rows carry the identical `other-allies` /
`Pattern-Wings-Support-Not-Self-Range-2` pair.

- [ ] **Step 3: OWNER CHECKPOINT — write to Supabase**

The app and the test corpus read `ship_templates`, **not** the CSV. Ask the owner to run:

```bash
DRY_RUN=true npx tsx scripts/populate-ship-targeting.ts   # inspect first
npx tsx scripts/populate-ship-targeting.ts                # then apply
```

Expected: 1 row updated (Fuying), 0 unmatched.

> **Do not hand-edit `docs/ship-data.json` as a shortcut.** It is regenerated from Supabase, so a
> hand-edit makes every test in Tasks 3-6 pass locally while production keeps the old behaviour,
> and the next `npm run fetch:ship-data` silently reverts it. The Supabase write must happen first.

- [ ] **Step 4: Resync the local corpus**

Run: `npm run fetch:ship-data`

Then confirm:
```bash
python3 -c "
import json; d=json.load(open('docs/ship-data.json'))
f=[s for s in d if s['name']=='Fuying'][0]
print(f['activeTarget'], '|', f['activePattern'])"
```
Expected: `other-allies | Pattern-Wings-Support-Not-Self-Range-2`

- [ ] **Step 5: Write the tripwire test**

Create `src/utils/combat/audit/__tests__/corpusTargetingCoverage.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { parseShipTargeting } from '../../../targetingParser';
import { buildTraceShip } from '../../../../../scripts/lib/traceShipFactory';
import { csvAvailable } from '../../../../../scripts/lib/shipSkillCsv';
import {
    shipDataAvailable,
    loadShipDataRecords,
} from '../../../../../scripts/lib/shipDataSnapshot';

/** Fuying (#363) shipped with no targeting data at all — the only ship of 149 in that state.
 *  With both axes absent, parseShipTargeting returns {}, firingPattern is undefined, and
 *  footprintAllyIds is undefined, which the engine reads as "do not narrow": every ally-scoped
 *  cast clause reaches the whole own side, caster included. That is silent — no throw, no
 *  warning, just a wrong recipient set. This pins the precondition so the next ship-data
 *  refresh cannot reintroduce it.
 *
 *  ⚠️ Ships are built via buildTraceShip, NOT read raw out of docs/ship-data.json. That file
 *  carries no `chargeSkillCharge` (it comes from docs/ship-skills.csv), and parseShipTargeting
 *  needs it to inherit the charged slot from active — a raw JSON row makes `charged` undefined
 *  for every ship and the second assertion below vacuous. */
describe('corpus targeting coverage (tripwire)', () => {
    beforeAll(() => {
        if (!csvAvailable() || !shipDataAvailable()) {
            throw new Error(
                'docs/ship-skills.csv and/or docs/ship-data.json are missing from this worktree.'
            );
        }
    });

    it('every ship resolves an ACTIVE targeting pair', () => {
        const missing = loadShipDataRecords()
            .map((d) => d.name)
            .filter((name) => {
                const ship = buildTraceShip(name);
                return !ship || !parseShipTargeting(ship).active;
            });
        expect(missing).toEqual([]);
    });

    it("Fuying resolves Purifier's pattern, on both slots", () => {
        const f = parseShipTargeting(buildTraceShip('Fuying')!);
        const p = parseShipTargeting(buildTraceShip('Purifier')!);
        expect(f.active).toBeDefined();
        expect(f.active).toEqual(p.active);
        // Both charged CSV columns are empty and she has a charged skill (charge 3), so the
        // charged slot inherits active — which is what "her active pattern" means for the
        // charged-slot Stealth extension in Task 6.
        expect(f.charged).toEqual(f.active);
    });
});
```

- [ ] **Step 6: Run it**

Run: `npx vitest run src/utils/combat/audit/__tests__/corpusTargetingCoverage.test.ts`
Expected: PASS (2 tests).

**Verify the instrument could have failed.** Temporarily blank Fuying's two fields in
`docs/ship-data.json`, re-run, and confirm the first test reports `["Fuying"]`. Restore the file
with `npm run fetch:ship-data`. If the test passes with the fields blanked, it is vacuous — fix it
before continuing.

- [ ] **Step 7: Re-baseline the two moved snapshot keys, BY HAND**

Run: `npm test` and expect exactly two snapshot mismatches in
`src/utils/calculators/__tests__/__snapshots__/realKitFingerprints.test.ts.snap`:
- `kit fingerprints > Fuying 1` (~:911) — her footprint went from the whole own side to a narrowed
  Not-Self pattern, so her ally-scoped clauses now reach a different recipient set.
- the `shipCount` / `digest` pin (~:4064) — `digest` hashes the corpus rows, and two fields
  changed. `shipCount` must stay **149**.

Edit both keys by hand to the reported values. **Never `vitest -u`.** Then confirm no third key
moved and none was silently added:

```bash
git diff --stat src/utils/calculators/__tests__/__snapshots__/realKitFingerprints.test.ts.snap
git diff src/utils/calculators/__tests__/__snapshots__/ | grep -c '^+exports'
```
Expected: one file changed; `0` new `exports[...]` lines. A non-zero count means `vitest run`
auto-wrote a new key — investigate before committing.

- [ ] **Step 8: Full suite**

Run: `npm test`
Expected: 0 failures, 0 snapshots written. Baseline before this branch was
**556 files / 6116 tests**; expect 556+ / 6116+ with the tests added so far.

- [ ] **Step 9: Commit**

```bash
git add -f docs/ship-targeting.csv
git add src/utils/combat/audit/__tests__/corpusTargetingCoverage.test.ts \
        src/utils/calculators/__tests__/__snapshots__/realKitFingerprints.test.ts.snap
git commit -m "fix(data): Fuying's targeting row, the only one missing in 149 ships (#363)

She shipped with no activeTarget/activePattern at all, so parseShipTargeting
returned {}, footprintAllyIds was undefined, and the engine read that as 'do
not narrow' — every ally-scoped cast clause reached her whole own side,
herself included.

In a fight: Fuying casts her active on turn 1. Before, Stealth landed on all
four allies wherever they stood, Fuying included. Now it lands only on allies
inside Pattern-Wings-Support-Not-Self-Range-2 (owner-confirmed: Purifier's
pattern), and never on Fuying — the pattern is Not-Self.

Adds a tripwire so the next refresh cannot reintroduce a ship with no
targeting. Re-baselines Fuying's fingerprint and the corpus digest by hand."
```

---

## Task 3: Gap 1 — the faction scope

**Files:**
- Modify: `src/types/abilities.ts` (~:1082, beside `roleFilter`)
- Modify: `src/utils/combat/supportRecipients.ts:10-56`
- Modify: `src/utils/combat/playerTurn.ts` (~:1371 `supportRecipients`, ~:146 ctx type)
- Modify: `src/utils/combat/engine.ts` (~:3592, beside `roleByActorId`)
- Modify: `src/types/calculator.ts` (~:393, beside `TeamActorInput.role`)
- Modify: `src/utils/calculators/battleSimulator.ts` (thread `plan.faction`)
- Modify: `src/utils/skillTextParser.ts` (~:5637, beside `detectGrantScope`)
- Modify: `src/utils/abilities/buildShipAbilities.ts` (~:5841 caller side)
- Test: `src/utils/combat/__tests__/fuyingFactionScope.integration.test.ts` (create)

**Interfaces:**
- Consumes: `FactionKey` from `src/constants/factions.ts` (Task 1). Fuying's resolved footprint
  (Task 2).
- Produces:
  - `Ability.factionFilter?: FactionKey[]`
  - `resolveSupportRecipients(args)` gains two optional args:
    `factionFilter?: FactionKey[]`, `factionOf?: (id: string) => FactionKey | undefined`
  - `detectGrantFactionScope(skillText: string, buffName: string, occurrenceIndex?: number): FactionKey[] | undefined`
    in `src/utils/skillTextParser.ts`
  - `TeamActorInput.faction?: FactionKey`

- [ ] **Step 1: Measure the corpus, and pin the false-positive risk**

The detector must match a faction used as a **recipient scope** and must never match a faction used
inside a **buff name**. Run:

```bash
python3 - <<'PY'
import csv, re
rows = list(csv.DictReader(open('docs/ship-skills.csv')))
facs = ['Atlas Syndicate','Binderburg','Everliving','Frontier Legion','Gelecek',
        'MPL','Marauders','Terran Combine','Tianchao','XAOC']
scope, named = [], []
for r in rows:
    for k, v in r.items():
        if k in ('name', 'charge_skill_charge') or not v: continue
        for f in facs:
            for m in re.finditer(r'[^.<>]*\b' + re.escape(f) + r'\b[^.]*\.', v):
                s = m.group(0).strip()
                (scope if re.search(re.escape(f) + r'\s+all(y|ies)\b', s) else named).append((r['name'], f, s[:90]))
print('RECIPIENT-SCOPED:', len(scope))
for x in scope: print('  ', x)
print('BUFF-NAMED (must NOT match):', len(named))
PY
```

Expected: `RECIPIENT-SCOPED: 4`, all Fuying (active grant + the DR aura at all THREE refit
tiers), and `BUFF-NAMED: 31`. Record both numbers — Step 7 asserts against them.

⚠️ Do NOT dedup by (ship, sentence) when counting: Fuying's R2 and R3 aura clauses are
character-identical, so a dedup collapses them and yields a wrong 3/32.

The discriminator is that the faction word is immediately followed by `ally`/`allies`.
`Tianchao allies` matches; `Tianchao Precision II` does not.

- [ ] **Step 2: Write the failing test**

Create `src/utils/combat/__tests__/fuyingFactionScope.integration.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { detectGrantFactionScope } from '../../skillTextParser';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { getShipSkillRows } from '../../ship/skillRows';
import { resolveSupportRecipients } from '../supportRecipients';
import { readFileSync } from 'fs';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import type { FactionKey } from '../../../constants/factions';
// Added by later tasks in this file: Task 4 needs `incomingReductionForHit` from
// '../incomingEffects'; Task 5 needs `parseCleanse` from '../../skillTextParser' and
// `scaledStatusCount` from '../playerTurn'.

// `docs/` is gitignored reference data and a fresh worktree does not have it. Without this guard
// the file fails to COLLECT rather than reporting a readable skip reason — copy the pattern from
// realKitFingerprints.test.ts:41.
function requireReferenceData(): void {
    if (!csvAvailable() || !shipDataAvailable()) {
        throw new Error(
            'docs/ship-skills.csv and/or docs/ship-data.json are missing from this worktree ' +
                '(gitignored reference data) — needed to resolve real ship skill text/stats.'
        );
    }
}
beforeAll(requireReferenceData);

/** The corpus Ship builder. `refitLevel` defaults to 4, so this is the R4 refit-active passive —
 *  which is what makes the DR aura 30% rather than 15% in Task 4. */
const fuyingShip = () => {
    const s = buildTraceShip('Fuying');
    if (!s) throw new Error('Fuying missing from the corpus');
    return s;
};

const FUYING_ACTIVE =
    'This Unit <unit-aid>cleanses 1 debuff</unit-aid>, grants ' +
    '<unit-skill>Security Up III</unit-skill> for 2 turns and grants Tianchao allies ' +
    '<unit-skill>Stealth</unit-skill> for 1 turn.';

describe('Fuying faction-scoped Stealth grant (#363)', () => {
    it('reads Tianchao off the RECIPIENT phrase', () => {
        expect(detectGrantFactionScope(FUYING_ACTIVE, 'Stealth')).toEqual(['TIANCHAO']);
    });

    it('does NOT read a faction out of a faction-NAMED buff', () => {
        // Anjian's shape: the faction word belongs to the buff name, not to a recipient.
        const anjian = 'This Unit grants <unit-skill>Tianchao Precision I</unit-skill> for 2 turns.';
        expect(detectGrantFactionScope(anjian, 'Tianchao Precision I')).toBeUndefined();
    });

    it('builds the Stealth grant with factionFilter, through PRODUCTION slot routing', () => {
        const built = buildShipAbilities(fuyingShip());
        const stealth = built.slots
            .flatMap((s) => s.abilities)
            .find((a) => a.config.type === 'buff' && a.config.buffName === 'Stealth');
        expect(stealth).toBeDefined();
        expect(stealth!.target).toBe('all-allies'); // unchanged — the target was never the bug
        expect(stealth!.factionFilter).toEqual(['TIANCHAO']);
    });

    it('narrows recipients to the matching faction, and drops unknown-faction actors', () => {
        const factions: Record<string, FactionKey> = {
            fuying: 'TIANCHAO',
            anjian: 'TIANCHAO',
            grif: 'XAOC',
        };
        const got = resolveSupportRecipients({
            target: 'all-allies',
            casterId: 'fuying',
            baseRecipients: ['fuying', 'anjian', 'grif', 'manual'],
            factionFilter: ['TIANCHAO'],
            factionOf: (id) => factions[id],
        });
        // 'grif' is the wrong faction; 'manual' has NO faction and is dropped per the
        // owner-approved conservative rule (unknown never matches).
        expect(got).toEqual(['fuying', 'anjian']);
    });

    it('is inert when no factionFilter is present', () => {
        const base = ['a', 'b', 'c'];
        expect(
            resolveSupportRecipients({
                target: 'all-allies',
                casterId: 'a',
                baseRecipients: base,
                factionOf: () => undefined,
            })
        ).toEqual(base);
    });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run src/utils/combat/__tests__/fuyingFactionScope.integration.test.ts`
Expected: FAIL — `detectGrantFactionScope` is not exported; `factionFilter` is not a property.

- [ ] **Step 4: Add the type**

In `src/types/abilities.ts`, immediately after `roleFilter` (~:1082):

```ts
    /** #363 (Fuying): recipient FACTION filter for an ally-scoped grant or aura — "grants
     *  Tianchao allies Stealth", "All Tianchao allies with Stealth take 30% less direct damage".
     *  Applied as an INTERSECTION after footprint narrowing (resolveSupportRecipients), so it
     *  composes with the pattern rather than replacing it. Absent → any ally.
     *
     *  An actor whose faction is UNKNOWN never matches (conservative — owner-approved
     *  2026-08-22, mirroring matchesRoleCategory). Only manually-configured actors lack a
     *  faction; single-ship DPS has no allies at all, and every team-sim actor is derived from
     *  a picked ship.
     *
     *  Typed `FactionKey`, NOT `FactionName` — the latter is `string` (see factions.ts), so a
     *  typo'd 'TIANCHOA' would compile and, under the rule above, reach nobody. */
    factionFilter?: FactionKey[];
```

Add `import type { FactionKey } from '../constants/factions';` at the top.

- [ ] **Step 5: Apply the intersection in the pure resolver**

In `src/utils/combat/supportRecipients.ts`, extend the signature and add the filter AFTER the
footprint narrowing (replacing the current `return` tail at :52-55):

```ts
export function resolveSupportRecipients(args: {
    target: AbilityTarget;
    casterId: string;
    baseRecipients: string[];
    footprintAllyIds?: string[];
    /** #363: intersect with recipients of these factions. Absent → no faction narrowing. */
    factionFilter?: FactionKey[];
    /** Actor id → faction. `undefined` for an actor whose faction is unknown, which NEVER
     *  matches a filter (conservative). Absent reader + present filter → nobody matches, which
     *  is the same conservative answer. */
    factionOf?: (id: string) => FactionKey | undefined;
}): string[] {
    // … existing 'lowest-hp-ally' throw, unchanged …

    const { footprintAllyIds, baseRecipients, factionFilter, factionOf } = args;

    // … existing footprintAllyIds === undefined comment block, unchanged …
    const afterFootprint =
        footprintAllyIds === undefined
            ? baseRecipients
            : ((allowed) => baseRecipients.filter((id) => allowed.has(id)))(
                  new Set(footprintAllyIds)
              );

    // #363: faction narrowing composes ON TOP of the footprint — the pattern says which allies
    // the cast reaches, the faction says which of those qualify. An empty filter array is treated
    // as absent (no narrowing), matching roleFilter's canonical-absent convention.
    if (!factionFilter || factionFilter.length === 0) return afterFootprint;
    const wanted = new Set<FactionKey>(factionFilter);
    return afterFootprint.filter((id) => {
        const f = factionOf?.(id);
        return f !== undefined && wanted.has(f);
    });
}
```

- [ ] **Step 6: Write the parser detector**

In `src/utils/skillTextParser.ts`, beside `detectGrantScope` (~:5637):

```ts
// #363 (Fuying): faction words appear in the corpus in TWO roles, and only one is a recipient
// scope. Measured over all 149 ships: 4 recipient-scoped clauses (all Fuying) vs 31 where the
// faction is part of a BUFF NAME ("Tianchao Precision II", "XAOC Swiftness III", "Binderburg
// Resilience III", "Everliving Regeneration II", "Gelecek Contagion II").
//
// The discriminator is the following noun: a scope reads "<Faction> allies", a name reads
// "<Faction> <Something-else>". Requiring `all(y|ies)` immediately after the faction word keeps
// all 32 buff-name clauses out with no ship-name special-casing.
const FACTION_SCOPE_RES: readonly (readonly [FactionKey, RegExp])[] = FACTION_KEYS.map(
    (key) => [key, new RegExp(`\\b${escapeRegExp(FACTIONS[key].name)}\\s+all(?:y|ies)\\b`, 'i')] as const
);

/**
 * Faction scope on a buff GRANT's recipient phrase, or undefined when the clause names none.
 *
 * Reads the SAME span `detectGrantScope` routes on (`resolveBuffClause` → `buffGrantSpan`), so
 * the scope and its faction can never disagree about which clause they describe. Scanning the
 * whole skill text instead would let a sibling sentence's faction leak onto this grant.
 */
export function detectGrantFactionScope(
    skillText: string,
    buffName: string,
    occurrenceIndex = 0
): FactionKey[] | undefined {
    const resolved = resolveBuffClause(skillText, buffName).toLowerCase();
    const clause = stripConditionClauses(resolved);
    const buffStart = findNthOccurrencePos(clause, buffName.toLowerCase(), occurrenceIndex);
    const { subject, object } = buffGrantSpan(clause, buffStart === -1 ? clause.length : buffStart);
    // A bestowing verb names its receiver in the OBJECT; a receiving verb ("gains") in the
    // SUBJECT. Scan both — which one carries it is the verb's business, not ours.
    const span = `${subject} ${object}`;
    const hits = FACTION_SCOPE_RES.filter(([, re]) => re.test(span)).map(([key]) => key);
    return hits.length > 0 ? hits : undefined;
}
```

Import `FACTIONS`, `FACTION_KEYS`, and `type FactionKey` from `../constants/factions`. If no
`escapeRegExp` helper exists in the file, inline
`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')` on the name.

- [ ] **Step 7: Pin the corpus measurement as a test**

Append to the test file from Step 2:

```ts
    it('matches exactly the 4 recipient-scoped clauses in the corpus, and none of the 31 named', () => {
        // Guards the ONE thing this detector must get right: a faction inside a buff NAME is not
        // a recipient scope. Counts come from the Step 1 measurement over all 149 ships.
        const rows = readFileSync('docs/ship-skills.csv', 'utf8');
        const scoped = rows.match(/\b(?:Tianchao|XAOC|Binderburg|Everliving|Gelecek|Marauders|MPL|Atlas Syndicate|Frontier Legion|Terran Combine)\s+all(?:y|ies)\b/gi) ?? [];
        expect(scoped).toHaveLength(4);
    });
```

- [ ] **Step 8: Wire the engine map (team-symmetric)**

In `src/utils/combat/engine.ts`, immediately after `nameByActorId` (~:3600):

```ts
    // #363: actor id → faction, for factionFilter'd ally scopes (Fuying's Tianchao Stealth grant
    // and her DR aura). Side-agnostic BY KEY, exactly like roleByActorId/nameByActorId above:
    // seeded from the focus actor, every walked team actor, and every enemy attacker, so an
    // ENEMY-side Fuying scopes to enemy Tianchao allies with no mirrored branch. An actor absent
    // from this map has an unknown faction and never matches a filter (conservative).
    const factionByActorId = new Map<string, FactionKey>();
    if (input.faction) factionByActorId.set(focusActorId, input.faction);
    for (const t of teamActors) if (t.faction) factionByActorId.set(t.id, t.faction);
    for (const e of input.enemyAttackers ?? []) if (e.faction) factionByActorId.set(e.id, e.faction);
    const factionOf = (id: string): FactionKey | undefined => factionByActorId.get(id);
```

Thread `factionOf` down to `runPlayerTurn`'s args the same way `roleOf` reaches
`registerReactiveListeners`, and have `playerTurn.ts`'s `supportRecipients` wrapper (~:1371) pass
both `factionFilter: source?.ability.factionFilter` and `factionOf` into
`resolveSupportRecipients`.

Add `faction?: FactionKey` to `TeamActorInput` (`src/types/calculator.ts` ~:393, beside `role`) and
to the enemy actor input, then set it in `battleSimulator.ts` from the existing
`PlacementPlan.faction` (already populated at :772).

- [ ] **Step 9: Build-site wiring**

At the `detectGrantScope` call site in `buildShipAbilities.ts` (~:5841 in the parser, plus the
ability assembly), attach the filter only when present, so every other ship's ability object is
byte-identical:

```ts
const factionFilter = detectGrantFactionScope(skillText, buffName, occurrenceIndex);
// … in the ability literal:
...(factionFilter ? { factionFilter } : {}),
```

- [ ] **Step 10: Verify**

Run: `npx vitest run src/utils/combat/__tests__/fuyingFactionScope.integration.test.ts`
Expected: PASS (6 tests).

Run: `npx tsc --noEmit && npm run lint`
Expected: clean.

**Prove the instrument.** Revert only the resolver change and re-run:
```bash
git checkout 2168ccf0 -- src/utils/combat/supportRecipients.ts
npx vitest run src/utils/combat/__tests__/fuyingFactionScope.integration.test.ts
```
Expected: the narrowing tests FAIL. Restore with `git checkout HEAD -- src/utils/combat/supportRecipients.ts`.
(Use `git checkout <ref> -- <path>`, never `git stash push <path>` — see Global Constraints.)

- [ ] **Step 11: Prove it is inert for the other 148 ships**

Run: `npx tsx scripts/writeKitLedger.ts` (or the existing kit-dump script) before and after, and
diff. Expected: **only Fuying's rows differ.** Any other ship moving means the detector is matching
a buff name — go back to Step 6.

Then: `npm test`. Expected: 0 failures. Fuying's fingerprint may move again (her Stealth grant now
reaches fewer allies) — re-baseline by hand, and confirm `git diff | grep -c '^+exports'` is `0`.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "fix(parser,engine): Fuying's Stealth grant honours its Tianchao scope (#363)

'grants Tianchao allies Stealth' built target:'all-allies' with the faction
word discarded. Stealth is a TARGETING-IMMUNITY status, so the over-grant did
not merely inflate a number — it made allies unselectable who should be
selectable. 14 of 149 ships are Tianchao, so on a typical five-ship team most
allies were wrongly protected.

In a fight: Fuying casts her active with Anjian (Tianchao) and Grif (XAOC) in
her pattern. Before, both went Stealthed and the enemy could target neither.
Now only Anjian does; Grif stays targetable.

The issue read the built target:'all-allies' as the defect. It is not — on the
cast path 'ally' and 'all-allies' resolve identically and both already narrow
by footprint (playerTurn.ts:3934-3947). The target is unchanged; the faction
predicate is what was missing.

factionFilter mirrors roleFilter at all five layers (type, engine map, actor
input, parser, editor) and is applied as an intersection AFTER footprint
narrowing, so it composes with the pattern. factionByActorId is side-agnostic
by key, so an enemy Fuying scopes to enemy Tianchao allies.

Unknown faction never matches (owner-approved, conservative). The detector
requires 'allies' right after the faction word, which keeps out all 32
corpus clauses where a faction is part of a BUFF NAME ('Tianchao Precision
II', 'XAOC Swiftness III') — verified inert for the other 148 ships."
```

---

## Task 4: Gap 2 — the ally-scoped Stealth DR aura

**Files:**
- Modify: `src/utils/abilities/buildShipAbilities.ts` (~:804 interface, ~:832 parser, ~:2866 build)
- Modify: `src/utils/combat/engine.ts` (~:3739 `incomingAbilitiesById`)
- Modify: `scripts/auditSkills.allowlist.ts:118-122` (remove the Fuying entry)
- Test: append to `src/utils/combat/__tests__/fuyingFactionScope.integration.test.ts`

**Interfaces:**
- Consumes: `Ability.factionFilter` and `factionOf` (Task 3).
- Produces: `ParsedIncomingDamageReduction` gains
  `target?: 'self' | 'all-allies'` and `factionFilter?: FactionKey[]`;
  `incomingAbilitiesOf(id)` now includes ally-scoped auras granted BY other actors.

- [ ] **Step 1: Confirm the gate already exists, and the aura currently does nothing**

`IncomingCondition` already has `'self-stealth'` (`abilities.ts:532`), consumed by `conditionMet`
(`incomingEffects.ts:8-10`) as `ctx.victimStealthed`. Wusheng already uses it from skill text. So
this task adds **no new condition** — only ally scope.

Verify the aura is absent from the built kit today:

```bash
npx tsx scripts/traceShip.ts Fuying 2>&1 | grep -i 'incoming-reduction' || echo 'ABSENT (expected)'
```

- [ ] **Step 2: Write the failing test**

Append to `fuyingFactionScope.integration.test.ts`:

```ts
import { incomingReductionForHit } from '../incomingEffects';

describe('Fuying Stealth DR aura (#363)', () => {
    it('builds an ally-scoped, faction-filtered direct-damage reduction at the R4 magnitude', () => {
        // buildTraceShip defaults to refitLevel 4 and getShipSkillRows returns only the
        // refit-active passive, so this is the R4 row → 30, not R2/R3's 15. No per-refit
        // branching is needed in the parser.
        const built = buildShipAbilities(fuyingShip());
        const aura = built.slots
            .flatMap((s) => s.abilities)
            .find((a) => a.config.type === 'incoming-reduction');
        expect(aura).toBeDefined();
        expect(aura!.target).toBe('all-allies');
        expect(aura!.factionFilter).toEqual(['TIANCHAO']);
        // OWNER-RULED 2026-08-22: the aura IS pattern-limited (a Stealthed Tianchao ally
        // standing OUTSIDE her pattern takes FULL damage). Reverses this spec's first draft.
        expect(aura!.patternScoped).toBe(true);
        expect(aura!.config).toMatchObject({
            type: 'incoming-reduction',
            scope: 'direct',
            condition: 'self-stealth',
            pct: 30,
            critFamily: false,
        });
    });

    it('reduces a DIRECT hit on a Stealthed ally but not a DoT tick', () => {
        const aura = {
            id: 'x',
            type: 'incoming-reduction',
            target: 'all-allies',
            trigger: 'on-cast',
            conditions: [],
            config: {
                type: 'incoming-reduction',
                scope: 'direct',
                condition: 'self-stealth',
                pct: 30,
                critFamily: false,
            },
        } as const;
        const base = {
            didCrit: false, attackerStealthed: false, victimStealthed: true,
            victimStasised: false, hitIndexThisRound: 1, attackerHasDot: false,
            victimHasBarrierRecharging: false, victimHasShield: false,
            attackerTauntedOrProvoked: false, selfHpPct: 100,
        };
        // Direct hit on a Stealthed victim → 30% off.
        expect(incomingReductionForHit([aura as never], base as never)).toBe(30);
        // Same victim, a DoT tick → the clause says "direct damage", so nothing.
        expect(
            incomingReductionForHit([aura as never], { ...base, dotType: 'inferno' } as never)
        ).toBe(0);
        // Not Stealthed → nothing.
        expect(
            incomingReductionForHit([aura as never], { ...base, victimStealthed: false } as never)
        ).toBe(0);
    });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run src/utils/combat/__tests__/fuyingFactionScope.integration.test.ts -t 'DR aura'`
Expected: FAIL — no `incoming-reduction` ability is built.

- [ ] **Step 4: Extend the parsed directive**

In `buildShipAbilities.ts`, add to `ParsedIncomingDamageReduction` (~:804):

```ts
    /** #363 (Fuying): the reduction applies to ALLIES, not the carrier. Absent → 'self', which
     *  is what all five pre-existing phrasings (Anemone/Panon/Wusheng/Tormenter/Voron) are. */
    target?: 'self' | 'all-allies';
    /** #363: restrict ally recipients to these factions. Only meaningful with target 'all-allies'. */
    factionFilter?: FactionKey[];
```

Add the regex inside `parseIncomingDamageReductionPhrasings`, after the Voron arm:

```ts
    // Fuying (#363): "All Tianchao allies with Stealth take N% less direct damage." The corpus's
    // first ALLY-scoped reduction — every arm above reduces damage on the CARRIER. The faction is
    // captured from the recipient phrase, so 'Tianchao Precision II' (a buff NAME) cannot reach
    // this arm: the pattern requires 'allies' right after the faction word.
    const allyAuraM =
        /all\s+([a-z]+(?:\s+[a-z]+)?)\s+allies\s+with\s+stealth\s+take\s+(\d+(?:\.\d+)?)%\s+less\s+direct\s+damage/i.exec(
            plain
        );
    if (allyAuraM) {
        const key = FACTION_KEYS.find(
            (k) => FACTIONS[k].name.toLowerCase() === allyAuraM[1].trim().toLowerCase()
        );
        // Unrecognised faction word → emit NOTHING, so audit:skills keeps reporting the clause
        // rather than silently applying an unfiltered ally-wide aura. Same closed-alternation
        // discipline as Prophet's 'Nx its <stat>' arm (#361).
        if (key) {
            out.push({
                scopes: ['direct'],
                condition: 'self-stealth',
                pct: parseFloat(allyAuraM[2]),
                target: 'all-allies',
                factionFilter: [key],
                matchIndex: allyAuraM.index,
            });
        }
    }
```

At the build site (~:2866), use the directive's target instead of the hardcoded `'self'`:

```ts
                    target: dir.target ?? 'self',
                    ...
                    ...(dir.factionFilter ? { factionFilter: dir.factionFilter } : {}),
```

- [ ] **Step 5: Fan the aura out in the engine**

In `engine.ts`, at `incomingAbilitiesById` (~:3739). The existing loop keys each actor's OWN
passive-slot abilities. Add a second pass that distributes ally-scoped ones.

> ⚠️ **SUPERSEDED — the sample originally printed here was written BEFORE the owner ruled the aura
> pattern-limited, and it is wrong in three ways. Do not implement it; the block below is the
> shipped shape. Read `src/utils/combat/incomingEffects.ts` and `engine.ts`'s own comments as the
> authority.**
>
> 1. It distributed to **every living same-side actor** narrowed only by faction. The owner then
>    ruled (spec §7 ruling 2) that the aura is **pattern-limited**: a Stealthed Tianchao ally
>    standing OUTSIDE Fuying's active pattern takes FULL damage. The shipped code carries
>    `patternScoped: true` on the ability and threads the owner's support footprint.
> 2. Its "⚠️ the owner IS a recipient" note argued the aura is **not** footprint-narrowed. The
>    no-owner-exclusion rule survived the ruling and is still correct — but its *reason* changed:
>    Fuying falls out of her own recipient set because her Not-Self pattern omits her own cell (and
>    `self-stealth` never holds for her), not because nothing narrows the set.
> 3. It said "the self-scoped collection above must be left untouched". That pass has to change:
>    without a skip it also keys the ally-scoped aura onto its own CARRIER — un-narrowed, since
>    Fuying is Tianchao and the faction filter passes — silently bypassing the footprint. The
>    shipped first pass skips `incoming-reduction` + `target: 'all-allies'`, and pass 2 is the sole
>    authority for that family.

```ts
    // Pass 1 (the pre-existing per-actor loop) gains ONE line, so an ally-scoped aura is not
    // keyed onto its own carrier un-narrowed. Deliberately narrow to 'incoming-reduction': every
    // member of the other four incoming families is `target: 'self'`.
    if (a.config.type === 'incoming-reduction' && a.target === 'all-allies') continue;

    // Pass 2 — #363 (Fuying): the corpus's first ALLY-scoped incoming reduction. Every other
    // member of this family is self-scoped, so the map has never needed to fan out. An
    // ally-scoped aura must land on the RECIPIENTS' lists, because incomingReductionForHit is
    // called with the VICTIM's abilities.
    //
    // Narrowing goes through the SAME shared composition every other #363 site uses
    // (`resolveSupportRecipients`: footprint first, then faction), wrapped as the pure,
    // directly-assertable `allyScopedIncomingRecipients`:
    //  • FOOTPRINT — consulted only when the ability is `patternScoped`. `footprintAllyIdsFor`
    //    returning `undefined` means "do not narrow" per this codebase's convention, so a
    //    non-positional fixture still sees the aura rather than being silenced.
    //  • FACTION — an actor whose faction is unknown never matches (conservative).
    //
    // ⚠️ NO OWNER EXCLUSION, and adding one would be a bug — see
    // `allyScopedIncomingRecipients`'s doc comment for the full argument.
    const allyScopedOwnerByRecipient = new Map<string, Map<string, string>>();
    for (const rt of [...runtimesById.values(), ...enemyPlayerRuntimeByActorId.values()]) {
        for (const slot of rt.castSkills.slots) {
            if (slot.slot !== 'passive') continue;
            for (const a of slot.abilities) {
                if (a.config.type !== 'incoming-reduction') continue;
                if (a.target !== 'all-allies') continue; // self-scoped → handled by pass 1
                const ownerSide = rt.actor.side;
                const recipients = allyScopedIncomingRecipients({
                    ability: a,
                    ownerId: rt.actor.id,
                    livingSameSideIds: actorsBySide(ownerSide)
                        .filter((x) => x.currentHp > 0)
                        .map((x) => x.id),
                    footprintAllyIds: bySide(ownerSide).footprintAllyIdsFor(rt.actor.id),
                    factionOf,
                });
                for (const recipientId of recipients) {
                    const list = incomingAbilitiesById.get(recipientId) ?? [];
                    addIncomingAbilityDeduped(list, a); // id-keyed, not object-identity
                    incomingAbilitiesById.set(recipientId, list);
                    const owners =
                        allyScopedOwnerByRecipient.get(recipientId) ?? new Map<string, string>();
                    if (!owners.has(a.id)) owners.set(a.id, rt.actor.id);
                    allyScopedOwnerByRecipient.set(recipientId, owners);
                }
            }
        }
    }
    // The RECIPIENT SET is fixed for the fight, but the OWNER's liveness is not: an ally-scoped
    // aura STOPS when its carrier dies (owner-ruled). The read-time filter on the list accessor
    // is what enforces that, and it leaves every self-scoped caller byte-identical.
    const incomingAbilitiesOf = (id: string): Ability[] =>
        withLiveAllyScopedOwners(
            incomingAbilitiesById.get(id) ?? [],
            allyScopedOwnerByRecipient.get(id),
            isActorAlive
        );
```

- [ ] **Step 6: Drop the allowlist entry**

Delete the `ship: 'Fuying'` / `rules: ['incoming-damage-reduction']` block at
`scripts/auditSkills.allowlist.ts:118-122`. Then run:

```bash
npx tsx scripts/auditSkills.ts
```
Expected: **0 findings.** A `incoming-damage-reduction` finding for Fuying means the parser arm did
not match; a finding for another ship means the arm is too greedy.

- [ ] **Step 7: Verify, and prove the fan-out**

Run: `npx vitest run src/utils/combat/__tests__/fuyingFactionScope.integration.test.ts`
Expected: PASS (all tests).

Add one assertion that the fan-out reached a real ally list, not just that a number came out — the
unit test in Step 2 calls `incomingReductionForHit` directly and so cannot see the engine's
distribution:

```ts
    it('the ENGINE puts the aura on a Tianchao ally and not on an XAOC ally', () => {
        // Build a 3v1 with Fuying + Anjian (Tianchao) + Grif (XAOC) and assert
        // incomingAbilitiesOf(anjian) contains the aura while incomingAbilitiesOf(grif) does not.
        // Model the harness on an existing engine integration test in this directory.
    });
```

Implement that assertion against the real engine entry point — the plan deliberately does not
hand you a fake, because a fake here would re-test Step 2 rather than the distribution.

- [ ] **Step 8: Full suite and snapshot check**

Run: `npm test`
Expected: 0 failures. Fuying's fingerprint gains reduction-related entries — re-baseline by hand.
Confirm `git diff src/utils/calculators/__tests__/__snapshots__/ | grep -c '^+exports'` is `0`.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(engine): Fuying's Stealth damage-reduction aura applies to Tianchao allies (#363)

The corpus's first ALLY-scoped incoming reduction. Every other member of the
family (Iridium/Anemone/Wusheng/Panon/Tormenter/Voron) reduces damage on the
CARRIER, so incomingAbilitiesById had never needed to fan out — it keyed each
actor's own passive slot, and the victim-side read never saw a teammate's aura.

In a fight: Fuying casts her active on turn 1, Stealthing Anjian. On turn 2 an
enemy attacker hits Anjian for 10000 — Anjian now takes 7000. Grif, XAOC and
unaffected, still takes the full 10000. When Anjian's Stealth expires the
reduction stops with it.

Gate reuse only: 'self-stealth' already existed and is already used by
Wusheng, so no new IncomingCondition. scope:'direct' means DoT ticks are
unreduced, matching 'direct damage'. patternScoped: true — OWNER-RULED, a
Stealthed Tianchao ally standing OUTSIDE her active pattern takes FULL damage.

The fan-out deliberately does NOT exclude the owner. Fuying falls out of her
own recipient set because her Not-Self pattern omits her own cell, and she is
doubly inert because self-stealth never holds for her. Hardcoding the
exclusion would encode a fact about her GRANT's pattern into the AURA's
recipient resolution.

Drops the #365 allowlist entry; audit:skills back to 0 findings."
```

---

## Task 5: Gap 3 — the cleanse count scales on crit power

**Files:**
- Modify: `src/types/abilities.ts:858-862` (the `countScaling` doc comment)
- Modify: `src/utils/skillTextParser.ts` (~:4928 `parseCleanse`)
- Modify: `src/utils/combat/playerTurn.ts` (extract the scaling helper from ~:3679-3691; apply in
  the cleanse branch ~:4356-4376)
- Modify: `src/utils/abilities/buildShipAbilities.ts` (pass `countScaling` through the cleanse path)
- Test: `src/utils/combat/__tests__/fuyingFactionScope.integration.test.ts` (append)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `scaledStatusCount(count: number | 'all', scaling: { stat: 'critDamage'; per: number } | undefined, effectiveCritDamage: number): number | 'all'`
  exported from `src/utils/combat/playerTurn.ts` (or a small sibling module) — used by BOTH the
  purge and cleanse branches.

- [ ] **Step 1: Write the failing test**

```ts
describe('Fuying crit-power-scaled cleanse (#363)', () => {
    it('parses countScaling off the cleanse clause', () => {
        const charged =
            'This Unit <unit-aid>cleanses 1 debuff</unit-aid> for every 50% crit power this ' +
            'Unit has and extends <unit-skill>Stealth</unit-skill> by 1 turn.';
        expect(parseCleanse(charged)[0]).toMatchObject({
            count: 1,
            countScaling: { stat: 'critDamage', per: 50 },
        });
    });

    it('scales the count on live crit power, and leaves an unscaled cleanse alone', () => {
        expect(scaledStatusCount(1, { stat: 'critDamage', per: 50 }, 150)).toBe(3);
        expect(scaledStatusCount(1, { stat: 'critDamage', per: 50 }, 149)).toBe(2); // floor
        expect(scaledStatusCount(1, { stat: 'critDamage', per: 50 }, 0)).toBe(0);
        expect(scaledStatusCount(2, undefined, 150)).toBe(2);
        // 'all' is never scaled — the existing purge guard's typeof check must survive the lift.
        expect(scaledStatusCount('all', { stat: 'critDamage', per: 50 }, 150)).toBe('all');
        // Defensive: a hand-built config must not yield Infinity/NaN.
        expect(scaledStatusCount(1, { stat: 'critDamage', per: 0 }, 150)).toBe(1);
    });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/utils/combat/__tests__/fuyingFactionScope.integration.test.ts -t 'scaled cleanse'`
Expected: FAIL — `scaledStatusCount` does not exist; `parseCleanse` returns no `countScaling`.

- [ ] **Step 3: Extract the helper**

`playerTurn.ts:3679-3691` holds the arithmetic inside the `purge` branch. Lift it verbatim,
preserving both guards:

```ts
/** Total statuses removed for a crit-power-scaled cleanse/purge: `count × floor(critPower / per)`.
 *  Shared by the purge branch (Amartya) and the cleanse branch (Fuying, #363).
 *
 *  `'all'` is NEVER scaled — the original purge guard's `typeof count === 'number'` check is
 *  load-bearing and is preserved here. `per <= 0` / non-finite returns the unscaled count so a
 *  hand-built config cannot produce Infinity/NaN. */
export function scaledStatusCount(
    count: number | 'all',
    scaling: { stat: 'critDamage'; per: number } | undefined,
    effectiveCritDamage: number
): number | 'all' {
    if (!scaling || typeof count !== 'number') return count;
    if (!Number.isFinite(scaling.per) || scaling.per <= 0) return count;
    return count * Math.max(0, Math.floor(effectiveCritDamage / scaling.per));
}
```

Replace the inline purge arithmetic with a call to it, then use it in the cleanse branch:

```ts
                    const cleanseCount = scaledStatusCount(
                        cfg.count,
                        cfg.countScaling,
                        effectiveCritDamage
                    );
                    for (const rid of recipientsFor(ability, fromPassive)) {
                        const removedForRid = statusEngine.cleanse(rid, cleanseCount);
```

`effectiveCritDamage` is already in scope in this function (`dmgStats.critDamage`, ~:1104) — the
caster's LIVE crit power with buffs folded, as an integer percent (150 = 150%). Hoist the call
outside the recipient loop: it is constant within a cast.

- [ ] **Step 4: Parser + build wiring**

In `parseCleanse` (~:4928), mirror the purge arm exactly — `CRIT_POWER_SCALING_RE` (:4696) and
`sentenceAround` are already in scope:

```ts
        const scaleMatch = CRIT_POWER_SCALING_RE.exec(sentence);
        const countScaling =
            scaleMatch && typeof count === 'number'
                ? { stat: 'critDamage' as const, per: parseInt(scaleMatch[1], 10) }
                : undefined;
        results.push({ count, target, explicitTarget,
            ...(debuffType ? { debuffType } : {}),
            ...(countScaling ? { countScaling } : {}) });
```

Add `countScaling?: { stat: 'critDamage'; per: number }` to `parseCleanse`'s return type (both the
signature and the internal `results` declaration — they are written out twice), pass it through in
`buildShipAbilities.ts`'s cleanse path, and fix the now-false doc comment on
`abilities.ts:858-862`:

```ts
          /** E4/#363: cleanse+purge count scales with a caster stat — total = count ×
           *  floor(effectiveStat / per). Only `critDamage` (crit power) today: Amartya
           *  ("purges 1 buff … for every 50% crit power") and Fuying ("cleanses 1 debuff for
           *  every 50% crit power"). Absent → static `count`. Never applies to count 'all'. */
```

- [ ] **Step 5: Verify, and prove Amartya did not move**

Run: `npx vitest run src/utils/combat/__tests__/fuyingFactionScope.integration.test.ts -t 'scaled cleanse'`
Expected: PASS.

Run the existing Amartya coverage: `npx vitest run -t 'Amartya'`
Expected: PASS, unchanged — the lift must be byte-identical for the pre-existing consumer. If any
Amartya assertion moves, the extraction changed behaviour; diff the helper against the original
block line by line.

Run: `npm test` → 0 failures. `npx tsc --noEmit && npm run lint` → clean.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "fix(engine): a crit-power-scaled cleanse count scales (#363)

'cleanses 1 debuff for every 50% crit power' flattened to count:1. The
countScaling field already existed on the shared cleanse|purge config for
Amartya's identically-worded purge — but the arithmetic lived INSIDE the purge
branch, and the field's own doc comment said 'cleanse never sets this'.

In a fight: Fuying at 150% crit power fires her charged skill. Before, she
cleansed 1 debuff from each ally in her pattern; now she cleanses 3. At 40%
crit power she cleanses 0 — floor(40/50) is 0, which is the clause read
literally.

Lifts the arithmetic to a shared scaledStatusCount() used by both branches,
preserving both original guards: 'all' is never scaled, and a non-finite or
non-positive 'per' returns the unscaled count rather than Infinity/NaN.
Verified byte-identical for Amartya."
```

---

## Task 6: Gap 4 — the named Stealth duration extension

**Files:**
- Modify: `src/types/abilities.ts:810` (`extend-status` config)
- Modify: `src/utils/combat/statusEngine.ts:263-266` (interface) and `:1341` (implementation)
- Modify: `src/utils/skillTextParser.ts` (~:1885 regexes, ~:1895 `parseExtendStatus`)
- Modify: `src/utils/abilities/buildShipAbilities.ts` (~:1777)
- Modify: `src/utils/combat/playerTurn.ts` (~:3792 the `statusKind` destructure and buff branch)
- Test: `src/utils/combat/__tests__/fuyingStealthExtension.test.ts` (create)

**Interfaces:**
- Consumes: Fuying's resolved charged-slot footprint (Task 2) — the extension is pattern-scoped
  for free because the existing executor already routes the buff branch through
  `supportRecipients`.
- Produces: `extend-status` config gains `buffName?: string`;
  `StatusEngine.extendAllBuffsDuration(actorId, turns, buffName?)`.

**Owner ruling (2026-08-22):** all allies within her active pattern, **faction-blind** — so this
task adds NO `factionFilter`. Her text names no faction here, unlike the active clause.

- [ ] **Step 1: Confirm the existing arms cannot match Fuying**

`EXTEND_STATUS_ACTIVE_RE` and `EXTEND_STATUS_PASSIVE_RE` (`skillTextParser.ts:1885-1888`) both
require a literal `buffs`/`debuffs` token. Fuying's clause says `extends Stealth by 1 turn`. Verify:

```bash
npx tsx -e "
import { parseExtendStatus } from './src/utils/skillTextParser';
console.log(parseExtendStatus('This Unit cleanses 1 debuff for every 50% crit power this Unit has and extends <unit-skill>Stealth</unit-skill> by 1 turn.'));
"
```
Expected: `null`. This is why a named arm cannot disturb Sokol, Ripper, or Lev.

- [ ] **Step 2: Write the failing test**

Create `src/utils/combat/__tests__/fuyingStealthExtension.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseExtendStatus } from '../../skillTextParser';
import { createStatusEngine } from '../statusEngine';

const FUYING_CHARGED =
    'This Unit <unit-aid>cleanses 1 debuff</unit-aid> for every 50% crit power this Unit has ' +
    'and extends <unit-skill>Stealth</unit-skill> by 1 turn.';

describe('Fuying named Stealth extension (#363)', () => {
    it('parses the named arm', () => {
        expect(parseExtendStatus(FUYING_CHARGED)).toEqual({
            turns: 1,
            statusKind: 'buff',
            buffName: 'Stealth',
        });
    });

    it('leaves the generic arms alone (Ripper)', () => {
        expect(
            parseExtendStatus('All allies extend their active Buffs by 1 turn.')
        ).toEqual({ turns: 1, statusKind: 'buff' });
    });

    it('extends ONLY the named buff, leaving siblings untouched', () => {
        const se = createStatusEngine(/* match the constructor used by neighbouring tests */);
        // Give one actor Stealth (1 turn) and Security Up III (2 turns).
        // Then: se.extendAllBuffsDuration('a', 1, 'Stealth')
        // Expect: Stealth -> 2, Security Up III -> 2 (unchanged), return value 1 (one affected).
    });

    it('with no buffName, still extends everything (Ripper unchanged)', () => {
        // se.extendAllBuffsDuration('a', 1) → both buffs grow, return value 2.
    });
});
```

Fill the two StatusEngine bodies against the real constructor — copy the setup from an existing
test in `src/utils/combat/__tests__/` that builds a `StatusEngine` and applies timed buffs.

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run src/utils/combat/__tests__/fuyingStealthExtension.test.ts`
Expected: FAIL — `parseExtendStatus` returns `null` for Fuying and takes no `buffName`.

- [ ] **Step 4: Config + StatusEngine**

`src/types/abilities.ts:810`:

```ts
    | {
          type: 'extend-status';
          statusKind: 'buff' | 'debuff';
          turns: number;
          /** #363 (Fuying): restrict the extension to statuses with this exact name
           *  ("extends Stealth by 1 turn"). Absent → extend EVERY eligible timed status of
           *  `statusKind`, which is what Sokol/Ripper/Lev do. */
          buffName?: string;
      }
```

`statusEngine.ts:1341` — add the filter and nothing else:

```ts
    const extendAllBuffsDuration = (
        actorId: string,
        turns: number,
        buffName?: string
    ): number => {
        const delta = Number.isFinite(turns) ? Math.trunc(turns) : 0;
        if (delta <= 0) return 0;
        const timedMap = selfMaps.get(actorId);
        if (!timedMap) return 0;
        let affected = 0;
        for (const [, s] of timedMap) {
            if (typeof s.turnsRemaining !== 'number') continue;
            if (isUnremovable(s.buffName, s.turnsRemaining)) continue;
            // #363: a NAMED extension touches only that status; absent → every eligible buff.
            if (buffName !== undefined && s.buffName !== buffName) continue;
            s.turnsRemaining += delta;
            affected++;
        }
        return affected;
    };
```

Update the interface declaration at `:266` to match. Leave `extendAllDebuffsDuration` alone — no
corpus clause needs a named debuff extension.

- [ ] **Step 5: Parser**

Add beside the existing arms (~:1888):

```ts
// #363 (Fuying): "extends <unit-skill>Stealth</unit-skill> by 1 turn" — a NAMED status, where the
// two arms above require a literal 'buffs'/'debuffs' token. Matched against the TAGGED text so the
// <unit-skill> boundary identifies the status name exactly, rather than guessing where a bare
// capitalised phrase ends. (Same reasoning as maskStatusNameRepairs in #362: the tag boundary is
// information, and stripping tags first throws it away.)
const EXTEND_NAMED_STATUS_RE =
    /extends?\s+<unit-skill>([^<]+)<\/unit-skill>\s+by\s+(\d+)\s+turns?/i;
```

In `parseExtendStatus`, try the named arm FIRST (it is strictly more specific), against the
**untagged-original** text:

```ts
export function parseExtendStatus(
    text: string | null | undefined
): { turns: number; statusKind: 'buff' | 'debuff'; buffName?: string } | null {
    if (!text) return null;
    // Named arm runs on the ORIGINAL text — it keys on the <unit-skill> tag boundary.
    const named = EXTEND_NAMED_STATUS_RE.exec(text);
    if (named) {
        return {
            turns: parseInt(named[2], 10),
            statusKind: 'buff',
            buffName: named[1].trim(),
        };
    }
    const plain = stripUnitTags(text);
    // … existing generic arms, unchanged …
}
```

`statusKind: 'buff'` is correct for Fuying and is the only corpus case; a named DEBUFF extension
would need its own decision and does not exist today.

- [ ] **Step 6: Build site + executor**

`buildShipAbilities.ts` (~:1802) — pass the name through when present:

```ts
                    type: 'extend-status',
                    statusKind: extendStatus.statusKind,
                    turns: extendStatus.turns,
                    ...(extendStatus.buffName ? { buffName: extendStatus.buffName } : {}),
```

`playerTurn.ts` (~:3792) — widen the destructure and forward the name in the buff branch only:

```ts
        const { statusKind, turns } = ab.config;
        const namedBuff = ab.config.type === 'extend-status' ? ab.config.buffName : undefined;
        …
            statusEngine.extendAllBuffsDuration(rid, turns, namedBuff);
```

The buff branch already builds `allyRoster` and narrows it through `supportRecipients`, so Fuying's
charged-slot extension is pattern-scoped with no further change. Confirm the target the parser
produced is `all-allies` and that **no `factionFilter` is attached** — the owner ruled this clause
faction-blind.

- [ ] **Step 7: Verify**

Run: `npx vitest run src/utils/combat/__tests__/fuyingStealthExtension.test.ts`
Expected: PASS (4 tests).

Run the existing generic-extend coverage: `npx vitest run -t 'extend'`
Expected: PASS, unchanged — Sokol, Ripper, and Lev must not move.

Run: `npm test` → 0 failures. `npx tsc --noEmit && npm run lint` → clean.

**Prove the instrument:** temporarily change the named arm's `statusKind` to `'debuff'` and confirm
the "extends ONLY the named buff" test FAILS. Revert.

- [ ] **Step 8: Changelog + commit**

Add to `UNRELEASED_CHANGES` in `src/constants/changelog.ts` — plain English, no emojis, one entry
covering the whole branch:

```
'Fuying now works as written: her Stealth grant and damage-reduction aura apply to Tianchao allies only, her charged skill cleanses more debuffs the higher her crit power, and it extends Stealth on allies in her pattern.',
```

```bash
git add -A
git commit -m "feat(engine): Fuying's charged skill extends Stealth on allies in her pattern (#363)

'extends Stealth by 1 turn' produced no ability at all. This is not
buff-duration-extension (the Boost gear set's always-on marker for buffs the
WEARER applies) — it extends an EXISTING named status on EXISTING holders.

It is, however, extend-status, which already does almost all of it: the
executor already handles statusKind:'buff' + target:'all-allies' for Ripper
and already narrows through supportRecipients, so the pattern scoping is free
once Fuying has targeting data. Adds an optional buffName to the config and a
name filter in extendAllBuffsDuration; absent means extend-everything, so
Sokol/Ripper/Lev are untouched.

In a fight: Fuying Stealths Anjian for 1 turn on her active. Her charged skill
then makes it 2, so Anjian stays untargetable — and keeps the 30% reduction —
for an extra round.

Faction-BLIND, per the owner: her text names no faction here, unlike the
active clause. The named arm matches the TAGGED text so the <unit-skill>
boundary identifies the status name exactly; the two generic arms require a
literal 'buffs'/'debuffs' token and cannot reach this clause."
```

---

## Task 7: Branch verification and PR

> Runs LAST — after Task 8.

- [ ] **Step 1: Full green, from a clean state**

```bash
npx tsc --noEmit && npm run lint && npm test && npx tsx scripts/auditSkills.ts
```
Expected: tsc clean, lint clean, **0 test failures, 0 snapshots written**, audit **0 findings**.
Report the actual file/test counts against the `556 / 6116` baseline.

- [ ] **Step 2: Confirm no unintended snapshot churn**

```bash
git diff 2168ccf0 --stat -- '*.snap'
git diff 2168ccf0 -- '*.snap' | grep -c '^+exports'
```
Expected: only `realKitFingerprints.test.ts.snap`, and `0` newly added keys. `shipCount` must still
read **149**.

- [ ] **Step 3: Prove the 148 other ships did not move**

Diff the kit ledger against `2168ccf0`. Expected: **Fuying's rows only.** Any other ship is a
regression in the faction detector or the reduction arm.

- [ ] **Step 4: Do NOT run `npm run format`**

It rewrites the whole tree and drags in main's pre-existing drift, which buries the real diff.
Format only the files you touched, if at all.

- [ ] **Step 5: Open the PR**

Body must state, per gap: what was wrong, the corpus-wide blast radius as MEASURED, the in-fight
example, and what stays open. Explicitly note that #362 (`Reversed Repairs`) is deliberately out of
scope and why, and that **#363 stays open only if** any of the four original gaps remains — if all
four ship, close it.

- [ ] **Step 6: CodeRabbit**

A rate-limited CodeRabbit reports **pass** — green does not mean reviewed. Verify through the
reviews API, and give it ~2 minutes before declaring a commit unreviewed. Its substantive feedback
can arrive as an inline reply on an **empty-body review**, so a `reviews[].body` check reads it as
nothing.

- [ ] **Step 7: Post-merge hygiene**

Untrack the spec, plan, and CSV (they live under gitignored `docs/`), following `7b94b444`. Delete
the branch. Update `#363` with what shipped and what did not.

---

### Task 8: Fuying's reactive Stasis honours its own "ally in Stealth" gate

**Owner-approved 2026-08-22 as in-scope for this branch** (same "with Stealth" clause family as the
DR aura, same ship, same passive). Runs BEFORE Task 7.

**The measured defect.** Her R3/R4 passive reads:

```
"When an ally in <unit-skill>Stealth</unit-skill> within the active pattern is directly damaged,
 this Unit inflicts <unit-skill>Stasis</unit-skill> for 1 turn onto the enemy."
```

The Stealth precondition is not checked at all. Measured at Task 3's HEAD, `plain` fingerprint
scenario: **40 `Stasis` log mentions, 0 `Stealth`.** It fires with nobody Stealthed anywhere. The
faction fix makes it *more* visibly wrong — a team with no Tianchao ally now never has anyone
Stealthed, and it still fires.

**Owner rulings that make this fully specifiable (spec §7a — do not re-derive):**
- Being hit does **not** consume Stealth. So there is no pre/post-hit ordering question: the
  damaged ally simply still holds Stealth when the reaction resolves. Gate on the ally's live
  status, no ordering rule, no state snapshot needed.
- Therefore the reaction may fire on **every** qualifying hit in the window. Do **not** invent a
  once-per-round or once-per-ally cap to tame the frequency — a cap is legitimate only if the
  ability's TEXT says so, and this text says nothing. If the observed rate looks high, that is the
  game, not a bug.
- Stealth affects only being *chosen* as a target, so a Stealthed ally really does take direct
  hits. The gate is reachable, not a corner case.

**Files:**
- Modify: `src/utils/combat/triggers.ts` — the `on-ally-attacked` reactive path (`roleFilter` and
  `requireDamagedAllyAdjacent` are the existing per-damaged-ally gates to mirror; grep
  `matchesRoleCategory` and `requireDamagedAllyAdjacent` in `registerReactiveListeners`)
- Modify: `src/types/abilities.ts` — a new per-damaged-ally status gate on `Ability`
- Modify: `src/utils/abilities/buildShipAbilities.ts` — set it from the parsed clause
- Modify: `src/utils/skillTextParser.ts` — detect "an ally in <named status>" in the trigger phrase
- Test: `src/utils/combat/__tests__/fuyingStasisStealthGate.integration.test.ts` (create)

**Interfaces:**
- Consumes: nothing from Tasks 4/6. Independent of the DR aura's mechanism.
- Produces: a gate field on `Ability` (name it for what it is — the DAMAGED ALLY must hold a named
  status — not `requireStealth`, since the mechanism is general even if Fuying is its only user).

- [ ] **Step 1: Reproduce the defect as a number, before changing anything**

Run the `plain` fingerprint scenario with Fuying as focus and count `Stasis` applications versus
`Stealth` grants in the combat log. Record both. Expected at base: Stasis ~40, Stealth 0.
This is the before-measurement; Step 6 compares against it.

- [ ] **Step 2: Write the failing test, through PRODUCTION slot routing**

Build Fuying's real kit via `buildTraceShip('Fuying')` (refitLevel 4 → the R4 passive) and
`buildShipAbilities(ship)` — note `buildShipAbilities` takes a **`Ship`**, not
`getShipSkillRows(ship)`. Two arms, both required:

- an ally who holds Stealth and is inside her pattern is damaged → Stasis IS inflicted
- an ally who holds NO Stealth is damaged → Stasis is NOT inflicted

The second arm is the one that fails today. Assert on the enemy's Stasis status (or the
`control-applied`/Stasis log rows), not on a count of log lines.

- [ ] **Step 3: Run it to verify it fails**

Expected: the no-Stealth arm FAILS (Stasis is inflicted when it should not be). The Stealth arm
may already pass — that is fine and expected; it is the negative arm that carries the defect.

- [ ] **Step 4: Parse the gate**

Detect the named status in the TRIGGER phrase ("an ally in `<unit-skill>Stealth</unit-skill>`"),
keying on the tag boundary the way `#362`'s `maskStatusNameRepairs` and Task 6's named-extend arm
do — the `<unit-skill>` tags identify the status name exactly, so do not guess where a bare
capitalised phrase ends. An unrecognised or absent status must yield **no gate**, leaving today's
behaviour, rather than a gate that matches nothing.

- [ ] **Step 5: Enforce it in the reactive listener**

Mirror `roleFilter`'s existing shape: it filters on the DAMAGED ally
(`registerReactiveListeners`, the `on-ally-attacked` branch, `e.targetId`). The new gate reads the
damaged ally's live status store. An ally whose status cannot be read must NOT satisfy the gate
(conservative, matching `matchesRoleCategory`'s unknown-never-matches rule).

- [ ] **Step 6: Verify, and re-measure**

Run your test (both arms green), then repeat Step 1's measurement. Stasis applications must drop
to only those hits where a Stealthed ally was struck. Report both numbers — before and after — and
sanity-check the after-number against the Stealth grants in the same log: Stasis should never
exceed the qualifying hits.

Then: `npm test` → 0 failures; `npx tsc --noEmit` and `npm run lint` → clean. Fuying's fingerprint
WILL move (fewer Stasis rows) — re-baseline **by hand**, and confirm
`git diff -- '*.snap' | grep -c '^+exports'` is `0`.

**Prove the instrument:** revert only `triggers.ts` and confirm the no-Stealth arm goes red again.
Use `git checkout <ref> -- <path>`, never `git stash push <path>`.

- [ ] **Step 7: Commit**

The message must carry the in-fight example: which ally, which turn, what the player sees before
and after, plus the before/after Stasis counts.

---

## Self-Review

**Spec coverage:** §1 Gap 0 → Task 2. §2 Gap 1 → Task 3 (§2.1a → Task 1, §2.2 → Task 3 Step 5,
§2.3 editor → Task 3 Step 9 + `AbilityCard.tsx` in File Structure, §2.4 → Task 3 Steps 1/7/11).
§3 Gap 2 → Task 4 (owner-in-fan-out → Step 5's comment + Step 7's engine assertion). §4 Gap 3 →
Task 5. §5 Gap 4 → Task 6. §6 ordering → task order. §7 testing/measurement → Global Constraints +
per-task prove-the-instrument steps. §8 not-gaps → no task touches them; the reactive Stasis and
Prophet's shield-pen allowlist entry are untouched.

**Fabricated-API audit (done, and it caught three):** every helper this plan's test code calls was
checked against the tree, because a plan that invents an API wastes the implementer's whole task.
Found and fixed: `getShipSkillRows(ship, { refits: 4 })` — the real signature takes ONE argument and
reads `ship.refits.length`, so refit level comes from `buildTraceShip(name, { refitLevel })`
instead; `shipDataByName()` — the real export is `loadShipDataRecords()` / `loadShipDataByName()`;
and reading corpus ships raw out of `docs/ship-data.json`, which carries no `chargeSkillCharge`
(that lives in `docs/ship-skills.csv`), so `parseShipTargeting` would have left `charged` undefined
for every ship and made the Task 2 charged-slot assertion vacuous. All three now route through
`buildTraceShip`, which merges both sources.

**Known soft spots, deliberately left for the implementer:** three code bodies are specified by
contract rather than transcribed — Task 4 Step 7's engine-level fan-out assertion, Task 6 Step 2's
two `StatusEngine` bodies, and the same-side roster accessor in Task 4 Step 5. Each needs a local
harness copied from a neighbouring test, and handing over a plausible-looking fake would risk a
vacuous fixture, which is the failure mode this plan is most concerned with. Each says so at the
point of use.

**Type consistency:** `FactionKey` (Task 1) is the type used by `Ability.factionFilter` (Task 3),
`resolveSupportRecipients`'s two new args (Task 3), `ParsedIncomingDamageReduction.factionFilter`
(Task 4), `TeamActorInput.faction` (Task 3), and `factionOf` (Tasks 3 and 4) — one name throughout,
never `FactionName`. `scaledStatusCount` (Task 5) has one signature, used by both the purge and
cleanse branches. `extendAllBuffsDuration`'s third parameter is `buffName?: string` in the
interface, the implementation, and the executor call (Task 6).
