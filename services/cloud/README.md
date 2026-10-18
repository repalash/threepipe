# threepipe-cloud

The Cloudflare Worker behind [`@threepipe/plugin-cloud`](../../plugins/cloud): one Worker, one D1 database, one
R2 bucket, three route groups, each with its own credential. Nothing is deployed until the steps under
[Deploy](#deploy) are run.

| route | credential | what |
|---|---|---|
| `POST /reports` | a Turnstile pass (`cf-turnstile-response`) | a report from a threepipe app: JSON with the screenshot inline, or multipart (`report` + up to 3 `file` parts, 10 MB together); `Idempotency-Key` per dialog → `201 {id}` (`200 {id, repeat}` for a retry) |
| `GET /staff` | none (the page holds no data) | the staff page: it asks for a staff token |
| `GET /staff/reports?status=&type=&q=&deleted=1&limit=&before=` | `STAFF_TOKENS` | newest first; `q` is a report id or an email → `{rows, next}` |
| `GET /staff/reports/<id>` | `STAFF_TOKENS` | `{row, files, report}` |
| `GET /staff/reports/<id>/image`, `…/files/<i>` | `STAFF_TOKENS` | the screenshot; a file as a download |
| `PATCH /staff/reports/<id>` | `STAFF_TOKENS` | `{status?, note?}`; the actor is the token's name |
| `DELETE /staff/reports/<id>` | `STAFF_TOKENS` | the document, screenshot and files go; the row stays as a tombstone |
| `POST /share` | `SHARE_TOKENS` | `file` parts (nested paths allowed), `slug` (a named share; a re-upload updates it, owner only), `asset=1` (write-once assets) → `{slug, url, files}` / `{assets}` |
| `DELETE /share/<slug>` | `SHARE_TOKENS` | the owner removes a share |
| `GET /<slug>/<path>` | none | a share's files; `/<slug>/` is `index.html`, the one file, or a listing; a `.md` opened in a browser is rendered to a page (`?raw=1` for the file) |
| `GET /a/<id>/<name>` | none | a write-once asset (the id is the start of the content's SHA-256), cached for a year, ranges honoured |

`scripts/share.sh` (repository root) uploads from a shell: `TP_SHARE_TOKEN=… TP_SHARE_URL=https://… scripts/share.sh -s my-page index.html`.

## The rules

These are the rules of iJewel's support reports (IJ-564), whose code this worker copies and simplifies (each
copied file names its source and the ijewel-mono commit in its first line):

- **The id is public, and names nothing.** Users paste `R-7K3F9Q` in issues and chats. R2 keys use a random
  uuid, never the id, and the id opens nothing without a staff token.
- **The client redacts, and the worker redacts again.** Every string of a report but the person's own text
  loses URL queries and fragments, token shapes (JWTs, Bearer/Basic credentials, `…token=…` pairs, known API
  key formats), the user name in home-folder paths, and emails other than the sender's own — keys of the
  environment and context included. The person's own text loses token shapes only.
- **The Discord card carries no user text.** Only the id, the type, the surface, the site tag, the cause kind,
  what was attached (counts and sizes) and the `threepipe` / `app` versions, all validated; it mentions nobody.
- **Caps.** Per sender: `REPORTS_DAILY_CAP` reports in 24 hours, counted by a keyed hash of the IP (its /64 for
  IPv6), never the IP. In total: `REPORTS_DAILY_CAP_ALL` reports and `REPORTS_DAILY_FILE_BYTES_ALL` attached
  bytes. The body is read with a cap whether or not it has a Content-Length.
- **Deletes leave tombstones.** A staff delete removes the R2 objects and clears the email, the summary and the
  note; the row keeps the id, the dates, who deleted it and the rate key (deleting spam does not refill a quota).
- **Guests pass by Turnstile**, checked once with siteverify; the action must be `threepipe-report` and the
  hostname one of `TURNSTILE_HOSTNAMES`. Cloudflare's documented test secrets (`1x…AA` passes, `2x…AA` fails,
  `3x…AA` is "already spent") are answered offline with siteverify's answers, so local runs and tests need no
  network; a real secret always goes to siteverify.
- **CORS is not the gate.** The browser routes answer the origins in `ORIGINS` (each tagged `prod`, `staging`
  or `dev`) and local ones (`localhost`, `*.localhost`, `127.0.0.1`, tagged `local`); a report from an origin
  that is neither is refused.
- **The staff page** escapes every field (all of it is user input; the email is typed and not verified), binds
  events by data attributes so no API string reaches a handler, keeps the token in the tab's sessionStorage,
  sends it only in the Authorization header, and is served with `script-src 'self'`.

## Run it locally

From the repository root (wrangler, vitest and esbuild come from the root's `node_modules`; `marked` is this
folder's one dependency):

```bash
npm install                      # at the root, once
npm install --prefix services/cloud
npm run dev:cloud                # wrangler dev --local on http://localhost:9389 (0.0.0.0), local D1 + R2 in .wrangler/state
```

The dev script sets Turnstile's test secret and two local tokens: staff `dev-staff-token-local`, share
`dev-share-token-local`. Open `http://localhost:9389/staff` for the staff page, and the
`modelling-editor-feedback` example with `?cloud=http://localhost:9389` to send a report.

```bash
npm run test:cloud               # the plugin's tests, this worker's typecheck and tests
npm run test --prefix services/cloud   # 22 tests: Miniflare (workerd) with a local D1 and R2; siteverify and Discord are stubs
```

## Deploy

The maintainer decides the account, the domain, the Turnstile widget and where the card goes. Then, from
`services/cloud`:

1. `npx wrangler login` (or `CLOUDFLARE_API_TOKEN`), and put the account id in `wrangler.toml` as
   `account_id = "…"` if the login has more than one account.
2. The store:
   ```bash
   npx wrangler d1 create threepipe-cloud      # copy the printed database_id into wrangler.toml
   npx wrangler r2 bucket create threepipe-cloud
   ```
   Leave the bucket private (no public access, no r2.dev URL): only this Worker reads it.
3. The Turnstile widget: Cloudflare dashboard → Turnstile → Add widget, mode Managed, hostnames = the sites
   that send reports. Its **site key** goes into the app (`new ThreepipeCloudPlugin({turnstileSiteKey})`); its
   **secret** is a secret here.
4. `wrangler.toml` `[vars]`: `ORIGINS` (the pages that send reports, with their tags), `TURNSTILE_HOSTNAMES`,
   the caps, `STAFF_URL` (`https://<domain>/staff`), `CANONICAL_HOST`; and the custom domain:
   `routes = [{ pattern = "<domain>", custom_domain = true }]`.
5. The secrets:
   ```bash
   npx wrangler secret put TURNSTILE_SECRET
   npx wrangler secret put STAFF_TOKENS        # name=token,… (tokens of 16+ characters: openssl rand -base64 32)
   npx wrangler secret put SHARE_TOKENS        # name=token,… ('admin' may change any share)
   npx wrangler secret put DISCORD_WEBHOOK     # optional: the channel's webhook URL
   ```
6. `npm run deploy` — the typecheck, the tests, `wrangler d1 migrations apply threepipe-cloud --remote`, then
   `wrangler deploy`.
7. In the app: `new ThreepipeCloudPlugin({endpoint: 'https://<domain>', turnstileSiteKey: '…'})` — for the
   modelling editor, in the page that calls `createModellingEditor({plugins: [cloud]})`.

Backups: D1 has Time Travel (30 days on paid plans); the R2 bucket has none of its own. A deleted report's
row is still in Time Travel until it expires.
