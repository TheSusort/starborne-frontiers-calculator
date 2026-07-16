# Combat Log — Surface Four Missing Events

**Date:** 2026-07-16
**Status:** Approved
**Scope:** Log-layer feature. Make four already-emitted engine events visible in the rich combat log. No numeric combat behavior change.

## Background

The rich combat log (`buildCombatLog` → `RoundEventLog`) is fully event-driven: `simulateBattle` subscribes to `LOG_EVENT_TYPES`, collects the stream, and `buildCombatLog` folds it into a hierarchical round → turn → entry model with reactions nested under their trigger via a `duringTurnOf` stamp.

A prior memory note flagged "counters & reflects emit no combat-log event." **That is stale** — both now emit the log-only `reactive-damage-performed` event (counters at `triggers.ts:2820` via `emitReactiveDamageLog`; reflects at `engine.ts:3581` via `flushReflectLogs`, buffered so they nest under the attacker's turn on the positional path). This spec does not touch that path.

Diffing every emitted `CombatEvent` type against what `buildCombatLog` renders (and what `simulateBattle` even forwards) surfaces four genuine gaps:

| Event | Emitted at | In `LOG_EVENT_TYPES`? | `buildCombatLog` handler? |
|---|---|---|---|
| `debuff-resisted` | `debuffImmunity.ts:55`, `playerTurn.ts:1088`, `triggers.ts:2365` | No | No |
| `cheat-death-activated` | `engine.ts:4063` | No | No |
| `shield-destroyed` | `engine.ts:4011` | No | No |
| `buff-expired` | `engine.ts:7973` / `:7985` | **Yes** | No (silently dropped) |

All four `CombatEvent` variants already carry `ReactiveStamp` (optional fields), so nesting is possible. **None of the four emit sites currently populate `duringTurnOf`.**

Out of scope (Tier 2 — mechanics that emit no event at all): standing-leech self-heal/shield (`engine.ts:3341`, intentionally no emit), Protection redirect per-stack granularity (one event per protector vs. N in game), extra-action grant attribution.

## Goals

1. Surface `buff-expired`, `debuff-resisted`, `shield-destroyed`, `cheat-death-activated` in the rich combat log.
2. Correct placement: attack-consequence events nest under (or sit directly beneath) the attack that caused them; status-lifecycle events sit in the relevant turn.
3. Zero numeric behavior change. DPS/healing numeric goldens stay byte-identical.

## Non-goals

- **Emit-side coverage.** We render the events *wherever they already fire*. Widening emission (e.g. an affinity-blocked "apply" debuff that resists with no hacking roll and may emit no `debuff-resisted` today) is a separate follow-up.
- Tier-2 mechanics (leech, Protection per-stack, extra-action attribution).
- Any change to the legacy flat `BattleLogEvent` assembler (`ASSEMBLED_EVENT_TYPES`).

## Design

### Shared plumbing (all four)

1. **`battleSimulator.ts`** — add the type to `LOG_EVENT_TYPES` so `simulateBattle` forwards it to `buildCombatLog`. (`buff-expired` is already present.)
2. **`buildCombatLog.ts`** — add a handler that constructs a `CombatLogEntry`.
3. **`types.ts`** — add the new `CombatLogEntryKind` value(s).
4. **`RoundEventLog.tsx`** — add a `colorForKind` case and a formatter (or rely on the `noteLine` fallback).

The `buildCombatLog` dispatch loop captures `currentStamp` from any event's `duringTurnOf` regardless of type; `attachEntry` routes a stamped entry via `routeReaction` (nests under the most-recent non-reactive entry of the trigger turn), and an unstamped entry to the current turn, else `startOfRound`/`endOfRound`. New kinds render via the existing per-kind formatter map, which already falls back to `noteLine` for unmapped kinds.

### Per-event specifics

#### `buff-expired` — kind `buff-expired` (muted/gray)

Fires inside the per-actor decrement at `turn-ended` time, emitted **before** the `turn-ended` event, so `currentTurn` is still the owner's turn. Unstamped → standalone entry at the tail of that turn.

- Handler: `{ kind: 'buff-expired', actorId: e.actorId, targets: [], reactions: [], note: e.buffName }`.
- Render: *"{X}: {buffName} expired"*.
- Covers both buff expiry (`decrementPlayer`) and debuff expiry (`decrementEnemy`) — the two emit sites are identical in shape; `buffName` is the discriminator. The label deliberately says "expired" without asserting buff vs. debuff.
- **Cheapest of the four** — already forwarded; needs only handler + kind + color.

#### `debuff-resisted` — kind `debuff-resisted` (muted/gray)

Fires during a cast's debuff-rider resolution (and reactive/immunity paths). `currentTurn` is the acting actor's turn. Unstamped → standalone entry in that turn.

- Handler: `{ kind: 'debuff-resisted', actorId: e.sourceId ?? e.targetId, targets: [{ targetId: e.targetId }], reactions: [], note: e.buffName }`. `sourceId` is optional on the event; when absent, `actorId` falls back to the target and the formatter renders target-only (no "{source} →" prefix).
- Render: *"{source} → {target}: {buffName} resisted"* (or *"{target}: {buffName} resisted"* when `sourceId` absent).

#### `shield-destroyed` — kind `shield-destroyed` (damage hue)

Fires **inside `applyVictimDamage`**, which on the positional path (the path `simulateBattle` uses) runs *before* the attack's deferred `ability-performed` is emitted. Placement uses the **established defer-flush pattern** (the reflect-log mechanism at `engine.ts:3580`):

- On the positional path (`deferReflectLogs` true), buffer the row (a parallel buffer alongside `pendingReflectLogs`) and flush it in/next to `flushReflectLogs()` — i.e. right after `emitDeferredAbilityPerformed` creates the attack entry — emitting with `duringTurnOf = actingActorId` (+ `triggerActorId`, `reactive: true`) so `buildCombatLog.routeReaction` nests it under the attack.
- On every non-positional path (`deferReflectLogs` false), emit inline (the attack entry already exists), byte-identical to how reflect logs behave.
- Handler: `{ kind: 'shield-destroyed', actorId: e.victimId, targets: [{ targetId: e.victimId }], reactions: [] }`.
- Render: *"↳ {victim}'s shield destroyed"*.

#### `cheat-death-activated` — kind `cheat-death` (distinct/dramatic hue)

Same emit location and same **defer-flush** treatment as `shield-destroyed` (both fire inside `applyVictimDamage`).

- Handler: `{ kind: 'cheat-death', actorId: e.actorId, targets: [{ targetId: e.actorId }], reactions: [] }`.
- Render: *"↳ {ship} cheats death!"*.

### Team symmetry

All four emit sites are already team-agnostic (both sides route through the same `applyVictimDamage` / decrement / cast paths). The log additions add no side-specific branch.

## Testing

- **`buildCombatLog` unit tests** — one per event: placement/nesting from a hand-crafted event stream (`buff-expired` in owner turn; `debuff-resisted` standalone; `shield-destroyed`/`cheat-death` nested under an attack entry via `duringTurnOf`).
- **End-to-end** through real `simulateBattle → flattenCombatLog` for the two defer-flush events: a shield genuinely broken (`shield-destroyed` nests under the breaking attack) and a Cheat-Death ship surviving a lethal blow (`cheat-death` nests under the killing blow). Confirms the positional defer-flush ordering.
- **Golden discipline:** `buildCombatLog` snapshot goldens gain entries (expected, regenerate deliberately — never `vitest -u` blind). DPS/healing numeric goldens stay byte-identical (log-only change). Full `npm test` green, `audit:skills` 0, tsc + lint clean.

## Files touched

- `src/utils/calculators/battleSimulator.ts` — `LOG_EVENT_TYPES` (+3 types).
- `src/utils/combat/log/buildCombatLog.ts` — 4 handlers.
- `src/utils/combat/log/types.ts` — 4 `CombatLogEntryKind` values.
- `src/components/simulator/RoundEventLog.tsx` — colors + formatters.
- `src/utils/combat/engine.ts` — defer-flush buffering for `shield-destroyed` + `cheat-death-activated` (stamp `duringTurnOf`; inline on non-positional path).
- Tests: `buildCombatLog` unit specs + an end-to-end integration spec.
- `src/constants/changelog.ts` — `UNRELEASED_CHANGES` entry (user-facing log improvement).

## Risks

- **Positional ordering** for the two `applyVictimDamage` events — mitigated by reusing the proven reflect-log defer-flush pattern rather than inventing new buffering.
- **Verbosity** — `debuff-resisted` and `buff-expired` can be frequent, but both nest into / sit within the relevant turn, so they are contextual rather than free-floating noise. No toggle in this scope.
