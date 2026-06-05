# Combat Engine: Team ShipSkills Walk

**Date:** 2026-06-05
**Status:** Approved design
**Baseline:** `main` after PR #83 (combat-engine Phase 3: reactive triggers)
**Builds on:** `docs/superpowers/specs/2026-06-04-combat-engine-phase2-design.md` (real actor
turns; "Team-ship depth" decision deliberately deferred this walk) and
`docs/superpowers/specs/2026-06-05-combat-engine-phase3-design.md` (listener/intent machinery,
ally-infliction events).

## Problem

Team ships are real speed-ordered actors (Phase 2) but their behavior is hand-stamped
`SelectedGameBuff` lists (`TeamActorInput.selfBuffs`/`enemyDebuffs`), auto-filled from
`buildSkillBuffAutoFill` on ship pick. Three classes of error:

1. **Over-grant.** The parser's `SkillEffect.target` is binary self/enemy, so a team ship's
   pure self-buffs ("this Unit gains Attack Up") are granted to the attacker.
2. **Missing mechanics.** Team DoTs don't exist (the `on-ally-debuff-inflicted` listener's
   `dot-applied` seam is dead code); team charge-grant skills (Hermes) are approximated by
   the manual `allyChargePerRound`; team damage doesn't exist, so HP-threshold gates flip
   later than in-game; team ships' own reactive abilities (a team Hemlock's charge cadence)
   are unmodeled.
3. **No condition gating.** Stamped lists carry no live condition contexts; a team ship's
   gated grants are effectively assume-active.

This spec makes team ships walk their actual parsed `ShipSkills` — the full-actor
generalization the Phase 2 spec reserved as "its own later spec".

## Decisions (user-confirmed during brainstorming)

| Question | Decision |
|---|---|
| Target routing | `ally`/`all-allies` (and unscoped grants) → **all player actors** (attacker + every team ship); `self` → **caster only**; all debuffs/DoTs → the enemy dummy. |
| Ability types walked | **buff, debuff, dot, charge, damage** — all of them. |
| Team damage reporting | Reduces enemy HP (HP-threshold gates + HP% column react) and shows as a separate per-round team-damage figure; summary DPS / `totalRoundDamage` / damage-type breakdown stay **attacker-only** (config comparison stays meaningful). |
| Reactive triggers on team ships | **Full parity** — team ships' live-trigger abilities register listeners keyed to their own events. |
| Architecture | **Generalize the player-actor pipeline**: `runAttackerTurn` → `runPlayerTurn(actor)`, one code path for any player actor; the attacker is just the reported one. |
| Editor/UI | Team cards get the full skill editor + auto-filled combat-stats grid; the buff/debuff pickers remain as **manual extras only**. |
| Migration | Additive: optional `shipSkills` + `stats` + `affinity` on `TeamActorInput`; when `shipSkills` is present the actor walks; auto-fill stamping into team pickers retires. No persisted team state exists (session `useState`) — no storage migration. |
| Echoing Burst accumulation | Accumulates **all** direct damage to the enemy (attacker + team) — the status sits on the enemy and gathers damage taken. |

## Public API (additive only — hard constraint)

```ts
interface TeamActorInput {
    // existing: id, speed, chargeCount, startCharged
    selfBuffs: SelectedGameBuff[];      // now: MANUAL extras granted to the attacker (legacy door)
    enemyDebuffs: SelectedGameBuff[];   // now: MANUAL extras inflicted on the enemy (legacy door)
    // NEW — when shipSkills is present, this actor walks its skills:
    shipSkills?: ShipSkills;
    stats?: {
        attack: number; crit: number; critDamage: number;
        defensePenetration: number; hacking: number; defence: number; hp: number;
    };
    affinity?: AffinityName;
}
```

- The adapter (`simulateDPS`) derives **per-actor** rates exactly as for the attacker:
  landing chance from that ship's hacking vs enemy security, DoT modifier from its own
  skills/buffs, affinity damage/crit modifiers from `affinity` vs the enemy affinity.
