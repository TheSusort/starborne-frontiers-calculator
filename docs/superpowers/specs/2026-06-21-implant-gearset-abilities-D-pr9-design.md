# D-PR9 — Ally-wide / New-trigger Reactive Buff Grants (Spearhead + Font of Power)

**Date:** 2026-06-21
**Sub-project:** D (implant + gear-set abilities), reactive self/ally-buff bucket
**Stacks on:** D-PR8 tip `9c8f5f7e` (branch `feat/combat-d-pr9-ally-reactive-buffs`, worktree `.worktrees/d-pr9-ally-reactive-buffs`)

## Context

D-PR8 shipped the first slice of the reactive self/ally-buff bucket (Ambush / Synaptic Resonance / Alacrity) and made the reactive **buff** executor honor `passesProcChanceGate`. D-PR9 is the next slice: **ally-wide and new-trigger reactive buff grants**, covering two implants from the roadmap:

- **Spearhead** — "After using the charged skill, there is a X% chance to grant all allies Attack Up 1 for 1 turn."
- **Font of Power** — "When applying repair to another ally, there's a X% chance to grant Power Infused Nanobots for 1 turn."

Each needs **one new reactive trigger**. Both ride the existing D-PR8 reactive-buff executor + proc-chance gate; no engine accounting changes.

Per the established D-stack invariant: **no existing combat fixture carries effect-bearing implants/gear, so all DPS/healing goldens stay byte-identical.** New behavior is exercised by new integration tests only.

## Decisions (locked with user)

1. **Split scope.** Spearhead ships fully live. Font of Power ships with its trigger live but the granted buff **emit-only** (applied + logged, no stat effect). The dynamic caster-attack-snapshot flat-attack buff subsystem that lights up Power Infused Nanobots is deferred to **D-PR10**.
2. **Font of Power recipient (AoE heal):** one proc roll per qualifying heal cast; on success, **every ally repaired this cast except the caster** gets Power Infused Nanobots. Routing carries `eventCtx.repairedAllyIds: string[]` and fans out in the buff branch with a single gate roll.

## Effect 1 — Spearhead (fully LIVE)

**Implant data** (`src/constants/implants.ts` `SPEARHEAD`): major implant; per-rarity proc chance
`common 15% / uncommon 18% / rare 21% / epic 26% / legendary 32%`. Grants **all allies** `Attack Up 1` for 1 turn after using the charged skill.

### New trigger `on-charged-cast`
- Self-scoped, mirrors `on-crit`. Add to `AbilityTrigger` union and `LIVE_TRIGGERS` (`src/types/abilities.ts`).
- Listener in `registerReactiveListeners` (`src/utils/combat/triggers.ts`) on the **existing** `skill-fired` event (`events.ts:39` — `{type, actorId, round, slot:'active'|'charged', skillName?}`):
  ```
  case 'on-charged-cast':
      bus.on('skill-fired', (e) => {
          if (e.actorId === ownerId && e.slot === 'charged') enqueue(intent);
      });
      break;
  ```
- **Team-agnostic by construction:** enemy actors run the same `runPlayerTurn` path → `skill-fired` fires for them too (`playerTurn.ts:700`); `registerReactiveListeners` is already invoked for both sides (D-PR8 / enemy-team support). The `actorId === ownerId` guard self-scopes per owner.

### Registry entry
`buildEquipmentAbilities.ts`, `IMPLANT_ABILITIES.SPEARHEAD` via existing `mkNamedBuffGrant`:
```
mkNamedBuffGrant('Attack Up I', 'all-allies', 'on-charged-cast', 1, { procChance })
```
- `'Attack Up 1'` (implant text) maps to the corpus buff **`Attack Up I`** (`buffs.ts:406`, `+15% Attack`), which folds into effective attack → **real effect**.
- `target:'all-allies'` routes to `ctx.playerIds` (same-side ally id order) in the buff branch — already side-correct via the `drainQueue` `sideCtx`.
- procChance threaded per rarity.

## Effect 2 — Font of Power (trigger live, effect emit-only)

**Implant data** (`src/constants/implants.ts` `FONT_OF_POWER`): major implant; per-rarity proc chance
`rare 9% / epic 12% / legendary 16%`. Grants **Power Infused Nanobots** for 1 turn when the carrier repairs another ally.

