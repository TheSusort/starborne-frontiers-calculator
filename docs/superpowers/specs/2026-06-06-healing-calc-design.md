# Healing-Calc Adoption — Design Spec

**Date:** 2026-06-06
**Status:** Approved by user (brainstorming 2026-06-06)
**Baseline:** PR #86 merged (`ac28430a`). 22 DPS golden snapshots. ~1314 tests / 84 files.
**Origin:** `docs/superpowers/handoffs/2026-06-06-healing-calc-handoff.md`, increment 1.

## Goal

Adopt the healing calculator onto the deterministic combat engine
(`src/utils/combat/`), replacing the standalone expected-value model
(`healingSimulator.ts`, statistical crit) with skill-parsed heal/shield/cleanse
abilities running through the same single-pass engine the DPS calc uses. This is
the second calculator on the engine, after DPS, on the road to the full
simulator page (per-round damage/healing/defense per ship).

## Decisions made during brainstorming (user-confirmed)

1. **Consumption model: raw healing output.** Mirror the DPS calc — report total
   healing thrown per round, uncapped. No overheal modeling, no incoming-damage
   stub, no enemy offense. Real consumption arrives with Phase 4.
2. **Shields: in scope, separate bucket.** Parsed and simulated alongside heals,
   reported as a distinct `shield` channel (shields don't benefit from heal
   modifiers — mixing buckets would muddy comparisons).
