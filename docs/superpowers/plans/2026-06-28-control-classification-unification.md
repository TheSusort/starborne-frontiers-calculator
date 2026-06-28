# Control Classification Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recognize Provoke / Taunt / Concentrate Fire / Disable as first-class `type:'control'` abilities (additively, alongside their existing named-status application) and make the editor's "Not simulated" badge effect-aware, so `control` is no longer falsely flagged.

**Architecture:** Additive only. Control statuses already *land* via the named-debuff/buff path (`statusEngine.applyTimedAbilityStatus`); a `type:'control'` ability is event-only (`control-applied`). We extend the parser/builder to also emit a control ability per recognized effect (mirroring how Stasis already double-parses), resolve the Block-Debuff resist ownership so the four new effects stay byte-identical, and swap the badge's blanket type check for an effect-aware predicate. No engine application/targeting/lockout code changes.

**Tech Stack:** TypeScript, Vitest, React (editor card). Combat sim under `src/utils/combat`, parser under `src/utils`, ability builder under `src/utils/abilities`, editor under `src/components/skills`.

**Spec:** `docs/superpowers/specs/2026-06-28-control-classification-unification-design.md`

**Workflow reminders:**
- `gh auth switch --hostname github.com --user TheSusort` before any `gh`.
- Branch `feat/combat-control-classification-unification` (already created off main, holds the spec).
- Docs are gitignored → `git add -f` + `git commit --no-verify` for docs-only commits.
- Byte-identical combat goldens are the gate. Never blind `vitest -u`. Run the WHOLE `npm test` suite for the audit. `audit:skills`, `lint`, `tsc` clean every task.

---

## Reference: real corpus phrasings (from `docs/ship-skills.csv`)

The matcher must align with the application verbs the named-status path already
handles (these are why the statuses work today). Enumerated tag-adjacent forms:

| Effect | Phrasings | Side |
|---|---|---|
| Stasis | `inflicts/applies <tag>Stasis` | enemy |
| Provoke | `applies <tag>Provoke`, `apply <tag>Provoke` | enemy |
| Concentrate Fire | `applies/apply <tag>Concentrate Fire`, `applied with <tag>Concentrate Fire` | enemy |
| Disable | `inflicts <tag>Disable`, `inflicted with <tag>Disable`, `applies <tag>Disable` | enemy |
| Taunt | `gains <tag>Taunt`, `grants <tag>Taunt` | self |

`<tag>` = `<unit-skill>` (optionally with whitespace). Tag is immediately
adjacent to the verb (≤ a couple words), unlike the existing Stasis regex's
sentence-wide `[^.]*?` span — the new matcher uses a tight adjacency window to
avoid matching a control word that appears in a *condition* clause.

---

## File Structure

- **Modify** `src/types/abilities.ts` — add `'disable'` to `ControlEffect`.
- **Modify** `src/utils/combat/debuffImmunity.ts` — add `disable` to `CONTROL_EFFECT_LABEL`.
- **Modify** `src/utils/skillTextParser.ts` — generalize control matching into `parseControlInflicts(text): { effect: ControlEffect; pos: number; side: 'enemy' | 'self' }[]`; keep `parseControlInflict` (or fold it) so Stasis output is byte-identical; rewrite the stale Stasis-only docstring.
- **Modify** `src/utils/abilities/buildShipAbilities.ts` — replace the single-effect control block (`:987-1015`) with a loop over `parseControlInflicts`, setting `target` per side; rewrite the stale comment.
- **Modify** `src/utils/combat/playerTurn.ts` — resolve Block-Debuff resist ownership in the control emission loop (`:1277-1290`): drop the control-loop `emitBlockDebuffResist` (named-status path owns resists); skip the enemy-immune gate for self-target controls.
- **Modify** `src/components/skills/simCoverage.ts` — add `SIMULATED_CONTROL_EFFECTS` + effect-aware `isAbilityNotSimulated(ability)`; remove `'control'` from `NOT_SIMULATED_TYPES`.
- **Modify** `src/components/skills/AbilityCard.tsx` (`:766-768`) — render the badge via the predicate.
- **Modify** `src/components/skills/__tests__/AbilityCard.test.tsx` — update the badge precedent test (`~:489`) to the new predicate.
- **Tests (new):** parser unit tests, builder unit tests, sim-coverage unit tests, a control-emission/Block-Debuff integration test.
- **Modify** `src/constants/changelog.ts` — `UNRELEASED_CHANGES` entry.
- **Modify** `src/pages/DocumentationPage.tsx` — if control/skill-coverage is documented there.

