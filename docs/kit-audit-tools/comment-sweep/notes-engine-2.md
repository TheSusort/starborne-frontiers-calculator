# notes-engine-2 — `src/utils/combat/engine.ts`, lines 4400–8999

Agent A2, region 2. Line numbers are the **pre-A2 working-tree** numbers (the file as agent A1 left
it: 13382 lines), i.e. exactly the numbers `blocks.mjs --from 4400 --to 8999` printed at the start
of this batch. 122 candidate blocks.

Oracle baseline before any edit: **GREEN** (37842 tokens identical).

A byte-for-byte snapshot was taken before the first edit
(`scratchpad/engine.pre-A2.ts`) so every range check is against A2's own edits only, not A1's
uncommitted work below 4400.

---

## Blocks processed

### engine.ts:4416 [pending-claim]
CLAIM: "Consumed by the heal-apply fold (a later task) — nothing reads it yet, so this is
byte-identical."
EVIDENCE: `incomingHealAmpAbilitiesOf` is read at engine.ts:3771, which passes the list to
`incomingHealAmpForRecipient` (`healAmplification.ts:40`, imported at engine.ts:91).
ACTION: rewritten as a present-tense contract naming the reader. **WAS FALSE.** (This is the item
notes-engine-1 recorded as #15 and left for this range.)

### engine.ts:4453 [dead label, not finder-flagged]
CLAIM: `SP-F F5 (Meatshield, …)`. ACTION: rewritten — label dropped, Meatshield/R4 kept.

### engine.ts:4467, 4579 [workstream-label]
CLAIM: "Wave 4 Task 8 (FrontLine, …)" at both the map builder and the read site.
ACTION: rewritten — label dropped, the FrontLine skill text kept as the subject. The
"(byte-identical to before this task)" tail on the first was deleted.

### engine.ts:4552 [dead label, not finder-flagged]
CLAIM: `real Meatshield / SP-G G1b`. ACTION: rewritten — label dropped.

### engine.ts:4621, 4629, 4640 [workstream-label]
CLAIM: `Epic PR12 (C):` prefixes on `attackerHasDot` / `hasBarrierRecharging` / `selfHpPctOf`.
ACTION: rewritten — labels dropped; each is otherwise a present-tense contract naming its ship
(Anemone / Panon / Tormenter). `hasBarrierRecharging`'s "kept so this call site's name stays
unchanged … now lives in" history was reworded to a plain pointer at `barrierRecharging.ts`.

### engine.ts:4635 [dead label, not finder-flagged]
CLAIM: "Model-completeness epic:". ACTION: rewritten — label dropped.

### engine.ts:4649 [dead label, not finder-flagged]
CLAIM: `SP-E (Orel):`. ACTION: rewritten — `SP-E` dropped, Orel kept.

### engine.ts:4661 [history-claim]
CLAIM: "HISTORY: there used to be a second, AGGREGATE proc (`procStandingLeeches`) … #374 DELETED
the aggregate proc …"
ACTION: deleted (policy class 1). The live statement "THIS IS THE ONLY STANDING-LEECH PROC (#374)"
was kept.

### engine.ts:4673 [history-claim]
CLAIM: "Since #367 task 7 it also folds … — a term the deleted aggregate proc never had, which is
part of why that proc was not worth keeping alive."
ACTION: rewritten — the ruling kept (`#367`), the comparison to a deleted proc dropped.

### engine.ts:4683 [workstream-label]
CLAIM: "a cast's `'ally'`, which Task 4 changed to mean the caster's support footprint via
`recipientsFor`. That divergence is intentional; `recipientsFor` answers it with the caster's
support footprint. That divergence is deliberate …"
NOTE: the original also carried a DUPLICATED sentence (the divergence stated twice).
ACTION: rewritten — task number dropped, duplicate sentence removed, the OPEN RESIDUAL pointer and
its "nothing is scheduled to close it" framing kept.

### engine.ts:4687-4689 [behaviour contradiction]
CLAIM: "Note that the aggregate proc is itself UNREACHABLE and tripwired (see its own ⚠️ block) —
those two tests exercise THIS per-victim proc."
EVIDENCE: `grep -n 'procStandingLeeches\b' src/utils/combat/engine.ts` → the ONLY hit in engine.ts
was the word inside the history comment at 4661; the symbol does not exist. There is no aggregate
proc and no ⚠️ block to point at (the test files confirm: `healingPerRecipientAxis.test.ts:224`
"until #374 deleted that dead aggregate twin").
ACTION: deleted the sentence; the named `leech.test.ts` Test 3 / Test 8 pointers kept.
**WAS FALSE** — it pointed a reader at a block that does not exist.

### engine.ts:4708, 4718, 4727, 4731 [workstream-label, history-claim, count-enum]
CLAIM: the whole "THE LEECH-CHANNEL GAP CLASS'S STATUS AGAINST THIS PROC. It has FOUR instances …"
enumeration, with four numbered "(FIXED in SP-4b-2b Task 2b)" / "(FIXED — Site 3, spec §3)" entries.
ACTION: rewritten — the count and the fixed-item archaeology deleted (policy classes 1 and 2). The
live content kept as: a one-line pointer that the proc is wired at the positional apply sites (NOT
an enumeration — `grep -n 'procStandingLeechesPerVictim(' engine.ts` returns SIX call sites, one
more than the old comment's four-item list implied, which is exactly why policy class 2 forbids the
count), plus the two owner rulings (2026-08-18: neither a burst nor the passive-slot instance procs
the victim's damage-taken leech).

### engine.ts:4770 [workstream-label, history-claim]
CLAIM: "SP-4e correction: 'no enemy-side equivalent' is no longer a statement about …"
ACTION: rewritten present-tense; label dropped, the `lowest-hp-ally`-is-symmetric rule kept.

### engine.ts:4804-4805 [workstream-label]
CLAIM: "NOT a Task-4 deliverable (an earlier draft of this comment promised Task 4 would retire the
`ally` arm — it did not, and that promise expired). Task 4 changed what a plain `'ally'` means …"
ACTION: rewritten — the promise archaeology deleted; the OPEN RESIDUAL and the DISAGREE statement
kept present-tense. "for three reasons" (count) → "for the reasons below".

### engine.ts:4813 [workstream-label]
CLAIM: "re-measured … SP-4e fix wave 1. (An earlier list also named Malvex and Quixilver: …)"
ACTION: rewritten — label dropped; the corpus census kept, "an earlier list also named" turned into
the present-tense "Malvex and Quixilver do NOT belong here".

### engine.ts:5046 [history-claim]
CLAIM: "There used to be a non-positional consumption block crediting ONLY the heal target … E2
restored it here, and #374 deleted that block …"
ACTION: deleted (policy class 1). "THIS IS THE ONLY TAKEN-LEECH PROC (#374)" kept.

### engine.ts:5058, 5064 [history-claim]
CLAIM: "SEMANTICS — mirror the non-positional block PER VICTIM"; "matching the non-positional
`damage * (e.pct/100)`" — both reference a block the same comment says was deleted.
ACTION: rewritten — the references to the deleted block dropped, the four semantics bullets kept.

### engine.ts:5069 [history-claim] — behaviour contradiction inside one comment
CLAIM: "⚠️ THAT MIRROR IS NO LONGER EXACT … and the non-positional block does NOT [fold the
incoming-repair channel]. Deliberate: that block is executed by no test in the corpus … Its own
site carries the matching note. If it is ever made reachable, add the fold there first."
EVIDENCE: the SAME comment block (5046, above) states `#374` deleted that non-positional block, and
`grep` finds no second taken-leech site: `takenLeechesByOwner` is read only at engine.ts:5087
inside `procTakenLeechesPerVictim`.
ACTION: rewritten — the instructions about a block that no longer exists deleted; the live `#367`
owner ruling ("a leech self-repair IS a repair, so `Inc. Repair Down` reduces it") kept.
**WAS FALSE** (self-contradictory: it told a reader to go add a fold to a deleted block).

