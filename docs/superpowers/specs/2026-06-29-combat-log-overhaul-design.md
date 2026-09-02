# Combat Log Overhaul — Design

**Date:** 2026-06-29
**Status:** Approved (design)
**Scope:** Combat-sim findings #4 (richer event log) + #3 (AoE per-victim logging)

## Problem

While manually testing the combat simulator, two log-related shortcomings surfaced:

- **#4 — The event log is too lossy and mis-attributes reactions.** It does not capture
  everything that happens (charge state, active-vs-charged variant, many effects), and a
  reaction (counterattack, on-crit heal, reflect, etc.) is shown inside the *reacting*
  ship's own turn rather than the turn during which it actually fired.
- **#3 — AoE actions only log the main target.** AoE attacks log damage only to the
  primary/anchor target; AoE heals are shown but split evenly (inaccurate). Covered
  footprint victims take damage/healing silently in the log.

### Root cause

The rich data already exists. The engine emits a typed `CombatEvent[]` stream
(`src/utils/combat/events.ts`, ~19 discriminated types: damage, heals, shields, buffs,
debuffs, DoTs, `skill-fired.slot` active/charged, control, per-victim `attacked`, deaths,
HP changes, …). The assembler in `assembleBattleResult`
(`src/utils/calculators/battleSimulator.ts:313–385`) collapses it into a lossy 7-kind
`BattleLogEvent[]`, discarding most detail and reducing AoE to the focus target. The UI
(`src/components/simulator/RoundEventLog.tsx`) renders that flattened list.

This is therefore largely about **stopping the discarding**, plus a few small additive
engine emissions — not generating fundamentally new data.

## Decisions (locked during brainstorming)

| # | Decision |
|---|----------|
| Audience | **Replace** the current log — one detailed log, single code path, shown to all users. |
| Reactions | **Inline under the triggering turn, marked & attributed** (indented `↳ reactor reacts (skill): …`). |
| Charge | **Annotate level per turn** (`charge 2/3`, `[active]`/`[charged]`) **plus explicit `charge-changed` event lines** so manipulation is named. |
| Noise | **Resulting HP rides the action line** (`… → Sentinel 64%`); no standalone `hp-changed` line; everything else keeps its own line. |
| AoE | **Parent line + indented per-victim breakdown.** Heals get **true per-recipient amounts** (enrich the heal/shield events), not an even split. |
| Architecture | **Dedicated pure view-model layer** (Approach 1): `buildCombatLog(events, roster) → CombatLogRound[]`, rendered by a rewritten `RoundEventLog`. |
| Extensibility | View-model + builder + renderer designed so a future mechanic = one additive builder handler + one additive formatter. |

## Architecture & data flow

```
Engine emits  ──►  CombatEvent[]  ──►  buildCombatLog()  ──►  CombatLogRound[]  ──►  RoundEventLog
(source of truth)   (typed union,      (NEW pure fn,           (NEW hierarchical    (renders tree)
                     flat, ordered)     replaces lossy          view-model)
                                        assembler log section)
```

- `CombatEvent[]` remains the engine's source of truth. We **add** event types/fields; we do
  **not** reshape existing events.
- The lossy `BattleLogEvent` assembly inside `assembleBattleResult` is **deleted** and replaced
  by a new pure module `buildCombatLog(events, roster, initialCharge)` in
  `src/utils/combat/log/buildCombatLog.ts`. Pure, no React, fully unit-testable.
- DPS/healing numbers and golden tests are untouched — they derive from
  `roundPerTargetDamage` / result assembly, not from the log section being replaced.

### `BattleResult` / `BattleRound` consumer impact

- `BattleLogEvent` and the `BattleRound.events` field are **removed**. `CombatLogRound[]` is
  surfaced on `BattleResult` as a new top-level field `combatLog` (it spans all rounds and carries
  its own `round` numbers), **not** per-`BattleRound`.
- `BattleRound.ships` and `BattleRound.turnOrder` are **untouched** — the charts and summaries that
  consume them (DPSRoundChart, HealingTimelineChart, HealingCumulativeChart, ShipConfigSummary,
  HealerConfigCard, BattlePlayback) are unaffected.
- `RoundEventLog`'s prop changes from a `BattleRound` (with `.events`) to a `CombatLogRound`; its
  parent passes `result.combatLog[i]` instead of `round`. `RoundStepper.tsx` is unaffected (round
  stepping only).
