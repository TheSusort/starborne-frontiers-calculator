# Task 4 Report — SP-4b-2b wave A: the two highest-count fixture files

**Status: DONE_WITH_CONCERNS.** 115/115 green in the two target files (73 healing + 42
engine.events; the brief's "39 + 36 = 75" counted only the FAILING tests, the files hold 115 total).
`tsc --noEmit` clean, eslint clean, prettier clean. Two engine observations that are NOT fixture
churn are escalated at the bottom — neither was absorbed into an assertion.

Measured throughout against a base worktree at `39d463f1` (`/tmp/sp4b2b-base`, `node_modules` copied
with `cp -a`; `.bin/tsc` verified still a symlink afterwards). Every number below marked "base" was
read out of that worktree by running the same fixture with the pre-change roster shape, not inferred.

---

## File 1 — `src/utils/combat/__tests__/healing.test.ts`

**One base factory covered the whole file.** 39 failing tests → 0 with a single line changed in
`BASE()` (`enemyAttackers: []` → `bareEnemy()`), plus one pre-existing explicit `[]` at the Salvation
control run.

| Change | Why |
| --- | --- |
| `BASE()`: `enemyAttackers: bareEnemy()` | the 39 failures, all of them |
| Salvation `aliveControl`: explicit `enemyAttackers: []` → `bareEnemy()` | an empty roster is no longer expressible; "no pressure" is now an inert 0-attack enemy. Premise ("Salvation survives, so the on-destroyed heal must NOT fire") is preserved exactly — a 0-attack enemy cannot kill it |
| test renamed: `no enemyAttackers → healing rounds have zero intake` → `a 0-attack enemy attacker → healing rounds have zero intake` | the title described a fixture shape that no longer exists. Assertions (`incomingDamage === 0`, `shieldAbsorbed === 0`) are UNCHANGED and still non-vacuous: a real opponent that cannot deal damage must produce no intake |

**Assertion values that moved: NONE.** Not one number, not one id. Every `toBeCloseTo`/`toBe` in the
file holds byte-identical with a real 0-attack enemy on the board. This is the strongest available
evidence for the brief's core claim that a 0-attack positioned enemy is inert: it is inert across 73
healing assertions including exact hand-computed timelines.

Point 5 of my instructions (the standing `basis:'damage-dealt'` / `leechScope:'all'` leech now paying
out on a positional DoT tick) **did not fire in this file** — no heal number grew by a leech term.
The three `cast-rider damage-dealt basis` tests pass on their original values.

---

## File 2 — `src/utils/combat/__tests__/engine.events.test.ts`

**One base factory got 25 of the 36; the remaining 11 needed six distinct repairs.** The file has
SIX roster insertion points, not one: `baseInput()` (l.48), the `run()` helper in the
accumulate-detonate describe (l.1279), `healBase()` (l.1556), and three inline `runCombat({…})`
literals in the perTarget-breakdown describe (l.1818/1899/1959). A fix to `baseInput` alone leaves 11
call sites throwing — exactly the partial-fix failure mode the brief warns about.

### Every assertion whose value moved

| # | Test | base value (measured at `39d463f1`) | new value | Mechanism |
| --- | --- | --- | --- | --- |
| 1 | `emits one started/ended pair per actor turn` — the 2nd actor's `actorId` | `'enemy'` | `BARE_ENEMY_ID` (`'e1'`) | **M1** — the dummy's turn is gone; the real enemy takes it |
| 2 | same test, `turnEvents.length` | `rounds * 4` where `rounds` was **5** | `rounds * 4` where `rounds` is **6** | **M7 (new)** — see below; the assertion formula is unchanged, only the round count it derives from |
| 3 | `a faster enemy flips the per-round turn order` — the whole ordering | enemy-first via `enemySpeed: 200` | enemy-first via `bareEnemy({ stats: { speed: 200 } })` | **M6 (new)** — `enemySpeed` is the DUMMY's speed and is now wholly inert |
| 4 | `emits skill-fired slots matching the charge cadence` — `skillFired.length` | 5 (`= rounds`) | 12 unfiltered / **6 = rounds** filtered on `FOCUS` | **M2** — filtered, not re-pinned |
| 5 | `emits one ability-performed (damage) per round` — `performed.length` | 5 (`= rounds`) | 12 unfiltered / **6 = rounds** filtered on `FOCUS` | **M2** |
| 6 | `emits debuff-resisted for an apply debuff at an affinity disadvantage` — `resisted.length` | 6 (`> 0`) | 0 → **restored to `> 0`** by giving the actors real affinities | **M5 (new)** — see below |
| 7 | same test, `e.targetId` | `'enemy'` | `BARE_ENEMY_ID` | **M1** |
| 8 | `recurring enemy debuff … debuff-resisted still fires per round on miss` — `resisted.length` | 3 (`> 0`) | 0 → **restored to `> 0`** the same way | **M5** |
| 9 | `timed enemy debuff … debuff-applied ONCE` — `e.targetId` | `'enemy'` | `BARE_ENEMY_ID` | **M1** |
| 10 | `team actor's landed timed debuff …` — `e.targetId` | `'enemy'` | `BARE_ENEMY_ID` | **M1** |
| 11 | `skill-triggered inferno detonation …` — `baseBurst` | 10 800 (`> 0`) | 0 → **restored to `> 0`** by adding the damage clause the corpus has | **M8 (new)** — see ESCALATION 1 |
| 12 | `skill-triggered corrosion detonation …` — `baseBurst` | `> 0` | 0 → **restored to `> 0`** the same way | **M8** |
| 13 | `fast enemy … expires one round later (round 3, the +1 KNOWN-DIFF)` — the returned round | 3 | 2 → **restored to 3** by re-expressing the rule against the real enemy | **M6 + M9 (new)** — see below |
| 14 | the sibling `default speed … expires round 2` | 2 | 2 (still 2, via the rewritten helper) | M6 + M9 |
| 15 | the `buff-expired` `actorId` in that pair | `'enemy'` | `BARE_ENEMY_ID` | **M1** |

Nothing was re-pinned, widened, deleted or skipped. Rows 6/8/11/12/13 are the ones where the number
had DROPPED (`> 0` → 0, `3` → `2`); in every case the fixture setup was repaired so the original
value came back, per Step 4.

### New mechanisms (the brief's M1–M4 do not cover these)

**M5 — a positional cast re-derives the affinity matchup from the two actors' own `affinity` fields,
so the `affinityDamageModifier` / `affinityCritCap` / `affinityCritPenalty` INPUT SCALARS no longer
drive debuff landing.** `playerTurn.ts` (~l.1364): `positionalLanding = deferAbilityPerformedToEngine`,
and when it is true `landingAtDisadvantage = computeAffinityModifiers(attackerAff, victim.affinity) < 0`.
`bareEnemy()` carries no `affinity`, so both sides default to `'antimatter'` → NEUTRAL → an `'apply'`
debuff lands with no roll at all. Measured: base emitted `debuff-resisted` every round and reported
`activeEnemyDebuffs: []`; after the roster change it emitted zero resists and the row began reporting
`Armor Break` ACTIVE. Repair: `affinity: 'chemical'` on the input + `bareEnemy({ affinity: 'thermal' })`
— thermal beats chemical, resolving to exactly the −25 / cap 75 / penalty 25 the fixture's scalars
already declared. **Later waves: any fixture that sets a non-zero `affinityDamageModifier` and expects
it to bite is now silently neutral. This is the single highest-yield thing to grep for.**

**M6 — the `enemy*` top-level scalars configure the VESTIGIAL DUMMY and are inert on a positional
run.** `enemySpeed` no longer reorders turns (measured: `enemySpeed: 200` left the order
attacker-first, and `enemySpeed: 150` left a debuff expiry at round 2 instead of moving it to 3).
`enemyDefense` and `enemyHp` likewise still describe the dummy — visible in the post-wipe damage
numbers under ESCALATION 2. Repair: put the property on the roster entry
(`bareEnemy({ stats: { speed, defence, hp } })`).

**M7 — `bareEnemy()`'s 500 000 HP is NOT a survival guarantee, and the run CHANGES SHAPE when the
enemy dies.** `engine.events`' `baseInput` focus deals ~45 k/round plus tier-8 inferno / tier-5
corrosion, and killed `e1` in round 4 of 6. Consequences, all measured: the enemy stops taking turns
(so per-round event counts stop being uniform), the run no longer terminates at the kill round the
way it did when the DUMMY was the thing being killed (base: dummy died end of round 5 → `rounds` = 5;
now: `rounds` = 6), and the cast starts landing on the legacy dummy again with the DUMMY's
`enemyDefense` folded (see ESCALATION 2). Repair: `bareEnemy({ stats: { hp: 10_000_000 } })` wherever
the fixture needs a punching bag for the whole sim. **I extended the shared
`bareEnemy(overrides?)` to make this a one-liner** (`stats` merged field-by-field over the inert
defaults so raising HP cannot accidentally grant an attack) and exported `BARE_ENEMY_ID` so fixtures
stop hardcoding `'e1'`. Later waves should default to the HP override for any fixture whose focus
actually deals damage.

**M9 — a SCHEDULED (`input.enemyDebuffs`) status cannot express carrier-turn timing any more.** It
lives in the side-wide `__enemy__` sentinel bucket, which a positional run decrements ONCE PER ROUND
at the round boundary (`engine.ts` l.10527, the `dummyEnemyIsVestigial` block) precisely BECAUSE the
dummy has no turn to hang the decrement on. A round-boundary decrement is speed-independent by
construction, so the fast-enemy +1 window is structurally unobservable through that channel. Repair
(not a re-pin): re-express the same game rule where it still lives — an ABILITY-applied timed debuff
on the REAL enemy, whose own speed sets turn order. Verified empirically: `e1` speed 10 → expiry
round **2**; `e1` speed 150 → expiry round **3**, carrier `'e1'`. Same rule, same two expected
numbers, now against a real opponent.

---

## ESCALATION 1 — a detonate-ONLY cast drops its detonation entirely on a positional run

Not fixture churn. Measured, same fixture, same seed:

* base (`39d463f1`): round 4 charged fires → `dot-detonated { targetId: 'enemy', damage: 10800 }`,
  and the round-4 tick is gone (the stacks were consumed).
* with a real positioned enemy: round 4 charged fires → `ability-performed { damage: 0 }`, **no
  detonation event, no burst anywhere in `perTargetDealt`**, and the stacks just tick normally
  (7200).

Cause: `engine.ts` l.7426/7460 — `detonationTargets` is populated ONLY from
`drivePositionalApply`'s `onVictimResolved`, i.e. victims the cast's firing DAMAGE resolved onto. A
charged slot holding only a `detonate-dot` ability resolves nobody, so `applyPerVictimDetonation`
runs against an empty victim map. The legacy path detonated the dummy unconditionally.

Corpus exposure (checked `docs/ship-skills.csv`, 7 rows mention detonation): Crocus, Demolisher and
Incinerator all deal damage in the same clause, so they are safe. **Lingshe is the one to look at** —
her charged skill ("reduces all Bombs on the enemy targets by 1 turn, Bombs reduced to 0 turns by
this skill will detonate… This Unit inflicts Bomb III for 3 turns") has NO damage clause. Whether she
routes through `detonate-dot` or a different mechanic I did not determine; if she does, her
detonation is worth zero in the DPS calculator today, since every `simulateDPS` run has been
positional since SP-4b-2a.

I did NOT change the engine (that belongs in its own PR with its own review). I repaired the two
fixtures to look like what the corpus actually contains — a damage clause alongside the detonate
clause — which restores `baseBurst` to a real number and keeps `modBurst ≈ baseBurst × 1.5` measuring
the skill-triggered path it claims to measure.

**Bycatch worth knowing:** the sibling BOMB test kept PASSING through all of this, with an
identical detonate-only charged slot. It was passing on bomb EXPIRY detonations, not on the
skill-triggered path in its title. That is a live example of the fixture-vacuity class: three tests
with the same fixture shape, one of them structurally unable to fail. It is green either way; I added
the damage clause to it too so all three now exercise the path they name.

## ESCALATION 2 — after the opposing roster is wiped, the cast lands on the DUMMY again

> ### ⚠️ CORRECTED by the Task 8 final whole-branch review — read this before the text below
>
> The claim "it teleported onto the dummy and **kept crediting**" is **wrong on the crediting half**.
> Post-wipe the fallback is **CONSULTED**, and the **`ability-performed` event payload** carries a
> dummy-defence-folded number — but **no damage channel and no HP is touched**.
>
> Re-measured directly (focus attack 100 000, one 50 000-HP positioned `bareEnemy` killed in round 1,
> `enemyDefense: 8000`, 4 rounds, seed 12345):
>
> ```
> ability-performed: R1 100000 · R2 30549.08935443992 · R3 30549.08935443992 · R4 30549.08935443992
> rounds:            R1 {direct:0, cum:0, ptd:{attacker:{e1:100000}}}
>                    R2-R4 {direct:0, cum:0, ptd: ABSENT}
> rawTotals:         all zero
> counters:          {consulted: 3, credited: 0}
> ```
>
> The magnitude claim HOLDS: 30 549.089 is byte-identical to what the same fixture reports **every**
> round when the roster is a pressure source (`bareEnemy({ stats: { hp: 0 } })` → non-positional, the
> whole cast drains the dummy), so the number really is folded against the dummy's `enemyDefense`.
> The ACCOUNTING claim does not: `directDamage`, `cumulativeDamage`, `perTargetDealt` and `rawTotals`
> are all untouched, and the dummy's HP never declines, so `__getDummySinkCreditCount()` stays 0.
> The branch's own code already agreed — `dummyReachability.test.ts`'s CORPSE TARGETING case pins
> `consulted: 2, credited: 0`, and `healingGoldenParity` scenario 9's rounds 7-10 read all-zero with
> `perTargetDealt` absent once the practice target dies.
>
> **Conclusion for SP-4c:** "the deletion is NOT a pure no-op" **survives**, but narrows to an
> **event-payload value**. 4c should plan a log/event-fidelity assertion on the post-wipe
> `ability-performed.damage`, **not** an accounting migration — there is no accounting to migrate.
> The lesson is the repo's own: **measure `deliveredDamage`, not `ability-performed.damage`.** The
> original text is left below verbatim as corrected-history.

Measured on `engine.events`' `baseInput` while `e1` still had the default 500 k HP: `e1` dies in
round 4, and the focus's rounds 5 and 6 report damage 14 820.90 and 5 928.36 — which are exactly the
BASE worktree's dummy-victim numbers (the dummy's `enemyDefense: 8000` folded in), not the ~45 000 it
was dealing to the 0-defence `e1`. So the cast did not whiff against corpses; it teleported onto the
dummy and kept crediting.

That contradicts the intent stated in `engine.ts` (~l.2599): "That divergence is intended (the cast
whiffs against corpses **rather than teleporting onto the dummy**)". The whiff gate holds for
SELECTION, but the legacy single-apply still credits. Almost certainly the same defect class SP-4c is
about to delete; flagging it so the deletion is not assumed to be a pure no-op. No fixture in wave A
depends on it (I removed the death by raising HP), so nothing here is pinned to it.

