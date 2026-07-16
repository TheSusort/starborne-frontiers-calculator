# Ship Kit Correctness Audit — Design

**Date:** 2026-07-16
**Status:** Approved (brainstorm complete)
**Type:** Analysis / audit project (produces a ranked, verified findings ledger — not fixes)

## Problem

The existing `audit:skills` tool reports **0 findings** across 147 ships, but by its own
docstring it only catches *coverage gaps* — cases where the skill text clearly contains a
mechanic but `buildShipAbilities` produced **no** matching ability. It explicitly has **no
ground truth for correctness** and does **not** check whether the combat sim actually
*executes* a parsed ability faithfully.

So the coverage layer is green, but two failure classes are unmeasured:

- **Wrong parse** — the parser emits *an* ability, but with the wrong value, target, trigger,
  condition, or a dropped sub-effect vs. the intended mechanic.
- **Wrong / missing execution** — the parse is right, but the engine executes it incorrectly,
  partially, or not at all.

We want a per-ship correctness pass over the **entire 147-ship roster** that surfaces both
classes, verified against false positives, and ranked into a fix backlog.

## Ground truth

There is no automated oracle for correctness. The **skill text** in `docs/ship-skills.csv`
(refit-active passive resolved) is the source of intended behavior; `docs/combat-system.md`
and the locked combat-rules reference define how mechanics are supposed to resolve. A finding
is therefore a judgment: read the text → form the intended mechanic → compare against the
parsed `Ability` model **and** the combat-log of a real battle. This judgment nature is why an
adversarial verify stage is mandatory (agent audit findings have a known false-positive rate).

## Approach (chosen: A)

**Trace-bundle harness + parallel review with escalation & adversarial verify.**

Alternatives considered and rejected: (B) characterization tests per ship — huge upfront cost,
and expectations are partly derived from the same parser (circular); (C) manual trace in the
live UI — highest fidelity but not scalable to 147 and not reproducible.

## Architecture

Three layers, driven by a **Workflow** (user opted in) that runs batch → escalate → verify in
the background and returns the ledger.

### 1. Trace-bundle harness — `scripts/traceShip.ts`

A headless CLI (sibling to `scripts/auditSkills.ts`) that takes ship name(s) or `--all` and
emits a **kit bundle** per ship, as JSON plus a readable markdown rendering:

1. **Skill text** — read from `docs/ship-skills.csv` using the same record reader `auditSkills`
   uses (handles multi-line quoted passives). Refit-active passive resolved via
   `getShipSkillRows` (`src/utils/ship/skillRows.ts`); **refit index recorded** so reviewers
   know which passive is live.
2. **Parsed abilities** — `buildShipAbilities(ship)` output, pretty-printed: type, target,
   trigger, condition, values, scaling.
3. **Execution trace** — the combat log (`LOG_EVENT_TYPES` from
   `src/utils/calculators/battleSimulator.ts`) of a **standardized scenario** run through
   `simulateBattle`.

Each parsed clause in the bundle is labelled **triggered** or **not-observed** in the scenario,
so "the sim ran it" is distinguishable from "the scenario never exercised it."

The harness accepts **scenario overrides** (starting HP%, enemy affinity, forced crit, ally
death, charge state, refit index) so the escalation tier can reuse it to force specific
branches.

### 2. Standardized scenario

Identical for all 147 ships (the reviewed ship is the only variable → reproducible, diffable):

- **Reviewed ship as the focus actor** (`player[0]`, id `'attacker'`) so its active fires.
  Team-symmetry (engine acts identically on either side) makes this valid even for
  enemy-designed ships.
- **2–3 filler allies** — enables ally-scoped grants and on-ally-death / on-ally-crit triggers.
- **Fixed standard enemy roster**, tuned strong enough to (a) drop the ship's HP through
  threshold gates, (b) attack the ship so on-attacked / reflect / counter fire, and (c)
  plausibly kill a filler ally within the window.
- **~30 rounds**, **charged skill enabled** (charge branch executes), consistent gear/stat
  baseline.

A single standardized scenario will not fire every conditional/reactive/charge branch by
design — untriggered branches are surfaced (not silently passed) and handed to escalation.

### 3. Review pipeline (Workflow)

