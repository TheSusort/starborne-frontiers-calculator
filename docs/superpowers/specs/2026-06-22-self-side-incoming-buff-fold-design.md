# Self-/friendly-side incoming-damage buff fold (D-PR12)

**Date:** 2026-06-22
**Sub-project:** D (new ability sources / cross-cutting folds) — combat-realism epic
**Status:** spec — direct-damage half only; incoming-DoT deferred

## Problem

Friendly-side incoming-damage buffs (the `Inc. Damage Down` / `Inc. Damage Up` I/II/III
family — `±15/30/45% Incoming Direct Damage`) are parsed and **applied as statuses**, but
their stat effect is never folded into the damage a victim takes. They are emit-only.

- `buffParser.ts:49` already extracts `parsedEffects.incomingDamage` for these buffs.
- But `toSimBuffs` (`dpsBuffHelpers.ts`) has **no** `incomingDamage` branch, and
  `incomingDamage` is **not** in the `Buff.stat` union (`calculator.ts:62-74`) or
  `calculateBuffTotals` (`buffTotals.ts`). The channel is consumed only by
  `toEnemyModifiers` (`dpsBuffHelpers.ts:71`), which is called **only for enemy-side
  debuffs**. So a victim's own friendly incoming buff is dropped.

This is the documented reason D-PR7's **Battlecry** implant (`Inc. Damage Down II` to all
allies on death) is emit-only, and why these ship sources have no effect today:

| Source | Slot | Grant |
| --- | --- | --- |
| Makoli | active | self `Inc. Damage Down II`, 2 turns |
| Salvation | active | self `Inc. Damage Down II`, 2 turns |
| Shelter | passive (HP < 20%, once/battle) | self `Inc. Damage Down II`, 3 turns |
| Refine | passive (ally directly damaged) | ally `Inc. Damage Down I`, 1–2 turns |
| Battlecry (implant, D-PR7) | on-death | all-allies `Inc. Damage Down II`, 1–3 turns |

**Enemy-side incoming buffs already fold correctly**, per-victim, via
`victimEnemyModifiers(victimId)` → `incomingDamageModifierPct` →
`(1 + incoming/100)` in `victimHitDamage`'s `nonCritFactor` (`victimDamage.ts:101`). This
PR adds the missing **friendly-side** term to that **same per-victim seam**.

## Goal

When an actor is the victim of a hit, fold its **own** friendly-side `incomingDamage`
buffs into the per-victim incoming-damage modifier, summed with any enemy-side incoming
debuffs already on it. Lights up all five sources above. Direct-damage channel only.

## Non-goals / deferred

- **Incoming-DoT (`incomingDotDamage`) is deferred entirely.** No corpus source grants a
  friendly incoming-DoT buff, so it would be dormant machinery. More importantly, the
  enemy-side incoming-DoT is **applier-sourced** (frozen into `ctx.dotMult` at apply,
  read at tick via `ctxFor(e.sourceId)` in `tickDoTs`, `engine.ts:735/748`), whereas a
  friendly victim's incoming-DoT-down is naturally **victim-sourced at tick time**.
  Introducing a friendly tick-time term now would create a dual mechanism for one concept.
  Defer until a real friendly incoming-DoT source exists **and** we can unify both channels
  onto a single victim-sourced DoT-incoming model in one PR.
- The **aggregate scalar path** (`playerTurn.ts:1298`, the attacker-fixed `directDamage`
  number) is **not** modified. It is the DPS-calc single-dummy case; the dummy carries no
  friendly self-buffs, and in real two-team combat `battleSimulator` threads positions on
  both sides so every actor's intake runs the per-victim path. Consistent with the existing
  enemy-side per-victim/scalar split (per-victim already supersedes the scalar for
  defense/incoming sourcing).
- No buff-lifecycle changes. Grant, duration decrement, family-overwrite, cleanse/expiry
  are all unchanged — these statuses already apply; we only start reading their effect.

## Team-agnosticism (unification check)

This stays consistent with the bySide-unification campaign. The seam being extended,
`victimEnemyModifiers(v.id)` (`engine.ts:2657`), is the single team-agnostic per-victim
read the unification landed — the engine comment at `engine.ts:2679` states it
*"works for ENEMY victims (focus/team site) and PLAYER victims (enemy site) alike — both
store their debuffs keyed by their own id."* The friendly reader uses
`timedAbilityStatuses('self', victimId)` / `activeAbilityStatuses('self', …, victimId)`,
which are already called team-agnostically today (e.g. for enemy attackers' own buffs via
`selfBuffNamesForOwners`, `triggers.ts:688/734`). So a self-buffing ship (e.g. Makoli)
receives the reduction on **whichever team it fights for** — no player/enemy branch.

The two readers (`victimEnemyBuffs` for the `'enemy'` store, the new `victimSelfBuffs` for
the `'self'` store) exist only because the two status families are physically filed under
different side keys on the victim; their results are **summed into one**
`incomingDamageModifier`, so the fold is unified at the point of use.

## Design

### 1. New reader: `victimSelfBuffs` (triggers.ts)

A friendly twin of `victimEnemyBuffs` (`triggers.ts:805-821`). Reads the victim's **own**
friendly-side statuses across the same three channels, returning `SelectedGameBuff[]`:

```ts
export function victimSelfBuffs(
    statusEngine: StatusEngine,
    victimId: string,
    selfBuffLookup: Map<string, SelectedGameBuff[]>
): SelectedGameBuff[] {
    const scheduled = expandSelfBuffs(
        statusEngine.snapshot(undefined, victimId).activeSelfBuffs,
        selfBuffLookup
    );
    const timed = statusEngine
        .timedAbilityStatuses('self', victimId)
        .map((s) => payloadToSelectedBuff(s.payload));
    const active = statusEngine
        .activeAbilityStatuses('self', () => NEUTRAL_NAMES_CTX, victimId)
        .map((s) => payloadToSelectedBuff(s.payload));
    return [...scheduled, ...timed, ...active];
}
```

