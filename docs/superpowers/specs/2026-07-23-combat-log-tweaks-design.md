# Combat-log tweaks — design

**Date:** 2026-07-23
**Status:** Approved (design), pending implementation

Three reported combat-log gaps, plus one latent bug uncovered while scoping #3.

## Pipeline recap

Engine emits a flat `CombatEvent[]` → `buildCombatLog` folds it into `CombatLogRound[]`
→ `RoundEventLog.tsx` renders per-kind formatters. `nameOf(actorId)` (`RoundEventLog.tsx:264`)
is the single place actor ids resolve to display names (`Enemy X` / `X`); it returns the raw
id when no roster entry matches.

---

## Finding 1 — Concentrate Fire shows no / placeholder target

**Symptoms**
- `Selenite: Concentrate Fire` (start-of-round apply) shows no recipient.
- `Enemy Selenite → enemy: Concentrate Fire resisted` shows the literal placeholder `enemy`.

**Root cause (NOT a targeting-model gap)**
The engine already resolves the real target. Selenite p3's "highest attack enemy" clause is
tagged `enemy-highest-attack` by the parser (`buildShipAbilities.ts:3442`, Ship-kit W8), and the
reactive start-of-round executor resolves it to a real actor via `ctx.enemyWithHighestAttack`
(`triggers.ts:2570-2576`), wired team-symmetrically at `engine.ts:6364` (enemy roster) and
`:6422` (player roster). Two display-layer gaps remain:

1. **Renderer drops the target.** The `debuff` and `dot-applied` formatters use `noteLine`,
   which ignores `targets[0]`. The applied entry *does* carry the resolved `targetId`.
2. **Resisted emit hardcodes the sink.** `triggers.ts:2657` emits `debuff-resisted` with
   `targetId: ctx.enemy.id` (the `"enemy"` dummy sink) instead of the resolved `debuffTargetId`
   already computed at `:2605`.

**Changes**
- `RoundEventLog.tsx`: replace the `debuff` and `dot-applied` formatters (currently `noteLine`)
  with a shared helper that renders `"{src} → {tgt}: {note}"` when `targets[0]` exists and its
  `targetId !== actorId`, else `"{src}: {note}"`. `buff` stays `noteLine` (buffs are self-keyed,
  `targets: []`). `control` also stays `noteLine` (`targets: []`).
- `triggers.ts:2657`: emit the resisted event with `debuffTargetId` (the resolved target) instead
  of `ctx.enemy.id`. Update the adjacent comment (which claims resist is display-only and needs no
  per-target routing) to note the target is now used for display.

**Result**
- `Enemy Selenite → <player ship>: Concentrate Fire`
- `Enemy Selenite → <player ship>: Concentrate Fire resisted`

**Note on the dummy-sink fallback.** In pure DPS / non-positional runs the resolved target *is*
the `enemy` sink (id `"enemy"`), so those lines will still read `→ enemy`. That is correct for
those runs (there is no named ship). Only positional/healing battles carry named opposing actors.

---

## Finding 2 — death line prints a raw killer id

**Symptom:** `Judge: destroyed by e:faa2ca9a-…:1`.

**Root cause:** `buildCombatLog.ts:629` bakes `destroyed by ${e.killerId}` into `note` *before*
name resolution, and the `death` kind renders via `noteLine`, which prints `note` verbatim.

**Changes**
- `buildCombatLog.ts` `ship-destroyed`: drop the `note`; carry the killer as
  `targets: e.killerId ? [{ targetId: e.killerId }] : []`.
- `RoundEventLog.tsx`: add a dedicated `death` formatter:
  `killer ? "{actor}: destroyed by {nameOf(killer)}" : "{actor}: destroyed"`.

**Result:** `Judge: destroyed by Enemy Vanguard`.

---

## Finding 3 — DoT lines omit tier (I/II/III), one line per tier

Applies to corrosion and inferno (bomb/generic keep no numeral, matching existing
`dotResistLabel` policy). Covers **ticked, applied/inflicted, and resisted** DoT lines.

### 3a. Canonical magnitude → level → numeral helper

DoT config `tier` is a **magnitude**: corrosion 3/6/9, inferno 15/30/45, bomb 100/200/300
(`calculator.ts:101`; the tick math at `engine.ts:897/918` uses `tier/100`). Level = magnitude ÷
base (corrosion 3, inferno 15, bomb 100). Add to `debuffImmunity.ts` (already owns `ROMAN` +
`dotResistLabel`):

```ts
const DOT_TIER_BASE: Record<DoTType, number> = { corrosion: 3, inferno: 15, bomb: 100, generic: 0 };
// magnitude → 'I'|'II'|'III'|…, or '' for bomb/generic/out-of-range.
export function dotTierNumeral(dotType: DoTType, magnitude: number): string {
    if (dotType === 'bomb' || dotType === 'generic') return '';
    const base = DOT_TIER_BASE[dotType];
    const level = base > 0 ? Math.round(magnitude / base) : 0;
    return level > 0 && level < ROMAN.length ? ROMAN[level] : '';
}
```

