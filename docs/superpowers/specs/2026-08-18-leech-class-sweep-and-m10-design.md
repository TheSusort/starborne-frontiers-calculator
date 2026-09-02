# Leech-channel class sweep + M10 — design

**Date:** 2026-08-18
**Base:** `7f8922cd` on main (post SP-4b-2b)
**Position in the epic:** the deferred class-sweep PR the owner ruled out of SP-4b-2b. Runs *before*
SP-4c so that 4c/4d stay pure zero-golden-movement deletions.

> ⚠️ **Every line citation in this document is paired with the SYMBOL it points at.** `engine.ts` is
> ~10,700 lines and citations in this codebase have gone stale inside the very commit that wrote them.
> Search the symbol; trust the number only if it matches. All citations here were verified against
> `7f8922cd`.

---

## 1. Why this PR exists, and why now

Three defects were deferred out of SP-4b-2b by owner ruling, on the grounds that each is a
**behaviour change with its own fixture surface** rather than a comment fix. They are collected here
for two reasons:

1. **They are user-facing bugs.** A shipped leech pays nothing on damage it should pay on; a
   user-authored ability silently never fires.
2. **This PR clears the last behaviour-changing readers ahead of SP-4c/4d.** M10's mechanism is a
   read of `ctx.enemyHp` / `ctx.cumulativeDamage` — both **cluster-H scalars that SP-4d deletes**.
   4d cannot delete `enemyHp` without first deciding what `enemyHpPct` reads instead. Fixing M10
   here means 4d deletes a field nobody reads, instead of being forced to carry a behaviour change
   into a PR whose entire proof is *zero golden movement*.

