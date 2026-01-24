# Community Recommendations Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the AI-based recommendation system with a community-driven system where users share autogear configurations and vote on them.

**Architecture:** Rename existing `ai_recommendations` table to `community_recommendations`, add title/description/implant fields, update service layer to match by ultimate implant only, modify UI to show share form after running autogear.

**Tech Stack:** React, TypeScript, Supabase (PostgreSQL), TailwindCSS

---

## Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/20250125000001_community_recommendations.sql`

**Step 1: Create the migration file**

```sql
-- Migration: Convert AI recommendations to Community recommendations
-- This migration renames tables and adds new columns for the community system

-- Step 1: Rename the main table
ALTER TABLE public.ai_recommendations RENAME TO community_recommendations;

-- Step 2: Add new columns for community features
ALTER TABLE public.community_recommendations
  ADD COLUMN title TEXT,
  ADD COLUMN description TEXT,
  ADD COLUMN is_implant_specific BOOLEAN DEFAULT FALSE,
  ADD COLUMN ultimate_implant TEXT;

-- Step 3: Backfill title for existing records (use ship_role as default title)
UPDATE public.community_recommendations
SET title = ship_role || ' Build'
WHERE title IS NULL;

-- Step 4: Make title NOT NULL after backfill
ALTER TABLE public.community_recommendations
  ALTER COLUMN title SET NOT NULL;

-- Step 5: Drop the old ship_implants column (replaced by ultimate_implant)
ALTER TABLE public.community_recommendations
  DROP COLUMN IF EXISTS ship_implants;

-- Step 6: Rename the votes table
ALTER TABLE public.ai_recommendation_votes RENAME TO community_recommendation_votes;

-- Step 7: Update the foreign key constraint name (for clarity)
ALTER TABLE public.community_recommendation_votes
  DROP CONSTRAINT IF EXISTS ai_recommendation_votes_recommendation_id_fkey;

ALTER TABLE public.community_recommendation_votes
  ADD CONSTRAINT community_recommendation_votes_recommendation_id_fkey
  FOREIGN KEY (recommendation_id) REFERENCES public.community_recommendations(id) ON DELETE CASCADE;

-- Step 8: Drop the old RPC function that used ship_implants
DROP FUNCTION IF EXISTS get_best_recommendation(text, integer, jsonb);

-- Step 9: Create new RPC function for fetching best recommendation
CREATE OR REPLACE FUNCTION get_best_community_recommendation(
  p_ship_name TEXT,
  p_ultimate_implant TEXT DEFAULT NULL
)
RETURNS SETOF community_recommendations
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT *
  FROM community_recommendations
  WHERE ship_name = p_ship_name
    AND (
      -- General recommendations (not implant-specific)
      is_implant_specific = FALSE
      OR
      -- Implant-specific recommendations matching user's implant
      (is_implant_specific = TRUE AND ultimate_implant = p_ultimate_implant)
    )
  ORDER BY score DESC NULLS LAST, total_votes DESC NULLS LAST, created_at DESC
  LIMIT 1;
END;
$$;

-- Step 10: Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_community_recommendations_ship_implant
  ON community_recommendations(ship_name, is_implant_specific, ultimate_implant);
```

**Step 2: Apply migration to Supabase**

Run in Supabase SQL Editor or via CLI:
```bash
supabase db push
```

**Step 3: Commit**

```bash
git add supabase/migrations/20250125000001_community_recommendations.sql
git commit -m "feat(db): migrate ai_recommendations to community_recommendations

- Rename tables and add title, description, implant fields
- Create new RPC function for fetching by ultimate implant
- Add index for faster queries"
```

---

## Task 2: Create CommunityRecommendation Types

**Files:**
- Create: `src/types/communityRecommendation.ts`

**Step 1: Create the types file**

```typescript
import { StatPriority, SetPriority, StatBonus } from './autogear';

export interface CommunityRecommendation {
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
  reasoning?: string;
  upvotes: number;
  downvotes: number;
  total_votes: number;
  score: number;
  created_by?: string;
  created_at: string;
  updated_at?: string;
}

export interface CreateCommunityRecommendationInput {
  shipName: string;
  title: string;
  description?: string;
  isImplantSpecific: boolean;
  ultimateImplant?: string;
  shipRole: string;
  statPriorities: StatPriority[];
  statBonuses: StatBonus[];
  setPriorities: SetPriority[];
}
```

**Step 2: Commit**

```bash
git add src/types/communityRecommendation.ts
git commit -m "feat: add CommunityRecommendation types"
```

---

## Task 3: Create CommunityRecommendationService

**Files:**
- Create: `src/services/communityRecommendations.ts`
- Delete: `src/services/aiRecommendations.ts` (after migration complete)

**Step 1: Create the new service file**

