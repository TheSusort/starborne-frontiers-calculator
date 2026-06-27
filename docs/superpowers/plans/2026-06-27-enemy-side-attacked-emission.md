# Enemy-side `attacked` Emission Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make enemy ships react when the player hits them — add the symmetric **player→enemy `attacked` emit** on the positional two-team-sim path, lighting up all enemy `on-attacked` reactives (counters + Second Wind, Tenacity, Reactive Ward, …), and make the `shieldWasHit` signal work on the **positional** path in **both** directions (so player Nyxen and enemy Nyxen both fire in the positioned sim).

**Architecture:** Extract the per-hit `attacked` emit (currently inline in the enemy-turn body, `engine.ts:5093-5109`) into a shared, direction-agnostic `emitAttacked` helper. Capture each direction's **focus victim** outcome from the existing `drivePositionalApply` `onVictimResolved` callback (matched by `victim.id === tgt.id`, first-hit-focus semantics — `onVictimResolved` does not expose role), and feed `shieldWasHit` from it. Call `emitAttacked` from the enemy-turn branch (unchanged behavior) AND from the two player-attack positional branches (the new behavior). Routing is already team-agnostic (`registerReactiveListeners` per side; locked by `enemyReactiveRouting.test.ts`), so the single new emit wakes every enemy `on-attacked` reactive with no executor changes.

**Tech Stack:** React 18, TypeScript, Vitest. Combat engine in `src/utils/combat/`.

**Spec:** `docs/superpowers/specs/2026-06-27-enemy-side-attacked-emission-design.md`

