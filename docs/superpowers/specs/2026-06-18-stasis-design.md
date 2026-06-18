# Sub-project B — Stasis (turn-skip control) — Design

**Date:** 2026-06-18
**Epic:** `2026-06-17-combat-realism-epic-roadmap.md` (sub-project B)
**Predecessor:** sub-project A (dynamic effective-stats backbone) — CLOSED. B rides A's
`effectiveStatsOf` / `liveDebuffLandingChance` machinery for landing.
**Status:** Design — user-approved 2026-06-18; **revised 2026-06-18** after a code trace
(see §3.1) found the infliction pipeline mostly already exists and that correct victim routing
requires pulling sub-project **E's PR7b (per-victim modifier sourcing)** forward as B's foundation.
Re-running spec review after the revision.

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

- **Full infliction pipeline, one cohesive sub-project** (not effect-only-first): land a real timed
  Stasis debuff on the resolved victim via the existing `inflict` landing roll → turn-skip + tick +
  reactive suppression + direct-damage break + Akula don't-break flag.
- **Per-victim foundation pulled forward (§3.1):** to land Stasis on the *specific* victim, B
  front-loads **E's PR7b — per-victim debuff modifier sourcing** as **B1**: general player→enemy
  `targetId` routing **and** the matching reader moves, so other debuffs' effects don't drop.
  Boundary: PR7b only — E's PR7a (symmetric incoming surface), PR7c (per-victim leech), PR7d
  (death-fallback + accounting unification) stay deferred.
- **Breaking hit stays suppressed:** at the instant a breaking direct hit lands, the victim is still
  stasised, so its `on-attacked` reaction is suppressed for *that* hit. Stasis clears *after* damage
  is applied; subsequent hits react normally. No mid-apply re-entrancy.
- **Any landed direct attack breaks it**, regardless of shield/Barrier absorb. The break is about
  the attack connecting, not HP loss. (DoT/detonation channels never break.)
- **Total reactive lockout:** every queued intent whose owner is currently stasised is dropped —
  on-attacked, on-ally-attacked, on-crit, on-enemy-destroyed, AND start-of-round self-buffs
  (Chakara). One rule: owner-is-stasised → intent dropped.

