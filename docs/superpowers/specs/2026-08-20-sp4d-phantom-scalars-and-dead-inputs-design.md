# SP-4d — the phantom scalars and the four dead inputs

**Epic:** DPS real enemy and buff timeline. **Predecessor:** SP-4c (complete — the dummy enemy is
gone; 4c-2d shipped as PR #339, squash `dc7f2056`). **Successor:** 4e (the non-positional heal
routes, absorbing #335).

**Absorbs:** #333 (a no-victim turn still answers three phantom scalars) and the four legacy scalar
inputs the SP-4c spec deferred here (§4.2 / §10.7 of
`2026-08-18-sp4c-match-end-and-delete-the-dummy-design.md`).

**Measurement point for every number in this document: `dc7f2056`.** Per SP-4c §9.1, a churn figure
ages exactly the way a reachability claim does. Re-measure at the branch point; do not quote this
table as fact later in the rung.

---

## 1. Why this is one rung and not two

The SP-4c spec planned the field deletion and #333 as separate concerns. They are not: `input.enemyHp`'s
**only two remaining readers are the phantom itself**.

1. `pushSynthesizedFocusSkipTurn` (`engine.ts`, the skip-row assembly) derives the row's `enemyHpPct`
   from `cumulativeDamage / enemyHp`.
2. `buildDrainContext` (`triggers.ts`) derives every drain-time enemy-HP% gate's reading from
   `100 * (1 - ctx.cumulativeDamage / ctx.enemyHp)`.

Close the phantom and the field's reader count goes to zero, which is precisely what makes the
deletion tractable. Delete the field first and you would have to re-home the phantom on a module
constant — hardcoding the old dummy sink's HP into the engine to keep a lie running. So the ordering
is forced, and once the semantics change lands there is nothing left to hand to a second rung but
mechanical churn.

### 1.1 The stale premise this rung starts by correcting

SP-4c §10.7 says: *"the four scalar inputs go to 4d (`enemyHp` is a required `CombatEngineInput`
field, ~200-file churn)"*. Measured at `dc7f2056`, **all four are already optional**:

```
engine.ts:1223   enemyHp?: number;
engine.ts:1222   enemyDefense?: number;
engine.ts:1259   enemySecurity?: number;
engine.ts:1270   enemySpeed?: number;
engine.ts:1880   enemyHp = 1_000_000_000,     // the destructure default
```

`engine.ts:1872` nevertheless still states *"`enemyHp` is a REQUIRED field"* — a live
self-contradiction 650 lines from the declaration it describes, introduced when 4c-2d widened the
field and left the neighbouring comment alone. It is the same defect shape as the SWEEP LESSON that
rung earned twice: **when you narrow a claim, sweep every document that carries it.** This rung
deletes the field and the comment together.

Re-measured churn: **1,109 field-set occurrences across 268 files** (`enemyHp` 524, `enemyDefense`
496, `enemySecurity` 73, `enemySpeed` 16), of which 210 files also call `runCombat`. Because the
fields are already optional, every one of those lines is a *deletion*, and `tsc --noEmit` names every
one it misses. Heaviest single files: `dpsSimulator.test.ts` (106), `stasis.test.ts` (40),
`equipmentAbilities.integration.test.ts` (36), `twoTeamBattle.test.ts` (20).

---

## 2. The fight this fixes

Your team is Hermes (a repairer) plus three attackers, against four positioned enemies. Hermes takes
its turn and repairs an ally. Since 4c-2b that turn resolves **nobody** on the opposing side — Hermes
aimed at a friend, so no enemy is the subject of anything this turn.

Three questions about "the enemy" still get answered as though one were standing there:

| the question | today's answer | what a gate sees |
| --- | --- | --- |
| the enemy's HP% | **100** | a healthy enemy is standing there |
| the target's HP / Speed / Crit Power | **0** | an enemy with zero stats is standing there |
| enemies hit by this cast | **1** | the repair hit one enemy |

Cobalt's active really says *"If this Unit has more HP than the enemy, it additionally deals damage
equal to 25% of this Unit's max HP."* Give a support kit that clause shape on a repair — *"if this
Unit has more HP than the enemy, also grant a shield"* — and Hermes' 20,000 HP beats the enemy's
**0**, so the shield lands. The player watches a bonus whose own text requires out-HPing an enemy
appear in a turn that had no enemy in it. Nothing suppresses it: the consumer (`gateFiringAbilities`)
is deliberately unfenced so the repair itself can land.

