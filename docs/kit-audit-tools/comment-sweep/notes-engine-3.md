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
