# Sub-project E — Per-victim AoE accounting (design)

**Status:** Design approved (brainstorm, 2026-06-19). Supersedes the "old PR7" sketch in the combat-realism epic roadmap; PR7b already shipped as B1.

**Branch:** `feat/combat-sim-per-victim-aoe-E` (off `main` post-#117).

## 1. Context & reframing

The combat-realism epic deferred "per-victim AoE accounting" (the old PR7) to its tail. Since that
deferral, the **positional combat** work (merged in PR #117) already made two of PR7's four pieces
real:

- **AoE damage** is already per-victim. `positionalApply.ts` (`footprintVictims` +
  `applyPositionalDamage`) re-resolves the anchor and re-expands the footprint **per hit** against the
  live opposing roster, and computes each victim's damage with its own `roleScale` (origin 1.0,
  covered 0.5). The per-victim **damage number** comes from `victimHitDamage`
  (`victimDamage.ts:71-107`), which re-solves per-victim defence, affinity, and the incoming-damage
  debuff override from the victim's own store. The full damage **outcome**
  (`{shieldBefore, hpDamage, barriered, shieldAbsorbed, barrierAbsorbed}`) is produced one level up by
  the engine wrappers `applyVictimDamage` / `applyOutgoingToEnemy` (`engine.ts`, returns ~`:2402`).
- **Death / retargeting** is already per-victim on the positional path. `resolvePositionalTarget`
  filters to living actors (`currentHp > 0`) and re-resolves per hit; a whiff (all targets dead) skips
  the hit. `recordDestroyed` (`state.ts:173-187`) is idempotent.

PR7b (per-victim debuff *modifier sourcing* — `victimEnemyModifiers`) shipped as B1.

What **remains** in E splits into two largely-independent threads:

- **Thread 1 — Accounting (numbers correctness):** the per-victim damage *outcome* (shield/barrier
  absorb, hp loss) is computed but discarded for the player→enemy direction, so leech and per-victim
  intake cannot read it.
- **Thread 2 — Status removal (gameplay correctness):** purge/cleanse still apply to a single anchor
  victim, not every victim an AoE hits.

## 2. Current-state gaps (the work)

| # | Mechanic | Current state | File:line |
|---|----------|---------------|-----------|
| 4 | Incoming surface | **Asymmetric.** enemy→player buckets per-actor into `perActorIncoming`; player→enemy uses a **no-op `enemySink`** (all three accounting hooks discard). | `engine.ts:2410-2455` (no-op object `2442-2446`) |
| 2 | Leech | **Aggregate / single-anchor.** Standing leech procs off aggregate damage: `procStandingLeeches` (`engine.ts:2086`) fired at the single damage-credit point (~`:2200`) off the aggregate `amount`. Taken-leech is **gated out of the positional path** (`!enemyPositional`) because it needs the symmetric surface. | `engine.ts:2086`/`~2200`, `3902-3946` (gate `3913-3918`) |
| 5 | AoE purge/cleanse | **Single-anchor (on-cast purge + reactive purge).** On-cast purge removes only the selected `targetId`; "all-enemies" collapses to one victim. Cleanse already loops recipients; purge does not. | on-cast purge `playerTurn.ts:1392-1401` (comment `:1399-1400`); reactive purge `triggers.ts:1243` |
| 7 | Amartya | **Single-anchor, count 1.** "purges 1 buff from all enemies for every 50% crit power" fires single-victim, no crit-power scaling. | spec `2026-06-19-purge-ecosystem-c2b-design.md §7` |
| 6 | Per-victim repair | **Per-victim-capable but single-`healTarget`-limited.** `repairedThisRound` is a per-actor Set (`engine.ts:1897`, written `:1925`); only the heal target is ever healed in current modes, so player-Nayra-vs-enemy never fires. | `engine.ts:1897`, `1912-1927` |

(Items 1 = AoE damage and 3 = death/retargeting are already per-victim — see §1 — so they are NOT
work in E.)

## 3. Architecture — the symmetric victim-outcome surface (keystone)

The keystone is E1: make the incoming/intake surface **direction-agnostic**.

- A single per-actor `ActorIntake` accounting map keyed by actor id (ids are globally unique across
  sides, so one map serves both directions).
- The `enemySink` accounting hooks (`addIncoming` / `addShieldAbsorbed` / `addBarrierAbsorbed`),
  currently no-ops, become **real writes** into that map.
- The positional apply path already computes per-victim damage; E1 captures the **full per-victim
  outcome** (`{shieldBefore, hpDamage, barriered, shieldAbsorbed, barrierAbsorbed}`) for enemy victims
  too (via `applyVictimDamage` / `applyOutgoingToEnemy`), instead of discarding it.

**Why this is byte-identical to existing goldens — the precise invariant.** The `perActorIncoming`
map (`engine.ts:2220`) is NOT unread — it is exported wholesale every healing round
(`row.perActorIncoming`, `engine.ts:4218`) and `perActorIncoming.test.ts` explicitly asserts there is
no `'enemy'` key. So the real invariant is narrower: E1's new writes flow through
`applyOutgoingToEnemy` (`engine.ts:2447`), which is **only invoked on the positional apply path**
(`drivePositionalApply`, wired ~`engine.ts:2619`). **Every existing golden/fixture uses
non-positional / manual enemies**, so `applyOutgoingToEnemy` is never called and no enemy key is ever
added → the populated keys don't change → byte-identical. The planner must protect THIS invariant (no
new enemy keys in existing non-positional fixtures), not "nothing reads the map." A future
positional-healing-mode fixture would legitimately add an enemy key — that is **audited churn, not a
regression**. (Enemy surfacing in the simulator UI is **out of scope** — see §5; it waits for the
shield system, sub-project H.)

