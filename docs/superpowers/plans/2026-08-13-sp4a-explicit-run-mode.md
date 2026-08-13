# SP-4a — Explicit Run Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the engine's three implicit run-kind discriminators with one explicit `mode` input, with zero behaviour change and zero golden movement.

**Architecture:** `CombatEngineInput.mode?: 'dps' | 'healing' | 'battle'` becomes the engine's only run-kind signal. `dpsEnemyTarget` (roster-emptiness), `healingMode` (`healTarget` presence) and `positionalTeamBattle` (a boolean naming a mode) all stop deciding run kind. A transitional derivation keeps every commit green while ~200 test files are migrated by codemod, then it is deleted and replaced by a validation guard that demands explicitness.

**Tech Stack:** TypeScript, Vitest, existing `src/utils/combat/engine.ts`. One throwaway Node ESM codemod under `scripts/`.

## Global Constraints

- **Every commit must be green.** `.husky/pre-commit` runs `npx lint-staged`, `npx tsc --noEmit`, and `npm test -- --run` (full suite, 501+ files). There is no CI test workflow — this hook is the gate. Intermediate red states are not an option; each task ends green.
- **Never run `vitest -u`.** Every golden change needs a stated cause.
- **Expected golden movement for this entire PR: ZERO.** `git diff --stat -- '*.snap'` must be empty at every commit. Any movement means the mode mapping is not equivalent — stop and investigate, do not re-pin.
- **This PR changes no behaviour.** It is a discriminator refactor plus a mechanical test migration. Behaviour changes belong to SP-4b (normalization) and SP-4e (heal routes).
- **No new dummy branches.** The dummy is untouched here; it is deleted in SP-4c.
- `enemyType` stays a fight-wide input (spec §3.1). Out of scope.
- Spec: `docs/superpowers/specs/2026-08-13-sp4-retire-the-dummy-design.md`.

---

## Deviation from the spec's ladder — read before starting

The spec's PR 4a bundled normalization **and** the explicit mode. **This plan implements only the mode half, and does it first.** Reason: normalization carries all of buckets A and B churn, while the mode change carries none. Bundled, a moved golden could be attributed to either cause and the audit becomes guesswork. Split, this PR has an absolute gate (zero `.snap` movement) and normalization's churn is then unambiguous.

Revised ladder: **4a explicit mode (this plan, zero movement)** → 4b normalization (all churn) → 4c delete the dummy → 4d delete the scalar inputs → 4e heal routes.

## Two facts verified against the code (do not re-derive)

**1. `healingMode` is NOT "the healing calculator is running".** `engine.ts:2317` reads
`healTarget = explicitHealTarget ?? (positionalTeamBattle ? attacker : undefined)` — battle mode anchors the heal target to the focus, so `healingMode = !!healTarget` is **true in battle mode too**. It means *the heal pipeline is active*. It is therefore renamed `healPipelineActive` and **kept**, not folded into `mode`. Tying the healing result block (`engine.ts:10361`) to `mode === 'healing'` would drop that block from every sim result and move the sim's result shape.

**2. The transitional mapping is provably exact.** `engine.ts:2306` throws when `healTargetId` is set but unresolvable, so `input.healTargetId` present ⟺ `explicitHealTarget` defined. Hence:

| Caller | Today | `runMode` | `isDpsMeasurementRun` | `teamBattle` | `healTarget` |
| --- | --- | --- | --- | --- | --- |
| `dpsSimulator` | no healTargetId, no PTB | `'dps'` | true = true ✓ | false = false ✓ | undefined ✓ |
| `healingEngineAdapter` | healTargetId set | `'healing'` | false = false ✓ | false = false ✓ | explicit ✓ |
| `battleSimulator` | `positionalTeamBattle: true` | `'battle'` | false = false ✓ | true = true ✓ | attacker ✓ |

## File Structure

