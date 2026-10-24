-- Bin settings for any household. ADDITIVE ONLY: two new tables, nothing existing is touched.
--   bin_settings  one row per household: the household's own council bin-day page (https only).
--   bin_schedules a repeating collection the household enters once (name, colour, first date, every N weeks).
-- Upcoming days are worked out at read time from the schedules and merged with pushed bin_collections.

create table public.bin_settings (
  household_id uuid primary key references public.households (id) on delete cascade,
  council_url text check (
    council_url is null or (
      length(council_url) <= 500
      and council_url ~* '^https://[^/?#@[:space:]]+([/?#][^[:space:]]*)?$'
    )
  ),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid() references auth.users (id) on delete set null
);

create table public.bin_schedules (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  bin_name text not null check (length(bin_name) between 1 and 40),
  colour text not null check (colour in ('black', 'blue', 'green', 'brown', 'grey', 'purple', 'red', 'yellow')),
  first_date date not null,
  every_weeks smallint not null check (every_weeks between 1 and 8),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index bin_schedules_household_idx on public.bin_schedules (household_id);

-- bin_schedules uses the shared guard (created_by / created_at / updated_at, household_id immutable).
create trigger a_guard_owned_row before insert or update on public.bin_schedules
  for each row execute function private.guard_owned_row();

-- bin_settings has updated_by instead of created_by, so it gets its own guard.
create function private.guard_bin_settings() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if tg_op = 'UPDATE' and new.household_id is distinct from old.household_id then
    raise exception 'household_id is immutable' using errcode = '42501';
  end if;
  new.updated_at := now();
  if v_uid is not null then
    new.updated_by := v_uid;
  end if;
  return new;
end
$$;
create trigger a_guard_bin_settings before insert or update on public.bin_settings
  for each row execute function private.guard_bin_settings();

-- Audit (AFTER). The settings summary never carries the URL; schedules carry the bin name only.
create function private.audit_bin_settings() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.audit_log (household_id, actor_user_id, action, entity_type, entity_id, summary)
  values (
    new.household_id, (select auth.uid()), 'bin_settings.updated', 'bin_settings', new.household_id::text,
    case when new.council_url is null then 'council link cleared' else 'council link set' end
  );
  return null;
end
$$;
create trigger audit_bin_settings after insert or update on public.bin_settings
  for each row execute function private.audit_bin_settings();

create function private.audit_bin_schedule() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_row public.bin_schedules;
begin
  v_row := case when tg_op = 'DELETE' then old else new end;
  insert into public.audit_log (household_id, actor_user_id, action, entity_type, entity_id, summary)
  values (
    v_row.household_id, (select auth.uid()),
    case tg_op when 'INSERT' then 'bin_schedule.created' when 'DELETE' then 'bin_schedule.deleted' else 'bin_schedule.updated' end,
    'bin_schedule', v_row.id::text, left(v_row.bin_name, 500)
  );
  return null;
end
$$;
create trigger audit_bin_schedule after insert or update or delete on public.bin_schedules
  for each row execute function private.audit_bin_schedule();

revoke execute on function private.guard_bin_settings(), private.audit_bin_settings(), private.audit_bin_schedule()
  from public, anon, authenticated;

-- RLS and grants -------------------------------------------------------------------------
alter table public.bin_settings enable row level security;
alter table public.bin_settings force row level security;
alter table public.bin_schedules enable row level security;
alter table public.bin_schedules force row level security;

revoke all on public.bin_settings, public.bin_schedules from anon, authenticated;
grant select, insert, update, delete on public.bin_settings, public.bin_schedules to authenticated;

create policy bin_settings_select on public.bin_settings for select to authenticated
  using (private.is_household_member(household_id));
create policy bin_settings_insert on public.bin_settings for insert to authenticated
  with check (private.is_household_member(household_id));
create policy bin_settings_update on public.bin_settings for update to authenticated
  using (private.is_household_member(household_id))
  with check (private.is_household_member(household_id));
create policy bin_settings_delete on public.bin_settings for delete to authenticated
  using (private.is_household_member(household_id));

create policy bin_schedules_select on public.bin_schedules for select to authenticated
  using (private.is_household_member(household_id));
create policy bin_schedules_insert on public.bin_schedules for insert to authenticated
  with check (private.is_household_member(household_id));
create policy bin_schedules_update on public.bin_schedules for update to authenticated
  using (private.is_household_member(household_id))
  with check (private.is_household_member(household_id));
create policy bin_schedules_delete on public.bin_schedules for delete to authenticated
  using (private.is_household_member(household_id));
