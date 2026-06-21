# Combat Realism Epic — Sub-project D, PR4: Conditional-outgoing completion (Design)

**Date:** 2026-06-21
**Sub-project:** D (implant + gear-set abilities), PR4.
**Parent spec:** `docs/superpowers/specs/2026-06-20-implant-gearset-abilities-D-design.md` (§5.2 row 1).
**Stacks on:** D-PR3 (`feat/combat-d-pr3-incoming-reduction`, tip `c943b1aa`, PR #130). Branch
`feat/combat-d-pr4-outgoing-amplification`; retarget to `main` after the #129 → #128 → #130 stack
merges.
**Status:** design (brainstorm complete, user-approved through testing).

## 1. Context

D-PR2 shipped the *deterministic* conditional-outgoing-damage effects (Intrusion, Arcane Siege,
Warpstrike) by modeling them as passive `modifier` abilities folded into the `outgoingDamage` channel
(`modifierTotalsFromAbilities` → applied multiplicatively in `nonCritFactor`). That left four effects
in the §5.2 "conditional outgoing damage" row unshipped: **Giant Slayer, Menace, Insidiousness,
Voidfire Catalyst**.

These are *not* deterministic turn-level modifiers. Three are **per-hit probabilistic** effects:

- **Menace** — "When critically damaging an enemy, there is an 8–12% chance to increase **that damage**
  by 20–45%." Amplifies the in-flight critting hit.
- **Giant Slayer** — "When directly damaging an enemy with a **higher attack**, there's a 12–20% chance
  to increase **that damage** by 50%." Amplifies the in-flight hit when the target's attack exceeds the
  attacker's.
- **Insidiousness** — "When debuffing an enemy, there is a 10–21% chance to deal 60–100% damage." Deals
  a *separate* damage chunk on debuff application.

The fourth, **Voidfire Catalyst** ("+X% detonation damage and bombs +Y% splash damage"), is a
detonation/bomb-damage modifier whose "splash" half collides with the engine's non-positional bomb
model (the per-victim-detonation work deferred from E5). It is a different mechanism and is **deferred
to a future bomb/detonation-focused D PR** — out of scope here.

Menace and Giant Slayer were explicitly deferred from D-PR1 because they need **in-flight damage
amplification**: the reactive path emits a *separate* `ability-performed` damage event and cannot
amplify the hit that is currently being computed. This PR adds that primitive — the attacker-side
mirror of D-PR3's victim-side incoming-reduction.

## 2. Goals / non-goals

**Goals**

- A reusable **in-flight outgoing-amplification primitive**: a per-hit, probabilistic multiplier on a
  single attack's direct damage, gated by attack-context conditions (crit, target-higher-attack),
  applied in **both** the aggregate and positional damage paths — the attacker-side analogue of
  D-PR3's `incomingEffects` / `IncomingHitContext`.
- Light up **Menace, Giant Slayer, Insidiousness** as combat-engine effects.
- Keep all existing DPS / healing / battle-sim goldens **byte-identical** (no fixture carries these
  implants; the new code is inert at its defaults).

**Non-goals**

- **Voidfire Catalyst** (detonation/bomb modifier) — deferred to a future bomb PR.
- No UI / autogear / scoring changes.
- No change to the deterministic chance model (LOCKED, parent spec §3): each proc rides its own
  `makeRateGate()` instance, fired at the proc's chance each time its eligibility condition is met.

## 3. Architecture

### 3.1 Insidiousness — reactive-damage rider + one small gate fix

Insidiousness deals a *separate* damage instance, structurally identical to the existing reactive
`damage` executor (the "Grif" 75%-damage proc). It is *almost* pure reuse, with **one required engine
fix**:

> **The reactive `damage` executor does NOT honor `procChance` today.** The proc-chance rate gate
> (`triggers.ts:~1137`) lives **only inside the `cfg.type === 'heal' || 'shield'` branch** of
> `executeIntent`. The `cfg.type === 'damage'` branch (`triggers.ts:~1246`) has no gate, and the
> on-debuff-inflicted listener enqueues unconditionally. Grif's reactive-damage proc sets no
> `procChance` (it fires on every cleanse), so this was never exercised. Insidiousness **does** set
> `procChance`, so without a fix it would deal its chunk on *every* debuff application — violating the
> LOCKED chance model.

**Fix (localized, byte-identical for shipped effects):** extract the existing inline gate block into a
small helper and call it in the `damage` branch too:

```ts
// triggers.ts — extracted from the current inline block in the heal/shield branch
function passesProcChanceGate(intent: Intent, ctx: IntentExecContext): boolean {
    const pc = intent.ability.procChance;
    if (pc === undefined || pc <= 0 || pc >= 1) return true;
    const gateKey = `${intent.ownerId}:${intent.ability.id}`;
    let gate = ctx.procChanceGates?.get(gateKey);
    if (ctx.procChanceGates && !gate) { gate = makeRateGate(); ctx.procChanceGates.set(gateKey, gate); }
    return !gate || gate(pc);  // absent map (unit-test ctx) → pass through
}
```

- The heal/shield branch replaces its inline block with `if (!passesProcChanceGate(intent, ctx)) return;`
  at the **same position** (after the `oncePerCombat` check and the `!ctx.healing` guard) → byte-identical.
- The `damage` branch gains `if (!passesProcChanceGate(intent, ctx)) return;` at its top.
- **Safety verified:** no existing reactive `damage` ability in the corpus sets `procChance` (only
  Bloodthirst[heal] / Ironclad / Shadowguard set it, and the latter two ride D-PR3's `rollBlock` path,
  not `executeIntent`). So the damage-branch gate changes nothing for shipped effects → goldens
  byte-identical. The helper is **not** hoisted above the type-branch dispatch (which would change the
  heal-branch ordering vs `!ctx.healing`); it stays branch-local.

With the gate in place, the registry entry is then pure reuse:

```ts
INSIDIOUSNESS: (rarity) => {
  const m = INSIDIOUSNESS_MULT[rarity];     // 60/70/80/90/100 (common..legendary)
  const pc = INSIDIOUSNESS_PROC[rarity];    // 0.10/0.12/0.14/0.17/0.21
  if (m === undefined) return undefined;
  return {
    type: 'damage',
    target: 'enemy',
    trigger: 'on-debuff-inflicted',
    conditions: [],
    procChance: pc,
    config: { type: 'damage', multiplier: m, hits: 1 },
    autoFilled: true,
  };
}
```

- `on-debuff-inflicted` already fires when the owner applies a debuff or DoT (`triggers.ts`).
- The reactive `damage` branch computes `effectiveAttack × (multiplier/100) × hits × affinityMult`
  (noCrit, no defense mitigation — the documented bomb/reactive approximation).
- `procChance` rides the same per-(owner,ability) `procChanceGates` map, now consulted by the damage
  branch via the extracted `passesProcChanceGate` helper above.
- Verified non-overlap: Insidiousness fires on debuff-application; it does not double with the
  amplification primitive (different trigger surface).

### 3.2 In-flight amplification primitive — Menace & Giant Slayer

A new pure module **`src/utils/combat/outgoingEffects.ts`**, the attacker-side mirror of
`incomingEffects.ts`:

```ts
// types/abilities.ts additions
export type OutgoingCondition = 'amplify-on-crit' | 'amplify-vs-higher-attack';
export interface OutgoingHitContext {
  didCrit: boolean;
  targetHigherAttack: boolean;
}
// new AbilityConfig member
{ type: 'outgoing-amplification'; condition: OutgoingCondition; ampPct: number; procChance: number }

// outgoingEffects.ts
export function outgoingAmplificationForHit(
  attackerAbilities: Ability[],
  ctx: OutgoingHitContext,
  rollProc: (abilityId: string, chance: number) => boolean,
): number   // returns the SUMMED amplification % for this one hit (0 when nothing applies)
```

Semantics (pure, deterministic given `rollProc`):

```
sum = 0
for a in attackerAbilities where a.config.type === 'outgoing-amplification':
    if !conditionMet(a.config.condition, ctx): continue   // gate eligibility FIRST
    if !rollProc(a.id, a.config.procChance): continue      // then advance the proc gate
    sum += a.config.ampPct
return sum
```

- `amplify-on-crit` → eligible iff `ctx.didCrit`. (Menace.)
- `amplify-vs-higher-attack` → eligible iff `ctx.targetHigherAttack`. (Giant Slayer.)
- **Stacking is additive**: if both fire on one hit, `ampPct` values sum (consistent with how the
  `outgoingDamage` channel sums in D-PR2). The result is applied as `× (1 + sum/100)` on that hit.
- **Eligibility gates the gate.** `rollProc` (the deterministic accumulator) advances **only on
  eligible hits**, faithfully matching "when critically damaging" / "when directly damaging a
  higher-attack enemy" — non-eligible hits present no proc opportunity. This is why the gate roll must
  live where per-hit crit is known, not at turn level.

Registry entries (`buildEquipmentAbilities.ts`), `trigger: 'on-cast'` and `conditions: []` are inert
(the live condition lives in `config` and is evaluated per-hit by the evaluator, mirroring how D-PR3's
`incoming-reduction` configs carry their condition in `config`):

| Implant | condition | ampPct (by rarity) | procChance (by rarity) |
|---|---|---|---|
| **Menace** | `amplify-on-crit` | 20/25/30/35/45 (c/u/r/e/l) | 0.08/0.09/0.10/0.11/0.12 |
| **Giant Slayer** | `amplify-vs-higher-attack` | 50 (all) | 0.12/0.14/0.16/0.20 (u/r/e/l — no common) |

### 3.3 Aggregate-path wiring (`playerTurn.ts`)

The aggregate path computes a single blended `directDamage` and folds crit into an averaged
`damageCritMultiplier`. D-PR3 already established the pattern for folding a per-hit factor into that
blend without restructuring (it folded crit-family incoming reduction as a ratio applied to the crit
fraction only). D-PR4 mirrors it on the amplification side.

The amplification gates are rolled **inside the existing crit-draw loop** (`playerTurn.ts:~1128`),
where per-hit crit is known, accumulating two weighted sums:

```ts
let ampNonCritWeight = 0;   // Σ over non-crit drawn hits of (1 + amp_h)
let ampCritWeight = 0;      // Σ over     crit drawn hits of (1 + amp_h)
for (let h = 0; h < drawHits; h++) {
    const didCritHit = critGate(effectiveCrit / 100);     // UNCHANGED
    // ... existing critHits / hitCrits bookkeeping ...
    const amp = ampAbilities.length === 0 ? 0
        : outgoingAmplificationForHit(ampAbilities, { didCrit: didCritHit, targetHigherAttack }, rollProc) / 100;
    if (didCritHit) ampCritWeight += 1 + amp; else ampNonCritWeight += 1 + amp;
}
```

Then a new `amplifiedCritMultiplier` replaces `damageCritMultiplier` **for the firing hit only**:

```ts
const amplifiedCritMultiplier = drawHits > 0
    ? (ampNonCritWeight + ampCritWeight * (1 + effectiveCritDamage / 100) * critIncomingRatio) / drawHits
    : damageCritMultiplier;
const postDefenseFactor = amplifiedCritMultiplier * nonCritFactor;   // firing hit
// passiveCritMultiplier stays = damageCritMultiplier (passive payload hit unaffected)
```

**Byte-identical proof at defaults.** When `ampAbilities` is empty, `amp = 0` for every hit, so
`ampNonCritWeight = nonCritHits` and `ampCritWeight = critHits`. Then
`amplifiedCritMultiplier = (nonCritHits + critHits·(1+cd/100)·ratio)/drawHits
= 1 − critFraction + critFraction·(1+cd/100)·ratio = damageCritMultiplier` exactly. The crit-draw loop
calls `outgoingAmplificationForHit` **only when `ampAbilities` is non-empty**, so the critGate sequence
is never perturbed. Amplification gates are separate per-(owner,ability) `makeRateGate` instances and
do not share state with `critGate`.

**Scope decision (user-approved):** amplification applies to the **firing attack's drawn hits only**,
not the passive payload hit (the Judge-style start-of-round passive damage). The implant text is about
the unit's attack; the passive payload is a separate auto-damage instance with its own crit treatment.
Documented limitation.

**Inputs threaded into `runPlayerTurn` (both optional → absent = byte-identical):**

- `args.targetEffectiveAttack?: number` — the bound target's live effective attack. Inside the turn,
  `targetHigherAttack = targetEffectiveAttack !== undefined && targetEffectiveAttack > effectiveAttack`
  (live effective attack on both sides, per the approved game-rule decision). The engine computes the
  target's `effectiveStatsOf(...).attack`. In pure DPS mode where the dummy enemy has no meaningful
  attack, the value is absent/0 → Giant Slayer simply does not fire (acceptable; documented).
- `args.rollOutgoingProc?: (abilityId, chance) => boolean` — the engine-supplied deterministic gate,
  backed by the combat-lifetime `procChanceGates` map (same map D-PR1 created on `IntentExecContext`).
  Absent → `outgoingAmplificationForHit` is never invoked (the loop short-circuits on empty
  `ampAbilities`, and the engine omits the callback for non-positional callers).
- `ampAbilities` is derived locally inside `runPlayerTurn` by filtering the passive slot
  (`passiveSkill.abilities`) for `config.type === 'outgoing-amplification'`. No new ability plumbing —
  `buildShipAbilitiesWithEquipment` already merges equipment abilities into the passive slot.

### 3.4 Positional-path wiring (`positionalApply.ts` + engine)

Mirror D-PR3's `incomingReductionFor(victim, didCrit)` callback with an attacker-side
`outgoingAmplificationFor(victim, didCrit)` callback, evaluated **per-victim per-hit** inside the
existing positional hit loop and applied as `× (1 + ampPct/100)` on that victim's hit damage. Because
it is per-victim, Giant Slayer's higher-attack test uses each real victim's effective attack. The
engine wires it in `drivePositionalApply` immediately alongside the existing incoming hook, building
`OutgoingHitContext` per victim (`didCrit` from `hitCrits[h]`; `targetHigherAttack` from
`effectiveStatsOf(victim).attack > attackerEffectiveAttack`) and supplying `rollProc` from
`procChanceGates`.

### 3.5 Page / consumer wiring

The DPS calculator page **already** routes `buildShipAbilitiesWithEquipment(ship, getGearPiece)` (wired
in D-PR2), so Menace/Giant Slayer/Insidiousness flow into DPS with no new page changes. The battle
simulator and healing calculator likewise inherited the equipment merge in D-PR1. Plan-time
verification: confirm each consumer that should see these effects is already on the equipment path and
that the engine computes `targetEffectiveAttack` / supplies `rollOutgoingProc` at the call sites that
have a real opposing target.

## 4. Effect coverage / corpus

- Coverage tracker `equipmentCoverage.test.ts`: implemented-implants set gains `GIANT_SLAYER`,
  `INSIDIOUSNESS`, `MENACE` (in `IMPLANTS` declaration order alongside the existing entries).
- Voidfire Catalyst remains **un-implemented** in the tracker (explicitly deferred — the tracker should
  continue to flag it as a known gap, not silently pass).

## 5. Testing & invariants

- **Unit — `outgoingAmplificationForHit`:** each condition (`amplify-on-crit`, `amplify-vs-higher-attack`)
  fires only when eligible; additive stacking when both apply to one hit; `rollProc` gates the sum;
  eligibility gates the gate (non-eligible hits do not advance `rollProc` — assert via a counting stub).
- **Unit — `buildEquipmentAbilities`:** Menace/Giant Slayer produce `outgoing-amplification` configs
  with the right per-rarity values; Giant Slayer has no common variant; Insidiousness produces a
  reactive `damage` ability with the right multiplier/procChance; stat-only / unknown variants skipped.
- **Integration:** over N hits a 50%-ish proc fires at the expected deterministic frequency; amplified
  damage exceeds the un-amplified baseline by the correct amount; Menace amplifies only crit hits;
  Giant Slayer amplifies only when the target's effective attack is higher; Insidiousness lands a
  separate damage chunk on debuff application **at its gated frequency** (e.g. a 10% proc over N debuffs
  fires ~N/10 times, NOT every debuff — the regression test for the §3.1 gate fix) and not otherwise.
- **Unit — `passesProcChanceGate`:** extracted helper returns the same result as the prior inline block
  (pass-through when `procChance` is undefined / ≤0 / ≥1 or the map is absent; gated otherwise); the
  heal/shield branch behavior is unchanged.
- **Load-bearing invariant:** all DPS / healing / battle-sim goldens stay **byte-identical**. The new
  builder runs only where equipment is threaded; no committed fixture carries Menace/Giant
  Slayer/Insidiousness; the aggregate seam collapses to the prior expression at empty `ampAbilities`;
  the positional/`rollOutgoingProc` callbacks are absent for callers without a real target.
  **Plan step 1 (before any wiring): fixture audit** — grep battle-sim/healing/DPS fixtures for
  Menace/Giant Slayer/Insidiousness-bearing implants; confirm empty, or neutralize/deliberately audit.
  Never `vitest -u` to absorb churn.
- `npm run audit:skills` unchanged (equipment effects are not ship-skill text).

## 6. Open questions for the plan

1. Exact engine call sites that must compute `targetEffectiveAttack` and supply `rollOutgoingProc`
   (aggregate focus turn, team turn, enemy turn, and the positional driver) — characterize each and
   confirm the absent-arg byte-identical path for callers without a real opposing target.
2. Whether `critIncomingRatio` and `effectiveCritDamage` are both in scope at the point
   `amplifiedCritMultiplier` is computed (they are computed after the draw loop today — confirm
   ordering, accumulate raw weights in the loop and fold after).
3. Confirm `procChanceGates` is reachable at the positional driver and the per-turn runPlayerTurn call
   sites for building the `rollProc` closure (D-PR1 created it on `IntentExecContext`).
