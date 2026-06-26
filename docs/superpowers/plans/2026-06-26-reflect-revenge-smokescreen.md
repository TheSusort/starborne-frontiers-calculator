# Reflect / Revenge / Smokescreen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Model three special-effect equipment sources in the battle engine — the REFLECT gear set (damage thorns), the REVENGE gear set (missing-HP-scaled outgoing damage), and the SMOKESCREEN implant (reactive Stealth self-buff).

**Architecture:** All three plug into the existing `buildEquipmentAbilities` registry that feeds the simulator. SMOKESCREEN and REVENGE ride existing machinery (reactive self-buff executor; `outgoingDamage` modifier channel). REFLECT adds a new victim-side `damage-reflection` config read inside the single `applyVictimDamage` sink, applying mitigated reflected damage back to the attacker (affinity × defence × incoming-reduction × shield) without emitting events or re-triggering reactions.

**Tech Stack:** React 18 + TypeScript + Vite, Vitest. Combat engine under `src/utils/combat/`, ability registry under `src/utils/abilities/`.

**Spec:** `docs/superpowers/specs/2026-06-26-reflect-revenge-smokescreen-design.md`

**Branch:** `feat/combat-reflect-revenge-smokescreen` (already created off main, spec committed).

---

## Conventions & gotchas (read before starting)

- **Never run `vitest -u`** to update goldens. No fixture equips these sources → the full suite + all `.snap`/golden files must stay **byte-identical**. If any golden moves, stop and investigate.
- Pre-commit hook runs the FULL vitest suite. Docs-only commits use `--no-verify` + `git add -f` (docs/ is gitignored). Code commits run the hook normally.
- The repo `.env` must be present for `.tsx` test files to collect; the main checkout has it.
- Run a single test file: `npx vitest run <path> -t '<name>'`. Full suite: `npm test`. Lint: `npm run lint`. Types: `npx tsc --noEmit`. Skill audit: `npm run audit:skills` (expect 141/0).
- PERCENTAGE_ONLY stats are stored as integers (crit 70 = 70%, not 0.70).
- `gh auth switch --user TheSusort` before any `gh pr` command.

---

## File map

**Create:**
- `src/utils/combat/damageReflection.ts` — pure helper `reflectedDamageForHit(...)`.
- `src/utils/combat/__tests__/damageReflection.test.ts` — helper unit tests.
- `src/utils/combat/__tests__/reflectGearSet.integration.test.ts` — engine integration + duel anchors.
- `src/utils/combat/__tests__/revengeGearSet.integration.test.ts` — REVENGE fold test.
- `src/utils/abilities/__tests__/smokescreen.test.ts` — (optional; coverage test may suffice) SMOKESCREEN shape.

**Modify:**
- `src/types/abilities.ts` — `ConditionSubject` += `self-hp-missing-pct`; `AbilityConfig` += `damage-reflection` variant; collect set if needed.
- `src/utils/abilities/evaluateConditions.ts` — `evaluateCondition` case for `self-hp-missing-pct`.
- `src/utils/abilities/buildEquipmentAbilities.ts` — `GEAR_SET_ABILITIES.REFLECT`, `GEAR_SET_ABILITIES.REVENGE`, `IMPLANT_ABILITIES.SMOKESCREEN` + per-rarity proc table.
- `src/utils/combat/engine.ts` — collect `damage-reflection` into `incomingAbilitiesById`; reflection block inside `applyVictimDamage`; `cause.isReflected` flag; reflected surfacing.
- Editor exhaustiveness stubs for the new config type: `src/components/.../AbilityCard.tsx`, `AbilityTypePicker.tsx`, `abilityDefaults.ts` (grep for where `incoming-shield-grant` is handled and mirror).
- `src/utils/abilities/__tests__/equipmentCoverage.test.ts` — implemented sets/implants + titles + shape assertions.
- `src/constants/changelog.ts` — `UNRELEASED_CHANGES` entries.
- `src/pages/DocumentationPage.tsx` — if equipment effects are documented there.

---

## Task 1: REVENGE — missing-HP scaling subject + gear-set modifier

