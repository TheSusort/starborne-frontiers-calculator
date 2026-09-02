# Insidiousness: one proc roll per attack, all debuffed enemies or none

**Date:** 2026-07-24
**Status:** Approved (design), awaiting implementation plan
**Scope:** Insidiousness implant only. Firewall / Lockdown / the `on-attacked` family are audited
below but explicitly OUT of scope — see "Deferred: proc-granularity audit".

## Problem

A combat-log line the user flagged:

```
Curator's turn · charge 0/3
Curator → Enemy AEGIS: Attack Down III
Curator → Enemy Curator: Attack Down III
Curator → Enemy AEGIS: Crit Power Down III
Curator → Enemy Curator: Crit Power Down III
Curator
Enemy AEGIS: 11,949 (crit) → 45%
Enemy Curator: 10,056 (crit)
  ↳ reacts: Enemy AEGIS's shield destroyed
  ↳ reacts: Curator → Enemy AEGIS: 19,915 (crit)      <-- this line
  ↳ reacts: Enemy AEGIS: Defense Up II
```

The 19,915 hit is the **Insidiousness** major implant on Curator, not a ship-kit ability
(`buildEquipmentAbilities.ts` `INSIDIOUSNESS`: `type:'damage'`, `target:'enemy'`,
`trigger:'on-debuff-inflicted'`, legendary = 100% multiplier / 21% proc). The arithmetic confirms
attribution exactly: `11,949 × 100/60 = 19,915` — a 100%-multiplier copy of the 60%-multiplier
active hit, same attacker, same victim, same defence. It landed on raw HP because the active's hit
had just destroyed AEGIS's shield. (The `Defense Up II` line after it is AEGIS's own
`on-ally-shield-destroyed` passive counting itself — correct, per the Wave-4 self-shield fix.)

Two defects, both in how the reaction is scoped:

1. **Wrong victim.** The `on-debuff-inflicted` listener (`triggers.ts:447`) calls bare
   `enqueue(intent)`, discarding *which* enemy was debuffed. The reactive damage branch therefore
   falls through to its "no specific triggering enemy" fallback (`triggers.ts:3299`) and routes to
   `livingOpposingActorIds(owner)[0]` — the first living enemy in roster order. With an AoE
   debuffer this always dumps Insidiousness onto enemy slot 1, even when the triggering infliction
   landed elsewhere.

2. **Rolls far too often.** `debuff-applied` fires once per (debuff × enemy). Curator's active
   produces **four** applications (Attack Down III + Crit Power Down III × 2 enemies) → four
   independent 21% rolls, ≈66% chance of at least one proc per turn.

**Confirmed in-game behaviour (user):** Insidiousness rolls **once per attack**, and on a pass it
triggers on **all** debuffed enemies or none — never a subset.

## Design

### 1. Victim routing

The `on-debuff-inflicted` listener stamps the debuffed target into `eventCtx` on both of its
branches (`debuff-applied` and `dot-applied`):

```ts
eventCtx: { ...intent.eventCtx, debuffVictimId: e.targetId }
```

This mirrors the existing stamps in sibling listeners (`counterTargetId` for
`on-enemy-charged-cast` / `on-debuff-resisted`, `damagedAllyId` for `on-ally-debuff-inflicted`,
`victimId` for `on-bomb-detonated`).

The reactive **damage** branch gains one clause reading `eventCtx.debuffVictimId`, placed
immediately above the "no specific triggering enemy" `else` so `opposing[0]` is no longer reachable
for this trigger.

**Deliberately consumed only in the damage branch.** The corpus' other `on-debuff-inflicted`
abilities are self-riders (APEX shield, Butcher/Torcher/Prospect/Yuyan buffs, Hemlock charge),
`all-allies` (Pestilence cleanse), or Warden's `target:'enemy'` debuff. None reads this field, so
none changes behaviour. Warden's routing is arguably wrong in the same way, but that is a separate
change and out of scope here.

