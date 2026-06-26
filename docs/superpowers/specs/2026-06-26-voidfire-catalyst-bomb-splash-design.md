# Voidfire Catalyst + bomb-splash-on-death — design

**Date:** 2026-06-26
**Sub-project:** combat-realism epic, sub-project D (implants + gear-set abilities) — the deferred
detonation/bomb leftover.
**Shape:** three stacked PRs (PR-1 detonation channel → PR-2 base splash-on-death → PR-3 Voidfire
splash modifier). One spec; PR boundaries map to the three Parts below.

## 1. Background

`VOIDFIRE_CATALYST` (`src/constants/implants.ts`) is the last un-modelled implant in the D corpus. Its
per-rarity descriptions carry **two distinct effects**:

1. **"+X% detonation damage"** — the wearer deals more detonation (bomb/Inferno/Corrosion burst) damage.
2. **"bombs additionally deal +Y% more splash damage"** — bombs the wearer inflicts splash harder.

It was deferred from D-PR4 because the "splash" half collides with a mechanic the engine does not model
at all. Clarified in-game behaviour (user-confirmed):

> When a ship carrying **bomb** debuffs **dies before the bombs detonate**, the bombs deal **25% / 50% /
> 75%** of their damage to **all adjacent ships**, by bomb tier. Voidfire **increases** this splash.

So the splash half rides a **base bomb-splash-on-death mechanic that does not exist yet** — that base
mechanic is *not* implant-gated (it fires for any bombs). This is the previously-deferred "positional
per-victim bomb attribution" work (peeled from E5).

### Rarity values (model exactly what each description states)

| Rarity | detonation% | splash% |
|--------|-------------|---------|
| common | 2 | 4 |
| uncommon | 4 | 8 |
| rare | — (0) | 24 |
| epic | 8 | 16 |
| legendary | — (0) | 40 |

Rare/legendary descriptions mention **only** splash → they produce a splash modifier and **no**
detonation ability.

### Locked mechanic decisions (user-ratified this session)

- **Detonation bonus scope:** applies to **all detonation types** (bomb + Inferno + Corrosion), on
  **both** the skill-triggered (`detonate()`) and timed-expiry (`processBombs`) paths.
- **Splash basis:** each adjacent ship takes a **bomb-like** hit — `splashPct × bomb burst`, **full
  shield drain, no penetration** (mirrors normal bomb damage). **No affinity** is applied — bombs and
  DoTs are not affinity-scaled in-game (only direct damage is).
- **Splash targets:** the dying ship's **living same-side adjacent allies** (its own team; cross-side
  splash is impossible — teams aren't grid-adjacent).
- **Splash bonus owner:** the **bomb applier** (the wearer who inflicted the bomb) — snapshot the
  applier's splash modifier onto the bomb at application (like `affinityMult`).
- **Chaining:** **allowed** — a splash that kills an adjacent bombed ally recursively triggers that
  ally's splash. Naturally finite (each ship dies once; its bombs are consumed).

## 2. Goals / non-goals

**Goals**

- Fully model Voidfire Catalyst (both halves, all rarities) as a combat-engine effect.
- Add the missing **base bomb-splash-on-death** core mechanic.
- Note: the **DPS calculator does not compute detonation damage** (`src/utils/calculators/` has no
  detonation path — detonation is engine-only). So no DPS wiring is required; the new
  `detonationDamageModifier` lives in `effectiveDamageStatsOf` (shared by both paths) and the DPS path
  simply never reads it.
- Keep DPS / healing / battle-sim goldens **byte-identical** for PR-1 and PR-3 (no fixture equips
  Voidfire). PR-2 is the *only* golden-moving piece; its deltas are validated by hand.

**Non-goals**

- No UI / autogear / scoring changes (beyond the mandatory editor exhaustiveness stubs).
- No change to the deterministic chance model (these are passive `modifier` abilities, not procs).
- No change to how bombs are applied, counted, or normally detonate (PR-1 only *scales* existing
  bursts; PR-2 only adds a death-time path).

## 3. Architecture

### 3.1 Current bomb model (grounding)

- `PendingBomb` lives **per-actor** (`CombatActor.pendingBombs`, `state.ts:120`) — bombs are already
  attached to the ship carrying them. Fields: `countdown`, `damagePerStack` (= `effectiveAttack ×
  tier/100`, **no** affinity), `stacks`, `tier` (100/200/300), `sourceId` (applier), `affinityMult`
  (snapshotted applier→original-target).
