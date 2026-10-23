# Supabase schema

- `migrations/` holds timestamped, additive SQL migrations. The orchestrator applies them to the real
  Supabase project later (reviewed first; destructive changes need Alex's explicit approval).
  Subagents never apply migrations to a remote database.
- `tests/bootstrap.sql` is TEST ONLY. It emulates what Supabase already provides (roles `anon`,
  `authenticated`, `service_role`, the `auth` schema with `auth.uid()`/`auth.jwt()`, and default grants).
  Never apply it to a real project or move it into `migrations/`.

## Testing locally

`npm run test:rls` runs `scripts/db-test.sh`. It uses `DATABASE_URL` if set (CI), otherwise starts a
throwaway Postgres 16 cluster (as user `nobody` when run as root), applies bootstrap then all migrations,
runs `tests/rls/**` and cleans up. Set `PGBIN` if Postgres binaries are not in `/usr/lib/postgresql/16/bin`.
With `DATABASE_URL` the database must be empty and the user a superuser; the tests insert fixture rows.

## Allowlist (D15: Google sign-in, no MFA)

Only emails in `private.allowed_emails` can create an account. A trigger on `auth.users` rejects any
other email (and any change of email to one not listed) and creates the household membership on
first Google sign-in. Add a person via SQL:

```sql
insert into private.allowed_emails (email, household_id, role, display_name)
values (lower('person@example.com'), '<household uuid>', 'owner', 'Name');
```

- Never commit real rows or addresses (migrations, seeds, docs).
- Removing a row stops new sign-ups only. To remove access, delete the user in Supabase Auth.

## Testing against the real project

`npm run test:rls:remote` runs the same suite against the real project through the Management API
query endpoint (token injected by the network proxy). Each request replays the fixture inside one
DO block that always raises, so nothing persists; only identity sequence values advance.

## Notes

- Helper functions live in schema `private`, which is not exposed by the API.
- Table owner must have BYPASSRLS (Supabase `postgres` does) because tables use FORCE ROW LEVEL SECURITY
  and SECURITY DEFINER helpers read `household_members`.
- `audit_log` is append-only via triggers (UPDATE/DELETE/TRUNCATE raise); writes go through `public.log_audit`.
