# Model-completeness epic — SP-C + SP-D (combined) design

**Date:** 2026-07-06
**Epic:** model-completeness (roadmap `docs/superpowers/specs/2026-07-05-model-completeness-epic-roadmap.md`)
**Input:** SP0 triage reconciliation `docs/model-completeness-triage-2026-07-05.md`
**Predecessor:** SP-A + SP-B merged (#233, `d6feff3c`); SP0 triage (#230); Curator dup-emission (#231)

## Goal

Close the 8 real-gap `it.fails` probes owned by SP-C and SP-D, faithfully — zero real-gap
allowlist deferrals for these ships, runtime behaviour team-symmetric per the engine-symmetry rule.
SP-C and SP-D are independent gate primitives (`C ∥ D` in the DAG); combined here into one
spec / plan / merge-loop because both are small and share the `ConditionSubject` +
`ConditionContext` + `evaluateCondition` + `roundContext` seam.

**Acceptance per gap:** flip its `it.fails` → `it` in
`src/utils/abilities/__tests__/modelCompletenessTriage.test.ts`. Several probes are proxy-form
today (build-output shape checks); each gets its assertion *strengthened* to the real literal as
that literal lands (see per-ship notes).

## Scope decisions (locked with the user)

1. **Combined spec** covering SP-C (Bayah, Chakara, Cobalt) + SP-D (Berserker, Tygr, Anemone,
   Belladonna, Snakeroot). Ships grouped into ~5 PRs, one brainstorm/spec/plan/merge-loop.
2. **SP-C primitive shape: one parameterized `ConditionSubject`** (`stat-vs-target`) carrying the
   stat and direction as typed `Condition` params (`compareStat`, `statComparator`) — NOT narrow
   per-(stat,direction) literals. Mirrors how `hpComparator`/`hpPercent`/`countThreshold` already
   parameterize a subject.
3. **HP comparison uses ABSOLUTE current HP**, not HP% — Cobalt's "more HP than the enemy" is an
   absolute-HP comparison. The existing `selfHpPct`/`enemyHpPct` percentage fields are insufficient
   (a large ship at 50% can out-HP a small ship at 90%). New absolute-HP context fields required.
4. **Chakara's "all damaged enemies" aggregate = min-speed** — the engine populates `targetSpeed`
   with the MINIMUM Speed among all damaged enemies, so `selfSpeed < targetSpeed` faithfully means
   "owner slower than every damaged enemy". Identical to primary-target in single-target DPS mode.
5. **SP-D DoT count uses a single `enemy-dot-count` subject** (per-target DoT ENTRY count) with an
   optional `buffName` family filter. Bare = all DoT entries (Anemone generic); with `buffName` =
   one family (Belladonna "Acidic Decay"). Also serves as Snakeroot's scaling source.
6. **Snakeroot scales per DoT ENTRY, not per stack** (user-confirmed: the passive is "for every 4
   DoT entries inflicted onto a single enemy"). `enemy-dot-count` already returns per-target entry
   counts — no total-stack summing needed.
7. **`enemies-hit-this-cast` is a NEW dedicated subject** (count of enemies actually DAMAGED this
   cast), NOT a `countThreshold` bolted onto `enemy-adjacent` (adjacency = board layout, not
   actually-hit; dead/immune adjacent enemies would wrongly satisfy it). Tygr's coarse
   `enemy-adjacent` presence proxy is REPLACED by this.
8. **DPS-mode defaults (user-locked):**
   - `stat-vs-target`: compare the ship's own stats vs the **configured enemy** (`EnemySettingsPanel`
     — Enemy HP / Enemy Speed). **Non-existing enemy stats count as 0** — there is no Enemy Crit
     Power field, so `targetCritPower = 0` in DPS (Bayah's self crit power > 0 ⇒ gate met). No new UI.
   - `enemies-hit-this-cast`: default **1** (single-target DPS hits one enemy) ⇒ a `≥2`/`≥3` gate is
     not met ⇒ Berserker rage / Tygr charge inert in DPS. Faithful — they genuinely wouldn't fire.
   - `enemy-dot-count`: the sim's already-tracked per-target DoT entry counts (Snakeroot scales
     realistically).

## Out of scope

- **Belladonna's Corrosion→Acidic Decay conversion** (SP-E, Task 6) — a DISTINCT clause. This spec
  builds only Belladonna's count-gate (charged skill "3+ Acidic Decay → Stasis"). Because Acidic
  Decay is introduced as a countable DoT family by SP-E, Belladonna's count-gate is **build-output
  faithful now but runtime-inert until SP-E lands** (`enemy-dot-count` with `buffName:'Acidic Decay'`
  returns 0 until an `acidicDecayEntryCount` source exists). Same "type-valid, inert until the source
  lands" pattern as `self-shielded` before SP-H. No coupling beyond that.
- **Voron / all SP-A/B/E/F/G ships.**
- **Cobalt's start-of-turn full-HP charge clause** (SP-G engine-timing) — its SP-C clause
  (owner-vs-target HP) is a DISTINCT mechanism; no overlap.
- **No new Enemy Crit Power UI field** — unset resolves to 0 per the DPS-default decision.

---

## SP-C — owner-stat-vs-target-stat comparison gates

All three feed a NEW parameterized comparison subject. Nearest existing analogues
(`OutgoingCondition['amplify-vs-higher-attack']`, `HealAmpCondition['target-hp-below-self']`) are
narrow single-purpose comparisons wired only to the Giant Slayer implant / heal-cast seam — not a
general owner-vs-target standing gate.

### Type changes (`src/types/abilities.ts`)

1. Add `'stat-vs-target'` to the `ConditionSubject` union (after `'self-crit-power'`, `abilities.ts:290`).
2. Add two optional fields to `interface Condition` (`abilities.ts:292–320`):
   ```ts
   /** For 'stat-vs-target': which stat to compare (owner vs target). */
   compareStat?: 'crit-power' | 'speed' | 'hp';
   /** For 'stat-vs-target': direction of the OWNER-vs-target comparison.
    *  'gt' = owner's stat strictly greater; 'lt' = owner's stat strictly less. */
   statComparator?: 'gt' | 'lt';
   ```

### Context changes (`evaluateConditions.ts` / `roundContext.ts`)

New DPS-inert `ConditionContext` fields (all optional, DPS-safe defaults keep every non-SP-C ship
byte-identical):

| Field | Meaning | DPS default | Engine (positional) |
|---|---|---|---|
| `selfCritPower` | owner effective crit power | already exists (0 default) | already live |
| `targetCritPower` | target's effective crit power | **0** (no enemy crit-power config) | real target actor |
| `selfSpeed` | owner Speed | ship's Speed stat | real owner actor |
| `targetSpeed` | comparison target Speed | configured `enemySpeed` | **min Speed among damaged enemies** (Chakara aggregate) |
| `selfCurrentHp` | owner absolute current HP | ship max HP (full-HP DPS) | real owner `currentHp` |
| `targetCurrentHp` | target absolute current HP | configured `enemyHp` | real target `currentHp` |

### `evaluateCondition` case (`evaluateConditions.ts`)

```ts
case 'stat-vs-target': {
    const self =
        cond.compareStat === 'crit-power' ? (ctx.selfCritPower ?? 0)
      : cond.compareStat === 'speed'      ? (ctx.selfSpeed ?? 0)
      :                                     (ctx.selfCurrentHp ?? 0);
    const target =
        cond.compareStat === 'crit-power' ? (ctx.targetCritPower ?? 0)
      : cond.compareStat === 'speed'      ? (ctx.targetSpeed ?? 0)
      :                                     (ctx.targetCurrentHp ?? 0);
    const met = cond.statComparator === 'lt' ? self < target : self > target;
    return met ? 1 : 0;
}
```
`derivable: true` (a `derivable:false` condition is always met — defeats the gate).

### Parser (`skillTextParser.ts`)

New detector matching the two clause shapes, emitting a `stat-vs-target` condition **only on the
gated half** (respect clause-scoping — the Rikra/Madax/Oleander FP-locks apply):
- "If this Unit has more Crit Power than the target" → `{compareStat:'crit-power', statComparator:'gt'}`
- "If this Unit has more HP than the enemy" → `{compareStat:'hp', statComparator:'gt'}`
- "If all damaged enemies have more Speed than this Unit" → `{compareStat:'speed', statComparator:'lt'}`

### Ships

| Ship | Slot | Condition | Gated ability | Probe today | Strengthen assertion to |
|---|---|---|---|---|---|
| Bayah | charged | `{stat-vs-target, crit-power, gt}` | Stasis inflict | `stasis.conditions.length>0` | `stasis.conditions.some(c=>c.subject==='stat-vs-target' && c.compareStat==='crit-power')` |
| Chakara | active | `{stat-vs-target, speed, lt}` | self-charge-gain | `chargeGain.conditions.some(c=>c.subject!=='always')` | `...c.subject==='stat-vs-target' && c.compareStat==='speed'` |
| Cobalt | active | `{stat-vs-target, hp, gt}` | 25%-max-HP additional-damage | `bonusDamage.conditions.length>0` | `...c.subject==='stat-vs-target' && c.compareStat==='hp'` |

**Team-symmetry:** the comparison is evaluated from the acting unit's context on either side —
verify the engine populates `self*`/`target*` from the acting unit and its target regardless of
which team the unit is on.

---

## SP-D — count-gate primitives

### D1 — hit-count gate (`enemies-hit-this-cast`) — Berserker, Tygr

**Clauses:** Berserker (passive2) "gains Marauder Rage II for 3 turns when hitting 3 ore more
enemies" (CSV typo preserved); Tygr (active) "If it damages 2 or more enemies, it adds 1 charge to
its Charged Skill."

**Type:** add `'enemies-hit-this-cast'` to `ConditionSubject`.

**Context:** new field `enemiesHitThisCast?: number` — DPS default **1** (single-target). Engine
populates the count of enemies that took damage from this cast (multi-hit / splash).

**`evaluateCondition`:** `case 'enemies-hit-this-cast': return ctx.enemiesHitThisCast ?? 1;`
(default 1 so a `gte 2/3` gate is not met in DPS — inert, faithful.)

**Parser:** add hit-count detection (in `classifyChargeCondition` for Tygr's charge half + the
buff-grant condition path for Berserker) matching "damages N or more enemies" / "hitting N or more
enemies" → `{subject:'enemies-hit-this-cast', derivable:true, countComparator:'gte', countThreshold:N}`.
**Removes** Tygr's coarse `enemy-adjacent` classification for this clause (the triage's documented
trivially-true trap).

