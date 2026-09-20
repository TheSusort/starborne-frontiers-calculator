# Autogear off-formula scaling stats (#544)

**Status:** revised 2026-09-20, superseding the band-measurement design approved 2026-09-18.
Builds on `feat/autogear-sim-rerank` (PR #541, draft). #541 does not merge on its own.

**Why it was revised:** the measurement design searched for a *number* — a band on one stat,
found by running the optimizer five times and replaying each build through the engine. A band is
specific to the player's inventory and to the opponent it was measured against, so it has to be
recomputed for every user, at roughly a minute per optimizer pass. The parsed kit already carries
the *formula*: `additional-damage` records `{stat, pct}` and its sibling `damage` records
`{multiplier}`, in the same skill slot. A formula generalises — autogear solves it against
whatever gear the player owns — and it costs nothing to derive. The measurement machinery survives
only as an owner-side validation tool for the two ships whose answer is genuinely a threshold.

## The problem

Autogear scores a ship with its role's formula. The formula is a cheap *proxy* for what the role
is trying to achieve. For most ships the proxy is faithful. For a minority it is not: the ship's
kit produces damage, repairs or shields from a stat the formula does not value, so autogear
confidently maximises the wrong thing and the player has no way to find out.

The sharpest case is **Prophet**. His `damage` multiplier is literally `0` — he deals no
attack-scaled damage at all, and all of his output is `5000%` (active) / `12000%` (charged) of
Security. The ATTACKER formula is `core(directDamage)`, which is attack × crit. Autogear currently
gears him entirely around a stat his skills do not use.

## The reframe that drives the design

**A selected role is the user declaring an objective, not selecting a scoring function.**

- ATTACKER — output the most damage
- SUPPORTER — output the most healing, shielding, or buff uptime
- DEFENDER — absorb the most of what would otherwise hit the team, while surviving
- DEBUFFER — keep debuffs on the enemy, and either deal damage or absorb it

This is the statement of *intent* that justifies changing the scoring function. It is no longer a
set of metrics a simulator maximises — the design does not run a simulator at scoring time. It is
the reason a ship whose damage comes from Security should be scored on Security: the player asked
for damage, and Security is where this ship's damage comes from.

It also settles ships with several plausible roles. Xcellence as an ATTACKER wants hacking
**capped**; as a DEBUFFER he wants hacking **maximised**. Same ship, two declared goals, two
correct answers. Picking the goal is the player's; optimising within it is the tool's. PR #541
crossed that line by asking the engine which role a ship should be — a question the engine cannot
answer.

## The mechanism: a blended basis on a core row

A core formula row on a derived stat may carry a **basis**: the list of stats, with weights, that
feed the derived stat's primary factor.

```ts
// types/autogear.ts
interface CustomFormulaRow {
    stat: LimitableStat;
    kind: 'core' | 'bonus';
    direction: 'max' | 'min';
    importance?: CoreImportance;
    percentage?: number;
    /** Only meaningful on a `kind: 'core'`, `direction: 'max'` row naming a derived stat.
     *  Weights are in multiplier units divided by 100, so they are the game's own numbers:
     *  a 200% attack skill that also deals 25% of max HP is
     *  `[{ stat: 'attack', weight: 2.0 }, { stat: 'hp', weight: 0.25 }]`. */
    basis?: { stat: LimitableStat; weight: number }[];
}
```

`directDamage` becomes:

```
directDamage = (Σ basisᵢ.stat × basisᵢ.weight) × critMultiplier × (1 − DR(defensePenetration))
```

An **absent** basis resolves to `[{ attack, 1 }]`, which is byte-identical to today's
`calculateDirectDamage`. That is the regression pin.

A **derived** basis is not byte-identical and is not meant to be. For a single-term basis it is
*ranking*-identical, because core rows multiply and scaling one factor by a constant scales the
whole product — so APEX's derived `attack ×1.300` ranks exactly as today's `attack ×1.000` does.
The ranking only moves when a basis carries more than one term, which is the point.

**Substitution is the zero-attack case, not a separate mechanism.** Prophet is
`[{ security, 57.778 }]` with no attack term. Howler is `[{ attack, 1.067 }]` with no HP term.
This is why the shape is a basis *list* and not a scalar `k` blended against attack: computing
`k = pct / multiplier` divides by zero on Prophet.

### Scope of the change

- **`calculateDirectDamage` and `calculateEffectiveHP` take an optional basis** for their attack
  and HP factor respectively. `formulaRowTerm` already holds the row, so it passes the row's basis
  through `resolveLimitStatValue`.
- **`resolveLimitStatValue(stats, stat)` as used by `StatPriority` limits and `StatBonus` is
  UNCHANGED.** `directDamage` as a limit stat stays attack-only. A basis is a property of a
  formula row, not of the stat, and must not be threaded into the limit path.
- **Bases are restricted to `direction: 'max'` core rows.** A minimised term is `1/(1 + n)`,
  which is not scale-invariant, so a basis there would change ranking in ways nothing in this
  design reasons about. A basis on a `min` row or a `bonus` row is ignored.
- **`effectiveHp` basis semantics differ from `directDamage`.** `effectiveHp` is
  `hp × mitigation(defence)`, so a basis blends its **hp factor only** — a defence term in that
  basis is a deliberate *tilt* toward defence, not a transcription of a skill's equation, because
  defence already appears in the mitigation factor. `directDamage` bases are transcriptions;
  `effectiveHp` bases are tilts. The UI must not present them as the same thing.

## Deriving the basis from the parsed kit

### Cast-frequency weighting

Within one charge period a ship casts its active skill `p − 1` times and its charged skill once.
The basis is the weighted sum, `wActive = (p−1)/p` and `wCharged = 1/p`. Fight length drops out:
this is a ratio within the period, not a count over a fight.

`p` is a simulation of the engine's own cadence (`advanceChargeCadence` in `combat/state.ts`
resets to 0 at the cap and otherwise adds 1 per own turn; bonus charge abilities are added in
`playerTurn.ts` on active rounds only, capped at `chargeCount`):

