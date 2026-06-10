# Handoff: Combat Engine — Next Steps after the Team ShipSkills Walk

> Paste one of the prompt sections below into a fresh session. Context baseline: the
> **team ShipSkills walk** is MERGED to main as of 2026-06-06 — PR #84, ~30 commits,
> including two live-verification fixes (receiver-less "grants" → all-allies routing;
> combined-total chart line + kill mark), a five-finding CodeRabbit triage, and two
> user-requested UI changes (Enemy Settings / Team panel split; dashed legend swatch).
> Memory file `project_combat_engine_roadmap.md` has the running state.

## End-state goal (user-stated 2026-06-05 — every increment designs against this)

A close-to-full **combat simulator**: a common team where any actor swaps in as the one
under evaluation. After the DPS calc: extend to **healing** (focus a healer), then
**defense** (incoming damage, needs Phase 4 enemy offense), ultimately a **simulator
page** — drop in a full team, get a per-round review of damage/healing/defense per ship.
The engine core already honors this: no hardcoded `'attacker'` (internal `focusActorId`),
per-actor damage map (`ActorDamage`), one `runPlayerTurn(PlayerActorRuntime)` pipeline.

## Current engine state (orient before any prompt)

- `src/utils/combat/`: `engine.ts` (~1250 lines: turn loop, runtime construction,
  `registerActorAbilityStatuses` target routing, per-entry DoT attribution,
  `grantAllyCharges`), `playerTurn.ts` (~1100, the generalized player pipeline —
  renamed from attackerTurn.ts), `statusEngine.ts` (~770, per-owner player stores:
  `selfMaps`/`persistentSelfMaps`/`accumSelfMaps`/`auraSelfMaps`; singular enemy side),
  `triggers.ts` (~430, per-owner listeners + owner-routed executor +
  `buildActorConditionContext`), `state.ts` (`ActorDamage`, `sourceId` on
  DoT/bomb/accumulator entries), `events.ts`, `abilityStatusGating.ts`.
- **Walked team actors**: `TeamActorInput.shipSkills/stats/affinity` (+ adapter-derived
  per-actor rates via `enemyAffinity` input). Team damage reduces enemy HP, reports as
  `RoundData.teamDamage`/`summary.teamTotalDamage`; `totalRoundDamage + teamDamage` =
  round HP delta by construction. Target routing: self → caster; ally/all-allies +
  receiver-less grants → ALL player actors (caster-gated conditions, per-recipient
  family/persistent rules); debuffs/DoTs → enemy. Reactive parity per owner
  (`on-ally-debuff-inflicted` = any other player actor, incl. team `dot-applied`).
- **Parser**: `SkillEffect.target` granular with VERB-AWARE receiver detection
  (`detectGrantScope` + `stripConditionClauses` in skillTextParser.ts): "gains" routes
  by subject, "grants" by receiver, receiver-less grants → all-allies, "grants itself" →
  self, condition clauses can't leak scope. Audit: 85 all-allies + 2 single-ally.
- Golden parity suite: **19 snapshots** (`dpsGoldenParity.test.ts`) — the referee.
  Scenario 19 = walked team actor (hand-verified). Full suite ~1263 tests / 81 files.
- UI: team cards carry stats grid (incl. Defense/HP), affinity + matchup badge, the
  attacker's `SkillSlotList` editor, manual-extras pickers (auto-fill stamping retired).
  Page panels: `EnemySettingsPanel` + `TeamPanel` (CombatSettingsPanel is gone).
  `DPSRoundChart`: dashed combined-total line ("— with team", dashed legend swatch)
  carries the kill mark; tooltip Total = combined when a team exists.
- `docs/skill-model-coverage.md` §5 holds ALL game-verified rules + the team-walk block;
  §6 backlog is current (items 7-9 below). Sim coverage measured 2026-06-06: **94.4%**
  of parsed abilities fully live; ~72% of ALL text mechanics (the gap = heal/shield/
  cleanse/control/revive — the healing/Phase-4 seams).

## Increment menu (recommended order)

