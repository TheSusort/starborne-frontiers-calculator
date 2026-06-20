# E4 — Amartya Crit-Power-Scaled Purge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Amartya's charge purge count scale with the caster's live crit power — `count = configCount × floor(effectiveCritDamage / per)` — applied to every footprint victim, instead of the static parsed count of 1.

**Architecture:** Add an optional `countScaling` descriptor to the purge ability config. The parser (`parsePurge`) detects "for every N% crit power" in the purge sentence and attaches `{ stat: 'critDamage', per: N }`. `buildShipAbilities` threads it onto the config. The on-cast purge apply site (`playerTurn.ts:1421`) computes the live count from `effectiveCritDamage` (already in scope) when the descriptor is present, else uses the static count.

**Tech Stack:** TypeScript, Vitest. Combat engine in `src/utils/combat/`, skill parser in `src/utils/skillTextParser.ts`, ability builder in `src/utils/abilities/buildShipAbilities.ts`.

**Spec:** `docs/superpowers/specs/2026-06-20-combat-realism-E-tail-design.md` §3.

**Gameplay reference:** Amartya charge skill text — "This Unit deals 210% damage and purges 1 buff from all enemies for every 50% crit power this Unit has." `critDamage` is a percentage-only stat stored as an integer (base 50; e.g. 150 = 150%), so 150 crit power → 3 purges, 100 → 2, 50 → 1, <50 → 0.

**Faithful formula:** total purged = `count × floor(effectiveCritDamage / per)`. For Amartya, `count = 1` (the per-tier buff amount) and `per = 50`, so total = `floor(critDamage / 50)`. The `count ×` factor generalizes to a hypothetical "purges 2 buffs for every 50% crit power"; it is 1× for the only corpus match.

---

## Workflow notes (binding)

- `gh auth switch --hostname github.com --user TheSusort` before any PR ops; dev server on :3000.
- Run tests with `npx vitest run <path-or-name>` — **bare `npm test` is Vitest watch and hangs**.
- Run `npx tsc --noEmit` independently after each implementation step — esbuild-based Vitest does **not** typecheck, so a green test run can hide a type error.
- `npm run lint` enforces `--max-warnings 0`; run it in every task gate, not just the last.
- Goldens are synthetic → any `.snap` movement is a bug here (Amartya has no golden fixture). Never `vitest -u`.
- Branch off current `main`: `git checkout -b feat/combat-E4-amartya-crit-purge`.

---

## File structure

- `src/types/abilities.ts` — add optional `countScaling` to the cleanse/purge config union member (~line 261).
- `src/utils/skillTextParser.ts` — `parsePurge` (~2135) detects the crit-power phrase and returns `countScaling`; add a `CRIT_POWER_SCALING_RE`.
- `src/utils/abilities/buildShipAbilities.ts` — thread `p.countScaling` into the emitted purge config (~1100).
- `src/utils/combat/playerTurn.ts` — compute the live count at the on-cast purge apply site (~1421).
- `src/utils/__tests__/skillTextParser.test.ts` — parser test for the scaling extraction.
- `src/utils/combat/__tests__/amartyaCritPurge.test.ts` (new) — apply-side integration: count scales with live crit power, 0-count edge, per-victim in AoE.
- `src/constants/changelog.ts` — `UNRELEASED_CHANGES` entry.

---

## Task 0: Baseline

**Files:** none (verification only).

- [ ] **Step 1: Branch off local main + confirm green baseline**

Branch off the current local `main` as-is (do NOT `git pull` mid-task — remote ops need `gh auth switch` first and docs are gitignored; local main is already current from the start of this session).
Run:
```bash
git checkout -b feat/combat-E4-amartya-crit-purge
npx tsc --noEmit && npm run lint
npm run audit:skills
```
Expected: tsc clean, lint clean, `audit:skills` → `Audited 141 ships → 0 findings.`

- [ ] **Step 2: Read-confirm Amartya's parse (no code, no scratch test)**