```typescript
import { supabase } from '../config/supabase';
import {
  CommunityRecommendation,
  CreateCommunityRecommendationInput,
} from '../types/communityRecommendation';

export class CommunityRecommendationService {
  /**
   * Get the best community recommendation for a ship
   */
  static async getBestRecommendation(
    shipName: string,
    ultimateImplant?: string
  ): Promise<CommunityRecommendation | null> {
    try {
      const { data, error } = await supabase.rpc('get_best_community_recommendation', {
        p_ship_name: shipName,
        p_ultimate_implant: ultimateImplant || null,
      });

      if (error) {
        console.error('Error fetching best recommendation:', error);
        return null;
      }

      return data?.[0] || null;
    } catch (error) {
      console.error('Error in getBestRecommendation:', error);
      return null;
    }
  }

  /**
   * Get alternative recommendations (excluding the best one)
   */
  static async getAlternatives(
    shipName: string,
    ultimateImplant?: string,
    excludeId?: string
  ): Promise<CommunityRecommendation[]> {
    try {
      let query = supabase
        .from('community_recommendations')
        .select('*')
        .eq('ship_name', shipName)
        .order('score', { ascending: false, nullsFirst: false })
        .order('total_votes', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false });

      if (excludeId) {
        query = query.neq('id', excludeId);
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error fetching alternatives:', error);
        return [];
      }

      // Filter by implant matching logic in JavaScript
      return (data || []).filter((rec) => {
        // Include general recommendations
        if (!rec.is_implant_specific) return true;
        // Include implant-specific if it matches user's implant
        return rec.ultimate_implant === ultimateImplant;
      });
    } catch (error) {
      console.error('Error in getAlternatives:', error);
      return [];
    }
  }

  /**
   * Create a new community recommendation
   */
  static async createRecommendation(
    input: CreateCommunityRecommendationInput
  ): Promise<CommunityRecommendation | null> {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        console.warn('User must be logged in to create recommendation');
        return null;
      }

      const { data, error } = await supabase
        .from('community_recommendations')
        .insert({
          ship_name: input.shipName,
          ship_refit_level: 0, // Not used for matching anymore
          title: input.title,
          description: input.description || null,
          is_implant_specific: input.isImplantSpecific,
          ultimate_implant: input.isImplantSpecific ? input.ultimateImplant : null,
          ship_role: input.shipRole,
          stat_priorities: JSON.parse(JSON.stringify(input.statPriorities)),
          stat_bonuses: JSON.parse(JSON.stringify(input.statBonuses)),
          set_priorities: JSON.parse(JSON.stringify(input.setPriorities)),
          created_by: user.id,
        })
        .select()
        .single();

      if (error) {
        console.error('Error creating recommendation:', error);
        return null;
      }

      return data;
    } catch (error) {
      console.error('Error in createRecommendation:', error);
      return null;
    }
  }

  /**
   * Vote on a recommendation
   */
  static async voteOnRecommendation(
    recommendationId: string,
    voteType: 'upvote' | 'downvote'
  ): Promise<boolean> {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        console.warn('User must be logged in to vote');
        return false;
      }

      const { error } = await supabase
        .from('community_recommendation_votes')
        .upsert({
          recommendation_id: recommendationId,
          user_id: user.id,
          vote_type: voteType,
        })
        .select();

      if (error) {
        console.error('Error voting:', error);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Error in voteOnRecommendation:', error);
      return false;
    }
  }

  /**
   * Get user's vote on a recommendation
   */
  static async getUserVote(recommendationId: string): Promise<'upvote' | 'downvote' | null> {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) return null;

      const { data, error } = await supabase
        .from('community_recommendation_votes')
        .select('vote_type')
        .eq('recommendation_id', recommendationId)
        .eq('user_id', user.id)
        .single();

      if (error) return null;

      return data?.vote_type || null;
    } catch (error) {
      console.error('Error in getUserVote:', error);
      return null;
    }
  }

  /**
   * Remove user's vote
   */
  static async removeVote(recommendationId: string): Promise<boolean> {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) return false;

      const { error } = await supabase
        .from('community_recommendation_votes')
        .delete()
        .eq('recommendation_id', recommendationId)
        .eq('user_id', user.id);

      if (error) {
        console.error('Error removing vote:', error);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Error in removeVote:', error);
      return false;
    }
  }
}
```

**Step 2: Commit**

```bash
git add src/services/communityRecommendations.ts
git commit -m "feat: add CommunityRecommendationService"
```

---

## Task 4: Create useCommunityRecommendations Hook

**Files:**
- Create: `src/hooks/useCommunityRecommendations.ts`

**Step 1: Create the hook**