### engine.ts:5132 [history-claim]
CLAIM: "stated here because it was previously stated only in a task report, where the next reader
of this line cannot see it."
ACTION: deleted the meta-justification. The MEASURED 2026-08-23 corpus census below it — the actual
content — was kept verbatim.

### engine.ts:5273 [workstream-label]
CLAIM: "C2b-2 T5: … (Faust reads it in Task 6)."
ACTION: rewritten — label and task number dropped; see 5763 for the reader evidence.

### engine.ts:5290-5291 [workstream-label]
CLAIM: "This mattered while the vestigial dummy `enemy` existed … (Retiring its TURN in SP-4c-2c
did not help …) SP-4c-2d deleted the actor, and `actorsBySide` is now defined as …"
ACTION: rewritten — the dummy-actor archaeology deleted; "READS THE ROSTERS, NOT `actorsBySide`"
and the same-set justification kept.

### engine.ts:5278 [dead label, not finder-flagged]
CLAIM: `SP-G G3 (CodeRabbit):`. ACTION: rewritten — label dropped.

### engine.ts:5346 [workstream-label]
CLAIM: "Before SP-4c-2d that scalar was the deleted dummy enemy's class."
ACTION: deleted; the live enemy-type-gate contract kept.

### engine.ts:5360, 5526 [dead label, not finder-flagged] + stale line pointers
CLAIM: "E5 §4.5 — …"; and two hard line pointers "(~2365)" / "(~2331," that no longer resolve
(the referenced code sits at 5527 / 5366).
ACTION: rewritten — `E5` dropped (`§4.5` kept as the rule pointer), both stale line numbers deleted,
"E5 does NOT merge them" → "the engine does NOT merge them".

### engine.ts:5373 [workstream-label]
CLAIM: "(dynamic-speed turn order, Task 3)". ACTION: rewritten — task number dropped.

### engine.ts:5384-5385 [workstream-label]
CLAIM: "SP-4c-2c dropped the dummy `enemy` from the order … SP-4c-2d deleted the actor, so
`allActors` IS the order".
ACTION: rewritten — history deleted; "`allActors` IS the order — every member acts" kept. The
adjacent "(identical to the old loop visiting then continue-ing)" was deleted with it.

### engine.ts:5506 [history-claim]
CLAIM: "#374 deleted the aggregate `procStandingLeeches` this used to call, having shown it
unreachable by construction …"
ACTION: rewritten — history deleted, `#374` kept as the rationale pointer, and the live statement
("`procStandingLeechesPerVictim` is the only standing-leech proc") kept.

### engine.ts:5514 [workstream-label] + [count-enum]
CLAIM: "── SP-4b-2 D1: …"; "There are exactly THREE such writes in this file — the focus cast site,
the walked-team cast site and `applyReactiveDamage`". Also a commit-hash measurement
("measured @841e1bc0 vs HEAD, same fixture: 60000 → 0").
ACTION: rewritten — label, count and the commit-relative measurement dropped; the mutual-exclusion
contract and the Echoing Burst rationale kept.

### engine.ts:5591 [workstream-label]
CLAIM: "(healing mode, Task 10a)". ACTION: rewritten — task number dropped.

### engine.ts:5634 [byte-identical tail]
CLAIM: "so every existing path reads/mutates `healTarget!` exactly as before (byte-identical)".
ACTION: rewritten — diff justification dropped.

### engine.ts:5639 [count-enum, history-claim]
CLAIM: "the byte-identical body of the legacy applyIncomingToTarget closure with the four
side-specific accounting bits hoisted into `sink` … moved verbatim … now live in `resolveLethalHp`".
ACTION: rewritten — the count, "moved verbatim" and the "now live" framing dropped; the
what-lives-where contract kept present-tense.

### engine.ts:5649 [workstream-label]
CLAIM: "Task 3 (combat-log) — deferred reflect log emit."
ACTION: rewritten — label dropped, heading kept. The "→ inline emit, byte-identical" tail below it
was also dropped.

### engine.ts:5663-5672 [workstream-label, JSDoc]
CLAIM: "(epic: multi-hit full-walk attacks, PR2 Task 3)".
ACTION: rewritten — label dropped. The whole rest of the JSDoc (the buffer/drain reasoning) is a
present-tense contract and was kept verbatim. Oracle re-run immediately after this JSDoc edit:
GREEN.

