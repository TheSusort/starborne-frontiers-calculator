# Combat Engine Phase 4c PR 3 — HP-Threshold-Crossed Reactives Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "when HP drops/falls below N%" reactives live in the combat engine (tank-side `hp-changed` at damage intake + a new `on-hp-threshold-crossed` trigger with `oncePerCombat` buff support), and fix the Hermes charged-skill Cheat-Death grant (below-40% gate against the heal target's live HP, narrowed from all-allies to the heal target, applied when the charged skill actually fires).

**Architecture:** New trigger value + existing condition/intent machinery (spec Approach 1 — no event-filter DSL). The engine emits one `hp-changed` event per HP-intake event (enemy attack or turn-start DoT batch) on the heal target, after the aggregate shield-first drain and the Cheat-Death intercept; a new listener detects downward crossings (`oldPct >= N > newPct`, N read from the ability's self `hp-threshold` condition) and enqueues intents through the existing drain points. Hermes/Hayyan Cheat-Death grants on firing slots reclassify from always-on auras to slot-fired persistent grants gated by a new `'target'` HP-subject condition.

**Tech Stack:** TypeScript, Vitest. All engine code under `src/utils/combat/`, parser under `src/utils/skillTextParser.ts` + `src/utils/abilities/buildShipAbilities.ts`.

**Spec:** `docs/superpowers/specs/2026-06-10-combat-engine-phase4c-design.md` §4 PR 3 (+ §3.2 player-side `hp-changed`, §3.3 trigger table, §5 edge cases, §6 testing).

**Branch:** `feat/combat-engine-phase4c-hp-crossing` off `main` (currently `905dce11`).

---

## Non-negotiable project rules (CLAUDE.md + project memory)

- **Golden discipline:** DPS goldens (22+) and healing goldens are SYNTHETIC hand-built fixtures — any diff = bug, NEVER `vitest -u`. This PR expects **ZERO churn** in every existing golden (DPS byte-identical; healing unchanged because no existing scenario uses the new trigger or a firing-slot Cheat-Death grant). New golden scenarios are pure-additive snapshots (delete-and-rerun only ever applies to scenarios you add).
- **Changelog:** fold into the ONE existing UNRELEASED combat/healing entry in `src/constants/changelog.ts` — never add a second entry.
- **docs/ is gitignored** — commit doc changes with `git add -f`.
- **`gh auth switch --hostname github.com --user TheSusort`** before any PR/push op.
- ESLint `--max-warnings 0`; no emojis in UI text.
- Run a single file with `npx vitest run <path>`; full suite `npx vitest run`.
- Inc./Out. abbreviation-period masking applies to ANY new sentence-scoped clause logic, on BOTH the parser and auditSkills sides (Shelter's clause contains "Inc. Damage Down II" — a live trap for this exact PR).

## Current-state map (verified 2026-06-11 against `905dce11`)

| Thing | Where | State |
|---|---|---|
| `hp-changed` event type | `src/utils/combat/events.ts:121` | `{ type: 'hp-changed'; targetId; round; oldPct; newPct }` — emitted ONLY for the enemy dummy post-round at integer granularity (`engine.ts:2642–2658`); zero consumers; the events.ts docstring (~line 135) already documents the PR-3 once-per-attack intent |
| Enemy-intake drain | `engine.ts:1635–1686` (`applyIncomingToTarget`, a closure) | shield-first drain, then Cheat-Death intercept (`currentHp <= 0` → save at 1 HP + `cheat-death-activated`, else `ship-destroyed`); TWO call sites: once per enemy attack (`engine.ts:2458`) AND once per tank turn-start DoT-tick batch (`engine.ts:2025`, `applyIncomingToTarget(tankDotDamage)`) |
| Per-hit `attacked` emission | `engine.ts:2498–2515` | after the drain; per-hit; NOT the model for `hp-changed` (spec: hp-changed is once per attack) |
| Trigger union / LIVE_TRIGGERS | `src/types/abilities.ts:32–48 / 58–74` | 16 triggers, 15 live |
| Listener switch | `src/utils/combat/triggers.ts:276–321` | `on-attacked` / `on-ally-attacked` cases are the pattern to mirror |
| `oncePerCombat` | heal config field `src/types/abilities.ts:210–214`; runtime Set `engine.ts:1304`; guard in heal/shield executor branch `triggers.ts:836–839` | heal-only today; buff branch (`triggers.ts:693–732`) has NO guard |
| Reactive buff executor | `triggers.ts:693–732` | attaches `gateConditions` to the granted status; the load-bearing scrub site is the DRAIN-TIME gate at 677–678 (a healed-up owner would fail a kept hp-threshold and silently skip the reaction). Timed-status conditions are never re-evaluated post-application, so the status-object exclusion is hygiene only |
| Drain-time gate | `triggers.ts:677–678` | `liveGateConditions` + `conditionsMet(buildDrainContext)`; `selfHpPctFor` closure at `engine.ts:1912` |
| `hp-threshold` condition | `src/types/abilities.ts:102–123`; eval `src/utils/abilities/evaluateConditions.ts:56–81`; `hp-threshold` is in LIVE_SUBJECTS (`src/utils/combat/abilityStatusGating.ts:11–20`) | `hpSubject: 'self' \| 'enemy'` — needs `'target'` |
| `ConditionContext` | `evaluateConditions.ts:4–20` | needs `targetHpPct?: number` |
| Cast-path status classification | `engine.ts:95–203` (`registerActorAbilityStatuses`) | `duration: 'recurring'`/undefined → AURA, registered at combat start to all recipients, ungated by slot-fire. **This is the Hermes over-fire**: its charged-slot Cheat Death (`target: 'all-allies'`, `duration: 'recurring'`, no conditions) is active from round 1 |
| Cast-path timed application | `playerTurn.ts:974–995` | `status.sourceSlot === action` + `conditionsMet(status.conditions, postDebuffGateCtx)` → applied to `status.recipients` when the slot fires — this IS the cast-path gate hook |
| `CHEAT_DEATH_BUFFS` | `src/utils/combat/cheatDeathBuffs.ts` | name set; detection via `selfBuffNamesForOwners` (`triggers.ts:567–586`) which reads timed + aura statuses (aura gates evaluated with a NEUTRAL ctx — an HP-gated aura would never be detected: another reason the Hermes fix must NOT be a gated aura) |
| Editor trigger options | `src/components/skills/AbilityCard.tsx:121–137` (`TRIGGER_OPTIONS`); not-simulated label keys on LIVE_TRIGGERS (~line 768) | add one option; label auto-resolves |
| Editor hpSubject select | `src/components/skills/ConditionRow.tsx:181–185` | options self/enemy — needs 'target' |
| auditSkills parity | `scripts/auditSkills.ts:219–241` (`ungatedFinding`) | calls `detectDamageReactionTrigger` as a parity guard; mirror with the new detector |
| Goldens | `src/utils/calculators/__tests__/healingGoldenParity.test.ts` | `ab()` helper line 44; scenario+`snap()` pattern; snapshots in `__snapshots__/` |

**Parsed current state of the six ships** (dumped from `docs/ship-skills.csv` through `buildShipAbilities`, 2026-06-11):

- **Kafa p1/p2** "gains Terran Tenacity I for 3 turns when HP drops below 50%." → today an UNGATED on-cast passive buff (duration 3) — a phantom seeded at combat start. No once-per-battle → re-fires on every downward crossing after the fix.
- **Shelter p1** Barrier 1t / **p2** Barrier 1t + Inc. Damage Down II 3t, "when HP drops below 20%, once per battle" → today ungated phantoms.
- **Tycho p2** "At the start of combat, this Unit gains Cheat Death and Everliving Regeneration II for 9 turns. Once per battle, when HP drops below 40% it gains Barrier for 1 turn." → Cheat Death + Everliving parse correctly (start-of-combat); Barrier today is an ungated phantom on the same slot. Detector must be SENTENCE-scoped so only Barrier rides the trigger.
- **Los p1/p2** "This Unit deals 30% more Direct damage when its HP is below 50%.<br />Once per battle when HP falls below 50%, it grants Barrier for 1 turn." → modifier already correctly hp-threshold-gated (do not touch); Barrier today an ungated phantom. The two clauses ARE separate sentences in both production pipelines: `<br />` tags normalize to `'. '` before sentence splitting (`buildShipAbilities.ts:294` `.replace(/<br\s*\/?>/gi, '. ')`; auditSkills replaces with `' '`) — detector lock tests must use that canonical post-strip form, NOT a raw br-stripped join.
- **Redeemer p1/p2** "…gains Shield equal to 2.5% of its Max HP every turn.<br />When HP drops below 60% it gains Defense Up II for 4 turns." → same br-separated sentences; Defense Up today an ungated phantom; the per-turn shield ability is OUT of scope (buff/debuff wiring only — no crossing HEALS exist in the corpus).
- **Hermes charged** "This Unit repairs 37% … If the target has less than 40% HP, it grants Cheat Death." → today `buff Cheat Death, target 'all-allies', duration 'recurring', conditions []` → always-on aura from round 1 (4b KNOWN LIMITATION 1).
- **Hayyan charged** → same shape as Hermes but genuinely ungated/all-allies in its text; the classification carve-out fixes its CADENCE (applies when charged fires, not from round 1) — a deliberate, audited side effect. Other firing-slot recurring/undefined-duration buffs (Panon, Sansi, Quixilver, Malvex, Sentinel, Oleander) are NOT Cheat-Death-family and stay OUT of scope — document in §5.

**Semantic decisions locked for this PR** (consistent with spec §3.3/§5 — do not re-derive):

1. `hp-changed` for the tank: ONCE per HP-intake event, emitted inside `applyIncomingToTarget` AFTER the Cheat-Death intercept, with exact (non-integer) percentages. The closure has TWO call sites — per enemy attack (`engine.ts:2458`) and per tank turn-start DoT-tick batch (`engine.ts:2025`) — and the emission deliberately covers BOTH: in-game, "when HP drops below N%" includes DoT damage, so a Corrosion tick crossing the threshold DOES proc the reaction (one event per aggregate tick batch, never per hit / per DoT entry). A saved tank (100→1 HP) emits `oldPct=100, newPct≈small>0` → counts as crossing below 40 (Tycho can proc on the save). A killed tank emits `ship-destroyed`, NOT `hp-changed` (no posthumous crossing).
2. Crossing check is per-event self-contained: `oldPct >= N && newPct < N`. No listener state. Heals don't emit `hp-changed`; a later intake event's `oldPct` reflects the healed HP, so re-crossing re-fires naturally (Kafa/Redeemer) and `oncePerCombat` caps Tycho/Shelter/Los.
3. **Documented granularity:** `hp-changed` fires once per intake EVENT (an enemy attack's aggregate drain, or a turn-start DoT batch) — never per hit. Upward changes (heals) emit nothing. Goes in §5 (replaces the spec's open question on DoT-driven emission — spec §3.2 only says "at damage-intake time"; DoT ticks ARE intake here).
4. For `on-hp-threshold-crossed` abilities, the self `hp-threshold` condition is TRIGGER CONFIG (the listener reads N from it). It is scrubbed from the conditions fed to `liveGateConditions` in `executeIntent`: the crossing already proved the threshold, and the drain-time re-gate would otherwise wrongly BLOCK the reaction when a reactive heal earlier in the intent queue lifted the owner back above N before this intent drains. (The status object's `conditions` then also exclude it — harmless either way for TIMED statuses, whose conditions are never re-evaluated post-application; only aura/accumulating statuses re-gate per round.)
5. Hermes mechanism: Cheat-Death-family buffs (`CHEAT_DEATH_BUFFS`) on FIRING slots (active/charged) classify as `kind: 'timed'` with `duration: Infinity` instead of aura → applied by the existing per-slot loop (`playerTurn.ts:974`) when the slot fires, gated by `conditionsMet` at cast time against the caster's `postDebuffGateCtx`. `Infinity` never decrements to 0 (turnsRemaining stays Infinity) → persists like Cheat Death should; `clearRemovable` on activation still wipes it (it is consumed anyway).
6. New condition subject value `hpSubject: 'target'` evaluates against `ConditionContext.targetHpPct` = the HEAL TARGET's live HP% **at the acting actor's turn start** (pre-this-cast-heal), threaded from the engine. Default 100 when absent → in DPS mode "below 40" fails → Hermes grant is inert in DPS (conservative, correct: nothing tracks a tank there).
7. Recipient narrowing is scoped to the carve-out statuses ONLY: a Cheat-Death-family firing-slot grant with `target: 'ally'` lands on `[healTargetId]` (fallback `[ownerId]` when no heal target). `'all-allies'` keeps all playerIds (Hayyan). The global Task-5 'ally' → all-players rule for every other cast-path buff is UNCHANGED (zero churn).

---

### Task 1: Type plumbing + `'target'` HP-subject evaluation

**Files:**
- Modify: `src/types/abilities.ts` (AbilityTrigger union ~32–48; LIVE_TRIGGERS ~58–74; Condition.hpSubject ~102–123; buff config interface — find the `type: 'buff'` config member near the heal config's `oncePerCombat` at ~210)
- Modify: `src/utils/abilities/evaluateConditions.ts` (ConditionContext ~4–20; evalHpThreshold ~56–81)
- Test: `src/utils/abilities/__tests__/evaluateConditions.test.ts` (or the existing test file colocated with evaluateConditions — locate with `ls src/utils/abilities/__tests__/`)

- [ ] **Step 1: Write failing tests** for `evalHpThreshold` with `hpSubject: 'target'`:

```typescript
it('hp-threshold with hpSubject target reads targetHpPct', () => {
    const cond: Condition = { subject: 'hp-threshold', derivable: true, hpComparator: 'below', hpPercent: 40, hpSubject: 'target' };
    expect(evaluateCondition(cond, { ...NEUTRAL, targetHpPct: 35 })).toBe(1);
    expect(evaluateCondition(cond, { ...NEUTRAL, targetHpPct: 60 })).toBe(0);
});
it('hp-threshold target defaults to 100 when targetHpPct absent (DPS-mode inert)', () => {
    const cond: Condition = { subject: 'hp-threshold', derivable: true, hpComparator: 'below', hpPercent: 40, hpSubject: 'target' };
    expect(evaluateCondition(cond, NEUTRAL)).toBe(0);
});
```

(Use the file's existing neutral-context helper; if none, build the minimal `ConditionContext` literal the file already uses elsewhere.)

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/utils/abilities/__tests__/evaluateConditions.test.ts` → FAIL (type error on `'target'`/`targetHpPct`).

- [ ] **Step 3: Implement:**
  - `abilities.ts`: add `'on-hp-threshold-crossed'` to `AbilityTrigger` AND to `LIVE_TRIGGERS` (17-value union, 16 live — note this churns the "16-value union, 15 live" doc phrasing; Task 11 updates it). Widen `hpSubject?: 'self' | 'enemy' | 'target'` with a doc comment: `'target'` = the heal target's live HP (healing mode; defaults 100 elsewhere). Add `oncePerCombat?: boolean` to the BUFF config with a doc comment mirroring the heal one (Tycho/Shelter/Los "once per battle" crossing grants; tracked in the same combat-lifetime Set keyed `${ownerId}:${abilityId}`).
  - `evaluateConditions.ts`: add `targetHpPct?: number; // 0..100 — heal target's live HP%, threaded in healing mode only` to `ConditionContext`; in `evalHpThreshold`: `const hp = cond.hpSubject === 'self' ? ctx.selfHpPct : cond.hpSubject === 'target' ? (ctx.targetHpPct ?? 100) : ctx.enemyHpPct;`

- [ ] **Step 4: Verify** — the new tests pass; `npx tsc --noEmit` clean; spot-run `npx vitest run src/utils/combat/__tests__/triggers.test.ts` (LIVE_TRIGGERS growth must not break the partition tests).

- [ ] **Step 5: Commit** — `feat(combat): add on-hp-threshold-crossed trigger type, target HP subject, buff oncePerCombat`

### Task 2: Tank-side `hp-changed` emission at damage intake

**Files:**
- Modify: `src/utils/combat/engine.ts` (`applyIncomingToTarget` closure, ~1635–1686)
- Modify: `src/utils/combat/events.ts` (~135 — refresh the docstring: tank-side emission now LIVE, once per INTAKE EVENT (enemy attack or turn-start DoT batch), exact pct; enemy dummy stays integer-granularity post-round)
- Test: `src/utils/combat/__tests__/hpCrossing.test.ts` (create)

- [ ] **Step 1: Write failing engine-level tests** (mirror the fixture style of `selfHpGate.test.ts` — healing-mode input, enemy attacker, event collection via the bus/log):
  - one `hp-changed` per enemy ATTACK on the heal target (a 3-hit enemy active → 1 event, 3 `attacked` events), `targetId` = heal target, `oldPct`/`newPct` exact (e.g. 10000 max HP, 2500 damage → 100 → 75).
  - one `hp-changed` per turn-start DoT batch: tank carrying Corrosion → exactly ONE additional event at its turn (the `engine.ts:2025` call site, aggregate batch), with `oldPct`/`newPct` reflecting the tick total — and NO `attacked` event for it (DoTs are not "directly damaged"; the per-hit `attacked` contract is untouched).
  - Cheat-Death save: lethal hit on a Cheat-Death-carrying tank → `cheat-death-activated` AND `hp-changed` with `newPct` > 0 and < 1%-ish (1 HP), `oldPct` = pre-hit.
  - Killed tank (no Cheat Death): `ship-destroyed`, NO `hp-changed` for that attack.
  - Zero-damage attack paths (shield fully absorbs → HP unchanged): event still emitted with `oldPct === newPct` (harmless; listener requires a crossing) — OR skip emission when `hpDamage === 0`; pick EMIT-ALWAYS for simplicity and assert it.

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/utils/combat/__tests__/hpCrossing.test.ts`.

- [ ] **Step 3: Implement** inside `applyIncomingToTarget`: capture `const hpBefore = healTarget!.currentHp;` and `const maxHp = recipientMaxHp(healTarget!.id);` before the drain; after the Cheat-Death-intercept/destroyed block, when the target survived (`healTarget!.currentHp > 0`):

```typescript
// Tank-side hp-changed (Phase 4c PR 3): ONCE per HP-intake event — this closure
// is called per enemy attack (aggregate drain) AND per turn-start DoT batch, and
// the emission covers both deliberately ("when HP drops below N%" includes DoT
// damage in-game). Emitted after the Cheat-Death intercept (a 100→1-HP save
// counts as a downward crossing — spec §5). Exact percentages (the enemy dummy's
// post-round emission stays integer-granularity — asymmetry intended, events.ts).
// A killed tank emits ship-destroyed above, never a posthumous crossing.
bus.emit({
    type: 'hp-changed',
    targetId: healTarget!.id,
    round: r,
    oldPct: (100 * hpBefore) / maxHp,
    newPct: (100 * healTarget!.currentHp) / maxHp,
});
```

(Adapt local names to the actual closure variables; the dead-target short-circuit at ~2350 already prevents intake on dead tanks.)

- [ ] **Step 4: Verify zero churn** — `npx vitest run` (full suite): all existing goldens byte-identical (the event has no consumers yet).

- [ ] **Step 5: Commit** — `feat(combat): emit tank-side hp-changed once per HP-intake event (attacks + DoT batches)`

### Task 3: `on-hp-threshold-crossed` listener + condition scrub + buff `oncePerCombat`

**Files:**
- Modify: `src/utils/combat/triggers.ts` (listener switch ~276–321; `executeIntent` gate ~673–678; buff branch ~693–732)
- Test: `src/utils/combat/__tests__/hpCrossing.test.ts` (extend)

- [ ] **Step 1: Write failing listener/executor tests** (use the registerReactiveListeners/executeIntent harness style from `triggers.test.ts`):
  - crossing fires: ability with conditions `[{subject:'hp-threshold', derivable:true, hpComparator:'below', hpPercent:40, hpSubject:'self'}]`, event `oldPct 45 → newPct 35` → one intent enqueued.
  - boundary: `oldPct 40 → 35` fires (`>=`); `40 → 40` and `35 → 30` do NOT; upward `35 → 60` does NOT.
  - other-actor and enemy-dummy `hp-changed` events ignored (`targetId !== ownerId`).
  - ability with NO self hp-threshold condition → dormant (never enqueues).
  - executor: buff config with `oncePerCombat: true` executes once, second intent silently skipped (Set keyed `${ownerId}:${abilityId}`).
  - scrub: for an `on-hp-threshold-crossed` buff intent, execution succeeds even when `selfHpPctFor` reports the owner back ABOVE the threshold at drain time (healed-before-drain edge — this is the load-bearing assertion: without the scrub the drain-time gate blocks the reaction). Also assert the applied status's `conditions` contain NO self hp-threshold entry (shape hygiene; note timed statuses never re-evaluate conditions post-application anyway — only aura/accumulating statuses re-gate per round).

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement:**
  - Listener case (mirror `on-attacked`'s comment discipline):

```typescript
case 'on-hp-threshold-crossed':
    bus.on('hp-changed', (e) => {
        // Self-scoped downward crossing: fires when THIS OWNER's HP crosses below N
        // (N from the ability's self hp-threshold condition — trigger CONFIG, not a
        // drain-time gate; executeIntent scrubs it). Per-event check oldPct >= N > newPct:
        // no listener state — a heal-up re-arms naturally, oncePerCombat caps re-fires.
        if (e.targetId !== ownerId) return;
        const n = ra.ability.conditions.find(
            (c) => c.subject === 'hp-threshold' && c.hpSubject === 'self' && c.hpComparator === 'below'
        )?.hpPercent;
        if (n === undefined) return; // no threshold configured → dormant
        if (!(e.oldPct >= n && e.newPct < n)) return;
        enqueue({ ...intent });
    });
    break;
```

  - `executeIntent` scrub (before line ~677): for `intent.ability.trigger === 'on-hp-threshold-crossed'`, filter `subject === 'hp-threshold' && hpSubject === 'self'` out of the conditions fed to `liveGateConditions` (one filtered const used for both the gate and the status's `conditions`). Comment: the crossing already proved the threshold; drain-time re-gating would block after a same-round heal-up (the status-object exclusion is hygiene only — timed statuses never re-evaluate conditions post-application).
  - Buff-branch `oncePerCombat` guard — copy the heal-branch guard verbatim into the top of the `cfg.type === 'buff'` branch:

```typescript
// "Once per battle" buff grant (Tycho/Shelter/Los Barrier): same combat-lifetime
// Set as the heal executor's cap (triggers.ts heal branch), keyed owner+ability.
if (cfg.oncePerCombat) {
    const key = `${intent.ownerId}:${intent.ability.id}`;
    if (ctx.oncePerCombatFired?.has(key)) return;
    ctx.oncePerCombatFired?.add(key);
}
```

- [ ] **Step 4: Verify** — task tests pass; `npx vitest run src/utils/combat/` green; full suite zero golden churn.

- [ ] **Step 5: Commit** — `feat(combat): on-hp-threshold-crossed listener, threshold scrub, buff oncePerCombat`

### Task 4: Engine integration scenarios (runCombat end-to-end)

**Files:**
- Test: `src/utils/combat/__tests__/hpCrossing.test.ts` (extend; full `runCombat` healing-mode inputs)

- [ ] **Step 1: Write failing scenarios:**
  - **Tycho-shape:** tank with passive `on-hp-threshold-crossed` Barrier buff (`oncePerCombat: true`, condition below 40). Enemy chips HP across rounds; healer restores above 40 between crossings. Assert exactly ONE `buff-applied` for Barrier across the whole combat despite two downward crossings.
  - **Kafa-shape:** same but NO `oncePerCombat` → assert `buff-applied` on EACH downward crossing (2 events), and the granted status persists its full duration even after a heal back above N (assert via the effects panel/snapshot read the suite already uses, or via a third round still carrying the buff).
  - **Cheat-Death-save crossing:** Cheat-Death-carrying tank at full HP takes a lethal hit → save at 1 HP → assert the crossing reaction fired in that same round (Barrier `buff-applied` alongside `cheat-death-activated`).
  - **DoT-tick crossing:** tank carrying Corrosion, enemy direct damage tuned so only the turn-start DoT batch takes HP below the threshold → assert the crossing reaction fires on the tick (decision 1: DoT intake emits `hp-changed` too).
  - **DPS-mode inertness:** attacker-only run (no healTargetId) with the same ability → zero `buff-applied` from the trigger; trigger partitions to reactive (NOT seeded by `seedPassiveTimedStatuses` — assert no round-1 phantom grant).

- [ ] **Step 2: Run to verify failure / Step 3: fix anything the integration surfaces (expected: none — Tasks 2–3 carry it).**

- [ ] **Step 4: Full suite green, zero golden churn.**

- [ ] **Step 5: Commit** — `test(combat): hp-crossing end-to-end scenarios (once-per-battle, re-fire, cheat-death save)`

### Task 5: Hermes/Hayyan — firing-slot Cheat-Death grants become cast-path, target-gated

**Files:**
- Modify: `src/utils/combat/engine.ts` (`registerActorAbilityStatuses` ~95–203 + its call sites; `runPlayerTurn` call sites for the new `targetHpPct` arg — find via `selfHpPct:` args near `engine.ts:1912`)
- Modify: `src/utils/combat/playerTurn.ts` (args destructure ~629; the four `buildRoundContext` sites ~836/970/1046/1125 — thread `targetHpPct` at least into `postDebuffGateCtx` (line ~961) which gates the per-slot timed application; add to the others for consistency)
- Modify: `src/utils/combat/statusEngine.ts` ONLY IF the timed decrement/expiry mishandles `Infinity` (it should not: `Infinity - 1 === Infinity`, expiry compares `<= 0`) — verify, don't change blindly
- Test: `src/utils/combat/__tests__/hpCrossing.test.ts` or a new `castPathCheatDeath.test.ts`

- [ ] **Step 1: Write failing tests:**
  - **Classification:** a `buff` ability, `buffName: 'Cheat Death'`, `duration: 'recurring'`, on the CHARGED slot → registers as `kind: 'timed'`, `duration: Infinity`, lands in `timedSelfBySlot` (NOT in the aura maps). The same ability on the PASSIVE slot → still an aura (Tycho start-of-combat unchanged).
  - **Cadence:** healing-mode run, healer with `chargeCount 3`: NO Cheat Death on any actor in rounds 1–2; after the charged skill fires (round 3) the grant applies. Pre-fix this fails (aura active from round 1).
  - **Gate:** the grant ability carries `conditions: [{subject:'hp-threshold', derivable:true, hpComparator:'below', hpPercent:40, hpSubject:'target'}]`. Tank above 40% at the caster's turn start → no grant; below 40% → grant applies.
  - **Narrowing:** `target: 'ally'` + healTargetId → status recipient is the heal target ONLY (other team actors carry nothing). `target: 'all-allies'` (Hayyan-shape, no conditions) → all players, but only after the charged fire.
  - **Persistence:** granted status survives subsequent rounds (Infinity never expires) and the tank's Cheat-Death intercept consumes it normally on a later lethal hit.

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement:**
  - `registerActorAbilityStatuses`: import `CHEAT_DEATH_BUFFS`; add an optional `healTargetId?: string` parameter (engine passes `input.healTargetId` at the two call sites — locate with `grep -n registerActorAbilityStatuses src/utils/combat/engine.ts`). In the classification:

```typescript
// Cheat-Death-family grants from a FIRING slot (Hermes/Hayyan charged skills) are
// cast-path persistent grants, NOT always-on auras: they apply when the slot fires
// (per-slot timed loop in playerTurn, gated by conditionsMet at cast time) and never
// expire (duration Infinity; the intercept consumes them via cheatDeathConsumed).
// Scoped to CHEAT_DEATH_BUFFS — other firing-slot recurring buffs (Panon, Sansi,
// Sentinel, Oleander…) keep the aura model for now (documented in coverage §5).
const castPathCheatDeath =
    !accumulating &&
    CHEAT_DEATH_BUFFS.has(cfg.buffName) &&
    (slot.slot === 'active' || slot.slot === 'charged');
const isAura =
    !accumulating && !castPathCheatDeath &&
    (cfg.duration === 'recurring' || cfg.duration === undefined);
```

and in the timed arm use `duration: castPathCheatDeath ? Infinity : (cfg.duration as number)`. Recipients for the carve-out: `ability.target === 'ally' ? [healTargetId ?? ownerId] : recipients-as-computed` (all-allies keeps playerIds) — scope this override to `castPathCheatDeath` only.
  - `playerTurn.ts`: accept `targetHpPct = 100` in the args (alongside `selfHpPct` at ~629) and pass it into the `buildRoundContext` calls (`buildRoundContext` lives where the other ctx fields are assembled — extend its input type the same way `selfHpPct` flows).
  - `engine.ts` call sites: compute once per acting turn, healing mode only: `const targetHpPct = healTarget ? (100 * Math.max(0, healTarget.currentHp)) / recipientMaxHp(healTarget.id) : 100;` — at TURN START of the acting actor (pre-this-cast-heal; deterministic, documented).
  - **Infinity display guard:** `grep -rn "turnsRemaining\|duration" src/components/calculators/ src/components/skills/ | grep -i "turn"` — wherever a buff duration renders or a `buff-applied` event's `duration` reaches UI text, guard with `Number.isFinite(d) ? \`${d} turns\` : 'permanent'` (plain text, no emoji). If nothing renders raw durations from these paths, note that in the commit body instead.

- [ ] **Step 4: Verify** — task tests green; FULL suite zero churn (synthetic goldens contain no firing-slot Cheat-Death grants — confirm by grepping the golden fixture files for `Cheat Death`).

- [ ] **Step 5: Commit** — `feat(combat): cast-path Cheat-Death grants — slot-fired, target-HP gated, heal-target narrowed`

### Task 6: Parser detectors + lock tests

**Files:**
- Modify: `src/utils/skillTextParser.ts` (new exported detectors near `detectDamageReactionTrigger` ~1068)
- Test: `src/utils/__tests__/skillTextParser.test.ts`

- [ ] **Step 1: Write failing lock tests** (mirror the `at(text, needle)` helper convention at ~2679). **Canonical input form:** feed the detector the same text shape the production wiring feeds it — plain text with `<br />` tags normalized to `'. '` BEFORE sentence scoping (`buildShipAbilities.ts:294` does `.replace(/<br\s*\/?>/gi, '. ')`). Los/Redeemer's clauses are separated by `<br />` in the raw CSV, so after normalization they ARE distinct sentences — do NOT test a raw br-stripped join like `"50%.Once per battle"`.
  - Tycho p2 → Barrier needle: `{ trigger: 'on-hp-threshold-crossed', hpBelowPct: 40, oncePerCombat: true }`; Cheat Death + Everliving needles in the SAME text → detector returns `undefined` (sentence scoping).
  - Shelter p2 → BOTH Barrier and "Inc. Damage Down II" needles match with `hpBelowPct: 20, oncePerCombat: true` (abbreviation masking proof — "Inc." period must not break the sentence scope).
  - Los p1 → Barrier needle: `{ …, hpBelowPct: 50, oncePerCombat: true }` (its own sentence after br-normalization); the "30% more Direct damage" clause's sentence does NOT match (no drops/falls verb — "when its HP is below 50%").
  - Kafa p1 → Terran Tenacity I: `{ …, hpBelowPct: 50, oncePerCombat: false/undefined }`.
  - Redeemer p1 → Defense Up II: `{ …, hpBelowPct: 60 }` (br-separated from the per-turn-shield sentence).
  - Negative guards: Makoli "while below 40% HP" (damage-reaction's), Tormenter "If its HP is below", Tithonus "when the target is below 10% HP", Chimei "allies below 40% HP" → all `undefined`.
  - Hermes charged → new target-gate detector: `{ hpBelowPct: 40 }` for "If the target has less than 40% HP"; negative on texts without "the target".

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement two detectors** (position-scoped, sentence-contained, using the SAME abbreviation-masked sentence helper the damage-reaction path uses — see `resolveBuffClause`/masking at ~526; per project memory this masking must exist on both parser and audit sides):

```typescript
const HP_CROSSING_RE = /\b(?:its\s+|this\s+unit'?s?\s+)?hp\s+(?:drops|falls)\s+below\s+(\d+(?:\.\d+)?)\s*%/i;
const ONCE_PER_BATTLE_RE = /\bonce per battle\b/i;
/** "when HP drops/falls below N%" buff-grant reactives (Tycho/Shelter/Los/Kafa/Redeemer).
 *  Sentence-scoped at the ability's anchor. Verb (drops|falls) REQUIRED — excludes the
 *  damage-reaction "while below N% HP" (Makoli), extra-action "If its HP is below"
 *  (Tormenter), enemy-scaling "when the target is below N%" (Tithonus), and ally-filter
 *  "allies below N% HP" (Chimei). Returns oncePerCombat when the sentence says
 *  "once per battle". */
export function detectHpCrossingTrigger(text: string, pos: number):
    { trigger: 'on-hp-threshold-crossed'; hpBelowPct: number; oncePerCombat: boolean } | undefined { … }
/** Hermes: "If the target has less than N% HP" gate on a grant clause. */
const TARGET_HP_GATE_RE = /\bif the target has less than\s+(\d+(?:\.\d+)?)\s*%\s*hp\b/i;
export function detectTargetHpGate(text: string, pos: number): { hpBelowPct: number } | undefined { … }
```

- [ ] **Step 4: Verify** — lock tests + full parser suite green.

- [ ] **Step 5: Commit** — `feat(parser): hp-crossing and target-HP-gate detectors`

### Task 7: `buildShipAbilities` wiring + built-ability lock tests

**Files:**
- Modify: `src/utils/abilities/buildShipAbilities.ts` (the buff/debuff merge loop where PR-1/PR-2 reactive wiring lives, ~1200–1267)
- Test: `src/utils/abilities/__tests__/buildShipAbilities.test.ts` (follow the existing built-ability lock-test convention from PR 2's five-ship task)

- [ ] **Step 1: Write failing built-ability lock tests** (full skill-text → built abilities):
  - Tycho p2: Barrier ability has `trigger: 'on-hp-threshold-crossed'`, `conditions: [{subject:'hp-threshold', derivable:true, hpComparator:'below', hpPercent:40, hpSubject:'self'}]`, `config.oncePerCombat: true`, `target: 'self'`, duration 1; Cheat Death stays `on-cast`/recurring; Everliving stays `on-cast`/9.
  - Shelter p2: BOTH grants carry the trigger + condition (20) + `oncePerCombat: true`, durations 1 and 3.
  - Los p1: Barrier wired (50, oncePerCombat); the outgoing-damage modifier keeps its existing hp-threshold condition and `on-cast` trigger (UNTOUCHED).
  - Kafa p1: Terran Tenacity I wired (50, NO oncePerCombat), duration 3.
  - Redeemer p1: Defense Up II wired (60), shield ability untouched.
  - Hermes charged: Cheat Death grant `target: 'ally'` (narrowed), `conditions: [{subject:'hp-threshold', derivable:true, hpComparator:'below', hpPercent:40, hpSubject:'target'}]`, duration 'recurring', trigger 'on-cast'; the 37% heal and +1 charge unchanged.
  - Hayyan charged: byte-identical to today (all-allies, unconditional — only the ENGINE cadence changed).

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement in the buff-merge loop** (mirror the PR-1 pattern at ~1212–1266): call `detectHpCrossingTrigger(rowText, pos)`; on match set `ability.trigger`, attach the self hp-threshold condition (overwrite-style like ~1251–1266), and set `config.oncePerCombat` when reported. Then the Hermes branch: when the merged buff is Cheat-Death-family and `detectTargetHpGate` matches at the grant's anchor, attach the `'target'` condition and narrow `target` `'all-allies'` → `'ally'` (comment: the clause names "the target"; spec PR 3 narrows the grant to the heal target). Order the checks so the crossing detector runs FIRST and short-circuits (a crossing grant is never also target-gated).

- [ ] **Step 4: Verify** — `npx vitest run src/utils/abilities/ src/utils/__tests__/skillTextParser.test.ts` green; full suite zero golden churn.

- [ ] **Step 5: Commit** — `feat(parser): wire hp-crossing reactives (Tycho/Shelter/Los/Kafa/Redeemer) + Hermes target-gated Cheat Death`

### Task 8: auditSkills parity

**Files:**
- Modify: `scripts/auditSkills.ts` (`ungatedFinding` ~219–241; coverage keyword rules ~107–169)
- Modify if needed: `scripts/auditSkills.allowlist.ts`

- [ ] **Step 1: Read the PR-2 parity diff for shape** (`git log --oneline --all -- scripts/auditSkills.ts`, then the relevant commit).
- [ ] **Step 2: Apply:** import + call `detectHpCrossingTrigger` (and `detectTargetHpGate` for the Cheat-Death clause) in `ungatedFinding` exactly where `detectDamageReactionTrigger` is consulted, so parser-modeled crossing grants stop flagging as ungated. Add/adjust a keyword coverage rule for "hp drops/falls below" phrasings if the rule table requires one. Remove any allowlist entries these ships needed before.
- [ ] **Step 3: Run** `npm run audit:skills` → no NEW findings; the six ships' crossing clauses no longer flagged; diff `docs/skill-audit.md` and sanity-read it.
- [ ] **Step 4: Commit** — `chore(audit): parity for hp-crossing + target-HP-gate detectors` (remember `git add -f docs/skill-audit.md` if the report is tracked that way — check `git status`).

### Task 9: Editor updates

**Files:**
- Modify: `src/components/skills/AbilityCard.tsx` (TRIGGER_OPTIONS ~121–137; buff/heal config controls)
- Modify: `src/components/skills/ConditionRow.tsx` (hpSubject select ~181–185)

- [ ] **Step 1:** Add `{ value: 'on-hp-threshold-crossed', label: 'When HP drops below a threshold' }` to TRIGGER_OPTIONS (the not-simulated label keys on LIVE_TRIGGERS and resolves itself). Add a `helpLabel`/hint on the trigger row IF the pattern exists for other triggers: the threshold N comes from a self hp-threshold condition — without one the reaction stays dormant.
- [ ] **Step 2:** ConditionRow: extend the hpSubject `Select` options with `{ value: 'target', label: 'Heal target' }` and widen the cast at ~184.
- [ ] **Step 3:** Add a "Once per battle" `Checkbox` (from `src/components/ui/`) to the buff config editor, wired to `config.oncePerCombat` — and to the heal config IF its fields render in the same block and the addition is one line (parity with Yazid's field; skip if heal fields live elsewhere — note it).
- [ ] **Step 4:** `npm run lint && npx tsc --noEmit`; manual sanity optional (dev server :3000 — do NOT push while the user is iterating UI).
- [ ] **Step 5: Commit** — `feat(editor): hp-crossing trigger option, heal-target HP subject, once-per-battle toggle`

### Task 10: New healing golden scenarios

**Files:**
- Test: `src/utils/calculators/__tests__/healingGoldenParity.test.ts` (+ its snapshot file, additively)

- [ ] **Step 1:** Add two scenarios (next free numbers; follow the `ab()`/`BASE`/`snap()` conventions and the hand-verification comment discipline):
  - **Crossing once-per-battle:** tank heal target + enemy attacker tuned so HP crosses below 40% in an early round, healer restores above 40, second crossing later; tank passive carries an `on-hp-threshold-crossed` Barrier-style buff (`oncePerCombat: true`). The snapshot locks ONE grant.
  - **Hermes-shape cast-path Cheat Death:** healer with charged heal + Cheat-Death buff ability (`target: 'ally'`, `'target'` hp-threshold 40, duration 'recurring'); enemy pressure puts the tank below 40% before a charged cast; a later lethal hit is saved at 1 HP. Snapshot locks the grant round + the save.
- [ ] **Step 2:** Run the file once to generate ONLY the two new snapshot entries; verify with `git diff` that every pre-existing snapshot entry is untouched (pure-additive). NEVER `vitest -u`.
- [ ] **Step 3:** Hand-verify the traces round-by-round and document them in the scenario comments (suite convention).
- [ ] **Step 4: Commit** — `test(combat): golden scenarios for hp-crossing once-per-battle and cast-path Cheat Death`

### Task 11: Docs + changelog

**Files:**
- Modify: `docs/skill-model-coverage.md` (§5 new "Phase 4c PR 3" block; §6 pending-item closure ~1143–1174; 4b KNOWN LIMITATIONS 1 & 2 get "resolved in 4c PR 3" notes ~707–715; refresh the "16-value union, 15 live" trigger-list phrasing wherever it appears — it was JUST refreshed in `d7f92a5b`, grep for it)
- Modify: `src/constants/changelog.ts` (UNRELEASED_CHANGES — FOLD into the one combat/healing entry)
- Check: `src/pages/DocumentationPage.tsx` — update only if it enumerates editor triggers/conditions (grep `on-ally-attacked` there to see if trigger lists are user-documented)

- [ ] **Step 1:** §5 block covering: trigger semantics (hp-changed once per HP-intake event — enemy attack or turn-start DoT batch, never per hit; crossing check; drain-time scrub rationale; oncePerCombat extension to buffs); the Cheat-Death cast-path carve-out (scope = CHEAT_DEATH_BUFFS on firing slots; Hayyan cadence side effect; Panon/Sansi/Quixilver/Malvex/Sentinel/Oleander explicitly NOT reclassified); approximations: heals/upward changes emit nothing, targetHpPct read at caster turn start (pre-heal), Barrier still name-only (4b convention), exact-vs-integer pct asymmetry vs the enemy dummy. Add the in-game verification items (spec §7): Hermes grant-narrowed-to-target; crossing-on-save behavior; DoT-tick crossings firing.
- [ ] **Step 2:** §6: mark "4c PR 3 — SHIPPED (date, branch)" with the ship list; 4b KNOWN LIMITATIONS 1 and 2 annotated resolved.
- [ ] **Step 3:** Changelog fold (plain English, one entry): Tycho/Shelter/Los Barrier and Kafa/Redeemer defensive buffs now trigger on real HP drops (once per battle where the game says so) instead of being always-on; Hermes' charged-skill Cheat Death now only triggers when the heal target is under 40% HP and protects that ship — add Hermes to the advertised Cheat-Death ship list (Yazid, Tycho, Hayyan, now Hermes); Hayyan's grant now applies when its charged skill fires.
- [ ] **Step 4:** `git add -f docs/skill-model-coverage.md` + the changelog; commit — `docs: coverage + changelog for 4c PR 3 hp-crossing reactives`

### Task 12: Final verification + PR

- [ ] **Step 1:** `npm run lint` (zero warnings) && `npx vitest run` (full suite green) && `npx tsc --noEmit`.
- [ ] **Step 2:** `git diff main --stat` — review for stray files; confirm ZERO modifications under `__snapshots__/` except the two additive entries; confirm no `docs/` file missing `-f` staging. Use superpowers:verification-before-completion.
- [ ] **Step 3:** `gh auth switch --hostname github.com --user TheSusort`, push branch, open PR titled `feat: combat engine phase 4c PR 3 — HP-threshold-crossed reactives` with a body summarizing: new trigger + tank hp-changed, six ships live, Hermes gate fix + narrowing, Hayyan cadence, approximations. Poll CodeRabbit via `mergeState=CLEAN` (NOT check status; incremental re-reviews take 10+ min).
- [ ] **Step 4:** Update project memory (`project_combat_engine_current_state.md`): PR-3 shipped facts, NEXT = PR 4 enemy-actions.
