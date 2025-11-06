# Third Passive Skill Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a third optional passive skill text field to ships, following the existing pattern of firstPassiveSkillText and secondPassiveSkillText.

**Architecture:** Minimal additive changes following established conventions. Add database column, update TypeScript types, add admin form field, update display and search logic.

**Tech Stack:** React 18, TypeScript, Supabase (PostgreSQL), Vite

---

## Task 1: Database Schema Update

**Files:**
- Manual operation: Supabase Dashboard SQL Editor

**Step 1: Execute SQL to add column**

Open Supabase Dashboard → SQL Editor → New Query

Execute:
```sql
ALTER TABLE ship_templates
ADD COLUMN third_passive_skill_text TEXT NULL;
```

**Step 2: Verify column creation**

Execute:
```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'ship_templates'
AND column_name = 'third_passive_skill_text';
```

Expected: Returns 1 row showing `third_passive_skill_text | text | YES`

**Step 3: Test with sample insert**

Execute:
```sql
-- Test that column accepts null and text values
SELECT id, name, third_passive_skill_text
FROM ship_templates
LIMIT 1;
```

Expected: Query succeeds, third_passive_skill_text shows NULL for existing records

**Step 4: Document the change**

Note: No commit needed for database changes (managed by Supabase)

---

## Task 2: Update TypeScript Types - Ship Interface

**Files:**
- Modify: `src/types/ship.ts:26-27`

**Step 1: Add thirdPassiveSkillText to Ship interface**

In `src/types/ship.ts`, after line 25 (`secondPassiveSkillText?: string;`), add:

```typescript
thirdPassiveSkillText?: string;
```

The Ship interface should now have (lines 22-27):
```typescript
activeSkillText?: string;
chargeSkillText?: string;
firstPassiveSkillText?: string;
secondPassiveSkillText?: string;
thirdPassiveSkillText?: string;
level?: number;
```

**Step 2: Add thirdPassiveSkillText to ShipData interface**

In `src/types/ship.ts`, after line 69 (`secondPassiveSkillText?: string;`), add:

```typescript
thirdPassiveSkillText?: string;
```

The ShipData interface should now have (lines 66-70):
```typescript
activeSkillText?: string;
chargeSkillText?: string;
firstPassiveSkillText?: string;
secondPassiveSkillText?: string;
thirdPassiveSkillText?: string;
```

**Step 3: Verify TypeScript compilation**

Run: `npm run build`

Expected: Build succeeds with no type errors related to Ship or ShipData

**Step 4: Commit**

```bash
git add src/types/ship.ts
git commit -m "feat: add thirdPassiveSkillText to Ship and ShipData types"
```

---

## Task 3: Update useShipsData Hook

**Files:**
- Modify: `src/hooks/useShipsData.ts:20,65`

**Step 1: Add field to ShipTemplate interface**

In `src/hooks/useShipsData.ts`, after line 20 (`second_passive_skill_text?: string;`), add:

```typescript
third_passive_skill_text?: string;
```

The ShipTemplate interface should now have (lines 17-21):
```typescript
active_skill_text?: string;
charge_skill_text?: string;
first_passive_skill_text?: string;
second_passive_skill_text?: string;
third_passive_skill_text?: string;
base_stats: {
```

**Step 2: Add mapping in transformShipTemplate function**

In `src/hooks/useShipsData.ts`, after line 65 (`secondPassiveSkillText: template.second_passive_skill_text,`), add:

```typescript
thirdPassiveSkillText: template.third_passive_skill_text,
```

The return object should now have (lines 62-66):
```typescript
activeSkillText: template.active_skill_text,
chargeSkillText: template.charge_skill_text,
firstPassiveSkillText: template.first_passive_skill_text,
secondPassiveSkillText: template.second_passive_skill_text,
thirdPassiveSkillText: template.third_passive_skill_text,
```

**Step 3: Verify TypeScript compilation**

Run: `npm run build`

Expected: Build succeeds, no type errors in useShipsData

**Step 4: Commit**

```bash
git add src/hooks/useShipsData.ts
git commit -m "feat: add third_passive_skill_text mapping in useShipsData"
```

---

## Task 4: Update Admin Service - NewShipTemplateData Interface

**Files:**
- Modify: `src/services/shipTemplateProposalService.ts:184,218`

**Step 1: Add field to NewShipTemplateData interface**

In `src/services/shipTemplateProposalService.ts`, after line 184 (`secondPassiveSkillText: string;`), add:

```typescript
thirdPassiveSkillText: string;
```

The interface should now have (lines 180-186):
```typescript
activeSkillText: string;
chargeSkillText: string;
firstPassiveSkillText: string;
secondPassiveSkillText: string;
thirdPassiveSkillText: string;
definitionId: string;
```

**Step 2: Add field to database insert statement**

In `src/services/shipTemplateProposalService.ts`, in the `addShipTemplate` function, after line 218 (`second_passive_skill_text: templateData.secondPassiveSkillText || null,`), add:

```typescript
third_passive_skill_text: templateData.thirdPassiveSkillText || null,
```

