# Enemy-Team Support PR 1 — Enemy Reactive Self-Buffs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make an enemy attacker's own reactive abilities fire in the healing calculator — fixing the reproduced "Chakara configured as an enemy shows no buffs" bug, where `start-of-round` self-buffs (Attack Up / Defense Up) silently never apply.

**Architecture:** Parallel enemy-side mirror of the player reactive machinery. A separate enemy intent queue + a second `registerReactiveListeners` registration scoped to enemy owners + a separate enemy `IntentExecContext` (enemy runtimes map, enemy-side recipient ids, enemy-side `isLowestSpeedAllyFor`). The shared per-intent context fields are factored out so the two drain paths are not copy-paste. The existing player path is untouched.

**Tech Stack:** TypeScript, Vitest. Combat engine lives in `src/utils/combat/` (`engine.ts`, `triggers.ts`, `playerTurn.ts`). Tests in `src/utils/calculators/__tests__/` and `src/utils/combat/__tests__/`.

**Spec:** `docs/superpowers/specs/2026-06-12-combat-engine-enemy-team-support-design.md` (§3.2 Gaps B + E, §4 PR 1).

---

## Background the implementer needs

- **The bug (verified):** an enemy attacker walks `runPlayerTurn` (Phase 4a), and `buildEnemyPlayerActorRuntime` (`engine.ts:~329-450`) already partitions its reactive abilities onto the runtime's `reactiveAbilities`. But those listeners are **never registered**: `reactivePerOwner` (`engine.ts:~1522`) is `'attacker'` + walked team only, the executor's `runtimesById` map (`engine.ts:~1556`) is player-only, and `executeIntent` (`triggers.ts:~727`) **throws** on an owner id it can't resolve. So an enemy's `start-of-round` self-buff never enqueues, and even if it did the executor would throw.

- **Why only start-of-round matters in PR1:** reactive listeners key on the owner's own events. In single-target healing mode the enemy is never attacked (the tank deals no return damage), so enemy-side `on-attacked` / `on-crit` / etc. do not occur. The one enemy-side event that fires every round is `round-started`. So PR1's observable surface is start-of-round self-buffs (Chakara). Other enemy reactive effect types (`damage`/`heal`/`charge`) are unreachable here and are explicitly out of scope (later PRs).

- **`isLowestSpeedAllyFor` (Gap E):** the enemy walk dispatch does NOT pass the closure today, so the gate defaults to `true` (`triggers.ts:~595`, `?? true`). Once PR1 builds an enemy `IntentExecContext`, it must supply an **enemy-side** lowest-speed set — otherwise reusing the player set (`lowestSpeedAllyIds`, `engine.ts:~1225`, omits enemy ids) would resolve `false` and wrongly suppress Chakara's lowest-speed-gated buff. A lone enemy is trivially slowest on its own side → must resolve `true`.

- **The drain closure:** `drainIntents` (`engine.ts:~2033`) builds ONE `IntentExecContext` literal and is called at three drain points: (a) start-of-round `engine.ts:~2164`, (b) per-turn `engine.ts:~2782`, (c) post-round `engine.ts:~2933`. PR1 refactors this single closure into a side-parameterized `drainQueue(queue, sideCtx)` and adds an enemy drain at the same points.

- **Golden discipline:** `healingGoldenParity.test.ts` and the DPS goldens are SYNTHETIC — any diff is a bug, NEVER `vitest -u`. Their enemy fixtures are bare-stat (no `shipSkills` → no reactive abilities) → empty enemy registration → byte-identical. Confirm, don't regenerate.

---

## File structure

| File | Responsibility | Change |
|------|----------------|--------|
| `src/utils/combat/engine.ts` | Combat loop; builds runtimes, registers reactive listeners, drains intents | Modify: add `enemyRuntimesById`, `lowestSpeedEnemyIds`, `enemyIntentQueue`, second `registerReactiveListeners`, refactor `drainIntents` → `drainQueue` + `drainEnemyIntents`, call enemy drain at the 3 drain points |
| `src/utils/combat/__tests__/enemyReactiveSelfBuffs.test.ts` | NEW — unit coverage for enemy reactive self-buffs at the engine level | Create |
| `src/utils/calculators/__tests__/healingGoldenParity.test.ts` | Golden parity | Confirm byte-identical (no `-u`) |
| `src/constants/changelog.ts` | `UNRELEASED_CHANGES` | Fold into the existing combat entry |
| `docs/skill-model-coverage.md` | §6 enemy-team-support item | Incrementally note PR1 shipped |

