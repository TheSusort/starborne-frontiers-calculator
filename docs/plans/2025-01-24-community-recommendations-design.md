# Community Recommendations System Design

## Overview

Replace the AI-based recommendation system with a community-driven system where users share their autogear configurations for specific ships, and other users can vote on them.

## User Flow

1. User selects a ship → sees existing community recommendations (if any) or empty state
2. User configures and runs autogear → "Share to Community" button appears
3. User clicks share → inline form expands (title, optional description, implant-specific checkbox)
4. User submits → config saved as community recommendation
5. Other users see the recommendation, can vote helpful/not helpful

## Database Schema

### Rename and Modify Existing Table

```sql
-- Rename table
ALTER TABLE ai_recommendations RENAME TO community_recommendations;

-- Add new columns
ALTER TABLE community_recommendations ADD COLUMN title TEXT NOT NULL;
ALTER TABLE community_recommendations ADD COLUMN description TEXT;
ALTER TABLE community_recommendations ADD COLUMN is_implant_specific BOOLEAN DEFAULT FALSE;
ALTER TABLE community_recommendations ADD COLUMN ultimate_implant TEXT;

-- Drop old columns
ALTER TABLE community_recommendations DROP COLUMN ship_implants;

-- Rename votes table
ALTER TABLE ai_recommendation_votes RENAME TO community_recommendation_votes;
ALTER TABLE community_recommendation_votes
  RENAME CONSTRAINT ai_recommendation_votes_pkey TO community_recommendation_votes_pkey;
ALTER TABLE community_recommendation_votes
  RENAME CONSTRAINT ai_recommendation_votes_recommendation_id_fkey TO community_recommendation_votes_recommendation_id_fkey;
ALTER TABLE community_recommendation_votes
  RENAME CONSTRAINT ai_recommendation_votes_user_id_fkey TO community_recommendation_votes_user_id_fkey;
```

### Final Schema

**community_recommendations:**
| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| ship_name | text | Ship this recommendation is for |
| ship_refit_level | integer | Refit level (0 or 2) |
| title | text | User-provided title (required) |
| description | text | Optional description |
| is_implant_specific | boolean | If true, only shown to matching implant users |
| ultimate_implant | text | Ultimate implant name (null if not implant-specific) |
| ship_role | text | Role setting from config |
| stat_priorities | jsonb | Stat priorities from config |
| stat_bonuses | jsonb | Stat bonuses from config |
| set_priorities | jsonb | Set priorities from config |
| reasoning | text | Kept for backwards compat, can be null |
| upvotes | integer | Upvote count |
| downvotes | integer | Downvote count |
| total_votes | integer | Computed: upvotes + downvotes |
| score | numeric | Computed: upvotes / total_votes |
| created_by | uuid | User who created it |
| created_at | timestamptz | Creation timestamp |
| updated_at | timestamptz | Last update timestamp |

**community_recommendation_votes:** (unchanged structure)
| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| recommendation_id | uuid | FK to community_recommendations |
| user_id | uuid | FK to auth.users |
| vote_type | text | 'upvote' or 'downvote' |
| created_at | timestamptz | Vote timestamp |

## Matching Logic

When fetching recommendations for a ship:

1. Get the user's ship's ultimate implant (if any)
2. Query recommendations where:
   - `ship_name` matches AND
   - Either `is_implant_specific = false` OR (`is_implant_specific = true` AND `ultimate_implant` = user's ultimate implant)
3. Order by: score DESC, total_votes DESC, created_at DESC
4. Return best match + alternatives

## Service Layer

### CommunityRecommendationService

**Location:** `src/services/communityRecommendations.ts`

```typescript
interface CommunityRecommendation {
  id: string;
  ship_name: string;
  ship_refit_level: number;
  title: string;
  description?: string;
  is_implant_specific: boolean;
  ultimate_implant?: string;
  ship_role: string;
  stat_priorities: StatPriority[];
  stat_bonuses: StatBonus[];
  set_priorities: SetPriority[];
  upvotes: number;
  downvotes: number;
  total_votes: number;
  score: number;
  created_by: string;
  created_at: string;
}

interface CreateRecommendationInput {
  shipName: string;
  title: string;
  description?: string;
  isImplantSpecific: boolean;
  ultimateImplant?: string;
  config: SavedAutogearConfig;
}
```

**Methods:**

- `getBestRecommendation(shipName: string, ultimateImplant?: string): Promise<CommunityRecommendation | null>`
- `getAlternatives(shipName: string, ultimateImplant?: string, excludeId?: string): Promise<CommunityRecommendation[]>`
- `createRecommendation(input: CreateRecommendationInput): Promise<CommunityRecommendation>`
- `voteOnRecommendation(recommendationId: string, voteType: 'upvote' | 'downvote'): Promise<void>`
- `getUserVote(recommendationId: string): Promise<'upvote' | 'downvote' | null>`
- `removeVote(recommendationId: string): Promise<void>`

## UI Components

### Component Structure

```
src/components/autogear/
├── CommunityRecommendations.tsx (renamed from LLMSuggestions.tsx)
├── RecommendationHeader.tsx (modified - show title)
├── RecommendationContent.tsx (unchanged)
├── AlternativeRecommendations.tsx (unchanged)
├── CommunityActions.tsx (modified - add share button)
└── ShareRecommendationForm.tsx (new)
```

### CommunityRecommendations.tsx

Main container component. Receives:
- `selectedShip: Ship`
- `hasRunAutogear: boolean`
- `currentConfig: SavedAutogearConfig` (the config used for last autogear run)

States:
- Empty: "No community recommendations yet. Be the first to share one!"
- Has recommendation: Collapsible accordion showing best recommendation
- Alternatives available: Show "View alternatives" button

### RecommendationHeader.tsx

Changes:
- Display `title` instead of ship role
- Keep vote count display (colored based on positive/negative)
- Keep expand/collapse functionality

### ShareRecommendationForm.tsx (new)

Inline form that expands when "Share to Community" is clicked:

```tsx
<div className="mt-4 space-y-3 border-t border-dark-600 pt-4">
  <input
    placeholder="Build title (e.g., High Crit DPS)"
    required
  />
  <textarea
    placeholder="Optional description..."
  />
  <label>
    <input type="checkbox" />
    Only show to users with the same ultimate implant
  </label>
  <div className="flex gap-2">
    <button>Share</button>
    <button>Cancel</button>
  </div>
</div>
```

### CommunityActions.tsx

Changes:
- Keep voting buttons (Helpful / Not Helpful)
- Add "Share to Community" button (only visible when `hasRunAutogear` is true)
- Button triggers ShareRecommendationForm expansion

## Hook

### useCommunityRecommendations

**Location:** `src/hooks/useCommunityRecommendations.ts`

```typescript
interface UseCommunityRecommendationsInput {
  selectedShip: Ship | null;
  hasRunAutogear: boolean;
  currentConfig: SavedAutogearConfig | null;
}

interface UseCommunityRecommendationsOutput {
  recommendation: CommunityRecommendation | null;
  alternatives: CommunityRecommendation[];
  selectedAlternative: CommunityRecommendation | null;
  loading: boolean;
  error: string | null;
  userVote: 'upvote' | 'downvote' | null;
  showShareForm: boolean;
  showAlternatives: boolean;

  handleVote: (voteType: 'upvote' | 'downvote') => Promise<void>;
  handleShare: (title: string, description?: string, isImplantSpecific: boolean) => Promise<void>;
  handleSelectAlternative: (alt: CommunityRecommendation) => void;
  handleBackToMain: () => void;
  setShowShareForm: (show: boolean) => void;
  setShowAlternatives: (show: boolean) => void;
}
```

**Logic:**
1. On ship change: fetch best recommendation + alternatives
2. Extract ultimate implant from ship's equipped implants
3. Pass ultimate implant to service for matching
4. Track user's vote on current recommendation
5. Handle share form submission

## Edge Cases

1. **No ultimate implant on ship:**
   - Only see general recommendations
   - "Implant specific" checkbox disabled with tooltip explaining why

2. **User not logged in:**
   - Can view recommendations
   - Share button shows "Sign in to share"
   - Vote buttons show "Sign in to vote"

3. **Empty state:**
   - Show encouraging message: "No community recommendations yet. Be the first to share one!"
   - If hasRunAutogear, show share button below the message

4. **Refit level handling:**
   - Keep normalization (0 or 2) in stored data
   - Don't filter by refit level when fetching (ship name + implant matching is sufficient)

## Files to Modify

1. **Database:** New migration script
2. **Service:** Rename `aiRecommendations.ts` → `communityRecommendations.ts`, update methods
3. **Hook:** Rename `useLLMRecommendations.ts` → `useCommunityRecommendations.ts`, remove AI logic
4. **Components:**
   - Rename `LLMSuggestions.tsx` → `CommunityRecommendations.tsx`
   - Modify `RecommendationHeader.tsx` for title display
   - Modify `CommunityActions.tsx` for share button
   - Create `ShareRecommendationForm.tsx`
5. **Integration:** Update `AutogearQuickSettings.tsx` to pass `hasRunAutogear` and `currentConfig`

## Removed

- AI generation fallback (`fetchAISuggestion`)
- LLM service integration
- Duplicate prevention logic (users can submit unlimited recommendations)
- `ship_implants` jsonb column (replaced by single `ultimate_implant` text field)
