#!/bin/bash
# Keeps .prod.vars in Google Secret Manager (GCP project threepipe), so a lost file can be restored. The whole file is
# one secret; each backup adds a version and the older ones stay. Values are never printed.
#   npm run secrets-backup     .prod.vars -> a new version (first checks its ADMIN_SERVICE_TOKEN works on the live Worker)
#   npm run secrets-restore    the latest version -> .prod.vars (refuses to overwrite one)
# Environment: GCP_PROJECT (threepipe), SECRET_NAME (cloud-prod-vars), FILE (.prod.vars), VERSION (latest, for restore),
# API (https://cloud.threepipe.org), FORCE=1 to back up a file whose token the Worker refuses.
# Needs gcloud (https://cloud.google.com/sdk/docs/install), signed in with `gcloud auth login`.
set -euo pipefail
cd "$(dirname "$0")/.."
PROJECT=${GCP_PROJECT:-threepipe}
SECRET=${SECRET_NAME:-cloud-prod-vars}
FILE=${FILE:-.prod.vars}
API=${API:-https://cloud.threepipe.org}
command -v gcloud > /dev/null || { echo "gcloud is not installed: https://cloud.google.com/sdk/docs/install"; exit 1; }

case "${1:-}" in
backup)
    [ -s "$FILE" ] || { echo "no $FILE in $(pwd)"; exit 1; }
    # a stale copy (an old token) is not worth keeping: the live Worker must accept its admin token
    token=$(grep '^ADMIN_SERVICE_TOKEN=' "$FILE" | cut -d= -f2- || true)
    code=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $token" "$API/api/v1/migrations")
    if [ "$code" != 200 ] && [ "${FORCE:-}" != 1 ]; then
        echo "$API refuses the ADMIN_SERVICE_TOKEN of $FILE ($code): an old copy? FORCE=1 backs it up anyway"; exit 1
    fi
    if ! gcloud secrets describe "$SECRET" --project "$PROJECT" > /dev/null 2>&1; then
        # turning the API on needs serviceusage.services.enable (Owner or Service Usage Admin); skipped when it is on
        if [ -z "$(gcloud services list --enabled --project "$PROJECT" --filter 'config.name=secretmanager.googleapis.com' --format 'value(config.name)')" ]; then
            gcloud services enable secretmanager.googleapis.com --project "$PROJECT"
        fi
        gcloud secrets create "$SECRET" --project "$PROJECT" --replication-policy automatic --labels app=threepipe-cloud > /dev/null
        echo "created the secret $SECRET in $PROJECT"
    fi
    gcloud secrets versions add "$SECRET" --project "$PROJECT" --data-file "$FILE" --format 'value(name)' | sed 's#.*/versions/#added version #'
    ;;
restore)
    [ ! -e "$FILE" ] || { echo "$FILE exists: move it away first (it may hold newer values)"; exit 1; }
    (umask 077; gcloud secrets versions access "${VERSION:-latest}" --secret "$SECRET" --project "$PROJECT" --out-file "$FILE")
    echo "wrote $FILE from $SECRET (${VERSION:-latest})"
    ;;
*)
    echo "usage: secrets-backup.sh backup|restore"; exit 1
    ;;
esac
