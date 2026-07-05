# Handoff — Model-Completeness Epic, SP0 (Discovery/Triage)

**Written:** 2026-07-05 (end of session). **For:** a fresh session starting SP0.
**Main at handoff:** `be9abf56` (epic roadmap commit; local, not pushed).

## Where things stand

- The **skill-model-gap epic is fully merged** (Phase 1 #205–#214, Phase 2 #215–#218, Phase 3
  reactive-trigger promotion #219–#229). Main was green at `dcf8468f` (4199 tests) before the
  roadmap commit.
- The **model-completeness epic** was brainstormed and its roadmap ratified + committed:
  `docs/superpowers/specs/2026-07-05-model-completeness-epic-roadmap.md` (be9abf56).
  Goal (user-locked): **everything faithfully — zero real-gap allowlist deferrals**, engine
  known-limitations included. Decomposed into **SP0 (triage) + SP-A…SP-G**, infra-ordered.
- **SP0 is the entry point** and is NOT started. This handoff is its brief.

## What SP0 must do

Produce the **authoritative gap inventory** the downstream sub-projects' specs depend on.

For every remaining allowlist entry + every "out of scope" family in the roadmap, write a probe
**through PRODUCTION `buildShipAbilities` slot routing** (NOT a raw parser dump) asserting the
intended faithful behaviour:

- **RED** = real gap → assign to SP-A…SP-G with the exact ship.
- **GREEN** = already-correct false positive → lock it as a green FP test, no build, no stale
  allowlist row.

**Output:** a probe corpus test file + a reconciliation table mapping every real gap → sub-project
+ ship list, including the ships not yet identified for the SP-F deep one-offs (overheal-redirect,
defense-substitution, forced-affinity, charge-loss-immunity, on-ally-shield-destroyed).

This mirrors **Phase 3's PR0** exactly — use it as the template:
- Plan: `docs/superpowers/plans/2026-07-04-reactive-trigger-promotion-phase3-pr0-triage.md`
- Probe corpus: `src/utils/abilities/__tests__/reactiveTriggerPromotionTriage.test.ts`

## The gap list to triage (from the roadmap — do not re-derive)

**Real gaps to probe (RED expected → assign to SP):**
- **SP-A** incoming-reduction gates: Malvex (self-shield "takes 10% less when Shielded"), Voron
  (self-DoT "20% less from DoT ticks").
- **SP-B** new reactive triggers: Paracelsus (on-death 50%-maxHP — trivial `hpBasisPct` consumer),
  Faust (on-death), Curator (on-enemy-charged-skill), FrontLine (on-enemy-charged reaction —
  distinct from its G shield-amount item), Ravager (on-own-debuff-resisted), Nosorog ("removes a
  debuff" — **verify against PR-H `on-own-cleanse`; may already be GREEN**).
- **SP-C** stat-comparison gates: Bayah (Crit Power vs target), Chakara, Cobalt.
- **SP-D** count gates: Berserker (≥3 enemies hit), Tygr; named-DoT-stack counts: Belladonna
  (3+ Acidic Decay → Stasis), Anemone, Snakeroot.
- **SP-E** DoT transforms: Voron (damage→DoT transform), Belladonna (Corrosion→Acidic Decay, team).
- **SP-F** deep one-offs: Panon (instead-branch), Lingshe (Bomb countdown-reduction + forced
  detonate), + the five one-off mechanics above (identify their ships).
- **SP-G** engine known-limitations (probe as KNOWN-LIMITATION pins, flip in G): Cobalt
  (start-of-turn drain-ordering — see `cobaltStartOfTurnCharge.integration.test.ts`), FrontLine
  (reactive-shield amount), Meatshield/Kinetik/Cinya (recurring per-turn grants), Butcher
  (positional-path Rage sourceId).

**Stays allowlisted — confirm GREEN, do NOT build (data-layer / harness-FP):**
always-crit (Asphodel, Tormenter); innate shield-pen (Crucialis, Curator, FrontLine, Guardian,
Liberator, Medved, Provider, Sustainer, Vindicator, Xcellence); Nosorog reflect (harness FP);
Rikra / Madax / Oleander clause-scoping; Tormenter base-damage; Valkyrie accumulate-detonate.

## Key files

- `scripts/auditSkills.ts` + `scripts/auditSkills.allowlist.ts` — the audit + authoritative
  deferral list (each closed mechanic removes its row + adds a keyword→handled rule).
- `src/utils/skillTextParser.ts`, `src/utils/abilities/buildShipAbilities.ts`,
  `src/utils/combat/triggers.ts`, `src/utils/combat/events.ts` — the parse→build→trigger→engine
  spine SP0's probes exercise.
- `docs/ship-skills.csv` — the parser's source of truth (NOT `ships.ts`, which is untagged /
  differently-worded — deriving patterns from it is a trap). Resolve refit-active passive via
  `getShipSkillRows()`.

## Workflow (per `feedback_orchestrated_pr_workflow`)

1. Brainstorm SP0's focused spec (`docs/superpowers/specs/2026-07-05-sp0-...-design.md`) →
   writing-plans → subagent-driven execution.
2. **Dump-fidelity trap:** red probe through PRODUCTION slot routing FIRST; passes pre-change →
   STOP-AND-REPORT as FP. Verify ENGINE consumption, not just a model field (three Phase-3 sweep
   families were dump-fidelity FPs; PR-A's Quixilver/Malvex leech-shield mis-triage is the lesson).
3. **Gates SERIALLY** in a warm worktree (concurrent tsc+lint+vitest with symlinked node_modules
   OOMs). Per-PR gate that gave a clean signal in the Phase-3 merge: tsc + lint + `audit:skills`(0)
   + full `npm test`, confirming the ONLY failing file is the triage probe corpus.
4. Worktree provisioning: `cp <main>/.env .env` + copy ALL `docs/*.csv` (ship-skills, ship-targeting,
   bios) + the combat-system `.md`; run `npm run prepare` (husky) so commits don't abort.
5. `gh auth switch --user TheSusort` for gh ops. Dev server on :3000 (or :5173 default). Never
   `vitest -u` goldens.
6. **Red CI is accepted for the epic duration** if the user opts to commit the probe corpus with
   reds (Phase-3 precedent: `git commit --no-verify` after lint+tsc pass manually). GitHub CI only
   gates `npm audit` + Netlify, NOT tests — so reds don't block, but Netlify auto-deploys main on
   each merge.

## Open questions for SP0 to resolve (flagged during brainstorming)

- **Nosorog "removes a debuff"** — verify vs PR-H's `on-own-cleanse` (likely already covered → FP).
- **Voron A↔E coupling** — its incoming-reduction (A) is only fully faithful once the damage→DoT
  transform (E) is modeled; SP0 should decide whether Voron lands split across A+E or together.
- Whether to commit the SP0 probe corpus with reds (red-CI-accepted) or land SP0 green as pure
  triage scaffolding — user call at SP0 kickoff.

## Pointers

- Epic roadmap: `docs/superpowers/specs/2026-07-05-model-completeness-epic-roadmap.md`
- Memory: `[[project_model_completeness_epic]]`, `[[feedback_orchestrated_pr_workflow]]`,
  `[[project_skill_model_gap_sweep]]` (Phase 1–3 record + stacked-PR merge-loop lessons),
  `[[project_skill_text_source_of_truth]]`, `[[project_combat_engine_current_state]]`.
