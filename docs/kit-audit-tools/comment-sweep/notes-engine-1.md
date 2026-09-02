# notes-engine-1 — `src/utils/combat/engine.ts`, lines 1–4499

Agent A, region 1. Line numbers are the ORIGINAL `blocks.mjs --from 1 --to 4499` line numbers
(they drift as multi-line comments shrink). 149 candidate blocks.

Oracle baseline before any edit: **GREEN** (37842 tokens identical).

---

### engine.ts:161-171 [history-claim]
CLAIM: "The dummy actor that used to host that bucket is gone; the bucket is not. Keeping the
literal 'enemy' keeps the event stream byte-identical across the deletion… the same lie
`finalHpPct` told."
EVIDENCE: the live rule is the RESERVATION (`reservedActorIds`, `sentinelActorIdReservation.test.ts`),
which the surrounding code enforces. The deletion narrative is archaeology.
ACTION: rewritten — history dropped, the reservation contract and its fencing test kept.

### engine.ts:181-196 [workstream-label]
CLAIM: "(Task 2 authority for effectiveSpeedOf)" and "Task 0 corpus investigation:".
EVIDENCE: `effectiveSpeedOf` (engine.ts ~2777) calls this; the corpus statement is still true.
ACTION: rewritten — task numbers stripped, both statements kept as present tense.

### engine.ts:207-208 [history-claim, workstream-label]
CLAIM: "Extracted from the attacker's inline loop (Task 4); Task 5 makes the routing real."
ACTION: deleted (policy class 1).

### engine.ts:235-236 [history-claim]
CLAIM: "Zero-churn: … identical to the pre-Task-5 owner-routing."
ACTION: deleted (policy class 1).

### engine.ts:253 [count-enum]
CLAIM: "site 3 of the four-site sweep"; "every caller that predates #363 (and every fixture that
omits it)".
ACTION: rewritten — count and fixture enumeration dropped, `#363` kept, the
absent-reader-== -absent-filter contract kept.

### engine.ts:286 [pending-claim]
CLAIM: "a debuff whose clause follows a damage-dealing clause is not yet in the store while that
cast's damage resolves".
EVIDENCE: `sawDamageClause` / `isFiringSlot` immediately below implement exactly this.
ACTION: kept (legitimate contract). Finder matched "not yet".

### engine.ts:360 [pending-claim]
CLAIM: "keep the aura model for now (documented in coverage §5)".
ACTION: rewritten — "for now" dropped; the scope statement and doc pointer kept.

### engine.ts:381 [workstream-label]
CLAIM: "so Task 3's parser flip cannot turn it into `'lowest-hp-ally'`".
ACTION: rewritten — "Task 3's parser flip" → "the parser".

### engine.ts:390 [workstream-label]
CLAIM: "matching every other SP-4e site"; "the self-grant this rung exists to prevent".
ACTION: rewritten — labels replaced with "every other ally-scoped resolution site" / "this fence".

### engine.ts:417 [history-claim]
CLAIM: "It used to fall through to the `[ownerId]` arm instead, which turned an adjacent grant
into a self-grant — Centurion's charged Core Charge I banked its 2 stacks on Centurion".
ACTION: rewritten to present tense ("must NOT fall through … would turn … would bank"), keeping
the rule and the concrete Centurion example.

### engine.ts:557 [count-enum]
CLAIM: "(site 3 of the four-site sweep)", "(site 1)", "all four consumers inherit it".
ACTION: rewritten — all three counts dropped; `#363` and the semantics kept.

### engine.ts:613 [count-enum]
CLAIM: "(site 2 of the four-site sweep)".
ACTION: rewritten — count dropped.

### engine.ts:649 [workstream-label]
CLAIM: "(epic PR4)"; "the F3 squad-leader `startingShieldPctOfHp` seeding".
ACTION: rewritten — both labels dropped.

### engine.ts:653 [history-claim]
CLAIM: "SKIPS pre-combat abilities (they used to re-grant the pool on every cast)".
ACTION: rewritten — parenthetical history deleted, the SKIP contract kept.

### engine.ts:681,685,692,695 [workstream-label, pending-claim] — **FALSE (two claims)**
CLAIM (692): "defence/hp: The enemy's own stats (default 0 until Task 9 populates real values via
the adapter)."
EVIDENCE: `dpsSimulator.ts:512-515` sets `defence: args.enemyDefense, hp: args.enemyHp` on the
synthesized enemy; `battleSimulator.ts:1155` sets `stats: toEnemyStats(plan.stats)`. Both adapters
populate real values TODAY.
CLAIM (695): "affinity: Neutral placeholder … Task 9 wires real matchup after the affinity selector
lands."
EVIDENCE: `buildEnemyPlayerActorRuntime` reads `e.affinityDamageModifier ?? 0` /
`e.affinityCritCap ?? 100` / `e.affinityCritPenalty ?? 0`, and `battleSimulator.ts:1151` computes
`computeAffinityModifiers(plan.affinity, playerRepAffinity)` for every enemy plan. The matchup IS
resolved; neutral is only the absent-input default.
ACTION: rewritten as present-tense contracts. WAS FALSE (both).
Also stripped "(Task 5; consumed by the Task 6b dispatch)" and the
"byte-identical damage to the retired runEnemyAttackerTurn manual path" history.

