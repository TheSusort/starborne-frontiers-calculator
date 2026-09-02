# Combat Log Fidelity + Stat Snapshots — Design

**Date:** 2026-07-10
**Status:** Approved (brainstorm)
**Baseline:** main @ `53f7028b` (PR #241)

## Problem

A batch of combat-log work surfaced during manual sim testing:

1. **Hermes over-trigger** — a ship's on-attacked reactive buff/heal proc (Hermes's
   Everliving Regeneration) fires multiple times per attack (2–4×), scaling with AoE
   victim count / hit count. It should fire at most once per attack.
2. **DoT tick damage invisible** — corrosion (and every other DoT) tick damage is not
   shown in the log.
3. **Counters + reflects invisible** — Stalwart/Centurion counter-attacks and Nosorog
   reflects are applied but emit no log event.
4. **Empty buff-only-turn row** — a turn that only applies a buff renders a stray empty
   0-damage attack row.
5. **No modelled stat visibility** — the log shows no snapshot of a ship's current
   modelled stats (HP/defense/attack/crit/security/etc. as buffed/debuffed) at its turn.

## Architecture context

- The engine emits a flat `CombatEvent[]` stream (`src/utils/combat/events.ts`).
- `simulateBattle` subscribes to `LOG_EVENT_TYPES` (`battleSimulator.ts`) and folds the
  stream into a hierarchical view-model via the pure `buildCombatLog(events, roster,
  initialCharge)` (`src/utils/combat/log/buildCombatLog.ts` → `CombatLogRound[]`).
- `RoundEventLog.tsx` renders a round's turns → entries → nested reactions.
- Reactive procs nest under their trigger via the `ReactiveStamp` (`duringTurnOf`),
  stamped through `makeReactiveStampingBus` during `executeIntent`.
- Live effective per-actor stats are computed by
  `effectiveStatsOf(statusEngine, selfBuffLookup, actor)` (`effectiveStats.ts`) →
  `{ attack, defence, crit, critDamage, defensePenetration, hp, speed, hacking, security }`.
  `currentHp` / `shieldPool` live on the `CombatActor`.
