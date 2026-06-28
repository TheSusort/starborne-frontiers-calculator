# Overload Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Model the full Overload buff lifecycle (kill-reset + Marauder Rage payoff + per-enemy gain caps) for the five Marauder-family ships in the combat simulator, and drop `overload` from the last "not-simulated" framing.

**Architecture:** One genuinely-new combat primitive — a `type:'remove-self-buff'` ability + `removeSelfBuffByName` status-engine method — handles "loses Overload on kill". Everything else reuses existing machinery: three new clause patterns wired into `detectReactiveTrigger` (two regexes already exist), the existing reactive buff-grant executor for Marauder Rage, and a small `oncePerRoundPerSource` extension to the existing per-round gate for Ruiner's per-enemy cap.

**Tech Stack:** TypeScript, Vitest, React. Combat engine in `src/utils/combat/`, ability parsing in `src/utils/abilities/` + `src/utils/skillTextParser.ts`.

**Spec:** `docs/superpowers/specs/2026-06-28-overload-lifecycle-design.md`

---

## Background facts (verified against code — do not re-derive)

- **Stores Overload can live in:** "gains Overload every turn" → **accumulating self store** (`accumSelfMaps`, via `registerAbilityStatuses` kind `accumulating`, statusEngine.ts:1064-1082 — NOT diverted to persistent). The `upsertBuff` door (statusEngine.ts:638-647) routes `PERSISTENT_STACKING_BUFFS`-named buffs to the **persistent self map** (`persistentSelfMaps`). Asphyxiator (start-of-round) and Ruiner (reactive) MAY land in the persistent map. `removeSelfBuffByName` must span **all three** self stores (timed `selfMaps`, accum `accumSelfMaps`, persistent `persistentSelfMaps`).
- **Listeners already exist and route to `executeIntent`:** `on-enemy-destroyed` (triggers.ts:592), `on-enemy-repaired` (triggers.ts:600, captures `eventCtx.repairerId`), `on-debuff-inflicted` (triggers.ts:345). All three triggers are in `LIVE_TRIGGERS`.
- **Reactive partition** keys on `LIVE_TRIGGERS.has(trigger) && REACTIVE_ABILITY_TYPES.includes(config.type)` (triggers.ts:154-157). A new `remove-self-buff` type MUST be added to `ReactiveAbilityType` (triggers.ts:53-64) and `REACTIVE_ABILITY_TYPES` (triggers.ts:67-79) or it will silently never fire.
- **Buff-grant path** resolves its trigger via `detectReactiveTrigger(rowText, buff.buffName)` (buildShipAbilities.ts:1602). So adding patterns to `detectReactiveTrigger` makes Marauder Rage grants auto-route to the correct trigger — no new grant code.
- **`detectReactiveTrigger`** (skillTextParser.ts:852-875) currently covers ally-crit / self-crit / start-of-round / bomb-detonate / cheat-death / enemy-cleanse only.
- **Existing regexes to reuse:** `ENEMY_DEATH_PHRASING_RE = /when an enemy dies|upon a kill|killing an enemy/i` (skillTextParser.ts:1961); `ENEMY_REPAIRS_RE = /\bwhen\s+an?\s+enemy\b[^.]*?\b(?:repairs?|performs?\s+a\s+repairs?)\b/i` (skillTextParser.ts:441). `ENEMY_DEBUFFED_RE` (skillTextParser.ts:1003) matches passive "enemy is debuffed", NOT "upon applying a debuff" — that needs a NEW pattern.
- **`loses` is in `SKIP_VERBS`** (skillTextParser.ts:2667) so `parseSkillEffects` returns `[]` for "loses Overload". Do NOT change `parseSkillEffects` — add a separate `parseSelfBuffRemovals` function so the buff path stays byte-identical.
- **`passesOncePerRoundGate`** (triggers.ts:1232-1238) keys `${ownerId}:${abilityId}` against the per-round-reset `oncePerRoundConsumed` set (reset each round, triggers.ts:822-823).
- **The 5 ships** (`src/constants/ships.ts`): Mangler (1357/1359), Ravager (1874/1876), Butcher (311/313), Asphyxiator (188/190), Ruiner (2033). Only the refit-active passive applies — resolve via `getShipSkillRows()`.
- **`'overload'` is never produced by any real parse** — `ControlEffect` membership (abilities.ts:543), `CONTROL_EFFECT_LABEL` (debuffImmunity.ts:37), and the `SIMULATED_CONTROL_EFFECTS` exclusion (simCoverage.ts:23-29) exist only for the synthetic badge.

## Golden discipline (READ BEFORE STARTING)

- **NEVER** run `vitest -u` to blanket-refresh goldens.
- This PR is **expected** to move DPS-calc goldens for the Marauder ships (Mangler/Ravager lose on-cast Marauder Rage; Butcher Rage and Ruiner Overload move off on-cast). Each moved golden must be **inspected** and confirmed to reflect the intended behavior change before being committed.
- Overload's every-turn accumulation in the DPS calc is **unchanged** (the dummy is indestructible → lose-on-kill never fires there). If an Overload-accumulation golden moves, STOP — something is wrong.
- Use `gh auth switch --hostname github.com --user TheSusort` before any `gh` command. Branch off `main` (not stacked).

