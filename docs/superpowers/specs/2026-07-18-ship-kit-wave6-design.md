# Ship Kit Wave 6 — Stealth-Targeting Bypass — Design

**Date:** 2026-07-18
**Backlog:** `docs/ship-kit-fix-plan.md` Wave 6 (3 findings) · ledger `docs/ship-kit-correctness-ledger.md`
**Branch:** `feat/ship-kit-wave6-stealth-bypass`

## Problem

Ships with the `stealthed` status are untargetable — `positionalBinding.ts` step 4 filters
stealthed cells out of the candidate list, restoring all only if the filter empties the set.
Today the *only* stealth bypasses are Concentrate Fire and Provoke (both forced-targeting
overrides). No `ignoresStealth` / `canTargetStealth` / `bypassStealth` field exists anywhere in
`src/` (verified by grep). Three ships whose kits explicitly bypass stealth are therefore
mismodeled — they cannot target stealthed enemies in the simulator.

### The 3 findings

| Ship | Clause | Slot(s) | Severity |
|---|---|---|---|
| Lodolite | "This attack can target Stealthed enemies" **and** passive "This Unit ignores Stealth effects" | active + charged + passive | high |
| Rhodium | "This attack can target Stealthed enemies" | charged only | med |
| Selenite | "This attack can target Stealthed enemies" | charged only | med |

Skill text (source of truth = `docs/ship-skills.csv`):
- **Lodolite active:** "…When targeting non-Defenders, apply Concentrate Fire for 2 turns.<br />This attack can target Stealthed enemies."
- **Lodolite charged:** "…the enemy with the most Buffs is Purged of all buffs.<br />This attack can target Stealthed enemies."
- **Lodolite passive** (both refit variants): "This Unit ignores Stealth effects.<br /><br />…"
- **Rhodium charged:** "This Unit deals 170% damage…<br />This attack can target Stealthed enemies."
- **Selenite charged:** "This Unit deals 300% damage…<br />This attack can target Stealthed enemies."

> NOTE — out of scope for Wave 6 (Wave 8): Selenite's R2 passive
> "the highest attack enemy is applied with Concentrate Fire" (`enemy-highest-attack` selector,
> WRONG-PARSE). Wave 6 is stealth-bypass only.

## Design — two signals reaching the resolver by two existing carriers

Combat targeting resolves per-attack in `resolvePositionalTarget(actorPosition, target,
opposingLiving, statusOf, acting)`. It receives BOTH the acting attacker context (`acting`, today
`{ ignoresForcedTargeting, provokedBy }`) AND the `target: ParsedTarget`. We route the two bypass
signals through these two existing carriers — **no new engine maps**:

- **Ship-level** ("This Unit ignores Stealth effects" → all casts) rides `acting.ignoresStealth`
  (clone of `ignoresForcedTargeting`, sourced from `CombatActor.ignoresStealth`).
- **Per-cast** ("This attack can target Stealthed enemies" → this skill only) rides
  `ParsedTarget.ignoresStealth`. `ParsedTarget` already flows through every engine target map
  (`teamTargetById` / `enemyTargetById` / `input.target` and their `charged*` twins), and the
  charged-vs-active axis is already selected per turn (`willFireChargedFor` →
  `parsedChargedTargetFor` vs `parsedTargetFor`), so stamping the active vs charged `ParsedTarget`
  gives correct per-skill granularity for free.

The resolver skips the stealth filter when EITHER signal is set (`acting?.ignoresStealth ||
target.ignoresStealth`).

**Single source of truth = the per-ability `config.ignoresStealth`.** The parser sets it on the
damage ability; `battleSimulator` derives the per-slot (`active` / `charged`) bypass by reading
those built configs and stamps the matching `ParsedTarget`. No text is re-parsed downstream.

### Signal 1 — per-ability flag (`ability.config.ignoresStealth`)

Mirrors Wave 5's `ignoresDefense` damage-config flag.

- **Type:** add `ignoresStealth?: boolean` to the damage ability config in `types/abilities.ts`
  (same object as `ignoresDefense`, ~line 625).
- **Parser:** `parseIgnoresStealth(text: string): boolean` in `skillTextParser.ts` — detects the
  per-attack clause. Regex (tag-stripped, case-insensitive):
  `/\bthis attack can target\b[^.]*\bstealthed\b[^.]*\benem/i`. Exported.
