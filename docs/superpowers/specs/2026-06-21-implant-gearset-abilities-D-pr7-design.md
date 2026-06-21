# Combat Realism Epic — Sub-project D, PR7: On-death Implants (Design)

**Date:** 2026-06-21
**Sub-project:** D (new ability sources: implants + gear-set skills), seventh PR.
**Parent spec:** `docs/superpowers/specs/2026-06-20-implant-gearset-abilities-D-design.md`.
**Builds on:** D-PR1..D-PR6 — `buildEquipmentAbilities` registry, `buildShipAbilitiesWithEquipment`
passive-slot merge, equipment coverage tracker, the reactive trigger system (`triggers.ts`).
**Branch:** `feat/combat-d-pr7-on-death`, stacked on the D-PR6 tip `237ddee7`.
**Status:** design (brainstorm complete, user-approved through all sections).

## 1. Context

D-PR1..D-PR6 shipped the equipment-ability source layer plus heal/leech, conditional outgoing-damage,
conditional incoming-reduction, outgoing-amplification, and cast/received heal-amplification effects.
This PR lights up the **on-death** bucket — the three implants whose effect fires "upon death" / "when
this unit is destroyed":

- **Last Wish** (`src/constants/implants.ts`, type `major`) — "Upon death, repairs X% of all allies'
  max HP." X = 14/19/25/32 by rarity (uncommon/rare/epic/legendary). No common variant.
- **Battlecry** (type `major`) — "Upon death, grants all allies Inc. Damage Down II for N turns."
  N = 1/2/2/3 by rarity (common/rare/epic/legendary).
- **Martyrdom** (type `ultimate`) — "Applies Disable for N turns on the enemy that killed this Unit."
  N = 1/2 by rarity (rare/legendary). Only the rare + legendary variants exist.

All three are **deterministic** — none of the implant texts carry a proc chance.

### 1.1 Key finding: the trigger, killer-identity, and all three payload paths already exist

A code-read showed the on-death machinery is almost entirely already present:

- **`on-destroyed` trigger** (`triggers.ts` ~378) — self-scoped (`e.actorId === ownerId`), fires on the
  `ship-destroyed` event. Salvation's self-destruct heal already rides it; Faust's purge rides it and
  targets the killer.
- **Killer identity** — the `ship-destroyed` event already carries `killerId` and `byDirectDamage`
  (`events.ts` ~159; stamped by `recordDestroyed`, `state.ts:177`). Faust's on-destroyed purge already
  routes `counterTargetId = e.killerId` to hit the killer.
- **Reactive payload executors** (`triggers.ts` ~964+) already support:
  - `type:'heal'` with `target:'all-allies'` and `basis:'target-hp'` (each recipient repairs % of **its
    own** max HP — resolved per-recipient inside the heal loop, ~1167). Dead recipients (incl. the dead
    caster) are skipped from credit (~1189). **→ Last Wish.**
  - `type:'buff'` with `target:'all-allies'` (grants to every same-side id `ctx.playerIds`, with a
    `duration`; emits `buff-applied`). **→ Battlecry.**
  - `type:'debuff'` with killer routing via `intent.eventCtx.counterTargetId` + the owner's landing gate
    (`landsTimedEnemyApplication`; emits `debuff-applied`). **→ Martyrdom.**

So the PR is mostly **three registry entries** plus **one surgical engine change** for Martyrdom's
killer routing.

### 1.2 Payload fidelity

- **Last Wish** — fully modeled. Reuses the reactive heal fold (no-crit, owner/recipient heal-modifier
  channels) exactly as Salvation does.
- **Battlecry** — fully modeled. "Inc. Damage Down II" is a canonical buff (`buffs.ts:296`) whose
  parsed effect folds into `incomingDamageModifier` (`toEnemyModifiers` → `playerTurn.ts:1301`,
  `(1 + incomingDamageModifier/100)`), reducing each ally's incoming damage. The per-rarity difference
  is **duration only**; magnitude is intrinsic to the named buff tier ("II").