```typescript
import { useState, useEffect, useCallback, useRef } from 'react';
import { Ship } from '../types/ship';
import { CommunityRecommendation } from '../types/communityRecommendation';
import { CommunityRecommendationService } from '../services/communityRecommendations';
import { SavedAutogearConfig } from '../types/autogear';
import { IMPLANTS } from '../constants/implants';
import { useInventory } from '../contexts/InventoryProvider';

interface UseCommunityRecommendationsProps {
  selectedShip: Ship | null;
  hasRunAutogear: boolean;
  currentConfig: SavedAutogearConfig | null;
}

interface UseCommunityRecommendationsReturn {
  recommendation: CommunityRecommendation | null;
  alternatives: CommunityRecommendation[];
  selectedAlternative: CommunityRecommendation | null;
  loading: boolean;
  error: string | null;
  userVote: 'upvote' | 'downvote' | null;
  showShareForm: boolean;
  showAlternatives: boolean;
  ultimateImplantName: string | null;
  handleVote: (voteType: 'upvote' | 'downvote') => Promise<void>;
  handleShare: (title: string, description: string, isImplantSpecific: boolean) => Promise<boolean>;
  handleSelectAlternative: (alt: CommunityRecommendation) => void;
  handleBackToMain: () => Promise<void>;
  setShowShareForm: (show: boolean) => void;
  setShowAlternatives: (show: boolean) => void;
  refreshRecommendation: () => Promise<void>;
}

export const useCommunityRecommendations = ({
  selectedShip,
  hasRunAutogear,
  currentConfig,
}: UseCommunityRecommendationsProps): UseCommunityRecommendationsReturn => {
  const { getGearPiece } = useInventory();

  const [recommendation, setRecommendation] = useState<CommunityRecommendation | null>(null);
  const [alternatives, setAlternatives] = useState<CommunityRecommendation[]>([]);
  const [selectedAlternative, setSelectedAlternative] = useState<CommunityRecommendation | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userVote, setUserVote] = useState<'upvote' | 'downvote' | null>(null);
  const [showShareForm, setShowShareForm] = useState(false);
  const [showAlternatives, setShowAlternatives] = useState(false);
  const [lastShipName, setLastShipName] = useState<string | null>(null);

  const isFetchingRef = useRef(false);

  // Get ultimate implant name from ship
  const getUltimateImplantName = useCallback((): string | null => {
    if (!selectedShip?.implants) return null;

    const ultimateImplantId = selectedShip.implants['implant_ultimate'];
    if (!ultimateImplantId) return null;

    const implantPiece = getGearPiece(ultimateImplantId);
    if (!implantPiece?.setBonus) return null;

    const implantData = IMPLANTS[implantPiece.setBonus];
    if (implantData?.type === 'ultimate') {
      return implantData.name;
    }

    return null;
  }, [selectedShip, getGearPiece]);

  const ultimateImplantName = getUltimateImplantName();

  const fetchRecommendation = useCallback(async () => {
    if (!selectedShip || isFetchingRef.current) return;

    isFetchingRef.current = true;
    setLoading(true);
    setError(null);
    setRecommendation(null);
    setAlternatives([]);
    setSelectedAlternative(null);
    setUserVote(null);
    setShowShareForm(false);
    setShowAlternatives(false);

    try {
      const implantName = getUltimateImplantName();

      const bestRec = await CommunityRecommendationService.getBestRecommendation(
        selectedShip.name,
        implantName || undefined
      );

      if (bestRec) {
        setRecommendation(bestRec);

        // Get user's vote
        if (bestRec.id) {
          const vote = await CommunityRecommendationService.getUserVote(bestRec.id);
          setUserVote(vote);
        }

        // Get alternatives
        const alts = await CommunityRecommendationService.getAlternatives(
          selectedShip.name,
          implantName || undefined,
          bestRec.id
        );
        setAlternatives(alts);
      }
    } catch (err) {
      console.error('Error fetching recommendation:', err);
      setError('Failed to load community recommendations');
    } finally {
      setLoading(false);
      isFetchingRef.current = false;
    }
  }, [selectedShip, getUltimateImplantName]);

  const handleVote = useCallback(
    async (voteType: 'upvote' | 'downvote') => {
      const currentRec = selectedAlternative || recommendation;
      if (!currentRec?.id) return;

      try {
        if (userVote === voteType) {
          await CommunityRecommendationService.removeVote(currentRec.id);
          setUserVote(null);
        } else {
          await CommunityRecommendationService.voteOnRecommendation(currentRec.id, voteType);
          setUserVote(voteType);
        }

        // Refresh to get updated vote counts
        await fetchRecommendation();
      } catch (err) {
        console.error('Error voting:', err);
      }
    },
    [recommendation, selectedAlternative, userVote, fetchRecommendation]
  );

  const handleShare = useCallback(
    async (title: string, description: string, isImplantSpecific: boolean): Promise<boolean> => {
      if (!selectedShip || !currentConfig) {
        setError('No configuration to share');
        return false;
      }

      try {
        const implantName = getUltimateImplantName();

        // If implant-specific but no implant, show error
        if (isImplantSpecific && !implantName) {
          setError('Cannot mark as implant-specific without an ultimate implant');
          return false;
        }

        const saved = await CommunityRecommendationService.createRecommendation({
          shipName: selectedShip.name,
          title,
          description: description || undefined,
          isImplantSpecific,
          ultimateImplant: isImplantSpecific ? implantName || undefined : undefined,
          shipRole: currentConfig.shipRole || 'ATTACKER',
          statPriorities: currentConfig.statPriorities,
          statBonuses: currentConfig.statBonuses,
          setPriorities: currentConfig.setPriorities,
        });

        if (saved) {
          setShowShareForm(false);
          setError(null);
          // Refresh to show the new recommendation
          await fetchRecommendation();
          return true;
        } else {
          setError('Failed to share recommendation. Are you signed in?');
          return false;
        }
      } catch (err) {
        console.error('Error sharing:', err);
        setError('Failed to share recommendation');
        return false;
      }
    },
    [selectedShip, currentConfig, getUltimateImplantName, fetchRecommendation]
  );

  const handleSelectAlternative = useCallback(
    async (alt: CommunityRecommendation) => {
      setSelectedAlternative(alt);

      if (alt.id) {
        const vote = await CommunityRecommendationService.getUserVote(alt.id);
        setUserVote(vote);
      }
    },
    []
  );

  const handleBackToMain = useCallback(async () => {
    setSelectedAlternative(null);

    if (recommendation?.id) {
      const vote = await CommunityRecommendationService.getUserVote(recommendation.id);
      setUserVote(vote);
    }
  }, [recommendation]);

  // Auto-fetch when ship changes
  useEffect(() => {
    if (selectedShip?.name && selectedShip.name !== lastShipName && !isFetchingRef.current) {
      setLastShipName(selectedShip.name);
      fetchRecommendation();
    }
  }, [selectedShip?.name, lastShipName, fetchRecommendation]);

  return {
    recommendation,
    alternatives,
    selectedAlternative,
    loading,
    error,
    userVote,
    showShareForm,
    showAlternatives,
    ultimateImplantName,
    handleVote,
    handleShare,
    handleSelectAlternative,
    handleBackToMain,
    setShowShareForm,
    setShowAlternatives,
    refreshRecommendation: fetchRecommendation,
  };
};
```

