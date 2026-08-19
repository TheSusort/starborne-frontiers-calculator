# SP-4c-2b — The No-Victim Player Turn: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a player ship casts on an ally, it faces *no enemy at all* — instead of the invisible dummy `enemy` ghost the engine hands it today.

**Architecture:** `PlayerTurnArgs.enemy` becomes optional and every victim-derived read inside `runPlayerTurn` gets an explicit "there is no enemy" answer (never "an enemy with neutral stats" — that is the ghost this rung deletes). The ladder is four zero-movement commits that build the no-victim path while it is still unreachable, then **one two-line commit** that switches `selectTurnTarget` over and absorbs all the churn. This keeps the behavioural diff tiny and every moved golden individually attributable.

**Tech Stack:** TypeScript, Vitest, `src/utils/combat/engine.ts` + `playerTurn.ts`.

## Global Constraints

- **The turn must still RUN.** An ally-targeted cast has no victim; it does **not** get skipped. The two player sites' existing `if (tgt === undefined) continue;` lines are the wrong behaviour and must go — leaving them turns all 24 shipped support ships permanently silent after their first ally-targeted cast.
- **Owner ruling (2026-08-19), in game terms:** on Hermes's turn — repairing an ally, three enemies on the board, front one at 40% HP — Hermes faces **nothing**. The ally repair is unchanged; every enemy-derived question that turn answers "there is no enemy", not "a healthy enemy".
- **Enemy side untouched.** `enemyTurnBindings.legacyVictim: healTarget` is the healing calculator's anchor and is **4e's** job. This rung is player-side only.
- **The dummy still exists after this rung.** Dropping it from the turn order is 4c-2c; deleting it is 4c-2d. Do not delete the actor, `isDummyEnemy`, the turn-order filter, or any cluster A–G symbol here.
- **Baseline to hold:** `529 test files / 5877 tests` passing (`npx vitest run`), `npx tsc --noEmit` clean, `npm run lint` clean.
- **husky's pre-commit runs the FULL suite on every commit** — a commit is only possible from a green tree. Plan each task to end green.
- **Never `vitest -u`.** The only snapshot that may move in this rung is `realKitFingerprints.test.ts.snap`, in Task 5, with each moved ship named in the commit body.
- Percentage stats are stored as integers (crit `70`, not `0.70`).

---

## Section A — Measured facts (do NOT re-derive these; they cost three full-suite runs)

Measured on `b22d2870` by instrumenting `selectTurnTarget`'s fallback and running the whole suite. All three probe runs stayed green at 529/5877, including the Proxy run — which is what makes the read-set below trustworthy rather than a guess.

**A.1 Who reaches the player-side fallback.** 3,206 rows, and **100% of them have an ally-side parsed target**:

| rows | `target.selection` | shipped equivalent |
| --- | --- | --- |
| 2,297 | `team` | `activeTarget: allies` (16 ships) |
| 622 | `others` | `other-allies` (4 ships) |
| 195 | `all` | `all-allies` (3 ships) |
| 78 | `self` | `self` (1 ship) |

There is **not one row** where an enemy-targeted player cast failed to resolve — 4c-2a's `MIN_TARGETABLE_MAX_HP` floor guarantees a targetable enemy roster. So the player-side fallback is *only* ever a nominal anchor for a cast that has no enemy by construction.

The enemy side, for contrast, already returns `tgt: undefined` on 1,341 rows (no targetable player roster **and** no heal anchor) and takes a cadence-only skip. That is the spec's "1,341 measured rows prove that path works" — reproduced exactly. Note it is a *skip*, not a no-victim turn, so it is **not** the template for this rung.

**A.2 The shipped class is 24 of 148 ships** — every healer, shielder and buffer: Hermes, Mender, Salvation, Shelter, Flamel, Paracelsus, Sentinel, Grif, Chimei, Aegis, Nyxen, Volk, Howler, Graphite, Heliodor, Faust, Refine, Purifier, Cultivator, Harvester, Hayyan, Makoli, Oleander, Meatshield. **None** of them carries an enemy-facing clause on its ally-targeted cast. Curator ("deals 60% damage to all enemies") is `activeTarget: all`, which `TARGET_MAP` (`targetingParser.ts:108`) maps to the **enemy** side — it resolves a real enemy and never touches this path.

**A.3 The ghost's complete read surface is 12 properties.** Measured by returning a logging `Proxy` over the fallback on player-side turns only and recording every `get`:

`id`, `stats`, `currentHp`, `affinity`, `position`, `shieldPool`, `destroyedRound`, `corrosionEntries`, `infernoEntries`, `genericDoTEntries`, `pendingBombs`, `pendingAccumulators`

**A.4 What those properties actually hold on an ally-targeted turn** — this is what makes most of the change provably inert:

| property | measured value | consequence |
| --- | --- | --- |
| `affinity` | **always `undefined`** (all 22 workers) | `computeAffinityModifiers(attackerAff, enemy.affinity ?? 'antimatter')` already resolves to `'antimatter'` → `enemy?.affinity ?? 'antimatter'` is byte-identical |
| `position` | **always `undefined`** | `aoeVictimIds` and `opposingVictimById` are already `undefined` on these turns → no footprint, nothing to change |
| `destroyedRound` | **always `undefined`** | the `if (enemy.destroyedRound !== undefined) break;` at `playerTurn.ts:2918` never fires today → no-victim must also not break |
| `id` | **always `'enemy'`** | so **both §2.3 guards** (`tgt.id !== enemy.id`) are already FALSE here: `targetId` and `enemyDebuffNames` are **already omitted** on these turns. Keeping them omitted is zero movement — §2.3 gets what it wants for free |
| `infernoEntries`, `genericDoTEntries`, `pendingBombs`, `pendingAccumulators` | **always `len=0`** | inert |
| `corrosionEntries` | `len=0` everywhere **except one case** | `dummyReachability.test.ts` › LIVENESS. See A.6 |
| `shieldPool` | **non-zero in 22 cases** | See A.5 — this is the rung's real churn |
| `currentHp` / `stats.hp` | varies (1e9, 350M, 1e7, 1e6, 10 000, 9 500); `stats.defence` 0 except one 10 000 | feeds `targetCurrentHp` / `enemyHp` / `enemyDefense` gate context |

**A.5 Where the churn lands: 22 support-ship fingerprints.** The non-zero `shieldPool` reads all come from `realKitFingerprints.test.ts` — one per support ship (Hermes, Mender, Salvation, Sentinel, Aegis, Chimei, Grif, Volk, Flamel, Faust, Refine, Graphite, Howler, Hayyan, Makoli, Nyxen, Oleander, Cultivator, Harvester, Meatshield, …) plus one in `placementSymmetry.test.ts`. **Cause, confirmed in source:** the `richEnemy` scenario seed (`kitFingerprintScenarios.ts:284-292`) loops `for (const a of actors) if (a.side !== subjectSide) a.shieldPool = pool` — which arms **every** non-subject actor including the dummy. So today `enemyShielded: enemy.shieldPool > 0` reads **true** on those support turns purely because the harness armed a ghost. Under this rung it reads "no enemy" → any shield-gated clause in those kits changes. **This is the ghost-lie being removed, so the movement is correct** — but every moved ship gets named in Task 5's commit body.

**A.5b A SECOND movement class, found in Task 2's review (not by the probes).** Fencing the
`ability-performed` emit on a no-victim turn also removes it for **non-damage casts**, which emit it
today with `damage: 0` and the turn's `didCrit`. `on-crit` and `on-ally-crit` ride that event
(`triggers.ts:431`, `:782`) and filter only on crit, never on `damage > 0` — so at Task 5 every
support ship's cast stops firing its own and its allies' attack-crit riders.

**OWNER RULING (2026-08-19), and it is already the code's design:** *"a heal is not an attack, but a
heal can still crit, so it should fire the 'critically repaired' rider and not the 'critically hit an
enemy' rider."* The engine already splits exactly there — `on-crit`/`on-ally-crit` are documented
"critically **hits an enemy**" / "PER ATTACK" and ride `ability-performed`, while
`on-ally-critically-repaired` rides `heal-performed` with its own `critHits` (`triggers.ts:718-731`)
and is untouched. So the loss is **intended**, and Hermes — which carries both riders — is the case
to name. Task 5 must MEASURE this loss across the 24 ships before throwing the switch, because it is
a movement source `§A.5`'s shield story does not cover.

**A.6 The one live container.** `corrosionEntries=len=1` occurs only in `dummyReachability.test.ts` › "LIVENESS: the credit counter increments when the scalar branch actually books". That case's credit comes from the **dummy's own turn** (`engine.ts:9697`, inside `actor.kind === 'enemy' && actor.id === enemy.id`), reading `enemy.corrosionEntries` directly — **not** from the focus's turn args. So its `corrosionDamage === 500` per round and `credited: BARE_ROUNDS` both survive this rung untouched. Only its `consulted` reading is affected (Task 5).

**A.7 The 13 mixed-cast rows are fixture-only.** Ally-side target whose firing skill *also* carries a damage/enemy-facing ability: 13 rows across 4 files (`patternScopedSupport.integration`, `passiveSupportPatternScope.integration`, `dummyEnemyTurnGate`, `dummyReachability`). Zero shipped ships (A.2). ⚠️ **Ruling note:** the owner's earlier "let those clauses land and attribute the movement" was given for the rejected real-anchor option. Under the no-victim ruling those clauses have **nowhere to land** and go inert. That is a consequence of the chosen option, not a silent reversal — Task 5 must state it in the commit body and in each touched test's comment.

---

## Section B — The no-victim contract

Every victim read gets one of these five answers. `runPlayerTurn` derives ONE discriminator right after its destructure and every site below keys off it, so the with-victim path stays byte-identical by construction.

```ts
/** SP-4c-2b: no victim this turn — an ally-targeted cast resolved nobody on the opposing side.
 *  Every victim-derived read below must answer "there is no enemy", NEVER "an enemy with neutral
 *  stats": the latter is exactly the dummy ghost this rung deletes (see plan §A.4-A.5 — the ghost's
 *  `shieldPool` was arming `enemyShielded` gates in 22 support-ship fingerprints). */
const hasVictim = enemy !== undefined;
```