No new UI in PR1 (the rename + cap removal are PR2). `EnemyAttackerConfig` shape is unchanged.

---

## Conventions

- `gh auth switch --hostname github.com --user TheSusort` before any PR/merge/API op.
- `docs/` is gitignored → `git add -f` for plan/spec/coverage; the pre-commit hook runs the full vitest suite (`--no-verify` only for docs-only commits).
- Branch: `feat/combat-engine-enemy-team-support` off post-#101 main.
- Run a single test file with: `npx vitest run <path>`. Lint: `npm run lint` (max-warnings 0).

---

## Task 1: Branch + characterization test (RED baseline)

**Files:**
- Test: `src/utils/combat/__tests__/enemyReactiveSelfBuffs.test.ts` (create)

- [ ] **Step 1: Create the branch**

```bash
gh auth switch --hostname github.com --user TheSusort
git checkout main && git pull
git checkout -b feat/combat-engine-enemy-team-support
```

- [ ] **Step 2: Find the existing healing-engine test harness pattern**

Read an existing engine/healing test (e.g. `src/utils/calculators/__tests__/healingGoldenParity.test.ts` and any `barrier.test.ts` / hp-crossing test) to copy the exact way a test builds `ShipSkills` for an enemy attacker, calls `simulateHealing` / `runCombat`, and asserts on incoming damage. Reuse that harness — do NOT invent a new one. Note the helper that constructs an enemy attacker with `shipSkills` carrying a reactive ability.

- [ ] **Step 3: Write the failing test — enemy `start-of-round` self-buff raises incoming damage**

Construct an enemy attacker whose `shipSkills` carry a `start-of-round` self Attack Up buff (Chakara-shaped; build the ability the same way the existing reactive tests build a player `start-of-round` buff, but on the enemy). Run a 2-round healing sim against a heal target. Assert the enemy's round-2 damage to the tank is **higher** than a control enemy with no such buff (the buff folds into its attack at its turn). Keep the assertion on the *incoming/round damage delta*, not internal state, so it survives refactors.

```ts
// Shape (adapt to the real harness helpers):
it('applies an enemy attacker start-of-round self Attack Up to its own outgoing damage', () => {
    const withBuff = simulateHealing(inputWithEnemyStartOfRoundAttackUp);
    const control = simulateHealing(inputWithPlainEnemy);
    // round 2 incoming reflects the buffed enemy attack
    expect(incomingRound(withBuff, 2)).toBeGreaterThan(incomingRound(control, 2));
});
```

- [ ] **Step 4: Run the test — verify it FAILS (documents the bug)**

Run: `npx vitest run src/utils/combat/__tests__/enemyReactiveSelfBuffs.test.ts`
Expected: FAIL — the buff does not apply (incoming equal), OR a thrown `executeIntent: no runtime for intent ownerId` if the listener somehow enqueues. Either failure confirms the gap. Capture the exact failure mode in the test comment.

- [ ] **Step 5: Commit the red test**

```bash
git add src/utils/combat/__tests__/enemyReactiveSelfBuffs.test.ts
git commit -m "test(combat): failing test for enemy reactive self-buffs (Chakara-as-enemy bug)"
```

---

## Task 2: Enemy reactive infrastructure (the fix)

**Files:**
- Modify: `src/utils/combat/engine.ts` (runtime/listener setup ~1300-1560; drain closure ~2033-2135; drain calls ~2164, ~2782, ~2933)

- [ ] **Step 1: Build the enemy runtimes map and enemy-side lowest-speed set**

Place this **immediately after** the `enemyPlayerRuntimeByActorId` / `enemyAttackerActors` / `enemyAttackerActorIds` block (`engine.ts:~1319-1326`) — `enemyAttackerActors` and `enemyPlayerRuntimes` must already be defined. (Player `lowestSpeedAllyIds` is the mirror at `engine.ts:~1225`.)

