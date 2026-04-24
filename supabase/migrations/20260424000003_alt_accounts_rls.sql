-- ============================================================
-- Alt accounts: RLS rewrite
-- ============================================================
-- Defines has_profile_access(target_user_id) and rewrites every
-- user-owned table policy that previously used auth.uid() = user_id
-- (or auth.uid() = created_by) to call this helper instead.
--
-- Tables intentionally NOT touched here:
--   • encounter_votes               — one-vote-per-human; stays on auth.uid() = user_id
--   • community_recommendation_votes — same reason
--   • ship_template_proposals       — proposed_by_user_id is an audit field (text cast),
--                                     not a profile-scoped ownership column
--   • admin / is_admin() branches   — unchanged
--   • is_public = true branches     — unchanged; preserved verbatim below
--   • anon policies                 — unchanged (managed in separate migrations)
-- ============================================================


-- ============================================================
-- 1. Helper function
-- ============================================================

CREATE OR REPLACE FUNCTION public.has_profile_access(target_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = target_user_id
      AND (id = auth.uid() OR owner_auth_user_id = auth.uid())
  );
$$;

GRANT EXECUTE ON FUNCTION public.has_profile_access(uuid) TO authenticated;


-- ============================================================
-- 2. public.users — rewrite all four policies
-- ============================================================
-- SELECT: owner can see own row + owned alts + public profiles.
-- UPDATE: owner can update own row and owned alts.
-- INSERT: new policy allowing alt creation only.
-- DELETE: new policy allowing deletion of owned alts only.
--         (Main-account deletion is handled by delete_user() SECURITY DEFINER.)
-- The "Admins can view all users" policy is unchanged.

DROP POLICY IF EXISTS "Users can view own or public profiles" ON public.users;
CREATE POLICY "Users can view own, owned alts, or public profiles" ON public.users
  FOR SELECT TO authenticated
  USING (
    auth.uid() = id
    OR owner_auth_user_id = auth.uid()
    OR is_public = true
  );

DROP POLICY IF EXISTS "Users can update own profile" ON public.users;
CREATE POLICY "Users can update own profile or owned alts" ON public.users
  FOR UPDATE TO authenticated
  USING (auth.uid() = id OR owner_auth_user_id = auth.uid())
  WITH CHECK (auth.uid() = id OR owner_auth_user_id = auth.uid());

DROP POLICY IF EXISTS "Users can insert alt profiles they own" ON public.users;
CREATE POLICY "Users can insert alt profiles they own" ON public.users
  FOR INSERT TO authenticated
  WITH CHECK (
    owner_auth_user_id = auth.uid()
    AND id != auth.uid()
    AND is_admin = false
  );

DROP POLICY IF EXISTS "Users can delete owned alts" ON public.users;
CREATE POLICY "Users can delete owned alts" ON public.users
  FOR DELETE TO authenticated
  USING (owner_auth_user_id = auth.uid());


-- ============================================================
-- 3. Direct user_id tables (from 20260221000002)
-- ============================================================

-- ---- ships ----
DROP POLICY IF EXISTS "Users can view own ships" ON public.ships;
CREATE POLICY "Users can view own ships" ON public.ships
  FOR SELECT TO authenticated
  USING (public.has_profile_access(user_id));

DROP POLICY IF EXISTS "Users can insert own ships" ON public.ships;
CREATE POLICY "Users can insert own ships" ON public.ships
  FOR INSERT TO authenticated
  WITH CHECK (public.has_profile_access(user_id));

DROP POLICY IF EXISTS "Users can update own ships" ON public.ships;
CREATE POLICY "Users can update own ships" ON public.ships
  FOR UPDATE TO authenticated
  USING (public.has_profile_access(user_id))
  WITH CHECK (public.has_profile_access(user_id));

DROP POLICY IF EXISTS "Users can delete own ships" ON public.ships;
CREATE POLICY "Users can delete own ships" ON public.ships
  FOR DELETE TO authenticated
  USING (public.has_profile_access(user_id));

-- ---- inventory_items ----
DROP POLICY IF EXISTS "Users can view own inventory" ON public.inventory_items;
CREATE POLICY "Users can view own inventory" ON public.inventory_items
  FOR SELECT TO authenticated
  USING (public.has_profile_access(user_id));