### engine.ts:5763 [workstream-label, pending-claim]
CLAIM: "No consumer reads these yet (Faust, Task 6), so production stays byte-identical."
EVIDENCE: `killerId` IS read — `triggers.ts:1390-1408` routes `counterTargetId: e.killerId` for the
on-destroyed reactive (Salvation/Faust); `state.ts:262` stamps it onto `ship-destroyed`;
`lethalHp.ts:96` forwards it.
ACTION: rewritten as a present-tense contract naming the reader. **WAS FALSE.**

### engine.ts:5774 [workstream-label]
CLAIM: `/** G PR1: true when THIS application is a counterattack …`
ACTION: rewritten — label dropped; the loop-safety contract kept.

### engine.ts:5787-5801 [history-claim, JSDoc]
CLAIM: "#358 ADDENDUM 2/3", "(addendum 3)", and "`rawIntakeAxis.test.ts` path 8, which went green
when it was deleted".
ACTION: rewritten — the addendum numbering collapsed to bare `#358`; the two NAMED pinning tests
kept (they are the tripwire this comment points at), the "went green when it was deleted" aside
dropped. Everything else in the JSDoc is a live contract and was kept.

### engine.ts:5803-5806 [workstream-label, JSDoc]
CLAIM: `/** Epic PR12 (A): true when this victim IS the attacker's resolved anchor …`
ACTION: rewritten — label dropped.

### engine.ts:5946-5947 [history-claim]
CLAIM: "post-ADDENDUM A2/A5 (#358) … therefore no longer diverges between the two reads (a +100%
Defense buff used to inflate the chunk by ~13% before A2; it no longer does)".
ACTION: rewritten present-tense ("does NOT diverge"); `#358` kept, the A2/A5 addendum labels and
the before/after measurement dropped.

### engine.ts:5955 [byte-identical tail]
CLAIM: "It is the pre-fix expression, kept byte-identical so those paths do not move".
ACTION: deleted; the fallback's live description kept.

### engine.ts:5997 [history-claim]
CLAIM: "emitted AFTER it, at exactly the point the single aggregate row used to be emitted, so the
event ORDER … is unchanged — only the row count and the per-row amount move."
ACTION: rewritten present-tense (where the rows sit relative to what the sub-hits raise).

### engine.ts:6236 [count-enum]
CLAIM: "All five together enforce the Exposed invariant".
ACTION: rewritten — count dropped ("Together these enforce"). Counts are stale by construction.

