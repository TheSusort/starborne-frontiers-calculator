# Sub-project F: Pre-Fight Stat Modifiers (Squad Leaders + Pre-Fight Ship Passives)

## Context

The combat-realism epic (sub-projects A–I) has one sub-project never started: **F — pre-fight stat modifiers**. Two halves:

1. **Squad leaders** — data fully shipped (`src/constants/squadLeaders.ts`: 30 leaders, 115 effects — 96 `kind:'stat'`, 19 `kind:'modifier'`, 2 conditional) with a browse page, but **zero engine consumers** and no selection state anywhere.
2. **Pre-fight ship passives** — Lionheart ("At the start of combat, this Unit grants all adjacent allies 10% of its HP"), Centurion ("gains 500/750/1000 attack per adjacent ally"), Enforcer/Defiant/Stalwart (self-stats when adjacent to a Supporter). All silently ignored by the parser today. Bonus: Chimei "starts combat fully charged" is parsed (`detectFullyCharged`) but `simulateBattle` hard-codes `startCharged: false`.

Scope (user-confirmed 2026-07-02): **full F**, **model all effect kinds** (incl. modifier channels + shield seeding), **battle simulator only** (DPS/healing calculators untouched). Closing F leaves only sub-project I (scoping pass) open in the epic.

### Locked game rules (binding)
- `all-allies` leader effects → only ships of the leader's faction on its own team. `all-enemies` effects → ALL opposing ships, **gated on ≥1 leader-faction ship on the leader's own team**.
- Leader bonuses + pre-fight passives are hidden, permanent, non-purgeable, **not reset on death**. Percentages apply to final gear-resolved pre-fight stats.
- maxHp is only ever modified pre-fight (no in-fight HP buffs exist).
- Team symmetry mandatory. Leader stages are additive (stage III = I+II+III).
- (user, 2026-07-02) **Only legendary stage-3 effects may target the opposing team.** Benefit-phrased "-N% incoming (crit) damage" effects are ally-side faction protections — four mis-tagged entries fixed in F1 (Overseer III, Midas II, Optimizer III, Architect II), pinned by a data-invariant test.
- (user, 2026-07-02) **Terminology:** SL/skill text "Crit Power" = the `critDamage` STAT. Text "incoming/outgoing crit damage" = a crit-conditional damage MODIFIER (like incoming/outgoing damage, applied only when the hit crits) — NOT the critDamage stat. Negotiator III re-modeled accordingly (stat → `outgoingCritDamage` modifier).
- (user, 2026-07-02) When both teams' leaders touch the same stat on one ship (own buff + opposing legendary-3 debuff), percentages **sum** before one apply (`base × (1+(a+b)/100)`) — documented assumption, not game-verified.

### Architecture (settled)
One pre-fight layer invoked once in `simulateBattle` (`src/utils/calculators/battleSimulator.ts:620`) right after `playerPlans`/`enemyPlans` are built (:642–647), **mutating `PlacementPlan.stats` in place** before actors/roster are constructed — maxHp, currentHp seed, turn order, landing math all inherit automatically (roster maxHp = plan.stats.hp at :813–829; currentHp seeded at `state.ts:176`). Ordering: **(1) squad-leader pass → (2) ship-passives pass**, the latter computed simultaneously from a frozen post-leader snapshot (no cascading between passives). No leader + no pre-fight passive = exact no-op → engine untouched, all goldens byte-identical.

