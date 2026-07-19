# Interaction / Emergent Combat Audit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a deterministic fuzzing + invariant/differential/ablation audit harness that hunts multi-ship interaction bugs the single-ship ship-kit correctness epic could not see, emitting a triageable ledger and a permanent regression gate.

**Architecture:** Pure oracle/fuzzer logic lives in `src/utils/combat/audit/` (so the `src` regression test imports it directly — no `src → scripts` dependency). A thin CLI in `scripts/` loads `docs/ship-data.json`, drives the pure modules, and writes the ledger. Every battle runs through `simulateBattle` **wrapped by a seeded RNG** (`runSeededBattle`): production combat draws crit/hit/landing from `Math.random` via `rateAccumulator`, so the harness installs a fixed seed (`setupKeyedTestRng(seed)`) around each run and resets after — making runs byte-reproducible so cross-run diffs are exact.

> **CORRECTION (discovered during Task 3):** The design spec's "no `Math.random`, engine is deterministic" enabling fact was WRONG. `rateAccumulator.ts:18` is `let rng = Math.random` — production combat is genuinely random. Determinism is achievable ONLY by pinning the engine's existing seed seams. This is why `runSeededBattle` exists and every oracle uses it instead of raw `simulateBattle`.

**Tech Stack:** TypeScript, Vitest (`npm test`), `tsx` (script runner), the existing combat engine (`simulateBattle`).

## Global Constraints

