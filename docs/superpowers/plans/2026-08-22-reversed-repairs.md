# Reversed Repairs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `Reversed Repairs` status (#362) — a debuff that turns every incoming repair on its carrier into raw HP damage.

**Architecture:** `engine.ts:3547` (inside `applyHealToTarget`) is the **only** line in the entire combat engine where HP goes up, and every repair channel funnels through it. The reversal is therefore one branch in one closure, not a new call path. By the time `raw` arrives there it is already post-crit, post-`healModifier`, post-`outgoingHealBuff`, post-`incomingHealPct` (where `Inc. Repair Down` lives) and **pre**-deficit-clamp — which is exactly the value every ruling calls for.

**Tech Stack:** TypeScript, Vitest, React. No new dependencies.

## Global Constraints

Read `docs/superpowers/specs/2026-08-22-reversed-repairs-design.md` first. Its ruling table is the authority **except for R7 and R10, which the owner RETRACTED during implementation** — the spec now carries a retraction header saying so, and R7′/R10′/R11 below are what shipped. Do not re-derive any ruling from code; do not implement R7 or R10 from the spec.

- **R1 — no defensive layers.** No shield drain, no Protection redirect, no defence mitigation, no Barrier. Raw HP burn at face value.
- **R2 — every repair, any source.** Cast repairs, HoT ticks, leech self-repairs, reactive repairs. **Shield grants are not repairs** and are unaffected.
- **R3 — no deficit clamp.** A target at full HP takes the full amount.
- **R4 — the crit carries.** A repair that would have restored 6,000 reverses into 6,000.
- **R5 — nothing reacts.** No counterattack, no Reflect thorns, no incoming-leech proc, no on-damaged passives.
- **R6 — `Inc. Repair Down` applies first**, and the reduced amount is what reverses.
- ~~**R7 — the kill is credited to the healer** whose repair was reversed, never to the Zosimos that applied the debuff.~~ **RETRACTED by the owner, 2026-08-23** — it is exactly backwards. See **R7′** below.
- **R8 — Cheat Death intercepts** a lethal reversal and is spent, exactly as against a lethal attack.
- **R9 — Zosimos's charge passive still fires.** It watches the enemy *casting*, upstream of all of this. No change.
- ~~**R10 — surfaces as overhealing** for the healer.~~ **RETRACTED by the owner, 2026-08-23.**
  See R10′/R7′/R11 below. Tasks 1-6 were built against the retracted R10 and were **revised in
  place after the retraction** — the revision shipped in commits `eaeeecfd`, `3e07d163` and the
  fix-wave-2 commit, and this file has **no** separate task section describing it. (An earlier
  version of this line pointed at a "Task 5b"; that section never existed here, so the pointer
  dangled. The revision's real record is the code and the `reversedRepairs.*.test.ts` suites.)

**R10′ (replaces R10) — a reversed repair books NOTHING on the healer.** Repairs cast `0`,
effective healing `0`, overhealing `0`. The event does not appear on the healer's line at all.
Owner's words: *"it doesn't need to be booked as overheal. we don't need to book it as anything
other than damage from a debuff."*

**R7′ (supersedes R7) — the damage AND the kill are credited to the DEBUFF'S APPLIER** (Zosimos),
not to the healer whose repair triggered it. It is the debuff's damage, attributed the way a DoT's
damage and kills belong to whoever applied the DoT. The original R7 credited the healer; that was
answered when the model was "the repair becomes damage", and the retraction changes the model.

**R11 (new) — a reversal writes its own combat-log line**, including when it does not kill.
Without one the player sees a repair land, sees it achieve nothing, and sees HP drop, with nothing
connecting the three.

> **Why this is a real code change, not a relabelling.** Every call site credits its heal bucket
> (`directHeal` / `hotHeal`) *before* calling `applyHealToTarget`, so the closure cannot retract it.
> R10′ therefore requires the credit to move after the call, or not to happen — at all 9 sites.
> Returning `{consumed: 0, overheal: 0}` satisfies two thirds of R10′ and silently leaves the gross
> cast credited, which is exactly the shape that ships green tests and wrong numbers.

Additional project rules that bind every task:

- **Team symmetry is mandatory** (`feedback_engine_team_symmetry`). Every behaviour must work identically with an enemy-side Zosimos applying the debuff to a player ship. Every engine test in this plan gets both arms.
- **Never run `vitest -u`.** Snapshot re-baselining is Task 7 only, and is deliberate.
- **`npm test` is the gate** — there is no CI test workflow; the husky pre-commit hook runs the full suite.
- **RNG:** if a test needs determinism, pin with `setupKeyedTestRng(seed)` **alone**. Never follow it with `resetRateGateRng()`, which un-seeds it.
- **Percentage stats are stored as integers** (crit `70`, not `0.70`).

---

### Task 1: Extract one shared lethal-HP path

The Cheat-Death intercept and destroy bookkeeping currently live **inside** `applyVictimDamage` (`engine.ts:5792-5840`). R8 puts Cheat Death on the reversal path too, and a hand-copied second death path is the shape that produced the one-directional defects in #306. Extract it before adding any caller.

This task is **behaviour-preserving**. The existing goldens are the check: if any snapshot moves, the extraction is wrong.

**Files:**
- Modify: `src/utils/combat/engine.ts:5792-5840` (extract), `:4920-4975` region (add the emitter)
- Create: `src/utils/combat/lethalHp.ts`
- Test: existing suite only (no new test — this is a refactor)

**Interfaces:**
- Produces: `resolveLethalHp(victim, opts): 'cheat-death' | 'destroyed' | 'alive'` from `src/utils/combat/lethalHp.ts`, consumed by Task 5.

**Two facts that constrain the shape — verify both before writing code:**

1. **Only `cheat-death-log` is ever deferred.** `ship-destroyed` (via `recordDestroyed`, `state.ts:236-246`) and `cheat-death-activated` both emit directly through `bus.emit` on every path. So the helper needs exactly one deferrable emission.
2. **Heal-applies DO run inside deferral windows.** Reactive repairs go through `executeIntent` (`triggers.ts:3133`, applying at `:4162`), which fires inside all three windows: `applyCounterAttack` (`engine.ts:6426`), the reactive-damage proc (`:6661`), and `drivePositionalApply` (`:7047`). So the reversal cannot simply call `bus.emit` — it needs the same buffer.

- [ ] **Step 1: Hoist the duplicated consequence-log emit into one engine-scope function**

The `if (deferReflectLogs || deferConsequenceLogs) pendingConsequenceLogs.push({ev, subAttack: currentSubAttackIndex}); else bus.emit(ev);` pattern appears verbatim at four sites in `engine.ts` (shield-applied-log at `:5572`, cheat-death-log at `:5836`, and two more — grep `pendingConsequenceLogs.push` to find them all).

Declare a mutable engine-scope emitter **above** `healingCtx` (`engine.ts:3514`) so the reversal can reach it:

```ts
// Installed per turn (below, where the deferral flags live). Engine scope so the healing ctx —
// built at :3514, above the per-turn scope — can route a reversal's consequence log through the
// same buffer. Default is a direct emit: a reversal that somehow fires before the first turn
// installs one still logs, it just cannot be deferred (there is no window open to defer into).
let emitConsequenceLog: (ev: CombatEvent) => void = (ev) => bus.emit(ev);
```

Then install the real one inside the per-turn scope, immediately after `deferConsequenceLogs` is declared (`engine.ts:4975`):

```ts
emitConsequenceLog = (ev: CombatEvent) => {
    if (deferReflectLogs || deferConsequenceLogs)
        pendingConsequenceLogs.push({ ev, subAttack: currentSubAttackIndex });
    else bus.emit(ev);
};
```

Replace all four inline copies with `emitConsequenceLog(ev)`.

> **TDZ note — do not shortcut this.** `emitConsequenceLog` is a `let` in engine scope read only at *call* time, long after the per-turn install has executed. That is safe. It would **not** be safe to capture its value into `healingCtx`'s object literal at construction time (`healingCtx.emit = emitConsequenceLog` would freeze the default forever). Route through the binding, never a copy of it.

- [ ] **Step 2: Run the full suite to confirm the hoist changed nothing**

Run: `npm test`
Expected: PASS, identical counts to `main`. Any golden/fingerprint movement means the hoist is not behaviour-preserving — stop and diff before continuing.

- [ ] **Step 3: Create the shared helper**

Create `src/utils/combat/lethalHp.ts`:

```ts
import type { CombatActor } from './state';
import { recordDestroyed } from './state';
import type { StatusEngine } from './statusEngine';
import type { CombatEvent, CombatEventBus } from './events';
import { selfBuffNamesForOwners } from './triggers';
import { CHEAT_DEATH_BUFFS } from './cheatDeathBuffs';

export interface LethalHpOpts {
    round: number;
    statusEngine: StatusEngine;
    /** Per-combat consumption flag set — NOT a store mutation (Cheat Death is 'recurring'). */
    cheatDeathConsumed: Set<string>;
    /** Display-only: the round a save was spent, so the chip drops from later rounds. */
    cheatDeathConsumedRound: Map<string, number>;
    bus: CombatEventBus;
    /** Routes the LOG-ONLY twin through the caller's deferral buffer. */
    emitConsequenceLog: (ev: CombatEvent) => void;
    /** Stamped on the log twin. Undefined outside a turn. */
    actingActorId: string | undefined;
    killerId?: string;
    byDirectDamage?: boolean;
}

/**
 * Resolve an actor that has just reached 0 HP: Cheat-Death intercept, else record the destroy.
 *
 * ONE death path for the whole engine. `applyVictimDamage` and the Reversed Repairs reversal
 * (#362) both call it — a hand-copied second path is the shape that produced the one-directional
 * defects in #306.
 *
 * Bomb death-splash deliberately stays at the `applyVictimDamage` call site: it recurses back into
 * `applyVictimDamage`, so it cannot live here, and per R5 the reversal path must not splash at all.
 * Callers gate their splash on a `'destroyed'` return.
 *
 * Returns `'alive'` when the victim is above 0 — safe to call unconditionally.
 */
export function resolveLethalHp(victim: CombatActor, opts: LethalHpOpts): 'cheat-death' | 'destroyed' | 'alive' {
    if (victim.currentHp > 0) return 'alive';
    const targetId = victim.id;
    // Detection MUST go through selfBuffNamesForOwners, NOT snapshot().activeSelfBuffs: a real
    // Cheat Death is an ability-sourced recurring self-buff, and the heal target's owner id is
    // often a team-actor id — snapshot alone misses both cases.
    const carriesCheatDeath = selfBuffNamesForOwners(opts.statusEngine, [targetId]).some((n) =>
        CHEAT_DEATH_BUFFS.has(n)
    );
    if (carriesCheatDeath && !opts.cheatDeathConsumed.has(targetId)) {
        victim.currentHp = 1;
        opts.cheatDeathConsumed.add(targetId);
        if (!opts.cheatDeathConsumedRound.has(targetId)) {
            opts.cheatDeathConsumedRound.set(targetId, opts.round);
        }
        opts.statusEngine.clearRemovable(targetId);
        // Actor-state DoT stacks are NOT StatusEngine entries, so clearRemovable misses them.
        // SP-E: filter, don't clear — an `unremovable` stack (Acidic Decay) keeps ticking.
        victim.corrosionEntries = victim.corrosionEntries.filter((e) => e.unremovable);
        victim.infernoEntries = victim.infernoEntries.filter((e) => e.unremovable);
        victim.genericDoTEntries = victim.genericDoTEntries.filter((e) => e.unremovable);
        // Real event INLINE for its combat listener (Yazid on-cheat-death-activated) — keeps
        // listener timing byte-identical. The LOG-ONLY twin carries the nesting.
        opts.bus.emit({ type: 'cheat-death-activated', actorId: targetId, round: opts.round });
        opts.emitConsequenceLog({
            type: 'cheat-death-log',
            actorId: targetId,
            round: opts.round,
            reactive: true,
            duringTurnOf: opts.actingActorId,
            triggerActorId: opts.actingActorId,
        });
        return 'cheat-death';
    }
    recordDestroyed(victim, opts.round, opts.bus, opts.killerId, opts.byDirectDamage);
    return 'destroyed';
}
```

> Check the real import paths for `CHEAT_DEATH_BUFFS` and `CombatEventBus` before writing — the names above are from `engine.ts`'s own usage, but confirm the exporting module.

- [ ] **Step 4: Rewrite the funnel's death block to call it**

In `applyVictimDamage`, replace the body of `if (victim.currentHp <= 0) { ... }` (`engine.ts:5792-5840` plus its `else`) with:

```ts
if (victim.currentHp <= 0) {
    // Captured BEFORE resolveLethalHp (which stamps destroyedRound): the destroyed branch can
    // RE-ENTER on a corpse hit, so this gate + the up-front bomb consume make the splash fire once.
    const wasAliveBeforeThisCall = victim.destroyedRound === undefined;
    const outcome = resolveLethalHp(victim, {
        round: r,
        statusEngine,
        cheatDeathConsumed,
        cheatDeathConsumedRound,
        bus,
        emitConsequenceLog,
        actingActorId,
        killerId: cause?.killerId,
        byDirectDamage: cause?.byDirectDamage,
    });
    if (outcome === 'destroyed') {
        // ...existing bomb-splash-on-death block, verbatim and unchanged...
    }
}
```

Keep the bomb-splash block byte-identical. Only its guard moves from the `else` to `outcome === 'destroyed'`.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS, identical counts to Step 2. This is a pure refactor — **any** golden or fingerprint movement is a bug in the extraction, not a baseline to update. Do not run `vitest -u`.

- [ ] **Step 6: Commit**

```bash
git add src/utils/combat/lethalHp.ts src/utils/combat/engine.ts
git commit -m "refactor(engine): extract one shared lethal-HP path and hoist the consequence-log emit (#362)"
```

---

### Task 2: Parse `Reversed Repairs` into a debuff

Zosimos's charged skill inflicts the status and the built kit carries nothing for it. The status is absent from `src/constants/buffs.ts` entirely, and the parser resolves `<unit-skill>` names against that table (`skillTextParser.ts:79`) — so the missing entry is the cause, not a cosmetic omission.

**Files:**
- Modify: `src/constants/buffs.ts` (beside the repair ladder, `Inc. Repair Down I/II/III` at `:494-506` and `Block Repair` at `:687`)
- Test: `src/utils/abilities/__tests__/zosimosReversedRepairs.build.test.ts` (create)

**Interfaces:**
- Produces: the string `'Reversed Repairs'` as a known debuff name, consumed by Task 3.

- [ ] **Step 1: Write the failing test**

Create `src/utils/abilities/__tests__/zosimosReversedRepairs.build.test.ts`. Text is VERBATIM from `docs/ship-skills.csv` row `Zosimos`, `first_passive_skill_text` column (which holds the charged text) — the parser source of truth, never `ships.ts`:

```ts
/**
 * Zosimos charged — `Reversed Repairs` builds as a 1-turn enemy debuff (#362).
 *
 * Production-routed builder probe: drives the REAL buildShipAbilities path, not a parser unit.
 */
import { describe, it, expect } from 'vitest';
import { buildShipAbilities } from '../buildShipAbilities';
import { Ability, Skill } from '../../../types/abilities';
import { Ship } from '../../../types/ship';

function ship(over: Partial<Ship>): Ship {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { ...({} as any), refits: [{}, {}, {}, {}], ...over } as Ship;
}
function slot(skills: Skill[], name: string): Skill | undefined {
    return skills.find((s) => s.slot === name);
}
function abilitiesFor(over: Partial<Ship>, name: string): Ability[] {
    return slot(buildShipAbilities(ship(over)).slots, name)?.abilities ?? [];
}

// Verbatim from docs/ship-skills.csv row "Zosimos".
const ZOSIMOS_CHARGED =
    'This Unit inflicts <unit-skill>Reversed Repairs</unit-skill> for 1 turn and deals <unit-damage>300% damage</unit-damage>.';

describe('Zosimos charged — Reversed Repairs debuff', () => {
    const abilities = abilitiesFor({ chargeSkillText: ZOSIMOS_CHARGED }, 'charged');

    it('builds the Reversed Repairs debuff for 1 turn on the enemy', () => {
        const rr = abilities.find(
            (a) =>
                a.type === 'debuff' &&
                (a.config as { buffName?: string }).buffName === 'Reversed Repairs'
        );
        expect(rr).toBeDefined();
        expect(rr!.target).toBe('enemy');
        expect(rr!.config).toMatchObject({
            type: 'debuff',
            buffName: 'Reversed Repairs',
            duration: 1,
        });
    });

    it('still builds the 300% damage clause, and no phantom self-heal', () => {
        // Regression fence for the fabricated 300%-of-max-HP self-heal fixed in `fe0b4644`
        // (maskStatusNameRepairs). "Repairs" in the status NAME must not read the damage clause's %.
        expect(abilities.some((a) => a.type === 'damage')).toBe(true);
        expect(abilities.some((a) => a.type === 'heal')).toBe(false);
    });
});
```

> Confirm the ship field name for the charged text before running — `chargeSkillText`, **not** `chargedSkillText`. A silent field-name typo through a cast is a known trap on this codebase: the wrong name compiles and the fixture reads an empty string, so the test passes vacuously.

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/utils/abilities/__tests__/zosimosReversedRepairs.build.test.ts`
Expected: FAIL on the first test — `expect(rr).toBeDefined()` receives `undefined`. The second test should already PASS (that fix shipped in `fe0b4644`); if it fails, stop — the regression fence caught something.

- [ ] **Step 3: Add the buff entry**

In `src/constants/buffs.ts`, beside `Block Repair` (`:687`):

```ts
{
    name: 'Reversed Repairs',
    description: 'Incoming repairs damage this unit instead',
    type: 'debuff',
},
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/utils/abilities/__tests__/zosimosReversedRepairs.build.test.ts`
Expected: PASS, both tests.

If the first still fails, the duration is the likely culprit: `DURATION_RE` is `for\s+(\d+)\s+turns?`. Zosimos's text reads `for 1 turn` with real spaces, so it should match — but confirm the CSV row has no concatenation typo (`1turn`), which is what broke Morao's Provoke duration.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS. Adding a buff name can shift kit fingerprints for any ship whose text mentions it. If `realKitFingerprints > Zosimos` moves, that is **expected and correct** but **do not re-baseline yet** — Task 7 owns that, after the behaviour is right. Note the movement and continue.

- [ ] **Step 6: Commit**

```bash
git add src/constants/buffs.ts src/utils/abilities/__tests__/zosimosReversedRepairs.build.test.ts
git commit -m "fix(parser): Reversed Repairs builds as a 1-turn enemy debuff (#362)"
```

---

### Task 3: The status read

**Files:**
- Create: `src/utils/combat/reversedRepairs.ts`
- Test: `src/utils/combat/__tests__/reversedRepairs.read.test.ts` (create)

**Interfaces:**
- Consumes: the `'Reversed Repairs'` buff name from Task 2.
- Produces: `REVERSED_REPAIRS: string` and ~~`hasReversedRepairs(statusEngine: StatusEngine, victim: { id: string; side: 'player' | 'enemy' }): boolean`~~, consumed by Task 5.

> **⚠️ SUPERSEDED BY R7′ — THE READ IS NOT A BOOLEAN.** Everything below about *which channels*
> to read, *why* the scheduled arm needs a side gate, and *why* the bare-id shape was unsafe is
> still exactly right and still the reason the module looks the way it does. What changed is the
> RETURN: R7′ books the burn's damage and kill on the **applier**, so the read has to say *who*,
> not just *whether*. Shipped shape:
>
> ```ts
> export type ReversedRepairsState = { applierId: string | undefined } | undefined;
> export function reversedRepairsOn(
>     statusEngine: StatusEngine,
>     victim: { id: string; side: 'player' | 'enemy' }
> ): ReversedRepairsState;
> ```
>
> `applierId: undefined` is a legitimate state (the scheduled channel has no caster), NOT an
> error and NOT a cue to fall back to the healer. **Every `hasReversedRepairs(...)` and every
> `.toBe(true)/.toBe(false)` in the code samples and test samples below is pre-retraction
> shorthand** — read them as `reversedRepairsOn(...)` returning a state / `undefined`.

> **AMENDED after the Task 3 review (2026-08-22).** The signature originally took a bare
> `victimId: string`. That is unsafe, and the review caught why: the scheduled always-active
> enemy-debuff store (`enemyAlwaysSnap`, `statusEngine.ts:927-929`) is a **single global list with
> no `enemyTargetId` filtering at all**. Verified empirically — with a hand-selected
> `Reversed Repairs`, the bare-id read returned `true` for *every* id probed, player-side included.
> A user ticking the box in the enemy-debuff picker would have reversed their OWN team's repairs.
>
> The scheduled arm must therefore be gated on `victim.side === 'enemy'`. The timed arm is already
> correctly per-victim and stays ungated — that is the channel the corpus applier uses, and it must
> keep working in both directions for team symmetry (an enemy Zosimos debuffing a player ship).
>
> This is why `exposedStatus.ts` reads only the timed channel. Opting into the scheduled one buys
> simulator support and inherits the global sentinel; the side gate is the price.

- [ ] **Step 1: Write the failing test**

Create `src/utils/combat/__tests__/reversedRepairs.read.test.ts`:

```ts
/**
 * `Reversed Repairs` status read (#362) — the SCHEDULED channel and the negative cases.
 *
 * Unlike Exposed (which deliberately reads only the timed channel, because "the next direct hit"
 * has no standing value to model), a 1-turn duration debuff DOES have a standing value — so a
 * hand-selected Reversed Repairs in the simulator must work.
 *
 * The TIMED channel is covered in `reversedRepairs.engine.test.ts` (Task 5) instead, through the
 * real production seam — a `debuff` ability on a firing slot. A unit test that hand-builds a
 * `RegisteredAbilityStatus` payload proves the mapping, not that the engine feeds it the right
 * input; and a wrong hand-built shape yields a vacuous red that turns green once you "fix"
 * production to match the mistake.
 */
import { describe, it, expect } from 'vitest';
import { createStatusEngine } from '../statusEngine';
import type { SelectedGameBuff } from '../../../types/calculator';
import { hasReversedRepairs, REVERSED_REPAIRS } from '../reversedRepairs';

/** The calculator buff-picker's exact output shape: no skillSource and no skillDuration, which
 *  the status engine classifies as ALWAYS-ACTIVE (the scheduled channel). Copied from
 *  `exposedStatus.integration.test.ts`'s `applier: 'scheduled'` arm. */
const scheduled = (buffName: string): SelectedGameBuff => ({
    id: buffName,
    buffName,
    stacks: 1,
    parsedEffects: {},
    isStackable: false,
});

describe('hasReversedRepairs', () => {
    it('is false on a clean actor', () => {
        const se = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        expect(hasReversedRepairs(se, 'victim-1')).toBe(false);
    });

    it('reads the scheduled channel (a hand-selected debuff in the simulator)', () => {
        const se = createStatusEngine({
            selfBuffs: [],
            enemyDebuffs: [scheduled(REVERSED_REPAIRS)],
        });
        expect(hasReversedRepairs(se, 'victim-1')).toBe(true);
    });

    it('does not confuse it with the other repair-named statuses', () => {
        const se = createStatusEngine({
            selfBuffs: [],
            enemyDebuffs: [scheduled('Inc. Repair Down II'), scheduled('Block Repair')],
        });
        expect(hasReversedRepairs(se, 'victim-1')).toBe(false);
    });
});
```

> `SelectedGameBuff` uses `buffName`, **not** `name` (`src/types/calculator.ts:163-169`). The `ActiveBuff` the snapshot returns uses `buffName` too (`statusEngine.ts:10`). Getting this wrong compiles under a cast and silently reads `undefined`.

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/utils/combat/__tests__/reversedRepairs.read.test.ts`
Expected: FAIL — cannot resolve `../reversedRepairs`.

- [ ] **Step 3: Create the module**

Create `src/utils/combat/reversedRepairs.ts`:

```ts
import type { StatusEngine } from './statusEngine';

/**
 * `Reversed Repairs` — "Incoming repairs damage this unit instead" (constants/buffs.ts).
 *
 * NAME-KEYED, like Exposed / Stealth / Barrier, rather than a `parsedEffects` entry. There is no
 * standing percentage to fold: the status does not scale a channel, it inverts one. Folding it
 * into `incomingHeal` is the trap the spec calls out — that fold is unclamped, so a negative
 * multiplier produces `consumed: 0` plus a NEGATIVE overheal: no damage, no healing, garbage
 * statistics, and green tests throughout.
 *
 * Applier in the corpus: Zosimos's charged skill ("inflicts Reversed Repairs for 1 turn").
 *
 * Read at the single heal-apply site (`engine.ts` `applyHealToTarget`), which is the ONLY line in
 * the combat engine where HP goes up — so every repair channel is covered by one branch.
 */
export const REVERSED_REPAIRS = 'Reversed Repairs';

/**
 * Whether this victim's incoming repairs are reversed.
 *
 * Boolean, not a magnitude: reversal is not a scaling factor and stacks mean nothing here.
 *
 * Reads BOTH enemy-side channels. This is a deliberate divergence from `exposedIncomingPct`,
 * which reads only the timed store because a one-shot "next direct hit" status has no standing
 * value and a hand-selected one is correctly inert. A 1-turn duration debuff does have a standing
 * value, so a Reversed Repairs selected by hand in the simulator must work.
 */
export function hasReversedRepairs(statusEngine: StatusEngine, victimId: string): boolean {
    const timed = statusEngine
        .timedAbilityStatuses('enemy', undefined, victimId)
        .some((s) => s.active.buffName === REVERSED_REPAIRS);
    if (timed) return true;
    return statusEngine
        .snapshot(undefined, victimId)
        .activeEnemyDebuffs.some((b) => b.buffName === REVERSED_REPAIRS);
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/utils/combat/__tests__/reversedRepairs.read.test.ts`
Expected: PASS, all three.

Team symmetry for this read is proven in Task 5, which runs both directions through the real engine. Do not add a side arm here — the scheduled store is keyed to a global sentinel, so a unit-level "both sides" test here would assert something the production routing does not actually exercise.

- [ ] **Step 5: Commit**

```bash
git add src/utils/combat/reversedRepairs.ts src/utils/combat/__tests__/reversedRepairs.read.test.ts
git commit -m "feat(engine): Reversed Repairs status read across both enemy-status channels (#362)"
```

---

### Task 4: Make the repair source id a required parameter

~~R7 credits a reversal kill to the healer, but~~ `applyHealToTarget(raw, victim?)` receives no source id. Every caller knows it (`creditId`, `actor.id`, `intent.ownerId`).

> **⚠️ THE PREMISE IS RETRACTED, THE TASK IS NOT.** Under **R7′** the kill goes to the debuff's
> APPLIER, so `repairSourceId` is never the killer. The parameter shipped anyway and is still
> **required** for a different reason: it is **R11's `healerId`**, the display-only name on the
> reversal's log row ("Zosimos → Nova: Medic's repair reversed 10,000"). A site that forgot it
> would print a reversal row naming nobody as the healer. Wherever the text below says the
> omission would misbook a *kill*, read *log row*.
>
> **The return type below is also pre-retraction.** Under **R10′** the shipped signature is
> `(raw, victim, repairSourceId) => HealApplyResult`, where `HealApplyResult` is
> `{ reversed: false; consumed: number; overheal: number } | { reversed: true }` — the reversed
> arm carries **no numbers at all**, deliberately, so every call site fails to compile until it
> moves its gross `directHeal`/`hotHeal` credit *below* the call.

**Files:**
- Modify: `src/utils/combat/playerTurn.ts:163-166` (the `HealingRuntimeCtx` declaration), and every call site:
  - `src/utils/combat/playerTurn.ts:4086`, `:4227`, `:4278`
  - `src/utils/combat/triggers.ts:4162`
  - `src/utils/combat/engine.ts:4297`, `:4305`, `:4488`, `:4555`, `:11332`
  - `src/utils/combat/engine.ts:3535` (the implementation)
- Modify: every `HealingRuntimeCtx` test double (`tsc` will enumerate them)
- Test: existing suite only (no behaviour change)

**Interfaces:**
- Produces: `applyHealToTarget(raw: number, victim: CombatActor, repairSourceId: string): HealApplyResult` — all three required. Consumed by Task 5. (~~`{ consumed: number; overheal: number }`~~ — superseded by R10′, see the note above.)

- [ ] **Step 1: Change the signature — all three parameters required**

In `playerTurn.ts`, replace the `applyHealToTarget` declaration:

```ts
/** Target-routed heal: consumed = min(raw, maxHp − currentHp); dead target → all overheal.
 *  Mutates the victim's currentHp. Returns the split.
 *
 *  ALL THREE PARAMETERS ARE REQUIRED, deliberately. `victim` lost its `= healTarget` default and
 *  `repairSourceId` is not optional, so `tsc` reports an arity error at every call site rather
 *  than letting a missed one compile. ⚠️ RETRACTED PREMISE: #362 credits a reversal kill to the
 *  REPAIR'S SOURCE (R7) — under R7′ it credits the DEBUFF'S APPLIER, and required-ness instead
 *  buys R11's `healerId`; a missed site would print a healer-less log row, not a mis-credited
 *  kill. The conclusion is unchanged: an optional id would let the omission compile silently —
 *  a hand-enumerated layer, the shape that produced two silent failures with green tests in
 *  #294/#296.
 *
 *  `repairSourceId` is the actor credited with the repair: the caster for a cast repair, the
 *  APPLIER for a HoT tick (not the holder), the leeching actor for a leech, `intent.ownerId` for
 *  a reactive. It is the same id the call site already passes to `healing.credit`. */
applyHealToTarget: (
    raw: number,
    victim: CombatActor,
    repairSourceId: string
) => { consumed: number; overheal: number }; // ⚠️ SHIPPED: `=> HealApplyResult` (R10′)
```

- [ ] **Step 2: Run `tsc` to enumerate every site**

Run: `npx tsc --noEmit`
Expected: FAIL, one arity error per call site — the 9 listed above plus every `HealingRuntimeCtx` test double.

Write the list down. That list is the task's completion criterion; do not proceed on a partial one.

> `tsc --noEmit` does **not** cover `scripts/` (tsconfig is `include: ["src"]`). Nothing in this task touches `scripts/`, but do not treat a clean `tsc` as proof about anything outside `src/`.

- [ ] **Step 3: Fix every site**

Sites that relied on the `victim = healTarget` default now pass `healTarget` explicitly. For `repairSourceId`, pass the id the site already credits:

- `playerTurn.ts:4086` (HoT tick) → `creditId` (the applier, or the holder for a scheduled HoT)
- `playerTurn.ts:4227`, `:4278` (cast repairs) → `actor.id`
- `triggers.ts:4162` (reactive) → `intent.ownerId`
- `engine.ts:4297`, `:4305`, `:4488`, `:4555` (leeches) → the leeching `sourceId` at each site
- `engine.ts:11332` → read the surrounding block and pass the crediting id it already uses

For test doubles, thread the third parameter through whatever the double records; several already capture an `appliedTo` array and should capture the source id alongside it.

- [ ] **Step 4: Verify clean**

Run: `npx tsc --noEmit && npm test`
Expected: PASS both, with test counts identical to Task 1 Step 5. This task changes no behaviour — the new parameter is not read yet.

- [ ] **Step 5: Commit**

```bash
git add -u
git commit -m "refactor(engine): applyHealToTarget takes a required repair source id (#362)"
```

---

### Task 5: The reversal

**Files:**
- Modify: `src/utils/combat/engine.ts:3535-3549` (the `applyHealToTarget` closure)
- Test: `src/utils/combat/__tests__/reversedRepairs.engine.test.ts` (create)

**Interfaces:**
- Consumes: ~~`hasReversedRepairs`~~ **`reversedRepairsOn`** (Task 3, see its amendment), `resolveLethalHp` (Task 1), the required `repairSourceId` (Task 4).

> **⚠️ THIS TASK SHIPPED IN A REVISED FORM. R7 and R10 were retracted while it was in flight,
> and everything below still names them.** The three concrete substitutions, in one place:
>
> | Written here | Shipped |
> |---|---|
> | `hasReversedRepairs(...)` returning a boolean | `reversedRepairsOn(...)` returning `{ applierId }` or `undefined` |
> | `killerId: repairSourceId` (the healer) | `killerId: reversal.applierId` (the applier, R7′) — plus `bookReversalDamage` crediting the applier's dealt axis and the victim's `perTargetDamage`/`perActorIncoming` intake |
> | `return { consumed: 0, overheal: raw }` (books the healer's overheal, R10) | `return { reversed: true }` (books the healer nothing, R10′) — and the `heal-performed` event carries `reversedAmount` / `perTarget[].reversed` so the battle report excludes it from healing done/received |
>
> Plus one addition with no counterpart here at all: **R11**, a `reversed-repair-log` row on
> every reversal that burned something (`raw > 0`), booked to the applier and carrying the
> healer as a display-only `healerId`.

> **Two things moved under this task after it was written — use these, not the older forms:**
>
> 1. `hasReversedRepairs(statusEngine, victim)` takes the **actor**, not `victim.id`. Its scheduled
>    arm is gated on `victim.side === 'enemy'` because the scheduled store is a single global list
>    with no per-victim keying (see the Task 3 amendment). The sample code below is already updated.
> 2. Task 4 left the implementation's third parameter named `_repairSourceId` to satisfy
>    `@typescript-eslint/no-unused-vars` while it was unread. **Rename it back to `repairSourceId`**
>    as part of this task — you are now reading it. The `HealingRuntimeCtx` declaration in
>    `playerTurn.ts` already says `repairSourceId`; only the implementation carries the underscore.

- [ ] **Step 1: Write the failing tests — one per ruling**

Create `src/utils/combat/__tests__/reversedRepairs.engine.test.ts`. Drive the **real engine**, not an executor double: a test-double `HealingRuntimeCtx` contains no reversal branch, so a double-based test proves nothing about production.

**Copy the harness wholesale from `src/utils/combat/__tests__/exposedStatus.integration.test.ts`** — it is the closest existing fixture: `runCombat` over hand-built `Ability` objects, planting a name-keyed enemy status through the real production seam, and it already runs both directions. Its `castStatus(buffName)` helper (`:59-77`) is exactly the applier shape Zosimos's charged skill produces; change `duration: 5` to `1` only if a test needs expiry.

Here is the scaffold every test in this file builds on. Fill the `stats`/`CombatEngineInput` block by copying `exposedStatus.integration.test.ts:99-185` verbatim and changing only what each ruling needs:

```ts
/** Plants Reversed Repairs on the enemy via the focus actor's cast, then has an ALLY repair that
 *  enemy. Returns the victim's HP before and after so every ruling reads off one delta.
 *
 *  `repairPct` is of the healer's max HP (basis 'hp'), so the expected magnitude is arithmetic,
 *  not a golden. `withStatus: false` is the CONTROL arm — same fixture, no debuff — and every
 *  assertion below compares the two. A single-arm test cannot tell "reversed" from "healed
 *  nothing".  */
function runRepairOnVictim(opts: {
    withStatus: boolean;
    repairPct: number;
    victimSide: 'player' | 'enemy';
    victimStartHp?: number;
    victimMaxHp?: number;
    victimDefence?: number;
    victimShield?: number;
    extraEnemyDebuffs?: string[];   // e.g. ['Inc. Repair Down II'] for R6
}): { hpBefore: number; hpAfter: number; events: CombatEvent[]; healing: /* the run's healing map */ unknown } {
    // ...built from exposedStatus.integration.test.ts:99-185...
}
```

Cover R1, R3, R4, R6, R7, R8, R10. Each gets a **player-side victim arm and an enemy-side victim arm** — flip `victimSide` and assert the identical delta. Team symmetry is mandatory (`feedback_engine_team_symmetry`), and this is where it is actually proven.

**Every assertion must be able to report the opposite.** Specifically:

- **R1 (shield untouched):** assert `victim.shieldPool > 0` *before* the repair. Without that existence check, "shield unchanged" is vacuously true on a victim that never had one.
- **R1 (no defence mitigation):** give the victim non-zero `defence`, and assert the HP drop equals the repair amount *exactly*. On a zero-defence victim, mitigated and unmitigated are the same number.
- **R1 (no Protection redirect):** the fixture needs a living protector with stacks. Assert the protector's HP is unchanged **and** that an ordinary attack of the same size against the same fixture *does* move the protector's HP. Prove the instrument fires.
- **R3 (full HP):** set `currentHp === effectiveMaxHp` and assert the full amount lands.
- **R4 (crit carries):** pin the crit with `setupKeyedTestRng(seed)` **alone** — never followed by `resetRateGateRng()`, which un-seeds it. Assert the burn equals the post-crit value, and that the same fixture without the seed-forced crit burns the smaller base value.
- **R6 (`Inc. Repair Down II` first):** the victim carries both statuses; assert the burn is the halved amount. Vacuous unless a control run without the Repair Down burns the full amount — assert both.
- ~~**R7 (kill credit):** assert `ship-destroyed` carries `killerId === <the healer's id>`, explicitly **not** the Zosimos that applied the debuff.~~ **⚠️ RETRACTED — THIS IS BACKWARDS. DO NOT IMPLEMENT IT.** Under **R7′** the assertion is `killerId === <the Zosimos's id>`, explicitly **not** the healer, and the burn's damage books on the applier's damage-dealt axis with nothing on the healer's. (Still true, and still the reason the fixture is built the way it is: use different ids for the healer and the applier so the assertion can distinguish them. An applier-less reversal — the scheduled channel — carries `killerId: undefined` and credits nobody; it never falls back to the healer.)
- **R8 (Cheat Death):** assert `raw > victim.currentHp` before the call (otherwise the victim survives anyway and the test is vacuous), then assert `currentHp === 1`, a `cheat-death-activated` event fired, and the save is spent.
- ~~**R10 (overhealing):** assert the healer's `overheal` bucket gained exactly `raw`, its `effectiveHeal` gained 0, and its damage-dealt total gained 0.~~ **RETRACTED.** Under **R10′** assert that **all three** of the healer's buckets gained `0` — `directHeal` (repairs cast) included, since asserting only `overheal === 0` passes against a build that still credits the whole repair as gross. And assert the **second** channel too: `heal-performed` feeds the battle report's healing done/received independently of these buckets, so the event must carry `reversedAmount === raw` and a `reversed: true` per-target entry, and the report must show `healingDone`/`healingReceived` of 0. A healer standing on the ENEMY side books nothing in the `ActorHealing` map by design (E5 §4.1), so on that side the buckets cannot serve as the instrument at all — use the event.

- [ ] **Step 2: Run them to confirm they fail**

Run: `npx vitest run src/utils/combat/__tests__/reversedRepairs.engine.test.ts`
Expected: FAIL — every repair still heals.

Read each failure message. A test failing for the wrong reason (fixture error, missing status) is not a red test. Fix the fixture until each one fails *because the repair healed instead of burning*.

- [ ] **Step 3: Implement the reversal**

> ### ⚠️ THE SAMPLE BELOW IS PRE-RETRACTION CODE. DO NOT COPY IT.
>
> It was written against R7 and R10 and therefore (a) credits the kill to `repairSourceId` — the
> healer — and (b) returns `{ consumed: 0, overheal: raw }`, booking the burn as the healer's
> overhealing. **Both are now wrong.** It is kept because the *positional* reasoning around it
> (why `raw` needs no recomputation, why the damage funnel is not entered, why `currentRound`
> rather than `r`) is still exactly right and is the hard part.
>
> What actually shipped, and what a reader should copy instead, is the reversal branch in
> `src/utils/combat/engine.ts`. Its differences from this sample:
> - the read is `reversedRepairsOn(statusEngine, victim)` returning `{ applierId }`, not a boolean;
> - `killerId: reversal.applierId` — **the applier, never the healer** (R7′), and `undefined` on
>   the scheduled channel rather than a fallback;
> - the burn books on the applier's dealt axis **and** the victim's intake axis
>   (`bookReversalDamage` → `roundPerTargetDamage`, `intakeFor().incoming`, `creditDealt`);
> - it emits a `reversed-repair-log` row when `raw > 0` (R11);
> - it returns **`{ reversed: true }`** carrying no numbers (R10′), which is what forces every
>   call site to move its gross credit below the call.

In `engine.ts`, replace the `applyHealToTarget` closure body:

```ts
// ⚠️ PRE-RETRACTION SAMPLE — see the warning above. Not the shipped code.
applyHealToTarget: (raw, victim, repairSourceId) => {
    // Dead target → all overheal, and no reversal: a corpse takes no reversed repair.
    if (victim.currentHp <= 0) {
        return { consumed: 0, overheal: raw };
    }
    // #362 Reversed Repairs. `raw` arriving here is already post-crit (R4), post-healModifier,
    // post-outgoingHealBuff, post-incomingHealPct — which is where Inc. Repair Down lives, so R6
    // ("the -50% applies first") is satisfied by position alone — and PRE-deficit-clamp, which is
    // R3 ("a target at full HP takes the full amount"). Every magnitude ruling lands on this one
    // number; do not recompute any of it here.
    // ⚠️ SHIPPED: `const reversal = reversedRepairsOn(statusEngine, victim); if (reversal) {`
    if (hasReversedRepairs(statusEngine, victim)) {
        // R1: raw HP burn. No shield drain, no Protection redirect, no defence mitigation, no
        // Barrier — the damage funnel owns all four and is deliberately NOT entered. R5 follows
        // from the same choice: no counterattack, no thorns, no incoming-leech proc, no
        // on-damaged passives, because none of those live on this path.
        victim.currentHp = Math.max(0, victim.currentHp - raw);
        // ⚠️ RETRACTED (R7). SHIPPED (R7′): the damage AND the kill belong to the actor that
        // APPLIED the debuff, never to the healer — `killerId: reversal.applierId` below.
        // `byDirectDamage: false` is right and stayed — a reversed repair is not a hit, so the
        // consumables that spend on a direct hit (Barrier charges, Ironclad's nth-hit counter)
        // must not see one. R8: Cheat Death still intercepts, via the one shared death path.
        resolveLethalHp(victim, {
            // `currentRound`, NOT `r`: `r` is block-scoped to the round `for` loop and
            // `healingCtx` is built above it, so `round: r` throws ReferenceError. `currentRound`
            // is the engine-scope mirror that exists for exactly this, and the three emitters
            // just above `healingCtx` already use it.
            round: currentRound,
            statusEngine,
            cheatDeathConsumed,
            cheatDeathConsumedRound,
            bus,
            emitConsequenceLog,
            actingActorId,
            killerId: repairSourceId, // ⚠️ RETRACTED — R7′ passes `reversal.applierId`
            byDirectDamage: false,
        });
        // NOT repairedThisRound — nothing was repaired. (Separate from R9: Zosimos's charge
        // passive keys off the enemy CASTING a repair, upstream of this closure, and is untouched.)
        //
        // ⚠️ RETRACTED (R10). SHIPPED (R10′): the healer books NOTHING — not repairs cast, not
        // effective healing, not overhealing. Returning the shape below would be WORSE than
        // useless: it books the raw as overheal AND leaves the call sites' gross credit (written
        // ABOVE the call) standing. The shipped branch returns `{ reversed: true }` with no
        // numbers at all, precisely so every call site fails to compile until it moves its gross
        // credit below the call.
        return { consumed: 0, overheal: raw };
    }
    const targetMaxHp = recipientMaxHp(victim.id);
    // Clamp the deficit at 0: a max-HP buff expiring can shrink effectiveMaxHp below currentHp,
    // making (targetMaxHp - currentHp) negative — without the Math.max a heal would REDUCE HP.
    const consumed = Math.max(0, Math.min(raw, targetMaxHp - victim.currentHp));
    victim.currentHp += consumed;
    if (consumed > 0) repairedThisRound.add(victim.id);
    return { consumed, overheal: raw - consumed };
},
```

> `r`, `actingActorId` (`:4601`) and `emitConsequenceLog` are engine-scope `let`s declared **after** `healingCtx` (`:3514`). That is safe here because they are read at *call* time, long after those declarations execute. It would **not** be safe to copy their values into the ctx literal at construction time. Route through the bindings.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/utils/combat/__tests__/reversedRepairs.engine.test.ts`
Expected: PASS, every ruling, both side arms.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS. Fingerprint movement on Zosimos is expected; **do not re-baseline** (Task 7). Movement on any *other* ship is a bug — the reversal must be inert for every actor not carrying the status. Investigate before continuing.

- [ ] **Step 6: Commit**

```bash
git add src/utils/combat/engine.ts src/utils/combat/__tests__/reversedRepairs.engine.test.ts
git commit -m "feat(engine): Reversed Repairs turns incoming repairs into raw HP damage (#362)"
```

---

### Task 6: Channel coverage and inertness

Task 5 proves the magnitude rulings through one channel. R2 says **every** repair channel reverses and shields do not; R5 says nothing reacts. Both are claims about coverage, and coverage needs its own tests.

**Files:**
- Test: `src/utils/combat/__tests__/reversedRepairs.channels.test.ts` (create)

- [ ] **Step 1: Write the R2 channel tests**

One test per channel, each asserting the victim's HP went **down** by the repair amount:

1. **Cast repair** — an ally casts a direct repair on the victim.
2. **HoT tick** — a `Repair Over Time` status ticks on the victim at its turn start.
3. **Leech self-repair** — the victim attacks and its own leech would restore HP.
4. **Reactive repair** — a repair fired from a passive slot via `executeIntent`.
5. **Shield grant — the negative case.** An ally grants the victim a shield. Assert `shieldPool` **increased** and `currentHp` is unchanged. Shields are not repairs (R2).

Each of the four positive cases is vacuous unless the same fixture without the debuff *heals*. Assert the control run's HP goes **up** by the same amount. A channel that silently restores nothing in the fixture would pass the "HP did not go up" half of a one-armed test while proving nothing.

> The HoT arm has a specific trap: `applyHealToTarget`'s `repairSourceId` for a HoT is the **applier**, not the holder. If the fixture's applier and holder are the same actor, an attribution bug is invisible. Use distinct actors.

- [ ] **Step 2: Write the R5 inertness tests**

For each of: counterattack, Reflect thorns, incoming-leech proc, and an on-damaged passive — assert it does **not** fire on a reversed repair, and, in the same fixture, that it **does** fire against an ordinary attack of the same magnitude.

The second half is the whole test. "Did not fire" alone is what a broken fixture also reports.

- [ ] **Step 3: Write the R9 fence**

Assert Zosimos gains its charge when an enemy performs a repair that is then reversed. The passive watches the cast, not the landing — this fences the reversal against accidentally suppressing it.

- [ ] **Step 4: Write the DPS-mode inertness fence**

The spec's third derived consequence: with no HP model there is no `healingCtx`, so the calculator ignores the debuff entirely. Run the same fixture with `mode` set to the DPS path and a scheduled `Reversed Repairs` in `enemyDebuffs`, and assert the damage result is **identical** to the same run without it.

This one matters more than it looks. A scheduled always-active status applies to every enemy at once, so a leak here would silently change every DPS number for any user who ticks the box in the buff picker.

- [ ] **Step 5: Run them**

Run: `npx vitest run src/utils/combat/__tests__/reversedRepairs.channels.test.ts`
Expected: PASS.

If a channel fails, the fix belongs in Task 5's closure — not in a special case here. All channels reach the same line; a channel that misses it is a routing bug worth understanding before patching.

- [ ] **Step 6: Run the full suite and commit**

Run: `npm test`
Expected: PASS.

```bash
git add src/utils/combat/__tests__/reversedRepairs.channels.test.ts
git commit -m "test(engine): Reversed Repairs channel coverage and reaction inertness (#362)"
```

---

### Task 7: Corpus scan, re-baseline, changelog

**Files:**
- Modify: `src/constants/changelog.ts` (`UNRELEASED_CHANGES`)
- Modify: the `realKitFingerprints` snapshot for Zosimos
- Test: `src/utils/combat/__tests__/reversedRepairs.corpus.test.ts` (create)

- [ ] **Step 1: Scan the corpus**

Write a test that reads `docs/ship-data.json` (the harness source — the `SHIPS` constant is gone) and reports every ship whose skill text mentions `Reversed Repairs`.

Assert the exact count. If Zosimos is the only one, assert exactly that — a tripwire that fires when a future ship-data refresh adds another applier. A ship-data refresh is a defect-surfacing event; this is the alarm.

Report the number in the commit message **including if it is zero besides Zosimos**. The issue's definition of done asks for the number explicitly.

- [ ] **Step 2: Re-baseline Zosimos's fingerprint**

Only now, with the behaviour correct.

Run: `npx vitest run -u src/utils/combat/__tests__/realKitFingerprints.test.ts`

> This is the **only** `-u` in the entire plan. Scope it to the one file. Never run a bare `vitest -u` — it rewrites every snapshot in the repo, and `vitest run` auto-writes new snapshots even without the flag.

- [ ] **Step 3: Read the snapshot diff before accepting it**

`git diff` the snapshot. Confirm every changed token is explained by the new debuff and the reversal. Read the alarm's **vocabulary**: passing a vacuity alarm is not the same as being correct if the alarm has no token for the thing you changed.

If a token moved on a ship that is not Zosimos, stop.

- [ ] **Step 4: Add the changelog entry**

In `src/constants/changelog.ts`, append to `UNRELEASED_CHANGES` — plain English, describing what a player sees. No emojis.

```ts
"Combat simulator: Zosimos's charged skill now applies Reversed Repairs. While a ship carries it, every repair that lands on it damages it instead — for the repair's full value, ignoring shields, Protection and defence, and even at full health. A reversed repair can destroy the ship. The damage and any kill are credited to the ship that applied the debuff, not to the one whose repair triggered it, and the repair itself is not counted as healing or overhealing for its caster. The combat log shows a row for each reversal. Cheat Death still saves the target. Previously the status did nothing at all.",
```

> **REWRITTEN 2026-08-23.** The original draft said the kill was "credited to whoever cast the
> repair" and implied the repair surfaced as overhealing. Both were true of the retracted R7/R10
> and are false under R7′/R10′ — see the ruling table at the top. A changelog entry describing
> behaviour the build does not have is worse than none.

- [ ] **Step 5: Full verification**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: PASS all three.

- [ ] **Step 6: Commit**

```bash
git add -u src/constants/changelog.ts src/utils/combat/__tests__/
git commit -m "feat(engine): Reversed Repairs — corpus scan, Zosimos re-baseline, changelog (#362)"
```

---

## Definition of done (from the issue)

- [x] No heal ability is built from a `<unit-skill>` status name containing "repair" — shipped in `fe0b4644`, fenced by Task 2 Step 1's second test
- [x] A corpus-wide scan reporting the number of affected ships, including zero — Task 7 Step 1
- [x] `Reversed Repairs` parses into a debuff — Task 2
- [x] The passive's charge clause removes 1 charge on `on-enemy-repaired` — shipped in `fe0b4644`, fenced by Task 6 Step 3
- [x] `realKitFingerprints > Zosimos` re-baselined only AFTER the above — Task 7 Step 2

## Out of scope

- Reversing shield grants (R2: shields are not repairs)
- Any behaviour change to the damage funnel for ordinary attacks — Task 1 is behaviour-preserving and the goldens are the check
- `Block Repair` and `Block Shield`, the other two still-inert name-only statuses