**Batch.** 147 ships → ~13 batches of ≈10–12 ships, one review subagent each. Every subagent
receives its batch's kit bundles + `docs/combat-system.md` + the locked game-rules reference
(Stasis/affinity/stat-layers/cleanse-purge/Crit-Power terminology/legendary-stage-3-only enemy
effects/cross-leader pct summing).

**Per-clause verdict.** For every clause of a ship's skill text:

| field    | values |
|----------|--------|
| verdict  | `MATCH` / `WRONG-PARSE` / `WRONG-EXEC` / `MISSING` / `UNTRIGGERED` |
| layer    | `parser` / `executor` / `both` |
| expected | one-line intended mechanic from the text |
| observed | what the parsed ability + combat log actually did |
| severity | `high` (core kit broken) / `med` / `low` (edge/cosmetic) |

`MATCH` and `UNTRIGGERED` are terminal for tier 1. `WRONG-PARSE` / `WRONG-EXEC` / `MISSING`
are candidate findings.

**Escalation (tier 2).** Two queues re-run the harness with scenario overrides:
- `UNTRIGGERED` → tailored micro-scenario forcing that branch (low-HP start, specific enemy
  affinity, forced crit, ally death, charge state). Re-verdicts to `MATCH` or a real finding.
- `WRONG-EXEC` candidates → focused executor trace confirming the log discrepancy is real, not
  a scenario artifact.

**Verify.** Every surviving candidate gets an **adversarial re-check** by a fresh agent tasked
to *refute* it (default "not a bug" when uncertain). Survivors → ledger, tagged `CONFIRMED`.
Refuted ones dropped but recorded as `REFUTED` for transparency.

## Output — the ledger

- **`docs/ship-kit-correctness-ledger.md`** (docs/ is gitignored, matching `skill-audit.md`):
  - Summary header: ships audited, clauses reviewed, confirmed findings by severity, counts of
    refuted and untriggered-verified.
  - Findings table, ranked `high → low`: ship, slot/clause, layer, expected vs observed,
    severity, suggested-fix pointer (`skillTextParser.ts` rule vs a `combat/` executor).
  - Appendix: per-ship MATCH/UNTRIGGERED-verified roster, so clean ships are provably covered.
- **`docs/ship-kit-correctness-ledger.json`** — machine-readable findings, for turning into a
  fix backlog later (mirrors the gap-sweep JSON pattern).

**Scope boundary:** this project ends at a ranked, verified backlog. Fixes are scoped
separately, per-finding, afterward — a 147-ship audit is not blurred into an open-ended fix
marathon.

## Components & interfaces

| Unit | Purpose | Depends on |
|------|---------|-----------|
| `scripts/traceShip.ts` | Emit kit bundles (text + parsed abilities + combat-log trace); accept scenario overrides | `buildShipAbilities`, `simulateBattle`, `getShipSkillRows`, CSV reader |
| standardized-scenario builder | Construct the fixed team/enemy/rounds/gear scenario | `simulateBattle` input types |
| review Workflow script | batch → escalate → adversarial verify → ledger | `traceShip.ts` output, Agent subagents |
| ledger writer | Render `.md` + `.json` from confirmed findings | verify-stage output |

## Error handling

- Ships whose CSV record fails to parse or whose `simulateBattle` throws → recorded as a
  `HARNESS-ERROR` row (not silently skipped), so coverage is provable.
- The harness must not `vitest -u` or touch golden snapshots; it reuses the same headless
  entry points the tests use.
- Worktree/`.env` gotchas: the harness only needs the CSV + engine code (no Supabase), but the
  Workflow's agents that run tests must have `.env` present (per memory).

## Testing

- The harness itself gets a small smoke test: one known ship produces a bundle with all three
  sections populated and at least one triggered clause.
- The audit's *findings* are validated by the adversarial verify stage, not by unit tests
  (there is no correctness oracle to assert against).

## Open risks

- **Scenario tuning** — the standard enemy roster must be strong enough to exercise HP-gated
  and reactive branches but not so lethal the ship dies round 1. Needs a tuning pass during
  implementation.
- **Refit coverage** — only the refit-active passive is traced by default; ships with
  meaningfully different passives per refit may need per-refit escalation. Flag during review.
- **Verify-stage cost** — adversarial verification across ~13 batches of findings is the
  most expensive stage; batch it and cap per the Workflow's concurrency.