It is also deliberately small. **Over 100 files means CodeRabbit reviews nothing while its status
context reads SUCCESS** — confirmed twice in this epic (#322, #326). This PR was chosen for this
slot precisely because it can stay under that line and earn a real review.

---

## 2. The root cause is a dropped conjunct

The aggregate standing-leech proc is channel-aware
(`engine.ts:3827`, `const procStandingLeeches = (sourceId: string, channel: LeechChannel, amount: number)`).
Its scope gate reads (`engine.ts:3834`):

```ts
if (e.scope === 'detonation' && channel !== 'detonation') continue;
```

Meaning: *a detonation-scoped leech skips every channel that is not a detonation.*

The per-victim copy added for the positional path
(`engine.ts:3913`, `const procStandingLeechesPerVictim = (sourceId: string, amount: number)`)
takes **no channel** and kept only the first conjunct (`engine.ts:3926`):

```ts
if (e.scope === 'detonation') continue;
```

Which degenerates to: *a detonation-scoped leech skips **everything***.

That dropped parameter is the whole class. It is not four independent bugs; it is one missing
argument plus three call sites that were never wired because the proc could not have served them
correctly anyway.

`LeechChannel` (`engine.ts:1096`, `type LeechChannel =`) already enumerates exactly the channels
needed: `'direct' | 'detonation' | 'corrosion' | 'inferno' | 'generic'`.

### 2.1 The game rule was already ruled on

`leechScope`'s own type documentation (`src/types/abilities.ts:821`, `leechScope?: 'all' | 'detonation';`)
records a prior owner decision:

> `'all'` (default — direct + DoT ticks + detonations, user decision 2026-06-07)

So current behaviour contradicts a standing ruling. Corroborated by shipped skill text — **Valerian**:
"repairs 15% of Damage dealt to the enemy, **including inflcted Damage over Time effects**".

### 2.2 The incoming direction needs NO change — and the code currently says otherwise

Owner ruling, 2026-08-18, against the two shipped `damage-taken` leeches:

- **Malvex** — "When **directly damaged as a primary target**, this Unit gains Shield equal to 15% of
  the Damage dealt to them."
- **Quixilver** — "This Unit gains Shield equal to 25% of the damage taken **when taking HP damage and
  still having Shield**."

| Situation | Does the victim's taken-leech proc? |
| --- | --- |
| A bomb bursts on it | **No** |
| A DoT ticks on it | **No** |
| A passive-slot damage instance lands on it | **No** |
| Same three, victim on the player side | **Identical — no** |

**Consequence for the code.** `engine.ts:6557`'s block
(`KNOWN GAPS — both real, both corpus-bounded today`) asserts the gap is a defect
"**IN EITHER DIRECTION**" and cites the repo's locked granularity rule as justification. The
incoming half of that claim is **wrong**, and an implementer following the comment would have shipped
a bug. The locked rule ("outgoing procs per attack, incoming per occurrence") governs *how often* an
incoming proc fires — **not which channels qualify**. Which channels qualify is decided by the
ability's own text qualifier. That comment is corrected in this PR.

**Therefore none of the new call sites may go through `procLeechesForVictim`**
(`engine.ts:4058`, `const procLeechesForVictim = (`), which fires both directions by design and
correctly remains the seam for real attacks. The new sites call the standing proc only.

---

## 3. The four leech sites

`procStandingLeechesPerVictim` gains a third parameter, `channel: LeechChannel`, and its gate is
restored to the aggregate's line verbatim.

### Site 1 — positional per-victim DoT tick · VERIFY ONLY
Already a caller (`engine.ts:8885`, `procStandingLeechesPerVictim(sourceId, damage);`), shipped in
SP-4b-2b Task 2b. Now passes `corrosion` / `inferno` / `generic`. A `'detonation'`-scoped leech still
does not pay here — same outcome as today, for the correct reason instead of by accident.

**Behaviour change: none. Golden movement: zero.** Verified by measurement, not by a green suite —
three times in this epic a green fixture turned out to observe nothing.

### Site 2 — the bomb / accumulator burst
`applyPositionedTimedBurst` (`engine.ts:6995`, `const applyPositionedTimedBurst = (`) applies via
`applyVictimDamage` inside `processBombs`' `creditDetonation` callback and reaches no leech proc at
all. Add a standing-proc call with `channel: 'detonation'`.

Restores what the pre-positional path paid via `creditDamage(sourceId, 'detonation', damage)`.

**Live effect:** Magnolia, Valerian and the **Leech gear set**
(`buildEquipmentAbilities.ts:52`, `leechScope: 'all', noCrit: true`) begin paying on bursts again.
Valkyrie is untouched — its detonation-scoped leech fires from `on-bomb-detonated`, so the reactive
partition removes it before the `standingLeeches` scan.

### Site 3 — the heal-target DoT tick
Its `credit` callback (`engine.ts:8751`, `credit: (_sourceId, _dotType, damage) => {`) discards the
applier and sums only into `tankDotDamage`, so by the time `applyIncomingToTarget` books the aggregate
(`engine.ts:8793`, `if (tankDotDamage > 0) {`) there is no source left to pay. Thread `sourceId`
through and call the standing proc with the tick's channel, mirroring the sibling per-victim branch.

**This is the instance with no test of its own** — which is why a sweep driven only by the burst
tripwire would have left it behind.

### Site 4 — the passive-slot damage instance
`stagePassiveSlotHit` (`engine.ts:6638`, `const stagePassiveSlotHit = (`) calls `tb.applyToVictim`
directly, bypassing the leech seam. Add a standing-proc call with `channel: 'direct'`.

**Production-reachable today** — and the reachability argument does *not* require one ship to carry
both a passive-slot damager and a leech in the same slot: the **Leech gear set** grants a
`leechScope: 'all'` damage-dealt leech and is equippable on any ship. Judge (whose passive slot
carries a start-of-round damage ability) plus the Leech set reaches it.

`KNOWN GAPS (b)` at the same site — a cast with no firing-slot damage ability loses its passive
instance entirely — is **out of scope** and stays documented. It is corpus-inert and is a different
defect (a dropped instance, not a dropped payout).

---

## 4. M10 — the drain-time enemy-HP gate

`buildDrainContext` (`triggers.ts:1848`, `function buildDrainContext(`) derives, at
`triggers.ts:1850`:

```ts
ctx.enemyHp > 0 ? Math.max(0, 100 * (1 - ctx.cumulativeDamage / ctx.enemyHp)) : 100;
```

Both operands are vestigial-dummy scalars that positional credit never feeds (measured `cum = 0` at
every drain), so it reads **100% forever**. Every drain-time `hp-threshold` condition whose
`hpSubject` is not `'self'` is therefore dead, except the one shape `executeIntent` already
special-cases (`type: 'damage' && target: 'all-enemies'`).

**Corpus-unreachable from parsed ship text, but authorable in the in-app ability editor.** A user
building *"on crit, apply Defense Shred to the enemy, but only if the enemy is below 50% HP"* gets an
ability that silently never fires.

⚠️ **A fix scoped to `hpSubject === 'enemy'` under-fixes.** The dead set is `hpSubject !== 'self'`,
which **includes `hpSubject` being absent**.

### The fix — per-victim, extending an existing pattern

**Owner ruling, 2026-08-18:** the gate checks *the enemy the ability is about to hit* — each victim
against its own live HP. A 3-enemy AoE shreds only the ones actually under 50%.

The machinery exists, and **there are two in-repo precedents — the stronger one is not the AoE damage
path.**

*Precedent 1 (same subject, one shape).* `resolveAoEReactiveDamageVictims` (`triggers.ts:2583`)
re-checks per-victim `hp-threshold` / `enemy-debuff` conditions via `buildPerVictimConditionCtx`
(`triggers.ts:2554`), and the global drain gate scrubs those conditions for the
`damage && all-enemies` shape so it neither blocks nor false-passes the whole AoE.

*Precedent 2 (different subject, non-damage branch — the closer template).* Ship-kit W8 Task 12
(Zeolite) fixed the **identical defect shape** for `enemy-type` on the `purge` branch, and the
in-code reason is M10's reason verbatim: the gate "was scrubbed from the generic drain-time condition
check above (it only sees the single fight-wide dummy class) — re-check it HERE against the ACTUAL
victim's role". So the fix is not new architecture: **do for `hp-threshold` what Task 12 already did
for `enemy-type`.**

**The branches to widen** — dispatch is on `cfg.type`, not `ability.type`. The enemy-facing branches,
each of which already resolves its own target with a documented priority chain:

| Branch | Guard | Target resolution it already has |
| --- | --- | --- |
| `debuff` | `triggers.ts:2951`, `if (cfg.type === 'debuff') {` | `enemy-highest-attack` selector, else `counterTargetId ?? debuffVictimId`, plus `adjacent-enemies` and repaired-recipient fan-outs |
| `damage` | `triggers.ts:3778`, `if (cfg.type === 'damage') {` | `resolveAoEReactiveDamageVictims` (already gated), else `debuffVictimId`, else first living opposing actor |
| `purge` | `triggers.ts:3979`, `if (cfg.type === 'purge') {` | `enemy-most-buffs` selector, else `counterTargetId ?? victimId ?? ctx.enemyId` |

The ally/self-facing branches — `buff` (`triggers.ts:2758`), `heal`/`shield` (`triggers.ts:3354`),
`cleanse` (`triggers.ts:3598`) — resolve no opposing victim and take the fallback below.

⚠️ **Both `debuff` and `purge` fall back to the dummy sink** (`ctx.enemyId` / `ctx.enemy.id`) at the
end of their chains. The per-victim gate must not read HP off the sink — a sink-resolved target
evaluates the gate as unsatisfied rather than reading 100%. SP-4c deletes those fallbacks; until then
this is the one place the gate can still meet the dummy.

**Assumption, stated because the ruling does not cover it.** A **self- or ally-targeted** ability
carrying an enemy-HP gate has no victim to be per-victim about (editor-authorable: *"on crit, gain
Attack Up if the enemy is below 50%"*). Subject resolution: the triggering event's victim when there
is one, else the actor's resolved anchor. Pinned by a test so the choice is visible rather than
implicit.

**Golden movement: zero expected** (corpus-unreachable). Its only observer is its own tripwire.

---

## 5. Team symmetry

The locked rule is that engine work is team-symmetric, and the #306 defect shape was a fix applied to
one side only. **No site here needs a mirrored second edit** — and because the *absence* of a mirror
is the thing that rule exists to catch, each justification is stated explicitly in the PR body:

| Site | Why one edit covers both sides |
| --- | --- |
| 2 (burst) | `applyPositionedTimedBurst` is one helper called from the focus, walked-team and enemy sites with that site's own `tb`. |
| 4 (passive slot) | Same — `stagePassiveSlotHit` is one helper, three call sites. |
| 3 (heal-target tick) | Structurally player-only (`healTarget` is a player concept). **Its enemy-side counterpart *is* site 1**, already fixed in 2b. |
| M10 | The drain gate is owner-keyed (`buildActorConditionContext(ctx.statusEngine, ownerId, …)`) and side-agnostic. |

---

## 6. Churn expectation

Unlike SP-4c/4d, **movement here is the proof the fix landed**. There are two kinds, and conflating
them is how a real defect hides inside expected churn. Every moved golden is classified as one or the
other before it is accepted; **an unclassifiable one is a defect signal, not something to re-pin**.

1. **Magnitude churn.** Heal/shield credit rises for owners who land a burst, heal-target DoT tick,
   or passive-slot instance. Derivable by hand from the fixture.
2. **Stream-shift churn.** A heal-kind leech draws `owner.activeHealCritGate(owner.crit / 100)` **per
   victim**. New proc sites add new draws on that owner's RNG stream, shifting every later draw for
   that owner in the same fixture — so **a number can move in a fixture whose leech payout did not
   change at all**. Affects Magnolia and Valerian (crit-eligible); not the Leech gear set
   (`noCrit: true`).

Zero movement expected from site 1 and from M10.

---

## 7. Testing

### Three tripwires exist to go red here, and each says so in its own comment

| Tripwire | Instruction it carries |
| --- | --- |
| `positionalDotLeech.test.ts:392`, `describe('KNOWN GAP (tripwire): a detonation-scoped standing leech pays zero on a positional burst'` | Its header comment warns to read it before updating either expectation, because the gap is channel-wide and the fix also changes an `'all'`-scope payout. |
| `triggers.test.ts:1563`, `it('M10 tripwire: a non-self drain-time hp-threshold reactive never fires on a positional run…'` | States outright that its second assertion block **must go RED** when `buildDrainContext` is fixed — "that is the point of the test existing". |
| Site 3 | **Has no test at all.** Gains one. That absence is why it was nearly missed. |

Both existing tripwires are **inverted, not deleted**: the pinned zero becomes a pinned number.

### Anti-vacuity rules

Earned in this epic, and non-negotiable here:

- Every new assertion is a **specific non-zero number derived by hand** from the fixture. Never
  `> 0`; never a value copied from what the run happened to print.
- **No assertions on `rawTotals.direct` / `directDamage` / `cumulativeDamage`** at a direct
  `runCombat` entry point — all read 0 positionally, so an equality passes on `0 === 0`. Heal credit
  and `perTargetDealt` are the live channels. (`simulateDPS` re-folds per-victim credit into the
  scalar, so its entry point differs — check the entry point before asserting.)
- Each of the four sites gets a fixture **verified red before the fix**.
- A moved expectation is never re-pinned to `0`.

### Verification gates

Full `npm test` (the golden audit spans the whole run — a subset proves nothing), `tsc --noEmit`,
eslint, the placement oracle at its `147 / 146 / 2 / 13-13-13` baseline, and a **browser pass on the
DPS and healing pages** — this changes numbers users read. **Never `vitest -u`.**

---

## 8. Task order

0. **Scout: `hitMitigation.ts` inertness.** Its inertness argument was **withdrawn** in SP-4b-2b (its
   premise was `enemyAttackers` distinguishing callers) and is now unconfirmed, with a measurement
   recipe attached. Run first — it may add or remove scope before the task list is locked.
1. Site 1 verification + the `channel` parameter (behaviour-neutral; establishes the seam).
2. Site 2 — burst. Invert the burst tripwire.
3. Site 3 — heal-target DoT tick. New test.
4. Site 4 — passive-slot instance.
5. M10 + invert its tripwire.
6. The §2.2 comment correction, swept for **every** sibling copy of the "either direction" claim —
   SP-4b-2b found four surviving copies of one such claim, including 437 lines from a copy the same
   branch had already corrected.
7. `UNRELEASED_CHANGES` entry: leech repairs now pay on bomb explosions and damage-over-time ticks.

**Split trigger:** if the churn audit crosses ~90 files, **M10 splits into its own follow-up PR**. It
shares no seam with the leech work and carries no churn, and staying under 100 files is what buys the
review this PR exists to get.

---

## 9. Out of scope

- `KNOWN GAPS (b)` at `stagePassiveSlotHit` — a cast with no firing-slot damage ability drops its
  passive instance entirely. Corpus-inert; a different defect class (dropped instance, not dropped
  payout).
- The incoming/taken-leech direction — ruled a non-defect (§2.2).
- Everything in SP-4c/4d/4e. This PR touches no dummy-deletion cluster; it only removes M10 as a
  reader of the cluster-H scalars.