Pure read-confirm (the permanent assertion lives in Task 2's test). Amartya's charge text "purges 1 buff from all enemies for every 50% crit power this Unit has" → `parsePurge` returns `{ count: 1, target: 'all-enemies', explicitTarget: true }` (the `all enemies` clause → `'all-enemies'`), and the charged slot sets `trigger: 'on-cast'` in `buildShipAbilities` (buildShipAbilities.ts:1084-1085: `slot === 'charged' → 'on-cast'`). The per-victim AoE claim depends on `target === 'all-enemies'`. No change here.

---

## Task 1: Add `countScaling` to the purge config type

**Files:**
- Modify: `src/types/abilities.ts:261`

- [ ] **Step 1: Extend the union member**

Change:
```ts
    | { type: 'cleanse' | 'purge'; count: number | 'all' }
```
to:
```ts
    | {
          type: 'cleanse' | 'purge';
          count: number | 'all';
          /** E4: purge count scales with a caster stat — total purged =
           *  count × floor(effectiveStat / per). Only `critDamage` (crit power) is
           *  used today (Amartya: "purges 1 buff … for every 50% crit power").
           *  Absent → static `count`. cleanse never sets this. */
          countScaling?: { stat: 'critDamage'; per: number };
      }
```

- [ ] **Step 2: Verify it compiles (field is optional → no consumer breaks)**

Run: `npx tsc --noEmit`
Expected: clean (optional field, no existing consumer references it).

- [ ] **Step 3: Commit**

```bash
git add src/types/abilities.ts
git commit -m "feat(combat): E4 — add countScaling to purge ability config (unwired)"
```

---

## Task 2: Parser — extract "for every N% crit power"

**Files:**
- Modify: `src/utils/skillTextParser.ts` (`parsePurge` ~2135; add `CRIT_POWER_SCALING_RE` near `PURGE_RE` ~2119)
- Test: `src/utils/__tests__/skillTextParser.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `skillTextParser.test.ts` (near the existing purge tests):
```ts
describe('parsePurge — E4 crit-power scaling', () => {
    it('extracts countScaling from "for every 50% crit power"', () => {
        const text =
            'This Unit deals 210% damage and purges 1 buff from all enemies for every 50% crit power this Unit has.';
        const [p] = parsePurge(text);
        expect(p).toMatchObject({
            count: 1,
            target: 'all-enemies',
            countScaling: { stat: 'critDamage', per: 50 },
        });
    });

    it('leaves countScaling undefined for a plain purge', () => {
        const [p] = parsePurge('This Unit purges 2 buffs from the enemy.');
        expect(p.count).toBe(2);
        expect(p.countScaling).toBeUndefined();
    });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run skillTextParser -t "crit-power scaling"`
Expected: FAIL — `countScaling` is `undefined` (not yet returned).

- [ ] **Step 3: Implement**

Near `PURGE_RE` (~2119) add:
```ts
// E4: "for every N% crit power" — purge-count scaling on crit power (Amartya).
// Sentence-scoped (applied to the purge's own sentence). Matches "for every 50% crit power".
const CRIT_POWER_SCALING_RE = /for\s+every\s+(\d+)\s*%?\s*crit\s+power/i;
```

In `parsePurge`, widen the return type and attach the descriptor. Change the return-type annotation and the `results` array element type to include the optional field:
```ts
): {
    count: number | 'all';
    target: 'enemy' | 'all-enemies';
    explicitTarget: boolean;
    countScaling?: { stat: 'critDamage'; per: number };
}[] {
```
(apply the same addition to the local `results` declaration).

Then inside the loop, after computing `sentence` (~2160), before `results.push`:
```ts
        const scaleMatch = CRIT_POWER_SCALING_RE.exec(sentence);
        const countScaling =
            scaleMatch && typeof count === 'number'
                ? ({ stat: 'critDamage' as const, per: parseInt(scaleMatch[1], 10) })
                : undefined;
        results.push({ count, target, explicitTarget: true, ...(countScaling ? { countScaling } : {}) });
```
(`sentence` is already lower-cased at ~2160; `CRIT_POWER_SCALING_RE` is case-insensitive regardless. Guard `typeof count === 'number'` so a nonsensical "purges all … per 50% crit power" never carries scaling.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run skillTextParser -t "crit-power scaling"`
Expected: PASS (both cases).

- [ ] **Step 5: Full parser suite + tsc**

Run: `npx vitest run skillTextParser && npx tsc --noEmit`
Expected: all green, tsc clean (no other parsePurge consumer broke — `buildShipAbilities` reads `p.count`/`p.target` only, both unchanged).

- [ ] **Step 6: Commit**

```bash
git add src/utils/skillTextParser.ts src/utils/__tests__/skillTextParser.test.ts
git commit -m "feat(combat): E4 — parse 'for every N% crit power' purge scaling

Amartya charge confirmed to parse as on-cast all-enemies purge, count 1."
```

---

## Task 3: Thread `countScaling` into the built ability

**Files:**
- Modify: `src/utils/abilities/buildShipAbilities.ts:1100`
- Test: extend `src/utils/__tests__/skillTextParser.test.ts` OR a buildShipAbilities test if one exists for purge (check `src/utils/abilities/__tests__/`).

- [ ] **Step 1: Write the failing test**

Build the ability from Amartya's charged-slot text and assert the config carries `countScaling`. `abilitiesIntegration.test.ts` exercises `type: 'purge'` and shows the `ShipSkills`/`slots` fixture shape to copy; the charged slot MUST carry Amartya's exact charge text so `buildShipAbilities` sets `trigger: 'on-cast'` (buildShipAbilities.ts:1084-1085). Add a case there or in the parser test file:
```ts
import { buildShipAbilities } from '../abilities/buildShipAbilities';
// ...
it('E4: built Amartya charge purge carries countScaling', () => {
    const abilities = buildShipAbilities(/* Amartya rows — mirror an existing build test's fixture */);
    const purge = abilities.find(
        (a) => a.config.type === 'purge' && a.trigger === 'on-cast'
    );
    expect(purge?.config).toMatchObject({
        type: 'purge',
        count: 1,
        countScaling: { stat: 'critDamage', per: 50 },
    });
});
```
NOTE: match the exact `buildShipAbilities` call signature used by existing tests in the repo (do not invent fixture shape — copy a working call).

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run buildShipAbilities -t "countScaling"` (or the parser file if co-located)
Expected: FAIL — `countScaling` absent from the built config.

- [ ] **Step 3: Implement**

At `buildShipAbilities.ts:1100`, change:
```ts
                config: { type: 'purge', count: p.count },
```
to:
```ts
                config: {
                    type: 'purge',
                    count: p.count,
                    ...(p.countScaling ? { countScaling: p.countScaling } : {}),
                },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run buildShipAbilities -t "countScaling" && npx tsc --noEmit`
Expected: PASS, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/utils/abilities/buildShipAbilities.ts src/utils/__tests__/skillTextParser.test.ts
git commit -m "feat(combat): E4 — thread purge countScaling into the built ability"
```

---

## Task 4: Apply — live count at the on-cast purge site

**Files:**
- Modify: `src/utils/combat/playerTurn.ts:1421`
- Test: `src/utils/combat/__tests__/amartyaCritPurge.test.ts` (new)

- [ ] **Step 1: Write the failing integration test**

Create `src/utils/combat/__tests__/amartyaCritPurge.test.ts`. Mirror the harness in the existing `aoePurge.test.ts` (E3) — copy its `runCombat`/positional setup and adapt. Assert:
  1. A caster with `critDamage: 150` purging an enemy carrying ≥3 removable buffs removes **3**.
  2. `critDamage: 100` → removes **2**.
  3. `critDamage: 40` → removes **0** (no `purge-performed` event for that victim).
  4. In an `all-enemies` AoE over 2 footprint victims each with ≥3 buffs, **each** victim loses 3 (per-victim count independence).

Use a synthetic caster ability `{ type: 'purge', target: 'all-enemies', trigger: 'on-cast', config: { type: 'purge', count: 1, countScaling: { stat: 'critDamage', per: 50 } } }` (build via the same path the E3 test uses, or inject through the ship-skills fixture). Set the caster's effective crit power via its stats (no buffs → base critDamage).

```ts
// Sketch — adapt exact construction to aoePurge.test.ts's harness:
it('purges floor(critDamage/50) buffs per victim (150 → 3)', () => {
    const result = runScenario({ casterCritDamage: 150, victimBuffs: 4 });
    expect(buffsRemovedFor(result, 'enemy-1')).toBe(3);
});
it('0 crit power tiers → no purge, no event (40 → 0)', () => {
    const result = runScenario({ casterCritDamage: 40, victimBuffs: 4 });
    expect(purgeEvents(result)).toHaveLength(0);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run amartyaCritPurge`
Expected: FAIL — counts come back as 1 (static `ab.config.count`), 0-case removes 1, etc.

- [ ] **Step 3: Implement**

At `playerTurn.ts:1420-1421`, replace:
```ts
                for (const vid of recipients) {
                    const removed = statusEngine.purge(vid, ab.config.count);
```
with:
```ts
                // E4: when the purge scales on crit power, total purged per victim =
                // count × floor(live effectiveCritDamage / per). effectiveCritDamage (declared
                // ~line 1104 = dmgStats.critDamage) is the caster's LIVE crit power (buffs/debuffs
                // folded), integer percent (e.g. 150). Else the static parsed count.
                const scaling = ab.config.countScaling;
                const purgeCount: number | 'all' =
                    scaling && typeof ab.config.count === 'number'
                        ? ab.config.count * Math.floor(effectiveCritDamage / scaling.per)
                        : ab.config.count;
                for (const vid of recipients) {
                    const removed = statusEngine.purge(vid, purgeCount);
```
(`purgeCount` is hoisted out of the victim loop — same value for every footprint victim; the caster's crit power is constant within the cast.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run amartyaCritPurge`
Expected: PASS (150→3, 100→2, 40→0/no event, per-victim 3 each).

- [ ] **Step 5: tsc + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean. (`ab.config` is narrowed to the purge member by the `ab.config.type === 'purge'` guard at ~1408, so `.countScaling` and `.count` are accessible.)

- [ ] **Step 6: Commit**

```bash
git add src/utils/combat/playerTurn.ts src/utils/combat/__tests__/amartyaCritPurge.test.ts
git commit -m "feat(combat): E4 — purge count scales with live crit power, per footprint victim"
```

---

## Task 5: Changelog + full-suite gate

**Files:**
- Modify: `src/constants/changelog.ts` (`UNRELEASED_CHANGES`)

- [ ] **Step 1: Add the changelog entry**

Add to `UNRELEASED_CHANGES` (plain English, user-facing):
```text
"Amartya's charge purge now removes more buffs the higher its crit power (1 buff per 50% crit power), matching the in-game scaling, applied to every enemy hit."
```
(Match the existing array's quoting/format exactly.)

- [ ] **Step 2: Full gate**

Run:
```bash
npx vitest run
npx tsc --noEmit
npm run lint
npm run audit:skills
```
Expected: all tests green (new tests included), **zero `.snap` movement** (`git status` shows no modified `.snap`), tsc clean, lint clean, `audit:skills` → `0 findings` over 141 ships.

- [ ] **Step 3: Confirm no golden churn explicitly**

Run: `git status --porcelain | grep -E '\.snap$'`
Expected: **no output** (Amartya has no golden fixture; the change is gated behind `countScaling`, absent on every existing purge).

- [ ] **Step 4: Commit**

```bash
git add src/constants/changelog.ts
git commit -m "feat(combat): E4 — changelog (Amartya crit-power purge scaling)"
```

---

## Done criteria

- Amartya's charge purge removes `floor(critDamage / 50)` buffs per enemy, live each cast.
- 0-count edge emits no `purge-performed`.
- Per-victim independence in AoE preserved (each footprint victim purged at the same count).
- All goldens byte-identical (zero `.snap` movement); 141/141 skill audit clean; tsc + lint clean.
- New parser test + apply-side integration test green.

## Out of scope (→ E5, separate plan)

Symmetric enemy healing, the Nayra repaired-this-round light-up, the `baseHpById` enemy seed, detonation per-victim intake, death-fallback DRY. None are touched here.
