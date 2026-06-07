# Healing-Calc Adoption — Design Spec

**Date:** 2026-06-06 (revised same day at user review gate — see Revision history)
**Status:** Approved by user (brainstorming 2026-06-06; revision approved 2026-06-06)
**Baseline:** PR #86 merged (`ac28430a`). 22 DPS golden snapshots. ~1314 tests / 84 files.
**Origin:** `docs/superpowers/handoffs/2026-06-06-healing-calc-handoff.md`, increment 1.

## Goal

Adopt the healing calculator onto the deterministic combat engine
(`src/utils/combat/`), replacing the standalone expected-value model
(`healingSimulator.ts`, statistical crit) with skill-parsed heal/shield/cleanse
abilities running through the same single-pass engine the DPS calc uses — and
give the healer something real to heal against: a designated **heal target**
under bombardment from a configurable list of **simple enemies** (Phase-4-lite
enemy offense). Effective healing under pressure is the comparison metric; this
separates healer archetypes (raw output vs defensive-buff kits vs shielders vs
HoT sustain). This is the second calculator on the engine, after DPS, on the
road to the full simulator page.

## Decisions made during brainstorming (user-confirmed)

1. **Consumption model: enemy-pressure consumption** *(revised — supersedes the
   initial "raw healing output" decision at the user review gate)*. A
   designated target takes deterministic damage from a simple enemy list each
   round; heals are capped by missing HP (overheal tracked); shields absorb.
   Heals to recipients other than the tracked target remain raw output,
   labeled as such.
2. **Shields: in scope, separate bucket AND absorption.** Parsed and simulated
   alongside heals, reported as a distinct `shield` channel, and consumed as an
   absorption pool on the target (rule below).
3. **Mechanics in scope:** HoT/Repair-Over-Time statuses, reactive heal triggers
   (Pallas/Howler/Valkyrie shapes), cleanse output **count**. **Deferred to
   Phase 4:** revive/Cheat Death (target death is final here), enemy
   skills/DoTs/debuffs, debuff-consumption cleanse modeling, damage-reactive
   shields, whole-team intake.
4. **Page fate: rebuild in the DPS-page image.** One focus healer + skill editor
   + team actors + heal-target slot + enemy list. Legacy multi-healer
   comparison UI and `healingSimulator.ts` / `healingCalculator.ts` /
   `parseSkillHeal` are removed. Saved configs cover the compare workflow.
5. **Architecture: Approach A — one engine pass, separate public adapter.**
   Heal/shield/cleanse consumption + enemy basic attacks inside `runCombat`; a
   new `simulateHealing(HealingSimulationInput) → HealingSimulationResult`
   adapter mirrors `simulateDPS`'s discipline. The DPS public API
   (`DPSSimulationInput`/`DPSSimulationResult`/`RoundData`) is untouched.
6. **Intake model: one selected target ship.** All enemies bombard a single
   designated target (any ship, including the healer itself for self-sustain
   kits). Per-enemy targeting and whole-team AoE are Phase 4.
9. **Enemy depth: basics walk** *(added 2026-06-07)*. Enemy cards carry a ship
   selector; a ship-backed enemy walks its **damage abilities only** —
   active/charged cadence with charge banking, skill multipliers, multi-hit,
   per-hit deterministic crits. Enemy debuffs/DoTs/buffs/heals are skipped
   until Phase 4 (visible as unmodeled in the editor/audit posture). Manual
   flat cards ({attack, crit, critDamage, speed} — one basic attack per turn)
   remain as the fallback for hypothetical enemies.
7. **Death rule: dead is dead; sim continues.** Target HP floors at 0; no
   heals land after death; rounds keep running (charts stay comparable);
   result reports `destroyedRound`. Survival becomes a headline metric.
8. **Shield rule (user-stated game rule): additive pool capped at the ship's
   max HP.** Damage drains shield first, then HP. Pool persists until drained —
   durations in shield texts attach to accompanying buffs, not the shield
   itself (verify on the live checklist).

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
  as `ally`. **Sim routing rule (user-confirmed):** ally-targeted heals —
  including "most missing health" — resolve to the tracked **heal target** (it
  is the damaged one). Self-targeted heals stay on the caster. When the heal
  target IS the healer, both routes land on the same actor.
