# Special-effect gear sets + Smokescreen — design

**Date:** 2026-06-26
**Sub-project:** D (implants + gear-set abilities), part of the combat-realism epic.
**Status:** design approved; spec under review.

## Summary

Three independent special-effect sources, shipped as a single PR (same shape as
D-PR16: several effects, one reviewed PR):

1. **REFLECT** (gear set) — a new damage-**reflection** ("thorns") primitive. *The substantial piece.*
2. **REVENGE** (gear set) — a new **continuous missing-HP** scaling on the existing `outgoingDamage` channel.
3. **SMOKESCREEN** (implant) — a ride-existing reactive self-buff (Stealth on being directly hit).

No combat fixture equips any of these → goldens stay **byte-identical** (no `-u`).

**Pressure valve:** if REFLECT's plumbing balloons during implementation, split it into
its own PR and ship REVENGE + SMOKESCREEN together.

## Background

These are the last special-effect **gear sets** with `stats: []` plus an effect description
that aren't yet modelled, plus the Smokescreen implant. The remaining un-modelled corpus
after this PR: `VOIDFIRE_CATALYST` (detonation/bomb splash — deferred, overlaps the
deferred positional-bomb work) and `BOOST` (buffs +1 turn — deferred, golden-moving).
Everything else is stat-only (already in combat stats) or already implemented.

Effect text (source of truth, `src/constants/gearSets.ts` / `src/constants/implants.ts`):
- REFLECT: "Reflect 10% of damage dealt"
- REVENGE: "Increase damage by +25% * lost HP%"
- SMOKESCREEN: "When directly damaged, there is an X% chance to gain Stealth for 1 turn."
  (rare 9%, epic 12%, legendary 16% — no common/uncommon variant)

## 1. REFLECT — reflection primitive

### Locked behavior

When the **wearer** takes a **direct hit**, reflect damage back at the **attacker**:

```
reflected = reflectPct% × (net HP damage the wearer took on that hit)
          × affinity(wearer → attacker)
          × (1 − calculateDamageReduction(attacker effective defence))
          → then incoming-reduction buffs, then shield absorb, then HP
```

- `reflectPct` = the set-bonus value (10 for one Reflect set), resolved like other gear-set bonuses (piece-count gate via the existing `buildEquipmentAbilities` logic).
- **Basis = net HP damage the wearer actually took** on that hit — i.e. *after* the wearer's
  own defence, damage-reduction buffs, and shield absorb. (User answer "C".)
- The reflected amount is treated as a real **wearer→attacker damage instance**: it is scaled by
  the wearer-vs-attacker **affinity** and reduced by the **attacker's** defence + incoming
  buffs + shield. It is **not** double-counting the wearer's defence (that lives in the basis;
  this applies the *attacker's* defence).
- **Deterministic** — no proc roll, standing while ≥1 Reflect set is equipped.
- **Direct hits only** — DoT ticks and bomb/detonation do **not** reflect (they emit no
  `attacked`-style direct hit and several already bypass parts of the pipeline).
- Emits **no `attacked` event** and triggers **no** reactive abilities on the attacker
  (no thorns ping-pong, no second Smokescreen/Adaptive-Plating proc off the reflection).
  (User answer Q2 = "A".)
- **Can kill** the attacker — it lands on HP; if it reduces the attacker to 0, the attacker
  dies and on-death effects fire normally. (User answer Q5 = "yes".)

### Empirical verification (two independent in-game duels)

The model was validated against two real duels (defence-curve approximation aside):

| Example | Hit on wearer | Attacker defence | Affinity (wearer→attacker) | Model prediction | Observed | Error |
|---|---|---|---|---|---|---|
| 1 | 28056 | 3001 (DR ≈ 45.8%) | disadvantage ×0.75 | `0.10 × 28056 × 0.542 × 0.75` ≈ **1141** | 1188 | ~4% |
| 2 | 48318 | 4093 (DR ≈ 53.4%) | neutral ×1.00 | `0.10 × 48318 × 0.466 × 1.00` ≈ **2252** | 2227 | ~1% |

The residual error is the calculator's defence curve (`calculateDamageReduction`) being an
approximation of the game's real curve — a discrepancy that already exists for **every**
modelled hit, not specific to Reflect. The mechanic (basis = net-on-wearer, then affinity ×
attacker-defence × shield) reproduces both cases. These two cases become sanity-anchor
assertions in the test suite.

### Engine seam

- **Where:** the victim-side absorb/apply block in `engine.ts` `applyVictimDamage` (the same
  block the shield system drains in, where the net HP damage to the victim is known) — the
  same family of seam that D-PR3 incoming-reduction and Lifeline's incoming-shield-grant hook
  into. **Not** the reactive-damage executor (that path emits events and re-triggers).
- **Attacker resolution:** the attacker's identity is available via `cause.killerId`
  (already threaded for the shield system); resolve the actor through `allActorsById` and read
  its effective defence / affinity via `effectiveStatsOf` + the wearer's affinity.
- **Reuses existing helpers:** `computeAffinityModifiers` (affinity), `calculateDamageReduction`
  (defence factor), `shieldAbsorb` (the H-rules absorb). The reflected raw is run through a
  **mitigation-only** sink (defence × affinity → incoming buffs → shield → HP) that does **not**
  emit an `attacked` event or enqueue reactions.
