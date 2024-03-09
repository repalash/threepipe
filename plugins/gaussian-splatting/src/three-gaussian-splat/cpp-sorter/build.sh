#!/bin/bash
set -e

rm -rf sort.wasm sort.js sort.d.ts
rm -rf pthread_sort.wasm pthread_sort.js pthread_sort.worker.js
em++ -pthread -O3 -s EXPORT_ES6=1 -s ALLOW_MEMORY_GROWTH=1 -s MODULARIZE=1 -s ENVIRONMENT=web,worker -flto --embind-emit-tsd=ISort.d.ts sort.cpp -o pthread_sort.js -s WASM=1 -lembind -s EXPORTED_FUNCTIONS='["_malloc", "_free"]' -s AGGRESSIVE_VARIABLE_ELIMINATION=1 -s ELIMINATE_DUPLICATE_FUNCTIONS=1
em++ -O3 -s EXPORT_ES6=1 -s ALLOW_MEMORY_GROWTH=1 -s MODULARIZE=1 -s ENVIRONMENT=web,worker -flto --embind-emit-tsd=ISort.d.ts sort.cpp -o sort.js -s WASM=1 -lembind -s EXPORTED_FUNCTIONS='["_malloc", "_free"]' -s AGGRESSIVE_VARIABLE_ELIMINATION=1 -s ELIMINATE_DUPLICATE_FUNCTIONS=1
