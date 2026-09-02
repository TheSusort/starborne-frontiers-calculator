# notes-residue.md — the remainder sweep

The residue pass over the blocks the earlier finder's `SP-\d` regex could not see, plus the whole
`byte-identical` / `zero-churn` diff-justification class that two agents independently reported as
a gap. Scope: `triggers.ts` (37), `playerTurn.ts` (37), `statusEngine.ts` (12), and 21 small
`src/utils/combat` modules (31) = **117 candidate blocks**. `engine.ts` was never opened.

ACTION values: `rewritten`, `deleted`, `kept (legitimate contract)`,
`kept (earlier pass's deliberate keep)`, `FLAGGED FOR OWNER`.

**Headline: zero `workstream-label` and zero `count-enum` hits in these files.** The dead-label
vocabulary (`SP-U`, `SP-M`, `Sub-project I`, `H1 T4`, `W3`) does not appear here — the earlier
passes had already stripped it. What the fixed finder surfaced in these 21 files is almost entirely
the `byte-identical` tail class the earlier notes had explicitly deferred
(`notes-playerTurn.md` "RESIDUAL, deliberately not swept" ≈35 tails;
`notes-statusEngine-small.md` "Residual, out of scope" ≈14 tails). Those deferrals were this
pass's mandate and are now discharged.

