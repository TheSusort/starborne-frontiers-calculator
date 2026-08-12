# SP-3 — Healing calculator: real positional enemy + positional heals

**Date:** 2026-08-12
**Epic:** `docs/superpowers/specs/2026-08-11-dps-real-enemy-and-buff-timeline-epic-design.md`
**Predecessors:** SP-1 (#317) + residuals (#318), SP-2 (#319)
**Base:** `b046e6db` on `main`
**Successor:** SP-4 — retire the dummy and the non-positional code paths

---

## 1. Why this exists

The epic's end-goal, ruled by the owner on 2026-08-11: **simplify the engine so there are no dummy
ships and everything is positional.** SP-1 stopped the DPS calculator exercising the dummy. The
healing calculator is the **last production caller** that still does. Once SP-3 lands, SP-4 can
delete the ~25 `isDummyEnemy` / `dpsEnemyTarget` / `dummyEnemyIsVestigial` branches and the
`!positional` credit forks.

**Standing rule for the whole epic: no new dummy branches.** If a task seems to need one, the
ordering is wrong, not the branch warranted.

### The blocker F7 named, and why it dissolves

SP-F F7 found `healingEngineAdapter`'s dummy **independently load-bearing**: a healer casting
`damage` at `target:'enemy'` lands on the dummy and is computed against `ENEMY_DEFENSE`, and that
number feeds `basis:'damage-dealt'` heal/shield riders, which are real `simulateHealing` outputs
(`healingEngineAdapter.ts:176-184`).

That finding was **conditional in exactly the way SP-1's props were**: the rider needs *a real
victim*, and it has none only because the run is non-positional. Give the healing calculator a
positioned enemy roster and the rider bases off a real ship's defence. Generalising the epic's own
lesson: *"cannot remove X" is usually "cannot remove X while Y exists."*

---

## 2. Locked decisions (owner, 2026-08-12)

1. **Fully positional, both directions.** Enemies get positions, parsed targets and patterns and
   resolve their attacks by position, exactly as SP-1's DPS enemy does. The healer's cast resolves
   onto real positioned enemies.
2. **No front bias for the heal target.** It gets a neutral default slot like every other player
   ship. Accepted consequences, stated explicitly:
   - A saved healing page may measure **~0 incoming damage** until its ships are placed.
   - Enemies can be killed mid-window, so **incoming pressure falls over the run**.
3. **Enemies use real HP/defence and can die.** From the ship template when a ship is picked;
   for manual entry, **`hp: 40000` / `defence: 5000`** — the heal target panel's own defaults
   (`HealingCalculatorPage.tsx:143-144`), so both sides start symmetric. Both editable. Today's
   dummy scalars (`ENEMY_DEFENSE = 10000`, `ENEMY_HP = 1_000_000`, `ENEMY_SECURITY = 100`,
   `healingEngineAdapter.ts:182-184`) are deleted, not defaulted to.
   ⚠️ An enemy HP default of 0 would make every enemy die on round 1 — the manual default must be
   non-zero, unlike the heal target's `baseStats` fallback which is legitimately `hp: 0` because
   `target.hp` always overrides it.
4. **Real skill patterns drive both offence and heals.** Targeting comes from the healer's (and
   every actor's) own parsed skill targeting, not a synthetic single-target fallback.
5. **Report gains a recipient axis.** Every ally gets its own `effectiveHeal` / `overheal` /
   HP% / shield numbers; the configured heal target remains the **primary charted row**, with the
   rest available as a per-ally breakdown plus a team total.
6. **Placement via slot dropdowns, both sides placeable**, with assigned defaults the user can
   change. Consistent with SP-1/SP-2's explicit non-goal ("placement is chosen through slot
   dropdowns, not a board").
7. **Heals go by targeting pattern — never by lowest HP** (owner, 2026-08-12). Volk is the *only*
   ship in the game that repairs the lowest-HP ally, and that is its **passive**, not a pattern
   effect — already handled and already correct (`playerTurn.ts:1139-1143`, user-verified
   2026-07-31). **Therefore the healing calculator must NOT adopt the `teamBattle` →
   `lowestHpAllyId` branch** (`playerTurn.ts:3350`). See §3.1 — this is the sharpest constraint in
   the sub-project.

   **Corpus evidence (measured, `docs/ship-targeting.csv`): all 24 ally/self-targeted skills carry a
   `Support` pattern — zero exceptions.** Every ally cast therefore resolves a real footprint via
   `modifiers.support` (`targetingParser.ts:185`), anchored on the caster's own cell
   (`selectTargets.ts:36`). There is **no "single-target ally heal" selection rule to invent**: the
   pattern is the whole answer. Observed ally patterns include `Pattern-Base`,
   `Pattern-Circle-Support-Range-1`, `Pattern-Cone-Support-Range-1`, `Pattern-Support-All`,
   `Pattern-Wings-Support-Not-Self-Range-2` and `Pattern-Line-Support-whole-lane`.

---

## 3. What already exists — do not rebuild

This is the load-bearing part of the design. Most of "positional heals" is **already implemented**;
the healing calculator simply never activates it because it has no positions.

| Capability | Where | Status |
| --- | --- | --- |
| Cast's ally recipients narrowed by support footprint | `playerTurn.ts:1133-1152` (`supportRecipients` / `resolveSupportRecipients`) | ✅ built; honours `chargedPattern ?? activePattern` and `patternScoped` passives |
| Ally footprint expansion | `supportFootprint.ts:12-20` (`supportFootprintAllyIds`) | ✅ built; **returns `undefined` when `anchor === undefined`** → callers keep legacy team-wide behaviour. This single line is why the healing calc is non-positional today. |
| Ally cast anchoring | `selectTargets.ts:36` — ally targets anchor on the caster's own cell | ✅ built; **no ally selection rules need inventing** |
| Per-victim heal / shield application | `engine.ts:2975` `applyHealToTarget(raw, victim = healTarget)`, `:2991` `grantShieldToTarget(raw, victim = healTarget)` | ✅ already parametrized by E2 |
| Per-victim standing leech | `engine.ts` `procStandingLeechesForVictim` (E2 Task 3) | ✅ built; the positional counterpart to the hard-routed path |
| Enemy positions / targets / patterns on the engine input | `engine.ts:1884-1891` (`enemyTargetById`, `enemyPatternById`) | ✅ built; populated **only** from explicit `e.target` — never derived from `shipSkills` |
| Real per-ship parsed targeting | `parseShipTargeting` (`targetingParser.ts:221`), threaded per actor in `battleSimulator.ts:744-772, 919-926, 988-994, 1048-1054` | ✅ built — **this is the template to follow** |
| `TeamActorInput.position` | `types/calculator.ts:373` | ✅ exists already |
| Default-slot / collision helpers | `dpsEnemyPlacement.ts` (`defaultTeamSlot`, `resolvePlayerSlots`, `ATTACKER_SLOT_OPTIONS`) | ✅ built by SP-1, reusable as-is |

**Consequence:** the `'ally' → [healTarget!.id]` hard-route at `engine.ts:3494` and
`procStandingLeeches`'s `rid === healTarget.id` pool gate live on the **non-positional** path the
healing calculator stops using. They are **not** removed by SP-3 — the battle sim and legacy
fixtures still reach them. SP-4 decides their fate.

### 3.1 The sharpest constraint: `teamBattle` conflates two behaviours

Per-recipient heal application **already exists** — `playerTurn.ts:3628-3642`:

```
const perRecipientActor = healing.teamBattle ? healing.recipientActor(rid) : undefined;
if (perRecipientActor || rid === healing.targetId) {
    const { consumed, overheal } = healing.applyHealToTarget(raw, perRecipientActor);
    ...
}
```

and `healPerTarget` already carries `{ targetId, amount, overheal?, didCrit? }` per recipient
(`:3645-3652`). So an AoE heal restoring every ally's real HP is shipped behaviour.

**But the same `healing.teamBattle` flag also switches single-`ally` routing to
`lowestHpAllyId(healing.playerIds)` (`:3350`)** — which decision 7 forbids. The two behaviours ride
one flag:

| Behaviour gated on `teamBattle` | SP-3 wants it? |
| --- | --- |
| Apply heals to **each recipient's own actor** (`:3628`) | ✅ yes |
| Route a single-`ally` heal to the **lowest-HP ally** (`:3350`) | ❌ **no** — not the game's rule |

**So PR 3a's real job is to separate them**: introduce a narrower signal for per-recipient
application that does **not** drag lowest-HP routing along. Do **not** set
`input.positionalTeamBattle` from the healing adapter — it is documented as "NOT the healing
calculator" (`engine.ts:1203-1207`) precisely because of this conflation.

⚠️ **Fence the new gate in BOTH directions** (the #318 lesson): too strict and per-recipient
application never activates for the healing calc; too loose and either the battle sim's routing
changes or the healing calc starts picking lowest-HP targets. Only a test pair proves the signal is
the narrowest correct one — the widened side alone proves nothing about strictness.

**Out of scope, but recorded:** the `teamBattle` → `lowestHpAllyId` branch applies lowest-HP routing
to *every* player single-`ally` heal in the battle sim, while decision 7 says only Volk's passive
should behave that way. That looks like a latent battle-sim defect. **SP-3 does not touch it** —
changing it would move sim goldens for reasons unrelated to this sub-project. File it as follow-up
work.

### 3.2 Findings earned during PR 3a — read before starting 3b

**A single-`ally` heal can now be filtered to EMPTY — ✅ WORKING AS INTENDED (owner, 2026-08-12).**
`resolveSupportRecipients` (`supportRecipients.ts:15-19`) **filters** `baseRecipients` by the footprint
and never expands it, and `recipientsFor` (`playerTurn.ts:3346-3357`) builds that base as
`[healing.targetId]` for a single-`ally` heal. So once the run is positional, if the configured heal
target stands OFF the caster's support footprint, the heal reaches **nobody at all**. Previously inert,
because with no positions `footprintAllyIdsFor` returns `undefined` and the filter is skipped.

**This is game-faithful and must NOT be softened.** Do not add a fallback recipient, do not widen the
filter, do not "rescue" an off-footprint heal target. The zero is correct.

**Instead, the UI must make it visible (owner ruling — decision 8):**

8. **Warn on placement not supported by the chosen supporters.** When an ally — the heal target
   especially — stands on a cell no chosen supporter's footprint covers, the placement UI must say so.
   A silent zero is the failure mode being designed against, not the zero itself.
   Belongs in **PR 3c** alongside the slot dropdowns.

9. **Autoplace the heal target into a supported cell** (owner, tentative — "might want to"). Seed its
   default slot so it starts covered by the chosen supporters' footprints rather than at an arbitrary
   neutral cell.
   **This does NOT contradict decision 2's "no front bias"**: that ruling was about not biasing the heal
   target toward *enemy fire* (column 4). Biasing toward *ally support coverage* is an independent axis,
   so both hold simultaneously.
   ⚠️ Design note: coverage is circular — each supporter's footprint depends on where that supporter
   stands, which the user also controls. Compute against the supporters' current/default slots, and
   handle an EMPTY intersection (no cell covered by all) by maximising the number of covering
   supporters rather than failing.

   **SCOPE RULED (owner, 2026-08-12): minimal now, full version later.**
   - **In SP-3 (Task 5 seeding + Task 8 wiring):** seed the heal target into a cell covered by the
     **HEALER's own** default footprint. Nearly free — the healer's slot and parsed pattern are both
     already known at seeding time. Fixes the common single-healer case.
   - **Deferred to a follow-up:** the full multi-supporter footprint intersection, including
     re-seeding when any supporter moves or is added. Revisit once decision 8's warning is live and
     it is clear how often the uncovered case actually arises.
   - Decision 8's warning is the safety net for everything minimal autoplace misses, which is why
     shipping the warning matters more than shipping full autoplacement.

**Multi-ally pattern healing comes ONLY from `all-allies` abilities** — a single-`ally` ability has
exactly one base recipient, so the pattern can only remove it, never spread it.

**Per-recipient application covers ONE of four apply sites.** `triggers.ts:3433` (reactive /
on-destroyed heals), `playerTurn.ts:3465` (HoT ticks) and `engine.ts:3532` (`procStandingLeeches`)
all still apply only when `rid === healing.targetId` and ignore `perRecipientApply`. PR 3a keeps exact
parity with the battle sim, which has the identical gap, so this is correctly scoped — **but after 3b a
HoT or reactive heal aimed at an ally still restores nothing on that ally while the source axis credits
its gross amount.** PR 3c must not promise a complete per-ally picture. Likewise **shields, HoT ticks,
leeches and reactive heals are not on the `perRecipient` axis** — only direct cast repairs are.
⚠️ If shields are ever added to the axis, the grant site (`playerTurn.ts:3730-3738`) has **no flag
gate** — it routes per-recipient unconditionally — so the credit **must** be gated on
`perRecipientApply`, or the map becomes non-empty on legacy runs and the byte-identical guarantee dies.

**PR 3b needs a FOURTH allowed golden cause.** Beyond *enemy now acts* / *enemy can die* / *heals now
land on a footprint*: flipping the flag makes each ally's clipped over-repair appear on
`heal-performed.perTarget[].overheal` → `overhealByAlly` (`triggers.ts:696-709`), which fans **new
per-ally Abundant Renewal shield grants** (`triggers.ts:3375-3383`). Expected, not defects.

**PR 3b must repoint the summary, not merely accept the movement.**
`healingEngineAdapter.ts:278-284` derives `effectiveHealing` / `overheal` from
`perActor.get(FOCUS_ID)` — the SOURCE axis. With the flag on, that bucket starts including repairs
that landed on other allies, so the reported "effective healing" silently changes meaning from *onto
the tank* to *onto anyone*. Task 7 must read the heal target's row from
`perRecipient.get(healTargetId)`. This is precisely why the axis was added.

**Expect large healing-golden movement in 3b from the flag ALONE.** With no positions wired yet,
`footprintAllyIdsFor` returns `undefined`, so an `all-allies` heal is unfiltered and lands on every
ally. PR 3a's zero-movement gate proves additivity but says nothing about blast radius, because no
production caller sets the flag.

**Accepted spec deviation:** the recipient axis is NOT behind a separate opt-in collector flag (SP-2's
`collectStatusTimeline` pattern, as §5 PR 3a proposed). It rides `perRecipientApply`, so the battle sim
populates it too. Harmless — nothing reads it and the legacy emptiness invariant still holds — and
simpler than a second flag.

### The one genuinely new engine piece

The healing report is keyed by **source**, not recipient:

- `credit(sourceId, bucket, amount)` — `engine.ts:2961`
- `ActorHealing` has no recipient dimension — `state.ts:38-45`
- `effectiveHeal` / `overheal` are credited **only when `rid === healTarget.id`** —
  `engine.ts:3502-3509`, `:3594-3598`

Decision 5's per-recipient breakdown requires adding that axis.

⚠️ **The battle sim also runs in healing mode.** `healTarget = explicitHealTarget ?? (input.positionalTeamBattle ? attacker : undefined)` and `healingMode = !!healTarget`
(`engine.ts:2280-2281`). So a non-additive change to the healing credit map moves **simulateBattle**
goldens too. The axis must be added alongside the existing buckets, never in place of them.

⚠️ **`healTargetId` must survive.** Beyond reporting it is the mode anchor (`healingMode = !!healTarget`) and the read for "below X% HP" condition gates (`engine.ts:2790-2797` — `selfHpPctFor` reads
`healTarget.currentHp`). SP-3 changes where heals *apply*, not whether a heal target exists.

---

## 4. Approach

**Reuse the existing primitives; add only the recipient axis.**

Rejected alternatives:

- **Extend `resolvePositionalTarget` to handle the ally side.** Wrong layer. It returns a *single*
  actor where heals need a *footprint*, and its stealth / taunt / provoke / concentrate logic is
  enemy-targeting semantics that do not apply to allies. It returns `null` for
  `target.side === 'ally'` deliberately (`positionalBinding.ts:65-68`).
- **A new dedicated heal-footprint resolver.** Duplicates `supportFootprintAllyIds` and invites the
  two to diverge — the defect shape this codebase has paid for repeatedly.

**Targeting follows `battleSimulator`, not `dpsSimulator`.** The DPS calculator supplies *no* parsed
targeting and relies on `dpsSimulator`'s synthetic `DEFAULT_FRONT_ENEMY_TARGET` /
`DEFAULT_BASE_PATTERN`. Decision 4 wants real patterns, so `parseShipTargeting` +
`withStealthBypass` per actor is the model.

**The synthetic fallback is retained for kitless actors.** A manual-entry actor, or a ship whose
targeting columns are empty, yields no `SkillTargeting` from `parseShipTargeting` (it requires both
`activeTarget` and `activePattern`, `targetingParser.ts:229`). Without a fallback such an actor has
no `ParsedTarget`, and `selectTurnTarget` falls back to `legacyVictim` — **the dummy** — which would
leave SP-4 blocked. So: real targeting when available, synthetic `front enemy` + `base|0` otherwise.

⚠️ `DEFAULT_BASE_PATTERN.range` **must be 0**. `patternSignature` builds `"base|0|"`, whose offset
table is `[ORIGIN]`; `"base|1|"` has no table and `resolveCells` throws (SP-1's earned lesson).

---

## 5. Decomposition — three PRs

### PR 3a — engine: split the gate, add the additive recipient axis

Two things, both additive:

1. **Separate per-recipient application from lowest-HP routing** (§3.1). A new narrow signal drives
   `perRecipientActor` (`playerTurn.ts:3628`) without touching the `lowestHpAllyId` branch
   (`:3350`). `positionalTeamBattle` keeps implying both, so the battle sim is unchanged.
2. **Recipient-keyed healing aggregate** alongside the source-keyed one, behind an opt-in collector
   flag (SP-2's `collectStatusTimeline` pattern). `ActorHealing` / `currentRoundHealing` stay
   source-keyed and untouched; the new axis is credited where heals and shields actually land.
   `healPerTarget` (`:3645`) already carries the per-recipient amounts — prefer aggregating from it
   over re-deriving.

No adapter change in this PR — the healing calculator is still non-positional here, which is exactly
what makes the zero-movement gate meaningful.

**Gate: ZERO golden and ZERO `.snap` movement.** That is not a convenience, it *is* the proof the
axis is additive and that `simulateBattle` is unaffected.

### PR 3b — adapter: the positional healing run

- Thread `position` for the healer (focus), heal target, team ships and enemies. Default slots via
  `defaultTeamSlot`; collisions resolved by `resolvePlayerSlots`.
- Thread real targeting via `parseShipTargeting` for every actor, following `battleSimulator`'s
  per-actor wiring including the charged axis and `withStealthBypass`; synthetic fallback for
  kitless actors.
- Add `target` / `pattern` / `chargedTarget` / `chargedPattern` to `TeamActorInput` (they exist on
  the engine-facing `TeamActorEngineInput` but not the calculator-facing type);
  `deriveTeamEngineActors`'s `...t` spread carries them through.
- Add `hp` / `defence` / `security` to `EnemyAttackerConfig` (`EnemyAttackersPanel.tsx:16-33`) and
  to `EnemyAttackerInput.stats` (`healingEngineAdapter.ts:30-38`); seed from the ship template when
  picked. Add `position` / `target` / `pattern` / `chargedTarget` / `chargedPattern` to
  `EnemyAttackerInput`.
  **The engine already accepts all of these** — `enemyAttackers[].stats` carries optional
  `defence` / `hp` / `hacking` / `security` and the actor carries `position` / `target` / `pattern`
  (`engine.ts:1213-1245`), documented as *"Task 9 provides real value"*, which the healing adapter
  never did. This PR is wiring, not new engine surface.
- **Delete** `ENEMY_DEFENSE` / `ENEMY_HP` / `ENEMY_SECURITY` and the F7 comment block they anchor,
  plus the `enemySpeed: 0` dummy scalar — each enemy's own `stats.speed` drives its turn order now.
  ⚠️ **`ENEMY_SECURITY = 100` is a real behavioural dependency, not just a scalar.** The healer's
  *outbound* debuffs currently land against it, and the engine defaults a per-enemy `security` to
  **0** when absent — so deleting it without populating real per-enemy security makes the healer's
  debuffs land strictly more often. Seed real security from the ship template and default manual
  entry to 100 to hold today's landing behaviour.
- Re-derive the summary per recipient from PR 3a's axis, with the heal target as the primary row.

**Healing goldens move here.** Audit every move individually against a stated cause — enemy now
acts / enemy can die / heals now land on a footprint. A move **not** explained by one of those is a
defect, not something to re-pin. **Never `vitest -u`.**

⚠️ **Do not write a digit-parity test against a pre-change healing number.** Adding actors changes
the count and order of RNG draws (the rate gate keys on `ownerId`), so even a zero-damage addition
shifts every later draw. Assert structural identities instead.

### PR 3c — UI: placement + per-recipient report

- Slot dropdowns for every actor on both sides, seeded to defaults, collisions auto-resolved.
- Per-recipient breakdown table: heal target as primary row, other allies beneath, team total.
  Existing charts keep reading the primary row.
- `src/pages/DocumentationPage.tsx` updated; `UNRELEASED_CHANGES` in
  `src/constants/changelog.ts` gains a plain-English entry **before** committing.
- Use existing `src/components/ui/` primitives (`Select`, `DataTable`, the `card` class). No
  raw HTML boxes, no hand-rolled selects.

**Browser-verified before merge**, at `/healing` on `npm start` (there is no `npm run dev`).

---

## 6. Testing strategy

**Structural identities, not magic numbers:**

1. **Positional routing lands.** The healer's damage cast credits `perTargetDealt` against a real
   enemy id; the dummy's containers stay empty. Assert **both** — a non-empty `perTargetDealt`
   alone would pass if damage were double-credited.
2. **The `damage-dealt` rider bases off the real enemy.** Construct a fixture where the real
   enemy's defence and the old `ENEMY_DEFENSE` give *different* rider amounts, then pin the rider
   to the real one. An anti-vacuity precondition asserting the two candidate bases actually differ
   is required — a proportional assertion pins a ratio but no particular field.
3. **Heals land on the footprint.** An AoE support-pattern heal credits a second ally; a
   `Pattern-Base` support heal does not. The second ally **must carry a unique id and name** —
   otherwise `Object.values(...)[0]` passes byte-for-byte and the test is vacuous (the #318 bug
   class).
3b. **Heals do NOT follow lowest HP** (decision 7, the gate-split fence). A fixture where an
   off-pattern ally sits at much lower HP than an on-pattern ally must heal the **on-pattern** one.
   Pair it with the opposite fence — the battle sim's `lowestHpAllyId` routing still fires under
   `positionalTeamBattle` — so the pair proves the new signal is the narrowest correct one.
4. **Recipient axis sums to the source axis.** `Σ` per-recipient `effectiveHeal` equals the
   team-wide total, so the two axes can never silently disagree.
5. **The enemy can die and pressure falls.** A short window where one of two enemies dies leaves
   the survivor still attacking. ⚠️ Keep the window **tight enough that the run ends on the kill** —
   over a long window the focus kills the second enemy too and the premise evaporates (SP-1's
   earned lesson).
6. **Negative controls extended to the new channel.** Any existing negative control that asserts an
   empty old channel must also assert the new one, or it goes vacuous.
7. Full `npm test`, `tsc --noEmit`, `npm run lint`, `npm run audit`.
8. **Placement-symmetry oracle at its baseline** (`2 / 146 / 13-13-13`, `--seeds 15`). Combat-engine
   work must be team-symmetric; passives fire on both sides.

**Test-file docstrings are in scope for the staleness sweep.** Never `grep -v __tests__` — a
docstring asserting deleted behaviour keeps passing forever and misleads the next reader.

---

## 7. Non-goals

- **A board UI.** Slot dropdowns only (decision 6).
- **Removing the dummy from the engine.** That is SP-4. SP-3 removes the last production *caller*.
- **Removing `engine.ts:3494`'s `'ally' → [healTarget!.id]` hard-route** or
  `procStandingLeeches`'s pool gate. The battle sim and legacy fixtures still reach them.
- **Fixing the battle sim's `lowestHpAllyId` routing for non-Volk ships** (§3.1). Recorded as a
  probable latent defect; changing it moves sim goldens for unrelated reasons.
- **Volk's passive repair.** It legitimately targets the ally with the most missing health and is
  already correct; the pattern does not govern a passive-slot ability unless `patternScoped`.
- **Retro-fitting the DPS calculator onto real skill patterns.** It keeps `dpsSimulator`'s synthetic
  defaults. Worth doing, but it is not on SP-4's critical path and would move every DPS golden.
- **Changing `liveGateConditions` or any live-gating semantics.**
- **Rebasing the healing calculator onto `simulateBattle`.** Same rejection as SP-1/SP-2: it would
  migrate the round shape and touch every chart and golden.

---

## 8. Risks

| Risk | Mitigation |
| --- | --- |
| Non-additive recipient axis moves `simulateBattle` goldens | PR 3a's zero-movement gate |
| A kitless actor silently routes to the dummy, leaving SP-4 blocked | Synthetic fallback + an explicit test that a manual-entry healer still resolves onto a real enemy |
| Saved pages measure ~0 incoming damage | Accepted (decision 2); called out in the changelog entry |
| Silent positional-apply skip: target present, pattern absent | Assert `perTargetDealt` non-empty, never just the damage total (SP-1's silent-failure lesson) |
| Golden churn re-pinned wholesale instead of audited | Never `vitest -u`; every move needs a stated cause |
| Stale comments accumulating **around** the changed gate | Sweep the claims neighbouring each edit, not just the edit (the #318 lesson: 3 of 5 stale comments predated the change) |

---

## 9. Verification of CodeRabbit coverage

A green CodeRabbit check does **not** mean it reviewed HEAD. Confirm by grepping the latest review
body for the range line — `Reviewing files that changed … between <base> and <head>` — and checking
`<head>` against the actual HEAD SHA. Two merges in this epic shipped un-reviewed commits behind a
green check.

---

## 10. Related

- `[[project_dps_real_enemy_and_buff_timeline]]` — the epic, its locked rulings and earned lessons
- `[[reference_damage_dealt_basis_rule]]` — the locked basis rule the riders obey
- `[[project_placement_symmetry_oracle]]` — the symmetry gate, and "passives fire on both sides"
- `[[reference_engine_rng_seeding]]` — why digit-parity tests are invalid here
- `[[reference_sim_test_harness_traps]]` — fixture traps that ship vacuous tests
- `[[feedback_orchestrated_pr_workflow]]` — the endorsed spec → decompose → review → merge loop
