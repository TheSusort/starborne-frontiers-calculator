# A-Closeout — Live Debuff-Landing as Sole Producer — Design

**Date:** 2026-06-17
**Epic:** `2026-06-17-combat-realism-epic-roadmap.md` (sub-project A, final closeout)
**Parent sweep:** `2026-06-17-a-sweep-design.md` (A.1/A.2 originally scoped byte-identical; execution
found the static fallback LIVE). Predecessor migration: `2026-06-17-a3-team-walk-migration-design.md`
(SHIPPED — buff-only team actors now walk; legacy non-walked branch deleted).
**Status:** Design — user-approved 2026-06-17 (both sections; decisions: full field removal, one PR).

> Line numbers are 2026-06-17 snapshots. Re-locate by symbol, not offset.

## 1. Problem & goal

The combat engine computes a debuff's landing chance two ways: the LIVE stat-based
`liveDebuffLandingChance(attacker, defender, affinity)` (A2), and a STATIC threaded scalar
`debuffLandingChance` that exists in three forms (focus-attacker top-level input, enemy-attacker
input, walked-team `walk` bundle). Every consumer reads `runtime.liveDebuffLandingChance ?? <scalar>`
behind a `liveLandingComputable` gate in `playerTurn.ts:699-721`. This dual source-of-truth is the
A-sweep's central silent-divergence smell.

**Audit (this design, via code-read):** in PRODUCTION the gate's false-branch is **unreachable** —
`battleSimulator.resolveStats` defaults every actor's `hacking ?? 200` / `security ?? 100`
(`battleSimulator.ts:447-448`), the DPS/healing adapters plumb the same bases (A2), and the A.3
migration gave every team actor a synthesized `hacking 200`. So `liveLandingComputable` is always
true and the live value always wins at every closure (`engine.ts:532/1319/1451`, `playerTurn.ts:709`).
The static scalar is **dead weight in production** — `battleSimulator.ts:656` still computes it via
`landingChance()` but it is never consumed. It survives only as a fallback for **7 non-default test
fixtures** that build base-less actors with an explicit chance.

**Goal:** make `liveDebuffLandingChance` the SOLE producer — remove the `liveLandingComputable`
ternary, delete the static scalar in all three forms (input fields, runtime field, closure
fallbacks, and the dead computations that feed them), convert the 7 non-default fixtures to
stat-based landing, and fold in A.1 (unify the two `triggers.ts` reads). **Production byte-identical**
(removing dead code); the only behavior-touching changes are the 7 fixture input conversions, each
hand-verified to reproduce its exact outcome. Closes sub-project A.

## 2. Decisions (user-approved 2026-06-17)
- **Full removal** of the input FIELDS (not just the fallback reads) — no vestigial dead API.
  tsc-guided; ~40 test files touched (84 trivial `debuffLandingChance: 1` deletions + 7 conversions).
- **One PR**, sequenced commits.

## 3. Sole-producer switch

`playerTurn.ts:699-721`: remove the `liveLandingComputable` ternary. `liveLandingChance` becomes an
unconditional call:
```typescript
const liveLandingChance = liveDebuffLandingChance(
    statusEngine, selfBuffLookup, actor, enemy, affinityDamageModifier
);
```
and `runtime.liveDebuffLandingChance = liveLandingChance;` always (never `undefined`).
`liveDebuffLandingChance` is already self-sufficient (A.2-partial, commit `20dc6ca0`): it defaults a
missing attacker `hacking → 200` and defender `security → 100`, reproducing the old static formula
exactly for base-less/neutral actors. No change to `effectiveStats.ts` needed.

## 4. Delete the static scalar (all three forms) — tsc-guided

Remove:
- **Focus:** `CombatEngineInput.debuffLandingChance` (`engine.ts:817`), its destructure (`:1089`),
  the attacker closure fallback (`:1319`). The dpsSimulator static computation that feeds it
  (`dpsSimulator.ts:243-246`) + the `runCombat` arg (`:278`).
- **Enemy:** `EnemyActorInput.debuffLandingChance` (`:886`), enemy runtime init (`:509`), enemy
  closure (`:532`). The `battleSimulator.landingChance()` computation (`battleSimulator.ts:593-600`)
  + the `:656` threading.
- **Walked team:** `walk.debuffLandingChance` (`engine.ts:770`), walked closure (`:1451`), runtime
  init (`:1467`). The `deriveTeamEngineActors` `teamLandingChance` computation
  (`dpsSimulator.ts:187`) + the field on the A.3 `teamActorWalk.ts` synthesis.
- **Runtime + param:** `runtime.debuffLandingChance` (`PlayerActorRuntime`, and the enemy runtime
  shape) + the `playerTurn` arg (`:156/:630/:709`).
- Any `healingEngineAdapter.ts` threading of the scalar.

