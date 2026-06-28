# bySide PR7 — Phase-5 per-victim completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the three remaining Phase-5 per-victim gaps in one PR: per-victim `attacked` emission + Stasis-break for AoE footprint victims, surfacing per-victim incoming/shield/barrier intake on `RoundData` + the battle-simulator UI, and closing out the direct-only damage-modifier scope.

**Architecture:** The combat engine (`src/utils/combat/engine.ts`) already lands AoE damage per footprint victim via `drivePositionalApply` → `applyPositionalDamage`, collecting per-victim outcomes in an `onVictimResolved` hook. Today each cast-site emits one `attacked` for the **primary** victim only. We generalize the per-site focus-victim collection into a per-victim signal map and emit `attacked` for every footprint victim through a new shared helper, both directions, positional branch only. Stasis-break is extended engine-side to every hit footprint victim (covered victims break unconditionally — they have no same-turn re-apply vector). `perActorIncoming` (already maintained per round) is surfaced on `RoundData` mirroring the `perActorShield` pattern. The damage-modifier closeout is a comment reword + a bomb-exclusion lock test.

**Tech Stack:** TypeScript, Vitest. No new deps.

**Spec:** `docs/superpowers/specs/2026-06-28-byside-pr7-per-victim-completion-design.md`

---

## Conventions for this PR (campaign-binding)

- **Branch** `feat/combat-byside-pr7-per-victim-completion` off `main`, **in-place on the main checkout** (the combat-engine workflow — fresh worktrees crash on `npm start`; tests/build are fine, but we work in-place to match campaign habit). Run `gh auth switch --hostname github.com --user TheSusort` before any PR op.
- **Golden discipline:** byte-identical is EXPECTED for everything except where a fixture legitimately hits a reactive-bearing covered victim. **NEVER** `vitest -u`. Hand-validate every `.snap`/golden delta and explain it. Run the **whole** `npm test` suite (per-victim fixtures live outside `src/utils/combat`, e.g. `src/utils/calculators/__tests__/healingGoldenParity.test.ts`).
- **Per task:** write the failing test, see it fail, implement minimal, see it pass, `npm run lint` + `npx tsc --noEmit`, commit. Husky runs the full vitest suite on commit — use `--no-verify` only for docs-only commits.
- **Team-symmetry** is mandatory (a ship behaves identically on either side). Component 1 ships an explicit E5-symmetry pin.

---

## File structure

- **Create** `src/utils/combat/emitPerVictimAttacked.ts` — pure helper that emits one `attacked` per victim from a victim-signal map, delegating to the existing `emitAttacked`. One responsibility, testable in isolation.
- **Create** `src/utils/combat/__tests__/emitPerVictimAttacked.test.ts`
- **Create** `src/utils/combat/__tests__/perVictimAttacked.integration.test.ts` — covered-victim reactive fires + E5-symmetry pin.
- **Create** `src/utils/combat/__tests__/perFootprintStasisBreak.integration.test.ts`
- **Create** `src/utils/combat/__tests__/perActorIncomingSurface.test.ts`
- **Create** `src/utils/combat/__tests__/bombModifierExclusion.test.ts`
- **Modify** `src/utils/combat/engine.ts` — 3 cast-site emits → per-victim; per-footprint Stasis-break; `perActorIncoming` row field.
- **Modify** `src/utils/calculators/dpsSimulator.ts` — add `perActorIncoming?` to `RoundData`.
- **Modify** the battle-simulator UI component that renders `perActorShield` (located in Task 7).
- **Modify** `src/constants/changelog.ts`, `src/pages/DocumentationPage.tsx`.

---

## Task 0: BLOCKING SPIKE — per-footprint Stasis-break feasibility

**Files:** none (written deliverable only — append findings to the plan or a scratch note; do NOT commit code).

This gates Task 5. Read the code, answer each question with a file:line citation, and confirm the Task 5 design holds (or surface a blocker).

