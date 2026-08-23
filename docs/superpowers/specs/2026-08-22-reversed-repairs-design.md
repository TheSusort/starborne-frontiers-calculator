# Reversed Repairs — design

**Issue:** #362 (Zosimos). **Date:** 2026-08-22. **Status:** design approved, ready for planning.

> ## ⚠️ RETRACTIONS — READ BEFORE USING THIS DOCUMENT AS AUTHORITY
>
> **Two rulings in this spec were RETRACTED by the owner during implementation and replaced.**
> The rest of the document still stands. Every passage below that carries a retracted ruling is
> marked inline with **RETRACTED** or **SUPERSEDED**; if you are reading a passage with no such
> marker, it is current.
>
> | Retracted | Replaced by | What actually shipped |
> |---|---|---|
> | **R7** — the reversal's damage and kill are credited to the healer whose repair was reversed. | **R7′** | The damage AND the kill belong to the **debuff's applier** (the Zosimos), the way a DoT's damage and kills belong to whoever applied the DoT. The healer gets neither. `applierId: undefined` (the scheduled channel) means **no credit and no killer** — never a fallback to the healer. |
> | **R10** — a reversed repair surfaces as **overhealing** for the healer, delivered by returning the existing `{consumed: 0, overheal: raw}` shape. | **R10′** | A reversed repair books the healer **NOTHING**: repairs cast 0, effective healing 0, overhealing 0. The branch returns `{ reversed: true }` carrying no numbers, which is what forces every call site to move its gross credit below the call. |
>
> **One ruling is MISSING from this spec** because it was added after it was written:
>
> | Added | Ruling |
> |---|---|
> | **R11** | **Every reversal writes its own combat-log row, lethal or not.** Without it a non-lethal reversal emits nothing and the player watches a repair land, achieve nothing, and HP drop with no line connecting the three. The row books to the applier (R7′), carries the burned ship as its target, and carries the healer as a **display-only** `healerId`. One qualification found in review: a `raw === 0` repair reverses into a 0 burn with no observable consequence anywhere, and writes no row. |
>
> The standing, implemented rules live in the code: the reversal branch inside
> `applyHealToTarget` (`src/utils/combat/engine.ts`), `src/utils/combat/reversedRepairs.ts`, and
> the `reversedRepairs.*.test.ts` suites. Where this document and the code disagree, **the code
> is right** — this spec is retained as the record of how the design was reasoned, not as a
> specification to implement from.

## Problem

Zosimos's charged skill reads:

> This Unit inflicts `<unit-skill>Reversed Repairs</unit-skill>` for 1 turn and deals
> `<unit-damage>300% damage</unit-damage>`.

`Reversed Repairs` parses into nothing. It is absent from `src/constants/buffs.ts`, has no
model anywhere in `src/`, and the built kit carries no debuff for it. The two *other* defects
originally filed on #362 — the fabricated 300%-of-max-HP self-heal, and the charge-removal
trigger — are already fixed and shipped in `fe0b4644`.

The status turns incoming repairs into damage. The engine has no channel for damage that
originates at a heal-apply site, which is why this is a design rather than a parser fix.

## Owner rulings (2026-08-22)

Each was answered against a concrete in-fight example. Do not re-derive any of these from code.

| # | Question | Ruling |
|---|---|---|
| R1 | Which defensive layers does the reversed amount pass through? | **None.** No shield drain, no Protection redirect, no defence mitigation. A raw HP burn at face value. |
| R2 | Which repairs reverse? | **Every repair, any source** — cast repairs, HoT ticks, leech self-repairs, reactive repairs. **Shield grants are not repairs** and are unaffected. |
| R3 | Target already at full HP? | **Takes the full amount.** The reversal reads the repair's face value, not the portion a heal could have consumed. A repair on a full-health unit is at its most punishing. |
| R4 | Repair crits? | **The crit carries.** A repair that would have restored 6,000 reverses into 6,000. |
| R5 | Does anything react to it? | **Nothing reacts.** No counterattack, no Reflect thorns, no incoming-leech proc, no on-damaged passives. |
| R6 | Stacked with `Inc. Repair Down II` (-50%)? | **The -50% applies first**, and the reduced amount is what reverses. 4,000 → 2,000 → 2,000 damage. |
| ~~R7~~ **RETRACTED** | Can it kill? Who is credited? | ~~**Yes.** The kill is credited to **the healer whose repair was reversed**, not to the Zosimos that applied the debuff.~~ **SUPERSEDED BY R7′:** it kills, and both the damage and the kill belong to the **debuff's applier** — never the healer. See the retraction header. |
| R8 | Cheat Death on a lethal reversal? | **Cheat Death intercepts.** The victim survives at 1 HP and spends its Cheat Death, exactly as against a lethal attack. |
| R9 | Zosimos's own charge passive ("when an enemy performs a repair, add 1 charge")? | **Still fires.** The passive watches the enemy *casting* a repair; what happens on arrival is irrelevant. |
| ~~R10~~ **RETRACTED** | Where does it surface in the report? | ~~**As overhealing** for the healer. Its healing total shows the repair fully wasted; its damage-dealt total is not credited. No new report field.~~ **SUPERSEDED BY R10′:** it books the healer **nothing at all** — repairs cast 0, effective healing 0, overhealing 0. It surfaces as the applier's damage. See the retraction header. |
| R11 *(added after this spec)* | Does a reversal show in the combat log? | **Yes — every reversal writes its own row, lethal or not**, booked to the applier, carrying the healer as a display-only name. A `raw === 0` repair is the one exception: nothing burned, nothing announced. |