3. **Mechanics in scope:** HoT/Repair-Over-Time statuses, reactive heal triggers
   (Pallas/Howler/Valkyrie shapes), cleanse output **count**. **Deferred to
   Phase 4:** revive/Cheat Death (6 texts — can't fire without death modeling),
   debuff-consumption cleanse modeling, damage-reactive shields.
4. **Page fate: rebuild in the DPS-page image.** One focus healer + skill editor
   + team actors. Legacy multi-healer comparison UI and `healingSimulator.ts` /
   `healingCalculator.ts` / `parseSkillHeal` are removed. Saved configs cover
   the compare workflow.
5. **Architecture: Approach A — one engine pass, separate public adapter.**
   Heal/shield/cleanse consumption inside `runCombat`; a new
   `simulateHealing(HealingSimulationInput) → HealingSimulationResult` adapter
   mirrors `simulateDPS`'s discipline. The DPS public API
   (`DPSSimulationInput`/`DPSSimulationResult`/`RoundData`) is untouched.

## Game-text reality (from `docs/ship-skills.csv` sweep)

- Heal bases: caster Max HP (dominant: "of its Max HP", "of this Unit's Max
  HP"), caster Attack ("repairs 90% of its Attack"), caster Defense ("an
  additional repair equal to 100% of its Defense"), recipient Max HP (2 texts:
  "of their Max HP").
- Multi-component heals exist ("repairs 5% of its Max HP with an additional
  repair equal to 100% of its Defense") → two heal abilities on one skill.
- Shields phrase identically ("Shield equal to N% of its Max HP/attack"), plus
  damage-reactive shapes ("equal to 25% of the damage taken") that are Phase 4.
- **"Everliving Regeneration" is NOT a HoT** — it's `+20% Incoming Repair, +20
  Security` (an incoming-repair amplifier; `incomingHeal` parsing already
  exists in `buffParser.ts`). The true HoTs are **"Repair Over Time I/II/III"**
  (`10/15/20% Applying Unit HP%` — applier-HP-scaled per tick).
- Heals can crit by default; Pallas's "repair cannot critically hit" already
  parses via `parseNoCrit`'s heal-subject exemption (`NO_CRIT_HEAL_SUBJECTS`).

## Section 1 — Ability model + parser

### AbilityConfig (additive change, `src/types/abilities.ts`)

```ts
| { type: 'heal' | 'shield'; pct: number; basis: 'hp' | 'attack' | 'defense' | 'target-hp' }
```

- Adds `'defense'` and `'target-hp'` to the existing `'hp' | 'attack'` union.
  `'hp'`/`'attack'`/`'defense'` resolve against the **caster's** current
  effective stat at cast time; `'target-hp'` resolves the recipient's max HP
  (engine knows all actors' stats).
- `cleanse` config (`{ count }`) already exists — gains consumption as an
  output count (no debuff-removal modeling).
- Multi-component heals emit multiple heal abilities on the same skill (same
  pattern as damage + secondary).

### Parser (`skillTextParser.ts` → `buildShipAbilities.ts`)

- New heal/shield extraction: `repairs N% of (its|this Unit's) Max HP` → heal
  basis `hp`; `repairs N% of its Attack` → basis `attack`; `… equal to N% of
  its Defense` → basis `defense`; `of their Max HP` → basis `target-hp`;
  `Shield equal to N% of …` → shield ability with the same basis resolution.
- Target routing reuses the existing clause-target resolution: self / "that
  ally" / "the ally" / all allies. "Ally with the most missing health" routes
  as `ally` (with raw output and no damage intake, lowest-HP targeting is
  annotation only).
- **HoT statuses:** "grants Repair Over Time II for 2 turns" already parses as
  a buff ability via the buff-name pipeline. New work is in
  `src/utils/calculators/buffParser.ts`: parse `N% Applying Unit HP%` into a
  new `ParsedBuffEffects.hotPct` key (per stack). Everliving Regeneration needs
  no new parsing (`Incoming Repair` → `incomingHeal` exists).
- **Reactive heal triggers** (trigger pipeline reuse):
  - Pallas "when this unit critically repairs an ally" → new live trigger
    `on-ally-critically-repaired`, fired from the new `heal-performed` event's
    `critHits` (the existing `ally-critically-repaired` ConditionSubject stays
    for manual/annotation use; the trigger makes it live).
  - Howler cleanse-on-ally-crit → rides the existing ally-crit listener seams.
  - Valkyrie heal-on-burst → `on-bomb-detonated` (already live).
- **Disqualify guards** (mirroring `EXTRA_ACTION_DISQUALIFY_RE`): keep
  unparsed — "Shield equal to N% of the damage taken/dealt", "when taking HP
  damage", revive/Cheat Death texts. Add `auditSkills` allowlist entries where
  the audit would otherwise flag them. Both parser and audit must share the
  guard (clause-scoping precedent: [[project-clause-scoping-abbrev-periods]]).
- Crit heals: heals can crit; `noCrit` flows through from `parseNoCrit`'s
  heal-subject exemption.
- Legacy `parseSkillHeal` (flat % for the old page) is deleted with the page.

## Section 2 — Engine consumption + public adapter

### Per-actor healing map (`src/utils/combat/state.ts`)

```ts
interface ActorHealing {
    directHeal: number;   // heal abilities cast this round (incl. crit blend)
    hotHeal: number;      // Repair Over Time ticks, attributed to the APPLIER
    shield: number;       // shield abilities granted
    cleanseCount: number; // cleanses cast (count, not amount)
}
```

Mirrors `ActorDamage`; keyed per actor in the round loop exactly like the
`roundDamage` map.

### Consumption (`src/utils/combat/playerTurn.ts`)

When a firing skill carries heal/shield/cleanse abilities:

- Heal amount = `casterStat(basis) × pct% × critBlend × (1 + healModifier%) ×
  (1 + outgoingHeal%) × (1 + recipient incomingHeal%)`, summed across
  recipients for `all-allies`.
- Per-hit deterministic crit draws reuse the existing `drawHits`/rate-gate
  machinery; blended multiplier `1 + (critHits/hits) × cd` — **never** the
  legacy statistical `critRate × critDamage` blend. `noCrit` heals skip draws.
- Shield amount = `casterStat(basis) × pct%` only — no crit, no heal-modifier
  channels (**documented assumption**: shields aren't repairs; verify in-game
  during live verification).
- Cleanse abilities increment `cleanseCount`.
- `healModifier` joins `ActorStats` (already computed on ships' `final` stats).
- Recipients need no new runtime machinery: with raw output they only matter
  for `incomingHeal` amplification and `target-hp` basis, both resolvable from
  actor stats.

### HoT ticking (`src/utils/combat/statusEngine.ts`)

A standing buff with `parsedEffects.hotPct` heals its holder each of the
holder's turns for `applierEffectiveHp × hotPct% × stacks`. Applier context is
resolved at TICK time — the corrosion rule (works when the applier hasn't acted
yet that round). Attribution: HoT healing credits the **applier's** `hotHeal`
(mirrors DoT `sourceId` attribution).

### Events + triggers (`events.ts`, `triggers.ts`)

- New `heal-performed` event: `casterId`, `targets`, `amount`, `critHits?`
  (additive; optional fields present-only-when-true — `critHits`/`viaCrit`
  precedents).
- New live trigger `on-ally-critically-repaired` (seventh): listeners receive
  `heal-performed` with `critHits ≥ 1` from an ally; executor remains the sole
  mutator; fixed listener order preserved.

### Public adapter (`src/utils/calculators/healingSimulator.ts`, replaced wholesale)

```ts
interface HealingSimulationInput {
    // Healing-native mirror of DPSSimulationInput's discipline:
    // stats (hp/attack/defence/crit/critDamage/healModifier/speed/hacking),
    // chargeCount, startCharged, shipSkills, selfBuffs, teamActors, rounds, bus?
    // NO enemyDefense/enemyHp — the adapter supplies the dummy enemy internally.
}

interface HealingRoundData {
    round: number;
    action: 'active' | 'charged';
    charges: number;
    chargeCount: number;
    didCrit: boolean;
    directHeal: number;
    hotHeal: number;
    shield: number;
    cleanseCount: number;
    totalRoundHealing: number;   // directHeal + hotHeal (shield reported separately)
    cumulativeHealing: number;
    teamHealing?: number;        // non-focus actors' healing; only when team actors exist
    activeSelfBuffs: ActiveBuff[];
    extraTurns?: number;
}

interface HealingSimulationResult {
    rounds: HealingRoundData[];
    summary: {
        totalHealing: number;
        totalDirectHeal: number;
        totalHotHeal: number;
        totalShield: number;
        totalCleanses: number;
        avgHealingPerRound: number;
        teamTotalHealing?: number;
    };
}
```

`simulateHealing()` wraps `runCombat` exactly as `simulateDPS` does: focus
actor = the healer; a dummy enemy supplies cadence/trigger context (on-crit
attack heals etc.). Whether `totalRoundHealing` folds `shield` in is settled
here: it does NOT — shield is its own headline.

### Golden-parity guarantee

Engine-internal healing channels exist on every run but only the healing
adapter reads them. `simulateDPS`, `DPSSimulationInput/Result`, `RoundData` are
not modified. The 22 DPS golden snapshots must be **byte-identical** — the
proof the engine extension is inert for damage runs. Zero churn tolerated; any
diff is a bug in this increment.

## Section 3 — UI page, testing, cleanup

### Page rebuild (`src/pages/calculators/HealingCalculatorPage.tsx`, same `/healing` route)

Mirrors the DPS page structure:

- Config name + saved configs (same persistence pattern as the DPS page).
- Ship selector modal (focus healer).
- Skill Editor: heal/shield/cleanse abilities become **editable** —
  `AbilityCard` gains `pct` input + `basis` select for heal/shield and `count`
  input for cleanse (today these types render label-only).
- Team actor slots (team heals/HoTs/triggers contribute `teamHealing`).
- Settings panel: rounds, buffs.
- Results: summary `StatCard`s per bucket (direct / HoT / shield / cleanse,
  team totals), per-round stacked bar chart over `BaseChart`, cumulative
  healing line.
- Uses existing UI primitives throughout (CLAUDE.md rules; no emojis in UI).

**Deleted:** `HealerConfigCard`, `HealingBubbleChart`,
`HealingComparisonChart`, `HealingRoundChart`, `HealingSettingsPanel`,
`healingSimulator.ts` (legacy content), `healingCalculator.ts`,
`parseSkillHeal`, and their tests. The `HealerConfig` types and any
`buildSkillBuffAutoFill` healing-page-only seams go with them (verify no other
consumers).

### Testing

- Unit: parser heal/shield/cleanse extraction + disqualify guards; `buffParser`
  `hotPct`; engine consumption (crit-heal gates, HoT applier-context ticking,
  `incomingHeal`/`outgoingHeal` channels, all-allies summing, `target-hp`
  basis); `on-ally-critically-repaired` trigger; adapter shape.
- **New healing golden suite** (`healingGoldenParity.test.ts`): hand-verified
  snapshots — plain heal cadence, charged heal, HoT, reactive trigger, team
  healing. Same referee discipline: regenerate only by delete + re-run, never
  `vitest -u`.
- DPS golden parity: 22 snapshots byte-identical (see Section 2).
- Live verification with the user's 212-ship fleet (dev server :3002) at the
  end — handoff gotchas apply (config-name field is not a search box; Skill
  Editor × deletes abilities; close modals with Escape).

### Error handling

- Unparseable heal texts emit no ability — audit visibility + manual editor
  fallback (same posture as the DPS parser).
- The adapter applies defaults for missing optional context; no throws.

### Cleanup / docs

- `docs/skill-model-coverage.md`: §5 gains the healing rules block; §6 items
  closed/updated (item 6 heal/shield consumption ships).
- `src/pages/DocumentationPage.tsx`: healing section rewritten.
- Changelog: ONE evolving healing-calc entry in `UNRELEASED_CHANGES` (separate
  from the DPS entry; fold, don't append).
- Memory (`project_combat_engine_roadmap.md`) + next handoff updated at the end.

## Hard constraints (inherited, restated)

- DPS public API untouched; healing types additive-discipline from day one.
- Zero-RNG determinism: `makeRateGate` accumulators, per-actor gate instances,
  fixed listener/queue/recipient order. No statistical crit anywhere.
- Listeners never mutate state; engine/executor is the sole mutator.
- Engine core never compares the literal `'attacker'` — `focusActorId`/owner ids.
- No RegExp lookbehind in src/ (iOS Safari 15).
- Pre-commit hook runs the full suite; no `--no-verify` for code commits.
- docs/ is gitignored — `git add -f` for spec/plan/handoff/coverage commits.

## Out of scope (deferred)

- Revive/Cheat Death (Phase 4 — needs death modeling).
- Overheal/consumption, incoming-damage stub, real `selfHpPct` (Phase 4).
- Damage-reactive shields ("equal to N% of damage taken") (Phase 4).
- Cleanse debuff-consumption modeling (Phase 4).
- Lowest-HP ally targeting semantics (annotation only until consumption exists).
- Healing display on the DPS page / simulator page (own increment).
