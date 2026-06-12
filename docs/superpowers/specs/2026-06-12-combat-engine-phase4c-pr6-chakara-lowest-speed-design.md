# Combat Engine — Phase 4c PR 6: Chakara lowest-speed buffs

**Status:** Approved (design), pending spec review
**Date:** 2026-06-12
**Branch:** `feat/combat-engine-phase4c-pr6-chakara-lowest-speed`
**Closes:** `docs/skill-model-coverage.md` §6 item 10
**Parent spec:** `docs/superpowers/specs/2026-06-10-combat-engine-phase4c-design.md`

## Problem

Chakara's refit-active (R2) passive reads:

> "This Unit starts each round with **Attack Up II** and **Defense Up II** for 1 turn if it has
> the lowest Speed among all Allies. Then, deals 60% damage to the highest Speed Enemy."

Today the sim emits only the 60%-damage proc. The two self-buffs are **completely invisible**.
Two independent gaps cause this (both verified by probing the live parser, 2026-06-12):

- **Gap A — extraction.** The `"starts each round with <buff>"` phrasing is not recognized as a
  self-grant: `"starts … with"` is not in the parser's application-verb set, so `parseSkillEffects`
  emits zero `SkillEffect`s for the two buffs. (The alternate `"…gains X and Y for 1 turn"` phrasing
  *does* extract both buffs — so this gap is specific to the `"starts … round with"` construct.)
  Additionally, `START_OF_ROUND_RE` only matches `"at the start of (the|each|every) round"`, so even
  the trigger would not be detected for `"starts each round with"`.
- **Gap B — gating.** Even where the buffs *are* extracted (other phrasing), the `"lowest Speed
  among all allies"` condition produces no gate — the buffs apply unconditionally.

Corpus note: `"starts (each|every|the) round with"` is **unique to Chakara** (grep count = 1 over
`docs/ship-skills.csv`), so Gap A's recognizer can be narrow but should be written generically
(match the phrasing, not the ship).

## Goal

Surface Chakara's start-of-round Attack Up II + Defense Up II self-buffs, gated **live** on Chakara
having the lowest Speed among its own (player) team. In single-ship DPS mode the lone attacker is
trivially the slowest, so the buffs apply; in the engine team-walk the gate compares real speeds.

## Design

### 1. New condition subject — `src/types/abilities.ts`

Add `'lowest-speed-ally'` to the `ConditionSubject` union. Semantics: the gate is satisfied when the
condition owner has the minimum Speed among its side's actors (ties → all tied actors qualify).

### 2. Live evaluation — `src/utils/abilities/evaluateConditions.ts`

- Add `isLowestSpeedAlly?: boolean` to `ConditionContext`.
- **Default `true`** when unpopulated. Rationale: a lone actor (single-ship DPS, attacker-only drain
  path) is trivially the slowest on its side; defaulting true preserves DPS-mode behaviour with no
  special-casing and keeps the drain path byte-identical.
- New `evaluateCondition` case: `case 'lowest-speed-ally': return ctx.isLowestSpeedAlly ? 1 : 0;`
  (default-true is applied at context construction / via `?? true` so the field reads as a real
  boolean here).

### 3. Live-subject registration — `src/utils/combat/abilityStatusGating.ts`

Add `'lowest-speed-ally'` to `LIVE_SUBJECTS`. Without this, `liveGateConditions` would neutralize the
derivable condition to `always` (the "ally counts unavailable" legacy path) and the buffs would apply
unconditionally — defeating Gap B. With it, the status-grant path (`engine.ts:173`
`registerActorAbilityStatuses` → `liveGateConditions` → per-round `conditionsMet`) re-evaluates the
gate each round against the owner's live context.

### 4. Engine plumbing — `src/utils/combat/engine.ts` + `triggers.ts`

- Compute **once per combat** the player-side minimum speed and the set of player owner ids whose
  `stats.speed === min` (ties included): `lowestSpeedAllyIds: Set<string>`. Source = the player-side
  runtimes/turn-queue actors (attacker + team ships), each carrying `stats.speed`.
- Add `isLowestSpeedAlly?: boolean` to the `shared` bag of `buildActorConditionContext`
  (`triggers.ts`), threaded into the returned context (via `buildRoundContext`).
- Populate `isLowestSpeedAlly: lowestSpeedAllyIds.has(ownerId)` at the player-actor context build
  sites: the round-1 seed (`engine.ts` ~251) and the player-turn foreign-caster ctx resolver
  (`playerTurn.ts`).
- **Drain path** (`buildDrainContext`): leave unset → default `true`. The drain gate is attacker-only
  and golden-locked; no lowest-speed ability rides a drain-time reactive (Chakara's grant is a
  start-of-round passive), so this is safe and churns no golden.
