-- ============================================================
-- Create arena_seasons and arena_season_rules tables
-- ============================================================
-- Arena seasons define active competitive seasons with optional rules
-- Rules specify faction/rarity/ship type restrictions and stat modifiers
-- ============================================================

-- ---- arena_seasons table ----
CREATE TABLE public.arena_seasons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  active boolean NOT NULL DEFAULT false,
  ends_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---- arena_season_rules table ----
CREATE TABLE public.arena_season_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id uuid NOT NULL REFERENCES public.arena_seasons(id) ON DELETE CASCADE,
  factions text[],
  rarities text[],
  ship_types text[],
  modifiers jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- Indexes
-- ============================================================

CREATE INDEX idx_arena_season_rules_season_id ON public.arena_season_rules(season_id);
CREATE INDEX idx_arena_seasons_active ON public.arena_seasons(active) WHERE active = true;

-- ============================================================
-- RLS Policies - arena_seasons
-- ============================================================

ALTER TABLE public.arena_seasons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read arena seasons" ON public.arena_seasons;
CREATE POLICY "Public read arena seasons" ON public.arena_seasons
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Admins insert arena seasons" ON public.arena_seasons;
CREATE POLICY "Admins insert arena seasons" ON public.arena_seasons
  FOR INSERT
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins update arena seasons" ON public.arena_seasons;
CREATE POLICY "Admins update arena seasons" ON public.arena_seasons
  FOR UPDATE
  USING (public.is_admin());

DROP POLICY IF EXISTS "Admins delete arena seasons" ON public.arena_seasons;
CREATE POLICY "Admins delete arena seasons" ON public.arena_seasons
  FOR DELETE
  USING (public.is_admin());

-- ============================================================
-- RLS Policies - arena_season_rules
-- ============================================================

ALTER TABLE public.arena_season_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read arena season rules" ON public.arena_season_rules;
CREATE POLICY "Public read arena season rules" ON public.arena_season_rules
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Admins insert arena season rules" ON public.arena_season_rules;
CREATE POLICY "Admins insert arena season rules" ON public.arena_season_rules
  FOR INSERT
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins update arena season rules" ON public.arena_season_rules;
CREATE POLICY "Admins update arena season rules" ON public.arena_season_rules
  FOR UPDATE
  USING (public.is_admin());

DROP POLICY IF EXISTS "Admins delete arena season rules" ON public.arena_season_rules;
CREATE POLICY "Admins delete arena season rules" ON public.arena_season_rules
  FOR DELETE
  USING (public.is_admin());

-- ============================================================
-- RPC Functions
-- ============================================================

CREATE OR REPLACE FUNCTION public.activate_arena_season(p_season_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Unauthorized: admin access required';
  END IF;
  UPDATE arena_seasons SET active = false, updated_at = now() WHERE active = true;
  UPDATE arena_seasons SET active = true, updated_at = now() WHERE id = p_season_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.deactivate_all_arena_seasons()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Unauthorized: admin access required';
  END IF;
  UPDATE arena_seasons SET active = false, updated_at = now() WHERE active = true;
END;
$$;

-- ============================================================
-- Triggers - Updated_at
-- ============================================================

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS update_arena_seasons_updated_at ON public.arena_seasons;
CREATE TRIGGER update_arena_seasons_updated_at
  BEFORE UPDATE ON public.arena_seasons
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
