# Comment sweep verification notes — `src/utils/combat/playerTurn.ts`

Line numbers are the ORIGINAL `origin/main` line numbers reported by
`blocks.mjs src/utils/combat/playerTurn.ts` (153 candidate blocks). They shift as edits land;
match by text, not by number.

ACTION values: `rewritten`, `deleted`, `kept (legitimate contract)`, `kept (keeper issue ref)`,
`FLAGGED FOR OWNER (behaviour contradiction)`.

---

## Batch 1 — declarations (blocks 140–840)

### playerTurn.ts:140 [history-claim]
CLAIM: final paragraph "#396 also widened WHEN they are published. Pre-#396 they rode a spread
guarded on a non-zero enemy heal term; now they are published … where it previously published
nothing."
EVIDENCE: pure change history (policy class 1). The live half — "published whenever
`enemyAppliedFamilies` is present" — is a present-tense contract worth keeping.
ACTION: rewritten (history stripped, contract kept, `#367`/`#396` keeper refs retained).

### playerTurn.ts:165 [history-claim]
CLAIM: "Sub-project I, PR I4b/I4c —", "I4c's refit-3", "unchanged from I4b", "byte-identical for
every non-Wildfire-shaped ship".
EVIDENCE: dead workstream labels as sentence subjects + a zero-churn claim (policy class 1).
ACTION: rewritten (labels stripped; the per-victim/per-tick re-fold contract kept verbatim).

### playerTurn.ts:253 [history-claim]
CLAIM: "`victim` lost its `= healTarget` default"; "⚠️ AN EARLIER RULING (R7, RETRACTED) … that is
what this paragraph used to cite"; "the shape that produced two silent failures with green tests
in #294/#296".
EVIDENCE: change history + a count. The standing rule (kill credited to `reversal.applierId`,
never the repair source) is stated in the paragraph above it and is kept.
ACTION: rewritten (retraction narrative deleted; the standing rule and R11 log-row rationale kept).

### playerTurn.ts:283 [workstream-label]
CLAIM: "(enemy attacks, Task 8)", "(E2 T1: …)", "(H3.6)".
EVIDENCE: dead vocabulary only; surrounding text is a live contract, `#418` is a keeper.
ACTION: rewritten (labels stripped).

### playerTurn.ts:295 [workstream-label]
CLAIM: "SP-4e retired the sibling `teamBattle` routing flag, which conflated the two."
EVIDENCE: change history about a flag that no longer exists — `grep -rn teamBattle src/` finds it
only inside other comments and one test comment, never as a declared symbol.
ACTION: deleted (last sentence only; the application-axis contract kept).

### playerTurn.ts:302 [workstream-label, pending-claim]
CLAIM: "(multi-hit full-walk epic, PR8)"; "`flushDeferredEnemyApplications` runs them back-to-back,
which is what keeps a single-sub-attack cast byte-identical to the pre-PR8 single thunk."
EVIDENCE: `engine.ts:9367-9375` — `flushDeferredEnemyApplications` does exactly
`pending.applyState(); pending.emitEvents();` in sequence. The back-to-back claim is TRUE; the
"byte-identical to the pre-PR8 thunk" half is zero-churn history. The "has not yet written" phrasing
is a live deferred-write contract, not a wiring claim — kept.
ACTION: rewritten (label + zero-churn clause stripped; contract kept, reader named).

### playerTurn.ts:393 [workstream-label]
CLAIM: "PR8 split the element from a bare `() => void` thunk into `{applyState, emitEvents}` …";
"for almost the whole corpus, which keeps those byte-identical."
EVIDENCE: change history, and the split is already documented once at
`DeferredEnemyApplication`'s own doc (policy class 3: rule restated at N sites).
ACTION: deleted (both; the flush obligation contract kept).

### playerTurn.ts:409 [workstream-label]
CLAIM: "(multi-hit full-walk epic, PR8)"; "three consumers read that outcome"; "the single-flush
behaviour they have today".
EVIDENCE: dead label + a site count (policy class 2). The three consumers are enumerated inline
right after, so the number adds nothing and goes stale on the fourth.
ACTION: rewritten.

### playerTurn.ts:458 [workstream-label, history-claim]
CLAIM: "(Task-4 parity)"; "→ goldens byte-identical"; "(SP-4b-2 D6 — the gap this doc used to paper
over)"; "which is exactly what happened until `passiveSlotHit` below started carrying it".
EVIDENCE: labels + change history. The FIRING HIT ≠ `directDamage` contract is live and kept.
ACTION: rewritten.

### playerTurn.ts:472 [workstream-label]
CLAIM: "SP-4b-2 D6 — the PASSIVE-SLOT damage instance"; "(measured: Judge's round-4 `directDamage`
stuck at 23000 instead of 29000)".
EVIDENCE: dead label + a description of a fixed bug (change history). Restated as the
counterfactual it actually argues.
ACTION: rewritten.

### playerTurn.ts:498 [workstream-label]
CLAIM: "SP-4b-2 D4 — this turn's SCHEDULED enemy-debuff effects …"
EVIDENCE: dead label as sentence subject; the rest is a live memoization contract.
ACTION: rewritten (label stripped).

### playerTurn.ts:563 [workstream-label] — `liveDebuffLandingChance`
CLAIM: "(A2 Task 4)"; "⚠️ SP-4c-2b:"; "measured over the whole suite rather than assumed — an
earlier draft of this doc guessed wrong in both directions"; "NONE of the three cast-path
closures"; "Until SP-4c-2d there was a SECOND such case … Measured before that deletion: 3 such
rows in the suite, 0 on shipped kits."
EVIDENCE: `grep -rn 'liveDebuffLandingChance\b' src/` — the field is read at `engine.ts:965`,
`engine.ts:2509`, `engine.ts:2700`, all as `targetLandingChance ?? runtime.liveDebuffLandingChance
?? 1`, i.e. exactly the reactive fallbacks the comment names. The reader claim is TRUE. The
dummy-sentinel paragraph describes an actor that no longer exists and the counts are stale by
construction.
ACTION: rewritten (labels, counts and the deleted-sentinel archaeology removed; the CAST-path /
REACTIVE-path rule and the reader contract kept, now naming engine.ts).

