# Ability-target side classifier (#399)

**Date:** 2026-08-25
**Issue:** #399 — "Selenite's Concentrate Fire registers on the CASTER's self store
(`'enemy-highest-attack'` missing from the store-side list)"
**Class:** store axis (who APPLIED a status), not side axis. See the locked rule in
`reference_store_axis_vs_side_axis`.

---

## 0. The issue's premise is probably wrong — and that changes the shape of the work

#399 claims Selenite's Concentrate Fire (CF) is written to the caster's SELF store and read back
from the ENEMY store, so it "plausibly does nothing."

Static reading of the code says otherwise:

- Selenite p3's CF is built with `trigger: 'start-of-round'` (`buildShipAbilities.ts`
  `detectReactiveTrigger`), and `'start-of-round'` is in `LIVE_TRIGGERS`
  (`types/abilities.ts:~296`).
- `partitionReactiveAbilities` (`triggers.ts:297`) therefore pulls the ability OUT of `castSkills`
  at setup, **before** `registerActorAbilityStatuses` (`engine.ts:228`) ever iterates
  `castSkills.slots`.
- Its real route is the reactive intent path, which resolves `enemy-highest-attack` explicitly
  (`triggers.ts:3831`) and lands the debuff on the resolved victim.
- `simCoverage.ts:106-116` already documents this as "THE ONE COMBINATION THAT WORKS, and it is a
  shipped ship."
- Doomsayer's implant CF (`buildEquipmentAbilities.ts:1029`) is `'end-of-round'` — also live, also
  reactive, and `cfProvokeAppliers.integration.test.ts:334` asserts it lands on the 9000-attack
  enemy.

So reaching the `engine.ts:284` misregistration requires **all three** of:

1. a `buff`- or `debuff`-typed config (everything else `continue`s at `engine.ts:280`),
2. a **non-live** trigger (`'on-cast'`) so it survives the reactive partition, and
3. one of the three selector targets.

Nothing in the 149-ship corpus has that combination, and `AbilityCard.tsx:83`'s `TARGET_OPTIONS`
does not offer the selector targets, so a hand-authored ability cannot reach it either.

**This is a reading, not a measurement** — exactly the class
`project_reachability_is_a_measurement` warns about. Task 1 measures it.

### There is a FOURTH site, and it is the correct one

`buffAbilityConverters.ts:14`'s `isEnemyTarget` already lists all seven enemy-side targets. So the
problem is not "invent a predicate" — it is "three hand-enumerations disagree with the one that is
already right."

| Site | Question it asks | Selector targets today |
| --- | --- | --- |
| `engine.ts:284` | which STORE does this status land in | ❌ → `'self'` (the bug) |
| `playerTurn.ts:1047` | which charge pool does this ability feed | ❌ → `'own'` |
| `triggers.ts:3499` | bulk-all-opposing or owner-only charge removal | ❌ → owner-only *gain* |
| `buffAbilityConverters.ts:14` | buff or debuff config on round-trip | ✅ all seven listed |

---

## 1. Task 1 — Measure reachability (no production change)

Three arms over a real `runCombat`. Template: `enemyAppliedIncomingRepair.test.ts`. Store
membership read off the LIVE engine via `__testTapStatusEngine` — never re-derived from a model,
so a null can never be "it never landed."

| Arm | Setup | Purpose |
| --- | --- | --- |
| **CONTROL** | debuff, `target: 'enemy'`, `trigger: 'on-cast'` | Instrument validation. The victim's per-target enemy store MUST be populated. Without this, a null in SELECTOR measures its own registration, which is how #398's first probe went blind. |
| **SELECTOR** | byte-identical payload, `target: 'enemy-highest-attack'`, `trigger: 'on-cast'` (hand-authored — the parser cannot emit this shape) | Does the status land on the CASTER's self store instead of the victim's enemy store? |
| **SELENITE-REAL** | the real Selenite kit, full `runCombat` | Is CF present in the highest-attack enemy's per-victim debuff store? |

**Prediction, recorded before running** (per `feedback_measurement_instrument_validity`):

- CONTROL: enemy store populated.
- SELECTOR: status on the caster's SELF store, absent from the victim's enemy store.
- SELENITE-REAL: **green** — CF present on the highest-attack enemy. The stated symptom does NOT
  reproduce.

**Stop condition:** if SELENITE-REAL comes back red, #399's premise was correct after all and
Sections 2–4 change meaning. Halt and re-scope rather than proceeding.

Whatever the result, it gets posted on #399 — the census in the issue body is a static reading and
should not stand as the record.

---

## 2. Task 2 — One `tsc`-enforced side classifier

New module `src/utils/abilities/abilityTargetSide.ts`:

```ts
export const ABILITY_TARGET_SIDE: Record<AbilityTarget, 'self' | 'enemy'> = { /* total */ };
export const isEnemyTarget = (t: AbilityTarget) => ABILITY_TARGET_SIDE[t] === 'enemy';
```

**Why a total `Record` and not a `||` chain or a `switch`:** the key set is DERIVED from
`AbilityTarget`, so `tsc` rejects a new variant until somebody classifies it. A hand-maintained
`||` chain cannot do that half, and a hand-maintained chain is precisely what produced four copies
that disagree. This is the `enemyStoreChannelCoverage.test.ts` tripwire lesson from #401 applied to
a different axis. An exhaustive `switch` with a `never` guard (the `passiveSlotPattern` precedent
at `engine.ts:7933`) is equally strong at compile time but reads worse as a lookup — the `Record`
is the better fit for a two-valued classification with no per-case logic.

