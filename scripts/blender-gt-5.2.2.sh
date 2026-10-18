#!/usr/bin/env bash
# Export geometry-nodes ground truth with Blender 5.2.2 on the maintainer's Mac.
# Usage: bash scripts/blender-gt-5.2.2.sh            (installs Blender 5.2.2 into /Applications if missing)
# Writes tmp/gt-5.2.2/<name>/ per .blend and tmp/gt-5.2.2/inventory.json; log in tmp/gt-5.2.2/run.log.
set -uo pipefail
cd "$(dirname "$0")/.."
APP=/Applications/Blender-5.2.2.app
BLENDER=$APP/Contents/MacOS/Blender
LOG=tmp/gt-5.2.2/run.log
mkdir -p tmp/gt-5.2.2
exec > >(tee -a "$LOG") 2>&1
echo "### RUN $(date -u +%FT%TZ) in $(pwd)"
if [ ! -x "$BLENDER" ]; then
  echo "### INSTALL Blender 5.2.2"
  DMG=$HOME/Downloads/blender-5.2.2-macos-arm64.dmg
  [ -f "$DMG" ] || curl -L --progress-bar -o "$DMG" https://download.blender.org/release/Blender5.2/blender-5.2.2-macos-arm64.dmg
  hdiutil attach "$DMG" -mountpoint /Volumes/Blender522 -nobrowse -quiet
  cp -R /Volumes/Blender522/Blender.app "$APP"
  hdiutil detach /Volumes/Blender522 -quiet
fi
"$BLENDER" --version | head -1
"$BLENDER" --version | head -1 | grep -q "Blender 5.2.2" || { echo "### FAILED wrong Blender version"; exit 1; }
for f in buildify_1.0 flower_scattering pebble_scattering blender-procedural-buildings candy_bounce repeat_zone_flower_by_MiRA; do
  echo "### START $f"
  if "$BLENDER" --background --factory-startup --python-exit-code 1 "tmp/$f.blend" --python plugins/procedural/porting/blender/dump_blend.py -- --out "tmp/gt-5.2.2/$f"; then
    echo "### DONE $f"
  else
    echo "### FAILED $f"
  fi
done
echo "### START inventory"
if "$BLENDER" --background --factory-startup --python-exit-code 1 --python plugins/procedural/porting/blender/inventory.py -- tmp/gt-5.2.2/inventory.json; then echo "### DONE inventory"; else echo "### FAILED inventory"; fi
echo "### ALL DONE $(date -u +%FT%TZ)"
