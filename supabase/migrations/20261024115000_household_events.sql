-- Shared household calendar events (C6). Additive only.
create table public.household_events (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  title text not null check (length(title) between 1 and 120),
  starts_on date not null,
  starts_at time,
  ends_on date,
  all_day boolean not null default true,
  room_id uuid references public.rooms (id) on delete set null,
  notes text check (notes is null or length(notes) <= 500),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint household_events_end_after_start check (ends_on is null or ends_on >= starts_on),
  constraint household_events_time_not_all_day check (starts_at is null or not all_day)
);
create index household_events_household_date_idx on public.household_events (household_id, starts_on);

create trigger a_guard_owned_row before insert or update on public.household_events
  for each row execute function private.guard_owned_row();
create trigger d_guard_room_link before insert or update of room_id, household_id on public.household_events
  for each row execute function private.guard_room_link();

create function private.audit_household_event() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_row public.household_events;
begin
  v_row := case when tg_op = 'DELETE' then old else new end;
  insert into public.audit_log (household_id, actor_user_id, action, entity_type, entity_id, summary)
  values (
    v_row.household_id, (select auth.uid()),
    case tg_op when 'INSERT' then 'event.created' when 'DELETE' then 'event.deleted' else 'event.updated' end,
    'household_event', v_row.id::text, left(v_row.title, 500)
  );
  return null;
end
$$;
create trigger audit_household_event after insert or update or delete on public.household_events
  for each row execute function private.audit_household_event();
revoke execute on function private.audit_household_event() from public, anon, authenticated;

alter table public.household_events enable row level security;
alter table public.household_events force row level security;
revoke all on public.household_events from anon, authenticated;
grant select, insert, update, delete on public.household_events to authenticated;

create policy household_events_select on public.household_events for select to authenticated
  using (private.is_household_member(household_id));
create policy household_events_insert on public.household_events for insert to authenticated
  with check (private.is_household_member(household_id));
create policy household_events_update on public.household_events for update to authenticated
  using (private.is_household_member(household_id))
  with check (private.is_household_member(household_id));
create policy household_events_delete on public.household_events for delete to authenticated
  using (private.is_household_member(household_id));
