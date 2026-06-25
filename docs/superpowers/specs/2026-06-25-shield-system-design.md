# Shield System (sub-project H) — Design

**Date:** 2026-06-25
**Epic:** Combat-realism (`project_combat_realism_epic`). Sub-project H.
**Status:** H1 SHIPPED (PR #156). H2+H3 refined & approved 2026-06-25 → combined plan next (one PR).

## Goal

Make shields a first-class, faithful combat mechanic in the engine and surface them in the
battle simulator. Today `shieldPool` exists on every actor and drains before HP, but it is
populated **only in the healing calculator** (the heal target), `shieldPenetration` is parsed
onto every ship yet **never consumed**, and several shield-producing abilities are dormant.

This sub-project lights up:

- Shield **penetration** (currently ignored).
- Correct **damage-kind interaction** with shields (DoTs must bypass; bombs full-drain).
- Shields for **all actors** in the battle sim (not just the heal target).
- **Sim surfacing** (per-ship, per-round granted / absorbed / current pool).
- Dormant shield **sources**: Shield gear set, Abundant Renewal, Adaptive Plating,
  Resonating Fury, and Arcane Siege (gate already built).

## Locked game rules (user-ratified 2026-06-25)

1. **Shield pool model:** untimed single scalar pool per actor; all sources add into it;
   **capped at the actor's max HP**; persists until drained by damage (no expiry). This is
   exactly the existing `CombatActor.shieldPool` model — **no timed/per-instance machinery**.
2. **Shield penetration:** `shieldPenetration%` of a **direct hit** bypasses the shield and
   hits HP directly; the remaining `(100 − pen)%` drains the shield first, with overflow to HP.
   (The "80/20" framing: pen 20 ⇒ 20% to HP, 80% eligible to drain shield.)
3. **Bombs:** drain the shield in full, **no penetration** — the whole bomb amount is
   shield-eligible, overflow to HP.
4. **Inferno & Corrosion (DoTs):** **bypass the shield entirely** — tick damage hits HP
   directly and never drains the shield. (This is a behavior change; today DoT ticks drain it.)
5. **Penetration applies everywhere** — both the healing calculator and the battle sim. Enabling
   it re-baselines existing healing goldens (audited churn); enemies always had pen, it was
   simply ignored.

### Damage → shield matrix

| Damage kind | Shield interaction |
| --- | --- |
| Direct hit | `shieldEligible = D × (1 − pen/100)`; `absorbed = min(shieldPool, shieldEligible)`; `hpDamage = D − absorbed` |
| Bomb | `absorbed = min(shieldPool, D)`; `hpDamage = D − absorbed` (pen = 0) |
| DoT (Inferno/Corrosion) | `absorbed = 0`; `hpDamage = D` (bypass) |

Barrier (full immunity) and Cheat-Death interception remain strictly **in front of** the shield
step, unchanged.

**Implementation note — bombs are not a separate apply call.** At the aggregate enemy/focus turn
sites, detonation damage is *summed into* the direct-damage total before it reaches the absorb step
(`engine.ts:4368` `damage = directDamage + detonationDamage`; detonation is credited via the
`'detonation'` channel / `creditDetonation`). So the absorb step cannot key off a single discrete
`damageKind`. The robust model is a **blended shield-eligible amount** computed at the apply site
from the two portions that arrive there:

```
shieldEligible = directPortion × (1 − pen/100) + bombPortion        // DoT excluded entirely
absorbed       = min(shieldPool, shieldEligible)
hpDamage       = (directPortion + bombPortion) − absorbed
```

In practice: the **aggregate path** (enemy → tank, focus → dummy) must thread the bomb portion
separately from the direct portion to the absorb step (today they are pre-summed); the **positional
per-hit path** is all direct (per-hit pen split; per-victim bomb attribution is the E5-deferred
item, so positional bombs stay out of the pen split for now); the **DoT batch** (`byDirectDamage:false`)
bypasses the shield wholesale. The DoT-vs-not split still rides `cause.byDirectDamage`; the
direct-vs-bomb split rides the separated portions, not a flag.

## Existing machinery (grounding, verified 2026-06-25)

- `CombatActor.shieldPool` — `state.ts:108`, init 0 (`state.ts:167`). Drains before HP; capped
  at max HP.
- `grantShieldToTarget(raw, victim = healTarget)` — `engine.ts:2041–2049`; caps at
  `recipientMaxHp(victim.id)`; healing-mode only today. Call sites: `engine.ts:2309/2385/2445/4605`,
  `triggers.ts:1616`.
- Absorb step — `engine.ts:2730–2733` inside the shared `applyVictimDamage` core (~2626–2811):
  `absorbed = min(shieldPool, damage); shieldPool -= absorbed; sink.addShieldAbsorbed(absorbed, victim.id)`.
- `cause.byDirectDamage` distinguishes DoT (`false`) from direct + bomb (`true`); bombs need a
  distinct discriminator from direct hits.
- `shieldPenetration` — defined `types/stats.ts:67`, on ships (`constants/ships.ts`, default 20,
  Quixilver 40), **zero combat consumers**.
- Healing-calc surfacing — `ActorHealing.shield` (`state.ts:28`), `HealingRoundData.shield /
  shieldAbsorbed / targetShieldPool` (`healingEngineAdapter.ts:71–106`), `ShieldGenerated.tsx`.
- Battle-sim surfacing — `ShipRoundState.shieldsAbsorbed` (`battleSimulator.ts:78`, **hardcoded 0**
  at `:260`), rendered as a blue StatCard in `ShipRoundCard.tsx:54–57`. `BattleResult.rounds[].ships[]`
  is the per-ship/round structure; `boardOverlays.ts` drives the board cue.
- Dormant consumers: **Arcane Siege** (`buildEquipmentAbilities.ts:559`, gate
  `{subject:'self-shield'}` already threaded via `selfShielded: actor.shieldPool > 0`,
  `playerTurn.ts:1157`); **Resonating Fury** (`implants.ts:2555`, no `on-shield-applied` trigger
  exists); **Abundant Renewal** (`implants.ts:36`, unparsed); **Adaptive Plating**
  (`implants.ts:1089`, unparsed); **Shield gear set** (`gearSets.ts:111`, stat parsed, no consumer).

## Decomposition (Approach A — 3 PRs)

### H1 — Foundation + penetration + DoT bypass + sim surfacing

**The load-bearing, golden-churning PR.** Everything else is additive on top.

1. **Blended shield-eligible absorb.** Implement the matrix above via the blended-eligibility model
   (see "Implementation note" under the matrix). The DoT-vs-direct/bomb split rides the existing
   `cause.byDirectDamage` flag (DoT bypasses wholesale). For non-DoT damage, thread the **direct
   portion** and **bomb (detonation) portion** separately to the absorb step plus the attacker's
   effective `shieldPenetration`, and compute
   `shieldEligible = directPortion × (1 − pen/100) + bombPortion`. The first planning step is to
   locate where the aggregate `damage` is assembled from `directDamage + detonationDamage`
   (`engine.ts:~4368` enemy turn; check the focus/team sites ~3983/4134 and the focus detonation
   emit ~4727 too) and carry the two portions to the apply site instead of the pre-summed total.
   `hpDamage = totalNonDot − absorbed` throughout.
2. **Attacker penetration plumbing.** Read the acting actor's effective `shieldPenetration` and pass
   it to the apply site for direct hits (both the focus/team aggregate path and the enemy-attack
   path). Static today (not buff-folded — same status as hacking/security pre-backbone; folding is
   out of scope, documented).
3. **DoT bypass.** Route Inferno/Corrosion ticks around the shield drain (`absorbed = 0`). This is
   the behavior fix that contributes to healing-golden churn.
4. **All-actor grant (verify-then-wire).** First confirm the current state: does the battle-sim
   cast path (`simulateBattle` → `runCombat`) already pass a `healing`/shield ctx so a shield
   ability grants to whichever ally it targets? The absorb side already works for any actor; only
   the grant path may be heal-target-defaulted. If grants already reach all actors, this task is a
   confirming test; if not, wire the ctx. Scope here is contingent on that finding — flag it during
   planning before committing.
5. **Surfacing.** Populate `ShipRoundState.shieldsAbsorbed` from the engine per-victim
   `addShieldAbsorbed` sink; add `shieldGranted` and `currentShieldPool` to `ShipRoundState`,
   threaded from engine round-assembly; render the two new StatCards in `ShipRoundCard`; add a
   shield cue to `boardOverlays`/`BattleBoard`.
6. **Arcane Siege goes live for free** — its `self-shield` gate already exists; add a test proving
   it activates once the carrier holds a shield.

**Golden strategy:** audited re-baseline of healing goldens (pen bites + DoTs stop draining
shield), with documented per-scenario numeric justification; **never** blind `vitest -u`. New
battle-sim integration tests for each matrix row + per-actor grant + surfacing fields.

### H2 + H3 — combined PR (shield sources)

**H2 and H3 ship together in one PR** (user decision 2026-06-25), with H2 (gear set) and H3 (three
implants + the new trigger) as ordered phases inside one plan. All sources are byte-identical (no
synthetic fixture equips them). Each source: registry entry + `equipmentCoverage` guard +
mutation-resistant integration test through the real `buildShipAbilitiesWithEquipment` path, per the
established D-PR convention.

#### Reactive shield magnitude — two new bases (shared H3 foundation)

The reactive shield executor (`triggers.ts:~1610`) already computes `raw = basisValue × pct/100`
(FrontLine is precedent for a shield scaled off a runtime amount). Adaptive Plating and Abundant
Renewal each scale off a **triggering-event magnitude**, so H3 adds two basis types that read that
magnitude from the reactive context:

- `damage-taken` — the HP+shield damage of the triggering `on-attacked` hit (Adaptive Plating).
- `overheal-amount` — the clipped overheal of the triggering `on-own-repair-to-ally` event
  (Abundant Renewal). Overheal is already captured at the heal-apply site (`applyHealToTarget`
  returns `{consumed, overheal}`).

#### H2 — Shield gear set

`gearSets.ts:SHIELD` ("Generate 4% shield each turn") → a new `GEAR_SET_ABILITIES.SHIELD` entry: a
`start-of-turn`, `self`, **shield-config** grant (`type:'shield'`, `basis:'self-max-hp'`, `pct:4`)
→ `floor(0.04 × maxHP)` each owner turn. Follows the Fortifying Shroud `start-of-turn` registry
shape but emits a shield config (not a named buff). No proc, no gate.

#### H3 — Reactive shield implants

All percent values below are **percentages applied as `× value/100`** (e.g. `damagePct` 34 means
34% of damage taken). `procChance` values are decimal probabilities (e.g. .16 = 16%).

- **Adaptive Plating** (`on-attacked`, direct-only — DoTs already route through `dot-applied`):
  self-shield = `(damagePct/100) × damage-taken`, **`oncePerRound: true`** (text: "limited to once
  per round"; D-PR precedent). Rarity tables: `procChance` {uncommon .12, epic .16, legendary .19},
  `damagePct` {uncommon 21, epic 34, legendary 42}.
- **Abundant Renewal** (`on-own-repair-to-ally`, **ally overheals only** per text "when
  overrepairing an ally"): shield to the **healed ally** = `(pct/100) × overheal-amount`. Rarity:
  {epic 20, legendary 30}. No proc roll (deterministic), no per-round cap.
- **Resonating Fury** (new `on-shield-applied` trigger): grants **Crit Power Up 3** (existing named
  buff) to self for 1 turn. `procChance` {common .05, uncommon .07, rare .09, epic .12,
  legendary .16}, rolled **per shield-application event** with **NO `oncePerRound` cap** — the game
  text omits the "once per round" clause that Adaptive Plating carries, so it may proc repeatedly in
  a round across multiple shield grants.

#### New `on-shield-applied` trigger

Emitted from `grantShieldToTarget` (the single grant chokepoint), keyed on the **granter** (acting
actor), **only when `actualGranted > 0`** (a fully-capped 0-grant does not proc). Per user decision,
this fires for **any shield the carrier applies**: skill casts, the H2 gear-set start-of-turn grant,
Abundant Renewal, and Adaptive Plating's own self-grant. Requires threading a `granterId` into
`grantShieldToTarget` (currently recipient-only). No shield→shield chain exists (Resonating Fury
grants a buff, not a shield), so there is no re-trigger / infinite-loop risk; the executor's existing
heal/shield no-re-emit guard still applies.

## Components / boundaries

- **`applyVictimDamage` absorb step** (engine) — the only place shield drains; gains damage-kind +
  pen awareness. Single chokepoint, independently testable via the apply path.
- **`grantShieldToTarget`** (engine) — the only place shields are added; H3 emits
  `on-shield-applied` from here (only when post-cap `actualGranted > 0`). H3 adds a `granterId`
  parameter (today `(raw, victim)`) so the event is keyed on the acting actor, not the recipient.
  Cross-source note: a wearer with both the H2 Shield gear set and Resonating Fury will roll
  Resonating Fury off the gear-set's own start-of-turn grant — an intended, tested interaction.
- **Equipment-ability registry** (`buildEquipmentAbilities.ts`) — H2/H3 sources as data entries.
- **`battleSimulator` adapter** — translates engine round data into `ShipRoundState` shield fields;
  the surfacing boundary. UI components consume `ShipRoundState` only.

## Out of scope

- Buff-folding `shieldPenetration` (dynamic pen) — backbone concern, stays static.
- Timed / per-instance shields, shield expiry — ruled out by the untimed-pool decision.
- Shield-granting *ship skills* beyond what's already parsed (skill-text heal-style shields and
  FrontLine's reactive shield already exist and will simply work in battle-sim once H1 lands).
- Overload and other non-shield resources.

## Testing

- **H1:** audited healing-golden re-baseline (documented); battle-sim integration tests for the full
  damage matrix, per-actor grant, surfacing fields, and Arcane-Siege activation.
- **H2/H3:** zero golden drift; registry + coverage-tracker + mutation-resistant integration tests
  via the real `buildShipAbilitiesWithEquipment` path, per the established D-PR convention.
- Gates per PR: full vitest suite green, `npm run lint` (max-warnings 0), `tsc`,
  `npm run audit:skills` unchanged.
