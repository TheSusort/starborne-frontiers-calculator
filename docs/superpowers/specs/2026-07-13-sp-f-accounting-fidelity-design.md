# SP-F: Accounting Fidelity

**Sub-project of** the [Team-Agnostic Engine Unification & Sim Fidelity epic](./2026-07-12-team-agnostic-engine-unification-epic-design.md).
**Status:** Design approved (2026-07-13).
**Branch:** fresh off `main` (`4b518ed2`, SP-U shipped).
**Predecessors:** SP-0 (sim-golden harness + RNG sub-streams, PR #250) and SP-U (bySide
unification + real destructible DPS enemy, PR #251) are shipped.

---

## 1. Goal

Close **every accounting approximation documented in `src/utils/calculators/battleSimulator.ts`**
so the `BattleResult` surface reports what the engine actually computed. Each approximation is
retired with a **deliberate, audited golden move** — the opposite of SP-U's byte-identical
refactor increments.

Structurally, SP-F finishes the SP-U handoff: it removes the last vestigial dummy sink and unifies
the enemy incoming-accounting tail onto the single per-victim path, then closes the six downstream
approximations that traced to those asymmetries.

## 2. Locked decisions (this sub-project)

| # | Decision | Rationale |
|---|----------|-----------|
| SF1 | **F7-first.** Do the structural dummy-removal + enemy-tail unification before closing the downstream approximations. | F1's `Σdealt == Σtaken` reconciliation is only well-defined once the dummy scalar is gone and there is a single per-victim accounting surface. Front-loading the big audited move keeps later F's local. |
| SF2 | **Three grouped PRs**, not seven (epic literal) nor one (SP-0/SP-U pattern). Grouped by data dependency. | Balances audit isolation of each deliberate golden move against merge-loop overhead. |
| SF3 | **Audit-first per F.** Each F's first step confirms the residual gap, because the engine already carries partial machinery for several of these. | F2/F5/F6 have engine-side machinery already; the residual gap is often consumer-side in `assembleBattleResult`. Do not assume the epic's one-line framing is the whole story. |

## 3. PR grouping

| PR | Contains | Theme | Why grouped |
|----|----------|-------|-------------|
| **PR1 — Accounting surface** | **F7** then **F1** | One per-victim accounting surface | F7 is the SP-U structural handoff; F1's reconciliation is its payoff and is only well-defined on the unified surface. |
| **PR2 — Dropped channels** | **F2, F3, F4, F5** | Surface data the event stream already carries but `BattleResult` drops or approximates | Each is primarily a consumer-side gap in `battleSimulator.ts` / `assembleBattleResult`. Small, related diffs. |
| **PR3 — Per-victim RNG** | **F6** | The `RateGate`-determinism payoff | Hardest, largest golden churn, isolated. SP-0's per-stream seeding keeps the churn local and auditable. |

## 4. Per-F deliverables

Each F: **audit current state → close the gap → remove the approximation comment → land the
audited golden move**. File pointers below are current as of `4b518ed2` and are starting points,
not exhaustive.

### PR1 — Accounting surface

**F7 — Remove vestigial dummy + unify enemy incoming-tail**
- Remove the now-purely-vestigial 1e9-HP / 0-defence dummy target from the sim/healing `runCombat`
  call (`battleSimulator.ts:858–861`). SP-U already discarded its scalar accounting (real per-victim
  damage flows positionally); the dummy is dead weight kept byte-identical by SP-U.
- Unify the enemy **incoming**-accounting tail — the inline enemy-side incoming-credit /
  damage-taken-leech / distinct `attacked`-emit / `roundEnemyEffects` / pre-call incoming-reduction
  rows that SP-U's `drivePositionalTurnApply` left inline (see the SP-U U2 boundary lesson) — onto
  the single per-victim path. Team-symmetric: a ship's incoming accounting is identical on either side.
- Acceptance: no dummy target in any `runCombat` call; enemy and player incoming accounting share one
  path; sim goldens move only where the dummy's absence is expected (audited).

**F1 — AoE reconciliation**
- Today `damageDealt` is the anchor-full `ability-performed` aggregate and `damageTaken` is per-victim
  (AoE origin-full / covered-half); the `ShipRoundState` docstrings (`:83–94`) declare them "NOT
  expected to reconcile — by design." Make the attacker aggregate equal `Σ` per-victim `damageTaken`.
- Rewrite those two docstrings to state the new invariant.
- Acceptance: for every AoE cast in the sim goldens, `attacker.damageDealt == Σ victims.damageTaken`;
  a dedicated AoE sim fixture asserts it.

### PR2 — Dropped channels (consumer-side unless the audit finds an engine gap)

**F2 — Per-recipient healing.** Consume `heal-performed.perTarget` (already emitted,
`playerTurn.ts:2718`) for true per-recipient `healingReceived`; retire the even-split at
`battleSimulator.ts:335`. Acceptance: a multi-recipient heal fixture with **unequal** per-recipient
amounts asserts each recipient's exact share.

**F3 — `shieldsAbsorbed` channel.** Surface `shieldsAbsorbed` on the path where it currently reads 0
(the grant path already reads `shield?.absorbed` at `:382`; confirm the incoming/heal path).
Reconcile against `shieldAbsorb.ts`'s `absorbed`. Acceptance: a fixture where a shielded victim takes
a hit reports non-zero `shieldsAbsorbed` matching the drain.

**F4 — `healModifier` consumption.** The in-cast path already applies `healModifier`
(`playerTurn.ts:2742`). Close the path where it is forwarded-but-ignored — the
`unsimulatedPreFightEffects` modifier-channel lines (`battleSimulator.ts:155–160`, note the internal
"until PR F3 consumes them" reference, reconcile the label). Acceptance: a squad-leader/pre-fight
`healModifier` measurably changes simulated heal amounts; the "not simulated" comment is removed.

**F5 — Charged-skill targeting.** Charged-pattern routing exists (`playerTurn.ts:1053`,
`chargedTargeting` threaded through `battleSimulator.ts`). Confirm charged casts use the charged
selection *and* footprint end-to-end; close any residual active-selection fallback in
support-footprint / targeting resolution. Acceptance: a ship whose charged targeting differs from
active hits the charged footprint in the sim.

### PR3 — Per-victim RNG

**F6 — Per-victim affinity + per-victim crit.** Machinery exists (`perVictimOutgoing` /
per-victim crit resolver at `playerTurn.ts:1795`, `:3012`). Make per-victim affinity + per-victim
crit the authoritative signal on the accounting/BattleResult surface. Largest golden churn; SP-0's
per-`${actorId}:${purpose}` sub-streams keep it local. Acceptance: covered AoE victims can differ in
crit/affinity outcome within one cast; goldens moved deliberately with an audited diff.

## 5. Golden discipline (load-bearing)

Every F is a **deliberate, audited golden move** — not a byte-identical refactor. Per F:
- Regenerate affected DPS/healing + sim goldens **only after** eyeballing the diff and confirming
  every changed number is explained by that F's fidelity change. **Never blind `vitest -u`.**
- Record the audit rationale in the increment/PR ledger: which goldens moved and why each delta is
  correct.
- If an F moves goldens it should not touch, that is a signal the change leaked beyond its scope —
  stop and investigate (SP-0 sub-streams exist precisely to make such leakage visible).
- Add or extend a sim golden that captures each closed approximation (AoE reconcile fixture,
  unequal-per-recipient heal fixture, shield-absorb fixture, etc.).

## 6. Acceptance

**Per PR:** targeted approximation comment(s) removed from `battleSimulator.ts`; the fidelity
assertion added; full suite green; `audit:skills` 0 findings; lint + tsc clean; goldens untouched or
audited-and-explained.

**SP-F done:**
1. The dummy sink is gone from all `runCombat` paths; enemy incoming-accounting runs the per-victim path.
2. Every approximation comment enumerated in `battleSimulator.ts` is closed.
3. Each closure is backed by an audited sim-golden that moved deliberately.
4. `audit:skills` 0; lint + tsc clean; two golden tiers green.

This unblocks **SP-M** (M1 FrontLine reactive shield needs F1's per-victim dealt-amount plumbing).

## 7. Cross-cutting invariants (from the epic)

- Production RNG untouched (`Math.random`); only the test harness seeds/streams.
- Team-symmetric: every mechanic behaves identically on either side.
- Two golden tiers: synthetic DPS/healing (low-level) + sim (high-level).
- Workflow: `gh auth switch --user TheSusort` before PR ops; docs gitignored (`git add -f`;
  docs-only commits `--no-verify`); dev server on :3000.

## 8. Open questions (carried into the per-F plans, not resolved here)

1. **F6 anchor-crit (epic §7):** does per-victim crit need a model change to the deterministic
   anchor-crit convention beyond RNG decoupling? Resolved in F6's plan.
2. **F1 reconcile definition:** does "reconcile" mean `damageDealt` switches to summing per-victim
   actually-dealt, or a separate raw-vs-taken pairing? Settled in F1's current-state audit (leaning:
   one attacker-aggregate that equals Σ taken).
3. **PR2 engine gaps:** if any of F2–F5's audit reveals the engine does *not* emit the needed data,
   that F gains an engine-side sub-step (spec assumes consumer-side; audit confirms).
