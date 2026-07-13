# F1 attribution audit: can `damageDealt` reconcile with `Σ damageTaken`?

**Scope:** SP-F PR1, Task 3 (F1 — per-attacker×victim dealt attribution). Read-only audit, no
code changes. Verified against the live tree on branch `epic/sp-f-accounting-fidelity`
(HEAD `14b195d4`) on 2026-07-13.

**Files audited:** `src/utils/combat/engine.ts` (~8k lines), `src/utils/combat/positionalApply.ts`,
`src/utils/calculators/battleSimulator.ts`, `src/utils/combat/events.ts`.

**Bottom line up front:** **GO**, with one required **RESHAPE** (the generic per-victim DoT-tick
site cannot use a single-attacker-id write — it must split by source) and three adjacent,
pre-existing gaps that are **out of F1's scope** but that the implementer/reviewer must know about
so they don't mistake them for new bugs or assume F1 silently fixes them. Full detail below;
short version repeated at the end (§7).

---

## 1. Every `roundPerTargetDamage.set(...)` site (11 sites, not 6 as hinted)

All in `src/utils/combat/engine.ts`, all inside the per-round loop (`for (let r = 1; r <= numRounds;
r++)` opens at `:3300`; `const roundPerTargetDamage = new Map<string, number>()` is declared fresh
each iteration at `:3383`).

