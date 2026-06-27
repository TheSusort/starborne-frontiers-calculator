# Sub-project G — Reactive Counterattack Refinements (design)

**Date:** 2026-06-27
**Epic:** combat-realism (sub-project G — damage-reaction mechanics)
**Status:** design, pending spec review
**Prereqs shipped:** Reflect gear set (#160), reactive-damage executor + proc/once-per-round gates, adjacency helper, per-victim damage pipeline.

## Goal

Model the game's **counterattack** passives in the combat sim. The reactive
`on-attacked` machinery exists, but it has two gaps:

1. The reactive **damage** executor is a *bomb-like approximation* (owner-attack
   × multiplier, **no** defense mitigation, **no** crit, emits **no** event, and
   only `creditDamage`s output — it does not actually reduce the attacker's HP).
   Counterattacks must be a **full damage walk** against the attacker.
2. The parser auto-detects **no** reactive-damage triggers
   (`detectReactiveTrigger` has no damage path), so every counterattack passive
   is silently inert in the sim today.

This sub-project adds a faithful counterattack: a full mitigated/crit damage walk
against the attacker, auto-parsed from skill text, with the per-ship condition
gates the corpus actually uses.

## Corpus (the real, verified set)

Reflect (`Nosorog`, and the Reflect gear set) is already shipped — out of scope.
Malvex's "directly damaged as a primary target" is a *shield grant*, not damage —
out of scope. The remaining unmodeled counterattacks are:

Exact text (CSV-parsed 2026-06-27 — earlier explore quotes were inaccurate):

| Ship | Passive text (verbatim, markup stripped) | Variant |
| --- | --- | --- |
| **Stalwart** (P1/P2) | "When this Unit is directly damaged **as a primary target**, it deals 30%/70% damage to that enemy and gains Legion Discipline II for 3 turns." | plain + primary-target gate |
| **Nyxen** (P1/P2) | "This Unit deals 100%/200% damage **when its Shield is directly damaged**." | shield-hit gate |
| **Centurion** (P2/P3) | "When this Unit **or an adjacent ally** is directly damaged, this Unit **retaliates dealing** 50%/100%." | self-or-adjacent-ally trigger |

Notes on the verbatim text:
- **Centurion's clause ends "retaliates dealing 50%." — there is no trailing word
  "damage"** (the `<unit-damage>` tag wraps just "50%"). The parser must anchor on
  *"retaliates dealing X%"* as well as *"deals X% damage"* and must NOT require the
  literal word "damage". Centurion's counter is **flat** (50/100%), not scaled by
  adjacent-ally count — the "per adjacent ally" scaling is a separate
  start-of-combat attack buff in the same cells (see M1).
- **Co-located abilities (M1):** these passive cells contain MORE than the counter
  — Stalwart also "gains Legion Discipline II for 3 turns" (and P2 "+20% Attack
  when adjacent to a Supporter"); Centurion's cells also carry "At the start of
  combat, this Unit gains 500/750/1000 attack per adjacent ally". The `counter`
  ability models **only the damage**; the co-located buffs parse as independent
  abilities and **must not regress**. The parser change splits one cell into
  multiple abilities (a `counter` plus the existing buff/start-of-combat parses).

**Explicitly out of scope (YAGNI — no ship uses them):** HP-threshold-gated
counters ("while below 40% HP"), attacker-debuff-gated counters ("by an enemy
affected by Taunt/Provoke").

## Locked rules (user-ratified during brainstorm)

1. **Full damage walk, not bomb-like.** A counter runs the **owner's** live
   effective stats through the real damage pipeline against the attacker: target
   **defense mitigation**, the owner's **penetration**, **affinity** (owner vs
   attacker), **crit** (owner's own crit chance/damage), **shield absorption** on
   the attacker, reduces HP, **can kill**.
2. **No re-counter (no ping-pong).** The counter-hit is real damage but does
   **not** itself trigger the attacker's counterattack or `on-attacked`
   reactives. It still resolves through normal damage application (the attacker's
   shields absorb it). This prevents counter→counter→counter loops.
3. **Once per triggering attack.** A multi-hit attack (3 `attacked` events) or an
   AoE that hits self + multiple adjacent allies triggers **one** counter that
   turn (one retaliation), via a once-per-turn guard — not one per hit/victim.
4. **Damage basis = owner's effective attack × multiplier.** (e.g. 30/70/100/200
   → ÷100.) Consistent with the existing reactive-damage basis, but now mitigated
   and crit-capable.
5. **Retaliation target = the attacker** (the enemy who dealt the triggering
   direct hit), routed via the existing `counterTargetId`/`attackerId`.
6. **Owner & attacker must be alive at resolution.** A counter does not fire if
   the owner is destroyed when it would resolve (`owner.destroyedRound ===
   undefined`) — a destroyed unit can't retaliate (this differs from Reflect's
   thorns, which fire on the wearer's lethal hit). It also no-ops if the attacker
   is already destroyed (mirrors Reflect's `attacker.destroyedRound === undefined`
   guard, engine.ts:3047). A **stasised** owner is already suppressed by the
   existing reactive-drain filter (`isStasised(intent.ownerId)` continue).

## Architecture (Approach A — new counter path + reuse damage pipeline)

### New reactive `counter` ability config

A distinct ability config variant (NOT a flag on the bomb-like `damage` type —
keeps the two semantics cleanly separated). Shape (final names settled in plan):

```ts
{ type: 'counter'; multiplier: number; hits?: number;
  // condition gates (all optional, default off):
  requirePrimaryTarget?: boolean;   // Stalwart
  requireShieldHit?: boolean;       // Nyxen
  // procChance?/oncePerRound? inherited from the shared Ability fields
}
```

Triggers: `on-attacked` (Stalwart, Nyxen) or `on-ally-attacked` (Centurion);
both already route `counterTargetId = e.attackerId`.

### Executor (`triggers.ts`)

A new branch (sibling of the `cfg.type === 'damage'` branch at ~1763) for
`cfg.type === 'counter'`:
- honor `passesProcChanceGate` / `passesOncePerRoundGate` (existing);
- enforce the **once-per-attack** guard (see below);
- evaluate the condition gates from `intent.eventCtx`
  (`isPrimaryTarget`, `shieldWasHit`);
- call the new `ctx.applyCounterAttack(ownerId, attackerId, multiplier, hits)`
  delegate instead of `creditReactiveDamage`.

### Engine helper `applyCounterAttack` (`engine.ts`) — anchored on the Reflect path

**The existing Reflect implementation is the direct precedent and validates
Approach A.** Reflect already performs nearly exactly the proposed counter:
`applyVictimDamage(..., { isReflected: true })` (the per-round closure spanning
engine.ts:2782–2989, with the reflect branch ~2990–3078) drains the target's
shield→HP per the H1 shield rules, runs full death handling/`recordDestroyed`,
resolves affinity wearer→attacker (3051), reads attacker defence via
`effectiveStatsOf` (3055) and attacker incoming-reduction (3065), guards
`attacker.destroyedRound === undefined` (3047), and **emits no `attacked`/reaction
events** (comment 2997–2998) — i.e. no ping-pong already. `applyCounterAttack`
**reuses this same no-event apply path**.

Two things the spec must be explicit about (raised in review):
- **It is a per-round closure, not a trivial credit.** Unlike `creditReactiveDamage`
  (engine.ts:3791, a one-liner), `applyVictimDamage` is rebuilt each round and
  captures `r`, `actingActorId`, the sinks, and `allActorsById`. Exposing
  `applyCounterAttack` on `IntentExecContext` means **capturing this per-round
  closure into the per-round ctx** (the ctx is already rebuilt per round next to
  `creditReactiveDamage`). Feasible, but more than "add a field".
- **Damage computation:** the raw counter amount = owner's effective stats run
  through `victimHitDamage` (`victimDamage.ts:74`, pure — takes
  `AttackerDamageScalars` + `VictimDefenseProfile` + a **pre-decided `didCrit`** +
  roleScale) against the attacker's defense profile, with `multiplierPct =
  rawMultiplier` (e.g. 30/70/100/200) and the owner's penetration/affinity.
  Reflect instead uses its own `reflectedDamageForHit` (% of incoming); the plan
  picks one — default is `victimHitDamage` (it is the general mitigation+crit
  formula the counter wants), feeding its output into the reflect-style no-event
  apply path.

**Crit (rule 4):** `victimHitDamage` does NOT roll crit — it takes a `didCrit`
boolean. To make the counter crit-capable, `applyCounterAttack` first **rolls the
owner's crit** (the owner's effective crit chance via the same rate-gate
machinery the normal attack path uses) to produce `didCrit`, then computes/applies.
The plan pins which RNG/rate-gate stream this draws from. Because counters are new
and **dormant in every existing fixture** (the parser produced none before), no
golden draws this gate → production stays byte-identical.

**No-re-counter enforcement (rule 2):** inherited for free from the reflect apply
path — it emits no `attacked` event, so it cannot re-trigger `on-attacked`/counter
reactives. Shield absorption is internal to `applyVictimDamage` (engine.ts
~2855–2863), not a reactive, so the attacker's shields still soak the counter.

### Once-per-attack guard — NEW per-turn guard (NOT per-round)

`attacked` fires per-hit, so a multi-hit attack or an AoE hitting self + multiple
adjacent allies produces several `attacked` events **within the attacker's single
turn**. The guard must collapse those to **one** counter, while still allowing a
*separate later attack* (a different turn) to counter again.

**The existing `oncePerRound` / `hitThisRound` patterns are the WRONG model** —
both are keyed per round and cleared at round start (`oncePerRoundConsumed`
engine.ts ~3844; `hitThisRound` cleared ~2532). A per-round guard would wrongly
suppress a *second, separate* attack's counter in the same round. So this is a
**new** guard:

- A combat-scoped Set keyed `${counterOwnerId}:${abilityId}`, populated when a
  counter fires, **cleared at every actor-turn boundary** (start of each turn) —
  not at round start.
- Because all `attacked` events of one attack fall within one attacker turn,
  clearing per-turn yields exactly "once per triggering attack": multi-hit/AoE in
  one turn → one counter; a different attacker's turn (or a later extra action) →
  the guard is clear → counters again.

The plan pins the precise clear site (the per-turn reset already present in the
turn loop) and the key shape.

## New signals

**Plumbing caveat (review I5):** both new signals are *known* at seams that are
**detached from the single `attacked` emit site** (engine.ts:4971, which emits
per-crit from `hitOutcomes`, not per-victim-with-role and not per-apply-call).
Threading them is more than "add a field" — the plan must carry role and absorb
data forward to the emit. This is plan-level plumbing; the data sources are pinned
below.

### `isPrimaryTarget` on the `attacked` event (Stalwart)

The `attacked` event (`events.ts:199`) carries no primary-vs-splash flag. The
positional path already distinguishes a **primary/origin cell (roleScale 1.0)**
from **covered/splash cells (0.5)** via `roleScaleFor` (`positionalApply.ts` ~19/37,
`role === 'origin'`). Add `isPrimaryTarget?: boolean` to the event, sourced from
`role === 'origin'`, set true for the directly-targeted victim and false/absent
for splash/covered victims. Stalwart's gate (`requirePrimaryTarget`) fires only
when true. In the non-positional/aggregate path (single focus target / legacy
`tgt`) the lone target is primary → true.

### `shieldWasHit` signal (Nyxen)

Nyxen counters only when the direct hit **actually reduced the shield pool**
(absorbed > 0). The shield-absorb amount is known at the apply seam
(`victim.shieldPool -= absorbed; addShieldAbsorbed(...)`, engine.ts ~2862). Thread
a `shieldWasHit?: boolean` (absorbed > 0) forward to the `attacked` emit. Nyxen's
gate (`requireShieldHit`) fires only when true. A hit that fully penetrates to HP
without touching shield, or a victim with no shield, → false → no counter. (Note:
this requires shield sources to be active — H is merged, so Nyxen's own
shield-grant skill and the Shield gear set make this live.)

### Enemy-side counters are OUT OF SCOPE for G (review I4)

The **only** `attacked` emit site (engine.ts:4971) fires when an **enemy attacks a
player-side victim** (`attackerId = enemy actor`, `targetId = tgt` = player ship).
**Enemy ships hit by the player never emit `attacked`.** Therefore enemy-side
counters cannot fire without adding enemy-victim `attacked` emission — and doing
so would light up **every enemy `on-attacked` reactive** (Second Wind, Tenacity,
Reactive Ward, …), not just counters, with broad two-team golden churn. That is a
separate piece of the enemy-team-support work, not G.

**G models PLAYER-side counters** — the primary use case: the player equips
Stalwart / Nyxen / Centurion and they retaliate against enemy attacks. This fully
delivers the corpus for the player. Enemy-side parity (those ships countering on
the enemy team) is **explicitly deferred** to the enemy-victim-`attacked`-emission
work. The integration tests therefore assert **player-side** counters; no
"enemy-side mirror" test is claimed for G.

### Centurion — `on-ally-attacked` + adjacency

Centurion fires when **self or an adjacent living ally** is directly damaged.
- Rides the existing `on-ally-attacked` listener (`triggers.ts:509`) **plus** the
  self path, and gates the ally branch on **adjacency** via the existing
  `adjacentAllyIdsFor` delegate (`triggers.ts:262`, `adjacency.ts`).
- Retaliation still comes from **Centurion** against the **attacker**
  (`counterTargetId = e.attackerId`), not from the damaged ally.
- Positional adjacency uses board positions; falls back to all-allies when
  positions aren't wired (same contract as Fortifying Shroud — production callers
  don't wire positions yet, so the integration tests drive the positional path).
- The once-per-attack guard ensures one retaliation even if an AoE hits Centurion
  + multiple adjacent allies in one attack.

## Parser auto-detection (`skillTextParser.ts`)

`detectReactiveTrigger` gains a **damage path**. The consequence anchor must match
**both** corpus phrasings and must NOT require the literal word "damage" after the
percent (Centurion ends "retaliates dealing 50%."):
- *"it deals **X%** damage to that enemy"* (Stalwart) and
- *"this Unit **retaliates dealing X%**"* (Centurion) and
- *"This Unit deals **X%** damage when its Shield is directly damaged"* (Nyxen)
  → `counter` ability with `multiplier = X`.

Condition/trigger flags:
- *"… **as a primary target** …"* → `requirePrimaryTarget: true` (Stalwart).
- *"… when its **Shield** is directly damaged …"* → `requireShieldHit: true`
  (Nyxen).
- *"… this Unit **or an adjacent ally** is directly damaged … retaliates …"* →
  trigger `on-ally-attacked` (+ self) with adjacency gate (Centurion).
- otherwise → trigger `on-attacked` (Stalwart, Nyxen).

**False-positive & regression guards:**
- "directly damaged" also appears in heal (Guardian/Makoli), shield-grant
  (Malvex "gains Shield"), and **reflect** (Nosorog "reflects 40% of the Damage
  taken") clauses. The damage path must match **only** when the consequence is a
  counter ("deals X% damage to that enemy" / "retaliates dealing X%"), and must
  not collide with the existing reflect parse.
- **Co-located ability preservation (M1):** Stalwart's cell also grants Legion
  Discipline II (and P2 a Supporter-adjacency attack buff); Centurion's cells also
  carry start-of-combat "+N attack per adjacent ally". The parser splits the cell
  into the new `counter` PLUS the existing buff/start-of-combat abilities — the
  pre-existing parses for those must remain unchanged (asserted in tests).
- `npm run audit:skills` must stay green (141/0) and Stalwart, Nyxen, Centurion
  must newly parse a `counter` ability (verified via coverage/audit).

## PR split

- **PR1 — foundation + Stalwart.** `counter` ability config + executor branch +
  `applyCounterAttack` engine helper (full walk via `victimHitDamage`) +
  once-per-attack guard + `isPrimaryTarget` signal/gate + parser auto-detect for
  the plain "directly damaged [as a primary target] → deals X% damage" form.
  Lights up **Stalwart**.
- **PR2 — Nyxen + Centurion.** `shieldWasHit` signal + `requireShieldHit` gate
  (Nyxen) + `on-ally-attacked`/self routing with adjacency gate (Centurion) +
  parser detection for the shield-hit and adjacent-ally phrasings.

## Testing & goldens

- **Production byte-identical** expected: no current fixture plays these as live
  counters (the parser was inert), so DPS/healing/single-enemy goldens shouldn't
  move. Two-team-sim fixtures that newly fire a counter = **audited** churn only,
  never `vitest -u`.
- Unit tests: `victimHitDamage`-based counter magnitude (mitigation + crit +
  affinity + shield absorb), no-re-counter (a counter against an attacker that
  *also* has a counter fires only the first), once-per-attack (3-hit attack → 1
  counter; AoE self+2 allies → 1 Centurion counter).
- Integration (`runCombat` via real `buildShipAbilities`, **player-side** ships):
  Stalwart dents/kills a primary attacker but does NOT counter when hit as splash;
  Nyxen counters only when shield absorbed > 0 (and not when fully penetrated / no
  shield); Centurion retaliates when self OR an adjacent ally is hit, with
  positional adjacency driving the trigger. No enemy-side mirror is asserted
  (enemy victims don't emit `attacked` — see review I4 / Enemy-side scope above).
  Confirm the co-located buffs (Stalwart Legion Discipline II; Centurion
  start-of-combat attack) still parse and apply (M1 non-regression).
- `npm run audit:skills` green (141/0); the three ships newly carry a parsed
  `counter` ability; `npx tsc --noEmit` + `npm run lint` clean.

## Open items for plan phase

- Exact `counter` config field names and whether `hits` is needed (all three
  ships are single-hit → likely default 1).
- The precise per-turn clear site + key shape for the once-per-attack guard
  (resolved to per-turn, not per-round — see guard section).
- Crit roll: which rate-gate/RNG stream `applyCounterAttack` draws the owner's
  crit from, and confirming no existing fixture draws it (byte-identical).
- Whether to compute the raw via `victimHitDamage` (default) or reuse Reflect's
  `reflectedDamageForHit` — both precedents exist; the apply path is the shared
  reflect no-event walk either way.
- The exact plumbing of `isPrimaryTarget` (role) and `shieldWasHit` (absorbed>0)
  forward to the `attacked` emit (engine.ts:4971), which is detached from those
  seams (review I5).
- Whether the counter damage records under a distinct event kind for sim
  surfacing vs. folding into the normal direct-damage sink. Default: normal direct
  sink, no `attacked` event (preserves no-re-counter).
