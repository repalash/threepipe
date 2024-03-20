#!/bin/bash
set -e
DOCKER_IMAGE="emscripten/emsdk:3.1.50"
docker run --rm -v "$(pwd)":/src -w /src $DOCKER_IMAGE bash build.sh