**Files:**
- Modify: `src/types/abilities.ts` (`ConditionSubject` union)
- Modify: `src/utils/abilities/evaluateConditions.ts` (`evaluateCondition`)
- Modify: `src/utils/abilities/buildEquipmentAbilities.ts` (`GEAR_SET_ABILITIES.REVENGE`)
- Test: `src/utils/combat/__tests__/revengeGearSet.integration.test.ts`
- Modify (coverage): `src/utils/abilities/__tests__/equipmentCoverage.test.ts`

**Design:** `self-hp-missing-pct` evaluates to `100 − selfHpPct` (a 0..100 count). REVENGE = a `modifier`/`outgoingDamage` ability with `value: 0` and `scaling: { conditionIndex: 0, perUnit: 0.25, cap: 25 }`, gated on a bare `{ subject: 'self-hp-missing-pct', derivable: true }` (no `countComparator`, so it is the SCALING source, not a gate — same shape as INTRUSION's bare `enemy-debuff`). Result: `0.25 × missingPct`, capped at +25pp on `outgoingDamage`. At full HP → 0 (DPS page, which runs at full HP, is unaffected → not wired).

- [ ] **Step 1: Write the failing helper-level test** for the new subject.

In a new or existing evaluateConditions test file (find `evaluateConditions.test.ts`), add:
```typescript
it('self-hp-missing-pct returns 100 - selfHpPct', () => {
    const ctx = makeConditionContext({ selfHpPct: 40 });
    expect(evaluateCondition({ subject: 'self-hp-missing-pct', derivable: true }, ctx)).toBe(60);
});
it('self-hp-missing-pct is 0 at full HP', () => {
    const ctx = makeConditionContext({ selfHpPct: 100 });
    expect(evaluateCondition({ subject: 'self-hp-missing-pct', derivable: true }, ctx)).toBe(0);
});
```
(Use the shared `makeConditionContext` fixture from `src/utils/abilities/__tests__/conditionContextFixture.ts`.)

- [ ] **Step 2: Run it, verify it fails** (type error / unhandled subject).

Run: `npx vitest run src/utils/abilities/__tests__/evaluateConditions.test.ts -t 'self-hp-missing-pct'`
Expected: FAIL.

- [ ] **Step 3: Add the subject + evaluation.**

In `src/types/abilities.ts`, add to the `ConditionSubject` union (near `enemy-hp-missing-pct`):
```typescript
    | 'self-hp-missing-pct'
```
In `src/utils/abilities/evaluateConditions.ts`, add a case in `evaluateCondition`:
```typescript
        case 'self-hp-missing-pct':
            return Math.max(0, 100 - ctx.selfHpPct);
```

- [ ] **Step 4: Run the test, verify pass.** `npx vitest run ... -t 'self-hp-missing-pct'` → PASS.

- [ ] **Step 5: Write the failing REVENGE integration test.**

`src/utils/combat/__tests__/revengeGearSet.integration.test.ts`: build a ship through the REAL registry with `setBonus: 'REVENGE'` on ≥`minPieces` pieces, run `modifierTotalsFromAbilities` (or `effectiveDamageStatsOf`) at a known HP%, assert `outgoingDamage` total:
```typescript
// at 60% missing HP → +15pp; at full HP → 0; capped at +25.
```
Assert it is built (1 ability, modifier/outgoingDamage, scaling perUnit 0.25 cap 25, condition self-hp-missing-pct).

- [ ] **Step 6: Run, verify fails** (no builder yet).

- [ ] **Step 7: Add the REVENGE builder** in `GEAR_SET_ABILITIES` (buildEquipmentAbilities.ts), next to other gear sets:
```typescript
    REVENGE: () => ({
        type: 'modifier',
        target: 'self',
        trigger: 'on-cast',
        conditions: [{ subject: 'self-hp-missing-pct', derivable: true }],
        scaling: { conditionIndex: 0, perUnit: 0.25, cap: 25 },
        config: { type: 'modifier', channel: 'outgoingDamage', value: 0, isMultiplicative: false },
        autoFilled: true,
    }),
```
(`minPieces` defaults to 2 — REVENGE has no explicit minPieces; the existing gate handles it.)

- [ ] **Step 8: Run the integration test, verify pass.**

- [ ] **Step 9: Update coverage test** (`equipmentCoverage.test.ts`): add `'REVENGE'` to the `implementedSets` `.toEqual([...])` array, the `IMPLEMENTED_SETS` Set, and the exactly-{} title string. Add a `REVENGE produces 1 ability (outgoingDamage modifier scaling on missing HP)` assertion.

- [ ] **Step 10: Run the full suite, confirm byte-identical goldens.** `npm test` → all green, zero golden/.snap drift. `npx tsc --noEmit` + `npm run lint` clean.

- [ ] **Step 11: Commit.**
```bash
git add -A
git commit -m "feat(combat): Revenge gear set — missing-HP-scaled outgoing damage"
```

---

## Task 2: SMOKESCREEN — reactive Stealth self-buff implant

**Files:**
- Modify: `src/utils/abilities/buildEquipmentAbilities.ts` (`IMPLANT_ABILITIES.SMOKESCREEN` + proc table)
- Modify (coverage): `src/utils/abilities/__tests__/equipmentCoverage.test.ts`

**Design:** rare 0.09 / epic 0.12 / legendary 0.16; on-attacked → self Stealth 1 turn; plain %-proc (no `oncePerRound`); only rare/epic/legendary variants exist. Identical to AMBUSH but `on-attacked` trigger and `Stealth` buff via `mkNamedBuffGrant`.

- [ ] **Step 1: Write the failing coverage/shape test** in `equipmentCoverage.test.ts`:
```typescript
it('SMOKESCREEN produces 1 ability for rare/epic/legendary, 0 otherwise (on-attacked Stealth self-buff)', () => {
    expect(implantAbilityCount('SMOKESCREEN', 'common')).toBe(0);
    expect(implantAbilityCount('SMOKESCREEN', 'uncommon')).toBe(0);
    for (const v of IMPLANTS['SMOKESCREEN'].variants) {
        expect(implantAbilityCount('SMOKESCREEN', v.rarity)).toBe(1);
    }
});
it('SMOKESCREEN (legendary) shape: on-attacked self Stealth 1t, procChance 0.16, plain proc', () => {
    const abs = implantAbilities('SMOKESCREEN', 'legendary');
    expect(abs).toHaveLength(1);
    const ab = abs[0];
    expect(ab.type).toBe('buff');
    expect(ab.target).toBe('self');
    expect(ab.trigger).toBe('on-attacked');
    expect(ab.procChance).toBeCloseTo(0.16);
    expect(ab.oncePerRound).toBeFalsy();
    // @ts-expect-error buff config
    expect(ab.config.buffName).toBe('Stealth');
    // @ts-expect-error buff config
    expect(ab.config.duration).toBe(1);
});
```

- [ ] **Step 2: Run, verify fails.** `npx vitest run src/utils/abilities/__tests__/equipmentCoverage.test.ts -t SMOKESCREEN`

- [ ] **Step 3: Add the builder + proc table** in buildEquipmentAbilities.ts:
```typescript
const SMOKESCREEN_PROC: Record<string, number> = {
    rare: 0.09,
    epic: 0.12,
    legendary: 0.16,
};
// ... in IMPLANT_ABILITIES:
    SMOKESCREEN: (rarity) => {
        const procChance = SMOKESCREEN_PROC[rarity];
        if (procChance === undefined) return undefined;
        return mkNamedBuffGrant('Stealth', 'self', 'on-attacked', 1, { procChance });
    },
```

- [ ] **Step 4: Run, verify pass.**

- [ ] **Step 5: Update the implemented-implants list** (`.toEqual` array + `implementedImplants` Set + exactly-{} title string) with `SMOKESCREEN`.

- [ ] **Step 6: Full suite + tsc + lint** — green, byte-identical goldens.

- [ ] **Step 7: Commit.**
```bash
git add -A
git commit -m "feat(combat): Smokescreen implant — Stealth on being directly hit"
```

---

## Task 3: REFLECT — pure reflection helper

**Files:**
- Create: `src/utils/combat/damageReflection.ts`
- Test: `src/utils/combat/__tests__/damageReflection.test.ts`

**Design:** A pure function returning the raw reflected amount **before shield absorb** (shield is applied at the engine seam). Order matches the empirically-validated model: `pct% × netHpDamage × affinityFactor × (1 − defenceReduction/100) × (1 − incomingReductionPct/100)`.

```typescript
export function reflectedDamageForHit(args: {
    reflectPct: number;          // e.g. 10
    netHpDamage: number;         // HP the wearer actually lost on this hit
    affinityDamageModifier: number; // from computeAffinityModifiers(wearer, attacker).damageModifier (-25 | 0 | 25)
    attackerDefenceReductionPct: number; // calculateDamageReduction(attacker effective defence), 0..~88
    attackerIncomingReductionPct: number; // incomingReductionForHit(attacker incoming abilities), default 0
}): number {
    if (args.reflectPct <= 0 || args.netHpDamage <= 0) return 0;
    const base = (args.reflectPct / 100) * args.netHpDamage;
    const affinity = 1 + args.affinityDamageModifier / 100;
    const defence = 1 - args.attackerDefenceReductionPct / 100;
    const incoming = 1 - args.attackerIncomingReductionPct / 100;
    return Math.max(0, base * affinity * defence * incoming);
}
```

- [ ] **Step 1: Write failing unit tests** covering: zero when pct/net is 0; the two duel anchors (within tolerance); affinity advantage/neutral/disadvantage; defence reduction; incoming-reduction multiplier.
```typescript
it('matches duel 1 (def 3001 → DR 45.8%, disadvantage)', () => {
    const r = reflectedDamageForHit({ reflectPct: 10, netHpDamage: 28056,
        affinityDamageModifier: -25, attackerDefenceReductionPct: calculateDamageReduction(3001),
        attackerIncomingReductionPct: 0 });
    expect(r).toBeGreaterThan(1100); expect(r).toBeLessThan(1180); // ≈1141
});
it('matches duel 2 (def 4093 → DR 53.4%, neutral)', () => {
    const r = reflectedDamageForHit({ reflectPct: 10, netHpDamage: 48318,
        affinityDamageModifier: 0, attackerDefenceReductionPct: calculateDamageReduction(4093),
        attackerIncomingReductionPct: 0 });
    expect(r).toBeGreaterThan(2200); expect(r).toBeLessThan(2300); // ≈2252
});
```

- [ ] **Step 2: Run, verify fails** (module not created).

- [ ] **Step 3: Create `damageReflection.ts`** with the function above.

- [ ] **Step 4: Run, verify pass.**

- [ ] **Step 5: Commit.**
```bash
git add -A
git commit -m "feat(combat): pure reflectedDamageForHit helper (affinity × defence × incoming)"
```

---

## Task 4: REFLECT — config type, registry entry, victim-side collection

**Files:**
- Modify: `src/types/abilities.ts` (`AbilityConfig` += `damage-reflection`)
- Modify: editor exhaustiveness stubs (`AbilityCard.tsx`, `AbilityTypePicker.tsx`, `abilityDefaults.ts` — grep `incoming-shield-grant`)
- Modify: `src/utils/abilities/buildEquipmentAbilities.ts` (`GEAR_SET_ABILITIES.REFLECT`)
- Modify: `src/utils/combat/engine.ts` (add `damage-reflection` to the `incomingAbilitiesById` collection filter)
- Modify (coverage): `equipmentCoverage.test.ts`

**Design:** New config `{ type: 'damage-reflection'; pct: number }`. REFLECT builder produces a passive-collected ability carrying it. Engine collects it into `incomingAbilitiesById` (same loop that gathers `incoming-reduction`/`incoming-block`/`incoming-shield-grant`). No engine *apply* yet — this task only proves the ability is built and collected.

- [ ] **Step 1: Write failing test** — build a ship with `setBonus: 'REFLECT'`, assert `buildEquipmentAbilities` yields 1 ability `{ type: 'modifier'?... }` — actually assert config.type `'damage-reflection'`, pct 10, target self. Add to coverage test.

- [ ] **Step 2: Run, verify fails.**

- [ ] **Step 3: Add the config variant** in `src/types/abilities.ts`:
```typescript
    | { type: 'damage-reflection'; pct: number }
```
Add editor stubs wherever the `AbilityConfig` union is exhaustively switched (mirror `incoming-shield-grant` — label-only, NOT user-pickable). Run `npx tsc --noEmit` to find every exhaustiveness site.

- [ ] **Step 4: Add the REFLECT builder** in `GEAR_SET_ABILITIES`:
```typescript
    REFLECT: () => ({
        type: 'modifier', // collected by passive slot; engine reads config.type
        target: 'self',
        trigger: 'on-cast',
        conditions: [],
        config: { type: 'damage-reflection', pct: 10 },
        autoFilled: true,
    }),
```
NOTE: confirm `type`/`trigger` values that make the ability land in the **passive** slot and survive `buildShipAbilitiesWithEquipment`'s merge (mirror how HARDENED's `incoming-reduction` is built — it is collected from the passive slot regardless of trigger). Match HARDENED's `type`/`trigger` exactly.