### engine.ts:6240 [history-claim]
CLAIM: "The `bombPortion === 0` clause used to make the two steps DISAGREE about a bomb burst …
RESOLVED (owner ruling, #355) … so the sibling now carries this same clause and the two agree."
ACTION: rewritten present-tense — the `#355` owner ruling kept as the subject, the disagreement
history dropped, and the "neither clause should be removed on the strength of the other" rule kept.

### engine.ts:6411 [history-claim]
CLAIM: "True ONLY when the last charge went and the status was removed — the turn-expiry path …
emits the same event with the same fields …"
ACTION: **kept (legitimate contract).** This is a present-tense description of
`consumeStatusHit`'s return value and of the shared `buff-expired` emit; the finder matched
"was removed". Verified against the `if (statusEngine.consumeStatusHit(...)) bus.emit(...)`
immediately below.

### engine.ts:6493 [dead label, not finder-flagged]
CLAIM: "the H1 granted accumulator". ACTION: rewritten — `H1` dropped.

### engine.ts:6498 [history-claim, count-enum]
CLAIM: "this used to be the only shield source that lands here … — Shield Converter above is the
second, self-granting the same way …"
ACTION: rewritten present-tense (a threshold shield, like the Shield Converter grant above,
self-grants inside the damage funnel); the ordinal ("the second") dropped.

### engine.ts:6468 [dead label, not finder-flagged]
CLAIM: `SP-F F2 (AEGIS):`. ACTION: rewritten — `SP-F F2` dropped, AEGIS kept.

### engine.ts:6642 [workstream-label]
CLAIM: "the other half of a deliberate granularity asymmetry (events.ts) was the enemy dummy's
coarse INTEGER post-round emission, which SP-4c-2d deleted with the round-tail HP block."
ACTION: deleted; "Exact percentages, not integers" kept.

### engine.ts:6657 [pending-claim]
CLAIM: "TODO(verify): whether a fully-Barrier-blocked direct attack should count as a hit for
Alacrity is unconfirmed in-game; current default is 'not a hit'."
ACTION: **kept (legitimate contract).** This is an open GAME-BEHAVIOUR question with the current
default stated — exactly the channel this project wants such questions in. It is not a workstream
label and there is no code fact to check it against. Surfaced under FLAGGED FOR OWNER below as a
standing question, not as a defect.

### engine.ts:6707 [workstream-label]
CLAIM: "Epic PR12 (A): … Undefined/true … keeps it included — byte-identical there."
ACTION: rewritten — label and byte-identical tail dropped.

### engine.ts:6714 / 6720 [workstream-label] — behaviour contradiction
CLAIM: "NIT 2 (reactive paths do not over-fire): … the reactive-damage executor
(applyReactiveDamage) reaches applyVictimDamage under that SAME isCounter:true flag **when it has a
real positioned victim, and is credit-only (creditDamage, never reaching this block at all)
otherwise**."
EVIDENCE: `applyReactiveDamage`'s own doc (engine.ts:7236) and its apply site (7429) both state the
credit-only arm was deleted and the apply is unconditional; the closure requires a concrete
`victimId` and every triggers.ts arm returns early on an empty living roster.
ACTION: rewritten — the "credit-only otherwise" arm removed; the reactive path now described as
ALWAYS reaching applyVictimDamage under isCounter:true. The NIT labels became plain headings, and
"(see the PR12 review report for the full call-site enumeration)" was deleted (external report
pointer). **WAS FALSE.**

### engine.ts:6730 [workstream-label]
Covered by the 6714/6720 entry — the PR12 review-report pointer was deleted.

### engine.ts:6747 [dead label, not finder-flagged]
CLAIM: `SP-U U1`. ACTION: rewritten — label dropped.

### engine.ts:6791 [history-claim]
CLAIM: "(#358 addendum 3, carried finding 9) — the pre-defence twin used to be a hand-copied second
function."
ACTION: rewritten present-tense (`reflectedDamageParts` returns both from a single walk); `#358`
kept, the finding number and the history dropped.

### engine.ts:6940 [prose defect, not finder-flagged]
CLAIM: "IMPORTANT 1 (Shield Converter review): … — otherwise shieldWasHit detection / The
shieldWasHit detection reads a nullify-and-grow as …" — a DANGLING half-sentence followed by a
restart, almost certainly left by an earlier sweep.
ACTION: rewritten into one sentence; the review label dropped.

### engine.ts:6966, 6971 [history-claim]
CLAIM: "The heal target's death round is no longer tracked via the sink"; "Signature … unchanged, so
every existing call site stays byte-identical"; "Formerly two separate per-side sink objects with
byte-identical bodies; collapsed since they never diverged."
ACTION: rewritten — history and diff justification deleted; the two live facts (death round read
off `destroyedRound`; one sink serves both sides because ids are globally unique) kept.

### engine.ts:6957, 6965, 6968, 7035, 7077, 7084, 7086, 7852 [dead labels, mostly not finder-flagged]
CLAIM: `H1 T4:`, `C2b-2 T5:`, `A2:` prefixes; "(threaded in Tasks 1-2)".
ACTION: rewritten — labels stripped, every sentence kept as a present-tense contract.

### engine.ts:7045-7046, 7074-7075 [workstream-label]
CLAIM: "Epic PR12 (A): forwarded to … Undefined at every pre-PR12 call site → byte-identical."
ACTION: rewritten — label and byte-identical tail dropped; replaced with the live rule
("Undefined ⟹ treated as primary").

### engine.ts:7062, 7069 [dead label, not finder-flagged]
CLAIM: "(E1 — symmetric incoming surface)"; "E2 (per-victim leech) reads this surface"; "→
byte-identical".
ACTION: rewritten — labels and tail dropped.

### engine.ts:7096 [workstream-label, pending-claim]
CLAIM: "hand the genuine wrapper out once (no production caller until Task 8) … Inert in production
(the field is never set)."
EVIDENCE: grepped — `__testTapApplyOutgoingToEnemy` is set ONLY by
`applyOutgoingToEnemy.test.ts:162` and `enemyDotFamilyCounts.integration.test.ts:139`. The claim
HOLDS.
ACTION: rewritten — task number dropped, the two test files named so a future reader can re-check
the claim instead of trusting it. **Not false.**

### engine.ts:7101-7102 [workstream-label, pending-claim]
CLAIM: "G PR1: … Unreferenced dead code until the executor wires it via ctx.applyCounterAttack →
byte-identical now."
EVIDENCE: `applyCounterAttack` is passed into the reactive executor at engine.ts:10028 and CALLED
at `triggers.ts:5036` (`ctx.applyCounterAttack?.(…)`), typed on the ctx at `triggers.ts:1950`.
ACTION: rewritten as a present-tense contract naming the executor and the calling branch.
**WAS FALSE.**

### engine.ts:7146 [history-claim]
CLAIM: "#395 CLOSED THE #389 RESIDUAL HERE. This used to be a hardcoded 0 …" plus a corpus count
("861 counter invocations across the suite").
ACTION: rewritten — the both-halves rule kept with both issue refs; the hardcoded-0 history and the
861 count dropped. The reason `reactiveOutgoingFold.test.ts` hand-authors the shape was kept as a
present-tense fact about the corpus.

### engine.ts:7161 [workstream-label]
CLAIM: "PR2 may thread incomingReductionForHit(…) here to match the Reflect path exactly."
ACTION: rewritten — the PR promise turned into a plain statement of what threading it would achieve
(the approximation itself is unchanged and still documented).

### engine.ts:7117 [dead label, not finder-flagged]
CLAIM: "`sink` (outer scope, SP-U U1)". ACTION: rewritten — label dropped.

### engine.ts:7237, 7241, 7245, 7248 [workstream-label]
CLAIM: "epic PR4's re-tagged Judge/…"; "PR4b changed only the NUMBER's formula …; SP-M M1 then split
WHERE it lands"; "SP-4c-2d deleted the second one — the credit-only arm … see the SP-4c-2d note on
the apply below".
ACTION: rewritten — all history deleted; the live invariant kept: exactly ONE destination
(per-victim `applyVictimDamage` + `creditDealt`), never the scalar `creditDamage` bucket, no gate.

### engine.ts:7255-7256 [history-claim, workstream-label]
CLAIM: "the arm that used to (`counterTargetId ?? ctx.enemy.id`) returns early on an empty living
roster since SP-4c-2d Task 1".
ACTION: rewritten present-tense ("every arm returns early on an empty living roster").

### engine.ts:7266, 7272, 7316, 7353, 7392 [workstream-label]
CLAIM: `Ship-kit W8 (Xcellence …)`, `Ship-kit W5 Task C3 (Demolisher bomb-splash)`, `Ship-kit W5`.
ACTION: rewritten — the `Ship-kit Wn` labels dropped, the ship names kept as the subject. The
"Both absent (every pre-C3 caller) → byte-identical to the pre-C3 body below" tail was rewritten as
"Both absent ⟹ the plain attack-basis walk below".

### engine.ts:7429, 7437 [history-claim, workstream-label]
CLAIM: "This whole apply used to sit behind `hasPositionedEnemyRoster && victim.id !== enemy.id`,
with a CREDIT-ONLY else arm … The `{ … }` block that survived the gate's deletion is dedented away
with it — it was a phantom nesting level …"
ACTION: rewritten — all of it is archaeology; the live rule kept (the apply is UNCONDITIONAL; a
caller with no victim must not arrive here; a victimless reactive infliction is an executor no-op).

### engine.ts:7508 [workstream-label, pending-claim]
CLAIM: "(Task 3 adds the Akula doesntBreakStasis exception — placeholder left below.)"
EVIDENCE: the exception is IMPLEMENTED. The three turn-loop cast sites compute
`tgtWasStasised = !actor.doesntBreakStasis && tgt !== undefined && isStasised(tgt.id)`
(engine.ts:11106, 11521, ~11904) and only wire `onHitBreakStasis` when it is true.
ACTION: rewritten as a present-tense contract describing the implemented exception.
**WAS FALSE** — it announced as pending a mechanic that already ships.

### engine.ts:7591 [workstream-label]
CLAIM: "the same oversight already fixed for the incoming-damage channel by D-PR12".
ACTION: rewritten present-tense (the `selfIncoming` twin already folds that term).

### engine.ts:7611 [workstream-label]
CLAIM: "F3: … the same per-victim channel the D-PR12 self-buff term rides … Absent → 0 →
byte-identical."
ACTION: rewritten — labels and tail dropped.

### engine.ts:7635 [history-claim]
CLAIM: "This also collapses same-family duplicates WITHIN the enemy list, which the previous plain
`reduce` did not."
ACTION: rewritten — the previous-implementation comparison dropped, the rule kept.

### engine.ts:7655, 7657 [history-claim]
CLAIM: "a self-sourced instance the enemy side SHADOWED is no longer in the channel"; "a term the
mixed total no longer holds".
ACTION: rewritten present-tense (SHADOWS / does not hold); `#396` kept.

### engine.ts:7663 [workstream-label] + reachability claim
CLAIM: "expose victimIncomingModifiers (…, D-PR12) to unit tests … Inert in production (never set)."
EVIDENCE: grepped — `__testTapVictimEnemyModifiers` is set only in
`perVictimDebuffRouting.test.ts`, `victimEnemyModifiers.test.ts`, `crossStoreShadowingIncoming.test.ts`
and `preFightModifiersEngine.test.ts`. The claim HOLDS.
ACTION: rewritten — label dropped, the claim restated as "has no production caller — only the
per-victim modifier tests set it". **Not false.**

### engine.ts:7665 [dead label, not finder-flagged]
CLAIM: "Sub-project I, PR I2 (Layer 3) —". ACTION: rewritten — label dropped.

### engine.ts:7755-7763 [workstream-label, JSDoc, count-enum]
CLAIM: "Extracted verbatim from `drivePositionalApply`'s inline `defenseProfileOf` … Identical
across all three cast sites (B1/PR7b + D-PR12)".
ACTION: rewritten — the extraction history and the site count dropped; the sharing rule ("resolves
against the SAME per-victim modifier state the firing hit does") and direction-agnosticism kept.

### engine.ts:7785 [workstream-label]
CLAIM: "B1/PR7b + D-PR12: per-victim incoming-damage modifier". ACTION: rewritten — label dropped.

### engine.ts:7811 [workstream-label, count-enum]
CLAIM: "Shared positional-apply driver (Task 9, Step A) — the ONE place the three attack sites …"
ACTION: rewritten — label and count dropped; the named sites (focus / walked-team / enemy) kept as
a list rather than a number.

### engine.ts:7821 [workstream-label, count-enum]
CLAIM: "`defenseProfileOf` is identical across all three sites (B1/PR7b + D-PR12: wired to …"
NOTE: the original parenthesis was never CLOSED — a pre-existing prose defect.
ACTION: rewritten — count and labels dropped, the unbalanced paren removed, the store-read contract
kept.

### engine.ts:7833 [workstream-label]
CLAIM: "hitCrits is co-populated with positionalScalars by Task 7".
ACTION: rewritten — task number dropped; the co-population invariant and the "`?? []` is DEFENSIVE
only" note kept.

### engine.ts:7838 [dead label, not finder-flagged]
CLAIM: `/** W6: ship-wide stealth-targeting bypass. */`. ACTION: rewritten — `W6` dropped.
(notes-engine-1 recorded reverting an over-broad substitution that had reached this line; it is
edited here deliberately, in range.)

### engine.ts:7860 [count-enum] + behaviour contradiction
CLAIM: "E2 (per-victim leech): … shared by all three sites … **Unsupplied by every current caller →
fully inert.**"
EVIDENCE: `onVictimResolved` IS supplied. `drivePositionalApply`'s only caller is
`drivePositionalTurnApply` (engine.ts:9361), which takes the per-site callback as a REQUIRED
parameter (9295) and forwards it (9392). `drivePositionalTurnApply` is called from three cast sites
(11254, 11581, 12296).
ACTION: rewritten — the count dropped and the inertness claim replaced with the true statement
(always supplied, so every cast site is wired). **WAS FALSE.**

### engine.ts:7864 [workstream-label]
CLAIM: "Widened with PR1's trailing `subAttackIndex`. PR1 added it to applyPositionalDamage's own
callback contract but NOT to this engine-side wrapper type, so the parameter was reachable at
runtime yet un-typeable …"
ACTION: rewritten — history dropped; the live reason the param is repeated here kept.

### engine.ts:7892 [workstream-label]
CLAIM: "Widened here for the same reason PR2 Task 2 had to widen `onVictimResolved` … → no boundary
work → byte-identical."
ACTION: rewritten — PR/task numbers and the tail dropped.

### engine.ts:7910 [workstream-label]
CLAIM: "PR1's per-sub-attack outcomes. applyPositionalDamage has always returned them … this
declaration merely stops hiding them from the callers that now emit …"
ACTION: rewritten present-tense.

### engine.ts:7916 [workstream-label]
CLAIM: "(multi-hit full-walk epic, PR4 — spec §4.3)". ACTION: rewritten — label dropped. The R1/R3
roll rules below it are live and were kept.

### engine.ts:7958 [dead label, not finder-flagged]
CLAIM: "F3 crit-conditional pre-fight damage modifiers". ACTION: rewritten — `F3` dropped.

### engine.ts:7982 [count-enum]
CLAIM: "Identical across all three sites (focus / team / enemy), so it lives here." plus "AoE
footprint victims are a future Task-3 follow-up."
EVIDENCE: the follow-up LANDED — covered footprint victims DO break Stasis, just through a
different path. `drivePositionalTurnApply` collects every covered, stasised, non-anchor victim into
`coveredStasisVictims` (engine.ts:9285, added at 9365 behind `!actor.doesntBreakStasis`) and marks
`stasisBreakPending` for each after the apply (9411-9412); the victim's own turn consumes the mark
(11343, 11646, 12458).
ACTION: rewritten — count dropped; the stale pending-task clause replaced with the true SPLIT (the
anchor breaks via `onHitBreakStasis` inside runPlayerTurn, a covered footprint victim via the
deferred `stasisBreakPending` mark). **WAS FALSE** (it announced as pending a mechanic that ships).

NOTE ON THIS ENTRY: an interim version of this rewrite said "AoE footprint victims do not break
Stasis", which is itself false — the same trap the brief warns about (re-asserting the original's
falsehood in fresh prose). It was caught by grepping `coveredStasisVictims`/`stasisBreakPending`
before this file was finalised and corrected to the split above.

### engine.ts:8005 [count-enum, byte-identical tail]
CLAIM: "Shared across all three sites (focus / walked-team / enemy) … → byte-identical when no such
equipment exists."
ACTION: rewritten — count and tail dropped.

### engine.ts:8010 [history-claim]
CLAIM: "#358 ADDENDUM 3 — … On a CRIT this used to return ONE fused number … Hence the SPLIT return
on the crit path. (It is unreachable from `DefenseSimulationInput` today, which is precisely why it
needed writing down …)"
ACTION: rewritten present-tense (on a CRIT this returns a SPLIT, and why). The parenthetical
reachability claim was DELETED rather than reworded — per the delete-first default, it is a
fence-off claim I could not verify from nearby code, and re-asserting it unverified is exactly the
failure mode this sweep exists to remove. Also dropped: "the atomic-mixed-channel trap that C3 was
written about" (dead label).

### engine.ts:8083 [workstream-label]
CLAIM: "`subAttackIndex` is optional on PR1's callback contract".
ACTION: rewritten — `PR1's` dropped.

### engine.ts:8105 [workstream-label]
CLAIM: "── SP-4b-2 D6: the passive-slot damage instance's own positional apply ──".
ACTION: rewritten — label dropped, rule bar re-padded.

### engine.ts:8087, 8177 [dead vocabulary, not finder-flagged]
CLAIM: "Recorded in code rather than in a task report"; "the same defect this task exists to remove".
ACTION: rewritten — "task report" / "this task" removed; the KNOWN GAPS structure and the Judge
fixture numbers (a real measurement, not a count of sites) kept.

### engine.ts:8326 [count-enum]
CLAIM: "Site 4 of the leech-channel class (spec §3): …"
ACTION: rewritten — the site number dropped. The channel rule, the BASIS note and the
"Standing direction only, never `procLeechesForVictim`" owner ruling below it were kept intact.

### engine.ts:8353, 8355 [history-claim, workstream-label, count-enum]
CLAIM: "Extracted from the four structurally identical bus.emit sites (…)"; "since PR2 that is ONE
SUB-ATTACK's `didCrit`". Also a >100-col line left by an earlier edit.
ACTION: rewritten — the extraction history and the count dropped; the crit-identity contract kept
and the over-long line re-wrapped.

### engine.ts:8371 [workstream-label]
CLAIM: "PR7 resolved that split: the true delivered amount now rides alongside as `deliveredDamage`
…"; "changing the basis and the cardinality in one PR".
ACTION: rewritten present-tense.

### engine.ts:8383, 8386, 8401 [workstream-label, byte-identical tails]
CLAIM: "(the pre-PR2 behaviour)"; "keeping them byte-identical"; "the single-event paths stay
byte-identical".
ACTION: rewritten — labels and tails dropped; each replaced by what actually happens (drain
everything / fall back to `damage` / emit no index).

### engine.ts:8408 [workstream-label, history-claim]
CLAIM: "nor — since PR2 — under an earlier sub-attack's row". ACTION: rewritten — label dropped.

### engine.ts:8413 [workstream-label]
CLAIM: "── Unified per-actor turn resolvers (bySide unification PR6a) ── … Each reproduces the
exact value its site used before — byte-identical."
ACTION: rewritten — label and diff justification dropped; the count "three runPlayerTurn sites"
turned into "no runPlayerTurn site hard-codes its own lookups".

### engine.ts:8463, 8465, 8467 [workstream-label]
CLAIM: "── Unified per-side turn bindings (bySide unification PR6a) ── … PR6b (DONE): decline is now
derived inside runPlayerTurn … the credit/intake & emit TAILS stay per-kind (→ PR7)."
ACTION: rewritten — labels, "(DONE)" and the "→ PR7" pending pointer dropped; the two live facts
(decline is derived inside runPlayerTurn; the tails stay per-kind) kept.

### engine.ts:8470-8471 [workstream-label, history-claim]
CLAIM: "SP-4e (#335): there is NO per-side fallback victim any more. `legacyVictim` used to live
here — the dummy sink on the player side (deleted in SP-4c-2d) and the heal target on the enemy
side."
ACTION: rewritten — labels and the deleted-symbol history dropped; `#335`, the NO-VICTIM-turn rule
and the "do not reintroduce a stand-in" instruction kept.

### engine.ts:8477 [dead label, not finder-flagged]
CLAIM: "Sub-project I, PR I5 —". ACTION: rewritten — label dropped.

### engine.ts:8485 [workstream-label]
CLAIM: "E2: returns the resolved VictimDamageOutcome (… which already surface it from E1). Epic
PR12 (A): third param … A2: the fourth param …"
ACTION: rewritten — E1/E2/PR12/A2 labels dropped, each parameter's contract kept.

### engine.ts:8506, 8564, 8988 (last is A3's) [dead label, not finder-flagged]
CLAIM: `SP-F F1:`, `SP-F F3 fix (Critical + Important):`.
ACTION: rewritten for the two in range (8506, 8564) — labels dropped, the quoted rule and the
Lingshe example kept. The third (pre-A2 line 9094) is OUT OF RANGE and untouched.

### engine.ts:8692, 8697 [workstream-label]
CLAIM: "Until SP-4c-2d the scalar also drove the dummy sink's round-tail HP overwrite …"; "STRICT
no-op (byte-identical) … no fixture seeds actor-side timed containers"; "Used by the enemy site
(PR2: …) and the focus attacker + walked-team sites (PR-B: …)".
ACTION: rewritten — the dummy-sink history, the fixture claim and the PR labels dropped; the
two-channel rule, the STRICT no-op condition and the shared-sink justification kept.

### engine.ts:8739, 8805 [count-enum] (two identical blocks)
CLAIM: "Site 2 of the leech-channel class (spec §3): the burst channel now pays … — the
pre-positional path did both via `creditDamage(sourceId, 'detonation', damage)`."
ACTION: rewritten (both, via a single exact-text replace of the shared 5 lines) — site number and
the pre-positional history dropped; the channel rule, the "Deliberately NOT `procLeechesForVictim`"
owner ruling and the `#355` delivered-amount basis kept.

### engine.ts:8822, 8824 [workstream-label]
CLAIM: "Unified positional target selection (bySide unification PR6a). Reproduces the
focus(C1)/team(C2)/enemy(C3) selection … SP-4e: there is no per-side fallback …"; "(… falls back to
the active target when unset → byte-identical for every non-divergent ship)".
EVIDENCE for the kept clause: the charged-axis fallback happens at MAP-BUILD time
(`t.chargedTarget ?? t.target` at engine.ts:2386; `e.chargedTarget ?? e.target` at 2423) and in the
focus arm (`input.chargedTarget ?? input.target`), so "falls back to the active target when unset"
is TRUE on all three arms.
ACTION: rewritten — labels and byte-identical tail dropped, the verified fallback kept.

### engine.ts:8859, 8862 [history-claim] + counts
CLAIM: "The enemy side used to fall back to `legacyVictim: healTarget` … 324 measured rows (spec §5
class C2) … (contract §A.1: 100% of the 3,206 measured player-side fallback rows …)"
ACTION: deleted (policy classes 1 and 2 — history plus two corpus counts). The "ONE rule for both
sides" contract above it was kept and `#335` added as the rationale pointer.

