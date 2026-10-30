# threepipe on Cloudflare

Everything threepipe runs on Cloudflare, and how to deploy threepipe-cloud. One account, one zone.

- **Account:** `3c4cf55a12810e878be2349f1411ca08`
- **Zone:** `threepipe.org`, proxied through Cloudflare.

## What exists

| Host | What | Runs on | Source | Deploy |
|---|---|---|---|---|
| `threepipe.org` | Docs site and examples (`threepipe.org/examples/…`) | GitHub Pages, behind Cloudflare | `website/`, `examples/` | `.github/workflows/deploy-pages.yml` (push to `master`) |
| `pkg.threepipe.org` | Deprecated package proxy (serves `three` / `@types/three` release tarballs with CORS) | Worker `threepipe-pkg-proxy` | `website/.worker/` | `cd website/.worker && npx wrangler deploy` |
| `e2e-snapshots.threepipe.org` | e2e screenshot baselines, public read | R2 bucket `threepipe-e2e-snapshots` (custom domain) | `scripts/snapshots-r2*.mjs` (#38) | `npm run test:e2e:r2-init` / `test:e2e:push` |
| `editor.threepipe.org` | "Threepipe Editor" web app (last modified 2025-08-22) | Cloudflare (static) | not in this repository | — |
| `samples.threepipe.org` | Sample models and assets for the examples | Cloudflare | not in this repository | — |
| `cloud.threepipe.org` | **New:** threepipe-cloud (reports, staff page, shares) | Worker `threepipe-cloud` + D1 `threepipe-cloud` + R2 `threepipe-cloud` | `services/cloud/` | below |

**How this table was made:** from the repository and from public DNS and HTTP responses (2026-10-18).
- Every host above resolves to Cloudflare.
- `threepipe.org` answers with GitHub's `x-github-request-id`.
- `www`, `docs`, `cdn`, `api` and `share` have no DNS record.

The account's own lists were not read yet. To see what else is there (Workers, Pages, R2, D1, KV, Turnstile widgets), run this after `npx wrangler login`:

```bash
npx wrangler whoami
npx wrangler deployments list --name threepipe-pkg-proxy
npx wrangler r2 bucket list
npx wrangler d1 list
npx wrangler kv namespace list
npx wrangler pages project list
```

Workers, DNS records and Turnstile widgets are listed in the dashboard (Workers & Pages, threepipe.org > DNS, Turnstile).

## threepipe-cloud

`services/cloud` is one Worker with one D1 database and one private R2 bucket. `services/cloud/README.md` describes the routes and their credentials. `@threepipe/plugin-cloud` is the client.

| What | Value |
|---|---|
| Worker | `threepipe-cloud` at `https://cloud.threepipe.org` (custom domain; `wrangler deploy` creates the DNS record and the certificate) |
| D1 | `threepipe-cloud` (reports; migrations in `services/cloud/migrations`) |
| R2 | `threepipe-cloud`, private (no public access, no r2.dev URL) |
| Turnstile | one widget, mode Managed, hostnames `threepipe.org`, `editor.threepipe.org` |
| Report origins | `ORIGINS` in `wrangler.toml`: `https://threepipe.org`, `https://editor.threepipe.org`, plus local origins (always allowed, tagged `local`) |
| Secrets | `TURNSTILE_SECRET`, `STAFF_TOKENS`, `SHARE_TOKENS`, and optionally `DISCORD_WEBHOOK` |
| Staff page | `https://cloud.threepipe.org/staff` |
| Shares | `https://cloud.threepipe.org/<slug>/` (`scripts/share.sh`) |

### First deploy (local, about 10 minutes)

From a checkout of this branch, at the repository root:

```bash
npm install                                  # once: wrangler, vitest and typescript come from the root
cd services/cloud
npm install                                  # the worker's own dependency (marked)
npx wrangler login                           # browser login; the account above
npm run provision                            # check only: prints what exists and what is missing
```

1. **Turnstile widget (dashboard):** Turnstile > Add widget.
   - Name `threepipe-cloud`; hostnames `threepipe.org` and `editor.threepipe.org`; mode Managed.
   - Keep the **site key** (public, used by the app) and the **secret key** (asked for by the next step).
2. **Create the store and set the secrets:**
   ```bash
   npm run provision -- --apply
   ```
   - It creates the D1 database and writes its id into `wrangler.toml` (commit that change).
   - It creates the private R2 bucket.
   - It then asks for each missing secret, one at a time; values are not echoed:
     - `TURNSTILE_SECRET`: the widget's secret key.
     - `STAFF_TOKENS`: `palash=<token>`; make a token with `openssl rand -base64 32`.
     - `SHARE_TOKENS`: `admin=<token>` (`admin` may change any share).
   - Optional, for a card per report in a Discord channel: `npx wrangler secret put DISCORD_WEBHOOK`.
3. **Deploy:**
   ```bash
   npm run deploy      # typecheck, tests, D1 migrations on the remote database, wrangler deploy
   ```
4. **Check it:**
   ```bash
   curl -sI https://cloud.threepipe.org/ | head -1                           # 200
   curl -s https://cloud.threepipe.org/staff/reports \
     -H "authorization: Bearer <staff token>"                               # {"rows":[],...}
   echo '# hello' > /tmp/hello.md
   TP_SHARE_URL=https://cloud.threepipe.org TP_SHARE_TOKEN=<share token> \
     ../../scripts/share.sh -s hello /tmp/hello.md                          # prints the share URL
   ```
   Then open `https://cloud.threepipe.org/staff` and sign in with the staff token.

### Using it from an app

Any threepipe page adds the plugin with the worker's URL and the widget's site key (both public):

```ts
viewer.addPluginSync(new ThreepipeCloudPlugin({endpoint: 'https://cloud.threepipe.org', turnstileSiteKey: '<site key>'}))
```

`examples/cloud-feedback` does this with `?cloud=<url>` (Cloudflare's test site key; open it with
`?cloud=https://cloud.threepipe.org` once the widget's hostnames include threepipe.org and the real site key is in).
The modelling editor's Help > Report a Problem comes with the modelling tools, in their own PR.

### Later deploys

```bash
cd services/cloud && npm run deploy
```

A new migration in `services/cloud/migrations` is applied by the same command before the Worker goes out.

### Rollback, logs, costs

- **Rollback:** `npx wrangler deployments list`, then `npx wrangler rollback <version-id>`. D1 has Time Travel: 30 days on Workers Paid, 7 on Free (`npx wrangler d1 time-travel restore threepipe-cloud --timestamp=…`). The R2 bucket has no versioning of its own.
- **Logs:** `npx wrangler tail threepipe-cloud`; Workers observability is on (`[observability]` in `wrangler.toml`).
- **Abuse limits:** `REPORTS_DAILY_CAP` (per sender), `REPORTS_DAILY_CAP_ALL` and `REPORTS_DAILY_FILE_BYTES_ALL` (2 GiB a day in total), all in `wrangler.toml`.
- **Rotating a token:** `npx wrangler secret put STAFF_TOKENS` (or `SHARE_TOKENS`) with the new list; the old tokens stop working at once.

## Credentials

Nothing secret is in this repository.
- **Secrets:** `TURNSTILE_SECRET`, `STAFF_TOKENS`, `SHARE_TOKENS` and `DISCORD_WEBHOOK` live only as Worker secrets.
- **Snapshot store:** its S3 key is in the gitignored `.env.snapshots-r2` (#38).
- **Public values (fine to commit):** the account id, the zone name and the Turnstile site key.