- **HoT statuses:** "grants Repair Over Time II for 2 turns" already parses as
  a buff ability via the buff-name pipeline. New work is in
  `src/utils/calculators/buffParser.ts`: parse `N% Applying Unit HP%` into a
  new `ParsedBuffEffects.hotPct` key (per stack). Everliving Regeneration needs
  no new parsing (`Incoming Repair` → `incomingHeal` exists).
- **Reactive heal triggers** (trigger pipeline reuse):
  - Pallas "when this unit critically repairs an ally" → new live trigger
    `on-ally-critically-repaired`, fired from the new `heal-performed` event's
    `critHits`. The existing `ally-critically-repaired` ConditionSubject
    **coexists** with the trigger: subject = manual/annotation gate, trigger =
    live firing. Do not collapse them.
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

## Section 2 — Engine: enemy pressure, consumption, adapter

### Enemy model (Phase-4-lite, basics walk)

`HealingSimulationInput.enemies[]`: each enemy mirrors the `TeamActorInput`
shape — `{ stats: { attack, crit, critDamage, speed }, chargeCount?,
startCharged?, shipSkills? }`. Enemies join the round turn queue as real
actors at their speed (the queue machinery exists; enemies already take
turns — that's when DoTs tick). NOTE: the existing enemy turn
(`engine.ts:1094`) only ticks DoT containers today — enemy offense is
**net-new behavior** on that turn path, not reuse of existing enemy-damage
code.

Two enemy flavors, one turn handler:

- **Manual flat card** (no `shipSkills`): one basic attack per turn. Damage =
  the existing attack-vs-defence formula (`calculateDamageReduction`) using
  the **target's current effective defence** (so Defense Up buffs from any
  kit reduce intake — the archetype-comparison motivation). Crit via a
  per-enemy deterministic rate gate (`makeRateGate`), fixed queue order,
  single hit.
- **Ship-backed card** (`shipSkills` present): walks **damage abilities
  only** — active/charged cadence via the existing firing-skill selection and
  charge banking (`CombatActor.charges`/`chargeCount` already exist on every
  actor), skill damage multipliers, multi-hit with per-hit deterministic crit
  draws (`drawHits`), all through the same attack-vs-defence formula against
  the target. Enemy charge cadence mirrors the team-actor block
  (`engine.ts:1042-1050`): +1 charge per turn, fire-and-reset at
  `chargeCount`; bonus/ally charge sources never reach enemies. `startCharged`
  seeds `charges = chargeCount` exactly as for players (`createActor`). This produces **pressure patterns** (charged-nuke spikes vs
  steady chip) — the burst-recovery vs sustain healer separation. Non-damage
  enemy abilities (debuffs, DoTs, buffs, heals, controls) are skipped this
  increment — Phase 4.