### engine.ts:8877, 8887-8890 [workstream-label, history-claim]
CLAIM: "(bySide unification PR6a)"; "There used to be a THIRD state — a player turn whose victim was
the dummy GHOST … SP-4c-2b made selection stop returning the ghost and SP-4c-2d deleted it …"
ACTION: rewritten — labels and the ghost history deleted; the two-state `targetId` contract and the
"read that as 'no enemy', never as 'an enemy with neutral stats'" instruction kept. "the five
containers" (a count) → "the timed containers".

### engine.ts:8901-8907 [workstream-label, history-claim]
CLAIM: "on EITHER side since SP-4e (#335) … The player side has answered that since SP-4c-2b; the
ENEMY side used to return the position-less heal-target sink … Since SP-4b-1's normalization
boundary a null resolution means … — no longer 'the DPS/healing calculators', which now supply real
placed enemies)." Also an unbalanced paren, and two byte-identical tails further down the block.
ACTION: rewritten — all labels and history dropped, paren balanced; the live rule (what a null
resolution means, and that the calculators supply real placed enemies) kept present-tense. The
`?? ` charge-fallback tail was DELETED rather than reworded (the pattern arms do fall back at map
build time, but stating it here would restate a rule that lives at
`parsedChargedPatternFor`).

### engine.ts:8933 [history-claim]
CLAIM: "mostBuffsAmong (§C2b-2, Rhodium) previously only fed the REACTIVE purge path …"
ACTION: rewritten present-tense ("also feeds"); `§C2b-2` dropped, Rhodium and the
'on-cast'-never-reaches-triggers.ts rule kept. The `#403 R4` / `#407` rulings below are keepers and
were not touched.