- **Build:** in `buildShipAbilities.ts`, at the damage-ability construction site that already reads
  `parseIgnoresDefense` (~1116/1156), also read `parseIgnoresStealth(text)` and spread
  `...(ignoresStealth ? { ignoresStealth: true } : {})` onto the config.
- **Covers:** Rhodium charged, Selenite charged, Lodolite active + charged.

### Signal 2 — ship-level flag (`ShipSkills.ignoresStealth` → `CombatActor.ignoresStealth`)

Exact clone of Wave 1's `ignoresForcedTargeting` end-to-end wiring.

- **Parser:** `detectIgnoresStealth(...skillTexts): boolean` in `skillTextParser.ts` — detects the
  ship-wide passive. Regex (tag-stripped): `/\bignores?\b[^.]*\bstealth\b[^.]*\beffects?\b/i`.
  Matches "This Unit ignores Stealth effects"; does **not** match the per-attack clause phrasing
  (which lacks "effects" after "Stealth").
- **Type:** add `ignoresStealth?: boolean` to `ShipSkills` (`types/abilities.ts` ~1070, next to
  `ignoresForcedTargeting`).
- **Build:** in `buildShipAbilities.ts` (~3425), compute over the refit-resolved rows
  (`getShipSkillRows(ship).map(row => row.text)`), spread onto the returned `ShipSkills`.
- **Threading:** mirror every `ignoresForcedTargeting` site — `state.ts` (CombatActor field +
  constructor), `engine.ts` (interface fields + adapter copies at the ~7 threading sites),
  `battleSimulator` wiring. Grep `ignoresForcedTargeting` for the complete site list.
- **Covers:** Lodolite (both refit passives carry the clause → flag always true for her).

### Per-cast carrier — `ParsedTarget.ignoresStealth`

- **Type:** add `ignoresStealth?: boolean` to `ParsedTarget` (`targetingParser.ts:10`).
- **battleSimulator (`planPlacement`, ~698):** the built `plan.shipSkills.slots` carry a
  `slot: SkillSlot`. Derive:
  ```ts
  const slotBypass = (slot: 'active' | 'charged') =>
      plan.shipSkills.slots
          .find((s) => s.slot === slot)?.abilities
          .some((a) => a.config.type === 'damage' && a.config.ignoresStealth === true) ?? false;
  ```
  Store `activeIgnoresStealth` / `chargedIgnoresStealth` on `PlacementPlan`.
- **Stamp at the actor-input build sites** (battleSimulator ~849/909/966, where `target:` and
  `chargedTarget:` are set) via a fresh-object wrap so the active/charged ParsedTargets never
  share a mutated reference (`parseShipTargeting` returns `charged === active` when unfilled):
  ```ts
  const withBypass = (t: ParsedTarget | undefined, on: boolean): ParsedTarget | undefined =>
      t && on ? { ...t, ignoresStealth: true } : t;
  // target:        withBypass(plan.targeting?.target, plan.activeIgnoresStealth)
  // chargedTarget: withBypass(plan.chargedTargeting?.target, plan.chargedIgnoresStealth)
  ```
  Absent the flag → the exact same `ParsedTarget` reference → byte-identical for every other ship.

### Ship-level engine seam — clone `ignoresForcedTargeting`

Thread `CombatActor.ignoresStealth` into `acting.ignoresStealth` at the two resolver call paths:
- `engine.ts:5017` (the `acting:` literal in `drivePositionalApply`, sourced from
  `args.ignoresStealth`) — add `ignoresStealth?` to the `drivePositionalApply` args and pass
  `actor.ignoresStealth` at the call (~5765).
