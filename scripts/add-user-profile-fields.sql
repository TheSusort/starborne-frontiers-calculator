-- Add user profile fields to users table
-- Run this in the Supabase SQL Editor

-- Add new columns to users table
ALTER TABLE users
ADD COLUMN IF NOT EXISTS username TEXT UNIQUE,
ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS in_game_id TEXT;

-- Create index on username for faster lookups
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username) WHERE username IS NOT NULL;

-- Add constraint to ensure username is alphanumeric only (no spaces or special characters)
-- Username must be 3-20 characters, alphanumeric only
ALTER TABLE users
ADD CONSTRAINT username_format CHECK (
    username IS NULL OR (
        LENGTH(username) >= 3 AND
        LENGTH(username) <= 20 AND
        username ~ '^[a-zA-Z0-9]+$'
    )
);

-- Add comment for documentation
COMMENT ON COLUMN users.username IS 'Unique username for display in leaderboards (alphanumeric only, 3-20 chars)';
COMMENT ON COLUMN users.is_public IS 'Whether user appears in public leaderboards';
COMMENT ON COLUMN users.in_game_id IS 'In-game ID for friend requests and duels';

-- ROLLBACK (if needed):
-- ALTER TABLE users DROP CONSTRAINT IF EXISTS username_format;
-- DROP INDEX IF EXISTS idx_users_username;
-- ALTER TABLE users DROP COLUMN IF EXISTS username;
-- ALTER TABLE users DROP COLUMN IF EXISTS is_public;
-- ALTER TABLE users DROP COLUMN IF EXISTS in_game_id;