### engine.ts:8985 [workstream-label]
CLAIM: "PR10 (buff steal): THIS caster's own living adjacent allies …"
ACTION: rewritten — label dropped; the rest is a present-tense contract naming
`adjacentAllyIdsFor` and `bySide`, kept.

---

## Deliberately NOT touched — out of range

`blocks.mjs --from 4400 --to 8999` now also reports five blocks at CURRENT lines 8929, 8932, 8960,
8980 and 8999. All five sat at pre-A2 lines **9035, 9038, 9066, 9086 and 9105** — they only entered
the 4400–8999 window because this batch shrank the file by 105 lines. They belong to the 9000+
agent and were left untouched:

- 8929/8932 — "The player side used to carry a `tgt.id !== enemy.id` conjunct here … SP-4c-2b"
- 8960 — "SP-4b-2b — see `stealthedEnemyCount`'s own note."
- 8980 — "(SP-4c-2d dropped the identical dummy-sink conjunct)"
- 8999 — "ALL THREE CAST-SITES (PR1 + PR3 + PR4)"

Plus the `SP-F F3 fix: forced bomb-detonation sink` label at pre-A2 line 9094.

## Deliberate keeps inside the range

- **engine.ts:6411** (now 6358) — the Barrier `consumeStatusHit` "True ONLY when the last charge
  went and the status was removed" note. A present-tense contract; the finder matched
  "was removed".
