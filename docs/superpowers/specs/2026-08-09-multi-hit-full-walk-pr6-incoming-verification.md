# PR6 — incoming-side verification sweep + carried-forward residues

**Date:** 2026-08-09
**Epic:** `2026-08-07-multi-hit-full-walk-attacks-design.md`
**Status:** design approved, pending implementation plan
**Predecessors:** PR1 `d3131c6c` · PR2 `7829f531` · PR4 `c6379523` · PR7 `4adb4908` · PR5 `a607d59b` (#312)
**Successor:** `2026-08-09-multi-hit-full-walk-pr8-debuff-per-subattack.md`

---

## 1. What this PR is for

The epic's §6 describes PR6 as "confirm the incoming side already satisfies R1 — verify, do not
assume." Two things have changed since that was written.

**The MIXED-AoE question is closed.** The epic's status notes said PR6 must put it to the user.
It was already ruled on 2026-08-08: a damage-proportional effect scales off the WHOLE sub-attack's
delivered damage, including a non-critting victim's share — "RULED FINE AS SHIPPED, do not
re-open." That is what #311 ships. PR6 therefore carries **no game-rule question**.

**The scope is wider than "does Cultivator's passive fire N times."** Decided 2026-08-09: PR6
sweeps three incoming tiers on both sides, fixes what it finds, and closes the epic's four
carried-forward items. The one finding it is expected to record rather than fix — debuff arrival
being once-per-cast — is PR8's charter.

### Why this is a real result and not a null one

A reading of `emitAttacked.ts`, `emitPerVictimAttacked.ts` and `triggers.ts:828`/`:943` says the
incoming machinery is already correct: `attacked` is emitted once per hit per victim,
`subAttackIndex` is stamped on every event (`emitAttacked.ts:64`), the `on-attacked` /
`on-ally-attacked` listeners are enqueue-per-event with no once-per-turn collapse, and the
once-per-attack guard keys (`triggers.ts:2438`, `:3752`) already carry the sub-attack index.

**Nothing in the corpus exercises any of it.** Enforcer is the only ship with `hits > 1`, so a
green `npm test` proves nothing about the incoming side under multi-hit. The value of this PR is
converting "looks correct on inspection" into "pinned by fixtures that go red if it stops being
correct." That is the same gap the epic's own §7 flags: goldens are synthetic and the real-kit
suite is focus-actor-only.

---

## 2. The three tiers

Every tier is measured **on both sides**: Enforcer as the player-side focus actor, and Enforcer as
an enemy attacker into the player team. This is not optional — the epic's §7 makes team symmetry
mandatory, and the enemy path is the one that has silently dropped a mechanic twice (#305, #306).

### Tier 1 — incoming reactives fire per hit

The R1 claim named in the epic. Assert **exact** counts: 3 firings on Enforcer's active, 4 on her
charged. Not "more than one."

| Ability | Trigger | What must fire N times |
| --- | --- | --- |
| Cultivator's passive | `on-ally-attacked` | the design doc's named R1 example |
| Reactive Ward | `on-attacked` | implant, per-hit grant |
| Tenacity | `on-attacked` | **plus its damage gate — see below** |
| Second Wind | `on-attacked` | implant |
| Adaptive Plating | `on-attacked` | implant |
| Smokescreen | `on-attacked` | implant |
| Bulwark | `on-ally-attacked` | includes `requireDamagedAllyAdjacent` |

**Tenacity's gate is the sharpest test in this tier.** `requireIncomingDamageFracOfMaxHp`
(`triggers.ts:840`) reads `e.damage` — the sub-attack's own slice since PR2's regrouping, where it
was previously fed the victim's cast-wide aggregate. A gate phrased "in one hit" was being handed N
hits' worth. The fixture must be built so the two bases give *different verdicts*: the cast total
clears 25% of max HP but no single sub-attack does, so the gate must NOT fire. A fixture where both
bases agree measures nothing.

Also assert the drop-out story `emitPerVictimAttacked`'s docstring claims: a victim killed on
sub-attack 1 collects fewer `attacked` events than the cast's hit count, and its on-hit reactives
do not over-fire.

### Tier 2 — the incoming damage funnel resolves per sub-attack

This tier exists because the funnel is where the per-victim accounting defect class lives — #247–
#249 and #293 found it there, and PR7 found it again in `deliveredDamage`'s Protection handling.

Verify each of these runs per sub-attack rather than once per cast, with a both-sides fixture:

- **Shield absorb** — each sub-attack's damage hits the pool in sequence; a pool that breaks on
  sub-attack 2 leaves sub-attacks 1–2 partly absorbed and 3 fully through.
- **Protection redirect** — the redirect decision is re-made per sub-attack, and the protector's
  own booked damage sums to the redirected total across all N.
- **Incoming-block proc** — the block roll is drawn per sub-attack, not once per cast.
- **DoT transform** (Voron/Orel, Hit Mitigation) — transforms per sub-attack, and (per the locked
  damage-dealt rule) the transformed portion is excluded from `deliveredDamage` for each.
- **Damage reflection** — reflects N times, each off its own sub-attack's damage.
- **Counterattacks** — fire per sub-attack, subject to their own once-per-attack guards now that
  those guards are keyed by `subAttackIndex`.

### Tier 3 — debuff arrival

`on-debuffed` (Firewall) and `on-debuff-resisted` (Lockdown).

**Expected finding: fires once per cast, not N times.** Direct debuff clauses still land once per
cast because PR3 was dropped, and everything downstream of application inherits that cardinality.
PR6 does **not** fix this. It records it with a test that pins the *current* behaviour and is
explicitly labelled as such, so PR8 flips exactly that assertion and nothing else. Labelling
matters: a test whose title blesses a regression is worse than no test, so the title must say it
pins pre-PR8 behaviour.

PR6 must also produce the measurement PR8 needs: the exact corpus set of ships with `hits > 1`
crossed against direct (non-reactive) debuff clauses, via a throwaway vitest walking
`docs/ship-skills.csv` through `buildShipAbilities`. The epic's standing claim is that this set is
empty apart from Enforcer, whose shred is an `on-crit` reactive PR2 already fixed. **Re-measure it
against merged HEAD rather than inheriting it** — PR3's premise was void precisely because a
runtime claim was carried forward untested.

---

## 3. The four carried-forward residues

All four are fixed in PR6. None block R1; three are fragility, one is a genuine bug.

### 3.1 Burner's zero-delivery Inferno — a real bug

`triggers.ts:498` guards the `on-deal-damage` listener with `if ((e.damage ?? 0) <= 0) return;`.
`e.damage` is the **display** basis — `playerTurn`'s `directDamage`, computed once per cast against
the anchor's defence profile, blind to the funnel. So a sub-attack that delivered nothing (fully
absorbed by a shield, fully DoT-transformed) still lands an Inferno stack.

PR7 already built the correct field. Fix:

```ts
if ((e.deliveredDamage ?? e.damage ?? 0) <= 0) return;
```

`deliveredDamage` is emitted only on the interleaved positional path, so the `??` chain keeps the
DPS path byte-identical — it has no funnel and nothing to disagree about. Riders affected: Burner's
Inferno, Warpstrike's duration-reduction, Zeolite's purge.

Anti-vacuity requirement: the fixture must have a sub-attack whose *display* damage is positive and
whose *delivered* damage is zero. If the two agree, the test passes under both the old and new
guard and proves nothing.

### 3.2 Zero-amount reactive-heal log row

A zero-basis heal emits `reactive-heal-performed` with `amount: 0`, producing a combat-log row for
a heal that healed nothing. PR7 left it because a guard reaches every reactive heal summing to
zero. Fix: suppress the emission when the computed amount is 0.

Golden churn is expected here and is the point — the rows should not exist. Every removed row must
be individually accounted for in the PR body. Note the event keys the caster as `casterId`, not
`actorId`.

### 3.3 The R5 whiff guard

PR5 documented that its emit loop is safe from whiffed sub-attacks only by accident: the
`forceDetonateBomb` leg is protected because `engine.ts:6452` leaves `targetId` unset for the
dummy-enemy case, and that site's own comment flags the omission as something a future change may
"fix." Build the real guard so a sub-attack that delivered nothing is skipped intentionally, and
remove the `WARNING` at the derivation.

The guard cannot be reached through a production cast today — that is PR5's whole point — so it is
tested at the unit level of the emit loop, by constructing a whiffed sub-attack directly and
asserting the loop skips it. An integration test would pass vacuously. State that explicitly in the
test's docstring so a future reader does not "upgrade" it to an integration test and quietly lose
the coverage.

### 3.4 Target-less combat-log rows

A future multi-hit ship with no targeting data would emit inline inside `battleSimulator`,
producing N target-less rows. Unreachable today only because Enforcer has `front / Pattern-Base`
and `battleSimulator.ts:772` resolves `chargedTargeting: targeting.charged ?? targeting.active`,
covering her empty charged columns. Guard the inline emit so the rows cannot be produced.

---

## 4. Fixture rules

This epic has shipped three vacuous fixtures — green, deterministic, observing nothing. Each tier's
tests must satisfy all of the following, and the plan must state them per test:

1. **Name the field pinned.** Prefer a direct pin (`heals[i] === deliveredDamage[i] * pct`) over a
   ratio, which pins a proportion but no particular field.
2. **State an anti-vacuity precondition** the fixture actually satisfies — the two candidate values
   must differ in this fixture. An assertion that holds under both the old and new behaviour is not
   a test of the change.
3. **Route to the right event.** Reactive heals emit `reactive-heal-performed`, not
   `heal-performed` (`events.ts:245`), keyed by `casterId`. Subscribing to the wrong one asserts
   against an empty array and passes.
4. **Check which surface the fixture reaches.** `simulateDPS` never sets `ctx.healing`, so a heal
   driven through it never drains. Trace the executor gate; do not assume two adapters over one
   engine imply two adapters over one executor.
5. **Column 4 is the front**, not column 1. `perTargetDamage` cannot see selection-side reads.
   Passive-slot on-cast self-buffs do not apply.
6. **`attackSkill(hits)` deals N×** in the sim integration fixtures — it passes a fixed
   `multiplier: 100` *plus* `hits`. Any assertion of the form `three[0] ≈ one[0]/3` is wrong.

---

## 5. Verification gates

- `npm run audit:placement-symmetry` at **K=15**, count recorded in the PR body. Baseline: **2
  findings / 146 symmetric / 13-13-13**. The 2 are Enforcer `debuff-resisted` and are RNG noise —
  they survived PR2, PR4 and PR5 unchanged. A third finding is a regression.
- Full suite green at **every commit boundary**. `.husky/pre-commit` runs
  `lint-staged && tsc --noEmit && npm test -- --run` and is the only test gate — there is no CI test
  workflow. A behaviour change and the test sweep it invalidates must land in the **same commit**;
  a plan that splits them cannot execute.
- **N=1 invariant**, asserted explicitly: no golden may move for a single-hit ship. The one
  exception is §3.2's zero-amount heal rows, which are enumerated individually.
- `tsc --noEmit` clean — it has caught three type holes in this epic that a green vitest did not.
  Note it does **not** cover `scripts/`.
- `npm run audit` clean.
- Comment sweep covering **production files and `__tests__` alike**, starting with the changed file
  itself. A sweep scoped to test directories misses the block comment 14 lines above the changed
  code; a sweep excluding `__tests__` misses docstrings that stay green forever while asserting the
  opposite of the shipped behaviour.
- Changelog entry in `UNRELEASED_CHANGES` for §3.1 and §3.2 (user-visible). Verify which surface
  each reaches before writing it — this epic's changelog has been wrong twice on exactly that.

---

## 6. Out of scope

- Debuff application per sub-attack — that is PR8.
- The mixed-AoE basis question — closed 2026-08-08, do not re-open.
- Incoming-side *proc granularity* as a design question (epic §2) — per-hit is correct; this PR
  verifies the implementation matches, it does not revisit the rule.
- The Exposed 2-stack rule and the bomb death-splash question — independent open items.