### Consequences derived from the rulings, confirmed with the owner

- **Barrier does not block it.** Full-damage immunity lives in the damage funnel, which the
  reversal never enters (R1, R5). Cheat Death (R8) is therefore the *only* survival layer
  that applies to a reversed repair.
- **A kill by reversal fires no bomb death-splash.** Follows from R5.
- **Inert in DPS mode.** There is no `healingCtx` without an HP model, so the calculator
  ignores the debuff entirely — consistent with every other HP-dependent mechanic.

## Key structural finding

Every ruling lands on **one value that already exists**.

`engine.ts:3547` (`victim.currentHp += consumed`, inside `applyHealToTarget`) is the **only**
line in the entire combat engine where HP goes up. Verified by grepping every module under
`src/utils/combat/`. Every repair channel — cast, HoT tick, standing/taken leech, reactive —
funnels through that one closure.

And by the time `raw` arrives there, it is already:

- post-crit (`playerTurn.ts:4212`),
- post-`healModifier` and post-`outgoingHealBuff` (`:4213-4214`),
- post-`incomingHealPct`, which is where `Inc. Repair Down` lives (`:4215`),
- post caster- and recipient-side amplification (`:4217-4220`),
- **pre**-deficit-clamp (the clamp is inside the closure, `engine.ts:3546`).

That is precisely "the repair's face value, after Inc. Repair Down, after its crit roll,
ignoring how much room there was" — R3, R4 and R6 in a single number, for free.

## Approach

Intercept inside `applyHealToTarget`.

Two alternatives were considered and rejected:

- **A dedicated `applyReversedRepair` called from each heal site.** Re-enumerates 8 call
  sites that must stay in sync. This is the hand-enumerated-layer defect class that produced
  two silent failures with green tests in #294/#296.
- **Routing through `applyVictimDamage`.** The rulings switch *off* shield, Protection,
  defence, reflect, counters and leech, so it means threading five suppression flags through
  the funnel to make it skip nearly everything it does. It also needs late binding:
  `applyVictimDamage` is declared at `engine.ts:5003`, in a nested per-turn scope *below*
  `healingCtx` (`engine.ts:3514`). High risk, near-zero reuse.

## Components

### 1. Status plumbing

**`src/constants/buffs.ts`** — add the debuff entry beside the rest of the repair ladder
(`Inc. Repair Down I/II/III` at `:494-506`, `Block Repair` at `:687`):

```ts
{ name: 'Reversed Repairs', description: 'Incoming repairs damage this unit instead', type: 'debuff' },
```

This is load-bearing for parsing, not cosmetic: the parser resolves `<unit-skill>` names
against the buff table (`skillTextParser.ts:79`), which is why the status currently builds
nothing.

**`src/utils/combat/reversedRepairs.ts`** — new module, modelled on `exposedStatus.ts`:
a name constant plus ~~`hasReversedRepairs(statusEngine, victimId): boolean`~~.

