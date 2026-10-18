import {defineConfig} from 'vitest/config'
import glsl from 'rollup-plugin-glsl'
import path from 'node:path'

// The Node session runs a real ThreeViewer on `src/node/polyfill.ts` - no `tests/setup.ts` here, the
// polyfill is the thing under test.
export default defineConfig({
    plugins: [glsl({include: path.resolve(__dirname, '../../src') + '/**/*.glsl'})],
    resolve: {
        alias: {
            // threepipe's built bundle, not its TS source: transforming the source costs two minutes per run, and
            // this package changes nothing in core. Rebuild it with `npm run build` at the root after core changes.
            'threepipe': path.resolve(__dirname, '../../dist/index.mjs'),
            'three': path.resolve(__dirname, '../../node_modules/three/'),
            '@threepipe/mesh-kernel': path.resolve(__dirname, '../mesh-kernel/src/index.ts'),
            '@threepipe/plugin-modelling/agent-protocol': path.resolve(__dirname, '../modelling/src/agent/protocol.ts'),
            '@threepipe/plugin-modelling': path.resolve(__dirname, '../modelling/src/index.ts'),
        },
    },
    test: {
        environment: 'node',
        include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
        testTimeout: 60000,
        hookTimeout: 120000,
        // One viewer per file and globals from the polyfill: keep files in their own workers.
        pool: 'forks',
        // Load that bundle with Node's own loader rather than through vite's transform pipeline.
        server: {deps: {external: [/[\\/]dist[\\/]index\.mjs$/]}},
    },
})