Player-side "enemy"-targeted abilities (e.g. the healer's own attack feeding
on-crit heal triggers) route to the **first enemy in input order**; player
damage output is reported nowhere in the healing result (it's not the metric).

### Heal target + consumption

- The **heal target** is a designated team-actor slot (any ship, including the
  healer itself). Its kit walks normally (self-buffs and self-heals count
  toward its survival). Its `currentHp` is live.
- Heals to the target: `effective = min(rawHeal, maxHp − currentHp)`;
  remainder = **overheal**, tracked per round. Dead target (HP 0) receives
  nothing; sim continues; `destroyedRound` reported.
- **Shield pool on the target:** additive, capped at max HP, drains before HP,
  persists until drained (decisions 7–8).
- Heals/shields to recipients other than the tracked target are raw output
  (no HP tracking for them this increment), reported in the raw buckets.
- Real target HP% retro-activates HP-threshold conditions ("below 50% HP"
  gates) for the target's and healer's abilities where the subject is the
  target; `selfHpPct` realism for non-target actors stays Phase 4.

### Per-actor healing map (`src/utils/combat/state.ts`)

```ts
interface ActorHealing {
    directHeal: number;   // heal abilities cast this round (raw, incl. crit blend)
    hotHeal: number;      // Repair Over Time ticks, attributed to the APPLIER
    shield: number;       // shield abilities granted (raw)
    cleanseCount: number; // cleanses cast (count, not amount)
    effectiveHeal: number; // portion of directHeal+hotHeal consumed by the target
    overheal: number;      // portion wasted (target at/near full or dead)
}
```

Mirrors `ActorDamage`; keyed per actor in the round loop exactly like the
`roundDamage` map.

### Consumption math (`src/utils/combat/playerTurn.ts`)

- Heal amount = `casterStat(basis) × pct% × critBlend × (1 + healModifier%) ×
  (1 + outgoingHeal%) × (1 + recipient incomingHeal%)`, summed across
  recipients for `all-allies`.
- Per-hit deterministic crit draws reuse the existing `drawHits`/rate-gate
  machinery; blended multiplier `1 + (critHits/hits) × cd` — **never** the
  legacy statistical `critRate × critDamage` blend. `noCrit` heals skip draws.
- Shield amount = `casterStat(basis) × pct%` only — no crit, no heal-modifier
  channels (**documented assumption**: shields aren't repairs; named line on
  the live-verification checklist).
- Cleanse abilities increment `cleanseCount`.
- `healModifier` joins `ActorStats` (already computed on ships' `final` stats).

### HoT ticking (`src/utils/combat/statusEngine.ts`)

A standing buff with `parsedEffects.hotPct` heals its holder each of the
holder's turns for `applierEffectiveHp × hotPct% × stacks`. Applier context is
resolved at TICK time — the corrosion rule (works when the applier hasn't acted
yet that round). Attribution: HoT healing credits the **applier's** `hotHeal`
(mirrors DoT `sourceId` attribution). HoT healing on the target is subject to
the same effective/overheal split.

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
    healTargetId: string;            // which actor the enemies bombard
    enemies: EnemyActorInput[];      // { stats: {attack, crit, critDamage, speed},
                                     //   chargeCount?, startCharged?, shipSkills? }
                                     // shipSkills → basics walk (damage cadence);
                                     // absent → one basic attack per turn
    // NO enemyDefense/enemyHp for offense math — the dummy enemy the DPS calc
    // attacks is irrelevant here; heal triggers needing an enemy (on-crit
    // attack heals) target the first enemy (or a zero-offense dummy when the
    // enemy list is empty).
}

interface HealingRoundData {
    round: number;
    action: 'active' | 'charged';
    charges: number;
    chargeCount: number;
    didCrit: boolean;
    directHeal: number;          // raw
    hotHeal: number;             // raw
    shield: number;              // raw granted
    cleanseCount: number;
    effectiveHealing: number;    // consumed by the target
    overheal: number;
    incomingDamage: number;      // enemy damage thrown at the target this round
    shieldAbsorbed: number;
    targetHpPct: number;         // ENTERING the round (mirrors enemyHpPct convention)
    targetShieldPool: number;    // ENTERING the round
    totalRoundHealing: number;   // directHeal + hotHeal (raw; shield separate)
    cumulativeHealing: number;
    teamHealing?: number;        // non-focus actors' raw healing; only when team actors exist
    activeSelfBuffs: ActiveBuff[];
    extraTurns?: number;
}

interface HealingSimulationResult {
    rounds: HealingRoundData[];
    summary: {
        totalHealing: number;          // raw
        totalDirectHeal: number;
        totalHotHeal: number;
        totalShield: number;
        totalCleanses: number;
        totalEffectiveHealing: number;
        totalOverheal: number;
        totalShieldAbsorbed: number;
        totalIncomingDamage: number;
        avgHealingPerRound: number;
        destroyedRound?: number;       // present only if the target died
        teamTotalHealing?: number;
    };
}
```

`simulateHealing()` wraps `runCombat` exactly as `simulateDPS` does: focus
actor = the healer; the heal target is one of the player actors; the enemy
list maps to enemy actors. `totalRoundHealing` does NOT fold `shield` in —
shield is its own headline.

### Golden-parity guarantee

Engine-internal healing channels and enemy-offense handling exist on every run
but: DPS runs construct zero-offense enemies and no heal target, so the
extension is inert for damage runs. `simulateDPS`, `DPSSimulationInput/Result`,
`RoundData` are not modified. The 22 DPS golden snapshots must be
**byte-identical**. Zero churn tolerated; any diff is a bug in this increment.

## Section 3 — UI page, testing, cleanup

### Page rebuild (`src/pages/calculators/HealingCalculatorPage.tsx`, same `/healing` route)

Mirrors the DPS page structure:

- Config name + saved configs (same persistence pattern as the DPS page).
- Ship selector modal (focus healer).
- **Heal-target slot**: ship selector for the bombarded target (may equal the
  healer).
- **Enemy attacker cards**: add/remove enemy cards. Each card has a ship
  selector (auto-fills attack/crit/critDamage/speed/chargeCount + parsed
  damage skills for the basics walk) OR manual flat inputs (`attack / crit /
  crit damage / speed` — basic attack per turn). Ship-backed cards surface
  which abilities are walked vs skipped (damage only this increment).
- Skill Editor: heal/shield/cleanse abilities become **editable** —
  `AbilityCard` gains `pct` input + `basis` select for heal/shield and `count`
  input for cleanse (today these types render label-only).
- Team actor slots (team heals/HoTs/triggers contribute `teamHealing`).
- Settings panel: rounds, buffs.
- Results: headline `StatCard`s — effective healing, overheal %, shield
  absorbed, **target survival** ("survived N rounds" / "destroyed round N"),
  team totals. Centerpiece chart: **target HP + shield timeline** with
  incoming damage and healing overlaid per round (`BaseChart`). Cumulative
  effective-healing line for comparison across saved configs.
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
  basis); enemy basic attacks (formula vs target defence, deterministic crit
  gates, queue order); enemy basics walk (charged cadence, multi-hit per-hit
  crits, non-damage abilities skipped); shield pool (additive, max-HP cap,
  drain order);
  overheal split; death semantics (`destroyedRound`, no post-death heals);
  `on-ally-critically-repaired` trigger; adapter shape.
- **New healing golden suite** (`healingGoldenParity.test.ts`): hand-verified
  snapshots — plain heal cadence, charged heal, HoT, reactive trigger, team
  healing, pressure scenario (target damaged, overheal + shield absorption),
  lethal-pressure scenario (target dies), spike-pressure scenario (ship-backed
  enemy with charged nuke cadence). Same referee discipline: regenerate
  only by delete + re-run, never `vitest -u`.
- DPS golden parity: 22 snapshots byte-identical (see Section 2).
- Live verification with the user's 212-ship fleet (dev server :3002) at the
  end — handoff gotchas apply (config-name field is not a search box; Skill
  Editor × deletes abilities; close modals with Escape). **Named checklist
  items:** shields don't crit and ignore heal modifiers; shield pool is
  additive capped at max HP with no expiry.

### Error handling

- Unparseable heal texts emit no ability — audit visibility + manual editor
  fallback (same posture as the DPS parser).
- The adapter applies defaults for missing optional context; empty enemy list
  is valid (degenerates to raw-output reporting: no intake, all heal raw,
  overheal 0 against a full-HP target); no throws.

### Cleanup / docs

- `docs/skill-model-coverage.md`: §5 gains the healing rules block (incl. the
  shield additive-pool rule); §6 items closed/updated (item 6 heal/shield
  consumption ships).
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

- Revive/Cheat Death (target death is final this increment).
- Enemy non-damage abilities — debuffs on the target, enemy self-buffs, enemy
  DoTs/heals/controls — plus per-enemy targeting and whole-team intake
  (Phase 4). Enemy DAMAGE abilities walk this increment (decision 9).
- Real `selfHpPct` for non-target actors (Phase 4).
- Damage-reactive shields ("equal to N% of damage taken") (Phase 4).
- Cleanse debuff-consumption modeling (Phase 4).
- Lowest-HP ally targeting beyond default-to-target routing.
- Healing display on the DPS page / simulator page (own increment).

## Revision history

- **2026-06-06 (initial):** raw-healing-output model approved; spec-reviewer
  approved.
- **2026-06-06 (user review gate):** user requested enemy pressure — heal
  target (ship selector) + simple enemy list (attack/crit/critDamage/speed)
  bombarding it. Decisions 1–2 revised to consumption + absorption; decisions
  6–8 added (single target, dead-is-dead, additive shield pool capped at max
  HP). Result/UI shapes extended accordingly.
- **2026-06-07 (user correction):** ally-targeted heals (incl. "most missing
  health") resolve to the heal target — NOT to self. Self-routing only
  coincides when the heal target is the healer itself.
- **2026-06-07 (user request):** enemies upgraded from flat rows to **enemy
  attacker cards** with ship selector + basics walk (damage abilities only:
  cadence, multipliers, multi-hit, per-hit crits). Decision 9 added; manual
  flat cards remain the fallback. Full enemy kits stay Phase 4.