- `reflectGearSet.integration.test.ts` (and any test asserting on `BattleLogEvent` shape) must be
  migrated to assert on `combatLog` / `CombatLogRound` — listed under Testing.

## View-model types

Lives with the builder (e.g. `src/utils/combat/log/types.ts`).

```ts
interface CombatLogRound {
  round: number;
  turns: CombatLogTurn[];
  endOfRound: CombatLogEntry[]; // round-end-drained entries with no enclosing turn (DoT ticks, bursts, unstamped reactions)
}

interface CombatLogTurn {
  actorId: string;
  chargeBefore: number;       // for "charge 2/3" annotation
  chargeMax: number;
  entries: CombatLogEntry[];  // chronological within the turn
}

type CombatLogEntryKind =
  | 'attack' | 'heal' | 'shield' | 'buff' | 'debuff' | 'dot-applied'
  | 'dot-ticked' | 'control' | 'cleanse' | 'purge' | 'charge-changed'
  | 'death' | 'detonation' | 'bomb';

interface CombatLogEntry {
  kind: CombatLogEntryKind;
  actorId: string;
  skillName?: string;
  slot?: 'active' | 'charged';     // active-vs-charged tag
  targets: CombatLogTarget[];      // 1 = single-target, N = AoE (drives breakdown)
  reactions: CombatLogEntry[];     // reactions triggered BY this entry, nested
  note?: string;                   // e.g. charge "2→3 (manip by Panguan)", cleanse count
}

interface CombatLogTarget {
  targetId: string;
  amount?: number;                 // damage or heal to THIS target
  didCrit?: boolean;
  didHit?: boolean;                // false = miss/dodge, shown explicitly
  resultingHpPct?: number;         // rides the line (Q4-C)
  shieldWasHit?: boolean;
}
```

- **AoE** = entry with multiple `targets` → parent header + indented per-target breakdown.
- **Reactions** nest in `entry.reactions` → render indented under the triggering entry, in the
  turn where the trigger happened — even if the engine drained them later.
- `CombatLogEntryKind` is a superset of today's 7 kinds → nothing lost.

### `entry.actorId` / `target.targetId` mapping per kind

Source events use heterogeneous id field names; the builder normalizes them. `entry.actorId` is
always the **acting/causing** ship; victims go in `targets[]`. (Note: this differs from today's
lossy `BattleLogEvent`, which set debuff/dot `actorId` to the *victim* — we standardize on the
actor.)

| Entry kind | `entry.actorId` ← | `target.targetId` ← |
|---|---|---|
| `attack` | `ability-performed.actorId` | per-victim `attacked.targetId` (or `ability-performed.targetId` on a miss) |
| `heal` | `heal-performed.casterId` | `heal-performed.perTarget[].targetId` |
| `shield` | `shield-applied.granterId` | `shield-applied.perTarget[].targetId` |
| `buff` | `buff-applied.actorId` | (self) |
| `debuff` | `debuff-applied.sourceId` | `debuff-applied.targetId` |
| `dot-applied` | `dot-applied.sourceId` | `dot-applied.targetId` |
| `dot-ticked` | (no source) — `dot-ticked.targetId` as actor, self-target | `dot-ticked.targetId` |
| `detonation` / `bomb` | `dot-detonated.targetId` / `bomb-detonated.actorId` | the detonated target |
| `control` | `control-applied.casterId` | (effect-scoped; target if present) |
| `cleanse` | `cleanse-performed.casterId` | — (count in `note`) |
| `purge` | `purge-performed.casterId` | `purge-performed.targetId` |
| `charge-changed` | `charge-changed.actorId` | (self) |
| `death` | `ship-destroyed.actorId` (the destroyed ship); `killerId` in `note` | — |

## Extensibility design

Three additive seams so future mechanics don't force a refactor:

1. **Builder = per-event-type handler map**, not a mega-switch:
   ```ts
   type EventHandler = (e: CombatEvent, ctx: BuildContext) => void;
   const handlers: Partial<Record<CombatEventType, EventHandler>> = {
     'skill-fired':       handleSkillFired,   // opens action: stamps skillName/slot on turn + next entry
     'ability-performed': handleAttack,
     'attacked':          handleAttacked,     // per-victim correlation into the open attack entry
     'heal-performed':    handleHeal,
     'hp-changed':        handleHpChanged,    // updates running-HP map; no entry of its own
     'charge-changed':    handleChargeChanged,
     // adding a new event → add one entry, touch nothing else
   };
   ```
   `BuildContext` exposes helpers (current turn, attach-entry, attach-reaction-to-trigger,
   running-HP map). An unhandled event type is a no-op with a dev warning — new engine events
   never crash the log.
2. **Generic entry shape** absorbs most new mechanics: a new effect usually maps to an existing
   `kind` + a `note`, or at most one new `kind` value. AoE (`targets[]`) and reaction-nesting
   (`reactions[]`) apply uniformly to every kind, so new mechanics get breakdown + nesting for free.
3. **Renderer = per-kind formatter map with a fallback**:
   ```ts
   const formatEntry: Record<CombatLogEntryKind, (e: CombatLogEntry) => ReactNode> = { … }
   ```
   Adding a kind → add one formatter; a missing formatter falls back to a generic line rather
   than throwing.

Net: **adding a future mechanic = one builder handler + one formatter, both additive.**

## Engine-side event changes

All additive — no existing event reshaped.

### 1. `charge-changed` (new event)

```ts
{ type: 'charge-changed'; actorId: string; round: number;
  oldCharge: number; newCharge: number; reason: 'gen' | 'cast-reset' | 'manip' }
```

Emitted at every `chargeCount` mutation site: natural per-turn gen, charged-cast reset, and
charge gen/manip abilities. `reason` lets the log distinguish a quiet natural tick from
`charge 2→3 (manip by Panguan)`.

### 2. Per-recipient amounts on `heal-performed` + `shield-applied`

Add an optional `perTarget` array alongside the existing summed fields (existing consumers keep
working):

```ts
heal-performed: { …existing, perTarget: { targetId; amount; overheal?; didCrit? }[] }
shield-applied: { …existing, perTarget: { targetId; amount }[] }
```

Sourced where the engine already loops recipients to apply the heal/shield — the per-target
number is in hand; it just isn't emitted today.

### 3. AoE attack breakdown — no new damage event

The per-victim `attacked` events (from bySide PR7, including the primary) already carry
per-victim `damage`, `didCrit`, `shieldWasHit`. `buildCombatLog` correlates the `attacked`
events that follow an `ability-performed` (same attacker, before the next action) and aggregates
them per victim into the entry's `targets[]`. So #3's AoE gap is solved **in the builder**, reusing
existing events; `ability-performed` stays focus-framed for the action header. DoT/bomb damage
(no `attacked`) keeps using `dot-ticked` / `dot-detonated` / `bomb-detonated`. The exact
correlation/aggregation rules (multi-hit, miss) are in **Builder correlation rules** below.

### 4. Resulting HP (`hp-changed` folded in)

`buildCombatLog` maintains a running HP%-per-actor map fed by the existing `hp-changed` events.
`hp-changed` stops being its own line and instead stamps `resultingHpPct` onto the action line
that preceded it (Q4-C).

## Builder correlation rules

These pin down how the flat, multi-event stream collapses into entries — the parts a developer
hits immediately.

### Skill framing (`skillName` / `slot`)

`skillName` and `slot` (`active`/`charged`) live on the **`skill-fired`** event, **not** on
`ability-performed`. The builder treats `skill-fired` as opening the current actor's action: it
stamps `skillName`/`slot` onto the turn header (`[active]`/`[charged]`) and onto the next
action-producing entry (attack/heal/shield/buff/etc.) emitted by that actor before the next
`skill-fired` or `turn-ended`. **No-skill-fired fallback:** an action with no preceding
`skill-fired` (e.g. a basic attack) produces an entry with `skillName`/`slot` undefined; the
renderer omits the tag.

### Attack damage aggregation (multi-hit + miss)

- `attacked` is emitted **once per hit**, and `attacked.damage` is the **per-attack aggregate that
  is identical across the turn's per-hit events** — so it must **not** be summed. The displayed
  per-victim `amount` for the **focus/primary** victim comes from `ability-performed.damage`; for
  **splash** victims it comes from that victim's `attacked.damage` (deduplicated — take one, not the
  sum). `critHits` comes from `ability-performed.critHits`; per-victim `didCrit` is true if any of
  that victim's `attacked` hits crit. (Focus vs splash can be discriminated directly via
  `attacked.isPrimaryTarget` rather than only by position relative to `ability-performed`.)
