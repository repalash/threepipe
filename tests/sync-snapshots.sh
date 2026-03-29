#!/bin/bash
# Sync test snapshots from the separate snapshot repository.
# Clones or updates the snapshot repo at the pinned commit.

set -e

SNAPSHOT_DIR="tests/snapshots"
CONFIG_FILE="tests/snapshot-commit.json"
BRANCH="main"

if [ ! -f "$CONFIG_FILE" ]; then
    echo "No snapshot config found at $CONFIG_FILE"
    exit 1
fi

REPO=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$CONFIG_FILE','utf8')).repo)")
COMMIT=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$CONFIG_FILE','utf8')).commit)")

if [ -z "$COMMIT" ]; then
    echo "No snapshot commit pinned yet. Run update-snapshots.sh first."
    exit 0
fi

if [ -d "$SNAPSHOT_DIR/.git" ]; then
    echo "Updating existing snapshot repo..."
    pushd "$SNAPSHOT_DIR" > /dev/null
    git fetch origin
    git checkout "$BRANCH" 2>/dev/null || git checkout -b "$BRANCH" "origin/$BRANCH"
    git reset --hard "$COMMIT"
    popd > /dev/null
else
    echo "Cloning snapshot repo..."
    git clone "git@github.com:$REPO.git" "$SNAPSHOT_DIR" || \
        git clone "https://github.com/$REPO.git" "$SNAPSHOT_DIR"
    pushd "$SNAPSHOT_DIR" > /dev/null
    git checkout "$BRANCH" 2>/dev/null || git checkout -b "$BRANCH"
    git reset --hard "$COMMIT"
    popd > /dev/null
fi

echo "✓ Snapshots synced to commit $COMMIT"
