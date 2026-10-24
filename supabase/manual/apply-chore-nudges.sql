-- Our Home: chore nudges (migration 20261026110000), then record it in the migration history.
-- One-off helper for the Supabase SQL editor: paste all of it and Run once.
-- Additive only (widens one check constraint, adds a private table and two functions; no data changes).
-- All or nothing: if any statement fails, nothing is changed.
begin;

-- ===== 20261026110000_chore_nudges.sql =====
-- Chore nudges: ping the person a chore is assigned to. ADDITIVE ONLY.
-- * notifications.kind gains 'chore_nudge' (the check constraint is widened; no rows change).
-- * private.chore_nudges records every nudge; rate limits are counted from it, server side.
-- * public.nudge_task(task) validates, rate limits, logs and creates the in-app notification.
-- * public.nudge_push_targets(nudge) lets the sender's server read the RECIPIENT's push
--   subscriptions for a nudge the caller just sent (RLS otherwise hides other people's devices).
-- Rate limits (42501 'rate limit reached'): one nudge per task per 30 minutes, 20 per user per rolling 24 h.

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
  'renewal_due', 'task_due', 'task_overdue', 'bin_tomorrow', 'snag_stale', 'document_expiring', 'system',
  'chore_nudge'
));

create table private.chore_nudges (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  task_id uuid not null references public.tasks (id) on delete cascade,
  sender_user_id uuid not null references auth.users (id) on delete cascade,
  recipient_user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  targets_read_at timestamptz -- set when the sender's server reads the push targets (single use)
);
create index chore_nudges_task_idx on private.chore_nudges (task_id, created_at desc);
create index chore_nudges_sender_idx on private.chore_nudges (sender_user_id, created_at desc);
alter table private.chore_nudges enable row level security;
alter table private.chore_nudges force row level security;
revoke all on private.chore_nudges from public, anon, authenticated;

create function public.nudge_task(p_task uuid) returns table (nudge_id uuid, recipient_user_id uuid, title text)
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_task public.tasks%rowtype;
  v_name text;
  v_nudge uuid;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select * into v_task from public.tasks t where t.id = p_task;
  if not found or not private.is_household_member(v_task.household_id) then
    raise exception 'task not found' using errcode = 'P0002';
  end if;
  if v_task.status <> 'open' then raise exception 'task is closed' using errcode = '22023'; end if;
  if v_task.assignee_user_id is null then raise exception 'task is not assigned' using errcode = '22023'; end if;
  if v_task.assignee_user_id = v_uid then raise exception 'cannot nudge yourself' using errcode = '22023'; end if;
  if not exists (
    select 1 from public.household_members m
    where m.household_id = v_task.household_id and m.user_id = v_task.assignee_user_id and m.status = 'active'
  ) then
    raise exception 'assignee is not an active member' using errcode = '22023';
  end if;

  -- Serialise per sender so concurrent calls cannot both pass the limits.
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 1));
  if exists (select 1 from private.chore_nudges n where n.task_id = p_task and n.created_at > now() - interval '30 minutes')
     or (select count(*) from private.chore_nudges n
         where n.sender_user_id = v_uid and n.created_at > now() - interval '24 hours') >= 20 then
    raise exception 'rate limit reached' using errcode = '42501';
  end if;

  select m.display_name into v_name from public.household_members m
  where m.household_id = v_task.household_id and m.user_id = v_uid;

  insert into private.chore_nudges (household_id, task_id, sender_user_id, recipient_user_id)
  values (v_task.household_id, p_task, v_uid, v_task.assignee_user_id)
  returning id into v_nudge;

  insert into public.notifications (household_id, recipient_user_id, kind, title, body, link, dedupe_key)
  values (v_task.household_id, v_task.assignee_user_id, 'chore_nudge',
          left(coalesce(v_name, 'Someone') || ' nudged you: ' || v_task.title, 120),
          null, '/tasks', 'nudge:' || v_nudge);

  return query select v_nudge, v_task.assignee_user_id, v_task.title;
end
$$;
revoke execute on function public.nudge_task(uuid) from public, anon;
grant execute on function public.nudge_task(uuid) to authenticated;

-- Push targets for a nudge the caller sent in the last 5 minutes (server-side use only).
create function public.nudge_push_targets(p_nudge uuid)
returns table (id uuid, endpoint text, p256dh text, auth text)
language plpgsql security definer
set search_path = ''
as $$
begin
  -- Single use: the first read within 5 minutes marks the nudge; later reads return nothing.
  -- Pushes still need the server's VAPID private key, so these values alone cannot push.
  update private.chore_nudges n set targets_read_at = now()
    where n.id = p_nudge
      and n.sender_user_id = (select auth.uid())
      and n.targets_read_at is null
      and n.created_at > now() - interval '5 minutes'
      and private.is_household_member(n.household_id);
  if not found then return; end if;
  return query
    select s.id, s.endpoint, s.p256dh, s.auth
    from private.chore_nudges n
    join public.push_subscriptions s on s.user_id = n.recipient_user_id and s.household_id = n.household_id
    where n.id = p_nudge;
end
$$;
revoke execute on function public.nudge_push_targets(uuid) from public, anon;
grant execute on function public.nudge_push_targets(uuid) to authenticated;

insert into supabase_migrations.schema_migrations (version, name) values
  ('20261026110000', 'chore_nudges')
on conflict do nothing;
commit;
