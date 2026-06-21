# On-death Implants (D-PR7) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the three on-death implants — Last Wish (repair all allies, fully modeled), Battlecry (Inc. Damage Down to all allies, emit-only) and Martyrdom (Disable the killer, emit-only) — as registry entries riding the existing `on-destroyed` trigger + reactive heal/buff/debuff executors, plus one surgical engine change so on-destroyed *debuffs* route to the killer.

**Architecture:** Pure additive registry work in `buildEquipmentAbilities.ts` (three `IMPLANT_ABILITIES` entries + two small helpers) and one targeted edit in `triggers.ts` (extend the on-destroyed killer-routing branch from `purge` to `purge | debuff`). No new types, no new ConditionSubject, no new executor branch. Byte-identical for existing fixtures (no combat fixture carries effect-bearing gear; Martyrdom is the first on-destroyed debuff).

**Tech Stack:** TypeScript, Vitest. Combat engine under `src/utils/combat/`; equipment-ability registry under `src/utils/abilities/`.

**Spec:** `docs/superpowers/specs/2026-06-21-implant-gearset-abilities-D-pr7-design.md`

---

## Background the implementer needs

- **The registry** (`src/utils/abilities/buildEquipmentAbilities.ts`) maps an implant key (the string stored in a gear piece's `setBonus`, e.g. `'LAST_WISH'`) to a builder `(rarity: string) => Omit<Ability,'id'> | undefined`. A builder returns `undefined` when the rarity is unsupported (graceful skip — never throw). The resulting `Ability` is merged into the ship's **passive slot** via `buildShipAbilitiesWithEquipment` (already wired into every consumer; untouched here). Ability id = `equip-implant-${implantKey}` (this worktree's convention — see `equipmentAbilities.integration.test.ts:242`).
- **Per-rarity value tables** are plain `Record<string, number>` consts near the top of the file (see `MENACE_AMP`, `SECOND_WIND_PROC`, `EXUBERANCE_AMP` for the pattern). A missing rarity key → `undefined` → builder returns `undefined`.
- **The `on-destroyed` trigger** (`src/utils/combat/triggers.ts` ~378) fires on the `ship-destroyed` event, self-scoped (`e.actorId === ownerId`). Reactive executors already support:
  - `type:'heal'` with ability `target:'all-allies'` + config `basis:'target-hp'` → repairs each recipient % of its **own** max HP; dead recipients (incl. the dead caster) skipped from credit. (Salvation precedent.)
  - `type:'buff'` with ability `target:'all-allies'` → applies a self-side timed status to every same-side id `ctx.playerIds` for `config.duration`; emits `buff-applied`.
  - `type:'debuff'` → applies a timed enemy status to `intent.eventCtx.counterTargetId` (the killer) via the owner's landing gate; emits `debuff-applied`.
- **Buff/debuff configs require `parsedEffects`** (`ParsedBuffEffects`). Resolve a canonical buff name to its effects with `parseBuffEffects(name, description)` from `src/utils/calculators/buffParser.ts`, after finding the entry in `BUFFS` (`src/constants/buffs.ts`). `isStackable(description)` from the same module returns `{ stackable, maxStacks? }`.
- **`application: 'apply'` vs `'inflict'`** (debuff): `'apply'` lands unless affinity disadvantage (no landing-chance roll); `'inflict'` draws the hacking-vs-security landing gate. Martyrdom text says "Applies Disable" → `'apply'`.
- **Implant per-rarity data** lives in `src/constants/implants.ts` under keys `LAST_WISH`, `BATTLECRY`, `MARTYRDOM`.

**Verification commands (run from the worktree root):**
- Single test file: `npx vitest --run path/to/file.test.ts`
- Full suite: `npm test` (≈2929+ tests). Pre-commit hook also runs it.
- Lint: `npm run lint` (max-warnings 0). Type-check: `npx tsc --noEmit`.
- Skill audit (must stay 141 ships / 0 findings): `npm run audit:skills`
- **Goldens:** NEVER run `vitest -u`. Any golden/`.snap` movement is a red flag — investigate, don't accept.

**Commits:** end every commit message with the `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer. Code commits run the pre-commit hook (full suite) — that's expected.

---

## Task 1: Last Wish — repair all allies on death (fully modeled)

**Files:**
- Modify: `src/utils/abilities/buildEquipmentAbilities.ts` (value table + `IMPLANT_ABILITIES.LAST_WISH`)
- Test: `src/utils/abilities/__tests__/buildEquipmentAbilities.test.ts`

- [ ] **Step 1: Write the failing test.** Add to `buildEquipmentAbilities.test.ts` a block that builds a ship with a Last Wish implant piece and asserts the resolved ability shape. Use the file's existing helpers (`makeShip`/`makePiece`/`makeGetGearPiece` or whatever it already defines — match the file). Skeleton:

```ts
describe('Last Wish (on-death repair all allies)', () => {
    it('legendary → heal/all-allies/on-destroyed, basis target-hp, pct 32, noCrit', () => {
        const piece = makePiece({ id: 'lw-1', setBonus: 'LAST_WISH', rarity: 'legendary' });
        const ship = makeShip({ implants: { implant_major: 'lw-1' } });
        const abilities = buildEquipmentAbilities(ship, makeGetGearPiece({ 'lw-1': piece }));
        const a = abilities.find((x) => x.id === 'equip-implant-LAST_WISH');
        expect(a).toBeDefined();
        expect(a!.trigger).toBe('on-destroyed');
        expect(a!.target).toBe('all-allies');
        expect(a!.config).toMatchObject({ type: 'heal', basis: 'target-hp', pct: 32, noCrit: true });
    });

    it('uncommon → pct 14', () => {
        const piece = makePiece({ id: 'lw-2', setBonus: 'LAST_WISH', rarity: 'uncommon' });
        const ship = makeShip({ implants: { implant_major: 'lw-2' } });
        const abilities = buildEquipmentAbilities(ship, makeGetGearPiece({ 'lw-2': piece }));
        const a = abilities.find((x) => x.id === 'equip-implant-LAST_WISH');
        expect(a!.config).toMatchObject({ type: 'heal', pct: 14 });
    });

    it('common → no ability (no common variant)', () => {
        const piece = makePiece({ id: 'lw-3', setBonus: 'LAST_WISH', rarity: 'common' });
        const ship = makeShip({ implants: { implant_major: 'lw-3' } });
        const abilities = buildEquipmentAbilities(ship, makeGetGearPiece({ 'lw-3': piece }));
        expect(abilities.find((x) => x.id === 'equip-implant-LAST_WISH')).toBeUndefined();
    });
});
```

(If the test file uses different helper names/imports, adapt — read the top of the file first.)

- [ ] **Step 2: Run it, verify it fails.** `npx vitest --run src/utils/abilities/__tests__/buildEquipmentAbilities.test.ts` → FAIL (`equip-implant-LAST_WISH` not found).

- [ ] **Step 3: Add the value table.** Near the other implant value tables (after the D-PR6 block, ~line 205):

```ts
// D-PR7: on-death implant value tables
// Last Wish: repair all allies % of their max HP on death. No common variant.
const LAST_WISH_PCT: Record<string, number> = { uncommon: 14, rare: 19, epic: 25, legendary: 32 };
```

- [ ] **Step 4: Add the registry entry.** Inside `IMPLANT_ABILITIES` (before the closing `};` at ~line 455):

```ts
// D-PR7: on-death implants ----------------------------------------------------
// Last Wish: "Upon death, repairs X% of all allies' max HP." Rides the reactive
// heal executor on the on-destroyed trigger (Salvation precedent); basis 'target-hp'
// repairs each ally % of its OWN max HP. Reactive heals never crit. Fully modeled.
LAST_WISH: (rarity) => {
    const pct = LAST_WISH_PCT[rarity];
    if (pct === undefined) return undefined;
    return {
        type: 'heal',
        target: 'all-allies',
        trigger: 'on-destroyed',
        conditions: [],
        config: { type: 'heal', pct, basis: 'target-hp', noCrit: true },
        autoFilled: true,
    };
},
```

- [ ] **Step 5: Run the test, verify it passes.** `npx vitest --run src/utils/abilities/__tests__/buildEquipmentAbilities.test.ts` → PASS.

- [ ] **Step 6: Commit.**

```bash
git add src/utils/abilities/buildEquipmentAbilities.ts src/utils/abilities/__tests__/buildEquipmentAbilities.test.ts
git commit -m "feat(combat): D-PR7 — Last Wish implant (repair all allies on death)"
```

---

## Task 2: Battlecry — Inc. Damage Down to all allies on death (emit-only)

**Files:**
- Modify: `src/utils/abilities/buildEquipmentAbilities.ts` (value table + buff helper + `IMPLANT_ABILITIES.BATTLECRY`)
- Test: `src/utils/abilities/__tests__/buildEquipmentAbilities.test.ts`

- [ ] **Step 1: Write the failing test.**

```ts
describe('Battlecry (on-death Inc. Damage Down to allies — emit-only)', () => {
    it('legendary → buff/all-allies/on-destroyed, Inc. Damage Down II, duration 3', () => {
        const piece = makePiece({ id: 'bc-1', setBonus: 'BATTLECRY', rarity: 'legendary' });
        const ship = makeShip({ implants: { implant_major: 'bc-1' } });
        const abilities = buildEquipmentAbilities(ship, makeGetGearPiece({ 'bc-1': piece }));
        const a = abilities.find((x) => x.id === 'equip-implant-BATTLECRY');
        expect(a).toBeDefined();
        expect(a!.trigger).toBe('on-destroyed');
        expect(a!.target).toBe('all-allies');
        expect(a!.config).toMatchObject({ type: 'buff', buffName: 'Inc. Damage Down II', duration: 3 });
        // parsedEffects resolved from BUFFS → carries the (currently-unfolded) incomingDamage effect
        expect((a!.config as { parsedEffects: { incomingDamage?: number } }).parsedEffects.incomingDamage).toBe(-30);
    });

    it('common → duration 1', () => {
        const piece = makePiece({ id: 'bc-2', setBonus: 'BATTLECRY', rarity: 'common' });
        const ship = makeShip({ implants: { implant_major: 'bc-2' } });
        const abilities = buildEquipmentAbilities(ship, makeGetGearPiece({ 'bc-2': piece }));
        const a = abilities.find((x) => x.id === 'equip-implant-BATTLECRY');
        expect(a!.config).toMatchObject({ type: 'buff', duration: 1 });
    });
});
```

- [ ] **Step 2: Run it, verify it fails.** FAIL (`equip-implant-BATTLECRY` not found).

- [ ] **Step 3: Add imports + value table + buff helper.** At the top of `buildEquipmentAbilities.ts`, add two new import lines (neither module is imported yet):

```ts
import { BUFFS } from '../../constants/buffs';
import { parseBuffEffects, isStackable } from '../calculators/buffParser';
```

…and add `AbilityTrigger` to the existing `../../types/abilities` import (currently `import { Ability, HealAmpCondition, IncomingCondition, OutgoingCondition } from '../../types/abilities';` — `AbilityTrigger` is NOT yet imported and the helper below needs it):

```ts
import { Ability, AbilityTrigger, HealAmpCondition, IncomingCondition, OutgoingCondition } from '../../types/abilities';
```

Value table (next to `LAST_WISH_PCT`):

```ts
// Battlecry: grant all allies a named defensive buff on death. Per-rarity = DURATION only;
// magnitude is intrinsic to the buff tier. No uncommon variant.
const BATTLECRY_DURATION: Record<string, number> = { common: 1, rare: 2, epic: 2, legendary: 3 };
```

Shared helper for a named-buff grant (place near the other `mk*` helpers, ~line 257):

```ts
// D-PR7: build a reactive named-buff grant (e.g. Battlecry's on-death "Inc. Damage Down II").
// parsedEffects/stackability resolve from the canonical BUFFS entry. EMIT-ONLY for buffs whose
// effect the engine does not yet fold (self-side incoming-damage buffs) — the status is applied
// and logged but has no combat effect until that fold exists.
function mkNamedBuffGrant(
    buffName: string,
    target: 'self' | 'ally' | 'all-allies',
    trigger: AbilityTrigger,
    duration: number | undefined
): Omit<Ability, 'id'> | undefined {
    if (duration === undefined) return undefined;
    const buff = BUFFS.find((b) => b.name === buffName);
    if (!buff) return undefined;
    const { stackable, maxStacks } = isStackable(buff.description);
    return {
        type: 'buff',
        target,
        trigger,
        conditions: [],
        config: {
            type: 'buff',
            buffName,
            parsedEffects: parseBuffEffects(buff.name, buff.description),
            stacks: 1,
            isStackable: stackable,
            maxStacks,
            duration,
        },
        autoFilled: true,
    };
}
```

- [ ] **Step 4: Add the registry entry.** Inside `IMPLANT_ABILITIES`, after `LAST_WISH`:

```ts
// Battlecry: "Upon death, grants all allies Inc. Damage Down II for N turns." EMIT-ONLY:
// self-side "Inc. Damage Down" is not folded into incoming damage yet (victimEnemyBuffs reads
// enemy-side only). The buff is applied + logged; lights up when self-side incoming folding lands.
BATTLECRY: (rarity) =>
    mkNamedBuffGrant('Inc. Damage Down II', 'all-allies', 'on-destroyed', BATTLECRY_DURATION[rarity]),
```

- [ ] **Step 5: Run the test, verify it passes.** PASS. (If `parsedEffects.incomingDamage` is not `-30`, read the `Inc. Damage Down II` entry in `buffs.ts` and `parseBuffEffects` to confirm the regex — adjust the assertion to the actual parsed value, don't force it.)

- [ ] **Step 6: Commit.**

```bash
git add src/utils/abilities/buildEquipmentAbilities.ts src/utils/abilities/__tests__/buildEquipmentAbilities.test.ts
git commit -m "feat(combat): D-PR7 — Battlecry implant (Inc. Damage Down to allies on death, emit-only)"
```

---

## Task 3: Martyrdom — apply Disable to the killer on death (emit-only registry entry)

This task adds the registry entry only. Without the Task 4 engine change the Disable would land on the *default* enemy; Task 4 routes it to the killer. Keep them as separate commits so the engine change's byte-identical claim is reviewable on its own.

**Files:**
- Modify: `src/utils/abilities/buildEquipmentAbilities.ts` (value table + debuff helper + `IMPLANT_ABILITIES.MARTYRDOM`)
- Test: `src/utils/abilities/__tests__/buildEquipmentAbilities.test.ts`

- [ ] **Step 1: Write the failing test.**

```ts
describe('Martyrdom (on-death Disable the killer — emit-only)', () => {
    it('legendary → debuff/enemy/on-destroyed, Disable, application apply, duration 2', () => {
        const piece = makePiece({ id: 'm-1', setBonus: 'MARTYRDOM', rarity: 'legendary' });
        const ship = makeShip({ implants: { implant_ultimate: 'm-1' } });
        const abilities = buildEquipmentAbilities(ship, makeGetGearPiece({ 'm-1': piece }));
        const a = abilities.find((x) => x.id === 'equip-implant-MARTYRDOM');
        expect(a).toBeDefined();
        expect(a!.trigger).toBe('on-destroyed');
        expect(a!.target).toBe('enemy');
        expect(a!.config).toMatchObject({
            type: 'debuff', buffName: 'Disable', application: 'apply', duration: 2,
        });
    });

    it('rare → duration 1', () => {
        const piece = makePiece({ id: 'm-2', setBonus: 'MARTYRDOM', rarity: 'rare' });
        const ship = makeShip({ implants: { implant_ultimate: 'm-2' } });
        const abilities = buildEquipmentAbilities(ship, makeGetGearPiece({ 'm-2': piece }));
        const a = abilities.find((x) => x.id === 'equip-implant-MARTYRDOM');
        expect(a!.config).toMatchObject({ type: 'debuff', duration: 1 });
    });

    it('epic → no ability (only rare + legendary variants exist)', () => {
        const piece = makePiece({ id: 'm-3', setBonus: 'MARTYRDOM', rarity: 'epic' });
        const ship = makeShip({ implants: { implant_ultimate: 'm-3' } });
        const abilities = buildEquipmentAbilities(ship, makeGetGearPiece({ 'm-3': piece }));
        expect(abilities.find((x) => x.id === 'equip-implant-MARTYRDOM')).toBeUndefined();
    });
});
```

(The implant-slot key — `implant_ultimate` vs `implant_major` — only needs to be a truthy slot in `ship.implants`; the resolution loops `Object.values(ship.implants)`. Match whatever the test file already uses if it has a convention.)

- [ ] **Step 2: Run it, verify it fails.** FAIL.

- [ ] **Step 3: Add the value table + debuff helper.** Value table:

```ts
// Martyrdom: apply a named debuff to the killer on death. Only rare + legendary variants.
const MARTYRDOM_DURATION: Record<string, number> = { rare: 1, legendary: 2 };
```

Debuff helper (near `mkNamedBuffGrant`):

```ts
// D-PR7: build a reactive named-debuff application (Martyrdom's on-death "Disable" on the killer).
// application:'apply' → lands unless affinity disadvantage (no landing roll), matching "Applies".
// Killer routing is supplied by the on-destroyed listener via eventCtx.counterTargetId (Task 4).
function mkNamedDebuff(
    buffName: string,
    trigger: AbilityTrigger,
    duration: number | undefined
): Omit<Ability, 'id'> | undefined {
    if (duration === undefined) return undefined;
    const buff = BUFFS.find((b) => b.name === buffName);
    const parsedEffects = buff ? parseBuffEffects(buff.name, buff.description) : {};
    return {
        type: 'debuff',
        target: 'enemy',
        trigger,
        conditions: [],
        config: {
            type: 'debuff',
            buffName,
            parsedEffects,
            stacks: 1,
            isStackable: false,
            application: 'apply',
            duration,
        },
        autoFilled: true,
    };
}
```

- [ ] **Step 4: Add the registry entry.** Inside `IMPLANT_ABILITIES`, after `BATTLECRY`:

```ts
// Martyrdom: "Applies Disable for N turns on the enemy that killed this Unit." EMIT-ONLY:
// Disable is not a modeled turn-effect yet (only Stasis skips turns) — the debuff is applied to
// the killer + logged. Killer routing comes from the on-destroyed listener (Task 4).
MARTYRDOM: (rarity) => mkNamedDebuff('Disable', 'on-destroyed', MARTYRDOM_DURATION[rarity]),
```

- [ ] **Step 5: Run the test, verify it passes.** PASS.

- [ ] **Step 6: Commit.**

```bash
git add src/utils/abilities/buildEquipmentAbilities.ts src/utils/abilities/__tests__/buildEquipmentAbilities.test.ts
git commit -m "feat(combat): D-PR7 — Martyrdom implant registry entry (Disable, emit-only)"
```

---

## Task 4: Route on-destroyed debuffs to the killer (engine change)

**Files:**
- Modify: `src/utils/combat/triggers.ts` (the `on-destroyed` listener, ~line 385)
- Test: `src/utils/combat/__tests__/equipmentAbilities.integration.test.ts` (engine-level Martyrdom routing)

- [ ] **Step 1: Write the failing test.** Add a Martyrdom block to the integration test. Build a focus ship equipped with a legendary Martyrdom implant whose HP is low enough to die to a direct hit, run combat with an enemy that deals lethal direct damage, and assert a `debuff-applied` event with `buffName:'Disable'` whose `targetId` is the **killer** id (not the default enemy). Read the file's existing harness (`makeShip`/`makePiece`/`makeGetGearPiece`/`BASE`/`runCombat`) and event-collection pattern first; mirror the closest existing reactive-on-X test. Skeleton (adapt to the harness):

```ts
describe('Martyrdom on-destroyed (killer routing)', () => {
    it('emits Disable on the killer when killed by direct damage', () => {
        const martyrPiece = makePiece({ id: 'm-leg', setBonus: 'MARTYRDOM', rarity: 'legendary' });
        // ... build the dying ship with this implant via buildShipAbilitiesWithEquipment,
        //     give it small HP, configure the enemy/attacker to land a lethal DIRECT hit,
        //     collect events from the bus/result.
        const events = /* collected ship-destroyed + debuff-applied events */;
        const disable = events.filter((e) => e.type === 'debuff-applied' && e.buffName === 'Disable');
        expect(disable.length).toBeGreaterThanOrEqual(1);
        expect(disable[0].targetId).toBe(/* the killer's actor id, NOT the default enemy id */);
    });

    it('does NOT emit Disable when killed by non-direct (DoT) damage', () => {
        // same setup but lethal via a DoT tick → byDirectDamage:false → no Disable
        expect(/* debuff-applied Disable count */).toBe(0);
    });
});
```

- [ ] **Step 2: Run it, verify it fails.** The first test fails because the Disable lands on the default enemy id, not the killer (or no `counterTargetId` is set). The second may already pass or fail depending on setup — both must hold after Step 3.

- [ ] **Step 3: Make the engine change.** In `src/utils/combat/triggers.ts`, the `on-destroyed` case (~385), change the routing condition from `purge` only to `purge | debuff`:

```ts
case 'on-destroyed':
    bus.on('ship-destroyed', (e) => {
        // Self-scoped: THIS owner was destroyed (mirrors on-crit's own-id scoping).
        // Killer-targeted reactions (Faust's PURGE, Martyrdom's DEBUFF) fire only when
        // killed by DIRECT damage and route to the killer (counterTargetId = e.killerId).
        // Salvation's self-destruct HEAL (and any other on-destroyed reaction) fires on ANY
        // death, unchanged.
        if (e.actorId !== ownerId) return;
        if (ra.ability.config.type === 'purge' || ra.ability.config.type === 'debuff') {
            if (!e.byDirectDamage) return;
            enqueue({
                ...intent,
                eventCtx: { ...intent.eventCtx, counterTargetId: e.killerId },
            });
        } else {
            enqueue(intent);
        }
    });
    break;
```

- [ ] **Step 4: Run the test, verify it passes.** Both Martyrdom routing tests PASS.

- [ ] **Step 5: Verify byte-identical for existing fixtures.** This change only affects an `on-destroyed` ability whose `config.type === 'debuff'`. Confirm none exist outside this PR:
  - `npm run audit:skills` → must still report **141 ships / 0 findings**.
  - If `docs/ship-skills.csv` is present locally: `grep -iE "upon death|when .*destroyed|when killed" docs/ship-skills.csv` and confirm none produce a debuff (expected: Faust=purge, Salvation=heal only). If the CSV is absent, the structural guarantee stands (the parser only emits `on-destroyed` for heal+purge — see spec §2.2).
  - Run the full combat suite and confirm ZERO golden/`.snap` movement: `npm test` then `git status --short` shows no modified `*.snap` / golden files.

- [ ] **Step 6: Commit.**

```bash
git add src/utils/combat/triggers.ts src/utils/combat/__tests__/equipmentAbilities.integration.test.ts
git commit -m "feat(combat): D-PR7 — route on-destroyed debuffs to the killer (Martyrdom)"
```

---

## Task 5: Engine integration tests for Last Wish + Battlecry + enemy mirror

**Files:**
- Test: `src/utils/combat/__tests__/equipmentAbilities.integration.test.ts`

- [ ] **Step 1: Last Wish — repairs living allies.** Build a team where a non-focus ally carries a legendary Last Wish implant and dies to a lethal direct hit while at least one OTHER ally is below max HP; run with healing mode on (the `BASE` harness already enables it). Assert the surviving allies' credited repair increases on the destruction round (use the `sumHeal` helper or per-round `perActor` repair bucket), and that the dead caster is not double-credited. Mirror the closest existing reactive-heal integration test for the exact accounting bucket to assert.

- [ ] **Step 2: Run it, verify it passes** (Task 1 already shipped the ability). `npx vitest --run src/utils/combat/__tests__/equipmentAbilities.integration.test.ts`.

- [ ] **Step 3: Battlecry — emits the buff on all living allies (emit-only).** Build a team where a ship with a legendary Battlecry implant dies; assert a `buff-applied` event with `buffName:'Inc. Damage Down II'` fires for each living ally. Do NOT assert any incoming-damage reduction (emit-only — see spec §1.2).

- [ ] **Step 4: Run it, verify it passes.**

- [ ] **Step 5: Enemy-side mirror.** Add one test where an ENEMY ship carries one of these implants (Last Wish or Martyrdom) and dies, proving the same path fires against the player side (the engine is team-agnostic). For Martyrdom-as-enemy: the Disable `debuff-applied` should target the player killer. Keep it qualitative (event fires / targets the right side).

- [ ] **Step 6: Run the whole integration file, verify green.** `npx vitest --run src/utils/combat/__tests__/equipmentAbilities.integration.test.ts`.

- [ ] **Step 7: Commit.**

```bash
git add src/utils/combat/__tests__/equipmentAbilities.integration.test.ts
git commit -m "test(combat): D-PR7 — engine integration for Last Wish/Battlecry + enemy mirror"
```

---

## Task 6: Coverage tracker + changelog + final verification

**Files:**
- Modify: `src/utils/abilities/__tests__/equipmentCoverage.test.ts`
- Modify: `src/constants/changelog.ts`

- [ ] **Step 1: Update the coverage tracker.** In `equipmentCoverage.test.ts`, add `BATTLECRY`, `LAST_WISH`, `MARTYRDOM` to the `implementedImplants` expected array (it asserts `.toEqual([...])` in IMPLANTS declaration order — insert each key in the position matching `src/constants/implants.ts`; `MARTYRDOM` and `BATTLECRY` and `LAST_WISH` sit at their declaration offsets). Update the `it('exactly { ... }')` test title to mention the three. Add per-rarity `implantAbilityCount` smoke assertions if the file has them for other implants (e.g. `implantAbilityCount('LAST_WISH','legendary')` ≥ 1; `MARTYRDOM` epic = 0).

- [ ] **Step 2: Run it, verify it passes.** `npx vitest --run src/utils/abilities/__tests__/equipmentCoverage.test.ts`. If the `.toEqual` array order is wrong the failure message shows the expected order — match it (declaration order from `IMPLANTS`).

- [ ] **Step 3: Add the changelog entry.** Append to `UNRELEASED_CHANGES` in `src/constants/changelog.ts` a plain-English line, e.g.:

> "Combat simulator: on-death implants — Last Wish now repairs all allies when its carrier is destroyed. Battlecry (Inc. Damage Down to allies) and Martyrdom (Disable the killer) now apply and show in the combat log (their full combat effect arrives with a later update)."

Match the existing entry format/array shape in the file.

- [ ] **Step 4: Final full verification.** Run all gates from the worktree root and confirm:
  - `npm test` → all green, and `git status --short` shows ZERO modified `*.snap`/golden files.
  - `npm run lint` → 0 warnings.
  - `npx tsc --noEmit` → clean.
  - `npm run audit:skills` → 141 ships / 0 findings.

- [ ] **Step 5: Commit.**

```bash
git add src/utils/abilities/__tests__/equipmentCoverage.test.ts src/constants/changelog.ts
git commit -m "test(combat): D-PR7 — coverage tracker + changelog for on-death implants"
```

---

## Done criteria

- Three implants resolve correctly per rarity (Task 1–3 unit tests).
- Last Wish repairs living allies on death; Battlecry + Martyrdom emit their statuses (Task 4–5 integration).
- On-destroyed debuffs route to the killer and gate on direct damage (Task 4).
- Coverage tracker lists all three; changelog updated.
- Full suite green, ZERO golden/`.snap` drift, lint + tsc clean, `audit:skills` 141/0.
