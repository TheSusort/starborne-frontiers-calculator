-- Migration: Rename ai_recommendations to community_recommendations
-- This migration transforms the AI-based recommendation system into a community-driven system

-- Step 1: Rename ai_recommendations table to community_recommendations
ALTER TABLE public.ai_recommendations RENAME TO community_recommendations;

-- Step 2: Add new columns for community recommendations
ALTER TABLE public.community_recommendations
  ADD COLUMN title TEXT,
  ADD COLUMN description TEXT,
  ADD COLUMN is_implant_specific BOOLEAN DEFAULT FALSE,
  ADD COLUMN ultimate_implant TEXT;

-- Step 3: Backfill title for existing records
UPDATE public.community_recommendations
SET title = ship_role || ' Build'
WHERE title IS NULL;

-- Step 4: Make title NOT NULL after backfill
ALTER TABLE public.community_recommendations
  ALTER COLUMN title SET NOT NULL;

-- Step 5: Drop the ship_implants column (no longer needed)
ALTER TABLE public.community_recommendations
  DROP COLUMN ship_implants;

-- Step 6: Rename ai_recommendation_votes table to community_recommendation_votes
ALTER TABLE public.ai_recommendation_votes RENAME TO community_recommendation_votes;

-- Step 7: Update foreign key constraint name
ALTER TABLE public.community_recommendation_votes
  RENAME CONSTRAINT ai_recommendation_votes_pkey TO community_recommendation_votes_pkey;

ALTER TABLE public.community_recommendation_votes
  RENAME CONSTRAINT ai_recommendation_votes_recommendation_id_fkey TO community_recommendation_votes_recommendation_id_fkey;

ALTER TABLE public.community_recommendation_votes
  RENAME CONSTRAINT ai_recommendation_votes_user_id_fkey TO community_recommendation_votes_user_id_fkey;

-- Step 8: Update primary key constraint name on community_recommendations
ALTER TABLE public.community_recommendations
  RENAME CONSTRAINT ai_recommendations_pkey TO community_recommendations_pkey;

ALTER TABLE public.community_recommendations
  RENAME CONSTRAINT ai_recommendations_created_by_fkey TO community_recommendations_created_by_fkey;

-- Step 9: Drop the old get_best_recommendation function if it exists
DROP FUNCTION IF EXISTS public.get_best_recommendation(text, integer, jsonb);

-- Step 10: Create new get_best_community_recommendation RPC function
CREATE OR REPLACE FUNCTION public.get_best_community_recommendation(
  p_ship_name TEXT,
  p_ultimate_implant TEXT DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  ship_name text,
  ship_refit_level integer,
  ship_role text,
  stat_priorities jsonb,
  stat_bonuses jsonb,
  set_priorities jsonb,
  reasoning text,
  title text,
  description text,
  is_implant_specific boolean,
  ultimate_implant text,
  upvotes integer,
  downvotes integer,
  total_votes integer,
  score numeric,
  created_by uuid,
  created_at timestamp with time zone,
  updated_at timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    cr.id,
    cr.ship_name,
    cr.ship_refit_level,
    cr.ship_role,
    cr.stat_priorities,
    cr.stat_bonuses,
    cr.set_priorities,
    cr.reasoning,
    cr.title,
    cr.description,
    cr.is_implant_specific,
    cr.ultimate_implant,
    cr.upvotes,
    cr.downvotes,
    cr.total_votes,
    cr.score,
    cr.created_by,
    cr.created_at,
    cr.updated_at
  FROM public.community_recommendations cr
  WHERE cr.ship_name = p_ship_name
    AND (
      cr.is_implant_specific = FALSE
      OR (cr.is_implant_specific = TRUE AND cr.ultimate_implant = p_ultimate_implant)
    )
  ORDER BY cr.score DESC NULLS LAST, cr.total_votes DESC NULLS LAST, cr.created_at DESC
  LIMIT 1;
END;
$$;

-- Step 11: Create index for efficient lookups
CREATE INDEX idx_community_recommendations_ship_implant
  ON public.community_recommendations (ship_name, is_implant_specific, ultimate_implant);
