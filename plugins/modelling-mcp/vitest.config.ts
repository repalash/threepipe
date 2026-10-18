import {defineConfig} from 'vitest/config'
import path from 'node:path'

export default defineConfig({
    resolve: {
        alias: {
            'threepipe': path.resolve(__dirname, '../../dist/index.mjs'),
            'three': path.resolve(__dirname, '../../node_modules/three/'),
            '@threepipe/mesh-kernel': path.resolve(__dirname, '../mesh-kernel/src/index.ts'),
            '@threepipe/modelling-parts': path.resolve(__dirname, '../modelling-parts/src/index.ts'),
            '@threepipe/plugin-modelling/agent-protocol': path.resolve(__dirname, '../modelling/src/agent/protocol.ts'),
            '@threepipe/plugin-modelling': path.resolve(__dirname, '../modelling/src/index.ts'),
            '@threepipe/modelling-cli': path.resolve(__dirname, '../modelling-cli/src/index.ts'),
        },
    },
    test: {
        environment: 'node',
        include: ['tests/**/*.test.ts'],
        testTimeout: 60000,
        pool: 'forks',
        server: {deps: {external: [/[\\/]dist[\\/]index\.mjs$/]}},
    },
})