- Two detonation paths:
  - **Skill-triggered** — `detonate()` (`playerTurn.ts:526-582`) sums all `pendingBombs` and bursts at
    the detonating actor's skill power; `payout = Σ(stacks × damagePerStack × affinityMult) × powerPct`.
    Also handles Inferno/Corrosion detonation. Detonation damage currently bypasses **all** modifier
    channels.
  - **Timed expiry** — `processBombs()` (`engine.ts:695-710`) decrements `countdown`, bursts on `≤ 0`,
    credits the applier (`sourceId`) via `creditDetonation`.
- Modifier-channel fold: `modifierTotalsFromAbilities` (`src/utils/abilities/applyAbilities.ts:23-81`) → `effectiveStats.ts`
  fold (`selfDotDamageModifier: dotPen.dotDamageModifier + mod.dotDamage`, line 214). The `dotDamage`
  channel (Decimation) is the exact template for the two new channels.

### 3.2 PR-1 — `detonationDamage` modifier channel (byte-identical)

New ModifierChannel, mirroring `dotDamage`:

1. **`types/abilities.ts`** — add `'detonationDamage'` to the modifier `channel` union; add the 3 editor
   exhaustiveness stubs (`AbilityCard` / `AbilityTypePicker` / `abilityDefaults`, per the D-PR4
   precedent — switches keyed on the channel union).
2. **`applyAbilities.ts`** — `ModifierTotals.detonationDamage` field + `case 'detonationDamage'`.
3. **`effectiveStats.ts`** — new `detonationDamageModifier: mod.detonationDamage` on
   `EffectiveDamageStats` (parallel to `selfDotDamageModifier`).
4. **`playerTurn.ts` `detonate()`** — thread the detonating actor's `dmgStats.detonationDamageModifier`
   as a `detonationMult = 1 + mod/100`; multiply the payout of **all three** branches (bomb / inferno /
   corrosion) by it. Default 0 → mult 1 → byte-identical.
5. **`state.ts` `PendingBomb`** — new snapshot field `detonationDamageModifier` (the applier's, captured
   at application alongside `affinityMult`); **`engine.ts` `processBombs`** scales the timed-expiry
   burst by `(1 + bomb.detonationDamageModifier/100)`.
