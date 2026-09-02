# SP-E — DoT Transforms & Conversions (Design)

**Epic:** Model-completeness (ratified 2026-07-05). Predecessors SP-A…D merged.
**Date:** 2026-07-06
**Fidelity target (user-locked):** FULL runtime, both/all ships, team-symmetric — matches how SP-A…D modeled runtime, not build-layer-only.

## Scope

Three ships, two mechanics:

| Ship | Slot | Mechanic |
| --- | --- | --- |
| Voron | passive2 | "When directly damaged, transforms the damage into a Damage over Time effect lasting for 3 turns." (+ SP-A's already-shipped "takes 20% less damage from DoT") |
| Orel | passive2 | "When directly damaged by an enemy affected by Taunt or Provoke, transforms the damage into a DoT effect for 3 turns." (folded into SP-E — identical mechanism, gated on attacker control-debuff) |
| Belladonna | passive2 | "When an ally inflicts Corrosion, chance (1% per 10 Hacking) to convert it into Acidic Decay of the same level. Upon converting, extends the newly applied Acidic Decay 1 turn, chance = crit power." |

**Triage source:** `docs/model-completeness-triage-2026-07-05.md` (SP-E rows). Voron transform + Belladonna conversion are the two ratified SP-E probes; **Orel is folded in** (user decision) as a nearly-free consumer of the same generic-DoT foundation.

**Out of scope (future consumers of the generic-DoT type built here):** Meatshield's "damage from Protection → DoT" (SP-F). The generic DoT type is built reusable so those layer on cheaply later.

**DPS calculator: UNCHANGED.** All three effects are incoming/ally-dependent — inert in single-ship outgoing DPS (no attacker in DPS for Voron/Orel; no ally for Belladonna; none output Acidic Decay except via ally-conversion).

---

## Section 1 — Shared DoT-model foundation (Task E1)

Both mechanics introduce new DoT flavors. Two distinct changes:

### 1a. Acidic Decay = corrosion-type DoT + family tag (NOT a new DoTType)

**User-locked fact:** Acidic Decay is a **corrosion-type** debuff — identical tick formula, and it triggers **every corrosion-type reaction** exactly as plain Corrosion does. The ONLY differences from Corrosion are (a) it is **unremovable** and (b) it carries a distinct **family name** used for counting/display.

- `ActiveDoTStack` gains:
  - `family?: string` — undefined = plain Corrosion; `'Acidic Decay'` for converted stacks.
  - `unremovable?: boolean` — true for Acidic Decay stacks.
- Tick formula: **unchanged** — Acidic Decay stacks are corrosion-type, so they tick via the existing corrosion branch (`stacks × tier/100 × min(HP,500k) × dotMult × affinityMult`). Tiers 3/6/9 already match. No new damage channel, no shield/defense special-case (behaves identically to Corrosion).
- **Counting:** `enemyDotFamilyCounts` (SP-D field) is populated from active corrosion-type DoT stacks keyed by `family` (`'Acidic Decay'`). Populated by the engine each round from live DoT state. This is the **SP-D follow-up** — Belladonna's already-shipped charge-skill "3+ Acidic Decay → Stasis" gate is runtime-inert today because nothing populates the family count; E1 makes it live.
- **Cleanse/purge:** must respect the `unremovable` flag — an Acidic Decay stack survives cleanse/purge that would remove a plain Corrosion. (`'Acidic Decay'` is already in the unremovable-effects list in `cheatDeathBuffs.ts`; wire the DoT-removal path to honor the stack-level flag.)

### 1b. Generic DoT = one new `'generic'` DoTType

Voron/Orel/Meatshield's "transforms the damage into a DoT" names no family. Its tick deals an **absolute captured amount**, unlike every stat-scaled DoT.

- `DoTType` gains `'generic'` (only new member — Acidic Decay does NOT get one).
- `ActiveDoTStack` gains `perTickAmount?: number` (= captured damage / duration). For generic entries the tick damage is `perTickAmount` (× reductions), independent of stats/HP/attack.
- New `genericDoTEntries: ActiveDoTStack[]` set threaded through the round-state DoT pipeline: init, apply, `tickDoTs`, expire, extend (n/a for generic here), display (`EnemyDoTState`), and `enemyDotFamilyCounts` (generic entries count toward the un-named `enemy-dot-count` subject — Anemone's "3+ DoT effects").
- `tickDoTs` `emitTicked`/`credit` callback types generalized from `'corrosion'|'inferno'` to `DoTType`; a new `'generic'` tick branch emits `perTickAmount`.
- New damage-breakdown channel for generic DoT ticks (mirrors `corrosion`/`inferno` in `state.ts`).
- Built **reusable**: Voron+Orel wire it in SP-E (Task E2); Meatshield consumes it in SP-F.

---

## Section 2 — Voron + Orel transform (Task E2)

### Build (parser + buildShipAbilities)

- New AbilityConfig member: `{ type: 'transform-incoming-to-dot'; turns: number }`.
- Ability shape: `trigger: 'on-attacked'`, `target: 'self'` (rides the existing already-wired reactive trigger used by every "when directly damaged" passive — Stalwart counter, Cultivator heal, Purifier cleanse).
- Parser: detect "transforms the damage into a Damage over Time effect (lasting for | for) N turns" → this config, `turns = N`.
- **Voron:** unconditional (fires on any direct hit). `turns = 3`.
- **Orel:** attacker-gated. `turns = 3` (refit-active passive). Add:
  - New `IncomingCondition` literal `'attacker-taunted-or-provoked'`.
  - New `IncomingHitContext` field for the attacker's Taunt/Provoke state.
  - Parse "by an enemy affected by Taunt or Provoke" → attach this incoming condition.

### Runtime (incoming pipeline, team-symmetric)

On a **direct** hit of final HP-damage amount `D` to a victim carrying a `transform-incoming-to-dot` ability whose incoming-condition is met:

1. **Replace the hit** — set the applied direct damage to `0` (the smoothing interpretation: the direct hit is fully avoided this turn).
2. **Append a generic DoT** to the **victim's own** `genericDoTEntries`: `perTickAmount = D / turns`, `remainingRounds = turns`, `sourceId = self`.
3. Guard: **direct intake only** — never transform a DoT tick (no DoT-on-DoT recursion).
4. **Per-hit:** each transformed direct hit appends its own generic entry.

SP-A's shipped Voron reduction (`incoming-reduction`, `scope:'dot'`, `condition:'always'`) then reduces each generic tick by 20% — generalize `incomingDotReductionPct` to accept `'generic'`. This closes the SP-A↔SP-E coupling: Voron's reduction finally has a DoT to reduce.

Team symmetry: identical path whether the victim is player- or enemy-side (bySide engine).

---

## Section 3 — Belladonna conversion (Task E3)

### Build (parser + buildShipAbilities)

- **Widen the `on-ally-debuff-inflicted` build gate** (buildShipAbilities ~L2351, currently hardcoded `target === 'ally' && config.type === 'buff'`, per Oleander's RoT grant) to also route the conversion config (enemy-target), with a **Corrosion name-filter** so it fires ONLY on an ally's Corrosion infliction, not any ally debuff (a bare widening would over-fire).
- Parse two clauses of the passive:
  1. **Conversion** → new AbilityConfig producing `family:'Acidic Decay'`, `trigger:'on-ally-debuff-inflicted'`, Corrosion filter, chance basis = Hacking. Anchor a `buffName`/name of `'Acidic Decay'` on the config (the triage probe finds by `config.buffName === 'Acidic Decay'`).
  2. **Extend** ("extends the newly applied Acidic Decay 1 turn, chance = crit power") → existing `extend-dot` + `scope:'inflicted'` + `chanceFromCritPower:true` (Valerian precedent; the `extendInflictedDoTs` path already exists in `playerTurn.ts`).

### Runtime executor (team-symmetric)

The `on-ally-debuff-inflicted` trigger already fans `dot-applied` from same-side allies (triggers.ts ~L397). On that event where the applied DoT is corrosion-type from a same-side ally:

1. **Deterministic gate** at `rate = min(1, hacking / 1000)` (1% per 10 Hacking) — new hacking-based `RateGate`, following the existing `debuffLandingGate`/`extendChanceGate` deterministic-gate pattern.
2. On fire: **retag** the Corrosion entries the ally just applied on the target → `family:'Acidic Decay'`, `unremovable:true`, same tier ("of the same level"). Stays corrosion-type.
3. Run the **`extend-dot`** step against those newly-converted entries at `critPowerFactor` (`chanceFromCritPower` path).

Team symmetry: if Belladonna is enemy-side, an enemy ally's Corrosion on a player ship converts to Acidic Decay on that player ship.

---

## Section 4 — Tests, allowlist, decomposition

### Tests
- Flip the two SP-E `it.fails` → `it` in `modelCompletenessTriage.test.ts`, strengthen from proxies to real literals (Voron: config type + `perTickAmount` presence; Belladonna: `trigger === 'on-ally-debuff-inflicted'`).
- Add an **Orel** probe (transform config, `on-attacked`/self, `attacker-taunted-or-provoked` condition).
- **SP-D follow-up assertions:** `enemyDotFamilyCounts['Acidic Decay']` is populated at runtime; assert `countGateCondition`'s emitted key === the populated key (else Belladonna's charge gate stays inert forever).
- **Team-symmetry integration tests** for all three ships (victim/ally on either side).
- **Cleanse-respects-unremovable** test: cleanse/purge does not remove an Acidic Decay stack.
- Voron runtime: a transformed hit deals 0 direct + D/3 per generic tick × 3, with SP-A's 20% reduction applied.
- Full-suite-minus-triage green per task; whole suite green before merge.

### Allowlist
- Close Voron and Belladonna entries in `scripts/auditSkills.allowlist.ts`.
- Orel: close its entry if present; add a row + close if it's a newly-discovered gap (like Meatshield was). Audit → 0 findings / 0 stale.

### Decomposition
- **One branch, sequential subagent tasks** (all touch the shared DoT pipeline → parallel worktrees would conflict), **one squashed PR** — matches the SP-C+D pattern (`#235`).
- Task order (each depends on the prior):
  - **E1** — DoT-model foundation: `'generic'` DoTType, `perTickAmount`, Acidic Decay family + unremovable, `genericDoTEntries` pipeline, `enemyDotFamilyCounts` population + SP-D key-match, cleanse-respects-unremovable.
  - **E2** — Voron + Orel transform: config + parser + `IncomingCondition`, incoming-pipeline transform, generalize `incomingDotReductionPct` to `'generic'`.
  - **E3** — Belladonna conversion: gate widening + Corrosion filter, parser (conversion + extend), hacking `RateGate`, retag-and-extend executor.
- Each task OPUS-reviewed; clean whole-branch OPUS review before merge.
- Changelog entry (`UNRELEASED_CHANGES` in `src/constants/changelog.ts`) — user-facing: Voron/Orel damage-smoothing DoT, Belladonna Corrosion→Acidic Decay conversion now modeled, Belladonna's "3+ Acidic Decay → Stasis" charge gate now live.

### Merge-loop reminders (from prior SPs)
- `gh pr merge` needs `gh auth switch --user TheSusort`.
- CI does NOT run vitest (husky pre-commit does) — per-task full-suite-minus-triage gate locally.
- Resolve merge conflicts with `git add <paths>`, never `git add -A` (sweeps untracked files).
- Copy the main repo's `.env` into any fresh worktree before running the full suite (else ~14 `.tsx` collection failures).
