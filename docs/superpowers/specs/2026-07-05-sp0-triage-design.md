# SP0 — Model-Completeness Epic Discovery/Triage — Design

**Date:** 2026-07-05
**Status:** Ratified (design approved by user 2026-07-05)
**Type:** Sub-project spec (SP0 of the model-completeness epic)
**Epic roadmap:** `docs/superpowers/specs/2026-07-05-model-completeness-epic-roadmap.md`
**Handoff brief:** `docs/superpowers/plans/2026-07-05-sp0-triage-handoff.md`

## Goal

Produce the **authoritative gap inventory** every downstream sub-project (SP-A…SP-G) spec depends
on. For every remaining `auditSkills.allowlist.ts` entry and every "out of scope" family in the
roadmap, write one probe **through production `buildShipAbilities` slot routing** asserting the
intended *faithful* behaviour, then classify:

- **Real gap** → assign to a sub-project (A–G) with the exact ship.
- **Already-correct false positive (FP)** → lock as a green regression probe; no build, no stale
  allowlist row.

SP0 writes **no `src` fix**. Its deliverable is a probe corpus + a reconciliation table that
becomes the input to every downstream SP's spec.

This mirrors Phase-3 PR0 (`docs/superpowers/plans/2026-07-04-reactive-trigger-promotion-phase3-pr0-triage.md`,
`src/utils/abilities/__tests__/reactiveTriggerPromotionTriage.test.ts`) — use it as the template.

## Deliverables & file structure

- **Committed — probe corpus:** `src/utils/abilities/__tests__/modelCompletenessTriage.test.ts`.
  One `describe` per SP-family (A–G) plus one `describe` for the confirm-GREEN-only set. One `it`
  per ship. Every probe routes through production `buildShipAbilities(ship({...}))` with skill text
  copied **verbatim from `docs/ship-skills.csv`**. Real gaps use `it.fails(...)`; confirmed FPs are
  green `it(...)` regression locks. Helpers (`ship()`, `slot()`, `abilitiesFor()`) copied verbatim
  from the Phase-3 corpus.
- **Committed — audit hygiene (only where triage reclassifies something):**
  `scripts/auditSkills.allowlist.ts` reason-text touch-ups; `scripts/auditSkills.ts` only if a
  backing rule is missing so a row isn't stale. Audit stays at **0 findings, 0 stale rows**.
- **Local (gitignored `docs/`) — reconciliation table:**
  `docs/model-completeness-triage-2026-07-05.md`. Ship → probe result → bucket → assigned SP, the
  SP-F ship-identification pins, and the fix-PR DAG. Not committed (docs/ is gitignored — mirrors
  the Phase-3 triage doc).

## The gap roster (from the roadmap — do NOT re-derive)

Grouped by target sub-project. Each ship's real bucket is confirmed by its probe; the SP column is
the *expected* assignment, corrected if the probe reveals an FP.

| SP | Ships to probe | Mechanic |
|----|----------------|----------|
| **A** | Malvex, Voron | self-shield / self-DoT incoming-reduction gates |
| **B** | Paracelsus, Faust, Curator, FrontLine, Ravager, Nosorog | on-death; on-enemy-charged-skill; on-own-debuff-resisted; on-own-cleanse |
| **C** | Bayah, Chakara, Cobalt | stat-comparison gates (owner-stat vs target-stat) |
| **D** | Berserker, Tygr, Belladonna, Anemone, Snakeroot | count gates (hits ≥N this cast; named-DoT stacks ≥N on target) |
| **E** | Voron, Belladonna | DoT transforms/conversions (damage→DoT; Corrosion→Acidic Decay) |
| **F** | Panon, Lingshe, + 5 unpinned one-offs | instead-branch; bomb countdown+detonate; overheal-redirect / defense-substitution / forced-affinity / charge-loss-immunity / on-ally-shield-destroyed |
| **G** | Cobalt, FrontLine, Meatshield, Kinetik, Cinya, Butcher | engine known-limitations |

### Confirm-GREEN-only (probe, lock green, do NOT assign to any SP)

Data-layer facts or harness/clause-scoping FPs — they stay allowlisted:

