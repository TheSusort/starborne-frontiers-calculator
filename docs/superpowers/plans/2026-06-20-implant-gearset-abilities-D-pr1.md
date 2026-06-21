# Implant + Gear-Set Abilities — D-PR1 (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the source-and-chance foundation that lets the combat sim consume implant + gear-set special effects, proven end-to-end by two effects on existing engine machinery: the **Leech** gear set (standing leech) and the **Bloodthirst** implant (on-crit, 12% chance, self-heal off damage dealt).

**Architecture:** A new sibling module `buildEquipmentAbilities(ship, getGearPiece)` resolves a ship's active gear sets (count by `setBonus`) and equipped implants (id → name + rarity → variant `description`) into `Ability[]`. Gear-set special effects are produced by a tiny explicit per-set builder (their text is terse/non-prose); implant effects are parsed by reusing `abilitiesFromText`, then stamped with a `procChance` extracted from the description. The result is merged into the passive slot via a thin wrapper that leaves `buildShipAbilities` untouched (so every existing test stays byte-identical). Probabilistic procs ride a combat-lifetime `Map<string, RateGate>` keyed `${ownerId}:${abilityId}`, mirroring the existing `oncePerCombatFired` set; the reactive-heal executor rolls the gate before firing.

**Tech Stack:** React 18 + TypeScript, Vitest. Combat engine in `src/utils/combat/`, ability building in `src/utils/abilities/`, parser in `src/utils/skillTextParser.ts`, types in `src/types/`.

**Spec:** `docs/superpowers/specs/2026-06-20-implant-gearset-abilities-D-design.md`.

**Branch:** `feat/combat-d-implant-gearset` (stacked on the E5 branch tip `73e10097`; rebase onto main later).

---

## Critical conventions (read before starting)

- **Test runner:** `npm test` runs Vitest in WATCH mode and hangs agents. ALWAYS use `npx vitest run <path-or-name>`.
- **Goldens:** NEVER run `vitest -u`. The load-bearing invariant for this PR is that all existing DPS / healing / battle-sim goldens stay **byte-identical** — the new builder only emits abilities when equipment resolves, and no existing fixture carries effect-bearing gear (verified in Task 0). If a `.snap` moves, the gate leaked — fix the gate, don't regenerate.
- **Lint:** `npm run lint` enforces `--max-warnings 0`. Run it in EVERY task gate, not just the last.
- **docs/ is gitignored:** commit plan/spec edits with `git add -f` and `git commit --no-verify` (the pre-commit hook runs the full suite; skip it for docs-only commits).
- **Stat-only portions are already in combat stats** — this PR adds ONLY special-effect abilities, never stats.
- REQUIRED SUB-SKILLS while implementing: @superpowers:test-driven-development, @superpowers:verification-before-completion.

## File structure

| File | Responsibility | Change |
|---|---|---|
| `src/types/abilities.ts` | Ability model | Add `procChance?: number` to `Ability`. |
| `src/utils/combat/triggers.ts` | Reactive intent execution | Add `procChanceGates?: Map<string, RateGate>` to `IntentExecContext`; roll the gate in the reactive heal/shield executor. |
| `src/utils/combat/engine.ts` | Combat setup + drain context | Create the combat-lifetime `procChanceGates` map (next to `oncePerCombatFired`) and thread it into every `IntentExecContext` build site. |
| `src/utils/abilities/buildEquipmentAbilities.ts` | NEW — resolve equipped sets/implants → `Ability[]` | Create. Set registry + implant-via-parser + `procChance` stamping + graceful skip. |
| `src/utils/abilities/buildShipAbilitiesWithEquipment.ts` | NEW — thin merge wrapper | Create. `buildShipAbilities(ship)` + merge equipment abilities into the passive slot. |
| `src/utils/calculators/battleSimulator.ts` | Battle sim entry | `simulateBattle` gains optional `getGearPiece?`; `planPlacement` threads it; uses the wrapper when present. |
| `src/pages/SimulatorPage.tsx` | Sim page | Pass `getGearPiece` into `simulateBattle`. |
| `src/pages/calculators/HealingCalculatorPage.tsx` | Healing page | Route the 4 `buildShipAbilities(ship)` sites through the wrapper with `getGearPiece`. |
| `src/constants/changelog.ts` | Changelog | `UNRELEASED_CHANGES` entry. |
| `src/pages/DocumentationPage.tsx` | In-app docs | Note implant/gear-set effects now apply in the sim. |