- [ ] **Step 1: Confirm the re-apply-guard granularity (the landmine).**
  Read engine.ts ~4617-4647 (focus site) and `playerTurn.ts` ~139 (`inflictedEnemyDebuffs` type) and ~977 (where the turn applies enemy debuffs). Confirm: `inflictedEnemyDebuffs` is a flat `ActiveBuff[]` with **no victim id**, and the turn's ability debuffs only ever target the resolved `targetId`. Conclusion to verify: the re-apply guard (`turn.inflictedEnemyDebuffs.some(isStasis)`) legitimately applies to the **selected target only**; covered footprint victims have **no** same-turn re-apply vector, so their break fires unconditionally (modulo `doesntBreakStasis` + was-stasised-at-hit).

- [ ] **Step 2: Confirm the deferred-removal routing.**
  Read the `stasisBreakPending` consumption sites (engine.ts ~4830, ~5058-5061, ~5645-5648) and the drainQueue `isStasised`-suppression note (~3334-3345). Confirm the per-footprint break must set `stasisBreakPending.set(victimId, true)` (deferred), NOT remove Stasis immediately, so the covered victim's on-attacked reactive still observes `isStasised = true` at emit time — identical to the primary.

- [ ] **Step 3: Confirm the `doesntBreakStasis` + pre-hit-stasis capture.**
  Confirm `tgtWasStasised = !actor.doesntBreakStasis && isStasised(tgt.id)` (engine.ts ~4623) is the template: covered victims capture `isStasised(victim.id)` inside `onVictimResolved` (state is stable across hits because removal is deferred), and a `doesntBreakStasis` attacker breaks no one (skip the whole footprint capture).

- [ ] **Step 4: Confirm ordering.**
  The selected-target break is computed AFTER `runPlayerTurn` returns (so `inflictedEnemyDebuffs` is available) and BEFORE the victim's skip branch consumes it. The footprint break is set after `drivePositionalApply` (when the footprint is known) — also before any consumption. Confirm no consumption happens between `drivePositionalApply` and the footprint-break set within the same turn.

- [ ] **Step 5: Record the verdict.**
  Write a 5-10 line confirmation (or, if a blocker emerged, the fallback: ship per-victim `attacked` only and defer per-footprint Stasis-break). If GO, proceed to Task 1.

---

## Task 1: Shared `emitPerVictimAttacked` helper

**Files:**
- Create: `src/utils/combat/emitPerVictimAttacked.ts`
- Test: `src/utils/combat/__tests__/emitPerVictimAttacked.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from 'vitest';
import { emitPerVictimAttacked } from '../emitPerVictimAttacked';
import type { CombatEventBus } from '../events';

function fakeBus() {
    const events: any[] = [];
    const bus = { emit: vi.fn((e: any) => events.push(e)) } as unknown as CombatEventBus;
    return { bus, events };
}

describe('emitPerVictimAttacked', () => {
    it('emits one attacked per hit per victim, primary flagged, per-victim damage/shield', () => {
        const { bus, events } = fakeBus();
        const victims = new Map([
            ['P', { damage: 1000, shieldWasHit: true }],
            ['C', { damage: 400, shieldWasHit: false }],
        ]);
        emitPerVictimAttacked({
            bus,
            round: 2,
            attackerId: 'A',
            primaryId: 'P',
            hitOutcomes: [true, false], // 2 hits
            victims,
        });
        // 2 victims × 2 hits = 4 events
        expect(events).toHaveLength(4);
        const primary = events.filter((e) => e.targetId === 'P');
        const covered = events.filter((e) => e.targetId === 'C');
        expect(primary).toHaveLength(2);
        expect(covered).toHaveLength(2);
        // primary carries isPrimaryTarget + shieldWasHit + its own damage
        expect(primary[0]).toMatchObject({ type: 'attacked', attackerId: 'A', round: 2, isPrimaryTarget: true, shieldWasHit: true, damage: 1000 });
        // covered: no isPrimaryTarget, no shieldWasHit, its own damage
        expect(covered[0].isPrimaryTarget).toBeUndefined();
        expect(covered[0].shieldWasHit).toBeUndefined();
        expect(covered[0].damage).toBe(400);
        // crit flags follow the shared hitOutcomes for BOTH victims
        expect(primary[0].didCrit).toBe(true);
        expect(primary[1].didCrit).toBeUndefined();
        expect(covered[0].didCrit).toBe(true);
    });

    it('byte-identical to emitAttacked when only the primary is present', () => {
        const { events } = fakeBus();
        // single-victim map → same shape as the legacy focus-only emit
        const { bus } = fakeBus();
        emitPerVictimAttacked({
            bus, round: 1, attackerId: 'A', primaryId: 'P',
            hitOutcomes: [false], victims: new Map([['P', { damage: 50, shieldWasHit: false }]]),
        });
        expect((bus.emit as any).mock.calls).toHaveLength(1);
        expect((bus.emit as any).mock.calls[0][0]).toEqual({ type: 'attacked', targetId: 'P', attackerId: 'A', round: 1, isPrimaryTarget: true, damage: 50 });
    });
});
```

