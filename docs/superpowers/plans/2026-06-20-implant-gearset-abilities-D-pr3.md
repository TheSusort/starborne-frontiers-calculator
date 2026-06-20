# D-PR3: Conditional Incoming-Damage Reduction (victim side) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Model the conditional incoming-damage-reduction family (7 equipment effects + the Iridium ship skill) on the victim side of the combat engine: percentage reductions (Voidshade, Nebula Nullifier, Hyperion Gaze, Hardened set, Iridium), DoT-source reduction (Vortex Veil), and proc-based block (Ironclad, Shadowguard).

**Architecture:** A dedicated victim-side incoming-effects model — two new ability configs (`incoming-reduction`, `incoming-block`) emitted onto the passive slot by the equipment registry and one new Iridium parser rule, plus two pure evaluators consumed at the victim apply sites. %-reduction folds into the existing incoming-damage channel at the crit-aware damage-computation sites (`victimHitDamage` positional + `playerTurn` aggregate) and the DoT-tick loop. Block is rolled at the shared damage funnel (`applyVictimDamage`, gated on `byDirectDamage`), so it works in both damage paths automatically. Composition: additive, take-max within the crit-reduction family. Proc rolls reuse D-PR1's deterministic `procChanceGates` rate-gate, victim-side.

**Tech Stack:** React 18, TypeScript, Vite, Vitest. Combat engine under `src/utils/combat/` + `src/utils/abilities/`.

**Spec:** `docs/superpowers/specs/2026-06-20-implant-gearset-abilities-D-pr3-design.md`
**Branch:** `feat/combat-d-pr3-incoming-reduction` (stacked on D-PR2 tip `21c6fc33`).

---

## Workflow gotchas (read before starting)

- **Test runner:** bare `npm test` runs Vitest in WATCH mode and hangs. Always use `npx vitest run <path-or-name>`. Full suite: `npx vitest run`.
- **Never** run `vitest -u` (would silently rewrite golden `.snap` files). All DPS / battle-sim / healing goldens must stay **byte-identical** in this PR.
- **Lint:** `npm run lint` enforces `--max-warnings 0`. Run it in EVERY task gate (a stray `as any` fails the build).
- **Type check:** `npx tsc --noEmit`.
- **Skill audit:** `npm run audit:skills` should stay 141 ships / 0 findings. Task 5 (Iridium parser rule) touches the parser — re-run it there and confirm it stays green.
- **`docs/` is gitignored** but `docs/superpowers/**` is force-tracked — commit plan/spec edits with `git add -f` and `--no-verify` (pre-commit runs the full suite; skip it for docs-only commits).
- Commit message footer:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

**Per-rarity / per-set values (verified against `implants.ts` / `gearSets.ts`):**

| Effect | common | uncommon | rare | epic | legendary |
|---|---|---|---|---|---|
| Voidshade (reduce %) | 4 | 8 | 12 | 16 | 20 |
| Nebula Nullifier (reduce %) | 7 | 14 | 21 | 28 | 35 |
| Hyperion Gaze (reduce %) | 7 | 14 | 21 | 28 | 35 |
| Vortex Veil (reduce %) | 6 | 12 | 18 | 24 | 30 |
| Ironclad chance / block % | 10 / 30 | — | 14 / 40 | 16 / 45 | 20 / 50 |
| Shadowguard chance / block % | — | 7 / 100 | — | 12 / 100 | 16 / 100 |

- **Hardened** (gear set, 2-pc): reduce **5%** on crit hits (fixed, no rarity). Its `damageReduction:5%` stat is inert in combat → no double-count.
- **Iridium** (ship skill): reduce **35%** on crit hits.
- Ironclad has NO `uncommon`; Shadowguard has only `uncommon`/`epic`/`legendary`. Builders must tolerate sparse rarity maps (`undefined` → skip, the existing pattern).

---

## Task 1: Fixture audit — confirm the byte-identical invariant is empty

**Goal:** Prove no existing DPS / battle-sim / healing golden builds a ship carrying any of the seven equipment effects, and that Iridium is not in any golden/healing fixture (only C-era unit tests). If clean, goldens are guaranteed byte-identical. No code change.

**Files:** none modified.

- [ ] **Step 1: Grep the test corpus for the equipment effects**

Run:
```bash
grep -rniE "voidshade|nebula[_ ]?nullifier|hyperion[_ ]?gaze|vortex[_ ]?veil|shadowguard|ironclad|hardened" src/ --include=*.test.ts --include=*.test.tsx
grep -rniE "VOIDSHADE|NEBULA_NULLIFIER|HYPERION_GAZE|VORTEX_VEIL|SHADOWGUARD|IRONCLAD|HARDENED" src/ --include=*.ts --include=*.tsx | grep -iE "fixture|setBonus|implant" | grep -v "implants.ts\|gearSets.ts\|buildEquipmentAbilities\|equipmentCoverage"
```
Expected: no hits wiring one of these onto a ship used by a DPS/battle/healing golden. (Hits in `implants.ts`, `gearSets.ts`, the equipment-ability test files are fine.)

- [ ] **Step 2: Grep for Iridium in goldens / healing fixtures**

