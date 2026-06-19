# Sub-project C2b — Full Purge Ecosystem — Design

**Date:** 2026-06-19
**Branch:** `feat/combat-sim-phase5-pr2`
**Epic:** Combat-realism epic, sub-project C (Cleanse + Purge). Follows C1 (cleanse, shipped) and C2a
(on-cast purge core, shipped). This spec supersedes the thin §6.6 of the parent C spec
(`2026-06-19-cleanse-purge-design.md`) — the C2b scope grew well past it during grounding.
**Status:** Spec — pending review.

## 1. Problem

C2a made an **active/charged** purge actually remove enemy buffs (on-cast, single-anchor, newest-first,
respecting the unremovable set). Everything *around* purge is still missing or wrong:

1. **No reactive purge ecosystem.** `purge-performed` is never emitted. The reactive `executeIntent`
   purge branch is still the not-simulated skip (`triggers.ts:1158`). So the purge reactors do nothing:
   - **Sefuba** ("when this Unit purges an enemy buff, it repairs itself … and purges 1 more buff").
   - **Salvation** ("when a buff is purged from an ally, this Unit repairs that ally for 5%").
2. **No conditional-source purges.** Every purge that fires from a *passive* slot via a trigger is
   unmodelled, because C2a deliberately gated the emit to `active`/`charged` slots only:
   - **Iridium** — "when directly damaged, purges 1/2 buffs from the enemy" (`on-attacked`).
   - **Faust** — "purges 2/3 buffs from the enemy when killed by direct Damage" (`on-destroyed`,
     gated by *killed by direct damage*, targeting the killer).
   - **Rhodium** — "at the end of the round, purges 2 buffs from the enemy with the most buffs"
     (no end-of-round trigger exists; no most-buffs targeting exists).
3. **Nayra over-removal (flagged DANGEROUS in C2a).** Nayra charged: "If the target was repaired this
   round, … purge all buffs from the enemy." C2a emits `count:'all'` with `conditions:[]` and fires it
   **unconditionally** — stripping every enemy buff on every charged cast even when the in-game gate is
   false (game removes none). "Target repaired this round" is **not** a condition the engine has today
   (verified: the analogous Nayra-active Stasis clause parses with no gate). The flag says this MUST be
   fixed in C2b before any Nayra-bearing fixture exists.

