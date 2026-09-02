# comment-sweep verification notes — `src/utils/combat/triggers.ts`

Line numbers are the ORIGINAL `origin/main` line numbers from
`node docs/kit-audit-tools/comment-sweep/blocks.mjs src/utils/combat/triggers.ts` (181 candidate
blocks). They do not track the edited file.

Gate: `tokenOracle.mjs --base origin/main` **GREEN** after every batch (15121 tokens identical,
zero code bytes changed). `npx prettier --check` clean.

Entries with identical claim + evidence + action are grouped, with every original line range
listed, so no block is silently skipped.

---

## Group A — dead workstream label is the only problem (label stripped, meaning untouched)

### triggers.ts:106, 108, 122, 124  [workstream-label]
CLAIM: `'purge' // C2b-1: …`, `'convert-dot'; // SP-E, Task E4: …` (and the runtime-mirror twins).
EVIDENCE: `C2b-1` / `SP-E, Task E4` are dead workstream labels; the ship names and the mechanic
statement after them are verifiable against `executeIntent`'s `purge` / `convert-dot` branches.
ACTION: rewritten (label removed, sentence kept).

### triggers.ts:143-155, 204-207, 209-213, 257-263  [workstream-label]
CLAIM: `eventCtx` field docs prefixed `Phase 3 PR-F:` / `PR-F:` / `PR-H:`.
EVIDENCE: each sentence is a present-tense routing contract confirmed by the listener that stamps
the field (`on-enemy-repaired`, `on-own-cleanse`) and the executor branch that reads it.
ACTION: rewritten (label removed, contract kept).

### triggers.ts:160-168  [workstream-label]
CLAIM: "The sub-attack that raised the triggering event (multi-hit full-walk epic, PR4)."
EVIDENCE: the rest of the block is verified by the `on-crit` / `on-attacked` listeners (they stamp
`subAttackIndex`) and by `passesProcChanceGate`'s memo key.
ACTION: rewritten (epic/PR label removed).

### triggers.ts:186-188, 190-192, 2007-2012, 2020-2025, 5151  [workstream-label]
CLAIM: `G PR1:` / `G PR2:` prefixes on `isPrimaryTarget`, `shieldWasHit`, `applyCounterAttack`,
`counterFiredThisTurn`, and the `counter` branch header.
EVIDENCE: each body claim is confirmed by the `counter` branch (`cfg.requirePrimaryTarget`,
`cfg.requireShieldHit`, the `counterFiredThisTurn` key) and by `attacked`'s own field docs in
`events.ts`.
ACTION: rewritten (label removed).

### triggers.ts:264-271, 273-277, 758, 838, 1099, 1126, 1479-1480, 1541, 1546, 1649, 1910-1917, 1991-1992, 2151-2154, 2412, 2414, 3364, 3790, 3797, 4212-4213, 4446, 4450, 4661, 4665, 4670, 4672, 5261, 5325, 5331, 5402, 5505, 5513  [workstream-label]
CLAIM: `Ship-kit W3/W5/W7/W8 (Task N)` / `ship-kit W3` / `Wave 5 hardening` / `Ship-kit W8
(CodeRabbit round)` prefixes naming a ship (Pestilence, Hemlock, Warden, Wisteria, Demolisher,
Lingshe, Meiying, Anemone, Sansi, Zeolite, Xcellence, Judge/Incinerator).
EVIDENCE: the ship name plus the mechanic statement is the live half and is verifiable against the
listener / executor branch each comment sits on. The wave/task token carries no information.
ACTION: rewritten (label removed, ship name and mechanic kept).

### triggers.ts:462-466  [workstream-label]
CLAIM: "This per-call approach ensures an enemy owner's opposing/ally reactions route against the
correct side (bySide PR2)."
EVIDENCE: `isOpposing` is a per-call predicate; `isSameSideAlly` derives from it. Contract true.
ACTION: rewritten (`bySide PR2` removed).