```
N = ship.chargeSkillCharge
g = Σ amount of own-targeted `type: 'charge'` abilities in the ACTIVE and PASSIVE slots
    (the charged slot is excluded — charges accrue on active rounds only, which is why
     Sefuba's `[charged] enemy+2` correctly contributes nothing)
    own-targeted = target is not ally / all-allies / lowest-hp-ally / enemy / all-enemies

if N <= 0 or the ship has no charged skill:  wActive = 1, wCharged = 0
else:
    c = 0
    for t in 1..50:
        if c >= N:  p = t; break
        c = min(c + 1 + g, N)
```

Measured `p` across the flagged corpus runs 2 to 9. This pseudocode duplicates engine behaviour,
so it is pinned by a test against the engine's actual cast sequence rather than trusted — see
Testing.

### Weights

For each of the active and charged slots:

- `attack` weight = Σ `damage.multiplier × (damage.hits ?? 1)`, excluding reactive
  `hpBasisPct` / `shieldBasisPct` configs
- each other stat's weight = Σ `additional-damage.pct` for that stat, plus
  `heal`/`shield`.`pct` where `basis` is a caster stat (`hp`, `attack`, `defense`)

then weight the two slots by `wActive` / `wCharged` and divide by 100.

**No flagged ship currently carries `hits > 1`**, so whether an `additional-damage` clause
repeats per hit has never arisen. A data refresh could introduce one; the test suite carries a
tripwire so it surfaces as a failure rather than a silent halving. If it fires, it is a
game-behaviour question for the owner, not an inference.

### Damage basis and repair basis are separate

A ship's damage basis and its repair/shield basis need not agree. Four defenders (Cinya, Isha,
Madax, Morao) scale damage off Defence and repairs off HP. The basis therefore attaches to the
derived stat on its row — `directDamage` takes the damage basis, a repair-oriented core takes the
heal basis — never to the ship as a whole.

### The shield chain is a coefficient product

Several ships deal damage as a percentage of their own **shield pool**, and `shield` is not a stat
gear rolls. The lever is the stat that *produces* the shield, and the weight is the **product** of
the two percentages:

| Ship | damage from shield | shield from HP | Chain | Producing slot |
| --- | --- | --- | --- | --- |
| FrontLine | ×0.750 | 25% | hp ×0.188 | passive (`pre-combat`) |
| Xcellence | ×1.150 | 20% | hp ×0.230 | passive (`start-of-turn`) |
| Malvex | ×0.073 | 15% | hp ×0.011 | active (`on-cast`) |
| Quixilver | ×0.148 | — | **none** | shield is damage-dealt/taken only |