- `RoundData` gains `teamDamage?: number` (the round's summed team direct + secondary +
  conditional damage). `totalRoundDamage`/`cumulativeDamage` stay attacker-only.
- **Enemy HP% derives from attacker + team cumulative damage.** The adapter's per-round
  assertion (damage totals == HP deltas) extends to include `teamDamage`.
- `rawTotals` and the result summary gain an optional team total for display.
- `RoundData.action`/`charges`/`activeSelfBuffs`/`activeEnemyDebuffs` keep their attacker
  semantics (the row reports the attacker; `resistedEnemyDebuffs` already aggregates all
  sources' resists per round and keeps doing so).
- **Without `shipSkills` a team actor behaves byte-identically to today** (legacy scheduled
  lists via `sourceFired`). Golden fixtures on the legacy shape stay locked.

## Status engine: per-actor player sides

The single `'self'` side becomes per-player-actor status maps keyed by actorId
(`'attacker'` + team ids); the enemy side stays singular. Each player actor now CARRIES
statuses: timed/persistent maps, aura lists, accumulating maps, per owner.

- `snapshot(actorId)` / per-actor decrement: Post-Turn decrement extends to team actors
  (real status carriers now); `buff-expired` emits with the carrier's actorId. The engine's
  post-turn block generalizes from `attacker | enemy` to every actor.
- **Scheduled lists keep legacy routing:** global manual `selfBuffs` and team-picker manual
  extras (`TeamActorInput.selfBuffs`) apply to the **attacker's** side, exactly as today.
  `teamSources`/`timedBySource` continue to key manual extras to the team actor's real
  turns; the always/accumulating folds stay global to the attacker side.
- A walked **buff ability** routes at fire time: `self` → owner's side only;
  `ally`/`all-allies` → **every player actor's side** (one application each; family rule and
  persistent-stack routing run per side). Debuffs/DoTs → enemy side, unchanged shape.
- **Per-actor condition contexts:** each actor's gates (application-time, aura inclusion,
  drain-time) evaluate against *its own* active buff names + the shared enemy state
  (debuff counts, HP%, enemy type) + its own crit rate. `buildRoundContext` inputs become
  per-actor; the drain-context builder in triggers.ts generalizes the same way.
- Per-actor ability-status registries: the engine's registration loop (timed/aura/
  accumulating classification) runs once per walked actor over that actor's cast skills.

## Turn pipeline: `runPlayerTurn(actor)`

The attacker pipeline (attackerTurn.ts, ~1070 lines) is parameterized by actor:

- Stats, crit/landing/extend gates, skills, modifiers, and DoT/affinity multipliers come
  from the actor. "Is this the reported attacker" controls only RoundData row contribution.
- Team turns run the same body: status fold-in → gating → damage (own crit gates) →
  buff/debuff/DoT application → charge gains → `ability-performed` emission.
- **Per-actor gate instances** (active-crit, charged-crit, debuff-landing, extend-chance):
  the attacker keeps its existing instances and draw order — attacker-only runs are
  byte-identical (the zero-churn gate for the extraction).
- A walked team actor's turn replaces the current `sourceFired`-only team block; the
  `sourceFired` call remains within it (manual extras still apply on its real turns).
  A legacy team actor (no `shipSkills`) keeps the current block verbatim.
- The attacker-row throw ("round produced no attacker turn") and 0..N attacker-turn
  accumulator semantics are unchanged.

## Damage accounting

- Team direct/secondary/conditional damage folds into a round-level `teamDamage`
  accumulator → reduces enemy HP for gates/HP%/destruction events; never enters the
  attacker's damage fields or summary DPS.
- Destruction stays emission-only: if team damage alone drops the enemy to 0 HP, the
  `ship-destroyed` tap fires (once) and the sim keeps hitting the dead dummy to
  `numRounds`, exactly as today — no termination-path change.
- **Charge grants:** an `ally`/`all-allies`-targeted charge ability (Hermes) bumps **every
  player actor's** charges, capped per actor at its own `chargeCount`; `self`-targeted
  charge gains bump the owner. `allyChargePerRound` stays as the coexisting manual
  attacker-side input (not superseded — users without a configured Hermes keep it).
