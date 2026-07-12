# SP-0 — Sim-Golden Harness + RNG-Stream Decoupling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decouple the seeded test RNG into per-actor keyed sub-streams so later fidelity PRs get local golden churn, and capture four `BattleResult` sim goldens as the epic's high-level regression guard. No gameplay change.

**Architecture:** Add an optional keyed layer to `rateAccumulator`: `makeRateGate(streamKey?)` draws from a per-key seeded `mulberry32` sub-stream **only in test mode when a key is supplied AND a keyed provider is installed**; otherwise it draws from the existing `rng` (production `Math.random`, or the shared seeded stream for unkeyed test gates). This makes keying incremental and byte-identical for any un-keyed gate. Then thread stable `${actorId}:${purpose}` keys into the engine's per-actor gate instances, pay one audited golden regeneration, and snapshot four representative battles.

**Tech Stack:** TypeScript, Vitest, `mulberry32` PRNG, existing `simulateBattle`/`assembleBattleResult`.

## Global Constraints

- **Production RNG untouched:** `rng` defaults to `Math.random`; the keyed provider is installed ONLY by `setupTests.ts`. Production never supplies a keyed provider → `makeRateGate(key)` falls back to `rng()` exactly as today.
- **Two golden tiers, `vitest -u` forbidden** except the single audited draw-reassignment move in Task 4 (must be pure reassignment — same events/actors/rounds, only crit/land booleans flip).
- **Team-symmetric**, `audit:skills` stays at 0 findings, lint (`max-warnings: 0`) + tsc clean.
- **Workflow:** `gh auth switch --user TheSusort` before any PR op; `docs/` is gitignored (`git add -f`, docs-only commits `--no-verify`); the pre-commit hook runs the FULL vitest suite; ensure the main repo's `.env` is present (see worktree gotcha) before running the suite.

---

### Task 1: Keyed-RNG primitive in `rateAccumulator`

**Files:**
- Modify: `src/utils/calculators/rateAccumulator.ts`
- Test: `src/utils/calculators/__tests__/rateAccumulator.test.ts` (create if absent)

**Interfaces:**
- Produces:
  - `makeRateGate(streamKey?: string): (rate: number) => boolean` — unchanged behavior when `streamKey` omitted; keyed draw when supplied and a provider is installed.
  - `makeKeyedRng(baseSeed: number): (key: string) => number` — returns a function that lazily mints one `mulberry32` sub-stream per key and returns its next draw.
  - `setKeyedRng(provider: ((key: string) => number) | null): void` — install/clear the keyed provider (test-only).
  - `resetRateGateRng()` also clears the keyed provider.

- [ ] **Step 1: Write the failing tests**

```ts
// src/utils/calculators/__tests__/rateAccumulator.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import {
    makeRateGate, makeKeyedRng, setKeyedRng, setRateGateRng, resetRateGateRng, mulberry32,
} from '../rateAccumulator';

afterEach(() => resetRateGateRng());

describe('makeKeyedRng', () => {
    it('same key yields a reproducible sequence; different keys are independent', () => {
        const a1 = makeKeyedRng(123);
        const a2 = makeKeyedRng(123);
        // same base seed + same key → identical sequence
        expect([a1('x'), a1('x'), a1('x')]).toEqual([a2('x'), a2('x'), a2('x')]);
        // draining key 'x' must NOT shift key 'y' (independence / locality)
        const g = makeKeyedRng(123);
        const yFirst = makeKeyedRng(123)('y');
        g('x'); g('x'); g('x');
        expect(g('y')).toBe(yFirst);
    });
});

describe('makeRateGate keyed vs unkeyed', () => {
    it('unkeyed gate ignores the keyed provider and uses the shared rng', () => {
        setRateGateRng(mulberry32(0x5eed1234));
        setKeyedRng(makeKeyedRng(0x5eed1234));
        const unkeyed = makeRateGate();            // no key
        const shared = mulberry32(0x5eed1234);
        // unkeyed draw equals the shared-stream draw (keyed provider not consulted)
        expect(unkeyed(0.5)).toBe(shared() < 0.5);
    });

    it('a keyed gate draws from its own sub-stream', () => {
        setRateGateRng(mulberry32(0x5eed1234));
        setKeyedRng(makeKeyedRng(0x5eed1234));
        const gate = makeRateGate('p:1:crit');
        const stream = makeKeyedRng(0x5eed1234);
        expect(gate(0.5)).toBe(stream('p:1:crit') < 0.5);
    });

    it('with no keyed provider installed, a keyed gate falls back to rng (production path)', () => {
        setRateGateRng(mulberry32(0x5eed1234)); // keyed provider left null
        const gate = makeRateGate('p:1:crit');
        const shared = mulberry32(0x5eed1234);
        expect(gate(0.5)).toBe(shared() < 0.5);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/utils/calculators/__tests__/rateAccumulator.test.ts`
