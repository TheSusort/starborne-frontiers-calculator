# notes-engine-3 — `src/utils/combat/engine.ts`, current lines 9000–13277

Agent A3, region 3 (the remainder). Line numbers are the `blocks.mjs --from 9000` CURRENT line
numbers at the start of the run; they drift as blocks shrink. 214 candidate blocks.

Oracle baseline before any edit: **GREEN** (37842 tokens identical).

Negative control (run early, after batch 1): appended `export const __probe = 1;` → oracle
**RED, exit 1** ("first divergence at token 37842", `ExportKeyword :: export`). Removed that exact
line by text edit → **GREEN, exit 0**. The instrument has been seen to report both outcomes.

Processing order is BOTTOM-UP (13277 → 9000) so deletions never shift unprocessed line numbers.

---

## Batch 1 — the result assembly and round-row tail (13185–13277)

### 13243-13250 [workstream-label] `DELETED enemyOutcome … after SP-4b-2a`
CLAIM: an eight-line obituary for a removed field.
EVIDENCE: the same rule already lives ONCE at the return type's own doc (engine.ts:2120,
"There is deliberately NO `enemyOutcome` … a caller … taps `ship-destroyed` (as `dpsSimulator`
does)"). This was that rule restated at a second site (policy class 3) wrapped in archaeology.
ACTION: rewritten — three lines, pointing at the type doc and naming the two live readers
(`ship-destroyed`, `RoundData.perActorIncoming`). Confirmed live: `dpsSimulator.ts:592,875-883`
re-derives `survived`/`roundsToKill`/`finalHpPct` from its own `ship-destroyed` tap.

### 13234-13240 [history-claim] `#415: this used to add "…healTarget is undefined → undefined"`
ACTION: rewritten to present tense — `healTarget` is anchored in every mode, so DPS resolves the
FOCUS's death round and never reads it because the healing shape is gated on `healReportActive`.
`#415` kept as the rationale pointer.

### 13203-13207 [history-claim] `A THIRD exit used to sit beside these two … gone with the actor`
ACTION: deleted (policy class 1). The live side-wipe contract below it is untouched.

### 13204-13205 (after the delete) `Placed with the other two exits`
CLAIM: a count that the deletion above just invalidated (there are two exits, not three).
ACTION: rewritten — "Independent of the focus-death exit below".

### 13212 [class 3] `Focus-death exit, sibling of the enemy-death one above`
CLAIM: points at the enemy-death exit — which is the exit deleted above; there is no sibling.
FALSE. ACTION: rewritten — the pointer dropped, the DPS-only rule and its two named pinning tests
kept.

### 13185-13193 [workstream-label] `Post-round backstop (Task-1 OUTCOME B) … matching the old
first-wins behavior`
ACTION: rewritten — label and "the old code"/"old first-wins" history dropped; the start-dead
capture contract, the two must-nots, and first-wins kept as present tense.

### 13148-13152 [diff-justification] `written by sink, PR5a … byte-identical to the legacy
per-round scalars this replaced … removed in this same change`
ACTION: rewritten — the per-victim-share-not-board-sum contract kept, the diff argument dropped.

### 13130-13131 **FALSE** `Generic DoTs are never auto-applied from skill text in this task, so this
is [] on every corpus run today — a no-op spread`
EVIDENCE: `convertHitToSelfDot` (engine.ts:1997) pushes into `victim.genericDoTEntries` and is
called from the shared victim-damage funnel at engine.ts:6145 on a `transform-incoming-to-dot`
ability the parser DOES emit (`skillTextParser.ts:3151`; Voron/Orel, Hit Mitigation). The victim
there is whichever actor took the hit, enemy side included. Same falsehood notes-engine-1 recorded
as its item 12.
ACTION: deleted (the whole comment was the false claim; the spread needs no doc).

### 13099-13104 [diff-justification] `preserving both the single-carrier byte-identity and …`
ACTION: rewritten — the byte-identity half dropped, the TYPE-MAJOR grouping contract and its
`extend-dot` consumers kept.

### 13069-13084 [workstream-label, count-enum] `Before SP-4c-2d they also covered the dummy's own
… (task-14 finding 3) … the defect class this epic keeps hitting`
ACTION: rewritten — the dummy obituary, the finding number and the epic reference dropped; corpse
exclusion, the extensive-vs-intensive aggregation argument and the explicit rejection of
`enemyAttackers[0]` kept. `finalHpPct` re-anchored to `dpsSimulator`, where it still lives
(`dpsSimulator.ts:399,883`) — the bare name pointed at a field this file no longer has.

### 13062-13065 [workstream-label, diff-justification] `perActorReflected (Reflect gear set, Task 5)
… stay byte-identical`
ACTION: rewritten — `Task 5` and the byte-identical tail dropped, the absent-when-empty rule kept.

### 13027-13043 [history-claim] `#358 ADDENDUM 3 … It used to be left out … BOTH HALVES OF THAT
ARGUMENT ARE NOW FALSE: Task 10 stopped … Task 11 stopped …`
ACTION: rewritten as the present-tense rule (`incoming === 0` does NOT imply `incomingRaw === 0`,
with the two live reasons and the reachable `abilityDefaults.ts` `blockPct: 1` path). `#358` and
the `rawIntakeAxis.test.ts` tripwire name kept; the task numbers and the refuted-argument framing
dropped.

### 13010-13014, 12984-12987, 12978-12980, 12973-12974, 12957-12962, 12950-12953, 12948,
12945-12946, 12941-12943 [diff-justification ×9]
CLAIM: nine "→ byte-identical / goldens stay byte-identical / legacy RoundData shape preserved"
tails on the conditional-spread round fields.
ACTION: rewritten — every "set ONLY when …" shape contract kept verbatim, every byte-identity /
golden justification dropped. The `genericDamage` one additionally carried the false generic-DoT
claim above; only the shape contract survives.

Oracle after batch 1: **GREEN**.

## Batch 2 — the round tail: turn-loop close, sentinel decrement, post-round assembly (12455–12930)

