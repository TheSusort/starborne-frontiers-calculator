-- Add quote and quote_author columns to ship_templates
ALTER TABLE ship_templates ADD COLUMN IF NOT EXISTS quote TEXT;
ALTER TABLE ship_templates ADD COLUMN IF NOT EXISTS quote_author TEXT;

-- Rollback:
-- ALTER TABLE ship_templates DROP COLUMN quote;
-- ALTER TABLE ship_templates DROP COLUMN quote_author;