- **Martyrdom** — **Disable is emit-only** (user-chosen scope). The `debuff-applied` event fires and the
  named "Disable" status is applied to the killer, but Disable has **no turn-effect today** (only Stasis
  is a modeled turn-skip control; `control-applied`/non-Stasis statuses are emit-only). Disable's actual
  suppression ("prevents activation of passive and active skills", `buffs.ts:61`) is shared by ~6 ships
  (APEX, IonScorp, Makoli, Tygr, Xcellence, Yuyan) and belongs in a dedicated control PR, not the
  on-death bucket. Martyrdom therefore surfaces correctly on the event log and applies a real (if inert)
  status now, and lights up for free when Disable's effect is later modeled.

## 2. Architecture

Pure additive registry work + one targeted listener extension. No new types, no new ConditionSubject,
no new executor branch.

### 2.1 Registry entries (`src/utils/abilities/buildEquipmentAbilities.ts`)

Three new `IMPLANT_ABILITIES` entries, values baked per-rarity from `implants.ts`, following the
established `() => Omit<Ability, 'id'>` pattern. Each is placed in the passive slot via the existing
`buildShipAbilitiesWithEquipment` wrapper (untouched). Stable ids `equip-implant-${name}-${gearId}`.

| Implant | `trigger` | `type` | `target` | config |
|---|---|---|---|---|
| **Last Wish** | `on-destroyed` | `heal` | `all-allies` | `basis:'target-hp'`, `pct` 14/19/25/32, `noCrit:true` |
| **Battlecry** | `on-destroyed` | `buff` | `all-allies` | `buffName:'Inc. Damage Down II'`, `duration` 1/2/2/3 |
| **Martyrdom** | `on-destroyed` | `debuff` | `enemy` | `buffName:'Disable'`, `duration` 1/2 |

Rarity → variant resolution reuses the existing implant rarity-picking helper. Variants that don't exist
(Battlecry has no uncommon; Last Wish has no common; Martyrdom has only rare + legendary) simply produce
no ability for that rarity — graceful skip, never throw (existing registry contract).

### 2.2 Engine change: killer routing for on-destroyed debuffs (`triggers.ts` ~385)

Today the `on-destroyed` listener routes the killer **only** for `purge`:

```ts
if (ra.ability.config.type === 'purge') {
    if (!e.byDirectDamage) return;
    enqueue({ ...intent, eventCtx: { ...intent.eventCtx, counterTargetId: e.killerId } });
} else {
    enqueue(intent);
}
```

Extend the killer-routing branch to `purge | debuff`:

```ts
if (ra.ability.config.type === 'purge' || ra.ability.config.type === 'debuff') {
    if (!e.byDirectDamage) return;            // no direct killer (e.g. DoT death) → no application
    enqueue({ ...intent, eventCtx: { ...intent.eventCtx, counterTargetId: e.killerId } });
} else {
    enqueue(intent);
}
```

This makes a Martyrdom-style on-destroyed debuff (a) gate on `byDirectDamage` (a unit killed by a DoT has
no clear killer → the implant does nothing, matching "the enemy that killed this Unit") and (b) land on
the killer via `counterTargetId` rather than the default enemy store.

**Byte-identical claim + the one risk.** This change alters behavior only for an `on-destroyed` ability
whose `config.type === 'debuff'`. A survey of `docs/ship-skills.csv` shows the only self-`on-destroyed`
ship reactions are **Faust** (purge) and **Salvation** (heal) — **no ship produces an on-destroyed
debuff.** Martyrdom is the first. So for every existing fixture this branch is unreached and the run is
byte-identical. The plan MUST re-verify this with `npm run audit:skills` + a grep, and assert zero
golden/`.snap` movement. (Liberator/Madax "when an enemy dies" are `on-enemy-destroyed`, a different
listener — unaffected.)

