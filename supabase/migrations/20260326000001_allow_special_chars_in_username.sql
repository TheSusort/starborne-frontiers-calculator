-- Allow spaces, dashes, and underscores in usernames
-- Previous constraints: 'users_username_check' (inline) and 'username_format' (named)
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_username_check;
ALTER TABLE users DROP CONSTRAINT IF EXISTS username_format;
ALTER TABLE users ADD CONSTRAINT users_username_check
  CHECK (username IS NULL OR (length(username) >= 3 AND length(username) <= 20 AND username ~ '^[a-zA-Z0-9 _-]+$'));