### New trigger `on-own-repair-to-ally`
- Add to `AbilityTrigger` union and `LIVE_TRIGGERS`.
- Listener on the existing `heal-performed` event (`events.ts:97` — `{type, casterId, targets:string[], round, amount, critHits?}`):
  ```
  case 'on-own-repair-to-ally':
      bus.on('heal-performed', (e) => {
          if (e.casterId !== ownerId) return;        // owner's own repair
          const repaired = e.targets.filter((t) => t !== ownerId);
          if (repaired.length === 0) return;          // must repair ANOTHER ally
          enqueue({ ...intent, eventCtx: { repairedAllyIds: repaired } });
      });
      break;
  ```
- Excludes pure self-heals. One enqueue per qualifying cast → one proc-gate roll.

### Power Infused Nanobots buff — corpus entry (clobber-safe)
`Power Infused Nanobots` is **not** in the corpus (implant-only; never produced by ship-buff fetch). `mkNamedBuffGrant` does `BUFFS.find(b => b.name === buffName)` and returns `undefined` (silent no-op) when the buff is absent, so the entry must exist in `BUFFS`.

**The committed `src/constants/buffs.ts` is already hand-maintained and divergent from the `fetch-buffs` generator** (`updateBuffsData.ts`): the committed file's `Buff` interface carries `type: 'buff'|'debuff'|'effect'` and `imageKey?`, but the generator's `buffsMap` value type and the file-content template it writes are `{ name, description }`-only (`updateBuffsData.ts:20,60-66`). A regen today would already strip `type`/`imageKey` from all entries — so `MANUAL_DESCRIPTION_OVERRIDES`-style "merge before write" does NOT by itself make a new buff regen-safe. Plan:

1. **Add the committed entry directly to `src/constants/buffs.ts`** (matches the committed interface):
   ```
   { name: 'Power Infused Nanobots', description: 'Grants attack equal to 100% of the caster\'s attack', type: 'buff' }
   ```
   This alone makes `mkNamedBuffGrant` resolve it and the UI render it by name. This is the load-bearing change.
2. **Make a regen clobber-safe** (the previously-unstated change required for the supplement to actually work): in `updateBuffsData.ts`, (a) widen the `buffsMap` value type and the generated `Buff` interface template to include `type` (and `imageKey?`) so a regen preserves the committed shape instead of stripping it, and (b) add a small `MANUAL_BUFFS` array (parallel to `MANUAL_DESCRIPTION_OVERRIDES`) merged into `buffsMap` before write, containing the `Power Infused Nanobots` entry, so a regen re-adds it. Keep `MANUAL_BUFFS` minimal with a comment that implant-only buffs live here because they're never fetched from ship data.

The description is caster-derived prose `parseBuffEffects` cannot parse — verified empirically: the attack regex (`buffParser.ts:11`) requires a leading `[+-]` sign before the digits; `100%` has none, and no other channel matches → **empty parsed effects → emit-only** (buff applied + logged, zero stat effect this PR). `isStackable` also returns `{stackable:false}`. Mirrors D-PR7 Battlecry / Martyrdom emit-only precedent.

> Source-data note: the rare variant's text says "grand" (typo) not "grant" (`implants.ts:1775`) — irrelevant, since the registry uses `mkNamedBuffGrant` (description text is not parsed for these). Do not text-parse it.

### Registry entry
`IMPLANT_ABILITIES.FONT_OF_POWER` via `mkNamedBuffGrant`:
```
mkNamedBuffGrant('Power Infused Nanobots', 'ally', 'on-own-repair-to-ally', 1, { procChance })
```
- `target:'ally'` + `eventCtx.repairedAllyIds` → lands on the repaired allies (not self), per the recipient decision.
- procChance per rarity (rare/epic/legendary; no common/uncommon variants exist).

### Buff-branch routing extension (`triggers.ts`)
The buff executor (`triggers.ts:~1016-1063`) rolls `passesProcChanceGate` **once** (line ~1025) BEFORE resolving `recipients: string[]` (lines ~1036-1041) and looping per-recipient (line ~1054) — so "one roll → fan-out" is exactly the existing shape; no reordering needed. The buff branch inlines its own recipient resolution and does NOT call `reactiveRecipients` (the heal/shield/cleanse/purge helper at ~901), so this edit is scoped to the buff branch only.

