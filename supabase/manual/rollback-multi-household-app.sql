-- Our Home: DB side of an APP-ONLY rollback after apply-multi-household.sql.
-- Use ONLY if the multi-household app must be reverted but the database is kept (no restore).
-- The multi-household migration dropped the old one-household signatures of two RPCs; the previous
-- app calls them, so Gmail sync and Google connect would fail after an app-only revert.
-- This re-creates those two old signatures next to the new ones (different arguments, so they coexist).
-- Additive: no table, column or row is changed. Safe to run more than once.
-- They pick the caller's OLDEST ACTIVE membership, exactly as the previous app expects.
-- Drop them again (drop function ...) before re-deploying the multi-household app.
begin;

create or replace function public.sync_my_email_threads(p_member text, p_threads jsonb) returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_household uuid;
  v_name text;
  v_n integer;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select household_id, display_name into v_household, v_name
    from public.household_members where user_id = v_uid and status = 'active' order by created_at limit 1;
  if v_household is null then raise exception 'not a member' using errcode = '42501'; end if;
  if p_member is distinct from v_name then raise exception 'member mismatch' using errcode = '42501'; end if;
  v_n := private.apply_email_threads(v_household, jsonb_build_object('member', p_member, 'threads', p_threads));
  insert into private.gmail_sync_runs (user_id, ran_at) values (v_uid, now())
    on conflict (user_id) do update set ran_at = now();
  return v_n;
end
$$;
revoke execute on function public.sync_my_email_threads(text, jsonb) from public, anon;
grant execute on function public.sync_my_email_threads(text, jsonb) to authenticated;

create or replace function public.store_my_google_token(p_ciphertext text, p_scopes text) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_household uuid;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select household_id into v_household from public.household_members
    where user_id = v_uid and status = 'active' order by created_at limit 1;
  if v_household is null then raise exception 'not a member' using errcode = '42501'; end if;
  if p_ciphertext is null or char_length(p_ciphertext) not between 1 and 4000 or p_ciphertext !~ '^v1:'
     or p_scopes is null or char_length(p_scopes) > 1000 then
    raise exception 'invalid token' using errcode = '22023';
  end if;
  insert into private.google_tokens (user_id, household_id, ciphertext, scopes)
  values (v_uid, v_household, p_ciphertext, p_scopes)
  on conflict (user_id) do update set
    household_id = excluded.household_id, ciphertext = excluded.ciphertext,
    scopes = excluded.scopes, updated_at = now();
  insert into public.audit_log (household_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_household, v_uid, 'google.connected', 'google_token', v_uid::text, 'Google connected (read-only)');
end
$$;
revoke execute on function public.store_my_google_token(text, text) from public, anon;
grant execute on function public.store_my_google_token(text, text) to authenticated;

-- Close sign-up to new households while the old app is live (it has no onboarding screen).
-- Requires the kill switch from the multi-household migration.
update private.app_settings set household_creation_open = false, updated_at = now();

commit;
