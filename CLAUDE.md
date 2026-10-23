# Our Home

Private household management app for Alex and Sam. Not a public site.

Read first: `README.md` and `supabase/README.md`.

## Non-negotiables
- Deny by default. Every route and API is authorised server side. A hidden URL is not a control.
- Every table has `household_id` and RLS. No public sign-up: Google sign-in for allowlisted emails only (D15).
- Secrets stay server side (`src/server/**`, `import 'server-only'`). Only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` may be public.
- Documents live in private buckets and are served by short-lived signed URLs only.
- Never move money, store banking passwords, send email, contact companies or make purchases automatically.
- The AI assistant proposes; the server executes writes only with the required user confirmation.
- Do not fabricate household history, appliance states, stock levels or measured energy data.
- No destructive migrations without Alex's explicit approval. No production deploy without approval.

## Commands
- `npm run verify`: typecheck, lint, public-env check, unit tests, build, bundle secret scan. Must pass before handing work back.
- `npm run test:e2e`: Playwright against a production build.

## Working agreement
- Small, independently testable changes.
- Subagents never commit, push, merge, deploy or apply remote migrations. The orchestrator integrates.
- Stop after two failed attempts and report.