- **Determinism via seeding (CORRECTED):** production combat uses `Math.random` (via `rateAccumulator.ts`), so every battle MUST run through `runSeededBattle(input, seed)` — which calls `setupKeyedTestRng(seed)` before `simulateBattle` and `resetRateGateRng()` after (try/finally). Same seed → byte-identical result (verified). Harness code itself uses no `Math.random`/`Date.now()`/argless `new Date()`. **Reuse the engine's existing `mulberry32` and seed seams from `src/utils/calculators/rateAccumulator.ts`** — do NOT hand-roll a second PRNG the engine never consults.
- **No ground truth:** Oracles assert internal-consistency invariants and cross-run diffs ONLY. No magnitude/expected-number checks.
- **Reuse, don't reinvent:** `simulateBattle(input: BattleSimulationInput): BattleResult` (`src/utils/calculators/battleSimulator.ts:774`); `buildShipAbilities` for tagging; `collectActorEntryKinds` semantics for fingerprints; ledger format mirrors `docs/ship-kit-correctness-ledger.{json,md}`.
- **Canonical stats only:** every ship instantiated at level-60 base stats via `statOverrides` from `ship.baseStats` (the `traceScenario.placement()` pattern). No gear/refit/engineering fuzzing.
- **Dependency injection for ship roster:** pure modules never read the filesystem. The CLI and the regression test both pass a `Ship[]` roster in.
- **Focus-actor convention:** `simulateBattle` assigns `playerTeam[0]` the reserved id `'attacker'`; all others get `p:<shipId>:<idx>` / `e:<shipId>:<idx>`. Fingerprints resolve a ship's actorId via `result.roster`, never by assuming `'attacker'`.
- **Protection caveat (verbatim from `ShipRoundState.damageDealt` docstring):** per-round `Σ damageDealt` == per-victim `Σ damageTaken` **by construction, EXCEPT** under an active Protection redirect (protector's credited chunk is a diverted portion, double-counted) and redirected DoT-tick batches. The conservation invariant must exempt rounds containing a Protection redirect.
- **Workflow:** full `npm test` is the golden audit; never `vitest -u`. `gh auth switch --user TheSusort` before PR ops. Worktrees need the gitignored `.env` copied in.

---

## File Structure

```
src/utils/combat/audit/
  ├── types.ts          # shared harness types (InteractionClass, InvariantViolation, Finding, …)
  ├── fixtures.ts       # canonicalPlacement(ship, position) — level-60 base-stat BattlePlacement
  ├── seededBattle.ts   # runSeededBattle(input, seed) — setupKeyedTestRng→simulateBattle→reset; the ONLY way oracles run battles
  ├── classes.ts        # tagShip(ship): Set<InteractionClass> — derived from buildShipAbilities
  ├── invariants.ts     # checkInvariants(input, result): InvariantViolation[] — pure result-inspecting only
  ├── reproducibility.ts # checkReproducibility(input, seed) — two seeded runs must match (needs the runner, not a pure result check)
  ├── fingerprint.ts    # fingerprintActor(result, actorId) + diffFingerprints + runDifferential
  ├── ablation.ts       # runAblation(a, b, rosterById): AblationResult
  ├── compose.ts        # composeBattle(seed, pools): BattleSimulationInput — reuses mulberry32 from rateAccumulator
  ├── minimize.ts       # minimizeComposition(input, stillFails): BattleSimulationInput
  └── __tests__/        # one *.test.ts per module above
src/utils/combat/__tests__/interactionInvariants.integration.test.ts   # permanent seeded gate
scripts/lib/interactionLedger.ts   # writeLedger(findings, meta) — Node fs, json + md
scripts/auditInteractions.ts       # CLI entry: npm run audit:interactions -- --seed N --count M
```

Reference types (already defined — do NOT redefine): `BattleSimulationInput`, `BattlePlacement`, `BattleResult`, `BattleRound`, `ShipRoundState` (all in `src/utils/calculators/battleSimulator.ts`); `Ship`, `AffinityName` (`src/types/ship`); `Position` (`src/types/encounters`); `CombatLogEntryKind`, `CombatLogRound`, `CombatLogEntry` (`src/utils/combat/log/types.ts`).

---

## Task 1: Shared types + canonical placement builder

**Files:**
- Create: `src/utils/combat/audit/types.ts`
- Create: `src/utils/combat/audit/fixtures.ts`
- Test: `src/utils/combat/audit/__tests__/fixtures.test.ts`

**Interfaces:**
- Produces: `InteractionClass` (union), `InvariantViolation`, `AblationResult`, `Finding` types; `canonicalPlacement(ship: Ship, position: Position): BattlePlacement`.

- [ ] **Step 1: Write shared types**

Create `src/utils/combat/audit/types.ts`:

```typescript
import type { Position } from '../../../types/encounters';
import type { CombatLogEntryKind } from '../log/types';

export type InteractionClass =
    | 'leader-aura'
    | 'reactive-trigger'
    | 'persistent-stacking'
    | 'detonation-bomb'
    | 'protection-redirect'
    | 'cleanse-purge'
    | 'control'
    | 'shield'
    | 'stealth';

export type OracleKind = 'invariant' | 'differential' | 'ablation';

export interface InvariantViolation {
    /** Stable id of the invariant, e.g. 'hp-bounds'. */
    invariant: string;
    /** Round the violation was observed in (0 for whole-battle invariants). */
    round: number;
    actorId?: string;
    detail: string;
}

export interface FingerprintDiff {
    actorId: string;
    shipName: string;
    /** Log-kinds the ship produced solo but NOT in composition (suppressed). */
    missingInComposition: CombatLogEntryKind[];
    /** Log-kinds the ship produced in composition but NEVER solo (spurious). */
    extraInComposition: CombatLogEntryKind[];
}

export interface AblationResult {
    /** True when {A+B} per-actor fingerprint is NOT explained by {A}∪{B}. */
    diverges: boolean;
    detail: string;
}

export interface Finding {
    oracle: OracleKind;
    ships: string[];
    slots: Position[];
    seed: number;
    /** Populated per-oracle: invariant id, or fingerprint diff, or ablation detail. */
    invariant?: string;
    fingerprintDiff?: FingerprintDiff;
    ablationDetail?: string;
    minimalRepro?: { playerShips: string[]; enemyShips: string[] };
    severity: 'high' | 'med' | 'low';
}
```

- [ ] **Step 2: Write the failing test for `canonicalPlacement`**

Create `src/utils/combat/audit/__tests__/fixtures.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { canonicalPlacement } from '../fixtures';
import type { Ship } from '../../../../types/ship';

const makeShip = (): Ship =>
    ({
        id: 'test-ship',
        name: 'TestShip',
        type: 'ATTACKER',
        faction: 'TERRAN',
        affinity: 'chemical',
        rarity: 'legendary',
        baseStats: {
            attack: 1800,
            hp: 90000,
            defence: 3000,
            crit: 40,
            critDamage: 120,
            hacking: 80,
            security: 100,
            speed: 110,
        },
    }) as unknown as Ship;

describe('canonicalPlacement', () => {
    it('builds a placement at the ship base stats in the given slot', () => {
        const p = canonicalPlacement(makeShip(), 'T1');
        expect(p.position).toBe('T1');
        expect(p.ship.id).toBe('test-ship');
        expect(p.statOverrides?.attack).toBe(1800);
        expect(p.statOverrides?.hp).toBe(90000);
        expect(p.statOverrides?.speed).toBe(110);
    });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest --run src/utils/combat/audit/__tests__/fixtures.test.ts`
Expected: FAIL — cannot find module `../fixtures`.

- [ ] **Step 4: Implement `canonicalPlacement`**

Create `src/utils/combat/audit/fixtures.ts` (mirrors `traceScenario.ts`'s `placement()`, but stat fields come straight from `ship.baseStats`):

```typescript
import type { Ship } from '../../../types/ship';
import type { Position } from '../../../types/encounters';
import type { BattlePlacement } from '../../calculators/battleSimulator';

/** A BattlePlacement pinned to the ship's un-modified level-60 base stats.
 *  No gear/refit/engineering — we audit interactions, not stat math. */
export function canonicalPlacement(ship: Ship, position: Position): BattlePlacement {
    const b = ship.baseStats;
    return {
        ship,
        position,
        statOverrides: {
            attack: b.attack,
            crit: b.crit,
            critDamage: b.critDamage,
            hacking: b.hacking,
            security: b.security,
            defence: b.defence,
            hp: b.hp,
            speed: b.speed,
        },
    };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest --run src/utils/combat/audit/__tests__/fixtures.test.ts`
Expected: PASS (1 test).

- [ ] **Step 6: Commit**

```bash
git add src/utils/combat/audit/types.ts src/utils/combat/audit/fixtures.ts src/utils/combat/audit/__tests__/fixtures.test.ts
git commit -m "feat(interaction-audit): shared types + canonical placement builder"
```

---

## Task 2: Interaction-class tagging

**Files:**
- Create: `src/utils/combat/audit/classes.ts`
- Test: `src/utils/combat/audit/__tests__/classes.test.ts`

**Interfaces:**
- Consumes: `InteractionClass` (Task 1); `buildShipAbilities` (existing).
- Produces: `tagShip(ship: Ship): Set<InteractionClass>`.

**Note for implementer:** find the real export path and return shape of `buildShipAbilities` before writing (`grep -rn "export function buildShipAbilities\|export const buildShipAbilities" src`). The abilities carry `type` (`'buff' | 'debuff' | 'heal' | 'shield' | 'control' | 'cleanse' | 'purge' | 'detonation' | …`), a `trigger`/reactive marker, and target metadata. Map ability shapes → classes. Below is the mapping logic; adapt the property reads to the real Ability type.

- [ ] **Step 1: Write the failing test**

Create `src/utils/combat/audit/__tests__/classes.test.ts`. Use two REAL ships from `docs/ship-data.json` + `docs/ship-skills.csv` whose classes are unambiguous — pick at authoring time by inspecting the csv (e.g. a known bomb ship → `detonation-bomb`; a known leader/aura ship → `leader-aura`). Load them via `loadShipDataByName` from `scripts/lib/shipDataSnapshot` (test files may import from `scripts/`).

```typescript
import { describe, it, expect } from 'vitest';
import { tagShip } from '../classes';
import { loadShipDataByName } from '../../../../../scripts/lib/shipDataSnapshot';

const ships = loadShipDataByName();

describe('tagShip', () => {
    it('tags a bomb/detonation ship as detonation-bomb', () => {
        const ship = ships.get('Vindicator'); // confirm this name carries a bomb in ship-skills.csv
        expect(ship).toBeDefined();
        expect(tagShip(ship as never).has('detonation-bomb')).toBe(true);
    });

    it('tags a ship with no interaction primitives as empty', () => {
        const plain = ships.get('<a-plain-attacker-with-only-damage>'); // pick from csv
        expect(tagShip(plain as never).size).toBe(0);
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest --run src/utils/combat/audit/__tests__/classes.test.ts`
Expected: FAIL — cannot find module `../classes`.

- [ ] **Step 3: Implement `tagShip`**

Create `src/utils/combat/audit/classes.ts`. Adapt property reads to the real Ability shape discovered above:

```typescript
import type { Ship } from '../../../types/ship';
import type { InteractionClass } from './types';
import { buildShipAbilities } from '<real/path/to/buildShipAbilities>';

const TYPE_TO_CLASS: Partial<Record<string, InteractionClass>> = {
    detonation: 'detonation-bomb',
    bomb: 'detonation-bomb',
    control: 'control',
    cleanse: 'cleanse-purge',
    purge: 'cleanse-purge',
    shield: 'shield',
};

export function tagShip(ship: Ship): Set<InteractionClass> {
    const tags = new Set<InteractionClass>();
    const abilities = buildShipAbilities(ship);
    for (const ability of abilities) {
        const cls = TYPE_TO_CLASS[ability.type];
        if (cls) tags.add(cls);
        if (isReactive(ability)) tags.add('reactive-trigger');
        if (isLeaderAura(ability)) tags.add('leader-aura');
        if (isPersistentStacking(ability)) tags.add('persistent-stacking');
        if (isProtection(ability)) tags.add('protection-redirect');
        if (ignoresStealth(ability) || grantsStealth(ability)) tags.add('stealth');
    }
    return tags;
}

// Each predicate below reads the real Ability fields (trigger kind, buff name,
// target, flags). Implement against the discovered Ability type; keep them tiny
// and pure. isReactive → ability has a reactive trigger; isLeaderAura → aura/
// squad-leader-sourced; isPersistentStacking → a persistentStackingBuffs name
// (see src/constants/persistentStackingBuffs.ts); isProtection → protection/
// redirect grant; stealth predicates → ignoresStealth / grants Stealth.
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest --run src/utils/combat/audit/__tests__/classes.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/utils/combat/audit/classes.ts src/utils/combat/audit/__tests__/classes.test.ts
git commit -m "feat(interaction-audit): interaction-class tagging derived from parsed abilities"
```

---

## Task 3: Seeded battle runner + core result invariants + reproducibility

**REVISED (RNG correction):** production combat uses `Math.random` (`rateAccumulator.ts:18`). This task first builds the seeded runner every later oracle depends on, then the two pure result-invariants, then a reproducibility check that exercises the seeding. `determinism` is NOT a pure result check — it must re-run battles, so it lives in `reproducibility.ts`, not in `checkInvariants`.

**Files:**
- Create: `src/utils/combat/audit/seededBattle.ts`
- Create: `src/utils/combat/audit/invariants.ts`
- Create: `src/utils/combat/audit/reproducibility.ts`
- Test: `src/utils/combat/audit/__tests__/seededBattle.test.ts`
- Test: `src/utils/combat/audit/__tests__/invariants.test.ts`
- Test: `src/utils/combat/audit/__tests__/reproducibility.test.ts`

**Interfaces:**
- Consumes: `InvariantViolation` (Task 1); `canonicalPlacement` (Task 1); `simulateBattle`, `BattleSimulationInput`, `BattleResult` (existing); `setupKeyedTestRng`, `resetRateGateRng` from `src/utils/calculators/rateAccumulator` (existing).
- Produces:
  - `runSeededBattle(input: BattleSimulationInput, seed: number): BattleResult`
  - `checkInvariants(result: BattleResult): InvariantViolation[]` (pure, result only)
  - `checkReproducibility(input: BattleSimulationInput, seed: number): InvariantViolation[]`

**Test-ship note:** use a real ship that loads via `buildTraceShip` from `scripts/lib/traceShipFactory` (e.g. `buildTraceShip('Demolisher')`) — `loadShipDataByName` returns raw `ShipData` without `baseStats`, so it is NOT a drop-in for `canonicalPlacement`. Verified: `buildTraceShip('Demolisher')` produces a `Ship` with `baseStats`.

### Step group A — `seededBattle.ts` (the runner every oracle uses)

- [ ] **Step 1: Write the failing test**

Create `src/utils/combat/audit/__tests__/seededBattle.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { runSeededBattle } from '../seededBattle';
import { canonicalPlacement } from '../fixtures';
import { buildTraceShip } from '../../../../../scripts/lib/traceShipFactory';
import type { BattleSimulationInput } from '../../../calculators/battleSimulator';
import type { Ship } from '../../../../types/ship';

const battle = (): BattleSimulationInput => ({
    playerTeam: [canonicalPlacement(buildTraceShip('Demolisher') as Ship, 'T1')],
    enemyTeam: [canonicalPlacement(buildTraceShip('Lodolite') as Ship, 'M2')],
    rounds: 20,
});

describe('runSeededBattle', () => {
    it('is byte-reproducible for the same seed', () => {
        const a = JSON.stringify(runSeededBattle(battle(), 1));
        const b = JSON.stringify(runSeededBattle(battle(), 1));
        expect(a).toBe(b);
    });

    it('differs across seeds (RNG actually flows)', () => {
        const a = JSON.stringify(runSeededBattle(battle(), 1));
        const b = JSON.stringify(runSeededBattle(battle(), 2));
        expect(a).not.toBe(b);
    });
});
```

- [ ] **Step 2: Run → RED** (`npx vitest --run src/utils/combat/audit/__tests__/seededBattle.test.ts`; cannot find module).

- [ ] **Step 3: Implement `seededBattle.ts`**

```typescript
import { simulateBattle, type BattleSimulationInput, type BattleResult } from '../../calculators/battleSimulator';
import { setupKeyedTestRng, resetRateGateRng } from '../../calculators/rateAccumulator';

/** Run a battle under a pinned RNG seed so the result is byte-reproducible.
 *  Production combat draws crit/hit/landing from Math.random via rateAccumulator;
 *  setupKeyedTestRng installs a seeded keyed sub-stream provider for the duration
 *  of this call, and resetRateGateRng restores Math.random afterward. The reset
 *  runs in finally so a throwing battle never leaks the seeded RNG into later runs. */
export function runSeededBattle(input: BattleSimulationInput, seed: number): BattleResult {
    setupKeyedTestRng(seed);
    try {
        return simulateBattle(input);
    } finally {
        resetRateGateRng();
    }
}
```

(Confirm the exact exported names `setupKeyedTestRng` / `resetRateGateRng` in `rateAccumulator.ts` before implementing — they are the SP-0 rng-decouple seams.)

- [ ] **Step 4: Run → GREEN** (both tests pass).

### Step group B — `invariants.ts` (pure result checks: hp-bounds, no-dead-acts)

- [ ] **Step 5: Write the failing test**

Create `src/utils/combat/audit/__tests__/invariants.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { checkInvariants } from '../invariants';
import { runSeededBattle } from '../seededBattle';
import { canonicalPlacement } from '../fixtures';
import { buildTraceShip } from '../../../../../scripts/lib/traceShipFactory';
import type { BattleSimulationInput } from '../../../calculators/battleSimulator';
import type { Ship } from '../../../../types/ship';

const battle = (): BattleSimulationInput => ({
    playerTeam: [canonicalPlacement(buildTraceShip('Demolisher') as Ship, 'T1')],
    enemyTeam: [canonicalPlacement(buildTraceShip('Demolisher') as Ship, 'M2')],
    rounds: 20,
});

describe('checkInvariants — pure result checks', () => {
    it('reports no violations for a normal battle', () => {
        const result = runSeededBattle(battle(), 1);
        expect(checkInvariants(result)).toEqual([]);
    });

    it('flags an hpPct outside [0,100]', () => {
        const result = runSeededBattle(battle(), 1);
        result.rounds[0].ships[0].hpPct = 140;
        expect(checkInvariants(result).some((x) => x.invariant === 'hp-bounds')).toBe(true);
    });

    it('flags a dead actor appearing in turnOrder', () => {
        const result = runSeededBattle(battle(), 1);
        const dead = result.rounds[0].ships[0];
        dead.alive = false;
        result.rounds[0].turnOrder = [dead.actorId];
        expect(checkInvariants(result).some((x) => x.invariant === 'no-dead-acts')).toBe(true);
    });
});
```

- [ ] **Step 6: Run → RED.**

- [ ] **Step 7: Implement `invariants.ts`** (note: `checkInvariants` takes ONLY `result` now — no `input`, no `simulateBattle` import, no `determinism`):

```typescript
import type { InvariantViolation } from './types';
import type { BattleResult } from '../../calculators/battleSimulator';

function hpBounds(result: BattleResult): InvariantViolation[] {
    const out: InvariantViolation[] = [];
    for (const r of result.rounds) {
        for (const s of r.ships) {
            if (s.hpPct < 0 || s.hpPct > 100) {
                out.push({ invariant: 'hp-bounds', round: r.round, actorId: s.actorId, detail: `hpPct ${s.hpPct} outside [0,100]` });
            }
        }
    }
    return out;
}

function noDeadActs(result: BattleResult): InvariantViolation[] {
    const out: InvariantViolation[] = [];
    for (const r of result.rounds) {
        const deadIds = new Set(r.ships.filter((s) => !s.alive).map((s) => s.actorId));
        for (const actorId of r.turnOrder) {
            if (deadIds.has(actorId)) {
                out.push({ invariant: 'no-dead-acts', round: r.round, actorId, detail: `dead actor ${actorId} present in turnOrder` });
            }
        }
    }
    return out;
}

export function checkInvariants(result: BattleResult): InvariantViolation[] {
    return [...hpBounds(result), ...noDeadActs(result)];
}
```

- [ ] **Step 8: Run → GREEN.**

### Step group C — `reproducibility.ts` (the corrected determinism check)

- [ ] **Step 9: Write the failing test**

Create `src/utils/combat/audit/__tests__/reproducibility.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { checkReproducibility } from '../reproducibility';
import { canonicalPlacement } from '../fixtures';
import { buildTraceShip } from '../../../../../scripts/lib/traceShipFactory';
import type { BattleSimulationInput } from '../../../calculators/battleSimulator';
import type { Ship } from '../../../../types/ship';

const battle = (): BattleSimulationInput => ({
    playerTeam: [canonicalPlacement(buildTraceShip('Demolisher') as Ship, 'T1')],
    enemyTeam: [canonicalPlacement(buildTraceShip('Lodolite') as Ship, 'M2')],
    rounds: 20,
});

describe('checkReproducibility', () => {
    it('returns no violation for a seeded battle (byte-reproducible)', () => {
        expect(checkReproducibility(battle(), 1)).toEqual([]);
    });
});
```

- [ ] **Step 10: Run → RED.**

- [ ] **Step 11: Implement `reproducibility.ts`** (re-seeds via `runSeededBattle` between the two runs — the whole point; a raw double `simulateBattle` would ALWAYS differ):

```typescript
import type { InvariantViolation } from './types';
import type { BattleSimulationInput } from '../../calculators/battleSimulator';
import { runSeededBattle } from './seededBattle';

/** Two runs of the same (input, seed) must be byte-identical. This guards
 *  nondeterminism OTHER than the (now-pinned) RNG — Map-iteration order, leaked
 *  global state, etc. runSeededBattle re-seeds each call, so any diff is a real bug. */
export function checkReproducibility(input: BattleSimulationInput, seed: number): InvariantViolation[] {
    const a = JSON.stringify(runSeededBattle(input, seed));
    const b = JSON.stringify(runSeededBattle(input, seed));
    if (a !== b) {
        return [{ invariant: 'reproducibility', round: 0, detail: `two seeded runs (seed ${seed}) diverged` }];
    }
    return [];
}
```

- [ ] **Step 12: Run → GREEN.**

- [ ] **Step 13: Full suite + commit**

Run `npm test` once (never `vitest -u`), then:

```bash
git add src/utils/combat/audit/seededBattle.ts src/utils/combat/audit/invariants.ts src/utils/combat/audit/reproducibility.ts src/utils/combat/audit/__tests__/seededBattle.test.ts src/utils/combat/audit/__tests__/invariants.test.ts src/utils/combat/audit/__tests__/reproducibility.test.ts
git commit -m "feat(interaction-audit): seeded battle runner + result invariants + reproducibility"
```

---

## Task 4: Invariant catalog — damage conservation (team-symmetry DEFERRED)

**REVISED twice during execution:**
1. **stack-caps DROPPED** — `ShipRoundState.activeBuffs` is a deduplicated `Set<string>` of buff NAMES (battleSimulator.ts:315,445), no stack counts anywhere in `ShipRoundState`, so a stack-cap violation is **not observable from `BattleResult`**. Persistent-stacking is already covered by prior epics.
2. **team-symmetry DEFERRED to a controlled-conditions redesign** (see the "Deferred: controlled team-symmetry" section after Task 11). The naive "swap sides, same seed, compare amounts" check is **structurally confounded** and fires on a correct engine: (a) two identical ships tie on speed → the equal-speed tie-break (`state.ts:288`, player-side-first) gives the player-side ship first-mover advantage; (b) the RNG stream is keyed by `ownerId` (`attacker` vs `e:...`), so the same physical ship draws a different crit stream by side. Both make amounts differ across the swap independent of any bug. It ALSO already surfaced a real engine bug manually (FINDING-001, enemy-side charge detonation) — captured — so no coverage is lost by deferring the automated form.

**This task ships `damage-conservation` only.**

**Files:**
- Modify: `src/utils/combat/audit/invariants.ts`
- Modify: `src/utils/combat/audit/__tests__/invariants.test.ts`

**Interfaces:**
- Consumes: everything from Task 3 — `checkInvariants(result)` and `runSeededBattle(input, seed)`.
- Produces: extends `checkInvariants(result)` with `damage-conservation` (pure result check). `reproducibility.ts` stays at its Task-3 state (`checkReproducibility` only).

**Note on damage-conservation (see Global Constraints — Protection caveat):** assert per-round `Σ ships.damageDealt ≈ Σ ships.damageTaken` (allow a tiny float epsilon, e.g. `> 1`), but SKIP any round where Protection was active. **Detect a Protection round via `ShipRoundState.activeBuffs.includes('Protection')`** on any ship in that round (there is NO protection/redirect entry kind in the combat log — confirmed; Protection is a buff, so `activeBuffs` is the pure, reliable signal). This keeps the check pure over `result`. Confirm the exact buff name string (`'Protection'`) against `src/utils/combat/protectionTransfer.ts` (line ~65) before relying on it.

- [ ] **Step 1: Write failing test.** Add a `damage-conservation` case to `invariants.test.ts`: a corrupted round where `ΣdamageDealt`/`ΣdamageTaken` diverge on a NON-protection battle → flagged. Keep a clean-battle case asserting `checkInvariants(result)` returns `[]` on the real 20-round battle.

```typescript
// append to invariants.test.ts (checkInvariants takes ONLY result)
describe('checkInvariants — conservation', () => {
    it('flags a per-round damageDealt/damageTaken mismatch on a non-protection battle', () => {
        const result = runSeededBattle(battle(), 1); // Demolisher mirror — no Protection
        result.rounds[0].ships[0].damageDealt += 5000; // break the ledger
        expect(checkInvariants(result).some((x) => x.invariant === 'damage-conservation')).toBe(true);
    });
});
```

- [ ] **Step 2: Run to verify it fails** (`npx vitest --run src/utils/combat/audit/__tests__/invariants.test.ts`; `damage-conservation` not produced yet).

- [ ] **Step 3: Implement.** Add `damageConservation(result)` to `checkInvariants`'s spread (pure, Task-3 shape): iterate rounds, sum `ships.damageDealt` and `ships.damageTaken`, SKIP rounds where any ship's `activeBuffs` includes `'Protection'`, push on `Math.abs(dealt - taken) > 1`.

**Implementer caution:** if the un-corrupted `damage-conservation` check fires on a REAL clean battle, that is a genuine finding (a reconciliation edge the `ShipRoundState.damageDealt` docstring warns about — e.g. redirected DoT-tick batches). Do NOT loosen the epsilon or narrow the battle to force green — STOP and report the round + numbers. (Verified during execution: it holds clean on the 20-round Demolisher mirror.)

- [ ] **Step 4: Run to verify pass** (`npx vitest --run src/utils/combat/audit/__tests__/invariants.test.ts`).

- [ ] **Step 5: Commit**

```bash
git add src/utils/combat/audit/invariants.ts src/utils/combat/audit/__tests__/invariants.test.ts
git commit -m "feat(interaction-audit): damage-conservation invariant (team-symmetry deferred — see FINDING-001)"
```

---

## Task 5: Fingerprint + differential oracle

**Files:**
- Create: `src/utils/combat/audit/fingerprint.ts`
- Test: `src/utils/combat/audit/__tests__/fingerprint.test.ts`

**Interfaces:**
- Consumes: `FingerprintDiff` (Task 1); `BattleResult`, `CombatLogEntryKind`.
- Produces:
  - `fingerprintActor(result: BattleResult, actorId: string): Set<CombatLogEntryKind>`
  - `diffFingerprints(shipName, actorId, solo, comp): FingerprintDiff | null`
  - `runDifferential(soloResult, compResult, shipName, soloActorId, compActorId): FingerprintDiff | null`

**Note:** `fingerprintActor` walks `result.combatLog` (rounds → `startOfRound`/`turns`/`endOfRound` → entries and their nested `reactions`) collecting the `kind` of every entry whose `actorId` matches — the multi-round analog of `collectActorEntryKinds` (`scripts/lib/kitBundle.ts:52`). Resolve the composition actorId via `compResult.roster` (match by ship name + position), NEVER assume `'attacker'`. These three functions are PURE over already-run `BattleResult`s (unit tests use hand-built fake results). **Consumer contract (Task 10):** the solo and composition results passed to `runDifferential` MUST both come from `runSeededBattle(_, seed)` under the SAME seed, or the fingerprint diff is polluted by RNG divergence rather than real interference.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { fingerprintActor, diffFingerprints } from '../fingerprint';
import type { BattleResult } from '../../../calculators/battleSimulator';

const fakeResult = (kindsByActor: Record<string, string[]>): BattleResult =>
    ({
        rounds: [],
        outcome: { winner: 'draw', lastRound: 1 },
        roster: [],
        combatLog: [
            {
                round: 1,
                startOfRound: [],
                turns: [
                    {
                        actorId: 'x',
                        entries: Object.entries(kindsByActor).flatMap(([actorId, kinds]) =>
                            kinds.map((kind) => ({ kind, actorId, targets: [], reactions: [] }))
                        ),
                    },
                ],
                endOfRound: [],
            },
        ],
    }) as unknown as BattleResult;

describe('fingerprint', () => {
    it('collects the kinds an actor produced across the log', () => {
        const r = fakeResult({ a: ['attack', 'heal', 'attack'] });
        expect([...fingerprintActor(r, 'a')].sort()).toEqual(['attack', 'heal']);
    });

    it('flags a kind present solo but missing in composition', () => {
        const solo = fingerprintActor(fakeResult({ a: ['attack', 'heal'] }), 'a');
        const comp = fingerprintActor(fakeResult({ a: ['attack'] }), 'a');
        const diff = diffFingerprints('ShipA', 'a', solo, comp);
        expect(diff?.missingInComposition).toContain('heal');
        expect(diff?.extraInComposition).toEqual([]);
    });

    it('returns null when fingerprints match', () => {
        const solo = fingerprintActor(fakeResult({ a: ['attack'] }), 'a');
        const comp = fingerprintActor(fakeResult({ a: ['attack'] }), 'a');
        expect(diffFingerprints('ShipA', 'a', solo, comp)).toBeNull();
    });
});
```

**Note:** the test uses `turns[].entries[]` and `turns[].actorId` — confirm the real `CombatLogTurn` shape (`src/utils/combat/log/types.ts`) and adjust the fake + the walker to the true field names before implementing.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest --run src/utils/combat/audit/__tests__/fingerprint.test.ts`
Expected: FAIL — cannot find module `../fingerprint`.

- [ ] **Step 3: Implement fingerprint + diff**

```typescript
import type { BattleResult } from '../../calculators/battleSimulator';
import type { CombatLogEntry, CombatLogEntryKind } from '../log/types';
import type { FingerprintDiff } from './types';

function walkEntries(entries: CombatLogEntry[], actorId: string, acc: Set<CombatLogEntryKind>): void {
    for (const e of entries) {
        if (e.actorId === actorId) acc.add(e.kind);
        if (e.reactions?.length) walkEntries(e.reactions, actorId, acc);
    }
}

export function fingerprintActor(result: BattleResult, actorId: string): Set<CombatLogEntryKind> {
    const acc = new Set<CombatLogEntryKind>();
    for (const round of result.combatLog) {
        walkEntries(round.startOfRound, actorId, acc);
        for (const turn of round.turns) walkEntries(turn.entries, actorId, acc);
        walkEntries(round.endOfRound, actorId, acc);
    }
    return acc;
}

export function diffFingerprints(
    shipName: string,
    actorId: string,
    solo: Set<CombatLogEntryKind>,
    comp: Set<CombatLogEntryKind>
): FingerprintDiff | null {
    const missing = [...solo].filter((k) => !comp.has(k));
    const extra = [...comp].filter((k) => !solo.has(k));
    if (missing.length === 0 && extra.length === 0) return null;
    return { actorId, shipName, missingInComposition: missing, extraInComposition: extra };
}
```

(Adjust `turn.entries` to the confirmed field name.)

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest --run src/utils/combat/audit/__tests__/fingerprint.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/utils/combat/audit/fingerprint.ts src/utils/combat/audit/__tests__/fingerprint.test.ts
git commit -m "feat(interaction-audit): actor fingerprint + differential diff"
```

---

## Task 6: Ablation oracle

**Files:**
- Create: `src/utils/combat/audit/ablation.ts`
- Test: `src/utils/combat/audit/__tests__/ablation.test.ts`

**Interfaces:**
- Consumes: `fingerprintActor` (Task 5); `AblationResult` (Task 1); `canonicalPlacement`; `runSeededBattle` (Task 3).
- Produces: `runAblation(a: Ship, b: Ship, seed: number): AblationResult` — runs `{a}`, `{b}`, `{a,b}` (a as focus, b as ally, both vs a fixed neutral enemy) ALL via `runSeededBattle(_, seed)` under the same seed, and reports whether a's or b's fingerprint in the combined run contains kinds absent from its own solo run.

**Note:** ablation is the NOISIEST oracle (real synergy looks like divergence), so it never emits a confirmed Finding — its output lands in the ledger's `needsTriage` bucket (Task 9/10). The test asserts the MECHANIC (divergence detection), not any specific real-ship result.

- [ ] **Step 1: Write the failing test** — use two ships where combining plausibly changes behavior; assert `runAblation` returns an `AblationResult` with a boolean `diverges` and a non-empty `detail`. Keep the assertion structural (shape), not value-specific, to avoid coupling to engine specifics.

- [ ] **Step 2: Run to verify it fails.** Expected: cannot find module `../ablation`.

- [ ] **Step 3: Implement `runAblation`:** build three `BattleSimulationInput`s via `canonicalPlacement` against one fixed neutral enemy ship (a plain attacker), run each via `runSeededBattle(_, seed)` under the SAME seed, `fingerprintActor` a and b in the combined vs their solo runs (resolve actorIds via each result's `roster`), set `diverges = extraInCombined.length > 0` for either, and compose `detail`.

- [ ] **Step 4: Run to verify pass.**

- [ ] **Step 5: Commit**

```bash
git add src/utils/combat/audit/ablation.ts src/utils/combat/audit/__tests__/ablation.test.ts
git commit -m "feat(interaction-audit): ablation/superposition oracle (needs-triage bucket)"
```

---

## Task 7: Seeded composition fuzzer

**Files:**
- Create: `src/utils/combat/audit/compose.ts`
- Test: `src/utils/combat/audit/__tests__/compose.test.ts`

**Interfaces:**
- Consumes: `InteractionClass`, `canonicalPlacement`; `Ship`, `Position`, `BattleSimulationInput`; **`mulberry32` from `src/utils/calculators/rateAccumulator`** (already exported there — REUSE it, do NOT define a second copy).
- Produces:
  - `composeBattle(seed: number, tagged: { ship: Ship; classes: Set<InteractionClass> }[]): BattleSimulationInput`

**Note:** valid slots are the game's positions — reuse the position list from `traceScenario.ts` / `src/types/encounters` (confirm the exact `Position` literals). 4 ships/side, distinct positions per side. Draw policy: pick a primary class present in the corpus, draw the first ship from that class's pool, then fill remaining 7 slots biased (decaying probability) toward the same/adjacent classes; fall back to any ship so the battle always fills. Ships MAY repeat across sides but not within a side's position set. The composition seed is independent of the battle-RNG seed used by `runSeededBattle` (Task 10 passes the same integer to both — fine, they consume different streams).

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { composeBattle } from '../compose';
import { tagShip } from '../classes';
import { loadShipDataRecords } from '../../../../../scripts/lib/shipDataSnapshot';
// Build tagged corpus from real ships — but note loadShipDataRecords returns ShipData; use
// buildTraceShip(name) to get a Ship with baseStats when a placement is needed, OR confirm
// composeBattle only needs the fields present on the loaded records + tags.

describe('composeBattle', () => {
    it('produces an identical composition for the same seed', () => {
        const tagged = loadShipDataRecords().map((ship) => ({ ship: ship as never, classes: tagShip(ship as never) }));
        const one = composeBattle(7, tagged);
        const two = composeBattle(7, tagged);
        expect(JSON.stringify(one)).toEqual(JSON.stringify(two));
        expect(one.playerTeam).toHaveLength(4);
        expect(one.enemyTeam).toHaveLength(4);
        expect(new Set(one.playerTeam.map((p) => p.position)).size).toBe(4); // distinct slots per side
    });
});
```

(If `composeBattle` must return placements with real `baseStats`, resolve each drawn ship via `buildTraceShip(name)` inside `composeBattle` rather than from the raw `ShipData` record — decide this when you inspect what `canonicalPlacement` needs.)

- [ ] **Step 2: Run to verify it fails.** Expected: cannot find module `../compose`.

- [ ] **Step 3: Implement `composeBattle`** — `import { mulberry32 } from '../../calculators/rateAccumulator';` then `const rng = mulberry32(seed);` and draw primary class, ships, slots per the policy note. Do NOT redefine `mulberry32`.

- [ ] **Step 4: Run to verify pass.**

- [ ] **Step 5: Commit**

```bash
git add src/utils/combat/audit/compose.ts src/utils/combat/audit/__tests__/compose.test.ts
git commit -m "feat(interaction-audit): seeded interaction-biased composition fuzzer"
```

---

## Task 8: Composition minimizer (ddmin)

**Files:**
- Create: `src/utils/combat/audit/minimize.ts`
- Test: `src/utils/combat/audit/__tests__/minimize.test.ts`

**Interfaces:**
- Consumes: `BattleSimulationInput`.
- Produces: `minimizeComposition(input: BattleSimulationInput, stillFails: (candidate: BattleSimulationInput) => boolean): BattleSimulationInput` — greedily drops one placement at a time (from either side, never emptying a side) while `stillFails` stays true; returns the smallest surviving composition.

- [ ] **Step 1: Write the failing test** — a pure predicate test (no engine): `stillFails` returns true iff both `'BombShip'` and `'ReactorShip'` remain on the player side. Feed a 4v4 and assert the minimized result keeps exactly those two on the player side and shrinks the enemy side to its floor of 1.

```typescript
import { describe, it, expect } from 'vitest';
import { minimizeComposition } from '../minimize';
import type { BattleSimulationInput } from '../../../calculators/battleSimulator';

const ph = (id: string, position: string) => ({ ship: { id, name: id }, position }) as never;

describe('minimizeComposition', () => {
    it('shrinks to the smallest ship set that still triggers the predicate', () => {
        const input: BattleSimulationInput = {
            playerTeam: [ph('BombShip', 'T1'), ph('ReactorShip', 'M2'), ph('Filler1', 'B2'), ph('Filler2', 'T2')],
            enemyTeam: [ph('E1', 'T1'), ph('E2', 'M2'), ph('E3', 'B2'), ph('E4', 'T2')],
            rounds: 10,
        };
        const stillFails = (c: BattleSimulationInput) => {
            const names = new Set(c.playerTeam.map((p) => p.ship.id));
            return names.has('BombShip') && names.has('ReactorShip');
        };
        const min = minimizeComposition(input, stillFails);
        expect(min.playerTeam.map((p) => p.ship.id).sort()).toEqual(['BombShip', 'ReactorShip']);
        expect(min.enemyTeam).toHaveLength(1);
    });
});
```

- [ ] **Step 2: Run to verify it fails.** Expected: cannot find module `../minimize`.

- [ ] **Step 3: Implement `minimizeComposition`** — loop: for each side and each index, try removing it; if the reduced composition still `stillFails` and the side keeps ≥1 placement, accept the reduction; repeat until a full pass makes no reduction.

- [ ] **Step 4: Run to verify pass.**

- [ ] **Step 5: Commit**

```bash
git add src/utils/combat/audit/minimize.ts src/utils/combat/audit/__tests__/minimize.test.ts
git commit -m "feat(interaction-audit): ddmin composition minimizer"
```

---

## Task 9: Ledger writer

**Files:**
- Create: `scripts/lib/interactionLedger.ts`
- Test: `scripts/lib/__tests__/interactionLedger.test.ts`

**Interfaces:**
- Consumes: `Finding` (Task 1).
- Produces: `renderLedgerMarkdown(findings, meta): string`, `buildLedgerJson(findings, meta): object`, `writeLedger(findings, meta, outDir): void` (fs write of `interaction-audit-ledger.{json,md}`).

**Note:** mirror `docs/ship-kit-correctness-ledger.{json,md}` top-level shape: `{ compositionsRun, confirmed: Finding[], needsTriage: Finding[], refuted: [] }`. Split findings by `oracle === 'ablation'` → `needsTriage`, else `confirmed`. Keep `writeLedger` (fs) separate from the two pure render/build functions so the latter are unit-tested without touching disk.

- [ ] **Step 1: Write the failing test** for `buildLedgerJson` + `renderLedgerMarkdown` — assert an ablation finding lands in `needsTriage`, an invariant finding in `confirmed`, and the markdown contains the ship names + seed. Pure, no fs.

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement** the two pure functions + the fs `writeLedger` wrapper (`mkdirSync(outDir, {recursive:true})`, `writeFileSync` json + md).

- [ ] **Step 4: Run to verify pass.**

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/interactionLedger.ts scripts/lib/__tests__/interactionLedger.test.ts
git commit -m "feat(interaction-audit): ledger writer (json + md, needs-triage split)"
```

---

## Task 10: CLI entry + calibration gate

**Files:**
- Create: `scripts/auditInteractions.ts`
- Modify: `package.json` (add `"audit:interactions"` script)

**Interfaces:**
- Consumes: every pure module (Tasks 2–9) + `loadShipDataRecords` (`scripts/lib/shipDataSnapshot`).
- Produces: the runnable `npm run audit:interactions -- --seed <N> --count <M>` command that writes `docs/interaction-audit-ledger.{json,md}` and prints a summary.

**Calibration gate (the spec's Wave-0 step):** the CLI's FIRST action, before any fuzzing, is a self-check: run a battery of `count` compositions containing ONLY ships with an empty class tag set (inert ships), all via `runSeededBattle(_, seed)`, and assert `checkInvariants(result)` + `checkReproducibility` + `runDifferential` return zero findings. (team-symmetry is NOT part of calibration — it's deferred; see the controlled-team-symmetry section.) If the inert battery produces findings, those are HARNESS asymmetries (focus-vs-walked instrumentation) — the CLI prints `CALIBRATION FAILED` with the offending invariant and exits non-zero WITHOUT writing a ledger. Only once calibration is clean does it fuzz the real tagged corpus. This prevents harness noise from polluting the findings ledger.

- [ ] **Step 1: Write the CLI** — parse `--seed`/`--count`; `loadShipDataRecords()`; `tagShip` each; run the calibration gate (inert-only battery); on pass, for each seed in `[seed, seed+count)`: `composeBattle(seed, tagged)` → `runSeededBattle(input, seed)` → `checkInvariants(result)` + `checkReproducibility(input, seed)` + differential (per player ship vs its `buildStandardScenario` solo, BOTH via `runSeededBattle(_, seed)`) + ablation on top tagged pairs (via `runAblation(a, b, seed)`); `minimizeComposition` any invariant/differential violation (the `stillFails` predicate re-runs via `runSeededBattle(_, seed)`); collect `Finding`s; `writeLedger`. Print `compositionsRun`, `confirmed`, `needsTriage` counts.

- [ ] **Step 2: Add the npm script** to `package.json`:

```json
"audit:interactions": "tsx scripts/auditInteractions.ts"
```

- [ ] **Step 3: Run the calibration + a small fuzz batch**

Run: `npm run audit:interactions -- --seed 1 --count 5`
Expected: prints `CALIBRATION: clean`, then `compositionsRun: 5` and finding counts; writes `docs/interaction-audit-ledger.{json,md}`. If it prints `CALIBRATION FAILED`, STOP and fix the harness asymmetry (restrict fingerprints to focus-independent kinds, or place the target ship as focus in the composition) before trusting any finding — do not proceed to Task 11.

- [ ] **Step 4: Commit**

```bash
git add scripts/auditInteractions.ts package.json
git commit -m "feat(interaction-audit): CLI entry + Wave-0 calibration gate + npm script"
```

---

## Task 11: Permanent regression gate

**Files:**
- Create: `src/utils/combat/__tests__/interactionInvariants.integration.test.ts`

**Interfaces:**
- Consumes: `checkInvariants(result)`, `checkReproducibility`, `composeBattle`, `tagShip`, `loadShipDataRecords`, `runSeededBattle`.

**Note:** this runs inside `npm test` (the golden audit). It fuzzes a FIXED small seed set (e.g. seeds 1–25) over the real tagged corpus, runs each via `runSeededBattle(input, seed)`, and asserts `checkInvariants(result)` returns `[]` for every composition (plus a spot `checkReproducibility` on a couple of seeds). Any minimized repro discovered by the Task-10 run that turned out to be a real bug gets added here as an explicit named case after its fix ships (seed pinned). Keep the seed count small enough to stay well under a few seconds so it doesn't bloat the suite.

- [ ] **Step 1: Write the test**

```typescript
import { describe, it, expect } from 'vitest';
import { checkInvariants } from '../audit/invariants';
import { composeBattle } from '../audit/compose';
import { tagShip } from '../audit/classes';
import { runSeededBattle } from '../audit/seededBattle';
import { loadShipDataRecords } from '../../../../scripts/lib/shipDataSnapshot';

const tagged = loadShipDataRecords().map((ship) => ({ ship, classes: tagShip(ship as never) }));

describe('interaction invariants regression gate', () => {
    for (let seed = 1; seed <= 25; seed++) {
        it(`seed ${seed} composition holds all invariants`, () => {
            const input = composeBattle(seed, tagged as never);
            const result = runSeededBattle(input, seed);
            expect(checkInvariants(result)).toEqual([]);
        });
    }
});
```

- [ ] **Step 2: Run the gate**

Run: `npx vitest --run src/utils/combat/__tests__/interactionInvariants.integration.test.ts`
Expected: PASS (25 tests) — OR real invariant failures. If any fail, each is a genuine interaction finding: record it in the ledger, open it as fix work (its own brainstorm → waves), and mark the seed `it.fails` (documented) until fixed. Do NOT weaken an invariant to make the gate green.

- [ ] **Step 3: Run the full suite** to confirm no regression and that the golden audit still passes.

Run: `npm test`
Expected: full suite green (existing 4770+ tests + the new gate).

- [ ] **Step 4: Commit**

```bash
git add src/utils/combat/__tests__/interactionInvariants.integration.test.ts
git commit -m "test(interaction-audit): permanent seeded invariant regression gate"
```

---

## Self-Review

**Spec coverage:**
- Seeded runner (RNG correction) → Task 3 (`seededBattle.ts`). Oracle A: pure result invariants (hp-bounds, no-dead-acts [reformulated: corpse-acts-in-later-round], damage-conservation) → Tasks 3–4; cross-run check (reproducibility) → `reproducibility.ts`, Task 3. **stack-caps DROPPED** (not observable from `BattleResult`). **team-symmetry DEFERRED** to a controlled-conditions redesign (naive form confounded by tie-break + ownerId-keyed RNG; already found FINDING-001 manually). Oracle B (differential) → Task 5. Oracle C (ablation) → Task 6. Fuzzer → Task 7. Minimizer → Task 8. Interaction-class tagging → Task 2. Canonical stats → Task 1. Discovery ledger → Task 9. CLI + calibration → Task 10. Regression gate → Task 11. Non-goals (no magnitude/gear/UI/auto-fix) honored throughout. ✅
- Risk: ablation triage → `needsTriage` bucket (Tasks 6, 9). Risk: harness-asymmetry calibration → explicit calibration gate (Task 10). ✅
- File-placement refinement (pure logic in `src/utils/combat/audit/`, not `scripts/lib/interaction/`) documented in File Structure with rationale (avoids `src → scripts` dep for the regression gate). ✅
- **RNG correction:** production combat uses `Math.random`; every battle routes through `runSeededBattle`; `mulberry32` + seed seams reused from `rateAccumulator`. ✅

**Placeholder scan:** Tasks 2, 4, 6, 9, 10 intentionally defer some exact property reads to implement-time discovery (real `Ability` shape, `activeBuffs` encoding, Protection log marker, `CombatLogTurn.entries` field name) with a concrete grep/inspection instruction each — these are unknowable from the types alone and MUST be verified against live shapes, not guessed. All algorithmic logic and all testable contracts are concrete.

**Type consistency:** `Finding`/`InvariantViolation`/`FingerprintDiff`/`AblationResult`/`InteractionClass` defined once (Task 1), consumed unchanged downstream. `runSeededBattle(input, seed)`, `checkInvariants(result)` (result-only — corrected), `checkReproducibility(input, seed)`, `fingerprintActor(result, actorId)`, `composeBattle(seed, tagged)`, `runAblation(a, b, seed)`, `minimizeComposition(input, stillFails)`, `tagShip(ship)`, `canonicalPlacement(ship, position)` signatures stable across all references. (`checkTeamSymmetry` deferred.) ✅

---

## Deferred: controlled team-symmetry (post-Task-11 follow-up)

The team-symmetry oracle is uniquely valuable — it's the ONLY oracle that catches **enemy-side** execution bugs (the differential oracle only compares a ship on the player side, solo vs composition). It already found FINDING-001 (enemy-side charge detonation never fires) manually. But the naive "swap sides, same seed, compare amounts" form is confounded by two documented engine facts, so it must be redesigned with controls before it can be an automated check:

1. **Equal-speed tie-break** (`state.ts:288`, player-side-first): identical ships tie → player-side first-mover advantage. **Control:** run the symmetry probe with DISTINCT speeds so turn order is speed-determined (symmetric under swap), OR use a no-death fixed-round window where killing-blow order is irrelevant.
2. **RNG stream keyed by `ownerId`** (`attacker` vs `e:...`): the same physical ship draws different crit sequences by side. **Control:** neutralize RNG — set `crit = 0` (and any other RNG-gated stat) on all placements via `statOverrides`, making damage deterministic and stream-independent. FINDING-001's bug is RNG-independent (an exec-path gap), so it STILL shows under crit=0.

**Redesign sketch:** `checkTeamSymmetry(input, seed)` builds a CONTROLLED mirror — crit=0 on every placement, distinct descending speeds, enough HP / few enough rounds that no ship dies — runs original + mirror under the same seed, and compares each PHYSICAL ship's total `damageDealt` across the swap (matched by (side,position)→mirrored-(side,position), NOT by actorId, since `playerTeam[0]` always mints `'attacker'`). A correct engine → equal; an exec-path asymmetry (FINDING-001 class) → flagged. This lives OUTSIDE the always-green Task-11 gate (charge-detonation ships fail it until the engine bug is fixed); it belongs in the Task-10 discovery pass as a finding-generator. Give this its own brainstorm → plan before implementing — the control set may need iteration to reach zero false-positives on a known-good engine.
