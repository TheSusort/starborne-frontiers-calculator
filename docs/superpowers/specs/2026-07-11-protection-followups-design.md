# Protection follow-ups: efficiency gate, Lionheart round-start Protection, all-allies coverage

**Date:** 2026-07-11
**Status:** Approved (design)
**Baseline:** `main` @ Protection-as-damage-transfer shipped (PR #247, `d035d82a`)
**Related:** `project_protection_damage_transfer` memory; `project_combat_engine_current_state`

## Summary

Three independent follow-ups to the shipped Protection damage-transfer mechanic. All are
behavior-preserving for existing content except the new Lionheart behavior (Task 2), which no
existing golden exercises.

1. **Efficiency gate** — precompute a board-level `hasAnyProtectionGrant` boolean so
   `protectorsFor` short-circuits on the common case (no Protection anywhere).
2. **Lionheart round-start Protection** — model Lionheart's refit passive literally: a
   round-start refresh-to-10 Protection grant + a clear-all-Protection-after-redirect reaction.
3. **All-allies coverage** — Protection covers all living same-side allies, not hex-neighbours.
   Latent bug: `protectorsFor` uses the adjacency-aware helper, which narrows to neighbours in
   positional encounters.

**Implementation order:** Task 3 → Task 1 → Task 2 (coverage fix + gate are independent
groundwork; Lionheart builds on top). One PR with three commits, or three stacked PRs.

## Background

Protection is an ally damage-transfer buff: each stack redirects 10% of a direct hit landing on
a same-side ally onto the protector (re-mitigated on the protector's own defence, keeping the
original target's affinity). Redirect fraction caps at 100% (10 stacks). The cascade is
speed-ordered and precomputed from pre-hit stacks. See `protectionTransfer.ts` and the transfer
block in `engine.ts` `applyVictimDamage` (~3530-3585).

The confirmed model (PR #247) states "Coverage = ALL allies." The engine comment claims allies
resolve "via bySide," but the code calls `adjacentAllyIdsFor` — which only returns all allies in
non-positional mode (Task 3).

---

## Task 1 — `hasAnyProtectionGrant` board-level efficiency gate

### Problem

`protectorsFor` (engine.ts:2901) runs on every direct hit. For each direct hit it iterates the
victim's allies and performs a 3-source `selfBuffStacksForOwner` read per ally — even when no
ship on the board can ever hold Protection (the common case: most teams run no Protection).

### Design

Precompute one boolean at setup, alongside `defenseSubstitutionCarrierIds` (engine.ts:2887):

```ts
const hasAnyProtectionGrant = [...runtimesById.values(), ...enemyPlayerRuntimeByActorId.values()]
    .some((rt) =>
        rt.castSkills.slots.some((slot) =>
            slot.abilities.some(
                (a) => a.config.type === 'buff' && a.config.buffName === 'Protection'
            )
        )
    );
```

- **Scan all slots** (not just `passive`, unlike `defenseSubstitutionCarrierIds`) — Meatshield's
  Protection is a passive aura, but Lionheart's round-start grant and a future charge-slot steal
  live on other slots.
- **Board-level boolean, not a per-actor Set** — Protection can (in deferred mechanics) be
  stolen/transferred onto a ship that carries no grant ability of its own; a per-actor carrier Set
  would miss the recipient. The boolean only asserts "Protection is possible on this board,"
  which is exactly the gate needed and is safe against transfer.

`protectorsFor` early-returns when false:

```ts
const protectorsFor = (victim) => {
    if (!hasAnyProtectionGrant) return [];
    // ...existing all-allies resolution + stack read...
};
```

### Correctness

Behavior-preserving: when Protection exists on the board, the boolean is true and the existing
path runs unchanged → goldens byte-identical.

### Tests

- Unit: board with no Protection-granting ability → `hasAnyProtectionGrant` false →
  `protectorsFor` returns `[]`.
- Regression: existing Meatshield protection integration tests stay green.

---

## Task 2 — Lionheart round-start Protection (literal grant + clear-on-redirect)

### Lionheart's refit passive (docs/ship-skills.csv)

> "At the start of combat, this Unit grants all adjacent allies 10% of its HP.
> At the start of the round, this Unit gains 10 stacks of Protection.
> After taking damage redirected through Protection, all Protection is removed."

The first sentence (pre-combat HP gift) is already modeled. This task adds the two Protection
clauses. **No `triggerFrequency` enum** — the once-per-round behavior emerges from clearing
stacks, so the field is unnecessary.

### 2a. Round-start grant — refresh-to-10 (LOCKED)

Parse *"At the start of the round, this Unit gains 10 stacks of Protection"* → a `buff` ability,
`buffName:'Protection'`, `stacks:10`, trigger `start-of-round` (→ `round-started` event).

**Semantics: refresh-to-10, not accumulate.** Each round Lionheart is set to exactly 10 stacks,
never climbing. This is distinct from Meatshield's accumulating `stackTrigger:'per-round'` aura.

Rationale (why refresh matters even though redirect fraction caps at 100%): the transfer block
splits a redirected chunk into `stacks` equal per-stack sub-hits
(`for (s=0; s<chunk.stacks; s++) applyVictimDamage(chunk.perStack, ...)`, `perStack=kept/stacks`).
Total HP damage is identical for 10 or 20 stacks, but the **sub-hit count equals the stack
count**. An accumulated 20 stacks would emit 20 half-size sub-hits instead of 10 — diverging from
the game's 10 procs in (a) the combat log / deferred per-stack log events, (b) the stack-count
display, and (c) the deferred per-stack DoT-transform. Refresh-to-10 keeps all three correct.

Divergence only occurs in a round where no ally is hit (Protection isn't cleared); refresh makes
that round idempotent.

**Implementation note (resolve in planning):** prefer native refresh semantics if the status
engine replaces stacks on re-grant of a non-stackable named buff; otherwise implement the
round-start handler as `removeSelfBuffByName(id,'Protection')` + grant 10 (exact and trivial).

### 2b. Clear-all-Protection after redirect

Parse *"After taking damage redirected through Protection, all Protection is removed"* → a boolean
marker on the ship's Protection ability. Precompute `clearProtectionOnRedirectIds: Set<string>`
at setup (mirroring the carrier-id precompute pattern).

In the transfer block (engine.ts ~3571), **after** all cascade chunks are applied, for any
protector whose id is in `clearProtectionOnRedirectIds`, call
`removeSelfBuffByName(protector.id, 'Protection')`.

**Timing correctness:** the cascade is precomputed from pre-hit stacks, so the current hit
redirects fully before any clear. Removal only affects *subsequent* hits this round. Next round's
`round-started` re-grants 10. Apply-then-clear is therefore correct.

### Net in-sim behavior

Lionheart is a once-per-round bodyguard: at round start it has 10 stacks (100% redirect for all
living same-side allies); the first direct hit on any ally that round is fully redirected onto
Lionheart (re-mitigated on Lionheart's defence, original target's affinity kept), then all
Protection is removed; further ally-hits that round are not redirected; next round resets to 10.

### Tests

- Parser unit tests: both clauses (round-start 10-stack grant; clear-on-redirect marker).
- `simulateBattle` integration: Lionheart + ally, ally hit twice in one round → hit 1 redirected
  to Lionheart, hit 2 not (stacks cleared); next round redirect resumes.
- Refresh: a round with no ally-hit → Lionheart still at exactly 10 stacks the following round
  (not 20).

---

## Task 3 — Protection coverage = all living same-side allies

### Problem

`protectorsFor` resolves allies via `adjacentAllyIdsFor` (engine.ts:2902). `adjacentAllyIds`
(adjacency.ts:21) returns:

- **Positional** (board positions wired): only hex-neighbour allies.
- **Non-positional** (every current production path): all living same-side allies.

So Protection is all-allies today only incidentally. In a positional encounter it would wrongly
narrow to neighbours, contradicting the confirmed "Coverage = ALL allies" model.

### Design

`protectorsFor` resolves all living same-side allies directly, independent of the adjacency
helper:

```ts
const allyIds = [...allActorsById.values()]
    .filter((a) => a.side === victim.side && a.currentHp > 0 && a.id !== victim.id)
    .map((a) => a.id);
```

(Keeps the existing per-ally stack read + fastest-first sort.) Genuinely adjacency-scoped
mechanics — Lionheart's pre-combat HP gift, Centurion, etc. — continue to use `adjacentAllyIds`
and are untouched.

### Correctness

Behavior-identical in current non-positional production (all-allies == `adjacentAllyIds` output)
→ no golden movement.

### Tests

- Positional-mode integration test: Protection redirects a *non-adjacent* ally's hit onto the
  protector, proving Protection ignores adjacency while a genuinely-adjacent mechanic in the same
  setup still respects it.

---

## Global safety

- Full `npm test` green.
- `audit:skills` stays 0.
- No golden movement (Tasks 1 and 3 are behavior-preserving; Task 2 is Lionheart-only and no
  golden runs Lionheart Protection).
- Team-symmetric: all three respect the engine's side-agnostic construction (a ship behaves
  identically on either side).

## Out of scope (still deferred from PR #247)

- Per-stack log events (in-game N separate procs vs one `reactive-damage-performed` per protector).
- Protection→DoT transform sibling (Meatshield R2/R3) + dynamic stack-stealing (charge skill).
- Barrier-immune-victim redirect edge; `targetMit`-fallback precision nuance.
