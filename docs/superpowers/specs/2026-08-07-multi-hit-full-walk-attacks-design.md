# Multi-hit as N full-walk attacks — design

**Date:** 2026-08-07
**Status:** design approved, pending implementation plan
**Supersedes:** the deferred Class A / Class B items in
`2026-07-24-insidiousness-per-attack-proc-design.md` (both close as NON-BUGS — see §2)

---

## 1. The locked game rules

All three are user-stated and in-game verified on 2026-08-07 (Enforcer's Defense Shred stacks
were observed directly). They are game rules, not modelling choices, and are not open to
re-litigation during implementation.

**R1 — A multi-hit skill is N consecutive FULL-WALK attacks.** Not one attack applied N times.
Each sub-attack independently runs the entire pipeline: target resolution, crit roll, damage
application, debuff landing roll, status application, and reactive emission to *both* sides.

- Enforcer inflicts Defense Shred on critically hitting an enemy. If she crits on every
  sub-attack and every debuff lands, the enemy gains **N stacks** of Defense Shred.
- Cultivator's passive fires **each time** an enemy Enforcer sub-attacks — the incoming side
  sees N genuine arrivals, not one arrival reported N times.

**R2 — Proc granularity follows the direction of the effect.**

- Effects based on **INCOMING** hits resolve **per hit**, unless the text specifies otherwise.
- Effects based on **OUTGOING** hits resolve **per attack** — i.e. per sub-attack — unless the
  text specifies otherwise.
- `on-deal-damage` is bound to **the attack**, not the turn.

**R3 — Multi-hit is not AoE.** Multi-hit is a series of consecutive real attacks, each of which
may strike one or more enemies via the ship's pattern. AoE is ONE attack striking multiple
enemies via the pattern. An AoE footprint shares a single outgoing roll; each multi-hit
sub-attack draws its own.

