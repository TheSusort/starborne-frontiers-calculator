# D-PR — Reactive Cleanse (Reactive Ward + Warpstrike duration-reduction)

**Date:** 2026-06-23
**Sub-project:** D (implants + gear-set abilities), combat-realism epic
**Status:** Design — approved, pre-spec-review

## Summary

Adds the two cleanse-family reactive effects from the implant corpus:

1. **Reactive Ward** — "When directly damaged, there is an X% chance to cleanse 1 debuff, but if the hit was a critical, 2 debuffs are cleansed instead." A victim-side reaction: on being directly hit, a proc-gated full-cleanse of self debuffs, with the count doubling on a critical hit.
2. **Warpstrike (duration-reduction half)** — the deferred half of the Warpstrike implant. Full text: "Increases damage by 1% when directly damaging an enemy while debuffed, **and reduces a random active debuff's duration by 1 turn**." The damage half shipped in D-PR2 (a passive `outgoingDamage` modifier gated on self-debuff). This spec adds only the duration-reduction half: an attacker-side reaction that, when the carrier deals direct damage while itself debuffed, shaves one turn off one of its own debuffs.

Both are modeled as cleanse-family reactive abilities flowing through the **single existing reactive `cleanse` executor branch** (`triggers.ts` ~1407), distinguished by a new `mode` field. This keeps both effects inside the registry/trigger system the rest of sub-project D uses — no turn-loop special-casing.

## Unifying design

The reactive `cleanse` executor branch is the common seam. Reactive Ward uses `mode: 'remove'` (whole-debuff removal, the existing behavior). Warpstrike uses `mode: 'reduce-duration'` (partial duration reduction, new). Both resolve recipients via the existing `reactiveRecipients` helper and (for these two) target `self`.

## Decisions (locked with the user)

- **Scope:** both effects ship in one PR.
- **"Random" debuff pick (Warpstrike):** deterministic **newest-applied first** — consistent with the existing cleanse/purge `removeNewestFirst` convention. Documented as a deterministic approximation of the game's "random".
- **Warpstrike trigger seam:** a **new reactive trigger** (`on-deal-damage`), riding `ability-performed`, gated on the self-debuff condition reused from Warpstrike's D-PR2 damage half. Chosen over a turn-loop fold to stay consistent with the campaign's reactive/registry architecture.
- **Warpstrike cadence:** once per turn (one debuff reduced per damage-dealing turn), not per AoE victim.

## Components

### 1. Status-engine primitive — `reduceNewestDebuffDuration`

New method on the status engine (interface + implementation in `src/utils/combat/statusEngine.ts`, beside `cleanse` / `removeNewestFirst`):

```
reduceNewestDebuffDuration(actorId: string, turns: number): number
```

