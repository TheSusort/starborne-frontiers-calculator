# Protection→DoT transform + barrier-immune-victim edge — Design

**Date:** 2026-07-12
**Status:** Approved (design)
**Depends on:** Protection damage-transfer (PR #247, `d035d82a`) + follow-ups (PR #248, `855d7276`)

## Background

Protection is modeled as an ally damage-transfer: a living ally holding Protection
stacks intercepts `10% × stacks` of a target's direct hit. The intercepted chunk keeps
the original target's affinity/outgoing and re-mitigates on the protector's own defence
(the mit-ratio trick inside `protectionCascade`). Today the redirected chunk lands on the
protector as **instant** HP loss.

Two gaps remain from the shipped work (both touch `applyVictimDamage` ordering, so they
ship together):

1. **Protection→DoT transform** — Meatshield's refit-active passive reads *"Any damage
   this Unit takes from Protection is transformed into a Damage over Time effect for 2
   turns."* Redirected chunks should land as a 2-turn self-DoT, not instant. The parser
   deliberately skips this clause today (see `skillTextParser.ts` ~2404) and the engine's
   `transform-incoming-to-dot` block isn't gated to protection-source.

2. **Barrier-immune-victim edge** — the transfer block (`engine.ts:3577`) runs *before*
   the victim's own `carriesBarrier` nullification (`engine.ts:3745`) and, unlike the
   incoming-block step (3520) and the transform step (3686), is **not** gated on
   `!carriesBarrier`. So a target whose Barrier would fully nullify the hit still
   redirects chunks to protectors. Currently "HP-safe but untested."

Explicitly **out of scope** (remain deferred): per-stack log-event fidelity (the instant
`reactive-damage-performed` → a DoT-application event) and Meatshield's dynamic
stack-stealing active/charge (*"steals Protection until this Unit has 3 stacks"*).

## Ruling: barrier semantics

**Barrier suppresses the redirect.** Barrier sits strictly in front of every other
incoming-effect mechanism (the engine's stated precedent, and how incoming-block and the
DoT-transform are already gated). An invulnerable target has no "incoming hit" for allies
to soak, so protectors take nothing.

## Component A — Barrier suppresses the redirect

**Change:** add `!carriesBarrier` to the transfer-block guard at `engine.ts:3577`
(alongside the existing `byDirectDamage && !isProtectionTransfer && !isReflected &&
!isCounter && damage > 0`).

**Effect:** when the original target's Barrier fully nullifies the hit, no chunk is
redirected — protectors take nothing, and the target takes nothing (via its existing
`carriesBarrier` branch).

**Not affected:** the *protector's own* Barrier already works — the recursive
`applyVictimDamage(chunk…)` hits the protector's own `carriesBarrier` branch and nullifies
its chunk. This change concerns only the *target's* barrier.

**Verification:** full suite + skill audit stay green with **no golden moved** (expected,
since no existing fixture exercises a barriered target with a protector). Add a targeted
test: barriered target + a protector → protector takes 0, target takes 0.

## Component B — Protection→DoT transform (Meatshield refit-active passive)

Reuses the existing `transform-incoming-to-dot` primitive, gated to protection-source
only via a new incoming condition. The per-stack sub-hit loop at `engine.ts:3624` was
built deliberately *"to set up the deferred DoT-transform, which acts per redirected
chunk"* — the hook per sub-hit is already anticipated.

### B1 — Types (`src/types/abilities.ts`)

- Add `'self-protection-redirect'` to the `IncomingCondition` union.
- Add `viaProtectionRedirect: boolean` to `IncomingHitContext`.

### B2 — `conditionMet` (`src/utils/combat/incomingEffects.ts`)

- `case 'self-protection-redirect': return ctx.viaProtectionRedirect;`

### B3 — Parser (`src/utils/skillTextParser.ts`)

- New detector matching *"damage this Unit takes from Protection is transformed into a
  Damage over Time effect for N turns"* → emits a `transform-incoming-to-dot` ability with
  `condition: 'self-protection-redirect'` and `turns: N`.
- Must **coexist** with the same passive's other clauses (Protection start-of-combat grant
  + defense-substitution). Corpus-verified: only Meatshield's refit-active passive matches.
- Keep the existing Voron/Orel `TRANSFORM_TO_DOT_RE` (which requires the literal
  *"transform the damage into a"*) untouched — the two detectors stay disjoint.

### B4 — Engine transform block (`engine.ts:3686`)

- Add `viaProtectionRedirect: cause?.isProtectionTransfer ?? false` to the constructed
  `hitCtx`. Meatshield's redirected sub-hits (applied with `isProtectionTransfer: true`)
  now match `self-protection-redirect`; a **normal** direct hit on Meatshield does not
  match (flag absent) — exactly the kit text ("damage … from Protection").

### B5 — Engine transfer block accounting (`engine.ts:3618–3648`)

- Capture each recursive `applyVictimDamage` return; sum `transformedToDot` across the
  chunk's sub-hits (`transformedTotal`).
- Credit `roundPerTargetDamage` for the protector with the **instant** portion only:
  `chunk.total − transformedTotal`.
- Emit `reactive-damage-performed` with the instant portion as `amount`; **suppress** the
  emission when the chunk was fully transformed (`instant === 0`).
- The deferred (transformed) portion surfaces via the existing generic-DoT tick path over
  the next `turns` rounds, self-sourced on the protector (`sourceId = protector.id`), same
  as Voron/Orel.

### Behavior

A fully-refitted Meatshield takes redirected chunks as a 2-turn self-DoT (one generic-DoT
entry per redirected sub-hit; HP total = `chunk.total` spread over 2 turns), not instant.
HP outcome over the DoT window equals today's instant total; only the timing changes.

## Interactions verified in design

- **Defense-substitution co-occurrence:** when the original (non-defender) target has
  Meatshield's defense-substitution active, `damage` was already mitigated with the
  substituted defence upstream; the redirected chunk (mit-ratio) is unchanged, then
  transformed to DoT. No conflict — transfer peels first, remainder gets substituted def.
- **Voron/Orel as protector (hypothetical):** Voron's `condition: 'always'` would also
  transform a redirected chunk — arguably correct ("when directly damaged"), and no fixture
  has Voron as a protector today, so no regression.
- **Barrier + transform:** the transform block already carries `!carriesBarrier`; a
  protector holding Barrier nullifies its chunk before any transform (correct).

## Testing

- Component A: barriered target + protector → both take 0; no golden moved.
- Component B parser: Meatshield refit-active passive parses grant + defense-sub +
  `transform-incoming-to-dot(self-protection-redirect, turns=2)` together; normal direct
  hits produce no transform ability match against `self-protection-redirect`.
- Component B engine: redirected chunk on Meatshield → self-DoT of `chunk.total / 2` per
  tick for 2 rounds; protector HP unchanged the turn of redirect; `perTargetDamage` shows
  the deferred amounts over the DoT window, not instant.
- Full suite (`npm test`) green; skill audit 0.

## Files touched

- `src/types/abilities.ts` — condition + ctx field
- `src/utils/combat/incomingEffects.ts` — `conditionMet` case
- `src/utils/skillTextParser.ts` — new protection-transform-to-DoT detector
- `src/utils/combat/engine.ts` — transfer-block barrier gate (A), `hitCtx` flag +
  transfer-block accounting (B)
- Tests under `src/utils/combat/__tests__/` and the parser/audit tests