## 4. Decomposition (sequential PRs)

| PR | Scope | Depends on |
|----|-------|-----------|
| **E1** | Symmetric incoming surface — unify `ActorIntake` keyed by actor id; replace the no-op `enemySink` hooks with real writes; capture the full per-victim outcome for enemy victims. **Internal only** (no UI). | — (foundation) |
| **E2** | Per-victim leech — standing + taken leech re-derived per footprint victim; un-gate the positional leech blocks. | E1 |
| **E3** | AoE purge/cleanse — apply status removal to **all** footprint victims, not just the anchor. Rides the existing footprint resolver. | — (independent of E1/E2) |
| **E4** | Amartya — multi-victim purge + **faithful crit-power scaling** `count = floor(casterCritDamage / 50)` read live each cast. | E3 |
| **E5** | Credit/intake unification + death-fallback cleanup — collapse the now-redundant dual accounting paths. **Per-victim repair (Nayra) lights up here as a consequence.** | E1, E2 |

Thread 1 = E1 → E2 → E5. Thread 2 = E3 → E4 (independent; may run first if gameplay-visible fixes are
wanted sooner). Each PR gets its own plan and ships under the established gate.

### Per-PR mechanics

**E1 — symmetric incoming surface.** One `perActorIncoming`-style map for all actors. The `enemySink`
hooks (no-op object `engine.ts:2442-2446`) write into it keyed by the enemy victim's id. The full
outcome (shield-before, hp-damage, barriered, absorb amounts) is captured from the engine wrapper
`applyOutgoingToEnemy` (`engine.ts:2447`, returns ~`:2402`) — NOT `victimHitDamage` (which returns a
bare number). Mirrors the player sink. Because `applyOutgoingToEnemy` only runs on the positional
path, existing non-positional fixtures add no enemy keys → byte-identical (see §3).

**E2 — per-victim leech.**
- *Standing leech* (heal/shield off damage **dealt**): today `procStandingLeeches` (`engine.ts:2086`)
  fires once at the credit point off the **aggregate** `amount` (~`engine.ts:2200`). E2 moves this to a
  per-victim sum over footprint victims; covered cells contribute their reduced (50%) damage, since
  leech is computed off **real damage dealt**.
- *Taken leech* (reactive heal/shield off damage **taken**): each player victim procs its **own**
  reactive off the damage **it** took. Un-gates the `!enemyPositional` blocks (`engine.ts:3913`,
  `3902-3912`).
- Reads E1's per-victim outcome surface (the shield/hp split each victim needs to leech from).

**E3 — AoE purge/cleanse.** Replace the single-`targetId` removal with a loop over the footprint
victims for "all-enemies"-style targets. There are **two single-anchor purge sites** to fix (cleanse
already loops recipients): the **on-cast purge** at `playerTurn.ts:1392-1401` (the literal
`"single-anchor; multi-victim AoE → sub-project E"` comment is `:1399-1400`), and the **reactive
purge** at `triggers.ts:1243` (single `targetId`). The footprint resolver already enumerates victims
per hit; E3 routes `statusEngine.purge` to each. For reference, the already-looping sites are on-cast
cleanse (`playerTurn.ts:1624`) and reactive cleanse (`triggers.ts:1190`); end-of-round reactive purge
(Rhodium) lives at `engine.ts:4136` and should be checked for the same per-victim treatment.

**E4 — Amartya.** `count = floor(casterCritDamage / 50)` (crit power = the `critDamage` stat),
computed from the caster's **live** crit power at cast time, applied to **every** footprint victim.
Builds on E3's multi-victim loop. Removes the C2a single-anchor count-1 under-approximation flag.

**E5 — unification + Nayra consequence.** With the no-op sink gone (E1), collapse the dual
accounting/credit paths and tidy death-fallback. **Per-victim repair tracking** then lights up:
`repairedThisRound` is already a per-actor Set, so once the symmetric surface lets any actor be
healed/tracked per-victim, the documented Nayra limitation
(player-Nayra-vs-enemy always false because "engine never heals enemy ships") resolves with no new
mechanism.

## 5. Locked decisions

- **Amartya count = `floor(critDamage / 50)`** — faithful crit-power scaling, read live each cast.
- **E1 is internal only** — no simulator-UI surfacing of enemy per-victim absorb/HP. Surfacing waits
  for the shield system (sub-project H), where it is no longer moot.
- **Full E, sequential PRs** (B/C-series cadence).
- **Nayra per-victim repair lands in E5** as a consequence of the symmetric surface, not its own PR.
- **Thread 2 (E3/E4) is independent of Thread 1 (E1/E2)** and may be sequenced first.

## 6. Out of scope / deferred elsewhere

- Enemy shield/barrier per-victim **UI** → sub-project H (shield system).
- New shield **sources** (gear-set, overheal-to-shield implant) → sub-project D.
- Lodolite p3 (shield-removal-on-purge) → sub-project H.

## 7. Testing / gate (unchanged from B/C)

- **Byte-identical goldens are the default gate.** Audited churn ONLY on two-team-sim fixtures
  (twoTeamBattle / dpsSimulator multi-actor / positionalDamage.integration) where a behavior
  legitimately becomes per-victim — e.g. a leech now firing per footprint victim, or a debuff now
  stripped from multiple enemies. Explain every golden delta line-by-line. **Never blind `vitest -u`.**
- DPS single-enemy + healing goldens MUST stay byte-identical (the dummy/single-target guards hold).
- `audit:skills` 0/141, `npm run lint` (max-warnings 0), `npx tsc --noEmit` clean every PR.
- Subagent-driven; per-task spec+quality + final holistic (opus) review.
- Run tests via `npx vitest run <name>` (bare `npm test` = watch mode, hangs agents).
