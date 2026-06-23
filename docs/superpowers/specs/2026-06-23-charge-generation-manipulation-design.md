# Charge Generation & Manipulation in the Combat Engine

**Date:** 2026-06-23
**Sub-project:** Combat-realism epic (relates to sub-project D — implants + gear-set abilities)
**Status:** Design — approved, pre-spec-review

## Summary

Make **charge** a fully-modelled, two-sided, manipulable resource in the combat engine, then layer four classes of charge mechanics that the engine does not handle today. The DPS calculator converges onto the engine, so all of this flows through the shared ability model rather than a parallel DPS-only path.

The engine **already** simulates both teams banking and firing charged skills (team-agnostic, `+1`/turn baseline cadence via `advanceChargeCadence`), and already has the triggers `on-charged-cast`, `on-bomb-detonated`, `start-of-turn`, `start-of-round`. Implants are already ability-driven (`IMPLANT_ABILITIES[name]` builder, or text-parser fallback). What is missing: charge is **positive-only and self/ally-targeted**, there is **no periodic / every-Nth-turn** mechanism, there is **no per-actor turn counter**, and there is **no `end-of-turn` *AbilityTrigger*** — though the underlying `turn-ended` engine event already exists (`events.ts:39`) and is already emitted once per actor turn (`engine.ts:4584`, symmetric with `turn-started`), so the new trigger rides existing plumbing rather than new emission.

This project adds those primitives once (Phase 0) and builds four features on top, each as its own PR.

### Relationship to the prior DPS spec

`docs/superpowers/specs/2026-05-31-charge-manipulation-design.md` designed charge *generation* for the standalone single-ship **DPS calculator**. It deliberately marked **enemy charge removal, ally-grant-to-others, on-kill, and enemy-repair triggers as out of scope** — a single-ship DPS sim has no enemy charged skill to manipulate and no allies. The combat engine *does* model both teams' charged skills, so this spec brings exactly those punted items into scope. The engine is the convergence target the DPS calc moves onto; the existing `parseChargeGain` / `ChargeGain` machinery and its parser fixtures are reused and extended here, not replaced.

## Decisions (locked with the user)