```ts
// Enemy-side executor runtimes — a SEPARATE map (not merged into runtimesById, which
// drives leech scan / seeding / credit). Used only as the enemy IntentExecContext.runtimes.
const enemyRuntimesById = new Map<string, PlayerActorRuntime>(
    enemyPlayerRuntimes.map((rt) => [rt.actor.id, rt])
);
// Enemy-side lowest-speed set (Gap E): ties → all; a lone enemy is trivially slowest →
// resolves true on its own side. Empty in DPS mode (no enemy attackers).
const lowestSpeedEnemyIds = new Set<string>();
if (enemyAttackerActors.length > 0) {
    const minEnemySpeed = Math.min(...enemyAttackerActors.map((a) => a.stats.speed));
    for (const a of enemyAttackerActors) {
        if (a.stats.speed === minEnemySpeed) lowestSpeedEnemyIds.add(a.id);
    }
}
```

- [ ] **Step 2: Register a second set of reactive listeners for enemy owners**

After the existing `registerReactiveListeners({ ... perOwner: reactivePerOwner ... })` call (`engine.ts:~1546`), add a separate enemy queue and registration. The enemy listeners enqueue into the enemy queue; they share the same `isEnemySide` / `roleOf`.

```ts
// Enemy-side reactive listeners (enemy-team support PR1): enemy attackers' own reactive
// abilities (start-of-round self-buffs in healing mode) enqueue into a SEPARATE queue, drained
// with the enemy IntentExecContext. In DPS / bare-stat-enemy runs this is [] → no registration
// → byte-identical. roleOf/isEnemySide shared (an enemy listener that is itself ally-scoped
// would route within the enemy side once PR2 lands; in PR1 only round-started fires).
const enemyIntentQueue: Intent[] = [];
const enemyReactivePerOwner = enemyPlayerRuntimes.map((rt) => ({
    ownerId: rt.actor.id,
    reactiveAbilities: rt.reactiveAbilities,
}));
if (enemyReactivePerOwner.length > 0) {
    registerReactiveListeners({
        bus,
        perOwner: enemyReactivePerOwner,
        enqueue: (intent) => enemyIntentQueue.push(intent),
        isEnemySide,
        roleOf: (id) => roleByActorId.get(id),
    });
}
```

Confirm `registerReactiveListeners` holds no module-level state that breaks when called twice (it attaches bus subscriptions per call — read it to verify). Note the finding in a comment if relevant.

- [ ] **Step 2b: Run the full suite to confirm registration alone is inert for goldens**

Run: `npx vitest run src/utils/calculators/__tests__/healingGoldenParity.test.ts`
Expected: PASS, byte-identical (registration is gated on `enemyReactivePerOwner.length > 0`; goldens have bare-stat enemies). If any golden churns, STOP — a fixture carries enemy shipSkills and the premise is wrong; reassess before continuing.

- [ ] **Step 3: Refactor `drainIntents` into a side-parameterized `drainQueue`**

Convert the single `drainIntents` closure (`engine.ts:~2033`) so the per-intent `executeIntent(intent, {...})` call reads its **side-specific** fields from a passed `sideCtx`, while all shared fields stay captured from the round scope. Side-specific fields: `runtimes`, `playerIds`, `isLowestSpeedAllyFor`, `grantAllyCharges`.

```ts
interface ReactiveSideCtx {
    runtimes: Map<string, PlayerActorRuntime>;
    recipientIds: string[];           // → executeIntent ctx.playerIds (same-side recipients)
    isLowestSpeedAllyFor: (ownerId: string) => boolean;
    grantAllyCharges: (amount: number) => void;
}

const drainQueue = (queue: Intent[], sideCtx: ReactiveSideCtx): void => {
    let generation = 0;
    while (queue.length > 0) {
        if (++generation > MAX_INTENT_GENERATIONS) {
            throw new Error(/* keep existing message, reference `queue` */);
        }
        const batch = queue.splice(0, queue.length);
        for (const intent of batch) {
            executeIntent(intent, {
                // ---- shared (unchanged from today) ----
                round: r, enemy, enemyId: enemy.id, statusEngine, bus,
                corrosionEntries, infernoEntries, pendingBombs,
                grantExtraAction, enemyAttackerIds: enemyAttackerActorIds,
                lastTurnCtxByActor, enemyType, enemyHp,
                cumulativeDamage: /* the existing map-sum expression */,
                recordResisted: /* existing */,
                creditReactiveDamage: (ownerId, amount) => creditDamage(ownerId, 'direct', amount),
                healing: healingCtx,
                oncePerCombatFired,
                ...(healTarget ? { selfHpPctFor: /* existing closure */ } : {}),
                // ---- side-specific ----
                runtimes: sideCtx.runtimes,
                playerIds: sideCtx.recipientIds,
                grantAllyCharges: sideCtx.grantAllyCharges,
                isLowestSpeedAllyFor: sideCtx.isLowestSpeedAllyFor,
            });
        }
    }
};

const drainIntents = (): void =>
    drainQueue(intentQueue, {
        runtimes: runtimesById,
        recipientIds: playerIds,
        isLowestSpeedAllyFor: (ownerId) => lowestSpeedAllyIds.has(ownerId),
        grantAllyCharges,
    });

const drainEnemyIntents = (): void => {
    if (enemyIntentQueue.length === 0) return;
    drainQueue(enemyIntentQueue, {
        runtimes: enemyRuntimesById,
        // PR1: recipients limited to self-target buffs in practice (only round-started fires).
        // Passing enemy ids future-proofs PR2's cross-enemy routing; harmless for self-buffs.
        recipientIds: enemyAttackerActorIds,
        isLowestSpeedAllyFor: (ownerId) => lowestSpeedEnemyIds.has(ownerId),
        // Gap F deferred to PR3: an enemy charge-grant ally intent is not in PR1 corpus scope.
        // A documented no-op keeps executeIntent's charge/ally branch from a crash if reached.
        grantAllyCharges: () => {},
    });
};
```

