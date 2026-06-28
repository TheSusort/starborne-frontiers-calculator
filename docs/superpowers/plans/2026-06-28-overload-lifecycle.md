# Overload Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Model the Overload buff lifecycle (kill-reset + Marauder Rage payoff) for the five Marauder-family ships in the combat simulator, and drop `overload` from the last "not-simulated" framing.

**Architecture:** One new combat primitive — a `type:'remove-self-buff'` ability + `removeSelfBuffByName` status-engine method — handles "loses Overload on kill". Everything else is parser/trigger wiring over existing machinery: new clause patterns in `detectReactiveTrigger` and a broadened removal parser, then the existing reactive buff-grant executor handles Marauder Rage.

**Tech Stack:** TypeScript, Vitest, React. Combat engine in `src/utils/combat/`, ability parsing in `src/utils/abilities/` + `src/utils/skillTextParser.ts`.

**Spec:** `docs/superpowers/specs/2026-06-28-overload-lifecycle-design.md`

---

## CRITICAL: text source

The skill parser and `audit:skills` run against **`docs/ship-skills.csv`** (tagged text), NOT
`src/constants/ships.ts` (untagged, differently worded — do NOT derive patterns from it).
`auditSkills.ts` runs **every** passive variant (p1/p2/p3) through `buildShipAbilities`. The 5 ships'
CSV passive texts (read them directly before writing tests — `grep -i '^<Ship>,' docs/ship-skills.csv`):