- **always-crit:** Asphodel, Tormenter (crit 100% in import data).
- **shield-penetration-innate:** Crucialis, Curator, FrontLine, Guardian, Liberator, Medved,
  Provider, Sustainer, Vindicator, Xcellence.
- **harness / clause-scoping FPs:** Nosorog `damage-reflection`, Rikra ungated-buff, Madax "while
  this Unit deals", Oleander "per debuffed enemy", Tormenter `base-damage`, Valkyrie
  `accumulate-detonate`.

These get a green regression `it` where a production probe can express them, or an explicit
"harness-only FP — no production probe possible" note in the reconciliation table where the audit
harness (active-only re-parse) is the only thing that misfires (e.g. Nosorog reflect passive-gate).

### Discovery work (not just a probe)

- **SP-F's 5 unpinned one-offs.** Identify which ship(s) carry each of overheal-redirect,
  defense-substitution, forced-affinity, charge-loss-immunity, on-ally-shield-destroyed by
  searching `docs/ship-skills.csv` (keyword grep + `audit:skills` hits). Pin the ship(s) in the
  reconciliation table so SP-F's spec has a concrete roster. If a mechanic has **no** carrier in
  the corpus, record that explicitly (drop it from SP-F).
- **SP-G known-limitations.** Each already has a pinned integration test
  (`cobaltStartOfTurnCharge.integration.test.ts`, etc.). Probe them as `it.fails`
  KNOWN-LIMITATION pins that reference the existing test, giving SP-G a checklist. Where the
  known-limitation is engine-timing (not a `buildShipAbilities` output), the pin references the
  existing integration test rather than duplicating it — record "engine-timing, see <test>" in the
  reconciliation table.

## Green-scaffolding mechanism (`it.fails`)

The epic runs over many sub-projects with independent merge-loops, and Netlify auto-deploys main on
each merge. So — unlike Phase-3's tight single-stack red-CI — SP0 keeps main **green and
deployable** by marking real gaps `it.fails` instead of leaving them red.

```ts
it.fails('Malvex: passive2 self-shield gate produces an incoming-reduction ability', () => {
    const abilities = abilitiesFor({ secondPassiveSkillText: MALVEX_P2 }, 'passive');
    expect(
        abilities.some((a) => a.type === 'incoming-reduction' /* + shielded condition */)
    ).toBe(true);
});
```

Today the assertion fails → `it.fails` is **green**. When SP-A models the mechanic, the assertion
passes → `it.fails` **fails**, forcing SP-A to drop `.fails` and convert it to a normal passing
`it`. Self-enforcing handoff; main stays green throughout the epic.

### The `it.fails` hazard and its mitigation (binding)

`it.fails` passes if **any** assertion in the body throws — including a probe that fails for the
*wrong* reason (a typo, wrong slot, wrong `Ship` field). That would mask a gap as "captured" when
the probe is simply broken. Mitigation, applied to every `it.fails` probe:

1. **Exactly one assertion per `it.fails` probe.** No setup that can throw for unrelated reasons.
2. **Dry-run each probe as a plain `it` (or with the assertion inverted) once** before wrapping it,
   to confirm it fails for the *intended* reason (the mechanic is genuinely absent from the
   production ability output), not an incidental error. This replaces Phase-3's "watch it go red"
   step.

## Verification protocol (inherited, non-negotiable)

