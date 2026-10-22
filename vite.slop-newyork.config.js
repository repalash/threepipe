// Reproducible standalone build using local ThreePipe and the PR rendering plugins.
import {defineConfig} from 'vite'
import glsl from 'rollup-plugin-glsl'
import path from 'node:path'

export default defineConfig({
    root: '.',
    base: './',
    resolve: {alias: {
        threepipe: path.resolve('src/index.ts'),
        '@threepipe/webgi-plugins': path.resolve('plugins/webgi-plugins/src/index.ts'),
        'three': path.resolve('node_modules/three'),
    }},
    plugins: [glsl({include: '**/*.glsl'})],
    build: {
        outDir: 'dist-slop-newyork', emptyOutDir: true,
        rollupOptions: {input: 'examples/slop-newyork/index.html'},
        target: 'es2022',
    },
    server: {host: '127.0.0.1'},
})
