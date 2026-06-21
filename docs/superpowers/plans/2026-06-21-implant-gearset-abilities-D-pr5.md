# D-PR5: Reactive heal/leech (Second Wind / Nourishment / Vivacious Repair) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Light up three implant heal effects — Second Wind (reactive self-heal on receiving a crit), Nourishment + Vivacious Repair (a new heal-cast amplification primitive) — keeping all goldens byte-identical.

**Architecture:** Second Wind is a registry entry riding the existing reactive heal executor (`on-attacked` + `triggerCritFilter: 'crit'`, basis maxHP). Nourishment + Vivacious add a pure `healAmplification.ts` evaluator + a `heal-amplification` AbilityConfig, folded multiplicatively into the cast-heal `raw` per recipient, gated on heal-target HP, reusing D-PR4's `rollOutgoingProc` gate closure.

**Tech Stack:** TypeScript, Vitest. Combat engine under `src/utils/combat/`; equipment registry under `src/utils/abilities/`.

**Spec:** `docs/superpowers/specs/2026-06-21-implant-gearset-abilities-D-pr5-design.md`

**Branch / worktree:** `feat/combat-d-pr5-reactive-heal` (worktree `.worktrees/d-pr5-reactive-heal`), stacked on D-PR4 tip `29bafb64`. Retarget to `main` after the D stack merges.

---

## CRITICAL WORKFLOW NOTES (read once)

- **Test runner:** NEVER `npm test` / `npm test --` (Vitest **watch** mode, hangs). Use `npx vitest run <pathOrName>`.
- **Goldens are load-bearing:** NEVER `vitest -u`. All DPS/healing/battle-sim snapshots must stay **byte-identical** (no fixture carries these implants; new code is inert at defaults). If a `.snap` moves, a default leaked — fix the code.
- **docs/ is gitignored:** `git add -f` for plan/spec; `git commit --no-verify` for docs-only commits.
- **Worktree env:** `.env` + `docs/*.csv` + `docs/combat-system.md` are symlinked in already.
- After each code task: `npx vitest run` the touched files, then `npm run lint` (max-warnings 0) + `npx tsc --noEmit`. Run the FULL suite on any task claiming byte-identical goldens; confirm `git diff --stat 29bafb64 -- '**/*.snap' '**/__snapshots__/**'` is EMPTY.

---

## Source values (from `src/constants/implants.ts`)

- **Second Wind** (uncommon/rare/epic/legendary): procChance 0.07/0.09/0.12/0.16; always repair **10% of max HP**. No common.
- **Nourishment** (uncommon/rare/epic/legendary): ampPct 10/15/20/30; deterministic (no proc). No common.
- **Vivacious Repair** (rare/epic/legendary): procChance 0.21/0.26/0.32; ampPct **100** (double). No common/uncommon.

---

## Task 1: Fixture audit (byte-identical safety gate — no code)

- [ ] **Step 1:** Confirm no fixture carries these implants:
```bash
cd .worktrees/d-pr5-reactive-heal
grep -rniE "second.?wind|nourishment|vivacious" src/utils/combat src/utils/calculators src/utils/abilities --include='*.ts' | grep -viE "docs/|\.md" || echo "NONE FOUND"
```
Expected: `NONE FOUND` (or only this plan/spec). If a real fixture builds a ship with these implants, STOP and re-confirm the byte-identical premise.
- [ ] **Step 2:** Record result. No commit (read-only).

---

## Task 2: Types — `heal-amplification` config + condition/context

**Files:** Modify `src/types/abilities.ts` (mirror how `outgoing-amplification` / `OutgoingCondition` were added in D-PR4).