### 12908-12922 [history-claim] `DELETED THE POST-DRAIN RE-FOLD … unreachable since SP-4b-2b`
ACTION: rewritten to four lines stating what is true now — the scalar accumulators are not
re-folded after the `round-ended` drain, and a positional reactive books on the per-victim maps,
which ARE serialized below. (Deliberately does NOT claim "there is no post-drain delta": that would
re-assert the deleted block's argument about a non-positional reactive, which I did not verify.)

### 12864-12887 [history-claim] `#375 ADDED THE REPAIR HALF … #383 ADDED THE SOURCE HALF … The axis
could not be read here before`
ACTION: rewritten present-tense. All three issue refs (#372/#375/#383) kept as rationale pointers,
the `recipientAxisTeamSymmetry.test.ts` pin kept, the "used to accumulate from events" / "lifted
both arms first" narrative dropped.

### 12843-12849 [workstream-label] `…and since SP-4c-2d there is no dummy actor`
ACTION: rewritten — trailing clause dropped; the sentinel-store-not-per-actor contract kept.

### 12832-12838 [workstream-label] `round-ended (C2b-2) … (It used to be described as sitting after
"the post-round death drain"…) … out of E3 scope`
ACTION: rewritten — labels dropped; "This is the LAST drain of the round, and the only one after
the turn loop" kept as a present-tense contract and VERIFIED: `grep -n 'drainIntentsFor('` shows
exactly four sites past 12400, two inside the turn loop and two here.

### 12765 [workstream-label] `(ship-kit W3, Task 9, ledger #49)` + `(It used to skip the DPS dummy…)`
ACTION: rewritten — label and dummy parenthesis dropped; the quoted game rule, the ordering
requirement, the team-symmetry statement and the whole snapshot-before-apply argument kept.

### 12741-12763 [history-claim] `DELETED THE ROUND-TAIL ENEMY-HP BLOCK` (23 lines)
ACTION: deleted, replaced by three lines of present tense (no round-tail HP write; a positioned
enemy takes damage in the turn walk; `cumulativeDamage` is the report's total, not an HP ledger).

### 12717-12733 [workstream-label] `SP-4d deleted the cumulativeTeamDamage scalar … the display
constant that briefly stood in for it`
ACTION: rewritten — history dropped, `#341` and `#331` kept, the ⚠️ INCOMPLETE-scalar warning and
its `simulateDPS` re-derivation kept verbatim.

### 12710-12714, 12687-12698 [diff-justification, history-claim]
ACTION: rewritten — `→ byte-identical` and the "SP-4c-2d: the old justification was the round-tail
dummy HP overwrite" preamble dropped; THE TWO-CHANNEL ACCOUNTING RULE promoted to the opening
sentence, which is what both comments actually carry.

### 12669-12677 [history-claim, count-enum] `targetId was the dummy sink's id and is now … the same
string, so the event is byte-identical … a console.error here over the whole suite hit ZERO times
in 535 files`
ACTION: rewritten — history, byte-identity and the suite-file count all dropped; the reason the
event carries the sentinel (an aggregate channel has no per-victim identity) kept.

### 12663-12664 **FALSE** `Always 0 today (generic DoTs are never auto-applied from skill text in
this task) — real once E2/E3/E4 populate genericDoTEntries`
EVIDENCE: as batch 1 — `convertHitToSelfDot` is a live producer.
ACTION: rewritten to name that producer.

### 12651-12658 [history-claim] `Only the attacker entry exists today` + `were `let` for the
post-drain re-fold, which SP-4c-2d deleted`
CLAIM: "only the attacker entry exists" is contradicted 60 lines below, where `teamRoundDamage`
loops `roundDamage` over every id that is NOT the focus. FALSE.
ACTION: both sentences deleted; the assembly description kept.

### 12636-12638 [history-claim] `including the two that used to need a fabricated stand-in`
ACTION: rewritten to "no row fabricates a stand-in"; `#341` kept.

### 12595-12600 **FALSE** `Rounds always have exactly one focus turn today … reproduces the old
definite-assignment provenance … naming the Phase-3+ seam`
CLAIM: contradicted by the very next statement, `if (!focusTurns.length)`, and by that block's own
text naming TWO ways to reach zero focus turns.
ACTION: rewritten — zero focus turns is possible on exactly those two paths, impossible with a
living focus in a running match, which is what the throw catches. (The `Phase-3+ seam` string
inside the thrown Error is CODE and was not touched.)

### 12602-12605, 12615, 12618-12624 [workstream-label] `SP-4c-1 adds a SECOND way …` and
**FALSE** `see the focus-death exit beside the enemy-death one below`
CLAIM: the enemy-death exit is the one batch 1 deleted at 13203 — there is no such sibling.
ACTION: rewritten — pointer redirected to the focus-death exit and the side-wipe exit that really
sit there; `SP-4c-1` and "the original invariant … held only while the focus was effectively
immortal" dropped.

### 12534-12585 [history-claim ×4] the side-wide `decrementEnemy()` block (52 lines → 20)
ACTION: rewritten. Deleted: the `HISTORY of why this statement exists` paragraph with its
`[t,t,f,t,t]`/`841e1bc0` measurement, the `dummyEnemyIsVestigial` narrative, the whole
`WHAT THE MOVE OFF THE DUMMY'S POST-TURN ACTUALLY CHANGED` paragraph (diff justification), and the
`byte-identical` identity argument. Kept: the `__enemy__` routing rule, ONCE-PER-ROUND and why,
SOLE DECREMENT, POSITION vs the `activeEnemyDebuffs` snapshot, the sentinel-denotes-a-bucket rule,
and `buff-expired` being log-only.
VERIFIED for the rewritten SOLE-DECREMENT sentence: `decrementEnemy` has exactly two call sites in
engine.ts — 12492 `decrementEnemy(actor.id)` and the round-tail no-arg one, which defaults to
`DEFAULT_ENEMY_TARGET` (`statusEngine.ts:1203`).

### 12481-12491 **FALSE** `the player→enemy-attacker variant … stays latent (no firing site threads
a player→enemy targetId yet — a future per-victim-accounting PR lights it up)`
EVIDENCE: `playerTurn.ts:2369` calls
`statusEngine.applyTimedAbilityStatus(r, status, actor.id, vid)` — `vid` is the victim's real id
and lands as `enemyTargetId` (`statusEngine.ts:1682-1707`), so a player's cast keys its enemy-side
timed statuses under the enemy actor's own id and they decay on that actor's Post Turn. The
wiring/reader-claim family again.
ACTION: rewritten to say what is true, naming the threading site. `decrementUnification Case 5` and
the `isDummyEnemy` ternary obituary dropped.

### 12473-12476 [workstream-label] `(Side-agnostic: PR4 unification of the former 4-branch … split.)`
ACTION: rewritten — the label dropped, side-agnosticism kept as the contract.

### 12515-12521 [workstream-label] `the dedicated post-round enemy-death drain having gone with the
dummy in SP-4c-2d`
ACTION: rewritten — clause dropped.

### 12523-12526 **FALSE** `the post-round death-drain and round-ended reactives that follow`
EVIDENCE: there IS no post-round death drain. `drainIntentsFor(` past line 12400: 12470/12471 and
12494/12495 (both INSIDE the turn loop) and 12770/12771 (round-ended). Nothing else.
ACTION: rewritten to name only the round-ended reactives.

### 13205 (batch-1 region, same falsehood) **FALSE** `the round-ended drain and the post-round death
drain both run AFTER the turn loop`
ACTION: rewritten to "the round-ended drain runs AFTER the turn loop", same evidence.

Oracle after batch 2: **GREEN**. File 13277 → 13163 lines.

## Batch 3 — the enemy attacker turn: staging, positional apply, emission tail (12040–12455)

### 12420-12443 [workstream-label, diff-justification, count-enum] `Task 5 (per-victim crit signal)
… byte-identical to the pre-Task-5 inline emit … R5(i) … a temporary throw … ran the FULL suite
(488 files / 5566 tests) without firing once`
ACTION: rewritten — labels, byte-identity and the suite counts dropped. The whole
"why this fallback does NOT pass `deliveredDamage: 0`" argument kept, including its closing
if-this-ever-becomes-reachable instruction, which is a live contract.

### 12396 [workstream-label] `SP-4b-2 D6, task-18 finding 3:` → "Fallback:". ACTION: rewritten.

### 12377 [diff-justification] `LEGACY … byte-identical to pre-Task-4` → "Non-positional single
aggregate emit." ACTION: rewritten.

### 12367-12374 **FALSE** `enemyAttackedSignals is the helper's returned per-victim signals`
EVIDENCE: `grep -n enemyAttackedSignals src/utils/combat/engine.ts` → ONE hit, inside this comment.
The symbol does not exist; the variable that actually holds the helper's return is
`enemyEmitDeferred`. Class 3 (a comment that survived the deletion of what it names).
ACTION: rewritten to name `enemyEmitDeferred`; `PR2 Task 3` and the "With N=1 … stood here before"
tail dropped.

### 12188-12195 **FALSE** — the SAME dead symbol, as a whole leading paragraph
The `let enemyEmitDeferred` declaration carried TWO stacked doc paragraphs: the first described
`enemyAttackedSignals` (gone), the second describes the declaration that follows it. Reading them
in sequence, the first paragraph appears to document the variable below it and does not.
ACTION: the two merged into one truthful paragraph about `enemyEmitDeferred`; `row-14`/`U5` labels
dropped.

### 12353-12358 **FALSE** `Non-positional path only (… no fixture threads enemy positions)`
EVIDENCE: contradicted 150 lines below in this same block — "the sim goldens (2v2/3v3/healing)
thread enemy positions+patterns so real enemy attackers hit player victims here". Two comments in
one function disagreeing about whether the enemy positional path is exercised.
ACTION: rewritten to describe both arms as they are (positional captures the focus victim's per-hit
outcome; the non-positional else computes the aggregate form). `G PR2` and `(Step 3)` dropped.

### 12319-12337 [count-enum] `#358 ADDENDUM 2 … (406 files / 3935 tests) … The other six folding
paths ARE covered`
ACTION: rewritten — the file/test counts and the "six" dropped, the parked KNOWN-UNFIXED ruling,
both issue refs (#358, #357) and the pointer to `ActorIntake.incomingRaw` kept. This is a genuine
standing exception, not archaeology.

### 12313 [workstream-label] `H1 T4:` prefix. ACTION: deleted (prefix only).

### 12300-12306 [history-claim] `the damage-taken heal/shield leech block that used to sit here too
was deleted by #374, measured never entered on either arm … deferred to U5 (real DPS enemy
keystone), when the scalar sink dies`
ACTION: rewritten — the obituary and the pending-work label dropped; the live fact kept in
present tense (no taken leech runs on this arm; since #374 the only taken-leech path is the
per-victim positional one). `#374` kept.

### 12283-12291 [history-claim] `That is exactly why the player-side accumulator gather was
documented as an "inert placeholder" … Team symmetry is LOCKED for this pair.`
ACTION: rewritten — the cross-reference to another comment's wording and the LOCKED banner dropped;
the ONLY-direct-channel / no-double-count contract kept.

### 12261-12263, 12211-12221, 12201-12210 [workstream-label] `(U5)`, `E2 Task 5`, `row-14 tail`,
`the U5 deferral note there`, `(SP-U U5 corrected the earlier "inert — no production caller" note)`
ACTION: rewritten — labels dropped. "This enemy positional path IS exercised in production: the sim
goldens (2v2/3v3/healing) thread enemy positions+patterns" KEPT: it is a present-tense contract and
it is the statement that refutes the false comment at 12353.

### 12171-12176 **FALSE** `These aggregate locals feed ONLY the non-positional damage-taken leech
block below`
EVIDENCE: that block was deleted by #374 (the comment 130 lines below says so). The locals'
surviving reader is the non-positional `attacked` emit's `shieldWasHit` computation, visible in the
same function.
ACTION: rewritten to name that reader, and `procTakenLeechesPerVictim` re-pointed at
`procLeechesForVictim`, which is the function this site actually calls (engine.ts:5220, which then
calls `procTakenLeechesPerVictim` at 5227 — both exist, only the call here was misnamed).

### 12152-12162 [history-claim] `(Until SP-4e this note read "tgt === healTarget! … byte-identical",
because …)`
ACTION: rewritten — the quoted retracted wording dropped, the live "`tgt` is the resolved victim or
nothing, never a heal-anchor fallback" statement kept.

### 12138-12145 **FALSE** `surfacing those other per-actor buckets as result rows is the
still-deferred symmetric-accounting surface`
EVIDENCE: they ARE surfaced — `RoundData.perActorIncoming` is assembled at the round tail in this
same function and read by `battleSimulator.ts:621,659`, `dpsSimulator.ts:307-333`,
`healingEngineAdapter.ts:822-888`, `defenseSurvivabilitySim.ts:270-283` (notes-engine-1 item 7,
re-confirmed here against the assembly site).
ACTION: rewritten to name the surface; `Phase-5`, `E2 T5` and `PR5b` dropped, `#374` kept.

### 12125-12136 [history-claim] `⚠️ SP-4e (#335) INVERTED THE REASON … It used to read: "…"`
ACTION: rewritten — the quoted superseded wording dropped, the ⚠️ and the do-not-remove-this-term
argument kept in present tense, `#335` kept.

### 12073-12099 [workstream-label, diff-justification] `── SP-4b-2 D6, task-18 finding 3 … Team
symmetry is LOCKED … MEASURED … Pre-fix the enemy dealt NOTHING AT ALL`
ACTION: rewritten — labels and the pre-fix/post-fix framing dropped; the staging-position rule, the
named pinning fixture (`passiveSlotDamageFootprint.integration`), the mechanism that makes
aggregate `damage` 0, and the safety argument all kept.

Oracle after batch 3: **GREEN**. File 13163 → 13137 lines. Candidate blocks 214 → 144.

## Batch 4 — walked-team turn and enemy-turn preamble (11380–12040)

### 12018-12031 [workstream-label] `(display-only — Task R1)` / `(display-only — Task R3)`
ACTION: rewritten — labels dropped, `display-only` kept.

### 11990-12013 [workstream-label, count-enum] `⚠️ SP-4e (#335) MADE THE 0 ARM LIVE … The comment
that stood here read "…" … Every clause of that is now false … ~1,695 measured no-victim enemy turns`
Also a PRE-EXISTING PROSE DEFECT: the block ended `…since SP-4d` with no terminator, running
straight into the next sentence.
ACTION: rewritten to the present-tense rule (the `0` arm is live, `aoeVictimIds` is undefined on a
no-victim turn, the `??` falls through, footprint 0 is the honest reading, all three sites read one
expression). `#335` kept; the quoted superseded comment, the counts and the dangling clause gone.

### 11974-11988 [count-enum] `Whole suite: **1,695** enemy no-victim turns across 26 files … 1,341 +
15 = **~1,356**, the delta … the error that rung kept catching`
ACTION: rewritten to three lines — the `set` is unconditional (#335), the only consumer is an enemy
DoT tick, a no-victim turn applies none. Every count deleted (policy class 2).

### 11928-11939 **FALSE-as-written / self-correcting** `Positional gate (Task 9, enemy site) … "No
production caller threads position+target+pattern for an enemy yet → false for every golden" was
true when written and is NOT true now`
ACTION: rewritten — the retracted claim removed rather than quoted-then-retracted, so a reader
cannot lift the false half out of context. The live statement (this is the ORDINARY path whenever a
caller passes `enemyAttackers`) kept.

### 11921 [workstream-label] `H1 T4:` prefix. ACTION: deleted (prefix only).

### 11893-11899 [diff-justification] `Measured before and after: an enemy-side damage-dealt leech's
three-round profile is unchanged`
ACTION: rewritten — the measurement dropped, the symmetry rule and the ordering fact kept.

### 11863-11869, 11805-11812, 11772-11776, 11763-11768, 11753-11754 [diff-justification ×5]
`F3:` prefix and five `→ byte-identical` / `falls back … → byte-identical` tails.
ACTION: rewritten — labels and tails dropped, every surrounding contract kept.
NOTE at 11763-11768: `Undefined for every current fixture → enemyPositional false` was FALSE by the
same evidence as 11928 (enemy positional is the ordinary path); that sentence is deleted, not
reworded.

### 11740-11752 [workstream-label, history-claim] `Positional target selection (Task C3 …). Mirrors
the focus-turn (C1) and team-turn (C2) branches … It used to fall back to `legacyVictim: healTarget`
and read that stand-in for the WHOLE turn …`
ACTION: rewritten — labels and the retracted-fallback narrative dropped; `#335` kept and the live
no-victim contract stated positively.

### 11730-11737 [line-pointer, history-claim] `(playerTurn.ts:~1044)` and `(It also fed a dead-target
firing-skill check … #346 deleted that branch and the pair with it.)`
ACTION: rewritten — the hard line pointer and the obituary for the deleted
`enemyWouldFireAction`/`selectFiringSkill` pair both deleted.

### 11712 [workstream-label] `(spike Fact 3)`. ACTION: deleted (parenthetical only).

### 11690-11706 [workstream-label, diff-justification] `(the same per-victim sink PR1's … use)` ·
`Until SP-4c-2d it also drove the dummy sink's round-tail HP overwrite …` · `a STRICT no-op
(byte-identical) for every existing fixture — none seed enemy-actor timed containers`
Also a PRE-EXISTING PROSE DEFECT: a stray `/` inside `at `enemyPositional`/)`.
ACTION: rewritten — labels, the dummy paragraph and the fixture claim dropped; the two-channel rule,
the GATE predicate and the Stasis interaction kept; the stray slash removed. `#161` kept.

### 11661 [workstream-label] `A future real DPS enemy (SP-U 5a) with neither …`
ACTION: rewritten to "An enemy with neither takes the no-victim cadence-only skip".

### 11628-11629 [workstream-label] `including the SP-4d Task 8 tgt-gated 0-vs-1 fallback`
ACTION: rewritten — label dropped.

### 11573 [history-claim] `The single-sink decline that used to be zeroed for the positional path is
now derived from …`
ACTION: rewritten to the present-tense derivation.

### 11552-11560 [history-claim] `do NOT read the focus site's pre-SP-4c-2b claim that deferral is
pinned to the positional gate, which this rung falsified at both sites … a Task-2-zeroed directDamage`
ACTION: rewritten — the cross-reference-to-a-retracted-claim and the task label dropped; the whole
deferral-vs-fence argument and the `the fallback is now REACHABLE` search pointer kept.

### 11529 [workstream-label] `PR2 Task 3 —` prefix. ACTION: deleted (prefix only).
### 11489 [workstream-label] `R-cast:` prefix. ACTION: deleted (prefix only).

### 11460-11476 [workstream-label, diff-justification] `AMENDED BY SP-4c-2b at the end of this
comment … Positional APPLY (Task 8b, GATED) … At Task 8b no production caller threaded these, so it
was false for every existing test/golden → byte-identical. STALE since`
This block also carried a PRE-EXISTING PROSE DEFECT: the sentence "STALE since" ended mid-clause and
ran into the next sentence, so the reader could not tell WHAT it was stale since.
ACTION: rewritten — the amendment banner, task labels, byte-identity and the whole superseded
"false for every golden" claim deleted; the live consequence kept and made causal (team credit lands
in `perTargetDealt`, which is where `RoundData.teamDamage` comes from). The dangling clause is gone.

### 11418-11423, 11396-11402, 11381-11388 [workstream-label, history-claim]
`Task 5 (per-victim crit signal):` · `This used to say the fallback path bound `tgt === enemy`, "…"`
· `Positional target selection (Task C2, GATED). Mirrors the focus-turn branch (C1) … since SP-4c-2b
on this side, and since SP-4e on both`
ACTION: all three rewritten — labels and the quoted superseded wording dropped; the "no stand-in
victim exists on either side" contract kept.

### 11577-11591 `secondary/conditional: a SYMMETRY PLACEHOLDER with NO READER today`
ACTION: **kept (legitimate contract)** — and VERIFIED rather than assumed, because this is exactly
the wiring-claim shape that was false fifteen times elsewhere. `grep -rn '\.secondary\b'` /
`'\.conditional\b'` over `src` (tests excluded): the ONLY reads are `focus.secondary` /
`focus.conditional` at the row assembly. The team writes at 11592-11593 genuinely have no reader.
The comment is TRUE. Untouched.

Oracle after batch 4: **GREEN**. Candidate blocks 144 → 107.

## Batch 5 — focus turn and the shared turn preamble (10480–11380)

### 11303-11313 [history-claim] `Was `?? 1`, which fabricated a footprint of 1 … the residual
`noVictimResidualTripwires.test.ts` used to tripwire … (neither reader, Berserker/Tygr, is one of
the 24 ally-target ships)`
ACTION: rewritten — the was/now framing and the ship counts dropped, the discriminator rule and the
tripwire test NAME kept.

### 11272-11274, 11229-11250 [history-claim] the two `single-sink decline that used to be zeroed`
lines and `The `?? turn.directDamage` fallback was written as unreachable-… That divergence has
ARRIVED`
ACTION: rewritten. The fallback block keeps its whole argument in present tense under a new
searchable anchor `THE FALLBACK IS REACHABLE`; the plan-section label `§A.7` and the
`13 rows, zero shipped ships` count are gone.
⚠️ CROSS-REFERENCE REPAIRED: the walked-team site told the reader to `search
`the fallback is now REACHABLE``. That string no longer existed after the rewrite, so the pointer
would have led nowhere — the team site was updated to `search `THE FALLBACK IS REACHABLE``. (This
is the class the task warned about: fixing one comment can break another's pointer.)

### 11098-11147 [workstream-label ×3, diff-justification] the 50-line positional-APPLY block
`AMENDED BY SP-4c-2b at the end of this comment …` · `Positional APPLY (Task 8b, GATED)` ·
`At Task 8b no production caller threaded position+target+pattern, so this was false for every
existing test/golden → byte-identical` · `(CodeRabbit raised this)` · `since SP-4c-2d there is none
anywhere, so the counterfactual below can no longer be constructed` · `(plan §A.1: 100% of the
player-side fallback rows)` · `fixture-only today (13 rows, zero shipped ships)`
ACTION: rewritten to 36 lines. The read-the-amendment-first instruction is gone (the amendment is
folded into the text it amended, which is why it existed); so are the task labels, the review
attribution, the dummy counterfactual and both plan-section counts. Kept whole: the NORMAL-path
statement, the deliberate absence of a `selectedEnemy != null` precondition with its whiff
argument, the `tgt !== undefined` precondition's non-overlap with the phantom-damage hazard, and
"the fence lives in the GATE, above every RNG draw".

### 11064-11078 [workstream-label, count-enum] `KNOWN LIMITATION, deliberate for PR8 … Corpus-inert
today: Enforcer is the only ship with hits > 1 … which PR8 must keep byte-identical`
ACTION: rewritten — ⚠️ added, the limitation and its exact consequence kept verbatim; the PR labels
and the single-ship corpus census dropped (delete-first: I did not re-measure the corpus, so I did
not restate the claim in new words).

### 11056, 10514 [workstream-label] `#367 fix wave:` ×2, plus the hard line pointer `~240 lines
below`. ACTION: rewritten to `#367:` and "further down".

### 11026-11035 [history-claim] `a branch the comment at that call used to describe as unreachable.
It is reachable now`
ACTION: rewritten — the retracted-description narrative dropped, the conclusion kept.

### 10963-10986 [workstream-label, history-claim, diff-justification] the 24-line
positional-target-selection block (`Task C1, GATED` · `At Task C1 … byte-identical` · `Positional
target (phase 2): … else the dummy sink` · `SP-4c-2b/2d AMEND the two paragraphs above`)
ACTION: rewritten to 12 lines of present tense. The AMEND paragraph is gone because the paragraphs
it amended are gone; the dummy-binding description is gone with the dummy.

### 10949-10955 [line-pointer] `(playerTurn.ts:~1044)`. ACTION: deleted (the file no longer has
that line number; the predicate is named instead).

### 10935-10943 [history-claim] `Anchoring healTarget to the focus in every mode turned the carve-out
ON in DPS mode, so a focus … fell through and cast anyway`
ACTION: rewritten to the present-tense reason the clause exists; `#415` kept.

### 10929 [workstream-label] `(PR2 lesson)`. ACTION: deleted (parenthetical only).

### 10921-10926 [workstream-label] `PR-B: … Mirror of the PR2 enemy site; strict no-op for every
existing fixture (none seed player-actor timed containers) … PR-C will add tickDoTs AHEAD of this
burst`
ACTION: rewritten — the labels, the fixture claim and the PENDING-WORK sentence dropped (a "will
add" comment reads as scheduled work and there is nothing scheduled); the canonical turn-start
order kept as the rule.

### 10907 [workstream-label] `Task 4 adds team runtimes.` ACTION: deleted (sentence only).

### 10492-10498 [history-claim] `There used to be a SECOND exemption, `!isDummyEnemy` … Do not
resurrect it from an older comment or commit …`
ACTION: deleted (10 lines). It documents an exemption that no longer exists for an actor that no
longer exists; the live one-exemption rule above it is untouched.

### 10573-10590 [line-pointer ×5] `(~4249/4314)`, `(~4595)`, `(~4567)`, `(~3403: …)`, `(~4651)`
ACTION: rewritten — every hard line pointer deleted (all five are stale: the file is ~13 000 lines
and these point into the 4 000s). The named symbols, the §4.4 filter's actual source line of code,
and the `chronoReaverCharge.integration.test.ts` golden are kept, which is what makes the block
findable without numbers.

### 10591-10593 [class 3] `The dummy-sink enemy is NOT bumped here any more — it takes no turn, so
its `turnsTaken` stays 0 … Nothing reads it`
ACTION: deleted — it describes an actor that does not exist.

### 10520-10532, 10506, 10748-10751, 10700-10703, 10848 [workstream-label ×5]
`G PR1:` · `PR6:` · `since PR4` · `C2b-2 T5:` ×2 · `D-PR3 (Vortex Veil):` ×2 · `(Faust, Task 6,
distinguishes them)` · `Absent → 0 → byte-identical for all existing tests`
ACTION: all rewritten — labels and byte-identity tails dropped, every rule kept. `PR6:`'s content
was preserved as a positive statement of what separates the N attacks (the key) from what separates
the turns (the clear).

### 10600-10643 [history-claim, workstream-label] the DoT-tick prologue header
`this used to be phrased as "mirroring the dummy enemy's DoT-tick timing", but since SP-4c-2c …` ·
`(Task 6b)` · `(goldens byte-identical)` · `PR-C C2:` · `This prologue used to sit inside
`if (actor.id !== enemy.id)` …`
ACTION: rewritten to a present-tense header describing both branches. The `#415 NOTE` ⚠️ accounting
gap below it is KEPT in full (a live, deliberately-declined gap with a named consequence) — only
its "is now REACHABLE" tightened to "is REACHABLE".

### 10687-10691, 10728-10734 [history-claim] `Site 3 of the leech-channel class (spec §3): the
applier is no longer discarded …` / `… FIXED (spec §3) … It previously discarded `_sourceId``
ACTION: both rewritten to what the code does now. The ⚠️ OPEN GAP block between them is KEPT
verbatim — it is a live, deliberately-declined gap that names its own workaround and test.

### 10770-10773 [diff-justification] `→ byte-identical for non-positional fixtures`.
ACTION: rewritten to "with no positioned opposing actors this is a no-op".

### 12106 [workstream-label] `Since PR5b the sink keys intake by victim.id` (surfaced by the
re-run after batch 4). ACTION: rewritten — label dropped.

Oracle after batch 5: **GREEN**.

## Batch 6 — the reactive drain contexts, drainQueue, and the shared cast-arg builder (9000–10500)

### 10381-10386 [history-claim] `It used to be `lastAttackerTurn.enemyHpPct` … That is #341`
ACTION: rewritten as a present-tense rule ("Read from the ROSTER, never from the focus's struck
victim (#341)") keeping the concrete failure it prevents.

### 10358-10364 [workstream-label] `Documented deviation from the Phase 1 contract's turn-started
mapping … no observable ordering change vs the old emit site`
ACTION: rewritten — the phase label and the diff argument dropped, the round-started-is-the-reliable
-signal rule and the "nothing between beginRound and here emits an event" fact kept.

### 10295-10300, 10208-10211 [diff-justification] `Side-parameterized drain replacing the former
separate `drainIntents`/`drainEnemyIntents` closures … byte-identical for the player side too` ·
`Behaviourally identical to the pre-refactor drainIntents`
ACTION: rewritten — the guard is described as an allocation saving with its own no-op proof, not as
a diff argument.

### 10259-10269 [workstream-label] `Enemy drain (enemy-team PR1) … (PR1 exercises self-target only;
this future-proofs PR2 enemy→enemy reactions) … (Gap F …, done in enemy-team PR3)`
ACTION: rewritten — labels dropped; recipientIds' meaning and grantAllyCharges' side kept.

### 10220-10237 [history-claim] `Each used to be a ternary on `hasPositionedEnemyRoster` … Two OTHER
gates were tried for this job and both were wrong; the history is worth keeping …`
ACTION: DELETED the 15-line history (both gates it names — `dummyEnemyIsVestigial`,
`positionalTeamBattle` — no longer exist under those names). Replaced by the two-line present-tense
contract: the resolvers read the real roster unconditionally, because the boundary refuses an
absent/empty `enemyAttackers`.

### 10172-10191 [history-claim] `(review fix: the original single-cell `once()` ignored `ownerId`
entirely …)`
ACTION: rewritten as a forward-looking "memoizing on the ctx instance ALONE would…" so the hazard
survives without the review narrative. The rest of the onceByOwner argument is untouched.

### 10087-10119 [workstream-label, count-enum] the 33-line mostBuffsAmong header
`C2b-2:` · `SP-4c-2d: the executor NO-OPS on undefined. It used to fall back to ctx.enemyId … 73
measured hits suite-wide` · `#407 CLOSED what #403 review Finding 5 left open` · `MEASURED, not
argued — and measured twice … 1086 calls … 4 suite-wide … only 24 times … byte-identical across the
fix`
ACTION: rewritten to 18 lines. Every measurement count deleted (policy class 2). KEPT: the selection
rule, the ties rule, the total-function contract for an empty roster, the whole `#407` liveness
argument (liveness lives at the SEAM, enforced by the `AliveRoster` type, which is why this loop
asks nothing), the corpse hazard it prevents, and the `aliveSelectorTarget.integration.test.ts`
observer.

### 10083 [workstream-label] `ship-kit W3 (Sansi):` → `(Sansi)`. ACTION: rewritten.
### 10069-10073 [count-enum] `(site 4 of the four-site sweep — …)` → `(read by …)`. ACTION:
rewritten — the count dropped, the pointer kept.
### 10049 [workstream-label] `SP-4d Fix wave 1: no `?? 1` default` → `Deliberately NO `?? 1``.

### 9951-9959 [workstream-label] `Phase 4c PR 1 Task 6 / bySide PR3 Task 2: … Enemy side: 100 for
every owner until PR5. #415: this used to add "…"`
VERIFIED before rewriting: the enemy arm really does return 100 for every owner
(`selfHpPctFor` at the side-context bundle), and the bundle's own doc explains why. So the claim is
TRUE and only the `until PR5` pending-label had to go.
ACTION: rewritten — labels and the retracted #415 sentence dropped; the asymmetry now POINTS at the
bundle's note (one rule, one place) instead of restating it.

### 9926-9933, 9947-9949, 9884-9886, 9879-9880 [history-claim, diff-justification]
`#415: this used to read "healing mode only — undefined in DPS mode …"` and three
`byte-identical` / `Empty in DPS mode → byte-identical` tails.
ACTION: all rewritten present-tense; `#415` and both pinning test names kept.

### 9895-9903 [history-claim] `enemyHp (IntentExecContext) deleted … Fix wave 1: cumulativeDamage
(IntentExecContext) is deleted too — it had zero readers … Do not reintroduce it …`
ACTION: DELETED. It documents two fields that are not on the interface; a reader following it finds
nothing. The live sentence beneath it (bomb damagePerStack/affinity resolve per OWNER) is kept.

### 9830-9834 **FALSE (count)** `The four side-specific fields are `runtimes`, `recipientIds`,
`isLowestSpeedAllyFor`, and `grantAllyCharges`; everything else is shared`
EVIDENCE: `grep -n 'sideCtx\.'` in this function returns FIFTEEN distinct fields — the four named
plus `removeEnemyCharges`, `removeChargesFrom`, `selfHpPctFor`, `enemyWithMostBuffs`,
`enemyWithHighestAttack`, `enemyWithHighestSpeed`, `livingOpposingActorIds`, `firstActivatorId`,
`lastStandingId`, `oncePerRoundConsumed`, `perRoundFireCounts`, `adjacentAllyIdsFor`,
`adjacentOpposingIdsFor`, `footprintAllyIdsFor`. This is notes-engine-1's item-14 defect
(`ReactiveSideCtx`'s "four fields") recurring at a second site.
ACTION: rewritten to point at `ReactiveSideCtx` for the full set instead of enumerating one.

### 9805 [workstream-label] `Since bySide PR2 the granter may be …`. ACTION: rewritten.

### 9713-9722 [workstream-label, history-claim] `E5 §4.4: … Extracted from the two byte-identical
sites` and `#341: this used to carry the row's `enemyHpPct` — a DISPLAY constant of 100 …`
ACTION: both rewritten — the extraction argument and the was/now framing dropped; the
carries-NO-enemyHpPct contract and `#341` kept.

### 9553 [workstream-label] `total `attacked` cardinality is invariant across PR2`
ACTION: rewritten to state the invariant itself ("one `attacked` per victim per sub-attack").

### 9101-9122, 9123-9136, 9180-9202, 9227-9234, 9239-9246, 9260, 9333, 9379-9389, 9449, 9468,
9484-9494 [workstream-label ×9, diff-justification ×5]
The `drivePositionalTurnApply` header and its five JSDoc blocks, carrying `SP-U U2 (Option B)`,
`Note A in task-2-report.md`, `row-14 accounting, kept inline → U5`, `since PR2 Task 3`,
`PR8 (multi-hit full-walk epic)`, `PR8 split the thunk … byte-identical to the pre-PR8 single
thunk … Task 4`, `PR2 Task 2`, `PR1 threads`, `PR2 Task 3` ×3, `PR1 added it trailing`,
`N=1 is byte-identical BY CONSTRUCTION`, `both loops stay byte-identical`, `the pre-PR2 emit …
byte-identical`, `the pre-PR2 behaviour this branch exists to preserve`, `R5(i)`, and a pointer to
a plan file (`The plan prescribed `damage === 0` here; that was a plan defect, corrected in the plan
file too`).
ACTION: all rewritten. Every mechanism kept — the two injected callbacks and why, the fallback +
final-flush split, the sub-attack grouping and its Tenacity/log consequence, the OPTIONAL
`subAttackIndex`, the footprint-alone gate with both bullets, the `deliveredDamage: 0`
requirement and why omitting it pays riders for a cast that struck nobody, and the `subAttack`
stays-undefined → `flushReflectLogs` drains everything rule. Every `byte-identical`, `N=1`, PR/Task
label and the external plan-file pointer are gone; "N=1" is rendered as "with one hit".

### 9028-9034 **FALSE (class 3 — an orphan doc)** the `#367 … enemy-APPLIED heal-channel modifiers
… Spread-guarded like `preFight` so a clean actor omits the key entirely` block
EVIDENCE: there is NO spread between this comment and the next one — the comment sits alone,
followed by a blank line and then the `#389/#396` block that documents the spread which REPLACED it.
`grep -rn enemyAppliedHeal src` finds no such key in engine.ts; the #389/#396 comment itself says
"#367 originally passed the heal pair as summed percentages (`enemyAppliedHeal`) … Both pairs now
travel as families". So the comment documents a property that no longer exists and appears, on a
skim, to document the `enemyAppliedFamilies` spread below it — which has different semantics.
ACTION: deleted. The #389/#396 block already carries everything true in it.

### 9000-9006, 9016-9017, 9023-9026, 9050, 9055-9062, 9072-9075 [workstream-label,
diff-justification]
`ALL THREE CAST-SITES (PR1 + PR3 + PR4) … the WALKED-TEAM site (PR4 …) … With the walked-team loop
now wired` · `F3:` · `Sub-project I, PR I3 (Layer 1):` · `per I3` · four `byte-identical` tails.
ACTION: all rewritten — labels and tails dropped, contracts kept.
NOTE: line 8998 is part of the SAME comment block and carries a `→ byte-identical` tail. It was
edited and then RESTORED, because it sits below the 9000 boundary and belongs to the residue agent.

Oracle after batch 6: **GREEN**.

## Line-width pass

74 added lines exceeded prettier's `printWidth: 100` after the rewrites. They were re-wrapped by a
script constrained to (a) lines at or past 9000, (b) plain `//` comment lines, (c) lines this run
added, run to convergence. Verified TWO ways afterwards:
- the oracle stayed **GREEN**;
- a whitespace-normalised comparison of every comment block before and after the re-wrap printed
  `blocks equal: True` over all 8033 blocks — i.e. the re-wrap moved line breaks and changed NOT ONE
  WORD.
Three artefacts the script produced were then repaired by hand: one bullet continuation that lost
its indent (`//  - NON-positional: …` / `// drains`), one `HP/ shield` split by a wrap, and five
inline code spans split mid-expression (`` `damage > `` / `` 0` ``). Final count of added lines over
100 columns: **0**.

---

## FALSE COMMENTS FOUND

Sixteen distinct false claims. The dominant family is again the one both earlier agents found — a
comment that survived the deletion or replacement of the thing it describes — with the
wiring/reader family second.

1. **`Generic DoTs are never auto-applied from skill text in this task`** — TWO sites (13130 and
   12663, the latter adding "real once E2/E3/E4 populate genericDoTEntries"). `convertHitToSelfDot`
   (engine.ts:1997) pushes into `victim.genericDoTEntries` and is called from the shared
   victim-damage funnel (engine.ts:6145) on a `transform-incoming-to-dot` ability the parser DOES
   emit (`skillTextParser.ts:3151`; Voron/Orel, Hit Mitigation). notes-engine-1 item 12, recurring.
2. **`Only the attacker entry exists today`** (12651) — contradicted 60 lines below, where
   `teamRoundDamage` sums every `roundDamage` id that is NOT the focus.
3. **`Rounds always have exactly one focus turn today`** (12595) — contradicted by the very next
   statement, `if (!focusTurns.length)`, whose own body names TWO ways to reach zero.
4. **`see the focus-death exit beside the enemy-death one below`** (12615) and **`Focus-death exit,
   sibling of the enemy-death one above`** (13218) — both point at an exit that no longer exists
   (its own obituary sat at 13203 and was deleted this run).
5. **`the post-round death-drain`** — TWO sites (12523, 13205), both asserting a drain that runs
   after the turn loop. `drainIntentsFor(` past line 12400: 12470/12471 and 12494/12495 (inside the
   turn loop) and 12770/12771 (`round-ended`). There is no third.
6. **`the player→enemy-attacker variant … stays latent (no firing site threads a player→enemy
   targetId yet — a future per-victim-accounting PR lights it up)`** (12484) — `playerTurn.ts:2369`
   calls `applyTimedAbilityStatus(r, status, actor.id, vid)`; `vid` lands as `enemyTargetId`
   (`statusEngine.ts:1682-1707`). The wiring/reader family.
7. **`enemyAttackedSignals is the helper's returned per-victim signals`** — TWO sites (12368 and the
   whole leading paragraph at 12188). `grep` finds the identifier ONLY inside those comments; the
   variable is `enemyEmitDeferred`. At 12188 the dead paragraph sat directly above the live
   declaration and read as its doc.
8. **`Non-positional path only (… no fixture threads enemy positions)`** (12353) — contradicted 150
   lines below in the same function: "the sim goldens (2v2/3v3/healing) thread enemy
   positions+patterns so real enemy attackers hit player victims here".
9. **`Undefined for every current fixture → enemyPositional false`** (11763) — same falsehood, same
   refutation.
10. **`These aggregate locals feed ONLY the non-positional damage-taken leech block below`** (12171)
    — that block was deleted by #374 (a comment 130 lines away says so). The surviving reader is the
    non-positional `attacked` emit's `shieldWasHit` computation.
11. **`surfacing those other per-actor buckets as result rows is the still-deferred
    symmetric-accounting surface`** (12138) — they ARE surfaced, as `RoundData.perActorIncoming`,
    assembled in this same function and read by four modules (notes-engine-1 item 7).
12. **`The four side-specific fields are …`** (9830) — fifteen `sideCtx.` fields are read in that
    function. notes-engine-1's item-14 defect at a second site.
13. **The orphaned `#367 … enemy-APPLIED heal-channel modifiers` doc** (9028) — documents a spread
    that does not exist, sitting immediately above a DIFFERENT spread it appears to describe.
14. **`The dummy-sink enemy is NOT bumped here any more … Nothing reads it`** (10591) — describes an
    actor that does not exist.
15. **Three quoted-then-retracted claims** — `"No production caller threads position+target+pattern
    for an enemy yet → false for every golden" was true when written and is NOT true now` (11928),
    and `At Task 8b no production caller threaded these, so it was false for every existing
    test/golden` at BOTH the focus (11098) and walked-team (11460) sites. Each leaves a false
    sentence on the page for a skimming reader to lift out of context; all three were rewritten so
    only the true statement remains.
16. **A cross-reference I broke and repaired** — the walked-team site instructs the reader to
    `search `the fallback is now REACHABLE``. My rewrite of the focus site removed that exact string.
    Both were updated to `THE FALLBACK IS REACHABLE`. Recording it because it is the failure mode
    this sweep is most likely to create: fixing one comment can silently orphan another's pointer.

Plus three PRE-EXISTING prose defects repaired in passing (none a false claim):
- **11460 (walked-team positional APPLY)** — the sentence `…→ byte-identical. STALE since` ended
  mid-clause and ran straight into the next sentence, so the reader could not tell what it was stale
  since.
- **12011** — `…the same expression the two player sites have recorded since SP-4d` with no
  terminator, running into `All three sites read one expression…`.
- **11704** — a stray `/` inside ``at `enemyPositional`/)``.

## FLAGGED FOR OWNER

**None.** Every false claim above was settled by grep against a named symbol, reader, or call site —
none required a ruling about how the game ought to behave, so each was safe to rewrite in place. No
comment in 9000+ asserted a MECHANIC that the adjacent code visibly does not perform.

Two standing items are PRESERVED in the code (kept, not flagged as defects, because they are
deliberate and already carry their own ⚠️):
- **`#358 ADDENDUM 2` (now `#358`), the enemy non-positional intake fold** — a known raw-axis
  under-report at a corpus-unreachable site, parked by owner ruling and tracked with **#357**. Kept
  in full; only its file/test counts were removed.
- **The `#415` DoT-tick accounting fork** — in DPS mode an enemy DoT ticking on the focus takes the
  heal-target branch, which omits `creditDealt`/`roundPerTargetDamage`, so it is absent from
  `RoundData.perTargetDamage`. Deliberately declined; kept verbatim.

One observation OUTSIDE my file, offered as a note rather than a change (I did not open it for
writing): **`triggers.ts:2691`** documents "`runPlayerTurn`'s `enemyAppliedHeal` turn arg (#367)".
That arg no longer exists — it is `enemyAppliedFamilies` now — so it is the same orphan as finding
13, in the file another agent is sweeping.

---

## Verification

- `tokenOracle.mjs --base origin/main src/utils/combat/engine.ts` → **GREEN** (37842 tokens
  identical) on the untouched baseline, after every batch, after the scripted re-wrap, and in the
  final state. **Zero code bytes changed.**
- **Negative control** (run early, after batch 1, not at the end): appended
  `export const __probe = 1;` → the oracle reported **RED, exit 1**, naming the divergence at token
  37842 (`ExportKeyword :: export`). Removed that exact line by text edit (never
  `git checkout`/`restore`) → **GREEN, exit 0**. The instrument has been seen to report both
  outcomes in this session.
- **Boundary**: measured against a pre-run snapshot (`engine.pre-A3.ts`), not against `origin/main`,
  because the working tree also carries two other agents' uncommitted work.
  `diff -U0 snapshot current` → the LOWEST changed hunk starts at snapshot line **9000**. One edit
  had landed at 8998 (the same contiguous comment block as my 9000 block) and was reverted.
- File: 13277 → 12953 lines (324 removed, all comment text).
- `blocks.mjs --from 9000 --to 99999` re-run at the end: **5** candidate blocks remain, down from
  **214**. All five are finder false positives, each verified by reading: "a target that no longer
  exists" and "can no longer leave inTurnLoop stuck true" (×2) are present-tense contracts,
  "All three sites read one expression" is a symmetry statement whose three sites are named on the
  spot, and the `flushDeferredEnemyApplications` JSDoc trips `count-enum` on "the three turn sites".
- Residual dead-vocabulary grep over lines 9000+ (`Task N`, `task-N`, `SP-*`, `Sub-project`, `PRn`,
  `D-PRn`, `Wave N`, `Phase N`, `Wn`, `H1 Tn`, `epic PR`, `Ship-kit`, `byte-identical`,
  `zero-churn`, `Fix wave`, `C2b-2`, `PR-A/B/C`, `Un`, `R5(`, `(~NNNN)`): **zero hits**.
- Line width: **0** added lines exceed 100 columns (measured in characters, not bytes).
- Prose integrity: the whole diff read end to end, plus automated checks for duplicated words,
  residual dead vocabulary and unbalanced backticks in added lines. Three pre-existing defects
  repaired (listed above) and three re-wrap artefacts fixed.
- Not run, per instructions: `npm test`, `tsc`, `lint`. Nothing committed. `triggers.ts`,
  `playerTurn.ts`, `statusEngine.ts` and every other module were never opened for writing.