Preserve the existing `cumulativeDamage` map-sum expression, `recordResisted`, and `selfHpPctFor` closures verbatim — only their *placement* moves into `drainQueue`'s shared block.

- [ ] **Step 4: Drain the enemy queue at the three drain points**

After each existing `drainIntents();` call — `engine.ts:~2164` (start-of-round), `~2782` (per-turn), `~2933` (post-round) — add `drainEnemyIntents();` immediately after. The start-of-round point is the one that matters for PR1 (the enemy buff must land before the enemy's turn folds it); the other two are symmetric/future-proof and are no-ops while the enemy queue is empty.

- [ ] **Step 5: Run the characterization test — verify it PASSES**

Run: `npx vitest run src/utils/combat/__tests__/enemyReactiveSelfBuffs.test.ts`
Expected: PASS — round-2 incoming with the buff exceeds the control.

- [ ] **Step 6: tsc + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean, 0 warnings.

- [ ] **Step 7: Commit**

```bash
git add src/utils/combat/engine.ts
git commit -m "feat(combat): wire enemy attacker reactive self-buffs (enemy-team PR1)"
```

---

## Task 3: Lowest-speed-ally gate for a lone enemy (Gap E)

**Files:**
- Test: `src/utils/combat/__tests__/enemyReactiveSelfBuffs.test.ts` (extend)

- [ ] **Step 1: Write the test — a lowest-speed-gated enemy self-buff applies for a lone enemy**

Build an enemy attacker with a `start-of-round` self-buff gated on `lowest-speed-ally` (the real Chakara condition — `derivable:true`). With a single enemy, the gate must resolve `true` and the buff must apply. Assert incoming damage reflects the buff (same delta style as Task 1).

- [ ] **Step 2: Run — verify PASS**

Run: `npx vitest run src/utils/combat/__tests__/enemyReactiveSelfBuffs.test.ts`
Expected: PASS (Task 2 Step 1 built `lowestSpeedEnemyIds` so a lone enemy is in the set).

- [ ] **Step 3: (Multi-enemy speed ordering) write the test — only the slowest enemy gets the lowest-speed buff**

With two enemies of different speeds both carrying the lowest-speed-gated buff, assert only the slower one's outgoing damage reflects it (the faster one's gate resolves `false`). This locks the per-side `min` logic.

- [ ] **Step 4: Run — verify PASS; commit**

Run: `npx vitest run src/utils/combat/__tests__/enemyReactiveSelfBuffs.test.ts`
Expected: PASS.

```bash
git add src/utils/combat/__tests__/enemyReactiveSelfBuffs.test.ts
git commit -m "test(combat): lone + multi-enemy lowest-speed-ally gate for enemy self-buffs"
```

---

## Task 4: Regression guards — player side untouched, on-cast enemy self-buff still fires

**Files:**
- Test: `src/utils/combat/__tests__/enemyReactiveSelfBuffs.test.ts` (extend)

- [ ] **Step 1: Write a regression test — a generic enemy on-cast (non-reactive) self-buff still fires**

Per the bug report, a generic enemy *on-cast* self-buff already fires (only the `start-of-round` reactive path was dead). Add a test asserting an enemy whose active slot grants a self-buff still applies it, so the partition/registration change didn't regress the cast path.