**Re-point:**

- `engine.ts:284` — derive `side` from the classifier. This is the store-axis fix.
- `playerTurn.ts:1047` — derive `isEnemy` from the classifier; delete the stale NOTE at `:1050-1053`
  ("if charge ever uses one, add it to the enemy match"), which this closes.
- `buffAbilityConverters.ts:14` — delete the local copy, import the shared one. Its existing tests
  become the anchor for the shared definition.

**Add:** a unit test pinning the classification of every `AbilityTarget`. The `Record` is the
compile-time tripwire; the test is the readable record of the decision.

### Deliberately NOT folded in

`playerTurn.ts:1044`'s `isAlly` list is `ally | all-allies | lowest-hp-ally` — it omits
`'adjacent-allies'`, which therefore classifies as `'own'` at the charge site. That is a question on
the **ally** axis with its own separate reachability, not this issue's store axis. Flag it in the PR
description; do not widen the map to three values to accommodate it. Widening would change charge
routing on a path this spec has not measured.

---

## 3. Task 3 — Selector-targeted charge removal (`triggers.ts:3499`)

### The game example

Board: your ship casts; four enemies opposite — Doomsayer at 9,000 attack holding 2 charges, plus
three smaller ships holding 1 charge each.

| Skill text | Correct result | Code path |
| --- | --- | --- |
| "removes 1 charge from **the enemy**" | all four lose 1 | `removeEnemyCharges` — today's `'enemy'`/`'all-enemies'` arm |
| "removes 1 charge from **that enemy**" (Zosimos, on-repair) | only the repairer | `removeChargesFrom(repairerId)` — the `everyNthEvent` arm |
| "removes 1 charge from **the highest attack enemy**" | Doomsayer 2 → 1, nobody else moves | **no path exists** |

Row 3 falls past the enemy arm entirely and lands on the owner-only *gain* branch at the bottom of
the `charge` block: the caster gains a charge and no enemy loses one. Wrong in both directions.

### The change

A new branch **above** the bulk arm at `triggers.ts:3499`. For the three selector targets, resolve
the single enemy through the same optional ctx delegates the reactive damage/debuff branches
already call — `ctx.enemyWithMostBuffs?.(ownerId)` and `ctx.enemyWithHighestSpeed?.(ownerId)`
(`triggers.ts:4829-4836`), `ctx.enemyWithHighestAttack?.(ownerId)` (`triggers.ts:3832`, declared
`:1924`) — then
`removeChargesFrom(resolvedId, cfg.amount, owner.attackerAffinity, ctx.bus)` — **never**
`removeEnemyCharges`, which would strip charges off three ships the clause never named.

Unresolved (no living candidate) → **NO-OP**, matching the SP-4c-2d precedent the purge branch
already sets. It must never fall through to the owner-gain arm below.

The once-per-round gate (`passesOncePerRoundGate`) and the once-per-attack guard
(`oncePerAttackGuardKey`) already sit ABOVE the `'enemy'`/`'all-enemies'` arm, so the new branch
inherits both unchanged. `everyNthEvent` is NOT replicated into the selector branch: it lives
*inside* the enemy arm and is keyed to `eventCtx.repairerId`, an on-repair-only concept ("every
second repair, decrease THAT enemy's charge"). A selector target names its own victim and has no
repairer, so the two are mutually exclusive by construction — state that in a comment rather than
carrying a dead combination.

### Coverage

Hand-authored fixture on the Doomsayer board above: assert the 9,000-attack enemy drops 2 → 1 and
the other three stay at 1. Also assert the NO-OP arm (all opposing actors dead / none resolvable)
does not bump the caster's charge.

### Explicitly out of scope

`parseChargeRemoval` is **not** taught "the highest attack enemy" — no corpus skill text carries
that clause, and inventing a regex for text nobody has is how dead parser branches accumulate. The
ability model gains the capability; the parser does not gain a producer for it.

---

## 4. Verification and risk

- **Fingerprints.** Section 2 changes `side` for three targets. Prediction: **zero**
  `realKitFingerprints` snapshot movement, because the path is unreachable. If a snapshot moves,
  that is a reachability DISCOVERY — audit what moved and why before accepting it, and never
  `vitest -u`.
- **Team symmetry** is by construction: all three `registerActorAbilityStatuses` call sites
  (`engine.ts:768`, `:2463`, `:2552`) share the one classifier, so player and enemy runtimes cannot
  diverge. Per `feedback_engine_team_symmetry`.
- **Gates:** full `npm test` (the golden audit spans the whole suite, not one file) plus
  `tsc --noEmit` — the `Record` totality is enforced only there, and `tsc` catches what vitest
  cannot.
- **Changelog:** none. Nothing user-visible changes. Sections 1–2 are unreachable today and
  Section 3 closes a hole no shipped ship can fall into. Per CLAUDE.md, skip entries for changes
  users would not notice.

## 5. Task order and dependencies

1. **Task 1** (measurement) first and alone. Its result gates everything else.
2. **Task 2** (classifier + three re-points) — independent of Task 3.
3. **Task 3** (selector charge removal) — independent of Task 2; touches a different branch of
   `triggers.ts`.

Tasks 2 and 3 can run in parallel worktrees. Task 1 cannot overlap with either: it must measure
pre-fix behaviour.