- [ ] **Step 2: Run it, verify it fails** — `npx vitest run src/utils/combat/__tests__/emitPerVictimAttacked.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement the helper**

```ts
import type { CombatEventBus } from './events';
import { emitAttacked } from './emitAttacked';

/**
 * Emits per-victim `attacked` events for an AoE cast: one event per hit per
 * footprint victim, each carrying that victim's own damage / shieldWasHit, with
 * `isPrimaryTarget` set only on the selected target. Delegates to `emitAttacked`
 * per victim so the per-event conditional-spread shape stays identical to the
 * legacy focus-only emit. Direction-agnostic (caller supplies attacker/victim ids).
 */
export function emitPerVictimAttacked(args: {
    bus: CombatEventBus;
    round: number;
    attackerId: string;
    primaryId: string;
    /** one entry per hit; `true` = that hit critted. Shared across all victims. */
    hitOutcomes: boolean[];
    /** victim id → its aggregate per-attack damage + whether its shield was dented. */
    victims: Map<string, { damage: number; shieldWasHit: boolean }>;
}): void {
    for (const [victimId, sig] of args.victims) {
        emitAttacked({
            bus: args.bus,
            round: args.round,
            targetId: victimId,
            attackerId: args.attackerId,
            hitOutcomes: args.hitOutcomes,
            isPrimaryTarget: victimId === args.primaryId,
            shieldWasHit: sig.shieldWasHit,
            damage: sig.damage,
        });
    }
}
```

- [ ] **Step 4: Run it, verify it passes.**
- [ ] **Step 5: Commit** — `feat(combat): emitPerVictimAttacked helper (PR7 Task 1)`

> NOTE on iteration order: a `Map` preserves insertion order; `onVictimResolved` resolves the primary first (anchor before footprint), so the primary's events lead — matching the legacy emit order for the single-victim case. Keep that ordering in Tasks 2-4.

---

## Task 2: Per-victim emit at the focus player→enemy site

**Files:**
- Modify: `src/utils/combat/engine.ts` ~4695-4748 (focus positional branch)
- Test: `src/utils/combat/__tests__/perVictimAttacked.integration.test.ts` (created here, extended in Task 4)

- [ ] **Step 1: Write the failing integration test.**
  Use the `perVictimLeech.test.ts` / `perVictimEnemyDetonation.integration.test.ts` template (positioned actors via `__testTapActors`, crit forced off → exact integers). Set up: a player attacker with an AoE pattern hitting an anchor enemy + a **covered** enemy that carries an **on-attacked reactive** (e.g. a counter — reuse the Stalwart/Centurion fixture pattern from `counterattack` tests, or a minimal on-attacked self-buff). Assert the covered enemy's reactive fired (observable: a counter event / its self-buff present). Add a non-vacuous control: with the AoE pattern removed (single-target), the covered enemy's reactive does NOT fire.

  Run it → FAIL (covered victim emits no `attacked`, reactive silent).

- [ ] **Step 2: Replace the focus-only collection with a per-victim signal map.**
  At engine.ts ~4695, replace `focusEnemyDamage`/`focusEnemyShieldWasHit`/`focusEnemyHit` with:

```ts
// Per-victim attacked signals: victim id → aggregate damage + shield-dent flag,
// populated for EVERY footprint victim (PR7). The primary is tgt.id.
const attackedSignals = new Map<string, { damage: number; shieldWasHit: boolean }>();
```

  In the `onVictimResolved` hook (~4717), after `detonationTargets.set(...)`, accumulate for every victim:

```ts
onVictimResolved: (victim, damage, outcome) => {
    procStandingLeechesPerVictim(actor.id, damage);
    detonationTargets.set(victim.id, victim);
    const prev = attackedSignals.get(victim.id) ?? { damage: 0, shieldWasHit: false };
    prev.damage += damage;
    prev.shieldWasHit =
        prev.shieldWasHit ||
        (!outcome.barriered && outcome.shieldBefore > 0 && outcome.hpDamage < damage);
    attackedSignals.set(victim.id, prev);
},
```

- [ ] **Step 3: Replace the focus-only emit (~4735-4748) with the helper:**

```ts
if (attackedSignals.size > 0) {
    const hitOutcomes = turn.hitCrits.length > 0 ? turn.hitCrits : [turn.roundCrit];
    emitPerVictimAttacked({
        bus,
        round: r,
        attackerId: actor.id,
        primaryId: tgt.id,
        hitOutcomes,
        victims: attackedSignals,
    });
}
```

  Add the import at the top of engine.ts: `import { emitPerVictimAttacked } from './emitPerVictimAttacked';`

  **Note — intentional guard broadening:** the gate changes from `if (focusEnemyHit)` (primary hit) to `if (attackedSignals.size > 0)` (any victim hit). If the primary anchor whiffs but a covered victim is struck, the emit fires for the covered victim and no `isPrimaryTarget` event fires that turn — this is correct by design (the per-victim contract: only ships actually hit emit), not a regression.

- [ ] **Step 4: Run the new test → PASS. Run the full suite** — `npm test`. Hand-audit any `.snap` delta (expected: none, unless a golden fixture has an AoE-covered reactive-bearer). `npm run lint && npx tsc --noEmit`.
- [ ] **Step 5: Commit** — `feat(combat): per-victim attacked at focus site (PR7 Task 2)`

---

## Task 3: Per-victim emit at the walked-team site

**Files:**
- Modify: `src/utils/combat/engine.ts` ~4951-4983 (walked-team positional branch)
- Test: extend `perVictimAttacked.integration.test.ts`

- [ ] **Step 1: Write the failing test** — same shape as Task 2 but the AoE attacker is a **walked-team** actor (not the focus). Assert a covered enemy's on-attacked reactive fires. FAIL.
- [ ] **Step 2: Apply the identical transformation** as Task 2 to the walked-team block: replace `teamFocusEnemyDamage`/`teamFocusEnemyShieldWasHit`/`teamFocusEnemyHit` with a per-victim `attackedSignals` map populated in `onVictimResolved` (~4951), and replace the focus-only emit (~4968-4983) with `emitPerVictimAttacked({ ..., primaryId: tgt.id, victims: attackedSignals })`.
- [ ] **Step 3: Run new test → PASS. Full suite, audit, lint, tsc.**
- [ ] **Step 4: Commit** — `feat(combat): per-victim attacked at walked-team site (PR7 Task 3)`

---

## Task 4: Per-victim emit at the enemy→player site + E5-symmetry pin

**Files:**
- Modify: `src/utils/combat/engine.ts` — enemy positional branch (~5446-5560) + the shared emit (~5613-5640)
- Test: extend `perVictimAttacked.integration.test.ts`

The enemy emit (~5631) is **shared** between positional and non-positional paths. Restructure so positional emits per-victim; non-positional keeps the single emit.

- [ ] **Step 1: Write two failing tests.**
  (a) An **enemy** AoE attacker hitting a covered **player** victim with an on-attacked reactive → reactive fires.
  (b) **E5-symmetry pin:** the same AoE attacker + same footprint geometry, sides flipped, produces byte-identical per-victim `attacked` events (count, target set, per-victim damage/shield/crit). Use the campaign's E5 mirror-fixture template. FAIL.

- [ ] **Step 2: Collect per-victim signals in the enemy positional branch.**
  In the enemy `if (enemyPositional)` block (~5446+), where `detonationTargets` is collected in `onVictimResolved`, also populate an `attackedSignals` map (same accumulation as Task 2). Capture the per-victim damage/shield from the victim outcome (the focus-only `positionalShieldWasHit`/`positionalShieldCaptured` locals become per-victim entries).
  **TRAP — parameter name:** the enemy `onVictimResolved` names its per-victim damage param **`dmg`** (NOT `damage`), because the outer `damage` is already bound to the turn aggregate (engine.ts ~5317, hook ~5488). Accumulate `prev.damage += dmg` and compare `outcome.hpDamage < dmg` — do NOT copy Task 2's `damage` identifier verbatim here.
  **SCOPE — hoist required:** declare `attackedSignals` (and the Task 5 `coveredStasisVictims`) in the **enemy-turn body scope** alongside `positionalShieldWasHit` (~5444), NOT inside the `if (enemyPositional)` block — the emit at ~5631 is in the outer scope and would not see a block-local map.

- [ ] **Step 3: Make the emit positional-aware.**
  At the shared emit (~5613-5640), wrap:

```ts
if (enemyPositional) {
    if (attackedSignals.size > 0) {
        const hitOutcomes = enemyHitCrits.length > 0 ? enemyHitCrits : [enemyTurnDidCrit];
        emitPerVictimAttacked({
            bus, round: r, attackerId: actor.id, primaryId: tgt.id, hitOutcomes,
            victims: attackedSignals,
        });
    }
} else {
    // legacy non-positional single emit (UNCHANGED)
    const hitOutcomes = enemyHitCrits.length > 0 ? enemyHitCrits : [enemyTurnDidCrit];
    const shieldWasHit = positionalShieldCaptured ? positionalShieldWasHit : !barriered && shieldBefore > 0 && hpDamage < damage;
    emitAttacked({ bus, round: r, targetId: tgt.id, attackerId: actor.id, hitOutcomes, isPrimaryTarget: true, shieldWasHit, damage });
}
```

  (Confirm `attackedSignals` is declared in a scope visible at the emit. If the positional block and the emit are in sibling scopes, hoist the `attackedSignals` declaration to the enemy-turn body top, like `positionalShieldWasHit`.)

- [ ] **Step 4: Run both new tests → PASS. Full suite, audit (the non-positional path MUST stay byte-identical — verify the enemy emit goldens are unchanged), lint, tsc.**
- [ ] **Step 5: Commit** — `feat(combat): per-victim attacked at enemy site + E5 symmetry (PR7 Task 4)`

---

## Task 5: Per-footprint Stasis-break (both directions) — gated on Task 0

**Files:**
- Modify: `src/utils/combat/engine.ts` — the 3 positional branches (capture + set), reuse the existing `stasisBreakPending`
- Test: `src/utils/combat/__tests__/perFootprintStasisBreak.integration.test.ts`

- [ ] **Step 1: Write the failing test.**
  An AoE cast (player→enemy) hitting **two stasised footprint** enemies (anchor + covered), attacker without `doesntBreakStasis`. Assert BOTH have their Stasis broken (they act next round — i.e. `stasisBreakPending` consumed → they take a real turn). Add controls: (a) a `doesntBreakStasis` attacker breaks NEITHER; (b) the same-turn re-apply still suppresses the break for the **selected** target only (covered victim still breaks). FAIL.

- [ ] **Step 2: Capture covered-victim pre-hit stasis.**
  In each positional `onVictimResolved` (all 3 sites), when `actor` does NOT have `doesntBreakStasis` and `victim.id !== tgt.id`, record covered victims that were stasised at hit time:

```ts
// after the attackedSignals accumulation:
if (!actor.doesntBreakStasis && victim.id !== tgt.id && isStasised(victim.id)) {
    coveredStasisVictims.add(victim.id);
}
```

  Declare `const coveredStasisVictims = new Set<string>();` next to `attackedSignals` at each site. (For the enemy site, `isStasised` reads the player victim's store — it is direction-agnostic, confirmed in B1.)

- [ ] **Step 3: Set the deferred break after `drivePositionalApply`.**
  After each site's detonation loop (or right after the emit), set the pending break **unconditionally** for covered victims (no re-apply guard — Task 0 confirmed they have no re-apply vector):

```ts
for (const victimId of coveredStasisVictims) {
    stasisBreakPending.set(victimId, true);
}
```

  The selected target (`tgt.id`) keeps its EXISTING re-apply-guarded path (engine.ts ~4637-4647 at the focus site; the enemy/team sites' selected-target break is handled by their existing `onHitBreakStasis`/`turnStasisHitVictims` flow — confirm each site already routes the selected target, and only ADD the covered-victim set).

- [ ] **Step 4: Run the test → PASS. Full suite, audit (expected byte-identical: no golden threads positions for stasised AoE victims), lint, tsc.**
- [ ] **Step 5: Commit** — `feat(combat): per-footprint Stasis-break (PR7 Task 5)`

---

## Task 6: Surface `perActorIncoming` on `RoundData`

**Files:**
- Modify: `src/utils/calculators/dpsSimulator.ts` ~153 (RoundData interface, after `perActorDetonation?`)
- Modify: `src/utils/combat/engine.ts` ~5877-5895 (row assembly, beside the perActorShield IIFE)
- Test: `src/utils/combat/__tests__/perActorIncomingSurface.test.ts`

> `perActorIncoming` is the **fresh per-round `Map<string, ActorIntake>` declared at ~2667** (`ActorIntake = {incoming, shieldAbsorbed, barrierAbsorbed}`, ~1098). It is already read by the perActorShield IIFE (`perActorIncoming.get(id)?.shieldAbsorbed`, ~5889), so it is in scope at the row push — there is NO top-level `let perActorIncoming` rebind to look for (unlike `perActorShieldGranted`/`perActorDetonation`).

- [ ] **Step 1: Add the RoundData field** (dpsSimulator.ts, after `perActorDetonation`):

```ts
/** Per-victim incoming-damage accounting for THIS round (PR7), keyed by victim id:
 *  `incoming` = total damage taken, `shieldAbsorbed` = shield drained, `barrierAbsorbed`
 *  = barrier-blocked. Set ONLY when at least one actor has a nonzero entry — absent on
 *  rounds without per-victim intake (legacy RoundData shape preserved, goldens byte-identical). */