DROP POLICY IF EXISTS "Users can insert own inventory" ON public.inventory_items;
CREATE POLICY "Users can insert own inventory" ON public.inventory_items
  FOR INSERT TO authenticated
  WITH CHECK (public.has_profile_access(user_id));

DROP POLICY IF EXISTS "Users can update own inventory" ON public.inventory_items;
CREATE POLICY "Users can update own inventory" ON public.inventory_items
  FOR UPDATE TO authenticated
  USING (public.has_profile_access(user_id))
  WITH CHECK (public.has_profile_access(user_id));

DROP POLICY IF EXISTS "Users can delete own inventory" ON public.inventory_items;
CREATE POLICY "Users can delete own inventory" ON public.inventory_items
  FOR DELETE TO authenticated
  USING (public.has_profile_access(user_id));

-- ---- engineering_stats ----
DROP POLICY IF EXISTS "Users can view own engineering stats" ON public.engineering_stats;
CREATE POLICY "Users can view own engineering stats" ON public.engineering_stats
  FOR SELECT TO authenticated
  USING (public.has_profile_access(user_id));

DROP POLICY IF EXISTS "Users can insert own engineering stats" ON public.engineering_stats;
CREATE POLICY "Users can insert own engineering stats" ON public.engineering_stats
  FOR INSERT TO authenticated
  WITH CHECK (public.has_profile_access(user_id));

DROP POLICY IF EXISTS "Users can update own engineering stats" ON public.engineering_stats;
CREATE POLICY "Users can update own engineering stats" ON public.engineering_stats
  FOR UPDATE TO authenticated
  USING (public.has_profile_access(user_id))
  WITH CHECK (public.has_profile_access(user_id));

DROP POLICY IF EXISTS "Users can delete own engineering stats" ON public.engineering_stats;
CREATE POLICY "Users can delete own engineering stats" ON public.engineering_stats
  FOR DELETE TO authenticated
  USING (public.has_profile_access(user_id));

-- ---- autogear_configs ----
DROP POLICY IF EXISTS "Users can view own autogear configs" ON public.autogear_configs;
CREATE POLICY "Users can view own autogear configs" ON public.autogear_configs
  FOR SELECT TO authenticated
  USING (public.has_profile_access(user_id));

DROP POLICY IF EXISTS "Users can insert own autogear configs" ON public.autogear_configs;
CREATE POLICY "Users can insert own autogear configs" ON public.autogear_configs
  FOR INSERT TO authenticated
  WITH CHECK (public.has_profile_access(user_id));

DROP POLICY IF EXISTS "Users can update own autogear configs" ON public.autogear_configs;
CREATE POLICY "Users can update own autogear configs" ON public.autogear_configs
  FOR UPDATE TO authenticated
  USING (public.has_profile_access(user_id))
  WITH CHECK (public.has_profile_access(user_id));

DROP POLICY IF EXISTS "Users can delete own autogear configs" ON public.autogear_configs;
CREATE POLICY "Users can delete own autogear configs" ON public.autogear_configs
  FOR DELETE TO authenticated
  USING (public.has_profile_access(user_id));

-- ---- loadouts ----
DROP POLICY IF EXISTS "Users can view own loadouts" ON public.loadouts;
CREATE POLICY "Users can view own loadouts" ON public.loadouts
  FOR SELECT TO authenticated
  USING (public.has_profile_access(user_id));

DROP POLICY IF EXISTS "Users can insert own loadouts" ON public.loadouts;
CREATE POLICY "Users can insert own loadouts" ON public.loadouts
  FOR INSERT TO authenticated
  WITH CHECK (public.has_profile_access(user_id));

DROP POLICY IF EXISTS "Users can update own loadouts" ON public.loadouts;
CREATE POLICY "Users can update own loadouts" ON public.loadouts
  FOR UPDATE TO authenticated
  USING (public.has_profile_access(user_id))
  WITH CHECK (public.has_profile_access(user_id));

DROP POLICY IF EXISTS "Users can delete own loadouts" ON public.loadouts;
CREATE POLICY "Users can delete own loadouts" ON public.loadouts
  FOR DELETE TO authenticated
  USING (public.has_profile_access(user_id));