| class | sites in `playerTurn.ts` | the no-victim answer |
| --- | --- | --- |
| **1. Gate context** | `1612-1614`, `1643`, `2042`, `2152`, `2420-2422`, `2454` | **Omit the field**, via TWO helpers — see the ⚠️ below. | All are already optional with documented defaults: `targetSpeed?`/`targetCurrentHp?`/`targetCritPower?` (`roundContext.ts:101,160` → `?? 0`; `evaluateConditions.ts:92,199`), `enemyShielded?` (`triggers.ts:1779` → default `false`). Use the conditional-spread idiom `buildTurnArgs` already uses for `targetId`. |
| **2. Application victim ids** | `1281`, `1292`, `2929`, `3044`, `3070`, `3102`, `3121`, `4165` | Nothing to apply to → **fence the enclosing clause/loop, not the emit**. A guard at the emit would produce an application event with no victim. |
| **3. Damage & affinity scalars** | `1268`, `1371`, `1389` | `enemyHpDecline` → `0`; affinity → `enemy?.affinity ?? 'antimatter'` (byte-identical per A.4); `targetCarriesBlockDebuff` → `false`. |
| **4. Victim lookup fallbacks** | `1730`, `3315`, `3339` | Drop the `vid === enemy.id ? enemy : undefined` arm — with no victim there are no vids (A.4: `position` always `undefined` ⇒ `opposingVictimById` already `undefined`). |
| **5. Loop guard & bomb anchor** | `2918`, `2977` | No `break` (A.4); fence the whole `reduceEnemyBombs` call, whose `anchor` is the victim (A.4: `pendingBombs` always empty ⇒ inert). |

⚠️ **CORRECTED DURING TASK 2 — do not use one helper for all six Class-1 sites.** The six sites do
not carry the same fields: only two carry the `targetSpeed`/`targetCurrentHp`/`targetCritPower`
triple, while four carry `enemyShielded` alone. A single 4-field helper **compiles** (all four go
through `buildRoundContext`, whose state param accepts the triple as optional — `roundContext.ts:97-105`)
and would therefore have *added* target stats to two contexts that never had them. `stat-vs-target`
computes `self > target` with `target ?? 0` (`evaluateConditions.ts:188-201`), so supplying real
target stats can flip a `gt` gate from pass to fail — a live behaviour change inside a
"zero-movement" task. Use `victimStatGateCtx` (2 sites) and `victimShieldGateCtx` (4 sites).

⚠️ **CORRECTED DURING TASK 2 — Class 5's `2918` answer is unreachable.** The `destroyedRound` break
lives *inside* the loop Class 2 orders fenced, so fencing the enclosing block subsumes it. There is
one fence, not a fence plus a separate `enemy?.destroyedRound` read.

**Container args** (`corrosionEntries`, `infernoEntries`, `genericDoTEntries`, `pendingBombs`, `pendingAccumulators`) and **`enemyDefense` / `enemyHp`** become optional, resolved internally as `?? []` / `?? 0`. A DoT applied to nobody lands in a throwaway array and vanishes — which is the correct no-victim semantics.

⚠️ **Named residual, deliberately NOT fixed here.** `playerTurn.ts:1269` reads `const enemyHpPct = enemyHp > 0 ? … : 100` — so with no victim, `enemyHpPct` still answers **100**, i.e. "a healthy enemy". That is byte-identical to today (A.4: decline is always 0 on these turns), and making it honest means widening the required `PlayerRoundCtx.enemyHpPct` (`playerTurn.ts:248`) — a separate rung. Task 5 measures whether any shipped kit has an enemy-HP-**above** gate that the phantom 100 could satisfy on an ally-targeted cast; if zero, it is corpus-inert, gets a tripwire test, and is filed as an issue.

---

## Task 1: Characterization — pin that a support ship keeps acting

The safety net for the whole rung. It must be **green today** (via the ghost) and **green at the end** (via the no-victim path). If it ever goes red, the rung has silenced a support ship.

**Files:**
- Create: `src/utils/combat/__tests__/noVictimPlayerTurn.test.ts`

**Interfaces:**
- Consumes: `bareInput`, `bareEnemy`, `bareAlly`, `BARE_ALLY_ID` from `src/utils/combat/__testutils__/bareRosterFixture`; `runCombat` from `../engine`.
- Produces: nothing other tasks import.

- [ ] **Step 1: Write the test**

