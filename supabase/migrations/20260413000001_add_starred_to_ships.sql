-- Add starred column to ships table for marking important ships
ALTER TABLE ships ADD COLUMN starred boolean DEFAULT false;

-- Rollback: ALTER TABLE ships DROP COLUMN starred;
