-- Foundation: households, membership, audit log, RLS helpers.
-- Additive only. No seed data, no personal data.
-- Assumes the table owner has BYPASSRLS (true for Supabase's postgres role), because
-- FORCE ROW LEVEL SECURITY applies policies to the owner and the SECURITY DEFINER
-- helpers read household_members.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated; -- needed to execute policy helpers

-- Tables ---------------------------------------------------------------
create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 100),
  created_at timestamptz not null default now()
);

create table public.household_members (
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'member')),
  display_name text not null check (length(display_name) between 1 and 50),
  created_at timestamptz not null default now(),
  primary key (household_id, user_id)
);
create index household_members_user_id_idx on public.household_members (user_id);

create table public.audit_log (
  id bigint generated always as identity primary key,
  household_id uuid not null references public.households (id),
  actor_user_id uuid references auth.users (id),
  action text not null,
  entity_type text not null,
  entity_id text,
  summary text,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_household_created_idx on public.audit_log (household_id, created_at desc);

-- Helpers --------------------------------------------------------------
create function private.is_household_member(hh uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.household_members m
    where m.household_id = hh and m.user_id = (select auth.uid())
  )
$$;

create function private.has_mfa() returns boolean
language sql stable
set search_path = ''
as $$
  select coalesce((select auth.jwt() ->> 'aal') = 'aal2', false)
$$;

revoke execute on function private.is_household_member(uuid) from public, anon;
revoke execute on function private.has_mfa() from public, anon;
grant execute on function private.is_household_member(uuid) to authenticated;
grant execute on function private.has_mfa() to authenticated;

-- RLS and grants ---------------------------------------------------------
alter table public.households enable row level security;
alter table public.households force row level security;
alter table public.household_members enable row level security;
alter table public.household_members force row level security;
alter table public.audit_log enable row level security;
alter table public.audit_log force row level security;

-- Supabase grants everything to API roles by default; take it back.
revoke all on public.households, public.household_members, public.audit_log from anon, authenticated;
grant select on public.households, public.household_members, public.audit_log to authenticated;

create policy require_mfa on public.households as restrictive for all to authenticated
  using (private.has_mfa());
create policy require_mfa on public.household_members as restrictive for all to authenticated
  using (private.has_mfa());
create policy require_mfa on public.audit_log as restrictive for all to authenticated
  using (private.has_mfa());

create policy households_select on public.households for select to authenticated
  using (private.is_household_member(id));
create policy household_members_select on public.household_members for select to authenticated
  using (private.is_household_member(household_id));
create policy audit_log_select on public.audit_log for select to authenticated
  using (private.is_household_member(household_id));

-- Audit log: append-only for everyone, including owner and service_role ---
create function private.audit_log_immutable() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_log is append-only (% blocked)', tg_op using errcode = '42501';
end
$$;

create trigger audit_log_no_update_delete before update or delete on public.audit_log
  for each row execute function private.audit_log_immutable();
create trigger audit_log_no_truncate before truncate on public.audit_log
  for each statement execute function private.audit_log_immutable();

-- Audit writer: the only write path for authenticated users ---------------
create function public.log_audit(
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
  if not private.has_mfa() then
    raise exception 'mfa required' using errcode = '42501';
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

revoke execute on function public.log_audit(uuid, text, text, text, text, jsonb, jsonb) from public, anon;
grant execute on function public.log_audit(uuid, text, text, text, text, jsonb, jsonb) to authenticated;