### 3b. Fix `dotResistLabel` (latent bug)

`dotResistLabel` indexes `ROMAN[tier]` treating `tier` as a level, but every production caller
(`playerTurn.ts:2367`, `triggers.ts:2744/2774`) passes the **magnitude**. So a resisted Corrosion I
(mag 3) mislabels as "Corrosion III", and II/III (mag 6/9) drop the numeral. The isolated unit test
(`blockDebuff.test.ts`) passes level values, so it never caught this.

- Reimplement `dotResistLabel` on top of `dotTierNumeral(dotType, magnitude)` (magnitude in).
  `bomb` → kind only; `generic` → `Damage over Time` (unchanged).
- Update `blockDebuff.test.ts` to pass magnitudes (e.g. `('inferno', 45) → 'Inferno III'`,
  `('corrosion', 6) → 'Corrosion II'`). Callers already pass magnitude — no caller churn.

### 3c. Tick lines — one line per tier

`tickDoTs` (`engine.ts:894-928`) currently sums all corrosion (resp. inferno) entries into one
`emitTicked` call with a combined stack count, regardless of tier. Group by `tier` magnitude and
emit one `emitTicked` per `(dotType, tier)` group (that group's summed damage + summed stacks).
Damage credit is already per-entry (`credit(...)`), so it is unaffected — only the log-facing
`emitTicked` granularity changes. Apply `incomingDotReductionPct` per group as today.

- Widen `emitTicked` signature: `(dotType, damage, stacks, tier) => void`.
- `events.ts`: add `tier: number` to the `dot-ticked` event.
- The three `emitTicked` call sites pass through the new arg; generic keeps a single call (tier 0).

### 3d. Applied/inflicted lines — carry tier

- `events.ts`: add `tier: number` to the `dot-applied` event.
- Widen `emitDotApplied` in `applyNewDoTs` (`playerTurn.ts:794`) to `(dotType, stacks, tier)` and
  pass `dot.tier` at each of the four call sites (`:805/813/825/833`).
- The two `bus.emit({ type: 'dot-applied' … })` sites in `playerTurn.ts` (`:2395`, `:2460`) add
  `tier`. The reactive `landDotOn` emit in `triggers.ts:2711` adds `tier: cfg.tier`.

### 3e. Log builder — render the numeral

- `buildCombatLog.ts` `dot-applied` (`:540`) and `dot-ticked` (`:555`) handlers build the note as
  `` `${dotType}${numeral ? ` ${numeral}` : ''} ×${stacks}` `` using
  `dotTierNumeral(e.dotType, e.tier)`. No renderer change needed — the existing `dot-ticked`
  formatter and the new `dot-applied` formatter (from #1) render `note` as-is.

**Results**
- Tick: `Enemy Graphite: corrosion III ×1 → 3,444` (mixed-tier ticks split into one line each).
- Applied: `<src> → Enemy Graphite: corrosion III ×2`.
- Resisted (Block Debuff): `<src> → Enemy Graphite: Corrosion III resisted`.

---

## Testing

- **Unit — `dotTierNumeral` / `dotResistLabel`:** magnitude inputs map to correct numerals;
  bomb/generic yield no numeral; out-of-range → ''.
- **Unit — `tickDoTs` grouping:** two corrosion entries of different tiers produce two `emitTicked`
  calls with correct per-tier sums/stacks; same-tier entries still coalesce; total credited damage
  unchanged.
- **Unit — `buildCombatLog`:** `dot-applied`/`dot-ticked` notes include the numeral; `ship-destroyed`
  carries the killer as a target (no id in note).
- **Unit — `RoundEventLog`:** `debuff`/`dot-applied` render `src → tgt`; `death` renders
  `destroyed by {name}`; buff/control unchanged.
- **Integration — two Selenites (positional):** the Concentrate Fire apply *and* resist lines name
  real ships (not `enemy`). RNG seeded per the repo's `setupKeyedTestRng`/`resetRateGateRng` pattern.
- **Regression:** full `npm test` (golden audit) green; fix any golden that captured a Block-Debuff
  DoT-resist label (it held the buggy string) or a DoT tick/applied note.
- `npm run lint` (max-warnings 0).

## Changelog

Add a plain-English entry to `UNRELEASED_CHANGES` in `src/constants/changelog.ts` (combat-log
readability: Concentrate Fire shows attacker→target, deaths name the killer, DoT lines show
tier I/II/III).

## Out of scope

- Changing tick/applied lowercase `dotType` styling to match the capitalized resist buffName
  convention (pre-existing inconsistency; not touched).
- Bomb/generic tier numerals (game shows bombs untiered; matches current `dotResistLabel`).
