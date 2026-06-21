# D-PR4: Conditional-outgoing completion (Menace / Giant Slayer / Insidiousness) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Light up the three remaining conditional-outgoing-damage equipment effects — Menace, Giant Slayer (in-flight per-hit damage amplification) and Insidiousness (reactive extra-damage on debuff) — in the combat engine, keeping all existing goldens byte-identical.

**Architecture:** A new attacker-side mirror of D-PR3's victim-side `incomingEffects`: a pure `outgoingAmplificationForHit` evaluator over a new `outgoing-amplification` ability config, gates rolled inside the existing crit-draw loop (aggregate path) and the existing positional per-hit loop. Insidiousness rides the existing reactive `damage` executor after a small fix that makes that executor honor `procChance`.

**Tech Stack:** TypeScript, Vitest. Combat engine under `src/utils/combat/`, equipment registry under `src/utils/abilities/`.

**Spec:** `docs/superpowers/specs/2026-06-21-implant-gearset-abilities-D-pr4-design.md`

**Branch / worktree:** `feat/combat-d-pr4-outgoing-amplification` (worktree `.worktrees/d-pr4-outgoing-amplification`), stacked on D-PR3 tip `c943b1aa`. Retarget to `main` after #129→#128→#130 merge.

---

## CRITICAL WORKFLOW NOTES (read once)

- **Test runner:** NEVER `npm test` / `npm test --` (they launch Vitest **watch** mode and hang). Use `npx vitest run <pathOrName>`.
- **Goldens are load-bearing:** NEVER run `vitest -u`. If any DPS/healing/battle-sim snapshot moves, the gate leaked — fix the code, don't absorb the churn. The whole PR must keep goldens **byte-identical** (no committed fixture carries these implants; all new code is inert at its defaults).
- **docs/ is gitignored:** commit plan/spec edits with `git add -f <path>` and `git commit --no-verify` (the pre-commit hook runs the full suite; skip it for docs-only commits).
- **Worktree env:** `.env` + `docs/*.csv` + `docs/combat-system.md` are symlinked into this worktree already (required for the full suite + audit:skills).
- After each code task: `npx vitest run` the touched files, then `npm run lint` (max-warnings 0) and `npx tsc --noEmit` before committing. Run the FULL suite (`npx vitest run`) on any task that claims byte-identical goldens.

---

## Task 1: Fixture audit (byte-identical safety gate — no code)

**Goal:** Prove no existing fixture carries Menace / Giant Slayer / Insidiousness so the byte-identical invariant is genuinely empty before any wiring.

- [ ] **Step 1: Grep the combat fixtures + test trees for the three effect names.**

Run:
```bash
cd .worktrees/d-pr4-outgoing-amplification
grep -rniE "menace|giant.?slayer|insidious" src/utils/combat src/utils/calculators src/utils/abilities --include=*.ts | grep -viE "docs/|\.md" || echo "NONE FOUND"
```
Expected: `NONE FOUND` (or only matches inside this plan/spec). If any real fixture builds a ship with these implants, STOP and note it — the plan's byte-identical premise must be re-confirmed (neutralize the fixture or deliberately audit the churn; never `vitest -u`).

- [ ] **Step 2: Record the result** in the task checklist. No commit (read-only task).

---

## Task 2: Types — `outgoing-amplification` ability config + hit context

**Files:**
- Modify: `src/types/abilities.ts` (AbilityType union ~line 6–24; AbilityConfig union ~line 215; add new types near the `IncomingCondition`/`IncomingHitContext` block ~line 172–214)

- [ ] **Step 1: Add the attacker-side condition + hit-context types** next to the incoming ones (mirror their doc-comment style):

```ts
/**
 * Attacker-side condition for an in-flight outgoing-amplification proc, evaluated against the
 * OutgoingHitContext at the attacker's per-hit seam — NOT a ConditionSubject (those gate the
 * buff/modifier fold). Mirrors IncomingCondition on the victim side (D-PR3).
 */
export type OutgoingCondition = 'amplify-on-crit' | 'amplify-vs-higher-attack';

export interface OutgoingHitContext {
    /** Did this individual hit critically strike? (Menace.) */
    didCrit: boolean;
    /** Is the target's live effective attack higher than the attacker's? (Giant Slayer.) */
    targetHigherAttack: boolean;
}
```

- [ ] **Step 2: Add `'outgoing-amplification'` to the `AbilityType` union** (alongside `'incoming-reduction' | 'incoming-block'`).

- [ ] **Step 3: Add the config member to the `AbilityConfig` union** (mirror the `incoming-reduction` member shape):

