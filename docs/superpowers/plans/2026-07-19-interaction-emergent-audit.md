# Interaction / Emergent Combat Audit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a deterministic fuzzing + invariant/differential/ablation audit harness that hunts multi-ship interaction bugs the single-ship ship-kit correctness epic could not see, emitting a triageable ledger and a permanent regression gate.

**Architecture:** Pure oracle/fuzzer logic lives in `src/utils/combat/audit/` (so the `src` regression test imports it directly — no `src → scripts` dependency). A thin CLI in `scripts/` loads `docs/ship-data.json`, drives the pure modules, and writes the ledger. Everything runs through the existing `simulateBattle`, which is fully deterministic (no `Math.random`), so cross-run diffs are exact.

**Tech Stack:** TypeScript, Vitest (`npm test`), `tsx` (script runner), the existing combat engine (`simulateBattle`).

## Global Constraints

- **Determinism, always:** No `Math.random`, no `Date.now()`, no argless `new Date()` anywhere in harness code (engine + scripts convention). The fuzzer uses a seeded PRNG (`mulberry32`). Copied verbatim from spec.
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
  ├── classes.ts        # tagShip(ship): Set<InteractionClass> — derived from buildShipAbilities
  ├── invariants.ts     # checkInvariants(input, result): InvariantViolation[]
  ├── fingerprint.ts    # fingerprintActor(result, actorId) + diffFingerprints + runDifferential
  ├── ablation.ts       # runAblation(a, b, rosterById): AblationResult
  ├── compose.ts        # mulberry32 PRNG + composeBattle(seed, pools): BattleSimulationInput
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

## Task 3: Invariant catalog — HP bounds, no-dead-acts, determinism

**Files:**
- Create: `src/utils/combat/audit/invariants.ts`
- Test: `src/utils/combat/audit/__tests__/invariants.test.ts`

**Interfaces:**
- Consumes: `InvariantViolation` (Task 1); `BattleSimulationInput`, `BattleResult`, `simulateBattle` (existing).
- Produces: `checkInvariants(input: BattleSimulationInput, result: BattleResult): InvariantViolation[]`.

**Note:** These three read only `result.rounds[].ships[]` (`hpPct`, `shieldPct`, `alive`) and `result.rounds[].turnOrder`, plus a second `simulateBattle` call for determinism. Build a small in-test battle from two real ships via `canonicalPlacement`; do NOT hand-forge a `BattleResult` (it must come from the engine to be meaningful).

- [ ] **Step 1: Write the failing test**

Create `src/utils/combat/audit/__tests__/invariants.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { checkInvariants } from '../invariants';
import { canonicalPlacement } from '../fixtures';
import { simulateBattle, type BattleSimulationInput } from '../../../calculators/battleSimulator';
import { loadShipDataByName } from '../../../../../scripts/lib/shipDataSnapshot';

const ships = loadShipDataByName();
const battle = (): BattleSimulationInput => ({
    playerTeam: [canonicalPlacement(ships.get('Vindicator') as never, 'T1')],
    enemyTeam: [canonicalPlacement(ships.get('Vindicator') as never, 'T1')],
    rounds: 20,
});

describe('checkInvariants — core three', () => {
    it('reports no violations for a normal deterministic battle', () => {
        const input = battle();
        const result = simulateBattle(input);
        expect(checkInvariants(input, result)).toEqual([]);
    });

    it('flags an hpPct outside [0,100]', () => {
        const input = battle();
        const result = simulateBattle(input);
        // Corrupt one round's ship state to prove the check fires.
        result.rounds[0].ships[0].hpPct = 140;
        const v = checkInvariants(input, result);
        expect(v.some((x) => x.invariant === 'hp-bounds')).toBe(true);
    });

    it('flags a dead actor appearing in turnOrder', () => {
        const input = battle();
        const result = simulateBattle(input);
        const dead = result.rounds[0].ships[0];
        dead.alive = false;
        result.rounds[0].turnOrder = [dead.actorId];
        const v = checkInvariants(input, result);
        expect(v.some((x) => x.invariant === 'no-dead-acts')).toBe(true);
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest --run src/utils/combat/audit/__tests__/invariants.test.ts`
Expected: FAIL — cannot find module `../invariants`.

- [ ] **Step 3: Implement the three invariants**

Create `src/utils/combat/audit/invariants.ts`:

```typescript
import type { InvariantViolation } from './types';
import { simulateBattle, type BattleSimulationInput, type BattleResult } from '../../calculators/battleSimulator';

function hpBounds(result: BattleResult): InvariantViolation[] {
    const out: InvariantViolation[] = [];
    for (const r of result.rounds) {
        for (const s of r.ships) {
            if (s.hpPct < 0 || s.hpPct > 100) {
                out.push({
                    invariant: 'hp-bounds',
                    round: r.round,
                    actorId: s.actorId,
                    detail: `hpPct ${s.hpPct} outside [0,100]`,
                });
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
                out.push({
                    invariant: 'no-dead-acts',
                    round: r.round,
                    actorId,
                    detail: `dead actor ${actorId} present in turnOrder`,
                });
            }
        }
    }
    return out;
}

function determinism(input: BattleSimulationInput, result: BattleResult): InvariantViolation[] {
    const rerun = simulateBattle(input);
    const a = JSON.stringify(result);
    const b = JSON.stringify(rerun);
    if (a !== b) {
        return [{ invariant: 'determinism', round: 0, detail: 'two runs of the same input diverged' }];
    }
    return [];
}

export function checkInvariants(input: BattleSimulationInput, result: BattleResult): InvariantViolation[] {
    return [...hpBounds(result), ...noDeadActs(result), ...determinism(input, result)];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest --run src/utils/combat/audit/__tests__/invariants.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/utils/combat/audit/invariants.ts src/utils/combat/audit/__tests__/invariants.test.ts
git commit -m "feat(interaction-audit): invariant catalog — hp-bounds, no-dead-acts, determinism"
```

---

## Task 4: Invariant catalog — stack caps, damage conservation, team symmetry

**Files:**
- Modify: `src/utils/combat/audit/invariants.ts`
- Modify: `src/utils/combat/audit/__tests__/invariants.test.ts`

**Interfaces:**
- Consumes: everything from Task 3.
- Produces: extends `checkInvariants` with `stack-caps`, `damage-conservation`, `team-symmetry`.

**Note on damage-conservation (see Global Constraints — Protection caveat):** assert per-round `Σ ships.damageDealt ≈ Σ ships.damageTaken` (allow a tiny float epsilon), but SKIP any round where a Protection redirect was active. Detect a Protection round from `result.combatLog` (a redirect/protection entry) — find the real marker at implement time (`grep -rn "protection\|redirect" src/utils/combat/log`). If no reliable marker exists, restrict the invariant to compositions with zero `protection-redirect`-tagged ships (pass that flag into `checkInvariants`). Prefer the log marker.

**Note on stack-caps:** for each round, no `activeBuffs` entry may exceed its declared cap. Persistent-stacking caps live in `src/constants/persistentStackingBuffs.ts`. `activeBuffs: string[]` may encode stacks as repeated names or `Name xN` — inspect a real battle's `activeBuffs` shape first (`console.log` one round) and parse accordingly.

**Note on team-symmetry:** build a mirror input (swap `playerTeam`↔`enemyTeam`, keep positions), run both, and assert the mirrored outcome winner flips consistently and per-actor `damageDealt` totals match across the swap. This is the invariant most likely to surface HARNESS asymmetry first — see Task 10's calibration gate.

- [ ] **Step 1: Write failing tests** for the three new invariants (extend the existing `describe`). Craft each: a hand-corrupted `activeBuffs` exceeding a known cap → `stack-caps`; a corrupted round where `ΣdamageDealt` and `ΣdamageTaken` diverge on a NON-protection battle → `damage-conservation`; a deliberately asymmetric stubbed pair of results → `team-symmetry`. Use the same real-ship battle builder as Task 3.