Expected: FAIL — `makeKeyedRng`/`setKeyedRng` are not exported yet.

- [ ] **Step 3: Implement the keyed layer**

```ts
// src/utils/calculators/rateAccumulator.ts — add below the existing rng/setters.

/** Installed only by the test bootstrap. Null in production → keyed gates fall back to `rng`. */
let keyedProvider: ((key: string) => number) | null = null;

/** Test-only: install (or clear) the keyed sub-stream provider. */
export function setKeyedRng(provider: ((key: string) => number) | null): void {
    keyedProvider = provider;
}

/** FNV-1a string hash → 32-bit seed offset, so each key deterministically seeds its own stream. */
function hashKey(key: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < key.length; i++) {
        h ^= key.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
}

/** Build a keyed RNG: lazily mints one mulberry32 sub-stream per key, seeded from base ^ hash(key). */
export function makeKeyedRng(baseSeed: number): (key: string) => number {
    const streams = new Map<string, () => number>();
    return (key: string): number => {
        let s = streams.get(key);
        if (!s) {
            s = mulberry32((baseSeed ^ hashKey(key)) >>> 0);
            streams.set(key, s);
        }
        return s();
    };
}
```

Then update `resetRateGateRng` and `makeRateGate`:

```ts
export function resetRateGateRng(): void {
    rng = Math.random;
    keyedProvider = null;
}

export function makeRateGate(streamKey?: string): (rate: number) => boolean {
    return (rate: number): boolean => {
        const draw =
            streamKey != null && keyedProvider != null ? keyedProvider(streamKey) : rng();
        return draw < Math.min(1, Math.max(0, rate));
    };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/utils/calculators/__tests__/rateAccumulator.test.ts`
Expected: PASS (all four).

- [ ] **Step 5: Commit**

```bash
git add src/utils/calculators/rateAccumulator.ts src/utils/calculators/__tests__/rateAccumulator.test.ts
git commit --no-verify -m "feat(combat): keyed RNG sub-streams in rateAccumulator (SP-0)"
```

---

### Task 2: Install the keyed provider in the test bootstrap

**Files:**
- Modify: `src/setupTests.ts:30-34`
- Test: `src/utils/calculators/__tests__/rateAccumulator.test.ts` (add one bootstrap-integration case)

**Interfaces:**
- Consumes: `makeKeyedRng`, `setKeyedRng` (Task 1).
- Produces: after this task, every test runs with BOTH the shared seeded `rng` (for unkeyed gates) AND a keyed provider seeded from the same `RATE_GATE_TEST_SEED` (for keyed gates).

- [ ] **Step 1: Write the failing test**

```ts
// append to rateAccumulator.test.ts
import { setupKeyedTestRng } from '../rateAccumulator'; // helper we will add

it('the test bootstrap helper installs a keyed provider seeded from the base seed', () => {
    setupKeyedTestRng(0x5eed1234);
    const gate = makeRateGate('e:2:landing');
    const expected = makeKeyedRng(0x5eed1234);
    expect(gate(0.5)).toBe(expected('e:2:landing') < 0.5);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/utils/calculators/__tests__/rateAccumulator.test.ts -t bootstrap`
Expected: FAIL — `setupKeyedTestRng` not exported.

- [ ] **Step 3: Add the bootstrap helper and wire setupTests**

