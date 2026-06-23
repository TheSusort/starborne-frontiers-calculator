# Cloaking Gear Set (First Stealth Source) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Cloaking gear set as a combat ability that grants the equipped ship the `'Stealth'` buff for 2 turns, once per combat, before any ship on either team acts — making Cloaking the first in-engine source of Stealth and lighting up the already-built dormant Stealth consumers.

**Architecture:** A single new entry in the `GEAR_SET_ABILITIES` registry (`src/utils/abilities/buildEquipmentAbilities.ts`) modeled as a `type:'buff'`, `trigger:'start-of-round'`, `target:'self'`, `oncePerCombat:true` grant of the existing `'Stealth'` named buff. It rides fully-existing machinery: `round-started` drains start-of-round intents *before the first turn of the round* (`engine.ts`), the reactive buff executor honors `oncePerCombat` (`triggers.ts`), and the `'Stealth'` buff is read by name by the positional targeting filter, the D-PR3 `self-stealth`/`incoming-crit-by-stealthed` conditions, and the D-PR8 Ambush implant gate. No new trigger, no new engine primitive.

**Tech Stack:** TypeScript, Vitest. Combat engine under `src/utils/combat/`, ability registries under `src/utils/abilities/`.

**Spec:** `docs/superpowers/specs/2026-06-23-cloaking-stealth-source-design.md`

---

## Conventions for every task

