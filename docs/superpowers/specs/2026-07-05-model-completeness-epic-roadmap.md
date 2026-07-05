# Model-Completeness Epic — Roadmap

**Date:** 2026-07-05
**Status:** Ratified (decomposition + ordering approved by user 2026-07-05)
**Type:** Epic roadmap (each sub-project gets its own spec → plan → implement → merge-loop cycle)

## Source

Closes the remaining deferred backlog after the skill-model-gap epic (Phase 1 #205–#214,
Phase 2 #215–#218, Phase 3 reactive-trigger promotion #219–#229 — all merged to main at
`dcf8468f`). Inputs:

- `scripts/auditSkills.allowlist.ts` — the authoritative intentionally-unmodelled list.
- `docs/superpowers/specs/2026-07-04-reactive-trigger-promotion-phase3-design.md` "Out of scope".
- Pinned engine known-limitation tests (`cobaltStartOfTurnCharge.integration.test.ts`, etc.).

## Goal (user-locked, 2026-07-05)

**Everything, faithfully — zero *real-gap* allowlist deferrals left.** Model every remaining
unmodelled mechanic in the corpus so it behaves faithfully in the combat sim (and DPS where
applicable). Engine known-limitations are **in scope** (sub-project G).

### What stays allowlisted (NOT epic work — already correct)

These are data-layer facts or harness/clause-scoping false positives, not unmodelled behaviour;
they remain in the allowlist:

- **Data layer:** `always-crit` (Asphodel, Tormenter — crit 100% in import data); innate
  `shield-penetration-innate` (Crucialis, Curator, FrontLine, Guardian, Liberator, Medved,
  Provider, Sustainer, Vindicator, Xcellence).
- **Harness / clause-scoping FPs:** Nosorog `damage-reflection` (production passive-gated; audit
  re-parses as active), Rikra ungated-buff (clauseFor scoping), Madax "while this Unit deals"
  (simultaneity, not a gate), Oleander "per debuffed enemy" (scopes the repair, already modeled),
  Tormenter `base-damage` (already modeled via `incoming-reduction`.hpScaling), Valkyrie
  `accumulate-detonate` (passive burst *reference*, parser-guard-filtered).

SP0 confirms this list against the current engine before any building (a "correct" entry that
turns out real gets promoted to a sub-project; a "gap" that turns out already-correct becomes a
green FP-lock, no build).

## Approach

**Triage-first, then infra-dependency-ordered sub-projects** — the shape that landed Phases 1–3.

1. **SP0 discovery/triage** produces the authoritative gap inventory (red/green probe corpus +
   reconciliation table) before any building — several SP-F one-offs don't have their ships
   identified yet, and history shows triage catches already-correct FPs (dump-fidelity trap).
2. Sub-projects ordered so each builds a **reusable primitive** consumed by later ones, with the
   easy→hard risk gradient folded in: extend-existing-infra (A/B) → new self-contained gate
   primitives (C/D) → transforms (E, couples back to A/D) → bespoke one-offs (F) → engine timing
   (G, parallelizable).

## Sub-project decomposition

| SP | Family | Ships (SP0 confirms) | Infra built/extended | Depends on |
|----|--------|----------------------|----------------------|------------|
| **SP0** | Discovery / triage | full 147-ship corpus | red/green probe corpus + reconciliation table | — |
| **A** | Incoming-reduction condition gates | Malvex (self-shield), Voron (self-DoT) | extends PR12(C) `IncomingCondition` (new self-shield + self-DoT-scope conditions) | SP0 |
| **B** | New reactive trigger families | Paracelsus & Faust (on-death), Curator & FrontLine (on-enemy-charged-skill), Ravager (on-own-debuff-resisted), Nosorog (on-own-cleanse — verify vs PR-H) | new engine events + eventCtx capture (Phase-3 pattern); reuses J's `hpBasisPct` for Paracelsus 50%-maxHP | SP0 |
| **C** | Stat-comparison gates | Bayah (Crit Power vs target), Chakara, Cobalt | new compare-stat gate primitive (stat-of-owner vs stat-of-target) | SP0 |
| **D** | Count-based gates | Berserker & Tygr (hit-count ≥N), Belladonna/Anemone/Snakeroot (named-DoT stack count ≥N) | new count-gate primitive (hits-this-cast / named-DoT-stacks-on-target) | SP0 |
| **E** | DoT transforms & conversions | Voron (incoming damage→DoT transform), Belladonna (Corrosion→Acidic Decay, team mode) | named-DoT transform/conversion model | SP0; couples with A (Voron), D (Belladonna) |
| **F** | Deep one-offs | Panon (instead-branch replacement), Lingshe (Bomb countdown-reduction + forced-detonate rider), + overheal-redirect / defense-substitution / forced-affinity / charge-loss-immunity / on-ally-shield-destroyed ships (SP0 identifies) | bespoke per ship | SP0 |
| **G** | Engine known-limitations | Cobalt (start-of-turn drain-ordering), FrontLine (reactive-shield amount plumbing), Meatshield/Kinetik/Cinya (recurring per-turn grants), Butcher (positional-path Rage sourceId) | core combat-loop timing / eventCtx amount plumbing | independent of A–F (parallelizable) |

### Per-sub-project scope sketches (each becomes its own spec)

