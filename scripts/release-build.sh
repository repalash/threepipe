#!/bin/bash
# The build of a release (.github/workflows/publish.yml, release-tools with partial): every package that can build
# (turbo --continue: a failed plugin does not stop the others, only what depends on it), then the examples' type check
# also after a failure, so the log shows both. Exits 1 when anything failed; release-tools then publishes what built.
set -uo pipefail
cd "$(dirname "$0")/.."
status=0
npx turbo run build --continue=dependencies-successful || status=1
npm run build-examples || status=1
exit $status
