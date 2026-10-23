-- Yearly recurrence for tasks (annual boiler service and similar). Additive only:
-- widens the recurrence check (no existing row can fail it) and adds a yearly step
-- to the spawn trigger. Everything else in spawn_next_task is unchanged from 20261022100000.
-- Postgres interval semantics: Feb 29 + 1 year = Feb 28, as with monthly on the 31st.

alter table public.tasks drop constraint tasks_recurrence_check;
alter table public.tasks add constraint tasks_recurrence_check
  check (recurrence in ('none', 'daily', 'weekly', 'monthly', 'yearly'));

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
    insert into public.tasks (household_id, title, notes, assignee_user_id, recurrence, due_date, created_by)
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
      coalesce(v_uid, new.completed_by)
    )
    returning id into v_next;
    new.next_task_id := v_next;
  end if;
  return new;
end
$$;

revoke execute on function private.spawn_next_task() from public, anon, authenticated;