-- ---- team_loadouts ----
DROP POLICY IF EXISTS "Users can view own team loadouts" ON public.team_loadouts;
CREATE POLICY "Users can view own team loadouts" ON public.team_loadouts
  FOR SELECT TO authenticated
  USING (public.has_profile_access(user_id));

DROP POLICY IF EXISTS "Users can insert own team loadouts" ON public.team_loadouts;
CREATE POLICY "Users can insert own team loadouts" ON public.team_loadouts
  FOR INSERT TO authenticated
  WITH CHECK (public.has_profile_access(user_id));

DROP POLICY IF EXISTS "Users can update own team loadouts" ON public.team_loadouts;
CREATE POLICY "Users can update own team loadouts" ON public.team_loadouts
  FOR UPDATE TO authenticated
  USING (public.has_profile_access(user_id))
  WITH CHECK (public.has_profile_access(user_id));

DROP POLICY IF EXISTS "Users can delete own team loadouts" ON public.team_loadouts;
CREATE POLICY "Users can delete own team loadouts" ON public.team_loadouts
  FOR DELETE TO authenticated
  USING (public.has_profile_access(user_id));

-- ---- user_activity_log ----
-- No DELETE policy: activity logs are append-only (unchanged).
DROP POLICY IF EXISTS "Users can view own activity" ON public.user_activity_log;
CREATE POLICY "Users can view own activity" ON public.user_activity_log
  FOR SELECT TO authenticated
  USING (public.has_profile_access(user_id));

DROP POLICY IF EXISTS "Users can insert own activity" ON public.user_activity_log;
CREATE POLICY "Users can insert own activity" ON public.user_activity_log
  FOR INSERT TO authenticated
  WITH CHECK (public.has_profile_access(user_id));

DROP POLICY IF EXISTS "Users can update own activity" ON public.user_activity_log;
CREATE POLICY "Users can update own activity" ON public.user_activity_log
  FOR UPDATE TO authenticated
  USING (public.has_profile_access(user_id))
  WITH CHECK (public.has_profile_access(user_id));

-- ---- encounter_notes ----
-- SELECT preserves the is_public = true branch for the shared-encounters feature.
DROP POLICY IF EXISTS "Users can view own or public encounter notes" ON public.encounter_notes;
CREATE POLICY "Users can view own or public encounter notes" ON public.encounter_notes
  FOR SELECT TO authenticated
  USING (public.has_profile_access(user_id) OR is_public = true);

DROP POLICY IF EXISTS "Users can insert own encounter notes" ON public.encounter_notes;
CREATE POLICY "Users can insert own encounter notes" ON public.encounter_notes
  FOR INSERT TO authenticated
  WITH CHECK (public.has_profile_access(user_id));

DROP POLICY IF EXISTS "Users can update own encounter notes" ON public.encounter_notes;
CREATE POLICY "Users can update own encounter notes" ON public.encounter_notes
  FOR UPDATE TO authenticated
  USING (public.has_profile_access(user_id))
  WITH CHECK (public.has_profile_access(user_id));

DROP POLICY IF EXISTS "Users can delete own encounter notes" ON public.encounter_notes;
CREATE POLICY "Users can delete own encounter notes" ON public.encounter_notes
  FOR DELETE TO authenticated
  USING (public.has_profile_access(user_id));

-- ---- statistics_snapshots (from 20260326000001) ----
DROP POLICY IF EXISTS "Users can read own snapshots" ON public.statistics_snapshots;
CREATE POLICY "Users can read own snapshots" ON public.statistics_snapshots
  FOR SELECT TO authenticated
  USING (public.has_profile_access(user_id));

DROP POLICY IF EXISTS "Users can insert own snapshots" ON public.statistics_snapshots;
CREATE POLICY "Users can insert own snapshots" ON public.statistics_snapshots
  FOR INSERT TO authenticated
  WITH CHECK (public.has_profile_access(user_id));


-- ============================================================
-- 4. community_recommendations — uses created_by (not user_id)
--    (from 20260221000004)
-- ============================================================
-- SELECT policy ("Anyone can view community recommendations") is public — unchanged.
-- Votes table (community_recommendation_votes) is intentionally excluded:
--   one-vote-per-human — each profile voting would inflate vote counts.

