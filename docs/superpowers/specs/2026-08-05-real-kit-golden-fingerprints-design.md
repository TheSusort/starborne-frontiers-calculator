# Real-kit golden fingerprints — design

**Date:** 2026-08-05
**Status:** approved (design), plan not yet written
**Origin:** the golden suite covers zero real ship kits. Every fixture in
`src/utils/calculators/__tests__/__fixtures__/simGoldenFixtures.ts` is synthetic, which is why 22
commits of real ship-behaviour change in #296 moved zero snapshots.

## Problem

`simGolden.test.ts` snapshots whole `BattleResult`s for 11 fixtures. All 11 are hand-built ships
with hand-written skill text. The fixture header records why:

> Skill-text clauses below are ALL verified against the same parse path … (this repo has no local
> docs/ship-skills.csv to grep, per the task brief)

The author had no corpus. So the suite guards the *engine* against changes in *synthetic* kits, and
is structurally incapable of noticing when a real ship's behaviour changes. #296 changed real
behaviour for Quixilver, Malvex, Panon and Sansi across 22 commits and moved no snapshot. #297
(Malvex's active self-shield) likewise moved none.

The defect class this leaves uncovered is the dominant one in the changelog: a mechanic that
silently does nothing, or a gate that is never read. Sampling `UNRELEASED_CHANGES`: *"Hit Mitigation
now does something"*, *"Out. Detonation Damage Up now does something"*, *"Rogue's Liberty now
works"*, *"it used to be a name in the buff list with no effect"*, *"the condition was not being
read at all"*. Every one of those changes **whether** an effect occurs for a **named real ship** —
exactly what no current golden observes.

## Goals

- A regression tripwire over the whole real roster, where a change to one ship's behaviour moves
  that ship's snapshot and nothing else.
- Reviewable diffs. The suite must never present a wall of churn that invites a blind `vitest -u`
  (forbidden by `simGolden.test.ts`'s header and by project convention).
- Reuse the #270 interaction-audit harness rather than build a second one.

## Non-goals

- Numeric drift. `dpsGoldenParity`, `healingGoldenParity` and the existing synthetic
  `simGolden` fixtures keep that job; all of them stay. The synthetic fixtures in particular carry
  dedicated F1/F2/F4/F6 invariant assertions (reconciliation, per-recipient healing, heal-modifier
  scaling, per-victim affinity), not just snapshots, and are not superseded by this work.
- Correctness assertions per ship. This suite pins *current* behaviour. Deciding whether that
  behaviour is right is the ship-kit-correctness audit's job (complete, waves 1–8).
- CI. There is no CI test workflow (`.github/workflows/` holds only `security.yml` and an e2e
  cron); the full suite runs from the husky pre-commit hook. This suite inherits that.

## Design

### 1. The fingerprint token

`fingerprintActor` (`src/utils/combat/audit/fingerprint.ts`) already reduces one actor's whole
battle to the set of `CombatLogEntryKind`s it produced, walking `startOfRound`, every turn's
entries, `endOfRound`, and nested `reactions`. There are 18 kinds: `attack`, `heal`, `shield`,
`buff`, `debuff`, `dot-applied`, `dot-ticked`, `control`, `cleanse`, `purge`, `charge-changed`,
`death`, `detonation`, `bomb`, `buff-expired`, `debuff-resisted`, `shield-destroyed`,
`cheat-death`.

**Bare `kind` is too coarse, and Malvex proves it.** Malvex has two shield sources: the active-slot
grant #297 just gated, and a passive (*"When directly damaged as a primary target, this Unit gains
Shield equal to 15% of the Damage dealt to them"*). A `"shield"` token appears in the plain
scenario either way, so a bare-kind fingerprint would not have caught the very bug that motivated
this work.

So the token is **`kind` plus slot**, since `buildCombatLog` spreads
`ctx.consumePendingSkill()` — `{skillName, slot}` — onto cast-sourced entries while a
reactive/passive entry carries neither:

| token | meaning |
| --- | --- |
| `shield:active` | shield granted by an active-slot cast |
| `shield:charged` | shield granted by a charged cast |
| `shield` | shield from a passive or reaction (no pending skill) |

`skillName` is deliberately **excluded** from the token: it is the ship's own skill name, so it
carries no information the ship key doesn't already, and it would make snapshots churn on a
cosmetic rename.

The fingerprint is the **sorted** set of tokens, so ordering can never churn a snapshot.

Implementation note: this is a new function alongside `fingerprintActor`, not a change to it.
`fingerprintActor` has an existing consumer (`ablation.ts`, whose differential oracle compares
kind-sets solo vs in-composition); changing its return type would silently reshape that oracle.

### 2. Scenarios

Each focus ship is fingerprinted in three fixed environments, 20 rounds, via `runSeededBattle`
under one pinned seed. `canonicalPlacement` (`audit/fixtures.ts`) pins the focus ship to
un-modified level-60 base stats — no gear, no refits, no engineering.

| scenario | environment | what it unlocks |
| --- | --- | --- |
| `plain` | untouched inert allies and enemies | the baseline, and where a broken gate leaks — the scenario Malvex's ungated `shield:active` would have appeared in |
| `richEnemy` | enemies pre-seeded with an ABSOLUTE, depletable Shield pool (3x the focus ship's base attack) | target-state gates: `enemy-shield` (Malvex's legitimate half), and everything keyed on hitting a shielded target |
| `wounded` | every actor on the board pre-damaged (allies+focus+enemies), plus one deliberately fragile ally | ally-facing clauses: heals, ally shields, hp-threshold gates, Protection, `on-ally-destroyed` / revive — and enemy-side hp-threshold/execute gates |

**v1 seeds only `shieldPool` and `currentHp`** — the two pieces of scenario state that live directly
on `CombatActor` and are therefore reachable from the actor tap (§5). Seeding named buffs/debuffs
needs `__testTapStatusEngine` plus hand-constructed `RegisteredAbilityStatus` values
(`AbilityStatusBase` + the timed variant's fields), which is real surface area the flagship
`enemy-shield` case does not need. **Deferred**, and deliberately gated on evidence: the
non-vacuity report (§Testing) will name the ships whose tokens stay thin, and if `enemy-buff` /
`enemy-debuff` / `self-debuff` gates are what's keeping them thin, that is the trigger to add a
fourth seeded scenario. Building it before that evidence exists is speculation.

Three scenarios, not one, because a single environment leaves every gated clause dark and then
pins that darkness as expected — a future regression in a gated clause would be invisible.

### 3. Filler ships

Real corpus ships, per the #270 ablation precedent (which uses Bedrock as its fixed neutral
opponent). The corpus contains **10 ships with no passives, no charge skill, and a bare
`"This Unit deals 90% damage"` active**:

`Bedrock, Crusher, Custodian, Forsythia, Jempol, Krysa, Rookie, Trydent, Umayl, Xiaodao`

Seven are needed (4 enemies + 3 allies). They must be **distinct within a side** —
`compose.ts`'s `pickDistinctShip` enforces this because a repeated ship on one side is an illegal
in-game state — but may repeat **across** sides. Ten candidates is comfortable headroom.

Because these ships carry no kit at all, real-corpus filler here has effectively the same stability
as synthetic filler would: there is nothing in them to perturb a focus ship's fingerprint.

**Inertness guard.** A dedicated test pins all seven filler rows as passive-free, charge-free, and
matching the bare-damage active. If a data refresh gives one a passive or a charge skill, that one
test fails with an explicit message, instead of 147 snapshots moving for a reason nobody can
attribute.

### 4. Survival, incoming damage, and the one intentional exception

Filler get an HP override of **500,000,000** so they survive all 20 rounds. Without it, a
damage-formula change shifts kill timing, which shifts which clauses get to fire — smuggling numeric
sensitivity into a suite deliberately chosen to be structural. The value is absurd rather than merely
large on purpose: the corpus's per-battle damage output spans more than an order of magnitude, so no
finite HP both keeps the hardest hitter from killing and lets the softest one dent anything. HP%
*state* is therefore **seeded** (`wounded`, 35% of max on both sides; the focus 45%) rather than
produced by damage, which decouples "which hp-threshold gates read true" from "how hard this
particular focus ship hits".

**Board layout is the load-bearing choice**, because it decides whether the focus is ever attacked.
`selectTargets` scans rows from the CASTER's own row and takes the front-most occupied column, so:

- focus at **M4**; three enemies share row M *behind* it (**M3/M2/M1**) → all three single-target
  enemy attacks resolve onto the focus every round, and the focus's own offence still sees three
  enemies front-to-back in one row (`all` still reaches four);
- the fourth enemy at **T3**, where the front-most player is the ally at **T4** — the fragile ally's
  slot, and the only way an ally can be attacked while the focus is front-most in its own row;
- allies at **T4 / T2 / B4**: T2 backs up T4 so the T3 enemy retargets to it rather than joining the
  three on the focus when the fragile ally dies, keeping the focus's incoming budget identical across
  scenarios; T4/B4 flank the focus's column-4 cell for column/adjacency support footprints.

The first layout parked the focus at M4 behind an ally at T4 with all four enemies in row B — the
row scan reached row T first, so **the focus took zero incoming damage in 136 of 147 fingerprints**
and every on-damaged clause in the corpus (counterattack, reflect, revenge, on-damaged grants,
Barrier hit-counting) was silent.

**Filler attack is derived per focus ship, not constant.** The corpus spans 7.3k–23.9k HP and
972–4047 defence (22%–53% mitigation), so one attack value either leaves the tanks untouched or kills
the squishies. `fillerAttackFor` inverts the damage formula so the whole battle takes
`INCOMING_FRACTION = 0.2` of the focus's max HP: `attack = 0.2 * hp / (0.9 * (1 - mitigation) * 20
rounds * 3 attackers)`. The binding constraint is `wounded`, where the focus starts at 45%; measured
worst case is a 22.4% decline (Isha), leaving the thinnest survivor at ~23%.

The fragile ally in `wounded` is the deliberate exception: something must die for
`on-ally-destroyed`, revive and `cheat-death` clauses to fire. At **1 HP** its death is immune to any
damage-formula change (any hit is lethal), so it is a *pinned* event, not survival drama.

### 5. Seeding

`BattleSimulationInput` exposes only `playerTeam`, `enemyTeam`, `rounds`, and the two squad-leader
fields — no hook for initial actor state. `CombatEngineInput` **does** carry
`__testTapActors?: (actors: CombatActor[]) => void` (engine.ts:1363, fired once at actor
construction on line 2348), and 44 test files already use it.

So: forward the same field from `BattleSimulationInput` into the `runCombat` call
`simulateBattle` makes (one call site, battleSimulator.ts:1008). A test-only field on a production
input type, extending a precedent that already exists one layer down.

The alternative — arranging the state in-fiction with a real shield-granting ship and a real
debuffer — was rejected: those kits would then co-determine every focus ship's fingerprint, so a
fix to *them* would move *other* ships' snapshots, which is the exact coupling the inert-filler
choice exists to prevent.

Seeded state uses `CombatActor` fields directly: `shieldPool` and `currentHp`. The engine also
carries a sibling `__testTapStatusEngine` (engine.ts:1384, fired at 2008 — i.e. *before* the actor
tap at 2348), which is the hook a future buff/debuff-seeding scenario would use; v1 does not
forward it, and should not until there is a scenario that needs it.

### 6. Snapshot shape

One snapshot per focus ship, keyed by ship name via `it.each` over the corpus, so a new ship in the
corpus is a pure snapshot **addition** and never a diff to existing entries:

```
exports[`kit fingerprints > Malvex 1`] = `
{
  "wounded": ["attack:active", "attack:charged", "charge-changed", "shield"],
  "plain": ["attack:active", "attack:charged", "charge-changed", "shield"],
  "richEnemy": ["attack:active", "attack:charged", "buff:charged", "charge-changed", "shield", "shield:active"],
}
`;
```

Post-#296/#297 Malvex. `shield` (the passive reaction to being damaged) appears in every scenario;
`shield:active` and `buff:charged` (the Barrier) appear **only** in `richEnemy`, because both are
gated on the target carrying a Shield. Pre-fix, both sat in all three — the diff the suite exists to
produce, and it covers both halves of the `enemy-shield` gate at once.

Note the token vocabulary this implies, and which the plan's first task must confirm against a real
run rather than assume: a cast attack is `attack:active` / `attack:charged`, while a *reactive*
attack (counterattack, reflect — buildCombatLog.ts:580, which consumes no pending skill) is a bare
`attack`. That split is useful, not incidental: it distinguishes a ship that attacks on its turn
from one that only counterattacks.

### 7. Corpus drift

The snapshot derives from gitignored reference data, so `npm run fetch:ship-skills` /
`fetch:ship-data` can move fingerprints for corpus reasons rather than engine reasons. Two
mitigations, both cheap:

- Per-ship keys (§6) make added and removed ships pure additions and removals.
- A separate one-line snapshot pins the corpus shape — row count plus a digest of the
  name-and-skill-text set — so a corpus refresh announces itself in **one** obvious diff sitting
  next to the 147, rather than leaving the reader to guess.

## Cost

Measured, not estimated: 147 ships in the corpus; 13.8ms per 20-round 8-actor seeded battle;
`buildTraceShip` over the whole corpus is 5ms. 147 × 3 ≈ **6.1s**, against a current full-suite
duration of ~27s. Acceptable inside the pre-commit hook at full 20 rounds.

## Testing

- The 147 × 3 fingerprint snapshots (the deliverable).
- Inertness guard on the 7 filler ships (§3).
- Corpus-shape snapshot (§7).
- Determinism: the same ship fingerprinted twice in one run yields identical tokens — the guard
  against RNG leaking across scenarios. Note `runSeededBattle` resets to `Math.random` in its
  `finally`, not to any ambient test seed, so every battle must go through `runSeededBattle`.
- Non-vacuity: at least one scenario must yield a non-empty token set for every ship, and the
  union across the roster must cover an EXPLICIT ledger of the kinds it reaches today (13 of 18:
  attack, bomb, buff, buff-expired, charge-changed, control, debuff, debuff-resisted, dot-applied,
  dot-ticked, heal, shield, shield-destroyed) — named, so a regression in any one of them fails by
  name, and so a NEW kind appearing is also flagged. Without this, a harness bug that fingerprints
  nothing at all would produce 147 empty snapshots and read as passing. Both this and the
  every-ship-produces-tokens check read tokens ACCUMULATED during the snapshot pass, so the 441
  battles happen once.

  The five kinds NOT reachable and why: `cleanse`/`purge` need a player-side debuff / enemy-side buff
  to remove (the deferred status seeding — 21 corpus ships cleanse, 15 purge: the biggest remaining
  hole); `detonation` is booked by `buildCombatLog` to the bomb's VICTIM, so it can never appear in a
  focus-actor fingerprint unless the focus is itself bombed by non-inert filler; `death` and
  `cheat-death` are booked to the actor that died / was saved, so both need the focus to take lethal
  damage — the direct opposite of the survival requirement.
- A pinned regression case for #296/#297: Malvex's `plain` tokens must contain neither
  `shield:active` (#297) nor `buff:charged` (#296's Barrier), while `richEnemy` must contain both.
  This is the one test that would have failed before those PRs, and it is what proves the design
  catches the class it was built for. Assert it explicitly, not only via the snapshot — an explicit
  assertion survives a careless `-u`, a snapshot does not.

## Risks

- **Ships whose gates none of the three scenarios satisfy** still fingerprint thin, and the
  snapshot pins that as expected. Partially mitigated by the non-vacuity check, but a fourth
  scenario may be wanted later. Accepted for now: three scenarios is strictly better than the
  zero real-kit coverage that exists today.

  **Evidence (Task 7, `npx tsx scripts/reportThinKitFingerprints.ts`, threshold ≤3 distinct
  tokens across all three scenarios):**

  ```
  thin ships (23 of 147):
    Akula(attack:active,attack:charged,charge-changed)
    Bedrock(attack:active)
    Berserker(attack:active,attack:charged,charge-changed)
    Crusher(attack:active)
    Custodian(attack:active)
    Faust(charge-changed)
    Forsythia(attack:active)
    Gallant(attack:active,attack:charged,charge-changed)
    Jempol(attack:active)
    Krysa(attack:active)
    Lodolite(attack:active,attack:charged,charge-changed)
    Mender(charge-changed)
    Nuqtu(attack:active,attack:charged,charge-changed)
    Purifier(charge-changed)
    Refine(charge-changed)
    Rhodium(attack:active,attack:charged,charge-changed)
    Rookie(attack:active)
    Sefuba(attack:active,attack:charged,charge-changed)
    Sokol(attack:active,attack:charged,charge-changed)
    Trydent(attack:active)
    Umayl(attack:active)
    Wrecker(attack:active,attack:charged,charge-changed)
    Xiaodao(attack:active)
  ```

  23 of 147 (~16%) are thin, in three shapes: a bare `attack:active` (a plain-damage active with no
  passive and no charge skill — 7 of the `FILLER_NAMES` themselves are in this list, e.g.
  Bedrock/Crusher/Custodian/Forsythia/Jempol/Krysa/Rookie, confirming the filler-inertness guard is
  measuring the right thing); the same plus `attack:charged`/`charge-changed` (a charge-attack kit
  with no conditional/gated passive); and **`charge-changed` ALONE** — Faust, Mender, Purifier,
  Refine, four zero-damage support kits whose only logged behaviour is charge accrual.
  **Corrected (second fix wave):** this was originally written up as one engine-side gap across all
  four; that is wrong for 3 of them. Faust, Mender and Refine's active patterns are all
  `Line-Support-Not-Self-Range-N`, which extends FORWARD from the caster — anchored at
  `FOCUS_POSITION` (the front column), they resolve to **zero cells**, so their actives structurally
  cannot fire in this fixture. That's a fixture limitation (now guarded by a reachability test — see
  Risks below), not an engine bug. **Purifier is the only genuine suspected gap**: its
  `Wings-Support-Not-Self-Range-2` from the focus anchor DOES resolve onto occupied ally cells
  (T4/B4), yet no ally is ever buffed and `healingDone` stays 0 across all 20 rounds even in
  `wounded`, where the focus sits at 45% HP with real headroom. None of the 23 show a token
  that looks state-gated-but-never-fired (no lone `buff:`/`debuff:`/`shield:` token sitting
  unaccompanied) — the thinness is because these kits genuinely have little surface (or never act),
  not because a status-seeded gate is going unexercised. That is evidence AGAINST
  building the fourth scenario right now: it would spend effort re-fingerprinting kits that are
  already fully expressed by `plain`/`richEnemy`/`wounded`, not on unlocking new coverage.
  Revisit if a future ship's kit is visibly enemy-status-gated and lands in this list.
- **A genuine engine-wide fix moves many snapshots at once** — unavoidable for any roster-wide
  guard, and the per-ship keying at least makes the affected set legible.
- **`__testTapActors` on a production type.** Test-only surface on `BattleSimulationInput`.
  Precedented but real; worth a comment on the field saying so.
- **Known coverage gaps (second fix wave, recorded rather than closed):**
  - **3 ships — Faust, Mender, Refine — have active patterns unreachable from the front-column
    focus anchor.** All three are `Pattern-Line-Support-Not-Self-Range-N`; Line-Support extends
    FORWARD from the caster, and `FOCUS_POSITION` (`M4`) sits at the front of its column, so the
    pattern resolves to zero cells and the active cannot fire in this fixture at all. Now guarded
    by a dedicated reachability test (`kitFingerprintScenarios.test.ts`'s "active pattern
    reachability from FOCUS_POSITION" describe block) with a named allow-list, asserted in both
    directions so it can't rot silently.
  - **`cleanse` / `purge` never fire.** Both need a debuff on the player side / a buff on the enemy
    side to remove, which the inert filler ships never apply — this needs the deliberately
    deferred status-seeding fourth scenario. ~21 corpus ships cleanse and ~15 purge: the single
    biggest remaining coverage hole.
  - **`detonation` is structurally unreachable in a focus-ship fingerprint.** `buildCombatLog` books
    that entry to the bomb's VICTIM, not the actor that detonated it, so it can only appear if the
    focus itself gets bombed — which needs a non-inert enemy that plants bombs.
  - **`death` / `cheat-death` need the focus to die**, which the survival invariant (the focus must
    stay alive all 20 rounds, or its fingerprint truncates) forbids by design. Unreachable by
    construction, not by tuning.
  - **Self-Shield / shield-destroyed gating is thin in the corpus.** Only 2 corpus kits gate on
    having their OWN Shield (APEX and Quixilver — the latter is exactly what PR #296 fixed), and 0
    corpus kits trigger a clause specifically on their shield being destroyed. That scarcity is why
    seeding a player-side shield was measured and rejected as metric inflation (see the "ships
    differing across scenarios" evidence above — it would move 5→131 via one uniform fixture-caused
    token, not real kit differentiation). Separately, the `shield-destroyed` LOG KIND itself is
    currently lit by exactly one ship (Malvex), via its on-damaged passive's reactive grant-then-
    deplete cycle, not via any gate on the condition.

## Open questions

None blocking. Deferred: whether to add a fourth scenario for gates none of the three satisfy,
which the non-vacuity output will inform once the suite runs.
