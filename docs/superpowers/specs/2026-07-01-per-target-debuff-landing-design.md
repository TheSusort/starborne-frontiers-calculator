# Design — Per-target debuff landing (on-turn path)

**Date:** 2026-07-01  
**Sub-project:** Sub-project 2 of the "eliminate `enemy[0]` from the sim" epic (handoff: `docs/superpowers/handoffs/2026-07-01-no-enemy0-in-sim-handoff.md`).  
**Prereq shipped:** Sub-project 1 — anchor crit at real affinity (`cursor/anchor-crit-real-affinity`, PR #184).  
**Explicitly NOT:** a swap-the-affinity-source tweak. Requires positional/per-victim debuff **application** design, not just landing-input correction.

## Problem

In the multi-enemy battle sim, **on-turn debuff landing** still resolves against the **representative opponent** (`enemy[0]` / `player[0]`) in two places inside `runPlayerTurn`, even when the engine has already bound the real turn target (`buildTurnArgs(actor, tgt)` → `enemy: tgt`).

### Gate 1 — `'apply'` (affinity disadvantage)

```829:834:src/utils/combat/playerTurn.ts
    const landsTimedEnemyApplicationLive = (application?: 'inflict' | 'apply'): boolean =>
        targetImmuneToDebuffs
            ? false
            : application === 'apply'
              ? !affinityDisadvantage
              : debuffLandingGate(liveLandingChance);
```

`affinityDisadvantage` is a **static runtime scalar** baked at engine setup from `affinityDamageModifier < 0`, where `affinityDamageModifier` was computed in `battleSimulator.ts` / `engine.ts` against the **representative** opposing affinity (`enemyPlans[0]` / `playerPlans[0]`). It does **not** re-resolve against `enemy.affinity` (the bound anchor) on each turn.

The same static flag feeds:
- `resolveEnemyDebuffs` recurring/aura re-application (`playerTurn.ts:431`)
- recurring ability-enemy statuses in the timed loop (`playerTurn.ts:1110`)

### Gate 2 — `'inflict'` (hacking vs security)

```810:816:src/utils/combat/playerTurn.ts
    const liveLandingChance = liveDebuffLandingChance(
        statusEngine,
        selfBuffLookup,
        actor,
        enemy,
        affinityDamageModifier
    );
```

`liveDebuffLandingChance` (`effectiveStats.ts:127-140`) folds:
- **Defender security** from the bound `enemy` actor → **correct when positional** (anchor carries real `stats.security` + buff fold).
- **Attacker hacking × affinity** using the **representative** `affinityDamageModifier` scalar → **wrong** when anchor affinity ≠ representative.

When **non-positional** (DPS / focus dummy), `enemy` is the dummy sink with representative security — behaviour is intentionally representative and must stay **byte-identical**.

### Routing — debuffs land on the anchor only

Ability-sourced timed debuffs apply via:

```1031:1032:src/utils/combat/playerTurn.ts
        if (landsTimedEnemyApplicationLive(status.payload.application)) {
            statusEngine.applyTimedAbilityStatus(r, status, actor.id, targetId);
```

`targetId` is threaded from `buildTurnArgs` for the resolved anchor (`engine.ts:3927-3934`). **No footprint fan-out exists for debuffs** — grep confirms no positional debuff apply helper (contrast: `drivePositionalApply` for damage, `aoeVictimIds` fan-out for `'all-enemies'` **purge** at `playerTurn.ts:1729-1730`).

Engine comment (PR7) documents the gap explicitly:

> Covered victims have NO same-turn re-apply vector (the turn's debuffs only target `tgt.id`)

Per-victim debuff **reads** for damage already work (`victimIncomingModifiers` in `drivePositionalApply.defenseProfileOf`) — Task 3/4 shipped routing-to-store + per-victim modifier fold. **Landing + application** do not.

### Focus dummy blocks the simple path

For the **focus attacker** in battle-sim mode, a vestigial dummy `enemy` actor remains the legacy sink (`battleSimulator.ts:729-754`: huge HP, representative security, no board position). Positional casts bind `tgt` (real anchor) via `selectTurnTarget`, but:

- Non-positional casts still bind the dummy → representative is correct there.
- Any fix must be **gated** on positional/deferred paths (`deferAbilityPerformedToEngine` / `targetId` / `aoeVictimIds`), mirroring Sub-project 1 — never perturb DPS dummy behaviour.

### Reactive path already target-aware ("Fix A")

`triggers.ts` debuff executor re-resolves `'apply'` landing via `ctx.affinityOf?.(debuffTargetId)` and `owner.landsTimedEnemyApplication(cfg.application, targetAffinity)` (`triggers.ts:1672-1681`). `landsTimedEnemyApplication` on `PlayerActorRuntime` already accepts optional `targetAffinity` (`playerTurn.ts:239-242`, wired in `engine.ts:1449-1461` for focus + enemy attackers).

**The on-turn path in `runPlayerTurn` does not use this second parameter** — it calls the turn-local `landsTimedEnemyApplicationLive` closure instead, which reads the static representative scalars.

## User directive (same epic as SP1)

For the multi-enemy sim, affinity-sensitive effects must resolve against the ship **actually being debuffed**, not `enemy[0]`. DPS calculator exempt (single chosen target = representative = correct).

## Why this is larger than Sub-project 1

| Dimension | SP1 (anchor crit) | SP2 (debuff landing) |
|-----------|-------------------|----------------------|
| Existing per-victim seam | `rollVictimCrit(victim.affinity)` already in positional apply | **No** positional debuff apply seam |
| Anchor binding | `enemy: tgt` already carried real affinity; fix was cap input only | Landing uses static scalars; `'inflict'` partially uses bound defender |
| Footprint victims | Covered crits already per-victim | Debuffs never applied to covered cells |
| Same-turn coupling | Crit draws before damage; anchor reuse safe | Debuffs apply **before** modifier fold → affect same-turn damage |
| Dummy sink | Non-positional byte-identical via flag | Same gate required |
| Draw semantics | One crit draw per hit regardless of rate | `roundDebuffLanded()` is **one memoized draw per round** for all recurring inflict debuffs |

**Conclusion:** SP2 needs a **decomposition** — anchor landing correction (SP2a) and footprint application + per-victim landing (SP2b) are separable deliverables.

---

## Approaches considered

### Strategy A — Anchor landing only (SP2a; SP1 analog)

At the existing landing sites in `runPlayerTurn`, when `deferAbilityPerformedToEngine === true` (or equivalently `targetId !== undefined && tgt.position != null`):

1. **`'apply'` gate:** replace `!affinityDisadvantage` with target-aware check:  
   `getAffinityMatchup(attackerAffinity ?? actor.affinity, enemy.affinity) !== 'disadvantage'`  
   (same rule as Fix A / `landsTimedEnemyApplication` second arg).

2. **`'inflict'` gate:** recompute `liveDebuffLandingChance` with  
   `computeAffinityModifiers(attacker, enemy.affinity).damageModifier`  
   instead of representative `affinityDamageModifier`.

3. **Apply sites:** `resolveEnemyDebuffs`, timed ability loop, `landsTimedEnemyApplicationLive`, scheduled `sourceFired` hook — all consumers of the turn-local closure.

**Pros:** Small diff; one draw per application unchanged; debuffs still apply before modifier fold; DPS byte-identical via gate.  
**Cons:** Footprint victims still never receive debuffs; `'all-enemies'` debuff abilities still anchor-only; recurring inflict still one round draw (pre-existing).

### Strategy B — Defer debuff application to engine positional loop

Move timed enemy debuff infliction out of `runPlayerTurn` into the engine's post-`runPlayerTurn` positional block (alongside `drivePositionalApply`).

**Pros:** Natural per-victim fan-out at apply time.  
**Cons:** Breaks same-turn modifier fold — debuffs would land **after** damage scalars are computed unless the engine re-runs modifier fold or splits the turn. Massive lifecycle surgery. **Rejected** (same class of problem as SP1 Strategy B for crit).

### Strategy C — Positional debuff apply seam (SP2b; mirror damage/crit)

Add `applyPositionalDebuffs` (or extend `drivePositionalApply` with an `onFootprintResolved` hook) that:

1. Resolves footprint victims (reuse `footprintVictims` / `aoeVictimIds` pattern from purge E3).
2. For each victim in scope (`'enemy'` → anchor only; `'all-enemies'` → full footprint when `aoeVictimIds` present):
   - Draw landing **per victim** (`'apply'` → per-victim affinity; `'inflict'` → per-victim `liveDebuffLandingChance` with victim security + per-victim affinity mod).
   - Call `statusEngine.applyTimedAbilityStatus(r, status, actor.id, victim.id)` on success.
   - Emit `debuff-applied` / `debuff-resisted` per victim (combat log fidelity).

**Timing constraint:** Must run **before** `effectiveDamageStatsOf` / modifier fold for same-turn debuffs to affect damage — so either:
- **C1 (recommended):** Keep timed debuff loop in `runPlayerTurn` but fan recipients like purge E3 (`recipients = ab.target === 'all-enemies' && aoeVictimIds ? aoeVictimIds : [targetId]`) with per-recipient landing inside the loop; **or**
- **C2:** Split `runPlayerTurn` into pre-debuff / post-debuff phases with engine injecting footprint between them (heavier).

**Pros:** Complete per-victim semantics; reuses proven E3 purge fan-out pattern.  
**Cons:** Draw-count changes for multi-victim casts (one inflict draw per victim vs one today); golden re-baseline; must define `'all-enemies'` debuff + AoE damage interaction with game data.

---

## Chosen approach — Phased A then C1

### Phase SP2a — Anchor landing correction (Strategy A)

Fix representative scalars at the **existing** turn-local landing closure when positional. Do **not** add footprint fan-out yet.

**Gating:** `args.deferAbilityPerformedToEngine === true` (matches SP1 / engine's `willApplyPositionally` predicate). Non-positional → static scalars, byte-identical.

**Implementation sketch:**
- Replace `landsTimedEnemyApplicationLive` body to compute per-turn anchor matchup inline (or delegate to `runtime.landsTimedEnemyApplication(app, enemy.affinity)` — runtime helper already exists for reactive path).
- Recompute `liveLandingChance` with anchor-derived `damageModifier` when gated.
- Thread the same rule through `resolveEnemyDebuffs` (pass target-aware disadvantage predicate instead of static bool).

**Files (expected):** `playerTurn.ts` primary; possibly extract a tiny `landingAgainstTarget(attacker, target, ...)` helper next to `liveDebuffLandingChance` to avoid duplication with Fix A.

### Phase SP2b — Footprint debuff application (Strategy C1)

Extend the timed enemy debuff loop (and recurring fan-out if `'all-enemies'` aura debuffs exist) to mirror purge E3 recipient selection:

```typescript
const recipients =
    status.targetSide === 'enemy' &&
    timedEnemyAbility.target === 'all-enemies' &&
    aoeVictimIds
        ? aoeVictimIds
        : targetId !== undefined
          ? [targetId]
          : [];
```

For each `vid` in recipients:
- Resolve victim actor from roster (for Block Debuff, security, affinity).
- Landing: `landsOnVictim(application, victim.affinity, victim)` — independent inflict draw per victim per application.
- Apply: `applyTimedAbilityStatus(r, status, actor.id, vid)`.
- Emit per victim.

**Same-turn damage:** Loop stays **before** `effectiveDamageStatsOf` (current sequence preserved).

**Draw policy (confirmed 2026-07-01):** All AoE debuff infliction uses **one hacking roll per footprint victim**. All debuff `'apply'` (affinity) checks use **one affinity evaluation per victim** — no shared cast-level roll. Multi-victim `'all-enemies'` debuff shifts RNG schedule from SP2a — expected, correct (same class as SP1 re-baselines).

**Out of scope for SP2b unless game data requires:** Scheduled/manual debuffs fan-out (global `__enemy__` channel stays representative); reactive path (already Fix A); Stasis break on covered victims (separate PR7 follow-up, already noted in engine).

---

## Scope of golden re-baseline

### SP2a (anchor landing)
- **Byte-identical:** DPS + healing goldens (hard gate); any turn where anchor affinity matchup == representative; inflict debuffs where anchor security == representative security AND affinity mod matches.
- **Re-baseline (expected):** Positional turns where anchor ≠ representative on affinity (`'apply'` flip) or affinity mod (`'inflict'` rate change). Inspect hunks; no blanket `vitest -u`.

### SP2b (footprint apply)
- **Byte-identical:** Single-target (`'enemy'`) debuffs with one recipient — same draw count as SP2a.
- **Re-baseline:** `'all-enemies'` debuff abilities in positional fixtures; any test asserting single `debuff-applied` when footprint expects N.

---

## Testing

### SP2a — unit
- `runPlayerTurn` with `deferAbilityPerformedToEngine: true`, anchor at affinity **disadvantage**, representative **neutral**: `'apply'` debuff **resists** on positional path, **lands** on non-positional path (seeded / deterministic gates).
- `'inflict'` debuff: anchor security + anchor affinity mod produce different `liveLandingChance` than representative; assert land/resist divergence at straddling draw (mirror `anchorCritRealAffinity.test.ts` pattern).
- Reactive regression: Fix A paths unchanged (`triggers.test.ts` Phase 4c block).

### SP2b — integration
- Extend `perVictimDebuffRouting.test.ts` pattern: `'all-enemies'` debuff lands on front **and** covered back victim with **independent** landing outcomes (force one lands, one resists via seeded gates + heterogeneous security/affinity).
- `perVictimDefenseDebuff.test.ts`: optional case where debuff on covered victim affects **that victim's** damage in same turn (requires SP2b).
- Regression: single-anchor `'enemy'` debuff tests unchanged draw count vs SP2a.

### Goldens
- Full `npm test`; DPS + healing snapshots byte-identical after SP2a (hard gate).
- SP2b: inspect positional integration snapshots only.

---

## Documented residuals (unchanged or deferred)

1. **Scheduled/manual debuff channel:** `sourceFired` scheduled timed enemy debuffs use turn-local landing but apply to global/`__enemy__` store for non-positional; positional scheduled debuffs are rare — document, do not fan-out unless a fixture demands it.
2. **`roundDebuffLanded()` memoization:** One inflict draw per round for recurring/aura re-applications shared across all active recurring debuffs — pre-existing; SP2a changes the rate input, not draw count; SP2b per-victim timed applications add draws only for new footprint recipients.
3. **Reactive `'inflict'` landing:** Uses `owner.liveDebuffLandingChance` computed at **owner's last turn start** against **that turn's target** — not recomputed at reactive fire time against counterTarget. Fix A only addressed `'apply'` affinity. Separate micro-spec if needed.
4. **Mid-cast anchor re-resolution:** Debuffs roll/applied at turn start against initial `tgt`; if anchor dies and damage re-resolves a different anchor same cast, debuff landing is not re-evaluated — same class as SP1 per-hit anchor crit residual.

---

## Files touched (forecast)

### SP2a
- `src/utils/combat/playerTurn.ts` — turn-local landing closure + `resolveEnemyDebuffs` affinity predicate.
- `src/utils/combat/__tests__/anchorDebuffLandingRealAffinity.test.ts` (new) — parallel to SP1 unit test.

### SP2b
- `src/utils/combat/playerTurn.ts` — recipient fan-out in timed enemy debuff loop.
- Possibly `src/utils/combat/engine.ts` — ensure `aoeVictimIds` present whenever `deferAbilityPerformedToEngine` (already computed in `buildTurnArgs`).
- `src/utils/combat/__tests__/perVictimDebuffLanding.test.ts` (new) — footprint landing + apply.

**No change expected:** `positionalApply.ts`, `battleSimulator.ts` (beyond comments), `triggers.ts` (Fix A complete for reactive `'apply'`).

---

## Out of scope

- DPS calculator behaviour change.
- Reactive `'inflict'` recompute against `counterTargetId` security at fire time.
- Scheduled debuff global-channel elimination (`__enemy__` sentinel).
- SP3 aggregate `affinityMult` (documented no-op in SP1 spec).
- Covered-victim Stasis break (engine PR7 note — separate).

---

## Confirmed product rules (2026-07-01)

1. **Per-victim inflict draws:** Every AoE / `'all-enemies'` debuff with `application: 'inflict'` (or unmarked) draws the hacking-vs-security gate **once per footprint victim** — same semantics as per-hit crit.
2. **Per-victim affinity checks:** Every `'apply'` debuff evaluates affinity disadvantage **independently per victim** — a disadvantage vs the anchor does not auto-resist the debuff on a covered victim at neutral matchup.
3. **Game data audit (non-blocking):** Run `npm run audit:skills` before SP2b merge to enumerate live `'all-enemies'` debuff abilities; infrastructure ships regardless (integration test covers the seam).

---

## Relationship to handoff epic

| Sub-project | Status | Scope |
|-------------|--------|-------|
| SP1 Anchor crit | Shipped (PR #184) | `cappedCrit` at anchor affinity when positional |
| **SP2 Debuff landing** | **This spec** | SP2a anchor landing + SP2b footprint apply |
| SP3 Aggregate affinity | Audited no-op (SP1 spec) | Leave representative |
| Reactive Fix A | Shipped | `counterTargetId` + `targetAffinity` on reactive `'apply'` |

**Next step after spec approval:** invoke `writing-plans` skill for SP2a implementation plan first; SP2b plan follows SP2a merge.
