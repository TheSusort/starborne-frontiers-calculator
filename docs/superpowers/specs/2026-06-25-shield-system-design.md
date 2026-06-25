# Shield System (sub-project H) — Design

**Date:** 2026-06-25
**Epic:** Combat-realism (`project_combat_realism_epic`). Sub-project H.
**Status:** Approved design → ready for plan (H1 first PR).

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

1. **Damage-kind aware absorb.** Thread `damageKind: 'direct' | 'bomb' | 'dot'` and the attacker's
   effective `shieldPenetration` into `applyVictimDamage`. Implement the matrix above. `damageKind`
   derives from `cause.byDirectDamage` plus a bomb discriminator (tag the bomb-detonation apply
   path distinctly from direct hits). Note `hpDamage = D − absorbed` holds for direct and bomb;
   only `absorbed`'s ceiling differs.
2. **Attacker penetration plumbing.** Read the acting actor's effective `shieldPenetration` and pass
   it to the apply site for direct hits (both the focus/team aggregate path and the enemy-attack
   path). Static today (not buff-folded — same status as hacking/security pre-backbone; folding is
   out of scope, documented).
3. **DoT bypass.** Route Inferno/Corrosion ticks around the shield drain (`absorbed = 0`). This is
   the behavior fix that contributes to healing-golden churn.
4. **All-actor grant.** Verify the battle-sim cast path grants shields to whichever ally a shield
   ability targets (absorb already works for any actor; grant defaults to heal target). Wire the
   `healing`/shield ctx into `simulateBattle`'s `runCombat` if not already present.
5. **Surfacing.** Populate `ShipRoundState.shieldsAbsorbed` from the engine per-victim
   `addShieldAbsorbed` sink; add `shieldGranted` and `currentShieldPool` to `ShipRoundState`,
   threaded from engine round-assembly; render the two new StatCards in `ShipRoundCard`; add a
   shield cue to `boardOverlays`/`BattleBoard`.
6. **Arcane Siege goes live for free** — its `self-shield` gate already exists; add a test proving
   it activates once the carrier holds a shield.

**Golden strategy:** audited re-baseline of healing goldens (pen bites + DoTs stop draining
shield), with documented per-scenario numeric justification; **never** blind `vitest -u`. New
battle-sim integration tests for each matrix row + per-actor grant + surfacing fields.

### H2 — Standing shield sources

**Shield gear set** = "generate 4% shield each turn" → a `start-of-turn` equipment ability granting
`floor(0.04 × maxHP)` shield, via `GEAR_SET_ABILITIES` (the Cloaking start-of-round / Fortifying
Shroud start-of-turn registry pattern). Byte-identical (no fixture equips it). Registry + coverage
tracker + mutation-resistant integration test through `buildShipAbilitiesWithEquipment`.

### H3 — Reactive shield mechanics

- **Abundant Renewal** — overheal → shield (% of the over-repaired amount). Heals already clamp at
  max HP; the clipped excess is the overheal signal. Needs an overheal hook at the heal-apply site.
- **Adaptive Plating** — damage-taken → shield (% of damage taken, capped **once per round**).
  Reuses the `oncePerRound` gate (D-PR3/D-PR16 precedent) + a damage-taken hook.
- **Resonating Fury** — new `on-shield-applied` trigger emitted at the grant site; its effect rides
  the existing reactive executor.

All three byte-identical (no fixture equips them); registry + coverage + integration tests.

## Components / boundaries

- **`applyVictimDamage` absorb step** (engine) — the only place shield drains; gains damage-kind +
  pen awareness. Single chokepoint, independently testable via the apply path.
- **`grantShieldToTarget`** (engine) — the only place shields are added; H3 emits
  `on-shield-applied` from here. Unchanged signature.
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