---

## Task 1: Types — `remove-self-buff` type+config, `oncePerRoundPerSource` flag, drop `'overload'`, editor defaults

**Files:**
- Modify: `src/types/abilities.ts` (`AbilityType` union 6-29; AbilityConfig union ~329-532; Ability flags ~569-589; `ControlEffect` ~539-545)
- Modify: `src/components/skills/abilityDefaults.ts` (`makeDefaultConfig` switch 7-90; `DEFAULT_TARGETS` Record 93-117)
- Modify: `src/components/skills/AbilityTypePicker.tsx` (`TYPE_LABELS` Record 10)
- Modify: `src/components/skills/AbilityCard.tsx` (`ABILITY_TYPE_LABELS` Record 40)

> **Why the editor files:** `Ability.type` is typed `AbilityType` (a SEPARATE union at abilities.ts:6-29 from `AbilityConfig`). Adding the new type to ONLY `AbilityConfig` will not typecheck the Task 8 emit. Adding it to `AbilityType` then breaks three exhaustive `Record<AbilityType,…>` maps at compile time — they MUST be updated in this task. `AbilityCard.tsx`'s `renderBody` switch (248) has a `default` case (694-699) so it needs no editor body, only the label Record.

- [ ] **Step 0: Add `'remove-self-buff'` to the `AbilityType` union.**

In `AbilityType` (abilities.ts:6-29), add `| 'remove-self-buff'` (after `'control'`).

- [ ] **Step 1: Add the `remove-self-buff` AbilityConfig variant.**

In the `AbilityConfig` union (after the `control` variant ~456), add:

```ts
    // Overload lifecycle: "Upon killing an enemy, this Unit loses Overload". Removes a named
    // self-buff family from ALL of the owner's self stores. target:'self'; trigger carries the
    // reactive moment (on-enemy-destroyed for Overload). No grant — pure removal.
    | {
          type: 'remove-self-buff';
          /** The named buff family to clear from the owner's own stores. */
          buffName: string;
          /** Only 'all' is needed today ("loses Overload" clears the whole family). */
          scope: 'all';
      }
```

- [ ] **Step 2: Add the `oncePerRoundPerSource` top-level Ability flag.**

After the `oncePerRound?` field (~569), add:

```ts
    /** Overload (Ruiner): a reactive grant limited to once per round PER triggering source
     *  ("once per round per enemy"). Gated executor-side via oncePerRoundConsumed keyed
     *  `${ownerId}:${abilityId}:${eventSourceId}`. Distinct from `oncePerRound` (which is keyed
     *  per (owner,ability) only). Absent → no per-source per-round limit. */
    oncePerRoundPerSource?: boolean;
```

- [ ] **Step 3: Remove `'overload'` from `ControlEffect`.**

Change the `ControlEffect` union (~539-545) to drop `| 'overload'`. Update the JSDoc above it (the "Overload is the sole deferred exception" line, abilities.ts:536) to state all control effects are now simulated.

- [ ] **Step 4: Update the editor default/label sites broken by the new `AbilityType`.**

- `abilityDefaults.ts` `makeDefaultConfig` (switch, 7-90): add a case
  `case 'remove-self-buff': return { type: 'remove-self-buff', buffName: '', scope: 'all' };`
- `abilityDefaults.ts` `DEFAULT_TARGETS` (93-117): add `'remove-self-buff': 'self',`
- `AbilityTypePicker.tsx` `TYPE_LABELS` (10): add `'remove-self-buff': 'Remove Self Buff',`
- `AbilityCard.tsx` `ABILITY_TYPE_LABELS` (40): add `'remove-self-buff': 'Remove Self Buff',`

- [ ] **Step 5: Run tsc to see the remaining exhaustiveness fallout.**

Run: `npx tsc --noEmit`
Expected remaining errors (fixed in later tasks): `debuffImmunity.ts` `CONTROL_EFFECT_LABEL` Record has an extra `overload` key (Task 9); synthetic tests referencing `effect:'overload'` (Task 9); `executeIntent`/partition may warn on the new config type until Task 3. The three editor Records above should now be clean.

- [ ] **Step 6: Commit.**

```bash
git add src/types/abilities.ts src/components/skills/abilityDefaults.ts src/components/skills/AbilityTypePicker.tsx src/components/skills/AbilityCard.tsx
git commit -m "feat(combat): add remove-self-buff ability type/config + oncePerRoundPerSource flag; drop overload ControlEffect"
```

---

## Task 2: statusEngine `removeSelfBuffByName`

**Files:**
- Modify: `src/utils/combat/statusEngine.ts` (interface decl ~155-165; impl near `removeTimedEnemyStatus` ~940; export object ~1263)
- Test: `src/utils/combat/__tests__/statusEngine.test.ts`

- [ ] **Step 1: Write the failing test.**