---

## Task 1: Add `disable` to the ControlEffect type + label

**Files:**
- Modify: `src/types/abilities.ts:537`
- Modify: `src/utils/combat/debuffImmunity.ts:33-40`
- Test: `src/utils/combat/__tests__/debuffImmunity.test.ts` (or the nearest existing label test)

- [ ] **Step 1: Write the failing test** — `controlEffectLabel('disable')` returns `'Disable'`.

```ts
import { controlEffectLabel } from '../debuffImmunity';
it('labels the disable control effect', () => {
    expect(controlEffectLabel('disable')).toBe('Disable');
});
```

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run src/utils/combat/__tests__/debuffImmunity.test.ts` → type error / fail (`'disable'` not assignable to `ControlEffect`).

- [ ] **Step 3: Implement** — extend the union and the label map:

```ts
// src/types/abilities.ts
export type ControlEffect = 'provoke' | 'taunt' | 'stasis' | 'overload' | 'concentrate-fire' | 'disable';
```
```ts
// src/utils/combat/debuffImmunity.ts CONTROL_EFFECT_LABEL
disable: 'Disable',
```

- [ ] **Step 4: Run `npx tsc --noEmit`** — fix any newly-surfaced non-exhaustive `switch`/`Record<ControlEffect, …>` the compiler flags (exhaustiveness is our safety net here). Then the test PASSES.

- [ ] **Step 5: Commit** — `feat(combat): add 'disable' to ControlEffect + label`.

---

## Task 2: Generalize the control-infliction parser

**Files:**
- Modify: `src/utils/skillTextParser.ts` (around `:1018-1031`, `STASIS_INFLICT_RE` / `parseControlInflict`)
- Test: `src/utils/__tests__/skillTextParser.test.ts` (control section; co-locate with existing parser tests)

**Design:** add `parseControlInflicts(text): { effect: ControlEffect; pos: number; side: 'enemy' | 'self' }[]`. Build a small table mapping each `ControlEffect` to its buff tag-name + side + verb set, scan the text with a tight adjacency regex per effect, and return one entry per match (multiple effects per skill → multiple entries). Keep `parseControlInflict` exported (delegating to the new fn, returning the Stasis entry) only if other call sites need it; otherwise inline. **Stasis's emitted entry (effect `'stasis'`, side `'enemy'`, `pos` = position of the Stasis tag) MUST be byte-identical to today.**

- [ ] **Step 1: Write failing tests** — one per effect + Stasis-unchanged + negatives:

```ts
it('recognizes each inflicted control effect', () => {
    expect(parseControlInflicts('Deals damage and applies <unit-skill>Provoke</unit-skill> for 1 turn'))
        .toEqual([{ effect: 'provoke', side: 'enemy', pos: expect.any(Number) }]);
    expect(parseControlInflicts('inflicts <unit-skill>Disable</unit-skill> for 2 turns')[0].effect).toBe('disable');
    expect(parseControlInflicts('apply <unit-skill>Concentrate Fire</unit-skill> for 1 turn')[0].effect).toBe('concentrate-fire');
});
it('recognizes Taunt as a self-grant', () => {
    expect(parseControlInflicts('This Unit gains <unit-skill>Taunt</unit-skill> for 1 turn'))
        .toEqual([{ effect: 'taunt', side: 'self', pos: expect.any(Number) }]);
});
it('keeps Stasis byte-identical', () => {
    expect(parseControlInflicts('inflicts <unit-skill>Stasis</unit-skill> for 2 turns'))
        .toEqual([{ effect: 'stasis', side: 'enemy', pos: expect.any(Number) }]);
});
it('does NOT match a control word in a condition clause (no application verb adjacency)', () => {
    expect(parseControlInflicts('If the target has <unit-skill>Provoke</unit-skill>, deal +20% damage')).toEqual([]);
});
it('returns [] for non-control text', () => {
    expect(parseControlInflicts('Deals 300% damage')).toEqual([]);
});
```

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run src/utils/__tests__/skillTextParser.test.ts -t control`.

