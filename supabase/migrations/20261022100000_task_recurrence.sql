-- Task 2.4: recurring chores. Additive only.
-- When a task with recurrence daily/weekly/monthly moves open -> done, the database
-- creates the next occurrence (same household, title, notes, assignee, recurrence).
-- Due date = (due_date, or today in Europe/London if null) + 1 day / 7 days / 1 month
-- (Postgres interval semantics: Jan 31 + 1 month = Feb 28/29). created_by = the completer.
-- The spawned insert fires the normal audit trigger (task.created, actor = completer).
-- Reopening the completed task does NOT delete the spawned task (kept simple on purpose).
-- next_task_id on the completed row prevents duplicates: complete -> reopen -> complete spawns once.

alter table public.tasks
  add column next_task_id uuid references public.tasks (id) on delete set null;

-- Runs after guard_owned_row (a_) and guard_task (b_), so completed_by is already set.
-- BEFORE trigger: the spawned row is inserted first, then next_task_id is set on the
-- row being updated, so no second UPDATE (and no extra audit row) is needed.
create function private.spawn_next_task() returns trigger
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
     and new.recurrence in ('daily', 'weekly', 'monthly')
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

create trigger c_spawn_next_task before insert or update on public.tasks
  for each row execute function private.spawn_next_task();

revoke execute on function private.spawn_next_task() from public, anon, authenticated;