### engine.ts:712-713, 715-716 [pending-claim] — **FALSE**
CLAIM: enemy base hacking / security — "No production reader until landing lands".
EVIDENCE: `effectiveStats.ts:266-267` — `liveDebuffLandingChance` reads
`attacker.stats.hacking ?? 200` and `defender.stats.security ?? 100`. Production callers:
`playerTurn.ts:1916` and `playerTurn.ts:1982`, plus `engine.ts:3131`
(`liveDebuffLandingChanceFor`, which resolves BOTH ids out of `allActorsById` — enemy actors
included, so an enemy attacker's own base hacking is read whenever it inflicts).
ACTION: rewritten as present-tense contracts naming `liveDebuffLandingChance`. WAS FALSE.

### engine.ts:718-719 [workstream-label, pending-claim] — **FALSE**
CLAIM: "Shield penetration … No production reader until H1 Task 4 wires the apply path."
EVIDENCE: `engine.ts:7128-7133` `attackerShieldPenOf` reads
`allActorsById.get(id)?.stats.shieldPenetration`; it feeds `shieldPenetrationPct` (engine.ts:7167,
7203) → `penPct` (engine.ts:6580, 6643) → `shieldAbsorb.ts:19-23`. (All corroborating sites are
past line 4499 and were NOT edited.)
ACTION: rewritten as a present-tense contract naming `shieldAbsorb`'s `penPct`. WAS FALSE.

### engine.ts:877 [pending-claim] — **FALSE**
CLAIM: "Base hacking/security — base for effectiveStatsOf; unread until landing lands."
EVIDENCE: same as 712-716.
ACTION: rewritten. WAS FALSE.

### engine.ts:909 [workstream-label]
CLAIM: "(A2 Task 4 — set each turn by runPlayerTurn)".
EVIDENCE: `playerTurn.ts:2040` sets `runtime.liveDebuffLandingChance` per turn — the claim's
substance is true, only the label is dead.
ACTION: rewritten — label stripped.

### engine.ts:962 [workstream-label]
CLAIM: "SP-4c-2b:"; "keeps the cast path … byte-identical"; "the old neutral guard".
ACTION: rewritten — label and zero-churn framing dropped; the per-victim-vs-cast-path fallback
contract kept.

### engine.ts:980-982 [history-claim]
CLAIM: "Used to collapse the per-round enemy-effects union…"
EVIDENCE: "Used to" here means "is used to", not "formerly". The body does exactly this.
ACTION: kept (legitimate contract). Finder false positive.

### engine.ts:1101 [workstream-label]
CLAIM: "so Phase 3 reactive triggers can observe each burst's…"
ACTION: rewritten — "Phase 3" dropped; the emit-once-per-burst contract kept.

### engine.ts:1146 [history-claim]
CLAIM: "The input is now supplied by `directDealtBy(...)`. It used to be a bare sum over the
scalar `roundDamage` map, which a positional run never writes — so every accumulator drained on
schedule for exactly 0."
ACTION: rewritten to present tense — the live reason (a scalar-only sum would drain for 0 on a
positional run) kept, the "used to" framing dropped.

### engine.ts:1184 [history-claim]
CLAIM: "(preserving the pre-Task-4 single-event-per-type emission). At attacker-only this
produces byte-identical totals."
ACTION: rewritten — "one event per type, however many appliers contributed."

### engine.ts:1193 (SP-E) [workstream-label]
CLAIM: "SP-E: added 'generic' alongside 'corrosion'/'inferno'."
ACTION: rewritten — "Covers 'generic' alongside…".

### engine.ts:1225-1226 [workstream-label]
CLAIM: "D-PR3 (Vortex Veil): … Absent → 0 → byte-identical."
ACTION: rewritten — label and zero-churn tail dropped.

### engine.ts:~1228 (dotMultFor) [workstream-label]
CLAIM: "Sub-project I, PR I4b —"; "every call site that doesn't (yet) pass this stays
byte-identical."
ACTION: rewritten — label dropped, default-when-absent contract kept.

### engine.ts:1379-1380, 1382-1383 and 1590-1591, 1593-1594 [workstream-label]
CLAIM: "Consumed by the Task 8b positional apply at the team/focus damage site."
ACTION: rewritten — "Task 8b" dropped; the consumption pointer kept.

### engine.ts:~1387, ~1603 (preFight) [workstream-label]
CLAIM: "(sub-project F, PR F3)"; "(byte-identical)".
ACTION: rewritten — both dropped.

### engine.ts:1396-1412 (RunMode) [workstream-label, history-claim]
CLAIM: "There used to be a SECOND dps-run exit … SP-4b-2b made that derivation permanently false
… SP-4c-2d deleted it with the dummy actor … SP-4c-1's side-wipe rule"; "that is exactly what
SP-4 removed."
ACTION: rewritten — the mode contract, the side-wipe rule and "the default is a CONSTANT, not a
derivation" kept; the rung-by-rung history dropped.

### engine.ts:1420-1421 [workstream-label, pending-claim] — **FALSE**
CLAIM: focus `shieldPenetration` — "No production reader until H1 Task 4 wires the apply path."
EVIDENCE: same chain as 718-719 (`attackerShieldPenOf` → `shieldPenetrationPct` → `penPct` →
`shieldAbsorb`).
ACTION: rewritten. WAS FALSE.

### engine.ts:1444-1446 [pending-claim] — **FALSE**
CLAIM: focus base hacking — "The adapter passes `input.hacking ?? 200` (the OLD landing-formula
default); no production reader until dynamic landing lands."
EVIDENCE: `effectiveStats.ts:266` `attacker.stats.hacking ?? 200` inside
`liveDebuffLandingChance`; production callers `playerTurn.ts:1916`, `playerTurn.ts:1982`.
ACTION: rewritten. WAS FALSE.