```typescript
// append to invariants.test.ts
describe('checkInvariants — conservation & symmetry', () => {
    it('flags a per-round damageDealt/damageTaken mismatch on a non-protection battle', () => {
        const input = battle(); // two Vindicators — no Protection
        const result = simulateBattle(input);
        result.rounds[0].ships[0].damageDealt += 5000; // break the ledger
        const v = checkInvariants(input, result);
        expect(v.some((x) => x.invariant === 'damage-conservation')).toBe(true);
    });
    // + stack-caps test + team-symmetry test (see Notes for construction)
});
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `npx vitest --run src/utils/combat/audit/__tests__/invariants.test.ts`
Expected: FAIL — new invariant ids not produced yet.

- [ ] **Step 3: Implement the three invariants** and add them to `checkInvariants`'s spread. `damageConservation` iterates rounds, computes both sums, skips Protection rounds, and pushes on `Math.abs(dealt - taken) > 1`. `stackCaps` parses `activeBuffs` against the persistent-stacking cap table. `teamSymmetry` runs the mirror input and compares. Keep each a pure named function following Task 3's shape.

- [ ] **Step 4: Run to verify all pass**

Run: `npx vitest --run src/utils/combat/audit/__tests__/invariants.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add src/utils/combat/audit/invariants.ts src/utils/combat/audit/__tests__/invariants.test.ts
git commit -m "feat(interaction-audit): invariants — stack-caps, damage-conservation, team-symmetry"
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

**Note:** `fingerprintActor` walks `result.combatLog` (rounds → `startOfRound`/`turns`/`endOfRound` → entries and their nested `reactions`) collecting the `kind` of every entry whose `actorId` matches — the multi-round analog of `collectActorEntryKinds` (`scripts/lib/kitBundle.ts:52`). Resolve the composition actorId via `compResult.roster` (match by ship name + position), NEVER assume `'attacker'`.

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
- Consumes: `fingerprintActor` (Task 5); `AblationResult` (Task 1); `canonicalPlacement`; `simulateBattle`.
- Produces: `runAblation(a: Ship, b: Ship): AblationResult` — runs `{a}`, `{b}`, `{a,b}` (a as focus, b as ally, both vs a fixed neutral enemy) and reports whether a's or b's fingerprint in the combined run contains kinds absent from its own solo run.

**Note:** ablation is the NOISIEST oracle (real synergy looks like divergence), so it never emits a confirmed Finding — its output lands in the ledger's `needsTriage` bucket (Task 9/10). The test asserts the MECHANIC (divergence detection), not any specific real-ship result.

- [ ] **Step 1: Write the failing test** — use two ships where combining plausibly changes behavior; assert `runAblation` returns an `AblationResult` with a boolean `diverges` and a non-empty `detail`. Keep the assertion structural (shape), not value-specific, to avoid coupling to engine specifics.

- [ ] **Step 2: Run to verify it fails.** Expected: cannot find module `../ablation`.