### triggers.ts:483-503  [workstream-label, pending-claim]
CLAIM: "#363 Task 9: living same-side ids on `ownerId`'s ACTIVE support-pattern footprint …"; the
two-distinct-answers rule; "cannot be AFFIRMED".
EVIDENCE: `affectedAllyOutsideActivePattern` implements exactly the documented three-way split
(`patternScoped !== true` → false; delegate absent → true; delegate returns `undefined` → false).
The `pending-claim` hit is the words "not yet"/"cannot be", not a pending-work claim.
ACTION: rewritten (`Task 9` dropped, `#363` kept as the rationale pointer; body kept verbatim).

### triggers.ts:1249, 1410  [workstream-label]
CLAIM: `#363 Task 9:` at the two `affectedAllyOutsideActivePattern` call sites.
EVIDENCE: both call sites pass the AFFECTED ally id, as documented.
ACTION: rewritten (`Task 9` dropped, `#363` kept).

### triggers.ts:1739-1763 (head), 1834-1840, 1866-1867, 1890-1895, 1966-1982, 2053-2057, 2059, 2065-2077, 2086-2092, 2133-2138, 2164-2193 (head), 2228-2252, 2266-2272, 2429, 2431-2432, 2454, 2472, 2480, 2533, 2535, 2548, 2552-2553, 2580, 2619, 3063-3071, 3089-3096, 3172, 3245, 3256, 3328-3329, 3349-3355, 3546 (`#399 Task 3`), 3647-3667, 3668-3677, 3820, 3825, 3851, 3871, 4142, 4145, 4155, 4194, 4206, 4224, 4248, 4276-4291, 4434, 4516, 4527, 4576-4577, 4605, 4681, 4801, 4813, 5048, 5106, 5124, 5170-5189, 5218-5237, 5241-5246, 5264, 5294, 5309, 5341, 5352, 5371-5381, 5393-5398, 5427-5429, 5490, 5493, 5503  [workstream-label / history-claim]
CLAIM: dead labels `Task N` · `SP-4b-2a/b` · `SP-4c-2a/2b/2d` · `SP-4d` · `SP-E` · `SP-M M1` ·
`M10` · `PR-B1/PR-E/PR-F/PR-H/PR-I/PR-J` · `D-PR3/D-PR12/D-PR14` · `PR2/PR4/PR5/PR6/PR7/PR8/PR11` ·
`Phase 0/1/4b/4c` · `H2/H3/H3.2/H3.6/H3.7` · `E1/E2` · `Sub-project I, PR I5` · `FIX 3` ·
`Fix wave 1` · `review wave 1` · `C3` · `Task A` · `Task 12/13` — plus the change-history and
"byte-identical to before" tails attached to them.
EVIDENCE: in each case the surviving sentence is a present-tense statement verifiable against the
code it annotates (the gate it describes, the delegate it documents, the branch it precedes). The
history half is `git log` material per `CLAUDE.md` § Code Comments classes 1–2.
ACTION: rewritten (label + history dropped, live rule kept). Bare issue refs (`#342`, `#345`,
`#363`, `#367`, `#383`, `#389`, `#396`, `#399`, `#407`, `#413`, `#415`, `#418`, `#424`, `#434`,
`#435`, `#442`, `#444`, `#446`, `#449`) were left in place as rationale pointers.

---

## Group B — pure change history / counts / measurements (deleted)

### triggers.ts:134-138  [history-claim]
CLAIM: "For an attacker-only run every Intent carries ownerId 'attacker' → identical routing to
pre-Task-6."
EVIDENCE: zero-churn diff justification; nothing in the file reads it.
ACTION: deleted (the owner-routing contract above it kept).