```ts
      | {
            type: 'outgoing-amplification';
            /** Eligibility condition evaluated per hit. */
            condition: OutgoingCondition;
            /** Amplification added to this hit when the proc fires, in percentage points (e.g. 50). */
            ampPct: number;
            /** Per-(owner,ability) proc chance in (0,1). Rolled per eligible hit. */
            procChance: number;
        }
```

- [ ] **Step 4: Verify it compiles.** Run: `npx tsc --noEmit`. Expected: PASS (a new union member alone shouldn't break exhaustive switches yet — `outgoingEffects` is added next).

- [ ] **Step 5: Commit.**
```bash
git add src/types/abilities.ts
git commit -m "feat(combat): D-PR4 — outgoing-amplification ability config + OutgoingHitContext types"
```

---

## Task 3: Pure evaluator `outgoingEffects.ts`

**Files:**
- Create: `src/utils/combat/outgoingEffects.ts`
- Test: `src/utils/combat/__tests__/outgoingEffects.test.ts`

Mirror of `src/utils/combat/incomingEffects.ts` (read it first for the exact style).

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, it, expect, vi } from 'vitest';
import { outgoingAmplificationForHit } from '../outgoingEffects';
import { Ability } from '../../../types/abilities';

const amp = (id: string, condition: 'amplify-on-crit' | 'amplify-vs-higher-attack', ampPct: number, procChance: number): Ability => ({
    id,
    type: 'outgoing-amplification',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'outgoing-amplification', condition, ampPct, procChance },
});

const alwaysRoll = () => true;
const neverRoll = () => false;

describe('outgoingAmplificationForHit', () => {
    it('returns 0 when no outgoing-amplification abilities are present', () => {
        expect(outgoingAmplificationForHit([], { didCrit: true, targetHigherAttack: true }, alwaysRoll)).toBe(0);
    });

    it('Menace (amplify-on-crit) fires only on crit hits', () => {
        const abilities = [amp('m', 'amplify-on-crit', 30, 0.5)];
        expect(outgoingAmplificationForHit(abilities, { didCrit: true, targetHigherAttack: false }, alwaysRoll)).toBe(30);
        expect(outgoingAmplificationForHit(abilities, { didCrit: false, targetHigherAttack: false }, alwaysRoll)).toBe(0);
    });

    it('Giant Slayer (amplify-vs-higher-attack) fires only when target attack is higher', () => {
        const abilities = [amp('g', 'amplify-vs-higher-attack', 50, 0.5)];
        expect(outgoingAmplificationForHit(abilities, { didCrit: false, targetHigherAttack: true }, alwaysRoll)).toBe(50);
        expect(outgoingAmplificationForHit(abilities, { didCrit: true, targetHigherAttack: false }, alwaysRoll)).toBe(0);
    });

    it('stacks additively when both fire on one hit', () => {
        const abilities = [amp('m', 'amplify-on-crit', 30, 0.5), amp('g', 'amplify-vs-higher-attack', 50, 0.5)];
        expect(outgoingAmplificationForHit(abilities, { didCrit: true, targetHigherAttack: true }, alwaysRoll)).toBe(80);
    });

    it('returns 0 when the proc gate does not fire', () => {
        const abilities = [amp('m', 'amplify-on-crit', 30, 0.5)];
        expect(outgoingAmplificationForHit(abilities, { didCrit: true, targetHigherAttack: true }, neverRoll)).toBe(0);
    });

    it('advances the proc gate ONLY for eligible abilities (ineligible hit must not consume the gate)', () => {
        const roll = vi.fn(() => true);
        const abilities = [amp('m', 'amplify-on-crit', 30, 0.5)];
        // non-crit hit → ineligible → rollProc must NOT be called for Menace
        outgoingAmplificationForHit(abilities, { didCrit: false, targetHigherAttack: true }, roll);
        expect(roll).not.toHaveBeenCalled();
        // crit hit → eligible → rollProc called exactly once with the ability id + chance
        outgoingAmplificationForHit(abilities, { didCrit: true, targetHigherAttack: true }, roll);
        expect(roll).toHaveBeenCalledTimes(1);
        expect(roll).toHaveBeenCalledWith('m', 0.5);
    });
});
```

- [ ] **Step 2: Run, verify it fails.** `npx vitest run src/utils/combat/__tests__/outgoingEffects.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement `outgoingEffects.ts`.**

