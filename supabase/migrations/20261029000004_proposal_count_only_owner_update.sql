-- A proposer may bump the count on their own pending proposal and change nothing else.
--
-- `submitTemplateProposal` re-submits an identical pending proposal by updating proposal_count and
-- updated_at. That needs an owner UPDATE policy, but RLS cannot restrict columns, so the policy
-- alone would also let a proposer set status or rewrite proposed_stats after review. The trigger
-- below rejects any client-role, non-admin UPDATE that changes a column other than those two.
-- Admins keep their own policy and pass the trigger; approve/reject run as the admin caller.
--
-- Tripwire: src/__tests__/supabase/publicRpcLockdown.test.ts.

BEGIN;

DROP POLICY IF EXISTS "Users can update own proposals" ON public.ship_template_proposals;
CREATE POLICY "Users can update own proposals" ON public.ship_template_proposals
  FOR UPDATE TO authenticated
  USING (has_profile_access((proposed_by_user_id)::uuid) AND status = 'pending')
  WITH CHECK (has_profile_access((proposed_by_user_id)::uuid) AND status = 'pending');

-- SECURITY INVOKER so current_user is the role that issued the write.
CREATE OR REPLACE FUNCTION public.restrict_proposal_owner_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
    IF current_user NOT IN ('anon', 'authenticated') OR public.is_admin() THEN
        RETURN NEW;
    END IF;
    IF (to_jsonb(NEW) - 'proposal_count' - 'updated_at')
       IS DISTINCT FROM (to_jsonb(OLD) - 'proposal_count' - 'updated_at') THEN
        RAISE EXCEPTION 'Only proposal_count can be changed on a proposal'
            USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS restrict_proposal_owner_update_trigger ON public.ship_template_proposals;
CREATE TRIGGER restrict_proposal_owner_update_trigger
    BEFORE UPDATE ON public.ship_template_proposals
    FOR EACH ROW EXECUTE FUNCTION public.restrict_proposal_owner_update();

COMMIT;
