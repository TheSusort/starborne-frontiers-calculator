-- Add calibration_ship_id column to inventory_items table
-- Run this in the Supabase SQL Editor

-- Add calibration_ship_id column (nullable, references ships.id)
ALTER TABLE inventory_items
ADD COLUMN IF NOT EXISTS calibration_ship_id UUID REFERENCES ships(id) ON DELETE SET NULL;

-- Create index for faster lookups when filtering by calibration
CREATE INDEX IF NOT EXISTS idx_inventory_items_calibration_ship_id 
ON inventory_items(calibration_ship_id) 
WHERE calibration_ship_id IS NOT NULL;

-- Add comment for documentation
COMMENT ON COLUMN inventory_items.calibration_ship_id IS 'Ship ID this gear is calibrated to. Calibration bonus only applies when gear is equipped on this ship.';

-- ROLLBACK (if needed):
-- DROP INDEX IF EXISTS idx_inventory_items_calibration_ship_id;
-- ALTER TABLE inventory_items DROP COLUMN IF EXISTS calibration_ship_id;