**Step 2: Commit**

```bash
git add src/hooks/useCommunityRecommendations.ts
git commit -m "feat: add useCommunityRecommendations hook"
```

---

## Task 5: Create ShareRecommendationForm Component

**Files:**
- Create: `src/components/autogear/ShareRecommendationForm.tsx`

**Step 1: Create the component**

```typescript
import React, { useState } from 'react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';

interface ShareRecommendationFormProps {
  onSubmit: (title: string, description: string, isImplantSpecific: boolean) => Promise<boolean>;
  onCancel: () => void;
  ultimateImplantName: string | null;
  isSubmitting?: boolean;
}

export const ShareRecommendationForm: React.FC<ShareRecommendationFormProps> = ({
  onSubmit,
  onCancel,
  ultimateImplantName,
  isSubmitting = false,
}) => {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [isImplantSpecific, setIsImplantSpecific] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!title.trim()) {
      setError('Title is required');
      return;
    }

    if (title.trim().length < 3) {
      setError('Title must be at least 3 characters');
      return;
    }

    if (title.trim().length > 50) {
      setError('Title must be less than 50 characters');
      return;
    }

    setError(null);
    const success = await onSubmit(title.trim(), description.trim(), isImplantSpecific);
    if (success) {
      setTitle('');
      setDescription('');
      setIsImplantSpecific(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="mt-4 space-y-3 border-t border-dark-600 pt-4">
      <div>
        <Input
          placeholder="Build title (e.g., High Crit DPS)"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={50}
          disabled={isSubmitting}
        />
      </div>

      <div>
        <textarea
          placeholder="Optional description - explain your build strategy..."
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={500}
          disabled={isSubmitting}
          className="w-full px-3 py-2 bg-dark-700 border border-dark-600 text-white placeholder-gray-500 focus:outline-none focus:border-primary-500 resize-none"
          rows={3}
        />
      </div>

      <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
        <input
          type="checkbox"
          checked={isImplantSpecific}
          onChange={(e) => setIsImplantSpecific(e.target.checked)}
          disabled={!ultimateImplantName || isSubmitting}
          className="w-4 h-4 rounded border-dark-600 bg-dark-700 text-primary-500 focus:ring-primary-500"
        />
        <span className={!ultimateImplantName ? 'text-gray-500' : ''}>
          Only show to users with {ultimateImplantName || 'the same ultimate implant'}
        </span>
      </label>
      {!ultimateImplantName && (
        <p className="text-xs text-gray-500 ml-6">
          Equip an ultimate implant to enable this option
        </p>
      )}

      {error && <p className="text-red-400 text-sm">{error}</p>}

      <div className="flex gap-2">
        <Button type="submit" variant="primary" size="sm" disabled={isSubmitting}>
          {isSubmitting ? 'Sharing...' : 'Share'}
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={onCancel} disabled={isSubmitting}>
          Cancel
        </Button>
      </div>
    </form>
  );
};
```

**Step 2: Commit**

```bash
git add src/components/autogear/ShareRecommendationForm.tsx
git commit -m "feat: add ShareRecommendationForm component"
```

---

## Task 6: Update RecommendationHeader Component

**Files:**
- Modify: `src/components/autogear/RecommendationHeader.tsx`

**Step 1: Update to show title and remove AI-related UI**

Replace the entire file content:

```typescript
import React from 'react';
import { Loader } from '../ui/Loader';
import { CommunityRecommendation } from '../../types/communityRecommendation';
import { ChevronDownIcon } from '../ui/icons';

interface RecommendationHeaderProps {
  recommendation: CommunityRecommendation | null;
  loading: boolean;
  isExpanded: boolean;
  onToggleExpand: () => void;
}

export const RecommendationHeader: React.FC<RecommendationHeaderProps> = ({
  recommendation,
  loading,
  isExpanded,
  onToggleExpand,
}) => {
  const renderVoteSum = (upvotes: number, downvotes: number) => {
    const sum = upvotes - downvotes;
    if (sum > 0) {
      return <span className="text-green-400">+{sum}</span>;
    } else if (sum < 0) {
      return <span className="text-red-400">{sum}</span>;
    } else {
      return <span className="text-gray-400">0</span>;
    }
  };

  return (
    <div
      onClick={onToggleExpand}
      className="w-full p-4 bg-dark border-b border-dark-border hover:bg-dark-lighter transition-colors text-left text-sm cursor-pointer"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <span>
            <ChevronDownIcon
              className={`transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`}
            />
          </span>
          {loading ? (
            <span className="text-gray-400">Loading recommendations...</span>
          ) : recommendation ? (
            <>
              <span className="font-medium">{recommendation.title}</span>
              <div className="flex items-center space-x-2 text-gray-400">
                {renderVoteSum(recommendation.upvotes || 0, recommendation.downvotes || 0)}
                <span>({Math.round((recommendation.score || 0) * 100)}% positive)</span>
              </div>
              {recommendation.is_implant_specific && recommendation.ultimate_implant && (
                <span className="text-xs bg-purple-900/50 text-purple-300 px-2 py-0.5 rounded">
                  {recommendation.ultimate_implant}
                </span>
              )}
            </>
          ) : (
            <span className="text-gray-400">Community Recommendations</span>
          )}
        </div>
        {loading && (
          <div className="flex items-center space-x-2">
            <Loader size="sm" />
          </div>
        )}
      </div>
    </div>
  );
};
```

**Step 2: Commit**

```bash
git add src/components/autogear/RecommendationHeader.tsx
git commit -m "refactor: update RecommendationHeader for community system

- Show recommendation title instead of generic label
- Display implant badge for implant-specific recommendations
- Remove AI-related buttons"
```

---

## Task 7: Update CommunityActions Component

**Files:**
- Modify: `src/components/autogear/CommunityActions.tsx`

**Step 1: Update to add share button and remove AI save**

Replace the entire file content:

```typescript
import React from 'react';
import { Button } from '../ui/Button';
import { CommunityRecommendation } from '../../types/communityRecommendation';
import { useAuth } from '../../contexts/AuthProvider';

interface CommunityActionsProps {
  recommendation: CommunityRecommendation | null;
  userVote: 'upvote' | 'downvote' | null;
  hasRunAutogear: boolean;
  showShareForm: boolean;
  onVote: (voteType: 'upvote' | 'downvote') => void;
  onToggleShareForm: () => void;
}

export const CommunityActions: React.FC<CommunityActionsProps> = ({
  recommendation,
  userVote,
  hasRunAutogear,
  showShareForm,
  onVote,
  onToggleShareForm,
}) => {
  const { user } = useAuth();

  return (
    <div className="pt-2 border-t border-gray-600 space-y-3">
      {/* Voting for community recommendations */}
      {recommendation?.id && (
        <div className="flex items-center justify-center space-x-4">
          <span className="text-sm text-gray-400">Rate this recommendation:</span>
          {user ? (
            <>
              <Button
                size="sm"
                variant={userVote === 'upvote' ? 'primary' : 'secondary'}
                onClick={() => onVote('upvote')}
                className="flex items-center space-x-1"
              >
                <span>Helpful</span>
              </Button>
              <Button
                size="sm"
                variant={userVote === 'downvote' ? 'danger' : 'secondary'}
                onClick={() => onVote('downvote')}
                className="flex items-center space-x-1"
              >
                <span>Not Helpful</span>
              </Button>
            </>
          ) : (
            <span className="text-sm text-gray-500">Sign in to vote</span>
          )}
        </div>
      )}

      {/* Share to community button - only show after running autogear */}
      {hasRunAutogear && !showShareForm && (
        <div className="flex justify-center">
          {user ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={onToggleShareForm}
              className="flex items-center space-x-2"
            >
              <span>Share to Community</span>
            </Button>
          ) : (
            <span className="text-sm text-gray-500">Sign in to share your build</span>
          )}
        </div>
      )}
    </div>
  );
};
```

**Step 2: Commit**

```bash
git add src/components/autogear/CommunityActions.tsx
git commit -m "refactor: update CommunityActions for community system

- Add share button that shows after autogear runs
- Show sign-in prompts for non-authenticated users
- Remove AI-specific save functionality"
```

---

## Task 8: Create CommunityRecommendations Component (Main Container)

**Files:**
- Create: `src/components/autogear/CommunityRecommendations.tsx`

**Step 1: Create the main container component**

