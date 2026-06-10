# Combat Engine Phase 4c PR 2 — `on-ally-attacked` Reactives Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "when an ally is directly damaged / critically hit" reactions live in the combat engine, unlocking Cultivator (ally repair), Refine (Inc. Damage Down grant), Heliodor second passive (all-allies repair), Guardian third passive (counter-Provoke on ally crit), and Graphite (role-filtered Repair Over Time grant).

**Architecture:** PR 1 (#95) already ships per-hit `attacked` events, `triggerCritFilter`, and `eventCtx.counterTargetId`. This PR adds ONE new trigger (`on-ally-attacked`) using the established ally-scoping pattern, a `roleFilter` honored at the listener, and `eventCtx.damagedAllyId` so reactive grants land on ONLY the damaged ally (today an `'ally'`-target reactive buff goes to ALL players — that would wrongly tick Graphite's Repair Over Time on every team ship). Ship roles thread from ship data through the healing-page inputs into a `roleOf` lookup at listener registration.

**Tech Stack:** TypeScript, Vitest, React 18. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-06-10-combat-engine-phase4c-design.md` §4 "PR 2" (locked decisions in §2 — do not re-litigate). Baseline: `main` at `144f2c04` (PR #95 merged). Branch: `feat/combat-engine-phase4c-ally-damage` (already created).

---

## Non-negotiable project rules (from CLAUDE.md + project memory)

- **Golden discipline:** DPS goldens (22) and healing goldens (20) are SYNTHETIC hand-built fixtures. Any diff in an EXISTING golden = bug. **NEVER run `vitest -u`.** New scenarios may ADD snapshots; existing snapshot content must be byte-identical.
- **Changelog:** fold into the ONE existing UNRELEASED combat/healing entry in `src/constants/changelog.ts` — never add a second entry.
- **docs/ is gitignored** — commit doc changes with `git add -f`.
- **`gh auth switch --hostname github.com --user TheSusort`** before any PR/push op.
- ESLint runs with `--max-warnings: 0`; no emojis in UI text.
- Run tests with `npx vitest run <path>`; full suite `npm test`.

## Ship texts being implemented (from docs/ship-skills.csv, verbatim, tags stripped)

| Ship | Clause (passive row) | Model |
|---|---|---|
| Cultivator (p2) | "Additionally, when an ally is directly damaged within the active pattern, this Unit repairs that ally for 8% of this Unit's Max HP." | heal, pct 8, basis `hp` (caster max HP), target `ally` (→ damaged ally), trigger `on-ally-attacked`. "within the active pattern" approximated as ANY ally (real fix in 4d) — document. Its OTHER clause ("When this Unit cleanses a Debuff, it also repairs that ally for 4%…") is NOT in scope — current behavior must be pinned and preserved. |
| Refine (p1/p2) | "When an ally is directly damaged, this Unit grants Inc. Damage Down I for 1 turn." (p2: 2 turns) | buff `Inc. Damage Down I`, trigger `on-ally-attacked`, recipient = the damaged ally (spec-locked; text names no recipient → force target `ally`). |
| Heliodor (p2) | "When directly damaged, this Unit reduces the duration of all active Debuffs on all allies by 1 turn and repairs them for 8% of its Max HP." | heal, pct 8, basis `hp`, target `all-allies` ("them" = the all-allies antecedent), trigger `on-attacked` (SELF-damaged — not ally-damaged!). Duration-reduction half DEFERS to 4e (cleanse family) — document. |
| Guardian (p2 row, second sentence) | "When an ally is critically hit by an enemy, apply Provoke for 1 turn to that enemy." | debuff `Provoke`, trigger `on-ally-attacked`, `triggerCritFilter: 'crit'`, counter-routed to the attacker via `eventCtx.counterTargetId` (per-target enemy store, Warden pattern). |
| Graphite (p1 = p2) | "When an ally attacker or debuffer is directly damaged, this Unit grants the ally Repair Over Time III for 2 turns." | buff `Repair Over Time III` (HoT — ticks are ALREADY simulated, playerTurn.ts:1415+, credited to the applier via `casterId`), trigger `on-ally-attacked`, `roleFilter: ['ATTACKER', 'DEBUFFER']`, recipient = damaged ally. |

Key physical fact: in healing mode the engine only ever emits `attacked` with `targetId = healTarget.id` (engine.ts:~2482). So "the damaged ally" is always the heal target today — but grants must STILL route to exactly one recipient (the `eventCtx.damagedAllyId`), not all players.

## File map

| File | Change |
|---|---|
| `src/constants/shipTypes.ts` | NEW: `ShipRoleCategory` type + `matchesRoleCategory()` |
| `src/types/abilities.ts` | `'on-ally-attacked'` in `AbilityTrigger` + `LIVE_TRIGGERS`; `roleFilter?: ShipRoleCategory[]` on `Ability` |
| `src/types/calculator.ts` | `role?: ShipTypeName` on `TeamActorInput` |
| `src/utils/combat/triggers.ts` | new listener case; `roleOf` arg; `eventCtx.damagedAllyId`; executor recipient routing (heal + buff) |
| `src/utils/combat/engine.ts` | build `roleByActorId`, pass `roleOf` to `registerReactiveListeners` (~line 1399); accept focus-actor role on engine input |
| `src/utils/calculators/healingEngineAdapter.ts` | thread healer role + team roles into engine input |
| `src/pages/calculators/HealingCalculatorPage.tsx` | auto-fill `role` from ship data on target/team/healer inputs |
| `src/utils/skillTextParser.ts` | `detectDamageReactionTrigger` ally branch + role words; `parseHealAbilities` ally-subject + non-self-recipient enablement; `resolveHealTarget` "them"-with-all-allies-antecedent rule |
| `src/utils/abilities/buildShipAbilities.ts` | heal path trigger selection; buff path roleFilter + force `target: 'ally'` for ally-reaction grants |
| `scripts/auditSkills.ts` | stop skipping ally-damage reactive phrasings (parity with parser) |
| `src/components/skills/AbilityCard.tsx` | `on-ally-attacked` in `TRIGGER_OPTIONS`; roleFilter control |
| `src/utils/calculators/__tests__/healingGoldenParity.test.ts` | NEW scenarios (Cultivator routing, Graphite role filter) |
| `docs/skill-model-coverage.md` | §5 PR 2 block; §6 closures |
| `src/constants/changelog.ts` | fold into existing UNRELEASED entry |

---

### Task 1: Role category matcher (`matchesRoleCategory`)

**Files:**
- Modify: `src/constants/shipTypes.ts` (type + matcher at the bottom, after `ShipTypeName` at line ~66)
- Test: `src/constants/__tests__/shipTypes.test.ts` (create if absent; if a `__tests__` dir doesn't exist under `src/constants/`, create it — Vitest picks up any `*.test.ts`)

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from 'vitest';
import { matchesRoleCategory } from '../shipTypes';

describe('matchesRoleCategory', () => {
    it('matches the exact category name', () => {
        expect(matchesRoleCategory('ATTACKER', ['ATTACKER'])).toBe(true);
        expect(matchesRoleCategory('DEBUFFER', ['DEBUFFER'])).toBe(true);
    });

    it('matches every variant of a category by prefix (DEBUFFER_* family)', () => {
        expect(matchesRoleCategory('DEBUFFER_DEFENSIVE', ['DEBUFFER'])).toBe(true);
        expect(matchesRoleCategory('DEBUFFER_BOMBER', ['ATTACKER', 'DEBUFFER'])).toBe(true);
        expect(matchesRoleCategory('DEBUFFER_DEFENSIVE_SECURITY', ['DEBUFFER'])).toBe(true);
        expect(matchesRoleCategory('DEFENDER_SECURITY', ['DEFENDER'])).toBe(true);
        expect(matchesRoleCategory('SUPPORTER_SHIELD', ['SUPPORTER'])).toBe(true);
    });

    it('does NOT cross-match categories', () => {
        expect(matchesRoleCategory('DEFENDER', ['ATTACKER', 'DEBUFFER'])).toBe(false);
        expect(matchesRoleCategory('SUPPORTER_OFFENSIVE', ['ATTACKER'])).toBe(false);
    });

    it('unknown role (undefined) never matches — conservative', () => {
        expect(matchesRoleCategory(undefined, ['ATTACKER', 'DEBUFFER'])).toBe(false);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/constants/__tests__/shipTypes.test.ts`
Expected: FAIL — `matchesRoleCategory` is not exported.

- [ ] **Step 3: Implement**

Add to `src/constants/shipTypes.ts` (after the `ShipTypeName` export):

```typescript
/** Role CATEGORY for skill-text role filters ("an ally attacker or debuffer" — Graphite).
 *  A category matches its exact ShipTypeName AND every underscore-suffixed variant
 *  ('DEBUFFER' matches DEBUFFER, DEBUFFER_DEFENSIVE, DEBUFFER_BOMBER, …). */
export type ShipRoleCategory = 'ATTACKER' | 'DEFENDER' | 'DEBUFFER' | 'SUPPORTER';

/** True when `type` falls under ANY of the given categories (prefix match over
 *  ShipTypeName). Unknown role (undefined) never matches — a role-filtered reaction
 *  stays dormant rather than inflating numbers (spec §4 PR 2, conservative). */
export function matchesRoleCategory(
    type: ShipTypeName | undefined,
    categories: ShipRoleCategory[]
): boolean {
    if (!type) return false;
    return categories.some((c) => type === c || type.startsWith(`${c}_`));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/constants/__tests__/shipTypes.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/constants/shipTypes.ts src/constants/__tests__/shipTypes.test.ts
git commit -m "feat(combat): add ship role category matcher for ally-damage role filters"
```

---

### Task 2: Type plumbing — trigger, roleFilter, eventCtx, TeamActorInput.role

Pure type additions; no behavior. Verified by compile + the one LIVE_TRIGGERS-driven assertion.

**Files:**
- Modify: `src/types/abilities.ts` (`AbilityTrigger` lines 31–46, `LIVE_TRIGGERS` lines 56–71, `Ability` lines 224–237)
- Modify: `src/utils/combat/triggers.ts` (`Intent` interface, lines 70–79)
- Modify: `src/types/calculator.ts` (`TeamActorInput`)

- [ ] **Step 1: Add `'on-ally-attacked'` to the `AbilityTrigger` union** (place it right after `'on-attacked'` to keep the attacked family adjacent) **and to `LIVE_TRIGGERS`** (same position).

- [ ] **Step 2: Add `roleFilter` to `Ability`** (sibling of `triggerCritFilter`):

```typescript
    /** Ally-role filter for on-ally-attacked (Graphite "when an ally attacker or
     *  debuffer is directly damaged"): the reaction fires only when the DAMAGED
     *  ally's ship role matches one of these categories (prefix match over
     *  ShipTypeName — 'DEBUFFER' matches every DEBUFFER_* variant). Absent → any
     *  ally. A filter with an UNKNOWN ally role never matches (conservative). */
    roleFilter?: ShipRoleCategory[];
```

Import `ShipRoleCategory` from `../constants/shipTypes` (check the existing import style/path in abilities.ts — it's `src/types/abilities.ts`, so `../constants/shipTypes`).

- [ ] **Step 3: Extend `Intent.eventCtx`** in `src/utils/combat/triggers.ts`:

```typescript
    /** Event context captured by the listener at enqueue time (per-event intents).
     *  `counterTargetId`: the attacking enemy's actor id for "on that enemy"
     *  counter-inflictions (Warden, Guardian's ally-Provoke) — the executor's debuff
     *  branch routes the application to THIS enemy's per-target store.
     *  `damagedAllyId`: the DAMAGED ally's actor id (on-ally-attacked) — the heal and
     *  buff branches route an 'ally'-target payload to exactly this recipient
     *  (Cultivator's repair, Refine/Graphite's grants) instead of the default. */
    eventCtx?: { counterTargetId?: string; damagedAllyId?: string };
```

- [ ] **Step 4: Add `role` to `TeamActorInput`** in `src/types/calculator.ts`:

```typescript
    /** Ship role (Ship.type) for role-filtered ally-damage reactions (Graphite).
     *  Auto-filled from ship data on the healing page; absent for manual actors →
     *  role-filtered reactions never fire for them (conservative). */
    role?: ShipTypeName;
```

Import `ShipTypeName` from `../constants/shipTypes` (verify relative path).

- [ ] **Step 5: Compile + suite spot-check**

Run: `npx tsc --noEmit && npx vitest run src/utils/abilities/__tests__ src/utils/combat/__tests__/triggers.test.ts`
Expected: PASS, no type errors. (`simCoverage.ts` consumes `LIVE_TRIGGERS` directly — no edit needed there; the editor "Not simulated" note for the new trigger disappears automatically once it's in `LIVE_TRIGGERS`.)

- [ ] **Step 6: Commit**

```bash
git add src/types/abilities.ts src/utils/combat/triggers.ts src/types/calculator.ts
git commit -m "feat(combat): type plumbing for on-ally-attacked (trigger, roleFilter, damagedAllyId, TeamActorInput.role)"
```

---

### Task 3: `on-ally-attacked` listener in `registerReactiveListeners`

**Files:**
- Modify: `src/utils/combat/triggers.ts` (`registerReactiveListeners` args at line ~162; the trigger `switch` — add the case directly after `case 'on-attacked':` at line ~262)
- Test: `src/utils/combat/__tests__/triggers.test.ts` (follow the existing `registerReactiveListeners`-level test pattern used by the PR 1 `triggerCritFilter` tests at lines ~1565–1636: a bare `createEventBus()`, a `perOwner` array, an `enqueue` spy collecting intents, manual `bus.emit`)

- [ ] **Step 1: Write the failing tests** (one `describe('on-ally-attacked listener', …)` block):

```typescript
// Helpers per existing pattern: ab() builder, createEventBus, registerReactiveListeners.
// isEnemySide: (id) => id === 'enemy' || id === 'ea1'. roleOf supplied per test.

it('fires when ANOTHER player actor is hit, not for own hits or enemy-side targets', () => {
    // owner 'graphite'; emit attacked {targetId:'tank', attackerId:'ea1'} → 1 enqueue
    // emit attacked {targetId:'graphite', attackerId:'ea1'} → no enqueue (own hit → on-attacked's job)
    // emit attacked {targetId:'enemy', attackerId:'tank'} → no enqueue (enemy-side target)
});

it('fires once PER HIT (three attacked events → three enqueues)', () => {});

it('honors triggerCritFilter against the hit didCrit (crit and non-crit variants)', () => {
    // crit-filtered ability: didCrit:true → enqueue, absent → none. Inverse for 'non-crit'.
});

it('roleFilter: matches damaged ally role by category, unknown role = no match', () => {
    // roleFilter ['ATTACKER','DEBUFFER']:
    //  - roleOf('tank') = 'DEBUFFER_BOMBER' → enqueue
    //  - roleOf('tank') = 'DEFENDER' → none
    //  - roleOf returns undefined → none
    //  - no roleOf arg passed at all + filter present → none (conservative)
    //  - ability WITHOUT roleFilter + roleOf undefined → still enqueues (filter absent = any ally)
});

it('enqueued intent carries eventCtx with BOTH counterTargetId (attacker) and damagedAllyId (target)', () => {});
```

Write them as real tests with full arrange/act/assert, copying the structure of the existing crit-filter tests verbatim (same `ab()` usage, same emit shapes — `{ type: 'attacked', targetId, attackerId, round: 1, didCrit?: true }`).

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/utils/combat/__tests__/triggers.test.ts -t 'on-ally-attacked'`
Expected: FAIL — the trigger case doesn't exist, so no listener registers and enqueue counts are 0.

- [ ] **Step 3: Implement the listener.** Add the optional arg to `registerReactiveListeners`:

```typescript
    /** Damaged-ally role lookup for role-filtered ally-damage reactions (Graphite).
     *  Returns the actor's ShipTypeName or undefined (manual actor / no ship picked).
     *  Optional: DPS-mode runs and unit fixtures omit it. */
    roleOf?: (actorId: string) => ShipTypeName | undefined;
```

destructure it, and add the case (after `case 'on-attacked':`):

```typescript
case 'on-ally-attacked':
    bus.on('attacked', (e) => {
        // Ally-scoped: fires when ANY OTHER player actor is hit — per HIT (the
        // engine emits one event per hit, PR 1). Excludes this owner (own hits
        // are on-attacked's job) and every enemy-side actor, mirroring
        // on-ally-destroyed's scoping. triggerCritFilter discriminates on the
        // hit's own crit outcome, same contract as on-attacked. roleFilter
        // (Graphite) matches the DAMAGED ally's role category; an unknown role
        // never matches (conservative — a manual actor with no ship picked keeps
        // role-filtered reactions dormant rather than inflating numbers).
        if (e.targetId === ownerId || isEnemySide(e.targetId)) return;
        const filter = ra.ability.triggerCritFilter;
        if (filter === 'crit' && !e.didCrit) return;
        if (filter === 'non-crit' && e.didCrit) return;
        const roles = ra.ability.roleFilter;
        if (roles && roles.length > 0 && !matchesRoleCategory(roleOf?.(e.targetId), roles))
            return;
        // Per-event intent: counterTargetId routes counter-inflictions to the
        // attacker (Guardian's Provoke); damagedAllyId routes 'ally'-target
        // payloads to exactly the hit ally (Cultivator/Refine/Graphite).
        enqueue({
            ...intent,
            eventCtx: { counterTargetId: e.attackerId, damagedAllyId: e.targetId },
        });
    });
    break;
```

Import `matchesRoleCategory` + `ShipTypeName` from `../../constants/shipTypes`.

Also update the trigger→event mapping doc-comment block above `registerReactiveListeners` (lines ~124–150) with the new row:
`on-ally-attacked → attacked where targetId !== ownerId && !isEnemySide(targetId), per hit, critFilter + roleFilter applied`.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/utils/combat/__tests__/triggers.test.ts`
Expected: PASS — new tests green AND all existing trigger tests untouched.

- [ ] **Step 5: Commit**

```bash
git add src/utils/combat/triggers.ts src/utils/combat/__tests__/triggers.test.ts
git commit -m "feat(combat): on-ally-attacked reactive listener with crit + role filters"
```

---

### Task 4: Executor routing — `damagedAllyId` recipients for heal and buff branches

**Files:**
- Modify: `src/utils/combat/triggers.ts` — buff branch recipients (line ~654) and heal branch recipients (line ~820)
- Test: `src/utils/combat/__tests__/triggers.test.ts`

Today: buff branch `target === 'ally' || 'all-allies'` → ALL `ctx.playerIds`; heal branch `target === 'ally'` → `[ctx.healing.targetId]`. With `eventCtx.damagedAllyId` present and target `'ally'`, both must route to exactly `[damagedAllyId]`. Without it: byte-identical to today.

- [ ] **Step 1: Write the failing tests** (executor-level, following the existing executeIntent/statusEngine-spy test pattern in triggers.test.ts — find how PR 1's counterTargetId routing test arranges `IntentExecContext`):

```typescript
it('buff intent with eventCtx.damagedAllyId and target ally grants to ONLY that recipient', () => {
    // ability: buff 'Repair Over Time III', target 'ally'
    // intent.eventCtx = { damagedAllyId: 'tank' }; ctx.playerIds = ['healer','team1','tank']
    // assert applyTimedAbilityStatus called EXACTLY ONCE with recipient 'tank'
    // assert buff-applied emitted once with actorId 'tank'
});

it('buff intent with target ally and NO eventCtx keeps the all-players grant (PR 1 contract)', () => {});

it('heal intent with eventCtx.damagedAllyId and target ally routes to that recipient', () => {
    // healing ctx with targetId 'tank'; damagedAllyId 'tank' → effectiveHeal credited;
    // also: damagedAllyId 'team1' (≠ healing.targetId) → directHeal credited, NO applyHealToTarget
    // (locks the recipient-vs-target consumption split for the 4d future)
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/utils/combat/__tests__/triggers.test.ts -t 'damagedAllyId'`
Expected: FAIL — buff lands on all playerIds.

- [ ] **Step 3: Implement.** Buff branch recipients (replace the existing ternary at line ~654):

```typescript
    // Recipients: an ally-damage reaction grant ('ally' target + eventCtx naming the
    // damaged ally — Refine/Graphite) lands on EXACTLY that ally. Otherwise the
    // Task-5 rule holds: ally/all-allies → every player id, self → owner.
    const recipients: string[] =
        intent.ability.target === 'ally' && intent.eventCtx?.damagedAllyId
            ? [intent.eventCtx.damagedAllyId]
            : intent.ability.target === 'ally' || intent.ability.target === 'all-allies'
              ? ctx.playerIds
              : [intent.ownerId];
```

Heal branch recipients (line ~820):

```typescript
    const recipients =
        intent.ability.target === 'ally'
            ? [intent.eventCtx?.damagedAllyId ?? ctx.healing.targetId]
            : intent.ability.target === 'all-allies'
              ? ctx.playerIds
              : [intent.ownerId];
```

(`damagedAllyId === healing.targetId` in every healing-mode run today — the engine only attacks the heal target — so this is zero-churn; the explicit routing locks "repairs THAT ally" semantics for 4d multi-target.)

- [ ] **Step 4: Run to verify pass + full combat suite**

Run: `npx vitest run src/utils/combat/__tests__`
Expected: PASS, zero existing-test churn.

- [ ] **Step 5: Commit**

```bash
git add src/utils/combat/triggers.ts src/utils/combat/__tests__/triggers.test.ts
git commit -m "feat(combat): route ally-target reactive payloads to the damaged ally via eventCtx"
```

---

### Task 5: Engine threading — `roleOf` + focus-actor role; engine-level integration tests

**Files:**
- Modify: `src/utils/combat/engine.ts` (the `registerReactiveListeners` call at lines ~1399–1406; the engine input type — find `CombatEngineInput` in this file and add an optional focus-actor role field; `TeamActorEngineInput` at line ~620 inherits `role` for free)
- Test: `src/utils/combat/__tests__/triggers.test.ts` (engine-level scenarios, following PR 1's "scenario 15" `runCombat` pattern at lines ~2009–2153)

- [ ] **Step 1: Write the failing integration tests** (copy scenario 15's arrange style — `baseInput`, `flatEnemy()`/ship-backed enemy, `healTargetId`, bus event collection):

```typescript
it('scenario 16a: a TEAM owner with an on-ally-attacked buff grants to the damaged tank each round', () => {
    // focus healer (no reactives) + team actor 'graphite' whose shipSkills carry
    //   ab({ type:'buff', target:'ally', trigger:'on-ally-attacked',
    //        config:{ type:'buff', buffName:'Repair Over Time III', parsedEffects:{...hot...}, duration:2 } })
    // heal target 'tank' (TeamActorInput with role 'ATTACKER'), enemy attacker hits it.
    // Assert: buff-applied events with actorId 'tank' (and ONLY 'tank'), one per enemy attack turn.
});

it('scenario 16b: roleFilter keeps the reaction dormant for a non-matching tank role', () => {
    // same as 16a but ability.roleFilter ['ATTACKER','DEBUFFER'] and tank role 'DEFENDER'
    // → zero buff-applied for the RoT name. Re-run with role 'DEBUFFER_BOMBER' → fires.
    // And with NO role on the tank input + filter present → dormant (conservative).
});

it('scenario 16c: crit-only ally reaction (Guardian Provoke) routes to the attacking enemy per-target store', () => {
    // team owner ability: debuff 'Provoke', trigger 'on-ally-attacked', triggerCritFilter 'crit'
    // enemy attacker with 100% crit → debuff-applied with targetId = enemy attacker id
    // enemy attacker with 0% crit → no Provoke. (Mirror PR 1's counter-routing assertions
    // in targetIdRouting.test.ts — put this test THERE if it fits that file's harness better.)
});

it('scenario 16d: the owner being hit does NOT fire its own on-ally-attacked (self hits are on-attacked scope)', () => {
    // give the heal TARGET itself the on-ally-attacked ability → zero fires.
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/utils/combat/__tests__/triggers.test.ts -t 'scenario 16'`
Expected: FAIL — roles aren't threaded (16a may pass if no roleFilter; ensure at least 16b fails before implementing).

- [ ] **Step 3: Implement.** In `engine.ts`, near the `registerReactiveListeners` call (~1399):

```typescript
    // Damaged-ally role lookup for role-filtered reactions (Graphite). Roles come from
    // ship data on the healing page (TeamActorInput.role / the focus actor's role input);
    // absent role → undefined → role-filtered reactions stay dormant for that actor.
    const roleByActorId = new Map<string, ShipTypeName>();
    if (input.role) roleByActorId.set(<focusActorId>, input.role);
    for (const t of <teamActorEngineInputs>) if (t.role) roleByActorId.set(t.id, t.role);
    registerReactiveListeners({
        bus,
        perOwner: reactivePerOwner,
        enqueue: (intent) => intentQueue.push(intent),
        isEnemySide,
        roleOf: (id) => roleByActorId.get(id),
    });
```

`<focusActorId>` / `<teamActorEngineInputs>`: resolve against the actual local names in engine.ts (the focus actor id constant and the walked-team input array used to build runtimes — find them where `runtimesById` is assembled at ~1410). Add `role?: ShipTypeName` to the engine's input type next to `healTargetId` (find the exact interface — explorer notes name it `CombatEngineInput` around line 644).

- [ ] **Step 4: Run to verify pass + the whole combat suite**

Run: `npx vitest run src/utils/combat/__tests__`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/combat/engine.ts src/utils/combat/__tests__/
git commit -m "feat(combat): thread actor roles into reactive listener registration"
```

---

### Task 6: Adapter + healing page — auto-fill roles from ship data

**Files:**
- Modify: `src/utils/calculators/healingEngineAdapter.ts` (`simulateHealing` input → engine input mapping; team actors flow through as `TeamActorInput[]`, so their `role` rides along free — verify, then add a `healerRole`-equivalent for the focus actor)
- Modify: `src/pages/calculators/HealingCalculatorPage.tsx`:
  - `teamActors` memo (lines ~370–382): add `role` from each team ship's `ship.type` (verify the teamShips element shape — mirror however `stats`/`shipSkills` are derived there)
  - `targetActor` memo (lines ~388–409): add `role` for the heal-target ship — mirror the existing `targetAffinity` derivation (there is already ship-derived target affinity state; derive role the same way from the selected target ship's `.type`)
  - `simulateHealing` call (lines ~453–474): pass the focus healer's role — `config.shipId ? getShipById(config.shipId)?.type : undefined` (mirrors the `healTargetAffinity` healer-as-target branch at lines 446–450)
- Test: `src/utils/calculators/__tests__/healingEngineAdapter.test.ts`

- [ ] **Step 1: Write a failing adapter test**: `simulateHealing` with a team actor carrying `role` + a focus healer role reaches the engine such that a role-filtered on-ally-attacked ability fires/stays dormant accordingly (one positive, one negative — end-to-end through `simulateHealing`, asserting on the result's healing buckets or bus events if the adapter exposes them; follow the existing adapter test harness).

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/utils/calculators/__tests__/healingEngineAdapter.test.ts`

- [ ] **Step 3: Implement** adapter threading + the three page edits. Page state types live next to the page (e.g. `HealTargetState`) — extend as needed. The page builds `targetActor` from `target` state: when a target ship is selected (`selectTargetShip`), capture its `.type` alongside the existing affinity capture.

- [ ] **Step 4: Verify** — adapter tests pass; `npx tsc --noEmit`; `npm run lint`.

- [ ] **Step 5: Manual sanity (optional but cheap):** dev server runs on :3000 — do NOT start a second instance if the user has one running; skip live verification here (final in-app verification happens at PR review with the user's real fleet, per project convention).

- [ ] **Step 6: Commit**

```bash
git add src/utils/calculators/healingEngineAdapter.ts src/pages/calculators/HealingCalculatorPage.tsx src/utils/calculators/__tests__/healingEngineAdapter.test.ts
git commit -m "feat(healing): auto-fill ship roles into combat engine inputs"
```

---

### Task 7: Parser detector — ally-subject branch in `detectDamageReactionTrigger`

**Files:**
- Modify: `src/utils/skillTextParser.ts` (detector at lines ~988–1049; the `DR_ALLY_SUBJECT_RE` guard at line 1030)
- Test: `src/utils/__tests__/skillTextParser.test.ts` (the PR 1 damage-reaction lock-test block)

- [ ] **Step 1: Write failing lock tests** against the REAL CSV sentences:

```typescript
describe('detectDamageReactionTrigger — ally subject (Phase 4c PR 2)', () => {
    // Guardian p2 second sentence
    it('Guardian: "When an ally is critically hit by an enemy, apply Provoke…" → on-ally-attacked + crit filter', () => {
        const text = 'When an ally is critically hit by an enemy, apply Provoke for 1 turn to that enemy.';
        expect(detectDamageReactionTrigger(text, text.indexOf('Provoke'))).toEqual({
            trigger: 'on-ally-attacked',
            critFilter: 'crit',
        });
    });

    it('Refine: "When an ally is directly damaged, this Unit grants Inc. Damage Down I…" → on-ally-attacked, no filters', () => {
        const text = 'When an ally is directly damaged, this Unit grants Inc. Damage Down I for 1 turn.';
        expect(detectDamageReactionTrigger(text, text.indexOf('Inc. Damage Down I'))).toEqual({
            trigger: 'on-ally-attacked',
        });
    });

    it('Graphite: "When an ally attacker or debuffer is directly damaged…" → on-ally-attacked + roleFilter', () => {
        const text =
            'When an ally attacker or debuffer is directly damaged, this Unit grants the ally Repair Over Time III for 2 turns.';
        expect(detectDamageReactionTrigger(text, text.indexOf('Repair Over Time III'))).toEqual({
            trigger: 'on-ally-attacked',
            roleFilter: ['ATTACKER', 'DEBUFFER'],
        });
    });

    it('self-subject sentences still return on-attacked (Warden/Makoli regression)', () => {
        // re-assert one existing PR 1 case verbatim to lock no-churn
    });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/utils/__tests__/skillTextParser.test.ts -t 'ally subject'`
Expected: FAIL — detector returns `undefined` on ally-subject sentences.

- [ ] **Step 3: Implement.** Widen the return type and replace the early-return guard:

```typescript
// Role words inside an ally-subject phrase ("when an ally attacker or debuffer is
// directly damaged" — Graphite) → ShipRoleCategory filter, CATEGORY semantics
// ('debuffer' covers every DEBUFFER_* variant; matching happens in the engine).
const DR_ALLY_ROLES_RE =
    /when\s+an(?:other)?\s+ally\s+((?:attacker|defender|debuffer|supporter)(?:s)?(?:\s+or\s+(?:attacker|defender|debuffer|supporter)s?)*)\b/i;
const ROLE_WORD_TO_CATEGORY: Record<string, ShipRoleCategory> = {
    attacker: 'ATTACKER',
    defender: 'DEFENDER',
    debuffer: 'DEBUFFER',
    supporter: 'SUPPORTER',
};
```

```typescript
export function detectDamageReactionTrigger(
    text: string,
    pos: number
):
    | {
          trigger: 'on-attacked' | 'on-ally-attacked';
          critFilter?: 'crit';
          hpBelowPct?: number;
          roleFilter?: ShipRoleCategory[];
      }
    | undefined {
    const sentence = rawSentenceAround(text, pos);
    if (sentence === undefined) return undefined;
    const allySubject = DR_ALLY_SUBJECT_RE.test(sentence);
    const scrubbed = sentence.replace(DR_CANNOT_CRIT_RE, '');
    // Ally-subject roleFilter (Graphite). No corpus ally-reaction carries an HP gate,
    // so hpBelowPct stays self-subject-only (DR_HP_BELOW_RE reads the OWNER's HP).
    const roleM = allySubject ? DR_ALLY_ROLES_RE.exec(sentence) : null;
    const roleFilter = roleM
        ? roleM[1]
              .toLowerCase()
              .split(/\s+or\s+/)
              .map((w) => ROLE_WORD_TO_CATEGORY[w.replace(/s$/, '')])
        : undefined;
    const trigger = allySubject ? ('on-ally-attacked' as const) : ('on-attacked' as const);
    if (DR_CRIT_HIT_RE.test(scrubbed)) {
        const hpM = allySubject ? null : DR_HP_BELOW_RE.exec(scrubbed);
        return {
            trigger,
            critFilter: 'crit',
            ...(hpM ? { hpBelowPct: parseInt(hpM[1], 10) } : {}),
            ...(roleFilter ? { roleFilter } : {}),
        };
    }
    if (DR_DIRECT_DAMAGE_RE.test(scrubbed) || (allySubject && /\bdirectly\s+damaged\b/i.test(scrubbed))) {
        const hpM = allySubject ? null : DR_HP_BELOW_RE.exec(scrubbed);
        return {
            trigger,
            ...(hpM ? { hpBelowPct: parseInt(hpM[1], 10) } : {}),
            ...(roleFilter ? { roleFilter } : {}),
        };
    }
    return undefined;
}
```

CAREFUL: `DR_DIRECT_DAMAGE_RE` is `when (this unit is)? directly damaged | when attacked` — "When an ally attacker or debuffer is directly damaged" does NOT match it (the words between "when" and "directly" aren't covered). That's what the extra `allySubject && /\bdirectly\s+damaged\b/` alternation handles. Keep the detector's doc-comment updated (it currently says "Ally-subject sentences return undefined (PR 2)").

- [ ] **Step 4: Run to verify pass + the WHOLE parser suite AND the abilities suite** (self-subject regressions matter; the buildShipAbilities buff path consumes this detector DIRECTLY at line ~1209, so widening it changes ability output for ally-subject ships NOW, two tasks before Task 9 wires it intentionally — if a PR 1 test pins Guardian's row output, it surfaces here, not later):

Run: `npx vitest run src/utils/__tests__/skillTextParser.test.ts src/utils/abilities`
Expected: parser suite PASS with zero churn. If a buildShipAbilities test fails on an ally-subject ship's trigger flipping to `on-ally-attacked`, that is the EXPECTED intermediate state — update that pin in THIS task with a comment pointing at Task 9, or fold the Task 9 trigger-selection edit forward if cleaner.

- [ ] **Step 5: Commit**

```bash
git add src/utils/skillTextParser.ts src/utils/__tests__/skillTextParser.test.ts
git commit -m "feat(parser): detect ally-subject damage reactions with role filters"
```

---

### Task 8: Parser heals — enable ally-subject + non-self-recipient damage-reaction heals

**Files:**
- Modify: `src/utils/skillTextParser.ts`:
  - `ParsedHealAbility` type (find it — `damageReaction` field): add `allySubject?: boolean`
  - `parseHealAbilities` damage-reaction block (lines ~1536–1583): drop the two PR 1 disqualifiers (`if (/when\s+an\s+ally\b/i.test(dmgReaction[0])) continue;` and `if (resolved.target !== 'self') continue;` at lines ~1551–1552), set `allySubject`
  - `resolveHealTarget` (lines ~1482–1500): "them" with an explicit "all allies" antecedent earlier in the SAME sentence → `all-allies` (Heliodor p2)
- Test: `src/utils/__tests__/skillTextParser.test.ts`

- [ ] **Step 1: PIN current behavior first.** Write a test running `parseHealAbilities` on Cultivator's FULL p2 text (both clauses, exactly as in the CSV with tags stripped — `<br /><br />` becomes sentence breaks):

```typescript
const CULTIVATOR_P2 =
    "When this Unit cleanses a Debuff, it also repairs that ally for 4% of this Unit's Max HP. " +
    "Additionally, when an ally is directly damaged within the active pattern, this Unit repairs that ally for 8% of this Unit's Max HP.";
```

Run it against CURRENT main behavior (`npx vitest run` with a temporary `console.log` or just write the assertion after observing): record what the 4% cleanse clause produces TODAY (likely disqualified/absent — `HEAL_DISQUALIFY_RE` or the reaction guards). The final lock test must assert the 4% clause's behavior is UNCHANGED and the 8% clause parses as below. **If the 4% clause currently parses as an on-cast heal, that is existing behavior — leave it; if it's absent, it must stay absent.**

- [ ] **Step 2: Write the failing lock tests:**

```typescript
it('Cultivator p2: ally-damage clause → ally-target heal with allySubject damageReaction', () => {
    const out = parseHealAbilities(CULTIVATOR_P2);
    expect(out).toContainEqual(
        expect.objectContaining({
            kind: 'heal',
            pct: 8,
            basis: 'hp', // "of THIS UNIT's Max HP" → caster-owned basis
            target: 'ally', // "repairs THAT ally"
            damageReaction: { allySubject: true },
        })
    );
    // + the pinned 4%-clause assertion from Step 1
});

it('Heliodor p2: self-damage trigger with all-allies recipient parses (was PR 1-disqualified)', () => {
    const text =
        'When directly damaged, this Unit reduces the duration of all active Debuffs on all allies by 1 turn and repairs them for 8% of its Max HP.';
    expect(parseHealAbilities(text)).toEqual([
        expect.objectContaining({
            kind: 'heal',
            pct: 8,
            basis: 'hp', // "of ITS Max HP" → caster
            target: 'all-allies', // "them" = the "all allies" antecedent
            damageReaction: {}, // self-subject: no allySubject flag, no filters
        }),
    ]);
});

it('Isha instead-pair and Makoli hp-gate still parse byte-identically (PR 1 regression pins)', () => {
    // copy the exact PR 1 expectations for both ships
});

it('Malvex "Damage dealt to them" leech still resolves target self (them-rule regression)', () => {});
```

- [ ] **Step 3: Run to verify failure** — `npx vitest run src/utils/__tests__/skillTextParser.test.ts -t 'Cultivator p2'`

- [ ] **Step 4: Implement.**

(a) `resolveHealTarget` — insert BEFORE the singular-ally test:

```typescript
    // "them" whose antecedent is an explicit "all allies" EARLIER in the sentence
    // (Heliodor p2: "Debuffs on all allies by 1 turn and repairs them for 8%") →
    // the pronoun is plural → all-allies. Checked first because the singular rule
    // below would otherwise capture the bare \bthem\b.
    if (/\ball\s+allies\b[^.;]*\bthem\b/.test(s)) return { target: 'all-allies', explicit: true };
```

(b) damage-reaction block — replace the two `continue` guards:

```typescript
                if (dmgReaction && !/\benem(?:y|ies)\b/i.test(dmgReaction[0])) {
                    // Phase 4c PR 2: ally-subject reactions (Cultivator) and self-subject
                    // non-self recipients (Heliodor p2 "repairs them") are now MODELED —
                    // the PR 1 disqualifiers are gone. allySubject routes the ability to
                    // on-ally-attacked in buildShipAbilities.
                    const allySubject = /when\s+an(?:other)?\s+ally\b/i.test(dmgReaction[0]);
```

…and extend the `damageReaction` literal:

```typescript
                    damageReaction = {
                        ...(allySubject ? { allySubject: true } : {}),
                        ...(critFilter ? { critFilter } : {}),
                        ...(hpGate ? { hpBelowPct: parseInt(hpGate[1], 10) } : {}),
                    };
```

NOTE: keep the existing instead-clause/crit-filter logic untouched — it applies to ally sentences too if a future ship needs it. `HEAL_DAMAGE_REACTION_RE` already matches the ally phrasings (the PR 1 skip proved it — it tested `dmgReaction[0]`); verify Graphite's "when an ally attacker or debuffer is directly damaged" also matches it — if the regex requires "ally" directly before the verb, widen it the same way as Task 7's detector. (Graphite is a BUFF, not a heal, so this only matters if the regex is shared — check.)

- [ ] **Step 5: Run the full parser suite** — `npx vitest run src/utils/__tests__/skillTextParser.test.ts`
Expected: PASS. If any EXISTING ship's heal parse changed (the removed `resolved.target !== 'self'` guard could newly admit a self-subject/non-self-recipient ship beyond Heliodor), STOP and audit that ship's text against the spec before proceeding — do not blindly re-pin.

- [ ] **Step 6: Commit**

```bash
git add src/utils/skillTextParser.ts src/utils/__tests__/skillTextParser.test.ts
git commit -m "feat(parser): parse ally-subject and all-allies-recipient damage-reaction heals"
```

---

### Task 9: `buildShipAbilities` — wire ally reactions into heal + buff/debuff emission

**Files:**
- Modify: `src/utils/abilities/buildShipAbilities.ts`:
  - heal path (lines ~887–904): trigger selection now keys on `allySubject`
  - buff path (lines ~1196–1233): attach `roleFilter`; force `target: 'ally'` for ally-reaction buff grants
- Test: `src/utils/abilities/__tests__/buildShipAbilities.test.ts` (find the exact test file name — PR 1 added damage-reaction cases there)

- [ ] **Step 1: Write failing lock tests** (full-kit, real CSV row texts, following the existing per-ship test pattern in the buildShipAbilities suite):

```typescript
// Cultivator p2 row → contains a heal ability:
//   { type:'heal', target:'ally', trigger:'on-ally-attacked', config:{ pct:8, basis:'hp' } }
// Refine p1 row → buff ability:
//   { type:'buff', target:'ally', trigger:'on-ally-attacked',
//     config:{ buffName:'Inc. Damage Down I', duration:1 } }   // p2 row: duration 2
// Graphite row → buff ability:
//   { type:'buff', target:'ally', trigger:'on-ally-attacked', roleFilter:['ATTACKER','DEBUFFER'],
//     config:{ buffName:'Repair Over Time III', duration:2 } }
// Guardian p2 row → debuff ability:
//   { type:'debuff', target:'enemy'-side, trigger:'on-ally-attacked', triggerCritFilter:'crit',
//     config:{ buffName:'Provoke', duration:1 } }
//   AND the row's PR 1 self-crit Binderburg Resilience ability unchanged.
// Heliodor p2 row → heal ability:
//   { type:'heal', target:'all-allies', trigger:'on-attacked', config:{ pct:8, basis:'hp' } }
//   (duration-reduction clause produces NOTHING — 4e deferral.)
```

Use `expect(abilities).toContainEqual(expect.objectContaining({...}))` style so unrelated kit abilities don't churn the tests. Mind `getShipSkillRows()` resolution — feed row text through whatever fixture mechanism the existing tests use (they construct ships with explicit skill rows).

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/utils/abilities/__tests__`

- [ ] **Step 3: Implement.**

(a) Heal path trigger selection (lines ~887–890):

```typescript
        const reactiveTrigger = h.damageReaction
            ? h.damageReaction.allySubject
                ? ('on-ally-attacked' as const)
                : ('on-attacked' as const)
            : (detectCritRepairTrigger(text, healPos) ?? /* …existing chain unchanged… */);
```

(b) Buff path (inside the `if (reaction)` block at lines ~1209–1232):

```typescript
            if (reaction) {
                ability.trigger = reaction.trigger;
                if (reaction.critFilter) ability.triggerCritFilter = reaction.critFilter;
                if (reaction.roleFilter) ability.roleFilter = reaction.roleFilter;
                if (reaction.trigger === 'on-ally-attacked' && ability.type === 'buff') {
                    // Spec PR 2 (locked): an ally-damage reaction GRANT lands on the
                    // DAMAGED ally — Refine's recipient-less "grants Inc. Damage Down I"
                    // and Graphite's "grants the ally" both route via eventCtx.damagedAllyId,
                    // which the executor only honors for 'ally'-target intents.
                    ability.target = 'ally';
                }
                // …existing hpBelowPct handling unchanged…
            }
```

Debuffs (Guardian Provoke) keep their enemy-side target — counter-routing rides `eventCtx.counterTargetId`, no target change needed.

- [ ] **Step 4: Run the abilities suite + parser suite** — `npx vitest run src/utils/abilities src/utils/__tests__/skillTextParser.test.ts`
Expected: PASS, no churn outside the five ships.

- [ ] **Step 5: Commit**

```bash
git add src/utils/abilities/buildShipAbilities.ts src/utils/abilities/__tests__/
git commit -m "feat(abilities): emit on-ally-attacked reactives for Cultivator/Refine/Graphite/Guardian/Heliodor"
```

---

### Task 10: `auditSkills` parity

**Files:**
- Modify: `scripts/auditSkills.ts` — the ally-damage deferral in `INTENTIONAL_REACTIVE_RE` (lines ~183–189) and any "(4c PR 2 deferral)" comments

- [ ] **Step 1: Read PR 1's diff to this file for the pattern** (`git log -p --follow scripts/auditSkills.ts | head -200`) — PR 1 moved self-damage phrasings from "intentionally unparsed" to expected-covered. Mirror that for: "when an ally … directly damaged", "when an ally is critically hit by". Heliodor's duration-reduction clause and Cultivator's cleanse-repair clause must REMAIN intentionally-skipped (4e / unmodeled).

- [ ] **Step 2: Apply the edit, keeping the Inc./Out. abbreviation-period masking untouched** (ABBR_MARK lines ~195–199 — the masking rule applies to any new clause splitting on BOTH the parser and audit sides, per project memory).

- [ ] **Step 3: Run the audit** — check `package.json` for the exact script name (`npm run audit:skills` per project memory; fall back to `npx tsx scripts/auditSkills.ts`).
Expected: parity green — the five ships' ally-damage clauses now report as covered; NO new uncovered rows appear. If other ships' ally-damage phrasings surface as uncovered (e.g. Provider's "when another ally"), verify the parser handles or correctly skips them; the detector's `an(?:other)?` already covers "another ally" — confirm Provider's clause classifies sanely (its heal carries a leech basis / cannot-crit rider — pin whatever it produces with a lock test if it CHANGED; if it changed undesirably, scope the detector tighter and re-run).

- [ ] **Step 4: Commit**

```bash
git add scripts/auditSkills.ts
git commit -m "chore(audit): expect ally-damage reaction coverage (4c PR 2)"
```

---

### Task 11: Editor — trigger option + role-filter control

**Files:**
- Modify: `src/components/skills/AbilityCard.tsx` (`TRIGGER_OPTIONS` lines ~112–127; add the roleFilter control near where the trigger Select renders)
- Test: check for an existing `src/components/skills/__tests__/` pattern; if AbilityCard has component tests, extend them; if not, skip component tests (consistent with PR 1, which shipped `triggerCritFilter` without an editor control or test)

- [ ] **Step 1: Add the trigger option** (after `'on-attacked'`):

```typescript
    { value: 'on-ally-attacked', label: 'When an ally is attacked' },
```

- [ ] **Step 2: Add the role-filter control**, rendered only when `trigger === 'on-ally-attacked'`. Use the existing `CheckboxGroup` UI primitive (check its props — `label`, options shape, `helpLabel`); empty selection normalizes to `undefined`:

```tsx
{ability.trigger === 'on-ally-attacked' && (
    <CheckboxGroup
        label="Ally role filter"
        helpLabel="Empty = reacts to any ally. Categories match all variants (Debuffer covers every Debuffer subtype)."
        options={[
            { value: 'ATTACKER', label: 'Attacker' },
            { value: 'DEFENDER', label: 'Defender' },
            { value: 'DEBUFFER', label: 'Debuffer' },
            { value: 'SUPPORTER', label: 'Supporter' },
        ]}
        value={ability.roleFilter ?? []}
        onChange={(values) =>
            onChange({
                ...ability,
                roleFilter: values.length ? (values as ShipRoleCategory[]) : undefined,
            })
        }
    />
)}
```

Adapt to `CheckboxGroup`'s ACTUAL API (read the component first) and to AbilityCard's actual change-handler shape (it may be `onUpdate(field, value)` style — match it). NO emojis. The "Not simulated" note clears automatically via `LIVE_TRIGGERS` (Task 2).

- [ ] **Step 3: Verify** — `npx tsc --noEmit && npm run lint && npx vitest run src/components`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/components/skills/AbilityCard.tsx
git commit -m "feat(editor): on-ally-attacked trigger option with ally role filter"
```

---

### Task 12: New healing golden scenarios

**Files:**
- Modify: `src/utils/calculators/__tests__/healingGoldenParity.test.ts` (+ its `__snapshots__`)

Spec §6 mandates a "Cultivator ally-heal routing" golden. Add TWO scenarios (hand-built `ab()` fixtures — NEVER parser-imported):

- [ ] **Step 1: Write scenario "ally-damage repair routes to the damaged tank"**: focus healer whose shipSkills carry an `on-ally-attacked` heal (`target 'ally'`, `pct 8`, `basis 'hp'`), a heal-target team actor with real HP/defence, one ship-backed multi-hit enemy attacker (2 hits) — locking BOTH the routing and the per-hit contract (2 reactive heals per enemy attack turn). Snapshot + in-code assertions: healer's `directHeal` per round = 2 × healerMaxHp × 8% × fold; `effectiveHeal` > 0; document the hand-derived expected number in a comment per the file's convention (scenario 1's style).

- [ ] **Step 2: Write scenario "role-filtered grant — dormant vs live"**: team owner with the Graphite-shaped ability (`buff` RoT III via `parsedEffects` hot fields, `roleFilter: ['ATTACKER','DEBUFFER']`), heal target `role: 'DEFENDER'` → assert ZERO `hotHeal` credited to the owner; re-run same input with `role: 'ATTACKER'` → `hotHeal` > 0 from round 2. (In-code assertions; snapshot optional.)

- [ ] **Step 3: Run the golden suites and verify ZERO existing-snapshot churn:**

```bash
npx vitest run src/utils/calculators/__tests__/healingGoldenParity.test.ts src/utils/calculators/__tests__/dpsGoldenParity.test.ts
git diff --stat src/utils/calculators/__tests__/__snapshots__/
```

Expected: all pass; `git diff` shows ONLY additions for the new scenarios (new snapshot entries), zero modified lines in existing entries. DPS goldens byte-identical (nothing in this PR touches DPS mode — every new trigger keys on healing-mode events).

- [ ] **Step 4: Commit**

```bash
git add src/utils/calculators/__tests__/
git commit -m "test(healing): golden scenarios for ally-damage routing and role-filtered grants"
```

---

### Task 13: Docs + changelog

**Files:**
- Modify: `docs/skill-model-coverage.md` (gitignored — stage with `-f`)
- Modify: `src/constants/changelog.ts`

- [ ] **Step 1: Coverage doc §5** — add a "PHASE 4c PR 2" block following PR 1's block format. Must record: `on-ally-attacked` per-hit semantics; `eventCtx.damagedAllyId` single-recipient routing; roleFilter category matching + unknown-role-no-match; **approximations:** Cultivator "within the active pattern" ≈ any ally (4d), Heliodor p2 duration-reduction deferred (4e), Refine recipient = damaged ally (spec-locked reading of recipient-less text). Update the header "Updated …" line.

- [ ] **Step 2: Coverage doc §6** — close/annotate the Cultivator/Refine/Heliodor-p2/Guardian-ally-Provoke/Graphite rows as shipped (mirror how PR 1 closed its ships).

- [ ] **Step 3: Changelog** — FOLD into the ONE existing UNRELEASED healing/combat entry in `UNRELEASED_CHANGES` (`src/constants/changelog.ts` line ~22). Extend the existing sentence block with plain English, e.g.: "Team supports now react when the tank is hit: Cultivator repairs the damaged ally for 8%, Refine grants Inc. Damage Down, Graphite grants Repair Over Time to attacker/debuffer allies, Guardian Provokes an enemy that critically hits an ally, and Heliodor repairs all allies when directly damaged." Do NOT create a second entry. No emojis.

- [ ] **Step 4: Commit**

```bash
git add -f docs/skill-model-coverage.md
git add src/constants/changelog.ts
git commit -m "docs: coverage + changelog for 4c PR 2 ally-damage reactives"
```

---

### Task 14: Final verification + PR

- [ ] **Step 1: Full verification** (superpowers:verification-before-completion — run, read output, THEN claim):

```bash
npm run lint
npm test
git diff main --stat   # review scope: no stray files
```

Expected: lint zero warnings; full suite green (~1707+ tests, plus this PR's additions); golden snapshots: only additive changes.

- [ ] **Step 2: Commit the plan + push** (plan doc is in gitignored docs/ — `git add -f docs/superpowers/plans/2026-06-10-combat-engine-phase4c-pr2-ally-damage.md`).

- [ ] **Step 3: PR creation:**

```bash
gh auth switch --hostname github.com --user TheSusort
git push -u origin feat/combat-engine-phase4c-ally-damage
gh pr create --title "feat(combat): phase 4c PR 2 — on-ally-attacked reactives" --body "<summary per repo convention>"
```

PR body: summarize trigger/listener/routing/role-threading, the five ships, approximations (any-ally pattern, deferred Heliodor duration-reduction), test coverage, zero existing-golden churn. End with the standard generated-with footer.

- [ ] **Step 4: CodeRabbit:** poll `gh pr view --json mergeStateStatus` for `CLEAN` (check-status API reads null/null even on success — known gotcha). Address findings per superpowers:receiving-code-review.

- [ ] **Step 5:** Update project memory (`project_combat_engine_current_state.md`): PR 2 shipped facts + NEXT = PR 3 (hp-crossing).

---

## Known constraints & traps for implementers

1. **Never `vitest -u`.** Spec grants NO golden-churn exception for PR 2 (PR 1's healing churn and PR 5's DPS regen are the only two). Any existing-golden diff here = your bug.
2. **`attacked` events only target the heal target** (engine.ts:~2482 emits with `targetId: healTarget.id`). On-ally-attacked therefore only fires for NON-tank owners. A reaction owned by the tank itself must stay dormant (scenario 16d).
3. **Buff over-grant trap:** without `damagedAllyId`, an `'ally'`-target reactive buff lands on ALL `ctx.playerIds` — Graphite's RoT would tick on every team ship and inflate `hotHeal`. Task 4 exists precisely for this; don't skip it "because the numbers look right" with one team ship.
4. **HoT ctx skip rule:** a foreign applier with no `lastTurnCtx`/`applierMaxHp` SKIPS the tick (strict, no base-stat fallback — playerTurn.ts:1441-ish). In golden scenario 2 make sure the Graphite-like owner ACTS before the tank's next turn or assert from the round where ctx exists.
5. **Reactive heals never crit, never emit `heal-performed`** (chain guard) — unchanged conventions; don't "fix" them.
6. **`getShipSkillRows()` resolves ONE passive by refit level.** Refine p1 vs p2 differ only in duration (1 vs 2 turns); lock tests must pin per-row, not per-ship-merged.
7. **Registration order is determinism-bearing** (focus first, then team in input order). Don't reorder `perOwner`.
8. **iOS Safari 15: no regex lookbehind** anywhere in the parser.
9. **Inc./Out. abbreviation-period masking** applies to any new sentence-splitting on BOTH parser and audit sides.
10. **Hold pushes during user UI iteration** (dev server :3000) — coordinate before `git push`.