| File | Responsibility |
| --- | --- |
| `src/utils/combat/engine.ts` (modify) | `RunMode` type, `mode` input field, the 4 internal read sites, the transitional derivation, then the final guard |
| `src/utils/combat/__tests__/runModeEquivalence.test.ts` (create) | Proves `mode` ≡ the legacy signals, and that the guard fires |
| `src/utils/calculators/battleSimulator.ts` (modify) | passes `mode: 'battle'` |
| `src/utils/calculators/healingEngineAdapter.ts` (modify) | passes `mode: 'healing'` |
| `src/utils/calculators/dpsSimulator.ts` (modify) | passes `mode: 'dps'` |
| `scripts/codemod-run-mode.mjs` (create, then delete in Task 7) | One-shot test-corpus migration with a dry-run mode |
| ~200 test files (modify) | gain `mode: 'healing'` / `mode: 'battle'` |

---

### Task 1: `RunMode` type, `mode` input, and the transitional derivation

**Files:**
- Modify: `src/utils/combat/engine.ts:1200-1210` (type decl), `:2317-2326` (derivation), `:3008-3010` (healing ctx), `:10361` (result block)
- Test: `src/utils/combat/__tests__/runModeEquivalence.test.ts` (create)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `export type RunMode = 'dps' | 'healing' | 'battle'` from `src/utils/combat/engine.ts`; `CombatEngineInput.mode?: RunMode`; internal locals `runMode: RunMode`, `healPipelineActive: boolean`, `isDpsMeasurementRun: boolean`.

- [ ] **Step 1: Write the failing test**

Create `src/utils/combat/__tests__/runModeEquivalence.test.ts`. The fixture below is complete — the field list is verified against `src/utils/combat/__tests__/healingPerRecipientApply.test.ts:90-115`, which is the closest existing direct-engine base. The focus actor's id is the literal `'attacker'` (`engine.ts`'s `focusActorId`).

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { Ability, ShipSkills } from '../../../types/abilities';
import { setupKeyedTestRng } from '../../calculators/rateAccumulator';

// NOTE: do NOT call resetRateGateRng() after setupKeyedTestRng() — reset nulls the keyed
// provider and restores Math.random, un-seeding the test (rateAccumulator.ts:26-29).

const FOCUS_ID = 'attacker';

let idc = 0;
const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `sp4a_${++idc}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...p,
});

const damageSkills = (): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [ab({ type: 'damage', config: { type: 'damage', multiplier: 100 } })],
        },
    ],
});

/** A heal-carrying kit: `self` so the fixture needs no team actors (a bare `stats.hp` team ally
 *  would be silently reduced to 1 HP by `normalizeTeamActorsToWalked` without a `walk` bundle). */
const selfHealSkills = (): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                ab({
                    type: 'heal',
                    target: 'self',
                    config: { type: 'heal', pct: 10, basis: 'hp' },
                }),
            ],
        },
    ],
});

const base = (): CombatEngineInput => ({
    attack: 10_000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: damageSkills(),
    enemyDefense: 0,
    enemyHp: 1_000_000_000,
    numRounds: 2,
    selfBuffs: [],
    enemyDebuffs: [],
    selfDotModifier: 0,
    defensePenetrationBuff: 0,
    hasChargedSkill: false,
    startCharged: false,
    affinityDamageModifier: 0,
    affinityCritCap: 100,
    affinityCritPenalty: 0,
    defence: 0,
    hp: 50_000,
    speed: 300,
});

const DPS_BASE = (): CombatEngineInput => ({ ...base() });
/** No `healTargetId` here — each test adds it, so the "mode 'healing' names no heal focus"
 *  guard test in Task 6 can omit it. */
const HEAL_BASE = (): CombatEngineInput => ({ ...base(), shipSkills: selfHealSkills() });
const BATTLE_BASE = (): CombatEngineInput => ({ ...base() });

describe('run mode is equivalent to the legacy discriminators', () => {
    beforeEach(() => {
        setupKeyedTestRng(9001);
    });

    it("mode 'battle' is byte-identical to positionalTeamBattle: true", () => {
        setupKeyedTestRng(9001);
        const legacy = runCombat({ ...BATTLE_BASE(), positionalTeamBattle: true });
        setupKeyedTestRng(9001);
        const explicit = runCombat({ ...BATTLE_BASE(), mode: 'battle' });

        expect(explicit).toEqual(legacy);
    });

    it("mode 'healing' is byte-identical to healTargetId alone", () => {
        setupKeyedTestRng(9001);
        const legacy = runCombat({ ...HEAL_BASE(), healTargetId: FOCUS_ID });
        setupKeyedTestRng(9001);
        const explicit = runCombat({ ...HEAL_BASE(), healTargetId: FOCUS_ID, mode: 'healing' });

        expect(explicit).toEqual(legacy);
    });

    it("omitting mode on a plain DPS input is identical to mode 'dps'", () => {
        setupKeyedTestRng(9001);
        const implicit = runCombat({ ...DPS_BASE() });
        setupKeyedTestRng(9001);
        const explicit = runCombat({ ...DPS_BASE(), mode: 'dps' });

        expect(explicit).toEqual(implicit);
    });

    it("battle mode keeps the healing result block (healPipelineActive, not mode, gates it)", () => {
        // Regression fence for the fact verified in this plan: battle mode anchors healTarget to
        // the focus, so the `healing` block IS present in a sim result. Gating that block on
        // `mode === 'healing'` would silently drop it from every battleSimulator result.
        const result = runCombat({ ...BATTLE_BASE(), mode: 'battle' });
        expect('healing' in result && result.healing !== undefined).toBe(true);
    });
});
```

