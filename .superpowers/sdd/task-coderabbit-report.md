# CodeRabbit review fixes — PR #366 (`fuying-faction-scope`, base `2e4fe597`)

Four findings addressed. All four are real; one (Fix 1) is a gameplay bug, one (Fix 2) was
half-real — the `parseExtendStatus` half needed fixing, the Stasis-gate half turned out to be
already correct and is now proven so by mutation rather than assumed.

---

## Fix 1 (Major) — a destroyed Fuying kept protecting her allies

### Approach chosen: **preserve the owner id on the distributed entry, filter dead owners at READ time**

Both candidate approaches were read before deciding.

**Rejected: rebuild the entries per round.** `incomingAbilitiesById` is built once inside
`runCombat`'s setup block, alongside a dozen sibling maps built the same way
(`standingLeeches`, `takenLeechesByOwner`, `incomingHealAmpAbilitiesById`, …). Rebuilding one of
them per round would (a) need the whole two-pass build hoisted into a function and re-entered from
the round loop, (b) be *coarser* than the rule needs — Fuying can die mid-round, between the ally's
hit in round N and another hit later in the same round, and a per-round rebuild reads liveness at
the round boundary rather than at hit time, and (c) put a mutable rebuild in the middle of a setup
block whose whole idiom is "computed once, positions and patterns are fixed".

**Chosen: read-time filter on the list accessor.** `incomingAbilitiesOf(id)` is already the single
funnel through which *every* per-hit consumer reads the list — the reduction fold, the block fold,
the `transform-incoming-to-dot` hook, the threshold-shield filter and the reflection filter all go
through it (engine.ts:5043, 5346, 5643, 5975, 6012, 7084, 9659, 9797, 10751). Putting the filter
there means:

- `incomingReductionForHit` keeps its exact signature — no caller touched, and the self-scoped
  family (Iridium, Anemone, Wusheng, Panon, Tormenter, Voron) is byte-identical *by construction*,
  not by inspection: a recipient with no ally-scoped entries short-circuits to the **same array
  reference**, so there is no copy and no filter on that path.
- Liveness is read live at hit time — the closure runs per hit and consults the owner's current
  `destroyedRound` via the engine's existing `isActorAlive` helper.
- Team-symmetric with no `side` check: `isActorAlive` reads the combat-wide `allActorsById`, the
  same source `affinityOf` / `actorById` use. The one enemy-side arm already in this file
  (`enemy-side mirror (item 4)`) is unchanged and still green.
- Every other ally-scoped incoming family that might arrive later inherits the rule for free.

### Changes

- `src/utils/combat/incomingEffects.ts` — new pure `withLiveAllyScopedOwners(abilities,
  ownerByAllyScopedAbilityId, isOwnerAlive)`. Returns the input array by reference when there are no
  ally-scoped entries; otherwise filters entries whose recorded owner is not alive. A lookup MISS
  keeps the entry (that is what preserves self-scoped entries sharing a list).
- `src/utils/combat/engine.ts` — the ally-scoped fan-out now records
  `allyScopedOwnerByRecipient: Map<recipientId, Map<abilityId, ownerId>>`, first-writer-wins so it
  mirrors `addIncomingAbilityDeduped`'s own id-keyed dedupe and can never disagree with the list it
  annotates. `incomingAbilitiesOf` wraps the lookup in `withLiveAllyScopedOwners(…, isActorAlive)`.
  Comments updated: the RECIPIENT SET is still computed once; the OWNER's liveness explicitly is not.
- Fuying's own self-reduction is untouched — she is not a recipient of her own aura (Not-Self
  pattern), and nothing in the change consults the victim's identity.

### Tests