- **Miss / dodge:** a full miss yields an `ability-performed` with `didHit:false` and **no**
  `attacked` event. When no `attacked` correlates to the action, the builder synthesizes a single
  `CombatLogTarget` from `ability-performed.targetId` with `didHit:false`, `amount` undefined →
  renders `miss`.

### Charge reconstruction (`chargeBefore` / `chargeMax`)

Charge is **not** on `turn-started`; it lives on the runtime actor. The builder reconstructs each
actor's running charge by folding `charge-changed` deltas in stream order, seeded from an
**initial-charge map passed into `buildCombatLog`** (sourced from the pre-combat actor state — the
same place the engine seeds `chargeCount`). `chargeMax` likewise comes from that seed input.
`chargeBefore` on a turn = the actor's folded charge at `turn-started`. Actors with no charge skill
(`chargeMax === 0`) omit the header annotation entirely.

### Entry ordering within a turn

- Non-reactive entries are appended in stream order (chronological).
- Re-homed reactions (those with `duringTurnOf`, including round-end-drained ones) are appended to
  the **trigger entry's `.reactions`** in stream order; parent entries keep their original turn
  order. This is the deterministic invariant tests assert against — re-homed reactions never
  reorder the parent entries of the turn they attach to.

## Reaction attribution (the timing fix)

Inference alone is insufficient: some reactions are **drained at round-end** (the `round-ended`
reactive queue) and land in the stream after every `turn-ended` with no enclosing turn; and
turn-owner inference ("any non-owner action during a turn is a reaction") misfires on
extra-action grants.

So reactive emissions are **stamped explicitly**. When the executor processes a reactive intent it
already knows the reactor and the active turn owner. Add optional fields to the events those
intents emit (`ability-performed`, `heal-performed`, `shield-applied`, `buff-applied`, …):

```ts
reactive?: true;
duringTurnOf?: string;   // actorId whose turn was active when this fired
triggerActorId?: string; // who provoked it (usually the turn owner)
```

Stamped at emit time from the executor's known context (the engine tracks the active turn actor).
Events without the flag are normal on-turn actions.

**Complete stamped event set:** every event a reactive intent can emit must carry the fields when
it fires reactively — `ability-performed`, `heal-performed`, `shield-applied`, `buff-applied`,
`buff-expired`, `debuff-applied`, `debuff-resisted`, `dot-applied`, `control-applied`,
`cleanse-performed`, `purge-performed`, `ship-destroyed`, `cheat-death-activated`. (DoT
ticks/detonations and bombs resolve in the post-round drain and are addressed by the fallback
below.) The implementation plan must audit the executor to confirm the full set; this list is the
expected coverage.

**Fallback for unstamped round-end-drained events.** Any event that arrives **after the last
`turn-ended`** (the `round-ended` drain window) and lacks `duringTurnOf` is attached to a synthetic
**end-of-round group** on the round (rendered as `— end of round —`), rather than silently dropped
or mis-homed. This guarantees no event is orphaned even if the stamping audit misses a path. (DoT
ticks and post-round bomb bursts naturally land here.)

**Builder nesting rule (deterministic):**
- Entry with `duringTurnOf = X` → attach to **turn X**, regardless of raw-stream position (fixes
  the round-end drain case).
- Within turn X, nest it in `.reactions` of the **most recent non-reactive entry** in that turn
  (the trigger). No correlation IDs required; good-enough and extensible (a precise trigger id can
  be added later without reshaping).

Result: an on-crit retaliation renders indented under the exact `Vexis → Sentinel (crit)` line
inside *Vexis's* turn — never floating in the reactor's own turn or detached at round end.

**Plan-step caveat:** this depends on a single identifiable "reactive processing" path to stamp.
Reactives route through `triggers.ts` listeners → intent queue → executor; the implementation plan
must pin down the exact stamp point.

## Rendering

`RoundEventLog.tsx` is rewritten to walk `CombatLogRound[]`; its old `lineFor` / `BattleLogEvent`
switch is removed.

- **Round** → **Turn header** (`Sentinel's turn · charge 2/3`, with `[active]`/`[charged]` when a
  skill fires) → **entries** via the per-kind formatter map → optional **`— end of round —`** group
  rendering `round.endOfRound` entries.
