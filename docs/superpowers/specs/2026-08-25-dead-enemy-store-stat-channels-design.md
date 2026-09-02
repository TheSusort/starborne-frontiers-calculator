# Dead enemy-store stat channels — design (#398)

**Status:** ruled, ready to plan
**Issue:** #398 (bycatch of #396; rung 3 of the store-axis ladder after #389 and #396)

## 1. The defect, measured

Five debuff families land, display, tick down and **change nothing**:

`Crit Rate Down I/II/III` · `Crit Power Down I/II/III` · `Speed Down I/II` · `Hacking Down I/II` ·
`Security Down I/II`

**Corpus reach: 17 ships.** Arum, Bayah, Curator, Guardian, Nayra, Provider (Crit Rate Down);
APEX, Bayah, Curator, Guardian, Nayra (Crit Power Down); Anjian, APEX, Bayah, Bizon, Flamel,
Iridium, Rys, Torcher, Xcellence (Speed Down); Provider (Hacking Down); Provider, Tygr
(Security Down).

### 1.1 The measurement (probe, 2026-08-25)

Three arms per channel, all a real `runCombat`: CONTROL (inert marker), ENEMY (payload at
`target: 'enemy'` → per-victim enemy store), SELF (identical payload on the victim's own passive
slot → self store). Store membership asserted off the LIVE status engine via
`__testTapStatusEngine`, so a null result cannot be "the status never landed" — which is exactly
how #398's first probe went blind (empty store, five meaningless zeros).

| Channel | In victim's enemy store? | Enemy-applied effect | Same payload, self-applied |
| --- | --- | --- | --- |
| `speed` | ✅ `Speed Down II` | turn order unchanged | order flips (500 → 250) |
| `crit` | ✅ `Crit Rate Down III` | 90,000 dmg / 3 crits | 30,000 dmg / **0 crits** |
| `critDamage` | ✅ `Crit Power Down III` | 90,000 dmg | 60,000 dmg |
| `hacking` | ✅ `Hacking Down II` | victim's debuff still lands | victim's debuff **fails** |
| `security` | ✅ `Security Up (probe)` | probe debuff still lands | probe debuff **fails** |

Every ENEMY arm proves presence-with-no-effect; every SELF arm proves the instrument can report
the opposite. This is not a blind zero.

### 1.2 Root cause

`foldActorBuffTotals` (`effectiveStats.ts:53`) reads exactly two sources:

1. `statusEngine.snapshot(actorId).activeSelfBuffs`, expanded through `selfBuffLookup`
2. `statusEngine.timedAbilityStatuses('self', actorId)`

The per-victim ENEMY store is not among them. The damage path
(`effectiveDamageStatsOf`) never calls `foldActorBuffTotals` at all — it folds
`scheduledTotals` + `abilitySelfEffects`, both self-sourced. So on both paths these five
`parsedEffects` keys are **dead on the enemy store**, exactly as the audit note at
`buffTotals.ts:204` (written by #396, one PR earlier) already recorded.

## 2. Why the symmetry work never caught it

**The bug is perfectly symmetric.** `foldActorBuffTotals` is keyed by `actorId` and reads the same
two sources regardless of side, so an enemy-applied `Speed Down` is equally dead on a player ship
and an enemy ship. A team-symmetry oracle asks "does the player side behave like the enemy side?"
and the honest answer is *yes, identically*. Symmetry oracles find asymmetries; this is a symmetric
absence. (`symmetry ≠ reachability`, the known vacuity trap — this is its cleanest instance.)

The symmetry work hardened the **side axis** (who *holds* the status). This defect lives on the
**store axis** (who *applied* it). #389 (attack/outgoingDamage) and #396 (defense/incomingDamage/
heal) were rungs 1 and 2 on that axis; both were found by hand-auditing store readers, never by an
oracle — which is why each rung only ever surfaced the channels somebody happened to enumerate.
The store axis has had no instrument at all. §6 adds one.

Three things kept the test suite quiet:

- `effectiveSpeed.test.ts`'s `timedSpeedStatus` helper **hardcodes `side: 'self'`** — the only
  speed-fold coverage in the repo never exercised the enemy direction.
- Every existing test of these five families asserts the debuff **lands**, never that it **does**
  anything. It genuinely does land. Green, deterministic, observing nothing.
- Symmetry coverage is per-side, not per-store, so nothing in the audit ledgers was positioned to
  ask the question.

## 3. Owner rulings (2026-08-25)