The detector already redirects the lever *name* through this chain; it drops the number. The basis
derivation needs both factors. The slot-source rule below applies to **each** factor independently:
FrontLine's only HP-based shield source is a `pre-combat` passive, so with passives excluded he
derives no HP term at all.

The HP coefficient is a **floor**, not the whole pool: shield gear and shield sets add to the pool
independently of max HP.

Quixilver's shield comes from damage dealt and damage taken, with no stat basis anywhere. He is
correctly reported with a finding and no lever, and this design does not solve him.

### Passive slots are excluded

Only the active and charged slots contribute to a derived basis. A passive fires on a trigger
whose frequency is not derivable from static data — `on-enemy-destroyed`, `on-ally-crit-dot`,
`on-corrosion-spread`, `on-debuff-inflicted` all depend on how the fight goes.

Some passive triggers *do* have a knowable cadence (`pre-combat` fires once per fight,
`start-of-turn` every turn), but including only those would make the rule "some passives count"
and the UI would have to explain which. The decision is the simpler rule plus an editable basis:
**the derived basis is a starting point the player can edit**, and the UI states plainly that
passive skills are not counted.

**This is not a rounding error, and the spec records the cost.** Ten of the twenty-two ships with
a derivable carrier have that carrier entirely in a passive slot, so they ship a basis identical
to today's behaviour and the fix depends on the player editing it:

APEX, Crocus, Crucialis, FrontLine, Hemlock, IonScorp, LUXX, Rikra, Sefuba, Xcellence.

### Derived bases (measured against the real corpus, 2026-09-20)

| Ship | N | g | p | active/charged | Derived basis |
| --- | --- | --- | --- | --- | --- |
| Chakara | 2 | 1 | 2 | 0.50 / 0.50 | attack ×2.000 + defence ×0.900 |
| Obsidian | 3 | 2 | 2 | 0.50 / 0.50 | attack ×2.250 + hp ×0.200 |
| Cobalt | 3 | 1 | 3 | 0.67 / 0.33 | attack ×2.100 + hp ×0.267 |
| Nuqtu | 4 | 2 | 3 | 0.67 / 0.33 | attack ×1.600 + defence ×0.800 |
| Selenite | 4 | 1 | 3 | 0.67 / 0.33 | attack ×2.333 + hp ×0.125 |
| Nayra | 2 | 0 | 3 | 0.67 / 0.33 | attack ×1.833 + defence ×0.300 |
| Bayah | 2 | 0 | 3 | 0.67 / 0.33 | attack ×1.300 + defence ×0.233 |
| Lodolite | 3 | 0 | 4 | 0.75 / 0.25 | attack ×2.575 + hp ×0.100 |
| Prophet | 8 | 0 | 9 | 0.89 / 0.11 | **security ×57.778**, no attack |
| Howler | 2 | 0 | 3 | 0.67 / 0.33 | attack ×1.067 (repair basis), no hp |
| Makoli | 2 | 0 | 3 | 0.67 / 0.33 | defence ×1.067 + hp ×0.057 (repair basis) |
| Graphite | 3 | 0 | 4 | 0.75 / 0.25 | attack ×1.350 (shield basis) |

Makoli is the clearest read: his repairs are `0.057 × hp + 1.067 × defence`, which at geared
values is roughly 2,800 against 7,500 — Defence drives his output three to one, and the SUPPORTER
formula (`core(hp)`) gives it zero weight.

## Detection stays as shipped

`detectOffFormulaStats` (Stage 1, already on the branch and verified in the browser) is unchanged.
It walks `buildShipAbilities(ship).slots[].abilities[].config` over three carriers:

- `{ type: 'additional-damage'; stat: 'hp'|'defense'|'shield'|'security'; pct }` — `abilities.ts:794`
- `{ type: 'heal'|'shield'; basis: 'hp'|'attack'|'defense'|… }` — `abilities.ts:909`
- `{ type: 'damage'; hpBasisPct?|shieldBasisPct? }` — `abilities.ts:746,751`, the REACTIVE path

The third is not optional. Without it Vindicator is invisible and Xcellence is flagged for the
wrong reason — his shield-from-HP passive rather than his actual damage channel.

