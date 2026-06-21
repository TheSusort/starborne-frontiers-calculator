# D-PR9 — Ally-wide / New-trigger Reactive Buff Grants Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two implant abilities to the combat sim — Spearhead (fully live) and Font of Power (trigger live, buff emit-only) — each riding one new reactive trigger on the existing D-PR8 reactive-buff machinery.

**Architecture:** Two new self-scoped reactive triggers (`on-charged-cast` on the existing `skill-fired` event; `on-own-repair-to-ally` on the existing `heal-performed` event) register listeners that enqueue buff-grant intents through the existing reactive buff executor + `passesProcChanceGate`. Spearhead grants all allies `Attack Up I` (a real, folding buff). Font of Power grants every repaired non-self ally `Power Infused Nanobots` — a new corpus buff with no parseable effect (emit-only this PR; the caster-attack-snapshot flat-attack fold is deferred to D-PR10).

**Tech Stack:** TypeScript, Vitest. Combat engine under `src/utils/combat/`, equipment-ability registry under `src/utils/abilities/`.

**Worktree:** `.worktrees/d-pr9-ally-reactive-buffs`, branch `feat/combat-d-pr9-ally-reactive-buffs`, stacked on D-PR8 tip `9c8f5f7e`. All commands run from the worktree root.

**Spec:** `docs/superpowers/specs/2026-06-21-implant-gearset-abilities-D-pr9-design.md`

**Load-bearing invariant (every D PR):** No existing combat fixture carries effect-bearing implants/gear, so ALL DPS/healing golden snapshots stay BYTE-IDENTICAL. If a golden moves, a gate leaked — fix the gate, NEVER run `vitest -u` on goldens. New behavior is proven by NEW tests only.

**Workflow notes:**
- `docs/` is gitignored → `git add -f` for the spec/plan; commit docs-only changes with `--no-verify` (the pre-commit hook runs the full vitest suite).
- `git push` progress output can crash the Bash tool — pipe through `| cat` and/or use `--no-verify`.
- Commit messages end with the `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer.

---

## File Structure

**Modify:**
- `src/types/abilities.ts` — add `on-charged-cast` + `on-own-repair-to-ally` to the `AbilityTrigger` union and `LIVE_TRIGGERS` set.
- `src/utils/combat/triggers.ts` — two new listener cases in `registerReactiveListeners`; `repairedAllyIds?: string[]` on the `Intent.eventCtx` type; extend the buff-branch recipient resolution.
- `src/utils/abilities/buildEquipmentAbilities.ts` — proc-chance tables + `SPEARHEAD` and `FONT_OF_POWER` registry entries.
- `src/constants/buffs.ts` — add the `Power Infused Nanobots` entry.
- `src/utils/dataUpdate/updateBuffsData.ts` — widen generator value-type + interface template to carry `type`/`imageKey`; add `MANUAL_BUFFS` so a regen preserves the implant-only buff.
- `src/utils/abilities/__tests__/equipmentCoverage.test.ts` — register both implants as implemented.
- `src/constants/changelog.ts` — `UNRELEASED_CHANGES` entry.

**Create (tests):**
- New cases in `src/utils/combat/__tests__/equipmentAbilities.integration.test.ts` (engine-level Spearhead + Font of Power; mirror the existing harness in that file and in `reactiveBuffProcGate.test.ts`).
- New cases in `src/utils/combat/__tests__/enemyReactiveSelfBuffs.test.ts` (team-agnostic mirror).
- A small unit assertion for the buff corpus entry (in `buildEquipmentAbilities.test.ts` or a focused buffs test).

---

## Task 1: Spearhead — `on-charged-cast` trigger + registry entry (fully LIVE)

**Files:**
- Modify: `src/types/abilities.ts` (`AbilityTrigger` union ~line 43-73; `LIVE_TRIGGERS` ~line 83-106)
- Modify: `src/utils/combat/triggers.ts` (`registerReactiveListeners` switch, alongside the `on-crit` case ~line 233)
- Modify: `src/utils/abilities/buildEquipmentAbilities.ts` (proc table ~line 215-230 block; `IMPLANT_ABILITIES` ~line 586-610)
- Test: `src/utils/combat/__tests__/equipmentAbilities.integration.test.ts`

- [ ] **Step 1: Write the failing integration test (Spearhead grant + LIVE effect)**

In `equipmentAbilities.integration.test.ts`, add a `describe('Spearhead — on-charged-cast all-allies Attack Up I', ...)`. Mirror the combat-building harness already used in that file (and in `reactiveBuffProcGate.test.ts`) to set up a two-actor player team where the focus carries a legendary `SPEARHEAD` implant (via the `getGearPiece` arg to the equipment-aware ability builder / `simulateBattle`) and has enough charges to fire its charged skill on its turn.

Assert (procChance forced to 1 for determinism — see Step 4 note):
- After the carrier's charged-skill turn, every player ally (including the carrier) carries the `Attack Up I` buff (assert via the round's buff state / a `buff-applied` event for `Attack Up I`).
- An ally's outgoing damage in a round where `Attack Up I` is active is strictly greater than the same ally's damage with no Spearhead equipped (LIVE-effect proof — `Attack Up I` is `+15% Attack` and folds).
- When the carrier fires its ACTIVE skill (insufficient charges), NO `Attack Up I` is granted.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/utils/combat/__tests__/equipmentAbilities.integration.test.ts -t Spearhead`
Expected: FAIL — no `Attack Up I` granted (no trigger/registry entry yet).

