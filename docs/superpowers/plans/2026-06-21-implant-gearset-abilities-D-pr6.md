# D-PR6: Exuberance (heal-received amplification) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Light up the Exuberance implant — a recipient-side amplification of repairs *received* ("when repaired, 17–30% chance to increase that repair by 12–15%") — across all repair-apply sites, keeping all goldens byte-identical.

**Architecture:** A single optional `HealingRuntimeCtx.recipientIncomingHealAmpPct(rid)` method (engine-populated; rolls the recipient's incoming-heal-amp procs once via a combat-lifetime gate keyed `${rid}:${abilityId}`) is called at every repair-apply site (both cast-heal branches, the reactive heal executor, and HoT ticks). No new trigger. Reuses D-PR5's `healAmplification.ts` module + D-PR4's `rollRateGate`/`procChanceGates`.

**Tech Stack:** TypeScript, Vitest. Combat engine under `src/utils/combat/`; equipment registry under `src/utils/abilities/`.

**Spec:** `docs/superpowers/specs/2026-06-21-implant-gearset-abilities-D-pr6-design.md`

**Branch / worktree:** `feat/combat-d-pr6-exuberance` (worktree `.worktrees/d-pr6-exuberance`), stacked on D-PR5 tip `03cff2a6`. Retarget to `main` after the D stack merges.

---

## CRITICAL WORKFLOW NOTES (read once)

- **Test runner:** NEVER `npm test` (Vitest watch, hangs). Use `npx vitest run <pathOrName>`.
- **Goldens load-bearing:** NEVER `vitest -u`. All goldens must stay **byte-identical** (no fixture carries Exuberance; the ctx method is unpopulated for them → `?? 0`). If a `.snap` moves, a default leaked.
- **docs/ gitignored:** `git add -f` for plan/spec; `--no-verify` for docs-only commits.
- After each code task: `npx vitest run` touched files, `npm run lint` (max-warnings 0), `npx tsc --noEmit`. Run FULL suite on any byte-identical claim; confirm `git diff --stat 03cff2a6 -- '**/*.snap' '**/__snapshots__/**'` EMPTY.
- KNOWN: `equipmentCoverage.test.ts` will fail for EXUBERANCE ("produces 0 abilities") between Task 4 and Task 7 — EXPECTED; commit `--no-verify` if that's the sole pre-commit block, and say so.

---

## Source values (from `src/constants/implants.ts`, EXUBERANCE)

uncommon/rare/epic/legendary: procChance 0.17/0.20/0.24/0.30; ampPct 12/13/14/15. No common.

---

## Task 1: Fixture audit (byte-identical safety — no code)

- [ ] **Step 1:**
```bash
cd .worktrees/d-pr6-exuberance
grep -rniE "exuberance" src/utils/combat src/utils/calculators src/utils/abilities --include='*.ts' | grep -viE "docs/|\.md" || echo "NONE FOUND"
```
Expected: `NONE FOUND`. If a real fixture carries Exuberance, STOP and re-confirm the byte-identical premise.
- [ ] **Step 2:** Record result. No commit.

---

## Task 2: Types — `incoming-heal-amplification` config

**Files:** Modify `src/types/abilities.ts` (mirror how `heal-amplification` / `outgoing-amplification` were added in D-PR5/D-PR4).

- [ ] **Step 1:** Add `'incoming-heal-amplification'` to the `AbilityType` union.
- [ ] **Step 2:** Add the `AbilityConfig` member (UNCONDITIONAL — no condition field):
```ts
      | {
            type: 'incoming-heal-amplification';
            /** Amplification added to a repair RECEIVED when it fires, in percentage points. */
            ampPct: number;
            /** Proc chance in (0,1). Rolled once per repair received (combat-lifetime gate keyed by recipient+ability). */
            procChance: number;
        }
```
- [ ] **Step 3:** `npx tsc --noEmit`. Add minimal mirror entries to the 3 editor-exhaustiveness files (same set D-PR4/D-PR5 touched): `src/components/skills/AbilityCard.tsx` + `src/components/skills/AbilityTypePicker.tsx` label maps (`'incoming-heal-amplification': 'Incoming Heal Amplification'`); `src/components/skills/abilityDefaults.ts` switch case (`case 'incoming-heal-amplification': return { type, ampPct: 0, procChance: 0 };`) + `DEFAULT_TARGETS` (`'incoming-heal-amplification': 'self'`). Match the shape of the existing `heal-amplification` entries.
- [ ] **Step 4:** `npx tsc --noEmit` + `npm run lint` clean. Commit:
```bash
git add src/types/abilities.ts src/components/skills/AbilityCard.tsx src/components/skills/AbilityTypePicker.tsx src/components/skills/abilityDefaults.ts
git commit -m "feat(combat): D-PR6 — incoming-heal-amplification ability config type"
```

---

## Task 3: Pure evaluator `incomingHealAmpForRecipient`

**Files:** Modify `src/utils/combat/healAmplification.ts` (add alongside `healAmplificationForCast`); Test `src/utils/combat/__tests__/healAmplification.test.ts` (extend).

- [ ] **Step 1: Write failing tests** (extend the existing describe block; reuse the test's `Ability` literal style):
```ts
import { incomingHealAmpForRecipient } from '../healAmplification';
const inc = (id: string, ampPct: number, procChance: number): Ability => ({
    id, type: 'incoming-heal-amplification', target: 'self', trigger: 'on-cast', conditions: [],
    config: { type: 'incoming-heal-amplification', ampPct, procChance },
});
describe('incomingHealAmpForRecipient', () => {
    it('returns 0 with no incoming-heal-amplification abilities', () => {
        expect(incomingHealAmpForRecipient([], () => true)).toBe(0);
    });
    it('adds ampPct when the proc fires', () => {
        expect(incomingHealAmpForRecipient([inc('e', 13, 0.5)], () => true)).toBe(13);
    });
    it('returns 0 when the proc does not fire', () => {
        expect(incomingHealAmpForRecipient([inc('e', 13, 0.5)], () => false)).toBe(0);
    });
    it('rolls with (abilityId, procChance) and sums additively across abilities', () => {
        const roll = vi.fn(() => true);
        expect(incomingHealAmpForRecipient([inc('a', 12, 0.17), inc('b', 15, 0.3)], roll)).toBe(27);
        expect(roll).toHaveBeenCalledWith('a', 0.17);
        expect(roll).toHaveBeenCalledWith('b', 0.3);
    });
    it('ignores non-incoming-heal-amplification configs', () => {
        const other = { id: 'x', type: 'heal', target: 'self', trigger: 'on-cast', conditions: [], config: { type: 'heal', pct: 10, basis: 'hp' } } as Ability;
        expect(incomingHealAmpForRecipient([other], () => true)).toBe(0);
    });
});
```
- [ ] **Step 2:** Run, verify FAIL: `npx vitest run src/utils/combat/__tests__/healAmplification.test.ts`
- [ ] **Step 3: Implement** (append to `healAmplification.ts`):
```ts
/**
 * Summed incoming-heal amplification % for ONE repair landing on a recipient (Exuberance).
 * Unconditional ("when repaired"): for each incoming-heal-amplification ability the recipient carries,
 * add ampPct iff its proc fires. `rollProc` MUST be keyed by the recipient so all repairs the unit
 * receives share one combat-lifetime gate (single probability stream, per the design). Returns 0 when
 * nothing applies → byte-identical with no such equipment.
 */
export function incomingHealAmpForRecipient(
    recipientAbilities: Ability[],
    rollProc: (abilityId: string, chance: number) => boolean
): number {
    let sum = 0;
    for (const a of recipientAbilities) {
        if (a.config.type !== 'incoming-heal-amplification') continue;
        if (!rollProc(a.id, a.config.procChance)) continue;
        sum += a.config.ampPct;
    }
    return sum;
}
```
- [ ] **Step 4:** Run, verify PASS. `npx tsc --noEmit` + `npm run lint`.
- [ ] **Step 5:** Commit:
```bash
git add src/utils/combat/healAmplification.ts src/utils/combat/__tests__/healAmplification.test.ts
git commit -m "feat(combat): D-PR6 — pure incomingHealAmpForRecipient evaluator (Exuberance)"
```

---

## Task 4: Registry — Exuberance entry

**Files:** Modify `src/utils/abilities/buildEquipmentAbilities.ts`; Test `src/utils/abilities/__tests__/buildEquipmentAbilities.test.ts`.

- [ ] **Step 1: Unit tests** (reuse the single-implant-ability resolution helper): Exuberance 'epic' → `config.type === 'incoming-heal-amplification'`, `config.ampPct === 14`, `config.procChance ≈ 0.24`; 'legendary' `config.ampPct === 15`, `config.procChance ≈ 0.30`; 'common' → undefined (no common variant). (Assert on `config.procChance`, NOT the top-level `Ability.procChance` — Exuberance doesn't set the latter.)
- [ ] **Step 2:** Run, verify FAIL.
- [ ] **Step 3: Implement:**
```ts
const EXUBERANCE_PROC: Record<string, number> = { uncommon: 0.17, rare: 0.2, epic: 0.24, legendary: 0.3 };
const EXUBERANCE_AMP: Record<string, number> = { uncommon: 12, rare: 13, epic: 14, legendary: 15 };

// in IMPLANT_ABILITIES:
EXUBERANCE: (rarity) => {
    const amp = EXUBERANCE_AMP[rarity];
    const pc = EXUBERANCE_PROC[rarity];
    if (amp === undefined) return undefined;
    return {
        type: 'incoming-heal-amplification',
        target: 'self',
        trigger: 'on-cast', // inert: not event-driven; consumed by the recipient-side fold
        conditions: [],
        config: { type: 'incoming-heal-amplification', ampPct: amp, procChance: pc },
        autoFilled: true,
    };
},
```
NOTE: do NOT set the top-level `Ability.procChance` here — Exuberance is not reactive (no trigger gate reads it); the proc lives in `config.procChance`, consumed by the recipient-side fold evaluator. Matches the sibling `mkHealAmp`/`mkReduction` helpers, which set procChance only in `config`.
- [ ] **Step 4:** Run unit (PASS) + FULL suite. Byte-identical (config inert until Task 6 wires the apply sites): snapshot diff EMPTY. `npm run lint && npx tsc --noEmit`. KNOWN: `equipmentCoverage.test.ts` now fails for EXUBERANCE — expected. Commit `--no-verify` if sole block.
- [ ] **Step 5:** Commit:
```bash
git add src/utils/abilities/buildEquipmentAbilities.ts src/utils/abilities/__tests__/buildEquipmentAbilities.test.ts
git commit -m "feat(combat): D-PR6 — Exuberance incoming-heal-amplification registry entry"
```

---

## Task 5: Engine plumbing — `recipientIncomingHealAmpPct` ctx method + per-recipient ability map

**Files:** Modify `src/utils/combat/playerTurn.ts` (`HealingRuntimeCtx` interface ~line 83); `src/utils/combat/engine.ts` (build the map ~line 2112 alongside `incomingAbilitiesById`; populate the ctx method where the healing ctx is constructed ~line 1925-1965).

This task adds the wiring with NO caller yet → byte-identical. (The apply-site calls land in Task 6.)

- [ ] **Step 1:** Add the optional method to the `HealingRuntimeCtx` interface (playerTurn.ts:83, next to `recipientIncomingHealPct`):
```ts
/** D-PR6: summed incoming-heal amplification % for a repair landing on `rid` (Exuberance). Rolls the
 *  recipient's incoming-heal-amp procs ONCE (combat-lifetime gate keyed rid+ability). Absent → callers
 *  use 0 → byte-identical. */
recipientIncomingHealAmpPct?: (rid: string) => number;
```
- [ ] **Step 2:** In `engine.ts`, build the per-recipient ability map ALONGSIDE the existing `incomingAbilitiesById` (~line 2112), mirroring it exactly but filtering `config.type === 'incoming-heal-amplification'`:
```ts
const incomingHealAmpAbilitiesById = new Map<string, Ability[]>();
for (const rt of [...runtimesById.values(), ...enemyPlayerRuntimeByActorId.values()]) {
    if (incomingHealAmpAbilitiesById.has(rt.actor.id)) continue;
    const heals: Ability[] = [];
    for (const slot of rt.castSkills.slots) {
        if (slot.slot !== 'passive') continue;
        for (const a of slot.abilities) {
            if (a.config.type === 'incoming-heal-amplification') heals.push(a);
        }
    }
    if (heals.length) incomingHealAmpAbilitiesById.set(rt.actor.id, heals);
}
const incomingHealAmpAbilitiesOf = (id: string): Ability[] => incomingHealAmpAbilitiesById.get(id) ?? [];
```
(Match the EXACT iteration/dedupe shape of the real `incomingAbilitiesById` block — read it first; the runtime collection it iterates may differ slightly.)
- [ ] **Step 3:** Populate the ctx method where the engine builds the `HealingRuntimeCtx` (~1925-1965, where `recipientIncomingHealPct` is set). Import `incomingHealAmpForRecipient` from `./healAmplification` and confirm `rollRateGate` (from `../calculators/rateAccumulator`) + `procChanceGates` are in scope (both exist):
```ts
recipientIncomingHealAmpPct: (rid) =>
    incomingHealAmpForRecipient(
        incomingHealAmpAbilitiesOf(rid),
        (abilityId, chance) => rollRateGate(procChanceGates, `${rid}:${abilityId}`, chance)
    ),
```
NOTE: the ctx is constructed (~1925) BEFORE the map is declared (~2112). This is fine — the closure is only invoked during the round loop (after the map initializes); a `const` referenced later in the same function body resolves at call time. Declare `incomingHealAmpAbilitiesOf` with `const` (do NOT inline the map at the ctx). If tsc complains about use-before-declaration (it should not for a closure), report it.
- [ ] **Step 4:** FULL suite — byte-identical (nothing CALLS the method yet): snapshot diff EMPTY, all green except the known EXUBERANCE coverage failure. `npm run lint && npx tsc --noEmit`.
- [ ] **Step 5:** Commit (`--no-verify` if the coverage failure is the sole block):
```bash
git add src/utils/combat/playerTurn.ts src/utils/combat/engine.ts
git commit -m "feat(combat): D-PR6 — recipientIncomingHealAmpPct ctx method + per-recipient ability map"
```

---

## Task 6: Apply-site folds + integration tests

**Files:** Modify `src/utils/combat/playerTurn.ts` (cast-heal player branch ~1773 area, `healEventOnly` branch ~1750 area, HoT tick `raw` ~1672); `src/utils/combat/triggers.ts` (reactive heal `raw` ~1214-1219). Test an integration test file.

At each site, immediately AFTER the existing per-recipient incoming factor (`incomingPctFor(rid)` / `holderIncomingFactor`) and BEFORE `applyHealToTarget`/`credit`, multiply the repair once. Call the ctx method EXACTLY ONCE per application (it rolls the gate once → one proc event per repair received).

- [ ] **Step 1: Write failing integration tests (healing-mode `runCombat`):**
  - A unit carrying Exuberance (e.g. legendary, procChance 0.30 — or pick a rarity/round-count that makes the deterministic gate fire a known number of times) is repaired repeatedly (cast heals) over N rounds → the boosted repairs land at the gated frequency (~proc×N of them are ×(1+ampPct/100)); total received exceeds the no-Exuberance baseline by the expected amount.
  - A unit WITHOUT Exuberance → unchanged (baseline).
  - **Single-stream check (the fidelity property):** if the harness can deliver repairs from two sources to the same unit (e.g. a cast heal + a reactive self-heal, or cast + HoT), assert the proc frequency is computed over the COMBINED repair stream (one gate), not per-source. If a two-source setup is impractical, at minimum cover the cast path thoroughly and add a focused assertion that a reactive self-heal on an Exuberance carrier is ALSO boosted (proving the reactive site folds too).
  Reference the D-PR5 healing-mode integration tests (`equipmentAbilities.integration.test.ts`) for harness shape; inject Exuberance into the recipient's passive slot.
- [ ] **Step 2:** Run, verify FAIL (ctx method exists but no apply site calls it yet).
- [ ] **Step 3: Implement the four folds.** At each site:
  - **Cast player branch** (playerTurn.ts; `raw` is already `let` from D-PR5, with `... * (1 + incomingPctFor(rid)/100)` then `raw *= 1 + healAmpPctFor(rid)/100`): append
    ```ts
    raw *= 1 + (healing.recipientIncomingHealAmpPct?.(rid) ?? 0) / 100;
    ```
  - **Cast `healEventOnly` branch** (playerTurn.ts; same shape, already `let raw`): append the same line (recipient `rid`).
  - **HoT tick** (playerTurn.ts ~1672, `const raw = maxHp * (hotPct/100) * stacks * holderIncomingFactor`): change to `let raw`, then append `raw *= 1 + (healing.recipientIncomingHealAmpPct?.(actor.id) ?? 0) / 100;` (recipient = holder = `actor.id`). Place after the `if (raw <= 0) return;` guard? NO — compute the amp on the post-incoming `raw` BEFORE the `raw <= 0` guard is irrelevant (raw>0 here); put the `raw *=` right after the `const→let raw =` line and before `healing.credit`. Verify there is only ONE HoT `raw` computation; if an enemy/event-only HoT path computes a separate `raw` that lands a repair on a recipient, fold there too (and report if the HoT path is thornier than a single raw).
  - **Reactive heal** (triggers.ts ~1214-1219; `const raw = cfg.type==='heal' ? basisValue * ... * (1 + incomingPctFor(rid)/100) : basisValue * (cfg.pct/100)`): change to `let raw`, then AFTER it, for the heal case only, append:
    ```ts
    if (cfg.type === 'heal') raw *= 1 + (healing.recipientIncomingHealAmpPct?.(rid) ?? 0) / 100;
    ```
    (`healing` is the local `const healing = ctx.healing` binding at triggers.ts ~1147, matching the surrounding `incomingPctFor`/`healing.*` style; `ctx.healing.` also compiles.) Do NOT amplify the shield branch. Place before the `ctx.healing.credit(...)` calls.
- [ ] **Step 4:** Run integration tests (PASS) + FULL suite. Byte-identical: snapshot diff EMPTY (no fixture has Exuberance → method returns 0). `npm run lint && npx tsc --noEmit`. KNOWN: only the EXUBERANCE coverage failure remains. Commit `--no-verify` if sole block.
- [ ] **Step 5:** Commit:
```bash
git add src/utils/combat/playerTurn.ts src/utils/combat/triggers.ts src/utils/combat/__tests__/<file>
git commit -m "feat(combat): D-PR6 — fold Exuberance at all repair-apply sites (cast/reactive/HoT)"
```

---

## Task 7: Coverage tracker update

**Files:** Modify `src/utils/abilities/__tests__/equipmentCoverage.test.ts`.

- [ ] **Step 1:** Add `EXUBERANCE` to BOTH the `.toEqual([...])` ordered array (determine position empirically — run the test, match received order; follows `Object.keys(IMPLANTS)`) and the `implementedImplants` Set.
- [ ] **Step 2:** Add a per-implant assertion block: Exuberance produces 1 ability for uncommon/rare/epic/legendary; common → 0. Confirm Voidfire Catalyst (and the many other not-yet-modeled implants) REMAIN in the `unimplementedImplants` loop — that loop auto-asserts 0 abilities for everything not in the implemented Set, so only the EXUBERANCE additions are needed. (Within the D-design "reactive heal/leech" row, Exuberance was the last unshipped effect; Voidfire Catalyst belongs to a different row and stays deferred.)
- [ ] **Step 3:** `npx vitest run src/utils/abilities/__tests__/equipmentCoverage.test.ts` → PASS. FULL suite → ALL GREEN. Snapshot diff EMPTY. `npm run lint && npx tsc --noEmit`.
- [ ] **Step 4:** Commit (NO `--no-verify` — branch fully green now):
```bash
git add src/utils/abilities/__tests__/equipmentCoverage.test.ts
git commit -m "test(combat): D-PR6 — coverage tracker includes Exuberance"
```

---

## Task 8: Changelog + docs

**Files:** `src/constants/changelog.ts`; `src/pages/DocumentationPage.tsx`.

- [ ] **Step 1:** Add an `UNRELEASED_CHANGES` entry (match sibling phrasing, no emojis): e.g. "Combat simulator now models the Exuberance implant (chance to increase a repair the unit receives)."
- [ ] **Step 2:** Extend the DocumentationPage implant-effects paragraph with Exuberance (bold name + parenthetical), accurately: chance to boost a repair the unit *receives*.
- [ ] **Step 3:** `npm run lint && npx tsc --noEmit` clean; snapshot diff EMPTY. Commit:
```bash
git add src/constants/changelog.ts src/pages/DocumentationPage.tsx
git commit -m "docs(combat): D-PR6 — changelog + docs for Exuberance"
```

---

## Task 9: Final verification + PR

- [ ] **Step 1:** FULL suite `npx vitest run` → ALL green; `git diff --stat 03cff2a6 -- '**/*.snap' '**/__snapshots__/**'` EMPTY.
- [ ] **Step 2:** `npm run audit:skills` → 141 ships, 0 findings.
- [ ] **Step 3:** `npm run lint` + `npx tsc --noEmit` clean.
- [ ] **Step 4:** Push + PR stacked on D-PR5 (base `feat/combat-d-pr5-reactive-heal`; retarget to main after the stack merges). `gh auth switch --user TheSusort` first; pipe push through `| cat`.

---

## Notes for the implementer

- **Byte-identical is the contract.** Every FULL-suite step must show zero golden movement. The ctx method returns 0 when the recipient has no Exuberance → `raw` unchanged.
- **Single gate per recipient:** the method keys the gate `${rid}:${abilityId}` so every repair the unit receives (cast/reactive/HoT) draws from ONE accumulator → the proc fires at the rarity % over the unit's whole repair stream. Call the method exactly ONCE per applied repair.
- **Scope:** repairs only — do NOT amplify shields (skip the shield branch) or leeches (engine.ts leech sites credit the source, not the recipient; out of scope). Exuberance is the last "reactive heal/leech" effect; only Voidfire Catalyst stays deferred.
- **HoT nuance:** verify whether the HoT tick has one `raw` or an additional enemy/event-only path; fold wherever a repair lands on a recipient. If the HoT accounting is thornier than a single `raw`, report it rather than guessing.
