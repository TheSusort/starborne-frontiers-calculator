# Autogear off-formula scaling stats (#544)

**Status:** revised 2026-09-21. Supersedes the 2026-09-20 revision (custom-formula Apply), which
superseded the 2026-09-18 original (banded measurement). Branch `feat/autogear-sim-rerank`
(PR #541, draft). #541 does not merge on its own.

**Implemented and keeping:** detection, the notice, the derivation, the basis editor.
**Changing:** what Apply writes, and what the notice says for a role that cannot use the equation.

## The problem

Autogear scores a ship with its role's formula. For 47 of 150 ships the kit produces damage,
repairs or shields from a stat that formula does not value, so autogear confidently maximises the
wrong thing and the player cannot find out.

The sharpest case is **Prophet**. His `damage` multiplier is literally `0` — all his output is
`5000%` (active) / `12000%` (charged) of Security. The ATTACKER formula is attack x crit, so
autogear gears him entirely around a stat his skills never read.

## The reframe that drives the design

**A selected role is the player declaring an objective, not selecting a scoring function.** The
formula is a proxy for that objective. Where a ship's kit reaches the objective through a stat the
proxy ignores, the proxy is what should move — not the player's declared goal.

## How we got here — two pivots, both forced by measurement

Recorded because each was a plausible design that measurement killed, and a future reader will
otherwise re-propose them.

**Pivot 1 — a band is not the answer.** The original design searched for a *number*: five optimizer
passes plus an engine replay per ship, per user, at roughly a minute a pass. A band is specific to
the inventory it was measured against and the opponent it was scored against, so it cannot be
shared or reused. The parsed kit already carries the *formula* — `additional-damage` records
`{stat, pct}` and its sibling `damage` records `{multiplier}` in the same slot — so the blend is a
transcription, not a search.

**Pivot 2 — a seeded custom formula is a lossy copy of its role.** Apply used to convert the ship
to Custom mode with a formula seeded from its role. But `CUSTOM_FORMULA_SEEDS` is an approximation
for every role outside `EXACT_SEED_ROLES`, and the approximation is not small. The real SUPPORTER
formula multiplies — `hp x 0.15 x critMultiplier x (1 + healModifier/100)` — while the seed adds
crit, crit power and heal modifier as separate bonus rows. Measured against the real scorer at
50,000 hp / 40 crit / 120 crit power / 20 heal modifier:

| gear delta | real SUPPORTER | seeded copy | error |
| --- | --- | --- | --- |
| +10,000 HP | x1.2000 | x1.2000 | exact |
| +20 heal modifier | x1.1667 | x1.2803 | +68% |
| +30 crit | x1.2432 | x1.0788 | **-68%** |
| +60 crit power | x1.1622 | x1.0970 | -40% |
| both crit stats | **x1.5270** | x1.1759 | **-67%** |

A crit piece genuinely worth 53% reads as 18%. Apply traded a correct basis for a broken formula,
and the owner observed exactly that: worse autogear results after applying.

Writing exact seeds is not the way out. The seeds' own fidelity notes record that some roles are
not expressible in the bonus-row DSL at all — `DEBUFFER_DEFENSIVE_SECURITY` says outright that
"a product cannot express" it.

## The mechanism: a basis on the ROLE, not on a copy of it

The ship keeps its role. `SavedAutogearConfig` gains a `roleBasis`, and each role scorer resolves
its primary quantity through that basis instead of reading one stat:

```ts
// calculateHealerScore today
const baseHealing = (stats.hp || 0) * BASE_HEAL_PERCENT;
// with a role basis
const baseHealing = resolveBasisValue(stats, roleBasis, 'hp') * BASE_HEAL_PERCENT;
```

Everything downstream — crit, heal modifier, stat bonuses, set logic — stays the real role formula.
An absent `roleBasis` is byte-identical to today.

`resolveBasisValue` and `BasisTerm` already exist and are unchanged. Weights are in multiplier
units divided by 100, rounded to 0.001 — the precision the editor displays and its input accepts.

### Why this beats what it replaces

- **Lossless.** No seed approximation anywhere in the path.
- **`shipRole` stays set**, so the nullable-role plumbing, `seededFrom` mirroring and the
  `ship_role NOT NULL` workaround stop being load-bearing.
- **The hosting question answers itself.** The role IS the declared objective.

## Which roles host which basis

Measured from the scorers in `priorityScore.ts`, not assumed:

| Role | Primary quantity | Basis replaces | Axis |
| --- | --- | --- | --- |
| ATTACKER | `calculateDPS` — attack x crit x (1-DR) | attack | damage |
| DEBUFFER | hacking x directDamage | attack | damage |
| DEBUFFER_BOMBER | hacking x attack | attack | damage |
| SUPPORTER | hp x 0.15 x crit x healMod | hp | healing |
| SUPPORTER_SHIELD | hp | hp | shield |
| DEFENDER | survival rounds from `effectiveHp` | — | survival, **no basis** |
| DEFENDER_SECURITY | defender x security | — | survival, **no basis** |
| DEBUFFER_DEFENSIVE(_SECURITY) | hacking x effectiveHp | — | survival, **no basis** |
| DEBUFFER_CORROSION | hacking, plus Decimation sets | — | **no output proxy** |
| SUPPORTER_BUFFER | speed + effectiveHp | — | **no output proxy** |
| SUPPORTER_OFFENSIVE | speed + sqrt(attack) | — | see open question 2 |

**A role hosts a derived basis when the role's axis matches the basis's `produces`.** Cobalt
(ATTACKER, damage) hosts; Makoli and Howler (SUPPORTER, repair) host; Prophet (ATTACKER, damage)
hosts. Panon (DEFENDER, damage) does not.

**The survival roles take no basis, deliberately.** `calculateDefenderScore` models rounds survived
— it is not a single scalable quantity, and a defence term inside its HP factor would count defence
twice, since defence already drives the mitigation curve.

## The Defender ruling

A Defender's kit damage is **incidental**. You gear Panon for Defence because he tanks; the extra
damage follows from Defence you already wanted. It is not something to gear *toward*.

So for a DEFENDER-family ship the notice must NOT print a damage equation. Today it prints
"Attack x2.275 + Defence x1.775", which invites gearing for Attack — a stat a Defender never wants
— and then tells the player to add that equation to a custom formula by hand, which is the same
mistake performed manually. Two of its three lines are actively harmful; only the finding earns
its place.

### The Defender tilt — BUILT, MEASURED INERT, DROPPED 2026-09-21

Recorded in full because it is a plausible idea that measurement killed, and a future reader will
otherwise re-propose it.

The reasoning was sound: among builds of equal survival, Panon should prefer the one with more
Defence, because he converts it to damage for free, and `effectiveHp` treats HP and Defence as
interchangeable through the mitigation curve so nothing expresses that preference. It was built as
a `StatBonus` rather than a basis — a basis redefines what survival *is*, a bonus is a preference
inside it — on existing plumbing, with no new concept.

**It never changed a single gearing decision.** Swept over 7,031 realistic HP-piece-versus-
Defence-piece comparisons on a Defender: zero winner changes. The tilt's effect on a build is
1.78e-2% while the closest pair's survival gap is 1.05e-3%, leaving it roughly 2.3x too weak to
overturn any real comparison.

**And that was forced by the sizing rule, not by a bad constant.** The rule said the tilt must
lose to any survival gap at or above the smallest gap a realistic gear swap produces. Every real
comparison sits at or above that floor by definition, so the rule guarantees inertness. "Among
builds of *equal* survival" has no realistic referent: with discrete gear, builds are near-equal,
never equal, and a nudge that only breaks exact ties breaks nothing.

**Owner decision: dropped.** Players can express the preference themselves with the existing
generic stat-bonus control, choosing their own magnitude. DEFENDER-family ships keep the finding,
and still get no equation and no Apply.

**If this is ever revisited**, the floor has to come from what the owner considers a *meaningful*
survival difference, not from the smallest representable one — or the mechanism has to be a real
comparator tiebreak rather than a score nudge.

## What Stage 3 drops

The nullable-role work existed to let a Custom-mode config be shared. With `shipRole` always set:

- `SharedAutogearBuild.shipRole` can return to non-nullable.
- `mirroredShipRole` and the `seededFrom` fallback are unnecessary for the Apply path.
- The `ship_role NOT NULL` write-path guard stays correct but is no longer reachable from Apply.
- `SharedAutogearBuild` instead carries `roleBasis` alongside the existing `statBonuses`.

**Keep:** the `version` discriminated union and its v1 migration, basis-term validation at import,
and the payload caps with their corpus tripwire.

## What stays exactly as shipped

- **Detection** (`offFormulaStats.ts`) — three carriers, the aggregate-term rule, 47 ships.
- **The derivation** (`basisDerivation.ts`) — charge-period weighting, the shield-chain coefficient
  product, passive exclusion, `TRIGGER_PROSE`, 0.001 rounding.
- **The notice**, minus the equation line for non-hosting roles.
- **The basis editor** in `CustomFormulaForm` / `CustomFormulaRow`, for hand-authored formulas.
- **The retained band modules**, unmounted, for the two gated ships.
- **The #541 stale-results fix.**

## Measured evidence (carried forward, still binding)

### The detector works over parsed abilities

A query over `buildShipAbilities(ship)` across the 150-ship corpus flags **47 ships**, finds all
ten the owner named by hand, and produces zero build failures. The instrument is proven live by
asserting it observed 29 distinct ability config types — a zero flagged count with zero failures
must fail the test, not pass it.

Three carriers are required, not one:

- `{ type: 'additional-damage'; stat; pct }` — `abilities.ts:794`
- `{ type: 'heal'|'shield'; basis }` — `abilities.ts:909`
- `{ type: 'damage'; hpBasisPct?|shieldBasisPct? }` — `abilities.ts:746,751`, REACTIVE path only

Without the third, Vindicator is invisible and Xcellence is flagged for the wrong reason.

**Aggregate formula terms do not count as rewarding their components.** DEFENDER's `effectiveHp`
lets a build trade defence for HP at no scoring cost, so a skill scaling off Defence specifically
is still mis-scored. That rule is what makes Panon and Madax visible.

### Derived bases (measured 2026-09-20, weights pre-rounding)

| Ship | N | g | p | active/charged | Derived basis |
| --- | --- | --- | --- | --- | --- |
| Chakara | 2 | 1 | 2 | 0.50 / 0.50 | attack x2.000 + defence x0.900 |
| Obsidian | 3 | 2 | 2 | 0.50 / 0.50 | attack x2.250 + hp x0.200 |
| Cobalt | 3 | 1 | 3 | 0.67 / 0.33 | attack x2.100 + hp x0.267 |
| Nuqtu | 4 | 2 | 3 | 0.67 / 0.33 | attack x1.600 + defence x0.800 |
| Selenite | 4 | 1 | 3 | 0.67 / 0.33 | attack x2.333 + hp x0.125 |
| Lodolite | 3 | 0 | 4 | 0.75 / 0.25 | attack x2.575 + hp x0.100 |
| Prophet | 8 | 0 | 9 | 0.89 / 0.11 | **security x57.778**, no attack |
| Howler | 2 | 0 | 3 | 0.67 / 0.33 | attack x1.067 (repair), no hp |
| Makoli | 2 | 0 | 3 | 0.67 / 0.33 | defence x1.067 + hp x0.057 (repair) |
| Graphite | 3 | 0 | 4 | 0.75 / 0.25 | attack x1.350 (shield) |

### For a gated ship the answer is a threshold, and it moves with the opponent

Xcellence's hacking swept against three enemy security levels, focus damage, 12 seeds each:

```
hacking    sec 100    sec 300    sec 500
     60    163,243    163,243    163,243
    140    174,128    163,243    163,243
    220     96,779    163,243    163,243
    300     96,779    163,243    163,243
    450     96,779     96,779    163,243
```

Only two damage values exist: the on-resist channel firing, or suppressed. Hacking does nothing
until it crosses the enemy's security, then the channel switches off entirely. A weighted basis is
a linear blend and cannot express a regime boundary, which is why these two ships are out of scope.
Counter-intuitively, tougher enemies let a ship afford more hacking.

## Out of scope, unchanged

- **Quixilver** — no stat basis anywhere in his kit. Notice, no lever.
- **Xcellence and Vindicator** — gated, per the sweep above. The retained band modules are the
  owner-side tool for locating those thresholds.

## Testing

- **Regression pin:** an absent `roleBasis` scores byte-identically to today, for every role.
- **Losslessness — the point of the pivot:** for a hosting ship, applying a `roleBasis` must leave
  every non-primary stat's marginal value unchanged. The crit / heal-modifier table above is the
  regression case: `+30 crit` must stay x1.2432, not drift toward the seed's x1.0788.
- **Hosting invariant**, over the real corpus x all 12 roles: Apply is offered only where the
  role's axis matches the basis's `produces`. Must fail on Panon/DEFENDER if the rule regresses.
  Carry a non-vacuity counter — the equivalent test previously passed over a walk that could not
  reach the failing case.
- **No damage equation renders for a DEFENDER-family role**, and the tilt control does.
- **Derived weights stay step-aligned and non-zero** (shipped, keep).
- **The 47-ship detector table test** (shipped, keep).

## Open questions

1. **The tilt's magnitude — CLOSED 2026-09-21: the tilt itself was dropped.** Built, measured
   inert (zero winner changes over 7,031 realistic comparisons), and removed on the owner's
   decision. See "The Defender tilt" above for why the sizing rule guaranteed that outcome.
2. **`SUPPORTER_OFFENSIVE` — ANSWERED 2026-09-21: it hosts NOTHING.** The sqrt compresses a basis
   in a way no other role's does and no measurement backs what that does to rankings. No ship
   defaults to the role, so nothing is lost; 26 flagged ships would produce damage if a player
   chose it, and they get the finding with no Apply. It joins the survival roles in the no-host
   set. Adding it later is a one-line table change.
3. **Whether a hand-authored Custom formula stays shareable.** It is currently reachable and
   supported. Keeping it costs the nullable-role schema branch Apply no longer needs.
4. **Whether the notice should fire for DEFENDER-family substitution findings** once the equation
   line is gone. What remains is the finding plus the tilt offer, which is useful — but it is 24 of
   the 47 ships, and the owner has already ruled once that all 47 keep their notice.
