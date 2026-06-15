# Positional Combat Phase 4 — Multi-target AoE + Per-target Accounting + Death-fallback

**Date:** 2026-06-15
**Status:** Design (pre-implementation)
**Phase:** Positional combat phase 4 of 5 (1=geometry resolver #106, 2=engine positional target-selection #108, 3=forced targeting + stealth #109, Provoke #112; **4=this**; 5=simulator page).
**Predecessors merged:** PR #106 (board geometry `resolveCells`), #108 (positional target-selection + single-anchor binding), #109 (forced targeting/stealth), #112 (Provoke).

---

## 1. Problem & goal

Phases 1–3 + Provoke built the positional *target-selection* machinery: a board, a geometry resolver (`resolveCells`), `selectTargets` (row-first column-priority), and `resolvePositionalTarget` (forced targeting + stealth resolving a single anchor). But three things are still missing or dormant, all deferred from Phase 2 with inline notes:

1. **Multi-target AoE consequences.** `resolveCells` is built but **UNWIRED**. A positional attack today binds to and damages a **single** anchor; covered cells of an AoE pattern take nothing.
2. **Per-target accounting.** Because only one victim is ever damaged per turn, three accounting paths still hard-credit the bound heal target rather than the actual victim: `takenLeeches`, `enemyHpDecline`, `targetHpPct`.
3. **Death-fallback / dead-recipient filtering.** Ships can't currently die mid-combat in the positional overlay, so: the Harvester `on-ally-destroyed` extra-action trigger is wired-but-dormant (Phase 4b), and Salvation's `all-allies` on-destroyed heal counts the dead caster in gross `directHeal`.

**Goal:** make AoE patterns land on anchor + covered cells with correct per-victim consequences, make the three accounting paths per-victim-correct, and handle deaths (intra-cast and inter-turn retargeting, Harvester activation, Salvation dead-recipient filtering) — all as a **capability-only overlay** that leaves DPS/healing behavior (and goldens) byte-identical.

**Key structural finding (verified in code 2026-06-15, drives PR 1):** `applyIncomingToTarget` (engine.ts:1919, sole `currentHp` decrement at :1963) applies per-victim damage on the **enemy→player** direction ONLY (enemy attacks the tank/player victim; DoT ticks). The **player→enemy** direction (focus + team sites) never calls it — a selected enemy's HP is modeled via the cumulative-damage **sink** (`enemyHpDecline`, engine.ts:3218), forced to `0` for a positionally-selected enemy (`selectedEnemy ? 0 : …`). **Consequence: today player attacks do not decrement a real enemy actor's HP — enemies cannot die from player attacks even in positional mode.** This is the "dummy-enemy-vs-real-actor duality" the team-agnostic principle flagged. Therefore "multi-target AoE *consequences*" requires PR 1 to **build a symmetric per-victim apply path for the player→enemy direction** (enemies take per-target/AoE damage, HP declines, can die), not merely wire `resolveCells`. User-ratified 2026-06-15: build the symmetric enemy-victim apply in PR 1; defer only the unified *result surface* to Phase 5.

**Non-goals (explicitly deferred):**
- **Full side-symmetric per-actor-per-side result surface → Phase 5.** Phase 4 does only the *incremental* per-target accounting needed for AoE/leech/death correctness. The mirror is not unified here.
- **Global per-hit refactor of the non-positional outgoing damage path → its own later phase.** The outgoing aggregate event stays. Per-hit application happens *only* on the new positional path (see §4).
- **Simulator page / any production caller that passes positions → Phase 5.**

---

## 2. Scope decisions (user-ratified during brainstorming, 2026-06-15)

- **Phase 4 = all three sub-capabilities, sliced into 2 PRs** (AoE+accounting, then death-fallback).
- **Accounting depth = incremental.** Only the per-victim correctness AoE/leech/death require; the full symmetric result surface + team-vs-team display is Phase 5.
- **Mid-cast death = re-resolve per hit, *on the positional path only*.** A multi-hit/AoE cast re-runs target selection per hit, so later hits redirect off a target that died to an earlier hit. The non-positional aggregate path is NOT converted to per-hit (that global refactor is a separate later phase).
- **Result surface = additive.** New per-victim accounting is exposed as new fields alongside today's player-centric `RoundData`; no restructure. Goldens churn at most additively (and only if a positional test snapshot is added — production goldens stay byte-identical).

---

## 3. Confirmed game model (from prior phases — do NOT re-litigate)

- Board: pointy-top hexes, 3 rows T/M/B × 4 cols; col 4 = front (nearest enemy), col 1 = back; enemy board is a display-only horizontal mirror (resolver is frame-agnostic). Axial coords + 6 directions are fixed in `board.ts`.
- **Covered-cell damage = 50% of origin damage; covered scaling is DAMAGE-ONLY** — heals/buffs/debuffs apply uniformly across the footprint (no 50%). Origin = 100%.
- Anchor selection (front/back/skip → which enemy cell) is Phase 2's job and already shipped; Phase 4 consumes the resolved anchor and expands it via `resolveCells`.
- `resolveCells` clips out-of-board offsets silently and may return origin-only or (for `not-self` patterns) zero cells — **not an error.** `not-self` results carry no `origin` role (key off `role`, not position). The `all` shape returns all 12 cells as `origin`, ignoring the anchor.
- Forced targeting precedence (already shipped): Concentrate Fire → Taunt → Provoke → stealth-filter, resolved inside `resolvePositionalTarget`.

---

## 4. Architecture — the isolation principle (the spine)

Phase 4 adds a **positional damage-application path** activated only when the acting actor has a `position` and the run supplies board positions.

- **Non-positional runs** (every DPS/healing run today; every golden): Phase 2's single-anchor binding + the existing **aggregate** outgoing damage assembly (playerTurn.ts ~1167–1295: `effectiveMultiplier = rawMultiplier * hits`, blended per-hit crit multiplier, **one** `ability-performed` event). **Untouched → byte-identical.** This is the load-bearing safety invariant.
- **Positional runs** (Phase 5+): a new parallel apply routine does the per-hit loop, `resolveCells` expansion, and per-victim apply. The existing aggregate routine is *not* refactored.

**Why per-hit lives only on the positional path:** today the enemy-attack path already emits `attacked` per hit (since 4c PR 1), and crit-scoped reactives (`on-crit`, `on-ally-crit`) already fire per *critting* hit via the `critHits` field — so Sentinel's follow-up tap and Cultivator's per-hit ally-damage repair are already per-hit-correct. The only genuinely-aggregate path is the **player's own outgoing damage event**, and converting *that* globally is a large refactor (split damage assembly; migrate every crit-scoped trigger from "read `critHits`" to "fire per event"; intentionally re-baseline goldens). That is deferred. Phase 4's positional apply path gets per-hit re-resolution for free because it is new code with no golden contract.

---

## 5. PR 1 — Positional multi-target AoE + per-hit re-resolution + per-target accounting

### 5.1 New positional apply routine

**Two pieces:** (a) a **generalized per-victim apply** so the player→enemy direction can decrement a real enemy actor's HP (today only enemy→player can), and (b) a **positional multi-target routine** that expands the anchor into a footprint and applies per-hit per-victim.

**(a) Generalized per-victim apply (the structural core).** `applyIncomingToTarget` is closured over `healTarget` and player-side accumulators (`roundIncomingDamage`, player Barrier/Cheat-Death), so it cannot be reused as-is for enemy victims. Extract its victim-intake core — shield drain → Barrier full-immunity guard → Cheat-Death intercept → `currentHp` decrement → `hp-changed`/`ship-destroyed` emission (engine.ts:1928-2032) — into a reusable function parameterized by the victim and side-specific accounting hooks. The existing enemy→player call becomes a thin wrapper over it (**must stay byte-identical** — guarded by goldens + characterization tests). A new player→enemy wrapper credits the enemy victim. This is what lets a player AoE actually damage and kill enemy actors. Enemy-side Barrier/Cheat-Death (from the enemy-team-support PRs) resolve through the same shared core.

**(b) Positional multi-target routine** (proposed `src/utils/combat/positionalApply.ts`) consumed at the **3 `runPlayerTurn` damage sites** wired in Phase 2 (focus / team / enemy). When the acting actor is positional (`isPositional` + positions supplied) **and** the firing skill carries a damage ability, the engine calls this routine *instead of* the single-anchor binding; otherwise it falls through to today's path.

For each **hit** `h` in `damageInputsFromSkill(gatedSkill).hits`:

1. **Re-resolve the anchor** for this hit via the existing `resolvePositionalTarget(...)` (forced targeting → stealth → `selectTargets` row-first column-priority over the *currently living* opposing roster). A target that died to hit `h-1` is gone from the roster, so hit `h` redirects. If no living target → this hit whiffs entirely: **no damage, and no event emitted** (per spec-review clarification).
2. **Expand** `resolveCells(pattern, anchor)` → `{position, role}[]`. (`pattern` = the ability's `ParsedPattern`; single-target abilities resolve to origin-only.)
3. **Per cell**, find the living occupant on the target side (`byCell`, ≤1 actor/cell, already living-only per Phase 3). For each occupant `victim`:
   - Compute this hit's damage using the already-drawn per-hit crit outcome `hitCrits[h]` (full crit multiplier if that hit crit, else none) through the shared crit-independent pipeline (defense/affinity/outgoing/incoming) — same factors as today's assembly, applied per hit at full precision (no per-hit rounding) so a single-target multi-hit's *total* equals the aggregate.
   - Scale by **role**: origin → ×1.0; covered → ×0.5 (damage only).
   - Apply via the **generalized per-victim apply** from (a) — player→enemy wrapper for focus/team sites, enemy→player wrapper for the enemy site. Each victim runs its own shield → Barrier → Cheat-Death → HP independently.
   - Emit a per-hit `ability-performed` (and, where the established convention emits it, the per-hit `attacked`) targeting `victim`, so per-hit reactives on victims fire correctly.

> **Per-hit-event note for the implementer:** the *outgoing* path that today emits one aggregate `ability-performed` is the non-positional path and stays. The positional routine emits per-hit, per-victim events. Confirm during planning that crit-scoped triggers consuming these positional events do not double-count (positional events carry per-hit `didCrit`, not an aggregate `critHits`).

### 5.2 Per-target accounting (incremental)

With multiple victims per turn, three Phase-2-deferred paths become per-victim *correctness* (keyed off the actual victim, not the bound heal target). Phase 2 left inline notes at each:

- **`takenLeeches`** — a `basis:'damage-taken'` leech must read the damage the **hit victim** took, and credit that victim's owner, not the heal target.
- **`enemyHpDecline`** — for a positionally-selected enemy, HP now declines via the §5.1(a) per-victim apply (real decrement), *replacing* the Phase-2 `selectedEnemy ? 0 : cumulative-sink` placeholder at the focus/team sites. The enemy-turn site already derives decline from the real victim's HP (engine.ts:2858, "do NOT convert to a `selected ? 0 :` ternary") — keep that.
- **`targetHpPct`** — report the **real victim's** HP%, not the heal target's.

**Exposure is additive:** introduce a per-victim accounting map (proposed `RoundData.perTargetDamage` or similar, keyed by victim actor id) **alongside** existing player-centric fields. No restructure of existing `RoundData` fields, no adapter rewrite. This is the minimal seam; the full symmetric surface is Phase 5.

### 5.3 Inertness / golden guarantee

The new routine runs only when positions are supplied. No production caller does → DPS and healing runs take the unchanged aggregate path → **DPS + healing goldens byte-identical.** New behavior is covered exclusively by new positional tests using hand-built positioned fixtures.

### 5.4 PR 1 tests

- Per-hit re-resolution: a 3-hit single-target skill where the anchor dies to hit 1 → hits 2–3 redirect to the next living target.
- AoE footprint: origin victim takes full, covered victims take 50%; a covered cell with no living occupant contributes nothing.
- Per-victim independence: two victims, one with Barrier (full block) and one without; one with Cheat-Death — each resolves its own path.
- Per-victim accounting: `takenLeeches` credit the actually-hit victim; `enemyHpDecline`/`targetHpPct` reflect the real victim.
- **Inertness:** an existing-shaped non-positional run is byte-identical (guarded by the unchanged goldens).

---

## 6. PR 2 — Death-fallback retargeting + dead-recipient filtering

Now that AoE/focus-fire can kill ships, deaths happen mid-combat on both sides.

- **Inter-turn retargeting.** `selectTargets` already filters living, so the *next* attacker naturally re-selects a living target. PR 2 verifies dead actors are excluded from rosters between turns, and that an ability whose entire target side is dead whiffs cleanly. (Intra-cast retargeting is PR 1's per-hit re-resolution.)
- **Harvester `on-ally-destroyed`.** The extra-action trigger wired in Phase 4b is dormant only because no ally could die. With positional AoE/focus-fire it becomes reachable — no new machinery, just exercised and tested (extra turn granted on a real ally death).
- **Salvation dead-recipient filtering.** Salvation's `all-allies` on-destroyed heal resolves recipients including the dead caster, inflating gross `directHeal` (Phase 4b KNOWN LIMITATION). Filter dead recipients out of the gross accounting so the heal credits only living recipients. (`effectiveHeal`/`overheal` already credit only the live target — this aligns gross with them.)

### 6.1 PR 2 tests
- Focus-fire kills target A → the later attacker this round retargets to target B.
- All-targets-dead → ability whiffs, no crash, no spurious credit.
- Harvester extra-action fires on a real ally death (positioned fixture where an enemy AoE kills an ally).
- Salvation gross `directHeal` excludes the dead caster.
- **Inertness:** goldens byte-identical.

---

## 7. Components & boundaries

| Unit | Responsibility | Depends on |
|---|---|---|
| `resolveCells` (existing, UNWIRED) | anchor + pattern → `{position, role}[]` | `board.ts`, `patternOffsets.ts` |
| `selectTargets` / `resolvePositionalTarget` (existing) | living-roster, forced-targeting, stealth, anchor selection | `board.ts`, status query helpers |
| **`positionalApply.ts` (new, PR 1)** | per-hit loop: re-resolve anchor, expand cells, per-victim damage + accounting | the two above + `applyIncomingToTarget` |
| **Generalized per-victim apply (new, PR 1)** | shield/Barrier/Cheat-Death/HP intake for ANY victim; player→enemy + enemy→player wrappers | status engine |
| `applyIncomingToTarget` (existing) | becomes a thin enemy→player wrapper over the generalized core (byte-identical) | generalized apply |
| Per-victim accounting map (new field, PR 1) | additive per-target damage/HP/leech/targetHpPct | — |
| Death triggers (existing, PR 2 activates) | Harvester `on-ally-destroyed`; Salvation dead-recipient filter | `triggers.ts`, engine death path |

Each unit is independently testable; the positional routine is the only new file and is dormant without positions.

---

## 8. Risks & mitigations

- **Golden leakage** (the positional path firing in a non-positional run): mitigated by the byte-identical golden gate on both PRs — any drift means the `isPositional` gate leaked; fix the gate, never `vitest -u`.
- **Extraction risk** (§5.1a): refactoring `applyIncomingToTarget`'s intake core touches the engine's most fragile, most-tested path. Mitigate by extracting first as a pure behavior-preserving refactor (the enemy→player wrapper produces identical results) gated by the full golden suite + targeted characterization tests, *before* adding the player→enemy wrapper or any positional caller.
- **Per-hit numeric drift** vs the aggregate (single-target multi-hit): apply per-hit at full precision and sum without per-hit rounding so totals match the aggregate; covered by a per-hit-vs-aggregate equality test on the positional path.
- **Per-hit event double-counting** in crit-scoped triggers: planning task must characterize how positional per-hit `ability-performed`/`attacked` events interact with `on-crit`/`on-ally-crit` (which today read aggregate `critHits`).
- **`runCombat`/`runPlayerTurn` size** (~2,650 / ~980 lines): keep the per-hit loop in the new `positionalApply.ts` module rather than inlining, per the structural-debt note.

---

## 9. Testing strategy

- **Byte-identical DPS + healing goldens** is the acceptance gate for both PRs (synthetic fixtures, never `-u`). New positional scenarios are appended/hand-written, never regenerated.
- Co-located unit tests in `src/utils/combat/` and `src/utils/targeting/` (no `__tests__/` subdir in `targeting/`, matching the existing convention).
- `audit:skills` stays 0 findings / 141 ships; lint + tsc clean.
- Worktree env gotcha: a fresh worktree lacks gitignored `.env` + `docs/*.csv` → symlink them from the main checkout or env-only tests fail and the pre-commit hook blocks.

---

## 10. PR sequence summary

1. **PR 1 — Symmetric per-victim apply + positional multi-target AoE + per-hit re-resolution + per-target accounting.** Extract the generalized per-victim apply (enemy→player wrapper byte-identical) + add the player→enemy wrapper so enemies take real per-target damage and can die; wire `resolveCells`; new `positionalApply.ts` per-hit loop; per-victim leech/HP-decline/targetHpPct; additive per-target accounting field. Capability-only.
2. **PR 2 — Death-fallback + dead-recipient filtering.** Inter-turn retargeting verification; Harvester `on-ally-destroyed` activation; Salvation dead-recipient filter. Capability-only.

Both preserve byte-identical goldens. Phase 5 (simulator page) is the first production caller that supplies positions and is where the full side-symmetric per-actor-per-side result surface lands.
