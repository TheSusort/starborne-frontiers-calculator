# Model-Completeness SP-G — Engine Known-Limitations

**Date:** 2026-07-08
**Epic:** Model-completeness (ratified 2026-07-05). SP-G is the **last** content step.
**Predecessors:** SP0 (#230), Curator dup (#231), SP-A+B (#233), SP-C+D (#235), SP-E (#236), SP-F (#237).
**Input doc:** `docs/model-completeness-triage-2026-07-05.md` (SP-G rows) — authoritative reconciliation.
**Fidelity bar (epic-locked):** full runtime-correct. Zero real-gap allowlist deferrals; engine
known-limitations INCLUDED.

## Scope

SP-G closes the six engine-only known-limitation markers left by SP0's triage. They collapse into
**four independent mechanisms** across six ships. Every mechanism has an existing pinned "documentation"
test to flip — **except Butcher**, which has no positional-path test and must have one authored.

| # | Mechanism | Ships | Locus | Existing test |
|---|-----------|-------|-------|---------------|
| G1 | Parser routing of "every turn" / "start of combat N stacks" | Kinetik, Cinya, Meatshield | parser only | `roundBoundaryTriggerConsistency.test.ts` |
| G2 | Start-of-turn grants must apply **before** the owner acts | Cobalt | engine turn-loop | `cobaltStartOfTurnCharge.integration.test.ts` |
| G3 | Reactive shield = 30% of **actual dealt damage** (not flat `attack×24%`) | FrontLine | engine reactive executor + parser build | `enemyChargedCast.integration.test.ts` |
| G4 | on-debuff-inflicted reaction must fire on the **positional/simulateBattle** path | Butcher | investigative (positional reactive wiring) | **NONE — must author** |

### Decisions locked (this brainstorm)

1. **No new recurring-grant primitive.** The roadmap's pre-triage "recurring per-turn grant primitive"
   framing is superseded. Kinetik/Cinya reuse the **existing** `start-of-turn` LIVE trigger; Meatshield
   is a one-time `pre-combat` 3-stack grant. (The "maintain 3 stacks of Protection" behaviour is a
   *different* passive clause = the deferred SP-F Protection-as-damage-transfer work, out of SP-G scope.)
2. **One branch `sp-g/model-completeness`, subagent-driven sequential tasks, one squashed PR.** Three of
   four mechanisms touch `engine.ts` (different regions), so sequential-on-one-branch avoids the
   mutually-conflicting-PRs problem (epic's own lesson) and cleanly closes the last epic step.

## Ship text (source of truth: `docs/ship-skills.csv`)

- **Kinetik** p1/p2: "This Unit gains a Shield equal to 4%/7% of its Max HP **every turn**."
- **Cinya** p1/p2: "This Unit repairs 3.5%/5% of its Max HP **every turn**."
- **Meatshield** p3: "**At the start of combat**, this Unit gains **3 stacks** of Protection."
- **Cobalt** p1: "…**adds 1 charge** to its charged skill **at the start of the turn if it is at full HP**."
  (sibling second_passive: "Out. Damage Up II" start-of-turn buff — the one that alternates today)
- **FrontLine** p2: "…When an enemy uses their Charged skill, it deals 80% and **gains a Shield equal to
  30% of the damage dealt**, once per round."
- **Butcher** p2: "…**On inflicting a debuff, this Unit gains Marauder Rage II for 3 turns.**"

---

## G1 — Parser routing (Kinetik / Cinya / Meatshield)

**Pure parser change. No engine change.** The `start-of-turn` and `pre-combat` triggers already exist
and are consumed correctly by the engine.

### Kinetik / Cinya — "every turn" → `start-of-turn`
- **Gap:** the parser has detectors for "at the start of the round/turn/combat" but **none for a trailing
  "every turn"**, so these shields/heals fall through to `on-cast`.
- **Fix:** add an "every turn" phrase detector (mirror of the existing start-of-X detectors) that routes a
  self-target shield/heal to `trigger: 'start-of-turn'`.
- **Precedent:** the Shield gear set ("generate 4% shield each turn") already maps to `start-of-turn`
  (`buildEquipmentAbilities.ts:136-142`) — Kinetik is the ship-skill analogue.
- **Tests to flip:** `roundBoundaryTriggerConsistency.test.ts` describe *"Kinetik / Cinya: 'every turn'
  … unaffected"* — the two `expect(shield/heal.trigger).toBe('on-cast')` become `'start-of-turn'`.

### Meatshield — "start of combat, 3 stacks" → one-time `pre-combat` 3-stack grant
- **Gap:** currently modelled as an `on-cast` stackable buff with a `stackTrigger` that climbs stacks
  per cast — wrong both in cadence (should fire once) and in mechanism (relabelling alone breaks the
  climb, which is why SP0 deferred it).
- **Fix:** parse this as a `pre-combat` Protection buff granting **3 stacks in one application** (drop the
  per-cast climb for this shape). Verify the buff config expresses a one-shot N-stack grant (`stackCount`
  / initial-stacks) rather than relying on repeated firings.
- **Check:** confirm `pre-combat`-trigger buffs seed at combat start in the engine for a stackable buff
  (Crucialis/IonScorp pre-combat shields + buffs are the precedent; Protection is a stackable status —
  verify the seed applies all 3 stacks at once).
- **Test to flip:** `roundBoundaryTriggerConsistency.test.ts` describe *"Meatshield … DELIBERATELY
  UNCHANGED (deferred)"* — the `expect(buff.trigger).toBe('on-cast')` becomes `'pre-combat'`; adjust the
  stack assertions to the one-shot-3-stacks shape.

---

## G2 — Cobalt start-of-turn ordering (engine turn-loop)

### Root cause (confirmed)
- `start-of-turn` abilities ride `turn-started` and only **enqueue** an intent
  (`triggers.ts:531-537`, self-scoped on `ownerId`).
- The engine emits `turn-started` at `engine.ts:5526`, then runs the cast (`runPlayerTurn` at
  `engine.ts:5839` focus / `6171` walked-team / `6722` enemy), then drains at `engine.ts:7205-7206`.
  **There is no drain between the emit and the cast** (the only earlier drain, `engine.ts:5414`, is a
  once-per-round start-of-round drain, not per-turn).
- So the start-of-turn intent applies **after** the owner's cast. For the sibling 1-turn "Out. Damage
  Up II" buff, Post-Turn decrement (`engine.ts:7217`) then ticks it, so it boosts only the *following*
  turn → the alternating cadence. (The charge half banks within the same round and is already correct —
  the fix must not regress it.)

### Fix
- Add a **pre-cast drain of the acting owner's `start-of-turn` intents**, executed between the
  `turn-started` emit and the `runPlayerTurn` call, scoped to that owner.
- **Team-symmetry is free:** both aggregate (`runCombat`) and positional (`simulateBattle`, a thin
  `runCombat` wrapper — `battleSimulator.ts:41,831`) share this single turn loop and all three
  `runPlayerTurn` call sites. No `battleSimulator.ts` change.

### Risks / constraints
- Must **not** regress the Part 1/Part 2 charge ledger assertions in `cobaltStartOfTurnCharge`.
- Must scope the pre-cast drain to the **acting owner only** (do not drain other owners' queued
  start-of-turn intents early, and do not double-apply at the existing post-cast drain).
- Preserve the existing turn-block semantics (`isTurnBlocked` filter, `engine.ts:5145`) — decide
  consistently whether a stunned owner still receives its start-of-turn grant, matching current
  behaviour unless the game rule dictates otherwise.

### Test to flip
- `cobaltStartOfTurnCharge.integration.test.ts` Part 4 (`it` at line 414): the two pinned alternation
  assertions (`expect(boosted[0]).toBe(control[0])` / `boosted[2]).toBe(control[2])`, lines 423-424)
  flip to `.toBeGreaterThan(control[...])` (every-turn boost).

---

## G3 — FrontLine reactive-shield magnitude (engine reactive executor + parser build)

### Root cause (confirmed)
- The reactive shield is **built** as `{ type:'shield', basis:'attack', pct: (30×80)/100 = 24 }` in
  `skillTextParser.ts` `parseEnemyChargedCastReaction` (lines 2836-2849), with a `KNOWN DIVERGENCE (#211)`
  comment. It fell back to `basis:'attack'` because on the `on-enemy-charged-cast` trigger
  `eventCtx.triggerDamage` is **unset** (`triggers.ts:394-407` only stamps `counterTargetId`).
- The reactive **damage** executor `applyReactiveDamage` (`engine.ts:4021-4104`) computes the mitigated /
  crit `raw` (lines 4076-4099) and only `creditDamage(...)`s it (4103) — the amount is a local never
  written back to any eventCtx.
- The shield executor (`triggers.ts:~2255-2335`) already supports `basis:'damage-dealt'` reading
  `intent.eventCtx?.triggerDamage` (line 2289) → `raw = basisValue × pct/100` (2335). The plumbing exists;
  the dealt amount just isn't threaded onto this trigger.

### Fix
- Thread the reactive proc's dealt amount: have `applyReactiveDamage` stamp its computed `raw` into a
  shared eventCtx slot (`eventCtx.triggerDamage`) that the sibling reactive-shield intent reads.
- Change the built shield to `basis:'damage-dealt', pct: 30` (the true clause), mirroring the standing-leech
  `amount × pct/100` fold (`procStandingLeeches`, `engine.ts:2917-2952`).

### Design fork (the one genuine decision — resolve in the plan)
- The reactive **damage** and **shield** are **separate enqueued intents**. The damage intent must make
  its dealt amount visible to the sibling shield intent. Two candidate mechanisms:
  - **(A, preferred) Stamp:** damage executor writes `raw` to a shared per-owner/per-trigger slot (or a
    shared eventCtx object referenced by both intents from the same drain cycle); shield reads it via
    `basis:'damage-dealt'`. Mirrors the on-crit / Bloodthirst precedent (`triggers.ts:366`).
  - **(B, fallback) Recompute:** shield executor independently recomputes the mitigated amount.
    Rejected unless (A) proves infeasible — duplicates mitigation logic, brittle under crit/affinity.
- Must preserve `oncePerRound` on both halves and the correct victim/`counterTargetId` targeting.

### Test to flip
- `enemyChargedCast.integration.test.ts` describe *"FrontLine damage+shield-on-enemy-charged"*, the `it`
  *"shield magnitude tracks attack (basis attack × 24%)"* (lines 423-448). Re-express to assert the shield
  tracks **actual dealt damage** (defense-mitigated, crit-eligible) rather than a clean `∝ attack`
  proportionality. Update the load-bearing `FRONTLINE_R2` comment (test line 146).

---

## G4 — Butcher positional on-debuff-inflicted (investigative)

### Status
- Butcher p2 reaction (`on-debuff-inflicted` → Marauder Rage II, 3 turns) is **built identically** on both
  channels and **fires correctly on the aggregate path** (Channel-A test 3, `overloadLifecycle.test.ts`
  lines 302-337, passing, with negative control).
- The emit (`playerTurn.ts:2285-2294`, `dot-applied` with `sourceId: actor.id`) and the subscription
  (`triggers.ts:408-415`, enqueue when `e.sourceId === ownerId`) are **shared** by both channels; walked
  owners are registered (`engine.ts:2596-2601`). **No static divergence is visible.**
- Yet SP0 **empirically verified** (throwaway probe) that in a real `simulateBattle` two-team battle, a
  Butcher inflicting Inferno II every round produces a `dot-applied` log entry every round but **never** a
  Marauder Rage II `buff` entry — the reaction silently does not fire positionally. This is a
  team-symmetry violation, but the true root is **not yet identified**.

### Approach (TDD + systematic-debugging — no fabricated fix locus)
1. **Author a new Channel-B `simulateBattle` integration test** in `overloadLifecycle.test.ts`, following
   the Mangler on-kill pattern (`place()` helper line 116; `simulateBattle({playerTeam, enemyTeam, rounds})`;
   `buffActorRounds(r,'Marauder Rage II')` assertion helper line 133). Butcher as `playerTeam[0]`
   (owner `'attacker'`), debuff-inflicting active + `BUTCHER_P2`, `hacking:200` so the debuff lands.
   Assert `buffActorRounds(r,'Marauder Rage II').actors.has('attacker')`. **Confirm it is RED.**
2. **Systematic-debugging** to root-cause on the positional run. Candidate divergences to instrument:
   - the positional `sourceId` on `emitDotApplied` — does it equal Butcher's owner id?
   - the DoT landing gate `dotsLanded` at `playerTurn.ts:2268` — true on the positional run?
   - the enqueue/drain scoping — is Butcher's `on-debuff-inflicted` intent enqueued but never drained on
     the positional side (queue/side scoping)?
3. **Fix at the true root.** The reactive *executor* already works positionally (on-kill Marauder Rage
   surfaces on Channel B), so the divergence is upstream of execution — in the emit/enqueue/drain wiring.
4. **Verify team-symmetric:** the same reaction must fire identically for a Butcher on either side.

### Corpus probe
- `modelCompletenessTriage.test.ts` has **no** Butcher SP-G probe today (the built ability is byte-identical
  on both channels, so there is nothing build-observable to assert). The new Channel-B integration test
  **is** the pin. Add a triage-doc note that the Butcher SP-G marker is satisfied by the new
  positional-path test rather than a corpus `it.fails` flip.

---

## Task ordering (one branch, sequential)

1. **G1 — parser routing** (Kinetik/Cinya/Meatshield). Pure parser, no engine, fully independent → safest
   first.
2. **G2 — Cobalt** pre-cast start-of-turn drain (engine turn-loop).
3. **G3 — FrontLine** reactive-shield dealt-amount (engine reactive executor + parser build).
4. **G4 — Butcher** positional on-debuff-inflicted (investigative; RED test → systematic-debug → fix →
   symmetry). Last, since its fix locus is not yet known.

Low intra-branch conflict risk: G1 is parser-only; G2/G3/G4 touch different `engine.ts` regions
(turn-loop ordering ~5526/7205 · reactive damage executor ~4021-4104 + `triggers.ts` shield branch ·
reactive listener/enqueue wiring).

## Per-task exit criteria

- Flip the task's triage marker(s): the relevant `roundBoundaryTriggerConsistency` /
  `cobaltStartOfTurnCharge` / `enemyChargedCast` assertions, and any `modelCompletenessTriage.test.ts`
  `it.fails` for these ships (Butcher = the new Channel-B test instead).
- `audit:skills` reports **0 findings / 0 stale**; close any allowlist entries for these ships (FrontLine
  reactive-shield-amount and any others present).
- Full-suite-minus-triage green; `tsc` + lint clean.
- Opus per-task review clean; whole-branch opus review "ready to merge" before opening the PR.
- Changelog: add a plain-English `UNRELEASED_CHANGES` entry for the user-visible behaviour changes
  (Kinetik/Cinya per-turn shield/heal, Meatshield start-of-combat Protection, Cobalt every-turn buff,
  FrontLine reactive shield accuracy, Butcher Marauder Rage in team battles).

## Out of scope (unchanged deferrals)

- **SP-F Protection-as-damage-transfer** and the **Meatshield "maintain 3 stacks" / Protection→DoT**
  siblings — deferred to a future SP (mitigation ordering unknown).
- Data-layer / harness FPs that stay allowlisted (innate shield-pen, always-crit, etc.) per the epic's
  carve-out.

## Post-merge

CodeRabbit → `gh auth switch --user TheSusort` → squash-merge → delete remote+local branch, remove
`.worktrees/sp-g`, reset local main to origin/main (keep spec+plan as untracked gitignored docs). Then
**the model-completeness epic is complete** — final memory-prune pass per `feedback_epic_memory_hygiene`.
