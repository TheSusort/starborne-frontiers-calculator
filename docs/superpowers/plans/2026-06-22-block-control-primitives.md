# Block / Protection Control Primitives — Implementation Plan (D-PR15)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make two currently-inert defensive control buffs do something in the combat engine — **Block Debuff** (incoming debuffs are blocked and recorded as resists) and **Buff Protection** (the holder's buffs cannot be removed by purge) — tested synthetically, with zero golden/fixture drift.

**Architecture:** Both are buff-name-driven primitives in the established style of `barrierBuffs.ts` / `stasisBuffs.ts` (a `ReadonlySet<string>` of buff names + predicate; the engine reads an actor's active buff names and short-circuits). Buff Protection is a single holder-state guard inside `statusEngine.purge()`. Block Debuff is modeled as "the target auto-resists": folded into the **landing decision** so timed/persistent paths reuse existing resist plumbing for free, plus two thin DoT call sites (DoT landing-failures are silent today, so blocked DoTs get a resist event emitted **only on the block path** to preserve byte-identity).

**Tech Stack:** TypeScript, Vitest. All work under `src/utils/combat/`.

**Spec:** `docs/superpowers/specs/2026-06-22-block-control-primitives-design.md`

**Branch / worktree:** `feat/combat-d-pr15-block-control-primitives` (off `main`), worktree `.worktrees/d-pr15-block-control-primitives`.

**Commands:**
- Single test file: `npm test -- src/utils/combat/__tests__/<file>.ts`
- Full suite: `npm test`
- Lint/types: `npm run lint`
- Pre-existing failing FILES unrelated to this work: 16 files fail from a missing Supabase URL env + gitignored `docs/*.csv` (see prior D-PR notes). These are NOT regressions — judge our tests by the targeted files and by zero NEW failures / zero golden+`.snap` drift.

---

## Key grounding (verified file:line in this worktree)

- **Buff corpus:** `src/constants/buffs.ts` (`BUFFS: Buff[]`, `type: 'buff'|'debuff'|'effect'`); regen-preserve list `MANUAL_BUFFS` in `src/utils/dataUpdate/updateBuffsData.ts:21` (merged only-if-absent, mirrors `Power Infused Nanobots`).
- **Purge:** `statusEngine.purge(actorId, count)` (`statusEngine.ts:993`) → `removeNewestFirst(actorId,'buffs',count)`; **cleanse** is the separate `removeNewestFirst(actorId,'debuffs',count)` (`:987`). statusEngine internal reads available to `purge`: `snapshot(ownerId)` closure (`:743`) returning `activeSelfBuffs`, and `timedAbilityStatuses('self', ownerId)`.
- **Cast-side landing decision:** `landsTimedEnemyApplicationLive(application)` (`playerTurn.ts:750`) — drives BOTH the cast timed loop (`:928`) and the scheduled path via `statusEngine.setLandsTimedEnemyApplication(...)` (`:758`). Turn target = `enemy` (id `enemy.id`, also `targetId`).
- **Cast-side DoT gate:** `roundDebuffLanded()` (`playerTurn.ts:809`) consumed at `:1425` (`dotsLanded`), applied via `applyNewDoTs(...)` at `:1430`; DoT target = `enemy.id`. Cast-side `dotsConfig` is `DoTApplicationEntry[]` (`src/types/calculator.ts:81`) whose kind field is **`type`** (`dot.type === 'corrosion'`, consumed `playerTurn.ts:568`) — NOT `dotType`. (The REACTIVE DoT config in `triggers.ts` uses `cfg.dotType` — different shape; do not confuse them.)
- **Reactive timed debuff:** `triggers.ts:1177` (`if (owner.landsTimedEnemyApplication(...)) {apply} else {recordResisted + debuff-resisted}`); target = `intent.eventCtx?.counterTargetId ?? ctx.enemy.id`.
- **Reactive DoT:** `triggers.ts:1214` (`if (!owner.debuffLandingGate(liveLanding)) return;` — silent); target = `ctx.enemy.id`.
- **Buff-name read idiom:** `selfBuffNamesForOwners(statusEngine, [id])` (`triggers.ts:795`) — reads `snapshot(id).activeSelfBuffs` + self ability statuses; Barrier uses it at `engine.ts:2578`.
- **Test patterns:** engine entry point is **`runCombat(input)`** (`engine.ts:1109`) — there is NO `simulateBattle`. Sim-level synthetic buff via `enemyAttacker(id, selfBuffSkills('Barrier'))` (`applyOutgoingToEnemy.test.ts:194`). statusEngine **self-store** seeding (the store `purge` reads) via `mkTimedBuff` with **`side: 'self'`** + `eng.applyTimedAbilityStatus(1, mkTimedBuff('X'), 'e1')` — see **`purgeRemoval.test.ts`** (this is the correct purge-test model; `cleanseRemoval.test.ts`'s `mkTimed` is `side:'enemy'` = the DEBUFF store, WRONG for purge). Note: `selfBuffSkills`/`enemyAttacker`/`mkTimedBuff` are local consts in their test files (not exported) → copy them into the new test files, don't import.

---

## File structure

**Create:**
- `src/utils/combat/buffProtectionBuffs.ts` — `BUFF_PROTECTION_BUFFS` set + `isBuffProtection`.
- `src/utils/combat/debuffImmunity.ts` — `BLOCK_DEBUFF_BUFFS` set, `isBlockDebuff`, `targetCarriesBlockDebuff(statusEngine, targetId)`, `dotResistLabel(dotType, tier)`, `emitBlockDebuffResist(bus, targetId, round, buffName)`.
- `src/utils/combat/__tests__/buffProtection.test.ts`
- `src/utils/combat/__tests__/blockDebuff.test.ts`

**Modify:**
- `src/constants/buffs.ts` — add `Block Debuff`, `Buff Protection` buff entries.
- `src/utils/dataUpdate/updateBuffsData.ts` — add both to `MANUAL_BUFFS`.
- `src/utils/combat/statusEngine.ts` — Buff Protection guard inside `purge()`.
- `src/utils/combat/playerTurn.ts` — Block Debuff: fold into `landsTimedEnemyApplicationLive`; cast-DoT block branch.
- `src/utils/combat/triggers.ts` — Block Debuff: reactive timed fold (`:1177`); reactive DoT block branch (`:1214`).
- `src/constants/changelog.ts` — `UNRELEASED_CHANGES` entry.

---

## Task 1: Buff corpus additions

Add the two behavioral buffs so their names resolve everywhere and survive `fetch-buffs`.

**Files:**
- Modify: `src/constants/buffs.ts`
- Modify: `src/utils/dataUpdate/updateBuffsData.ts:21` (`MANUAL_BUFFS`)

- [ ] **Step 1:** In `src/constants/buffs.ts`, add two entries to the `BUFFS` array (near `Power Infused Nanobots`):

```ts
{
    name: 'Block Debuff',
    description: 'Is immune to receiving debuffs',
    type: 'buff',
},
{
    name: 'Buff Protection',
    description: "Protects this unit's buffs from being removed",
    type: 'buff',
},
```

- [ ] **Step 2:** In `src/utils/dataUpdate/updateBuffsData.ts`, add the same two `{name, description, type:'buff'}` objects to `MANUAL_BUFFS` so regeneration preserves them.

- [ ] **Step 3:** Verify types/lint: `npm run lint` → clean. (No test yet; these are data rows consumed by later tasks.)

- [ ] **Step 4: Commit**

```bash
git add src/constants/buffs.ts src/utils/dataUpdate/updateBuffsData.ts
git commit -m "feat(combat): D-PR15 — add Block Debuff + Buff Protection to buff corpus"
```

---

## Task 2: Buff Protection module + purge guard

A purge against a holder of `Buff Protection` removes 0 buffs (whole purge blocked). Cleanse (debuff removal) is untouched.

**Files:**
- Create: `src/utils/combat/buffProtectionBuffs.ts`
- Modify: `src/utils/combat/statusEngine.ts` (`purge`, `:993`)
- Test: `src/utils/combat/__tests__/buffProtection.test.ts`

- [ ] **Step 1: Write the module**

```ts
// src/utils/combat/buffProtectionBuffs.ts
/** Named buffs that make the holder's buffs UNREMOVABLE BY PURGE for the buff's duration.
 *  A purge against a Buff-Protection holder removes 0 buffs (the whole purge is blocked).
 *  Purge-only: cleanse (debuff removal) and buff-steal are unaffected. Holder-state guard,
 *  NOT a per-buff property (cf. UNREMOVABLE_STATUSES). Extend from game data as identified. */
export const BUFF_PROTECTION_BUFFS: ReadonlySet<string> = new Set(['Buff Protection']);
export const isBuffProtection = (name: string): boolean => BUFF_PROTECTION_BUFFS.has(name);
```

- [ ] **Step 2: Write the failing test** in `buffProtection.test.ts`. Model setup on **`purgeRemoval.test.ts`** (`mkTimedBuff` with `side: 'self'` — the self/buffs store `purge` reads; do NOT use `cleanseRemoval`'s `side:'enemy'` `mkTimed`, which seeds the debuff store and would make BOTH the main and control cases trivially return 0). Cover:
  1. Apply `Buff Protection` + another buff (e.g. `Attack Up I`) as **self** statuses on an actor id (e.g. `'e1'`); `purge('e1', 'all')` returns `0` and the other buff survives.
  2. Without `Buff Protection` (only `Attack Up I`), the same purge removes the buff (control — `> 0`).
  3. Cleanse is unaffected: seed a removable **debuff** (`side:'enemy'`) on a Buff-Protection holder and assert `cleanse(id,'all') > 0` (purge-only scope intact).

```ts
// sketch — mkTimedBuff is the side:'self' helper copied from purgeRemoval.test.ts
const eng = createStatusEngine(/* per existing test helper */);
eng.beginRound(1);
eng.applyTimedAbilityStatus(1, mkTimedBuff('Buff Protection'), 'e1'); // 3-arg: recipient = self id
eng.applyTimedAbilityStatus(1, mkTimedBuff('Attack Up I'), 'e1');
expect(eng.purge('e1', 'all')).toBe(0);
// control: a second engine seeded with ONLY 'Attack Up I' → purge('e1','all') > 0
```

- [ ] **Step 3: Run → fails** (`npm test -- src/utils/combat/__tests__/buffProtection.test.ts`): purge currently returns > 0.

- [ ] **Step 4: Implement the guard** inside `purge` (`statusEngine.ts:993`). Read the holder's active self-buff names using statusEngine's own internal `snapshot(actorId).activeSelfBuffs` + `timedAbilityStatuses('self', actorId)` (mirrors `selfBuffNamesForOwners`; no circular import). Short-circuit before removal:

```ts
const purge = (actorId: string, count: number | 'all'): number => {
    // Holder-state guard: a unit carrying Buff Protection cannot have its buffs purged.
    // Purge-only — `cleanse` (removeNewestFirst(_, 'debuffs', _)) does NOT call this.
    const selfBuffNames = new Set<string>();
    for (const ab of snapshot(actorId).activeSelfBuffs) {
        if (ab.stacks === undefined || ab.stacks > 0) selfBuffNames.add(ab.buffName);
    }
    for (const s of timedAbilityStatuses('self', actorId)) selfBuffNames.add(s.active.buffName);
    // NOTE: deliberately omits the aura/accum channel (`activeAbilityStatuses('self', …)`) that
    // `selfBuffNamesForOwners` also reads — Buff Protection is only ever granted as a TIMED buff,
    // so the timed + scheduled channels cover every real grant. Revisit if an aura grant appears.
    if ([...selfBuffNames].some(isBuffProtection)) return 0;
    return removeNewestFirst(actorId, 'buffs', count);
};
```
Import `isBuffProtection` from `./buffProtectionBuffs` at the top of `statusEngine.ts`. (`snapshot` and `timedAbilityStatuses` are `const` arrow functions in the same factory body; `timedAbilityStatuses` is actually declared AFTER `purge` lexically, but that's fine — both resolve at call-time via the closure, and `purge` only runs post-construction, so no TDZ.)

- [ ] **Step 5: Run → passes.** Then `npm test -- src/utils/combat/__tests__/cleanseRemoval.test.ts` to confirm cleanse/purge characterization tests still pass.

- [ ] **Step 6: Commit**

```bash
git add src/utils/combat/buffProtectionBuffs.ts src/utils/combat/statusEngine.ts src/utils/combat/__tests__/buffProtection.test.ts
git commit -m "feat(combat): D-PR15 — Buff Protection purge-immunity primitive"
```

---

## Task 3: Block Debuff module (pure helpers)

**Files:**
- Create: `src/utils/combat/debuffImmunity.ts`
- Test: add a `describe('debuffImmunity helpers')` block to `src/utils/combat/__tests__/blockDebuff.test.ts`

- [ ] **Step 1: Write the module**

```ts
// src/utils/combat/debuffImmunity.ts
import type { StatusEngine } from './statusEngine';
import type { CombatEventBus } from './events'; // adjust to the bus type used by emit sites
import { selfBuffNamesForOwners } from './triggers';

/** Named buffs that make the holder IMMUNE to receiving debuffs. While active, every incoming
 *  debuff application (timed, persistent-stacking, DoT, control-as-named-debuff) is blocked and
 *  recorded as a RESIST. Already-landed debuffs are untouched. Extend from game data. */
export const BLOCK_DEBUFF_BUFFS: ReadonlySet<string> = new Set(['Block Debuff']);
export const isBlockDebuff = (name: string): boolean => BLOCK_DEBUFF_BUFFS.has(name);

/** True if `targetId` currently carries a Block Debuff buff (reads its self-buff names). */
export function targetCarriesBlockDebuff(statusEngine: StatusEngine, targetId: string): boolean {
    return selfBuffNamesForOwners(statusEngine, [targetId]).some(isBlockDebuff);
}

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'];
/** Single source of truth for the resisted-debuff label of a blocked DoT, so the emit site and
 *  the test assertion agree. e.g. ('inferno', 3) → 'Inferno III'; ('bomb', 0) → 'Bomb'. */
export function dotResistLabel(dotType: 'corrosion' | 'inferno' | 'bomb', tier: number): string {
    const kind = dotType.charAt(0).toUpperCase() + dotType.slice(1);
    const numeral = tier > 0 && tier < ROMAN.length ? ` ${ROMAN[tier]}` : '';
    return dotType === 'bomb' ? kind : `${kind}${numeral}`;
}

/** Emit a debuff-resisted event for a Block-Debuff-blocked DoT. Call ONLY on the block path —
 *  normal DoT landing-roll failures stay silent (byte-identical). */
export function emitBlockDebuffResist(
    bus: CombatEventBus,
    targetId: string,
    round: number,
    buffName: string
): void {
    bus.emit({ type: 'debuff-resisted', targetId, round, buffName });
}
```
Adjust the `bus` / event-bus type import to match the actual type used at the emit sites in `triggers.ts`/`playerTurn.ts` (grep `bus.emit({ type: 'debuff-resisted'`).

- [ ] **Step 2: Write failing unit tests** for `dotResistLabel` (`'Inferno III'`, `'Corrosion II'`, `'Bomb'`) and `isBlockDebuff`. (Pure — no engine.)

- [ ] **Step 3: Run → label test fails until module exists; then passes.**

- [ ] **Step 4: Commit**

```bash
git add src/utils/combat/debuffImmunity.ts src/utils/combat/__tests__/blockDebuff.test.ts
git commit -m "feat(combat): D-PR15 — debuffImmunity module (Block Debuff predicate + DoT label)"
```

---

## Task 4: Block Debuff — cast-side timed + persistent (landing fold)

Fold immunity into `landsTimedEnemyApplicationLive` so an immune turn-target auto-resists every cast/scheduled timed + persistent debuff via existing resist plumbing.

**Files:**
- Modify: `src/utils/combat/playerTurn.ts:750` (and add the per-turn immunity flag near `:744`)
- Test: `blockDebuff.test.ts` (engine-level, `runCombat`)

- [ ] **Step 1: Write the failing test.** Set up a two-side `runCombat` sim where the player (or enemy) attacker casts a **timed** debuff (e.g. `Attack Down II`) at a target carrying `Block Debuff` (seed via `selfBuffSkills('Block Debuff')` on the target ship, per `applyOutgoingToEnemy.test.ts:194`). Assert: the debuff is NOT applied (target's debuff list has no `Attack Down`) and a `debuff-resisted` event for it is emitted. Add a second case for a **persistent-stacking** debuff (e.g. `Defense Shred`) → resisted, no stack added.

- [ ] **Step 2: Run → fails** (debuff currently lands).

- [ ] **Step 3: Implement the fold.** Near the `liveLandingChance` computation (`playerTurn.ts:~744`), add:

```ts
import { targetCarriesBlockDebuff } from './debuffImmunity';
// ...
// Block Debuff: an immune turn-target auto-resists every timed/persistent application.
const targetImmuneToDebuffs = targetCarriesBlockDebuff(statusEngine, enemy.id);
```
Then guard the landing decision (`:750`):

```ts
const landsTimedEnemyApplicationLive = (application?: 'inflict' | 'apply'): boolean =>
    targetImmuneToDebuffs
        ? false
        : application === 'apply'
          ? !affinityDisadvantage
          : debuffLandingGate(liveLandingChance);
```
This routes both the cast timed loop (`:928`) and the scheduled `sourceFired` hook (`:758`) to their existing resist branches. Immune path returns `false` WITHOUT drawing `debuffLandingGate` — fine, no fixture has immune targets, so byte-identical.

- [ ] **Step 4: Run → passes.**

- [ ] **Step 5: Commit**

```bash
git add src/utils/combat/playerTurn.ts src/utils/combat/__tests__/blockDebuff.test.ts
git commit -m "feat(combat): D-PR15 — Block Debuff cast-side timed/persistent landing fold"
```

---

## Task 5: Block Debuff — reactive timed debuff

**Files:**
- Modify: `src/utils/combat/triggers.ts:1177`
- Test: `blockDebuff.test.ts`

- [ ] **Step 1: Write the failing test.** Drive a reactive `debuff` ability (e.g. an on-attacked debuff) firing at a target carrying `Block Debuff`; assert resisted (no apply, `debuff-resisted` emitted). If a self-contained reactive setup is heavy, assert via the `executeIntent`/drain path used by existing trigger tests.

- [ ] **Step 2: Run → fails.**

- [ ] **Step 3: Implement.** At `:1174`-`:1177`, compute the target and gate immunity into the landing condition so the existing `else` (resist) branch handles it:

```ts
import { targetCarriesBlockDebuff } from './debuffImmunity';
// ...
const counterTargetId = intent.eventCtx?.counterTargetId;
const debuffTargetId = counterTargetId ?? ctx.enemy.id;
const blocked = targetCarriesBlockDebuff(ctx.statusEngine, debuffTargetId);
if (!blocked && owner.landsTimedEnemyApplication(cfg.application)) {
    // ... existing apply branch unchanged ...
} else {
    // ... existing recordResisted + debuff-resisted branch unchanged ...
}
```
Immune → `else` branch → `recordResisted` + `debuff-resisted` (persistent-name → `'permanent'` row, already handled). Byte-identical when `blocked === false`.

- [ ] **Step 4: Run → passes.**

- [ ] **Step 5: Commit**

```bash
git add src/utils/combat/triggers.ts src/utils/combat/__tests__/blockDebuff.test.ts
git commit -m "feat(combat): D-PR15 — Block Debuff reactive timed-debuff fold"
```

---

## Task 6: Block Debuff — cast-side DoT block + resist event

**Files:**
- Modify: `src/utils/combat/playerTurn.ts:~1425`
- Test: `blockDebuff.test.ts`

- [ ] **Step 1: Write the failing test.** Player casts a DoT skill (e.g. inflicts `Inferno III`) at a `Block Debuff` target. Assert: no DoT entry added (target takes no DoT ticks over subsequent rounds) AND a `debuff-resisted` event with buffName `'Inferno III'` is emitted. Also assert a normal landing-roll failure (no Block Debuff, low landing chance) emits NO `debuff-resisted` (byte-identical silent-fail preserved).

- [ ] **Step 2: Run → fails** (DoT lands; no resist event).

- [ ] **Step 3: Implement.** Reuse `targetImmuneToDebuffs` (from Task 4) at the DoT application site (`:1425`-`:1450`):

```ts
import { emitBlockDebuffResist, dotResistLabel } from './debuffImmunity';
// ...
if (dotsConfig.length > 0 && targetImmuneToDebuffs) {
    // Block Debuff: blocked DoTs are recorded as resists (block-path only — normal landing
    // failures below stay silent / byte-identical).
    for (const dot of dotsConfig) {
        emitBlockDebuffResist(bus, enemy.id, r, dotResistLabel(dot.type, dot.tier));
    }
} else {
    const dotsLanded = dotsConfig.length > 0 ? roundDebuffLanded() : true;
    // ... ALL existing cast-DoT code UNCHANGED, moved inside this else ...
}
```
**Field name:** cast-side `dotsConfig` entries use **`dot.type`** (`'corrosion'|'inferno'|'bomb'`) and `dot.tier` — NOT `dotType` (that's the reactive config in Task 7). Using `dot.dotType` here → `undefined` label + TS error.

**Which code moves into the `else`:** there are **three** consecutive `if (dotsLanded)`-gated blocks in this region — `applyNewDoTs` (`:1430`), the inflicted-scope DoT extension (`:1457`), and `applyAccumulators` (`:1470`) — plus the `corrosionEntriesBefore`/`infernoEntriesBefore` capture (`:1428`). All of them (and the `const dotsLanded = …` line) go on the **non-immune `else` branch** together; the immune branch does ONLY the resist-event loop and applies no DoTs/accumulators/extensions. When not immune, the original code path is byte-for-byte unchanged.

- [ ] **Step 4: Run → passes** (both the block case and the silent-normal-failure case).

- [ ] **Step 5: Commit**

```bash
git add src/utils/combat/playerTurn.ts src/utils/combat/__tests__/blockDebuff.test.ts
git commit -m "feat(combat): D-PR15 — Block Debuff cast-side DoT block + resist event"
```

---

## Task 7: Block Debuff — reactive DoT block + resist event

**Files:**
- Modify: `src/utils/combat/triggers.ts:~1214`
- Test: `blockDebuff.test.ts`

- [ ] **Step 1: Write the failing test.** Reactive DoT ability firing at a `Block Debuff` target → no DoT entry, `debuff-resisted` emitted with the `dotResistLabel`. Plus a control: reactive DoT landing-failure (no Block Debuff) emits no event (silent preserved).

- [ ] **Step 2: Run → fails.**

- [ ] **Step 3: Implement.** Before the landing gate at `:1213`-`:1214`:

```ts
import { targetCarriesBlockDebuff, emitBlockDebuffResist, dotResistLabel } from './debuffImmunity';
// ...
if (cfg.type === 'dot') {
    if (cfg.stacks <= 0 || cfg.tier <= 0) return;
    if (targetCarriesBlockDebuff(ctx.statusEngine, ctx.enemy.id)) {
        emitBlockDebuffResist(ctx.bus, ctx.enemy.id, ctx.round, dotResistLabel(cfg.dotType, cfg.tier));
        return;
    }
    const liveLanding = owner.liveDebuffLandingChance ?? 1;
    if (!owner.debuffLandingGate(liveLanding)) return; // unchanged silent failure
    // ... existing corrosion/inferno/bomb append + dot-applied UNCHANGED ...
}
```
Byte-identical when target is not immune (guard is a no-op).

- [ ] **Step 4: Run → passes.**

- [ ] **Step 5: Commit**

```bash
git add src/utils/combat/triggers.ts src/utils/combat/__tests__/blockDebuff.test.ts
git commit -m "feat(combat): D-PR15 — Block Debuff reactive DoT block + resist event"
```

---

## Task 8: End-to-end integration, byte-identity, changelog

**Files:**
- Test: `src/utils/combat/__tests__/blockDebuff.test.ts` (integration describe)
- Modify: `src/constants/changelog.ts`

- [ ] **Step 1: Write the integration test(s).** In a two-team `runCombat`, give one actor a `Block Debuff` buff (`selfBuffSkills('Block Debuff')` — copy the local helper) and have the opposing side attempt, across a few rounds, each debuff family — (a) timed, (b) persistent-stacking, (c) DoT, (d) control-as-named-debuff (`Stasis`/`Disable`). Assert all are resisted / not applied. Add a case proving an **already-landed** debuff (applied before Block Debuff goes up) is NOT removed when Block Debuff becomes active (Block Debuff blocks new applications only). Add an **immunity-beats-landing** case (a would-otherwise-land application is still blocked).

- [ ] **Step 2: Run the targeted suites** → pass:
  - `npm test -- src/utils/combat/__tests__/blockDebuff.test.ts`
  - `npm test -- src/utils/combat/__tests__/buffProtection.test.ts`

- [ ] **Step 3: Byte-identity gate — run the full suite** `npm test` and confirm: zero NEW failures vs the pre-existing 16 env-failing files, and **zero golden / `.snap` drift** (no `.snap` files modified; `git status` shows none changed). If any golden moved, STOP — a non-immune fixture changed behavior, which violates the design; investigate before proceeding.

- [ ] **Step 4: Lint/types** `npm run lint` → clean.

- [ ] **Step 5: Changelog.** Add to `UNRELEASED_CHANGES` in `src/constants/changelog.ts` a plain-English line, e.g.: "Combat sim now models Block Debuff (incoming debuffs are blocked and shown as resisted) and Buff Protection (a unit's buffs can't be purged) — used by upcoming implant effects."

- [ ] **Step 6: Commit**

```bash
git add src/utils/combat/__tests__/blockDebuff.test.ts src/constants/changelog.ts
git commit -m "test(combat): D-PR15 — Block Debuff/Buff Protection integration + changelog"
```

---

## Out of scope (follow-up applier PRs)
Firewall (on-self-debuffed → Block Debuff), Last Stand (last-standing → Barrier + Block Debuff), Lockdown (on-debuff-resisted → all-ally Buff Protection), Tenacity (>25% hit → all-ally Buff Protection); the `Block Buff` primitive (golden-moving, 4 ships); buff-steal immunity. No DPS-calculator wiring (these effects don't affect DPS). No equipment-coverage-tracker change (no implant implemented this PR).

## Definition of done
- Both primitives live and unit+integration tested; `dotResistLabel` is the single label source shared by emit + assertions.
- Buff Protection is purge-only (cleanse verified intact).
- Block Debuff blocks all incoming debuff families and records resists; already-landed debuffs untouched; DoT resist events fire only on the block path.
- Full suite: zero new failures, zero golden/`.snap` drift. Lint/types clean. Changelog updated.
