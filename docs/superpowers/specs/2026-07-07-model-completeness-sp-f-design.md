# SP-F — Model Completeness: Deep One-Offs (Design)

**Date:** 2026-07-07
**Epic:** Model-completeness (`project_model_completeness_epic`). Predecessors SP0/A/B/C/D/E all merged (main @ `0be1eaea`).
**Input:** `docs/model-completeness-triage-2026-07-05.md` (SP-F rows), the five grounding explorations run 2026-07-07.
**Fidelity bar (user-locked):** **full runtime-correct** — every cluster is modeled in `buildShipAbilities` *and* wired live + team-symmetric in the combat sim.

---

## 1. Scope

SP-F closes the remaining "deep one-off" real-gap deferrals. Five clusters, each bespoke, touching different subsystems:

| # | Cluster | New primitive | Layer |
|---|---------|---------------|-------|
| F1 | **Panon** active + charged — instead-branch damage replacement | none (reuses gate/collapse) | build-only |
| F2 | **AEGIS** — `on-ally-shield-destroyed` reactive trigger | new `shield-destroyed` event + trigger literal | build + engine |
| F3 | **Lingshe** — enemy Bomb countdown reduction | new `bomb-countdown-reduce` AbilityType + runtime loop | build + engine |
| F4 | **Wusheng / Isha / Nayra** — forced affinity override | affinity-override surface (per-hit flag + buff-driven) | build + engine |
| F5 | **Meatshield** — defense-substitution (approximation) | new ally-scoped `defense-substitution` config | build + engine |

### Explicitly deferred (out of scope for SP-F)

- **Protection-as-damage-transfer mechanic.** The game's Protection (Defender intercepts ally damage) is a **speed-ordered chaining redirect** (`min(stacks × 10%, 100%)` transferred; protectors re-intercept each other in speed order) with a **mitigation ordering the user has not locked**. Deferred to a dedicated future SP that locks the rule first. Affects Lionheart (10 stacks/round, all removed on trigger) and Meatshield's own R3 "steal Protection".
- **Meatshield Protection→DoT sibling** ("damage this Unit takes from Protection is transformed into a DoT for 2 turns") — strictly requires the Protection-transfer mechanic (no transferred damage exists to convert). Stays deferred/allowlisted with a "blocked on Protection mechanic" note. The generic DoT type from SP-E (`dbd02dd0`) is ready for it when Protection lands.
- **Meatshield SP-G recurring per-turn Protection-grant** marker — distinct clause, remains SP-G.

---

## 2. Cluster F1 — Panon (instead-branch)

**Text (active):** "deals 80% damage with an additional Damage equal to 70% of its Defense. If this Unit is Provoked or Taunted, this Unit instead gains Terran Guard III for 2 turns and deals 120% damage with an additional Damage equal to 90% of its Defense."
**Text (charged):** same shape, 140%/100% → 170%/130%.

**Current gap:** `parseSkillDamage` (`skillTextParser.ts:184-214`) returns on the *first* `<unit-damage>` tag (80/140); `parseSecondaryDamage` (`:330-345`) `.exec`s the first match (70/100). The self-target Terran Guard/Barrier buff is already correctly gated on Taunt/Provoke via `detectGrantConditions` (`buildShipAbilities.ts:2464`). The 120/90 (170/130) replacement numbers build **zero** abilities.

**Design — emit four abilities per skill:**

- **Replacement branch** (fires when Provoked/Taunted): `damage(120)` + `additional-damage(defense,90)`, each carrying the `anyOf` pair `[{self-buff Taunt, anyOf}, {self-debuff Provoke, anyOf}]` — exactly what `statusEffectCondition`/`affectedByConditions` already produce (`skillTextParser.ts:1476-1499`, `buildShipAbilities.ts:202-210`).
- **Base branch** (fires when NOT Provoked/Taunted): `damage(80)` + `additional-damage(defense,70)`, each carrying **two AND conditions**: `{self-buff, buffName:'Taunt', countComparator:'eq', countThreshold:0}` **and** `{self-debuff, buffName:'Provoke', countComparator:'eq', countThreshold:0}`.

**Runtime — free.** `gateFiringAbilities` (`applyAbilities.ts:292-311`) drops the failing branch in array order; `damageInputsFromSkill`/`secondaryFromSkill` `.find` the first survivor (fed the *gated* skill at `playerTurn.ts:1781/1783`). DPS mode (self never Provoked/Taunted) → base branch survives, replacement drops → byte-identical to today's 80/70. Under live Provoke/Taunt → replacement survives.

