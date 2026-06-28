# Control Classification Unification — Design

**Date:** 2026-06-28
**Status:** Draft (pre-review)
**Sub-project of:** combat-realism epic (the last unsimulated `AbilityType`, `'control'`)

## 1. Goal

Make the `control` ability type honest end-to-end so it is no longer the lone
entry in `NOT_SIMULATED_TYPES`. Concretely: recognize all four *inflicted
targeting/lockout* control effects (Provoke, Taunt, Concentrate Fire, Disable)
as first-class `type:'control'` abilities — mirroring how Stasis is already
modeled — and make the editor's "Not simulated" badge effect-aware so a control
ability whose combat effect IS simulated stops being mislabeled.

Overload (the fifth `ControlEffect`) is **out of scope** — it is a stacking
self-buff with an unmodeled lifecycle (per-turn grant, lose-on-kill, stat fold,
Marauder-Rage conversion), structurally unrelated to targeting-control, and gets
its own follow-up spec.

## 2. Current state (the key finding)

Control statuses do **not** land via `type:'control'` abilities. They land via
the **named-debuff / named-buff path**:

- A `type:'control'` ability is **event-only**: on the cast path it emits a
  `control-applied` event and does nothing else
  (`src/utils/combat/playerTurn.ts:1270-1290` — *"Emission ONLY — the engine
  does NOT simulate the control's combat effect"*). It never writes a status.
- The actual lockout/targeting comes from a parallel `type:'debuff'` (or
  `'buff'`) ability carrying the buff **name**, applied via
  `statusEngine.applyTimedAbilityStatus` (`playerTurn.ts:965-984`). Enforcement:
  - Stasis/Disable → `isTurnBlocked` reads the named debuff
    (`engine.ts:1781-1786`).
  - Provoke/Taunt/Concentrate Fire → forced-targeting status read in
    `positionalBinding.ts:81-106`.

So **Stasis is double-parsed today**: a `control` ability (event for
`on-stasis-applied` reactions, e.g. Defiant's shield-on-Stasis) *and* a `'Stasis'`
named-debuff (the real lockout). The other four control effects have only the
named-debuff/buff representation.

**Consequence for design:** converting the four effects *away from* the
named-debuff path into control abilities would delete their working application
and break them. The correct move is **additive** — add a control ability that
rides *alongside* the existing named status, exactly as Stasis does. Application
paths stay byte-identical.

**Labeling reality:** because Provoke/Taunt/CF/Disable are already
`type:'debuff'`/`'buff'`, they already render as "simulated" in the editor. The
"Not simulated" badge only fires on `type:'control'` abilities
(`AbilityCard.tsx:766-768`), which today is **Stasis alone** — and Stasis's
effect IS simulated. So the badge is the one concretely-wrong piece today; the
parser extension is about type-system consistency + a reaction substrate for the
other four.

## 3. Scope

**In scope**
- Recognize Provoke, Taunt, Concentrate Fire, Disable as `type:'control'`
  abilities (additive — alongside the existing named status).
- Add `'disable'` to the `ControlEffect` enum + `controlEffectLabel` map.
- Effect-aware "Not simulated" badge.

**Out of scope**
- Overload lifecycle (separate follow-up).
- Per-effect reaction triggers (`on-provoke-applied`, etc.) — **deferred
  (YAGNI)**: zero ships currently react to these applications. Events are
  emitted and available; a trigger can be added per-effect later, mirroring
  `on-stasis-applied`, when a ship needs it.
- Any change to the named-debuff/buff application, landing, resist, Block-Debuff,
  or forced-targeting logic. Those stay byte-identical.

## 4. Design

### 4.1 Parser recognition (`skillTextParser.ts`, `buildShipAbilities.ts`)

Generalize `parseControlInflict` (today: `STASIS_INFLICT_RE`, Stasis-only,
`skillTextParser.ts:1024-1031`) into a small table-driven matcher over the
modeled control effects:

| Effect | Verb pattern (illustrative) | Control-ability target |
|---|---|---|
| stasis | `inflicts/applies … Stasis` | enemy |
| provoke | `inflicts/applies … Provoke` | enemy |
| concentrate-fire | `applies … Concentrate Fire` | enemy |
| disable | `inflicts/applies … Disable` | enemy |
| taunt | `gains … Taunt` (self-grant) | self |

Note Taunt is a **self-grant** ("gains Taunt"), unlike the enemy-inflicted
others — the matcher must handle both the inflict and the self-grant phrasing.
The function returns the matched `ControlEffect` (and, where relevant, its text
position for ordering, as today).

In `buildShipAbilities.ts:987-1015`, the existing control-ability emission block
generalizes to set `target` per the table and `config.effect` to the matched
effect. The parallel named-status ability for the same text continues to be
produced by the generic `parseSkillEffects` path **unchanged** — the control
ability is purely additive output.

### 4.2 Type system (`types/abilities.ts`)

- Add `'disable'` to `ControlEffect`
  (`abilities.ts:537` → `'provoke' | 'taunt' | 'stasis' | 'overload' |
  'concentrate-fire' | 'disable'`).
- Add `disable: 'Disable'` to `CONTROL_EFFECT_LABEL`
  (`src/utils/combat/debuffImmunity.ts:33-40`) so `controlEffectLabel` stays
  total.

### 4.3 Cast-path emission (`playerTurn.ts`)

**No new code.** The emission loop (`playerTurn.ts:1270-1290`) already iterates
`controlAbilitiesFromSkill(gatedSkill)` and emits `control-applied` with
`ctrl.config.effect`, and already routes the Block-Debuff resist through
`controlEffectLabel(effect)`. The new effects flow through unchanged. Emitting
`control-applied` with `effect !== 'stasis'` fires no listener today (only
`on-stasis-applied` gates on `effect === 'stasis'`, `triggers.ts:467-471`) →
**no behavior change, goldens byte-identical**.

### 4.4 Effect-aware sim-coverage (`simCoverage.ts`, `AbilityCard.tsx`)

Replace the blanket `NOT_SIMULATED_TYPES.has('control')` check with an
effect-aware helper. Introduce a `SIMULATED_CONTROL_EFFECTS` set
`{stasis, provoke, taunt, concentrate-fire, disable}` and a predicate, e.g.
`isAbilitySimulated(ability)` that returns:
- for `type:'control'`: `true` iff `config.effect ∈ SIMULATED_CONTROL_EFFECTS`
  (so Overload — not in the set — still reads "not simulated" if it ever gets a
  control ability);
- for every other type: the existing `!NOT_SIMULATED_TYPES.has(type)` semantics.

`AbilityCard.tsx:766-768` consumes the predicate instead of the raw set. Because
all five non-Overload effects are in the simulated set and Stasis is the only
control ability shipped today, the visible effect is: the Stasis control ability
stops showing the false "Not simulated" note.

`NOT_SIMULATED_TYPES` may stay defined (now effectively empty of practical
consequence for control) or be removed once nothing else references it — the
plan resolves this by grepping consumers. The `NOT_SIMULATED_NOTE` text is
retained for the Overload-control future case.

### 4.5 Components & boundaries

- **Parser** (`parseControlInflict`): pure text → `ControlEffect | null` (+
  position). Testable in isolation.
- **Builder** (`buildShipAbilities` control block): `ControlEffect` →
  `Ability{type:'control', target, config.effect}`, additive to the named
  status. Testable via the build fixtures.
- **Sim-coverage predicate** (`simCoverage.ts`): `Ability → boolean`. Pure,
  unit-testable; the React card just renders it.
- **Engine**: unchanged. Consumes named statuses (lockout/targeting) and the
  pre-existing emission loop.

## 5. Testing strategy

- **Parser unit tests:** each effect's phrasing → correct `ControlEffect`;
  Taunt self-grant vs enemy-inflict; non-matching text → `null`; abbreviation /
  sentence-scoping guards consistent with existing parser tests.
- **Builder tests:** a skill inflicting each effect produces BOTH a
  `type:'control'` ability (right `effect`/`target`) AND the unchanged named
  status ability. Assert the named-status ability is byte-identical to today
  (no field drift).
- **Sim-coverage unit tests:** `isAbilitySimulated` true for control abilities
  of the five effects, false for a synthetic Overload control ability, and
  unchanged for all other types.
- **Engine regression:** full `npm test` byte-identical for combat goldens —
  control abilities only emit unconsumed events. Cite that no `.snap` moves.
- **Block-Debuff resist (risk pin, §6):** a test with a Block-Debuff-immune
  target receiving each control effect, asserting the resist event count is
  correct (no double-emit between the control ability and the named status).

## 6. Risks & open questions (resolve in the plan)

1. **Dual-representation Block-Debuff resist.** The control ability emits a
   resist (`emitBlockDebuffResist`) when the target is immune, and the parallel
   named-status path has its own Block-Debuff handling. For Stasis this already
   coexists today — the plan MUST verify (with a test) that adding the four new
   effects does not double-emit `debuff-resisted` / double-count a resist, and
   document the existing Stasis behavior as the baseline.
2. **Parser over-matching.** Generalizing `parseControlInflict` must not
   reclassify text that should remain a plain named-debuff only. The control
   ability is additive, so an over-match produces a spurious *extra* control
   ability (and an unconsumed event), not a broken application — but the plan
   should pin negative cases (e.g. "Provoke" appearing in a condition clause,
   not an application clause) so we don't emit phantom control abilities.
3. **Taunt self-grant detection.** Reuse the existing `detectGrantScope` /
   self-grant machinery rather than a bespoke regex, to stay consistent with how
   `gains <buff>` is parsed elsewhere.
4. **`NOT_SIMULATED_TYPES` removal.** Grep all consumers before deleting; it may
   be referenced by tests or other UI. Prefer keeping the symbol and making the
   predicate the single source of truth if removal is risky.

## 7. Golden discipline

Byte-identical for all combat goldens (no `.snap` movement). The only intended
behavioral deltas are: (a) new `type:'control'` ability outputs in
`buildShipAbilities` (asserted by new tests), and (b) the editor badge no longer
flagging simulated control effects (asserted by new sim-coverage tests). Run the
whole `npm test` suite for the audit; never blind `vitest -u`. `audit:skills`,
`lint`, `tsc` clean.