```ts
// rateAccumulator.ts — one helper so setupTests and tests install identically.
export function setupKeyedTestRng(seed: number): void {
    setRateGateRng(mulberry32(seed));
    setKeyedRng(makeKeyedRng(seed));
}
```

```ts
// src/setupTests.ts — replace the beforeEach body (was: setRateGateRng(mulberry32(RATE_GATE_TEST_SEED)))
import { setupKeyedTestRng, resetRateGateRng } from './utils/calculators/rateAccumulator';
// ...
beforeEach(() => {
    setupKeyedTestRng(RATE_GATE_TEST_SEED);
});
afterEach(() => {
    resetRateGateRng();
});
```

- [ ] **Step 4: Run to verify pass + confirm no unkeyed churn yet**

Run: `npx vitest run src/utils/calculators/__tests__/rateAccumulator.test.ts`
Expected: PASS.
Run: `npx vitest run src/utils/calculators/__tests__/healingGoldenParity.test.ts`
Expected: PASS, byte-identical — no gate is keyed yet, so unkeyed gates still use the shared stream.

- [ ] **Step 5: Commit**

```bash
git add src/setupTests.ts src/utils/calculators/rateAccumulator.ts src/utils/calculators/__tests__/rateAccumulator.test.ts
git commit --no-verify -m "test(combat): install keyed RNG provider in test bootstrap (SP-0)"
```

---

### Task 3: Thread `${actorId}:${purpose}` keys into the per-actor gate sites

**Files:**
- Modify: `src/utils/combat/engine.ts` (gate creation sites 581-586, 1619-1626, 1812-1817; `rollRateGate` call sites)
- Modify: `src/utils/calculators/rateAccumulator.ts` consumer `rollRateGate` (pass the map key into `makeRateGate`) — same file as Task 1
- Modify: `src/utils/combat/triggers.ts:1715, 2393, 2423` (reactive gates — key by owner id in scope)
- Modify: `src/utils/combat/playerTurn.ts:280` (correct the stale `// determinism isolation` comment)
- Test: `src/utils/combat/__tests__/rngLocality.test.ts` (create)

**Interfaces:**
- Consumes: `makeRateGate(streamKey)` (Task 1).
- Produces: every per-actor gate draws from a distinct stream. Key convention: `${actorId}:${purpose}` where `purpose ∈ {active-crit, charged-crit, active-heal-crit, charged-heal-crit, landing, extend, proc, counter-crit, convert}`.

- [ ] **Step 1: Write the failing locality test**

```ts
// src/utils/combat/__tests__/rngLocality.test.ts
// Locality invariant: increasing ONE actor's draw count must not change ANOTHER actor's outcomes.
// Construct a tiny 1v1-per-side battle where actor E2 acts independently of E1; give E1 an extra
// proc-gated self-buff (adds an E1 draw each turn, gameplay-inert to E2 — self shield, no deaths).
// Under keyed streams E2's per-round damageDealt is identical with/without E1's extra draw.
import { describe, it, expect } from 'vitest';
import { simulateBattle } from '../../calculators/battleSimulator';
import { baseLocalityInput, withExtraE1Draw } from './__fixtures__/rngLocalityFixture';

describe('RNG stream locality', () => {
    it("perturbing E1's draw count leaves E2's per-round damage unchanged", () => {
        const a = simulateBattle(baseLocalityInput());
        const b = simulateBattle(withExtraE1Draw());
        const e2 = (r: ReturnType<typeof simulateBattle>) =>
            r.rounds.map((rd) => rd.ships.find((s) => s.actorId.startsWith('e:') && s.name === 'E2')?.damageDealt ?? 0);
        expect(e2(b)).toEqual(e2(a));
    });
});
```

