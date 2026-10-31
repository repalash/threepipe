#!/bin/bash
# Creates the R2 buckets named in wrangler.jsonc that do not exist yet (cloud files, samples, e2e snapshots), for a
# first deploy on a new Cloudflare account. The D1 database is made by the first `npm run deploy` (TEENY_AUTO_CREATE).
# Needs `wrangler login` or CLOUDFLARE_API_TOKEN. Usage: npm run init-infra
set -euo pipefail
cd "$(dirname "$0")/.."
existing=$(wrangler r2 bucket list | sed "s/\x1b\[[0-9;]*m//g") # "name:  <bucket>" per bucket
for bucket in $(grep -o '"bucket_name": *"[^"]*"' wrangler.jsonc | sed 's/.*"\([^"]*\)"$/\1/'); do
    if grep -q "name: *$bucket\$" <<< "$existing"; then echo "exists: $bucket"
    else wrangler r2 bucket create "$bucket"; fi
done
echo "Next: the public domains of the samples and e2e buckets (R2 > bucket > Settings > Custom Domains),"
echo "      cp .prod.vars.example .prod.vars (fill it in), npm run secrets-upload, npm run deploy"