### playerTurn.ts:640 [workstream-label]
CLAIM: "SP-4c-2b: absent on a no-victim turn"
EVIDENCE: dead label prefix only.
ACTION: rewritten.

### playerTurn.ts:650 [workstream-label]
CLAIM: "SP-4d: the `enemyHpPct` derivation below now answers `undefined` rather than 100 …"
EVIDENCE: dead label + before/after framing. The `undefined`-not-100 rule is live.
ACTION: rewritten to present tense.

### playerTurn.ts:660 / :672 [workstream-label]
CLAIM: "(Task 5 ally-charge routing)" / "(Task 7 enemy-target charge removal)".
EVIDENCE: dead vocabulary; both docs are otherwise live contracts.
ACTION: rewritten (labels stripped).

### playerTurn.ts:686 [history-claim] — `healing`
CLAIM: "#415: this used to say \"present ONLY when the engine runs in healing mode / absent for
DPS-mode turns\"."
EVIDENCE: quoting a superseded comment is archaeology. The live contract (anchored in EVERY mode;
what a DPS run omits is `healReportActive`) is kept, with `#415` retained as the rationale pointer.
ACTION: rewritten.

### playerTurn.ts:692 [workstream-label]
CLAIM: "(Phase 4c PR 4 Task 5; HP-restore lifted in E5 §4.1)", "(E5) restores", "credit + mutate as
before".
EVIDENCE: dead vocabulary + zero-churn framing.
ACTION: rewritten.

### playerTurn.ts:705 [history-claim] — `targetHpPct`
CLAIM: "#415: this used to add \"so DPS-mode … callers … → grant inert in DPS (correct)\""; "The
engine now threads …".
EVIDENCE: archaeology quoting a superseded comment. The threading contract is live.
ACTION: rewritten to present tense; `#415` kept and the `types/abilities.ts` pointer preserved.

### playerTurn.ts:718 [history-claim] — `targetId`
CLAIM: "the three enemy-side statusEngine calls"; "(pre-Task-6 path, byte-identical)".
EVIDENCE: a site count (policy class 2) plus dead vocabulary. The three calls are named inline.
ACTION: rewritten.

### playerTurn.ts:730 [workstream-label, history-claim] — `stealthedEnemyCount`
CLAIM: "Sub-project I, PR I5 —"; "The old rationale (\"no enemy attackers to count\" in DPS mode)
is stale: … since SP-4b-2a … since SP-4b-2b".
EVIDENCE: a comment whose subject is a previous version of itself. The surviving rule (the DPS
stand-in carries no Stealth) is live and kept.
ACTION: rewritten.

### playerTurn.ts:786 [workstream-label, history-claim] — `deferAbilityPerformedToEngine`
CLAIM: "NOT \"as before\": since PR5 of the multi-hit full-walk epic …"; "the SAME cardinality the
engine's deferred path has emitted since PR2"; "(every corpus ship but Enforcer)".
EVIDENCE: change history plus a corpus enumeration that goes stale the moment a second
multi-hit ship ships.
ACTION: rewritten to the present-tense cardinality contract.

### playerTurn.ts:840 [workstream-label] — `adjacentAllyIds`
CLAIM: "PR10 (buff steal):"
EVIDENCE: dead label prefix.
ACTION: rewritten.

Also stripped in this region (same dead-vocabulary class, unflagged by the finder but identical in
kind and inside blocks already being edited): `Sub-project I, PR I1 —`, `E3 (AoE purge):`, `SP2b:`,
`(sub-project F, PR F3)`, `I6:`, `(C2b-3)`, `§4.5`, `pre-I6 behavior`.

---

## Batch 2 — helpers + turn preamble (blocks 975–2034)

### playerTurn.ts:975 [workstream-label, history-claim]
CLAIM: "since SP-4b-2 D4 the POSITIONAL DAMAGE read"
EVIDENCE: dead label; the memoization contract it introduces is live.
ACTION: rewritten.

### playerTurn.ts:978 / :980 / :1021 [workstream-label]
CLAIM: "(Phase 3 retiming: … unchanged from Phase 1)"; "(Phase 3 retiming: discrete-infliction-only;
the emission moved to the …)"
EVIDENCE: dead vocabulary plus before/after framing. The rule — recurring/aura re-applications are
not discrete inflictions, so only `debuff-resisted` fires — is live and kept.
ACTION: rewritten.

### playerTurn.ts:1146 [workstream-label, history-claim]
CLAIM: "(Task 5 ally routing; Task 7 enemy routing)"; "identical net charge to the pre-Task-5
single 'own' sum".
EVIDENCE: dead labels + zero-churn framing.
ACTION: rewritten.

### playerTurn.ts:1168 [workstream-label]
CLAIM: "an OPEN RESIDUAL belonging to no scheduled task — SP-4e Task 6 is the epic's last rung, so
do not read the earlier \"not this rung's scope\" wording as a pending fix"; "(all five of them —
Pallas/active, Volk/passive1+2, Valkyrie/passive1+2 …)"
EVIDENCE: the sentence's subject is a previous version of itself, plus a corpus count (policy class
2). The tripwire pointer (`lowestHpAllySelector.test.ts`) is exactly what policy class 4 asks for
and is kept; the count is not.
ACTION: rewritten.