**Watch-outs:**
1. `Condition.negate` (`abilities.ts:334`) is only honored for `enemy-type` (`evaluateConditions.ts:133`) — do **not** use it. The `countComparator:'eq',countThreshold:0` idiom (`evaluateConditions.ts:233-245`) is the negation mechanism.
2. Base branch needs **AND** (both statuses absent), not the `anyOf` the existing helper emits — this is new authored builder shape.
3. `noCrit`/`hits` are read from the *ungated* skill (`playerTurn.ts:959-965`, `:1606`) via `.find` first-in-array — **emit base branch first** so those reads resolve sensibly (both Panon branches share `noCrit=false`, 1 hit → harmless, but order matters).
4. Regression `pr6ConditionalBranch.test.ts:194` currently asserts base damage `conditions: []` — update to expect the negated gate. Keep `buildShipAbilities.test.ts:4629/:4648` (buff-half gating) green.

**Close:** flip `PANON_ACTIVE`/`PANON_CHARGED` probes (`modelCompletenessTriage.test.ts:480,517`); remove `Panon · instead-replacement` allowlist entry (`auditSkills.allowlist.ts:24-28`). Note: Lingshe's allowlist reason references "the Panon instead-branch precedent" — update if needed.

---

## 3. Cluster F2 — AEGIS (on-ally-shield-destroyed)

**Text (R2 refit-active passive):** "This Unit grants Defense Up II for 1 turn and cleanses all debuffs when an ally within the Active pattern has their Shield destroyed."

**Current gap:** both abilities (all-allies Defense Up II + ally cleanse-all) default to `trigger:'on-cast'` — no shield-destruction trigger exists. The only shield trigger is `on-shield-applied` (opposite direction). No `shield-destroyed` event exists anywhere.

**Design — new reactive trigger, end-to-end (mirrors SP-B `on-own-debuff-resisted`, SP-A `on-destroyed`):**

1. **Event:** add `shield-destroyed` to the `events.ts` union — `{ victimId, round, stamp }`.
2. **Emit:** inside the shared `applyVictimDamage` (`engine.ts:3198`), right after the depletion line `victim.shieldPool -= absorbed` (`:3433`), when `shieldBefore > 0 && victim.shieldPool === 0`. Sits **after** the Barrier early-return (`:3365-3376`) so barriered hits don't false-positive. Mirror the sibling `bus.emit` calls (`:3549` hp-changed, `:3485` cheat-death).
3. **Trigger literal:** add `'on-ally-shield-destroyed'` to `AbilityTrigger` (`abilities.ts:69-161`) **and** `LIVE_TRIGGERS` (`:171-218`).
4. **Listener:** new `case` in `registerReactiveListeners` (`triggers.ts:348` switch) subscribing to `shield-destroyed`, guarding `isSameSideAlly(e.victimId, ownerId)`, stamping `eventCtx.damagedAllyId = e.victimId`.
5. **Retarget:** build both AEGIS abilities as `target:'ally'` (not `all-allies`) so `reactiveRecipients` (`triggers.ts:1515-1531`) routes to the triggering ally.
6. **Parse:** add regex → `return 'on-ally-shield-destroyed'` in `detectReactiveTrigger` (`skillTextParser.ts:1258-1318`) for the buff half; wire the analogous cleanse-trigger detector for the cleanse half (`buildShipAbilities.ts:1367`).

**Free wins:**
- **Pattern-scoping** ("within Active pattern"): `footprintFilteredRecipients` (`triggers.ts:1533-1547`) auto-intersects the `'ally'`-target reaction with `footprintAllyIdsFor(ownerId)` (`engine.ts:2282-2290`) — drops the reaction if the destroyed-shield ally is outside AEGIS's pattern. No new geometry code.
- **Team-symmetry:** shared `applyVictimDamage` emit covers both sides; `registerReactiveListeners` is called per-side (`engine.ts:2596`, `:2621`) with no module state → a new `case` is automatically symmetric.

**Watch-outs:**
1. **Dedup / direct-only:** gate the emit (or listener) so a DoT-tick that zeroes a shield (`byDirectDamage:false`) doesn't fire it; use the `oncePerRound` gate (`triggers.ts:1575`) if a shield can be re-granted then re-destroyed in one round.
2. **Lifeline** threshold-shield can grant shield mid-hit before the absorb (`engine.ts:3388-3425`) — ensure `shieldBefore` reads the post-grant pool so a fresh Lifeline shield destroyed the same hit is handled sanely.
3. Two builder paths (buff via `detectReactiveTrigger`; cleanse via cleanse-trigger) both need the new trigger.