**R1 — all five are real.** An enemy-applied `Speed Down` really slips turn order; `Crit Rate/Power
Down` really cut crit rate and crit damage; `Hacking Down` really reduces the victim's own
debuff-landing chance and `Security Down` really raises how easily debuffs land on it. Fix all five.

**R2 — crit is folded PRE-CAP, and the cap may absorb it.** The debuff subtracts from the raw crit
total and the affinity cap applies on top. Owner's worked example: at affinity disadvantage
(cap 75, penalty 25) with 125% raw crit, a −25% Crit Rate Down leaves the ship *still* at 75%.
That is byte-identical to today's `min(cap, max(0, crit + critBuffTotal − penalty))`, so **no new
cap path is needed** — only the enemy-store term folded into `critBuffTotal`. Consequence, accepted:
Crit Rate Down is weak-to-inert against an over-capped ship.

**R3 — `security` is ONE stat with BOTH effects.** `Security Down` lowers debuff resistance *and*
proportionally reduces security-scaled damage (Prophet's "damage equal to 50x its security"; the
in-corpus matchup is Tygr's active inflicting `Security Down II` on Prophet). So `security` must
reach the damage basis as well as the landing roll.

**R4 — speed is live mid-round.** A `Speed Down` landing mid-round reorders the turns still to come
in that round, matching self-applied `Speed Up` today. The selection loop already re-reads effective
speed per step, so this is inherited for free.

**R5 — `hp` stays dead.** It is the sixth channel the #396 audit named, but **no `HP Down` /
`Max HP Down` family exists anywhere in `docs/ship-skills.csv`**, so there is no applier to switch
on. It goes on the tripwire's justified dead-list (§6), not into either fold.

## 4. The fix — two sites, per channel

`effectiveStats.ts` exposes two accessors with deliberately different fold semantics ("pick by
consumer"). A channel must be wired at every site its consumers actually read, and at no more than
those — projecting a channel that already has an enemy-store reader would DOUBLE-COUNT.

| Channel | Site A — `foldActorBuffTotals` (status mode) | Site B — turn-loop `shadowedDelta` → `scheduledTotals` (damage mode) |
| --- | --- | --- |
| `speed` | ✅ `foldSpeedBuffPct` → `effectiveSpeedOf` | ✗ the turn fold never consumes speed |
| `crit` | ✅ `effectiveStatsOf(...).crit` | ✅ `dmgStats.totals.critBuff` → `effectiveCrit` |
| `critDamage` | ✅ `effectiveStatsOf(...).critDamage` (engine.ts:8877 `sourceCritPower`) | ✅ `dmgStats.critDamage` |
| `hacking` | ✅ `liveDebuffLandingChance` (attacker fold) | ✗ landing runs solely through `liveDebuffLandingChance` |
| `security` | ✅ `liveDebuffLandingChance` (defender fold) | ✅ `dmgStats.security` → security-basis damage (R3) |
| `hp` | ✗ dead-list (R5) | ✗ dead-list (R5) |

**What must NOT be projected at Site A:** `attack`, `defence`, `outgoingDamage`, `incomingDamage`,
`incomingHeal`, `outgoingHeal`, `hpBuff`, `attackFlatBuff`. Each already has its own enemy-store
reader (`victimOwnEnemyFamilies`, `toEnemyModifiers`, `victimOwnEnemyHealModifiers`), and
`effectiveStatsOf(...).attack` / `.defence` are read at ~20 sites in `engine.ts`. Widening
`foldActorBuffTotals` wholesale is the single biggest hazard in this change.

### 4.1 Shadowing is mandatory, not optional

Switching on a dead channel without shadowing makes a self-inflicted and an enemy-applied instance
of one family **add**, which the locked ruling forbids (highest tier wins across the self/enemy
boundary; only DoTs and bombs stack, and `deriveFamilyKey` already excludes those by giving each
tier its own key). So every newly-live channel joins `SHADOW_CHANNELS` and both folds go through
`shadowedDelta`, reusing #396's machinery unchanged — `familiesOf` indexes
`b.parsedEffects[channel]` generically, and all five names are already `ParsedBuffEffects` keys, so
no new extraction code is required.

### 4.2 No freshness fence is needed

`PlayerRoundCtx` publishes `effectiveAttack`, `dotMult`, `affinityMult`, `effectiveDefence`,
`effectiveMaxHp` and the heal channels — **none of the five**. Every cross-actor reader of these
five goes through `effectiveStatsOf` or `liveDebuffLandingChance`, which are live reads by
construction. #367's hardest half (`liveHealChannelPct`, the published-ctx staleness fence) has no
analogue here, and adding one would be dead code.

### 4.3 Flat vs percentage

`hacking` and `security` are FLAT additive (`ParsedBuffEffects` comments; `effectiveStatsOf` does
`base + hackingBuff`), unlike the percentage channels. `ChannelContribution`'s fields are documented
as "percentage points". The shadowing arithmetic is a pure magnitude comparison and is unit-agnostic,
so it is correct as-is — but the doc comments must be widened to say "percentage points, or flat
units for `hacking`/`security`", or the next reader will believe the wrong thing.

### 4.4 Import direction

Site A lives in `effectiveStats.ts`; the enemy-store reader `victimOwnEnemyFamilies` lives in
`triggers.ts`. `triggers.ts` does not import `effectiveStats.ts` today, but it is a large module
with a wide import surface. Preferred outcome: import directly and let `tsc` confirm. If a cycle
appears, extract `victimOwnEnemyFamilies` + `NEUTRAL_NAMES_CTX` into a new
`src/utils/combat/enemyAppliedFamilies.ts` and re-export from `triggers.ts` so no call site
changes. **One reader, not two** — a second hand-rolled enemy-store read that diverges on the
aura branch is precisely how rung 4 gets created.

## 5. The double-count hazard, and its instrument

`crit`, `critDamage` and `security` are wired at BOTH sites. The risk is a consumer that sums a
Site-A number and a Site-B number for the same actor and channel, yielding twice the applied value.
This is the `two-paths-one-answer` class: a fix verified on one path can be silently doubled on the
other, and a revert that reddens nothing means a second path.

**Instrument:** magnitude assertions, not presence assertions. With `Crit Rate Down III` (−30)
applied and no self-side instance, the observed crit must be `base − 30`, never `base − 60`. Same
shape for `critDamage` and `security`. A doubling is then a hard failure rather than a plausible
number.

## 6. The tripwire (folded into this PR at owner request)

The store axis has never had an instrument, which is why three rungs of the same ladder shipped
separately. Replace "somebody remembers to audit" with a gate.

**New locked rule, stated alongside the side rule rather than inside it:**

> A status's effect does not depend on which side applied it. The side axis (who holds it) and the
> store axis (who applied it) are independent, and a rule proven on one says nothing about the
> other.

**New test** — walks every `ParsedBuffEffects` key and asserts each is either (a) reachable from the
per-victim enemy store through some live reader, or (b) on an explicit dead-list with a written
justification. Fails the moment a channel is added without wiring the enemy side.

Dead-list at merge time, each with its reason:

- `hp` — no `HP Down`/`Max HP Down` family exists in the corpus (R5).
- `hotPct`, `attackFlat`, `attackFlatPctOfCaster` — grant-shaped, self-side only by construction.
- `dotDamage`, `detonationDamage`, `defensePenetration` — read from the attacker's self/attacker
  list only; no enemy-store meeting point (per the #396 audit).
- `incomingDotDamage` — read from the enemy list only, never from a self list, so it has no
  cross-store meeting point and needs no shadowing.

## 7. Out of scope

- The residual picker gap inherited from #389/#396: a debuff ticked by hand in the calculator's
  ENEMY-DEBUFF PICKER writes only the global `__enemy__` bucket and still has no arithmetic effect.
  Unchanged here; the straddle fixtures must be built from buff LISTS, not ship kits.
- `#399` (`enemy-highest-attack` missing from the store-side target list) — adjacent and also a
  store-axis defect, but a separate registration bug with its own issue.

## 8. Definition of done

1. All five channels move their observable when enemy-applied, on **both** sides of the board.
2. Magnitude, not just presence: applied value once, never doubled.
3. Cross-store shadowing holds per named family on every newly-live channel, both directions
   (applied wins / own wins).
4. The tripwire test exists and fails when a channel is unwired.
5. `docs/ship-skills.csv`-grounded corpus claim recorded for each family's timed-vs-aura shape.
6. `UNRELEASED_CHANGES` entry in `src/constants/changelog.ts` — this is user-visible.
7. Full `npm test` green; `npx tsc --noEmit` clean.

## 9. Addendum — the gate-estimate ordering approximation (found during planning)

`#396`'s late-fold site (`playerTurn.ts:~2711`) justifies itself with: *"Nothing between the early
site and here reads `attackBuff`, `outgoingDamageBuff`, `incomingHealBuff` or `outgoingHealBuff`."*
**For crit that sentence is false.** Two staged estimates read the crit channels earlier:

- `critBuffForGates` — initialised from `scheduledTotals.critBuff` at `:1859`, `+=`'d with
  layers 2+3 at `:2539`, and consumed as `cappedCrit(critBuffForGates)` at `:1987`, `:2445`
  and `:2566`.
- `critDamageForGates` — initialised at `:1866` and consumed as `selfCritPower` at `:2014`,
  `:2610` and `:2917`.

All six reads happen BEFORE the late fold, so folding the enemy-applied crit/critDamage delta there
leaves those estimates on the un-debuffed value.

**Resolution: fold late anyway, and document it as the same approximation those estimates already
carry.** Rationale:

- Folding EARLY is not available: the shadowing comparison needs `abilitySelfEffects`, which does
  not exist at `:1859`. That is precisely why #396 moved the heal pair down.
- These estimates are already documented partial folds that **exclude layer 4**
  (`modifierAbilities`) for self-referential-gate avoidance. Excluding the enemy-applied layer too
  is consistent, not a new class of inaccuracy.
- The impact is second-order: `ConditionContext.effectiveCritRate` is consumed at
  `evaluateConditions.ts:221` as a **crit probability** fallback, not as a threshold gate, and
  `selfCritPower` feeds Wildfire's dotDamage scaling.
- The authoritative post-fold value IS correct everywhere it matters: `effectiveCrit` /
  `dmgStats.critDamage` drive the actual crit rolls and damage, and the ctx at `:2890` publishes
  `effectiveCritRate: effectiveCrit` — the final number.

**Required:** amend the late-fold comment so it no longer claims nothing reads these channels in
between, and name the six sites. Leaving that stale sentence in place is how the next reader
concludes the fold is exact when it is not. If exactness is later wanted, it needs a second staged
`+=` after the fold and re-derived ctxs — a separate change, not this one.

## 10. Locked rules established by this change

**THE STORE-AXIS RULE (new, locked).** Stated alongside the side rule, deliberately not inside it:

> A status's effect does not depend on which side APPLIED it. The SIDE axis (who HOLDS the status —
> player ship vs enemy ship) and the STORE axis (who APPLIED it — the holder's own SELF store vs the
> per-victim ENEMY store) are INDEPENDENT. A rule proven on one axis says NOTHING about the other.

Enforced by `src/utils/combat/__tests__/enemyStoreChannelCoverage.test.ts`.

**Corollary, for review and triage:** never answer "could this have escaped our coverage?" by
citing symmetry work. Ask which AXIS the coverage ran on. A store-axis defect is symmetric by
construction, so every symmetry oracle reports clean on it.

### The rulings, restated as one-liners

- **R1** — all five families really work in-game; fix all five.
- **R2** — crit folds PRE-CAP; the affinity cap may absorb the debuff entirely. No new cap path.
- **R3** — `security` is ONE stat with BOTH effects: debuff resistance AND security-scaled damage.
- **R4** — a speed change is live MID-ROUND, reordering the turns still to come, as self-applied
  speed already does.
- **R5** — `hp` stays dead: no `HP Down`/`Max HP Down` family exists in the corpus.

### Corpus claim (verified 2026-08-25, abbreviation-masked)

All five families: **26 clauses across 17 ships, 100% carrying an explicit "for N turns"** — every
occurrence is TIMED, so the aura/accumulating branch is corpus-unreachable and its NEUTRAL-ctx
approximation cannot bite. Mask `Inc.`/`Out.` before sentence-splitting if you re-derive this; an
unmasked split falsely reports Bayah's second passive as duration-less.

### Audited snapshot moves

- **Tygr** loses `attack:charged`. Its `Security Down II` now genuinely lowers enemy security, so
  resisted debuffs collapse 18 → 3, landed debuffs rise 9 → 23, Stasis applications 7 → 12, and
  total damage 309,703 → 354,701. The token vanishes only because `:slot` is single-use per cast
  (`consumePendingSkill` reads-and-clears): with Stasis now landing on every charged cast, the
  debuff clause always wins the tag and the attack entry logs bare. The charged attack still happens.
- **Guardian** loses `buff`/`buff-expired`. Its second passive grants `Binderburg Resilience` when
  critically hit, and its own `Crit Rate Down II` now lowers the enemy's crit rate. Measured: round
  4 took 158 damage before and 147 after, every other round 147 in both — exactly one crit, now
  prevented, so the passive never fires. A tank's crit debuff now protects it, which is the point.
