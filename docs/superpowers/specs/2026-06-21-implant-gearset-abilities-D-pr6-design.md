# Combat Realism Epic — Sub-project D, PR6: Exuberance (Design)

**Date:** 2026-06-21
**Sub-project:** D (implant + gear-set abilities), PR6.
**Parent spec:** `docs/superpowers/specs/2026-06-20-implant-gearset-abilities-D-design.md` (§5.2 "reactive heal/leech" row — the last effect in that row).
**Stacks on:** D-PR5 (`feat/combat-d-pr5-reactive-heal`, tip `03cff2a6`, PR #133). Branch
`feat/combat-d-pr6-exuberance`; retarget to `main` once the D stack merges.
**Status:** design (brainstorm complete, user-approved through architecture + scope).

## 1. Context

D-PR5 shipped the caster-side heal-cast amplification primitive (Nourishment, Vivacious Repair) and
Second Wind, and deferred **Exuberance** — the recipient-side amplification — as a distinct seam. This
PR completes the "reactive heal/leech" row with it.

- **Exuberance** — "When repaired, there is a 17–30% chance to increase that repair by 12–15%."
  Carried by the unit being healed; **unconditional** (no HP gate); proc-gated per repair received.

**Incoming vs outgoing (key distinction).** Exuberance is an **incoming** (recipient-side) amplifier —
it boosts repairs the carrier *receives*. This is a different channel from every heal-amp shipped so far,
all of which are **outgoing** (caster-side): the Repair gear set (`healModifier: 20%`, a stat that boosts
heals the wearer *casts* — already handled by stat folding) and D-PR5's Nourishment/Vivacious
(caster-side `heal-amplification`). Concretely, Exuberance folds at the recipient's `incomingPctFor(rid)`
channel, NOT the caster's `healModifier`/`outgoingHeal` channels (which sit elsewhere in the same `raw`
product). So it is "the same kind of % bump as an incoming-repair buff, gated behind a random proc."

Reconnaissance findings that shape this design:
- **No new trigger is needed.** Every place a repair lands on a recipient already applies a
  per-recipient incoming-heal factor and shares the same `HealingRuntimeCtx`. Exuberance is the
  recipient-side analogue of D-PR5's caster-side `healAmplificationForCast`, folded at the heal-apply
  sites — not a reactive event.
- The heal-apply sites that should honor "when repaired" (each already multiplies a per-recipient
  incoming factor immediately before `applyHealToTarget`):
  - cast-heal fold, **player branch** (`playerTurn.ts`, after `incomingPctFor(rid)`)
  - cast-heal fold, **`healEventOnly` branch** (`playerTurn.ts`, after `incomingPctFor(rid)`)
  - **reactive heal executor** (`triggers.ts`, after `incomingPctFor(rid)`)
  - **HoT tick** (`playerTurn.ts`, the `holderIncomingFactor` line; recipient = the holder)
- **Excluded:** shields (not repairs — they skip all heal channels) and leech sites (`engine.ts`
  `procStandingLeeches` / taken-leech — credited to the leech *source*, and do not apply
  `incomingPctFor`; Exuberance-on-the-victim does not apply there).
