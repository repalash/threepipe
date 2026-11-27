#!/bin/bash
# Creates the R2 buckets named in wrangler.jsonc that do not exist yet (cloud files, samples, e2e snapshots), and the
# cloud bucket's expiry rule (s/ shares go after 30 days, SHARE_MAX_DAYS in src/limits.ts; b/ builds stay until cleaned up),
# for a first deploy on a new Cloudflare account. The D1 database is made by the first `npm run deploy` (TEENY_AUTO_CREATE).
# Needs `wrangler login` or CLOUDFLARE_API_TOKEN. Usage: npm run init-infra
set -euo pipefail
cd "$(dirname "$0")/.."
for bucket in $(grep -o '"bucket_name": *"[^"]*"' wrangler.jsonc | sed 's/.*"\([^"]*\)"$/\1/'); do
    if wrangler r2 bucket info "$bucket" > /dev/null 2>&1; then echo "exists: $bucket"
    else wrangler r2 bucket create "$bucket"; fi
done
# 30 days: SHARE_MAX_DAYS (src/limits.ts). Safe to run again on an existing account: adds the rule only when missing.
rules=$(wrangler r2 bucket lifecycle list threepipe-cloud)
if grep -q "expire-s" <<< "$rules"; then echo "exists: rule expire-s"
else wrangler r2 bucket lifecycle add threepipe-cloud expire-s s/ --expire-days 30 --force; fi
echo "Done. An existing account needs nothing more."
echo "A new account only, the first time: the public domains of the samples and e2e buckets (R2 > bucket > Settings >"
echo "Custom Domains), cp .prod.vars.example .prod.vars (fill it in), npm run secrets-upload, npm run deploy"