- [ ] **Step 5: Extend the engine collection filter** (`engine.ts` ~2255) to include the new config type:
```typescript
                a.config.type === 'incoming-shield-grant' ||
                a.config.type === 'damage-reflection'
```

- [ ] **Step 6: Run tests, verify pass; full suite byte-identical** (collection only, no apply → no behavior change).

- [ ] **Step 7: Update coverage test** (REFLECT in implemented sets + Set + title + shape assertion).

- [ ] **Step 8: Commit.**
```bash
git add -A
git commit -m "feat(combat): Reflect gear set — damage-reflection config + victim-side collection"
```

---

## Task 5: REFLECT — engine apply seam (the substantial piece)

**Files:**
- Modify: `src/utils/combat/engine.ts` (`applyVictimDamage` reflection block + `cause.isReflected` + sink/attacker resolution + surfacing)
- Test: `src/utils/combat/__tests__/reflectGearSet.integration.test.ts`

**Design:** Inside `applyVictimDamage`, after `victim.currentHp` is decremented and `hpDamage` (net) is known (~engine.ts:2840):
1. Guard: skip entirely if `cause?.isReflected` (no ping-pong), if `hpDamage <= 0`, if `cause?.byDirectDamage === false` (DoT — no reflect), if `(cause?.bombPortion ?? 0) > 0` (bomb — no reflect), or if the victim carries no `damage-reflection` ability.
2. Resolve `reflectPct` from the victim's `damage-reflection` ability (sum if multiple sets — but a single set is the norm; sum pct).
3. Resolve attacker: `const attacker = allActorsById.get(cause?.killerId ?? '')`. If absent or already destroyed, skip.
4. Compute inputs:
   - `affinityDamageModifier = computeAffinityModifiers(victim.affinity, attacker.affinity).damageModifier` (WEARER→ATTACKER direction — note the argument order: wearer is the "attacker" of the reflected hit).
   - `attackerDefenceReductionPct = calculateDamageReduction(effectiveStatsOf(statusEngine, selfBuffLookup, attacker).defence)` (guard defence > 0).
   - `attackerIncomingReductionPct = incomingReductionForHit(incomingAbilitiesOf(attacker.id), <minimal ctx: didCrit:false, ...>)` — reuse existing helper; pass a context with no crit/stealth flags. If this proves awkward, default to 0 and document (the duel model fit with 0).
