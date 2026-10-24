-- Multi-household foundation: invites, creators, soft removal. ADDITIVE ONLY.
-- No table, column or row is dropped or rewritten. Existing memberships default to status 'active',
-- so the existing household keeps working with no data change. Functions are replaced with create or replace.
--
-- CONTRACT CHANGE (owner decision): household creation is OPEN. Any Google sign-in may create an auth
-- user and then its own fully isolated household (create_household), limited to 3 owned households per
-- person ('household limit reached'). There is no creators list and no allowlist/invite gate on sign-up.
-- Joining someone else's household is still only possible through an invite.
--
-- Removal model: remove_member / leave_household set household_members.status = 'removed' (the row is
-- kept so history attribution and display names survive). private.is_household_member() requires
-- status = 'active', so RLS, storage policies and signed-URL creation lose access immediately.
--
-- Per-user / per-household cleanup on removal (decided table by table):
--   push_subscriptions   DELETE that user's rows for the household (would keep pushing household data).
--   private.google_tokens DELETE the user's row if it is tied to that household (their Google link fed
--                        this household's email sync; they can reconnect in a household they belong to).
--   notification_reads   DELETE that user's read marks for this household's notifications (per-user
--                        state with no value once access is gone; recreated if they rejoin).
--   ai_digests           DELETE that user's digests for the household (private summaries of household data).
--   notifications        KEEP (household-level; recipient_user_id rows are unreachable via RLS once removed).
--   email_threads        KEEP (household-level metadata; the `member` column is only a display label).
--   kudos                KEEP (household history). New kudos require ACTIVE members on both sides.
--   ai_usage, ai_proposals KEEP (cost accounting and proposal history; user ids are attribution only).
--   tasks, snags, etc.   KEEP (household data; created_by/assignee ids are attribution only).
--   private.gmail_sync_runs KEEP (rate-limit stamp, no household data).
--   household_members    KEEP the row (status removed) for attribution. Re-inviting re-activates it.
--   audit_log            Every successful RPC below appends a row (never contains tokens or emails).
-- Known residual: a task may still name a removed person as assignee (guard_task only checks on change);
-- that exposes nothing because RLS hides the people list from the removed person.

-- OPERATOR CONTROLS (run in the Supabase SQL editor; no deploy needed, no client can touch them):
--   Pause new household creation:   update private.app_settings set household_creation_open = false, updated_at = now();
--   Re-open it:                     update private.app_settings set household_creation_open = true,  updated_at = now();
--   Usage monitoring (last 30 days): select * from private.usage_daily order by day desc limit 30;
-- Rate limits (server side, counted from data, 42501 'rate limit reached'): create_household max 3 per user
-- per rolling 24 h (audit_log 'household.created' by actor, so leaving or removing does not reset it);
-- create_invite max 20 per household per rolling 24 h. These are in addition to the 3-owned cap.
-- A paused switch raises 42501 'household creation is paused'.

-- 1. Membership status -------------------------------------------------------------------------
alter table public.household_members
  add column status text not null default 'active' check (status in ('active', 'removed')),
  add column removed_at timestamptz,
  add column removed_by uuid references auth.users (id) on delete set null;

create or replace function private.is_household_member(hh uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.household_members m
    where m.household_id = hh and m.user_id = (select auth.uid()) and m.status = 'active'
  )
$$;

create function private.is_household_owner(hh uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.household_members m
    where m.household_id = hh and m.user_id = (select auth.uid()) and m.status = 'active' and m.role = 'owner'
  )
$$;
revoke execute on function private.is_household_owner(uuid) from public, anon;
grant execute on function private.is_household_owner(uuid) to authenticated;

-- 3. Invites -------------------------------------------------------------------------------------
create table public.household_invites (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  email text not null check (email = lower(email) and length(email) between 3 and 254),
  role text not null default 'member' check (role = 'member'),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null,
  revoked_at timestamptz
);
create index household_invites_household_idx on public.household_invites (household_id, created_at desc);
create index household_invites_email_idx on public.household_invites (email);

alter table public.household_invites enable row level security;
alter table public.household_invites force row level security;
revoke all on public.household_invites from public, anon, authenticated;
-- Column grant: token_hash is deliberately absent, so no client can ever select it.
grant select (id, household_id, email, role, created_by, created_at, expires_at, accepted_at, accepted_by, revoked_at)
  on public.household_invites to authenticated;
create policy household_invites_select on public.household_invites for select to authenticated
  using (private.is_household_owner(household_id));

