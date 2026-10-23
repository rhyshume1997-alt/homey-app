-- Rooms (D18). Additive only: a new table, nullable room_id on tasks and snags, and the
-- household's ten rooms seeded for every existing household. Snags whose free-text location
-- exactly matches a room name (case-insensitive) are linked to it; nothing else is changed.

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null check (length(name) between 1 and 60),
  sort_order int not null default 0 check (sort_order between 0 and 1000),
  notes text check (notes is null or length(notes) <= 2000),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index rooms_household_name_key on public.rooms (household_id, lower(name));

alter table public.tasks add column room_id uuid references public.rooms (id) on delete set null;
alter table public.snags add column room_id uuid references public.rooms (id) on delete set null;
create index tasks_room_idx on public.tasks (room_id) where room_id is not null;
create index snags_room_idx on public.snags (room_id) where room_id is not null;

-- A task or snag may only point at a room in its own household.
create function private.guard_room_link() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.room_id is not null and not exists (
    select 1 from public.rooms r where r.id = new.room_id and r.household_id = new.household_id
  ) then
    raise exception 'room not in this household' using errcode = '42501';
  end if;
  return new;
end
$$;
create trigger d_guard_room_link before insert or update of room_id, household_id on public.tasks
  for each row execute function private.guard_room_link();
create trigger d_guard_room_link before insert or update of room_id, household_id on public.snags
  for each row execute function private.guard_room_link();

create trigger a_guard_owned_row before insert or update on public.rooms
  for each row execute function private.guard_owned_row();

create function private.audit_room() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_row public.rooms;
begin
  v_row := case when tg_op = 'DELETE' then old else new end;
  insert into public.audit_log (household_id, actor_user_id, action, entity_type, entity_id, summary)
  values (
    v_row.household_id, (select auth.uid()),
    case tg_op when 'INSERT' then 'room.created' when 'DELETE' then 'room.deleted' else 'room.updated' end,
    'room', v_row.id::text, left(v_row.name, 500)
  );
  return null;
end
$$;
create trigger audit_room after insert or update or delete on public.rooms
  for each row execute function private.audit_room();

revoke execute on function private.guard_room_link(), private.audit_room() from public, anon, authenticated;

alter table public.rooms enable row level security;
alter table public.rooms force row level security;
revoke all on public.rooms from anon, authenticated;
grant select, insert, update, delete on public.rooms to authenticated;

create policy rooms_select on public.rooms for select to authenticated
  using (private.is_household_member(household_id));
create policy rooms_insert on public.rooms for insert to authenticated
  with check (private.is_household_member(household_id));
create policy rooms_update on public.rooms for update to authenticated
  using (private.is_household_member(household_id))
  with check (private.is_household_member(household_id));
create policy rooms_delete on public.rooms for delete to authenticated
  using (private.is_household_member(household_id));

-- Seed Alex's rooms (D18) for every household that has none yet. No audit actor: system write.
insert into public.rooms (household_id, name, sort_order)
select h.id, r.name, r.ord
from public.households h
cross join (values
  ('Living room', 10), ('WC', 20), ('Kitchen', 30), ('Office bedroom', 40), ('Main bedroom', 50),
  ('Spare bedroom', 60), ('Bathroom', 70), ('Understairs cupboard', 80),
  ('Washing machine cupboard', 90), ('Laundry cupboard', 100)
) as r (name, ord)
where not exists (select 1 from public.rooms x where x.household_id = h.id);

update public.snags s set room_id = r.id
from public.rooms r
where s.room_id is null and r.household_id = s.household_id
  and s.location is not null and lower(trim(s.location)) = lower(r.name);

-- Recurring tasks keep their room when the next occurrence is created (review finding F1).
-- Same as 20261023100000_task_recurrence_yearly, plus room_id.
create or replace function private.spawn_next_task() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_next uuid;
  v_base date;
begin
  -- next_task_id is read-only to clients; only the spawn path below (or system writes) sets it.
  if v_uid is not null then
    new.next_task_id := case when tg_op = 'INSERT' then null else old.next_task_id end;
  end if;

  if tg_op = 'UPDATE'
     and old.status = 'open' and new.status = 'done'
     and new.recurrence in ('daily', 'weekly', 'monthly', 'yearly')
     and old.next_task_id is null
     and new.next_task_id is null then
    v_base := coalesce(new.due_date, (now() at time zone 'Europe/London')::date);
    insert into public.tasks (household_id, title, notes, assignee_user_id, recurrence, due_date, created_by, room_id)
    values (
      new.household_id, new.title, new.notes,
      -- Drop an assignee who has left the household, or guard_task would block completing this task.
      case when exists (
        select 1 from public.household_members m
        where m.household_id = new.household_id and m.user_id = new.assignee_user_id
      ) then new.assignee_user_id end,
      new.recurrence,
      (v_base + case new.recurrence
        when 'daily' then interval '1 day'
        when 'weekly' then interval '7 days'
        when 'yearly' then interval '1 year'
        else interval '1 month'
      end)::date,
      coalesce(v_uid, new.completed_by),
      new.room_id
    )
    returning id into v_next;
    new.next_task_id := v_next;
  end if;
  return new;
end
$$;
revoke execute on function private.spawn_next_task() from public, anon, authenticated;