**Closure timing watch-point (the one correctness subtlety):** each closure ends
`runtime.liveDebuffLandingChance ?? <scalar>`. Replace with `runtime.liveDebuffLandingChance`, but
retain a final neutral `?? 1` **only where the live field could be read before the owner's first
turn** (avoids NaN). This `?? 1` is a neutral guard, NOT the scalar. The plan verifies each site
(player/enemy/walked/triggers) — `liveDebuffLandingChance` is set at the start of every
`runPlayerTurn`, and DoTs/reactives draw their OWNER's chance (the owner applied them on its own
turn, so its field is set), so in practice the field is set at every read; the `?? 1` is defensive.

## 5. A.1 — unify the `triggers.ts` reads (folded in last)

With the scalar gone, `triggers.ts:932` (DoT path) collapses from
`owner.debuffLandingGate(owner.liveDebuffLandingChance ?? owner.debuffLandingChance)` to a single
accessor reading `owner.liveDebuffLandingChance` (with the `?? 1` neutral guard if §4 keeps one).
The timed path (`:896` `owner.landsTimedEnemyApplication(cfg.application)`) keeps its closure (it
carries the `'apply'`/`'inflict'` distinction). Extract one small accessor used by both — removes the
duplicated direct field read. Byte-identical.

## 6. Test fixture conversion

- **84 × `debuffLandingChance: 1`** — pure line deletions (tsc surfaces each after the field is
  removed). `1` equals the live default (hacking 200 vs security 100 → 1.0), so removing the line
  leaves the base-less actor landing at 1.0 identically. Byte-identical. Many live in per-file
  `baseInput` helpers, so one edit covers many tests.
- **7 × non-default** (6×`0`, 1×`0.5`) — convert to stat-based landing reproducing the exact chance,
  each with its assertion (lands/resists/dot/event counts) confirmed unchanged:
  - `0` → live landing 0: actor `stats.hacking` low / target `security` high so
    `clamp(hacking − security, 0, 100)/100 = 0` (e.g. hacking 0, or hacking 100 vs security 200).
    Sites: `enemyDebuffLandingChance`, `enemyBuffSelfDebuffGate`, `resistedEnemyDebuffsRoundEffects`,
    `resistedEnemyDotsRoundEffects`, and the focus fixtures in `dpsSimulator`/`triggers`.
  - `0.5` → hacking 150 vs security 100 → 0.5.
  The plan enumerates all 7 with file:line + exact stat substitution. **If more than 7 non-default
  fixtures surface during execution, STOP and surface the fuller list before converting.**

## 7. Sequencing, gate, testing

- **Sequenced commits (one PR):** (1) collapse ternary + retire closure fallbacks + convert the 7
  (production parity) → (2) delete input fields + dead computations + the 84 `:1` lines (tsc-guided)
  → (3) A.1 triggers unify → (4) battleSimulator/adapter computation cleanup. (Steps may merge where
  natural; tsc gates completeness.)
- **Gate:** byte-identical for ALL production/golden snapshots — `battleSimulator`, `twoTeamBattle`,
  `dpsGoldenParity`, healing goldens must NOT move. Only the 7 fixtures' INPUTS change (same
  assertions); the 84 deletions are inert. `npx vitest run`, `npx tsc --noEmit`, `npm run lint` 0,
  `npm run audit:skills` 0/141. **Never blind `vitest -u`.**
- **Risk:** low. Production is dead-code removal. The only behavior surface is the 7 conversions; the
  enumeration is the watch-point. Closure-timing `?? 1` guard is the one correctness subtlety
  (§4) — verify no read-before-set NaN.

## 8. Done criteria (closes sub-project A)
- `liveDebuffLandingChance` is the sole landing producer; the `liveLandingComputable` ternary is gone.
- The static `debuffLandingChance` is deleted in all three forms (fields, runtime, fallbacks) plus the
  dead computations in dpsSimulator/deriveTeamEngineActors/battleSimulator/healing adapter.
- `triggers.ts` reads the live chance through one accessor (A.1).
- Production byte-identical; only the 7 non-default fixtures converted (assertions unchanged); the 84
  `: 1` lines removed inertly.
- Suite + lint + tsc + audit:skills clean. **Sub-project A CLOSED.** Next: sub-project B (Stasis).

## 9. References
- `src/utils/combat/playerTurn.ts:699-721` (ternary), `:156/:630/:709` (param).
- `src/utils/combat/engine.ts:817/1089/1319` (focus), `:886/509/532` (enemy), `:770/1451/1467` (walked).
- `src/utils/combat/effectiveStats.ts` `liveDebuffLandingChance` (sole producer; already self-sufficient).
- `src/utils/combat/triggers.ts:896/932` (A.1).
- `src/utils/calculators/dpsSimulator.ts:187` (teamLandingChance), `:243-246` (static formula).
- `src/utils/calculators/battleSimulator.ts:593-600` (landingChance), `:656` (threading).
- `src/utils/combat/teamActorWalk.ts` (A.3 synthesis — drop the debuffLandingChance field).
- 7 non-default fixtures: `enemyDebuffLandingChance`, `enemyBuffSelfDebuffGate`,
  `resistedEnemyDebuffsRoundEffects`, `resistedEnemyDotsRoundEffects`, `dpsSimulator`, `triggers`.
