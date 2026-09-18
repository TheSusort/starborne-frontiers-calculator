# Autogear role-objective tuning (#544)

**Status:** design approved in conversation 2026-09-18. Builds on `feat/autogear-sim-rerank`
(PR #541, draft). #541 does not merge on its own.

## The problem

Autogear scores a ship with its role's formula. The formula is a cheap *proxy* for what the role
is trying to achieve. For most ships the proxy is faithful. For a minority it is not: the ship's
kit produces damage, repairs or shields from a stat the formula does not value, so autogear
confidently maximises the wrong thing and the player has no way to find out.

## The reframe that drives the design

**A selected role is the user declaring an objective, not selecting a scoring function.**

- ATTACKER — output the most damage
- SUPPORTER — output the most healing, shielding, or buff uptime
- DEFENDER — absorb the most of what would otherwise hit the team, while surviving
- DEBUFFER — keep debuffs on the enemy, and either deal damage or absorb it

The objective is measurable directly in the combat engine. The formula is only a guess at how to
reach it. So the tool must tune *toward the measured objective*, never toward the formula.

This also settles ships with several plausible roles. Xcellence as an ATTACKER wants hacking
**capped**; as a DEBUFFER he wants hacking **maximised**. Same ship, two declared goals, two
correct answers. Picking the goal is the player's; optimising within it is the tool's. PR #541
crossed that line by asking the engine which role a ship should be — a question the engine cannot
answer.

## Role → objective

| Role | Maximise | Subject to |
| --- | --- | --- |
| ATTACKER | focus `damageDealt` | win rate not worse |
| DEBUFFER | debuff uptime on enemies | plus `damageDealt` or `damageTaken`, per sub-role |
| SUPPORTER | `healingDone` + `shieldGranted`, or ally buff uptime | team survival |
| DEFENDER | share of team `damageTaken` absorbed | while `alive` |

The "subject to" column is load-bearing, not decoration. Every single-metric maximiser picks a
corner (the same failure as #482's ideal-piece plateau): maximise `damageDealt` alone and a build
that dumps everything in two rounds and dies scores best. The constraint is what stops the tool
recommending a glass cannon to someone who asked for an attacker.

**This corrects a defect already shipped in #541.** `metricTable.ts` carries
`METRIC_LOWER_IS_BETTER: { focusDamageTaken: true }` and `suggestedPrimary('DEFENDER')` returns
`focusDamageTaken`, so it currently rewards a defender for taking *less* damage. A defender that
takes zero damage is not tanking, it is being ignored. The metric is share-of-team-damage-taken,
maximised, gated on surviving.

## Measured evidence

Three spikes ran against the real engine and the real optimizer before this design was written.

### 1. The detector works over parsed abilities

A query over `buildShipAbilities(ship)` across the 150-ship corpus flagged **46 ships**, found all
ten the project owner named by hand, and produced zero build failures. The instrument was proven
live by asserting it observed 29 distinct ability config types.

It needs **three** carriers, not one:

- `{ type: 'additional-damage'; stat: 'hp'|'defense'|'shield'|'security'; pct }` — `abilities.ts:794`
- `{ type: 'heal'|'shield'; basis: 'hp'|'attack'|'defense'|… }` — `abilities.ts:909`
- `{ type: 'damage'; hpBasisPct?|shieldBasisPct? }` — `abilities.ts:746,751`, the REACTIVE path

The third is not optional. Without it Vindicator is invisible, and Xcellence is flagged for the
wrong reason — his shield-from-HP passive rather than his actual damage channel.

### 2. The gating stat is derivable from the ability's trigger

Exactly two ships in the corpus carry a gated channel, and each maps to a different gate:

| Trigger | Gate | Vary on the opponent |
| --- | --- | --- |
| `on-debuff-resisted` (this unit resists) | own security vs enemy hacking | hacking (Vindicator) |
| `on-own-` / `on-enemy-debuff-resisted` | own hacking vs enemy security | security (Xcellence) |
| ungated (`@on-cast`) | none | defence (mitigation) |

### 3. The answer depends on the opponent

Xcellence's hacking swept against three enemy security levels, focus damage, 12 seeds each:

```
hacking    sec 100    sec 300    sec 500
     60    163,243    163,243    163,243
    140    174,128    163,243    163,243
    220     96,779    163,243    163,243
    300     96,779    163,243    163,243
    450     96,779     96,779    163,243
```

Three opponents, three different answers, the third being "hacking is irrelevant here". A cap
measured only against soft enemies would be actively wrong against security 500.

**It is a threshold, not a slope.** Only two damage values exist: 163,243 (debuffs resisted, the
on-resist channel fires) and 96,779 (debuffs land, the channel is suppressed). Hacking does nothing
until it crosses the enemy's security, then the channel switches off entirely. The UI must present
a regime boundary, and the search grid must be fine enough to locate it — fitting a curve is the
wrong model. Counter-intuitively, **tougher enemies let a ship afford more hacking.**

### 4. Banding inside autogear holds, and pays

Five optimizer passes over a synthetic inventory, Xcellence as ATTACKER, hacking hard-banded:

```
unbanded   landed hacking 500  ->  130,755 damage    <- what autogear does today
0-150      landed hacking 140  ->  397,586 damage    <- 3.04x
150-300    landed hacking 300  ->  130,755
300-450    landed hacking 420  ->  130,755
450-700    landed hacking 540  ->  130,755
```

Every band held. Every point is a loadout buildable from the inventory, not a hypothetical stat
value. The gain over what the role formula picks unaided is **3.04x on the declared objective** —
larger than the 1.80x the raw-stat sweep suggested, because the optimizer, freed from hacking,
spends the budget elsewhere.

**A band can be unreachable, and the optimizer gives no signal when it is.** An earlier run of the
same spike asked for hacking in `0-150` against an inventory whose floor was 440; it silently
returned a 440 build. `compareIndividuals` ranks feasible over infeasible, so an escape means no
feasible individual existed at all. The feature must verify the landed value against the requested
band and report "not reachable with your inventory" rather than presenting the nearest build as if
it satisfied the request.

## Architecture

Flow: **detect → notify → (opt-in) tune → pick**.

1. **Detect** — static, free, always on. A notice in Autogear settings naming the stat and the
   formula that ignores it.
2. **Tune** — opt-in. A first unbanded pass establishes where the stat naturally lands under the
   role formula, and doubles as the baseline row. Two probe passes then bound the achievable
   range: one hard-banded `[0, 0]` and one `[huge, huge]`, each of which lands on the inventory's
   true floor and ceiling for that stat (an unreachable band lands at the nearest reachable
   value — the behaviour recorded under "Banding holds, and pays"). **Five** bands then divide
   `[floor, ceiling]` into equal parts. Five is the cost ceiling, not a tuning constant: at
   ~105,000 evaluations per pass, five bands plus baseline plus two probes is eight passes, which
   is already the largest optimizer spend in the app.
3. **Judge** — each resulting loadout is replayed through the engine against three sparring
   opponents, scored on the role's objective and its constraint. For a **gated** ship the three
   opponents vary the trigger-derived gating stat, which is what moves the threshold. For an
   **ungated** ship there is no threshold to move; the three opponents vary enemy defence
   instead, which changes mitigation and so can shift the best attack-versus-secondary split.
   The ungated case is the weaker justification for three opponents and should be the first
   thing dropped if the compute proves too costly in practice.
4. **Pick** — the player chooses a band. It is written as an ordinary `StatPriority` into the
   ship's config, editable by hand afterwards.

### New modules

- `simRerank/offFormulaStats.ts` — the detector. Three carriers above. Aggregate formula terms
  (`effectiveHp`, `directDamage`) do **not** count as rewarding their components: DEFENDER's
  `effectiveHp` lets a build trade defence for HP at no scoring cost, so a skill scaling off
  Defence specifically is still mis-scored. That rule is what makes Panon and Madax visible.
- `simRerank/roleObjectives.ts` — the role → objective table, with the constraint.
- `simRerank/objectiveMetrics.ts` — aggregation beyond `ActorTotals`, which carries only
  `damageDealt`/`damageTaken`/`healingDone`. `ShipRoundState` (`battleSimulator.ts:96-139`) already
  records `shieldGranted`, `shieldsAbsorbed`, `healingReceived`, `incomingBarrierAbsorbed`, `alive`,
  and per-round `activeBuffs[]` / `activeDebuffs[]`, so every objective is derivable with no engine
  change. This is an aggregation gap, not an engine gap.
- `simRerank/statBands.ts` — baseline pass, achievable-range probe, N banded configs, and the
  reachability check on the landed value.
- `simRerank/sparringOpponents.ts` — three boards differing only in the gating stat, built on
  #541's `practiceBoard.ts`.

### Reused from #541

`runShipOptimizer.findOptimalGearForShip`, `simRerank/candidateShip.ts`,
`simRerank/runCandidates.ts` (focus resolution by board position), and the paired-delta machinery
in `simulator/deltaStats.ts`.

## Constraints

- **Banding requires `GeneticStrategy`.** `hardRequirement` is read only by
  `calculateHardViolation` at `GeneticStrategy.ts:542,627`. Under TwoPass or SetFirst a band
  degrades to a soft penalty that scales the score by roughly the overshoot fraction, which will
  not hold a build inside a range. Genetic is already the Autogear page's default and is already
  the only strategy exposing `AutogearResult.candidates`.
- **N optimizer passes is the cost centre.** Simulation is cheap by comparison — a full sweep is
  a few hundred battles. Every pass is ~105,000 evaluations and feeds #543's usage undercount.
- **A sweep moves one stat while gear couples them.** The band mechanism avoids the worst of this
  by optimising real loadouts, but the UI must not present a band as a gearing target in isolation.
- **#541's stale-results defect** (results survive a change of role, fight source, seed, run count
  or equipped gear while the modal stays open; `Apply` then forwards a stale loadout) lands in
  whichever panel survives this work and must be fixed before merge.

## Testing

- Detector: a table test over the real corpus asserting the ten owner-named ships are found, and
  asserting the instrument observed a non-trivial number of config types — a zero flagged count
  with zero failures must fail the test, not pass it.
- Aggregate-term rule: a fixture with a DEFENDER whose damage scales off Defence must flag, proving
  the rule is not "is the stat in the formula".
- Reachability: a band below the inventory's floor must report unreachable, not return the floor
  build. The spike's own false pass is the regression case.
- Objective metrics: each role's maximand computed from a hand-built `ShipRoundState` sequence, and
  the defender row asserted to prefer MORE absorbed damage, pinning the inversion fix.
- Threshold location: a banded run over a gated ship must find the regime boundary at a different
  band per opponent, which fails if the sparring set collapses to one opponent.

## Open question, deferred

Whether the config proposal asks the player which content they are gearing for, or writes the
conservative cap and states its opponent range in the UI. The measurement supports either; the
threshold moves with enemy security, so a single unqualified number is the one option ruled out.
