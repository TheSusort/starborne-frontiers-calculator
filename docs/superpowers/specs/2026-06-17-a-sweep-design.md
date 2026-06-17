# Sub-project A — Cleanup Sweep — Design

**Date:** 2026-06-17
**Epic:** `2026-06-17-combat-realism-epic-roadmap.md` (sub-project A, closing sweep)
**Predecessors:** A1a, A1b, A2 (all shipped on `feat/combat-sim-phase5-pr2`)
**Status:** Design — user-approved 2026-06-17; pending spec review.

> Line numbers are 2026-06-17 snapshots. Re-locate by symbol, not offset.

## 1. Problem & goal

A1a/A1b/A2 shipped the dynamic effective-stats backbone. An audit of the remaining sub-project-A
items found **no functional gaps** — only A2-era transitional scaffolding to retire. This sweep
closes sub-project A by paying down that debt, **byte-identically**, then we move to sub-project B
(Stasis).

**Audit conclusions (B-items — confirmed, NO code change; recorded so they aren't re-investigated):**
- **damageReduction** — no Damage-Reduction buff exists in the corpus; it is derived from effective
  defence (`calculateDamageReduction(effectiveDefense)`), which is already dynamic via defence
  buffs. No separate dynamic path needed.
- **healModifier** — a standing per-actor modifier; the heal path already folds `outgoingHealBuff`
  + `incomingHealBuff` dynamically through `effectiveDamageStatsOf.totals`. No gap.
- **Affinity-disadvantage "non-hacking effects not applied"** — `resolveEnemyDebuffs`
  (`playerTurn.ts:301-332`) already enforces `isApply ? !affinityDisadvantage : roundDebuffLanded()`
  for recurring/aura debuffs, same rule as the timed path. No gap.
- **Canonical-stat routing** — every in-fight-dynamic stat (attack/defence/crit/critDamage/speed/
  hacking/security/defensePenetration) is routed through the snapshot. `hp` (no in-fight buffs),
  `hpRegen`/`shield` (no consumer), `shieldPenetration` (sub-project H) are intentionally out.

## 2. Scope (cleanup items)

Full sweep, all targeting **byte-identical** behavior:

- **A.1** — unify the duplicate live-landing read in `triggers.ts`.
- **A.2** — collapse the live-OR-static debuff-landing dual-source into a single producer.
- **A.3** — delete the dead legacy non-walked-team engine branch + its `sourceFired` carve-out.

## 3. A.1 — Unify the `triggers.ts` dual-read

Today the live debuff-landing chance is read two ways in `triggers.ts`:
- timed-application path: `owner.landsTimedEnemyApplication(cfg.application)` (~`:896`) — a closure
  that internally reads `runtime.liveDebuffLandingChance ?? debuffLandingChance`.
- DoT path: `owner.debuffLandingGate(owner.liveDebuffLandingChance ?? owner.debuffLandingChance)`
  (~`:932`) — a direct field read.

These access the same value through different patterns and could silently diverge if one site is
edited. Extract a single accessor (e.g. `actorLiveLandingChance(owner)` returning
`owner.liveDebuffLandingChance ?? owner.debuffLandingChance`) and call it from both sites. The
timed path keeps its `'apply'`-vs-`'inflict'` distinction (that lives in the closure, not the rate).
**Byte-identical, trivial.**

> Sequenced LAST and may simplify further once A.2 lands (if the static fallback is gone, the `??`
> chain collapses to just the live field). Implement A.1 against whatever state A.2 leaves.

## 4. A.2 — Collapse the live-OR-static landing fallback

**Today** (`playerTurn.ts:699-721`):
```
const liveLandingComputable = actor.stats.hacking !== undefined && enemy.stats.security !== undefined;
const liveLandingChance = liveLandingComputable
    ? liveDebuffLandingChance(statusEngine, selfBuffLookup, actor, enemy, affinityDamageModifier)
    : debuffLandingChance; // static threaded scalar
```
The static fallback is **dead in production** (A2 plumbed hacking/security bases onto every actor, so
all three callers — dpsSimulator, battleSimulator, healingEngineAdapter — make `liveLandingComputable`
true). It survives only in **test fixtures** that build base-less actors and pass an explicit
`debuffLandingChance`. The dual-source is a silent-divergence smell (holistic-review finding #4).

**Change:** make `liveDebuffLandingChance` the single producer, self-sufficient for base-less actors
by defaulting a missing **attacker hacking → 200** and missing **defender security → 100** (the exact
defaults the old static formula used: `dpsSimulator.ts:243-244`). Then:
- remove the `liveLandingComputable` ternary — the live recompute is unconditional;
- retire ONLY the bare threaded-scalar fallback at `engine.ts:1314` (the focus attacker's
  `attackerRuntime.liveDebuffLandingChance ?? debuffLandingChance`) and the `runtime.debuffLandingChance`
  field that backs it. **KEEP** `:532` (`runtime.liveDebuffLandingChance ?? e.debuffLandingChance ?? 1`)
  and `:1446` (`runtime.liveDebuffLandingChance ?? w.debuffLandingChance`) — these `??` chains fall
  back to the **retained public inputs** (enemy-attacker / walked-team), not the bare scalar, so they
  stay. `triggers.ts:932` reads `owner.liveDebuffLandingChance ?? owner.debuffLandingChance`; after
  A.2 the live field is always set, so the `??` tail is dead but harmless — A.1 unifies that read.

**Default placement (load-bearing):** the `?? 200`/`?? 100` default must live **inside
`liveDebuffLandingChance`**, NOT in `effectiveStatsOf` — `effectiveStatsOf` coerces a missing base to
`0` for ALL readers (attack/defence/etc.), and changing that would ripple. Because `effectiveStatsOf`
has already collapsed `undefined → 0 + buff`, `liveDebuffLandingChance` distinguishes "base absent"
from the raw `actor.stats.hacking`/`.security` and adds the 200/100 default to the folded buff total
when absent (so `base absent → 200 + buffTotal`; `base present → base + buffTotal`).

**Test-fixture conversion (the churn — byte-identical per fixture):** tests that pass an explicit
non-default `debuffLandingChance` on base-less actors must be converted to supply hacking/security
bases that reproduce that exact chance (e.g. chance 0.5 → `hacking 150, security 100`; chance 0 →
`hacking 100, security 100` or `hacking 0`). The conversion set is **4 fixtures, all in
`triggers.test.ts`** — the `debuffLandingChance: 0 / 0 / 0.5 / 0` cases on its base-less `baseInput`
focus actor. The plan enumerates them and verifies each keeps its assertion. `debuffLandingChance: 1`
fixtures need no change (live default 200−100 = 100%). **DO NOT** convert
`resistedEnemyDotsRoundEffects.test.ts` (or similar) — those pass `debuffLandingChance` on an
**EnemyAttacker** input, which §4 explicitly retains; they need no change.

**Retained:** the **walked-team** `walk.debuffLandingChance` (pre-derived per team actor by the
adapter) and the public `CombatEngineInput.enemyAttackers[].debuffLandingChance?` input stay as the
*inputs* feeding the bases/affinity — only the *runtime-internal* static-vs-live duality is removed.
(If, during implementation, those inputs prove fully redundant with the base plumbing, removing them
is in scope; if removal ripples into the public input contract, leave them and note it.)

## 5. A.3 — Delete the legacy non-walked-team branch

`engine.ts:3257-3335` is an `else if (actor.kind === 'team')` branch handling team actors WITHOUT a
walked runtime, including the `sourceFired` landing-hook carve-out (`:3287-3295`) that re-points the
hook to the attacker's closure (the carve-out exists ONLY because legacy team actors don't run
`runPlayerTurn`). The audit confirmed:
- **No production caller** reaches it — dpsSimulator + healingEngineAdapter both route teams through
  `deriveTeamEngineActors` (the walked branch at `:3257`'s preceding `if`); battleSimulator's
  enemy-side is unrelated.
- **No test** exercises the engine dispatch of this branch.
- All helpers it calls (`synthesizeResisted`, `advanceChargeCadence`, `landsTimedEnemyApplication`,
  `bus.emit('skill-fired')`) are SHARED with the focus/walked paths and MUST stay.

**Change:** delete the whole `else if` branch (~80 lines) + the carve-out. Zero type/helper removals.
Byte-identical (dead path). If deletion surfaces a now-unused symbol, remove it only if proven
unused.

## 6. Sequencing, gate, testing

- **Order:** A.3 (removes a fallback consumer) → A.2 (collapse) → A.1 (final unify; benefits from a
  simpler post-A.2 state).
- **Gate:** byte-identical. The ONLY permitted test changes are the A.2 fixture conversions, each
  hand-verified to reproduce its prior landing outcome (assert the same lands/resists counts). No
  combat `.snap` may move. Never blind `vitest -u`.
- **Risk:** A.1/A.3 are clean. A.2's risk is the fixture-conversion count — if the enumeration grows
  beyond the ~3 audited fixtures, surface it before churning. Default-placement (§4) is the one
  correctness subtlety; a parity assertion (`liveDebuffLandingChance(base-less, neutral) === old
  static`) locks it.
- `audit:skills` 0/141, lint + tsc clean. Subagent-driven; per-task spec + quality + final holistic.

## 7. References
- `src/utils/combat/triggers.ts` (~896, ~932) — A.1.
- `src/utils/combat/playerTurn.ts` (~699-721) — A.2 ternary; `effectiveStats.ts:119` (`liveDebuffLandingChance`).
- `src/utils/combat/engine.ts` (~3257-3335 legacy branch + ~3287-3295 carve-out; ~1314/~1446/~532 fallback chains; ~817/~1090/~1377 `debuffLandingChance` field/param) — A.2/A.3.
- Static formula being reproduced: `src/utils/calculators/dpsSimulator.ts:243-246`.