- Gathers **timed** debuff candidates from `enemyMaps.get(actorId)` only. Accumulating (`accumEnemyMaps`) and persistent-stacking maps have no finite duration → not visited.
- Skips entries whose `turnsRemaining` is non-numeric (`'recurring'` / `'permanent'`) and entries whose `buffName ∈ UNREMOVABLE_STATUSES` (consistent with cleanse — duration-reduction must not affect debuffs cleanse can't touch).
- Picks the candidate with the highest `appliedSeq` (newest-applied first).
- Reduces that entry's `turnsRemaining` by `turns`. If the result is ≤ 0, deletes the entry (it has expired).
- Returns `1` if it acted on a debuff, else `0`. Unknown actor id / no eligible candidate → `0` (lazy-empty, safe no-op).

Mirrors `removeNewestFirst`'s candidate-gathering and skip rules; differs only in the terminal action (decrement-or-delete vs delete).

### 2. Cleanse AbilityConfig + reactive executor extensions

`cleanse` AbilityConfig (`src/types/abilities.ts`) gains:

- `critCount?: number` — count to cleanse when the triggering hit was a crit (Reactive Ward).
- `mode?: 'remove' | 'reduce-duration'` — defaults to `'remove'`.
- `durationTurns?: number` — turns to reduce in `'reduce-duration'` mode (default 1).

Reactive `cleanse` executor branch (`triggers.ts` ~1407):

- Adds `if (!passesProcChanceGate(intent, ctx)) return;` at the top. Pass-through when `procChance` is undefined/≤0/≥1 → **existing reactive cleanses byte-identical** (verify no shipped reactive cleanse sets `procChance`; if any do, the gate is still a pass-through for the undefined case).
- `mode === 'remove'` (default): `count = intent.eventCtx?.didCrit && cfg.critCount != null ? cfg.critCount : cfg.count`; for each recipient `removed += statusEngine.cleanse(rid, count)`; credit `cleanseCount` (unchanged behavior when `critCount`/`didCrit` absent).
- `mode === 'reduce-duration'`: for each recipient `affected += statusEngine.reduceNewestDebuffDuration(rid, cfg.durationTurns ?? 1)`. This path needs only `statusEngine` (always present in the drain), so it must **not** sit behind the branch's `if (!ctx.healing) return` heal-credit guard — restructure so the early-return guards only the credit emission, with credit emitted only when `ctx.healing` is present.

### 3. `didCrit` threading (Reactive Ward crit-count)

`Intent.eventCtx` gains `didCrit?: boolean`. The `on-attacked` listener (`triggers.ts` ~393) already enqueues `eventCtx: { counterTargetId: e.attackerId }` — add `didCrit: e.didCrit`. The executor reads `intent.eventCtx?.didCrit` to choose `critCount` over `count`.

### 4. New trigger — `on-deal-damage` (Warpstrike)

- Added to the `AbilityTrigger` union and the runtime trigger array (`src/types/abilities.ts`).
- Listener (`triggers.ts`): rides `ability-performed` —
  ```
  bus.on('ability-performed', (e) => {
      if (e.actorId !== ownerId) return;
      if (!(e.damage > 0)) return;   // "directly damaging an enemy"
      enqueue(intent);
  });
  ```
- Self-scoped, direct-damage-gated. The **while-debuffed** requirement is an ability *condition* (the self-debuff condition reused from Warpstrike's D-PR2 damage half), evaluated at drain via `gateConditions` — the listener stays enqueue-only.
- **Verification item (resolve as an explicit early step in the plan):** confirm `ability-performed` fires once per cast (carrying aggregate `damage`/`critHits`), not once per AoE victim. `on-crit` reads `e.critHits` (aggregate per cast), which suggests once-per-cast. The answer determines whether the once-per-turn guard is built or skipped, which in turn shapes the Warpstrike integration test — so it must be settled before the executor/test tasks. If it can fire per-victim, add a once-per-turn guard so Warpstrike reduces exactly one debuff per damage-dealing turn.

### 5. Registry (`src/utils/abilities/buildEquipmentAbilities.ts`)

- **REACTIVE_WARD** (new entry): `trigger: 'on-attacked'`, `type: 'cleanse'`, `mode: 'remove'`, `target: 'self'`, `count: 1`, `critCount: 2`, `procChance` per rarity — **common 0.05 / uncommon 0.07 / epic 0.12 / legendary 0.16**. (No rare variant exists in `implants.ts`.) Note: `on-attacked` is per-hit, so the proc **rolls per incoming hit** (each hit independently rolls the cleanse), consistent with the existing per-event proc-gate model. The crit-count applies to whichever hit procs.
- **WARPSTRIKE**: builder now returns **two** abilities —
  1. the existing damage-half `outgoingDamage` modifier (untouched, byte-identical), and
  2. the new duration-reduction reactive: `trigger: 'on-deal-damage'`, `type: 'cleanse'`, `mode: 'reduce-duration'`, `durationTurns: 1`, `target: 'self'`, self-debuff condition, **no `procChance`** (deterministic), all rarities.

  Requires extending the registry builder return type to allow `Omit<Ability,'id'> | Omit<Ability,'id'>[]` so one implant can contribute multiple abilities. Stable ids stay unique per ability (the `equip-implant-${name}-${gearId}` scheme; the two Warpstrike abilities need distinguishable ids — append an ability-role suffix or index).

### 6. Editor stubs + coverage tracker

- `on-deal-damage` → `TRIGGER_OPTIONS` stub in `AbilityCard.tsx` (switch exhaustiveness); the new cleanse `mode` field handled where the config editor switches on cleanse fields.
- `equipmentCoverage.test.ts`: add `REACTIVE_WARD` to the implemented-implants set (three spots — `.toEqual` decl-order array, the `Set`, and the `it('exactly {…}')` string). WARPSTRIKE is already in the set (D-PR2); update its per-implant ability-count assertion from 1 to 2.

### 7. DPS calculator page

Not wired. Both effects are defensive/status-only and do not affect single-ship DPS — consistent with the other defensive implants (Reactive Ward = cleanse; Warpstrike's duration-reduction shortens self-debuffs, irrelevant to the single-ship DPS model). Warpstrike's *damage* half remains wired from D-PR2.

## Testing

- **Unit — `reduceNewestDebuffDuration`:** newest-first selection; expiry/delete when reduced to ≤0; skips `'recurring'`/`'permanent'`/accumulating/unremovable; unknown id → 0; multi-turn reduction.
- **Unit — reactive cleanse executor:** proc-chance gate (proc vs no-proc); crit-count (`didCrit` → `critCount`, else `count`); `reduce-duration` mode routes to the primitive.
- **Integration (engine), routed through the real registry** (`buildShipAbilitiesWithEquipment` + `setBonus`, `procChance: 1` for determinism — the mutation-probe lesson from D-PR16 Last Stand; assert the registry shape so a hand-rolled ability can't pass):
  - Reactive Ward: on-attacked **crit** → 2 debuffs cleansed; **non-crit** → 1.
  - Warpstrike: carrier deals direct damage while self-debuffed → the newest self-debuff loses one extra turn (and the D-PR2 damage-half modifier still applies on the same turn).

## Gates

- Full test suite green (excluding the pre-existing env-failing files — missing Supabase URL + gitignored `docs/*.csv`).
- `tsc` + lint clean.
- `npm run audit:skills` unchanged (141/0).
- **Zero golden / `.snap` drift** — no combat fixture equips Reactive Ward or Warpstrike, so neither effect fires in any golden run.

## Out of scope / follow-ups

- Truly randomized debuff selection (engine is deterministic by design).
- Warpstrike duration-reduction in the DPS calculator (no single-ship debuff model).
- Any other cleanse-family corpus effects beyond these two.
