#!/usr/bin/env bash
# Blender job worker for the maintainer's Mac. Leave it running in a terminal:
#   cd /Users/palash/Projects/threepipe/.repos/threepipe-track2-procedural && bash scripts/blender-worker.sh
# Agents in the container drop shell snippets into tmp/blender-jobs/queue/<name>.sh (they may use $BLENDER,
# run from the worktree root). Each job runs once, its output goes to tmp/blender-jobs/log/<name>.log and a
# line to log/worker.log; the job file moves to done/. Stop with Ctrl+C.
set -uo pipefail
cd "$(dirname "$0")/.."
export BLENDER=/Applications/Blender-5.2.2.app/Contents/MacOS/Blender
[ -x "$BLENDER" ] || { echo "Blender 5.2.2 missing at $BLENDER; run scripts/blender-gt-5.2.2.sh first"; exit 1; }
Q=tmp/blender-jobs
mkdir -p $Q/queue $Q/running $Q/done $Q/log
echo "### WORKER START $(date -u +%FT%TZ) $("$BLENDER" --version | head -1)" | tee -a $Q/log/worker.log
while true; do
  for job in $(ls $Q/queue/*.sh 2>/dev/null | sort); do
    name=$(basename "$job" .sh)
    mv "$job" "$Q/running/$name.sh"
    echo "### START $name $(date -u +%FT%TZ)" | tee -a $Q/log/worker.log
    if bash "$Q/running/$name.sh" > "$Q/log/$name.log" 2>&1; then status=DONE; else status=FAILED; fi
    echo "### $status $name $(date -u +%FT%TZ) (log: $Q/log/$name.log)" | tee -a $Q/log/worker.log
    grep -m1 -E "Traceback|Error:" "$Q/log/$name.log" | sed 's/^/    /' | tee -a $Q/log/worker.log
    mv "$Q/running/$name.sh" "$Q/done/$name.sh"
  done
  sleep 3
done