`'healing' in result` rather than `result.healing` on purpose: the field arrives via a conditional spread (`engine.ts:10361`), so depending on how TypeScript infers that return type a direct property read may not typecheck. If `result.healing` compiles cleanly in your checkout, prefer it — it reads better.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/utils/combat/__tests__/runModeEquivalence.test.ts`
Expected: FAIL — TypeScript rejects `mode` (`Object literal may only specify known properties`).

- [ ] **Step 3: Add the `RunMode` type and the `mode` input field**

In `src/utils/combat/engine.ts`, immediately above the `CombatEngineInput` interface:

```ts
/**
 * What kind of run this is — the engine's ONLY run-kind discriminator.
 *
 *  - `'dps'`     the focus's output is the report. The run ends when the focus's target dies, and
 *                also when the focus itself dies (nothing left to measure).
 *  - `'healing'` heal/shield accounting is the report. The run continues past the focus's death.
 *  - `'battle'`  two-team battle. The squad fights on without its focus.
 *
 * Default `'dps'`. The default is a CONSTANT, not a derivation — that distinction is the whole
 * point of this type. Never infer a mode from a data field (`healTargetId`, roster emptiness):
 * that is exactly what SP-4 removed.
 */
export type RunMode = 'dps' | 'healing' | 'battle';
```

Inside `CombatEngineInput`, directly above the existing `positionalTeamBattle` declaration (`:1207`):

```ts
    /** See `RunMode`. Default `'dps'`. Required in spirit: `healTargetId` without
     *  `mode: 'healing'` throws once the transitional derivation is gone (Task 6). */
    mode?: RunMode;
```

- [ ] **Step 4: Replace the three derivations**

In `src/utils/combat/engine.ts`, replace lines `2317-2326` (from `const healTarget =` through `const isDpsMeasurementRun = ...`) with:

```ts
    // TRANSITIONAL — DELETED IN TASK 6. Until every caller passes `mode`, fall back to the legacy
    // signals. The mapping is EXACT, not approximate: `healTargetId` present implies
    // `explicitHealTarget` defined, because :2306 throws otherwise. See the plan's equivalence table.
    const runMode: RunMode =
        input.mode ??
        (input.positionalTeamBattle ? 'battle' : input.healTargetId ? 'healing' : 'dps');

    const healTarget = explicitHealTarget ?? (runMode === 'battle' ? attacker : undefined);

    /**
     * The heal/shield pipeline is active — TRUE IN BATTLE MODE TOO, because battle mode anchors
     * `healTarget` to the focus above. This is NOT a mode and must never be conflated with
     * `runMode === 'healing'`: the healing RESULT BLOCK is gated on it, and every
     * `battleSimulator` result carries that block today.
     */
    const healPipelineActive = !!healTarget;

    /**
     * A DPS MEASUREMENT run: one focus attacker whose output is the whole point. Load-bearing for
     * the focus-death exit — only here does the focus dying mean there is nothing left to report.
     * Healing and battle runs legitimately continue past it and pin that behaviour in tests.
     */
    const isDpsMeasurementRun = runMode === 'dps';
