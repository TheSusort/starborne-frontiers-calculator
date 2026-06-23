# Block / Protection Control Primitives — Design (D-PR15)

**Date:** 2026-06-22
**Epic:** Combat-realism epic (sub-project D — implants + gear-set abilities)
**Status:** Approved (brainstorm), pending spec review

## Context

The "Block/Protection" D bucket covers four implants — Firewall, Last Stand, Lockdown,
Tenacity — that grant defensive **control buffs** to the holder or its allies. Those buff
*types* are inert in the combat engine today: the grant machinery (reactive self / all-ally
buff grants) already exists from D-PR8/D-PR9, but the granted buffs do nothing.

This PR is the **primitives-first** slice: make the underlying buff *types* actually do
something in the engine, tested synthetically (buffs applied directly to actors in tests, no
implant triggers). The four implant **appliers** ship in follow-up PRs (see Out of Scope).

### Scope correction discovered during brainstorm

The four implants reference three control buffs: **Block Damage**, **Block Debuff**, and
**Buff Protection**.

- **Block Damage is already modeled** — it is the old name for **Barrier**, which the engine
  fully implements (`src/utils/combat/barrierBuffs.ts`: full damage immunity, blocks direct +
  DoT, a fully-blocked hit deals 0, with leech/positional carve-outs). The user renamed the
  Last Stand implant description from "Block Damage" to "Barrier" (committed to main as
  `2339df92`). **No engine work is needed for Block Damage** — the Last Stand applier PR will
  simply grant the existing `Barrier` buff.

Therefore this PR ships **two** new primitives:

1. **Block Debuff** — immune to receiving debuffs.
2. **Buff Protection** — the holder's buffs cannot be removed by purge.

### Byte-identical guarantee

No ship skill and no combat fixture grants `Block Debuff` or `Buff Protection` (verified by
corpus grep: 0 matches in `docs/ship-skills.csv`). No fixture equips effect-bearing gear that
grants them. Therefore lighting up both primitives is **byte-identical** to every existing
golden / `.snap` fixture (zero drift expected).

> Note: the sibling buff **Block Buff** ("immune to receiving buffs") *is* granted by 4 ships
> (Bizon, Butcher, + two purge ships) and is also inert in-engine. Lighting it up would move
> goldens, so **Block Buff is explicitly out of scope** for this PR.

## Locked Semantics (from brainstorm)

### Block Debuff
- Blocks **all** incoming debuff applications while active — every application path: timed
  debuffs, DoTs (Inferno/Corrosion/Bomb), control-as-named-debuff (Stasis/Disable applied as a
  named debuff), and persistent-stacking debuffs (Defense Shred/Blast/Overload/Titanite).
