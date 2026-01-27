-- Simplify heartbeats: one row per session per day
-- Drop existing table and recreate with new schema

DROP TABLE IF EXISTS public.heartbeats;

CREATE TABLE public.heartbeats (
  session_id text NOT NULL,
  user_id uuid,
  date date NOT NULL DEFAULT CURRENT_DATE,
  last_seen timestamptz DEFAULT now(),

  CONSTRAINT heartbeats_pkey PRIMARY KEY (session_id, date),
  CONSTRAINT heartbeats_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

-- Index for "active in last 60s" queries
CREATE INDEX heartbeats_last_seen_idx ON public.heartbeats (last_seen DESC);

-- Enable RLS
ALTER TABLE public.heartbeats ENABLE ROW LEVEL SECURITY;

-- Allow anyone to insert/update heartbeats
CREATE POLICY "Anyone can upsert heartbeats"
  ON public.heartbeats
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

-- Admins can read all heartbeats
CREATE POLICY "Admins can read heartbeats"
  ON public.heartbeats
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
      AND users.is_admin = true
    )
  );
