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
Without a GitHub OAuth app, sign in at `/login` with any username and password (`DEV_LOGIN=true` in `.dev.vars`, local
only; a new username is signed up on the first try). teenybase's password routes (sign-up, login, change and reset
password) answer 404 without DEV_LOGIN: a password account with someone's email would be signed in to by their Google
or GitHub sign-in.

## Sign-in

- GitHub (`GITHUB_CLIENT_ID`/`_SECRET`) and Google (`GOOGLE_CLIENT_ID`/`_SECRET`; the Google button shows only when it is
  set). OAuth callback URLs: `https://cloud.threepipe.org/api/v1/table/users/auth/oauth/<github|google>/callback`.
  A Google sign-in with the email of an existing account signs in to that account.
- The handle (`users.username`, in every `d/<handle>/` URL) never changes. GitHub gives the login; a new Google account
  has none, so it picks one on its first visit ("Choose your handle", `POST /api/v1/handle`); until then every route but
  `/api/v1/me` answers 403 `{handle: true}` (`src/handle.ts`).
- Not Cloudflare yet: its profile has no email-verified flag, and accounts are linked by email.

## API

| Route | Who | What |
|---|---|---|
| `/api/v1/table/users/auth/...` | anyone | sign-up / login (password, local), GitHub and Google sign-in (`/api/v1/table/users/auth/oauth/<github\|google>`) |
| `GET /api/v1/sign-in-options`, `POST /api/v1/handle` `{handle}` | anyone / a new Google account | the sign-in buttons; pick the handle once |
| `POST /api/v1/access-links` `{name?}` | signed in | → `{id, name, url}`; the url is `/api/v1/access/<code>/agents.md` |
| `GET /api/v1/access/<code>/agents.md` | the link | instructions and the API for agents |
| `GET /api/v1/access/<code>/key` | the link | the user's JWT with `meta.link` (30 days); deleting the link revokes it |
| `GET /api/v1/access-links`, `DELETE /api/v1/access-links/<id>` | signed in (not with a key) | your agents' links and connected apps; revoke one (its keys stop at once). teenybase's `/api/v1/table/access_links/…` works too |
| `PUT /api/v1/uploads/<prefix>/<path>` | signed in / key | upload one file (body), max 90 MB → `{url, path, size, sha256, expires_at}` |
| `DELETE /api/v1/uploads/<prefix>/<path>` | owner (`s b p`), staff (all) | the path then answers 410 |
| `GET /api/v1/table/files/select` | owner | the user's files (teenybase) |
| `GET /api/v1/drive?folder=<id>`, `GET /api/v1/drive/resolve?path=/a/b` | owner / app key | list a folder, find by path |
| `POST/PATCH/DELETE /api/v1/drive/folders[/<id>]` | owner / app key | folders (labels with fixed ids) |
| `PUT /api/v1/drive/files?folder=&name=` | owner / app key | save a file: a new item |
| `POST /api/v1/drive/items`, `PUT /api/v1/drive/items/<id>/<path>` | owner / app key | a folder item (gltf + bin + textures), file by file |
| `GET/PATCH/DELETE /api/v1/drive/items/<id>` `{name?, folder?, visibility?}` | owner / app key | read, rename, move, share (`link`) or hide (`private`), delete |
| `POST /api/v1/drive/items/<id>/sign` `{ttl?}`, `…/new-id` | owner / app key | signed URL of the whole item; a new id (old URLs stop working) |
| `/drive`, `/reports`, `/account` | browser | the drive, reports (with project settings) and Apps & keys pages (one look, `src/page/ui.css`: the clean mode of the tweakpane plugin, light and dark) |
| `GET /api/v1/me` | signed in (not app keys) | handle, name, role, drive use and quota (the pages' side bar) |
| `GET /api/v1/connect?return=<app url>` | browser | "Sign in with threepipe" for apps (below) |
| `PUT /api/v1/buckets/<samples\|e2e>/<path>` + `x-content-sha256` | staff | write-once upload to the samples / e2e snapshot bucket (R2 serves them on `SAMPLES_URL` / `E2E_URL`); e2e paths are `blobs/<sha256><ext>` |
| `POST /api/v1/buckets/<samples\|e2e>/missing` `{paths}` | staff | which of up to 500 paths are not there yet |

| Prefix | Lifetime | Overwrite | Path |
|---|---|---|---|
| `s` | 7 days, `?ttl=<days>` up to 30 | owner | `s/<slug>/…` |
| `a` | permanent | never (`x-content-sha256` required) | `a/<hash8>/<name>` |
| `b` | 30 days after the last upload to the build | owner | `b/<repo>/<pr or sha>/…` |
| `p` | permanent | owner | `p/<name>/…` |

The first segment (`b`: `<repo>/<ref>`) belongs to whoever uploads there first; `d/<handle>` belongs to the user with
that username (it can't be changed). Roles (`member`, `staff`, `admin`) are set by an admin on `users.role`.

## Projects and reports

Report a Problem / feedback for any threepipe app (`src/projects.ts`, `src/reports.ts`). Any member creates up
to 5 projects (slugs starting with `threepipe` are for staff) and adds members as `reader` or `manager`. Members read the
reports on `/reports` (signed in) or through the API.

| Route | Who | What |
|---|---|---|
| `POST /api/v1/projects` `{slug, name}`, `GET /api/v1/projects` | signed in | create, list mine |
| `GET /api/v1/projects/<slug>` | reader | name, your role, owner, whether a Discord webhook is set |
| `PATCH /api/v1/projects/<slug>` `{name?, discord_webhook?}` | manager | a Discord card per report (no user text on it) |
| `GET/POST /api/v1/projects/<slug>/members`, `DELETE …/members/<username>` | reader / manager | members |
| `POST /api/v1/projects/<slug>/reports` | anyone | `Idempotency-Key`; signed in (cookie or key) or `cf-turnstile-response`; JSON or multipart (`report` + up to 3 `file`s) → `{id}` (`R-XXXXXX`) |
| `GET …/reports?status=&type=&q=&before=`, `GET …/reports/<id>`, `…/image`, `…/files/<i>` | reader | list, read |
| `PATCH …/reports/<id>` `{status?, note?}`, `DELETE …/reports/<id>` | manager | the row stays as a tombstone |

The server redacts every field again (query strings, tokens, home-folder user names, other emails). Daily caps per sender
(user id, or a keyed hash of the IP), per project and in total (`REPORTS_*` vars). Anonymous reports need Turnstile
(`TURNSTILE_SECRET`, solved on `TURNSTILE_HOSTNAMES`); signed-in senders skip it.

## Limits

All in `src/limits.ts`: constants (a change is a deploy), except the daily report caps, which are wrangler vars
(`REPORTS_DAILY_CAP`, `REPORTS_DAILY_CAP_PROJECT`, `REPORTS_DAILY_CAP_ALL`, `REPORTS_DAILY_FILE_BYTES_ALL` in
`wrangler.jsonc`; the constants are their defaults). agents.md quotes them; `@threepipe/plugin-cloud` keeps a copy of
the report limits (`LIMITS`).

One user can have other limits: an admin adds a row to `user_limits` (admin panel, or `POST /api/v1/table/user_limits/insert`
with the admin token) with `user_id` and any of `drive_quota` (bytes), `projects` and `reports_daily`; a column left
empty keeps the role's limit, and `note` says why. Users can't read or change the table (it is not in `users`, whose
rows they can edit).

| What | Limit |
|---|---|
| A file upload (uploads, drive, staff buckets) | 90 MB per request |
| `s/` share | 7 days, `?ttl=` up to 30 |
| `b/` build | 30 days after its last upload |
| Drive quota | 1 GB members, 50 GB staff and admins |
| Signed drive URL | 1 hour by default, up to 7 days |
| Files per item | 500 (share, unshare and new id rewrite each one) |
| Listing a folder | 1000 folders and 1000 items |
| Access key / app key | 30 days / 24 hours |
| Projects a member owns | 5 (staff: any) |
| A report | JSON 5 MB, screenshot 3 MB, text 10 000 characters, log 500 lines of 1000, environment 8 KB, context 16 KB, 3 files and 10 MB together |
| Reports in 24 hours | 20 per sender, 300 per project, 1000 in all, 2 GB of files in all |

## Uploading from the repository

- `npm run cloud:upload -- <file or folder> <remote path>`: any file or folder (skips dotfiles, `node_modules` and what
  `.gitignore` excludes). `drive:/<folder>/` as the remote path makes it one private item in that folder of your drive.
- `npm run cloud:upload-preview -- pr-<n>`: uploads an already built tree (run `npm run build:all` first; that one only
  builds) to `b/threepipe/pr-<n>/` and prints the link.

Key: `TP_CLOUD_KEY` from the environment or `/tmp/.env`; API: `TP_CLOUD_API`. See `scripts/cloud-upload.mjs`.

## Sign in with threepipe (apps)

An app served from the files host (`p/<name>/`, `d/<handle>/<app>/`, `b/…`, `s/…`) or from `localhost:<port>` while it
is developed can save to the user's drive. There is nothing to register: the app is identified by where it is served from.

1. The app sends the user to `/api/v1/connect?return=<its page url>` (`&access=drive` asks for the whole drive).
   `localhost` and `*.localhost` pages are allowed too, for development.
2. Signed out: the page offers GitHub or Google sign-in. The first time: a consent page names the app, who serves it, and the folder.
3. On Allow, the user comes back to `<return>#tp_cloud_key=…&tp_cloud_user=…&tp_cloud_folder=…&tp_cloud_api=…`.
   Once allowed, step 1 redirects straight back with a new key (no screen).
4. The key (24 h) works only on the drive routes, inside the app's folder `Apps/<app>` (made on the first approval;
   `tp_cloud_folder` is its id; the user may rename or move it) and below, or the whole drive (`*`). The grant is an
   `access_links` row; deleting it revokes the app, and a new approval finds the same folder again.

Pages on the files host run sandboxed (no cookies or storage), so the app gets the key again on each load:

```js
const p = new URLSearchParams(location.hash.slice(1))
const key = p.get('tp_cloud_key')
if (key || p.get('tp_cloud_error')) history.replaceState(null, '', location.pathname + location.search)
else location.href = 'https://cloud.threepipe.org/api/v1/connect?return=' + encodeURIComponent(location.href)
// then: fetch(`${p.get('tp_cloud_api')}/api/v1/drive/files?name=scene.glb`, {method: 'PUT', headers: {Authorization: 'Bearer ' + key}, body})
```

## How files are stored and served

- R2 key = the URL path. Owner, expiry, deletion and visibility are in the object's custom metadata, so serving is one
  R2 read and never touches D1 (`src/files.ts`). HTML and SVG get a `sandbox` CSP.
- Drive (`src/drive.ts`): each upload is an item, R2 keys `d/<handle>/<item id>/<name at upload | relative path>`
  that never change; folders and names are D1 labels (rename/move = one row; a path is one recursive query). A private
  item is read through `files…/t/<exp>.<hmac>/d/<handle>/<item>/…` (covers the whole item, so relative files load; no
  lookup); a `link` item at its URL by anyone (the id cannot be guessed). Visibility is on the objects too. Quota per role.
- `files` (D1) is the registry: listing, quotas, the daily expiry cron (`src/cron.ts`). `scopes` holds who owns
  `s/<slug>`, `p/<name>`, `b/<repo>/<ref>`: claimed by one INSERT on a unique column (two first uploads cannot both
  get it), released by the cron once empty.
- Deleting writes a tombstone object at the path (410). Drive items are deleted for real.
- Requests with the session cookie that change something must come from the API's own origin (CSRF; `src/auth.ts`).
  Access and app keys are checked against their link on every route, teenybase's included; app keys can only use the drive.