- [ ] **Step 3: Add the `on-charged-cast` trigger to the type system**

In `src/types/abilities.ts`, add to the `AbilityTrigger` union (next to the other self-scoped triggers):
```ts
    // Fired when the owner performs its CHARGED skill (rides the existing skill-fired
    // event's slot discriminator). Self-scoped: the listener matches actorId === ownerId
    // && slot === 'charged'. Used by the Spearhead implant (all-allies Attack Up grant).
    | 'on-charged-cast'
```
And add `'on-charged-cast',` to the `LIVE_TRIGGERS` set.

- [ ] **Step 4: Add the listener case in `registerReactiveListeners`**

In `src/utils/combat/triggers.ts`, inside the `switch (ra.ability.trigger)` (e.g. right after the `on-crit` case ~line 254), add:
```ts
                case 'on-charged-cast':
                    bus.on('skill-fired', (e) => {
                        // Self-scoped: THIS owner performed its CHARGED skill. The skill-fired
                        // event carries slot:'active'|'charged' (events.ts). Team-agnostic —
                        // enemy actors run the same turn path and emit skill-fired too; the
                        // ownerId guard self-scopes per registered owner. One enqueue per cast.
                        if (e.actorId === ownerId && e.slot === 'charged') enqueue(intent);
                    });
                    break;
```

- [ ] **Step 5: Add the proc table + registry entry**

In `src/utils/abilities/buildEquipmentAbilities.ts`, add a proc table near the other D-PR8 tables (~line 230):
```ts
// D-PR9: Spearhead — after the charged skill, X% chance to grant all allies Attack Up I for 1 turn.
const SPEARHEAD_PROC: Record<string, number> = {
    common: 0.15,
    uncommon: 0.18,
    rare: 0.21,
    epic: 0.26,
    legendary: 0.32,
};
```
And add to `IMPLANT_ABILITIES` (alongside the D-PR8 entries ~line 610, before the closing `}`):
```ts
    // D-PR9: Spearhead — after using the charged skill, X% chance to grant all allies
    // Attack Up I for 1 turn. LIVE (Attack Up I folds into attack). Rides on-charged-cast.
    SPEARHEAD: (rarity) => {
        const procChance = SPEARHEAD_PROC[rarity];
        if (procChance === undefined) return undefined;
        return mkNamedBuffGrant('Attack Up I', 'all-allies', 'on-charged-cast', 1, { procChance });
    },
```

- [ ] **Step 6: Run the Spearhead test to verify it passes**

Run: `npx vitest run src/utils/combat/__tests__/equipmentAbilities.integration.test.ts -t Spearhead`
Expected: PASS. (For determinism, the test should force the proc — e.g. the harness's RNG seeding or a procChance-of-1 path used by `reactiveBuffProcGate.test.ts`. Follow that file's approach to make the gate deterministic.)

- [ ] **Step 7: Commit**

