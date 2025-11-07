# Third Passive Skill Field Design

**Date:** 2025-11-06
**Status:** Approved
**Approach:** Minimal/Incremental Addition

## Overview

Add a third optional passive skill text field to the ship data model to support new ships introduced by the game that have three passive skills. This follows the existing pattern of `firstPassiveSkillText` and `secondPassiveSkillText`.

## Context

Starborne Frontiers has introduced new ships with a third passive skill level. The application currently supports two passive skills per ship. This change adds a third optional field following the established conventions.

## Requirements

- Add third passive skill field to ship data structures
- Enable admin users to input third passive skill text when creating ship templates
- Display third passive skill on ship index page
- Include third passive in search functionality
- Skills managed manually by admins (not imported from game data)
- No existing data needs migration (no ships currently have third passive)
- Template proposals continue comparing only stats, not skills

## Design Decisions

### Approach Selected: Minimal/Incremental Addition

Following the established pattern for consistency and simplicity:
- Low risk, additive-only changes
- No breaking changes or data migrations
- Fast implementation and testing
- Maintains existing conventions

### Alternatives Considered

**Migration with Safety & Validation** - Rejected as overkill for simple additive change with manual management.

**Refactor to Skills Array** - Rejected as premature optimization; game unlikely to add many more passive skills.

## Implementation Plan

### 1. Database Schema Change

Add column to `ship_templates` table:

```sql
ALTER TABLE ship_templates
ADD COLUMN third_passive_skill_text TEXT NULL;
```

**Location:** Execute via Supabase dashboard
**Rollback:** `ALTER TABLE ship_templates DROP COLUMN third_passive_skill_text;`

### 2. TypeScript Type Updates

**src/types/ship.ts**
- Add `thirdPassiveSkillText?: string;` to `Ship` interface (after `secondPassiveSkillText`)
- Add `thirdPassiveSkillText?: string;` to `ShipData` interface (after `secondPassiveSkillText`)

**src/hooks/useShipsData.ts**
- Add `third_passive_skill_text?: string;` to `ShipTemplate` interface (line ~20)
- Add `thirdPassiveSkillText: template.third_passive_skill_text` to `transformShipTemplate` (line ~65)

**src/services/shipTemplateProposalService.ts**
- Add `thirdPassiveSkillText: string;` to `NewShipTemplateData` interface (line ~184)
- Add `third_passive_skill_text: templateData.thirdPassiveSkillText || null` to insert statement (line ~218)

### 3. Admin UI Updates

**src/components/admin/AddShipTemplateForm.tsx**

Form state initialization:
```typescript
// Line 72 and 101
thirdPassiveSkillText: '',
```

Add textarea in Skills Section (after secondPassiveSkillText textarea, ~line 440):
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

### 4. User-Facing UI Updates

**src/pages/ShipIndexPage.tsx**

Search filter (add to search logic around line 135):
```typescript
(ship.thirdPassiveSkillText?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false)
```

Display block (add after secondPassiveSkillText block, ~line 354):
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

**src/components/import/ImportButton.tsx**

Add to template mapping (line ~85):
```typescript
thirdPassiveSkillText: template.third_passive_skill_text,
```

## Data Flow

```
Admin Form Input → shipTemplateProposalService.addShipTemplate()
    ↓
Supabase ship_templates.third_passive_skill_text
    ↓
useShipsData hook (fetch & transform)
    ↓
ShipIndexPage display with search
```

Import flow unchanged (skills managed manually).

## Testing Checklist

- [ ] Admin can create ship template with third passive skill
- [ ] Admin can create ship template without third passive skill (null handling)
- [ ] Third passive skill displays on ship index page when present
- [ ] Third passive skill hidden when not present
- [ ] Search includes third passive skill text
- [ ] Existing ships with 0-2 passive skills display correctly
- [ ] ShareSkillButton works for third passive

## Rollback Plan

1. Remove column from database: `ALTER TABLE ship_templates DROP COLUMN third_passive_skill_text;`
2. Revert code changes via git
3. No data loss risk (additive-only change)

## Future Considerations

If the game adds 4+ passive skills in the future, consider refactoring to a `passiveSkills: string[]` array structure to avoid repetitive field additions.
