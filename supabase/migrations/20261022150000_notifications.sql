-- In-app notification centre. Additive only. Source of truth for push/email later.
-- Notifications are written only by refresh_my_notifications() (security definer); users never write them.

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  recipient_user_id uuid references auth.users (id) on delete cascade, -- null = everyone in the household
  kind text not null check (kind in (
    'renewal_due', 'task_due', 'task_overdue', 'bin_tomorrow', 'snag_stale', 'document_expiring', 'system'
  )),
  title text not null check (length(title) between 1 and 120),
  body text check (body is null or length(body) <= 500),
  link text check (link is null or (link ~ '^/[A-Za-z0-9/_?=&.-]*$' and link !~ '^//')),
  dedupe_key text not null check (length(dedupe_key) between 1 and 300),
  created_at timestamptz not null default now(),
  constraint notifications_dedupe_unique unique (household_id, dedupe_key)
);
create index notifications_household_created_idx on public.notifications (household_id, created_at desc);

create table public.notification_reads (
  notification_id uuid not null references public.notifications (id) on delete cascade,
  household_id uuid not null references public.households (id) on delete cascade, -- set by trigger
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (notification_id, user_id)
);
create index notification_reads_user_idx on public.notification_reads (user_id);

-- household_id always comes from the notification itself, never from the client.
create function private.set_notification_read_household() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  select n.household_id into new.household_id from public.notifications n where n.id = new.notification_id;
  return new;
end
$$;
create trigger a_set_household before insert on public.notification_reads
  for each row execute function private.set_notification_read_household();

-- Rate-limit state: private, never exposed through the API.
create table private.notification_runs (
  household_id uuid primary key references public.households (id) on delete cascade,
  last_run timestamptz not null
);
alter table private.notification_runs enable row level security;
alter table private.notification_runs force row level security;
revoke all on private.notification_runs from public, anon, authenticated;

alter table public.notifications enable row level security;
alter table public.notifications force row level security;
alter table public.notification_reads enable row level security;
alter table public.notification_reads force row level security;

revoke all on public.notifications from anon, authenticated;
revoke all on public.notification_reads from anon, authenticated;
grant select on public.notifications to authenticated;
grant select, insert, delete on public.notification_reads to authenticated;

create policy notifications_select on public.notifications for select to authenticated
  using (
    private.is_household_member(household_id)
    and (recipient_user_id is null or recipient_user_id = (select auth.uid()))
  );

create policy notification_reads_select on public.notification_reads for select to authenticated
  using (user_id = (select auth.uid()));
-- The notification must be visible to the caller (the subquery runs under notifications RLS).
create policy notification_reads_insert on public.notification_reads for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.notifications n where n.id = notification_id)
  );
create policy notification_reads_delete on public.notification_reads for delete to authenticated
  using (user_id = (select auth.uid()));

-- Generator. Scoped to the caller's own household(s); idempotent via dedupe_key.
create function public.refresh_my_notifications() returns int
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_hh uuid;
  v_today date := (now() at time zone 'Europe/London')::date;
  v_total int := 0;
  v_n int;
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
  end loop;

  return v_total;
end
$$;

revoke execute on function public.refresh_my_notifications() from public, anon;
grant execute on function public.refresh_my_notifications() to authenticated;