DROP POLICY IF EXISTS "Authenticated users can create community recommendations" ON public.community_recommendations;
CREATE POLICY "Authenticated users can create community recommendations" ON public.community_recommendations
  FOR INSERT TO authenticated
  WITH CHECK (public.has_profile_access(created_by));

DROP POLICY IF EXISTS "Users can update own community recommendations" ON public.community_recommendations;
CREATE POLICY "Users can update own community recommendations" ON public.community_recommendations
  FOR UPDATE TO authenticated
  USING (public.has_profile_access(created_by))
  WITH CHECK (public.has_profile_access(created_by));

DROP POLICY IF EXISTS "Users can delete own community recommendations" ON public.community_recommendations;
CREATE POLICY "Users can delete own community recommendations" ON public.community_recommendations
  FOR DELETE TO authenticated
  USING (public.has_profile_access(created_by));


-- ============================================================
-- 5. Child tables (from 20260221000003) — subquery-based policies
-- ============================================================
-- Pattern: parent.user_id = auth.uid() → public.has_profile_access(parent.user_id)

-- ---- ship_base_stats (child of ships) ----
DROP POLICY IF EXISTS "Users can view own ship base stats" ON public.ship_base_stats;
CREATE POLICY "Users can view own ship base stats" ON public.ship_base_stats
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.ships
    WHERE ships.id = ship_base_stats.ship_id
      AND public.has_profile_access(ships.user_id)
  ));

DROP POLICY IF EXISTS "Users can insert own ship base stats" ON public.ship_base_stats;
CREATE POLICY "Users can insert own ship base stats" ON public.ship_base_stats
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.ships
    WHERE ships.id = ship_base_stats.ship_id
      AND public.has_profile_access(ships.user_id)
  ));

DROP POLICY IF EXISTS "Users can update own ship base stats" ON public.ship_base_stats;
CREATE POLICY "Users can update own ship base stats" ON public.ship_base_stats
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.ships
    WHERE ships.id = ship_base_stats.ship_id
      AND public.has_profile_access(ships.user_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.ships
    WHERE ships.id = ship_base_stats.ship_id
      AND public.has_profile_access(ships.user_id)
  ));

DROP POLICY IF EXISTS "Users can delete own ship base stats" ON public.ship_base_stats;
CREATE POLICY "Users can delete own ship base stats" ON public.ship_base_stats
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.ships
    WHERE ships.id = ship_base_stats.ship_id
      AND public.has_profile_access(ships.user_id)
  ));

-- ---- ship_equipment (child of ships) ----
DROP POLICY IF EXISTS "Users can view own ship equipment" ON public.ship_equipment;
CREATE POLICY "Users can view own ship equipment" ON public.ship_equipment
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.ships
    WHERE ships.id = ship_equipment.ship_id
      AND public.has_profile_access(ships.user_id)
  ));

DROP POLICY IF EXISTS "Users can insert own ship equipment" ON public.ship_equipment;
CREATE POLICY "Users can insert own ship equipment" ON public.ship_equipment
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.ships
    WHERE ships.id = ship_equipment.ship_id
      AND public.has_profile_access(ships.user_id)
  ));

DROP POLICY IF EXISTS "Users can update own ship equipment" ON public.ship_equipment;
CREATE POLICY "Users can update own ship equipment" ON public.ship_equipment
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.ships
    WHERE ships.id = ship_equipment.ship_id
      AND public.has_profile_access(ships.user_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.ships
    WHERE ships.id = ship_equipment.ship_id
      AND public.has_profile_access(ships.user_id)
  ));

DROP POLICY IF EXISTS "Users can delete own ship equipment" ON public.ship_equipment;
CREATE POLICY "Users can delete own ship equipment" ON public.ship_equipment
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.ships
    WHERE ships.id = ship_equipment.ship_id
      AND public.has_profile_access(ships.user_id)
  ));

-- ---- ship_implants (child of ships via ship_id) ----
DROP POLICY IF EXISTS "Users can view own ship implants" ON public.ship_implants;
CREATE POLICY "Users can view own ship implants" ON public.ship_implants
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.ships
    WHERE ships.id = ship_implants.ship_id
      AND public.has_profile_access(ships.user_id)
  ));