Now the same fight with a different clause — *"if the enemy has no debuffs, grant a shield"*, which is
the parser's own negation idiom (`countComparator: 'eq', countThreshold: 0`, `buildShipAbilities.ts:266`).
The count of a nonexistent enemy's debuffs is **0**, and 0 equals 0, so the shield lands again. **This
is why the fix cannot be "answer 0 instead":** answering 0 fixes the first clause and leaves the
second. The phantom would move rather than die.

Neither clause exists in the corpus today. That measured inertness (§6) is why this is tripwired
rather than red, and it is also the whole reason the class must be closed at the mechanism rather than
narrowed at the values.

---

## 3. The mechanism — one unresolvable answer at one choke point

`evaluateCondition` returns `number | undefined`. **`undefined` means the subject does not exist.**

- `conditionMet` returns `false` for `undefined` **before** reaching the `countComparator` switch. That
  ordering is the entire point: it makes the answer comparator-proof, so `eq 0` and `lte N` cannot be
  satisfied by an absent subject any more than `gte` can.
- `scaledBonus` reads `undefined` as 0 (`sum + (evaluateCondition(...) ?? 0)`), so a scaling source
  with no subject contributes nothing.
- `conditionsMet`'s OR-group semantics need no change: an unresolvable condition inside an `anyOf` run
  is simply false, and a resolvable sibling can still carry the group.

The choke point is narrow, which is what makes this affordable: `conditionMet` is the **only** place a
count becomes a boolean gate, and `evaluateCondition` is called directly from exactly two other
places — `scaledBonus` and `playerTurn.ts:937`.

### 3.1 The rule that decides which fields become absent

> **A per-victim subject with no victim is unresolvable. A side-wide subject is always resolvable.**

The second half holds because since 4b-2b a real enemy roster is guaranteed — the normalization
boundary throws on an empty one. So "is any enemy stealthed", "how many enemies have been destroyed",
"what class is the enemy side" all still have honest answers on a no-victim turn, and must keep
answering. Side-wide, unchanged: `enemy-buff` (a deduped union across enemies), `enemy-destroyed`,
`enemy-adjacent`, `enemy-stealth-count`, `enemy-type`. Per-victim, in scope: `hp-threshold`
(enemy/default subject), `stat-vs-target`, `enemies-hit-this-cast`.

`enemy-type` already implements exactly this rule by hand — `if (!ctx.enemyType) return 0; // unknown
type → cannot confirm either way`. This rung generalises that instinct and makes it comparator-proof.

**Caveat: "side-wide is always resolvable" is not a claim that every side-wide subject answers
something real.** `enemy-adjacent` is hardcoded `0` at every builder (`roundContext.ts`'s
`enemyAdjacentCount: 0`), with no live derivation anywhere in `src/` — the parser marks it
`derivable: false`, so it never even reaches this rule's machinery. It is a pre-existing dead
subject, unrelated to and out of scope for this rung; this note exists only so the rule above is not
misread as vouching for it.

### 3.2 The fabrication happens in TWO layers — fixing one is silently defeated by the other

`buildRoundContext` (`src/utils/abilities/roundContext.ts`) eagerly materialises every optional field,
including all three phantoms:

```
roundContext.ts:146   enemyHpPct: state.enemyHpPct ?? 100,
roundContext.ts:158   targetCritPower: state.targetCritPower ?? 0,
roundContext.ts:160   targetSpeed: state.targetSpeed ?? 0,
roundContext.ts:162   targetCurrentHp: state.targetCurrentHp ?? 0,
roundContext.ts:163   enemiesHitThisCast: state.enemiesHitThisCast ?? 1,
```

So `evaluateConditions`' own `?? 0` **never sees an absent value from that path** — the value was
already invented one layer up. A fix applied only at `evaluateConditions` would pass its own unit
tests and change nothing through the real funnel. This is the hand-enumerated-layer defect class from
the name-keyed-status tranche 2 work: adding a meaning to a field obliges sweeping every site that
re-materialises it. Both layers must stop defaulting; the conditional-spread idiom already present in
that same file (`roundCrit`, `enemyDotFamilyCounts`) is the pattern to copy.

### 3.3 The three subjects, before and after