**Resists need no filtering.** `debuff-applied` fires only on a landed debuff — Block-Debuff resists
emit `debuff-resisted` (`debuffImmunity.ts:82`) and silent landing-roll failures emit nothing. So
"only enemies the debuff actually landed on" falls out of the event stream for free.

### 2. One verdict per attack, all-or-none

New optional ability-level field, declared beside `procChance` (`src/types/abilities.ts:1075`):

```ts
/** Proc-roll granularity for a probabilistic reactive ability. 'per-attack' rolls ONCE per
 *  actor turn and reuses that verdict for every qualifying trigger event in the same attack
 *  (Insidiousness: all debuffed enemies take the hit, or none do). Absent → per-event, the
 *  historical behaviour of every other procChance ability. */
procScope?: 'per-attack';
```

Set on the `INSIDIOUSNESS` builder only.

`passesProcChanceGate` gains a memo. When `procScope === 'per-attack'`, key
`` `${ownerId}:${abilityId}` `` into a new `IntentExecContext.procDecisionThisAttack:
Map<string, boolean>`:

- **hit** → reuse the stored verdict, draw nothing;
- **miss** → draw the rate gate once, store the verdict, return it.

The engine clears that map at `engine.ts:6663`, beside the existing
`counterFiredThisTurn.clear()` / `reactionFiredThisAttack.clear()` turn-start resets. Absent map
(unit-test contexts that don't wire it) → pass-through to a plain per-event draw, byte-identical.

**Why an opt-in flag rather than memoizing the gate outright:** `passesProcChanceGate` is shared by
the damage, heal, shield, buff and debuff branches. A blanket memo would silently convert Adaptive
Plating, Smokescreen, Ambush, Bloodthirst, Reactive Ward and Tenacity from per-event to per-turn
rolls. The flag keeps every one of them untouched.

**Why a verdict cache and not a once-per-attack suppression:** the two requirements interact.
Suppressing later intents (the `reactionFiredThisAttack` pattern) would roll once but damage only
the *first* debuffed enemy. Caching the verdict lets every debuff event this attack execute against
its own victim under one shared pass/fail — which is what makes the behaviour genuinely all-or-none.

### 3. One hit per victim per attack (found during implementation)

The verdict cache alone was not sufficient. The trigger fires once per debuff **application**, so
Curator's cast (two debuffs × two enemies) produced FOUR hits under the single shared verdict — each
enemy hit twice, i.e. 200% damage for a 100% implant. The engine acceptance test caught this; the
looser "all-or-none" assertion originally planned would have shipped it.

The damage branch therefore dedupes per `(owner, ability, victim)` within the attack, gated on
`procScope === 'per-attack'`, using the existing `reactionFiredThisAttack` Set (already cleared at
each actor turn-start beside the verdict cache). A *different* debuffed enemy still takes its own
hit; only a same-victim repeat inside one attack is dropped.

**Precedent.** `on-own-repair-to-ally` (Font of Power, Abundant Renewal) already implements exactly
this shape from the other direction: one enqueue per cast, fanned out to every recipient via
`eventCtx.repairedAllyIds`. Insidiousness can't use that shape directly because its trigger is
inherently per-application, hence the verdict cache.

### Net effect

Curator's four debuff applications collapse to **one** 21% roll. On a pass, both debuffed enemies
take the 100% hit; on a fail, neither does. Effective rate drops from ≈66%/turn to 21%/turn.

## Testing

TDD, red first, driven through the production builder and real listener registration — not
hand-built ability literals. RNG pinned via `setupKeyedTestRng` / `resetRateGateRng` + `mulberry32`
(the engine is not deterministic by default; the rate gate keys on `ownerId`).

1. **Gate memo (unit).** Two intents, same owner + ability, `procScope:'per-attack'` → identical
   verdict from a single rate-gate draw; after clearing `procDecisionThisAttack`, a fresh draw.
   Without the flag → one draw per intent (regression guard for Adaptive Plating et al.).
2. **Victim routing (unit).** An `on-debuff-inflicted` damage intent carrying `debuffVictimId`
   damages that victim and never `opposing[0]`.
3. **Engine integration.** Curator + legendary Insidiousness vs a 2-enemy positional roster,
   seeded: a passing seed yields exactly two `reactive-damage-performed` rows, one per debuffed
   enemy; a failing seed yields zero. Assert through the combat log, not internal state.
4. **Resist case.** An enemy that resisted the debuff takes no Insidiousness damage while a
   landed-on sibling does.
5. **Mutation guard.** The `INSIDIOUSNESS` builder shape — `procScope` present, multiplier and proc
   tables intact per rarity.
6. **Full suite.** `npm test` (the golden skill audit spans the whole run) plus `npm run lint`
   — lint is a separate gate husky does not cover.

## Out of scope / follow-ups

**Changelog.** User-facing fix → add a plain-English entry to `UNRELEASED_CHANGES` in
`src/constants/changelog.ts` before committing.

### Deferred: proc-granularity audit

All 33 proc-chance-bearing equipment abilities were checked against their listeners' real fan-out.
The engine's proc gate is per-*event* everywhere; several triggers fire more than once per attack.
Insidiousness is being fixed; the rest are **left alone pending in-game verification** of whether
the game's granularity is per attack universally.

**Class A — rolls per effect application (same shape as Insidiousness):**

| Implant | Trigger | Rolls per attack |
| --- | --- | --- |
| Firewall (self Block Debuff) | `on-debuffed` | one per debuff *received* |
| Lockdown (all-allies Buff Protection) | `on-debuff-resisted` | one per *resisted* debuff |

**Class B — rolls per hit within one attack.** `emitAttacked.ts:24` emits one `attacked` event per
hit, so Adaptive Plating's comment claiming "on-attacked fires once per attack" is inaccurate.

| Implant | Trigger | Behaviour |
| --- | --- | --- |
| Smokescreen (self Stealth) | `on-attacked` | rolls per hit until one passes; effect capped per attack by the self-rider guard |
| Adaptive Plating (self shield) | `on-attacked` | rolls per hit; effect capped by `oncePerRound` |
| Bulwark (Provoke) | `on-ally-attacked` | rolls per damaged ally per hit; effect capped by `oncePerRound` |
| Reactive Ward (self cleanse) | `on-attacked` | rolls **and cleanses** per hit — uncapped |
| Tenacity (all-allies Buff Protection) | `on-attacked` | rolls **and applies** per hit — uncapped |
| Second Wind (self heal) | `on-attacked` | rolls **and heals** per hit — heal branch scales per hit by design |
| Bloodthirst (self heal) | `on-crit` | explicit `for (i < critHits)` loop — one roll per critting hit |

The last three don't merely roll too often, they *apply* repeatedly: a 3-hit attacker triggers three
cleanses / three Buff Protection applications / three heals. Higher severity than Insidiousness if
the game is in fact per-attack.

**Class C — already once per action, no change needed.** Font of Power, Abundant Renewal
(`on-own-repair-to-ally` — one enqueue per cast, fanned out via `repairedAllyIds`), Resonating Fury
(`on-shield-applied`, carries `recipientIds`), Spearhead, Ambush, Alacrity, Fortifying Shroud,
Doomsayer, Last Stand, Martyrdom, Boost, Ironclad, Shadowguard, Lifeline. Menace, Giant Slayer,
Nourishment, Vivacious Repair and Exuberance are modifier folds that roll per hit, which is correct
for "amplify *a* hit".

**Ordering checks — clean.** The debuff branch does cap-check → roll → mark, so a failed Bulwark
roll never burns its round (`triggers.ts:2526`). The buff branch consumes
`oncePerRoundPerAlly` before the proc gate, but no ability today carries both, so it is inert.

**Warden's victim routing.** Warden's `on-debuff-inflicted` `target:'enemy'` debuff hits
`opposing[0]` for the same reason Insidiousness did. Not touched here; the new `debuffVictimId`
field makes it a small follow-up if desired.