| # | Increment | Size | Why |
|---|---|---|---|
| 1 | **Extra End-of-Round Actions** (Nuqtu/Liberator/Chakara) | Small | The last DPS-side mechanic gap with a ready seam: the round loop tolerates 0..N focus turns (`focusTurns` accumulator); Nuqtu's "grants itself 1 extra End Of Round Action" parses today as a no-op charge text. Survey EoR phrasings in ship-skills.csv; decide timing (end of round vs after enemy turn), active-vs-charged firing, charge banking; RoundData aggregation already sums multi-turn damage. |
| 2 | **Per-hit crit checks** (backlog 7) | Small-medium | User-confirmed in-game rule: each hit of a multi-hit skill crit-checks individually; our per-turn `roundCrit` undercounts on-crit trigger frequency ~3× for Enforcer-style ships (now also team multi-hit ships). Needs per-hit accumulator draws + per-hit `ability-performed`; touches crit-multiplier aggregation. KNOWN-DIFF analysis mandatory — this WILL churn goldens (hand-verify each). |
| 3 | **Healing-calc adoption** (own spec cycle) | Phase-sized | The user's stated next milestone once DPS is done. `runPlayerTurn` is the seam: heal/shield abilities currently parse→partition→skip. Scope questions: heal consumption model (self-HP realism — `selfHpPct` is fixed 100 today), focus-a-healer reporting (the focusActorId machinery is ready), HoT/RoT statuses, crit heals, Cheat Death/revive semantics, the existing HealingCalculatorPage's relationship to the engine (adopt vs replace its standalone math). Read the healing page + `docs/skill-model-coverage.md` §1 heal row first. |
| 4 | **Phase 4: enemy offensive actions** (own spec cycle) | Large | Unlocks `on-attacked`/`on-destroyed`, self-debuffs, enemy-buff conditions (24 manual-assumption abilities — the biggest live-coverage win), cleanse/purge consumption, taunt/stealth targeting, multi-enemy, defense-calc adoption, PvP/PvE round limits. The enemy becomes a player-pipeline actor (`runPlayerTurn` generalizes; enemy side of statusEngine de-singularizes). |
| 5 | **Simulator page** (after 3+4) | Phase-sized | The end-state surface: full team in, per-round damage/healing/defense review per ship. The per-actor `ActorDamage` map + per-owner statuses are the data source; needs its own UX spec. |

Smaller backlog (pick up opportunistically, each is self-contained):
- **Backlog 8:** team-cast all-allies ACCUMULATING statuses tick per-active/per-charge on
  the attacker's cadence (commented at `registerActorAbilityStatuses`).
- **Backlog 9:** drain-time/foreign-caster `enemy-debuff` counts exclude ability-sourced
  statuses (snapshot-only; pre-Phase-3 semantics, golden-locked; commented at
  `buildActorConditionContext`). CodeRabbit PR #84 finding, deferred with reason.
- **Warding Screen** persistent-stacking status: still UNVERIFIED in-game (open question
  in persistentStackingBuffs.ts).
- Team manual-extras `selfBuffs` are attacker-granted by design (legacy door) — revisit
  whether they should optionally target the team ship itself when the simulator page lands.

## Hard constraints (unchanged — apply to every increment)

- DPS public API (`DPSSimulationInput`/`DPSSimulationResult`/`RoundData`) stays additive.
- Zero-RNG determinism (`makeRateGate` accumulators; per-actor gate instances; fixed
  listener/queue/recipient order).
- Golden parity (19 snapshots) is the referee — zero churn unless a documented KNOWN-DIFF,
  hand-verified; NEVER vitest `-u` (new scenarios self-write; targeted regeneration =
  delete the entry + re-run).
- Listeners never mutate state; only the engine/executor mutates.
- The engine core never compares against the literal `'attacker'` — key on
  `focusActorId`/owner ids (end-state rule).
- Pre-commit hook runs the full suite (~2 min); no `--no-verify` for code commits.
- docs/ is gitignored — `git add -f` for specs/plans/handoffs/coverage doc.
- No RegExp lookbehind anywhere in src/ (iOS Safari 15 in browserslist).
- Changelog: ONE evolving DPS entry in `UNRELEASED_CHANGES` (user directive) — edit it
  in place; implementer subagents keep adding separate entries by mistake — fold them.

## Game-verified rules (do NOT re-litigate; all implemented)

See `docs/skill-model-coverage.md` §5 for the full set. Added by the team walk:

- Target routing per the user's rule: ally/all-allies AND receiver-less grants → all
  player actors; self → caster; debuffs → enemy. "This Unit grants X" (no receiver) is
  a team-wide grant (Oleander-style supports) — verified live; "This Unit gains X" is self.
- Attribution model: every point of enemy HP decline belongs to exactly one source actor.
- Conditions on a granted ability evaluate against the CASTER's context; the status lives
  on each RECIPIENT (decrements at the recipient's post turn).
- A team ship's inflictions are ally-inflictions from every OTHER player's perspective
  (including the attacker's), and vice versa.
- Echoing Burst gathers ALL players' direct damage; bursts land in the caster's
  detonation channel.
- Persistent stacking (Defense Shred/Blast/Overload/Titanite), infliction-event
  definition, family tier rule, drain-time conventions: unchanged from Phase 3.

## Workflow

Full superpowers flow for increments 3-5 (brainstorming one question at a time → spec in
`docs/superpowers/specs/` → spec-reviewer loop → user gate → writing-plans →
subagent-driven implementation on a `feat/` branch, two-stage review per task). Increments
1-2 can run a lighter spec. Golden discipline per task; live verification with the user's
imported fleet at the end (dev server origin localhost:3002 holds the 212-ship fleet —
stale Vite instances may occupy 3002-3004, reuse the 3002 one; pages with 200+ ships
exceed snapshot token limits, use evaluate_script; ShipSelector option clicks need a full
pointerdown→click MouseEvent sequence). Watch for CodeRabbit triage on the PR before
merging (triage → fix/skip-with-reason → reply in-thread → wait for its re-review →
merge when clean; merge commits, branches kept).