- **New pure helper:** `reflectedDamageForHit({ reflectPct, netHpDamage, affinityMultiplier, attackerDefenceReduction })` (or similar) returning the raw reflected amount pre-shield, unit-tested in isolation. Shield absorb on the attacker is applied at the engine seam.
- **Registry:** new `GEAR_SET_ABILITIES.REFLECT` entry whose presence marks the wearer as a
  reflector; the engine reads it at the victim seam (analogous to how incoming abilities are
  collected for the victim).

### Surfacing

Reflected damage is real damage dealt to the attacker — fold it into the existing per-actor
incoming-damage accounting for the attacker so it shows in the sim like any other damage. No
new UI primitive.

## 2. REVENGE — continuous missing-HP outgoing scaling

### Locked behavior

```
outgoingDamage bonus (percentage points) = 25 × (caster missing-HP fraction)
```

- Missing-HP fraction = `1 − currentHp / maxHp`, evaluated **live at cast time**.
- At full HP → +0%; at 40% missing → +10%; at 80% missing → +20%; near death → up to +25%.
- **Direct-damage only** (the `outgoingDamage` channel is direct-damage-scoped; DoT/detonation
  separate), consistent with INTRUSION / WARPSTRIKE / ARCANE_SIEGE.

### Engine seam

- **Where:** the existing `outgoingDamage` modifier channel
  (`applyAbilities.ts` `modifierTotalsFromAbilities`), already folded multiplicatively as
  `(1 + outgoingDamage/100)` in the non-crit factor.
- **New scaling source:** today the channel scales only by integer condition **counts**
  (`scaledBonus` via `scaling.conditionIndex`). REVENGE needs a **continuous** missing-HP
  fraction. Add a missing-HP scaling input that reads the caster's current/max HP from the
  modifier round-context (`buildRoundContext` at the modifier site, `playerTurn.ts`), and
  contributes `25 × missingFrac` percentage points. Keep it a distinct, named scaling mode so
  the count-based path is untouched.
- **Registry:** new `GEAR_SET_ABILITIES.REVENGE` entry — a `modifier` / `outgoingDamage`
  ability carrying the missing-HP scaling.

### DPS calculator

**Not wired.** REVENGE evaluates to 0 at full HP, and the DPS calculator runs at full HP, so
the effect is inert there. Documented, not added as dead config.

## 3. SMOKESCREEN — ride-existing reactive self-buff

### Locked behavior

- Trigger: **on-attacked** (direct hits only — DoT/bomb emit no `attacked`, so free).
- Effect: grant **self Stealth, 1 turn**.
- **Plain %-proc, no once-per-round cap** — every direct hit rolls independently
  (consistent with Bloodthirst and the other reactive procs).
- Per-rarity `procChance`: rare 0.09, epic 0.12, legendary 0.16 (no common/uncommon).

### Engine seam

Pure ride-existing — identical pattern to AMBUSH/Cloaking's Stealth grant, but triggered on
`on-attacked` instead of start-of-round. New `IMPLANT_ABILITIES.SMOKESCREEN` registry entry:
reactive self-buff (`type: 'buff'`, `buffName: 'Stealth'`, `duration: 1`, `target: 'self'`,
`trigger: 'on-attacked'`, per-rarity `procChance`). No new engine primitive.

## Testing

- **Pure helpers (unit):** reflection math (basis → affinity → defence → pre-shield raw);
  REVENGE missing-HP scaling (full HP → 0; mid HP → linear; near-death → ~+25%).
- **Engine integration (mutation-resistant):** build through the **real registry**
  (`buildShipAbilitiesWithEquipment` + `setBonus` / implant `setBonus`), not hand-rolled
  abilities (the D-PR16 lesson). Assert: REFLECT reflects mitigated damage to the attacker,
  emits no `attacked`/reaction, can kill; REVENGE scales outgoing damage by missing HP;
  SMOKESCREEN grants Stealth on being hit (with procChance:1 override for determinism).
- **Sanity anchors:** the two duel data points above as magnitude assertions on the reflection.
- **Coverage tracker** (`equipmentCoverage.test.ts`): add REFLECT + REVENGE to the implemented
  gear-set set and SMOKESCREEN to the implemented-implant set (the triple update: list + Set +
  exactly-{} string), plus shape assertions per effect.

## Out of scope / deferred

- **VOIDFIRE_CATALYST** — detonation/bomb splash modifier; overlaps the deferred positional
  per-victim bomb work. Separate later bomb-focused PR.
- **BOOST** — "all buffs last an extra turn"; touches every buff duration, golden-moving;
  deferred.
- **REVENGE in the DPS page** — inert at full HP; not wired.

## Open risks

1. **Attacker resolution at the victim seam** — confirmed `cause.killerId` is threaded, but the
   plan must verify the attacker actor + its effective defence/affinity are resolvable at that
   exact point in `applyVictimDamage`, for both the aggregate and positional apply paths.
2. **Affinity direction** — reflection uses the **wearer's** affinity vs the **attacker** (the
   reverse of the original hit). The plan must confirm `computeAffinityModifiers` is invoked
   with arguments in the reflect direction, not reused from the incoming hit.
3. **Reflect set piece-count gate** — confirm REFLECT/REVENGE resolve their bonus at the correct
   `minPieces` through the existing `buildEquipmentAbilities` gating.
