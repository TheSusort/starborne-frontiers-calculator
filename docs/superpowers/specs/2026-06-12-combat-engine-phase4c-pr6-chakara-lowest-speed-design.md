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

### 2. Live evaluation — `src/utils/abilities/evaluateConditions.ts` + `roundContext.ts`

- Add `isLowestSpeedAlly?: boolean` to `ConditionContext` (`evaluateConditions.ts`).
- New `evaluateCondition` case: `case 'lowest-speed-ally': return ctx.isLowestSpeedAlly ? 1 : 0;`.
- **The default-`true` lives in `buildRoundContext` (`src/utils/abilities/roundContext.ts`)**, which is
  the actual constructor of every `ConditionContext` (`buildActorConditionContext` delegates to it).
  Add the field to `buildRoundContext`'s `state` param and its returned object with a `?? true`
  default. Rationale for default-true: a lone actor (single-ship DPS, attacker-only drain path) is
  trivially the slowest on its side; defaulting true preserves DPS-mode behaviour with no
  special-casing and keeps the drain path byte-identical. All other `buildRoundContext` call sites
  (`playerTurn.ts:841/976/1053/1132`, `NEUTRAL_NAMES_CTX` in `triggers.ts`) correctly inherit
  default-true.

### 3. Live-subject registration — `src/utils/combat/abilityStatusGating.ts`

Add `'lowest-speed-ally'` to `LIVE_SUBJECTS`. Without this, `liveGateConditions` would neutralize the
derivable condition to `always` (the "ally counts unavailable" legacy path) and the buffs would apply
unconditionally — defeating Gap B. With it, the condition survives `liveGateConditions` untouched on
**both** the cast/registration path (`engine.ts:173` `registerActorAbilityStatuses`) and the reactive
executor path (`triggers.ts:747` `executeIntent`), so it is evaluated live each round.

### 3a. CRITICAL — which path actually evaluates Chakara's gate

`start-of-round` is a **LIVE trigger** (`LIVE_TRIGGERS`). After Gap A stamps the buffs with
`trigger: 'start-of-round'`, `partitionReactiveAbilities` (`triggers.ts:111`) routes them into
`reactiveAbilities`, **NOT** `castSkills` — so `registerActorAbilityStatuses` (and therefore the
round-1-only `seedPassiveTimedStatuses` at `engine.ts:1671`, gated by `if (r === 1)`) **never sees
them**. Instead they are enqueued on the `round-started` event (`triggers.ts:282`) and fire **every
round** via `executeIntent`, which evaluates the gate at `triggers.ts:748`:

```
conditionsMet(liveGateConditions(scrubbedConditions), buildDrainContext(ctx, intent.ownerId))
```

**Therefore the live `lowest-speed-ally` value must be supplied to `buildDrainContext`** (the reactive
drain context), NOT to the seed. This is the single gate site that matters for Chakara. (A passive
"gains X for N turns" buff WITHOUT a start-of-round trigger would instead ride the seed path — but no
such lowest-speed ship exists in the corpus, so the seed and the aura foreign-caster context stay at
default-`true`.)

### 4. Engine plumbing — `src/utils/combat/engine.ts` + `triggers.ts`

The gate site is `buildDrainContext` (see §3a). Plumb the live value as a **delegate on
`IntentExecContext`**, mirroring the existing `selfHpPctFor` delegate.

- **Compute the lowest-speed set once** (speeds are static — the sim treats speed as turn ORDER, not a
  mutable per-round stat): among the player-side actors (`runtimesById` values whose
  `actor.side === 'player'`, i.e. attacker + team ships), find `minSpeed = min(actor.stats.speed)` and
  build `lowestSpeedAllyIds: Set<string>` = ids whose `actor.stats.speed === minSpeed` (ties → all
  qualify). Compute this **outside the round loop** (after `runtimesById` is built, ~`engine.ts:1548`).
- **Add a delegate to `IntentExecContext`** (`triggers.ts:419`): `isLowestSpeedAllyFor?: (ownerId:
  string) => boolean`. Provide it at the `IntentExecContext` assembly site inside `drainIntents`
  (`engine.ts:~2046`, alongside `selfHpPctFor`): `isLowestSpeedAllyFor: (ownerId) =>
  lowestSpeedAllyIds.has(ownerId)`. Provide it unconditionally (unlike `selfHpPctFor`, which is
  healing-mode gated) — in DPS mode the lone attacker is the only player id, so the set = `{attacker}`
  and the delegate returns `true` for the attacker → DPS-assumption preserved with no special-casing.
- **`buildDrainContext`** (`triggers.ts:559`): pass `isLowestSpeedAlly: ctx.isLowestSpeedAllyFor?.(ownerId) ?? true`
  into the `buildActorConditionContext` `shared` bag.
- **Add `isLowestSpeedAlly?: boolean` to the `shared` bag** of `buildActorConditionContext`
  (`triggers.ts:517`), forwarded into the `buildRoundContext` call. The `?? true` default lives in
  `buildRoundContext` (§2), so the seed (`engine.ts:251`) and the foreign-caster aura resolver
  (`playerTurn.ts:909`) — which do NOT pass the field — correctly inherit default-`true`.
- **Why the seed / foreign-caster sites are left alone:** Chakara's buff is a reactive start-of-round
  intent (§3a), so it is gated only at `buildDrainContext`. The seed handles passive timed buffs that
  carry NO reactive trigger; the foreign-caster resolver gates auras/accumulators. No corpus
  lowest-speed buff rides either path, so their default-`true` fallback is safe and churns no golden.
- **Enemy-walk actors:** Chakara is player-side and no enemy carries a lowest-speed gate; enemy-team
  support is deferred to post-4d. An enemy owner id is absent from `lowestSpeedAllyIds`, so the
  delegate returns `false` for it — but no enemy ability uses this subject today, so it is inert.

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

### 7. Editor — `src/components/skills/ConditionRow.tsx`

The condition-subject `<Select>` lives in `ConditionRow.tsx` (NOT `AbilityCard.tsx`, which only
renders `<ConditionRow>`). Add `'lowest-speed-ally'` to `SUBJECT_VALUES` and a human-readable label
(e.g. "Has lowest Speed among allies") via `EXTRA_SUBJECT_LABELS` (or `CONDITIONAL_CONDITION_LABELS`
in `src/types/calculator.ts`, which `subjectLabel` also consults) so the auto-parsed gate is visible
and manually editable. `AbilityCard.tsx` needs no change.

## Data flow

```
ship-skills.csv / imported ship text
  → parseSkillEffects (Gap A: extract both buffs, self, duration 1)
  → buildSkillBuffAutoFill → buildShipAbilities
       · detectReactiveTrigger → start-of-round
       · detectGrantConditions (Gap B) → [{subject:'lowest-speed-ally', derivable:true}]
  → engine partitionReactiveAbilities: start-of-round buff → reactiveAbilities (NOT castSkills)
  → enqueued on round-started event → executeIntent EACH round
       · liveGateConditions keeps 'lowest-speed-ally' (LIVE_SUBJECTS)
       · conditionsMet(conds, buildDrainContext(ctx, ownerId)) where
         ctx.isLowestSpeedAllyFor(ownerId) feeds ctx.isLowestSpeedAlly = lowestSpeedAllyIds.has(ownerId)
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