```ts
/**
 * SP-4c-2b — a player ship casting on an ALLY keeps taking its turn.
 *
 * THE GAME CASE: Hermes ("repairs 27% of its Max HP", `activeTarget: allies`) acts with three
 * enemies on the board. Its cast aims at an ally, so no enemy victim resolves. Before this rung the
 * engine handed Hermes the invisible dummy `enemy` as its victim; after it, Hermes faces NOTHING.
 * Either way the repair must land and the turn must happen.
 *
 * This file is the rung's safety net, and it is deliberately written to pass BOTH before and after.
 * 24 of 148 shipped ships have an ally-side active target (every healer/shielder/buffer), so a
 * regression here silences the whole support half of the game — the same shape as the
 * `twoTeamBattle` "enemy supporter turn skipped after the focus player dies" repro.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { setupKeyedTestRng, resetRateGateRng } from '../../calculators/rateAccumulator';
import { bareInput, bareAlly, bareEnemy, BARE_ALLY_ID } from '../__testutils__/bareRosterFixture';
import type { ShipSkills } from '../../../types/abilities';

/** A Hermes-shaped kit: repair only, aimed at allies. No enemy-facing clause — which is what all
 *  24 shipped ally-target ships look like (plan §A.2). */
const repairKit = (): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                {
                    id: 'repair1',
                    type: 'heal',
                    target: 'all-allies',
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'heal', pct: 27, basis: 'hp' },
                },
            ],
        },
    ],
});

/** The focus starts the fight at full HP and so does the ally, and a repair on a full-HP ally is
 *  an OVERHEAL that may log nothing at all — the same trap `kitFingerprintScenarios`' 'wounded'
 *  seeding exists to avoid. Seed the ally hurt so the repair has somewhere to go. */
const HURT_PCT = 0.4;

const supportRun = () => {
    const bus = createEventBus();
    const focusTurns: number[] = [];
    const allyRepairs: Array<{ oldPct: number; newPct: number }> = [];
    bus.on('turn-started', (e: Extract<CombatEvent, { type: 'turn-started' }>) => {
        if (e.actorId === 'attacker') focusTurns.push(e.round);
    });
    bus.on('hp-changed', (e: Extract<CombatEvent, { type: 'hp-changed' }>) => {
        if (e.targetId === BARE_ALLY_ID && e.newPct > e.oldPct) {
            allyRepairs.push({ oldPct: e.oldPct, newPct: e.newPct });
        }
    });
    runCombat({
        ...bareInput(),
        position: 'M4',
        // The ally-side target is what makes the opposing selection resolve nobody. The
        // normalization boundary FILLS an absent target but never SUBSTITUTES an ally-side one
        // (`normalizeRoster.ts:79-81`), so this shape reaches the engine unrewritten.
        target: { raw: 'ally-team', side: 'ally', selection: 'team' },
        pattern: { raw: 'base', shape: 'base', range: 0, modifiers: {} },
        shipSkills: repairKit(),
        teamActors: [bareAlly()],
        enemyAttackers: bareEnemy({ stats: { hp: 10_000_000 } }),
        bus,
        __testTapActors: (actors) => {
            const ally = actors.find((a) => a.id === BARE_ALLY_ID);
            if (ally) ally.currentHp = ally.stats.hp * HURT_PCT;
        },
    });
    return { focusTurns, allyRepairs };
};

describe('SP-4c-2b: an ally-targeted player cast still acts', () => {
    beforeEach(() => {
        setupKeyedTestRng(12345);
        resetRateGateRng();
    });

    it('the support ship takes its turn every round', () => {
        const { focusTurns } = supportRun();
        // bareInput().numRounds === 2. A skip (the shape the spec's literal wording would have
        // produced) reads 0 here — which is the exact failure this file exists to catch.
        expect(focusTurns).toHaveLength(2);
    });

    it('the repair actually lands on the ally', () => {
        const { allyRepairs } = supportRun();
        expect(allyRepairs.length).toBeGreaterThan(0);
    });
});
```

- [ ] **Step 2: Run it and confirm it passes TODAY**

Run: `npx vitest run src/utils/combat/__tests__/noVictimPlayerTurn.test.ts`
Expected: 2 passed. If either case fails the fixture is wrong, not the engine — check the event discriminant (`type`, see Step 3), the ally id, and that `HURT_PCT` seeding actually took (an overheal on a full-HP ally can log nothing at all). Fix the fixture; never weaken the assertion. **Do not proceed on a red baseline** — a characterization test that starts red proves nothing later.

- [ ] **Step 3: Confirm the event names against the real bus**

Run: `grep -n "'turn-started'\|'hp-changed'" src/utils/combat/events.ts | head`
Expected: `turn-started` carries `{ type, actorId, round }` (`events.ts:62`) and `hp-changed` carries `{ type, targetId, round, oldPct, newPct }` (`events.ts:451`). Note the discriminant is **`type`**, not `kind`, `hp-changed` has **no** `delta` and is keyed by `targetId` not `actorId`, and the bus is passed to `runCombat` as **`bus`** (`engine.ts:1341`), not `eventBus`.

- [ ] **Step 4: Full suite (this file must not disturb anything)**

Run: `npx vitest run`
Expected: `530 test files / 5879 tests` passing — the baseline plus this file's 2.

- [ ] **Step 5: Commit**

```bash
git add src/utils/combat/__tests__/noVictimPlayerTurn.test.ts
git commit -m "test(engine): pin that an ally-targeted player cast keeps acting (SP-4c-2b)"
```

---

## Task 2: Make the victim optional inside `runPlayerTurn`

The bulk of the work, and **zero behaviour change**: the engine still always passes a victim, so every `hasVictim` branch stays on its existing arm. This is a type widening plus 25 guarded reads.

**Files:**
- Modify: `src/utils/combat/playerTurn.ts` (interface at `473-485`; the 25 read sites enumerated in §B)
- Test: `src/utils/combat/__tests__/noVictimPlayerTurn.test.ts` (must stay green)

**Interfaces:**
- Produces: `PlayerTurnArgs.enemy?: CombatActor` — absent means "no victim this turn". Also optional: `corrosionEntries?`, `infernoEntries?`, `genericDoTEntries?`, `pendingBombs?`, `pendingAccumulators?`, `enemyDefense?`, `enemyHp?`. Task 3's `buildTurnArgs` is the only producer of the absent shape.

- [ ] **Step 1: Widen the interface**

In `PlayerTurnArgs` (`playerTurn.ts:473`):

