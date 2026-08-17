# Task 2b report — a `damage-dealt` standing leech pays out on positional DoT ticks

**Status: DONE.** The in-scope half (`leechScope:'all'` missing DoT ticks) is fixed and fenced on
both sides; the out-of-scope half (`leechScope:'detonation'`) is tripwired, not fixed.

Branch `feat/sp4b2b-enemy-roster-required`, base commit for this task `7274beff`; epic-step base for
all "pre-change" measurements `39d463f1` (SP-4b-2a, PR #325).

---

## 1. Step 2 — the red state, verbatim

Test file written first: `src/utils/combat/__tests__/positionalDotLeech.test.ts`.

```
$ npx vitest run src/utils/combat/__tests__/positionalDotLeech.test.ts

 × PLAYER side: the focus’s standing leech pays out on its corrosion ticking a positioned enemy 10ms
   → expected +0 to be close to 100, received difference is 100, but expected 5e-7
 × ENEMY side (team symmetry): an enemy’s standing leech pays out on its corrosion ticking a positioned player ally 3ms
   → expected +0 to be close to 100, received difference is 100, but expected 5e-7
 ✓ CONTROL (the working path — must pass before AND after the fix): the same leech pays out on positional DIRECT damage 1ms
 ✓ a detonation-scoped leech stays inert on a DoT tick (the DoT channel is not the detonation channel) 2ms
 ✓ KNOWN GAP (tripwire): a positioned enemy’s timed bomb bursts, and the focus’s detonation-scoped leech still credits 0 1ms

 Test Files  1 failed (1)
      Tests  2 failed | 3 passed (5)
```

Exactly the shape the brief predicted:

- **The `'all'` case FAILS with a zero leech payout** — `expected +0 to be close to 100`, on both
  sides. The gate held: the defect is where the task says it is.
- **The `direct` control PASSES** before the fix (and after — see §6).

The failing assertions are not vacuous. Both cases assert, before the leech assertion, that the DoT
tick *really landed*:

```ts
expect(result.rounds[0].perTargetDamage?.['enemy-back']).toBe(500);
expect(dealtBy(result.rounds, 'attacker')).toBe(500);
```

`dealtBy` comes from the shared `src/utils/combat/__testutils__/perTargetDealt.ts` helper (per the
brief's note 4 — `perTargetDealt`, not `deaths`, is the routing discriminator). Both were green in the
red state, so `0 !== 100` was the leech failing to read a real 500-damage tick, not the DoT failing to
tick. The focus runs at `attack: 0` in the DoT fixtures, so `dealtBy(...) === 500` *exactly* also
proves no direct-channel leech contribution is hiding inside the figure.

After the fix, all 5 pass:

```
 ✓ PLAYER side … 8ms
 ✓ ENEMY side (team symmetry) … 2ms
 ✓ CONTROL (the working path …) … 1ms
 ✓ a detonation-scoped leech stays inert on a DoT tick … 2ms
 ✓ KNOWN GAP (tripwire) … 1ms
 Test Files  1 passed (1)
      Tests  5 passed (5)
```

---

## 2. What I found on each path

A standing `basis:'damage-dealt'` leech (`standingLeeches`, built at `engine.ts:3432-3452` from
**both** runtime maps via `allRuntimesById`) is procced from exactly **two** places in the engine:

| proc | resolves owner via | recipients | reached from |
|---|---|---|---|
| `procStandingLeeches` (`engine.ts:3770`) | `runtimesById` — **player-side only** | player-only (`healTarget!.id`, `healingCtx.playerIds`) | `creditDamage` (`:4122-4124`) — the NON-positional aggregate channel |
| `procStandingLeechesPerVictim` (`engine.ts:3841`) | `allRuntimesById` — **both sides** | side-relative (`ownerIsEnemy ? enemyIds : playerIds`), explicit `recipientActor` | `procLeechesForVictim` (`:3983`) — the positional per-victim channel |

### Player path

- **Direct damage — WORKS.** `procLeechesForVictim` is called at the focus cast site
  (`engine.ts:9048`) and the walked-team cast site (`:9327`), each per resolved footprint victim.
- **DoT tick — WAS BROKEN.** The positional per-victim DoT-tick branch's `credit` callback
  (`engine.ts:8753-8772` pre-fix) accumulated into `total`, `tickDealtBySource` and `perActorDot`
  and stopped there. Neither proc ran. The *non-positional* dummy branch by contrast does
  `credit: (sourceId, dotType, damage) => creditDamage(sourceId, dotType, damage)`
  (`engine.ts:9466-9467`), and `procStandingLeeches` pays a `scope:'all'` leech on any channel
  (`if (e.scope === 'detonation' && channel !== 'detonation') continue;`, `:3777`) — so the payout
  existed against the dummy and vanished the moment the victim was a real positioned enemy.
- **Heal-target tick — a separate, PRE-EXISTING, out-of-scope gap** (see §7).

### Enemy path

- **Direct damage — WORKS, and already symmetric.** The enemy cast site also calls
  `procLeechesForVictim` (`engine.ts:10131`). That unification is deliberate and documented at
  `:3970-3982` ("the enemy site procced only the taken direction and the two player sites only the
  standing one, so each side ran just one of its two passive leeches").
- **DoT tick — WAS BROKEN, identically.** The per-victim DoT-tick branch is a **single shared
  branch** for both sides: it computes `const sideIsPlayer = actor.side === 'player'` and
  `const opposing = sideIsPlayer ? enemyAttackerActors : allPlayerActors` (`engine.ts:8720-8721`),
  and the same `credit` callback serves both. So the miss was symmetric, and so is the repair.
- I checked for the historical asymmetry class explicitly. **No player-only map or recipient
  branch is involved in this fix**: `standingLeeches` is populated from `allRuntimesById` (both
  sides) and the proc I route to resolves through `allRuntimesById` with side-relative recipients.
  Had I instead routed to `procStandingLeeches`, the fix would have been **one-directional** — it
  resolves the owner from the player-only `runtimesById`, so an enemy DoT applier would have gotten
  nothing. That is the trap in this task, and the enemy-side test case is what closes it.

---

## 3. The fix, and why it cannot double-credit

**One call added**, at the end of the per-victim DoT-tick `credit` callback in
`src/utils/combat/engine.ts` (immediately after the `perActorDot` block), with a ~30-line comment
recording the two-proc landscape, the double-credit reasoning and the symmetry argument:

```ts
procStandingLeechesPerVictim(sourceId, damage);
```

Plus one comment correction inside `procStandingLeechesPerVictim` (`engine.ts:3848-3853`), whose old
text claimed "per-victim damage rides the `direct` channel only" — now accurate about the
non-detonation channels it serves.

**Why the per-victim proc and not `creditDamage`.** `creditDamage` does
`dmg(sourceId)[channel] += amount` *before* proccing, which would feed the scalar DoT channel this
branch deliberately keeps out of (the branch's own header, `engine.ts:8622-8624`, states it "NEVER
calls `creditDamage` (no cumulativeDamage double-feed against the dummy HP overwrite)"). It would
also have been the player-only proc.

**Why it cannot double-credit.** `procStandingLeechesPerVictim` writes **only** heal-side state:
`healingCtx.credit(sourceId, 'directHeal'|'effectiveHeal'|'overheal'|'shield', …)`,
`healingCtx.applyHealToTarget` / `grantShieldToTarget`, and `creditLandedRepair`. It never touches
`dmg()`, `roundPerTargetDamage`, `creditDealt`, `perActorDot` or any sink. Empirically confirmed: in
the one golden that moved, **`perTargetDealt` is byte-identical** (`practice-target: 7082.79682551835`
unchanged on every round) while only heal buckets moved. Zero DoT damage numbers moved anywhere in
the suite.

**Cadence matches the dummy path.** `tickDoTs` calls `credit` **once per DoT entry**, in entry order
(`engine.ts:1046`, `:1082`) — so the owner's `activeHealCritGate` draws once per entry on the
positional path exactly as it already did on the dummy path. No new RNG-cadence divergence.

**Scope semantics preserved exactly.** On a DoT channel, `procStandingLeeches` skips
`scope:'detonation'` (`channel !== 'detonation'`) and `procStandingLeechesPerVictim` skips it
unconditionally — the two agree on every channel the per-victim proc is now reachable from. Fenced by
the fourth test case ("a detonation-scoped leech stays inert on a DoT tick").

---

## 4. Blast radius — every golden that moved

**Exactly one golden scenario moved, in one file.**

`src/utils/calculators/__tests__/__snapshots__/healingGoldenParity.test.ts.snap` — scenario 9,
"Magnolia shape (standing damage-leech all-scope: cast + Inferno tick)", plus its supplementary
in-code assertion. Nothing else in that 53-test file moved; no other snapshot file in the repo moved.

Pre-change numbers were measured, not assumed — `git worktree add /tmp/sp4b2b-base 39d463f1`
(`node_modules` symlinked, `.env` copied), then read straight off the base snapshot and re-ran the
scenario there.

| value | @ `39d463f1` (epic-step base, dummy path) | @ `7274beff` (Task 2, positional, pre-fix) | now | mechanism |
|---|---|---|---|---|
| `directHeal` / round | 1258 | 417 | **1417** | cast leech 417 + **inferno-tick leech 1000** |
| `overheal` / round | 1258 | 417 | **1417** | same (full HP → all overheal) |
| `totalRoundHealing` / round | 1258 | 417 | **1417** | same |
| `perRecipient.attacker.directHeal` / round | 1258 | 417 | **1417** | same |
| `perRecipient.attacker.overheal` / round | 1258 | 417 | **1417** | same |
| `cumulativeHealing` R1..R6 | 1258·n | 417, 833, 1250, 1666, 2083, 2499 | **1417, 2833, 4250, 5666, 7083, 8499** | Σ of unrounded 1416.5594, rounded last |
| `cumulativeHealing` R7..R10 | — | 2499 (flat) | **8499** (flat) | practice target dead from R6; flatline value follows R6 |
| `summary.totalDirectHeal` / `totalHealing` / `totalOverheal` | 12579 | 2499 | **8499** | 6 × 1416.5594 = 8499.36 |
| `summary.perRecipient.attacker.totalOverheal` | 12579 | 2499 | **8499** | same |
| `summary.avgHealingPerRound` | — | 250 | **850** | 8499 / 10 = 849.9 |
| `perTargetDealt.attacker['practice-target']` | — | 7082.79682551835 | **7082.79682551835** | **UNMOVED** — proves no damage double-credit |

**Attribution.** Every moved number is the same single term: `+1000/round`, which is
`inferno tick 5000 × leech pct 20% = 1000`. The base worktree pins it independently — at `39d463f1`
the scenario read `directHeal 1258 = cast 258 + inferno 1000`, i.e. **the 1000 term existed on the
dummy path**, dropped to 0 when Task 2 made the fixture face a real positioned enemy, and is now
restored at *exactly* 1000. It round-trips unchanged because inferno scales off the **applier's**
effective attack (5000), not the victim's HP (`engine.ts:1065`) — so the practice target's
40,000 HP is irrelevant to it. The other term (cast leech 258 → 417) is **Task 2's** rebase off the
practice target's defence 5,000 and did not move in this task.

Nothing else moved. No second defect surfaced.

**Fixture comments updated** (`healingGoldenParity.test.ts`):
- Scenario 9's ⚠️ block: the "⚠️ BUT THE LEECH PAYS NOTHING ON IT … Tracked as its own follow-up; do
  not 'fix' it by editing this number back" paragraph is replaced with a ✅ paragraph recording the
  fix, its site, its fence, and the 39d463f1 measurement that justifies the 1000.
- Scenario 9's `it` renamed `round-1 directHeal is exactly 1417 (cast leech 417 + inferno-tick leech
  1000)`, expectation 417 → 1417, hand-derivation and anti-vacuity comment re-tensed. The
  `perTargetDealt` anti-vacuity assertion is kept verbatim.
- Scenario 11 (detonation): the **detonation gap statement is left intact**. Only its cross-reference
  to scenario 9 was re-tensed ("WAS production-reachable … and is therefore FIXED in SP-4b-2b Task
  2b"), and "Tracked as its own follow-up alongside scenario 9's" became a pointer to the tripwire.

**Note on the brief's second comment site.** The brief said Task 2 also left an inline gap block in
`healingEngineAdapter.ts`. It did not — I scanned the file and the whole repo (`leechScope` appears in
no adapter comment; `git show 21120626 -- healingEngineAdapter.ts` shows its only change there was the
*corrosion-HP-basis* re-tensing). The leech-gap prose lives only in `healingGoldenParity.test.ts`
scenarios 9 and 11, plus Task 2's commit message. Nothing to update in the adapter.

---

## 5. The detonation tripwire (Step 4)

`positionalDotLeech.test.ts`, second describe block:

```
describe('KNOWN GAP (tripwire): a detonation-scoped standing leech pays zero on a positional burst')
  it('a positioned enemy’s timed bomb bursts, and the focus’s detonation-scoped leech still credits 0')
```

A timed bomb (2 stacks × 3000, countdown 1, applier = focus) is seeded on a positioned enemy outside
the firing footprint; the focus carries a 20% `leechScope:'detonation'` standing leech. Assertions:

```ts
expect(result.rounds[0].perTargetDamage?.['enemy-back']).toBe(6000); // the burst REALLY landed
expect(sumHeal(result, 'directHeal', 'attacker')).toBe(0);           // and paid nothing: THE GAP
```

The first line is load-bearing anti-vacuity — without it the 0 would be indistinguishable from "no
detonation happened". A payout would have been 6000 × 20% = 1200.

The block's comment records: both engine facts (`procStandingLeechesPerVictim`'s unconditional
`continue` on `scope === 'detonation'`; the positional burst deliberately never routed through
`creditDamage(actor.id, 'detonation')` at `engine.ts` ~:6913 / ~:9546), the corpus-unreachability
argument (Valkyrie's Echoing Burst leech is `on-bomb-detonated`, reactive-partitioned out of
`standingLeeches` before the scan — `engine.ts` ~:3860-3866), and an explicit instruction that a RED
here is not necessarily a regression: read the comment, decide whether the payout is correct, then
update the expectation deliberately.

---

## 6. Fixture non-vacuity notes (the traps in note 6)

- The DoT fixtures put the carrier at **M2, outside the Line-Range-1 footprint (M4 + M3)**, so its
  `perTargetDamage` is the pure tick — no firing-hit contamination. This sidesteps the
  front-selection row trap entirely: I never rely on which victim `front` picks, only on the carrier
  being *outside* whatever it picks.
- The focus runs `attack: 0` in the DoT fixtures, so `dealtBy(rounds,'attacker') === 500` exactly.
- The leech lives in a **passive** slot and is a `damage-dealt` heal, i.e. a standing leech — not the
  passive-slot on-cast self-buff shape that silently does not apply.
- `crit: 0` everywhere, `healModifier: 0` → every credited value is an exact integer and
  `activeHealCritGate` is deterministically false. **No RNG seeding is used at all**, so the
  `setupKeyedTestRng`-after-`resetRateGateRng` ordering trap does not arise.
- The enemy-side case asserts the tick lands in **round 2** (the enemy applier has no ctx in round 1
  → `tickDoTs` skips the entry), matching the documented `perVictimDotTick` C.2 timing.
- The `direct` control asserts both victims' per-victim damage (5000 origin / 2500 covered) as well
  as the 1500 payout, so a change in role-scaling could not silently keep it green.

---

## 7. Out of scope, deliberately not touched — one further asymmetry, recorded

The **heal-target** DoT-tick branch (`engine.ts:8648-8695`) also procs no standing leech: its
`credit` callback only sums into `tankDotDamage`. So an *enemy* whose DoT ticks on the **heal
target** still pays nothing, while the same enemy's DoT ticking on a non-heal-target player ally now
pays (via the branch I fixed).

I did **not** extend the fix there, for three reasons: (a) the brief scopes this task to the
positional per-victim branch; (b) the discriminator is victim *identity*, not side, so it is not the
team-symmetry class this epic locked — the branch I changed is side-shared and is symmetric by
construction; (c) it is the tank-accounting path, so touching it would move healing goldens broadly
on a question the owner has not ruled on. Recorded here as a candidate follow-up, not as a claim
that this task is incomplete.

---

## 8. Verification

| check | result |
|---|---|
| `npx vitest run src/utils/combat/__tests__/positionalDotLeech.test.ts` | **5 passed (5)** |
| `npx tsc --noEmit` | **exit 0** |
| `npx eslint src` | **exit 0** |
| `npm test` | **Test Files 528 passed (528) · Tests 5837 passed (5837)** |

Snapshot regeneration was surgical: `npx vitest run <the one file> -u`, never a suite-wide `-u`.

Changelog: one `UNRELEASED_CHANGES` entry added (plain English, no emoji). It names the **healing
calculator and combat simulator** only — verified that `mode:'dps'` passes no `healTargetId` and
`healTarget` is `explicitHealTarget ?? (runMode === 'battle' ? attacker : undefined)`
(`engine.ts:2434`), so `standingLeeches` is never even populated on a DPS run and this fix is inert
there.

## 9. Files touched

- `src/utils/combat/engine.ts` — the fix (one call + comments).
- `src/utils/combat/__tests__/positionalDotLeech.test.ts` — new; 5 cases (player, enemy mirror,
  direct control, DoT-channel scope gate, detonation tripwire).
- `src/utils/calculators/__tests__/healingGoldenParity.test.ts` — scenario 9 comment/name/expectation,
  scenario 11 cross-reference.
- `src/utils/calculators/__tests__/__snapshots__/healingGoldenParity.test.ts.snap` — scenario 9 only.
- `src/constants/changelog.ts` — one `UNRELEASED_CHANGES` entry.
