# Comment sweep — `statusEngine.ts` + 17 small files (agent D)

Work list = `blocks.mjs` over the 18 owned files at `origin/main`: **49 candidate blocks**
(statusEngine 20, small files 29 — the design doc's "26" for the small files undercounted).
Every block below is either touched or deliberately kept. Line numbers are the `origin/main`
numbers the finder reported.

Token oracle: **GREEN for all 18 files** (zero code bytes changed).

---

## statusEngine.ts (20 blocks)

### statusEngine.ts:70-75 [history-claim]
CLAIM: "For attacker-only runs this is always ['attacker'] → zero churn vs the pre-Task-5
owner-routing."
EVIDENCE: `pre-Task-5` / "zero churn" is diff justification; the live half ("always ['attacker']
for attacker-only runs") is verifiable at the engine's per-recipient fan-out.
ACTION: rewritten (trailing zero-churn clause deleted, live contract kept).

### statusEngine.ts:206-212 [history-claim]
CLAIM: "(was step()'s return)", "defaults to 'attacker' so all pre-Task-2 call sites remain
unchanged", "(legacy semantics unchanged)", "(pre-Task-1 path, byte-identical)".
EVIDENCE: `snapshot(ownerId = 'attacker', enemyTargetId = DEFAULT_ENEMY_TARGET)` — the defaults are
real; everything else is archaeology about a rename and a migration.
ACTION: rewritten (defaults kept as a present-tense contract, all four history clauses deleted).

### statusEngine.ts:227-229 [history-claim]
CLAIM: "`targetId` (defaults to the singular default enemy target — pre-Task-1 path,
byte-identical)".
EVIDENCE: `decrementEnemy = (targetId = DEFAULT_ENEMY_TARGET)`.
ACTION: rewritten (default kept, `pre-Task-1 path, byte-identical` deleted).

### statusEngine.ts:288-293 [workstream-label]
CLAIM: "Wave 4 (Sokol): clean inverse of reduceAllDebuffsDuration — ..."
EVIDENCE: `Wave 4` is dead vocabulary; the ship name (Sokol) is game-grounding and stays.
ACTION: rewritten → "The clean inverse of reduceAllDebuffsDuration (Sokol) — ...". Eligibility
claims re-verified against `extendAllDebuffsDuration`'s body (numeric `turnsRemaining` only,
`isUnremovable(name, turnsRemaining)` skip, no deletion pass) — all accurate.

### statusEngine.ts:299-304 [workstream-label]
CLAIM: "Wave 4 (Ripper): the self-buff sibling ...", "extend-everything (Sokol/Ripper/Lev
behaviour, unchanged)".
EVIDENCE: `Wave 4` dead; "unchanged" is diff justification. `#363` is a keeper ref and stays.
ACTION: rewritten (label and "unchanged" removed; ships, #363 and the named-extension contract
kept).

### statusEngine.ts:322-326 [history-claim]
CLAIM: "(defaults to the singular default enemy target — pre-Task-1 path, byte-identical)".
EVIDENCE: `registerAbilityStatuses(..., enemyTargetId = DEFAULT_ENEMY_TARGET)`.
ACTION: rewritten (default kept, history clause deleted).

### statusEngine.ts:332-339 [history-claim]
CLAIM: same `pre-Task-1 path, byte-identical` parenthetical on `applyTimedAbilityStatus`.
EVIDENCE: signature default is real; the rest is archaeology.
ACTION: rewritten.

### statusEngine.ts:346-354 [history-claim]
CLAIM: "the resolver returns the local ctx → zero churn", "(pre-Task-1 path, byte-identical)".
EVIDENCE: `activeAbilityStatuses(side, resolveCtx, ownerId = 'attacker', enemyTargetId =
DEFAULT_ENEMY_TARGET)`; the caster-context gating claim is accurate.
ACTION: rewritten (both diff-justification clauses deleted).

### statusEngine.ts:361-366 [history-claim]
CLAIM: "(pre-Task-1 path, byte-identical)" on `timedAbilityStatuses`.
ACTION: rewritten.