- [ ] **Step 2: Write an isolation test — enemy self-buff does NOT leak onto the player team**

Assert that an enemy `start-of-round` self Attack Up does not change any player actor's stats/damage (the buff lands on the enemy id only; the enemy recipient routing never touches `playerIds`). Compare a player-side damage/heal figure with vs without the enemy buff — it must be identical.

- [ ] **Step 3: Run — verify PASS**

Run: `npx vitest run src/utils/combat/__tests__/enemyReactiveSelfBuffs.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/utils/combat/__tests__/enemyReactiveSelfBuffs.test.ts
git commit -m "test(combat): regression + isolation guards for enemy reactive self-buffs"
```

---

## Task 5: Full suite + golden parity + audit

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: ALL green. Pay attention to `healingGoldenParity.test.ts` and the DPS goldens — they MUST be byte-identical. If any golden diffs, STOP and investigate (do NOT `-u`); a diff means a real-data enemy fixture carries reactive abilities, contradicting the byte-identical premise.

- [ ] **Step 2: Run the skill audit**

Run: `npm run audit:skills` (or the project's audit command — check `package.json`)
Expected: 0 findings / 141 ships (PR1 adds no parser changes, so parity should hold).

- [ ] **Step 3: tsc + lint final pass**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean.

---

## Task 6: Changelog, coverage doc, memory

**Files:**
- Modify: `src/constants/changelog.ts` (`UNRELEASED_CHANGES`)
- Modify: `docs/skill-model-coverage.md` (§6 enemy-team-support item)

- [ ] **Step 1: Fold a changelog line into the existing combat entry**

Add a plain-English line to the single evolving combat `UNRELEASED_CHANGES` entry — e.g. "Enemy ships configured in the healing calculator now apply their own start-of-round self-buffs (e.g. Chakara's lowest-speed Attack Up), so incoming damage reflects them." Do NOT create a separate entry — fold into the existing one.

- [ ] **Step 2: Note PR1 shipped in the coverage doc §6**

Under the "Enemy-team support" item and its "enemy-attacker REACTIVE abilities never fire" sub-item, mark the enemy reactive self-buff path SHIPPED in PR1 (Gap B self-scope + Gap E per-side lowest-speed), with cross-enemy routing (Gap A/C) + UI (Gap D) still pending PR2. Note the PR1 `isLowestSpeedAllyFor` companion fix is done.

- [ ] **Step 3: Commit docs (no-verify, force-add gitignored docs)**

```bash
git add src/constants/changelog.ts
git add -f docs/skill-model-coverage.md
git commit --no-verify -m "docs(combat): enemy reactive self-buffs PR1 — changelog + coverage"
```

---

## Task 7: Push, PR, review

- [ ] **Step 1: Push and open the PR**

```bash
gh auth switch --hostname github.com --user TheSusort
git push -u origin feat/combat-engine-enemy-team-support
gh pr create --title "feat(combat): enemy reactive self-buffs (enemy-team support PR1)" --body "<summary + test plan + spec link>"
```

- [ ] **Step 2: Request review per the project flow**

Use superpowers:requesting-code-review (or the `/code-review` skill) and address findings. Poll `mergeState=CLEAN` for CodeRabbit (API checks read null even on success).

---

## Done-when

- An enemy attacker's `start-of-round` self-buffs apply each round and raise its incoming damage to the tank; the Chakara-as-enemy repro is fixed.
- A lowest-speed-gated enemy self-buff resolves correctly for a lone enemy (`true`) and only the slowest of multiple enemies.
- Player-side stats/damage are provably unaffected; the on-cast enemy self-buff path is not regressed.
- Full suite green; healing + DPS goldens byte-identical; `audit:skills` 0 findings; lint + tsc clean.
- Changelog, coverage doc updated.

## Out of scope (later PRs / phases)

- Cross-enemy `ally`/`all-allies` buff routing (cast-path Gap A fix at `engine.ts:~369`), per-recipient aura registration (Gap C), and the "Enemy Team" rename + slot-cap removal (Gap D) → **PR 2**.
- `grantAllyCharges` enemy-side (Gap F) → **PR 3** (only if a corpus enemy supporter needs it).
- Enemy reactive `damage`/`heal`/`charge` effect types (unreachable in single-target healing mode) and all targeting/positional work → deferred phases.
