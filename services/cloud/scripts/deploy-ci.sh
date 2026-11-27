#!/bin/bash
# Deploys from CI (.github/workflows/deploy-cloud.yml, after the approval): CLOUDFLARE_API_TOKEN is a token for this
# Worker only and ADMIN_SERVICE_TOKEN the one in .prod.vars, both secrets of the cloud-deploy environment. Later deploys need nothing else: migrations go through the deployed Worker's admin
# API (teeny deploy, with ADMIN_SERVICE_TOKEN), and teenybase generates or uploads secrets only when the Worker does not
# exist yet, so prod's other secrets are never touched. A first deploy is not done here (no Worker: stop).
set -euo pipefail
cd "$(dirname "$0")/.."
: "${ADMIN_SERVICE_TOKEN:?set ADMIN_SERVICE_TOKEN (a secret of the cloud-deploy environment)}"
: "${CLOUDFLARE_API_TOKEN:?set CLOUDFLARE_API_TOKEN (a token for the threepipe-cloud Worker, a secret of cloud-deploy)}"
if [ -e .prod.vars ]; then echo ".prod.vars exists: deploy:ci writes its own, run it on a clean checkout" >&2; exit 1; fi
npx --no-install wrangler deployments list --json > /dev/null || { echo "no deployed Worker to update (a first deploy is npm run deploy, by hand)" >&2; exit 1; }
umask 077
printf 'ADMIN_SERVICE_TOKEN=%s\n' "$ADMIN_SERVICE_TOKEN" > .prod.vars
# A copy of wrangler.jsonc without `routes`: wrangler sends every custom domain listed on each deploy, which needs zone
# access, and this token has only this Worker. With none listed it leaves the domains as they are (wrangler 4.156). A
# new or changed domain is deployed by hand: npm run deploy.
CI_CONFIG=.tmp.wrangler-ci.json
trap 'rm -f .prod.vars "$CI_CONFIG"' EXIT
domains=$(node --input-type=module -e "
import fs from 'node:fs'
import {experimental_readRawConfig as read} from 'wrangler'
const {rawConfig: config} = read({config: 'wrangler.jsonc'})
const domains = (config.routes ?? []).map(r => r.pattern)
delete config.routes
fs.writeFileSync(process.argv[1], JSON.stringify(config, null, 2))
console.log(domains.join(' '))
" "$CI_CONFIG")
[ -n "$domains" ] || { echo "no domains found in wrangler.jsonc" >&2; exit 1; }
# --no-install: never fetch a package from npm with these secrets in the environment (`teeny` on npm is another package)
npx --no-install teenybase deploy --remote --yes --wrangler "$CI_CONFIG"
# The domains still reach the Worker: fails the job (and Discord says so) if a deploy, or a new wrangler, lost one.
for domain in $domains; do
  code=$(curl -sS -o /dev/null -w '%{http_code}' --retry 4 --retry-delay 5 --retry-all-errors --max-time 20 "https://$domain/" || true)
  case "$code" in 2??|3??) echo "$domain answers ($code)" ;; *) echo "$domain does not answer after the deploy ($code)" >&2; exit 1 ;; esac
done
