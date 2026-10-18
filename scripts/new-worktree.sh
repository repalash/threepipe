#!/usr/bin/env bash
# Create a worktree off modelling-editor that shares node_modules with the editor worktree.
#   scripts/new-worktree.sh <name> [base-branch]
# Result: .repos/threepipe-<name> on branch <name>, node_modules symlinked (root and every plugin),
# tests/snapshots copied, safe.directory registered.
set -euo pipefail
name="$1"; base="${2:-modelling-editor}"
root=/Users/palash/Projects/threepipe
src=$root/.repos/threepipe-editor
dst=$root/.repos/threepipe-$name
git -C "$src" worktree add "$dst" -b "$name" "$base"
ln -s "$(readlink -f "$src/node_modules")" "$dst/node_modules"
for p in "$src"/plugins/*/; do
  n="$p/node_modules"; [ -e "$n" ] || continue
  ln -s "$(readlink -f "$n")" "$dst/plugins/$(basename "$p")/node_modules"
done
for p in "$src"/plugins/*/; do
  d="$p/dist"; [ -d "$d" ] || continue
  cp -r "$d" "$dst/plugins/$(basename "$p")/dist"
done
[ -d "$dst/tests/snapshots" ] || cp -r "$src/tests/snapshots" "$dst/tests/snapshots"
# The plugin typechecks resolve `threepipe` through the root dist (index.d.ts); copy it when it exists.
[ -d "$src/dist" ] && cp -r "$src/dist" "$dst/dist"
git config --global --add safe.directory "$dst"
mkdir -p "$src/tmp/agent-comm/$name" "$dst/tmp"
echo "$dst"
