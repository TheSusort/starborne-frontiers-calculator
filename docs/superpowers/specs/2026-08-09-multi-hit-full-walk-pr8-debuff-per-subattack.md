# PR8 — debuffs land per sub-attack

**Date:** 2026-08-09
**Epic:** `2026-08-07-multi-hit-full-walk-attacks-design.md`
**Status:** design approved, pending implementation plan
**Depends on:** `2026-08-09-multi-hit-full-walk-pr6-incoming-verification.md` (must merge first)
**Supersedes:** the epic's §6 "PR3 — debuff application inside the loop", dropped 2026-08-08

---

## 1. Why this is PR8 and not PR3

PR3 was dropped because its stated target was void: Enforcer's Defense Shred is an `on-crit`
**reactive**, already fixed by PR2, and the remainder was corpus-inert. That reasoning was correct
about PR3's *justification* and wrong about its *conclusion* — R1 says a multi-hit skill is N full
attacks, each running the entire pipeline including the debuff landing roll, and today direct
debuff clauses still land exactly once per cast. R1 is therefore true with an asterisk.

Decided 2026-08-09: close it completely. New number, new spec, because reviving PR3's document
would revive a premise that was disproved.

**This PR changes no observable behaviour in today's corpus.** That is expected, and it is why it
ships last: the value is that a future multi-hit ship with a debuff clause is correct on arrival
rather than silently applying one stack where the game gives N.

---

## 2. Why the obvious fix does not work

The landing roll is not merely *applied* once per cast — it is **drawn** once per cast, inside
`runPlayerTurn` (`playerTurn.ts:1580`, `landsDebuffOnVictim` / `landsTimedEnemyApplicationLive`),
which runs *before* the positional sub-attack loop and against a roster snapshot that predates it.
What `runPlayerTurn` returns is a list of closures already holding a drawn outcome
(`deferredEnemyApplications`, `playerTurn.ts:1598`), which the engine flushes after all N
sub-attacks have landed (`flushDeferredEnemyApplications`, `engine.ts:6615`).

So the landing decision structurally cannot see which victims a given sub-attack actually struck.
And R4 says **overkill retargets** — if sub-attack 1 kills its victim, sub-attacks 2–3 pick a new
living enemy, one the cast-time roll never considered.

Two shapes were rejected:

- **Draw N times in `runPlayerTurn`, flush N closures at the existing site.** Cheapest. Enforcer's
  stack count and the RNG draw count both become correct. Knowingly wrong under retargeting — the
  later stacks land on the dead victim's slot. Closes R1 with a different asterisk.
- **Move the landing decision wholesale into the loop**, inverting `runPlayerTurn`'s output
  contract from closures to a recipe. Purest, but it restructures a 3600-line function's contract
  and forces re-proving intra-cast clause order per sub-attack, in the epic's last PR.

---

## 3. The chosen shape — reuse PR2's sub-attack grouping

The positional loop already builds exactly the record needed:
`PositionalAttackedSignals` (`engine.ts:6659`) is a `Map<subAttackIndex, Map<victimId, signal>>`
recording which victims each sub-attack actually struck, with each inner signal carrying exactly one
`hitOutcomes` entry because a victim appears at most once per sub-attack.

PR8 flushes debuff landings against that grouping: **for each recorded sub-attack, in ascending
index order, roll the landing fresh against the victims that sub-attack actually hit.**

Retargeting is then correct for free — a victim killed on sub-attack 1 simply has no entry in
sub-attack 2's bucket, and the new victim does. This is the same drop-out story PR2 already relies
on and documents for `attacked` cardinality.

**What moves:** the landing *roll*, from `runPlayerTurn` to the per-sub-attack flush.
**What does not move:** the clause-order deferral itself. A clause written after the damage clause
is still held back — now held back within its own sub-attack rather than within the cast.

**`runPlayerTurn`'s output contract** changes from "closures already holding a drawn outcome" to a
per-victim landing recipe the engine invokes per sub-attack: which status, which recipient set,
which conditions, and whether it is `afterDamageClause`. The recipe is data; the roll is the
engine's.

**Non-positional paths are unchanged.** DPS and healing modes have one attack per call and no
footprint; they keep the single-flush behaviour they have today. As with every change in this epic,
N=1 must be byte-identical.

---

## 4. Invariants that must survive

