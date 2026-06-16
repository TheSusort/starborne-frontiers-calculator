# Dynamic Speed & Turn Order — Combat Engine Design

**Date:** 2026-06-16
**Status:** Design (approved in brainstorm, pending spec review)
**Scope:** Focused, unification-aligned. The simulator page (`/simulator`, PR #117) is the test harness.

## Problem

In the combat simulator, speed buffs/debuffs do not change the run order. Root cause (verified in code):

1. **Turn order uses static speed.** Each round `buildTurnQueue` (`state.ts:214`) sorts actors by `actor.stats.speed`, a field seeded once at actor construction and **never mutated** during combat. Gear/base speed differences reorder turns; nothing applied mid-combat does.
2. **Speed is not in the buff/modifier model at all.** `calculateBuffTotals` (`playerTurn.ts:283`) folds attack/crit/critDamage/outgoingDamage/defence/hp/heal into effective stats — there is no speed channel. `ModifierChannel` (`abilities.ts:155`), `Buff.stat` (`calculator.ts:62`), and `ParsedBuffEffects` (`calculator.ts:90`) all omit speed. A parsed "Speed Up II" is dropped — it affects nothing.

By contrast, the **other** stats are already resolved live per-turn: `effectiveMaxHp` is recomputed every turn and the engine even handles a max-HP buff expiring shrinking it (`engine.ts:1707`); attack/crit/critDamage/defence/outgoingDamage fold through `calculateBuffTotals`; defenders' defence modifiers feed `victimDamage.ts` when hit. Enemy actors run the same `runPlayerTurn` path, so this holds both sides. **Speed is the one stat left out of the dynamic model** — and the most visible one, because the turn-order strip displays it.

## Goal & Turn Model (user-ratified)

Order-only, dynamic speed. Confirmed rules:

- Each ship acts **once per round** (the ratified "speed = ORDER, not frequency" rule — *not* a turn-meter / frequency model; `combat-system.md §1`'s meter description is outdated vs. how the game runs now).
- All participants are ordered each round by speed; **when any unacted ship's speed changes mid-round, the order of the remaining (unacted) ships updates.**
- Buffs can be applied, expire, be purged, or be regained — speed reflects the live set.
- Ships with **conditional extra actions** (skill-kit features, e.g. Liberator, Harvester) are inserted when their condition resolves, at their current effective speed.
- Speed range in practice: base ~50–90, geared up to ~350 (320+ is rare).

Most "stats aren't dynamic" perception is, in practice, this single speed gap. Fixing speed makes the system behave as "all stats dynamic."

## Design

### 1. Effective-speed model

Add `speed` as a first-class buff/modifier stat:

- Extend `ModifierChannel` (`abilities.ts`), `Buff.stat` (`calculator.ts`), and `ParsedBuffEffects` (`calculator.ts`, `speed?: number`).
- Add a `speed` channel to `calculateBuffTotals` (`playerTurn.ts`).
- Teach the parser to emit speed effects for the corpus speed buffs, mapped via `constants/buffs.ts`:
  - **Speed Up I / II / III** = +10% / +30% / +45%
  - **Speed Down I / II** = −15% / −30%
  - Faction-named speed buffs (e.g. XAOC Swiftness; Harvester grants "Speed Up I"). Audit `constants/buffs.ts` + the skills CSV for the full set.
- Formula (mirrors `effectiveAttack`): `effectiveSpeed = baseSpeed × (1 + Σ speedBuff% / 100)`, Speed Up positive, Speed Down negative. Speed Up and Speed Down are distinct families (both can be active); within a family the existing family-overwrite rule applies.
- A single pure, side-agnostic authority `effectiveSpeedOf(actorId): number` reads the live status engine. All ordering decisions go through it.

### 2. Selection-based round loop (mechanism B)

Replace the per-round pre-built `queue` array + indexed `for(qi)` loop + splice-based reinsertion with a **multiset action-pool** model:

- **Pool** = pending *actions*, one per living actor at round start (NOT a boolean acted/unacted set — an actor can hold multiple pending actions simultaneously).
- Pure, side-agnostic selector `selectNextBySpeed(pendingActors, effectiveSpeedOf)`: among actors with ≥1 pending action, pick the highest **current** effective speed; tiebreak side (player before enemy) → input order. This is the unification seam.
- Each round: seed one action per living actor → loop `pick → run turn → decrement that actor's pending count` until the speed pool empties → drain any **end-of-round-tagged** actions last.
- Because the selector reads effective speed at pick time, **any speed change since round start is reflected automatically at the next selection** — there is no re-sort hook to wire into mutation sites, hence nothing to miss. This is the correctness-by-construction advantage over a mutable-array + re-sort-hook approach.
- Carry over the existing `extraActionFired` once-per-round gating (`${actorId}:${abilityId}`) and the `MAX_EXTRA_TURNS_PER_ROUND` backstop.

### 3. Extra-action integration

- `grantExtraAction` / `processExtraActionGrants` (`engine.ts:2356`, `:2399`) **push a pending action** for the granter instead of splicing it into an array.
- Selection reads effective speed at pick time. Because `processExtraActionGrants` runs *after* `runPlayerTurn` returns (which performs the granter's Post-Turn buff decrement internally), the reinsertion sees the **post-decrement** speed — so a ship whose speed buff just ticked to 0 is re-selected further back (the Thresh / slow-Liberator behavior).
- **End-of-round grants** (Harvester's "1 extra end of round action") get a tag that defers them to the end-of-round drain. Default/Liberator grants ("1 extra action") are speed-positioned. (Today the engine always speed-inserts; the end-of-round tag is a small added fidelity.)

#### Worked example — Liberator ("once per round, gains 1 extra action" on enemy death)

- *Acts, doesn't kill; later an ally kills:* Liberator pending 1→0 on his turn; the kill fires his on-enemy-destroyed grant → pending 0→1 → re-selected later at current effective speed.
- *Slow Liberator; ally kills before his turn:* Liberator still holds his base action (pending 1); the kill grant pushes pending 1→2 → he takes both this round, each placed by effective speed at selection. The once-per-round cap blocks a third action from a second same-round death.

### 4. Consequences to handle

- **Chakara `lowest-speed-ally` gate.** Today `lowestSpeedAllyIds` is computed once from static speed (`engine.ts:1410`); `lowestSpeedEnemyIds` similarly (`:1539`). Under dynamic speed these must be recomputed live from effective speed at gate-eval time. (The handover flagged this exact dependency: "speeds static = turn order" was load-bearing for Chakara.)
- **Tiebreak determinism.** Preserve side → input order. Two same-actor pending actions share an effective speed and resolve deterministically (adjacent or interleaved by other actors' speeds).
- **Verify pass.** Confirm non-speed stats are genuinely live (they appear to be: `effectiveMaxHp`, defence, attack, crit). Expected to be no new work — add guard tests rather than changes.

### 5. Unification posture

Every new piece — `effectiveSpeedOf`, `selectNextBySpeed`, the action-pool loop — is **side-agnostic by construction** (no player/enemy mirror). It *seeds* the deferred team-agnostic `bySide` unification rather than adding to the mirror. The turn queue is already a single shared structure across both sides; this design keeps it that way and removes a static assumption, leaving the execution/accounting unification as a separate later effort.

## Testing & golden churn

- **Golden byte-identity is NOT a hard constraint here** (user call: many team tests are suspect). Team/queue goldens that churn will be *fixed/regenerated* with correct expectations rather than preserved. Each churned golden must be audited and justified (no blind `-u`).
- **DPS single-attacker goldens should NOT move** — their fixtures carry no speed buffs and one attacker, so ordering is unaffected. Any movement there is a real signal to investigate.
- New focused tests:
  - `selectNextBySpeed` unit tests (ordering, tiebreak, multiset pending, empty pool).
  - Effective-speed buff math (`baseSpeed × (1 + Σ%/100)`; Speed Up + Speed Down coexisting; family overwrite).
  - Speed Down reorders an enemy later; Speed Up reorders an ally earlier.
  - Thresh-style: buffed first action, buff expires at Post Turn, extra action reinserted at lower speed → lands further back.
  - Both Liberator scenarios (acted-then-kill; slow-Liberator kill-first), including once-per-round cap.
  - Chakara `lowest-speed-ally` under dynamic speed (the lowest-speed ally changes after a Speed Down).
  - Harvester end-of-round extra action drains last.

## Out of scope

- Turn-meter / frequency model (explicitly rejected — order-only).
- Implant system (extra fittable skills, e.g. "Speed Up III when an enemy is repaired") — not yet implemented; the model accommodates reactive speed grants but implants are a separate future feature.
- Full team-agnostic engine unification (this work seeds it; the ~10-increment execution/accounting unification is a separate effort).
- Direct turn-meter manipulation skills (add/subtract meter) — no clean mapping under order-only; revisit only if a shipped ship requires it.
- Phase-4 AoE-covered-victim per-victim accounting approximations (separate, narrower deferral).