`src/utils/combat/__tests__/fuyingFactionScope.integration.test.ts` — new section
*"a DESTROYED carrier stops protecting her allies"*. Board: Fuying focus at T2 with her real
`Pattern-Wings-Support-Not-Self-Range-2` (footprint {M2,M3,B1,B2,B3}); one Stealthed TIANCHAO ally
at M3; `enemy-1` at M1 firing `Pattern-Line-Range-2` @front every round (the **measured** hit); a
second enemy `killer` at T1 with a base pattern @front and speed 1, so it acts last in the round
and one-shots Fuying *after* round 1's measured hit has landed.

Three runs, because two cannot separate "she died" from "round 2 differs for another reason":

| run | round 1 | round 2 |
|---|---|---|
| aura + she dies | reduced 30% | **full** |
| aura + she survives (control) | reduced 30% | reduced 30% |
| no aura + she dies (yardstick) | full | full |

Preconditions asserted before any effect claim:
- the ally is hit in **both** rounds of **all three** runs (rounds observed are exactly `[1, 2]`),
  so nothing is `0 === 0`;
- Fuying is **actually destroyed in round 1** in both dies-runs (`ship-destroyed` for `attacker`),
  and **never** destroyed in the survives-run;
- the survives-run control proves the ally is still Stealthed, still inside the footprint and still
  being hit in round 2 — so round 2's recovery in the dies-run is attributable to her death alone.

One instrument bug caught and fixed while building this: the first draft summed **all** damage on
`ally-m3`. Once Fuying dies row T is empty, so the `killer`'s `front` anchor falls through to
`ally-m3` and dumped its 10,000,000 into the round-2 total, making the yardstick ~2000× the real hit.
The listener is now scoped to `attackerId === 'enemy-1'`, with a comment saying why.

Also added `src/utils/combat/__tests__/incomingEffects.test.ts` →
`describe('withLiveAllyScopedOwners …')`: same-array-reference short-circuit (both `undefined` and
empty map), keep-while-alive / drop-when-dead, a self-scoped entry surviving beside a dead owner's
ally-scoped one, and that liveness is asked about the **owner** id rather than the ability id.

### MUTATION (not just revert)

Mutated the liveness predicate in `withLiveAllyScopedOwners` to always-alive
(`return ownerId === undefined || true;`), leaving everything else in place:

```
× … a DESTROYED carrier stops protecting her allies > reduces the round-1 hit (she is alive for it)
  and NOT the round-2 hit (she is dead)
  Tests  1 failed | 40 passed (41)
```

Exactly the owner-death assertion went red; both PRECONDITION arms and the survives-run CONTROL
stayed green, so the instrument is not merely broken — it is measuring the specific thing.
Restored from a copy kept aside (`git checkout HEAD --` would have destroyed the uncommitted work),
verified `isOwnerAlive(ownerId)` back at line 109, re-ran → 41 passed.

### Changelog

New `UNRELEASED_CHANGES` entry inserted with the other Fuying entries in
`src/constants/changelog.ts`, plain English, no emojis, with the in-fight example (round 2 alive →
7,000; round 3 destroyed → the full 10,000).

---

## Fix 2 (Minor) — the named extend bypassed `resolveBuffName`

`src/utils/skillTextParser.ts`, `parseExtendStatus`'s named arm: `buffName: named[1].trim()` →
`resolveBuffName(named[1])`, and an **unresolved name now emits no `buffName` at all**
(`...(canonical !== undefined ? { buffName: canonical } : {})`), falling back to the safe
extend-everything behaviour instead of a literal that `extendAllBuffsDuration` can never match.
Doc comment extended to state the rule and why the inert failure mode is worse than the generous one.

Side effect, deliberate and desirable: `resolveBuffName`'s arabic→roman normalization now applies to
this arm too, so a future row writing "Attack Up 2" resolves to the canonical `'Attack Up II'`.