- Precedent for log-only, no-listener events (chain-safe): `reactive-damage-performed` /
  `reactive-heal-performed` (shipped #240) — emitted through `ctx.bus` so they carry
  `duringTurnOf` and nest under the triggering turn; NO combat listener subscribes.

## Work items

### Item 1 — Hermes once-per-attack collapse (engine; goldens will move)

**Symptom.** Everliving Regeneration logs 2–4× per attack while the charge manip already
collapses to once-per-attack (0→1→2→3→4). So the charge grant is per-attack but the
buff/heal proc is not. The extra procs track AoE victim count → `on-ally-attacked` fires
once per same-side victim of one AoE cast (and `on-attacked` once per hit); the counter
path already collapses per-attack (triggers.ts ~2535 "attack-instance token"), the
buff/heal/charge intents do not.

**Intended behavior.** A reactive proc triggered by *being attacked* (`on-attacked`) or by
*an ally being attacked* (`on-ally-attacked`) fires **at most once per attacking cast**,
regardless of hit count or AoE victim count — for ALL reactive intent kinds (buff, heal,
charge), matching the counter-attack collapse.

**Approach.** Extend the existing once-per-attack de-dup to the non-counter reactive intents
on the `on-attacked` / `on-ally-attacked` listeners. Root-cause the exact divergence between
the (already-collapsed) charge path and the (not-collapsed) buff/heal path via
systematic-debugging first — the fix must land through the PRODUCTION `simulateBattle`
positional path, not only an aggregate helper.

**This is a genuine engine behavior change** (the heal/buff is really applied N×, not just
logged N×) → combat goldens WILL move. Expected, reviewed. Team-symmetric (a ship behaves
identically on either side). Lands on its own PR.

**Red test.** A multi-victim AoE attack against a Hermes-side team → assert Everliving
Regeneration applies exactly once and Hermes's charge grants exactly once, through real
`simulateBattle`.

### Item 2 — DoT tick damage rendering (render/builder; log-layer only)

**Root cause.** `dot-ticked` IS emitted (engine.ts, 3 sites) and IS in `LOG_EVENT_TYPES`
and reaches the builder, which creates a `dot-ticked` entry with
`targets: [{ targetId, amount: e.damage }]` but NO `note`. The renderer maps `dot-ticked`
to `noteLine`, which prints only the actor name and ignores `targets` → the amount is lost.

**Fix.** Give `dot-ticked` a real formatter in `RoundEventLog.tsx` that renders the victim
and the tick amount + DoT type, e.g. `{victim}: {dotType} {amount}`. Covers corrosion /
inferno / generic (all widen to `DoTType`). While here, verify `detonation` and `bomb`
labels read correctly. No engine change.

**Test.** `RoundEventLog` unit test asserting a `dot-ticked` entry renders its amount;
a `buildCombatLog` test already exercises the entry shape (keep green).

### Item 3 — Counter + reflect log events (engine + builder + render)

**Gap.** `applyCounterAttack` (Stalwart/Centurion) and the reflect path (Nosorog,
`damageReflection.ts`) credit damage but emit no ability-performed (chain guard) and no
log-only event → invisible.

**Fix.** Emit the log-only `reactive-damage-performed` from these paths through `ctx.bus`
(so it is stamped `duringTurnOf` and nests under the triggering turn), mirroring the
Sentinel fold-in (#240). If a counter/reflect needs a distinguishing label in the log, add
an optional discriminator (e.g. `kind: 'counter' | 'reflect'`) on the event and surface it
in the entry note; otherwise reuse the existing attack rendering. NO combat listener
subscribes to the new emits (cannot chain).

**Test.** End-to-end through `simulateBattle`: a counter and a reflect each surface exactly
one nested reactive entry with the correct amount, under the triggering turn.

### Item 4 — Suppress empty buff-only-turn attack row (builder)

**Symptom.** A buff-only turn renders an empty 0-damage attack row (buildCombatLog ~317
region).

**Fix.** In `buildCombatLog`, do not retain an `attack` entry that closes with zero targets
AND no damage (i.e. an `ability-performed` that produced no `attacked` and was not a miss).
Preserve genuine miss synthesis (a targeted attack that missed → the existing miss target).

**Test.** A turn with only a `buff-applied` (no `attacked`) yields a turn with the buff
entry and NO empty attack entry; a miss still renders.

### Item 5 — Per-turn modelled stat snapshot (NEW feature)

**Goal.** Under each ship's turn header, show a **collapsed** summary of that ship's current
modelled stats (HP current/max, shield, attack, defence, crit, crit damage, defense pen,
speed, hacking, security) reflecting buffs/debuffs active at that moment. Expanding it
reveals the full block; the actions/reactions render below as today.

**Approach (log-only event).**
- New event `stats-snapshot` on the `CombatEvent` union — LOG-ONLY, no listener subscribes
  (chain-safe, like `reactive-damage-performed`). Fields: `actorId`, `round`, and a
  `stats` payload: `{ attack, defence, crit, critDamage, defensePenetration, speed,
  hacking, security, currentHp, maxHp, shieldPool }`.
- Emit it in the engine turn loop immediately after `turn-started` for the ACTING actor,
  computed via `effectiveStatsOf(statusEngine, selfBuffLookup, actor)` + `actor.currentHp`
  / base `maxHp` / `actor.shieldPool`. (Both player and enemy turns — team-symmetric.)
- Add `stats-snapshot` to `LOG_EVENT_TYPES` so `simulateBattle` subscribes.
- `buildCombatLog`: attach the snapshot to the current turn as
  `CombatLogTurn.statsSnapshot` (does NOT create an entry; it decorates the turn).
- `RoundEventLog` / `TurnView`: render a collapsed stats summary between the turn header and
  the entries, using existing UI primitives (`CollapsibleAccordion` / `card`). Collapsed by
  default (one compact line, e.g. HP + a couple key stats), expandable to the full grid.

**Scope.** Acting ship only, per turn.

**Deferred stretch (NOT built here; documented):** snapshot all living ships each turn and
let clicking any action entry reveal the involved ships' stats — requires per-action keying
and a larger UI surface.

**Rejected alternatives.** (a) Post-hoc state replay to reconstruct stats — fragile,
re-implements engine math. (b) All-ships-every-turn snapshot — heavy payload for marginal
value at this stage.

**Test.** Engine emission test (a buffed actor's `stats-snapshot` reflects the buff);
`buildCombatLog` attaches the snapshot to the right turn; `RoundEventLog` renders the
collapsed summary and expands to the full block.

## Sequencing / PRs

Independent, log-layer-safe first; the golden-moving engine change isolated last:

1. **Item 2** (DoT tick render) — log-layer only.
2. **Item 4** (empty buff-only row) — builder only.
3. **Item 3** (counter/reflect log events) — mirrors shipped pattern.
4. **Item 5** (stat snapshot) — additive new event + UI.
5. **Item 1** (Hermes once-per-attack) — engine behavior change, goldens move; on its own.

Items 2/4 may combine into one small PR. Item 1 is standalone. Each PR: red test through the
PRODUCTION path first, full suite green (`npm test`), `audit:skills` 0/0, tsc + lint clean,
DPS/healing goldens unchanged EXCEPT Item 1's expected combat-golden movement.

## Conventions / guardrails

- New events must be log-only where they could otherwise chain reactions (no listener
  subscribes) — the `reactive-damage-performed` precedent.
- Team-symmetric: any ship behaves identically on either side.
- UI uses `src/components/ui/` primitives (`CollapsibleAccordion`, `card`); no raw markup.
- Add user-facing changelog entries to `UNRELEASED_CHANGES` (`src/constants/changelog.ts`)
  for Items 1, 2, 3, 5 (Item 4 is cosmetic-minor — include if noticeable).
- Update `DocumentationPage.tsx` if the stat-snapshot feature warrants user docs.