**Out of scope:** AoE multi-target Stasis accounting and the rest of E (PR7a/c/d); Overload
(mis-grouped as control — it's a resource, separate work); provoke/concentrate-fire forced-targeting
(already shipped / separate). HP semantics unchanged.

## 3.1 What the code trace found (2026-06-18) — reshapes B

A trace of the `debuff` pipeline (parser → `buildShipAbilities` → `playerTurn` → engine →
`statusEngine`) found that **most of the infliction pipeline already exists and already runs for
Stasis**:

- "inflicts Stasis for N turns" **already** parses into a `debuff` ability: `Stasis` is in the
  `BUFFS` catalog as `{name:'Stasis', type:'debuff'}` (`src/constants/buffs.ts:202`); not
  DoT-prefixed, so `buildSkillBuffAutoFill` routes it into `enemyDebuffs` → a
  `{type:'debuff', buffName:'Stasis', application:'inflict', duration:N}` ability. The duration
  "for N turns" is **already parsed** (`DURATION_RE`) and stamped onto the ability.
- It already rides the `inflict` landing roll (`landsTimedEnemyApplicationLive('inflict')` →
  `liveDebuffLandingChance`), already captures resists into `resistedDebuffs`, already applies via
  `statusEngine.applyTimedAbilityStatus` and decrements via `decrementEnemy(actorId)`.
- The `control` ability (emit-only, for Defiant's `on-stasis-applied`) and the `debuff` ability
  **already coexist** from the same clause — `controlAbilitiesFromSkill` partitions on
  `type==='control'` and never touches the debuff. So **no parser/ability-config change is needed**;
  the earlier §4.2 "add `duration` to the control config" plan is unnecessary.
- `isStasised(id)` falls out of the existing `ownerDebuffNamesFor(statusEngine, id)` helper for free
  (it already reads a given actor's active debuff names, including timed-only statuses).

**The one real infliction gap is victim routing.** `engine.ts:2552` threads `targetId` to the
status engine **only when `a.side === 'enemy'`**. So a *player* attacking an enemy lands the Stasis
debuff on the shared `__enemy__` sentinel store, not the specific enemy victim's per-actor store —
`isStasised(enemyVictimId)` would read empty. Threading `targetId` for player→enemy fixes this, but
the **readers** of enemy-debuff stat-modifiers still read `__enemy__`
(`playerTurn.ts:733` `snapshot(actor.id)`) and the positional victim defense profile is **hardcoded
`defenceModifierPct: 0`** (`engine.ts:2432`). So threading the *writes* without moving the *readers*
would silently **drop** scheduled enemy-debuff effects (Defense Down, etc.). Moving the readers
per-victim **is** E's PR7b. Hence B1 below. (Stasis itself carries **empty `parsedEffects`** — no
stat modifier — so Stasis alone never depends on the reader move; the reader move exists to keep
*every other* player-applied debuff correct once routing goes general.)

## 4. Architecture

### 4.1 Status model — new leaf module
New `src/utils/combat/stasisBuffs.ts` mirroring `barrierBuffs.ts` / `cheatDeathBuffs.ts`:
- `STASIS_BUFFS: Set<string>` (the buff name(s) that mean Stasis).
- `isStasis(buffName: string): boolean`.

A small engine helper `isStasised(actorId): boolean` reads the victim's **debuff** snapshot
(`statusEngine.snapshot(...)` / `ownerDebuffNamesFor`) for an active Stasis status. Stasis is stored
as a **timed debuff in the victim's per-actor debuff store** (`decrementEnemy(actorId)`), so it
decrements on the **victim's own Post-Turn** → skips exactly N turns regardless of applier speed.

### 4.2 Infliction (applier → victim) — already mostly built
Per §3.1, the parse → debuff-ability → landing-roll → `applyTimedAbilityStatus` → `decrementEnemy`
pipeline already exists and already runs for Stasis. **No parser or ability-config change is
needed.** The only new infliction wiring is the **victim routing** (B1 / §4.6): once `targetId` is
threaded for player→enemy, the existing pipeline lands the Stasis debuff on the resolved victim's
per-actor store with no further change. Properties that already hold and must be preserved:
- **Landing** rides the existing **`inflict`** path (live hacking-vs-security, affinity ±25% on
  hacking — sub-project A); resisted Stasis already surfaces via `resistedDebuffs`.
- **`control-applied` still fires unconditionally on cast** (Defiant's `on-stasis-applied` reaction
  stays **byte-identical** — it reacts to casting, not to a successful land).
- **AoE/multi-target:** Stasis applies to the resolved target(s) via the existing status-application
  targeting. Multi-target AoE accounting stays in sub-project E (PR7a/c/d); B does not build it.

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
("This unit's attacks don't break Stasis...", `ships.ts` ~47/49) exists but is unparsed today; a
second ship (`ships.ts` ~2529/2531, "do not break stasis") shares the phrasing — the regex
generalizes to both, which is correct.

### 4.6 Per-victim debuff modifier sourcing (B1 — E's PR7b, pulled forward)
The foundation that makes a debuff land on the *specific* victim and still be *read* there. Two
halves that MUST move together:

- **Routing (writes):** thread `targetId` for the player→enemy direction in `buildTurnArgs`
  (`engine.ts` ~2552, today `...(a.side === 'enemy' ? { targetId: tgt.id } : {})`). General — all
  player-applied debuffs route to the resolved victim's per-actor store. **Guarded** so the DPS
  dummy / `__enemy__` sentinel path is unchanged when the target is not a real positioned actor
  (preserves DPS/healing byte-identical goldens).
- **Reading (reads):** move the enemy-debuff-modifier readers from `__enemy__` to the bound victim:
  - `playerTurn.ts:733` `statusEngine.snapshot(actor.id)` → `snapshot(actor.id, targetId)` so the
    *scheduled* enemy-debuff half of `roundEnemyDebuffs` reads the victim's store (the ability half
    already takes `targetId`). Falls back to `__enemy__` when `targetId` is absent (dummy path).
  - `engine.ts:2432` `defenseProfileOf` `defenceModifierPct: 0` → a per-victim lookup of the
    victim's enemy-debuff snapshot (`toEnemyModifiers`) for `defenceModifierPct`, plus the matching
    per-victim **incoming-damage** modifier in `victimHitDamage`'s scalars
    (`engine.ts:2395-2404` documents this as the deferred Phase-5/PR7b refinement).
- **Scope guard:** attacker-sourced modifiers (own outgoing-damage buff, defense penetration) stay
  attacker-sourced — only the *victim-debuff-derived* modifiers (defence + incoming-damage) move
  per-victim. PR7a (symmetric incoming surface), PR7c (per-victim leech), PR7d (death-fallback +
  accounting unification) stay deferred.
- **Golden gate:** DPS + healing goldens byte-identical (dummy/`__enemy__` guard); two-team-sim
  goldens (`twoTeamBattle`, `dpsSimulator` multi-actor) audited line-by-line — player-applied
  debuffs now sit on per-victim stores; effects must be preserved (not dropped), so any movement is
  explained, never `vitest -u`'d.

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

- **B1 — Per-victim debuff modifier sourcing (E's PR7b, pulled forward) (§4.6).** General
  player→enemy `targetId` routing + the matching reader moves (snapshot key + `defenseProfileOf` +
  per-victim incoming-damage modifier). No Stasis behavior yet. DPS/healing byte-identical;
  two-team-sim goldens audited. This is the foundation the rest of B rides.
- **B2 — Stasis status model + action-skip + tick.** `stasisBuffs.ts` (`STASIS_BUFFS` + `isStasis`)
  + `isStasised(actorId)` (via `ownerDebuffNamesFor`, now per-victim thanks to B1) + the action-only
  turn-skip that still ticks DoTs and decrements (§4.3). Stasis lands (already) and skips turns; does
  not yet break early or suppress reactions.
- **B3 — Stasis reactive suppression + direct-damage break + Akula don't-break.** Drain-time intent
  filter (§4.4) + side-symmetric break hook (§4.5) + `parseDoesntBreakStasis` flag.

Each PR: subagent-driven, per-task spec+quality + final holistic (opus) review, byte-identical
goldens as the gate (audited two-team-sim churn only where B1 legitimately moves a debuff per-victim,
explained line-by-line).

## 8. Open items for the plan (not blockers)

- **B1 guard condition** — the exact test for "real positioned actor vs DPS dummy / `__enemy__`" at
  the `targetId`-threading site (`isDummyEnemy` / presence in the positioned roster). Confirm in the
  B1 plan against `buildTurnArgs` and `selectTurnTarget`.
- **B1 reader completeness** — confirm the full set of victim-debuff-derived modifiers to move
  per-victim (defence + incoming-damage are the known two from `engine.ts:2395-2404`); verify no
  other reader silently reads `__enemy__` for a victim-debuff effect.
- Exact Stasis buff-name string(s) for `STASIS_BUFFS` — derive from `docs/ship-skills.csv` /
  `ships.ts` (is it bare `Stasis`, or `Stasis I/II`? and does the numeral encode duration vs target
  count?). Confirm against corpus during B2 planning. (Duration "for N turns" is already parsed; this
  is only about which name strings count as Stasis.)
- Placement of the action-skip gate: shared `handleStasisSkip` helper vs per-kind in-body guard —
  decide in the B2 plan against the three turn-body shapes.