C2b closes all three. **User-ratified scope (2026-06-19):** everything — the reactive ecosystem, all
three conditional sources (including Rhodium's new end-of-round subsystem), and the real Nayra condition.

## 2. Locked decisions (this brainstorm, 2026-06-19)

1. **Scope = everything**: reactive ecosystem + Iridium + Faust + Rhodium + Nayra real condition.
2. **Nayra = build the real condition** (`target-repaired-this-round`): a new `ConditionSubject`,
   engine per-actor repaired-this-round tracking, parser detection, `ConditionContext` threading, and
   gate evaluation. Not a cheap non-emit interim. (Reusable — Nayra's *active* Stasis clause uses the
   same gate, though that clause is debuff/out-of-C-scope; see §6.4 churn note.)
3. **Rhodium included** — build the new `round-ended` event + `end-of-round` trigger + `enemy-most-buffs`
   target axis.
4. **Chain-guard policy = emit from all purges, depth-1 guard** (the *faithful* option, not the
   spec-§6.6 "reactive purges never emit" default). Every purge — cast AND reactive — emits
   `purge-performed`, **except** a purge that was itself triggered by a `purge-performed` event (depth
   guard). Consequence: reactive-source purges (Iridium/Faust/Rhodium) DO trigger Salvation/Sefuba;
   Sefuba's "purge 1 more" does NOT re-trigger. Bounded at depth 1.

## 3. Decomposition (3 incremental PRs, mirroring B1/B2/B3)

- **C2b-1** — Reactive purge plumbing + reactors (Sefuba, Salvation). Self-contained, mirrors C1's
  reactive cleanse work. Establishes the reactive purge EXECUTOR that C2b-2's sources ride.
- **C2b-2** — Conditional-source purges from passive slots (Iridium, Faust, Rhodium). Adds the passive-
  slot emit + trigger detection + the new `round-ended`/`end-of-round` machinery + killer-targeting +
  `enemy-most-buffs` targeting.
- **C2b-3** — Nayra `target-repaired-this-round` condition (subject + engine tracking + parser + gate).

Order: C2b-1 first (the reactive executor is the foundation the C2b-2 sources fire through). C2b-2 and
C2b-3 are independent of each other and may ship in either order after C2b-1.

## 4. C2b-1 — Reactive purge ecosystem

### 4.1 `purge-performed` event

New event (`events.ts`, mirror `cleanse-performed` at `:107`):

```
{ type: 'purge-performed'; casterId: string; targetId: string; count: number; round: number }
```

`targetId` (the victim whose buffs were removed) is REQUIRED — `cleanse-performed` omits it because
cleanse reactors (`on-enemy-cleansed`) are caster-scoped, but `on-ally-purged` (Salvation) is
**victim**-scoped: it must route a heal to the specific ally that was purged.

### 4.2 Emit sites & the depth-1 guard

- **Cast path** — at the C2a on-cast purge fire site (`playerTurn.ts ~:1378`), after each
  `statusEngine.purge(targetId, count)`, emit `purge-performed` with the **actual removed count** (the
  return value, not `cfg.count` — honest metric, matches the cleanse-performed convention). Skip emit if
  removed `=== 0`.
- **Reactive path** — the new reactive purge executor (§4.3) emits `purge-performed` for the purges it
  fires (Iridium/Faust/Rhodium), UNLESS the intent is depth-guarded.
- **Depth-1 guard** — the `on-enemy-purged` / `on-ally-purged` listeners enqueue their reaction intents
  with a flag (e.g. `intent.fromPurgeEvent = true`). The reactive purge executor suppresses
  `purge-performed` emission when that flag is set. So only Sefuba's "purge 1 more" (the purge whose
  trigger was itself a purge) is silenced; every other purge emits. Pin a test that a Sefuba chain
  removes 2 total buffs (cast 1 + chain 1) and emits exactly ONE `purge-performed` (the cast).

### 4.3 Reactive purge executor

Replace the not-simulated skip at `triggers.ts:1158` with a `cfg.type === 'purge'` branch:

- Resolve the target: `eventCtx.counterTargetId` if present (Iridium/Faust route the attacker/killer
  here, reusing the existing counter-infliction routing convention — `triggers.ts:936-939`); else the
  turn's enemy (`ctx.enemyId`); the `enemy-most-buffs` axis (Rhodium) resolves via §5.3.
- `ctx.purge(targetId, cfg.count)` — a new engine delegate on `IntentExecContext`, mirroring
  `ctx.cleanse` / `creditReactiveDamage` / `grantExtraAction`, supplied where `statusEngine` is in scope.
  Returns the removed count.
- Emit `purge-performed` (§4.2) unless `intent.fromPurgeEvent`.

### 4.4 The two new triggers

Add `on-enemy-purged` and `on-ally-purged` to the `AbilityTrigger` union and `LIVE_TRIGGERS`
(`abilities.ts`). Register in `registerReactiveTrigger` (`triggers.ts ~:360`, the `bus.on` switch):

- **`on-enemy-purged`** — `bus.on('purge-performed', e => { if (e.casterId === ownerId) enqueue(intent with fromPurgeEvent) })`.
  Self-scoped on the caster (THIS unit did the purging). Sefuba.
- **`on-ally-purged`** — `bus.on('purge-performed', e => { if (sameSide(e.targetId) && e.targetId !== ownerId) enqueue({...intent, eventCtx:{ damagedAllyId: e.targetId }, fromPurgeEvent}) })`.
  Victim-scoped (a buff was purged from MY ally). `sameSide` = `!isOpposing` (the inverse of the existing
  opposing-scope helper). Salvation.