### engine.ts:1481-1488 [workstream-label, history-claim]
CLAIM: "since SP-4e Task 4 recipient CHOICE comes from…"; "(The retired `teamBattle` flag used to
make…)"; "legacy single-target accounting".
ACTION: rewritten — the two-axis contract kept, the retired-flag paragraph deleted.

### engine.ts:1490-1495 + 1503 + 1505 [workstream-label, pending-claim] — **FALSE**
CLAIM: "`defence` and `hp` are optional now …; Task 9 populates them with real matchup values via
the adapter"; "Enemy's own defence stat. Default 0. Task 9 provides real value."
EVIDENCE: `dpsSimulator.ts:512-515` and `battleSimulator.ts:1155` both supply real defence/hp
today.
ACTION: rewritten as present-tense contracts. WAS FALSE.

### engine.ts:1507, 1509, 1511-1512 [workstream-label, pending-claim] — **FALSE**
CLAIM: enemy-roster base hacking/security "unread until A2 Task 4"; shieldPenetration "No
production reader until H1 Task 4".
EVIDENCE: as 712-719 above.
ACTION: rewritten. WAS FALSE.

### engine.ts:1612-1620 [workstream-label]
CLAIM: "KEPT (not removed once Task 8/9 wired production callers)"; "since E1".
ACTION: rewritten — labels dropped, the "unique coverage the integration test cannot observe"
rationale kept.

### engine.ts:~1638 [history-claim]
CLAIM: "Widened to include 'generic' (mirrors LeechChannel)."
ACTION: rewritten to "Mirrors LeechChannel."

### engine.ts:1642-1648 [pending-claim] — **FALSE**
CLAIM: "(the bases have no production reader yet)".
EVIDENCE: as 712-719.
ACTION: rewritten — now says the tap lets tests assert the bases directly rather than through
`liveDebuffLandingChance`'s roll. WAS FALSE.

### engine.ts:1650-1658 [workstream-label, history-claim]
CLAIM: "Since D-PR12 the closure sums BOTH … (field name kept as … to avoid churning the existing
tap tests)".
ACTION: rewritten — "Despite the field name, the closure sums BOTH …". The LIVE-state warning and
the per-round-identical note kept.

### engine.ts:1721-1723 [workstream-label] — **FALSE (count)**
CLAIM: "The four side-specific fields the reactive intent drain needs (enemy-team PR1)."
EVIDENCE: `ReactiveSideCtx` declares ~18 fields, not four.
ACTION: rewritten — count and label dropped. WAS FALSE.

### engine.ts:1751-1755 [workstream-label]
CLAIM: "Pre-#415 this was always the DPS-mode case …; the player side is now always defined here";
"bySide PR3"; "enemy = 100 until PR5".
EVIDENCE: `engine.ts:3459-3473` — player arm is `healTarget ? … : undefined`, enemy arm is
`(): number => 100`. So "enemy = 100 for every owner" is TRUE today; only the labels are dead, and
"always defined" is conditional on `healTarget` existing.
ACTION: rewritten — labels dropped, the conditional stated accurately, `#415` kept.

### engine.ts:1775-1776, 1780-1783 [workstream-label]
CLAIM: "ship-kit W3 (Sansi)"; "Ship-kit W5 Task C3 (Demolisher bomb-splash)".
ACTION: rewritten — kit-wave labels dropped, ship names kept.