DROP POLICY IF EXISTS "Users can insert own ship implants" ON public.ship_implants;
CREATE POLICY "Users can insert own ship implants" ON public.ship_implants
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.ships
    WHERE ships.id = ship_implants.ship_id
      AND public.has_profile_access(ships.user_id)
  ));

DROP POLICY IF EXISTS "Users can update own ship implants" ON public.ship_implants;
CREATE POLICY "Users can update own ship implants" ON public.ship_implants
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.ships
    WHERE ships.id = ship_implants.ship_id
      AND public.has_profile_access(ships.user_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.ships
    WHERE ships.id = ship_implants.ship_id
      AND public.has_profile_access(ships.user_id)
  ));

DROP POLICY IF EXISTS "Users can delete own ship implants" ON public.ship_implants;
CREATE POLICY "Users can delete own ship implants" ON public.ship_implants
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.ships
    WHERE ships.id = ship_implants.ship_id
      AND public.has_profile_access(ships.user_id)
  ));

-- ---- ship_implant_stats (grandchild: ship_implants -> ships) ----
DROP POLICY IF EXISTS "Users can view own ship implant stats" ON public.ship_implant_stats;
CREATE POLICY "Users can view own ship implant stats" ON public.ship_implant_stats
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.ship_implants si
    JOIN public.ships s ON s.id = si.ship_id
    WHERE si.id = ship_implant_stats.implant_id
      AND public.has_profile_access(s.user_id)
  ));

DROP POLICY IF EXISTS "Users can insert own ship implant stats" ON public.ship_implant_stats;
CREATE POLICY "Users can insert own ship implant stats" ON public.ship_implant_stats
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.ship_implants si
    JOIN public.ships s ON s.id = si.ship_id
    WHERE si.id = ship_implant_stats.implant_id
      AND public.has_profile_access(s.user_id)
  ));

DROP POLICY IF EXISTS "Users can update own ship implant stats" ON public.ship_implant_stats;
CREATE POLICY "Users can update own ship implant stats" ON public.ship_implant_stats
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.ship_implants si
    JOIN public.ships s ON s.id = si.ship_id
    WHERE si.id = ship_implant_stats.implant_id
      AND public.has_profile_access(s.user_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.ship_implants si
    JOIN public.ships s ON s.id = si.ship_id
    WHERE si.id = ship_implant_stats.implant_id
      AND public.has_profile_access(s.user_id)
  ));

DROP POLICY IF EXISTS "Users can delete own ship implant stats" ON public.ship_implant_stats;
CREATE POLICY "Users can delete own ship implant stats" ON public.ship_implant_stats
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.ship_implants si
    JOIN public.ships s ON s.id = si.ship_id
    WHERE si.id = ship_implant_stats.implant_id
      AND public.has_profile_access(s.user_id)
  ));

-- ---- ship_refits (child of ships) ----
DROP POLICY IF EXISTS "Users can view own ship refits" ON public.ship_refits;
CREATE POLICY "Users can view own ship refits" ON public.ship_refits
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.ships
    WHERE ships.id = ship_refits.ship_id
      AND public.has_profile_access(ships.user_id)
  ));

DROP POLICY IF EXISTS "Users can insert own ship refits" ON public.ship_refits;
CREATE POLICY "Users can insert own ship refits" ON public.ship_refits
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.ships
    WHERE ships.id = ship_refits.ship_id
      AND public.has_profile_access(ships.user_id)
  ));

DROP POLICY IF EXISTS "Users can update own ship refits" ON public.ship_refits;
CREATE POLICY "Users can update own ship refits" ON public.ship_refits
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.ships
    WHERE ships.id = ship_refits.ship_id
      AND public.has_profile_access(ships.user_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.ships
    WHERE ships.id = ship_refits.ship_id
      AND public.has_profile_access(ships.user_id)
  ));

DROP POLICY IF EXISTS "Users can delete own ship refits" ON public.ship_refits;
CREATE POLICY "Users can delete own ship refits" ON public.ship_refits
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.ships
    WHERE ships.id = ship_refits.ship_id
      AND public.has_profile_access(ships.user_id)
  ));

