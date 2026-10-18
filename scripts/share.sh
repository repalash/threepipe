#!/usr/bin/env bash
# Copied from ijewel-mono scripts/share.sh @ 54d43285, the essentials: shares, named slugs, write-once assets.
#
# Upload files to threepipe-cloud (services/cloud) and print the share URL.
#
# Usage: scripts/share.sh [-s slug] [-P dir] file [file...]
#        scripts/share.sh -a file [file...]
#   -s SLUG      named share: reuse the same slug to update it in place (only its owner can)
#   -P DIR       put the files under DIR inside the share, e.g. -P walkthrough serves f.html at
#                /<slug>/walkthrough/f.html (not with -a)
#   -a           write-once assets instead of a share: content-addressed /a/<id>/<filename> URLs that
#                nothing can overwrite or delete through the API. Prints one URL per line.
#
# TP_SHARE_TOKEN comes from the environment or the repository's .env (gitignored); it is one of the
# worker's SHARE_TOKENS. Never a literal in source. TP_SHARE_URL is the worker (default: a local
# `npm run dev:cloud`).
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
envval() { [ -f "$ROOT/.env" ] && sed -n "s/^$1=//p" "$ROOT/.env" | tail -1 | tr -d '"\r' || true; }
TOKEN="${TP_SHARE_TOKEN:-$(envval TP_SHARE_TOKEN)}"
BASE="${TP_SHARE_URL:-$(envval TP_SHARE_URL)}"
BASE="${BASE:-http://localhost:9389}"
if [ -z "$TOKEN" ]; then
	echo "TP_SHARE_TOKEN is not set. Export it, or add it to .env at the repository root:" >&2
	echo "    TP_SHARE_TOKEN=<your token>" >&2
	exit 1
fi

SLUG=""
PREFIX=""
ASSET=0
FILES=()
while [ $# -gt 0 ]; do
	case "$1" in
		-s) SLUG="${2-}"; shift 2 ;;
		-P) PREFIX="${2-}"; shift 2 ;;
		-a) ASSET=1; shift ;;
		-h|--help) sed -n '4,17p' "$0"; exit 0 ;;
		*) FILES+=("$1"); shift ;;
	esac
done

[ ${#FILES[@]} -gt 0 ] || { echo "error: no files given (see -h)" >&2; exit 1; }
if [ "$ASSET" = 1 ] && [ -n "$PREFIX$SLUG" ]; then
	echo "error: -a takes no slug or prefix" >&2; exit 1
fi
# A relative path only, no '.'/'..'/dot segments, no empty segments: the worker refuses these anyway;
# this gives a clear error up front.
PREFIX="${PREFIX%/}"
case "$PREFIX" in
	/*|.*|*/.*|*//*) echo "error: -P must be a relative dir without . or .. segments: $PREFIX" >&2; exit 1 ;;
esac

ARGS=()
for f in "${FILES[@]}"; do
	[ -f "$f" ] || { echo "error: no such file: $f" >&2; exit 1; }
	if [ -n "$PREFIX" ]; then
		ARGS+=(-F "file=@$f;filename=$PREFIX/$(basename "$f")")
	else
		ARGS+=(-F "file=@$f")
	fi
done
if [ "$ASSET" = 1 ]; then
	curl -sfS -H "Authorization: Bearer $TOKEN" "${ARGS[@]}" -F "asset=1" "${BASE%/}/share" | sed -n 's/^ *"url": "\([^"]*\)".*/\1/p'
	exit 0
fi
[ -n "$SLUG" ] && ARGS+=(-F "slug=$SLUG")
curl -sfS -H "Authorization: Bearer $TOKEN" "${ARGS[@]}" "${BASE%/}/share"
