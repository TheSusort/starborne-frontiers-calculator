-- A shared encounter note's author name is the author profile's username, set by the database.
--
-- encounter_notes.user_name was written by the client (the Google display name), so public notes
-- showed players' real names and any author could publish under any name. The trigger overwrites
-- it on every write; a profile without a username shows as Anonymous in the client. Renaming a
-- profile updates the name on its notes.
--
-- Tripwire: src/__tests__/supabase/securityFollowups.test.ts.

BEGIN;

CREATE OR REPLACE FUNCTION public.set_encounter_note_author()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    NEW.user_name := (SELECT username FROM public.users WHERE id = NEW.user_id);
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.set_encounter_note_author() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS set_encounter_note_author_trigger ON public.encounter_notes;
CREATE TRIGGER set_encounter_note_author_trigger
    BEFORE INSERT OR UPDATE ON public.encounter_notes
    FOR EACH ROW EXECUTE FUNCTION public.set_encounter_note_author();

CREATE OR REPLACE FUNCTION public.sync_encounter_note_author()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public.encounter_notes
       SET user_name = NEW.username
     WHERE user_id = NEW.id
       AND user_name IS DISTINCT FROM NEW.username;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_encounter_note_author() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS sync_encounter_note_author_trigger ON public.users;
CREATE TRIGGER sync_encounter_note_author_trigger
    AFTER UPDATE OF username ON public.users
    FOR EACH ROW
    WHEN (NEW.username IS DISTINCT FROM OLD.username)
    EXECUTE FUNCTION public.sync_encounter_note_author();

-- Existing notes: replace stored display names with usernames.
UPDATE public.encounter_notes n
   SET user_name = u.username
  FROM public.users u
 WHERE u.id = n.user_id
   AND n.user_name IS DISTINCT FROM u.username;

UPDATE public.encounter_notes n
   SET user_name = NULL
 WHERE n.user_name IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = n.user_id);

COMMIT;