### statusEngine.ts:641 [history-claim]
CLAIM: "DEFAULT_ENEMY_TARGET: the pre-Task-1 singular enemy target id ... → byte-identical to the
old singular enemyMap/accumEnemyMap/auraEnemy path. Declared at module level (exported); used here
as a closure-visible reference with no re-declaration needed."
EVIDENCE: a free-standing comment attached to no code, entirely about a migration and about the
absence of a re-declaration. The constant's own doc lives at module level (line ~546).
ACTION: deleted.

### statusEngine.ts:649 [pending-claim] — **FALSE**
CLAIM: "Scheduled accumulating buffs seed the 'attacker' owner's map ... **Later tasks can seed
team-actor maps for team-sourced accumulating statuses.**"
EVIDENCE: team-actor accumulating maps are seeded TODAY. `registerAbilityStatuses` routes a
self-side accumulating status through `getAccumSelf(ownerId)` (statusEngine.ts:1637), and
`engine.ts:568` calls `statusEngine.registerAbilityStatuses(statuses, rid === 'enemy' ? ownerId :
rid)` — one call per RECIPIENT id, i.e. per team actor. `sourceFired` then iterates
`accumSelfMaps.values()` across every owner (the #436 granter-cadence rule).
ACTION: rewritten as a present-tense contract naming `registerAbilityStatuses` / the engine
fan-out. **WAS FALSE.**

### statusEngine.ts:919 [history-claim]
CLAIM: "(legacy semantics: ... — byte-identical to the pre-Task-1 enemyMap/persistentEnemy
single-store path)".
EVIDENCE: `upsertBuff` reads `getSelfMap('attacker')` / `getEnemyMap(DEFAULT_ENEMY_TARGET)` — the
routing claim is true; the migration comparison is not information.
ACTION: rewritten (routing contract kept, history deleted).

### statusEngine.ts:1055 [history-claim]
CLAIM: "(was step()'s return)", "to DEFAULT_ENEMY_TARGET (pre-Task-1 path, byte-identical)".
ACTION: rewritten.

### statusEngine.ts:1209-1213 [history-claim]
CLAIM: "Defaults to DEFAULT_ENEMY_TARGET (the DPS-dummy sentinel '__enemy__'; pre-Task-1 path,
byte-identical)."
EVIDENCE: the "'Enemy' suffix is legacy — this is the store for debuffs landed ON the carrier"
half is a live naming contract and stays; only the migration clause goes.
ACTION: rewritten.

### statusEngine.ts:1335-1341 [history-claim]
CLAIM: return semantics ("the status was REMOVED by this call", not "a charge was spent"); and
`selfMaps.get(...)` rather than `getSelfMap(...)` to avoid allocating an empty map per actor.
EVIDENCE: `consumeStatusHit` does `const map = selfMaps.get(actorId); if (!map) return false;` and
returns `true` only on `map.delete(key)`. Both claims verified.
ACTION: kept (legitimate contract). Finder matched on prose shape, not on dead vocabulary.

### statusEngine.ts:1358-1379 [pending-claim]
CLAIM: the whole `removeNewestFirst` doc — side mapping, three skips, two "not gathered" classes,
newest-first ordering, `'all'`, unknown-id no-op; plus "(purge, wired in C2)".
EVIDENCE: verified line by line against `removeNewestFirst` (statusEngine.ts:1374-1402):
`'debuffs'` → `enemyMaps` + `accumEnemyMaps`; `'buffs'` → `selfMaps` + `accumSelfMaps`;
`isUnremovable(name, turnsRemaining) = turnsRemaining === 'permanent' || UNREMOVABLE_STATUSES.has(
name)` covers both named skips; accum arm skips `s.stacks <= 0 || s.appliedSeq === undefined`;
persistent maps are never referenced; `candidates.sort((a, b) => b.seq - a.seq)` is newest-first;
`count === 'all' ? candidates.length : ...`; unknown id → `undefined` maps → 0.
Buff Protection: the doc does NOT claim a holder-guard, and correctly so — the guard lives one
level up in `purge` (statusEngine.ts:1522-1534, "Purge-only — `cleanse` ... does NOT call this").
No contradiction.
The `'buffs'` arm is live: `purge` → `removeNewestFirst(actorId, 'buffs', count)`, called from
`playerTurn.ts:4306` and `triggers.ts:5513`.
ACTION: rewritten (only "wired in C2" deleted; every behaviour claim verified and kept).

