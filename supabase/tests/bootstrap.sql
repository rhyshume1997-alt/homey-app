-- TEST ONLY. Never applied to a real project and never placed in migrations.
-- Real Supabase already provides all of this: the anon/authenticated/service_role
-- roles, the auth schema (auth.users, auth.uid(), auth.jwt()), and the default
-- grants on the public schema. We emulate it so RLS can be tested on plain Postgres.

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

-- Login role used by the test harness; may SET ROLE to the API roles.
create role rls_tester login password 'rls_tester' noinherit;
grant anon, authenticated, service_role to rls_tester;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;

create table auth.users (
  id uuid primary key,
  email text,
  raw_app_meta_data jsonb
);

create function auth.uid() returns uuid
language sql stable
as $$
  select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
$$;

create function auth.jwt() returns jsonb
language sql stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;

grant execute on function auth.uid(), auth.jwt() to anon, authenticated, service_role;

-- Supabase default privileges: new public tables are fully granted to API roles.
-- Our migrations must defend against this.
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

-- Supabase ships pgcrypto in the "extensions" schema.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
grant usage on schema extensions to anon, authenticated, service_role;

-- TEST ONLY: minimal emulation of Supabase Storage. Real Supabase already has the
-- storage schema, buckets, objects and storage.foldername(); never put this in migrations.
create schema storage;
grant usage on schema storage to anon, authenticated, service_role;

create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);

create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text,
  owner uuid,
  created_at timestamptz not null default now(),
  unique (bucket_id, name)
);
alter table storage.objects enable row level security;

create function storage.foldername(name text) returns text[]
language plpgsql immutable
as $$
declare
  parts text[];
begin
  parts := string_to_array(name, '/');
  return parts[1:array_length(parts, 1) - 1];
end
$$;
grant execute on function storage.foldername(text) to anon, authenticated, service_role;

grant select on storage.buckets to authenticated;
grant select, insert, delete on storage.objects to authenticated;