- **Enemy-walk actors:** Chakara is player-side and no enemy carries a lowest-speed gate; enemy-team
  support is deferred to post-4d. Enemy-actor contexts may leave the field unset (default true) — the
  subject is unused on the enemy side today. (If desired, compute a per-side min symmetrically; not
  required to close item 10.)

### 5. Parser — Gap B gate — `src/utils/skillTextParser.ts` `detectGrantConditions`

Add a rule: a clause matching `"lowest speed among (all) allies"` (case-insensitive, the buff's own
sentence per the existing `resolveBuffClause` scoping) →
`[{ subject: 'lowest-speed-ally', derivable: true }]`. Placed among the other derivable-gate rules;
mutually exclusive with the existing rules by phrasing.

### 6. Parser — Gap A extraction — `src/utils/skillTextParser.ts`

Recognize the `"starts (each|every|the) round with <buff> … for N turns"` self-grant so both buffs
emit as `SkillEffect`s (target `self`, duration N), and map the phrasing to the `start-of-round`
trigger (extend `START_OF_ROUND_RE` or add a sibling recognizer in `detectReactiveTrigger`). The
shared-duration scan already attaches "for 1 turn" to both conjoined buffs once the lead buff is
extracted. Implementation detail (segment-loop verb recognition vs. a supplementary conjoined-grant
pass) is left to the plan; the observable contract is: both buffs emit, `start-of-round` trigger,
`lowest-speed-ally` condition.

### 7. Editor — `src/components/.../AbilityCard.tsx`

Add `'lowest-speed-ally'` to the condition-subject options and a human-readable label (e.g.
"Has lowest Speed among allies") so the auto-parsed gate is visible and manually editable, matching
the editor treatment of the other condition subjects.

## Data flow

```
ship-skills.csv / imported ship text
  → parseSkillEffects (Gap A: extract both buffs, self, duration 1)
  → buildSkillBuffAutoFill → buildShipAbilities
       · detectReactiveTrigger → start-of-round
       · detectGrantConditions (Gap B) → [{subject:'lowest-speed-ally', derivable:true}]
  → engine registerActorAbilityStatuses
       · liveGateConditions keeps 'lowest-speed-ally' (LIVE_SUBJECTS)
       · per round: conditionsMet(conds, ctx) where ctx.isLowestSpeedAlly =
         lowestSpeedAllyIds.has(ownerId)
  → buffs applied (Attack Up II / Defense Up II, 1 turn) only on rounds Chakara is slowest
```

## Testing

- **Parser units** (`skillTextParser.test.ts`):
  - Gap A: `"starts each round with X and Y for 1 turn"` → both buffs, target self, duration 1.
  - Trigger: same phrasing → `start-of-round`.
  - Gap B: `"… if it has the lowest speed among all allies"` →
    `{subject:'lowest-speed-ally', derivable:true}`.
- **buildShipAbilities** (`buildShipAbilities.test.ts`): extend the existing Chakara passive test to
  assert both buff abilities present, each with `trigger: 'start-of-round'` and the
  `lowest-speed-ally` condition, alongside the existing 60%-damage proc.
- **evaluateConditions** unit: `lowest-speed-ally` → 1 when `isLowestSpeedAlly` true / default, 0 when
  false.
- **Engine gating** (new hand-built scenario): a team where Chakara has the lowest speed → buffs apply
  each round; a team where a teammate is slower → buffs gated off. Single attacker → buffs apply.
- **Golden parity:** assert DPS + healing goldens **byte-identical** (synthetic fixtures carry no
  `lowest-speed-ally` gate). Hand-write any new locking scenario; never `vitest -u` existing goldens.

## Risks / notes

- **DPS-mode shift (intended):** Chakara's real-data DPS now includes Attack Up II (+attack) every
  round, since the lone attacker is the slowest. No synthetic golden locks Chakara, so no golden
  churn; verify on the user's real fleet if requested.
- `firstPassiveSkillText` is empty in `ships.ts`; the R2 `secondPassiveSkillText` is the refit-active
  passive (`getShipSkillRows`) — confirmed.
- `ships.ts` uses the numeral form "Attack Up 2"/"Defense Up 2"; `ship-skills.csv` (parser source of
  truth) uses "Attack Up II"/"Defense Up II". Buff-name resolution must canonicalize — verify the
  numeral form resolves (it is template data; imported game text uses Roman numerals).
- **Out of scope (logged for later, per current-state note):** conditional-damage `mapConditionPhrase`
  enemy-buff (parser ~241) and `forEachCondition` (buildShipAbilities ~248) count-scaling sites stay
  `derivable:false` — not part of item 10.

## Workflow

- `gh auth switch --hostname github.com --user TheSusort` before PR/merge ops.
- `docs/` is gitignored → `git add -f` for this spec + the plan; `--no-verify` for docs-only commits.
- Fold the user-facing changelog note into the single evolving DPS/combat `UNRELEASED_CHANGES` entry.
