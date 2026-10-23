-- Security fix (review S1): the allowlist must only accept accounts created by Google sign-in.
-- Otherwise anyone knowing an allowlisted address could sign up with email/password (or another
-- provider) and inherit the household membership. GoTrue sets raw_app_meta_data.provider on insert.
-- Replaces one function body; no data is touched.

create or replace function private.on_auth_user_created() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  a private.allowed_emails%rowtype;
begin
  if coalesce(new.raw_app_meta_data ->> 'provider', '') <> 'google' then
    raise exception 'only Google sign-in is allowed' using errcode = '42501';
  end if;
  select * into a from private.allowed_emails where email = lower(new.email);
  if not found then
    raise exception 'email not allowed' using errcode = '42501';
  end if;
  insert into public.household_members (household_id, user_id, role, display_name)
  values (a.household_id, new.id, a.role, a.display_name)
  on conflict do nothing;
  return new;
end
$$;
revoke execute on function private.on_auth_user_created() from public, anon, authenticated;
