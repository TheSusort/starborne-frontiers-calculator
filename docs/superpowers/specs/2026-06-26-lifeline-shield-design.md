# Lifeline Shield — Design Spec

**Date:** 2026-06-26
**Sub-project:** H (shield system) follow-up — the last remaining shield-grant implant.
**Branch base:** stacks on `feat/combat-shield-system-h2-h3` (H2/H3 PR #157), the same way H3 stacked on H1. Retarget to `main` once the H stack merges.

## Context

The shield system (sub-project H) shipped H1 (penetration / DoT bypass / sim surfacing), H2 (Shield gear set), and H3 (reactive implants: Adaptive Plating, Abundant Renewal, Resonating Fury). The shield-grant family was tracked as `Abundant Renewal / Adaptive Plating / Strike / Lifeline / Resonating Fury`.

Two corrections found during exploration:

- **Strike is NOT a shield implant.** It is a stat-only flat-attack implant (`attack +30/71/115/182/289` by rarity), like Barrier/Citadel/Devastation — already modeled in combat stats, needs no engine work. Its inclusion in the shield-grant family was a mislabel.
- **Lifeline is the only remaining shield-grant source.** It is a genuinely new shape, not just another registry entry.

## The implant

> *"When direct damage would cause HP to drop below 30%, gain a Shield equal to [4000/6000/8000/10000/12000] plus 100% of this unit's Attack stat (capped at max HP). This can occur once per battle."*

Per-rarity flat amount: `common 4000, uncommon 6000, rare 8000, epic 10000, legendary 12000`. Attack component: 100% of the carrier's own effective attack. Cap: max HP. Frequency: once per battle.

### Locked game behavior (user-ratified 2026-06-26)

The shield goes up **mid-hit, before the triggering damage finishes applying**:

> "if incoming damage makes hp go below 30% → gain shield → continue applying the incoming damage"

The ship can still die if the incoming damage exceeds the new shield + remaining HP. This is **not** Cheat Death (a dedicated 0%-HP death-intercept that floors HP at 1) — Lifeline is a 30%-threshold buffer that explicitly still allows death.

**Locked semantics:**

1. **Pre-hit / mid-hit timing.** The shield is granted *before* the triggering hit's shield-absorb step, so the rest of that same hit eats through shield→HP per the H1 penetration rules.
2. **Downward crossing.** Fires only when pre-hit HP ≥ 30% of max HP *and* the hit would bring it below 30%. If the unit is already below 30% (e.g. chipped by a shield-bypassing DoT), a subsequent hit does not "cause it to drop below 30%" → no fire. (Once-per-battle makes the crossing the natural reading.)
3. **Direct damage only.** Eligibility requires a *pure* direct hit: `cause.byDirectDamage === true && (cause.bombPortion ?? 0) === 0`. DoTs (which bypass shields) and any detonation/bomb-bearing hit do not arm Lifeline. A mixed direct+detonation aggregate hit does not trigger (approximation, consistent with "only direct damage triggers it").
4. **Once per battle.** Fires at most once per combat, tracked by a combat-lifetime Set keyed `${victimId}:${abilityId}` (mirrors Cheat Death / Yazid once-per-combat).
5. **Cap at max HP.** The shield *pool* (total, not just the grant) is capped at max HP, consistent with the H1 locked rule. `newPool = min(maxHp, shieldBefore + grant)`.

## Architecture

### Why the victim-side damage path

The existing reactive `on-hp-threshold-crossed` trigger fires on the `hp-changed` event, which is emitted *after* the hit fully resolves — too late to soak the triggering blow. So Lifeline lives in the **victim-side damage-application path** (`applyVictimDamage` in `engine.ts`), which already hosts a near-identical pattern: D-PR3's `incoming-block` / `incoming-reduction` look up `incomingAbilitiesOf(victim.id)` and modify the hit *before* the `shieldAbsorb` step. Lifeline slots in between capturing `shieldBefore` and calling `shieldAbsorb`.

This reuses the established victim-side-intercept machinery (per-actor `incomingAbilitiesById` map, pure testable helper, once-per-combat Set) rather than inventing a new seam.

### 1. Data model — `types/abilities.ts`

New victim-side ability config in the `AbilityConfig` union:

```ts
| {
    type: 'incoming-shield-grant';
    hpThresholdPct: number;   // 30 — fire when a direct hit crosses HP below this % of max HP
    flatAmount: number;       // 4000/6000/8000/10000/12000 by rarity
    attackPct: number;        // 100 — % of the carrier's own effective attack
    oncePerCombat: boolean;   // true
  }
```

Self-scoped by construction (the carrier *is* the victim). No `condition` / `procChance` fields — Lifeline is deterministic and unconditional beyond the threshold crossing. Editor exhaustiveness stubs added where the union forces them (AbilityCard / AbilityTypePicker / abilityDefaults), consistent with prior config-type additions.

### 2. Pure helper — `src/utils/combat/thresholdShield.ts`

Fully unit-tested in isolation:

```
thresholdShieldForHit({
  abilities,            // Ability[] — the victim's incoming-shield-grant abilities
  currentHp,
  maxHp,
  provisionalHpDamage,  // HP damage from a shieldAbsorb computed with the CURRENT pool
  effectiveAttack,      // victim's effective attack
  isDirect,             // cause.byDirectDamage === true && (cause.bombPortion ?? 0) === 0
  alreadyFired,         // (abilityId: string) => boolean
}) => { abilityId: string; grant: number } | null
```

Logic — pick the first `incoming-shield-grant` ability that is:

- (a) `isDirect`,
- (b) not yet fired (`!alreadyFired(ability.id)`),
- (c) a downward crossing: `threshold = hpThresholdPct/100 * maxHp`; `currentHp >= threshold && (currentHp - provisionalHpDamage) < threshold`.

Returns `grant = flatAmount + effectiveAttack * attackPct / 100` (raw, **uncapped** — the pool cap is applied at the engine seam against the live pool), plus the `abilityId` for once-fired bookkeeping. Returns `null` otherwise.

### 3. Engine intercept — `applyVictimDamage`, before `shieldAbsorb`

1. **Collect** `incoming-shield-grant` abilities into the existing `incomingAbilitiesById` map (extend the filter at engine.ts ~2251 alongside `incoming-reduction` / `incoming-block`).
2. After `const shieldBefore = victim.shieldPool`, compute a **provisional** `shieldAbsorb` with the *current* pool to get `hpDamage0` (the HP damage the hit would deal pre-Lifeline).
3. Call `thresholdShieldForHit(...)` with `isDirect = cause?.byDirectDamage === true && (cause?.bombPortion ?? 0) === 0`. If it returns a grant:
   - `newPool = Math.min(maxHp, shieldBefore + grant)`; `victim.shieldPool = newPool`.
   - Mark fired: `thresholdShieldFired.add(`${victim.id}:${abilityId}`)` — a combat-lifetime `Set<string>` declared next to `oncePerCombatFired`.
   - Surface the granted delta `newPool - shieldBefore` into the H1 `perActorShield.granted` accumulator so the sim StatCard reflects it.
4. Run the **real** `shieldAbsorb` against `victim.shieldPool` (now boosted) — the existing line, unchanged. The rest of the hit eats shield→HP per the H1 pen rules; the ship can still die.

### 4. Registry — `buildEquipmentAbilities.ts`

`IMPLANT_ABILITIES.LIFELINE`: per-rarity `flatAmount` table `{ common: 4000, uncommon: 6000, rare: 8000, epic: 10000, legendary: 12000 }`, `attackPct: 100`, `hpThresholdPct: 30`, `oncePerCombat: true`. All 5 rarities present. Stable id `equip-implant-LIFELINE-${gearId}` per the existing implant id scheme.

## Byte-identical guarantee

No existing combat fixture equips Lifeline, and no ship skill parses to `incoming-shield-grant`. The `incomingAbilitiesById` filter only adds entries for actors carrying the new config → the map stays empty for every current actor → the provisional-absorb / intercept block is never entered → production goldens/snapshots are byte-identical. Same dormancy guarantee as D-PR3 and the H stack. New behavior is locked with hand-written integration scenarios.

## Testing

- **Helper unit tests** (`thresholdShield.test.ts`): crossing fires; pre-hit already below 30% → no fire; non-direct (DoT) → no fire; bomb-bearing hit → no fire; once-per-battle (second qualifying hit → null after fired); cap-at-maxHP delta; `grant === flatAmount + attack` (varying attack to prove the attack component).
- **Coverage tracker** (`equipmentCoverage.test.ts`): add `LIFELINE` to the three spots — the `toEqual` array in IMPLANTS decl order, the implemented Set, and the `exactly{}` prose — plus a shape test (1 ability per rarity, correct config fields).
- **Integration** (`equipmentAbilities.integration.test.ts`) via real `buildShipAbilitiesWithEquipment` + `runCombat`:
  - a direct hit that crosses 30% grants the shield and soaks the remainder — the unit survives a hit it otherwise would not, with shield left over;
  - a large enough direct hit still kills *through* shield + remaining HP (Lifeline is not a death-save);
  - fires at most once per battle (a second qualifying hit grants nothing).

## Scope notes

- **DPS calculator not wired** — defensive-only effect, like every shield/defensive D PR.
- **Per-hit granularity** — the intercept runs per `applyVictimDamage` call, which is the actual HP-application seam (not an aggregate approximation).
- **Surfacing** — the granted delta feeds the existing H1 `perActorShield.granted` so the simulator's shield-granted StatCard is accurate; no new surface needed.

## Out of scope / deferred

- Pre-emptive absorb of the *triggering hit itself* beyond the shield (i.e. Lifeline does not reduce or cap the incoming hit — it only adds a pool the hit then drains). This matches the locked behavior.
- Strike (stat-only, no work).