- [ ] **Step 3: Implement** — table + tight matcher. Sketch:

```ts
const CONTROL_INFLICTS: { effect: ControlEffect; tag: string; side: 'enemy' | 'self'; re: RegExp }[] = [
    { effect: 'stasis',           tag: 'Stasis',           side: 'enemy', re: /\b(?:inflicts?|appl(?:ies|y)|inflicted with|applied with)\s+<unit-skill>\s*Stasis\b/i },
    { effect: 'provoke',          tag: 'Provoke',          side: 'enemy', re: /\b(?:inflicts?|appl(?:ies|y)|inflicted with|applied with)\s+<unit-skill>\s*Provoke\b/i },
    { effect: 'concentrate-fire', tag: 'Concentrate Fire', side: 'enemy', re: /\b(?:inflicts?|appl(?:ies|y)|inflicted with|applied with)\s+<unit-skill>\s*Concentrate Fire\b/i },
    { effect: 'disable',          tag: 'Disable',          side: 'enemy', re: /\b(?:inflicts?|appl(?:ies|y)|inflicted with|applied with)\s+<unit-skill>\s*Disable\b/i },
    { effect: 'taunt',            tag: 'Taunt',            side: 'self',  re: /\b(?:gains?|grants?)\s+<unit-skill>\s*Taunt\b/i },
];

export function parseControlInflicts(text: string | null | undefined) {
    if (!text) return [];
    const out: { effect: ControlEffect; pos: number; side: 'enemy' | 'self' }[] = [];
    for (const c of CONTROL_INFLICTS) {
        if (c.re.test(text)) {
            const pos = text.search(new RegExp(`<unit-skill>\\s*${c.tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'));
            out.push({ effect: c.effect, pos: pos >= 0 ? pos : Number.MAX_SAFE_INTEGER, side: c.side });
        }
    }
    return out;
}
```

(Reuse the file's existing `MAX_POS` constant rather than `MAX_SAFE_INTEGER` if present. Keep the Stasis row first so its `pos` matches the prior `text.search(/<unit-skill>\s*Stasis\b/i)`.) Rewrite the stale docstring at `:1018-1023` to describe all five effects and the gate-path-vs-application-path distinction (per spec §4.1).

- [ ] **Step 4: Run, expect PASS** — control tests green; `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit** — `feat(combat): parse all control inflictions (provoke/taunt/CF/disable + stasis)`.

---

## Task 3: Emit control abilities for every recognized effect (builder)

**Files:**
- Modify: `src/utils/abilities/buildShipAbilities.ts:987-1015`
- Test: `src/utils/abilities/__tests__/buildShipAbilities.test.ts` (or the nearest build-fixture test)

- [ ] **Step 1: Write failing tests** — a skill that applies each effect emits a `type:'control'` ability with the right `effect`/`target`, AND the named-status ability is still produced unchanged.