**Branch:** `feat/combat-enemy-side-attacked-emission` (already created, stacked on the G PR2 branch `feat/combat-g-counterattack-pr2`, off the post-#163 main; the spec is committed here). **It must stack on PR2** — the enemy-side counter integration tests need PR2's parsed Stalwart/Nyxen/Centurion counter abilities. When PR2 (#164) merges, rebase this branch onto `main` (`git rebase --onto origin/main <pr2-tip> feat/combat-enemy-side-attacked-emission`) and retarget the PR base to `main`.

---

## Critical context (verified 2026-06-27)

- **Two-team sim uses the positional path by default.** `simulateBattle` (`battleSimulator.ts:594`) → `runCombat` threads `position`+`target`+`pattern` for every actor, so player→enemy attacks run through the positional branch (`engine.ts:4386-4390` gate). Enemies are real `CombatActor`s in `enemyAttackerActors` (`engine.ts:1737`), registered as reactive owners via `registerReactiveListeners({ perOwner: enemyReactivePerOwner, … })` (`engine.ts:2196`).
- **The sole `attacked` emit today** is the enemy→player one at `engine.ts:5093-5109` (per-hit over `hitOutcomes = enemyHitCrits.length ? enemyHitCrits : [enemyTurnDidCrit]`; sets `targetId: tgt.id`, `attackerId: actor.id`, `isPrimaryTarget: true`, conditional `shieldWasHit`/`didCrit`/`damage`).
- **`shieldWasHit` (5091-5092)** = `!barriered && shieldBefore > 0 && hpDamage < damage`, where `barriered/shieldBefore/hpDamage` are bound ONLY on the non-positional `else` branch (`engine.ts:~4989`). On the enemy POSITIONAL branch they stay `0` → `shieldWasHit` always false there today (comment 5089-5090). **This is why player Nyxen is inert in the positioned sim — Step 3 fixes it.**
- **`onVictimResolved` signature:** `onVictimResolved?.(victim, dmg, outcome, didCrit)` (`positionalApply.ts:189`); `outcome` is `VictimDamageOutcome { shieldBefore, hpDamage, barriered }` (`positionalApply.ts:30-34`). It does NOT expose the victim's role.
- **`drivePositionalApply` sites:**
  - Player FOCUS: call `engine.ts:4395`, `onVictimResolved` `engine.ts:4409` (`(_victim, damage) => procStandingLeechesPerVictim(actor.id, damage)`); `tgt` from `selectTurnTarget(actor)` at `engine.ts:4323`; turn = `turn` (has `.hitCrits` 4397, `.roundCrit`).
  - Player TEAM: call `engine.ts:4552`, `onVictimResolved` `engine.ts:4565`; `tgt` at `engine.ts:4507`; turn = `teamTurn` (`.hitCrits` 4554, `.roundCrit`).
  - Enemy: call `engine.ts:~4970`, `onVictimResolved` `engine.ts:4985` (`(victim, dmg, outcome) => procTakenLeechesPerVictim(victim, dmg, outcome)`); enemy `tgt` from `selectTurnTarget(actor)` at `engine.ts:4727`.
- **`tgt` is the real positional enemy/player focus victim** on the positional path (`selectTurnTarget` resolves the parsed target to a living opposing actor, `engine.ts:3562-3593`); on the non-positional path it's the dummy sink. So `victim.id === tgt.id` correctly identifies the focus victim on the positional path.
- **Per-side bindings:** `playerTurnBindings` (`engine.ts:3528`, `applyToVictim = applyOutgoingToEnemy`), `enemyTurnBindings` (`engine.ts:3538`, `applyToVictim = applyIncomingToTarget`); `turnBindings(side)` 3556. `VictimDamageOutcome` type is already imported in engine.ts (used at 3395/3526).
- **`runPlayerTurn` returns `hitCrits` + `roundCrit`** (`playerTurn.ts:2071`).
- **Counter-back works already:** `applyCounterAttack` picks `sink = attacker.side === 'player' ? playerSink : enemySink` (`engine.ts:~3294`) and applies via the no-event path → an enemy counter hits the player attacker, emits no `attacked` (no ping-pong).
- **`CombatEventBus` type:** `src/utils/combat/events.ts:221`.
- **Test harnesses:** positional two-team battles are set up in `src/utils/combat/__tests__/twoTeamBattle.test.ts` and `src/utils/combat/__tests__/positionalDamage.integration.test.ts` (player fires positionally at real enemy actors with `position`+`target`+`pattern`+a damage skill). The G `counterAttack.integration.test.ts` `counterBase` healing harness drives enemy→player only — DO NOT use it for enemy-side counters.

---

## File structure

- **Create** `src/utils/combat/emitAttacked.ts` — the shared per-hit emit helper (one responsibility; keeps the giant `engine.ts` from growing another inline block).
- **Modify** `src/utils/combat/engine.ts` — call `emitAttacked` from the enemy-turn branch (refactor); capture focus outcome on the enemy positional branch and source `shieldWasHit` from it (Step 3); capture focus outcome on the two player positional branches and call `emitAttacked` (the new player→enemy emit).
- **Tests:**
  - `src/utils/combat/__tests__/emitAttacked.test.ts` (new) — unit test the helper.
  - `src/utils/combat/__tests__/enemySideAttacked.integration.test.ts` (new) — positional two-team integration: enemy Stalwart/Nyxen/Centurion counter the player attacker; player Nyxen counters a positional enemy attacker (Step 3); enemy Second Wind heals when hit.
- **Modify** `src/constants/changelog.ts`, `src/pages/DocumentationPage.tsx` — final task.

**Invariant for Tasks 1–2:** production stays **byte-identical** (no `.snap` golden moves). After every task run `npx tsc --noEmit` AND `npm run lint` (max-warnings 0). **Never `vitest -u`.** Task 3 is the deliberate behavior change (audited goldens).

---

## Task 0: Branch + baseline

- [ ] **Step 1: Confirm branch + clean baseline**

```bash
cd /Users/kennethsusort/PersonalProjects/starborne-frontiers-calculator
git branch --show-current   # expect feat/combat-enemy-side-attacked-emission
git status --short          # expect clean
npx vitest run src/utils/combat/__tests__/counterAttack src/utils/combat/__tests__/twoTeamBattle 2>&1 | tail -6
```
Expected: branch correct, clean tree, those suites pass (sanity: PR2 counters + the positional two-team harness are healthy on this branch).

- [ ] **Step 2: Enumerate the expected golden churn up front (discovery)**

Before changing behavior, find which test fixtures build an **enemy** team that (a) contains a ship with an `on-attacked`/`on-ally-attacked` reactive AND (b) runs **positionally** (threads enemy `position`+`target`+`pattern`). These are the only goldens Task 3 can move. Approaches:
```bash
# Tests that drive a positional two-team battle (enemy positions threaded):
grep -rln "position" src/utils/combat/__tests__ | xargs grep -ln "enemyAttacker\|enemyTeam\|simulateBattle\|twoTeam" 2>/dev/null
# Of those, which build enemies with on-attacked reactive ships (counters/Second Wind/Tenacity/Reactive Ward/etc.)?
# Inspect each candidate's enemy roster + look for ships whose passives parse on-attacked reactions.
```
Record the candidate fixture list (it may be empty — most combat goldens are DPS/single-target or player-only-reactive). This is the baseline expectation Task 3 Step 6 audits against: a move OUTSIDE this set is a red flag. If the set is empty, Task 3 should be byte-identical too (and any movement is suspect).

---

## Task 1: Extract `emitAttacked` helper (byte-identical refactor)

**Files:**
- Create: `src/utils/combat/emitAttacked.ts`
- Modify: `src/utils/combat/engine.ts:5085-5109` (replace the inline loop with a helper call)
- Test: `src/utils/combat/__tests__/emitAttacked.test.ts`

- [ ] **Step 1: Write the helper unit test**

`src/utils/combat/__tests__/emitAttacked.test.ts`: a fake `bus` that records emitted events; assert `emitAttacked` emits one event per `hitOutcomes` entry with the right fields, `didCrit` only when the entry is true, `shieldWasHit`/`damage` only when truthy/positive, `isPrimaryTarget` always present when passed true. Example:
```ts
import { describe, it, expect } from 'vitest';
import { emitAttacked } from '../emitAttacked';
import type { CombatEvent } from '../events';

const fakeBus = () => {
    const events: CombatEvent[] = [];
    return { events, bus: { on() {}, emit: (e: CombatEvent) => void events.push(e) } };
};

describe('emitAttacked', () => {
    it('emits one attacked event per hit outcome with correct flags', () => {
        const { events, bus } = fakeBus();
        emitAttacked({ bus, round: 2, targetId: 't1', attackerId: 'a1',
            hitOutcomes: [true, false], isPrimaryTarget: true, shieldWasHit: true, damage: 500 });
        expect(events).toHaveLength(2);
        expect(events[0]).toEqual({ type: 'attacked', targetId: 't1', attackerId: 'a1', round: 2,
            isPrimaryTarget: true, shieldWasHit: true, didCrit: true, damage: 500 });
        expect(events[1]).toEqual({ type: 'attacked', targetId: 't1', attackerId: 'a1', round: 2,
            isPrimaryTarget: true, shieldWasHit: true, damage: 500 }); // no didCrit
    });

    it('omits shieldWasHit/damage when falsy and isPrimaryTarget when false', () => {
        const { events, bus } = fakeBus();
        emitAttacked({ bus, round: 1, targetId: 't', attackerId: 'a',
            hitOutcomes: [false], isPrimaryTarget: false, shieldWasHit: false, damage: 0 });
        expect(events[0]).toEqual({ type: 'attacked', targetId: 't', attackerId: 'a', round: 1 });
    });
});
```

- [ ] **Step 2: Run it (fails — module missing)**

Run: `npx vitest run src/utils/combat/__tests__/emitAttacked.test.ts`
Expected: FAIL (cannot find `../emitAttacked`).

- [ ] **Step 3: Implement the helper**

`src/utils/combat/emitAttacked.ts`:
```ts
import type { CombatEventBus } from './events';

/**
 * Emits one `attacked` event per hit (Combat: symmetric reactive emission). Direction-agnostic —
 * the caller supplies the victim/attacker ids, the per-hit crit list, and the pre-decided
 * focus-victim signals. Conditional spreads keep the emitted shape minimal (and identical to the
 * historical inline enemy-turn emit it replaces). DoT/bomb/detonation hits never call this — only
 * direct weapon hits emit `attacked`.
 */
export function emitAttacked(args: {
    bus: CombatEventBus;
    round: number;
    targetId: string;
    attackerId: string;
    /** one entry per hit; `true` = that hit critted. */
    hitOutcomes: boolean[];
    isPrimaryTarget: boolean;
    shieldWasHit: boolean;
    /** per-attack aggregate dealt to the focus victim (Tenacity's >25%-maxHP gate reads this). */
    damage: number;
}): void {
    const { bus, round, targetId, attackerId, hitOutcomes, isPrimaryTarget, shieldWasHit, damage } =
        args;
    for (const hitCrit of hitOutcomes) {
        bus.emit({
            type: 'attacked',
            targetId,
            attackerId,
            round,
            ...(isPrimaryTarget ? { isPrimaryTarget: true } : {}),
            ...(shieldWasHit ? { shieldWasHit: true } : {}),
            ...(hitCrit ? { didCrit: true } : {}),
            ...(damage > 0 ? { damage } : {}),
        });
    }
}
```

- [ ] **Step 4: Run helper test (passes)**

Run: `npx vitest run src/utils/combat/__tests__/emitAttacked.test.ts`
Expected: PASS.

- [ ] **Step 5: Call the helper from the enemy-turn branch**

In `engine.ts`, replace the inline loop at `5085-5109` (keep computing `hitOutcomes` and `shieldWasHit` exactly as now) with a single call:
```ts
                            const hitOutcomes =
                                enemyHitCrits.length > 0 ? enemyHitCrits : [enemyTurnDidCrit];
                            const shieldWasHit =
                                !barriered && shieldBefore > 0 && hpDamage < damage;
                            emitAttacked({
                                bus,
                                round: r,
                                targetId: tgt.id,
                                attackerId: actor.id,
                                hitOutcomes,
                                isPrimaryTarget: true,
                                shieldWasHit,
                                damage,
                            });
```
Add `import { emitAttacked } from './emitAttacked';` at the top of engine.ts. (Leave the explanatory comments above `hitOutcomes`/`shieldWasHit` intact.)

- [ ] **Step 6: Verify byte-identical**

Run: `npx tsc --noEmit && npm run lint && npx vitest run 2>&1 | tail -8`
Then: `git status --short` — expect NO `.snap` files changed.
Expected: tsc/lint clean, full suite green, ZERO `.snap` movement.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "refactor(combat): extract emitAttacked helper (byte-identical)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Enemy→player positional `shieldWasHit` (Step 3 — player Nyxen in the positioned sim)

Source `shieldWasHit` from the enemy positional branch's per-victim outcome so player Nyxen counters a positional enemy attacker. Byte-identical for existing goldens (no fixture equips Nyxen); adds one NEW behavior test.

**Files:**
- Modify: `engine.ts` enemy positional branch (`onVictimResolved` ~4985) + the `shieldWasHit` source (~5091)
- Test: `src/utils/combat/__tests__/enemySideAttacked.integration.test.ts` (new — player-Nyxen case)

- [ ] **Step 1: Write the failing integration test (player Nyxen, positional enemy attack)**

In a new `enemySideAttacked.integration.test.ts`, mirror the `twoTeamBattle` / `positionalDamage.integration.test.ts` setup: a positional two-team battle where an **enemy** attacker (with a damage skill, position, target, pattern) hits a **player Nyxen** that has a live shield. Build Nyxen via the real registry (its active grants itself a shield; ensure the shield exists when the enemy hits). Assert the enemy attacker takes counter damage (Nyxen's shield-hit counter fired) — which is impossible today because positional `shieldWasHit` is false. Read the two harness files first to copy the exact battle-construction pattern (positions, target ids, pattern, `simulateBattle`/`runCombat` entry, how to read an actor's HP / per-target damage).

Run it → FAIL (no counter; enemy attacker undamaged by a counter).

- [ ] **Step 2: Capture the focus player victim's shield outcome on the enemy positional branch**

In `engine.ts`, declare the capture vars in the **same scope as the existing** `let shieldBefore = 0; let hpDamage = 0; let barriered = false;` declarations (the enemy-turn body, **before** the `if (enemyPositional) { … } else { … }` split — NOT inside the `if (enemyPositional)` block, or they'll be out of scope at the emit ~5091):
```ts
                            // Symmetric shieldWasHit: capture the FOCUS player victim's shield
                            // outcome on the positional path (the non-positional `else` branch binds
                            // shieldBefore/hpDamage/barriered directly; positional leaves them 0).
                            // First-hit-focus victim matched by victim.id === tgt.id; OR'd across the
                            // attack's hits so an early shield-denting hit still counts.
                            let positionalShieldWasHit = false;
                            let positionalShieldCaptured = false;
```
Extend the existing enemy positional `onVictimResolved` (4985) to also capture (keep the leech call). `onVictimResolved` fires **once per hit** for the focus victim, so OR the shield flag across hits:
```ts
                                    onVictimResolved: (victim, dmg, outcome) => {
                                        procTakenLeechesPerVictim(victim, dmg, outcome);
                                        if (victim.id === tgt.id) {
                                            positionalShieldCaptured = true;
                                            positionalShieldWasHit ||=
                                                !outcome.barriered &&
                                                outcome.shieldBefore > 0 &&
                                                outcome.hpDamage < dmg;
                                        }
                                    },
```
(Confirm `tgt` and `procTakenLeechesPerVictim` are in scope at this site — they are, per the landmarks. Match the exact existing indentation. If `||=` trips the linter, use `positionalShieldWasHit = positionalShieldWasHit || (…)`.)

- [ ] **Step 3: Source `shieldWasHit` from the capture when positional**

At the emit site (~5091), change the `shieldWasHit` computation to prefer the positional capture:
```ts
                            const shieldWasHit = positionalShieldCaptured
                                ? positionalShieldWasHit
                                : !barriered && shieldBefore > 0 && hpDamage < damage;
```
Update the comment to note the positional source. (The two `let`s declared in Step 2 alongside `shieldBefore`/`hpDamage`/`barriered` are guaranteed in scope here — both the `if (enemyPositional)` capture and this emit live in the same enemy-turn body.)

- [ ] **Step 4: Run the player-Nyxen test (passes)**

Run: `npx vitest run src/utils/combat/__tests__/enemySideAttacked.integration.test.ts -v`
Expected: PASS (player Nyxen now counters the positional enemy attacker).

- [ ] **Step 5: Verify byte-identical for existing goldens**

Run: `npx tsc --noEmit && npm run lint && npx vitest run 2>&1 | tail -8`
Then `git status --short` — expect NO `.snap` movement (no existing fixture equips a player Nyxen; positional `shieldWasHit` only gates `requireShieldHit`).
Expected: clean, green, ZERO `.snap` movement.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(combat): positional shieldWasHit on enemy->player path (player Nyxen in positioned sim)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Player→enemy `attacked` emit (the behavior change)

Emit `attacked` for the focus enemy victim on the two player positional branches → enemy `on-attacked` reactives (counters + the rest) fire. NOT byte-identical: audited golden churn.

**Files:**
- Modify: `engine.ts` player FOCUS branch (`drivePositionalApply` 4395 + after) and player TEAM branch (4552 + after)
- Test: `enemySideAttacked.integration.test.ts` (enemy Stalwart/Nyxen/Centurion + Second Wind)

- [ ] **Step 1: Write the failing enemy-counter integration tests**

In `enemySideAttacked.integration.test.ts`, add positional two-team cases where the **player** attacks an enemy that carries a counter (built via the real registry):
- enemy **Stalwart** (primary-target counter) → the player attacker takes counter damage;
- enemy **Nyxen** (shield-hit) with a live shield → counters only when the player hit reduced its shield;
- enemy **Centurion** → retaliates when it OR an adjacent enemy ally is the player's focus victim;
- enemy **Second Wind** (representative non-counter) → repairs itself when it takes a crit hit from the player.
Assert via the player attacker's HP / per-target damage (counter landed on the player) and the enemy's HP (Second Wind heal). Use the positional harness (player has `position`+`target`+`pattern`+a damage skill; enemies are real positioned actors).

Run → FAIL (no enemy reaction; player→enemy emits nothing yet).

- [ ] **Step 2: Capture the focus enemy victim outcome on the player FOCUS branch**

Before the focus `drivePositionalApply` (4395) declare:
```ts
                            let focusEnemyDamage = 0;
                            let focusEnemyShieldWasHit = false;
                            let focusEnemyHit = false;
```
Extend its `onVictimResolved` (4409, keep the leech call). It fires **once per hit** for the focus victim, so **accumulate** the damage (to match the enemy side's per-attack aggregate, which Tenacity's >25%-maxHP gate reads) and **OR** the shield flag across hits:
```ts
                                onVictimResolved: (victim, damage, outcome) => {
                                    procStandingLeechesPerVictim(actor.id, damage);
                                    if (victim.id === tgt.id) {
                                        focusEnemyHit = true;
                                        focusEnemyDamage += damage;
                                        focusEnemyShieldWasHit ||=
                                            !outcome.barriered &&
                                            outcome.shieldBefore > 0 &&
                                            outcome.hpDamage < damage;
                                    }
                                },
```
(If `||=` trips the linter, use `focusEnemyShieldWasHit = focusEnemyShieldWasHit || (…)`. `focusEnemyDamage` is the sum of direct hits to the focus victim — the per-victim analogue of the enemy side's aggregate `damage`; positional detonation is not per-victim-attributed today, same E5 deferral noted elsewhere.)

- [ ] **Step 3: Emit after the focus `drivePositionalApply`**

Immediately after the focus `drivePositionalApply(...)` call closes (still inside `if (positional) { … }`), add:
```ts
                            if (focusEnemyHit) {
                                const hitOutcomes =
                                    turn.hitCrits.length > 0 ? turn.hitCrits : [turn.roundCrit];
                                emitAttacked({
                                    bus,
                                    round: r,
                                    targetId: tgt.id,
                                    attackerId: actor.id,
                                    hitOutcomes,
                                    isPrimaryTarget: true,
                                    shieldWasHit: focusEnemyShieldWasHit,
                                    damage: focusEnemyDamage,
                                });
                            }
```
(Confirm `turn.roundCrit` exists on the `runPlayerTurn` return — `playerTurn.ts:2071` area. Mirror the enemy side's empty-`hitCrits` fallback.)

- [ ] **Step 4: Mirror on the player TEAM branch**

Repeat Steps 2–3 for the team branch: declare the three `let`s before the team `drivePositionalApply` (4552), extend its `onVictimResolved` (4565) capturing on `victim.id === tgt.id`, and emit after the call using `teamTurn.hitCrits`/`teamTurn.roundCrit`, `targetId: tgt.id`, `attackerId: actor.id`. (Each walked team actor runs one apply per its own turn → one emit per team actor; no extra loop.)

- [ ] **Step 5: Run the enemy-counter tests (pass)**

Run: `npx vitest run src/utils/combat/__tests__/enemySideAttacked.integration.test.ts -v`
Expected: PASS (enemy Stalwart/Nyxen/Centurion counter the player; Second Wind heals).

- [ ] **Step 6: Audit the golden churn (NOT byte-identical)**

Run: `npx vitest run 2>&1 | tail -20` and `git status --short`.
Expected: only `.snap` files in the **candidate set enumerated in Task 0 Step 2** should move (fixtures whose enemy team has an `on-attacked` ship AND runs positionally). **A move OUTSIDE that set is a red flag — STOP and investigate.** If Task 0 Step 2's set was empty, expect ZERO movement (and treat any move as suspect). For EACH moved golden:
- Open the diff; confirm the move is **directionally sane** (enemy HP higher where Second Wind / Reactive Ward / repair reactions fire; the player attacker dented/killed where an enemy counter fires; enemy buffs/charge/stealth where the relevant reactive applies).
- **Do NOT `vitest -u` blindly.** Only accept snapshots after confirming each change is explained by a now-active enemy `on-attacked` reactive. If a move is NOT explained by such a reactive, STOP and investigate (it may be a real bug).
- Record the audited fixtures + which enemy reactive caused each move in the commit message.

If a moved golden is confirmed correct, update it deliberately (re-run the specific failing test file with `-u` ONLY after auditing that file's diff, or hand-edit). List every touched `.snap` in the commit.

- [ ] **Step 7: Full verification**

Run: `npx tsc --noEmit && npm run lint && npx vitest run 2>&1 | tail -8 && npm run audit:skills 2>&1 | grep -iE "audited|finding"`
Expected: tsc/lint clean, full suite green (with audited goldens), audit 141/0.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat(combat): player->enemy attacked emit — enemy ships now react when hit (counters + reactives)

Audited golden churn: <list fixtures + the enemy reactive that moved each>.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Changelog + docs + final verification

**Files:**
- Modify: `src/constants/changelog.ts` (`UNRELEASED_CHANGES`)
- Modify: `src/pages/DocumentationPage.tsx` (combat-sim coverage prose)

- [ ] **Step 1: Changelog**

Append to `UNRELEASED_CHANGES` in `src/constants/changelog.ts`:
> "Combat simulator: enemy ships now react when the player hits them — enemy counterattackers (Stalwart, Nyxen, Centurion) strike back, and enemy on-hit reactions (self-repairs, defensive buffs, cleanses) now fire, making enemy teams play more like real opponents. Shield-hit counters (Nyxen) now also work for your own ships in positioned battles."

- [ ] **Step 2: Docs**

Update the combat-sim reactive/counterattack prose in `src/pages/DocumentationPage.tsx` (the Reactive Triggers / counterattack section, ~line 3149) to note that reactions now fire for **both** teams (enemy ships react to your hits too), consistent with the existing player-side counterattack mention.

- [ ] **Step 3: Final verification**

Run: `npx tsc --noEmit && npm run lint && npx vitest run 2>&1 | tail -8 && npm run audit:skills 2>&1 | grep -iE "audited|finding"`
Then `git status --short`.
Expected: all clean/green, audit 141/0, only the changelog/docs files modified.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(combat): enemy-side reactive emission changelog + docs

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Done criteria

- A shared `emitAttacked` helper is the single emit path for both directions (enemy-turn refactor byte-identical).
- `shieldWasHit` is computed from the focus victim's per-victim outcome on the **positional** path in **both** directions → player Nyxen AND enemy Nyxen fire in the positioned two-team sim.
- The player→enemy emit lights up enemy `on-attacked` reactives: enemy Stalwart/Nyxen/Centurion counter the player attacker; enemy on-hit reactives (Second Wind, etc.) fire — verified by positional two-team integration tests.
- No ping-pong (counters use the no-event apply path; guard unchanged); focus-victim-only, direct-hits-only, symmetric.
- Tasks 1–2 byte-identical; Task 3's golden churn is **audited** (each move explained by a now-active enemy reactive), never blind-`-u`'d.
- `npx tsc --noEmit`, `npm run lint`, full `npx vitest run`, `npm run audit:skills` (141/0) all clean.
- Non-positional/DPS paths emit nothing (synthetic indestructible sink — not a reactive owner), as designed.
