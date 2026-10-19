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

## After applying: from the app, as a fresh guest (browser devtools)
- Submit without a name → error message `guest_name_required`.
- Submit with `p_guest_name: 'Tester'` → returns `best`, `player_rank`.
- A second guest submitting `p_guest_name: 'tester'` → code `23505`.
- As the guest: `supabase.from('users').update({ username: 'x' }).eq('id', uid)` → 0 rows.
- As the guest: `supabase.from('ships').insert({ user_id: uid, ... })` → RLS error.
- `get_arcade_leaderboard` → the guest row has `is_guest: true`.

## Schedule the cleanup (after enabling pg_cron in the dashboard)
```sql
select cron.schedule('cleanup-arcade-guests', '17 3 * * *', $$select public.cleanup_arcade_guests()$$);
```
