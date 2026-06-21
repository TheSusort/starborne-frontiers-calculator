# Combat Realism Epic — Sub-project D: Implant + Gear-Set Abilities (Design)

**Date:** 2026-06-20
**Sub-project:** D (new ability sources: implants + gear-set skills).
**Parent:** `docs/superpowers/specs/2026-06-17-combat-realism-epic-roadmap.md`.
**Status:** design (brainstorm complete, user-approved through coverage + testing sections).

## 1. Context

The combat engine derives a ship's abilities **only** from its skill text. `buildShipAbilities(ship)`
(`src/utils/abilities/buildShipAbilities.ts:1368`) iterates `getShipSkillRows(ship)` and never reads
`ship.equipment` or `ship.implants`, even though both are present on the `Ship` it receives. As a
result, **implant and gear-set special effects are entirely absent from the combat engine** (a grep
across `src/utils/combat/` finds nothing).

The effect data already exists, as `description` strings analogous to `ship-skills.csv` text:

- **Implants** — `src/constants/implants.ts`. Each `ImplantData` has `variants[]` keyed by rarity;
  each variant carries optional `stats[]` and an optional `description` (the special effect, e.g.
  Bloodthirst: "On a critical hit, there is a 12% chance for this unit to repair itself for 12% of
  the damage dealt"). Minor implants (alpha/gamma/sigma) are stat-only (no `description`).
- **Gear sets** — `src/constants/gearSets.ts`. `GearSetBonus` carries `stats[]` and an optional
  `description` for special-effect sets (Boost, Burner, Decimation, Leech, Reflect, Shield, Cloaking,
  Hardened). Most sets are stat-only.

**Stat-only portions are already handled.** The combat simulators read pre-resolved combat stats
(`battleSimulator.resolveStats` reads `ship.baseStats`/`statOverrides`; `calculateTotalStats` folds
gear + set + implant + engineering stats). D therefore adds **only the special-effect abilities** —
it never re-adds stats.

**Precedent:** `src/utils/autogear/arcaneSiegeUtils.ts` already models one implant effect (Arcane
Siege +damage while shielded), but only inside autogear scoring — not the combat engine.

This is the first node of sub-project D. The epic roadmap scopes D as "data model → parse →
`buildShipAbilities` → ride A/B/C machinery"; effects needing genuinely new machinery belong to other
sub-projects (shields → H, reflect → G, pre-fight stat conversion → F).

## 2. Goals / non-goals

**Goals**

- A reusable **source layer** that resolves a ship's equipped implants + active gear sets into parsed
  abilities, merged into the engine's ability pipeline at the call sites that already have inventory.
- A **probability model** for procs consistent with the engine's existing deterministic resolution.
- Light up the **category-1** effects (those that ride existing engine machinery) over a sequence of
  reviewable PRs, starting with a thin vertical slice.

**Non-goals (deferred, with their owning sub-project)**

- Shield grants (Abundant Renewal, Lifeline, Adaptive Plating, Shield set) → **H**.
- Reflect (Reflect set) → **G**.
- Start-of-combat stat conversion (Code Guard, Cipher Link) → **F**.
- Concentrate-Fire / Provoke **appliers** (Doomsayer, Bulwark) — Phase 3 flagged forced-targeting
  appliers as future work; deferred within D (own slice, likely with adjacency).
- No autogear/scoring changes — D is combat-engine-only. (`arcaneSiegeUtils` stays as is.)
- No UI for toggling the chance model in this sub-project (possible later enhancement).

## 3. Chance model (cross-cutting decision — LOCKED)

The engine resolves **all** probabilistic events (crit, debuff-landing, DoT-extension) with a
**deterministic fractional accumulator**, `makeRateGate()` (`src/utils/calculators/rateAccumulator.ts`):
a 70% rate over 10 calls fires exactly 7 times, reproducible, no `Math.random`. Each distinct
event gets its own gate instance (state persists across calls).

**Decision:** implant/gear-set procs ride the **same mechanism**. Each proc gets its own
`makeRateGate()` instance (per owner-proc), fired at the proc's chance each time its trigger fires.
This is faithful to expected frequency, deterministic, reproducible, and consistent with how crit and
landing already behave in this engine. (Always-fire and user-toggle were considered and rejected;
always-fire overstates value and diverges from the "close to the game" goal.)

The parser must therefore extract a generic **`procChance`** from the description ("N% chance to …")
and thread it onto the ability; the engine allocates and feeds a per-proc gate.

## 4. Architecture

### 4.1 New module: `buildEquipmentAbilities`

A sibling to `buildShipAbilities` (not a modification of it — keeps skill-text parsing focused and the
new concern independently testable). It mirrors the inventory-access pattern of `calculateTotalStats`
(which takes a `getGearPiece: (id) => GearPiece | undefined` closure rather than importing a context):

```ts
buildEquipmentAbilities(
  ship: Ship,
  getGearPiece: (id: string) => GearPiece | undefined,
): PositionedAbility[]
```

Responsibilities:

1. **Resolve active gear sets** — count `ship.equipment` pieces by `setBonus` via `getGearPiece`; keep
   sets meeting their threshold (≥2, or `minPieces: 4`). Filter to sets with a `description`
   (special-effect); stat-only sets are skipped.
2. **Resolve equipped implants** — `ship.implants` (slot → inventory id) → `getGearPiece` →
   `setBonus` (= implant name) + `rarity` → `IMPLANTS` variant `description`. Skip variants with no
   `description` (stat-only minors).
3. **Parse each description** → abilities, tagged with a `source: 'implant' | 'gear-set'` marker for
   display/debugging.

There is no committed set-count helper today (autogear and `statsCalculator` each count inline); this
module owns a small "active sets for a ship" resolver.

### 4.2 Parsing layer (reuse + two new primitives)

Reuse `abilitiesFromText` / `skillTextParser` on the description strings — the effect *bodies* ("gain
Speed Up 3 for 2 turns", "inflicts Disable", "repair X% of allies' max HP") are exactly what the
existing parser handles. Extend it with:

- **`procChance` extractor** — a generic "N% chance to …" detector (§3). The leading chance clause is
  stripped/recorded so the remaining body parses normally; the chance is threaded onto the ability.
- **Generalized `oncePerRound` / `oncePerCombat`** — the cap infrastructure exists but is scoped to the
  cheat-death / extra-action paths today (`buildShipAbilities.ts:994`, `skillTextParser.ts:1319`).
  Generalize so equipment effects ("limited to once per round", "once per battle") set the cap.

Isolation requirement: feeding equipment text through the shared parser must not change ship-skill
parsing. The new primitives are additive and only engage on the equipment text path.

### 4.3 Merge point

Merge the abilities returned by `buildEquipmentAbilities` into the `ShipSkills` from
`buildShipAbilities`, into the **passive slot**. Equipment effects are all passive/reactive/
conditional-aura, so they ride the same machinery the engine already runs over passive abilities
(round-1 timed-status seeding + reactive registration). `buildShipAbilities`'s single-arg signature is
untouched → every existing test that calls it stays byte-identical.

**Inventory access is NOT free at the merge sites — it must be plumbed (D-PR1 foundation work).**
The two `buildShipAbilities(ship)` call sites differ:

- **`battleSimulator` (`planPlacement`, ~`:530`)** does **not** hold a `getGearPiece` resolver today.
  `planPlacement` receives only a `BattlePlacement` (ship + position); `resolveStats` reads
  pre-resolved `statOverrides`/`baseStats` (the page layer resolves gear and passes stats in). Only the
  raw equipment/implant ids are on `p.ship` — not the resolver closure. So D-PR1 must **thread a
  `getGearPiece`-style resolver into `simulateBattle`'s input contract / `planPlacement`'s signature**.
  This plumbing is non-trivial and is explicitly part of the foundation, not an afterthought.
- **`HealingCalculatorPage`** is a React page with inventory context in scope and is the more likely of
  the two to already have a resolver. Verify and reuse it.

(Plan-time verification: (a) which sites already have a resolver vs. need plumbing — see Open
Question #4; (b) confirm the passive slot is the correct merge target for reactive-triggered and
conditional-aura abilities, and that round-1 seeding + reactive registration pick them up.)

### 4.4 Error handling — graceful skip, never throw

Equipment is user-imported and noisy (descriptions contain typos: "icnreawse", "grans", "sheild").
Unlike the targeting parser (which throws on unknown tokens), equipment-effect parsing must degrade
gracefully: a missing gear piece, an unparseable description, or an unrecognized implant yields **no
ability** and never breaks a ship's combat.

## 5. Effect coverage

### 5.1 Deferred to other sub-projects (category 2)

- Shield grants → **H**: Abundant Renewal, Lifeline, Adaptive Plating, Shield set.
- Reflect → **G**: Reflect set.
- Start-of-combat stat conversion → **F**: Code Guard, Cipher Link.

### 5.2 In scope (category 1), bucketed by engine mechanism

| Bucket | Implants / sets | New triggers/conditions needed |
|---|---|---|
| **Conditional outgoing dmg** | Intrusion, Arcane Siege, Giant Slayer, Menace, Insidiousness, Warpstrike, Voidfire Catalyst | self-shielded, target-higher-attack; detonation modifier |
| **Conditional incoming reduction** | Voidshade, Nebula Nullifier, Hyperion Gaze, Vortex Veil, Shadowguard, Ironclad, Hardened set | self-stealthed/stasised, crit-hit-by-stealthed, DoT-source, nth-hit |
| **Reactive self/ally buffs** | Alacrity, Ambush, Smokescreen, Firewall, Last Stand, Lockdown, Resonating Fury, Font of Power, Spearhead, Fortifying Shroud, Tenacity | end-of-round-if-not-hit, on-debuffed, on-resist, on-shield-applied, on-heal-cast, periodic, big-hit; adjacency |
| **Reactive heal/leech** | Bloodthirst, Second Wind, Exuberance, Nourishment, Vivacious Repair, Leech set | on-crit-hit-received; heal-received / heal-cast modifiers |
| **On-death** | Battlecry, Last Wish, Martyrdom | killer-identity (Martyrdom) |
| **Charge / DoT / cleanse** | Chrono Reaver, Burner set, Decimation set, Reactive Ward | periodic charge; DoT applier/modifier; reactive cleanse |
| **Net-new mechanics (cat-3)** | Boost set (buffs last +1 turn), Cloaking set (grant Stealth) | new duration / stealth-grant primitives |
| **Forced-targeting appliers (deferred within D)** | Doomsayer (CF), Bulwark (Provoke), Synaptic Resonance (on-enemy-repaired) | CF/Provoke appliers (Phase-3 future work) |

Minor stat-only implants (Citadel, Haste, Onslaught, Precision, Sentry, Strike, Barrier, Override,
Bastion, Devastation, Guardian) are out of scope — already in combat stats.

### 5.3 Subtleties to carry into plans

- **Martyrdom** needs killer-identity tracking (which enemy dealt the killing blow).
- **Adjacency** (Bulwark, Fortifying Shroud) needs positional adjacency — board geometry exists from
  Phase 1 (`src/utils/targeting/board.ts` `neighbors()`).
- Several effects scale or gate on **crit** (Menace, Reactive Ward, Second Wind) or self/target status
  (stealth, shielded, debuffed) — reuse existing condition machinery where it exists.

## 6. Phasing (PRs within sub-project D)

- **D-PR1 — Foundation + thinnest vertical slice.** The whole source pipeline
  (`buildEquipmentAbilities` + inventory-resolver plumbing into the merge sites per §4.3 +
  passive-slot merge) + the two parse primitives (`procChance`, generalized once-per) + a handful of
  effects that reuse triggers/conditions that **already exist**: Menace & Giant Slayer (on-crit /
  conditional-damage), Bloodthirst (on-crit leech), Leech set, Intrusion (per-debuff-on-target
  scaling). Proves plumbing + chance end-to-end with near-zero new engine machinery. Note: threading
  `getGearPiece` into `simulateBattle`/`planPlacement` (§4.3) is a real part of this PR's scope.
- **D-PR2…N — one trigger/condition family per PR**, each pulling in its implants (incoming-reduction
  conditions; new reactive triggers; on-death; periodic/charge; DoT; net-new mechanics).
- **Deferred slice within D:** CF/Provoke appliers (Doomsayer, Bulwark), aligned with the forced-
  targeting applier work Phase 3 flagged (likely with adjacency).

## 7. Testing & invariants

- **Unit — `buildEquipmentAbilities`:** set-count thresholds (≥2 / `minPieces`), implant
  id→name+rarity→description resolution, stat-only variants skipped, `source` tagging, graceful skip on
  missing/unparseable input.
- **Unit — parse primitives:** `procChance` extraction across the corpus phrasings; generalized
  once-per.
- **Integration — D-PR1 effects:** assert the rate accumulator fires at expected frequency (a 50% proc
  over N triggers fires N/2 times) and the conditional damage / leech lands.
- **Coverage harness** analogous to `audit:skills` for the implant/set corpus, tracking parse coverage
  as later PRs add effects. (The corpus is committed TS constants, always available — no gitignored-CSV
  skip needed.)
- **Load-bearing invariant:** existing DPS / healing / battle-sim goldens stay **byte-identical** — the
  new builder only runs where inventory is threaded, and `buildShipAbilities` is unchanged.
  **Plan-time risk to verify (do this FIRST, before any merge wiring):** if any existing
  `battleSimulator`/healing fixture builds a ship that carries equipped implants or active sets with
  special-effect descriptions, those goldens **will** churn once the merge is wired. The plan's first
  step should be the fixture audit (grep battle-sim/healing fixtures for effect-bearing implants/sets)
  so the byte-identical invariant is confirmed empty before it can silently break; then neutralize the
  fixture or deliberately audit the churn (never `vitest -u`).

## 8. Open questions for the plan

1. Exact `procChance` regex shape and the set of "once per …" phrasings in the corpus.
2. Whether the passive-slot merge needs a dedicated source slot or rides the existing passive slot.
3. The precise list of conditions/triggers that already exist vs. must be added for the D-PR1 set
   (characterize before writing the plan).
4. Inventory-threading mechanics at each call site (does each site already hold a `getGearPiece`-style
   resolver, or does one need plumbing?).
