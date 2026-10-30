# threepipe cloud

Accounts, access links for agents, uploads and the files host. [teenybase](https://github.com/teenybase/teenybase)
(`teenybase.ts`: users, auth, rules, admin panel, migrations) plus Hono routes (`src/`), on one Cloudflare Worker with
D1 and R2. Plan: `issues/open/threepipe-cloud-plan.md`.

## Run locally

```bash
cd services/cloud
npm install
cp .dev.vars.example .dev.vars
npm run migrate        # generate and apply migrations to the local D1
npm run dev            # http://localhost:8787 (Swagger /api/v1/doc/ui, admin /api/v1/pocket/)
npm test               # end-to-end: starts the dev server, runs every flow, stops it
npm run typecheck
```

Files are served under `/_files/` locally; set `FILES_HOST` (wrangler vars) for `files.threepipe.org`.

## API

| Route | Who | What |
|---|---|---|
| `/api/v1/table/users/auth/...` | anyone | sign-up / login (password, local) and GitHub sign-in (`/api/v1/table/users/auth/oauth/github`) |
| `POST /api/v1/access-links` `{name?}` | signed in | → `{id, name, url}`; the url is `/api/v1/access/<code>/agents.md` |
| `GET /api/v1/access/<code>/agents.md` | the link | instructions and the API for agents |
| `GET /api/v1/access/<code>/key` | the link | the user's JWT with `meta.link` (30 days); deleting the link revokes it |
| `POST /api/v1/table/access_links/delete` `{where}` | owner | revoke a link (teenybase) |
| `PUT /api/v1/uploads/<prefix>/<path>` | signed in / key | upload one file (body), max 90 MB → `{url, path, size, sha256, expires_at}` |
| `DELETE /api/v1/uploads/<prefix>/<path>` | owner (`s b p`), staff (all) | the path then answers 410 |
| `GET /api/v1/table/files/select` | owner | the user's files (teenybase) |

| Prefix | Lifetime | Overwrite | Path |
|---|---|---|---|
| `s` | 7 days, `?ttl=<days>` up to 30 | owner | `s/<slug>/…` |
| `a` | permanent | never (`x-content-sha256` required) | `a/<hash8>/<name>` |
| `b` | 30 days after the last upload to the build | owner | `b/<repo>/<pr or sha>/…` |
| `p` | permanent | owner | `p/<name>/…` |

The first segment (`b`: `<repo>/<ref>`) belongs to whoever uploads there first. Roles (`member`, `staff`, `admin`) are
set by an admin on `users.role`.

## How files are stored and served

- R2 key = the URL path. Owner, expiry and deletion are in the object's custom metadata, so serving is one R2 read
  and never touches D1 (`src/files.ts`). HTML and SVG get a `sandbox` CSP.
- `files` (D1) is the registry: listing, ownership checks, quotas, the daily expiry cron (`src/cron.ts`).
- Deleting writes a tombstone object at the path (410).
