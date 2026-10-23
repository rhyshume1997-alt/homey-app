# Our Home

A private household app. It is not a public product: every route except
`/login` and a few static/health endpoints is denied unless signed in
(deny-by-default, see `src/proxy.ts` and `src/server/auth/access.ts`).

## Run locally

Requires Node 22 (`nvm use`).

```bash
npm ci
cp .env.example .env.local   # fill in values when needed
npm run dev                  # http://localhost:3000
```

## Quality gates

```bash
npm run verify     # typecheck, lint, env check, unit tests, build, bundle scan
npm run test:e2e   # Playwright against `next start` (build first)
```

## Docs

Schema and RLS testing notes are in `supabase/README.md`. Homey's voice guide is in `docs/homey-voice.md`.