```ts
export interface PlayerTurnArgs {
    runtime: PlayerActorRuntime;
    /** SP-4c-2b: ABSENT means there is no victim this turn — an ally-targeted cast resolved nobody
     *  on the opposing side. Before this rung the engine passed the dummy `enemy` ghost here, whose
     *  `shieldPool`/`currentHp`/`stats` were then read as if they described a real opponent (plan
     *  §A.4-A.5). Absent is NOT "a neutral enemy": every read below answers "there is no enemy". */
    enemy?: CombatActor;
    statusEngine: StatusEngine;
    // DoT containers (live on the enemy actor; passed through for clarity). SP-4c-2b: absent on a
    // no-victim turn — a DoT applied to nobody lands nowhere.
    corrosionEntries?: ActiveDoTStack[];
    infernoEntries?: ActiveDoTStack[];
    /** SP-E: generic (absolute per-tick) DoT entries. */
    genericDoTEntries?: ActiveDoTStack[];
    pendingBombs?: PendingBomb[];
    pendingAccumulators?: PendingAccumulator[];
    /** SP-4c-2b: absent on a no-victim turn (no victim ⇒ no defence to pierce). */
    enemyDefense?: number;
    /** SP-4c-2b: absent on a no-victim turn. NOTE the residual at :1269 — `enemyHpPct` still
     *  answers 100 when this is 0, which is byte-identical to the ghost's reading but is not yet
     *  honest. See the plan's §B residual note. */
    enemyHp?: number;
    // …rest unchanged
```

- [ ] **Step 2: Resolve the discriminator and the container defaults after the destructure**

Immediately after the `const { runtime, enemy, statusEngine, corrosionEntries, … } = args;` block (`playerTurn.ts:1122`):

```ts
const hasVictim = enemy !== undefined;
// Resolved ONCE so the ~30 downstream uses read a non-optional local. A DoT clause on a no-victim
// turn mutates a throwaway array, which is the correct semantics: it lands on nobody.
const corrosion = corrosionEntries ?? [];
const inferno = infernoEntries ?? [];
const genericDoTs = genericDoTEntries ?? [];
const bombs = pendingBombs ?? [];
const accumulators = pendingAccumulators ?? [];
const victimDefence = enemyDefense ?? 0;
const victimMaxHp = enemyHp ?? 0;
```

Then replace downstream uses of the raw destructured names with these locals. Note `args.corrosionEntries` is also read directly at `812-824` and `841-843` — route those through the same locals or `?? []` at the call.

- [ ] **Step 3: Apply the five §B classes to all 25 sites**

Work the enumerated list in §B. Representative edits:

```ts
// Class 3 — :1268-1269
const enemyHpDecline = enemy ? Math.max(0, victimMaxHp - enemy.currentHp) : 0;

// Class 3 — :1371 (byte-identical: the ghost's affinity was ALWAYS undefined, plan §A.4)
? computeAffinityModifiers(attackerAff, enemy?.affinity ?? 'antimatter').damageModifier

// Class 3 — :1389
const targetImmuneToDebuffs = enemy ? targetCarriesBlockDebuff(statusEngine, enemy.id) : false;

// Class 1 — SIX sites (:1612-1614, :1643, :2042, :2152, :2420-2422, :2454). Do NOT hand-copy the
// spread six times: define ONE helper next to `hasVictim` and spread it at each site. Six copies of
// the same conditional is the "N>2 near-identical blocks" smell the SP-2 review already called out,
// and it also guarantees the six sites can drift apart later.
/** The victim-derived slice of a gate context. Empty when there is no victim — every field here is
 *  optional with a documented default (`targetSpeed?`/`targetCurrentHp?`/`targetCritPower?` →
 *  `?? 0` at roundContext.ts:160 and evaluateConditions.ts:199; `enemyShielded?` → false at
 *  triggers.ts:1779), so omission answers "there is no enemy" rather than inventing a neutral one. */
const victimGateCtx = (v: CombatActor | undefined) =>
    v
        ? {
              targetSpeed: v.stats.speed,
              targetCurrentHp: v.currentHp,
              targetCritPower: v.stats.critDamage,
              enemyShielded: v.shieldPool > 0,
          }
        : {};

// then at each of the six sites, replacing the hand-written fields:
...victimGateCtx(enemy),

// Class 5 — :2918
if (enemy?.destroyedRound !== undefined) break;

// Class 4 — :1730 (same shape at :3315, :3339)
? (opposingVictimById?.get(vid) ?? (enemy && vid === enemy.id ? enemy : undefined))
```

For **Class 2** (`1281`, `1292`, `2929`, `3044`, `3070`, `3102`, `3121`, `4165`) fence the enclosing clause. The default-parameter sites need the id to become required at the call instead of defaulted from the victim:

```ts
// :1281 / :1292 — the victim id can no longer be defaulted from `enemy`.
const emitDebuffResisted = (buffName: string, victimId: string) => …
const emitDebuffApplied = (sourceId: string, buffName: string, victimId: string) => …
```

Then fix every caller that relied on the default by passing the id explicitly, and guard each enclosing application block with `if (!enemy) …` so a no-victim turn never reaches it. **Let `tsc` find the callers — do not grep for them.**

- [ ] **Step 4: Typecheck — this is the real driver for this task**

Run: `npx tsc --noEmit`
Expected: clean. Every error it reports before that is a site the widening reached; fix each with the §B answer for its class, not with `!` or `as`. **A non-null assertion here re-creates the ghost** — if a site truly cannot proceed without a victim, guard it instead.

- [ ] **Step 5: Full suite — must be ZERO movement**

Run: `npx vitest run`
Expected: `530 files / 5879 tests` passing, **no snapshot writes**. The engine still always passes a victim, so any movement here means a `hasVictim` branch changed the with-victim arm. Investigate; do not re-pin.

Run: `git status --short`
Expected: only `playerTurn.ts` modified. **A modified `.snap` file at this step is a defect signal.**

- [ ] **Step 6: Lint and commit**

```bash
npm run lint
git add src/utils/combat/playerTurn.ts
git commit -m "refactor(engine): runPlayerTurn tolerates a turn with no victim (SP-4c-2b)"
```

---