- **Target scope = the combat engine** (battle sim). The DPS calc should use the engine anyway, so there is no separate DPS-only charge model to build.
- **Charge removal = enemy-target semantics, reusing the existing `charge` ability type.** When a `charge` ability targets an enemy, the engine subtracts (floored at 0). You never gift an enemy charge in-game, so enemy-target unambiguously means removal. No dedicated `charge-remove` type.
- **Periodicity = a composable `every-n-turns` condition**, not a dedicated trigger. The two periodic cases sit on **different turn boundaries** (Chrono Reaver = end-of-turn; "if at full HP" = start-of-turn), so periodicity cannot live inside the trigger.
- **Chrono Reaver fires at end-of-turn** (the unit's own end-of-turn), not start-of-turn.
- **Both the "every second repair" enemy-charge-decrease and the Phase 4 cross-side reactions are fully in scope** (not stretch goals).
- **The standalone `chronoReaver.ts` calc stays as-is for now.** Converging/retiring it once the engine models Chrono Reaver is a follow-up, out of scope here. The engine's result must match it (parity check).

## Phase 0 — Foundation: charge as a signed, two-sided, gateable resource

The shared primitives every later phase builds on. Ships as its own PR.

### Model changes

- `CombatActor` (`src/utils/combat/state.ts`): add
  - `turnsTaken: number` — per-actor own-turn counter, **starts at 0, incremented at turn-start** (before the action). The engine tracks rounds, not per-actor turns, today.
  - `chargeLossImmune: boolean` — blocks enemy-sourced charge removal.
- `AbilityTrigger` (`src/types/abilities.ts`): add `'end-of-turn'` + add it to `LIVE_TRIGGERS`. It **rides the existing `turn-ended` event** — no new event or emission. Implementation = the new union value, the `LIVE_TRIGGERS` entry, and a `case 'end-of-turn'` listener in `registerReactiveListeners` mirroring the existing `start-of-turn`/`turn-started` listener (`triggers.ts:377-384`). Confirm the `turn-ended` emit (`engine.ts:4584`) sits **after** the enemy-turn `advanceChargeCadence` call (`engine.ts:4222`) so end-of-turn intents see post-cadence charge.
- `AbilityTarget` (`Ability.target`, not the `charge` config — the config is `{ type: 'charge'; amount }` with no target): allow charge abilities to carry `'enemy'` / `'all-enemies'` (today only `self` / `ally` / `all-allies` are handled in the charge application paths). No config-shape change.
- New condition: extend **`ConditionSubject`** with `'every-n-turns'`, carrying `period: number` and optional `offset?: number` as new optional fields on the `Condition` object (idiomatic — matches how `hpPercent` / `countThreshold` live as optional fields, not a separate `type`-keyed shape). Evaluated as `turnsTaken % period === (offset ?? 0)` via the existing `evaluateCondition` / `conditionsMet` machinery. **`turnsTaken` must be threaded into the condition context** (`ConditionContext` / `roundContext` / `buildDrainContext`) — today it carries `selfHpPct`, `enemyBuffNames`, etc. but no turn counter — otherwise the condition cannot be evaluated at drain time, which is exactly where Chrono Reaver's end-of-turn intent is gated.

### Engine wiring

- Increment `turnsTaken` exactly once per the actor's own turn. Define ordering so:
  - `start-of-turn` reactive intents fire **before** the action;
  - `end-of-turn` reactive intents fire **after** the action resolves and **after** `advanceChargeCadence`, so an end-of-turn charge proc banks toward future turns rather than the turn just taken.
- Charge application branches by target side. The **enemy-subtract branch lives at exactly two sites**: the cast-path charge step (`playerTurn.ts:1307-1341`) and the reactive executor charge branch (`triggers.ts:1167-1177`) — both currently handle only self/ally/all-allies. `grantAllyCharges` (`engine.ts:1776`) is **ally-only by construction** (loops same-side actors) and will never carry an enemy target, so it is *not* an enemy-subtract site.
  - self / ally / all-allies → `min(charges + amount, chargeCount)` — **unchanged existing behavior**.
  - enemy / all-enemies → `max(0, charges − amount)`, **skipped entirely if the target actor is `chargeLossImmune`**.
- Parse `"immune to charge loss effects"` → sets `chargeLossImmune` on the actor (passive-derived flag).

### Validation guard

The baseline `+1`/turn cadence in `advanceChargeCadence` must **not** be double-counted by explicit charge sources. Explicit charge abilities (Chrono Reaver, skill grants) layer *on top of* the baseline, exactly as the standalone `chronoReaver.ts` models it. Goldens must confirm a ship with no explicit charge sources still advances at exactly `+1`/turn.

### Tests

Unit tests for the `every-n-turns` condition evaluator and the enemy-target charge application (subtract, floor-at-0, immunity skip). A minimal engine golden proving `turnsTaken` increments once per own turn and baseline cadence is unchanged.

## Phase 1 — Enemy charge removal (PR off foundation)

- Parser `parseChargeRemoval`: `"removes N charges from the enemy"`, `"decreases enemy charge"` → `charge` ability, `target: 'enemy'`, `amount: N`, `trigger: 'on-cast'` (fires on the active/charged skill carrying it).
- `"When a bomb explodes on an enemy, removes 2 charges from the enemy's Charged Skill"` → reuses the existing `on-bomb-detonated` trigger, `target: 'enemy'`. (The bomb's adjacent-damage clause, where present, is existing damage-ability territory.)
- `"decrease that enemy's charge by one for every second repair they perform"` → reactive on the existing opposing-scoped `on-enemy-repaired` trigger (`triggers.ts:520-527`, already used by Zosimos), gated to **every 2nd repair** by that enemy. Requires a per-source repair counter with no existing analogue — model it on the existing `IntentExecContext` Map pattern (cf. `oncePerCombatFired` / `oncePerRoundConsumed`, keyed `${ownerId}:${abilityId}`), here keyed `${ownerId}:${abilityId}:${repairerId}` and reset per combat. **This is the gnarliest sub-item** — if the counter design proves disproportionately messy during planning, it splits into its own follow-up PR rather than blocking the rest of Phase 1.
- Immunity: a ship with `"immune to charge loss effects"` is unaffected by any of the above (Phase 0 flag).

### Tests

Goldens: single on-cast removal; removal vs. a `chargeLossImmune` target (no-op); removal flooring at 0; bomb-driven removal; every-2nd-repair removal (1st repair no-op, 2nd repair fires).

## Phase 2 — Implant periodic charge / Chrono Reaver (PR off foundation)

- Add `IMPLANT_ABILITIES['Chrono Reaver']` builder (`src/utils/abilities/buildEquipmentAbilities.ts`) → `trigger: 'end-of-turn'`, `target: 'self'`, `config: { type: 'charge', amount: 1 }`, and an `every-n-turns` condition with `period: 2` (legendary) / `period: 3` (epic), `offset: 0`.
- **Parity check:** the engine's Chrono Reaver behavior must match the standalone `src/utils/calculators/chronoReaver.ts` calc, which procs on `round % 2 === 0` (legendary → rounds 2, 4, 6, …) and `round % 3 === 0` (epic → rounds 3, 6, 9, …), with procs wasted when charge is already full (the `min(.., chargeCount)` cap naturally drops the overflow).

  **Proc-turn alignment (the parity crux).** With `turnsTaken` starting at 0 and incremented at turn-start, by the time the **end-of-turn** intent drains on the actor's Nth turn, `turnsTaken === N` (1-based) — identical to `chronoReaver.ts`'s 1-based `round`. So `turnsTaken % period === 0` (offset 0) reproduces the standalone calc exactly:

  | Own turn N (`turnsTaken`) | 1 | 2 | 3 | 4 | 5 | 6 |
  |---|---|---|---|---|---|---|
  | Legendary `N % 2 === 0` | – | proc | – | proc | – | proc |
  | Epic `N % 3 === 0`       | – | – | proc | – | – | proc |

  This pins the two parity-sensitive decisions: increment at **turn-start** (not turn-end), and **`offset: 0`**. A turn-end increment or a non-zero offset would shift the proc turns and fail parity.

### Tests

Goldens: epic cadence (every 3rd own turn), legendary cadence (every 2nd own turn), proc wasted at full charge, Chrono Reaver stacking with a ship's own charge sources. A parity assertion against `chronoReaver.ts` for a representative `chargesRequired` / rarity matrix.

## Phase 3 — Conditional / periodic self-charge (PR off foundation)

- `"adds 1 charge to its charged skill at the start of the turn if it is at full HP"` → `trigger: 'start-of-turn'`, `target: 'self'`, `config: { type: 'charge', amount: 1 }` + a **reused** `hp-threshold` condition (`hpSubject: 'self'`, `hpComparator: 'above'`, `hpPercent: 99`). Do **not** add a new `hp-full` subject — `hp-threshold` already expresses "at full HP" (YAGNI).
- **Caveat (acknowledge, don't fix):** the engine only threads live `selfHpPct` at drain in healing contexts (defaults to 100 elsewhere / in DPS mode), so a self-HP gate is effectively always-true outside live-HP simulation — the same known limitation as Arcane Siege's `self-shield`. Acceptable for the sim; note it in the test expectations.
- Parser pattern for the start-of-turn + state-gate phrasing.

### Tests

Goldens: full-HP start-of-turn proc; damaged (below max HP) no proc.

## Phase 4 — Reactions to enemy charged-skill use (PR, largely independent of Phase 0)

- **This phase needs a NEW opposing-scoped trigger — `on-charged-cast` cannot be reused.** The existing `on-charged-cast` is **self-scoped** (`triggers.ts:293-300`, fires when `e.actorId === ownerId`, i.e. when *you* cast *your* charged skill). The mechanic here is a unit reacting to an *enemy* casting a charged skill, which is the opposing direction. Add a new trigger (e.g. `on-enemy-charged-cast`) riding the same `skill-fired` event with `slot === 'charged'`, gated by `isOpposing(e.actorId)` — exactly mirroring how `on-enemy-repaired` is opposing-scoped. `registerReactiveListeners` is already team-agnostic via the per-call `isOpposing` predicate (bySide PR2), so the new trigger is symmetric by construction; the historical player-centric routing gap does not apply to this listener-style trigger.
- Parser: `"When an enemy uses their charged skill, this unit purges N buffs / inflicts Block Buff for N turns / deals X% and gains a Shield equal to Y%"` → reaction abilities keyed to the opposing charged cast. The effect ability types (purge, debuff/Block Buff, damage, shield) already exist; this phase adds the trigger keying and the parser, not new effect types.
- Respect any `once per round` limiter present in the text.

### Tests

Goldens: purge-on-enemy-charged; damage+shield-on-enemy-charged; Block-Buff-on-enemy-charged; once-per-round limiting (second enemy charged cast in the same round does not re-fire).

## Cross-cutting concerns

- **Skill/ability editor + DPS:** the new charge `target: 'enemy'` / `'all-enemies'` and the `every-n-turns` condition must be representable in the modal ability editor so auto-filled abilities display and round-trip correctly. Auto-parsing is the primary path; full manual authoring support in the editor is secondary (YAGNI — only enough that the editor does not break on the new shapes).
- **Testing discipline:** parser unit tests + engine golden snapshots per phase. **Never** run `vitest -u` to bless goldens blindly (project rule) — inspect every diff. Dev server runs on `:3000`; use `gh auth switch --user TheSusort` for git/PR ops.
- **Docs/changelog:** add `UNRELEASED_CHANGES` entries (`src/constants/changelog.ts`) for user-visible mechanics — enemy charge drain, Chrono Reaver in the sim, conditional self-charge, reactions to enemy charged skills. Update `DocumentationPage.tsx` if combat-mechanics docs enumerate charge behavior.

## Phase ordering & independence

Phase 0 first — everything else depends on its primitives. Phases 1, 2, 3 each depend only on the foundation and can ship in any order. Phase 4 is largely independent (only `on-charged-cast` cross-side wiring) and could ship first or in parallel. Each phase is its own PR off the foundation branch.

## Risks & open validation points

- **Chrono Reaver engine vs. standalone parity** — the most likely source of subtle mismatch. Controlled by two pinned decisions (Phase 2 table: turn-start increment + `offset: 0`) plus the baseline-cadence double-count guard (Phase 0).
- **Per-source repair counter** (Phase 1, "every second repair") — the trickiest single mechanic; counter pattern named (`${ownerId}:${abilityId}:${repairerId}`), may still split out if messy.
- **Turn-boundary ordering** — `start-of-turn` / `end-of-turn` / `advanceChargeCadence` / `turnsTaken`-increment ordering. Largely settled: `turn-ended` already emits at a fixed point (`engine.ts:4584`); Phase 0 must confirm it sits after the enemy cadence call (`engine.ts:4222`) and pin the turn-start increment. Three later phases depend on this.
- **New `on-enemy-charged-cast` trigger** (Phase 4) — a new opposing-scoped trigger, not a reuse; low risk since `registerReactiveListeners` is already team-agnostic, but it is genuinely new surface.