-- ---- ship_refit_stats (grandchild: ship_refits -> ships) ----
DROP POLICY IF EXISTS "Users can view own ship refit stats" ON public.ship_refit_stats;
CREATE POLICY "Users can view own ship refit stats" ON public.ship_refit_stats
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.ship_refits sr
    JOIN public.ships s ON s.id = sr.ship_id
    WHERE sr.id = ship_refit_stats.refit_id
      AND public.has_profile_access(s.user_id)
  ));

DROP POLICY IF EXISTS "Users can insert own ship refit stats" ON public.ship_refit_stats;
CREATE POLICY "Users can insert own ship refit stats" ON public.ship_refit_stats
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.ship_refits sr
    JOIN public.ships s ON s.id = sr.ship_id
    WHERE sr.id = ship_refit_stats.refit_id
      AND public.has_profile_access(s.user_id)
  ));

DROP POLICY IF EXISTS "Users can update own ship refit stats" ON public.ship_refit_stats;
CREATE POLICY "Users can update own ship refit stats" ON public.ship_refit_stats
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.ship_refits sr
    JOIN public.ships s ON s.id = sr.ship_id
    WHERE sr.id = ship_refit_stats.refit_id
      AND public.has_profile_access(s.user_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.ship_refits sr
    JOIN public.ships s ON s.id = sr.ship_id
    WHERE sr.id = ship_refit_stats.refit_id
      AND public.has_profile_access(s.user_id)
  ));

DROP POLICY IF EXISTS "Users can delete own ship refit stats" ON public.ship_refit_stats;
CREATE POLICY "Users can delete own ship refit stats" ON public.ship_refit_stats
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.ship_refits sr
    JOIN public.ships s ON s.id = sr.ship_id
    WHERE sr.id = ship_refit_stats.refit_id
      AND public.has_profile_access(s.user_id)
  ));

-- ---- loadout_equipment (child of loadouts) ----
DROP POLICY IF EXISTS "Users can view own loadout equipment" ON public.loadout_equipment;
CREATE POLICY "Users can view own loadout equipment" ON public.loadout_equipment
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.loadouts
    WHERE loadouts.id = loadout_equipment.loadout_id
      AND public.has_profile_access(loadouts.user_id)
  ));

DROP POLICY IF EXISTS "Users can insert own loadout equipment" ON public.loadout_equipment;
CREATE POLICY "Users can insert own loadout equipment" ON public.loadout_equipment
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.loadouts
    WHERE loadouts.id = loadout_equipment.loadout_id
      AND public.has_profile_access(loadouts.user_id)
  ));

DROP POLICY IF EXISTS "Users can update own loadout equipment" ON public.loadout_equipment;
CREATE POLICY "Users can update own loadout equipment" ON public.loadout_equipment
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.loadouts
    WHERE loadouts.id = loadout_equipment.loadout_id
      AND public.has_profile_access(loadouts.user_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.loadouts
    WHERE loadouts.id = loadout_equipment.loadout_id
      AND public.has_profile_access(loadouts.user_id)
  ));

DROP POLICY IF EXISTS "Users can delete own loadout equipment" ON public.loadout_equipment;
CREATE POLICY "Users can delete own loadout equipment" ON public.loadout_equipment
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.loadouts
    WHERE loadouts.id = loadout_equipment.loadout_id
      AND public.has_profile_access(loadouts.user_id)
  ));

-- ---- team_loadout_ships (child of team_loadouts) ----
DROP POLICY IF EXISTS "Users can view own team loadout ships" ON public.team_loadout_ships;
CREATE POLICY "Users can view own team loadout ships" ON public.team_loadout_ships
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.team_loadouts
    WHERE team_loadouts.id = team_loadout_ships.team_loadout_id
      AND public.has_profile_access(team_loadouts.user_id)
  ));

DROP POLICY IF EXISTS "Users can insert own team loadout ships" ON public.team_loadout_ships;
CREATE POLICY "Users can insert own team loadout ships" ON public.team_loadout_ships
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.team_loadouts
    WHERE team_loadouts.id = team_loadout_ships.team_loadout_id
      AND public.has_profile_access(team_loadouts.user_id)
  ));

