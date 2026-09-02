# Reactive-trigger promotion — Phase 3 design (2026-07-04)

**Source:** the skill-model gap epic's deferred Phase 3 (`docs/superpowers/specs/2026-07-03-skill-model-gap-epic-design.md` "Out of scope"; sweep family C in `docs/skill-model-gap-sweep-2026-07-03.md`). The epic (Phase 1 #205–#214, Phase 2 #215–#218) is complete; PR7/PR8 dropped to the data layer.

**Scope (user-locked):** family C reactive-trigger promotion **only** — the ~29 ships where a reactive event and its effect share a sentence but the effect's *builder* defaults to `on-cast`. The deep one-offs allowlisted during the epic (damage-to-DoT conversion, overheal-redirect, defense-substitution, forced-affinity, charge-loss immunity, on-ally-shield-destroyed) stay deferred.

**Depth (user-locked):** promote tag-only ships AND build new engine eventCtx capture **where a precedent exists** (`repairerId` / `damagedAllyId` / `repairedAllyIds` patterns). Allowlist-defer only ships whose reactive event cannot produce the needed actor from the event stream at all.

## The two-layer model

A family-C ship works only when BOTH layers are correct. Most sweep entries fail at Layer 1; some need Layer 2 as well.

**Layer 1 — builder tag inheritance (parser, `buildShipAbilities.ts`).** The reactive-trigger detectors are wired richly into the **buff/debuff** (`mergeBuff`, ~:1963-2100) and **heal/shield** (~:1265-1315) builders, but not the others:

- `damage` builder (:882) resolves only round-boundary triggers (`detectStartOfRoundTrigger ?? detectEndOfRoundDamageTrigger ?? detectRoundStartContinuationTrigger ?? 'on-cast'`) — **no on-attacked / damage-reaction path at all.** Largest single gap.
- `additional-damage` / `secondary` (:968) — hardcoded `'on-cast'`.
- `cleanse` (:1411) — only `detectCritRepairTrigger` (on-ally-critically-repaired).
- `purge` (:1455) — passive slot only, narrow set (on-attacked / end-of-round / killed-by-direct); no ally-attacked.
- `control` / buff-steal misc (:1722, :1750) — hardcoded `'on-cast'`.

Fix = extend each builder's trigger-resolution chain, using the heal/shield chain as the template.

**Layer 2 — engine eventCtx capture (`triggers.ts` / `events.ts`).** Some reactive events fire but do not carry the actor the effect needs to target, so even a correctly-tagged ability can't route:

- `on-ally-debuff-inflicted` (:365-378) — captures neither which ally inflicted nor which enemy was debuffed (the `debuff-applied` event carries `targetId`, but the listener ignores it).
- `on-enemy-cleansed` (:634-640) — no cleanser id (`cleanse-performed` carries `casterId`/`count` only, no per-ally victim).
- `on-ally-critically-repaired` (:390-402) — no repaired-ally id.
- `on-ally-destroyed` / `on-enemy-destroyed` (:606, :614) — no destroyed-actor id.

Fix = add capture following the `on-enemy-repaired`→`repairerId` (:622-632, Zosimos precedent) and `on-ally-attacked`→`damagedAllyId` (:533-572) templates. Team-symmetric by construction. Where the event stream genuinely cannot produce the actor, the ship is allowlist-deferred (`no-capturable-actor`).

**Not modeled at all:** the `if-target-has-shield` phrasing (APEX / Malvex variants) has no trigger in the codebase. Treat as a new *condition gate* on an existing trigger, not a new event — or allowlist-defer if it needs a target-state read the stream lacks. PR0 decides.