```ts
import { Ability, OutgoingCondition, OutgoingHitContext } from '../../types/abilities';

/** True when an outgoing-amplification condition is satisfied by the hit context. */
function conditionMet(cond: OutgoingCondition, ctx: OutgoingHitContext): boolean {
    switch (cond) {
        case 'amplify-on-crit':
            return ctx.didCrit;
        case 'amplify-vs-higher-attack':
            return ctx.targetHigherAttack;
    }
}

/**
 * Summed amplification % for one in-flight direct hit (attacker side; mirror of
 * incomingReductionForHit). For each outgoing-amplification ability whose condition is met,
 * advance its proc gate via `rollProc(abilityId, procChance)`; on a firing gate, add `ampPct`.
 * Eligibility gates the gate — an ineligible hit never advances rollProc (matches "when
 * critically damaging" / "when directly damaging a higher-attack enemy"). Returns 0 when
 * nothing applies → callers stay byte-identical with no such equipment.
 */
export function outgoingAmplificationForHit(
    attackerAbilities: Ability[],
    ctx: OutgoingHitContext,
    rollProc: (abilityId: string, chance: number) => boolean
): number {
    let sum = 0;
    for (const a of attackerAbilities) {
        if (a.config.type !== 'outgoing-amplification') continue;
        if (!conditionMet(a.config.condition, ctx)) continue;
        if (!rollProc(a.id, a.config.procChance)) continue;
        sum += a.config.ampPct;
    }
    return sum;
}
```

- [ ] **Step 4: Run, verify it passes.** `npx vitest run src/utils/combat/__tests__/outgoingEffects.test.ts` — Expected: PASS (6 tests). Then `npx tsc --noEmit` (the switch is now exhaustive).

- [ ] **Step 5: Commit.**
```bash
git add src/utils/combat/outgoingEffects.ts src/utils/combat/__tests__/outgoingEffects.test.ts
git commit -m "feat(combat): D-PR4 — pure outgoingAmplificationForHit evaluator (Menace/Giant Slayer)"
```

---

## Task 4: Registry entries — Menace + Giant Slayer

**Files:**
- Modify: `src/utils/abilities/buildEquipmentAbilities.ts` (add value tables near the other per-rarity tables ~line 80–145; add two `IMPLANT_ABILITIES` entries near INTRUSION/WARPSTRIKE)
- Test: `src/utils/abilities/__tests__/buildEquipmentAbilities.test.ts` (extend)

Source values (from `src/constants/implants.ts`): **Menace** ampPct 20/25/30/35/45, procChance 0.08/0.09/0.10/0.11/0.12 for common/uncommon/rare/epic/legendary. **Giant Slayer** ampPct 50 (all), procChance 0.12/0.14/0.16/0.20 for uncommon/rare/epic/legendary (NO common).

- [ ] **Step 1: Write failing tests** (extend the existing test file, mirroring the Intrusion/Arcane Siege blocks):

```ts
it('emits Menace outgoing-amplification on-crit with per-rarity ampPct/procChance', () => {
    const ab = firstImplantAbility('MENACE', 'epic'); // helper used by sibling tests
    expect(ab?.config.type).toBe('outgoing-amplification');
    if (ab?.config.type === 'outgoing-amplification') {
        expect(ab.config.condition).toBe('amplify-on-crit');
        expect(ab.config.ampPct).toBe(35);
        expect(ab.config.procChance).toBeCloseTo(0.11);
    }
});

it('emits Giant Slayer outgoing-amplification vs-higher-attack; no common variant', () => {
    const leg = firstImplantAbility('GIANT_SLAYER', 'legendary');
    expect(leg?.config.type).toBe('outgoing-amplification');
    if (leg?.config.type === 'outgoing-amplification') {
        expect(leg.config.condition).toBe('amplify-vs-higher-attack');
        expect(leg.config.ampPct).toBe(50);
        expect(leg.config.procChance).toBeCloseTo(0.2);
    }
    expect(firstImplantAbility('GIANT_SLAYER', 'common')).toBeUndefined();
});
```
(If no `firstImplantAbility` helper exists, follow the pattern the existing Bloodthirst/Intrusion tests use to resolve a single ability for an implant+rarity.)

- [ ] **Step 2: Run, verify fail.** `npx vitest run src/utils/abilities/__tests__/buildEquipmentAbilities.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement.** Add value tables + two registry entries:

```ts
const MENACE_AMP: Record<string, number> = { common: 20, uncommon: 25, rare: 30, epic: 35, legendary: 45 };
const MENACE_PROC: Record<string, number> = { common: 0.08, uncommon: 0.09, rare: 0.10, epic: 0.11, legendary: 0.12 };
const GIANT_SLAYER_PROC: Record<string, number> = { uncommon: 0.12, rare: 0.14, epic: 0.16, legendary: 0.20 }; // no common

function mkAmplification(
    ampPct: number | undefined,
    condition: OutgoingCondition,
    procChance: number | undefined
): Omit<Ability, 'id'> | undefined {
    if (ampPct === undefined || procChance === undefined) return undefined;
    return {
        type: 'outgoing-amplification',
        target: 'self',
        trigger: 'on-cast', // inert: the live condition lives in config, evaluated per-hit
        conditions: [],
        config: { type: 'outgoing-amplification', condition, ampPct, procChance },
        autoFilled: true,
    };
}