- **Echoing Burst accumulators** gather attacker + team direct damage per round
  (damage-taken semantics). Documented KNOWN-DIFF for any future fixture combining
  accumulators with team damage (none of the 18 today).

## DoT applier contexts

`ActiveDoTStack` and bomb entries gain a `sourceId`:

- **Inferno** ticks resolve the **applier's** current-round effective attack, DoT modifier,
  and affinity multiplier — the engine keeps a last-turn ctx per player actor (the existing
  `lastAttackerCtx` generalizes to a per-actor map). Attacker entries resolve exactly as
  today → zero churn.
- **Bombs** snapshot `damagePerStack` from the applier at application (as today) and use
  the applier's affinity multiplier at burst.
- **Corrosion** stays enemy-HP-scaled; the applier contributes its DoT modifier + affinity.
- DoTs applied by a team actor before any of its turns this run cannot occur (application
  happens on its turn), so per-actor ctx is always populated at tick time; the
  faster-enemy round-1 skip generalizes per entry.

## Reactive parity

- `partitionReactiveAbilities` runs per walked actor; reactive registration order is
  **team order (input order), then attacker, then slot/text order within each actor** —
  fixed registration order = fixed execution order. (Note: registration order is
  input-list order for determinism, independent of speed-based turn order.)
- Listener guards generalize per owner:
  - `on-crit` → `ability-performed` with `didCrit && actorId === owner`
  - `on-debuff-inflicted` → `debuff-applied`/`dot-applied` with `sourceId === owner`
  - `on-ally-debuff-inflicted` → any **player** `sourceId !== owner` (the attacker's
    inflictions are ally-inflictions from a team Oleander's perspective)
  - `start-of-round` / `on-bomb-detonated` → global, as today
- The intent executor takes the owner: charge intents to the owner (ally-charge intents to
  all players), buff intents route per target rule, debuff/dot executions draw the
  **owner's** landing chance and gates, bombs use the owner's effective attack.
- The marked team `dot-applied` seam in triggers.ts (`on-ally-debuff-inflicted` FUTURE
  comment) goes live: team DoT applications emit `dot-applied` with the team sourceId.

## Events

- `ability-performed` emits per player-actor action (actorId = owner) — required for
  per-owner `on-crit`. Existing consumers (round-log builder) read attacker entries only.
- `dot-applied`/`debuff-applied` carry team sourceIds (debuff-applied already does via
  `sourceFired`; the ability path now emits per owner).
- `buff-applied`/`buff-expired` actorIds become the real carrier (a team ship receiving an
  ally buff emits with its id).
- Determinism: fixed queue order, per-actor accumulator gates, fixed listener registration
  order, FIFO intent queue. Zero-RNG holds; identical inputs → identical outputs.

## Parser/builder: ally-scope for buff abilities

`SkillEffect` (skillTextParser.ts) gains ally-scope so `buildShipAbilities.mergeBuff`
emits real targets instead of stamping every player-side buff `'self'`:

- "all allies / allies / friendly units gain X" → `all-allies`; "the ally with the highest
  …" → `ally`; "this Unit gains X" → `self`. Unscoped grants → `all-allies` (user routing
  decision).
- For the **attacker's own sim** the reclassification is behavior-neutral: `self` and
  `all-allies` both fold onto its own side (it is a player actor and receives ally grants).
  Attacker-only fixtures: zero churn — locked explicitly.
- Clause scoping respects the abbreviation-period masking rule ("Inc."/"Out." buff-name
  periods) in BOTH `skillTextParser` and `auditSkills`; no RegExp lookbehind anywhere
  (iOS Safari 15 browserslist).
- `auditSkills` mirrors the classification; implementation includes an audit run
  enumerating every ship whose buff targets reclassify.

## Page / UI