```bash
git add src/types/abilities.ts src/utils/combat/triggers.ts src/utils/abilities/buildEquipmentAbilities.ts src/utils/combat/__tests__/equipmentAbilities.integration.test.ts
git commit -m "feat(combat): D-PR9 Spearhead — on-charged-cast all-allies Attack Up I

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `Power Infused Nanobots` buff corpus entry (+ regen safety)

**Files:**
- Modify: `src/constants/buffs.ts` (add one entry)
- Modify: `src/utils/dataUpdate/updateBuffsData.ts` (value-type + interface template + `MANUAL_BUFFS`)
- Test: `src/utils/abilities/__tests__/buildEquipmentAbilities.test.ts` (or a focused buffs assertion)

- [ ] **Step 1: Write the failing test (corpus presence + emit-only proof)**

Add a test asserting:
- `BUFFS.find(b => b.name === 'Power Infused Nanobots')` is defined with `type: 'buff'`.
- `parseBuffEffects('Power Infused Nanobots', <its description>)` returns no parsed stat effect (empty / all-zero) — proving emit-only (the description has no `[+-]N%`-signed attack term, so the attack regex in `buffParser.ts` does not match).

Run: `npx vitest run src/utils/abilities/__tests__/buildEquipmentAbilities.test.ts -t "Power Infused Nanobots"`
Expected: FAIL — buff not found.

- [ ] **Step 2: Add the committed corpus entry**

In `src/constants/buffs.ts`, add (anywhere in the `BUFFS` array; match the committed interface which carries `type`):
```ts
    {
        name: 'Power Infused Nanobots',
        description: "Grants attack equal to 100% of the caster's attack",
        type: 'buff',
    },