Both reactions are HEAL abilities (Sefuba self-heal, Salvation ally-heal) plus, for Sefuba p2, a PURGE
ability. The heals ride the existing reactive heal branch (`triggers.ts:1064`); the purge rides §4.3.

### 4.5 Parser trigger detection

Mirror `ENEMY_CLEANSE_RE` → `on-enemy-cleansed` (`skillTextParser.ts:774`/`:1016`):

- "when this Unit purges (a buff from) an enemy" → `on-enemy-purged` (Sefuba p1/p2).
- "when a buff is purged from an ally" → `on-ally-purged` (Salvation p3).

These are position-scoped phrase triggers (the `phrasePosTrigger` helper) attached to the reaction
abilities in `buildShipAbilities`. Sefuba's heal + the "purge 1 more" purge both attach `on-enemy-purged`;
Salvation's heal attaches `on-ally-purged`.

### 4.6 `reactiveRecipients(intent, ctx)` helper

The recipient resolver (`ally → eventCtx.damagedAllyId ?? targetId`; `all-allies → ctx.playerIds`;
`self → ownerId`) is currently duplicated in the reactive heal branch (`triggers.ts:1064`) and the
reactive cleanse branch (`:1122`). C2b adds no 3rd copy — extract a shared `reactiveRecipients(intent, ctx)`
helper (breadcrumb left at `triggers.ts ~:1069`) and call it from heal, cleanse, and any recipient-based
reactive purge. (Purge reactors target the victim via `counterTargetId`, not the recipient list, so the
helper's primary new consumer is structural dedup — but the extraction is the named C2b deliverable.)
Must be byte-identical for heal + cleanse (same resolution).

## 5. C2b-2 — Conditional-source purges (passive slots)

### 5.1 Emit gate extension

C2a gates the purge emit to `slot === 'active' || 'charged'`. C2b-2 extends it: ALSO emit purge from a
PASSIVE slot **when a purge trigger is detected** in the passive text (Iridium `on-attacked`, Faust
`on-destroyed`, Rhodium `end-of-round`). Use the same per-ability position-scoped trigger detection as
the reactive-trigger detection already used for cleanse (`detectCritRepairTrigger` pattern). The emitted
purge ability carries `trigger: <detected>` instead of `on-cast`, and rides the reactive purge executor
(§4.3). Passive purges with NO detected purge trigger remain non-emitted (Sefuba's "purge 1 more" is
emitted as a reaction with `on-enemy-purged`, NOT here — §4.4).

### 5.2 Iridium & Faust

- **Iridium** — passive `on-attacked` → `{type:'purge', count:1|2, trigger:'on-attacked', target:'enemy'}`.
  Routing exists: `on-attacked` already enqueues `eventCtx.counterTargetId = attackerId`
  (`triggers.ts:312`), and §4.3 resolves the purge target from `counterTargetId`. No new machinery.
- **Faust** — passive `on-destroyed` (self-scoped) → `{type:'purge', count:2|3, trigger:'on-destroyed'}`,
  gated by *killed by direct damage*, targeting the killer.
  - `ship-destroyed` is `{actorId, round}` today (`events.ts:143`) — add `killerId?: string` and
    `byDirectDamage?: boolean`. The engine sets both at the destruction emit site (the killer = the
    attacker of the lethal direct hit; DoT/detonation kills set `byDirectDamage:false`, mirroring B3's
    direct-vs-DoT channel discrimination).
  - The `on-destroyed` listener routes `eventCtx.counterTargetId = e.killerId` and only enqueues when
    `e.byDirectDamage`. (Faust's own `on-destroyed` heal/buff reactions are unaffected — they don't read
    the new fields.)

### 5.3 Rhodium — end-of-round + most-buffs

- **`round-ended` event** (`events.ts`) `{ round }`, mirroring `round-started` (`:31`). Emit it at the
  END of the round loop in `engine.ts` (the symmetric bookend of the `round-started` emit at `:2987`),
  after all turns + post-round decrements, before the round increments.
- **`end-of-round` trigger** (`abilities.ts` union + `LIVE_TRIGGERS`), registered
  `bus.on('round-ended', () => enqueue(intent))` (global, like `start-of-round`).
- **`enemy-most-buffs` target axis** — a new `AbilityTarget` value. §4.3 resolves it by scanning opposing
  actors and picking the one with the highest removable-buff count (`selfMaps`/`accumSelfMaps` size,
  ties → deterministic by actor-id order for goldens). New engine helper `enemyWithMostBuffs(ownerId)`.
- **Parser** — "at the end of the round, … purges N buffs from the enemy with the most buffs" → emit
  `{type:'purge', count:N, trigger:'end-of-round', target:'enemy-most-buffs'}`.

### 5.4 Optional fold-in (decide at plan time)

**Lodolite charged** — "the enemy with the most Buffs is Purged of all buffs" (passive voice +
most-buffs target, on a CHARGED slot). Since C2b-2 builds `enemy-most-buffs` targeting anyway, extend
`parsePurge` to also match the passive-voice "is Purged of (all|N) buffs" form with `enemy-most-buffs`
target. This is an on-cast (charged) purge, so it rides the C2a cast-path fire (no reactive trigger).
Fold in if cheap; otherwise leave deferred and note it. (Lodolite p3 "removes 100% of enemy's shield on
purge" stays deferred regardless — §7.)

## 6. C2b-3 — Nayra `target-repaired-this-round` condition

### 6.1 New `ConditionSubject`

Add `'target-repaired-this-round'` to the `ConditionSubject` union (`abilities.ts`). Binary gate.

### 6.2 Engine tracking

Track a per-actor "repaired this round" flag. Set it true when a repair LANDS on an actor (the heal
application sites — `applyHealToTarget` / `grantShieldToTarget` and the reactive heal credit, wherever a
positive heal reaches a specific actor id). Clear all flags at the round boundary (the `round-started` /
round-loop top). "Target" = the acting actor's resolved opposing target (`targetId`), so the gate reads
"was *my target* repaired this round" — matches the skill text. Threaded into `ConditionContext` as
`targetRepairedThisRound?: boolean` (defaults false in DPS mode — a dummy enemy is never repaired →
byte-identical).

### 6.3 Parser + gate

- Parser: detect "if the target was repaired this round" (and the equivalent phrasings) → a
  `{ subject: 'target-repaired-this-round', derivable: false }` condition attached to the abilities in
  that sentence (mirrors the existing condition-clause scoping).
- `evaluateConditions.ts`: evaluate the subject against `ctx.targetRepairedThisRound`.
- The C2a on-cast purge fire (`playerTurn.ts ~:1378`) currently fires unconditionally; gate it with
  `conditionsMet(ab.conditions, ctx)` so Nayra's `count:'all'` purge fires ONLY when the target was
  repaired this round. This removes the dangerous over-removal.

### 6.4 Churn note (the parser change ripples)

Detecting "if the target was repaired this round" attaches the new condition to **every** ability in
Nayra's sentences — including Nayra's *active* Stasis-inflict and Defense-Down debuffs ("If the target
was repaired this round, inflict Stasis"), which currently fire unconditionally (verified by an existing
parser test asserting the bare-inflict result with no gate). This is MORE correct, but it changes those
abilities' shape (now carry a condition). **Audit:** no Nayra fixture exists yet (per the C2a flag), so
production goldens should be byte-identical; the only churn is the parser unit test that asserts the
now-gated shape — update it deliberately, and confirm the engine still folds those debuffs in DPS mode
(where `targetRepairedThisRound` defaults false → would now NOT fire). **Open at plan time:** confirm DPS
goldens for any non-Nayra ship that happens to contain "repaired this round" phrasing don't shift; if the
default-false gate would suppress an effect that previously folded, that is a real behavior change to
audit, not a free refactor.

## 7. Out of scope / deferred

- **Lodolite p3** — "when this Unit Purges a buff from an enemy, it removes 100% of the enemy's shield"
  → a new on-purge SHIELD-removal reaction; depends on the shield system (sub-project **H**, not built).
  Deferred. (Its `on-enemy-purged` trigger detection may be added by C2b-1, but the shield-removal
  reaction is not wired.)
- **Amartya true multi-victim AoE** — "purges 1 buff from all enemies for every 50% crit power" still
  fires single-anchor count:1 (C2a's under-approximation); real multi-victim AoE → sub-project **E**.
  Crit-power count-scaling also stays deferred.
- **AoE purge across multiple victims** generally → sub-project **E** (per-victim AoE accounting),
  consistent with all other multi-target work.

## 8. Golden gate (honesty)

Not uniformly byte-identical — matches the B/C-series convention.

- **DPS mode** stays byte-identical: a dummy enemy carries no buffs (purge no-op), is never repaired
  (Nayra gate false), and the reactors need real opposing actors.
- **Healing mode + two-team sim** see **audited churn** wherever a purge/reactor now legitimately fires —
  a reactive purge removing a real enemy buff, a Salvation/Sefuba heal landing, a Faust/Iridium/Rhodium
  source purge, or a Nayra gate flipping. Re-baseline per file, every delta justified line-by-line;
  **never** blind `vitest -u`.
- `audit:skills` 0/141 (no purge rule → trivially stable; still run it), `npm run lint` 0,
  `npx tsc --noEmit` clean every PR.

**Test-runner gotcha:** bare `npm test` is Vitest WATCH (hangs agents) — use `npx vitest run <file>`.
**Always** run `npx tsc --noEmit` independently after subagent work — esbuild-based vitest passes despite
type errors (B3 lesson).

## 9. Testing

- **C2b-1:** reactive purge removes a real enemy buff in two-team sim; Sefuba chain removes 2 (cast +
  1 more) and emits exactly ONE `purge-performed`; Salvation heals the purged ally (victim-routed);
  depth-1 guard (a purge triggered by a purge does not re-trigger); `reactiveRecipients` byte-identical
  for heal + cleanse.
- **C2b-2:** Iridium purges the attacker on-attacked; Faust purges the killer on-destroyed-by-direct-
  damage (and NOT on a DoT kill); Rhodium purges the most-buffs enemy at end-of-round; `round-ended`
  fires once per round after all turns; `enemy-most-buffs` ties resolve deterministically.
- **C2b-3:** Nayra purges all buffs only when the target was repaired this round; not when un-repaired;
  flag clears at round boundary; DPS byte-identical (default false).

## 10. Grounding (verified file refs, 2026-06-19)

- `purge()` wrapper + `removeNewestFirst(actorId,'buffs',count)` exist (C2a/C1, `statusEngine.ts`).
- On-cast purge fire site: `playerTurn.ts ~:1378` (C2a, after `gatedSkill` ~:1149, side-symmetric off
  `targetId`).
- Reactive executor skip to replace: `triggers.ts:1158`. Reactive heal branch (recipient resolver):
  `:1064`. Reactive cleanse branch: `:1122`. `reactiveRecipients` breadcrumb: `~:1069`.
- Trigger registration switch: `triggers.ts ~:360`. `counterTargetId` capture (on-attacked): `:312`;
  counter-infliction routing: `:936-939`. `isOpposing` helper in scope.
- `cleanse-performed` event: `events.ts:107`; `ship-destroyed`: `:143`; `round-started`: `:31`.
- `round-started` emit: `engine.ts:2987`. `AbilityTrigger` union + `LIVE_TRIGGERS`: `abilities.ts:43-90`.
  `ConditionSubject` union: `abilities.ts:89`. `ConditionContext`: `evaluateConditions.ts:4`.
- Purge emit block (C2a, slot-gated): `buildShipAbilities.ts ~:1045`. Cleanse trigger detection
  (`detectCritRepairTrigger`): `buildShipAbilities.ts:1027`.
- `NOT_SIMULATED_TYPES` (purge already removed by C2a): `simCoverage.ts:16`.