Create `src/utils/combat/__tests__/__fixtures__/rngLocalityFixture.ts` following the Ship/`placement`/`BattleSimulationInput` pattern in `src/utils/calculators/__tests__/battleSimulatorDefenseSubstitution.test.ts`: two enemies E1, E2 with intermediate crit (e.g. 50), a short `rounds: 3` battle with HP high enough that nothing dies; `baseLocalityInput` = plain kits; `withExtraE1Draw` = E1 additionally carries a self-only `on-cast` proc-chance buff (e.g. 50% self shield) so E1 rolls one extra gate per turn.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/utils/combat/__tests__/rngLocality.test.ts`
Expected: FAIL — gates are still unkeyed (shared stream), so E1's extra draw shifts E2's crit draws.

- [ ] **Step 3: Key the gate sites**

Pattern (apply at every per-actor gate instance — the actor id is in scope at each site):

```ts
// engine.ts ~1619 (focus attacker — `const focusActorId = 'attacker'` is in scope from :1497):
const activeCritGate = makeRateGate(`${focusActorId}:active-crit`);
const chargedCritGate = makeRateGate(`${focusActorId}:charged-crit`);
const activeHealCritGate = makeRateGate(`${focusActorId}:active-heal-crit`);
const chargedHealCritGate = makeRateGate(`${focusActorId}:charged-heal-crit`);
const debuffLandingGate = makeRateGate(`${focusActorId}:landing`);
const extendChanceGate = makeRateGate(`${focusActorId}:extend`);
```

Apply the same shape at:
- `engine.ts:1812-1817` — per-team-actor loop; the walked team actor's id `t.id` is in scope (`${t.id}:active-crit`, etc.).
- `engine.ts:581-586` — enemy runtime builder (`buildEnemyPlayerActorRuntime`); the enemy input `e.id` is in scope (`${e.id}:active-crit`, etc.).
- `engine.ts:3558` — key with the owner id in scope at that site; if none is stable, leave UNKEYED (documented — falls back to shared stream, still correct).
- `triggers.ts:1715, 2393, 2423` — reactive gates; key with `${intent.ownerId}:proc` / `:convert` / `:extend` (owner id is in scope at the drain site).
- `rollRateGate` (`rateAccumulator.ts`): change `gate = makeRateGate()` → `gate = makeRateGate(key)` (the per-key map already passes `${rid}:${abilityId}` / `${a.id}:${abilityId}` — reuse it verbatim).

Fix the stale comment at `playerTurn.ts:280` (`// own instances — determinism isolation`) → note that stream isolation now comes from `makeRateGate` stream keys, not instance identity.

Use the exact `purpose` label matching each gate's role so keys are stable and self-documenting.

- [ ] **Step 4: Run to verify the locality test passes**

Run: `npx vitest run src/utils/combat/__tests__/rngLocality.test.ts`
Expected: PASS — E2 unaffected by E1's extra draw.

- [ ] **Step 5: Commit**

```bash
git add src/utils/combat/engine.ts src/utils/combat/triggers.ts src/utils/combat/playerTurn.ts src/utils/calculators/rateAccumulator.ts src/utils/combat/__tests__/rngLocality.test.ts src/utils/combat/__tests__/__fixtures__/rngLocalityFixture.ts
git commit --no-verify -m "feat(combat): key per-actor RNG gates by actor+purpose (SP-0)"
```

---

### Task 4: The one audited draw-reassignment golden move

**Files:**
- Modify (regenerate): the synthetic DPS/healing golden snapshots and any test with an intermediate-rate probabilistic assertion that flipped.
- Test: full suite.

**Interfaces:** none new. This task reconciles the suite to the keyed streams.

- [ ] **Step 1: Run the full suite and catalogue every failure**

Run: `npm test 2>&1 | tee /tmp/sp0-churn.txt`
Expected: FAILs limited to tests whose assertions depend on a specific INTERMEDIATE crit/landing/proc outcome (rates of exactly 0 or ≥1 are stream-independent and must NOT move — if one moves, a key is wrong).

- [ ] **Step 2: Audit each failure is pure draw-reassignment**