## Task 3: `buildTurnArgs` emits the no-victim arg shape

Still zero movement — nothing calls it with `undefined` yet.

**Files:**
- Modify: `src/utils/combat/engine.ts` (`buildTurnArgs` at `7198`)

**Interfaces:**
- Consumes: `PlayerTurnArgs` with the optional fields from Task 2.
- Produces: `buildTurnArgs(a: CombatActor, tgt: CombatActor | undefined)`.

- [ ] **Step 1: Widen the signature and branch the victim-derived fields**

```ts
const buildTurnArgs = (a: CombatActor, tgt: CombatActor | undefined) => {
```

Inside, the victim-derived members become conditional. Note what §A.4 already proved: `targetId` and `enemyDebuffNames` are **already omitted** on exactly these turns, because `tgt.id === enemy.id` made both §2.3 guards false — so preserving the omission is byte-identical, and §2.3's "both context guards drop" falls out of the `tgt !== undefined` form rather than needing a separate change:

```ts
...(tgt
    ? {
          enemy: tgt,
          corrosionEntries: tgt.corrosionEntries,
          infernoEntries: tgt.infernoEntries,
          genericDoTEntries: tgt.genericDoTEntries,
          pendingBombs: tgt.pendingBombs,
          pendingAccumulators: tgt.pendingAccumulators,
          enemyDefense: tb.victimDefenceFor(tgt),
          enemyHp: tb.victimMaxHpFor(tgt),
          targetRepairedThisRound: repairedThisRound.has(tgt.id),
          targetEffectiveAttack: effectiveStatsOf(statusEngine, selfBuffLookup, tgt).attack,
      }
    : {}),
// SP-4c-2b: the two §2.3 guards keep their `tgt.id !== enemy.id` form for the WITH-victim case;
// a no-victim turn omits both, which is exactly what they already did when tgt was the ghost.
...(tgt && (a.side === 'enemy' || tgt.id !== enemy.id) ? { targetId: tgt.id } : {}),
...(tgt && (a.side === 'enemy' || tgt.id !== enemy.id)
    ? { enemyDebuffNames: enemyDebuffNamesForTarget(tgt) }
    : {}),
```

`aoeVictimIds` and `opposingVictimById` already key off `tgt.position != null`; make them `tgt?.position != null` (§A.4: always `undefined` on these turns, so no behaviour rides on it).

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean. The two call sites still pass a defined `tgt`, so no caller changes yet.

- [ ] **Step 3: Full suite — ZERO movement again**

Run: `npx vitest run`
Expected: `530 files / 5879 tests`, no `.snap` changes (`git status --short` shows only `engine.ts`).

- [ ] **Step 4: Commit**

```bash
npm run lint
git add src/utils/combat/engine.ts
git commit -m "refactor(engine): buildTurnArgs can build a victim-less turn (SP-4c-2b)"
```

---

## Task 4: The player sites run the turn instead of skipping it

The `continue` lines are removed **before** the switch is thrown, so the switch commit is two lines. Still zero movement: `selectTurnTarget` has not changed, so `tgt` is never `undefined` here yet.

**Files:**
- Modify: `src/utils/combat/engine.ts` — focus site `~9124-9156`, team site `~9450-9473`

- [ ] **Step 1: Delete both `continue` guards and their stale comments**

At the focus site, this block goes entirely:

```ts
// The player side's legacy victim is the always-present dummy `enemy`
// sink, so `tgt` is never undefined here — this is a type-narrowing
// no-op (selectTurnTarget widened for the enemy side in SP-U U5 R6).
if (tgt === undefined) continue;
```

and the same three-line comment + `if (tgt === undefined) continue;` at the team site. Replace each with:

```ts
// SP-4c-2b: `tgt` is undefined when this cast targets an ALLY — there is no opposing victim to
// resolve. The turn still RUNS (a repair/buff must land); only the victim-derived context is
// absent. Skipping here would permanently silence all 24 shipped ally-target support ships.
```

- [ ] **Step 2: Make the victim-dependent turn-locals tolerate the absence**

At both sites the pre-turn locals read `tgt` directly:

```ts
const tgtWasStasised = !actor.doesntBreakStasis && tgt !== undefined && isStasised(tgt.id);
```

(and `teamTgtWasStasised` at the team site). `buildTurnArgs(actor, tgt)` now accepts `undefined` from Task 3. Let `tsc` locate any remaining `tgt.` read in the two blocks and give each the honest no-victim answer — the post-turn bookkeeping tails are the ones to watch.

- [ ] **Step 3: Typecheck, then full suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean; `530 files / 5879 tests`; `git status --short` shows only `engine.ts`.

- [ ] **Step 4: Commit**

```bash
npm run lint
git add src/utils/combat/engine.ts
git commit -m "refactor(engine): the player sites run a victim-less turn rather than skipping (SP-4c-2b)"
```

---

## Task 5: Throw the switch — and absorb every predicted move

The behavioural commit. Two lines of production change; everything else in it is test re-homing and golden attribution.

**Files:**
- Modify: `src/utils/combat/engine.ts` — `selectTurnTarget` at `7188-7189`, and the counter doc block at `1698-1758`
- Modify: `src/utils/combat/__tests__/dummyReachability.test.ts` (LIVENESS + the vacuity guarantee)
- Modify: `src/utils/combat/__tests__/dummyEnemyTurnGate.test.ts` (ally-side-target cases)
- Modify: `src/utils/combat/__tests__/patternScopedSupport.integration.test.ts`, `src/utils/combat/__tests__/passiveSupportPatternScope.integration.test.ts` (§A.7 inert clauses)
- Modify: `src/utils/calculators/__tests__/__snapshots__/realKitFingerprints.test.ts.snap` (§A.5, 22 ships)

