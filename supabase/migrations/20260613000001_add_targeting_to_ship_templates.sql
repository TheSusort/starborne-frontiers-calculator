-- Add ship targeting/pattern data to ship_templates.
-- Verbatim game strings (parsed at runtime by src/utils/targetingParser.ts).
-- Charged columns are an OVERRIDE: empty means "charged targets the same as active".
ALTER TABLE public.ship_templates
  ADD COLUMN IF NOT EXISTS active_target   text,
  ADD COLUMN IF NOT EXISTS active_pattern  text,
  ADD COLUMN IF NOT EXISTS charged_target  text,
  ADD COLUMN IF NOT EXISTS charged_pattern text;