**Already closed:** Guardian / Isha `on-crit-received` — shipped as an FP with test locks in PR5 (#212). Excluded from Phase 3.

## PR0 — the triage gate (first, blocking, no behavior change)

The epic's recurring lesson is the false-positive rate: four-plus families collapsed under scrutiny once the full `Ability.scaling` / `target` / slot-routing was accounted for. PR0 front-loads that discovery instead of hitting it mid-fix.

PR0 writes **one red test per family-C ship**, driven through the production `buildShipAbilities` / `audit:skills` slot routing (never against a hand-built ability array — the dump-fidelity trap). Each ship sorts into exactly one bucket:

| Bucket | Meaning | Action |
|---|---|---|
| **FP** | red test passes pre-change | document + audit allowlist row with reason; no fix |
| **tag-only** | trigger + eventCtx already exist; builder just doesn't inherit | Layer-1 fix only |
| **needs-capture** | real gap; new eventCtx capture has a precedent | Layer-1 + Layer-2 fix |
| **no-capturable-actor** | event stream cannot produce the needed actor | allowlist-defer with reason |

PR0's deliverable is the failing-test corpus plus the classified **ship→bucket table**, which *becomes* the fix-PR DAG below. PR0 ships no `src` behavior change (tests + docs + any allowlist rows for confirmed FPs only).

**Red CI is accepted for the duration of Phase 3** (user decision, 2026-07-04: no deploy until Phase 3 is done). So PR0 commits the whole red+green probe corpus in one file rather than deferring the real-gap red tests; each cluster fix-PR flips its reds green. Because the husky pre-commit hook runs the full suite, commits carrying red tests use `git commit --no-verify` after `npm run lint && npx tsc --noEmit` pass manually.

## Provisional fix-PR clusters (event-owned)

Provisional — PR0 confirms membership and some clusters may shrink or evaporate. Each cluster owns one event's eventCtx capture (if any) plus every builder that consumes it, minimizing conflict on `triggers.ts` / `events.ts`.

| # | Cluster (owning event) | Candidate ships | Layers | Notes |
|---|---|---|---|---|
| 1 | `on-attacked` → **damage & purge** builders | Bizon, Purifier, Quixilver, Iridium, Malvex, Warden, Nyxen, Sansi, Panguan | L1 | Biggest gap: damage builder has no reaction path. Heal/shield among these are likely FP (already wired via `damageReaction`) — triage separates. Sansi "when hit" / Panon "if directly damaged" phrasings included. |
| 2 | `on-enemy-repaired` consumers | Ruiner | L1 + detection | Trigger + `repairerId` exist; the Bomb-II applier is unwired (`detectDamageReactionTrigger` doesn't recognize "on any enemy performing a repair"). Rides the per-enemy cap (`owner:ability:repairerId`). |
| 3 | `on-ally-debuff-inflicted` which-ally capture | Oleander | L1 + L2 | Capture which ally/enemy (precedent: `repairedAllyIds`). Per-ally RoT grant emitted as on-cast manual toggle today. Rides the per-ally cap. |
| 4 | `on-enemy-cleansed` capture + consumers | Nuqtu | L1 + L2 | Cleanser-id capture + cleanse-trigger wiring + once-per-round cap. |
| 5 | `on-kill` / `on-enemy-destroyed` actor capture | Harvester, Ravager, Howler (+ triage) | L1 + L2 | Capture destroyed actor (no id today). |
| 6 | `on-bomb-detonated`-scoped effects | Demolisher, Valkyrie, Lingshe | L1 | `on-bomb-detonated` trigger exists (`BOMB_DETONATE_RE`); wire consumers. |
| 7 | ally-crit / `on-ally-critically-repaired` which-ally | Cultivator, Hayyan, Morao, Crocus, Madax, Obsidian, Valiant, Rikra, Vindicator, Amartya (+ triage) | L1 / L2 | Grab-bag from the sweep's "20 ships"; triage scatters these across events 5–7 and FP. |
| 8 | `if-target-has-shield` gate | APEX, Malvex (variants) | NEW trigger/gate | No such trigger exists. New condition gate on an existing trigger, or allowlist-defer if it needs an unavailable target-state read. |

**Frequency caps ride their reactive PR.** Once an applier/trigger exists, the cap (`oncePerRoundConsumed`, keyed `owner:ability` today; extend to `:target` / `:repairerId` / `:allyId`) is the small add-on — no standalone cap PR. This absorbs the PR12b decomposition (Ruiner / Oleander / Nuqtu) that memory recorded as the Phase-3 starting point.

## Ordering

PR0 first (blocking) — its table finalizes the DAG. Then clusters 1–8 are largely independent once their event's capture lands → parallel worktrees, **except** any two clusters that touch the same event's capture must serialize. Cluster 1 (damage-builder reaction path) is the highest-value and touches only Layer 1, so it can go first among the fixes.

## Invariants (inherited from the epic; every PR)

- **Verification protocol (binding):** red test FIRST, through production `buildShipAbilities` slot routing. Passes pre-change → STOP-AND-REPORT as FP (document + allowlist row). No fix without a red test.
- **Non-vacuity bracket:** revert the src fix, re-run the new test, confirm red (per `feedback_orchestrated_pr_workflow` §3). Tests at parser, combat-integration, and DPS/healing-parity layers as applicable.
- **Team symmetry (`feedback_engine_team_symmetry`):** every new eventCtx capture and trigger routing acts identically on either side (`on-enemy-repaired` / `on-ally-attacked` captures are the symmetric template).
- **Golden suite is the regression gate:** audited churn ONLY where a named ship's behavior legitimately changes; the PR lists exactly which ships moved and why; everyone else byte-identical. Never `vitest -u`.
- **Audit stays at 0 findings:** each promoted event ships/updates its keyword→handled rule in `scripts/auditSkills.ts`; each FP/deferral gets an allowlist row **with a reason**. A bare allowlist the audit doesn't flag is stale — add the rule to make it meaningful (epic `instead-replacement` precedent).
- **Implementers:** Sonnet, worktree-isolated; `cp` main's `.env` + `docs/` in; `npm run prepare` in fresh worktrees (husky hook). Orchestrator reviews every diff; one adversarial reviewer as the merge gate (the epic's PR10 steal-before-purge defect proves it earns its keep). Reviewer briefs carry the HARD read-only constraint block; merge authority stays with the orchestrator.
- **Changelog:** user-facing behavior changes get a plain-English `UNRELEASED_CHANGES` entry in `src/constants/changelog.ts` before commit.

## Known engine limitations to respect (do not regress)

- **Start-of-turn buff-grant alternation** (Cobalt): intent drains happen after the owner's cast, so a re-grant landing while the buff is active is swallowed → every-other-turn boost. Pinned by a KNOWN-LIMITATION test in `cobaltStartOfTurnCharge.integration.test.ts`. Do not silently flip.
- **FrontLine charged-cast-reaction shield** stays a flat un-mitigated attack% while its paired damage is mitigated/crit-able (documented `skillTextParser.ts` ~:2111). Real fix needs eventCtx plumbing threading the dealt amount into the reactive-shield executor. Out of Phase 3 scope; do not regress.

## Out of scope (locked, unchanged from the epic)

- Reactive **on-death** (Faust, Paracelsus); **enemy-charged-skill** reactions (FrontLine, Curator).
- **Stat-comparison gates** (Bayah, Chakara, Cobalt); **multi-target hit counts** (Berserker, Tygr); **named-DoT stack counts / scaling** (Belladonna, Anemone, Snakeroot).
- The **deep one-offs** already allowlisted during the epic (damage-to-DoT conversion, overheal-redirect, defense-substitution, forced-affinity, charge-loss immunity, on-ally-shield-destroyed).
- Any family-C ship triaged **no-capturable-actor** → allowlist-defer with reason (candidate future work, not this phase).
