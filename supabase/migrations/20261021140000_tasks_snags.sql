-- Phase 2: chores (tasks) and house snagging list (snags). Additive only.
-- Limits and enums mirror src/contracts/tasks.ts and src/contracts/snags.ts.

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  title text not null check (length(title) between 1 and 200),
  notes text check (notes is null or length(notes) <= 2000),
  assignee_user_id uuid references auth.users (id) on delete set null,
  due_date date,
  recurrence text not null default 'none' check (recurrence in ('none', 'daily', 'weekly', 'monthly')),
  status text not null default 'open' check (status in ('open', 'done')),
  completed_at timestamptz,
  completed_by uuid references auth.users (id) on delete set null,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tasks_household_status_idx on public.tasks (household_id, status);
create index tasks_household_due_idx on public.tasks (household_id, due_date);
create index tasks_assignee_idx on public.tasks (assignee_user_id);

create table public.snags (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  title text not null check (length(title) between 1 and 200),
  location text check (location is null or length(location) <= 100),
  notes text check (notes is null or length(notes) <= 2000),
  status text not null default 'open' check (status in ('open', 'reported', 'in_progress', 'fixed')),
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  fixed_at timestamptz,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index snags_household_status_idx on public.snags (household_id, status);

-- Integrity triggers (BEFORE) ---------------------------------------------
-- Shared by both tables: created_by/household_id protection and updated_at.
-- auth.uid() is null only for server-side/system writes (service role, FK actions).
create function private.guard_owned_row() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if tg_op = 'INSERT' then
    if v_uid is not null then
      new.created_by := v_uid;
    end if;
    new.created_at := now();
    new.updated_at := now();
  else
    if new.household_id is distinct from old.household_id then
      raise exception 'household_id is immutable' using errcode = '42501';
    end if;
    new.created_at := old.created_at;
    if v_uid is not null then
      new.created_by := old.created_by;
    elsif new.created_by is not null then
      new.created_by := old.created_by; -- system writes may only clear it (FK on delete set null)
    end if;
    new.updated_at := now();
  end if;
  return new;
end
$$;

create function private.guard_task() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if new.assignee_user_id is not null
     and (tg_op = 'INSERT' or new.assignee_user_id is distinct from old.assignee_user_id)
     and not exists (
       select 1 from public.household_members m
       where m.household_id = new.household_id and m.user_id = new.assignee_user_id
     ) then
    raise exception 'assignee is not a member of this household' using errcode = '23514';
  end if;

  if tg_op = 'INSERT' or new.status is distinct from old.status then
    if new.status = 'done' then
      new.completed_at := now();
      new.completed_by := v_uid;
    else
      new.completed_at := null;
      new.completed_by := null;
    end if;
  elsif v_uid is not null then
    new.completed_at := old.completed_at;
    new.completed_by := old.completed_by;
  end if;
  return new;
end
$$;

create function private.guard_snag() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    new.fixed_at := case when new.status = 'fixed' then now() else null end;
  elsif (select auth.uid()) is not null then
    new.fixed_at := old.fixed_at;
  end if;
  return new;
end
$$;

-- Trigger names sort so guard_owned_row runs before the table-specific guard.
create trigger a_guard_owned_row before insert or update on public.tasks
  for each row execute function private.guard_owned_row();
create trigger b_guard_task before insert or update on public.tasks
  for each row execute function private.guard_task();
create trigger a_guard_owned_row before insert or update on public.snags
  for each row execute function private.guard_owned_row();
create trigger b_guard_snag before insert or update on public.snags
  for each row execute function private.guard_snag();

-- Audit triggers (AFTER) ----------------------------------------------------
create function private.audit_task() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_action text;
  v_row public.tasks;
begin
  if tg_op = 'INSERT' then
    v_action := 'task.created';
  elsif tg_op = 'DELETE' then
    v_action := 'task.deleted';
  elsif old.status = 'open' and new.status = 'done' then
    v_action := 'task.completed';
  elsif old.status = 'done' and new.status = 'open' then
    v_action := 'task.reopened';
  else
    v_action := 'task.updated';
  end if;
  v_row := case when tg_op = 'DELETE' then old else new end;
  insert into public.audit_log (household_id, actor_user_id, action, entity_type, entity_id, summary, before, after)
  values (
    v_row.household_id, (select auth.uid()), v_action, 'task', v_row.id::text, left(v_row.title, 500),
    case when tg_op = 'INSERT' then null else to_jsonb(old) end,
    case when tg_op = 'DELETE' then null else to_jsonb(new) end
  );
  return null;
end
$$;

create function private.audit_snag() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_action text;
  v_row public.snags;
begin
  if tg_op = 'INSERT' then
    v_action := 'snag.created';
  elsif tg_op = 'DELETE' then
    v_action := 'snag.deleted';
  elsif old.status <> 'fixed' and new.status = 'fixed' then
    v_action := 'snag.fixed';
  else
    v_action := 'snag.updated';
  end if;
  v_row := case when tg_op = 'DELETE' then old else new end;
  insert into public.audit_log (household_id, actor_user_id, action, entity_type, entity_id, summary, before, after)
  values (
    v_row.household_id, (select auth.uid()), v_action, 'snag', v_row.id::text, left(v_row.title, 500),
    case when tg_op = 'INSERT' then null else to_jsonb(old) end,
    case when tg_op = 'DELETE' then null else to_jsonb(new) end
  );
  return null;
end
$$;

create trigger audit_task after insert or update or delete on public.tasks
  for each row execute function private.audit_task();
create trigger audit_snag after insert or update or delete on public.snags
  for each row execute function private.audit_snag();

revoke execute on function private.guard_owned_row(), private.guard_task(), private.guard_snag(),
  private.audit_task(), private.audit_snag() from public, anon, authenticated;

-- RLS and grants ---------------------------------------------------------------
alter table public.tasks enable row level security;
alter table public.tasks force row level security;
alter table public.snags enable row level security;
alter table public.snags force row level security;

revoke all on public.tasks, public.snags from anon, authenticated;
grant select, insert, update, delete on public.tasks, public.snags to authenticated;

create policy tasks_select on public.tasks for select to authenticated
  using (private.is_household_member(household_id));
create policy tasks_insert on public.tasks for insert to authenticated
  with check (private.is_household_member(household_id));
create policy tasks_update on public.tasks for update to authenticated
  using (private.is_household_member(household_id))
  with check (private.is_household_member(household_id));
create policy tasks_delete on public.tasks for delete to authenticated
  using (private.is_household_member(household_id));

create policy snags_select on public.snags for select to authenticated
  using (private.is_household_member(household_id));
create policy snags_insert on public.snags for insert to authenticated
  with check (private.is_household_member(household_id));
create policy snags_update on public.snags for update to authenticated
  using (private.is_household_member(household_id))
  with check (private.is_household_member(household_id));
create policy snags_delete on public.snags for delete to authenticated
  using (private.is_household_member(household_id));