perActorIncoming?: Record<string, { incoming: number; shieldAbsorbed: number; barrierAbsorbed: number }>;
```

- [ ] **Step 2: Write the failing test.**
  A positional round with a covered victim → `roundData.perActorIncoming` has the covered victim's `{incoming, shieldAbsorbed, barrierAbsorbed}`. A non-positional round → field absent. FAIL.

- [ ] **Step 3: Assemble the field** in the engine row push (beside the perActorShield IIFE ~5869):

```ts
...(() => {
    const out: Record<string, { incoming: number; shieldAbsorbed: number; barrierAbsorbed: number }> = {};
    for (const [id, v] of perActorIncoming) {
        if (v.incoming === 0 && v.shieldAbsorbed === 0 && v.barrierAbsorbed === 0) continue;
        out[id] = { incoming: v.incoming, shieldAbsorbed: v.shieldAbsorbed, barrierAbsorbed: v.barrierAbsorbed };
    }
    return Object.keys(out).length > 0 ? { perActorIncoming: out } : {};
})(),
```

- [ ] **Step 4: Run test → PASS. Full suite (byte-identical expected — field absent on all existing fixtures), lint, tsc.**
- [ ] **Step 5: Commit** — `feat(combat): surface perActorIncoming on RoundData (PR7 Task 6)`

---

## Task 7: Battle-simulator UI — display covered victims' damage-taken

**Files:**
- Modify: the component that renders `perActorShield` (locate it first)

- [ ] **Step 1: Locate the seam** — `grep -rn "perActorShield" src/pages src/components`. Find where per-actor shield rows are rendered in the battle-simulator result UI.
- [ ] **Step 2: Add a `perActorIncoming` display** colocated with `perActorShield`, reusing the existing per-actor row primitives (`card` class / `DataTable` / `StatCard` as the surrounding code uses — do NOT hand-roll markup, per CLAUDE.md UI rules). Show each victim's incoming / shield-absorbed / barrier-absorbed for the round. No emojis (plain text + color classes).
- [ ] **Step 3: Verify in the running app** if practical (`npm start`, simulator page with positioned both-team setup), else rely on a component/render test. Confirm covered victims' damage-taken appears.
- [ ] **Step 4: Run suite + lint + tsc.**
- [ ] **Step 5: Commit** — `feat(combat): battle-sim UI surfaces per-victim damage-taken (PR7 Task 7)`

---

## Task 8: Component 3 — damage-modifier scope closeout

**Files:**
- Modify: `src/utils/combat/engine.ts` ~3362-3368 (comment)
- Test: `src/utils/combat/__tests__/bombModifierExclusion.test.ts`

- [ ] **Step 1: Write the lock test.**
  A victim carrying an `Inc. Damage Down` (or Up) self-buff takes **unmodified** bomb damage — assert the bomb-detonation damage equals the seeded bomb value (no `(1 ± pct/100)` scaling). Cover both positional (per-victim detonation) and non-positional (focus-dummy `processBombs`) paths. Use the detonation test fixtures (`perVictimTimedDetonation` / `perVictimEnemyDetonation`) + apply an incoming-damage self-buff to the victim.
  - If the test PASSES first try → bombs already bypass (expected). Keep it as a regression lock.
  - If it FAILS → a leak exists: add an explicit exclusion so the incoming-damage modifier is not applied to the bomb portion, then make it pass. (Trace: confirm `incomingDamageModifierPct` only enters via `defenseProfileOf` in `drivePositionalApply` (~3446) which feeds the DIRECT per-hit calc, while bombs flow through `applyVictimDamage({ bombPortion })` / `detonationDamageModifier` — independent.)

- [ ] **Step 2: Reword the comment** at engine.ts ~3368 from `// ... Direct channel only; incoming-DoT deferred.` to:

```ts
// Direct-damage channel ONLY — by design. Per the game rules, incoming/outgoing
// damage modifiers (Inc. Damage Down/Up, Out. Damage Up) apply to DIRECT hits
// only; DoT ticks (corrosion/inferno) and bombs are EXCLUDED. DoT reduction has a
// dedicated channel (incomingDotReductionPct / Vortex Veil); bombs apply through
// the detonation/bombPortion path which never reads incomingDamageModifierPct.
// Locked by bombModifierExclusion.test.ts.
```

- [ ] **Step 3: Run test → PASS. Full suite, lint, tsc.**
- [ ] **Step 4: Commit** — `fix(combat): lock direct-only damage-modifier scope, DoTs+bombs excluded (PR7 Task 8)`

---

## Task 9: Changelog, docs, final audit

**Files:**
- Modify: `src/constants/changelog.ts` (`UNRELEASED_CHANGES`)
- Modify: `src/pages/DocumentationPage.tsx`

- [ ] **Step 1: Add a changelog entry** to `UNRELEASED_CHANGES` — plain English, e.g.: "Combat simulator: AoE attacks now wake the on-attacked reactions of *every* ship in the blast (not just the primary target), break Stasis on all ships hit, and the result breakdown shows damage taken per ship."
- [ ] **Step 2: Update `DocumentationPage.tsx`** if the combat-sim section describes AoE/reactive behavior or the per-actor result surface.
- [ ] **Step 3: Final holistic audit.** Run the **whole** `npm test` suite; confirm `tsc --noEmit`, `npm run lint` (`--max-warnings 0`), `npm run audit:skills` (141/0) all clean. Re-confirm ZERO unexplained `.snap`/golden movement (each delta hand-validated and attributed to a covered-victim reactive). Verify the E5-symmetry pin and the non-vacuity controls are load-bearing (flip the emission off → tests fail).
- [ ] **Step 4: Commit** — `docs(combat): changelog + docs for PR7 per-victim completion`
- [ ] **Step 5: Open the PR** — `gh auth switch --user TheSusort` first; `git push | cat`; open vs `main`. Poll `mergeStateStatus=CLEAN`; address CodeRabbit; user merges when green.

---

## Risk notes for the implementer

- **Golden churn is the main hazard.** Component 1 changes which reactives fire. If a `.snap` moves, find the fixture, confirm it has an AoE cast hitting a covered victim with an on-attacked reactive, and that the new events are correct. If a `.snap` moves and you canNOT explain it that way, STOP — it's a bug, not a golden refresh. Never `vitest -u`.
- **The enemy site is the trap** (Task 4): its emit is shared with the non-positional path. The non-positional path MUST stay byte-identical — only the positional branch changes.
- **Stasis-break (Task 5) is the correctness-sensitive one** — Task 0 must confirm covered victims break unconditionally and route through `stasisBreakPending`. Do not gate covered victims on the turn-global re-apply check.