// in IMPLANT_ABILITIES:
MENACE: (rarity) => mkAmplification(MENACE_AMP[rarity], 'amplify-on-crit', MENACE_PROC[rarity]),
GIANT_SLAYER: (rarity) => mkAmplification(50, 'amplify-vs-higher-attack', GIANT_SLAYER_PROC[rarity]),
```
Add `OutgoingCondition` to the `../../types/abilities` import.

- [ ] **Step 4: Run, verify pass.** `npx vitest run src/utils/abilities/__tests__/buildEquipmentAbilities.test.ts` — Expected: PASS. Then `npm run lint && npx tsc --noEmit`.

- [ ] **Step 5: Commit.**
```bash
git add src/utils/abilities/buildEquipmentAbilities.ts src/utils/abilities/__tests__/buildEquipmentAbilities.test.ts
git commit -m "feat(combat): D-PR4 — Menace + Giant Slayer outgoing-amplification registry entries"
```

---

## Task 5: Make the reactive `damage` executor honor `procChance` (extract `passesProcChanceGate`)

**Files:**
- Modify: `src/utils/combat/triggers.ts` (extract the inline gate from the heal/shield branch ~line 1137–1147; add the call to the `damage` branch ~line 1246)
- Test: `src/utils/combat/__tests__/triggers.*.test.ts` (add a focused unit test — pick the existing triggers test file or create `procChanceGate.test.ts`)

- [ ] **Step 1: Write the failing test** for the extracted helper + the damage-branch gating. Build a minimal reactive `damage` Intent with `procChance: 0.5`, a real `procChanceGates` Map, and a `creditReactiveDamage` spy; call `executeIntent` N times and assert credit fires ~N/2 times (deterministic accumulator), NOT N times. Also assert: with `procChance` undefined, credit fires every time (pass-through).

```ts
it('reactive damage executor gates by procChance (fires at the rate, not every time)', () => {
    let credited = 0;
    const gates = new Map();
    const ctx = makeExecCtx({ procChanceGates: gates, creditReactiveDamage: () => { credited++; } });
    const intent = makeDamageIntent({ procChance: 0.5, multiplier: 50 }); // 1 owner+ability → 1 gate
    for (let i = 0; i < 10; i++) executeIntent(intent, ctx);
    expect(credited).toBe(5); // makeRateGate(0.5) over 10 calls fires exactly 5
});

it('reactive damage with no procChance fires every time (pass-through, byte-identical to today)', () => {
    let credited = 0;
    const ctx = makeExecCtx({ procChanceGates: new Map(), creditReactiveDamage: () => { credited++; } });
    const intent = makeDamageIntent({ multiplier: 50 }); // no procChance
    for (let i = 0; i < 4; i++) executeIntent(intent, ctx);
    expect(credited).toBe(4);
});
```
(Use the existing triggers test helpers for `makeExecCtx`/`makeDamageIntent` if present; otherwise build minimal literals matching `IntentExecContext` / `Intent`.)

- [ ] **Step 2: Run, verify fail** (today the damage branch credits every time → first test fails at 10≠5). `npx vitest run <triggers test file>`.

- [ ] **Step 3: Implement.** Extract the helper and apply it in both branches:

```ts
/**
 * Per-(owner,ability) proc-chance gate, shared by the heal/shield and damage reactive branches.
 * Pass-through when procChance is undefined / <=0 / >=1, or when the gate map is absent (unit-test
 * contexts). Do NOT hoist the call above the type-branch dispatch — the heal/shield branch must keep
 * its `!ctx.healing` early-return BEFORE consulting the gate (else the gate desyncs in non-healing
 * passes). Branch-local by design.
 */