**Close:** flip `AEGIS_P2` probe (`modelCompletenessTriage.test.ts:696-722`); add a documented allowlist row only if kept interim (none exists today).

---

## 4. Cluster F3 — Lingshe (bomb countdown reduction)

**Text (charged):** "This Unit reduces all Bombs on the enemy targets by 1 turn, Bombs reduced to 0 turns by this skill will detonate. This reduction effect requires hacking. This Unit inflicts Bomb III for 3 turns."

**Simplification (user, 2026-07-07):** bombs now **always detonate at countdown 0** by engine rule, so the "will detonate" rider is not a special mechanism — the clause reduces to "reduce enemy Bomb countdowns by 1 turn (hacking-gated)"; any bomb reaching ≤0 detonates immediately.

**Current gap:** only the "inflicts Bomb III" DoT-apply builds (`buildShipAbilities.ts:1426-1432`). The countdown-reduction sentence builds zero. Bombs are `PendingBomb[]` on the actor (`state.ts:76-92,148`), a separate container from tickable DoTs, ticked/detonated only on the enemy turn by `processBombs` (`engine.ts:755-774`). The existing duration-reduction primitive (`cleanse/reduce-duration`, `abilities.ts:618-622`) **deliberately excludes bombs** and targets self/allies (`skillTextParser.ts:3570-3573`).

**Design:**

- **New AbilityType** `{ type:'bomb-countdown-reduce', turns:number }` in `abilities.ts` (near `:552`), `target:'all-enemies'`, `application:'inflict'` (hacking-gated).
- **Parse:** new dedicated matcher in `skillTextParser.ts` near `REDUCE_DEBUFF_DURATION_RE` (`:3575`) for "reduces all Bombs on the enemy targets by N turn(s)" — do **not** reuse `REDUCE_DEBUFF_DURATION_RE`.
- **Build:** new branch near the Bomb DoT build (`buildShipAbilities.ts:1426`).
- **Runtime:** bespoke helper (mirrors `processBombs` math) run on the caster's turn: for each enemy victim (fan out over AoE recipients — `playerTurn.ts:1279-1299`), decrement each `pendingBomb.countdown` by `turns`; any bomb reaching `≤0` detonates **immediately** using the exact burst formula (`engine.ts:764-770`: `stacks · damagePerStack · affinityMult · (1 + detonationDamageModifier/100)`), credited to the bomb's original `sourceId` via `creditDetonation` + `emitBombDetonated`, then spliced. Ordered **before** `applyNewDoTs` (mirror `extendDoTs`, `playerTurn.ts:586-594`) so the fresh Bomb III isn't itself reduced. Hacking-gated via `landsTimedEnemyApplicationLive('inflict')` (`playerTurn.ts:1017`).

**Watch-outs:**
1. **Cannot reuse** `detonateContainers` (`detonation.ts:43-96`) — it nukes the whole container regardless of countdown and credits the *caster* with the caster's `detonationMult`/`affinityMult`. Attribution must be the original applier's `sourceId` (like `processBombs`).
2. AoE fan-out over each victim's own `pendingBombs`, not just the anchor.
3. Do not double-fire with the enemy-turn `processBombs` (`engine.ts:4531`, `:6265`) — the skill path runs on the caster's turn.
4. Partial model is unfaithful: reduction + immediate detonate-at-zero must ship together.

**Close:** flip `LINGSHE_CHARGED` probe (`modelCompletenessTriage.test.ts:537-565`, asserts `abilities.length > 1`); remove `Lingshe` allowlist entry (`auditSkills.allowlist.ts:16`). Update `buildShipAbilities.test.ts:1755` (asserts no duration-reduction emitted today).

---

## 5. Cluster F4 — Wusheng / Isha / Nayra (forced affinity override)