### statusEngine.ts:1470-1481 [workstream-label]
CLAIM: "Wave 4 (Sokol) ..."; "Absent → extend every eligible debuff (Sokol/Lev, unchanged)".
ACTION: rewritten (label and "unchanged" removed; the `onlyNames` INFLICTED-scope contract, the
Asphyxiator example and the empty-set reading all verified against the body and kept).

### statusEngine.ts:1502-1508 [workstream-label]
CLAIM: "Wave 4 (Ripper) ..."; "(Sokol/Ripper/Lev, unchanged)".
ACTION: rewritten.

### statusEngine.ts:1632 [history-claim]
CLAIM: "defaults to DEFAULT_ENEMY_TARGET (pre-Task-1 path, byte-identical)".
ACTION: rewritten.

### statusEngine.ts:1910 [history-claim]
CLAIM: "`enemyTargetId` is ignored for self-side — matching the pre-Task-1 behavior where enemy
maps were singular and ownerId was never consulted for them."
EVIDENCE: the ignore-rule is true today; the appeal to a removed shape is not.
ACTION: rewritten (contract kept, migration clause deleted).

---

## Small files (29 blocks)

### __testutils__/bareRosterFixture.ts:1-7 [workstream-label]
CLAIM: "what the 64 direct-engine fixture files SP-4b-2b migrated pass to `runCombat` today (64
files / 253 tests is the branch's measured inventory; an earlier draft of this line said 54, which
undercounted)".
EVIDENCE: a count + its own correction history + a dead workstream label — policy class 1 and 2.
ACTION: rewritten (shape description kept, counts and label deleted).

### __testutils__/bareRosterFixture.ts:39-50 [workstream-label]
CLAIM: "`overrides` exists for one reason, learned repairing the SP-4b-2b fixture waves: ..."
EVIDENCE: the reason is live (500,000 HP is not a survival guarantee); the provenance is not.
ACTION: rewritten (label deleted, whole hazard explanation kept).

### __testutils__/bareRosterFixture.ts:76-81 [workstream-label]
CLAIM: "(SP-1's lesson, narrowed by SP-4b-2a to enemies that ACT)".
ACTION: rewritten → "— only an enemy that ACTS can."

### adjacency.ts:23 [workstream-label]
CLAIM: "Wave 5 hardening: ... so this guard is inert on the existing corpus; it only protects a
future wrong-roster call."
EVIDENCE: `if (owner === undefined) return [];` — the guard is real. "Wave 5" is dead vocabulary;
"inert on the existing corpus" is a reachability count that goes stale.
ACTION: rewritten (guard contract kept, label and reachability count deleted).

### audit/fingerprint.ts:48-85 [history-claim]
CLAIM: "EIGHT log-entry handlers in `buildCombatLog.ts` each spread ...", "That does not change the
outcome described above ... (verified: the Malvex snapshot is unmoved)".
EVIDENCE: `grep consumePendingSkill buildCombatLog.ts` shows many spread sites plus handlers that
deliberately do NOT consume (`dot-ticked`: "a tick is not a cast") — so the exact count is both
stale-by-construction and inconsistent with the block's own next paragraph ("ONE handler is not
among those"). `currentSkillTag()` exists (buildCombatLog.ts:463) and does consume `pendingSkill`
on first call, so the race claim holds.
ACTION: rewritten ("EIGHT" → "several"; the previous-revision meta-argument and the
snapshot-verification aside deleted; the single-use mechanism, the Malvex worked example and the
"what the suffix buys" rationale kept).

