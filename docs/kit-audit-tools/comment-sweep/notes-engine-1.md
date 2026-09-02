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