> **SUPERSEDED by R7′.** A boolean is not enough once the damage and kill belong to the
> **applier**: the read has to return *who applied it*. What shipped is
> `reversedRepairsOn(statusEngine, victim): { applierId: string | undefined } | undefined`,
> taking the whole victim (it needs `victim.side` for the scheduled arm's gate) rather than a
> bare id. `applierId: undefined` is a legitimate state, not an error — see the module.

One deliberate divergence from Exposed: this read covers the **scheduled** channel as well as
the timed one. `exposedIncomingPct` reads only `timedAbilityStatuses` because "the next direct
hit" has no standing value to model, so a manually-selected Exposed is intentionally inert. A
1-turn duration debuff *does* have a standing value, so a Reversed Repairs selected by hand in
the simulator must work. Both are read; ~~presence is boolean,~~ stacks are not meaningful.

> **Refined in implementation:** the two arms are *not* read the same way. The timed arm is
> ungated on side (team symmetry — an enemy Zosimos must reverse a player ship's repairs); the
> scheduled arm is gated on `victim.side === 'enemy'`, because `enemyAlwaysSnap` has no
> per-victim keying at all and would otherwise answer "carrying" for every id in the run. The
> module's doc comment holds the full argument.

### 2. The reversal

Inside `applyHealToTarget` (`engine.ts:3535`), after the existing dead-victim early return and
**before** the deficit clamp:

- if the victim carries the status → `victim.currentHp = Math.max(0, victim.currentHp - raw)`,
- book the burn on the **applier** (R7′) and write the R11 log row,
- run the shared lethal-HP path (below), with `killerId` = the applier,
- ~~return `{ consumed: 0, overheal: raw }`~~ → **return `{ reversed: true }`**.

The existing dead-victim early return stays as-is: a corpse takes no reversed repair.

> ### ⚠️ RETRACTED — the paragraph below was the load-bearing argument for R10, and R10 is gone
>
> ~~The return shape is the **existing** one, which is what delivers R10 with no change to the
> accounting contract. All 8 call sites already do
> `credit(id, 'effectiveHeal', consumed); credit(id, 'overheal', overheal)`, so the reversal
> books as fully-wasted healing automatically and the `raw = effective + overheal` identity
> holds.~~
>
> Under **R10′** returning that shape would be *worse than useless*, and `engine.ts` says so at
> the branch: it books the raw as overheal, **and** the call sites' gross `directHeal`/`hotHeal`
> credit — written *above* the call — would stand as well. So the branch returns
> `{ reversed: true }` carrying no numbers at all, which makes every call site fail to compile
> until it moves its gross credit *below* the call. The "no change to the accounting contract"
> property that made the old shape attractive is exactly what made it wrong.

What is still true, and is why the naive `incomingHealPct: -200` sign flip fails: that fold is
unclamped, so `raw` goes negative, `consumed = max(0, min(raw, deficit))` collapses to 0 and
`overheal = raw - consumed` goes **negative** — no damage, no healing, and a negative number
polluting the overheal statistics, with green tests throughout.

`repairedThisRound.add(victim.id)` must **not** fire on a reversal — nothing was repaired.
Note that this is separate from R9: Zosimos's charge passive keys off the enemy *casting* a
repair, upstream of this closure, and is untouched.

### 3. Kill attribution — a required signature change

> **⚠️ THE PREMISE OF THIS SECTION IS RETRACTED, THE CONCLUSION IS NOT.** R7 credited the kill
> to the healer; **R7′ credits it to the debuff's applier** (`reversal.applierId`, read off the
> status), so `repairSourceId` is *not* the killer and never becomes one. The signature change
> shipped anyway and is still required — for a different reason: `repairSourceId` is R11's
> `healerId`, the display-only name on the reversal's log row. A site that forgot it would print
> a reversal row naming nobody as the healer, on a channel where the healer is the only thing
> the row explains. Read the paragraphs below with "kill" replaced by "log row".

~~R7 credits the kill to the healer, but~~ `applyHealToTarget(raw, victim)` does not currently
receive a source id. The callers all know it (`creditId`, `actor.id`).

Change the signature to `applyHealToTarget(raw, victim, repairSourceId)` with **all three
parameters required**, dropping the `victim = healTarget` default. The ~4 sites that relied on
the default pass `healTarget` explicitly.

Required, not optional, is the point: an optional third parameter would let a missed call site
compile and silently book ~~a reversal kill with `killerId: undefined`~~ **a healer-less log
row**, exactly where the ruling is specific. Making it required turns the sweep into an arity
error, so `tsc` enumerates every site for us instead of us enumerating them by hand.

### 4. One death path, not two

R8 puts Cheat Death on the reversal path, and the intercept currently lives *inside*
`applyVictimDamage` (`engine.ts:5792-5840`). A hand-copied second death path is the shape that
produced the one-directional defects in #306.

Extract a helper owning the lethal-HP decision:

- Cheat-Death detection via `selfBuffNamesForOwners` (**not** `snapshot().activeSelfBuffs` —
  a real Cheat Death is an ability-sourced recurring self-buff, and the heal target's owner id
  is often a team-actor id, so snapshot alone misses both cases),
- the intercept: floor HP at 1, mark `cheatDeathConsumed` / `cheatDeathConsumedRound`,
  `statusEngine.clearRemovable`, filter the three DoT containers to `unremovable` only,
- the `cheat-death-activated` event plus its log-only twin,
- otherwise `recordDestroyed(victim, r, bus, killerId, byDirectDamage)`.

**Bomb death-splash stays at the `applyVictimDamage` call site**, gated on the helper
returning `destroyed`. It recurses into `applyVictimDamage`, so it cannot live in a shared
helper — and per R5 the reversal path must not splash anyway. This is the natural seam.

Deferred-logging state (`deferReflectLogs`, `deferConsequenceLogs`, `pendingConsequenceLogs`,
`currentSubAttackIndex`, `actingActorId`) is turn-scoped and stays at the call site: the helper
takes an emitter callback rather than the deferral machinery. The required engine state is
already in scope for the reversal — `cheatDeathConsumed` (`:3359`) and `cheatDeathConsumedRound`
(`:3377`) are declared above `healingCtx`, and `recordDestroyed` is a module import (`:45`).

**Log ordering — half-resolved, and it forces a choice.** `deferReflectLogs` (`:4920`) and
`deferConsequenceLogs` (`:4975`) are declared in the per-turn scope, *below* `healingCtx`
(`:3514`), so they are **not reachable** from the reversal site. A reactive repair can still
fire inside a deferral window, so a reversal kill there would emit `ship-destroyed`
immediately while the surrounding hit's logs are still buffered — out of order in the combat
log. Two options, to be decided by inspecting whether any heal-apply site is in fact reachable
during a deferral window:

- accept immediate emission (correct only if no heal-apply site is ever inside one), or
- give `healingCtx` a late-bound emitter that the turn scope installs, so the reversal routes
  through the same buffer.

Decide by inspection, not assumption. `statusEngine` (`:2336`) is comfortably in scope either way.

### 5. Zosimos's kit

No change. R9's charge passive already resolves to `on-enemy-repaired` and was fixed in
`fe0b4644` (including R3's `everyNthEvent: 2` cadence).

## Testing

- **Parser:** the charged skill builds a `Reversed Repairs` debuff for 1 turn on the enemy.
- **Per ruling, one engine test each:** R1 (shield/Protection/defence all untouched), R2 (all
  four channels reverse; a shield grant does not), R3 (full HP → full damage), R4 (crit
  carries), R5 (counter/thorns/leech/on-damaged all silent), R6 (Inc. Repair Down first),
  ~~R7 (`ship-destroyed.killerId` is the healer)~~ → **R7′ (`ship-destroyed.killerId` is the
  APPLIER, explicitly not the healer; the burn books on the applier's damage-dealt axis)**,
  R8 (Cheat Death intercepts and is spent), ~~R10 (overheal bucket carries it, damage-dealt does
  not)~~ → **R10′ (repairs cast, effective healing and overhealing are ALL zero on the healer —
  on the `ActorHealing` buckets *and* on the `heal-performed` channel the battle report's
  healing done/received is folded from)**, **R11 (every reversal writes a log row, lethal or
  not; a 0-magnitude one writes none)**.
- **Corpus scan:** confirm which other ships apply or receive `Reversed Repairs`; report the
  number including zero.
- **`realKitFingerprints > Zosimos`** re-baselined **only after** everything above lands, so
  the new snapshot records correct behaviour.

### Vacuity guards

Every fixture must be able to report the opposite. Specifically:

- An R1 test asserting "shield untouched" is vacuous if the fixture's victim has no shield
  pool — assert the pool is non-zero **before** the reversal as an existence check.
- An R5 test asserting "no counterattack" is vacuous unless the same fixture, hit by an
  ordinary attack of the same magnitude, **does** counterattack. Prove the instrument fires.
- An R8 test is vacuous if the victim would have survived the burn anyway — assert
  `raw > currentHp` before the call.
- R2's leech arm is vacuous unless the leech actually restores HP in the baseline run.

## Out of scope

- Reversing shield grants (R2: shields are not repairs).
- Any change to the damage funnel's own behaviour for ordinary attacks. The helper extraction
  in §4 must be behaviour-preserving; the existing goldens are the check.
- `Block Repair` and `Block Shield`, the other two still-inert name-only statuses. Related,
  but separate issues.