- **Mangler** p1/p2: "This Unit gains 1 stack of `Overload` every turn and loses `Overload` **on kill**. Additionally, it gains `Marauder Rage I`/`II` for N turns **upon killing an opponent**."
- **Ravager** p1: "…every turn and, **upon killing an enemy**, loses `Overload` and gains `Marauder Rage III` for 3 turns." p2: "…**Upon killing an enemy**, it loses `Overload` and gains `Marauder Rage III`…"
- **Butcher** p1: "…loses `Overload` **upon killing an enemy**." p2: "…**On kill, `Overload` is lost**. **On inflicting a debuff**, this Unit gains `Marauder Rage II` for 3 turns."
- **Asphyxiator** p1/p2: "**At the start of the round, if there are any enemies with 3 or more debuffs**, this Unit gains 1 stack of `Overload` and gains `Marauder Rage II` for 3 turns. **Upon killing an enemy**, this Unit loses `Overload`."
- **Ruiner** p2: "…This Unit gains 1 stack of `Overload` **when an enemy performs a repair**, upon killing an enemy, this Unit **removes** `Overload`." (no cap, no per-enemy limit on Overload — those are on Ruiner's Bomb inflict, out of scope.)

`resolveBuffClause` strips tags + converts `<br/>` to a sentence break before `detectReactiveTrigger`
matches, so trigger patterns operate on PLAIN text; `parseSelfBuffRemovals`/buff parsers see TAGGED text.

## Background facts (verified — do not re-derive)

- **Stores:** "gains every turn" Overload → accumulating self store (`accumSelfMaps`, via
  `registerAbilityStatuses` kind `accumulating`, statusEngine.ts:1064-1082 — not diverted to
  persistent). The `upsertBuff`/`applyTimedAbilityStatus` persistent door routes
  `PERSISTENT_STACKING_BUFFS`-named buffs to `persistentSelfMaps`. Asphyxiator/Ruiner may land
  there. `removeSelfBuffByName` must span all three self stores (`selfMaps`, `accumSelfMaps`,
  `persistentSelfMaps`).
- **Listeners already exist + route to `executeIntent`:** `on-enemy-destroyed` (triggers.ts:592),
  `on-enemy-repaired` (600), `on-debuff-inflicted` (345); all in `LIVE_TRIGGERS`.
- **Reactive partition:** `LIVE_TRIGGERS.has(trigger) && REACTIVE_ABILITY_TYPES.includes(config.type)`
  (triggers.ts:154-157). New `remove-self-buff` type MUST be added to `ReactiveAbilityType` (53-64)
  and `REACTIVE_ABILITY_TYPES` (67-79).
- **Buff-grant path** resolves its trigger via `detectReactiveTrigger(rowText, buff.buffName)`
  (buildShipAbilities.ts:1602) → adding trigger patterns auto-routes Marauder Rage. No new grant code.
- **`AbilityType` is a SEPARATE union** (abilities.ts:6-29) from `AbilityConfig`. Adding the new
  type breaks three exhaustive `Record<AbilityType,…>` maps (abilityDefaults.ts:93, AbilityTypePicker.tsx:10,
  AbilityCard.tsx:40) + the `makeDefaultConfig` switch (abilityDefaults.ts:7-90) — all must be updated.
- **`loses` AND `removes` ∈ `SKIP_VERBS`** (`['ignoring','loses','removes','resists','when']`,
  skillTextParser.ts:2668) → `parseSkillEffects` already drops both "loses Overload" and "removes
  Overload" (and the passive "is lost" has no application verb). Do NOT change it; add a separate
  `parseSelfBuffRemovals`.
- **5 ships exist in the CSV; `Marauder Rage I/II/III` + `Overload` in buffs.ts**; `Overload` global
  cap 10 in `PERSISTENT_STACKING_BUFFS` (persistentStackingBuffs.ts:38).
- **`'overload'` never produced by a real parse** — `ControlEffect` (abilities.ts:543),
  `CONTROL_EFFECT_LABEL` (debuffImmunity.ts:37), `SIMULATED_CONTROL_EFFECTS` exclusion (simCoverage.ts:23-29).

## Golden discipline (READ FIRST)

- **NEVER** `vitest -u`. Inspect every moved golden.
- Expected DPS-calc golden churn: Mangler/Ravager lose on-cast Marauder Rage (now kill-gated; dummy
  is indestructible → never fires); Butcher Rage moves on-cast → on-debuff-inflicted.
- **Wider churn from `KILL_TRIGGER_RE`:** adding "on kill"/"killing an…" detection to
  `detectReactiveTrigger` (used by the buff-merge path for ALL ships) also reclassifies NON-Marauder
  buff grants that sit in a kill clause from `on-cast` → `on-enemy-destroyed` — confirmed:
  **Gallant** (Legion Discipline) and **Medved** (XAOC Swiftness). These are correct kill-gating
  fixes (the buffs vanish from the indestructible-dummy DPS calc). Inspect and accept their moved
  goldens. The Task 10 golden review MUST scan ALL ships with kill-phrasing buff grants, not just
  the 5 Marauders.
- **STOP guard:** Overload's every-turn *accumulation* must NOT change in the DPS calc. If an
  Overload-accumulation golden moves, STOP and investigate.
- `gh auth switch --hostname github.com --user TheSusort` before `gh`. Branch off `main`.

---

## Task 1: Types — `remove-self-buff` type+config, drop `'overload'`, editor defaults

**Files:**
- Modify: `src/types/abilities.ts` (`AbilityType` 6-29; `AbilityConfig` ~329-532; `ControlEffect` ~539-545)
- Modify: `src/components/skills/abilityDefaults.ts` (`makeDefaultConfig` 7-90; `DEFAULT_TARGETS` 93-117)
- Modify: `src/components/skills/AbilityTypePicker.tsx` (`TYPE_LABELS` 10)
- Modify: `src/components/skills/AbilityCard.tsx` (`ABILITY_TYPE_LABELS` 40)

- [ ] **Step 1: Add `'remove-self-buff'` to the `AbilityType` union** (after `'control'`).

- [ ] **Step 2: Add the AbilityConfig variant** (after the `control` variant ~456):

```ts
    // Overload lifecycle: "loses/removes Overload on kill". Removes a named self-buff family from
    // ALL of the owner's self stores. target:'self'; trigger carries the reactive moment.
    | { type: 'remove-self-buff'; buffName: string; scope: 'all' }
```

- [ ] **Step 3: Remove `'overload'` from `ControlEffect`** (drop `| 'overload'`); update the JSDoc
  above it (abilities.ts:536) to state all control effects are simulated.

- [ ] **Step 4: Update the editor default/label sites:**
  - `makeDefaultConfig`: `case 'remove-self-buff': return { type:'remove-self-buff', buffName:'', scope:'all' };`
  - `DEFAULT_TARGETS`: `'remove-self-buff': 'self',`
  - `TYPE_LABELS`: `'remove-self-buff': 'Remove Self Buff',`
  - `ABILITY_TYPE_LABELS`: `'remove-self-buff': 'Remove Self Buff',`
  (`AbilityCard.renderBody` has a `default` case → no editor body needed.)

- [ ] **Step 5: Run tsc.** `npx tsc --noEmit` — the editor Records resolve; remaining expected
  errors (fixed later): `CONTROL_EFFECT_LABEL` extra `overload` key + synthetic `effect:'overload'`
  tests (Task 7); executeIntent/partition until Task 3.

- [ ] **Step 6: Commit.**

```bash
git add src/types/abilities.ts src/components/skills/abilityDefaults.ts src/components/skills/AbilityTypePicker.tsx src/components/skills/AbilityCard.tsx
git commit -m "feat(combat): add remove-self-buff ability type/config; drop overload ControlEffect"
```

---

## Task 2: statusEngine `removeSelfBuffByName`

**Files:**
- Modify: `src/utils/combat/statusEngine.ts` (interface ~159; impl near `removeTimedEnemyStatus` ~944; export ~1263)
- Test: `src/utils/combat/__tests__/statusEngine.test.ts`

- [ ] **Step 1: Write the failing tests** (mirror the accum/persistent idioms at statusEngine.test.ts:93,279):

```ts
describe('removeSelfBuffByName', () => {
  it('clears an accumulating self buff (gains-every-turn Overload)', () => { /* register accum Overload, stacks>0, remove, assert gone */ });
  it('clears a persistent-stacking self buff', () => { /* apply via persistent door, remove, assert gone */ });
  it('clears a timed self buff family', () => { /* applyTimedAbilityStatus, remove, assert gone */ });
  it('is a safe no-op for unknown actor / unknown name', () => { /* expect not to throw */ });
});
```

- [ ] **Step 2: Run → FAIL** (`removeSelfBuffByName is not a function`).
  `npm test -- statusEngine.test.ts -t removeSelfBuffByName`

- [ ] **Step 3: Implement.** Interface decl near :159:

```ts
    /** Remove a named buff family from ALL of `actorId`'s self stores (timed selfMaps,
     *  accumulating accumSelfMaps, persistent persistentSelfMaps). Lazy-empty/unknown → no-op. */
    removeSelfBuffByName(actorId: string, buffName: string): void;
```

Impl near :944 (confirm each map's key: timed → `deriveFamilyKey(buffName).familyKey`; accum →
`payload.buffName`; persistent → raw `buffName`, verify against `addPersistentStack` ~517-543):

```ts
    const removeSelfBuffByName = (actorId: string, buffName: string): void => {
        selfMaps.get(actorId)?.delete(deriveFamilyKey(buffName).familyKey);
        accumSelfMaps.get(actorId)?.delete(buffName);
        persistentSelfMaps.get(actorId)?.delete(buffName);
    };
```

Export it in the returned object (~1263).

- [ ] **Step 4: Run → PASS.** `npm test -- statusEngine.test.ts -t removeSelfBuffByName`

- [ ] **Step 5: Commit.**

```bash
git add src/utils/combat/statusEngine.ts src/utils/combat/__tests__/statusEngine.test.ts
git commit -m "feat(combat): statusEngine.removeSelfBuffByName clears a named buff from all self stores"
```

---

## Task 3: `executeIntent` remove-self-buff branch + reactive partition

**Files:**
- Modify: `src/utils/combat/triggers.ts` (`ReactiveAbilityType` 53-64; `REACTIVE_ABILITY_TYPES` 67-79; branch in `executeIntent` ~1307+)
- Test: `src/utils/combat/__tests__/triggers.test.ts`

- [ ] **Step 1: Write the failing test.** Build an Intent for a `remove-self-buff` ability (trigger
  `on-enemy-destroyed`, target `self`, `config:{type:'remove-self-buff', buffName:'Overload', scope:'all'}`)
  and a ctx whose `statusEngine` carries an Overload self buff; assert `executeIntent` removes it
  (spy on / real-engine assert `removeSelfBuffByName(ownerId,'Overload')`).

- [ ] **Step 2: Run → FAIL.** `npm test -- triggers.test.ts -t 'remove-self-buff'`

- [ ] **Step 3: Partition.** Add `| 'remove-self-buff'` to `ReactiveAbilityType` (~64) and
  `'remove-self-buff',` to `REACTIVE_ABILITY_TYPES` (~78).

- [ ] **Step 4: Executor branch.** After the `cleanse` branch (~1752):

```ts
    if (cfg.type === 'remove-self-buff') {
        ctx.statusEngine.removeSelfBuffByName(intent.ownerId, cfg.buffName);
        return;
    }
```

- [ ] **Step 5: Run → PASS + tsc clean** for the executeIntent exhaustiveness.

- [ ] **Step 6: Commit.**

```bash
git add src/utils/combat/triggers.ts src/utils/combat/__tests__/triggers.test.ts
git commit -m "feat(combat): executeIntent remove-self-buff branch + reactive partition"
```

---

## Task 4: `detectReactiveTrigger` — kill / debuff-inflict patterns

**Files:**
- Modify: `src/utils/skillTextParser.ts` (`detectReactiveTrigger` 852-875; new `KILL_TRIGGER_RE`, `APPLYING_DEBUFF_RE`)
- Test: `src/utils/__tests__/skillTextParser.test.ts`

- [ ] **Step 1: Write the failing tests** (use CSV-derived plain phrasings):

```ts
it('detects on-enemy-destroyed from "on kill"', () =>
  expect(detectReactiveTrigger('loses Overload on kill', 'Overload')).toBe('on-enemy-destroyed'));
it('detects on-enemy-destroyed from "killing an opponent"', () =>
  expect(detectReactiveTrigger('it gains Marauder Rage I for 2 turns upon killing an opponent', 'Marauder Rage I')).toBe('on-enemy-destroyed'));
it('detects on-enemy-destroyed from "killing an enemy"', () =>
  expect(detectReactiveTrigger('upon killing an enemy, loses Overload', 'Overload')).toBe('on-enemy-destroyed'));
it('detects on-enemy-repaired', () =>
  expect(detectReactiveTrigger('gains Overload when an enemy performs a repair', 'Overload')).toBe('on-enemy-repaired'));
it('detects on-debuff-inflicted from "On inflicting a debuff"', () =>
  expect(detectReactiveTrigger('On inflicting a debuff, this Unit gains Marauder Rage II for 3 turns', 'Marauder Rage II')).toBe('on-debuff-inflicted'));
```

- [ ] **Step 2: Run → FAIL.** `npm test -- skillTextParser.test.ts -t detectReactiveTrigger`

- [ ] **Step 3: Implement.** Near the other reactive consts (~818-828):

```ts
// NEW (do NOT broaden the shared ENEMY_DEATH_PHRASING_RE used by parseExtraAction):
const KILL_TRIGGER_RE = /\bon\s+(?:a\s+)?kill\b|killing\s+an\s+(?:enemy|opponent)|when\s+an\s+enemy\s+dies/i;
const APPLYING_DEBUFF_RE = /\b(?:upon|on|after|when)\s+(?:inflicting|applying)\s+(?:a\s+)?debuff/i;
```

In `detectReactiveTrigger` (after the existing checks, ~873). **Order matters — check repair BEFORE kill:**

```ts
    if (ENEMY_REPAIRS_RE.test(clause)) return 'on-enemy-repaired';
    if (KILL_TRIGGER_RE.test(clause)) return 'on-enemy-destroyed';
    if (APPLYING_DEBUFF_RE.test(clause)) return 'on-debuff-inflicted';
```

> **Why repair-before-kill:** `detectReactiveTrigger` is sentence-scoped (`resolveBuffClause` returns
> the whole sentence containing the buff name). Ruiner's Overload GRANT and removal share one
> comma-joined sentence: "gains 1 stack of Overload **when an enemy performs a repair**, **upon
> killing an enemy**, this Unit removes Overload." The grant buff must resolve to `on-enemy-repaired`,
> so repair must win the sentence. This is safe: no Marauder Rage clause contains "repair", and
> Mangler/Ravager/Butcher Overload GRANTS use the "every turn" accumulating path (NOT
> `detectReactiveTrigger`). Only Ruiner's grant (repair) and Asphyxiator's grant (start-of-round,
> checked even earlier) use `detectReactiveTrigger`. Verify with `audit:skills` + full suite.

> Add a test for the Ruiner grant clause specifically:
> ```ts
> it('routes Ruiner Overload grant to on-enemy-repaired despite a kill clause in the same sentence', () =>
>   expect(detectReactiveTrigger('gains 1 stack of Overload when an enemy performs a repair, upon killing an enemy, this Unit removes Overload', 'Overload')).toBe('on-enemy-repaired'));
> ```

(`ENEMY_REPAIRS_RE` is at :441; if a TDZ error appears move the new consts above `detectReactiveTrigger`.)

- [ ] **Step 4: Run → PASS** (new + all existing). `npm test -- skillTextParser.test.ts`

- [ ] **Step 5: Commit.**

```bash
git add src/utils/skillTextParser.ts src/utils/__tests__/skillTextParser.test.ts
git commit -m "feat(combat): detectReactiveTrigger recognizes kill / repair / apply-debuff phrasings"
```

---

## Task 5: parser `parseSelfBuffRemovals`

**Files:**
- Modify: `src/utils/skillTextParser.ts` (new exported `parseSelfBuffRemovals`)
- Test: `src/utils/__tests__/skillTextParser.test.ts`

- [ ] **Step 1: Write the failing tests** (cover active + passive forms from the CSV, INCLUDING the
  two position-scoping cases where sentence-level resolution would pick the wrong trigger):

```ts
describe('parseSelfBuffRemovals', () => {
  it('emits for "loses Overload on kill"', () =>
    expect(parseSelfBuffRemovals('loses <unit-skill>Overload</unit-skill> on kill'))
      .toEqual([{ buffName: 'Overload', trigger: 'on-enemy-destroyed' }]));
  it('emits for "removes Overload" (Ruiner)', () =>
    expect(parseSelfBuffRemovals('upon killing an enemy, this Unit removes <unit-skill>Overload</unit-skill>'))
      .toEqual([{ buffName: 'Overload', trigger: 'on-enemy-destroyed' }]));
  it('emits for passive "Overload is lost" (Butcher R2)', () =>
    expect(parseSelfBuffRemovals('On kill, <unit-skill>Overload</unit-skill> is lost'))
      .toEqual([{ buffName: 'Overload', trigger: 'on-enemy-destroyed' }]));
  // Asphyxiator: Overload also appears in an EARLIER start-of-round GRANT sentence — the removal
  // trigger must still resolve to on-enemy-destroyed, not start-of-round.
  it('resolves the removal trigger by removal position, not first buff-name sentence (Asphyxiator)', () =>
    expect(parseSelfBuffRemovals('At the start of the round, this Unit gains 1 stack of <unit-skill>Overload</unit-skill>. Upon killing an enemy, this Unit loses <unit-skill>Overload</unit-skill>.'))
      .toEqual([{ buffName: 'Overload', trigger: 'on-enemy-destroyed' }]));
  // Ruiner: grant (repair) + removal (kill) in ONE sentence — removal must be on-enemy-destroyed.
  it('resolves the removal trigger by removal position within a shared sentence (Ruiner)', () =>
    expect(parseSelfBuffRemovals('This Unit gains 1 stack of <unit-skill>Overload</unit-skill> when an enemy performs a repair, upon killing an enemy, this Unit removes <unit-skill>Overload</unit-skill>'))
      .toEqual([{ buffName: 'Overload', trigger: 'on-enemy-destroyed' }]));
  it('returns [] for no-loss text', () =>
    expect(parseSelfBuffRemovals('This Unit gains <unit-skill>Overload</unit-skill> every turn')).toEqual([]));
  it('returns [] for an unknown buff', () =>
    expect(parseSelfBuffRemovals('this Unit removes <unit-skill>Nonsense</unit-skill>')).toEqual([]));
});
```

- [ ] **Step 2: Run → FAIL.** `npm test -- skillTextParser.test.ts -t parseSelfBuffRemovals`

- [ ] **Step 3: Implement with POSITION-SCOPED trigger resolution.** Scan tagged text for the three
  loss forms, each requiring a known self-buff name (`resolveBuffName`, skip unknown). For each
  removal match at index `P`, resolve the trigger from the text NEAR `P` — NOT via
  `detectReactiveTrigger(text, name)` (which is sentence-scoped by buff name and would pick the
  GRANT sentence for Asphyxiator and the repair phrase for Ruiner). Return `{ buffName, trigger }[]`.
  Do NOT touch `parseSkillEffects`.

```ts
export function parseSelfBuffRemovals(text: string): { buffName: string; trigger: AbilityTrigger }[] {
    const out: { buffName: string; trigger: AbilityTrigger }[] = [];
    const seen = new Set<string>();
    // For each match of:  (loses|removes)\s+<unit-skill>NAME</unit-skill>   (active)
    //                  or <unit-skill>NAME</unit-skill>\s+is\s+lost          (passive)
    // - name = resolveBuffName(raw); if !name or seen.has(name) → skip
    // - trigger = detectRemovalTriggerAt(text, matchIndex)  // position-scoped, see below
    // - push { buffName: name, trigger }; seen.add(name)
    return out;
}
```

  Add a position-scoped helper `detectRemovalTriggerAt(text, idx)`: WINDOW = the comma-or-sentence
  segment containing `idx` PLUS the immediately preceding segment (covers both "loses Overload **on
  kill**" where the trigger trails, and "**upon killing an enemy**, this Unit removes Overload" /
  Asphyxiator's separate "Upon killing an enemy, …" sentence where it leads). Run `KILL_TRIGGER_RE` /
  `ENEMY_REPAIRS_RE` / `APPLYING_DEBUFF_RE` / `START_OF_ROUND_RE` on the window; default `'on-cast'`
  if none.

  > **CRITICAL — keep `idx` valid:** `parseSelfBuffRemovals` computes the removal match `idx` against
  > the TAGGED text. Do NOT `stripUnitTags` before segmenting — `stripUnitTags` (skillTextParser.ts:412)
  > DELETES characters and shifts every downstream position, so a tagged `idx` would no longer align
  > (off-by-N window). Segment on the un-stripped text using length-PRESERVING masking only — mirror
  > the existing `rawSentenceAround` (skillTextParser.ts:~1356), which uses `maskAbbrev` and never
  > strips tags precisely to keep its anchor valid. Comma/period boundaries are never inside tags, so
  > segmentation is identical with or without tags; only the index mapping is fragile. (Same
  > position-anchoring discipline as `phrasePosTrigger`.)

> Scope to self: the active verbs imply the unit's own action; the named-buff gate (`resolveBuffName`
> over self-buffs) prevents matching enemy purge text. The `seen` dedup stops a ship naming the same
> buff in both an active and passive form from double-emitting.

- [ ] **Step 4: Run → PASS.** `npm test -- skillTextParser.test.ts -t parseSelfBuffRemovals`

- [ ] **Step 5: Commit.**

```bash
git add src/utils/skillTextParser.ts src/utils/__tests__/skillTextParser.test.ts
git commit -m "feat(combat): parseSelfBuffRemovals (loses/removes/is-lost self-buff)"
```

---

## Task 6: buildShipAbilities — emit remove-self-buff abilities

**Files:**
- Modify: `src/utils/abilities/buildShipAbilities.ts` (emit block in `abilitiesFromText`, near the extra-action emit ~1366-1392)
- Test: `src/utils/abilities/__tests__/buildShipAbilities.test.ts` (confirmed to exist)

- [ ] **Step 1: Write the failing tests** off the **real CSV passive rows** (read them via grep;
  build with a Ship carrying the passive as `activeSkillText`, matching `auditSkills.ts`'s
  `abilitiesFor`, or via the real build with refits). Assert:
  - Mangler p2 → a `remove-self-buff` Overload ability `trigger:'on-enemy-destroyed'` AND a
    `Marauder Rage II` buff ability `trigger:'on-enemy-destroyed'`.
  - Butcher p2 → remove-self-buff Overload on-enemy-destroyed (from "On kill, Overload is lost") AND
    `Marauder Rage II` buff `trigger:'on-debuff-inflicted'`.
  - Ravager p1 → remove-self-buff Overload on-enemy-destroyed + `Marauder Rage III` on-enemy-destroyed.
  - Asphyxiator p1 → remove-self-buff Overload on-enemy-destroyed (SoR grants verified separately).
  - Ruiner p2 → remove-self-buff Overload on-enemy-destroyed (from "removes Overload") + an Overload
    buff `trigger:'on-enemy-repaired'`.

- [ ] **Step 2: Run → FAIL.** `npm test -- buildShipAbilities.test.ts`

- [ ] **Step 3: Implement the emit loop** in `abilitiesFromText` (push to `out`, near ~1392):

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

(`nextId()` / `MAX_POS` are in scope in `abilitiesFromText`. Marauder Rage grants need no code here —
the buff path picks up the trigger from Task 4 via `detectReactiveTrigger`.)

- [ ] **Step 4: Run → PASS.** `npm test -- buildShipAbilities.test.ts`

- [ ] **Step 5: Run `audit:skills`.** `npm run audit:skills` → 0 failures. Investigate any new
  warning, especially any OTHER ship whose buff/remove grant newly routes to `on-enemy-destroyed`
  via `KILL_TRIGGER_RE` (spec §6 corpus-safety note).

- [ ] **Step 6: Commit.**

```bash
git add src/utils/abilities/buildShipAbilities.ts src/utils/abilities/__tests__/buildShipAbilities.test.ts
git commit -m "feat(combat): build remove-self-buff abilities for Overload lose-on-kill"
```

---

## Task 7: simCoverage / CONTROL_EFFECT_LABEL cleanup

**Files:**
- Modify: `src/utils/combat/debuffImmunity.ts` (`CONTROL_EFFECT_LABEL` ~33-40)
- Modify: `src/components/skills/simCoverage.ts` (comments ~14-29; `SIMULATED_CONTROL_EFFECTS`)
- Modify: `src/constants/persistentStackingBuffs.ts` (stale comment ~15-16)
- Test: `src/components/skills/__tests__/simCoverage.test.ts`, `AbilityCard.test.tsx`

- [ ] **Step 1: Update tests first.** `simCoverage.test.ts`: replace the "still flags overload" test
  (~23) with one asserting `isAbilityNotSimulated` returns `false` for every `ControlEffect` and
  `NOT_SIMULATED_TYPES` is empty; update the "does not contain overload" test (~46). `AbilityCard.test.tsx`:
  remove the synthetic `effect:'overload'` not-simulated case (~93-102) — no unmodeled control effect remains.

- [ ] **Step 2: Run → FAIL / tsc errors** for `effect:'overload'` literals.

- [ ] **Step 3: Implement.** Remove `overload` from `CONTROL_EFFECT_LABEL` (the `Record<ControlEffect,…>`
  forces it). Update `SIMULATED_CONTROL_EFFECTS` to the full remaining enum + refresh the comments
  (simCoverage.ts:14-15,21,36-37). Refresh `persistentStackingBuffs.ts:15-16` (the "kills never
  occur / per-kill removal is a Phase 4 concern" line is now false → note lose-on-kill is modeled in
  the combat sim; still permanent in the DPS calc).

- [ ] **Step 4: Run → PASS + tsc clean.** `npx tsc --noEmit`; `npm test -- simCoverage.test.ts AbilityCard.test.tsx`

- [ ] **Step 5: Commit.**

```bash
git add src/utils/combat/debuffImmunity.ts src/components/skills/simCoverage.ts src/constants/persistentStackingBuffs.ts src/components/skills/__tests__/*
git commit -m "feat(combat): drop overload from control not-simulated framing (last unmodeled effect)"
```

---

## Task 8: Engine combat fixtures — lifecycle + team symmetry

**Files:**
- Test: new `src/utils/combat/__tests__/overloadLifecycle.test.ts` (reference `enemyReactiveSelfBuffs.test.ts` / `enemyActions.test.ts` for bySide setup)

- [ ] **Step 1: Write the failing engine tests.** A Marauder player ship attacks a **destructible**
  enemy and kills it. Assert:
  1. **Overload reset on kill:** stacks present before the kill (assert against the ship's actual
     store), gone the round the kill resolves.
  2. **Marauder Rage on kill (Mangler/Ravager):** correct tier/duration after the kill.
  3. **Butcher Rage on debuff-inflict:** gained when Butcher inflicts a debuff (no kill needed).
  4. **Ruiner:** gains Overload when an enemy self-repairs; loses it on kill.
  5. **Asphyxiator SoR conditional:** with enemies carrying ≥3 debuffs, gains Overload + Rage at
     round start.
  6. **Team symmetry:** an enemy-side Marauder killing a player ship loses Overload + gains Rage
     identically (mirror `enemyReactiveSelfBuffs.test.ts`).

- [ ] **Step 2: Run → FAIL** (behaviors not yet exercised end-to-end). Fix any integration gaps in
  their source files (note in the commit).

- [ ] **Step 3: Make them pass.** Most behavior comes from Tasks 1-6; this proves the end-to-end path.

- [ ] **Step 4: Run → PASS.** `npm test -- overloadLifecycle.test.ts`

- [ ] **Step 5: Commit.**

```bash
git add src/utils/combat/__tests__/overloadLifecycle.test.ts src/utils/combat/*
git commit -m "test(combat): Overload lifecycle engine fixtures (kill-reset, Rage, symmetry)"
```

---

## Task 9: Changelog + documentation

**Files:**
- Modify: `src/constants/changelog.ts` (`UNRELEASED_CHANGES` ~8)
- Modify: `src/pages/DocumentationPage.tsx` (if Overload/Marauder described)

- [ ] **Step 1: Changelog.** Append a plain-English line, e.g.
  `'Combat simulator now models the Overload lifecycle: Marauder-family ships lose all Overload when they kill an enemy and gain Marauder Rage.'`

- [ ] **Step 2: Docs.** Update DocumentationPage only if it mentions Overload / Marauder / "not simulated".

- [ ] **Step 3: Commit.**

```bash
git add src/constants/changelog.ts src/pages/DocumentationPage.tsx
git commit -m "docs(combat): changelog + docs for Overload lifecycle"
```

---

## Task 10: Full-suite verification, golden review, code review, PR

- [ ] **Step 1: Full suite.** `npm test` → green. **Inspect every moved golden.** Expect: the 5
  Marauders' Rage goldens; AND Gallant/Medved (+ any other ship whose buff grant sits in a kill
  clause — `grep -iE 'on kill|killing an' docs/ship-skills.csv` to enumerate) reclassified to
  on-enemy-destroyed. Confirm each is the intended kill-gating correction. Overload *accumulation*
  goldens must NOT move (STOP if they do). No `vitest -u`.