### playerTurn.ts:1194 [history-claim]
CLAIM: "There IS a fourth producer"; "its target dropdown used to offer …"; "#399 Change 1a
restricts …".
EVIDENCE: a producer count + before/after history. The live restriction (a `charge`-typed
ability's dropdown is limited to `CHARGE_TARGET_OPTIONS`) is kept with `#399` as the pointer.
ACTION: rewritten.

### playerTurn.ts:1225 / :1238 / :1280 [workstream-label]
CLAIM: "SP-4d:", "Phase 3 reactive triggers", "(Task 4);"
EVIDENCE: dead label prefixes only.
ACTION: rewritten.

### playerTurn.ts:1357 [workstream-label] — `stripShieldPct`
CLAIM: "the same numeric result as the pre-PR9 `victim.shieldPool = 0` it replaces at the I6
(Lodolite) purge-coupled call site"; "Ship-kit Wave 3 (Task 7, Laika):"; "not two"; "no risk of a
double-emit if a future third caller appears".
EVIDENCE: change history, dead labels, and a caller count. The locked H shield rule (percentage of
CURRENT pool, not of max) and the one-emit-site contract are live and kept.
ACTION: rewritten.

### playerTurn.ts:1462 [workstream-label] — `runPlayerTurn` doc — **FALSE**
CLAIM: "only the attacker uses this today; Task 4 builds walked team runtimes." Also "Math is
byte-identical to the old inline attacker block".
EVIDENCE: `runPlayerTurn` is called from THREE sites in engine.ts today — `engine.ts:11259`
(focus), `engine.ts:11644` (`teamTurn`, the walked team ally) and `engine.ts:12098` (`enemyTurn`).
The walked team runtimes the comment says a future task will build already exist:
`teamRuntimeById` is declared at `engine.ts:2645` and populated at `engine.ts:2747`.
ACTION: rewritten as a present-tense contract naming all three sites. **WAS FALSE.**

### playerTurn.ts:1552 [workstream-label] — `hasVictim`
CLAIM: "the latter was exactly the dummy ghost, which SP-4c-2b stopped handing out and SP-4c-2d
deleted (see plan §A.4-A.5 — the ghost's `shieldPool` was arming `enemyShielded` gates in 22
support-ship fingerprints)"; "keeps the with-victim path byte-identical".
EVIDENCE: history about a deleted actor plus a fingerprint count. The rule (answer "there is no
enemy", never "an enemy with neutral stats") is live.
ACTION: rewritten.

### playerTurn.ts:1601 [workstream-label] — `victimStatGateCtx`
CLAIM: "DISCHARGED (was a NAMED RESIDUAL through SP-4d task 2)"; "Exactly three corpus ships carry
`stat-vs-target` … • Bayah • Cobalt • Chakara"; "None of the three is an ally-target ship (§A.2) …
(SP-4d task 3)".
EVIDENCE: a corpus census (policy class 2), which a single new ship invalidates — and
`project_widening_invalidates_reachability_census` says the census expires the moment the shape
widens. The `noVictimAbsentSubject.integration.test.ts` pointer survives and is kept.
ACTION: rewritten.

### playerTurn.ts:1700 / :1711 [workstream-label]
CLAIM: "(SP-4e, user-confirmed 2026-08-20)"; "including plain `'ally'` since SP-4e Task 4".
EVIDENCE: dead labels. The user-confirmation DATE is legitimate provenance for a game rule and is
kept; the workstream id is not.
ACTION: rewritten.

### playerTurn.ts:1722 [history-claim]
CLAIM: "because by application time the ability itself is no longer in scope there. When both are
supplied the explicit one wins; in practice exactly one is ever present."
EVIDENCE: reads as history because of "no longer", but it is a present-tense statement of why the
per-slot timed-status loop carries the filter on the STATUS rather than the ability — verifiable
against `resolveSupportRecipients`' call right below. `#363` is a keeper ref.
ACTION: kept (legitimate contract).

### playerTurn.ts:1748 / :1749 / :1752 / :1755 / :1758 [workstream-label, history-claim] — `enemyHpPct`
CLAIM: "(PR6b: the engine no longer passes a precomputed scalar …)"; "For the DPS dummy sink it
equalled the old cumulativeDamage+cumulativeTeamDamage"; "LOAD-BEARING TIMING: on a roster-less run
the dummy's currentHp updated POST-round (the round-tail HP block, deleted in SP-4c-2d) …"; "The
4c-2b-era residual note that stood here is discharged"; "Measured by instrumenting this branch over
the combat suite: 4 hits, every one with victim id `'attacker'`."
EVIDENCE: the dummy sink no longer exists, so three of these paragraphs describe a code path that
is gone. `enemyHpPct` is computed once at the top of `runPlayerTurn`, so the surviving timing claim
("as it stood when THIS actor's turn began") is verifiable right here and is kept. The "4 hits"
measurement is stale by construction; the reachability ARGUMENT it supports (reached on an enemy's
turn against a player-side actor with `stats.hp` omitted or 0, since only enemies get the
1,000,000 floor) is kept.
ACTION: rewritten.

### playerTurn.ts:1788 [history-claim]
CLAIM: "`victimId` is REQUIRED (it used to default to the turn victim's id)"; "every caller now
names its victim".
EVIDENCE: change history. Required-ness plus the `hasVictim` fencing is the live contract.
ACTION: rewritten.

### playerTurn.ts:1813 / :1820 [workstream-label]
CLAIM: "(Phase 3 retiming)"; "(A2 Task 4 / A-closeout)".
EVIDENCE: dead labels only.
ACTION: rewritten.

### playerTurn.ts:1847 / :1903 [workstream-label]
CLAIM: "before SP-4c-2d, the dummy enemy"; "SP-4c-2b: … Byte-identical to the ghost's (plan §A.4:
its `affinity` was always undefined …)".
EVIDENCE: the dummy/ghost actor is deleted; both parentheticals compare against a code path that
does not exist.
ACTION: rewritten (the no-victim ⇒ neutral-answer rule kept).

### playerTurn.ts:1921 [workstream-label]
CLAIM: "the immune short-circuit below is only reached when this is true, which no existing fixture
triggers, so the non-immune path stays byte-identical. Task 6 reuses this for the DoT path."
EVIDENCE: a suite measurement ("no existing fixture triggers") that goes stale the moment a
Block-Debuff fixture lands, plus a dead label. The once-per-turn computation and the DoT-path reuse
are live.
ACTION: rewritten.

### playerTurn.ts:1994 / :1998 / :2004 / :2008 / :2012 / :2017 / :2018 / :2031 / :2034 [history-claim, workstream-label]
CLAIM: the whole `liveDebuffLandingChance` publish block, headed "⚠️ WHAT THIS COMMENT USED TO SAY,
and why both halves are now false", then "ATTRIBUTION, so nobody reads this block as the rung that
added the conjunct: … SP-4c-2b (`f1bce838`), whose own review wave 1 labelled it \"FIX 2\"";
"measured on Flamel at the time: 138 landings → 0"; "CURRENT STATUS (SP-4c-2d review wave 2)"; "all
7 pre-existing test files … stay green (96 tests)"; "24 of 148 shipped ships carry the arming
shape"; "⚠️ THIS GUARD SURVIVED THE EPIC — do NOT sweep it alongside its (now removed) sibling."
EVIDENCE: ~45 lines whose SUBJECT is previous versions of itself, review waves, and counts. The
sibling guard the last paragraph warns about is already removed, so that warning cannot be acted
on. Four things in it are live and were kept verbatim in substance: (a) the reactive path resolves
its own per-victim chance and only falls back here; (b) publishing a no-victim 0 poisons later
readers, so a no-victim turn publishes NOTHING; (c) the guard is corpus-inert but NOT structurally
unreachable; (d) the tripwire `dynamicLanding.test.ts`'s 'a no-victim turn does not publish a
landing chance' — verified to exist at `src/utils/combat/__tests__/dynamicLanding.test.ts:371`.
ACTION: rewritten (45 lines → 22, all four live claims kept, every count and review-wave label
removed).

### playerTurn.ts (unflagged, same class) — `sourceFired` team-id note — **FALSE**
CLAIM: "NOTE: sourceFired(runtime.actor.id, …) is already correct for future team ids".
EVIDENCE: walked team ids are not future — `teamRuntimeById` (`engine.ts:2645`/`2747`) exists and
`engine.ts:11644` runs a full team turn through this function.
ACTION: rewritten to present tense. **WAS FALSE.**

Also stripped in this region (dead vocabulary, unflagged): `SP2a:`, `SP-F F4:`, `(byte-identical to
pre-SP1)`, `(Voron/Orel, E3)`.

---

## Batch 3 — cast resolution (blocks 2062–3441)

### playerTurn.ts:2062 / :2139 [workstream-label, history-claim]
CLAIM: "(Task 7)"; "since SP-4b-2 D4, through `scheduledEnemyEffects`".
EVIDENCE: dead labels; the once-and-memoized landing-draw contract is live.
ACTION: rewritten.

### playerTurn.ts:2102 [history-claim]
CLAIM: "the per-layer `+=` staging that used to live here is gone".
EVIDENCE: change history. Restated as the present fact ("no per-layer `+=` staging is needed
here — only critBuffForGates is staged").
ACTION: rewritten.

### playerTurn.ts:2121 [history-claim]
CLAIM: "#367's enemy-APPLIED heal fold USED to sit here … #396 moved it to the late shadowing
block (~700 lines down, …) … which is what makes the move safe."
EVIDENCE: change history plus a hard line-distance pointer (the class PR #457 removed). The
live content — WHY it cannot sit here (`abilitySelfEffects` does not exist yet) and the
search-term pointer — is kept, with `#367`/`#396` retained.
ACTION: rewritten to present tense.

### playerTurn.ts:2204 / :2212 [workstream-label]
CLAIM: "(SP-4c-2b, ruled by the owner at review)"; "MEASURED, and the answer is ZERO. \"Belongs to
Task 5's measurement scope\" is now discharged: … (531 files / 5,882 tests)".
EVIDENCE: the owner-at-review provenance is worth keeping and was kept; the workstream id and the
suite-size numbers are stale by construction. The probe RESULT (zero) is the load-bearing part and
is kept — see `feedback_measurement_instrument_validity`: what matters is that the instrument
could have reported the opposite, not the file count.
ACTION: rewritten.

### playerTurn.ts:2248 [pending-claim]
CLAIM: "the scheduled crit buff only (modifiers/ability buffs not yet folded), and NO roundCrit".
EVIDENCE: false positive — a present-tense statement of what HAS been folded at this point in the
function, verifiable against the `critBuffForGates` staging directly above.
ACTION: kept (legitimate contract).

### playerTurn.ts:2332 / :2335 / :2337 / :2347 / :2370 [workstream-label]
CLAIM: "(Task 7)"; "(Phase 3 retiming)"; "CARDINALITY (multi-hit full-walk epic, PR8)";
"— Task 10a)"; "PR8: the engine drains this …"; "the historical post-walk …".
EVIDENCE: dead labels only. Every surrounding contract (sub-attack 0's draw, the two drain points,
the Post-Turn ordering) is live and kept.
ACTION: rewritten.

### playerTurn.ts:2376 [workstream-label, history-claim]
CLAIM: "Extracted from the cast-time loop (multi-hit full-walk epic, PR8)"; "behaviour is exactly
pre-PR8".
EVIDENCE: policy class 1 names this exact shape ("Extracted from the inline loop (Task 4)").
ACTION: rewritten as "Shared by the cast-time loop and by sub-attacks ≥ 1".

### playerTurn.ts:2433 / :2491 [workstream-label, history-claim]
CLAIM: "Since PR8 the unit of \"that damage\" is the SUB-ATTACK"; "Cast-time inline apply: EXACTLY
pre-PR8".
EVIDENCE: dead labels. The intra-cast clause-order rule and the TDZ note are live and kept
verbatim.
ACTION: rewritten.

### playerTurn.ts:2553 [workstream-label]
CLAIM: "≥ 1 (multi-hit full-walk epic, PR8)"; "(~30 live-sourced fields …); that is a separate
change".
EVIDENCE: dead label + a field count. The DELIBERATE SCOPE LINE consequence (a clause gated on
state the cast changes is judged once) is live and kept.
ACTION: rewritten.

### playerTurn.ts:2596 / :2598 [workstream-label, history-claim]
CLAIM: "Ship-kit W5 Task A3 introduced …"; "That mapping is no longer written here: PR8 Task 1
moved the whole nine-branch ternary into ./debuffRecipients"; "The nine-branch mapping now lives
in …".
EVIDENCE: change history + a branch count. The pointer (`./debuffRecipients`' JSDoc is the one
place the rules live) and the do-not-restate warning are exactly what policy class 3 asks for and
are kept.
ACTION: rewritten to present tense.

### playerTurn.ts:2659 / :2660 [history-claim]
CLAIM: "byte-identical to the pre-Task-5 single-ctx call, so the attacker-only path … is
zero-churn".
EVIDENCE: policy class 1 names "Zero-churn" explicitly.
ACTION: rewritten.

### playerTurn.ts:2719 / :2720 / :2732 [workstream-label]
CLAIM: "(Phase 3 retiming …)" ×2; "(SP-4c-2b, ruled by the owner at review)"; "the fold is inert
today".
EVIDENCE: dead labels. The owner-ruling provenance kept, workstream id dropped.
ACTION: rewritten.

### playerTurn.ts:2927 [pending-claim]
CLAIM: "here it is a hard dependency ordering, not just \"not yet computed\"".
EVIDENCE: false positive — a present-tense explanation of a real circular-dependency constraint
(`modifierCtx` → `mod.hp` → `dmgStats.hp` → `effectiveHp`), verifiable from the lines below.
ACTION: kept (legitimate contract).

### playerTurn.ts:2983 [history-claim]
CLAIM: "I4c: the CONDITIONAL half is no longer taken from the flat list"; "(unchanged from I4b —
ctx = modifierCtx)"; "the fold below is byte-identical to before".
EVIDENCE: dead labels + zero-churn. The provenance rule (the bonus scales by the aura SOURCE's
crit power) is live and kept.
ACTION: rewritten.

### playerTurn.ts:3205 / :3213 [workstream-label, history-claim]
CLAIM: "(multi-hit full-walk epic, PR4 — spec §4.6)"; "Drawing here anyway advanced the SAME
`procChanceGates` key … measured `hits × (1 + victims)` draws for one cast"; "RESOLVED that cost
for effect purposes: … reactives now read …"; "stay byte-identical".
EVIDENCE: change history describing a fixed defect, plus a measured draw count. The rule it
argues for (one verdict per sub-attack, drawn where eligibility is known; the pre-funnel `damage`
basis carries no amplification) is live and was restated in the counterfactual.
ACTION: rewritten.

### playerTurn.ts:3252 / :3288 / :3308 [workstream-label]
CLAIM: "the Phase 1 condition engine"; "matching the prior inline behaviour"; "SP-4c-2b: … now
omitted outright"; "for the AoE-purge fan-out, E3"; "SP-4d Task 8:"; "A prior rung dropped that
`?? 1` default outright, which made the single-target case read absent instead of 1 …; this
restores …".
EVIDENCE: dead labels + change history. The measurement distinction (single-target cast hit 1, a
no-victim cast hit 0, so the fallback is keyed on `hasVictim`) is live and kept, along with the
Tygr consequence restated as a present-tense reason.
ACTION: rewritten.

### playerTurn.ts:3375 [workstream-label]
CLAIM: "SP-4c-2b (final review, IMPORTANT 2): … This site was a MISSED SITE, not a ruled residual
— contract §B class 2 says … and this loop is simply absent from that table."; "The ghost path at
least suppressed the event … the rung would have moved this from a PROBABILISTIC phantom to an
ALWAYS-ON one".
EVIDENCE: review-round attribution plus a comparison against the deleted dummy-ghost path. The
live half (why the emit cannot be left unfenced; the `on-stasis-applied` consequence; the
`ctrl.target === 'enemy'` scoping) is kept.
ACTION: rewritten.

### playerTurn.ts:3441 [pending-claim]
CLAIM: "pre-Step-3 DoT arrays, so this round's freshly-applied DoTs are not yet counted".
EVIDENCE: false positive — a present-tense sequence-point contract, verifiable against
`applyNewDoTs` running later in the function.
ACTION: kept (legitimate contract).

### playerTurn.ts:3576 / :3604 [workstream-label]
CLAIM: "D-PR3 victim-side incoming %-reduction"; "byte-identical to the prior fold"; "R=0 → ratio
1 → byte-identical to the prior expression"; "carries D-PR3's crit-family incoming reduction".
EVIDENCE: dead labels + zero-churn framing.
ACTION: rewritten.

---

## Batch 4 — ability-performed, unreachability derivation, heal block (blocks 3661–5455)

### playerTurn.ts:3661 / :3667 / :3673 [workstream-label, history-claim]
CLAIM: "Task 5 (per-victim crit signal)"; "Since PR2 of the multi-hit full-walk epic the engine
emits …"; "exactly as before"; "since PR5"; "the hits===1 byte-identical guarantee".
EVIDENCE: dead labels + zero-churn. The cardinality contract (one event per sub-attack; the
ability-performed → per-victim `attacked` bus order) is live and kept.
ACTION: rewritten.

### playerTurn.ts:3679 / :3688 [workstream-label, history-claim]
CLAIM: "RULED CORRECT (owner, SP-4c-2b review)"; "after this rung its ally-targeted repair still
fires …".
EVIDENCE: the owner ruling is a keeper and was kept; the workstream id and the "after this rung"
framing are not.
ACTION: rewritten to present tense.

### playerTurn.ts:3693 / :3695 / :3713 / :3725 [workstream-label, history-claim]
CLAIM: "PR5 (multi-hit full-walk epic)"; "Folding the cast into one event fired them ONCE — which
is why the DPS calculator reported one Inferno stack for Enforcer + Burner while the simulator
reported three"; "the ONE zero-damage event pre-PR5 code unconditionally emitted"; "the old single
event's `damage`"; "(epic spec PR5 section 5.4)".
EVIDENCE: change history. The IN-GAME VERIFICATION (Enforcer + Burner applies three Inferno
stacks, verified 2026-08-08) is game-behaviour provenance and was kept — per
`feedback_ask_game_examples_dont_guess` those are the observations you never re-derive. Locked rule
R1 kept. The KNOWN ASYMMETRY open question and its "untestable in-game today" note kept intact.
ACTION: rewritten.

### playerTurn.ts:3744 — the unreachability derivation [workstream-label, history-claim]
Covers, as one contiguous block, every candidate line the finder reported inside it:
playerTurn.ts:3744 / :3745 / :3751 / :3759 / :3763 / :3773 / :3776 / :3782 / :3798 / :3800 /
:3802 / :3829 / :3835 / :3837 / :3840 / :3844 / :3847 / :3848 / :3862 / :3870.
CLAIM: ~130 lines. "PR5 derived the branch to be structurally UNREACHABLE … PR6 builds it
anyway"; "WHICH SIGNAL … (PR6, after a review caught the first cut)"; "which is the class that
failed 346 tests during SP-4c-1"; "THE READING ERROR WORTH NOT REPEATING"; "⚠️ TWO BULLETS HERE
DESCRIBED THE DUMMY SINK AND WENT WITH IT"; "An earlier draft of this comment claimed they were
all \"gated on `victim.position !== undefined`\" … that is WRONG for two of them"; the
POSITION-gated / VICTIM'S-OWN-KIT-gated / NEITHER enumeration with hard line pointers
(`engine.ts ~6286`, `engine.ts ~4181`, `triggers.ts ~2514`, `this file, ~2556 → ~941`);
"WAS-COUPLED-TO (PR5's WARNING, NARROWED — not discharged — by PR6 …)"; "WHAT THE OBLIGATION NOW
COVERS".
EVIDENCE: the comment itself declares the whole corroboration section redundant — "this
corroboration reduces to the PRIMARY argument above" and "the DERIVATION still rests on the
PRIMARY argument, not on any of this". Everything it corroborates against (the dummy sink, the
roster-less run, the `skipDeadTargetTurn` guard, the `buildTurnArgs` dummy-sink conjunct) is
deleted code, so the enumeration describes a codebase that no longer exists — and it carries the
hard line-number pointers PR #457 removed as a class. Four things ARE live and were kept:
(a) the PRIMARY argument (this loop only emits; listeners are enqueue-only; the HP decrement
happens once after `runPlayerTurn` returns);
(b) the LOCKED lesson that `currentHp <= 0` is an HP FLOOR, not a death — a never-alive actor
reads the same way (`project_roster_wipe_termination`);
(c) `destroyedRound` is the canonical aliveness signal, stamped once by `recordDestroyed`;
(d) the two tripwire pointers, both VERIFIED to exist:
`src/utils/combat/__tests__/multiHitInlineEmitGuards.test.ts` and
`src/utils/combat/__tests__/dummyReachability.test.ts:414` ('A RESOLVED VICTIM IS ALIVE').
ACTION: rewritten — 130 lines to 44, with the derivation and both tripwires intact.

### playerTurn.ts:3852 / :3868 / :3981 [workstream-label]
CLAIM: "SP-F F3 (Lingshe)"; "Ship-kit W7:"; "(until SP-4c-2d they could be the dummy sink's)".
EVIDENCE: dead labels + deleted-actor history.
ACTION: rewritten.

### playerTurn.ts:4161 / :4239 / :4241 / :4266 / :4267 [workstream-label, history-claim]
CLAIM: "which, until SP-4c-2d, meant the DPS dummy sink … so DPS was byte-identical"; "A run whose
target was the dummy sink … had statusEngine.steal find nothing → [] → no-op → byte-identical.
That stopped being the DPS calculator at SP-4b-2a …"; "A dummy-sink target (no buffs) was a no-op
→ byte-identical; since SP-4b-2a …".
EVIDENCE: all three describe the deleted dummy sink. The live half (a DPS cast anchors on a real
positioned enemy and CAN steal/purge, inert only because the stand-in grants itself no buffs) is
kept.
ACTION: rewritten.

### playerTurn.ts:4302 [history-claim]
CLAIM: "#403 review Finding 7, CLOSED by #407: this file has FIVE on-cast loops … Three of them …
used to resolve recipients with a bare … All three now route through …"; "Four sites share one
resolver".
EVIDENCE: three separate site counts (FIVE / Three / Four) — policy class 2, stale the moment a
sixth loop lands. The DELIBERATE DIVERGENCE ruling (#403 R4) and the "if you are aligning them,
say so in the commit" instruction are kept; `#403`/`#407` kept as pointers.
ACTION: rewritten.

### playerTurn.ts:4402 / :4416 [workstream-label]
CLAIM: "Wave 4: on-cast extend-status"; "and before SP-4c-2d the DPS dummy sink, both of which
leave targetId unset".
EVIDENCE: dead label + deleted-actor history.
ACTION: rewritten.

### playerTurn.ts:4474 [pending-claim]
CLAIM: "growing a status the cast had not yet applied would be a different mechanic".
EVIDENCE: false positive — a present-tense design rule bounding the inflicted-scope extension,
verifiable against the `inflictedScope` branch below it. The KNOWN BOUNDARY note beside it (a
per-sub-attack after-damage landing goes to `applyDebuffsForSubAttack`'s own `collect` array and
this block never sees it) is a live, deliberately-undecided limitation and was kept intact.
ACTION: kept (legitimate contract).

### playerTurn.ts:4530 / :4534 / :4546 / :4552 [history-claim, workstream-label] — the heal banner
CLAIM: "(every mode since #415; formerly labelled \"HEALING MODE\") … The old banner outlived its
accuracy"; "#371 asked whether … It was ANSWERED \"no\" on the premise that …"; "still produces
byte-identical goldens"; **and "HoT (hotHeal) ticking is Task 7 — not produced here."**
EVIDENCE: the HoT claim is FALSE — `tickHot` is declared at `playerTurn.ts:4582` and called twice
at `playerTurn.ts:4700` and `playerTurn.ts:4709`, both INSIDE this `if (args.healing)` block.
`engine.ts:1859` independently names it ("playerTurn.ts `tickHot` — raw into the HOLDER's
`hotHeal`"). HoT ticking is produced here, further down the same block. The #371 expiry warning is
worth keeping (a later agent must not re-derive the retired answer) and was condensed rather than
deleted.
ACTION: rewritten; the HoT sentence now names `tickHot` and its location. **WAS FALSE.**

### playerTurn.ts:4572 [history-claim]
CLAIM: "`incomingHealFactor` … used to be a closure here. It moved to the `buffTotals` leaf module
… its doc scoped itself to \"this file's three sites\", and that omission left the fourth
consumption site unclamped. #367 task 7 added a fifth and sixth in `engine.ts` … Read that doc
before touching any of the six."
EVIDENCE: change history plus a running site count (three/fourth/fifth/sixth/six) — policy class
2 verbatim. The POINTER (read `buffTotals`' doc before touching any consumption site) is the
class-3-endorsed form and is kept, now naming the consumers rather than counting them.
ACTION: rewritten.

### playerTurn.ts:4607 / :4612 / :4620 [workstream-label, history-claim]
CLAIM: "SP-4e Task 4 replaced \"ally → the bombarded target\" with the footprint route and deleted
the run-mode arms"; "no longer a mode-flag route"; "the pre-4e `?? actor.id` tail made that a
self-heal her text forbids"; "The hand-copy that used to stand here disagreed with the shared
helper on exactly the lone-caster case".
EVIDENCE: change history. Both live rules kept and turned forward-looking: an `?? actor.id` tail
WOULD be the forbidden self-heal, and a hand-copy that disagrees on the lone-caster case WOULD
re-create it.
ACTION: rewritten.

### playerTurn.ts:4784 / :4791 [history-claim]
CLAIM: "the `actor.id !== healing.targetId` early-return that used to sit here was a legacy
restriction that …"; "That lookup used to sit here for the off-anchor case and was pure
indirection".
EVIDENCE: change history about removed code. Both carry a live warning, kept as a prohibition
("Do NOT reinstate an `actor.id !== healing.targetId` early-return: it credits the gross bucket
and then silently withholds the HP …") and as a counterfactual.
ACTION: rewritten.

### playerTurn.ts:4852 [history-claim]
CLAIM: "The gate that used to wrap this whole block was suppressing the tick itself in order to
suppress its CREDIT"; "R2 (unchanged by #369)"; "(final-review FIX 1, …)"; "#369 therefore WIDENED
that condition's reach: before it, only a player-side ANCHOR holder could arm the flag …".
EVIDENCE: change history and review-round labels. All four locked heal rulings in this block (R2:
a tick is not a performed repair; `hot-ticked` arms nothing; any HP restoration counts as repaired
this round; the `enemySideHotTick.test.ts` fence) are kept, the last restated as the standing rule
rather than as a widening.
ACTION: rewritten.

### playerTurn.ts:4908 / :4914 [workstream-label, history-claim]
CLAIM: "(enemy walk, Task 5)"; "(E5 §4.1)"; "It used to scope to the CAST skill alone …, dropping
the passive slot entirely, so no enemy ever fired a passive-slot repair or shield. … Both modes
now build the same list".
EVIDENCE: dead labels + change history. The GAME RULE (a ship fires its passives whenever their
conditions are met, on either side — user-confirmed 2026-08-07) is kept with its date, and the
consequence restated as a counterfactual.
ACTION: rewritten.

### playerTurn.ts:5109 / :5114 [history-claim, workstream-label]
CLAIM: "the caster's gross `directHeal` credit used to sit ABOVE this block, where the reversal
could not retract it. It now books inside …"; "`victim` no longer defaults to the heal target
(Task 4, #362) … the same actor the removed default used".
EVIDENCE: change history. R10′ (#362) itself is a locked ruling and is kept as the present-tense
rule with its reason (a closure cannot retract a credit already written).
ACTION: rewritten.

### playerTurn.ts:5232 [history-claim]
CLAIM: "#418: this now genuinely mirrors the heal-performed emit below … The comment here used to
CLAIM it mirrored that emit while gating on post-cap pool growth, the opposite rule, so a grant
onto a saturated pool silently failed to fire Resonating Fury."
EVIDENCE: a comment whose subject is a previous version of itself. The standing #418 contract
(the gate is the GROSS grant, so a saturated pool still fires Resonating Fury —
`project_shield_system_h`) is kept and restated as a prohibition on the wrong basis.
ACTION: rewritten.

### playerTurn.ts:5290 [workstream-label]
CLAIM: "The second term closed the asymmetry PR6 knowingly opened: PR6 gated the REACTIVE path on
`healSum > 0` … and left this one on recipients alone, so a CAST repair that restored nothing
still emitted …".
EVIDENCE: change history. The two-term gate and every consequence of dropping the second term are
kept as a counterfactual, riders named.
ACTION: rewritten.

### playerTurn.ts:5395 [history-claim]
CLAIM: "#396: what \"the portion that went in\" MEANS changed. The fold no longer adds the raw
enemy-applied sum"; "byte-identical to the pre-#367 shape".
EVIDENCE: change history. The definition (it IS the shadowed delta, not the raw sum) is the live
contract and is kept, `#396` retained.
ACTION: rewritten.

### playerTurn.ts:5455 [workstream-label]
CLAIM: "the same identity Task 4 established for the firing hit".
EVIDENCE: dead label as the sentence's subject.
ACTION: rewritten ("the same identity the firing hit relies on").

### playerTurn.ts:163 [history-claim] — remaining candidate, KEPT
CLAIM: regex matched "the ctx used to fold each group".
EVIDENCE: false positive — "used to" here is "the ctx used FOR folding", not past tense.
ACTION: kept (legitimate contract).

### playerTurn.ts:294 [pending-claim] — remaining candidate, KEPT
CLAIM: "One enemy-debuff landing this cast decided but has not yet written".
EVIDENCE: false positive, and precisely the deferred-write contract this file exists to
document — `applyState`/`emitEvents` are two separate closures the engine runs at different
moments; verified against `engine.ts:9367-9375`.
ACTION: kept (legitimate contract).

Also stripped in these batches (dead vocabulary, unflagged by the finder but identical in kind):
`I4a:`, `Sub-project I, PR I3 (Layer 1)` ×2, `Sub-project I, PR I4c`, `SP-F F3 fix (Critical)`,
`SP-F F3 (Lingshe)`, `Ship-kit W7`, `Finding 1` ×2, `(review fix, B2)`, `E3:`, `I6:`,
`(C2a/C2b-3)`, `F3:`, `(the I2 per-victim re-fold)`, `pre-I3/pre-I4c/pre-I6 behavior`,
`same path as before`, `Math is byte-identical; only the DoT block relocated`.

---

## FALSE COMMENTS FOUND

Three comments were not merely stale — they asserted something the code contradicts. All three are
of the same shape as PR #457's eight: a claim that work is FUTURE when it has already shipped.

1. **`runPlayerTurn`'s doc comment** — "only the attacker uses this today; **Task 4 builds walked
   team runtimes**."
   `runPlayerTurn` is called from three sites in `engine.ts`: `11259` (focus actor), `11644`
   (`teamTurn` — the walked team ally) and `12098` (`enemyTurn`). The walked team runtimes the
   comment defers to a future task already exist: `const teamRuntimeById = new Map<string,
   PlayerActorRuntime>()` at `engine.ts:2645`, populated at `engine.ts:2747`. An agent reading this
   literally would conclude the function is attacker-only and could break team or enemy turns by
   assuming `runtime.actor.id === 'attacker'`.
   → Rewritten to name all three turn sites.

2. **The heal-block banner** — "HoT (hotHeal) ticking is **Task 7 — not produced here**."
   HoT ticking IS produced here. `tickHot` is declared at `playerTurn.ts:4582` and invoked at
   `playerTurn.ts:4700` (payload-carrying ability HoT statuses) and `playerTurn.ts:4709` (scheduled
   snapshot HoTs) — both inside the very `if (args.healing)` block this banner introduces.
   `engine.ts:1859` corroborates: "playerTurn.ts `tickHot` — raw into the HOLDER's `hotHeal`". The
   comment sends a reader looking for a tick site that does not exist elsewhere.
   → Rewritten to "HoT (hotHeal) ticking runs further down this same block, in `tickHot`."

3. **The `sourceFired` note** — "sourceFired(runtime.actor.id, …) is already correct for **future
   team ids**."
   Team ids are not future (same evidence as #1: `teamRuntimeById`, and `engine.ts:11644` running a
   full team turn through this function). The claim's substance was right; its tense was wrong,
   which is the reading that decays into "this is not wired up yet".
   → Rewritten to present tense.

## FLAGGED FOR OWNER

**None.** No comment in `playerTurn.ts` made a behaviour claim that the surrounding code
contradicts. The four claim classes this file was specifically watched for all checked out against
source:

- **intra-cast clause ORDER** — "a clause that follows a damage clause must not be in the store
  while that damage resolves", and the sub-attack (not the cast) is the unit of "that damage":
  matches the `status.afterDamageClause === true` branch and `applyDebuffsForSubAttack`'s
  `phase: 'before-damage' | 'after-damage'` parameter.
- **which victim a per-victim record is keyed to** — `inflictedEnemyDebuffs` collapses the
  recipient list to one row (for the Stasis-break check) while `inflictedDebuffNamesByVictim` is
  per-victim: both comments say so and both match the code.
- **deferred/pending writes that flush after the turn returns** — `flushDeferredEnemyApplications`
  (`engine.ts:9367-9375`) runs `applyState()` then `emitEvents()` back-to-back, as documented; the
  TDZ note explaining why the cast-time inline branch calls `writeState()` directly instead of
  `pair.applyState` is correct (`applyState` closes over a `const landedEnemyDebuffs` declared
  later in the function).
- **multi-hit sub-attack semantics** — one `ability-performed` per sub-attack, damage split N ways,
  `destroyedRound` (not `currentHp <= 0`) as the whiff signal: all three match the `emitHits` loop.

The one thing worth the owner's attention is not a contradiction but an **open game question the
file already flags and this sweep deliberately preserved**: the KNOWN ASYMMETRY at the
`ability-performed` emit loop — `secondaryStatValue`, `conditionalBonusPct` and the passive-slot
hit are each folded in ONCE per cast while the base multiplier scales with `hits`, so each
sub-attack's reported `damage` carries 1/N of a single secondary / conditional / passive payload.
Reporting-only (the cast's Σ does not move), and the comment says it is untestable in-game today
because no multi-hit ship carries defence/HP-scaling or a conditional bonus. Left exactly as it
stands.

## RESIDUAL, deliberately not swept

~35 bare `→ byte-identical` / `(byte-identical)` tails survive on blocks the finder did NOT flag
(e.g. "Absent → byte-identical", "Both default 0 → byte-identical"). They are zero-churn framing
of the class `CLAUDE.md` names, and "byte-identical to what?" is unanswerable to an agent with no
knowledge of the PR — but they are one-word tails on otherwise-live contracts, outside the
candidate set, and stripping them all would add ~35 more lines of diff for a reviewer to read.
Flagged here rather than done silently. The instances inside blocks this sweep already rewrote WERE
removed.

Also swept after the batch write-ups, on the advisor's catch: the `enemyAppliedFamilies` field doc
("#367 originally folded the two HEAL channels as a plain SUM at a much earlier site … so #396
moved them … Verified before moving") — the interface-side TWIN of the `playerTurn.ts:2121` entry
above. Leaving one rewritten and the other saying "moved" is exactly the rule-restated-at-N-sites
drift the policy warns about, so both now state the same present-tense rule: all four channels
fold at the LATE fold, not beside `preFight`, because the self side needs `abilitySelfEffects`.
ACTION: rewritten.
