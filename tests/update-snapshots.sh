#!/bin/bash
# Update test snapshots: run tests with --update-snapshots, commit to snapshot repo,
# and update the pinned commit hash.

set -e

SNAPSHOT_DIR="tests/snapshots"
CONFIG_FILE="tests/snapshot-commit.json"
BRANCH="main"

echo "Running tests with --update-snapshots..."
npx playwright test --update-snapshots --retries 1 || {
    echo ""
    echo "⚠ Some tests failed. Snapshots for passing tests were still updated."
    echo "  Check the report: npx playwright show-report"
    echo "  Re-run failed tests: npx playwright test --update-snapshots --last-failed"
    echo ""
}

# If snapshot repo exists, commit the new snapshots
if [ -d "$SNAPSHOT_DIR/.git" ]; then
    pushd "$SNAPSHOT_DIR" > /dev/null
    # Ensure we're on a branch (not detached HEAD)
    git checkout "$BRANCH" 2>/dev/null || git checkout -b "$BRANCH"
    git add -A
    if git diff --cached --quiet; then
        echo "No snapshot changes to commit."
    else
        git commit -m "Update snapshots $(date -u +%Y-%m-%dT%H:%M:%SZ)"
        git push origin "$BRANCH"
        COMMIT=$(git rev-parse HEAD)
        popd > /dev/null
        # Update the pinned commit
        node -e "
            const fs = require('fs');
            const cfg = JSON.parse(fs.readFileSync('$CONFIG_FILE','utf8'));
            cfg.commit = '$COMMIT';
            fs.writeFileSync('$CONFIG_FILE', JSON.stringify(cfg, null, 2) + '\n');
        "
        echo "✓ Snapshot commit updated to $COMMIT"
    fi
else
    echo "No snapshot repo found at $SNAPSHOT_DIR. Screenshots saved locally."
    echo "To enable snapshot tracking:"
    echo "  cd $SNAPSHOT_DIR && git init && git remote add origin git@github.com:REPO.git"
fi
