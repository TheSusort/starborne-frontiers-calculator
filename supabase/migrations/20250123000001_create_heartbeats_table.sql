-- Create heartbeats table for live traffic tracking
CREATE TABLE public.heartbeats (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  session_id text NOT NULL,
  user_id uuid,
  created_at timestamptz DEFAULT now(),

  CONSTRAINT heartbeats_pkey PRIMARY KEY (id),
  CONSTRAINT heartbeats_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

-- Index for queries
CREATE INDEX heartbeats_created_at_idx ON public.heartbeats (created_at DESC);

-- Enable RLS
ALTER TABLE public.heartbeats ENABLE ROW LEVEL SECURITY;

-- Allow anyone to insert heartbeats (both anon and authenticated)
CREATE POLICY "Anyone can insert heartbeats"
  ON public.heartbeats
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- Only admins can read heartbeats
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