- The engine already builds per-actor ability lookups (`incomingAbilitiesById` D-PR3,
  `outgoingAbilitiesById` D-PR4) and already exposes a recipient-side per-rid accessor
  `recipientIncomingHealPct(rid)` on `HealingRuntimeCtx` (sourced from the recipient's last-turn ctx).
  Exuberance follows both precedents.

## 2. Goals / non-goals

**Goals**

- Light up **Exuberance** in the combat engine across all repair-received sites (cast, reactive, HoT).
- Add a reusable **recipient-side incoming-heal amplification** path: a `HealingRuntimeCtx` method that
  rolls the recipient's incoming-heal-amp procs and returns the summed % — the recipient-side analogue
  of D-PR5's caster-side amplification.
- Keep all DPS / healing / battle-sim **goldens byte-identical** (no fixture carries Exuberance; the
  ctx method is unpopulated → returns 0).

**Non-goals**

- No new trigger / event / status machinery (the fold-at-apply-sites approach is sufficient).
- No leech-site or shield amplification (out of "when repaired" scope).
- No UI / autogear / scoring changes.

## 3. Architecture

### 3.1 Fidelity model (user-ratified)

Exuberance is **one effect on the receiving unit**, and **every repair the unit receives is one
"when repaired" event** feeding **one probability stream**. The engine approximates "X% chance" with a
deterministic `makeRateGate` accumulator (the locked convention for all procs). Therefore the proc must
ride **a single combat-lifetime gate keyed `${recipientId}:${abilityId}`**, rolled **once per repair
the unit receives**, across **all** repair sources (cast/reactive/HoT). A single
`HealingRuntimeCtx` method guarantees this single-stream property by construction (one place computes
the boost; every apply site calls it).

### 3.2 New ability config (unconditional)

```ts
// types/abilities.ts
{ type: 'incoming-heal-amplification'; ampPct: number; procChance: number }
```
No condition field — Exuberance is unconditional ("when repaired"). (Add `'incoming-heal-amplification'`
to `AbilityType` + the 3 editor-exhaustiveness UI stubs, same as D-PR4/D-PR5.)

### 3.3 Pure evaluator

Add to `src/utils/combat/healAmplification.ts` (sibling to `healAmplificationForCast`):

```ts
export function incomingHealAmpForRecipient(
  recipientAbilities: Ability[],
  rollProc: (abilityId: string, chance: number) => boolean,
): number {
  let sum = 0;
  for (const a of recipientAbilities) {
    if (a.config.type !== 'incoming-heal-amplification') continue;
    if (!rollProc(a.id, a.config.procChance)) continue;
    sum += a.config.ampPct;
  }
  return sum;
}
```
Unconditional → no context arg; pure and unit-testable.

### 3.4 The single `HealingRuntimeCtx` method

Add an OPTIONAL method to `HealingRuntimeCtx`:

```ts
/** D-PR6: summed incoming-heal amplification % for a repair landing on `rid` (Exuberance).
 *  Rolls the recipient's incoming-heal-amp procs ONCE (combat-lifetime gate keyed by rid+ability).
 *  Absent → callers use 0 → byte-identical. */
recipientIncomingHealAmpPct?: (rid: string) => number;
```

The engine populates it (where it constructs the healing ctx):
```ts
recipientIncomingHealAmpPct: (rid) =>
  incomingHealAmpForRecipient(
    incomingHealAmpAbilitiesOf(rid),
    (abilityId, chance) => rollRateGate(procChanceGates, `${rid}:${abilityId}`, chance)
  ),
```
with a new `incomingHealAmpAbilitiesById` map (built exactly like `incomingAbilitiesById`, filtering
passive-slot abilities for `config.type === 'incoming-heal-amplification'`) + accessor
`incomingHealAmpAbilitiesOf(id)`. `rollRateGate` + `procChanceGates` already exist (D-PR4).

**Optional → byte-identical:** standalone/test callers that build a `HealingRuntimeCtx` without this
method are unaffected; call sites use `?? 0`.

### 3.5 Apply-site folds (all share the one ctx)

At each of the four repair-apply sites, immediately after the existing per-recipient incoming factor and
before `applyHealToTarget`/`credit`, multiply once:
```ts
raw *= 1 + (healing.recipientIncomingHealAmpPct?.(rid) ?? 0) / 100;
```
- cast player branch + cast `healEventOnly` branch (`playerTurn.ts`) — `rid` is the loop variable.
- reactive heal executor (`triggers.ts`) — `ctx.healing.recipientIncomingHealAmpPct?.(rid)`, `rid` the
  loop variable.
- HoT tick (`playerTurn.ts`) — recipient is the holder (`actor.id`); call once per tick.
**Call exactly once per application** (it rolls the gate once → one proc event per repair received).
A single cast/reactive/HoT application of a repair to `rid` = one event. (`raw` becomes `let`.)

### 3.6 Registry

`buildEquipmentAbilities.ts`:
```ts
const EXUBERANCE_PROC: Record<string, number> = { uncommon: 0.17, rare: 0.20, epic: 0.24, legendary: 0.30 };
const EXUBERANCE_AMP:  Record<string, number> = { uncommon: 12,   rare: 13,   epic: 14,   legendary: 15 };

EXUBERANCE: (rarity) => {
  const amp = EXUBERANCE_AMP[rarity]; const pc = EXUBERANCE_PROC[rarity];
  if (amp === undefined) return undefined;
  return {
    type: 'incoming-heal-amplification',
    target: 'self',
    trigger: 'on-cast',           // inert: not event-driven; consumed by the recipient-side fold
    conditions: [],
    procChance: pc,
    config: { type: 'incoming-heal-amplification', ampPct: amp, procChance: pc },
    autoFilled: true,
  };
},
```
(No common variant.)

## 4. Credit semantics

Amplifying `raw` before `applyHealToTarget`/`credit` inflates the **caster's** credited
effectiveHeal/overheal — identical to how the existing `incomingPctFor(rid)` recipient modifier already
behaves. Exuberance inherits that accounting; no special crediting. (Flagged, not changed — consistent
with the engine's existing recipient-side incoming-heal treatment.)

## 5. Coverage / corpus

`equipmentCoverage.test.ts`: implemented-implants set gains `EXUBERANCE`. With it, the entire D-design
"reactive heal/leech" row is implemented; only Voidfire Catalyst (a different row) remains flagged
deferred.

## 6. Testing & invariants

- **Unit — `incomingHealAmpForRecipient`:** sums ampPct for abilities whose proc fires; 0 when none /
  when gate never fires; additive across multiple abilities; non-`incoming-heal-amplification` configs
  ignored.
- **Unit — `buildEquipmentAbilities`:** Exuberance → `incoming-heal-amplification`, per-rarity
  ampPct/procChance, no common variant.
- **Integration (healing-mode `runCombat`):** a unit carrying Exuberance, repaired repeatedly, receives
  boosted repairs at the gated frequency (e.g. a 0.5-ish proc over N repairs boosts ~N/2 of them by
  ampPct); a unit WITHOUT Exuberance is unchanged. Cover at least the cast-heal path; add reactive
  and/or HoT coverage if the harness supports it cheaply (the single ctx method means all paths share
  one code path, so cast coverage exercises the core; reactive/HoT differ only in the call site).
- **Single-stream check:** repairs from different sources to the same unit draw from ONE gate (assert
  the combined frequency, not per-path) — the fidelity property §3.1.
- **Load-bearing invariant:** all DPS / healing / battle-sim goldens **byte-identical** (the ctx method
  is unpopulated for fixtures without Exuberance → `?? 0`). Plan step 1 = fixture audit. Never
  `vitest -u`.
- `audit:skills` unchanged.

## 7. Open questions for the plan

1. Exact `HealingRuntimeCtx` interface location + every construction site (the engine populates it; do
   any OTHER `HealingRuntimeCtx` builders exist that must stay `?? 0`?).
2. The exact reactive-heal executor recipient loop + whether `ctx.healing` is the same `HealingRuntimeCtx`
   instance there (it is, per recon) so the one method covers it.
3. HoT-tick recipient identity (holder = `actor.id`) and that calling the method there rolls the gate
   once per tick.
