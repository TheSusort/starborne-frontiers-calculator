# #396 — Cross-store family shadowing beyond the two outgoing channels

**Status:** design · 2026-08-25
**Rule:** [[reference_highest_tier_wins_rule]] — highest tier wins for ALL buffs/debuffs,
regardless of which side applied it. DoTs (`Corrosion`, `Inferno`) and bombs are the ONLY
exceptions; they stack.

---

## 1. Audit (measured, not assumed)

### 1.1 Which channels have a cross-store meeting point

Enumerated by finding every reader of the ENEMY store and checking whether its value is combined
with a SELF-store value on the same `parsedEffects` channel.

| Channel(s) | Enemy-side read | Self-side read | Combined at | Today |
|---|---|---|---|---|
| `attack`, `outgoingDamage` | `victimOwnEnemyOutgoingFamilies` | `activeSelfBuffs` + `abilitySelfEffects` | `playerTurn.ts` ~:2696 | **shadowed** (#389) |
| `defense` | `toEnemyModifiers(victimEnemyBuffs)` | `toSelfDefenseModifier(victimSelfBuffs)` | `engine.ts` `victimIncomingModifiers` | **additive** |
| `incomingDamage` | `toEnemyModifiers(victimEnemyBuffs)` | `toSelfIncomingDamageModifier(victimSelfBuffs)` | `engine.ts` `victimIncomingModifiers` | **additive** |
| `incomingHeal`, `outgoingHeal` | `victimOwnEnemyHealModifiers` | `resolveSelfBuffTotals` + `abilitySelfEffects` | `playerTurn.ts` :1846 (+ `liveHealChannelPct`) | **additive** |

**No other channel has a meeting point.** `incomingDotDamage` is read from the enemy list only
(`toDotAndPenModifiers`' `enemy` arg) and never from a self list, so it cannot straddle.
`dotDamage` / `detonationDamage` / `defensePenetration` / `hotPct` are read from the self/attacker
list only.

### 1.2 Bycatch — enemy-store channels nothing reads

`crit`, `critDamage`, `speed`, `hacking`, `security`, `hp` are folded ONLY by
`foldActorBuffTotals`, which reads `timedAbilityStatuses('self', actorId)` plus the scheduled
`selfBuffLookup`. The enemy store is not among its sources. That makes an enemy-applied
`Crit Rate Down` / `Crit Power Down` / `Speed Down` / `Hacking Down` / `Security Down` structurally
invisible to the stat fold — the same "dead enemy-store channel" shape #389 found for
`attack`/`outgoingDamage`.

**NOT CONFIRMED BY A BEHAVIOURAL PROBE.** A first attempt registered nothing into the enemy store
(the read came back `[]`), so its zeros measured the probe, not the engine. Filed as a separate
issue with that caveat stated; **out of scope here** — switching a dead channel on is a behaviour
change needing its own game-behaviour confirmation, not a shadowing fix.

Also spotted: `Selenite`'s `Concentrate Fire` uses `ability.target === 'enemy-highest-attack'`,
which is absent from the store-side list in `engine.ts` `registerActorAbilityStatuses` (~:284) —
so it registers on the CASTER's SELF store. Separate issue; not touched here.

### 1.3 Reachability — where a straddle actually comes from

A probe over all 149 corpus ships (335 buff/debuff-typed abilities, target × type census printed
to validate the instrument) found **ZERO families granted from both a self-targeted and an
enemy-targeted ability, on every channel** — including the two #389 already fixed. So the ship
corpus alone never straddles.

The straddle is reachable through the **manual buff pickers**. `GameBuffPicker` filters only
`excludeTypes={['effect']}`, so both `buff`- and `debuff`-typed entries are offered in every
picker: "Attacker Buffs / Debuffs" (self store), "Manual extra enemy debuffs" / "Enemy Buffs /
Debuffs" / "Defense Buffs / Debuffs" (enemy store). A user can tick `Attack Down II` on one side
and `Attack Down III` on the other. `toggleBuff` already family-collapses *within one picker*
(`name.replace(/\s+[IVX]+$/, '')`) — nothing collapses *across* two.

**Consequence for this work:** every channel below is user-reachable, and the fix is not a no-op
today. It also means fixtures must build the straddle from buff LISTS, not from ship kits.

---

## 2. The mechanism

`buffTotals.ts` already holds the whole rule (#389). It is hardcoded to two channels via
`OutgoingChannelContribution` / `OutgoingFamilyEntry` / `outgoingFamiliesOf` /
`shadowedOutgoingDelta`. Generalize the same code to a channel LIST; do not write a second rule.

Kept verbatim: `familyChallengerWins` as the comparison (tier first, magnitude as the tie-break),
post-stacks basis (`value * stacks`), zero-is-not-an-instance in `foldChannel`, `sum` riding
alongside `pct`/`tier`, and `deriveFamilyKey` as the family rule (which is what keeps DoTs and
bombs out — each tier gets its own key).

### 2.1 New shape

```ts
export type ShadowChannel =
    | 'attack' | 'outgoingDamage' | 'defense' | 'incomingDamage'
    | 'incomingHeal' | 'outgoingHeal';

familiesOf(buffs, channels): FamilyMap                     // was outgoingFamiliesOf
shadowedDelta(enemyFamilies, selfBuffs, channels): {
    delta: Record<ShadowChannel, number>;        // add to the SELF-sourced sum
    ownSuppressed: Record<ShadowChannel, number>;// self contribution the enemy shadowed away
}
```

`delta` is unchanged from #389: `Σ over enemy families of (appliedWins ? applied.pct - own.sum : 0)`.
Adding it to the self sum yields `Σ over families of the strongest instance, either side` — and for
an enemy-only family (`own.sum === 0`) it reduces to `applied.pct`, so it carries the whole enemy
contribution.

`ownSuppressed` is new, and only `engine.ts` needs it: `Σ over straddling families of
(appliedWins ? own.sum : 0)`. It exists because `victimIncomingModifiers` publishes a
victim-side/attacker-side SPLIT of one mixed channel (`victimSideIncomingModifier`, #358 addendum
3), and shadowing can move a term from one half to the other.

`outgoingFamiliesOf` / `shadowedOutgoingDelta` stay as thin wrappers over the two outgoing
channels so #389's call site and its direct unit suite are untouched.

---

## 3. Application

### 3.1 `engine.ts` — `victimIncomingModifiers` (`defense`, `incomingDamage`)

Both halves are already in scope at the site (`victimDebuffs` and `victimSelf`, both
`SelectedGameBuff[]`), so this is exact and local.

```
enemyDefenseModifier:  selfDefense + delta.defense
incomingDamageModifier: selfIncoming + delta.incomingDamage + preFightIncoming + exposed
victimSideIncomingModifier: selfIncoming - ownSuppressed.incomingDamage + preFightIncoming
```

`preFightIncoming` (squad-leader baseline) and `exposed` (name-keyed one-shot) are NOT named
families and must stay outside the comparison, exactly as #389 excluded `modifierAbilities` and
`preFight.outgoingDamage`.

Note this ALSO collapses same-family duplicates within the enemy list itself, which the rule
requires and the previous plain `reduce` did not do.

### 3.2 `playerTurn.ts` — heal channels (`incomingHeal`, `outgoingHeal`)

The `enemyAppliedHeal` fold at :1846 cannot do the comparison: the self side needs
`abilitySelfEffects`, resolved ~700 lines later at ~:2516. So:

1. **Delete the `+=` at :1846** (verify nothing between :1846 and the late site reads
   `incomingHealBuff` / `outgoingHealBuff`).
2. Extend the late block at ~:2696 to carry four channels instead of two, using the same
   `ownNamed*` list (`entry.activeSelfBuffs` expanded + `abilitySelfEffects`) — which is exactly
   what the fold consumes, the invariant #389's comment insists on.
3. `args.enemyAppliedHeal` becomes a `FamilyMap` rather than two scalars (mirroring
   `enemyAppliedOutgoing`), so the consumer can compare instead of only add.

**`preFight.outgoingHeal` / `preFight.incomingHeal` stay folded at :1834 and stay outside the
comparison** — same non-named-family reason as `preFight.outgoingDamage`.

### 3.3 `turnCtx` publication + `liveHealChannelPct`

`playerTurn` publishes `enemyAppliedIncomingHealPct` / `enemyAppliedOutgoingHealPct` as "the
enemy-applied portion ALREADY INCLUDED in the total", and `triggers.liveHealChannelPct` subtracts
it and adds a live re-read (#367's staleness fence).

Under shadowing the included portion is no longer the raw applied value — it is the **delta
actually applied**. So publish the delta, and make the live re-read shadowed too (it must read the
actor's own named self statuses to do the comparison, which it does not today). With no straddle
the delta equals the raw applied value and every arm is byte-identical to #367.

---

## 4. Tests

Per channel, and each one must first prove the three candidate figures are mutually
distinguishable — weaker instance / stronger instance / their sum — before asserting which wins.
#389's own first cross-family arm was vacuous because its two families sat on independent
channels, so a family-collapse mutation left it green.

1. **Unit (`buffTotals`)** — `familiesOf` / `shadowedDelta` over all six channels: enemy wins,
   self wins, enemy-only family passes through whole, two DIFFERENT families on one channel still
   ADD (the over-collapse guard), DoT/bomb names never collapse.
2. **`engine` (`defense`, `incomingDamage`)** — a straddling family built from buff LISTS
   (§1.3: the ship corpus cannot produce one), asserting the mitigated damage matches the
   stronger instance and not the sum; plus a `victimSideIncomingModifier` arm proving the split
   moves with the shadow.
3. **`playerTurn` / heal (`incomingHeal`, `outgoingHeal`)** — same three-figure shape on a repair,
   plus a `liveHealChannelPct` arm with a SLOW applier (the #367 staleness case) proving it does
   not double-count under shadowing.
4. **Mutation checks** — replacing `deriveFamilyKey` with a constant key must turn the
   over-collapse guards red; removing the shadowing must turn each channel's arm red.