5. `const reflected = reflectedDamageForHit({ reflectPct, netHpDamage: hpDamage, affinityDamageModifier, attackerDefenceReductionPct, attackerIncomingReductionPct });`
6. If `reflected > 0`, apply to the attacker **through `applyVictimDamage` recursively** with the correct sink and `cause: { killerId: victim.id, byDirectDamage: true, isReflected: true, shieldPenetrationPct: 0, bombPortion: 0 }`. The recursive call drains the attacker's shield + HP via `shieldAbsorb` and accumulates incoming via the sink — but the `isReflected` guard prevents it from reflecting again, and `applyVictimDamage` itself emits NO `attacked` event / triggers NO reactions (those are done in the turn/wrapper layer, not here — verify).
   - **Sink selection:** pick the sink whose side matches the attacker (`attacker.side === 'player' ? playerSink : enemySink`). Confirm both sinks accumulate into the unified `perActorIncoming` by id.
7. **Can-kill:** the recursive `applyVictimDamage` already sets `attacker.currentHp = max(0, ...)`. VERIFY how death/on-death is detected in this engine — if `destroyedRound`/on-death is processed by a post-damage sweep that scans `currentHp === 0`, reflect kills are handled for free. If on-death requires an explicit hook at the hit site, decide whether reflected kills fire on-death (spec says YES) and wire minimally or document precisely. **This is the main open risk — resolve it in this task.**
8. **Surfacing:** add a `perActorReflected: Map<string, number>` (reset per round, mirroring `perActorShieldGranted`), accumulate the reflected amount keyed by attacker id, and include it in `RoundData` end-of-round assembly (mirror `perActorShield`). Wire into `ShipRoundState` + a StatCard only if cheap; otherwise surface the reflected damage purely as the attacker's incoming (automatic via sink) and defer the dedicated StatCard. Keep this task focused; a dedicated UI surface can be trimmed if it balloons.

