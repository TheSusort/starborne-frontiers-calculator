# Phase 0: Editor No-Op Guardrails Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the skill editor honest about what the DPS sim ignores: mark heal/shield/cleanse/purge/control as "not simulated", and warn when firing-only ability types sit on the passive slot.

**Architecture:** A tiny shared constants module (`simCoverage.ts`) consumed by `AbilityTypePicker` (category note) and `AbilityCard` (per-card notices). `AbilityCard` gains an optional `slot` prop passed down from `SkillEditorModal`. No sim/model changes.

**Tech Stack:** React 18, TypeScript, Vitest + React Testing Library, TailwindCSS.

**Spec:** `docs/superpowers/specs/2026-06-03-combat-engine-phase1-design.md` (Phase 0 section)

**Branch:** `feat/editor-noop-guardrails` off `main`.

**Conventions that bind this work:**
- No emojis in UI text; plain text + color classes (`text-yellow-400` for warnings, `text-theme-text-secondary` for notes — both already used in this codebase).
- Pre-commit hook runs the full test suite; expect commits to take ~1 min.

---

### Task 1: Branch + shared sim-coverage constants

**Files:**
- Create: `src/components/skills/simCoverage.ts`

- [ ] **Step 1: Create the branch**

```bash
git checkout main && git pull && git checkout -b feat/editor-noop-guardrails
```

- [ ] **Step 2: Create the constants module**

Create `src/components/skills/simCoverage.ts`:

```typescript
import { AbilityType } from '../../types/abilities';

/**
 * Ability types the DPS sim does not consume at all. They stay pickable in the
 * editor (annotations for the future Healing-calc / combat-sim phases) but must
 * be visibly marked so a configured ability isn't mistaken for a simulated one.
 */
export const NOT_SIMULATED_TYPES: ReadonlySet<AbilityType> = new Set([
    'heal',
    'shield',
    'cleanse',
    'purge',
    'control',
]);

/**
 * Ability types the DPS sim sources from the FIRING skill only (active/charged).
 * Placed on the passive slot they are silent no-ops today — warn, don't block,
 * so real ship passives can still be documented ahead of sim support.
 * See docs/skill-model-coverage.md section 4 (slot sourcing).
 */
export const PASSIVE_NOOP_TYPES: ReadonlySet<AbilityType> = new Set([
    'dot',
    'charge',
    'detonate-dot',
    'accumulate-detonate',
    'additional-damage',
]);

export const NOT_SIMULATED_NOTE = 'Not simulated in the DPS calculator yet.';
export const PASSIVE_NOOP_WARNING =
    'Not simulated on the passive slot - the DPS calculator only reads this ability type from the active and charged skills.';
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

(No commit yet — the module is unused; commit lands with Task 2.)

---

### Task 2: AbilityTypePicker — mark the Utility category

**Files:**
- Modify: `src/components/skills/AbilityTypePicker.tsx`
- Test: `src/components/skills/__tests__/AbilityTypePicker.test.tsx`

- [ ] **Step 1: Write the failing test**

Read `src/components/skills/__tests__/AbilityTypePicker.test.tsx` first to match its setup style, then add:

```tsx
it('marks the Utility category as not simulated in DPS', () => {
    render(<AbilityTypePicker onPick={() => {}} />);
    expect(screen.getByText(/not simulated in the dps calculator/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/skills/__tests__/AbilityTypePicker.test.tsx`
Expected: FAIL — text not found.

- [ ] **Step 3: Implement**

In `src/components/skills/AbilityTypePicker.tsx`:

1. Import the note: `import { NOT_SIMULATED_NOTE } from './simCoverage';`
2. Add an optional `note` to the category entries (line 27): change the `CATEGORIES` type to `{ label: string; types: AbilityType[]; note?: string }[]` and set `note: NOT_SIMULATED_NOTE` on the Utility entry (line 42).
3. Render the note under the category label (inside the category card, after the `<span>` at lines 49-51):

```tsx
{category.note && (
    <p className="text-xs text-theme-text-secondary">{category.note}</p>
)}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/skills/__tests__/AbilityTypePicker.test.tsx`
Expected: PASS (all tests in file).

- [ ] **Step 5: Commit**

```bash
git add src/components/skills/simCoverage.ts src/components/skills/AbilityTypePicker.tsx src/components/skills/__tests__/AbilityTypePicker.test.tsx
git commit -m "feat: mark not-simulated ability types in the type picker"
```

---

### Task 3: AbilityCard — not-simulated note + passive-slot warning

**Files:**
- Modify: `src/components/skills/AbilityCard.tsx`
- Test: `src/components/skills/__tests__/AbilityCard.test.tsx`

- [ ] **Step 1: Write the failing tests**

Read `src/components/skills/__tests__/AbilityCard.test.tsx` first to reuse its render helpers/fixtures, then add (adapting fixture construction to the file's existing style — it already builds `Ability` objects):

```tsx
describe('sim-coverage notices', () => {
    const heal: Ability = {
        id: 'a1',
        type: 'heal',
        target: 'self',
        trigger: 'on-cast',
        conditions: [],
        config: { type: 'heal', pct: 20, basis: 'hp' },
    };
    const dot: Ability = {
        id: 'a2',
        type: 'dot',
        target: 'enemy',
        trigger: 'on-cast',
        conditions: [],
        config: { type: 'dot', dotType: 'corrosion', tier: 5, stacks: 1, duration: 2 },
    };

    it('shows a not-simulated note for utility types', () => {
        render(<AbilityCard ability={heal} onChange={() => {}} onRemove={() => {}} />);
        expect(screen.getByText(/not simulated in the dps calculator/i)).toBeInTheDocument();
    });

    it('warns when a firing-only type sits on the passive slot', () => {
        render(
            <AbilityCard ability={dot} slot="passive" onChange={() => {}} onRemove={() => {}} />
        );
        expect(screen.getByText(/not simulated on the passive slot/i)).toBeInTheDocument();
    });

    it('does not warn for the same type on the active slot', () => {
        render(
            <AbilityCard ability={dot} slot="active" onChange={() => {}} onRemove={() => {}} />
        );
        expect(screen.queryByText(/not simulated on the passive slot/i)).not.toBeInTheDocument();
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/skills/__tests__/AbilityCard.test.tsx`
Expected: FAIL — `slot` prop doesn't exist / texts not found.

- [ ] **Step 3: Implement**

In `src/components/skills/AbilityCard.tsx`:

1. Import: `import { SkillSlot } from '../../types/abilities';` (extend the existing type import at lines 2-8) and `import { NOT_SIMULATED_TYPES, PASSIVE_NOOP_TYPES, NOT_SIMULATED_NOTE, PASSIVE_NOOP_WARNING } from './simCoverage';`
2. Add to `Props` (line 18): `/** Slot this ability lives in; enables slot-specific sim-coverage warnings. */ slot?: SkillSlot;` and destructure it in the component signature (line 110).
3. Replace the `default:` case of `renderBody()` (lines 477-482) with:

```tsx
default:
    return (
        <p className="text-xs text-theme-text-secondary">
            {NOT_SIMULATED_TYPES.has(ability.type)
                ? NOT_SIMULATED_NOTE
                : 'No editable fields for this ability type.'}
        </p>
    );
```

4. Render the passive-slot warning between the header and the Target select (after the closing `</div>` of the header block at line 536, before the `<Select label="Target"` at line 538):

```tsx
{slot === 'passive' && PASSIVE_NOOP_TYPES.has(ability.type) && (
    <p className="text-xs text-yellow-400">{PASSIVE_NOOP_WARNING}</p>
)}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/skills/__tests__/AbilityCard.test.tsx`
Expected: PASS (all tests in file).

- [ ] **Step 5: Commit**

```bash
git add src/components/skills/AbilityCard.tsx src/components/skills/__tests__/AbilityCard.test.tsx
git commit -m "feat: sim-coverage notices on ability cards (not-simulated types, passive-slot no-ops)"
```

---

### Task 4: SkillEditorModal — thread the slot through

**Files:**
- Modify: `src/components/skills/SkillEditorModal.tsx:134-147`
- Test: `src/components/skills/__tests__/SkillEditorModal.test.tsx`

- [ ] **Step 1: Write the failing test**

Read `src/components/skills/__tests__/SkillEditorModal.test.tsx` first; add a test rendering the modal with `slot="passive"` and a skill containing the `dot` ability fixture from Task 3, asserting the warning text appears:

```tsx
it('passes the slot to ability cards so passive no-op warnings render', () => {
    // build props per the file's existing helper pattern, with:
    //   slot: 'passive'
    //   skill: { slot: 'passive', abilities: [dotAbility] }
    expect(screen.getByText(/not simulated on the passive slot/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/skills/__tests__/SkillEditorModal.test.tsx`
Expected: FAIL — warning not rendered (slot not passed).

- [ ] **Step 3: Implement**

In `src/components/skills/SkillEditorModal.tsx`, add `slot={slot}` to the `<AbilityCard` props (line 135).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/skills/__tests__/SkillEditorModal.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/skills/SkillEditorModal.tsx src/components/skills/__tests__/SkillEditorModal.test.tsx
git commit -m "feat: thread slot into AbilityCard for passive-slot warnings"
```

---

### Task 5: Changelog, full verification, PR

**Files:**
- Modify: `src/constants/changelog.ts` (`UNRELEASED_CHANGES`, line 8)

- [ ] **Step 1: Add changelog entry**

Append to `UNRELEASED_CHANGES` (match the existing plain-English entry style in the array):

```typescript
'Skill editor: ability types the DPS calculator does not simulate (heal, shield, cleanse, purge, control) are now labelled, and abilities that only work on the active/charged skill warn when placed on the passive skill.',
```

Note: `src/constants/changelog.ts` may already have uncommitted local changes — only add this line; do not revert or include unrelated edits in the commit (use `git add -p` if needed).

- [ ] **Step 2: Full verification**

Run: `npm run lint && npx tsc --noEmit && npm test`
Expected: lint clean (0 warnings), no type errors, all tests pass.

- [ ] **Step 3: Commit and open PR**

```bash
git add -p src/constants/changelog.ts   # stage only the new entry
git commit -m "docs: changelog entry for editor sim-coverage guardrails"
git push -u origin feat/editor-noop-guardrails
gh pr create --title "feat: editor guardrails for not-simulated ability types" --body "$(cat <<'EOF'
Phase 0 of the combat-engine spec (docs/superpowers/specs/2026-06-03-combat-engine-phase1-design.md).

- Utility ability types (heal/shield/cleanse/purge/control) are marked "not simulated in the DPS calculator" in the type picker and on ability cards
- dot/charge/detonate-dot/accumulate-detonate/additional-damage abilities warn when placed on the passive slot (firing-skill-only in the sim)
- Warn, don't block: configs stay saveable for documentation ahead of sim support

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: Verify in the running app (manual)**

Run: `npm start`, open the DPS calculator, edit a ship's passive skill, add a DoT ability → yellow warning visible; add a Heal ability → grey note visible; type picker Utility category shows the note.