In `statusEngine.test.ts`, add a `describe('removeSelfBuffByName')` block. Cover all three stores. Use the existing helpers (`makeAccumBuff`, `makeBuff`) and the engine setup pattern already in the file. Minimum cases:

```ts
it('clears an accumulating self buff (gains-every-turn Overload)', () => {
    const engine = /* setup as existing accum tests do */;
    // register an accumulating 'Overload' self status, beginRound, increment so stacks>0
    // assert snapshot shows Overload present
    engine.removeSelfBuffByName('attacker', 'Overload');
    // assert snapshot self buffs no longer include Overload
});

it('clears a persistent-stacking self buff', () => {
    // apply 'Overload' via the persistent door (upsertBuff self / addPersistentStack)
    // assert present, then removeSelfBuffByName, assert gone
});

it('clears a timed self buff family', () => {
    // applyTimedAbilityStatus a timed self buff, assert present, remove, assert gone
});

it('is a safe no-op for unknown actor / unknown name', () => {
    expect(() => engine.removeSelfBuffByName('nobody', 'Overload')).not.toThrow();
    expect(() => engine.removeSelfBuffByName('attacker', 'Nonexistent')).not.toThrow();
});
```

> Read the existing tests around statusEngine.test.ts:93 and :279 for the exact accum/persistent setup idioms before writing — mirror them so the test is realistic.

- [ ] **Step 2: Run to verify it fails.**

Run: `npm test -- statusEngine.test.ts -t removeSelfBuffByName`
Expected: FAIL — `engine.removeSelfBuffByName is not a function`.

- [ ] **Step 3: Implement `removeSelfBuffByName`.**

Add the interface method near `removeTimedEnemyStatus` decl (~159-163):

```ts
    /** Remove a named buff family from ALL of `actorId`'s self stores (timed selfMaps,
     *  accumulating accumSelfMaps, persistent persistentSelfMaps). Used by the
     *  remove-self-buff executor (Overload lose-on-kill). Lazy-empty / unknown id / unknown
     *  name → safe no-op. */
    removeSelfBuffByName(actorId: string, buffName: string): void;
```

Add the implementation next to `removeTimedEnemyStatus` (~944). **Verify the exact map names and key shape for each store** (timed self map is `selfMaps`, keyed by `deriveFamilyKey(buffName).familyKey`; accum self map is `accumSelfMaps`, keyed by `payload.buffName`; persistent self map is `persistentSelfMaps` — confirm its key by reading `addPersistentStack` ~517-543):

```ts
    const removeSelfBuffByName = (actorId: string, buffName: string): void => {
        const timed = selfMaps.get(actorId);
        if (timed) timed.delete(deriveFamilyKey(buffName).familyKey);
        const accum = accumSelfMaps.get(actorId);
        if (accum) accum.delete(buffName); // accum keyed by payload.buffName
        // persistent self map — confirm getter/key against addPersistentStack before finalizing
        const persistent = persistentSelfMaps.get(actorId);
        if (persistent) persistent.delete(/* persistent key for buffName */);
    };
```

Export it in the returned object (~1263, alongside `clearRemovable`).

- [ ] **Step 4: Run to verify it passes.**

Run: `npm test -- statusEngine.test.ts -t removeSelfBuffByName`
Expected: PASS (all 4 cases).

- [ ] **Step 5: Commit.**

```bash
git add src/utils/combat/statusEngine.ts src/utils/combat/__tests__/statusEngine.test.ts
git commit -m "feat(combat): statusEngine.removeSelfBuffByName clears a named buff from all self stores"
```

- [ ] **Step 6: Write a failing test for the per-application persistent cap override (Ruiner cap-5).**

`addPersistentStack` caps at the GLOBAL `PERSISTENT_STACKING_BUFFS.get('Overload')` = 10 (statusEngine.ts:528), ignoring a per-application limit. Ruiner's "Overload with a limit of 5" reactive grant flows through `applyTimedAbilityStatus` → the persistent branch (statusEngine.ts:1123-1131) → `addPersistentStack`, so it would climb to 10. Add a statusEngine test: apply `Overload` self with a payload-carried `maxStacks: 5` six times via the persistent door; assert stacks cap at 5, not 10. Also assert that an application with NO override still caps at the global 10 (byte-identical for the every-turn ships).

- [ ] **Step 7: Run to verify it fails.**

Run: `npm test -- statusEngine.test.ts -t 'cap'`
Expected: FAIL — caps at 10.

- [ ] **Step 8: Implement the cap override.**

Add an optional `capOverride?: number` param to `addPersistentStack` (or read `payload.maxStacks` if the payload already carries it — CHECK `AbilityStatusPayload` and `payloadFromConfig` in triggers.ts:1174; if `maxStacks` is not threaded, add it to the payload from the buff config). Compute the effective cap as `min(globalCap ?? Infinity, override ?? Infinity)` (when both absent → uncapped, unchanged). Thread the override from BOTH persistent callers:
- `applyTimedAbilityStatus` persistent branch (statusEngine.ts:1123-1131) → pass `status.payload.maxStacks`.
- `upsertBuff` persistent branch (statusEngine.ts:644-646) → pass `buff.maxStacks`.