### triggers.ts:346-457  [workstream-label, history-claim] — the registration doc
CLAIMS deleted: "The dot-applied subscription is now LIVE (the team dot-applied seam exists since
Task 4)"; "Unchanged at N=1, which is the whole ship corpus today"; the REGISTRATION ORDER tail
("Attacker-first preserves the exact intent-enqueue order an attacker-only fixture had before
Task 6 … NOTE: the spec prose says 'team order, then attacker' … zero-churn choice …").
EVIDENCE: the dot-applied subscription is visible three lines into the `on-ally-debuff-inflicted`
case, so the "now LIVE" sentence adds nothing; the corpus-N=1 claim is a count (class 2); the
order tail is an argument with a spec (class 1). The live rule kept: "the FOCUS/attacker owner is
registered FIRST, then team owners in input order; within an owner, slot/text order. Fixed
registration order = fixed listener-fire order = fixed intent-enqueue order."
ACTION: deleted (history/counts) + rewritten (labels `Phase 1`, `PR5`, `PR8`, `Phase 4c PR 1`,
`Phase 3 PR-H/PR-I`, `C2b-2`, `ship-kit W3 Task 6` stripped from the bullets).

### triggers.ts:525-549  [workstream-label]
CLAIM: "Across all 149 corpus ships exactly four reactive abilities carry it on an affected-ally
trigger: AEGIS's two … Cultivator's one … Fuying's one"; "it is the one that actually leaked
pre-fix"; "AEGIS/Cultivator … were already correct by construction while Fuying alone needed the
fix".
EVIDENCE: a corpus census (class 2, stale by construction) wrapped around a live FAMILY rule.
ACTION: rewritten — the census deleted; the load-bearing half kept and restated in present tense
("the gate must inspect the AFFECTED ally, NOT the reaction's recipient; where the recipient IS the
affected ally the two coincide; Fuying's Stasis targets the ENEMY, which is never on her own side's
footprint"). Owner ruling date (2026-08-22) retained.

### triggers.ts:573, 576, 580, 609, 626, 636  [workstream-label, history-claim]
CLAIM: "(Before PR5 the non-positional emitter folded the whole cast into one event where
`critHits` counted critting HITS … Two meanings for one field was the epic's sharpest trap — it
already caused one pre-merge defect in PR7 — and PR5 removed it …)"; "THE REASON AS WRITTEN: on a
NON-positional run `e.targetId` was the dummy's own id …".
EVIDENCE: pure archaeology about deleted code paths. The live rules kept: one enqueue per event
implements per-attack-not-per-target; the cast-scoped fallbacks publish a cast total, not a share;
`critVictimIds` is stamped victims-only because a victimless stamp has nothing true to say.
ACTION: deleted (history) + rewritten (`PR5`/`PR7`/`Phase 3 PR-G` labels stripped, "the two
remaining"/"the two CAST-SCOPED" counts dropped).

### triggers.ts:707, 716, 719  [workstream-label, history-claim]
CLAIM: "(When this was written that set included the DPS calculator; since SP-4b-2a a DPS run is
positional …)"; "On a run with no positioned roster `e.targetId` WAS the dummy → byte-identical".
EVIDENCE: history about the deleted DPS dummy actor.
ACTION: deleted; the live statement kept ("a DPS run is positional and takes the `deliveredDamage`
basis"; "a roster-less run is not constructible — the normalization boundary refuses it").

### triggers.ts:798, 828, 849, 1561, 1564, 1567, 1609, 1674, 4518, 4527, 5371-5381, 5493  [history-claim]
CLAIM: repeated "…the DPS dummy `enemy` sink until SP-4c-2d and is a NO-OP since", "it used to fall
back to ctx.enemy.id", "which SP-4c-2d deleted", "That used to fall through to the dummy sink".
EVIDENCE: the deleted-actor archaeology is restated at a dozen sites (classes 1 and 3 — a rule
restated at N call sites is N−1 future contradictions). The live half at each site is "…, a NO-OP".
ACTION: deleted (history) with the NO-OP contract kept. At 5371-5381 the surviving reachability
statement (destroyed-roster case, `MIN_TARGETABLE_MAX_HP` floor, boundary refusal) was kept and
made present-tense, including its honest "No claim is made here about whether a shipped run reaches
it".

### triggers.ts:865  [history-claim]
CLAIM: "The non-self recipient requirement that used to sit here is gone".
EVIDENCE: history; the ruling itself (#446, 2026-08-31 — a critical SELF-repair procs it) is the
live half and matches `e.casterId === ownerId && (e.critHits ?? 0) >= 1`.
ACTION: rewritten (ruling + issue refs kept, "used to sit here" deleted).

### triggers.ts:879  [history-claim]
CLAIM: "The trigger's NAME is a misnomer since #444 — 'to-ally' no longer qualifies anything. It is
deliberately NOT renamed: the string is an `Ability.trigger` value and ability configs can be
persisted, where a renamed key would read back as an unmatched trigger and fail SILENTLY."
EVIDENCE: present-tense contract carrying a keeper issue ref; the persisted-key hazard is real
(`AbilityTrigger` is a persisted union). Not history.
ACTION: kept (keeper issue ref). The sibling "The gate is ADDITIVE throughout: every enqueue that
happened before one of these rulings still happens" WAS deleted (diff justification).

### triggers.ts:1003  [history-claim]
CLAIM: "(before #418 the event was never emitted at all and the kit silently stopped working from
the round the pool capped)".
EVIDENCE: history. Live half kept: the emit gate is the GROSS grant, so a saturated pool still
fires the reaction, and the 0-recipient guard is defensive-only.
ACTION: deleted (history) / rewritten (rest).

### triggers.ts:1035, 1043-1044  [workstream-label, history-claim]
CLAIM: "(Charge was already collapsed this way by an explicit special-case; the per-critHits loop
for every other rider was the over-fire bug — Sentinel healed Ruiner twice for one AoE.)";
"`on-ally-crit` was removed from PER_HIT_REACTIVE_TRIGGERS".
EVIDENCE: history. Verified live: `PER_HIT_REACTIVE_TRIGGERS` contains only `on-attacked` and
`on-ally-attacked`, so "is NOT in" is the true present-tense form.
ACTION: deleted (the bug story) + rewritten ("was removed from" → "is NOT in").

### triggers.ts:1739-1763  [workstream-label]
CLAIM: "17 sites use `as unknown as IntentExecContext` and 11 use a plain `as IntentExecContext`";
"SP-4d … left 14 dead `enemyHp` properties across 10 files behind"; "#342 ITSELF FIRST SWEPT ONLY
THE DOUBLE-CAST FORM … leaving 2 survivors".
EVIDENCE: four counts and two change histories (class 2 + class 1). The live rule — `tsc` is not a
completeness proof because both cast forms suppress excess-property checking, so grep the field
name and enumerate BOTH cast forms — survives without any of them, and the `grep -rl` recipe is
retained verbatim.
ACTION: deleted (counts + history), rule and `#342` ref kept.

### triggers.ts:2038-2051 (procDecisionThisSubAttack), 2349-2393, 3528-3548, 3554-3572, 3597-3610  [history-claim / workstream-label]
CLAIM: "the field this replaced was called `procDecisionThisAttack` … The misnomer is why that read
as correct to every reviewer for months"; "NOT INTRODUCED BY M10 … M10 WIDENED it"; "`on-ally-crit`
USED to be listed here and no longer is (multi-hit full-walk epic, PR2)"; "before PR4 all N
collapsed into one grant"; "a two-armed console probe … logged 626 hits on the `maxHp > 0` arm and
0 on this one".
EVIDENCE: archaeology plus one measurement count. Each block's live half is a rule about the
CURRENT key/gate shape and is verifiable against the adjacent code (`memoKey`, the split chain,
`PER_HIT_REACTIVE_TRIGGERS`'s two members, `oncePerAttackGuardKey`, the `maxHp > 0` ternary).
ACTION: rewritten — the exclusion rationale for `on-ally-crit` restated as "deliberately NOT in
this set" (it is the one a future agent could undo), the OR-run KNOWN LIMITATION mechanism and
REACHABILITY kept in full, the probe count deleted while "the arm is CORPUS-INERT" and the two
ways in were kept.

### triggers.ts:2790-2840, 2893-2935  [history-claim]
CLAIM: "Measured before the fix: a defender-applied `Attack Down` at -90% left a 10,000-attack
enemy throwing a full 40,000 over four rounds"; "9 ships carry one of these across 15 clause
occurrences … Two of the nine …"; "every corpus occurrence of `Attack Down I/II/III` (17 clauses,
12 ships) and `Out. Damage Down I/II/III` (10 clauses, 9 ships)"; "Unchanged by #389".
EVIDENCE: one measurement and four corpus counts (class 2). The conclusion each count supports —
every corpus occurrence is TIMED, so none falls into the approximated aura arm — is the load-bearing
half and was kept, with its `docs/ship-skills.csv` verification dates.
ACTION: deleted (counts/measurement), conclusions + dates + issue refs kept.

### triggers.ts:2691-2696  [history-claim]
CLAIM: "Extracted from {@link countOwnersWithSelfBuff} so the per-recipient reader … cannot drift
from the counting one."
EVIDENCE: "Extracted from (Task 4)" is `CLAUDE.md`'s own verbatim class-1 example. The
anti-drift rule is live: both functions call `ownerHoldsSelfBuff`.
ACTION: rewritten ("Extracted from" → "Shared with").

### triggers.ts:3172-3202  [workstream-label, history-claim]
CLAIM: "In the shipped corpus that is exactly ONE ship — **Cultivator** … (measured SP-4e fix wave
1). Hayyan … fanned out before Task 4 and is unchanged by it"; "where pre-Task-4 there was only
ever one".
EVIDENCE: a corpus count plus before/after history. The rule (a cast `'ally'` cleanse fans out over
the footprint, so `cleansedAllyIds` can carry several ids) is live and pinned by
`plainAllyCleanseFootprintReach.integration.test.ts`, which was kept as the pointer.
ACTION: rewritten (count and before/after dropped; both named ships kept as examples).

### triggers.ts:4338, 4399, 4452, 4462, 4803-4807, 4839-4847, 4941, 5082  [history-claim / workstream-label]
CLAIM: "This used to `return`, dropping the bomb entirely"; "MOVED THE LANDING DRAW INSIDE THE
LOOP. It used to be ONE draw …"; "My first draft of this loop drew first …"; "This used to add
'identical today for single-target healing-mode runs'"; "The old tail of that sentence … names a
guard that NO LONGER EXISTS"; "this branch previously emitted NOTHING, so Heliodor's … was
invisible".
EVIDENCE: all diff justification. Each block's live half is a present-tense statement about the
current draw order / guard / emit and is verifiable in the loop body directly below.
ACTION: rewritten — history deleted, the rules kept: immunity check runs BEFORE the draw and
consumes no gate draw; the draw cardinality for the Pestilence fan-out is N; there is NO downstream
`rid === ctx.healing.targetId` guard, so the dead-recipient `continue` is the only thing protecting
both the gross and the applied figures.

### triggers.ts:4712, 4846, 4949-4955, 5016  [history-claim]
CLAIM: "the old `??` chain reached `preFight` but never the enemy store"; "Before this, the channel
credited NOBODY on the done axis"; the `(~line 926)` / `(~line 1484)` hard line pointers.
EVIDENCE: history + hard line numbers (class 1; line pointers rot on the next edit).
ACTION: deleted (history + line numbers); the live claims kept — the pre-first-turn arm means a
reactive repair firing before its owner's first turn still sees the debuff; the source-axis credit
is needed because `reactive-heal-performed` is absent from the Simulator's allowlist and the
executor emits no `heal-performed`; and 5016's "a zero-gross repair no longer COUNTS AS A REPAIR
for `on-enemy-repaired`'s own riders" was KEPT — it is a present-tense behaviour contract with a
"do not re-derive this as presentational" warning, not history.

### triggers.ts:5427, 5429  [workstream-label, history-claim]
CLAIM: "PR5 SWEEP: 'x' is no longer the single-attack path's key … the positional deferred emit
since PR2, the non-positional inline emit since PR5".
EVIDENCE: `emitAttacked` stamps `subAttackIndex ?? hitIndex` unconditionally, so "every real cast
carries an index" is the true present-tense form.
ACTION: rewritten.

### triggers.ts:5498-5501 (block 5493)  [history-claim]
CLAIM: "This was the ONLY fallback with a SHIPPED consumer … Measured 73 hits suite-wide … now both
halves agree."
EVIDENCE: a suite-wide measurement count (class 2). The reachable case it names (Rhodium's
end-of-round purge in a round where `mostBuffsAmong` returns undefined) is live and useful.
ACTION: rewritten (count deleted, reachable case kept in present tense).

---

## Group C — legitimate comments the finder matched on a trigger word (kept)

### triggers.ts:472-474  [history-claim]
CLAIM: "Used to gate requireDamagedAllyAdjacent reactions."
EVIDENCE: "Used to" here is "is used to", not past tense. The `on-ally-attacked` listener reads
`adjacentAllyIdsFor` for exactly that gate, helper-absent-allows as documented.
ACTION: kept (legitimate contract).

### triggers.ts:2585  [pending-claim]
CLAIM: "a delegate IS wired but this owner has not yet had a turn (focus/team/enemy) recorded this
combat".
EVIDENCE: present-tense description of a live runtime state, not pending work.
ACTION: kept (legitimate contract).

### triggers.ts:2642-2651, 2754-2758  [history-claim]
CLAIM: "Used to populate `enemyBuffNames` …" / "Used to populate `selfDebuffNames` …"
EVIDENCE: same "is used to" reading; `buildDrainContext` calls both functions for exactly those
two fields.
ACTION: kept (legitimate contract).

### triggers.ts:2209, 2211, 2213  [workstream-label] — see FALSE COMMENTS below
Recorded under FALSE COMMENTS FOUND (wiring claims with a live reader).

### triggers.ts:2211-2213 sibling `selfHpPct`/`enemyBuffNames`/`selfDebuffNames` — see FALSE COMMENTS.

### triggers.ts:4605  [pending-claim]
CLAIM: "the entries THIS ally just applied (not yet converted, same sourceId)".
EVIDENCE: the filter three lines below is `e.sourceId === allyId && e.family === undefined` — "not
yet converted" IS that predicate.
ACTION: kept (legitimate contract); only the `E1/E2`/`SP-D` labels in the same block were stripped.

### triggers.ts:964-982 (chain-safety argument inside block 879)
CLAIM: "3. The corpus has exactly one (Chimei's R2 redirect, #435) …"
EVIDENCE: this is a count, but it is step 3 of a four-step TERMINATION PROOF whose step 4
(`MAX_INTENT_GENERATIONS` backstops any future second one) explicitly covers the count going
stale. Mangling a termination proof to remove a self-guarded number is a net loss.
ACTION: kept (legitimate contract) — deliberate exception to the count rule, recorded here.

### triggers.ts:3434-3466 (`#2 log visibility` comments, also at 4994, 5126)
CLAIM: prefix `#2 log visibility:`.
EVIDENCE: `#2` is ambiguous — it may be a bare issue ref (a keeper) or a spec item number (dead).
Delete-first does not apply to something that might be a resolvable pointer, and removing a real
ref is worse than leaving it.
ACTION: kept (keeper issue ref, assumed). Only the hard `(~line NNN)` pointers inside those blocks
were removed.

### triggers.ts:4175 (`#6b`), 5143-5145 (`cfg.scope` note)
EVIDENCE: `#6b` same ambiguity as `#2`. The `cfg.scope` note is a present-tense contract
("presently descriptive metadata only — the engine always removes the named family from ALL self
stores via removeSelfBuffByName") that matches the one-line branch below it.
ACTION: kept.

---

## FALSE COMMENTS FOUND

### 1. triggers.ts:105 — "no parser produces it until Task 5"
CLAIM: `| 'counter' // G PR1: counter-attack reactive (on-attacked) — no parser produces it until
Task 5`
EVIDENCE: `src/utils/abilities/buildShipAbilities.ts:1240-1256` re-types a parsed passive damage
component into `type: 'counter'` when `parseCounterAbilities(text)` matches (Stalwart's
"directly damaged as a primary target" shape, Nyxen's shield-hit shape), and lines 1395-1435 push a
`counterGroupId`-paired self + adjacent-ally counter pair (Centurion). A parser has produced
`counter` abilities for a long time.
ACTION: rewritten as a present-tense contract naming the real producer
(`// counter-attack reactive; parsed by parseCounterAbilities`). **WAS FALSE.**

### 2. triggers.ts:121 — "no fixture carries a counter ability"
CLAIM: `'counter', // G PR1: counter reactive — byte-identical (no fixture carries a counter
ability)`
EVIDENCE: same as above, plus `src/utils/abilities/__tests__/buildShipAbilities.test.ts:1969-2160`
asserts on `type === 'counter'` abilities across six cases, and
`reactiveTriggerPromotionTriage.test.ts:134` looks one up.
ACTION: deleted (delete-first: the whole comment was the false claim). **WAS FALSE.**

### 3–5. triggers.ts:2209, 2211, 2213 — "Populated by live engine in Task 3+" / "Populated in Task 7+"
CLAIM: `selfHpPct` "Populated by live engine in Task 3+"; `enemyBuffNames` "Populated in Task 7+";
`selfDebuffNames` "Populated in Task 7+". All three read as pending work.
EVIDENCE: `buildDrainContext` in this same file populates all three today —
`selfHpPct: ctx.selfHpPctFor?.(ownerId) ?? 100`, `enemyBuffNames: selfBuffNamesForOwners(...)`,
`selfDebuffNames: ownerDebuffNamesFor(ctx.statusEngine, ownerId)`.
ACTION: rewritten as present-tense contracts naming the real populator ("Populated by
buildDrainContext"). **WAS FALSE** (three comments).

### 6. triggers.ts:3353-3355 — "those have no procChance users today, so ordering is moot"
CLAIM: `passesOncePerRoundGate`'s doc: "Call AFTER passesProcChanceGate in the damage/heal/shield
branches (those have no procChance users today, so ordering is moot, but keep the proc gate first
for consistency)."
EVIDENCE: `buildEquipmentAbilities.ts:840-852` builds **Adaptive Plating** as
`type: 'shield'`, `procChance: ADAPTIVE_PLATING_PROC[rarity]` (0.12/0.16/0.19) AND
`oncePerRound: true` — a live user of BOTH gates in the shield branch. `buildEquipmentAbilities.ts
:630-646` builds **Bloodthirst** as `type: 'heal'` with a `procChance`. The ordering the comment
calls "moot" is exactly what stops a failed Adaptive Plating proc from burning its once-per-round
slot.
ACTION: rewritten as a present-tense contract naming both users and stating that the ordering is
load-bearing. **WAS FALSE.**

### 7. triggers.ts:3173 — "for a reactive heal/cleanse/purge intent"
CLAIM: `reactiveRecipients`' header says it resolves recipients "for a reactive
heal/cleanse/purge intent".
EVIDENCE: the only three callers are the heal/shield branch (line ~4829), the cleanse
`reduce-duration` arm (~5044) and the cleanse `remove` arm (~5115). The `purge` branch resolves its
own single `targetId` from `enemyWithMostBuffs` / `counterTargetId` / `victimId` and never calls
`reactiveRecipients` — following the comment's pointer would send an agent looking for a purge
recipient list that does not exist.
ACTION: rewritten ("heal/shield/cleanse … the `purge` branch resolves its own single target and
never calls this"). **WAS FALSE.**

### 8. triggers.ts:3176-3178 — "Anything else (self, enemy, …): the owner only"
CLAIM: the same header's enumeration of `reactiveRecipients`' arms omits `adjacent-allies` and then
asserts everything else resolves to the owner.
EVIDENCE: the function has an explicit
`intent.ability.target === 'adjacent-allies' ? (ctx.adjacentAllyIdsFor?.(intent.ownerId) ??
ctx.playerIds)` arm, so `adjacent-allies` does NOT resolve to the owner only.
ACTION: rewritten (the `adjacent-allies` arm added to the enumeration). **WAS FALSE.**

---

## FLAGGED FOR OWNER

### triggers.ts:172-174  [FLAGGED FOR OWNER (behaviour contradiction)]
CLAIM (left exactly as-is in the file):

> NOTE: attacked.damage is the per-attack aggregate and on-attacked fires once per hit, so a
> non-oncePerRound damage-taken reactive would grant N times for an N-hit attack; Adaptive
> Plating's oncePerRound gate caps it to one grant/round.

CONTRADICTING EVIDENCE:

1. `src/utils/combat/events.ts` — the `attacked` variant's own field doc says the opposite:
   *"`damage?: number` — Direct damage this **SUB-ATTACK** dealt to this victim — **NOT the
   per-TURN aggregate**. … Tenacity's >25%-max-HP filter reads this, and it needs ONE hit's damage
   rather than the cast's."*
2. `src/utils/combat/emitAttacked.ts` — the `damage` parameter doc: *"On the positional path the
   engine groups its signals by SUB-ATTACK and calls this once per sub-attack, so for a `hits: N`
   cast this is that sub-attack's slice, not the victim's cast-wide aggregate … the non-positional
   call sites pass one attack per call."* The body emits one event per entry of `hitOutcomes`, all
   carrying the SAME `damage`.
3. So on the POSITIONAL path (which every real run takes — `engine.ts` calls
   `emitAttackedForSubAttack` per sub-attack with a single hit outcome) there is exactly ONE
   `attacked` event per (sub-attack, victim) and its `damage` is that sub-attack's own slice. The
   "N times for an N-hit attack" over-fire the comment describes can only arise on the
   NON-positional path, where the whole cast's `hitOutcomes` go in one call and N events share one
   cast-wide `damage`.

WHY THIS MATTERS RATHER THAN BEING A WORDING NIT: the same claim is the stated justification for
Adaptive Plating's `oncePerRound: true` in `src/utils/abilities/buildEquipmentAbilities.ts:832-838`
("the `attacked` event's damage is the per-attack aggregate and on-attacked fires once per hit, so
without the gate an N-hit attack would grant N times"). If the premise is false on the path the
engine actually runs, the cap may be suppressing shields the implant text does not cap. And this
file's own heal/shield SCOPE NOTE (originally 4645-4650) says the opposite about the same implant:

> reactive HEALS/SHIELDS are deliberately NOT collapsed to once per attack. … a reactive
> repair/shield scales or crit-filters PER HIT (Isha's non-crit 3% / crit 6% on-attacked heal;
> **Adaptive Plating's shield off each hit's damage taken**), so every hit legitimately contributes
> its own share.

CONCRETE IN-FIGHT EXAMPLE FOR THE OWNER: a player tank wears Adaptive Plating (epic: 16% chance,
shield = 34% of damage taken, "limited to once per round"). An enemy Enforcer casts a 3-hit skill
at the tank in round 2 and all three sub-attacks land. Should the tank get at most ONE shield that
round (today's behaviour, from `oncePerRound`), or one roll per sub-attack — i.e. up to three
shields, each sized off that sub-attack's own damage?

ACTION: **FLAGGED FOR OWNER (behaviour contradiction)** — comment left byte-for-byte as written,
including the `NOTE:` sentence. No rewrite, no deletion.
