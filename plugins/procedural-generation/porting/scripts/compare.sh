#!/bin/bash
# Compare a graph module against ground truth.
# Usage: ./porting/scripts/compare.sh <graph.ts> <ground_truth.json>
#
# Example:
#   ./plugins/procedural-generation/porting/scripts/compare.sh \
#     examples/buildify-demo-3/graph.ts /tmp/buildings_gt/all_ground_truth.json

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
npx tsx --tsconfig "$SCRIPT_DIR/tsconfig.json" "$SCRIPT_DIR/compare_graph.ts" "$@"
