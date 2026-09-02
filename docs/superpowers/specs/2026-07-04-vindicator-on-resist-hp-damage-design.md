# Vindicator on-resist HP-scaled damage — design (2026-07-04)

> Local working artifact (`docs/` is gitignored, like the Phase 3 triage design doc). Committed artifacts are the src changes, tests, and audit/allowlist edits — not this file.

## Problem

Vindicator's third passive (verbatim, `docs/ship-skills.csv`):

> This Unit has 20% Shield Penetration. At the start of combat, this Unit gains `Magnetized Shielding`.
> **When this Unit resists a debuff infliction from an enemy, it deals damage equal to 30% of this Unit's max HP to that enemy.**

This is the sole remaining RED probe in the Phase 3 reactive-trigger triage corpus
(`src/utils/abilities/__tests__/reactiveTriggerPromotionTriage.test.ts`). It was bucketed
**no-capturable-actor** on the belief that `debuff-resisted` carries no source and the amount is a
max-HP-scaled damage the model doesn't support.

## Re-triage: it is needs-capture, not no-capturable-actor

The inflictor of the resisted debuff **is in scope at every `debuff-resisted` emit site** — the event
just doesn't carry it (unlike `debuff-applied`, which already carries `sourceId`):

| Emit site | Inflictor in scope |
|---|---|
| `playerTurn.ts:926` (timed resist) | `actor.id` (acting inflictor) |
| `playerTurn.ts:1940` (block-debuff DoT) | `actor.id` — a *fresh* cast-side application, not a standing re-tick |
| `triggers.ts:1783` (reactive resist) | `intent.ownerId` |
| `statusEngine.ts` timed-enemy path | `sourceId` |

So the actor is capturable; this is the same **needs-capture** pattern `debuff-applied`/`counterTargetId`
already use. The comment at `triggers.ts:1784` — *"no per-target counter routing needed"* — is exactly the
assumption Vindicator invalidates. The genuinely-new piece is HP-scaled standalone damage (the parser even
deliberately parks it at `skillTextParser.ts:316`).

## Locked decisions