- **On team ship pick** (`selectShipForTeamSlot`): build `shipSkills` via
  `buildShipAbilities(ship)`, stats via `shipFinalStats`, affinity from the ship.
  `buildSkillBuffAutoFill` stamping into the pickers **stops**; existing `autoFilled`
  picker entries are cleared on pick (manual entries survive). No-double-count: walked
  skills enter via `shipSkills`, manual extras via the lists — disjoint by construction.
- **TeamShipRow** gains: a combat-stats grid (attack/crit/critDamage/defensePenetration/
  hacking/affinity — shared `Input`/`Select` components, auto-filled + editable, joining
  the existing speed/chargeCount/startCharged) and the **same skill editor** the attacker
  config uses. The two `GameBuffPicker`s stay, relabeled as manual extras.
- `DocumentationPage`: team-ship section update (walked skills, team damage display,
  routing semantics).
- **Changelog:** edit the ONE evolving DPS entry in `UNRELEASED_CHANGES` in place
  (user directive — no new per-PR DPS entry).

## Testing

**Golden parity (18 snapshots) is the referee.**

- **Zero-churn locks:** attacker-only fixtures and legacy-shape team fixtures (no
  `shipSkills`) must be byte-identical through every task — the `runPlayerTurn`
  extraction, per-actor status-engine reshape, per-actor gate instances, and the parser
  target reclassification each carry an explicit zero-churn gate.
- New golden scenario(s): a walked team ship exercising buffs + debuffs + DoT + damage +
  a reactive charge, locking the full multi-actor round shape.

**New behavioral tests:**

- Routing: ally-targeted buff lands on attacker AND team ships; self-buff stays on the
  caster (the over-grant fix); unscoped grant → all players.
- Team DoT: team inferno ticks scale with the TEAM ship's effective attack (not the
  attacker's); team corrosion/bomb land in the enemy containers and tick on the enemy turn;
  `dot-applied` emits the team sourceId and feeds `on-ally-debuff-inflicted`.
- Team damage: HP-threshold gate flips earlier with a damaging team ship; `teamDamage`
  reported per round; attacker totals/summary unchanged by team damage.
- Ally charge grant: every player actor bumps, capped per actor; coexists with
  `allyChargePerRound`.
- Reactive parity: team Hemlock charge per its own infliction events; team Enforcer
  crit-inflicted debuff on its own crit turns; attacker infliction triggers a team
  Oleander's ally-infliction listener (and vice versa).
- Per-actor condition contexts: a team ship's gated ability reads its OWN buffs, not the
  attacker's.
- Echoing Burst accumulates attacker + team direct.
- No-double-count: a walked team ship with manual picker extras contributes each exactly
  once.
- Determinism: two identical runs byte-equal.

**Live verification:** dev server (localhost:3002) + chrome tools against the imported
fleet (212 ships; pages with 200+ ships exceed snapshot token limits — use
evaluate_script). Team configs: Hemlock/Oleander (reactive), Hermes (ally charge),
a DoT inflictor (e.g. Belladonna), a damage-heavy team ship.

## Out of scope (stated boundaries)

- Enemy offensive actions; `on-attacked`/`on-ally-destroyed`/`on-destroyed` consumption
  (Phase 4).
- Speed-buff effects on turn order: the queue keeps static input speeds — a received
  Speed Up does not reorder turns (documented limitation; turn-meter manipulation is a
  later phase).
- Heal/shield/cleanse/purge/control consumption — still not-simulated for team ships too.
- Extra End-of-Round Actions (own increment; seam unchanged).
- Multi-enemy, taunt/provoke/stealth targeting, PvP/PvE round limits.
- Per-hit crit checks (backlog item 7 — unchanged divergence, now also applying to team
  multi-hit ships).

## Workflow constraints (unchanged)

- Golden discipline per task; never vitest `-u`; pre-commit hook runs the full suite.
- docs/ is gitignored — `git add -f` for this spec and the plan.
- Branch: `feat/combat-engine-team-skills-walk`; subagent-driven implementation with
  two-stage review per task.
- No RegExp lookbehind in src/ (iOS Safari 15).
- CodeRabbit triage on the PR before merging (triage → fix/skip-with-reason → reply
  in-thread → wait for re-review → merge when clean).
