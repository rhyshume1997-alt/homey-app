-- Scheduled jobs: daily notifications for every household and pruning of used signatures. Additive only.
-- The per-household generator moves to private.generate_household_notifications(); refresh_my_notifications()
-- keeps its exact behaviour (caller's households only, 60-second rate limit) and calls it.
-- private.run_scheduled_jobs() is run by pg_cron as the database owner. No API role can execute it.

/**
 * Generates notifications for one household. Idempotent via dedupe_key.
 * No auth checks: callers (refresh_my_notifications, run_scheduled_jobs) decide which households.
 * Nobody but the owner may execute it.
 */
create function private.generate_household_notifications(p_household uuid) returns int
language plpgsql security definer
set search_path = ''
as $$
declare
  v_hh uuid := p_household;
  v_today date := (now() at time zone 'Europe/London')::date;
  v_total int := 0;
  v_n int;
begin
  if v_hh is null then
    return 0;
  end if;

  -- Renewals / end dates within 30 days.
  insert into public.notifications (household_id, kind, title, body, link, dedupe_key)
  select r.household_id, 'renewal_due', left('Renewal coming up: ' || r.title, 120),
         'A renewal or end date is within 30 days.', '/money',
         'renewal:' || r.id || ':' || d.dt
  from public.household_records r
  cross join lateral (values (r.renewal_date), (r.end_date)) as d (dt)
  where r.household_id = v_hh and d.dt between v_today and v_today + 30
  on conflict (household_id, dedupe_key) do nothing;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  -- Open tasks due today or tomorrow.
  insert into public.notifications (household_id, kind, title, body, link, dedupe_key)
  select t.household_id, 'task_due',
         left(case when t.due_date = v_today then 'Due today: ' else 'Due tomorrow: ' end || t.title, 120),
         null, '/tasks', 'task_due:' || t.id || ':' || t.due_date
  from public.tasks t
  where t.household_id = v_hh and t.status = 'open' and t.due_date between v_today and v_today + 1
  on conflict (household_id, dedupe_key) do nothing;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  -- Overdue open tasks.
  insert into public.notifications (household_id, kind, title, body, link, dedupe_key)
  select t.household_id, 'task_overdue', left('Overdue: ' || t.title, 120),
         null, '/tasks', 'task_overdue:' || t.id || ':' || t.due_date
  from public.tasks t
  where t.household_id = v_hh and t.status = 'open' and t.due_date < v_today
  on conflict (household_id, dedupe_key) do nothing;
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  -- Optional sources: only when the table (and the columns used) exist.
  if to_regclass('public.bin_collections') is not null
     and (select count(*) from information_schema.columns
          where table_schema = 'public' and table_name = 'bin_collections'
            and column_name in ('household_id', 'collection_date')) = 2 then
    execute $q$
      insert into public.notifications (household_id, kind, title, body, link, dedupe_key)
      select b.household_id, 'bin_tomorrow', 'Bin collection tomorrow', null, null,
             'bin:' || b.id || ':' || b.collection_date
      from public.bin_collections b
      where b.household_id = $1 and b.collection_date = $2 + 1
      on conflict (household_id, dedupe_key) do nothing
    $q$ using v_hh, v_today;
    get diagnostics v_n = row_count; v_total := v_total + v_n;
  end if;

  if to_regclass('public.documents') is not null
     and (select count(*) from information_schema.columns
          where table_schema = 'public' and table_name = 'documents'
            and column_name in ('household_id', 'title', 'expires_on')) = 3 then
    execute $q$
      insert into public.notifications (household_id, kind, title, body, link, dedupe_key)
      select d.household_id, 'document_expiring', left('Document expiring: ' || d.title, 120),
             'A document expires within 60 days.', null,
             'document:' || d.id || ':' || d.expires_on
      from public.documents d
      where d.household_id = $1 and d.expires_on between $2 and $2 + 60
      on conflict (household_id, dedupe_key) do nothing
    $q$ using v_hh, v_today;
    get diagnostics v_n = row_count; v_total := v_total + v_n;
  end if;

  return v_total;
end
$$;
revoke execute on function private.generate_household_notifications(uuid) from public, anon, authenticated;

-- Same contract as before: scoped to the caller's own household(s), rate limited per household.
create or replace function public.refresh_my_notifications() returns int
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_hh uuid;
  v_total int := 0;
begin
  if v_uid is null then
    return 0;
  end if;

  for v_hh in select m.household_id from public.household_members m where m.user_id = v_uid loop
    -- Rate limit: no-op if this household ran within the last 60 seconds.
    insert into private.notification_runs (household_id, last_run) values (v_hh, now())
    on conflict (household_id) do update set last_run = excluded.last_run
      where private.notification_runs.last_run <= now() - interval '60 seconds';
    if not found then
      continue;
    end if;

    v_total := v_total + private.generate_household_notifications(v_hh);
  end loop;

  return v_total;
end
$$;
-- create or replace keeps the existing grants; restated so this file reads on its own.
revoke execute on function public.refresh_my_notifications() from public, anon;
grant execute on function public.refresh_my_notifications() to authenticated;

/**
 * Daily job: notifications for every household, then prune replay-protection rows older than a day
 * (verify_signed rejects timestamps older than 5 minutes, so those rows can never match again).
 * Ignores and does not touch the per-user rate limit (private.notification_runs).
 * Returns {"households": n, "notifications": n, "signatures_pruned": n}.
 */
create function private.run_scheduled_jobs() returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_hh uuid;
  v_households int := 0;
  v_notifications int := 0;
  v_pruned int;
begin
  for v_hh in select h.id from public.households h order by h.id loop
    v_notifications := v_notifications + private.generate_household_notifications(v_hh);
    v_households := v_households + 1;
  end loop;

  delete from private.used_signatures where used_at < now() - interval '1 day';
  get diagnostics v_pruned = row_count;

  return jsonb_build_object(
    'households', v_households,
    'notifications', v_notifications,
    'signatures_pruned', v_pruned
  );
end
$$;
revoke execute on function private.run_scheduled_jobs() from public, anon, authenticated;

-- Schedule only where pg_cron exists (Supabase). Plain Postgres (CI) skips this block.
-- Supabase pg_cron runs in UTC: 05:00 UTC is 05:00 GMT / 06:00 BST, the same London date either way.
-- The job runs as the role that schedules it (the migration owner), which owns run_scheduled_jobs().
do $$
begin
  if exists (select 1 from pg_catalog.pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    perform cron.unschedule(j.jobid) from cron.job j where j.jobname = 'our-home-daily';
    perform cron.schedule('our-home-daily', '0 5 * * *', 'select private.run_scheduled_jobs()');
  end if;
end
$$;