Effect delivery, three mechanisms:
- **Stat effects** → fold into plan stats (F1/F5).
- **Modifier-channel effects (17 unconditional)** → new optional `CombatActor.preFight?: PreFightCombatModifiers` baseline (NOT statuses — statuses would leak into logs/purge/cleanse and half the channels don't exist in `calculateBuffTotals`; the `?? 0` static-field pattern matches D-PR3/D-PR4 precedent), folded additively at the exact sites regular buff channels are consumed (F3).
- **The 2 conditional Marauder effects** ("direct damage to secondary targets") → explicitly **unsimulated in v1**, surfaced in the UI.

---

## PR sequence (5 PRs; F4 parallel-safe with F1–F3; F5 depends on F1+F4)

### PR F1 — pre-fight module + squad-leader resolver (stat effects) + plumbing

New `src/utils/combat/preFight/`:
- **`types.ts`**: `PreFightStatBlock` (structural 10-field stat shape satisfied by `DerivedCombatStats`); `PreFightCombatModifiers` `{ outgoingDamage, outgoingCritDamage, incomingDamage, incomingCritDamage, outgoingHeal, incomingHeal, startingShieldPctOfHp }` (all additive pct-points, defaults 0) + `emptyPreFightModifiers()`; `PreFightUnit { id, side, faction, stats (by-ref to plan.stats), modifiers, unsimulated: string[] }`; `PreFightPass = (ctx: {player, enemy}) => void`; `SquadLeaderSelection { faction, name, stage: 1|2|3 }`.
- **`index.ts`**: `runPreFight(ctx, passes)` — ordered pass runner.
- **`squadLeaderPass.ts`**: `squadLeaderPass({player?, enemy?})`. One `applyLeaderForSide(own, opposing, sel)` helper for both sides (symmetry by construction). Semantics: lookup `SQUAD_LEADERS[sel.faction]` by name (throw on unknown); active effects = `stages.slice(0, stage).flat()`; `all-allies` → own-team same-faction units; `all-enemies` → all opposing units **iff** own team has a leader-faction ship; `condition`/`kind:'other'`/`per-round` → `unsimulated` (verbatim text). Stat math per recipient per stat: `final = base × (1 + Σpct/100) + Σflat`, floored at 0 (order-independent). Modifier effects accumulate into `unit.modifiers` (map `outgoingRepair`→`outgoingHeal`) — reported unsimulated until F3 consumes them.

`src/utils/calculators/battleSimulator.ts`:
- `BattleSimulationInput` + `playerSquadLeader?/enemySquadLeader?: SquadLeaderSelection`.
- `PlacementPlan` + `faction: FactionName` (from `p.ship.faction` in `planPlacement`).
- After :647: build `PreFightUnit`s (stats by reference), `runPreFight(ctx, [squadLeaderPass(...)])`, keep `preFightById` map for F3.
- `BattleResult` + optional `preFight?: { unsimulated: {actorId, name, texts}[] }` — attached only when a leader was selected.

Tests: `preFight/__tests__/squadLeaderPass.test.ts` (stage additivity, faction gate, enemy gate, flat/pct math + clamp, side symmetry, skip rules, full-data classification sweep) + `calculators/__tests__/battleSimulatorSquadLeaders.test.ts` (no-leader deepEqual byte-identity; legendary stage-3 leader shifts faction ships' roster maxHp + damage; enemy-gate integration). No engine files touched; no changelog (not yet user-visible).

### PR F2 — UI picker + persistence + docs

- **`src/components/simulator/SquadLeaderPicker.tsx`**: three `Select`s (`src/components/ui/Select.tsx`) — Faction (+None) → Leader (3 rarities) → Stage I/II/III — plus a `useMemo` applied-effects preview running the pure resolver over the current board (aggregate lines like "+20% Attack → 3 Marauder ships"; enemy lines; amber not-simulated badge per `unsimulated` text; warning when the faction gate is unmet: "No {faction} ship on this team — leader inactive"). Reuse effect-line rendering from `SquadLeaderCard.tsx` where exportable.
- **`src/pages/SimulatorPage.tsx`**: render picker beneath each `PlacementBoard`; per-side `SquadLeaderSelection | undefined` state persisted to localStorage (`simulator-squad-leader-player`/`-enemy`, lazy-init + validate against `SQUAD_LEADERS`); `handleRun` threads selections into `simulateBattle`; render `result.preFight.unsimulated` notice above playback.
- `src/constants/changelog.ts` `UNRELEASED_CHANGES` entry + `src/pages/DocumentationPage.tsx` simulator section (what applies, faction gate, what's not simulated).

### PR F3 — modifier channels + shield seeding (engine plumbing)

- **`src/utils/combat/state.ts`**: `CombatActor.preFight?: PreFightCombatModifiers`; `createActor` accepts it; shieldPool seed at :177 becomes `partial.stats.hp * ((partial.preFight?.startingShieldPctOfHp ?? 0) / 100)` — solves "start combat shielded N% of max HP" with hp already post-leader.
- **`src/utils/combat/engine.ts`**: thread `preFight?` through `CombatEngineInput` (focus), `TeamActorEngineInput`, `enemyAttackers[n]` into the three `createActor` sites (~:1284/:1351/:1424); `buildTurnArgs` (~:3968) passes it to `runPlayerTurn`; `victimIncomingModifiers` (~:3539) adds `+ (victim.preFight?.incomingDamage ?? 0)` (rides the D-PR12 per-victim channel); `incomingReductionFor` (~:3667) adds `-(victim.preFight?.incomingCritDamage ?? 0)` when `didCrit`, mirrored at the aggregate crit-family site (~:5666); pre-first-turn heal fallback (~:2131) falls back to `preFight?.incomingHeal` (audit the `triggers.ts:1852` sibling).
- **`src/utils/combat/playerTurn.ts`**: new optional `preFight` arg; after `resolveSelfBuffTotals` (~:947) fold `outgoingDamage`→outgoingDamageBuff and `outgoingHeal`/`incomingHeal`→heal buffs. **`outgoingCritDamage` must NOT fold into critDamageBuff** (that's the Crit Power stat — see terminology rule): it is a crit-conditional damage modifier, applied as an extra multiplier on the crit fraction of outgoing damage only — implement at the same crit-family damage sites as `incomingCritDamage` (attacker-side term alongside the victim-side one), not via `effectiveDamageStatsOf`. Everything else flows through `effectiveDamageStatsOf` into existing consumers; enemy attackers walk the same path (symmetry).
- **`battleSimulator.ts`**: attach `preFight: preFightById.get(id)?.modifiers` (conditional spread, only when non-zero) to focus input, teamActors, enemyAttackers. `squadLeaderPass` moves unconditional modifier effects out of `unsimulated` (only the 2 Marauder conditionals remain).
- Documented accepted gap (D-PR12 precedent): victim-side channels wired at positional per-victim sites only; the non-positional aggregate dummy path doesn't read them (unreachable with a leader in the battle sim).
- Tests (patterns: `shieldGrantBattleSim.test.ts`, `positionalDamage.integration.test.ts`): outgoing damage scales `(1+pct/100)`; victim incoming via `__testTapVictimEnemyModifiers`; crit-only reduction (crit 100); shield seed absorbed before HP; heal channels incl. pre-first-turn receipt; absent `preFight` → shieldPool 0 + folds inert.

### PR F4 — pre-fight ship-passive parser + types + audit + editor surface (no sim behavior change)

- **`src/types/abilities.ts`**: `AbilityTrigger` + `'pre-combat'` (annotation-only — NOT in `LIVE_TRIGGERS`, never bound by engine listeners); `AbilityType` + `'pre-combat-stat'`; new config: `{ type:'pre-combat-stat'; stat:'hp'|'attack'|'crit'|'hacking'; value: number; valueKind:'flat'|'percent-of-own'|'percent-of-donor'; perAdjacentAlly?: boolean; requiresAdjacentRole?: ShipRoleCategory }`. Target uses existing `'self'`/`'adjacent-allies'`.
- **`src/utils/skillTextParser.ts`**: `parsePreCombatStatGrants(text)` with three corpus-anchored patterns: (A) donor HP grant `/at the start of combat,?\s*this unit grants all adjacent allies (\d+)%\s*of its (?:max\s*)?hp/i`; (B) `/…gains (\d[\d,]*)\s*attack per adjacent ally/i`; (C) role-gated self grants, both orderings (Enforcer trailing gate, Defiant/Stalwart leading gate), stat-list split via `/\+?(\d+)%\s*(crit rate|hacking|hp|attack)/gi` — crit→flat points, hacking/hp/attack→percent-of-own. Verified non-matches: Centurion's Core-Charge sentence, Tier-B "gains N stacks of X" texts, Madax (deliberately out of scope).
- **`src/utils/abilities/buildShipAbilities.ts`**: emit one ability per grant in `abilitiesFromText` (no slot gate; passive-slot refit resolution already handled by `getSkillRowForSlot`). DPS ignores the type by construction (`modifierTotalsFromAbilities` type-filters; extractors/status registration/reactive listeners never match it).
- **`src/utils/abilities/abilityFixtures.ts:98-117`**: replace the illustrative LIONHEART fixture with the real parser shape + equality test against `buildShipAbilities` output.
- **`scripts/auditSkills.ts`**: new `pre-combat-stat` Rule (loose keyword hitting exactly Lionheart/Centurion/Enforcer/Defiant/Stalwart; `handled = hasType('pre-combat-stat')`) → 0 new findings, no allowlist entries.
- Compile-forced editor surface: `AbilityTypePicker.tsx` (`TYPE_LABELS` + `CATEGORIES`), `abilityDefaults.ts` (`DEFAULT_TARGETS` + `makeDefaultAbilityConfig` case), `AbilityCard.tsx` (label map + small form case). simCoverage: `NOT_SIMULATED_TYPES` stays empty (it IS simulated); do NOT add to `PASSIVE_NOOP_TYPES`.
- Tests: parser units on exact CSV texts (incl. full multi-sentence Enforcer row) + negatives; **update `buildShipAbilities.test.ts:2444`** (Defiant "left unparsed" test now asserts the new ability too); add enum members to `VALID_TYPES`/`VALID_TRIGGERS` in `buildShipAbilities.coverage.test.ts:12-36`. Audit any snapshot churn deliberately (ability-id shifts for the 5 ships possible; DPS goldens untouched — they never emit/consume this type… verify, never `vitest -u`).

### PR F5 — passives sim application + Chimei + integration

- **`src/utils/combat/preCombatPassives.ts`**: `applyPreCombatShipPassives(plans)` per side (registered as the second pass in the F1 seam). Algorithm: freeze post-leader snapshot (`Map<id, {...stats}>`); adjacency via existing `adjacentAllyIds` (`src/utils/combat/adjacency.ts:21`, hex `neighbors()` — same definition as Protection/redirect); per plan × passive-slot `pre-combat-stat` abilities: role gate via `matchesRoleCategory` (unknown role never matches — keeps role-less test fixtures byte-identical), amount from snapshot (`flat` | `percent-of-own` | `percent-of-donor`, × adjacent count when `perAdjacentAlly`), recipients self or adjacent plans; accumulate deltas, then apply `plan.stats[stat] += delta`. Death-reset: nothing to do (base stats written once).
- **`battleSimulator.ts`**: `PlacementPlan` + `role: ShipTypeName | undefined` (from `p.ship.type`); register the passives pass after `squadLeaderPass`; **Chimei**: `planPlacement` computes `startCharged: detectFullyCharged(getShipSkillRows(p.ship).map(r => r.text))` (refit-gated automatically) and threads it to the three hard-coded `startCharged: false` sites (:675/:707/:754) + the `initialCharge` map (~:838).
- Tests: `preCombatPassives.test.ts` (donor-scaling on/off neighbours, count-scaling 0/1/3, role-conditional incl. category-prefix match + undefined role, simultaneity — Defiant's +20% excludes Lionheart's grant, no-passive squads deep-equal) + `preCombatBattle.integration.test.ts` (Lionheart neighbour roster maxHp; granter dies → grant survives; Centurion round-1 damage; Chimei fires charged round 1, refit<2 → not seeded; non-regression deepEqual).
- Changelog + DocumentationPage additions for pre-fight passives.

---

## Workflow & verification

- **Execution**: subagent-driven development (default per memory), spec saved to `docs/superpowers/specs/2026-07-02-prefight-modifiers-f-design.md` (`git add -f`, `--no-verify` — docs gitignored). Work on the main checkout (fresh-worktree esbuild crash; if a worktree is unavoidable, `cp` main's `.env` in first). `gh auth switch --hostname github.com --user TheSusort` before pushing.
- **Gates every PR**: `npx tsc --noEmit` · `npm run lint` (max-warnings 0) · full `npm test` with **zero snapshot churn** (`git status` on `__snapshots__`; never `vitest -u`; audited exceptions only in F4) · `npm run audit:skills` → 0 findings.
- **End-to-end spot-check (after F2 and F5, dev server :3000)**: place 2 Marauder + 1 off-faction ship, pick legendary Marauder leader stage III → faction ships' maxHp/damage shift, off-faction unchanged, enemy reductions active only while a Marauder is placed, no-leader rerun identical to pre-change. Then position Lionheart with neighbours → neighbour maxHp +10% of Lionheart's HP in the roster; skill UI shows the new ability with no "Not simulated" badge.
- **Memory close-out**: after F5 merges, update `project_squad_leaders_subproject_f` / `project_combat_realism_epic` (F CLOSED; only I remains).