- `engine.ts:5491` (`selectTurnTarget`'s `acting:` literal) — add `ignoresStealth: a.ignoresStealth`.

Extend the `acting` type on `applyPositionalDamage` (`positionalApply.ts:114`) and
`resolvePositionalTarget` (`positionalBinding.ts:51`) to include `ignoresStealth?: boolean`. The
per-cast flag needs NO engine seam — it already rides `target`.

### Resolver — skip the stealth filter

In `resolvePositionalTarget` step 4 (`positionalBinding.ts:110-114`):

```ts
// 4. Stealth filter — restore all if every candidate is stealthed. Skipped entirely when the
//    acting attacker (ship-level) OR this cast's target (per-ability) ignores Stealth.
if (!acting?.ignoresStealth && !target.ignoresStealth) {
    const visible = cells.filter((p) => !statusOf(byCell.get(p)!.id)?.stealthed);
    if (visible.length) {
        cells = visible;
    }
}
```

When either flag is set, stealthed cells stay in the candidate list and `selectTargets` resolves
the anchor as if no one were stealthed. Concentrate Fire / Taunt / Provoke ordering (steps 1-3) is
unchanged — stealth bypass only affects the visibility filter.

## DPS invariance

The DPS dummy is never Stealthed, so the single-dummy targeting path is byte-identical (the
step-4 filter is a no-op there whether or not it runs). All fidelity gain is in the positional
sim — same profile as Waves 4 and 5. The golden audit (whole `npm test`) must stay green.

## Editor + audit surface — NONE (verified out of scope)

- **No editor:** the Wave-5 precedent flag `ignoresDefense` has no AbilityCard editor UI, and the
  engine drives targeting from `ParsedTarget` (derived from the config in `battleSimulator`), not
  from a user-editable checkbox. Adding one would be misleading dead UI. Skip.
- **No audit change:** the coverage audit (`scripts/auditSkills.ts`, `skillAuditCoverage.test.ts`)
  flags triggers / gates / ungated buffs — NOT targeting statements. "This attack can target
  Stealthed enemies" is not flagged today (no allowlist entry for it on these ships) and this
  change adds no abilities, so no new findings appear. Verified: full `npm test` stays green.

## Tests (TDD — red first)

1. **Parser (build-level), per-ability** — Lodolite active+charged, Rhodium charged, Selenite
   charged parse `config.ignoresStealth === true` on the correct slot; Rhodium/Selenite **active**
   does NOT (regression guard); an unrelated attack ability does not.
2. **Parser, ship-level** — `detectIgnoresStealth` true for Lodolite passive text, false for
   Rhodium/Selenite; `buildShipAbilities(Lodolite).ignoresStealth === true`, others undefined.
3. **Resolver unit** (`positionalBinding.test.ts`) — with ALL opposing actors stealthed and no
   forced-targeting: without `ignoresStealth`, resolves via the "restore all" fallback; with
   `ignoresStealth`, resolves the same anchor via the normal (unfiltered) path. Add a
   *distinguishing* case: one stealthed front-most + one visible back — default targets the
   visible one, `ignoresStealth` targets the front-most stealthed one (proves the filter is
   actually bypassed, not just a fallback coincidence).
4. **Integration** — a positional battle where a bypass ability targets a stealthed enemy and
   lands damage; a non-bypass ability skips it.
5. **DPS golden** — full `npm test` stays green (byte-identical DPS).

## Execution

Subagent-driven (endorsed multi-task loop):
1. Per-ability parser (`parseIgnoresStealth`) + `config.ignoresStealth` type + build wiring +
   parser build tests (per-slot: active/charged correct, active-only regression guards).
2. Ship-level detector (`detectIgnoresStealth`) + `ShipSkills.ignoresStealth` + buildShipAbilities
   compute + build test.
3. `ParsedTarget.ignoresStealth` + resolver change + `acting` type extension + resolver unit tests.
4. Ship-level engine threading (`CombatActor.ignoresStealth`, `createActor`, EngineInput fields,
   adapter copies, 2 `acting` sites) — grep-driven off `ignoresForcedTargeting`.
5. battleSimulator per-slot derivation + `PlacementPlan` fields + `withBypass` stamping at the
   actor-input sites + positional integration test (stealthed enemy targeted by a bypass cast).
6. Changelog entry + DocumentationPage stealth note.

Per-task spec+quality review; Fable final whole-branch review (target: no Critical/Important);
then CodeRabbit round on the PR.

## Risks / watch-items

- **New AbilityTarget-style leak (N/A here):** we add a *flag*, not a target enum, so the
  Wave-5 `side:'self'` engine-classifier leak does not apply. The flag is opt-in
  (`config.ignoresStealth === true`) and inert everywhere it is not read.
- **Regex over-match:** `detectIgnoresStealth` must not fire on the per-attack clause and
  vice-versa. The "effects" anchor separates them; assert both directions in tests.
- **Threading completeness:** missing one `ignoresForcedTargeting` mirror site silently drops the
  ship-level flag for some code path. Grep-drive the site list and assert the actor field is set
  end-to-end (build → simulate).