```ts
it('emits a control ability for an applied Provoke (alongside the named debuff)', () => {
    const abilities = buildShipAbilities(shipWithActive('applies <unit-skill>Provoke</unit-skill> for 1 turn'));
    const control = abilities.find(a => a.type === 'control');
    expect(control?.config).toMatchObject({ type: 'control', effect: 'provoke' });
    expect(control?.target).toBe('enemy');
    // named debuff still present (the actual application)
    expect(abilities.some(a => a.type === 'debuff' && a.config.type === 'debuff' && a.config.buffName === 'Provoke')).toBe(true);
});
it('emits a self-target control ability for a gained Taunt', () => {
    const abilities = buildShipAbilities(shipWithActive('This Unit gains <unit-skill>Taunt</unit-skill> for 1 turn'));
    const control = abilities.find(a => a.type === 'control');
    expect(control?.config).toMatchObject({ type: 'control', effect: 'taunt' });
    expect(control?.target).toBe('self');
});
it('keeps the Stasis control ability byte-identical', () => {
    const abilities = buildShipAbilities(shipWithCharged('inflicts <unit-skill>Stasis</unit-skill> for 1 turn'));
    const control = abilities.find(a => a.type === 'control');
    expect(control?.config).toMatchObject({ type: 'control', effect: 'stasis' });
    expect(control?.target).toBe('enemy');
});
```