---

## Task 0: Baseline + fixture audit

**Files:** none (verification only).

- [ ] **Step 1: Confirm branch + green baseline**

Run: `git branch --show-current` → expect `feat/combat-d-implant-gearset`.
Run: `npx vitest run src/utils/combat src/utils/abilities src/utils/calculators 2>&1 | tail -20`
Expected: all pass.

- [ ] **Step 2: Confirm no combat fixture carries effect-bearing gear (byte-identical premise)**

Run: `rg -n 'equipment:\s*\{' src/utils/combat/__tests__ src/utils/calculators/__tests__; rg -n 'implants:\s*\{' src/utils/combat/__tests__ src/utils/calculators/__tests__`
Expected: no matches with non-empty equipment/implants (fixtures use `{}` or omit). If any match resolves to an effect-bearing set/implant, STOP and surface it — the merge is not byte-identical and the plan needs a fixture-neutralization step.

- [ ] **Step 3: Record the baseline test count**

Run: `npx vitest run 2>&1 | tail -5` and note the passing count for later comparison.

---

## Task 1: `procChance` field + per-proc rate gate in the reactive heal executor

The foundational chance machinery. Unreachable until an ability carries `procChance`, so existing behavior is byte-identical; tested in isolation with a synthetic ability.

**Files:**
- Modify: `src/types/abilities.ts` (the `Ability` interface, ~:280-299)
- Modify: `src/utils/combat/triggers.ts` (`IntentExecContext` ~:480-554; reactive heal/shield executor ~:1101-1187)
- Modify: `src/utils/combat/engine.ts` (combat-lifetime state next to `oncePerCombatFired`; every `IntentExecContext` literal)
- Test: `src/utils/combat/__tests__/procChanceGate.test.ts` (NEW)

- [ ] **Step 1: Write the failing test**

Create `src/utils/combat/__tests__/procChanceGate.test.ts`. Use the existing healing-mode engine harness (mirror the setup in `src/utils/combat/__tests__/enemyActions.test.ts` or `healing.test.ts`). Build a player attacker that crits every turn and carries a passive reactive heal ability:

```ts
// ability under test (hand-built into the actor's passive slot via the test's ShipSkills):
{
  id: 'test-proc-heal',
  type: 'heal', target: 'self', trigger: 'on-crit', conditions: [],
  procChance: 0.5,
  config: { type: 'heal', pct: 50, basis: 'damage-dealt', noCrit: true },
}
```