6. **Application sites** — `applyNewDoTs` (`playerTurn.ts:587-627`) and the reactive bomb-application
   path (`triggers.ts:1557`) snapshot the applier's `detonationDamageModifier` onto the new `PendingBomb`
   field (thread the applier's `dmgStats` value through, defaulting 0).
7. **DPS calculator** — **no change needed.** The DPS calc has no detonation computation, and its
   `buildShipAbilities` sites were already routed to `buildShipAbilitiesWithEquipment` in D-PR2. The new
   field is inert there.

Inert at default 0 everywhere → byte-identical.

### 3.3 PR-2 — base bomb-splash-on-death (golden-moving core mechanic)

Reuses the **Reflect** recursive-`applyVictimDamage` pattern at the shared death seam.

- **Seam:** the shared `applyVictimDamage` real-death branch (`engine.ts:2895-2902`, the `else` that
  calls `recordDestroyed`). Fires exactly once per death (set-once via `destroyedRound`); the
  cheat-death branch (`2882-2894`) is **excluded** (it survives at 1 HP and already leaves bombs
  untouched). This is the sole victim sink (bySide unification), covering player→enemy and
  enemy→player symmetrically.
- **Trigger:** the victim is newly destroyed by this call **and** `victim.pendingBombs` is non-empty
  (un-detonated bombs).
- **Per bomb × per living same-side adjacent ally** (`adjacentAllyIds(victim.id, actors)` — the helper
  already used for Bulwark/reactive adjacency; resolve via the side-aware `adjacentAllyIdsFor`):

  ```
  splashPct(tier) = tier / 4   (%)            // 100→25, 200→50, 300→75
  splash = (stacks × damagePerStack)          // = stacks × effectiveAttack × tier/100
         × splashPct/100
         × (1 + bomb.splashModifier/100)       // PR-3; 0 until then
  ```

  **No affinity term** — bombs/DoTs are not affinity-scaled in-game (only direct damage is).
  `damagePerStack` already excludes affinity, so splash is a pure fraction of the bomb's raw burst.
  (The pre-existing `bomb.affinityMult` snapshot is used only by the *existing* `detonate()` /
  `processBombs` paths and is left untouched — not in scope to change here.)
- **Applied like a bomb hit** via recursive
  `applyVictimDamage(splash, ally, sink-by-ally-side, { killerId: applierId, byDirectDamage: true,
  bombPortion: splash, shieldPenetrationPct: 0 })` — full shield drain, no pen, credited to the
  applier's detonation channel.
- **Applier / credit:** the splash is credited to the bomb's applier (`killerId: bomb.sourceId`); the
  applier need not be resolved as an actor for the damage value itself (no affinity), only for
  accounting. Splash fires regardless of applier liveness (bombs are autonomous).
- **Chaining:** a splash that kills an adjacent bombed ally re-enters the same `applyVictimDamage` death
  branch → its splash fires recursively. Finite: each ship dies once and its bombs are consumed.
- **Consume:** clear `victim.pendingBombs` after splashing (so they cannot also time-detonate).
- **Non-positional safety:** `adjacentAllyIds` returns `[]` without positions → no splash → all
  non-positional goldens (DPS, healing, single-target sims) stay byte-identical. Only positional sims
  with a bombed death + a living same-side neighbour change.
- **Surfacing:** a `perActorSplash` map (reset/round, mirroring Reflect's `perActorReflected`) folded
  into `roundPerTargetDamage` so splash shows on the victim's HP curve; `RoundData.perActorSplash?`
  plumbed (no StatCard yet — reserved).

### 3.4 PR-3 — Voidfire `bombSplashDamage` modifier (byte-identical)

- New `'bombSplashDamage'` modifier channel (same fold pattern as §3.2 — union + `ModifierTotals` +
  `effectiveStats` field `bombSplashModifier` + editor stubs).
- Snapshot the **applier's** `bombSplashModifier` onto `PendingBomb.splashModifier` at the two
  application sites (`applyNewDoTs` + `triggers.ts:1557`), alongside the PR-1 detonation snapshot.
- PR-2's formula already reads `bomb.splashModifier` (default 0 → PR-2 stands alone); PR-3 fills it →
  Voidfire's splash% amplifies splash for all rarities.

### 3.5 Voidfire registry entry (spans the PRs)

`IMPLANT_ABILITIES.VOIDFIRE_CATALYST = (rarity) => Ability[]` returning up to two `modifier` abilities:
a `detonationDamage` modifier (value = detonation% — **omitted** when 0, i.e. rare/legendary) and a
`bombSplashDamage` modifier (value = splash%). The registry builder already supports array returns
(Warpstrike precedent); consumer index-suffixes ids only for multi-ability builders.

`equipmentCoverage.test.ts` updates per PR (the implemented-set `.toEqual` array decl-order, the Set,
and the `it('exactly{}')` count string).

## 4. Components & isolation

| Unit | Purpose | Depends on |
|------|---------|------------|
| `detonationDamage` channel | scale detonation bursts by a per-actor % | modifier-fold infra |
| `PendingBomb.detonationDamageModifier` / `.splashModifier` | snapshot the applier's modifiers at application | effectiveStats |
| splash-on-death block (`engine.ts`) | distribute splash to adjacent allies at death | `adjacentAllyIds`, `applyVictimDamage` (no affinity) |
| `bombSplashDamage` channel | feed `PendingBomb.splashModifier` | modifier-fold infra |
| `VOIDFIRE_CATALYST` registry entry | emit the two modifier abilities per rarity | both channels |

## 5. Testing & golden strategy

- **PR-1 / PR-3:** assert goldens **byte-identical**; unit tests for the channel fold + integration
  tests through the **real registry** (`buildShipAbilitiesWithEquipment` + `setBonus`), per the
  mutation-resistance lessons from D-PR16.
- **PR-2:** run the full suite and **expect** positional-bomb-death goldens to move. Validate each delta
  by hand against the §3.3 formula before accepting (never blanket `vitest -u`). New focused fixtures:
  (a) single bomb, single adjacent ally — exact splash value; (b) chain (splash kills a bombed
  neighbour → second splash); (c) non-positional → no splash (byte-identical); (d) multi-bomb,
  multi-ally; (e) dead applier still splashes; (f) cheat-death survivor does **not** splash.

## 6. Risks

- **Golden churn scope (PR-2):** the splash mechanic is broad. Mitigation: it is positional-only and
  only fires on a bombed premature death with a living neighbour — a narrow combination; isolate it in
  its own PR with hand-validated deltas.
- **Death-path completeness:** the design assumes `applyVictimDamage`'s `recordDestroyed` branch is the
  sole real-death seam (bySide unification). **Plan-phase verification:** confirm all positional deaths
  route through it before relying on the single hook.
- **Chaining recursion:** bounded by "each ship dies once, bombs consumed" — verify no re-entrancy on an
  already-destroyed victim (the set-once `destroyedRound` guard handles this; the splash trigger must
  gate on *newly* destroyed + non-empty bombs).