**Oracle negative control (performed):** mid-run, `export const __probe = 1;` was appended to
`healAmplification.ts`. `tokenOracle.mjs --base origin/main` reported **RED, exit 1**, naming the
first divergence at token 249 (`ExportKeyword :: export`). The probe line was removed by text edit
(never `git checkout`/`restore` — `engine.ts` is dirty in this worktree with another agent's work)
and the oracle returned **GREEN**. All 17 touched files were then re-checked together: **17 files
GREEN, 17 CHECKED, 0 SKIPPED.**

---

## Sorting rule applied to `byte-identical`

The finder's one regex covers three different things; each was sorted before editing:

- **(a) change-vs-past** ("byte-identical to the old singular enemyMap", "goldens stay
  byte-identical", "identical to the pre-restructure behaviour") — policy class 1. Tail deleted or
  the sentence restated present-tense. This is the overwhelming majority.
- **(b) present-tense determinism contracts** ("same seed produces a byte-identical input", "two
  runs must be byte-identical") — these describe what the code DOES. **Kept.**
- **(c) present-tense equivalence between two LIVE paths** — the equivalence is load-bearing, so
  the trigger word was reworded rather than the claim deleted.

---

## triggers.ts — 37 candidates → 27 touched, 10 kept

### Rewritten (class (a) tail deletion), field docs on `IntentExecContext`
`1721` `genericDoTEntries` · `1783` `isActorAlive` · `1787` `nameByActorId` · `1795`
`selfNamedBuffsFor` · `1810` `healing` · `1837` `selfShieldFullFor` · `1862` `factionOf` · `1888`
`wasHitThisRoundFor` · `1896` `enemiesHitThisCastFor` · `1967` `reactionFiredThisAttack` · `1978`
`procDecisionThisSubAttack` · `1997` `affinityOf` · `2003` `liveDebuffLandingChanceFor`.
Each carried a `→ byte-identical` / `byte-identical to before` / `byte-identical to the pre-#396
behaviour` tail on an otherwise-live "Absent → X" contract. Tail deleted; the Absent-behaviour
contract kept verbatim. ACTION: rewritten.

Two needed more than a snip:
- `1721` `genericDoTEntries` also carried a corpus CENSUS ("no existing DoT carries a `family`
  tag"). Verified still true (`grep -rn "family:" src` finds no non-test writer), but a census is
  class 2 — stale by construction — so delete-first applied: the field doc now reads
  "Optional: absent → `[]`, so the derived family map is `{}`", which is self-evident from the
  code. ACTION: rewritten.
- `1997` `affinityOf`: "byte-identical for single-opponent fixtures" is really an equivalence
  claim, not a diff claim → "which is the same answer for a single-opponent fixture".
  ACTION: rewritten.

### `514` — `isSameSideAlly`
CLAIM: "For the player registration (opposing = enemy-side) this is byte-identical to the old
pattern." Diff justification whose substance is a team-symmetry fact.
EVIDENCE: `isOpposing` is a per-registration argument (`triggers.ts:459` in the args interface,
destructured at `:505`); `:716` already says "player registration's isOpposing = enemy side; enemy
registration's = player", and `:1107` / `:1287` state the same symmetry.
ACTION: rewritten to the present-tense symmetry contract.

### `2477` / `2481` / `2484` / `2488` / `2491` — the `buildDrainContext` default cluster
Five sibling comments each ending "…and stay byte-identical". Tail deleted from all five; each
keeps its live "Default X → DPS / no-delegate paths read Y" contract. The `turnsTaken` one keeps
its parenthetical (the evaluator's `t<=0` guard). ACTION: rewritten ×5.

### `475-495` — `footprintAllyIdsFor` (class (c))
CLAIM: "Pass-through, byte-identical to `footprintFilteredRecipients`'s handling of the same
resolver — and required by the owner ruling recorded at `supportRecipients.ts`".
EVIDENCE: this is a LIVE equivalence between two current code paths (`footprintFilteredRecipients`
exists, 11 mentions in this file), and it carries the 2026-08-21 owner ruling. Deleting it would
lose a ruling pointer.
ACTION: rewritten — "the same handling `footprintFilteredRecipients` gives the same resolver".
Owner ruling and date untouched.

### `2866-2916` — `liveHealChannelPct`'s doc
Three edits inside one block: the "byte-identical to the pre-#396 behaviour" degradation clause
(tail deleted, "an un-threaded caller loses the shadowing rather than getting it wrong" kept); "They
cancel for a fast applier exactly as before" → "They cancel for a fast applier"; and the class-2
count "7 of the 8 corpus `Inc. Repair Down` appliers" → "nearly every corpus … applier" (counts are
stale by construction — deleted rather than recounted). ACTION: rewritten.

### `2932` / `3689` / `3855` / `4080` / `4397` / `4442` / `5237` — inline tails
All class (a). `2932` restated present-tense (the un-threaded caller loses shadowing, not "is
byte-identical to the pre-#396 value"). `3855`'s "so every existing (procChance-less) buff grant
stays byte-identical" → "so a procChance-less buff grant is never gated". `4080`'s "Existing
appliers use counterTargetId → identical" → "which resolves via counterTargetId". The rest are
plain tail deletions. ACTION: rewritten ×7.

### Kept — triggers.ts (10 remaining `blocks.mjs` hits)
| block | classifier | why |
| --- | --- | --- |
| `205-208` | history-claim | "Used to key the debuff branch's oncePerRoundPerEnemy cap" = "is used to". ACTION: kept (legitimate contract). |
| `464-466` | history-claim | "Used to gate requireDamagedAllyAdjacent reactions" — `notes-triggers.md` Group C. ACTION: kept (earlier pass's deliberate keep). |
| `475-495` | pending-claim | matches on "unwired" inside a present-tense conservative-gate rationale. Body rewritten above; the block stays a hit. ACTION: kept (legitimate contract). |
| `844` | history-claim | "The trigger's NAME is a misnomer since #444 … deliberately NOT renamed: the string is an `Ability.trigger` value and configs can be persisted." ACTION: kept (earlier pass's deliberate keep). |
| `2279-2320` | history-claim | the OR-run `KNOWN LIMITATION` proof. Matches on "it previously also needed C or D" — a worked hypothetical, not history. ACTION: kept (legitimate contract). |
| `2495` | pending-claim | "a delegate IS wired but this owner has not yet had a turn recorded this combat" — live runtime state. ACTION: kept (earlier pass's deliberate keep). |
| `2551-2560` | history-claim | "Used to populate `enemyBuffNames`" = "is used to". ACTION: kept (earlier pass's deliberate keep). |
| `2663-2667` | history-claim | "Used to populate `selfDebuffNames`" = "is used to". ACTION: kept (earlier pass's deliberate keep). |
| `4459` | pending-claim | "not yet converted, same sourceId" IS the predicate `e.sourceId === allyId && e.family === undefined`. ACTION: kept (earlier pass's deliberate keep). |
| `4855` | history-claim | "a repair no longer COUNTS AS A REPAIR for `on-enemy-repaired`'s own riders" — present-tense behaviour contract with a keeper ref. ACTION: kept (earlier pass's deliberate keep). |

---

## playerTurn.ts — 37 candidates → 30 touched, 7 kept

### Rewritten (class (a) tail deletion) — `PlayerTurnArgs` / `HealingRuntimeCtx` field docs
`241` `recipientIncomingHealAmpPct` · `507` `positionalDetonation` · `681` `selfHpPct` · `703`
`enemyBuffNames` · `727` `selfDebuffNames` · `732` `onHitBreakStasis` · `739` `aoeVictimIds` ·
`748` `positional` · `753` incoming-reduction pair · `761` `rollOutgoingProc` · `783` `preFight` ·
`815` `adjacentAllyIds` · `909` `factionOf`. Same treatment: the "Absent → X" contract kept, the
"byte-identical" / "byte-identical to prior behaviour" tail deleted. Two carried extra content:
`783` "Absent → byte-identical" → "Absent → no pre-fight baseline is folded"; `909`'s tail also
carried a corpus census ("which today is every ability but Fuying's Stealth grant") — class 2,
deleted with the tail. ACTION: rewritten ×13.

### Rewritten (class (a)) — inline comments
`125` (pre-restructure) · `1822` · `2006` · `2038` · `2144` · `2987` · `3067` · `3082` · `3163` ·
`3242` · `3515` · `4575` · `4796` · `4887` · `4923` · `5197`. All tail deletions or present-tense
restatements. Notable ones:
- `2144`: "matching the original snapshot() iteration order … so the all-landing golden fixtures
  keep byte-identical list ordering" → "matching snapshot()'s own iteration order …, which the
  all-landing golden fixtures pin". The ordering contract and the fixture pointer both survive.
- `3242`: "so this reads byte-identically to the drain-time gate" → "so this reads the same value
  as the drain-time gate" — a live cross-site equivalence (class (c)), not a diff claim.
- `4923`: "so a legacy single-target run leaves the map empty and every existing golden stays
  byte-identical" → "…leaves the map empty".
ACTION: rewritten ×16.

### `1402` — the `undefined`-sink mapping note
CLAIM: "`?? args.targetId` reproduces the old ternary's `[args.targetId]` tail exactly,
byte-identical for DPS. An earlier draft filtered `undefined` out instead, which silently made a
selector-targeted clause hit NOBODY in DPS mode (caught in review on PR #408)."
EVIDENCE: change history carrying a real rule — the mapped-never-filtered lesson (the same rule
`debuffRecipients.ts` states about its own `undefined` sink).
ACTION: rewritten present-tense — filtering `undefined` out would conflate "no delegate supplied"
with a real "nobody" answer. The `#403 ruling R1` pointer above it is untouched.

### Kept — playerTurn.ts (7 remaining `blocks.mjs` hits)
All seven are the earlier pass's explicit keeps, matched by CONTENT (line numbers drifted):
`163-178` ("the ctx used to fold each group" = "used FOR folding") · `294-305` (the deferred-write
`applyState`/`emitEvents` contract) · `1679` ("no longer in scope there" — present-tense reason the
filter rides the STATUS not the ability) · `2168` (what has been folded at this point) · `2845`
(the `modifierCtx` → `mod.hp` → `dmgStats.hp` circular-dependency ordering) · `3350` (a
sequence-point contract vs `applyNewDoTs`) · `4286` (the inflicted-scope design rule).
ACTION: kept (earlier pass's deliberate keep) ×7.

---

## statusEngine.ts — 12 candidates → 10 touched (+1 unflagged), 2 kept

### Rewritten (class (a))
`37` `buffDurationExtensionFor` · `77` `factionFilter` · `139` `hits` · `545`
`DEFAULT_ENEMY_TARGET` · `709` `enemyMaps` · `1280` `consumeTimedEnemyStatusStack` · `1706`
routing note · `1791` `appliedThisTurn` · `1908` divergence gate. Tails deleted; every "Absent → X"
and store-routing contract kept. Two restated rather than snipped:
- `1280`: "byte-identical to removeTimedEnemyStatus for such entries" → "the same outcome
  removeTimedEnemyStatus gives such entries" (class (c) — a live equivalence between two current
  functions).
- `1908`: "(a) byte-identical for every status nothing has spent from" → "(a) inert for every
  status nothing has spent from". The Exposed reachability argument below it is untouched.

### `692` — the scheduled-enemy accum contribution
CLAIM: "Scheduled enemy debuffs ride the attacker's cadence (pre-#436 semantics). Under the uniform
granter rule this is byte-identical: the old code ticked EVERY enemy map when sourceId ===
'attacker', and only this map is ever seeded."
EVIDENCE: pure archaeology wrapped around one live fact, verifiable two lines below
(`contributions: [{ granterId: 'attacker', … }]`).
ACTION: rewritten — "Scheduled enemy debuffs ride the attacker's cadence: one `'attacker'`
contribution under #436's uniform granter rule, and this is the only enemy accum map ever seeded."

### `542` — **a comment that outlived its subject** (not a finder hit)
CLAIM: "cadences are reported, not computed (the old computeChargeSchedule path is retired)."
EVIDENCE: `grep -rn "computeChargeSchedule" src` finds NO symbol — only three prose mentions
(this one and two in test files). The parenthetical points a reader at a function that does not
exist.
ACTION: deleted (the parenthetical only). "It predicts nothing — cadences are reported, not
computed" is the live contract and stays.

### Kept — statusEngine.ts (2 remaining `blocks.mjs` hits)
- `1324-1330` `consumeStatusHit` — the `selfMaps.get` vs `getSelfMap` allocation rationale.
  ACTION: kept (earlier pass's deliberate keep, listed as `1335-1341` there).
- `1347-1368` `removeNewestFirst` — "accumulating entries that are still inert (`stacks <= 0` or
  `appliedSeq` not yet stamped)" is a present-tense predicate, not pending work; the earlier pass
  verified this whole skip/order/store contract against the code.
  ACTION: kept (legitimate contract).

---

## Small modules — 31 candidates → 20 touched, 11 kept

### Rewritten (class (a) tail deletion)
- `audit/kitFingerprintScenarios.ts:332` — "kept for the 147-ship fingerprint snapshot's
  byte-identical call shape" → "the call shape the fingerprint snapshot uses". The `147` count went
  with the tail (class 2); the `realKitFingerprints.test.ts` pointer stays.
- `debuffRecipients.ts:76` — "byte-identical DPS output for every kit" tail deleted; the ruling-R1
  fork and the "same fork, same reason" pointer stay.
- `healAmplification.ts:16` and `outgoingEffects.ts:19` — "Returns 0 when nothing applies →
  byte-identical with no such equipment" → "Returns 0 when nothing applies (no such equipment)".
  Also fixed `healAmplification`'s pre-existing 104-char line.
- `positionalApply.ts:289 / :307 / :318 / :325` — four hook docs; each "Unsupplied → 0 →
  byte-identical" reduced to "Unsupplied → 0", and `:325`'s "an unsupplied hook makes the loop
  byte-identical" → "an unsupplied hook is simply not called".
- `positionalBinding.ts:110` — "the arm the byte-identical goldens pin" → "the arm the golden
  fixtures pin".
- `state.ts:226-228` — tail deleted, **and the dead `(F3)` label removed** from "Pre-fight shield
  seeding (F3)". `SP-F F3` is in the earlier passes' stripped vocabulary; the fixed finder still
  does not match a bare `F3`.
- `supportRecipients.ts:18 / :79 / :102` — three "byte-identical to every pre-#363 caller" /
  "byte-identical for every ability that does not carry one" tails deleted; the conservative
  under-reach-never-over-reach rule kept verbatim at both sites, and the ⚠️ FOUR-vs-ONE wiring
  warning left intact (its counts are self-enumerated and load-bearing to the warning).
- `victimDamage.ts:107` — "Defaults to 0 → byte-identical for the primary target" → "Defaults to 0,
  which is also the primary target's own value (delta is 0 by construction)".
ACTION: rewritten ×13 blocks.

### `damageReflection.ts:92` and `victimDamage.ts:247` — class (c), floating-point associativity
CLAIM: "`damage` above keeps its original operand order and its own locals, so it stays
byte-identical: no fitted constant moves" / "so it stays BYTE-IDENTICAL (no re-association)".
EVIDENCE: the substance is a live FP contract — the mitigated and pre-mitigation products are
written out separately so neither is re-associated or reconstructed by division. That survives the
PR that wrote it; the "stays byte-identical" framing does not.
ACTION: rewritten to state the FP rule directly ("the exact-1 constants appear only here, never
folded into the mitigated product" / "so no floating-point re-association reaches it").

### `lethalHp.ts:78` — "keeps listener timing byte-identical"
ACTION: rewritten — "Real event INLINE for its combat listener (Yazid on-cheat-death-activated), so
the listener fires at this point in the sequence." The LOG-ONLY-twin pointer stays.

### `effectiveStats.ts:238-256` — `liveDebuffLandingChance`
CLAIM: "A missing hacking base defaults to 200 and a missing security base to 100 — the values the
old static formula (dpsSimulator) baked … for a base-PRESENT actor this is byte-identical to the
prior effectiveStatsOf-based implementation."
EVIDENCE: the defaults are not historical — `src/utils/calculators/dpsSimulator.ts:551-552` applies
`input.hacking ?? 200` / `input.enemySecurity ?? 100` TODAY, and the doc's own opening line already
says "Mirrors the dpsSimulator setup formula exactly".
ACTION: rewritten to present tense, naming the live expressions; the diff-comparison tail replaced
by the actual result ("a base-PRESENT actor resolves to base + hackingBuff").

### `debuffImmunity.ts:73-84` — `emitBlockDebuffResist`
CLAIM: "The doc that stood here said 'Call ONLY on the block path … (byte-identical)', and that
stopped being true: `playerTurn`'s `else if (dotsConfig.length > 0)` branch — the LANDING-ROLL
FAILURE arm — calls it too."
EVIDENCE: the ⚠️ and the `viaLandingRoll` caller contract are live and match the locked
resist-cause ruling, but the narrative is archaeology AND its branch label was wrong: verified in
`playerTurn.ts`, `else if (dotsConfig.length > 0 && targetImmuneToDebuffs)` is the BLOCK arm
(passes `false`, `:3874`) and the trailing `else` that draws `roundDebuffLanded` is the
landing-roll-failure arm (passes `true`, `:3934`).
ACTION: rewritten — the contract asserted directly and the branch named correctly ("the `else` that
draws `roundDebuffLanded`"); the stood-here narrative deleted.

### `targetableActors.ts:3-62` — the biggest single rewrite
CLAIM: an 18-line "BLAST RADIUS, MEASURED HONESTLY" section (1263 / 4 / 24 / 172 / "596 files,
6705 tests" / "byte-identical across this change" / "an earlier draft of this comment made exactly
that mistake"), plus a "Before it, liveness was asked FOUR separate times and one of the four
forgot" history opener.
EVIDENCE: every number is a measurement of one PR's diff — class 1 and class 2 together. The
surviving true statements are (i) liveness is asked here and nowhere else at the selector layer,
(ii) the golden suite does not observe this gate and
`aliveSelectorTarget.integration.test.ts` is the only test that does (file verified to exist), and
(iii) the `currentHp` conjunct catches `stats.hp === 0` actors that the death filter alone lets
through. All three restated present-tense, with the in-fight Curator/Rhodium example and the
"coverage, not inertness" caveat preserved.
**Owner rulings R1, R2 and R3 — including "do not add a stealth conjunct here and do not file a
follow-up for it" and "Do not collapse the two into one" — and the WHAT THIS IS NOT FOR paragraph
were left byte-for-byte.**
ACTION: rewritten.

### Kept — small modules (11 remaining `blocks.mjs` hits)
| block | classifier | why |
| --- | --- | --- |
| `audit/compose.ts:150-167` | diff-justification | class (b): "same seed + corpus produces a byte-identical `BattleSimulationInput`" is the purity/determinism contract this function exists to promise. ACTION: kept (legitimate contract). |
| `audit/fingerprint.ts:48-85` | history-claim | matches on "it can no longer lose it to a SIBLING attack row" — present-tense description of what the latch buys. The stale EIGHT-handlers count was already fixed by the earlier pass. ACTION: kept (legitimate contract). |
| `audit/reproducibility.ts:5-7` | diff-justification | class (b): "Two runs of the same (input, seed) must be byte-identical" IS the invariant under test. ACTION: kept (legitimate contract). |
| `buffTotals.ts:197` | pending-claim | ACTION: kept (earlier pass's deliberate keep, listed as `205`). |
| `debuffRecipients.ts:4-41` | history-claim | the #343 "dummy sink" vocabulary note — the earlier pass kept it on an explicit OWNER RULING that past-tense references to the deleted actor stay searchable. ACTION: kept (earlier pass's deliberate keep). |
| `effectiveStats.ts:44-45` | pending-claim | "a consumer must add the pen-buff term separately" — a present-tense caller obligation. ACTION: kept (earlier pass's deliberate keep). |
| `effectiveStats.ts:288` | pending-claim | ACTION: kept (earlier pass's deliberate keep). |
| `incomingEffects.ts:69-95` | history-claim | matches on "whose OWNER is no longer alive" — the #363 owner ruling itself, with its in-fight Fuying/Anjian example and the LIVE-NOT-CAPTURED contract. ACTION: kept (legitimate contract). |
| `log/buildCombatLog.ts:20-43` | pending-claim | matches on "killed by an attack not yet printed" — text INSIDE the worked example log the sort exists to fix. ACTION: kept (legitimate contract). |
| `log/buildCombatLog.ts:942-948` | history-claim | "Used to filter dummy actors" = "is used to". ACTION: kept (earlier pass's deliberate keep, listed as `945-951`). |
| `thresholdShield.ts:3-19` | pending-claim | "(b) the ability has not yet fired this battle" — the README's own named canonical false positive. ACTION: kept (legitimate contract). |

---

## FALSE COMMENTS FOUND

Two, both verified by grep before rewriting. Neither is a wiring/"nothing reads it yet" claim —
the earlier passes had already cleared that class out of these files.

### 1. `statusEngine.ts:542` — a pointer to a symbol that no longer exists
CLAIM: "cadences are reported, not computed (**the old computeChargeSchedule path is retired**)."
EVIDENCE: `grep -rn "computeChargeSchedule" src` returns three hits and **none is a declaration or
a call** — this comment, `__tests__/statusEngine.test.ts:31`, and
`calculators/__tests__/dpsSimulator.test.ts:416`. The function is gone. An agent following the
pointer finds nothing and cannot tell whether it is looking at a rename, a deletion, or its own bad
grep.
ACTION: deleted (the parenthetical). The live contract "It predicts nothing — cadences are
reported, not computed" stays.

### 2. `debuffImmunity.ts:76-77` — a branch label that does not match the code
CLAIM: "`playerTurn`'s **`else if (dotsConfig.length > 0)` branch** — the LANDING-ROLL FAILURE arm
— calls it too."
EVIDENCE: `playerTurn.ts:3866` is `} else if (dotsConfig.length > 0 && targetImmuneToDebuffs) {` —
that is the **Block-Debuff** arm, and it passes `viaLandingRoll: false` (`:3874`). The
landing-roll-failure arm is the trailing `} else {` that draws `roundDebuffLanded`, and it passes
`true` (`:3934`). The comment names the wrong arm for its own thesis, so a reader following it
would tag the auto-resist arm as the rolled one — the exact inversion `#413`'s `viaLandingRoll`
gate exists to prevent, and the inversion the locked resist-cause rule turns on.
ACTION: rewritten to name the arm by what it does ("the `else` that draws `roundDebuffLanded`").
The thesis itself was TRUE and is preserved.

---

## FLAGGED FOR OWNER

**None.** No block in this residue made a behaviour claim that the surrounding code contradicts.
The two false comments above are both POINTER defects (a dead symbol, a mislabelled branch) whose
underlying claims are correct once the pointer is fixed, so no owner ruling is needed.

The one standing owner flag in these files is `notes-triggers.md`'s Adaptive Plating
`oncePerRound` contradiction at `triggers.ts:172-174`. It was left **byte-for-byte untouched**
again this pass, as that note instructs.

---

## Residue status

`blocks.mjs` after this pass — every remaining hit is named above as a keep, with its reason:

| file | before | after | all remaining accounted for |
| --- | --- | --- | --- |
| `triggers.ts` | 37 | **10** | yes — 10 keeps |
| `playerTurn.ts` | 37 | **7** | yes — 7 keeps |
| `statusEngine.ts` | 12 | **2** | yes — 2 keeps |
| 21 small modules | 31 | **11** | yes — 11 keeps |
| **total** | **117** | **30** | **30 keeps, 87 blocks touched** |

The residue is closed: the remaining 30 are legitimate contracts (or class-(b) determinism
promises) that the finder matches on a trigger word, and each is recorded here rather than silently
skipped.

Files touched (17, all GREEN on `tokenOracle.mjs --base origin/main`, 0 skipped):
`triggers.ts` · `playerTurn.ts` · `statusEngine.ts` · `audit/kitFingerprintScenarios.ts` ·
`damageReflection.ts` · `debuffImmunity.ts` · `debuffRecipients.ts` · `effectiveStats.ts` ·
`healAmplification.ts` · `lethalHp.ts` · `outgoingEffects.ts` · `positionalApply.ts` ·
`positionalBinding.ts` · `state.ts` · `supportRecipients.ts` · `targetableActors.ts` ·
`victimDamage.ts`.

`src/utils/combat/engine.ts` was **never opened** — it belongs to a parallel agent and shows dirty
in this worktree for that reason.

### Prose repairs made while reading the diff
The oracle is blind to comment content, so the whole diff was read. Repaired: a duplicated word
introduced at `playerTurn.ts:3064` ("the RNG schedule stays / schedule unperturbed"), a stranded
short line at `playerTurn.ts:124`, and ragged wraps left by tail deletion at `triggers.ts` (×4),
`supportRecipients.ts` (×1) and `targetableActors.ts` (×1). One PRE-EXISTING over-width line was
fixed as a side effect (`healAmplification.ts:16`, 104 chars). No added line exceeds
`printWidth: 100`.

> This file is gitignored — it needs `git add -f` to be committed.