DROP POLICY IF EXISTS "Users can update own team loadout ships" ON public.team_loadout_ships;
CREATE POLICY "Users can update own team loadout ships" ON public.team_loadout_ships
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.team_loadouts
    WHERE team_loadouts.id = team_loadout_ships.team_loadout_id
      AND public.has_profile_access(team_loadouts.user_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.team_loadouts
    WHERE team_loadouts.id = team_loadout_ships.team_loadout_id
      AND public.has_profile_access(team_loadouts.user_id)
  ));

DROP POLICY IF EXISTS "Users can delete own team loadout ships" ON public.team_loadout_ships;
CREATE POLICY "Users can delete own team loadout ships" ON public.team_loadout_ships
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.team_loadouts
    WHERE team_loadouts.id = team_loadout_ships.team_loadout_id
      AND public.has_profile_access(team_loadouts.user_id)
  ));

-- ---- team_loadout_equipment (child of team_loadouts) ----
DROP POLICY IF EXISTS "Users can view own team loadout equipment" ON public.team_loadout_equipment;
CREATE POLICY "Users can view own team loadout equipment" ON public.team_loadout_equipment
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.team_loadouts
    WHERE team_loadouts.id = team_loadout_equipment.team_loadout_id
      AND public.has_profile_access(team_loadouts.user_id)
  ));

DROP POLICY IF EXISTS "Users can insert own team loadout equipment" ON public.team_loadout_equipment;
CREATE POLICY "Users can insert own team loadout equipment" ON public.team_loadout_equipment
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.team_loadouts
    WHERE team_loadouts.id = team_loadout_equipment.team_loadout_id
      AND public.has_profile_access(team_loadouts.user_id)
  ));

DROP POLICY IF EXISTS "Users can update own team loadout equipment" ON public.team_loadout_equipment;
CREATE POLICY "Users can update own team loadout equipment" ON public.team_loadout_equipment
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.team_loadouts
    WHERE team_loadouts.id = team_loadout_equipment.team_loadout_id
      AND public.has_profile_access(team_loadouts.user_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.team_loadouts
    WHERE team_loadouts.id = team_loadout_equipment.team_loadout_id
      AND public.has_profile_access(team_loadouts.user_id)
  ));

DROP POLICY IF EXISTS "Users can delete own team loadout equipment" ON public.team_loadout_equipment;
CREATE POLICY "Users can delete own team loadout equipment" ON public.team_loadout_equipment
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.team_loadouts
    WHERE team_loadouts.id = team_loadout_equipment.team_loadout_id
      AND public.has_profile_access(team_loadouts.user_id)
  ));

-- ---- encounter_formations (child of encounter_notes) ----
-- SELECT preserves the is_public = true branch; INSERT/UPDATE/DELETE use only profile access.
DROP POLICY IF EXISTS "Users can view own or public encounter formations" ON public.encounter_formations;
CREATE POLICY "Users can view own or public encounter formations" ON public.encounter_formations
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.encounter_notes
    WHERE encounter_notes.id = encounter_formations.note_id
      AND (public.has_profile_access(encounter_notes.user_id) OR encounter_notes.is_public = true)
  ));

DROP POLICY IF EXISTS "Users can insert own encounter formations" ON public.encounter_formations;
CREATE POLICY "Users can insert own encounter formations" ON public.encounter_formations
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.encounter_notes
    WHERE encounter_notes.id = encounter_formations.note_id
      AND public.has_profile_access(encounter_notes.user_id)
  ));

DROP POLICY IF EXISTS "Users can update own encounter formations" ON public.encounter_formations;
CREATE POLICY "Users can update own encounter formations" ON public.encounter_formations
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.encounter_notes
    WHERE encounter_notes.id = encounter_formations.note_id
      AND public.has_profile_access(encounter_notes.user_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.encounter_notes
    WHERE encounter_notes.id = encounter_formations.note_id
      AND public.has_profile_access(encounter_notes.user_id)
  ));

DROP POLICY IF EXISTS "Users can delete own encounter formations" ON public.encounter_formations;
CREATE POLICY "Users can delete own encounter formations" ON public.encounter_formations
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.encounter_notes
    WHERE encounter_notes.id = encounter_formations.note_id
      AND public.has_profile_access(encounter_notes.user_id)
  ));