- [ ] **Step 1: Add `isReflected?: boolean` to the `cause` param type** of `applyVictimDamage` and the two wrapper `cause` types (additive, optional → byte-identical).

- [ ] **Step 2: Write failing integration tests** in `reflectGearSet.integration.test.ts`, built through the REAL registry (`buildShipAbilitiesWithEquipment` + `setBonus: 'REFLECT'`):
  - (a) attacker takes mitigated reflected damage when it hits a Reflect wearer (assert attacker HP drops by ≈ the helper's value for the scenario's net hit / affinity / defence).
  - (b) reflected damage drains the attacker's **shield** before HP.
  - (c) DoT tick and bomb on the wearer produce **no** reflection.
  - (d) no ping-pong: when BOTH ships wear Reflect, the reflected hit does not itself reflect (assert bounded, single bounce).
  - (e) reflected damage **can kill** the attacker (set attacker to low HP) and on-death effect fires (assert the on-death consequence).
  - (f) magnitude sanity vs duel 1/2 numbers when scenario stats are set to def 3001 disadvantage / def 4093 neutral.

- [ ] **Step 3: Run, verify fails.**

- [ ] **Step 4: Implement the reflection block** per the design above.

- [ ] **Step 5: Run the integration tests, verify pass.**

- [ ] **Step 6: Run the FULL suite — confirm byte-identical goldens/.snap** (no fixture equips Reflect). `npx tsc --noEmit` + `npm run lint` clean. `npm run audit:skills` → 141/0.

