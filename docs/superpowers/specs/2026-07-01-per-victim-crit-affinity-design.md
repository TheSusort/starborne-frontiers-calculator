# Per-Victim Crit + Affinity Cap/Penalty — Design

**Date:** 2026-07-01
**Status:** Approved (design)
**Scope:** Combat-realism "Fix B" — crit cap/penalty resolved per actual victim (affinity), replacing the single `enemy[0]`-representative crit gate shared across all AoE victims.

## Problem

The combat sim rolls crit **once per hit**, at a rate capped/penalized by the affinity
matchup against the **representative opponent** (`enemy[0]` / `playerPlans[0]`), and reuses
that single outcome for every victim an AoE footprint covers. Two bugs follow:

1. **Wrong reference for the cap/penalty.** Affinity disadvantage caps crit at 75% and
   applies a −25 penalty (`affinityUtils.ts:29`). The current gate computes that cap/penalty
   against `enemy[0]`, not the actual victim(s) struck — so crit chance is wrong whenever the
   attacker's affinity vs the real target differs from vs `enemy[0]`.
2. **AoE shares one crit outcome.** All footprint victims inherit the anchor's single
   `hitCrits[h]` boolean, even though the attacker's affinity matchup — and therefore the
   crit cap/penalty — differs per victim.

### Game behavior (grounding)

The developer combat flowchart (`docs/combat-system.md` §8 + §10) resolves `critFunc`
**inside the per-target loop**: `Create Ordered Target List → For each target → For each
pattern target → Perform Ability → critFunc`. So the game rolls crit **per victim**, each a
full Perform-Ability walk (its own hit check *and* its own crit check). The user confirmed:
an AoE still does the full walk per victim — the **only** difference for splash/covered
victims is 50% damage.

### Why now (and not before)