> The every-turn ships use the ACCUM door (per-ability `maxStacks` already honored at registration, statusEngine.ts:1076) — unaffected. Only the persistent door needed this. Verify no existing persistent golden moves (Defense Shred/Blast/Titanite carry no per-app override → `min(globalCap, Infinity)` = unchanged).

- [ ] **Step 9: Run to verify it passes + commit.**

Run: `npm test -- statusEngine.test.ts` → PASS.

```bash
git add src/utils/combat/statusEngine.ts src/utils/combat/triggers.ts src/utils/combat/__tests__/statusEngine.test.ts
git commit -m "feat(combat): persistent-stack per-application cap override (Ruiner Overload limit 5)"
```

---

## Task 3: `executeIntent` remove-self-buff branch + reactive partition

**Files:**
- Modify: `src/utils/combat/triggers.ts` (`ReactiveAbilityType` 53-64; `REACTIVE_ABILITY_TYPES` 67-79; new branch in `executeIntent` ~1307+)
- Test: `src/utils/combat/__tests__/triggers.test.ts`

- [ ] **Step 1: Write the failing test.**

In `triggers.test.ts`, add a test that builds an `Intent` for a `remove-self-buff` ability (trigger `on-enemy-destroyed`, target `self`, `config:{type:'remove-self-buff', buffName:'Overload', scope:'all'}`) and an `IntentExecContext` whose `statusEngine` is a spy/real engine carrying an Overload self buff. Assert that after `executeIntent(intent, ctx)`, `ctx.statusEngine.removeSelfBuffByName` was called with `(ownerId, 'Overload')` (or the buff is gone from a real engine). Mirror the existing executeIntent test setup in this file.

- [ ] **Step 2: Run to verify it fails.**

Run: `npm test -- triggers.test.ts -t 'remove-self-buff'`
Expected: FAIL — no removal happens (branch missing) / removeSelfBuffByName not called.

- [ ] **Step 3: Add `'remove-self-buff'` to the partition type + runtime mirror.**

In `ReactiveAbilityType` (after `'purge'` ~64) add `| 'remove-self-buff'`. In `REACTIVE_ABILITY_TYPES` (~78) add `'remove-self-buff',`.

- [ ] **Step 4: Add the executor branch.**

In `executeIntent`, after the `cfg.type === 'cleanse'` branch (~1752) or alongside the other self-side branches, add:

```ts
    if (cfg.type === 'remove-self-buff') {
        // Overload lose-on-kill: clear the named family from the owner's self stores.
        // The drain-time condition gate above already applied; no proc/once gate needed.
        ctx.statusEngine.removeSelfBuffByName(intent.ownerId, cfg.buffName);
        return;
    }
```

(No event emission — no consumer reacts to a self-buff removal.)

- [ ] **Step 5: Run to verify it passes + tsc.**

Run: `npm test -- triggers.test.ts -t 'remove-self-buff'` → PASS
Run: `npx tsc --noEmit` → the executeIntent non-exhaustive warning for `remove-self-buff` is now resolved.

- [ ] **Step 6: Commit.**

```bash
git add src/utils/combat/triggers.ts src/utils/combat/__tests__/triggers.test.ts
git commit -m "feat(combat): executeIntent remove-self-buff branch + reactive partition"
```

---

## Task 4: `oncePerRoundPerSource` gate

**Files:**
- Modify: `src/utils/combat/triggers.ts` (`passesOncePerRoundGate` ~1232-1238)
- Test: `src/utils/combat/__tests__/reactiveOncePerRoundGate.test.ts`

- [ ] **Step 1: Write the failing test.**

In `reactiveOncePerRoundGate.test.ts`, add cases for `oncePerRoundPerSource`:
- Two events from DIFFERENT sources in the same round both pass (distinct `eventCtx` source ids).
- A second event from the SAME source in the same round is blocked.
- After a round reset (clear `oncePerRoundConsumed`), the same source passes again.

Build the ability with `oncePerRoundPerSource: true` and intents whose `eventCtx.repairerId` (or the resolved source id) differs. Mirror the existing oncePerRound tests in this file. **Include at least one test that drives the gate through the `buff` branch of `executeIntent`** (a `type:'buff'` ability with `oncePerRoundPerSource` + on-enemy-repaired), since that branch is the one Ruiner uses and the one missing the gate call (Step 3b).

- [ ] **Step 2: Run to verify it fails.**

Run: `npm test -- reactiveOncePerRoundGate.test.ts -t oncePerRoundPerSource`
Expected: FAIL — flag ignored (both same-source events pass / behaves like no gate).

- [ ] **Step 3: Extend the gate.**

In `passesOncePerRoundGate` (~1232), before/within the existing logic:

```ts
function passesOncePerRoundGate(intent: Intent, ctx: IntentExecContext): boolean {
    if (intent.ability.oncePerRoundPerSource) {
        const source = intent.eventCtx?.repairerId ?? ''; // the triggering source id
        const key = `${intent.ownerId}:${intent.ability.id}:${source}`;
        if (ctx.oncePerRoundConsumed?.has(key)) return false;
        ctx.oncePerRoundConsumed?.add(key);
        return true;
    }
    if (!intent.ability.oncePerRound) return true;
    const onceKey = `${intent.ownerId}:${intent.ability.id}`;
    if (ctx.oncePerRoundConsumed?.has(onceKey)) return false;
    ctx.oncePerRoundConsumed?.add(onceKey);
    return true;
}
```

> Confirm which `eventCtx` field carries the source for the trigger Ruiner uses (`repairerId` for on-enemy-repaired, triggers.ts:133-136, stamped on the intent at triggers.ts:606-608). If a future trigger needs a different source field, generalize then — YAGNI now.

- [ ] **Step 3b (MANDATORY): add the gate call to the `buff` branch.**

The `cfg.type === 'buff'` branch (triggers.ts:1340-1463) currently gates ONLY on `oncePerCombat` (1344) and `passesProcChanceGate` (1353) — it does **not** call `passesOncePerRoundGate`. (The `~1624` reference is the heal/shield branch, NOT buff.) Ruiner's Overload is a `buff` grant, so without this the per-source gate is dead code. Add, immediately after the `passesProcChanceGate` check (~1353):

```ts
        if (!passesOncePerRoundGate(intent, ctx)) return;
```

This is byte-identical for every existing buff grant (they set neither `oncePerRound` nor `oncePerRoundPerSource`, so the gate returns true without marking).

- [ ] **Step 4: Run to verify it passes.**

Run: `npm test -- reactiveOncePerRoundGate.test.ts` → PASS (new + existing cases).

- [ ] **Step 5: Commit.**

```bash
git add src/utils/combat/triggers.ts src/utils/combat/__tests__/reactiveOncePerRoundGate.test.ts
git commit -m "feat(combat): oncePerRoundPerSource per-source per-round reactive gate"
```

---

## Task 5: `detectReactiveTrigger` — three new trigger patterns

**Files:**
- Modify: `src/utils/skillTextParser.ts` (`detectReactiveTrigger` 852-875; new `APPLYING_DEBUFF_RE` const near other reactive consts)
- Test: `src/utils/__tests__/skillTextParser.test.ts`

- [ ] **Step 1: Write the failing tests.**

In `skillTextParser.test.ts`, add `detectReactiveTrigger` cases:

```ts
it('detects on-enemy-destroyed from "upon killing an enemy"', () => {
    expect(detectReactiveTrigger(
        'Upon killing an enemy, this Unit gains Marauder Rage 1 for 2 turns', 'Marauder Rage 1'
    )).toBe('on-enemy-destroyed');
});
it('detects on-enemy-repaired from "when an enemy performs a repair"', () => {
    expect(detectReactiveTrigger(
        'gains Overload with a limit of 5 when an enemy performs a repair on themselves', 'Overload'
    )).toBe('on-enemy-repaired');
});
it('detects on-debuff-inflicted from "upon applying a debuff"', () => {
    expect(detectReactiveTrigger(
        'gains Marauder Rage 2 for 3 turns upon applying a debuff', 'Marauder Rage 2'
    )).toBe('on-debuff-inflicted');
});
```

- [ ] **Step 2: Run to verify they fail.**

Run: `npm test -- skillTextParser.test.ts -t detectReactiveTrigger`
Expected: FAIL — all three return `undefined`.

- [ ] **Step 3: Add the new pattern + wire all three.**

Near the other reactive consts (~818-828) add:

```ts
const APPLYING_DEBUFF_RE = /\b(?:upon|after|when)\s+(?:inflicting|applying)\s+(?:a\s+)?debuff/i;
```

In `detectReactiveTrigger` (after the existing checks, ~873) add (order: more specific first; these are disjoint by wording so order is not critical, but keep enemy-cleanse before for parity):

```ts
    if (ENEMY_DEATH_PHRASING_RE.test(clause)) return 'on-enemy-destroyed';
    if (ENEMY_REPAIRS_RE.test(clause)) return 'on-enemy-repaired';
    if (APPLYING_DEBUFF_RE.test(clause)) return 'on-debuff-inflicted';
```

