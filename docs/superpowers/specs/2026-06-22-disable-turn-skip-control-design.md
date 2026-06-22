# Disable as a turn-skip control effect (D-PR13) — Design

**Date:** 2026-06-22
**Branch:** `feat/combat-d-pr13-disable-turn-skip` (off the D-PR12 tip `998416c3`)
**Bucket:** D (implants + gear-set abilities) — the control-mechanic PR that lights up D-PR7 Martyrdom.

## Problem

The `Disable` status is the game's second turn-skip control (after Stasis), but the
combat engine does not model it. Today only **Stasis** skips a unit's turn
(`STASIS_BUFFS` / `isStasised`). Every source of Disable therefore applies an inert
buff:

- **Martyrdom** (D-PR7 implant) applies `Disable` to the killer on death — but the
  registry comment states it plainly: *"Disable is not a modeled turn-effect yet
  (only Stasis skips turns) — the debuff is applied to the killer + logged."* So
  Martyrdom is emit-only.
- **5 skill-text inflictors** parse `Disable` as a named timed debuff and land it on
  enemies, where it currently does nothing: APEX (charged, shield-gated), IonScorp
  (active, vs Defender), Makoli (reactive on-attacked < 40% HP), Xcellence (charged),
  Yuyan (charged).

This PR makes the engine honor a `Disable` buff as a turn-skip control. Because the
turn gate is **buff-name-driven**, this lights up Martyrdom *and* all 5 skill-text
inflictors with **no parser change**.

## Game model (user-ratified)

Disable = **locked out, takes damage**:

| Axis | Stasis | Disable |
| --- | --- | --- |
| Skips the unit's scheduled action (active/charged skill + attack) | yes | **yes** |
| Reactive abilities suppressed while afflicted | yes | **yes** |
| Timed statuses + DoTs still tick/decrement on the skipped turn (duration N → N skips) | yes | **yes** |
| Broken by a direct hit | yes (§4.5) | **no** — persists when hit |
| Damage immunity | no (hits land, then break) | **no** — hits land normally |

So Disable shares Stasis's **turn-skip + reactive-lockout** axes, and diverges on the
**break-on-hit** axis (Stasis-only).

## Approach

**Chosen: a shared `isTurnBlocked` predicate.** Mirror `stasisBuffs.ts` with a tiny
`disableBuffs.ts`, add an `isDisabled` reader and an `isTurnBlocked = isStasised ||
isDisabled` composite in the engine, and route the **turn-action gates** and the
**reactive-suppression** site through `isTurnBlocked`. Leave the break/immunity sites
keyed on `isStasised` so Disable never breaks.

Alternatives rejected:

- *Fold Disable into a renamed `TURN_SKIP_BUFFS` set and special-case the break.* More
  invasive to existing Stasis semantics, muddies the "Stasis" naming, risks the break
  logic. No.
- *Model Disable as a first-class `control` effect with a generalized control-lockout
  subsystem.* Over-engineered for one new effect; YAGNI. The `control` ability *type*
  already exists for cast-path `control-applied` reactions and is untouched here.

## Components & changes

### New: `src/utils/combat/disableBuffs.ts` (mirrors `stasisBuffs.ts`)

```ts
export const DISABLE_BUFFS: ReadonlySet<string> = new Set(['Disable']);
export function isDisable(buffName: string): boolean { return DISABLE_BUFFS.has(buffName); }
```

Doc comment spells out the divergence from Stasis: turn-skip + reactive-lockout, but
**not** broken by hits and **no** damage immunity. Extensible from game data (like
`STASIS_BUFFS`) if other named turn-skip controls appear (e.g. Stun/Freeze).

### `src/utils/combat/engine.ts` — surgical

1. Import `isDisable` (and `DISABLE_BUFFS` for the skip-body if needed).
2. Next to `isStasised` (~1710) add:
   - `const isDisabled = (id) => ownerDebuffNames(id).some(isDisable);`
   - `const isTurnBlocked = (id) => isStasised(id) || isDisabled(id);`
3. Swap `isStasised` → `isTurnBlocked` at the **three turn-action gates**: focus
   (~3690), walked-team (~3878), enemy (~4090) — each `if (!isStasised(actor.id))`.
4. Swap `isStasised` → `isTurnBlocked` at the **reactive-suppression** site (~3323,
   `if (isStasised(intent.ownerId)) continue;`).