1. **Intra-cast clause order, re-proved per sub-attack.** The locked rule is that a debuff clause
   written after the damage clause misses that cast's damage. Under PR8 it must miss *its own
   sub-attack's* damage — and, because the sub-attacks are consecutive real attacks, a stack landed
   by sub-attack 1 IS visible to sub-attack 2's damage. That is the substantive behavioural
   consequence of this PR and it needs its own test.
2. **The §4.5 Stasis-break re-inflict check** reads `inflictedEnemyDebuffs` back before the flush
   runs (`reInflictedStasis` in the engine). `inflictedEnemyDebuffs` is deliberately *not* deferred
   — it records what this cast inflicted, not store state. Deferring it once shaved a turn off a
   freshly applied Stasis. Keep it undeferred, and check what "this cast" means once there are N
   flushes.
3. **The display list.** `landedEnemyDebuffs` / `RoundData.activeEnemyDebuffs` is assembled before
   the deferred write runs, so the existing closure re-reads the live status and refreshes the row
   (`playerTurn.ts:1600`+). With N flushes, a persistent-stacking family must report N stacks, not
   one — the failure mode this code already guards against, now multiplied.
4. **Resist bookkeeping** gates this turn's `control-applied` emission and currently sits with the
   cast-time draw. Moving the draw moves it; verify the gate still sees what it needs.
5. **Team symmetry.** Three flush sites exist — focus (`engine.ts:8223`), walked team (`:8450`),
   enemy (`:9297`) — behind one helper. Keep one helper. Any per-owner map or runtime iteration
   added must sweep both `runtimesById` and `enemyPlayerRuntimeByActorId`, **and its callers must be
   checked for the same asymmetry** — that was half of #306's bug.
6. **Unconditional flush.** The current helper runs unconditionally so a cast that resolved
   non-positionally, whiffed, or killed its target still applies its debuff rather than dropping it.
   Under per-sub-attack flushing there is a new hole: a cast with *no* recorded sub-attacks. The
   fallback must still apply the landing rather than silently dropping it.

---

## 5. Tests

- **PR6's Tier 3 assertion flips.** PR6 pins `on-debuffed` / `on-debuff-resisted` firing once per
  cast, explicitly labelled as pre-PR8 behaviour. PR8 flips exactly that assertion to N and nothing
  else. If any other PR6 assertion moves, that is a regression, not expected churn.
- **N stacks from a multi-hit debuff clause**, both sides, using a synthetic ship — the corpus has
  none (PR6 re-measures and records this).
- **Retargeting**: sub-attack 1 kills its victim; sub-attacks 2–3 land their stacks on the *new*
  victim, and the dead one holds exactly one.
- **Independent landing rolls**: with a landing chance below 1, the number of stacks varies across
  seeds and the draw count is N, not 1. Pin via `setupKeyedTestRng` / `resetRateGateRng` with
  `mulberry32` — the engine is not deterministic on its own (`rateAccumulator.ts` uses
  `Math.random`). RNG is keyed by `ownerId`, which breaks cross-side amount comparisons; assert
  within a side.
- **Clause order within a sub-attack**, per §4.1.
- **N=1 byte-identical**: no golden may move for a single-hit ship.

---

## 6. Verification gates

Identical to PR6's §5: `npm run audit:placement-symmetry` at K=15 against the 2 / 146 / 13-13-13
baseline, full suite green at every commit boundary (husky runs the whole suite — a red intermediate
commit is not a legal state), `tsc --noEmit` and `npm run audit` clean, comment sweep across
production and `__tests__` alike.

Two additions specific to this PR:

- **The N=1 golden invariant is the primary signal.** This PR is corpus-inert, so a golden that
  moves is a bug in the change, not expected churn — the cheapest correctness check available.
- **Grep the old name repo-wide** for anything renamed. A rename behind an `as unknown as` cast is
  invisible to `tsc`.

No changelog entry: nothing user-visible changes in today's corpus. If that turns out to be false —
if a golden moves — stop and re-derive before writing one.

---

## 7. Out of scope

- Reactive debuff triggers (`on-crit` shred and friends) — already per-sub-attack since PR2.
- The Exposed 2-stack rule (R3 Amartya only) and the bomb death-splash question — independent.
- `teamActorWalk.ts:35`'s synthesized `hasChargedSkill` — deliberately per-path since #305.