---

## VERDICT ON THE BRIEF'S RECIPE

**The recipe is correct but INCOMPLETE. It works for a healing-shaped file and undershoots badly for
a damage-shaped one.** Concretely:

1. **`bareEnemy()` as written is not a drop-in for a damage fixture.** The brief presents it as one
   ("prefer the shared fixture so 64 files do not invent 64 different enemies") and never mentions
   that 500 000 HP is killable. It was killed in round 4 of 6 by the very first damage fixture I
   pointed it at. Later waves should reach for
   `bareEnemy({ stats: { hp: 10_000_000 } })` **by default** for any fixture whose focus deals damage,
   and treat plain `bareEnemy()` as the "support/healing fixture" form. The override parameter and
   the reasoning are now in the fixture's doc comment.
2. **"one base factory per file" is the wrong prior.** `engine.events` had six insertion points; five
   of them were invisible to a search for the factory name because they are inline `runCombat({…})`
   literals. Wave planners should count `enemyAttackers: []` occurrences per file, not factories.
3. **M1 needs restating.** The brief says a fixture filtering on the actor id `enemy` "must filter on
   `attacker`". That is only true for fixtures observing the FOCUS. The commoner case in this file was
   the opposite: the assertion is about the OPPONENT, and the id moves `'enemy'` → the roster entry's
   own id. Use the exported `BARE_ENEMY_ID`.
