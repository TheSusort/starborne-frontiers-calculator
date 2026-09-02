# Enemy-side heal-channel audit — design

**Issues:** #367 (enemy-applied `Inc. Repair Down` reduces nothing) · #369 (repair-over-time never
ticks enemy-side)
**Date:** 2026-08-23
**Status:** approved, ready for planning

Both issues are the same defect class: **a heal-modifying channel wired in one direction only.**
They are fixed together because a single enemy-side heal-path audit covers both, and because the
two fixes touch overlapping code (`tickHot` reads the very value #367 repairs).

Neither was introduced by #362 (Reversed Repairs); #362 restructured all nine
`applyHealToTarget` sites and so was the first thing that needed an enemy-side heal to exist.

---

## 1. Locked game rulings

Both obtained from the owner on 2026-08-23. Do not re-derive these from code or from a sibling
ship — they are rulings, not inferences.

### R1 — How incoming-repair modifiers combine (the fold rule)

Buffs and debuffs that are **not stackable, and share a name family, overwrite each other by
highest tier.** Surviving entries then combine **additively**.

Worked example, as ruled:

> Round 3. Zosimos is about to repair the tank for 5,000. The tank carries `Inc. Repair Up II`
> (+50%) from its own support, `Inc. Repair Down II` (−50%) from enemy Larkspur, and
> `Inc. Repair Down I` (−25%) from enemy Ripper.
>
> `Inc. Repair Down I` **does not apply at all** — an `Inc. Repair Down II` is already active on
> the family, and the higher tier wins. What remains is `+50 − 50 = 0%`.
>
> **Final repair: 5,000.**

Consequence for the implementation: **no new tier logic is needed.** The status engine already
family-keys and tier-upserts (`deriveFamilyKey`, `statusEngine.ts:351`; per-victim enemy maps at
`statusEngine.ts:598`), so tier shadowing happens at application time, before any fold. The fold
this spec adds stays a plain additive sum over whatever survived the store.

### R2 — A Repair-Over-Time tick is not a "performed repair"

A HoT tick restores HP but fires **no** on-repaired trigger. An `on-enemy-repaired` rider
(Overload / Ruiner's Bomb / Sansi shape) does **not** fire off a tick, and a Zosimos-style "every
second repair" counter does not count one.

This is already the engine's behaviour on **both** sides — `tickHot` emits no `heal-performed`
and does not set `repairedThisRound`. So R2 is a *fence*, not a change: lifting the enemy-side
gate must not start emitting the event. Keep the HoT block free of `heal-performed`.

---

## 2. What is actually broken

### 2.1 #367 — the incoming-heal fold reads only self-side stores

`Inc. Repair Down I/II/III` are documented as −25/−50/−75% **incoming** repair
(`src/constants/buffs.ts:494-506`), and the buff parser produces the right effect:
`buffParser.ts:49-50` maps `-50% Incoming Repair` → `parsedEffects.incomingHeal = -50`. The
status is applied, is displayed on the victim, and has **no arithmetic effect whatsoever** when
an enemy applies it.

The reduction reaches a repair through exactly two values, and **both are self-side only**:

| Reader | Value | Why it is self-side |
|---|---|---|
| `playerTurn.ts:3930` `incomingPctFor(rid)`, `rid === actor.id` arm | `dmgStats.totals.incomingHealBuff` | Built by `effectiveStats.ts:80` as `scheduled + timed`, both from the actor's OWN status lists |
| `playerTurn.ts:3930` `incomingPctFor(rid)`, other-recipient arm | `healing.recipientIncomingHealPct(rid)` → `engine.ts:3329-3332` | `lastTurnCtxByActor.…incomingHealPct` (the published self-side fold) `??` `preFight.incomingHeal` (a pre-fight self modifier) |

An enemy-applied debuff lands in the status engine's **per-victim enemy store**, keyed on the
victim (`enemyMaps`, `statusEngine.ts:598`). Nothing on the incoming-heal path reads that store.

Confirmed by reading the snapshot call: `playerTurn.ts:1747` is
`statusEngine.snapshot(actor.id)` — `ownerId = actor.id`, `enemyTargetId` omitted, so it defaults
to `DEFAULT_ENEMY_TARGET`. `entry.activeEnemyDebuffs` is therefore the **global `__enemy__`
bucket** (what this side has inflicted on the generic enemy target), *not* the debuffs inflicted
**on** this actor. The actor's own enemy-applied store is never consulted anywhere in the turn.

**Ships affected — 8, not the 6 the issue lists.** Verified by parsing `docs/ship-skills.csv`
(149 records) rather than trusting the issue body:

| Ship | Tiers inflicted |
|---|---|
| Amartya | II |
| Larkspur | II, III |
| LeSabre | II |
| Ripper | II, III |
| Ruiner | II |
| **Sansi** | III |
| **Sha Xing** | II, III |
| Shashou | I, II |

`Sansi` and `Sha Xing` are missing from #367's list. Correct the issue when this ships.

For reference, the friendly twin `Inc. Repair Up III` has exactly one corpus granter
(`Meatshield`), so R1's mixed-sign case is reachable in a real fight only via Meatshield.

### 2.2 #369 — the HoT block does not execute enemy-side

HoT ticking is wrapped in a single gate:

```
src/utils/combat/playerTurn.ts:4150
if (!healEventOnly) {
    // (a) payload-carrying ability HoT statuses on this holder
    // (b) scheduled snapshot HoTs
}
```

and `healEventOnly` is hard-wired per side (`engine.ts:7829` `false` for the player walk,
`engine.ts:7849` `true` for the enemy walk). An enemy ship carrying a Repair Over Time status
never receives a tick — the block does not run.

**The gate is a deliberate patch, not an oversight.** `enemyActions.test.ts:590-602` records
why: the HoT pre-loop credits `hotHeal` and, when the holder is the heal anchor, applies HP.
In event-only mode a HoT-carrying **enemy** would have credited the **player** healing map under
its own id and could have mutated the tank's HP. Suppressing the whole block was the cheap fix.
So the correct repair is not "delete the gate" — it is **splitting the two concerns the gate
conflates**: *tick the holder's HP* (belongs on both sides) versus *credit the player healing
buckets* (player-side only).

**A second, side-independent limit.** Inside `tickHot` (`playerTurn.ts:4133`):

```
if (actor.id !== healing.targetId) {
    healing.credit(creditId, 'hotHeal', raw);
    return;                    // <- no HP ever applied
}
```

A holder that is not the heal anchor is credited but never pool-applied. Because the anchor is
always player-side, this blocks the enemy fix *and* means a **player** ally that is not the
anchor never gains its Repair Over Time HP either. In scope (owner-approved).

**Corpus reach:** `Repair Over Time` is granted by `Flamel` (I, II), `Graphite` (III) and
`Oleander` (II). All three can appear on the enemy side, so every enemy fight involving one is
currently simulated with the enemy healing less than it should — player DPS and clear-time
estimates come out optimistic.

### 2.3 `Out. Repair Down II` — the same bug, outgoing

`outgoingHealBuff` (`buffTotals.ts:32-34`) is a self-side fold exactly like `incomingHealBuff`.
An enemy-applied `Out. Repair Down II` on your healer therefore reduces nothing, by the same
mechanism. Corpus appliers: `Nayra`, `Ruiner`.

Owner approved fixing this in the same helper rather than opening a separate issue: it is one
additional channel on a fold that has to be written anyway.

---

## 3. The fix

### 3.1 One fold point, reaching five readers

The naive fix patches `recipientIncomingHealPct` (`engine.ts:3329`) and stops. That is wrong —
it misses every path that routes through the actor's own local total instead:

1. `incomingPctFor`, self arm (`playerTurn.ts:3930-3933`) — a ship repairing **itself**
2. `holderIncomingFactor` (`playerTurn.ts:4105`) — every HoT tick
3. `triggers.ts:4045` — the reactive-heal path (`ownerCtx?.incomingHealPct ?? preFight`)
4. cast heals at `playerTurn.ts:4270` and `:4330`
5. `recipientIncomingHealPct` itself

The lever that reaches all of them: **`playerTurn.ts:4619` publishes
`incomingHealPct: dmgStats.totals.incomingHealBuff` into `lastTurnCtxByActor`, and that published
value *is* the first arm of `recipientIncomingHealPct`.** Folding the enemy-applied term into the
actor's own turn total therefore feeds every reader above from a single place.

**Design:**

- Add an engine-side helper — working name `victimHealModifiers(victimId)` — returning
  `{ incomingHealPct, outgoingHealPct }`, the enemy-applied terms only.
  It mirrors `victimIncomingModifiers` (`engine.ts:6976`), the established per-victim fold that
  already reads both sides' stores via `victimEnemyBuffs` (`triggers.ts:2559`). Reuse
  `victimEnemyBuffs` rather than hand-rolling a status-engine read, so the modifier read and the
  name read stay in lockstep — the invariant that function's jsdoc exists to protect.
- Thread the two values into the turn (a new arg alongside `preFight`, engine-computed) and add
  them into the actor's `scheduledTotals.incomingHealBuff` / `outgoingHealBuff` at the same seam
  that already folds `preFight.incomingHeal` (`playerTurn.ts:1789`). One fold, five readers.
- Keep the fold **additive** over what the store returned (R1: tier shadowing already happened).

### 3.2 The double-count trap — fence it explicitly

Once the enemy-applied term is inside the published ctx, adding it **again** in
`recipientIncomingHealPct` double-counts. It belongs **only on that function's fallback arm**:

```
recipientIncomingHealPct = (id) =>
    lastTurnCtxByActor.get(id)?.incomingHealPct          // already includes the enemy term
    ?? (allActorsById.get(id)?.preFight?.incomingHeal ?? 0)
       + victimHealModifiers(id).incomingHealPct         // pre-first-turn arm ONLY
```

Note the precedence: the enemy term is added **outside** the `??` chain's first arm, so it
applies when and only when no ctx exists.

> **SUPERSEDED DURING IMPLEMENTATION — read this before trusting the sketch above.** The shipped
> shape is not a plain ctx-or-fallback. Two corrections were found after this spec was written:
>
> 1. **The `??` rationale in this section was wrong.** `??` is nullish coalescing — `0 ?? x` is
>    `0`, so it does NOT fall through on a legitimate zero. That is `||` behaviour. The shipped
>    code still writes the branch out explicitly, but because the two arms are *asymmetric in what
>    they add*, not because `??` was unsafe.
> 2. **A ctx is only as fresh as its actor's last turn**, which this section does not consider at
>    all. When the applier is SLOWER than the victim, the debuff lands *after* the victim's turn
>    and a repair later that same round reads a ctx that predates it — so a one-turn
>    `Inc. Repair Down` (Larkspur, Ripper, Sha Xing; Sansi's `III`) could expire having reduced
>    nothing. The fix is `liveHealChannelPct` (`src/utils/combat/triggers.ts`), which on the
>    ctx-present arm computes `ctx[channel] − (ctx.enemyAppliedXPct ?? 0) + live`: it subtracts the
>    ctx's own published enemy-applied portion and re-adds a live read. The subtraction cancels by
>    construction, because the published field carries exactly the number the fold consumed.
>
> The pre-first-turn arm below is still real and still needed; it is now one of two arms rather
> than the only place the term enters.

That fallback arm is not a formality: it is a **real hole**. Seven of the eight appliers inflict
from a damage clause, which can land in round 1 **before the victim has taken a turn**, so no ctx
exists yet and the term would otherwise be silently dropped for that window. The fix must cover
it, and a test must pin it (a round-1 repair on a victim debuffed before its first turn).

A test must also pin the *absence* of double-counting: the same debuff, read after the victim has
acted, must reduce by −50% and not −100%.

### 3.3 #369 — the E5 heal-lift, applied to the HoT block

The enemy cast-heal arm at `playerTurn.ts:4256` already does exactly what the HoT block needs:
it performs the real effect on each recipient's own `currentHp` via `recipientActor(rid)` +
`applyHealToTarget`, and credits no player bucket. That is the canonical enemy-side-lift template
(E5 §4.1). Apply it here:

- Run the HoT block on **both** sides — remove the `if (!healEventOnly)` wrapper at
  `playerTurn.ts:4150`.
- Inside `tickHot`, replace the anchor-only application with a per-holder application:
  resolve `healing.recipientActor(actor.id)` and call
  `healing.applyHealToTarget(raw, holderActor, creditId)`. This removes the
  `actor.id !== healing.targetId` early-return, which is what fixes the player-side non-anchor
  case at the same time.
- Gate **only** the `healing.credit(...)` / `creditRecipient(...)` calls on `!healEventOnly`.
  An enemy HoT tick moves HP and contributes nothing to the player healing buckets.
- Emit **no** `heal-performed` and do not set `repairedThisRound` (R2).
- Preserve the existing reversal handling: `applyHealToTarget` already returns
  `{ reversed, consumed, overheal }`, and a reversed tick must still book no gross credit
  (#362 R10′).
- Preserve the strict applier-max-HP rule: a foreign applier with no ctx yet still **skips** the
  tick (`hotApplierMaxHp` returning `undefined`), with no base-stat fallback.

**Expected churn:** healing goldens move, because off-anchor **player** allies now gain HoT HP
where previously they were credited but not healed. This is the approved behaviour change, not a
regression. Re-validate rather than blanket-accept — and never run `vitest -u`.

### 3.4 The clamp

`engine.ts:3613` and `reversedRepairs.ts:8` both record that the incoming-heal fold is
**unclamped**, and that a negative `raw` arriving at `applyHealToTarget` would silently *raise*
`currentHp` uncapped by max HP, with no log row and no booked amount.

Add a floor so a fully-suppressed repair lands as **0**, never negative — a repair must never
become damage by arithmetic. Reversed Repairs (#362) is the only sanctioned repair→damage
channel and it is an explicit status, not a sign accident.

Under R1 this is **unreachable today** (one surviving `Inc. Repair Down`, worst case −75%). It is
a tripwire for the next person who adds an incoming-repair reducer, and the test should say so.

### 3.5 `Out. Repair Down`

Same helper, second channel (§3.1). Fold `outgoingHealPct` into the healer's own
`outgoingHealBuff` total at the same seam. Corpus appliers `Nayra` and `Ruiner` give it two real
red-first fixtures.

---

## 4. Testing

Red-first on every item — each test must be seen failing against current `main` before the fix
lands.

| # | Test | Pins |
|---|---|---|
| 1 | Enemy Larkspur inflicts `Inc. Repair Down II` on the tank; a player repair of 5,000 lands as 2,500 | §3.1 the core #367 fix |
| 2 | R1's exact three-status scenario → **5,000** | The locked fold rule, tier shadowing included |
| 3 | Debuff applied in round 1 before the victim's first turn → still −50% | §3.2 the fallback arm |
| 4 | Same debuff read after the victim has acted → −50%, **not** −100% | §3.2 no double-count |
| 5 | A ship repairing **itself** while carrying an enemy-applied `Inc. Repair Down II` | §3.1 the self arm, which the naive fix misses |
| 6 | Enemy ship carrying `Repair Over Time II` gains HP on its own turn | §3.3 the #369 core |
| 7 | That same enemy tick credits **no** player healing bucket and emits **no** `heal-performed` | R2 + the reason the gate existed |
| 8 | Off-anchor **player** ally with a HoT gains HP | §3.3 the non-anchor case |
| 9 | Enemy-applied `Out. Repair Down II` on a player healer reduces its outgoing repair | §3.5 |
| 10 | Fold driven past −100% yields a repair of 0, never negative HP gain | §3.4 the tripwire |

**Instrument validity is not optional here.** Two rules, both from prior sessions in this engine:

- For each newly-reachable path (§3.3's enemy tick, §3.3's non-anchor tick), plant a
  `throw new Error('PROBE-REACHED')` at the site and confirm the new fixture **fires it**. A
  fixture that does not actually reach the site looks identical to one that does. This is #368's
  lesson applied pre-emptively.
- Prove each test could report the opposite before believing it. A green heal-amount assertion
  proves nothing if the debuff never landed — assert the status is present on the victim as well
  as the amount.

**Fences to update, deliberately:** `reversedRepairs.channels.test.ts` (#362) asserts the enemy
HoT channel is **dead**. It was written as a structural fence that would fail loudly if anyone
changed this gate — it is doing its job. Updating it is part of this work, and its replacement
should assert the new contract (HP moves, no credit, no event), not simply be deleted.

---

## 5. Risks

- **Golden churn (§3.3).** Real and approved. Inspect the diffs; do not `-u`.
- **Double-count (§3.2).** The most likely way to ship this wrong. Test 4 exists for it.
- **The `victimEnemyBuffs` aura/accumulating approximation.** That function's jsdoc (finding I1)
  documents a NEUTRAL-ctx, no-re-roll approximation on the aura/accum channel. Every status in
  scope here (`Inc. Repair Down`, `Out. Repair Down`, `Repair Over Time`) is **timed**, which the
  jsdoc states is *not* approximated — landing is gated at application time. So the
  approximation does not bite, but say so in the code rather than leaving the next reader to
  re-derive it.
- **Scheduled self-buff channel on enemy runtimes.** `victimIncomingModifiers` documents a
  pre-existing gap: the SCHEDULED channel reads `selfBuffLookup`, populated only for player/team
  actors (enemy runtimes pass an empty map). Inherited, not introduced. Note it; do not widen
  scope to fix it.

## 6. Out of scope

- **#368** — the two unexercised leech `applyHealToTarget` sites. Deferred by the owner as the
  natural follow-on.
- **Making a HoT tick fire on-repaired triggers.** Ruled out by R2.
- Fixing the scheduled-self-buff-on-enemy-runtime gap (§5).