### buffTotals.ts:104-153 [history-claim, count-enum]
CLAIM: "It has SIX consumption sites across three files ...", "It was originally a closure inside
`runPlayerTurn` whose doc was honestly scoped to 'this file's three sites' ...", the whole
"HISTORICAL:" paragraph, "add the twin at ALL THREE sites", "Flooring it in one of the three".
EVIDENCE: the HISTORICAL paragraph documents two sites that "#374 DELETED", i.e. it accounts for
nothing that exists. Counts are policy class 2.
ACTION: rewritten (the leaf-module / import-cycle rationale, the named consumers, the flooring
rationale and the no-outgoing-twin rule all kept; every count and the HISTORICAL paragraph
deleted).

### buffTotals.ts:205 [pending-claim]
CLAIM: "`incomingDotDamage` is read from the enemy list only (`toDotAndPenModifiers`' `enemy`
argument) and never from a self list".
EVIDENCE: present-tense audit result; the regex matched "never from". Part of the cross-store
channel audit that `enemyStoreChannelCoverage.test.ts` pins.
ACTION: kept (legitimate contract) — finder false positive.

### buffTotals.ts:209 [history-claim]
CLAIM: "#398 CLOSED THE LAST FIVE. ... USED to fold exclusively through `foldActorBuffTotals` ...
the enemy store was not among them, so those enemy-side channels were DEAD ... Measured (5
families, 17 corpus ships): they landed, displayed, ticked down and changed nothing."
EVIDENCE: the present-tense half (which channels read the enemy store, via which constant, at
which fold, and that `hp` remains dead) is the information; the rest is the PR's argument plus a
measurement count.
ACTION: rewritten (#398 ref kept as the rationale pointer, history and counts deleted).

### damageReflection.ts:28-43 [history-claim]
CLAIM: "That name let a Critical survive a full review: ... so the positional one no longer
carries the prefix."
EVIDENCE: the positional-vs-causal distinction and the `attackerSideReductionPct` pointer are live
(that parameter exists in `victimDamage.ts` and is genuinely causal); the review anecdote is not.
ACTION: rewritten (DO-NOT-RENAME rule and both pointers kept, review history deleted).

### damageReflection.ts:49-79 [history-claim]
CLAIM: "#358 ADDENDUM 2/3", "(C2)", "(addendum 2)/(addendum 3)", "The previous revision of this
comment argued the opposite ... That argument is WRONG", "WHY ONE FUNCTION AND NOT TWO. This
shipped as ... plus a hand-copied `reflectedDamagePreDefenceForHit`".
EVIDENCE: both axes come from one evaluation (`reflectedDamageParts` returns `{damage,
preMitigation}` from shared locals) — the live rule. The addendum numbering, the C2 label and the
argument-with-a-previous-draft are all PR material.
ACTION: rewritten (#358 ref, the two-axes contract, the MEASURED numbers and the
`defenseSurvivabilitySim.test.ts` tripwire pointer kept; labels and meta-history deleted).

### damageReflection.ts:1-18 (module header — not a finder hit) — **FALSE**
CLAIM: "This module computes that raw reflected amount **before shield absorb** — shield is applied
at the engine seam **in a separate task**."
EVIDENCE: shield IS applied today. `engine.ts:6899` calls `reflectedDamageParts` and feeds the
result straight into `applyVictimDamage(reflected, attacker, sink, { isReflected: true, ... })`,
which runs `shieldAbsorb({ damage, shieldPool: victim.shieldPool, ... })` at engine.ts:6636.
ACTION: rewritten as a present-tense contract naming `applyVictimDamage`. **WAS FALSE.**
(Included because `PR`/`task` vocabulary in an owned file is in the removal list even where the
finder's regexes missed the block.)

### debuffRecipients.ts:4-41 [history-claim]
CLAIM: "#343: this used to be called 'the dummy sink', after the immortal placeholder enemy actor
that `undefined` resolved to before #339 deleted it. ... Keeping past-tense references to the
deleted actor searchable is deliberate (owner ruling)."
EVIDENCE: the paragraph is itself an OWNER RULING about vocabulary, and it explicitly asks that the
past-tense references stay searchable. Deleting it would delete the ruling. The mechanism it
describes ("a non-positional single-target clause still routes through `undefined`") is verified by
the function's own `(string | undefined)[]` return and its ternary tail.
ACTION: kept (keeper issue ref + owner ruling). Untouched.

### effectiveStats.ts:44-45 [pending-claim]
CLAIM: "Base only — defensePenetration BUFFS fold via toDotAndPenModifiers, NOT through
foldActorBuffTotals, so a consumer must add the pen-buff term separately."
EVIDENCE: present-tense contract about which fold owns the channel; consistent with
`effectivePen`'s own doc ("base + base pen-buff + modifier pen + ability-DoT pen"). Regex matched
"NOT through".
ACTION: kept (legitimate contract) — finder false positive.

### effectiveStats.ts:288 [pending-claim]
CLAIM: "toDotAndPenModifiers(abilitySelfEffects, []).dotDamageModifier — self Out. DoT, for
dotMult."
EVIDENCE: a one-line statement of where the field comes from.
ACTION: kept (legitimate contract) — finder false positive.

### exposedStatus.ts:23-54 [history-claim]
CLAIM: "This function is the READ half **and is unchanged by that ruling**"; "A manually selected
DPS-mode `Exposed` arrives always-active on the scheduled channel and **used to amplify EVERY
direct hit** of the battle by +100%, which contradicts the status's own text; **it is now INERT
instead**".
EVIDENCE: read carefully as the brief asked — this is NOT a mechanic description. It is a
before/after pair ("used to ... it is now INERT instead"). The MECHANIC (`exposedIncomingPct` reads
only `timedAbilityStatuses('enemy', undefined, victimId)`, so a scheduled always-active Exposed
contributes nothing) is unchanged and preserved.
ACTION: rewritten present-tense ("is therefore INERT — amplifying EVERY direct hit ... would
contradict the status's own text"). The LOCKED 2026-08-10 owner ruling, the dropped-channel
explanation and the corpus-applier note are untouched.

### highestAttack.ts:1-13 [history-claim]
CLAIM: "#407: the `isLiving` predicate parameter was REMOVED. ... asking the same question at four
separate sites is exactly how `mostBuffsAmong` ended up as the one site that forgot to ask it, and
let a buffed corpse win a purge selection 1086 times."
EVIDENCE: judgement call per the brief. The live rule ("liveness is not this function's question;
callers pass a roster already narrowed by `aliveTargetsOf`, which is THE one gate") is a real
contract and a pointer to the one place the rule lives. The removed-parameter archaeology, the
site count and the 1086 measurement are class 1/2.
ACTION: rewritten. **`#407` kept as a keeper issue ref**, now attached to the live rule rather than
to the removal. Ties-resolve-first claim re-verified (`atk > bestAtk`).

### incomingEffects.ts:54-66 [history-claim]
CLAIM: "#363 follow-up (item 5) ... `incomingAbilitiesById`'s ally-scoped fan-out pass **used to**
dedupe on OBJECT IDENTITY ... **Not reachable today** (the per-actor OWN-abilities pass already
guards the one known path ...)".
EVIDENCE: the live rule is "dedupe on `id`, not identity, because two runtimes can hand back
distinct objects for one ability and `incomingReductionForHit` sums". The old-implementation
narrative and the reachability claim are class 1/2 (and the reachability claim is exactly the kind
that expires silently).
ACTION: rewritten (rule kept and stated positively, history and reachability claim deleted).

### incomingEffects.ts:72-98 [history-claim]
CLAIM: "#363 follow-up"; "a dozen call sites across the engine"; "BYTE-IDENTICAL FOR THE
SELF-SCOPED FAMILY (Iridium, Anemone, Wusheng, Panon, Tormenter, Voron)".
EVIDENCE: the owner ruling with its in-fight Fuying/Anjian example, the WHY-IT-LIVES-HERE argument,
the team-symmetry note and the LIVE-NOT-CAPTURED note are all live and verifiable. The call-site
count and the six-ship enumeration are class 2; "byte-identical" is diff justification for a
statement that is really "self-scoped entries are unaffected".
ACTION: rewritten ("a dozen" → "many"; "BYTE-IDENTICAL FOR THE SELF-SCOPED FAMILY (six ships)" →
"INERT FOR SELF-SCOPED ENTRIES"; everything else kept).

### log/buildCombatLog.ts:20-44 [pending-claim]
CLAIM: the display-rank doc; regex matched "not yet printed" inside the worked log example.
EVIDENCE: the example is a rendering of the un-sorted output, not a pending-work note. One clause
did read as history ("That is why the attack line landed last") for a sort that is present in the
code.
ACTION: rewritten (that one clause present-tensed: "Without this sort the attack line renders
last"). Rest kept — verified against `routeReaction`/`setHp`.

### log/buildCombatLog.ts:881 + :883 [history-claim, workstream-label]
CLAIM: "This used to key the target as `actorId` too, on a stale 'no per-victim breakdown on the
event' comment (**victimId has been required since Wave 5 C2**), so a bomb Ruiner planted on
Heliodor rendered as 'Ruiner → Ruiner'."
EVIDENCE: `targets: [{ targetId: e.victimId, amount: e.damage }]` — the current keying is the
contract. The rest is a change narrative citing a dead workstream label.
ACTION: rewritten (contract + the Ruiner/Heliodor illustration kept as a counterfactual; history
and `Wave 5 C2` deleted).

### log/buildCombatLog.ts:945-951 [history-claim]
CLAIM: "@param roster Actor roster — maps actorIds to name/side. **Used to** filter dummy actors."
EVIDENCE: "Used to filter" is present tense ("is used for filtering"), not history — the finder
matched the string "used to". And it is TRUE: `rosterIds` gates `turn-started`
(buildCombatLog.ts:490 `if (!ctx.rosterIds.has(e.actorId)) return;`) and the attack-row override
(:435 `!ctx.rosterIds.has(ctx.openAttackAbilityTargetId)`), which that site's own comment describes
as the vestigial-sink case.
ACTION: kept (legitimate contract) — finder false positive.

### log/types.ts:6 [pending-claim] — **FALSE**
CLAIM: "round-end-drained entries with no enclosing turn (**filled by a later task**)".
EVIDENCE: `endOfRound` is filled and rendered. Writers: `buildCombatLog.ts:258`
(`ctx.currentRound.endOfRound.push(entry)`) and `:299` (`round.endOfRound.push(entry)`). Readers:
`RoundEventLog.tsx:355` (`round?.endOfRound ?? []`), `audit/fingerprint.ts:27` and `:104`, plus
assertions in `buildCombatLog.test.ts:1684-1686`.
ACTION: rewritten as a present-tense contract. **WAS FALSE.** (The descriptive half was already
true; only the parenthetical lied.)

### log/types.ts:65 [pending-claim] — **FALSE**
CLAIM: "reactions triggered BY this entry (**filled by a later task; [] for now**)".
EVIDENCE: populated and consumed. Writer: `buildCombatLog.ts:287` `trigger.reactions.push(entry)`
inside `routeReaction` (reached from `attachEntry`). Readers: `audit/fingerprint.ts:52`/`:104`
recurse `e.reactions`, `buffGranterAttribution.integration.test.ts:31`, and
`buildCombatLog.test.ts` asserts non-empty `.reactions` at :1547, :1608, :1739, :1904, :1977,
:2022, :2262, :2317, :2456.
ACTION: rewritten as a present-tense contract naming `routeReaction`. **WAS FALSE** — exactly the
`chargeBefore`/`chargeMax` shape PR #457 found.

### log/types.ts:94-105 [history-claim]
CLAIM: "Heal rows **used to** render the GROSS ... shield rows rendered post-cap growth ...
Opposite failures of one missing clause. Both kinds **now** report the landed number".
EVIDENCE: the live rule (`amount` is the LANDED number for both grant kinds; the waste rides in
`overheal`/`overshield`) is already stated by `amount`'s own doc immediately above. The rest is the
before/after of #418's follow-up.
ACTION: rewritten (rule kept, before/after narrative deleted; `#418` and the `#362` reversed-repair
carve-out kept).

### positionalBinding.ts:68-97 [history-claim]
CLAIM: "so the gate went positional, selection found nobody, ... the cast's damage landed in
NEITHER channel and vanished"; "'nobody carries a position' is **no longer** a usable signal";
"Keeping the two predicates distinct is therefore still live, **not merely historical**".
EVIDENCE: all the substance verified — `isTargetableRosterMember` is `position !== undefined &&
stats.hp > 0`; `withTargetableHp` (normalizeRoster.ts:136) floors max HP to
`MIN_TARGETABLE_MAX_HP` and is enemy-side only, with normalizeRoster's own doc stating the same
divergence from the other direction. Only the tense was archaeological.
ACTION: rewritten present-tense. Tripwire test pointers kept (policy: name the tripwire).

### preFight/squadLeaderPass.ts:111-116 [history-claim]
CLAIM: "(the engine consumes every mapped channel **since PR F3** — unmapped channels stay
unsimulated)".
EVIDENCE: `PR F3` is dead vocabulary. The "engine consumes every mapped channel" half cannot be
verified from nearby code (it is a claim about consumption sites spread across engine.ts, which
this agent does not own) — so, per delete-first, it is not restated. What IS verifiable here is the
mapping itself: `MODIFIER_FIELD_BY_CHANNEL` (squadLeaderPass.ts:61) is the `Partial<Record<
SquadLeaderModifierChannel, keyof PreFightCombatModifiers>>` the branch consults.
ACTION: rewritten to point at `MODIFIER_FIELD_BY_CHANNEL`; the unverifiable engine-consumption
claim and `PR F3` deleted.

### state.ts:172-175 [history-claim]
CLAIM: "ORed at the engine.ts read sites with the timed `Rogue's Liberty` buff (rogueLiberty.ts) —
this field alone is **no longer** the resolver's effective input."
EVIDENCE: verified — `engine.ts:8911` and `engine.ts:9469` both compute
`actor.ignoresForcedTargeting || holdsRoguesLiberty(statusEngine, actor.id)`. Only "no longer"
was archaeological.
ACTION: rewritten present-tense ("so this field alone is not the resolver's effective input").

### state.ts:198 (not a finder hit)
CLAIM: "Pre-fight combat-modifier baseline (sub-project F, **PR F3**)".
EVIDENCE: `PRn` is explicitly in the dead-vocabulary removal list.
ACTION: rewritten (label deleted, everything else kept).

### thresholdShield.ts:3-19 [pending-claim]
CLAIM: "Fires when ALL hold: (a) ... `isDirect`; (b) the ability has **not yet** fired this battle
— `!alreadyFired(ability.id)`; (c) a downward crossing ..."; "The caller applies the max-HP pool
cap and records the once-per-battle fired flag."
EVIDENCE: verified against the body — `if (!isDirect) return null;`, `if (alreadyFired(ability.id))
continue;`, `if (currentHp >= threshold && wouldBeHp < threshold)`, grant = `cfg.flatAmount +
effectiveAttack * (cfg.attackPct / 100)`, and the function is pure (no cap, no flag write).
ACTION: kept (legitimate contract) — known finder false positive; the regex matched "not yet".

### victimDamage.ts:147-167 [history-claim]
CLAIM: "NO PRODUCTION CALLERS, DELIBERATELY KEPT. Its pre-mitigation sibling
(`victimHitDamagePreMitigation`) was deleted for exactly that reason ... it is the `.damage`-only
façade **a dozen unit tests** are written against (`victimDamage.test.ts`,
`positionalApply.test.ts`) ... so it cannot drift from the parts helper **the way the hand-copied
pre-mitigation twin did**."
EVIDENCE: NO-PRODUCTION-CALLERS is TRUE — every `victimHitDamage(` call expression outside its own
definition is in `__tests__/` (`victimDamage.test.ts`, `perVictimDefenseDebuff.test.ts`,
`positionalScalars.test.ts`); production files only mention it in prose. But the named test list is
already WRONG: `positionalApply.test.ts` exists and does NOT call it, while
`perVictimDefenseDebuff.test.ts` and `positionalScalars.test.ts` do — a class-2 enumeration that
already went stale.
ACTION: rewritten (the no-production-callers contract and the delete-with-the-tests instruction
kept; the count, the stale file list and the deleted-twin history deleted).

---

## FALSE COMMENTS FOUND

Four comments were actively lying, not merely stale:

1. **`log/types.ts:65`** — `reactions` "(filled by a later task; [] for now)". Filled by
   `buildCombatLog.ts:287` (`trigger.reactions.push(entry)` in `routeReaction`); recursed by
   `audit/fingerprint.ts:52`/`:104`; asserted non-empty at nine points in `buildCombatLog.test.ts`.
   The precise shape PR #457's `chargeBefore`/`chargeMax` finding had.
2. **`log/types.ts:6`** — `endOfRound` "(filled by a later task)". Written at
   `buildCombatLog.ts:258` and `:299`, rendered by `RoundEventLog.tsx:355`, walked by
   `audit/fingerprint.ts:27`/`:104`, asserted at `buildCombatLog.test.ts:1684`.
3. **`statusEngine.ts:649`** — "Later tasks can seed team-actor maps for team-sourced accumulating
   statuses." They are seeded now: `registerAbilityStatuses` → `getAccumSelf(ownerId)`
   (statusEngine.ts:1637), driven by `engine.ts:568`'s one-call-per-recipient fan-out, and
   `sourceFired` ticks every owner's map under the #436 granter-cadence rule.
4. **`damageReflection.ts:6-8`** (module header, not a finder hit) — "shield is applied at the
   engine seam in a separate task." It is applied: `engine.ts:6899` feeds `reflectedDamageParts`'
   output into `applyVictimDamage`, which calls `shieldAbsorb` at `engine.ts:6636`.

Two further blocks carried enumerations that had ALREADY gone stale (false in detail, not in
thesis) and are recorded above rather than here, since the sentence's claim survived the fix:

- `victimDamage.ts:151-153` — names `positionalApply.test.ts` as a caller; it is not one. The real
  callers are `victimDamage.test.ts`, `perVictimDefenseDebuff.test.ts`, `positionalScalars.test.ts`.
- `audit/fingerprint.ts:53` — "EIGHT log-entry handlers"; the file's own next paragraph says "ONE
  handler is not among those", and several handlers deliberately never consume the tag.

## FLAGGED FOR OWNER

**None.** No block in these 18 files made a behaviour claim that contradicted the code. Every
claim checked (the `removeNewestFirst` skip/order/store contract including the `'permanent'` and
`UNREMOVABLE_STATUSES` guards and the absence of a Buff Protection holder-guard at that layer;
`thresholdShield`'s three fire conditions; `state.ts`'s `Rogue's Liberty` OR; `positionalBinding`'s
enemy-side-only HP floor and the surviving player-side divergence; `victimDamage`'s
no-production-callers; `highestAttack`'s tie rule; `buildCombatLog`'s roster filtering;
`exposedStatus`' single-channel read) was verified accurate against the code it sits on.

The four FALSE comments above were all class-1 wiring/pending claims — the code had moved past the
comment, not away from it — so rewriting them to name the real writer/reader was safe and no owner
ruling is needed.

## Deliberately kept (finder hits, no edit)

`statusEngine.ts:1335-1341` · `buffTotals.ts:205` · `debuffRecipients.ts:4-41` (owner ruling)
`effectiveStats.ts:44-45` · `effectiveStats.ts:288` · `log/buildCombatLog.ts:945-951`
`thresholdShield.ts:3-19`

## Residual, out of scope (not finder hits, other agents may own the same pattern)

`byte-identical` survives as diff justification in ~14 unflagged blocks across `statusEngine.ts`,
`effectiveStats.ts`, `victimDamage.ts`, `state.ts`, `debuffRecipients.ts` and
`positionalBinding.ts` (e.g. `statusEngine.ts:709` "→ byte-identical to the old singular
enemyMap", `effectiveStats.ts:252` "byte-identical to the prior effectiveStatsOf-based
implementation"). It is not in the sweep's dead-vocabulary list and the finder's regexes do not
match it, so it was left alone — but it is the same policy class 1 as `pre-Task-N`, and the
orchestrator may want a follow-up pass across all 21 files rather than a per-agent decision.