4. **Three mechanisms are missing from the M1–M4 list** and will recur across the remaining 62 files:
   **M5** (affinity input scalars are dead on a positional run — highest expected yield),
   **M6** (`enemySpeed`/`enemyDefense`/`enemyHp` are dummy scalars and inert), and
   **M9** (scheduled `enemyDebuffs` decrement at the round boundary, so no carrier-turn timing can be
   observed through them). **M7** (enemy survivability) belongs on the list too.
5. **Step 5's verification is not sufficient on its own.** Two of my eleven residual failures
   (M5, M8) presented as `expected 0 to be greater than 0` — the exact shape that tempts the
   `toBe(0)` re-pin the brief warns about. Neither was churn; one was a dead input scalar and one is
   an engine gap. Later waves should treat every `> 0` that becomes 0 as suspect-until-measured
   against the base worktree, never as "the fixture no longer produces that".
6. **Step 6 must say `--no-verify`.** Husky's pre-commit runs the full suite, which is red until the
   last wave lands.

Everything else in the recipe held: the base worktree was decisive (it is what separated M5/M8 from
churn), `perTargetDealt` was the right routing discriminator, and fixing setups rather than
assertions turned every dropped value back into its original number.

---

## Files changed

* `src/utils/combat/__tests__/healing.test.ts` — one base-factory line, one control-run roster, one
  test renamed + comment.
