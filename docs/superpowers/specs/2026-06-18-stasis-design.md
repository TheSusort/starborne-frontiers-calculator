# Sub-project B — Stasis (turn-skip control) — Design

**Date:** 2026-06-18
**Epic:** `2026-06-17-combat-realism-epic-roadmap.md` (sub-project B)
**Predecessor:** sub-project A (dynamic effective-stats backbone) — CLOSED. B rides A's
`effectiveStatsOf` / `liveDebuffLandingChance` machinery for landing.
**Status:** Design — user-approved 2026-06-18; pending spec review.

> Line numbers are 2026-06-18 snapshots. Re-locate by symbol name, not offset.

## 1. Problem & goal

Stasis is the only true turn-skip control in the game, and the engine does **not simulate it
today**. `control-applied` (`events.ts`) is **emit-only** — it exposes the application moment so
reactions like Defiant's `on-stasis-applied` can fire, but no Stasis *status* is ever created on a
victim and no turn is ever skipped. The parser already detects `inflicts Stasis`
(`parseControlInflict`, `skillTextParser.ts`) but the result is discarded into the emit-only event.

**Goal:** make Stasis a fully-modelled control — inflicted via the normal landing roll, skips the
victim's scheduled action while still ticking statuses, suppresses the victim's reactions entirely,
and is broken early by direct damage (with an Akula-style "don't break" attacker exception).

## 2. Locked game rules (user-ratified, do NOT re-litigate)

- Direct damage **BREAKS** Stasis (frees the unit early). **DoTs do NOT break it.**
- "Don't break Stasis" attackers (Akula) are the exception — even their **direct** attacks don't
  break it.
- Stasis **ticks on the skipped turn** (its own duration decrements; other timed statuses tick too).
- **DoTs still tick** on the stasised unit.
- Allies **CAN still heal/buff** the stasised unit (only the unit's OWN actions/reactions are
  locked out; incoming effects apply normally).
- The stasised unit's **reactives are fully suppressed** — no scheduled action AND no reactions.

## 3. Decided scope (user-ratified 2026-06-18)

- **Full infliction pipeline, one cohesive sub-project** (not effect-only-first): parse target +
  duration → route through the **`inflict` hacking-vs-security landing roll** → create a synthetic
  timed Stasis debuff on the resolved victim → turn-skip + tick + reactive suppression +
  direct-damage break + Akula don't-break flag.
- **Breaking hit stays suppressed:** at the instant a breaking direct hit lands, the victim is still
  stasised, so its `on-attacked` reaction is suppressed for *that* hit. Stasis clears *after* damage
  is applied; subsequent hits react normally. No mid-apply re-entrancy.
- **Any landed direct attack breaks it**, regardless of shield/Barrier absorb. The break is about
  the attack connecting, not HP loss. (DoT/detonation channels never break.)
- **Total reactive lockout:** every queued intent whose owner is currently stasised is dropped —
  on-attacked, on-ally-attacked, on-crit, on-enemy-destroyed, AND start-of-round self-buffs
  (Chakara). One rule: owner-is-stasised → intent dropped.

**Out of scope:** full per-victim AoE accounting for a multi-target Stasis (sub-project E); Overload
(mis-grouped as control — it's a resource, separate work); provoke/concentrate-fire forced-targeting
(already shipped / separate). HP semantics unchanged.

## 4. Architecture

### 4.1 Status model — new leaf module
New `src/utils/combat/stasisBuffs.ts` mirroring `barrierBuffs.ts` / `cheatDeathBuffs.ts`:
- `STASIS_BUFFS: Set<string>` (the buff name(s) that mean Stasis).
- `isStasis(buffName: string): boolean`.

A small engine helper `isStasised(actorId): boolean` reads the victim's **debuff** snapshot
(`statusEngine.snapshot(...)` / `ownerDebuffNamesFor`) for an active Stasis status. Stasis is stored
as a **timed debuff in the victim's per-actor debuff store** (`decrementEnemy(actorId)`), so it
decrements on the **victim's own Post-Turn** → skips exactly N turns regardless of applier speed.

### 4.2 Infliction (applier → victim)
- **Parser:** extend the control-inflict path so it carries **duration** (parsed from skill text;
  default **1 turn** when unspecified) and the target, instead of only feeding the emit-only event.
- **Landing:** the Stasis application rides the existing **`inflict`** timed-application path,
  gated by `liveDebuffLandingChance` (attacker live hacking vs defender live security, affinity
  ±25% on hacking — all from sub-project A). A resisted Stasis surfaces via the existing
  `resistedDebuffs` channel, like any other resisted timed debuff.
- **`control-applied` still fires unconditionally on cast** — independent of landing — to keep
  Defiant's `on-stasis-applied` reaction **byte-identical**. (Defiant reacts to the act of casting,
  not to a successful land.)
- On a successful land, a timed Stasis debuff is created in the victim's debuff store.
- **AoE/multi-target:** Stasis applies to the resolved target(s) using the engine's existing
  status-application targeting. Full per-victim AoE accounting (uniform status across covered cells)
  stays in sub-project E; B does not build new multi-target accounting.

### 4.3 Turn-skip + tick (the one deviation from `handleDeadTargetSkip`)
`handleDeadTargetSkip` (`engine.ts` ~2613) skips the **entire** turn body (a dead unit ticks
nothing in-body). Stasis is different: it skips **only the action** (active/charged skill + attack)
but must still run:
- **DoT ticks** (locked: DoTs tick on the stasised unit) — these run at the start of the turn body
  (heal-target DoTs ~2985, enemy DoTs ~3255).