### engine.ts:1789-1790 [workstream-label, pending-claim] — **FALSE**
CLAIM: "Per-victim incoming accounting bucket (PR5a foundation — written in parallel with the
heal-target scalars; no reader until PR5b flips them)."
EVIDENCE: `engine.ts:13243-13277` folds `perActorIncoming` into `RoundData.perActorIncoming`;
readers are `battleSimulator.ts:621,659,1296-1305`, `dpsSimulator.ts:307-333`,
`healingEngineAdapter.ts:822-888`, `defenseSurvivabilitySim.ts:270-283`.
ACTION: rewritten naming the real readers. WAS FALSE.

### engine.ts:1840-1842 [workstream-label] — **FALSE**
CLAIM: "Task 2 adds the UI display surface; this field exists now so the blocked total is
observable."
EVIDENCE: the UI display surface exists — `HealerConfigCard.tsx:272-275` renders
`summary.totalBarrierAbsorbed` (from `healingEngineAdapter.ts:822,870,888`), and
`DefenseShipCard.tsx:484-488` renders `breakdown.toBarrier` (from
`defenseSurvivabilitySim.ts:283`).
ACTION: rewritten naming both display surfaces. WAS FALSE.

### engine.ts:~1710 [workstream-label]
CLAIM: "generic DoTs are not auto-applied from skill text in this task".
ACTION: rewritten — "in this task" dropped. (The claim itself holds: `playerTurn.ts:1283` says the
parser never emits `type:'generic'`.)

### engine.ts:2021-2057 (`noVictimTurnCount`) [workstream-label, history-claim]
CLAIM: "ONE RULE, ONE COUNTER (SP-4e, #335). Until this rung there were two counters…"; the
"WHAT MOVED IT WHEN THE RULE UNIFIED (measured on `af4f05ae`)" row table (1,341 / 324 / 15 rows).
ACTION: rewritten — the ONE-RULE-ONE-COUNTER contract, `#335`, WHAT IT IS NOT, and the
module-level reset contract all kept; the two-counter history and the measured row table deleted
(policy classes 1 and 2).

### engine.ts:2065-2100 (resolved/dead victim tripwire) [workstream-label]
CLAIM: "#346 widened it from the enemy site alone, where SP-4e first placed it as the gate on
`skipDeadTargetTurn`; that branch is now deleted…"; "the pre-#335 `?? healTarget` shape";
"all three turn sites".
ACTION: rewritten — the property, the `dead`/`resolved` non-vacuity argument, the deliberate
NOT-a-throw, and the ⚠️ blind-spot paragraph naming `noVictimEnemyBindsNobody.integration.test.ts`
all kept; the branch history and the count dropped. `#346` kept.