**Unifying model (user's framing, adopted):** *every* attacking skill is N sub-attacks. Most
skills are N=1; Enforcer is N=3/4. There is no separate "multi-hit path" — the sub-attack loop
is the universal attack path. This is the design's principal risk control: at N=1 every change
below is byte-identical to current behaviour, so churn is bounded to ships with N>1.

---

## 2. What these rules close with zero code

The entire deferred implant-proc backlog is a **non-bug**. Every proc below is INCOMING-driven,
so rolling and applying per hit is correct exactly as shipped:

| Implant | Trigger | Verdict |
| --- | --- | --- |
| Reactive Ward | `on-attacked` | correct — per hit |
| Tenacity | `on-attacked` | correct — per hit |
| Second Wind | `on-attacked` | correct — per hit |
| Smokescreen | `on-attacked` | correct — per hit |
| Adaptive Plating | `on-attacked` | correct — per hit |
| Bulwark | `on-ally-attacked` | correct — per hit |
| Firewall | `on-debuffed` | correct — per occurrence |
| Lockdown | `on-debuff-resisted` | correct — per occurrence |

The July 2026 audit's concern that Reactive Ward / Tenacity / Second Wind were "higher severity
than Insidiousness was" is **unfounded**. Do not reopen. No code changes for any of these.

Also unaffected, because they fire once by construction: Ambush (`start-of-round`), Alacrity and
Doomsayer (`end-of-round`), Fortifying Shroud (`start-of-turn`), Last Stand (`on-ally-destroyed`),
Resonating Fury (`on-shield-applied`), Synaptic Resonance (`on-enemy-repaired`), Martyrdom
(`on-destroyed`), Spearhead (`on-charged-cast`), Font of Power (`on-own-repair-to-ally`), and the
`on-cast` procs (Boost, Ironclad, Shadowguard, Exuberance).

---

## 3. Current engine state

Three layers, in increasing distance from R1.

### Layer 1 — targeting, crit, damage: ALREADY per-sub-attack (positional path)

`positionalApply.ts:222` loops `for (let h = 0; h < scalars.hits; h++)`. Each iteration
re-resolves the anchor against the **live** roster (a victim killed on hit 1 is absent for hit 2)
and re-expands the footprint at `:238`. Loop nesting is **hits × victims**. Crit is drawn per hit
(`hitCrits[h]`), damage per (hit, victim) via `victimHitDamage`.

This layer needs no behavioural change. It is the proof that the full-walk model is already
half-implemented.

### Layer 2 — event emission: FLAT

The engine emits exactly **one aggregate `ability-performed` per turn**. The positional path
defers its inline emit (`playerTurn.ts:2404`) so the engine can emit a single post-apply event
(`engine.ts:5868`, `emitDeferredAbilityPerformed`), called at `engine.ts:6572` (player/team) and
`engine.ts:8920` (enemy).

**That one event anchors every OUTGOING reactive trigger** — `on-deal-damage`, `on-crit`,
`on-debuff-inflicted`. This is the single highest-leverage defect in the epic: fixing emission
cardinality fixes all three trigger families at once.

Identity is lost in two further places:

- **`h` never leaves the loop.** It is never passed to `victimHitDamage`, `applyToVictim`,
  `emitHit`, `onVictimResolved`, the amplification/reduction callbacks, or any event payload.
  There is no attack index, sequence number, or per-sub-attack context anywhere in the engine.
  *(`hitIndexThisRound`, `types/abilities.ts:544`, is a VICTIM-side per-round intake counter
  serving Ironclad's `nth-hit-2plus` condition. It is not an attacker sub-attack index — do not
  mistake it for one or try to reuse it.)*
- **`critPairs` collapses hits × victims into one count** (`positionalApply.ts:249`).
  `critVictimIds` (`:216`) is the existing companion recovering the distinct-victim axis.

### Layer 3 — debuff application and landing rolls: FLAT

`flushDeferredEnemyApplications` (`engine.ts:6458`) runs **once per turn**, after the whole
positional apply has completed, and unconditionally — "so a cast that resolved non-positionally,
whiffed, or killed its target still applies its debuff". Landing rolls happen once per cast.
Discrete `debuff-applied` emission sites are `playerTurn.ts:1131`, `:1282`, `:1498`.

### The DPS path differs structurally

Multi-hit is **folded**: `effectiveMultiplier = rawMultiplier * hits` (`playerTurn.ts:2190`),
damage applied once. Only the crit *draw* loops per hit (`:2020-2039`). `victimDamage.ts:16-30`
documents the algebraic identity that makes the fold equal to N separate hits. There is no AoE
on this path at all.

---

## 4. Confirmed defects that follow from R1/R2

1. **Bloodthirst — most severe.** `triggers.ts:411-425` loops `e.critHits`, which positionally
   is `critPairs` = hits × victims. A 3-hit × 4-victim all-crit cast enqueues the heal **12
   times**, and each enqueue carries the same **full-cast** `e.damage` (documented approximation
   at `triggers.ts:415-418`). Both the count and the basis are inflated. Correct behaviour: one
   roll per critting sub-attack, healing off that sub-attack's damage.
2. **`on-deal-damage` fires once per TURN.** Explicitly documented at `triggers.ts:429-436`
   ("once-per-turn for single-hit, multi-hit, and AoE alike"). Three riders are wrong: **Burner**
   (4pc set Inferno, `buildEquipmentAbilities.ts:107`), **Warpstrike** (duration-reduction,
   `:711`), **Zeolite's purge** (`buildShipAbilities.ts:2501`). DoT re-application is additive —
   `infernoEntries.push` (`triggers.ts:2890`) — so N sub-attacks correctly yields N independent
   entries that tick and sum.
3. **Menace / Giant Slayer roll per (hit, victim).** `outgoingAmplificationForHit`
   (`outgoingEffects.ts:21`) is invoked from `engine.ts:5830` → `positionalApply.ts:260`, i.e.
   once per victim. Correct behaviour: one roll per sub-attack, applied to every victim of that
   sub-attack meeting the condition.
4. **`procScope: 'per-attack'` is a misnomer — it is per-TURN.** Key is
   `${ownerId}:${abilityId}` with no attack component (`triggers.ts:2078`), cleared in exactly one
   place (`engine.ts:7381`, at actor turn-start). `engine.ts:2848` calls it a "Per-actor-turn
   verdict cache". Insidiousness — the ability PR #275 "fixed" — replays sub-attack #1's verdict
   for all N. The same misnomer afflicts `reactionFiredThisAttack` (`triggers.ts:1429`), whose key
   `${ownerId}:${abilityId}:${victimId}` permanently suppresses a victim for sub-attacks #2..#N
   within a turn.
5. **Debuffs land once per cast** (Layer 3), so Enforcer produces 1 shred stack where the game
   gives N.
6. **SUSPECTED, must be verified before fixing.** Both amplification call sites —
   `playerTurn.ts:2031` (per hit, aggregate path) and `engine.ts:5830` (per hit × victim) — share
   the same gate map and key (`procChanceGates`, `${ownerId}:${abilityId}`). On the positional
   path playerTurn's amplification result is discarded (positional recomputes per victim) but the
   roll still advanced the gate. If confirmed, this doubles the gate advance rate for every
   amplification implant. Treat as unconfirmed until measured.

**Durable lesson to record: the misnomer is the bug's hiding place.** Two caches named
"ThisAttack" that are actually per-turn read as correct to every reviewer for months.

---

## 5. Design decisions

| Decision | Choice | Rationale |
| --- | --- | --- |
| Universal model | Every attacking skill is N sub-attacks, N=1 typical | No special multi-hit path; N=1 keeps behaviour byte-identical for most of the corpus |
| Insidiousness | **In scope** | Debuffs apply per sub-attack (R1), so it is a consequence of Layer 3, not a separate question |
| DPS path | **Loop N times, damage and effects** | One code shape across both paths; eliminates the divergence risk that produced the predicate-copy defect class in PR #305. No perf gate needed — see §5.1 |
| Combat log | **N rows, one per sub-attack** | The log must show what the game shows: three attacks with their own crits, damage and landings |
| Delivery | Sequenced PRs (§6), not one | Scope grew ~10× past the four-site fix the single-PR answer was given for |
| Rejected | "Cardinality signal on the aggregate event" | Reports N attacks rather than executing them; cannot satisfy R1. Do not revive |

### 5.1 The DPS path carries no autogear cost — corrected 2026-08-07

An earlier draft gated the DPS change on a performance benchmark, on the premise that the
multi-hit fold sits in autogear's innermost loop. **That premise is false and the gate has been
removed.** Autogear never invokes the combat engine: it scores on STATS, via
`calculateTotalScore` (`src/utils/autogear/scoring.ts:145`) over `calculateTotalStats`, with
`src/utils/autogear/fastScoring/fastCalculateStats.ts` as its fast path.

The only callers of `simulateDPS` / `runCombat` are `src/utils/calculators/dpsSimulator.ts`,
`src/utils/calculators/healingEngineAdapter.ts`, `src/pages/calculators/DPSCalculatorPage.tsx`,
and `src/utils/combat/engine.ts` internally — all page-level or script-level, one calculation at
a time. Multiplying a 3–4 iteration inner loop for the `hits > 1` subset is not a performance
event anywhere.

**Record this as a standing fact:** autogear cost and combat-engine cost are unrelated in this
codebase. Do not reason about one from the other.

**What looping actually buys.** DPS mode has no AoE, and damage is algebraically identical
folded or looped (`victimDamage.ts:16-30`). So looping N adds nothing for *damage* — its entire
value is making **effect and proc resolution** per-sub-attack, so Bloodthirst, Burner, Menace and
Giant Slayer behave identically in the calculator and in the sim. Looping damage too is chosen
purely so there is ONE derivation of "what a sub-attack is" rather than two that can drift.

---

## 6. Sequenced PRs

**PR1 — Sub-attack as a first-class concept.**
Introduce a sub-attack index/context in `positionalApply` and thread it through the callbacks
(`victimHitDamage`, `applyToVictim`, `emitHit`, `onVictimResolved`, the amplification and
reduction callbacks). Pure plumbing: nothing consumes it yet, no behaviour change.
Characterization tests only — and per the writing-plans convention, state explicitly in the plan
that these are characterization tests whose value is failing *later*, so reviewers do not
correctly flag them as tests written to pass on first run.

**PR2 — Per-sub-attack `ability-performed` emission.**
Emit N events instead of one. Byte-identical at N=1. Fixes, in one change: `on-deal-damage`
(Burner / Warpstrike / Zeolite), `on-crit` count (Bloodthirst's 12×), Bloodthirst's damage basis
(each event now carries its own sub-attack's damage, retiring the `triggers.ts:415-418`
approximation), and gives `on-debuff-inflicted` real sub-attack identity.
Highest event-cardinality risk in the epic. Includes the combat-log change to N rows.

**PR3 — Debuff application inside the loop.**
Move `flushDeferredEnemyApplications` (`engine.ts:6458`) to per-sub-attack, with N independent
landing rolls. Enforcer gains N shred stacks. Insidiousness becomes correct as a consequence.
Must preserve the existing intra-cast clause-order rule (a debuff clause written after the damage
clause misses that cast — see `project_intra_cast_clause_order`) *within* each sub-attack.

**PR4 — Proc gates.**
Hoist the amplification roll from the victim loop to sub-attack scope: one roll decides
*whether*, each victim decides *if it qualifies*, preserving the existing "eligibility gates the
gate" invariant (only advance when at least one victim qualifies). Re-key and rename
`procScope: 'per-attack'` and `procDecisionThisAttack` to reflect reality. Verify and, if real,
fix the double-advance in §4.6.

**PR5 — DPS-path alignment.**
Make the DPS path loop N times for damage and effects alike, replacing the fold at
`playerTurn.ts:2190`. No perf gate — see §5.1. The load-bearing outcome is that proc/DoT/trigger
resolution becomes per-sub-attack, so the calculator and the sim agree for multi-hit ships.

**PR6 — Verification sweep.**
Confirm the incoming side already satisfies R1 (does Cultivator's passive fire N times today?
`attacked` already emits per hit at `emitAttacked.ts:23` and per victim via
`emitPerVictimAttacked.ts`, so this may already be correct — verify, do not assume). Re-run the
placement-symmetry oracle.

---

## 7. Testing and verification

**The regression signal is not `npm test`.** Golden fixtures are synthetic and the 147-ship
real-kit suite is focus-actor-only, so a green suite does not demonstrate enemy- or team-path
correctness. `npm run audit:placement-symmetry` (at K=15, not the K=5 default) is the honest
signal, and it is a script, not part of CI. Run it at the end of every PR in this epic and record
the finding count in the PR body. Current baseline: **2 findings, 146 symmetric, distinct-kind
count 13/13/13** across focus/team/enemy.

**Team symmetry is mandatory.** Every change must apply to both sides. The enemy actor path has
repeatedly been the one that silently drops a mechanic (PRs #305, #306). Any per-owner map or
runtime iteration added in this epic must sweep both `runtimesById` and
`enemyPlayerRuntimeByActorId` — **and its callers must be checked for the same asymmetry**, which
was half of #306's bug.

**Corpus-scan before assuming a bug is one ship's.** A throwaway vitest walking
`docs/ship-skills.csv` through `buildShipAbilities` gives exact blast radius in seconds. Use it
to enumerate every ship with `hits > 1` before PR1, and record the list in the plan — it is the
churn set for every subsequent PR.

**Mirror the engine's own predicate when sizing a fix.** An approximate predicate over-counted
#306's blast radius by 5×.

**PR5 has no benchmark gate** — see §5.1 for why the autogear premise was false. The check that
matters instead is an equivalence test: for a `hits > 1` ship with no procs, looped damage must
equal folded damage exactly. That is `victimDamage.ts:16-30`'s identity asserted as a test rather
than trusted as a comment.

**Expected churn:** ships with `hits > 1` carrying Burner, Bloodthirst, Menace, Giant Slayer,
Warpstrike, Zeolite, or any debuff clause. At N=1 nothing should move; a golden diff on an N=1
ship is a bug in the change, not expected churn. That invariant is the cheapest correctness check
available in this epic — assert it explicitly.

---

## 8. Out of scope

- Any change to incoming-side proc granularity (§2 — verified correct).
- The Exposed 2-stack rule, the bomb death-splash question, and the other open game-rule items;
  they are independent.
- `teamActorWalk.ts:35`'s synthesized `hasChargedSkill` (deliberately per-path since #305;
  revisit only with a behaviour question attached).

---

## 9. Open items carried into planning

1. §4.6's double-advance is **suspected, not confirmed**. Measure before fixing.
2. Whether the incoming side already satisfies R1 (PR6) is **unverified**. Measure before
   changing anything there.
3. The `hits > 1` corpus list is not yet enumerated. PR1's plan must produce it.

No item above blocks writing the implementation plan; each is a measurement task inside its PR.
