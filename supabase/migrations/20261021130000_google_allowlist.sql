-- Decision D15: no MFA. Sign-in is Google OAuth, restricted to an email allowlist.
-- Additive except for removing the MFA gate (policies and helper). No data is touched.

-- Drop the MFA gate ---------------------------------------------------------
drop policy require_mfa on public.households;
drop policy require_mfa on public.household_members;
drop policy require_mfa on public.audit_log;

create or replace function public.log_audit(
  p_household uuid,
  p_action text,
  p_entity_type text,
  p_entity_id text,
  p_summary text,
  p_before jsonb,
  p_after jsonb
) returns bigint
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_id bigint;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_household is null or not private.is_household_member(p_household) then
    raise exception 'not a member of this household' using errcode = '42501';
  end if;
  if p_action is null or length(p_action) not between 1 and 64 then
    raise exception 'invalid action' using errcode = '22023';
  end if;
  if p_entity_type is null or length(p_entity_type) not between 1 and 64 then
    raise exception 'invalid entity_type' using errcode = '22023';
  end if;
  if p_summary is not null and length(p_summary) > 500 then
    raise exception 'summary too long' using errcode = '22023';
  end if;
  if p_entity_id is not null and length(p_entity_id) > 128 then
    raise exception 'entity_id too long' using errcode = '22023';
  end if;
  if coalesce(pg_column_size(p_before), 0) > 32768 or coalesce(pg_column_size(p_after), 0) > 32768 then
    raise exception 'before/after too large' using errcode = '22023';
  end if;

  insert into public.audit_log (household_id, actor_user_id, action, entity_type, entity_id, summary, before, after)
  values (p_household, v_uid, p_action, p_entity_type, p_entity_id, p_summary, p_before, p_after)
  returning id into v_id;
  return v_id;
end
$$;

drop function private.has_mfa();

-- Allowlist ------------------------------------------------------------------
-- Rows are added by hand via SQL (never committed: emails are personal data).
-- Not exposed to the API: private schema, no grants, RLS forced with no policies.
create table private.allowed_emails (
  email text primary key check (email = lower(email) and length(email) between 3 and 320),
  household_id uuid not null references public.households (id) on delete cascade,
  role text not null check (role in ('owner', 'member')),
  display_name text not null check (length(display_name) between 1 and 50)
);
alter table private.allowed_emails enable row level security;
alter table private.allowed_emails force row level security;
revoke all on private.allowed_emails from public, anon, authenticated;

-- Any new auth user (Google or otherwise) must be on the allowlist, and joins its household.
create function private.on_auth_user_created() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v public.household_members%rowtype;
  a private.allowed_emails%rowtype;
begin
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

create trigger our_home_allowlist after insert on auth.users
  for each row execute function private.on_auth_user_created();

-- An existing user cannot switch to an address that is not allowed.
create function private.on_auth_user_email_changed() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from private.allowed_emails where email = lower(new.email)) then
    raise exception 'email not allowed' using errcode = '42501';
  end if;
  return new;
end
$$;
revoke execute on function private.on_auth_user_email_changed() from public, anon, authenticated;

create trigger our_home_allowlist_email after update of email on auth.users
  for each row when (new.email is distinct from old.email)
  execute function private.on_auth_user_email_changed();