Today the resolution is:
```
const recipients: string[] =
    intent.ability.target === 'ally' && intent.eventCtx?.damagedAllyId
        ? [intent.eventCtx.damagedAllyId]
        : intent.ability.target === 'ally' || intent.ability.target === 'all-allies'
          ? ctx.playerIds
          : [intent.ownerId];
```
Extend it with the `repairedAllyIds` case placed **before** the `ctx.playerIds` fall-through (so a `target:'ally'` + `repairedAllyIds` intent never lands on the whole team):
```
const recipients: string[] =
    intent.ability.target === 'ally' && intent.eventCtx?.repairedAllyIds?.length
        ? intent.eventCtx.repairedAllyIds
        : intent.ability.target === 'ally' && intent.eventCtx?.damagedAllyId
          ? [intent.eventCtx.damagedAllyId]
          : intent.ability.target === 'ally' || intent.ability.target === 'all-allies'
            ? ctx.playerIds
            : [intent.ownerId];
```
The listener already guards `repaired.length === 0 → return`, so a present `repairedAllyIds` is always non-empty; the `?.length` check is belt-and-suspenders. `damagedAllyId` and `repairedAllyIds` never co-occur on the same intent (different triggers), so there is no collision. Add `repairedAllyIds?: string[]` to the `eventCtx` interface next to `damagedAllyId` (`triggers.ts:~97-105`).

## D-PR10 handoff (deferred heavy piece)

The dynamic **flat-attack buff subsystem** that makes Power Infused Nanobots functional:
1. `ParsedBuffEffects.attackFlat?: number` (`src/types/calculator.ts`) + a flat-attack parser branch (`buffParser.ts`) — hacking/security already use flat fields.
2. Additive fold of flat attack in `calculateBuffTotals` (`buffTotals.ts`) and `effectiveStatsOf` (`effectiveStats.ts:~95`), parallel to hacking/security (`+ flatBuff`).
3. **Per-instance snapshotted magnitude** on the applied buff instance (no buff stores a value today): capture `effectiveStatsOf(caster).attack` at apply time in the buff branch / `payloadFromConfig` and stamp it onto the buff instance so the fold reads it.

Because D-PR9 already lands Power Infused Nanobots on the correct allies, D-PR10 is purely additive (the fold + snapshot).

## Testing

- **Byte-identical goldens** — confirm no DPS/healing snapshot moves (no fixture carries Spearhead/Font of Power). If a golden moves, a gate leaked — fix the gate, never `vitest -u`.
- **Integration (engine-level, `equipmentAbilities.integration.test.ts` or sibling):**
  - Spearhead: a carrier with charges performs its charged skill → all allies carry `Attack Up I` → ally outgoing damage rises vs a no-Spearhead baseline. Active-skill cast → no grant. proc=0 → no grant; proc=1 → always.
  - Font of Power: carrier repairs ≥1 other ally → each repaired non-self ally carries `Power Infused Nanobots` (presence only — emit-only, assert buff present, no stat change). Self-only heal → no proc. AoE heal of N allies → all N (minus caster) carry the buff from one proc.
  - Team-agnostic mirror: enemy-side carrier of each implant produces the same behavior on the enemy team.
- **Unit:** `on-charged-cast` / `on-own-repair-to-ally` listener filters (slot gating; caster/other-ally gating).
- **Coverage tracker** `src/utils/abilities/__tests__/equipmentCoverage.test.ts`: add `SPEARHEAD`, `FONT_OF_POWER` in THREE places — (a) the order-sensitive `implementedImplants` `.toEqual([...])` array (append in correct IMPLANTS decl order), (b) the second `implementedImplants` `Set`, and (c) the per-implant "produces 0 abilities" loop currently asserts SPEARHEAD/FONT_OF_POWER produce 0 — they now produce 1, so move them out of the zero-assertion set into positive coverage.

## Risks / notes

- **emit-only Power Infused Nanobots** is intentional and consistent with prior D PRs; it must apply + log on the right allies so D-PR10 is additive.
- `MANUAL_BUFFS` is a genuinely new supplement to `updateBuffsData.ts`; keep it minimal and documented (comment that implant-only buffs live here because they're never fetched from ship data).
- Spearhead is the live one — its `Attack Up I` grant changes ally attack, so the integration test must prove the damage delta, and the byte-identical-goldens check must hold (it will: no fixture has the implant).
- Confirm `skill-fired` and `heal-performed` have no conflicting existing listeners that would double-fire (verified: `skill-fired` currently has no reactive listener; `heal-performed` is consumed by `on-enemy-repaired` / `on-ally-critically-repaired`, which key on different caster/recipient conditions).
- **Name visibility:** the emit-only `Power Infused Nanobots` has zero effect on goldens this PR because no fixture carries the implant. But the buff NAME becomes visible to name-based gates (`selfBuffNamesForOwners` / `enemy-buff` / `self-buff` condition gates) the moment any fixture carries Font of Power. No such gate references the name today (safe now); D-PR10 (which folds the real effect) must keep this in mind.