**Aggregate formula terms do not count as rewarding their components.** DEFENDER's `effectiveHp`
lets a build trade defence for HP at no scoring cost, so a skill scaling off Defence specifically
is still mis-scored. That rule is what makes Panon and Madax visible, and it is why those findings
are classified `substitution` rather than `severe`.

Corpus result: **47 ships flagged**, all ten the owner named by hand among them, zero build
failures.

### What clears a notice

Applying a derived formula sets `shipRole: null` (Custom mode), and `detectOffFormulaStats`
returns `[]` when `configuredRole` is null. So a notice clears through the existing short-circuit,
without the detector reading the basis at all. **This is accepted deliberately**: a player who
switches to a hand-written Custom formula that ignores the stat also sees no notice, which is
correct — Custom mode means the player wrote the scoring function and there is no declared role to
diverge from.

## What this design does not solve

- **Quixilver** — no stat basis anywhere in his kit. Notice with no lever.
- **Xcellence and Vindicator** — the two gated ships. Their off-stat channel switches on or off at
  a threshold against the opponent's Security or Hacking, so the answer is not a fraction and a
  basis cannot express it. Measured evidence below.

## Measured evidence

Three spikes ran against the real engine and the real optimizer. The first two still bind; the
third is what rules Xcellence out of the basis mechanism.

### 1. The detector works over parsed abilities

A query over `buildShipAbilities(ship)` across the 150-ship corpus flagged 47 ships, found all ten
the owner named by hand, and produced zero build failures. The instrument was proven live by
asserting it observed 29 distinct ability config types — a zero flagged count with zero failures
must fail the test, not pass it.

### 2. The gating stat is derivable from the ability's trigger

Exactly two ships in the corpus carry a gated channel, and each maps to a different gate:

| Trigger | Gate | Vary on the opponent |
| --- | --- | --- |
| `on-debuff-resisted` (this unit resists) | own security vs enemy hacking | hacking (Vindicator) |
| `on-own-` / `on-enemy-debuff-resisted` | own hacking vs enemy security | security (Xcellence) |
| ungated (`@on-cast`) | none | defence (mitigation) |

### 3. For a gated ship the answer is a threshold, and it moves with the opponent

Xcellence's hacking swept against three enemy security levels, focus damage, 12 seeds each:

```
hacking    sec 100    sec 300    sec 500
     60    163,243    163,243    163,243
    140    174,128    163,243    163,243
    220     96,779    163,243    163,243
    300     96,779    163,243    163,243
    450     96,779     96,779    163,243
```

Only two damage values exist: 163,243 (debuffs resisted, the on-resist channel fires) and 96,779
(debuffs land, the channel is suppressed). Hacking does nothing until it crosses the enemy's
security, then the channel switches off entirely. Counter-intuitively, **tougher enemies let a
ship afford more hacking.**

A weighted basis is a linear blend and cannot express a regime boundary, which is why these two
ships are out of scope here. A cap on Hacking is the right shape for Xcellence, and finding where
to put it needs a measurement against a stated opponent — owner-side work, not a per-user run.

## Architecture

Flow: **detect → derive → show → apply → share**.