| subject | today | after | behaviour delta |
| --- | --- | --- | --- |
| `enemyHpPct` — `hp-threshold` (enemy/default), `enemy-hp-pct`, `enemy-hp-missing-pct` | `100` | absent on a no-victim turn and at drain time | `below` gates unchanged (false either way); `above` gates stop firing against nobody; scaling contributes 0 |
| `targetSpeed` / `targetCurrentHp` / `targetCritPower` — `stat-vs-target` | `0` | absent → unresolvable | a `gt` comparison stops firing against nobody; `lt` was already safe by arithmetic |
| `enemiesHitThisCast` | `1` | `0` for a cast that resolves NO victim (a real measurement — it hit zero enemies, not "no footprint"); absent ONLY when this owner has no recorded cast at all this combat | Tygr `gte 2` and Berserker `gte 3` unchanged; a `gte 1` reader correctly stops firing against a no-victim cast's `0`; but an `eq 0` or `lte 1` reader DOES fire against that same `0`, because 0 genuinely satisfies them |

**On that third row's `eq`/`lte` behaviour (shipped in SP-4d Task 8, `61d45dec`):** this is the one
row in this table that ends deliberately FAIL-OPEN under `eq`/`lte`, not fail-closed like the other
two. That is intentional, not an oversight: a cast that hit nobody really did hit zero enemies, so
`0` is a true measurement of the cast, not a phantom standing in for a missing subject — the
`enemyHpPct` / `stat-vs-target` rows are absent because there is no HP or stat to read AT ALL, but
"how many enemies did this cast hit" has an honest zero answer even with no victim. Record this
plainly because it was never recorded at the time the row was written.

---

## 4. Gate and display split apart

`PlayerRoundCtx.enemyHpPct` becomes optional and **gate-facing only**. `RoundData.enemyHpPct` stays a
required number, sourced on a no-victim or skip row from an explicitly named display constant:

```ts
/** DISPLAY ONLY — the round chart needs a number for a round whose focus struck nobody.
 *  This is NOT a reading of any enemy's HP; the gate-facing ctx field is absent there. */
const DISPLAY_ENEMY_HP_PCT_NO_VICTIM = 100;
```

Two reasons to keep the number rather than widen the row:

1. It preserves the chart and every golden byte-for-byte, so the rung's zero-movement claim stays
   falsifiable by a single `git diff --name-only` over `.snap` files.
2. The honest display value is a genuinely different question — with a roster of up to five enemies,
   "Enemy HP" no longer names anything, and answering it means choosing a side-aggregate. That is
   #331's question, not this rung's.