- [ ] **Step 7: Commit.**
```bash
git add -A
git commit -m "feat(combat): Reflect gear set — apply mitigated thorns damage at the victim seam"
```

---

## Task 6: Changelog, docs, verification, PR

**Files:**
- Modify: `src/constants/changelog.ts` (`UNRELEASED_CHANGES`)
- Modify: `src/pages/DocumentationPage.tsx` (if equipment effects are documented)

- [ ] **Step 1: Add `UNRELEASED_CHANGES` entries** (plain English): Reflect set now reflects a portion of damage back at attackers; Revenge set increases damage as the wearer loses HP; Smokescreen implant can grant Stealth when the wearer is hit.

- [ ] **Step 2: Update DocumentationPage** if it lists modelled gear-set/implant effects.

- [ ] **Step 3: Full verification** — `npm test` (all green, byte-identical goldens), `npx tsc --noEmit`, `npm run lint` (0 warnings), `npm run audit:skills` (141/0). Record counts.

- [ ] **Step 4: Commit docs** (`git commit -m "docs(combat): changelog + docs for Reflect/Revenge/Smokescreen"`).

- [ ] **Step 5: Push + open PR.**
```bash
gh auth switch --user TheSusort
git push -u origin feat/combat-reflect-revenge-smokescreen
gh pr create --title "feat(combat): Reflect/Revenge gear sets + Smokescreen implant" --body "<summary + spec link + test counts>"
```

---

## Open risks (verify during execution)

1. **REFLECT death / on-death** (Task 5, step 7) — confirm reflected kills fire on-death the way the spec requires; resolve how death is detected at/after `applyVictimDamage`.
2. **Sink + unified incoming** — confirm `playerSink`/`enemySink` both accumulate into the single `perActorIncoming` map so reflected damage surfaces correctly regardless of attacker side.
3. **REFLECT registry slot** — confirm the REFLECT ability lands in the passive slot and is collected (match HARDENED's `type`/`trigger` exactly).
4. **incoming-reduction on reflected damage** — if `incomingReductionForHit` is awkward to call at the seam, default `attackerIncomingReductionPct` to 0 and document (the empirical model fit with 0); do not block the PR on it.
5. **No events at the reflect apply** — verify `applyVictimDamage` itself emits no `attacked` event / triggers no reactions (those live in the wrapper/turn layer); the recursive call must not reach them.