```typescript
import React, { useState } from 'react';
import { Ship } from '../../types/ship';
import { SavedAutogearConfig } from '../../types/autogear';
import { RecommendationHeader } from './RecommendationHeader';
import { RecommendationContent } from './RecommendationContent';
import { AlternativeRecommendations } from './AlternativeRecommendations';
import { CommunityActions } from './CommunityActions';
import { ShareRecommendationForm } from './ShareRecommendationForm';
import { CollapsibleAccordion } from '../ui/CollapsibleAccordion';
import { useCommunityRecommendations } from '../../hooks/useCommunityRecommendations';
import { AutogearSuggestion } from '../../types/autogearSuggestion';

interface CommunityRecommendationsProps {
  selectedShip: Ship | null;
  hasRunAutogear: boolean;
  currentConfig: SavedAutogearConfig | null;
}

export const CommunityRecommendations: React.FC<CommunityRecommendationsProps> = ({
  selectedShip,
  hasRunAutogear,
  currentConfig,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const {
    recommendation,
    alternatives,
    selectedAlternative,
    loading,
    error,
    userVote,
    showShareForm,
    showAlternatives,
    ultimateImplantName,
    handleVote,
    handleShare,
    handleSelectAlternative,
    handleBackToMain,
    setShowShareForm,
    setShowAlternatives,
  } = useCommunityRecommendations({
    selectedShip,
    hasRunAutogear,
    currentConfig,
  });

  const handleShareSubmit = async (
    title: string,
    description: string,
    isImplantSpecific: boolean
  ): Promise<boolean> => {
    setIsSubmitting(true);
    const success = await handleShare(title, description, isImplantSpecific);
    setIsSubmitting(false);
    return success;
  };

  if (!selectedShip) {
    return null;
  }

  const currentRecommendation = selectedAlternative || recommendation;

  // Convert CommunityRecommendation to AutogearSuggestion for RecommendationContent
  const suggestionFromRecommendation = currentRecommendation
    ? ({
        shipRole: currentRecommendation.ship_role,
        statPriorities: currentRecommendation.stat_priorities,
        statBonuses: currentRecommendation.stat_bonuses,
        setPriorities: currentRecommendation.set_priorities,
        reasoning: currentRecommendation.reasoning || currentRecommendation.description || '',
      } as AutogearSuggestion)
    : null;

  return (
    <div className="mt-4 border border-dark-border overflow-hidden">
      <RecommendationHeader
        recommendation={currentRecommendation}
        loading={loading}
        isExpanded={isExpanded}
        onToggleExpand={() => setIsExpanded(!isExpanded)}
      />

      <CollapsibleAccordion isOpen={isExpanded}>
        {error && (
          <div className="text-red-400 bg-red-900/20 p-3 border border-red-700">
            <p className="font-medium">{error}</p>
          </div>
        )}

        {!loading && !currentRecommendation && (
          <div className="p-4 text-center">
            <p className="text-gray-400 mb-2">
              No community recommendations yet for this ship.
            </p>
            {hasRunAutogear && (
              <p className="text-gray-500 text-sm">
                Be the first to share your build!
              </p>
            )}
          </div>
        )}

        {suggestionFromRecommendation && (
          <div className="space-y-4">
            {currentRecommendation?.description && (
              <div className="px-4 pt-4">
                <p className="text-gray-300 text-sm italic">
                  "{currentRecommendation.description}"
                </p>
              </div>
            )}

            <RecommendationContent suggestion={suggestionFromRecommendation} />

            <AlternativeRecommendations
              alternatives={alternatives.map((alt) => ({
                ...alt,
                ship_implants: {},
              }))}
              showAlternatives={showAlternatives}
              selectedAlternative={
                selectedAlternative
                  ? { ...selectedAlternative, ship_implants: {} }
                  : null
              }
              onToggleShow={() => setShowAlternatives(!showAlternatives)}
              onSelectAlternative={(alt) => {
                const fullAlt = alternatives.find((a) => a.id === alt.id);
                if (fullAlt) handleSelectAlternative(fullAlt);
              }}
              onBackToMain={handleBackToMain}
            />

            <CommunityActions
              recommendation={currentRecommendation}
              userVote={userVote}
              hasRunAutogear={hasRunAutogear}
              showShareForm={showShareForm}
              onVote={handleVote}
              onToggleShareForm={() => setShowShareForm(!showShareForm)}
            />
          </div>
        )}

        {/* Empty state with share option */}
        {!loading && !currentRecommendation && hasRunAutogear && (
          <CommunityActions
            recommendation={null}
            userVote={null}
            hasRunAutogear={hasRunAutogear}
            showShareForm={showShareForm}
            onVote={() => {}}
            onToggleShareForm={() => setShowShareForm(!showShareForm)}
          />
        )}

        {/* Share form */}
        {showShareForm && (
          <div className="px-4 pb-4">
            <ShareRecommendationForm
              onSubmit={handleShareSubmit}
              onCancel={() => setShowShareForm(false)}
              ultimateImplantName={ultimateImplantName}
              isSubmitting={isSubmitting}
            />
          </div>
        )}
      </CollapsibleAccordion>
    </div>
  );
};
```

**Step 2: Commit**

```bash
git add src/components/autogear/CommunityRecommendations.tsx
git commit -m "feat: add CommunityRecommendations container component"
```

---

## Task 9: Update AutogearQuickSettings to Track Autogear State

**Files:**
- Modify: `src/components/autogear/AutogearQuickSettings.tsx`

**Step 1: Update imports and component**

Replace the entire file:

```typescript
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShipSelector } from '../ship/ShipSelector';
import { Button } from '../ui';
import { Ship } from '../../types/ship';
import { CloseIcon, GearIcon, InfoIcon } from '../ui/icons';
import { AutogearConfigList } from './AutogearConfigList';
import { CommunityRecommendations } from './CommunityRecommendations';
import { StatPriority, SetPriority, StatBonus, SavedAutogearConfig } from '../../types/autogear';
import { ShipTypeName } from '../../constants';
import { AutogearAlgorithm } from '../../utils/autogear/AutogearStrategy';

interface AutogearQuickSettingsProps {
  selectedShips: (Ship | null)[];
  onShipSelect: (ship: Ship, index: number) => void;
  onAddShip: () => void;
  onRemoveShip: (event: React.MouseEvent<HTMLButtonElement>, index: number) => void;
  onOpenSettings: (event: React.MouseEvent<HTMLButtonElement>, index: number) => void;
  onFindOptimalGear: () => void;
  getShipConfig: (shipId: string) => {
    shipRole: ShipTypeName | null;
    statPriorities: StatPriority[];
    setPriorities: SetPriority[];
    statBonuses: StatBonus[];
    ignoreEquipped: boolean;
    ignoreUnleveled: boolean;
    useUpgradedStats: boolean;
    tryToCompleteSets: boolean;
    selectedAlgorithm: AutogearAlgorithm;
    showSecondaryRequirements: boolean;
    optimizeImplants: boolean;
  };
  hasRunAutogear?: boolean;
  lastRunConfigs?: Record<string, SavedAutogearConfig>;
}

export const AutogearQuickSettings: React.FC<AutogearQuickSettingsProps> = ({
  selectedShips,
  onShipSelect,
  onAddShip,
  onRemoveShip,
  onOpenSettings,
  onFindOptimalGear,
  getShipConfig,
  hasRunAutogear = false,
  lastRunConfigs = {},
}) => {
  const navigate = useNavigate();
  const [autoOpenIndex, setAutoOpenIndex] = useState<number | null>(null);

  const handleAddShip = () => {
    onAddShip();
    setAutoOpenIndex(selectedShips.length);
  };

  const handleShipSelect = (ship: Ship, index: number) => {
    onShipSelect(ship, index);
    setAutoOpenIndex(null);
  };

  return (
    <div className="space-y-4 sticky top-2">
      <div className="flex justify-between items-center">
        <h3 className="text-xl font-bold">Autogear</h3>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={handleAddShip} className="text-sm">
            Add Ship
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        {selectedShips.map((ship, index) => (
          <div key={index} className="space-y-2">
            <div className="flex gap-2 items-start">
              <div className="flex-1">
                <ShipSelector
                  selected={ship || null}
                  onSelect={(selectedShip) => handleShipSelect(selectedShip, index)}
                  autoOpen={autoOpenIndex === index}
                >
                  {ship && <AutogearConfigList {...getShipConfig(ship.id)} />}
                  <div className="flex gap-2 items-center">
                    {ship && (
                      <Button
                        variant="secondary"
                        onClick={(event) => {
                          event.stopPropagation();
                          navigate(`/ships/${ship.id}`, {
                            state: {
                              from: '/autogear',
                              shipId: ship.id,
                            },
                          });
                        }}
                        size="sm"
                        className="flex gap-2 items-center"
                        title="View ship details"
                      >
                        <InfoIcon />
                      </Button>
                    )}
                    <Button
                      variant="secondary"
                      onClick={(event) => onOpenSettings(event, index)}
                      size="sm"
                      className="flex gap-2 items-center"
                    >
                      <GearIcon />
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={(event) => onRemoveShip(event, index)}
                    >
                      <CloseIcon className="w-4 h-4" />
                    </Button>
                  </div>
                </ShipSelector>
              </div>
            </div>
            {/* Community Recommendations */}
            {ship && (
              <CommunityRecommendations
                selectedShip={ship}
                hasRunAutogear={hasRunAutogear}
                currentConfig={lastRunConfigs[ship.id] || null}
              />
            )}
          </div>
        ))}
      </div>

      <div className="flex justify-end">
        <Button
          onClick={onFindOptimalGear}
          disabled={selectedShips.length === 0}
          variant="primary"
          className="w-full"
        >
          Find Optimal Gear
        </Button>
      </div>
    </div>
  );
};
```

**Step 2: Commit**

```bash
git add src/components/autogear/AutogearQuickSettings.tsx
git commit -m "refactor: update AutogearQuickSettings for community system

- Replace LLMSuggestions with CommunityRecommendations
- Add hasRunAutogear and lastRunConfigs props"
```

---

## Task 10: Update AutogearPage to Track State

**Files:**
- Modify: `src/pages/manager/AutogearPage.tsx`

**Step 1: Add state tracking and pass to AutogearQuickSettings**

Find line ~129 (after `const [milestoneCount, setMilestoneCount] = useState...`):

```typescript
const [hasRunAutogear, setHasRunAutogear] = useState(false);
const [lastRunConfigs, setLastRunConfigs] = useState<Record<string, SavedAutogearConfig>>({});
```

**Step 2: Update handleAutogear to set state**

Find the end of `handleAutogear` function (around line 530, after the milestone check). Add before the closing brace:

```typescript
// Mark that autogear has been run and store configs
setHasRunAutogear(true);
const configsMap: Record<string, SavedAutogearConfig> = {};
validShips.forEach((ship) => {
  const config = getShipConfig(ship.id);
  configsMap[ship.id] = {
    shipId: ship.id,
    shipRole: config.shipRole,
    statPriorities: config.statPriorities,
    setPriorities: config.setPriorities,
    statBonuses: config.statBonuses,
    ignoreEquipped: config.ignoreEquipped,
    ignoreUnleveled: config.ignoreUnleveled,
    useUpgradedStats: config.useUpgradedStats,
    tryToCompleteSets: config.tryToCompleteSets,
    algorithm: config.selectedAlgorithm,
    optimizeImplants: config.optimizeImplants,
    includeCalibratedGear: config.includeCalibratedGear,
  };
});
setLastRunConfigs(configsMap);
```