Affinity is pre-resolved by the calculator **adapters before the runtime** (`dpsSimulator.ts:227`, `battleSimulator.ts:747`, `healingEngineAdapter.ts:203`) into flat fields — `affinityDamageModifier`, `affinityCritCap`, `affinityCritPenalty`, `affinityDisadvantage` — consumed at three seams in `playerTurn.ts`:
- **Damage:** `affinityMult = 1 + affinityDamageModifier/100` (`:1671`, applied `:1953-1960`).
- **Crit:** `cappedCrit`/`realAffinityCappedCrit`/per-victim `rollVictimCrit` (`:1074-1081`, `:1615-1621`).
- **Debuff landing:** `'apply'` debuffs land unless disadvantaged — `isApply ? !affinityDisadvantage : roundDebuffLanded()` (`:555`, `:1021`, `:1396`; enemy-side `engine.ts:610-617`, `triggers.ts:2013-2019`).

`computeAffinityModifiers` (`affinityUtils.ts:23-31`): **advantage** = `{damageModifier:25, critCap:100, critPenalty:0}`; **disadvantage** = `{-25, 75, 25}`; **neutral** = `{0,100,0}`.

**Design — an affinity-override surface with two sources:**

### Wusheng (per-hit, offensive)
Charged skill "220% damage with affinity advantage and inflicts Stasis for 2 turns." Add `forceAffinityAdvantage?: boolean` to the `damage` `AbilityConfig` variant (`abilities.ts:479-489`). When the firing damage ability carries it, force **advantage** (`damageMod=25, critCap=100, critPenalty=0, disadvantage=false`) for that cast and its paired Stasis `'apply'` landing. Parse "with affinity advantage" → set the flag on the damage config. The Wusheng probe already accepts a `forceAffinityAdvantage`/`affinityAdvantage`/`forceAdvantage`-named field.

### Isha / Nayra (persistent, buff-driven, reciprocal)
The named buffs already exist as effect-less entries (`buffs.ts:559-570`). Drive the override off **buff-name presence** on the acting/victim unit:
- **Offensive Affinity Override** buff → the bearer's *outgoing* hits are forced to affinity **advantage** (attacker-side seams).
- **Defensive Affinity Override** buff → when the bearer is the *victim*, the attacker is forced to affinity **disadvantage** against this victim (victim-side affinity resolution — `playerTurn.ts:992-1038`, `rollVictimCrit`, enemy-landing gate). *(Interpretation lock: "affinity advantage while getting attacked" = the defender holds the advantage, so the incoming attacker is at disadvantage. FLAGGED for spec review — the alternative milder reading is "merely deny the attacker's advantage / neutral." Primary = symmetric advantage.)*

Grants (start-of-round, reclassified buff path `triggers.ts:1609`):
- **Isha:** unconditional Offensive Override; Defensive Override gated on `ally-on-team: Nayra`.
- **Nayra:** unconditional Defensive Override; Offensive Override gated on `ally-on-team: Isha`.

`ally-on-team` (`abilities.ts:246-248`, parsed `skillTextParser.ts:1091-1095`) is today a **manual assume-met** gate (`evaluateConditions.ts:108` returns met for `derivable:false`). Make it a **live roster check in the team-sim** (roster known); keep manual assume-met in single-ship DPS.

**Watch-outs:**
1. Pre-resolution timing — the override locally supersedes already-flat adapter values; touch all three seams consistently (and the victim-side seam for Defensive).
2. Isha/Nayra require the override to become **buff-aware/live** rather than adapter-baked — a per-actor derived flag (`hasOffensiveAffinityOverride`/`hasDefensiveAffinityOverride`) computed from the actor's live buff set, read at the seams.
3. Team-symmetry: enemy-side Isha/Nayra/Wusheng must force affinity identically.
4. `noCrit`-style ungated read caveats do not apply here (flag lives on the surviving damage ability).

**Close:** flip `WUSHENG_CHARGED` probe (`modelCompletenessTriage.test.ts:626-676`); **author new Isha + Nayra probes** (none today) asserting the buff-driven override + reciprocal gate; add allowlist rows if kept interim (none today).

---

## 6. Cluster F5 — Meatshield (defense-substitution, approximation)

**Text (R4, target sentence):** "Any direct damage dealt to a non-defender ally that is not transferred by Protection is dealt as if that ally had this Unit's defense."

**Approximation (locked):** Protection-transfer is deferred (§1), so nothing is "transferred by Protection" → the "not transferred" gate is vacuously true → **all** direct damage to a non-defender ally is mitigated using Meatshield's defense instead of the ally's own. This is clean and **independent of the unknown Protection mitigation ordering** — it only swaps *which defense stat mitigates the ally's incoming hit*.