- [ ] **Step 2: Lint + types.** `npm run lint` (max-warnings 0); `npx tsc --noEmit`.
- [ ] **Step 3: `audit:skills`** → 0 failures (the real coverage gate; runs the CSV).
- [ ] **Step 4: Code review.** Use superpowers:requesting-code-review; address per superpowers:receiving-code-review.
- [ ] **Step 5: Open the PR.**

```bash
gh auth switch --hostname github.com --user TheSusort
gh pr create --base main --title "feat(combat): Overload lifecycle — kill-reset + Marauder Rage" --body "<summary + spec link + golden-churn note>"
```

End the PR body with the Claude Code generated-with footer.

---

## Notes for the implementer

- **Text source is the CSV.** Derive every regex/test from `docs/ship-skills.csv` (tagged), never
  `ships.ts`. `resolveBuffClause` strips tags for `detectReactiveTrigger`; the buff/removal parsers
  see tagged text.
- **`KILL_TRIGGER_RE` is a new const** used only in `detectReactiveTrigger` — leave the shared
  `ENEMY_DEATH_PHRASING_RE` (parseExtraAction) alone. `audit:skills` + full suite confirm corpus safety.
- **Team symmetry** ([[feedback_engine_team_symmetry]]) is a locked invariant — Task 8.6 proves it.
- **Store-aware assertions** (Tasks 2 / 8): each ship's Overload may live in a different self store;
  assert the ship's actual store, not always the accumulating one.
- **Combat-engine workflow:** work on the `main` checkout (avoids the fresh-worktree esbuild crash,
  [[project_fresh_worktree_vite_esbuild_crash]]); ensure `.env` is present for the full suite
  ([[project_worktree_missing_env_test_failures]]).