- the **Post-Turn decrement** (locked: Stasis + other statuses tick on the skipped turn) — already
  unconditional (`decrementPlayer`/`decrementEnemy`, ~3625-3639).

`turn-started`/`turn-ended` still emit. Concretely: each of the three turn-body kinds
(attacker / team-actor / enemy) gates its **action** portion behind `!isStasised(actor.id)` while
leaving its DoT-tick prologue and the shared Post-Turn decrement intact. (The exact placement — a
shared `handleStasisSkip` helper vs an in-body guard per kind — is a planning detail; the invariant
is: action skipped, DoT-tick + decrement preserved.)

### 4.4 Reactive suppression (total lockout)
In **both** intent drains (`drainIntents` and `drainEnemyIntents`, `engine.ts` ~2821), drop every
queued intent whose `ownerId` is currently stasised — checked via `isStasised(intent.ownerId)`.
This covers all reaction types uniformly, including start-of-round self-buffs (Chakara via
`round-started`). Filter at the drain (before `executeIntent`), not at each `enqueue` site, so the
rule lives in one place. Incoming effects (damage, heals, ally buffs/debuffs, DoT ticks) are
untouched — only the stasised unit's *outgoing* intents are dropped.

### 4.5 Break on direct damage (side-symmetric)
A break hook in **both** `applyIncomingToTarget` (`engine.ts` ~2356, player-side victim) and
`applyOutgoingToEnemy` (enemy-side victim) — the team-agnostic principle requires both directions to
break. When a **direct-channel** (`'direct'`) hit lands on a stasised victim:
- if the attacker carries the **don't-break** flag → do nothing (Akula);
- otherwise remove the Stasis status from the victim **after** damage is applied.

DoT/detonation channels (`'corrosion'`/`'inferno'`/`'detonation'`) never invoke the break. Because
removal happens after the hit is fully applied, the breaking hit's `on-attacked` reaction was
already suppressed (the victim was still stasised when the intent was filtered at drain time).

**Akula don't-break flag:** new parser `parseDoesntBreakStasis` (regex on
`/\b(?:don't|does not|doesn't)\s+break\s+stasis\b/i`) → a `doesntBreakStasis?: boolean` attacker
property, threaded from ship data through to the break hook. Akula's text
("This unit's attacks don't break Stasis...", `ships.ts`) exists but is unparsed today.

## 5. Data flow (one round)

1. Applier's turn: fires a Stasis-inflicting skill → `control-applied` emits (Defiant reaction
   unchanged) → Stasis application enters the `inflict` landing roll.
2. Lands (live hacking-vs-security): timed Stasis debuff written to victim's debuff store. Resisted:
   surfaced in `resistedDebuffs`, no status created.
3. Victim's turn (while stasised): DoT ticks run, **action skipped**, Post-Turn decrement reduces
   Stasis + other statuses by 1. Any reactive intents owned by the victim are dropped at drain.
4. A direct hit on the victim (any source, any side): damage applied; then unless the attacker has
   don't-break, the Stasis status is removed. The victim's next scheduled turn proceeds normally.

## 6. Testing

New dedicated `src/utils/combat/__tests__/stasis.test.ts` (mirrors `barrier.test.ts`):
- skip-action-but-still-tick-DoT-and-decrement (the §4.3 deviation);
- exact N-turn duration (1-turn skips exactly one scheduled action; 2-turn skips two);
- direct-damage breaks vs DoT does NOT break;
- breaking hit's on-attacked reaction stays suppressed (no counter on the breaking hit);
- total reactive lockout — on-attacked AND start-of-round self-buff (Chakara) both suppressed;
- Akula don't-break: direct hit does not break, victim stays stasised full duration;
- landing roll: resisted Stasis creates no status and surfaces in `resistedDebuffs`;
- allies can still heal/buff a stasised unit (incoming beneficial effects unaffected).

**Golden invariant:** all existing DPS/healing goldens stay **byte-identical** — no existing fixture
applies Stasis, so any snapshot movement means the gate leaked; fix the gate, never `vitest -u`.
Use `npx vitest run <name>` (bare `npm test` = watch mode, hangs agents). `audit:skills` 0/141 +
lint (max-warnings 0) + tsc clean every PR.

## 7. PR split (refined in writing-plans)

- **B1** — status model (`stasisBuffs.ts` + `isStasised`) + infliction (parse target/duration,
  route through the inflict landing roll, create the timed debuff on the victim) + turn-skip + tick.
  Stasis lands and skips turns; does not yet break early or suppress reactions.
- **B2** — reactive suppression (drain-time filter) + direct-damage break (both apply sites) +
  Akula don't-break parser/flag.

Each PR: subagent-driven, per-task spec+quality + final holistic (opus) review, byte-identical
goldens as the gate.

## 8. Open items for the plan (not blockers)

- Exact Stasis buff-name string(s) for `STASIS_BUFFS` — derive from `docs/ship-skills.csv` /
  `ships.ts` (is it bare `Stasis`, or `Stasis I/II`? and does the numeral encode duration vs target
  count?). Confirm against corpus during B1 planning.
- Whether duration is encoded in the buff name (e.g. `Stasis II`) or always 1 turn in the corpus —
  drives the parser duration extraction in §4.2.
- Placement of the action-skip gate: shared `handleStasisSkip` helper vs per-kind in-body guard —
  decide in the plan against the three turn-body shapes.