1. **Damage model:** base = 30% of Vindicator's **effective max HP**, then the *normal* direct-damage
   pipeline — defence + affinity mitigation, crit-eligible (general rule: all direct damage is mitigated
   and can crit unless the text says "cannot critically hit"; Vindicator's does not, so `noCrit:false`).
   Reuses PR4b's `applyReactiveDamage` unchanged except for the base stat.
2. **Config shape:** extend the existing `damage` config with an optional `hpBasisPct` — *not* a new
   config type. When set, the executor computes the raw from max HP × `hpBasisPct` instead of
   attack × `multiplier`.
3. **Generality:** build the HP-basis capability generically (config + executor + parser), but wire only
   Vindicator's `on-debuff-resisted` path now. Paracelsus's on-death "50% of max HP" proc has the identical
   shape but rides an out-of-scope trigger — a trivial follow-up, not built here.
4. **Frequency:** one proc per triggering enemy action. Gate keyed on `(owner, ability, round, sourceId)`
   so multiple debuffs resisted from one cast collapse to a single proc, while two *different* enemies
   resisting Vindicator in the same round each proc.
5. **No source → no proc:** a resisted infliction with no capturable `sourceId` deals nothing. The damage
   intent must NOT fall back to `ctx.enemy.id` (you cannot retaliate against no-one). Buff-type
   `on-debuff-resisted` consumers (Lockdown) are unaffected — they never read the source.

## Design by layer

### 1. Event capture — `debuff-resisted` gains `sourceId?`

`src/utils/combat/events.ts`: add optional `sourceId?: string` to the `debuff-resisted` event variant
(optional so existing consumers and fixtures are untouched). Thread the inflictor at every emit site:

- `playerTurn.ts:926` `emitDebuffResisted` → pass `actor.id`.
- `playerTurn.ts:1940` block-debuff DoT → `actor.id` (via the helper, below).
- `triggers.ts:1783` reactive resist → `intent.ownerId`.
- `statusEngine.ts` timed-enemy resist collection → the path's `sourceId`.
- `debuffImmunity.ts:emitBlockDebuffResist` gains a `sourceId` param; both call sites
  (`playerTurn.ts:1940`, `triggers.ts:1800`) pass their inflictor.

### 2. Trigger routing — `on-debuff-resisted` listener

`src/utils/combat/triggers.ts:524`: when `e.sourceId` is defined, enqueue with
`eventCtx: { ...intent.eventCtx, counterTargetId: e.sourceId }` (mirrors the `on-attacked` /
`on-destroyed` counter-routing pattern). Self-scoping on `e.targetId === ownerId` is unchanged.

### 3. Executor — HP basis in `applyReactiveDamage`

`src/utils/combat/engine.ts:3715`: add an HP-basis path. When the ability carries `hpBasisPct`, substitute
the owner's **effective max HP** for `effectiveAttack` and use `hpBasisPct` as `multiplierPct`; the rest of
`victimHitDamage` (defence, affinity, crit gate, credit) is byte-identical. Effective max HP is already
available in engine scope (`ownerCtx?.effectiveMaxHp`, cf. `triggers.ts:1924`).

The `damage` reactive branch (`triggers.ts:2098`) passes `hpBasisPct` through to `applyReactiveDamage`, and
**requires** a routed `counterTargetId` when `hpBasisPct` is set: if `intent.eventCtx?.counterTargetId` is
undefined, return without dealing damage (decision 5). The existing attack-basis reactive damage keeps its
`counterTargetId ?? ctx.enemy.id` fallback.

### 4. Parser — recognize the on-resist clause

`src/utils/skillTextParser.ts`: a new recognizer `parseOnResistHpDamage(text)` matching
*"When this Unit resists a debuff infliction from an enemy, it deals `<unit-damage>damage equal to X%</unit-damage>`
of … max HP to that enemy"* → `{ pct }` (null otherwise). The existing `parseSecondaryDamage:316` guard
(which parks on-cast riders) stays; the reactive clause gets its own recognizer so on-cast parsing is
unchanged.

### 5. Builder — emit the reactive damage ability

`src/utils/abilities/buildShipAbilities.ts`: when `parseOnResistHpDamage` matches a passive slot, emit
`{ type:'damage', multiplier:0, hpBasisPct:<pct>, hits:1, noCrit:false }` with
`trigger:'on-debuff-resisted'`, `target:'enemy'`, and the once-per-`(owner,ability,round,sourceId)`
frequency gate. Routes through the standard passive-ability path (no hand-built ability — probe drives
production `buildShipAbilities`).

## Constraints & fallout

- **Team symmetry** (`feedback_engine_team_symmetry`): `debuff-resisted` already emits for both sides,
  self-scoped on `targetId === ownerId`; threading `sourceId` at every site means a Vindicator on the enemy
  side procs identically. No side-specific branch.
- **DPS-exempt:** the proc requires an enemy inflicting a debuff *on* Vindicator, which never happens in
  DPS mode (player attacks the dummy) → DPS goldens byte-identical.
- **Combat-sim goldens byte-identical:** the new ability fires only for Vindicator (no existing fixture
  ships it); the new event field is optional and ignored by existing consumers (Lockdown). Verify across the
  whole `npm test` golden audit — never `vitest -u`.
- **Audit / triage:** remove Vindicator's no-capturable-actor allowlist deferral row
  (`scripts/auditSkills.allowlist.ts`); flip its RED triage probe to GREEN; confirm `npm run audit:skills`
  reports the ability as handled with no stale allowlist entry.
- **Changelog:** user-facing combat behaviour change → add a plain-English entry to `UNRELEASED_CHANGES`
  in `src/constants/changelog.ts` before committing.

## Testing

- **Probe (production-routed, verbatim CSV):** flip the existing Vindicator triage probe to assert the
  passive's damage ability rides `on-debuff-resisted` with `hpBasisPct:30`, via `buildShipAbilities`.
- **Parser unit:** `parseOnResistHpDamage` returns `{ pct:30 }` for Vindicator's clause and `null` for the
  on-cast/heal/on-death near-misses (keep the existing `parseSecondaryDamage` Vindicator-null regression).
- **Engine integration:** enemy inflicts a debuff on Vindicator → Vindicator resists → Vindicator deals
  ~30%-max-HP mitigated damage to *that enemy* (assert defence/affinity applied; crit-eligible).
  - Multi-debuff-in-one-cast, both resisted → exactly one proc.
  - Two different enemies each resisted by Vindicator in one round → two procs.
  - Resist with no capturable source → no proc.
  - Enemy-side Vindicator resisting a player debuff → identical proc (team symmetry).
- **Goldens:** byte-identical across `npm test`.

## Out of scope

- Paracelsus's on-death "50% max HP" proc (out-of-scope trigger family; unlocked-but-not-wired).
- Any non-HP-scaled reactive damage change; any change to on-cast secondary-damage parsing.