For each failing golden/assertion, confirm the diff changes only crit/land/proc booleans and their downstream numeric totals — NOT the set of events, actors, rounds, or targets. If any structural element changed, a gate was mis-keyed (e.g., a key that isn't stable across runs): fix the key, do not accept the diff.

- [ ] **Step 3: Regenerate the audited goldens**

For confirmed pure-reassignment snapshot goldens only:

Run: `npx vitest run <specific golden file> -u`
For hand-written inline assertions that flipped, update the expected number to the new value, noting in the commit that it is a draw-reassignment.

- [ ] **Step 4: Re-run the full suite green**

Run: `npm test`
Expected: PASS. `npm run lint` and `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit (document the move)**

```bash
git add -A
git commit --no-verify -m "test(combat): audited RNG-reassignment golden move for keyed streams (SP-0)

One-time regeneration: keying per-actor gates reassigns which sub-stream draw
each gate sees. Verified pure reassignment — same events/actors/rounds/targets,
only crit/land/proc booleans and their totals move. No gameplay change."
```

---

### Task 5: Build the four sim-golden fixtures

**Files:**
- Create: `src/utils/calculators/__tests__/__fixtures__/simGoldenFixtures.ts`
- Test: `src/utils/calculators/__tests__/simGolden.smoke.test.ts`

**Interfaces:**
- Produces: `twoVsTwo()`, `threeVsThree()`, `dpsMode()`, `healingMode()` — each returns a `BattleSimulationInput`.

- [ ] **Step 1: Write the smoke test**

```ts
// src/utils/calculators/__tests__/simGolden.smoke.test.ts
import { describe, it, expect } from 'vitest';
import { simulateBattle } from '../battleSimulator';
import { twoVsTwo, threeVsThree, dpsMode, healingMode } from './__fixtures__/simGoldenFixtures';

describe('sim-golden fixtures run', () => {
    it.each([['2v2', twoVsTwo], ['3v3', threeVsThree], ['dps', dpsMode], ['heal', healingMode]])(
        '%s produces a well-formed BattleResult',
        (_name, build) => {
            const r = simulateBattle(build());
            expect(r.roster.length).toBeGreaterThan(0);
            expect(r.rounds.length).toBeGreaterThan(0);
            expect(['player', 'enemy', 'draw']).toContain(r.outcome.winner);
        }
    );
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/utils/calculators/__tests__/simGolden.smoke.test.ts`
Expected: FAIL — fixtures module missing.

- [ ] **Step 3: Build the fixtures**

Create `simGoldenFixtures.ts` following the exact Ship/`placement`/`BattleSimulationInput` construction pattern in `battleSimulatorDefenseSubstitution.test.ts` (hand-built `Ship` with verbatim skill text, `baseStats`, `refits`; `placement(ship, position)` with `statOverrides` mirroring baseStats). Each fixture uses fixed stats (intermediate crit ~50 so RNG is exercised) and `rounds: 8`:

- `twoVsTwo()`: player = an attacker + a supporter; enemy = two attackers; include one DoT-applier and one bomb-applier so DoT ticks + detonation fire. Positions: player M4/M1, enemy T4/T1.
- `threeVsThree()`: include an AoE-pattern attacker, a reactive ship (counter/on-attacked), and a support/hybrid ship whose incidental damage currently hits the dummy sink. Spread positions across rows so AoE footprints cover multiple cells.
- `dpsMode()`: a single focus attacker vs ONE skill-less enemy ship (a `Ship` with empty skill text), default stats — the SP-U DPS-calc opponent shape. `rounds: 8`.
- `healingMode()`: player = a healer + a tank (Defender); enemy = two attackers that inflict debuffs against the tank's security. Exercises heal routing + landing rolls.

Reuse the shared `placement`/stat-override helper; keep ship ids/names stable (they seed the RNG keys).

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/utils/calculators/__tests__/simGolden.smoke.test.ts`
Expected: PASS (all four).

- [ ] **Step 5: Commit**

```bash
git add src/utils/calculators/__tests__/__fixtures__/simGoldenFixtures.ts src/utils/calculators/__tests__/simGolden.smoke.test.ts
git commit --no-verify -m "test(combat): four sim-golden fixtures + smoke test (SP-0)"
```

---

### Task 6: Capture the four `BattleResult` sim goldens

**Files:**
- Test: `src/utils/calculators/__tests__/simGolden.test.ts`
- Create (generated): `src/utils/calculators/__tests__/__snapshots__/simGolden.test.ts.snap`

**Interfaces:**
- Consumes: the four fixtures (Task 5), `simulateBattle`.

- [ ] **Step 1: Write the snapshot test**

```ts
// src/utils/calculators/__tests__/simGolden.test.ts
import { describe, it, expect } from 'vitest';
import { simulateBattle } from '../battleSimulator';
import { twoVsTwo, threeVsThree, dpsMode, healingMode } from './__fixtures__/simGoldenFixtures';

// High-level regression guard for the engine-unification epic. A diff = a real behavior change.
// vitest -u is FORBIDDEN except a deliberate, audited fidelity move (SP-F).
describe('sim goldens (BattleResult snapshots)', () => {
    it.each([
        ['2v2', twoVsTwo], ['3v3', threeVsThree], ['dps', dpsMode], ['healing', healingMode],
    ])('%s', (_n, build) => {
        // Snapshot the structured result (per-round per-ship totals + outcome), not the free-text log.
        const { rounds, outcome, roster } = simulateBattle(build());
        expect({ rounds, outcome, roster }).toMatchSnapshot();
    });
});
```

- [ ] **Step 2: Generate the snapshot (first run writes it)**

Run: `npx vitest run src/utils/calculators/__tests__/simGolden.test.ts`
Expected: PASS — snapshot written on first run. Open the `.snap` and sanity-check: non-zero damage on both sides, plausible `outcome`, roster matches the fixtures.

- [ ] **Step 3: Verify stability (second run must match)**

Run: `npx vitest run src/utils/calculators/__tests__/simGolden.test.ts`
Expected: PASS — identical, proving the seeded trajectory is reproducible.

- [ ] **Step 4: Commit**

```bash
git add src/utils/calculators/__tests__/simGolden.test.ts src/utils/calculators/__tests__/__snapshots__/simGolden.test.ts.snap
git commit --no-verify -m "test(combat): capture four BattleResult sim goldens (SP-0)"
```

---

### Task 7: Final verification

**Files:** none (verification only).

- [ ] **Step 1: Full suite**

Run: `npm test`
Expected: PASS (all, including the new rateAccumulator, rngLocality, smoke, and sim-golden tests).

- [ ] **Step 2: Lint + types**

Run: `npm run lint && npx tsc --noEmit`
Expected: no warnings, no errors.

- [ ] **Step 3: Skill audit unchanged**

Run: `npm run audit:skills`
Expected: `Audited N ships → 0 findings.`

- [ ] **Step 4: Confirm production RNG path untouched**

Verify by inspection: `makeRateGate` with no installed keyed provider (production) returns `rng()` = `Math.random`. Grep confirms no non-test caller of `setKeyedRng`/`setupKeyedTestRng`:

Run: `grep -rn "setKeyedRng\|setupKeyedTestRng" src | grep -v "__tests__\|setupTests"`
Expected: no output.

- [ ] **Step 5: Update the changelog**

Skip a user-facing changelog entry — SP-0 has no gameplay/UI change (test-infrastructure only). Note it in the PR body instead.

---

## Self-review notes

- **Spec coverage:** Part A (RNG decouple) = Tasks 1–4; Part B (sim goldens) = Tasks 5–6; acceptance-#2 locality demonstration = Task 3's `rngLocality` test; acceptance-#3 audited move = Task 4; acceptance-#4 four goldens = Task 6; acceptance-#5 clean suite/lint/tsc/audit = Task 7.
- **Keying granularity:** the spec left per-actor vs per-actor-per-purpose to a spike; this plan resolves it to the finest safe key (`${actorId}:${purpose}`) — finer keying strictly increases locality and never harms correctness, so no gamble remains. The `rngLocality` test empirically confirms locality.
- **Context-less gates:** `engine.ts:3558` and any reactive gate without a stable owner id in scope are explicitly allowed to stay UNKEYED (fall back to the shared stream, byte-identical) rather than invent an unstable key.
- **Placeholder scan:** fixture ship internals reference the concrete in-repo template (`battleSimulatorDefenseSubstitution.test.ts`) rather than inventing a new Ship-building convention — this is grounding, not a TODO.
