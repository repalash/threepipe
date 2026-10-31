# threepipe cloud

Accounts, access links for agents, uploads and the files host. [teenybase](https://github.com/teenybase/teenybase)
(`teenybase.ts`: users, auth, rules, admin panel, migrations) plus Hono routes (`src/`), on one Cloudflare Worker with
D1 and R2.

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
| `GET /api/v1/uploads/d/<path>` | owner / app key | read a drive file |
| `PATCH /api/v1/uploads/d/<path>` `{visibility?, move_to?}` | owner / app key | publish (`public`) or hide (`private`), move |
| `GET /api/v1/drive?folder=d/<handle>/…/` | owner / app key | list drive files |
| `POST /api/v1/drive/sign` `{path, ttl?}` | owner / app key | signed URL for a file or a folder (`…/`), 1 h default, 7 days max |
| `POST /api/v1/drive-links` `{path}`, `DELETE /api/v1/drive-links/<id>` | owner / app key | share link `files…/f/<id>/…` |
| `GET /api/v1/connect?return=<app url>` | browser | "Sign in with threepipe" for apps (below) |
| `PUT /api/v1/buckets/<samples\|e2e>/<path>` + `x-content-sha256` | staff | write-once upload to the samples / e2e snapshot bucket (R2 serves them on `SAMPLES_URL` / `E2E_URL`); e2e paths are `blobs/<sha256><ext>` |
| `POST /api/v1/buckets/<samples\|e2e>/missing` `{paths}` | staff | which of up to 500 paths are not there yet |

| Prefix | Lifetime | Overwrite | Path |
|---|---|---|---|
| `s` | 7 days, `?ttl=<days>` up to 30 | owner | `s/<slug>/…` |
| `a` | permanent | never (`x-content-sha256` required) | `a/<hash8>/<name>` |
| `b` | 30 days after the last upload to the build | owner | `b/<repo>/<pr or sha>/…` |
| `p` | permanent | owner | `p/<name>/…` |
| `d` | permanent, quota (1 GB members, 50 GB staff) | owner | `d/<handle>/…`, private unless `?visibility=public` |

The first segment (`b`: `<repo>/<ref>`) belongs to whoever uploads there first; `d/<handle>` belongs to the user with
that username (it can't be changed). Roles (`member`, `staff`, `admin`) are set by an admin on `users.role`.

## Uploading from the repository

`npm run cloud:upload -- <file or folder> <remote path>` and, for a pull request, `npm run cloud:upload-build -- pr-<n>`
(after `npm run build:all`: `dist/`, `examples/`, `plugins/*/dist/` to `b/threepipe/pr-<n>/`, link printed). Key:
`TP_CLOUD_KEY` from the environment or `/tmp/.env`; API: `TP_CLOUD_API`. See `scripts/cloud-upload.mjs`.

## Sign in with threepipe (apps)

An app served from the files host (`p/<name>/`, `d/<handle>/<app>/`, `b/…`, `s/…`) or from `localhost:<port>` while it
is developed can save to the user's drive. There is nothing to register: the app is identified by where it is served from.

1. The app sends the user to `/api/v1/connect?return=<its page url>` (`&access=drive` asks for the whole drive).
2. Signed out: the page offers GitHub sign-in. The first time: a consent page names the app, who serves it, and the folder.
3. On Allow, the user comes back to `<return>#tp_cloud_key=…&tp_cloud_user=…&tp_cloud_folder=…&tp_cloud_api=…`.
   Once allowed, step 1 redirects straight back with a new key (no screen).
4. The key (24 h) works only on the drive routes, inside `d/<user>/apps/<app owner>/<app path>/` (or all of `d/<user>/`). The grant is
   an `access_links` row; deleting it revokes the app.

Pages on the files host run sandboxed (no cookies or storage), so the app gets the key again on each load:

```js
const p = new URLSearchParams(location.hash.slice(1))
const key = p.get('tp_cloud_key')
if (key || p.get('tp_cloud_error')) history.replaceState(null, '', location.pathname + location.search)
else location.href = 'https://cloud.threepipe.org/api/v1/connect?return=' + encodeURIComponent(location.href)
// then: fetch(`${p.get('tp_cloud_api')}/api/v1/uploads/${p.get('tp_cloud_folder')}scene.glb`, {method: 'PUT', headers: {Authorization: 'Bearer ' + key}, body})
```

## How files are stored and served

- R2 key = the URL path. Owner, expiry, deletion and visibility are in the object's custom metadata, so serving is one
  R2 read and never touches D1 (`src/files.ts`). HTML and SVG get a `sandbox` CSP.
- Drive: private files are served only through a signed URL `files…/t/<exp>.<depth>.<hmac>/d/…` (checked with
  `FILES_URL_SECRET`, no lookup) or a share link `files…/f/<id>/…` (a pointer object `f/<id>` in R2, then the file).
- `files` (D1) is the registry: listing, ownership checks, quotas, the daily expiry cron (`src/cron.ts`).
- Deleting writes a tombstone object at the path (410). The owner's own drive files are deleted for real.
- Requests with the session cookie that change something must come from the API's own origin (CSRF; `src/auth.ts`).
  Access and app keys are checked against their link on every route, teenybase's included; app keys can only use the drive.