The insert object should now have (lines 215-220):
```typescript
active_skill_text: templateData.activeSkillText || null,
charge_skill_text: templateData.chargeSkillText || null,
first_passive_skill_text: templateData.firstPassiveSkillText || null,
second_passive_skill_text: templateData.secondPassiveSkillText || null,
third_passive_skill_text: templateData.thirdPassiveSkillText || null,
definition_id: templateData.definitionId || null,
```

**Step 3: Verify TypeScript compilation**

Run: `npm run build`

Expected: Build succeeds, no type errors in shipTemplateProposalService

**Step 4: Commit**

```bash
git add src/services/shipTemplateProposalService.ts
git commit -m "feat: add thirdPassiveSkillText to admin template service"
```

---

## Task 5: Update Admin Form Component

**Files:**
- Modify: `src/components/admin/AddShipTemplateForm.tsx:32,72,101,440`

**Step 1: Add field to ShipTemplateFormData interface**

In `src/components/admin/AddShipTemplateForm.tsx`, after line 32 (`secondPassiveSkillText: string;`), add:

```typescript
thirdPassiveSkillText: string;
```

The interface should now have (lines 30-34):
```typescript
firstPassiveSkillText: string;
secondPassiveSkillText: string;
thirdPassiveSkillText: string;
definitionId: string;
```

**Step 2: Initialize field in formData state (first location)**

In `src/components/admin/AddShipTemplateForm.tsx`, after line 72 (`secondPassiveSkillText: '',`), add:

```typescript
thirdPassiveSkillText: '',
```

**Step 3: Initialize field in formData reset (second location)**

In `src/components/admin/AddShipTemplateForm.tsx`, after line 101 (`secondPassiveSkillText: '',`), add:

```typescript
thirdPassiveSkillText: '',
```

**Step 4: Add textarea input in Skills Section**

In `src/components/admin/AddShipTemplateForm.tsx`, after the secondPassiveSkillText textarea (after line 440), add:

```tsx
<div>
    <label className="block text-sm font-medium text-gray-300 mb-1">
        Third Passive Skill
    </label>
    <textarea
        className="w-full bg-dark border border-gray-600 rounded-md px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-primary"
        rows={3}
        value={formData.thirdPassiveSkillText}
        onChange={(e) => updateField('thirdPassiveSkillText', e.target.value)}
        placeholder="Describe the third passive skill..."
    />
</div>
```

**Step 5: Verify TypeScript compilation**

Run: `npm run build`

Expected: Build succeeds, no type errors in AddShipTemplateForm

**Step 6: Manual UI test**

Run: `npm start`

Navigate to: Admin Panel → Templates Tab → Add New Ship Template form

Expected:
- Three passive skill textarea fields visible
- Third field labeled "Third Passive Skill"
- Placeholder text appears
- Can type in all three fields

**Step 7: Commit**

```bash
git add src/components/admin/AddShipTemplateForm.tsx
git commit -m "feat: add third passive skill input to admin form"
```

---

## Task 6: Update ImportButton Component

**Files:**
- Modify: `src/components/import/ImportButton.tsx:85`

**Step 1: Add field to template mapping**

In `src/components/import/ImportButton.tsx`, after line 85 (`secondPassiveSkillText: template.second_passive_skill_text,`), add:

```typescript
thirdPassiveSkillText: template.third_passive_skill_text,
```

The mapping should now include (lines 82-86):
```typescript
chargeSkillText: template.charge_skill_text,
firstPassiveSkillText: template.first_passive_skill_text,
secondPassiveSkillText: template.second_passive_skill_text,
thirdPassiveSkillText: template.third_passive_skill_text,
imageKey: template.image_key,
```

**Step 2: Verify TypeScript compilation**

Run: `npm run build`

Expected: Build succeeds, no type errors in ImportButton

**Step 3: Commit**

```bash
git add src/components/import/ImportButton.tsx
git commit -m "feat: add thirdPassiveSkillText to import template mapping"
```

---

## Task 7: Update ShipIndexPage - Search Functionality

**Files:**
- Modify: `src/pages/ShipIndexPage.tsx:135`

**Step 1: Add third passive to search filter**

In `src/pages/ShipIndexPage.tsx`, locate the search filter logic around line 133-135. After the `secondPassiveSkillText` search condition, add the third passive search:

Find this block:
```typescript
(ship.secondPassiveSkillText?.toLowerCase().includes(searchQuery.toLowerCase()) ??
    false) ||
```

Add after it:
```typescript
(ship.thirdPassiveSkillText?.toLowerCase().includes(searchQuery.toLowerCase()) ??
    false) ||
```

**Step 2: Verify TypeScript compilation**

Run: `npm run build`

Expected: Build succeeds, no type errors in ShipIndexPage

**Step 3: Manual test search functionality**

Run: `npm start`

Navigate to: Ship Index page

Test:
1. Create a test ship template with third passive text "Test Third Passive"
2. Use search bar to search for "Third Passive"
3. Verify ship appears in results

Expected: Ship with third passive text appears when searching for text in that field

**Step 4: Commit**

```bash
git add src/pages/ShipIndexPage.tsx
git commit -m "feat: add third passive skill to search filter"
```

---

