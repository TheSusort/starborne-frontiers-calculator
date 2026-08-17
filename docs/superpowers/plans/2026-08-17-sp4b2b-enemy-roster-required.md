# SP-4b-2b — A Non-Empty Enemy Roster Becomes the Engine's Contract

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `CombatEngineInput.enemyAttackers` required and an empty roster a validation error, so no run can be handed to the vestigial dummy — the last precondition before SP-4c deletes it.

**Architecture:** Three separable changes land in strict order so each has one churn story. First a provably inert mechanical pass makes the field required by inserting `enemyAttackers: []` into every base-input literal that lacks it (an empty array is byte-equivalent to an absent field everywhere today — `normalizeCombatRoster` opens with `input.enemyAttackers ?? []`). Then the healing adapter learns to synthesize an inert practice target so a zero-enemy healing run becomes a real, page-reachable scenario. Only then does the boundary start throwing on an empty roster — and the throw is the *classifier*: every fixture that was secretly running without an opponent fails loudly, naming the behavioural population instead of leaving it to be inferred from moved goldens.

**Tech Stack:** TypeScript, Vitest + React Testing Library, TailwindCSS. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-17-sp4b2b-enemy-roster-required-design.md`
**Base:** `39d463f1` · **Branch:** `feat/sp4b2b-enemy-roster-required` · **Ledger:** `.superpowers/sdd/progress.md`

## Global Constraints

- **Never re-pin an assertion to absorb a moved number.** Every moved number is attributed to a named mechanism or treated as a defect. A 4b-1 subagent converted `> 0` to `toBe(0)` on a page-shaped fixture and it passed review; this is the epic's most expensive recurring failure.
- **Never run `vitest -u`.** Goldens are regenerated only after their diff has been attributed, one file at a time.
- **Measure against a worktree at the base commit** (`git worktree add <path> 39d463f1`) before asserting that a move is churn rather than a defect. Every 4b-2a wave that did this separated real defects from assumed churn; the one hypothesis table written without one was mechanically wrong on 3 of 10 files.
- **Display tests assert PRESENCE, not value**, and must drive a real `simulateDPS`/`simulateHealing` run. A hand-built `RoundData` literal stays green through a total display regression.
- **A 0-attack positioned enemy is RNG-stream-inert but NOT event-inert.** It takes a turn, appears in turn-order arrays, and emits a zero-damage `ability-performed`. Fixtures counting *events* must filter on the focus id; fixtures asserting damage or crit sequences are unaffected. A 0-attack enemy emits no `attacked` event at all (a zero-damage hit is skipped, not emitted as a 0).
- **`front` selection scans ROWS from the caster's own row before the front-most column.** Pinning a victim to `M4` is often not enough — the enemy must be pinned to the victim's row too. This explained 6 fixtures on 4b-1.
- **Seeding order matters:** `setupKeyedTestRng(seed)` must come *after* any `resetRateGateRng()`, never before — `resetRateGateRng` sets `rng = Math.random` and `keyedProvider = null`, un-seeding the test. `src/utils/calculators/__tests__/rateGateSeedingOrder.test.ts` is the tripwire.
- **Husky's pre-commit hook runs the FULL suite on every commit** (it skips lint). Expect multi-minute commits. Use `--no-verify` only for doc-only commits.
- Commands: dev server is `npm start` (there is no `npm run dev`); the DPS route is `/damage`, healing is `/healing`.
- UI work uses the components in `src/components/ui/` per `CLAUDE.md`; no raw `<button>` for standard actions, no emojis in UI text.

## File Structure

**Create:**
- `src/utils/calculators/healingDefaultEnemy.ts` — the default enemy stat constants, shared by the healing page and the adapter so one number cannot drift into two. No imports (avoids a cycle with the adapter, which owns `EnemyAttackerInput`).
- `scripts/sp4b2b-require-enemy-roster.mjs` — the one-shot codemod for Task 1.
- `src/pages/calculators/__tests__/HealingCalculatorPage.zeroEnemies.test.tsx` — the page can reach a zero-enemy run.
- `src/utils/calculators/__tests__/healingPracticeTarget.test.ts` — the adapter's synthesis contract.

**Modify:**
- `src/utils/combat/engine.ts` — `enemyAttackers` required (`:1261`); the stale field doc (`:1259`); the sink-credit counter beside `legacyVictimFallbackCount` (`:1717-1722`) and its increment in the player-side `applyToVictim` binding (`:6770`).
- `src/utils/combat/normalizeRoster.ts` — the empty-roster throw; drop the now-dead `?? []` and `enemyAttackers.length ? … : []` branches.
- `src/utils/calculators/healingEngineAdapter.ts` — `effectiveEnemies` synthesis; four readers at `:503`, `:504`, `:505`, `:507`; the `enemies: []` TEST-ONLY prose at `:303-315` and `:350`.
- `src/pages/calculators/HealingCalculatorPage.tsx` — import the shared constants (`:76-78`), un-floor `removeEnemy` (`:386`), rewrite the ⚠️ comment (`:378-384`).
- `src/components/calculator/EnemyAttackersPanel.tsx:247` — `canRemove` unconditional.
- `src/utils/combat/__tests__/dummyReachability.test.ts` — widen to five paths; invert the empty-roster case; add the credit-counter controls.
- `src/constants/changelog.ts` + `src/pages/DocumentationPage.tsx` — the user-facing zero-enemy scenario.
- ~115 fixture files — mechanically in Task 1, behaviourally in Tasks 4-6.

---

### Task 1: Make `enemyAttackers` required — provably inert

The whole point of this task is that it changes **no behaviour at all**. An empty array is byte-equivalent to an absent field on every path today: `normalizeCombatRoster` opens `input.enemyAttackers ?? []`, `dpsEnemyTarget` tests `.length === 0`, and `dpsSimulator` tests `input.enemyAttackers?.length` before synthesizing. So inserting `enemyAttackers: []` where the property is missing satisfies the compiler while leaving every run identical.

**Files:**
- Create: `scripts/sp4b2b-require-enemy-roster.mjs`
- Modify: `src/utils/combat/engine.ts:1261`
- Modify: ~115 fixture files (mechanically, by the script)

**Interfaces:**
- Consumes: nothing.
- Produces: `CombatEngineInput.enemyAttackers` is non-optional. Later tasks rely on `tsc --noEmit` returning 0 with the field required.

- [ ] **Step 1: Write the codemod**

`scripts/sp4b2b-require-enemy-roster.mjs`. It is tsc-error-driven and idempotent: `tsc` is the oracle, not a hand-built list of files.

```js
#!/usr/bin/env node
/**
 * SP-4b-2b Task 1: make `CombatEngineInput.enemyAttackers` required.
 *
 * `tsc` is the oracle. Each pass asks the compiler which object literals are now missing the
 * property and inserts `enemyAttackers: [],` as the literal's FIRST property, so a later
 * `...overrides` spread still wins — the base factories this touches exist to be overridden.
 *
 * ONE insertion per file per pass, then re-run. Two errors can point at the same literal, and a
 * line-independent pass would insert twice: exactly the duplicate-key failure the SP-4a codemod
 * hit (TS1117, 13 files / 19 sites). The fixpoint loop makes that unrepresentable.
 *
 * Acceptance gate is `tsc --noEmit` == 0 in a disposable worktree, NOT this script's own report.
 * `scripts/` is covered by neither tsc (tsconfig includes only `src`) nor `eslint src`, so a
 * dry-run report proves nothing.
 */
