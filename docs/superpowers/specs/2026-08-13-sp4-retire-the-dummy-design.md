# SP-4 — Retire the dummy enemy and the non-positional code paths

**Date:** 2026-08-13
**Epic:** `2026-08-11-dps-real-enemy-and-buff-timeline-epic-design.md` — this is its final sub-project.
**Predecessors:** SP-1 (#317, `a35cbe41`) + residuals (#318, `6e71c9af`), SP-2 (#319, `b046e6db`),
SP-3a (#320, `89b88471`), SP-3b (#321, `da677695`).
**Successor:** none. This closes the epic's end-goal: *no dummy ships, everything positional.*

---

## 1. Why now

The epic's end-goal was stated by the owner on 2026-08-11: **simplify the engine so there are no
dummy ships and everything is positional.** The dummy was to be removed LAST, because every prop
holding it up existed to serve a non-positional caller. Those callers are now gone:

- SP-1 gave the DPS calculator a real, positioned, full-walk enemy.
- SP-3 did the same for the healing calculator — the last production caller that ran without a board.

**Verified for this spec:** all five production callers (`dpsSimulator`, `healingEngineAdapter`,
`battleSimulator`, `DPSCalculatorPage`, and the engine's own internals) supply `enemyAttackers`. No
production path reaches the dummy today. What holds it alive is the test corpus.

SP-F F7's old finding ("the dummy is NOT removable") was conditional, and each condition has
dissolved — see the epic spec's dissolution table. This spec does not re-litigate that.

---

## 2. Measured facts (do not re-derive)

Four measurements were taken before the design, two of which changed it.

### 2.1 A 0-attack positioned enemy is RNG-stream-inert

Three DPS fixtures were run twice — once in dummy mode, once with an identical-stats positioned
enemy carrying `attack: 0` and no `shipSkills` — under a seeded keyed RNG. Results were
**byte-identical**: same totals, same per-round damage arrays, same crit sequences
(`011000101110` in both runs). Only `finalHpPct` moved, in the last float digit
(`61.09512984125371` vs `61.0951298412537`), because the two derivations accumulate differently.

This is because the rate gates are **keyed per actor id** (`makeRateGate(`${id}:active-crit`)`,
`engine.ts:1957`), so each actor draws from its own mulberry32 sub-stream. Adding an actor does not
perturb another actor's stream.

⚠️ **This narrows SP-1's recorded lesson.** SP-1 recorded "adding an actor changes the COUNT AND
ORDER of RNG draws, so even a zero-damage enemy shifts every later draw." That is true when the
enemy **acts** (a real ship with a synthesized basic attack, which is what SP-1 added). It is NOT
true of mere presence. The corrected rule: **a 0-attack, skill-less enemy is stream-inert; an
acting enemy is not.**

### 2.2 The scale of what is left

Grep counts on these symbols read roughly 3× high because comment volume exceeds code volume. The
code inventory is **~30 sites, all in `engine.ts`** — see §5.

### 2.3 The migration surface

| Population | Count | Note |
| --- | --- | --- |
| Test files calling `runCombat` / `simulateDPS` | 227 | the whole engine corpus |
| …that pass NO `enemyAttackers` (bucket A) | 36 | the synthesized-enemy path |
| …that pass bare, position-less `enemyAttackers` (bucket B) | 42 | the dummy is still their player-side offense sink |
| Test files setting `enemyHp` / `enemyDefense` | 253 | the scalar-input migration |
| …of those, calling `runCombat` directly | 194 | **these need editing** |
| …of those, `simulateDPS`-only | 25 | **no edits** — `DPSSimulationInput` keeps the scalars |
| Files setting `healTargetId` | 195 | the `mode: 'healing'` migration |
| Files setting `positionalTeamBattle` | 29 | the `mode: 'battle'` migration |

### 2.4 The engine's `enemyOutcome` is already overridden

`dpsSimulator.ts:621-639` already replaces the engine's `survived` / `roundsToKill` / `finalHpPct`
whenever real enemies exist, falling back to the dummy-derived values only for a zero-enemy roster
(#318). So the summary half of the legacy scalar accounting is **already dead in production**. It
survives only for bucket-A fixtures.

---

## 3. Locked decisions (owner, 2026-08-13)

1. **Full input-surface removal.** `enemyHp`, `enemyDefense`, `enemySpeed`, `enemySecurity` come off
   `CombatEngineInput`; `enemyAttackers` becomes required. Every caller constructs a real enemy.
2. **The engine auto-places position-less actors.** Bucket-B fixtures are not hand-migrated for
   positions; normalization gives them a board. Their damage stops landing on a sink and lands on a
   real positioned enemy, which is the point of the exercise.
3. **An explicit `mode` replaces all three implicit discriminators** — `dpsEnemyTarget` (derived
   from roster emptiness), `healingMode` (derived from `healTarget` presence), and
   `positionalTeamBattle` (a boolean that really names a mode). `healTarget` survives as pure data:
   *who the report focuses on*, not *what kind of run this is*.
4. **The two deferred heal-routing legacies are in scope, as the final PR.** They are the only part
   of SP-4 whose churn is semantic rather than mechanical, so they land after the deletions have
   proven clean.

### 3.1 Correction to decision 1: `enemyType` stays

`enemyType` looked like a fifth dummy scalar. It is not. It is **fight-wide condition context**,
threaded independently of the dummy actor (which carries no class field at all) through
`playerTurn.ts:407`, `triggers.ts:1421/1705/1779/1824`, `roundContext.ts:41`, and consumed by the
`enemy-type` gate at `triggers.ts:3913`. `triggers.ts:2595` documents the fight-wide semantics
deliberately.

Deleting it would require inventing a per-actor class field on `EnemyActorInput` and per-victim
`enemy-type` gating — new scope, a game-rule question of its own, and not on the critical path.
**`enemyType` remains a fight-wide input. Per-victim enemy-type gating is a non-goal (§9).**

### 3.2 `corrosionBaseHp` is already safe

`min(enemyHp, 500_000)` at `engine.ts:1028` reads its `enemyHp` **argument**, which callers already
supply per victim (`victimMaxHpFor(tgt)` at `:6604`, `recipientMaxHp(...)` at `:8125/:8213`) — never
`input.enemyHp`. Removing the input does not touch corrosion scaling.

---

## 4. Architecture: one normalization boundary

The design rests on a single principle: **the engine accommodates an under-specified input in
exactly one place, and everything below that place sees a fully positional world.**

```
runCombat(input)
  └─ normalizeCombatRoster(input)          ← NEW module, the ONLY accommodation
       • enemyAttackers: required (no synthesis of a sink)
       • auto-place any actor with position == null
       • synthesize targeting where parseShipTargeting yields none
  └─ engine core: ONE positional path — no dummy, no legacyVictim, no !positional fork
```

### 4.1 `normalizeCombatRoster` — the new module

New file: `src/utils/combat/normalizeRoster.ts`. Pure, no engine imports beyond types, unit-testable
in isolation. Three responsibilities:

**(a) Auto-placement.** Any actor arriving with `position == null` receives a deterministic slot:

| Actor | Default |
| --- | --- |
| focus attacker | `DEFAULT_ATTACKER_SLOT` (`M4`) |
| Nth team ship | `defaultTeamSlot(n)` — existing helper |
| Nth enemy | `DEFAULT_ENEMY_SLOT` (`M4`) for n=0, then a walk-back order mirroring `defaultTeamSlot` |

The two sides occupy **separate coordinate spaces**, which is why both anchor on `M4`
(`dpsEnemyPlacement.ts:15-16`). Collisions within a side are resolved by the existing
`resolvePlayerSlots`, generalized to run per side (its logic is side-agnostic; only its name is
player-flavoured). Auto-placement is applied per side over the actor's INPUT ORDER, so it is
deterministic and reproducible.

**(b) Targeting synthesis.** An actor with no `ParsedTarget`/`ParsedPattern` — a manual-entry ship,
or one whose targeting columns are empty — receives `DEFAULT_FRONT_ENEMY_TARGET` +
`DEFAULT_BASE_PATTERN`. Both are load-bearing, not cosmetic: a positional cast needs BOTH, and the
missing-pattern failure is **silent** (the cast resolves and credits a total while `perTargetDealt`
comes back empty — SP-1's earned lesson).

⚠️ `DEFAULT_BASE_PATTERN.range` **must be 0**. `patternSignature` builds `"base|0|"`, whose offset
table is `[ORIGIN]`; `"base|1|"` has no table and `resolveCells` throws.

This is the SP-3 synthetic-fallback pattern (`healingEngineAdapter.ts:437-491`) lifted from an
adapter into the engine boundary, where it serves every caller instead of one.

**(c) Nothing else.** Normalization does not invent enemies, does not fill in stats, and does not
choose a mode. A missing `enemyAttackers` is now a caller error, not something to paper over.

### 4.2 The explicit `mode`

```ts
mode?: 'dps' | 'healing' | 'battle';   // default 'dps'
```

Default `'dps'` so the 227-file corpus does not need a mechanical edit at every call site; only
healing and battle callers state their mode. **The default is a constant, not a derivation** — which
is the whole point. `healingMode = !!healTarget` and
`isDpsMeasurementRun = !positionalTeamBattle && !healingMode` both disappear.

The default is safe because omission fails **loudly**: a healing test that forgets `mode: 'healing'`
gets DPS heal routing and its assertions break. There is no silent-wrong-answer path.

What `mode` decides, and nothing more:
- `'dps'` — the focus's output is the report; the run ends when the focus's target dies, and also
  when the focus itself dies (`isDpsMeasurementRun`'s existing discriminator, now named).
- `'healing'` — the run continues past the focus's death; heal/shield accounting is the report.
- `'battle'` — two-team battle; the squad fights on without its focus. Replaces
  `positionalTeamBattle` one-for-one.

---

## 5. Deletion inventory

Seven clusters, ~30 code sites, all in `engine.ts` unless noted. "Prod-live" = reachable from a
production caller today.

| # | Cluster | Sites | Prod-live? |
| --- | --- | --- | --- |
| A | **The dummy actor** — `createActor({ id: 'enemy' })` from the four scalars | `1792` | Yes — constructed on every run, including battle/healing |
| B | **Presence-derived mode signals** — `dpsEnemyTarget`, `dummyEnemyIsVestigial`, the `turnOrderActors` filter | `2339`, `2428`, `2435`, `9877`, `10046`, `10308` | `dpsEnemyTarget` is always false now → its 3 branches are dead in prod. `dummyEnemyIsVestigial` is live |
| C | **The targeting fallback** — `TurnBindings.legacyVictim` + `selected ?? tb.legacyVictim` | `6244`, `6265`, `6279`, `6523` | **Yes — the load-bearing one.** The enemy side binds `legacyVictim: healTarget`, and any actor whose positional resolution fails lands here |
| D | **Turn special-casing** — dead-actor skip, debuff routing, the dummy's own turn branch | `7981`, `7985`, `8839`, `9741` | Only when the dummy is in the turn order |
| E | **Legacy scalar accounting** — `enemyHpDecline`, the `!positional` credit fork, post-round HP decline, the `enemyOutcome` derivation | `7297`, `8550`, `9888`–`9915`, `9945`, `10078`, `10337`–`10357` | Fixture-only (§2.4) |
| F | **Event-payload suppression** — hiding `enemy.id` from `targetId`, plus emissions using it | `6596`, `6634`, `7435`, `8858`, `8880`, `9838`, `9915` | Live wherever the dummy is the resolved target |
| G | **Condition-context fallbacks** — `enemyWithMostBuffs` / `enemyWithHighestSpeed` / buff-name union defaulting to `[enemy.id]`; `hasPositionedEnemyRoster` becomes constant `true` | `3129`, `5638`, `7743`, `7751`, `7768` | Live as fallbacks |
| H | **Input surface** — `enemyHp`, `enemyDefense`, `enemySpeed`, `enemySecurity` | `1147`, `1148`, `1180`, `1186` + 194 test files | Fed by tests only |

Plus the non-dummy-shaped legacies on the same path (PR 4d), all line-verified:
- the unconditional lowest-HP recipient route — **two mirrored sites**: `playerTurn.ts:3361`
  (`healing.teamBattle` → `lowestHpAllyId(playerIds)`) and `playerTurn.ts:3354`
  (`isEnemyCaster` → `lowestHpAllyId(enemyIds)`). **These must move together** — the locked rule is
  that engine work is team-symmetric, and E5's heal-lift is the template.
- the `'ally' → [healTarget!.id]` hard route — `engine.ts:3580` and `engine.ts:3666` (the SP-3 spec
  cited `:3494`; it has since drifted, so re-grep rather than trusting either number)
- `procStandingLeeches`'s `rid === healTarget.id` pool gate (`engine.ts:3563`–`3633`), left
  deliberately untouched by SP-3 as "load-bearing for the non-positional all-allies case", pinned by
  `leech.test.ts:355-404` — that test is the one to read first
- the `teamBattle` / `perRecipientApply` two-axis split (`playerTurn.ts:176-180`) reduces to
  per-recipient application only, once routing always comes from the footprint

**Cluster C is the keystone.** Once normalization guarantees every actor resolves positionally, C's
fallback is unreachable and B/D/E/F/G fall out behind it. That ordering is why the PR ladder puts
normalization first and deletion second.

---

## 6. Decomposition — four PRs

Each PR states its own churn expectation. A PR whose actual churn differs from its expectation is a
defect signal, not something to re-pin.

### PR 4a — normalization boundary + explicit `mode` (additive)

- New `normalizeCombatRoster` (§4.1), called at the top of `runCombat`.
- New `mode` input; `healingMode` / `positionalTeamBattle` / `isDpsMeasurementRun` replaced by it.
  `positionalTeamBattle: true` → `mode: 'battle'` at its 29 files; `healTargetId`-setting tests →
  `mode: 'healing'` at its 195 files.
- The four scalars STILL EXIST and still build the dummy, so bucket-A fixtures keep working
  unchanged. Nothing else reaches the dummy after this PR.

**Churn expectation: all of buckets A and B.** Bucket A is byte-identical except `finalHpPct`'s float
tail and newly-present `perTargetDamage` / `perTargetDealt` keys (§2.1). Bucket B moves for stated
reasons (§7).

### PR 4b — delete the dummy and its branches

Clusters A–G. Pure deletion.

**Churn expectation: ZERO golden movement.** That is the proof 4a made these branches dead. Any
movement here means normalization missed a path — investigate, do not re-pin.

### PR 4c — delete the scalar input surface

Clusters H. `enemyAttackers` becomes required; the 194 direct-`runCombat` test files replace their
scalars with an explicit enemy via a shared `__testutils__` builder (one helper, not 194 inline
literals). `DPSSimulationInput` keeps `enemyDefense` / `enemyHp` as UI-facing fields and folds them
into the enemy it constructs — so its 25 files need no edits, and `DPSCalculatorPage`'s existing
duplication (it passes both the scalars and an identical-stats `enemyAttackers[0]`) is reconciled to
one source.

**Churn expectation: ZERO golden movement**, since the builder reproduces the stats the dummy was
built from.

### PR 4d — retire the non-positional heal routes

Recipients come from the parsed target's selection resolved over the support footprint, never from a
hard-coded `lowestHpAllyId`. SP-3's spec §3.1 recorded this hard-code as a *probable latent defect*
and deferred it precisely because it moves sim goldens.

**Both mirrored sites move in the same PR** (`playerTurn.ts:3354` enemy-side, `:3361` player-side).
Fixing one side only would leave the engine asymmetric, which the locked rule forbids — and an
enemy-side-only or player-side-only fix is exactly the defect shape #306 found across 7 ships.

⚠️ **Open game-rule point to settle during 4d, not now:** a ship whose text says "ally with the
lowest health" must still route that way — via the parser's `selection`, which already models it.
The defect is the *unconditional* lowest-HP route applied to ships whose text says no such thing.
Verify against `docs/ship-skills.csv` which shipped kits actually specify a lowest-HP ally before
changing the routing, and state the affected ships in the PR.

**Churn expectation: semantic movement in the sim/healing corpus**, each move attributed to a named
ship's actual skill text. Needs an `UNRELEASED_CHANGES` entry — this one is user-visible in the
combat sim. PRs 4a–4c are internal and need none.

---

## 7. Churn taxonomy and acceptance rules

Every moved golden must be attributed to exactly one bucket. **Never `vitest -u`.**

| Bucket | Population | Expected movement |
| --- | --- | --- |
| A | 36 no-enemy fixtures | `finalHpPct` float tail; newly-present `perTargetDamage` / `perTargetDealt` keys. Damage numbers, crit sequences and totals do NOT move (measured, §2.1) |
| B | 42 bare-enemy fixtures | Real. Enemy defence becomes its own rather than `input.enemyDefense`; enemies can now DIE where the sink could not; reflect/counter/on-attacked kits can activate where a sink absorbed silently |
| C | sim/healing corpus, PR 4d only | Heal recipients shift from `[healTarget.id]`/lowest-HP to the parsed selection over the footprint |

**Acceptance rules:**

1. **Cross-mode numeric parity is NOT a valid acceptance test wherever the enemy acts** (SP-1's
   locked lesson, narrowed by §2.1). Parity is asserted on `perTargetDealt`, via the shared
   `src/utils/combat/__testutils__/perTargetDealt.ts` helpers (`dealtEntries` / `dealtBy` /
   `dealtBySource`) — do not re-write the nested-reduce walk.
2. **Assert `perTargetDealt` non-empty, never just a damage total.** The missing-pattern failure is
   silent: the total looks plausible while per-victim accounting is absent.
3. **When a deletion PR predicts zero movement and gets zero, go find the test that should have
   moved.** "No goldens moved" can mean "nothing covers this" — SP-1's Task 7 shipped a page cutover
   with a green suite and no `DPSCalculatorPage` test in existence.
4. **Sweep the comment claims AROUND each edit, not just the edit.** 3 of 5 stale comments found
   during #318 predated that change. Clusters B–G are dense with comments asserting dummy
   behaviour; every one of them becomes false.
5. Full `npm test` (501+ files) plus `npm run lint` and `tsc --noEmit` on every PR. Note `tsc` does
   NOT cover `scripts/`.
6. The placement-symmetry oracle must hold at its `2 / 146 / 13-13-13` baseline (`--seeds 15`).

---

## 8. Testing

Beyond the churn audit, each PR adds behavioural tests:

**4a**
1. An input with no positions anywhere resolves onto a real positioned enemy — `perTargetDealt`
   non-empty, and the enemy's HP declines (proves auto-placement + targeting synthesis both landed).
2. Auto-placement is deterministic and collision-free: two position-less team ships plus an
   attacker occupy three distinct cells, stable across runs.
3. Explicitly-positioned actors are NOT moved by normalization (fence the accommodation in both
   directions — too-eager placement is as wrong as none).
4. `mode: 'healing'` omitted on a healing input changes routing, i.e. the loud-failure property is
   real rather than assumed.
5. `mode: 'battle'` reproduces `positionalTeamBattle: true` byte-for-byte.

**4b** No new behaviour. The gate is zero golden movement plus a grep proving each symbol is gone.

**4c** One test that `runCombat` rejects (type-level) an input without `enemyAttackers`, and the
`__testutils__` builder's own unit test.

**4d** Per affected ship: a fixture asserting the recipient set matches its skill text, with at
least one ship whose text DOES specify lowest-HP (must keep routing that way) and one whose does not
(must switch to footprint). **Every player-side assertion needs its enemy-side mirror** — the two
routing sites are symmetric and a one-sided test would pass while half the fix is missing.
**A "merged across the roster" assertion is vacuous unless the second member carries a unique
name** — `Object.values(...)[0]` otherwise passes byte-for-byte.

---

## 9. Non-goals

- **Per-victim `enemy-type` gating.** `enemyType` stays fight-wide (§3.1).
- **Removing `enemyDefense` / `enemyHp` from `DPSSimulationInput`.** They are UI-facing calculator
  inputs, not engine dummy scalars.
- **Rebasing the DPS or healing calculator onto `simulateBattle`.** Same rejection as SP-1/SP-2/SP-3:
  it would migrate `RoundData` → `BattleRound` and touch every chart and golden. Still the plausible
  end state, still not this sub-project.
- **Retro-fitting the DPS calculator onto real skill patterns** instead of the synthetic defaults.
- **Changing `liveGateConditions` or any live-gating semantics.**
- **A board UI** for either calculator. Slot dropdowns remain.
- **M2 Meatshield stack-stealing** and the other open items listed in the epic memory. Unrelated.

---

## 10. Risks

| Risk | Mitigation |
| --- | --- |
| Normalization silently moves an explicitly-positioned actor | Test 4a.3 fences it in both directions |
| A synthesized target/pattern is missing one half → silent positional-apply skip | Assert `perTargetDealt` non-empty, never a bare total (rule 7.2) |
| Bucket-B churn is larger or stranger than predicted | 4a lands buckets A and B together, audited per file; if B's churn is not attributable, stop and re-scope rather than re-pin |
| 4b/4c predict zero movement and get it because nothing covers the path | Rule 7.3 — go find the test that should have moved |
| ~194-file mechanical migration introduces a typo'd stat that shifts one fixture | The shared `__testutils__` builder means one definition, not 194; `tsc` catches shape errors |
| Cluster C removed while some path can still fail to resolve positionally | 4b is gated on 4a's zero-dummy-reachability, verified by a temporary assertion in 4a that the fallback is never taken across the whole suite |
| Comments asserting dummy behaviour survive the deletion and mislead later work | Rule 7.4 — sweep neighbours, not just edits |
| 4d changes routing for ships whose text genuinely says lowest-HP | Verify against `docs/ship-skills.csv` first; name affected ships in the PR |
| 4d fixes one side of a mirrored pair, leaving the engine asymmetric | Both `playerTurn.ts:3354` and `:3361` in the same PR, each with a mirrored fixture (the #306 defect shape) |

---

## 11. Bycatch found while specc'ing (separate from SP-4)

**`resetRateGateRng()` after `setupKeyedTestRng()` un-seeds the test.** `resetRateGateRng` sets
`rng = Math.random` AND `keyedProvider = null` (`rateAccumulator.ts:26-29`), so calling it *after*
`setupKeyedTestRng` restores true randomness — keyed gates fall back to `Math.random`. That ordering
is live in `dpsMultiEnemyFinalHp.test.ts:78-79` and any copies of it, meaning those tests may be
running unseeded today. It cost two bogus probe runs during this spec (the "crit-bearing fixtures
diverge" conclusion was my bug, not the engine's).

Not fixed here — it is a test-harness defect with its own blast radius (fixing it may move whatever
goldens those files pin). Worth a standalone sweep: grep for the `setup…` → `reset…` ordering across
the corpus.

---

## 12. Success criteria

1. `grep -rn "isDummyEnemy\|dpsEnemyTarget\|dummyEnemyIsVestigial\|legacyVictim" src` returns
   nothing outside historical notes.
2. `CombatEngineInput` has no `enemyHp` / `enemyDefense` / `enemySpeed` / `enemySecurity`, and
   `enemyAttackers` is required.
3. There is exactly one damage-application path. No `!positional` fork survives.
4. `mode` is the only run-kind discriminator; nothing derives a mode from a data field.
5. Full suite green; oracle at baseline; every moved golden attributed to a named bucket.
