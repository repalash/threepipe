import {defineConfig} from 'vite'
import path from 'node:path'
import {builtinModules} from 'node:module'

/**
 * Node bundles: `dist/index.mjs` (the library) and `dist/cli.mjs` (the executable).
 *
 * threepipe, `@threepipe/plugin-modelling` and `@threepipe/mesh-kernel` are bundled in, so the CLI runs
 * on its own with `npx`; `ws`, `playwright-core` and `manifold-3d` (a WebAssembly module that loads its `.wasm`
 * from beside its own script, so it cannot be inlined) stay dependencies. threepipe comes from its built
 * bundle (`npm run build` at the root). The session page is a separate build (`vite.page.config.js`).
 */
export default defineConfig({
    resolve: {
        alias: {
            'threepipe': path.resolve(__dirname, '../../dist/index.mjs'),
            '@threepipe/mesh-kernel': path.resolve(__dirname, '../mesh-kernel/src/index.ts'),
            '@threepipe/plugin-modelling/agent-protocol': path.resolve(__dirname, '../modelling/src/agent/protocol.ts'),
            '@threepipe/plugin-modelling': path.resolve(__dirname, '../modelling/src/index.ts'),
        },
    },
    build: {
        ssr: true,
        target: 'node20',
        outDir: 'dist',
        emptyOutDir: false,
        sourcemap: true,
        minify: false,
        rollupOptions: {
            input: {
                index: path.resolve(__dirname, 'src/index.ts'),
                cli: path.resolve(__dirname, 'src/cli.ts'),
                // The relay alone - no threepipe, no DOM stubs - for the MCP server and tests.
                relay: path.resolve(__dirname, 'src/relay.ts'),
                skill: path.resolve(__dirname, 'src/skill.ts'),
            },
            external: ['ws', 'playwright-core', 'manifold-3d', ...builtinModules, ...builtinModules.map(m => `node:${m}`)],
            output: {
                format: 'es',
                entryFileNames: '[name].mjs',
                chunkFileNames: 'chunks/[name]-[hash].mjs',
                banner: chunk => chunk.name === 'cli' ? '#!/usr/bin/env node' : '',
            },
        },
    },
    ssr: {noExternal: true},
})
