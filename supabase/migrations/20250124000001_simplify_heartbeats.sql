-- Simplify heartbeats table - remove page_path column
ALTER TABLE public.heartbeats DROP COLUMN IF EXISTS page_path;

-- Drop the unused index
DROP INDEX IF EXISTS heartbeats_session_user_idx;