- A blocked debuff is recorded as a **resist** — the same outcome as a failed landing roll
  (resisted list + `debuff-resisted` event). This is what lets a future Lockdown ("when
  resisting a debuff") chain off it.
- **DoTs also fire a resist event when blocked** (user decision). Since DoTs have no resist
  surface today (a failed DoT landing roll silently does not append, with no event), the
  `debuff-resisted` event for a DoT is emitted **only on the Block-Debuff block path** — NOT
  on normal landing-roll failures, which stay silent as today. This preserves the
  byte-identical guarantee for existing fixtures.
- Block is checked **before the landing roll** (immunity beats landing — a debuff that would
  otherwise land is still blocked).
- **Already-landed debuffs are untouched** — Block Debuff only blocks *new* applications while
  active; it does not remove or shorten debuffs already on the holder.

### Buff Protection
- The holder's buffs **cannot be removed by purge**. A purge against a Buff-Protection holder
  removes **0** buffs (the *entire* purge is blocked, not just "protect one buff").
- **Purge only.** Cleanse (which removes *debuffs*, not buffs) is untouched. Buff-**steal** is
  untouched (out of scope; no steal mechanic interacts here today).
- Buff Protection protects the holder's other active buffs **and itself** while active.

## Engine Design

Both primitives follow the established **buff-name-driven** pattern (mirrors `barrierBuffs.ts`,
`stasisBuffs.ts`, `disableBuffs.ts`): a small module exporting a `ReadonlySet<string>` of buff
names + an `is*` predicate; the engine reads the relevant actor's active buff names and
short-circuits.

Reading an actor's active buff names uses the existing idiom
`selfBuffNamesForOwners(statusEngine, [actorId])` (the same accessor Barrier uses at the damage
seam, `engine.ts:2578`), which folds scheduled + ability-timed + ability-aura buff sources.

### Buff Protection (single chokepoint)

New module `src/utils/combat/buffProtectionBuffs.ts`:
```ts
export const BUFF_PROTECTION_BUFFS: ReadonlySet<string> = new Set(['Buff Protection']);
export const isBuffProtection = (name: string): boolean => BUFF_PROTECTION_BUFFS.has(name);
```

Purge funnels through exactly one removal function: `statusEngine.purge(targetId, count)`
(`statusEngine.ts` ~993), which delegates to `removeNewestFirst(targetId, 'buffs', count)`.
There are only two call sites — on-cast (`playerTurn.ts:1515`) and reactive
(`triggers.ts:1425`) — both already read the real removed count, and `purge-performed` is only
emitted when `removed > 0`.

**Guard inside `purge()`** (holder-state guard, not per-buff): before removal, read the target's
active buff names; if any ∈ `BUFF_PROTECTION_BUFFS`, return `0` immediately (skip
`removeNewestFirst`). This covers both call sites and any future one automatically, and a blocked
purge naturally emits no `purge-performed` event (removed = 0).

- Cleanse uses `removeNewestFirst(actorId, 'debuffs', count)` — a different store, not touched
  by this guard. Confirm the guard is scoped to the `'buffs'`/purge path only.
- This is distinct from the existing **per-buff** `UNREMOVABLE_STATUSES` mechanism
  (`cheatDeathBuffs.ts`); Buff Protection is a **holder-state** guard (depends on the target
  having the buff), so it does not belong in `UNREMOVABLE_STATUSES`.

### Block Debuff — model as "immune target auto-resists" (gathered)

**Framing:** Block Debuff is a **landing concern**, not an apply concern. An immune target
simply *resists* every incoming debuff. Because every timed/persistent debuff path already
converts a failed landing roll into a correctly-recorded resist (resisted list +
`debuff-resisted` event), folding the immunity check into the **landing decision** makes those
paths produce the right resist **for free**, with no per-seam apply/resist duplication.

All immunity logic lives in **one module**, `src/utils/combat/debuffImmunity.ts`:
```ts
export const BLOCK_DEBUFF_BUFFS: ReadonlySet<string> = new Set(['Block Debuff']);
export const isBlockDebuff = (name: string): boolean => BLOCK_DEBUFF_BUFFS.has(name);

// Holder-state predicate (reuses the Barrier idiom via selfBuffNamesForOwners).
export function targetCarriesBlockDebuff(statusEngine, targetId): boolean;

// Used by the DoT seams (block-path resist event helper).
export function emitBlockDebuffResist(bus, targetId, round, buffName): void;
```

The seams collapse into three things:

1. **Timed + persistent debuffs (cast + reactive) — fold into the landing decision.**
   When the target carries Block Debuff, the landing decision returns *resisted* (the roll is
   not drawn / its result is ignored — immunity beats landing, including the `application:
   'apply'` auto-land branch). The existing resist plumbing then records the resist at every
   one of these paths automatically.
   - Cast side: `landsTimedEnemyApplicationLive` (playerTurn.ts ~750) — already knows the turn
     target; one immunity check covers on-cast timed (Path 1), scheduled timed/persistent via
     the same bound function (Path 2), and ability-persistent (Path 4, which rides this
     landing).
   - Reactive side: the landing call in triggers.ts ~1177 — target is
     `counterTargetId ?? <default>`, available at the seam.

2. **DoTs (cast + reactive) — two thin call sites.** A failed DoT landing roll is **silent**
   today (no event), and that must stay byte-identical. So the DoT gates get an explicit
   immunity branch that fires **only on the Block-Debuff block path**:
   `if (targetCarriesBlockDebuff) { emitBlockDebuffResist(...); skip; }` — checked *before* the
   normal landing gate. Call sites: cast DoT gate (playerTurn.ts ~811 / `applyNewDoTs`) and
   reactive DoT gate (triggers.ts ~1214). The synthesized `buffName` for the event reflects the
   DoT kind + tier as a single shared convention — capitalized kind + Roman-numeral tier
   (`'Inferno III'`, `'Corrosion II'`; `'Bomb'` has no tier). Define this label in **one place**
   (in `debuffImmunity.ts`, reusing any existing DoT-naming helper if present) so the
   `emitBlockDebuffResist` call and the test assertion reference the same source — this is the
   one spot in the PR where two pieces must agree on a string.

3. **One shared predicate** `targetCarriesBlockDebuff` (via `selfBuffNamesForOwners`) used by
   both the landing-fold checks and the DoT call sites.

Notes:
- Control inflicts (Stasis, Disable) reach the engine as **named debuffs** (parsed buffName
  `'Stasis'` / `'Disable'`) routed through the timed paths above — blocked for free by the
  landing fold; no separate seam. The `control-applied` event is reaction-only.
- Because the engine is team-agnostic, the landing fold + DoT checks protect player and enemy
  targets symmetrically (the reactive landing/DoT seams run for both sides).
- **Implementation note:** verify the cast-side landing fold also covers the `application:
  'apply'` (auto-land) branch and that the reactive `owner.landsTimedEnemyApplication` seam
  resolves the correct `counterTargetId`. If threading the target into a bound landing function
  proves awkward at any single seam, fall back to a thin `targetCarriesBlockDebuff` guard at
  that one seam (still calling the shared module) — but the default is the landing fold.

## Corpus Additions

`Block Debuff` and `Buff Protection` are not in the buff corpus (`src/constants/buffs.ts`),
exactly like `Power Infused Nanobots` in D-PR9. Add both via the existing `MANUAL_BUFFS`
mechanism (`scripts/updateBuffsData.ts`) so `npm run fetch-buffs` preserves them on regen:

- `Block Debuff` — `type: 'buff'`, description "Is immune to receiving debuffs".
- `Buff Protection` — `type: 'buff'`, description e.g. "Protects this unit's buffs from being
  removed".

Both are purely behavioral (no stat effects) → `parseBuffEffects` yields empty effects → no fold
impact. Confirm they render acceptably in any buff picker UI (informational only).

## Testing Strategy

Synthetic engine tests (no implant triggers):

- **Block Debuff:** apply `Block Debuff` directly to a target, then have the opposing side
  attempt each debuff family — (a) timed debuff, (b) persistent-stacking shred, (c) DoT
  (inferno/corrosion), (d) control-as-named-debuff (Stasis/Disable) — and assert each is
  **blocked + recorded as a resist** (resisted list entry + `debuff-resisted` event, including
  the new DoT resist event). Assert an **already-landed** debuff is NOT removed when Block
  Debuff is subsequently applied. Assert the block fires even against a would-otherwise-land
  application (immunity beats landing).
- **Buff Protection:** apply `Buff Protection` to a target holding ≥1 other buff, run a purge
  (on-cast and reactive), assert **0 removed** and **no `purge-performed`** event. Assert
  cleanse of a debuff on a Buff-Protection holder still works (purge-only scope). Assert that
  without Buff Protection the same purge removes buffs (control case).
- **Byte-identical:** full suite green, **zero** golden / `.snap` drift.

## Out of Scope (follow-up applier PRs)

Tracked in the epic; not this PR:

- **Firewall** — on self being debuffed → self gains `Block Debuff` (needs an on-self-debuffed
  trigger).
- **Last Stand** — on becoming the last unit standing → self gains `Barrier` + `Block Debuff`
  (needs a last-standing trigger; uses the existing Barrier + this PR's Block Debuff).
- **Lockdown** — on resisting a debuff → all allies gain `Buff Protection` (needs an
  on-debuff-resisted trigger; chains off Block Debuff resists or true landing-roll resists).
- **Tenacity** — on directly receiving damage > 25% max HP → all allies gain `Buff Protection`
  (needs a big-hit-threshold condition on the on-attacked trigger).
- **Block Buff** primitive (immune to receiving buffs) — separate, golden-moving (4 ships use
  it).
- Buff-**steal** immunity for Buff Protection.

## Decomposition note

Both primitives are independent and could split into two PRs (Buff Protection is a 1-chokepoint
change; Block Debuff is the multi-seam one). Default: ship both in one PR as two separate tasks,
since both are byte-identical and share the corpus + synthetic-test harness work.