function passesProcChanceGate(intent: Intent, ctx: IntentExecContext): boolean {
    const pc = intent.ability.procChance;
    if (pc === undefined || pc <= 0 || pc >= 1) return true;
    const gateKey = `${intent.ownerId}:${intent.ability.id}`;
    let gate = ctx.procChanceGates?.get(gateKey);
    if (ctx.procChanceGates && !gate) {
        gate = makeRateGate();
        ctx.procChanceGates.set(gateKey, gate);
    }
    return !gate || gate(pc);
}
```
- In the heal/shield branch, REPLACE the inline `const pc = ...; if (pc !== undefined && ...) { ... if (gate && !gate(pc)) return; }` block with `if (!passesProcChanceGate(intent, ctx)) return;` at the **same position** (after the `oncePerCombat` check).
- At the TOP of the `if (cfg.type === 'damage')` branch, add `if (!passesProcChanceGate(intent, ctx)) return;`.

- [ ] **Step 4: Run the new tests + the FULL suite** (byte-identical gate: no shipped reactive damage ability sets procChance). `npx vitest run` — Expected: all green, ZERO golden movement (`git status` shows no `.snap` changes). Then `npm run lint && npx tsc --noEmit`.

- [ ] **Step 5: Commit.**
```bash
git add src/utils/combat/triggers.ts src/utils/combat/__tests__/<file>
git commit -m "fix(combat): D-PR4 — reactive damage executor honors procChance (extract passesProcChanceGate)"
```

---

## Task 6: Aggregate-path amplification in `runPlayerTurn`

**Files:**
- Modify: `src/utils/combat/playerTurn.ts` (PlayerTurnArgs ~line 209–293; the crit-draw loop ~line 1134; `damageCritMultiplier`/`postDefenseFactor` ~line 1294–1320)
- Test: `src/utils/combat/__tests__/` — add a focused runPlayerTurn amplification test (mirror an existing runPlayerTurn unit test for harness shape)

- [ ] **Step 1: Add the two optional args to `PlayerTurnArgs`** (near `incomingReductionCritFamilyPct`):
```ts
    /** D-PR4: the bound target's live effective attack (for Giant Slayer's higher-attack gate).
     *  Absent → targetHigherAttack false → Giant Slayer inert. */
    targetEffectiveAttack?: number;
    /** D-PR4: engine-supplied deterministic proc gate for outgoing-amplification procs, keyed by
     *  ability id under this actor. Absent → no amplification rolled (byte-identical). */
    rollOutgoingProc?: (abilityId: string, chance: number) => boolean;
```

- [ ] **Step 2: Write the failing test** — call `runPlayerTurn` once with a passive slot carrying a Menace `outgoing-amplification` ability, a deterministic `rollOutgoingProc: () => true`, a crit-forced setup (effectiveCrit 100), and assert the returned direct damage equals the no-amplification baseline × (1 + ampPct/100). Add a second case: `rollOutgoingProc` absent → equals baseline exactly (byte-identical). A Giant Slayer case: `targetEffectiveAttack` above/below attacker effective attack flips amplification on/off.

- [ ] **Step 3: Run, verify fail.** `npx vitest run <new test>`.

- [ ] **Step 4: Implement.** 

(a) Derive amp abilities + the higher-attack flag near the top of the damage section (after `effectiveAttack` is known):
```ts
const ampAbilities = (passiveSkill?.abilities ?? []).filter(
    (a) => a.config.type === 'outgoing-amplification'
);
const targetHigherAttack =
    args.targetEffectiveAttack !== undefined && args.targetEffectiveAttack > effectiveAttack;
const rollOutgoingProc = args.rollOutgoingProc;
```

(b) In the existing crit-draw loop (`for (let h = 0; h < drawHits; h++)`), accumulate weighted sums. Import `outgoingAmplificationForHit` from `./outgoingEffects`:
```ts
let ampNonCritWeight = 0;
let ampCritWeight = 0;
for (let h = 0; h < drawHits; h++) {
    const didCritHit = critGate(effectiveCrit / 100);
    if (didCritHit) critHits += 1;
    if (hasDamageAbility) hitCrits.push(didCritHit);
    const amp =
        ampAbilities.length > 0 && rollOutgoingProc
            ? outgoingAmplificationForHit(ampAbilities, { didCrit: didCritHit, targetHigherAttack }, rollOutgoingProc) / 100
            : 0;
    if (didCritHit) ampCritWeight += 1 + amp;
    else ampNonCritWeight += 1 + amp;
}
```

(c) Where `damageCritMultiplier` / `postDefenseFactor` are computed (~1316), add the amplified multiplier and use it for the FIRING hit only (leave `passiveCritMultiplier` on `damageCritMultiplier`):
```ts
// D-PR4: per-hit outgoing amplification (Menace/Giant Slayer), firing hit only. Collapses to
// damageCritMultiplier when no amplification fired (ampWeights = nonCritHits / critHits) →
// byte-identical. critIncomingRatio carries D-PR3's crit-family incoming reduction.
const amplifiedCritMultiplier =
    drawHits > 0
        ? (ampNonCritWeight + ampCritWeight * (1 + effectiveCritDamage / 100) * critIncomingRatio) / drawHits
        : damageCritMultiplier;