### engine.ts:2110-2123 (round loop doc) [workstream-label, history-claim]
CLAIM: "SP-4c-2c dropped its turn and SP-4c-2d deleted the actor".
ACTION: rewritten to the present-tense invariant ("every turn in the pool belongs to a ship on the
board — there is no stand-in `enemy` actor").

### engine.ts:2136-2138 (`rawTotals.generic`) [pending-claim]
CLAIM: "Always 0 today (generic DoTs are never auto-applied from skill text in this task) — not
yet consumed by DPSSimulationSummary; a future task can surface it as totalGenericDamage."
EVIDENCE: `grep totalGenericDamage src/` → the ONLY hit was this comment, so the no-consumer half
is true. `playerTurn.ts:1283` states the parser never emits `type:'generic'`, but the
`genericDoTEntries` arg is caller-suppliable, so "always 0" over-claims.
ACTION: rewritten as "0 unless a caller supplies generic DoT entries directly"; task vocabulary
dropped.

### engine.ts:2143-2148 (`enemyOutcome`) [workstream-label, history-claim]
ACTION: rewritten — the live rule kept ("a single scalar cannot describe a multi-enemy roster");
the SP-4b-2a/SP-4b-2b removal narrative deleted. The `ship-destroyed` / `perActorIncoming`
pointers kept.

### engine.ts:2171-2174 (destructure comment) [history-claim, workstream-label]
CLAIM: "Task 6 deleted the fields from `CombatEngineInput` entirely."
ACTION: rewritten to the present-tense fact ("There are no `enemyDefense`/… fields on
`CombatEngineInput`").

### engine.ts:2197 [workstream-label]
CLAIM: "A.3 migration … the legacy non-walked-team branch is unreachable (and deleted in Task 4)."
ACTION: rewritten — labels dropped, the invariant kept.

### engine.ts:2229-2230 [workstream-label]
CLAIM: "(SP-4c-2c retired the dummy's turn and SP-4c-2d deleted the actor …)".
ACTION: rewritten — history dropped, the `dotCarrierActors` pointer kept.

### engine.ts:2248 [pending-claim] — **FALSE**
CLAIM: "Base hacking — base for effectiveStatsOf.hacking; unread until landing lands."
EVIDENCE: as 712-716.
ACTION: rewritten. WAS FALSE.

### engine.ts:2267-2273 (the dummy-actor obituary at the construction site) [workstream-label]
ACTION: rewritten — the whole rung-by-rung obituary deleted; the live prohibition kept ("Do not
reintroduce a stand-in actor, or a scalar, to describe 'the enemy' fight-wide") along with the
`SENTINEL_ENEMY_ACTOR_ID` pointer.

### engine.ts:2279 [pending-claim]
CLAIM: "Internal for now … A later phase lifts this into CombatEngineInput once multi-actor damage
rows are needed (YAGNI)."
ACTION: rewritten — the speculative future work deleted, the keying rule kept.

### engine.ts:2288 [workstream-label]
CLAIM: "exactly as before Task 5 (zero churn)"; "walked or legacy".
ACTION: rewritten.

### engine.ts:2406-2407, 2434-2436, 2446-2447 [workstream-label, history-claim]
CLAIM: "the Task 8b apply path"; "Was empty for every non-positional input … and inert when
written; since SP-4b-1 …"; "since SP-4b-2b the roster is provably non-empty".
ACTION: rewritten — task labels and the was-inert history dropped; the live guarantee
(`normalizeCombatRoster` fills target + pattern and throws on an empty roster) kept.

### engine.ts:2473, 2493, 2509 [workstream-label]
CLAIM: "(Task 7 — …)"; "(A2 Task 4 — set each turn by runPlayerTurn)"; "SP-4c-2b:"; several
"byte-identical" diff justifications.
ACTION: rewritten — labels and zero-churn framing dropped; the per-victim-vs-cast-path contract
kept.

### engine.ts:2569, 2571, 2656-2657, 2661 [history-claim, workstream-label] — **FALSE**
CLAIM (2656-2657): "Reactive abilities are PARTITIONED here but NOT registered as listeners this
task — Task 6 registers them per owner."
EVIDENCE: `reactivePerOwner` (engine.ts, further down the same function) is built from
`teamRuntimeById.get(t.id)!.reactiveAbilities` and passed to `registerReactiveListeners`.
Registration happens in the SAME run, not a later task.
ACTION: rewritten to name `reactivePerOwner`. WAS FALSE (as a pending claim).
Also stripped "zero-churn ordering gate" / "(AFTER the attacker — zero-churn …)" and
"the page no longer feeds…" from the neighbouring blocks.

### engine.ts:2763-2767 [workstream-label, pending-claim] — **FALSE**
CLAIM: "Live effective speed for ANY actor on EITHER side (Task 2 authority; UNWIRED — Task 3
wires it into the turn loop via selectNextBySpeed)."
EVIDENCE: `effectiveSpeedOf` is defined at engine.ts (this site) and passed to
`selectNextBySpeed` at engine.ts:10651 and :10656 (both past 4499, NOT edited). It is wired.
ACTION: rewritten as a present-tense contract. WAS FALSE. "Task 0 corpus investigation" also
dropped.

### engine.ts:2792-2807 (side-wide reactive DoT containers) [history-claim, workstream-label]
ACTION: rewritten — the dummy-alias history deleted; the reason the containers exist
(`buildDrainContext`'s DoT-count scalars), the ⚠️ OPEN RESIDUAL warning, the `landDotOn` strand
route, and the "no side-wide `pendingAccumulators`" note all kept.

### engine.ts:2825 [pending-claim]
CLAIM: "entry whose applier has not yet acted this run (faster-enemy round 1) has no ctx → skip."
ACTION: kept (legitimate contract). Finder matched "not yet".

### engine.ts:2827-2849 (CROSS-TURN-CACHE) [workstream-label]
CLAIM: "SP-4c-2b review sweep"; "§A.4 measured the ghost's `affinity` as always `undefined` …
byte-identical to what the ghost produced … predates this rung"; "SP-4d Fix wave 1"; "Set at each
of the three turn-firing call sites".
ACTION: rewritten — the whole ⚠️ CROSS-TURN-CACHE class warning KEPT (it is a live defect record);
the review-sweep label, the retired measurement and the site count dropped.

### engine.ts:2856, 2880, 2899, 2940-2941, 2960 [history-claim, workstream-label]
CLAIM: "This id no longer decides…"; "since SP-4e a single-`ally` heal routes…"; "the derivation
SP-4 removed"; the `dpsEnemyTarget` obituary; "a `teamActors` entry named `'enemy'` was accepted
(as it also was before the dummy was deleted…)".
ACTION: rewritten — all four to present tense. The "pure DPS mode is unconstructible" warning and
the `normalizeCombatRoster` proof are kept, as is the side-symmetric reservation rule.

### engine.ts:3011-3026, 3035-3058 (`dotCarrierActors` + `dotCarrierReports`) [history-claim]
CLAIM: the dummy-sink "WHY IT EXISTS" paragraph and the "`|| a.id === enemy.id` disjunct"
paragraph.
ACTION: rewritten — the live requirement (report the REAL victims' containers, or a positional run
reports 0/[] against live stacks) kept in present tense; the deleted-disjunct history dropped. The
DISJOINT/never-empty/read-LIVE contracts and the plain-array-not-a-getter note kept verbatim.

### engine.ts:3061-3078 (`allActors` / `allActorsById`) [workstream-label]
CLAIM: "bySide unification PR1/PR2"; "companion actorsBySide lands in PR3"; "(and, before
SP-4c-2d, the dummy enemy)".
ACTION: rewritten — labels dropped, `actorsBySide` named as an existing sibling (it IS defined in
this function).

### engine.ts:3081-3122 (`reactiveLandingChanceFor`) [workstream-label]
CLAIM: the "⚠️ HISTORY" paragraph about the dummy sentinel's security.
ACTION: rewritten — the whole ⚠️ HISTORY paragraph replaced by the RULE it encoded, in present
tense, keeping the concrete `security ?? 100` → clamp-to-0 mechanism. The Flamel example, the
TEAM-SYMMETRIC-BY-CONSTRUCTION note, the AFFINITY SCOPE note, the `selfBuffLookup` note and the
RETURNS UNDEFINED contract are all kept.

### engine.ts:3134-3202 (the dummy-actor obituary block) [history-claim, workstream-label]
CLAIM: "THE DUMMY `enemy` ACTOR IS GONE. A block here used to inventory…"; "Measured as well as
argued: a `console.error` on the false branch over the whole suite hit ZERO times in 535 files";
"SP-4c-2c had already dropped the dummy from every turn order, so `turnOrderActors` was…".
EVIDENCE for dropping the measurement: a suite-file count is stale by construction (policy class
2) and a later widening would silently invalidate it; the two-guarantee ARGUMENT is what makes the
claim checkable, and it is kept verbatim.
ACTION: rewritten — the prohibition, the two-guarantee proof, and the ⚠️ warning that
`resolvesPositionalVictim` is NOT constant and must not be collapsed alongside it are all kept.
History and the file count deleted.

### engine.ts:3142, 3152, 3161, 3165, 3175, 3202 [workstream-label]
ACTION: rewritten — "since SP-4e", "(SP-4b-2b)", "Task 7 —", "Sub-project I, PR I5",
"SP-4b-2b removed the structurally-empty case" all dropped; the live invariants kept.

### engine.ts:3289-3302, 3346-3354 (side-context bundle) [workstream-label]
CLAIM: "bySide unification PR3"; "BYTE-IDENTICAL: the player context reproduces the old player
closures verbatim…"; "The genuine per-actor enemy self-HP% … lands in PR5"; "Consumed in Task 2".
EVIDENCE: `engine.ts:3459-3473` — the enemy arm is literally `(): number => 100`; the consumer is
`triggers.ts:2547` (`ctx.selfHpPctFor?.(ownerId) ?? 100`).
ACTION: rewritten — labels and the byte-identical framing dropped; the two deliberate side
asymmetries stated as present-tense contracts and the real consumer named.

### engine.ts:3661 [workstream-label] — **FALSE**
CLAIM: "target HP can only reach 0 via enemy attacks, which land in Task 8 — the detection just
never fires this task."
EVIDENCE: enemy attackers walk `runPlayerTurn` today (`enemyPlayerRuntimes`, and the enemy-side
turn dispatch in the round loop), so enemy attacks land and the detection does fire.
ACTION: rewritten. WAS FALSE.

### engine.ts:3711 [history-claim]
CLAIM: "incremented on every qualifying enqueue-drain and used to trigger removal only on the Nth
event".
EVIDENCE: "used to trigger" here means "is used to", not "formerly".
ACTION: kept (legitimate contract). Finder false positive — an interim rewrite was reverted.

### engine.ts:3718, 3723, 3809-3811 [workstream-label]
CLAIM: "(multi-hit full-walk epic, PR4 — was `${ownerId}:${abilityId}` …)"; "G PR1:"; "PR6:";
"(R1)".
ACTION: rewritten — labels dropped. The sub-attack-index rationale is kept but restated as a
present-tense invariant ("the sub-attack index is load-bearing: keyed on …:abilityId alone the
cache would be per-TURN") rather than as what a previous key did.

### engine.ts:3772-3776 (PATH B) [history-claim, workstream-label]
CLAIM: "PATH B IS REACHABLE — but no longer through the caller it was written for … SP-4b-2b made
the block unreachable and SP-4c-2d deleted it"; "deferred to SP-F/F7".
ACTION: rewritten — the REACHABILITY claim and its concrete Incinerator/Judge → Sokol/Liberator
worked example kept; the deleted-caller history and the deferral note dropped.

### engine.ts:3845-3847 (shared healing ctx) [workstream-label, history-claim]
CLAIM: "since SP-4e it no longer needs to tell them apart for ROUTING … (the `teamBattle:
runMode === 'battle'` flag that used to sit here is gone)".
ACTION: rewritten to present tense.

### engine.ts:3877 (`repairSourceId`) [workstream-label]
CLAIM: "(Task 4, #362)"; "Un-parked (#362 fix-wave-1): it went unread for one revision after R7′
moved…".
ACTION: rewritten — `#362` kept as the rationale pointer; the un-parking history replaced by the
present-tense reader statement (R11's log row, DISPLAY ONLY) and the standing prohibition.

### engine.ts:4045 [history-claim]
CLAIM: "A RETRACTED EARLIER RULING surfaced it as the healer's OVERHEALING, and this branch used
to deliver that by returning `{consumed: 0, overheal: raw}`".
ACTION: rewritten as a present-tense prohibition ("Do NOT surface it as the healer's OVERHEALING
by returning …"), keeping the reason the `{ reversed: true }` arm carries no numbers.

### engine.ts:4196-4202, 4220, 4251, 4283, 4297 [workstream-label, history-claim]
CLAIM: "--- Phase 3 reactive triggers ---"; "the Phase 1 contract"; "SP-U U3: merged the former
separate…"; "(commit 6c456a14)"; "SP-4c-2d dropped an `actorId === enemy.id ||` disjunct here …
hit ZERO times"; "enemy-team PR1"; "bySide PR2's per-call isOpposing … Reproduced exactly per side
from the pre-merge player/enemy calls"; "#363 Task 9"; "goldens byte-identical".
ACTION: all rewritten — phase/PR/commit labels and the merge history dropped; the
no-module-level-state argument, the early-exit rationale, and the isOpposing routing contract
kept. `#363` kept.

### engine.ts:~739/1367/1526/1577 (`ignoresStealth`) [not flagged — residual dead vocab]
CLAIM: "W6: ship-wide stealth-targeting bypass."
ACTION: rewritten — "W6:" dropped at the FOUR sites inside lines 1-4499. The fifth occurrence
(old line 7952) is past the 4499 boundary and was RESTORED to its original text after an
overly-broad substitution touched it.

### engine.ts:~4527-4586 [OUT OF RANGE — reverted]
Five further hunks (the `incomingHealAmpAbilitiesById` "later task" claim, `SP-F F5`,
`Wave 4 Task 8`, and two "byte-identical" tails) were edited and then REVERTED to their
`origin/main` text because they sit past old line 4499. NOTE for whoever owns 4500+: the
`incomingHealAmpAbilitiesById` comment ("Consumed by the heal-apply fold (a later task) — nothing
reads it yet") is **FALSE** — `incomingHealAmpAbilitiesOf` is read at engine.ts:3823 via
`incomingHealAmpForRecipient`.

---

## FALSE COMMENTS FOUND

Ten distinct false claims, all of the same family: a wiring/reader claim written while the
workstream was in flight, never swept when the workstream landed.

1. **`shieldPenetration` has "no production reader until H1 Task 4"** — three sites
   (`EnemyActorInput.stats`, `CombatEngineInput.shieldPenetration`,
   `CombatEngineInput.enemyAttackers[].stats`). It IS read: `attackerShieldPenOf`
   (engine.ts:7128-7133) → `shieldPenetrationPct` (7167, 7203) → `penPct` (6580, 6643) →
   `shieldAbsorb.ts:19-23`.
2. **Base `hacking` has "no production reader until landing lands" / "unread until A2 Task 4"** —
   four sites (`EnemyActorInput`, `CombatEngineInput`, `CombatEngineInput.enemyAttackers[]`, and
   the inline comment at the focus `createActor`). It IS read: `effectiveStats.ts:266`
   (`attacker.stats.hacking ?? 200`) inside `liveDebuffLandingChance`; production callers
   `playerTurn.ts:1916`, `playerTurn.ts:1982`, and `engine.ts:3131`.
3. **Base `security`, same claim** — read at `effectiveStats.ts:267`
   (`defender.stats.security ?? 100`), same callers.
4. **`__testTapActors`: "the bases have no production reader yet"** — same evidence as 2 and 3.
5. **Enemy `defence`/`hp`: "Task 9 provides real value" / "default 0 until Task 9 populates real
   values via the adapter"** — three sites. Both adapters supply real values today:
   `dpsSimulator.ts:512-515`, `battleSimulator.ts:1155` (`toEnemyStats(plan.stats)`).
6. **Enemy affinity: "Neutral placeholder … Task 9 wires real matchup after the affinity selector
   lands"** — `battleSimulator.ts:1151` computes `computeAffinityModifiers(plan.affinity,
   playerRepAffinity)` per enemy plan, and `buildEnemyPlayerActorRuntime` consumes
   `e.affinityDamageModifier` / `affinityCritCap` / `affinityCritPenalty`. Neutral is only the
   absent-input default.
7. **`ActorIntake`: "PR5a foundation … no reader until PR5b flips them"** — surfaced as
   `RoundData.perActorIncoming` (engine.ts:13243-13277) and read by `battleSimulator.ts:621,659`,
   `dpsSimulator.ts:307-333`, `healingEngineAdapter.ts:822-888`,
   `defenseSurvivabilitySim.ts:270-283`.
8. **`barrierAbsorbed`: "Task 2 adds the UI display surface"** — the UI display surface exists:
   `HealerConfigCard.tsx:272-275` (`summary.totalBarrierAbsorbed`) and
   `DefenseShipCard.tsx:484-488` (`breakdown.toBarrier`).
9. **`effectiveSpeedOf`: "Task 2 authority; UNWIRED — Task 3 wires it into the turn loop via
   selectNextBySpeed"** — it is passed to `selectNextBySpeed` at engine.ts:10651 and :10656.
   (Same shape as PR #457's proven-false `selectNextBySpeed` "UNWIRED".)
10. **Reactive abilities "NOT registered as listeners this task — Task 6 registers them per
    owner"** — `reactivePerOwner` in the same function builds from
    `teamRuntimeById.get(t.id)!.reactiveAbilities` and hands them to `registerReactiveListeners`.

Plus one false COUNT:

11. **`ReactiveSideCtx`: "The four side-specific fields the reactive intent drain needs"** — the
    interface declares roughly eighteen.

And one recorded for the 4500+ owner (edit reverted, out of my range):

12. **`incomingHealAmpAbilitiesById`: "Consumed by the heal-apply fold (a later task) — nothing
    reads it yet"** (old line 4527-4528) — `incomingHealAmpAbilitiesOf` is read at
    engine.ts:3823 via `incomingHealAmpForRecipient`.

## FLAGGED FOR OWNER

**None.** No comment in lines 1-4499 asserted a mechanic that the adjacent code visibly does not
perform. Every false claim found was a wiring/reader/count claim (outcome 1 or 2), verifiable by
grep and safe to rewrite or delete; none required a game-behaviour ruling.

Two adjacent observations, offered as notes rather than questions:

- The ten false comments are a single systemic pattern, not ten independent slips: the H1, A2,
  Task 9, PR5 and bySide workstreams all landed without sweeping the "no reader yet" comments they
  wrote on the way in. Worth a lint or a review-checklist item rather than another sweep.
- `engine.ts:2792-2807` carries a genuine ⚠️ **OPEN RESIDUAL** (the side-biased
  `ctx.corrosionEntries` read in `buildDrainContext`). It was already labelled open before this
  sweep; the label is preserved and its "a later rung's job" framing removed, since nothing is
  scheduled.

---

## Verification

- `tokenOracle.mjs --base origin/main src/utils/combat/engine.ts` → **GREEN** (37842 tokens
  identical) on the untouched baseline and after every batch, including the final state.
- `blocks.mjs --from 1 --to 4499` re-run at the end: **6** candidate blocks remain (down from
  149). Four are deliberate keeps — current lines 279 (intra-cast clause order), 978-980
  (`dedupeByBuffName`), 2776 (applier-has-no-ctx) and 3615 (`repairCountBySource`'s "used to
  trigger", i.e. "is used to"). The other two are OUT OF MY RANGE and were left untouched: current
  4412 = original 4527 (`incomingHealAmpAbilitiesById`, which is FALSE — see item 12) and current
  4463 = original 4579 (`Wave 4 Task 8`). NOTE: because the file shrank by ~120 lines,
  `--to 4499` now reaches past original line 4499; the two out-of-range hits appear only for that
  reason.
- Residual dead-vocabulary grep over lines 1-4499 (`Task N`, `SP-*`, `PRn`, `D-PRn`, `Wave N`,
  `Phase N`, `Wn`, `A2/H1 Task`, `epic PRn`, `Ship-kit Wn`, `Sub-project`): **zero hits**.
- Boundary: the highest changed hunk sits at ORIGINAL line **4297**. Five hunks that had landed
  past 4499 were reverted to `origin/main` text, and one over-broad substitution that reached
  old line 7952 (`ignoresStealth`'s `W6:` label) was restored.
- No added comment line exceeds prettier's `printWidth: 100`.
- Full `git diff` read end to end for prose integrity: no dangling clauses, no orphaned
  conjunctions, no stripped `()` in prose. Two interim rewrites were reverted after that read
  (engine.ts:3711's "used to trigger", which was a finder false positive, and a `#415` that had
  been wrapped in backticks).
- Not run, per instructions: `npm test`, `tsc`, `lint`. Nothing committed.