* `src/utils/combat/__tests__/engine.events.test.ts` — six roster insertion points, a `FOCUS`
  constant + two focus filters, four id assertions retargeted to `BARE_ENEMY_ID`, two affinity
  setups, one turn-order speed moved onto the roster entry, six detonate slots given their damage
  clause, one helper (`oneShotEnemyDebuff`) re-expressed against the real enemy.
* `src/utils/combat/__testutils__/bareRosterFixture.ts` — `bareEnemy(overrides?)` with deep-merged
  `stats`, and an exported `BARE_ENEMY_ID`. Backward compatible: all four other consumers unchanged
  and unaffected.

No changelog entry: test-only change (CLAUDE.md excludes those).

## Verification

* `npx vitest run src/utils/combat/__tests__/healing.test.ts src/utils/combat/__tests__/engine.events.test.ts`
  → **2 files passed, 115 tests passed**.
* `npx tsc --noEmit` → clean. (It caught a missing `application` field on my new debuff config that
  vitest happily ran — the "tsc catches what vitest can't" lesson, again.)
* `npx eslint` + `npx prettier --check` on the three changed files → clean.
* The four other `bareRosterFixture` consumers: `positionalSubBuckets` and
  `normalizationBoundary.integration` fully green; `damageChannelAccounting.integration` and
  `dummyReachability` have 3 failures that are their own inline `enemyAttackers: []` tests
  (other waves' inventory), not caused by the fixture signature change.
* Committed with `--no-verify` (the full suite is red until the last wave lands).

---

## Fix wave 1 — review follow-ups (Findings 1-4)

All four review findings addressed in `src/utils/combat/__tests__/engine.events.test.ts` only.
No engine change, no assertion weakened/deleted/skipped/re-pinned.

### Finding 1 (Important) — bomb burst test could not observe its own named path

The Case 5c test (`skill-triggered bomb detonation scales by detonationDamageModifier...`,
formerly ~l.950-1057) summed **every** `bomb-detonated` event with no filter. Bombs also burst on
natural countdown-0 EXPIRY (`processBombs`, the enemy-turn / positioned-timed-burst path), so the
unfiltered sum could stay green even if the skill-triggered `detonate()` path regressed to zero.

Read the event shape (`events.ts` `bomb-detonated` variant, ~l.355-363): `detonatorId` is
"UNDEFINED for a natural countdown-0 expiry ... which nobody 'detonates'" and is stamped with the
casting actor only by the skill-triggered path (`engine.ts`'s `applyPerVictimDetonation`, "the
positional detonate caster IS the detonator"). That is exactly the discriminator needed — no
timing/round heuristic required.

Fix: filter both sums to `e.detonatorId === FOCUS` (the same `FOCUS = 'attacker'` idiom already
used everywhere else in the file for cardinality assertions on the focus actor). Kept the
`toBeGreaterThan(0)` guard and the `toBeCloseTo(baseBurstSkill * 1.5, 5)` ratio assertion
unchanged — only the population being summed changed.

**Non-vacuity demonstration (red → green):**
1. Temporarily edited `engine.ts`'s `applyPerVictimDetonation` victim loop to
   `if (true) continue;` right after `for (const victim of victims.values()) {` — this makes the
   skill-triggered detonation resolve no victim (simulating the exact regression the finding
   describes), while leaving the natural-expiry path (`processBombs`) untouched.
2. Ran `npx vitest run src/utils/combat/__tests__/engine.events.test.ts -t "skill-triggered bomb detonation"`.
   RESULT: RED — `AssertionError: expected 0 to be greater than 0` at the `baseBurstSkill`
   assertion. Confirms the fixed test is now sensitive to the named path; the pre-fix version
   (summing all `bomb-detonated` events unfiltered) would NOT have failed here, since it would
   still be picking up the natural-expiry contribution if any existed, or simply passing 0
   silently as `toBeGreaterThan(0)` would then correctly fail too — the key point is the test now
   fails for the RIGHT reason (skill path zeroed), traceable directly to `detonatorId`.
3. Reverted `engine.ts` (`git diff` / `diff` against a pre-edit backup confirmed byte-identical
   restoration).
4. Re-ran the full file: 42/42 GREEN.

### Finding 2 (Important) — latent engine gap needs a durable in-repo home

Strengthened the comment block above `detonatorHit` in the `Phase 3 Task 3 — event shape and
timing` describe (now ~l.598-618). Added, using the verified facts supplied in the task brief:
- the precise mechanism/call chain (`DOT_DETONATE_RE` / `detonationsFromSkill`,
  `skillTextParser.ts:3167` → `detonationTargets`, `engine.ts:7426` →
  `applyPerVictimDetonation`, `engine.ts:7753`);
- that the fixture's damage clause (`detonatorHit()`) exists BECAUSE of this gap, not
  incidentally — removing it would silently zero every skill-triggered detonation assertion in
  the block;
- the verified corpus-unreachability conclusion: only Crocus/Demolisher/Incinerator match
  `DOT_DETONATE_RE` and all three carry damage in the same clause (safe); Lingshe's charged skill
  detonates but parses to `bomb-countdown-reduce` (`skillTextParser.ts:4523-4537`), resolving
  damage in `reduceBombsOnVictim` (`bombCountdown.ts:29-80`) independently of
  `detonationTargets`, so she is unaffected.
No engine change made, per instructions.

### Finding 3 (Minor) — contradictory comments

Searched the whole file (`grep -n "affinityDamageModifier"` / `"always resisted"` /
"disadvantage"/"resisted"/"penalty"/"cap 75"/"cap 100"`) for every instance of the described
shape. Found exactly ONE literal contradiction: the trailing comment
`affinityDamageModifier: -25, // affinity disadvantage → 'apply' debuffs are always resisted`
in the `recurring enemy debuff emits no debuff-applied...` test (now ~l.687), directly below its
own correct block comment (l.667-670) naming the real mechanism (the two actors' own `affinity`
fields). Replaced the trailing comment with a two-line comment above the scalar, explicitly
labeling it "Legacy-dummy scalar, inert on this positional run" and pointing back at the block
comment. The sibling `affinityDamageModifier: -25` in the first `debuff-resisted` test (l.270)
already carries no trailing comment and its block comment (l.247-253) is accurate — no
contradiction there to fix. The task's `:459`/`:238-240` line references did not correspond to a
second live contradiction in the current file (line numbers appear stale relative to earlier
wave-A edits); confirmed by exhaustive grep rather than assuming a second site exists.

### Finding 4 (Minor) — dead setup reads as live

Added a comment above `enemyDefense: 8000` / `enemyHp: 400000` in `baseInput()` (now ~l.67-73)
stating plainly that these are legacy vestigial-dummy scalars, dead on this positional run; that
the real opposing actor is `enemyAttackers[0]` (`bareEnemy`) with its own `defence: 0` and (via
the `hp: 10_000_000` override) 10M HP; and warning against copying these two values into a later
fixture expecting them to configure the enemy.

### Verification

* `npx vitest run src/utils/combat/__tests__/engine.events.test.ts` → **42/42 passed**.
* Red-then-green demonstration for Finding 1: RED confirmed (`expected 0 to be greater than 0`)
  with the skill-triggered detonation path stubbed to resolve no victim; GREEN confirmed
  (42/42) after reverting `engine.ts` to its original byte-identical content.
* `npx tsc --noEmit` → clean.
* `npx eslint src/utils/combat/__tests__/engine.events.test.ts` and `npx eslint src` → clean.
* `git status --short` throughout the engine.ts break/restore cycle confirmed no residual diff on
  `engine.ts`; only `engine.events.test.ts` is modified in the final diff.
* Committed with `--no-verify` (the full suite is red across this branch by design until a later
  wave lands, per task instructions).