Run the engine for 10 rounds where the attacker lands exactly one critting hit per round, in healing mode, and assert the self-heal is credited on exactly 5 of the 10 crits (deterministic accumulator: 0.5 over 10 calls fires 5 times). Assert a second control ability with `procChance` absent fires on all 10. (Assert the COUNT of fires, not which specific rounds — the accumulator is back-loaded, so the exact firing rounds depend on `rateAccumulator.ts:17`; confirm the pattern there when writing the assertion.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/utils/combat/__tests__/procChanceGate.test.ts`
Expected: FAIL — `procChance` not a known property (tsc) or the heal fires on all 10 (no gate yet).

- [ ] **Step 3: Add `procChance` to the `Ability` type**

In `src/types/abilities.ts`, add to `interface Ability` (top-level, alongside `triggerCritFilter`):

```ts
    /** Probabilistic proc gate for equipment-sourced reactive abilities ("N% chance to …").
     *  A value in (0,1) means the ability fires at that rate via a combat-lifetime per-(owner,
     *  ability) RateGate (deterministic accumulator, like crit/landing). Absent or out of (0,1)
     *  → fires on every qualifying trigger. */
    procChance?: number;
```

- [ ] **Step 4: Add the gate map to `IntentExecContext` and roll it in the heal/shield executor**

In `src/utils/combat/triggers.ts`:

Add to `IntentExecContext` (mirror the `oncePerCombatFired` doc comment):
```ts
    /** Combat-lifetime per-ability proc-chance gates (e.g. Bloodthirst's 12% chance).
     *  Keyed `${ownerId}:${abilityId}`; the RateGate accumulates across all rounds and all
     *  reactive fires of the same ability so the proc lands at its true frequency. */
    procChanceGates?: Map<string, RateGate>;
```

In the reactive heal/shield executor, immediately AFTER the existing `oncePerCombat` guard (~:1107), add:
```ts
    const pc = intent.ability.procChance;
    if (pc !== undefined && pc > 0 && pc < 1) {
        const gateKey = `${intent.ownerId}:${intent.ability.id}`;
        let gate = ctx.procChanceGates?.get(gateKey);
        if (ctx.procChanceGates && !gate) {
            gate = makeRateGate();
            ctx.procChanceGates.set(gateKey, gate);
        }
        if (gate && !gate(pc)) return;
    }
```
Ensure `makeRateGate` and the `RateGate` type are imported in `triggers.ts` (import `makeRateGate` from `../calculators/rateAccumulator`; `RateGate` from `./playerTurn`).

- [ ] **Step 5: Create and thread the combat-lifetime map in the engine**

In `src/utils/combat/engine.ts`, find where `oncePerCombatFired` (a `Set<string>`) is created OUTSIDE the round loop (combat-lifetime, near `cheatDeathConsumed`). Add next to it:
```ts
    const procChanceGates = new Map<string, RateGate>();
```
Then add `procChanceGates,` to EVERY `IntentExecContext` object literal that already passes `oncePerCombatFired` (search for `oncePerCombatFired` in engine.ts — pass `procChanceGates` at each of the same sites). Import `RateGate` if not already imported.

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run src/utils/combat/__tests__/procChanceGate.test.ts`
Expected: PASS (5/10 gated, 10/10 control).

- [ ] **Step 7: Verify byte-identical goldens + lint + types**

Run: `npx vitest run 2>&1 | tail -5` (expect baseline count + the new test; ZERO `.snap` changes — `git status --short` shows no modified `.snap`).
Run: `npm run lint && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add src/types/abilities.ts src/utils/combat/triggers.ts src/utils/combat/engine.ts src/utils/combat/__tests__/procChanceGate.test.ts
git commit -m "feat(combat): D-PR1 — per-proc rate gate for equipment reactive procs"
```

---

## Task 2: `buildEquipmentAbilities` module

Pure resolution + emission. Not wired into any engine path yet → byte-identical. Unit-tested in isolation.

**Files:**
- Create: `src/utils/abilities/buildEquipmentAbilities.ts`
- Test: `src/utils/abilities/__tests__/buildEquipmentAbilities.test.ts` (NEW)
- Reference (read, don't modify): `src/utils/ship/statsCalculator.ts:140-178` (`countSetPieces`), `src/constants/gearSets.ts`, `src/constants/implants.ts`, `src/utils/abilities/buildShipAbilities.ts:644` (`abilitiesFromText`).

- [ ] **Step 1: Write the failing unit tests**

Create `src/utils/abilities/__tests__/buildEquipmentAbilities.test.ts`. A `makeGetGearPiece(map)` helper returns a `(id)=>GearPiece|undefined`. Cases:

1. **Leech set active (≥2 pieces):** a ship with 2 equipment ids whose pieces have `setBonus:'LEECH'` → returns exactly one ability: `{type:'heal', target:'self', trigger:'on-cast', config:{type:'heal', pct:15, basis:'damage-dealt', leechScope:'all', noCrit:true}}` with a stable id (`equip-set-LEECH`). (`noCrit:true` — a derived-from-damage leech doesn't roll its own heal-crit; flag as a modeling choice in the PR for reviewer confirmation.)
2. **Leech set inactive (1 piece):** → `[]`.
3. **Bloodthirst implant (legendary):** `ship.implants.implant_major` → a piece with `setBonus:'BLOODTHIRST', rarity:'legendary'` → returns an ability `{type:'heal', target:'self', trigger:'on-crit', procChance:0.20, config:{type:'heal', pct:20, basis:'damage-dealt'}}` (legendary = 20% chance / 20% heal per the implant data). Assert `procChance` and `config.pct`.
4. **Missing piece:** an implant id with no entry in the map → skipped, no throw.
5. **Stat-only implant (e.g. STRIKE / a minor with no description):** → `[]`.
6. **Unparseable description:** a fake implant whose description is gibberish → skipped, no throw, `[]`.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/utils/abilities/__tests__/buildEquipmentAbilities.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the module**

Create `src/utils/abilities/buildEquipmentAbilities.ts`:

- Export `interface EquipmentAbility extends Ability { source: 'implant' | 'gear-set'; }` OR return plain `Ability[]` and carry the source in a comment — prefer NOT extending `Ability` (the engine consumes plain `Ability`); instead tag via a stable id prefix (`equip-set-*` / `equip-implant-*`) and skip a separate `source` field. (Resolve in the test accordingly.)
- `export function buildEquipmentAbilities(ship: Ship, getGearPiece: (id: string) => GearPiece | undefined): Ability[]`.
- **Active sets:** mirror `countSetPieces` — iterate `ship.equipment`, `getGearPiece(id)?.setBonus`, tally; a set is active when `count >= (GEAR_SETS[name]?.minPieces ?? 2)`. For each active set with an entry in the set-ability registry, emit its ability.
- **Set-ability registry** (only Leech for D-PR1):
  ```ts
  const GEAR_SET_ABILITIES: Partial<Record<string, () => AbilityConfig>> = {
      LEECH: () => ({ type: 'heal', pct: 15, basis: 'damage-dealt', leechScope: 'all', noCrit: true }),
  };
  ```
  Wrap each config in a full `Ability` (`id: 'equip-set-LEECH'`, `type:'heal'`, `target:'self'`, `trigger:'on-cast'`, `conditions:[]`, `autoFilled:true`).
- **Implants:** for each id in `ship.implants`, resolve `getGearPiece(id)` → `{ setBonus, rarity }`. `setBonus` is the implant name (a `GearSetName ∪ ImplantName`). Look up `IMPLANTS[setBonus]` (guard undefined); find the variant with matching `rarity`; read `variant.description`. If no description → skip. Feed `description` through `abilitiesFromText(description, 'passive', ship.type)`; for each produced `PositionedAbility`, stamp `procChance` (see helper) and a stable id (`equip-implant-<name>-<i>`); collect `.ability`.
- **`procChance` helper:** `extractProcChance(text): number | undefined` = match `/(\d+)\s*%\s*chance/i`; return `Number(m[1]) / 100` or `undefined`. Stamp onto each ability produced from that description.
- **Graceful skip everywhere:** wrap per-piece resolution so a missing piece / missing implant data / empty parser output / thrown error yields no ability (never throws out of the function).

Note for the implementer: Bloodthirst's description ("On a critical hit, there is a 12% chance for this unit to repair itself for 12% of the damage dealt") is expected to parse into a `heal` ability with `trigger:'on-crit'` + `config.basis:'damage-dealt'` + `config.pct` (the heal %); the `procChance` comes from the stamping helper (the "% chance" number, NOT the heal %). If `abilitiesFromText` does NOT yield an on-crit damage-dealt heal for this exact string, characterize what it yields and either (a) add a minimal targeted extension to the heal/leech parser, or (b) fall back to a per-implant builder for BLOODTHIRST mirroring the set registry — document which and why in the commit.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/utils/abilities/__tests__/buildEquipmentAbilities.test.ts`
Expected: PASS.

- [ ] **Step 5: Lint + types + byte-identical**

Run: `npm run lint && npx tsc --noEmit && npx vitest run 2>&1 | tail -5`
Expected: clean; no `.snap` changes (module unwired).

- [ ] **Step 6: Commit**

```bash
git add src/utils/abilities/buildEquipmentAbilities.ts src/utils/abilities/__tests__/buildEquipmentAbilities.test.ts
git commit -m "feat(combat): D-PR1 — buildEquipmentAbilities (Leech set + implant resolution)"
```

---

## Task 3: Merge wrapper + call-site plumbing

Wires equipment abilities into the engine. Byte-identical because fixtures carry no effect-bearing gear (Task 0).

**Files:**
- Create: `src/utils/abilities/buildShipAbilitiesWithEquipment.ts`
- Modify: `src/utils/calculators/battleSimulator.ts` (`simulateBattle` signature ~:560; `planPlacement` ~:520-535)
- Modify: `src/pages/SimulatorPage.tsx` (call to `simulateBattle`)
- Modify: `src/pages/calculators/HealingCalculatorPage.tsx` (5 sites: ~:121, 235, 252, 307, 356 — find ALL `buildShipAbilities(ship)` in the file; a missed site is silent because the wrapper deep-equals `buildShipAbilities` when equipment is empty)
- Test: `src/utils/abilities/__tests__/buildShipAbilitiesWithEquipment.test.ts` (NEW)

- [ ] **Step 1: Write the failing test**

Create `src/utils/abilities/__tests__/buildShipAbilitiesWithEquipment.test.ts`. A ship with Leech set (2 pieces) + Bloodthirst implant, plus a normal skill, run through `buildShipAbilitiesWithEquipment(ship, getGearPiece)`:
- The passive slot contains BOTH the ship's own passive abilities AND the two equipment abilities.
- A ship with empty equipment/implants produces output identical to `buildShipAbilities(ship)` (deep-equal).

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/utils/abilities/__tests__/buildShipAbilitiesWithEquipment.test.ts`
Expected: FAIL — wrapper does not exist.

- [ ] **Step 3: Implement the wrapper**

Create `src/utils/abilities/buildShipAbilitiesWithEquipment.ts`:
```ts
export function buildShipAbilitiesWithEquipment(
    ship: Ship,
    getGearPiece: (id: string) => GearPiece | undefined,
): ShipSkills {
    const skills = buildShipAbilities(ship);
    const equip = buildEquipmentAbilities(ship, getGearPiece);
    if (!equip.length) return skills;
    const passive = skills.slots.find((s) => s.slot === 'passive');
    if (passive) passive.abilities.push(...equip);
    else skills.slots.push({ slot: 'passive', abilities: equip });
    return skills;
}
```
`buildShipAbilities` is left untouched (single-arg, byte-identical for all existing callers/tests).

- [ ] **Step 4: Thread `getGearPiece` into the battle simulator**

In `src/utils/calculators/battleSimulator.ts`:
- Add an optional param to the public entry: `export function simulateBattle(input: BattleSimulationInput, getGearPiece?: (id: string) => GearPiece | undefined): BattleResult`.
- Thread `getGearPiece` into `planPlacement` (add a param). In `planPlacement`, set `shipSkills: getGearPiece ? buildShipAbilitiesWithEquipment(p.ship, getGearPiece) : buildShipAbilities(p.ship)`.
- When `getGearPiece` is absent (every existing test), behavior is identical → goldens byte-identical.

- [ ] **Step 5: Pass `getGearPiece` from the pages**

- `SimulatorPage.tsx`: it already has `const { getGearPiece } = useInventory()` — pass it as the 2nd arg to `simulateBattle(input, getGearPiece)`.
- `HealingCalculatorPage.tsx`: it already has `getGearPiece` from `useInventory()`. Replace ALL `buildShipAbilities(ship)` calls — there are 5 (~:121, 235, 252, 307, 356) — with `buildShipAbilitiesWithEquipment(ship, getGearPiece)`. Grep the file to confirm none are missed (a missed site silently drops equipment for that path; no test will fail because the wrapper is byte-identical when equipment is empty).

- [ ] **Step 6: Run the wrapper test + full suite (byte-identical)**

Run: `npx vitest run src/utils/abilities/__tests__/buildShipAbilitiesWithEquipment.test.ts`
Expected: PASS.
Run: `npx vitest run 2>&1 | tail -5` and `git status --short`
Expected: baseline + new tests pass; ZERO `.snap` modifications.

- [ ] **Step 7: Lint + types**

Run: `npm run lint && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add src/utils/abilities/buildShipAbilitiesWithEquipment.ts src/utils/abilities/__tests__/buildShipAbilitiesWithEquipment.test.ts src/utils/calculators/battleSimulator.ts src/pages/SimulatorPage.tsx src/pages/calculators/HealingCalculatorPage.tsx
git commit -m "feat(combat): D-PR1 — merge equipment abilities into the passive slot at sim call sites"
```

---

## Task 4: End-to-end engine integration (Leech standing + Bloodthirst frequency)

Proves the full pipeline: resolution → merge → engine consumption (standing leech) and the gated reactive proc.

**Files:**
- Test: `src/utils/combat/__tests__/equipmentAbilities.integration.test.ts` (NEW)
- Reference: `engine.ts:2033-2053` (standing-leech registration), `engine.ts:2096-2131` (`procStandingLeeches`), the healing-mode harness used by `healing.test.ts`.

- [ ] **Step 1: Write the failing integration tests**

Create `src/utils/combat/__tests__/equipmentAbilities.integration.test.ts`, in healing mode (so `healingCtx`/`healTarget` exist and standing leech + reactive heals are exercised):

1. **Leech set standing leech:** a player attacker whose `ShipSkills` (built via `buildShipAbilitiesWithEquipment` with a stub `getGearPiece` returning Leech-set pieces) deals a known direct-damage amount D in a round → the attacker is credited a self-heal of `0.15 * D` (the standing-leech path). Assert via the heal credit surface the healing engine exposes. NOTE: `procStandingLeeches` (engine.ts:~2106) folds the owner's `healModifier` (`raw *= 1 + healModifier/100`) and may crit — set the attacker's `healModifier` to 0 and `noCrit:true` on the Leech ability (already set) so the expected value is exactly `0.15 * D`; otherwise assert against the folded value.
2. **Bloodthirst gated proc:** an attacker with the Bloodthirst implant resolved, landing exactly one critting hit per round for 10 rounds → the self-heal fires `floor(10 * procChance)` times, each `pct%` of the crit's damage. (For legendary: `procChance 0.20` → 2 fires.) Assert both frequency and amount.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/utils/combat/__tests__/equipmentAbilities.integration.test.ts`
Expected: FAIL initially (set up the harness until it compiles, then it should drive the asserts).

- [ ] **Step 3: Make them pass**

No new production code is expected here — Tasks 1-3 supply the machinery. If a test fails on a real gap (e.g. the standing-leech registration doesn't see the merged ability because `ShipSkills` → `runtime.castSkills` drops it), debug with @superpowers:systematic-debugging and fix the smallest cause. Document any production change in the commit.

- [ ] **Step 4: Run + full suite + lint + types**

Run: `npx vitest run src/utils/combat/__tests__/equipmentAbilities.integration.test.ts`
Expected: PASS.
Run: `npx vitest run 2>&1 | tail -5 && npm run lint && npx tsc --noEmit && git status --short`
Expected: clean; no `.snap` changes.

- [ ] **Step 5: Commit**

```bash
git add src/utils/combat/__tests__/equipmentAbilities.integration.test.ts
git commit -m "test(combat): D-PR1 — end-to-end Leech standing + Bloodthirst proc frequency"
```

---

## Task 5: Coverage harness + docs + changelog + closeout

**Files:**
- Test: `src/utils/abilities/__tests__/equipmentCoverage.test.ts` (NEW — lightweight coverage tracker)
- Modify: `src/constants/changelog.ts` (`UNRELEASED_CHANGES`)
- Modify: `src/pages/DocumentationPage.tsx`

- [ ] **Step 1: Coverage tracker test**

Create `src/utils/abilities/__tests__/equipmentCoverage.test.ts`: iterate the full `IMPLANTS` + `GEAR_SETS` corpus, run each effect description through the same resolution path `buildEquipmentAbilities` uses, and assert a CURRENT snapshot of which produce ≥1 ability vs. none. For D-PR1 this documents that exactly Leech (set) and the Bloodthirst variants (implant) produce abilities, everything else is `0` (not yet implemented). This makes later-PR coverage growth visible and prevents silent regressions. (Plain `expect` on counts — NOT a `.snap` file.)

- [ ] **Step 2: Run it**

Run: `npx vitest run src/utils/abilities/__tests__/equipmentCoverage.test.ts`
Expected: PASS.

- [ ] **Step 3: Changelog**

Add to `UNRELEASED_CHANGES` in `src/constants/changelog.ts` a plain-English entry, e.g.: "Combat sim now applies the Leech gear set and the Bloodthirst implant (more implant and gear-set effects coming)."

- [ ] **Step 4: Documentation**

In `src/pages/DocumentationPage.tsx`, note in the combat/sim section that equipped implant and gear-set special effects are beginning to apply in the simulator (Leech, Bloodthirst), with chance-based procs modeled at their true frequency.

- [ ] **Step 5: Final gate**

Run: `npx vitest run 2>&1 | tail -5`
Run: `npm run lint && npx tsc --noEmit`
Run: `npm run audit:skills` (expect unchanged 0/141 — equipment parsing is separate from ship-skill audit).
Run: `git status --short` (expect no `.snap` changes).
Expected: all clean.

- [ ] **Step 6: Commit**

```bash
git add src/utils/abilities/__tests__/equipmentCoverage.test.ts src/constants/changelog.ts src/pages/DocumentationPage.tsx
git commit -m "docs(combat): D-PR1 — equipment-effect coverage tracker + changelog + docs"
```

---

## Done-when

- `buildEquipmentAbilities` resolves active sets + equipped implants; Leech set + Bloodthirst implant produce correct abilities; unknown/stat-only/unparseable inputs skip gracefully.
- The merge wrapper injects equipment abilities into the passive slot at the sim call sites; `buildShipAbilities` is unchanged and all existing goldens are byte-identical (no `.snap` movement).
- A reactive proc fires at its true frequency via the combat-lifetime per-proc rate gate; the standing Leech credits 15% of damage dealt.
- Suite green, lint 0, tsc clean, `audit:skills` 0/141.

## Deferred (next D PRs — do NOT do here)

- **D-PR2:** conditional outgoing-damage bucket — the passive conditional-scaling damage fold + Intrusion, Arcane Siege, Warpstrike.
- **D-PR2+ / later:** in-flight reactive damage amplification + `target-higher-attack` condition (Menace, Giant Slayer); incoming-reduction conditions; the remaining reactive triggers (end-of-round-if-not-hit, on-debuffed, on-resist, on-shield-applied, on-heal-cast, periodic, big-hit); on-death (Battlecry/Last Wish/Martyrdom); charge/DoT/cleanse; net-new mechanics (Boost, Cloaking); CF/Provoke appliers.
- **Other subprojects:** shield grants → H, reflect → G, start-of-combat stat conversion → F.