-- 3b. Operator kill switch + usage view (no client grants) -------------------------------------------
create table private.app_settings (
  id boolean primary key default true check (id),
  household_creation_open boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into private.app_settings (id) values (true);
alter table private.app_settings enable row level security;
alter table private.app_settings force row level security;
revoke all on private.app_settings from public, anon, authenticated;

create view private.usage_daily as
select (a.created_at at time zone 'UTC')::date as day,
       count(*) filter (where a.action = 'household.created')::integer as households_created,
       count(*) filter (where a.action = 'invite.created')::integer as invites_created,
       count(*) filter (where a.action = 'invite.accepted')::integer as invites_accepted,
       count(*) filter (where a.action = 'member.removed')::integer as members_removed
from public.audit_log a
where a.action in ('household.created', 'invite.created', 'invite.accepted', 'member.removed')
group by 1;
revoke all on private.usage_daily from public, anon, authenticated;

-- 4. RPCs ----------------------------------------------------------------------------------------
create function private.caller_email() returns text
language sql stable
set search_path = ''
as $$
  select lower(coalesce((select auth.jwt()) ->> 'email', ''))
$$;
revoke execute on function private.caller_email() from public, anon;
grant execute on function private.caller_email() to authenticated;

create function public.create_household(p_name text, p_display_name text) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_name text := btrim(coalesce(p_name, ''));
  v_dn text := btrim(coalesce(p_display_name, ''));
  v_id uuid;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if length(v_name) not between 1 and 100 then raise exception 'invalid household name' using errcode = '22023'; end if;
  if length(v_dn) not between 1 and 50 then raise exception 'invalid display name' using errcode = '22023'; end if;

  if not (select household_creation_open from private.app_settings where id) then
    raise exception 'household creation is paused' using errcode = '42501';
  end if;

  -- Abuse guard: serialise per user, then cap owned households and creations per rolling 24 h.
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 0));
  if (select count(*) from public.household_members m
      where m.user_id = v_uid and m.role = 'owner' and m.status = 'active') >= 3 then
    raise exception 'household limit reached' using errcode = '42501';
  end if;
  if (select count(*) from public.audit_log a
      where a.actor_user_id = v_uid and a.action = 'household.created'
        and a.created_at > now() - interval '24 hours') >= 3 then
    raise exception 'rate limit reached' using errcode = '42501';
  end if;

  insert into public.households (name) values (v_name) returning id into v_id;
  insert into public.household_members (household_id, user_id, role, display_name)
  values (v_id, v_uid, 'owner', v_dn);
  insert into public.audit_log (household_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_id, v_uid, 'household.created', 'household', v_id::text, 'Household created');
  return v_id;
end
$$;

create function public.create_invite(p_household uuid, p_email text) returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_token text;
  v_id uuid;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if p_household is null or not private.is_household_owner(p_household) then
    raise exception 'only a household owner can invite' using errcode = '42501';
  end if;
  if length(v_email) not between 3 and 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'invalid email' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.household_members m join auth.users u on u.id = m.user_id
    where m.household_id = p_household and m.status = 'active' and lower(u.email) = v_email
  ) then
    raise exception 'already a member' using errcode = '22023';
  end if;

  -- Serialise per household, then cap invites per rolling 24 h (revoked ones still count).
  perform pg_advisory_xact_lock(hashtextextended('invite:' || p_household::text, 0));
  if (select count(*) from public.household_invites i
      where i.household_id = p_household and i.created_at > now() - interval '24 hours') >= 20 then
    raise exception 'rate limit reached' using errcode = '42501';
  end if;

  update public.household_invites
    set revoked_at = now()
    where household_id = p_household and email = v_email and accepted_at is null and revoked_at is null;

  v_token := translate(rtrim(encode(extensions.gen_random_bytes(32), 'base64'), '='), '+/', '-_');
  insert into public.household_invites (household_id, email, token_hash, created_by)
  values (p_household, v_email, encode(extensions.digest(v_token, 'sha256'), 'hex'), v_uid)
  returning id into v_id;

  insert into public.audit_log (household_id, actor_user_id, action, entity_type, entity_id, summary)
  values (p_household, v_uid, 'invite.created', 'household_invite', v_id::text, 'Invite created');
  return v_token;
end
$$;