- **Production routing only.** Every probe drives `buildShipAbilities(ship({...}))` slot routing —
  never a hand-built ability array. Skill text is copied **verbatim from `docs/ship-skills.csv`**
  (the parser's source of truth), NEVER from `ships.ts` (untagged / differently-worded). Refit-
  active passive resolved via the real production path.
- **Dump-fidelity trap → STOP-AND-REPORT.** If a probe expected to be a real gap turns out **green
  as a plain `it`** (behaviour already correct pre-change) → it is an **FP**. Lock it green, do NOT
  assign it to an SP, record it as an FP in the reconciliation table. Three Phase-3 sweep families
  were dump-fidelity FPs; the Quixilver/Malvex leech-shield mis-triage is the cautionary tale.
  Verify ENGINE/build consumption, not just a parsed model field.
- **Audit stays at 0 findings, 0 stale rows.** If triage reclassifies an allowlist entry, update
  its reason (or remove it and add the backing rule) so the audit stays meaningful.

## Two flagged sub-questions SP0 resolves during triage (empirical, not user calls)

1. **Nosorog "removes a debuff"** — verify against PR-H's shipped `on-own-cleanse` trigger. If the
   probe shows the reactive already rides `on-own-cleanse` → **FP**: lock green, remove Nosorog
   from SP-B's roster, reclassify its `ungated-effect-with-trigger` allowlist row. If not → real
   gap, stays in SP-B.
2. **Voron A↔E coupling** — Voron's incoming-DoT reduction (A) is faithful only once the
   damage→DoT transform (E) exists. Probe both clauses separately; record the recommendation in the
   DAG: **split Voron across A (reduction) + E (transform), sequenced so A's assertion lands
   with-or-after E.** SP-A's spec inherits this note.

## Reconciliation table (the downstream input)

`docs/model-completeness-triage-2026-07-05.md`, one row per probed ship:

| Ship | Slot | Verbatim clause | Expected faithful behaviour | Probe result (fails/green) | Bucket (real-gap / FP / known-limitation) | Assigned SP | Note |

Plus a **fix-PR DAG** section: per surviving SP, the ships it fixes, the reusable primitive it
builds, and the ordering constraints (A/B parallel — independent infra; C/D after; E after A+D; F
last; G anytime, engine-only). Record explicitly which expected-gap ships evaporated as FPs and are
dropped from their SP.

## Workflow & gates (per `feedback_orchestrated_pr_workflow`)

- **Worktree-isolated.** Provision a fresh worktree: `cp <main>/.env .env`, copy ALL `docs/*.csv`
  (ship-skills, ship-targeting, bios) + the combat-system `.md`, run `npm run prepare` (husky) so
  commits don't abort.
- **Gates run SERIALLY** (concurrent tsc+lint+vitest with symlinked node_modules OOMs):
  `npx tsc --noEmit` → `npm run lint` → `npm run audit:skills` (0 findings) → full `npm test`.
- **Green-suite gate.** Because gaps are `it.fails`, the full suite must be **fully green** — no
  `--no-verify`, husky pre-commit passes normally. Verification: `npm test` green AND the probe
  file's `it.fails` count (real gaps) + green-`it` count (FPs) match the reconciliation tally.
- **Goldens byte-identical.** SP0 writes no `src` fix. Never `vitest -u`.
- `gh auth switch --user TheSusort` for gh ops. Dev server on :3000 (or :5173 default).

## Locked invariants (from the epic roadmap)

- **TDD, non-vacuous.** Each `it.fails` probe would pass (i.e. `.fails` would fail) under the
  faithful post-fix behaviour — that is the "would this test fail under the pre-change behaviour?"
  guarantee, expressed via the self-enforcing `it.fails`.
- **Team-symmetric** — not exercised by SP0 (no engine change); downstream SPs must prove it.
- **Model-fidelity vs sim-consumed** — where a faithful model has no sim/DPS consumer yet, the
  probe still asserts the model output; note "inert in sim" in the reconciliation table.

## Execution model

Per `feedback_orchestrated_pr_workflow` and the standing subagent-driven default: writing-plans →
subagent-driven-development. Worktree Sonnet implementers probe one cluster (SP-family) each;
orchestrator reviews each probe batch (verbatim-text check, single-assertion check, dry-run-reason
check) before it lands. SP0 is a single PR (title: `test(skills): SP0 — model-completeness triage
probe corpus`) unless the cluster count warrants splitting. Update memory
(`project_model_completeness_epic`) with the bucket tally + fix-PR DAG on completion.

## Out of scope for SP0

- Any `src` fix (every real gap is left `it.fails` for its SP).
- Frequency caps, team-symmetry proofs, sim/DPS consumers — downstream SP concerns.
- The confirm-GREEN-only set's underlying data-layer facts (import crit/shield-pen values) — not
  re-verified, only their "not a parser gap" status is locked.