- **engine.ts:6657** (now 6602) — the `TODO(verify)` Alacrity/Barrier game question. Open
  game-behaviour questions belong in the code; the current default is stated.

Everything else in the 122-block list was rewritten or deleted. `blocks.mjs --from 4400 --to 8999`
re-run at the end reports **7** blocks: those two keeps plus the five out-of-range ones above.

---

## FALSE COMMENTS FOUND

Nine distinct false claims. Five are the same wiring/reader family notes-engine-1 found; four are
the higher-value class — a comment that fences off a case, names a deleted symbol, tells a reader to
go edit code that no longer exists, or announces as pending a mechanic that already ships.

1. **`incomingHealAmpAbilitiesById`: "Consumed by the heal-apply fold (a later task) — nothing
   reads it yet"** (4416) — `incomingHealAmpAbilitiesOf` is read at engine.ts:3771 and its result
   handed to `incomingHealAmpForRecipient` (`healAmplification.ts:40`). This is the item
   notes-engine-1 recorded as #15 and left for this range; confirmed and fixed.
2. **`cause.killerId`/`byDirectDamage`: "No consumer reads these yet (Faust, Task 6)"** (5763) —
   `triggers.ts:1390-1408` reads `e.killerId` off `ship-destroyed` and routes
   `counterTargetId: e.killerId`; `state.ts:262` stamps it; `lethalHp.ts:96` forwards it.
3. **`applyCounterAttack`: "Unreferenced dead code until the executor wires it via
   ctx.applyCounterAttack"** (7102) — it IS wired: passed at engine.ts:10028, typed at
   `triggers.ts:1950`, CALLED at `triggers.ts:5036`.