- **SP0 — Discovery/triage.** Re-audit all 147 ships against the *current* (post-#229) engine.
  For each remaining allowlist entry and each "out of scope" family, write a probe through
  PRODUCTION `buildShipAbilities` slot routing asserting the intended behaviour: RED = real gap
  (→ assign to a sub-project), GREEN = already-correct FP (→ lock, no build, no stale allowlist
  row). Output: probe corpus file + a reconciliation table mapping every real gap to SP A–G with
  its exact ship list. Deliverable feeds every downstream SP's spec. Red CI accepted for the
  epic duration if the user opts to commit the probe corpus (Phase-3 precedent).
- **SP-A — Incoming-reduction condition gates.** Add a self-shield `IncomingCondition` (Malvex
  "When Shielded, takes 10% less damage") and a self-DoT-scope condition (Voron "20% less from
  DoT ticks"). Extends the PR12(C) `incoming-reduction` machinery; Voron's reduction is faithful
  only once E models the damage→DoT transform it's coupled to — sequence A's Voron assertion to
  land with or after E, or split Voron across A (reduction) + E (transform).
- **SP-B — New reactive trigger families.** on-death (Paracelsus 50%-maxHP retaliation is the
  trivial `hpBasisPct` consumer J left as next; Faust), on-enemy-charged-skill (Curator, plus
  FrontLine's reaction — distinct from G's shield-amount plumbing), on-own-debuff-resisted
  (Ravager — the inflictor reacts when ITS debuff resists, mirror of Vindicator's resister-side),
  and verify Nosorog "removes a debuff" against PR-H's `on-own-cleanse` (may already be covered).
- **SP-C — Stat-comparison gates.** A gate primitive comparing an owner stat to a target stat
  (Bayah Crit-Power-vs-target, Chakara, Cobalt). Sim currently assumes no stat comparisons.
- **SP-D — Count-based gates.** A gate primitive for "hitting ≥N enemies this cast" (Berserker,
  Tygr) and "target carries ≥N stacks of named-DoT" (Belladonna 3+ Acidic Decay → Stasis;
  Anemone, Snakeroot).
- **SP-E — DoT transforms & conversions.** Model named-DoT conversion: Voron's incoming
  damage→DoT transform and Belladonna's Corrosion→Acidic Decay (team mode). Couples back to A
  (Voron reduction) and D (Belladonna count gate).
- **SP-F — Deep one-offs.** Bespoke, single-ship: Panon instead-branch (needs negated
  self-conditions + sim damage-branch selection — the sim reads only the first damage ability),
  Lingshe charged Bomb countdown-reduction + forced-immediate-detonation-at-zero rider, plus the
  epic one-off mechanics (overheal-redirect, defense-substitution, forced-affinity, charge-loss
  immunity, on-ally-shield-destroyed) whose ships SP0 pins.
- **SP-G — Engine known-limitations.** Cobalt start-of-turn grant drain-ordering (buff currently
  alternates every other turn — needs grant-before-act ordering; the pinned KNOWN-LIMITATION
  assertions consciously flip), FrontLine charged-cast-reaction shield staying flat/un-mitigated
  (needs eventCtx dealt-amount plumbing to the reactive-shield executor), Meatshield/Kinetik/Cinya
  recurring per-turn grants (no recurring trigger today), Butcher positional-path Rage (own-DoT
  sourceId absent on the positional path).

## Locked rules & invariants (apply to every sub-project)

Inherited from the combat-realism + skill-model-gap epics; non-negotiable:

- **TDD, non-vacuous.** Every PR ships tests that FAIL under the old behaviour, at every layer
  touched (parser unit / `evaluateConditions` / combat integration round-1-vs-2, AoE mixed-victim,
  expiry / DPS-parity lock). The review question of record: *"would this test fail under the
  pre-change behaviour?"*
- **Byte-identical golden suite is the regression gate.** Never blind `vitest -u`; audited churn
  only where behaviour legitimately changes, explained.
- **Audit stays at 0 findings.** Each closed mechanic ships/updates its keyword→handled rule in
  `scripts/auditSkills.ts` and removes the corresponding allowlist row. A bare allowlist the audit
  doesn't flag is stale — add the rule to make it meaningful (`instead-replacement` precedent).
- **Team-symmetric** — a ship behaves identically on either side (enemy-owned proof required for
  every reactive/gated mechanic).
- **Dump-fidelity trap / red-through-production-routing.** Write the red probe through PRODUCTION
  `buildShipAbilities` slot routing FIRST; if it passes pre-change → STOP-AND-REPORT as an FP
  (three sweep families were dump-fidelity FPs; verify ENGINE consumption, not just a model field).
- **Model-fidelity vs sim-consumed.** Some parsed fields have no sim/DPS consumer yet (heal
  scaling, typed cleanse). Faithful *modeling* still counts as done for those; note which are
  inert in the sim.

## Reconciliation — allowlist entries this epic closes

Closed on completion (row removed + audit rule added/updated): Lingshe (F), Ravager (B),
Curator (B, reactive half; shield-pen row stays — data layer), Paracelsus (B), Nosorog
(ungated → B if not already PR-H; reflect row stays — harness FP), Panon (F), Bayah (C),
Belladonna (D + E), Berserker (D), Malvex (A), Voron (A + E). Stays: all data-layer + harness-FP
rows listed under "What stays allowlisted" above.

## Execution model

Per `feedback_orchestrated_pr_workflow`: each sub-project runs its own **brainstorm → spec (in
this dir) → writing-plans → subagent-driven implementation (worktree-isolated Sonnet implementers,
gates run SERIALLY) → orchestrator-reviews-every-diff → per-PR green→rebase→merge loop**. SP0
first; A/B next (may parallelize — independent infra); C/D after; E after A+D; F last; G anytime
(parallel, engine-only). Orchestrator picks each subagent's model per task. Update memory at each
sub-project milestone; prune stale in-flight markers on completion.
