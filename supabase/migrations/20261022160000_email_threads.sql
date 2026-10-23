-- Awaiting company replies: filtered Gmail thread METADATA only (never bodies, never addresses).
-- Written solely through private.apply_email_threads, reached by public.ingest_email_threads (signed
-- Apps Script request, fallback) and public.sync_my_email_threads (a signed-in member's own Gmail sync, D17). Additive.

create table public.email_threads (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  thread_hash text not null check (thread_hash ~ '^[0-9a-f]{64}$'),
  member text not null check (char_length(member) between 1 and 50),
  subject text not null check (char_length(subject) <= 150),
  counterpart_domain text not null check (
    char_length(counterpart_domain) <= 120
    and counterpart_domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
  ),
  last_message_at timestamptz not null,
  last_from text not null check (last_from in ('me', 'them')),
  labelled boolean not null default false,
  status text not null default 'awaiting' check (status in ('awaiting', 'replied', 'closed')),
  updated_at timestamptz not null default now(),
  constraint email_threads_hash_unique unique (household_id, thread_hash)
);
create index email_threads_status_idx on public.email_threads (household_id, status, last_message_at);

alter table public.email_threads enable row level security;
alter table public.email_threads force row level security;

revoke all on public.email_threads from anon, authenticated;
grant select on public.email_threads to authenticated;
grant update (status) on public.email_threads to authenticated;

create policy email_threads_select on public.email_threads for select to authenticated
  using (private.is_household_member(household_id));
create policy email_threads_update on public.email_threads for update to authenticated
  using (private.is_household_member(household_id))
  with check (private.is_household_member(household_id));

-- Keeps updated_at honest on member status changes.
create function private.touch_email_thread() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end
$$;
create trigger a_touch_email_thread before update on public.email_threads
  for each row execute function private.touch_email_thread();
revoke execute on function private.touch_email_thread() from public, anon, authenticated;

-- Audit manual status changes (domain only, never the subject).
create function private.audit_email_thread_status() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status and (select auth.uid()) is not null then
    insert into public.audit_log (household_id, actor_user_id, action, entity_type, entity_id, summary)
    values (new.household_id, (select auth.uid()), 'email.status_changed', 'email_thread', new.id::text,
            left(new.counterpart_domain || ': ' || old.status || ' -> ' || new.status, 500));
  end if;
  return null;
end
$$;
create trigger audit_email_thread_status after update on public.email_threads
  for each row execute function private.audit_email_thread_status();
revoke execute on function private.audit_email_thread_status() from public, anon, authenticated;

/**
 * Shared validation + upsert. Payload: {"member": text, "threads": [{thread_hash, subject,
 * counterpart_domain, last_message_at, last_from, label_flag}]}, at most 50 threads, nothing else allowed.
 * Raises 22023 for any malformed payload. Not callable by API roles; only the two entry points below.
 */
create function private.apply_email_threads(p_household uuid, p_payload jsonb) returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  v_doc jsonb := p_payload;
  v_member text;
  v_threads jsonb;
  t jsonb;
  k text;
  v_at timestamptz;
  v_n integer := 0;
  v_changed integer := 0;
  v_prev text;
  v_new text;
  v_exists boolean;
begin
  if p_household is null or v_doc is null or jsonb_typeof(v_doc) <> 'object' then
    raise exception 'invalid payload' using errcode = '22023';
  end if;
  for k in select jsonb_object_keys(v_doc) loop
    if k not in ('member', 'threads') then raise exception 'invalid payload' using errcode = '22023'; end if;
  end loop;
  if jsonb_typeof(v_doc -> 'member') is distinct from 'string' then raise exception 'invalid payload' using errcode = '22023'; end if;
  v_member := v_doc ->> 'member';
  if char_length(v_member) not between 1 and 50 or v_member ~ '[[:cntrl:]@]' then
    raise exception 'invalid payload' using errcode = '22023';
  end if;
  v_threads := v_doc -> 'threads';
  if jsonb_typeof(v_threads) is distinct from 'array' or jsonb_array_length(v_threads) > 50 then
    raise exception 'invalid payload' using errcode = '22023';
  end if;

  for t in select * from jsonb_array_elements(v_threads) loop
    if jsonb_typeof(t) <> 'object' then raise exception 'invalid payload' using errcode = '22023'; end if;
    for k in select jsonb_object_keys(t) loop
      if k not in ('thread_hash', 'subject', 'counterpart_domain', 'last_message_at', 'last_from', 'label_flag') then
        raise exception 'invalid payload' using errcode = '22023';
      end if;
    end loop;
    if jsonb_typeof(t -> 'thread_hash') is distinct from 'string'
       or jsonb_typeof(t -> 'subject') is distinct from 'string'
       or jsonb_typeof(t -> 'counterpart_domain') is distinct from 'string'
       or jsonb_typeof(t -> 'last_message_at') is distinct from 'string'
       or jsonb_typeof(t -> 'last_from') is distinct from 'string'
       or jsonb_typeof(t -> 'label_flag') is distinct from 'boolean' then
      raise exception 'invalid payload' using errcode = '22023';
    end if;
    if (t ->> 'thread_hash') !~ '^[0-9a-f]{64}$'
       or char_length(t ->> 'subject') > 150
       or char_length(t ->> 'counterpart_domain') > 120
       or (t ->> 'counterpart_domain') !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
       or (t ->> 'last_message_at') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$'
       or (t ->> 'last_from') not in ('me', 'them') then
      raise exception 'invalid payload' using errcode = '22023';
    end if;
    begin
      v_at := (t ->> 'last_message_at')::timestamptz;
    exception when others then
      raise exception 'invalid payload' using errcode = '22023';
    end;

    select status into v_prev from public.email_threads
      where household_id = p_household and thread_hash = t ->> 'thread_hash';
    v_exists := found;
    if not v_exists then
      v_new := 'awaiting';
    elsif v_prev = 'closed' then
      v_new := 'closed';
    elsif t ->> 'last_from' = 'them' then
      v_new := 'replied';
    else
      v_new := 'awaiting';
    end if;

    insert into public.email_threads
      (household_id, thread_hash, member, subject, counterpart_domain, last_message_at, last_from, labelled, status)
    values
      (p_household, t ->> 'thread_hash', v_member, t ->> 'subject', t ->> 'counterpart_domain', v_at,
       t ->> 'last_from', (t -> 'label_flag')::boolean, 'awaiting')
    on conflict (household_id, thread_hash) do update set
      member = excluded.member, subject = excluded.subject, counterpart_domain = excluded.counterpart_domain,
      last_message_at = excluded.last_message_at, last_from = excluded.last_from, labelled = excluded.labelled,
      status = v_new, updated_at = now()
      -- A member can only refresh their own threads, never rewrite the other person's rows.
      where public.email_threads.member = excluded.member;
    v_n := v_n + 1;
    if not v_exists or v_prev is distinct from v_new then v_changed := v_changed + 1; end if;
  end loop;

  if v_changed > 0 then
    insert into public.audit_log (household_id, actor_user_id, action, entity_type, summary)
    values (p_household, (select auth.uid()), 'email.synced', 'email_thread',
            left(v_member || ': ' || v_n || ' threads, ' || v_changed || ' new or changed', 500));
  end if;
  return v_n;
end
$$;
revoke execute on function private.apply_email_threads(uuid, jsonb) from public, anon, authenticated;

/** Signed ingest (Apps Script relay, optional fallback). Raises 42501 for a bad/stale/replayed signature. */
create function public.ingest_email_threads(p_ts bigint, p_body text, p_sig text) returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  v_household uuid;
  v_doc jsonb;
begin
  if p_body is null or octet_length(p_body) > 65536 then
    raise exception 'payload too large' using errcode = '22023';
  end if;
  v_household := private.verify_signed('gmail', p_ts, p_body, p_sig);
  begin
    v_doc := p_body::jsonb;
  exception when others then
    raise exception 'invalid payload' using errcode = '22023';
  end;
  return private.apply_email_threads(v_household, v_doc);
end
$$;
revoke execute on function public.ingest_email_threads(bigint, text, text) from public, authenticated;
grant execute on function public.ingest_email_threads(bigint, text, text) to anon;

-- Last Gmail sync per person (for the "at most every 10 minutes" rule). No grants.
create table private.gmail_sync_runs (
  user_id uuid primary key references auth.users (id) on delete cascade,
  ran_at timestamptz not null default now()
);
alter table private.gmail_sync_runs enable row level security;
alter table private.gmail_sync_runs force row level security;
revoke all on private.gmail_sync_runs from public, anon, authenticated;

/**
 * A signed-in member syncs their OWN Gmail metadata (built server side from their own Google token).
 * The household comes from the caller's membership; p_member must equal the caller's display name.
 */
create function public.sync_my_email_threads(p_member text, p_threads jsonb) returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_household uuid;
  v_name text;
  v_n integer;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select household_id, display_name into v_household, v_name
    from public.household_members where user_id = v_uid order by created_at limit 1;
  if v_household is null then raise exception 'not a member' using errcode = '42501'; end if;
  if p_member is distinct from v_name then raise exception 'member mismatch' using errcode = '42501'; end if;
  v_n := private.apply_email_threads(v_household, jsonb_build_object('member', p_member, 'threads', p_threads));
  insert into private.gmail_sync_runs (user_id, ran_at) values (v_uid, now())
    on conflict (user_id) do update set ran_at = now();
  return v_n;
end
$$;
revoke execute on function public.sync_my_email_threads(text, jsonb) from public, anon;
grant execute on function public.sync_my_email_threads(text, jsonb) to authenticated;

/** When the caller last synced Gmail, or null. */
create function public.my_gmail_sync_at() returns timestamptz
language sql stable security definer
set search_path = ''
as $$
  select ran_at from private.gmail_sync_runs where user_id = (select auth.uid())
$$;
revoke execute on function public.my_gmail_sync_at() from public, anon;
grant execute on function public.my_gmail_sync_at() to authenticated;
