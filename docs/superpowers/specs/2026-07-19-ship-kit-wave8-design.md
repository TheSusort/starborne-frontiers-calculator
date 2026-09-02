# Ship Kit Correctness — Wave 8 (mop-up) — Design

Source backlog: `docs/ship-kit-fix-plan.md` Wave 8 + `docs/ship-kit-correctness-ledger.md`.
Predecessors: Waves 1–7 shipped (PRs #259–#268). This is the final mop-up wave.

All findings below were **re-traced against current main `fabeed52`** (post Waves 1–7 and post the
#268 audit-scenario security recalibration). Verdicts are ground-truthed, not inherited from the
original ledger.

## Scope

**14 confirmed fixes** (one PR, subagent-driven, batched by shared root / file). Almost entirely
parser-layer (`skillTextParser.ts` / `buildShipAbilities.ts`); only two findings need a new engine
seam. **Plus:** close one false positive; defer one corpus-inert mechanic.

### Resolved without code
- **Hemlock — Toxic Overflow end-of-round spread** → **FALSE POSITIVE.** The mechanic already
  shipped in Wave 3: `src/constants/toxicOverflow.ts`, engine end-of-round spread at
  `engine.ts:8323-8372` (snapshot holders with Toxic Overflow + ≥1 Corrosion → inflict Corrosion I
  on `adjacentAllyIdsFor(holder)`, remove Toxic Overflow, emit `corrosion-spread`), Hemlock's rider
  heal consumed at `triggers.ts:1011`, tests in `hemlockCorrosionSpreadHeal.test.ts`. The
  `parsedEffects:{}` on the debuff is correct-by-design (engine keys on buff **name**). **Action:**
  mark closed in the fix plan; no code.
- **Meatshield — Protection buff-steal** → **DEFER** (user-approved 2026-07-19). Reproduces
  (charged "steals Protection until 3 stacks" is unparsed; `STEAL_RE` at `skillTextParser.ts:4276`
  explicitly excludes it). A fix needs a new parser shape + dynamic threshold-count model +
  Protection stacking-buff semantics + source resolution + a `statusEngine.steal` variant for named
  stacking buffs. It is corpus-inert (Protection is self-granted across the Meatshield cluster; no
  named source and realistically no other Protection holder to steal from in the sim). **Action:**
  document as a known deferred gap; no code.

## Findings & fixes

Grouped into implementation batches. Each batch is independent; batches touch disjoint parser code
except A (shared root) which is a single task.

### Batch A — `detectGrantScope` adjacent-allies support (Centurion + Lionheart)

Both route an "adjacent allies" grant to `all-allies` because `ALL_ALLIES_RE = /friendly|allies/i`
(`skillTextParser.ts:4942`) matches the "allies" substring inside "adjacent allies", and
`detectGrantScope` (`:5037`) has no `adjacent-allies` return. The `adjacent-allies` `AbilityTarget`
already exists (used by pre-combat-stat HP grants).

- **Lionheart** (low) — Attack Up II (active, on-crit) / Attack Up III (charge, on-crit) granted
  "to all adjacent allies". Trigger already correct; only target is wrong. Add an `adjacent-allies`
  branch to `detectGrantScope` (widen its return union to include `adjacent-allies`), tested before
  the plain `ALL_ALLIES_RE` fallback so "adjacent allies" wins over "allies".
- **Centurion** (med) — charged grants **two** Core Charge I stacks: self ×4 AND "all adjacent
  allies ×2". Today only the self grant survives. Two roots: (1) `detectGrantScope` resolves scope
  from the **first** buff-name occurrence (`resolveBuffClause` + `indexOf`), so one buff granted
  twice can't carry two scopes; (2) `skillBuffAutoFill.ts:71` dedupeKey `${buffName}|${target}|
  ${source}` drops the second. Fix: occurrence-aware scope resolution for a repeated buff name +
  the adjacent-allies branch (shared with Lionheart); confirm the two now-distinct-target abilities
  survive dedup (distinct `target` → distinct key).

### Batch B — trigger / condition gates (isolated parser)

- **Lev** (high) — charged "Crit Power Up II" to all allies "**If a critical hit occurs**" parses
  ungated (`trigger:'on-cast'`, no `self-crit` condition). `detectGrantConditions`' self-crit rule
  (`:1156`, `/critically (?:hits|damag)/`) doesn't match "a critical hit occurs". Fix: add the
  "critical hit occurs" phrasing so the buff emits `conditions:[{subject:'self-crit',
  derivable:true}]` — mirroring the co-located `extend-status` ability which already gates on
  `/critical hit occurs/i` at `buildShipAbilities.ts:1657`. (Lev's extend-debuffs shipped in Wave 4;
  this is the separate co-located gate.)
- **Chimei** (low) — "At the end of the round, non-defender allies below 40% HP are granted
  Stealth" parses `trigger:'on-cast'`. `detectReactiveTrigger` (`:1411`) has a
  `START_OF_ROUND_RE → start-of-round` branch but no end-of-round branch. Add an `END_OF_ROUND_RE`
  branch (constant already exists, used by `detectEndOfRoundPurgeTrigger` `:2207`) →
  `trigger:'end-of-round'` (a valid `AbilityTrigger`, used by Rhodium).

### Batch C — target overrides

- **Selenite** (high) — passive "At the start of the round, the highest attack enemy is applied
  with Concentrate Fire" parses generic `target:'enemy'`. The `enemy-highest-attack` selector
  already exists (`applyAbilities.ts:174`, resolved live; used by `buildEquipmentAbilities.ts`). Add
  a highest-attack target override in the enemy-debuff branch, mirroring the existing
  `parseHighestSpeedEnemyTarget` (`buildShipAbilities.ts:1182`). Trigger (`start-of-round`) already
  correct.
- **Quixilver** (med, surfaced in Wave 2) — passive "…**if** it has shield equal to 100% of its max
  HP, this Unit grants all allies Barrier for 1 hit…" parses `target:'self'`. `stripConditionClauses`
  trailing rule (`:4972`, `/\s+\b(?:when|after|while|if)\b.*$/i`) is lossy: it strips from `if` to
  end-of-string, destroying the "grants all allies Barrier" receiver clause, so `detectGrantScope`
  falls back to `self`. Fix: receiver-aware condition stripping — when a receiver/grant clause
  follows the condition (delimited by a comma), stop the trailing strip at that comma instead of
  consuming to end-of-string. Scope the change so no other ship regresses (the lossy rule is
  documented at `:4970`). The Wave-2 `wave2ParseBugs` B1 test deliberately does **not** assert this
  target — tighten it to `all-allies` once fixed.

### Batch D — Xcellence (two clauses, same ship)

- **active — Stasis dropped** (high) — "Deals 150% damage and Inflicts Speed Down II for 2 turns and
  Stasis for 2 turn". Stasis is **untagged** in the CSV (`Speed Down II` is `<unit-skill>`-wrapped;
  Stasis is bare). `STASIS_INFLICT_RE` (`:1948`) and the debuff-name extractor both require the
  `<unit-skill>` tag. Fix: make the tag optional in `STASIS_INFLICT_RE` (and the corresponding
  debuff-name extraction) so a bare "Stasis for N turn(s)" inflict is recognized. CSV is
  read-only/source-of-truth → parser-side only.
- **passive — on-resist shield-basis damage** (med) — "When an enemy resists a debuff infliction,
  this Unit deals damage equal to 115% of this Unit's current shield." The HP-basis analog
  `parseOnResistHpDamage` (`:428`) hard-codes "of…max hp". Add a shield-basis sibling matching
  "…deals damage equal to N% of this Unit's current shield". The `on-resist` trigger + reactive-
  damage executor already exist end-to-end (Vindicator path: `events.ts:114`, `triggers.ts:759/3085`,
  `engine.ts:4715`). Remove the "deliberately deferred" comment at `:364`.

### Batch E — new self-subject / removal detectors

- **Madax** (high) — passive "…receives 30% more Repairs **and increases that Supporter's Defense by
  20% of this Unit's Defense**" is actively **mis-parsed** as a self-heal
  (`heal / target:self / trigger:on-enemy-destroyed / basis:defense / pct:20`). Root: `HEAL_REPAIR_RE`
  (`:3700`, lazy `[^%.;]*?`) walks past the prose to the `20%`; `resolveHealBasis` reads "of this
  Unit's Defense", `resolveHealTarget` finds no ally keyword → self. Fix: (1) reject this
  "more Repairs and increases that `<role>`'s `<stat>` by N%" shape in the heal walk; (2) add a new
  ally-grant detector emitting a Defense stat-grant to the **adjacent Supporter ally**, modelled on
  `PRE_COMBAT_DONOR_HP_RE` / `PRE_COMBAT_ROLE_GATE_LEADING_RE` (`:4515`/`:4532` — adjacency + role,
  scaled off a caster stat). Correct the stale "deliberately stays unparsed" comment at `:4527`.
- **Wisteria** (high) — passive "This Unit inflicts Inferno II for 2 turns **after applying Corrosion
  with a Critical hit**" is unmodeled (only the co-clause `extend-dot` survives). Add a self-subject
  mirror of `ALLY_CRIT_DOT_RE` / `detectAllyCritDotTrigger` (`:1768`, currently ally-scoped) →
  emit a `dot` ability (Inferno tier II, duration 2) on a self on-crit-after-Corrosion trigger, wired
  in the same `buildShipAbilities` dot-effects branch that consumes `on-ally-crit-dot`.
- **Wusheng** (low) — passive "If directly damaged while Stealth is active, remove Stealth" is
  unmodeled. The `remove-self-buff` machinery exists (`parseSelfBuffRemovals` `:1609` → builder
  `buildShipAbilities.ts:2563`) but doesn't fire: (1) `SELF_BUFF_REMOVAL_ACTIVE_RE` (`:1600`) matches
  only "loses/removes", not the imperative "remove"; (2) `detectRemovalTriggerAt` (`:1565`) has no
  on-attacked branch. Fix: broaden the regex to the bare imperative "remove" + add an on-attacked
  removal-trigger branch mirroring `HEAL_DAMAGE_REACTION_RE`'s "when … directly damaged" phrasing
  (`:3692`), gated on the buff (Stealth) being active.

### Batch F — new engine seams (only two non-parser-only findings)

- **Zeolite** (med) — passive "purges 1 buff from the enemy **when dealing damage to a Defender**".
  The +30% damage gate half shipped in Wave 4; the purge half is deferred (`buildShipAbilities.ts:2294`
  comment; the passive-purge trigger chain at `:2314-2323` has no on-damage-to-Defender detector →
  `trigger` undefined → `continue`). Fix: a new on-damage-to-Defender reactive trigger detector +
  engine support (emit a purge, target=enemy, count=1, gated on the damaged enemy being Defender
  class). Reuse the enemy-type extraction already used by the Wave-4 damage-gate and the
  reactive-purge executor. Team-symmetric.
- **Meiying** (med) — passive "Upon killing an enemy **with a Debuff**, this Unit inflicts Stasis on
  all adjacent enemies for 1 turn". Target scope (`adjacent-enemies`) already fixed in Wave 5; the
  open item is the **kill-gate**: the parse is unconditional `on-enemy-destroyed` with no
  "slain enemy carried a debuff" condition (`KILL_TRIGGER_RE` `:1344` matches "killing an enemy" but
  drops the "with a Debuff" qualifier; no such condition exists anywhere). Fix: a new condition
  inspecting the **victim's debuff set at kill time** (a new event-context field on the
  enemy-destroyed path, analogous to how `victimId` was threaded in Waves 5/7) + gate the Stasis
  infliction on it. Team-symmetric.

### Batch G — Lingshe detonation scaling (parser-only)

- **Lingshe** (med) — passive "This Unit deals 1% more detonation damage per 10% crit power it has".
  The `detonationDamage` `ModifierChannel` is already **fully consumed** by the engine
  (`applyAbilities.ts:77`, `effectiveStats.ts:219`, `detonation.ts:88` / `engine.ts:816`, snapshotted
  onto `PendingBomb` at `playerTurn.ts:822`) but never **produced**. Fix (parser-only): add a clause
  in `parseModifiers` matching "N% more detonation damage per M% crit power" → emit
  `{channel:'detonationDamage', value:0, target:'self', conditions:[{subject:'self-crit-power',
  derivable:true}], scaling:{conditionIndex:0, perUnit:N/M}}`, modelled exactly on the Wildfire
  crit-power `dotDamage` modifier (`buildShipAbilities.ts:557-608`). No cap in the text. (The Wave-7
  stealth-on-detonate trigger is separate/already shipped.)
  - **Known modeling caveat (document, don't fix):** `detonationDamageModifier` is snapshotted at
    bomb-**application** time (applier's value), so Lingshe's crit-power bonus applies to her own
    bombs (applier=detonator) but not to foreign bombs she detonates via countdown-reduce. Mirrors
    the existing Voidfire affinity-snapshot approximation — acceptable; add a code comment.

## Architecture / new surfaces

No new `AbilityType`, `AbilityTarget`, or `ModifierChannel` is introduced — every fix reuses an
existing surface:
- `adjacent-allies`, `enemy-highest-attack` — existing `AbilityTarget` values.
- `end-of-round`, `on-resist` — existing `AbilityTrigger` values with live executors.
- `detonationDamage` — existing, fully-consumed `ModifierChannel` (producer added).
- `dot`, `remove-self-buff`, `purge`, stat-grant/`buff` — existing `AbilityType`s.

Two genuinely-new detector/condition seams (Batch F): the on-damage-to-Defender purge trigger and
the kill-with-debuff victim condition. Both are reactive-trigger additions in the established
pattern (parser detector → condition/event-context field → existing executor), team-symmetric per
`feedback_engine_team_symmetry`.

## Testing

Per-finding **build-level unit tests** (`buildShipAbilities` output assertion) are the primary
acceptance gate — the kit-bundle trace `.md`/`.json` does **not** serialize `conditions`/`scaling`
(Wave-4 lesson), so condition/gate fixes (Lev, Madax, Meiying, Zeolite, Lingshe) must be verified by
direct `buildShipAbilities` inspection, not the forced trace. The two Batch-F engine seams
additionally get `runCombat` integration tests asserting the gated effect fires only under the
condition (and is team-symmetric). Full `npm test` (the golden `audit:skills` spans the whole suite)
after each batch; `npm run lint` is a separate gate from `npm test`.

## Non-goals
- Meatshield Protection buff-steal (deferred, documented above).
- Any new `AbilityType`/`AbilityTarget`/`ModifierChannel`.
- Re-litigating already-shipped Wave 1–7 findings.

## Execution
Single PR, subagent-driven (per prior-wave workflow: worktree implementers, per-task spec+quality
reviews, orchestrator reviews every diff, final whole-branch review, green/rebase/CodeRabbit merge).
Batches A–G are independent tasks; A is a shared-root single task covering Centurion+Lionheart.