## Task 8: Update ShipIndexPage - Display UI

**Files:**
- Modify: `src/pages/ShipIndexPage.tsx:354`

**Step 1: Add third passive skill display block**

In `src/pages/ShipIndexPage.tsx`, locate the second passive skill display block (around line 332-354). After the closing `</div>` of the second passive block, add:

```tsx
{ship.thirdPassiveSkillText && (
    <div className="bg-dark-lighter p-3 rounded border border-purple-500/30">
        <div className="flex items-start justify-between mb-2">
            <div className="flex items-center gap-2">
                <h4 className="text-sm font-semibold text-purple-400">
                    Third Passive
                </h4>
            </div>
            <ShareSkillButton
                shipName={ship.name}
                skillType="Third Passive"
                skillText={ship.thirdPassiveSkillText}
            />
        </div>
        <p className="text-sm text-gray-300 leading-relaxed">
            {ship.thirdPassiveSkillText}
        </p>
    </div>
)}
```

**Step 2: Verify TypeScript compilation**

Run: `npm run build`

Expected: Build succeeds, no type errors in ShipIndexPage

**Step 3: Manual UI test**

Run: `npm start`

Navigate to: Ship Index page

Test with ship that has third passive:
1. Verify third passive skill block displays
2. Verify purple border styling matches design
3. Verify ShareSkillButton works
4. Verify text displays correctly

Test with ship that has no third passive:
1. Verify third passive block does NOT display

Expected: Third passive displays when present, hidden when absent

**Step 4: Commit**

```bash
git add src/pages/ShipIndexPage.tsx
git commit -m "feat: add third passive skill display to ship index"
```

---

## Task 9: End-to-End Verification

**Files:**
- Manual testing across the full workflow

**Step 1: Test admin workflow**

Run: `npm start`

As admin user:
1. Navigate to Admin Panel → Templates Tab
2. Click "Add New Ship Template"
3. Fill in all required fields including all three passive skills
4. Submit form
5. Verify success message

Expected: Ship template created successfully with all three passives saved

**Step 2: Test database persistence**

In Supabase Dashboard, execute:
```sql
SELECT name, first_passive_skill_text, second_passive_skill_text, third_passive_skill_text
FROM ship_templates
WHERE name = '[YOUR_TEST_SHIP_NAME]';
```

Expected: All three passive skill fields populated correctly

**Step 3: Test display on Ship Index**

Navigate to: Ship Index page

Expected:
1. Test ship appears in list
2. All three passive skills display correctly
3. Third passive has purple border styling

**Step 4: Test search functionality**

In search bar, enter text that only appears in third passive skill

Expected: Ship appears in search results

**Step 5: Test null handling**

Create another ship template without third passive skill

Expected:
1. Form accepts empty third passive field
2. Ship displays with only first two passives
3. No errors in console

**Step 6: Final commit**

```bash
git add -A
git commit -m "chore: complete third passive skill feature

- Added database column: third_passive_skill_text
- Updated TypeScript types across Ship, ShipData, ShipTemplate
- Added admin form input for third passive
- Updated import mapping
- Added search functionality for third passive
- Added display UI for third passive
- All functionality tested and verified

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 10: Documentation Update

**Files:**
- Modify: `src/pages/DocumentationPage.tsx`

**Step 1: Locate ship template documentation section**

Search for section describing ship templates or passive skills

**Step 2: Update documentation**

Add note about third passive skill support:

```tsx
<p className="text-gray-300">
    Ships can have up to three passive skills: first passive (unlocked at lower ranks),
    second passive (unlocked at higher ranks), and third passive (available on newest ships).
</p>
```

**Step 3: Verify rendering**

Run: `npm start`

Navigate to: Documentation page

Expected: Updated documentation displays correctly

**Step 4: Commit**

```bash
git add src/pages/DocumentationPage.tsx
git commit -m "docs: update documentation for third passive skill"
```

---

## Task 11: Code Review & Cleanup

**Files:**
- All modified files

**Step 1: Run type checking**

Run: `npm run build`

Expected: No TypeScript errors

**Step 2: Run linter**

Run: `npm run lint`

Expected: No new linting errors introduced

**Step 3: Review all changes**

Run: `git diff main`

Review:
- All type definitions consistent
- All nullable fields properly handled with `?:`
- All database field names use snake_case
- All TypeScript field names use camelCase
- No console.log statements left
- No commented code

**Step 4: Final verification commit**

If any cleanup needed:
```bash
git add .
git commit -m "chore: cleanup and final verification"
```

---

## Rollback Plan

If issues discovered:

**Database Rollback:**
```sql
ALTER TABLE ship_templates DROP COLUMN third_passive_skill_text;
```

**Code Rollback:**
```bash
git reset --hard main
```

---

## Success Criteria

- ✅ Database column created and accessible
- ✅ TypeScript compiles without errors
- ✅ Admin can create ships with 0-3 passive skills
- ✅ All three passives display correctly on Ship Index
- ✅ Search includes third passive text
- ✅ Null handling works (ships without third passive)
- ✅ No console errors in browser
- ✅ Documentation updated
- ✅ All changes committed with clear messages
