-- Allow spaces, dashes, and underscores in usernames
-- Previous constraint: '^[a-zA-Z0-9]+$'
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_username_check;
ALTER TABLE users ADD CONSTRAINT users_username_check
  CHECK (username IS NULL OR (length(username) >= 3 AND length(username) <= 20 AND username ~ '^[a-zA-Z0-9 _-]+$'));