- [ ] **Step 1:** Add near the `OutgoingCondition`/`OutgoingHitContext` block:
```ts
/**
 * Condition for a heal-cast amplification, evaluated against the HealAmpContext at the cast-heal
 * seam (per recipient) — NOT a global ConditionSubject. Mirrors OutgoingCondition (D-PR4).
 */
export type HealAmpCondition = 'target-hp-below-self' | 'target-below-25';

export interface HealAmpContext {
    /** The heal recipient's HP% at cast time. */
    targetHpPct: number;
    /** The caster's HP% at cast time. */
    selfHpPct: number;
}
```
- [ ] **Step 2:** Add `'heal-amplification'` to the `AbilityType` union (alongside `'outgoing-amplification'`).
- [ ] **Step 3:** Add the `AbilityConfig` union member (mirror `outgoing-amplification`'s shape):
```ts
      | {
            type: 'heal-amplification';
            condition: HealAmpCondition;
            /** Amplification added to the cast repair when it fires, in percentage points. */
            ampPct: number;
            /** Proc chance in (0,1); ABSENT = deterministic (always fires when gated). */
            procChance?: number;
        }
```
- [ ] **Step 4:** `npx tsc --noEmit`. If a NEW exhaustive `Record<AbilityType,...>`/switch error surfaces in the editor UI files (`AbilityCard.tsx`, `AbilityTypePicker.tsx`, `abilityDefaults.ts` — the same 3 files D-PR4 touched), add MINIMAL mirror entries (label `'Heal Amplification'`; `abilityDefaults` switch case returning `{ type, condition: 'target-hp-below-self', ampPct: 0 }` and a `DEFAULT_TARGETS` `'heal-amplification': 'self'`) — exactly mirroring the `outgoing-amplification` entries already there. Do NOT add unrelated logic.
- [ ] **Step 5:** `npx tsc --noEmit` clean + `npm run lint`. Commit:
```bash
git add src/types/abilities.ts src/components/skills/AbilityCard.tsx src/components/skills/AbilityTypePicker.tsx src/components/skills/abilityDefaults.ts
git commit -m "feat(combat): D-PR5 — heal-amplification ability config + HealAmpCondition/Context types"
```
(Only `git add` the UI files if Step 4 required them.)

---

## Task 3: Pure evaluator `healAmplification.ts`

**Files:** Create `src/utils/combat/healAmplification.ts`; Test `src/utils/combat/__tests__/healAmplification.test.ts`. Mirror `src/utils/combat/outgoingEffects.ts` (read it first).

- [ ] **Step 1: Write the failing test:**
```ts
import { describe, it, expect, vi } from 'vitest';
import { healAmplificationForCast } from '../healAmplification';
import { Ability } from '../../../types/abilities';

const amp = (id: string, condition: 'target-hp-below-self' | 'target-below-25', ampPct: number, procChance?: number): Ability => ({
    id,
    type: 'heal-amplification',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'heal-amplification', condition, ampPct, procChance },
});
const always = () => true;
const never = () => false;

describe('healAmplificationForCast', () => {
    it('returns 0 with no heal-amplification abilities', () => {
        expect(healAmplificationForCast([], { targetHpPct: 10, selfHpPct: 90 }, always)).toBe(0);
    });
    it('target-hp-below-self fires only when target HP% < self HP% (deterministic, no proc roll)', () => {
        const roll = vi.fn(() => true);
        const a = [amp('n', 'target-hp-below-self', 30)]; // no procChance
        expect(healAmplificationForCast(a, { targetHpPct: 40, selfHpPct: 90 }, roll)).toBe(30);
        expect(healAmplificationForCast(a, { targetHpPct: 95, selfHpPct: 90 }, roll)).toBe(0);
        expect(roll).not.toHaveBeenCalled(); // deterministic → gate never consulted
    });
    it('target-below-25 with procChance respects the gate', () => {
        const a = [amp('v', 'target-below-25', 100, 0.5)];
        expect(healAmplificationForCast(a, { targetHpPct: 20, selfHpPct: 50 }, always)).toBe(100);
        expect(healAmplificationForCast(a, { targetHpPct: 20, selfHpPct: 50 }, never)).toBe(0);
        expect(healAmplificationForCast(a, { targetHpPct: 30, selfHpPct: 50 }, always)).toBe(0); // not <25
    });
    it('eligibility gates the proc roll (ineligible target does not consume the gate)', () => {
        const roll = vi.fn(() => true);
        healAmplificationForCast([amp('v', 'target-below-25', 100, 0.5)], { targetHpPct: 80, selfHpPct: 50 }, roll);
        expect(roll).not.toHaveBeenCalled();
    });
    it('sums additively across abilities', () => {
        const a = [amp('n', 'target-hp-below-self', 30), amp('v', 'target-below-25', 100, undefined)];
        expect(healAmplificationForCast(a, { targetHpPct: 10, selfHpPct: 90 }, always)).toBe(130);
    });
});
```
(Add any required `Ability` fields per the interface, copying a valid literal from `outgoingEffects.test.ts`.)

- [ ] **Step 2:** Run, verify FAIL (module not found): `npx vitest run src/utils/combat/__tests__/healAmplification.test.ts`
- [ ] **Step 3: Implement:**
```ts
import { Ability, HealAmpCondition, HealAmpContext } from '../../types/abilities';

function conditionMet(cond: HealAmpCondition, ctx: HealAmpContext): boolean {
    switch (cond) {
        case 'target-hp-below-self':
            return ctx.targetHpPct < ctx.selfHpPct;
        case 'target-below-25':
            return ctx.targetHpPct < 25;
    }
}

/**
 * Summed heal-cast amplification % for one cast on one recipient (mirror of
 * outgoingAmplificationForHit). For each heal-amplification ability whose condition is met:
 * deterministic (no procChance) → always add ampPct; proc'd → add ampPct iff rollProc fires.
 * Eligibility gates the proc roll. Returns 0 when nothing applies → byte-identical with no such equipment.
 */
export function healAmplificationForCast(
    casterAbilities: Ability[],
    ctx: HealAmpContext,
    rollProc: (abilityId: string, chance: number) => boolean
): number {
    let sum = 0;
    for (const a of casterAbilities) {
        if (a.config.type !== 'heal-amplification') continue;
        if (!conditionMet(a.config.condition, ctx)) continue;
        const pc = a.config.procChance;
        if (pc !== undefined && !rollProc(a.id, pc)) continue;
        sum += a.config.ampPct;
    }
    return sum;
}
```
- [ ] **Step 4:** Run, verify PASS (5 tests). `npx tsc --noEmit` + `npm run lint`.
- [ ] **Step 5:** Commit:
```bash
git add src/utils/combat/healAmplification.ts src/utils/combat/__tests__/healAmplification.test.ts
git commit -m "feat(combat): D-PR5 — pure healAmplificationForCast evaluator (Nourishment/Vivacious)"
```

---

## Task 4: Second Wind registry entry (reactive self-heal on crit-received)

**Files:** Modify `src/utils/abilities/buildEquipmentAbilities.ts`; Test `src/utils/abilities/__tests__/buildEquipmentAbilities.test.ts` + an engine integration test.

Mirror the BLOODTHIRST entry but trigger on receiving a crit. Confirm `triggerCritFilter` is a valid `Ability` field and that the `on-attacked` listener applies it (it does — see `triggers.ts`).

- [ ] **Step 1: Unit test** (reuse the existing single-implant-ability resolution helper): Second Wind 'epic' → reactive `heal` ability, `trigger: 'on-attacked'`, `triggerCritFilter: 'crit'`, `target: 'self'`, `config.basis === 'hp'`, `config.pct === 10`, `procChance ≈ 0.12`; 'legendary' procChance ≈ 0.16; no 'common' variant.
- [ ] **Step 2: Integration test (healing-mode `runCombat`)** — find the healing/reactive test harness (search `runCombat(` + healing mode + an attacker that crits a tank; the Bloodthirst end-to-end test and `reactiveDamageProcGate`/Second-Wind-like setups are good references). Build a TANK (the heal target) carrying Second Wind, attacked by a forced-crit enemy over N rounds; assert the tank receives reactive self-repair at the gated frequency (procChance, so ~proc×N fires), and assert a non-crit attacker yields zero Second Wind repair (crit filter). Use the heal target as the Second Wind carrier so HP-restore applies (per the spec's §3.1 limitation).
- [ ] **Step 3:** Run, verify FAIL.
- [ ] **Step 4: Implement** the registry entry:
```ts
const SECOND_WIND_PROC: Record<string, number> = { uncommon: 0.07, rare: 0.09, epic: 0.12, legendary: 0.16 };

// in IMPLANT_ABILITIES:
SECOND_WIND: (rarity) => {
    const pc = SECOND_WIND_PROC[rarity];
    if (pc === undefined) return undefined;
    return {
        type: 'heal',
        target: 'self',
        trigger: 'on-attacked',
        triggerCritFilter: 'crit',
        conditions: [],
        procChance: pc,
        config: { type: 'heal', pct: 10, basis: 'hp' },
        autoFilled: true,
    };
},
```
Verify `basis: 'hp'` is the correct enum for "max HP" in the heal config (the reactive executor resolves `'hp'` → owner effective max HP). If the heal config's basis field uses a different literal for max HP, match it.
- [ ] **Step 5:** Run unit + integration (PASS) + FULL suite. Byte-identical: snapshot diff EMPTY. `npm run lint && npx tsc --noEmit`.
  KNOWN: `equipmentCoverage.test.ts` will fail for SECOND_WIND ("produces 0 abilities") — EXPECTED, fixed in Task 7. If pre-commit blocks ONLY on that, commit `--no-verify` and say so.
- [ ] **Step 6:** Commit:
```bash
git add src/utils/abilities/buildEquipmentAbilities.ts src/utils/abilities/__tests__/<files>
git commit -m "feat(combat): D-PR5 — Second Wind reactive self-heal on crit-received"
```

---

## Task 5: Nourishment + Vivacious registry entries (heal-amplification configs)

**Files:** Modify `src/utils/abilities/buildEquipmentAbilities.ts`; Test the unit test file.

- [ ] **Step 1: Unit tests:** Nourishment 'epic' → `heal-amplification` config, condition `'target-hp-below-self'`, ampPct 20, NO procChance (undefined); Nourishment 'legendary' ampPct 30; no common. Vivacious 'legendary' → condition `'target-below-25'`, ampPct 100, procChance ≈ 0.32; 'rare' procChance ≈ 0.21; no common/uncommon.
- [ ] **Step 2:** Run, verify FAIL.
- [ ] **Step 3: Implement** value tables + a helper + two entries:
```ts
const NOURISHMENT_AMP: Record<string, number> = { uncommon: 10, rare: 15, epic: 20, legendary: 30 };
const VIVACIOUS_PROC: Record<string, number> = { rare: 0.21, epic: 0.26, legendary: 0.32 };

function mkHealAmp(
    ampPct: number | undefined,
    condition: HealAmpCondition,
    procChance?: number
): Omit<Ability, 'id'> | undefined {
    if (ampPct === undefined) return undefined;
    return {
        type: 'heal-amplification',
        target: 'self',
        trigger: 'on-cast', // inert: live condition lives in config, evaluated per-cast
        conditions: [],
        config: { type: 'heal-amplification', condition, ampPct, procChance },
        autoFilled: true,
    };
}

// in IMPLANT_ABILITIES:
NOURISHMENT: (rarity) => mkHealAmp(NOURISHMENT_AMP[rarity], 'target-hp-below-self'),          // deterministic
VIVACIOUS_REPAIR: (rarity) => mkHealAmp(VIVACIOUS_PROC[rarity] !== undefined ? 100 : undefined, 'target-below-25', VIVACIOUS_PROC[rarity]),
```
Add `HealAmpCondition` to the `../../types/abilities` import.
- [ ] **Step 4:** Run unit (PASS) + FULL suite. Byte-identical (these configs aren't consumed until Task 6 wires the fold, so still byte-identical). `npm run lint && npx tsc --noEmit`.
  KNOWN: `equipmentCoverage.test.ts` now also fails for NOURISHMENT/VIVACIOUS_REPAIR — EXPECTED (Task 7). Commit `--no-verify` if that's the sole block.
- [ ] **Step 5:** Commit:
```bash
git add src/utils/abilities/buildEquipmentAbilities.ts src/utils/abilities/__tests__/<file>
git commit -m "feat(combat): D-PR5 — Nourishment + Vivacious Repair heal-amplification registry entries"
```

---

## Task 6: Cast-heal wiring (`playerTurn.ts`) — the heal-amplification fold

**Files:** Modify `src/utils/combat/playerTurn.ts` (the heal block: the two `raw =` sites at ~1717-1723 and ~1736-1742; `incomingPctFor` helper at ~1540); Test an integration test file.

Read the heal block first (the `for (const ability of healAbilities)` loop, the `healEventOnly` branch and the player branch, each with a `for (const rid of recipients)` loop computing `raw`). Both `raw` computations get the amplification multiply per recipient.

- [ ] **Step 1: Write failing integration tests (healing-mode `runCombat`):**
  - **Nourishment:** a healer with Nourishment repairs an ally whose HP% is BELOW the healer's → repair is boosted by ampPct; when the ally's HP% is ABOVE the healer's → no boost (baseline). Assert the credited/applied repair differs accordingly. (Set healer and target HP% so the comparison is unambiguous; force/await a cast heal.)
  - **Vivacious:** a healer with Vivacious repairs an ally at <25% HP → repair roughly doubles at the gated frequency over N casts; a target ≥25% HP → never doubles.
  - A no-implant control run → equals the pre-task baseline (byte-identical sanity).
  Reference the existing healing-mode `runCombat` / `simulateHealing` tests for harness shape; inject the implant ability into the healer's passive slot the way the Task-4/D-PR4 engine tests do.
- [ ] **Step 2:** Run, verify FAIL (engine passes the abilities but the fold doesn't yet apply them).
- [ ] **Step 3: Implement.** In `runPlayerTurn`, before the heal loop (near where `rollOutgoingProc` is read, ~line 1148, and where `incomingPctFor` is defined ~1540), add:
```ts
const healAmpAbilities = (passiveSkill?.abilities ?? []).filter(
    (a) => a.config.type === 'heal-amplification'
);
// Per-recipient HP% at cast time (NEW — there is no existing per-recipient HP% accessor; incomingPctFor
// is the sibling pattern). Uses the healing runtime's per-recipient pool. Falls back to the engine
// targetHpPct arg for the bound heal target, then 100.
const recipientHpPctFor = (rid: string): number => {
    const max = healing.recipientMaxHp(rid);
    const a = healing.recipientActor(rid);
    if (a && max > 0) return (100 * Math.max(0, a.currentHp)) / max;
    if (rid === healing.targetId) return targetHpPctArg;
    return 100;
};
const healAmpPctFor = (rid: string): number =>
    healAmpAbilities.length > 0 && rollOutgoingProc
        ? healAmplificationForCast(
              healAmpAbilities,
              { targetHpPct: recipientHpPctFor(rid), selfHpPct: selfHpPctArg },
              rollOutgoingProc
          )
        : 0;
```
Import `healAmplificationForCast` from `./healAmplification`. Confirm `targetHpPctArg` and `selfHpPctArg` are the destructured arg names in scope (they are — `selfHpPct: selfHpPctArg = 100`, and `targetHpPct: targetHpPctArg`). Confirm `healing.recipientActor`/`recipientMaxHp`/`targetId` exist on the healing ctx (they do).

Then multiply BOTH `raw` computations by `(1 + healAmpPctFor(rid) / 100)`. In each `for (const rid of recipients)` loop, after `raw` is computed (the existing 6-factor product), apply:
```ts
raw *= 1 + healAmpPctFor(rid) / 100;
```
IMPORTANT:
- Call `healAmpPctFor(rid)` exactly ONCE per recipient per cast (it rolls the proc gate). Place the multiply right after each `const raw = ...` and before any `applyHealToTarget`/`credit`. A single cast takes ONLY ONE of the two branches (healEventOnly vs player), so a recipient is rolled once.
- `recipientHpPctFor` for a self-cast (`rid === actor.id`): `target-hp-below-self` → `selfHpPct < selfHpPct` = false (correct — not a lower-HP ally).
- The `raw` is `const` today — change to `let` (or apply the factor inline in the product). Prefer `let raw = ...; raw *= 1 + healAmpPctFor(rid)/100;` to keep the existing 6-factor expression readable.
- [ ] **Step 4:** Run the integration tests (PASS) + FULL suite. Byte-identical: snapshot diff EMPTY (no fixture has a heal-amp ability → `healAmpAbilities` empty → factor 1.0). `npm run lint && npx tsc --noEmit`.
  KNOWN: only the `equipmentCoverage.test.ts` SECOND_WIND/NOURISHMENT/VIVACIOUS_REPAIR failures remain. Commit `--no-verify` if that's the sole block.
- [ ] **Step 5:** Commit:
```bash
git add src/utils/combat/playerTurn.ts src/utils/combat/__tests__/<file>
git commit -m "feat(combat): D-PR5 — fold heal-cast amplification into the cast-heal raw (Nourishment/Vivacious)"
```

---

## Task 7: Coverage tracker update

**Files:** Modify `src/utils/abilities/__tests__/equipmentCoverage.test.ts`.

- [ ] **Step 1:** Add `NOURISHMENT`, `SECOND_WIND`, `VIVACIOUS_REPAIR` to BOTH the `.toEqual([...])` ordered array and the `implementedImplants` Set. Determine the array ORDER empirically (run the test, read the received-vs-expected diff — do NOT guess; it follows `Object.keys(IMPLANTS)`).
- [ ] **Step 2:** Add per-implant assertion blocks (mirror existing ones): Second Wind 1 ability for each of uncommon/rare/epic/legendary (no common → 0); Nourishment 1 for uncommon/rare/epic/legendary (no common); Vivacious 1 for rare/epic/legendary (no common/uncommon). Confirm Exuberance STAYS in the unimplemented loop (deferred → 0 abilities).
- [ ] **Step 3:** `npx vitest run src/utils/abilities/__tests__/equipmentCoverage.test.ts` → PASS. Then FULL suite → ALL GREEN. Snapshot diff EMPTY. `npm run lint && npx tsc --noEmit`.
- [ ] **Step 4:** Commit (NO `--no-verify` — branch should be fully green now; let the hook run):
```bash
git add src/utils/abilities/__tests__/equipmentCoverage.test.ts
git commit -m "test(combat): D-PR5 — coverage tracker includes Second Wind/Nourishment/Vivacious Repair"
```

---

## Task 8: Changelog + docs

**Files:** Modify `src/constants/changelog.ts` (`UNRELEASED_CHANGES`); `src/pages/DocumentationPage.tsx` (the implant/gear-set effects paragraph the prior D PRs extended).

- [ ] **Step 1:** Add an `UNRELEASED_CHANGES` entry matching sibling phrasing (present tense, "Combat simulator now models …", no emojis), e.g.: "Combat simulator now models three more heal implants: Second Wind (chance to repair itself when it takes a critical hit), Nourishment (stronger repairs on allies with less HP than the healer), and Vivacious Repair (chance to double a repair on a critically wounded ally)."
- [ ] **Step 2:** Extend the DocumentationPage implant-effects paragraph with the three effects (bold name + parenthetical), consistent with the existing entries. Accurate wording: Second Wind = self-repair chance on receiving a critical hit; Nourishment = larger repairs when the target's HP is below the healer's; Vivacious Repair = chance to double a repair on an ally below 25% HP.
- [ ] **Step 3:** `npm run lint && npx tsc --noEmit` clean; snapshot diff EMPTY. Commit:
```bash
git add src/constants/changelog.ts src/pages/DocumentationPage.tsx
git commit -m "docs(combat): D-PR5 — changelog + docs for Second Wind/Nourishment/Vivacious Repair"
```

---

## Task 9: Final verification

- [ ] **Step 1:** FULL suite: `npx vitest run` → ALL green; `git diff --stat 29bafb64 -- '**/*.snap' '**/__snapshots__/**'` EMPTY.
- [ ] **Step 2:** `npm run audit:skills` → 141 ships, 0 findings (unchanged).
- [ ] **Step 3:** `npm run lint` + `npx tsc --noEmit` clean.
- [ ] **Step 4:** Push + create PR stacked on D-PR4 (base `feat/combat-d-pr4-outgoing-amplification`; retarget to main after the stack merges). `gh auth switch --user TheSusort` first; pipe push through `| cat`.

---

## Notes for the implementer

- **Byte-identical is the contract.** Every "FULL suite" step must show zero golden movement. If a snapshot moves, the heal-amp fold or Second Wind leaked — fix it, never `-u`.
- **Gate determinism:** heal-amp procs ride the same `rollOutgoingProc` per-(owner,ability) gate as D-PR4; heal-amp ability ids are distinct, so no collision. Call `healAmpPctFor(rid)` once per recipient per cast.
- **Scope:** amplification applies to the cast repair only; Second Wind is the reactive rider; Exuberance is deferred to D-PR6. Don't widen scope.
- **The `selfHpPctArg` provenance is verified** (engine `buildTurnArgs` computes it from the acting actor's live HP%) — `target-hp-below-self` is viable without new plumbing. If the integration test shows the caster reading 100% unexpectedly, re-check that the healer is the acting actor in the harness.
