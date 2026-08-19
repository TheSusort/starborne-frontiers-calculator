# SP-4c — the match ends when a side is wiped, then the dummy deletes

Date: 2026-08-18
Epic: [DPS real enemy and buff timeline](2026-08-11-dps-real-enemy-and-buff-timeline-epic-design.md)
Supersedes: the `PR 4b` / `PR 4c` split in [SP-4 retire the dummy](2026-08-13-sp4-retire-the-dummy-design.md) §6

Status of the ladder at the time of writing: SP-1, SP-2, SP-3, SP-4a (#322), SP-4b-1 (#324),
SP-4b-2a (#325), SP-4b-2b (#326) and the leech class-sweep (#328) are all on `main` at `0076293a`.

---

## 1. Why this step is two PRs and not one

The SP-4 spec planned 4c as "delete the scalar input surface" on the assumption that 4b would have
already deleted the dummy. That is not what happened: 4b was split three ways (4b-1 normalization,
4b-2a DPS-real-enemy, 4b-2b roster-required), all of which made the dummy *unreachable as a
discriminator* without deleting the actor. So "delete the dummy" is still open, and it is what
SP-4c means here. The scalar input surface moves to 4d and the heal routes to 4e.

The step then splits again, for a reason discovered during design rather than planned:

**The engine has no roster-wipe termination.** The owner's statement of the game rule (2026-08-18):

> in game, when there's no more enemies, the match will end mid round, after the turn that kills the
> last opposing ship ends. there are however 1-2 special npc enemies that doesn't die at 0 hp, where
> buffs/debuffs continue to be applied.

The engine does not do this. Nothing in the round loop breaks on a wiped roster — the only two
`break`s are `dpsEnemyTarget && enemy.destroyedRound !== undefined` (dead code, see §4) and
`isDpsMeasurementRun && attacker.destroyedRound !== undefined` (focus death). A run therefore
continues for its full window after the last enemy dies, and every player cast in those rounds
resolves no living victim and falls through to the dummy. That is the **mid-run whiff window**, and
it is the single thing keeping the dummy's fallback (cluster C) reachable.

Which means: **the whiff window is not a game state, it is a missing termination rule.** Implement
the rule and the fallback becomes unreachable, and the deletion needs no stand-in victim at all.

Two churn stories, therefore two PRs — the same reason 4b and 4b-2 split:

| PR | Story | Churn expectation |
| --- | --- | --- |
| **4c-1** | A semantic change: matches now end when a side is wiped, and the fixtures that deliberately kill their only enemy gain an inert survivor (§3.5) | Movement confined to fixtures that reached the fallback, or whose run outlived a wipe |
| **4c-2** | A mechanical deletion: the dummy actor and clusters A–G | **Zero golden movement** |

A >100-file PR gets no CodeRabbit review at all while its check still passes (recorded on #322).
Both PRs here are expected well under that; if 4c-1's fixture migration pushes past it, split the
migration out rather than accept the silent gap.

---

## 2. Design decisions taken during brainstorming

Each of these was an owner ruling, recorded here so the plan does not re-litigate them.

**2.1 The fallback victim.** First ruled "whiff against a corpse" — the fallback becomes the
front-most opposing roster member rather than the dummy, preserving cadence and self-buffs. Then
**superseded within the same session** by the match-end rule: with termination in place nothing
reaches the fallback, so no corpse concept is built at all. Recorded because the reasoning still
governs the one residual case (§3.4).

**2.2 Churn stance — accept and attribute.** Victim-derived gate context (`enemyHpPct` and friends)
reads the truth about the victim, not a dummy's flattering ~100%. Any golden that moves gets a named
cause in the PR body: which fixture, which gate, which ship. A move *outside* the predicted set is a
defect signal, never something to re-pin.

**2.3 Full victim — both context guards drop (4c-2).** `engine.ts` carries two guards keyed on
`tgt.id !== enemy.id` (search `targetId: tgt.id` and `enemyDebuffNames: enemyDebuffNamesForTarget`):
when the dummy resolved, `targetId` is omitted so ability debuffs land in the side-wide `__enemy__`
store, and `enemyDebuffNames` is omitted so round contexts fall back to the name-agnostic
`enemyDebuffCount` path.

In game terms the sentinel store is wrong: Corrosion applied to the front ship sits on *that ship*,
and a "+30% to enemies affected by Corrosion" gate reads the ship it is about to hit. Under sentinel
routing the same Corrosion fires that gate against every enemy, including untouched ones, and keeps
firing after the Corroded ship is dead. Both guards go; routing is per-actor unconditionally.

The **scheduled** channel is the legitimate survivor and stays in `__enemy__`: the calculator input
that asserts "assume the enemy is Corroded" is a modelling assumption about an unspecified opponent,
not an in-match effect, and `upsertBuff` hardcodes its target.

**2.4 Ordering — termination first.** So that 4c-2 is a deletion against a provably unreachable
path, rather than a deletion plus a temporary concept that a third PR removes.

---

## 3. PR 4c-1 — the match ends when a side is wiped

### 3.1 The rule

After any turn ends, if either side has no living member, the match is over.

- **Turn-granular.** The round's remaining turns do not happen. The owner's wording is explicit:
  the match ends *after the turn that kills the last opposing ship ends*, not at the round boundary.
- **The partial round still reports.** The round's row is assembled from the turns that did happen
  and pushed, so the killing turn's damage is in `roundData`. Discarding it would repeat the defect
  the focus-death exit already fixed once (a break before row assembly silently dropped a team
  actor's damage from `cumulativeDamage`, `rawTotals` and `perTargetDealt`).
- **Team-symmetric.** Fires for either side, per the locked rule that engine work is symmetric.

### 3.2 Where it goes

The bottom of the turn-loop body in `runCombat`, after the `turn-ended` emit and the
`drainIntentsFor('player')` / `drainIntentsFor('enemy')` pair that closes each turn (search
`bus.emit({ type: 'turn-ended'` — the site sits just above the turn loop's `finally`).

The `finally` block that follows already resets `inTurnLoop` on *any* loop exit, and its own comment
anticipates this change:

> The reset lives in `finally` so it is structurally guaranteed on ANY loop exit (normal, break,
> return, throw) — a future early exit added to the round loop can no longer leave `inTurnLoop`
> stuck true and mis-dispatch the post-round drain as Path A.

So the shape is: set a `matchOver` flag → `break` the turn loop → the round tail assembles and
pushes the row as normal → `break` the round loop after the push, alongside the existing exits.

### 3.3 The death signal — CORRECTED DURING IMPLEMENTATION

⚠️ **This section originally specified `currentHp > 0` as the liveness test. That was WRONG and the
suite proved it: 346 tests across 68 files failed, every DPS run ending after a single round.**

The focus attacker's `hp` is optional and most direct-engine fixtures omit it — it was unobservable
while nothing could kill the focus — so the focus is built with max HP 0 and therefore starts at
`currentHp === 0` without ever having been destroyed. `currentHp <= 0` read that as a corpse and
declared the player side wiped on turn 1.

**The predicate keys on `destroyedRound !== undefined`**, the stamp `recordDestroyed` writes when a
ship is actually killed. That is also the faithful encoding of the rule as stated: the match ends when
the last opposing ship is *killed*, not when something happens to be sitting at zero.

```ts
const sideIsWiped = (): boolean =>
    enemyAttackerActors.every((a) => a.destroyedRound !== undefined) ||
    allPlayerActors.every((a) => a.destroyedRound !== undefined);
```

**A never-alive side is not a wipe.** This is what makes the 0-max-HP "pressure source" roster safe:
its members were never destroyed, so those runs continue exactly as before — see §3.5.

### 3.3b A round can now end before the focus acts

Turn-granular termination introduces a second way to reach zero focus turns in a round, on a **living**
focus: a team actor or an enemy lands the wiping kill before the focus's turn comes up. The
round-assembly guard threw on exactly that ("produced no focus actor turn"), 13 tests' worth.

The engine already synthesizes a zero-damage skip turn when the focus DIED before acting, and the
remedy is identical for the identical reason — the round's per-round maps still hold the earlier
actors' damage, and breaking out before assembly would discard it. The condition becomes
`attacker.destroyedRound !== undefined || matchOver`.

### 3.4 Interaction with the existing exits

- `dpsEnemyTarget && enemy.destroyedRound !== undefined` — already dead code (§4), deletes in 4c-2.
- `isDpsMeasurementRun && attacker.destroyedRound !== undefined` — **stays.** A healer dying while
  its allies live is not a wipe, and two-team and healing modes legitimately continue past focus
  death; both are pinned (`twoTeamBattle.test.ts` — "a supporter keeps granting its buff + shield in
  rounds AFTER the focus dies"; `healingGoldenParity` — "lethal pressure (target dies mid-run…)").
  The new rule subsumes neither; it is a third, independent exit.

### 3.5 The pressure-source fixtures — NO MIGRATION NEEDED (corrected)

⚠️ **This section originally required migrating 13 measured 0-max-HP "pressure source" fixtures. The
`destroyedRound` correction in §3.3 made that unnecessary, and none were touched.**

A pressure source has max HP 0, so it starts dead-looking but is never *destroyed* — no
`recordDestroyed`, no `destroyedRound`. Under the corrected predicate its side is not wiped, the run
continues, and every one of those fixtures is byte-identical. They keep their legacy-sink coverage
intact for SP-4c-2 to deal with, which is strictly better than migrating them here.

**The fixtures that DID need work were a different set entirely** — ones that kill their *only* real
enemy on purpose, usually a 1-HP bot that must not live to re-apply a debuff. Each got an inert
survivor (0 attack, no skills, speed 1 — RNG-stream-inert, last in every turn order) so the
deliberate kill is no longer a wipe: `stasis` (5 cases), `disable` (2), `chronoReaverCharge`,
`reactiveExtraAction`, `protectionTransfer` (2), `leech`, and three `healing` Cheat-Death cases
where the solo heal target *was* the whole player side.

**Generalise:** the shape that breaks under a termination rule is not "a roster that looks dead", it
is "a fixture that kills something on purpose and then expects the fight to carry on".

### 3.6 Churn expectation

Movement is confined to two sets:

1. fixtures that reached the fallback (the pressure-source list above), and
2. fixtures whose run outlived a wipe — anything that killed its roster before the window closed and
   silently kept running.

Set 2 is not enumerable in advance; the suite enumerates it. That is the intended method (4b-2b's
lesson: when a contract change has unknown blast radius, make the violation loud and let the suite
list it). Movement outside both sets is a defect signal.

### 3.7 Tests

Per side, a wipe fixture asserting three things — the third is what stops it going vacuous:

1. the partial round's row exists and carries the killing turn's damage (`perTargetDealt` names the
   killer and the victim);
2. `rounds.length` stops at the killing round — no round follows;
3. the actor that would have acted next in that round emitted **no** `turn-started`. Without this
   the test cannot tell turn-granular termination from round-granular.

Plus a control: a run whose roster survives the window is unaffected, so termination is not firing
spuriously.

---

## 4. PR 4c-2 — delete the dummy

Pure deletion. Cluster names follow the SP-4 spec's inventory §5; line numbers are omitted in favour
of symbols, because ~7 of 27 new `engine.ts` citations in 4b-2b were stale by 40–80 lines before that
PR even merged.

| Cluster | What deletes |
| --- | --- |
| **A** | `createActor({ id: 'enemy' })` — the four scalars' only consumer |
| **B** | `dpsEnemyTarget` and its three branches: the round-tail `applyVictimDamage(roundEnemyDamage, enemy, …)`, the reactive-resolver `enemy.destroyedRound === undefined ? enemy.id : undefined` arms, and the `dpsEnemyTarget && enemy.destroyedRound` break |
| **C** | The **player-side** `TurnBindings.legacyVictim` and `selected ?? tb.legacyVictim` in `selectTurnTarget` |
| **D** | `isDummyEnemy`, the dead-actor-skip exemption (`a.destroyedRound === undefined \|\| a.id === enemy.id`), the `turnOrderActors` filter, and the `dummyEnemyIsVestigial` gate on the D5 scheduled-debuff decrement — which becomes unconditional |
| **E** | The round-tail `enemyHpDecline` block, the dummy's coarse integer `hp-changed` tap, `enemyFinalHpPct`, and the `enemyOutcome` return field |
| **F** | Both `tgt.id !== enemy.id` context guards (§2.3), the `victim.id !== enemy.id` HP-path backstop, and the `holder.id === enemy.id` skip |
| **G** | The `[enemy.id]` condition-context defaults; `hasPositionedEnemyRoster` collapses to constant `true`; `reservedActorIds` keeps its reservation but sources it from `SENTINEL_ENEMY_ACTOR_ID` (§4.3) instead of a live actor |

### 4.1 Why B is safe to delete outright

`dpsEnemyTarget` is `enemyAttackerInputs.length === 0`. Since 4b-2b, `normalizeCombatRoster` —
`runCombat`'s first statement — throws `enemyAttackers is empty` on that shape. So the discriminator
is **provably constant false** for every caller, production or fixture. It is not absent, it is
unreachable, which is what makes the deletion tractable rather than speculative.

`enemyOutcome` (`survived` / `roundsToKill` / `finalHpPct`) has had **no production consumer since
4b-2a** — `dpsSimulator` re-derives all three from its own `ship-destroyed` bus tap. Only
`indestructibleDeath.test.ts` reads them, and that file's header already records them as
`dpsEnemyTarget`-only properties that go with the dummy.

### 4.2 What stays, and why

- **`enemyType`.** Fight-wide condition context, independent of the dummy actor (which carries no
  class field). Deleting it needs per-actor class plumbing plus per-victim `enemy-type` gating — new
  scope. Corrosion is safe either way: its `enemyHp` already arrives per victim via `victimMaxHpFor`
  / `recipientMaxHp`, never from `input.enemyHp`.
- **The four scalar inputs** (`enemyHp`, `enemyDefense`, `enemySpeed`, `enemySecurity`). After 4c-2
  nothing reads them, but `enemyHp` is a **required** field of `CombatEngineInput`, so deleting it is
  a ~200-file mechanical churn story — that is 4d.
- **The enemy-side `legacyVictim: healTarget`.** Not a dummy: it is the healing calculator's anchor,
  and retiring it is 4e's job (the non-positional heal routes). 4c-2 touches the player side only.
- **The `__enemy__` scheduled-debuff channel** (§2.3).

### 4.3 The sentinel identity

The side-wide scheduled-debuff bucket has no carrier, but its `buff-expired` emit needs an
`actorId`. Introduce a module constant — `SENTINEL_ENEMY_ACTOR_ID = 'enemy'` — and emit under it.

Keeping the literal string preserves the event stream byte-for-byte across the deletion, and the
name is honest about what it is: an id for a bucket, not a claim that an actor exists. Attributing
the bucket's expiry to one positioned enemy instead would be the same lie `finalHpPct` told when it
silently described only `enemyAttackers[0]`.

**The id stays reserved.** `reservedActorIds` currently reserves `enemy.id` because a colliding
roster member would clobber a map entry. Deleting the actor must not free the string: a caller could
then legitimately name an enemy attacker `'enemy'`, and its events would interleave with the
sentinel bucket's under one id — a collision that is invisible in the log and impossible to
attribute after the fact. Reserve `SENTINEL_ENEMY_ACTOR_ID` explicitly.

### 4.4 The entry gate

`__getDummySinkCreditCount()` must read **0** across every shape before the deletion lands.

⚠️ Do **not** gate on `__getLegacyVictimFallbackCount()`. The two counters measure different things
and only the credit counter can be required to be zero: consultations are legitimately non-zero in
the whiff window, where selection hands back the fallback while the apply gate stays positional and
books nothing. 4c-1 should drive both to zero as a side effect of removing the window — but the
*gate* is the credit counter, because a zero there means the dummy absorbed nothing and deleting it
loses no accounting.

**POST-4c-1 UPDATE — the counters no longer come apart.** The whiff window was the only shape that
consulted the fallback without crediting it, and 4c-1 deleted it. The ONE remaining consumer is the
0-max-HP pressure source (§3.5), which both consults AND credits, because a never-alive actor is
never destroyed and so its run continues. Either counter would now serve as the gate; the credit
counter stays the right choice because it is the one that means "the dummy absorbed nothing".
Pinned in `dummyReachability.test.ts` — read that file first, its two whiff cases were re-aimed.

Read the counter's units before quoting it: it counts **rounds in which the dummy's HP declined**,
measured at the round-tail scalar branch — not individual hits, and not any per-victim booking.

### 4.5 Churn expectation

**Zero golden movement.** 4c-1 already moved everything that moves. Any movement in 4c-2 means 4c-1
missed a path — investigate, do not re-pin. This is the proof the ladder was ordered correctly.

### 4.6 Tests

- All six `dummyReachability.test.ts` paths re-run with both counters at 0, each keeping its positive
  half (a `turn-started`, a `perTargetDealt` row naming the victim, a `ship-destroyed`, a changed
  victim id) so a zero from a case that never ran its path stays impossible.
- A structural assertion that no **actor** carries id `'enemy'` in `allActors` on any run, paired
  with one that `runCombat` still **rejects** an enemy attacker named `'enemy'` (§4.3) — the pair
  fences the reservation in both directions, the way #318's widened gate had to be fenced both too
  strict and too loose before `hasPositionedEnemyRoster` could be called the narrowest correct
  signal.
- `indestructibleDeath.test.ts` loses its two `dpsEnemyTarget`-only cases (its header already marks
  them as such); the other four properties already measure the real positioned enemy.

---

## 5. Out of scope, flagged

**Indestructible NPCs.** The owner reports 1–2 special enemies that do not die at 0 HP and keep
receiving buffs and debuffs. **This mechanic is not modelled anywhere today** — the only
"indestructible" thing in the engine is the dummy itself, and `indestructibleDeath.test.ts` is about
the dummy, not about a boss. Under §3.1's rule such an NPC would need an explicit actor flag that
keeps it *living* at 0 HP, so the match does not end and the roster stays targetable. It is a natural
follow-on once the dummy is gone (the flag would otherwise be indistinguishable from the dummy's
immortality), and it is the sharpest argument for §2.3's full-victim routing: a boss accumulating
debuffs at 0 HP is a real ship with a real debuff list, not a bucket.

**The OR-run hazard** (open owner ruling from #328) is untouched here: `splitDrainGateConditions`
splits a flat condition set while `conditionsMet` groups consecutive `anyOf` runs, so removing a
condition from the middle changes the boolean structure. Parser-unreachable but authorable in the
ability editor. It does not block either PR.

**4d** (delete the four scalar inputs) and **4e** (retire the non-positional heal routes, both
mirrored `lowestHpAllyId` sites together) follow this step unchanged from the SP-4 spec.

---

## 6. Method notes carried in from earlier rungs

- **`grep -q` is unreliable in this shell** — `grep` is a ugrep function wrapper, and it reported all
  201 files as matching nothing during 4b-2b. Measure caller and fixture sets with a node script.
- **Pair every line citation with the symbol it points at**, so a stale number self-corrects.
- **Before believing "X differs from Y", run X-vs-X.** The engine is not deterministic
  (`rateAccumulator.ts` uses `Math.random`); pin with `setupKeyedTestRng` + `resetRateGateRng`. A
  comparison without a same-input control cannot distinguish a real difference from its own
  nondeterminism — 4b-2b's Task 8 reported a fabricated result for exactly this reason.
- **The strongest blast-radius evidence is a restored number, not an explained one.**
- **Never `vitest -u`.** The golden audit spans the whole `npm test`; husky pre-commit is the gate,
  as there is no CI test workflow.

---

## 7. AMENDMENT (2026-08-19) — §4 was measured wrong; 4c-2 re-splits into four rungs

§4 was written from code reading. Before planning 4c-2 the three dummy sites were instrumented with
`console.error` probes and the **whole suite run three times** (529 files / 5867 tests green each
time, ~25s per run), reading the per-file counts out of vitest's `stderr | <file>` headers. The
measurement contradicts §4 on three points. Numbers are against `main` at `8d2c2a61`.

| §4 claim | Measured |
| --- | --- |
| §4.4 entry gate: `__getDummySinkCreditCount()` "must read **0** across every shape" | **412 credits in 26 files.** The gate is NOT met on `main`. |
| Cluster C: the whiff window was the fallback's last consumer, and 4c-1 deleted it | **4,188 player-side consultations resolving to the dummy.** The whiff window is indeed gone; the real consumer is **ally-targeting player actors** (`dummyEnemyIsVestigial === false` while `hasPositionedEnemyRoster === true` — 3,128 turns' worth). |
| Cluster D: the dummy "is dropped from the turn order" once positional | **3,902 dummy turns in 73 files**, including `realKitFingerprints` (1,800), `placementSymmetry` (760) and `simGolden` (94). Only **19** tick live containers; the other **3,883** are no-op turns that still emit a `turn-started`/`turn-ended` pair. |
| §4.5: "**Zero golden movement**" | False for the deletion as specced — it removes 3,883 event pairs from suites that fingerprint the stream. |

§4 was right about the *cause* of the credits being a single shape: **all 412 come from an all-0-max-HP
enemy roster** (`hasPositionedEnemyRoster === false`), with no other shape contributing. It was wrong
that 4c-1 had driven that to zero, and wrong about cluster C's remaining consumer.

### 7.1 The roster-shape census (why the fix is one rule, not a fixture migration)

Probing every `runCombat` construction: **3,004 invocations — 2,697 all-targetable, 307 all-zero-max-HP
(284 single-member, 23 two-member), and ZERO mixed rosters.** No run anywhere in the corpus pairs a
0-max-HP member with a targetable one. So "floor every 0-max-HP member" and "floor only a side with no
targetable member" are behaviourally identical here, and the uniform rule is free: take it, because it
retires the whole class rather than one instance of it.

The 307 break down as **288 `mode: 'healing'`, 13 no mode, 4 `battle`, 2 `dps`** — this is
overwhelmingly a hand-built healing-fixture idiom: an enemy that exists to apply pressure to the heal
target, whose own HP is not modelled. `healingEngineAdapter` already knows the shape is a hazard and
fills it (`hp: e.stats.hp ?? LEGACY_SINK_HP`, `LEGACY_SINK_HP = 1_000_000`) — but `??` only catches
`undefined`, and these fixtures pass an explicit `0`.

### 7.2 Owner rulings (2026-08-19)

**7.2.1 Auto-clamp, not reject.** `normalizeCombatRoster` gains a fourth responsibility: floor any
enemy attacker whose max HP is absent or `<= 0` to `LEGACY_SINK_HP`'s value. This is the sibling of
4b-1's endorsed auto-placement — one boundary, no per-fixture escape hatch, and no fixture *input*
edits. Rejecting (a throw, mirroring 4b-2b) was considered and declined: it costs 54 files of input
churn plus a UI error path for no behavioural gain.

**7.2.2 The turn-order deletion is its own rung**, so the final deletion PR stays genuinely
zero-movement and any unexpected movement there remains a defect signal rather than noise.

### 7.3 The production bug this exposed

`EnemySettingsPanel.tsx:90` reads Enemy HP as `parseInt(e.target.value) || 0` with **no `min` and no
clamp**. Clear that field on the DPS page and the run gets a 0-max-HP enemy → `hasPositionedEnemyRoster`
false → the whole fight drains into the invisible dummy and `perTargetDealt` is `undefined` for every
round. Since SP-1, `simulateDPS` derives its total *from* `perTargetDealt` (`dpsSimulator.ts:684`), so
**the page reports 0 DPS**. The same shape the 54 fixture files use, reachable from the UI. 7.2.1's
floor fixes it at the engine; the input also gets a clamp so the user sees the HP they will fight.

### 7.4 The re-split

| Rung | Story | Churn |
| --- | --- | --- |
| **4c-2a** | The targetable-roster contract: floor 0-max-HP enemy attackers at the boundary | The 54 all-zero-roster files; drives the credit gate to 0. Fixes §7.3 |
| **4c-2b** | The no-victim player turn: `selectTurnTarget` returns `tgt: undefined` on the player side instead of `tb.legacyVictim`, as the enemy side already does (1,341 measured rows prove that path works) | The 4,188 consultations; both §2.3 context guards drop here |
| **4c-2c** | Drop the dummy from the turn order unconditionally; the D5 scheduled decrement becomes unconditional | The 3,883 no-op turn events across 73 files, 3 of them golden suites |
| **4c-2d** | Pure deletion: the actor + clusters A/B/D/E/F/G, `SENTINEL_ENEMY_ACTOR_ID` per §4.3 | **Zero movement** — now genuinely, because a–c moved everything |

§4's cluster table stays correct as the *inventory* for 4c-2d. What it got wrong was the entry
condition and the churn expectation, both of which a–c now establish.

### 7.5 Method note earned here

**§4's cluster inventory was read, not measured, and three of its four load-bearing claims were
wrong.** Every one was falsified by the same cheap technique: a `console.error` at the site, one full
suite run, and per-file aggregation from vitest's stderr headers — ~25 seconds each. The generalisation
for the rest of the ladder: *a claim about whether a path is reachable is a measurement, not a reading.*
The counter-based gate in §4.4 was itself an attempt at this, and it failed because it was quoted from
a doc comment instead of being run.
