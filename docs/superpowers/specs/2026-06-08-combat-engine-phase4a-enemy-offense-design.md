# Combat Engine Phase 4a — Enemy as a Full Offensive Actor — Design

**Date:** 2026-06-08
**Status:** Approved (user-validated section by section)
**Baseline:** PR #89 (damage-leech) + PR #91 (healing backlog) MERGED (merge `c6b90e26`).
**Branch target:** `feat/combat-engine-phase4a-enemy-offense`
**Handoff:** `docs/superpowers/handoffs/2026-06-08-phase4-enemy-offense-handoff.md` (Phase 4
decomposition map — this is sub-increment **4a**, the keystone).

## Goal

Generalize the enemy from a damage-only "basics walk" into a **full combat actor** that walks
its entire parsed kit (damage + debuffs + DoTs + self-buffs) against a single fixed target,
on the **same `runPlayerTurn` pipeline** the attacker and team ships use. This makes
`selfHpPct` live for a bombarded target and unlocks the `on-attacked` trigger plus the 24
manual `enemy-buff` / `self-debuff` conditions — the foundation every later Phase-4
sub-increment depends on.

The work is engine + the Healing Calculator as its proving ground. It is additive to the
public result types, zero-RNG deterministic, and leaves the **22 DPS golden snapshots
byte-identical**. The 13 healing goldens stay byte-identical where the existing enemy
fixtures are damage-only + neutral-affinity; genuinely new behaviour gets new scenarios.

## Game model the user is encoding (canonical for this increment)

The user described the real game and which parts we model now vs. defer:

- The board is **3 rows × 4 hexes per side**; each skill has a targeting rule (front/back/skip)
  against the opposing row, plus a hit **pattern** (single-target, or AoE variations: main
  target 100%, splash 50%). Positioning is a major factor in real fights.
- **DEFERRED (no game data yet):** positional rows, front/back/skip targeting, and AoE
  patterns. We do **single-target focus-fire** only.
- **This increment's targeting model:**
  - **Enemy → player:** focuses the **heal target / tank** (single fixed target).
  - **Player → enemy:** unchanged — the singular target-wall enemy.
  - **DPS calc:** the enemy stays a **no-attack dummy** (no enemy offense in DPS).
- **DEFERRED to the simulator (increment 5) / targeting slice (4d):** death-fallback
  re-targeting (tank dies → enemy advances to the next team ship in input order; players
  focus-fire enemy 1 until dead, then enemy 2), and multi-enemy.

## User decisions (2026-06-08, do not re-litigate)

1. **Scope = single-target, full enemy kit.** The enemy walks its whole parsed kit (damage,
   debuffs, DoTs, self-buffs) against one fixed target. NOT whole-team damage intake — the
   handoff's "enemy hits everyone" framing is explicitly rejected as unlike the game.
2. **Architecture = Approach A (unify).** The enemy runs the same `runPlayerTurn` pipeline as
   players; the damage-only `runEnemyAttackerTurn` / `enemyTurn.ts` is retired.