**Filed separately** (new issue, same family as #331): on a round where the focus is destroyed before
its turn, `pushSynthesizedFocusSkipTurn` reports `Enemy HP: 100%` in the round chart while the enemy
your attackers nearly killed sits at 12%. Naming the constant is what makes that issue findable
instead of buried in a division.

**One qualifier on "byte-for-byte" above: the shipped `enemyHpPct` derivation has a genuine `: 0`
value change, not just a display-constant swap.** `playerTurn.ts`'s ternary is `hasVictim ?
(enemyHp > 0 ? <decline formula> : 0) : undefined` — the `: 0` arm answers a real victim whose max
HP is 0, which is a different, honest answer from both `undefined` ("no victim") and the old
fabricated `100` ("a healthy enemy"). It is both gate-facing and display-facing, so it is a genuine
behaviour change, not covered by §4's display-constant argument above. Measured by instrumenting the
branch over the whole combat suite: **4 hits, all with victim id `'attacker'`**, every one reached
on an ENEMY's turn against a PLAYER-side actor with omitted or zero `stats.hp` — the player side
carries no HP floor (unlike the enemy side, which `normalizeRoster` floors to 1,000,000). Golden
files did not move. Recorded here rather than left as an overclaim under "byte-for-byte."

---

## 5. Site inventory (by symbol — treat every line number as advisory)

SP-4c §10.4 found 4 of 5 recorded line citations already stale with no intervening commits. Pair every
citation with its symbol and re-resolve by symbol.

**Semantics**

| file | symbol | change |
| --- | --- | --- |
| `abilities/evaluateConditions.ts` | `evaluateCondition` | return `number \| undefined`; absent subject → `undefined` for the three subjects |
| | `conditionMet` | `undefined` → false **before** the comparator switch |
| | `scaledBonus` | `?? 0` inside the OR-group reduce |
| | `evalHpThreshold` | enemy/default subject with absent `enemyHpPct` → unresolvable |
| | `ConditionContext.enemyHpPct` | required → optional |
| `abilities/roundContext.ts` | `buildRoundContext` | stop eagerly defaulting the five fields in §3.2 |
| `combat/playerTurn.ts` | `PlayerRoundCtx.enemyHpPct` | required → optional; derive only when `hasVictim` |
| | the `enemyHpDecline` block | drops its `enemyHp` denominator on the no-victim path |
| `combat/triggers.ts` | `buildDrainContext` | stop deriving `enemyHpPct` from `ctx.enemyHp`; pass absent |
| | `IntentExecContext.enemyHp` | deleted |
| `combat/engine.ts` | `enemiesHitThisCastFor` | absent id → `undefined`, not `?? 1` |
| | `pushSynthesizedFocusSkipTurn` | row value from the named display constant |

**Deletion**

| file | change |
| --- | --- |
| `combat/engine.ts` | `CombatEngineInput.enemyHp` / `enemyDefense` / `enemySpeed` / `enemySecurity`; the `enemyHp = 1_000_000_000` destructure; the stale "REQUIRED field" comment |
| `calculators/dpsSimulator.ts` | stop forwarding the four to the engine |
| `calculators/healingEngineAdapter.ts` | the top-level `LEGACY_SINK_*` pass-through only |
| 268 files | 1,109 field-set lines |

### 5.1 What stays, and why

- **`DPSSimulationInput`'s own four fields.** They are the DPS calculator's real enemy configuration
  and still build `synthesizedDpsEnemy` when a caller supplies no roster — a live production path, not
  a legacy one. Only the engine-boundary fields die.
- **`healingEngineAdapter`'s `LEGACY_SINK_*` constants.** One name, two jobs: the top-level
  pass-through (`enemyDefense:` / `enemyHp:` / `enemySecurity:`) goes, the **per-enemy roster defaults**
  (`e.stats.defence ?? LEGACY_SINK_DEFENCE` and its two siblings) stay — those describe real roster
  members whose card left a stat blank.
- **`enemyType`** (SP-4c §4.2 — fight-wide, needs per-actor class plumbing to retire) and
  **`SENTINEL_ENEMY_ACTOR_ID`** (§4.3 — an id for the scheduled-debuff bucket; the string stays
  reserved so a caller cannot name an enemy `'enemy'` and interleave its events with the bucket's).

---

## 6. Measurements already taken (at `dc7f2056`)

**Corpus comparator census** — 147 ships, 165 parsed conditions, 101 of them enemy-subject. **Every
enemy-subject comparator gate is `gte`; zero `lte`, zero `eq`.** So "absent → 0" would be
behaviourally identical to the sentinel across the entire shipped corpus today, and the sentinel is
chosen for the class, not for a live bug.

Readers of the subjects in scope:

| ship | subject | shape |
| --- | --- | --- |
| Akula | `enemy-hp-pct` | bare, scaling (+30% by target's current HP%) |
| Tithonus | `enemy-hp-missing-pct` | bare, scaling (+40% by target's missing HP) |
| Bayah | `stat-vs-target` crit-power | `gt` — phantom-satisfiable |
| Cobalt | `stat-vs-target` hp | `gt` — phantom-satisfiable |
| Chakara | `stat-vs-target` speed | `lt` — safe by arithmetic |
| Tygr / Berserker | `enemies-hit-this-cast` | `gte 2` / `gte 3` |
| Judge / Obsidian | `hp-threshold` enemy | `below 50` / `below 30` |
| Hermes | `hp-threshold` target | `below 40` (the heal target — `targetHpPct`, not in scope) |

None of the phantom-satisfiable readers is one of the 24 ally-target ships.

**Scaling-path probe (the rung's sharpest risk, and it is closed).** Instrumenting the
`enemy-hp-pct` / `enemy-hp-missing-pct` arms and running the whole suite: every evaluation comes from
one of two callers — `perVictimOutgoingDeltaPct` and `effectiveDamageStatsOf` — and every one carries
a **live** reading (17.7%, 34.9%, 56.7%, and exact 100s that are genuine full-HP round-1 readings).
**Zero drain-path evaluations.** So making a scaling source contribute 0 when its subject is absent
cannot move a shipped ship's damage today; it only ever matters once a support kit ships an
HP-proportional modifier.

### 6.1 Measurements the plan still owes

1. **Re-take the churn count at the branch point**, not from §1.1.
2. **Does a real single-target cast register a footprint**, or does it rely on `enemiesHitThisCastFor`'s
   `?? 1`? Measured safe either way under `gte` (1 and absent both fail `gte 2`), but the answer
   decides whether the fix belongs at the booking site or the resolver.
3. **Is the drain-time `enemyHpPct` genuinely a constant 100 on every positional run?** The claim
   (positional credit books per-victim and never feeds `cumulativeDamage`) is currently a code-reading,
   and SP-4c §7.5's rule is that reachability is a measurement. A `console.error` at the derivation
   over the full suite settles it.

---

## 7. Tests and exit criteria

**Red first, and each red test must be shown to fail against restored pre-rung semantics.** 4c-2c
shipped a tripwire that passed byte-identical against the old world — green, deterministic, observing
nothing. Restoring the production switches and re-running is the method that catches it.

1. **Per subject, a synthetic parser-legal ability on an ally-target ship** (Hermes) carrying the
   phantom-satisfiable gate, asserting the payload does **not** fire — plus a negative half where the
   same ability with a resolvable subject still fires. Synthetic because no shipped kit can build the
   shape; the negative half is what keeps the test from passing for the wrong reason.
2. **The comparator-proof case** — an `eq 0` and an `lte N` gate on an absent subject, also not
   firing. This is the sentinel's entire justification over plain 0, so it is the one test that would
   fail under the rejected option.
3. **A scaling case** — an HP-proportional modifier on an ally-target ship contributes 0 rather than
   its full cap on a no-victim turn.
4. **`noVictimResidualTripwires.test.ts`**: the three cases become direct assertions that the gate does
   not resolve. Its corpus-census non-vacuity checks and the `ALLY_TARGET_SHIPS` staleness pin are
   **migrated, not deleted** — SP-4c §9.5's migrate-don't-delete ruling, which CodeRabbit already
   enforced once on that rung.

**Exit criteria**

- `npx vitest run` green; `npx tsc --noEmit` clean (this is the proof for the 1,109-line churn — a
  missed site is a compile error, not a silent survivor); `npm run lint` clean.
- Oracle `--seeds 15` reads **147 / 146 / 2** (the two known-open Enforcer `debuff-resisted` seeds).
- **Zero golden movement.** `git diff --name-only main...HEAD` contains no `.snap` file. `vitest -u` is
  never run. Movement means an earlier rung missed a path — investigate, do not re-pin (SP-4c §4.5).
- Grep for `enemyHp`, `enemyDefense`, `enemySpeed`, `enemySecurity` on the engine boundary returns
  nothing but `DPSSimulationInput`'s own fields and the healing adapter's per-enemy defaults.

---

## 8. Out of scope, stated

- **The display honesty issue** (§4): a skip row reporting `Enemy HP: 100%` while the real enemy sits
  at 12%. New issue, filed with #331 — both are `RoundData` still describing a one-enemy world.
- **The fail-closed per-victim subjects — CLOSED inside this rung, not parked.** This bullet
  originally argued that `enemyDebuffCount`, `enemyDotCount`, `enemyShielded` could be left
  fabricating `0`/`false` because the fabrication "only ever block[s] a gate **except** under
  `eq`/`lte`, which no parser path emits for an enemy subject and which the corpus does not contain
  (§6)... [r]eachable only by hand-authoring in the ability editor." **That argument was false, and
  was never checked against the parser before being written down.** Measured (SP-4d Task 9): both
  halves reproduce from real skill-text phrasings —

      detectGrantConditions(
        '…If the enemy has no debuffs, this Unit gains <unit-skill>Shield</unit-skill> for 2 turns.',
        'Shield'
      ) → [{ subject: 'enemy-debuff', derivable: true, countComparator: 'eq', countThreshold: 0 }]

      '…If the enemy has 2 or fewer debuffs…' → { countComparator: 'lte', countThreshold: 2 }

  (emitted by `countGateCondition`, `src/utils/skillTextParser.ts` ~908-966) — and attaching either
  shape to a Hermes-shaped self-shield granted the shield TWICE on a no-victim turn (measured
  `[500000, 500000]` instead of one grant). The residue was one ship-text phrasing away from
  shipping, not editor-only. The owner elected to close it inside this rung rather than file the
  follow-up, and SP-4d Task 9 did: all three subjects now propagate `undefined` (unresolvable) on
  the CAST path when no opposing victim resolves — see `evaluateConditions.ts`'s `enemy-debuff` /
  `enemy-dot-count` / `enemy-shield` arms and `roundContext.ts`'s `noOpposingVictim` signal.
- **The drain-time reading of the SAME three subjects — deliberately NOT the same defect, and left
  answering real values.** §3.1's own rule is "a per-victim subject with no victim is unresolvable;
  a side-wide subject is always resolvable." At REACTIVE DRAIN TIME, `enemy-debuff` /
  `enemy-dot-count` / `enemy-shield` do not read a per-cast resolved victim at all — they read a
  persistent per-owner store (`snapshot(ownerId)`, `corrosionEntries`/`infernoEntries`/`bombCount`)
  describing the opposing SIDE this owner has been engaging over the fight. A real enemy roster is
  guaranteed since 4b-2b (the normalization boundary throws on an empty one), so a drain-time `0`
  there means "the enemy side currently carries no debuffs" — a TRUE, side-wide measurement, not a
  phantom standing in for a missing subject the way the cast-path `0` was. `buildDrainContext`
  therefore leaves `noOpposingVictim` unset/false on purpose (see its own doc in `triggers.ts`) and
  keeps answering real `0`/`false` there, unchanged by Task 9. Corroborating argument, not just an
  appeal to the rule: if the drain-time count were a constant 0 rather than a real reading, all
  **12** shipped `gte` enemy-debuff gates in the corpus (measured against `docs/ship-skills.csv`:
  APEX, Asphyxiator ×2, Bayah ×3, Bizon, Crocus ×2, Tygr) would be permanently dead, and the
  fingerprint suites would have caught it.
- **#331** (`RoundData.teamDamage` omits walked-team damage) and **#335 / 4e** (the enemy-side
  ally-targeted supporter is still silenced; the non-positional heal routes).
- **Indestructible NPCs** (SP-4c §5).

**Housekeeping:** #334 (a victimless reactive infliction aiming at the sentinel) reads as closed by
4c-2d's commit 1 — *"warn when an authored infliction names no enemy"*. Verify against `dc7f2056` and
close the issue rather than carrying it into 4d.

---

## 9. Amendment (Task 7, re-measured through Task 9 / HEAD) — what the rung actually cost

**Original measurement point: `63637d09`** (Tasks 1–6, HEAD when Task 7 began). Task 7's own commit
changed comments and tests only — it moved no production code path — so every number in §9.1–§9.4
below is left exactly as Task 7 recorded it, AS HISTORY: it is what was true and knowable at that
commit. Per §1.1's own rule, a churn figure ages exactly like a reachability claim, and this section
aged too — Task 8 and Task 9 each closed something §9.3/§9.5 recorded as still-open. Task 10 corrects
those two specific claims in place below (they would otherwise be a present-tense falsehood, not
accurate history) and adds §9.6 with the re-measurement at current HEAD plus the lessons the original
amendment omitted. Do not quote §9.1–§9.4's table as the current state; §9.6 is.

### 9.1 Suite counts (AS OF `63637d09` — superseded by §9.6 for current numbers)

- **This branch (`63637d09`, and unchanged through Task 7): 540 files / 5979 tests, all green.**
  (Task 7's tripwire migration removed 2 tests — the two retired corpus-scan cases (a) and (c) —
  from a 540/5981 count at Task 6's own commit, `3c821f50`.)
- **Baseline, `main` at the branch point: 537 files / 5958 tests.**
- `npx tsc --noEmit`: clean. `npm run lint`: clean.
- **Zero golden movement**: `git diff --name-only main...HEAD | grep '\.snap'` returns nothing,
  across all seven tasks.
- **Oracle, `--seeds 15`: 147 / 146 / 2** — the two findings are both Enforcer `debuff-resisted`
  (fires as `enemy`, never as `focus`/`team`), the same pre-existing, likely-RNG pair this rung
  inherited and did not touch.

### 9.2 Re-measured churn (§1.1)

§1.1's own table (268 files / 1,109 occurrences: `enemyHp` 524, `enemyDefense` 496, `enemySecurity`
73, `enemySpeed` 16) was itself already stale by the time Task 6 ran: Task 6's own re-measurement
(Step 1's script, run fresh rather than trusting §1.1) read **266 files / 1,094 occurrences** —
15 fewer occurrences and 2 fewer files than the spec recorded, from ordinary drift across Tasks
1–5's own comment and fixture edits between `dc7f2056` and Task 6's commit. Task 6 proceeded on the
re-measured number, per its own Step 1 instruction never to use the plan's table.

Re-running the identical script at Task 7's own measurement point (post-deletion) finds
**83 files / 348 occurrences** of `enemy(Hp|Defense|Speed|Security):` still in `src/`:
`enemyDefense` 136, `enemyHp` 138, `enemySecurity` 60, `enemySpeed` 14. This is not residue Task 6
missed — it is exactly §5.1's "what stays": `DPSSimulationInput`'s own four fields (and the
synthesized-enemy call sites that consume them), `healingEngineAdapter.ts`'s `LEGACY_SINK_*`
per-enemy roster defaults, and `playerTurn.ts`'s own per-turn `enemyDefense`/`enemyHp` parameters
(a per-victim concept unrelated to the deleted `CombatEngineInput` scalars, sharing only a name). A
spot-check of the non-adapter survivors (`grep -v "DPSSimulationInput\|dpsSimulator\|LEGACY_SINK\|enemyDefenseModifier"`,
225 lines) confirms every one is one of these two categories, never a `CombatEngineInput` literal —
consistent with Task 6's own tsc-clean claim.

### 9.3 §6.1's three owed measurements, answered

1. **Re-take the churn count at the branch point.** Done above (§9.2): 266 files / 1,094
   occurrences at Task 6's start, not §1.1's 268 / 1,109.
2. **Does a real single-target cast register a footprint, or does it rely on the `?? 1`
   fallback?** Answered by Task 4's own commit measurement (`f6ceb53e`): of 12,735
   `enemiesHitThisCastFor` resolver calls, **94.9% found a real booked value** — mostly a genuine
   `1` from an actual single-target cast, so the booking site itself was never the problem. The
   remaining 5.1% (**651 calls**, `12735 × 0.051 ≈ 650`) found no map entry at all — an owner that
   had not yet completed a turn this drain cycle — which is where the phantom `1` was being
   manufactured, and which SP-4d Fix wave 1 fixed at the resolver (`enemiesHitThisCastFor`), not
   the booking site. **At Task 7's measurement point, the three `.set()` booking sites in
   engine.ts still fabricated 1 for a REAL cast that resolves no victim** — a narrower, genuinely
   still-open case, deliberately left alone at the time (both existing corpus readers, Tygr
   `gte 2` and Berserker `gte 3`, already failed against a fabricated 1, so 1-vs-absent was
   byte-identical for them) and re-tripwired by the migrated `noVictimResidualTripwires.test.ts`
   rather than fixed. **This did not stay open**: SP-4d Task 8 (`61d45dec`) closed it, changing
   all three booking sites to `aoeVictimIds?.length ?? (<a victim resolved> ? 1 : 0)` — see §9.6.1
   for why the measurement above pointed at the wrong half of the problem.
3. **Is the drain-time `enemyHpPct` genuinely a constant 100 on every positional run?** Yes,
   measured directly rather than argued: Task 4's own before-commit instrumentation over the whole
   suite recorded **12,886 drain-time evaluations, every single one exactly 100** — positional
   credit books per-victim and never feeds `cumulativeDamage`, so an `above` hp-threshold gate at
   drain time would have read TRUE against no actor on the board on every run there is, had one
   existed in the corpus (§6's comparator census: none does — every enemy-subject `hp-threshold`
   gate in the shipped corpus is `below`).

### 9.4 Task 4's footprint fix reached further than the spec's own example

§2's game example (Hermes repairs an ally, no victim resolved) is what motivated the fix, but the
9.3.2 measurement shows the actual FIX SITE — the `enemiesHitThisCastFor` resolver returning
`undefined` for "no entry yet" — answers "unknown" for **651 of 12,735 calls**, and those calls are
not only no-victim ally casts: the dominant case is a **round-1 start-of-round drain**, firing for
ANY owner (support or attacker alike) before its own first turn has resolved this combat, which had
nothing to do with an ally-targeted cast at all. Checked against observability the same way §6
checks everything else: both of the corpus's two readers (Tygr `gte 2`, Berserker `gte 3`) already
failed against the old fabricated `1`, and continue to fail against the new `undefined` — so the
broadened footprint changes zero shipped numbers. This is recorded here because "the fix's footprint
matches the spec's motivating example" would otherwise be assumed rather than checked, and in this
rung it is false: the fix is broader than its own example, and only stays inert because of the
corpus's comparator shapes, not because of the shape of the fix.

### 9.5 What the spec got wrong

- **§1.1's churn table aged before the rung that was supposed to consume it ran** (see §9.2) — the
  exact failure mode §1.1 itself warns about ("a churn figure ages exactly the way a reachability
  claim does"), materializing one task later than the spec anticipated.
- **§5's site inventory attributes `buildActorConditionContext`'s `enemyHpPct` widening to Task 4.**
  It was not: `tsc --noEmit` forced that signature to accept `enemyHpPct?: number` (rather than a
  required field) during **Task 3** (`be1b7029`, "a no-victim turn has no enemy-HP reading"), which
  is where `PlayerRoundCtx.enemyHpPct` first became optional and the drain-context signature had to
  follow it to keep compiling. Task 4 only stopped `buildDrainContext` from deriving a VALUE for
  that already-optional field from `cumulativeDamage / enemyHp`; the widening itself predates it by
  one task.
- **The brief for this task assumed Tasks 1–4 discharged all three of `noVictimResidualTripwires.test.ts`'s
  named residuals.** Two were (see this file's Task 7 header for cases (a)/(c)); the third,
  `enemies-hit-this-cast`'s phantom booking of 1 for a cast that hits nobody, was NOT discharged as
  of Task 7 — see §9.3.2 — and the migrated test file kept that case rather than retiring it at the
  time. **Superseded**: SP-4d Task 8 (`61d45dec`) closed case (b) too, and
  `noVictimResidualTripwires.test.ts`'s header (re-read at HEAD) now records all three cases as
  RETIRED. See §9.6 for what Task 8/9 actually cost and the lessons Task 7's own amendment missed.

### 9.6 Re-measured at HEAD (`7781ada8`, Task 10) — what Tasks 8/9 cost, and what this amendment omitted

**Suite counts, current HEAD: 543 files / 5996 tests, all green.** `npx tsc --noEmit`: clean.
`npm run lint`: clean. **Zero golden movement**: `git diff --name-only` shows no `.snap` file across
the whole 19-commit branch from `dc7f2056`. **Oracle, `--seeds 15`: 147 / 146 / 2** — unchanged, the
same pre-existing Enforcer `debuff-resisted` pair.

#### 9.6.1 Task 4 fixed the wrong half, because its own measurement answered the wrong question

§9.3.2 measured **map-entry presence**: 94.9% of `enemiesHitThisCastFor` resolver calls found *some*
entry, so Task 4 fixed the resolver's `?? 1` fallback for the 5.1% with no entry at all. That was
sound as far as it went — but "was a value recorded?" is not "is the recorded value honest?": the
entry a no-victim cast books IS present (the map has a real key for that owner), and the value
booked there was `1`, not a measurement of what the cast actually hit. Task 4's presence-rate
measurement could not see this, because it only asked whether `.get(ownerId)` returned something,
never what the booking sites had `.set()` in the no-victim case. So issue #333's third row survived
Task 4 intact: the *resolver* stopped inventing 1 for an owner with no entry, while the three
*booking sites* in engine.ts went on inventing 1 for a cast that resolved nobody — the same phantom,
one layer over, invisible to a measurement of the wrong layer. It cost an unplanned task (Task 8,
`61d45dec`) to close. The generalisable lesson, worth carrying into any future "is this field
honest" audit: **a presence check and a correctness check are different questions, and a metric
answering the first will look like progress while leaving the second's bug fully intact.**

#### 9.6.2 `as unknown as` test fixtures sit outside `tsc`'s missed-site guarantee

§7's exit criteria lean on `tsc --noEmit` to enumerate every site a field deletion misses — true for
real `CombatEngineInput`/`IntentExecContext` literals, because a required-field or excess-property
error fires. It is NOT true for a fixture that casts through `as unknown as IntentExecContext` (or
any `as unknown as X`): the cast tells the compiler to stop checking the object's shape entirely, so
a dead property inside one is invisible to any compiler-driven sweep, however thorough. Measured
directly: **8 test files still hold 12 dead `enemyHp` properties** behind exactly this cast pattern
(`reactiveDamageTakenShield.test.ts`, `onShieldAppliedReaction.test.ts`, `blockDebuff.test.ts` ×4,
`reactiveOncePerRoundGate.test.ts`, `deadOwnerReactiveGate.test.ts`, `cleanseReactivePath.test.ts`,
`reactiveOverhealShield.test.ts`, `reactiveBuffProcGate.test.ts` ×2) — none of them a compile error,
all of them dead weight `tsc` will never flag. See `.superpowers/sdd/progress.md`'s follow-up (i)
for the sweep this leaves open, including that the same fixtures already lost their sibling
`cumulativeDamage: 0` property, making this a half-finished sweep rather than an untouched one.
