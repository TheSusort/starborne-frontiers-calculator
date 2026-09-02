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
