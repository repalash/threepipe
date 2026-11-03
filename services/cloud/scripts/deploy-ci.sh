#!/bin/bash
# Deploys from CI (Cloudflare Workers Builds, with the API token chosen in its build settings: one for this Worker only),
# with ADMIN_SERVICE_TOKEN as a build secret. Later deploys need nothing else: migrations go through the deployed Worker's admin
# API (teeny deploy, with ADMIN_SERVICE_TOKEN), and teenybase generates or uploads secrets only when the Worker does not
# exist yet, so prod's other secrets are never touched. A first deploy is not done here (no Worker: stop).
set -euo pipefail
cd "$(dirname "$0")/.."
: "${ADMIN_SERVICE_TOKEN:?set ADMIN_SERVICE_TOKEN as a build secret}"
if [ -e .prod.vars ]; then echo ".prod.vars exists: deploy:ci writes its own, run it on a clean checkout" >&2; exit 1; fi
npx wrangler deployments list --json > /dev/null || { echo "no deployed Worker to update (a first deploy is npm run deploy, by hand)" >&2; exit 1; }
umask 077
printf 'ADMIN_SERVICE_TOKEN=%s\n' "$ADMIN_SERVICE_TOKEN" > .prod.vars
trap 'rm -f .prod.vars' EXIT
npx teeny deploy --remote --yes