(Use the test file's existing ship-fixture helpers; the names above are placeholders — match the real helper API.)

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run src/utils/abilities/__tests__/buildShipAbilities.test.ts -t control`.

- [ ] **Step 3: Implement** — replace the `:987-1015` block:

```ts
// Control inflictions: emit a `type:'control'` ability per recognized effect (stasis,
// provoke, taunt, concentrate-fire, disable). This is ADDITIVE — the parallel named
// status (parseSkillEffects → applyTimedAbilityStatus) still performs the actual
// lockout/forced-targeting. The control ability only sources the `control-applied`
// event (reaction substrate, e.g. Defiant's shield-on-Stasis). Carries no conditions
// (see the gated-Stasis caveat below); no damage/modifier → DPS pipeline ignores it.
for (const ctrl of parseControlInflicts(text)) {
    out.push({
        ability: {
            id: nextId(),
            type: 'control',
            target: ctrl.side, // 'enemy' for inflicted, 'self' for Taunt
            trigger: 'on-cast',
            conditions: [], // gated-control caveat: see original comment, preserved below
            config: { type: 'control', effect: ctrl.effect },
            autoFilled: true,
        },
        pos: ctrl.pos,
    });
}
```

Preserve the existing gated-Stasis caveat comment. Rewrite the stale lead comment (no longer "only Stasis … Provoke/Taunt stay conditions").

- [ ] **Step 4: Run, expect PASS** — control build tests green; `npx tsc --noEmit` clean; `npx eslint` clean on touched files.

- [ ] **Step 5: Commit** — `feat(combat): emit control abilities for all inflicted control effects`.

---

## Task 4: Resolve Block-Debuff resist ownership in the emission loop

**Files:**
- Modify: `src/utils/combat/playerTurn.ts:1277-1290`
- Test (new): `src/utils/combat/__tests__/controlClassificationEmission.integration.test.ts`

**Why:** today the control loop emits its own `emitBlockDebuffResist` when the enemy is Block-Debuff-immune. The parallel named-status path ALSO resists the same buff (symmetric with every debuff type). For Stasis that means two resist events today; adding control abilities for Provoke/etc. would give them a second resist too → behavior change. Fix: the control loop stops owning resists (named-status path owns them); it only emits `control-applied` on the success path. Self-target controls (Taunt) skip the enemy-immune gate entirely.

- [ ] **Step 1: Write failing/locking tests:**

```ts
// (a) success: each enemy-inflicted effect emits control-applied with its effect
it('emits control-applied for an applied Provoke', () => { /* run a cast, assert a control-applied{effect:'provoke'} on the bus */ });
// (b) self Taunt: emits control-applied even though there is no enemy debuff target
it('emits control-applied for a self Taunt regardless of enemy immunity', () => { /* ... */ });
// (c) Block-Debuff immune target receiving Provoke emits EXACTLY ONE debuff-resisted
//     (named-status path), NOT a second from the control loop
it('does not double-emit a resist for a blocked control infliction', () => { /* immune target; assert resisted count for 'Provoke' === 1 */ });
```

- [ ] **Step 2: Run, expect FAIL** — `(a)`/`(b)` fail (no control ability fired the event yet for these effects pre-Task-3 is done, so these may already pass after Task 3; the load-bearing new assertion is `(c)`, which fails because the control loop currently emits a second resist).

- [ ] **Step 3: Implement** — rewrite the loop:

```ts
// Control inflictions: emit `control-applied` so reactions (on-stasis-applied) can fire.
// Emission ONLY — the named-status path performs the actual lockout/targeting AND owns the
// Block-Debuff resist (symmetric with every debuff type), so the control loop does NOT emit
// its own resist (that would double-count). On a blocked enemy infliction we simply skip the
// success event. Self-target controls (Taunt) have no enemy debuff target → no immune gate.
for (const ctrl of controlAbilitiesFromSkill(gatedSkill)) {
    if (ctrl.config.type !== 'control') continue;
    if (ctrl.target === 'enemy' && targetImmuneToDebuffs) continue; // resist owned by named-status path
    bus.emit({ type: 'control-applied', casterId: actor.id, effect: ctrl.config.effect, round: r });
}
```

(Confirm `controlAbilitiesFromSkill` returns the new self-target Taunt control abilities; if it filters by target, widen it. Confirm `ctrl.target` is accessible on the returned shape.)

- [ ] **Step 4: Run, expect PASS** — new integration tests green.

- [ ] **Step 5: Full-suite golden check** — `npm test`. **Expected: byte-identical (zero `.snap` moved).** The one behavior change is Stasis no longer double-emitting a resist under Block-Debuff; if a fixture pairs Block-Debuff immunity with Stasis a golden will move — STOP and surface it (per spec §6.1) rather than refreshing. Record the green count.

- [ ] **Step 6: Commit** — `feat(combat): control loop emits success event only; named-status path owns resists`.

---

## Task 5: Effect-aware "Not simulated" badge

**Files:**
- Modify: `src/components/skills/simCoverage.ts`
- Modify: `src/components/skills/AbilityCard.tsx:766-768`
- Modify: `src/components/skills/__tests__/AbilityCard.test.tsx` (~`:489`)
- Test (new): `src/components/skills/__tests__/simCoverage.test.ts`

- [ ] **Step 1: Write failing unit tests** for the predicate:

```ts
import { isAbilityNotSimulated, SIMULATED_CONTROL_EFFECTS } from '../simCoverage';
it('treats modeled control effects as simulated', () => {
    for (const effect of ['stasis','provoke','taunt','concentrate-fire','disable'] as const) {
        expect(isAbilityNotSimulated({ type: 'control', config: { type: 'control', effect } } as any)).toBe(false);
    }
});
it('still flags an unmodeled control effect (overload)', () => {
    expect(isAbilityNotSimulated({ type: 'control', config: { type: 'control', effect: 'overload' } } as any)).toBe(true);
});
it('leaves non-control types as before', () => {
    expect(isAbilityNotSimulated({ type: 'damage' } as any)).toBe(false);
});
```

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run src/components/skills/__tests__/simCoverage.test.ts`.

- [ ] **Step 3: Implement** in `simCoverage.ts`:

```ts
import { Ability, AbilityType, ControlEffect } from '../../types/abilities';

export const SIMULATED_CONTROL_EFFECTS: ReadonlySet<ControlEffect> = new Set([
    'stasis', 'provoke', 'taunt', 'concentrate-fire', 'disable',
]);

// `control` removed: its simulation is now decided per-effect by the predicate below.
export const NOT_SIMULATED_TYPES: ReadonlySet<AbilityType> = new Set([]);

export function isAbilityNotSimulated(ability: Ability): boolean {
    if (ability.type === 'control' && ability.config.type === 'control') {
        return !SIMULATED_CONTROL_EFFECTS.has(ability.config.effect);
    }
    return NOT_SIMULATED_TYPES.has(ability.type);
}
```

Keep `NOT_SIMULATED_NOTE`. Update the file's leading doc comment (it currently explains why `control` is flagged) to describe the effect-aware rule.

- [ ] **Step 4: Wire the card** — `AbilityCard.tsx:766-768`:

```tsx
{isAbilityNotSimulated(ability) && (
    <p className="text-xs text-theme-text-secondary">{NOT_SIMULATED_NOTE}</p>
)}
```

- [ ] **Step 5: Update `AbilityCard.test.tsx`** — the badge precedent test (~`:489`) that asserts via `NOT_SIMULATED_TYPES` membership: re-point it to the predicate (e.g. assert a control/stasis ability does NOT render the note, and a synthetic control/overload ability DOES). Keep the test asserting real component output, not the raw set.

- [ ] **Step 6: Run, expect PASS** — `npx vitest run src/components/skills/__tests__/simCoverage.test.ts src/components/skills/__tests__/AbilityCard.test.tsx`; `npx tsc --noEmit`; `npx eslint` clean.

- [ ] **Step 7: Commit** — `feat(skills): effect-aware Not-Simulated badge for control abilities`.

---

## Task 6: Changelog + docs + stale-comment sweep

**Files:**
- Modify: `src/constants/changelog.ts` (`UNRELEASED_CHANGES`)
- Modify: `src/pages/DocumentationPage.tsx` (if control/skill-coverage is documented)
- Sweep: any remaining stale "Provoke/Taunt are conditions, not control abilities" comments.

- [ ] **Step 1: Add changelog entry** (user-facing: the editor now correctly shows Provoke/Taunt/Concentrate Fire/Disable/Stasis control effects as simulated):

```ts
'Skill editor: Provoke, Taunt, Concentrate Fire, Disable and Stasis are now recognized as control effects and no longer marked "Not simulated" — their combat impact is reflected in the battle simulator.',
```

- [ ] **Step 2: Update DocumentationPage** if it lists simulated/unsimulated ability types — reflect that control (except Overload) is simulated.

- [ ] **Step 3: grep for stale comments** — `git grep -n "stay handled as targeting-status CONDITIONS"` and any "only Stasis" control comments; rewrite to the additive reality.

- [ ] **Step 4: Run `npm run lint` + `npx tsc --noEmit`** — clean.

- [ ] **Step 5: Commit** — `docs(combat): changelog + docs for control classification`.

---

## Task 7: Full-suite audit + holistic review + PR

- [ ] **Step 1: Full audit** — `npm test` (record pass count; expect prior-base + new tests, ZERO `.snap` moved), `npm run lint`, `npx tsc --noEmit`, `npm run audit:skills` (expect 0 errors / 141 unchanged or current baseline).
- [ ] **Step 2: Confirm goldens byte-identical** — `git diff origin/main...HEAD --stat -- src/` shows only the intended files; no `.snap` in the diff.
- [ ] **Step 3: Holistic self-review** against the spec (§3 scope kept; §6 risks each addressed: Block-Debuff dual-emit resolved in Task 4; over-matching pinned in Task 2 negatives; Taunt self-grant via `gains/grants`; `NOT_SIMULATED_TYPES` consumers re-pointed).
- [ ] **Step 4: requesting-code-review** — REQUIRED SUB-SKILL: `@superpowers:requesting-code-review`.
- [ ] **Step 5: Open PR** — `gh pr create --base main`, stacked on nothing (branches off main). Include the byte-identical claim + the one intended behavior change (Stasis resist de-dup) in the description.

---

## Risks recap (from spec §6)

1. **Block-Debuff resist dual-emit** — resolved in Task 4 (control loop drops resist ownership). Golden-verified in Task 4 Step 5; surface any Stasis+immune golden move.
2. **Parser over-matching** — mitigated by the tight adjacency regex (Task 2) + negative tests (condition-clause case).
3. **Taunt self-grant** — handled via the `gains|grants` verb set + `side:'self'` (Task 2/3).
4. **`NOT_SIMULATED_TYPES` removal** — emptied, predicate is the single source of truth; `AbilityCard.test.tsx` consumer re-pointed (Task 5). grep for other consumers in Task 7 Step 2.