```

- [ ] **Step 5: Point the remaining read sites at the new locals**

Two edits, both mechanical.

`src/utils/combat/engine.ts:3008-3010` — inside the `healingCtx` object:

```ts
              teamBattle: runMode === 'battle',
              perRecipientApply: (input.perRecipientHealApply ?? false) || runMode === 'battle',
```

`src/utils/combat/engine.ts:10361` — the result-block spread:

```ts
        ...(healPipelineActive
```

- [ ] **Step 6: Verify no `healingMode` reference survives**

Run: `grep -n "healingMode" src/utils/combat/engine.ts`
Expected: no output. (Comments mentioning it must be updated too — rule 7.4 of the spec: sweep the claims around each edit, not just the edit. Check `:2320-2325` and `:10360`.)

- [ ] **Step 7: Run the new test**

Run: `npx vitest run src/utils/combat/__tests__/runModeEquivalence.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 8: Run the full suite and confirm zero golden movement**

Run: `npx tsc --noEmit && npm test -- --run 2>&1 | tail -20`
Expected: all files pass.

Run: `git diff --stat -- '*.snap'`
Expected: **empty output.** Any movement here means the mapping is not equivalent — stop.

- [ ] **Step 9: Commit**

```bash
git add src/utils/combat/engine.ts src/utils/combat/__tests__/runModeEquivalence.test.ts
git commit -m "refactor(engine): one explicit run mode replaces three implicit discriminators

Adds CombatEngineInput.mode ('dps' | 'healing' | 'battle') and routes the
focus-death exit, the teamBattle heal routing and the per-recipient axis
through it. healingMode is renamed healPipelineActive and KEPT: it means
'the heal pipeline is active', which is true in battle mode too, so the
healing result block must not be gated on mode === 'healing'.

A transitional derivation from the legacy signals keeps every caller working
until the codemod migrates them; it is deleted with positionalTeamBattle.

Zero golden movement."
```

---

### Task 2: Production callers state their mode

**Files:**
- Modify: `src/utils/calculators/battleSimulator.ts:1075`, `src/utils/calculators/healingEngineAdapter.ts:540` (near `enemyAttackers:`), `src/utils/calculators/dpsSimulator.ts:454-478` (the engine-input object)

**Interfaces:**
- Consumes: `CombatEngineInput.mode` from Task 1.
- Produces: nothing new; after this task no production caller relies on the transitional derivation.

**No new test in this task, by decision.** An earlier draft asserted on source TEXT (grep-as-test) that each caller passes `mode`. Dropped: the healing and battle callers' explicitness is enforced behaviourally by Task 6's guards (an un-migrated caller throws with a named error), and `mode: 'dps'` is the default so there is nothing behavioural to assert for `dpsSimulator`. Coverage for this task is `tsc` plus the existing suites for all three callers — `battleSimulator`'s and `healingEngineAdapter`'s tests exercise these exact paths and would fail on a wrong mode.

- [ ] **Step 1: Add `mode` to each caller**

`src/utils/calculators/battleSimulator.ts:1075` — replace `positionalTeamBattle: true,` with:

```ts
        mode: 'battle',
```

`src/utils/calculators/healingEngineAdapter.ts` — in the engine-input object next to `enemyAttackers: engineEnemyAttackers,` (`:540`):

```ts
        mode: 'healing',
```

`src/utils/calculators/dpsSimulator.ts` — in the engine-input object alongside `enemyDefense,` / `enemyHp,` (`:454-455`):

```ts
        mode: 'dps',
```

- [ ] **Step 2: Verify the callers' own suites still pass**

Run: `npx vitest run src/utils/calculators/__tests__ src/utils/combat/__tests__/runModeEquivalence.test.ts 2>&1 | tail -20`
Expected: all pass. A wrong mode on any caller breaks these — `battleSimulator`'s tests depend on `teamBattle` routing and `healingEngineAdapter`'s on the healing result block.

- [ ] **Step 3: Full verification**

Run: `npx tsc --noEmit && npm test -- --run 2>&1 | tail -20`
Expected: all pass. `git diff --stat -- '*.snap'` empty.

- [ ] **Step 4: Commit**

```bash
git add src/utils/calculators/battleSimulator.ts src/utils/calculators/healingEngineAdapter.ts src/utils/calculators/dpsSimulator.ts
git commit -m "refactor(calculators): production callers state their run mode

battleSimulator -> 'battle' (replacing positionalTeamBattle: true),
healingEngineAdapter -> 'healing', dpsSimulator -> 'dps'. No production
caller relies on the transitional derivation any more. Zero golden movement."
```

---

### Task 3: Codemod — dry run over the test corpus

**Files:**
- Create: `scripts/codemod-run-mode.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `scripts/codemod-run-mode.mjs`, runnable as `node scripts/codemod-run-mode.mjs --dry` (report only) or `node scripts/codemod-run-mode.mjs --apply`. Deleted in Task 7.

Rationale: ~195 files set `healTargetId` and ~29 set `positionalTeamBattle`. Hand-editing is error-prone and unreviewable; a generated, uniform diff is both.

- [ ] **Step 1: Write the codemod**

Create `scripts/codemod-run-mode.mjs`:

```js
/**
 * ONE-SHOT codemod for SP-4a. Deleted once the migration is committed.
 *
 * Rules, in precedence order (mirroring engine.ts's transitional derivation exactly):
 *   1. `positionalTeamBattle: true`  -> replaced by `mode: 'battle'`
 *   2. an object-literal `healTargetId: <value>` property -> `mode: 'healing',` inserted after it
 * A file already containing a `mode:` run-mode literal is skipped (idempotent).
 *
 * Deliberately conservative: it only matches an object-literal PROPERTY line, never a type
 * annotation (`healTargetId?: string`) and never a member access (`input.healTargetId`).
 * Anything it cannot classify is reported as residue for hand-migration, never guessed at.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const APPLY = process.argv.includes('--apply');

const files = execSync(
    "grep -rl 'healTargetId\\|positionalTeamBattle' src --include='*.ts' --include='*.tsx'",
    { encoding: 'utf8' }
)
    .split('\n')
    .filter((f) => f.includes('__tests__'));

// `healTargetId:` as an object-literal property with a real value. Excludes type annotations by
// requiring the value not to start with a TS primitive/type keyword.
const HEAL_PROP = /^(\s*)healTargetId:\s*(?!(?:string|undefined|never)\b)\S.*$/;
const PTB_TRUE = /^(\s*)positionalTeamBattle:\s*true\s*,?\s*$/;
const ALREADY = /\bmode:\s*'(?:dps|healing|battle)'/;

const changed = [];
const residue = [];

for (const file of files) {
    const src = readFileSync(file, 'utf8');
    if (ALREADY.test(src)) continue;

    const lines = src.split('\n');
    const out = [];
    let edits = 0;

    for (const line of lines) {
        const ptb = line.match(PTB_TRUE);
        if (ptb) {
            out.push(`${ptb[1]}mode: 'battle',`);
            edits++;
            continue;
        }
        out.push(line);
        const heal = line.match(HEAL_PROP);
        if (heal) {
            out.push(`${heal[1]}mode: 'healing',`);
            edits++;
        }
    }

    if (edits === 0) {
        // The file mentions one of the symbols but exposes no migratable property line —
        // a member access, a type, or a shape the codemod refuses to guess at.
        residue.push(file);
        continue;
    }
    changed.push(`${file}  (+${edits})`);
    if (APPLY) writeFileSync(file, out.join('\n'));
}

console.log(`${APPLY ? 'APPLIED' : 'DRY RUN'} — ${changed.length} files edited`);
for (const c of changed) console.log(`  ${c}`);
console.log(`\nRESIDUE — ${residue.length} files need a human (Task 6):`);
for (const r of residue) console.log(`  ${r}`);
```

- [ ] **Step 2: Run the dry run**

Run: `node scripts/codemod-run-mode.mjs --dry 2>&1 | tail -40`
Expected: a count of edited files (order-of-200) and an explicit residue list.

- [ ] **Step 3: Sanity-check three edits by hand before trusting the batch**

Pick three files from the report — one with `healTargetId`, one with `positionalTeamBattle`, one with both — and read the lines the codemod would touch. Confirm each is an object-literal property inside a `runCombat(...)` input, not a type or a member access.

Run: `grep -n "healTargetId\|positionalTeamBattle" <each file>`

- [ ] **Step 4: Commit the codemod alone (no source edits yet)**

```bash
git add scripts/codemod-run-mode.mjs
git commit -m "chore(sp4a): one-shot codemod for the run-mode migration

Dry-run first: reports which test files carry a migratable healTargetId /
positionalTeamBattle property and which are residue for hand-migration.
Deliberately refuses to guess at shapes it cannot classify. Deleted once the
migration lands."
```

---

### Task 4: Apply the codemod

**Files:**
- Modify: ~200 test files (generated)

**Interfaces:**
- Consumes: `scripts/codemod-run-mode.mjs` from Task 3.
- Produces: a test corpus where every legacy-signal call site states its mode.

- [ ] **Step 1: Apply**

Run: `node scripts/codemod-run-mode.mjs --apply 2>&1 | tail -40`

- [ ] **Step 2: Confirm the diff is uniform**

Run: `git diff --stat | tail -5`
Run: `git diff -U0 | grep '^+' | grep -v '^+++' | sort | uniq -c | sort -rn | head`
Expected: essentially two distinct added lines (`mode: 'healing',` and `mode: 'battle',`) at varying indentation. **Any third kind of added line means the codemod did something unintended — revert with `git checkout -- src` and fix the script.**

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean. A failure here localises a bad insertion precisely (e.g. inserted into a type literal).

- [ ] **Step 4: Run the full suite**

Run: `npm test -- --run 2>&1 | tail -30`
Expected: all pass. Behaviour is unchanged by construction — the codemod writes exactly what the transitional derivation already computed.

- [ ] **Step 5: Confirm zero golden movement**

Run: `git diff --stat -- '*.snap'`
Expected: **empty.**

- [ ] **Step 6: Commit**

```bash
git add src
git commit -m "test(sp4a): state the run mode at every legacy call site

Generated by scripts/codemod-run-mode.mjs. Each site gains exactly the mode
the transitional derivation already computed for it, so behaviour and every
golden are unchanged. positionalTeamBattle: true is replaced outright."
```

---

### Task 5: Hand-migrate the residue

**Files:**
- Modify: the files listed as RESIDUE by Task 3's report

**Interfaces:**
- Consumes: the residue list.
- Produces: a corpus with no un-migrated legacy-signal call site.

- [ ] **Step 1: Re-run the dry run to get the current residue list**

Run: `node scripts/codemod-run-mode.mjs --dry 2>&1 | sed -n '/RESIDUE/,$p'`

- [ ] **Step 2: Classify each residue file**

For each, run `grep -n "healTargetId\|positionalTeamBattle" <file>` and decide:
- **A helper function** building input from overrides → add `mode: 'healing'` (or `'battle'`) to the helper's base object, once.
- **A member access** (`input.healTargetId`) or a **type annotation** → no change needed; the file is a false positive.
- **A spread of a shared base** already carrying the mode → no change needed.

Make the edit that fits. Do not add a mode to a file that never calls `runCombat`.

- [ ] **Step 3: Verify nothing is left relying on the transitional derivation**

Run: `grep -rn "positionalTeamBattle" src --include='*.ts' --include='*.tsx' | grep -v "engine.ts"`
Expected: no output. (`engine.ts` still declares the field; Task 6 removes it.)

- [ ] **Step 4: Full verification**

Run: `npx tsc --noEmit && npm test -- --run 2>&1 | tail -20`
Expected: all pass. `git diff --stat -- '*.snap'` empty.

- [ ] **Step 5: Commit**

```bash
git add src
git commit -m "test(sp4a): hand-migrate the call sites the codemod refused to guess

Helper functions building engine input from overrides now state their mode in
the base object. Member accesses and type annotations were false positives and
are unchanged. No call site relies on the transitional derivation any more."
```

---

### Task 6: Delete the transitional derivation and demand explicitness

**Files:**
- Modify: `src/utils/combat/engine.ts` (the `positionalTeamBattle` field, the transitional derivation)
- Test: `src/utils/combat/__tests__/runModeEquivalence.test.ts`

**Interfaces:**
- Consumes: `RunMode`, `mode` from Task 1; a fully migrated corpus from Tasks 4-5.
- Produces: `mode` as the sole run-kind signal; two validation guards.

- [ ] **Step 1: Write the failing test**

Append to `src/utils/combat/__tests__/runModeEquivalence.test.ts`:

```ts
describe('the engine demands an explicit mode rather than inferring one', () => {
    it("throws when healTargetId is set without a heal-bearing mode", () => {
        expect(() => runCombat({ ...HEAL_BASE(), healTargetId: FOCUS_ID })).toThrow(
            /healTargetId requires mode/
        );
    });

    it("throws when mode 'healing' names no heal focus", () => {
        expect(() => runCombat({ ...HEAL_BASE(), mode: 'healing' })).toThrow(
            /mode 'healing' requires healTargetId/
        );
    });

    it("accepts healTargetId with mode 'healing'", () => {
        expect(() =>
            runCombat({ ...HEAL_BASE(), healTargetId: FOCUS_ID, mode: 'healing' })
        ).not.toThrow();
    });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/utils/combat/__tests__/runModeEquivalence.test.ts -t 'demands an explicit mode'`
Expected: FAIL — no throw (the transitional derivation still infers `'healing'`).

- [ ] **Step 3: Replace the derivation with validation**

In `src/utils/combat/engine.ts`, replace the transitional `runMode` block from Task 1 with:

```ts
    const runMode: RunMode = input.mode ?? 'dps';

    // Explicitness guards. These do NOT infer a mode — they refuse an input whose mode and data
    // disagree, which is the difference between validation and the derivation SP-4 removed.
    // Mirrors the engine's existing style (`:2349` throws on a colliding enemyAttacker id).
    if (input.healTargetId && runMode !== 'healing' && runMode !== 'battle') {
        throw new Error(
            `runCombat: healTargetId requires mode 'healing' or 'battle' (got '${runMode}')`
        );
    }
    if (runMode === 'healing' && !input.healTargetId) {
        throw new Error(`runCombat: mode 'healing' requires healTargetId`);
    }
```

- [ ] **Step 4: Delete the `positionalTeamBattle` input field**

Remove the whole declaration and its doc comment at `src/utils/combat/engine.ts:1203-1207` (the comment block beginning "Positional team-vs-team battle"). Then update the `perRecipientHealApply` doc comment directly below it, which references `positionalTeamBattle` twice — it must now say `mode: 'battle'` (spec rule 7.4: sweep the claims around the edit).

- [ ] **Step 5: Verify the symbol is gone**

Run: `grep -rn "positionalTeamBattle" src --include='*.ts' --include='*.tsx'`
Expected: no output.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/utils/combat/__tests__/runModeEquivalence.test.ts`
Expected: PASS, 8 tests.

Run: `npx tsc --noEmit && npm test -- --run 2>&1 | tail -30`
Expected: all pass. If a file fails with `healTargetId requires mode`, that is a call site Tasks 4-5 missed — add its mode; the guard is doing its job.

Run: `git diff --stat -- '*.snap'`
Expected: **empty.**

- [ ] **Step 7: Commit**

```bash
git add src/utils/combat/engine.ts src/utils/combat/__tests__/runModeEquivalence.test.ts
git commit -m "refactor(engine): mode is the only run-kind signal

Deletes the transitional derivation and the positionalTeamBattle input. Two
guards replace the inference: healTargetId without a heal-bearing mode throws,
and mode 'healing' without healTargetId throws. Validation, not derivation --
the engine refuses a contradictory input instead of quietly picking a mode.

Zero golden movement."
```

---

### Task 7: Clean up and verify the whole PR

**Files:**
- Delete: `scripts/codemod-run-mode.mjs`
- No changelog edit: this PR is an internal refactor with no user-visible change (CLAUDE.md: skip minor refactors). SP-4e is the one that needs an entry.

- [ ] **Step 1: Delete the codemod**

Run: `git rm scripts/codemod-run-mode.mjs`

- [ ] **Step 2: Full verification**

Run: `npx tsc --noEmit`
Expected: clean.

Run: `npm run lint`
Expected: clean.

Run: `npm test -- --run 2>&1 | tail -20`
Expected: all files pass, 5617+ tests.

- [ ] **Step 3: Confirm the PR-level invariant**

Run: `git diff origin/main..HEAD --stat -- '*.snap'`
Expected: **empty.** This is the PR's headline gate — a discriminator refactor that moved no golden.

- [ ] **Step 4: Confirm the placement-symmetry oracle is at baseline**

Run: `npm run audit:placement-symmetry -- --seeds 15`
Expected: the `2 / 146 / 13-13-13` baseline, unchanged.

- [ ] **Step 5: Verify the deletions actually happened**

Run: `grep -rn "positionalTeamBattle\|healingMode" src --include='*.ts' --include='*.tsx'`
Expected: no output.

Run: `grep -rn "isDpsMeasurementRun" src/utils/combat/engine.ts`
Expected: two sites, both reading `runMode === 'dps'`.

- [ ] **Step 6: Commit and open the PR**

```bash
git add -A
git commit -m "chore(sp4a): drop the one-shot codemod"
git push -u origin sp4-retire-the-dummy
gh pr create --title "refactor(engine): one explicit run mode replaces three implicit discriminators (SP-4a)" --body "$(cat <<'BODY'
First PR of SP-4. Replaces the engine's three implicit run-kind discriminators
with one explicit `mode` input. No behaviour change, no golden movement.

- `dpsEnemyTarget` (roster emptiness) no longer decides run kind
- `healingMode` is renamed `healPipelineActive` and KEPT — it means "the heal
  pipeline is active", which is true in battle mode too, so the healing result
  block must not be gated on `mode === 'healing'`
- `positionalTeamBattle` is deleted; `battleSimulator` passes `mode: 'battle'`
- ~200 test call sites migrated by a one-shot codemod, then the codemod deleted
- two guards replace the inference: contradictory mode/data now throws

Spec: docs/superpowers/specs/2026-08-13-sp4-retire-the-dummy-design.md
Deviation from the spec's ladder: the mode change is split from normalization
and lands first, so this PR can hold an absolute zero-golden-movement gate and
SP-4b's churn is then unambiguous.

Verification: tsc clean, lint clean, full suite green, zero .snap movement,
oracle at the 2 / 146 / 13-13-13 baseline.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01V65xi1NsFW1sP32DYcxqug
BODY
)"
```

---

## Self-review notes

**Spec coverage.** This plan implements spec §4.2 (the explicit mode) and the mode half of §6's PR 4a. Spec §4.1 (normalization), §5 clusters A-H (deletions), and §6's 4b-4d are explicitly out of scope and unchanged by this plan. The spec's §7 acceptance rules 1-6 apply; rules 2 and 3 are inert here (no positional apply changes, no predicted-zero deletions) and become live in SP-4b.

**Two deliberate refinements over the spec:**
1. The ladder is re-split (mode first, normalization second) for churn attribution — flagged at the top.
2. The spec said an omitted mode "fails loudly" via broken assertions. This plan adds explicit guards so it fails *precisely*, naming the offending input. Strictly better: the failure message identifies the fix.

**Fact the spec got slightly wrong, corrected here.** The spec counted `positionalTeamBattle` at 29 files and implied ~23 production sites. Verified: **6 production sites** (1 type decl, 4 engine reads, 1 caller). The 23/29 counts were comments and tests. The migration is still ~200 test files, driven by `healTargetId` rather than by `positionalTeamBattle`.