- [ ] **Step 1: Switch the player side**

```ts
if (selected == null) legacyVictimFallbackCount++;
return { tgt: selected ?? tb.legacyVictim };
```

becomes:

```ts
// SP-4c-2b: the PLAYER side no longer falls back to the dummy ghost. An ally-targeted cast
// resolves nobody, and the honest answer is "no victim" — the turn still runs (see the two call
// sites). The ENEMY side keeps `legacyVictim: healTarget`; that anchor is 4e's job, not this rung's.
if (selected == null && a.side === 'player') {
    noVictimPlayerTurnCount++;
    return { tgt: undefined };
}
if (selected == null) legacyVictimFallbackCount++;
return { tgt: selected ?? tb.legacyVictim };
```

- [ ] **Step 2: Keep the counters honest, and give the vacuity guard something to hold**

`legacyVictimFallbackCount`'s own doc block defines it as *"the fallback object was CONSULTED"*. After Step 1 the player side consults nothing, so incrementing it there would be a lie — hence the separate counter. Add beside the existing pair (`engine.ts:1722-1727`):

```ts
/** TEST-ONLY. Counts player turns that resolved NO victim (SP-4c-2b) — an ally-targeted cast with
 *  nobody on the opposing side to anchor on. Distinct from `legacyVictimFallbackCount`, which by its
 *  own definition counts CONSULTATIONS of a fallback object: after 4c-2b the player side has no
 *  fallback to consult, so folding these into that counter would make its name false. 4c-2c/4c-2d
 *  gate on the credit counter; this one exists so `dummyReachability`'s vacuity guard keeps a moving
 *  number to assert. */
let noVictimPlayerTurnCount = 0;
export const __getNoVictimPlayerTurnCount = () => noVictimPlayerTurnCount;
export const __resetNoVictimPlayerTurnCount = () => {
    noVictimPlayerTurnCount = 0;
};
```

Update the `legacyVictimFallbackCount` doc block at `1698-1758` so it says enemy-side-only, and correct the `2644` and `7204` comments that still describe the player side falling back to the dummy.

- [ ] **Step 3: Re-home `dummyReachability.test.ts`'s LIVENESS case deliberately**

Its `counters()` helper reads `{ consulted, credited }`. Per §A.6 the **credit is unaffected** — it comes from the dummy's own DoT-tick turn at `engine.ts:9697`, not from the focus's turn args — so:

```ts
// SP-4c-2b re-home. `consulted` drops to 0: the focus's ally-side selection no longer consults a
// fallback, it resolves NO victim (`__getNoVictimPlayerTurnCount`). `credited` is UNCHANGED at
// BARE_ROUNDS, and that distinction is the point of this case — the credit never came from the
// focus's turn args, it comes from the dummy's own DoT-tick turn (engine.ts:9697, inside
// `actor.kind === 'enemy' && actor.id === enemy.id`), which 4c-2b does not touch. 4c-2c does.
expect(counters()).toEqual({ consulted: 0, credited: BARE_ROUNDS });
expect(__getNoVictimPlayerTurnCount()).toBe(BARE_ROUNDS);
```

`result.rounds[0].corrosionDamage` stays `500` (`0.05 × 10_000`) — if it moves, the dummy's tick path was disturbed and this rung overreached. Add `__resetNoVictimPlayerTurnCount()` to the `beforeEach`, and extend `counters()` or assert the new counter separately as above.

- [ ] **Step 4: Run the three at-risk files FIRST, before the full suite**