create function public.revoke_invite(p_invite uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_hh uuid;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select household_id into v_hh from public.household_invites where id = p_invite;
  if v_hh is null or not private.is_household_owner(v_hh) then
    raise exception 'only a household owner can revoke an invite' using errcode = '42501';
  end if;
  update public.household_invites set revoked_at = now()
    where id = p_invite and accepted_at is null and revoked_at is null;
  if not found then raise exception 'invite is not pending' using errcode = '22023'; end if;
  insert into public.audit_log (household_id, actor_user_id, action, entity_type, entity_id, summary)
  values (v_hh, v_uid, 'invite.revoked', 'household_invite', p_invite::text, 'Invite revoked');
end
$$;

create function public.accept_invite(p_token text, p_display_name text) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text := private.caller_email();
  v_dn text := btrim(coalesce(p_display_name, ''));
  i public.household_invites%rowtype;
  v_n integer;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if length(v_dn) not between 1 and 50 then raise exception 'invalid display name' using errcode = '22023'; end if;
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{20,100}$' then
    raise exception 'invite is not valid' using errcode = '22023';
  end if;

  -- Row lock: a concurrent second accept waits here, then sees accepted_at set.
  select * into i from public.household_invites
    where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    for update;
  if not found or i.accepted_at is not null or i.revoked_at is not null or i.expires_at <= now() then
    raise exception 'invite is not valid' using errcode = '22023';
  end if;
  if v_email = '' or v_email <> i.email then
    raise exception 'invite is not valid' using errcode = '42501';
  end if;

  insert into public.household_members (household_id, user_id, role, display_name)
  values (i.household_id, v_uid, i.role, v_dn)
  on conflict (household_id, user_id) do update
    set status = 'active', removed_at = null, removed_by = null, role = excluded.role,
        display_name = excluded.display_name
    where public.household_members.status = 'removed';
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'already a member' using errcode = '22023'; end if;

  update public.household_invites set accepted_at = now(), accepted_by = v_uid where id = i.id;
  insert into public.audit_log (household_id, actor_user_id, action, entity_type, entity_id, summary)
  values (i.household_id, v_uid, 'invite.accepted', 'household_invite', i.id::text, 'Invite accepted');
  return i.household_id;
end
$$;

-- Shared by remove_member and leave_household. Caller has already authorised the action.
create function private.deactivate_member(p_household uuid, p_user uuid, p_actor uuid, p_action text, p_summary text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_role text;
  v_owners integer;
begin
  -- Lock the active owner rows so two owners cannot remove each other concurrently.
  perform 1 from public.household_members
    where household_id = p_household and role = 'owner' and status = 'active' for update;
  select role into v_role from public.household_members
    where household_id = p_household and user_id = p_user and status = 'active';
  if v_role is null then raise exception 'not an active member' using errcode = '22023'; end if;
  if v_role = 'owner' then
    select count(*) into v_owners from public.household_members
      where household_id = p_household and role = 'owner' and status = 'active';
    if v_owners <= 1 then raise exception 'the last owner cannot leave or be removed' using errcode = '42501'; end if;
  end if;

  update public.household_members
    set status = 'removed', removed_at = now(), removed_by = p_actor
    where household_id = p_household and user_id = p_user;

  delete from public.push_subscriptions where household_id = p_household and user_id = p_user;
  delete from private.google_tokens where household_id = p_household and user_id = p_user;
  delete from public.notification_reads r using public.notifications n
    where r.notification_id = n.id and n.household_id = p_household and r.user_id = p_user;
  delete from public.ai_digests where household_id = p_household and user_id = p_user;

  insert into public.audit_log (household_id, actor_user_id, action, entity_type, entity_id, summary)
  values (p_household, p_actor, p_action, 'household_member', p_user::text, p_summary);
end
$$;
revoke execute on function private.deactivate_member(uuid, uuid, uuid, text, text) from public, anon, authenticated;

create function public.remove_member(p_household uuid, p_user uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if p_household is null or p_user is null or not private.is_household_owner(p_household) then
    raise exception 'only a household owner can remove a member' using errcode = '42501';
  end if;
  perform private.deactivate_member(p_household, p_user, v_uid, 'member.removed', 'Member removed');
end
$$;

create function public.leave_household(p_household uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if p_household is null or not private.is_household_member(p_household) then
    raise exception 'not a member of this household' using errcode = '42501';
  end if;
  perform private.deactivate_member(p_household, v_uid, v_uid, 'member.left', 'Member left');
end
$$;

revoke execute on function public.create_household(text, text) from public, anon;
revoke execute on function public.create_invite(uuid, text) from public, anon;
revoke execute on function public.revoke_invite(uuid) from public, anon;
revoke execute on function public.accept_invite(text, text) from public, anon;
revoke execute on function public.remove_member(uuid, uuid) from public, anon;
revoke execute on function public.leave_household(uuid) from public, anon;
grant execute on function public.create_household(text, text) to authenticated;
grant execute on function public.create_invite(uuid, text) to authenticated;
grant execute on function public.revoke_invite(uuid) to authenticated;
grant execute on function public.accept_invite(text, text) to authenticated;
grant execute on function public.remove_member(uuid, uuid) to authenticated;
grant execute on function public.leave_household(uuid) to authenticated;

-- 5. Sign-up gate ----------------------------------------------------------------------------------
-- Any Google sign-in may create an auth user. The legacy allowlist still creates its membership as
-- before. Everyone else gets NO membership here: they use create_household or accept_invite.
create or replace function private.on_auth_user_created() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  a private.allowed_emails%rowtype;
begin
  if coalesce(new.raw_app_meta_data ->> 'provider', '') <> 'google' then
    raise exception 'only Google sign-in is allowed' using errcode = '42501';
  end if;
  select * into a from private.allowed_emails where email = lower(coalesce(new.email, ''));
  if found then
    insert into public.household_members (household_id, user_id, role, display_name)
    values (a.household_id, new.id, a.role, a.display_name)
    on conflict do nothing;
  end if;
  return new;
end
$$;
revoke execute on function private.on_auth_user_created() from public, anon, authenticated;

-- 6. Existing definer paths that read household_members directly must ignore removed people ----
-- F2: both take an explicit household. The old signatures are dropped so nobody can call them.
--   public.sync_my_email_threads(p_household uuid, p_member text, p_threads jsonb) returns integer
--   public.store_my_google_token(p_household uuid, p_ciphertext text, p_scopes text) returns void
-- The caller must be an ACTIVE member of p_household; p_member must equal their display name there.
drop function public.sync_my_email_threads(text, jsonb);
drop function public.store_my_google_token(text, text);

create function public.sync_my_email_threads(p_household uuid, p_member text, p_threads jsonb) returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_name text;
  v_n integer;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if p_household is null or not private.is_household_member(p_household) then
    raise exception 'not a member' using errcode = '42501';
  end if;
  select display_name into v_name from public.household_members
    where household_id = p_household and user_id = v_uid and status = 'active';
  if p_member is distinct from v_name then raise exception 'member mismatch' using errcode = '42501'; end if;
  -- Gmail metadata only ever goes into the household where this person connected Google
  -- (consent is given there). Viewing another household never syncs into it.
  if not exists (select 1 from private.google_tokens t where t.user_id = v_uid and t.household_id = p_household) then
    raise exception 'google connected to another household' using errcode = '42501';
  end if;
  v_n := private.apply_email_threads(p_household, jsonb_build_object('member', p_member, 'threads', p_threads));
  insert into private.gmail_sync_runs (user_id, ran_at) values (v_uid, now())
    on conflict (user_id) do update set ran_at = now();
  return v_n;
end
$$;

create function public.store_my_google_token(p_household uuid, p_ciphertext text, p_scopes text) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if p_household is null or not private.is_household_member(p_household) then
    raise exception 'not a member' using errcode = '42501';
  end if;
  if p_ciphertext is null or char_length(p_ciphertext) not between 1 and 4000 or p_ciphertext !~ '^v1:'
     or p_scopes is null or char_length(p_scopes) > 1000 then
    raise exception 'invalid token' using errcode = '22023';
  end if;
  insert into private.google_tokens (user_id, household_id, ciphertext, scopes)
  values (v_uid, p_household, p_ciphertext, p_scopes)
  on conflict (user_id) do update set
    household_id = excluded.household_id, ciphertext = excluded.ciphertext,
    scopes = excluded.scopes, updated_at = now();
  insert into public.audit_log (household_id, actor_user_id, action, entity_type, entity_id, summary)
  values (p_household, v_uid, 'google.connected', 'google_token', v_uid::text, 'Google connected (read-only)');
end
$$;

revoke execute on function public.sync_my_email_threads(uuid, text, jsonb) from public, anon;
grant execute on function public.sync_my_email_threads(uuid, text, jsonb) to authenticated;
revoke execute on function public.store_my_google_token(uuid, text, text) from public, anon;
grant execute on function public.store_my_google_token(uuid, text, text) to authenticated;

-- F3: guards that validate a user as a household member must require status = 'active'.
create or replace function private.guard_task() returns trigger
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
       where m.household_id = new.household_id and m.user_id = new.assignee_user_id and m.status = 'active'
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

-- Same as 20261024090000_rooms spawn_next_task, but a removed assignee is dropped from the next occurrence.
create or replace function private.spawn_next_task() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_next uuid;
  v_base date;
begin
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
      case when exists (
        select 1 from public.household_members m
        where m.household_id = new.household_id and m.user_id = new.assignee_user_id and m.status = 'active'
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

  for v_hh in select m.household_id from public.household_members m where m.user_id = v_uid and m.status = 'active' loop
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

-- Kudos: both people must be ACTIVE members.
create or replace function private.guard_kudos() returns trigger
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
    select 1 from public.household_members m
    where m.household_id = new.household_id and m.user_id = new.from_user and m.status = 'active'
  ) or not exists (
    select 1 from public.household_members m
    where m.household_id = new.household_id and m.user_id = new.to_user and m.status = 'active'
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

drop policy kudos_insert on public.kudos;
create policy kudos_insert on public.kudos for insert to authenticated
  with check (
    private.is_household_member(household_id)
    and from_user = (select auth.uid())
    and to_user <> (select auth.uid())
    and exists (
      select 1 from public.household_members m
      where m.household_id = kudos.household_id and m.user_id = kudos.to_user and m.status = 'active'
    )
  );