1. **Detect** — static, free, always on. The notice shipped in Stage 1.
2. **Derive** — static, free. The basis, from the parsed kit, by the rules above.
3. **Show** — the notice gains the derived basis in readable form ("Prophet's damage is 57.8×
   Security and nothing from Attack"), stating that passive skills are not counted.
4. **Apply** — writes a `customFormula` seeded from the ship's role with the basis attached to its
   core row, and sets `shipRole: null`. Ordinary config afterwards, editable by hand.
5. **Share** — `SharedAutogearBuild` carries the formula so the config is shareable.

### Modules

- `simRerank/offFormulaStats.ts` — the detector. Unchanged, except that the shield chain must
  carry the producing percentage alongside the lever stat.
- `simRerank/basisDerivation.ts` — new. `p` from `chargeSkillCharge` and charge abilities; the
  weighted basis; the shield-chain product; the passive exclusion.
- `autogear/statResolution.ts` — `calculateDirectDamage` / `calculateEffectiveHP` accept an
  optional basis.
- `autogear/customFormula.ts` — `formulaRowTerm` passes the row's basis through; `isUsableRow`
  gains basis validation.
- `types/communityRecommendation.ts` — `SharedAutogearBuild` gains `customFormula` and a nullable
  `shipRole`, with the `version` bump the interface already anticipates.

### Retired from the previous design

`simRerank/statBands.ts`, `simRerank/statBounds.ts`, `simRerank/sparringOpponents.ts`,
`hooks/useOffFormulaTuning.ts` and `components/autogear/OffFormulaTuningPanel.tsx` are **unmounted
from `AutogearSettings`**. The modules are retained on the branch as the owner-side validation
tool for the two gated ships, not deleted — they are the only way to locate a threshold, and
deleting them would mean rebuilding that machinery when Xcellence is addressed. Nothing user-facing
mounts them.

`simRerank/roleObjectives.ts` and `simRerank/objectiveMetrics.ts` are retained for the same reason.
The `metricTable.ts` DEFENDER fix (`focusDamageTaken` → `winRate`; an ignored defender is not
tanking) is already committed on the branch and stands.

## Persisted-input validation

A stored formula row is untyped JSON and reaches the scorer without passing through any form. The
`basis` field inherits the rule already stated in `customFormula.ts` ("a row's own types gate
authoring, not input") and in `[[reference_total_record_is_compile_time_only]]`:

- a basis entry whose `stat` has no `MULTIPLIER_NORMALIZERS` value is skipped
- a basis entry whose `weight` is non-finite, negative, or absent is skipped
- a basis that ends up empty falls back to the derived stat's default factor, not to zero
- a basis on a `bonus` row, or on a `direction: 'min'` row, is ignored

A basis every one of whose stats is 0 at base would zero the whole core product, the same failure
`customFormulaSeeds.test.ts` already guards for seed rows. Prophet's Security and Howler's Attack
are both nonzero at base, but the invariant is asserted rather than assumed.

## Stages

Stage 1 shipped and was verified in the browser; it is unchanged by this revision.

- **Stage 2** — derive the basis, surface it in the notice, apply it into `customFormula`.
  Ends with the owner exercising it as a real user on Prophet, Makoli and Cobalt.
- **Stage 3** — extend `SharedAutogearBuild`, update `DocumentationPage`, and fix #541's
  stale-results defect (results survive a change of role, fight source, seed, run count or
  equipped gear while the modal stays open; `Apply` then forwards a stale loadout). That defect
  lands in whichever panel survives and must be fixed before merge.

Execution pauses at each stage boundary for the owner to test.

## Testing

- **Regression pin:** a row with no basis resolves identically to today's
  `calculateDirectDamage` / `calculateEffectiveHP`, byte for byte.
- **Cadence tripwire:** derived `p` matches the engine's actual cast sequence for ships spanning
  the N/g range — Chakara (2/1), Nuqtu (4/2), Hemlock (6/1), Prophet (8/0). This test is what
  makes the pseudocode above safe to read; without it the duplication is a comment where a test
  belongs.
- **Derived bases pinned** for the table above, covering each shape: a two-term blend (Cobalt),
  a zero-attack substitution (Prophet), a repair basis whose ratio inverts the role formula
  (Makoli), a shield chain (FrontLine), and no lever at all (Quixilver).
- **Multi-hit tripwire:** asserts no flagged ship carries `hits > 1` on a slot that also carries
  an `additional-damage` clause. It fails on the data refresh that introduces one, which is when
  the per-hit question must be asked.
- **Aggregate-term rule:** a fixture with a DEFENDER whose damage scales off Defence must flag,
  proving the rule is not "is the stat in the formula".
- **Corrupt persisted basis** is skipped, not scored — one case per bullet in the validation
  section.
- **The 47-ship detector table test stays**, including its instrument check.

## Open questions for the owner

1. **Should the notice fire on `severe` findings only?** 24 of the 47 are DEFENDER
   `substitution` — the finding is only that `effectiveHp` lets the optimizer trade HP for Defence
   at no scoring cost. If half the defenders in the game carry a banner, players stop reading
   banners. Restricting to `severe` leaves 23 ships, each a real mis-scoring. Not resolved.
2. **Whether the derived basis should be shown for the ten passive-only ships at all**, given it
   is identical to today's behaviour for them. Showing it invites the edit; hiding it avoids
   implying a fix that is not there.
