# Buff granter attribution — making other-directed kit observable

**Date:** 2026-08-06
**Status:** design approved, ready for planning

## Problem

The real-kit fingerprint suite (`realKitFingerprints.test.ts`, merged #298) fingerprints one focus
actor: `fingerprintActorTokens(result, FOCUS_ACTOR_ID)` collects the `kind[:slot]` token of every
log entry whose `actorId` matches the focus. A ship whose kit acts entirely on *other* actors
therefore produces no tokens of its own and reads as dead.

Purifier is the worked example. Its committed snapshot is `charge-changed` in all three scenarios,
which looks like an engine bug — the suspicion that opened this work. It is not. Dumping the full
battle log for every actor shows the active firing correctly on every round:

```
turn: attacker
  [buff:active] actor=p:trace:Jempol:1  note=Hacking Up II
  [buff]        actor=p:trace:Rookie:3  note=Hacking Up II
  [buff]        actor=p:trace:Jempol:1  note=Binderburg Resilience II
  [buff]        actor=p:trace:Rookie:3  note=Binderburg Resilience II
  [charge-changed] actor=attacker
```

Jempol@T4 and Rookie@B4 are buffed; Krysa@T2 is not — exactly matching
`Wings-Support-Not-Self-Range-2 @ M4 → {T3, T4, B3, B4}` (`resolvePattern.test.ts:461`). The
charged cast correctly swaps in Security Up III. Targeting, pattern resolution and buff application
are all correct. The suite simply cannot see them.

### Root cause

`buff` is the ONLY grant-style log kind attributed to its recipient. Every sibling books to the
source:

| Handler | Attribution |
| --- | --- |
| `ability-performed` → `attack` | `e.actorId` (attacker) |
| `heal-performed` → `heal` | `e.casterId` |
| `shield-applied` → `shield` | `e.granterId` |
| `control-applied` → `control` | `e.casterId` |
| `cleanse-performed` / `purge-performed` | `e.casterId` |
| `debuff-applied` → `debuff` | `e.sourceId` |
| `dot-applied` → `dot-applied` | `e.sourceId` |
| **`buff-applied` → `buff`** | **`e.actorId` (recipient)** |

This is a one-field inconsistency in the log layer, not an architectural gap. The `buff-applied`
event (`events.ts:93`) carries no granter at all, so the fix is to plumb one.

Note the related recipient-attributed kinds that are NOT part of this change: `buff-expired`,
`shield-applied-log`/`shield-destroyed-log` (`victimId`), `dot-ticked` and `detonation`
(`targetId`). Each is a genuine event *about the recipient*, and `shield` deliberately runs both
conventions through two separate handlers.

## Scope

In scope: `buff-applied` gains a granter; the log entry books to it; the UI formatter surfaces the
recipient; the fingerprint suite records the resulting audited snapshot move.

Out of scope: the three ships whose active resolves to zero cells at the focus cell
(Faust / Mender / Refine, all `Pattern-Line-Support-Not-Self-*`, which extends forward from the
front-most column M4 and clips entirely off-board). That is a fixture *board* defect with a
different fix and a much larger snapshot blast radius — moving `FOCUS_POSITION` would churn all 147
snapshots, since three enemies sharing row M is what puts the focus under fire at all. Not yet
scheduled; it needs its own design.

## Design

### 1. Engine — plumb `granterId`

`buff-applied` gains an optional `granterId: string`. All four real emission sites already have the
granter to hand, and `AbilityStatusBase.casterId` (`statusEngine.ts:68`) is documented as always
set by the engine:

| Site | Granter expression |
| --- | --- |
| `playerTurn.ts:1795` (cast path) | `status.casterId ?? actor.id` |
| `engine.ts:444` (passive seed) | `status.casterId ?? rt.actor.id` |
| `triggers.ts:2649` (reactive primary) | `intent.ownerId` |
| `triggers.ts:2694` (co-granted extras) | `intent.ownerId` |

`casterId` is optional *only* so the statusEngine's own unit fixtures need not restate it, so every
site falls back to the recipient. A fixture-shaped event with no caster therefore behaves exactly
as it does today.

Team symmetry holds by construction: `playerTurn.ts:1780` documents that enemies run this same
per-recipient application loop, so an enemy granting a buff to an enemy ally is attributed by the
same code path. This is a hard requirement for engine work in this repo.

### 2. Log layer

```ts
'buff-applied': (e, ctx) => {
    if (!ctx.currentTurn && !ctx.currentRound) return;
    const entry: CombatLogEntry = {
        kind: 'buff',
        actorId: e.granterId ?? e.actorId,
        targets: [{ targetId: e.actorId }],
        reactions: [],
        note: e.buffName,
        ...(ctx.consumePendingSkill() ?? {}),
    };
    ctx.attachEntry(entry);
},
```

Two deliberate decisions:

- **`buff-expired` stays recipient-attributed.** Expiry has no granter and none is tracked at that
  point. Consequence to document: Purifier gains `buff` but not `buff-expired`; the ally keeps the
  expiry. Confirmed as acceptable by the owner during design.
- **No aggregation.** An N-recipient grant stays N entries with one target each, rather than
  collapsing into a `perTarget` list the way `heal` does. The fingerprint is a set, and
  per-recipient lines read fine in the UI. YAGNI.

### 3. UI

`RoundEventLog.tsx:145` changes from `buff: noteLine` to `buff: sourceTargetNoteLine` — the
formatter `debuff` and `dot-applied` already use. That formatter collapses to `"{src}: {note}"`
when the target is the actor itself (`RoundEventLog.tsx:122`), so **self-buffs render exactly as
they do today**. Only ally-grants change:

```
before:  Jempol: Hacking Up II
after:   Purifier → Jempol: Hacking Up II
```

This surfaces who granted an ally buff, which the app currently shows nowhere.

### 4. Expected snapshot movement

Purely additive within the fingerprint suite. In that fixture no focus ship can receive a buff from
anyone else: allies are the seven verified-inert filler ships (no passives, no charge skill, bare
"deals 90% damage" active), the focus carries no gear (`canonicalPlacement`, no gear/refits/
engineering), and enemies cannot grant player buffs. Self-buffs have `granter === recipient` and do
not move. So Purifier-class ships **gain** `buff` tokens and nothing loses any.

The real risk sits outside this suite: the ablation harness (`fingerprintActor`) and the
interaction audit also fingerprint over combat logs, and a buff moving from ally to caster can move
their results. Full-suite verification is a required step, not a formality.

## Testing

Red test first, in this order:

1. **Failing fingerprint test** — Purifier's focus fingerprint contains `buff`. Fails today.
2. **`buildCombatLog` unit tests** — the entry books to `granterId`, the recipient lands in
   `targets[0]`, and an event with no `granterId` still books to the recipient (fixture
   compatibility).
3. **Symmetry test** — an enemy-side ally-grant is attributed to the enemy granter, per the
   repo's team-symmetry requirement for engine work.
4. **`RoundEventLog` tests** — the ally-grant arrow line, and the unchanged self-buff collapse.
5. **Audited snapshot move** — run the full suite, confirm every moved snapshot is an addition,
   and explain the move in the commit. `vitest -u` on the fingerprint file is otherwise forbidden.

## Open questions

None. The `buff-expired` asymmetry was raised during design and accepted.