import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';

const ENGINE = 'src/utils/combat/engine.ts';
const MAX_PASSES = 12;

function tscErrors() {
    try {
        execSync('npx tsc --noEmit', { encoding: 'utf8', stdio: 'pipe' });
        return [];
    } catch (e) {
        const out = `${e.stdout ?? ''}${e.stderr ?? ''}`;
        return out
            .split('\n')
            .map((l) => l.match(/^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/))
            .filter(Boolean)
            .map((m) => ({ file: m[1], line: +m[2], col: +m[3], code: m[4], msg: m[5] }));
    }
}

/** Insert `enemyAttackers: [],` after the first `{` at or after (line, col). */
function insertAt(file, line, col) {
    const src = readFileSync(file, 'utf8');
    const lines = src.split('\n');
    let li = line - 1;
    let ci = lines[li].indexOf('{', col - 1);
    while (ci === -1) {
        li += 1;
        if (li >= lines.length) throw new Error(`no opening brace after ${file}:${line}`);
        ci = lines[li].indexOf('{');
    }
    const indent = (lines[li].match(/^(\s*)/) ?? ['', ''])[1] + '    ';
    lines[li] =
        lines[li].slice(0, ci + 1) + `\n${indent}enemyAttackers: [],` + lines[li].slice(ci + 1);
    writeFileSync(file, lines.join('\n'));
}

// 1. Flip the field to required.
const engine = readFileSync(ENGINE, 'utf8');
if (engine.includes('    enemyAttackers?: {')) {
    writeFileSync(ENGINE, engine.replace('    enemyAttackers?: {', '    enemyAttackers: {'));
    console.log('flipped enemyAttackers to required');
}

// 2. Fixpoint: one insertion per file per pass.
const inserted = new Map();
for (let pass = 1; pass <= MAX_PASSES; pass += 1) {
    const errs = tscErrors().filter((e) => e.msg.includes('CombatEngineInput'));
    if (errs.length === 0) {
        console.log(`clean after ${pass - 1} pass(es)`);
        break;
    }
    const seen = new Set();
    let n = 0;
    for (const e of errs) {
        if (seen.has(e.file)) continue;
        seen.add(e.file);
        insertAt(e.file, e.line, e.col);
        inserted.set(e.file, (inserted.get(e.file) ?? 0) + 1);
        n += 1;
    }
    console.log(`pass ${pass}: ${errs.length} error(s), ${n} insertion(s)`);
    if (pass === MAX_PASSES) throw new Error('did not converge — inspect remaining errors by hand');
}

