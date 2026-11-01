# AGENTS.md

<!-- teenybase -->
## Backend: teenybase

The backend is defined in `teenybase.ts` (tables, fields, auth, access rules, actions) and runs on Cloudflare Workers + D1 through the teenybase CLI. Run it as `npx teenybase <command>`, never `npx teeny` (an unrelated npm package).

- `npx teenybase deploy --local --yes`: after every change to `teenybase.ts`, generates the migrations and applies them to the local database.
- `npx teenybase dev`: local server at http://localhost:8787 (Swagger UI at `/api/v1/doc/ui`, admin panel at `/api/v1/pocket/`). It reloads after each `deploy --local`.
- `npx wrangler login` (once, by the user), then `npx teenybase deploy --remote --yes`: deploys to the user's Cloudflare account. Without an account: `npx teenybase deploy --temporary --yes` (give the user the claim URL privately; it must be claimed within 60 minutes).
- `npx teenybase secrets --remote --upload`: uploads `.prod.vars` after editing it.
- Run `wrangler` directly only for `login`, `whoami` and `tail`. Deploys, migrations, the dev server and secrets go through `npx teenybase`.

Rules:

- Never write or edit files in `migrations/`: they are generated from `teenybase.ts`.
- Every table needs a `rules` extension or `public: true`. An omitted rule denies access.
- In an `updateRule`, stop a column from changing with `new.<col> == <col>` (`==`, not `=`).
- Only admins can write `role`, `email_verified` and `password_salt`. Sign-up needs `passwordConfirm` when the auth extension sets `passwordConfirmSuffix` (the with-auth template does).
- Quote user input in `where` expressions with `JSON.stringify(value)`.
- `RESPOND_WITH_ERRORS=true` goes in `.dev.vars` only, never in `.prod.vars`.

Docs for the installed version: `node_modules/teenybase/docs/` (`npx teenybase docs` lists them) and https://teenybase.com/docs. Agent skills: `node_modules/teenybase/plugin/skills/` (`npx teenybase skills`); start with `teenybase/SKILL.md`.
<!-- /teenybase -->

## This service

Three npm scripts run `wrangler` for what teenybase has no command for. Run them through npm, not wrangler by hand:

- `npm run cf-typegen` (`wrangler types`, also part of `npm run typecheck`)
- `npm run init-infra` (`wrangler r2 bucket info/create` for the buckets in `wrangler.jsonc`)
- `npm test` (`scripts/e2e.sh`: fixtures go through teenybase's admin API; one, a Google sign-up's empty `handle_set`, which no API can clear, uses `wrangler d1 execute --local`)