3. **Fidelity = (ii) full affinity symmetry.** The enemy attacks with an **affinity matchup**
   vs the target (its `enemyAffinity` vs the target's affinity), resolved in the adapter like
   team actors and passed in pre-resolved; the pipeline already consumes per-actor affinity.
4. **Vehicle = the Healing Calculator** + engine foundation. The defense-calc UI stays **4f**,
   the simulator page stays **5**.
5. **Include the enemy-effects round overview** in this increment (per-round display of the
   enemy's self-buffs and the debuffs/DoTs it applied to the target).

## Scope

| In scope | Out of scope (later increment) |
|---|---|
| Enemy runs `runPlayerTurn` (retire `runEnemyAttackerTurn`) | Death/revive modeling, `on-destroyed`/`on-ally-destroyed` (4b) |
| Side-relative target binding (player→enemy, enemy→tank) | Generic `on-self/ally-damaged`, Zosimos/Arum/Yarrow reactions, Isha onCritHit (4c) |
| Per-target debuff store + enemy-owner buff store | Positional rows, front/back/skip targeting, AoE patterns, multi-enemy, death-fallback (4d / 5) |
| Real `selfHpPct` for a bombarded target | Cleanse/purge debuff consumption, control-effect sim, damage reduction/reflect (4e) |
| `enemyBuffNames` + `selfDebuffNames` in condition contexts | Defense calculator UI (4f) |
| Full affinity symmetry on enemy attacks (ii) | Simulator page (5) |
| `attacked` bus event + `on-attacked` LIVE trigger (fires already-annotated abilities) | |
| Enemy-effects round overview in the Healing Calc | |
| Affinity selector on enemy attackers in `EnemyAttackersPanel` | |

`enemyDestroyedCount` stays **0** (death = 4b); adjacency stays **0** (positional, deferred).

## Design

### 1. Two enemy concepts today (structural orientation)

There are two disjoint enemy concepts in the engine:

- The **singular target-wall enemy** — what player offense hits: DoT/bomb containers, the
  defence wall, the `enemyHp` pool feeding `enemyHpPct`. **Untouched by this increment** →
  DPS stays byte-identical.
- The healing-mode **`enemyAttackers[]`** — offense-only actors (`defence/hp = 0`) that bombard
  the heal target via `runEnemyAttackerTurn`. **These graduate to full-kit `runPlayerTurn`
  actors.**

Merging the two (an enemy that is both a target players hit *and* an attacker) is a simulator
concern (increment 5), not this one.

### 2. Side-relative target binding (the central refactor)

`runPlayerTurn` today implicitly writes offensive output to "the enemy": it reads
`enemyDefense`, accumulates `cumulativeDamage`, appends DoTs/bombs to the enemy's containers,
and reads `enemyHpPct`. Extract that into an explicit **target binding** carried on the actor's
runtime (or passed alongside it):

- the **defence** to compute damage against,
- the **HP / shield pool** the damage drains,
- the **DoT / bomb containers** debuffs/DoTs append to,
- the **target's condition-state** (its debuff names, HP%) where the pipeline needs it.

For **player actors** the binding = the singular enemy → behaviour and numbers are **identical**
(zero churn). For an **enemy actor** the binding = the **heal target / tank** (a player actor).
`CombatActor` already gives every actor its own `corrosionEntries`/`infernoEntries`/
`pendingBombs`/`shieldPool`/`currentHp`, and DoTs already tick at the afflicted ship's
turn-start, so the container plumbing exists — we route to the bound target instead of "the
enemy".

**Bookkeeping divergence for enemy actors:**
- Damage credits **incoming damage to the tank** — reusing the existing healing-mode
  shield-first drain, `ship-destroyed`, and the per-attack `damage-taken` leech proc — NOT the
  player damage rows / `ActorDamage` direct buckets.
- Debuffs/DoTs land on the **tank's** containers / per-target debuff store.
- Self-buffs land in the **enemy's own** owner buff store.
- Player-side machinery (accumulators, leech-to-enemy, `teamDamage`) is unaffected.

### 3. Enemy as a `runPlayerTurn` actor (setup)

Enemy attackers today use **raw `shipSkills` with no reactive partitioning** (`engine.ts:853`).
Running `runPlayerTurn` requires building the enemy a proper `PlayerActorRuntime`:

- **partitioned cast/reactive abilities** (reuse the same `deriveTeamEngineActors` /
  runtime-builder path team actors use — **no enemy-specific parser**; the enemy is just another
  ship through `buildShipAbilities`),
- per-actor **rate gates** (it already gets its own `makeRateGate()` pair — extend to whatever
  streams `runPlayerTurn` needs),
- a status **owner-id** (the enemy's id) for its per-owner buff store,
- pre-resolved **affinity modifiers** (§5).

The manual flat-card enemy attacker (no `shipSkills`) keeps a one-basic-attack-per-turn
fallback, now expressed through the unified pipeline's damage path.

### 4. StatusEngine generalization — per-owner buffs AND debuffs

Today: per-owner buff stores keyed by player `ownerId` + a **single** enemy-debuff store.
Generalize so **both buffs and debuffs are per-owner maps, keyed by the actor the status sits
ON**:

- **Enemy self-buffs** → a per-owner buff store keyed by the enemy actor's id (symmetric with
  players — an enemy owner-id is now valid; no new store *type*).
- **Debuffs on the tank** → the single enemy-debuff store becomes a **per-target debuff store
  keyed by the debuffed actor's id**. The singular target-wall enemy's debuffs stay keyed by
  `enemy.id` → **byte-identical to today**; the tank's debuffs are simply a second key.

This touches the timed/aura/accum/persistent debuff maps and their decrement/snapshot paths;
the `enemy.id`-keyed path must reproduce current behaviour exactly.

### 5. Affinity (ii) — pre-resolved in the adapter

Affinity modifiers are **not** computed inside `runPlayerTurn`; they are pre-resolved per-actor
in the adapter via `computeAffinityModifiers(...)` → `affinityDamageModifier` /
`affinityCritCap` / `affinityCritPenalty` / `affinityDisadvantage`, then consumed by the
pipeline. Team actors already do this — the pattern to mirror is
`src/utils/calculators/dpsSimulator.ts:175` (team-actor matchup), and the pipeline consuming
the pre-resolved fields is confirmed at `engine.ts:699-733`.

**The code that changes is in `src/utils/calculators/healingEngineAdapter.ts`** — the adapter
that builds enemy-attacker inputs for the Healing Calculator (decision #4). DPS mode has no
enemy attackers, so `dpsSimulator.ts` is the *pattern*, not the edit site. Today the healing
adapter **hardcodes neutral affinity** for enemy attackers (`affinityDamageModifier: 0`,
`affinityCritCap: 100`, `affinityCritPenalty: 0` — ~`healingEngineAdapter.ts:166-168`) and
derives the team walk with `deriveTeamEngineActors(..., undefined)` ("affinity IGNORED this
increment" — ~`:146`). Both of those are what change: resolve the enemy's matchup
(`enemyAffinity` vs the **target's** affinity) with `computeAffinityModifiers` and pass the four
fields into the enemy's runtime. No pipeline change — only the adapter resolution, plus an
affinity field on the enemy-attacker input.

### 6. Condition-context population (the payoff)

`buildActorConditionContext` / `buildRoundContext` gain three live inputs; the remaining
DPS-assumption defaults are unchanged:

- **`selfHpPct`** — per-actor live HP (`currentHp / maxHp × 100`). A bombarded target declines;
  untargeted ships and the DPS attacker stay 100. Retro-activates parsed-but-dropped gates:
  Makoli / Guardian below-40%, Tormenter HP<50, self-execute.
- **`enemyBuffNames`** — the opposing side's buffs. For a **player** actor's context this = the
  **enemy actor's self-buffs** → lights up the 24 `enemy-buff` / `self-debuff` conditions
  (forced to `[]` today).
- **`selfDebuffNames`** — the actor's own debuffs (the tank now carries enemy-applied debuffs).

**Payload-carrying status visibility (known wiring point, not a new concept):** the enemy's
self-buffs are ability-sourced → they carry a `payload` → `snapshot()` **excludes** them (the
`!s.payload` guards at `statusEngine.ts:593,601,617` for accum/persistent, and the timed-map
guards at `:642,654` — the implementer must respect **all** of these for both `enemyBuffNames`
and `selfDebuffNames`; exclusion exists to avoid double-folding their effects, which are folded
via `activeAbilityStatuses`/`timedAbilityStatuses`). To expose
them as `enemyBuffNames`, extend the existing `includeAbility…Names`-style inclusion path
(today `includeAbilitySelfNames` pulls `timedAbilityStatuses('self', ownerId)`) to the enemy
owner — being careful to pull only the **names** for condition gating, never re-folding the
effects. The same care applies to `selfDebuffNames` for the tank.

### 7. `on-attacked` goes live

Add an **additive bus event** at the existing per-attack enemy-attack intake seam:

```ts
{ type: 'attacked'; targetId: string; attackerId: string; round: number; didCrit?: boolean }
```

(`didCrit` present-only-when-true.) Add `on-attacked` to `LIVE_TRIGGERS`; register a **pure**
(enqueue-only) listener on the **target** so abilities already annotated `on-attacked` fire via
the existing intent/executor machinery. **No new executor branch** beyond what existing
follow-up types need.

Out of scope here (4c): the *generic* `on-self-damaged` / `on-ally-damaged` triggers and the
specific enemy-action reactions (Zosimos / Arum / Yarrow / Larkspur / Grif) and Isha onCritHit.
4a only makes `on-attacked` derivable and fires already-annotated abilities.

### 8. UI (Healing Calculator)

- **`EnemyAttackersPanel`** gains an **affinity selector** per attacker (drives §5).
- **Enemy-effects round overview** (user-requested in scope): per round, surface the enemy's
  active **self-buffs** and the **debuffs/DoTs it applied to the target**, reusing the existing
  round-overview / status-display primitives (the DPS/healing pages already render per-round
  buff/debuff/accumulator state). Use existing `src/components/ui/` primitives; no raw HTML
  form controls.
- The enemy's damage/DoT effects otherwise surface implicitly through the existing survival +
  timeline/cumulative charts.

## DPS-inert guarantee (load-bearing invariant)

DPS runs have no `healTargetId` and no enemy attackers; the singular target-wall enemy is
untouched; `selfHpPct` stays 100 and the new condition-context fields stay empty when enemy
offense is inactive. **All 22 DPS goldens stay byte-identical** — the same discipline that kept
DPS inert through the healing-calc and damage-leech increments. The engine core never compares
the literal `'attacker'`; everything keys on `focusActorId` / owner ids.

## Testing & goldens

- **22 DPS goldens** — byte-identical, the referee. Zero churn.
- **13 healing goldens** — kept byte-identical by giving the existing enemy fixtures **neutral
  affinity** and no non-damage abilities, **provided** the `runPlayerTurn` unification
  reproduces the damage-only / bare-stat / neutral-affinity path exactly. **This is the single
  biggest golden risk** — the unify is treated as a behaviour-preserving refactor first; prove
  byte-identical, and document any genuine divergence as a hand-verified KNOWN-DIFF. Never
  `vitest -u` — delete + targeted regenerate.
- **New healing goldens** for the new behaviour: enemy applies a debuff + DoT + self-buff;
  affinity-modified enemy damage; `selfHpPct` gate activation (e.g. Makoli/Guardian as the heal
  target dipping below 40%); an `enemy-buff` condition firing; `on-attacked` firing. Hand-built
  `ab()` fixtures (parity suites do not use `buildShipAbilities`); hand-verified, reviewer
  re-derived.
- **Unit tests** on the new seams: target binding (player→enemy unchanged, enemy→tank routed),
  per-target debuff store (enemy.id path byte-identical; tank key isolated), the three
  condition-context fields, the `attacked` event + listener (pure, fires annotated abilities).
- **Live verification** on the fleet (port 3000; snapshot token limits → `evaluate_script`,
  not full a11y snapshots): configure an enemy that debuffs, pick a below-40%-gated heal target,
  confirm the gate switches on, the tank accrues enemy debuffs, and the round overview shows the
  enemy's self-buffs + the tank's debuffs.

## Hard constraints (carried forward, every task)

- Public DPS/healing result types stay **additive**; goldens are the referee.
- **Zero-RNG determinism**: `makeRateGate` per actor/stream (the enemy keeps its own per-stream
  gates). Listeners **pure** (enqueue only); engine/executor **sole mutator**.
- Engine core NEVER compares the literal `'attacker'` — key on `focusActorId` / owner ids.
- New event fields **additive and present-only-when-true**.
- **No RegExp lookbehind in `src/`** (iOS Safari 15); `scripts/auditSkills.ts` is Node-only.
- Pre-commit runs the full suite; **no `--no-verify`** for code commits; ESLint **zero warnings**.
- `docs/` is gitignored → `git add -f` for specs/plans/handoffs/coverage.
- Changelog: fold into the **evolving** DPS/healing `UNRELEASED_CHANGES` entries; don't append
  many new array elements (watch implementer subagents).
- UI: use existing `src/components/ui/` primitives; no raw HTML form controls.

## Coverage-doc updates (on the branch)

- §6 Phase-4 pointer: mark 4a (enemy as full offensive actor, `selfHpPct`, `on-attacked`,
  enemy-buff conditions) shipped; leave 4b–4f / 5 pending.
- §5: document the single-target focus-fire model, the per-target status keying, the affinity
  symmetry on enemy attacks, and the `attacked` event shape.
- §6 item 5: move `on-attacked` from annotation-only to live.

## Related memory

`project-combat-engine-roadmap` (running state), `project-persistent-stacking-buffs`,
`project-dps-skill-mechanic-pipeline`, `project-skill-ability-editor`. Coverage doc
`docs/skill-model-coverage.md` §5 (canonical rules) + §6 (backlog).
