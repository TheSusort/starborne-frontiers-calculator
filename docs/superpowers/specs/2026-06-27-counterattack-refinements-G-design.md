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

| Ship | Passive text | Variant |
| --- | --- | --- |
| **Stalwart** (P1/P2) | "When this Unit is directly damaged **as a primary target**, it deals 30%/70% damage to that enemy" | plain + primary-target gate |
| **Nyxen** (P1/P2) | "This Unit deals 100%/200% damage **when its Shield is directly damaged**" | shield-hit gate |
| **Centurion** (P2/P3) | "When this Unit **or an adjacent ally** is directly damaged, this Unit retaliates dealing 50%/100% damage" | self-or-adjacent-ally trigger |

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

### Engine helper `applyCounterAttack` (`engine.ts`)

Exposed on `IntentExecContext` like `creditReactiveDamage` (engine.ts ~3791).
It performs a **single full damage walk** owner→attacker by reusing the existing
per-victim pipeline (`victimHitDamage` in `victimDamage.ts:74` + the shared
apply-to-victim path that drains shield then HP, records to the sink, and marks
death). Inputs: owner's effective stats (attack/crit/critDamage/penetration),
affinity(owner→attacker), attacker's defense/shield. It records damage to the
normal sink and applies HP/shield mutation so the attacker can die.

**No-re-counter enforcement:** the counter applies damage **without emitting an
`attacked` event** (the event is what drives `on-attacked`/counter reactives), so
it cannot re-trigger a counter. Shield absorption is part of `applyToVictim`
itself (not a reactive), so it still happens. This is the cleanest seam for rule
2 — analogous to Reflect's "direct slice" but going through full mitigation.

### Once-per-attack guard

`attacked` fires per-hit; the guard collapses a multi-hit/AoE attack to one
counter. Use a per-turn (or per-triggering-attack) set keyed on
`${ownerId}:${abilityId}` populated when the counter fires and cleared at
turn/round boundary — mirrors the `oncePerRound` / `hitThisRound` patterns
already in the engine. (Exact keying — per attacker-turn vs per round — pinned in
the plan; "per triggering attack" is the intent.)

## New signals

### `isPrimaryTarget` on the `attacked` event (Stalwart)

The `attacked` event (`events.ts:199`) carries no primary-vs-splash flag, but the
positional path already distinguishes a **primary cell (full damage, 1.0)** from
**covered/splash cells (0.5)** (`positionalApply.ts:15`). Add
`isPrimaryTarget?: boolean` to the event, set true for the directly-targeted
victim and false/absent for splash/covered victims. Stalwart's gate
(`requirePrimaryTarget`) fires only when true. In the non-positional/aggregate
path (single focus target) the lone target is primary → true.

### `shieldWasHit` signal (Nyxen)

Nyxen counters only when the direct hit **actually reduced the shield pool**
(absorbed > 0). The shield-absorb amount is known at the apply seam
(`victim.shieldPool -= absorbed; addShieldAbsorbed(absorbed, victim.id)` per the
shield system). Thread an `shieldWasHit?: boolean` (absorbed > 0) onto the
`attacked` event (or the eventCtx the listener stamps). Nyxen's gate
(`requireShieldHit`) fires only when true. A hit that fully penetrates to HP
without touching shield, or a victim with no shield, → false → no counter.

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

`detectReactiveTrigger` gains a **damage path**. Recognize:
- *"When [this Unit is] directly damaged … [this Unit] deals/retaliates **X%**
  damage"* → `counter` ability on `on-attacked`, `multiplier = X`.
- *"… **as a primary target** …"* → `requirePrimaryTarget: true`.
- *"… when its **Shield** is directly damaged …"* → `requireShieldHit: true`.
- *"… this Unit **or an adjacent ally** is directly damaged … retaliates …"* →
  trigger `on-ally-attacked` (+ self) with adjacency gate.

Guard against false positives: "directly damaged" also appears in heal
(Guardian), shield-grant (Malvex), and reflect (Nosorog) clauses — the damage
path must only match when the *consequence* is "deals/retaliates X% damage" (not
heal/shield/reflect), and must not collide with the existing reflect parse.
`npm run audit:skills` must stay green and the three target ships must newly parse
a `counter` ability (verified in the audit/coverage).

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
- Integration (`runCombat` via real `buildShipAbilities`): Stalwart kills/dents a
  primary attacker but not when hit as splash; Nyxen counters only when shield
  absorbed > 0; Centurion retaliates when an adjacent ally is hit, positional
  adjacency drives recipient selection, enemy-side mirror.
- `npm run audit:skills` green (141/0); the three ships newly carry a parsed
  `counter` ability; `npx tsc --noEmit` + `npm run lint` clean.

## Open items for plan phase

- Exact `counter` config field names and whether `hits` is needed (Centurion/
  Stalwart are single-hit).
- Once-per-attack guard keying (per attacker-turn vs per round) — pin against the
  multi-hit event cadence.
- Whether the counter damage should record under a distinct event kind for sim
  surfacing (vs. folding into the normal direct-damage sink). Default: normal
  direct sink, no new event (preserves no-re-counter).