4. **`onVictimResolved`: "Unsupplied by every current caller → fully inert"** (7860) — always
   supplied. `drivePositionalApply`'s only caller is `drivePositionalTurnApply` (9361), which takes
   the callback as a REQUIRED parameter (9295) and forwards it (9392); three cast sites call it.
5. **AoE Stasis break: "AoE footprint victims are a future Task-3 follow-up"** (7982) — they DO
   break Stasis, through the DEFERRED path: `coveredStasisVictims` (9285/9365) →
   `stasisBreakPending` (9411) → consumed on the victim's own turn (11343/11646/12458). The anchor
   breaks via `onHitBreakStasis` instead; the comment described the split as unimplemented.
6. **Akula: "(Task 3 adds the Akula doesntBreakStasis exception — placeholder left below.)"**
   (7508) — the exception ships. Three turn-loop cast sites gate `tgtWasStasised` behind
   `!actor.doesntBreakStasis` (11106, 11521, ~11904) and only then wire `onHitBreakStasis`.
7. **"the aggregate proc is itself UNREACHABLE and tripwired (see its own ⚠️ block)"** (4687) —
   there is no aggregate proc and no such block. `procStandingLeeches` was deleted by #374; the only
   occurrence of the name in engine.ts was inside the adjacent history comment. A reader following
   this pointer finds nothing.
8. **The taken-leech "⚠️ THAT MIRROR IS NO LONGER EXACT … the non-positional block does NOT [fold
   the incoming-repair channel] … Its own site carries the matching note. If it is ever made
   reachable, add the fold there first."** (5069) — self-contradictory with its own opening
   paragraph, which says #374 DELETED that block. `takenLeechesByOwner` is read at exactly one site
   (5087). The comment instructed a future reader to edit code that does not exist.
9. **Reflect NIT 2: "the reactive-damage executor … is credit-only (creditDamage, never reaching
   this block at all) otherwise"** (6720) — the credit-only arm is gone. `applyReactiveDamage`
   requires a concrete `victimId`, its apply is unconditional (see its own doc at 7236 and the apply
   at 7429), and every triggers.ts arm returns early on an empty living roster. The reflect
   safety argument was resting on a branch that no longer exists — the conclusion still holds, but
   for a different reason, which is now what the comment says.

Plus two prose defects fixed in passing (neither a false claim):

- **engine.ts:6940** — a dangling half-sentence ("…otherwise shieldWasHit detection" followed by a
  restart "The shieldWasHit detection reads…"), almost certainly an earlier sweep's edit.
- **engine.ts:7821** — an opening parenthesis that was never closed.

And two stale hard line pointers deleted (engine.ts:5360/5526, "(~2365)" and "(~2331,") — the code
they point at is now at 5527 and 5366.

## FLAGGED FOR OWNER

**No behaviour contradiction requiring an owner ruling.** Every false claim above was settled by
grep against a named symbol, reader or call site — none required inferring how the game ought to
behave, so each was safe to rewrite in place.

One standing GAME question is preserved in the code and repeated here so it is visible:

- **engine.ts:6602 (was 6657) — Alacrity's not-hit-this-round gate.** "Whether a fully-Barrier-blocked
  direct attack should count as a hit for Alacrity is unconfirmed in-game; current default is
  'not a hit'." Concretely: a ship with Alacrity is attacked once in a round, and that attack is
  fully absorbed by an active Barrier (0 shield drain, 0 HP damage). Does that ship still count as
  "not hit this round" at the round tail? The engine currently says yes (it was not hit). The
  comment is a KEEP, not a defect — it is flagged only because the answer is the owner's.

Two observations offered as notes rather than questions:

- Findings 7, 8 and 9 are one pattern, and it is the pattern worth naming: **a comment that survives
  the deletion of the thing it describes**. #374 deleted `procStandingLeeches` and the
  non-positional taken-leech block; three separate comments elsewhere in this file still described
  them, one of them with an instruction to go edit the deleted code. The tripwire is not another
  sweep — it is that deleting a symbol should include grepping its NAME in comments, which costs one
  command.
- The reader-claim family (1-4 and 6 here, ten in notes-engine-1) is now 15 instances across two thirds of
  one file. Every one was written while a workstream was in flight and never revisited when it
  landed. A review-checklist line ("if you wrote 'nothing reads this yet', re-grep before merge") is
  cheaper than a third sweep.

---

## Verification

- `tokenOracle.mjs --base origin/main src/utils/combat/engine.ts` → **GREEN** (37842 tokens
  identical) on the untouched baseline, after every batch, immediately after the first JSDoc edit
  (the oracle's historical bug class), and in the final state. **Zero code bytes changed.**
- Range: every hunk checked against the pre-edit snapshot rather than `origin/main`, so A1's
  uncommitted work below 4400 cannot be mistaken for mine.
  `diff -U0 scratchpad/engine.pre-A2.ts src/utils/combat/engine.ts` → 174 hunks; **lowest snapshot
  line touched 4415, highest 8985**. Zero hunks below 4400 or above 8999.
- File: 13382 → 13277 lines (105 removed, all comment text).
- `blocks.mjs --from 4400 --to 8999` re-run at the end: **7** blocks (down from 122) — two
  deliberate keeps and five that belong to the 9000+ agent (they entered the window only because the
  file shrank).
- Residual dead-vocabulary grep over current lines 4400-8893
  (`SP-*` incl. the letter-suffixed forms the finder's `SP-\d` regex misses, `Task N`/`task`,
  `PRn`, `D-PRn`, `Wave N`, `Phase N`, `Wn`, `Ship-kit`, `Sub-project`, `epic`, `NIT n`):
  **zero hits.**
- Prose integrity: the full diff read end to end. No dangling clauses, no duplicated words, no
  half-sentences from a removed subject; two PRE-EXISTING prose defects were repaired (see above).
- Line width: every ADDED line ≤ 100 columns (one 102-col line was re-wrapped after the check).
  Note that ~200 pre-existing comment lines in this range already exceed 100 — prettier does not
  reflow comments — so this is a constraint on new text only.
- Not run, per instructions: `npm test`, `tsc`, `lint`. Nothing committed. `triggers.ts`,
  `playerTurn.ts` and `statusEngine.ts` were never opened for writing.