**Step 3: Update AutogearQuickSettings usage**

Find the `<AutogearQuickSettings` component (around line 696) and add the new props:

```typescript
<AutogearQuickSettings
  selectedShips={selectedShips}
  onShipSelect={handleShipSelect}
  onAddShip={handleAddShip}
  onRemoveShip={handleRemoveShip}
  onOpenSettings={(event: React.MouseEvent<HTMLButtonElement>, index: number) => {
    event.stopPropagation();
    setShipSettings(selectedShips[index]);
    setShowSettingsModal(true);
  }}
  onFindOptimalGear={handleAutogear}
  getShipConfig={getShipConfig}
  hasRunAutogear={hasRunAutogear}
  lastRunConfigs={lastRunConfigs}
/>
```

**Step 4: Add import for SavedAutogearConfig if not already imported**

The import should already exist, but verify at the top:

```typescript
import { GearSuggestion, StatPriority, SetPriority, StatBonus, SavedAutogearConfig } from '../../types/autogear';
```

**Step 5: Commit**

```bash
git add src/pages/manager/AutogearPage.tsx
git commit -m "feat: track autogear run state for community sharing

- Add hasRunAutogear and lastRunConfigs state
- Pass state to AutogearQuickSettings"
```

---

## Task 11: Delete Old Files

**Files:**
- Delete: `src/services/aiRecommendations.ts`
- Delete: `src/hooks/useLLMRecommendations.ts`
- Delete: `src/components/autogear/LLMSuggestions.tsx`

**Step 1: Delete the old files**

```bash
rm src/services/aiRecommendations.ts
rm src/hooks/useLLMRecommendations.ts
rm src/components/autogear/LLMSuggestions.tsx
```

**Step 2: Update AlternativeRecommendations to use new types**

The `AlternativeRecommendations` component currently imports from `aiRecommendations`. Update `src/components/autogear/AlternativeRecommendations.tsx`:

Replace the import:
```typescript
// Old
import { AIRecommendation } from '../../services/aiRecommendations';

// New
import { CommunityRecommendation } from '../../types/communityRecommendation';
```

And update the interface to use `CommunityRecommendation` instead of `AIRecommendation` (the structure is compatible, add `ship_implants` as a workaround in the parent component as shown in Task 8).

**Step 3: Commit**

```bash
git add -A
git commit -m "chore: remove deprecated AI recommendation files

- Delete aiRecommendations.ts service
- Delete useLLMRecommendations hook
- Delete LLMSuggestions component
- Update AlternativeRecommendations imports"
```

---

## Task 12: Update Documentation

**Files:**
- Modify: `src/pages/DocumentationPage.tsx`

**Step 1: Find the autogear documentation section and update**

Search for "AI Recommendation" or "LLM" in the documentation and update to describe the new community system:

```typescript
// Find and replace AI recommendation docs with:
{
  title: 'Community Recommendations',
  content: `
    The community recommendations system allows players to share their autogear configurations with others.

    **Viewing Recommendations:**
    - When you select a ship, you'll see the highest-voted community recommendation
    - Click to expand and see the full configuration details
    - View alternative recommendations from other players

    **Sharing Your Build:**
    1. Configure your autogear settings (stat priorities, set bonuses, etc.)
    2. Click "Find Optimal Gear" to run the optimization
    3. Click "Share to Community" to open the share form
    4. Add a descriptive title (e.g., "High Crit DPS Build")
    5. Optionally add a description explaining your strategy
    6. Check "Only show to users with same ultimate implant" if your build is implant-specific
    7. Click "Share" to publish

    **Voting:**
    - Click "Helpful" or "Not Helpful" to vote on recommendations
    - Your votes help surface the best builds for each ship
    - Sign in required to vote or share
  `
}
```

**Step 2: Commit**

```bash
git add src/pages/DocumentationPage.tsx
git commit -m "docs: update documentation for community recommendations"
```

---

## Task 13: Final Testing & Verification

**Step 1: Run linter**

```bash
npm run lint
```

Fix any linting errors.

**Step 2: Run tests**

```bash
npm test
```

Fix any failing tests (some tests may reference old AI recommendation code).

**Step 3: Manual testing checklist**

- [ ] Select a ship - community recommendations load (or empty state shows)
- [ ] Expand accordion - shows recommendation details
- [ ] Run autogear - "Share to Community" button appears
- [ ] Click share - form expands with title, description, checkbox
- [ ] Submit share (logged in) - recommendation is saved
- [ ] Vote on recommendation (logged in) - vote is recorded
- [ ] View alternatives - list shows and can select
- [ ] Empty state - shows "No recommendations yet" message

**Step 4: Final commit**

```bash
git add -A
git commit -m "test: verify community recommendations system works"
```

---

## Summary

This implementation plan covers:

1. **Database migration** - Rename tables, add columns, create new RPC function
2. **Types** - New `CommunityRecommendation` interface
3. **Service** - `CommunityRecommendationService` with simplified matching logic
4. **Hook** - `useCommunityRecommendations` with share functionality
5. **UI Components** - Updated header, actions, new share form, main container
6. **Integration** - AutogearPage tracks run state, passes to components
7. **Cleanup** - Remove old AI-related files
8. **Documentation** - Update in-app docs

Total: ~13 tasks, each broken into small steps.