Run:
```bash
npx vitest run src/utils/combat/__tests__/dummyReachability.test.ts \
  src/utils/combat/__tests__/dummyEnemyTurnGate.test.ts \
  src/utils/combat/__tests__/noVictimPlayerTurn.test.ts
```
Expected: `noVictimPlayerTurn` green (the rung's whole point). For the other two, read each failure against §A before touching it. `dummyEnemyTurnGate`'s subject is the **turn-order gate**, which this rung does not change — the dummy still takes its tick turn off an ally-side target — so its cases should still pass. **If one fails, say why in the test's comment; do not blanket-update.** Its ally-side-target cases feed the same shape this rung changes, so a comment refresh is expected even where the assertion holds.

- [ ] **Step 5: Full suite, then attribute every single move**

Run: `npx vitest run`
Then: `git status --short`

⚠️ **The prediction below was MEASURED and is WRONG — see §A.8 in `.superpowers/sdd/sp4c2b-contract.md`
for the real movement (4 fingerprints, not 22, via three distinct mechanisms). Use §A.8.**

Originally predicted movement:
1. `realKitFingerprints.test.ts.snap` — the 22 support ships of §A.5, where `richEnemy`'s ghost-armed `shieldPool` stopped answering `enemyShielded: true`.
2. `placementSymmetry.test.ts` — its one `richEnemy` shield case (§A.5).
3. The 4 files of §A.7 whose ally-targeted casts carry an enemy-facing clause that now lands nowhere.

For each moved fingerprint, record in the commit body: **ship name → which token moved → which gate → why**. A move outside this predicted set is a defect signal: investigate it, never re-pin it.

- [ ] **Step 6: Measure the three known residuals before shipping**

All three were identified before the switch, so none may be discovered in a snapshot:

**(a) The attack-crit rider loss (§A.5b).** Enumerate which of the 24 ally-target ships carry an
`on-crit`/`on-ally-crit` rider, or sit on a team whose ally does, and record the expected loss per
ship. This is a predicted movement class — reconcile it against the fingerprints that actually move.

**(b) The unfenced timed enemy folds.** `foldTimedEnemyDebuffs` and the `timedAbilityEnemy` loop
still fold statuses from the phantom `__enemy__` store on a no-victim turn (they read no `enemy`, so
`tsc` could not surface them and §B does not list them). Deliberately left alone in Task 2 — the
spec holds that the side-wide scheduled channel survives as a modelling assumption. Measure whether
anything folds in practice on a no-victim turn; if it does, report before shipping.

**(c) `enemiesHitThisCastByActor` still books 1** on a cast that hit nobody
(`engine.ts:9421-9424` and the team mirror `:9719-9721`). Left alone in Task 4 under zero-movement
(`aoeVictimIds` is already `undefined` per §A.4). Same family as (d): measure whether any shipped kit
gates on `enemiesHitThisCast`, and tripwire it if none does.

**(d) The `enemyHpPct` residual.**

⚠️ Do NOT grep `docs/ship-skills.csv` with a wide `[^.]{0,40}`-style regex — it hangs (the file is one
very long line per ship). Parse it in node, or grep a narrow literal.

Run a node parse over the 24 ally-target ships' active-skill text looking for an enemy-HP-**above** gate.
Also check the 24 ally-target ships of §A.2 for an enemy-HP-**above** condition on the active slot. If none exists, the phantom `enemyHpPct: 100` is corpus-inert: add a tripwire test asserting the no-victim `enemyHpPct` reading so a future kit with such a gate fails loudly, and open an issue naming `playerTurn.ts:248` + `:1269` as the fix site. If one DOES exist, stop and report — the residual is live and needs an owner ruling before this rung ships.

- [ ] **Step 7: Commit with the attribution in the body**

```bash
npm run lint && npx tsc --noEmit
git add -A src/utils/combat src/utils/calculators
git commit -m "feat(engine): an ally-targeted player cast faces no enemy (SP-4c-2b)"
```

The body must carry: the §A.5 ship-by-ship attribution, the §A.7 inert-clause note (including that the no-victim ruling supersedes the earlier "let them land" answer, which was given for the rejected real-anchor option), and the §B `enemyHpPct` residual with its issue number.

---

## Task 6: Verify, document, and hand off to 4c-2c

**Files:**
- Modify: `src/constants/changelog.ts` (`UNRELEASED_CHANGES`)
- Modify: `docs/superpowers/specs/2026-08-18-sp4c-match-end-and-delete-the-dummy-design.md` (§7.4 row for 4c-2b)

- [ ] **Step 1: Re-measure the entry gate the next rungs depend on**

Run: `npx vitest run src/utils/combat/__tests__/dummyReachability.test.ts`
Expected: green, with `credited` still `BARE_ROUNDS` on the LIVENESS case. That non-zero credit is 4c-2c's remaining work (the dummy's own turn) and must NOT have been silently zeroed here — a zero would mean this rung reached into 4c-2c's territory.

- [ ] **Step 2: Full verification, all three gates**

Run: `npx vitest run && npx tsc --noEmit && npm run lint`
Expected: `530 files / 5879 tests` passing; tsc clean; lint clean. Record the exact counts in the PR body — do not write "all tests pass" without them.

- [ ] **Step 3: Changelog**

Add to `UNRELEASED_CHANGES` in `src/constants/changelog.ts`:

```ts
'Support ships (healers, shielders, buffers) are no longer simulated as if they were attacking an invisible full-health enemy. Their repairs and buffs are unchanged, but any part of their kit that reads the enemy board now reads the real board instead of a placeholder.',
```

- [ ] **Step 4: Update the spec's rung table**

In §7.4, amend the **4c-2b** row: the rung is a *no-victim turn*, not a cadence-only skip, and the measured consultation figure is 3,206 player rows (all ally-side), not 4,188 — that earlier number predates 4c-2a and lumped both sides together.

- [ ] **Step 5: Commit and open the PR**

```bash
git add src/constants/changelog.ts docs/superpowers/specs/2026-08-18-sp4c-match-end-and-delete-the-dummy-design.md
git commit -m "docs(engine): record SP-4c-2b's measured shape and changelog entry"
gh pr create --title "feat(engine): an ally-targeted player cast faces no enemy (SP-4c-2b)" --body "…"
```

PR body must include: the Hermes game example, §A's measured numbers, the §A.5 attribution table, the §A.7 note, the §B residual, and the test/tsc/lint counts. Then wait for CodeRabbit and **verify its review range covers HEAD** (grep the review body for `Reviewing files that changed … between <base> and <head>`) before trusting a green check.

---

## Residuals for later rungs

- **`enemyHpPct` still answers 100 with no victim** (`playerTurn.ts:248`, `:1269`) — byte-identical to today, corpus-inertness measured in Task 5 Step 6, tripwired, issue filed. The honest fix widens the required `PlayerRoundCtx` field.
- **The dummy still takes its DoT-tick turn** and still credits the scalar channel on an ally-side-target run (§A.6) — that is exactly 4c-2c's subject.
- **`enemyTurnBindings.legacyVictim: healTarget`** is untouched: 4e.
- **Issue #331** (`RoundData.teamDamage` omits positional walked-team damage) is unrelated and stays open.
