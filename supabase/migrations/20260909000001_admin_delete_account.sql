-- Deleting one account and everything hanging off it, in one transaction.
--
-- No foreign key in this schema cascades, so the order below is the contract:
-- a child row is removed before the row it points at. A function is used rather
-- than a script issuing statements over PostgREST because PostgREST gives each
-- statement its own transaction, and a half-deleted account is worse than a
-- kept one.
--
-- Community-visible content is preserved with authorship nulled: a public
-- encounter note and a community recommendation outlive their author.
--
-- service_role only. This bypasses every RLS policy by construction.

CREATE OR REPLACE FUNCTION public.admin_delete_account(target_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_is_admin boolean;
  ship_ids uuid[];
  gear_ids uuid[];
  loadout_ids uuid[];
  team_loadout_ids uuid[];
  private_note_ids uuid[];
  removed jsonb := '{}'::jsonb;
  n integer;
BEGIN
  SELECT is_admin INTO target_is_admin FROM public.users WHERE id = target_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no public.users row for %', target_user_id;
  END IF;
  -- An admin is never deleted by this path; promotion is manual and rare, and a
  -- mistaken cohort must not be able to remove the person who would fix it.
  IF target_is_admin THEN
    RAISE EXCEPTION 'refusing to delete admin account %', target_user_id;
  END IF;

  SELECT coalesce(array_agg(id), '{}') INTO ship_ids
    FROM public.ships WHERE user_id = target_user_id;
  SELECT coalesce(array_agg(id), '{}') INTO gear_ids
    FROM public.inventory_items WHERE user_id = target_user_id;
  SELECT coalesce(array_agg(id), '{}') INTO loadout_ids
    FROM public.loadouts WHERE user_id = target_user_id;
  SELECT coalesce(array_agg(id), '{}') INTO team_loadout_ids
    FROM public.team_loadouts WHERE user_id = target_user_id;
  SELECT coalesce(array_agg(id), '{}') INTO private_note_ids
    FROM public.encounter_notes WHERE user_id = target_user_id AND coalesce(is_public, false) = false;

  -- Implants: keyed by the gear row AND the ship row, so both reachable sets go.
  DELETE FROM public.ship_implant_stats WHERE implant_id IN (
    SELECT id FROM public.ship_implants WHERE ship_id = ANY(ship_ids) OR id = ANY(gear_ids)
  );
  DELETE FROM public.ship_implants WHERE ship_id = ANY(ship_ids) OR id = ANY(gear_ids);

  DELETE FROM public.ship_refit_stats WHERE refit_id IN (
    SELECT id FROM public.ship_refits WHERE ship_id = ANY(ship_ids)
  );
  DELETE FROM public.ship_refits WHERE ship_id = ANY(ship_ids);
  DELETE FROM public.ship_base_stats WHERE ship_id = ANY(ship_ids);
  DELETE FROM public.ship_equipment WHERE ship_id = ANY(ship_ids) OR gear_id = ANY(gear_ids);

  DELETE FROM public.loadout_equipment
    WHERE loadout_id = ANY(loadout_ids) OR gear_id = ANY(gear_ids);
  DELETE FROM public.loadouts WHERE user_id = target_user_id OR ship_id = ANY(ship_ids);

  DELETE FROM public.team_loadout_equipment
    WHERE team_loadout_id = ANY(team_loadout_ids)
       OR gear_id = ANY(gear_ids)
       OR ship_id = ANY(ship_ids);
  DELETE FROM public.team_loadout_ships
    WHERE team_loadout_id = ANY(team_loadout_ids) OR ship_id = ANY(ship_ids);
  DELETE FROM public.team_loadouts WHERE user_id = target_user_id;

  -- A formation on somebody else's public note may point at a ship being
  -- deleted, so the null is applied by ship, not by note. ship_name survives,
  -- which is what the encounter page renders.
  UPDATE public.encounter_formations SET ship_id = NULL WHERE ship_id = ANY(ship_ids);
  DELETE FROM public.encounter_formations WHERE note_id = ANY(private_note_ids);
  DELETE FROM public.encounter_votes
    WHERE user_id = target_user_id OR encounter_id = ANY(private_note_ids);
  DELETE FROM public.encounter_notes WHERE id = ANY(private_note_ids);
  UPDATE public.encounter_notes SET user_id = NULL WHERE user_id = target_user_id;

  UPDATE public.inventory_items SET calibration_ship_id = NULL
    WHERE calibration_ship_id = ANY(ship_ids);
  DELETE FROM public.inventory_items WHERE user_id = target_user_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  removed := removed || jsonb_build_object('inventory_items', n);
  DELETE FROM public.ships WHERE user_id = target_user_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  removed := removed || jsonb_build_object('ships', n);

  DELETE FROM public.engineering_stats WHERE user_id = target_user_id;
  DELETE FROM public.gear_wishlists WHERE user_id = target_user_id;
  DELETE FROM public.autogear_teams WHERE user_id = target_user_id;
  DELETE FROM public.autogear_configs WHERE user_id = target_user_id;
  DELETE FROM public.statistics_snapshots WHERE user_id = target_user_id;
  DELETE FROM public.user_activity_log WHERE user_id = target_user_id;
  DELETE FROM public.heartbeats WHERE user_id = target_user_id;
  DELETE FROM public.community_recommendation_votes WHERE user_id = target_user_id;

  UPDATE public.community_recommendations SET created_by = NULL
    WHERE created_by = target_user_id;

  DELETE FROM public.users WHERE id = target_user_id;

  RETURN removed;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_account(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_delete_account(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.admin_delete_account(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_account(uuid) TO service_role;
