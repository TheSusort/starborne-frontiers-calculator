# Arcade guests: SQL checks

## Before applying: the replaced definitions must match the repo
```sql
select pg_get_functiondef('public.has_profile_access'::regproc);
select polname, pg_get_expr(polqual, polrelid), pg_get_expr(polwithcheck, polrelid)
  from pg_policy where polrelid = 'public.users'::regclass;
```
Also: `select has_table_privilege('postgres', 'auth.users', 'DELETE');` must be true, or the cleanup fails silently under cron.

Expected: `has_profile_access` is the `20260424000003_alt_accounts_rls.sql` body. The policies
"Users can update own profile or owned alts" and "Users can insert alt profiles they own" match
that file.

## Before applying: live write policies on the tables that get "No guest" restrictive policies
The restrictive policies leave the permissive ones untouched; capture them so the PR records what
they AND with, and so a table with RLS disabled (where a policy is inert) is caught.
```sql
select c.relname, c.relrowsecurity, c.relforcerowsecurity,
       p.polname, p.polcmd, p.polpermissive,
       pg_get_expr(p.polqual, p.polrelid) as using_expr,
       pg_get_expr(p.polwithcheck, p.polrelid) as check_expr
  from pg_class c
  left join pg_policy p on p.polrelid = c.oid
 where c.oid in (
   'public.users'::regclass, 'public.arcade_scores'::regclass,
   'public.encounter_votes'::regclass, 'public.community_recommendation_votes'::regclass,
   'public.community_recommendations'::regclass, 'public.encounter_notes'::regclass,
   'public.encounter_formations'::regclass, 'public.ship_template_proposals'::regclass,
   'public.ship_templates'::regclass, 'public.user_activity_log'::regclass,
   'public.statistics_snapshots'::regclass, 'public.system_health_snapshots'::regclass,
   'public.system_alerts'::regclass)
 order by c.relname, p.polcmd, p.polname;
```
Expected: `relrowsecurity` true on every table, and `relforcerowsecurity` false on `users` and
`arcade_scores`. submit_arcade_score writes those two as its owner, which bypasses RLS only while
FORCE is off; with FORCE on, the "No guest" policies reject every guest submit, so do not apply.
Per table, the single-table form is
`select polname, polcmd, polpermissive, pg_get_expr(polqual,polrelid), pg_get_expr(polwithcheck,polrelid) from pg_policy where polrelid = 'public.<t>'::regclass;`

## Before applying: telemetry tables left unguarded
`heartbeats` and `daily_usage_stats` get no restrictive policy, because they are written through
RPCs whose definitions are not in the repo. If those RPCs are SECURITY INVOKER, a restrictive
policy would make them throw for a guest mid-autogear or mid-import.
```sql
select proname, prosecdef from pg_proc
 where pronamespace = 'public'::regnamespace
   and proname in ('upsert_heartbeat', 'increment_autogear_count', 'increment_import_count');
select polrelid::regclass, polname, polcmd, polroles::regrole[],
       pg_get_expr(polqual, polrelid), pg_get_expr(polwithcheck, polrelid)
  from pg_policy
 where polrelid in ('public.heartbeats'::regclass, 'public.daily_usage_stats'::regclass);
```
If increment_autogear_count / increment_import_count are SECURITY INVOKER, a guest's autogear run
or import already fails on `user_activity_log` through has_profile_access; the client must skip
those calls for guests. If all three are SECURITY DEFINER (`prosecdef` true) and either table has a write policy open to
`authenticated`, add the same "No guest" policies to that table.

## Before applying: reads a guest could lose
A guest makes every request as role `authenticated`, never `anon`. No `TO anon` policy is in the
repo; these list the live ones and any function only `anon` may execute.
```sql
select polrelid::regclass, polname, polcmd, pg_get_expr(polqual, polrelid)
  from pg_policy where 'anon'::regrole = any(polroles)
 order by 1, 2;
select p.oid::regprocedure
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace
   and has_function_privilege('anon', p.oid, 'EXECUTE')
   and not has_function_privilege('authenticated', p.oid, 'EXECUTE');
```
Expected: every anon SELECT policy has a counterpart for `authenticated` (or `public`) that does
not route through `has_profile_access`; the function query returns no rows. Tables with no
SELECT policy in the repo, so check these first: `ship_templates`, `community_recommendations`,
`community_recommendation_votes`, `encounter_votes`.

## After applying: a guest cannot write outside the arcade (SQL editor)
```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":true}', true);
insert into public.encounter_votes (encounter_id, user_id, vote)
  select id, '00000000-0000-4000-8000-000000000001', 1 from public.encounter_notes limit 1;
-- expect: ERROR 42501 new row violates row-level security policy
rollback;

begin;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":true}', true);
insert into public.community_recommendation_votes (recommendation_id, user_id, vote_type)
  select id, '00000000-0000-4000-8000-000000000001', 'upvote' from public.community_recommendations limit 1;
-- expect: ERROR 42501
rollback;
```
`INSERT 0 0` is not a pass: the select found no row the role can see, so nothing was tested.
Paste a known id instead of the select. The same two blocks with `"is_anonymous":false` and a real account's id as `sub` must get past
RLS (they may still fail on a foreign key or a unique key, which is fine).

Also: `select has_function_privilege('service_role', 'public.cleanup_arcade_guests()', 'EXECUTE');`
is true, and the same for `authenticated` is false.

## After applying: from the app, as a fresh guest (browser devtools)
- Submit without a name → error message `guest_name_required`.
- Submit with `p_guest_name: 'Tester'` → returns `best`, `player_rank`.
- A second guest submitting `p_guest_name: 'tester'` → code `23505`, message `guest_name_taken`.
- As the guest: `supabase.from('encounter_votes').insert({ encounter_id, user_id: uid, vote: 1 })` → RLS error.
- As the guest: `supabase.from('users').update({ username: 'x' }).eq('id', uid)` → 0 rows.
- As the guest: `supabase.from('ships').insert({ user_id: uid, ... })` → RLS error.
- `get_arcade_leaderboard` → the guest row has `is_guest: true`.

## Schedule the cleanup (after enabling pg_cron in the dashboard)
```sql
select cron.schedule('cleanup-arcade-guests', '17 3 * * *', $$select public.cleanup_arcade_guests()$$);
```
