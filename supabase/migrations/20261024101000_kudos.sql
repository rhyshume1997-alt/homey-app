-- Kudos: in-app thank-yous between the two household members. Additive only.
-- Never emailed. from_user is always the caller (trigger); rows are immutable.

create table public.kudos (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  from_user uuid not null references auth.users (id) on delete cascade,
  to_user uuid not null references auth.users (id) on delete cascade,
  -- No FK: audit_log is append-only (TRUNCATE guard); the trigger checks the row is in this household.
  audit_id bigint,
  message text not null check (length(message) between 1 and 200),
  created_at timestamptz not null default now()
);
create index kudos_household_created_idx on public.kudos (household_id, created_at desc);
create index kudos_to_user_created_idx on public.kudos (to_user, created_at desc);
-- One thank-you per sender per logged action.
create unique index kudos_from_audit_key on public.kudos (from_user, audit_id) where audit_id is not null;

create function private.guard_kudos() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  new.created_at := now(); -- server time only (ordering and "recent" checks rely on it)
  -- Never trust input for the sender. Only trusted server roles (no JWT) may keep a supplied value.
  if v_uid is not null then
    new.from_user := v_uid;
  elsif new.from_user is null then
    raise exception 'kudos sender required';
  end if;
  if new.to_user = new.from_user then
    raise exception 'cannot thank yourself';
  end if;
  if not exists (
    select 1 from public.household_members m where m.household_id = new.household_id and m.user_id = new.from_user
  ) or not exists (
    select 1 from public.household_members m where m.household_id = new.household_id and m.user_id = new.to_user
  ) then
    raise exception 'both people must be in the household';
  end if;
  if new.audit_id is not null and not exists (
    select 1 from public.audit_log a where a.id = new.audit_id and a.household_id = new.household_id
  ) then
    raise exception 'audit entry is not in this household';
  end if;
  return new;
end
$$;

create trigger guard_kudos before insert on public.kudos
  for each row execute function private.guard_kudos();
revoke execute on function private.guard_kudos() from public, anon, authenticated;

alter table public.kudos enable row level security;
alter table public.kudos force row level security;

revoke all on public.kudos from anon, authenticated;
grant select, insert on public.kudos to authenticated;

create policy kudos_select on public.kudos for select to authenticated
  using (private.is_household_member(household_id));
create policy kudos_insert on public.kudos for insert to authenticated
  with check (
    private.is_household_member(household_id)
    and from_user = (select auth.uid())
    and to_user <> (select auth.uid())
    and exists (
      select 1 from public.household_members m
      where m.household_id = kudos.household_id and m.user_id = kudos.to_user
    )
  );