- **Run tests with `npx vitest run <path>`** — never bare `npm test`/`vitest` (those start watch mode and hang). Source: project memory.
- **Never run `vitest -u`** to update goldens. This PR must produce **ZERO** golden/`.snap` drift — if a snapshot moves, that's a real regression to investigate, not to accept.
- **Lint gate every task:** run `npm run lint` (max-warnings: 0) before committing — a single warning fails CI. Do not use `as any` casts or non-null assertions that trip the linter.
- **Commit messages** end with the trailer:
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  ```
- The pre-commit hook runs the full suite; that's expected. (Docs-only commits used `--no-verify` earlier; code commits should let the hook run.)

---

## Task 1: Add `oncePerCombat` support to `mkNamedBuffGrant`

The `CLOAKING` registry entry will reuse the existing `mkNamedBuffGrant` helper (which resolves `parsedEffects`/`isStackable` from the canonical `BUFFS` entry). Its `opts` currently supports `conditions` / `procChance` / `alsoGrantBuffNames` but **not** `oncePerCombat`. Add it. This must be byte-identical for every existing caller (Battlecry, Last Stand, Ambush, etc. — none pass `oncePerCombat`).

**Files:**
- Modify: `src/utils/abilities/buildEquipmentAbilities.ts` (the `mkNamedBuffGrant` function, ~line 384)
- Test: `src/utils/abilities/__tests__/buildEquipmentAbilities.cogrant.test.ts` (existing `mkNamedBuffGrant` test file)

- [ ] **Step 1: Write the failing test**

Add to `buildEquipmentAbilities.cogrant.test.ts`:

```ts
describe('mkNamedBuffGrant — oncePerCombat opt', () => {
    it('sets config.oncePerCombat when opts.oncePerCombat is true', () => {
        const a = mkNamedBuffGrant('Stealth', 'self', 'start-of-round', 2, {
            oncePerCombat: true,
        });
        expect(a).toBeDefined();
        expect(a!.config.type).toBe('buff');
        // @ts-expect-error narrow at runtime — buff config carries oncePerCombat
        expect(a!.config.oncePerCombat).toBe(true);
    });

    it('omits oncePerCombat from config when the opt is absent (byte-identical)', () => {
        const a = mkNamedBuffGrant('Stealth', 'self', 'start-of-round', 2);
        expect(a).toBeDefined();
        expect('oncePerCombat' in (a!.config as object)).toBe(false);
    });
});
```

(If `mkNamedBuffGrant` is not already imported in this file, add it to the existing import from `'../buildEquipmentAbilities'`. Confirm `'Stealth'` exists in `BUFFS` — it does, `src/constants/buffs.ts`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/utils/abilities/__tests__/buildEquipmentAbilities.cogrant.test.ts`
Expected: FAIL — `config.oncePerCombat` is `undefined` (the opt isn't wired yet).

- [ ] **Step 3: Implement the minimal change**

In `mkNamedBuffGrant`, extend the `opts` type and spread `oncePerCombat` into the config **only when truthy** (so absent → field omitted → existing callers byte-identical):

```ts
export function mkNamedBuffGrant(
    buffName: string,
    target: 'self' | 'ally' | 'all-allies' | 'adjacent-allies',
    trigger: AbilityTrigger,
    duration: number | undefined,
    opts?: {
        conditions?: Condition[];
        procChance?: number;
        alsoGrantBuffNames?: string[];
        oncePerCombat?: boolean;
    }
): Omit<Ability, 'id'> | undefined {
```

and in the returned `config` object, after `duration` / `additionalBuffs`:

```ts
        config: {
            type: 'buff',
            buffName,
            parsedEffects: parseBuffEffects(buff.name, buff.description),
            stacks: 1,
            isStackable: stackable,
            maxStacks,
            duration,
            ...(additionalBuffs.length ? { additionalBuffs } : {}),
            ...(opts?.oncePerCombat ? { oncePerCombat: true } : {}),
        },
```

If TypeScript complains that `oncePerCombat` is not a known field on the buff config type, confirm the buff variant of the ability `config` union in `src/types/abilities.ts` already declares `oncePerCombat?: boolean` (it does — `triggers.ts:1175` reads `cfg.oncePerCombat` in the buff branch, and the union carries `oncePerCombat?: boolean`, ~line 312/379). No type change should be needed.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/utils/abilities/__tests__/buildEquipmentAbilities.cogrant.test.ts`
Expected: PASS (both new cases + all pre-existing co-grant cases still green).

- [ ] **Step 5: Lint + commit**

```bash
npm run lint
git add src/utils/abilities/buildEquipmentAbilities.ts src/utils/abilities/__tests__/buildEquipmentAbilities.cogrant.test.ts
git commit -m "feat(combat): support oncePerCombat in mkNamedBuffGrant (Cloaking groundwork)"
```

---

## Task 2: Allow `GEAR_SET_ABILITIES` builders to return `undefined` (type widening + loop guard)

`GEAR_SET_ABILITIES` is typed `Partial<Record<string, () => Omit<Ability, 'id'>>>`. `mkNamedBuffGrant` returns `Omit<Ability,'id'> | undefined`, so a `CLOAKING: () => mkNamedBuffGrant(...)` entry won't type-check against the current value type. Widen the value type to allow `undefined` and guard the consuming loop — exactly mirroring how the **implant** loop already handles `undefined` builder results (`buildEquipmentAbilities.ts` ~line 902, `if (!res) continue;`). This is byte-identical: `LEECH`/`HARDENED` still return defined object literals.

**Files:**
- Modify: `src/utils/abilities/buildEquipmentAbilities.ts` (the `GEAR_SET_ABILITIES` type ~line 44, and the gear-set consumer loop ~line 870-879)

- [ ] **Step 1: Widen the registry value type**

```ts
const GEAR_SET_ABILITIES: Partial<Record<string, () => Omit<Ability, 'id'> | undefined>> = {
```

- [ ] **Step 2: Guard the consuming loop**

In the `for (const [setName, count] of Object.entries(setCounts))` loop, after `const partial = builder();`, add the guard before pushing:

```ts
        const partial = builder();
        if (!partial) continue;
        abilities.push({ id: `equip-set-${setName}`, ...partial });
```

- [ ] **Step 3: Run the existing equipment tests to verify byte-identical**

Run: `npx vitest run src/utils/abilities/__tests__/equipmentCoverage.test.ts`
Expected: PASS unchanged — `LEECH`/`HARDENED` still each produce 1 ability; no new set yet.

- [ ] **Step 4: tsc + lint**

Run: `npx tsc --noEmit` then `npm run lint`
Expected: both clean.

- [ ] **Step 5: Commit**

```bash
git add src/utils/abilities/buildEquipmentAbilities.ts
git commit -m "refactor(combat): allow gear-set ability builders to return undefined"
```

---

## Task 3: Add the `CLOAKING` registry entry

Add the Cloaking gear-set ability. This is the behavioral core.

**Files:**
- Modify: `src/utils/abilities/buildEquipmentAbilities.ts` (`GEAR_SET_ABILITIES`, after the `HARDENED` entry ~line 67)
- Test: `src/utils/abilities/__tests__/equipmentCoverage.test.ts`

- [ ] **Step 1: Write the failing test**

Add a focused test (near the other gear-set count tests, ~line 184). It builds a ship equipping ≥`minPieces` Cloaking pieces via the existing `gearSetAbilityCount` helper, and asserts the produced ability's shape. Use `buildEquipmentAbilities` directly (mirror the `gearSetAbilityCount` helper's ship construction) so you can inspect the ability object, not just the count:

```ts
it('CLOAKING produces a once-per-combat 2-turn Stealth self-buff on start-of-round', () => {
    const minPieces = GEAR_SETS['CLOAKING']?.minPieces ?? 2;
    const slots = ['weapon', 'hull', 'sensor', 'engine', 'shield', 'computer'] as const;
    const equipment: Record<string, string> = {};
    const pieceMap: Record<string, GearPiece> = {};
    for (let i = 0; i < minPieces; i++) {
        const id = `CLOAKING-piece-${i}`;
        const slot = slots[i % slots.length];
        equipment[slot] = id;
        pieceMap[id] = makePiece({ id, slot, setBonus: 'CLOAKING' });
    }
    const ship = makeShip({ equipment });
    const abilities = buildEquipmentAbilities(ship, (id) => pieceMap[id]);
    const cloak = abilities.find((a) => a.id === 'equip-set-CLOAKING');
    expect(cloak).toBeDefined();
    expect(cloak!.type).toBe('buff');
    expect(cloak!.target).toBe('self');
    expect(cloak!.trigger).toBe('start-of-round');
    expect(cloak!.config.type).toBe('buff');
    // @ts-expect-error buff config
    expect(cloak!.config.buffName).toBe('Stealth');
    // @ts-expect-error buff config
    expect(cloak!.config.duration).toBe(2);
    // @ts-expect-error buff config
    expect(cloak!.config.oncePerCombat).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/utils/abilities/__tests__/equipmentCoverage.test.ts -t CLOAKING`
Expected: FAIL — `cloak` is `undefined` (no registry entry yet).

- [ ] **Step 3: Add the registry entry**

In `GEAR_SET_ABILITIES`, after the `HARDENED` entry:

```ts
    // Cloaking: at the start of combat (round 1, before any ship acts), gain Stealth
    // for 2 turns, once per battle. Rides start-of-round (drained before the first turn
    // — engine.ts round-started drain point (a)) + oncePerCombat. First in-engine source
    // of the 'Stealth' buff: lights up the positional targeting filter, the D-PR3
    // self-stealth / incoming-crit-by-stealthed conditions, and the D-PR8 Ambush gate.
    CLOAKING: () =>
        mkNamedBuffGrant('Stealth', 'self', 'start-of-round', 2, { oncePerCombat: true }),
```

(`mkNamedBuffGrant` is defined later in the same file but hoisted as a function declaration — referencing it inside the registry object literal is fine, same as nothing else needs reordering. If a "used before declaration" lint/ts error appears, move the `GEAR_SET_ABILITIES` const below `mkNamedBuffGrant`'s definition — but function declarations hoist, so this should not occur.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/utils/abilities/__tests__/equipmentCoverage.test.ts -t CLOAKING`
Expected: PASS.

- [ ] **Step 5: tsc + lint + commit**

```bash
npx tsc --noEmit && npm run lint
git add src/utils/abilities/buildEquipmentAbilities.ts src/utils/abilities/__tests__/equipmentCoverage.test.ts
git commit -m "feat(combat): Cloaking gear set grants 2-turn Stealth at start of combat"
```

---

## Task 4: Update the coverage tracker (implemented-sets, 3 spots)

The coverage regression guard pins the exact set of implemented gear sets. Add `CLOAKING`. There are three coupled spots; the `toEqual` array is **order-sensitive** and follows `GEAR_SETS` declaration order: **LEECH → CLOAKING → HARDENED**.

**Files:**
- Modify: `src/utils/abilities/__tests__/equipmentCoverage.test.ts`

- [ ] **Step 1: Update the three spots**

1. The `it('exactly { ... } are currently implemented', ...)` **title string** (~line 122): add `CLOAKING` to the gear-sets portion (e.g. `LEECH + CLOAKING + HARDENED (gear sets)`).
2. The `toEqual` assertion (~line 127):
   ```ts
   expect(implementedSets).toEqual(['LEECH', 'CLOAKING', 'HARDENED']);
   ```
3. The `IMPLEMENTED_SETS` Set (~line 177):
   ```ts
   const IMPLEMENTED_SETS = new Set(['LEECH', 'CLOAKING', 'HARDENED']);
   ```

- [ ] **Step 2: Add a count assertion for CLOAKING**

Next to the `LEECH`/`HARDENED` count tests (~line 184):

```ts
it('CLOAKING produces exactly 1 ability (the Stealth grant)', () => {
    expect(gearSetAbilityCount('CLOAKING')).toBe(1);
});
```

- [ ] **Step 3: Run the coverage suite**

Run: `npx vitest run src/utils/abilities/__tests__/equipmentCoverage.test.ts`
Expected: PASS — including the `unimplementedSets` loop (which now no longer iterates CLOAKING) and the exact-set assertion.

- [ ] **Step 4: Commit**

```bash
git add src/utils/abilities/__tests__/equipmentCoverage.test.ts
git commit -m "test(combat): track CLOAKING in equipment coverage guard"
```

---

## Task 5: Engine integration tests (real registry, positional)

Prove the end-to-end behavior through the real `buildShipAbilitiesWithEquipment` → `runCombat` path (not a hand-rolled ability — mutation-resistant, per the established D-PR convention). Add a new `describe` block to the existing integration test file.

**Files:**
- Modify: `src/utils/combat/__tests__/equipmentAbilities.integration.test.ts`

**Patterns to study before writing** (read these in the same file / sibling files):
- The `LEECH` gear-set integration test (~line 134) — the `buildShipAbilitiesWithEquipment(ship, getGearPiece)` → merge-into-passive → `runCombat` path, the `makePiece`/`makeShip` helpers, and the event-collection helper at ~line 81.
- `src/utils/combat/__tests__/positionalDamage.integration.test.ts` and `cfProvokeAppliers.integration.test.ts` — how positions (`position: 'M1'` etc.) are set on actors and how the **round event log / `perTargetDamage`** is inspected to assert *which* actor received incoming damage.

- [ ] **Step 1: Write the integration tests**

Add a `describe('Cloaking integration — start-of-combat Stealth', ...)` with these cases (each a real `runCombat`):

1. **Untargetable while stealthed.** A player team of two: a Cloaking-equipped ship + a non-stealthed ally, positioned so an enemy attacker would normally hit the Cloaking ship. Assert that **while Stealth is active**, the Cloaking ship receives **no incoming direct-damage events** (the enemy's hits land on the non-stealthed ally instead). Inspect via the event log / `perTargetDamage` (mirror the positional test helpers).
   - **Expiry assertion:** do **not** hard-code "round 3". Run enough rounds, collect per-round incoming damage to the Cloaking ship, and assert it is zero for the stealthed rounds and becomes non-zero **after Stealth expires**. Pin the exact expiry round to the engine's *observed* buff-duration decrement behavior (the known `project_buff_duration_decrement_timing` quirk means a 2-turn buff may not expire on the naive round 3). Determine the actual expiry round empirically from the first run, then assert against it.
2. **Granted once.** Assert Stealth is applied a single time — it is not re-granted / its duration is not refreshed at the start of round 2. (E.g. assert the buff-applied event for `'Stealth'` on the Cloaking ship occurs exactly once across the run, or that the cloaked ship becomes targetable at the same round it would if granted only in round 1.)
3. **Cloaking + Ambush synergy.** A ship equipped with **both** the Cloaking set and the **Ambush implant** (`setBonus: 'AMBUSH'` on an implant piece, legendary). With Stealth active from Cloaking, Ambush's `self-buff: 'Stealth'` gate is now satisfiable. Force Ambush's proc to fire deterministically (override `procChance: 1` on the built ability, the `cfProvokeAppliers`/`LAST_STAND` test device — build through the real registry, then override only the proc chance) and assert Ambush's buff (`Crit Power Up III`) is granted to the carrier. This guards against the Ambush gate being unreachable. If wiring the proc override is awkward, at minimum assert the gate is *satisfied* (the engine attempts/permits the grant) rather than silently impossible.
   - **Intra-drain ordering caveat:** Cloaking and Ambush are *both* `start-of-round` grants drained at the same drain point (a). If Ambush's intent happens to execute before Cloaking's within that single drain pass, its `'Stealth'` gate would miss in **round 1** and only satisfy from **round 2** onward (once Cloaking's Stealth is live). Don't assume round-1 satisfaction — assert Ambush fires by some round while Stealth is active, and determine the actual round empirically from the run rather than hard-coding round 1.
4. **Enemy-side mirror.** An enemy ship equipped with Cloaking is untargetable to the player team while stealthed (the engine is team-agnostic — `registerReactiveListeners` runs both sides). Assert the player's attacks redirect away from the cloaked enemy.

- [ ] **Step 2: Run the new tests**

Run: `npx vitest run src/utils/combat/__tests__/equipmentAbilities.integration.test.ts`
Expected: PASS (new Cloaking block + all pre-existing blocks green).

- [ ] **Step 3: Full suite — verify ZERO golden/.snap drift**

Run: `npx vitest run`
Expected: All tests green. **Critically:** `git status` shows **no** modified `.snap` files. If any `.snap` moved, STOP — that's a real regression (a fixture unexpectedly reached the new branch); investigate before proceeding. Do NOT run `vitest -u`.

Run: `git status --porcelain '*.snap'` — expected: empty.

- [ ] **Step 4: tsc + lint + commit**

```bash
npx tsc --noEmit && npm run lint
git add src/utils/combat/__tests__/equipmentAbilities.integration.test.ts
git commit -m "test(combat): engine integration for Cloaking start-of-combat Stealth"
```

---

## Task 6: Changelog + skill audit + final verification

**Files:**
- Modify: `src/constants/changelog.ts` (`UNRELEASED_CHANGES`)

- [ ] **Step 1: Add a plain-English changelog entry**

Append to the `UNRELEASED_CHANGES` array (match the existing combat-simulator phrasing):

```ts
    'Combat simulator now models the Cloaking gear set: at the start of combat the equipped ship gains Stealth for 2 turns, making it untargetable while no un-stealthed targets are unavailable. This also enables effects that key off being stealthed (such as the Ambush implant and stealth-based damage reduction).',
```

- [ ] **Step 2: Run the skill audit (sanity — should be unchanged)**

Run: `npm run audit:skills`
Expected: `141 ships, 0 findings` (Cloaking touches gear-set abilities, not ship-skill parsing — unchanged).

- [ ] **Step 3: Final full verification**

Run, and confirm each:
```bash
npx vitest run            # all green
npx tsc --noEmit          # clean
npm run lint              # clean (max-warnings 0)
git status --porcelain '*.snap'   # empty (zero golden drift)
```

- [ ] **Step 4: Commit**

```bash
git add src/constants/changelog.ts
git commit -m "docs(combat): changelog for Cloaking gear set"
```

---

## Done criteria

- Cloaking gear set produces a once-per-combat 2-turn `'Stealth'` self-buff on `start-of-round`, granted before any ship acts in round 1.
- A cloaked ship is untargetable while Stealth is active and targetable after it expires (expiry pinned to observed engine decrement behavior).
- Cloaking + Ambush synergy is reachable and proven.
- Enemy-side Cloaking works (team-agnostic).
- Full suite green, tsc clean, lint clean, `audit:skills` 0 findings, **ZERO** golden/`.snap` drift.
- Changelog entry added.

## Out of scope (do not implement)

- **Wusheng break-on-damage passive** — breaks Stealth when the unit is damaged; needs a new break-on-action primitive. Separate ship-skill PR.
- **Other stealth sources** (ship skills / other implants). None exist today.
- **DPS calculator page wiring** — Stealth is a defensive/targeting effect with no stat fold.