- The **timed + active** ability-status channels are load-bearing for the five live
  sources (all are dynamically granted statuses carrying `parsedEffects`).
- The **scheduled** channel mirrors `victimEnemyBuffs`'s scheduled read for parity (covers
  manually-configured DPS-calc self-buffs). `expandSelfBuffs` is the self-side analog of
  `expandEnemyDebuffs` (`buffTotals.ts:74`) — both can share the generic `expandBuffEntry`.
  Use the existing `selfBuffLookup` map (`engine.ts:1385`).
- Same approximation note as `victimEnemyBuffs` applies to the aura/accumulating `active`
  channel (NEUTRAL ctx, no per-round re-roll). The five live sources are **timed** (durations
  in turns), which is **not** approximated.

### 2. New modifier extractor (dpsBuffHelpers.ts)

Mirror of `toEnemyModifiers`, but only the incoming-damage scalar (defense is enemy-only):

```ts
export function toSelfIncomingDamageModifier(selected: SelectedGameBuff[]): number {
    return selected.reduce((sum, s) => sum + (s.parsedEffects.incomingDamage ?? 0) * s.stacks, 0);
}
```

Sign convention matches enemy-side: negative = less damage taken (`-30` → `×0.70`),
positive = more. Summing into the same `incomingDamageModifier` "just works".

### 3. Fold site (engine.ts)

Extend the per-victim closure (`engine.ts:2657-2660`); rename `victimEnemyModifiers` →
`victimIncomingModifiers` to reflect that it now aggregates both sources:

```ts
const victimIncomingModifiers = (victimId: string) => {
    const enemy = toEnemyModifiers(victimEnemyBuffs(statusEngine, victimId, enemyDebuffLookup));
    const selfIncoming = toSelfIncomingDamageModifier(
        victimSelfBuffs(statusEngine, victimId, selfBuffLookup)
    );
    return {
        enemyDefenseModifier: enemy.enemyDefenseModifier,
        incomingDamageModifier: enemy.incomingDamageModifier + selfIncoming,
    };
};
```

`selfBuffLookup` is already in scope at this site (`engine.ts:1385`). The
`__testTapVictimEnemyModifiers` test seam (engine.ts:2663) is renamed to match (or kept as
an alias). Everything downstream (`defenseProfileOf` → `incomingDamageModifierPct` →
`victimHitDamage`) is unchanged.

### 4. Composition with D-PR3 `incoming-reduction`

D-PR3's conditional incoming reduction is **ability-config-sourced** (the
`incoming-reduction` AbilityConfig, applied via `incomingEffects.ts` as a separate factor in
`positionalApply.ts`). This PR's fold is **buff-status-sourced** (reads
`parsedEffects.incomingDamage` from status payloads). The two read **disjoint** sources, so:

- No double-count: `victimSelfBuffs` never sees D-PR3 ability configs (they are not buff
  statuses carrying `incomingDamage`).
- They stack as separate factors (D-PR3 reduction × this `(1 + incoming/100)`), which is
  the correct in-game behavior for distinct sources. A composition test pins this.

## Affected files

| File | Change |
| --- | --- |
| `src/utils/combat/triggers.ts` | + `victimSelfBuffs` (+ `expandSelfBuffs` helper if not generalizing `expandEnemyDebuffs`) |
| `src/utils/calculators/dpsBuffHelpers.ts` | + `toSelfIncomingDamageModifier` |
| `src/utils/combat/engine.ts` | extend `victimEnemyModifiers` → `victimIncomingModifiers`, thread `selfBuffLookup`; rename test tap |
| `src/utils/combat/buffTotals.ts` | (maybe) export `expandBuffEntry` / `expandSelfBuffs` for self-side reuse |
| tests | `victimSelfBuffs` unit; `runCombat` integration (victim with Inc. Damage Down → reduced incoming direct damage, magnitude proof); composition with D-PR3 |
| `src/constants/changelog.ts` | UNRELEASED_CHANGES entry |

## Golden churn

Expected and accepted (audited). Movement is bounded to fixtures where one of the five
sources is a **victim while carrying** an `Inc. Damage Down` buff — i.e. two-team /
positional / healing fixtures, not attacker-focused DPS goldens (where these ships, if
present, are dealing damage and their self-buff has no intake to reduce). Enumerate by
running the suite; audit each delta as a faithful incoming-damage reduction. Both `Down`
(reduction) and `Up` (amplification) signs fold.

## Testing

1. **Unit — `victimSelfBuffs`**: mirror `victimEnemyBuffs.test.ts`. Assert it reads timed +
   active + scheduled `'self'` statuses for a victim id and that
   `toSelfIncomingDamageModifier` sums `incomingDamage × stacks` with correct sign.
2. **Integration — direct fold**: `runCombat` two-team setup where a victim carries
   `Inc. Damage Down II`; assert its incoming direct damage is reduced ~30% vs the same hit
   without the buff (magnitude proof). Mirror on the enemy side (a self-buffing enemy ship)
   to prove team-agnosticism.
3. **Composition**: a victim with both a D-PR3 `incoming-reduction` ability and a friendly
   `Inc. Damage Down` buff → assert both factors apply (product), not one or double.
4. **Coverage / regression**: full suite green; audit and document every golden delta.

## Acceptance

- Direct-damage friendly incoming fold live for all five sources, team-agnostic.
- D-PR3 composition correct (no double-count, factors stack).
- All golden deltas audited and explained; lint/tsc/`audit:skills` clean.
- Incoming-DoT explicitly deferred with rationale recorded.