Run:
```bash
grep -rln "Iridium" src --include=*.ts --include=*.snap | grep -iE "golden|healing|simulator|fixture"
grep -rn "Iridium" src/utils/combat/__tests__/purgeConditionalSources.test.ts
```
Expected: Iridium appears only in C-era *unit* tests (e.g. `purgeConditionalSources.test.ts` as a purge-on-damaged source) — those are non-golden. Note in the Task 5 commit body which unit tests reference Iridium so the implementer knows to re-check them after lighting up its crit-reduction (a crit hit on Iridium in those tests could change damage numbers — audit, don't `-u`).

- [ ] **Step 3: Record the result**

If clean (expected): proceed. If a fixture DOES carry one of these effects, STOP and surface it — neutralize the fixture or deliberately audit the churn. Never `vitest -u`.

---

## Task 2: New ability config types + incoming-effect model types

**Goal:** Add `incoming-reduction` and `incoming-block` to `AbilityType` and `AbilityConfig`, plus the `IncomingCondition` and `IncomingHitContext` types. Types only — no behavior, no consumer yet. tsc stays green; suite byte-identical.

**Files:**
- Modify: `src/types/abilities.ts`
- Modify: `src/components/skills/abilityDefaults.ts` (two forced exhaustiveness sites — see Step 4)
- Modify: `src/components/skills/AbilityTypePicker.tsx` (one forced exhaustiveness site — see Step 4)

- [ ] **Step 1: Add the two new members to `AbilityType`**

In `src/types/abilities.ts` (the `AbilityType` union, ~line 6-22), add before the closing of the union:
```ts
    | 'incoming-reduction'
    | 'incoming-block'
```

- [ ] **Step 2: Add `IncomingCondition` + `IncomingHitContext` types**

Add near the `ConditionSubject` block (these are deliberately SEPARATE from `ConditionSubject` — they gate against an incoming-hit context, not the attacker-standing `ConditionContext`):
```ts
/** Gate for a victim-side incoming-effect ability (D-PR3). Evaluated against an
 *  IncomingHitContext at the victim apply site — NOT a ConditionSubject (those are
 *  attacker-turn standing facts; these are per-incoming-hit facts). */
export type IncomingCondition =
    | 'self-stealth'                // Voidshade (reduction), Shadowguard (block)
    | 'self-stasis'                 // Nebula Nullifier (Disable folds in here when modeled)
    | 'incoming-crit'              // Hardened set, Iridium
    | 'incoming-crit-by-stealthed' // Hyperion Gaze
    | 'nth-hit-2plus'              // Ironclad (block)
    | 'dot-inferno-corrosion';     // Vortex Veil

/** Per-incoming-hit context assembled by the engine at each victim apply site. */
export interface IncomingHitContext {
    didCrit: boolean;
    attackerStealthed: boolean;
    victimStealthed: boolean;
    victimStasised: boolean;
    /** 1-based direct-damage intake index for this victim this round (Ironclad). */
    hitIndexThisRound: number;
    /** Set only on the DoT-tick path (Vortex Veil). */
    dotType?: 'inferno' | 'corrosion';
}
```

- [ ] **Step 3: Add the two config variants to `AbilityConfig`**

In the `AbilityConfig` union (~line 190-277), add:
```ts
    // D-PR3 victim-side incoming-damage reduction (folded at the crit-aware computation sites).
    | {
          type: 'incoming-reduction';
          scope: 'direct' | 'dot';
          condition: IncomingCondition;
          /** Positive magnitude (percentage points); folded as a reduction into the incoming channel. */
          pct: number;
          /** Grouping ONLY: true → participates in the take-max crit-reduction family; false → additive.
           *  Orthogonal to the gate — the crit gate is enforced by condition='incoming-crit*'. */
          critFamily: boolean;
      }
    // D-PR3 victim-side proc block (rolled at the applyVictimDamage funnel, byDirectDamage only).
    | {
          type: 'incoming-block';
          condition: IncomingCondition;
          /** 0..1 — reuses D-PR1 procChance semantics (deterministic rate-gate). */
          procChance: number;
          /** 0..1 fraction of the hit blocked (1.0 = full block). */
          blockPct: number;
          oncePerRound: boolean;
      }
```

- [ ] **Step 4: Satisfy the three forced editor exhaustiveness sites** (adding to `AbilityType` breaks tsc here — two are `Record`s with NO default branch)

These MUST be updated or tsc fails (verified sites):
- `src/components/skills/abilityDefaults.ts:7` — `makeDefaultConfig(type: AbilityType): AbilityConfig` switch (no default → add two `case`s returning the new config shapes):
  ```ts
      case 'incoming-reduction':
          return { type: 'incoming-reduction', scope: 'direct', condition: 'incoming-crit', pct: 0, critFamily: false };
      case 'incoming-block':
          return { type: 'incoming-block', condition: 'self-stealth', procChance: 0, blockPct: 1, oncePerRound: false };
  ```
- `src/components/skills/abilityDefaults.ts:56` — `DEFAULT_TARGETS: Record<AbilityType, AbilityTarget>` → add two keys: `'incoming-reduction': 'self', 'incoming-block': 'self',`.
- `src/components/skills/AbilityTypePicker.tsx:10` — `TYPE_LABELS: Record<AbilityType, string>` → add two keys: `'incoming-reduction': 'Incoming Reduction', 'incoming-block': 'Incoming Block',`.

(`AbilityCard.tsx`'s `switch (config.type)` HAS a real `default:` returning JSX → no change needed. If any OTHER switch over `AbilityType`/`config.type` surfaces in tsc, add an inert branch.)

- [ ] **Step 5: Verify byte-identical — full suite + lint + tsc**

Run:
```bash
npx vitest run
npm run lint
npx tsc --noEmit
```
Expected: all green; ZERO `.snap` changes (pure type additions + inert editor defaults — these two ability types are never produced by the editor's normal flow, and no engine consumer exists yet).

- [ ] **Step 6: Commit**

```bash
git add src/types/abilities.ts src/components/skills/abilityDefaults.ts src/components/skills/AbilityTypePicker.tsx
git commit -m "feat(combat): D-PR3 — incoming-reduction/incoming-block ability config types + IncomingHitContext"
```

---

## Task 3: Pure evaluators — `incomingEffects.ts`

**Goal:** Two pure functions that fold a victim's incoming-effect abilities given an `IncomingHitContext`. No engine state. This is the load-bearing logic; test it exhaustively.

**Files:**
- Create: `src/utils/combat/incomingEffects.ts`
- Test: `src/utils/combat/__tests__/incomingEffects.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { incomingReductionForHit, incomingBlockForIntake } from '../incomingEffects';
import { Ability, IncomingHitContext } from '../../../types/abilities';

const ctx = (over: Partial<IncomingHitContext> = {}): IncomingHitContext => ({
    didCrit: false, attackerStealthed: false, victimStealthed: false,
    victimStasised: false, hitIndexThisRound: 1, ...over,
});

const reduction = (
    condition: Ability['config'] extends infer C ? string : string,
    pct: number, critFamily: boolean, scope: 'direct' | 'dot' = 'direct'
): Ability => ({
    id: `r-${condition}-${pct}`, type: 'incoming-reduction', target: 'self',
    trigger: 'on-cast', conditions: [],
    config: { type: 'incoming-reduction', scope, condition: condition as never, pct, critFamily },
});

const block = (
    condition: 'self-stealth' | 'nth-hit-2plus', procChance: number,
    blockPct: number, oncePerRound: boolean
): Ability => ({
    id: `b-${condition}`, type: 'incoming-block', target: 'self', trigger: 'on-cast',
    conditions: [],
    config: { type: 'incoming-block', condition, procChance, blockPct, oncePerRound },
});

describe('incomingReductionForHit', () => {
    it('non-crit-family reductions add (Voidshade self-stealth + Nebula self-stasis)', () => {
        const abilities = [reduction('self-stealth', 20, false), reduction('self-stasis', 35, false)];
        expect(incomingReductionForHit(abilities, ctx({ victimStealthed: true, victimStasised: true }))).toBe(55);
    });
    it('self-stealth reduction is inert when not stealthed', () => {
        expect(incomingReductionForHit([reduction('self-stealth', 20, false)], ctx())).toBe(0);
    });
    it('crit-family reductions take the MAX, not the sum (Hardened 5 + Iridium 35 on a crit → 35)', () => {
        const abilities = [reduction('incoming-crit', 5, true), reduction('incoming-crit', 35, true)];
        expect(incomingReductionForHit(abilities, ctx({ didCrit: true }))).toBe(35);
    });
    it('crit-family reductions are inert on a non-crit hit', () => {
        const abilities = [reduction('incoming-crit', 35, true)];
        expect(incomingReductionForHit(abilities, ctx({ didCrit: false }))).toBe(0);
    });
    it('crit-family MAX adds to non-crit-family sum (Voidshade 20 + max(Hardened5,Iridium35)=35 → 55)', () => {
        const abilities = [
            reduction('self-stealth', 20, false),
            reduction('incoming-crit', 5, true),
            reduction('incoming-crit', 35, true),
        ];
        expect(incomingReductionForHit(abilities, ctx({ didCrit: true, victimStealthed: true }))).toBe(55);
    });
    it('Hyperion gates on crit AND attacker-stealthed', () => {
        const a = [reduction('incoming-crit-by-stealthed', 35, true)];
        expect(incomingReductionForHit(a, ctx({ didCrit: true, attackerStealthed: true }))).toBe(35);
        expect(incomingReductionForHit(a, ctx({ didCrit: true, attackerStealthed: false }))).toBe(0);
        expect(incomingReductionForHit(a, ctx({ didCrit: false, attackerStealthed: true }))).toBe(0);
    });
    it('dot-scope reductions apply only on the dot path and ignore direct', () => {
        const a = [reduction('dot-inferno-corrosion', 30, false, 'dot')];
        expect(incomingReductionForHit(a, ctx({ dotType: 'inferno' }))).toBe(30);
        expect(incomingReductionForHit(a, ctx())).toBe(0); // no dotType → not a dot tick
    });
    it('direct-scope reductions never fire on a dot tick', () => {
        const a = [reduction('self-stealth', 20, false)];
        expect(incomingReductionForHit(a, ctx({ victimStealthed: true, dotType: 'corrosion' }))).toBe(0);
    });
});

describe('incomingBlockForIntake', () => {
    const yes = () => true;
    const no = () => false;
    it('Shadowguard full block (self-stealth) → 1.0 when it procs', () => {
        const a = [block('self-stealth', 0.16, 1, true)];
        expect(incomingBlockForIntake(a, ctx({ victimStealthed: true }), yes)).toBe(1);
    });
    it('Shadowguard inert when not stealthed', () => {
        const a = [block('self-stealth', 0.16, 1, true)];
        expect(incomingBlockForIntake(a, ctx({ victimStealthed: false }), yes)).toBe(0);
    });
    it('Ironclad partial block only on the 2nd+ intake', () => {
        const a = [block('nth-hit-2plus', 0.2, 0.5, false)];
        expect(incomingBlockForIntake(a, ctx({ hitIndexThisRound: 1 }), yes)).toBe(0);
        expect(incomingBlockForIntake(a, ctx({ hitIndexThisRound: 2 }), yes)).toBe(0.5);
    });
    it('no block when the roll fails', () => {
        const a = [block('nth-hit-2plus', 0.2, 0.5, false)];
        expect(incomingBlockForIntake(a, ctx({ hitIndexThisRound: 2 }), no)).toBe(0);
    });
    it('full block supersedes partial when both proc', () => {
        const a = [block('self-stealth', 0.16, 1, true), block('nth-hit-2plus', 0.2, 0.5, false)];
        expect(incomingBlockForIntake(a, ctx({ victimStealthed: true, hitIndexThisRound: 2 }), yes)).toBe(1);
    });
    it('returns 0 with no block abilities', () => {
        expect(incomingBlockForIntake([], ctx({ hitIndexThisRound: 2 }), yes)).toBe(0);
    });
});
```

- [ ] **Step 2: Run the tests, verify they fail**

Run: `npx vitest run src/utils/combat/__tests__/incomingEffects.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `incomingEffects.ts`**

```ts
import { Ability, IncomingCondition, IncomingHitContext } from '../../types/abilities';

/** True when an incoming condition is satisfied by the hit context. */
function conditionMet(cond: IncomingCondition, ctx: IncomingHitContext): boolean {
    switch (cond) {
        case 'self-stealth':
            return ctx.victimStealthed;
        case 'self-stasis':
            return ctx.victimStasised;
        case 'incoming-crit':
            return ctx.didCrit;
        case 'incoming-crit-by-stealthed':
            return ctx.didCrit && ctx.attackerStealthed;
        case 'nth-hit-2plus':
            return ctx.hitIndexThisRound >= 2;
        case 'dot-inferno-corrosion':
            return ctx.dotType === 'inferno' || ctx.dotType === 'corrosion';
    }
}

/**
 * Total incoming %-reduction for one hit (D-PR3 §3 composition):
 *   max(applicable crit-family entries) + sum(applicable non-crit-family entries).
 * `scope` must match the hit: 'dot' entries apply only when ctx.dotType is set; 'direct'
 * entries only when it is not. Returns 0 when nothing applies.
 */
export function incomingReductionForHit(
    victimAbilities: Ability[],
    ctx: IncomingHitContext
): number {
    const isDot = ctx.dotType !== undefined;
    let nonCritSum = 0;
    let critFamilyMax = 0;
    for (const a of victimAbilities) {
        if (a.config.type !== 'incoming-reduction') continue;
        const { scope, condition, pct, critFamily } = a.config;
        if ((scope === 'dot') !== isDot) continue;
        if (!conditionMet(condition, ctx)) continue;
        if (critFamily) critFamilyMax = Math.max(critFamilyMax, pct);
        else nonCritSum += pct;
    }
    return nonCritSum + critFamilyMax;
}

/**
 * Blocked fraction (0..1) for one DIRECT-damage intake. Full block (blockPct 1.0)
 * supersedes any partial block. `rollBlock(abilityId, chance)` is the engine-supplied
 * deterministic gate (true = proc). Returns 0 when nothing blocks.
 */
export function incomingBlockForIntake(
    victimAbilities: Ability[],
    ctx: IncomingHitContext,
    rollBlock: (abilityId: string, chance: number) => boolean
): number {
    let best = 0;
    for (const a of victimAbilities) {
        if (a.config.type !== 'incoming-block') continue;
        if (!conditionMet(a.config.condition, ctx)) continue;
        if (!rollBlock(a.id, a.config.procChance)) continue;
        best = Math.max(best, a.config.blockPct);
        if (best >= 1) return 1; // full block — short-circuit
    }
    return best;
}
```

Note on `oncePerRound`: it is enforced by the ENGINE wrapper (the once-flag check is done before calling `rollBlock`, or `rollBlock` returns false once consumed). The evaluator stays pure; see Task 7.

- [ ] **Step 4: Run the tests, verify they pass; lint + tsc; commit**

```bash
npx vitest run src/utils/combat/__tests__/incomingEffects.test.ts
npm run lint && npx tsc --noEmit
git add src/utils/combat/incomingEffects.ts src/utils/combat/__tests__/incomingEffects.test.ts
git commit -m "feat(combat): D-PR3 — pure incoming-effects evaluators (reduction take-max + block)"
```

---

## Task 4: Registry entries — six implants + Hardened set

**Goal:** Emit the six implant `incoming-*` abilities + the Hardened set ability from `buildEquipmentAbilities`.

**Files:**
- Modify: `src/utils/abilities/buildEquipmentAbilities.ts`
- Test: `src/utils/abilities/__tests__/buildEquipmentAbilities.test.ts`

- [ ] **Step 1: Write the failing tests** (mirror the existing `buildForImplant`/gear-set helpers in the file)

```ts
describe('D-PR3 incoming-reduction implants', () => {
    it('Voidshade (legendary) → self-stealth direct reduction 20, non-crit-family', () => {
        const a = buildForImplant('VOIDSHADE', 'legendary')[0];
        expect(a.type).toBe('incoming-reduction');
        expect(a.config).toMatchObject({
            type: 'incoming-reduction', scope: 'direct', condition: 'self-stealth', pct: 20, critFamily: false,
        });
    });
    it('Nebula Nullifier (epic) → self-stasis direct reduction 28', () => {
        expect(buildForImplant('NEBULA_NULLIFIER', 'epic')[0].config).toMatchObject({
            type: 'incoming-reduction', condition: 'self-stasis', pct: 28, critFamily: false,
        });
    });
    it('Hyperion Gaze (legendary) → crit-by-stealthed reduction 35, crit-family', () => {
        expect(buildForImplant('HYPERION_GAZE', 'legendary')[0].config).toMatchObject({
            type: 'incoming-reduction', condition: 'incoming-crit-by-stealthed', pct: 35, critFamily: true,
        });
    });
    it('Vortex Veil (legendary) → dot-scope reduction 30', () => {
        expect(buildForImplant('VORTEX_VEIL', 'legendary')[0].config).toMatchObject({
            type: 'incoming-reduction', scope: 'dot', condition: 'dot-inferno-corrosion', pct: 30, critFamily: false,
        });
    });
});

describe('D-PR3 incoming-block implants', () => {
    it('Ironclad (legendary) → nth-hit-2plus block, chance 0.20 / blockPct 0.50, not once-per-round', () => {
        expect(buildForImplant('IRONCLAD', 'legendary')[0].config).toMatchObject({
            type: 'incoming-block', condition: 'nth-hit-2plus', procChance: 0.2, blockPct: 0.5, oncePerRound: false,
        });
    });
    it('Ironclad has no uncommon variant → no ability', () => {
        expect(buildForImplant('IRONCLAD', 'uncommon')).toEqual([]);
    });
    it('Shadowguard (legendary) → self-stealth full block, chance 0.16 / blockPct 1, once-per-round', () => {
        expect(buildForImplant('SHADOWGUARD', 'legendary')[0].config).toMatchObject({
            type: 'incoming-block', condition: 'self-stealth', procChance: 0.16, blockPct: 1, oncePerRound: true,
        });
    });
});

describe('Hardened gear set', () => {
    it('emits a crit-family direct reduction of 5', () => {
        const a = buildForGearSet('HARDENED')[0]; // helper: ship with >=2 HARDENED pieces
        expect(a.config).toMatchObject({
            type: 'incoming-reduction', scope: 'direct', condition: 'incoming-crit', pct: 5, critFamily: true,
        });
    });
});
```

**NOTE on test helpers:** `buildForImplant`/`buildForGearSet` do NOT exist yet — `buildEquipmentAbilities.test.ts` currently calls `buildEquipmentAbilities(ship, getGearPiece)` inline, and `equipmentCoverage.test.ts` has `implantAbilityCount`/`gearSetAbilityCount` that return COUNTS only. Add two small ARRAY-returning helpers at the top of `buildEquipmentAbilities.test.ts` (mirror the inline ship/piece fixtures already in that file, and the count helpers in `equipmentCoverage.test.ts`):
```ts
function buildForImplant(implantKey: string, rarity: GearPiece['rarity']): Ability[] {
    const id = `${implantKey}-piece`;
    const pieceMap: Record<string, GearPiece> = {
        [id]: makePiece({ id, slot: 'implant_major', rarity, setBonus: implantKey }),
    };
    return buildEquipmentAbilities(makeShip({ implants: { implant_major: id } }), (g) => pieceMap[g]);
}
function buildForGearSet(setKey: string): Ability[] {
    const minPieces = GEAR_SETS[setKey]?.minPieces ?? 2;
    const slots = ['weapon', 'hull', 'sensor', 'engine'] as const;
    const equipment: Record<string, string> = {};
    const pieceMap: Record<string, GearPiece> = {};
    for (let i = 0; i < minPieces; i++) {
        const id = `${setKey}-${i}`;
        equipment[slots[i % slots.length]] = id;
        pieceMap[id] = makePiece({ id, slot: slots[i % slots.length], setBonus: setKey });
    }
    return buildEquipmentAbilities(makeShip({ equipment }), (g) => pieceMap[g]);
}
```
Reuse/copy `makeShip`/`makePiece` from `equipmentCoverage.test.ts` if the file lacks them.

- [ ] **Step 2: Run, verify fail** — `npx vitest run src/utils/abilities/__tests__/buildEquipmentAbilities.test.ts`

- [ ] **Step 3: Add the value maps + registry entries**

In `buildEquipmentAbilities.ts` add per-rarity maps:
```ts
const VOIDSHADE_PCT: Record<string, number> = { common: 4, uncommon: 8, rare: 12, epic: 16, legendary: 20 };
const NEBULA_PCT: Record<string, number> = { common: 7, uncommon: 14, rare: 21, epic: 28, legendary: 35 };
const HYPERION_PCT: Record<string, number> = { common: 7, uncommon: 14, rare: 21, epic: 28, legendary: 35 };
const VORTEX_VEIL_PCT: Record<string, number> = { common: 6, uncommon: 12, rare: 18, epic: 24, legendary: 30 };
const IRONCLAD_BLOCK: Record<string, { chance: number; pct: number }> = {
    common: { chance: 0.1, pct: 0.3 }, rare: { chance: 0.14, pct: 0.4 },
    epic: { chance: 0.16, pct: 0.45 }, legendary: { chance: 0.2, pct: 0.5 },
};
const SHADOWGUARD_CHANCE: Record<string, number> = { uncommon: 0.07, epic: 0.12, legendary: 0.16 };
```

Add to `IMPLANT_ABILITIES` (envelope mirrors existing entries: `target:'self'`, `trigger:'on-cast'`, `conditions:[]`):
```ts
    VOIDSHADE: (rarity) => mkReduction(VOIDSHADE_PCT[rarity], 'direct', 'self-stealth', false),
    NEBULA_NULLIFIER: (rarity) => mkReduction(NEBULA_PCT[rarity], 'direct', 'self-stasis', false),
    HYPERION_GAZE: (rarity) => mkReduction(HYPERION_PCT[rarity], 'direct', 'incoming-crit-by-stealthed', true),
    VORTEX_VEIL: (rarity) => mkReduction(VORTEX_VEIL_PCT[rarity], 'dot', 'dot-inferno-corrosion', false),
    IRONCLAD: (rarity) => {
        const b = IRONCLAD_BLOCK[rarity];
        if (!b) return undefined;
        return {
            type: 'incoming-block', target: 'self', trigger: 'on-cast', conditions: [],
            config: { type: 'incoming-block', condition: 'nth-hit-2plus', procChance: b.chance, blockPct: b.pct, oncePerRound: false },
            autoFilled: true,
        };
    },
    SHADOWGUARD: (rarity) => {
        const chance = SHADOWGUARD_CHANCE[rarity];
        if (chance === undefined) return undefined;
        return {
            type: 'incoming-block', target: 'self', trigger: 'on-cast', conditions: [],
            config: { type: 'incoming-block', condition: 'self-stealth', procChance: chance, blockPct: 1, oncePerRound: true },
            autoFilled: true,
        };
    },
```
where `mkReduction` is a small local helper:
```ts
function mkReduction(
    pct: number | undefined, scope: 'direct' | 'dot', condition: IncomingCondition, critFamily: boolean
): Omit<Ability, 'id'> | undefined {
    if (pct === undefined) return undefined;
    return {
        type: 'incoming-reduction', target: 'self', trigger: 'on-cast', conditions: [],
        config: { type: 'incoming-reduction', scope, condition, pct, critFamily },
        autoFilled: true,
    };
}
```
Import `IncomingCondition` from `../../types/abilities`.

Add the Hardened entry to `GEAR_SET_ABILITIES`:
```ts
    HARDENED: () => ({
        type: 'incoming-reduction', target: 'self', trigger: 'on-cast', conditions: [],
        config: { type: 'incoming-reduction', scope: 'direct', condition: 'incoming-crit', pct: 5, critFamily: true },
        autoFilled: true,
    }),
```

- [ ] **Step 4: Run tests, verify pass; lint + tsc; commit**

```bash
npx vitest run src/utils/abilities/__tests__/buildEquipmentAbilities.test.ts
npm run lint && npx tsc --noEmit
git add src/utils/abilities/buildEquipmentAbilities.ts src/utils/abilities/__tests__/buildEquipmentAbilities.test.ts
git commit -m "feat(combat): D-PR3 — incoming-reduction/block registry entries (6 implants + Hardened set)"
```

---

## Task 5: Iridium parser rule — "takes N% less damage from Critical hits"

**Goal:** A `skillTextParser` rule that emits an `incoming-reduction { scope:'direct', condition:'incoming-crit', pct:N, critFamily:true }` for the Iridium phrasing, plumbed through `buildShipAbilities` onto the passive slot. Lights up Iridium only.

**Files:**
- Modify: `src/utils/abilities/buildShipAbilities.ts` (BOTH `parseModifiers` at line 309 AND the modifier-emission loop at ~1244 live HERE — NOT in `skillTextParser.ts`, whose only "less damage" hit is a comment ~line 272)
- Test: `src/utils/abilities/__tests__/buildShipAbilities.test.ts`
- (Confirm whether `skillTextParser.ts` needs touching at all — it likely does not.)

- [ ] **Step 1: Characterize the existing parser/builder seam**

Read `parseModifiers` (`buildShipAbilities.ts:309`) and the modifier-emission loop (`buildShipAbilities.ts:1244`) — both in `buildShipAbilities.ts`. Reuse the file's masking/sentence-scope helpers. Decide the cleanest emission point: either (a) extend `parseModifiers` to return a new parsed-incoming-reduction descriptor that the 1244 loop maps to an `incoming-reduction` ability, or (b) a dedicated detector emitted alongside modifiers onto the passive slot. Mirror how D-PR2's passive `outgoingDamage` modifiers flow. Record the chosen seam in the commit body.

- [ ] **Step 2: Write the failing tests**

Parser test (`skillTextParser.test.ts`):
```ts
it('parses "takes 35% less damage from Critical hits" → incoming crit reduction 35', () => {
    // assert whatever the chosen descriptor shape is (e.g. parseModifiers output, or a new field)
});
it('does not match non-crit "less damage" phrasings', () => { /* negative */ });
```
Builder test (`buildShipAbilities.test.ts`):
```ts
it('Iridium passive emits an incoming-reduction crit-family ability (35)', () => {
    const abilities = buildShipAbilities(iridiumShip).slots.find((s) => s.slot === 'passive')!.abilities;
    const r = abilities.find((a) => a.config.type === 'incoming-reduction');
    expect(r?.config).toMatchObject({ type: 'incoming-reduction', scope: 'direct', condition: 'incoming-crit', pct: 35, critFamily: true });
});
```
Build `iridiumShip` from the real Iridium skill text (use the existing test ship-builder; Iridium already appears in `buildShipAbilities.test.ts`).

- [ ] **Step 3: Run, verify fail**

- [ ] **Step 4: Implement the parser rule + builder mapping**

Add a regex like `/takes\s+(\d+)%\s+less\s+damage\s+from\s+critical\s+hits/i` (sentence-scoped, mirror the existing parser masking helpers). Emit the descriptor; map it in `buildShipAbilities` to the `incoming-reduction` ability with `critFamily:true`. Keep it confined so it touches no other ship (only Iridium matches — Task 1 confirmed).

- [ ] **Step 5: Run tests, verify pass**

- [ ] **Step 6: Skill audit + byte-identical gate**

```bash
npm run audit:skills          # expect 141 ships / 0 findings
npx vitest run                # expect green; re-check any Iridium unit test flagged in Task 1
npm run lint && npx tsc --noEmit
```
If an Iridium-referencing combat unit test (e.g. `purgeConditionalSources.test.ts`) changes damage because Iridium now reduces a crit it takes: that is EXPECTED behaviour change — audit the new numbers and update the test deliberately (never `-u`; these are non-golden `expect` assertions). Note it in the commit body.

- [ ] **Step 7: Commit**

```bash
git add src/utils/abilities/buildShipAbilities.ts src/utils/abilities/__tests__/buildShipAbilities.test.ts
git commit -m "feat(combat): D-PR3 — parse Iridium 'takes N% less damage from Critical hits' → incoming-reduction"
```

---

## Task 6: Engine — victim incoming-ability lookup + %-reduction at the positional path

**Goal:** Build a side-agnostic per-combat lookup of each actor's incoming-* abilities, and wire `incomingReductionForHit` into the positional per-sub-hit path (`victimHitDamage`).

**Files:**
- Modify: `src/utils/combat/victimDamage.ts` (signature)
- Modify: `src/utils/combat/positionalApply.ts` (per-hit reduction callback)
- Modify: `src/utils/combat/engine.ts` (lookup + closure)
- Test: `src/utils/combat/__tests__/victimDamage.test.ts` (or the nearest existing) + an integration test (Task added below)

- [ ] **Step 1: Add `equipReductionPct` to `victimHitDamage` (TDD)**

Write a unit test asserting that passing `equipReductionPct` folds additively into the incoming term and defaults to 0 (byte-identical). Then change the signature:
```ts
export function victimHitDamage(
    s: AttackerDamageScalars,
    v: VictimDefenseProfile,
    didCrit: boolean,
    roleScale: number,
    equipReductionPct = 0,   // D-PR3: victim-side incoming %-reduction (this hit)
): number {
```
and fold it into the `incoming` term (`victimDamage.ts:96`):
```ts
    const incoming = (v.incomingDamageModifierPct ?? s.incomingDamageModifierPct) - equipReductionPct;
```
Default 0 → byte-identical. Run the existing `victimDamage`/positional parity tests to confirm no movement.

- [ ] **Step 2: Add a per-hit reduction callback to `applyPositionalDamage`**

In `positionalApply.ts`, add to the args object:
```ts
    incomingReductionFor?: (victim: CombatActor, didCrit: boolean) => number;
```
and at the call site (`:161`):
```ts
    const equipReductionPct = args.incomingReductionFor?.(victim, didCrit) ?? 0;
    const dmg = victimHitDamage(scalars, defenseProfileOf(victim), didCrit, roleScale, equipReductionPct);
```
Unsupplied → 0 → byte-identical. Add a unit test that the callback is threaded through.

- [ ] **Step 3: Build the side-agnostic incoming-ability lookup in the engine**

In `engine.ts`, after both runtime maps exist (`runtimesById` ~2021, `enemyPlayerRuntimeByActorId` ~1649), build a per-combat map of each actor's incoming-* abilities. Read the passive-slot abilities exactly like the D-PR1 standing-leech precedent at `engine.ts:2041-2043` — `rt.castSkills.slots`, filtered to `slot.slot === 'passive'`:
```ts
// D-PR3: per-actor victim-side incoming-effect abilities (incoming-reduction + incoming-block),
// side-agnostic (a ship defends on either team). Built once; empty for actors without equipment.
const incomingAbilitiesById = new Map<string, Ability[]>();
for (const rt of [...runtimesById.values(), ...enemyPlayerRuntimeByActorId.values()]) {
    if (incomingAbilitiesById.has(rt.actor.id)) continue; // dedupe if an actor is in both maps
    const incoming: Ability[] = [];
    for (const slot of rt.castSkills.slots) {
        if (slot.slot !== 'passive') continue;
        for (const a of slot.abilities) {
            if (a.config.type === 'incoming-reduction' || a.config.type === 'incoming-block') {
                incoming.push(a);
            }
        }
    }
    if (incoming.length) incomingAbilitiesById.set(rt.actor.id, incoming);
}
const incomingAbilitiesOf = (id: string): Ability[] => incomingAbilitiesById.get(id) ?? [];
```
(Confirm `rt.castSkills.slots` against the 2041-2043 loop at impl time. The incoming-* abilities survive `partitionReactiveAbilities` because `on-cast` + these types are not in `LIVE_TRIGGERS`/`REACTIVE_ABILITY_TYPES`, so they stay on the passive slot.)

- [ ] **Step 4: Supply `incomingReductionFor` at the three `drivePositionalApply` sites**

In `drivePositionalApply` (~`engine.ts:2683`), pass:
```ts
    incomingReductionFor: (victim, didCrit) =>
        incomingReductionForHit(incomingAbilitiesOf(victim.id), {
            didCrit,
            attackerStealthed: isStealthed(args.actingId),       // reuse the Phase-3 stealth query
            victimStealthed: isStealthed(victim.id),
            victimStasised: isStasised(victim.id),
            hitIndexThisRound: 0,    // unused by reduction (only block reads it)
        }),
```
`isStealthed(id)` = a small helper over `selfBuffNamesForOwners(statusEngine,[id]).includes('Stealth')` (or the Phase-3 `buildForcedTargetingStatus` seam). `isStasised` already exists at this scope. Import `incomingReductionForHit`.

- [ ] **Step 5: Integration test (positional) via `simulateBattle`/`runCombat`**

New test `src/utils/combat/__tests__/incomingReductionEngine.test.ts`: a victim with Voidshade takes less direct damage while stealthed than without; Hyperion reduces only on a crit by a stealthed attacker. Mirror the D-PR1/PR2 engine integration harness. Keep RNG deterministic.

- [ ] **Step 6: Byte-identical gate + commit**

```bash
npx vitest run
npm run lint && npx tsc --noEmit
git status --porcelain | grep '\.snap' && echo "SNAP MOVED — STOP" || echo "no snap movement"
git add -A
git commit -m "feat(combat): D-PR3 — fold victim incoming %-reduction into the positional damage path"
```

---

## Task 7: Engine — proc block at the `applyVictimDamage` funnel

**Goal:** Roll `incomingBlockForIntake` for direct-damage intakes, reducing the hit before shield/HP. Per-victim-per-round direct-intake counter + once-per-round flags. Reuses `procChanceGates`.

**Files:**
- Modify: `src/utils/combat/engine.ts` (`applyVictimDamage` ~2445; per-round state; gate plumbing)
- Test: integration test (extend Task 6's engine test file or a new one)

- [ ] **Step 1: Add per-round block state (reset each round)**

Inside the round loop (near `roundDamage` ~`engine.ts:2343`, created fresh per round):
```ts
// D-PR3: per-victim direct-damage intake index (Ironclad nth-hit) + once-per-round block flags.
const directIntakeIndex = new Map<string, number>();
const blockOnceConsumed = new Set<string>(); // key `${victimId}:${abilityId}`
```
`procChanceGates` (combat-lifetime, `engine.ts:1860`) is reused as-is for the roll accumulator.

- [ ] **Step 2: Insert the block step into `applyVictimDamage` (TDD via integration test first)**

Write the integration test (Step 4) first, watch it fail, then implement. In `applyVictimDamage` (`engine.ts:2445`):
- Hoist the `carriesBarrier` computation (currently ~2475) to BEFORE `sink.addIncoming` (~2455) — byte-identical (same value, computed earlier).
- Immediately after computing `carriesBarrier` and BEFORE `sink.addIncoming`, add:
```ts
// D-PR3: proc block on DIRECT damage only, when not fully Barrier-immune. Reduces the hit
// before it is recorded/absorbed (silent reduction — no separate surface this PR).
if (cause?.byDirectDamage && !carriesBarrier) {
    const blockAbilities = incomingAbilitiesOf(victim.id).filter(
        (a) => a.config.type === 'incoming-block'
    );
    if (blockAbilities.length > 0) {
        const idx = (directIntakeIndex.get(victim.id) ?? 0) + 1;
        directIntakeIndex.set(victim.id, idx);
        const blocked = incomingBlockForIntake(
            blockAbilities,
            {
                didCrit: false, attackerStealthed: false,
                victimStealthed: isStealthed(victim.id),
                victimStasised: isStasised(victim.id),
                hitIndexThisRound: idx,
            },
            (abilityId, chance) => {
                // once-per-round guard (Shadowguard): consume at most once.
                const cfg = blockAbilities.find((b) => b.id === abilityId)?.config;
                const onceKey = `${victim.id}:${abilityId}`;
                if (cfg?.type === 'incoming-block' && cfg.oncePerRound && blockOnceConsumed.has(onceKey)) {
                    return false;
                }
                const gateKey = `${victim.id}:${abilityId}`;
                let gate = procChanceGates.get(gateKey);
                if (!gate) { gate = makeRateGate(); procChanceGates.set(gateKey, gate); }
                const proc = gate(chance);   // confirm makeRateGate's call shape at impl time
                if (proc && cfg?.type === 'incoming-block' && cfg.oncePerRound) blockOnceConsumed.add(onceKey);
                return proc;
            }
        );
        damage = damage * (1 - blocked);
    }
}
```
IMPORTANT: only touch `directIntakeIndex`/roll when the victim has ≥1 block ability → fully inert (byte-identical) otherwise. `damage` must be a `let`. Confirm `makeRateGate`'s exact API (`gate(chance)` vs `gate.next(chance)`) against `rateAccumulator.ts` and the D-PR1 usage in `triggers.ts`.
- Then the existing `sink.addIncoming(damage, ...)` records the reduced amount; the existing `carriesBarrier` branch reuses the hoisted value.

- [ ] **Step 3: Decide the Barrier/counter interaction** (spec §7)

A fully-Barrier-immune intake should NOT advance `directIntakeIndex` (nothing was "damaged") and must NOT roll — the `!carriesBarrier` guard above already handles both. Confirm and add a test that a barriered round doesn't advance Ironclad's counter.

- [ ] **Step 4: Integration tests**

- Ironclad: 1st direct intake unblocked; 2nd+ rolls; with a forced-proc gate, the 2nd intake's HP damage is reduced by blockPct. Use a 2-enemy setup so the victim takes 2 attacks in a round.
- Shadowguard: while stealthed, one intake is fully blocked (HP unchanged); a 2nd intake in the same round is NOT blocked again (once-per-round).
- Byte-identical: a victim with no block ability is unaffected.

To force deterministic procs in tests, prefer a high `procChance` that the rate-gate guarantees on the first eligible roll, or expose a test seam mirroring existing `__testTap*` hooks if needed.

- [ ] **Step 5: Byte-identical gate + commit**

```bash
npx vitest run
npm run lint && npx tsc --noEmit
git status --porcelain | grep '\.snap' && echo "SNAP MOVED — STOP" || echo "no snap movement"
git add -A
git commit -m "feat(combat): D-PR3 — proc block (Ironclad/Shadowguard) at the applyVictimDamage funnel"
```

---

## Task 8: Engine — DoT-tick reduction (Vortex Veil)

**Goal:** Reduce inferno/corrosion tick damage on a carrier that has Vortex Veil.

**Files:**
- Modify: `src/utils/combat/engine.ts` (`tickDoTs` ~723 + its call site)
- Test: extend the engine integration test

- [ ] **Step 1: Add an optional per-type reduction to `tickDoTs`**

Add to the `tickDoTs` args:
```ts
    incomingDotReductionPct?: (dotType: 'corrosion' | 'inferno') => number;
```
and scale each accumulated tick by `(1 - pct/100)` before `emitTicked`/`credit` (the corrosion sum ~734-737 and inferno sum ~747). Default (absent) → 0 → byte-identical.

- [ ] **Step 2: Supply it at the call site**

At the `tickDoTs({...})` invocation (the tank/per-carrier DoT-tick site), pass:
```ts
    incomingDotReductionPct: () =>
        incomingReductionForHit(incomingAbilitiesOf(<carrierId>), {
            didCrit: false, attackerStealthed: false,
            victimStealthed: false, victimStasised: false, hitIndexThisRound: 0,
            dotType: 'inferno',   // dotType just needs to be inferno|corrosion to satisfy the dot-scope gate
        }),
```
(Vortex Veil's reduction is identical for inferno and corrosion, so a single value suffices; pass the carrier's id.) Confirm the carrier id in scope at the call site.

- [ ] **Step 3: Integration test + gate + commit**

A carrier with Vortex Veil takes reduced inferno/corrosion ticks vs without. Byte-identical otherwise.
```bash
npx vitest run && npm run lint && npx tsc --noEmit
git status --porcelain | grep '\.snap' && echo "SNAP MOVED — STOP" || echo "no snap movement"
git add -A
git commit -m "feat(combat): D-PR3 — Vortex Veil reduces inferno/corrosion DoT-tick damage"
```

---

## Task 9: Engine — %-reduction at the aggregate path (Iridium-as-tank)

**Goal:** Apply crit-family %-reduction (and non-crit reductions) in the non-positional damage path so Iridium's 35% crit-reduction works for a healing-calc tank. This is the most invasive task; it threads the target's incoming-reduction into `runPlayerTurn`. If threading proves disproportionately invasive, this is the single deferrable piece (the positional path already covers Iridium in the sim) — surface to the human before deferring.

**Files:**
- Modify: `src/utils/combat/playerTurn.ts` (aggregate `nonCritFactor`/`damageCritMultiplier` ~1295-1305; `PlayerTurnArgs`)
- Modify: `src/utils/combat/engine.ts` (supply the target's reduction at the enemy-attack `runPlayerTurn` call)
- Test: a healing-mode / aggregate integration test with Iridium as the bound target

- [ ] **Step 1: Add optional reduction inputs to `PlayerTurnArgs`**

```ts
    /** D-PR3: victim-side incoming %-reduction against the bound target.
     *  nonCrit = reductions that apply to ALL hits (Voidshade/Nebula); critFamilyMax = the
     *  take-max crit-family reduction applied to the crit fraction only (Iridium/Hardened/Hyperion).
     *  Both default 0 → byte-identical. */
    incomingReductionNonCritPct?: number;
    incomingReductionCritFamilyPct?: number;
```

- [ ] **Step 2: Fold them into the aggregate factors** (`playerTurn.ts` ~1295-1305)

```ts
    const equipNonCrit = args.incomingReductionNonCritPct ?? 0;
    const R = args.incomingReductionCritFamilyPct ?? 0;
    const damageCritMultiplier =
        (1 - critFraction) + critFraction * (1 + effectiveCritDamage / 100) * (1 - R / 100);
    // ...
    const nonCritFactor =
        (1 - damageReduction / 100) *
        (1 + dmgStats.totals.outgoingDamageBuff / 100) *
        (1 + (incomingDamageModifier - equipNonCrit) / 100) *
        affinityMult;
```
Default 0,0 → identical to today. Add a unit test pinning the crit-split: `R=35`, `critFraction=1` → crit hit reduced 35%; `critFraction=0` → unchanged.

- [ ] **Step 3: Supply from the engine at the enemy-attack `runPlayerTurn`**

At the enemy turn's `runPlayerTurn` bind (where the enemy attacks `tgt`/`healTarget`), compute from the target's incoming-reduction abilities:
```ts
const tgtAbilities = incomingAbilitiesOf(tgt.id);
const incomingReductionNonCritPct = incomingReductionForHit(tgtAbilities, {
    didCrit: false, attackerStealthed: isStealthed(actor.id),
    victimStealthed: isStealthed(tgt.id), victimStasised: isStasised(tgt.id), hitIndexThisRound: 0,
});
const critAll = incomingReductionForHit(tgtAbilities, {
    didCrit: true, attackerStealthed: isStealthed(actor.id),
    victimStealthed: isStealthed(tgt.id), victimStasised: isStasised(tgt.id), hitIndexThisRound: 0,
});
const incomingReductionCritFamilyPct = critAll - incomingReductionNonCritPct;
```
Pass both into the `runPlayerTurn` args. Guard so this only computes when `tgtAbilities` is non-empty (byte-identical otherwise). NOTE: this path is the enemy attacking a PLAYER target; confirm the same wiring is symmetric for the player-attacks-enemy non-positional path if one exists (DPS mode never has the attacker as victim, so likely only the enemy-attack bind needs it).

- [ ] **Step 4: Integration test (aggregate)**

Iridium as the bound (non-positional) heal target takes 35% less from a crit; full damage from a non-crit. Mirror the healing-engine adapter test harness.

- [ ] **Step 5: Byte-identical gate + commit**

```bash
npx vitest run && npm run lint && npx tsc --noEmit
git status --porcelain | grep '\.snap' && echo "SNAP MOVED — STOP" || echo "no snap movement"
git add -A
git commit -m "feat(combat): D-PR3 — crit-family incoming reduction in the aggregate path (Iridium-as-tank)"
```

---

## Task 10: Update the equipment coverage tracker

**Goal:** Reflect the seven newly-implemented equipment effects. (Iridium is a ship skill — NOT an equipment-coverage entry.)

**Files:**
- Modify: `src/utils/abilities/__tests__/equipmentCoverage.test.ts`

- [ ] **Step 1: Update the implemented-sets + implemented-implants assertions**

```ts
expect(implementedSets).toEqual(['LEECH', 'HARDENED']); // LEECH(~85) precedes HARDENED(~210) in gearSets.ts
// IMPLANTS DECLARATION order (verified via grep — NOT grouped new-before-old):
expect(implementedImplants).toEqual([
    'ARCANE_SIEGE', 'HYPERION_GAZE', 'INTRUSION', 'NEBULA_NULLIFIER', 'VOIDSHADE',
    'VORTEX_VEIL', 'WARPSTRIKE', 'BLOODTHIRST', 'IRONCLAD', 'SHADOWGUARD',
]);
```
Re-confirm with `grep -n "^    [A-Z_]*: {" src/constants/implants.ts` (the assertion follows `Object.keys(IMPLANTS).filter(...)` order).

- [ ] **Step 2: Move the seven effects out of the "produces 0 abilities" loops**

Extend `implementedImplants` Set + the `nonLeechSets` exclusion to include HARDENED; add positive per-effect assertions (1 ability each, respecting sparse rarities for Ironclad/Shadowguard). Update the file header comment ("D-PR3 adds the incoming-reduction family").

- [ ] **Step 3: Run, verify pass; commit**

```bash
npx vitest run src/utils/abilities/__tests__/equipmentCoverage.test.ts
git add src/utils/abilities/__tests__/equipmentCoverage.test.ts
git commit -m "test(combat): D-PR3 — coverage tracker includes the incoming-reduction family"
```

---

## Task 11: Changelog + in-app docs

**Files:**
- Modify: `src/constants/changelog.ts` (`UNRELEASED_CHANGES`)
- Modify: `src/pages/DocumentationPage.tsx` (if it lists modeled equipment effects)

- [ ] **Step 1: Add an `UNRELEASED_CHANGES` entry**

Plain-English, e.g.:
```
The combat simulator now models conditional damage-reduction implants and gear sets: Voidshade and Shadowguard (while stealthed), Nebula Nullifier (while in Stasis), Hyperion Gaze and the Hardened set and Iridium's passive (against critical hits), Vortex Veil (against Inferno/Corrosion), and Ironclad (chance to block repeat hits). Equipped ships now take reduced damage when these conditions are met.
```

- [ ] **Step 2: Extend `DocumentationPage` if it documents modeled equipment effects** (grep for the D-PR1/PR2 mention; extend or skip).

- [ ] **Step 3: Commit**

```bash
git add src/constants/changelog.ts src/pages/DocumentationPage.tsx
git commit -m "docs(combat): D-PR3 — changelog + docs for incoming-reduction implants/sets"
```

---

## Task 12: Final verification gate + memory

- [ ] **Step 1: Full suite** — `npx vitest run` (green; count = D-PR2 baseline 2808 + new tests).
- [ ] **Step 2: Lint + tsc + audit** — `npm run lint && npx tsc --noEmit && npm run audit:skills` (lint 0; tsc clean; audit 141/0).
- [ ] **Step 3: Confirm zero golden movement** — `git diff --stat <D-PR2 tip 21c6fc33> -- '*.snap'` → empty.
- [ ] **Step 4: Update project memory** — append D-PR3 shipped facts to `project_combat_realism_epic.md`: the victim-side incoming-effects model, the three apply sites (positional victimHitDamage / aggregate playerTurn / applyVictimDamage funnel for block / tickDoTs for Vortex Veil), composition (additive + take-max crit family), Iridium parser rule, and remaining D buckets.

---

## Done criteria

- All seven equipment effects + Iridium emit `incoming-reduction`/`incoming-block` abilities and the engine consumes them: %-reduction folds into the incoming channel (positional + aggregate + DoT), block rolls at the funnel for both damage paths.
- Composition matches the spec (additive; take-max within the crit-reduction family; crit-gated entries inert on non-crit hits).
- Coverage tracker + unit + integration tests green; `audit:skills` 141/0.
- All DPS / battle-sim / healing goldens byte-identical.
- Changelog + docs updated.
