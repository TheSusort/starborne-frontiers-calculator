-- Add bio/diary text column to ship_templates
ALTER TABLE ship_templates ADD COLUMN IF NOT EXISTS bio TEXT;

-- Rollback: ALTER TABLE ship_templates DROP COLUMN bio;