- [ ] **Step 3: Implement `runAblation`:** build three `BattleSimulationInput`s via `canonicalPlacement` against one fixed neutral enemy ship (a plain attacker), `simulateBattle` each, `fingerprintActor` a and b in the combined vs their solo runs (resolve actorIds via each result's `roster`), set `diverges = extraInCombined.length > 0` for either, and compose `detail`.

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
- Consumes: `InteractionClass`, `canonicalPlacement`; `Ship`, `Position`, `BattleSimulationInput`.
- Produces:
  - `mulberry32(seed: number): () => number` — pure PRNG in [0,1).
  - `composeBattle(seed: number, tagged: { ship: Ship; classes: Set<InteractionClass> }[]): BattleSimulationInput`

**Note:** valid slots are the game's positions — reuse the position list from `traceScenario.ts` / `src/types/encounters` (confirm the exact `Position` literals). 4 ships/side, distinct positions per side. Draw policy: pick a primary class present in the corpus, draw the first ship from that class's pool, then fill remaining 7 slots biased (decaying probability) toward the same/adjacent classes; fall back to any ship so the battle always fills. Ships MAY repeat across sides but not within a side's position set.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { mulberry32, composeBattle } from '../compose';

describe('mulberry32', () => {
    it('is deterministic for a given seed', () => {
        const a = mulberry32(42);
        const b = mulberry32(42);
        expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    });
});

describe('composeBattle', () => {
    it('produces an identical composition for the same seed', () => {
        const tagged = /* build from loadShipDataByName + tagShip */ [] as never;
        const one = composeBattle(7, tagged);
        const two = composeBattle(7, tagged);
        expect(JSON.stringify(one)).toEqual(JSON.stringify(two));
        expect(one.playerTeam).toHaveLength(4);
        expect(one.enemyTeam).toHaveLength(4);
        const positions = one.playerTeam.map((p) => p.position);
        expect(new Set(positions).size).toBe(4); // distinct slots per side
    });
});
```

- [ ] **Step 2: Run to verify it fails.** Expected: cannot find module `../compose`.

- [ ] **Step 3: Implement `mulberry32` + `composeBattle`.**

```typescript
export function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return function () {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
// composeBattle: use rng = mulberry32(seed); draw primary class, ships, slots per the policy note.
```

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

**Calibration gate (the spec's Wave-0 step):** the CLI's FIRST action, before any fuzzing, is a self-check: run a battery of `count` compositions containing ONLY ships with an empty class tag set (inert ships), and assert `checkInvariants` + `runDifferential` return zero findings. If the inert battery produces findings, those are HARNESS asymmetries (focus-vs-walked instrumentation, symmetry setup) — the CLI prints `CALIBRATION FAILED` with the offending invariant and exits non-zero WITHOUT writing a ledger. Only once calibration is clean does it fuzz the real tagged corpus. This prevents harness noise from polluting the findings ledger.

- [ ] **Step 1: Write the CLI** — parse `--seed`/`--count`; `loadShipDataRecords()`; `tagShip` each; run the calibration gate (inert-only battery); on pass, for each seed in `[seed, seed+count)`: `composeBattle` → `simulateBattle` → `checkInvariants` + differential (per player ship vs its `buildStandardScenario` solo) + ablation on top tagged pairs; `minimizeComposition` any invariant/differential violation; collect `Finding`s; `writeLedger`. Print `compositionsRun`, `confirmed`, `needsTriage` counts.

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
- Consumes: `checkInvariants`, `composeBattle`, `tagShip`, `canonicalPlacement`, `loadShipDataRecords`, `simulateBattle`.

**Note:** this runs inside `npm test` (the golden audit). It fuzzes a FIXED small seed set (e.g. seeds 1–25) over the real tagged corpus and asserts `checkInvariants` returns `[]` for every composition. Plus: any minimized repro discovered by the Task-10 run that turned out to be a real bug gets added here as an explicit named case after its fix ships (seed pinned). Keep the seed count small enough to stay well under a few seconds so it doesn't bloat the suite.

- [ ] **Step 1: Write the test**

```typescript
import { describe, it, expect } from 'vitest';
import { checkInvariants } from '../audit/invariants';
import { composeBattle } from '../audit/compose';
import { tagShip } from '../audit/classes';
import { simulateBattle } from '../../calculators/battleSimulator';
import { loadShipDataRecords } from '../../../../scripts/lib/shipDataSnapshot';

const tagged = loadShipDataRecords().map((ship) => ({ ship, classes: tagShip(ship as never) }));

describe('interaction invariants regression gate', () => {
    for (let seed = 1; seed <= 25; seed++) {
        it(`seed ${seed} composition holds all invariants`, () => {
            const input = composeBattle(seed, tagged as never);
            const result = simulateBattle(input);
            expect(checkInvariants(input, result)).toEqual([]);
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
- Oracle A (invariants) → Tasks 3–4. Oracle B (differential) → Task 5. Oracle C (ablation) → Task 6. Fuzzer → Task 7. Minimizer → Task 8. Interaction-class tagging → Task 2. Canonical stats → Task 1. Discovery ledger → Task 9. CLI + calibration → Task 10. Regression gate → Task 11. Non-goals (no magnitude/gear/UI/auto-fix) honored throughout. ✅
- Risk: ablation triage → `needsTriage` bucket (Tasks 6, 9). Risk: harness-asymmetry calibration → explicit calibration gate (Task 10). ✅
- File-placement refinement (pure logic in `src/utils/combat/audit/`, not `scripts/lib/interaction/`) documented in File Structure with rationale (avoids `src → scripts` dep for the regression gate). ✅

**Placeholder scan:** Tasks 2, 4, 6, 9, 10 intentionally defer some exact property reads to implement-time discovery (real `Ability` shape, `activeBuffs` encoding, Protection log marker, `CombatLogTurn.entries` field name) with a concrete grep/inspection instruction each — these are unknowable from the types alone and MUST be verified against live shapes, not guessed. All algorithmic logic and all testable contracts are concrete.

**Type consistency:** `Finding`/`InvariantViolation`/`FingerprintDiff`/`AblationResult`/`InteractionClass` defined once (Task 1), consumed unchanged downstream. `checkInvariants(input, result)`, `fingerprintActor(result, actorId)`, `composeBattle(seed, tagged)`, `minimizeComposition(input, stillFails)`, `tagShip(ship)`, `canonicalPlacement(ship, position)` signatures stable across all references. ✅