```

- [ ] **Step 3: Make a regen clobber-safe in `updateBuffsData.ts`**

The generator currently writes a `{ name, description }`-only interface and `buffsMap` value type, which would strip the committed `type`/`imageKey` fields (and drop this implant-only buff) on the next `npm run fetch-buffs`. Apply two changes:

(a) Widen the in-memory value type and the emitted `Buff` interface template to include `type` and `imageKey?` so a regen preserves the committed shape. In the file-content template string, change the interface to:
```ts
export interface Buff {
    name: string;
    description: string;
    type?: 'buff' | 'debuff' | 'effect';
    imageKey?: string;
}
```
and widen the `buffsMap`/`buffsArray` types accordingly (carry `type`/`imageKey` through from the fetched buffs).

(b) Add a `MANUAL_BUFFS` supplement (parallel to `MANUAL_DESCRIPTION_OVERRIDES`), merged into `buffsMap` before the array is built:
```ts
// Implant-only buffs that never appear in ship-buff fetch data and so are never
// produced upstream — re-added here so a regen preserves them. (D-PR9: Font of Power.)
const MANUAL_BUFFS: Array<{ name: string; description: string; type: 'buff' | 'debuff' | 'effect' }> = [
    {
        name: 'Power Infused Nanobots',
        description: "Grants attack equal to 100% of the caster's attack",
        type: 'buff',
    },
];
```
Merge it (after the description-overrides loop, before `Array.from`):
```ts
for (const b of MANUAL_BUFFS) {
    if (!buffsMap.has(b.name)) buffsMap.set(b.name, b);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/utils/abilities/__tests__/buildEquipmentAbilities.test.ts -t "Power Infused Nanobots"`
Expected: PASS.

- [ ] **Step 5: Lint/typecheck the generator change**

Run: `npm run lint -- src/utils/dataUpdate/updateBuffsData.ts` (do NOT run `fetch-buffs` — it hits the network and rewrites the file).
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/constants/buffs.ts src/utils/dataUpdate/updateBuffsData.ts src/utils/abilities/__tests__/buildEquipmentAbilities.test.ts
git commit -m "feat(combat): D-PR9 add Power Infused Nanobots buff (corpus + regen-safe)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Font of Power — `on-own-repair-to-ally` trigger + routing + registry entry (emit-only)

**Files:**
- Modify: `src/types/abilities.ts` (`AbilityTrigger` union + `LIVE_TRIGGERS`)
- Modify: `src/utils/combat/triggers.ts` (`Intent.eventCtx` type ~line 97-105; new listener case; buff-branch recipient resolution ~line 1036-1041)
- Modify: `src/utils/abilities/buildEquipmentAbilities.ts` (proc table + `FONT_OF_POWER` entry)
- Test: `src/utils/combat/__tests__/equipmentAbilities.integration.test.ts`

- [ ] **Step 1: Write the failing integration test (Font of Power emit-only grant)**

Add a `describe('Font of Power — on-own-repair-to-ally Power Infused Nanobots', ...)`. Set up a player team where the focus is a healer carrying a legendary `FONT_OF_POWER` implant and repairs ≥1 other ally. Force the proc deterministically.

Assert:
- After the carrier repairs another ally, every repaired non-self ally carries the `Power Infused Nanobots` buff (presence only — emit-only, so assert the buff is present; do NOT assert any stat/damage change).
- A pure self-only heal (no other ally repaired) grants NOTHING.
- An AoE heal of N other allies grants `Power Infused Nanobots` to all N (from a single proc).
- The carrier itself does NOT receive the buff (recipients are the repaired allies, excluding the caster).

Run: `npx vitest run src/utils/combat/__tests__/equipmentAbilities.integration.test.ts -t "Font of Power"`
Expected: FAIL — no buff granted.

- [ ] **Step 2: Add the `on-own-repair-to-ally` trigger to the type system**

In `src/types/abilities.ts`, add to the `AbilityTrigger` union:
```ts
    // Fired when the owner applies repair to at least one OTHER ally (own heal-performed
    // event with a non-self recipient). Used by the Font of Power implant (grants the
    // repaired allies a buff). Distinct from on-ally-critically-repaired (no crit filter).
    | 'on-own-repair-to-ally'
```
And add `'on-own-repair-to-ally',` to `LIVE_TRIGGERS`.

- [ ] **Step 3: Add `repairedAllyIds` to the `Intent.eventCtx` type**

In `src/utils/combat/triggers.ts`, in the `Intent.eventCtx` object type (~line 97-105), add:
```ts
        /** The actor ids of the allies repaired by an on-own-repair-to-ally event
         *  (excludes the caster). The buff branch fans an 'ally'-target grant out to
         *  exactly these recipients (Font of Power → repaired allies). */
        repairedAllyIds?: string[];
```

- [ ] **Step 4: Add the listener case**

In `registerReactiveListeners` (near the `on-ally-critically-repaired` case ~line 288, whose shape this mirrors minus the crit filter), add:
```ts
                case 'on-own-repair-to-ally':
                    bus.on('heal-performed', (e) => {
                        // The OWNER's own repair that reached >= 1 OTHER ally (Font of Power).
                        // One enqueue per qualifying cast → one proc-gate roll; the grant fans
                        // out to all repaired non-self allies via eventCtx.repairedAllyIds.
                        if (e.casterId !== ownerId) return;
                        const repaired = e.targets.filter((t) => t !== ownerId);
                        if (repaired.length === 0) return;
                        enqueue({ ...intent, eventCtx: { ...intent.eventCtx, repairedAllyIds: repaired } });
                    });
                    break;
```

- [ ] **Step 5: Extend the buff-branch recipient resolution**

In `src/utils/combat/triggers.ts`, replace the recipient resolution (~line 1036-1041) with the `repairedAllyIds`-first form (placed before the `ctx.playerIds` fall-through so an `ally`-target + `repairedAllyIds` grant can never land on the whole team):
```ts
        const recipients: string[] =
            intent.ability.target === 'ally' && intent.eventCtx?.repairedAllyIds?.length
                ? intent.eventCtx.repairedAllyIds
                : intent.ability.target === 'ally' && intent.eventCtx?.damagedAllyId
                  ? [intent.eventCtx.damagedAllyId]
                  : intent.ability.target === 'ally' || intent.ability.target === 'all-allies'
                    ? ctx.playerIds
                    : [intent.ownerId];
```
(`damagedAllyId` and `repairedAllyIds` never co-occur on one intent — different triggers — so there is no collision. The `passesProcChanceGate` roll above this, at ~line 1025, already runs ONCE before recipients resolve → one roll, fan-out.)

- [ ] **Step 6: Add the proc table + registry entry**

In `buildEquipmentAbilities.ts`, add a proc table:
```ts
// D-PR9: Font of Power — when repairing another ally, X% chance to grant the repaired
// allies Power Infused Nanobots for 1 turn. Rare/epic/legendary only. EMIT-ONLY this PR
// (the caster-attack-snapshot flat-attack fold is D-PR10).
const FONT_OF_POWER_PROC: Record<string, number> = {
    rare: 0.09,
    epic: 0.12,
    legendary: 0.16,
};
```
And add to `IMPLANT_ABILITIES`:
```ts
    // D-PR9: Font of Power — on-own-repair-to-ally, grant repaired allies Power Infused
    // Nanobots (target:'ally' + eventCtx.repairedAllyIds routing). EMIT-ONLY: the buff has
    // no parseable effect yet; the +100%-of-caster-attack fold lands in D-PR10.
    FONT_OF_POWER: (rarity) => {
        const procChance = FONT_OF_POWER_PROC[rarity];
        if (procChance === undefined) return undefined;
        return mkNamedBuffGrant('Power Infused Nanobots', 'ally', 'on-own-repair-to-ally', 1, {
            procChance,
        });
    },
```

- [ ] **Step 7: Run the Font of Power test to verify it passes**

Run: `npx vitest run src/utils/combat/__tests__/equipmentAbilities.integration.test.ts -t "Font of Power"`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/types/abilities.ts src/utils/combat/triggers.ts src/utils/abilities/buildEquipmentAbilities.ts src/utils/combat/__tests__/equipmentAbilities.integration.test.ts
git commit -m "feat(combat): D-PR9 Font of Power — on-own-repair-to-ally buff grant (emit-only)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Coverage tracker — register both implants as implemented

**Files:**
- Modify: `src/utils/abilities/__tests__/equipmentCoverage.test.ts`

- [ ] **Step 1: Run the coverage test to see the expected diff**

Run: `npx vitest run src/utils/abilities/__tests__/equipmentCoverage.test.ts`
Expected: FAIL — the order-sensitive `implementedImplants.toEqual([...])` (line 115) now sees `SPEARHEAD` and `FONT_OF_POWER` in the actual array; the per-implant "produces 0 abilities" loop (line 387) fails for both. Note the ACTUAL array printed by the failure — it is in `IMPLANTS` declaration order (`FONT_OF_POWER` precedes `SPEARHEAD`), NOT alphabetical.

- [ ] **Step 2: Update the `.toEqual` array (line 115-139)**

Replace the expected array with the ACTUAL array from the failure output (adds `FONT_OF_POWER` and `SPEARHEAD` at their decl-order positions). Update the `it(...)` title string at line 102 to mention them.

- [ ] **Step 3: Add the two implants to the `implementedImplants` Set (line 190-214)**

Add `'SPEARHEAD',` and `'FONT_OF_POWER',` to the Set, with a `// D-PR9:` comment. (This automatically removes them from the `unimplementedImplants` zero-assertion loop at line 385.)

- [ ] **Step 4: Add positive per-implant assertions**

After the D-PR8 block (~line 383), add:
```ts
    // D-PR9: ally-wide / new-trigger reactive buff grants
    it('SPEARHEAD produces 1 all-allies Attack Up I buff per rarity (on-charged-cast)', () => {
        for (const v of IMPLANTS['SPEARHEAD'].variants) {
            expect(implantAbilityCount('SPEARHEAD', v.rarity)).toBe(1);
        }
    });
    it('FONT_OF_POWER produces 1 Power Infused Nanobots grant per rarity (on-own-repair-to-ally; rare/epic/legendary)', () => {
        for (const v of IMPLANTS['FONT_OF_POWER'].variants) {
            expect(implantAbilityCount('FONT_OF_POWER', v.rarity)).toBe(1);
        }
    });
```

- [ ] **Step 5: Run the coverage test to verify it passes**

Run: `npx vitest run src/utils/abilities/__tests__/equipmentCoverage.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/utils/abilities/__tests__/equipmentCoverage.test.ts
git commit -m "test(combat): D-PR9 coverage — SPEARHEAD + FONT_OF_POWER implemented

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Team-agnostic mirror tests

**Files:**
- Modify: `src/utils/combat/__tests__/enemyReactiveSelfBuffs.test.ts`

- [ ] **Step 1: Write the failing mirror tests**

Following the harness in `enemyReactiveSelfBuffs.test.ts` (enemy-side reactive grants), add:
- An enemy-side carrier of `SPEARHEAD` that fires its charged skill → all ENEMY allies get `Attack Up I` (the listener is registered for the enemy side too; `actorId === ownerId` self-scopes).
- An enemy-side carrier of `FONT_OF_POWER` that repairs another enemy ally → the repaired enemy ally carries `Power Infused Nanobots`.

Run: `npx vitest run src/utils/combat/__tests__/enemyReactiveSelfBuffs.test.ts -t "D-PR9"`
Expected: these new tests should PASS immediately (the engine machinery from Tasks 1+3 is team-agnostic). If they FAIL, that indicates a side-routing bug — investigate before forcing.

- [ ] **Step 2: Run the mirror tests to verify they pass**

Run: `npx vitest run src/utils/combat/__tests__/enemyReactiveSelfBuffs.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/utils/combat/__tests__/enemyReactiveSelfBuffs.test.ts
git commit -m "test(combat): D-PR9 team-agnostic mirror for Spearhead + Font of Power

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Full-suite verification + changelog + final review

**Files:**
- Modify: `src/constants/changelog.ts` (`UNRELEASED_CHANGES`)

- [ ] **Step 1: Full test suite — confirm byte-identical goldens**

Run: `npm test`
Expected: ALL green. Crucially, NO DPS/healing golden snapshot files appear in `git status` / the diff (byte-identical invariant). If a golden moved, STOP — a gate leaked; fix the source, do NOT `vitest -u`.

- [ ] **Step 2: Lint + typecheck**

Run: `npm run lint`
Expected: 0 errors/warnings (max-warnings: 0).

- [ ] **Step 3: Skill-audit unchanged**

Run: `npm run audit:skills`
Expected: 141 ships, 0 findings (D-PR9 touches no ship-skill parsing).

- [ ] **Step 4: Add the changelog entry**

In `src/constants/changelog.ts`, add to `UNRELEASED_CHANGES` (plain English, user-facing):
```ts
'Combat sim: the Spearhead implant now grants all allies Attack Up after a charged skill, and Font of Power applies its buff when repairing allies (groundwork — its attack bonus is modeled next).',
```
(Adjust to match the array's existing entry style.)

- [ ] **Step 5: Commit**

```bash
git add src/constants/changelog.ts
git commit -m "docs(combat): D-PR9 changelog — Spearhead + Font of Power

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 6: Final holistic review**

Dispatch a final code review (superpowers:requesting-code-review or a code-reviewer subagent) over the whole D-PR9 diff vs the branch base, checking against the spec: both triggers correct + team-agnostic, single-gate fan-out routing, emit-only buff genuinely no-effect, byte-identical goldens, coverage updated. Address findings, then the PR is ready to push/stack.

---

## Notes for the implementer

- **Determinism for proc gates:** the proc-chance gate is a `makeRateGate` accumulator. The existing `reactiveBuffProcGate.test.ts` shows how D-PR8 made buff procs deterministic in tests — reuse that approach (force the proc to fire) rather than relying on RNG.
- **`Attack Up I` is the corpus name** (`+15% Attack`, `buffs.ts:406`); the implant text's "Attack Up 1" maps to it. The registry call MUST pass `'Attack Up I'`.
- **Do not text-parse the implant descriptions** (the rare Font of Power variant even has a "grand"/"grant" typo) — the registry hard-codes buff names and values.
- **Emit-only means the buff applies + logs with zero stat effect** because `parseBuffEffects` yields nothing for its caster-derived description. The buff NAME becomes visible to name-based condition gates only once a fixture carries the implant (none do today) — D-PR10 (which folds the real effect) must keep this in mind.
- **D-PR10 handoff:** the dynamic caster-attack-snapshot flat-attack buff subsystem (`ParsedBuffEffects.attackFlat` + parser + additive fold in `calculateBuffTotals`/`effectiveStatsOf` + per-instance magnitude snapshot at apply). Because D-PR9 already lands `Power Infused Nanobots` on the correct allies, D-PR10 is purely additive.