const postDefenseFactor = amplifiedCritMultiplier * nonCritFactor;
```
(Replace the existing `const postDefenseFactor = damageCritMultiplier * nonCritFactor;`.)

- [ ] **Step 5: Run the new test + FULL suite.** `npx vitest run` — Expected: new tests PASS, ZERO golden movement (`ampAbilities` empty everywhere in fixtures → byte-identical). `npm run lint && npx tsc --noEmit`.

- [ ] **Step 6: Commit.**
```bash
git add src/utils/combat/playerTurn.ts src/utils/combat/__tests__/<file>
git commit -m "feat(combat): D-PR4 — aggregate-path in-flight outgoing amplification (firing hit)"
```

---

## Task 7: Engine wiring — supply `targetEffectiveAttack` + `rollOutgoingProc` at the 3 aggregate sites

**Files:**
- Modify: `src/utils/calculators/rateAccumulator.ts` (add a tiny shared `rollRateGate` helper) — OR inline the closure; prefer the helper for DRY
- Modify: `src/utils/combat/engine.ts` (the three `runPlayerTurn({...})` sites: focus ~3594, team ~3770, enemy ~4053)
- Test: `src/utils/combat/__tests__/` — an engine-level integration test (mirror an existing `runCombat` DPS test) proving a player ship with a Menace implant deals more total damage than the same ship without it, over enough rounds for the gate to fire.

- [ ] **Step 1: Add `rollRateGate`** to `rateAccumulator.ts`:
```ts
/** Get-or-create a per-key RateGate in `gates` and roll it at `chance`. Absent map → pass-through
 *  (true). Used by the engine to back per-(owner,ability) proc closures. */
export function rollRateGate(
    gates: Map<string, RateGate> | undefined,
    key: string,
    chance: number
): boolean {
    if (!gates) return true;
    let gate = gates.get(key);
    if (!gate) { gate = makeRateGate(); gates.set(key, gate); }
    return gate(chance);
}
```

- [ ] **Step 2: Write the failing integration test** (DPS `runCombat`): build two otherwise-identical attacker setups, one whose passive slot includes a Menace `outgoing-amplification` ability (procChance high enough, e.g. via the registry epic variant), force crits, give the dummy enemy enough HP to survive several rounds; assert total credited direct damage is strictly greater WITH the implant. Also assert a control run with no implant matches the pre-D-PR4 baseline (byte-identical sanity).

- [ ] **Step 3: Run, verify fail.** `npx vitest run <integration test>` (the amplified run won't yet differ because the engine passes no `rollOutgoingProc`).

- [ ] **Step 4: Implement the 3 site wirings.** At each `runPlayerTurn({...})` call, add:
```ts
targetEffectiveAttack: effectiveStatsOf(statusEngine, selfBuffLookup, <victim>).attack,
rollOutgoingProc: (abilityId, chance) => rollRateGate(procChanceGates, `${<actingId>}:${abilityId}`, chance),
```
- focus site (~3594): victim = the bound target the focus attacks (the `tgt`/dummy used at that site); actingId = the focus actor id.
- team site (~3770): victim = that team actor's resolved target; actingId = team actor id.
- enemy site (~4053): victim = `tgt` (already in scope); actingId = `actor.id` (already in scope).

Use the SAME `selfBuffLookup`/`statusEngine` args already used by the existing `effectiveStatsOf(...).speed` call (~1570) and `procChanceGates` (already in scope, created ~1873). Verify the exact victim variable name at each site before editing (read ±15 lines).

- [ ] **Step 5: Run the integration test + FULL suite.** `npx vitest run` — Expected: integration PASS, control byte-identical, ZERO golden movement (no fixture carries the implant). `npm run lint && npx tsc --noEmit`.

- [ ] **Step 6: Commit.**
```bash
git add src/utils/calculators/rateAccumulator.ts src/utils/combat/engine.ts src/utils/combat/__tests__/<file>
git commit -m "feat(combat): D-PR4 — wire targetEffectiveAttack + rollOutgoingProc at the 3 aggregate turn sites"
```

---

## Task 8: Positional-path amplification

**Files:**
- Modify: `src/utils/combat/positionalApply.ts` (add `outgoingAmplificationFor?` param ~line 126; apply it in the per-hit loop ~line 169–178)
- Modify: `src/utils/combat/engine.ts` (`drivePositionalApply` ~line 2855, next to `incomingReductionFor`)
- Test: `src/utils/combat/__tests__/` — a positional/battle-sim integration test (mirror the D-PR3 positional incoming-reduction test) proving per-victim amplification on the positional path.

- [ ] **Step 1: Write the failing test** — drive `applyPositionalDamage` (or a small `runCombat` positional setup) with an attacker carrying Menace, forced crit, and assert the victim's hit damage is amplified; assert a non-crit hit is not (Menace); assert Giant Slayer amplifies only the victim whose effective attack is higher.

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement.**

(a) `positionalApply.ts`: add param
```ts
/** D-PR4: attacker-side per-hit outgoing amplification % (Menace/Giant Slayer). Unsupplied → 0 →
 *  byte-identical. Applied multiplicatively on the resolved hit AFTER victimHitDamage. */