(Line numbers are as of branch base `998416c3`; the implementer should grep for the
exact `isStasised(` call sites rather than trusting offsets, and confirm each is one of
the four routed sites above before switching it.)

**Left Stasis-only, untouched** (Disable must not break, and is never break-marked):

- The `tgtWasStasised` / `teamTgtWasStasised` / `enemyTgtWasStasised` break sites
  (~3716 / ~3896 / ~4135) and the `onHitBreakStasis` hook (param defined
  `playerTurn.ts:288`, injected at `engine.ts` ~3724 / ~3900 / ~4183).
- The `stasisBreakPending` consumption in the three skip-body else-branches (~3852 /
  ~4001 / ~4468) — a disabled actor is never added to `stasisBreakPending`, so these
  are no-ops for it.
- The `victimStasised` damage-event metadata fields (~2598 / ~2949 / ~4166 / ~4175) —
  event reporting, not a turn gate.
- `__testTapIsStasised`.

Decrement story: a disabled unit is still scheduled by `selectNextBySpeed`; the gate
wraps only the action body, so the Post-Turn decrements still run and the `Disable`
timed debuff (carried in the per-actor enemy-debuff store, like Stasis) ticks down →
duration N skips exactly N scheduled turns. Damage lands normally because nothing in
the incoming pipeline keys on `isStasised`/`isDisabled`.

### What lights up (buff-name-driven, no new parsing)

- **Martyrdom** — on-death `Disable` on the enemy killer; the enemy turn gate (~3837)
  now skips it. The end-to-end "lights up Martyrdom" proof.
- **APEX / IonScorp / Makoli / Xcellence / Yuyan** — their `Disable` lands as a named
  timed enemy debuff; that enemy now skips its turns.

## Out of scope (explicit)

- **Tygr's** "deal 30% more damage to enemies with Stasis or Disable" — an
  outgoing-damage *condition* subject, not turn-skip; belongs to the conditional-damage
  bucket.
- **No UI changes.** The round/simulator display inherits whatever skipped-turn
  surfacing Stasis already has; no new indicator.
- `parseControlInflict` stays Stasis-only; no new `ControlEffect` member. Disable rides
  the existing named-debuff path.
- `NOT_SIMULATED_TYPES` stays `{'control'}` — unchanged. The `control` ability *type*
  only drives cast-path `control-applied` reactions; Disable's effect is delivered via
  the debuff path, exactly like Stasis's own turn-skip.

## Testing

Mirror the existing Stasis suite (`stasisBuffs.test.ts`, `isStasised.test.ts`,
`stasis.test.ts`).

- **`disableBuffs.test.ts`** — set membership + `isDisable` predicate.
- **`isTurnBlocked` reader** — coverage that a unit carrying `Disable` reads blocked,
  and the composite is true for either Stasis or Disable.
- **Engine `disable.test.ts`** (mirror `stasis.test.ts`):
  - A disabled actor skips its scheduled turn (no attack/skill); duration N → N skips,
    then it acts on the next turn.
  - Reactive abilities are suppressed while disabled (mirror §4.4).
  - **Contrast vs Stasis:** a direct hit does **not** break Disable — the unit stays
    disabled and keeps skipping for the remaining duration.
  - **No immunity:** the hit's damage lands normally on a disabled unit.
- **Martyrdom end-to-end** — extend D-PR7's `equipmentAbilities.integration.test.ts`
  Martyrdom block (already asserts the `debuff-applied` event): a focus ship dies to a
  killer, `Disable` lands on the killer, and the killer **skips** its next turn(s).
- **Skill-text path** — one synthetic ship inflicting `Disable` on an enemy → enemy
  skips (proves the buff-name-driven wiring covers the parser path, not just implants).

## Byte-identical gate

No existing golden or battle-sim fixture carries a `Disable` buff on a turn-taking
unit (synthetic ships only; corpus Disablers are not in the goldens). Audit before
claiming: `grep -rn Disable` over `src/utils/calculators/__tests__/` and
`src/utils/combat/__tests__/`. Expect **zero** golden/snapshot movement. If a golden
moves, a real-ship Disable leaked into a fixture — investigate the leak; never
`vitest -u` the goldens.

## Risks

- A stasised/disabled **focus** actor in DPS mode would change DPS output — but no DPS
  golden carries Disable, so this stays inert there.
- The reactive-suppression generalization (~3092) drops a disabled unit's queued
  reactives; verified consistent with "locked out". Confirm no test relies on a
  disabled unit reacting (none expected — Disable was inert before this PR).