| # | Lines | Source | Victim key | Source-attacker id available at the site |
|---|-------|--------|-----------|---------------------------------------------|
| 1 | `3710-3713` | Protection damage-transfer (redirected chunk landing on a protector) | `p.actor.id` (the **protector**) | `cause.killerId` — available in the enclosing `applyVictimDamage` scope (the original attacker who dealt the hit being redirected). **Not** `victim.id` (the protected ship) even though the sibling `reactive-damage-performed` emit at the same site uses `sourceId: victim.id` for LOG purposes — see §5a for why the log's `sourceId` and the correct dealt-attribution id diverge here. |
| 2 | `4018-4021` | Bomb-splash-on-death (dying bombed ship splashes adjacent living allies) | `ally.id` (splash recipient) | `bomb.sourceId` — clean, passed one line above (`:4009 killerId: bomb.sourceId`), the bomb's original applier. |
| 3 | `4207-4210` | Reflect gear set (thorns bouncing back onto the original attacker) | `attacker.id` (the ORIGINAL attacker, now recipient of the bounce) | `victim.id` — the reflecting wearer; passed one line above (`:4192 killerId: victim.id`) into the recursive `applyVictimDamage` call. Clean, but note the direction inversion: the wearer is the *source* of this increment even though `victim` is the outer function's parameter name for the wearer. |
| 4 | `4407-4410` | Counterattack (Stalwart) | `attacker.id` (the one being countered) | `owner.id` — the counter-owner; passed one line above (`:4398 killerId: owner.id`). Clean. |
| 5 | `4801-4804` | **The main positional apply path** — direct casts, covered/splash AoE footprint victims. Fires once per footprint victim via the shared `emitHit` callback inside `drivePositionalApply` → `applyPositionalDamage`. | `victim.id` | `args.actingId` — closed over by the `drivePositionalApply` closure that defines this `emitHit` callback (`:4699-4808`). Clean, just not currently threaded into the write. |
| 6 | `5040-5043` | Skill-triggered bomb detonation (`applyPerVictimDetonation`) | `victim.id` | `actorId` — a function parameter of `applyPerVictimDetonation` (the detonating actor). Clean. |
| 7 | `5054-5057` | Skill-triggered DoT-container detonation (inferno/corrosion "burst", same loop as #6) | `victim.id` | `actorId` — same function parameter. Clean, **but** note the inner `applyVictimDamage(bypass, victim, sink, { byDirectDamage: false })` call at `:5047` passes **no** `killerId` — the credited attacker for this increment is the *detonating caster* (`actorId`), not "whoever originally applied the ticking DoT stacks." That is the existing, accepted convention (`perActorDetonation.set(actorId, …)` two lines below) — not a new problem, just worth stating explicitly because it differs from how DoT *ticks* (site #11) attribute. |
| 8 | `5090-5093` | Forced bomb detonation (`forceDetonateBombOnVictim`, e.g. Lingshe's countdown-reduce) | `victim.id` | `sourceId` — a function parameter (the bomb's original applier, explicitly threaded, **not** the forcing caster). Clean. |
| 9 | `5136-5139` | Natural bomb-countdown-0 burst on the bursting actor's own turn (`applyPositionedTimedBurst` → `processBombs`) | `actor.id` (the bursting actor, damaging itself) | `sourceId` — passed into the `creditDetonation` callback by `processBombs`. Clean. |
| 10 | `5162-5165` | Natural accumulator burst (same function, `processAccumulators`) | `actor.id` | `sourceId` — same pattern. Clean. |
| 11 | `6385-6388` | **Generic per-victim DoT tick** (corrosion/inferno/generic, at the ticking actor's own turn-start) | `actor.id` (the ticking victim) | **No single id at the write site** — `total` is a pre-summed aggregate across every corrosion/inferno/generic *entry*, and each entry carries its **own** `sourceId` (see §2). This is the one site that genuinely needs a design change, not just a threading fix. |

**Answer to "is a clean source-attacker id available at every site?"** Ten of eleven sites: yes,
trivially — the attacker id already exists in scope, it is just not currently written anywhere.
One site (DoT ticks, #11) is not "attacker-less" in the sense the brief worried about (a DoT tick is
not some untraceable ambient effect) — it is **multi-attacker-per-write**: the current code discards
per-source detail by summing into one `total` before the `roundPerTargetDamage.set` call, but the
per-source detail genuinely exists one level down (see §2). No site is truly attacker-less with no
recoverable id at all.

## 2. The DoT-tick site in detail — why "one attacker id per site" breaks here

`tickDoTs` (`engine.ts:838-926`) already loops per-*entry* (each `ActiveDoTStack` carries its own
`sourceId`) and calls `args.credit(sourceId, dotType, damage)` **once per contributing entry** —
see `:878-879` (corrosion), `:899` (inferno), `:918` (generic). The per-source amount is real and
already computed; it is the *caller's* `credit` closure at the DoT-tick site (`engine.ts:6344-6359`)
that throws it away:

```ts
credit: (sourceId, dotType, damage) => {
    total += damage;                              // ← per-source detail discarded here
    if (!sideIsPlayer) {                           // only recorded when ticking victim is enemy-side
        const e = perActorDot.get(sourceId) ?? { corrosion: 0, inferno: 0, generic: 0 };
        e[dotType] += damage;
        perActorDot.set(sourceId, e);
    }
},
```

Two consequences for F1:

1. **Multiple distinct appliers can tick on the same victim in the same round.** E.g. two different
   enemy attackers each landed their own corrosion stack on the same player ally in earlier rounds;
   both entries tick this round, each with its own `sourceId`, and today's code sums them into one
   `total` before the single `roundPerTargetDamage.set(actor.id, … + total)` write. A naive
   `perTargetDealt.set(attackerId, victimId, amount)` design that assumes **one** attacker per
   `roundPerTargetDamage` write cannot represent this — it would either drop one applier's
   contribution or misattribute the whole sum to whichever id the implementer grabs first.
2. **The existing `perActorDot` map already proves the per-source split is easy** — it does exactly
   this bookkeeping today, but *only* for the `!sideIsPlayer` branch (DoT ticking on an **enemy**
   victim, because that's the only case the focus-player DPS summary needs). The **other** direction
   (an enemy's DoT ticking on a **player** ally, `sideIsPlayer === true`) has the identical
   `sourceId` available in the same callback parameter list — it is simply never captured, because
   nothing downstream needed it before F1.

**Required reshape (not a blocker, but must be in the F1 plan, not discovered mid-implementation):**
at this one site, replace the collapsed `total` accumulation with a small `Map<string, number>`
(sourceId → damage-this-tick), populated on **both** sides of the `if (!sideIsPlayer)` branch (drop
the branch condition entirely for this new map — team-symmetric, per the epic's cross-cutting
invariant), and iterate that map to write one `roundPerTargetDealt` entry per distinct `sourceId`
instead of one blob keyed to a single guessed attacker. The `roundPerTargetDamage.set(actor.id, …)`
victim-keyed write at `:6385-6388` is unaffected (it already correctly sums `total` across sources —
that part is fine, only the *dealt* mirror needs the finer split).

## 3. Does `ability-performed` fire for each source? (quantifying today's `damageDealt` gap)

Confirmed via `emitDeferredAbilityPerformed` (`engine.ts:4881-4901`, the single emission point for
`ability-performed` on the positional path) and `events.ts:167-180`:

- **Fires (feeds `damageDealt` today):** exactly one `ability-performed` per turn/cast, carrying
  `damage: dap.damage`, where `dap.damage = directDamage` — the **anchor-only**, pre-footprint
  direct-hit damage computed once per turn in `playerTurn.ts` (`:3045`, `deferredAbilityPerformed:
  { …, damage: directDamage, … }`). This is emitted for **direct casts only** — one number per
  cast, not per victim, and it is the anchor's damage even when the cast also hit covered/splash
  victims for a different (typically halved) amount each.
- **Does NOT fire (excluded from `damageDealt` today, but ARE inside `damageTaken` via
  `perTargetDamage`):** covered/splash AoE victims' damage (site #5, only the anchor's slice reaches
  `ability-performed`), Protection-redirect (#1), Reflect (#3), counterattacks (#4), all four
  detonation flavors (#6-#10), and DoT ticks (#11). `events.ts:167-169` states the reason directly:
  *"A reactive damage credits its total but emits NO `ability-performed` (chain guard — an
  ability-performed would re-trigger on-crit/on-attacked/on-ally-crit listeners and loop)."* DoT
  ticks and detonations are not "reactive" in the chain-guard sense but are architecturally separate
  from the turn's single deferred `ability-performed` emission for the same reason: emitting a
  second `ability-performed` per victim would re-trigger on-crit/on-attacked listeners meant to fire
  once per cast.

This exactly quantifies the mismatch: `damageDealt` = anchor-cast-only; `damageTaken` = every
channel above, summed per victim. The two are apples and oranges today, confirming the spec's
framing.

## 4. Timing mismatch — DoT ticks land in a later round than the cast

Confirmed: DoT ticks fire at the **afflicted ship's own turn-start** (site #11 sits inside the
per-actor turn prologue at `:6231-6398`, gated on `isPositional(actor.position, opposing)`, i.e. the
victim's turn, not the applier's). The tick's `roundPerTargetDamage.set` write uses the **current**
round `r` (implicit — `roundPerTargetDamage` is rebuilt fresh every round and this call happens
inside that round's iteration), which is a **later** round than whatever round the DoT was applied.

**Recommendation: this is acceptable, and here is why precisely.** `ShipRoundState` (the
`battleSimulator.ts` consumer) is already a **per-round, not per-turn** structure — `roster.map(...)`
runs once per round for every roster ship regardless of whether that ship acted this round
(`battleSimulator.ts:353`), and `damageTaken` already books DoT-tick damage in the tick round, not
the cast round (that is the *existing*, accepted behavior of `perTargetDamage`). If `perTargetDealt`
mirrors each `roundPerTargetDamage` write in the exact same round it happens, both sides book the
tick in the **same** round — so the round-level reconciliation invariant (§6) holds without any
special-casing. The one thing that must change is prose, not code: `ShipRoundState.damageDealt`'s
docstring currently says "Attacker's **per-turn** aggregate" (`battleSimulator.ts:82`) — that phrase
becomes misleading once a DoT applier can show nonzero `damageDealt` in a round where they took no
turn at all (because their earlier-applied DoT ticked on someone this round). The Task 4 docstring
rewrite must say "per-round" and explicitly note that DoT-tick contributions land in the tick round,
not the cast round — mirroring `damageTaken`'s existing behavior rather than introducing a new one.

## 5. The precise reconciliation definition, and whether it holds by construction

**One-sentence definition:**

> For every round `r` and every attacker `a`: `attacker.damageDealt` in round `r` =
> `Σ_v perTargetDealt[r][a][v]` (sum over victims `v`), and this reconciles with `damageTaken`
> because for every victim `v`, `Σ_a perTargetDealt[r][a][v] = perTargetDamage[r][v]` — **provided**
> every `roundPerTargetDamage.set` increment in that round is mirrored by an equal-amount
> `roundPerTargetDealt` write keyed to the *correct* source-attacker(s) for that increment, with
> multi-source aggregates (site #11 only) split by source rather than collapsed to one id.

**Does `perTargetDamage` already equal the sum of all per-source contributions to that victim, with
no gap and no double-count?** Mostly yes for what it *does* record — but there are two verified
counter-examples worth flagging precisely, because they change what "reconciles" can honestly mean:

### 5a. A genuine pre-existing double-count under Protection (site #1) — not introduced by F1, but inherited if mirrored naively

`positionalApply.ts:214-226` computes the nominal per-victim hit `dmg` via `victimHitDamage` **before**
calling `applyToVictim`, and `emitHit(victim, dmg - transformedToDot, didCrit)` uses that **same
pre-redirect** `dmg`. Protection's redirect happens *inside* the subsequent `applyVictimDamage` call
and reduces the **local** `damage` variable to `cascade.targetRemainder` (`engine.ts:3744`) before
that reduced value reaches the victim's own `sink.addIncoming` (`:3747`) — so the victim's *intake*
bucket (`perActorIncoming`, which drives `hpPct`/`incomingDamage`) is correctly reduced by the
redirected fraction. But `roundPerTargetDamage`/`perTargetDamage` (which drives the `damageTaken`
stat) was **already written with the full pre-redirect `dmg`** at the emitHit call, *and* the
protector separately gets credited with the redirected chunk (`instantTotal`) at site #1. The
protection-damage-transfer design doc explicitly modeled this "as Reflect does"
(`docs/superpowers/specs/2026-07-11-protection-damage-transfer-design.md:73`), but that analogy is
imprecise: Reflect's attacker-side credit is a **second, independent** hit (retaliation) that adds
new real damage, so crediting it is not a double-count. Protection's protector-side credit is a
**portion of the same original hit**, diverted away from the original victim — yet the original
victim's `perTargetDamage` entry was never reduced to reflect that diversion. Net effect: today,
under an active Protection redirect, `Σ_v perTargetDamage[v]` (victim Y's full nominal hit + protector
Z's redirected chunk) is **strictly greater** than the single real hit the attacker actually dealt.

**Impact on F1:** if the per-(attacker,victim) mirror is written naively (attacker X's id at both the
emitHit site and the protector-redirect site), `Σ_v perTargetDealt[X][v]` reproduces this exact same
inflated sum — so the reconciliation invariant in §5 **still holds** (both sides mirror the same,
already-doubled numbers, tautologically), but the absolute `damageDealt` number for a Protection-
redirecting attacker will be visibly larger than "the one hit they actually landed." This is not a
new bug and not something F1 is obligated to fix (it already exists in `damageTaken` today, silently)
— but flag it in the PR body so a reviewer seeing an inflated `damageDealt` under a Protection
fixture doesn't mistake reconciliation-working for correctness-of-the-absolute-number, and so nobody
"fixes" it as an unplanned scope-creep during F1.

### 5b. Two sites never write `roundPerTargetDamage` at all — real damage invisible to `damageTaken` today, independent of case-c

- **The focus/heal-target's own DoT tick** (`engine.ts:6231-6314`, the `isHealTarget` branch) calls
  `applyIncomingToTarget`/`applyVictimDamage` (real HP mutation, real intake-bucket credit) but never
  calls `roundPerTargetDamage.set`. Crucially, **this is not healing-mode-only**: in
  `battleSimulator.ts`'s positional sim call (`positionalTeamBattle: true`), `healTarget` defaults to
  the focus `attacker` when no explicit heal target is set (`engine.ts:2003`,
  `explicitHealTarget ?? (input.positionalTeamBattle ? attacker : undefined)`). So **the focus
  actor's own incoming DoT-tick damage is invisible to `perTargetDamage`/`damageTaken` in sim mode
  today**, regardless of whether the enemy applying it has real targeting data. This is a real,
  separate gap in `damageTaken` itself.
- **The reactive `damage` executor** (`applyReactiveDamage`, `engine.ts:4429-4522` — powers
  FrontLine's on-enemy-charged-cast, Grif's on-enemy-cleansed, and the Rhodium/Chakara/Incinerator
  start/end-of-round triggers) never calls `applyVictimDamage` at all. It resolves a concrete
  `victimId` (the caller passes one) but only `creditDamage(ownerId, 'direct', raw)`s a scalar
  (`roundDamage`/`reactiveDealtByOwner`, consumed today only by DPS-mode `cumulativeDamage` and by
  the existing single-owner `basis:'damage-dealt'` shield mechanism at `engine.ts:5750`, `triggers.ts:
  2504`). It never touches the victim's real HP or `roundPerTargetDamage` in sim mode.

  > **RETIRED by SP-M M1 (2026-07-13).** `applyReactiveDamage` (now `engine.ts:4529-4653`) has an
  > explicit `if (input.positionalTeamBattle && victim.id !== enemy.id)` branch (`:4635-4649`) that
  > now calls all three of `applyVictimDamage` (real HP mutation), `roundPerTargetDamage.set` (the
  > `damageTaken` write), and the new `creditDealt(ownerId, victim.id, raw)` (the F1
  > `perTargetDealt`/`damageDealt` attribution write) — for **all eight** mechanics this executor
  > powers (FrontLine, Grif, Paracelsus on-destroyed, Vindicator on-resist, plus Rhodium, Chakara,
  > Judge, Incinerator), each routed to its **true** target: `intent.eventCtx?.counterTargetId ??
  > ctx.enemy.id` for FrontLine/Grif/Paracelsus/Vindicator; `ctx.enemyWithMostBuffs?.(ownerId)` for
  > Rhodium; `ctx.enemyWithHighestSpeed?.(ownerId)` for Chakara; and the new
  > `resolveAoEReactiveDamageVictims` seam (enumerating `ctx.livingOpposingActorIds`, filtered by
  > per-victim `conditionsMet`) for Judge (<50% HP) and Incinerator (Inferno). The non-positional
  > (pure DPS/healing) branch is unchanged — still the original `creditDamage(ownerId, 'direct',
  > raw)` scalar-only path, explicitly commented "byte-identical" at the site, preserving §4.2's
  > invariant. Two residual gaps remain, both orthogonal to this pin and NOT closed by SP-M: (a) the
  > DPS/healing-mode credit-only path stays credit-only by design (§4.2 preserved, not a gap); (b) a
  > **separate, pre-existing** round-tail snapshot-ordering bug (confirmed present before M1, at
  > commit `78eab536`) means pure-DPS-mode `round-ended` triggers (Rhodium's end-of-round credit) are
  > drained *after* `directDamage`/`cumulativeDamage`/`totalRoundDamage` are already snapshotted in
  > `simulateDPS`, so Rhodium's (and by the same mechanism, Incinerator's) DPS-mode credit never
  > surfaces in the DPS-calculator's public summary — see
  > `src/utils/calculators/__tests__/rhodiumChakaraDpsModeCredit.integration.test.ts:25-37`. This is a
  > DPS-mode-only gap (the positional-sim HP path added by M1 is unaffected) and is flagged as a
  > follow-up, not caused by or fixed by SP-M M1.

**Why this matters beyond "yet more known gaps":** these are sites where **nothing** is written to
`roundPerTargetDamage` for a real damage event — so there is nothing for F1 to *mirror* there. The
reconciliation invariant in §5 still holds (both `damageDealt` and `damageTaken` omit this damage
symmetrically), but it means `perTargetDamage` is not an exhaustive ledger of "every point of damage
any ship took this round" — only of "every point of damage that flowed through a site that happens to
write `roundPerTargetDamage`." F1 does not need to close these — they are pre-existing and orthogonal
to attacker-attribution — but **§5b's second bullet is a direct hit on the epic's own stated payoff**:
`docs/superpowers/specs/2026-07-13-sp-f-accounting-fidelity-design.md` says F1's channel unblocks
"SP-M's M1 FrontLine reactive shield." FrontLine's reactive shield is driven by exactly the
`applyReactiveDamage` executor described above. **If M1 needs per-victim attribution of FrontLine's
own reactive damage, F1 as scoped (mirroring existing `roundPerTargetDamage` sites) will not provide
it — there is no site to mirror.** SP-M's plan should not assume F1 alone unlocks this; it may need
its own engine-side step to route `applyReactiveDamage` through the real per-victim apply path (or a
dedicated write), which is a materially different (and larger) change than "mirror an existing site."
Flagging this now so SP-M's planning doesn't discover it mid-implementation.

## 6. Case-c (unchanged from the F7/Task-1 audit — correctly out of scope)

Re-confirmed present and unchanged: a ship with `target === undefined` (no parsed targeting data at
all — `ShipsContext.tsx:260` / `targetingParser.ts:225`) never enters the positional apply gate; its
`turn.directDamage` instead feeds `creditDamage(actor.id, 'direct', …)` → the unread `cumulativeDamage`
scalar, never `roundPerTargetDamage`. Pre-existing, already lost from `perTargetDamage` today, and
correctly excluded from F1's invariant per the brief — the fixtures backing F1's reconciliation test
must use ships with parsed `target`+`pattern` (true for the corpus, per `docs/ship-targeting.csv`).

## 7. Channel design recommendation

**Type, matching the existing `RoundData` convention exactly** (nested accumulator during the round,
`Record`-shaped once pushed, `dpsSimulator.ts:98-177` defines `RoundData` and its sibling per-actor
maps — `perActorReflected?: Record<string, number>`, `perActorDetonation?: Record<string, number>`,
`perActorSplash?: Record<string, number>`, all "absent when empty" per the byte-identical-goldens
convention documented at `engine.ts:3382`, `:7835-7836`):

```ts
// engine.ts, declared alongside roundPerTargetDamage (:3383), fresh every round:
const roundPerTargetDealt = new Map<string, Map<string, number>>(); // attackerId -> victimId -> amount

// RoundData (dpsSimulator.ts), new field mirroring perTargetDamage's shape one level deeper:
/** Attacker id -> victim id -> total dealt THIS round via that attacker. Σ over victims for one
 *  attacker == that attacker's damageDealt; Σ over attackers for one victim == perTargetDamage[victim].
 *  Set ONLY when non-empty (mirrors perTargetDamage's "absent when empty" rule). */
perTargetDealt?: Record<string, Record<string, number>>;
```

**Exact `engine.ts` sites to add a mirrored write** (one new `roundPerTargetDealt` write beside each
existing `roundPerTargetDamage.set`, using the attacker id already identified in the §1 table):

| Site | Add mirrored write keyed by |
|---|---|
| `3710-3713` | `cause.killerId` → `p.actor.id` |
| `4018-4021` | `bomb.sourceId` → `ally.id` |
| `4207-4210` | `victim.id` (the wearer/reflector) → `attacker.id` |
| `4407-4410` | `owner.id` → `attacker.id` |
| `4801-4804` | `args.actingId` → `victim.id` |
| `5040-5043` | `actorId` → `victim.id` |
| `5054-5057` | `actorId` → `victim.id` |
| `5090-5093` | `sourceId` → `victim.id` |
| `5136-5139` | `sourceId` → `actor.id` |
| `5162-5165` | `sourceId` → `actor.id` |
| `6385-6388` | **RESHAPE** — do not add a single write; restructure the `credit` closure at `:6344-6359` to accumulate a local `sourceId → damage` map (dropping the `!sideIsPlayer` gate for this new map only — team-symmetric) and write one `roundPerTargetDealt` entry per distinct `sourceId` → `actor.id` |

A small helper (`creditDealt(attackerId, victimId, amount)` — get-or-create the inner map, add) placed
next to `roundPerTargetDamage`'s declaration keeps every site a one-line addition.

**`battleSimulator.ts` consumption change:**

- Add a nested `perRoundPerDealt: Record<number, Record<string, Record<string, number>>>` built the
  same way `perRoundPerTarget` is (`battleSimulator.ts:907-910`): `perRoundPerDealt[rd.round] =
  rd.perTargetDealt ?? {}`.
- Replace the `ability-performed`-summed `dealt` map (`:326-332`) with: for the current round, sum
  `perRoundPerDealt[round][attackerId]`'s values (`Object.values(...).reduce(...)`) into the `dealt`
  map consumed at `:378`.
- Rewrite `ShipRoundState.damageDealt`/`damageTaken` docstrings (`:81-94`) per §4's finding (per-round,
  not per-turn; DoT-tick contributions land in the tick round; state the new invariant plainly, and
  add one sentence flagging the Protection-redirect caveat from §5a so a future reader isn't
  surprised by an inflated number under Protection).

## 8. Golden impact

- **`ShipRoundState.damageDealt` values WILL change** — for any AoE cast with covered/splash victims,
  any Protection redirect, any Reflect/counter, any detonation, and any round where a ship's own
  earlier-applied DoT ticks on a victim. It becomes a strictly fuller (generally larger, and in the
  Protection case per §5a, inflated-relative-to-the-single-hit) number.
- **`perTargetDamage` itself is UNCHANGED** — F1 adds a parallel attribution channel, it does not
  touch the existing `roundPerTargetDamage` writes or values. So `damageTaken`, `hpPct`, and every
  other field derived from `perTargetDamage`/`perActorIncoming` stay byte-identical. `dpsGoldenParity`
  and `healingGoldenParity` snapshots are **unaffected** — `dpsSimulator.ts`'s DPS-mode `RoundData`
  has no `ShipRoundState`/`damageDealt` concept, and `healingEngineAdapter.ts` never references
  `damageDealt`/`ability-performed` at all (confirmed via grep — zero hits).
- **`simGolden.test.ts` / `simGolden.smoke.test.ts` snapshots WILL move** wherever a fixture's roster
  includes an AoE cast, Protection, Reflect, a counter, a detonation, or a DoT tick — i.e. likely most
  non-trivial sim fixtures. This is the audited, deliberate golden move F1 is supposed to produce; the
  implementer must eyeball every diff and confirm each is explained by one of the channels in §1/§5.
- **Other non-golden tests to check** (grepped for hardcoded `damageDealt` assertions that might now
  need updating, not just the two golden tiers): `battleSimulatorSquadLeaders.test.ts`,
  `battleAssemble.test.ts`, `battleSimulatorPreFightModifiers.test.ts`,
  `overloadLifecycle.test.ts`, `twoTeamBattle.test.ts`, `equipmentAbilities.integration.test.ts`,
  `preCombatBattle.integration.test.ts`, `rngLocality.test.ts`.

## 9. GO / RESHAPE recommendation

**GO on the plan's core approach** (a `RoundData.perTargetDealt` map mirroring `perTargetDamage`,
consumed in `assembleBattleResult` to replace the `ability-performed`-summed `dealt` map) — ten of
eleven existing write sites need nothing more than a one-line mirrored write using an id already in
scope, and the design in §7 slots in cleanly beside the existing `perActorReflected`/
`perActorDetonation`/`perActorSplash` precedent.

**One required RESHAPE, scoped and bounded:** the generic per-victim DoT-tick site (`:6316-6398`,
`credit` closure at `:6344-6359`) must be restructured to preserve per-`sourceId` detail instead of
collapsing to `total` before the write — the per-source detail already exists one level down inside
`tickDoTs`, so this is a "don't throw it away" fix, not new plumbing. Must be written into the F1
implementation task explicitly (not discovered mid-implementation) since it's the one site where "one
attacker id per site" is provably false.

**Three findings to carry forward, not fixed by F1, but must be stated in the PR body / SP-M
handoff so nobody mistakes them for new regressions or assumes F1 silently closes them:**

1. Protection redirect double-counts into `perTargetDamage` today (§5a) — F1 inherits this faithfully
   (reconciliation still holds), but `damageDealt` under Protection will look inflated relative to the
   single real hit; that is pre-existing, not new.
2. The focus/heal-target's own DoT tick never reaches `perTargetDamage` in sim mode (§5b) — a
   `damageTaken` completeness gap, independent of case-c, not fixed by F1 (nothing to mirror).
3. `applyReactiveDamage` (FrontLine/Grif/Rhodium/Chakara/Incinerator's reactive damage triggers) never
   writes `roundPerTargetDamage` at all (§5b) — if SP-M's M1 FrontLine reactive shield genuinely needs
   per-victim attribution of *this* channel, F1 as scoped does not provide it; SP-M's plan needs its
   own step, not an assumption that F1's mirror covers it.

   > **RETIRED by SP-M M1 (2026-07-13).** SP-M M1 took its own engine-side step, exactly as
   > anticipated here: `applyReactiveDamage` (`engine.ts:4529-4653`) now routes through
   > `applyVictimDamage` + `roundPerTargetDamage.set` + the new `creditDealt` helper in positional
   > mode, for all eight reactive-damage mechanics (FrontLine, Grif, Paracelsus, Vindicator, Rhodium,
   > Chakara, Judge, Incinerator), each to its correct true target (see the retirement note under
   > §5b above for the full per-mechanic routing). The non-positional DPS/healing path is untouched
   > (still credit-only, byte-identical). Two residual, out-of-scope items carried forward: the
   > DPS/healing credit-only path is by design, not a gap; and a separate pre-existing round-tail
   > snapshot-ordering bug keeps Rhodium's/Incinerator's DPS-mode credit out of the DPS-calculator's
   > public summary (see `rhodiumChakaraDpsModeCredit.integration.test.ts`) — unrelated to this pin
   > and not caused by SP-M.
4. Protection redirects of a **DoT-tick-batch** (site #11's pre-summed `total`, redirected to a
   protector) have no single source attacker at the write site — the batch collapses multiple
   `sourceId`s before the redirect, so there is nothing correct to mirror into `perTargetDealt` for
   that increment. This is a **narrower gap than #1 above**: #1 covers direct-hit Protection
   redirects (which DO reconcile, just double-counted); this one does NOT reconcile at all for that
   round's redirected amount — `damageDealt` comes up short by the redirected DoT total. Confirmed
   post-implementation in `battleSimulator.ts`'s `ShipRoundState.damageDealt` docstring (commit
   `52cd77ec`). Not fixed by F1 as scoped; carry forward as a documented exclusion, not a regression.
