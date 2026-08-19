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
floor fixes it at the engine, and that is the WHOLE fix: the input gets `min="1"` as a browser hint only. A handler clamp was shipped and then reverted — a clamped `hp: 1` dies in round 1 under §3.1's wipe rule, misrepresenting every multi-round mechanic, and a second clamp in the UI is a second accommodation site. §7.2.1's boundary is the single one.

### 7.4 The re-split

| Rung | Story | Churn |
| --- | --- | --- |
| **4c-2a** ✅ SHIPPED | The targetable-roster contract: floor 0-max-HP enemy attackers at the boundary | The 54 all-zero-roster files; drives the credit gate to 0. Fixes §7.3 |
| **4c-2b** ✅ SHIPPED | The no-victim player turn: `selectTurnTarget` returns `tgt: undefined` on the player side, and the two player call sites **RUN the turn anyway** — the enemy side's cadence-only skip is NOT the template (a skip silences all 24 shipped ally-target support ships). Both §2.3 guards drop for free: the ghost's id was always `'enemy'`, so they already omitted `targetId`/`enemyDebuffNames` on these turns | **3,206** player consultations, all ally-side (2,311 `allies` / 622 `other-allies` / 195 `all-allies` / 78 `self`; 14 of the 2,311 are §A.7's mixed/no-skill cases) — NOT 4,188, which predates 4c-2a and lumped both sides together. Golden movement: **3 fingerprints** (AEGIS/Hermes/Mender), one mechanism |
| **4c-2c** ✅ SHIPPED | Drop the dummy from the turn order unconditionally; the D5 scheduled decrement becomes unconditional | ~~The 3,883 no-op turn events across 73 files, 3 of them golden suites~~ — **this cell was wrong by two orders of magnitude.** Measured on `f1bce838` with both switches applied: **2 failing tests in 2 files** (`dummyEnemyTurnGate`, `dummyReachability`), 5,890/5,892 still passing, **ZERO golden movement**, oracle at the exact baseline `147 / 146 / 2`. The estimate was taken at `8d2c2a61`, before 4c-2a and 4c-2b between them did the work. See §9.1 |
| **4c-2d** | Pure deletion: the actor + clusters A/B/D/E/F/G, `SENTINEL_ENEMY_ACTOR_ID` per §4.3. **Inventory corrected by §9.4:** it LOSES `dummySinkCreditCount` (deleted in 4c-2c) and GAINS the whole dummy turn body at `engine.ts:9955`–`:10035`, the dead `isDummyEnemy` Post-Turn arm, the dead-actor-skip exemption, the dummy's membership in `dotCarrierActors`, and the new `retiredDummyTurn.test.ts` | **Zero movement** — expectation unchanged, and better founded than when written, because a–c moved everything and the residue is now inventoried rather than estimated |

§4's cluster table stays correct as the *inventory* for 4c-2d. What it got wrong was the entry
condition and the churn expectation, both of which a–c now establish.

### 7.5 Method note earned here

**§4's cluster inventory was read, not measured, and three of its four load-bearing claims were
wrong.** Every one was falsified by the same cheap technique: a `console.error` at the site, one full
suite run, and per-file aggregation from vitest's stderr headers — ~25 seconds each. The generalisation
for the rest of the ladder: *a claim about whether a path is reachable is a measurement, not a reading.*
The counter-based gate in §4.4 was itself an attempt at this, and it failed because it was quoted from
a doc comment instead of being run.


---

## 8. AMENDMENT (2026-08-19) — what 4c-2b actually cost, and what it hands to 4c-2c/4d/4e

Plan: `docs/superpowers/plans/2026-08-19-sp4c2b-no-victim-player-turn.md`. Measured facts and the
site-by-site contract: `.superpowers/sdd/sp4c2b-contract.md` (§A). Ledger: `.superpowers/sdd/progress.md`.

**§7.4's one-line description of 4c-2b was materially incomplete in two ways.**

**8.1 The literal instruction was a bug.** "Returns `tgt: undefined` on the player side, as the enemy
side already does" met an existing `if (tgt === undefined) continue;` at both player call sites. The
enemy side's handling is a **cadence-only skip**, and copying it would have silenced every one of the
**24 shipped ally-target ships** — every healer, shielder and buffer — from its first cast onward. The
player side must RUN the turn with no victim. The rung therefore needed four zero-movement commits
building that path (`runPlayerTurn` tolerating an absent victim, `buildTurnArgs` omitting the
victim-derived args, the call sites no longer skipping) before the two-line switch could land.

**8.2 A second owner ruling was required mid-rung.** Fencing the victim-derived computation exposed a
defect: `runtime.liveDebuffLandingChance` is derived from THIS turn's target but **published as
standing state** and later consumed for a DIFFERENT target. Fenced to 0 on a no-victim turn, it
silenced a supporter's own REACTIVE debuffs permanently — visibly for Flamel, silently for Makoli
(whose gate needs sub-40% HP the fixtures never reach). **Owner ruling: an inflict rolls against the
enemy it is actually hitting** (per-victim security; the per-victim affinity was already threaded), and
that fix ships in this rung as its own commit. Generalisable defect shape: *fencing a computed value is
only safe if the value is not also published.*

**8.3 What 4c-2c must know.** Two doc blocks were correcting each other; both were fixed here, but the
reason matters. `engine.ts`'s dummy-turn-order rationale still asserted "the dummy **is still the
offense sink** and MUST stay in the turn order — dropping it would strand every DoT/bomb routed into
its containers." Nothing routes there from the player side any more, and 4c-2a made the 0-max-HP shape
unbuildable. A `HISTORY` banner had been added above the paragraph but scoped narrower than the
falsehoods under it, which laundered the rest. **A history banner must be scoped to what it actually
disclaims.** The live rationale now sits in its own paragraph.

**8.4 The credit counter is still the gate, and it is still non-zero.** `dummyReachability`'s
`LIVENESS` case credits `BARE_ROUNDS` via the **dummy's own DoT-tick turn** — a route §4.4's
"exactly when every member is at max hp 0" description never mentioned (it is now corrected). That
credit is 4c-2c's remaining work; 4c-2b deliberately did not touch it. `consulted` now reads 0 on
that shape, and player-side no-victim turns are counted separately by `noVictimPlayerTurnCount` —
`legacyVictimFallbackCount` is enemy-side-only by definition now, so folding the two would make its
name false.

**8.5 The rule is enforced on ONE SIDE ONLY — 4e must close this with the SAME rule.**
`engine.ts`'s enemy call site still `continue`s on `tgt === undefined`, so an **enemy-side**
ally-targeted supporter with no heal anchor is silenced — precisely the outcome §8.1 exists to prevent.
1,341 measured rows. This was latent before 4c-2b and is now a visible asymmetry in the contract.

**8.6 Residuals, all measured corpus-inert and tripwired.** A no-victim turn still answers
`enemyHpPct` = 100, `enemiesHitThisCast` = 1, and `targetSpeed/targetCurrentHp/targetCritPower`
= 0 (so a `stat-vs-target` **`gt`** gate reads TRUE against nobody — Bayah and Cobalt are the only
`gt` readers, neither ally-target). All three want ONE rung that widens the condition context to give
an honest absent-subject answer. Zero enemy-HP-**above** gates exist in the 147-ship corpus.

---

## 9. AMENDMENT (2026-08-19) — what 4c-2c actually cost, and what it hands to 4c-2d

Plan: `docs/superpowers/plans/2026-08-19-sp4c2c-retire-the-dummy-turn.md` (its §0 carries the measured
facts verbatim). Ledger: `.superpowers/sdd/progress.md`. Branch: `sp4c-2c/retire-dummy-turn`, off
`main` @ `f1bce838`.

**§7.4's churn cell for this rung was wrong by two orders of magnitude, and §8.4's hand-off was right
about *what* the remaining work was and wrong about *what doing it would mean*.** Both are corrected
below; §7.4's cells are corrected in place as well, the way §8 corrected §4's.

### 9.1 The churn estimate was stale — and a churn estimate ages exactly the way a reachability claim does

Measured before the rung, on `main` @ `f1bce838`, by applying both switches on a scratch basis and
running the full suite plus the oracle:

| §7.4 said | MEASURED on `f1bce838` |
| --- | --- |
| "3,883 no-op turn events across 73 files, 3 of them golden suites" | **2 failing tests in 2 files** — `dummyEnemyTurnGate.test.ts` and `dummyReachability.test.ts`. **5,890 / 5,892 still pass** |
| 3 golden suites move | **ZERO golden movement.** `fingerprint`, `kitFingerprintScenarios`, `placementSymmetry` and `ablation` all green, untouched |
| (not stated) | Oracle at the **exact baseline**: `shipsSwept: 147 / symmetricShips: 146 / findings: 2` |

The estimate was taken at `8d2c2a61` — *before* 4c-2a floored the 0-max-HP pressure source and
*before* 4c-2b stopped the player side consulting the ghost. Between them those two rungs did the
work the turn-order deletion was expected to do; by the time 4c-2c ran, the 3,883 no-op turn events
it was supposed to delete had already stopped being emitted.

**The lesson is §7.5's, one rung on.** §7.5 established that *a claim about whether a path is
reachable is a measurement, not a reading*. This rung establishes the temporal half of the same rule:
**a churn estimate ages exactly the way a reachability claim does.** A number that was correctly
measured at rung *n* is not evidence at rung *n+2* — every intervening rung is a potential
invalidator, and the ladder was *designed* so that earlier rungs would absorb later rungs' churn. So:
**re-measure immediately before the rung; never quote the table.** The measurement is cheap (one
scratch application of the switches, one full-suite run, ~25 seconds) and it is the only thing that
distinguishes "this rung is a no-op because its work was already done" from "this rung is a no-op
because its switch did not take".

### 9.2 The credit counter: §8.4 named the right work, and the wrong shape of it

§8.4 nominated `dummySinkCreditCount` as 4c-2d's deletion gate and recorded that its `LIVENESS`
credit — routed through the **dummy's own DoT-tick turn** — was "4c-2c's remaining work". That was
correct. What it framed wrongly was the job: it read as *drive `credited` to 0 and then gate on the
zero*. Retiring the turn does not drive the counter to 0 in any evidential sense — **it removes the
counter's last liveness route, which makes its zero unfalsifiable.**

Measured, not reasoned: a `console.error` at the increment site over the whole suite hit **0 times
across 532 files** with the switches applied, where the pre-switch tree hit it **twice**. A counter
whose zero cannot be made to move is not a gate; it is the fixture-vacuity defect class this epic has
already been bitten by (`project_real_kit_golden_fingerprints`: green, deterministic, observing
nothing). **So `dummySinkCreditCount` and its two exports (`__getDummySinkCreditCount`,
`__resetDummySinkCreditCount`) were DELETED in this rung** rather than handed to 4c-2d as a vacuous
gate. `dummyReachability.test.ts`'s vacuity guard was re-homed onto `__getNoVictimPlayerTurnCount`,
which 4c-2b introduced and which still moves.

**State the claim with the precision the counter's own doc used.** The correct claim is
**"corpus-dead — no shape the suite can build reaches the site"**, NOT "structurally unreachable".
The increment lived in the round-tail vestigial-sink `else` branch keyed on
`totalRoundDamage + teamRoundDamage > 0` — *not* inside the dummy's turn body. Any future change that
routes scalar damage there lights the site up again. This is the same line the counter's doc already
drew ("no SHIPPED caller reaches the sink", not "the sink is unreachable"), and it must not be
overstated in a comment, a commit message or the changelog.

`legacyVictimFallbackCount` is untouched and still has a live non-zero home
(`damageChannelAccounting.integration.test.ts`, a never-targetable *player* roster). That reading is
enemy-side and is **4e's** business.

### 9.3 A finding that did not exist before this rung: the D5 decrement change is a VALUE-LEVEL NO-OP

Moving the side-wide scheduled-enemy-debuff decrement off the dummy's Post-Turn and onto the round
tail produces **the same round, the same `actorId`, the same count and the same row values**. It is
observable ONLY as the `buff-expired` emission's **position in the ordered event stream**:

```
pre-rung : turn r2 attacker → turn r2 enemy → expired r2 by enemy → turn r2 e1 → turn r2 ally
post-rung: turn r2 attacker → turn r2 e1 → turn r2 ally → expired r2 by enemy
```

That is the whole of the rung's semantic shift, and it is why §9.7 concludes there is no changelog
entry to write.

**Record the near-miss, not just the conclusion.** The first version of the tripwire meant to pin
this **PASSED byte-identical against pre-rung semantics** — its fixture was a shape where the dummy
had *already* been dropped before the rung, so the test could not distinguish the two orderings and
would have shipped green while observing nothing. It was rewritten onto a **mixed** fixture (a
focus ship with an enemy-side target, plus a team ally with an explicit ally-side target) and now
asserts the **ordered** event stream rather than the values. A tripwire that cannot fail is this
epic's signature defect and one nearly shipped here: **every tripwire must be shown to fail against
the semantics it claims to have changed, before it is believed.**

### 9.4 What 4c-2d must know: the inventory is BIGGER than §7.4's row implied, and its largest item is grep-invisible

The whole `} else if (actor.kind === 'enemy' && actor.id === enemy.id) {` turn body —
`engine.ts:9955` through the `⛔ END OF THE DEAD BRANCH` banner at `:10035`, 81 lines carrying
`tickDoTs`, `processBombs` and `processAccumulators` — is now unreachable on every run, because the
dummy is in no turn order. **A grep for `isDummyEnemy` MISSES it:** the condition is spelled inline
rather than through the named binding, so the symbol that a deleting rung would naturally sweep for
does not appear there at all. It was marked in place with four `⛔ DEAD BRANCH` banners rather than
deleted, precisely because 4c-2d's zero-movement claim depends on 4c-2d knowing its own inventory.

§7.4's 4c-2d row is corrected in place. The inventory:

- **LOSES** `dummySinkCreditCount` and its two exports — deleted in this rung (§9.2).
- **GAINS** the dead turn body above (`:9955`–`:10035`).
- **GAINS** the dead `isDummyEnemy` Post-Turn arm (`isDummyEnemy` at `engine.ts:8861` is provably
  always `false`, so the ternary that reads it is unreachable).
- **GAINS** the dead-actor-skip exemption (the `!isDummyEnemy` conjunct, whose comment block is now
  bannered with everything it used to claim and no longer does).
- **GAINS** the dummy's membership in `dotCarrierActors` (`engine.ts:2623`, first member) — the
  reporting route that makes §0.4(a)'s stranded DoT visible.
- **GAINS** the new test file `src/utils/combat/__tests__/retiredDummyTurn.test.ts` (see §9.5 — one
  of its two tests migrates rather than dies).

Its **zero-movement** expectation is unchanged, and is now better founded than when it was written:
what remains is an inventory, not an estimate.

⚠️ Nine line-number references in `engine.ts` comments are load-bearing as of `767775cd` and will rot
if anything lands above them before 4c-2d. Each is paired with the symbol it points at (§6's rule), so
a stale number self-corrects, but 4c-2d should re-resolve them by symbol rather than by number.

### 9.5 Hand-off on `retiredDummyTurn.test.ts`: one test dies with the actor, one MIGRATES

The file carries the two §0.4 hazard tripwires, and 4c-2d must treat them differently:

1. **The stranded-DoT test** pins a dummy-specific hazard (a DoT pushed onto the dummy's containers
   never ticks, never expires, and is still reported by `dotCarrierActors`). It **dies with the
   actor** — delete it alongside.
2. **The scheduled-decrement test** pins a behaviour that is **not dummy-specific**: the round-tail
   decrement of a side-wide bucket that *outlives the actor that used to host it*. 4c-2d should
   **MIGRATE** it — re-keying the reported `actorId`, since the bucket will still need some identity
   to report under — rather than delete the file wholesale.

### 9.6 Method notes earned here

Both are cheap, and both nearly produced a false green.

- **An invalid `TargetSelection` string ran GREEN under vitest** and was caught only by
  `npx tsc --noEmit`. Same class as this repo's known "`tsc` catches what vitest can't" trap: a test
  fixture whose *type* is wrong is not a test failure, it is a test that silently exercises a
  different path (or none).
- **Verifying "this commit is comment-only" by piping both revisions through esbuild passed
  VACUOUSLY on the first attempt, for two different people.** esbuild rejected the arguments and wrote
  **0 bytes for both sides**, so `diff` reported "identical" while proving nothing. Both caught it the
  same way: by adding a **negative control** — flip one character of real code and confirm the
  comparison flags it. The generalisation, and it belongs next to §6's "before believing *X differs
  from Y*, run X-vs-X": **a comparison that reports "no difference" must first be shown capable of
  reporting a difference.** The two rules are the two halves of the same discipline — a positive
  control for a claimed difference, a negative control for a claimed identity.

### 9.7 The changelog decision: NO entry, deliberately

`CLAUDE.md` requires a plain-English `UNRELEASED_CHANGES` entry in `src/constants/changelog.ts` for
`feat:`/`fix:` work users would notice, and explicitly skips refactors and test-only changes.
**This rung gets no entry, and the absence is a decision rather than an oversight.** It moved zero
user-observable behaviour: no golden fingerprint moved, no oracle finding moved (`147 / 146 / 2`
exactly), and the one semantic shift is §9.3's value-level no-op — same round, same actor, same
count, same values, differing only in the ordinal position of a `buff-expired` emission inside the
round.

Note the trap that bit the previous rung's changelog: **a user-facing claim written from the headline
behaviour will overstate it.** "The phantom enemy line no longer appears in the combat log" would be
exactly such an overstatement here — that `turn-started`/`turn-ended` pair was already suppressed on
every positional run *before* this rung, by 4c-2a and 4c-2b. Writing it would credit this rung with a
fix the ladder had already shipped, which is the same error §9.1's stale churn cell made in the other
direction.