outgoingAmplificationFor?: (victim: CombatActor, didCrit: boolean) => number;
```
In the per-hit loop, after `const dmg = victimHitDamage(...)`:
```ts
const ampPct = outgoingAmplificationFor?.(victim, didCrit) ?? 0;
const dmg2 = ampPct !== 0 ? dmg * (1 + ampPct / 100) : dmg;
emitHit?.(victim, dmg2, didCrit);
onVictimResolved?.(victim, dmg2, outcome, didCrit);
```
(Rename the local so the amplified value flows to `emitHit`/`onVictimResolved`; keep the unamplified `dmg` only if `outcome` needs it — check the existing `outcome` derivation.)

(b) `drivePositionalApply` (engine): add alongside `incomingReductionFor`:
```ts
outgoingAmplificationFor: (victim, didCrit) =>
    outgoingAmplificationForHit(outgoingAbilitiesOf(args.actingId), {
        didCrit,
        targetHigherAttack:
            effectiveStatsOf(statusEngine, selfBuffLookup, victim).attack >
            effectiveStatsOf(statusEngine, selfBuffLookup, actorById(args.actingId)).attack,
    }, (abilityId, chance) => rollRateGate(procChanceGates, `${args.actingId}:${abilityId}`, chance)),
```
Add an `outgoingAbilitiesOf(id)` lookup mirroring `incomingAbilitiesOf` (build an `outgoingAbilitiesById` Map in the same pass that builds `incomingAbilitiesById` ~line 2056–2125, filtering `config.type === 'outgoing-amplification'`), and import `outgoingAmplificationForHit`. Confirm an actor-by-id accessor exists (e.g. the roster/`runtimesById` or `args.opposingLiving` + acting roster) — reuse whatever `incomingReductionFor` siblings use to resolve an actor; if only ids are handy, resolve via the existing actor map.

- [ ] **Step 4: Run test + FULL suite.** `npx vitest run` — Expected: PASS, ZERO golden movement. `npm run lint && npx tsc --noEmit`.

- [ ] **Step 5: Commit.**
```bash
git add src/utils/combat/positionalApply.ts src/utils/combat/engine.ts src/utils/combat/__tests__/<file>
git commit -m "feat(combat): D-PR4 — positional-path per-victim outgoing amplification"
```

---

## Task 9: Insidiousness registry entry (reactive damage rider)

**Files:**
- Modify: `src/utils/abilities/buildEquipmentAbilities.ts`
- Test: `src/utils/abilities/__tests__/buildEquipmentAbilities.test.ts` (unit) + an engine integration test (gated frequency on debuff)

Source values: multiplier 60/70/80/90/100, procChance 0.10/0.12/0.14/0.17/0.21 for common/uncommon/rare/epic/legendary.

- [ ] **Step 1: Write the failing unit test** — Insidiousness produces a reactive `damage` ability with `trigger: 'on-debuff-inflicted'`, the right per-rarity multiplier + procChance.

- [ ] **Step 2: Write the failing integration test** — a ship with Insidiousness that applies a debuff every round deals its extra chunk at the gated frequency (~rarity% of rounds), NOT every round (the Task-5 gate fix regression). Assert it deals 0 extra when it applies no debuff.

- [ ] **Step 3: Run, verify fail.**

- [ ] **Step 4: Implement** the registry entry:
```ts
const INSIDIOUSNESS_MULT: Record<string, number> = { common: 60, uncommon: 70, rare: 80, epic: 90, legendary: 100 };
const INSIDIOUSNESS_PROC: Record<string, number> = { common: 0.10, uncommon: 0.12, rare: 0.14, epic: 0.17, legendary: 0.21 };

