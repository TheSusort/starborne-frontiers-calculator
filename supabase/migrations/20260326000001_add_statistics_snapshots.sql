-- Statistics snapshots for monthly comparison
CREATE TABLE statistics_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  snapshot_month date NOT NULL,
  ships_stats jsonb,
  gear_stats jsonb,
  implants_stats jsonb,
  engineering_stats jsonb,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, snapshot_month)
);

CREATE INDEX idx_statistics_snapshots_user_id ON statistics_snapshots(user_id);

ALTER TABLE statistics_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own snapshots"
  ON statistics_snapshots FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own snapshots"
  ON statistics_snapshots FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Rollback: DROP TABLE statistics_snapshots;