> `ENEMY_DEATH_PHRASING_RE` (1961) and `ENEMY_REPAIRS_RE` (441) are declared later in the file but are module-scope `const` — confirm they are in scope at `detectReactiveTrigger` (hoisted module consts are; if declared with `const` BELOW and used above at call-time it's fine since `detectReactiveTrigger` runs after module init). If a TDZ error appears, move the const declarations above `detectReactiveTrigger`.

- [ ] **Step 4: Run to verify they pass + no regressions.**

Run: `npm test -- skillTextParser.test.ts` → PASS (new + all existing).

- [ ] **Step 5: Commit.**

```bash
git add src/utils/skillTextParser.ts src/utils/__tests__/skillTextParser.test.ts
git commit -m "feat(combat): detectReactiveTrigger recognizes kill/repair/apply-debuff phrasings"
```

---

## Task 6: parser `parseSelfBuffRemovals` ("loses X" → descriptor)

**Files:**
- Modify: `src/utils/skillTextParser.ts` (new exported `parseSelfBuffRemovals`)
- Test: `src/utils/__tests__/skillTextParser.test.ts`

- [ ] **Step 1: Write the failing test.**

```ts
describe('parseSelfBuffRemovals', () => {
    it('emits a remove descriptor for "loses Overload" with the resolved trigger', () => {
        expect(parseSelfBuffRemovals(
            'Upon killing an enemy, this Unit loses <unit-skill>Overload</unit-skill>'
        )).toEqual([{ buffName: 'Overload', trigger: 'on-enemy-destroyed' }]);
    });
    it('returns [] when there is no "loses <buff>" clause', () => {
        expect(parseSelfBuffRemovals('This Unit gains Overload every turn')).toEqual([]);
    });
    it('does not emit for a "loses" clause whose buff is unknown', () => {
        expect(parseSelfBuffRemovals('this Unit loses <unit-skill>Nonsense</unit-skill>')).toEqual([]);
    });
});
```

- [ ] **Step 2: Run to verify it fails.**

Run: `npm test -- skillTextParser.test.ts -t parseSelfBuffRemovals`
Expected: FAIL — `parseSelfBuffRemovals is not a function`.

- [ ] **Step 3: Implement.**

Add an exported `parseSelfBuffRemovals(text)` that scans the (tag-stripped or tagged) text for `loses <unit-skill>NAME</unit-skill>` occurrences, resolves NAME via `resolveBuffName` (skip unknown), and resolves the trigger via `detectReactiveTrigger(text, name)` (default `on-cast` if undefined — but for the corpus it will always resolve to `on-enemy-destroyed`). Return `{ buffName, trigger }[]`. Reuse the existing tag/segment helpers; do NOT touch `parseSkillEffects` (its `SKIP_VERBS` 'loses' behavior stays).

```ts
export function parseSelfBuffRemovals(
    text: string
): { buffName: string; trigger: AbilityTrigger }[] {
    // find "loses <unit-skill>X</unit-skill>" → resolveBuffName(X); skip unknown;
    // trigger = detectReactiveTrigger(text, X) ?? 'on-cast'
}
```

- [ ] **Step 4: Run to verify it passes.**

Run: `npm test -- skillTextParser.test.ts -t parseSelfBuffRemovals` → PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/utils/skillTextParser.ts src/utils/__tests__/skillTextParser.test.ts
git commit -m "feat(combat): parseSelfBuffRemovals emits remove descriptors for 'loses <buff>'"
```

---

## Task 7: parser — "once per round per enemy" detection

**Files:**
- Modify: `src/utils/skillTextParser.ts` (helper, e.g. `detectOncePerRoundPerSource(clause): boolean`)
- Test: `src/utils/__tests__/skillTextParser.test.ts`

- [ ] **Step 1: Write the failing test.**

```ts
it('detects once-per-round-per-enemy', () => {
    expect(detectOncePerRoundPerSource('this effect is limited to once per round per enemy')).toBe(true);
    expect(detectOncePerRoundPerSource('limited to once per round')).toBe(false);
});
```

- [ ] **Step 2: Run to verify it fails.** `npm test -- skillTextParser.test.ts -t once-per-round-per-enemy` → FAIL.

- [ ] **Step 3: Implement** a small exported helper with a regex like `/once per round per (?:enemy|target|ally)/i`. Keep plain "once per round" detection (if any exists elsewhere) untouched.

- [ ] **Step 4: Run to verify it passes.** → PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/utils/skillTextParser.ts src/utils/__tests__/skillTextParser.test.ts
git commit -m "feat(combat): detect 'once per round per enemy' clause"
```

---

## Task 8: buildShipAbilities wiring (emit remove-self-buff + set oncePerRoundPerSource)

**Files:**
- Modify: `src/utils/abilities/buildShipAbilities.ts` (emit remove-self-buff abilities; set `oncePerRoundPerSource` on Ruiner's Overload buff)
- Test: `src/utils/abilities/__tests__/buildShipAbilities.test.ts` (confirmed to exist)

- [ ] **Step 1: Write the failing tests.**

Drive off the real ship rows (use `getShipSkillRows`/the build entry point as existing tests do). Assert:
- Mangler (refit-active passive) produces a `remove-self-buff` ability `{buffName:'Overload', scope:'all'}`, `target:'self'`, `trigger:'on-enemy-destroyed'`, AND a `buff` ability for `Marauder Rage 1` with `trigger:'on-enemy-destroyed'`.
- Butcher produces a `Marauder Rage 2` buff ability with `trigger:'on-debuff-inflicted'` and a remove-self-buff Overload on-enemy-destroyed.
- Ruiner produces an Overload `buff` ability with `trigger:'on-enemy-repaired'` and `oncePerRoundPerSource:true`, AND a remove-self-buff Overload on-enemy-destroyed.
- Asphyxiator produces a remove-self-buff Overload on-enemy-destroyed (its grants are start-of-round — verified already-working).

- [ ] **Step 2: Run to verify they fail.** → FAIL (no remove-self-buff abilities; Ruiner flag unset).

- [ ] **Step 3: Implement the wiring.**

In the `abilitiesFromText`/build flow (near the other parse-emit blocks, e.g. after the extra-action block ~1366-1392), add a loop over `parseSelfBuffRemovals(text)`:

```ts
for (const rem of parseSelfBuffRemovals(text)) {
    const removePos = text.indexOf(rem.buffName);
    out.push({
        ability: {
            id: nextId(),
            type: 'remove-self-buff',
            target: 'self',
            trigger: rem.trigger,
            conditions: [],
            config: { type: 'remove-self-buff', buffName: rem.buffName, scope: 'all' },
            autoFilled: true,
        },
        pos: removePos >= 0 ? removePos : MAX_POS,
    });
}
```

In `mergeBuff` (~1585-1607), after the reactive trigger is set, set the per-source flag when the clause says so:

```ts
if (reactiveTrigger === 'on-enemy-repaired' && rowText && detectOncePerRoundPerSource(rowText)) {
    ability.oncePerRoundPerSource = true;
}
```

(Confine to `on-enemy-repaired` to match the corpus; broaden later only if needed.)

- [ ] **Step 4: Run to verify they pass.** → PASS.

- [ ] **Step 5: Run `audit:skills`.**

Run: `npm run audit:skills` (or the project's skill-audit command)
Expected: clean (0 failures). Investigate any new warnings against these 5 ships.

- [ ] **Step 6: Commit.**

```bash
git add src/utils/abilities/buildShipAbilities.ts src/utils/abilities/__tests__/*
git commit -m "feat(combat): build remove-self-buff abilities + Ruiner oncePerRoundPerSource"
```

---

## Task 9: simCoverage / CONTROL_EFFECT_LABEL cleanup

**Files:**
- Modify: `src/utils/combat/debuffImmunity.ts` (`CONTROL_EFFECT_LABEL` ~33-40)
- Modify: `src/components/skills/simCoverage.ts` (comments ~14-29; `SIMULATED_CONTROL_EFFECTS`)
- Test: `src/components/skills/__tests__/simCoverage.test.ts`, `src/components/skills/__tests__/AbilityCard.test.tsx`

- [ ] **Step 1: Update the tests first (behavior change).**

In `simCoverage.test.ts`: the "still flags an unmodeled control effect (overload)" test (~23) is now invalid — `overload` is no longer a `ControlEffect`. Replace with a test asserting `isAbilityNotSimulated` returns `false` for every `ControlEffect` value (iterate the enum, or assert the previously-flagged cases are now simulated), and that `NOT_SIMULATED_TYPES` is empty. Update the "does not contain overload" test (~46) as needed.
In `AbilityCard.test.tsx`: the synthetic `effect:'overload'` not-simulated test (~93-102) — either remove it or repoint it (there is no longer an unmodeled control effect). If a not-simulated badge test is still wanted, it must use a different mechanism (none exists → remove the overload-specific case).

- [ ] **Step 2: Run to verify they fail / tsc errors surface.**

Run: `npx tsc --noEmit` → `effect:'overload'` literals no longer typecheck.
Run: `npm test -- simCoverage.test.ts AbilityCard.test.tsx` → FAIL until code updated.

- [ ] **Step 3: Remove `overload` from `CONTROL_EFFECT_LABEL`** (debuffImmunity.ts:37) — the `Record<ControlEffect,string>` type forces this. Update `SIMULATED_CONTROL_EFFECTS` (simCoverage.ts:23-29) to list the remaining effects (it now equals the full enum) and refresh the surrounding comments (lines 14-15, 21, 36-37) to drop the "Overload remains unmodeled" language. Leave `NOT_SIMULATED_TYPES` empty and `isAbilityNotSimulated` intact.

- [ ] **Step 3b: Refresh the now-false comment in `persistentStackingBuffs.ts:15-16`** — the "Overload … kills never occur in-sim → permanent here; per-kill removal is a Phase 4 concern" line is no longer true (lose-on-kill is now modeled). Reword to note Overload is cleared on kill via the remove-self-buff path in the combat sim (still permanent in the DPS calc, where the dummy is indestructible).

- [ ] **Step 4: Run to verify pass + tsc.**

Run: `npx tsc --noEmit` → clean.
Run: `npm test -- simCoverage.test.ts AbilityCard.test.tsx` → PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/utils/combat/debuffImmunity.ts src/components/skills/simCoverage.ts src/components/skills/__tests__/* src/constants/persistentStackingBuffs.ts
git commit -m "feat(combat): drop overload from control not-simulated framing (last unmodeled effect)"
```

---

## Task 10: Engine combat fixtures — lifecycle behavior + team symmetry

**Files:**
- Test: new `src/utils/combat/__tests__/overloadLifecycle.test.ts` (engine-level); reference `enemyReactiveSelfBuffs.test.ts` and `enemyActions.test.ts` for the bySide/enemy-side setup idioms.

- [ ] **Step 1: Write the failing engine tests.**

Build a small battle where a Marauder-family player ship attacks a **destructible** enemy and gets a kill. Assert:
1. **Overload reset on kill:** before the kill the ship has Overload stacks (in its actual store — assert against the store this ship uses; see Background facts); the round its kill resolves, Overload is gone.
2. **Marauder Rage on kill (Mangler/Ravager):** after the kill, the ship carries the correct Marauder Rage tier/duration.
3. **Butcher Rage on debuff-inflict:** Butcher gains Marauder Rage when it inflicts a debuff (no kill required).
4. **Ruiner per-enemy gain + cap-5:** Ruiner gains Overload when an enemy self-repairs, at most once per round per enemy, and never exceeds 5 stacks.
5. **Asphyxiator SoR conditional:** with an enemy carrying ≥3 debuffs, Asphyxiator gains Overload + Marauder Rage at start of round.
6. **Team symmetry:** an **enemy-side** Marauder that kills a **player** ship loses its Overload and gains Marauder Rage identically (mirror `enemyReactiveSelfBuffs.test.ts`).

Keep each assertion in its own `it` for isolation.

- [ ] **Step 2: Run to verify they fail.**

Run: `npm test -- overloadLifecycle.test.ts`
Expected: FAIL (behaviors not yet exercised end-to-end / store assertions wrong). If any fail for a wiring reason (ability not partitioned, listener not firing), fix in the relevant earlier task's file and note it.

- [ ] **Step 3: Make them pass.**

Most behavior should already work from Tasks 1-9 (lose-on-kill from Task 3; per-source gate from Task 4 incl. the mandatory buff-branch gate call; cap-5 from Task 2 Step 8). This task proves the end-to-end path and catches any remaining integration gaps. Fix integration gaps in their source files (with a note in the commit).

- [ ] **Step 4: Run to verify they pass.** → PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/utils/combat/__tests__/overloadLifecycle.test.ts src/utils/combat/*
git commit -m "test(combat): Overload lifecycle engine fixtures (kill-reset, Rage, Ruiner cap, symmetry)"
```

---

## Task 11: Changelog + documentation

**Files:**
- Modify: `src/constants/changelog.ts` (`UNRELEASED_CHANGES` ~8)
- Modify: `src/pages/DocumentationPage.tsx` (if Overload/Marauder behavior is described)

- [ ] **Step 1: Add a changelog entry.**

Append to `UNRELEASED_CHANGES` a plain-English line, e.g.:
`'Combat simulator now models the Overload lifecycle: Marauder-family ships lose all Overload when they kill an enemy and gain Marauder Rage, with Ruiner''s per-enemy Overload gain cap.'`

- [ ] **Step 2: Update in-app docs** if the DPS/combat docs mention Overload or Marauder ships (search DocumentationPage for "Overload"/"Marauder"/"not simulated"). Keep scope minimal.

- [ ] **Step 3: Commit.**

```bash
git add src/constants/changelog.ts src/pages/DocumentationPage.tsx
git commit -m "docs(combat): changelog + docs for Overload lifecycle"
```

---

## Task 12: Full-suite verification, golden review, code review, PR

- [ ] **Step 1: Run the full suite.**

Run: `npm test`
Expected: all green. **Inspect every moved golden** (expect Marauder-ship DPS goldens to move — Mangler/Ravager lose on-cast Rage; Butcher Rage + Ruiner Overload move off on-cast). Confirm each reflects the intended change. If an Overload-accumulation golden moved, STOP and investigate. Do NOT `vitest -u`.

- [ ] **Step 2: Lint + types.**

Run: `npm run lint` (max-warnings 0) and `npx tsc --noEmit` → clean.

- [ ] **Step 3: `audit:skills`.**

Run: `npm run audit:skills` → 0 failures.

- [ ] **Step 4: Code review.**

Use superpowers:requesting-code-review. Address findings per superpowers:receiving-code-review.

- [ ] **Step 5: Open the PR.**

```bash
gh auth switch --hostname github.com --user TheSusort
gh pr create --base main --title "feat(combat): Overload lifecycle — kill-reset + Marauder Rage + per-enemy caps" --body "<summary + spec link + golden-churn note>"
```

End PR body with the Claude Code generated-with footer.

---

## Notes for the implementer

- **Team symmetry is a locked invariant** ([[feedback_engine_team_symmetry]]): a ship must behave identically on either side. All new paths ride team-agnostic triggers already; the symmetry fixture (Task 10.6) is the proof.
- **Store-aware assertions** (Task 2 / Task 10): each ship's Overload may live in a different self store. Do not blindly assert the accumulating store for all five; check the store the ship actually uses (see Background facts + §6 of the spec).
- **Ruiner cap-5** (spec §6): implemented in Task 2 Step 8 (per-application cap override on the persistent door). Ruiner's reactive Overload routes through the persistent door (verified), so the override is REQUIRED, not optional. Task 10.4 is the end-to-end proof.
- **Combat-engine workflow:** work on the `main` checkout (avoids the fresh-worktree esbuild crash, [[project_fresh_worktree_vite_esbuild_crash]]); ensure `.env` is present for the full suite ([[project_worktree_missing_env_test_failures]]).