Tests, in `src/utils/combat/__tests__/fuyingStealthExtension.test.ts` (the named arm's home):
- unrecognised name (`Nebular Ague`, verified absent from `BUFFS`) → `{ turns: 2, statusKind:
  'buff' }` with **no** `buffName`;
- `Attack Up 2` → `buffName: 'Attack Up II'`.

Mutation: restoring `buffName: named[1].trim()` turned **both** new tests red (2 failed / 21 passed);
restored and re-ran → 23 passed.

### The Stasis gate — CHECKED, not assumed: already correct

`Ability.requireDamagedAllyStatus` has exactly one producer in `src/` —
`detectDamageReactionTrigger`'s `allyStatusName` (`skillTextParser.ts:2968`), consumed at
`buildShipAbilities.ts:3495`. It **already** reads `resolveBuffName(statusM[1])`, and there is
already a test for it (`fuyingStasisStealthGate.integration.test.ts`, *"yields NO gate for an
UNRECOGNISED status name"*). So the doc comment's claim is true.

Rather than assume, I proved that guard is not vacuous: mutated the parser to
`statusM[1].trim()` →

```
× … parser reads the ally-status precondition > yields NO gate for an UNRECOGNISED status name
  Tests  1 failed | 19 passed (20)
```

Restored → 20 passed. **No change needed on this path**; no code was touched for it.

---

## Fix 3 (Minor) — boards built at collection time, before the setup guard

New shared helper `src/utils/combat/__testutils__/lazyFixture.ts` — memoize-on-first-access, with a
`built` flag rather than a `cached === undefined` check so `undefined` stays a legitimate memoized
value. Its doc comment records why it exists (describe bodies run at collection, before `beforeAll`).

Applied at all four collection-time constructions, not the two named in the review:

- `reactivePatternScopeGate.integration.test.ts` — `const result = run()` at the (pre-change) lines
  744, 824 **and 1009**; the third one (`run({ ownerShielded: false })`, the shield-destroyed
  section) had the same defect and was not in the review. All usages rewritten to `result()`.
- `fuyingFactionScope.integration.test.ts` — `withAura` / `noAura` in the *"engine, on a real board"*
  describe body, plus the three boards in the new owner-death describe (written lazily from the
  start, now memoized so each runs exactly once across four arms).

### Verification — `docs/ship-data.json` temporarily renamed

**After the fix**, with the file moved aside:

```
Error: docs/ship-skills.csv and/or docs/ship-data.json are missing from this worktree
       (gitignored reference data) — needed to resolve real ship skill text/stats.   × 2 files
Test Files  2 failed (2)
Tests  83 skipped (83)
```

Both files report the guard's readable message, and all 83 tests are enumerated (a thrown `beforeAll`
reports as *skipped* in this repo — the known behaviour of this guard pattern).

**Before the fix** (same two files at `HEAD`, same missing data), for contrast:

```
Error: docs/ship-skills.csv and/or docs/ship-data.json are missing from this worktree …
Error: Fuying has no activePattern column          ← opaque COLLECTION crash
Test Files  2 failed (2)
Tests  37 skipped (37)                              ← 46 tests never even enumerated
```

`docs/ship-data.json` restored (`63404` bytes, mtime intact); the two files re-run green: 83 passed.

---

## Fix 4 (docs) — three stale documents

All three live under gitignored `docs/` and were already tracked (force-added earlier on this
branch); re-staged with `git add -f`.

1. **`docs/superpowers/specs/2026-08-22-fuying-faction-scope-design.md`** (§"Consequence: an
   unenforced gate" + §8). The "**Owner decision needed on scope**" line is gone. The section is
   retitled *"measured, then CLOSED on this branch"*, states that the owner widened the branch and
   **both** gates shipped, and documents the accepted behaviour as three numbered rules: (1) the
   damaged ally must hold the named status, read through `resolveBuffName` (unrecognised → no gate),
   carried as `requireDamagedAllyStatus`, matched EXACTLY against live self-statuses, unreadable
   statuses never satisfying it, plain live read because being hit does not consume Stealth; (2) the
   affected ally must stand inside the active pattern — `patternScoped` honoured on the
   affected-ally axis, not just the recipient axis; (3) **no cap invented**. Coverage files named.
   §8's bullet is rewritten so it no longer lists the ability as "not a gap": the *parse* was never
   the gap, the two *gates* were and are now closed, and **the multi-hit-tripwire coverage note
   stays on #357 verbatim**.
2. **`docs/superpowers/plans/2026-08-22-fuying-faction-scope.md`** (~:507) — the duplicated
   `import … from 'vitest'` line: only the `beforeAll`-carrying one remains.
3. **Same plan, Step 5 (the aura fan-out sample)** — the stale sample is replaced by the shipped
   shape, under an explicit **"⚠️ SUPERSEDED — do not implement it"** blockquote naming all three
   ways it was wrong: (a) it distributed to every living same-side actor with only the faction
   filter, written before the owner ruled the aura pattern-limited (shipped code threads the
   footprint via `allyScopedIncomingRecipients` when `patternScoped`); (b) its "the owner IS a
   recipient" note argued the aura is *not* footprint-narrowed — the no-exclusion **rule** survived
   but its **reason** changed (Not-Self pattern omits her cell); (c) it said the self-scoped
   collection pass "must be left untouched", when that pass must gain the
   `incoming-reduction` + `all-allies` skip or it keys the aura onto its own carrier un-narrowed.
   The replacement sample also shows the owner map + the read-time liveness filter from Fix 1.
   The stale line in Step 9's commit message ("a passive that does not name the pattern reaches
   allies wherever they stand", and the matching owner-inclusion paragraph) is corrected to the
   shipped ruling.

---

## Commands and results

| command | result |
|---|---|
| `npx tsc --noEmit` | clean, no output (run after Fix 1, after Fix 2/3, and after formatting) |
| `npm run lint` | **0 problems** (`eslint src --ext ts,tsx --report-unused-disable-directives --max-warnings 0`) |
| `npx tsx scripts/auditSkills.ts` | `Audited 149 ships → 0 findings.` (ally-scoped grants: 87 all-allies, 12 single-ally) |
| `npm test` (full suite) | **565 files passed / 6273 tests passed, 0 failures** (baseline 565 / 6263 → +10 new tests: 4 owner-death + 4 `withLiveAllyScopedOwners` + 2 parser) |
| `npx vitest run fuyingFactionScope + reactivePatternScopeGate` | 83 passed |
| `npx vitest run incomingEffects.test.ts` | 28 passed |
| `npx vitest run fuyingStealthExtension.test.ts` | 23 passed |
| `npx vitest run fuyingStasisStealthGate.integration.test.ts` | 20 passed |
| Fix 1 mutation (liveness → always-alive) | 1 failed / 40 passed — **only** the owner-death assertion; preconditions + control stayed green |
| Fix 2 mutation (`named[1].trim()`) | 2 failed / 21 passed |
| Stasis-gate mutation (`statusM[1].trim()`) | 1 failed / 19 passed → the existing guard is real |
| Fix 3 renamed-file check | after: readable guard message ×2, 83 enumerated. before: opaque `Fuying has no activePattern column` collection crash, only 37 enumerated. File restored. |
| `git diff -- '*.snap'` | **empty** — no snapshot moved (no scenario in the fingerprint corpus kills Fuying) |
| `git diff -- '*.snap' \| grep -c '^+exports'` | **0** |
| `npm run format` | **not run** (`npx prettier --write` on the two files I edited only, after `--check` flagged them) |

`npx vitest -u` was never used.

## Commit

- `e6951303` — `fix(engine,parser): Fuying's ally aura stops when she dies; the named extend resolves its status (#363)`

The `.husky/pre-commit` gate ran on it: `lint-staged` (eslint --fix + prettier --write over the 9
staged `src/**/*.{ts,tsx}` files, no further modifications), `npx tsc --noEmit`, then the full
suite — **565 files passed / 6273 tests passed**. Working tree clean afterwards; `git diff HEAD~1 --
'*.snap'` has 0 `^+exports`.
