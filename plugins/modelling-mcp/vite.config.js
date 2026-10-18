import {defineConfig} from 'vite'
import path from 'node:path'
import {builtinModules} from 'node:module'

/**
 * `dist/server.mjs`, the MCP server: bundles @threepipe/modelling-cli (sessions, relay), the modelling
 * plugin, the kernel and threepipe's built bundle; the MCP SDK, ws and playwright-core stay dependencies.
 */
export default defineConfig({
    resolve: {
        alias: {
            'threepipe': path.resolve(__dirname, '../../dist/index.mjs'),
            '@threepipe/mesh-kernel': path.resolve(__dirname, '../mesh-kernel/src/index.ts'),
            '@threepipe/plugin-modelling/agent-protocol': path.resolve(__dirname, '../modelling/src/agent/protocol.ts'),
            '@threepipe/plugin-modelling': path.resolve(__dirname, '../modelling/src/index.ts'),
            '@threepipe/modelling-cli': path.resolve(__dirname, '../modelling-cli/src/index.ts'),
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
            input: {server: path.resolve(__dirname, 'src/server.ts'), index: path.resolve(__dirname, 'src/index.ts')},
            external: [/^@modelcontextprotocol\/sdk/, 'ws', 'playwright-core', ...builtinModules, ...builtinModules.map(m => `node:${m}`)],
            output: {
                format: 'es',
                entryFileNames: '[name].mjs',
                chunkFileNames: 'chunks/[name]-[hash].mjs',
                banner: chunk => chunk.name === 'server' ? '#!/usr/bin/env node' : '',
            },
        },
    },
    ssr: {noExternal: true},
})
