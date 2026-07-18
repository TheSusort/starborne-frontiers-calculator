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

## Design — two signals, OR'd at the engine seam

Combat targeting resolves per-attack in `resolvePositionalTarget(actorPosition, target,
opposingLiving, statusOf, acting)`. The `acting` context already carries `ignoresForcedTargeting`
and `provokedBy`. We add one more boolean, `ignoresStealth`, fed by two independent parser signals
that are combined (`||`) at the engine call site before the resolver runs.

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

### Engine seam — combine the two signals

At the two paths that build `acting` and call `resolvePositionalTarget`:
- `engine.ts:5017` (the `acting:` literal) and its resolver call at `engine.ts:5485`
- `positionalApply.ts:187` (receives `acting` from the engine via `applyPositionalDamage`)

Compute `ignoresStealth = actor.ignoresStealth === true || abilityConfig.ignoresStealth === true`
where the ability being fired is in scope, and thread it through `acting`. Extend the `acting`
type on `applyPositionalDamage` (`positionalApply.ts:114`) and `resolvePositionalTarget`
(`positionalBinding.ts:51`) to include `ignoresStealth?: boolean`.

### Resolver — skip the stealth filter

In `resolvePositionalTarget` step 4 (`positionalBinding.ts:110-114`):

```ts
// 4. Stealth filter — restore all if every candidate is stealthed.
//    Skipped entirely when the acting attacker (ship-level) or its ability ignores Stealth.
if (!acting?.ignoresStealth) {
    const visible = cells.filter((p) => !statusOf(byCell.get(p)!.id)?.stealthed);
    if (visible.length) {
        cells = visible;
    }
}
```

When `ignoresStealth` is set, stealthed cells stay in the candidate list and `selectTargets`
resolves the anchor as if no one were stealthed. Concentrate Fire / Taunt / Provoke ordering
(steps 1-3) is unchanged — stealth bypass only affects the visibility filter.

## DPS invariance

The DPS dummy is never Stealthed, so the single-dummy targeting path is byte-identical (the
step-4 filter is a no-op there whether or not it runs). All fidelity gain is in the positional
sim — same profile as Waves 4 and 5. The golden audit (whole `npm test`) must stay green.

## Editor + audit surface

- **AbilityCard** damage-config editor: add an `ignoresStealth` checkbox next to `ignoresDefense`
  (matches the existing per-flag editor pattern; keeps the round-trip lossless).
- **Audit rule:** teach the kit-audit harness to recognize the stealth-bypass clause so the ledger
  reflects the closed findings (mirror the `ignoresDefense` / forced-targeting audit entries).

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
1. Types + per-ability parser + build wiring + parser tests.
2. Ship-level detector + `ShipSkills`/`CombatActor` threading + build test.
3. Resolver change + `acting` type extension + resolver unit tests.
4. Engine-seam combination (both call paths) + integration test.
5. Editor checkbox + audit rule + changelog entry + DocumentationPage if user-facing.

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
