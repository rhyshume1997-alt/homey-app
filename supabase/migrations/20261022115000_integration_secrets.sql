-- Shared verification for signed ingest (Apps Script -> Our Home). Additive.
-- Secrets are set by hand via SQL (never committed). Each secret is bound to one household.

create table private.integration_secrets (
  name text primary key check (name ~ '^[a-z][a-z0-9_]{1,40}$'),
  household_id uuid not null references public.households (id) on delete cascade,
  secret text not null check (length(secret) >= 32),
  created_at timestamptz not null default now()
);
alter table private.integration_secrets enable row level security;
alter table private.integration_secrets force row level security;
revoke all on private.integration_secrets from public, anon, authenticated;

-- Each signature is accepted once (replay protection); rows older than a day can be pruned.
create table private.used_signatures (
  sig text primary key,
  used_at timestamptz not null default now()
);
alter table private.used_signatures enable row level security;
alter table private.used_signatures force row level security;
revoke all on private.used_signatures from public, anon, authenticated;

/**
 * Verifies hex HMAC-SHA256 over "<ts>.<body>" with the named secret, within 5 minutes,
 * once only. Returns the household the secret belongs to, or raises 42501.
 * Called only from SECURITY DEFINER ingest functions; nobody else may execute it.
 */
create function private.verify_signed(p_name text, p_ts bigint, p_body text, p_sig text) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  s private.integration_secrets%rowtype;
  expected text;
begin
  if p_name is null or p_ts is null or p_body is null or p_sig is null then
    raise exception 'bad signature' using errcode = '42501';
  end if;
  if abs(extract(epoch from now())::bigint - p_ts) > 300 then
    raise exception 'stale request' using errcode = '42501';
  end if;
  select * into s from private.integration_secrets where name = p_name;
  if not found then
    raise exception 'bad signature' using errcode = '42501';
  end if;
  expected := encode(extensions.hmac(p_ts::text || '.' || p_body, s.secret, 'sha256'), 'hex');
  -- Compare digests rather than the raw strings so the comparison does not leak a matching prefix.
  if extensions.digest(lower(p_sig), 'sha256') <> extensions.digest(expected, 'sha256') then
    raise exception 'bad signature' using errcode = '42501';
  end if;
  begin
    insert into private.used_signatures (sig) values (expected);
  exception when unique_violation then
    raise exception 'replayed request' using errcode = '42501';
  end;
  return s.household_id;
end
$$;
revoke execute on function private.verify_signed(text, bigint, text, text) from public, anon, authenticated;
