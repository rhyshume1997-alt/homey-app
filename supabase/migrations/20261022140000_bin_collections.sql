-- Bin collections pushed by Alex's Apps Script (signed ingest). Additive only.
-- Users can read their household's rows; only the signed ingest function writes.

create table public.bin_collections (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  collection_date date not null,
  bin_name text not null check (char_length(bin_name) between 1 and 120),
  source text not null default 'council' check (char_length(source) between 1 and 40),
  received_at timestamptz not null default now(),
  constraint bin_collections_unique unique (household_id, collection_date, bin_name)
);
create index bin_collections_household_date_idx on public.bin_collections (household_id, collection_date);

alter table public.bin_collections enable row level security;
alter table public.bin_collections force row level security;
revoke all on public.bin_collections from public, anon, authenticated;
grant select on public.bin_collections to authenticated;

create policy bin_collections_select on public.bin_collections for select to authenticated
  using (private.is_household_member(household_id));

/**
 * Signed ingest. Verifies the HMAC (secret name 'bins'), validates the payload, upserts the
 * collections and removes this household's future rows the council no longer lists.
 * Raises 42501 for signature problems and 22023 for a bad payload.
 */
create function public.ingest_bin_collections(p_ts bigint, p_body text, p_sig text) returns int
language plpgsql security definer
set search_path = ''
as $$
declare
  v_household uuid;
  v_json jsonb;
  v_items jsonb;
  v_item jsonb;
  v_dates date[] := '{}';
  v_names text[] := '{}';
  v_date date;
  v_name text;
  v_today date := (now() at time zone 'Europe/London')::date;
  v_count int;
begin
  if p_body is null or octet_length(p_body) > 65536 then
    raise exception 'payload too large' using errcode = '22023';
  end if;
  v_household := private.verify_signed('bins', p_ts, p_body, p_sig);

  begin
    v_json := p_body::jsonb;
  exception when others then
    raise exception 'invalid payload' using errcode = '22023';
  end;
  if coalesce(jsonb_typeof(v_json), '') <> 'object' or coalesce(jsonb_typeof(v_json -> 'collections'), '') <> 'array' then
    raise exception 'invalid payload' using errcode = '22023';
  end if;
  v_items := v_json -> 'collections';
  if jsonb_array_length(v_items) < 1 or jsonb_array_length(v_items) > 200 then
    raise exception 'invalid payload' using errcode = '22023';
  end if;

  for v_item in select * from jsonb_array_elements(v_items) loop
    if coalesce(jsonb_typeof(v_item), '') <> 'object'
       or coalesce(jsonb_typeof(v_item -> 'date'), '') <> 'string'
       or coalesce(jsonb_typeof(v_item -> 'bin'), '') <> 'string'
       or (v_item ->> 'date') !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception 'invalid payload' using errcode = '22023';
    end if;
    begin
      v_date := (v_item ->> 'date')::date;
    exception when others then
      raise exception 'invalid payload' using errcode = '22023';
    end;
    v_name := btrim(v_item ->> 'bin');
    if v_date < v_today - 7 or v_date > v_today + 400 or char_length(v_name) not between 1 and 120 then
      raise exception 'invalid payload' using errcode = '22023';
    end if;
    v_dates := v_dates || v_date;
    v_names := v_names || v_name;
  end loop;

  insert into public.bin_collections (household_id, collection_date, bin_name)
  select distinct v_household, d, n from unnest(v_dates, v_names) as t(d, n)
  on conflict (household_id, collection_date, bin_name) do nothing;

  delete from public.bin_collections b
  where b.household_id = v_household
    and b.collection_date >= v_today
    and not exists (
      select 1 from unnest(v_dates, v_names) as t(d, n)
      where t.d = b.collection_date and t.n = b.bin_name
    );

  select count(*) into v_count from (select distinct d, n from unnest(v_dates, v_names) as t(d, n)) x;

  insert into public.audit_log (household_id, actor_user_id, action, entity_type, summary)
  values (v_household, null, 'bins.synced', 'bin_collections', v_count || ' collections');

  return v_count;
end
$$;
revoke execute on function public.ingest_bin_collections(bigint, text, text) from public, anon, authenticated;
grant execute on function public.ingest_bin_collections(bigint, text, text) to anon;