// in IMPLANT_ABILITIES:
INSIDIOUSNESS: (rarity) => {
    const m = INSIDIOUSNESS_MULT[rarity];
    const pc = INSIDIOUSNESS_PROC[rarity];
    if (m === undefined) return undefined;
    return {
        type: 'damage',
        target: 'enemy',
        trigger: 'on-debuff-inflicted',
        conditions: [],
        procChance: pc,
        config: { type: 'damage', multiplier: m, hits: 1 },
        autoFilled: true,
    };
},
```
Verify `'on-debuff-inflicted'` is a valid `AbilityTrigger` and `'damage'` is in `REACTIVE_ABILITY_TYPES` (it is — Grif). If the partition needs `damage` already covered, no change.

- [ ] **Step 5: Run tests + FULL suite.** `npx vitest run` — Expected: PASS, ZERO golden movement. `npm run lint && npx tsc --noEmit`.

- [ ] **Step 6: Commit.**
```bash
git add src/utils/abilities/buildEquipmentAbilities.ts src/utils/abilities/__tests__/<files>
git commit -m "feat(combat): D-PR4 — Insidiousness reactive-damage-on-debuff registry entry"
```

---

## Task 10: Coverage tracker update

**Files:**
- Modify: `src/utils/abilities/__tests__/equipmentCoverage.test.ts` (the `toEqual([...])` ordered list ~line 113; the `implementedImplants` Set ~line 170; add per-implant assertions for Menace/Giant Slayer/Insidiousness ~line 200+)

- [ ] **Step 1: Add `GIANT_SLAYER`, `INSIDIOUSNESS`, `MENACE` to both the `toEqual` ordered array and the `implementedImplants` Set.** The `toEqual` array must match `Object.keys(IMPLANTS)` filter order — run the test first and let the failure message dictate the exact positions (do NOT guess; TDD).

- [ ] **Step 2: Add per-implant `produces 1 ability per rarity` assertions** for Menace and Giant Slayer (note Giant Slayer common = 0), and a 1-per-rarity assertion for Insidiousness (mirror the Intrusion/Arcane Siege blocks). Confirm Voidfire Catalyst still asserts 0 abilities (explicitly-deferred gap stays flagged).

- [ ] **Step 3: Run.** `npx vitest run src/utils/abilities/__tests__/equipmentCoverage.test.ts` — Expected: PASS.

- [ ] **Step 4: Commit.**
```bash
git add src/utils/abilities/__tests__/equipmentCoverage.test.ts
git commit -m "test(combat): D-PR4 — coverage tracker includes Menace/Giant Slayer/Insidiousness"
```

---

## Task 11: Changelog + docs

**Files:**
- Modify: `src/constants/changelog.ts` (`UNRELEASED_CHANGES`)
- Modify: `src/pages/DocumentationPage.tsx` (if there's an implant/gear-set combat-effects section to extend; otherwise skip)

- [ ] **Step 1: Add a plain-English `UNRELEASED_CHANGES` entry** — e.g. "Combat sim now models the Menace and Giant Slayer implants (chance to amplify a hit's damage on a crit / against higher-attack enemies) and Insidiousness (chance to deal bonus damage when you debuff an enemy)."
- [ ] **Step 2: Update DocumentationPage** if it enumerates supported equipment effects; keep it consistent with D-PR1/2/3 entries.
- [ ] **Step 3: Commit.**
```bash
git add src/constants/changelog.ts src/pages/DocumentationPage.tsx
git commit -m "docs(combat): D-PR4 — changelog + docs for Menace/Giant Slayer/Insidiousness"
```

---

## Task 12: Final verification

- [ ] **Step 1: Full suite.** `npx vitest run` — Expected: ALL green; `git status` / `git diff --stat` show ZERO `.snap` / golden file changes across the whole branch vs `c943b1aa`.
- [ ] **Step 2: Skill audit unchanged.** `npm run audit:skills` — Expected: 141 ships, 0 findings (equipment effects are not ship-skill text).
- [ ] **Step 3: Lint + types.** `npm run lint` (max-warnings 0) and `npx tsc --noEmit` — Expected: clean.
- [ ] **Step 4: Confirm byte-identical goldens explicitly.** `git diff c943b1aa --stat -- '**/*.snap' '**/__snapshots__/**'` — Expected: empty.
- [ ] **Step 5: Push + open PR** stacked on D-PR3 (base `feat/combat-d-pr3-incoming-reduction`; retarget to main after the stack merges). Use `gh auth switch --user TheSusort` first if needed. Pipe push through `| cat`.

---

## Notes for the implementer

- **Byte-identical is the contract.** Every "FULL suite" step must show zero golden movement. If a snapshot moves, a default leaked (an `ampAbilities` filter matched where it shouldn't, or a gate advanced when it shouldn't) — fix the gate, never `-u`.
- **Gate determinism:** amplification gates are separate `makeRateGate` instances keyed `${ownerId}:${abilityId}`; they never share state with `critGate`. A single combat run is either aggregate (DPS/healing) or positional (battle-sim) for a given actor, so the two paths' gates never desync within a run.
- **Scope reminders:** amplification applies to the firing attack's drawn hits only (NOT the passive payload hit). Voidfire Catalyst is deferred. Don't widen scope.
- **`pc >= 1` pass-through** in `passesProcChanceGate` is intentional (a guaranteed proc skips the gate and always fires) — keep the explicit unit case so a refactor can't silently start gating guaranteed procs.