### 2.3 Coverage tracker (`equipmentCoverage.test.ts`)

Add `BATTLECRY`, `LAST_WISH`, `MARTYRDOM` to the implemented-implants set (IMPLANTS declaration order).

## 3. Data flow

```
ship-destroyed{actorId, killerId, byDirectDamage}
   └─ on-destroyed listener (actorId === ownerId)
        ├─ Last Wish  (heal,  all-allies) → reactive heal fold → repair living allies % of their max HP
        ├─ Battlecry  (buff,  all-allies) → applyTimedAbilityStatus "Inc. Damage Down II" to ctx.playerIds
        │                                    → folds into each ally's incomingDamageModifier next turn
        └─ Martyrdom  (debuff, enemy)     → [byDirectDamage gate] counterTargetId = killerId
                                             → landing gate → applyTimedAbilityStatus "Disable" on killer
                                             → debuff-applied event (emit-only; no turn-effect yet)
```

Symmetric by construction: the engine is team-agnostic post-bySide-unification, so an enemy ship with
any of these implants triggers the same paths against the player side.

## 4. Edge cases

- **Last Wish dead-caster credit** — `recipients = ctx.playerIds` includes the just-destroyed caster; the
  existing dead-recipient skip (~1189) drops it from gross credit. Living allies repair normally.
- **Martyrdom non-direct death** — DoT/indirect kill → `byDirectDamage:false` → no application (no clear
  killer). Matches the implant text.
- **Martyrdom landing** — the Disable application draws the **owner's** landing gate
  (`landsTimedEnemyApplication`), consistent with every other debuff (a Disable can be resisted).
- **No effect-bearing gear in fixtures** — registry additions are inert for existing combat fixtures →
  no golden/`.snap` movement from §2.1 / §2.3.

## 5. Testing

- **Registry unit test** — the three implants resolve to the correct config (trigger/type/target/basis/
  pct/buffName/duration) per rarity; non-existent rarities produce nothing.
- **Integration (`equipmentAbilities.integration.test.ts` or sibling):**
  - Last Wish: on a carrier's destruction, living allies' HP rises (gross heal credited); dead caster not
    double-credited.
  - Battlecry: on destruction, all living allies gain "Inc. Damage Down II" (`buff-applied` per ally) and
    take reduced incoming damage the following turn.
  - Martyrdom: on direct-damage death, `debuff-applied` "Disable" lands on the **killer** id (not the
    default enemy); on a non-direct death, no `debuff-applied`.
  - One enemy-side mirror (an enemy carrier dying applies to a player killer) to lock symmetry.
- **Coverage tracker** updated per §2.3.
- **Byte-identical gate:** full suite green with ZERO golden/`.snap` drift; `npm run audit:skills`
  unchanged (141/0); lint + tsc clean.

## 6. Out of scope / deferred

- **Disable as a turn-effect** — modeling Disable's "prevents active + passive skills" suppression for
  all ~6 inflicting ships. Its own control PR (sub-project B extension). Martyrdom lights up for free
  once it lands.
- All other remaining D effects (Voidfire Catalyst bomb modifier; reactive self/ally buffs; charge/DoT/
  cleanse net-new; Boost/Cloaking; Warpstrike duration-reduction half; CF/Provoke appliers).

## 7. Files touched

- `src/utils/abilities/buildEquipmentAbilities.ts` — 3 registry entries (+ rarity baking).
- `src/utils/combat/triggers.ts` — `purge` → `purge | debuff` killer-routing in the on-destroyed listener.
- `src/utils/abilities/__tests__/equipmentCoverage.test.ts` — implemented set += 3.
- `src/utils/combat/__tests__/equipmentAbilities.integration.test.ts` (+ registry unit test sibling).
- `src/constants/changelog.ts` — `UNRELEASED_CHANGES` entry.
