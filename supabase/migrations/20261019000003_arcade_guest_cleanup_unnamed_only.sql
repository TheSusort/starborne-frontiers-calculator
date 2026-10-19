-- Arcade guest cleanup removes only guests that never claimed a name.
--
-- cleanup_arcade_guests() deletes anonymous auth users more than a day old with no
-- arcade_guest_names row. A named guest keeps its leaderboard entry indefinitely.
-- handle_auth_user_delete and the FK cascades remove the users, name and score rows.
-- Grants are unchanged: CREATE OR REPLACE keeps the existing ones (postgres, service_role).

CREATE OR REPLACE FUNCTION public.cleanup_arcade_guests()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  removed integer;
BEGIN
  DELETE FROM auth.users au
   WHERE au.is_anonymous
     AND au.created_at < now() - interval '1 day'
     AND NOT EXISTS (SELECT 1 FROM public.arcade_guest_names g WHERE g.user_id = au.id);
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$$;