Previously deferred: the old deterministic accumulator (`rateAccumulator.ts` pre-#182) made
per-victim crit a full redesign — extra draws reshuffled a shared crit *schedule*. PR #182
replaced it with independent random draws (`rng() < rate`). Per-victim crit is now a clean
model: each `(hit, victim)` is its own Bernoulli at that victim's capped rate. The remaining
cost is deliberate golden re-baselining for multi-victim AoE (single-target is unaffected).

## Current architecture (the constraint)

- `playerTurn.ts:1225-1230` rolls `hitCrits[]` — one draw per hit at `effectiveCrit`
  (`cappedCrit(critBuff)` using the passed-in `affinityCritCap`/`affinityCritPenalty`, which
  `battleSimulator.ts` computes vs the representative opponent).
- `playerTurn.ts:1509-1519` emits `ability-performed` with `didCrit: roundCrit` and
  `critHits` — **before** the engine runs positional application.
- `positionalApply.ts:170` reuses `hitCrits[h]` for **every** victim in the footprint.
- `victimHitDamage` (`victimDamage.ts`) already computes **per-victim** affinity *damage*
  modifier and per-victim defense — only the `didCrit` boolean is shared.

Crit-signal consumers (verified by wiring, not assumption):

| Consumer | Wiring | Signal it needs |
|---|---|---|
| Bloodthirst (sole `on-crit` trigger, `buildEquipmentAbilities.ts:628`) | consumes `ability-performed.critHits`, rolls a proc per critting hit | **count of critical hits** |
| Lev-style "if crit, do X to all enemies"; debuff+crit synergies | conditional/binary on `roundCrit`, fire once | **binary: did the action crit** |
| Menace (`amplify-on-crit`, `outgoingEffects.ts:6`) | per-hit `ctx.didCrit` in `positionalApply` | **per-victim** |
| Ward / Second Wind / Hardened / Hyperion (incoming-crit) | `on-attacked` / crit-family `incoming-reduction`, read victim's `attacked.didCrit` | **per-victim** |

## Decisions (locked during brainstorming)

| # | Decision |
|---|----------|
| Draw model | **Independent per-victim crit rolls** (full walk per victim). Splash victims differ only by the existing 0.5× `roleScale`. |
| Anchor reuse | The primary/anchor victim **reuses the roll `playerTurn` already made for hit `h`**, but that roll now uses the **bound target's** affinity cap (not `enemy[0]`). Covered victims roll independently. → single-target (all DPS/healing goldens + 1v1 sim) is byte-identical; only multi-victim mixed-affinity AoE re-baselines. |
| Attacker on-crit binary | **OR** across all `(h,v)` outcomes → Lev + debuff-synergy fire once. |
| `critHits` count | **Count of critting `(h,v)` pairs** → Bloodthirst rolls its proc per critical hit. (Only Bloodthirst consumes the count; no count-based self-buffs exist, so no snowball. Verified 2026-07-01: `trigger: 'on-crit'` occurs exactly once in the codebase — `buildEquipmentAbilities.ts:628`. Re-check this grep if abilities are added.) |
| Emission ordering | For the **sim path**, `ability-performed`'s crit fields (`didCrit`/`critHits`) are emitted **after** positional application so they reflect the per-victim rolls. The DPS/healing path keeps emitting in `playerTurn` (single dummy target), unchanged. |
| Conditional firing-damage payloads | **Stay anchor-based** (gated on the primary crit computed in `playerTurn`). Per-victim conditional-damage is a documented out-of-scope follow-up (no such payload found in scope). |
| Untouched | DPS calculator, healing calculator, per-victim damage math, 0.5× splash scale. |

## Data flow

```
playerTurn (per acting ship):
  roll hitCrits[h] at cappedRate(attacker vs BOUND target affinity)   ← fixes bug 1 for anchor
  compute anchor roundCrit / critHits (used by DPS aggregate + conditional payloads)
  DPS/healing path: emit ability-performed here (unchanged)
  sim path: DEFER ability-performed crit fields
  → return hitCrits + scalars + attacker uncapped crit rate + attackerAffinity

engine → positionalApply (sim, per hit h, per footprint victim v):
  didCrit(h,v) =
     v is anchor ? hitCrits[h]
                 : critGate( cappedRate(attacker vs v.affinity) )     ← per-victim, independent
  victimHitDamage(..., didCrit(h,v), roleScale)                        ← per-victim damage (already affinity-correct)
  emitHit / attacked event carries didCrit(h,v)                         ← Ward/Second Wind/etc. per-victim for free
  amplification incomingReduction read didCrit(h,v)                     ← Menace per-victim for free
  accumulate: anyCrit |= didCrit(h,v);  critPairs += didCrit(h,v)?1:0

engine (sim, after positional apply):
  emit ability-performed { didCrit: anyCrit, critHits: critPairs, ... }  ← Bloodthirst + Lev/synergy
```

## Components & boundaries

- **`positionalApply.ts`** — gains a per-victim crit resolver: an injected
  `critFor(victim, hitIndex) => boolean` (anchor → reuse `hitCrits[h]`; else roll the
  attacker's per-victim gate at the victim's capped rate). Returns the accumulated
  `anyCrit` / `critPairs` so the engine can emit the aggregate. Stays a pure module —
  the gate + affinity resolution are injected callbacks.
- **`playerTurn.ts`** — (a) roll `hitCrits` against the **bound target's** cap/penalty
  (compute from `attackerAffinity` vs `enemy.affinity`, replacing the passed-in
  representative scalars for the *anchor* roll); (b) DPS/healing keep emitting
  `ability-performed`; (c) sim path returns the deferred crit inputs.
- **`engine.ts`** — supplies the per-victim crit gate + affinity to `positionalApply`,
  and emits the sim-path `ability-performed` crit fields after positional apply.
- **`battleSimulator.ts`** — threads each victim's affinity so the per-victim cap/penalty
  can be resolved (mostly already present via `defenseProfileOf`).

## Error / edge handling

- **Single victim** (DPS, healing, 1v1 sim): only the anchor path runs → same draw count,
  byte-identical output.
- **Victim dies mid-skill**: footprint re-resolves per hit (existing behavior); a victim
  gone from the roster is never rolled.
- **`noCrit` attack**: `drawHits = 0` → no anchor draw and no per-victim draws (unchanged).
- **rate ≥ 1 / ≤ 0**: `critGate` clamps (always/never), so a 100-crit attacker still always
  crits every victim; a disadvantaged victim's cap merely lowers *its* threshold.
- **Reaction ordering (planner must verify)**: moving the sim-path `ability-performed` emission
  from `playerTurn` to the engine (post-positional-apply) changes *when* that event fires on
  the bus relative to per-victim `on-attacked`/`attacked` events. The plan must confirm no
  listener depends on `ability-performed` firing *before* the per-victim attacked events
  (e.g. a reaction that reads state the attacked events would mutate). Currently
  `ability-performed` fires before positional application; after the change it fires after.

## Testing

- **Unit (`positionalApply`)**: with a scripted RNG, an AoE onto a disadvantaged victim
  (cap 75 / penalty 25) and a neutral victim yields the disadvantaged victim critting only
  when the draw clears its lower threshold; neutral victim uses the full rate. Anchor reuses
  `hitCrits[h]`.
- **Integration (full battle via `simulateBattle`)**: AoE onto a mixed-affinity enemy line
  → disadvantaged victim crits measurably less over many rounds; Bloodthirst proc count
  scales with the number of critting victims; a Lev-style on-crit effect fires once when any
  victim crits.
- **Golden guard**: single-target DPS/healing goldens **byte-identical**; multi-enemy AoE
  goldens deliberately re-baselined (documented in the PR, never blind `-u`).

## Out of scope

- Per-victim resolution of conditional firing-*damage* payloads gated on "did this attack
  crit" (kept anchor-based).
- Any change to the shared random-draw mechanism from #182.