**Design:**
- **New surface:** ally-scoped `{ type:'defense-substitution' }` config (`abilities.ts`), `target:'all-allies'`, built from the R4 sentence. The SP-F probe requires an **ally-scoped** ability to build (distinguishes it from the self-scoped sibling gap).
- **Runtime:** at `defenseProfileOf` (`engine.ts:4235-4256`, the positional/AoE path) **and** the sibling defence-read sites — reactive `engine.ts:3992`, `victimDefenceFor` `engine.ts:4416`/`:4428` — when the victim is a **living non-defender ally** of a carrier of this ability, substitute the carrier's *effective* defence for `v.stats.defence`. Non-defender role classification (`ShipRoleCategory`, used `buildShipAbilities.ts:485`) evaluated at hit time.

**Watch-outs:**
1. Keep **all** defence-read sites consistent — a substitution done in only one path silently diverges across attack types.
2. Team-symmetry — fires for a Meatshield on either side.
3. Distinct from Meatshield's SP-G recurring-grant marker (`modelCompletenessTriage.test.ts:790-803`) — do not conflate.
4. If two carriers protect the same ally, define a deterministic pick (highest effective defence). Document.

**Close:** flip Meatshield SP-F defense-sub probe (`modelCompletenessTriage.test.ts:584-615`); add an allowlist row documenting the **deferred Protection→DoT sibling** + Protection-transfer dependency.

---

## 7. Task / PR structure

**One branch `sp-f/model-completeness` (base `0be1eaea`), sequential subagent-driven tasks F1–F5, one squashed PR** — matches SP-E. Rationale: all five touch the shared core files (`types/abilities.ts`, `skillTextParser.ts`, `buildShipAbilities.ts`, `engine.ts`), so parallel worktrees would conflict heavily; sequential-on-one-branch avoids merge hell.

Suggested order (low-risk build-only first, hardest last):
1. **F1 Panon** — build-only, no engine.
2. **F5 Meatshield** — single new config + defence-read substitution.
3. **F3 Lingshe** — new AbilityType + runtime loop.
4. **F2 AEGIS** — new event + reactive trigger.
5. **F4 Wusheng/Isha/Nayra** — affinity-override surface (hardest; per-hit + buff-driven + reciprocal gate).

Per task: flip its probe(s) → strengthen to a real literal assertion → add a **team-symmetry integration test** for every runtime cluster (per `feedback_engine_team_symmetry`) → full-suite-minus-triage green → opus review clean. Final whole-branch opus review "Ready to merge = YES" before the squashed PR. Changelog entry in `UNRELEASED_CHANGES`. Model selection per task per `feedback_orchestrated_pr_workflow` (Haiku/Sonnet mechanical, opus for engine/judgment).

Infra reminders (from SP-E): copy `docs/*.csv` into the worktree (skill-audit needs them); `gh auth switch --user TheSusort` before `gh pr merge`; CI does not run vitest (husky pre-commit does).

---

## 8. Testing strategy

- **Probes:** each cluster flips its `it.fails` → `it` in `modelCompletenessTriage.test.ts`, strengthened from the tier-1 proxy to a real literal (e.g. Panon: assert the negated/anyOf conditions on both branches; Lingshe: assert the `bomb-countdown-reduce` config; Wusheng: assert `forceAffinityAdvantage`).
- **Team-symmetry integration tests:** AEGIS (enemy-side shield destroyed → enemy AEGIS reacts), Lingshe (enemy Lingshe reduces player bombs), Wusheng/Isha/Nayra (enemy-side forced affinity), Meatshield (enemy-side defense-sub).
- **Regression guards to update:** `pr6ConditionalBranch.test.ts:194` (Panon base gate), `buildShipAbilities.test.ts:1755` (Lingshe duration-reduction).
- **`audit:skills` = 0 findings / 0 stale** after each allowlist edit.
- Full suite green (currently ~4317 tests).

---

## 9. Open interpretation flags (resolve during spec review)

1. **Isha/Nayra Defensive Affinity Override semantics** (§5) — primary lock = "victim holds advantage → incoming attacker forced to disadvantage." Alternative = "merely deny attacker's advantage (neutral)." Confirm.
2. **Meatshield multi-carrier tie-break** (§6) — highest effective defence assumed. Confirm.
3. **Wusheng refit-active passive** — the forced-affinity is on the charged skill; the R4 passive (stealth/full-charge) is unrelated and already modeled. No conflict expected.