- **AoE entry:** parent header + indented `targets[]` breakdown — each target
  `name: amount (crit?) → HP%`; misses shown as `miss`.
- **Reaction:** indented under its trigger entry (`↳ reactor reacts (skill): …`), one level deeper
  than the AoE breakdown so the two nestings read distinctly.
- Names resolve via the existing `roster` lookup (`Enemy X` prefix for the enemy side) — unchanged.
- No new UI primitives — plain indentation + existing text/color classes. No emojis (project
  convention). Reuse current log color hues for damage/heal/buff/debuff/death; the new kinds
  (`shield`, `cleanse`, `purge`, `charge-changed`, `detonation`, `bomb`, `control`, `dot-ticked`)
  map to the nearest existing hue (e.g. shield→buff, detonation/bomb/dot-ticked→damage,
  control→debuff, cleanse/charge-changed→neutral); the formatter fallback renders any unmapped kind
  as a neutral line.

## Testing

- **`buildCombatLog` unit tests** (the heart): hand-built `CombatEvent[]` fixtures → assert the
  `CombatLogRound[]` tree: AoE fans to N targets; reaction nests under its trigger in the correct
  turn; round-end-drained reaction still lands under the right turn; unstamped round-end event lands
  in `endOfRound`; `charge-changed` renders with reason; per-recipient heal amounts; running-HP%
  stamping; unknown event type = no-op (no throw). Plus, from the correlation rules:
  - **multi-hit single target** → one collapsed target with the correct (non-summed) amount;
  - **full miss** → a `didHit:false` target with no `attacked` event;
  - **`skill-fired` → action correlation** → `[active]`/`[charged]` tag and `skillName` on the entry,
    and the no-skill-fired fallback (no tag);
  - **seeded/initial charge** → turn header reflects initial charge before any `charge-changed`, and
    `chargeMax === 0` omits the annotation;
  - **id-mapping** → debuff/dot entry `actorId` is the inflicter (not the victim).
- **Engine emission tests** (extend `engine.events.test.ts`): `charge-changed` fires at each
  mutation site with correct `reason`; `heal-performed` / `shield-applied` carry `perTarget`;
  reactive emissions carry `reactive` / `duringTurnOf`.
- **Golden parity:** `dpsGoldenParity` / `healingGoldenParity` must stay **unchanged** (log path
  only, not damage/heal math) — regression guard. Never `vitest -u`; the golden audit spans the
  whole `npm test`.
- **Render smoke test** on `RoundEventLog` with a representative tree.
- **Migrate `reflectGearSet.integration.test.ts`** (and any other test asserting on `BattleLogEvent`
  / `BattleRound.events`) to assert on `result.combatLog` / `CombatLogRound`.

## Out of scope (explicit)

- Findings **#1** (dead-ship passives still firing), **#2** (reaction-only units acting on their
  turn), **#6** (implants not firing) — separate correctness bugs. This richer log will *help debug*
  them, but no behavior fix here.
- Finding **#5** (composition selector merge) — separate UI task.
- No changes to damage/heal/charge **math** — only what is emitted and how it is displayed.

## Affected files (anticipated)

- `src/utils/combat/events.ts` — add `charge-changed`; add `perTarget` to heal/shield; add
  `reactive`/`duringTurnOf`/`triggerActorId` optional fields.
- Engine emission sites — `charge-changed` at `chargeCount` mutations; `perTarget` on heal/shield
  emit; reactive stamping in the executor path (`playerTurn.ts`, `engine.ts`, `triggers.ts`).
- `src/utils/combat/log/buildCombatLog.ts` (new) + `src/utils/combat/log/types.ts` (new).
- `src/utils/calculators/battleSimulator.ts` — remove lossy `BattleLogEvent` assembly; call
  `buildCombatLog`; surface `CombatLogRound[]` on the result.
- `src/components/simulator/RoundEventLog.tsx` — rewrite to render the tree.
- Tests: `buildCombatLog` (new), `engine.events.test.ts` (extend), `RoundEventLog` smoke (new).
- `src/pages/DocumentationPage.tsx` + `src/constants/changelog.ts` (`UNRELEASED_CHANGES`) — update
  for the user-facing log change.
```