**Ships / assertions:**
- Berserker — probe `rageBuff.conditions.length>0` → strengthen to
  `rageBuff.conditions.some(c=>c.subject==='enemies-hit-this-cast' && c.countThreshold===3)`.
- Tygr — probe `cond.countThreshold` defined → strengthen to
  `cond.subject==='enemies-hit-this-cast' && cond.countThreshold===2`.

### D2 — DoT-stack-count gate (`enemy-dot-count`) — Anemone, Belladonna

**Clauses:** Anemone (charged) "If the primary enemy has 3 or more Damage over Time effects, this
Unit gains Taunt for 1 turn."; Belladonna (charged) "If the enemy has 3 or more Acidic Decay,
inflict Stasis for 1 turn."

**Type:** add `'enemy-dot-count'` to `ConditionSubject`. Reads per-target DoT ENTRY counts; with a
`buffName` set, counts only that DoT family.

**Context:** `enemy-dot-count` derives from the DoT entry counts already assembled in
`roundContext` (`corrosionEntryCount + infernoEntryCount + bombCount`, +`acidicDecayEntryCount`
once SP-E adds it). Bare subject = sum of all; `buffName` = one family. In the positional engine,
the same per-target DoT entry tally. **No new context primitive needed for the generic case** —
`buildRoundContext` already folds these into `enemyDebuffCount`; expose the DoT-only subtotal (and,
for named filtering, a per-family lookup) so `enemy-dot-count` reads DoT-only (Anemone's "3+ DoT
effects" must NOT count control debuffs — the reason we did not reuse `enemy-debuff`).

**`evaluateCondition`:** returns the DoT entry count (family-filtered when `buffName` is set), so it
works both as a gate (`countComparator`/`countThreshold`) AND as a scaling source (D3).

**Parser:** widen `countGateCondition` (`skillTextParser.ts:764–815`) `kind` regexes to also match
"Damage over Time effect(s)" and named DoT families ("Acidic Decay") → subject `enemy-dot-count`
(carry `buffName` for a named family). Keep the existing buffs?/debuffs? behaviour unchanged.

**Ships / assertions:**
- Anemone — probe `taunt.conditions.some(c=>c.subject!=='self-buff')` → strengthen to
  `...c.subject==='enemy-dot-count' && c.countThreshold===3` (drops the spurious `self-buff` Taunt
  detector artifact for the gate condition).
- Belladonna — probe `stasis.conditions.length>0` → strengthen to
  `...c.subject==='enemy-dot-count' && c.buffName==='Acidic Decay' && c.countThreshold===3`.
  **Runtime-inert until SP-E** (documented; build-output faithful now).

### D3 — per-DoT-entry scaling (`ScalingRule`) — Snakeroot

**Clause (passive2):** "This Unit deals 120% damage for every 4 stacks of damage over time
inflicted on to a single enemy." (Per user: entries, not stacks.)

**Build:** attach a `ScalingRule` to the 120%-damage ability whose `conditionIndex` points at an
`enemy-dot-count` condition (bare, generic DoT), `perUnit = 0.3` (120% per 4 entries = 30%/entry),
no cap unless the clause states one. `scaledBonus` (`evaluateConditions.ts:245`) already multiplies
`evaluateCondition(count) * perUnit` — the `enemy-dot-count` count feeds it directly.

**Parser:** detect "for every N stacks/entries of damage over time" → emit the `enemy-dot-count`
condition + `scaling: {conditionIndex, perUnit: multiplier/N}`.

**Assertion:** probe `dmg.scaling` defined → strengthen to
`dmg.scaling.conditionIndex` points at an `enemy-dot-count` condition (assert
`dmg.conditions[dmg.scaling.conditionIndex].subject === 'enemy-dot-count'`).

---

## PR decomposition (~5 PRs, `C ∥ D`)

| PR | Ships | Kind | Engine work? |
|----|-------|------|--------------|
| PR-C1 | Bayah, Chakara, Cobalt | NEW `stat-vs-target` subject + params + parser + 6 context fields | Yes (populate `self*`/`target*`; Chakara min-speed aggregate) |
| PR-D1 | Berserker, Tygr | NEW `enemies-hit-this-cast` subject + parser + context field | Yes (count damaged enemies this cast) |
| PR-D2 | Anemone, Belladonna | NEW `enemy-dot-count` subject + `countGateCondition` widen | Yes (expose DoT-only subtotal + per-family lookup) |
| PR-D3 | Snakeroot | `ScalingRule` on `enemy-dot-count` (depends on PR-D2's subject) | No (reuses D2 context) |

PR-C1, PR-D1, PR-D2 are mutually independent (different subjects/seams). **PR-D3 depends on PR-D2**
(needs the `enemy-dot-count` subject) — sequence D3 after D2, or fold D3 into D2 if small.

## Test strategy

- Each PR flips exactly its own probe(s) `it.fails` → `it` in `modelCompletenessTriage.test.ts`;
  no other triage probe changes. Strengthen each proxy to the real literal (per the tables above).
- Per-PR gate: full suite MINUS the triage file green, then the triage file's flipped probe passes
  (merge-loop lesson from `project_skill_model_gap_sweep` — CI does not run vitest; husky pre-commit
  does).
- **New engine-derived gates get a team-symmetry assertion** — the ship behaves identically on
  either side (`stat-vs-target` comparison, `enemies-hit-this-cast` count). Follow the E5 heal-lift
  template (`feedback_engine_team_symmetry`).
- **Byte-identical DPS invariant:** new context fields default to DPS-safe values (0 / 1 / full-HP /
  enemy-config); add a regression check that a ship NOT using these subjects produces identical DPS.
- **Belladonna runtime-inert note:** assert build-output only (the count-gate condition is emitted);
  add a comment that runtime firing awaits SP-E's Acidic Decay DoT family.

## Cleanup on completion

- **Allowlist:** remove the SP-C/SP-D rows from `scripts/auditSkills.allowlist.ts` (Bayah,
  Belladonna, Berserker per the reconciliation's close-list; Chakara/Cobalt/Tygr/Anemone/Snakeroot
  if present); add/update audit rules as each PR lands so `audit:skills` stays at 0 findings / 0 stale.
- **Changelog:** add `UNRELEASED_CHANGES` entries in `src/constants/changelog.ts` for the
  user-facing fidelity fixes (Bayah crit-power Stasis gate, Cobalt HP-advantage bonus damage,
  Chakara speed-gated charge, Berserker multi-hit rage, Tygr multi-hit charge, Anemone DoT-count
  Taunt, Belladonna Acidic-Decay-count Stasis, Snakeroot DoT-scaling damage).
- **Docs:** no `DocumentationPage.tsx` change (internal combat-model fidelity, not a new UI feature).

## Risks / watch-items

- **Absolute-HP threading (Cobalt):** ensure `selfCurrentHp`/`targetCurrentHp` are populated with
  absolute HP (not %) at the seam where Cobalt's active-skill condition is evaluated. The DPS
  full-HP assumption means `selfCurrentHp` = ship max HP.
- **`selfCritPower` availability (Bayah):** today `selfCritPower` is populated ONLY by
  `runPlayerTurn`'s `modifierCtx`, 0 elsewhere. Confirm Bayah's Stasis-inflict condition is
  evaluated where `selfCritPower` is live; if not, thread it (or accept the DPS default of
  self>target with target=0 ⇒ met). Verify both DPS and positional paths.
- **Chakara min-speed aggregate:** the engine must compute `min(speed)` over ACTUALLY-DAMAGED
  enemies (not all enemies / not adjacency). Empty damaged-set edge case → gate not met.
- **`enemy-dot-count` must be DoT-ONLY:** Anemone's "3+ DoT effects" must exclude control/marker
  debuffs — do NOT reuse `enemyDebuffCount` (which folds control debuffs). Expose a DoT-only subtotal.
- **`countGateCondition` widen scoping:** matching "Acidic Decay" / "Damage over Time effects" must
  not disturb the existing buffs?/debuffs? matches or the subject-inference (`isEnemy`/`isDebuff`).
- **Snakeroot perUnit:** 120% per 4 entries = 0.3/entry — confirm the multiplier's units match how
  `scaledBonus` applies `perUnit` against the ability's base multiplier elsewhere.