console.log(`\n${inserted.size} file(s) touched, ${[...inserted.values()].reduce((a, b) => a + b, 0)} insertion(s)`);
```

- [ ] **Step 2: Run the codemod in a disposable worktree first**

The acceptance gate for a codemod is `--apply` in a throwaway worktree plus `tsc --noEmit` == 0 — never its own report, which prints file names and counts and so makes a duplicate-key file look identical to a correct one.

```bash
git worktree add /tmp/sp4b2b-probe HEAD
cd /tmp/sp4b2b-probe && cp -r node_modules . 2>/dev/null || npm ci
node scripts/sp4b2b-require-enemy-roster.mjs
npx tsc --noEmit; echo "tsc exit: $?"
```

Expected: converges in ≤4 passes, `tsc exit: 0`, ~115 files touched. If it does not converge, read the remaining errors — do not raise `MAX_PASSES`.

- [ ] **Step 3: Verify insertions land as the FIRST property**

```bash
cd /tmp/sp4b2b-probe
git diff -U3 -- src/utils/combat/__tests__/barrier.test.ts
```

Expected: `enemyAttackers: [],` sits immediately after the literal's `{`, *before* any `...overrides`. If it landed after the spread, the override no longer wins and Step 5 will show golden movement — fix the script, do not proceed.

- [ ] **Step 4: Apply on the branch and check tsc + lint**

```bash
cd /Users/kennethsusort/PersonalProjects/starborne-frontiers-calculator
git worktree remove /tmp/sp4b2b-probe --force
node scripts/sp4b2b-require-enemy-roster.mjs
npx tsc --noEmit; echo "tsc: $?"
npx eslint src; echo "eslint: $?"
```

Expected: both 0. `eslint` is the duplicate-key check — `no-dupe-keys` catches an insertion into a literal that already had the property.

- [ ] **Step 5: Run the full suite — this is the inertness gate**

```bash
npm test 2>&1 | tail -30
git status --short -- '*.snap'
```

Expected: **every test passes and `git status` reports no modified `.snap` file.** This task's entire claim is that it changes nothing; a single moved golden or failing test means an insertion landed somewhere it can be seen, and must be diagnosed rather than absorbed.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(engine): enemyAttackers is required on CombatEngineInput

Mechanical. An empty array is byte-equivalent to an absent field on every path
today (normalizeCombatRoster opens `input.enemyAttackers ?? []`), so this is a
type change only: full suite green, zero .snap movement."
```

---

### Task 2: A zero-enemy healing run becomes a real scenario

`simulateHealing` synthesizes an inert practice target when `enemies` is empty, and the healing page stops forbidding an empty roster. Overheal is already a first-class axis in the healing report, so nothing new is needed to display the result.

**Files:**
- Create: `src/utils/calculators/healingDefaultEnemy.ts`
- Create: `src/utils/calculators/__tests__/healingPracticeTarget.test.ts`
- Create: `src/pages/calculators/__tests__/HealingCalculatorPage.zeroEnemies.test.tsx`
- Modify: `src/utils/calculators/healingEngineAdapter.ts:331,350,503,504,505,507`
- Modify: `src/pages/calculators/HealingCalculatorPage.tsx:76-78,378-387`
- Modify: `src/components/calculator/EnemyAttackersPanel.tsx:247`
- Modify: `src/constants/changelog.ts`, `src/pages/DocumentationPage.tsx`

**Interfaces:**
- Consumes: Task 1's required `enemyAttackers`.
- Produces: `PRACTICE_TARGET_ID = 'practice-target'` exported from `healingEngineAdapter.ts`; `DEFAULT_ENEMY_HP`, `DEFAULT_ENEMY_DEFENCE`, `DEFAULT_ENEMY_SECURITY`, `DEFAULT_ENEMY_SPEED` exported from `healingDefaultEnemy.ts`.

- [ ] **Step 1: Write the failing adapter test**

`src/utils/calculators/__tests__/healingPracticeTarget.test.ts`:

```ts
/**
 * A zero-enemy healing run is a legitimate scenario: nothing shoots back, so every heal is
 * overheal and the report shows pure output. The adapter represents "no enemies" as an inert
 * PRACTICE TARGET rather than letting the run fall to the engine's vestigial dummy — whose
 * 10,000 defence rebased every `basis:'damage-dealt'` rider (measured: totalDirectHeal 3,876
 * with one real enemy at defence 1,000 -> 1,290 with none).
 */
import { describe, it, expect } from 'vitest';
import { simulateHealing, PRACTICE_TARGET_ID } from '../healingEngineAdapter';
import { setupKeyedTestRng } from '../rateAccumulator';
import { DEFAULT_ENEMY_DEFENCE, DEFAULT_ENEMY_HP } from '../healingDefaultEnemy';

/** A healer whose active cast repairs its ally AND deals damage, so the run has a damage basis. */
const healerKit = () => ({
    slots: [
        {
            slot: 'active' as const,
            abilities: [
                {
                    id: 'h1',
                    type: 'heal' as const,
                    target: 'ally' as const,
                    trigger: 'on-cast' as const,
                    conditions: [],
                    config: { type: 'heal' as const, multiplier: 100 },
                },
            ],
        },
    ],
});

const input = (enemies: never[] | Parameters<typeof simulateHealing>[0]['enemies']) => ({
    healer: {
        attack: 10_000,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        hp: 50_000,
        defence: 1_000,
        speed: 100,
        hacking: 200,
        security: 100,
        healModifier: 0,
    },
    chargeCount: 0,
    shipSkills: healerKit(),
    selfBuffs: [],
    healTargetId: 'healer',
    enemies,
    rounds: 3,
});

describe('healing with no enemies — the practice target', () => {
    it('runs, and the opponent is the practice target rather than the dummy', () => {
        setupKeyedTestRng(12345);
        const result = simulateHealing(input([]));
        // PRESENCE, not value: a `> 0`-guarded display regression shows up as a vanished row,
        // never as a wrong number.
        expect(result.rounds.length).toBe(3);
        expect(result.rounds.some((r) => r.directHeal > 0)).toBe(true);
    });

    it('the practice target never attacks, so every heal is overheal on a full-HP target', () => {
        setupKeyedTestRng(12345);
        const result = simulateHealing(input([]));
        expect(result.totalEffectiveHealing).toBe(0);
        expect(result.totalOverheal).toBeGreaterThan(0);
    });

    it('carries the default enemy card stats, so removing every enemy changes only incoming damage', () => {
        setupKeyedTestRng(12345);
        const zero = simulateHealing(input([]));
        setupKeyedTestRng(12345);
        const one = simulateHealing(
            input([
                {
                    id: 'e1',
                    stats: {
                        attack: 0,
                        crit: 0,
                        critDamage: 0,
                        speed: 50,
                        defence: DEFAULT_ENEMY_DEFENCE,
                        hp: DEFAULT_ENEMY_HP,
                    },
                    chargeCount: 0,
                    startCharged: false,
                },
            ])
        );
        // A 0-attack enemy and the practice target differ only by id, so the healer's own output
        // must be identical. This is what pins the stat basis: with defence 0 the practice target
        // would silently maximize any damage-scaled repair.
        expect(zero.totalDirectHeal).toBe(one.totalDirectHeal);
    });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/utils/calculators/__tests__/healingPracticeTarget.test.ts`
Expected: FAIL — `PRACTICE_TARGET_ID` and `../healingDefaultEnemy` do not exist yet.

- [ ] **Step 3: Create the shared constants module**

`src/utils/calculators/healingDefaultEnemy.ts`. It deliberately imports nothing: `EnemyAttackerInput` lives in `healingEngineAdapter.ts`, which imports *this* module, and a value-level cycle between them would be a real one.

```ts
/**
 * The stat block a default enemy starts from. Shared by the healing page (the card a user adds)
 * and the adapter (the PRACTICE TARGET it synthesizes when the roster is empty), so the two
 * cannot drift into two different numbers.
 *
 * These are the basis for any `basis:'damage-dealt'` heal or shield rider, which is why the
 * practice target reuses them rather than zeroing defence: emptying the roster then means exactly
 * one thing — nothing shoots back — instead of also silently maximizing damage-scaled repair.
 */
export const DEFAULT_ENEMY_HP = 40_000;
export const DEFAULT_ENEMY_DEFENCE = 5_000;
export const DEFAULT_ENEMY_SECURITY = 100;
export const DEFAULT_ENEMY_SPEED = 50;
```

- [ ] **Step 4: Synthesize the practice target in the adapter**

In `src/utils/calculators/healingEngineAdapter.ts`, add the import and the factory above `simulateHealing`:

```ts
import {
    DEFAULT_ENEMY_DEFENCE,
    DEFAULT_ENEMY_HP,
    DEFAULT_ENEMY_SECURITY,
    DEFAULT_ENEMY_SPEED,
} from './healingDefaultEnemy';

/** The id the synthesized opponent carries. Exported so tests can assert on it by name. */
export const PRACTICE_TARGET_ID = 'practice-target';

/**
 * "No enemies" is a legitimate healing scenario — the user wants to read pure output, where every
 * heal is overheal. The engine requires a non-empty roster (SP-4b-2b), so the adapter represents
 * that scenario as ONE inert opponent: a default enemy card with `attack: 0` and no kit. The
 * difference between it and a real card is precisely that it does not act.
 *
 * It is killable, exactly as a real default card is. A healer whose cast carries a damage clause
 * can destroy it and spend the rest of the window with no targetable opponent — the same shape as
 * killing your only real enemy today, and SP-4c removes the sink underneath both. HP stays at the
 * card default rather than being inflated to make it immortal: corrosion scales with the victim's
 * max HP (`min(enemyHp, 500_000)`), so a huge-HP target would inflate corrosion damage and every
 * rider scaled off it — the distortion this stat basis exists to avoid.
 */
const practiceTarget = (): EnemyAttackerInput => ({
    id: PRACTICE_TARGET_ID,
    stats: {
        attack: 0,
        crit: 0,
        critDamage: 0,
        speed: DEFAULT_ENEMY_SPEED,
        defence: DEFAULT_ENEMY_DEFENCE,
        hp: DEFAULT_ENEMY_HP,
        security: DEFAULT_ENEMY_SECURITY,
    },
    chargeCount: 0,
    startCharged: false,
});
```

- [ ] **Step 5: Thread it through ALL FOUR readers**

This is where three earlier plans in this epic shipped incomplete sample code — patching one reader and leaving the others on the raw input. In `simulateHealing`, immediately after the destructure at `:331`:

```ts
    // An empty roster means "nothing shoots back", not "hand the run to the dummy". Every reader
    // below MUST use this, not `enemies` — there are four (the three slot-resolution arguments
    // and the map).
    const effectiveEnemies = enemies.length ? enemies : [practiceTarget()];
```

Then replace all four readers (`:503`, `:504`, `:505`, `:507`):

```ts
    const enemySlots = resolveEnemySlots(
        effectiveEnemies.map((e, i) => e.position ?? defaultEnemySlot(i)),
        effectiveEnemies.flatMap((e, i) => (i !== 0 && e.position !== undefined ? [i] : [])),
        effectiveEnemies[0]?.position !== undefined
    );
    const engineEnemyAttackers = effectiveEnemies.map((e, i) => {
```

- [ ] **Step 6: Verify — and prove no reader was missed**

```bash
npx vitest run src/utils/calculators/__tests__/healingPracticeTarget.test.ts
node -e "const s=require('fs').readFileSync('src/utils/calculators/healingEngineAdapter.ts','utf8').split('\n');s.forEach((l,i)=>{if(i+1>325&&/\benemies\b/.test(l)&&!/effectiveEnemies/.test(l))console.log((i+1)+': '+l.trim())})"
```

Expected: all three tests PASS, and the grep prints only the destructure line (`:331`) and comment lines — no surviving code reader.

- [ ] **Step 7: Un-floor the page**

`src/pages/calculators/HealingCalculatorPage.tsx` — replace the local constants at `:76-78` with the shared import:

```ts
import {
    DEFAULT_ENEMY_DEFENCE,
    DEFAULT_ENEMY_HP,
    DEFAULT_ENEMY_SECURITY,
} from '../../utils/calculators/healingDefaultEnemy';
```

Delete the three `const DEFAULT_ENEMY_* = …` lines. `defaultEnemyStats` keeps its own `speed: 50` / `hacking: 200` literals — only the three shared numbers move.

Then replace `:378-387`. The old ⚠️ comment documents the dummy handover, which this PR removes; its measured history stays as the rationale for the practice target's stats (keep historical rationale, rewrite claims about current behaviour):

```tsx
    // An empty roster is allowed: it means "nothing shoots back", and the adapter synthesizes an
    // inert PRACTICE TARGET for it (`healingEngineAdapter.practiceTarget`) so the run reads as
    // pure healing output with everything overhealed.
    //
    // History, and why the practice target carries a real defence rather than 0: before SP-4b-2b
    // an empty roster fell to the engine's vestigial dummy — a fixed 10,000-defence sink — so
    // every `basis:'damage-dealt'` rider silently rebased off that 10,000 and `perTargetDealt`
    // disappeared. Measured at the time: totalDirectHeal 3,876 with one real enemy at defence
    // 1,000 -> 1,290 with none, a 3x move from a single click on a fresh page.
    const removeEnemy = (id: string) => {
        setEnemies((prev) => prev.filter((e) => e.id !== id));
    };
```

And in `src/components/calculator/EnemyAttackersPanel.tsx:247`, replace `canRemove={enemies.length > 1}` with `canRemove`. Read the comment at `:245-246` first — it explains the old floor and must be rewritten, not left contradicting the code.

- [ ] **Step 8: Write the page test**

`src/pages/calculators/__tests__/HealingCalculatorPage.zeroEnemies.test.tsx`. Follow the setup in the existing `HealingCalculatorPage.test.tsx` (same providers and mocks); this file adds only the zero-enemy path.

```tsx
/**
 * The page must be able to REACH the zero-enemy scenario. Before SP-4b-2b the roster was floored
 * at one because an empty one handed the run to the dummy; the practice target removed that
 * reason, and this test is what keeps the floor from creeping back.
 */
it('lets the last enemy be removed and still renders a result', async () => {
    renderHealingPage();
    const remove = await screen.findAllByRole('button', { name: /remove enemy/i });
    expect(remove).toHaveLength(1);
    await userEvent.click(remove[0]);
    expect(screen.queryByText(/Enemy 1/)).not.toBeInTheDocument();
    // PRESENCE: the results panel must still be there. A `> 0`-guarded display failure shows up
    // as a vanished section, not a wrong number.
    expect(await screen.findByText(/Overheal/i)).toBeInTheDocument();
});
```

Match the accessible name to whatever `EnemyAttackersPanel` actually renders — read the component and use its real label rather than assuming `/remove enemy/i`.

- [ ] **Step 9: Audit the three `enemies: []` fixtures, then regenerate**

`dpsSubAttackEvents.integration.test.ts`, `healingEngineAdapter.test.ts`, and `healingGoldenParity.test.ts` pass `enemies: []` and so change basis: defence 10,000 → 5,000, HP 1,000,000 → 40,000, and the target is now killable within the window.

```bash
npx vitest run src/utils/calculators/__tests__/healingGoldenParity.test.ts \
  src/utils/calculators/__tests__/healingEngineAdapter.test.ts \
  src/utils/combat/__tests__/dpsSubAttackEvents.integration.test.ts 2>&1 | tail -40
```

For each failure, write the mechanism down in `.superpowers/sdd/progress.md` **before** changing anything: which of the three basis changes explains it, and by how much. Only then regenerate the golden (`npx vitest run <file> -u` on that single file — never a suite-wide `-u`). A move you cannot attribute is a defect: stop and report it.

- [ ] **Step 10: Changelog and docs**

Add to `UNRELEASED_CHANGES` in `src/constants/changelog.ts` (plain English, no emojis, matching the surrounding voice):

```ts
    'Healing calculator: you can now remove every enemy. With an empty enemy team nothing shoots back, so the run shows your healer’s pure output — every point of it counted as overheal against a full-health target. Your healer’s own numbers are unchanged: the calculator stands in a practice target carrying the same stats a default enemy card has, minus its attack, so emptying the team changes only the damage coming at you.',
```

Add the same scenario to the healing section of `src/pages/DocumentationPage.tsx`.

- [ ] **Step 11: Full suite and commit**

```bash
npm test 2>&1 | tail -20
npx tsc --noEmit && npx eslint src
git add -A && git commit -m "feat(healing): a zero-enemy run measures pure healing output"
```

---

### Task 2b: A `damage-dealt` standing leech pays out on a positional DoT tick

**Added mid-flight (owner ruling, 2026-08-17).** Task 2's audit exposed two pre-existing engine defects, both masked by the dummy path and confirmed in source by the task reviewer: a `basis:'damage-dealt'` standing leech pays **zero** against a real positioned enemy unless its scope is `direct`.

- **`leechScope: 'all'` misses DoT ticks.** The positional per-victim DoT-tick branch's `credit` callback (`engine.ts:8755-8775`) accumulates into `total` / `tickDealtBySource` / `perActorDot` but never calls `creditDamage` — and `creditDamage` is the only thing that procs `procStandingLeeches` (`engine.ts:4122-4124`). **Production-reachable:** Magnolia's self leech is a passive standing `'all'` leech, and `buildEquipmentAbilities.ts:52` injects the same shape from gear. **This half is in scope.**
- **`leechScope: 'detonation'` pays nothing.** `procStandingLeechesPerVictim` explicitly `continue`s on `scope === 'detonation'` (`engine.ts:3849-3851`) and the positional burst is deliberately never routed through `creditDamage(actor.id, 'detonation')` (`engine.ts:6913`, `:9546`). **Corpus-unreachable:** its only producer is the "Echoing Burst explodes" parse (Valkyrie), whose leech is `on-bomb-detonated` and so is reactive-partitioned out of `standingLeeches` before it reaches the gap (`engine.ts:3860-3866`). **Out of scope — tripwire only.**

**Files:**
- Modify: `src/utils/combat/engine.ts` (the per-victim DoT-tick credit path)
- Create: `src/utils/combat/__tests__/positionalDotLeech.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks. Produces: no new exports.

- [ ] **Step 1: Write the failing test**

A focus attacker with a corrosion/DoT applier and a standing `basis:'damage-dealt'`, `leechScope:'all'` self-leech, against one real positioned enemy. Assert the leech pays out on the round the DoT ticks — read the heal from the run's heal buckets, and assert the tick itself landed (`perTargetDealt`) so the test cannot pass by the DoT silently not ticking.

Include a `leechScope: 'direct'` control in the same file: it already pays out, so if the control ever goes red the fix has broken the working path.

- [ ] **Step 2: Run it to confirm it fails**

Expected: the `'all'` case FAILS with a zero leech payout while the `direct` control PASSES. **If the `'all'` case passes, stop** — the defect is not where this task says it is, and the fix would be unfenced.

- [ ] **Step 3: Make the positional tick proc standing leeches**

Route the per-victim DoT-tick credit through the same standing-leech proc the direct path uses. Two rules:
- **Do not double-credit.** The tick already accumulates into `perActorDot` / `tickDealtBySource`; the proc must fire without re-crediting the damage itself.
- **Team symmetry is mandatory in this engine.** Whatever fires for the player side must fire for the enemy side. Check both sides' paths and assert the enemy-side mirror in the test — a one-directional fix is the defect class this epic has repaired repeatedly (see `feedback_engine_team_symmetry`).

- [ ] **Step 4: Tripwire the detonation half**

Add an explicitly-named known-gap test recording that a `leechScope: 'detonation'` standing leech pays zero positionally, with the corpus-unreachability reasoning in the test's comment. The point is that the gap announces itself if the fix ever lands, rather than being discovered a third time.

- [ ] **Step 5: Audit the blast radius**

This changes engine behaviour, so goldens may move. Every moved number must be attributed to "a standing `'all'`-scope leech now pays out on DoT ticks" — anything else is a second defect. Measure against `/tmp/sp4b2b-base` (a worktree at `39d463f1`) before calling a move churn.

Task 2 left two comments recording these gaps as unfixed (`healingGoldenParity.test.ts` around `:527-535` and an inline block in `healingEngineAdapter.ts`). Update the `'all'` half of both to say it is fixed and where; leave the `detonation` half.

- [ ] **Step 6: Verify and commit**

```bash
npx vitest run src/utils/combat/__tests__/positionalDotLeech.test.ts
npm test 2>&1 | tail -20
npx tsc --noEmit && npx eslint src
git add -A && git commit -m "fix(engine): a damage-dealt standing leech pays out on positional DoT ticks"
```

---

### Task 3: The boundary throws on an empty roster — and names the behavioural population

**The suite ends this task RED, by design.** The throw is the classifier: every fixture that was secretly running without an opponent now fails loudly and by name, which is strictly better than inferring the population from moved goldens.

**Files:**
- Modify: `src/utils/combat/normalizeRoster.ts`
- Modify: `src/utils/combat/engine.ts:1259` (the stale field doc)
- Create: the inventory in `.superpowers/sdd/progress.md`

**Interfaces:**
- Consumes: Task 1's required field.
- Produces: `normalizeCombatRoster` throws `Error('normalizeCombatRoster: enemyAttackers is empty — every run needs at least one opponent (SP-4b-2b). A caller with no enemy to model should synthesize an inert one, as healingEngineAdapter.practiceTarget does.')`. Later tasks rely on that message being greppable.

- [ ] **Step 1: Write the failing boundary test**

Append to `src/utils/combat/__tests__/normalizationBoundary.integration.test.ts`:

```ts
describe('the roster contract', () => {
    it('throws on an empty enemy roster rather than handing the run to the dummy', () => {
        expect(() => runCombat({ ...bareInput(), enemyAttackers: [] })).toThrow(
            /enemyAttackers is empty/
        );
    });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/utils/combat/__tests__/normalizationBoundary.integration.test.ts`
Expected: FAIL — the run completes instead of throwing.

- [ ] **Step 3: Add the guard, and delete the two branches it makes dead**

In `src/utils/combat/normalizeRoster.ts`, at the top of `normalizeCombatRoster`:

```ts
export function normalizeCombatRoster(input: CombatEngineInput): CombatEngineInput {
    // The contract (SP-4b-2b): every run has at least one opponent. This is a validation guard
    // rather than an accommodation on purpose — the boundary is the ONE place that accommodates an
    // under-specified input, and synthesizing a sink here is what kept the dummy alive.
    if (input.enemyAttackers.length === 0) {
        throw new Error(
            'normalizeCombatRoster: enemyAttackers is empty — every run needs at least one ' +
                'opponent (SP-4b-2b). A caller with no enemy to model should synthesize an inert ' +
                'one, as healingEngineAdapter.practiceTarget does.'
        );
    }
    const teamActors = input.teamActors ?? [];
    const enemyAttackers = input.enemyAttackers;
```

Then simplify the placement branch, now provably non-empty:

```ts
    const enemySlots = placeSide(
        enemyAttackers.map((e) => e.position),
        DEFAULT_ENEMY_SLOT,
        (i) => defaultEnemySlot(i + 1),
        resolveEnemySlots
    );
```

- [ ] **Step 4: Rewrite the stale field doc**

`src/utils/combat/engine.ts:1259` currently opens "Enemy attackers (healing mode)" and claims "The singular dummy `enemy` remains the player-offense target + DoT carrier" — false since 4b-1, and the sort of stale comment that produced a confident, well-argued, wrong CodeRabbit finding on #324. Replace the lead-in:

```ts
    /** The opposing roster — REQUIRED on every run since SP-4b-2b, and never empty (the boundary
     *  throws). Real ships carrying stats + `shipSkills`, positioned by `normalizeCombatRoster`
     *  when they arrive without a slot. A caller with no enemy to model synthesizes an inert one
     *  rather than passing `[]`; see `healingEngineAdapter.practiceTarget`. */
```

- [ ] **Step 5: Produce the inventory**

```bash
npx vitest run 2>&1 | tee /tmp/sp4b2b-throw-inventory.txt | tail -40
grep -c "enemyAttackers is empty" /tmp/sp4b2b-throw-inventory.txt
grep -oE "src/[^ :]+\.test\.tsx?" /tmp/sp4b2b-throw-inventory.txt | sort -u
```

Write the resulting file list into `.superpowers/sdd/progress.md` under "Task 3 inventory", with a per-file count of failing tests. Expected around 20 files (the measured population at `39d463f1`), all failing with the contract message. **A file failing for any other reason is a finding, not churn — record it separately and report it.**

- [ ] **Step 6: Commit the red state deliberately**

```bash
git add -A
git commit --no-verify -m "feat(engine): an empty enemy roster is a validation error

RED BY DESIGN: the throw is the classifier for the fixture population that was
running with no opponent. Inventory in .superpowers/sdd/progress.md; Tasks 4-6
repair it. --no-verify because husky runs the suite, which is red on purpose."
```

---

### The repair waves (Tasks 4-6c) — restructured 2026-08-17 after Task 3's inventory

**The inventory is 64 files / 253 tests, not the ~20 files this plan first predicted**, and the gap is
the classifier working as designed. The "20 files" figure counted files that never mention
`enemyAttackers` anywhere. Task 1 mechanically inserted `enemyAttackers: []` into 148 call sites
across 118 files, so the guard now catches every *call site* that used a base literal without
overriding it — a superset of the file-level measure. Full inventory with per-file test counts:
`.superpowers/sdd/progress.md` under "## Task 3 inventory".

**Waves are balanced by TEST count, not file count.** The distribution is severely skewed: four files
carry 116 of the 253 failures (46%), and a file whose base factory is fixed once may repair 39 tests
in one edit. Each wave below lists its exact files, so no file can be silently dropped or repaired twice.

**Every wave follows the same recipe (Task 4 states it in full — read Task 4's brief alongside your
own, whichever wave you are on).**

---

### Task 4: Repair wave A — the two highest-count files

**Files (2 files / 75 tests):**
- `src/utils/combat/__tests__/healing.test.ts` (39 tests)
- `src/utils/combat/__tests__/engine.events.test.ts` (36 tests)

These two carry 30% of the whole inventory and are almost certainly one base-factory fix each, so
they come first: they are the cheapest test of whether the recipe below actually works before it is
applied 60 more times.

**Interfaces:**
- Consumes: Task 3's inventory and the greppable contract message `enemyAttackers is empty`.
- Produces: nothing new. Later waves reuse this recipe.

- [ ] **Step 1: Stand up a base-commit worktree**

```bash
git worktree add /tmp/sp4b2b-base 39d463f1
```

Use `cp -a`, never `cp -r`, if you copy `node_modules` into it — plain `cp -r` dereferences the
`.bin/tsc` symlink, after which `tsc` runs, reports zero errors, and validates nothing. That
false-good already nearly slipped through this branch.

Every wave in the prior sub-project that measured against a base worktree separated real defects from
assumed churn; the one hypothesis table written without one was mechanically wrong on 3 of 10 files.
Use it for any number you are about to call churn.

- [ ] **Step 2: Give each failing run a real enemy**

Replace the `enemyAttackers: []` that Task 1 inserted with a real opponent. Prefer the shared fixture
so 64 files do not invent 64 different enemies:

```ts
import { bareEnemy } from '../__testutils__/bareRosterFixture';
// …
enemyAttackers: bareEnemy(),
```

`bareEnemy()` is one 0-attack, skill-less, 500,000-HP enemy with no explicit position — the
normalization boundary places it. Where a fixture needs the enemy in a particular cell, give it an
explicit `position` rather than fighting the default.

**Fix the base factory, not each call site**, where the file has one — that is why these files repair
39 and 36 tests at once.

- [ ] **Step 3: Classify every remaining failure against a NAMED mechanism**

After the roster is real, some assertions will still move. Each one is attributed to one of these or
to a new named mechanism you write down — never absorbed:

- **M1** the dummy's turn is gone (`dummyEnemyIsVestigial` is true), so a fixture filtering on the
  actor id `enemy` must filter on `attacker`.
- **M2** the enemy ACTS: one zero-damage `ability-performed` per round, so event COUNTS moved. Filter
  on the focus id — do not re-pin the count. (`engine.events.test.ts` is the likeliest home for this.)
- **M3** per-victim credit replaces scalar credit: read `perTargetDealt`, not `cumulativeDamage`. Use
  the shared helper `src/utils/combat/__testutils__/perTargetDealt.ts` (`dealtEntries` / `dealtBy` /
  `dealtBySource`) rather than re-writing the nested reduce.
- **M4** `front` selection scans ROWS from the caster's own row before the front-most column, so the
  enemy often needs the victim's ROW, not just column 4 (which is the FRONT).

A 0-attack enemy emits NO `attacked` event at all (a zero-damage hit is skipped, not emitted as a 0),
but it DOES take a turn and emit a zero-damage `ability-performed`. **`deaths` is not a routing
discriminator; `perTargetDealt` is** — a subagent earlier in this epic concluded "damage lands
nowhere" from `deaths: []` when the damage had landed on a different but real actor.

- [ ] **Step 4: Repair the fixture, never the assertion**

Deleting, skipping, or widening an assertion to absorb a move is out of bounds, and so is re-pinning
a `> 0` to `toBe(0)` — that exact substitution happened on an earlier PR in this epic, on a fixture
shaped like the production page, and it passed review. If a fixture's premise has genuinely
evaporated (for instance `mostBuffsAmong` returns undefined against an unbuffed enemy, so a
most-buffs selector proc DROPS entirely rather than shifting), fix the fixture's SETUP — buff the
enemy — or escalate. Do not pin the drop.

- [ ] **Step 5: Verify**

```bash
npx vitest run src/utils/combat/__tests__/healing.test.ts src/utils/combat/__tests__/engine.events.test.ts
```

Expected: all 75 green, every changed line explained in your report.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "test(engine): wave A — real enemy roster for the two highest-count fixtures"
```

---

### Task 5: Repair wave B — the next two highest-count files

**Files (2 files / 41 tests):**
- `src/utils/combat/__tests__/triggers.test.ts` (23 tests)
- `src/utils/combat/__tests__/equipmentAbilities.integration.test.ts` (18 tests)

- [ ] **Step 1: Apply Task 4's recipe to these two files**

Read Task 4's brief in full for the recipe — the four named mechanisms, the `bareEnemy()` fixture, the
`perTargetDealt` helper path, and the base worktree at `/tmp/sp4b2b-base`. Do not work from a summary
of it.

`equipmentAbilities.integration.test.ts` is the one file where a gear-injected standing leech may
appear (`buildEquipmentAbilities.ts` injects `leechScope:'all'` shapes). A leech that now pays out on
a DoT tick is expected — Task 2b fixed that deliberately. A leech paying zero on a **detonation
burst** is a known, documented gap, not something to fix here.

- [ ] **Step 2: Verify and commit**

```bash
npx vitest run src/utils/combat/__tests__/triggers.test.ts src/utils/combat/__tests__/equipmentAbilities.integration.test.ts
git add -A && git commit -m "test(engine): wave B — real enemy roster for triggers and equipment abilities"
```

---

### Task 6: Repair wave C — 27 mechanical files, alphabetical first half

**Files (27 files / 61 tests)** — all under `src/utils/combat/__tests__/` unless noted:

`accumulatorGather.integration` (1), `actorStats` (3), `adjacentEnemiesDebuff.integration` (2),
`adjacentEnemiesDot.integration` (1), `allyDebuffReactivePromotion.integration` (1),
`apexSelfShieldGate.integration` (2), `applyOutgoingToEnemy` (3), `blockBuff` (1),
`bombDetonatedVictimId` (1), `bombModifierExclusion` (1), `bombSplashOnDeath.integration` (1),
`buffDurationOwnTurnReprieve` (3), `buffOnlyTeamWalk.integration` (1), `chargedOverdrive.integration` (5),
`corrosionToAcidicDecay` (2), `damageChannelAccounting.integration` (2), `deathFallback.integration` (1),
`decrementUnification` (3), `demolisherBombSplash.integration` (1), `destroyedRoundUnification` (1),
`enemiesHitGate.integration` (1), `enemyBuffSelfDebuffGate` (4), `enemyDotCountGate.integration` (3),
`forcedAffinityReciprocalGate.integration` (2), `gearSetDotPair.integration` (4),
`healingPerRecipientApply` (6), `healingPerRecipientAxis` (5)

- [ ] **Step 1: Apply Task 4's recipe to all 27 files**

Read Task 4's brief in full for the recipe. Work through the list in order and report per file.

Two notes specific to this wave. The bomb/detonation files (`bombDetonatedVictimId`,
`bombModifierExclusion`, `bombSplashOnDeath`, `demolisherBombSplash`) exercise the positional burst
path, where a standing leech provably pays nothing — that is a documented gap with an owner ruling to
fix it in a separate PR, so do not chase a zero leech payout there. And `deathFallback.integration`
turns on a victim dying: with a real 500,000-HP enemy the death may no longer happen, so give that
fixture an enemy it can actually kill rather than re-pinning what it observes.

- [ ] **Step 2: Verify and commit**

```bash
npx vitest run src/utils/combat/__tests__/accumulatorGather.integration.test.ts # …and the other 26
git add -A && git commit -m "test(engine): wave C — real enemy roster for 27 fixtures"
```

---

### Task 6b: Repair wave D — 27 mechanical files, alphabetical second half

**Files (27 files / 64 tests)** — all under `src/utils/combat/__tests__/` unless noted:

`hpCrossing` (1), `indestructibleDeath` (6), `leech` (8), `lowestSpeedAlly` (3),
`multiEnemyDotStateReporting.integration` (1), `outDetonationDamageUpBuff.integration` (3),
`outgoingAmplificationEngine` (1), `overloadLifecycle` (4), `ownCleanseReactivePromotion.integration` (2),
`perActorIncomingSurface` (1), `perActorShield` (1), `perVictimDotTick.integration` (1),
`perVictimPlayerTimedDetonation.integration` (2), `perVictimTimedDetonation.integration` (1),
`preFightModifiersEngine` (4), `procChanceGate` (4), `purgeConditionalSources` (2),
`reactiveShieldRouting` (1), `shieldAppliedEvent` (3), `shieldGrantBattleSim` (1),
`shieldPenetration` (4), `statVsTargetGate.integration` (3), `teamAuraDistribution.integration` (3),
`victimEnemyModifiers` (1), `wave7WardenDebuffInflicted.integration` (1),
`wildfireTeamAuraCritPower.integration` (1), and
`src/utils/calculators/__tests__/rhodiumChakaraDpsModeCredit.integration.test.ts` (1)

- [ ] **Step 1: Apply Task 4's recipe to all 27 files**

Read Task 4's brief in full for the recipe.

Three notes specific to this wave:
- **`rhodiumChakaraDpsModeCredit.integration`** has a recorded trap: its proc uses a most-buffs
  selector, and `mostBuffsAmong` returns undefined against an unbuffed enemy, so the proc DROPS
  entirely rather than shifting. The dummy-fallback era made that selector trivially satisfiable, so
  the fixture was never really testing the selector. **Buff the fixture's enemy** — never re-pin to 0.
- **`leech` (8 tests)** interacts with Task 2b's fix: a standing `leechScope:'all'` leech now pays out
  on a positional DoT tick where it previously paid nothing. That is the intended new behaviour.
- **`perVictimDotTick` / `perVictimTimedDetonation` / `perVictimPlayerTimedDetonation` /
  `outDetonationDamageUpBuff`** sit on the per-victim channels Task 2b touched. A DoT-tick leech
  payout is expected; a detonation-burst leech zero is the documented gap.

- [ ] **Step 2: Verify and commit**

```bash
npx vitest run src/utils/combat/__tests__/hpCrossing.test.ts # …and the other 26
git add -A && git commit -m "test(engine): wave D — real enemy roster for 27 fixtures"
```

---

### Task 6c: Repair wave E — the fixtures whose SUBJECT is the empty roster

These six are not mechanical. Each one exists to exercise the very fallback this PR forbids, so
handing it a real enemy would delete the thing it tests. Read each fixture's own comment before
deciding, and state the decision per file in your report.

**Files (6 files / 12 tests):**
- `src/utils/combat/__tests__/normalizeRoster.test.ts` (1) — the test is literally named "leaves an
  empty enemy roster empty — it never invents an enemy". Its premise is the OLD contract, which this
  PR reverses. It becomes a throw-assertion.
- `src/utils/combat/__tests__/perVictimWalkedTeamDetonation.integration.test.ts` (1) — a REGRESSION
  test that sets `enemyAttackers: undefined` with the comment "the lone enemy is the dummy sink", i.e.
  it deliberately invokes the dummy fallback. Decide whether the regression it guards can be observed
  on a real roster; if it can, migrate it there and keep the guard. If it genuinely cannot, say so
  explicitly rather than converting it to a throw-assertion and losing the coverage.
- `src/utils/combat/__tests__/shieldBasisSecondaryDamage.integration.test.ts` (2) — casts
  `as CombatEngineInput` over a `CLEAN_MATH` spread that never sets the field. The cast is what let a
  required field go missing; give it a real enemy AND drop the cast so the compiler can see it.
- `src/utils/combat/__tests__/dummyEnemyTurnGate.test.ts` (1) — its subject is the dummy's turn gate.
  Judge whether the gate is still observable at all now that no run reaches the dummy.
- `src/utils/combat/__tests__/runModeEquivalence.test.ts` (6) — equivalence across run modes, using
  the empty roster as a convenient default. Give it a real enemy; the equivalence claim should survive.
- `src/utils/combat/__tests__/dummyReachability.test.ts` (1) — its "STILL takes it with an empty
  roster" case. Invert it to a throw-assertion here so the suite is green; **Task 7 then widens this
  file's coverage and adds the sink-credit counter.** Do not do Task 7's work.

- [ ] **Step 1: Decide and repair each of the six**

For any file where the honest answer is "this coverage is gone and cannot be recovered", say so and
name what is no longer covered — do not paper over it with a throw-assertion that tests the guard
instead of the mechanic. That trade is the controller's to make, not yours.

- [ ] **Step 2: Full suite green — the first time since Task 3**

```bash
npm test 2>&1 | tail -20
npx tsc --noEmit && npx eslint src
```

Expected: all green, tsc 0, eslint 0. Report the file/test totals; the pre-branch baseline was 528
files / 5837 tests.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "test(engine): wave E — the empty-roster fixtures meet the new contract"
```

---

### Task 7: `dummyReachability` — close both recorded gaps

The file's own header says a zero there is **not** SP-4c's go-ahead, for two independent reasons. Both close here, because 4c is about to lean on this file.

**Files:**
- Modify: `src/utils/combat/__tests__/dummyReachability.test.ts`
- Modify: `src/utils/combat/engine.ts:1717-1722` (counter machinery), `:6770` (player-side `applyToVictim`)
- Modify: `src/utils/combat/__testutils__/bareRosterFixture.ts` (fixtures for the new paths)

**Interfaces:**
- Consumes: the contract from Task 3.
- Produces: `__getDummySinkCreditCount()` and `__resetDummySinkCreditCount()` exported from `engine.ts`.

- [ ] **Step 1: Write the failing counter test**

The existing counter records **consultations** of `tb.legacyVictim` (`engine.ts:7027`), not credits to the sink, and the two legitimately come apart: in the mid-run whiff window the fallback is consulted and nothing is booked. So 4c cannot demand that number be zero. Add a second counter that records damage actually **booked against the dummy**, and pin the two apart:

```ts
describe('sink credits are distinct from fallback consultations', () => {
    beforeEach(() => {
        setupKeyedTestRng(12345);
        __resetLegacyVictimFallbackCount();
        __resetDummySinkCreditCount();
    });

    // POSITIVE CONTROL — without it a zero below could mean the counter was never wired.
    // A roster whose only member has max HP 0 holds no targetable victim, so resolution falls
    // through to the dummy AND books against it.
    it('counts a credit when the only enemy is untargetable', () => {
        runCombat({
            ...bareInput(),
            enemyAttackers: [{ ...bareEnemy()[0], stats: { ...bareEnemy()[0].stats, hp: 0 } }],
        });
        expect(__getDummySinkCreditCount()).toBeGreaterThan(0);
    });

    // The distinction that makes the new counter worth having.
    it('a live roster consults nothing and credits nothing', () => {
        runCombat(bareInput());
        expect(__getLegacyVictimFallbackCount()).toBe(0);
        expect(__getDummySinkCreditCount()).toBe(0);
    });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/utils/combat/__tests__/dummyReachability.test.ts`
Expected: FAIL — `__getDummySinkCreditCount` is not exported.

- [ ] **Step 3: Add the counter**

Beside the existing machinery at `engine.ts:1717-1722`:

```ts
/**
 * Damage actually BOOKED against the vestigial dummy — distinct from
 * `legacyVictimFallbackCount`, which counts CONSULTATIONS of `tb.legacyVictim`. The two come
 * apart in the mid-run whiff window, where the fallback is consulted and nothing is booked, so
 * this is the number SP-4c can require to be zero.
 */
let dummySinkCreditCount = 0;
export function __getDummySinkCreditCount(): number {
    return dummySinkCreditCount;
}
export function __resetDummySinkCreditCount(): void {
    dummySinkCreditCount = 0;
}
```

Increment it where damage is applied to a victim that IS the dummy — the player-side `applyToVictim` binding around `engine.ts:6770`, whose `legacyVictim` is the dummy `enemy` (`:6761`). Note the enemy-side binding's `legacyVictim` is the *heal target* (`:6775`), a real player actor: that is not a dummy credit and must not be counted. Confirm the site by making the positive control pass and the negative control still hold — if only one of the two can be satisfied, you are on the wrong site.

- [ ] **Step 4: Widen the coverage to the five uncovered paths**

The file exercises `bareInput()` — one focus-attacker damage path. Add a case per uncovered path named in its header: **team-actor turns**, **enemy turns**, **corpse targeting**, **death retargeting**, and **walked-team damage**. Put any new fixture shapes in `src/utils/combat/__testutils__/bareRosterFixture.ts`, never in the `.test.ts` file — importing from a `.test.ts` module executes its `describe` blocks as a side effect, running the suites twice under two seeds.

**Each case must be shown to reach the code it claims to cover.** A zero from a case that never exercised its path is the "no goldens moved can mean nothing covers this" trap in counter form. Prove it per case: assert something positive about the path itself (a team actor dealt damage, an enemy took a turn, a corpse was targeted) alongside the zero.

- [ ] **Step 5: Invert the empty-roster case and update the header**

The "STILL takes it with an empty roster" test becomes:

```ts
    it('cannot be reached through an empty roster any more — the boundary throws', () => {
        expect(() => runCombat({ ...bareInput(), enemyAttackers: [] })).toThrow(
            /enemyAttackers is empty/
        );
    });
```

Rewrite the file header: both recorded gaps are closed, so it should now say what the file *does* guarantee (five paths, credits vs consultations) and what SP-4c still has to handle (the whiff window consults the fallback without booking).

- [ ] **Step 6: Verify and commit**

```bash
npx vitest run src/utils/combat/__tests__/dummyReachability.test.ts
npm test 2>&1 | tail -20
git add -A && git commit -m "test(engine): dummy reachability covers five paths and counts sink credits"
```

---

### Task 8: Comment sweep, then the whole-branch gates

**Files:**
- Modify: `src/utils/calculators/healingEngineAdapter.ts:303-315,350,511-513`
- Modify: any comment surfaced by the sweep below

**Interfaces:** Consumes every prior task. Produces a merge-ready branch.

- [ ] **Step 1: Sweep the comments the contract falsified**

Deleting or changing behaviour obliges a comment sweep, and the claims *around* a change go stale as reliably as the change's own note — three of five stale comments on #318 were already stale from an earlier sub-project. Distinguish the two kinds: describes CURRENT behaviour → rewrite; historical rationale → keep the history, gloss the old name. Never delete rationale to make a grep clean.

Known sites:
- `healingEngineAdapter.ts:303-315` — the `enemies: []` is TEST-ONLY paragraph, and its claim that the page floors the roster at one. Both are now false; rewrite as the practice-target contract, keeping the measured 3,876 → 1,290 history.
- `healingEngineAdapter.ts:350` — "they still describe the dummy, which is the only opponent when `enemies` is EMPTY".
- `healingEngineAdapter.ts:511-513` + the `LEGACY_SINK_*` block — still correct for *unspecified stats on a supplied enemy*, but must no longer imply an empty roster reaches the sink.

Then sweep for anything else asserting that a run can have no opponent:

```bash
node -e "
const {execSync}=require('child_process');const fs=require('fs');
const files=execSync(\"find src -name '*.ts' -o -name '*.tsx'\",{encoding:'utf8'}).split('\n').filter(Boolean);
for(const f of files){const L=fs.readFileSync(f,'utf8').split('\n');
 L.forEach((l,i)=>{ if(/^\s*(\*|\/\/)/.test(l) && /(empty roster|enemies is EMPTY|no enemy|enemyAttackers.*empty)/i.test(l)) console.log(f+':'+(i+1)+': '+l.trim()); });}
"
```

Judge each hit; a comment that documents *history* stays.

- [ ] **Step 2: Attribute every moved golden**

```bash
git diff --stat 39d463f1..HEAD -- '*.snap'
git diff 39d463f1..HEAD -- '*.snap' | grep -cE '^[+-][^+-]'
```

Every moved line must map to a named mechanism, with the count of unclassified lines being **zero** — the 4b-2a gate (1160 moved lines, 0 unclassified). Write the attribution table into `.superpowers/sdd/progress.md`. State the gate's *scope* honestly in the PR body: the repo has few `.snap` files and none covers a direct `runCombat` fixture, so "zero snapshot movement" would be load-bearing only for the production callers.

- [ ] **Step 3: Run the full gate set**

```bash
npx tsc --noEmit; echo "tsc: $?"
npx eslint src; echo "eslint: $?"
npm test 2>&1 | tail -20
npx vitest run src/utils/combat/audit 2>&1 | tail -20
```

Expected: tsc 0, eslint 0, full suite green, placement-symmetry oracle at its baseline of **2 findings / 146 / 13-13-13**. An oracle count that moved is a finding to report, not a baseline to update.

- [ ] **Step 4: Browser-verify**

```bash
npm start
```

On `/healing`: remove every enemy and confirm the run still produces a result, that healing shows as overheal, and that the console is clean. Confirm a one-enemy run's healer output is unchanged by the enemy's removal (only incoming damage should differ). On `/damage`: confirm the page still runs. Record the actual numbers in the ledger — the 4b-1 `teamDamage: 0` regression was invisible to a green suite and visible in the browser.

- [ ] **Step 5: Update the ledger and commit**

```bash
git add -A && git commit -m "docs(sp4b2b): comment sweep and gate results"
```

---

## Self-Review

**Spec coverage.** §4 contract → Tasks 1, 3. §5 zero-enemy healing → Task 2 (including the constants module, the un-flooring, changelog and docs). §6 migration: (a) the 20 files → Tasks 4-6; (b) the ~95 base literals → Task 1; (c) the 3 healing callers → Task 2 Step 9. §7 both `dummyReachability` gaps → Task 7. §8 gates → Task 8. §2.5's dead branches → Task 3 Step 3. The stale field doc → Task 3 Step 4; the wider comment sweep → Task 8 Step 1.

**One deliberate divergence from the spec.** §6(b) proposed using the *suite* as the classifier for which base-literal files are behavioural. Task 1 supersedes that with a strictly better one: insert `enemyAttackers: []` (byte-equivalent to absent), so Task 1 is provably inert, and let Task 3's **throw** name the behavioural population loudly. This follows the epic's "design a classifier to fail in the LOUD direction" rule — a wrong classification becomes an error rather than a silent number change — and it means no file gets a real enemy inserted by a script.

**Names used across tasks:** `PRACTICE_TARGET_ID` and `practiceTarget()` (Task 2, consumed by Tasks 7-8 prose), `DEFAULT_ENEMY_{HP,DEFENCE,SECURITY,SPEED}` (Task 2), `effectiveEnemies` (Task 2), `__getDummySinkCreditCount` / `__resetDummySinkCreditCount` (Task 7), `bareEnemy()` / `bareInput()` (existing, Tasks 4-7). Checked consistent.
