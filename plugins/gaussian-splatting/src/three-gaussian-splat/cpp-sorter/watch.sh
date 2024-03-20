#!/bin/bash
set -e
./build.sh
fswatch -o sort.cpp | while read line
do
  echo "File changed, rebuilding..."
  ./build.sh
  echo "Done."
done
